/**
 * Phase AM-1C-B — Agency Client Request permission consumer cutover.
 *
 * Deterministic source/SQL contract test. The candidate migration is NOT
 * applied live; these assertions read the candidate text and the authored
 * frontend sources.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const START_GATE = 'd80afbd635ee97a27c1ef3db821bab2f8613f1f1';
/** Immutable AM-1C-B phase-end commit. The envelope is a historical fact. */
const PHASE_END = 'e0cf3342d1c7cc1a59d6ddd7777b7ba37642f75a';

const SQL_PATH = path.resolve(
  process.cwd(),
  'supabase/migration-candidates/20260817052500_phase_am1cb_agency_client_request_permission_cutover.sql',
);
const HOOK_PATH = path.resolve(process.cwd(), 'src/hooks/useAgencyWorkspacePermissions.ts');
const WORKFLOW_PATH = path.resolve(process.cwd(), 'src/hooks/useAgencyWorkflow.ts');
const SECTION_PATH = path.resolve(
  process.cwd(),
  'src/components/agency/ClientRequestsSection.tsx',
);
const DASHBOARD_PATH = path.resolve(process.cwd(), 'src/pages/AgencyDashboard.tsx');

const sql = readFileSync(SQL_PATH, 'utf8');
const hookSource = readFileSync(HOOK_PATH, 'utf8');
const workflowSource = readFileSync(WORKFLOW_PATH, 'utf8');
const sectionSource = readFileSync(SECTION_PATH, 'utf8');
const dashboardSource = readFileSync(DASHBOARD_PATH, 'utf8');

/** Executable SQL only: `--` line comments stripped. */
const executable = sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const executableLower = executable.toLowerCase();

const AM1CB_AUTHORED_FILES = [
  'supabase/migration-candidates/20260817052500_phase_am1cb_agency_client_request_permission_cutover.sql',
  'src/hooks/useAgencyWorkspacePermissions.ts',
  'src/hooks/useAgencyWorkflow.ts',
  'src/components/agency/ClientRequestsSection.tsx',
  'src/pages/AgencyDashboard.tsx',
  'src/test/phaseAM1CBAgencyClientRequestPermissionCutover.test.tsx',
];

const GENERATED_TYPES = 'src/integrations/supabase/types.ts';

