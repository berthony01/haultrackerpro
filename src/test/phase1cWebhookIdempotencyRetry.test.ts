// Phase 1C-2 — DEF-23 regression.
//
// Before Phase 1C-2, the webhook inserted the ledger row BEFORE business
// processing. A crash/throw after the insert caused Stripe's retry to be
// swallowed by the unique_violation duplicate check — the event was
// silently discarded.
//
// This test now drives the SAME `withIdempotency` orchestration used by
// the real edge function (see supabase/functions/_shared/stripe-webhook-idempotency.ts)
// and proves the corrected behavior: a transient failure after claim moves
// the event to `failed`, and Stripe's retry successfully processes it.
//
// The 25-case orchestration matrix lives in
// phase1c2WebhookIdempotencyStateMachine.test.ts; the real-Postgres
// runtime harness lives in phase1c2WebhookLedgerRuntime.test.ts.

import { describe, it, expect } from "vitest";
import { withIdempotency, type LedgerClient, type ClaimResult, type TerminalResult }
  from "../../supabase/functions/_shared/stripe-webhook-idempotency.ts";

// In-memory ledger that mirrors the Postgres claim/complete/fail semantics:
// atomic claim, event-type conflict guard, expired-lease reclaim, and
// claim-token stale-worker protection.
type Row = {
  eventType: string;
  status: "processing" | "processed" | "failed";
  attempt: number;
  token: string | null;
  leaseExpiresAt: number | null;
  resultCode: TerminalResult | null;
  lastErrorCode: string | null;
};

function createMemoryLedger(now: () => number = Date.now): LedgerClient & { _rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  let tokenSeq = 0;
  const nextToken = () => `tok_${++tokenSeq}`;

  return {
    _rows: rows,
    async claim(eventId, eventType, leaseSeconds): Promise<ClaimResult> {
      const existing = rows.get(eventId);
      const t = now();
      if (!existing) {
        const token = nextToken();
        rows.set(eventId, {
          eventType, status: "processing", attempt: 1, token,
          leaseExpiresAt: t + leaseSeconds * 1000,
          resultCode: null, lastErrorCode: null,
        });
        return { kind: "claimed", claimToken: token, attempt: 1 };
      }
      if (existing.eventType !== eventType) return { kind: "event_type_conflict" };
      if (existing.status === "processed") return { kind: "already_processed" };
      if (existing.status === "processing" && (existing.leaseExpiresAt ?? 0) > t) {
        return { kind: "in_progress" };
      }
      // failed OR expired-processing → reclaim
      const token = nextToken();
      existing.status = "processing";
      existing.attempt += 1;
      existing.token = token;
      existing.leaseExpiresAt = t + leaseSeconds * 1000;
      existing.lastErrorCode = null;
      return { kind: "claimed", claimToken: token, attempt: existing.attempt };
    },
    async complete(eventId, claimToken, result) {
      const r = rows.get(eventId);
      if (!r || r.status !== "processing" || r.token !== claimToken) return false;
      r.status = "processed";
      r.token = null;
      r.leaseExpiresAt = null;
      r.resultCode = result;
      r.lastErrorCode = null;
      return true;
    },
    async fail(eventId, claimToken, errorCode) {
      const r = rows.get(eventId);
      if (!r || r.status !== "processing" || r.token !== claimToken) return false;
      r.status = "failed";
      r.token = null;
      r.leaseExpiresAt = null;
      r.lastErrorCode = errorCode;
      return true;
    },
  };
}

describe("Phase 1C-2 — DEF-23 regression (retry-safe idempotency)", () => {
  it("first delivery: transient failure after claim → status=failed, response=500 retryable", async () => {
    const ledger = createMemoryLedger();
    let processedCount = 0;
    const first = await withIdempotency({
      ledger, eventId: "evt_1", eventType: "customer.subscription.updated",
      process: async () => { processedCount++; throw new Error("transient DB failure"); },
    });
    expect(first.status).toBe(500);
    expect(first.kind).toBe("transient_failure");
    expect(processedCount).toBe(1);
    // Row exists in `failed` state — NOT `processed`.
    expect(ledger._rows.get("evt_1")?.status).toBe("failed");
  });

  it("retry after failure: DEF-23 fixed — event is reprocessed and succeeds", async () => {
    const ledger = createMemoryLedger();
    let processedCount = 0;

    // Delivery 1 — transient failure.
    await withIdempotency({
      ledger, eventId: "evt_1", eventType: "customer.subscription.updated",
      process: async () => { processedCount++; throw new Error("transient"); },
    });
    expect(ledger._rows.get("evt_1")?.status).toBe("failed");

    // Delivery 2 — Stripe retries. Under the old code this was swallowed as
    // a duplicate WITHOUT reprocessing. Under Phase 1C-2 the failed row is
    // reclaimed, business logic runs again, and the event is applied.
    const second = await withIdempotency({
      ledger, eventId: "evt_1", eventType: "customer.subscription.updated",
      process: async () => { processedCount++; return { result: "applied", body: { received: true } }; },
    });
    expect(second.kind).toBe("ok");
    expect(second.status).toBe(200);
    expect(processedCount).toBe(2);
    const row = ledger._rows.get("evt_1")!;
    expect(row.status).toBe("processed");
    expect(row.resultCode).toBe("applied");
    expect(row.attempt).toBe(2);
  });

  it("post-success duplicate delivery returns terminal duplicate and does NOT rerun business logic", async () => {
    const ledger = createMemoryLedger();
    let processedCount = 0;

    const first = await withIdempotency({
      ledger, eventId: "evt_1", eventType: "customer.subscription.updated",
      process: async () => { processedCount++; return { result: "applied", body: { received: true } }; },
    });
    expect(first.kind).toBe("ok");

    const dup = await withIdempotency({
      ledger, eventId: "evt_1", eventType: "customer.subscription.updated",
      process: async () => { processedCount++; return { result: "applied", body: { received: true } }; },
    });
    expect(dup.kind).toBe("duplicate");
    expect(dup.status).toBe(200);
    expect(processedCount).toBe(1);
  });
});
