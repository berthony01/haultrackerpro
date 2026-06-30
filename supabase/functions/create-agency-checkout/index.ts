// Phase 8B — Agency Stripe checkout.
//
// Extends the existing HaulTracker Pro custom Stripe edge function pattern
// (driver `create-checkout` + recruiter `create-recruiter-checkout`) for a
// third, fully isolated billing context: agencies.
//
// Hard rules:
//   - Only the agency_owner of the requested agency may start checkout.
//   - planKey must be exactly agency_starter|agency_team|agency_growth and
//     is mapped to a price ID server-side from env vars. Client-supplied
//     price IDs are never accepted.
//   - The agency's Stripe customer is stored only on
//     agency_entitlements.stripe_customer_id and is never reused for driver
//     or recruiter billing.
//   - Subscription / session metadata always carries billing_context="agency"
//     plus agency_id and owner_user_id so the shared webhook can route
//     deterministically.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (s: string, d?: Record<string, unknown>) =>
  console.log(`[CREATE-AGENCY-CHECKOUT] ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);

const AGENCY_PLAN_TO_ENV: Record<string, string> = {
  agency_starter: "STRIPE_AGENCY_STARTER_PRICE_ID",
  agency_team: "STRIPE_AGENCY_TEAM_PRICE_ID",
  agency_growth: "STRIPE_AGENCY_GROWTH_PRICE_ID",
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

    const body = await req.json().catch(() => ({}));
    const agencyId = String(body.agencyId ?? "");
    const planKey = String(body.planKey ?? "");

    if (!agencyId) {
      return json({ error: "agencyId is required" }, 400);
    }
    if (!AGENCY_PLAN_TO_ENV[planKey]) {
      return json({ error: `Invalid plan key: ${planKey}` }, 400);
    }
    // Reject any client-supplied priceId to prevent arbitrary checkout.
    if ("priceId" in body || "price_id" in body || "price" in body) {
      return json({ error: "Client-supplied price IDs are not allowed" }, 400);
    }

    const priceId = Deno.env.get(AGENCY_PLAN_TO_ENV[planKey]);
    if (!priceId) {
      log("Price env missing", { planKey });
      return json({ error: `Price not configured for plan: ${planKey}` }, 500);
    }

    // Agency must exist and caller must be the owner.
    const { data: agency, error: aErr } = await supabaseService
      .from("agency_profiles")
      .select("id, name")
      .eq("id", agencyId)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!agency) return json({ error: "Agency not found" }, 404);

    const { data: ownerRow, error: mErr } = await supabaseService
      .from("agency_members")
      .select("id, role, status")
      .eq("agency_id", agencyId)
      .eq("member_user_id", user.id)
      .maybeSingle();
    if (mErr) throw new Error(mErr.message);
    if (!ownerRow || ownerRow.status !== "active" || ownerRow.role !== "agency_owner") {
      return json({ error: "Only the agency owner can manage billing" }, 403);
    }

    // Look up existing entitlement row (Phase 7 may have a manual_beta row,
    // or no row at all). Block when an active/trialing/past_due Stripe sub  // trial-allowlist: Stripe subscription status
    // already exists.
    const { data: ent } = await supabaseService
      .from("agency_entitlements")
      .select("id, status, stripe_customer_id, stripe_subscription_id")
      .eq("agency_id", agencyId)
      .maybeSingle();

    if (ent?.stripe_subscription_id && ["active", "trialing", "past_due"].includes(ent.status)) {  // trial-allowlist: Stripe subscription status
      return json({
        error: "Agency already has an active billing subscription. Use the customer portal to manage it.",
      }, 400);
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Reuse agency-isolated customer if present; otherwise create one tagged
    // with agency metadata so we never accidentally collide with driver
    // (looked up by email) or recruiter customers.
    let customerId = ent?.stripe_customer_id ?? null;
    if (!customerId) {
      const c = await stripe.customers.create({
        email: user.email,
        name: agency.name ?? undefined,
        metadata: {
          billing_context: "agency",
          agency_id: agencyId,
          owner_user_id: user.id,
        },
      });
      customerId = c.id;

      // Persist immediately so a retried checkout reuses it.
      await supabaseService
        .from("agency_entitlements")
        .upsert(
          {
            agency_id: agencyId,
            stripe_customer_id: customerId,
            // Don't touch plan/status here — webhook owns the lifecycle.
            updated_at: new Date().toISOString(),
          },
          { onConflict: "agency_id" },
        );
    }

    const reqOrigin = req.headers.get("origin") ?? "";
    const origin = ALLOWED_ORIGINS.has(reqOrigin) ? reqOrigin : "https://haultrackerpro.com";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${origin}/agency?billing=success`,
      cancel_url: `${origin}/agency?billing=cancelled`,
      metadata: {
        billing_context: "agency",
        agency_id: agencyId,
        owner_user_id: user.id,
        plan_key: planKey,
      },
      subscription_data: {
        metadata: {
          billing_context: "agency",
          agency_id: agencyId,
          owner_user_id: user.id,
          plan_key: planKey,
        },
      },
    });

    log("session created", { sessionId: session.id, agencyId, planKey });
    return json({ url: session.url }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", { message: msg });
    return json({ error: msg }, 500);
  }
});

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
