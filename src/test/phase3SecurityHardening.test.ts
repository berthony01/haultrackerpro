/**
 * Phase 3 security hardening — verifies that direct table writes on Phase 3
 * tables can no longer bypass the SECURITY DEFINER RPCs, and that the new
 * revoke + work-item update rules are implemented.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatAgencyAuditAction } from '@/hooks/useAgencyWorkflow';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const MIGRATION_FILE = readdirSync(join(ROOT, 'supabase/migrations'))
  .filter((f) => /^2026062812(2|3)/.test(f))
  .sort()
  .pop()!;
const SQL = read(`supabase/migrations/${MIGRATION_FILE}`);
const LOWER = SQL.toLowerCase();

function fnBody(name: string): string {
  const re = new RegExp(
    `create or replace function public\\.${name}[\\s\\S]*?\\$function\\$;`,
    'i',
  );
  const m = SQL.match(re);
  return m ? m[0] : '';
}

describe('Phase 3 hardening — direct-write policies removed', () => {
  it('drops broad FOR ALL admin policies on the three Phase 3 tables', () => {
    expect(LOWER).toMatch(/drop policy if exists acr_agency_admin_all/);
    expect(LOWER).toMatch(/drop policy if exists adr_agency_admin_all/);
    expect(LOWER).toMatch(/drop policy if exists awi_agency_admin_all/);
  });

  it('drops broad driver-side direct write policies', () => {
    expect(LOWER).toMatch(/drop policy if exists acr_driver_cancel_own/);
    expect(LOWER).toMatch(/drop policy if exists acr_driver_insert_self/);
    expect(LOWER).toMatch(/drop policy if exists adr_driver_update_own/);
  });

  it('drops the assigned-member direct UPDATE on work items', () => {
    expect(LOWER).toMatch(/drop policy if exists awi_assigned_member_update/);
  });

  it('replaces them with read-only admin SELECT policies', () => {
    expect(LOWER).toMatch(
      /create policy acr_agency_admin_select on public\.agency_client_requests\s+for select/,
    );
    expect(LOWER).toMatch(
      /create policy adr_agency_admin_select on public\.agency_delegation_requests\s+for select/,
    );
    expect(LOWER).toMatch(
      /create policy awi_agency_admin_select on public\.agency_work_items\s+for select/,
    );
  });
});

describe('Phase 3 hardening — work item update fix', () => {
  const body = fnBody('update_agency_work_item');

  it('exists and was rewritten in this migration', () => {
    expect(body).toBeTruthy();
  });

  it('treats NULL _assigned_member_user_id as "no change" (not a reassignment)', () => {
    expect(body).toMatch(/_reassigning\s*:=\s*\(_assigned_member_user_id is not null/i);
  });

  it('still blocks reassignment or rename by non-admins', () => {
    expect(body).toMatch(/_reassigning or _renaming.*not _is_admin/is);
  });

  it('signature does not accept _driver_user_id (driver target immutable)', () => {
    const sig = body.split(')')[0];
    expect(sig).not.toMatch(/_driver_user_id/);
  });

  it('re-verifies approved-client status before mutating', () => {
    expect(body).toMatch(/agency_delegation_requests/);
    expect(body).toMatch(/status\s*=\s*'approved'/);
    expect(body).toMatch(/no longer an approved client/i);
  });

  it('admin can reassign only to an active member', () => {
    expect(body).toMatch(/agency_members[\s\S]+status\s*=\s*'active'/);
    expect(body).toMatch(/must be an active agency member/i);
  });
});

describe('Phase 3 hardening — revoke_agency_delegation RPC', () => {
  const body = fnBody('revoke_agency_delegation');

  it('exists', () => {
    expect(body).toBeTruthy();
  });

  it('allows driver or agency owner/admin', () => {
    expect(body).toMatch(/_is_driver\s*:=\s*\(_d\.driver_user_id\s*=\s*_uid\)/);
    expect(body).toMatch(/is_agency_owner_or_admin/);
  });

  it('flips delegation to revoked and syncs the matching driver_assistants row', () => {
    expect(body).toMatch(/update public\.agency_delegation_requests[\s\S]+status\s*=\s*'revoked'/i);
    expect(body).toMatch(/update public\.driver_assistants[\s\S]+status\s*=\s*'revoked'/i);
  });

  it('writes both agency_audit_log and assistant_audit_log entries', () => {
    expect(body).toMatch(/insert into public\.agency_audit_log/i);
    expect(body).toMatch(/insert into public\.assistant_audit_log/i);
  });

  it('is execute-granted only to authenticated', () => {
    expect(LOWER).toMatch(
      /grant\s+execute on function public\.revoke_agency_delegation\(uuid\) to authenticated/,
    );
    expect(LOWER).toMatch(
      /revoke execute on function public\.revoke_agency_delegation\(uuid\) from public, anon/,
    );
  });
});

describe('Phase 3 hardening — revoke_assistant syncs agency delegation', () => {
  const body = fnBody('revoke_assistant');

  it('was rewritten in this migration', () => {
    expect(body).toBeTruthy();
  });

  it('syncs matching agency_delegation_requests rows to revoked', () => {
    expect(body).toMatch(/update public\.agency_delegation_requests/i);
    expect(body).toMatch(/status\s*=\s*'revoked'/);
    expect(body).toMatch(/status\s+in\s*\(\s*'approved'\s*,\s*'pending_driver_approval'\s*\)/i);
  });

  it('matches delegations by member_user_id or invite email', () => {
    expect(body).toMatch(/member_user_id\s*=\s*_row\.assistant_user_id/i);
    expect(body).toMatch(/member_invite_email/);
  });
});

describe('Phase 3 hardening — audit labels', () => {
  it('formats new revocation actions in plain English', () => {
    expect(formatAgencyAuditAction('delegation_revoked_by_driver', 'agency_delegation_request')).toMatch(
      /revoke/i,
    );
    expect(formatAgencyAuditAction('delegation_revoked_by_agency', 'agency_delegation_request')).toMatch(
      /revoke/i,
    );
  });
});

describe('Phase 3 hardening — hook exposes revoke RPC', () => {
  const hook = read('src/hooks/useAgencyWorkflow.ts');

  it('exports useRevokeAgencyDelegation calling the new RPC', () => {
    expect(hook).toMatch(/useRevokeAgencyDelegation/);
    expect(hook).toMatch(/'revoke_agency_delegation'/);
  });
});
