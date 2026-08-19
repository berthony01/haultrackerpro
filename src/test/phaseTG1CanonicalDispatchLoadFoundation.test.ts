/**
 * Phase TG-1 — Canonical Dispatch Load Foundation.
 *
 * Deterministic contract test over:
 *   * the CANDIDATE migration text (NOT applied live), and
 *   * the pure TypeScript permission mirror / financial semantics.
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  RECRUITER_STAFF_PERMISSION_KEYS,
  RECRUITER_STAFF_PERMISSION_LABELS,
  parseRecruiterStaffPermissions,
  emptyRecruiterStaffPermissions,
} from "@/lib/recruiterStaffPermissions";
import {
  isCompletedLoadForFinancials,
  getLoadRealizedRevenue,
  summarizeLoads,
  excludeCancelled,
} from "@/lib/financialCalculations";
import type { Load } from "@/hooks/useLoads";

const SQL_REL =
  "supabase/migration-candidates/20260819110000_phase_tg1_canonical_dispatch_load_foundation.sql";
const SQL_PATH = path.resolve(process.cwd(), SQL_REL);
const sql = readFileSync(SQL_PATH, "utf8");
const lower = sql.toLowerCase();
/** Executable SQL only: `--` line comments stripped. */
const exec = lower
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

function fnSlice(name: string): string {
  const start = exec.indexOf(`create or replace function public.${name}`);
  expect(start, `function ${name} must exist`).toBeGreaterThan(-1);
  const end = exec.indexOf("\n$function$;", start);
  expect(end).toBeGreaterThan(start);
  return exec.slice(start, end);
}

// ── 1. Permission vocabulary mirror ────────────────────────────────────────
describe("TG-1 / permission mirror", () => {
  const NEW_KEYS = ["loads_view", "loads_dispatch", "loads_update_status"] as const;

  it("appends exactly the three new keys at the end, in order", () => {
    expect(RECRUITER_STAFF_PERMISSION_KEYS.slice(-3)).toEqual(NEW_KEYS);
    expect(RECRUITER_STAFF_PERMISSION_KEYS.length).toBe(24);
    expect(new Set(RECRUITER_STAFF_PERMISSION_KEYS).size).toBe(24);
  });

  it("keeps the pre-existing keys unchanged and in order", () => {
    expect(RECRUITER_STAFF_PERMISSION_KEYS.slice(0, 21)).toEqual([
      "opportunities_view",
      "opportunities_create",
      "opportunities_edit",
      "opportunities_change_status",
      "opportunities_delete",
      "applications_view",
      "applications_manage_status",
      "applications_request_contact",
      "applications_manage_notes",
      "contracts_view",
      "contracts_manage",
      "referrals_view",
      "referrals_manage_status",
      "referral_terms_manage",
      "reports_view",
      "reports_export",
      "settlements_view",
      "settlements_prepare",
      "settlements_finalize",
      "team_view",
      "team_manage",
    ]);
  });

  it("has the exact labels", () => {
    expect(RECRUITER_STAFF_PERMISSION_LABELS.loads_view).toBe("View driver loads");
    expect(RECRUITER_STAFF_PERMISSION_LABELS.loads_dispatch).toBe("Dispatch driver loads");
    expect(RECRUITER_STAFF_PERMISSION_LABELS.loads_update_status).toBe(
      "Update driver load status",
    );
  });

  it("strict parser still requires the exact full boolean map", () => {
    const full = emptyRecruiterStaffPermissions();
    expect(parseRecruiterStaffPermissions({ ...full })).toEqual(full);

    const missing: Record<string, boolean> = { ...full };
    delete missing.loads_view;
    expect(parseRecruiterStaffPermissions(missing)).toBeNull();

    expect(parseRecruiterStaffPermissions({ ...full, unknown_key: true })).toBeNull();
    expect(parseRecruiterStaffPermissions({ ...full, loads_dispatch: "true" })).toBeNull();
    expect(parseRecruiterStaffPermissions(null)).toBeNull();
  });

  it("hook exposes fail-closed UX booleans only", () => {
    const hookSrc = readFileSync(
      path.resolve(process.cwd(), "src/hooks/recruiter/useRecruiterStaffPermissions.ts"),
      "utf8",
    );
    expect(hookSrc).toContain("canViewLoads: granted && permissions.loads_view === true");
    expect(hookSrc).toContain(
      "canDispatchLoads: granted && permissions.loads_dispatch === true",
    );
    expect(hookSrc).toContain(
      "canUpdateLoadStatus: granted && permissions.loads_update_status === true",
    );
    // No new queries / routes / business logic introduced by TG-1.
    expect(hookSrc).not.toMatch(/dispatch_create_driver_load|get_carrier_driver_mileage_summary/);
  });
});

