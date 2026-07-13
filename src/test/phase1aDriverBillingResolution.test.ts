import { describe, it, expect } from "vitest";
import {
  resolveDriverStripeCustomerId,
  resolveOrCreateDriverStripeCustomerId,
  resolveDriverPlanKey,
  DriverBillingConflictError,
} from "../../supabase/functions/_shared/driver-billing";
import { performAccountDeletion } from "../../supabase/functions/_shared/account-deletion";

type Row = Record<string, any>;

function makeFakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = seed;
  function ensure(name: string) { return tables[name] ?? (tables[name] = []); }

  function from(name: string) {
    const rows = ensure(name);
    let filters: ((r: Row) => boolean)[] = [];
    let mode: "select" | "delete" | "update" = "select";
    let patch: Row | null = null;
    let single = false;

    async function exec(): Promise<{ data: any; error: any }> {
      if (mode === "delete") {
        const keep = rows.filter((r) => !filters.every((f) => f(r)));
        rows.length = 0; rows.push(...keep);
        return { data: null, error: null };
      }
      const matches = rows.filter((r) => filters.every((f) => f(r)));
      if (mode === "update") {
        matches.forEach((r) => Object.assign(r, patch));
      }
      if (single) return { data: matches[0] ? { ...matches[0] } : null, error: null };
      return { data: matches.map((r) => ({ ...r })), error: null };
    }

    const builder: any = {
      select(_c?: string) { return builder; },
      delete() { mode = "delete"; return builder; },
      update(p: Row) { mode = "update"; patch = p; return builder; },
      eq(col: string, val: any) { filters.push((r) => r[col] === val); return builder; },
      in(col: string, vals: any[]) { filters.push((r) => vals.includes(r[col])); return builder; },
      is(col: string, val: any) { filters.push((r) => (r[col] ?? null) === val); return builder; },
      async maybeSingle() { single = true; return exec(); },
      async upsert(row: Row, opts: { onConflict: string; ignoreDuplicates?: boolean }) {
        const key = opts.onConflict;
        const idx = rows.findIndex((r) => r[key] === row[key]);
        if (idx >= 0) { if (!opts.ignoreDuplicates) Object.assign(rows[idx], row); }
        else { rows.push({ ...row }); }
        return { data: null, error: null };
      },
      then(onf: any, onr: any) { return exec().then(onf, onr); },
    };
    return builder;
  }
  return { from, _tables: tables };
}

function makeFakeStripe(seed: { customers?: Record<string, any>; subscriptions?: Record<string, any> } = {}) {
  const customers = seed.customers ?? {};
  const subscriptions = seed.subscriptions ?? {};
  let n = 1000;
  const createCalls: any[] = [];
  const cancelCalls: string[] = [];
  return {
    _customers: customers,
    _createCalls: createCalls,
    _cancelCalls: cancelCalls,
    customers: {
      async create(params: any) {
        const id = `cus_fake_${n++}`;
        customers[id] = { id, ...params, deleted: false };
        createCalls.push(params);
        return customers[id];
      },
      async update(id: string, params: any) { customers[id] = { ...customers[id], ...params }; return customers[id]; },
      async del(id: string) { if (customers[id]) customers[id].deleted = true; return { id, deleted: true }; },
      // Deliberately no `list` — any email-based lookup throws, which is
      // real executable proof no driver billing path performs one.
    },
    subscriptions: {
      async retrieve(id: string) {
        const sub = subscriptions[id];
        if (!sub) { const e: any = new Error("No such subscription"); e.code = "resource_missing"; throw e; }
        return sub;
      },
      async cancel(id: string) {
        cancelCalls.push(id);
        const sub = subscriptions[id];
        if (!sub) { const e: any = new Error("No such subscription"); e.code = "resource_missing"; throw e; }
        sub.status = "canceled";
        return sub;
      },
      async list(_p: any) { return { data: [] }; },
    },
  };
}

const DRIVER_PRICE = { id: "price_monthly_test" };

// Phase 1B-1: driver price configuration is now always passed in explicitly
// by the caller (Part 2). These tests build the config themselves — they
// never rely on an ambient Deno global or a test-setup shim.
const TEST_CONFIG = { pro_monthly: "price_monthly_test", pro_yearly: "price_yearly_test" };
const OTHER_CONFIG = { pro_monthly: "price_monthly_OTHER", pro_yearly: "price_yearly_OTHER" };

