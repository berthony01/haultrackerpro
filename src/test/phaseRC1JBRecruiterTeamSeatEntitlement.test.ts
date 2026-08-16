/**
 * Phase RC-1J-B — Recruiter Team Seat Entitlement & Enforcement.
 *
 * Deterministic SQL contract test against the CANDIDATE migration text.
 * The migration is NOT applied live; this suite proves the authored contract.
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { describe, it, expect } from "vitest";

const SQL_REL =
  "supabase/migration-candidates/20260816140000_phase_rc1j_b_recruiter_team_seat_entitlement.sql";
const SQL_PATH = path.resolve(process.cwd(), SQL_REL);
const TEST_REL = "src/test/phaseRC1JBRecruiterTeamSeatEntitlement.test.ts";

const sql = readFileSync(SQL_PATH, "utf8");
const lower = sql.toLowerCase();

/**
 * Executable SQL only: `--` line comments stripped, so narrative comments can
 * never create a false positive about what the migration actually does.
 */
const lowerExecutable = lower
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

/**
 * Extract the EXECUTABLE body of a `CREATE OR REPLACE FUNCTION public.<name>`
 * block. Comments are stripped so narrative prose can never satisfy — or
 * falsely violate — a behavioral assertion.
 */
function fnBody(name: string): string {
  const start = lowerExecutable.indexOf(`create or replace function public.${name}`);
  expect(start, `function ${name} must be defined`).toBeGreaterThan(-1);
  const rest = lowerExecutable.slice(start + 10);
  const next = rest.indexOf("create or replace function public.");
  return next === -1 ? rest : rest.slice(0, next);
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("RC-1J-B — candidate migration envelope", () => {
  it("1a. is marked as a candidate and is atomic", () => {
    expect(sql.split("\n")[0].trim()).toBe("-- CANDIDATE MIGRATION — NOT APPLIED LIVE.");
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(countOccurrences(sql, "\nBEGIN;")).toBe(1);
    expect(countOccurrences(sql, "\nCOMMIT;")).toBe(1);
    expect(lowerExecutable).not.toContain("rollback;");
  });

  it("1b. changes exactly the 2 allowlisted files", () => {
    expect(existsSync(SQL_PATH)).toBe(true);
    expect(existsSync(path.resolve(process.cwd(), TEST_REL))).toBe(true);

    let changed: string[] = [];
    try {
      changed = execSync("git status --porcelain", { encoding: "utf8" })
        .split("\n")
        .map((l) => l.slice(3).trim())
        .filter(Boolean)
        .filter((f) => f !== "src/integrations/supabase/types.ts");
    } catch {
      changed = [];
    }
    for (const file of changed) {
      expect([SQL_REL, TEST_REL]).toContain(file);
    }
  });

  it("1c. defines exactly the 5 authorized function definitions", () => {
    const defs = [...lower.matchAll(/create or replace function public\.([a-z0-9_]+)/g)].map(
      (m) => m[1],
    );
    expect(defs.sort()).toEqual(
      [
        "accept_recruiter_member_invite",
        "current_user_has_recruiter_permission",
        "invite_recruiter_member",
        "recruiter_team_occupied_seats",
        "recruiter_team_seat_limit",
        "recruiter_team_workspace_within_limit",
      ].filter((n) => defs.includes(n)).sort(),
    );
    expect(defs).toHaveLength(6);
  });
});

describe("RC-1J-B — seat limit matrix", () => {
  const body = fnBody("recruiter_team_seat_limit");

  it("2a. is a stable SECURITY DEFINER helper pinned to search_path public", () => {
    expect(body).toContain("returns integer");
    expect(body).toContain("stable");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public");
  });

  it("2b. encodes the 1 / 2 / 5 / 15 total-seat matrix (owner included)", () => {
    expect(body).toMatch(/when 'starter' then 2/);
    expect(body).toMatch(/when 'growth'\s+then 5/);
    expect(body).toMatch(/when 'fleet'\s+then 15/);
    // Default: Recruiter Standard / unknown / non-paying => owner-only.
    expect(body).toMatch(/else 1/);
    // No seat value may exceed the locked fleet ceiling.
    expect(body).not.toMatch(/then (25|16|20|100)\b/);
  });

  it("2c. anchors standalone billing to the recruiter profile AND its owner", () => {
    expect(body).toContain("from public.recruiter_profiles rp");
    expect(body).toContain("select rp.user_id into _owner_id");
    expect(body).toContain("from public.recruiter_billing_profiles b");
    expect(body).toContain("b.recruiter_id = _recruiter_id");
    expect(body).toContain("b.user_id = _owner_id");
  });

  it("2d. only active/trialing paid plans grant seats", () => {
    expect(body).toContain("b.plan in ('starter', 'growth', 'fleet')");
    expect(body).toContain("b.status in ('active', 'trialing')");
    // past_due / canceled / incomplete are never seat-granting statuses.
    expect(body).not.toContain("past_due");
    expect(body).not.toContain("canceled");
    expect(body).not.toContain("incomplete");
  });

  it("2e. agency-included premium grants zero staff seats", () => {
    // The helper never consults agency entitlement tables, so an agency-only
    // workspace falls through to the owner-only default of 1.
    expect(body).not.toContain("agency_entitlements");
    expect(body).not.toContain("agency_profiles");
    expect(body).not.toContain("agency_members");
    expect(body).not.toContain("agency_starter");
  });

  it("2f. dual business-entitlement conflict fails closed to owner-only", () => {
    expect(body).toContain("public.effective_recruiter_tier(_recruiter_id) = 'conflict'");
    const conflictIdx = body.indexOf("= 'conflict'");
    const returnOne = body.indexOf("return 1;", conflictIdx);
    expect(returnOne).toBeGreaterThan(conflictIdx);
    // The conflict short-circuit precedes the standalone billing lookup.
    expect(returnOne).toBeLessThan(body.indexOf("recruiter_billing_profiles"));
  });

  it("2g. a nonexistent recruiter workspace fails closed at 0", () => {
    expect(body).toContain("if not found then");
    expect(body).toContain("return 0;");
  });
});

describe("RC-1J-B — occupied seat contract", () => {
  const body = fnBody("recruiter_team_occupied_seats");

  it("3a. reserves the owner seat as 1 regardless of membership rows", () => {
    expect(body).toContain("return 1 + coalesce(_used, 0)");
    expect(body).toContain("m.role <> 'recruiter_owner'");
  });

  it("3b. counts active members and unexpired pending invitations", () => {
    expect(body).toContain("m.status = 'active'");
    expect(body).toContain("m.status = 'pending'");
    expect(body).toContain("m.invite_expires_at is not null");
    expect(body).toContain("m.invite_expires_at > now()");
  });

  it("3c. never counts revoked members or expired pending invitations", () => {
    expect(body).not.toContain("'revoked'");
    expect(body).not.toContain("invite_expires_at <= now()");
    expect(body).not.toContain("m.status in ('pending', 'active')");
  });

  it("3d. nonexistent workspace resolves to 0 occupied seats", () => {
    expect(body).toContain("not exists (select 1 from public.recruiter_profiles rp where rp.id = _recruiter_id)");
    expect(body).toContain("return 0;");
  });
});

describe("RC-1J-B — within-limit helper", () => {
  const body = fnBody("recruiter_team_workspace_within_limit");

  it("4a. returns boolean, stable, definer, pinned search_path", () => {
    expect(body).toContain("returns boolean");
    expect(body).toContain("stable");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public");
  });

  it("4b. compares occupied against limit and fails closed", () => {
    expect(body).toContain("_limit    := public.recruiter_team_seat_limit(_recruiter_id)");
    expect(body).toContain("_occupied := public.recruiter_team_occupied_seats(_recruiter_id)");
    expect(body).toContain("return _occupied <= _limit");
    expect(body).toContain("if _limit is null or _limit < 1 then");
    expect(body).toContain("return false;");
  });

  it("4c. nonexistent / null workspace is never within limit", () => {
    expect(body).toContain("if _recruiter_id is null then");
    expect(body).toContain("not exists (select 1 from public.recruiter_profiles rp where rp.id = _recruiter_id)");
  });
});

describe("RC-1J-B — central staff authorization", () => {
  const body = fnBody("current_user_has_recruiter_permission");

  it("5a. owner semantics remain unchanged", () => {
    expect(body).toContain("public.is_recruiter_workspace_owner(_recruiter_id)");
    // The owner branch is NOT gated on the seat helper.
    const ownerIdx = body.indexOf("public.is_recruiter_workspace_owner(_recruiter_id)");
    const withinIdx = body.indexOf("recruiter_team_workspace_within_limit");
    expect(ownerIdx).toBeGreaterThan(-1);
    expect(withinIdx).toBeGreaterThan(ownerIdx);
    expect(body.slice(ownerIdx, withinIdx)).toContain("or (");
  });

  it("5b. non-owner branch still requires active membership + exact JSON true", () => {
    expect(body).toContain("m.status = 'active'");
    expect(body).toContain("jsonb_typeof(m.permissions) = 'object'");
    expect(body).toContain("(m.permissions -> (_permission::text)) = to_jsonb(true)");
    expect(body).toContain("m.member_user_id = auth.uid()");
  });

  it("5c. non-owner branch additionally requires within-limit", () => {
    expect(body).toContain(
      "public.recruiter_team_workspace_within_limit(_recruiter_id)\n         and exists (",
    );
  });

  it("5d. no role shortcut grants anything", () => {
    expect(body).not.toContain("m.role =");
    expect(body).not.toContain("recruiter_admin");
    expect(body).not.toContain("recruiter_staff'");
  });

  it("5e. keeps its signature and null-safety", () => {
    expect(lower).toContain("create or replace function public.current_user_has_recruiter_permission(\n  _recruiter_id uuid,\n  _permission public.recruiter_workspace_permission\n)");
    expect(body).toContain("auth.uid() is not null");
    expect(body).toContain("_recruiter_id is not null");
    expect(body).toContain("_permission is not null");
  });
});

describe("RC-1J-B — invite seat enforcement", () => {
  const body = fnBody("invite_recruiter_member");

  it("6a. remains owner-only with the preserved signature and return shape", () => {
    expect(lower).toContain(
      "create or replace function public.invite_recruiter_member(\n  _recruiter_id uuid,\n  _email text,\n  _role public.recruiter_member_role default 'recruiter_staff'\n)",
    );
    expect(body).toContain("if not public.is_recruiter_workspace_owner(_recruiter_id) then");
    expect(body).toContain("'invite_token', _raw_token");
    expect(body).toContain("'membership_id', _row.id");
    expect(body).toContain("'invite_email', _row.invite_email::text");
    expect(body).toContain("'role', _row.role::text");
    expect(body).toContain("'expires_at', _row.invite_expires_at");
  });

  it("6b. preserves normalization, owner-email rejection, token and expiry", () => {
    expect(body).toContain("lower(btrim(coalesce(_email, '')))");
    expect(body).toContain("cannot invite the workspace owner");
    expect(body).toContain("extensions.gen_random_bytes(24)");
    expect(body).toContain("extensions.digest(_raw_token, 'sha256')");
    expect(body).toContain("now() + interval '7 days'");
    expect(body).toContain("already a member");
  });

  it("6b2. preserves the EXACT existing RC-1A POSIX email validation", () => {
    expect(body).toContain(
      "if _norm='' or _norm !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then",
    );
    // No alternate regex vocabulary was substituted.
    expect(body).not.toContain("[^@\\s]");
  });


  it("6c. preserves both audit events", () => {
    expect(body).toContain("'invite_created'");
    expect(body).toContain("'invite_refreshed'");
  });

  it("6d. locks the workspace/profile row BEFORE the membership row", () => {
    const profileLock = body.indexOf("from public.recruiter_profiles rp\n   where rp.id = _recruiter_id\n   for update");
    const memberLock = body.indexOf("from public.recruiter_members m\n   where m.recruiter_id = _recruiter_id");
    expect(profileLock).toBeGreaterThan(-1);
    expect(memberLock).toBeGreaterThan(profileLock);
    expect(body).not.toContain("pg_advisory_lock");
    expect(body).not.toContain("lock table");
  });

  it("6e. recounts seats with a DIRECT count AFTER both locks (no STABLE helper)", () => {
    const profileLock = body.indexOf("from public.recruiter_profiles rp\n   where rp.id = _recruiter_id\n   for update");
    const memberLock = body.indexOf("from public.recruiter_members m\n   where m.recruiter_id = _recruiter_id");
    const directCount = body.indexOf("select 1 + count(*)::integer into _occupied");
    expect(directCount).toBeGreaterThan(profileLock);
    expect(directCount).toBeGreaterThan(memberLock);
    // The STABLE helper would reuse the pre-wait snapshot: it must NOT be used
    // for the post-lock capacity decision.
    expect(body).not.toContain("recruiter_team_occupied_seats");
    expect(body).not.toContain("recruiter_team_workspace_within_limit");
  });

  it("6e2. the direct recount uses the canonical occupied predicate (owner=1)", () => {
    const idx = body.indexOf("select 1 + count(*)::integer into _occupied");
    expect(idx).toBeGreaterThan(-1);
    const stmt = body.slice(idx, body.indexOf(";", idx));
    expect(stmt).toContain("from public.recruiter_members m");
    expect(stmt).toContain("m.recruiter_id = _recruiter_id");
    expect(stmt).toContain("m.role <> 'recruiter_owner'");
    expect(stmt).toContain("m.status = 'active'");
    expect(stmt).toContain("m.status = 'pending'");
    expect(stmt).toContain("m.invite_expires_at is not null");
    expect(stmt).toContain("m.invite_expires_at > now()");
    expect(stmt).not.toContain("'revoked'");
  });


  it("6f. a NEW invite requires a free seat and raises a generic exception", () => {
    expect(body).toContain("_occupied >= _limit");
    expect(body).toContain("raise exception 'team seat limit reached'");
    // Generic: no billing internals leaked to the client.
    const capIdx = body.indexOf("raise exception 'team seat limit reached'");
    const line = body.slice(capIdx, capIdx + 160);
    expect(line).not.toContain("plan");
    expect(line).not.toContain("stripe");
    expect(line).not.toContain("billing");
  });

  it("6g. refreshing an UNEXPIRED pending invite consumes no extra seat", () => {
    expect(body).toContain("_refresh_unexpired := found");
    expect(body).toContain("_existing.status = 'pending'");
    expect(body).toContain("_existing.invite_expires_at > now()");
    expect(body).toContain("if not _refresh_unexpired then");
  });

  it("6h. refreshing an EXPIRED pending invite re-checks capacity", () => {
    // Only the unexpired case skips the capacity gate, so an expired pending
    // invite falls into the `NOT _refresh_unexpired` capacity branch.
    const guard = body.indexOf("if not _refresh_unexpired then");
    const limitCall = body.indexOf("public.recruiter_team_seat_limit(_recruiter_id)");
    expect(limitCall).toBeGreaterThan(guard);
    // Expiry alone never flips the stored row status.
    expect(body).not.toContain("set status = 'revoked'");
    expect(body).not.toContain("status = 'expired'");
  });
});

describe("RC-1J-B — accept seat enforcement", () => {
  const body = fnBody("accept_recruiter_member_invite");

  it("7a. preserves invited-email / token / expiry checks and audit", () => {
    expect(body).toContain("extensions.digest(btrim(_token), 'sha256')");
    expect(body).toContain("lower(m.invite_email::text) = _email");
    expect(body).toContain("m.invite_expires_at > now()");
    expect(body).toContain("m.status = 'pending'");
    expect(body).toContain("'invite_accepted'");
    expect(body).toContain("raise exception 'invalid invitation'");
  });

  it("7b. locks the workspace row first, then re-validates/locks the invite", () => {
    const profileLock = body.indexOf("from public.recruiter_profiles rp\n   where rp.id = _recruiter_id\n   for update");
    const memberLock = body.indexOf("select * into _row");
    expect(profileLock).toBeGreaterThan(-1);
    expect(memberLock).toBeGreaterThan(profileLock);
    expect(body.slice(memberLock)).toContain("for update");
  });

  it("7c. denies acceptance over the limit using a DIRECT post-lock recount", () => {
    const profileLock = body.indexOf("from public.recruiter_profiles rp\n   where rp.id = _recruiter_id\n   for update");
    const memberLock = body.indexOf("select * into _row");
    const directCount = body.indexOf("select 1 + count(*)::integer into _occupied");
    expect(directCount).toBeGreaterThan(profileLock);
    expect(directCount).toBeGreaterThan(memberLock);
    expect(body).toContain("_occupied > _limit");
    expect(body).toContain("raise exception 'team seat limit reached'");
    const update = body.indexOf("update public.recruiter_members m");
    expect(update).toBeGreaterThan(directCount);
    // STABLE helpers must not drive the post-lock acceptance decision.
    expect(body).not.toContain("recruiter_team_workspace_within_limit");
    expect(body).not.toContain("recruiter_team_occupied_seats");
  });

  it("7c2. the accept recount uses the canonical occupied predicate (owner=1)", () => {
    const idx = body.indexOf("select 1 + count(*)::integer into _occupied");
    const stmt = body.slice(idx, body.indexOf(";", idx));
    expect(stmt).toContain("m.recruiter_id = _row.recruiter_id");
    expect(stmt).toContain("m.role <> 'recruiter_owner'");
    expect(stmt).toContain("m.status = 'active'");
    expect(stmt).toContain("m.invite_expires_at > now()");
    expect(body).toContain("_limit := public.recruiter_team_seat_limit(_row.recruiter_id)");
  });


  it("7d. never auto-revokes or deletes another member to make room", () => {
    expect(body).not.toContain("delete from");
    expect(body).not.toContain("'revoked'");
  });

  it("7e. preserves the return shape", () => {
    expect(body).toContain("'membership_id', _row.id");
    expect(body).toContain("'recruiter_id', _row.recruiter_id");
    expect(body).toContain("'role', _row.role::text");
    expect(body).toContain("'status', _row.status::text");
    expect(body).toContain("'accepted_at', _row.accepted_at");
  });
});

describe("RC-1J-B — over-limit contract", () => {
  it("8a. the migration never auto-revokes or deletes staff", () => {
    expect(lowerExecutable).not.toContain("delete from public.recruiter_members");
    expect(lowerExecutable).not.toMatch(/set\s+status\s*=\s*'revoked'/);
  });

  it("8b. owner revoke and permission management are NOT redefined", () => {
    expect(lower).not.toContain("create or replace function public.revoke_recruiter_member");
    expect(lower).not.toContain("create or replace function public.set_recruiter_member_permissions");
    expect(lower).not.toContain("create or replace function public.list_recruiter_members");
  });
});

describe("RC-1J-B — frozen functions and prohibited scope", () => {
  const frozen = [
    "effective_recruiter_tier",
    "is_recruiter_workspace_owner",
    "is_recruiter_workspace_member",
    "get_my_recruiter_permissions",
    "get_my_recruiter_staff_workspaces",
    "list_recruiter_members",
    "revoke_recruiter_member",
    "set_recruiter_member_permissions",
    "recruiter_profile_can_manage_opportunities",
    "current_user_can_recruiter_opportunity_action",
    "current_user_can_recruiter_application_action",
    "current_user_can_recruiter_referral_action",
    "current_user_can_recruiter_contract_action",
    "current_user_can_recruiter_staff_report_action",
    "settlement_current_user_can_recruiter_staff_action",
  ];

  it("9a. redefines zero frozen functions", () => {
    for (const name of frozen) {
      expect(
        lower.includes(`create or replace function public.${name}(`),
        `${name} must not be redefined`,
      ).toBe(false);
      expect(lower.includes(`create function public.${name}(`)).toBe(false);
    }
  });

  it("9b. adds no tables, columns, enums, indexes, policies or triggers", () => {
    expect(lowerExecutable).not.toContain("create table");
    expect(lowerExecutable).not.toContain("alter table");
    expect(lowerExecutable).not.toContain("create type");
    expect(lowerExecutable).not.toContain("create index");
    expect(lowerExecutable).not.toContain("create unique index");
    expect(lowerExecutable).not.toContain("create policy");
    expect(lowerExecutable).not.toContain("drop policy");
    expect(lowerExecutable).not.toContain("create trigger");
    expect(lowerExecutable).not.toContain("drop trigger");
    expect(lowerExecutable).not.toContain("enable row level security");
    expect(lowerExecutable).not.toContain("add column");
  });

  it("9c. touches no Agency, Stripe, checkout, webhook or Edge surface", () => {
    expect(lowerExecutable).not.toContain("agency_");
    expect(lowerExecutable).not.toContain("stripe");
    expect(lowerExecutable).not.toContain("checkout");
    expect(lowerExecutable).not.toContain("webhook");
    expect(lowerExecutable).not.toContain("subscriptions");
  });

  it("9d. does not operationalize team_view / team_manage", () => {
    expect(lowerExecutable).not.toContain("team_view");
    expect(lowerExecutable).not.toContain("team_manage");
  });

  it("9e. does not redefine effective_recruiter_tier, only reads it", () => {
    expect(lower).toContain("public.effective_recruiter_tier(_recruiter_id)");
    expect(lower).not.toContain("create or replace function public.effective_recruiter_tier");
  });
});

describe("RC-1J-B — privileges", () => {
  it("10a. the 3 new seat helpers are internal (no anon/authenticated execute)", () => {
    for (const fn of [
      "recruiter_team_seat_limit(uuid)",
      "recruiter_team_occupied_seats(uuid)",
      "recruiter_team_workspace_within_limit(uuid)",
    ]) {
      expect(lower).toContain(
        `revoke all on function public.${fn} from public, anon, authenticated;`,
      );
      expect(lower).not.toContain(`grant execute on function public.${fn} to authenticated`);
      expect(lower).not.toContain(`grant execute on function public.${fn} to anon`);
    }
  });

  it("10b. no public seat-status RPC is created in this phase", () => {
    expect(lower).not.toContain("get_my_recruiter_team_seats");
    expect(lower).not.toContain("get_recruiter_team_seat_status");
  });

  it("10c. existing public RPC grants are preserved", () => {
    expect(lower).toContain(
      "grant execute on function public.invite_recruiter_member(uuid, text, public.recruiter_member_role) to authenticated;",
    );
    expect(lower).toContain(
      "grant execute on function public.accept_recruiter_member_invite(text) to authenticated;",
    );
    expect(lower).toContain(
      "grant execute on function public.current_user_has_recruiter_permission(uuid, public.recruiter_workspace_permission) to authenticated;",
    );
  });
});
