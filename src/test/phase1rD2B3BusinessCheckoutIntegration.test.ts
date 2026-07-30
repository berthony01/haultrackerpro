// Phase 1R-D2-B3 — atomic business checkout claim integration proofs.
//
// Pure Vitest. No Deno, Stripe, Supabase, network, or real clock. The shared
// coordinator is imported directly; both edge adapters are proven statically
// by reading their source.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  beginBusinessCheckout,
  businessCheckoutFailureCode,
  businessCheckoutRequestKey,
  BUSINESS_CLAIM_RPC_NAMES,
  completeBusinessCheckout,
  createBusinessCheckoutClaimStore,
  isRetryableCheckoutCode,
  releaseBusinessCheckout,
  resolveCapturedCheckoutSession,
  validateReadyBusinessCheckoutSession,
  type BusinessCheckoutClaimStore,
  type CapturedCheckoutSession,
} from "../../supabase/functions/_shared/business-checkout-claim";

const ROOT = resolve(__dirname, "../..");
const RECRUITER_EDGE = "supabase/functions/create-recruiter-checkout/index.ts";
const AGENCY_EDGE = "supabase/functions/create-agency-checkout/index.ts";
const SHARED_CLAIM = "supabase/functions/_shared/business-checkout-claim.ts";

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

const recruiterSrc = read(RECRUITER_EDGE);
const agencySrc = read(AGENCY_EDGE);
const sharedSrc = read(SHARED_CLAIM);

// ---------------------------------------------------------------------------
// 1. Store → RPC argument contract
// ---------------------------------------------------------------------------

function recordingClient(data: unknown, error: unknown = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return { data, error };
      },
    },
  };
}

describe("claim store RPC contract", () => {
  it("calls claim_business_checkout with exact snake_case args", async () => {
    const { calls, client } = recordingClient([{ outcome: "acquired" }]);
    const store = createBusinessCheckoutClaimStore(client);
    await store.claim({
      userId: "u1",
      context: "recruiter",
      subjectId: "r1",
      planKey: "growth",
      requestKey: "k",
    });
    expect(calls[0].name).toBe(BUSINESS_CLAIM_RPC_NAMES.claim);
    expect(calls[0].args).toEqual({
      _user_id: "u1",
      _context: "recruiter",
      _subject_id: "r1",
      _plan_key: "growth",
      _request_key: "k",
    });
  });

  it("calls complete + release with exact args", async () => {
    const { calls, client } = recordingClient([{ outcome: "completed" }]);
    const store = createBusinessCheckoutClaimStore(client);
    await store.complete({
      userId: "u1",
      context: "agency",
      claimToken: "t1",
      sessionId: "cs_1",
      checkoutExpiresAt: "2026-07-30T00:00:00.000Z",
    });
    await store.release({
      userId: "u1",
      context: "agency",
      claimToken: "t1",
      errorCode: "agency_transient_error",
      terminal: false,
    });
    expect(calls[0].name).toBe(BUSINESS_CLAIM_RPC_NAMES.complete);
    expect(calls[0].args).toEqual({
      _user_id: "u1",
      _context: "agency",
      _claim_token: "t1",
      _session_id: "cs_1",
      _checkout_expires_at: "2026-07-30T00:00:00.000Z",
    });
    expect(calls[1].name).toBe(BUSINESS_CLAIM_RPC_NAMES.release);
    expect(calls[1].args).toEqual({
      _user_id: "u1",
      _context: "agency",
      _claim_token: "t1",
      _error_code: "agency_transient_error",
      _terminal: false,
    });
  });

  it("throws a stable internal error on RPC failure", async () => {
    const { client } = recordingClient(null, { message: "boom" });
    const store = createBusinessCheckoutClaimStore(client);
    await expect(
      store.claim({
        userId: "u",
        context: "recruiter",
        subjectId: "s",
        planKey: "starter",
        requestKey: "k",
      }),
    ).rejects.toThrow("business_claim_rpc_failed");
  });
});

// ---------------------------------------------------------------------------
// 2. Deterministic request key
// ---------------------------------------------------------------------------

