// Phase 1R-D1 — focused runtime tests for the Agency Checkout orchestrator in
// supabase/functions/_shared/agency-checkout.ts.
//
// These tests exercise the production module directly through stateful
// in-memory fakes for the entitlement store and the Stripe surface. No real
// Stripe, Supabase, or network. An injected clock controls expiration.

import { beforeEach, describe, expect, it } from "vitest";

import {
  AGENCY_CHECKOUT_TTL_SECONDS,
  agencyCancelUrl,
  agencyCanonicalMetadata,
  agencyCheckoutIdempotencyKey,
  agencyCustomerIdempotencyKey,
  agencySessionMetadata,
  agencySuccessUrl,
  isSafeAgencyCheckoutUrl,
  runAgencyCheckout,
  type AgencyCheckoutDeps,
  type AgencyCheckoutInput,
  type AgencyCheckoutResult,
  type AgencyClock,
  type AgencyCustomerLike,
  type AgencyEntitlementStore,
  type AgencySessionLike,
  type AgencyStripeGateway,
  type AgencySubscriptionLike,
} from "../../supabase/functions/_shared/agency-checkout";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENCY_ID = "agency-1";
const OWNER_ID = "owner-1";
const PLAN = "agency_team" as const;
const PRICE_ID = "price_test_agency_team";
const ORIGIN = "https://haultrackerpro.com";
const NOW = 1_800_000_000;

function baseInput(over: Partial<AgencyCheckoutInput> = {}): AgencyCheckoutInput {
  return {
    agencyId: AGENCY_ID,
    ownerUserId: OWNER_ID,
    planKey: PLAN,
    priceId: PRICE_ID,
    origin: ORIGIN,
    ...over,
  };
}

const canonicalMeta = () =>
  agencyCanonicalMetadata({ agencyId: AGENCY_ID, ownerUserId: OWNER_ID });
const sessionMeta = () =>
  agencySessionMetadata({
    agencyId: AGENCY_ID,
    ownerUserId: OWNER_ID,
    planKey: PLAN,
  });

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeStore implements AgencyEntitlementStore {
  customers = new Map<string, string>();
  saveCalls: Array<{ agencyId: string; customerId: string }> = [];
  failLoad = false;
  failSave = false;

  async loadCustomerId({ agencyId }: { agencyId: string }) {
    if (this.failLoad) throw new Error("db down");
    return { stripeCustomerId: this.customers.get(agencyId) ?? null };
  }
  async saveCustomerId(input: { agencyId: string; customerId: string }) {
    if (this.failSave) throw new Error("db down");
    this.saveCalls.push({ ...input });
    this.customers.set(input.agencyId, input.customerId);
  }
}

class FakeStripe implements AgencyStripeGateway {
  customers = new Map<string, AgencyCustomerLike>();
  subscriptions = new Map<string, AgencySubscriptionLike[]>();
  sessions: AgencySessionLike[] = [];

  createCustomerCalls: Array<{ idempotencyKey: string; metadata: Record<string, string> }> = [];
  createSessionCalls: Array<{
    customerId: string;
    priceId: string;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    expiresAt: number;
    idempotencyKey: string;
  }> = [];

  failRetrieveCustomer = false;
  failSearch = false;
  failCreateCustomer = false;
  failListSubscriptions = false;
  failListSessions = false;
  failCreateSession = false;

  /** Overrides the session object returned by createSession. */
  createSessionOverride: Partial<AgencySessionLike> | null = null;

  private seq = 0;

  async retrieveCustomer(id: string) {
    if (this.failRetrieveCustomer) throw new Error("stripe down");
    return this.customers.get(id) ?? null;
  }

  async searchCustomersByMetadata(q: { agencyId: string; ownerUserId: string }) {
    if (this.failSearch) throw new Error("stripe down");
    return [...this.customers.values()].filter(
      (c) =>
        !c.deleted &&
        c.metadata?.billing_context === "agency" &&
        c.metadata?.billing_type === "agency" &&
        c.metadata?.agency_id === q.agencyId &&
        c.metadata?.owner_user_id === q.ownerUserId,
    );
  }

