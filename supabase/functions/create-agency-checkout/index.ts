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

import {
  beginBusinessCheckout,
  businessCheckoutFailureCode,
  completeBusinessCheckout,
  createBusinessCheckoutClaimStore,
  isRetryableCheckoutCode,
  releaseBusinessCheckout,
  resolveCapturedCheckoutSession,
  validateReadyBusinessCheckoutSession,
  type CapturedCheckoutSession,
} from "../_shared/business-checkout-claim.ts";
import {
  agencySessionMetadata,
  isAgencyPlanKey,
  isAllowedAgencyOrigin,
  isSafeAgencyCheckoutUrl,
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

/**
 * Deterministic mapping from a claim block reason to the public response.
 *
 * Phase 1R-D2-B3-R1: every block reason is a conflict with existing billing
 * state, not an authorization failure, so all of them are HTTP 409. Only the
 * distinct `not_owner` claim outcome (handled by the caller) remains 403.
 */
function agencyBlockedResult(reason: string): AgencyCheckoutResult {
  switch (reason) {
    case "recruiter_subscription_exists":
      return {
        status: 409,
        code: "recruiter_subscription_exists",
        message: "This account already has recruiter billing.",
      };
    case "opposing_claim_active":
    case "same_context_claim_active":
      return {
        status: 409,
        code: "in_progress",
        message: "A checkout is already in progress. Please try again shortly.",
      };
    default:
      return {
        status: 409,
        code: "opposing_entitlement_unknown",
        message: "Billing state could not be confirmed. Please contact support.",
      };
  }
}

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

    // Agency must exist, and the caller must be the CANONICAL owner
    // (agency_profiles.owner_user_id). Email is never an ownership key.
    const { data: agency, error: aErr } = await supabaseService
      .from("agency_profiles")
      .select("id, owner_user_id")
      .eq("id", agencyId)
      .maybeSingle();
    if (aErr) {
      return jsonResponse({
        status: 503,
        code: "transient_error",
        message: "Temporary billing error. Please try again.",
      });
    }
    if (!agency || agency.owner_user_id !== user.id) {
      return jsonResponse({
        status: 403,
        code: "not_owner",
        message: "Only the agency owner can manage billing.",
      });
    }

    // Caller must ALSO be an ACTIVE agency owner member.
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

    // Phase 1R-D2-B3 — atomic cross-context checkout claim. Replaces the old
    // Phase 1R-D1 read-then-decide precheck with the authoritative PostgreSQL
    // state machine. Runs BEFORE any Stripe construction or orchestrator call.
    const claimStore = createBusinessCheckoutClaimStore(supabaseService);
    const nowSeconds = () => Math.floor(Date.now() / 1000);

    const begin = await beginBusinessCheckout(
      {
        userId: user.id,
        context: "agency",
        subjectId: agencyId,
        planKey,
      },
      claimStore,
      nowSeconds(),
    );

    if (begin.kind === "transient") {
      log("claim_transient", { code: "transient_error" });
      return jsonResponse({
        status: 503,
        code: "transient_error",
        message: "Temporary billing error. Please try again.",
      });
    }
    if (begin.kind === "not_owner") {
      return jsonResponse({
        status: 403,
        code: "not_owner",
        message: "Only the agency owner can manage billing.",
      });
    }
    if (begin.kind === "blocked") {
      const blocked = agencyBlockedResult(begin.reason);
      log("claim_blocked", { code: blocked.code });
      return jsonResponse(blocked);
    }
    if (begin.kind === "in_progress") {
      return jsonResponse({
        status: 409,
        code: "in_progress",
        message: "A checkout is already in progress. Please try again shortly.",
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    if (begin.kind === "ready") {
      // A ready claim is only honored after exact revalidation of the stored
      // Checkout Session against Stripe.
      const { data: ent, error: entErr } = await supabaseService
        .from("agency_entitlements")
        .select("stripe_customer_id")
        .eq("agency_id", agencyId)
        .maybeSingle();
      if (entErr) {
        return jsonResponse({
          status: 503,
          code: "transient_error",
          message: "Temporary billing error. Please try again.",
        });
      }
      const customerId =
        typeof ent?.stripe_customer_id === "string" ? ent.stripe_customer_id : "";
      if (customerId === "") {
        // Phase 1R-D2-B3-R1: a ready claim without a canonical agency customer
        // is an inconsistent state that retrying cannot repair, so it is
        // surfaced as support_required rather than checkout_processing.
        log("ready_customer_missing", { code: "support_required" });
        return jsonResponse({
          status: 409,
          code: "support_required",
          message: "Billing state could not be confirmed. Please contact support.",
        });
      }

      let capturedReady: CapturedCheckoutSession | null = null;
      try {
        capturedReady = toCapturedSession(
          normalizeSession(
            await stripe.checkout.sessions.retrieve(begin.sessionId),
          ),
        );
      } catch {
        return jsonResponse({
          status: 503,
          code: "transient_error",
          message: "Temporary billing error. Please try again.",
        });
      }

      const validation = validateReadyBusinessCheckoutSession({
        session: capturedReady,
        expectedSessionId: begin.sessionId,
        claimExpiresAt: begin.checkoutExpiresAt,
        expectedCustomerId: customerId,
        expectedMetadata: agencySessionMetadata({
          agencyId,
          ownerUserId: user.id,
          planKey,
        }),
        nowSeconds: nowSeconds(),
        isSafeUrl: isSafeAgencyCheckoutUrl,
      });

      if (validation.kind === "ready") {
        log("checkout_result", { code: "checkout_ready", status: 200 });
        return jsonResponse({
          status: 200,
          code: "checkout_ready",
          message: "Checkout session ready.",
          url: validation.url,
        });
      }
      if (validation.kind === "processing") {
        return jsonResponse({
          status: 409,
          code: "checkout_processing",
          message: "Your checkout is still being processed.",
        });
      }
      return jsonResponse({
        status: 409,
        code: "session_invalid",
        message: "Checkout session is no longer valid. Please try again.",
      });
    }

    // begin.kind === "acquired" — this request owns the lease.
    //
    // Phase 1R-D2-B3-R1: captures are deduplicated by non-empty session ID in
    // a request-local Map. Exhaustive `listAllSessions` pagination can observe
    // the very session that `createSession` also captures; without dedup the
    // identical session would appear twice and resolution would fail as
    // ambiguous.
    const captured = new Map<string, CapturedCheckoutSession>();
    const deps = buildAgencyDeps(stripe, supabaseService, optionalEmail, captured);

    let result: AgencyCheckoutResult;
    try {
      result = await runAgencyCheckout(
        {
          agencyId,
          ownerUserId: user.id,
          planKey,
          priceId,
          origin: reqOrigin,
        },
        deps,
      );
    } catch {
      // Best-effort, NON-terminal release: an unexpected exception is not
      // proof of a permanent failure, so the owner may retry.
      await releaseBusinessCheckout(
        {
          userId: user.id,
          context: "agency",
          claimToken: begin.claimToken,
          errorCode: businessCheckoutFailureCode("agency", "internal_error"),
          terminal: false,
        },
        claimStore,
      );
      log("request_failed", { code: "unexpected_error" });
      return jsonResponse({
        status: 500,
        code: "internal_error",
        message: "Unexpected billing error.",
      });
    }

    if (result.code === "checkout_ready" && result.url) {
      const identity = resolveCapturedCheckoutSession(
        [...captured.values()],
        result.url,
        nowSeconds(),
      );
      if (!identity) {
        await releaseBusinessCheckout(
          {
            userId: user.id,
            context: "agency",
            claimToken: begin.claimToken,
            errorCode: businessCheckoutFailureCode(
              "agency",
              "session_identity_missing",
            ),
            terminal: true,
          },
          claimStore,
        );
        log("claim_capture_failed", { code: "session_invalid" });
        return jsonResponse({
          status: 409,
          code: "session_invalid",
          message: "Checkout session is no longer valid. Please try again.",
        });
      }

      const done = await completeBusinessCheckout(
        {
          userId: user.id,
          context: "agency",
          claimToken: begin.claimToken,
          sessionId: identity.sessionId,
          checkoutExpiresAt: identity.checkoutExpiresAt,
        },
        claimStore,
      );
      if (done === "completed") {
        log("checkout_result", { code: result.code, status: result.status });
        return jsonResponse(result);
      }
      // Phase 1R-D2-B3-R1: a real Stripe Checkout Session exists but the claim
      // could not be recorded as ready (rejected) or the RPC outcome is unknown
      // (transient). Releasing here would be unsafe — it could free the lease
      // while a live session is outstanding. Report processing and never leak
      // the URL.
      log("claim_complete_unconfirmed", { code: "checkout_processing" });
      return jsonResponse({
        status: 409,
        code: "checkout_processing",
        message: "Your checkout is still being processed.",
      });
    }

    // Any non-ready orchestrator outcome releases the claim.
    await releaseBusinessCheckout(
      {
        userId: user.id,
        context: "agency",
        claimToken: begin.claimToken,
        errorCode: businessCheckoutFailureCode("agency", result.code),
        terminal: !isRetryableCheckoutCode(result.code),
      },
      claimStore,
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
  captured: Map<string, CapturedCheckoutSession>,
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
        for (const s of page.data) {
          const n = normalizeSession(s);
          captureSession(captured, n);
          acc.push(n);
        }
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
      const s = normalizeSession(
        await stripe.checkout.sessions.create(
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
        ),
      );
      captureSession(captured, s);
      return s;
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

// Phase 1R-D2-B3 — capture shape for the atomic claim coordinator. Purely a
// field projection of the already fail-closed normalized session.
function toCapturedSession(s: AgencySessionLike): CapturedCheckoutSession {
  return {
    id: s.id,
    status: s.status,
    url: s.url,
    customer: s.customer,
    expiresAtSeconds: s.expires_at,
    metadata: s.metadata,
  };
}

// Phase 1R-D2-B3-R1 — request-local dedup by non-empty session ID. Sessions
// without a usable ID are dropped entirely (fail closed); the latest observed
// projection of a given ID wins, so a list-then-create pair for the same
// session yields exactly one candidate.
function captureSession(
  captured: Map<string, CapturedCheckoutSession>,
  s: AgencySessionLike,
): void {
  const projected = toCapturedSession(s);
  if (typeof projected.id !== "string" || projected.id === "") return;
  captured.set(projected.id, projected);
}
