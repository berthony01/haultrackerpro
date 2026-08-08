import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr) throw new Error(userErr.message);
    const user = userData.user;
    if (!user) throw new Error("Not authenticated");

    // Resolve the caller's recruiter BUSINESS identity from the auth user id.
    // recruiter_email / auth email are never ownership or lookup keys.
    const { data: recruiter } = await supabase
      .from("recruiter_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    const recruiterId = recruiter?.id ?? null;
    if (!recruiterId) {
      throw new Error("Recruiter profile not found. Please complete recruiter setup first.");
    }

    const { data: billing } = await supabase
      .from("recruiter_billing_profiles")
      .select("stripe_customer_id")
      .eq("recruiter_id", recruiterId)
      .eq("user_id", user.id)
      .maybeSingle();

    const customerId = billing?.stripe_customer_id ?? null;
    if (!customerId) {
      throw new Error("Recruiter billing customer not found. Please start a recruiter subscription first.");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const ALLOWED = new Set([
      "https://haultrackerpro.com",
      "https://www.haultrackerpro.com",
      "https://haultrackerpro.lovable.app",
    ]);
    const reqOrigin = req.headers.get("origin") ?? "";
    const origin = ALLOWED.has(reqOrigin) ? reqOrigin : "https://haultrackerpro.com";

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/`,
    });
    return new Response(JSON.stringify({ url: portal.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