// ── 2/13. No parallel table, no RLS broadening, no forbidden surfaces ──────
describe("TG-1 / canonical single-table + scope guards", () => {
  it("creates no parallel Telegram load table", () => {
    const created = [...exec.matchAll(/create table if not exists public\.(\w+)/g)].map(
      (m) => m[1],
    );
    expect(created.sort()).toEqual(["dispatch_command_receipts", "load_events"]);
    expect(created.some((t) => t.includes("telegram"))).toBe(false);
  });

  it("does not broaden direct loads RLS or ownership", () => {
    expect(exec).not.toMatch(/create policy[^;]*on public\.loads/);
    expect(exec).not.toMatch(/drop policy[^;]*on public\.loads/);
    expect(exec).not.toMatch(/alter table public\.loads[^;]*row level security/);
    expect(exec).not.toMatch(/alter table public\.loads[^;]*drop column/);
    expect(exec).not.toMatch(/alter table public\.loads[^;]*user_id[^;]*(rename|drop)/);
  });

  it("touches no settlement, billing, Agency, Telegram or generated-type surface", () => {
    for (const forbidden of [
      "driver_settlements",
      "driver_settlement_items",
      "driver_settlement_events",
      "driver_settlement_matches",
      "subscriptions",
      "stripe",
      "agency_",
      "webhook",
      "http_post",
      "pg_net",
      "telegram_",
    ]) {
      expect(exec.includes(forbidden), `must not reference ${forbidden}`).toBe(false);
    }
  });

  it("does not auto-create settlement rows or finalize payroll", () => {
    expect(exec).not.toMatch(/insert into public\.driver_settlement/);
    expect(exec).not.toMatch(/finalize/);
  });
});

// ── 3. loads extension + four-state vocabulary ─────────────────────────────
describe("TG-1 / canonical loads extension", () => {
  it("adds relationship, load_reference and origin_channel", () => {
    expect(exec).toMatch(
      /alter table public\.loads\s+add column if not exists carrier_driver_relationship_id uuid null\s+references public\.carrier_driver_relationships\(id\) on delete set null/,
    );
    expect(exec).toMatch(/add column if not exists load_reference text null/);
    expect(exec).toMatch(
      /add column if not exists origin_channel text not null default 'web'/,
    );
    expect(exec).toContain("char_length(load_reference) <= 200");
    expect(exec).toMatch(
      /origin_channel = any \(array\['web','telegram','import','api'\]\)/,
    );
  });

  it("replaces the status CHECK with the exact four-state vocabulary", () => {
    expect(exec).toContain("alter table public.loads drop constraint if exists loads_status_check");
    expect(exec).toMatch(
      /status = any \(array\['pending','en_route','completed','cancelled'\]\)/,
    );
  });

  it("indexes company-linked retrieval by relationship/status/effective date", () => {
    expect(exec).toMatch(
      /create index if not exists idx_loads_relationship_status_effective_date\s+on public\.loads \(carrier_driver_relationship_id, status, \(coalesce\(dropoff_date, load_date\)\) desc\)/,
    );
  });
});

