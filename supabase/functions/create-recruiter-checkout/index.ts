import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (s: string, d?: Record<string, unknown>) =>
  console.log(`[CREATE-RECRUITER-CHECKOUT] ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);

const PLAN_TO_ENV: Record<string, string> = {
  starter: "STRIPE_RECRUITER_STARTER_PRICE_ID",
  growth: "STRIPE_RECRUITER_GROWTH_PRICE_ID",
  fleet: "STRIPE_RECRUITER_FLEET_PRICE_ID",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );
    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(token);
    if (userErr) throw new Error(`Auth error: ${userErr.message}`);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated");

    const body = await req.json();
    const plan = String(body.plan || "");
    if (!PLAN_TO_ENV[plan]) {
      return new Response(JSON.stringify({ error: `Invalid plan: ${plan}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const priceId = Deno.env.get(PLAN_TO_ENV[plan]);
    if (!priceId) {
      return new Response(JSON.stringify({ error: `Price not configured for plan: ${plan}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Recruiter must exist + be approved
    const { data: recruiter, error: rErr } = await supabaseService
      .from("recruiter_profiles")
      .select("id, user_id, verification_status, status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!recruiter) throw new Error("Recruiter profile not found");
    if (recruiter.status === "suspended" || recruiter.verification_status === "suspended") {
      throw new Error("Recruiter account suspended");
    }
    if (recruiter.verification_status !== "approved") {
      throw new Error("Recruiter profile must be approved before subscribing");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Look up existing recruiter billing row for customer isolation
    const { data: billingRow } = await supabaseService
      .from("recruiter_billing_profiles")
      .select("stripe_customer_id")
      .eq("recruiter_id", recruiter.id)
      .maybeSingle();

    let customerId = billingRow?.stripe_customer_id ?? null;

    if (!customerId) {
      const c = await stripe.customers.create({
        email: user.email,
        metadata: {
          billing_type: "recruiter",
          user_id: user.id,
          recruiter_id: recruiter.id,
        },
      });
      customerId = c.id;

      // Persist the recruiter-specific customer ID so future checkouts reuse it
      await supabaseService
        .from("recruiter_billing_profiles")
        .upsert(
          {
            recruiter_id: recruiter.id,
            user_id: user.id,
            stripe_customer_id: customerId,
          },
          { onConflict: "recruiter_id" },
        );
    }

    const ALLOWED = new Set([
      "https://haultrackerpro.com",
      "https://www.haultrackerpro.com",
      "https://haultrackerpro.lovable.app",
    ]);
    const reqOrigin = req.headers.get("origin") ?? "";
    const origin = ALLOWED.has(reqOrigin) ? reqOrigin : "https://haultrackerpro.com";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${origin}/?recruiter_checkout=success`,
      cancel_url: `${origin}/?recruiter_checkout=cancel`,
      metadata: {
        user_id: user.id,
        recruiter_id: recruiter.id,
        billing_type: "recruiter",
        plan,
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          recruiter_id: recruiter.id,
          billing_type: "recruiter",
          plan,
        },
      },
    });

    log("session created", { sessionId: session.id, plan });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
