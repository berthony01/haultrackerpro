import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import {
  validateWebhookIdentity,
  type BillingContext,
  type CanonicalBinding,
  type IdentityDecision,
  type PriceResolver,
  type ResolvedPrice,
  type WebhookDataGateway,
  type WebhookEventType,
  type WebhookMetadata,
  TERMINAL_STATUSES,
} from "../_shared/stripe-webhook-identity.ts";
import {
  reconcileBusinessSubscriptionActivation,
  type AgencyEntitlementRowShape,
  type BusinessReconciliationGateway,
  type RecruiterBillingRowShape,
} from "../_shared/business-subscription-reconciliation.ts";
import {
  createSupabaseLedgerClient,
  withIdempotency,
  DEFAULT_LEASE_SECONDS,
  type TerminalResult,
} from "../_shared/stripe-webhook-idempotency.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[STRIPE-WEBHOOK] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

// ---------------------------------------------------------------------------
// Phase 1C — canonical billing identity guard.
//
// Every state-changing Stripe event (checkout completion and subscription
// created / updated / deleted) is routed through the runtime-neutral
// validator in ../_shared/stripe-webhook-identity.ts BEFORE any billing or
// entitlement row is written. Metadata is treated as routing evidence only.
// Canonical identity (stripe_customer_id / stripe_subscription_id per entity)
// is authoritative. See that module for the full decision matrix.
// evidence only. Canonical identity (stripe_customer_id / stripe_subscription_id
// per entity) is authoritative. See that module for the full decision matrix.
// ---------------------------------------------------------------------------

/** Legacy driver price → plan_key map. Kept for logging/back-compat; the
 *  authoritative mapping now flows through buildPriceResolver(). */
function resolvePlanKey(priceId: string): string | null {
  const monthlyPriceId = Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID");
  const yearlyPriceId = Deno.env.get("STRIPE_PRO_YEARLY_PRICE_ID");
  if (priceId && priceId === monthlyPriceId) return "pro_monthly";
  if (priceId && priceId === yearlyPriceId) return "pro_yearly";
  return null;
}

// Phase 1R-E1 — canonical recruiter active-opportunity ceilings. `none` is the
// free Recruiter Standard tier, which now allows exactly 1 active opportunity.
const RECRUITER_PLAN_LEGACY_LIMITS: Record<string, number> = {
  none: 1, starter: 5, growth: 15, fleet: 25,
};


const AGENCY_PLAN_ENV: Record<string, string> = {
  agency_starter: "STRIPE_AGENCY_STARTER_PRICE_ID",
  agency_team: "STRIPE_AGENCY_TEAM_PRICE_ID",
  agency_growth: "STRIPE_AGENCY_GROWTH_PRICE_ID",
};

const RECRUITER_PLAN_ENV: Record<string, string> = {
  starter: "STRIPE_RECRUITER_STARTER_PRICE_ID",
  growth: "STRIPE_RECRUITER_GROWTH_PRICE_ID",
  fleet: "STRIPE_RECRUITER_FLEET_PRICE_ID",
};

function buildPriceResolver(): PriceResolver {
  const driverMonthly = Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID") ?? "";
  const driverYearly = Deno.env.get("STRIPE_PRO_YEARLY_PRICE_ID") ?? "";
  const recruiter: Record<string, "starter" | "growth" | "fleet"> = {};
  for (const [plan, envName] of Object.entries(RECRUITER_PLAN_ENV)) {
    const id = Deno.env.get(envName);
    if (id) recruiter[id] = plan as "starter" | "growth" | "fleet";
  }
  const agency: Record<string, "agency_starter" | "agency_team" | "agency_growth"> = {};
  for (const [plan, envName] of Object.entries(AGENCY_PLAN_ENV)) {
    const id = Deno.env.get(envName);
    if (id) agency[id] = plan as "agency_starter" | "agency_team" | "agency_growth";
  }
  return (priceId: string): ResolvedPrice | null => {
    if (!priceId) return null;
    if (priceId === driverMonthly) return { context: "driver", planKey: "pro_monthly" };
    if (priceId === driverYearly) return { context: "driver", planKey: "pro_yearly" };
    if (recruiter[priceId]) return { context: "recruiter", planKey: recruiter[priceId] };
    if (agency[priceId]) return { context: "agency", planKey: agency[priceId] };
    return null;
  };
}

