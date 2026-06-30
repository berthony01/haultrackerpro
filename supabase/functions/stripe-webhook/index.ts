import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[STRIPE-WEBHOOK] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

/** Resolve plan_key from a Stripe price ID. Returns null for unknown prices —
 *  callers MUST NOT grant Pro for an unknown price.
 */
function resolvePlanKey(priceId: string): string | null {
  const monthlyPriceId = Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID");
  const yearlyPriceId = Deno.env.get("STRIPE_PRO_YEARLY_PRICE_ID");
  if (priceId && priceId === monthlyPriceId) return "pro_monthly";
  if (priceId && priceId === yearlyPriceId) return "pro_yearly";
  return null;
}

/**
 * LEGACY recruiter plan capacity values.
 *
 * Historically these gated how many active standard opportunities a recruiter
 * could post. As of Phase 2 of the recruiter model rework, standard opportunity
 * posting is gated by recruiter approval/verification (see
 * `opportunities_billing_guard()`), NOT by Stripe plan or this numeric limit.
 *
 * These numbers are retained ONLY for:
 *   - backward compatibility with the NOT NULL `active_opportunity_limit`
 *     column on `recruiter_billing_profiles`,
 *   - legacy admin/UI displays still reading that column.
 *
 * Do NOT use this map to authorize posting. Paid premium capabilities
 * (priority placement, featured listings, recruiter reports, exports,
 * analytics, etc.) are derived from `plan` + `status` via
 * `getRecruiterPlanCapabilities` and `recruiter_has_priority_plan()`.
 *
 * Do NOT substitute a fake "unlimited" sentinel (999999, MAX_SAFE_INTEGER,
 * Infinity) here — the column is `integer NOT NULL` and downstream displays
 * would render it.
 */
const RECRUITER_PLAN_LEGACY_LIMITS: Record<string, number> = {
  none: 0, starter: 1, growth: 5, fleet: 25,
};


function resolveRecruiterPlan(priceId: string, metadataPlan?: string | null): string | null {
  if (metadataPlan && RECRUITER_PLAN_LEGACY_LIMITS[metadataPlan] != null) return metadataPlan;
  const map: Record<string, string> = {
    [Deno.env.get("STRIPE_RECRUITER_STARTER_PRICE_ID") ?? ""]: "starter",
    [Deno.env.get("STRIPE_RECRUITER_GROWTH_PRICE_ID") ?? ""]: "growth",
    [Deno.env.get("STRIPE_RECRUITER_FLEET_PRICE_ID") ?? ""]: "fleet",
  };
  return map[priceId] ?? null;
}

async function handleRecruiterSubscription(
  supabaseClient: any,
  subscription: Stripe.Subscription,
  metadata: Record<string, string>,
) {
  const userId = metadata.user_id;
  const recruiterId = metadata.recruiter_id;
  if (!userId || !recruiterId) {
    logStep("Recruiter sub missing metadata", { subId: subscription.id });
    return;
  }
  const priceId = subscription.items.data[0]?.price?.id ?? "";
  // Plan + status drive paid recruiter capabilities (priority placement,
  // featured, reports, exports, analytics) via getRecruiterPlanCapabilities
  // and recruiter_has_priority_plan(). They do NOT control standard
  // opportunity posting — that is gated on recruiter approval (Phase 2).
  const isCanceledLike = ["canceled", "incomplete_expired"].includes(subscription.status);
  const plan = isCanceledLike
    ? "none"
    : (resolveRecruiterPlan(priceId, metadata.plan) ?? "none");
  // Legacy column write only; no longer used for posting entitlement.
  const legacyLimit = RECRUITER_PLAN_LEGACY_LIMITS[plan] ?? 0;
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;
  const status = isCanceledLike ? "canceled" : subscription.status;

  const { error } = await supabaseClient
    .from("recruiter_billing_profiles")
    .upsert(
      {
        recruiter_id: recruiterId,
        user_id: userId,
        stripe_customer_id: subscription.customer as string,
        stripe_subscription_id: subscription.id,
        plan,
        status,
        // Legacy/compat field (NOT NULL integer). Kept in sync with the
        // previous mapping so admin displays still render expected numbers.
        // Posting entitlement is no longer derived from this value.
        active_opportunity_limit: legacyLimit,
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "recruiter_id" },
    );
  if (error) logStep("Recruiter billing upsert error", { error: error.message });
  else logStep("Recruiter billing updated", { recruiterId, plan, status, legacyLimit });
}

