/**
 * Phase AM-1C-FG — Agency Audit + Team READ-ONLY workspace-permission cutover.
 *
 * Deterministic source/SQL contract test. The candidate migration is NOT
 * applied live and no managed migration is authored; these assertions read the
 * candidate text and the authored sources only.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/** Accepted pre-phase tree (recorded AM-1C-E live migration state). */
const START_GATE = '7ed7f6f75b32be1dcfe0f34d9fbb13ecbbc36acf';

const SQL_REL =
  'supabase/migration-candidates/20260818090000_phase_am1cfg_agency_audit_team_read_permission_cutover.sql';
const HOOK_REL = 'src/hooks/useAgencyWorkspacePermissions.ts';
const DASHBOARD_REL = 'src/pages/AgencyDashboard.tsx';
const TEST_REL = 'src/test/phaseAM1CFGAgencyAuditTeamReadPermissionCutover.test.tsx';

const MANAGED_FG_REL =
  'supabase/migrations/20260818090000_phase_am1cfg_agency_audit_team_read_permission_cutover.sql';

const AGENCY_HOOK_REL = 'src/hooks/useAgency.ts';
const WORKFLOW_REL = 'src/hooks/useAgencyWorkflow.ts';
const AUDIT_SECTION_REL = 'src/components/agency/AgencyAuditSection.tsx';
const VOCAB_REL = 'src/lib/agencyWorkspacePermissions.ts';
const GENERATED_TYPES = 'src/integrations/supabase/types.ts';

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), 'utf8');

const sql = read(SQL_REL);
const hookSource = read(HOOK_REL);
const dashboardSource = read(DASHBOARD_REL);

/** Executable SQL only: `--` line comments stripped. */
const executable = sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const executableLower = executable.toLowerCase();

const AUTHORED_FILES = [SQL_REL, HOOK_REL, DASHBOARD_REL, TEST_REL];

const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');

const hookCode = stripComments(hookSource);
const dashboardCode = stripComments(dashboardSource);

