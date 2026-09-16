/**
 * Phase CF-1A — Secure Conversation Foundation.
 *
 * Deterministic static/pure contract test over:
 *   * the TWO CANDIDATE migrations (NOT applied live), and
 *   * the pure TypeScript permission mirror + UX hook source.
 *
 * No database is contacted. No UI is mounted.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  RECRUITER_STAFF_PERMISSION_KEYS,
  RECRUITER_STAFF_PERMISSION_LABELS,
  RECRUITER_OWNER_ONLY_AREAS,
  parseRecruiterStaffPermissions,
  emptyRecruiterStaffPermissions,
} from "@/lib/recruiterStaffPermissions";

const ENUM_REL =
  "supabase/migration-candidates/20260916050000_phase_cf1a_conversation_permission_vocabulary.sql";
const SCHEMA_REL =
  "supabase/migration-candidates/20260916050500_phase_cf1a_conversation_foundation.sql";

const enumSql = readFileSync(path.resolve(process.cwd(), ENUM_REL), "utf8");
const schemaSql = readFileSync(path.resolve(process.cwd(), SCHEMA_REL), "utf8");

/** Executable SQL only: `--` line comments stripped. */
function executable(sql: string): string {
  return sql
    .toLowerCase()
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const enumExec = executable(enumSql);
const schemaExec = executable(schemaSql);

function fnSlice(name: string): string {
  const start = schemaExec.indexOf(`create or replace function public.${name}`);
  expect(start, `function ${name} must exist`).toBeGreaterThan(-1);
  const end = schemaExec.indexOf("\n$function$;", start);
  expect(end).toBeGreaterThan(start);
  return schemaExec.slice(start, end);
}

const NEW_KEYS = ["conversations_view", "conversations_reply"] as const;

// ── 1. Permission vocabulary ───────────────────────────────────────────────
describe("CF-1A / permission vocabulary", () => {
  it("1a. the mirror is exactly 26 keys with the two conversation keys appended last", () => {
    expect(RECRUITER_STAFF_PERMISSION_KEYS.length).toBe(26);
    expect(new Set(RECRUITER_STAFF_PERMISSION_KEYS).size).toBe(26);
    expect(RECRUITER_STAFF_PERMISSION_KEYS.slice(-2)).toEqual(NEW_KEYS);
  });

  it("1b. preserves the prior 24 keys unchanged and in order", () => {
    expect(RECRUITER_STAFF_PERMISSION_KEYS.slice(0, 24)).toEqual([
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
      "loads_view",
      "loads_dispatch",
      "loads_update_status",
    ]);
  });

  it("1c. both new keys have labels and are not owner-only areas", () => {
    for (const key of NEW_KEYS) {
      expect(RECRUITER_STAFF_PERMISSION_LABELS[key].length).toBeGreaterThan(0);
      expect(RECRUITER_OWNER_ONLY_AREAS).not.toContain(key as never);
    }
  });

  it("1d. exact-key fail-closed parsing is preserved at 26 keys", () => {
    const full = emptyRecruiterStaffPermissions();
    expect(Object.keys(full)).toHaveLength(26);
    expect(parseRecruiterStaffPermissions({ ...full })).toEqual(full);

    const missing: Record<string, boolean> = { ...full };
    delete missing.conversations_view;
    expect(parseRecruiterStaffPermissions(missing)).toBeNull();

    expect(parseRecruiterStaffPermissions({ ...full, unknown_key: true })).toBeNull();
    expect(parseRecruiterStaffPermissions({ ...full, conversations_reply: "true" })).toBeNull();
    expect(parseRecruiterStaffPermissions(null)).toBeNull();
  });
});

// ── 2. Hook UX booleans ────────────────────────────────────────────────────
describe("CF-1A / UX hook booleans", () => {
  const hookSrc = readFileSync(
    path.resolve(process.cwd(), "src/hooks/recruiter/useRecruiterStaffPermissions.ts"),
    "utf8",
  );

  it("2a. exposes canViewConversations fail-closed on conversations_view", () => {
    expect(hookSrc).toContain(
      "canViewConversations: granted && permissions.conversations_view === true",
    );
  });

  it("2b. canReplyConversations requires BOTH view and reply", () => {
    const normalized = hookSrc.replace(/\s+/g, " ");
    expect(normalized).toContain(
      "canReplyConversations: granted && permissions.conversations_view === true && permissions.conversations_reply === true",
    );
  });

  it("2c. introduces no conversation query, route or business logic in the hook", () => {
    expect(hookSrc).not.toMatch(
      /start_opportunity_conversation|conversation_post_message|conversation_threads/,
    );
  });
});

// ── 3. Enum migration is enum-only and transaction-free ────────────────────
describe("CF-1A / migration A (enum only)", () => {
  it("3a. is marked as a candidate", () => {
    expect(enumSql.split("\n")[0].trim()).toBe("-- CANDIDATE MIGRATION — NOT APPLIED LIVE.");
  });

  it("3b. appends exactly the two values idempotently", () => {
    const adds = [...enumExec.matchAll(/add value if not exists '([a-z_]+)'/g)].map((m) => m[1]);
    expect(adds).toEqual([...NEW_KEYS]);
    expect(enumExec).toContain("alter type public.recruiter_workspace_permission");
  });

  it("3c. contains no explicit transaction block (new enum values must commit first)", () => {
    expect(enumExec).not.toMatch(/^\s*begin;\s*$/m);
    expect(enumExec).not.toMatch(/^\s*commit;\s*$/m);
  });

  it("3d. contains nothing except the enum change", () => {
    for (const token of [
      "create table",
      "alter table",
      "create index",
      "create policy",
      "create or replace function",
      "grant ",
      "insert into",
      "update ",
      "delete from",
    ]) {
      expect(enumExec.includes(token), `enum migration must not contain "${token}"`).toBe(false);
    }
  });
});

// ── 4. Schema migration: tables, RLS, grants ───────────────────────────────
describe("CF-1A / migration B (schema, RLS, RPC)", () => {
  const TABLES = [
    "conversation_threads",
    "conversation_participants",
    "conversation_messages",
    "conversation_events",
  ];

  it("4a. is a candidate and is transactional", () => {
    expect(schemaSql.split("\n")[0].trim()).toBe("-- CANDIDATE MIGRATION — NOT APPLIED LIVE.");
    expect(schemaSql).toMatch(/^BEGIN;$/m);
    expect(schemaSql).toMatch(/^COMMIT;$/m);
  });

  it("4b. creates exactly the four conversation tables", () => {
    const created = [...schemaExec.matchAll(/create table if not exists public\.(\w+)/g)].map(
      (m) => m[1],
    );
    expect(created.sort()).toEqual([...TABLES].sort());
  });

  it("4c. enables RLS on all four tables", () => {
    for (const table of TABLES) {
      expect(schemaExec).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });

  it("4d. grants authenticated SELECT only — no write grant on any table", () => {
    for (const table of TABLES) {
      expect(schemaExec).toContain(`grant select on public.${table} to authenticated`);
      expect(schemaExec).toContain(`grant all on public.${table} to service_role`);
    }
    expect(schemaExec).not.toMatch(
      /grant[^;]*(insert|update|delete)[^;]*on public\.conversation_\w+ to authenticated/,
    );
    expect(schemaExec).not.toMatch(/to anon/);
  });

  it("4e. defines SELECT-only policies routed through the authorization helper", () => {
    const policies = [...schemaExec.matchAll(/create policy "[^"]+"\s+on public\.(\w+)\s+for (\w+)/g)];
    expect(policies.length).toBe(4);
    for (const [, table, cmd] of policies) {
      expect(TABLES).toContain(table);
      expect(cmd).toBe("select");
    }
    expect(
      (schemaExec.match(/current_user_can_conversation_action\((id|thread_id), 'view'\)/g) ?? [])
        .length,
    ).toBe(4);
  });

  it("4f. declares the required RPCs", () => {
    for (const fn of [
      "current_user_can_conversation_action",
      "start_opportunity_conversation",
      "accept_conversation_thread",
      "decline_conversation_thread",
      "conversation_post_message",
      "close_conversation_thread",
    ]) {
      expect(schemaExec).toContain(`create or replace function public.${fn}`);
    }
  });

  it("4g. every function is SECURITY DEFINER with a pinned search_path", () => {
    const defs = [...schemaExec.matchAll(/create or replace function public\.(\w+)/g)].map(
      (m) => m[1],
    );
    expect(defs.length).toBe(7); // 2 helpers + 5 RPCs
    for (const fn of defs) {
      const slice = fnSlice(fn);
      expect(slice, `${fn} must be SECURITY DEFINER`).toContain("security definer");
      expect(slice, `${fn} must pin search_path`).toContain("set search_path = public");
    }
  });

  it("4h. every function revokes PUBLIC and anon", () => {
    const revokedPublic = (schemaExec.match(/revoke all on function [^;]+ from public/g) ?? [])
      .length;
    const revokedAnon = (schemaExec.match(/revoke all on function [^;]+ from anon/g) ?? []).length;
    expect(revokedPublic).toBe(7);
    expect(revokedAnon).toBe(7);
    // The restriction helper is private: authenticated cannot execute it.
    expect(schemaExec).toContain(
      "revoke all on function public.user_has_blocking_messaging_restriction(uuid) from authenticated",
    );
  });
});

// ── 5. Uniqueness protection ───────────────────────────────────────────────
describe("CF-1A / thread uniqueness", () => {
  it("5a. defines two partial unique indexes scoped to requested/active threads", () => {
    expect(schemaExec).toMatch(
      /create unique index if not exists uq_conversation_threads_open_with_opportunity\s+on public\.conversation_threads \(driver_user_id, recruiter_id, opportunity_id\)\s+where opportunity_id is not null and status in \('requested','active'\)/,
    );
    expect(schemaExec).toMatch(
      /create unique index if not exists uq_conversation_threads_open_without_opportunity\s+on public\.conversation_threads \(driver_user_id, recruiter_id\)\s+where opportunity_id is null and status in \('requested','active'\)/,
    );
  });

  it("5b. uses no sentinel UUID to emulate a null opportunity", () => {
    expect(schemaExec).not.toMatch(/00000000-0000-0000-0000-000000000000/);
  });

  it("5c. messages are idempotent by client_message_id", () => {
    expect(schemaExec).toContain("unique (thread_id, sender_user_id, client_message_id)");
    expect(
      (schemaExec.match(/on conflict \(thread_id, sender_user_id, client_message_id\) do nothing/g) ??
        []).length,
    ).toBe(2);
  });
});

// ── 6. Start RPC derives identity server-side ──────────────────────────────
describe("CF-1A / start_opportunity_conversation", () => {
  const body = fnSlice("start_opportunity_conversation");

  it("6a. derives the driver from auth.uid() and never accepts a driver argument", () => {
    expect(body).toContain("_uid uuid := auth.uid()");
    expect(schemaExec).toContain(
      "create or replace function public.start_opportunity_conversation(\n  _opportunity_id uuid,\n  _initial_message text,\n  _client_message_id uuid\n)",
    );
    expect(body).not.toMatch(/_driver_user_id|_recruiter_id uuid\s*,/);
  });

  it("6b. derives recruiter_id from the opportunity row", () => {
    expect(body).toMatch(
      /select o\.recruiter_id into _recruiter_id\s+from public\.opportunities o\s+where o\.id = _opportunity_id/,
    );
  });

  it("6c. authorizes through the existing driver_can_access_opportunity gate", () => {
    expect(body).toContain("driver_can_access_opportunity(_opportunity_id, _recruiter_id)");
  });

  it("6d. writes the driver actor/source server-side", () => {
    expect(body).toContain("'driver', 'web', 'text'");
  });

  it("6e. emits the requested event only for a newly created thread", () => {
    expect(body).toMatch(/if _created then[\s\S]*'requested'/);
  });
});

// ── 7. Marketplace moderation gate ─────────────────────────────────────────
describe("CF-1A / marketplace messaging restrictions", () => {
  const helper = fnSlice("user_has_blocking_messaging_restriction");

  it("7a. consults marketplace_user_restrictions for active blocking scope", () => {
    expect(helper).toContain("from public.marketplace_user_restrictions r");
    expect(helper).toContain("r.scope in ('messaging','all')");
    expect(helper).toContain("r.restriction in ('blocked','read_only')");
    expect(helper).toContain("r.starts_at <= now()");
    expect(helper).toContain("r.ends_at is null or r.ends_at > now()");
  });

  it("7b. 'warned' never blocks", () => {
    expect(helper).not.toContain("'warned'");
  });

  it("7c. write paths consult the restriction, view paths do not", () => {
    const action = fnSlice("current_user_can_conversation_action");
    // reply is gated for both actors; view returns before any restriction check.
    expect(
      (action.match(/not public\.user_has_blocking_messaging_restriction\(_uid\)/g) ?? []).length,
    ).toBe(2);
    expect(action).toMatch(/if _action = 'view' then\s+return true;/);
    // the driver-start RPC also rejects restricted actors up front
    expect(fnSlice("start_opportunity_conversation")).toContain(
      "if public.user_has_blocking_messaging_restriction(_uid) then",
    );
  });
});

// ── 8. Recruiter authority semantics ───────────────────────────────────────
describe("CF-1A / recruiter authority", () => {
  const action = fnSlice("current_user_can_conversation_action");

  it("8a. resolves recruiter authority live through the canonical resolver", () => {
    expect(action).toContain(
      "current_user_has_recruiter_permission(\n       _t.recruiter_id, 'conversations_view'::public.recruiter_workspace_permission)",
    );
    expect(action).toContain(
      "current_user_has_recruiter_permission(\n       _t.recruiter_id, 'conversations_reply'::public.recruiter_workspace_permission)",
    );
    expect(action).not.toContain("recruiter_members");
    expect(action).not.toContain("conversation_participants");
  });

  it("8b. reply/accept/decline/close require view first (view is checked before reply)", () => {
    const viewIdx = action.indexOf("'conversations_view'");
    const replyIdx = action.indexOf("'conversations_reply'");
    expect(viewIdx).toBeGreaterThan(-1);
    expect(replyIdx).toBeGreaterThan(viewIdx);
  });

  it("8c. drivers are scoped strictly to their own thread", () => {
    expect(action).toContain("if _t.driver_user_id = _uid then");
  });

  it("8d. recruiters cannot originate a thread in CF-1A", () => {
    expect(schemaExec).not.toMatch(/create or replace function public\.start_\w*recruiter\w*/);
    const start = fnSlice("start_opportunity_conversation");
    expect(start).toContain("values (_uid, _recruiter_id, _opportunity_id, 'requested', _uid)");
  });

  it("8e. accept and decline reject the driver side explicitly", () => {
    for (const fn of ["accept_conversation_thread", "decline_conversation_thread"]) {
      expect(fnSlice(fn)).toContain("if _t.driver_user_id = _uid");
    }
  });
});

// ── 9. Scope guard: no pre-existing surface is touched ─────────────────────
describe("CF-1A / scope guard", () => {
  it("9a. alters no pre-existing table", () => {
    const altered = [...schemaExec.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]);
    for (const table of altered) {
      expect(table.startsWith("conversation_")).toBe(true);
    }
  });

  it("9b. creates or drops no policy outside the conversation tables", () => {
    const policyTargets = [
      ...schemaExec.matchAll(/(?:create|drop) policy [^;]*?on public\.(\w+)/g),
    ].map((m) => m[1]);
    expect(policyTargets.length).toBeGreaterThan(0);
    for (const table of policyTargets) {
      expect(table.startsWith("conversation_")).toBe(true);
    }
  });

  it("9c. never writes to or redefines protected domains", () => {
    for (const token of [
      "opportunity_applications",
      "application_events",
      "recruiter_contact_requests",
      "opportunity_offers",
      "contracts",
      "driver_settlement",
      "notifications",
      "notification_preferences",
      "subscriptions",
      "stripe",
      "agency_",
      "driver_assistants",
      "telegram_",
      "loads",
      "expenses",
      "fuel_logs",
      "cost_profile",
      "webhook",
      "pg_net",
      "http_post",
    ]) {
      expect(schemaExec.includes(token), `must not reference ${token}`).toBe(false);
    }
  });

  it("9d. reads driver_opportunity_profiles nowhere and never changes its RLS", () => {
    expect(schemaExec).not.toContain("driver_opportunity_profiles");
  });

  it("9e. touches opportunities read-only, through the existing access gate", () => {
    expect(schemaExec).not.toMatch(/(insert into|update|delete from) public\.opportunities/);
    expect(schemaExec).not.toMatch(/(create|drop) policy[^;]*on public\.opportunities/);
  });

  it("9f. performs no data migration or destructive operation", () => {
    expect(schemaExec).not.toMatch(/\bdrop table\b/);
    expect(schemaExec).not.toMatch(/\btruncate\b/);
    expect(schemaExec).not.toMatch(/\bdrop column\b/);
    expect(schemaExec).not.toMatch(/\balter type\b/);
  });
});
