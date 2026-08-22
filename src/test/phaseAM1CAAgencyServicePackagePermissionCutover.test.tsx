/**
 * Phase AM-1C-A — Agency Service Package permission consumer cutover.
 *
 * Deterministic source/SQL contract test. The candidate migration is NOT
 * applied live; these assertions read the candidate text and the authored
 * frontend sources.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const START_GATE = '9c84c1a78e6a5ccfe494673464bc59e72e0e32e5';
/** Immutable AM-1C-A phase-end commit. The envelope is a historical fact. */
const PHASE_END = 'd511072baee7974321317dbb36c339ecfb9711df';

const SQL_PATH = path.resolve(
  process.cwd(),
  'supabase/migration-candidates/20260817040500_phase_am1ca_agency_service_package_permission_cutover.sql',
);
const HOOK_PATH = path.resolve(process.cwd(), 'src/hooks/useAgencyWorkspacePermissions.ts');
const WORKFLOW_PATH = path.resolve(process.cwd(), 'src/hooks/useAgencyWorkflow.ts');
const SECTION_PATH = path.resolve(
  process.cwd(),
  'src/components/agency/ServicePackagesSection.tsx',
);

const sql = readFileSync(SQL_PATH, 'utf8');
const hookSource = readFileSync(HOOK_PATH, 'utf8');
const workflowSource = readFileSync(WORKFLOW_PATH, 'utf8');
const sectionSource = readFileSync(SECTION_PATH, 'utf8');

/** Executable SQL only: `--` line comments stripped. */
const executable = sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const executableLower = executable.toLowerCase();

const AM1CA_AUTHORED_FILES = [
  'supabase/migration-candidates/20260817040500_phase_am1ca_agency_service_package_permission_cutover.sql',
  'src/hooks/useAgencyWorkspacePermissions.ts',
  'src/hooks/useAgencyWorkflow.ts',
  'src/components/agency/ServicePackagesSection.tsx',
  'src/test/phaseAM1CAAgencyServicePackagePermissionCutover.test.tsx',
];

const GENERATED_TYPES = 'src/integrations/supabase/types.ts';

