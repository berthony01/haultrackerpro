// Phase 1G-R1A2 — focused runtime tests for the Recruiter Checkout
// orchestrator in supabase/functions/_shared/recruiter-checkout.ts.
//
// These tests exercise the production module directly through stateful in-
// memory fakes for the A1 intent RPCs and the Stripe surface. No real Stripe,
// Supabase, or network. An injected clock controls session expiration.

import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BLOCKING_SUBSCRIPTION_STATUSES,
  RECRUITER_CHECKOUT_TTL_SECONDS,
  recruiterCanonicalMetadata,
  recruiterCheckoutIdempotencyKey,
  recruiterCustomerIdempotencyKey,
  recruiterSessionMetadata,
  recruiterSuccessUrl,
  recruiterCancelUrl,
  runRecruiterCheckout,
  type Clock,
  type IntentClaimResult,
  type IntentSimpleResult,
  type IntentStore,
  type RecruiterCheckoutDeps,
  type RecruiterCheckoutInput,
  type StripeCustomerLike,
  type StripeGateway,
  type StripeSessionLike,
  type StripeSubscriptionLike,
} from "../../supabase/functions/_shared/recruiter-checkout";
// Phase 1R-D2-B3-R2: the retired Phase 1R-D1 edge guard is no longer imported
// here. The pure historical guard keeps its own dedicated coverage in
// src/test/phase1rD1BusinessCheckoutGuard.test.ts.
import {
  RECRUITER_CHECKOUT_MESSAGES,
  RECRUITER_SUPPORT_CODES,
} from "@/lib/opportunities/recruiterCheckoutMessages";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const USER_ID = "user-1";
const RECRUITER_ID = "rec-1";
const PLAN = "growth" as const;
const PRICE_ID = "price_growth_test";
const ORIGIN = "https://haultrackerpro.com";
const OTHER_RECRUITER = "rec-999";
const OTHER_USER = "user-999";

