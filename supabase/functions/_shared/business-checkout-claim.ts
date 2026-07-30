// Phase 1R-D2-B3 — shared atomic business checkout claim coordinator.
//
// Runtime-neutral: no Deno globals, no Supabase import, no Stripe SDK, no env
// reads, no timers, no React. All I/O flows through the injected narrow RPC
// client so this module is directly importable by Vitest.
//
// This module owns ONLY the coordination contract around the Phase 1R-D2-B2
// PostgreSQL state machine (`claim_business_checkout`,
// `complete_business_checkout_claim`, `release_business_checkout_claim`).
// It never talks to Stripe and never inspects entitlement rows directly.

// ---------------------------------------------------------------------------
// A1. Exact vocabularies
// ---------------------------------------------------------------------------

export type BusinessCheckoutContext = "recruiter" | "agency";

export type BusinessCheckoutPlanKey =
  | "starter"
  | "growth"
  | "fleet"
  | "agency_starter"
  | "agency_team"
  | "agency_growth";

export const BUSINESS_CHECKOUT_CONTEXTS: readonly BusinessCheckoutContext[] = [
  "recruiter",
  "agency",
];

export const BUSINESS_CHECKOUT_PLAN_KEYS: readonly BusinessCheckoutPlanKey[] = [
  "starter",
  "growth",
  "fleet",
  "agency_starter",
  "agency_team",
  "agency_growth",
];

/** Stable internal error thrown when an RPC transport/DB error occurs. */
export const BUSINESS_CLAIM_RPC_FAILED = "business_claim_rpc_failed";

// ---------------------------------------------------------------------------
// A2. Narrow RPC client and store
// ---------------------------------------------------------------------------

export interface BusinessCheckoutRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
}

export interface BusinessCheckoutClaimRow {
  outcome: string;
  reason: string | null;
  claim_context: string | null;
  claim_subject_id: string | null;
  claim_plan_key: string | null;
  generation: number | null;
  claim_token: string | null;
  claim_state: string | null;
  stripe_checkout_session_id: string | null;
  checkout_expires_at: string | null;
}

export interface BusinessCheckoutSimpleRow {
  outcome: string;
  reason: string | null;
}

export interface BusinessCheckoutClaimStore {
  claim(input: {
    userId: string;
    context: BusinessCheckoutContext;
    subjectId: string;
    planKey: BusinessCheckoutPlanKey;
    requestKey: string;
  }): Promise<BusinessCheckoutClaimRow>;
  complete(input: {
    userId: string;
    context: BusinessCheckoutContext;
    claimToken: string;
    sessionId: string;
    checkoutExpiresAt: string;
  }): Promise<BusinessCheckoutSimpleRow>;
  release(input: {
    userId: string;
    context: BusinessCheckoutContext;
    claimToken: string;
    errorCode: string;
    terminal: boolean;
  }): Promise<BusinessCheckoutSimpleRow>;
}

export const BUSINESS_CLAIM_RPC_NAMES = {
  claim: "claim_business_checkout",
  complete: "complete_business_checkout_claim",
  release: "release_business_checkout_claim",
} as const;

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v)
    ? v
    : null;
}

/** Fail-closed array/singleton normalization. Never surfaces raw RPC data. */
function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

function normalizeClaimRow(data: unknown): BusinessCheckoutClaimRow {
  const row = firstRow(data);
  return {
    outcome: str(row?.outcome) ?? "unknown",
    reason: str(row?.reason),
    claim_context: str(row?.claim_context),
    claim_subject_id: str(row?.claim_subject_id),
    claim_plan_key: str(row?.claim_plan_key),
    generation: intOrNull(row?.generation),
    claim_token: str(row?.claim_token),
    claim_state: str(row?.claim_state),
    stripe_checkout_session_id: str(row?.stripe_checkout_session_id),
    checkout_expires_at: str(row?.checkout_expires_at),
  };
}

function normalizeSimpleRow(data: unknown): BusinessCheckoutSimpleRow {
  const row = firstRow(data);
  return {
    outcome: str(row?.outcome) ?? "unknown",
    reason: str(row?.reason),
  };
}

export function createBusinessCheckoutClaimStore(
  client: BusinessCheckoutRpcClient,
): BusinessCheckoutClaimStore {
  return {
    async claim({ userId, context, subjectId, planKey, requestKey }) {
      const { data, error } = await client.rpc(BUSINESS_CLAIM_RPC_NAMES.claim, {
        _user_id: userId,
        _context: context,
        _subject_id: subjectId,
        _plan_key: planKey,
        _request_key: requestKey,
      });
      if (error) throw new Error(BUSINESS_CLAIM_RPC_FAILED);
      return normalizeClaimRow(data);
    },
    async complete({ userId, context, claimToken, sessionId, checkoutExpiresAt }) {
      const { data, error } = await client.rpc(
        BUSINESS_CLAIM_RPC_NAMES.complete,
        {
          _user_id: userId,
          _context: context,
          _claim_token: claimToken,
          _session_id: sessionId,
          _checkout_expires_at: checkoutExpiresAt,
        },
      );
      if (error) throw new Error(BUSINESS_CLAIM_RPC_FAILED);
      return normalizeSimpleRow(data);
    },
    async release({ userId, context, claimToken, errorCode, terminal }) {
      const { data, error } = await client.rpc(
        BUSINESS_CLAIM_RPC_NAMES.release,
        {
          _user_id: userId,
          _context: context,
          _claim_token: claimToken,
          _error_code: errorCode,
          _terminal: terminal,
        },
      );
      if (error) throw new Error(BUSINESS_CLAIM_RPC_FAILED);
      return normalizeSimpleRow(data);
    },
  };
}