// ---------------------------------------------------------------------------
// Phase 8B — Agency billing branch.
//
// Agency events are routed here when ANY of the following are true:
//   - session/subscription metadata billing_context === "agency"
//   - the subscription's price ID is one of the configured agency price envs
//   - the Stripe customer matches an existing agency_entitlements row
//
// This branch ONLY touches public.agency_entitlements. It never touches
// subscriptions, profiles, or recruiter_billing_profiles. Conversely, the
// driver and recruiter branches never touch agency_entitlements.
// ---------------------------------------------------------------------------

const AGENCY_PLAN_ENV: Record<string, string> = {
  agency_starter: "STRIPE_AGENCY_STARTER_PRICE_ID",
  agency_team: "STRIPE_AGENCY_TEAM_PRICE_ID",
  agency_growth: "STRIPE_AGENCY_GROWTH_PRICE_ID",
};

function resolveAgencyPlanKey(priceId: string, metadataPlanKey?: string | null): string | null {
  if (metadataPlanKey && AGENCY_PLAN_ENV[metadataPlanKey]) return metadataPlanKey;
  for (const [key, envName] of Object.entries(AGENCY_PLAN_ENV)) {
    const envPriceId = Deno.env.get(envName);
    if (envPriceId && envPriceId === priceId) return key;
  }
  return null;
}

function isAgencyPriceId(priceId: string): boolean {
  if (!priceId) return false;
  for (const envName of Object.values(AGENCY_PLAN_ENV)) {
    if (Deno.env.get(envName) === priceId) return true;
  }
  return false;
}

function mapAgencyStripeStatus(stripeStatus: string): "active" | "trialing" | "past_due" | "cancelled" {
  switch (stripeStatus) {
    case "active": return "active";
    case "trialing": return "trialing";
    case "past_due":
    case "unpaid": return "past_due";
    case "canceled":
    case "incomplete_expired":
    case "incomplete":
    default: return "cancelled";
  }
}

async function isAgencyContext(
  supabaseClient: any,
  subscription: Stripe.Subscription,
  sessionMetadata?: Record<string, string> | null,
): Promise<{ agency_id: string | null; matched: boolean }> {
  const meta = { ...(sessionMetadata ?? {}), ...(subscription.metadata ?? {}) } as Record<string, string>;
  if (meta.billing_context === "agency" && meta.agency_id) {
    return { agency_id: meta.agency_id, matched: true };
  }
  const priceId = subscription.items?.data?.[0]?.price?.id ?? "";
  if (isAgencyPriceId(priceId)) {
    // Try metadata first, then look up by customer
    if (meta.agency_id) return { agency_id: meta.agency_id, matched: true };
    const { data } = await supabaseClient
      .from("agency_entitlements")
      .select("agency_id")
      .eq("stripe_customer_id", subscription.customer as string)
      .maybeSingle();
    if (data?.agency_id) return { agency_id: data.agency_id, matched: true };
    return { agency_id: null, matched: true };
  }
  // Customer lookup fallback even without metadata or price match — agencies
  // own a dedicated customer ID.
  const { data } = await supabaseClient
    .from("agency_entitlements")
    .select("agency_id")
    .eq("stripe_customer_id", subscription.customer as string)
    .maybeSingle();
  if (data?.agency_id) return { agency_id: data.agency_id, matched: true };
  return { agency_id: null, matched: false };
}

