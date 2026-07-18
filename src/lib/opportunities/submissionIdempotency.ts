// Phase 1H-A1 final closeout — submission-attempt-scoped idempotency.
//
// Product rule: a single user submission action produces exactly ONE
// idempotency key that is reused across React Query retries. A later
// distinct submission action for the same opportunity/type must receive a
// FRESH key so the RPC creates a legitimate new application instead of
// returning a previously-rejected / previously-withdrawn row as an
// idempotent replay. Caller-provided keys are preserved verbatim and not
// tracked (the caller owns their lifecycle).

export type SubmissionKind = 'apply' | 'request_info';

export interface IdempotencyStore {
  /** Acquire the key for an in-flight submission attempt. */
  acquire(kind: SubmissionKind, opportunityId: string, callerKey?: string): string;
  /** Release the reservation for a settled submission attempt. */
  release(kind: SubmissionKind, opportunityId: string, callerKey?: string): void;
  /** Introspection for tests. */
  size(): number;
}

// Matches the DB constraint (idempotency_key BETWEEN 8 AND 200 chars).
const MIN_CALLER_KEY_LEN = 8;

export function createIdempotencyStore(
  generate: () => string = () => crypto.randomUUID(),
): IdempotencyStore {
  const inFlight = new Map<string, string>();
  const mk = (kind: SubmissionKind, opp: string) => `${kind}:${opp}`;
  return {
    acquire(kind, opp, callerKey) {
      // Caller-supplied keys are preserved exactly. Not tracked here —
      // caller owns lifecycle and a repeated caller key stays identical.
      if (callerKey && callerKey.length >= MIN_CALLER_KEY_LEN) return callerKey;
      const k = mk(kind, opp);
      const existing = inFlight.get(k);
      if (existing) return existing;
      const generated = generate();
      inFlight.set(k, generated);
      return generated;
    },
    release(kind, opp, callerKey) {
      // Only release generated reservations. Caller-provided keys were
      // never stored and must not evict a concurrently-generated one.
      if (callerKey && callerKey.length >= MIN_CALLER_KEY_LEN) return;
      inFlight.delete(mk(kind, opp));
    },
    size() {
      return inFlight.size;
    },
  };
}
