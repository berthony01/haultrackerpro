/**
 * Phase AM-1C-D — Agency Delegations permission consumer cutover.
 *
 * Deterministic source/SQL contract test. The candidate migration is NOT
 * applied live; these assertions read the candidate text and authored sources.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const START_GATE = '9b9017c1ba497fe0cafc3ca9a4fa28b2d4dbc79e';
/** Immutable AM-1C-D phase-end commit. The envelope is a historical fact. */
const PHASE_END = 'd3d9069a5b48e8abde3c3100b9970632a1e9c668';

const SQL_REL =
  'supabase/migration-candidates/20260818045500_phase_am1cd_agency_delegations_permission_cutover.sql';
const HOOK_REL = 'src/hooks/useAgencyWorkspacePermissions.ts';
const REQUESTS_REL = 'src/components/agency/ClientRequestsSection.tsx';
const CLIENTS_REL = 'src/components/agency/ClientListSection.tsx';
const DASHBOARD_REL = 'src/pages/AgencyDashboard.tsx';
const TEST_REL = 'src/test/phaseAM1CDAgencyDelegationsPermissionCutover.test.tsx';
const WORKFLOW_REL = 'src/hooks/useAgencyWorkflow.ts';
const GENERATED_TYPES = 'src/integrations/supabase/types.ts';

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), 'utf8');

const sql = read(SQL_REL);
const hookSource = read(HOOK_REL);
const requestsSource = read(REQUESTS_REL);
const clientsSource = read(CLIENTS_REL);
const dashboardSource = read(DASHBOARD_REL);

/** Executable SQL only: `--` line comments stripped. */
const executable = sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const executableLower = executable.toLowerCase();

const AUTHORED_FILES = [SQL_REL, HOOK_REL, REQUESTS_REL, CLIENTS_REL, DASHBOARD_REL, TEST_REL];

const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');