describe('AM-1C-B — candidate envelope and authored scope', () => {
  it('1. is marked as a candidate and is exactly one explicit transaction', () => {
    expect(sql.split('\n')[0].trim()).toBe('-- CANDIDATE MIGRATION — NOT APPLIED LIVE.');
    expect((sql.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((sql.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
    expect(sql.indexOf('\nBEGIN;')).toBeLessThan(sql.indexOf('\nCOMMIT;'));
  });

  it('17. changes exactly the six authored files and no generated type file', () => {
    const out = execFileSync('git', ['diff', '--name-only', `${START_GATE}..${PHASE_END}`], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    const changed = out.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(changed.sort()).toEqual([...AM1CB_AUTHORED_FILES].sort());
    expect(changed).not.toContain(GENERATED_TYPES);
  });
});

describe('AM-1C-B — SQL redefinition surface', () => {
  const definitions = [...executableLower.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/g)].map(
    (m) => m[1],
  );

  it('2. replaces exactly the two client-request functions and nothing else', () => {
    expect(definitions.sort()).toEqual([
      'list_agency_client_requests',
      'set_agency_client_request_status',
    ]);
  });

  it('9/10. does not redefine submission, delegation, AM-1B or package objects', () => {
    for (const forbidden of [
      'submit_agency_client_request',
      'create_agency_delegation_request',
      'is_agency_owner_or_admin',
      'current_user_has_agency_permission',
      'get_my_agency_permissions',
      'set_agency_member_permissions',
      'create_agency_package',
      'update_agency_package',
      'list_agency_packages_public',
    ]) {
      expect(definitions).not.toContain(forbidden);
      expect(executableLower).not.toContain(`drop function public.${forbidden}`);
    }
    expect(executableLower).not.toContain('agency_service_packages_');
  });
});

describe('AM-1C-B — listing RPC authorization', () => {
  const body = executable.slice(
    executable.indexOf('CREATE OR REPLACE FUNCTION public.list_agency_client_requests'),
    executable.indexOf('CREATE OR REPLACE FUNCTION public.set_agency_client_request_status'),
  );

  it('3. authorizes broad listing through client_requests_view with no role shortcut', () => {
    expect(body).toContain(
      "public.current_user_has_agency_permission(_agency_id,'client_requests_view')",
    );
    expect(body).not.toContain('is_agency_owner_or_admin');
    expect(body).not.toContain('agency_admin');
    expect(body).not.toContain('client_requests_manage');
  });

  it('preserves the projection, joins and ordering', () => {
    expect(body).toContain('LEFT JOIN auth.users u ON u.id = r.driver_user_id');
    expect(body).toContain('LEFT JOIN public.profiles p ON p.user_id = r.driver_user_id');
    expect(body).toContain(
      'LEFT JOIN public.agency_service_packages pk ON pk.id = r.selected_package_id',
    );
    expect(body).toContain('ORDER BY r.created_at DESC');
    expect(body).toContain("SET search_path TO 'public'");
    expect(body).toContain('SECURITY DEFINER');
  });
});

describe('AM-1C-B — set-status RPC authorization', () => {
  const body = executable.slice(
    executable.indexOf('CREATE OR REPLACE FUNCTION public.set_agency_client_request_status'),
    executable.indexOf('DROP POLICY'),
  );

  it('4. Agency branch uses client_requests_manage with no role shortcut', () => {
    expect(body).toContain(
      "public.current_user_has_agency_permission(_old.agency_id,'client_requests_manage')",
    );
    expect(body).not.toContain('is_agency_owner_or_admin');
    expect(body).not.toContain('agency_admin');
    expect(body).not.toContain('client_requests_view');
  });

  it('5. driver self-cancel branch remains before the Agency permission branch', () => {
    const driverIdx = body.indexOf(
      "IF _old.driver_user_id=_uid AND _status='cancelled' AND _assigned_member_user_id IS NULL THEN",
    );
    const agencyIdx = body.indexOf(
      "ELSIF public.current_user_has_agency_permission(_old.agency_id,'client_requests_manage')",
    );
    expect(driverIdx).toBeGreaterThan(-1);
    expect(agencyIdx).toBeGreaterThan(driverIdx);
  });

  it('6. preserves validation, limits, update and audit behavior', () => {
    expect(body).toContain("public.assert_agency_limit(_old.agency_id,'progress_client_request')");
    expect(body).toContain('Assigned member must be an active agency member');
    expect(body).toContain('public._agency_member_paid_operational_authority');
    expect(body).toContain('UPDATE public.agency_client_requests');
    expect(body).toContain('INSERT INTO public.agency_audit_log');
    expect(body).toContain("ERRCODE='42501'");
    expect(body).toContain("ERRCODE='42704'");
    expect(body).toContain("ERRCODE='22023'");
    expect(body).toContain('RETURNS agency_client_requests');
  });
});

describe('AM-1C-B — RLS cutover', () => {
  it('7. drops only acr_agency_admin_select and adds one acr_workspace_view_select', () => {
    const drops = [...executableLower.matchAll(/drop\s+policy[^;]*?([a-z0-9_]+)\s+on\s+public\.agency_client_requests/g)];
    expect(drops.length).toBe(1);
    expect(drops[0][1]).toBe('acr_agency_admin_select');

    const creates = [...executableLower.matchAll(/create\s+policy\s+([a-z0-9_]+)/g)].map((m) => m[1]);
    expect(creates).toEqual(['acr_workspace_view_select']);
    expect(executable).toContain(
      "USING (public.current_user_has_agency_permission(agency_id,'client_requests_view'))",
    );
    expect(executable).toContain('FOR SELECT');
    expect(executable).toContain('TO authenticated');
  });

  it('8. preserves the narrow policies and adds no DML policy', () => {
    expect(executableLower).not.toContain('acr_assigned_member_select');
    expect(executableLower).not.toContain('acr_driver_self_select');
    for (const dml of ['for insert', 'for update', 'for delete', 'for all']) {
      expect(executableLower).not.toContain(dml);
    }
  });
});

describe('AM-1C-B — permission hook', () => {
  it('11. preserves package booleans and adds fail-closed client-request booleans', () => {
    expect(hookSource).toContain('canViewPackages: settled && resolved.packages_view === true');
    expect(hookSource).toContain('canManagePackages: settled && resolved.packages_manage === true');
    expect(hookSource).toContain(
      'canViewClientRequests: settled && resolved.client_requests_view === true',
    );
    expect(hookSource).toContain(
      'canManageClientRequests: settled && resolved.client_requests_manage === true',
    );
    expect(hookSource).toContain('emptyAgencyWorkspacePermissions()');
    expect(hookSource).not.toMatch(/agency_admin|agency_owner/);
  });
});

describe('AM-1C-B — client request query hook', () => {
  it('12. useAgencyClientRequests can be disabled before RPC execution', () => {
    const start = workflowSource.indexOf('export function useAgencyClientRequests');
    const body = workflowSource.slice(start, workflowSource.indexOf('export function', start + 10));
    expect(body).toContain('opts?: { enabled?: boolean }');
    expect(body).toContain('const callerEnabled = opts?.enabled ?? true;');
    expect(body).toContain('enabled: !!agencyId && callerEnabled');
    // RPC name and payload unchanged.
    expect(body).toContain("rpc('list_agency_client_requests', {");
    expect(body).toContain('_agency_id: agencyId,');
  });
});

describe('AM-1C-B — ClientRequestsSection gating', () => {
  it('13. gates list by view, direct controls by manage, delegation by delegations_manage', () => {
    // AM-1C-D superseded the transitional role-derived delegation prop with the
    // exact `delegations_manage` workspace permission. The invariant is
    // unchanged: delegation UI is never gated by client-request permissions.
    expect(sectionSource).toContain('canManageDelegations: boolean;');
    expect(sectionSource).toContain('useAgencyWorkspacePermissions(agencyId)');
    expect(sectionSource).toContain('enabled: canViewClientRequests');
    expect(sectionSource).toContain('{canManageClientRequests && (');
    expect(sectionSource).toContain('{canManageDelegations && (');
    expect(sectionSource).toContain('{canManageDelegations && open && (');
    // Delegation UI is never gated by client-request permissions.
    expect(sectionSource).not.toContain('canManageClientRequests && open');
    expect(sectionSource).not.toContain('isOwnerOrAdmin');
  });


  it('14. manage does not imply view — rows render only under view', () => {
    const listGate = sectionSource.indexOf('!canViewClientRequests ? (');
    expect(listGate).toBeGreaterThan(-1);
    expect(sectionSource.indexOf('filtered.map(')).toBeGreaterThan(listGate);
    expect(sectionSource).not.toContain('canViewClientRequests || canManageClientRequests');
  });

  it('has neutral loading and fail-closed error states', () => {
    expect(sectionSource).toContain('permissionsLoading ? (');
    expect(sectionSource).toContain('permissionsError ? (');
  });
});

describe('AM-1C-B — AgencyDashboard tab authorization', () => {
  it('15. Packages and Requests tabs use permission booleans, never role', () => {
    expect(dashboardSource).toContain('useAgencyWorkspacePermissions(agency?.id)');
    expect(dashboardSource).toContain(
      'const showPackages = canViewPackages || canManagePackages;',
    );
    expect(dashboardSource).toContain(
      'const showRequests = canViewClientRequests || canManageClientRequests;',
    );
    expect(dashboardSource).toContain("{ value: 'packages', label: 'Packages', show: showPackages }");
    expect(dashboardSource).toContain("{ value: 'requests', label: 'Requests', show: showRequests }");
    expect(dashboardSource).toContain('{showPackages && (');
    expect(dashboardSource).toContain('{showRequests && (');
  });

  it('16. no role-derived authority remains in the Requests integration', () => {
    // The AM-1C-B transitional `canCreateDelegation={isOwnerOrAdmin}` prop was
    // removed by AM-1C-D; delegation authority is resolved from the exact
    // `delegations_manage` permission inside the section itself.
    expect(dashboardSource).not.toContain("label: 'Packages', show: isOwnerOrAdmin");
    expect(dashboardSource).not.toContain("label: 'Requests', show: isOwnerOrAdmin");
    expect(dashboardSource).not.toContain('isOwnerOrAdmin');
    expect(dashboardSource).toContain('<ClientRequestsSection agencyId={agency.id} />');
    // Clients tab is the read-only `clients_view` permission, never a role.
    expect(dashboardSource).toContain("{ value: 'clients', label: 'Clients', show: canViewClients }");
  });

});