// ---------------------------------------------------------------------------
// A3. Deterministic request key (never client supplied)
// ---------------------------------------------------------------------------

export function businessCheckoutRequestKey(input: {
  context: BusinessCheckoutContext;
  subjectId: string;
  planKey: BusinessCheckoutPlanKey;
}): string {
  return `htp:business-checkout:${input.context}:${input.subjectId}:${input.planKey}`;
}

// ---------------------------------------------------------------------------
// A4. Start-decision API
// ---------------------------------------------------------------------------

export type BusinessCheckoutStartDecision =
  | { kind: "acquired"; claimToken: string; generation: number }
  | {
      kind: "ready";
      generation: number;
      sessionId: string;
      checkoutExpiresAt: string;
    }
  | { kind: "in_progress"; generation: number }
  | { kind: "blocked"; reason: string }
  | { kind: "not_owner" }
  | { kind: "transient" };

export interface BeginBusinessCheckoutInput {
  userId: string;
  context: BusinessCheckoutContext;
  subjectId: string;
  planKey: BusinessCheckoutPlanKey;
}

const TRANSIENT: BusinessCheckoutStartDecision = { kind: "transient" };

function identityMatches(
  row: BusinessCheckoutClaimRow,
  input: BeginBusinessCheckoutInput,
): boolean {
  return (
    row.claim_context === input.context &&
    row.claim_subject_id === input.subjectId &&
    row.claim_plan_key === input.planKey
  );
}

