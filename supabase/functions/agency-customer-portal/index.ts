// Phase 8B — Agency Stripe customer portal.
//
// Owner-only. Uses the agency-isolated customer ID stored on
// agency_entitlements (never the driver/recruiter customers).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_ORIGINS = new Set([
  "https://haultrackerpro.com",
  "https://www.haultrackerpro.com",
  "https://haultrackerpro.lovable.app",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set");

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

    const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr) throw new Error(userErr.message);
    const user = userData.user;
    if (!user) throw new Error("Not authenticated");

    const body = await req.json().catch(() => ({}));
    const agencyId = String(body.agencyId ?? "");
    if (!agencyId) return json({ error: "agencyId is required" }, 400);

    // Canonical agency billing owner: agency_profiles.owner_user_id must equal
    // the authenticated user, AND that user must hold an ACTIVE agency_owner
    // membership for the same agency. Email is never an ownership key.
    const { data: agency } = await supabaseService
      .from("agency_profiles")
      .select("id, owner_user_id")
      .eq("id", agencyId)
      .maybeSingle();
    if (!agency || agency.owner_user_id !== user.id) {
      return json({ error: "Only the agency owner can manage billing" }, 403);
    }

    const { data: ownerRow } = await supabaseService
      .from("agency_members")
      .select("role, status")
      .eq("agency_id", agencyId)
      .eq("member_user_id", user.id)
      .maybeSingle();
    if (!ownerRow || ownerRow.status !== "active" || ownerRow.role !== "agency_owner") {
      return json({ error: "Only the agency owner can manage billing" }, 403);
    }

    const { data: ent } = await supabaseService
      .from("agency_entitlements")
      .select("stripe_customer_id")
      .eq("agency_id", agencyId)
      .maybeSingle();

    const customerId = ent?.stripe_customer_id ?? null;
    if (!customerId) {
      return json({
        error: "Agency billing has not been started yet. Start agency billing first.",
      }, 400);
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const reqOrigin = req.headers.get("origin") ?? "";
    const origin = ALLOWED_ORIGINS.has(reqOrigin) ? reqOrigin : "https://haultrackerpro.com";

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/agency`,
    });
    return json({ url: portal.url }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