/** Body of a single `CREATE OR REPLACE FUNCTION public.<name>` statement. */
function fnBody(name: string): string {
  const start = executableLower.indexOf(`create or replace function public.${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = executable.slice(start);
  const end = rest.indexOf('$function$;');
  expect(end).toBeGreaterThan(0);
  return rest.slice(0, end + '$function$;'.length);
}

describe('AM-1C-FG — candidate envelope and authored scope', () => {
  it('1. is marked as a candidate and is exactly one explicit transaction', () => {
    expect(sql.split('\n')[0].trim()).toBe('-- CANDIDATE MIGRATION — NOT APPLIED LIVE.');
    expect((sql.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((sql.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
    expect(sql.indexOf('\nBEGIN;')).toBeLessThan(sql.indexOf('\nCOMMIT;'));
  });

  it('2. changes exactly the four authored files and no prohibited file', () => {
    const out = execFileSync('git', ['diff', '--name-only', `${START_GATE}..HEAD`], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    const changed = out.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(changed.sort()).toEqual([...AUTHORED_FILES].sort());
    for (const forbidden of [
      AGENCY_HOOK_REL,
      WORKFLOW_REL,
      AUDIT_SECTION_REL,
      VOCAB_REL,
      GENERATED_TYPES,
    ]) {
      expect(changed).not.toContain(forbidden);
    }
  });

  it('3. authors no managed migration for the FG timestamp', () => {
    expect(existsSync(path.resolve(process.cwd(), MANAGED_FG_REL))).toBe(false);
  });
});

describe('AM-1C-FG — SQL redefinition surface', () => {
  const definitions = [
    ...executableLower.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/g),
  ].map((m) => m[1]);

  it('4. redefines exactly the two read functions', () => {
    expect(definitions.sort()).toEqual(
      ['list_agency_audit_log', 'list_agency_members'].sort(),
    );
  });

  it('5. creates no other function of any kind', () => {
    expect(executableLower).not.toMatch(/create\s+function/);
    expect(
      (executableLower.match(/create\s+or\s+replace\s+function/g) ?? []).length,
    ).toBe(2);
  });

  it('6. never redefines frozen owner-governance RPCs', () => {
    for (const frozen of [
      'invite_agency_member',
      'revoke_agency_member',
      'set_agency_member_permissions',
    ]) {
      expect(definitions).not.toContain(frozen);
    }
  });

  it('7. never redefines the resolver, map or role helper', () => {
    for (const frozen of [
      'current_user_has_agency_permission',
      'get_my_agency_permissions',
      'is_agency_owner_or_admin',
    ]) {
      expect(definitions).not.toContain(frozen);
    }
  });

  it('8. never redefines Driver Assistant / delegation / settlement surfaces', () => {
    for (const name of definitions) {
      expect(name).not.toMatch(/assistant/);
      expect(name).not.toMatch(/delegation/);
      expect(name).not.toMatch(/settlement/);
    }
    expect(executableLower).not.toContain('driver_assistants');
  });

  it('9. never redefines prior AM-1C consumer functions', () => {
    for (const prior of [
      'create_agency_package',
      'update_agency_package',
      'list_agency_clients',
      'list_agency_delegations',
      'list_agency_work_items',
      'create_agency_work_item',
      'update_agency_work_item',
    ]) {
      expect(definitions).not.toContain(prior);
    }
  });
});

describe('AM-1C-FG — audit log read authorization', () => {
  const body = fnBody('list_agency_audit_log');
  const lower = body.toLowerCase();

  it('10. gates on exact `audit_view`', () => {
    expect(body).toContain(
      "public.current_user_has_agency_permission(_agency_id,'audit_view')",
    );
  });

  it('11. drops the role helper and any role-label shortcut', () => {
    expect(lower).not.toContain('is_agency_owner_or_admin');
    expect(lower).not.toContain('agency_owner');
    expect(lower).not.toContain('agency_admin');
    expect(lower).not.toContain('agency_member');
  });

  it('12. composes no other permission key', () => {
    for (const other of [
      'team_view',
      'clients_view',
      'delegations_view',
      'delegations_manage',
      'packages_view',
      'work_items_view_all',
      'work_items_manage',
    ]) {
      expect(lower).not.toContain(other);
    }
  });

  it('13. preserves shape, filter, ordering and the limit expression', () => {
    expect(body).toContain('SELECT * FROM public.agency_audit_log');
    expect(body).toContain('WHERE agency_id=_agency_id');
    expect(body).toContain('ORDER BY created_at DESC');
    expect(body).toContain('LIMIT GREATEST(1, LEAST(COALESCE(_limit,100),500));');
  });

  it('14. preserves signature, language, security and search_path', () => {
    expect(body).toContain('(_agency_id uuid, _limit integer DEFAULT 100)');
    expect(body).toContain('RETURNS SETOF agency_audit_log');
    expect(body).toContain('LANGUAGE sql');
    expect(body).toContain('STABLE SECURITY DEFINER');
    expect(body).toContain("SET search_path TO 'public'");
  });
});

describe('AM-1C-FG — safe member read authorization', () => {
  const body = fnBody('list_agency_members');
  const lower = body.toLowerCase();

  it('15. composes exactly `team_view` OR exact self membership', () => {
    expect(body).toContain(
      "AND (public.current_user_has_agency_permission(_agency_id,'team_view')\n" +
        '          OR am.member_user_id=auth.uid())',
    );
  });

  it('16. removes the broad owner/role predicate', () => {
    expect(lower).not.toContain('is_agency_owner_or_admin');
    expect(lower).not.toContain('owner_user_id');
    expect(lower).not.toContain('agency_profiles');
    expect(lower).not.toContain('agency_admin');
  });

  it('17. introduces no `team_manage` and no settlement permission key', () => {
    expect(executableLower).not.toContain('team_manage');
    expect(executableLower).not.toContain('settlement');
  });


  it('18. preserves the SAFE projection exactly', () => {
    expect(body).toContain(
      'SELECT am.id, am.agency_id, am.member_user_id, am.invite_email, am.role, am.status,',
    );
    expect(body).toContain('am.invited_at, am.accepted_at, am.revoked_at');
  });

  it('19. never exposes internal member columns', () => {
    for (const internal of [
      'invite_token_hash',
      'invite_expires_at',
      'workspace_permissions',
      'created_at',
      'updated_at',
    ]) {
      expect(lower).not.toContain(internal);
    }
    expect(lower).not.toContain('select am.*');
    expect(lower).not.toContain('select *');
  });

  it('20. preserves signature, return columns, ordering and definer settings', () => {
    expect(body).toContain('public.list_agency_members(_agency_id uuid)');
    expect(body).toContain('RETURNS TABLE(id uuid, agency_id uuid, member_user_id uuid');
    expect(body).toContain('LANGUAGE sql');
    expect(body).toContain('STABLE SECURITY DEFINER');
    expect(body).toContain("SET search_path TO 'public'");
    expect(body).toContain('ORDER BY am.invited_at DESC;');
  });
});

describe('AM-1C-FG — RLS surface', () => {
  const drops = [...executableLower.matchAll(/drop\s+policy(?:\s+if\s+exists)?\s+([a-z0-9_]+)/g)].map(
    (m) => m[1],
  );
  const creates = [...executableLower.matchAll(/create\s+policy\s+([a-z0-9_]+)/g)].map((m) => m[1]);

  it('21. drops exactly the two broad role-based SELECT policies', () => {
    expect(drops.sort()).toEqual(
      ['aal_agency_admin_select', 'agency_members_owner_admin_select'].sort(),
    );
  });

  it('22. creates exactly one replacement policy, on the audit log', () => {
    expect(creates).toEqual(['aal_workspace_audit_view_select']);
    expect(executable).toContain(
      'CREATE POLICY aal_workspace_audit_view_select\n  ON public.agency_audit_log',
    );
    expect(executable).toContain('FOR SELECT\n  TO authenticated');
    expect(executable).toContain(
      "USING (public.current_user_has_agency_permission(agency_id,'audit_view'))",
    );
  });

  it('23. deliberately creates NO broad team_view policy on agency_members', () => {
    for (const created of creates) {
      expect(created).not.toContain('agency_members');
      expect(created).not.toContain('team');
    }
    const memberPolicyBlocks = executableLower
      .split(/create\s+policy\s+/)
      .slice(1)
      .filter((block) => block.includes('public.agency_members'));
    expect(memberPolicyBlocks).toHaveLength(0);
  });

  it('24. preserves the narrow policies by never dropping them', () => {
    expect(drops).not.toContain('aal_driver_select_own');
    expect(drops).not.toContain('agency_members_self_select');
  });

  it('25. adds no DML policy and changes no grants', () => {
    expect(executableLower).not.toMatch(/for\s+(insert|update|delete|all)\b/);
    expect(executableLower).not.toMatch(/\bwith\s+check\b/);
    expect(executableLower).not.toMatch(/\bgrant\b/);
    expect(executableLower).not.toMatch(/\brevoke\b/);
  });

  it('26. alters no table and creates no enum value', () => {
    expect(executableLower).not.toMatch(/alter\s+table/);
    expect(executableLower).not.toMatch(/alter\s+type/);
    expect(executableLower).not.toMatch(/create\s+type/);
  });
});

describe('AM-1C-FG — permission hook', () => {
  it('27. declares the two exact read booleans on the state interface', () => {
    expect(hookCode).toMatch(/canViewAudit:\s*boolean;/);
    expect(hookCode).toMatch(/canViewTeam:\s*boolean;/);
  });

  it('28. resolves both fail-closed on exact boolean true', () => {
    expect(hookCode).toContain('canViewAudit: settled && resolved.audit_view === true,');
    expect(hookCode).toContain('canViewTeam: settled && resolved.team_view === true,');
  });

  it('29. preserves every prior AM-1C boolean', () => {
    for (const prior of [
      'canViewPackages: settled && resolved.packages_view === true,',
      'canManagePackages: settled && resolved.packages_manage === true,',
      'canViewClientRequests: settled && resolved.client_requests_view === true,',
      'canManageClientRequests: settled && resolved.client_requests_manage === true,',
      'canViewClients: settled && resolved.clients_view === true,',
      'canViewDelegations: settled && resolved.delegations_view === true,',
      'canManageDelegations: settled && resolved.delegations_manage === true,',
      'canViewAllWorkItems: settled && resolved.work_items_view_all === true,',
      'canManageWorkItems: settled && resolved.work_items_manage === true,',
    ]) {
      expect(hookCode).toContain(prior);
    }
  });

  it('30. never inspects a role label and exposes no team_manage', () => {
    expect(hookCode).not.toContain('agency_owner');
    expect(hookCode).not.toContain('agency_admin');
    expect(hookCode).not.toContain('my_role');
    expect(hookCode).not.toContain('team_manage');
    expect(hookCode).not.toContain('canManageTeam');
  });
});

describe('AM-1C-FG — dashboard Activity gating', () => {
  it('31. destructures both FG booleans from the permission hook', () => {
    expect(dashboardCode).toContain('canViewAudit,');
    expect(dashboardCode).toContain('canViewTeam,');
  });

  it('32. gates the Activity tab on canViewAudit, not isOwner', () => {
    expect(dashboardCode).toContain(
      "{ value: 'activity', label: 'Activity', show: canViewAudit },",
    );
    expect(dashboardCode).not.toContain(
      "{ value: 'activity', label: 'Activity', show: isOwner },",
    );
  });

  it('33. gates the Activity content render on canViewAudit', () => {
    expect(dashboardCode).toMatch(
      /\{canViewAudit && \(\s*<TabsContent value="activity">/,
    );
    expect(dashboardCode).not.toMatch(
      /\{isOwner && \(\s*<TabsContent value="activity">/,
    );
  });
});

describe('AM-1C-FG — dashboard Team read-only presentation', () => {
  it('34. passes canViewTeam into the member card', () => {
    expect(dashboardCode).toContain(
      '<AgencyDetailCard agency={agency} canViewTeam={canViewTeam} />',
    );
    expect(dashboardCode).toMatch(/canViewTeam:\s*boolean;/);
  });

  it('35. keeps the member card mounted regardless of canViewTeam', () => {
    expect(dashboardCode).not.toMatch(/canViewTeam\s*&&\s*<AgencyDetailCard/);
    expect(dashboardCode).not.toMatch(/\{canViewTeam && \(\s*<Card>/);
    // No new Team tab is introduced.
    expect(dashboardCode).not.toContain("value: 'team'");
  });

  it('36. uses canViewTeam only for read-only labelling', () => {
    expect(dashboardCode).toContain(
      "{canViewTeam ? 'Members' : 'Your membership'}",
    );
    expect(dashboardCode).toContain(
      "label={canViewTeam ? 'Active members' : 'Your active membership'}",
    );
  });

  it('37. never lets canViewTeam gate invite, revoke or governance controls', () => {
    const guarded = [
      ...dashboardCode.matchAll(/canViewTeam\s*(&&|\?)/g),
    ];
    expect(guarded.length).toBeGreaterThan(0);
    expect(dashboardCode).not.toMatch(/canViewTeam[^\n]*invite/i);
    expect(dashboardCode).not.toMatch(/canViewTeam[^\n]*revoke/i);
    expect(dashboardCode).not.toMatch(/canViewTeam[^\n]*mutateAsync/);
  });

  it('38. keeps invite and revoke owner-only', () => {
    expect(dashboardCode).toContain('{isOwner && (');
    expect(dashboardCode).toContain(
      "{isOwner && m.role !== 'agency_owner' && m.status !== 'revoked' && (",
    );
    expect(dashboardCode).toContain('Invite member by email');
  });

  it('39. keeps plan/limits and slug governance owner-only', () => {
    expect(dashboardCode).toContain('{isOwner && <AgencyPlanLimitsCard');
    expect(dashboardCode).toContain('<AgencySlugCard agencyId={agency.id} isOwner={isOwner} />');
  });

  it('40. introduces no Driver Assistant authority in the dashboard', () => {
    expect(dashboardCode).not.toContain('hasPerm');
    expect(dashboardCode).not.toContain('useActingContext');
    expect(dashboardCode).not.toContain('assistant_permissions');
  });
});