describe("Phase 1B-1 — runtime neutrality", () => {
  it("driver-billing.ts and account-deletion.ts import cleanly with no ambient Deno global present", () => {
    // If either shared module read `Deno.env` internally (the Phase 1A
    // defect), this assertion on the ambient global would still pass or
    // fail independently of the import — the real proof is that the two
    // imports above at the top of this file already succeeded without a
    // test-setup Deno shim. This assertion documents that no such shim was
    // needed or installed.
    expect(typeof (globalThis as any).Deno).toBe("undefined");
  });

  it("resolveDriverPlanKey has no hidden dependency on process-wide state — identical price id resolves differently under two different explicit configs", () => {
    expect(resolveDriverPlanKey("price_monthly_test", TEST_CONFIG)).toBe("pro_monthly");
    expect(resolveDriverPlanKey("price_monthly_test", OTHER_CONFIG)).toBeNull();
    expect(resolveDriverPlanKey("price_monthly_OTHER", OTHER_CONFIG)).toBe("pro_monthly");
  });
});

describe("resolveDriverStripeCustomerId — isolation across billing contexts", () => {
  it("returns only the driver's own customer even when a different customer id exists for recruiter and agency billing under the same conceptual account", async () => {
    const db = makeFakeDb({
      subscriptions: [{ user_id: "user-1", stripe_customer_id: "cus_driver_1", stripe_subscription_id: "sub_driver_1" }],
      profiles: [{ user_id: "user-1", stripe_customer_id: "cus_driver_1" }],
      recruiter_billing_profiles: [{ user_id: "user-1", stripe_customer_id: "cus_recruiter_1" }],
      agency_entitlements: [{ agency_id: "agency-1", stripe_customer_id: "cus_agency_1" }],
    });
    const stripe = makeFakeStripe();
    const result = await resolveDriverStripeCustomerId(db, stripe as any, "user-1", TEST_CONFIG);
    expect(result).toBe("cus_driver_1");
  });

  it("throws DriverBillingConflictError instead of silently reusing a customer id that is also a recruiter customer", async () => {
    const db = makeFakeDb({
      subscriptions: [{ user_id: "user-2", stripe_customer_id: "cus_shared", stripe_subscription_id: null }],
      profiles: [{ user_id: "user-2", stripe_customer_id: "cus_shared" }],
      recruiter_billing_profiles: [{ user_id: "user-2", stripe_customer_id: "cus_shared" }],
      agency_entitlements: [],
    });
    const stripe = makeFakeStripe();
    await expect(resolveDriverStripeCustomerId(db, stripe as any, "user-2", TEST_CONFIG)).rejects.toBeInstanceOf(DriverBillingConflictError);
  });

  it("returns null (never throws, never guesses) when no customer id exists anywhere", async () => {
    const db = makeFakeDb({ subscriptions: [{ user_id: "user-3" }], profiles: [{ user_id: "user-3" }] });
    const stripe = makeFakeStripe();
    const result = await resolveDriverStripeCustomerId(db, stripe as any, "user-3", TEST_CONFIG);
    expect(result).toBeNull();
  });

  it("rejects a derived subscription whose price is valid under a different config than the one passed in (proves config is actually threaded through, not hardcoded)", async () => {
    const db = makeFakeDb({
      subscriptions: [{ user_id: "user-3b", stripe_customer_id: null, stripe_subscription_id: "sub_3b" }],
      profiles: [{ user_id: "user-3b" }],
    });
    const stripe = makeFakeStripe({ subscriptions: { sub_3b: { id: "sub_3b", status: "active", customer: "cus_3b", items: { data: [{ price: DRIVER_PRICE }] } } } });
    // DRIVER_PRICE.id ("price_monthly_test") is only valid under TEST_CONFIG.
    await expect(resolveDriverStripeCustomerId(db, stripe as any, "user-3b", OTHER_CONFIG)).rejects.toBeInstanceOf(DriverBillingConflictError);
    const db2 = makeFakeDb({
      subscriptions: [{ user_id: "user-3c", stripe_customer_id: null, stripe_subscription_id: "sub_3c" }],
      profiles: [{ user_id: "user-3c" }],
    });
    const stripe2 = makeFakeStripe({ subscriptions: { sub_3c: { id: "sub_3c", status: "active", customer: "cus_3c", items: { data: [{ price: DRIVER_PRICE }] } } } });
    const result = await resolveDriverStripeCustomerId(db2, stripe2 as any, "user-3c", TEST_CONFIG);
    expect(result).toBe("cus_3c");
  });
});