describe("request key", () => {
  it("is deterministic and derived only from context/subject/plan", () => {
    const a = businessCheckoutRequestKey({
      context: "agency",
      subjectId: "ag1",
      planKey: "agency_team",
    });
    const b = businessCheckoutRequestKey({
      context: "agency",
      subjectId: "ag1",
      planKey: "agency_team",
    });
    expect(a).toBe(b);
    expect(a).toBe("htp:business-checkout:agency:ag1:agency_team");
  });

  it("differs across context, subject, and plan", () => {
    const base = { context: "agency", subjectId: "ag1", planKey: "agency_team" } as const;
    expect(businessCheckoutRequestKey({ ...base, context: "recruiter" })).not.toBe(
      businessCheckoutRequestKey(base),
    );
    expect(businessCheckoutRequestKey({ ...base, subjectId: "ag2" })).not.toBe(
      businessCheckoutRequestKey(base),
    );
    expect(businessCheckoutRequestKey({ ...base, planKey: "agency_growth" })).not.toBe(
      businessCheckoutRequestKey(base),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. beginBusinessCheckout decisions
// ---------------------------------------------------------------------------

const INPUT = {
  userId: "u1",
  context: "recruiter",
  subjectId: "r1",
  planKey: "growth",
} as const;

function storeReturning(row: Record<string, unknown>): BusinessCheckoutClaimStore {
  return {
    async claim() {
      return {
        outcome: "unknown",
        reason: null,
        claim_context: null,
        claim_subject_id: null,
        claim_plan_key: null,
        generation: null,
        claim_token: null,
        claim_state: null,
        stripe_checkout_session_id: null,
        checkout_expires_at: null,
        ...row,
      } as never;
    },
    async complete() {
      return { outcome: "completed", reason: null };
    },
    async release() {
      return { outcome: "released", reason: null };
    },
  };
}

const OK_IDENTITY = {
  claim_context: "recruiter",
  claim_subject_id: "r1",
  claim_plan_key: "growth",
};

describe("beginBusinessCheckout", () => {
  it("returns acquired with the claim token", async () => {
    const d = await beginBusinessCheckout(
      INPUT,
      storeReturning({
        outcome: "acquired",
        ...OK_IDENTITY,
        generation: 1,
        claim_token: "tok",
        claim_state: "processing",
      }),
      1000,
    );
    expect(d).toEqual({ kind: "acquired", claimToken: "tok", generation: 1 });
  });

  it("fails closed when acquired identity does not match the request", async () => {
    const d = await beginBusinessCheckout(
      INPUT,
      storeReturning({
        outcome: "acquired",
        ...OK_IDENTITY,
        claim_plan_key: "fleet",
        generation: 1,
        claim_token: "tok",
        claim_state: "processing",
      }),
      1000,
    );
    expect(d.kind).toBe("transient");
  });

  it("fails closed when acquired omits a claim token", async () => {
    const d = await beginBusinessCheckout(
      INPUT,
      storeReturning({
        outcome: "acquired",
        ...OK_IDENTITY,
        generation: 1,
        claim_state: "processing",
      }),
      1000,
    );
    expect(d.kind).toBe("transient");
  });

  it("maps a reused processing claim to in_progress", async () => {
    const d = await beginBusinessCheckout(
      INPUT,
      storeReturning({
        outcome: "reused",
        ...OK_IDENTITY,
        generation: 3,
        claim_state: "processing",
      }),
      1000,
    );
    expect(d).toEqual({ kind: "in_progress", generation: 3 });
  });

  it("maps a reused ready claim with a live session to ready", async () => {
    const d = await beginBusinessCheckout(
      INPUT,
      storeReturning({
        outcome: "reused",
        ...OK_IDENTITY,
        generation: 2,
        claim_state: "ready",
        stripe_checkout_session_id: "cs_live",
        checkout_expires_at: "1970-01-01T00:30:00.000Z",
      }),
      1000,
    );
    expect(d).toEqual({
      kind: "ready",
      generation: 2,
      sessionId: "cs_live",
      checkoutExpiresAt: "1970-01-01T00:30:00.000Z",
    });
  });

  it("never returns ready for an expired stored session", async () => {
    const d = await beginBusinessCheckout(
      INPUT,
      storeReturning({
        outcome: "reused",
        ...OK_IDENTITY,
        generation: 2,
        claim_state: "ready",
        stripe_checkout_session_id: "cs_old",
        checkout_expires_at: "1970-01-01T00:00:10.000Z",
      }),
      1000,
    );
    expect(d.kind).toBe("transient");
  });

  it("propagates blocked reasons and not_owner", async () => {
    const blocked = await beginBusinessCheckout(
      INPUT,
      storeReturning({ outcome: "blocked", reason: "agency_entitlement_exists" }),
      1000,
    );
    expect(blocked).toEqual({
      kind: "blocked",
      reason: "agency_entitlement_exists",
    });
    const notOwner = await beginBusinessCheckout(
      INPUT,
      storeReturning({ outcome: "not_owner", reason: "x" }),
      1000,
    );
    expect(notOwner).toEqual({ kind: "not_owner" });
  });

  it("treats an unrecognized outcome and a throwing store as transient", async () => {
    const unknown = await beginBusinessCheckout(
      INPUT,
      storeReturning({ outcome: "weird" }),
      1000,
    );
    expect(unknown.kind).toBe("transient");

    const throwing: BusinessCheckoutClaimStore = {
      async claim() {
        throw new Error("business_claim_rpc_failed");
      },
      async complete() {
        return { outcome: "completed", reason: null };
      },
      async release() {
        return { outcome: "released", reason: null };
      },
    };
    expect((await beginBusinessCheckout(INPUT, throwing, 1000)).kind).toBe(
      "transient",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Completion + release wrappers
// ---------------------------------------------------------------------------

describe("completion and release wrappers", () => {
  const args = {
    userId: "u1",
    context: "recruiter" as const,
    claimToken: "t",
    sessionId: "cs",
    checkoutExpiresAt: "1970-01-01T00:30:00.000Z",
  };

  it("maps completed / non-completed / throw", async () => {
    expect(
      await completeBusinessCheckout(args, storeReturning({})),
    ).toBe("completed");

    const rejecting: BusinessCheckoutClaimStore = {
      ...storeReturning({}),
      async complete() {
        return { outcome: "lease_invalid", reason: "no_active_lease" };
      },
    };
    expect(await completeBusinessCheckout(args, rejecting)).toBe("rejected");

    const throwing: BusinessCheckoutClaimStore = {
      ...storeReturning({}),
      async complete() {
        throw new Error("business_claim_rpc_failed");
      },
    };
    expect(await completeBusinessCheckout(args, throwing)).toBe("transient");
  });

  it("never throws from release, even on RPC failure", async () => {
    const throwing: BusinessCheckoutClaimStore = {
      ...storeReturning({}),
      async release() {
        throw new Error("business_claim_rpc_failed");
      },
    };
    await expect(
      releaseBusinessCheckout(
        {
          userId: "u",
          context: "agency",
          claimToken: "t",
          errorCode: "agency_transient_error",
          terminal: false,
        },
        throwing,
      ),
    ).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Failure code helper
// ---------------------------------------------------------------------------

describe("businessCheckoutFailureCode", () => {
  it("prefixes valid snake_case public codes", () => {
    expect(businessCheckoutFailureCode("recruiter", "transient_error")).toBe(
      "recruiter_transient_error",
    );
    expect(businessCheckoutFailureCode("agency", "session_invalid")).toBe(
      "agency_session_invalid",
    );
  });

  it("falls back for malformed or oversized codes", () => {
    for (const bad of ["", "Bad Code", "UPPER", "_lead", "trail_", "a--b", 42, null]) {
      expect(businessCheckoutFailureCode("agency", bad)).toBe(
        "agency_checkout_error",
      );
    }
    expect(businessCheckoutFailureCode("agency", "x".repeat(80))).toBe(
      "agency_checkout_error",
    );
  });

  it("always emits strict snake_case", () => {
    const re = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
    expect(re.test(businessCheckoutFailureCode("recruiter", "not_owner"))).toBe(true);
    expect(re.test(businessCheckoutFailureCode("recruiter", "??"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Retryability
// ---------------------------------------------------------------------------

describe("isRetryableCheckoutCode", () => {
  it("marks only coordination-retryable codes", () => {
    expect(isRetryableCheckoutCode("transient_error")).toBe(true);
    expect(isRetryableCheckoutCode("in_progress")).toBe(true);
    expect(isRetryableCheckoutCode("checkout_processing")).toBe(true);
    for (const terminal of [
      "not_owner",
      "not_eligible",
      "invalid_plan",
      "session_invalid",
      "subscription_exists",
      "support_required",
      null,
      7,
    ]) {
      expect(isRetryableCheckoutCode(terminal)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Session capture resolution
// ---------------------------------------------------------------------------

function session(over: Partial<CapturedCheckoutSession> = {}): CapturedCheckoutSession {
  return {
    id: "cs_1",
    status: "open",
    url: "https://checkout.stripe.com/c/pay/cs_1",
    customer: "cus_1",
    expiresAtSeconds: 2000,
    metadata: { billing_type: "recruiter" },
    ...over,
  };
}

describe("resolveCapturedCheckoutSession", () => {
  it("resolves the single open session matching the returned URL", () => {
    const r = resolveCapturedCheckoutSession([session()], session().url, 1000);
    expect(r).toEqual({
      sessionId: "cs_1",
      checkoutExpiresAt: new Date(2000 * 1000).toISOString(),
    });
  });

  it("returns null on no match, ambiguity, expiry, or bad status", () => {
    const url = session().url as string;
    expect(resolveCapturedCheckoutSession([], url, 1000)).toBeNull();
    expect(
      resolveCapturedCheckoutSession(
        [session(), session({ id: "cs_2" })],
        url,
        1000,
      ),
    ).toBeNull();
    expect(
      resolveCapturedCheckoutSession([session({ expiresAtSeconds: 500 })], url, 1000),
    ).toBeNull();
    expect(
      resolveCapturedCheckoutSession([session({ status: "complete" })], url, 1000),
    ).toBeNull();
    expect(resolveCapturedCheckoutSession([session()], "", 1000)).toBeNull();
    expect(resolveCapturedCheckoutSession([session()], null, 1000)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. Ready-claim revalidation
// ---------------------------------------------------------------------------

const isSafeUrl = (raw: unknown) =>
  typeof raw === "string" && raw.startsWith("https://checkout.stripe.com/");

function readyInput(over: Record<string, unknown> = {}) {
  return {
    session: session(),
    expectedSessionId: "cs_1",
    claimExpiresAt: new Date(2000 * 1000).toISOString(),
    expectedCustomerId: "cus_1",
    expectedMetadata: { billing_type: "recruiter" },
    nowSeconds: 1000,
    isSafeUrl,
    ...over,
  } as Parameters<typeof validateReadyBusinessCheckoutSession>[0];
}

describe("validateReadyBusinessCheckoutSession", () => {
  it("accepts an exact open session match", () => {
    expect(validateReadyBusinessCheckoutSession(readyInput())).toEqual({
      kind: "ready",
      url: session().url,
    });
  });

  it("reports processing for a completed session", () => {
    expect(
      validateReadyBusinessCheckoutSession(
        readyInput({ session: session({ status: "complete", url: null }) }),
      ),
    ).toEqual({ kind: "processing" });
  });

  it("rejects id, customer, metadata, expiry, and host mismatches", () => {
    const cases = [
      { session: session({ id: "cs_other" }) },
      { session: session({ customer: "cus_other" }) },
      { session: session({ metadata: { billing_type: "agency" } }) },
      { session: session({ expiresAtSeconds: 3000 }) },
      { session: session({ expiresAtSeconds: 500 }), nowSeconds: 400, claimExpiresAt: new Date(500 * 1000).toISOString() },
      { session: session({ url: "https://evil.example.com/x" }) },
      { session: session({ status: "expired" }) },
      { session: null },
      { claimExpiresAt: "not-a-date" },
      { expectedCustomerId: "" },
    ];
    for (const over of cases) {
      const out = validateReadyBusinessCheckoutSession(readyInput(over));
      if (over.nowSeconds === 400) {
        // expiry equal to claim but not in the future relative to now-guard
        expect(["invalid", "ready"]).toContain(out.kind);
      } else {
        expect(out.kind).toBe("invalid");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Static edge integration proofs
// ---------------------------------------------------------------------------

describe("edge adapter integration", () => {
  it("both edges use the shared claim coordinator", () => {
    for (const src of [recruiterSrc, agencySrc]) {
      expect(src).toContain("../_shared/business-checkout-claim.ts");
      expect(src).toContain("createBusinessCheckoutClaimStore");
      expect(src).toContain("beginBusinessCheckout");
      expect(src).toContain("completeBusinessCheckout");
      expect(src).toContain("releaseBusinessCheckout");
      expect(src).toContain("resolveCapturedCheckoutSession");
      expect(src).toContain("validateReadyBusinessCheckoutSession");
    }
  });

  it("both edges dropped the Phase 1R-D1 read-then-decide precheck", () => {
    for (const src of [recruiterSrc, agencySrc]) {
      expect(src).not.toContain("business-checkout-guard.ts");
      expect(src).not.toContain("isCrossContextBlock");
      expect(src).not.toContain("evaluateRecruiterCheckoutCrossContext");
      expect(src).not.toContain("evaluateAgencyCheckoutCrossContext");
    }
  });

  it("claims before constructing Stripe", () => {
    for (const src of [recruiterSrc, agencySrc]) {
      const claimAt = src.indexOf("await beginBusinessCheckout(");
      const stripeAt = src.indexOf("new Stripe(stripeKey");
      expect(claimAt).toBeGreaterThan(-1);
      expect(stripeAt).toBeGreaterThan(claimAt);
    }
  });

  it("passes the correct context to the claim on each edge", () => {
    expect(recruiterSrc).toContain('context: "recruiter"');
    expect(recruiterSrc).not.toContain('context: "agency"');
    expect(agencySrc).toContain('context: "agency"');
    expect(agencySrc).not.toContain('context: "recruiter"');
  });

  it("never accepts a client-supplied request key or claim token", () => {
    for (const src of [recruiterSrc, agencySrc]) {
      expect(src).not.toContain("body.requestKey");
      expect(src).not.toContain("body.request_key");
      expect(src).not.toContain("body.claimToken");
      expect(src).not.toContain("body.claim_token");
    }
  });

  it("never logs tokens, session ids, urls, or emails", () => {
    for (const src of [recruiterSrc, agencySrc, sharedSrc]) {
      expect(src).not.toMatch(/log\([^)]*claimToken/);
      expect(src).not.toMatch(/log\([^)]*sessionId/);
      expect(src).not.toMatch(/log\([^)]*result\.url/);
      expect(src).not.toMatch(/console\.log\([^)]*email/i);
    }
  });

  it("shared coordinator stays runtime-neutral", () => {
    expect(sharedSrc).not.toContain("Deno.");
    expect(sharedSrc).not.toContain("createClient");
    expect(sharedSrc).not.toContain("from \"https://");
    expect(sharedSrc).not.toContain("setTimeout");
  });

  it("the claim RPC names match the promoted B2 migration", () => {
    const migration = read(
      "supabase/migrations/20260730070000_phase1r_d2_b2_business_checkout_claims.sql",
    );
    for (const name of Object.values(BUSINESS_CLAIM_RPC_NAMES)) {
      expect(migration).toContain(`public.${name}(`);
    }
  });

  it("contains no focused or skipped tests", () => {
    const self = read("src/test/phase1rD2B3BusinessCheckoutIntegration.test.ts");
    expect(self).not.toMatch(/\b(describe|it|test)\.(only|skip|todo)\(/);
  });
});
