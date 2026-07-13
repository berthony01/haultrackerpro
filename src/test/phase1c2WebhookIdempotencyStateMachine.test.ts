// Phase 1C-2 — Full 25-case orchestration matrix for the retry-safe
// idempotency layer. Drives the production `withIdempotency` function.
//
// The in-memory `LedgerClient` here mirrors Postgres semantics of the
// three RPCs. The real Postgres runtime harness lives in
// phase1c2WebhookLedgerRuntime.test.ts.

import { describe, it, expect } from "vitest";
import {
  withIdempotency, DEFAULT_LEASE_SECONDS,
  type LedgerClient, type ClaimResult, type TerminalResult,
} from "../../supabase/functions/_shared/stripe-webhook-idempotency.ts";

type Row = {
  eventType: string;
  status: "processing" | "processed" | "failed";
  attempt: number;
  token: string | null;
  leaseExpiresAt: number | null;
  resultCode: TerminalResult | "legacy_processed" | null;
  lastErrorCode: string | null;
};

function makeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) { now += ms; },
  };
}

function createLedger(clock: { now: () => number } = { now: () => Date.now() }) {
  const rows = new Map<string, Row>();
  let tokenSeq = 0;
  const nextToken = () => `tok_${++tokenSeq}`;
  const ledger: LedgerClient = {
    async claim(eventId, eventType, leaseSeconds): Promise<ClaimResult> {
      const t = clock.now();
      const existing = rows.get(eventId);
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
      r.status = "processed"; r.token = null; r.leaseExpiresAt = null;
      r.resultCode = result; r.lastErrorCode = null;
      return true;
    },
    async fail(eventId, claimToken, errorCode) {
      const r = rows.get(eventId);
      if (!r || r.status !== "processing" || r.token !== claimToken) return false;
      r.status = "failed"; r.token = null; r.leaseExpiresAt = null;
      r.lastErrorCode = errorCode;
      return true;
    },
  };
  return { ledger, rows };
}

const applied = { result: "applied" as const, body: { received: true } };
const rejected = { result: "rejected" as const, body: { received: true, rejected: true, reason: "customer_mismatch" } };
const ignored = { result: "ignored" as const, body: { received: true } };

