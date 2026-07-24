import { describe, it, expect } from "vitest";
import {
  resolveDriverStripeCustomerId,
  resolveOrCreateDriverStripeCustomerId,
  resolveDriverPlanKey,
  DriverBillingConflictError,
} from "../../supabase/functions/_shared/driver-billing";
import {
  performAccountDeletion,
  AGENCY_OWNER_BLOCK_MESSAGE,
  GENERIC_DELETE_ERROR,
} from "../../supabase/functions/_shared/account-deletion";

type Row = Record<string, any>;

// Phase 1N-F1-A-R1 — schema-aware column set matching the LIVE Postgres
// schema for the tables the repaired orchestration touches. The canonical
// identifier on public.agency_profiles is `id`; there is no `agency_id`
// column on that table, so it MUST NOT appear here. Any .eq/.in/update or
// .select projection against an unknown column on one of these tables must
// produce a 42703-style database error, so a regression to
// `.eq('user_id', ...)` on a relationship table, or a regression to
// `.select('agency_id')` on agency_profiles, cannot silently pass tests.
// Other tables retain the permissive shape used by pre-existing tests.
const SCHEMA_AWARE_COLUMNS: Record<string, Set<string>> = {
  driver_assistants: new Set(["id", "driver_user_id", "assistant_user_id", "status", "role"]),
  agency_work_items: new Set(["id", "agency_id", "driver_user_id", "assigned_member_user_id", "created_by_user_id", "status"]),
  agency_delegation_requests: new Set(["id", "agency_id", "driver_user_id", "member_user_id", "status"]),
  agency_client_requests: new Set(["id", "agency_id", "driver_user_id", "assigned_member_user_id", "status"]),
  agency_members: new Set(["id", "agency_id", "member_user_id", "role", "status", "revoked_at", "invite_email"]),
  agency_profiles: new Set(["id", "owner_user_id", "name"]),
  agency_entitlements: new Set(["id", "agency_id", "stripe_subscription_id", "stripe_customer_id", "status", "current_period_end", "updated_at"]),
};

type OpEvent =
  | { kind: "db.select"; table: string; cols: string[] | null }
  | { kind: "db.delete"; table: string; filters: string[] }
  | { kind: "db.update"; table: string; filters: string[] }
  | { kind: "stripe.retrieve"; id: string }
  | { kind: "stripe.cancel"; id: string };

function parseCols(cols?: string): string[] | null {
  if (!cols || cols.trim() === "" || cols.trim() === "*") return null;
  return cols.split(",").map((s) => s.trim()).filter(Boolean);
}

