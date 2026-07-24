import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  type DeletionDeps,
} from "../../supabase/functions/_shared/account-deletion";

type Row = Record<string, any>;

// Phase 1N-F1-E — schema-aware column set. In F1-A/R1 this proved that
// direct .delete()/.update() on relationship tables never referenced
// user_id. In F1-E performAccountDeletion no longer performs ANY table
// cleanup — cleanup runs inside a single authenticated RPC. The schema
// map is retained so that (a) leftover legitimate reads against
// agency_profiles remain fidelity-checked, and (b) any regression that
// re-adds sequential TypeScript cleanup is caught by the fake immediately.
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
  | { kind: "stripe.cancel"; id: string }
  | { kind: "cleanup.rpc"; name: string; args: unknown };

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

// Phase 1N-F1-E — fake authenticated cleanup client. Records every RPC
// call on the SHARED ordered timeline used by Stripe/admin DB events, so
// tests can prove the RPC occurs strictly after the last Stripe cancel.
// Returns a valid single-row response for the requested user by default.
// If invoked more than once in a single deletion attempt (which the
// production code must not do), all calls are still recorded so tests
// can assert count === 1.
type CleanupRpcOutcome =
  | { kind: "success"; data: any[] | null }
  | { kind: "error"; error: any };

function makeFakeCleanupClient(userId: string, opsLog: OpEvent[], outcome?: CleanupRpcOutcome) {
  const calls: { name: string; args: unknown }[] = [];
  const defaultOk = (u: string, counters?: Partial<Record<string, number>>) => ([{
    deleted_user_id: u,
    relationship_rows_deleted: counters?.relationship_rows_deleted ?? 0,
    shared_assignments_cleared: counters?.shared_assignments_cleared ?? 0,
    agency_memberships_revoked: counters?.agency_memberships_revoked ?? 0,
    direct_rows_deleted: counters?.direct_rows_deleted ?? 0,
  }]);
  return {
    _calls: calls,
    async rpc(name: string, args?: Record<string, never>) {
      const argsSnapshot = args === undefined ? undefined : { ...args };
      calls.push({ name, args: argsSnapshot });
      opsLog.push({ kind: "cleanup.rpc", name, args: argsSnapshot });
      if (outcome?.kind === "error") return { data: null, error: outcome.error };
      if (outcome?.kind === "success") return { data: outcome.data, error: null };
      return { data: defaultOk(userId), error: null };
    },
  };
}

