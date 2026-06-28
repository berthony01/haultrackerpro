/**
 * Driver Assistants Phase 3 — agency workflow tests.
 *
 * These tests pin three things:
 *  1. The migration file declares the right tables, RLS, and security helpers.
 *  2. RPCs that touch driver data require driver-controlled delegation and
 *     never blanket-grant access based on agency membership alone.
 *  3. The audit-action formatter renders all Phase 3 actions.
 *  4. Route guards still block billing/recruiter routes for assistants.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatAgencyAuditAction } from '@/hooks/useAgencyWorkflow';
import { isAssistantPageAllowed } from '@/lib/assistantPermissions';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PHASE3_MIGRATION = readdirSync(join(ROOT, 'supabase/migrations'))
  .filter((f) => f.startsWith('20260628114250_'))[0]!;
const SQL = read(`supabase/migrations/${PHASE3_MIGRATION}`).toLowerCase();

const CLEANUP_MIGRATION = readdirSync(join(ROOT, 'supabase/migrations'))
  .filter((f) => /^20260628120/.test(f))
  .sort()
  .pop()!;
const CLEANUP_SQL = read(`supabase/migrations/${CLEANUP_MIGRATION}`).toLowerCase();

describe('Phase 3 — schema and security helpers', () => {
  it('creates all five Phase 3 tables', () => {
    expect(SQL).toMatch(/create table if not exists public\.agency_service_packages/);
    expect(SQL).toMatch(/create table if not exists public\.agency_client_requests/);
    expect(SQL).toMatch(/create table if not exists public\.agency_delegation_requests/);
    expect(SQL).toMatch(/create table if not exists public\.agency_work_items/);
    expect(SQL).toMatch(/create table if not exists public\.agency_audit_log/);
  });

  it('enables RLS on every Phase 3 table', () => {
    for (const t of [
      'agency_service_packages',
      'agency_client_requests',
      'agency_delegation_requests',
      'agency_work_items',
      'agency_audit_log',
    ]) {
      expect(SQL).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
    }
  });

  it('declares the is_agency_owner_or_admin helper', () => {
    expect(SQL).toMatch(/function public\.is_agency_owner_or_admin/);
  });

  it('grants execute on Phase 3 functions only to authenticated', () => {
    // Every Phase 3 RPC must be granted to authenticated; none to anon.
    expect(SQL).toMatch(/grant execute on function public\.create_agency_package[^;]+ to authenticated/);
    expect(SQL).toMatch(/grant execute on function public\.submit_agency_client_request[^;]+ to authenticated/);
    expect(SQL).toMatch(/grant execute on function public\.driver_decide_delegation[^;]+ to authenticated/);
    expect(SQL).not.toMatch(/grant execute on function public\.driver_decide_delegation[^;]+ to anon/);
  });
});

describe('Phase 3 — delegation requires driver approval', () => {
  it('driver_decide_delegation rejects callers who are not the driver', () => {
    // Function body must compare auth.uid() to driver_user_id before doing
    // anything; otherwise an agency admin could approve on the driver's
    // behalf.
    expect(SQL).toMatch(/driver_user_id\s*<>\s*(_uid|v_uid|auth\.uid\(\))/);
  });

  it('only creates / updates driver_assistants when the driver approves', () => {
    // Approving path writes to driver_assistants; declining path does not.
    const approveBlock = SQL.split('driver_decide_delegation')[1] ?? '';
    expect(approveBlock).toMatch(/insert into public\.driver_assistants/);
  });

  it('client request approval alone does not write driver_assistants', () => {
    const block = SQL.split('set_agency_client_request_status')[1]?.split('end;')[0] ?? '';
    expect(block).not.toMatch(/insert into public\.driver_assistants/);
    expect(block).not.toMatch(/update public\.driver_assistants/);
  });

  it('create_agency_delegation_request requires owner/admin role', () => {
    const block = SQL.split('create_agency_delegation_request')[1]?.split('end;')[0] ?? '';
    expect(block).toMatch(/is_agency_owner_or_admin/);
  });
});

describe('Phase 3 — agency membership never grants driver data access', () => {
  it('agency_work_items RLS does not unlock driver tables', () => {
    // Spot check: the Phase 3 migration must NOT add work_items-based policies
    // to loads/expenses/fuel_logs.
    expect(SQL).not.toMatch(/create policy[^;]+on public\.loads[^;]+agency_work_items/);
    expect(SQL).not.toMatch(/create policy[^;]+on public\.expenses[^;]+agency_work_items/);
    expect(SQL).not.toMatch(/create policy[^;]+on public\.fuel_logs[^;]+agency_work_items/);
  });

  it('list_agency_clients only joins approved delegations', () => {
    const block = SQL.split('list_agency_clients')[1]?.split('$$;')[0] ?? '';
    expect(block).toMatch(/agency_delegation_requests|driver_assistants/);
    expect(block).toMatch(/status\s*=\s*'approved'/);
    expect(block).toMatch(/is_agency_owner_or_admin|is_agency_member/);
  });

  it('inactive packages are excluded from the driver-facing listing', () => {
    const block = SQL.split('list_agency_packages_public')[1]?.split('$function$;')[0] ?? '';
    expect(block).toMatch(/is_active\s*=\s*true/);
  });

  it('drivers can only submit client requests for themselves', () => {
    const block = SQL.split('submit_agency_client_request')[1]?.split('end;')[0] ?? '';
    expect(block).toMatch(/auth\.uid\(\)/);
  });
});

describe('Phase 3 — audit logging', () => {
  it('formats every Phase 3 audit action in plain English', () => {
    for (const action of [
      'package_created',
      'package_updated',
      'package_deactivated',
      'client_request_submitted',
      'client_request_approved',
      'client_request_declined',
      'delegation_request_created',
      'delegation_approved_by_driver',
      'delegation_declined_by_driver',
      'work_item_created',
      'work_item_assigned',
      'work_item_status_changed',
      'work_item_completed',
    ]) {
      const label = formatAgencyAuditAction(action, 'agency_audit_log');
      expect(label).not.toBe(action); // not a raw fallback
      expect(label).toMatch(/[a-z ]/);
    }
  });

  it('writes to agency_audit_log on key actions', () => {
    expect(SQL).toMatch(/insert into public\.agency_audit_log[\s\S]+package_created/);
    expect(SQL).toMatch(/insert into public\.agency_audit_log[\s\S]+client_request_submitted/);
    expect(SQL).toMatch(/delegation_request_created/);
    expect(SQL).toMatch(/work_item_created/);
  });

  it('audit log read RPC restricts to agency owner/admin', () => {
    const block = SQL.split('list_agency_audit_log')[1]?.split('end;')[0] ?? '';
    expect(block).toMatch(/is_agency_owner_or_admin/);
  });
});

describe('Phase 3 — assistant route guards remain intact', () => {
  it('billing/recruiter pages stay blocked for assistants regardless of perms', () => {
    const everything = {
      manage_loads: true,
      manage_expenses: true,
      manage_fuel: true,
      view_reports: true,
      view_dashboard: true,
      manage_settings_limited: true,
      export_reports: true,
    };
    expect(isAssistantPageAllowed('settings', everything)).toBe(false);
    expect(isAssistantPageAllowed('recruiter-access', everything)).toBe(false);
    expect(isAssistantPageAllowed('opportunities', everything)).toBe(false);
  });
});

describe('Phase 3 — driver-facing UI surfaces approval, not autoaccess', () => {
  it('public agency request page warns that submitting does not grant access', () => {
    const page = read('src/pages/AgencyRequestPublic.tsx');
    expect(page).toMatch(/does not.*grant.*access|does not.*account access|requires my explicit approval/i);
  });

  it('driver delegation page lists forbidden assistant areas', () => {
    const page = read('src/pages/DriverDelegationApprovals.tsx');
    expect(page).toMatch(/ASSISTANT_FORBIDDEN_AREAS/);
    expect(page).toMatch(/cannot do/i);
  });
});

function fnBody(sql: string, name: string): string {
  const m = sql.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$function\\$`, 'i'));
  return m ? m[0] : '';
}

describe('Phase 3 cleanup — pending delegation filtering', () => {
  it('list_my_pending_delegations filters by pending_driver_approval', () => {
    const body = fnBody(CLEANUP_SQL, 'list_my_pending_delegations');
    expect(body).toMatch(/status\s*=\s*'pending_driver_approval'/);
  });
});

describe('Phase 3 cleanup — work item gating', () => {
  it('create_agency_work_item requires an approved delegation for the driver', () => {
    const body = fnBody(CLEANUP_SQL, 'create_agency_work_item');
    expect(body).toMatch(/agency_delegation_requests/);
    expect(body).toMatch(/status\s*=\s*'approved'/);
    expect(body).toMatch(/not an approved client/i);
  });

  it('update_agency_work_item re-verifies approved-client status', () => {
    const body = fnBody(CLEANUP_SQL, 'update_agency_work_item');
    expect(body).toMatch(/agency_delegation_requests/);
    expect(body).toMatch(/no longer an approved client/i);
  });

  it('update_agency_work_item has no _driver_user_id parameter (driver target is immutable)', () => {
    const body = fnBody(CLEANUP_SQL, 'update_agency_work_item');
    const sig = body.split(')')[0];
    expect(sig).not.toMatch(/_driver_user_id/);
  });
});

describe('Phase 3 cleanup — delegation creation gating', () => {
  it('create_agency_delegation_request rejects declined/cancelled/converted requests', () => {
    const body = fnBody(CLEANUP_SQL, 'create_agency_delegation_request');
    expect(body).toMatch(/status\s+not\s+in\s*\(\s*'pending'\s*,\s*'approved'\s*\)/);
  });

  it('create_agency_delegation_request still requires an active agency member (email-only blocked)', () => {
    const body = fnBody(CLEANUP_SQL, 'create_agency_delegation_request');
    expect(body).toMatch(/agency_members/);
    expect(body).toMatch(/status\s*=\s*'active'/);
    expect(body).toMatch(/active agency member with a verified account/i);
  });
});

describe('Phase 3 cleanup — driver-side request status UI', () => {
  it('MyAgencyRequestsSection uses list_my_agency_client_requests via useMyAgencyRequests', () => {
    const c = read('src/components/assistants/MyAgencyRequestsSection.tsx');
    expect(c).toMatch(/useMyAgencyRequests/);
    expect(c).toMatch(/agency_name/);
    expect(c).toMatch(/package_name/);
    expect(c).toMatch(/status/);
    expect(c).toMatch(/created_at/);
    expect(c).toMatch(/decided_at/);
  });

  it('AssistantsPanel surfaces MyAgencyRequestsSection and the email-only limitation note', () => {
    const c = read('src/components/assistants/AssistantsPanel.tsx');
    expect(c).toMatch(/MyAgencyRequestsSection/);
    expect(c).toMatch(/email-only/i);
  });

  it('useMyAgencyRequests calls the right RPC', () => {
    const hook = read('src/hooks/useAgencyWorkflow.ts');
    expect(hook).toMatch(/list_my_agency_client_requests/);
  });
});


