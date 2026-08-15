/**
 * Phase RC-1A — Recruiter Workspace Membership Foundation.
 * Deterministic SQL contract test against the CANDIDATE migration text.
 * The migration is NOT applied live; this suite proves the authored contract.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const SQL_PATH = path.resolve(
  process.cwd(),
  "supabase/migration-candidates/20260815020500_phase_rc1a_recruiter_workspace_membership_foundation.sql",
);

const sql = readFileSync(SQL_PATH, "utf8");
const lower = sql.toLowerCase();

/**
 * Executable SQL only: `--` line comments stripped. Prohibited-scope assertions
 * run against THIS string so narrative comments can never create a false
 * positive (or false confidence) about what the migration actually does.
 */
const lowerExecutable = lower
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("Phase RC-1A — candidate migration envelope", () => {
  it("1. is marked as a candidate and is transactional", () => {
    expect(sql.split("\n")[0].trim()).toBe("-- CANDIDATE MIGRATION — NOT APPLIED LIVE.");
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });
});

describe("Phase RC-1A — enums and tables", () => {
  it("2a. creates dedicated recruiter enums via safe DO blocks", () => {
    expect(lower).toContain("create type public.recruiter_member_role as enum ('recruiter_owner', 'recruiter_admin', 'recruiter_staff')");
    expect(lower).toContain("create type public.recruiter_member_status as enum ('pending', 'active', 'revoked')");
    expect(lower).toContain("exception when duplicate_object then null");
  });

  it("2b. creates recruiter_members and recruiter_member_audit_log", () => {
    expect(lower).toContain("create table if not exists public.recruiter_members");
    expect(lower).toContain("create table if not exists public.recruiter_member_audit_log");
  });

  it("2c. does not repurpose agency_members or agency enums", () => {
    expect(lower).not.toContain("agency_members");
    expect(lower).not.toContain("agency_member_role");
    expect(lower).not.toContain("agency_member_status");
  });

  it("2d. wires the required foreign keys", () => {
    expect(lower).toContain("references public.recruiter_profiles(id) on delete cascade");
    expect(lower).toContain("references auth.users(id) on delete set null");
    expect(lower).toContain("references public.recruiter_members(id) on delete set null");
  });
});

describe("Phase RC-1A — owner bootstrap", () => {
  it("3a. backfills one active owner membership per existing recruiter profile", () => {
    expect(lower).toContain("insert into public.recruiter_members");
    expect(lower).toContain("'recruiter_owner'::public.recruiter_member_role");
    expect(lower).toContain("from public.recruiter_profiles rp");
    expect(lower).toContain("left join auth.users u on u.id = rp.user_id");
    expect(lower).toContain("coalesce(u.email::text, rp.recruiter_email)");
    expect(lower).toContain("'owner_bootstrapped'");
  });

  it("3a2. a preflight DO block raises when any recruiter owner email source is missing", () => {
    const preflight = lowerExecutable.slice(
      0,
      lowerExecutable.indexOf("with bootstrapped as ("),
    );
    expect(preflight).toContain("rc-1a owner bootstrap preflight failed");
    expect(preflight).toContain("raise exception");
    expect(preflight).toContain("from public.recruiter_profiles rp");
    expect(lowerExecutable).not.toContain("placeholder");
  });

  it("3a3. the backfill no longer silently filters out profiles without an email", () => {
    const backfill = lowerExecutable.slice(
      lowerExecutable.indexOf("with bootstrapped as ("),
      lowerExecutable.indexOf("create or replace function public.rc1a_bootstrap"),
    );
    expect(backfill).not.toContain("coalesce(u.email::text, rp.recruiter_email) is not null");
    expect(backfill).toContain("where not exists (");
  });

  it("3b. installs an AFTER INSERT trigger on recruiter_profiles", () => {
    expect(lower).toContain("after insert on public.recruiter_profiles");
    expect(lower).toContain("execute function public.rc1a_bootstrap_recruiter_owner_membership()");
  });

  it("3b2. the future-owner trigger raises instead of silently skipping a missing email", () => {
    const fn = lowerExecutable.slice(
      lowerExecutable.indexOf("create or replace function public.rc1a_bootstrap"),
      lowerExecutable.indexOf("drop trigger if exists rc1a_recruiter_profiles_owner_membership"),
    );
    expect(fn).toContain("if _email is null or _email = '' then");
    expect(fn).toMatch(/if _email is null or _email = '' then\s*\n\s*raise exception/);
    expect(fn).not.toMatch(/if _email is null or _email = '' then\s*\n\s*return new;/);
  });

  it("3c. trigger does not mutate recruiter_profiles fields", () => {
    expect(lowerExecutable).not.toMatch(/update\s+public\.recruiter_profiles/);
    expect(lowerExecutable).not.toMatch(/alter table\s+public\.recruiter_profiles/);
  });
});