  async createCustomer(input: {
    agencyId: string;
    ownerUserId: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }) {
    if (this.failCreateCustomer) throw new Error("stripe down");
    const existing = this.createCustomerCalls.find(
      (c) => c.idempotencyKey === input.idempotencyKey,
    );
    this.createCustomerCalls.push({
      idempotencyKey: input.idempotencyKey,
      metadata: { ...input.metadata },
    });
    if (existing) {
      // Stripe idempotency replays the original object.
      const prior = [...this.customers.values()].find((c) =>
        c.id.startsWith("cus_created"),
      );
      if (prior) return prior;
    }
    const c: AgencyCustomerLike = {
      id: `cus_created_${++this.seq}`,
      deleted: false,
      metadata: { ...input.metadata },
    };
    this.customers.set(c.id, c);
    return c;
  }

  async listAllSubscriptions(customerId: string) {
    if (this.failListSubscriptions) throw new Error("stripe down");
    return this.subscriptions.get(customerId) ?? [];
  }

  async listAllSessions(customerId: string) {
    if (this.failListSessions) throw new Error("stripe down");
    return this.sessions.filter((s) => s.customer === customerId);
  }

  async createSession(input: {
    customerId: string;
    priceId: string;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    expiresAt: number;
    idempotencyKey: string;
  }) {
    if (this.failCreateSession) throw new Error("stripe down");
    const replay = this.createSessionCalls.find(
      (c) => c.idempotencyKey === input.idempotencyKey,
    );
    this.createSessionCalls.push({ ...input, metadata: { ...input.metadata } });
    if (replay) {
      const prior = this.sessions.find(
        (s) => s.customer === input.customerId && s.status === "open",
      );
      if (prior) return prior;
    }
    const s: AgencySessionLike = {
      id: `cs_test_${++this.seq}`,
      status: "open",
      url: `https://checkout.stripe.com/c/pay/cs_test_${this.seq}`,
      customer: input.customerId,
      expires_at: input.expiresAt,
      metadata: { ...input.metadata },
      ...(this.createSessionOverride ?? {}),
    };
    if (!this.createSessionOverride) this.sessions.push(s);
    return s;
  }
}

class FakeClock implements AgencyClock {
  constructor(public now = NOW) {}
  nowSeconds() {
    return this.now;
  }
}

function makeCustomer(
  id: string,
  metadata: Record<string, string>,
  deleted = false,
): AgencyCustomerLike {
  return { id, deleted, metadata };
}