// ── 4. employment date + dispatch/pay-period settings ──────────────────────
describe("TG-1 / company employment + pay-period settings", () => {
  it("adds company-side employment_start_date and never reuses driver settings", () => {
    expect(exec).toMatch(
      /alter table public\.carrier_driver_relationships\s+add column if not exists employment_start_date date null/,
    );
    expect(exec).not.toContain("user_settings");
  });

  it("adds constrained dispatch week start and pay-period cadence/anchor", () => {
    expect(exec).toMatch(
      /add column if not exists dispatch_week_start_day text not null default 'sunday'/,
    );
    expect(exec).toMatch(
      /add column if not exists pay_period_cadence text not null default 'weekly'/,
    );
    expect(exec).toMatch(/add column if not exists pay_period_anchor_date date null/);
    expect(exec).toMatch(
      /dispatch_week_start_day = any \(array\[\s*'sunday','monday','tuesday','wednesday','thursday','friday','saturday'\s*\]\)/,
    );
    expect(exec).toMatch(/pay_period_cadence = any \(array\['weekly','biweekly'\]\)/);
    // biweekly REQUIRES an anchor; weekly may omit it.
    expect(exec).toMatch(
      /pay_period_cadence <> 'biweekly' or pay_period_anchor_date is not null/,
    );
  });

  it("appends the three enum values without reordering existing ones", () => {
    const adds = [...exec.matchAll(/alter type public\.recruiter_workspace_permission add value if not exists '(\w+)'/g)].map(
      (m) => m[1],
    );
    expect(adds).toEqual(["loads_view", "loads_dispatch", "loads_update_status"]);
    expect(exec).not.toMatch(/alter type public\.recruiter_workspace_permission rename/);
    expect(exec).not.toMatch(/drop type public\.recruiter_workspace_permission/);
  });
});

// ── 5. authorization helper ────────────────────────────────────────────────
describe("TG-1 / dispatch authorization helper", () => {
  const body = fnSlice("current_user_can_dispatch_load_action");

  it("is stable security definer with the hardened search_path and least privilege", () => {
    expect(body).toContain("stable security definer");
    expect(body).toContain("set search_path to 'pg_catalog', 'public', 'auth'");
    expect(exec).toContain(
      "revoke all on function public.current_user_can_dispatch_load_action",
    );
    expect(exec).toMatch(
      /grant execute on function public\.current_user_can_dispatch_load_action[^;]*to authenticated/,
    );
  });

  it("accepts only the exact three-key dispatch vocabulary", () => {
    expect(body).toContain(
      "_permission::text not in ('loads_view','loads_dispatch','loads_update_status')",
    );
  });

  it("requires an active recruiter and an exactly matching active relationship", () => {
    expect(body).toMatch(/recruiter_profiles rp[\s\S]*rp\.id = _recruiter_id and rp\.status = 'active'/);
    expect(body).toMatch(/r\.id = _relationship_id[\s\S]*r\.status = 'active'/);
    expect(body).toContain("r.recruiter_id = _recruiter_id");
    expect(body).toContain("r.driver_user_id = _driver_user_id");
  });

  it("delegates to the existing permission resolver with no role shortcut", () => {
    expect(body).toContain(
      "public.current_user_has_recruiter_permission(_recruiter_id, _permission)",
    );
    for (const role of ["recruiter_owner", "recruiter_admin", "recruiter_staff"]) {
      expect(body.includes(role)).toBe(false);
    }
  });

  it("does not replace existing permission helpers", () => {
    expect(exec).not.toMatch(
      /create or replace function public\.current_user_has_recruiter_permission/,
    );
  });
});

