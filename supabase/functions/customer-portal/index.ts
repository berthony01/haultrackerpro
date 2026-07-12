import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { resolveDriverStripeCustomerId, DriverBillingConflictError } from "../_shared/driver-billing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAnon.auth.getUser(token);
    if (userError) throw new Error("Authentication error");
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");

    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    let customerId: string | null;
    try {
      customerId = await resolveDriverStripeCustomerId(supabaseService, stripe, user.id);
    } catch (e) {
      if (e instanceof DriverBillingConflictError) {
        console.error("[customer-portal] driver billing conflict", { userId: user.id, message: e.message });
        return json({ error: "Unable to open billing portal due to a billing account conflict. Please contact support." }, 409);
      }
      throw e;
    }

    if (!customerId) {
      return json({ error: "No billing account found for this driver." }, 404);
    }

    const reqOrigin = req.headers.get("origin") ?? "";
    const origin = ALLOWED_ORIGINS.has(reqOrigin) ? reqOrigin : "https://haultrackerpro.com";

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/`,
    });

    return json({ url: portalSession.url }, 200);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[customer-portal] error", msg);
    return json({ error: "Unable to open billing portal. Please try again or contact support." }, 500);
  }
});