function makeSession(over: Partial<AgencySessionLike>): AgencySessionLike {
  return {
    id: "cs_existing",
    status: "open",
    url: "https://checkout.stripe.com/c/pay/cs_existing",
    customer: "cus_canonical",
    expires_at: NOW + 600,
    metadata: sessionMeta(),
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe("Phase 1R-D1 — agency checkout orchestrator", () => {
  let store: FakeStore;
  let stripe: FakeStripe;
  let clock: FakeClock;
  let deps: AgencyCheckoutDeps;

  beforeEach(() => {
    store = new FakeStore();
    stripe = new FakeStripe();
    clock = new FakeClock();
    deps = { store, stripe, clock };
  });

  // -- helpers --------------------------------------------------------------
  const run = (over: Partial<AgencyCheckoutInput> = {}) =>
    runAgencyCheckout(baseInput(over), deps);

  const seedCanonical = () => {
    stripe.customers.set(
      "cus_canonical",
      makeCustomer("cus_canonical", canonicalMeta()),
    );
    store.customers.set(AGENCY_ID, "cus_canonical");
  };

  describe("happy path + idempotency", () => {
    it("1. creates exactly one customer and one session with exact contract", async () => {
      const r = await run();
      expect(r.status).toBe(200);
      expect(r.code).toBe("checkout_ready");
      expect(isSafeAgencyCheckoutUrl(r.url)).toBe(true);

      expect(stripe.createCustomerCalls.length).toBe(1);
      expect(stripe.createCustomerCalls[0].idempotencyKey).toBe(
        agencyCustomerIdempotencyKey(AGENCY_ID),
      );
      expect(stripe.createCustomerCalls[0].metadata).toEqual(canonicalMeta());

      expect(stripe.createSessionCalls.length).toBe(1);
      const call = stripe.createSessionCalls[0];
      expect(call.priceId).toBe(PRICE_ID);
      expect(call.metadata).toEqual(sessionMeta());
      expect(call.successUrl).toBe(agencySuccessUrl(ORIGIN));
      expect(call.cancelUrl).toBe(agencyCancelUrl(ORIGIN));
      expect(call.expiresAt).toBe(NOW + AGENCY_CHECKOUT_TTL_SECONDS);
      expect(call.idempotencyKey).toBe(
        agencyCheckoutIdempotencyKey(AGENCY_ID, PLAN, NOW),
      );

      // Customer persisted through the store, plan/status untouched.
      expect(store.saveCalls.length).toBe(1);
      expect(store.saveCalls[0].agencyId).toBe(AGENCY_ID);
    });

    it("2. sequential retry reuses the open session; create counts stay 1/1", async () => {
      const first = await run();
      const second = await run();
      expect(second.code).toBe("checkout_ready");
      expect(second.url).toBe(first.url);
      expect(stripe.createCustomerCalls.length).toBe(1);
      expect(stripe.createSessionCalls.length).toBe(1);
    });

    it("3. the idempotency key is stable inside a 30-minute bucket and rotates after", () => {
      const k1 = agencyCheckoutIdempotencyKey(AGENCY_ID, PLAN, NOW);
      const k2 = agencyCheckoutIdempotencyKey(AGENCY_ID, PLAN, NOW + 60);
      const k3 = agencyCheckoutIdempotencyKey(
        AGENCY_ID,
        PLAN,
        NOW + AGENCY_CHECKOUT_TTL_SECONDS,
      );
      expect(k1).toBe(k2);
      expect(k1).not.toBe(k3);
      expect(k1.startsWith(`htp:agency:checkout:${AGENCY_ID}:${PLAN}:`)).toBe(true);
    });
  });

  describe("customer identity", () => {
    it("4. reuses an existing canonical customer without creating one", async () => {
      seedCanonical();
      const r = await run();
      expect(r.code).toBe("checkout_ready");
      expect(stripe.createCustomerCalls.length).toBe(0);
      expect(stripe.createSessionCalls[0].customerId).toBe("cus_canonical");
    });

    it("5. reuses an exact metadata-search customer and persists it", async () => {
      stripe.customers.set(
        "cus_found",
        makeCustomer("cus_found", canonicalMeta()),
      );
      const r = await run();
      expect(r.code).toBe("checkout_ready");
      expect(stripe.createCustomerCalls.length).toBe(0);
      expect(store.saveCalls).toEqual([
        { agencyId: AGENCY_ID, customerId: "cus_found" },
      ]);
    });

    it("6. ignores an email-only lookalike customer with no agency metadata", async () => {
      stripe.customers.set(
        "cus_email_only",
        makeCustomer("cus_email_only", { email_hint: "owner@example.com" }),
      );
      const r = await run();
      expect(r.code).toBe("checkout_ready");
      expect(stripe.createCustomerCalls.length).toBe(1);
      expect(stripe.createSessionCalls[0].customerId).not.toBe("cus_email_only");
    });

    it("7. rejects ambiguous exact customers", async () => {
      stripe.customers.set("cus_a", makeCustomer("cus_a", canonicalMeta()));
      stripe.customers.set("cus_b", makeCustomer("cus_b", canonicalMeta()));
      const r = await run();
      expect(r.status).toBe(409);
      expect(r.code).toBe("customer_ambiguous");
      expect(stripe.createSessionCalls.length).toBe(0);
    });

    it("8. rejects a missing canonical customer", async () => {
      store.customers.set(AGENCY_ID, "cus_gone");
      const r = await run();
      expect(r.code).toBe("customer_not_found");
      expect(stripe.createCustomerCalls.length).toBe(0);
    });

    it("9. rejects a deleted canonical customer", async () => {
      store.customers.set(AGENCY_ID, "cus_dead");
      stripe.customers.set(
        "cus_dead",
        makeCustomer("cus_dead", canonicalMeta(), true),
      );
      const r = await run();
      expect(r.code).toBe("customer_not_found");
    });

    it("10. rejects a canonical customer with mismatched metadata and never replaces it", async () => {
      store.customers.set(AGENCY_ID, "cus_other");
      stripe.customers.set(
        "cus_other",
        makeCustomer("cus_other", {
          ...canonicalMeta(),
          agency_id: "agency-other",
        }),
      );
      const r = await run();
      expect(r.code).toBe("customer_conflict");
      expect(stripe.createCustomerCalls.length).toBe(0);
      expect(store.saveCalls.length).toBe(0);
    });

    it("11. rejects a created customer whose returned metadata does not match", async () => {
      const original = stripe.createCustomer.bind(stripe);
      stripe.createCustomer = async (input) => {
        await original(input);
        return makeCustomer("cus_bad", { billing_context: "agency" });
      };
      const r = await run();
      expect(r.code).toBe("customer_conflict");
      expect(stripe.createSessionCalls.length).toBe(0);
    });
  });

  describe("same-context subscription guard", () => {
    const blocking = [
      "active",
      "trialing", // trial-allowlist: Stripe subscription status literal
      "past_due",
      "unpaid",
      "incomplete",
      "paused",
    ];

    for (const status of blocking) {
      it(`12.${status} — blocks checkout when a ${status} subscription exists`, async () => {
        seedCanonical();
        stripe.subscriptions.set("cus_canonical", [{ id: "sub_1", status }]);
        const r = await run();
        expect(r.status).toBe(409);
        expect(r.code).toBe("subscription_exists");
        expect(stripe.createSessionCalls.length).toBe(0);
      });
    }

    it("13. allows checkout with only canceled + incomplete_expired subscriptions", async () => {
      seedCanonical();
      stripe.subscriptions.set("cus_canonical", [
        { id: "sub_1", status: "canceled" },
        { id: "sub_2", status: "incomplete_expired" },
      ]);
      const r = await run();
      expect(r.code).toBe("checkout_ready");
    });

    it("14. fails closed on an unknown subscription status", async () => {
      seedCanonical();
      stripe.subscriptions.set("cus_canonical", [{ id: "sub_1", status: "frozen" }]);
      const r = await run();
      expect(r.code).toBe("unknown_subscription_status");
      expect(stripe.createSessionCalls.length).toBe(0);
    });
  });

  describe("open-session reuse", () => {
    it("15. reuses exactly one valid open exact session with zero create calls", async () => {
      seedCanonical();
      stripe.sessions.push(makeSession({}));
      const r = await run();
      expect(r.code).toBe("checkout_ready");
      expect(r.url).toBe("https://checkout.stripe.com/c/pay/cs_existing");
      expect(stripe.createSessionCalls.length).toBe(0);
    });

    it("16. requires support when more than one valid open exact session exists", async () => {
      seedCanonical();
      stripe.sessions.push(makeSession({ id: "cs_1" }));
      stripe.sessions.push(makeSession({ id: "cs_2" }));
      const r = await run();
      expect(r.code).toBe("support_required");
      expect(stripe.createSessionCalls.length).toBe(0);
    });

    it("17. returns processing for a complete exact session with no subscription row", async () => {
      seedCanonical();
      stripe.sessions.push(makeSession({ status: "complete", url: null }));
      const r = await run();
      expect(r.code).toBe("checkout_processing");
      expect(stripe.createSessionCalls.length).toBe(0);
    });

    it("18. ignores an expired exact session and starts a fresh checkout", async () => {
      seedCanonical();
      stripe.sessions.push(makeSession({ status: "expired", url: null }));
      stripe.sessions.push(makeSession({ id: "cs_old", expires_at: NOW - 10 }));
      const r = await run();
      expect(r.code).toBe("checkout_ready");
      expect(stripe.createSessionCalls.length).toBe(1);
    });

    it("19. fails closed on an unknown exact session status", async () => {
      seedCanonical();
      stripe.sessions.push(makeSession({ status: "weird_state" }));
      const r = await run();
      expect(r.code).toBe("session_invalid");
      expect(stripe.createSessionCalls.length).toBe(0);
    });

    it("20. fails closed on an open exact session with a non-Stripe URL", async () => {
      seedCanonical();
      stripe.sessions.push(makeSession({ url: "https://evil.example/pay" }));
      const r = await run();
      expect(r.code).toBe("session_invalid");
    });

    it("21. ignores sessions whose metadata does not exactly match", async () => {
      seedCanonical();
      stripe.sessions.push(
        makeSession({
          id: "cs_other_plan",
          metadata: { ...sessionMeta(), plan_key: "agency_growth" },
        }),
      );
      const r = await run();
      expect(r.code).toBe("checkout_ready");
      expect(stripe.createSessionCalls.length).toBe(1);
    });
  });

  describe("R1 — historical completed-session freshness", () => {
    it("R1-1. returns processing for a completed exact session with future expiry", async () => {
      seedCanonical();
      stripe.sessions.push(
        makeSession({ status: "complete", url: null, expires_at: NOW + 300 }),
      );
      const r = await run();
      expect(r.code).toBe("checkout_processing");
      expect(stripe.createSessionCalls.length).toBe(0);
    });

    it("R1-2. ignores a historical completed session and starts a fresh checkout", async () => {
      seedCanonical();
      stripe.sessions.push(
        makeSession({
          id: "cs_history",
          status: "complete",
          url: null,
          expires_at: NOW - 1,
        }),
      );
      const r = await run();
      expect(r.code).toBe("checkout_ready");
      expect(stripe.createSessionCalls.length).toBe(1);
    });

    for (const [label, expires] of [
      ["zero", 0],
      ["negative", -5],
    ] as const) {
      it(`R1-3${label}. fails closed on a completed session with ${label} expiry`, async () => {
        seedCanonical();
        stripe.sessions.push(
          makeSession({ status: "complete", url: null, expires_at: expires }),
        );
        const r = await run();
        expect(r.code).toBe("session_invalid");
        expect(stripe.createSessionCalls.length).toBe(0);
      });
    }

    it("R1-3c. fails closed on a completed session with malformed expiry", async () => {
      seedCanonical();
      stripe.sessions.push(
        makeSession({
          status: "complete",
          url: null,
          expires_at: "soon" as unknown as number,
        }),
      );
      const r = await run();
      expect(r.code).toBe("session_invalid");
      expect(stripe.createSessionCalls.length).toBe(0);
    });

    it("R1-4. fails closed on a completed session belonging to another customer", async () => {
      seedCanonical();
      // The real gateway lists by customer; simulate Stripe returning a
      // foreign-customer row so the orchestrator's own identity check is proven.
      const foreign = makeSession({
        status: "complete",
        url: null,
        customer: "cus_someone_else",
      });
      stripe.listAllSessions = async () => [foreign];
      const r = await run();
      expect(r.code).toBe("session_invalid");
      expect(stripe.createSessionCalls.length).toBe(0);
    });


    it("R1-5. prefers a valid open session over a historical completed session", async () => {
      seedCanonical();
      stripe.sessions.push(
        makeSession({
          id: "cs_history",
          status: "complete",
          url: null,
          expires_at: NOW - 1,
        }),
      );
      stripe.sessions.push(makeSession({ id: "cs_open" }));
      const r = await run();
      expect(r.code).toBe("checkout_ready");
      expect(r.url).toBe("https://checkout.stripe.com/c/pay/cs_existing");
      expect(stripe.createSessionCalls.length).toBe(0);
    });
  });

  describe("R2 — completed-session identity and finite expiry", () => {
    for (const [label, id] of [
      ["empty", ""],
      ["whitespace-only", "   "],
    ] as const) {
      it(`R2-1${label}. fails closed on a completed session with ${label} id`, async () => {
        seedCanonical();
        stripe.sessions.push(
          makeSession({
            id,
            status: "complete",
            url: null,
            expires_at: NOW + 300,
          }),
        );
        const r = await run();
        expect(r.code).toBe("session_invalid");
        expect(stripe.createSessionCalls.length).toBe(0);
      });
    }

    for (const [label, expires] of [
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
    ] as const) {
      it(`R2-2${label}. fails closed on a completed session with ${label} expiry`, async () => {
        seedCanonical();
        stripe.sessions.push(
          makeSession({
            id: "cs_malformed_expiry",
            status: "complete",
            url: null,
            expires_at: expires,
          }),
        );
        const r = await run();
        expect(r.code).toBe("session_invalid");
        expect(stripe.createSessionCalls.length).toBe(0);
      });
    }
  });



  describe("returned-session validation", () => {
    const cases: Array<[string, Partial<AgencySessionLike>]> = [
      ["empty id", { id: "" }],
      ["non-open status", { status: "complete" }],
      ["missing url", { url: null }],
      ["unsafe url", { url: "https://checkout.stripe.com.evil.example/x" }],
      ["wrong customer", { customer: "cus_other" }],
      ["wrong expiry", { expires_at: NOW + 60 }],
      ["wrong metadata", { metadata: { billing_context: "agency" } }],
    ];

    for (const [label, override] of cases) {
      it(`22.${label} — rejects the returned session`, async () => {
        seedCanonical();
        stripe.createSessionOverride = override;
        const r = await run();
        expect(r.code).toBe("session_invalid");
        expect(r.url).toBeUndefined();
      });
    }
  });

  describe("transient failures are safe and retryable", () => {
    const failures: Array<[string, (s: FakeStore, g: FakeStripe) => void]> = [
      ["store load", (s) => (s.failLoad = true)],
      ["store save", (s) => (s.failSave = true)],
      ["customer search", (_s, g) => (g.failSearch = true)],
      ["customer create", (_s, g) => (g.failCreateCustomer = true)],
    ];
    for (const [label, apply] of failures) {
      it(`23.${label} — returns transient_error`, async () => {
        apply(store, stripe);
        const r = await run();
        expect(r.status).toBe(503);
        expect(r.code).toBe("transient_error");
      });
    }

    it("23.subscription list — returns transient_error", async () => {
      seedCanonical();
      stripe.failListSubscriptions = true;
      const r = await run();
      expect(r.code).toBe("transient_error");
    });

    it("23.session list — returns transient_error", async () => {
      seedCanonical();
      stripe.failListSessions = true;
      const r = await run();
      expect(r.code).toBe("transient_error");
    });

    it("23.session create — returns transient_error", async () => {
      seedCanonical();
      stripe.failCreateSession = true;
      const r = await run();
      expect(r.code).toBe("transient_error");
    });

    it("23.canonical retrieve — returns transient_error", async () => {
      seedCanonical();
      stripe.failRetrieveCustomer = true;
      const r = await run();
      expect(r.code).toBe("transient_error");
    });
  });

  describe("validation before any dependency work", () => {
    it("24. rejects an invalid plan", async () => {
      const r = await runAgencyCheckout(
        // deliberately invalid plan value
        baseInput({ planKey: "agency_ultra" as never }),
        deps,
      );
      expect(r.code).toBe("invalid_plan");
      expect(stripe.createCustomerCalls.length).toBe(0);
      expect(store.saveCalls.length).toBe(0);
    });

    it("25. rejects a non-allowlisted origin", async () => {
      const r = await run({ origin: "https://evil.example" });
      expect(r.code).toBe("invalid_origin");
      expect(stripe.createCustomerCalls.length).toBe(0);
    });

    it("26. rejects a blank price", async () => {
      const r = await run({ priceId: "   " });
      expect(r.code).toBe("invalid_price");
      expect(stripe.createCustomerCalls.length).toBe(0);
    });

    it("27. rejects a missing owner id", async () => {
      const r = await run({ ownerUserId: "" });
      expect(r.code).toBe("not_owner");
      expect(stripe.createCustomerCalls.length).toBe(0);
    });
  });

  describe("cross-context short circuit", () => {
    it("28. blocks on recruiter_subscription_exists before any dependency call", async () => {
      const r = await run({
        crossContext: {
          allowed: false,
          code: "recruiter_subscription_exists",
          status: 409,
          message: "You already have recruiter premium billing.",
        },
      });
      expect(r.code).toBe("recruiter_subscription_exists");
      expect(stripe.createCustomerCalls.length).toBe(0);
      expect(stripe.createSessionCalls.length).toBe(0);
      expect(store.saveCalls.length).toBe(0);
    });

    it("29. blocks on opposing_entitlement_unknown before any dependency call", async () => {
      const r = await run({
        crossContext: {
          allowed: false,
          code: "opposing_entitlement_unknown",
          status: 409,
          message: "We could not safely confirm your existing business billing.",
        },
      });
      expect(r.code).toBe("opposing_entitlement_unknown");
      expect(stripe.createCustomerCalls.length).toBe(0);
    });

    it("30. proceeds when the cross-context decision allows", async () => {
      const r = await run({ crossContext: { allowed: true } });
      expect(r.code).toBe("checkout_ready");
    });
  });

  describe("R1 — plan-independent customer metadata contract", () => {
    it("R1-6. customer metadata omits plan_key so the customer is reusable across plans", () => {
      expect(Object.keys(canonicalMeta()).sort()).toEqual([
        "agency_id",
        "billing_context",
        "billing_type",
        "owner_user_id",
      ]);
      expect(canonicalMeta()).not.toHaveProperty("plan_key");
    });

    it("R1-7. session metadata is the customer metadata plus plan_key", () => {
      expect(sessionMeta()).toEqual({ ...canonicalMeta(), plan_key: PLAN });
    });
  });


  describe("safe public surface", () => {
    it("31. no result message leaks IDs, URLs, emails, or vendor names", async () => {
      const results: AgencyCheckoutResult[] = [];
      results.push(await run({ origin: "https://evil.example" }));
      results.push(await run({ priceId: "" }));

      store.customers.set(AGENCY_ID, "cus_gone");
      results.push(await run());
      store.customers.delete(AGENCY_ID);

      store.failLoad = true;
      results.push(await run());
      store.failLoad = false;

      seedCanonical();
      stripe.subscriptions.set("cus_canonical", [{ id: "sub_x", status: "active" }]);
      results.push(await run());

      for (const r of results) {
        expect(r.message).not.toMatch(/cus_|sub_|cs_|price_|sk_|https?:\/\//);
        expect(r.message).not.toMatch(/@/);
        expect(r.message).not.toMatch(/Stripe|Supabase/);
        expect(r.message.length).toBeGreaterThan(0);
      }
    });

    it("32. the exact URL validator rejects lookalike hosts", () => {
      expect(isSafeAgencyCheckoutUrl("https://checkout.stripe.com/c/pay/x")).toBe(
        true,
      );
      expect(isSafeAgencyCheckoutUrl("https://checkout.stripe.com.evil/x")).toBe(
        false,
      );
      expect(isSafeAgencyCheckoutUrl("https://evilcheckout.stripe.com/x")).toBe(
        false,
      );
      expect(isSafeAgencyCheckoutUrl("http://checkout.stripe.com/x")).toBe(false);
      expect(isSafeAgencyCheckoutUrl("")).toBe(false);
      expect(isSafeAgencyCheckoutUrl(null)).toBe(false);
    });
  });
});
