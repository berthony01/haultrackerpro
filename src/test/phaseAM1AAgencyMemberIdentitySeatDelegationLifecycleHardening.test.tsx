/**
 * Phase AM-1A — Agency Member Identity, Seat & Delegation Lifecycle Hardening.
 *
 * Deterministic SQL contract test against the CANDIDATE migration text.
 * The migration is NOT applied live; this suite proves the authored contract.
 *
 * PGlite cannot faithfully model partial unique indexes + SECURITY DEFINER
 * ACLs + row-level locking semantics, so concurrency and privilege guarantees
 * are proven as static structural contracts over the EXECUTABLE SQL (comments
 * stripped), never over narrative prose.
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { describe, it, expect } from "vitest";

const SQL_REL =
  "supabase/migration-candidates/20260816220000_phase_am1a_agency_member_identity_seat_delegation_lifecycle_hardening.sql";
const TEST_REL =
  "src/test/phaseAM1AAgencyMemberIdentitySeatDelegationLifecycleHardening.test.tsx";
const SQL_PATH = path.resolve(process.cwd(), SQL_REL);

const sql = readFileSync(SQL_PATH, "utf8");
const lower = sql.toLowerCase();

/** Executable SQL only: `--` line comments stripped. */
const exec = lower
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

function fnBody(name: string): string {
  const start = exec.indexOf(`create or replace function public.${name}(`);
  expect(start, `function ${name} must be defined`).toBeGreaterThan(-1);
  const rest = exec.slice(start + 10);
  const next = rest.indexOf("create or replace function public.");
  return next === -1 ? rest : rest.slice(0, next);
}

