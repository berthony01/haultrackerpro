import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CHECK-SUBSCRIPTION] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

/** Resolve plan_key from a Stripe price ID */
function resolvePlanKey(priceId: string): string {
  const monthlyPriceId = Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID");
  const yearlyPriceId = Deno.env.get("STRIPE_PRO_YEARLY_PRICE_ID");
  if (priceId === monthlyPriceId) return "pro_monthly";
  if (priceId === yearlyPriceId) return "pro_yearly";
  return "pro_monthly";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    // Handle cron-triggered trial expiry
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* no body is fine */ }
    if (body?.action === "expire_trials") {
      logStep("Running expire_ended_trials via cron");
      const { error: expireErr } = await supabaseClient.rpc("expire_ended_trials");
      if (expireErr) logStep("expire_ended_trials error", { message: expireErr.message });
      else logStep("expire_ended_trials completed");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ subscribed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) {
      logStep("Auth failed, returning unsubscribed", { message: userError.message });
      return new Response(JSON.stringify({ subscribed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    // Check for manual override in subscriptions table first
    const { data: existingSub } = await supabaseClient
      .from("subscriptions")
      .select("status, plan_key")
      .eq("user_id", user.id)
      .maybeSingle();

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });

    if (customers.data.length === 0) {
      logStep("No Stripe customer found");
      // Check for manual override
      if (existingSub?.status === "active" || existingSub?.status === "trialing") {
        logStep("Manual override found in subscriptions table, preserving");
        return new Response(JSON.stringify({ subscribed: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }
      // Also check profiles for legacy manual overrides
      const { data: profile } = await supabaseClient
        .from("profiles")
        .select("subscription_status")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profile?.subscription_status === "pro") {
        logStep("Manual pro override found in profiles, preserving");
        return new Response(JSON.stringify({ subscribed: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      return new Response(JSON.stringify({ subscribed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const customerId = customers.data[0].id;
    logStep("Found Stripe customer", { customerId });

    const activeSubscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });

    const trialingSubscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "trialing",
      limit: 1,
    });

    const subscription = activeSubscriptions.data[0] || trialingSubscriptions.data[0];
    const hasActiveSub = !!subscription;
    let subscriptionEnd = null;
    let productId = null;

    if (hasActiveSub) {
      const priceId = subscription.items.data[0]?.price?.id || "";
      const planKey = resolvePlanKey(priceId);
      subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();
      const subscriptionStart = new Date(subscription.current_period_start * 1000).toISOString();
      const trialStart = subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null;
      const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;
      productId = subscription.items.data[0].price.product;
      const isTrial = subscription.status === "trialing";
      logStep("Subscription found", { subscriptionId: subscription.id, status: subscription.status, isTrial, productId, endDate: subscriptionEnd });

      // Upsert subscriptions table
      await supabaseClient
        .from("subscriptions")
        .upsert({
          user_id: user.id,
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
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

      // Backward compat profiles
      await supabaseClient.from("profiles").update({
        subscription_status: "pro",
        subscription_plan: planKey,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        subscription_expires_at: subscriptionEnd,
      }).eq("user_id", user.id);
    } else {
      logStep("No active or trialing subscription");
      // Check for manual override before resetting
      if (existingSub?.status === "active" || existingSub?.status === "trialing") {
        logStep("Manual override found, preserving status");
        return new Response(JSON.stringify({ subscribed: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }
      const { data: profile } = await supabaseClient
        .from("profiles")
        .select("subscription_status")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profile?.subscription_status === "pro") {
        logStep("Manual pro override in profiles, preserving");
        return new Response(JSON.stringify({ subscribed: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      // Reset both tables
      await supabaseClient
        .from("subscriptions")
        .upsert({
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

      await supabaseClient.from("profiles").update({
        subscription_status: "free",
        subscription_plan: null,
        stripe_subscription_id: null,
        subscription_expires_at: null,
        stripe_customer_id: customerId,
      }).eq("user_id", user.id);
    }

    return new Response(JSON.stringify({
      subscribed: hasActiveSub,
      product_id: productId,
      subscription_end: subscriptionEnd,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