describe('AM-1C-A — candidate envelope and authored scope', () => {
  it('1. is marked as a candidate and is exactly one explicit transaction', () => {
    expect(sql.split('\n')[0].trim()).toBe('-- CANDIDATE MIGRATION — NOT APPLIED LIVE.');
    expect((sql.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((sql.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
    expect(sql.indexOf('\nBEGIN;')).toBeLessThan(sql.indexOf('\nCOMMIT;'));
  });

  it('14. changes exactly the five authored files and no generated type file', () => {
    const out = execFileSync('git', ['diff', '--name-only', `${START_GATE}..${PHASE_END}`], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    const status = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    const changed = [
      ...out.split('\n'),
      ...status.split('\n').map((l) => l.slice(3)),
    ]
      .map((l) => l.trim())
      .filter(Boolean);
    const unique = [...new Set(changed)];
    expect(unique).not.toContain(GENERATED_TYPES);
    expect(unique.sort()).toEqual([...AM1CA_AUTHORED_FILES].sort());
  });
});

describe('AM-1C-A — package RPC authorization cutover', () => {
  const createFns = executableLower.match(/create or replace function public\.([a-z0-9_]+)/g) ?? [];

  it('2. replaces exactly the two package RPCs and nothing else', () => {
    const names = createFns.map((m) => m.split('public.')[1]);
    expect(names.sort()).toEqual(['create_agency_package', 'update_agency_package']);
  });

  it('3. both package RPCs gate on exact packages_manage with no role shortcut', () => {
    const gates =
      executable.match(
        /public\.current_user_has_agency_permission\(\s*_(agency_id|old\.agency_id)\s*,\s*'packages_manage'\s*\)/g,
      ) ?? [];
    expect(gates.length).toBe(2);
    expect(executable).not.toMatch(/is_agency_owner_or_admin/);
    expect(executable).not.toMatch(/is_agency_member\s*\(/);
    expect(executableLower).not.toContain('agency_admin');
    expect(executableLower).not.toContain('agency_member_role');
    expect(executable).toContain('auth.uid()');
  });

  it('4. preserves validation, billing limit, permission cleaning and audit actions', () => {
    expect(executable).toContain("public.assert_agency_limit(_agency_id, 'create_service_package')");
    expect(executable).toContain(
      "public.assert_agency_limit(_old.agency_id, 'create_service_package')",
    );
    expect((executable.match(/public\.clean_assistant_permissions\(/g) ?? []).length).toBe(2);
    expect(executable).toContain("RAISE EXCEPTION 'Package name required' USING ERRCODE='22023'");
    expect(executable).toContain("RAISE EXCEPTION 'Package not found' USING ERRCODE='42704'");
    expect(executable).toContain("'package_created'");
    expect(executable).toContain("'package_updated'");
    expect(executable).toContain("'package_deactivated'");
    expect((executable.match(/agency_audit_log/g) ?? []).length).toBe(2);
  });
});

describe('AM-1C-A — package SELECT RLS cutover', () => {
  it('5. drops both legacy workspace policies and creates exactly one packages_view SELECT policy', () => {
    expect(executable).toContain(
      'DROP POLICY IF EXISTS asp_member_select ON public.agency_service_packages;',
    );
    expect(executable).toContain(
      'DROP POLICY IF EXISTS asp_owner_admin_select ON public.agency_service_packages;',
    );
    const created = executable.match(/CREATE POLICY\s+([a-z0-9_]+)/gi) ?? [];
    expect(created.length).toBe(1);
    expect(executableLower).toContain('for select');
    expect(executableLower).toContain('to authenticated');
    expect(executable).toContain(
      "public.current_user_has_agency_permission(agency_id, 'packages_view')",
    );
  });

  it('6. adds no package INSERT/UPDATE/DELETE/ALL policy', () => {
    expect(executableLower).not.toMatch(/for\s+(insert|update|delete|all)\b/);
    expect(executableLower).not.toContain('with check');
  });
});

describe('AM-1C-A — prohibited SQL scope', () => {
  it('7. does not redefine is_agency_owner_or_admin or any AM-1B contract function', () => {
    for (const fn of [
      'is_agency_owner_or_admin',
      'current_user_has_agency_permission',
      'get_my_agency_permissions',
      'set_agency_member_permissions',
    ]) {
      expect(executableLower).not.toContain(`function public.${fn}`);
    }
  });

  it('8. does not redefine the public driver package discovery RPC', () => {
    expect(executableLower).not.toContain('list_agency_packages_public');
  });

  it('9. touches no unrelated Agency / assistant / recruiter / billing consumer', () => {
    for (const forbidden of [
      'driver_assistants',
      'assistant_audit_log',
      'agency_delegation_requests',
      'agency_client_requests',
      'agency_work_items',
      'agency_members',
      'agency_entitlements',
      'agency_profiles',
      'recruiter_',
      'stripe',
      'driver_settlements',
      'subscriptions',
      'grant ',
      'revoke ',
      'create type',
      'alter table',
    ]) {
      expect(executableLower).not.toContain(forbidden);
    }
  });
});

describe('AM-1C-A — permission hook contract', () => {
  it('10. uses get_my_agency_permissions, strict parser, user+agency key, fail-closed booleans', () => {
    expect(hookSource).toContain("'get_my_agency_permissions'");
    expect(hookSource).toContain('parseAgencyWorkspacePermissions');
    expect(hookSource).toContain('emptyAgencyWorkspacePermissions');
    expect(hookSource).toContain(
      "queryKey: ['agency-workspace-permissions', userId, agencyId]",
    );
    expect(hookSource).toContain('enabled = !!userId && !!agencyId');
    expect(hookSource).toContain('settled && resolved.packages_view === true');
    expect(hookSource).toContain('settled && resolved.packages_manage === true');
    // No role presets or role inference.
    expect(hookSource).not.toContain('my_role');
    expect(hookSource).not.toContain('agency_admin');
  });
});

describe('AM-1C-A — package query and UI gating', () => {
  it('11. non-public package query is disableable before the direct table read; public path unchanged', () => {
    expect(workflowSource).toContain(
      "opts?: { publicView?: boolean; enabled?: boolean },",
    );
    expect(workflowSource).toContain(
      "const permissionGateOpen = opts?.publicView ? true : opts?.enabled !== false;",
    );
    expect(workflowSource).toContain('enabled: !!agencyId && permissionGateOpen,');
    // Public discovery RPC and mutation RPC names are unchanged.
    expect(workflowSource).toContain("'list_agency_packages_public'");
    expect(workflowSource).toContain("rpc('create_agency_package'");
    expect(workflowSource).toContain("rpc('update_agency_package'");
  });

  it('12. section gates the private read with canViewPackages and mutations with canManagePackages', () => {
    expect(sectionSource).toContain('useAgencyWorkspacePermissions(agencyId)');
    expect(sectionSource).toContain('useAgencyPackages(agencyId, {');
    expect(sectionSource).toContain('enabled: canViewPackages,');
    expect(sectionSource).toContain('canManagePackages && (');
    expect(sectionSource).toContain('canManage={canManagePackages}');
    expect(sectionSource).toContain('{canManage && <PackageEditorDialog');
    // Neutral loading + fail-closed error states.
    expect(sectionSource).toContain('permissionsLoading ?');
    expect(sectionSource).toContain('permissionsError ?');
    // Role labels are never consulted for gating.
    expect(sectionSource).not.toContain('agency_admin');
    expect(sectionSource).not.toContain('my_role');
  });

  it('13. manage does not imply view in source logic', () => {
    expect(sectionSource).not.toContain('canViewPackages || canManagePackages ?');
    expect(sectionSource).toContain('!canViewPackages && !canManagePackages ?');
    expect(sectionSource).toContain('{!canViewPackages ? (');
    expect(hookSource).not.toContain('packages_view: true');
  });

  it('billing-cancelled creation behavior is preserved and is not a permission', () => {
    expect(sectionSource).toContain("entitlement.status === 'cancelled'");
    expect(sectionSource).toContain('const createDisabled = billingCancelled || !canManagePackages;');
  });
});