function buildDeps(overrides: Partial<DeletionDeps> & Pick<DeletionDeps, "adminClient" | "stripe" | "userId">): DeletionDeps {
  const opsLog: OpEvent[] = (overrides.adminClient as any)?._opsLog ?? [];
  const cleanupClient = overrides.cleanupClient ?? makeFakeCleanupClient(overrides.userId, opsLog);
  return {
    adminClient: overrides.adminClient,
    stripe: overrides.stripe,
    cleanupClient,
    userId: overrides.userId,
    driverPriceConfig: overrides.driverPriceConfig ?? TEST_CONFIG,
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

describe("performAccountDeletion — Phase 1N-F1-E: authenticated transactional cleanup RPC", () => {
  function baseDb(overrides: Record<string, Row[]> = {}, opsLog: OpEvent[] = []) {
    return makeFakeDb({
      subscriptions: [], recruiter_billing_profiles: [], agency_profiles: [],
      ...overrides,
    }, opsLog);
  }

  // 1. Agency owner blocked before everything — zero Stripe, zero RPC.
  it("hard-blocks (409) when the caller canonically owns an agency and touches no Stripe or cleanup RPC", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({
      agency_profiles: [{ id: "ap-1", owner_user_id: "user-owner", name: "Owner Agency" }],
      subscriptions: [{ user_id: "user-owner", stripe_subscription_id: "sub_would_be_canceled" }],
    }, opsLog);
    const stripe = makeFakeStripe(
      { subscriptions: { sub_would_be_canceled: { id: "sub_would_be_canceled", status: "active", items: { data: [{ price: DRIVER_PRICE }] } } } },
      opsLog,
    );
    const cleanup = makeFakeCleanupClient("user-owner", opsLog);
    const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-owner" }));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.status).toBe(409);
      expect(result.message).toBe(AGENCY_OWNER_BLOCK_MESSAGE);
    }
    expect(stripe._retrieveCalls.length).toBe(0);
    expect(stripe._cancelCalls.length).toBe(0);
    expect(cleanup._calls.length).toBe(0);
    const mutations = opsLog.filter((e) => e.kind === "cleanup.rpc" || e.kind === "stripe.cancel" || e.kind === "stripe.retrieve" || e.kind === "db.delete" || e.kind === "db.update");
    expect(mutations).toEqual([]);
  });

  // 2. Owner discovery is canonical via agency_profiles.owner_user_id.
  it("blocks based on agency_profiles.owner_user_id even without any agency_members owner row", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({
      agency_profiles: [{ id: "ap-2", owner_user_id: "user-owner-2", name: "Y" }],
    }, opsLog);
    const stripe = makeFakeStripe({}, opsLog);
    const cleanup = makeFakeCleanupClient("user-owner-2", opsLog);
    const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-owner-2" }));
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.status).toBe(409);
    expect(stripe._retrieveCalls.length).toBe(0);
    expect(cleanup._calls.length).toBe(0);
    // Owner check selects `id` only, never `agency_id`.
    const ownerSelects = db._selectCalls.filter((c: any) => c.table === "agency_profiles");
    expect(ownerSelects.length).toBeGreaterThan(0);
    for (const c of ownerSelects) {
      expect(c.cols).toEqual(["id"]);
      expect(c.filters).toContain("owner_user_id");
    }
  });

  // 3. No billing — no Stripe calls, exactly one RPC with name+empty args.
  it("with no billing contexts, calls no Stripe methods and invokes cleanup RPC exactly once with exact name and empty args", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({}, opsLog);
    const stripe = makeFakeStripe({}, opsLog);
    const cleanup = makeFakeCleanupClient("user-nobill", opsLog);
    const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-nobill" }));
    expect(result.ok).toBe(true);
    expect(stripe._retrieveCalls.length).toBe(0);
    expect(stripe._cancelCalls.length).toBe(0);
    expect(cleanup._calls.length).toBe(1);
    expect(cleanup._calls[0].name).toBe("finalize_my_account_data_deletion");
    expect(cleanup._calls[0].args).toEqual({});
  });

  // 4. Dual driver + recruiter — RPC strictly after last cancel.
  it("cancels both driver and recruiter subscriptions and invokes cleanup RPC strictly after the last Stripe cancel, exactly once", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({
      subscriptions: [{ user_id: "user-8", stripe_subscription_id: "sub_driver_8" }],
      recruiter_billing_profiles: [{ user_id: "user-8", stripe_subscription_id: "sub_recruiter_8" }],
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
    const cleanup = makeFakeCleanupClient("user-8", opsLog);
    const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-8" }));
    expect(result.ok).toBe(true);
    expect(stripe._cancelCalls.sort()).toEqual(["sub_driver_8", "sub_recruiter_8"].sort());
    expect(cleanup._calls.length).toBe(1);

    const cancelIdxs = opsLog.map((e, i) => (e.kind === "stripe.cancel" ? i : -1)).filter((i) => i >= 0);
    const rpcIdxs = opsLog.map((e, i) => (e.kind === "cleanup.rpc" ? i : -1)).filter((i) => i >= 0);
    expect(cancelIdxs.length).toBe(2);
    expect(rpcIdxs.length).toBe(1);
    const lastCancel = cancelIdxs[cancelIdxs.length - 1];
    // (a) RPC event occurs AFTER last cancel
    expect(rpcIdxs[0]).toBeGreaterThan(lastCancel);
    // (b) no RPC event occurs before all cancellations finish
    const rpcBeforeLastCancel = opsLog.slice(0, lastCancel + 1).filter((e) => e.kind === "cleanup.rpc");
    expect(rpcBeforeLastCancel).toEqual([]);
  });

  // 5. Stripe failure prevents RPC.
  it("Stripe non-idempotent cancellation failure prevents the cleanup RPC from being invoked", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({
      subscriptions: [{ user_id: "user-11", stripe_subscription_id: "sub_driver_11" }],
    }, opsLog);
    const stripe = makeFakeStripe({ subscriptions: { sub_driver_11: { id: "sub_driver_11", status: "active", items: { data: [{ price: DRIVER_PRICE }] } } } }, opsLog);
    stripe.subscriptions.cancel = async () => { throw new Error("Stripe API is down"); };
    const cleanup = makeFakeCleanupClient("user-11", opsLog);
    const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-11" }));
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.message).toBe(GENERIC_DELETE_ERROR);
    expect(cleanup._calls.length).toBe(0);
  });

  // 5b. Stripe retrieve failure also prevents RPC.
  it("Stripe retrieve failure prevents the cleanup RPC from being invoked", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({
      subscriptions: [{ user_id: "user-11r", stripe_subscription_id: "sub_missing_r" }],
    }, opsLog);
    const stripe = makeFakeStripe({}, opsLog); // sub_missing_r intentionally not seeded
    const cleanup = makeFakeCleanupClient("user-11r", opsLog);
    const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-11r" }));
    expect(result.ok).toBe(false);
    expect(cleanup._calls.length).toBe(0);
  });

  // 5c. Stripe context mismatch prevents RPC.
  it("Stripe context mismatch prevents the cleanup RPC from being invoked", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({
      subscriptions: [{ user_id: "user-11c", stripe_subscription_id: "sub_mismatch_c" }],
    }, opsLog);
    const stripe = makeFakeStripe({ subscriptions: { sub_mismatch_c: { id: "sub_mismatch_c", status: "active", metadata: { billing_context: "recruiter" } } } }, opsLog);
    const cleanup = makeFakeCleanupClient("user-11c", opsLog);
    const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-11c" }));
    expect(result.ok).toBe(false);
    expect(stripe._cancelCalls).not.toContain("sub_mismatch_c");
    expect(cleanup._calls.length).toBe(0);
  });

  // 6. Terminal / already-canceled — no re-cancel, RPC still runs.
  it("treats an already-canceled Stripe subscription as idempotent success and still invokes cleanup RPC exactly once", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({
      subscriptions: [{ user_id: "user-12", stripe_subscription_id: "sub_driver_12" }],
    }, opsLog);
    const stripe = makeFakeStripe({ subscriptions: { sub_driver_12: { id: "sub_driver_12", status: "canceled", items: { data: [{ price: DRIVER_PRICE }] } } } }, opsLog);
    const cleanup = makeFakeCleanupClient("user-12", opsLog);
    const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-12" }));
    expect(result.ok).toBe(true);
    expect(stripe._cancelCalls).not.toContain("sub_driver_12");
    expect(cleanup._calls.length).toBe(1);
  });

  // 7. Resource-missing cancellation retry proceeds to RPC.
  it("treats a resource_missing cancel error as idempotent and proceeds to the cleanup RPC exactly once", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({
      subscriptions: [{ user_id: "user-rm", stripe_subscription_id: "sub_rm" }],
    }, opsLog);
    const stripe = makeFakeStripe({ subscriptions: { sub_rm: { id: "sub_rm", status: "active", items: { data: [{ price: DRIVER_PRICE }] } } } }, opsLog);
    stripe.subscriptions.cancel = async () => { const e: any = new Error("No such subscription: sub_rm"); e.code = "resource_missing"; throw e; };
    const cleanup = makeFakeCleanupClient("user-rm", opsLog);
    const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-rm" }));
    expect(result.ok).toBe(true);
    expect(cleanup._calls.length).toBe(1);
  });

  // 8. RPC caller identity safety — exact name, exact empty args, no identity args.
  it("invokes the cleanup RPC with exact name and empty args, never passing user_id / id / target / role", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({}, opsLog);
    const stripe = makeFakeStripe({}, opsLog);
    const cleanup = makeFakeCleanupClient("user-safety", opsLog);
    const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-safety" }));
    expect(result.ok).toBe(true);
    expect(cleanup._calls.length).toBe(1);
    expect(cleanup._calls[0].name).toBe("finalize_my_account_data_deletion");
    const args = cleanup._calls[0].args as Record<string, unknown>;
    expect(args).toEqual({});
    for (const forbidden of ["user_id", "id", "target", "target_user_id", "role", "context", "p_user_id"]) {
      expect(Object.prototype.hasOwnProperty.call(args, forbidden)).toBe(false);
    }
  });

  // 9. RPC generic failure — 500, no retry.
  it("returns generic 500 on an RPC generic failure and never re-invokes the RPC", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({}, opsLog);
    const stripe = makeFakeStripe({}, opsLog);
    const rpcError = { code: "XX000", message: "internal database error" };
    const cleanup = makeFakeCleanupClient("user-rpcerr", opsLog, { kind: "error", error: rpcError });
    const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-rpcerr" }));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.status).toBe(500);
      expect(result.message).toBe(GENERIC_DELETE_ERROR);
    }
    expect(cleanup._calls.length).toBe(1);
  });

  // 10. RPC owner-race — P0001 + exact owner block message → 409 owner message.
  it("maps a P0001 owner-race RPC error carrying the exact owner block message to 409 with AGENCY_OWNER_BLOCK_MESSAGE, invoked exactly once", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({}, opsLog);
    const stripe = makeFakeStripe({}, opsLog);
    const rpcError = { code: "P0001", message: `raise: ${AGENCY_OWNER_BLOCK_MESSAGE}` };
    const cleanup = makeFakeCleanupClient("user-race", opsLog, { kind: "error", error: rpcError });
    const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-race" }));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.status).toBe(409);
      expect(result.message).toBe(AGENCY_OWNER_BLOCK_MESSAGE);
    }
    expect(cleanup._calls.length).toBe(1);
  });

  // 10b. P0001 without owner message stays generic 500.
  it("does not map an unrelated P0001 error to the agency-owner block message", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({}, opsLog);
    const stripe = makeFakeStripe({}, opsLog);
    const cleanup = makeFakeCleanupClient("user-p0001", opsLog, { kind: "error", error: { code: "P0001", message: "some other assertion failed" } });
    const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-p0001" }));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.status).toBe(500);
      expect(result.message).toBe(GENERIC_DELETE_ERROR);
    }
  });

  // 11. Malformed success rejection — parametric.
  const malformedCases: { label: string; data: any }[] = [
    { label: "null data", data: null },
    { label: "non-array data", data: { deleted_user_id: "user-m" } },
    { label: "empty array", data: [] },
    { label: "multiple rows", data: [
      { deleted_user_id: "user-m", relationship_rows_deleted: 0, shared_assignments_cleared: 0, agency_memberships_revoked: 0, direct_rows_deleted: 0 },
      { deleted_user_id: "user-m", relationship_rows_deleted: 0, shared_assignments_cleared: 0, agency_memberships_revoked: 0, direct_rows_deleted: 0 },
    ] },
    { label: "wrong deleted_user_id", data: [
      { deleted_user_id: "other-user", relationship_rows_deleted: 0, shared_assignments_cleared: 0, agency_memberships_revoked: 0, direct_rows_deleted: 0 },
    ] },
    { label: "missing counter", data: [
      { deleted_user_id: "user-m", relationship_rows_deleted: 0, shared_assignments_cleared: 0, agency_memberships_revoked: 0 /* direct_rows_deleted missing */ },
    ] },
    { label: "non-integer counter", data: [
      { deleted_user_id: "user-m", relationship_rows_deleted: 1.5, shared_assignments_cleared: 0, agency_memberships_revoked: 0, direct_rows_deleted: 0 },
    ] },
    { label: "negative counter", data: [
      { deleted_user_id: "user-m", relationship_rows_deleted: 0, shared_assignments_cleared: -1, agency_memberships_revoked: 0, direct_rows_deleted: 0 },
    ] },
    { label: "non-numeric counter", data: [
      { deleted_user_id: "user-m", relationship_rows_deleted: "0", shared_assignments_cleared: 0, agency_memberships_revoked: 0, direct_rows_deleted: 0 },
    ] },
    { label: "null row inside array", data: [null] },
  ];
  for (const { label, data } of malformedCases) {
    it(`returns generic 500 for malformed success shape: ${label}`, async () => {
      const opsLog: OpEvent[] = [];
      const db = baseDb({}, opsLog);
      const stripe = makeFakeStripe({}, opsLog);
      const cleanup = makeFakeCleanupClient("user-m", opsLog, { kind: "success", data });
      const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-m" }));
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.status).toBe(500);
        expect(result.message).toBe(GENERIC_DELETE_ERROR);
      }
      // RPC still called exactly once — never retried.
      expect(cleanup._calls.length).toBe(1);
    });
  }

  // 12. Valid nonzero response returns ok true.
  it("accepts a valid single-row response with nonzero counters and returns ok:true without rewriting the profile shape", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({}, opsLog);
    const stripe = makeFakeStripe({}, opsLog);
    const data = [{
      deleted_user_id: "user-nz",
      relationship_rows_deleted: 7,
      shared_assignments_cleared: 3,
      agency_memberships_revoked: 1,
      direct_rows_deleted: 42,
    }];
    const cleanup = makeFakeCleanupClient("user-nz", opsLog, { kind: "success", data });
    const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-nz" }));
    expect(result.ok).toBe(true);
    // External result shape unchanged — just { ok:true }.
    expect(result).toEqual({ ok: true });
    expect(cleanup._calls.length).toBe(1);
  });

  // 13. No sequential cleanup regression — source proof + runtime proof.
  it("shared account-deletion.ts contains no direct .delete()/.update() cleanup pipeline and no DIRECT_USER_ID_TABLES_IN_ORDER", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/account-deletion.ts"), "utf8");
    expect(src).not.toMatch(/DIRECT_USER_ID_TABLES_IN_ORDER/);
    // No `.from("<table>").delete()` or `.from("<table>").update(` cleanup pipeline anywhere.
    expect(src).not.toMatch(/\.from\([^)]+\)\s*\.\s*delete\(/);
    expect(src).not.toMatch(/\.from\([^)]+\)\s*\.\s*update\(/);
    // Exactly one cleanup RPC call.
    const matches = src.match(/finalize_my_account_data_deletion/g) ?? [];
    // The identifier may appear in a constant declaration and in a comment; the
    // rpc(...) call must reference the constant CLEANUP_RPC_NAME exactly once.
    const rpcCallCount = (src.match(/cleanupClient\.rpc\(\s*CLEANUP_RPC_NAME\s*,\s*\{\s*\}\s*\)/g) ?? []).length;
    expect(rpcCallCount).toBe(1);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("during a successful deletion, adminClient DB operations are reads only and cleanup occurs via exactly one RPC event", async () => {
    const opsLog: OpEvent[] = [];
    const db = baseDb({
      subscriptions: [{ user_id: "user-runtime", stripe_subscription_id: null }],
      recruiter_billing_profiles: [{ user_id: "user-runtime", stripe_subscription_id: null }],
    }, opsLog);
    const stripe = makeFakeStripe({}, opsLog);
    const cleanup = makeFakeCleanupClient("user-runtime", opsLog);
    const result = await performAccountDeletion(buildDeps({ adminClient: db, stripe: stripe as any, cleanupClient: cleanup, userId: "user-runtime" }));
    expect(result.ok).toBe(true);
    const dbMutations = opsLog.filter((e) => e.kind === "db.delete" || e.kind === "db.update");
    expect(dbMutations).toEqual([]);
    const rpcEvents = opsLog.filter((e) => e.kind === "cleanup.rpc");
    expect(rpcEvents.length).toBe(1);
  });

  // 14. Adapter wiring/source proof.
  it("delete-account edge adapter passes cleanupClient: userClient (never adminClient) and calls performAccountDeletion before auth.admin.deleteUser exactly once", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/delete-account/index.ts"), "utf8");
    expect(src).toMatch(/cleanupClient:\s*userClient/);
    expect(src).not.toMatch(/cleanupClient:\s*adminClient/);
    const performIdx = src.indexOf("performAccountDeletion");
    const authDeleteIdx = src.indexOf("auth.admin.deleteUser");
    expect(performIdx).toBeGreaterThan(-1);
    expect(authDeleteIdx).toBeGreaterThan(-1);
    expect(performIdx).toBeLessThan(authDeleteIdx);
    // No direct RPC call to finalize_my_account_data_deletion from the adapter.
    expect(src).not.toMatch(/finalize_my_account_data_deletion/);
    // auth.admin.deleteUser CALL occurs exactly once (excludes console.error log-string references).
    const deleteUserMatches = src.match(/auth\.admin\.deleteUser\(/g) ?? [];
    expect(deleteUserMatches.length).toBe(1);
  });

  // 15. Shared module runtime neutrality — no Deno/URL/npm: imports.
  it("shared account-deletion.ts remains runtime-neutral (no Deno.env, no https://, no npm: imports)", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/account-deletion.ts"), "utf8");
    expect(src).not.toMatch(/Deno\.env\.get\(/);
    expect(src).not.toMatch(/Deno\.serve\(/);
    expect(src).not.toMatch(/from\s+["']https:\/\//);
    expect(src).not.toMatch(/from\s+["']npm:/);
  });
});
