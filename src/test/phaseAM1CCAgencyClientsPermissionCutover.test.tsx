/**
 * Phase AM-1C-C — Agency Clients permission consumer cutover.
 *
 * Deterministic source/SQL contract test. The candidate migration is NOT
 * applied live; these assertions read the candidate text and the authored
 * frontend sources.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const START_GATE = '8f20c71c032042422a97f0d281f46463df1eefe0';

const SQL_PATH = path.resolve(
  process.cwd(),
  'supabase/migration-candidates/20260818043500_phase_am1cc_agency_clients_permission_cutover.sql',
);
const HOOK_PATH = path.resolve(process.cwd(), 'src/hooks/useAgencyWorkspacePermissions.ts');
const WORKFLOW_PATH = path.resolve(process.cwd(), 'src/hooks/useAgencyWorkflow.ts');
const SECTION_PATH = path.resolve(process.cwd(), 'src/components/agency/ClientListSection.tsx');
const DASHBOARD_PATH = path.resolve(process.cwd(), 'src/pages/AgencyDashboard.tsx');

const sql = readFileSync(SQL_PATH, 'utf8');
const hookSource = readFileSync(HOOK_PATH, 'utf8');
const sectionSource = readFileSync(SECTION_PATH, 'utf8');
const dashboardSource = readFileSync(DASHBOARD_PATH, 'utf8');

/** Executable SQL only: `--` line comments stripped. */
const executable = sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const executableLower = executable.toLowerCase();

const AM1CC_AUTHORED_FILES = [
  'supabase/migration-candidates/20260818043500_phase_am1cc_agency_clients_permission_cutover.sql',
  'src/hooks/useAgencyWorkspacePermissions.ts',
  'src/components/agency/ClientListSection.tsx',
  'src/pages/AgencyDashboard.tsx',
  'src/test/phaseAM1CCAgencyClientsPermissionCutover.test.tsx',
];

const GENERATED_TYPES = 'src/integrations/supabase/types.ts';
const WORKFLOW_REL = 'src/hooks/useAgencyWorkflow.ts';