describe("resolveOrCreateDriverStripeCustomerId", () => {
  it("creates a dedicated driver customer, writes it to subscriptions, and tags it with driver metadata when none exists", async () => {
    const db = makeFakeDb({ subscriptions: [], profiles: [] });
    const stripe = makeFakeStripe();
    const customerId = await resolveOrCreateDriverStripeCustomerId(db, stripe as any, "user-4", "driver4@example.com", TEST_CONFIG);
    expect(customerId).toMatch(/^cus_fake_/);
    expect(stripe._createCalls.length).toBe(1);
    expect(stripe._createCalls[0].metadata).toEqual({ billing_context: "driver", user_id: "user-4" });
    const subRow = db._tables.subscriptions.find((r: any) => r.user_id === "user-4");
    expect(subRow.stripe_customer_id).toBe(customerId);
  });

  it("reuses an existing dedicated driver customer and never calls stripe.customers.create again", async () => {
    const db = makeFakeDb({
      subscriptions: [{ user_id: "user-5", stripe_customer_id: "cus_existing", stripe_subscription_id: null }],
      profiles: [{ user_id: "user-5", stripe_customer_id: "cus_existing" }],
      recruiter_billing_profiles: [],
      agency_entitlements: [],
    });
    const stripe = makeFakeStripe();
    const customerId = await resolveOrCreateDriverStripeCustomerId(db, stripe as any, "user-5", "driver5@example.com", TEST_CONFIG);
    expect(customerId).toBe("cus_existing");
    expect(stripe._createCalls.length).toBe(0);
  });

  it("resolves two concurrent creation attempts for the same user to exactly one canonical customer", async () => {
    const db = makeFakeDb({ subscriptions: [], profiles: [] });
    const stripe = makeFakeStripe();
    const [a, b] = await Promise.all([
      resolveOrCreateDriverStripeCustomerId(db, stripe as any, "user-6", "driver6@example.com", TEST_CONFIG),
      resolveOrCreateDriverStripeCustomerId(db, stripe as any, "user-6", "driver6@example.com", TEST_CONFIG),
    ]);
    expect(a).toBe(b);
    const subRow = db._tables.subscriptions.find((r: any) => r.user_id === "user-6");
    expect(subRow.stripe_customer_id).toBe(a);
    const nonDeleted = Object.values(stripe._customers).filter((c: any) => !c.deleted);
    expect(nonDeleted.length).toBe(1);
    expect((nonDeleted[0] as any).id).toBe(a);
  });
});