function policyBody(name: string): string {
  const start = exec.indexOf(`create policy ${name}`);
  expect(start, `policy ${name} must be created`).toBeGreaterThan(-1);
  const rest = exec.slice(start);
  const end = rest.indexOf(");");
  return end === -1 ? rest : rest.slice(0, end + 2);
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
describe("AM-1A — scope + envelope", () => {
  it("candidate header, single atomic transaction", () => {
    expect(sql.split("\n")[0].trim()).toBe("-- CANDIDATE MIGRATION — NOT APPLIED LIVE.");
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(count(sql, "\nBEGIN;")).toBe(1);
    expect(count(sql, "\nCOMMIT;")).toBe(1);
    expect(exec).not.toContain("rollback;");
  });

  it("changes exactly the two allowlisted files", () => {
    expect(existsSync(SQL_PATH)).toBe(true);
    expect(existsSync(path.resolve(process.cwd(), TEST_REL))).toBe(true);
    let changed: string[] = [];
    try {
      changed = execSync(
        "git diff --name-only 6ac2a9e78c4ff4dd1b6c882be0a4fb6b6075a753..HEAD && git status --porcelain",
        { cwd: process.cwd(), encoding: "utf8" },
      )
        .split("\n")
        .map((l) => l.replace(/^[ MARCU?]{1,3}/, "").trim())
        .filter(Boolean);
    } catch {
      changed = [];
    }
    for (const file of changed) {
      expect([SQL_REL, TEST_REL]).toContain(file);
    }
  });

  it("touches no Stripe / plan price / plan limit / permission-enum / frontend surface", () => {
    for (const forbidden of [
      "stripe",
      "price",
      "_agency_plan_defaults(",
      "create type",
      "alter type",
      "agency_workspace_permission",
      "drop function",
      "drop table",
      "truncate",
      "delete from",
    ]) {
      expect(exec, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("does not weaken the locked general Agency usable entitlement states", () => {
    const helper = fnBody("_agency_member_paid_operational_authority");
    expect(helper).toContain("'manual_beta', 'active', 'trialing', 'past_due'");
  });
});

// ---------------------------------------------------------------------------
describe("AM-1A A — identity / invite schema hardening", () => {
  it("adds invite_expires_at idempotently and backfills only pending rows", () => {
    expect(exec).toContain("add column if not exists invite_expires_at timestamptz");
    expect(exec).toContain(
      "set invite_expires_at = coalesce(invite_expires_at, invited_at + interval '7 days')",
    );
    const backfill = exec.slice(exec.indexOf("update public.agency_members\n   set invite_expires_at"));
    expect(backfill.slice(0, 400)).toContain("where status = 'pending'");
  });

  it("creates the five deterministically named invariants", () => {
    expect(exec).toContain(
      "create unique index if not exists agency_members_active_user_uq\n  on public.agency_members (agency_id, member_user_id)\n  where status = 'active' and member_user_id is not null",
    );
    expect(exec).toContain(
      "create unique index if not exists agency_members_active_owner_uq\n  on public.agency_members (agency_id)\n  where status = 'active' and role = 'agency_owner'",
    );
    expect(exec).toContain(
      "create unique index if not exists agency_members_invite_token_hash_uq\n  on public.agency_members (invite_token_hash)\n  where invite_token_hash is not null",
    );
    expect(exec).toContain("add constraint agency_members_active_identity_chk");
    expect(exec).toContain("check (status <> 'active' or member_user_id is not null)");
    expect(exec).toContain("add constraint agency_members_pending_invite_shape_chk");
    for (const clause of [
      "member_user_id is null",
      "invite_token_hash is not null",
      "invite_expires_at is not null",
      "role <> 'agency_owner'",
    ]) {
      expect(exec).toContain(clause);
    }
  });

  it("preserves existing member uniqueness/indexes (no drops)", () => {
    expect(exec).not.toContain("agency_members_email_unique");
    expect(exec).not.toContain("drop index");
  });

  it("is replay safe for schema objects", () => {
    expect(count(exec, "if not exists")).toBeGreaterThanOrEqual(4);
    expect(exec).toContain("from pg_constraint");
  });
});

// ---------------------------------------------------------------------------
describe("AM-1A B — canonical helpers and ACL boundaries", () => {
  it("occupied seats counts active + UNEXPIRED pending only", () => {
    const body = fnBody("agency_team_occupied_seats");
    expect(body).toContain("am.status = 'active'");
    expect(body).toContain("am.invite_expires_at > now()");
    expect(body).not.toContain("'revoked'");
  });

  it("within-limit uses get_effective_agency_limits and treats NULL as unlimited", () => {
    const body = fnBody("agency_team_workspace_within_limit");
    expect(body).toContain("public.get_effective_agency_limits(_agency_id)");
    expect(body).toContain("if lim.member_limit is null then return true");
    expect(body).toContain("used <= lim.member_limit");
    expect(body).toContain("if _agency_id is null then return false");
  });

  it("paid operational authority fails closed and exempts owner only from the seat check", () => {
    const body = fnBody("_agency_member_paid_operational_authority");
    expect(body).toContain("if _agency_id is null or _uid is null then return false");
    expect(body).toContain("ap.status = 'active'");
    expect(body).toContain("am.status = 'active'");
    expect(body).toContain("ap.owner_user_id = _uid");
    // Owner short-circuit must come AFTER profile + membership + entitlement.
    expect(body.indexOf("_ent_ok")).toBeLessThan(body.indexOf("if _is_owner then"));
    expect(body).toContain("return public.agency_team_workspace_within_limit(_agency_id)");
  });

  it("delegation validity requires exact id/member/driver + approved + paid authority", () => {
    const body = fnBody("_agency_delegation_operationally_active");
    expect(body).toContain("dr.id = _delegation_id");
    expect(body).toContain("dr.status = 'approved'");
    expect(body).toContain("dr.member_user_id = _member_user_id");
    expect(body).toContain("dr.driver_user_id = _driver_user_id");
    expect(body).toContain("public._agency_member_paid_operational_authority(dr.agency_id, dr.member_user_id)");
  });

  it("arbitrary-user helpers are service-only; only the current-user wrapper is authenticated", () => {
    for (const fn of [
      "public.agency_team_occupied_seats(uuid)",
      "public.agency_team_workspace_within_limit(uuid)",
      "public._agency_member_paid_operational_authority(uuid, uuid)",
      "public._agency_delegation_operationally_active(uuid, uuid, uuid)",
    ]) {
      expect(exec).toContain(`revoke all on function ${fn.toLowerCase()} from public`);
      expect(exec).toContain(`revoke all on function ${fn.toLowerCase()} from anon, authenticated`);
      expect(exec).toContain(`grant execute on function ${fn.toLowerCase()} to service_role`);
    }
    expect(exec).toContain(
      "revoke all on function public.current_user_can_use_agency_delegation(uuid, uuid) from anon",
    );
    expect(exec).toContain(
      "grant execute on function public.current_user_can_use_agency_delegation(uuid, uuid) to authenticated, service_role",
    );
    const wrapper = fnBody("current_user_can_use_agency_delegation");
    expect(wrapper).toContain("auth.uid() is not null");
    expect(wrapper).toContain("auth.uid(), _driver_user_id");
  });

  it("all new helpers are SECURITY DEFINER with a fixed search_path", () => {
    for (const fn of [
      "agency_team_occupied_seats",
      "agency_team_workspace_within_limit",
      "_agency_member_paid_operational_authority",
      "_agency_delegation_operationally_active",
      "current_user_can_use_agency_delegation",
    ]) {
      const body = fnBody(fn);
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = public");
    }
  });

  it("is_agency_member remains a raw membership helper (not redefined as billing)", () => {
    expect(exec).not.toContain("create or replace function public.is_agency_member(");
  });
});

// ---------------------------------------------------------------------------
describe("AM-1A C — seat enforcement and concurrency", () => {
  const assertBody = fnBody("assert_agency_limit");

  it("invite_member counts active + unexpired pending, never all pending", () => {
    expect(assertBody).toContain("status = 'pending' and invite_expires_at is not null and invite_expires_at > now()");
    expect(assertBody).not.toContain("status in ('pending','active')");
  });

  it("adds a non-owner over-seat fail-closed guard with owner exemption", () => {
    expect(assertBody).toContain("ap.owner_user_id = _uid");
    expect(assertBody).toContain("if not _is_owner");
    expect(assertBody).toContain("not public.agency_team_workspace_within_limit(_agency_id)");
    expect(assertBody).toContain("errcode = 'p0001'");
  });

  it("keeps the cancelled billing guard first and the existing action vocabulary", () => {
    expect(assertBody.indexOf("lim.status = 'cancelled'")).toBeLessThan(
      assertBody.indexOf("if not _is_owner"),
    );
    for (const action of [
      "create_service_package",
      "invite_member",
      "activate_client",
      "set_private_request_link",
      "submit_client_request",
      "progress_client_request",
      "create_delegation_request",
      "create_work_item",
      "accept_member_invite",
    ]) {
      expect(assertBody).toContain(action);
    }
    expect(assertBody).toContain("unknown agency limit action");
  });

  it("invite locks the agency row FIRST and uses a direct post-lock recount", () => {
    const body = fnBody("invite_agency_member");
    const lockIdx = body.indexOf("from public.agency_profiles ap\n   where ap.id = _agency_id for update");
    expect(lockIdx).toBeGreaterThan(-1);
    const recountIdx = body.indexOf("select count(*)::integer into _used from public.agency_members am");
    expect(recountIdx).toBeGreaterThan(lockIdx);
    // the concurrency-sensitive decision must NOT use the STABLE helper
    expect(body).not.toContain("public.agency_team_occupied_seats(");
  });

  it("invite applies 7-day expiry on new and refreshed pending invites", () => {
    const body = fnBody("invite_agency_member");
    expect(body).toContain("_expiry := now() + interval '7 days'");
    expect(body).toContain("invite_expires_at=excluded.invite_expires_at");
  });

  it("active same-email membership fails cleanly without minting or rewriting anything", () => {
    const body = fnBody("invite_agency_member");
    const activeGuard = body.indexOf("_existing.status = 'active'");
    expect(activeGuard).toBeGreaterThan(-1);
    expect(activeGuard).toBeLessThan(body.indexOf("extensions.gen_random_bytes(24)"));
    expect(activeGuard).toBeLessThan(body.indexOf("insert into public.agency_members"));
  });

  it("unexpired refresh does not consume a seat; expired refresh and new invite do", () => {
    const body = fnBody("invite_agency_member");
    expect(body).toContain("_existing.invite_expires_at > now()");
    expect(count(body, "_used > _limit")).toBe(1); // unexpired refresh branch
    expect(count(body, "_used >= _limit")).toBe(2); // expired refresh + brand new
  });

  it("stores only the SHA-256 hash and returns the raw token once", () => {
    const body = fnBody("invite_agency_member");
    expect(body).toContain("encode(extensions.gen_random_bytes(24),'hex')");
    expect(body).toContain("encode(extensions.digest(_t,'sha256'),'hex')");
    expect(body).toContain("'invite_token',_t");
    expect(body).toContain("invite_token_hash");
  });

  it("accept uses consistent lock ordering: agency row, then the pending row", () => {
    const body = fnBody("accept_agency_invite");
    const agencyLock = body.indexOf("from public.agency_profiles ap\n   where ap.id = _agency_id for update");
    const memberLock = body.indexOf("for update;\n  if not found then");
    expect(agencyLock).toBeGreaterThan(-1);
    expect(memberLock).toBeGreaterThan(agencyLock);
    expect(body).toContain("am.invite_expires_at > now()");
    expect(body).toContain("lower(am.invite_email)=_em");
    expect(body).toContain("am.status='pending'");
  });

  it("accept allows exact capacity and rejects an over-limit workspace", () => {
    const body = fnBody("accept_agency_invite");
    expect(body).toContain("select count(*)::integer into _used from public.agency_members am");
    expect(body).toContain("if _limit is not null and _used > _limit then");
    expect(body).not.toContain("_used >= _limit");
    expect(body).toContain("public.assert_agency_limit(_pending.agency_id, 'accept_member_invite')");
  });

  it("accept blocks duplicate active identity and clears invite state on success", () => {
    const body = fnBody("accept_agency_invite");
    expect(body).toContain("am2.member_user_id=_uid");
    expect(body).toContain("invite_token_hash=null, invite_expires_at=null");
    expect(count(body, "invite invalid or not addressed to your email")).toBeGreaterThanOrEqual(3);
  });

  it("schema-qualifies all three pgcrypto calls against the extensions schema", () => {
    const invite = fnBody("invite_agency_member");
    expect(invite).toContain("extensions.gen_random_bytes(24)");
    expect(invite).toContain("extensions.digest(_t,'sha256')");
    expect(invite).not.toContain("(gen_random_bytes(24)");
    expect(invite).not.toContain("(digest(_t");

    const accept = fnBody("accept_agency_invite");
    expect(accept).toContain("extensions.digest(coalesce(_token,''),'sha256')");
    expect(accept).not.toContain("(digest(coalesce(_token,'')");
  });

  it("invite/accept keep a fixed search_path = public and never widen it", () => {
    for (const fn of ["invite_agency_member", "accept_agency_invite"]) {
      const body = fnBody(fn);
      expect(body).toContain("set search_path = public");
      // widened forms (e.g. settlement's 'pg_catalog','public','auth') must never appear
      expect(body).not.toContain("set search_path to");
      expect(body).not.toContain("'pg_catalog'");
      expect(body).not.toContain("'auth'");
      expect(body).not.toContain("'extensions'");
    }
  });
});

// ---------------------------------------------------------------------------
describe("AM-1A D — revocation cascade", () => {
  const body = fnBody("revoke_agency_member");

  it("stays owner-only, protects the owner row and locks agency then member", () => {
    expect(body).toContain("ap.owner_user_id=_uid for update");
    expect(body).toContain("am.role<>'agency_owner'");
    expect(body.indexOf("ap.owner_user_id=_uid for update")).toBeLessThan(
      body.indexOf("am.id=_member_id and am.agency_id=_agency_id"),
    );
  });

  it("revokes membership, delegations and agency-originated driver_assistants", () => {
    expect(body).toContain("set status='revoked', revoked_at=now()");
    expect(body).toContain("dr.status in ('pending_driver_approval','approved')");
    expect(body).toContain("update public.driver_assistants da");
    expect(body).toContain("da.agency_delegation_id is not null");
    expect(body).toContain("da.status in ('pending','active')");
    expect(body).toContain("invite_token_hash=null");
  });

  it("clears stale assignment references so a rejoin cannot revive old work", () => {
    expect(body).toContain("update public.agency_client_requests");
    expect(body).toContain("update public.agency_work_items");
    expect(count(body, "set assigned_member_user_id=null")).toBe(2);
  });

  it("never deletes historical delegation or audit rows", () => {
    expect(body).not.toContain("delete");
    expect(body).toContain("insert into public.agency_audit_log");
  });
});

// ---------------------------------------------------------------------------
describe("AM-1A E — continuous agency-delegation validity", () => {
  it("assistant_has_permission preserves the direct branch and gates the agency branch", () => {
    const body = fnBody("assistant_has_permission");
    expect(body).toContain("when da.agency_delegation_id is null");
    expect(body).toContain("then public.driver_has_active_pro(da.driver_user_id)");
    expect(body).toContain(
      "else public._agency_delegation_operationally_active(\n                 da.agency_delegation_id, da.assistant_user_id, da.driver_user_id)",
    );
    expect(body).toContain("da.status            = 'active'");
    expect(body).toContain("(da.permissions ->> _perm)::boolean, false) = true");
  });

  it("get_my_managed_drivers uses the identical branch semantics", () => {
    const body = fnBody("get_my_managed_drivers");
    expect(body).toContain("when da.agency_delegation_id is null");
    expect(body).toContain("then public.driver_has_active_pro(da.driver_user_id)");
    expect(body).toContain("public._agency_delegation_operationally_active(");
    expect(body).toContain("da.assistant_user_id = _uid");
  });

  it("replaces (never parallel-adds) the assistant SELECT policy and leaves the driver policy alone", () => {
    expect(exec).toContain("drop policy if exists driver_assistants_assistant_select on public.driver_assistants");
    const p = policyBody("driver_assistants_assistant_select");
    expect(p).toContain("auth.uid() = assistant_user_id");
    expect(p).toContain("agency_delegation_id is null");
    expect(p).toContain("public.current_user_can_use_agency_delegation(agency_delegation_id, driver_user_id)");
    expect(count(exec, "create policy driver_assistants_assistant_select")).toBe(1);
    expect(exec).not.toContain("driver_assistants_driver_select");
  });
});

// ---------------------------------------------------------------------------
describe("AM-1A F — target / assigned member lifecycle", () => {
  it("validates the target member on every positive assignment path", () => {
    for (const fn of [
      "create_agency_delegation_request",
      "driver_decide_delegation",
      "set_agency_client_request_status",
      "create_agency_work_item",
      "update_agency_work_item",
    ]) {
      expect(fnBody(fn)).toContain("public._agency_member_paid_operational_authority(");
    }
  });

  it("keeps the pre-existing active-membership checks alongside the new gate", () => {
    expect(count(exec, "must be an active agency member")).toBeGreaterThanOrEqual(3);
    expect(fnBody("driver_decide_delegation")).toContain("agency member is no longer active");
  });

  it("assigned-member self-update requires active membership, positive actions require paid authority", () => {
    const body = fnBody("update_agency_work_item");
    expect(body).toContain("if _is_assigned and not _is_admin then");
    expect(body).toContain("public.is_agency_member(_old.agency_id, _uid)");
    expect(body).toContain("_positive");
    expect(body).toContain("only agency owner/admin can reassign or rename");
  });

  it("tightens the three assigned-member SELECT policies without broadening RLS", () => {
    for (const [policy, table] of [
      ["acr_assigned_member_select", "agency_client_requests"],
      ["adr_member_select", "agency_delegation_requests"],
      ["awi_assigned_member_select", "agency_work_items"],
    ] as const) {
      expect(exec).toContain(`drop policy if exists ${policy} on public.${table}`);
      const p = policyBody(policy);
      expect(p).toContain("auth.uid()");
      expect(p).toContain("public.is_agency_member(agency_id, auth.uid())");
      expect(p).toContain("for select\n  to authenticated\n  using (");
      expect(count(exec, `create policy ${policy}`)).toBe(1);
    }
    // No mutation policies are introduced anywhere.
    expect(exec).not.toContain("for insert");
    expect(exec).not.toContain("for update\n  using");
    expect(exec).not.toContain("for delete");
    expect(exec).not.toContain("with check");
  });

  it("list_agency_work_items requires active membership on the assigned branch", () => {
    const body = fnBody("list_agency_work_items");
    expect(body).toContain("w.assigned_member_user_id = auth.uid()");
    expect(body).toContain("public.is_agency_member(_agency_id, auth.uid())");
    expect(body).toContain("public.is_agency_owner_or_admin(_agency_id, auth.uid())");
  });

  it("list_agency_clients is left unchanged (already active-membership scoped)", () => {
    expect(exec).not.toContain("create or replace function public.list_agency_clients(");
  });
});

// ---------------------------------------------------------------------------
describe("AM-1A G — settlement composition", () => {
  const body = fnBody("settlement_current_user_can_manage_agency");

  it("keeps the STRICTER settlement entitlement statuses (no past_due)", () => {
    expect(body).toContain("'active', 'trialing', 'manual_beta'");
    expect(body).not.toContain("past_due");
  });

  it("adds the member operational gate while preserving delegation permission checks", () => {
    expect(body).toContain("public._agency_member_paid_operational_authority(_agency_id, auth.uid())");
    expect(body).toContain("_permission in ('settlements_manage', 'settlements_finalize')");
    expect(body).toContain("(dr.requested_permissions -> _permission) = to_jsonb(true)");
    expect(body).toContain("recruiter_billing_profiles");
    expect(body).toContain("set search_path to 'pg_catalog', 'public', 'auth'");
  });
});

// ---------------------------------------------------------------------------
describe("AM-1A — replacement policy ROLE contract (tighten, never broaden)", () => {
  const REPLACEMENTS = [
    ["driver_assistants_assistant_select", "driver_assistants"],
    ["acr_assigned_member_select", "agency_client_requests"],
    ["adr_member_select", "agency_delegation_requests"],
    ["awi_assigned_member_select", "agency_work_items"],
  ] as const;

  it("every replacement policy is explicitly FOR SELECT TO authenticated", () => {
    for (const [policy, table] of REPLACEMENTS) {
      expect(exec).toContain(
        `create policy ${policy}\n  on public.${table}\n  for select\n  to authenticated\n  using (`,
      );
    }
  });

  it("no replacement policy omits its role clause (implicit PUBLIC)", () => {
    for (const [policy] of REPLACEMENTS) {
      const p = policyBody(policy);
      expect(p.indexOf("to authenticated")).toBeGreaterThan(-1);
      expect(p.indexOf("to authenticated")).toBeLessThan(p.indexOf("using ("));
    }
    // matches the production role scope of the policies being replaced
    expect(count(exec, "to authenticated\n  using (")).toBe(REPLACEMENTS.length);
    expect(count(exec, "create policy ")).toBe(REPLACEMENTS.length);
  });

  it("grants no policy role to public / anon / service_role", () => {
    for (const [policy] of REPLACEMENTS) {
      const p = policyBody(policy);
      expect(p).not.toContain("to public");
      expect(p).not.toContain("anon");
      expect(p).not.toContain("service_role");
      expect(p).not.toContain("to authenticated, ");
    }
  });
});