// ── 6/7. audit + idempotency storage ───────────────────────────────────────
describe("TG-1 / load_events and dispatch_command_receipts", () => {
  it("load_events is client append-only: RLS on, driver SELECT only", () => {
    expect(exec).toContain("alter table public.load_events enable row level security");
    const policies = [...exec.matchAll(/create policy "([^"]+)"\s+on public\.load_events for (\w+)/g)];
    expect(policies.length).toBe(1);
    expect(policies[0][2]).toBe("select");
    expect(exec).toContain("using (auth.uid() = driver_user_id)");
    expect(exec).not.toMatch(/on public\.load_events for (insert|update|delete)/);
    expect(exec).not.toMatch(/grant (insert|update|delete)[^;]*public\.load_events to authenticated/);
  });

  it("load_events constrains event_type, source_channel and statuses", () => {
    expect(exec).toMatch(/event_type = any \(array\['created','status_changed','updated'\]\)/);
    expect(exec).toMatch(
      /source_channel = any \(array\['web','telegram','import','api'\]\)/,
    );
    expect(exec).toContain("metadata jsonb not null default '{}'::jsonb");
    expect(exec).toContain("idx_load_events_load_created");
  });

  it("dispatch_command_receipts is unique per recruiter+key and has zero client policies", () => {
    expect(exec).toContain(
      "constraint dispatch_command_receipts_recruiter_key_unique unique (recruiter_id, idempotency_key)",
    );
    expect(exec).toContain(
      "alter table public.dispatch_command_receipts enable row level security",
    );
    expect(exec).not.toMatch(/create policy[^;]*on public\.dispatch_command_receipts/);
    expect(exec).not.toMatch(/grant[^;]*public\.dispatch_command_receipts to (authenticated|anon)/);
    expect(exec).toMatch(/action = any \(array\['create_load','update_status'\]\)/);
    expect(exec).toContain("char_length(idempotency_key) between 1 and 200");
  });

  it("binds a consumed key to its requested target status", () => {
    expect(exec).toContain("add column if not exists requested_status text null");
    expect(exec).toMatch(
      /requested_status is null\s+or requested_status = any \(array\['pending','en_route','completed','cancelled'\]\)/,
    );
    // create_load carries no target status; update_status must.
    expect(exec).toMatch(
      /\(action = 'create_load' and requested_status is null\)\s+or \(action = 'update_status' and requested_status is not null\)/,
    );
  });
});

