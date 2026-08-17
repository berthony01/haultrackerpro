/**
 * Phase AM-1B — Agency Workspace Permission Contract.
 * Deterministic SQL/source contract test against the CANDIDATE migration text
 * and the pure TypeScript mirror. The migration is NOT applied live.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  AGENCY_WORKSPACE_PERMISSION_KEYS,
  AGENCY_WORKSPACE_PERMISSION_LABELS,
  AGENCY_OWNER_ONLY_AREAS,
  hasAgencyWorkspacePermission,
  parseAgencyWorkspacePermissions,
  emptyAgencyWorkspacePermissions,
  type AgencyWorkspacePermissionKey,
} from "@/lib/agencyWorkspacePermissions";

const START_GATE = "6c7f3c4005ef60e70fd6e2dd531ed912d7bb20fa";

const SQL_PATH = path.resolve(
  process.cwd(),
  "supabase/migration-candidates/20260817033000_phase_am1b_agency_workspace_permission_contract.sql",
);
const TS_PATH = path.resolve(process.cwd(), "src/lib/agencyWorkspacePermissions.ts");

const sql = readFileSync(SQL_PATH, "utf8");
const lower = sql.toLowerCase();
const tsSource = readFileSync(TS_PATH, "utf8");

/** Executable SQL only: `--` line comments stripped. */
const lowerExecutable = lower
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

const EXPECTED_KEYS = [
  "packages_view",
  "packages_manage",
  "client_requests_view",
  "client_requests_manage",
  "clients_view",
  "delegations_view",
  "delegations_manage",
  "work_items_view_all",
  "work_items_manage",
  "audit_view",
  "team_view",
];

const AM1B_AUTHORED_FILES = [
  "src/lib/agencyWorkspacePermissions.ts",
  "src/test/phaseAM1BAgencyWorkspacePermissionContract.test.ts",
  "supabase/migration-candidates/20260817033000_phase_am1b_agency_workspace_permission_contract.sql",
];

/** Platform-owned artifacts that may be auto-regenerated outside AM-1B authorship. */
const PLATFORM_GENERATED_FILES = ["src/integrations/supabase/types.ts"];

