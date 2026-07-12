import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import {
  resolveDriverPlanKey,
  resolveDriverStripeCustomerId,
  DriverBillingConflictError,
} from "../_shared/driver-billing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CHECK-SUBSCRIPTION] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseService = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* no body is fine */ }
    if (body?.action === "expire_trials") {
      logStep("expire_trials called but trials are removed — no-op");
      return json({ ok: true, deprecated: true }, 200);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ subscribed: false }, 200);
    }

    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAnon.auth.getUser(token);
    if (userError) {
      logStep("Auth failed, returning unsubscribed", { message: userError.message });
      return json({ subscribed: false }, 200);
    }
    const user = userData.user;
    if (!user) throw new Error("User not authenticated");
    logStep("User authenticated", { userId: user.id });

    // Manual override check happens first and can short-circuit below.
    const { data: existingSub } = await supabaseService
      .from("subscriptions")
      .select("status, plan_key, stripe_customer_id, stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: profile } = await supabaseService
      .from("profiles")
      .select("subscription_status")
      .eq("user_id", user.id)
      .maybeSingle();

    const hasManualOverride = existingSub?.status === "active" || profile?.subscription_status === "pro";

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    let customerId: string | null;
    try {
      customerId = await resolveDriverStripeCustomerId(supabaseService, stripe, user.id);
    } catch (e) {
      if (e instanceof DriverBillingConflictError) {
        logStep("Driver billing conflict detected — failing closed, preserving stored state", { message: e.message });
        return json({ subscribed: hasManualOverride, conflict: true }, 200);
      }
      throw e;
    }

    if (!customerId) {
      logStep("No driver Stripe customer on file");
      if (hasManualOverride) {
        logStep("Manual override found, preserving");
        return json({ subscribed: true }, 200);
      }
      return json({ subscribed: false }, 200);
    }

    let subscription: Stripe.Subscription | undefined;
    if (existingSub?.stripe_subscription_id) {
      try {
        subscription = await stripe.subscriptions.retrieve(existingSub.stripe_subscription_id);
      } catch (e) {
        logStep("Stored subscription id could not be retrieved", { message: e instanceof Error ? e.message : String(e) });
      }
    }
    if (!subscription) {
      const subs = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 1 });
      subscription = subs.data[0];
    }

    // Never treat a recruiter/agency-tagged subscription as driver entitlement.
    if (subscription && subscription.metadata?.billing_context && subscription.metadata.billing_context !== "driver") {
      logStep("Ignoring non-driver subscription found on driver customer", { billingContext: subscription.metadata.billing_context });
      subscription = undefined;
    }

    if (subscription) {
      const priceId = subscription.items.data[0]?.price?.id || "";
      const planKey = resolveDriverPlanKey(priceId);

      if (subscription.status === "active" && !planKey) {
        logStep("Active subscription uses an unrecognized price — not granting Pro", { priceId });
        return json({ subscribed: hasManualOverride }, 200);
      }

      const hasActiveSub = subscription.status === "active";
      const subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();
      const subscriptionStart = new Date(subscription.current_period_start * 1000).toISOString();
      const trialStart = subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null;
      const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;
      const productId = subscription.items.data[0]?.price?.product ?? null;

      await supabaseService.from("subscriptions").upsert({
        user_id: user.id,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        stripe_price_id: priceId,
        plan_key: planKey ?? "free",
        status: subscription.status,
        cancel_at_period_end: subscription.cancel_at_period_end,
        current_period_start: subscriptionStart,
        current_period_end: subscriptionEnd,
        trial_start: trialStart,
        trial_end: trialEnd,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

      await supabaseService.from("profiles").update({
        subscription_status: (hasActiveSub || hasManualOverride) ? "pro" : "free",
        subscription_plan: planKey,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        subscription_expires_at: subscriptionEnd,
      }).eq("user_id", user.id);

      logStep("Subscription synced", { status: subscription.status, planKey });
      return json({ subscribed: hasActiveSub || hasManualOverride, product_id: productId, subscription_end: subscriptionEnd }, 200);
    }

    if (hasManualOverride) {
      logStep("Manual override found, preserving status despite no live Stripe subscription");
      return json({ subscribed: true }, 200);
    }

    await supabaseService.from("subscriptions").upsert({
      user_id: user.id,
      stripe_customer_id: customerId,
      plan_key: "free",
      status: "free",
      cancel_at_period_end: false,
      stripe_subscription_id: null,
      stripe_price_id: null,
      current_period_start: null,
      current_period_end: null,
      trial_start: null,
      trial_end: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    await supabaseService.from("profiles").update({
      subscription_status: "free",
      subscription_plan: null,
      stripe_subscription_id: null,
      subscription_expires_at: null,
      stripe_customer_id: customerId,
    }).eq("user_id", user.id);

    return json({ subscribed: false }, 200);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return json({ error: "Unable to check subscription status." }, 500);
  }
});