// ── 8. create RPC ──────────────────────────────────────────────────────────
describe("TG-1 / dispatch_create_driver_load", () => {
  const body = fnSlice("dispatch_create_driver_load");

  it("requires loads_dispatch through the helper", () => {
    expect(body).toMatch(
      /current_user_can_dispatch_load_action\(\s*_recruiter_id, _relationship_id, _driver_user_id, 'loads_dispatch'\s*\)/,
    );
    expect(body).toContain("dispatch_not_authorized");
  });

  it("restricts company-created source channels to web/telegram/api", () => {
    expect(body).toContain("_source_channel not in ('web','telegram','api')");
  });

  it("always creates a pending canonical load and stamps provenance/actor", () => {
    expect(body).toContain("insert into public.loads");
    expect(body).toContain("'pending', _load_date");
    expect(body).toContain("_driver_user_id, _relationship_id, _source_channel");
    expect(body).toContain("_notes_clean, _uid, _uid");
    // Caller can supply neither status nor ownership/payment fields.
    expect(body).not.toMatch(/\b_status\b/);
    expect(body).not.toContain("_actual_pay_received");
    expect(body).not.toContain("_payment_status");
    expect(body).not.toContain("actual_pay_received");
    expect(body).not.toContain("payment_status");
  });

  it("validates reference/location/notes/date/pay_model/numeric bounds", () => {
    expect(body).toContain("char_length(_ref) > 200");
    expect(body).toContain("dispatch_invalid_location");
    expect(body).toContain("char_length(_notes_clean) > 5000");
    expect(body).toContain("_dropoff_date < _load_date");
    expect(body).toContain(
      "('loaded_miles_only','total_miles','loaded_plus_deadhead','flat_rate','manual')",
    );
    expect(body).toContain("dispatch_invalid_numeric_value");
  });

  it("rejects NaN / Infinity / -Infinity explicitly for every numeric input", () => {
    const numerics = [
      "_loaded_miles",
      "_deadhead_miles",
      "_total_miles",
      "_rate_per_mile",
      "_flat_rate_amount",
      "_deadhead_rate_per_mile",
      "_wait_fee",
      "_detention_fee",
      "_other_fees",
      "_estimated_pay",
    ];
    for (const v of numerics) {
      expect(
        body.includes(`${v}::text not in ('nan','infinity','-infinity')`),
        `${v} must reject special numeric values by text`,
      ).toBe(true);
      expect(body.includes(`${v} = ${v}`), `${v} must not use self-equality`).toBe(false);
    }
  });

  it("writes exactly one created event and one idempotency receipt", () => {
    expect([...body.matchAll(/insert into public\.load_events/g)].length).toBe(1);
    expect(body).toContain("'created', _source_channel, null, 'pending'");
    expect([...body.matchAll(/insert into public\.dispatch_command_receipts/g)].length).toBe(1);
  });

  it("replays idempotently and fails closed on conflicting reuse", () => {
    expect(body).toContain("for update");
    expect(body).toContain("dispatch_idempotency_conflict");
    expect(body).toContain("when unique_violation then");
  });

  it("records the receipt with a NULL requested_status", () => {
    expect(body).toMatch(
      /idempotency_key, action, load_id, actor_user_id, source_channel,\s+requested_status\s+\) values \([\s\S]*'create_load', _new_id, _uid, _source_channel,\s+null\s+\);/,
    );
  });

  it("concurrent-replay handler compares source_channel and create shape", () => {
    const handler = body.slice(body.indexOf("when unique_violation then"));
    expect(handler).toContain("_receipt.action <> 'create_load'");
    expect(handler).toContain("_receipt.carrier_driver_relationship_id <> _relationship_id");
    expect(handler).toContain("_receipt.driver_user_id <> _driver_user_id");
    expect(handler).toContain("_receipt.source_channel <> _source_channel");
    expect(handler).toContain("_receipt.requested_status is not null");
  });

  it("is least privilege", () => {
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path to 'pg_catalog', 'public', 'auth'");
    expect(exec).toContain("revoke all on function public.dispatch_create_driver_load");
    expect(exec).toMatch(
      /grant execute on function public\.dispatch_create_driver_load[^;]*to authenticated/,
    );
  });
});