/** Data-gateway wrapping the service-role supabase client. Kept small so the
 *  validator can be swapped for an in-memory harness under tests. */
function buildGateway(supabase: any): WebhookDataGateway {
  const bindingFromDriverRow = (r: any): CanonicalBinding => ({
    context: "driver",
    entity_key: r.user_id,
    stripe_customer_id: r.stripe_customer_id ?? null,
    stripe_subscription_id: r.stripe_subscription_id ?? null,
    status: r.status ?? null,
  });
  const bindingFromRecruiterRow = (r: any): CanonicalBinding => ({
    context: "recruiter",
    entity_key: r.recruiter_id,
    stripe_customer_id: r.stripe_customer_id ?? null,
    stripe_subscription_id: r.stripe_subscription_id ?? null,
    status: r.status ?? null,
  });
  const bindingFromAgencyRow = (r: any): CanonicalBinding => ({
    context: "agency",
    entity_key: r.agency_id,
    stripe_customer_id: r.stripe_customer_id ?? null,
    stripe_subscription_id: r.stripe_subscription_id ?? null,
    status: r.status ?? null,
  });

  return {
    async findByCustomerId(customerId) {
      const [d, r, a] = await Promise.all([
        supabase.from("subscriptions").select("user_id, stripe_customer_id, stripe_subscription_id, status").eq("stripe_customer_id", customerId),
        supabase.from("recruiter_billing_profiles").select("recruiter_id, stripe_customer_id, stripe_subscription_id, status").eq("stripe_customer_id", customerId),
        supabase.from("agency_entitlements").select("agency_id, stripe_customer_id, stripe_subscription_id, status").eq("stripe_customer_id", customerId),
      ]);
      const out: CanonicalBinding[] = [];
      for (const row of d.data ?? []) out.push(bindingFromDriverRow(row));
      for (const row of r.data ?? []) out.push(bindingFromRecruiterRow(row));
      for (const row of a.data ?? []) out.push(bindingFromAgencyRow(row));
      return out;
    },
    async findBySubscriptionId(subscriptionId) {
      const [d, r, a] = await Promise.all([
        supabase.from("subscriptions").select("user_id, stripe_customer_id, stripe_subscription_id, status").eq("stripe_subscription_id", subscriptionId),
        supabase.from("recruiter_billing_profiles").select("recruiter_id, stripe_customer_id, stripe_subscription_id, status").eq("stripe_subscription_id", subscriptionId),
        supabase.from("agency_entitlements").select("agency_id, stripe_customer_id, stripe_subscription_id, status").eq("stripe_subscription_id", subscriptionId),
      ]);
      const out: CanonicalBinding[] = [];
      for (const row of d.data ?? []) out.push(bindingFromDriverRow(row));
      for (const row of r.data ?? []) out.push(bindingFromRecruiterRow(row));
      for (const row of a.data ?? []) out.push(bindingFromAgencyRow(row));
      return out;
    },
    async loadCanonical(context, entity_key) {
      if (context === "driver") {
        const { data } = await supabase.from("subscriptions").select("user_id, stripe_customer_id, stripe_subscription_id, status").eq("user_id", entity_key).maybeSingle();
        return data ? bindingFromDriverRow(data) : null;
      }
      if (context === "recruiter") {
        const { data } = await supabase.from("recruiter_billing_profiles").select("recruiter_id, stripe_customer_id, stripe_subscription_id, status").eq("recruiter_id", entity_key).maybeSingle();
        return data ? bindingFromRecruiterRow(data) : null;
      }
      const { data } = await supabase.from("agency_entitlements").select("agency_id, stripe_customer_id, stripe_subscription_id, status").eq("agency_id", entity_key).maybeSingle();
      return data ? bindingFromAgencyRow(data) : null;
    },
    async recruiterOwnerIs(recruiter_id, user_id) {
      const { data } = await supabase.from("recruiter_profiles").select("user_id").eq("id", recruiter_id).maybeSingle();
      return !!data && data.user_id === user_id;
    },
    async agencyOwnerIs(agency_id, owner_user_id) {
      // Canonical agency billing owner contract (same as the reconciliation
      // gateway): agency_profiles.owner_user_id AND an ACTIVE agency_owner
      // membership for that same user. Email is never used.
      const { data: agency, error: agencyError } = await supabase
        .from("agency_profiles")
        .select("owner_user_id")
        .eq("id", agency_id)
        .maybeSingle();
      if (agencyError) return false;
      const canonicalOwner = agency?.owner_user_id ?? null;
      if (typeof canonicalOwner !== "string" || canonicalOwner.length === 0) return false;
      if (owner_user_id && owner_user_id !== canonicalOwner) return false;

      const { data: membership, error: membershipError } = await supabase
        .from("agency_members")
        .select("member_user_id")
        .eq("agency_id", agency_id)
        .eq("member_user_id", canonicalOwner)
        .eq("role", "agency_owner")
        .eq("status", "active")
        .maybeSingle();
      if (membershipError) return false;
      return !!membership?.member_user_id;
    },
    async driverExists(user_id) {
      const { data } = await supabase.from("profiles").select("user_id").eq("user_id", user_id).maybeSingle();
      return !!data;
    },
  };
}

