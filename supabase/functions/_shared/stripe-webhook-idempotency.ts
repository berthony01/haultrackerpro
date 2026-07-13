// Phase 1C-2 — Stripe webhook retry-safe idempotency orchestration.
//
// Runtime-neutral (no Deno globals, no HTTP, no URL imports). This module
// wraps the Phase 1C-validated event processor with an atomic
// claim → process → complete/fail state machine backed by Postgres. The
// real edge function and the Vitest suite drive the SAME orchestration
// through this file — tests must not fork a separate flow.
//
// The state machine lives in the DB (see the Phase 1C-2 migration and the
// three SECURITY DEFINER RPCs `claim_stripe_webhook_event`,
// `complete_stripe_webhook_event`, `fail_stripe_webhook_event`). This
// module is the small orchestrator around those RPCs.

export type ClaimResult =
  | { kind: "claimed"; claimToken: string; attempt: number }
  | { kind: "already_processed" }
  | { kind: "in_progress" }
  | { kind: "event_type_conflict" };

export type TerminalResult = "applied" | "rejected" | "ignored";

/** Small structural interface — the real edge function passes a Supabase
 *  RPC-backed implementation; tests pass an in-memory implementation that
 *  mirrors Postgres semantics (see the state-machine unit test). */
export interface LedgerClient {
  claim(eventId: string, eventType: string, leaseSeconds: number): Promise<ClaimResult>;
  complete(eventId: string, claimToken: string, result: TerminalResult): Promise<boolean>;
  fail(eventId: string, claimToken: string, errorCode: string): Promise<boolean>;
}

export type IdempotencyOutcome<T> =
  | { kind: "ok"; status: 200; body: T; result: TerminalResult; attempt: number }
  | { kind: "duplicate"; status: 200 }
  | { kind: "in_progress"; status: 500 }
  | { kind: "event_type_conflict"; status: 200 }
  | { kind: "claim_failed"; status: 500; errorCode: string }
  | { kind: "transient_failure"; status: 500; errorCode: string }
  | { kind: "complete_failed"; status: 500 };

export interface ProcessContext {
  attempt: number;
}

export interface ProcessOutcome<T> {
  result: TerminalResult;
  body: T;
}

export interface WithIdempotencyDeps<T> {
  ledger: LedgerClient;
  eventId: string;
  eventType: string;
  /** Server-controlled lease in seconds. Callers must not accept an
   *  arbitrary lease from the HTTP request. The DB clamps 30..900. The
   *  lease MUST exceed the deployed edge-function execution ceiling +
   *  safety margin so an old worker cannot still be executing when the
   *  event becomes reclaimable. Default 300s (5 min). */
  leaseSeconds?: number;
  process: (ctx: ProcessContext) => Promise<ProcessOutcome<T>>;
  /** Optional stable error-code deriver for exceptions escaping process().
   *  Must return a value matching /^[a-z0-9_]{1,64}$/. Defaults to
   *  "transient_processing_error". */
  toErrorCode?: (err: unknown) => string;
}

const ERROR_CODE_RE = /^[a-z0-9_]{1,64}$/;

export function sanitizeErrorCode(input: unknown, fallback = "transient_processing_error"): string {
  if (typeof input !== "string") return fallback;
  return ERROR_CODE_RE.test(input) ? input : fallback;
}

export const DEFAULT_LEASE_SECONDS = 300;

export async function withIdempotency<T>(
  deps: WithIdempotencyDeps<T>,
): Promise<IdempotencyOutcome<T>> {
  const lease = deps.leaseSeconds ?? DEFAULT_LEASE_SECONDS;

  let claim: ClaimResult;
  try {
    claim = await deps.ledger.claim(deps.eventId, deps.eventType, lease);
  } catch (e) {
    return { kind: "claim_failed", status: 500, errorCode: sanitizeErrorCode((e as { code?: string })?.code, "claim_rpc_failed") };
  }

  if (claim.kind === "already_processed") return { kind: "duplicate", status: 200 };
  if (claim.kind === "in_progress") return { kind: "in_progress", status: 500 };
  if (claim.kind === "event_type_conflict") return { kind: "event_type_conflict", status: 200 };

  // claimed — process the event under our lease and claim token.
  const { claimToken, attempt } = claim;

  let outcome: ProcessOutcome<T>;
  try {
    outcome = await deps.process({ attempt });
  } catch (e) {
    const code = (deps.toErrorCode ?? (() => "transient_processing_error"))(e);
    const safeCode = sanitizeErrorCode(code);
    // Best-effort mark-failed; if this also throws, the lease will expire
    // and a later delivery will reclaim.
    try {
      await deps.ledger.fail(deps.eventId, claimToken, safeCode);
    } catch {
      /* swallow — lease expiration is the safety net */
    }
    return { kind: "transient_failure", status: 500, errorCode: safeCode };
  }

  // Business processing succeeded. Must terminally record before returning 200.
  let completed = false;
  try {
    completed = await deps.ledger.complete(deps.eventId, claimToken, outcome.result);
  } catch {
    return { kind: "complete_failed", status: 500 };
  }
  if (!completed) {
    // Someone else must have already terminally completed the row (stale
    // worker guard), or the token no longer matches. Either way we cannot
    // claim success — surface as 500 so Stripe retries; the retry will see
    // `already_processed` and safely ack.
    return { kind: "complete_failed", status: 500 };
  }

  return { kind: "ok", status: 200, body: outcome.body, result: outcome.result, attempt };
}

// ---------------------------------------------------------------------------
// Real Supabase-RPC-backed LedgerClient. Runtime-neutral: takes any object
// exposing `.rpc(name, args)` returning `{data, error}` — matches
// @supabase/supabase-js. Do not import supabase here; the edge function
// injects its already-initialized service-role client.

export interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export function createSupabaseLedgerClient(client: RpcClient): LedgerClient {
  return {
    async claim(eventId, eventType, leaseSeconds) {
      const { data, error } = await client.rpc("claim_stripe_webhook_event", {
        p_event_id: eventId,
        p_event_type: eventType,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? (data[0] as Record<string, unknown>) : (data as Record<string, unknown>);
      if (!row) throw new Error("claim_rpc_empty");
      const result = String(row.result ?? "");
      if (result === "claimed") {
        return {
          kind: "claimed",
          claimToken: String(row.claim_token ?? ""),
          attempt: Number(row.attempt ?? 1),
        };
      }
      if (result === "already_processed") return { kind: "already_processed" };
      if (result === "in_progress") return { kind: "in_progress" };
      if (result === "event_type_conflict") return { kind: "event_type_conflict" };
      throw new Error("unknown_claim_result");
    },
    async complete(eventId, claimToken, result) {
      const { data, error } = await client.rpc("complete_stripe_webhook_event", {
        p_event_id: eventId,
        p_claim_token: claimToken,
        p_result_code: result,
      });
      if (error) throw error;
      return data === true;
    },
    async fail(eventId, claimToken, errorCode) {
      const { data, error } = await client.rpc("fail_stripe_webhook_event", {
        p_event_id: eventId,
        p_claim_token: claimToken,
        p_error_code: errorCode,
      });
      if (error) throw error;
      return data === true;
    },
  };
}