function epochSecondsFromIso(raw: string | null): number | null {
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

export async function beginBusinessCheckout(
  input: BeginBusinessCheckoutInput,
  store: BusinessCheckoutClaimStore,
  nowSeconds: number,
): Promise<BusinessCheckoutStartDecision> {
  const requestKey = businessCheckoutRequestKey({
    context: input.context,
    subjectId: input.subjectId,
    planKey: input.planKey,
  });

  let row: BusinessCheckoutClaimRow;
  try {
    row = await store.claim({
      userId: input.userId,
      context: input.context,
      subjectId: input.subjectId,
      planKey: input.planKey,
      requestKey,
    });
  } catch {
    return TRANSIENT;
  }

  const generationValid =
    typeof row.generation === "number" && row.generation > 0;

  switch (row.outcome) {
    case "acquired": {
      if (!identityMatches(row, input)) return TRANSIENT;
      if (row.claim_state !== "processing") return TRANSIENT;
      if (!row.claim_token) return TRANSIENT;
      if (!generationValid) return TRANSIENT;
      return {
        kind: "acquired",
        claimToken: row.claim_token,
        generation: row.generation as number,
      };
    }
    case "reused": {
      if (!identityMatches(row, input)) return TRANSIENT;
      if (!generationValid) return TRANSIENT;
      if (row.claim_state === "processing") {
        return { kind: "in_progress", generation: row.generation as number };
      }
      if (row.claim_state === "ready") {
        const sessionId = row.stripe_checkout_session_id;
        if (!sessionId) return TRANSIENT;
        const expiry = epochSecondsFromIso(row.checkout_expires_at);
        if (expiry === null) return TRANSIENT;
        if (!(expiry > nowSeconds)) return TRANSIENT;
        return {
          kind: "ready",
          generation: row.generation as number,
          sessionId,
          checkoutExpiresAt: row.checkout_expires_at as string,
        };
      }
      return TRANSIENT;
    }
    case "blocked": {
      return { kind: "blocked", reason: row.reason ?? "unknown" };
    }
    case "not_owner":
      return { kind: "not_owner" };
    default:
      return TRANSIENT;
  }
}

// ---------------------------------------------------------------------------
// A5. Completion wrapper
// ---------------------------------------------------------------------------

export type BusinessCheckoutCompleteOutcome =
  | "completed"
  | "rejected"
  | "transient";

export async function completeBusinessCheckout(
  input: {
    userId: string;
    context: BusinessCheckoutContext;
    claimToken: string;
    sessionId: string;
    checkoutExpiresAt: string;
  },
  store: BusinessCheckoutClaimStore,
): Promise<BusinessCheckoutCompleteOutcome> {
  try {
    const row = await store.complete(input);
    return row.outcome === "completed" ? "completed" : "rejected";
  } catch {
    return "transient";
  }
}

// ---------------------------------------------------------------------------
// A6. Best-effort release wrapper — never throws
// ---------------------------------------------------------------------------

export async function releaseBusinessCheckout(
  input: {
    userId: string;
    context: BusinessCheckoutContext;
    claimToken: string;
    errorCode: string;
    terminal: boolean;
  },
  store: BusinessCheckoutClaimStore,
): Promise<boolean> {
  try {
    const row = await store.release(input);
    return row.outcome === "released" || row.outcome === "failed";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// A7. Strict error-code helper
// ---------------------------------------------------------------------------

const STRICT_SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

export function businessCheckoutFailureCode(
  context: BusinessCheckoutContext,
  publicCode: unknown,
): string {
  const fallback = `${context}_checkout_error`;
  if (typeof publicCode !== "string" || publicCode === "") return fallback;
  if (!STRICT_SNAKE_CASE.test(publicCode)) return fallback;
  const candidate = `${context}_${publicCode}`;
  if (candidate.length > 64) return fallback;
  if (!STRICT_SNAKE_CASE.test(candidate)) return fallback;
  return candidate;
}

// ---------------------------------------------------------------------------
// A8. Retryability helper
// ---------------------------------------------------------------------------

export const RETRYABLE_CHECKOUT_CODES: readonly string[] = [
  "transient_error",
  "in_progress",
  "checkout_processing",
];

export function isRetryableCheckoutCode(code: unknown): boolean {
  return typeof code === "string" && RETRYABLE_CHECKOUT_CODES.includes(code);
}

// ---------------------------------------------------------------------------
// A9. Session-capture resolution
// ---------------------------------------------------------------------------

export interface CapturedCheckoutSession {
  id: string;
  status: string;
  url: string | null;
  customer: string | null;
  expiresAtSeconds: number;
  metadata: Record<string, string>;
}

export interface CapturedSessionIdentity {
  sessionId: string;
  checkoutExpiresAt: string;
}

export function resolveCapturedCheckoutSession(
  sessions: readonly CapturedCheckoutSession[],
  expectedUrl: unknown,
  nowSeconds: number,
): CapturedSessionIdentity | null {
  if (typeof expectedUrl !== "string" || expectedUrl === "") return null;
  const matches = sessions.filter(
    (s) =>
      typeof s?.id === "string" &&
      s.id !== "" &&
      s.status === "open" &&
      typeof s.url === "string" &&
      s.url === expectedUrl &&
      typeof s.expiresAtSeconds === "number" &&
      Number.isFinite(s.expiresAtSeconds) &&
      Number.isInteger(s.expiresAtSeconds) &&
      s.expiresAtSeconds > nowSeconds,
  );
  if (matches.length !== 1) return null;
  const only = matches[0];
  return {
    sessionId: only.id,
    checkoutExpiresAt: new Date(only.expiresAtSeconds * 1000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// A10. Ready-claim exact-session revalidation
// ---------------------------------------------------------------------------

export type ReadySessionValidation =
  | { kind: "ready"; url: string }
  | { kind: "processing" }
  | { kind: "invalid" };

export interface ValidateReadySessionInput {
  session: CapturedCheckoutSession | null;
  expectedSessionId: string;
  claimExpiresAt: string;
  expectedCustomerId: string;
  expectedMetadata: Record<string, string>;
  nowSeconds: number;
  isSafeUrl: (raw: unknown) => boolean;
}

const INVALID: ReadySessionValidation = { kind: "invalid" };

export function validateReadyBusinessCheckoutSession(
  input: ValidateReadySessionInput,
): ReadySessionValidation {
  const s = input.session;
  if (!s) return INVALID;
  if (typeof s.id !== "string" || s.id === "") return INVALID;
  if (typeof input.expectedSessionId !== "string" || input.expectedSessionId === "") {
    return INVALID;
  }
  if (s.id !== input.expectedSessionId) return INVALID;

  if (typeof input.expectedCustomerId !== "string" || input.expectedCustomerId === "") {
    return INVALID;
  }
  if (s.customer !== input.expectedCustomerId) return INVALID;

  const meta = s.metadata ?? {};
  for (const [k, v] of Object.entries(input.expectedMetadata)) {
    if (meta[k] !== v) return INVALID;
  }

  const claimExpiry = epochSecondsFromIso(
    typeof input.claimExpiresAt === "string" ? input.claimExpiresAt : null,
  );
  if (claimExpiry === null || !Number.isInteger(claimExpiry)) return INVALID;

  const sessionExpiry = s.expiresAtSeconds;
  if (
    typeof sessionExpiry !== "number" ||
    !Number.isFinite(sessionExpiry) ||
    !Number.isInteger(sessionExpiry)
  ) {
    return INVALID;
  }
  if (sessionExpiry !== claimExpiry) return INVALID;
  if (!(sessionExpiry > input.nowSeconds)) return INVALID;

  if (s.status === "complete") return { kind: "processing" };
  if (s.status === "open") {
    if (typeof s.url !== "string" || s.url === "") return INVALID;
    if (!input.isSafeUrl(s.url)) return INVALID;
    return { kind: "ready", url: s.url };
  }
  return INVALID;
}