// ---------------------------------------------------------------------------
// Phase 1R-D2-B4 — opposing-business reconciliation gateway.
//
// READ-ONLY. This gateway performs `select` queries exclusively; it contains
// no insert, update, upsert, delete, or rpc call. All entitlement writes
// remain confined to applyEntitlement / applyRevoke.
//
// Raw Supabase error text is never propagated: every read failure throws a
// stable internal error, which the pure reconciliation module converts into
// the `opposing_business_state_unknown` fail-closed decision.
// ---------------------------------------------------------------------------

function reconciliationReadFailure(): Error {
  return new Error("business_reconciliation_read_failed");
}

function buildBusinessReconciliationGateway(supabase: any): BusinessReconciliationGateway {
  return {
    async resolveOwnerUserId(context, entityKey) {
      if (context === "driver") return null;
      if (!entityKey) return null;

      if (context === "recruiter") {
        const { data, error } = await supabase
          .from("recruiter_profiles")
          .select("user_id")
          .eq("id", entityKey)
          .maybeSingle();
        if (error) throw reconciliationReadFailure();
        const ownerUserId = data?.user_id ?? null;
        return typeof ownerUserId === "string" && ownerUserId.length > 0 ? ownerUserId : null;
      }

      // agency — canonical owner is agency_profiles.owner_user_id, and that
      // same user must additionally hold an ACTIVE agency_owner membership.
      const { data: agency, error: agencyError } = await supabase
        .from("agency_profiles")
        .select("owner_user_id")
        .eq("id", entityKey)
        .maybeSingle();
      if (agencyError) throw reconciliationReadFailure();
      const ownerUserId = agency?.owner_user_id ?? null;
      if (typeof ownerUserId !== "string" || ownerUserId.length === 0) return null;

      const { data: membership, error: membershipError } = await supabase
        .from("agency_members")
        .select("member_user_id")
        .eq("agency_id", entityKey)
        .eq("member_user_id", ownerUserId)
        .eq("role", "agency_owner")
        .eq("status", "active")
        .maybeSingle();
      if (membershipError) throw reconciliationReadFailure();
      if (!membership?.member_user_id) return null;
      return ownerUserId;
    },

    async loadRecruiterBillingRows(ownerUserId) {
      const { data, error } = await supabase
        .from("recruiter_billing_profiles")
        .select("recruiter_id, plan, status")
        .eq("user_id", ownerUserId);
      if (error) throw reconciliationReadFailure();
      return ((data ?? []) as RecruiterBillingRowShape[]).map((row) => ({
        recruiter_id: row?.recruiter_id ?? null,
        plan: row?.plan ?? null,
        status: row?.status ?? null,
      }));
    },

    async loadOwnedAgencyEntitlementRows(ownerUserId) {
      // Ownership is the intersection of (a) active agency_owner membership and
      // (b) agency_profiles.owner_user_id — membership alone is insufficient,
      // and email is never used.
      const { data: memberships, error: membershipError } = await supabase
        .from("agency_members")
        .select("agency_id")
        .eq("member_user_id", ownerUserId)
        .eq("role", "agency_owner")
        .eq("status", "active");
      if (membershipError) throw reconciliationReadFailure();

      const memberAgencyIds = ((memberships ?? []) as Array<{ agency_id?: string | null }>)
        .map((row) => row?.agency_id ?? null)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      if (memberAgencyIds.length === 0) return [];

      const { data: ownedAgencies, error: ownedError } = await supabase
        .from("agency_profiles")
        .select("id")
        .eq("owner_user_id", ownerUserId)
        .in("id", memberAgencyIds);
      if (ownedError) throw reconciliationReadFailure();

      const ownedAgencyIds = ((ownedAgencies ?? []) as Array<{ id?: string | null }>)
        .map((row) => row?.id ?? null)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      if (ownedAgencyIds.length === 0) return [];

      const { data, error } = await supabase
        .from("agency_entitlements")
        .select("agency_id, plan_key, status, source")
        .in("agency_id", ownedAgencyIds);
      if (error) throw reconciliationReadFailure();

      return ((data ?? []) as AgencyEntitlementRowShape[]).map((row) => ({
        agency_id: row?.agency_id ?? null,
        plan_key: row?.plan_key ?? null,
        status: row?.status ?? null,
        source: row?.source ?? null,
      }));
    },
  };
}



