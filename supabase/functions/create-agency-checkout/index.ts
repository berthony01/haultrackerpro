// Phase 1R-D1 — Agency Checkout edge adapter.
//
// Thin adapter around the runtime-neutral orchestrator in
// ../_shared/agency-checkout.ts. Responsibilities:
//   - authenticate the caller (JWT validated in code)
//   - map planKey → price ID from env (client price IDs are never accepted)
//   - require an existing agency and an ACTIVE agency_owner membership
//   - strictly reject non-allowlisted origins (no production fallback)
//   - run the pure cross-context guard against recruiter billing BEFORE any
//     Stripe construction or orchestrator call
//   - build injected store/gateway/clock adapters and delegate
//
// The adapter never owns the create-customer/create-session flow directly and
// never logs or returns raw dependency errors, IDs, URLs, or emails.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

import { evaluateAgencyCheckoutCrossContext } from "../_shared/business-checkout-guard.ts";
import {
  isAgencyPlanKey,
  isAllowedAgencyOrigin,
  runAgencyCheckout,
  type AgencyCheckoutDeps,
  type AgencyCheckoutResult,
  type AgencyClock,
  type AgencyCustomerLike,
  type AgencyEntitlementStore,
  type AgencyPlanKey,
  type AgencySessionLike,
  type AgencyStripeGateway,
  type AgencySubscriptionLike,
} from "../_shared/agency-checkout.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (s: string, d?: Record<string, unknown>) =>
  console.log(`[CREATE-AGENCY-CHECKOUT] ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);

const AGENCY_PLAN_TO_ENV: Record<AgencyPlanKey, string> = {
  agency_starter: "STRIPE_AGENCY_STARTER_PRICE_ID",
  agency_team: "STRIPE_AGENCY_TEAM_PRICE_ID",
  agency_growth: "STRIPE_AGENCY_GROWTH_PRICE_ID",
};

function jsonResponse(result: AgencyCheckoutResult): Response {
  const body: Record<string, unknown> = {
    code: result.code,
    message: result.message,
  };
  if (result.url) body.url = result.url;
  return new Response(JSON.stringify(body), {
    status: result.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return jsonResponse({
        status: 500,
        code: "internal_error",
        message: "Billing is not configured.",
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse({
        status: 401,
        code: "internal_error",
        message: "Not authenticated.",
      });
    }

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
    const { data: userData, error: userErr } =
      await supabaseAnon.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return jsonResponse({
        status: 401,
        code: "internal_error",
        message: "Not authenticated.",
      });
    }
    const user = userData.user;
    // Email is only ever forwarded to Stripe as an optional customer email.
    // It is NEVER used to look up or reuse a Stripe customer.
    const optionalEmail =
      typeof user.email === "string" && user.email !== "" ? user.email : undefined;

    // Parse body — only {agencyId, planKey}.
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({
        status: 400,
        code: "invalid_plan",
        message: "Missing plan.",
      });
    }
    // Reject any client-supplied priceId to prevent arbitrary checkout.
    if ("priceId" in body || "price_id" in body || "price" in body) {
      return jsonResponse({
        status: 400,
        code: "invalid_price",
        message: "Client-supplied price IDs are not allowed.",
      });
    }
    const agencyId = typeof body.agencyId === "string" ? body.agencyId : "";
    const planKey = body.planKey;
    if (!agencyId) {
      return jsonResponse({
        status: 403,
        code: "not_owner",
        message: "Only the agency owner can manage billing.",
      });
    }
    if (!isAgencyPlanKey(planKey)) {
      return jsonResponse({
        status: 400,
        code: "invalid_plan",
        message: "Invalid plan key.",
      });
    }

    const priceId = Deno.env.get(AGENCY_PLAN_TO_ENV[planKey]);
    if (!priceId || priceId.trim() === "") {
      log("price_env_missing", { code: "invalid_price" });
      return jsonResponse({
        status: 500,
        code: "invalid_price",
        message: "Plan price is not configured.",
      });
    }

    // Strict origin allowlist — no production fallback.
    const reqOrigin = req.headers.get("origin") ?? "";
    if (!isAllowedAgencyOrigin(reqOrigin)) {
      return jsonResponse({
        status: 400,
        code: "invalid_origin",
        message: "Request origin is not permitted.",
      });
    }

    // Agency must exist.
    const { data: agency, error: aErr } = await supabaseService
      .from("agency_profiles")
      .select("id")
      .eq("id", agencyId)
      .maybeSingle();
    if (aErr) {
      return jsonResponse({
        status: 503,
        code: "transient_error",
        message: "Temporary billing error. Please try again.",
      });
    }
    if (!agency) {
      return jsonResponse({
        status: 403,
        code: "not_owner",
        message: "Only the agency owner can manage billing.",
      });
    }

    // Caller must be an ACTIVE agency owner.
    const { data: ownerRow, error: mErr } = await supabaseService
      .from("agency_members")
      .select("id, role, status")
      .eq("agency_id", agencyId)
      .eq("member_user_id", user.id)
      .maybeSingle();
    if (mErr) {
      return jsonResponse({
        status: 503,
        code: "transient_error",
        message: "Temporary billing error. Please try again.",
      });
    }
    if (!ownerRow || ownerRow.status !== "active" || ownerRow.role !== "agency_owner") {
      return jsonResponse({
        status: 403,
        code: "not_owner",
        message: "Only the agency owner can manage billing.",
      });
    }

    // Phase 1R-D1 — cross-context recruiter billing precheck. Runs BEFORE any
    // Stripe construction or orchestrator call.
    const { data: recruiterProfile, error: rpErr } = await supabaseService
      .from("recruiter_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (rpErr) {
      return jsonResponse({
        status: 503,
        code: "transient_error",
        message: "Temporary billing error. Please try again.",
      });
    }

    if (recruiterProfile?.id) {
      const { data: recruiterBilling, error: rbErr } = await supabaseService
        .from("recruiter_billing_profiles")
        .select("plan, status")
        .eq("recruiter_id", recruiterProfile.id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (rbErr) {
        return jsonResponse({
          status: 503,
          code: "transient_error",
          message: "Temporary billing error. Please try again.",
        });
      }
      const decision = evaluateAgencyCheckoutCrossContext({
        hasRow: !!recruiterBilling,
        plan: recruiterBilling?.plan ?? null,
        status: recruiterBilling?.status ?? null,
      });
      if (!decision.allowed) {
        log("cross_context_block", { code: decision.code });
        return jsonResponse({
          status: decision.status,
          code:
            decision.code === "recruiter_subscription_exists"
              ? "recruiter_subscription_exists"
              : "opposing_entitlement_unknown",
          message: decision.message,
        });
      }
    }

    // Build adapters.
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const deps = buildAgencyDeps(stripe, supabaseService, optionalEmail);

    const result = await runAgencyCheckout(
      {
        agencyId,
        ownerUserId: user.id,
        planKey,
        priceId,
        origin: reqOrigin,
      },
      deps,
    );

    log("checkout_result", { code: result.code, status: result.status });
    return jsonResponse(result);
  } catch (_e) {
    // Safe logging: never log raw error messages, stacks, IDs, URLs, emails,
    // or interpolated dependency data. Stable event only.
    log("request_failed", { code: "unexpected_error" });
    return jsonResponse({
      status: 500,
      code: "internal_error",
      message: "Unexpected billing error.",
    });
  }
});

// ---------------------------------------------------------------------------
// Production adapters
// ---------------------------------------------------------------------------

function buildAgencyDeps(
  stripe: Stripe,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseService: any,
  optionalEmail: string | undefined,
): AgencyCheckoutDeps {
  const store: AgencyEntitlementStore = {
    async loadCustomerId({ agencyId }) {
      const { data, error } = await supabaseService
        .from("agency_entitlements")
        .select("stripe_customer_id")
        .eq("agency_id", agencyId)
        .maybeSingle();
      if (error) throw new Error("load_customer_failed");
      return { stripeCustomerId: data?.stripe_customer_id ?? null };
    },
    async saveCustomerId({ agencyId, customerId }) {
      // Checkout NEVER writes plan/status/subscription id — the webhook owns
      // the entitlement lifecycle.
      const { error } = await supabaseService
        .from("agency_entitlements")
        .upsert(
          {
            agency_id: agencyId,
            stripe_customer_id: customerId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "agency_id" },
        );
      if (error) throw new Error("save_customer_failed");
    },
  };

  const stripeGateway: AgencyStripeGateway = {
    async retrieveCustomer(id) {
      const c = await stripe.customers.retrieve(id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = c as any;
      if (raw?.deleted) return { id: raw.id, deleted: true, metadata: {} };
      return {
        id: raw.id,
        deleted: false,
        metadata: (raw.metadata ?? {}) as Record<string, string>,
      };
    },
    async searchCustomersByMetadata({ agencyId, ownerUserId }) {
      // Exact metadata search only. Customers are NEVER looked up by email.
      const query =
        `metadata['billing_context']:'agency' AND ` +
        `metadata['agency_id']:'${agencyId}' AND ` +
        `metadata['owner_user_id']:'${ownerUserId}'`;
      const results = await stripe.customers.search({ query, limit: 10 });
      return results.data.map((c): AgencyCustomerLike => ({
        id: c.id,
        deleted: false,
        metadata: (c.metadata ?? {}) as Record<string, string>,
      }));
    },
    async createCustomer({ idempotencyKey, metadata }) {
      const c = await stripe.customers.create(
        { email: optionalEmail, metadata },
        { idempotencyKey },
      );
      return {
        id: c.id,
        deleted: false,
        metadata: (c.metadata ?? {}) as Record<string, string>,
      };
    },
    async listAllSubscriptions(customerId) {
      const acc: AgencySubscriptionLike[] = [];
      let startingAfter: string | undefined;
      // Paginate exhaustively across all statuses.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 100,
          starting_after: startingAfter,
        });
        for (const s of page.data) acc.push({ id: s.id, status: s.status });
        if (!page.has_more) break;
        startingAfter = page.data[page.data.length - 1]?.id;
        if (!startingAfter) break;
      }
      return acc;
    },
    async listAllSessions(customerId) {
      const acc: AgencySessionLike[] = [];
      let startingAfter: string | undefined;
      // Paginate exhaustively across all Checkout Sessions.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await stripe.checkout.sessions.list({
          customer: customerId,
          limit: 100,
          starting_after: startingAfter,
        });
        for (const s of page.data) acc.push(normalizeSession(s));
        if (!page.has_more) break;
        startingAfter = page.data[page.data.length - 1]?.id;
        if (!startingAfter) break;
      }
      return acc;
    },
    async createSession({
      customerId,
      priceId,
      metadata,
      successUrl,
      cancelUrl,
      expiresAt,
      idempotencyKey,
    }) {
      const s = await stripe.checkout.sessions.create(
        {
          customer: customerId,
          line_items: [{ price: priceId, quantity: 1 }],
          mode: "subscription",
          success_url: successUrl,
          cancel_url: cancelUrl,
          expires_at: expiresAt,
          metadata,
          subscription_data: { metadata },
        },
        { idempotencyKey },
      );
      return normalizeSession(s);
    },
  };

  const clock: AgencyClock = { nowSeconds: () => Math.floor(Date.now() / 1000) };

  return { store, stripe: stripeGateway, clock };
}

// Fail-closed session normalization. Missing/absent fields become invalid
// sentinel values so downstream validation rejects them. NEVER default status
// to "open".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeSession(s: any): AgencySessionLike {
  const customer =
    typeof s?.customer === "string"
      ? s.customer
      : typeof s?.customer?.id === "string"
        ? s.customer.id
        : null;
  return {
    id: typeof s?.id === "string" ? s.id : "",
    status: typeof s?.status === "string" ? s.status : "",
    url: typeof s?.url === "string" ? s.url : null,
    customer,
    expires_at: typeof s?.expires_at === "number" ? s.expires_at : 0,
    metadata: (s?.metadata ?? {}) as Record<string, string>,
  };
}