describe('AM-1C-C — candidate envelope and authored scope', () => {
  it('1. is marked as a candidate and is exactly one explicit transaction', () => {
    expect(sql.split('\n')[0].trim()).toBe('-- CANDIDATE MIGRATION — NOT APPLIED LIVE.');
    expect((sql.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((sql.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
    expect(sql.indexOf('\nBEGIN;')).toBeLessThan(sql.indexOf('\nCOMMIT;'));
  });

  it('12/13. changes exactly the five authored files, not the workflow hook or generated types', () => {
    const out = execFileSync('git', ['diff', '--name-only', `${START_GATE}..HEAD`], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    const changed = out.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(changed.sort()).toEqual([...AM1CC_AUTHORED_FILES].sort());
    expect(changed).not.toContain(GENERATED_TYPES);
    expect(changed).not.toContain(WORKFLOW_REL);
  });
});

describe('AM-1C-C — SQL redefinition surface', () => {
  const definitions = [
    ...executableLower.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/g),
  ].map((m) => m[1]);

  it('2. replaces exactly one function: list_agency_clients', () => {
    expect(definitions).toEqual(['list_agency_clients']);
  });

  it('7. does not redefine delegation, client-request, package, AM-1B or role-helper objects', () => {
    for (const forbidden of [
      'revoke_agency_delegation',
      'list_agency_delegations',
      'create_agency_delegation_request',
      'list_agency_client_requests',
      'set_agency_client_request_status',
      'submit_agency_client_request',
      'create_agency_package',
      'update_agency_package',
      'current_user_has_agency_permission',
      'get_my_agency_permissions',
      'set_agency_member_permissions',
      'is_agency_owner_or_admin',
    ]) {
      expect(definitions).not.toContain(forbidden);
    }
  });

  it('6. contains no RLS, grant/revoke, DML or schema/type change', () => {
    for (const forbidden of [
      'create policy',
      'drop policy',
      'alter policy',
      'row level security',
      'grant ',
      'revoke ',
      'insert into',
      'update ',
      'delete from',
      'create table',
      'alter table',
      'create type',
      'alter type',
      'create index',
      'create trigger',
    ]) {
      expect(executableLower).not.toContain(forbidden);
    }
  });
});

describe('AM-1C-C — list_agency_clients authorization contract', () => {
  it('3. broad branch uses clients_view and drops the role-label shortcut', () => {
    expect(executable).toContain(
      "public.current_user_has_agency_permission(_agency_id,'clients_view')",
    );
    expect(executableLower).not.toContain('is_agency_owner_or_admin');
  });

  it("4. narrow assigned-member branch is preserved with no role or clients_view requirement", () => {
    expect(executable).toContain('d.member_user_id = auth.uid()');
    expect(executable).toContain('FROM public.agency_members m');
    expect(executable).toContain("m.status = 'active'");
    expect(executable).toContain('m.member_user_id = auth.uid()');

    const narrow = executable.slice(
      executable.indexOf('d.member_user_id = auth.uid()'),
      executable.indexOf('ORDER BY d.driver_user_id'),
    );
    expect(narrow).not.toContain('clients_view');
    expect(narrow.toLowerCase()).not.toContain('m.role');
    expect(narrow.toLowerCase()).not.toContain('agency_admin');
  });

  it('5. preserves signature, properties, projection, joins, approved filter and ordering', () => {
    expect(executable).toContain(
      'CREATE OR REPLACE FUNCTION public.list_agency_clients(_agency_id uuid)',
    );
    expect(executable).toContain(
      'LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public',
    );
    expect(executable).toContain('SELECT DISTINCT ON (d.driver_user_id)');
    expect(executable).toContain("d.agency_id=_agency_id AND d.status='approved'");
    expect(executable).toContain('LEFT JOIN auth.users u ON u.id = d.driver_user_id');
    expect(executable).toContain('LEFT JOIN public.profiles p ON p.user_id = d.driver_user_id');
    expect(executable).toContain(
      'LEFT JOIN public.agency_client_requests r ON r.id = d.client_request_id',
    );
    expect(executable).toContain(
      'LEFT JOIN public.agency_service_packages pk ON pk.id = r.selected_package_id',
    );
    expect(executable).toContain('GREATEST(d.decided_at, d.updated_at), d.id');
    expect(executable).toContain(
      'ORDER BY d.driver_user_id, d.decided_at DESC NULLS LAST;',
    );
    for (const col of [
      'driver_user_id uuid',
      'driver_email text',
      'driver_name text',
      'member_user_id uuid',
      'member_email text',
      'package_id uuid',
      'package_name text',
      'last_activity_at timestamptz',
      'delegation_id uuid',
    ]) {
      expect(executable).toContain(col);
    }
  });
});

describe('AM-1C-C — permission hook', () => {
  it('8. preserves prior booleans and adds fail-closed canViewClients', () => {
    expect(hookSource).toContain('canViewPackages: settled && resolved.packages_view === true');
    expect(hookSource).toContain(
      'canManagePackages: settled && resolved.packages_manage === true',
    );
    expect(hookSource).toContain(
      'canViewClientRequests: settled && resolved.client_requests_view === true',
    );
    expect(hookSource).toContain(
      'canManageClientRequests: settled && resolved.client_requests_manage === true',
    );
    expect(hookSource).toContain('canViewClients: settled && resolved.clients_view === true');
    expect(hookSource).toContain('canViewClients: boolean;');
  });

  it('8b. never infers permission from a role label', () => {
    expect(hookSource).not.toMatch(/agency_admin|agency_owner|my_role/);
  });
});

describe('AM-1C-C — dashboard gating', () => {
  it('9. Clients tab and content are gated by canViewClients, not isOwnerOrAdmin', () => {
    expect(dashboardSource).toContain("{ value: 'clients', label: 'Clients', show: canViewClients }");
    expect(dashboardSource).toContain('{canViewClients && (');
    expect(dashboardSource).not.toContain('{isOwnerOrAdmin && (');
    expect(dashboardSource).toContain('canViewClients,');
  });

  it('10. passes canRevokeDelegation as transitional delegation authorization only', () => {
    expect(dashboardSource).toContain('canRevokeDelegation={isOwnerOrAdmin}');
    // AM-1C-A/B gating is unchanged.
    expect(dashboardSource).toContain('const showPackages = canViewPackages || canManagePackages;');
    expect(dashboardSource).toContain(
      'const showRequests = canViewClientRequests || canManageClientRequests;',
    );
    expect(dashboardSource).toContain('canCreateDelegation={isOwnerOrAdmin}');
    // Surfaces not yet cut over keep the role mirror.
    expect(dashboardSource).toContain('canManage={isOwnerOrAdmin}');
  });
});

describe('AM-1C-C — ClientListSection', () => {
  it('11. requires canRevokeDelegation and hides End access when false', () => {
    expect(sectionSource).toContain('canRevokeDelegation: boolean;');
    expect(sectionSource).toContain('{canRevokeDelegation && (');
    const revokeIdx = sectionSource.indexOf('<RevokeClientButton');
    const gateIdx = sectionSource.indexOf('{canRevokeDelegation && (');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(revokeIdx);
  });

  it('11b. never treats clients_view as revoke authority and adds no second permission query', () => {
    expect(sectionSource).not.toContain('clients_view');
    expect(sectionSource).not.toContain('useAgencyWorkspacePermissions');
    expect(sectionSource).toContain('useRevokeAgencyDelegation');
    expect(sectionSource).toContain('revoke.mutateAsync(delegationId)');
  });
});