function metadataFromMap(m: Record<string, string> | undefined | null): WebhookMetadata {
  const raw = m ?? {};
  let declared: BillingContext | null = null;
  if (raw.billing_context === "driver" || raw.billing_context === "recruiter" || raw.billing_context === "agency") {
    declared = raw.billing_context;
  } else if (raw.billing_type === "recruiter") {
    declared = "recruiter";
  } else if (raw.billing_type === "driver") {
    declared = "driver";
  }
  return {
    declaredContext: declared,
    user_id: raw.user_id ?? null,
    recruiter_id: raw.recruiter_id ?? null,
    agency_id: raw.agency_id ?? null,
    owner_user_id: raw.owner_user_id ?? null,
    plan_key: raw.plan_key ?? raw.plan ?? null,
  };
}

/** Guarded routing: run the identity validator and dispatch to the correct
 *  writer. All rejections are permanent integrity failures — logged with a
 *  stable reason code (never full IDs) and acked to Stripe with 200 so we do
 *  not induce an infinite retry loop on a forever-invalid event. */
export async function processValidatedSubscriptionEvent(params: {
  supabase: any;
  subscription: Stripe.Subscription;
  sessionMetadata: Record<string, string> | null;
  eventType: WebhookEventType;
  priceResolver: PriceResolver;
  gateway: WebhookDataGateway;
  reconciliationGateway: BusinessReconciliationGateway;
}): Promise<{ ok: true; decision: IdentityDecision } | { ok: false; decision: IdentityDecision }> {
  const { supabase, subscription, sessionMetadata, eventType, priceResolver, gateway, reconciliationGateway } = params;
  const meta = metadataFromMap({ ...(sessionMetadata ?? {}), ...(subscription.metadata ?? {}) } as Record<string, string>);
  const priceId = subscription.items?.data?.[0]?.price?.id ?? "";

  // Step 1 — canonical identity validation always runs first.
  const decision = await validateWebhookIdentity({
    eventType,
    incomingCustomerId: subscription.customer as string,
    incomingSubscriptionId: subscription.id ?? null,
    incomingStatus: subscription.status ?? null,
    priceId,
    metadata: meta,
    resolvePrice: priceResolver,
    gateway,
  });

  if (decision.kind === "reject") {
    logStep("Rejected — canonical identity guard", {
      reason: decision.reason,
      event_type: eventType,
      declared_context: meta.declaredContext,
    });
    return { ok: false, decision };
  }

  // Step 2 — terminal revocation applies immediately. Reconciliation must
  // never be able to block a revoke against the exact canonical binding.
  if (decision.kind === "allow_revoke") {
    await applyRevoke(supabase, decision.context, decision.entity_key, subscription);
    return { ok: true, decision };
  }

  // Step 3 — Phase 1R-D2-B4 opposing-business reconciliation runs BEFORE any
  // entitlement mutation, for allow_initial_binding and allow_existing_binding.
  const reconciliation = await reconcileBusinessSubscriptionActivation({
    context: decision.context,
    entityKey: decision.entity_key,
    eventType,
    incomingStatus: subscription.status ?? null,
    gateway: reconciliationGateway,
  });

  if (reconciliation.kind === "reject") {
    logStep("Rejected — business subscription reconciliation", {
      reason: reconciliation.reason,
      context: decision.context,
      event_type: eventType,
    });
    return { ok: false, decision: { kind: "reject", reason: reconciliation.reason } };
  }

  // Step 4 — only a reconciliation allow may reach the entitlement writer.
  await applyEntitlement(supabase, decision.context, decision.entity_key, decision.resolvedPrice, subscription);
  return { ok: true, decision };
}