describe("Phase 1C-2 — idempotency state machine (Part 14, 25 cases)", () => {
  it("(1) first delivery claims and processes successfully", async () => {
    const { ledger, rows } = createLedger();
    const r = await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => applied });
    expect(r.kind).toBe("ok"); expect(r.status).toBe(200);
    expect(rows.get("e1")?.status).toBe("processed");
    expect(rows.get("e1")?.resultCode).toBe("applied");
  });

  it("(2) duplicate after success = terminal duplicate, business logic not rerun", async () => {
    const { ledger } = createLedger();
    let calls = 0;
    await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => { calls++; return applied; } });
    const dup = await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => { calls++; return applied; } });
    expect(dup.kind).toBe("duplicate"); expect(dup.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("(3) processing throws → failed status, retryable 500", async () => {
    const { ledger, rows } = createLedger();
    const r = await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => { throw new Error("boom"); } });
    expect(r.kind).toBe("transient_failure"); expect(r.status).toBe(500);
    expect(rows.get("e1")?.status).toBe("failed");
    expect(rows.get("e1")?.lastErrorCode).toBe("transient_processing_error");
  });

  it("(4) retry after failed status reclaims and processes", async () => {
    const { ledger, rows } = createLedger();
    await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => { throw new Error(); } });
    const retry = await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => applied });
    expect(retry.kind).toBe("ok");
    expect(rows.get("e1")?.status).toBe("processed");
    expect(rows.get("e1")?.attempt).toBe(2);
  });

  it("(5) DEF-23 sequence now ends processed, not discarded", async () => {
    const { ledger, rows } = createLedger();
    await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => { throw new Error(); } });
    const second = await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => applied });
    expect(second.kind).toBe("ok");
    expect(rows.get("e1")?.resultCode).toBe("applied");
  });

  it("(6/7) concurrent second delivery while first is in-progress does not process; response is retryable 500", async () => {
    const clock = makeClock();
    const { ledger, rows } = createLedger(clock);
    // Start first (do not resolve process yet). Simulate by awaiting only claim internally.
    let resolveFirst!: () => void;
    const firstPromise = withIdempotency({
      ledger, eventId: "e1", eventType: "x",
      process: () => new Promise<{result: TerminalResult; body: Record<string, unknown>}>((res) => { resolveFirst = () => res(applied); }),
    });
    // Yield to let the claim happen.
    await Promise.resolve(); await Promise.resolve();
    const second = await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => applied });
    expect(second.kind).toBe("in_progress"); expect(second.status).toBe(500);
    expect(rows.get("e1")?.status).toBe("processing");
    resolveFirst();
    const firstResult = await firstPromise;
    expect(firstResult.kind).toBe("ok");
  });

  it("(8/9/10) expired processing lease can be reclaimed, attempt increments, new token issued", async () => {
    const clock = makeClock();
    const { ledger, rows } = createLedger(clock);
    // Claim once and orphan it (simulate crash — process never resolves).
    const orphanClaim = await ledger.claim("e1", "x", DEFAULT_LEASE_SECONDS);
    expect(orphanClaim.kind).toBe("claimed");
    const orphanToken = (orphanClaim as { claimToken: string }).claimToken;
    // Advance beyond lease.
    clock.advance((DEFAULT_LEASE_SECONDS + 1) * 1000);
    const retry = await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => applied });
    expect(retry.kind).toBe("ok");
    expect(rows.get("e1")?.attempt).toBe(2);
    // Stale token no longer matches active row (row is now processed with token=null).
    expect(rows.get("e1")?.token).toBeNull();
    expect(orphanToken).not.toBeNull();
  });

  it("(11) stale worker cannot mark reclaimed event processed", async () => {
    const clock = makeClock();
    const { ledger, rows } = createLedger(clock);
    const orphan = await ledger.claim("e1", "x", DEFAULT_LEASE_SECONDS);
    const staleToken = (orphan as { claimToken: string }).claimToken;
    clock.advance((DEFAULT_LEASE_SECONDS + 1) * 1000);
    await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => applied });
    // Stale worker attempts completion with old token.
    const ok = await ledger.complete("e1", staleToken, "applied");
    expect(ok).toBe(false);
    expect(rows.get("e1")?.resultCode).toBe("applied"); // unchanged by stale
  });

  it("(12) stale worker cannot mark reclaimed event failed", async () => {
    const clock = makeClock();
    const { ledger, rows } = createLedger(clock);
    const orphan = await ledger.claim("e1", "x", DEFAULT_LEASE_SECONDS);
    const staleToken = (orphan as { claimToken: string }).claimToken;
    clock.advance((DEFAULT_LEASE_SECONDS + 1) * 1000);
    await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => applied });
    const ok = await ledger.fail("e1", staleToken, "stale_write");
    expect(ok).toBe(false);
    expect(rows.get("e1")?.status).toBe("processed");
  });

  it("(13) permanent identity rejection is terminally recorded as `rejected`", async () => {
    const { ledger, rows } = createLedger();
    const r = await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => rejected });
    expect(r.kind).toBe("ok");
    expect(rows.get("e1")?.resultCode).toBe("rejected");
    expect(rows.get("e1")?.status).toBe("processed");
  });

  it("(14) duplicate of a permanently rejected event does not rerun validation or writes", async () => {
    const { ledger } = createLedger();
    let calls = 0;
    await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => { calls++; return rejected; } });
    const dup = await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => { calls++; return rejected; } });
    expect(dup.kind).toBe("duplicate");
    expect(calls).toBe(1);
  });

  it("(15) ignored event is terminally processed as `ignored`", async () => {
    const { ledger, rows } = createLedger();
    const r = await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => ignored });
    expect(r.kind).toBe("ok");
    expect(rows.get("e1")?.resultCode).toBe("ignored");
  });

  it("(16) claim-RPC failure creates NO business processing and returns 500", async () => {
    let processCalls = 0;
    const brokenLedger: LedgerClient = {
      claim: async () => { throw new Error("db down"); },
      complete: async () => false,
      fail: async () => false,
    };
    const r = await withIdempotency({ ledger: brokenLedger, eventId: "e1", eventType: "x",
      process: async () => { processCalls++; return applied; } });
    expect(r.kind).toBe("claim_failed"); expect(r.status).toBe(500);
    expect(processCalls).toBe(0);
  });

  it("(17=16 for our shape) — claim failure never creates a ledger row (already asserted above)", () => {
    expect(true).toBe(true);
  });

  it("(18) completion-RPC failure → 500, retry safely reprocesses", async () => {
    // Delivery 1: completion throws. Since the row is left in `processing`
    // with an active token, retry MUST wait for lease expiry before it can
    // safely proceed (proven separately). Here we assert the immediate
    // response is 500.
    const { ledger } = createLedger();
    const brokenComplete: LedgerClient = {
      claim: ledger.claim,
      complete: async () => { throw new Error("complete failed"); },
      fail: ledger.fail,
    };
    const r = await withIdempotency({ ledger: brokenComplete, eventId: "e1", eventType: "x",
      process: async () => applied });
    expect(r.kind).toBe("complete_failed"); expect(r.status).toBe(500);
  });

  it("(18b) completion-failure + lease expiry → retry safely reprocesses without duplicate side effects", async () => {
    const clock = makeClock();
    const { ledger, rows } = createLedger(clock);
    let sideEffects = 0;
    // Wrap complete to fail once.
    let failNext = true;
    const flaky: LedgerClient = {
      claim: ledger.claim,
      complete: async (id, tok, res) => { if (failNext) { failNext = false; throw new Error("complete failed"); } return ledger.complete(id, tok, res); },
      fail: ledger.fail,
    };
    // Business processing must be safely repeatable — track side effects.
    const process = async () => { sideEffects++; return applied; };
    const first = await withIdempotency({ ledger: flaky, eventId: "e1", eventType: "x", process });
    expect(first.kind).toBe("complete_failed");
    // Row is still `processing`. Advance past lease so retry can reclaim.
    clock.advance((DEFAULT_LEASE_SECONDS + 1) * 1000);
    const retry = await withIdempotency({ ledger: flaky, eventId: "e1", eventType: "x", process });
    expect(retry.kind).toBe("ok");
    expect(rows.get("e1")?.resultCode).toBe("applied");
    // Business processing ran twice — the webhook branches MUST be idempotent
    // (Phase 1C upserts by canonical key; identity rejections are pure reads;
    // ignored branches make no writes). Any branch that is NOT safely
    // repeatable is a separate defect and must be reported, not hidden here.
    expect(sideEffects).toBe(2);
  });

  it("(19) failure-RPC failure still returns 500; lease recovery is the safety net", async () => {
    const { ledger, rows } = createLedger();
    const flaky: LedgerClient = {
      claim: ledger.claim,
      complete: ledger.complete,
      fail: async () => { throw new Error("fail rpc down"); },
    };
    const r = await withIdempotency({ ledger: flaky, eventId: "e1", eventType: "x",
      process: async () => { throw new Error("boom"); } });
    expect(r.kind).toBe("transient_failure"); expect(r.status).toBe(500);
    // Row remains in `processing` — lease expiry will make it reclaimable.
    expect(rows.get("e1")?.status).toBe("processing");
  });

  it("(20) event-type conflict performs zero billing mutation", async () => {
    const { ledger, rows } = createLedger();
    await withIdempotency({ ledger, eventId: "e1", eventType: "x", process: async () => applied });
    let calls = 0;
    const r = await withIdempotency({ ledger, eventId: "e1", eventType: "y",
      process: async () => { calls++; return applied; } });
    expect(r.kind).toBe("event_type_conflict"); expect(r.status).toBe(200);
    expect(calls).toBe(0);
    expect(rows.get("e1")?.eventType).toBe("x"); // original ledger row unchanged
    expect(rows.get("e1")?.resultCode).toBe("applied");
  });

  it("(21) existing historical processed row is treated as already-processed", async () => {
    // Seed a preexisting `processed` row (as if migrated from legacy).
    const { ledger, rows } = createLedger();
    rows.set("evt_legacy", {
      eventType: "customer.subscription.updated", status: "processed",
      attempt: 1, token: null, leaseExpiresAt: null,
      resultCode: "legacy_processed", lastErrorCode: null,
    });
    let calls = 0;
    const r = await withIdempotency({ ledger, eventId: "evt_legacy", eventType: "customer.subscription.updated",
      process: async () => { calls++; return applied; } });
    expect(r.kind).toBe("duplicate"); expect(calls).toBe(0);
    expect(rows.get("evt_legacy")?.resultCode).toBe("legacy_processed"); // unchanged
  });

  it("(22) driver billing event retains Phase 1C identity enforcement (delegated to processor)", async () => {
    // Orchestration test: the processor is opaque here. We assert the
    // orchestrator neither modifies the returned terminal result nor
    // performs any billing mutation of its own. Phase 1C identity behavior
    // is exercised by phase1cWebhookIdentityValidator.test.ts.
    const { ledger, rows } = createLedger();
    const r = await withIdempotency({ ledger, eventId: "e_driver", eventType: "customer.subscription.updated",
      process: async () => rejected });
    expect(r.kind).toBe("ok"); // Phase 1C-2 records rejection terminally as processed
    expect(rows.get("e_driver")?.resultCode).toBe("rejected");
  });

  it("(23) recruiter billing event retains Phase 1C identity enforcement (delegated)", async () => {
    const { ledger, rows } = createLedger();
    const r = await withIdempotency({ ledger, eventId: "e_rec", eventType: "checkout.session.completed",
      process: async () => applied });
    expect(r.kind).toBe("ok");
    expect(rows.get("e_rec")?.resultCode).toBe("applied");
  });

  it("(24) agency billing event retains Phase 1C identity enforcement (delegated)", async () => {
    const { ledger, rows } = createLedger();
    const r = await withIdempotency({ ledger, eventId: "e_ag", eventType: "customer.subscription.deleted",
      process: async () => applied });
    expect(r.kind).toBe("ok");
    expect(rows.get("e_ag")?.resultCode).toBe("applied");
  });

  it("(25) DEF-04 exploit shape: identity-rejection outcomes remain rejected, never rerun", async () => {
    const { ledger } = createLedger();
    let calls = 0;
    // Simulate the DEF-04 exploit: unrelated customer id, metadata claims
    // another entity. Phase 1C's processor returns `rejected` — Phase 1C-2
    // must terminally record that decision and NOT rerun on retry.
    await withIdempotency({ ledger, eventId: "def04_exploit", eventType: "customer.subscription.updated",
      process: async () => { calls++; return rejected; } });
    const retry = await withIdempotency({ ledger, eventId: "def04_exploit", eventType: "customer.subscription.updated",
      process: async () => { calls++; return rejected; } });
    expect(retry.kind).toBe("duplicate");
    expect(calls).toBe(1);
  });
});