describe('AM-1C-D — candidate envelope and authored scope', () => {
  it('1. is marked as a candidate and is exactly one explicit transaction', () => {
    expect(sql.split('\n')[0].trim()).toBe('-- CANDIDATE MIGRATION — NOT APPLIED LIVE.');
    expect((sql.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((sql.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
    expect(sql.indexOf('\nBEGIN;')).toBeLessThan(sql.indexOf('\nCOMMIT;'));
  });

  it('2. changes exactly the six authored files, not the workflow hook or generated types', () => {
    const out = execFileSync('git', ['diff', '--name-only', `${START_GATE}..${PHASE_END}`], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    const changed = out.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(changed.sort()).toEqual([...AUTHORED_FILES].sort());
    expect(changed).not.toContain(WORKFLOW_REL);
    expect(changed).not.toContain(GENERATED_TYPES);
  });
});

describe('AM-1C-D — SQL redefinition surface', () => {
  const definitions = [
    ...executableLower.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/g),
  ].map((m) => m[1]);

  it('3. redefines exactly the three delegation functions', () => {
    expect(definitions.sort()).toEqual(
      [
        'create_agency_delegation_request',
        'list_agency_delegations',
        'revoke_agency_delegation',
      ].sort(),
    );
  });

  it('4. does not redefine driver-owned or unrelated consumer objects', () => {
    for (const forbidden of [
      'driver_decide_delegation',
      'list_my_pending_delegations',
      'is_agency_owner_or_admin',
      'current_user_has_agency_permission',
      'get_my_agency_permissions',
      'set_agency_member_permissions',
      'list_agency_clients',
      'list_agency_client_requests',
      'set_agency_client_request_status',
      'create_agency_package',
      'update_agency_package',
      'clean_assistant_permissions',
      'assert_agency_limit',
      '_agency_member_paid_operational_authority',
    ]) {
      expect(definitions).not.toContain(forbidden);
    }
  });

  it('5. no role-label shortcut survives anywhere in the candidate', () => {
    expect(executableLower).not.toContain('is_agency_owner_or_admin');
    expect(executableLower).not.toContain("'agency_admin'");
  });

  it('6. contains no DML policy, grant change, schema or data migration', () => {
    for (const forbidden of [
      'grant ',
      'revoke ',
      'for insert',
      'for update',
      'for delete',
      'for all',
      'create table',
      'alter table',
      'create type',
      'alter type',
      'create index',
      'create trigger',
      'delete from public.agency_delegation_requests',
    ]) {
      expect(executableLower).not.toContain(forbidden);
    }
  });
});

describe('AM-1C-D — list_agency_delegations', () => {
  it('7. gates broad listing on delegations_view and preserves shape/ordering', () => {
    expect(executable).toContain(
      'CREATE OR REPLACE FUNCTION public.list_agency_delegations(_agency_id uuid)',
    );
    expect(executable).toContain('RETURNS SETOF agency_delegation_requests');
    expect(executable).toContain('STABLE SECURITY DEFINER');
    expect(executable).toContain("SET search_path TO 'public'");
    expect(executable).toContain(
      "public.current_user_has_agency_permission(_agency_id,'delegations_view')",
    );
    expect(executable).toContain('ORDER BY created_at DESC;');
  });
});

describe('AM-1C-D — create_agency_delegation_request', () => {
  const body = executable.slice(
    executable.indexOf('CREATE OR REPLACE FUNCTION public.create_agency_delegation_request'),
    executable.indexOf('CREATE OR REPLACE FUNCTION public.revoke_agency_delegation'),
  );

  it('8. gates creation on delegations_manage with no client_requests_manage requirement', () => {
    expect(body).toContain(
      "public.current_user_has_agency_permission(_req.agency_id,'delegations_manage')",
    );
    expect(body).not.toContain('client_requests_manage');
    expect(body.toLowerCase()).not.toContain('is_agency_owner_or_admin');
  });

  it('9. preserves plan limit, statuses, active member, paid authority, cleaning, transition, audit', () => {
    expect(body).toContain("public.assert_agency_limit(_req.agency_id,'create_delegation_request')");
    expect(body).toContain("_req.status NOT IN ('pending','approved')");
    expect(body).toContain("status='active'");
    expect(body).toContain(
      'public._agency_member_paid_operational_authority(_req.agency_id,_mbr.member_user_id)',
    );
    expect(body).toContain('public.clean_assistant_permissions(_requested_permissions)');
    expect(body).toContain('INSERT INTO public.agency_delegation_requests');
    expect(body).toContain('UPDATE public.agency_client_requests SET status=');
    expect(body).toContain('assigned_member_user_id=_mbr.member_user_id');
    expect(body).toContain("'delegation_request_created'");
    expect(body).toContain('RETURN _row;');
  });

  it('10. preserves error codes', () => {
    expect(body).toContain("ERRCODE='42501'");
    expect(body).toContain("ERRCODE='42704'");
    expect(body).toContain("ERRCODE='22023'");
  });
});

describe('AM-1C-D — revoke_agency_delegation', () => {
  const body = executable.slice(
    executable.indexOf('CREATE OR REPLACE FUNCTION public.revoke_agency_delegation'),
  );

  it('11. driver self-revoke branch stays independent of Agency delegations_manage', () => {
    const driverIdx = body.indexOf('_is_driver := (_d.driver_user_id = _uid);');
    const manageIdx = body.indexOf(
      "public.current_user_has_agency_permission(_d.agency_id,'delegations_manage')",
    );
    expect(driverIdx).toBeGreaterThan(-1);
    expect(manageIdx).toBeGreaterThan(driverIdx);
    expect(body).toContain('IF NOT (_is_driver OR _can_manage_delegations) THEN');
    expect(body.toLowerCase()).not.toContain('is_agency_owner_or_admin');
  });

  it('12. preserves idempotency, driver_assistants sync, token clearing and both audits', () => {
    expect(body).toContain("IF _d.status = 'revoked' THEN RETURN _d; END IF;");
    expect(body).toContain('UPDATE public.driver_assistants');
    expect(body).toContain('invite_token_hash=NULL');
    expect(body).toContain("status IN ('active','pending')");
    expect(body).toContain('INSERT INTO public.agency_audit_log');
    expect(body).toContain("'delegation_revoked_by_driver'");
    expect(body).toContain("'delegation_revoked_by_agency'");
    expect(body).toContain('INSERT INTO public.assistant_audit_log');
    expect(body).toContain("'assistant_revoked'");
    expect(body).toContain('synced_assistant_id');
  });
});

describe('AM-1C-D — delegation SELECT RLS', () => {
  it('13. drops only adr_agency_admin_select and adds one delegations_view SELECT policy', () => {
    expect(executable).toContain(
      'DROP POLICY IF EXISTS adr_agency_admin_select ON public.agency_delegation_requests;',
    );
    expect((executableLower.match(/drop\s+policy/g) ?? []).length).toBe(1);
    expect((executableLower.match(/create\s+policy/g) ?? []).length).toBe(1);
    expect(executable).toContain('CREATE POLICY adr_workspace_view_select');
    expect(executable).toContain('FOR SELECT');
    expect(executable).toContain('TO authenticated');
    expect(executable).toContain(
      "USING (public.current_user_has_agency_permission(agency_id,'delegations_view'))",
    );
  });

  it('14. does not touch adr_driver_select or adr_member_select', () => {
    expect(executableLower).not.toContain('adr_driver_select');
    expect(executableLower).not.toContain('adr_member_select');
    expect(executableLower).not.toContain('alter policy');
  });
});

describe('AM-1C-D — permission hook', () => {
  it('15. preserves prior booleans and adds fail-closed delegation booleans', () => {
    expect(hookSource).toContain('canViewPackages: settled && resolved.packages_view === true');
    expect(hookSource).toContain('canManagePackages: settled && resolved.packages_manage === true');
    expect(hookSource).toContain(
      'canViewClientRequests: settled && resolved.client_requests_view === true',
    );
    expect(hookSource).toContain(
      'canManageClientRequests: settled && resolved.client_requests_manage === true',
    );
    expect(hookSource).toContain('canViewClients: settled && resolved.clients_view === true');
    expect(hookSource).toContain(
      'canViewDelegations: settled && resolved.delegations_view === true',
    );
    expect(hookSource).toContain(
      'canManageDelegations: settled && resolved.delegations_manage === true',
    );
    expect(hookSource).toContain('canViewDelegations: boolean;');
    expect(hookSource).toContain('canManageDelegations: boolean;');
  });

  it('16. never infers permission from a role label', () => {
    expect(hookSource).not.toMatch(/agency_admin|agency_owner|my_role/);
  });
});

describe('AM-1C-D — ClientRequestsSection', () => {
  const code = stripComments(requestsSource);

  it('17. drops the role-derived prop and consumes canManageDelegations', () => {
    expect(code).not.toContain('canCreateDelegation');
    expect(code).toContain('export function ClientRequestsSection({ agencyId }: { agencyId: string })');
    expect(code).toContain('canManageDelegations,');
    expect(code).toContain('{canManageDelegations && (');
    expect(code).toContain('{canManageDelegations && open && (');
    expect(code).not.toMatch(/agency_admin|agency_owner|my_role/);
  });

  it('18. request list visibility remains client_requests_view only', () => {
    expect(code).toContain('useAgencyClientRequests(agencyId, {\n    enabled: canViewClientRequests,\n  })');
    const listGate = code.slice(code.indexOf('!canViewClientRequests ?'), code.indexOf('<ClientRequestRow'));
    expect(listGate).not.toContain('canManageDelegations');
  });

  it('19. package fallback query is disabled without packages_view', () => {
    expect(code).toContain('useAgencyPackages(agencyId, { enabled: canViewPackages })');
    expect(code).toContain('canViewPackages,');
    expect(code).toContain('req.requested_permissions');
    expect(code).toContain('pkg?.recommended_permissions ?? {}');
  });
});

describe('AM-1C-D — ClientListSection', () => {
  const code = stripComments(clientsSource);

  it('20. End access requires canManageDelegations', () => {
    expect(code).toContain('canManageDelegations: boolean;');
    expect(code).not.toContain('canRevokeDelegation');
    const gateIdx = code.indexOf('{canManageDelegations && (');
    const revokeIdx = code.indexOf('<RevokeClientButton');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(revokeIdx);
  });

  it('21. clients_view is never revoke authority and no second permission query is added', () => {
    expect(code).not.toContain('clients_view');
    expect(code).not.toContain('canViewClients');
    expect(code).not.toContain('useAgencyWorkspacePermissions');
  });
});

describe('AM-1C-D — dashboard gating', () => {
  it('22. no role-derived delegation authority is passed anymore', () => {
    expect(dashboardSource).not.toContain('canCreateDelegation');
    expect(dashboardSource).not.toContain('canRevokeDelegation');
    expect(dashboardSource).toContain('canManageDelegations,');
    expect(dashboardSource).toContain('canManageDelegations={canManageDelegations}');
    expect(dashboardSource).toContain('<ClientRequestsSection agencyId={agency.id} />');
  });

  it('23. prior tab gating and later-phase transitional rules are unchanged', () => {
    expect(dashboardSource).toContain('const showPackages = canViewPackages || canManagePackages;');
    expect(dashboardSource).toContain(
      'const showRequests = canViewClientRequests || canManageClientRequests;',
    );
    expect(dashboardSource).toContain("{ value: 'clients', label: 'Clients', show: canViewClients }");
    expect(dashboardSource).toContain("{ value: 'activity', label: 'Activity', show: isOwner }");
    // Work items are a later consumer and keep the transitional role mirror.
    expect(dashboardSource).toContain('canManage={isOwnerOrAdmin}');
    // No Delegations product surface is introduced in this phase.
    expect(dashboardSource).not.toContain("value: 'delegations'");
  });
});