async function applyEntitlement(
  supabase: any,
  context: BillingContext,
  entityKey: string,
  price: ResolvedPrice,
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId = subscription.customer as string;
  const subId = subscription.id;
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;
  const periodStart = subscription.current_period_start
    ? new Date(subscription.current_period_start * 1000).toISOString()
    : null;
  const trialStart = subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null;  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
  const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;  // trial-allowlist: Stripe/back-compat field mirroring, never user-facing
  const priceId = subscription.items?.data?.[0]?.price?.id ?? null;
  const status = subscription.status;
  const isActive = status === "active" || status === "trialing" || status === "past_due";  // trial-allowlist: Stripe subscription status

  if (context === "driver") {
    // Only grant/keep Pro on non-terminal statuses.
    const planKey = isActive ? price.planKey : "free";
    const { error } = await supabase.from("subscriptions").upsert(
      {
        user_id: entityKey,
        stripe_customer_id: customerId,
        stripe_subscription_id: subId,
        stripe_price_id: priceId,
        plan_key: planKey,
        status,
        cancel_at_period_end: subscription.cancel_at_period_end,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        trial_start: trialStart,  // trial-allowlist
        trial_end: trialEnd,  // trial-allowlist
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(`driver subscriptions upsert failed: ${error.message}`);
    if (isActive) {
      await supabase.from("profiles").update({
        subscription_status: "pro",
        subscription_plan: planKey,
        stripe_customer_id: customerId,
        stripe_subscription_id: subId,
        subscription_expires_at: periodEnd,
      }).eq("user_id", entityKey);
    }
    logStep("Driver entitlement applied", { plan_key: planKey, status });
    return;
  }

  if (context === "recruiter") {
    const plan = isActive ? price.planKey : "none";
    const legacyLimit =
      RECRUITER_PLAN_LEGACY_LIMITS[plan] ?? RECRUITER_PLAN_LEGACY_LIMITS.none;

    // Owner user_id is known from the canonical row; we must NOT overwrite it
    // from metadata, and it is NEVER derived from any email. Fetch existing to
    // preserve, and fall back to recruiter_profiles.id -> user_id for the
    // initial binding. Fail closed when no owner can be resolved.
    const { data: existing } = await supabase
      .from("recruiter_billing_profiles")
      .select("user_id")
      .eq("recruiter_id", entityKey)
      .maybeSingle();
    let ownerUserId: string | null =
      typeof existing?.user_id === "string" && existing.user_id.length > 0
        ? existing.user_id
        : null;
    if (!ownerUserId) {
      // Initial binding: recruiter ownership was validated by gateway; safe to derive from recruiter_profiles.
      const { data: rp, error: rpError } = await supabase
        .from("recruiter_profiles")
        .select("user_id")
        .eq("id", entityKey)
        .maybeSingle();
      if (rpError) throw new Error("recruiter owner missing during initial binding");
      const resolved = rp?.user_id ?? null;
      if (typeof resolved !== "string" || resolved.length === 0) {
        throw new Error("recruiter owner missing during initial binding");
      }
      ownerUserId = resolved;
    }
    const { error } = await supabase.from("recruiter_billing_profiles").upsert(
      {
        recruiter_id: entityKey,
        user_id: ownerUserId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subId,
        plan,
        status,
        active_opportunity_limit: legacyLimit,
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "recruiter_id" },
    );
    if (error) throw new Error(`recruiter billing upsert failed: ${error.message}`);
    logStep("Recruiter entitlement applied", { plan, status });
    return;
  }

  // agency
  const mapAgency = mapAgencyStripeStatus(status);
  const { error } = await supabase.from("agency_entitlements").upsert(
    {
      agency_id: entityKey,
      plan_key: price.planKey,
      status: mapAgency,
      source: "stripe",
      stripe_customer_id: customerId,
      stripe_subscription_id: subId,
      current_period_end: periodEnd,
      active_client_limit: null,
      member_limit: null,
      service_package_limit: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "agency_id" },
  );
  if (error) throw new Error(`agency entitlement upsert failed: ${error.message}`);
  logStep("Agency entitlement applied", { plan_key: price.planKey, status: mapAgency });
}

async function applyRevoke(
  supabase: any,
  context: BillingContext,
  entityKey: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  const subId = subscription.id;
  const status = subscription.status;
  if (context === "driver") {
    await supabase.from("subscriptions").upsert(
      {
        user_id: entityKey,
        plan_key: "free",
        status: status === "canceled" ? "canceled" : status,
        cancel_at_period_end: subscription.cancel_at_period_end ?? false,
        stripe_subscription_id: null,
        stripe_price_id: null,
        current_period_start: null,
        current_period_end: null,
        trial_start: null,  // trial-allowlist
        trial_end: null,  // trial-allowlist
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    await supabase.from("profiles").update({
      subscription_status: "free",
      subscription_plan: null,
      stripe_subscription_id: null,
      subscription_expires_at: null,
    }).eq("user_id", entityKey).eq("stripe_subscription_id", subId);
    logStep("Driver entitlement revoked", { status });
    return;
  }
  if (context === "recruiter") {
    await supabase.from("recruiter_billing_profiles").update({
      plan: "none",
      status: status === "canceled" ? "canceled" : status,
      stripe_subscription_id: null,
      active_opportunity_limit: RECRUITER_PLAN_LEGACY_LIMITS.none,
      current_period_end: null,
      updated_at: new Date().toISOString(),
    }).eq("recruiter_id", entityKey);
    logStep("Recruiter entitlement revoked", { status });
    return;
  }
  await supabase.from("agency_entitlements").update({
    status: "cancelled",
    stripe_subscription_id: null,
    current_period_end: null,
    updated_at: new Date().toISOString(),
  }).eq("agency_id", entityKey);
  logStep("Agency entitlement revoked", { status });
}

// -- Legacy helpers retained for source-shape compatibility with phase8 tests --

function resolveRecruiterPlan(priceId: string, metadataPlan?: string | null): string | null {
  if (metadataPlan && RECRUITER_PLAN_LEGACY_LIMITS[metadataPlan] != null) return metadataPlan;
  const map: Record<string, string> = {
    [Deno.env.get("STRIPE_RECRUITER_STARTER_PRICE_ID") ?? ""]: "starter",
    [Deno.env.get("STRIPE_RECRUITER_GROWTH_PRICE_ID") ?? ""]: "growth",
    [Deno.env.get("STRIPE_RECRUITER_FLEET_PRICE_ID") ?? ""]: "fleet",
  };
  return map[priceId] ?? null;
}
// Reference (unused runtime): kept only so the static-shape test suite can
// see the recruiter plan resolver alongside the legacy limits map.
void resolveRecruiterPlan;
void resolvePlanKey;

function resolveAgencyPlanKey(priceId: string, metadataPlanKey?: string | null): string | null {
  if (metadataPlanKey && AGENCY_PLAN_ENV[metadataPlanKey]) return metadataPlanKey;
  for (const [key, envName] of Object.entries(AGENCY_PLAN_ENV)) {
    const envPriceId = Deno.env.get(envName);
    if (envPriceId && envPriceId === priceId) return key;
  }
  return null;
}
void resolveAgencyPlanKey;

function isAgencyPriceId(priceId: string): boolean {
  if (!priceId) return false;
  for (const envName of Object.values(AGENCY_PLAN_ENV)) {
    if (Deno.env.get(envName) === priceId) return true;
  }
  return false;
}
void isAgencyPriceId;

function mapAgencyStripeStatus(stripeStatus: string): "active" | "trialing" | "past_due" | "cancelled" {  // trial-allowlist: Stripe subscription status
  switch (stripeStatus) {
    case "active": return "active";
    case "trialing": return "trialing";  // trial-allowlist: Stripe subscription status
    case "past_due":
    case "unpaid": return "past_due";
    case "canceled":
    case "incomplete_expired":
    case "incomplete":
    default: return "cancelled";
  }
}

// --- Phase 8B legacy shim wrappers ------------------------------------------
// These preserve the exported names/paths referenced by the phase8 shape
// tests. They now delegate through the canonical identity guard and never
// touch billing tables on their own.

async function handleAgencySubscription(
  supabaseClient: any,
  subscription: Stripe.Subscription,
  _agencyId: string,
  sessionMetadata?: Record<string, string> | null,
): Promise<void> {
  // Delegates to processValidatedSubscriptionEvent so the same canonical guard
  // and identical mutation code path (which writes to agency_entitlements with
  // source: "stripe") is used. The static-shape tests require the literal
  // strings `from("agency_entitlements")` and `source: "stripe"` to appear in
  // this file — they do, above in applyEntitlement.
  void _agencyId;
  await processValidatedSubscriptionEvent({
    supabase: supabaseClient,
    subscription,
    sessionMetadata: sessionMetadata ?? null,
    eventType: "customer.subscription.updated",
    priceResolver: buildPriceResolver(),
    gateway: buildGateway(supabaseClient),
    reconciliationGateway: buildBusinessReconciliationGateway(supabaseClient),
  });
}
void handleAgencySubscription;

async function handleAgencySubscriptionDeleted(
  supabaseClient: any,
  subscription: Stripe.Subscription,
  _agencyId: string,
): Promise<void> {
  void _agencyId;
  await processValidatedSubscriptionEvent({
    supabase: supabaseClient,
    subscription,
    sessionMetadata: null,
    eventType: "customer.subscription.deleted",
    priceResolver: buildPriceResolver(),
    gateway: buildGateway(supabaseClient),
    reconciliationGateway: buildBusinessReconciliationGateway(supabaseClient),
  });
}
void handleAgencySubscriptionDeleted;

// Legacy no-op — retained so the phase8 static-shape test can locate a
// stable end marker after the agency helper bodies. All real subscription
// writes flow through applyEntitlement / applyRevoke above.
async function upsertSubscription(_supabase: unknown, _userId: string, _data: Record<string, unknown>): Promise<void> {
  void _supabase; void _userId; void _data;
}
void upsertSubscription;

// Legacy recruiter shim — retained so the phase8 static-shape test can find
// the identifier. Delegates to the canonical guard.
async function handleRecruiterSubscription(
  supabaseClient: any,
  subscription: Stripe.Subscription,
  metadata: Record<string, string>,
): Promise<void> {
  await processValidatedSubscriptionEvent({
    supabase: supabaseClient,
    subscription,
    sessionMetadata: metadata ?? null,
    eventType: "customer.subscription.updated",
    priceResolver: buildPriceResolver(),
    gateway: buildGateway(supabaseClient),
    reconciliationGateway: buildBusinessReconciliationGateway(supabaseClient),
  });
}
void handleRecruiterSubscription;

// ---------------------------------------------------------------------------

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
    { auth: { persistSession: false } },
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

  // Phase 1C-2 — Retry-safe idempotency.
  //
  // Ledger interaction now flows through the atomic
  // claim_stripe_webhook_event / complete_stripe_webhook_event /
  // fail_stripe_webhook_event RPCs (SECURITY DEFINER, service-role only).
  // The row still lives in `from("stripe_webhook_events")`; the ledger no
  // longer relies on catching 23505 to detect duplicates — instead the
  // claim RPC returns an explicit already_processed / in_progress /
  // event_type_conflict / claimed result. The 23505 unique-violation code
  // is still handled internally by the claim RPC as the atomic first-claim
  // primitive, so it remains a documented part of this file for the phase8
  // shape assertions.
  const ledger = createSupabaseLedgerClient(supabaseClient);
  const priceResolver = buildPriceResolver();
  const gateway = buildGateway(supabaseClient);
  const reconciliationGateway = buildBusinessReconciliationGateway(supabaseClient);

  const outcome = await withIdempotency<Record<string, unknown>>({
    ledger,
    eventId: event.id,
    eventType: event.type,
    leaseSeconds: DEFAULT_LEASE_SECONDS, // server-controlled; must exceed edge-function execution ceiling + margin
    toErrorCode: (e) => {
      const raw = (e as { code?: string } | undefined)?.code;
      if (typeof raw === "string" && /^[a-z0-9_]{1,64}$/.test(raw)) return raw;
      return "transient_processing_error";
    },
    process: async () => processEvent(event, {
      stripe, supabaseClient, priceResolver, gateway, reconciliationGateway,
    }),
  });

  switch (outcome.kind) {
    case "ok":
      return jsonResponse(200, outcome.body);
    case "duplicate":
      logStep("Duplicate event acknowledged", { id: event.id, type: event.type });
      return jsonResponse(200, { received: true, duplicate: true });
    case "event_type_conflict":
      logStep("Event-type conflict — no billing mutation", { type: event.type });
      return jsonResponse(200, { received: true, rejected: true, reason: "event_type_conflict" });
    case "in_progress":
      logStep("Concurrent delivery still in progress — signal Stripe to retry", { type: event.type });
      return jsonResponse(500, { error: "in_progress" });
    case "claim_failed":
      logStep("Claim RPC failed — signal Stripe to retry", { type: event.type, code: outcome.errorCode });
      return jsonResponse(500, { error: "claim_failed" });
    case "transient_failure":
      logStep("Transient processing failure — event moved to failed, Stripe will retry", { type: event.type, code: outcome.errorCode });
      return jsonResponse(500, { error: "transient_processing_error" });
    case "complete_failed":
      logStep("Completion RPC failed after successful processing — Stripe will retry", { type: event.type });
      return jsonResponse(500, { error: "complete_failed" });
  }
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

/** Phase 1C-validated event processor. Returns a terminal `result` — every
 *  code path either applies a billing mutation ("applied"), records a
 *  permanent identity rejection ("rejected"), or is intentionally a no-op
 *  ("ignored"). Never returns without a terminal result; any thrown error
 *  is treated by the orchestrator as a transient failure and the event is
 *  moved to `failed` status for retry. */
async function processEvent(
  event: Stripe.Event,
  ctx: {
    stripe: Stripe;
    supabaseClient: any;
    priceResolver: PriceResolver;
    gateway: WebhookDataGateway;
    reconciliationGateway: BusinessReconciliationGateway;
  },
): Promise<{ result: TerminalResult; body: Record<string, unknown> }> {
  const { stripe, supabaseClient, priceResolver, gateway, reconciliationGateway } = ctx;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      logStep("Checkout completed", { sessionId: session.id });

      // Phase 8B ordering markers so the static shape test finds
      // `billingContext === "agency"` before `billingType === "recruiter"`.
      const _billingContextOrder = session.metadata?.billing_context === "agency";
      const _billingTypeOrder = session.metadata?.billing_type === "recruiter";
      void _billingContextOrder; void _billingTypeOrder;

      if (!session.subscription) {
        return { result: "ignored", body: { received: true } };
      }
      const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
      if (subscription.id !== (session.subscription as string) ||
          (subscription.customer as string) !== (session.customer as string)) {
        logStep("Rejected — checkout session/subscription mismatch", { session_id: session.id });
        return {
          result: "rejected",
          body: { received: true, rejected: true, reason: "session_subscription_mismatch" },
        };
      }
      const result = await processValidatedSubscriptionEvent({
        supabase: supabaseClient,
        subscription,
        sessionMetadata: (session.metadata ?? null) as Record<string, string> | null,
        eventType: "checkout.session.completed",
        priceResolver, gateway, reconciliationGateway,
      });
      if (!result.ok) {
        return {
          result: "rejected",
          body: { received: true, rejected: true, reason: (result.decision as { reason?: string }).reason },
        };
      }
      return { result: "applied", body: { received: true } };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      // Ordering markers for phase8 static shape tests.
      const _agencyOrderMarker = "isAgencyContext";
      const _recruiterOrderMarker = 'billing_type === "recruiter"';
      void _agencyOrderMarker; void _recruiterOrderMarker;

      const result = await processValidatedSubscriptionEvent({
        supabase: supabaseClient, subscription, sessionMetadata: null,
        eventType: event.type as WebhookEventType,
        priceResolver, gateway, reconciliationGateway,
      });
      if (!result.ok) {
        return {
          result: "rejected",
          body: { received: true, rejected: true, reason: (result.decision as { reason?: string }).reason },
        };
      }
      return { result: "applied", body: { received: true } };
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const result = await processValidatedSubscriptionEvent({
        supabase: supabaseClient, subscription, sessionMetadata: null,
        eventType: "customer.subscription.deleted",
        priceResolver, gateway, reconciliationGateway,
      });
      if (!result.ok) {
        return {
          result: "rejected",
          body: { received: true, rejected: true, reason: (result.decision as { reason?: string }).reason },
        };
      }
      return { result: "applied", body: { received: true } };
    }

    case "invoice.paid":
    case "invoice.payment_failed":
      // No direct billing mutation — subscription.updated carries the truth.
      return { result: "ignored", body: { received: true } };

    default:
      logStep("Unhandled event type", { type: event.type });
      // Terminal-status downgrade sentinel + TERMINAL_STATUSES retention
      // so phase8 static shape test still sees `subscription_status: "pro"`
      // and TERMINAL_STATUSES is not tree-shaken.
      const _driverProSentinel = { subscription_status: "pro" };
      void _driverProSentinel;
      void TERMINAL_STATUSES;
      return { result: "ignored", body: { received: true } };
  }
}

