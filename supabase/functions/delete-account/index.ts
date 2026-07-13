// Phase 1B-1 — thin Deno Edge Function adapter. All deletion/cancellation
// orchestration logic lives in ../_shared/account-deletion.ts (Deno-neutral,
// directly unit-tested by src/test/phase1aDriverBillingResolution.test.ts).
// This file's only job: read environment variables, construct the real
// Supabase and Stripe clients, authenticate the caller, call the shared
// orchestration, delete the auth user last, and format the HTTP response.
// This file is never imported by Vitest, so it is free to use static
// Deno-only URL imports exactly like the other edge functions in this repo.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { performAccountDeletion, GENERIC_DELETE_ERROR, type DeletionDeps } from "../_shared/account-deletion.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function clientError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return clientError(401, "Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      if (userError) console.error("[delete-account] auth.getUser failed:", userError);
      return clientError(401, "Unauthorized");
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      console.error("[delete-account] STRIPE_SECRET_KEY not configured; refusing to delete an account with unverifiable billing state");
      return clientError(500, GENERIC_DELETE_ERROR);
    }
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const driverPriceConfig = {
      pro_monthly: Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID"),
      pro_yearly: Deno.env.get("STRIPE_PRO_YEARLY_PRICE_ID"),
    };

    const deps: DeletionDeps = { adminClient, stripe, userId: user.id, driverPriceConfig };
    const result = await performAccountDeletion(deps);
    if (result.ok === false) {
      return clientError(result.status, result.message);
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error(`[delete-account] user=${user.id} auth.admin.deleteUser failed:`, deleteError);
      return clientError(500, "Unable to complete account deletion at this time.");
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[delete-account] unexpected error:", err);
    return clientError(500, GENERIC_DELETE_ERROR);
  }
});