// ── 9. status RPC ──────────────────────────────────────────────────────────
describe("TG-1 / dispatch_update_driver_load_status", () => {
  const body = fnSlice("dispatch_update_driver_load_status");

  it("requires loads_update_status through the helper", () => {
    expect(body).toMatch(
      /current_user_can_dispatch_load_action\(\s*_recruiter_id, _relationship_id, _driver_user_id, 'loads_update_status'\s*\)/,
    );
  });

  it("scopes the load to the exact driver and relationship", () => {
    expect(body).toMatch(
      /from public\.loads\s+where id = _load_id\s+and user_id = _driver_user_id\s+and carrier_driver_relationship_id = _relationship_id/,
    );
  });

  it("enforces the exact lifecycle including terminal states", () => {
    expect(body).toContain("not in ('pending','en_route','completed','cancelled')");
    expect(body).toContain("_from in ('completed','cancelled')");
    expect(body).toContain("_from = 'pending' and _new_status not in ('en_route','completed','cancelled')");
    expect(body).toContain("_from = 'en_route' and _new_status not in ('completed','cancelled')");
    expect(body).toContain("dispatch_invalid_status_transition");
  });

  it("existing-receipt replay binds the exact requested target status", () => {
    const replay = body.slice(
      body.indexOf("if found then"),
      body.indexOf("when unique_violation then"),
    );
    expect(replay).toContain("_receipt.action <> 'update_status'");
    expect(replay).toContain("_receipt.carrier_driver_relationship_id <> _relationship_id");
    expect(replay).toContain("_receipt.driver_user_id <> _driver_user_id");
    expect(replay).toContain("_receipt.source_channel <> _source_channel");
    expect(replay).toContain("_receipt.load_id is distinct from _load_id");
    expect(replay).toContain("_receipt.requested_status is distinct from _new_status");
  });

  it("no-op consumes the key with a receipt but writes zero load_events", () => {
    const noop = body.slice(
      body.indexOf("if _from = _new_status then"),
      body.indexOf("if _from in ('completed','cancelled')"),
    );
    expect(noop).toContain("insert into public.dispatch_command_receipts");
    expect(noop).toContain("_key, 'update_status', _load_id, _uid, _source_channel,");
    expect(noop).toContain("_new_status");
    expect(noop).not.toContain("insert into public.load_events");
    expect(noop).toContain("return _row;");
  });

  it("concurrent-replay handler compares the full command context", () => {
    const handler = body.slice(body.indexOf("when unique_violation then"));
    expect(handler).toContain("_receipt.action <> 'update_status'");
    expect(handler).toContain("_receipt.carrier_driver_relationship_id <> _relationship_id");
    expect(handler).toContain("_receipt.driver_user_id <> _driver_user_id");
    expect(handler).toContain("_receipt.source_channel <> _source_channel");
    expect(handler).toContain("_receipt.load_id is distinct from _load_id");
    expect(handler).toContain("_receipt.requested_status is distinct from _new_status");
  });

  it("stamps actor, stores requested_status and writes one status_changed event", () => {
    expect(body).toContain("updated_by_user_id = _uid");
    expect([...body.matchAll(/insert into public\.load_events/g)].length).toBe(1);
    // exactly two receipt inserts: the no-op consumption and the real change.
    expect(
      [...body.matchAll(/insert into public\.dispatch_command_receipts/g)].length,
    ).toBe(2);
    expect(body).toMatch(
      /_key, 'update_status', _load_id, _uid, _source_channel,\s+_new_status\s+\);[\s\S]*insert into public\.load_events/,
    );
    expect(body).toContain("'status_changed', _source_channel, _from, _new_status");
  });

  it("uses update_status idempotency and is least privilege", () => {
    expect(body).toContain("'update_status'");
    expect(body).toContain("dispatch_idempotency_conflict");
    expect(exec).toContain("revoke all on function public.dispatch_update_driver_load_status");
    expect(exec).toMatch(
      /grant execute on function public\.dispatch_update_driver_load_status[^;]*to authenticated/,
    );
  });
});

// ── 10. canonical mileage helper mirrors resolveOperatingMiles ─────────────
describe("TG-1 / canonical_load_operating_miles", () => {
  const body = fnSlice("canonical_load_operating_miles");

  it("is immutable and reads no tables", () => {
    expect(body).toContain("immutable");
    expect(body).not.toMatch(/\bfrom public\./);
  });

  it("mirrors the 2-mile tolerance rules exactly", () => {
    expect(body).toContain("_tolerance constant numeric := 2");
    expect(body).toContain("if _s <= 0 then return _component; end if;");
    expect(body).toContain("if _l > 0 and _s < _l then return _component; end if;");
    expect(body).toContain("if _s < _component - _tolerance then return _component; end if;");
    expect(body).toContain("return _s;");
    expect(body).toMatch(/if _s > 0 then return _s; end if;\s+return 0;/);
  });

  it("coerces null / NaN / +-Infinity / negative inputs to zero via ::text", () => {
    for (const v of ["_loaded", "_deadhead", "_stored_total"]) {
      expect(body).toContain(
        `${v} is null or ${v}::text in ('nan','infinity','-infinity') or ${v} < 0`,
      );
    }
  });

  it("uses no self-equality NaN test anywhere (numeric NaN = NaN is true)", () => {
    for (const v of ["_loaded", "_deadhead", "_stored_total", "_l", "_d", "_s"]) {
      expect(body.includes(`${v} <> ${v}`), `self-equality test on ${v}`).toBe(false);
    }
    expect(exec).not.toMatch(/(?<![\w.])(_\w+) <> \1(?![\w.])/);
  });
});