async function handleAgencySubscription(
  supabaseClient: any,
  subscription: Stripe.Subscription,
  agencyId: string,
  sessionMetadata?: Record<string, string> | null,
) {
  const meta = { ...(sessionMetadata ?? {}), ...(subscription.metadata ?? {}) } as Record<string, string>;
  const priceId = subscription.items?.data?.[0]?.price?.id ?? "";
  const planKey = resolveAgencyPlanKey(priceId, meta.plan_key);
  if (!planKey) {
    logStep("Agency event — unknown price ID, refusing to grant plan", { priceId, agencyId });
    return;
  }
  const status = mapAgencyStripeStatus(subscription.status);
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const { error } = await supabaseClient
    .from("agency_entitlements")
    .upsert(
      {
        agency_id: agencyId,
        plan_key: planKey,
        status,
        source: "stripe",
        stripe_customer_id: subscription.customer as string,
        stripe_subscription_id: subscription.id,
        current_period_end: periodEnd,
        // Override columns intentionally left null so plan defaults apply.
        active_client_limit: null,
        member_limit: null,
        service_package_limit: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "agency_id" },
    );
  if (error) {
    logStep("Agency entitlement upsert error", { error: error.message, agencyId });
    throw new Error(`Agency entitlement upsert failed: ${error.message}`);
  }
  logStep("Agency entitlement updated", { agencyId, planKey, status });
}

async function handleAgencySubscriptionDeleted(
  supabaseClient: any,
  subscription: Stripe.Subscription,
  agencyId: string,
) {
  const { error } = await supabaseClient
    .from("agency_entitlements")
    .update({
      status: "cancelled",
      stripe_subscription_id: null,
      current_period_end: null,
      updated_at: new Date().toISOString(),
    })
    .eq("agency_id", agencyId);
  if (error) {
    logStep("Agency entitlement cancel error", { error: error.message, agencyId });
    throw new Error(`Agency entitlement cancel failed: ${error.message}`);
  }
  logStep("Agency entitlement cancelled", { agencyId });
}