function makeFakeDb(seed: Record<string, Row[]> = {}, opsLog: OpEvent[] = []) {
  const tables: Record<string, Row[]> = seed;
  const executedFilters: { table: string; op: string; col: string }[] = [];
  const tableCalls: { table: string; mode: string }[] = [];
  const selectCalls: { table: string; cols: string[] | null; filters: string[] }[] = [];
  const errorInjections: { table: string; mode: "delete" | "update" | "select"; col?: string }[] = [];

  function ensure(name: string) { return tables[name] ?? (tables[name] = []); }

  function assertColumnKnown(table: string, col: string) {
    const allowed = SCHEMA_AWARE_COLUMNS[table];
    if (allowed && !allowed.has(col)) {
      const err: any = new Error(`column "${col}" does not exist on table "${table}"`);
      err.code = "42703";
      return err;
    }
    return null;
  }

  function from(name: string) {
    const rows = ensure(name);
    let filters: ((r: Row) => boolean)[] = [];
    let filterCols: string[] = [];
    let mode: "select" | "delete" | "update" = "select";
    let patch: Row | null = null;
    let single = false;
    let columnError: any = null;
    let selectedCols: string[] | null = null;

    async function exec(): Promise<{ data: any; error: any }> {
      if (columnError) return { data: null, error: columnError };
      tableCalls.push({ table: name, mode });
      for (const c of filterCols) executedFilters.push({ table: name, op: mode, col: c });
      const injected = errorInjections.find((i) =>
        i.table === name && i.mode === mode && (!i.col || filterCols.includes(i.col))
      );
      if (injected) return { data: null, error: { message: `injected ${mode} error on ${name}`, code: "INJECT" } };

      if (mode === "select") {
        selectCalls.push({ table: name, cols: selectedCols, filters: [...filterCols] });
        opsLog.push({ kind: "db.select", table: name, cols: selectedCols });
      } else if (mode === "delete") {
        opsLog.push({ kind: "db.delete", table: name, filters: [...filterCols] });
      } else if (mode === "update") {
        opsLog.push({ kind: "db.update", table: name, filters: [...filterCols] });
      }

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
      select(cols?: string) {
        const parsed = parseCols(cols);
        selectedCols = parsed;
        if (parsed && SCHEMA_AWARE_COLUMNS[name]) {
          for (const c of parsed) {
            const e = assertColumnKnown(name, c);
            if (e && !columnError) columnError = e;
          }
        }
        return builder;
      },
      delete() { mode = "delete"; return builder; },
      update(p: Row) { mode = "update"; patch = p; return builder; },
      eq(col: string, val: any) {
        filterCols.push(col);
        const e = assertColumnKnown(name, col);
        if (e && !columnError) columnError = e;
        filters.push((r) => r[col] === val);
        return builder;
      },
      in(col: string, vals: any[]) {
        filterCols.push(col);
        const e = assertColumnKnown(name, col);
        if (e && !columnError) columnError = e;
        filters.push((r) => vals.includes(r[col]));
        return builder;
      },
      is(col: string, val: any) {
        filterCols.push(col);
        const e = assertColumnKnown(name, col);
        if (e && !columnError) columnError = e;
        filters.push((r) => (r[col] ?? null) === val);
        return builder;
      },
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

  return {
    from,
    _tables: tables,
    _executedFilters: executedFilters,
    _tableCalls: tableCalls,
    _selectCalls: selectCalls,
    _opsLog: opsLog,
    injectError(spec: { table: string; mode: "delete" | "update" | "select"; col?: string }) {
      errorInjections.push(spec);
    },
  };
}

function makeFakeStripe(
  seed: { customers?: Record<string, any>; subscriptions?: Record<string, any> } = {},
  opsLog: OpEvent[] = [],
) {
  const customers = seed.customers ?? {};
  const subscriptions = seed.subscriptions ?? {};
  let n = 1000;
  const createCalls: any[] = [];
  const cancelCalls: string[] = [];
  const retrieveCalls: string[] = [];
  return {
    _customers: customers,
    _createCalls: createCalls,
    _cancelCalls: cancelCalls,
    _retrieveCalls: retrieveCalls,
    _opsLog: opsLog,
    customers: {
      async create(params: any) {
        const id = `cus_fake_${n++}`;
        customers[id] = { id, ...params, deleted: false };
        createCalls.push(params);
        return customers[id];
      },
      async update(id: string, params: any) { customers[id] = { ...customers[id], ...params }; return customers[id]; },
      async del(id: string) { if (customers[id]) customers[id].deleted = true; return { id, deleted: true }; },
    },
    subscriptions: {
      async retrieve(id: string) {
        retrieveCalls.push(id);
        opsLog.push({ kind: "stripe.retrieve", id });
        const sub = subscriptions[id];
        if (!sub) { const e: any = new Error("No such subscription"); e.code = "resource_missing"; throw e; }
        return sub;
      },
      async cancel(id: string) {
        cancelCalls.push(id);
        opsLog.push({ kind: "stripe.cancel", id });
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
const TEST_CONFIG = { pro_monthly: "price_monthly_test", pro_yearly: "price_yearly_test" };
const OTHER_CONFIG = { pro_monthly: "price_monthly_OTHER", pro_yearly: "price_yearly_OTHER" };

describe("Phase 1B-1 — runtime neutrality", () => {
  it("driver-billing.ts and account-deletion.ts import cleanly with no ambient Deno global present", () => {
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

describe("performAccountDeletion — Phase 1N-F1-A-R1 repaired orchestration", () => {
  function baseDb(overrides: Record<string, Row[]> = {}, opsLog: OpEvent[] = []) {
    return makeFakeDb({
      subscriptions: [], recruiter_billing_profiles: [],
      agency_profiles: [], agency_members: [], agency_entitlements: [],
      agency_work_items: [], agency_client_requests: [], agency_delegation_requests: [],
      driver_assistants: [],
      load_stops: [], expenses: [], fuel_logs: [], loads: [], broker_stats: [], lane_stats: [],
      operating_metrics: [], brokers: [], recurring_expense_templates: [], weekly_snapshots: [],
      feedback_responses: [], parse_usage: [], user_alerts: [], expense_automation_logs: [], ai_insights: [],
      cost_profile: [], parking_favorites: [], parking_reports: [], parking_verifications: [],
      driver_point_events: [], driver_points: [], driver_opportunity_profiles: [], saved_opportunities: [],
      notifications: [], notification_preferences: [],
      user_settings: [], profiles: [],
      // Retention/compliance tables — deliberately untouched.
      agency_audit_log: [{ id: "aal-1", actor_user_id: "user-owner", action: "x" }],
      assistant_audit_log: [{ id: "aat-1", actor_user_id: "user-owner", action: "x" }],
      application_events: [{ id: "ae-1", actor_user_id: "user-owner" }],
      contract_audit_log: [{ id: "cal-1", actor_user_id: "user-owner" }],
      admin_audit_log: [{ id: "aal2-1", actor_user_id: "user-owner" }],
      recruiter_contact_requests: [{ id: "rcr-1", application_id: "app-1" }],
      ...overrides,
    }, opsLog);
  }

  // 1. Agency owner blocked before any billing or data mutation.
  it("hard-blocks (409) when the caller canonically owns an agency and touches no Stripe or table", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({
      agency_profiles: [{ id: "ap-1", owner_user_id: "user-owner", name: "Owner Agency" }],
      subscriptions: [{ user_id: "user-owner", stripe_subscription_id: "sub_would_be_canceled" }],
      cost_profile: [{ user_id: "user-owner", id: "cp-1" }],
      loads: [{ user_id: "user-owner", id: "l-1" }],
    }, opsLog);
    const stripe = makeFakeStripe(
      { subscriptions: { sub_would_be_canceled: { id: "sub_would_be_canceled", status: "active", items: { data: [{ price: DRIVER_PRICE }] } } } },
      opsLog,
    );
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-owner", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.status).toBe(409);
      expect(result.message).toBe(AGENCY_OWNER_BLOCK_MESSAGE);
    }
    expect(stripe._retrieveCalls.length).toBe(0);
    expect(stripe._cancelCalls.length).toBe(0);
    expect(db._tables.subscriptions.length).toBe(1);
    expect(db._tables.cost_profile.length).toBe(1);
    expect(db._tables.loads.length).toBe(1);
    // No mutation events of any kind.
    const mutations = opsLog.filter((e) => e.kind === "db.delete" || e.kind === "db.update" || e.kind === "stripe.cancel" || e.kind === "stripe.retrieve");
    expect(mutations).toEqual([]);
  });

  // 1b. Explicit live-schema regression proof — owner check selects `id`, never `agency_id`.
  it("owner check selects id from agency_profiles filtered by owner_user_id, and never selects agency_id", async () => {
    const db = baseDb({
      agency_profiles: [{ id: "ap-live", owner_user_id: "user-owner-live", name: "X" }],
    });
    const stripe = makeFakeStripe();
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-owner-live", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.status).toBe(409);
    const ownerSelects = db._selectCalls.filter((c: any) => c.table === "agency_profiles");
    expect(ownerSelects.length).toBeGreaterThan(0);
    for (const c of ownerSelects) {
      expect(c.cols).toEqual(["id"]);
      expect(c.filters).toContain("owner_user_id");
      expect(c.cols).not.toContain("agency_id");
    }
    // No production select of agency_id from agency_profiles anywhere.
    const bad = db._selectCalls.filter((c: any) => c.table === "agency_profiles" && (c.cols ?? []).includes("agency_id"));
    expect(bad).toEqual([]);
  });

  // 1c. Regression probe — selecting agency_id from agency_profiles fails with 42703.
  it("harness rejects a select of agency_id from agency_profiles with Postgres error code 42703, proving the original defect can no longer pass", async () => {
    const db = baseDb({ agency_profiles: [{ id: "ap-probe", owner_user_id: "someone" }] });
    const { data, error } = await db.from("agency_profiles").select("agency_id").eq("owner_user_id", "someone");
    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(error.code).toBe("42703");
    expect(String(error.message)).toMatch(/agency_id/);
  });

  // 2. Ownership is determined from agency_profiles, not agency_members.
  it("blocks based on agency_profiles.owner_user_id even when no agency_members owner row exists", async () => {
    const db = baseDb({
      agency_profiles: [{ id: "ap-2", owner_user_id: "user-owner-2", name: "Y" }],
      agency_members: [], // no owner row at all
    });
    const stripe = makeFakeStripe();
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-owner-2", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.status).toBe(409);
    expect(stripe._retrieveCalls.length).toBe(0);
  });

  // 3. Non-owner member: agency billing/profile/entitlement untouched; member row revoked in place.
  it("does not cancel agency billing or delete the agency for a non-owner member; membership row is revoked with member_user_id nulled", async () => {
    const db = baseDb({
      agency_profiles: [{ id: "ap-3", owner_user_id: "someone-else", name: "Z" }],
      agency_members: [
        { id: "am-3", agency_id: "agency-3", member_user_id: "user-m", role: "agency_member", status: "active" },
        { id: "am-x", agency_id: "agency-3", member_user_id: "other-user", role: "agency_member", status: "active" },
      ],
      agency_entitlements: [{ id: "ae-3", agency_id: "agency-3", stripe_subscription_id: "sub_agency_3", status: "active" }],
    });
    const stripe = makeFakeStripe({ subscriptions: { sub_agency_3: { id: "sub_agency_3", status: "active" } } });
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-m", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(true);
    expect(stripe._cancelCalls).not.toContain("sub_agency_3");
    expect(db._tables.agency_profiles.length).toBe(1);
    expect(db._tables.agency_entitlements[0].status).toBe("active");
    expect(db._tables.agency_entitlements[0].stripe_subscription_id).toBe("sub_agency_3");
    const own = db._tables.agency_members.find((r: any) => r.id === "am-3");
    const other = db._tables.agency_members.find((r: any) => r.id === "am-x");
    expect(own.status).toBe("revoked");
    expect(own.revoked_at).toBeTruthy();
    expect(own.member_user_id).toBeNull();
    expect(other.status).toBe("active");
    expect(other.member_user_id).toBe("other-user");
  });

  // 4. Assistant-only cleanup path.
  it("removes assistant_user_id rows for an assistant-only account, leaves unrelated rows, and calls no Stripe cancellation when no billing exists", async () => {
    const db = baseDb({
      driver_assistants: [
        { id: "da-1", driver_user_id: "some-driver", assistant_user_id: "user-a", status: "active" },
        { id: "da-2", driver_user_id: "some-driver", assistant_user_id: "other-assistant", status: "active" },
      ],
    });
    const stripe = makeFakeStripe();
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-a", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(true);
    expect(stripe._cancelCalls.length).toBe(0);
    expect(db._tables.driver_assistants.map((r: any) => r.id)).toEqual(["da-2"]);
  });

  // 5. Driver relationship cleanup by driver_user_id across the four tables.
  it("removes rows keyed by driver_user_id from driver_assistants and all three agency relationship tables; leaves unrelated rows", async () => {
    const db = baseDb({
      driver_assistants: [
        { id: "da-a", driver_user_id: "user-d", assistant_user_id: "asst-1" },
        { id: "da-b", driver_user_id: "other-driver", assistant_user_id: "asst-2" },
      ],
      agency_work_items: [
        { id: "wi-a", driver_user_id: "user-d", assigned_member_user_id: "member-1" },
        { id: "wi-b", driver_user_id: "other-driver", assigned_member_user_id: "member-1" },
      ],
      agency_client_requests: [
        { id: "cr-a", driver_user_id: "user-d", assigned_member_user_id: "member-1" },
        { id: "cr-b", driver_user_id: "other-driver", assigned_member_user_id: "member-1" },
      ],
      agency_delegation_requests: [
        { id: "dr-a", driver_user_id: "user-d", member_user_id: "member-1" },
        { id: "dr-b", driver_user_id: "other-driver", member_user_id: "member-1" },
      ],
    });
    const stripe = makeFakeStripe();
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-d", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(true);
    expect(db._tables.driver_assistants.map((r: any) => r.id)).toEqual(["da-b"]);
    expect(db._tables.agency_work_items.map((r: any) => r.id)).toEqual(["wi-b"]);
    expect(db._tables.agency_client_requests.map((r: any) => r.id)).toEqual(["cr-b"]);
    expect(db._tables.agency_delegation_requests.map((r: any) => r.id)).toEqual(["dr-b"]);
  });

  // 6. Departing agency-member assignment cleanup on shared rows.
  it("nulls assigned_member_user_id on shared work items and client requests without deleting the row; leaves unrelated assignments intact", async () => {
    const db = baseDb({
      agency_profiles: [{ id: "ap-6", owner_user_id: "someone-else", name: "6" }],
      agency_members: [{ id: "am-6", agency_id: "agency-6", member_user_id: "user-mem", role: "agency_member", status: "active" }],
      agency_work_items: [
        { id: "wi-1", driver_user_id: "some-driver", assigned_member_user_id: "user-mem" },
        { id: "wi-2", driver_user_id: "some-driver", assigned_member_user_id: "other-member" },
      ],
      agency_client_requests: [
        { id: "cr-1", driver_user_id: "some-driver", assigned_member_user_id: "user-mem" },
        { id: "cr-2", driver_user_id: "some-driver", assigned_member_user_id: "other-member" },
      ],
      agency_delegation_requests: [
        { id: "dr-1", driver_user_id: "some-driver", member_user_id: "user-mem" },
      ],
    });
    const stripe = makeFakeStripe();
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-mem", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(true);
    const wi1 = db._tables.agency_work_items.find((r: any) => r.id === "wi-1");
    const wi2 = db._tables.agency_work_items.find((r: any) => r.id === "wi-2");
    expect(wi1.assigned_member_user_id).toBeNull();
    expect(wi2.assigned_member_user_id).toBe("other-member");
    const cr1 = db._tables.agency_client_requests.find((r: any) => r.id === "cr-1");
    const cr2 = db._tables.agency_client_requests.find((r: any) => r.id === "cr-2");
    expect(cr1.assigned_member_user_id).toBeNull();
    expect(cr2.assigned_member_user_id).toBe("other-member");
    // delegation request keyed on member_user_id gets deleted.
    expect(db._tables.agency_delegation_requests.length).toBe(0);
  });

  // 7. Dual driver + recruiter billing — unified timeline proves both Stripe cancels
  //    complete before ANY DB update/delete, with no intervening mutation.
  it("cancels both driver and recruiter subscriptions before any local mutation, proven on one shared ordered timeline", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({
      subscriptions: [{ user_id: "user-8", stripe_subscription_id: "sub_driver_8" }],
      recruiter_billing_profiles: [{ user_id: "user-8", stripe_subscription_id: "sub_recruiter_8" }],
      cost_profile: [{ user_id: "user-8", id: "cp-8" }],
    }, opsLog);
    const stripe = makeFakeStripe(
      {
        subscriptions: {
          sub_driver_8: { id: "sub_driver_8", status: "active", items: { data: [{ price: DRIVER_PRICE }] } },
          sub_recruiter_8: { id: "sub_recruiter_8", status: "active", metadata: { billing_context: "recruiter" } },
        },
      },
      opsLog,
    );
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-8", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(true);
    expect(stripe._cancelCalls.sort()).toEqual(["sub_driver_8", "sub_recruiter_8"].sort());

    // Unified ordering assertions on the single shared timeline.
    const cancelIdxs = opsLog
      .map((e, i) => (e.kind === "stripe.cancel" ? i : -1))
      .filter((i) => i >= 0);
    const firstMutationIdx = opsLog.findIndex((e) => e.kind === "db.delete" || e.kind === "db.update");
    expect(cancelIdxs.length).toBe(2);
    expect(firstMutationIdx).toBeGreaterThan(-1);
    const lastCancel = cancelIdxs[cancelIdxs.length - 1];
    // (a) last stripe cancel happens BEFORE first DB mutation.
    expect(lastCancel).toBeLessThan(firstMutationIdx);
    // (b) no DB mutation event occurs at or before the last stripe cancel.
    const mutationsBeforeAllCancels = opsLog
      .slice(0, lastCancel + 1)
      .filter((e) => e.kind === "db.delete" || e.kind === "db.update");
    expect(mutationsBeforeAllCancels).toEqual([]);
    expect(db._tables.cost_profile.length).toBe(0);
  });

  // 8. Stripe failure preserves every local row, including a relationship row.
  it("preserves every local row (including relationship rows) when Stripe cancellation fails", async () => {
    const db = baseDb({
      subscriptions: [{ user_id: "user-11", stripe_subscription_id: "sub_driver_11" }],
      cost_profile: [{ user_id: "user-11", id: "cp-11" }],
      driver_assistants: [{ id: "da-11", driver_user_id: "user-11", assistant_user_id: "asst-11" }],
    });
    const stripe = makeFakeStripe({ subscriptions: { sub_driver_11: { id: "sub_driver_11", status: "active", items: { data: [{ price: DRIVER_PRICE }] } } } });
    stripe.subscriptions.cancel = async () => { throw new Error("Stripe API is down"); };
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-11", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(false);
    expect(db._tables.subscriptions.length).toBe(1);
    expect(db._tables.cost_profile.length).toBe(1);
    expect(db._tables.driver_assistants.length).toBe(1);
  });

  // 9. Schema-aware regression: no relationship table receives a `user_id` filter.
  it("completes without an unknown-column error and executes no user_id filter on the five relationship tables", async () => {
    const db = baseDb({
      subscriptions: [{ user_id: "user-r", stripe_subscription_id: null }],
      driver_assistants: [{ id: "da-r", driver_user_id: "user-r", assistant_user_id: "asst" }],
      agency_work_items: [{ id: "wi-r", driver_user_id: "user-r", assigned_member_user_id: "user-r" }],
      agency_client_requests: [{ id: "cr-r", driver_user_id: "user-r", assigned_member_user_id: "user-r" }],
      agency_delegation_requests: [{ id: "dr-r", driver_user_id: "user-r", member_user_id: "user-r" }],
      agency_members: [{ id: "am-r", agency_id: "agency-r", member_user_id: "user-r", role: "agency_member", status: "active" }],
      agency_profiles: [{ id: "ap-r", owner_user_id: "not-user-r", name: "r" }],
    });
    const stripe = makeFakeStripe();
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-r", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(true);
    const relTables = ["driver_assistants", "agency_work_items", "agency_client_requests", "agency_delegation_requests", "agency_members"];
    const offenders = db._executedFilters.filter((f: any) => relTables.includes(f.table) && f.col === "user_id");
    expect(offenders).toEqual([]);
  });

  // 10. Cleanup error stops subsequent operations.
  it("stops the deletion pipeline and does not execute later direct user_id cleanup when a relationship cleanup errors", async () => {
    const db = baseDb({
      driver_assistants: [{ id: "da-x", driver_user_id: "user-e", assistant_user_id: "asst" }],
      cost_profile: [{ user_id: "user-e", id: "cp-e" }],
      loads: [{ user_id: "user-e", id: "l-e" }],
    });
    db.injectError({ table: "driver_assistants", mode: "delete", col: "driver_user_id" });
    const stripe = makeFakeStripe();
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-e", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.message).toBe(GENERIC_DELETE_ERROR);
    expect(db._tables.cost_profile.length).toBe(1);
    expect(db._tables.loads.length).toBe(1);
    const costProfileDeletes = db._tableCalls.filter((c: any) => c.table === "cost_profile" && c.mode === "delete");
    expect(costProfileDeletes.length).toBe(0);
  });

  // 11. Already-canceled Stripe subscription is idempotent success.
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

  // 12. Unrelated agency/shared/audit records survive.
  it("leaves other agencies, their entitlements, and every audit table untouched for a non-owner deletion", async () => {
    const db = baseDb({
      agency_profiles: [
        { id: "ap-a", owner_user_id: "someone-else", name: "a" },
        { id: "ap-b", owner_user_id: "unrelated-owner", name: "b" },
      ],
      agency_entitlements: [
        { id: "ae-a", agency_id: "agency-a", stripe_subscription_id: "sub_a", status: "active" },
        { id: "ae-b", agency_id: "agency-b", stripe_subscription_id: "sub_b", status: "active" },
      ],
      agency_members: [{ id: "am-a", agency_id: "agency-a", member_user_id: "user-nm", role: "agency_member", status: "active" }],
    });
    const stripe = makeFakeStripe();
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-nm", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(true);
    expect(db._tables.agency_profiles.length).toBe(2);
    expect(db._tables.agency_entitlements.length).toBe(2);
    expect(db._tables.agency_entitlements.every((r: any) => r.status === "active")).toBe(true);
    const auditTables = ["agency_audit_log", "assistant_audit_log", "application_events", "contract_audit_log", "admin_audit_log"];
    const auditCalls = db._tableCalls.filter((c: any) => auditTables.includes(c.table) && (c.mode === "delete" || c.mode === "update"));
    expect(auditCalls).toEqual([]);
    const rcrMutations = db._tableCalls.filter((c: any) => c.table === "recruiter_contact_requests" && (c.mode === "delete" || c.mode === "update"));
    expect(rcrMutations).toEqual([]);
    expect(db._tables.recruiter_contact_requests.length).toBe(1);
  });

  // 13. Direct user_id cleanup — caller rows removed across original + representative tables; unrelated rows survive.
  it("deletes the caller's direct-owned rows across original + representative operational/account tables and leaves other users' rows intact", async () => {
    const db = baseDb({
      // Original direct list
      cost_profile: [
        { user_id: "user-dc", id: "cp-1" },
        { user_id: "other", id: "cp-2" },
      ],
      parking_favorites: [
        { user_id: "user-dc", id: "pf-1" },
        { user_id: "other", id: "pf-2" },
      ],
      parking_reports: [{ user_id: "user-dc", id: "pr-1" }, { user_id: "other", id: "pr-2" }],
      parking_verifications: [{ user_id: "user-dc", id: "pv-1" }, { user_id: "other", id: "pv-2" }],
      driver_points: [{ user_id: "user-dc", id: "dp-1" }, { user_id: "other", id: "dp-2" }],
      driver_point_events: [{ user_id: "user-dc", id: "dpe-1" }, { user_id: "other", id: "dpe-2" }],
      // Representative operational/account tables from the new direct list
      loads: [{ user_id: "user-dc", id: "l-1" }, { user_id: "other", id: "l-2" }],
      expenses: [{ user_id: "user-dc", id: "e-1" }, { user_id: "other", id: "e-2" }],
      subscriptions: [{ user_id: "user-dc", stripe_subscription_id: null, id: "s-1" }],
      recruiter_billing_profiles: [{ user_id: "user-dc", stripe_subscription_id: null, id: "rb-1" }],
      user_settings: [{ user_id: "user-dc", id: "us-1" }, { user_id: "other", id: "us-2" }],
      profiles: [{ user_id: "user-dc", id: "prof-1" }, { user_id: "other", id: "prof-2" }],
    });
    const stripe = makeFakeStripe();
    const result = await performAccountDeletion({ adminClient: db, stripe: stripe as any, userId: "user-dc", driverPriceConfig: TEST_CONFIG });
    expect(result.ok).toBe(true);

    // Caller rows fully removed.
    for (const t of [
      "cost_profile", "parking_favorites", "parking_reports", "parking_verifications",
      "driver_points", "driver_point_events", "loads", "expenses",
      "subscriptions", "recruiter_billing_profiles", "user_settings", "profiles",
    ]) {
      const owned = db._tables[t].filter((r: any) => r.user_id === "user-dc");
      expect(owned.length).toBe(0);
    }
    // Unrelated rows intact.
    for (const t of ["cost_profile", "parking_favorites", "parking_reports", "parking_verifications",
      "driver_points", "driver_point_events", "loads", "expenses", "user_settings", "profiles"]) {
      const others = db._tables[t].filter((r: any) => r.user_id === "other");
      expect(others.length).toBe(1);
    }
  });

  // Retain original driver context-mismatch proof.
  it("stops deletion when a driver subscription's billing_context does not match", async () => {
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

  // Retain original driver-price config threading proof.
  it("rejects a driver subscription whose price is only valid under a different config than the one passed in", async () => {
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