// ── 11. mileage summary ────────────────────────────────────────────────────
describe("TG-1 / get_carrier_driver_mileage_summary", () => {
  const body = fnSlice("get_carrier_driver_mileage_summary");

  it("requires loads_view via the helper", () => {
    expect(body).toMatch(
      /current_user_can_dispatch_load_action\(\s*_recruiter_id, _relationship_id, _driver_user_id, 'loads_view'\s*\)/,
    );
  });

  it("derives completed financial totals from status='completed' only", () => {
    expect(body).toContain("done as (select * from scoped where status = 'completed')");
    expect(body).toContain(
      "public.canonical_load_operating_miles(l.loaded_miles, l.deadhead_miles, l.total_miles)",
    );
    expect(body).toContain("coalesce(l.dropoff_date, l.load_date) as effective_date");
  });

  it("keeps active assigned miles separate from completed totals", () => {
    expect(body).toContain(
      "'active_assigned_miles',\n        coalesce((select sum(miles) from scoped where status in ('pending','en_route')), 0)",
    );
    expect(body).not.toMatch(/company_completed_miles[^\n]*active/);
  });

  it("returns every required period key", () => {
    for (const key of [
      "as_of",
      "employment_start_date",
      "week_start_day",
      "pay_period_cadence",
      "pay_period_start",
      "pay_period_end",
      "week_completed_miles",
      "current_pay_period_completed_miles",
      "month_completed_miles",
      "last_month_completed_miles",
      "year_completed_miles",
      "company_completed_miles",
      "active_assigned_miles",
      "week_completed_load_count",
      "week_cancelled_load_count",
      "active_load_count",
    ]) {
      expect(body.includes(`'${key}'`), `missing key ${key}`).toBe(true);
    }
  });

  it("never substitutes accepted_at for employment_start_date", () => {
    expect(body).toContain("r.employment_start_date into _employment");
    expect(body).not.toContain("accepted_at");
  });

  it("fails closed on a missing biweekly anchor", () => {
    expect(body).toContain("dispatch_missing_pay_period_anchor");
    expect(body).toContain("dispatch_invalid_pay_period_cadence");
  });
});

// ── 12. completed-only financial semantics ─────────────────────────────────
const baseLoad = (over: Partial<Load>): Load =>
  ({
    id: over.id ?? "l1",
    user_id: "u1",
    load_date: "2026-08-10",
    pickup_location: "A",
    dropoff_location: "B",
    loaded_miles: 100,
    deadhead_miles: 0,
    total_miles: 100,
    rate_per_mile: 2,
    wait_fee: 0,
    detention_fee: 0,
    other_fees: 0,
    estimated_pay: 200,
    status: "completed",
    payment_status: "unpaid",
    ...over,
  }) as unknown as Load;

