/**
 * Phase RC-1B — Recruiter Staff Permission Resolver & Authorization Contract.
 * Deterministic SQL/source contract test against the CANDIDATE migration text
 * and the pure TypeScript mirror. The migration is NOT applied live.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  RECRUITER_STAFF_PERMISSION_KEYS,
  RECRUITER_STAFF_PERMISSION_LABELS,
  RECRUITER_OWNER_ONLY_AREAS,
  hasRecruiterStaffPermission,
  type RecruiterStaffPermissionKey,
} from "@/lib/recruiterStaffPermissions";

const SQL_PATH = path.resolve(
  process.cwd(),
  "supabase/migration-candidates/20260815025500_phase_rc1b_recruiter_staff_permission_contract.sql",
);
const TS_PATH = path.resolve(process.cwd(), "src/lib/recruiterStaffPermissions.ts");

const sql = readFileSync(SQL_PATH, "utf8");
const lower = sql.toLowerCase();
const tsSource = readFileSync(TS_PATH, "utf8");

/** Executable SQL only: `--` line comments stripped. */
const lowerExecutable = lower
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

const EXPECTED_KEYS = [
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
];

function functionSlice(name: string): string {
  const start = lowerExecutable.indexOf(`create or replace function public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const rest = lowerExecutable.slice(start);
  const end = rest.indexOf("\n$$;");
  return end === -1 ? rest : rest.slice(0, end + 4);
}

describe("RC-1B — candidate envelope", () => {
  it("1. is marked as a candidate and is transactional", () => {
    expect(sql.split("\n")[0].trim()).toBe("-- CANDIDATE MIGRATION — NOT APPLIED LIVE.");
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });
});

describe("RC-1B — permission vocabulary", () => {
  it("2a. creates the enum via a safe duplicate-object DO block", () => {
    expect(lowerExecutable).toContain("create type public.recruiter_workspace_permission as enum");
    expect(lowerExecutable).toContain("exception when duplicate_object then null");
  });

  it("2b. declares exactly the 21 expected enum keys in order", () => {
    const start = lowerExecutable.indexOf("create type public.recruiter_workspace_permission as enum");
    const block = lowerExecutable.slice(start, lowerExecutable.indexOf(");", start));
    const found = Array.from(block.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
    expect(found).toEqual(EXPECTED_KEYS);
  });

  it("2c. TypeScript mirror matches the enum keys exactly and in order", () => {
    expect([...RECRUITER_STAFF_PERMISSION_KEYS]).toEqual(EXPECTED_KEYS);
    expect(new Set(RECRUITER_STAFF_PERMISSION_KEYS).size).toBe(21);
  });

  it("2d. every key has a concise label", () => {
    for (const key of RECRUITER_STAFF_PERMISSION_KEYS) {
      expect(RECRUITER_STAFF_PERMISSION_LABELS[key].length).toBeGreaterThan(0);
    }
    expect(Object.keys(RECRUITER_STAFF_PERMISSION_LABELS).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it("2e. owner-only areas are listed and are not permission keys", () => {
    for (const area of [
      "billing",
      "subscription",
      "account_deletion",
      "company_identity",
      "posting_terms",
      "verification_moderation",
      "platform_role_changes",
    ]) {
      expect(RECRUITER_OWNER_ONLY_AREAS).toContain(area as never);
      expect(EXPECTED_KEYS).not.toContain(area);
    }
  });

  it("2f. hasRecruiterStaffPermission requires exact boolean true", () => {
    expect(hasRecruiterStaffPermission({ reports_view: true }, "reports_view")).toBe(true);
    expect(hasRecruiterStaffPermission({ reports_view: false }, "reports_view")).toBe(false);
    expect(hasRecruiterStaffPermission({}, "reports_view")).toBe(false);
    expect(hasRecruiterStaffPermission(null, "reports_view")).toBe(false);
    expect(hasRecruiterStaffPermission(undefined, "reports_view")).toBe(false);
    expect(
      hasRecruiterStaffPermission({ reports_view: "true" } as unknown as Record<RecruiterStaffPermissionKey, boolean>, "reports_view"),
    ).toBe(false);
  });

  it("2g. TS mirror is pure: no React/Supabase imports and no role presets", () => {
    expect(tsSource).not.toMatch(/^\s*import\s/m);
    expect(tsSource).not.toMatch(/from\s+["'][^"']*(react|supabase)/i);
    expect(tsSource).not.toMatch(/recruiter_admin|recruiter_staff|ROLE_PRESET/);
  });
});

describe("RC-1B — membership permission storage", () => {
  it("3. adds a jsonb permissions column defaulting to an object with an object CHECK", () => {
    expect(lowerExecutable).toContain(
      "add column if not exists permissions jsonb not null default '{}'::jsonb",
    );
    expect(lowerExecutable).toContain("jsonb_typeof(permissions) = 'object'");
    expect(lowerExecutable).toContain("recruiter_members_permissions_object_check");
  });
});

describe("RC-1B — audit event allowlist", () => {
  it("4. preserves the five RC-1A events and adds only permissions_updated", () => {
    expect(lowerExecutable).toContain(
      "drop constraint if exists recruiter_member_audit_log_event_type_check",
    );
    const start = lowerExecutable.indexOf("add constraint recruiter_member_audit_log_event_type_check");
    const block = lowerExecutable.slice(start, lowerExecutable.indexOf("));", start));
    const events = Array.from(block.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
    expect(events).toEqual([
      "owner_bootstrapped",
      "invite_created",
      "invite_refreshed",
      "invite_accepted",
      "member_revoked",
      "permissions_updated",
    ]);
  });
});

describe("RC-1B — resolver contract", () => {
  const fn = () => functionSlice("current_user_has_recruiter_permission");

  it("5a. is STABLE SECURITY DEFINER with pinned search_path", () => {
    const body = fn();
    expect(body).toContain("stable");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public");
  });

  it("5b. is auth.uid()-scoped and takes no user-id argument", () => {
    const body = fn();
    expect(body).toContain("auth.uid() is not null");
    expect(body).toMatch(/current_user_has_recruiter_permission\(\s*\n?\s*_recruiter_id uuid,\s*\n?\s*_permission public\.recruiter_workspace_permission\s*\n?\s*\)/);
    expect(body).not.toContain("_uid uuid");
  });

  it("5c. fails closed on null args", () => {
    const body = fn();
    expect(body).toContain("_recruiter_id is not null");
    expect(body).toContain("_permission is not null");
  });

  it("5d. grants owner everything and requires explicit json true otherwise", () => {
    const body = fn();
    expect(body).toContain("public.is_recruiter_workspace_owner(_recruiter_id)");
    expect(body).toContain("m.status = 'active'");
    expect(body).toContain("to_jsonb(true)");
  });

  it("5e. has no role shortcut", () => {
    const body = fn();
    expect(body).not.toContain("recruiter_admin");
    expect(body).not.toContain("recruiter_staff");
    expect(body).not.toContain("m.role");
  });

  it("5f. pending/revoked memberships cannot resolve true", () => {
    const body = fn();
    expect(body).not.toContain("'pending'");
    expect(body).not.toContain("'revoked'");
  });
});

describe("RC-1B — get_my_recruiter_permissions", () => {
  const fn = () => functionSlice("get_my_recruiter_permissions");

  it("6a. is STABLE SECURITY DEFINER with pinned search_path", () => {
    const body = fn();
    expect(body).toContain("stable");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public");
  });

  it("6b. raises 42501 for unauthorized callers", () => {
    const body = fn();
    expect(body).toContain("42501");
    expect((body.match(/not authorized/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("6c. enumerates every enum key and resolves through the resolver", () => {
    const body = fn();
    expect(body).toContain("enum_range(null::public.recruiter_workspace_permission)");
    expect(body).toContain("public.current_user_has_recruiter_permission(_recruiter_id, _key)");
  });

  it("6d. requires owner or ACTIVE membership only", () => {
    const body = fn();
    expect(body).toContain("public.is_recruiter_workspace_owner(_recruiter_id)");
    expect(body).toContain("m.status = 'active'");
  });
});

describe("RC-1B — set_recruiter_member_permissions", () => {
  const fn = () => functionSlice("set_recruiter_member_permissions");

  it("7a. is SECURITY DEFINER with pinned search_path and requires auth", () => {
    const body = fn();
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public");
    expect(body).toContain("authentication required");
  });

  it("7b. is canonical-owner-only and never uses team_manage/admin role", () => {
    const body = fn();
    expect(body).toContain("public.is_recruiter_workspace_owner(m.recruiter_id)");
    expect(body).not.toContain("team_manage");
    expect(body).not.toContain("recruiter_admin");
  });

  it("7c. refuses owner targets and revoked targets", () => {
    const body = fn();
    expect(body).toContain("m.role <> 'recruiter_owner'");
    expect(body).toContain("m.status in ('pending', 'active')");
    expect(body).not.toContain("'revoked'");
  });

  it("7d. rejects non-object payloads, unknown keys and non-boolean values", () => {
    const body = fn();
    expect(body).toContain("jsonb_typeof(_permissions) <> 'object'");
    expect(body).toContain("unknown permission key");
    expect(body).toContain("permission value must be boolean");
    expect(body).toContain("enum_range(null::public.recruiter_workspace_permission)");
  });

  it("7e. updates updated_at and writes one permissions_updated audit row with before/after", () => {
    const body = fn();
    expect(body).toContain("updated_at = now()");
    expect(body).toContain("'permissions_updated'");
    expect(body).toContain("'previous_permissions'");
    expect(body).toContain("'new_permissions'");
  });

  it("7f. returns a safe payload with no token or hash", () => {
    const body = fn();
    expect(body).toContain("'membership_id'");
    expect(body).toContain("'recruiter_id'");
    expect(body).toContain("'role'");
    expect(body).toContain("'status'");
    expect(body).toContain("'permissions'");
    expect(body).toContain("'updated_at'");
    expect(body).not.toContain("invite_token_hash");
    expect(body).not.toContain("_raw_token");
  });
});

describe("RC-1B — privileges", () => {
  it("8. revokes PUBLIC/anon and grants authenticated on all three new RPCs", () => {
    for (const signature of [
      "public.current_user_has_recruiter_permission(uuid, public.recruiter_workspace_permission)",
      "public.get_my_recruiter_permissions(uuid)",
      "public.set_recruiter_member_permissions(uuid, jsonb)",
    ]) {
      expect(lowerExecutable).toContain(`revoke all on function ${signature} from public, anon`);
      expect(lowerExecutable).toContain(`grant execute on function ${signature} to authenticated`);
    }
  });

  it("8b. does not change RLS policies or table grants", () => {
    expect(lowerExecutable).not.toContain("create policy");
    expect(lowerExecutable).not.toContain("drop policy");
    expect(lowerExecutable).not.toContain("enable row level security");
    expect(lowerExecutable).not.toMatch(/grant\s+(select|insert|update|delete|all)\s+on\s+public\./);
  });
});

describe("RC-1B — prohibited scope", () => {
  const forbidden = [
    "current_user_can_manage_recruiter_opportunities",
    "list_recruiter_applications_safe",
    "list_recruiter_application_summaries",
    "opportunity_applications",
    "opportunities",
    "recruiter_referral_settings",
    "contracts",
    "driver_settlements",
    "settlement_finalize_draft",
    "stripe",
    "subscriptions",
    "billing",
    "checkout",
    "entitlement",
    "agency",
    "driver_assistants",
    "user_capabilities",
  ];

  /**
   * Permission-vocabulary literals (e.g. 'opportunities_view', 'contracts_view')
   * are inert enum labels, not references to operational objects. Strip them
   * (and the TS-mirror-free label text) before scanning, so the scan proves
   * absence of real object references rather than tripping on the vocabulary.
   */
  const scopeSql = EXPECTED_KEYS.reduce(
    (acc, key) => acc.split(key).join("«perm»"),
    lowerExecutable,
  );

  it("9. executable SQL references no operational/billing/agency object", () => {
    for (const token of forbidden) {
      expect(scopeSql).not.toContain(token);
    }
  });

  it("9b. executable SQL contains no UI/route references", () => {
    expect(lowerExecutable).not.toMatch(/https?:\/\//);
    expect(lowerExecutable).not.toContain("/recruiter/");
  });

  it("10. RC-1A lifecycle objects are not dropped or replaced (audit CHECK only)", () => {
    for (const token of [
      "drop table",
      "drop function",
      "drop trigger",
      "drop type",
      "drop index",
    ]) {
      expect(lowerExecutable).not.toContain(token);
    }
    const dropConstraints = Array.from(
      lowerExecutable.matchAll(/drop constraint if exists ([a-z_]+)/g),
    ).map((m) => m[1]);
    expect(dropConstraints).toEqual(["recruiter_member_audit_log_event_type_check"]);
    for (const fn of [
      "invite_recruiter_member",
      "accept_recruiter_member_invite",
      "revoke_recruiter_member",
      "list_recruiter_members",
      "get_my_recruiter_workspaces",
      "is_recruiter_workspace_member",
    ]) {
      expect(lowerExecutable).not.toContain(`create or replace function public.${fn}`);
    }
  });
});
