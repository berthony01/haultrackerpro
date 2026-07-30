// Phase 1G-R1A2 — Recruiter Checkout edge adapter.
//
// Thin adapter: authenticate, validate plan/price/origin/recruiter, build
// stateful Stripe + Intent adapters wrapping the four A1 RPCs, then call
// the runtime-neutral orchestrator in ../_shared/recruiter-checkout.ts.
//
// The adapter never owns the create-customer/create-session flow directly.

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
  isAllowedRecruiterOrigin,
  isRecruiterPlan,
  recruiterCanonicalMetadata,
  runRecruiterCheckout,
  type Clock,
  type IntentClaimResult,
  type IntentSimpleResult,
  type IntentStore,
  type RecruiterCheckoutDeps,
  type RecruiterCheckoutResult,
  type RecruiterPlan,
  type StripeCustomerLike,
  type StripeGateway,
  type StripeSessionLike,
  type StripeSubscriptionLike,
} from "../_shared/recruiter-checkout.ts";

/** Exact-host validator for a returned Stripe Checkout URL. */
function isSafeStripeCheckoutUrl(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.trim() === "") return false;
  const m = /^https:\/\/([^/?#]+)(?:[/?#]|$)/.exec(raw);
  if (!m) return false;
  return m[1].toLowerCase() === "checkout.stripe.com";
}

/**
 * Deterministic mapping from a claim block reason to the public response.
 *
 * Phase 1R-D2-B3-R1: every block reason is a conflict with existing billing
 * state, not an authorization failure, so all of them are HTTP 409. Only the
 * distinct `not_owner` claim outcome (handled by the caller) remains 403.
 */
function recruiterBlockedResult(reason: string): RecruiterCheckoutResult {
  switch (reason) {
    case "agency_entitlement_exists":
      return {
        status: 409,
        code: "agency_entitlement_exists",
        message: "This account already has agency billing.",
      };
    case "agency_billing_requires_management":
      return {
        status: 409,
        code: "agency_billing_requires_management",
        message: "Manage billing from your agency workspace.",
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

const PLAN_TO_ENV: Record<RecruiterPlan, string> = {
  starter: "STRIPE_RECRUITER_STARTER_PRICE_ID",
  growth: "STRIPE_RECRUITER_GROWTH_PRICE_ID",
  fleet: "STRIPE_RECRUITER_FLEET_PRICE_ID",
};

const log = (s: string, d?: Record<string, unknown>) =>
  console.log(
    `[CREATE-RECRUITER-CHECKOUT] ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`,
  );

function jsonResponse(result: RecruiterCheckoutResult): Response {
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

    // Parse body — only {plan}.
    let plan: string | undefined;
    try {
      const body = await req.json();
      plan = typeof body?.plan === "string" ? body.plan : undefined;
    } catch {
      return jsonResponse({
        status: 400,
        code: "invalid_plan",
        message: "Missing plan.",
      });
    }
    if (!isRecruiterPlan(plan)) {
      return jsonResponse({
        status: 400,
        code: "invalid_plan",
        message: "Unknown recruiter plan.",
      });
    }
    const priceId = Deno.env.get(PLAN_TO_ENV[plan]);
    if (!priceId || priceId.trim() === "") {
      return jsonResponse({
        status: 500,
        code: "invalid_price",
        message: "Plan price is not configured.",
      });
    }

    // Recruiter identity + eligibility.
    const { data: recruiter, error: rErr } = await supabaseService
      .from("recruiter_profiles")
      .select("id, user_id, verification_status, status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (rErr) {
      return jsonResponse({
        status: 503,
        code: "transient_error",
        message: "Temporary billing error. Please try again.",
      });
    }
    if (!recruiter) {
      return jsonResponse({
        status: 403,
        code: "not_owner",
        message: "Recruiter profile not found.",
      });
    }
    if (
      recruiter.status === "suspended" ||
      recruiter.verification_status === "suspended"
    ) {
      return jsonResponse({
        status: 403,
        code: "not_eligible",
        message: "Recruiter account suspended.",
      });
    }
    if (recruiter.verification_status !== "approved") {
      return jsonResponse({
        status: 403,
        code: "not_eligible",
        message: "Recruiter must be approved before subscribing.",
      });
    }

    // Origin allowlist — never reflect arbitrary origins.
    const reqOrigin = req.headers.get("origin") ?? "";
    if (!isAllowedRecruiterOrigin(reqOrigin)) {
      return jsonResponse({
        status: 400,
        code: "invalid_origin",
        message: "Request origin is not permitted.",
      });
    }

    // Phase 1R-D2-B3 — atomic cross-context checkout claim. Replaces the old
    // Phase 1R-D1 read-then-decide precheck with the authoritative PostgreSQL
    // state machine. Runs BEFORE any Stripe construction or orchestrator call
    // so two concurrent recruiter/agency requests can never both enter Stripe.
    const claimStore = createBusinessCheckoutClaimStore(supabaseService);
    const nowSeconds = () => Math.floor(Date.now() / 1000);

    const begin = await beginBusinessCheckout(
      {
        userId: user.id,
        context: "recruiter",
        subjectId: recruiter.id,
        planKey: plan,
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
        message: "Recruiter profile not found.",
      });
    }
    if (begin.kind === "blocked") {
      const blocked = recruiterBlockedResult(begin.reason);
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
      // Checkout Session against Stripe. Never trust the stored row alone.
      const { data: billing, error: bErr } = await supabaseService
        .from("recruiter_billing_profiles")
        .select("stripe_customer_id")
        .eq("recruiter_id", recruiter.id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (bErr) {
        return jsonResponse({
          status: 503,
          code: "transient_error",
          message: "Temporary billing error. Please try again.",
        });
      }
      const customerId =
        typeof billing?.stripe_customer_id === "string"
          ? billing.stripe_customer_id
          : "";
      if (customerId === "") {
        // Phase 1R-D2-B3-R1: a ready claim without a canonical recruiter
        // customer is an inconsistent state that retrying cannot repair, so
        // it is surfaced as support_required rather than checkout_processing.
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
        expectedMetadata: recruiterCanonicalMetadata({
          userId: user.id,
          recruiterId: recruiter.id,
          plan,
        }),
        nowSeconds: nowSeconds(),
        isSafeUrl: isSafeStripeCheckoutUrl,
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
    const captured: CapturedCheckoutSession[] = [];
    const deps = buildDeps(stripe, supabaseService, captured);

    let result: RecruiterCheckoutResult;
    try {
      result = await runRecruiterCheckout(
        {
          userId: user.id,
          recruiterId: recruiter.id,
          plan,
          priceId,
          origin: reqOrigin,
        },
        deps,
      );
    } catch {
      await releaseBusinessCheckout(
        {
          userId: user.id,
          context: "recruiter",
          claimToken: begin.claimToken,
          errorCode: businessCheckoutFailureCode("recruiter", "internal_error"),
          terminal: true,
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
        captured,
        result.url,
        nowSeconds(),
      );
      if (!identity) {
        await releaseBusinessCheckout(
          {
            userId: user.id,
            context: "recruiter",
            claimToken: begin.claimToken,
            errorCode: businessCheckoutFailureCode(
              "recruiter",
              "session_invalid",
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
          context: "recruiter",
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
      if (done === "transient") {
        return jsonResponse({
          status: 503,
          code: "transient_error",
          message: "Temporary billing error. Please try again.",
        });
      }
      return jsonResponse({
        status: 409,
        code: "checkout_processing",
        message: "Your checkout is still being processed.",
      });
    }

    // Any non-ready orchestrator outcome releases the claim. Retryable codes
    // release non-terminally so the user can immediately try again.
    await releaseBusinessCheckout(
      {
        userId: user.id,
        context: "recruiter",
        claimToken: begin.claimToken,
        errorCode: businessCheckoutFailureCode("recruiter", result.code),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDeps(
  stripe: Stripe,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseService: any,
  captured: CapturedCheckoutSession[],
): RecruiterCheckoutDeps {
  const intents: IntentStore = {
    async claim({ recruiterId, userId, plan }) {
      const { data, error } = await supabaseService.rpc(
        "claim_recruiter_checkout_intent",
        { _recruiter_id: recruiterId, _user_id: userId, _plan: plan },
      );
      if (error) throw new Error("intent_claim_failed");
      const row = Array.isArray(data) ? data[0] : data;
      return normalizeClaim(row);
    },
    async bind({ intentId, claimToken, customerId }) {
      const { data, error } = await supabaseService.rpc(
        "bind_recruiter_checkout_customer",
        {
          _intent_id: intentId,
          _claim_token: claimToken,
          _customer_id: customerId,
        },
      );
      if (error) throw new Error("intent_bind_failed");
      return normalizeSimple(data);
    },
    async complete({
      intentId,
      claimToken,
      customerId,
      sessionId,
      url,
      expiresAt,
    }) {
      const { data, error } = await supabaseService.rpc(
        "complete_recruiter_checkout_intent",
        {
          _intent_id: intentId,
          _claim_token: claimToken,
          _customer_id: customerId,
          _session_id: sessionId,
          _checkout_url: url,
          _checkout_expires_at: expiresAt,
        },
      );
      if (error) throw new Error("intent_complete_failed");
      return normalizeSimple(data);
    },
    async fail({ intentId, claimToken, errorCode, terminal }) {
      const { data, error } = await supabaseService.rpc(
        "fail_recruiter_checkout_intent",
        {
          _intent_id: intentId,
          _claim_token: claimToken,
          _error_code: errorCode,
          _terminal: terminal,
        },
      );
      if (error) throw new Error("intent_fail_failed");
      return normalizeSimple(data);
    },
    async loadCanonicalCustomer({ recruiterId, userId }) {
      const { data, error } = await supabaseService
        .from("recruiter_billing_profiles")
        .select("stripe_customer_id")
        .eq("recruiter_id", recruiterId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error("load_customer_failed");
      return { stripeCustomerId: data?.stripe_customer_id ?? null };
    },
  };

  const stripeGateway: StripeGateway = {
    async retrieveCustomer(id) {
      const c = await stripe.customers.retrieve(id);
      // Stripe's DeletedCustomer type has `deleted: true`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = c as any;
      if (raw?.deleted) return { id: raw.id, deleted: true, metadata: {} };
      return {
        id: raw.id,
        deleted: false,
        metadata: (raw.metadata ?? {}) as Record<string, string>,
      };
    },
    async searchCustomersByMetadata({ recruiterId, userId }) {
      const query =
        `metadata['billing_type']:'recruiter' AND ` +
        `metadata['recruiter_id']:'${recruiterId}' AND ` +
        `metadata['user_id']:'${userId}'`;
      const results = await stripe.customers.search({ query, limit: 10 });
      return results.data.map((c) => ({
        id: c.id,
        deleted: false,
        metadata: (c.metadata ?? {}) as Record<string, string>,
      }));
    },
    async createCustomer({ userId, recruiterId, idempotencyKey, metadata }) {
      const c = await stripe.customers.create(
        { metadata },
        { idempotencyKey },
      );
      return {
        id: c.id,
        deleted: false,
        metadata: (c.metadata ?? {}) as Record<string, string>,
      };
    },
    async listAllSubscriptions(customerId) {
      const acc: StripeSubscriptionLike[] = [];
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
    async retrieveSession(id) {
      const s = normalizeSession(await stripe.checkout.sessions.retrieve(id));
      captured.push(toCapturedSession(s));
      return s;
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
      captured.push(toCapturedSession(s));
      return s;
    },
  };

  const clock: Clock = { nowSeconds: () => Math.floor(Date.now() / 1000) };

  return { intents, stripe: stripeGateway, clock };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeClaim(row: any): IntentClaimResult {
  return {
    outcome: row?.outcome ?? "not_eligible",
    intent_id: row?.intent_id ?? null,
    claim_token: row?.claim_token ?? null,
    generation: row?.generation ?? null,
    checkout_url: row?.checkout_url ?? null,
    checkout_expires_at: row?.checkout_expires_at ?? null,
    stripe_customer_id: row?.stripe_customer_id ?? null,
    stripe_checkout_session_id: row?.stripe_checkout_session_id ?? null,
    reason: row?.reason ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeSimple(data: any): IntentSimpleResult {
  const row = Array.isArray(data) ? data[0] : data;
  return { outcome: row?.outcome ?? "unknown", reason: row?.reason ?? null };
}

// Fail-closed session normalization. Missing/absent fields become invalid
// sentinel values (empty string / 0 / "") so downstream validation rejects
// them. NEVER default status to "open" — that would let malformed Stripe
// responses masquerade as valid open sessions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeSession(s: any): StripeSessionLike {
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
function toCapturedSession(s: StripeSessionLike): CapturedCheckoutSession {
  return {
    id: s.id,
    status: s.status,
    url: s.url,
    customer: s.customer,
    expiresAtSeconds: s.expires_at,
    metadata: s.metadata,
  };
}
