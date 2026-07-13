import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import {
  DRIVER_PLAN_PRICE_ENV,
  getDriverPriceAllowlist,
  resolveOrCreateDriverStripeCustomerId,
  DriverBillingConflictError,
  type DriverPriceConfig,
} from "../_shared/driver-billing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-CHECKOUT] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const ALLOWED_ORIGINS = new Set([
  "https://haultrackerpro.com",
  "https://www.haultrackerpro.com",
  "https://haultrackerpro.lovable.app",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    // Read once here — this is the only place in this file that reads
    // process-wide environment state for driver price configuration. The
    // shared billing module receives it explicitly and never reads Deno.env
    // itself.
    const driverPriceConfig: DriverPriceConfig = {
      pro_monthly: Deno.env.get(DRIVER_PLAN_PRICE_ENV.pro_monthly),
      pro_yearly: Deno.env.get(DRIVER_PLAN_PRICE_ENV.pro_yearly),
    };

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    // Authenticate BEFORE any service-role database operations.
    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseAnon.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id });

    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const body = await req.json();
    let priceId: string | undefined;
    const planKey = body.planKey as string | undefined;

    if (planKey) {
      const envVar = DRIVER_PLAN_PRICE_ENV[planKey];
      if (!envVar) {
        return json({ error: `Invalid plan key: ${planKey}` }, 400);
      }
      priceId = Deno.env.get(envVar);
      if (!priceId) {
        return json({ error: `Price ID not configured for plan: ${planKey}` }, 500);
      }
      logStep("Resolved plan key to price ID", { planKey });
    } else if (body.priceId) {
      const candidate = body.priceId as string;
      const allowedPriceIds = getDriverPriceAllowlist(driverPriceConfig);
      if (!allowedPriceIds.includes(candidate)) {
        logStep("Rejected unknown legacy priceId", { priceId: candidate });
        return json({ error: "Invalid price ID" }, 400);
      }
      priceId = candidate;
    }

    if (!priceId) {
      return json({ error: "planKey or priceId is required" }, 400);
    }
    logStep("Price ID received");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    let customerId: string;
    try {
      customerId = await resolveOrCreateDriverStripeCustomerId(supabaseService, stripe, user.id, user.email, driverPriceConfig);
    } catch (e) {
      if (e instanceof DriverBillingConflictError) {
        logStep("Driver billing conflict — refusing checkout", { message: e.message });
        return json({ error: "Unable to start checkout due to a billing account conflict. Please contact support." }, 409);
      }
      throw e;
    }
    logStep("Resolved driver Stripe customer", { customerId });

    // Prevent double subscription — checked ONLY on the dedicated driver
    // customer, never influenced by any recruiter/agency subscription that
    // might exist under the same email.
    const [activeSubs, trialSubs, pastDueSubs] = await Promise.all([
      stripe.subscriptions.list({ customer: customerId, status: "active", limit: 1 }),
      stripe.subscriptions.list({ customer: customerId, status: "trialing", limit: 1 }), // trial-allowlist
      stripe.subscriptions.list({ customer: customerId, status: "past_due", limit: 1 }),
    ]);
    if (activeSubs.data.length > 0 || trialSubs.data.length > 0 || pastDueSubs.data.length > 0) {
      logStep("User already has a non-terminal driver subscription");
      return json({ error: "You already have an active subscription. Manage it from your account settings." }, 400);
    }

    const reqOrigin = req.headers.get("origin") ?? "";
    const origin = ALLOWED_ORIGINS.has(reqOrigin) ? reqOrigin : "https://haultrackerpro.com";

    const metadata = { billing_context: "driver", user_id: user.id, plan_key: planKey || "legacy" };

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/pricing`,
      metadata,
      subscription_data: { metadata },
    });

    logStep("Checkout session created", { sessionId: session.id });

    return json({ url: session.url }, 200);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return json({ error: "Unable to start checkout. Please try again or contact support." }, 500);
  }
});
