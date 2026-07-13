// Phase 1C — focused diagnostic for the idempotency-retry behavior of the
// stripe-webhook edge function.
//
// Behavior under test (documented in supabase/functions/stripe-webhook/index.ts
// around the "Idempotency" block):
//   1. Ledger insert runs BEFORE business logic.
//   2. If the ledger insert succeeds and business logic then throws, the
//      handler returns 500 so Stripe retries.
//   3. On retry, the ledger insert reports 23505 unique_violation and the
//      handler returns { received: true, duplicate: true } WITHOUT
//      reprocessing the event.
//
// That means once the ledger insert has succeeded, a subsequent business-
// logic failure results in the event being permanently skipped when Stripe
// retries — the retry is discarded as a duplicate. This is the exact risk
// described in Part 14. This test PROVES that behavior; it does NOT change
// idempotency. Phase 1C-2 will fix it separately.

import { describe, it, expect } from "vitest";

// Simulator of the exact ledger + business-logic control flow used by the
// current webhook (see index.ts lines ~331–372 and the switch body). We do
// not reach into the edge-function file directly here because it imports
// `https://deno.land/...` at the top; instead we mirror the same control
// flow verbatim so the assertion holds against the real code path.

async function runWebhookOnce(deps: {
  eventId: string;
  ledger: Set<string>;
  processedEventIds: Set<string>;
  processBusinessLogic: () => Promise<void>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { eventId, ledger, processedEventIds, processBusinessLogic } = deps;

  // --- Idempotency insert -------------------------------------------------
  if (ledger.has(eventId)) {
    // Postgres would return code "23505" — same branch as the real handler.
    return { status: 200, body: { received: true, duplicate: true } };
  }
  ledger.add(eventId);

  // --- Business logic -----------------------------------------------------
  try {
    await processBusinessLogic();
    processedEventIds.add(eventId);
    return { status: 200, body: { received: true } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 500, body: { error: msg } };
  }
}

describe("Phase 1C — idempotency retry diagnostic (informational, does NOT fix)", () => {
  it("proves: first request 500, retry is silently swallowed as duplicate without reprocessing", async () => {
    const ledger = new Set<string>();
    const processed = new Set<string>();
    let calls = 0;

    // First delivery: business logic throws AFTER ledger insert.
    const first = await runWebhookOnce({
      eventId: "evt_1",
      ledger, processedEventIds: processed,
      processBusinessLogic: async () => { calls++; throw new Error("transient DB failure"); },
    });
    expect(first.status).toBe(500);
    expect(processed.has("evt_1")).toBe(false);
    // Ledger has been polluted with a not-yet-processed event id:
    expect(ledger.has("evt_1")).toBe(true);

    // Stripe retries the identical event. In the current implementation the
    // retry sees the ledger row and returns duplicate:true WITHOUT running
    // business logic.
    const second = await runWebhookOnce({
      eventId: "evt_1",
      ledger, processedEventIds: processed,
      processBusinessLogic: async () => { calls++; /* would succeed this time */ },
    });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ received: true, duplicate: true });
    // *** The retry did not reprocess: this is the defect ***
    expect(calls).toBe(1);
    expect(processed.has("evt_1")).toBe(false);
  });
});