describe("performAccountDeletion", () => {
  function baseDb(overrides: Record<string, Row[]> = {}) {
    return makeFakeDb({
      subscriptions: [], recruiter_billing_profiles: [], agency_members: [], agency_entitlements: [],
      load_stops: [], expenses: [], fuel_logs: [], loads: [], broker_stats: [], lane_stats: [],
      operating_metrics: [], brokers: [], recurring_expense_templates: [], weekly_snapshots: [],
      feedback_responses: [], parse_usage: [], user_alerts: [], expense_automation_logs: [], ai_insights: [],
      cost_profile: [], parking_favorites: [], parking_reports: [], parking_verifications: [],
      driver_point_events: [], driver_points: [], driver_assistants: [], agency_client_requests: [],
      agency_delegation_requests: [], agency_work_items: [], recruiter_contact_requests: [],
      user_settings: [], profiles: [],
      ...overrides,
    });
  }

  it("cancels the driver's Stripe subscription before deleting local rows", async () => {
    const db = baseDb({
      subscriptions: [{ user_id: "user-7", stripe_subscription_id: "sub_driver_7" }],
      cost_profile: [{ user_id: "user-7", id: "cp-1" }],
    });
    const stripe = makeFakeStripe({ subscriptions: { sub_driver_7: { id: "sub_driver_7", status: "active", items: { data: [{ price: DRIVER_PRICE }] } } } });
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-7", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(true);
    expect(stripe._cancelCalls).toContain("sub_driver_7");
    expect(db._tables.cost_profile.length).toBe(0);
  });

  it("cancels both driver and recruiter subscriptions for a user who is both", async () => {
    const db = baseDb({
      subscriptions: [{ user_id: "user-8", stripe_subscription_id: "sub_driver_8" }],
      recruiter_billing_profiles: [{ user_id: "user-8", stripe_subscription_id: "sub_recruiter_8" }],
    });
    const stripe = makeFakeStripe({
      subscriptions: {
        sub_driver_8: { id: "sub_driver_8", status: "active", items: { data: [{ price: DRIVER_PRICE }] } },
        sub_recruiter_8: { id: "sub_recruiter_8", status: "active", metadata: { billing_context: "recruiter" } },
      },
    });
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-8", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(true);
    expect(stripe._cancelCalls.sort()).toEqual(["sub_driver_8", "sub_recruiter_8"].sort());
  });

  it("cancels the owned agency's subscription for an agency owner", async () => {
    const db = baseDb({
      agency_members: [{ agency_id: "agency-9", member_user_id: "user-9", role: "agency_owner", status: "active" }],
      agency_entitlements: [{ agency_id: "agency-9", stripe_subscription_id: "sub_agency_9" }],
    });
    const stripe = makeFakeStripe({ subscriptions: { sub_agency_9: { id: "sub_agency_9", status: "active", metadata: { billing_context: "agency" } } } });
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-9", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(true);
    expect(stripe._cancelCalls).toContain("sub_agency_9");
    const ent = db._tables.agency_entitlements.find((r: any) => r.agency_id === "agency-9");
    expect(ent.status).toBe("cancelled");
  });

  it("does NOT cancel the agency subscription for a non-owner member", async () => {
    const db = baseDb({
      agency_members: [{ agency_id: "agency-10", member_user_id: "user-10", role: "agency_member", status: "active" }],
      agency_entitlements: [{ agency_id: "agency-10", stripe_subscription_id: "sub_agency_10" }],
    });
    const stripe = makeFakeStripe({ subscriptions: { sub_agency_10: { id: "sub_agency_10", status: "active" } } });
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-10", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(true);
    expect(stripe._cancelCalls).not.toContain("sub_agency_10");
  });

  it("stops deletion and preserves all rows when Stripe cancellation fails", async () => {
    const db = baseDb({
      subscriptions: [{ user_id: "user-11", stripe_subscription_id: "sub_driver_11" }],
      cost_profile: [{ user_id: "user-11", id: "cp-11" }],
    });
    const stripe = makeFakeStripe({ subscriptions: { sub_driver_11: { id: "sub_driver_11", status: "active", items: { data: [{ price: DRIVER_PRICE }] } } } });
    stripe.subscriptions.cancel = async () => { throw new Error("Stripe API is down"); };
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-11", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(false);
    expect(db._tables.subscriptions.length).toBe(1);
    expect(db._tables.cost_profile.length).toBe(1);
  });

  it("treats an already-canceled Stripe subscription as idempotent success and proceeds", async () => {
    const db = baseDb({
      subscriptions: [{ user_id: "user-12", stripe_subscription_id: "sub_driver_12" }],
    });
    const stripe = makeFakeStripe({ subscriptions: { sub_driver_12: { id: "sub_driver_12", status: "canceled", items: { data: [{ price: DRIVER_PRICE }] } } } });
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-12", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(true);
    expect(stripe._cancelCalls).not.toContain("sub_driver_12");
    expect(db._tables.subscriptions.length).toBe(0);
  });

  it("removes rows from every Phase 1A local-data table for the deleted user", async () => {
    const db = baseDb({
      cost_profile: [{ user_id: "user-13", id: "1" }],
      parking_favorites: [{ user_id: "user-13", id: "2" }],
      parking_reports: [{ user_id: "user-13", id: "3" }],
      parking_verifications: [{ user_id: "user-13", id: "4" }],
      driver_points: [{ user_id: "user-13", id: "5" }],
      driver_point_events: [{ user_id: "user-13", id: "6" }],
    });
    const stripe = makeFakeStripe();
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-13", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(true);
    for (const t of ["cost_profile", "parking_favorites", "parking_reports", "parking_verifications", "driver_points", "driver_point_events"]) {
      expect(db._tables[t].length).toBe(0);
    }
  });

  it("stops deletion when a subscription's context doesn't match its expected billing role", async () => {
    const db = baseDb({
      subscriptions: [{ user_id: "user-14", stripe_subscription_id: "sub_mismatch_14" }],
      cost_profile: [{ user_id: "user-14", id: "1" }],
    });
    const stripe = makeFakeStripe({ subscriptions: { sub_mismatch_14: { id: "sub_mismatch_14", status: "active", metadata: { billing_context: "recruiter" } } } });
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-14", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(false);
    expect(stripe._cancelCalls).not.toContain("sub_mismatch_14");
    expect(db._tables.cost_profile.length).toBe(1);
  });

  it("rejects a driver subscription whose price is only valid under a different config than the one passed in (proves driverPriceConfig is threaded through deletion validation, not hardcoded)", async () => {
    const db = baseDb({
      subscriptions: [{ user_id: "user-15", stripe_subscription_id: "sub_driver_15" }],
      cost_profile: [{ user_id: "user-15", id: "1" }],
    });
    const stripe = makeFakeStripe({ subscriptions: { sub_driver_15: { id: "sub_driver_15", status: "active", items: { data: [{ price: DRIVER_PRICE }] } } } });
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-15", driverPriceConfig: OTHER_CONFIG });
    expect(result.ok).toBe(false);
    expect(stripe._cancelCalls).not.toContain("sub_driver_15");
    expect(db._tables.cost_profile.length).toBe(1);
  });
});