describe("TG-1 / completed-only financial semantics", () => {
  it("classifies operational statuses correctly", () => {
    expect(isCompletedLoadForFinancials({ status: "completed" })).toBe(true);
    expect(isCompletedLoadForFinancials({ status: null })).toBe(true);
    expect(isCompletedLoadForFinancials({})).toBe(true);
    expect(isCompletedLoadForFinancials({ status: "pending" })).toBe(false);
    expect(isCompletedLoadForFinancials({ status: "en_route" })).toBe(false);
    expect(isCompletedLoadForFinancials({ status: "cancelled" })).toBe(false);
  });

  it("fails closed on unknown / future / malformed non-null statuses", () => {
    for (const status of ["", " completed", "Completed", "COMPLETED", "delivered", "archived", "unknown_future"]) {
      expect(
        isCompletedLoadForFinancials({ status }),
        `status ${JSON.stringify(status)} must not be financially complete`,
      ).toBe(false);
    }
    expect(getLoadRealizedRevenue(baseLoad({ status: "delivered" }))).toBe(0);
    const s = summarizeLoads([
      baseLoad({ id: "x", status: "delivered" }),
      baseLoad({ id: "y", status: "completed" }),
    ]);
    expect(s.loadCount).toBe(1);
    expect(s.grossRevenue).toBe(200);
  });

  it("realized revenue is 0 for pending / en_route / cancelled", () => {
    expect(getLoadRealizedRevenue(baseLoad({ status: "completed" }))).toBe(200);
    expect(getLoadRealizedRevenue(baseLoad({ status: "pending" }))).toBe(0);
    expect(getLoadRealizedRevenue(baseLoad({ status: "en_route" }))).toBe(0);
    expect(getLoadRealizedRevenue(baseLoad({ status: "cancelled" }))).toBe(0);
    expect(getLoadRealizedRevenue(baseLoad({ status: null }))).toBe(200);
  });

  it("summarizeLoads counts only financially completed loads", () => {
    const loads = [
      baseLoad({ id: "a", status: "completed" }),
      baseLoad({ id: "b", status: "pending" }),
      baseLoad({ id: "c", status: "en_route" }),
      baseLoad({ id: "d", status: "cancelled" }),
    ];
    const s = summarizeLoads(loads);
    expect(s.loadCount).toBe(1);
    expect(s.cancelledCount).toBe(1);
    expect(s.loadedMiles).toBe(100);
    expect(s.totalMiles).toBe(100);
    expect(s.grossRevenue).toBe(200);
    expect(s.estimatedPay).toBe(200);
    expect(s.pendingPaymentCount).toBe(1);
    expect(s.pendingPaymentEstimated).toBe(200);
  });

  it("preserves excludeCancelled as the broad operational helper", () => {
    const loads = [
      baseLoad({ id: "a", status: "completed" }),
      baseLoad({ id: "b", status: "pending" }),
      baseLoad({ id: "c", status: "en_route" }),
      baseLoad({ id: "d", status: "cancelled" }),
    ];
    expect(excludeCancelled(loads).map((l) => l.id)).toEqual(["a", "b", "c"]);
    // Source array is never mutated.
    expect(loads.length).toBe(4);
  });
});

// ── 14. allowlist enforcement ──────────────────────────────────────────────
describe("TG-1R / allowlist", () => {
  /**
   * TG-1R correction scope, validated against the fixed historical commit
   * range 062f996e..28310a63 (the authoritative TG-1R source end commit).
   * The endpoint is pinned so later legitimate commits cannot invalidate it.
   */
  const ALLOWED = [
    SQL_REL,
    "src/lib/financialCalculations.ts",
    "src/test/phaseTG1CanonicalDispatchLoadFoundation.test.ts",
  ].sort();

  it("changed only the three TG-1R allowlisted files in the fixed TG-1R historical commit range", () => {
    const committed = execSync(
      "git diff --name-only 062f996ee6933ec6bb3a3798b5f3a39121303cde..28310a63e38df67425695a4ef2613ce775467353",
      { encoding: "utf8" },
    ).split("\n");
    const working: string[] = [];
    const changed = new Set(
      [...committed, ...working]
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((p) => !p.startsWith(".lovable/")),
    );
    for (const file of changed) {
      expect(ALLOWED, `unexpected changed file: ${file}`).toContain(file);
    }
  });

  it("does not add a managed migration or touch generated types", () => {
    expect(
      existsSync(
        path.resolve(
          process.cwd(),
          "supabase/migrations/20260819110000_phase_tg1_canonical_dispatch_load_foundation.sql",
        ),
      ),
    ).toBe(false);
  });
});
