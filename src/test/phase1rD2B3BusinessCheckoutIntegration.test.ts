// Phase 1R-D2-B3 / B3-R1 — atomic business checkout claim integration proofs.
//
// Pure Vitest. No network, no Stripe SDK, no Supabase client, no connected
// database, no fake timers, no snapshots, no focused/skipped tests. The shared
// coordinator is imported and exercised directly; both edge adapters are
// proven statically by reading their source.

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
  RETRYABLE_CHECKOUT_CODES,
  validateReadyBusinessCheckoutSession,
  type BusinessCheckoutClaimStore,
  type CapturedCheckoutSession,
} from "../../supabase/functions/_shared/business-checkout-claim";

const ROOT = resolve(__dirname, "../..");
const RECRUITER_EDGE = "supabase/functions/create-recruiter-checkout/index.ts";
const AGENCY_EDGE = "supabase/functions/create-agency-checkout/index.ts";
const SHARED_CLAIM = "supabase/functions/_shared/business-checkout-claim.ts";
const RECRUITER_ORCHESTRATOR = "supabase/functions/_shared/recruiter-checkout.ts";
const AGENCY_ORCHESTRATOR = "supabase/functions/_shared/agency-checkout.ts";
const SELF = "src/test/phase1rD2B3BusinessCheckoutIntegration.test.ts";
const WORKFLOW = ".github/workflows/recruiter-checkout-postgres.yml";

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

const recruiterSrc = read(RECRUITER_EDGE);
const agencySrc = read(AGENCY_EDGE);
const sharedSrc = read(SHARED_CLAIM);
const recruiterOrchestratorSrc = read(RECRUITER_ORCHESTRATOR);
const agencyOrchestratorSrc = read(AGENCY_ORCHESTRATOR);

/** Extract one top-level `function name(...) { ... }` body by brace counting. */
function extractFunction(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `function ${name} not found`).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  expect(open).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