describe("Phase RC-1A — invitation cryptography and lifecycle", () => {
  it("4a. issues a 24-byte random token stored only as a SHA-256 hex hash", () => {
    expect(lower).toContain("encode(gen_random_bytes(24), 'hex')");
    expect(lower).toContain("encode(digest(_raw_token, 'sha256'), 'hex')");
    expect(lower).toContain("encode(digest(btrim(_token), 'sha256'), 'hex')");
    expect(lower).not.toContain("'invite_token_hash', ");
  });

  it("4b. expires invites exactly 7 days after issuance", () => {
    expect(lower).toContain("now() + interval '7 days'");
    expect(lower).toContain("m.invite_expires_at > now()");
  });

  it("4c. requires exact invited-email ownership on accept", () => {
    expect(lower).toContain("lower(m.invite_email::text) = _email");
    expect(lower).toContain("from auth.users u where u.id = _uid");
  });

  it("4d. clears the token and expiry on accept and on revoke", () => {
    const clears = lower.match(/invite_token_hash = null,\s*\n\s*invite_expires_at = null/g) ?? [];
    expect(clears.length).toBeGreaterThanOrEqual(2);
  });

  it("4e. locks the invitation row so replay/races fail closed", () => {
    expect(lower).toContain("for update");
    expect(lower).toContain("and m.status = 'pending'");
  });

  it("4f. rotates a pending invite instead of duplicating it", () => {
    expect(lower).toContain("'invite_refreshed'");
    expect(lower).toContain("'invite_created'");
    expect(lower).toContain("already a member");
  });

  it("4g. returns only safe invite data, never the hash", () => {
    expect(lower).toContain("'invite_token', _raw_token");
    expect(lower).toMatch(/return jsonb_build_object\([\s\S]{0,400}'expires_at', _row\.invite_expires_at/);
    expect(lower).not.toContain("'token_hash'");
  });
});

describe("Phase RC-1A — roles, statuses, uniqueness invariants", () => {
  it("5a. defaults to recruiter_staff / pending", () => {
    expect(lower).toContain("default 'recruiter_staff'");
    expect(lower).toContain("default 'pending'");
  });

  it("5b. enforces the four uniqueness invariants with partial unique indexes", () => {
    expect(lower).toContain("create unique index if not exists recruiter_members_one_active_owner_idx");
    expect(lower).toContain("where role = 'recruiter_owner' and status = 'active'");
    expect(lower).toContain("create unique index if not exists recruiter_members_unique_active_user_idx");
    expect(lower).toContain("create unique index if not exists recruiter_members_unique_open_email_idx");
    expect(lower).toContain("where status in ('pending', 'active')");
    expect(lower).toContain("create unique index if not exists recruiter_members_unique_token_hash_idx");
    expect(lower).toContain("where invite_token_hash is not null");
  });

  it("5c. does not invent a global one-workspace-per-user restriction", () => {
    expect(lower).not.toMatch(/create unique index[^;]*\(member_user_id\)\s*(where|;)/);
  });
});

describe("Phase RC-1A — owner-only invite/revoke authority", () => {
  it("6a. invite is restricted to the canonical recruiter owner", () => {
    const fn = lower.slice(lower.indexOf("function public.invite_recruiter_member"));
    expect(fn).toContain("where rp.id = _recruiter_id and rp.user_id = _uid");
    expect(fn).toContain("'not authorized'");
    expect(fn).toContain("authentication required");
  });

  it("6b. invite rejects the recruiter_owner role and the owner's own email", () => {
    expect(lower).toContain("_role = 'recruiter_owner'");
    expect(lower).toContain("cannot invite the workspace owner");
  });

  it("6c. revoke is owner-only and can never revoke the owner membership", () => {
    const fn = lower.slice(lower.indexOf("function public.revoke_recruiter_member"));
    expect(fn).toContain("rp.user_id = _uid");
    expect(fn).toContain("m.role <> 'recruiter_owner'");
    expect(fn).toContain("m.status in ('pending', 'active')");
    expect(fn).toContain("status = 'revoked'");
    expect(fn).toContain("revoked_by_user_id = _uid");
  });

  it("6d. no RC-1A path grants recruiter_admin invite authority", () => {
    const fn = lower.slice(lower.indexOf("function public.invite_recruiter_member"));
    expect(fn).not.toContain("role = 'recruiter_admin'");
  });
});

describe("Phase RC-1A — read RPC contracts", () => {
  it("7. get_my_recruiter_workspaces returns many rows and no LIMIT 1", () => {
    const fn = lower.slice(
      lower.indexOf("function public.get_my_recruiter_workspaces"),
      lower.indexOf("function public.list_recruiter_members"),
    );
    expect(fn).toContain("returns table");
    expect(fn).toContain("membership_id uuid");
    expect(fn).toContain("owner_user_id uuid");
    expect(fn).toContain("member_since timestamptz");
    expect(fn).toContain("m.member_user_id = auth.uid()");
    expect(fn).toContain("m.status = 'active'");
    expect(fn).not.toContain("limit 1");
    expect(fn).not.toContain("stripe");
  });

  it("8. list_recruiter_members is owner-all / member-self-only and hides the token hash", () => {
    const fn = lower.slice(
      lower.indexOf("function public.list_recruiter_members"),
      lower.indexOf("function public.invite_recruiter_member"),
    );
    expect(fn).toContain("from public.recruiter_profiles rp");
    expect(fn).toContain("rp.user_id = auth.uid()");
    expect(fn).toContain("m.member_user_id = auth.uid()");
    expect(fn).toContain("m.status = 'active'");
    expect(fn).not.toContain("invite_token_hash");
  });

  it("8b. is_recruiter_workspace_member is active-membership identity only", () => {
    const fn = lower.slice(
      lower.indexOf("function public.is_recruiter_workspace_member"),
      lower.indexOf("function public.get_my_recruiter_workspaces"),
    );
    expect(fn).toContain("m.status = 'active'");
    expect(fn).toContain("security definer");
  });

  it("8c. every new function pins search_path", () => {
    const defs = sql.match(/CREATE OR REPLACE FUNCTION public\./g) ?? [];
    const pins = sql.match(/SET search_path = public/g) ?? [];
    expect(defs.length).toBeGreaterThanOrEqual(7);
    expect(pins.length).toBe(defs.length);
  });
});

describe("Phase RC-1A — RLS, grants, audit", () => {
  it("9a. enables RLS on both new tables", () => {
    expect(lower).toContain("alter table public.recruiter_members enable row level security");
    expect(lower).toContain("alter table public.recruiter_member_audit_log enable row level security");
  });

  it("9b. revokes direct mutation and grants only SELECT to authenticated", () => {
    expect(lower).toContain("revoke all on public.recruiter_members from anon, authenticated");
    expect(lower).toContain("revoke all on public.recruiter_member_audit_log from anon, authenticated");
    expect(lower).toContain("grant select on public.recruiter_members to authenticated");
    expect(lower).toContain("grant select on public.recruiter_member_audit_log to authenticated");
    expect(lower).not.toMatch(/grant[^;]*(insert|update|delete)[^;]*on public\.recruiter_members to (anon|authenticated)/);
    expect(lower).not.toMatch(/grant[^;]*(insert|update|delete)[^;]*on public\.recruiter_member_audit_log to (anon|authenticated)/);
  });

  it("9c. defines SELECT-only policies for both tables", () => {
    const policies = lower.match(/create policy[\s\S]*?using \(/g) ?? [];
    expect(policies.length).toBe(3);
    expect(lower).not.toMatch(/create policy[^;]*for (insert|update|delete)/);
    expect(lower).not.toContain("with check");
  });

  it("9d. revokes PUBLIC/anon execute and grants only authenticated execute", () => {
    expect(lower).toContain("revoke all on function public.rc1a_bootstrap_recruiter_owner_membership() from public, anon, authenticated");
    const revokes = lower.match(/revoke all on function public\./g) ?? [];
    expect(revokes.length).toBeGreaterThanOrEqual(7);
    const grants = lower.match(/grant execute on function public\.[^;]*to authenticated/g) ?? [];
    expect(grants.length).toBe(6);
    expect(lower).not.toMatch(/grant execute on function[^;]*to anon/);
  });

  it("10. audit table allowlists exactly five event types and every lifecycle path writes one", () => {
    expect(lower).toContain("check (event_type in (");
    for (const evt of [
      "owner_bootstrapped",
      "invite_created",
      "invite_refreshed",
      "invite_accepted",
      "member_revoked",
    ]) {
      expect(lower).toContain(`'${evt}'`);
    }
    const writes = lower.match(/insert into public\.recruiter_member_audit_log/g) ?? [];
    expect(writes.length).toBeGreaterThanOrEqual(6);
  });
});

describe("Phase RC-1A — prohibited scope", () => {
  const FORBIDDEN_FUNCTIONS = [
    "current_user_can_manage_recruiter_opportunities",
    "list_recruiter_applications_safe",
    "list_recruiter_application_summaries",
    "effective_recruiter_tier",
    "effective_recruiter_active_opportunity_limit",
  ];

  it("11. does not create, replace, alter, or drop existing recruiter operational functions", () => {
    for (const fn of FORBIDDEN_FUNCTIONS) {
      expect(lower).not.toContain(fn);
    }
  });

  it("12a. contains no Stripe/billing/subscription changes", () => {
    for (const token of ["stripe", "subscriptions", "checkout", "price_id", "entitlement"]) {
      expect(lower).not.toContain(token);
    }
  });

  it("12b. touches no agency, assistant, settlement, opportunity, or application objects", () => {
    for (const token of [
      "public.agency_",
      "driver_assistants",
      "assistant_has_permission",
      "driver_settlements",
      "public.opportunities",
      "opportunity_applications",
    ]) {
      expect(lower).not.toContain(token);
    }
  });

  it("12c. only the two new tables are created and none are dropped", () => {
    const created = lower.match(/create table if not exists public\.(\w+)/g) ?? [];
    expect(created.sort()).toEqual([
      "create table if not exists public.recruiter_member_audit_log",
      "create table if not exists public.recruiter_members",
    ]);
    expect(lower).not.toMatch(/drop table/);
  });
});
