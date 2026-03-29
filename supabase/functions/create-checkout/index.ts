import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: any) => {
  console.log(`[CREATE-CHECKOUT] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

/** Map plan keys to environment variable names for price IDs */
const PLAN_KEY_TO_ENV: Record<string, string> = {
  pro_monthly: "STRIPE_PRO_MONTHLY_PRICE_ID",
  pro_yearly: "STRIPE_PRO_YEARLY_PRICE_ID",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    const body = await req.json();
    // Support both planKey (new) and priceId (legacy)
    let priceId: string | undefined;
    const planKey = body.planKey as string | undefined;

    if (planKey) {
      const envVar = PLAN_KEY_TO_ENV[planKey];
      if (!envVar) {
        return new Response(JSON.stringify({ error: `Invalid plan key: ${planKey}` }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
      priceId = Deno.env.get(envVar);
      if (!priceId) {
        return new Response(JSON.stringify({ error: `Price ID not configured for plan: ${planKey}` }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
      logStep("Resolved plan key to price ID", { planKey, priceId });
    } else if (body.priceId) {
      // Legacy support — validate against known price IDs
      priceId = body.priceId as string;
      const knownPriceIds = Object.values(PLAN_KEY_TO_ENV)
        .map((env) => Deno.env.get(env))
        .filter(Boolean);
      if (!knownPriceIds.includes(priceId)) {
        logStep("Warning: legacy priceId not in known list", { priceId });
        // Still allow — backward compat
      }
    }

    if (!priceId) {
      return new Response(JSON.stringify({ error: "planKey or priceId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    logStep("Price ID received", { priceId });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Existing Stripe customer found", { customerId });

      // Prevent double subscription
      const activeSubs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
      const trialSubs = await stripe.subscriptions.list({ customer: customerId, status: 'trialing', limit: 1 });
      if (activeSubs.data.length > 0 || trialSubs.data.length > 0) {
        logStep("User already has active/trialing subscription");
        return new Response(JSON.stringify({ error: "You already have an active subscription. Manage it from your account settings." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
    }

    const origin = req.headers.get("origin") || "https://haultrackerpro.com";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      subscription_data: {
        trial_period_days: 14,
      },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/pricing`,
      metadata: { user_id: user.id, plan_key: planKey || "legacy" },
    });

    logStep("Checkout session created", { sessionId: session.id });

    return new Response(JSON.stringify({ url: session.url }), {
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