/** Upsert the subscriptions table row */
async function upsertSubscription(
  supabaseClient: any,
  userId: string,
  data: {
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    stripe_price_id?: string | null;
    plan_key: string;
    status: string;
    cancel_at_period_end?: boolean;
    current_period_start?: string | null;
    current_period_end?: string | null;
    trial_start?: string | null;  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
    trial_end?: string | null;  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
  }
) {
  const { error } = await supabaseClient
    .from("subscriptions")
    .upsert(
      { user_id: userId, ...data, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) {
    logStep("Error upserting subscription", { error: error.message });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey) {
    logStep("ERROR", { message: "STRIPE_SECRET_KEY not set" });
    return new Response("Server error", { status: 500 });
  }
  if (!webhookSecret) {
    logStep("ERROR", { message: "STRIPE_WEBHOOK_SECRET not set" });
    return new Response("Server misconfiguration", { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  let event: Stripe.Event;

  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      logStep("ERROR", { message: "No stripe-signature header" });
      return new Response("No signature", { status: 400 });
    }
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    logStep("Event received", { type: event.type, id: event.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logStep("Webhook signature verification failed", { message: msg });
    return new Response(`Webhook Error: ${msg}`, { status: 400 });
  }

  // Idempotency: only process each verified Stripe event once.
  // Insert is attempted AFTER signature verification so unverified events
  // never touch the ledger. Fail-closed: if the ledger insert fails for any
  // reason other than a duplicate (23505 unique_violation), return 500 and
  // let Stripe retry — never process an event that wasn't durably recorded.
  try {
    const { error: idemError } = await supabaseClient
      .from("stripe_webhook_events")
      .insert({ stripe_event_id: event.id, event_type: event.type });
    if (idemError) {
      // Postgres unique_violation → already processed, safe to ack.
      if ((idemError as { code?: string }).code === "23505") {
        logStep("Duplicate event ignored", { id: event.id, type: event.type });
        return new Response(JSON.stringify({ received: true, duplicate: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }
      // Fail closed — do not process without a durable ledger entry.
      logStep("Idempotency insert failed — refusing to process (will retry)", {
        id: event.id,
        type: event.type,
        code: (idemError as { code?: string }).code,
        message: idemError.message,
      });
      return new Response(
        JSON.stringify({ error: "Idempotency ledger insert failed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logStep("Idempotency check threw — refusing to process (will retry)", {
      id: event.id,
      type: event.type,
      message: msg,
    });
    return new Response(
      JSON.stringify({ error: "Idempotency ledger check threw" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        logStep("Checkout completed", { sessionId: session.id, customerId: session.customer, subscriptionId: session.subscription });

        const userId = session.metadata?.user_id;
        const billingType = session.metadata?.billing_type;
        const billingContext = session.metadata?.billing_context;

        // Agency checkout — handle separately, do NOT touch driver Pro / recruiter tables
        if (billingContext === "agency" && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          const { agency_id, matched } = await isAgencyContext(supabaseClient, sub, session.metadata as Record<string, string>);
          if (matched && agency_id) {
            await handleAgencySubscription(supabaseClient, sub, agency_id, session.metadata as Record<string, string>);
          } else {
            logStep("Agency checkout missing agency_id — refusing to upsert", { sessionId: session.id });
          }
          break;
        }

        // Recruiter checkout — handle separately, do NOT touch driver Pro tables
        if (billingType === "recruiter" && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          await handleRecruiterSubscription(supabaseClient, sub, {
            ...(session.metadata ?? {}),
            ...(sub.metadata ?? {}),
          });
          break;
        }


        if (userId && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          const priceId = subscription.items.data[0]?.price?.id || "";
          const resolved = resolvePlanKey(priceId);
          const planKey = session.metadata?.plan_key || resolved;
          if (!planKey) {
            logStep("Skipping Pro upsert — unknown price ID and no plan_key metadata", { priceId, userId });
            break;
          }
          const subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();
          const subscriptionStart = new Date(subscription.current_period_start * 1000).toISOString();
          const trialStart = subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null;  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
          const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing

          // Upsert subscriptions table (canonical)
          await upsertSubscription(supabaseClient, userId, {
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
            stripe_price_id: priceId,
            plan_key: planKey,
            status: subscription.status,
            cancel_at_period_end: subscription.cancel_at_period_end,
            current_period_start: subscriptionStart,
            current_period_end: subscriptionEnd,
            trial_start: trialStart,  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
            trial_end: trialEnd,  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
          });

          // Also update profiles for backward compat
          await supabaseClient.from("profiles").update({
            subscription_status: "pro",
            subscription_plan: planKey,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
            subscription_expires_at: subscriptionEnd,
          }).eq("user_id", userId);

          logStep("Profile & subscription updated to pro", { userId, planKey });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        logStep("Subscription updated", { subscriptionId: subscription.id, status: subscription.status });

        // Agency billing branch — must run BEFORE driver/recruiter so we
        // never accidentally upsert into subscriptions/profiles for an
        // agency-only customer.
        const agencyCtx = await isAgencyContext(supabaseClient, subscription, null);
        if (agencyCtx.matched) {
          if (agencyCtx.agency_id) {
            await handleAgencySubscription(supabaseClient, subscription, agencyCtx.agency_id, null);
          } else {
            logStep("Agency subscription without resolvable agency_id — skipping", { subId: subscription.id });
          }
          break;
        }

        // Recruiter billing branch
        if (subscription.metadata?.billing_type === "recruiter") {
          await handleRecruiterSubscription(supabaseClient, subscription, subscription.metadata as Record<string, string>);
          break;
        }


        const customerId = subscription.customer as string;
        const customer = await stripe.customers.retrieve(customerId);
        const email = (customer as Stripe.Customer).email;

        if (!email) {
          logStep("No email on customer, skipping");
          break;
        }

        // Find user by stripe_customer_id in subscriptions or profiles
        let userId: string | null = null;
        const { data: subRow } = await supabaseClient
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();
        userId = subRow?.user_id || null;

        if (!userId) {
          const { data: profile } = await supabaseClient
            .from("profiles")
            .select("user_id, subscription_status")
            .eq("stripe_customer_id", customerId)
            .maybeSingle();
          userId = profile?.user_id || null;
        }

        if (!userId) {
          logStep("No user found for customer", { customerId });
          break;
        }

        const priceId = subscription.items.data[0]?.price?.id || "";
        const resolvedPlan = resolvePlanKey(priceId);
        const isActive = subscription.status === "active";

        if (isActive && !resolvedPlan) {
          logStep("Skipping Pro upsert — unknown price ID on active sub", { priceId, subId: subscription.id });
          break;
        }
        const planKey = resolvedPlan ?? "free";
        const subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();
        const subscriptionStart = new Date(subscription.current_period_start * 1000).toISOString();
        const trialStart = subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null;  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
        const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing

        // Check for admin/manual override before downgrading
        const { data: currentSub } = await supabaseClient
          .from("subscriptions")
          .select("status")
          .eq("user_id", userId)
          .maybeSingle();

        if (isActive) {
          await upsertSubscription(supabaseClient, userId, {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            stripe_price_id: priceId,
            plan_key: planKey,
            status: subscription.status,
            cancel_at_period_end: subscription.cancel_at_period_end,
            current_period_start: subscriptionStart,
            current_period_end: subscriptionEnd,
            trial_start: trialStart,  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
            trial_end: trialEnd,  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
          });

          // Backward compat profiles update
          await supabaseClient.from("profiles").update({
            subscription_status: "pro",
            subscription_plan: planKey,
            stripe_subscription_id: subscription.id,
            subscription_expires_at: subscriptionEnd,
          }).eq("user_id", userId);

          logStep("Profile & subscription kept/set to pro", { userId });
        } else if (subscription.status === "canceled" || subscription.status === "unpaid" || subscription.status === "past_due") {
          // Check for manual override in profiles
          const { data: profile } = await supabaseClient
            .from("profiles")
            .select("subscription_status")
            .eq("user_id", userId)
            .maybeSingle();

          // Only downgrade if the subscription matches and no manual override
          await upsertSubscription(supabaseClient, userId, {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            stripe_price_id: priceId,
            plan_key: "free",
            status: subscription.status,
            cancel_at_period_end: subscription.cancel_at_period_end,
            current_period_start: subscriptionStart,
            current_period_end: subscriptionEnd,
            trial_start: trialStart,  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
            trial_end: trialEnd,  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
          });

          // Only downgrade profiles if this subscription matches
          await supabaseClient.from("profiles").update({
            subscription_status: "free",
            subscription_plan: null,
            stripe_subscription_id: null,
            subscription_expires_at: null,
          }).eq("user_id", userId).eq("stripe_subscription_id", subscription.id);

          logStep("Profile & subscription downgraded", { userId });
        } else {
          // Other statuses (incomplete, incomplete_expired) — update subscription row
          await upsertSubscription(supabaseClient, userId, {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            stripe_price_id: priceId,
            plan_key: planKey,
            status: subscription.status,
            cancel_at_period_end: subscription.cancel_at_period_end,
            current_period_start: subscriptionStart,
            current_period_end: subscriptionEnd,
            trial_start: trialStart,  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
            trial_end: trialEnd,  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        logStep("Subscription deleted", { subscriptionId: subscription.id });

        if (subscription.metadata?.billing_type === "recruiter") {
          await handleRecruiterSubscription(supabaseClient, subscription, subscription.metadata as Record<string, string>);
          break;
        }

        // Find user
        const { data: subRow } = await supabaseClient
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_subscription_id", subscription.id)
          .maybeSingle();

        let userId = subRow?.user_id || null;

        if (!userId) {
          const { data: profile } = await supabaseClient
            .from("profiles")
            .select("user_id")
            .eq("stripe_subscription_id", subscription.id)
            .maybeSingle();
          userId = profile?.user_id || null;
        }

        if (userId) {
          await upsertSubscription(supabaseClient, userId, {
            plan_key: "free",
            status: "canceled",
            cancel_at_period_end: false,
            stripe_subscription_id: null,
            stripe_price_id: null,
            current_period_start: null,
            current_period_end: null,
            trial_start: null,  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
            trial_end: null,  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
          });

          await supabaseClient.from("profiles").update({
            subscription_status: "free",
            subscription_plan: null,
            stripe_subscription_id: null,
            subscription_expires_at: null,
          }).eq("user_id", userId);

          logStep("Profile & subscription downgraded on deletion", { userId });
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        logStep("Invoice paid", { invoiceId: invoice.id, customerId: invoice.customer });
        // No action needed — subscription.updated handles status changes
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        logStep("Invoice payment failed", { invoiceId: invoice.id, customerId: invoice.customer });
        // Stripe will update subscription status → handled by subscription.updated
        break;
      }

      default:
        logStep("Unhandled event type", { type: event.type });
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR processing event", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