function functionSlice(name: string): string {
  const start = lowerExecutable.indexOf(`create or replace function public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const rest = lowerExecutable.slice(start);
  const end = rest.indexOf("\n$$;");
  return end === -1 ? rest : rest.slice(0, end + 4);
}

describe("AM-1B — candidate envelope", () => {
  it("1. is marked as a candidate and is one explicit transaction", () => {
    expect(sql.split("\n")[0].trim()).toBe("-- CANDIDATE MIGRATION — NOT APPLIED LIVE.");
    expect((sql.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((sql.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
    expect(sql.indexOf("\nBEGIN;")).toBeLessThan(sql.indexOf("\nCOMMIT;"));
  });

  it("2. changes exactly the three AM-1B authored files since the start gate", () => {
    const out = execFileSync("git", ["diff", "--name-only", `${START_GATE}..HEAD`], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    const status = execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    const changed = new Set(
      [
        ...out.split("\n"),
        ...status.split("\n").map((l) => l.slice(3)),
      ]
        .map((l) => l.trim())
        .filter(Boolean),
    );
    const authored = [...changed].filter((f) => !PLATFORM_GENERATED_FILES.includes(f));
    expect(authored.sort()).toEqual([...AM1B_AUTHORED_FILES].sort());
  });
});

describe("AM-1B — permission vocabulary", () => {
  it("3a. creates the enum via a safe duplicate-object DO block", () => {
    expect(lowerExecutable).toContain("create type public.agency_workspace_permission as enum");
    expect(lowerExecutable).toContain("exception when duplicate_object then null");
  });

  it("3b. declares exactly the 11 expected enum keys in order", () => {
    const start = lowerExecutable.indexOf("create type public.agency_workspace_permission as enum");
    const block = lowerExecutable.slice(start, lowerExecutable.indexOf(");", start));
    const found = Array.from(block.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
    expect(found).toEqual(EXPECTED_KEYS);
  });

  it("3c. TypeScript mirror matches the enum keys exactly and in order", () => {
    expect([...AGENCY_WORKSPACE_PERMISSION_KEYS]).toEqual(EXPECTED_KEYS);
    expect(new Set(AGENCY_WORKSPACE_PERMISSION_KEYS).size).toBe(11);
  });

  it("3d. does not introduce team_manage or settlement permissions", () => {
    expect(EXPECTED_KEYS).not.toContain("team_manage");
    expect(lowerExecutable).not.toContain("'team_manage'");
    expect(lowerExecutable).not.toContain("settlement");
  });
});

describe("AM-1B — membership permission storage", () => {
  it("4. adds a jsonb column defaulting to an object with an object CHECK", () => {
    expect(lowerExecutable).toContain(
      "add column if not exists workspace_permissions jsonb not null default '{}'::jsonb",
    );
    expect(lowerExecutable).toContain("jsonb_typeof(workspace_permissions) = 'object'");
    expect(lowerExecutable).toContain("agency_members_workspace_permissions_object_chk");
  });

  it("4b. performs no role-based backfill", () => {
    expect(lowerExecutable).not.toMatch(/update\s+public\.agency_members/);
    expect(lowerExecutable).not.toContain("'agency_admin'");
  });
});

describe("AM-1B — resolver contract", () => {
  const fn = () => functionSlice("current_user_has_agency_permission");

  it("5a. is STABLE SECURITY DEFINER with pinned search_path", () => {
    const body = fn();
    expect(body).toContain("stable");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public");
  });

  it("5b. is auth.uid()-scoped and takes no user-id argument", () => {
    const body = fn();
    expect(body).toContain("auth.uid() is not null");
    expect(body).toMatch(
      /current_user_has_agency_permission\(\s*\n?\s*_agency_id uuid,\s*\n?\s*_permission public\.agency_workspace_permission\s*\n?\s*\)/,
    );
    expect(body).not.toContain("_uid uuid");
  });

  it("5c. fails closed on null args", () => {
    const body = fn();
    expect(body).toContain("_agency_id is not null");
    expect(body).toContain("_permission is not null");
  });

  it("5d. grants canonical owner everything and requires explicit json true otherwise", () => {
    const body = fn();
    expect(body).toContain("ap.owner_user_id = auth.uid()");
    expect(body).toContain("m.status = 'active'");
    expect(body).toContain("to_jsonb(true)");
  });

  it("5e. has no role shortcut and no pending/revoked branch", () => {
    const body = fn();
    expect(body).not.toContain("agency_admin");
    expect(body).not.toContain("agency_member'");
    expect(body).not.toContain("m.role");
    expect(body).not.toContain("'pending'");
    expect(body).not.toContain("'revoked'");
  });

  it("5f. composes no billing/delegation/assistant/settlement authority", () => {
    const body = fn();
    for (const token of [
      "_agency_member_paid_operational_authority",
      "_agency_delegation_operationally_active",
      "assistant_has_permission",
      "driver_assistants",
      "agency_entitlements",
      "subscriptions",
      "settlement",
      "is_agency_owner_or_admin",
    ]) {
      expect(body).not.toContain(token);
    }
  });
});

describe("AM-1B — get_my_agency_permissions", () => {
  const fn = () => functionSlice("get_my_agency_permissions");

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
    expect(body).toContain("enum_range(null::public.agency_workspace_permission)");
    expect(body).toContain("public.current_user_has_agency_permission(_agency_id, _key)");
  });

  it("6d. requires canonical owner or ACTIVE membership only", () => {
    const body = fn();
    expect(body).toContain("ap.owner_user_id = _uid");
    expect(body).toContain("m.status = 'active'");
  });
});

describe("AM-1B — set_agency_member_permissions", () => {
  const fn = () => functionSlice("set_agency_member_permissions");

  it("7a. is SECURITY DEFINER with pinned search_path and requires auth", () => {
    const body = fn();
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public");
    expect(body).toContain("authentication required");
  });

  it("7b. is canonical-owner-only and never uses role/permission shortcuts", () => {
    const body = fn();
    expect(body).toContain("ap.owner_user_id = _uid");
    expect(body).not.toContain("agency_admin");
    expect(body).not.toContain("team_view");
    expect(body).not.toContain("is_agency_owner_or_admin");
  });

  it("7c. refuses owner targets and revoked targets", () => {
    const body = fn();
    expect(body).toContain("m.role <> 'agency_owner'");
    expect(body).toContain("m.status in ('pending', 'active')");
    expect(body).not.toContain("'revoked'");
  });

  it("7d. rejects non-object payloads, unknown keys and non-boolean values", () => {
    const body = fn();
    expect(body).toContain("jsonb_typeof(_permissions) <> 'object'");
    expect(body).toContain("unknown permission key");
    expect(body).toContain("permission value must be boolean");
    expect(body).toContain("enum_range(null::public.agency_workspace_permission)");
  });

  it("7e. updates updated_at and writes one permissions_updated audit row with before/after", () => {
    const body = fn();
    expect(body).toContain("updated_at = now()");
    expect(body).toContain("'agency_member_permissions_updated'");
    expect(body).toContain("'agency_member'");
    expect(body).toContain("'previous_permissions'");
    expect(body).toContain("'new_permissions'");
    expect(body).toContain("'role'");
    expect(body).toContain("'status'");
    expect((body.match(/insert into public\.agency_audit_log/g) ?? []).length).toBe(1);
  });

  it("7f. returns a safe payload with no token or hash", () => {
    const body = fn();
    expect(body).toContain("'membership_id'");
    expect(body).toContain("'agency_id'");
    expect(body).toContain("'workspace_permissions'");
    expect(body).toContain("'updated_at'");
    expect(body).not.toContain("invite_token");
    expect(body).not.toContain("_raw_token");
  });
});

describe("AM-1B — privileges", () => {
  it("8. revokes PUBLIC/anon and grants authenticated + service_role on all three RPCs", () => {
    for (const signature of [
      "public.current_user_has_agency_permission(uuid, public.agency_workspace_permission)",
      "public.get_my_agency_permissions(uuid)",
      "public.set_agency_member_permissions(uuid, jsonb)",
    ]) {
      expect(lowerExecutable).toContain(`revoke all on function ${signature} from public, anon`);
      expect(lowerExecutable).toContain(
        `grant execute on function ${signature} to authenticated, service_role`,
      );
    }
  });

  it("9. does not change RLS policies or table grants", () => {
    expect(lowerExecutable).not.toContain("create policy");
    expect(lowerExecutable).not.toContain("drop policy");
    expect(lowerExecutable).not.toContain("enable row level security");
    expect(lowerExecutable).not.toMatch(/grant\s+(select|insert|update|delete|all)\s+on\s+public\./);
  });
});

describe("AM-1B — prohibited scope", () => {
  const forbiddenConsumers = [
    "is_agency_owner_or_admin",
    "create_agency_package",
    "update_agency_package",
    "list_agency_client_requests",
    "set_agency_client_request_status",
    "list_agency_clients",
    "list_agency_delegations",
    "create_agency_delegation_request",
    "revoke_agency_delegation",
    "create_agency_work_item",
    "update_agency_work_item",
    "list_agency_work_items",
    "list_agency_audit_log",
    "invite_agency_member",
    "accept_agency_invite",
    "revoke_agency_member",
    "assert_agency_limit",
  ];

  it("10. replaces no existing Agency authorization consumer function", () => {
    for (const name of forbiddenConsumers) {
      expect(lowerExecutable).not.toContain(`create or replace function public.${name}`);
      expect(lowerExecutable).not.toContain(`drop function`);
    }
  });

  it("11. touches no Driver Assistant or recruiter permission objects", () => {
    for (const token of [
      "manage_loads",
      "manage_expenses",
      "manage_fuel",
      "view_reports",
      "driver_assistants",
      "assistant_has_permission",
      "recruiter_workspace_permission",
      "recruiter_members",
      "current_user_has_recruiter_permission",
    ]) {
      expect(lowerExecutable).not.toContain(token);
    }
  });

  it("12. touches no Stripe/billing/checkout/entitlement/plan object", () => {
    for (const token of [
      "stripe",
      "checkout",
      "subscriptions",
      "agency_entitlements",
      "_agency_plan_defaults",
      "_agency_plan_label",
      "user_capabilities",
      "price",
    ]) {
      expect(lowerExecutable).not.toContain(token);
    }
  });

  it("13. contains no UI/route references", () => {
    expect(lowerExecutable).not.toMatch(/https?:\/\//);
    expect(lowerExecutable).not.toContain("/agency/");
  });
});

describe("AM-1B — TypeScript mirror", () => {
  it("14a. is pure: no imports, no React/Supabase, no role presets", () => {
    expect(tsSource).not.toMatch(/^\s*import\s/m);
    expect(tsSource).not.toMatch(/from\s+["'][^"']*(react|supabase)/i);
    expect(tsSource).not.toMatch(/agency_admin|agency_member\b|ROLE_PRESET/);
  });

  it("14b. every key has a concise label", () => {
    for (const key of AGENCY_WORKSPACE_PERMISSION_KEYS) {
      expect(AGENCY_WORKSPACE_PERMISSION_LABELS[key].length).toBeGreaterThan(0);
    }
    expect(Object.keys(AGENCY_WORKSPACE_PERMISSION_LABELS).sort()).toEqual(
      [...EXPECTED_KEYS].sort(),
    );
  });

  it("14c. owner-only areas are exact and are not permission keys", () => {
    expect([...AGENCY_OWNER_ONLY_AREAS]).toEqual([
      "billing",
      "subscription",
      "plan_and_limits",
      "agency_identity",
      "agency_slug_private_request_link",
      "member_invitation",
      "member_revocation",
      "permission_assignment",
      "account_deletion",
      "ownership_transfer",
      "platform_role_changes",
    ]);
    for (const area of AGENCY_OWNER_ONLY_AREAS) {
      expect(EXPECTED_KEYS).not.toContain(area);
    }
  });

  it("14d. hasAgencyWorkspacePermission requires exact boolean true", () => {
    expect(hasAgencyWorkspacePermission({ team_view: true }, "team_view")).toBe(true);
    expect(hasAgencyWorkspacePermission({ team_view: false }, "team_view")).toBe(false);
    expect(hasAgencyWorkspacePermission({}, "team_view")).toBe(false);
    expect(hasAgencyWorkspacePermission(null, "team_view")).toBe(false);
    expect(hasAgencyWorkspacePermission(undefined, "team_view")).toBe(false);
    expect(
      hasAgencyWorkspacePermission(
        { team_view: "true" } as unknown as Record<AgencyWorkspacePermissionKey, boolean>,
        "team_view",
      ),
    ).toBe(false);
  });

  it("14e. parser accepts only a complete, exact, all-boolean plain object", () => {
    const complete = emptyAgencyWorkspacePermissions();
    expect(parseAgencyWorkspacePermissions(complete)).toEqual(complete);

    expect(parseAgencyWorkspacePermissions(null)).toBeNull();
    expect(parseAgencyWorkspacePermissions(undefined)).toBeNull();
    expect(parseAgencyWorkspacePermissions([])).toBeNull();
    expect(parseAgencyWorkspacePermissions("{}")).toBeNull();
    expect(parseAgencyWorkspacePermissions({})).toBeNull();

    const missing = { ...complete } as Record<string, unknown>;
    delete missing.team_view;
    expect(parseAgencyWorkspacePermissions(missing)).toBeNull();

    expect(parseAgencyWorkspacePermissions({ ...complete, extra_key: true })).toBeNull();
    expect(parseAgencyWorkspacePermissions({ ...complete, team_view: "true" })).toBeNull();

    const proto = Object.create({ team_view: true });
    Object.assign(proto, complete);
    expect(parseAgencyWorkspacePermissions(proto)).toBeNull();
  });

  it("14f. emptyAgencyWorkspacePermissions returns all 11 false", () => {
    const empty = emptyAgencyWorkspacePermissions();
    expect(Object.keys(empty).sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(Object.values(empty).every((v) => v === false)).toBe(true);
  });
});
