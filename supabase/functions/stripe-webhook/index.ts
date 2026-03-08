import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  console.log(`[STRIPE-WEBHOOK] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

/** Resolve plan_key from a Stripe price ID */
function resolvePlanKey(priceId: string): string {
  const monthlyPriceId = Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID");
  const yearlyPriceId = Deno.env.get("STRIPE_PRO_YEARLY_PRICE_ID");
  if (priceId === monthlyPriceId) return "pro_monthly";
  if (priceId === yearlyPriceId) return "pro_yearly";
  // Fallback for legacy or unknown price IDs — treat as pro
  return "pro_monthly";
}

/** Upsert the subscriptions table row */
async function upsertSubscription(
  supabaseClient: any,
  userId: string,
  data: {
    stripe_customer_id?: string;
    stripe_subscription_id?: string;
    stripe_price_id?: string;
    plan_key: string;
    status: string;
    cancel_at_period_end?: boolean;
    current_period_start?: string | null;
    current_period_end?: string | null;
    trial_start?: string | null;
    trial_end?: string | null;
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

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        logStep("Checkout completed", { sessionId: session.id, customerId: session.customer, subscriptionId: session.subscription });

        const userId = session.metadata?.user_id;
        if (userId && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          const priceId = subscription.items.data[0]?.price?.id || "";
          const planKey = session.metadata?.plan_key || resolvePlanKey(priceId);
          const subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();
          const subscriptionStart = new Date(subscription.current_period_start * 1000).toISOString();
          const trialStart = subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null;
          const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;

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
            trial_start: trialStart,
            trial_end: trialEnd,
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
        const planKey = resolvePlanKey(priceId);
        const isActive = subscription.status === "active" || subscription.status === "trialing";
        const subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();
        const subscriptionStart = new Date(subscription.current_period_start * 1000).toISOString();
        const trialStart = subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null;
        const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;

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
            trial_start: trialStart,
            trial_end: trialEnd,
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
            trial_start: trialStart,
            trial_end: trialEnd,
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
            trial_start: trialStart,
            trial_end: trialEnd,
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        logStep("Subscription deleted", { subscriptionId: subscription.id });

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
            trial_start: null,
            trial_end: null,
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