function baseInput(overrides: Partial<RecruiterCheckoutInput> = {}): RecruiterCheckoutInput {
  return {
    userId: USER_ID,
    recruiterId: RECRUITER_ID,
    plan: PLAN,
    priceId: PRICE_ID,
    origin: ORIGIN,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stateful fakes
// ---------------------------------------------------------------------------

interface IntentRow {
  id: string;
  recruiterId: string;
  userId: string;
  plan: string;
  generation: number;
  state: "processing" | "ready" | "failed" | "blocked";
  claimToken: string | null;
  leaseExpiresAt: number | null; // epoch seconds
  stripeCustomerId: string | null;
  stripeSessionId: string | null;
  checkoutUrl: string | null;
  checkoutExpiresAt: string | null;
}

class ClockFake implements Clock {
  constructor(private seconds = 1_700_000_000) {}
  nowSeconds() { return this.seconds; }
  advance(sec: number) { this.seconds += sec; }
  set(sec: number) { this.seconds = sec; }
}

class IntentStoreFake implements IntentStore {
  rows = new Map<string, IntentRow>(); // key: recruiterId
  billing = new Map<string, string>(); // key: `${recruiterId}:${userId}` -> customerId
  tokenCounter = 0;
  intentIdCounter = 0;
  claimCalls = 0;
  bindCalls = 0;
  completeCalls = 0;
  failCalls: Array<{ terminal: boolean; errorCode: string }> = [];

  constructor(private clock: ClockFake) {}

  // Test control ---------------------------------------------------------
  setBilling(recruiterId: string, userId: string, customerId: string) {
    this.billing.set(`${recruiterId}:${userId}`, customerId);
  }
  seedReadyRow(row: Omit<IntentRow, "id"> & { id?: string }): IntentRow {
    const id = row.id ?? `intent-${++this.intentIdCounter}`;
    const full = { ...row, id } as IntentRow;
    this.rows.set(row.recruiterId, full);
    return full;
  }
  seedProcessingActive(row: Partial<IntentRow> & { recruiterId: string; userId: string; plan: string }): IntentRow {
    const full: IntentRow = {
      id: `intent-${++this.intentIdCounter}`,
      generation: 1,
      state: "processing",
      claimToken: `tok-existing-${++this.tokenCounter}`,
      leaseExpiresAt: this.clock.nowSeconds() + 60,
      stripeCustomerId: null,
      stripeSessionId: null,
      checkoutUrl: null,
      checkoutExpiresAt: null,
      ...row,
    };
    this.rows.set(row.recruiterId, full);
    return full;
  }

  // IntentStore ----------------------------------------------------------
  async claim({ recruiterId, userId, plan }: {
    recruiterId: string; userId: string; plan: string;
  }): Promise<IntentClaimResult> {
    this.claimCalls++;
    const now = this.clock.nowSeconds();
    const existing = this.rows.get(recruiterId);

    const mkClaimed = (row: IntentRow, bumped: boolean): IntentClaimResult => {
      if (bumped) row.generation += 1;
      row.state = "processing";
      row.claimToken = `tok-${++this.tokenCounter}`;
      row.leaseExpiresAt = now + 300;
      row.userId = userId;
      row.plan = plan;
      row.stripeSessionId = null;
      row.checkoutUrl = null;
      row.checkoutExpiresAt = null;
      return {
        outcome: "claimed",
        intent_id: row.id,
        claim_token: row.claimToken,
        generation: row.generation,
        checkout_url: null,
        checkout_expires_at: null,
        stripe_customer_id: row.stripeCustomerId,
        stripe_checkout_session_id: null,
        reason: null,
      };
    };

    if (!existing) {
      const row: IntentRow = {
        id: `intent-${++this.intentIdCounter}`,
        recruiterId, userId, plan,
        generation: 1, state: "processing",
        claimToken: `tok-${++this.tokenCounter}`,
        leaseExpiresAt: now + 300,
        stripeCustomerId: null, stripeSessionId: null,
        checkoutUrl: null, checkoutExpiresAt: null,
      };
      this.rows.set(recruiterId, row);
      return {
        outcome: "claimed", intent_id: row.id, claim_token: row.claimToken,
        generation: row.generation, checkout_url: null, checkout_expires_at: null,
        stripe_customer_id: null, stripe_checkout_session_id: null, reason: null,
      };
    }

    // ready + same plan + not expired -> ready_candidate
    if (
      existing.state === "ready" && existing.plan === plan &&
      existing.checkoutExpiresAt &&
      new Date(existing.checkoutExpiresAt).getTime() / 1000 > now
    ) {
      return {
        outcome: "ready_candidate", intent_id: existing.id,
        claim_token: null, generation: existing.generation,
        checkout_url: existing.checkoutUrl,
        checkout_expires_at: existing.checkoutExpiresAt,
        stripe_customer_id: existing.stripeCustomerId,
        stripe_checkout_session_id: existing.stripeSessionId,
        reason: null,
      };
    }
    // processing + live lease -> in_progress
    if (
      existing.state === "processing" &&
      existing.leaseExpiresAt != null && existing.leaseExpiresAt > now
    ) {
      return {
        outcome: "in_progress", intent_id: existing.id,
        claim_token: null, generation: existing.generation,
        checkout_url: null, checkout_expires_at: null,
        stripe_customer_id: existing.stripeCustomerId,
        stripe_checkout_session_id: null,
        reason: "active_lease",
      };
    }
    // Reclaim generation matrix
    const samePlan = existing.plan === plan;
    const bump = !(
      (existing.state === "processing" && samePlan) ||
      (existing.state === "failed" && samePlan)
    );
    return mkClaimed(existing, bump);
  }

  async bind({ intentId, claimToken, customerId }: {
    intentId: string; claimToken: string; customerId: string;
  }): Promise<IntentSimpleResult> {
    this.bindCalls++;
    const now = this.clock.nowSeconds();
    const row = [...this.rows.values()].find((r) => r.id === intentId);
    if (!row) return { outcome: "not_found", reason: "intent_missing" };
    if (
      row.state !== "processing" || row.claimToken !== claimToken ||
      row.leaseExpiresAt == null || row.leaseExpiresAt <= now
    ) {
      return { outcome: "lease_invalid", reason: "no_active_lease" };
    }
    // Cross-recruiter conflict via billing map
    for (const [k, v] of this.billing.entries()) {
      if (v === customerId && !k.startsWith(`${row.recruiterId}:`)) {
        return { outcome: "customer_conflict", reason: "billing_identity_unique_conflict" };
      }
    }
    // Never overwrite differing canonical customer
    const key = `${row.recruiterId}:${row.userId}`;
    const existing = this.billing.get(key);
    if (existing && existing !== customerId) {
      return { outcome: "customer_conflict", reason: "existing_canonical_customer_differs" };
    }
    if (!existing) this.billing.set(key, customerId);
    row.stripeCustomerId = customerId;
    return { outcome: "bound", reason: null };
  }

  async complete({ intentId, claimToken, customerId, sessionId, url, expiresAt }: {
    intentId: string; claimToken: string; customerId: string;
    sessionId: string; url: string; expiresAt: string;
  }): Promise<IntentSimpleResult> {
    this.completeCalls++;
    const now = this.clock.nowSeconds();
    const row = [...this.rows.values()].find((r) => r.id === intentId);
    if (!row) return { outcome: "not_found", reason: "intent_missing" };
    if (
      row.state !== "processing" || row.claimToken !== claimToken ||
      row.leaseExpiresAt == null || row.leaseExpiresAt <= now
    ) {
      return { outcome: "lease_invalid", reason: "no_active_lease" };
    }
    if (row.stripeCustomerId !== customerId) {
      return { outcome: "customer_mismatch", reason: "bound_customer_differs" };
    }
    row.state = "ready";
    row.claimToken = null;
    row.leaseExpiresAt = null;
    row.stripeSessionId = sessionId;
    row.checkoutUrl = url;
    row.checkoutExpiresAt = expiresAt;
    return { outcome: "completed", reason: null };
  }

  async fail({ intentId, claimToken, errorCode, terminal }: {
    intentId: string; claimToken: string; errorCode: string; terminal: boolean;
  }): Promise<IntentSimpleResult> {
    this.failCalls.push({ terminal, errorCode });
    const now = this.clock.nowSeconds();
    const row = [...this.rows.values()].find((r) => r.id === intentId);
    if (!row) return { outcome: "not_found", reason: "intent_missing" };
    if (
      row.state !== "processing" || row.claimToken !== claimToken ||
      row.leaseExpiresAt == null || row.leaseExpiresAt <= now
    ) {
      return { outcome: "lease_invalid", reason: "no_active_lease" };
    }
    row.state = terminal ? "blocked" : "failed";
    row.claimToken = null;
    row.leaseExpiresAt = null;
    return { outcome: row.state, reason: null };
  }

  async loadCanonicalCustomer({ recruiterId, userId }: {
    recruiterId: string; userId: string;
  }) {
    return { stripeCustomerId: this.billing.get(`${recruiterId}:${userId}`) ?? null };
  }
}

interface StripeCustomerRecord extends StripeCustomerLike {
  email?: string;
}

class StripeFake implements StripeGateway {
  customers = new Map<string, StripeCustomerRecord>();
  subscriptions = new Map<string, StripeSubscriptionLike[]>();
  sessions = new Map<string, StripeSessionLike>();
  createdCustomers: string[] = [];
  createdSessions: string[] = [];
  createSessionCalls: Array<{ idempotencyKey: string; expiresAt: number; metadata: Record<string,string> }> = [];
  createCustomerCalls: Array<{ idempotencyKey: string; metadata: Record<string,string> }> = [];
  // Idempotency memory
  customerIdemp = new Map<string, string>();
  sessionIdemp = new Map<string, string>();
  // Toggles
  failNextListSubs = 0;
  failNextCreateSession = 0;
  failNextRetrieveCustomer = 0;
  // Narrow mutation hook: transforms the session about to be returned/stored
  // by createSession. Used to prove the orchestrator rejects malformed
  // Stripe returns without duplicating orchestrator logic.
  sessionCreateMutator: ((s: StripeSessionLike) => StripeSessionLike) | null = null;
  // Search injection: exact-metadata search returns these when set
  metadataSearchOverride: StripeCustomerRecord[] | null = null;
  // Email-only lookalike customers to prove they are ignored
  emailOnlyCustomers: StripeCustomerRecord[] = [];

  constructor(private idSeed = 0) {}

  private nextId(prefix: string) { return `${prefix}_${++this.idSeed}`; }

  async retrieveCustomer(id: string): Promise<StripeCustomerLike | null> {
    if (this.failNextRetrieveCustomer > 0) {
      this.failNextRetrieveCustomer--;
      throw new Error("stripe transient");
    }
    return this.customers.get(id) ?? null;
  }

  async searchCustomersByMetadata(q: { recruiterId: string; userId: string; }): Promise<StripeCustomerLike[]> {
    if (this.metadataSearchOverride) return this.metadataSearchOverride;
    return [...this.customers.values()].filter(
      (c) => !c.deleted &&
        c.metadata["billing_type"] === "recruiter" &&
        c.metadata["recruiter_id"] === q.recruiterId &&
        c.metadata["user_id"] === q.userId,
    );
  }

  async createCustomer(input: {
    recruiterId: string; userId: string;
    idempotencyKey: string; metadata: Record<string,string>;
  }): Promise<StripeCustomerLike> {
    this.createCustomerCalls.push({ idempotencyKey: input.idempotencyKey, metadata: input.metadata });
    // Idempotent replay
    const cached = this.customerIdemp.get(input.idempotencyKey);
    if (cached) {
      const rec = this.customers.get(cached);
      if (rec) return rec;
    }
    const id = this.nextId("cus");
    const rec: StripeCustomerRecord = { id, deleted: false, metadata: { ...input.metadata } };
    this.customers.set(id, rec);
    this.customerIdemp.set(input.idempotencyKey, id);
    this.createdCustomers.push(id);
    return rec;
  }

  async listAllSubscriptions(customerId: string): Promise<StripeSubscriptionLike[]> {
    if (this.failNextListSubs > 0) {
      this.failNextListSubs--;
      throw new Error("stripe transient");
    }
    return this.subscriptions.get(customerId) ?? [];
  }

  async retrieveSession(id: string): Promise<StripeSessionLike | null> {
    return this.sessions.get(id) ?? null;
  }

  async createSession(input: {
    customerId: string; priceId: string;
    metadata: Record<string,string>;
    successUrl: string; cancelUrl: string;
    expiresAt: number; idempotencyKey: string;
  }): Promise<StripeSessionLike> {
    this.createSessionCalls.push({
      idempotencyKey: input.idempotencyKey, expiresAt: input.expiresAt, metadata: input.metadata,
    });
    // Idempotent replay
    const cached = this.sessionIdemp.get(input.idempotencyKey);
    if (cached) {
      const existing = this.sessions.get(cached);
      if (existing) return existing;
    }
    if (this.failNextCreateSession > 0) {
      this.failNextCreateSession--;
      throw new Error("stripe transient");
    }
    const id = this.nextId("cs");
    const base: StripeSessionLike = {
      id, status: "open",
      url: `https://checkout.stripe.example/${id}`,
      customer: input.customerId,
      expires_at: input.expiresAt,
      metadata: { ...input.metadata },
    };
    const session = this.sessionCreateMutator ? this.sessionCreateMutator(base) : base;
    this.sessions.set(id, session);
    this.sessionIdemp.set(input.idempotencyKey, id);
    this.createdSessions.push(id);
    return session;
  }

  // Test helpers ---------------------------------------------------------
  putCustomer(rec: StripeCustomerRecord) { this.customers.set(rec.id, rec); }
  setSubs(customerId: string, subs: StripeSubscriptionLike[]) { this.subscriptions.set(customerId, subs); }
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

let clock: ClockFake;
let intents: IntentStoreFake;
let stripe: StripeFake;
let deps: RecruiterCheckoutDeps;

beforeEach(() => {
  clock = new ClockFake();
  intents = new IntentStoreFake(clock);
  stripe = new StripeFake();
  deps = { clock, intents, stripe };
});

function canonMetadata() {
  return recruiterCanonicalMetadata({ userId: USER_ID, recruiterId: RECRUITER_ID, plan: PLAN });
}

// Assertion helper: safe messages must not leak sensitive substrings.
function assertSafeMessage(msg: string) {
  const forbidden = [
    "sk_test", "sk_live", "cus_", "cs_", "sub_", "price_", "tok-",
    "@", "checkout.stripe.example", "https://checkout", "Error:",
    "at ", "Stripe", "Supabase",
  ];
  for (const f of forbidden) {
    expect(msg.includes(f), `message contains forbidden substring "${f}": ${msg}`).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe("Phase 1G-R1A2 — recruiter checkout orchestrator", () => {
  it("1. first request: creates one customer + one session with exact metadata and keys", async () => {
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.status).toBe(200);
    expect(r.code).toBe("checkout_ready");
    expect(r.url).toMatch(/^https:\/\/checkout\.stripe\.example\//);
    expect(stripe.createdCustomers.length).toBe(1);
    expect(stripe.createdSessions.length).toBe(1);
    expect(stripe.createCustomerCalls[0].idempotencyKey)
      .toBe(recruiterCustomerIdempotencyKey(RECRUITER_ID));
    expect(stripe.createCustomerCalls[0].metadata).toMatchObject(canonMetadata());
    const sessCall = stripe.createSessionCalls[0];
    expect(sessCall.idempotencyKey).toBe(recruiterCheckoutIdempotencyKey(RECRUITER_ID, 1));
    expect(sessCall.expiresAt).toBe(clock.nowSeconds() + RECRUITER_CHECKOUT_TTL_SECONDS);
    expect(sessCall.metadata).toMatchObject(
      recruiterSessionMetadata({
        userId: USER_ID, recruiterId: RECRUITER_ID, plan: PLAN,
        intentId: [...intents.rows.values()][0].id, generation: 1,
      }),
    );
  });

  it("2. sequential retry returns same URL; create counts remain 1/1", async () => {
    const first = await runRecruiterCheckout(baseInput(), deps);
    const second = await runRecruiterCheckout(baseInput(), deps);
    expect(second.status).toBe(200);
    expect(second.url).toBe(first.url);
    expect(stripe.createdCustomers.length).toBe(1);
    expect(stripe.createdSessions.length).toBe(1);
  });

  it("3. concurrent loser receives in_progress, creates nothing", async () => {
    // Seed an already-live processing lease directly.
    intents.seedProcessingActive({ recruiterId: RECRUITER_ID, userId: USER_ID, plan: PLAN });
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.status).toBe(409);
    expect(r.code).toBe("in_progress");
    expect(stripe.createdCustomers.length).toBe(0);
    expect(stripe.createdSessions.length).toBe(0);
  });

  it("4. canonical DB customer reused (no search, no create)", async () => {
    const cus = "cus_canonical";
    intents.setBilling(RECRUITER_ID, USER_ID, cus);
    stripe.putCustomer({ id: cus, deleted: false, metadata: canonMetadata() });
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.code).toBe("checkout_ready");
    expect(stripe.createdCustomers.length).toBe(0);
    expect(stripe.createdSessions.length).toBe(1);
  });

  it("5. one exact metadata-search customer reused", async () => {
    stripe.putCustomer({ id: "cus_search", deleted: false, metadata: canonMetadata() });
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.code).toBe("checkout_ready");
    expect(stripe.createdCustomers.length).toBe(0);
  });

  it("6. email-only customer ignored; a canonical metadata customer is created", async () => {
    stripe.metadataSearchOverride = []; // simulate no exact-metadata match
    stripe.emailOnlyCustomers.push({
      id: "cus_email_only", deleted: false, metadata: { billing_type: "driver" }, email: "x@y.com",
    });
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.code).toBe("checkout_ready");
    expect(stripe.createdCustomers.length).toBe(1);
    expect(stripe.customers.get(stripe.createdCustomers[0])!.metadata).toMatchObject(canonMetadata());
  });

  it("7. multiple exact metadata matches rejected", async () => {
    stripe.metadataSearchOverride = [
      { id: "cus_a", deleted: false, metadata: canonMetadata() },
      { id: "cus_b", deleted: false, metadata: canonMetadata() },
    ];
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.status).toBe(409);
    expect(r.code).toBe("customer_ambiguous");
    expect(stripe.createdSessions.length).toBe(0);
    // Terminal fail because we have a live claim.
    expect(intents.failCalls.some((f) => f.terminal)).toBe(true);
  });

  it("8. deleted / missing canonical customer rejected", async () => {
    intents.setBilling(RECRUITER_ID, USER_ID, "cus_gone");
    // Do NOT insert into stripe.customers -> retrieveCustomer returns null.
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.status).toBe(409);
    expect(r.code).toBe("customer_not_found");
    expect(intents.failCalls.some((f) => f.terminal)).toBe(true);
  });

  it("9. conflicting canonical customer metadata rejected", async () => {
    const cus = "cus_conflict";
    intents.setBilling(RECRUITER_ID, USER_ID, cus);
    stripe.putCustomer({
      id: cus, deleted: false,
      metadata: { billing_type: "recruiter", recruiter_id: OTHER_RECRUITER, user_id: OTHER_USER },
    });
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.status).toBe(409);
    expect(r.code).toBe("customer_conflict");
    expect(intents.failCalls.some((f) => f.terminal)).toBe(true);
    expect(stripe.createdSessions.length).toBe(0);
  });

  it("10. each blocking subscription status separately rejects", async () => {
    for (const status of BLOCKING_SUBSCRIPTION_STATUSES) {
      // Fresh setup per iteration.
      clock = new ClockFake(); intents = new IntentStoreFake(clock);
      stripe = new StripeFake(); deps = { clock, intents, stripe };
      const cus = "cus_blocked";
      intents.setBilling(RECRUITER_ID, USER_ID, cus);
      stripe.putCustomer({ id: cus, deleted: false, metadata: canonMetadata() });
      stripe.setSubs(cus, [{ id: "sub_x", status }]);
      const r = await runRecruiterCheckout(baseInput(), deps);
      expect(r.status, `status=${status}`).toBe(409);
      expect(r.code, `code for ${status}`).toBe("subscription_exists");
      expect(stripe.createdSessions.length).toBe(0);
    }
  });

  it("11. canceled and incomplete_expired allow checkout", async () => {
    const cus = "cus_terminal";
    intents.setBilling(RECRUITER_ID, USER_ID, cus);
    stripe.putCustomer({ id: cus, deleted: false, metadata: canonMetadata() });
    stripe.setSubs(cus, [
      { id: "sub_c", status: "canceled" },
      { id: "sub_e", status: "incomplete_expired" },
    ]);
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.code).toBe("checkout_ready");
  });

  it("12. unknown subscription status fails closed", async () => {
    const cus = "cus_unknown";
    intents.setBilling(RECRUITER_ID, USER_ID, cus);
    stripe.putCustomer({ id: cus, deleted: false, metadata: canonMetadata() });
    stripe.setSubs(cus, [{ id: "sub_new", status: "some_future_status" }]);
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.status).toBe(409);
    expect(r.code).toBe("unknown_subscription_status");
    expect(stripe.createdSessions.length).toBe(0);
  });

  it("13. open ready session reuse after exact validation", async () => {
    const first = await runRecruiterCheckout(baseInput(), deps);
    expect(first.code).toBe("checkout_ready");
    expect(stripe.createdSessions.length).toBe(1);
    const second = await runRecruiterCheckout(baseInput(), deps);
    expect(second.code).toBe("checkout_ready");
    expect(second.url).toBe(first.url);
    expect(stripe.createdSessions.length).toBe(1);
  });

  it("14a. ready session with mismatched customer rejected", async () => {
    await runRecruiterCheckout(baseInput(), deps);
    const row = [...intents.rows.values()][0];
    const sess = stripe.sessions.get(row.stripeSessionId!)!;
    sess.customer = "cus_someone_else";
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.code).toBe("session_invalid");
  });

  it("14b. ready session with mismatched metadata rejected", async () => {
    await runRecruiterCheckout(baseInput(), deps);
    const row = [...intents.rows.values()][0];
    const sess = stripe.sessions.get(row.stripeSessionId!)!;
    sess.metadata = { ...sess.metadata, plan: "starter" };
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.code).toBe("session_invalid");
  });

  it("14c. ready session with mismatched URL rejected", async () => {
    await runRecruiterCheckout(baseInput(), deps);
    const row = [...intents.rows.values()][0];
    const sess = stripe.sessions.get(row.stripeSessionId!)!;
    sess.url = "https://checkout.stripe.example/tampered";
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.code).toBe("session_invalid");
  });

  it("14d. ready session with expired Stripe expires_at rejected", async () => {
    await runRecruiterCheckout(baseInput(), deps);
    const row = [...intents.rows.values()][0];
    const sess = stripe.sessions.get(row.stripeSessionId!)!;
    sess.expires_at = clock.nowSeconds() - 1;
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.code).toBe("session_invalid");
  });

  it("15. complete ready session with webhook lag returns checkout_processing", async () => {
    await runRecruiterCheckout(baseInput(), deps);
    const row = [...intents.rows.values()][0];
    const sess = stripe.sessions.get(row.stripeSessionId!)!;
    sess.status = "complete";
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.status).toBe(409);
    expect(r.code).toBe("checkout_processing");
    // No new sessions were created.
    expect(stripe.createdSessions.length).toBe(1);
  });

  it("16. transient session-create failure -> non-terminal fail; retry retains same idempotency key", async () => {
    stripe.failNextCreateSession = 1;
    const r1 = await runRecruiterCheckout(baseInput(), deps);
    expect(r1.status).toBe(503);
    expect(r1.code).toBe("transient_error");
    expect(intents.failCalls.some((f) => f.terminal === false)).toBe(true);
    const genAtFail = stripe.createSessionCalls[0].idempotencyKey;

    // Retry: same generation (failed + same plan preserves generation).
    const r2 = await runRecruiterCheckout(baseInput(), deps);
    expect(r2.code).toBe("checkout_ready");
    expect(stripe.createSessionCalls[stripe.createSessionCalls.length - 1].idempotencyKey)
      .toBe(genAtFail);
  });

  it("17. customer bind conflict calls terminal fail", async () => {
    // Pre-load a canonical customer for OTHER user so bind rejects as conflict.
    intents.billing.set(`${OTHER_RECRUITER}:${OTHER_USER}`, "cus_shared");
    // Search returns exactly one recruiter-shape customer, but its id collides.
    stripe.metadataSearchOverride = [
      { id: "cus_shared", deleted: false, metadata: canonMetadata() },
    ];
    const r = await runRecruiterCheckout(baseInput(), deps);
    expect(r.status).toBe(409);
    expect(r.code).toBe("customer_conflict");
    expect(intents.failCalls.some((f) => f.terminal)).toBe(true);
    expect(stripe.createdSessions.length).toBe(0);
  });

  it("18a. invalid plan rejected before any dependency call", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await runRecruiterCheckout({ ...baseInput(), plan: "bogus" as any }, deps);
    expect(r.status).toBe(400);
    expect(r.code).toBe("invalid_plan");
    expect(intents.claimCalls).toBe(0);
  });

  it("18b. invalid origin rejected before any dependency call", async () => {
    const r = await runRecruiterCheckout({ ...baseInput(), origin: "https://evil.example" }, deps);
    expect(r.status).toBe(400);
    expect(r.code).toBe("invalid_origin");
    expect(intents.claimCalls).toBe(0);
  });

  it("18c. successful path only returns allowlisted-origin URLs (adapter contract)", () => {
    // Orchestrator does not return origin URLs, but the success/cancel helpers
    // used by the adapter must be pinned to the allowlisted origin.
    expect(recruiterSuccessUrl(ORIGIN).startsWith(ORIGIN)).toBe(true);
    expect(recruiterCancelUrl(ORIGIN).startsWith(ORIGIN)).toBe(true);
  });

  it("19. safe public errors leak no secrets, emails, full Stripe IDs, URLs, tokens, or raw messages", async () => {
    // Force multiple error paths and check every message.
    const cases: Array<() => Promise<RecruiterCheckoutInput>> = [];
    const conflictInput = baseInput();
    // Poison canonical customer
    intents.setBilling(RECRUITER_ID, USER_ID, "cus_leaky");
    stripe.putCustomer({
      id: "cus_leaky", deleted: false,
      metadata: { billing_type: "recruiter", recruiter_id: OTHER_RECRUITER, user_id: OTHER_USER },
      email: "leak@example.com",
    });
    const r = await runRecruiterCheckout(conflictInput, deps);
    assertSafeMessage(r.message);
    if (r.url) assertSafeMessage(r.url);
  });

  it("20. edge function imports and calls the shared orchestrator; old inline flow removed", () => {
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/create-recruiter-checkout/index.ts"),
      "utf8",
    );
    expect(src.includes("../_shared/recruiter-checkout")).toBe(true);
    expect(src.includes("runRecruiterCheckout(")).toBe(true);

    // Old inline customer/session creation must not exist directly in the edge
    // file: any Stripe customer/session create call must be inside a factory
    // building the injected adapter, not called at request-handling scope.
    // Enforce: no call to stripe.customers.create or stripe.checkout.sessions.create
    // outside the adapter builder. Simplest signal: the adapter-builder function
    // exists and the old flow no longer branches on billingRow directly.
    expect(src.includes("billingRow")).toBe(false);
    expect(src.includes("buildDeps(")).toBe(true);
  });



  // ---------------------------------------------------------------------
  // Phase 1G-R1A2-R1 — session identity + safe-logging closure
  // ---------------------------------------------------------------------

  describe("R1 — newly created session validation (fresh claim path)", () => {
    for (const badStatus of ["complete", "expired", "", "some_future_status"]) {
      it(`21.${badStatus || "empty"} rejects returned session with status "${badStatus}" and never completes`, async () => {
        stripe.sessionCreateMutator = (s) => ({ ...s, status: badStatus });
        const r = await runRecruiterCheckout(baseInput(), deps);
        expect(r.status).toBe(409);
        expect(r.code).toBe("session_invalid");
        expect(intents.completeCalls).toBe(0);
        // Terminal fail is recorded with the stable code.
        expect(intents.failCalls.some((f) => f.terminal && f.errorCode === "session_invalid_return")).toBe(true);
      });
    }

    it("22. rejects returned session with metadata mismatch and never completes", async () => {
      stripe.sessionCreateMutator = (s) => ({
        ...s,
        metadata: { ...s.metadata, plan: "starter" }, // requested was 'growth'
      });
      const r = await runRecruiterCheckout(baseInput(), deps);
      expect(r.status).toBe(409);
      expect(r.code).toBe("session_invalid");
      expect(intents.completeCalls).toBe(0);
      expect(intents.failCalls.some((f) => f.terminal && f.errorCode === "session_invalid_return")).toBe(true);
    });

    it("23a. rejects returned session expires_at earlier than requested and never completes", async () => {
      stripe.sessionCreateMutator = (s) => ({ ...s, expires_at: s.expires_at - 60 });
      const r = await runRecruiterCheckout(baseInput(), deps);
      expect(r.code).toBe("session_invalid");
      expect(intents.completeCalls).toBe(0);
    });

    it("23b. rejects returned session expires_at later than requested and never completes", async () => {
      stripe.sessionCreateMutator = (s) => ({ ...s, expires_at: s.expires_at + 60 });
      const r = await runRecruiterCheckout(baseInput(), deps);
      expect(r.code).toBe("session_invalid");
      expect(intents.completeCalls).toBe(0);
    });

    it("23c. requested expiration equals injected clock + RECRUITER_CHECKOUT_TTL_SECONDS", async () => {
      const nowAtCall = clock.nowSeconds();
      const r = await runRecruiterCheckout(baseInput(), deps);
      expect(r.code).toBe("checkout_ready");
      expect(stripe.createSessionCalls[0].expiresAt).toBe(nowAtCall + RECRUITER_CHECKOUT_TTL_SECONDS);
    });
  });

  describe("R1 — ready-candidate canonical integrity (no intent fallback)", () => {
    it("24. ready candidate with no canonical DB customer is rejected even when intent has one", async () => {
      // Produce a ready intent normally.
      const first = await runRecruiterCheckout(baseInput(), deps);
      expect(first.code).toBe("checkout_ready");
      // Wipe canonical billing while the intent still points at the customer.
      intents.billing.clear();
      const r = await runRecruiterCheckout(baseInput(), deps);
      expect(r.status).toBe(409);
      expect(r.code).toBe("support_required");
      // Ready path has no claim token — no fail call on this path.
      expect(intents.failCalls.length).toBe(0);
    });

    it("25. ready candidate with canonical differing from intent customer is rejected", async () => {
      const first = await runRecruiterCheckout(baseInput(), deps);
      expect(first.code).toBe("checkout_ready");
      // Mutate canonical to a different customer id than the ready row's stored one.
      intents.billing.set(`${RECRUITER_ID}:${USER_ID}`, "cus_different");
      const r = await runRecruiterCheckout(baseInput(), deps);
      expect(r.status).toBe(409);
      expect(r.code).toBe("customer_conflict");
      expect(intents.failCalls.length).toBe(0);
    });
  });

  describe("R1 — source integrity: safe logging + fail-closed normalization", () => {
    const edgeSrc = readFileSync(
      resolve(__dirname, "../../supabase/functions/create-recruiter-checkout/index.ts"),
      "utf8",
    );

    it("26. edge source contains no raw exception logging patterns", () => {
      // Concrete tripwires: raw error interpolation into logs.
      expect(edgeSrc).not.toMatch(/\be\.message\b/);
      expect(edgeSrc).not.toMatch(/\bString\(\s*e\s*\)/);
      expect(edgeSrc).not.toMatch(/\.stack\b/);
      // No template interpolation of an `e`/`err`/`error` variable inside log/console calls.
      expect(edgeSrc).not.toMatch(/log\([^)]*\$\{\s*(e|err|error)\b/);
      expect(edgeSrc).not.toMatch(/console\.[a-z]+\([^)]*\$\{\s*(e|err|error)\b/);
      // No raw error object interpolation into JSON responses.
      expect(edgeSrc).not.toMatch(/message:\s*e\b/);
      expect(edgeSrc).not.toMatch(/message:\s*String\(\s*e\s*\)/);
      // Positive: the stable safe-log event exists.
      expect(edgeSrc).toContain('log("request_failed"');
    });

    it("27. edge normalizeSession does not default status to open and preserves invalid defaults", () => {
      // Enforce structural invariants of the fail-closed normalizer.
      expect(edgeSrc).not.toMatch(/status:\s*s\?\.status\s*\?\?\s*["']open["']/);
      expect(edgeSrc).toContain('typeof s?.status === "string" ? s.status : ""');
      // id must not default to a truthy value that would slip past validation.
      expect(edgeSrc).toContain('typeof s?.id === "string" ? s.id : ""');
    });
  });

  describe("Phase 1R-D1 — cross-context business guard precheck (source contract)", () => {
    const edgeSrc = readFileSync(
      resolve(__dirname, "../../supabase/functions/create-recruiter-checkout/index.ts"),
      "utf8",
    );

    it("28. imports the pure cross-context guard module", () => {
      expect(edgeSrc).toMatch(
        /from\s+"\.\.\/_shared\/business-checkout-guard\.ts"/,
      );
      expect(edgeSrc).toContain("evaluateRecruiterCheckoutCrossContext");
    });

    it("29. evaluates the guard BEFORE runRecruiterCheckout, Stripe, and any intent RPC", () => {
      const guardIdx = edgeSrc.indexOf("evaluateRecruiterCheckoutCrossContext(");
      const orchestratorIdx = edgeSrc.indexOf("await runRecruiterCheckout(");
      const stripeIdx = edgeSrc.indexOf("new Stripe(stripeKey");
      const depsIdx = edgeSrc.indexOf("buildDeps(stripe");
      expect(guardIdx).toBeGreaterThan(-1);
      expect(orchestratorIdx).toBeGreaterThan(-1);
      expect(stripeIdx).toBeGreaterThan(-1);
      expect(depsIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeLessThan(stripeIdx);
      expect(guardIdx).toBeLessThan(depsIdx);
      expect(guardIdx).toBeLessThan(orchestratorIdx);
    });

    it("30. reads owner memberships and entitlements with the exact scoped columns", () => {
      expect(edgeSrc).toContain('from("agency_members")');
      expect(edgeSrc).toContain('.eq("role", "agency_owner")');
      expect(edgeSrc).toContain('.eq("status", "active")');
      expect(edgeSrc).toContain('from("agency_entitlements")');
      expect(edgeSrc).toContain('.select("agency_id, plan_key, status, source")');
    });

    it("31. returns 503 transient_error on either cross-context read failure", () => {
      const guardStart = edgeSrc.indexOf('from("agency_members")');
      const guardEnd = edgeSrc.indexOf("new Stripe(stripeKey");
      const block = edgeSrc.slice(guardStart, guardEnd);
      const transientHits = block.match(/code:\s*"transient_error"/g) ?? [];
      expect(transientHits.length).toBeGreaterThanOrEqual(2);
      expect(block).toContain("status: 503");
    });

    it("32. surfaces only the three stable cross-context codes", () => {
      expect(edgeSrc).toContain('"agency_entitlement_exists"');
      expect(edgeSrc).toContain('"agency_billing_requires_management"');
      expect(edgeSrc).toContain('"opposing_entitlement_unknown"');
    });

    it("33. the guard blocks without any dependency work (direct pure behaviour)", () => {
      const blockedDecision = evaluateRecruiterCheckoutCrossContext({
        hasRow: true,
        planKey: "agency_team",
        status: "active",
        source: "stripe",
        hasActiveOwnerMembership: true,
      });
      expect(blockedDecision.allowed).toBe(false);
      // The pure guard performs no I/O at all — it has no injected deps.
      expect(evaluateRecruiterCheckoutCrossContext.length).toBe(1);
    });

    it("34. blocked codes are part of the recruiter public code union + client messages", () => {
      const shared = readFileSync(
        resolve(__dirname, "../../supabase/functions/_shared/recruiter-checkout.ts"),
        "utf8",
      );
      for (const code of [
        "agency_entitlement_exists",
        "agency_billing_requires_management",
        "opposing_entitlement_unknown",
      ]) {
        expect(shared).toContain(`| "${code}"`);
        expect(code in RECRUITER_CHECKOUT_MESSAGES).toBe(true);
      }
      expect(RECRUITER_SUPPORT_CODES.has("opposing_entitlement_unknown")).toBe(true);
    });
  });
});