/** Source window between two exact markers, used for ordering proofs. */
function windowBetween(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  expect(a, `marker not found: ${from}`).toBeGreaterThan(-1);
  expect(b, `marker not found: ${to}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

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

const CLAIM_ARGS = {
  userId: "u1",
  context: "recruiter" as const,
  subjectId: "r1",
  planKey: "growth" as const,
  requestKey: "k",
};

describe("claim store RPC contract", () => {
  it("exposes exactly three methods and no fourth", () => {
    const { client } = recordingClient(null);
    const store = createBusinessCheckoutClaimStore(client);
    expect(Object.keys(store).sort()).toEqual(["claim", "complete", "release"]);
  });

  it("uses exactly the three promoted B2 RPC names", () => {
    expect(BUSINESS_CLAIM_RPC_NAMES).toEqual({
      claim: "claim_business_checkout",
      complete: "complete_business_checkout_claim",
      release: "release_business_checkout_claim",
    });
  });

  it("calls claim_business_checkout with exact snake_case args", async () => {
    const { calls, client } = recordingClient([{ outcome: "acquired" }]);
    await createBusinessCheckoutClaimStore(client).claim(CLAIM_ARGS);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("claim_business_checkout");
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
    expect(calls[0].name).toBe("complete_business_checkout_claim");
    expect(calls[0].args).toEqual({
      _user_id: "u1",
      _context: "agency",
      _claim_token: "t1",
      _session_id: "cs_1",
      _checkout_expires_at: "2026-07-30T00:00:00.000Z",
    });
    expect(calls[1].name).toBe("release_business_checkout_claim");
    expect(calls[1].args).toEqual({
      _user_id: "u1",
      _context: "agency",
      _claim_token: "t1",
      _error_code: "agency_transient_error",
      _terminal: false,
    });
  });

  it("accepts a singleton object row", async () => {
    const { client } = recordingClient({
      outcome: "acquired",
      claim_token: "tok",
      generation: 4,
    });
    const row = await createBusinessCheckoutClaimStore(client).claim(CLAIM_ARGS);
    expect(row.outcome).toBe("acquired");
    expect(row.claim_token).toBe("tok");
    expect(row.generation).toBe(4);
  });

  it("accepts a one-element array row", async () => {
    const { client } = recordingClient([
      { outcome: "acquired", claim_token: "tok", generation: 4 },
    ]);
    const row = await createBusinessCheckoutClaimStore(client).claim(CLAIM_ARGS);
    expect(row.outcome).toBe("acquired");
    expect(row.claim_token).toBe("tok");
    expect(row.generation).toBe(4);
  });

  it("fails closed on empty, multi-row, and malformed payloads", async () => {
    const payloads: unknown[] = [
      [],
      [{ outcome: "acquired" }, { outcome: "acquired" }],
      [[{ outcome: "acquired" }]],
      [null],
      ["acquired"],
      [42],
      null,
      undefined,
      "acquired",
      7,
      true,
    ];
    for (const data of payloads) {
      const { client } = recordingClient(data);
      const store = createBusinessCheckoutClaimStore(client);
      const claimRow = await store.claim(CLAIM_ARGS);
      expect(claimRow.outcome).toBe("unknown");
      expect(claimRow.claim_token).toBeNull();
      expect(claimRow.generation).toBeNull();
      const simple = await store.release({
        userId: "u",
        context: "recruiter",
        claimToken: "t",
        errorCode: "recruiter_transient_error",
        terminal: false,
      });
      expect(simple.outcome).toBe("unknown");
      expect(simple.reason).toBeNull();
    }
  });

  it("rejects non-integer and non-positive generations", async () => {
    for (const generation of [1.5, "3", Number.NaN, Infinity, null]) {
      const { client } = recordingClient({ outcome: "acquired", generation });
      const row = await createBusinessCheckoutClaimStore(client).claim(CLAIM_ARGS);
      expect(row.generation).toBeNull();
    }
  });

  it("never exposes raw RPC error text", async () => {
    const secret = "connection to db-host-42 failed for user postgres";
    const { client } = recordingClient(null, { message: secret });
    const store = createBusinessCheckoutClaimStore(client);
    for (const call of [
      () => store.claim(CLAIM_ARGS),
      () =>
        store.complete({
          userId: "u",
          context: "recruiter",
          claimToken: "t",
          sessionId: "cs",
          checkoutExpiresAt: "1970-01-01T00:00:01.000Z",
        }),
      () =>
        store.release({
          userId: "u",
          context: "recruiter",
          claimToken: "t",
          errorCode: "recruiter_transient_error",
          terminal: true,
        }),
    ]) {
      let message = "";
      try {
        await call();
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toBe("business_claim_rpc_failed");
      expect(message).not.toContain(secret);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Deterministic request key
// ---------------------------------------------------------------------------

describe("request key", () => {
  it("has the exact format and is deterministic", () => {
    const args = {
      context: "agency",
      subjectId: "ag1",
      planKey: "agency_team",
    } as const;
    expect(businessCheckoutRequestKey(args)).toBe(
      "htp:business-checkout:agency:ag1:agency_team",
    );
    expect(businessCheckoutRequestKey(args)).toBe(
      businessCheckoutRequestKey(args),
    );
  });

  it("separates context, subject, and plan", () => {
    const base = {
      context: "agency",
      subjectId: "ag1",
      planKey: "agency_team",
    } as const;
    const keys = new Set([
      businessCheckoutRequestKey(base),
      businessCheckoutRequestKey({ ...base, context: "recruiter" }),
      businessCheckoutRequestKey({ ...base, subjectId: "ag2" }),
      businessCheckoutRequestKey({ ...base, planKey: "agency_growth" }),
    ]);
    expect(keys.size).toBe(4);
  });

  it("stays within the B2 request_key length bound for real UUID subjects", () => {
    const key = businessCheckoutRequestKey({
      context: "recruiter",
      subjectId: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
      planKey: "fleet",
    });
    expect(key).toBe(
      "htp:business-checkout:recruiter:3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c:fleet",
    );
    expect(key.length).toBeLessThanOrEqual(200);
  });

  it("accepts no client-supplied request key in its signature", () => {
    expect(businessCheckoutRequestKey.length).toBe(1);
    const fnSrc = extractFunction(sharedSrc, "businessCheckoutRequestKey");
    expect(fnSrc).not.toContain("requestKey");
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
  it("returns acquired with the claim token and generation", async () => {
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

  it("fails closed on every defective acquired row", async () => {
    const defects: Array<Record<string, unknown>> = [
      { claim_plan_key: "fleet" },
      { claim_subject_id: "r2" },
      { claim_context: "agency" },
      { claim_token: null },
      { generation: 0 },
      { generation: -1 },
      { generation: null },
      { claim_state: "ready" },
      { claim_state: null },
    ];
    for (const defect of defects) {
      const d = await beginBusinessCheckout(
        INPUT,
        storeReturning({
          outcome: "acquired",
          ...OK_IDENTITY,
          generation: 1,
          claim_token: "tok",
          claim_state: "processing",
          ...defect,
        }),
        1000,
      );
      expect(d).toEqual({ kind: "transient" });
    }
  });

  it("maps a reused processing claim to in_progress and leaks no token", async () => {
    const d = await beginBusinessCheckout(
      INPUT,
      storeReturning({
        outcome: "reused",
        ...OK_IDENTITY,
        generation: 3,
        claim_state: "processing",
        claim_token: "leaky",
      }),
      1000,
    );
    expect(d).toEqual({ kind: "in_progress", generation: 3 });
    expect(Object.keys(d).sort()).toEqual(["generation", "kind"]);
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

  it("fails closed on every defective ready row", async () => {
    const defects: Array<Record<string, unknown>> = [
      { stripe_checkout_session_id: null },
      { checkout_expires_at: null },
      { checkout_expires_at: "not-a-date" },
      // Fractional epoch second — must never be floored into acceptance.
      { checkout_expires_at: "1970-01-01T00:30:00.500Z" },
      // Already expired relative to nowSeconds = 1000.
      { checkout_expires_at: "1970-01-01T00:00:10.000Z" },
      // Exactly now is not in the future.
      { checkout_expires_at: "1970-01-01T00:16:40.000Z" },
      { claim_subject_id: "r2" },
      { claim_plan_key: "starter" },
      { generation: 0 },
    ];
    for (const defect of defects) {
      const d = await beginBusinessCheckout(
        INPUT,
        storeReturning({
          outcome: "reused",
          ...OK_IDENTITY,
          generation: 2,
          claim_state: "ready",
          stripe_checkout_session_id: "cs_live",
          checkout_expires_at: "1970-01-01T00:30:00.000Z",
          ...defect,
        }),
        1000,
      );
      expect(d).toEqual({ kind: "transient" });
    }
  });

  it("propagates blocked reasons safely and maps not_owner", async () => {
    for (const reason of [
      "agency_entitlement_exists",
      "agency_billing_requires_management",
      "recruiter_subscription_exists",
      "opposing_claim_active",
      "same_context_claim_active",
      "opposing_entitlement_unknown",
    ]) {
      expect(
        await beginBusinessCheckout(
          INPUT,
          storeReturning({ outcome: "blocked", reason }),
          1000,
        ),
      ).toEqual({ kind: "blocked", reason });
    }
    expect(
      await beginBusinessCheckout(
        INPUT,
        storeReturning({ outcome: "blocked", reason: null }),
        1000,
      ),
    ).toEqual({ kind: "blocked", reason: "unknown" });
    expect(
      await beginBusinessCheckout(
        INPUT,
        storeReturning({ outcome: "not_owner", reason: "x" }),
        1000,
      ),
    ).toEqual({ kind: "not_owner" });
  });

  it("treats invalid_input, unknown outcomes, and store throws as transient", async () => {
    for (const outcome of ["invalid_input", "weird", "", "ACQUIRED"]) {
      expect(
        await beginBusinessCheckout(INPUT, storeReturning({ outcome }), 1000),
      ).toEqual({ kind: "transient" });
    }
    const throwing: BusinessCheckoutClaimStore = {
      ...storeReturning({}),
      async claim() {
        throw new Error("business_claim_rpc_failed");
      },
    };
    expect(await beginBusinessCheckout(INPUT, throwing, 1000)).toEqual({
      kind: "transient",
    });
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

  function withComplete(
    row: { outcome: string; reason: string | null } | "throw",
  ): BusinessCheckoutClaimStore {
    return {
      ...storeReturning({}),
      async complete() {
        if (row === "throw") throw new Error("business_claim_rpc_failed");
        return row;
      },
    };
  }

  it("accepts completed with and without already_completed", async () => {
    expect(
      await completeBusinessCheckout(
        args,
        withComplete({ outcome: "completed", reason: null }),
      ),
    ).toBe("completed");
    expect(
      await completeBusinessCheckout(
        args,
        withComplete({ outcome: "completed", reason: "already_completed" }),
      ),
    ).toBe("completed");
  });

  it("maps every other normalized completion outcome to rejected", async () => {
    for (const outcome of [
      "lease_invalid",
      "not_owner",
      "invalid_input",
      "unknown",
      "",
    ]) {
      expect(
        await completeBusinessCheckout(args, withComplete({ outcome, reason: null })),
      ).toBe("rejected");
    }
  });

  it("maps a completion throw to transient", async () => {
    expect(await completeBusinessCheckout(args, withComplete("throw"))).toBe(
      "transient",
    );
  });

  const releaseArgs = {
    userId: "u",
    context: "agency" as const,
    claimToken: "t",
    errorCode: "agency_transient_error",
    terminal: false,
  };

  function withRelease(
    row: { outcome: string; reason: string | null } | "throw",
  ): BusinessCheckoutClaimStore {
    return {
      ...storeReturning({}),
      async release() {
        if (row === "throw") throw new Error("business_claim_rpc_failed");
        return row;
      },
    };
  }

  it("accepts released and failed as successful releases", async () => {
    for (const outcome of ["released", "failed"]) {
      expect(
        await releaseBusinessCheckout(
          releaseArgs,
          withRelease({ outcome, reason: null }),
        ),
      ).toBe(true);
    }
  });

  it("returns false and never throws on rejection or RPC error", async () => {
    for (const outcome of ["lease_invalid", "not_owner", "unknown", ""]) {
      expect(
        await releaseBusinessCheckout(
          releaseArgs,
          withRelease({ outcome, reason: null }),
        ),
      ).toBe(false);
    }
    await expect(
      releaseBusinessCheckout(releaseArgs, withRelease("throw")),
    ).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Failure code helper + retryability
// ---------------------------------------------------------------------------

describe("businessCheckoutFailureCode", () => {
  it("prefixes valid snake_case public codes", () => {
    expect(businessCheckoutFailureCode("recruiter", "transient_error")).toBe(
      "recruiter_transient_error",
    );
    expect(businessCheckoutFailureCode("recruiter", "internal_error")).toBe(
      "recruiter_internal_error",
    );
    expect(
      businessCheckoutFailureCode("recruiter", "session_identity_missing"),
    ).toBe("recruiter_session_identity_missing");
    expect(businessCheckoutFailureCode("agency", "internal_error")).toBe(
      "agency_internal_error",
    );
    expect(
      businessCheckoutFailureCode("agency", "session_identity_missing"),
    ).toBe("agency_session_identity_missing");
  });

  it("falls back to the exact context fallback for malformed codes", () => {
    for (const bad of ["", "Bad Code", "UPPER", "_lead", "trail_", "a--b", 42, null, undefined, {}]) {
      expect(businessCheckoutFailureCode("agency", bad)).toBe(
        "agency_checkout_error",
      );
      expect(businessCheckoutFailureCode("recruiter", bad)).toBe(
        "recruiter_checkout_error",
      );
    }
    expect(businessCheckoutFailureCode("agency", "x".repeat(80))).toBe(
      "agency_checkout_error",
    );
  });
});

describe("isRetryableCheckoutCode", () => {
  it("exposes the exact retryable list and nothing else", () => {
    expect([...RETRYABLE_CHECKOUT_CODES]).toEqual([
      "transient_error",
      "in_progress",
      "checkout_processing",
    ]);
    for (const code of RETRYABLE_CHECKOUT_CODES) {
      expect(isRetryableCheckoutCode(code)).toBe(true);
    }
    for (const terminal of [
      "not_owner",
      "not_eligible",
      "invalid_plan",
      "invalid_price",
      "invalid_origin",
      "session_invalid",
      "subscription_exists",
      "support_required",
      "internal_error",
      "agency_entitlement_exists",
      "recruiter_subscription_exists",
      "opposing_entitlement_unknown",
      "",
      null,
      undefined,
      7,
    ]) {
      expect(isRetryableCheckoutCode(terminal)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Session capture resolution
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

const SESSION_URL = "https://checkout.stripe.com/c/pay/cs_1";

describe("resolveCapturedCheckoutSession", () => {
  it("resolves a unique open future session to the exact id and ISO expiry", () => {
    expect(resolveCapturedCheckoutSession([session()], SESSION_URL, 1000)).toEqual({
      sessionId: "cs_1",
      checkoutExpiresAt: "1970-01-01T00:33:20.000Z",
    });
  });

  it("ignores non-matching sessions when exactly one matches", () => {
    const others = [
      session({ id: "cs_2", url: "https://checkout.stripe.com/c/pay/cs_2" }),
      session({ id: "cs_3", status: "expired" }),
    ];
    expect(
      resolveCapturedCheckoutSession([...others, session()], SESSION_URL, 1000),
    ).toEqual({ sessionId: "cs_1", checkoutExpiresAt: "1970-01-01T00:33:20.000Z" });
  });

  it("returns null for zero matches", () => {
    expect(resolveCapturedCheckoutSession([], SESSION_URL, 1000)).toBeNull();
    expect(
      resolveCapturedCheckoutSession(
        [session({ url: "https://checkout.stripe.com/c/pay/other" })],
        SESSION_URL,
        1000,
      ),
    ).toBeNull();
  });

  it("returns null when two distinct sessions share the returned URL", () => {
    expect(
      resolveCapturedCheckoutSession(
        [session(), session({ id: "cs_2" })],
        SESSION_URL,
        1000,
      ),
    ).toBeNull();
  });

  it("is ambiguous for an undeduplicated duplicate, which is why edges dedupe by id", () => {
    // Two captures of the SAME session id — exactly what an edge would produce
    // without the Phase 1R-D2-B3-R1 request-local Map.
    expect(
      resolveCapturedCheckoutSession([session(), session()], SESSION_URL, 1000),
    ).toBeNull();
    // After dedup by id the Map yields exactly one value and resolution works.
    const deduped = new Map<string, CapturedCheckoutSession>();
    for (const s of [session(), session()]) deduped.set(s.id, s);
    expect(deduped.size).toBe(1);
    expect(
      resolveCapturedCheckoutSession([...deduped.values()], SESSION_URL, 1000),
    ).toEqual({ sessionId: "cs_1", checkoutExpiresAt: "1970-01-01T00:33:20.000Z" });
  });

  it("rejects closed, expired, and malformed captures", () => {
    const bad: Array<Partial<CapturedCheckoutSession>> = [
      { status: "complete" },
      { status: "expired" },
      { status: "" },
      { id: "" },
      { expiresAtSeconds: 1000 },
      { expiresAtSeconds: 500 },
      { expiresAtSeconds: 0 },
      { expiresAtSeconds: 2000.5 },
      { expiresAtSeconds: Number.NaN },
      { url: null },
    ];
    for (const over of bad) {
      expect(
        resolveCapturedCheckoutSession([session(over)], SESSION_URL, 1000),
      ).toBeNull();
    }
  });

  it("rejects a missing or non-string expected URL", () => {
    for (const url of ["", null, undefined, 7, {}]) {
      expect(resolveCapturedCheckoutSession([session()], url, 1000)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Ready-claim revalidation
// ---------------------------------------------------------------------------

const isSafeUrl = (raw: unknown) =>
  typeof raw === "string" && raw.startsWith("https://checkout.stripe.com/");

function readyInput(over: Record<string, unknown> = {}) {
  return {
    session: session(),
    expectedSessionId: "cs_1",
    claimExpiresAt: "1970-01-01T00:33:20.000Z",
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
      url: SESSION_URL,
    });
  });

  it("allows extra session metadata beyond the expected keys", () => {
    expect(
      validateReadyBusinessCheckoutSession(
        readyInput({
          session: session({
            metadata: { billing_type: "recruiter", extra: "ok", plan: "growth" },
          }),
        }),
      ),
    ).toEqual({ kind: "ready", url: SESSION_URL });
  });

  it("reports processing for an exactly matching completed session", () => {
    expect(
      validateReadyBusinessCheckoutSession(
        readyInput({ session: session({ status: "complete", url: null }) }),
      ),
    ).toEqual({ kind: "processing" });
  });

  it("rejects every identity, expiry, status, and URL defect", () => {
    const cases: Array<Record<string, unknown>> = [
      { session: null },
      { session: session({ id: "" }) },
      { session: session({ id: "cs_other" }) },
      { expectedSessionId: "" },
      { expectedSessionId: "cs_other" },
      { session: session({ customer: "cus_other" }) },
      { session: session({ customer: null }) },
      { expectedCustomerId: "" },
      { session: session({ metadata: { billing_type: "agency" } }) },
      { session: session({ metadata: {} }) },
      { expectedMetadata: { billing_type: "recruiter", missing: "v" } },
      { claimExpiresAt: "not-a-date" },
      { claimExpiresAt: "" },
      // Fractional claim expiry must be invalid, never floored into a match.
      { claimExpiresAt: "1970-01-01T00:33:20.500Z" },
      // Claim expiry and session expiry must be exactly equal.
      { claimExpiresAt: "1970-01-01T00:33:21.000Z" },
      { session: session({ expiresAtSeconds: 3000 }) },
      { session: session({ expiresAtSeconds: 2000.5 }) },
      { session: session({ expiresAtSeconds: Number.NaN }) },
      // Expiry equals the claim but is not in the future.
      {
        session: session({ expiresAtSeconds: 500 }),
        claimExpiresAt: "1970-01-01T00:08:20.000Z",
        nowSeconds: 1000,
      },
      { session: session({ status: "expired" }) },
      { session: session({ status: "" }) },
      { session: session({ url: null }) },
      { session: session({ url: "" }) },
      { session: session({ url: "https://evil.example.com/x" }) },
    ];
    for (const over of cases) {
      expect(
        validateReadyBusinessCheckoutSession(readyInput(over)),
        JSON.stringify(Object.keys(over)),
      ).toEqual({ kind: "invalid" });
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Recruiter edge static proof
// ---------------------------------------------------------------------------

describe("recruiter edge integration", () => {
  it("uses the shared coordinator and dropped the Phase 1R-D1 precheck", () => {
    expect(recruiterSrc).toContain("../_shared/business-checkout-claim.ts");
    for (const symbol of [
      "createBusinessCheckoutClaimStore",
      "beginBusinessCheckout",
      "completeBusinessCheckout",
      "releaseBusinessCheckout",
      "resolveCapturedCheckoutSession",
      "validateReadyBusinessCheckoutSession",
    ]) {
      expect(recruiterSrc).toContain(symbol);
    }
    for (const gone of [
      "business-checkout-guard.ts",
      "evaluateRecruiterCheckoutCrossContext",
      "isCrossContextBlock",
      "resolveEffectiveBusinessEntitlement",
    ]) {
      expect(recruiterSrc).not.toContain(gone);
    }
  });

  it("claims after validation and before Stripe, orchestrator, and intent work", () => {
    const begin = recruiterSrc.indexOf("await beginBusinessCheckout(");
    expect(begin).toBeGreaterThan(-1);
    for (const before of [
      "isRecruiterPlan(plan)",
      'from("recruiter_profiles")',
      "isAllowedRecruiterOrigin(reqOrigin)",
    ]) {
      expect(recruiterSrc.indexOf(before)).toBeGreaterThan(-1);
      expect(recruiterSrc.indexOf(before)).toBeLessThan(begin);
    }
    for (const after of [
      "new Stripe(stripeKey",
      "await runRecruiterCheckout(",
      "claim_recruiter_checkout_intent",
    ]) {
      expect(recruiterSrc.indexOf(after)).toBeGreaterThan(begin);
    }
    expect(recruiterSrc).toContain('context: "recruiter"');
    expect(recruiterSrc).not.toContain('context: "agency"');
  });

  it("returns 409 for every block reason and 403 only for not_owner", () => {
    const fn = extractFunction(recruiterSrc, "recruiterBlockedResult");
    expect(fn).not.toContain("status: 403");
    for (const code of [
      "agency_entitlement_exists",
      "agency_billing_requires_management",
      "opposing_claim_active",
      "same_context_claim_active",
      "opposing_entitlement_unknown",
      "in_progress",
    ]) {
      expect(fn).toContain(code);
    }
    expect(fn.match(/status: 409/g) ?? []).toHaveLength(4);
    const notOwner = windowBetween(
      recruiterSrc,
      'if (begin.kind === "not_owner")',
      'if (begin.kind === "blocked")',
    );
    expect(notOwner).toContain("status: 403");
    expect(notOwner).toContain('code: "not_owner"');
  });

  it("returns support_required when a ready claim has no canonical customer", () => {
    const ready = windowBetween(
      recruiterSrc,
      'if (begin.kind === "ready")',
      "let capturedReady",
    );
    expect(ready).toContain('from("recruiter_billing_profiles")');
    expect(ready).toContain('code: "support_required"');
    expect(ready).not.toContain('code: "checkout_processing"');
  });

  it("revalidates the exact stored session without invoking the orchestrator", () => {
    const readyBlock = windowBetween(
      recruiterSrc,
      'if (begin.kind === "ready")',
      "// begin.kind === \"acquired\"",
    );
    expect(readyBlock).toContain(
      "stripe.checkout.sessions.retrieve(begin.sessionId)",
    );
    expect(readyBlock).toContain("validateReadyBusinessCheckoutSession({");
    expect(readyBlock).toContain("expectedSessionId: begin.sessionId");
    expect(readyBlock).toContain("claimExpiresAt: begin.checkoutExpiresAt");
    expect(readyBlock).toContain("isSafeUrl: isSafeStripeCheckoutUrl");
    expect(readyBlock).not.toContain("runRecruiterCheckout(");
    expect(readyBlock).not.toContain("completeBusinessCheckout(");
  });

  it("deduplicates captured sessions by id in a request-local map", () => {
    expect(recruiterSrc).toContain(
      "const captured = new Map<string, CapturedCheckoutSession>()",
    );
    expect(recruiterSrc).toContain("[...captured.values()]");
    expect(recruiterSrc).toContain("captured.set(projected.id, projected)");
    expect(recruiterSrc).not.toContain("captured.push(");
    const capture = extractFunction(recruiterSrc, "captureSession");
    expect(capture).toContain('projected.id === ""');
    // Both Stripe session sources feed the deduplicating capture.
    expect(recruiterSrc.match(/captureSession\(captured, s\);/g) ?? []).toHaveLength(2);
  });

  it("releases with the exact identity-missing code and returns 409 session_invalid", () => {
    const block = windowBetween(
      recruiterSrc,
      "if (!identity) {",
      "const done = await completeBusinessCheckout(",
    );
    expect(block).toContain('"session_identity_missing"');
    expect(block).toContain("terminal: true");
    expect(block).toContain("status: 409");
    expect(block).toContain('code: "session_invalid"');
    expect(block).not.toContain("url");
  });

  it("never releases and never leaks a URL when completion is rejected or transient", () => {
    const block = windowBetween(
      recruiterSrc,
      "const done = await completeBusinessCheckout(",
      "// Any non-ready orchestrator outcome releases the claim.",
    );
    expect(block).toContain('if (done === "completed")');
    expect(block).toContain('code: "checkout_processing"');
    expect(block).toContain("status: 409");
    expect(block).not.toContain("releaseBusinessCheckout");
    expect(block).not.toContain("status: 503");
    expect(block).not.toContain("result.url");
  });

  it("releases non-ready outcomes with retryability-derived terminality", () => {
    const block = windowBetween(
      recruiterSrc,
      "// Any non-ready orchestrator outcome releases the claim.",
      "} catch (_e) {",
    );
    expect(block).toContain(
      'businessCheckoutFailureCode("recruiter", result.code)',
    );
    expect(block).toContain("terminal: !isRetryableCheckoutCode(result.code)");
  });

  it("releases an unexpected post-acquisition exception non-terminally", () => {
    const block = windowBetween(
      recruiterSrc,
      "await runRecruiterCheckout(",
      'if (result.code === "checkout_ready"',
    );
    expect(block).toContain(
      'businessCheckoutFailureCode("recruiter", "internal_error")',
    );
    expect(block).toContain("terminal: false");
    expect(block).toContain("status: 500");
    expect(block).toContain('code: "internal_error"');
  });

  it("whitelists only code, message, and url in every response body", () => {
    const fn = extractFunction(recruiterSrc, "jsonResponse");
    expect(fn).toContain("code: result.code");
    expect(fn).toContain("message: result.message");
    expect(fn).toContain("body.url = result.url");
    for (const secret of [
      "claimToken",
      "claim_token",
      "sessionId",
      "stripe_customer_id",
      "generation",
      "email",
      "reason",
    ]) {
      expect(fn).not.toContain(secret);
    }
  });

  it("never accepts a client-supplied request key, claim token, or price", () => {
    for (const forbidden of [
      "body.requestKey",
      "body.request_key",
      "body.claimToken",
      "body.claim_token",
      "body.sessionId",
    ]) {
      expect(recruiterSrc).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Agency edge static proof
// ---------------------------------------------------------------------------

describe("agency edge integration", () => {
  it("uses the shared coordinator and dropped the Phase 1R-D1 precheck", () => {
    expect(agencySrc).toContain("../_shared/business-checkout-claim.ts");
    for (const symbol of [
      "createBusinessCheckoutClaimStore",
      "beginBusinessCheckout",
      "completeBusinessCheckout",
      "releaseBusinessCheckout",
      "resolveCapturedCheckoutSession",
      "validateReadyBusinessCheckoutSession",
    ]) {
      expect(agencySrc).toContain(symbol);
    }
    for (const gone of [
      "business-checkout-guard.ts",
      "evaluateAgencyCheckoutCrossContext",
      "isCrossContextBlock",
    ]) {
      expect(agencySrc).not.toContain(gone);
    }
  });

  it("claims after validation and before Stripe and the orchestrator", () => {
    const begin = agencySrc.indexOf("await beginBusinessCheckout(");
    expect(begin).toBeGreaterThan(-1);
    for (const before of [
      "isAgencyPlanKey(planKey)",
      'from("agency_profiles")',
      'from("agency_members")',
      "isAllowedAgencyOrigin(reqOrigin)",
    ]) {
      expect(agencySrc.indexOf(before)).toBeGreaterThan(-1);
      expect(agencySrc.indexOf(before)).toBeLessThan(begin);
    }
    for (const after of ["new Stripe(stripeKey", "await runAgencyCheckout("]) {
      expect(agencySrc.indexOf(after)).toBeGreaterThan(begin);
    }
    expect(agencySrc).toContain('context: "agency"');
    expect(agencySrc).not.toContain('context: "recruiter"');
  });

  it("returns 409 for every block reason and 403 only for not_owner", () => {
    const fn = extractFunction(agencySrc, "agencyBlockedResult");
    expect(fn).not.toContain("status: 403");
    for (const code of [
      "recruiter_subscription_exists",
      "opposing_claim_active",
      "same_context_claim_active",
      "opposing_entitlement_unknown",
      "in_progress",
    ]) {
      expect(fn).toContain(code);
    }
    expect(fn.match(/status: 409/g) ?? []).toHaveLength(3);
    const notOwner = windowBetween(
      agencySrc,
      'if (begin.kind === "not_owner")',
      'if (begin.kind === "blocked")',
    );
    expect(notOwner).toContain("status: 403");
    expect(notOwner).toContain('code: "not_owner"');
  });

  it("returns support_required when a ready claim has no canonical customer", () => {
    const ready = windowBetween(
      agencySrc,
      'if (begin.kind === "ready")',
      "let capturedReady",
    );
    expect(ready).toContain('from("agency_entitlements")');
    expect(ready).toContain('code: "support_required"');
    expect(ready).not.toContain('code: "checkout_processing"');
  });

  it("revalidates the exact stored session without invoking the orchestrator", () => {
    const readyBlock = windowBetween(
      agencySrc,
      'if (begin.kind === "ready")',
      "// begin.kind === \"acquired\"",
    );
    expect(readyBlock).toContain(
      "stripe.checkout.sessions.retrieve(begin.sessionId)",
    );
    expect(readyBlock).toContain("expectedSessionId: begin.sessionId");
    expect(readyBlock).toContain("claimExpiresAt: begin.checkoutExpiresAt");
    expect(readyBlock).toContain("isSafeUrl: isSafeAgencyCheckoutUrl");
    expect(readyBlock).not.toContain("runAgencyCheckout(");
    expect(readyBlock).not.toContain("completeBusinessCheckout(");
  });

  it("deduplicates captured sessions by id in a request-local map", () => {
    expect(agencySrc).toContain(
      "const captured = new Map<string, CapturedCheckoutSession>()",
    );
    expect(agencySrc).toContain("[...captured.values()]");
    expect(agencySrc).toContain("captured.set(projected.id, projected)");
    expect(agencySrc).not.toContain("captured.push(");
    const capture = extractFunction(agencySrc, "captureSession");
    expect(capture).toContain('projected.id === ""');
    // listAllSessions pagination and createSession both feed the dedup map.
    expect(agencySrc).toContain("captureSession(captured, n);");
    expect(agencySrc).toContain("captureSession(captured, s);");
  });

  it("releases with the exact identity-missing code and returns 409 session_invalid", () => {
    const block = windowBetween(
      agencySrc,
      "if (!identity) {",
      "const done = await completeBusinessCheckout(",
    );
    expect(block).toContain('"session_identity_missing"');
    expect(block).toContain("terminal: true");
    expect(block).toContain("status: 409");
    expect(block).toContain('code: "session_invalid"');
    expect(block).not.toContain("url");
  });

  it("never releases and never leaks a URL when completion is rejected or transient", () => {
    const block = windowBetween(
      agencySrc,
      "const done = await completeBusinessCheckout(",
      "// Any non-ready orchestrator outcome releases the claim.",
    );
    expect(block).toContain('if (done === "completed")');
    expect(block).toContain('code: "checkout_processing"');
    expect(block).toContain("status: 409");
    expect(block).not.toContain("releaseBusinessCheckout");
    expect(block).not.toContain("status: 503");
    expect(block).not.toContain("result.url");
  });

  it("releases an unexpected post-acquisition exception non-terminally", () => {
    const block = windowBetween(
      agencySrc,
      "await runAgencyCheckout(",
      'if (result.code === "checkout_ready"',
    );
    expect(block).toContain(
      'businessCheckoutFailureCode("agency", "internal_error")',
    );
    expect(block).toContain("terminal: false");
    expect(block).toContain("status: 500");
  });

  it("keeps the entitlement store customer-id-only and webhook-owned", () => {
    const store = windowBetween(
      agencySrc,
      "const store: AgencyEntitlementStore = {",
      "const stripeGateway: AgencyStripeGateway",
    );
    expect(store).toContain("stripe_customer_id");
    for (const owned of [
      "plan_key",
      "plan:",
      "status:",
      "subscription_id",
      "stripe_subscription_id",
      "seats",
    ]) {
      expect(store).not.toContain(owned);
    }
  });

  it("looks customers up by exact metadata, never by email", () => {
    expect(agencySrc).toContain("metadata['billing_context']:'agency'");
    expect(agencySrc).toContain("metadata['agency_id']");
    expect(agencySrc).toContain("metadata['owner_user_id']");
    expect(agencySrc).not.toContain("customers.list({ email");
    expect(agencySrc).not.toContain("email:'");
  });

  it("paginates subscriptions and sessions exhaustively", () => {
    expect(agencySrc.match(/has_more/g) ?? []).toHaveLength(2);
    expect(agencySrc).toContain("status: \"all\"");
  });

  it("whitelists only code, message, and url in every response body", () => {
    const fn = extractFunction(agencySrc, "jsonResponse");
    expect(fn).toContain("code: result.code");
    expect(fn).toContain("message: result.message");
    expect(fn).toContain("body.url = result.url");
    for (const secret of [
      "claimToken",
      "claim_token",
      "sessionId",
      "stripe_customer_id",
      "email",
      "reason",
    ]) {
      expect(fn).not.toContain(secret);
    }
  });

  it("rejects client-supplied price ids and request keys", () => {
    expect(agencySrc).toContain('"priceId" in body');
    for (const forbidden of [
      "body.requestKey",
      "body.request_key",
      "body.claimToken",
      "body.claim_token",
    ]) {
      expect(agencySrc).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Shared module, orchestrators, workflow, and hygiene
// ---------------------------------------------------------------------------

describe("shared coordinator and unchanged artifacts", () => {
  it("stays runtime-neutral", () => {
    expect(sharedSrc).not.toContain("Deno.");
    expect(sharedSrc).not.toContain("createClient");
    expect(sharedSrc).not.toContain('from "https://');
    expect(sharedSrc).not.toContain("npm:@supabase");
    expect(sharedSrc).not.toContain("setTimeout");
    expect(sharedSrc).not.toContain("Date.now()");
  });

  it("normalizes rows fail-closed with no first-row-wins fallback", () => {
    expect(sharedSrc).toContain("function singleRow(");
    expect(sharedSrc).not.toContain("function firstRow(");
    const fn = extractFunction(sharedSrc, "singleRow");
    expect(fn).toContain("data.length !== 1");
  });

  it("parses claim expiry as an exact integer epoch second", () => {
    const fn = extractFunction(sharedSrc, "exactEpochSecondsFromIso");
    expect(fn).toContain("ms % 1000 !== 0");
    expect(fn).toContain("Number.isInteger(seconds)");
    expect(fn).not.toContain("Math.floor");
    expect(sharedSrc).not.toContain("epochSecondsFromIso(row.checkout_expires_at)\n");
  });

  it("neither orchestrator references the B3 claim layer", () => {
    for (const src of [recruiterOrchestratorSrc, agencyOrchestratorSrc]) {
      for (const forbidden of [
        "claim_business_checkout",
        "complete_business_checkout_claim",
        "release_business_checkout_claim",
        "business-checkout-claim",
        "beginBusinessCheckout",
        "createClient",
        "@supabase/supabase-js",
        "Deno.",
      ]) {
        expect(src).not.toContain(forbidden);
      }
    }
  });

  it("the claim RPC names match the promoted B2 migration", () => {
    const migration = read(
      "supabase/migrations/20260730070000_phase1r_d2_b2_business_checkout_claims.sql",
    );
    for (const name of Object.values(BUSINESS_CLAIM_RPC_NAMES)) {
      expect(migration).toContain(`public.${name}(`);
    }
  });

  it("the CI filter lists the B3 artifacts and not the agency orchestrator", () => {
    const workflow = read(WORKFLOW);
    for (const path of [
      "supabase/functions/_shared/business-checkout-claim.ts",
      "supabase/functions/create-agency-checkout/index.ts",
      "supabase/functions/create-recruiter-checkout/index.ts",
      "src/test/phase1rD2B3BusinessCheckoutIntegration.test.ts",
    ]) {
      expect(workflow.match(new RegExp(`'${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`, "g")) ?? []).toHaveLength(2);
    }
    expect(workflow).not.toContain(
      "'supabase/functions/_shared/agency-checkout.ts'",
    );
    expect(workflow).not.toMatch(/\n\n\s+- '/);
  });

  it("contains no focused, skipped, or deferred tests", () => {
    const self = read(SELF);
    // Tokens are assembled at runtime so this file never matches itself.
    const runner = ["describe", "it", "test"].join("|");
    const modifier = ["only", "skip", "todo"].join("|");
    const forbidden = new RegExp(`\\b(${runner})\\.(${modifier})\\(`);
    expect(forbidden.test(self)).toBe(false);
    for (const banned of [
      ["use", "FakeTimers"].join(""),
      ["toMatch", "Snapshot"].join(""),
      ["global", "Fetch"].join(""),
    ]) {
      expect(self).not.toContain(banned);
    }
  });
});
