/**
 * Phase AM-1C-E — Agency Work Items permission consumer cutover.
 *
 * Deterministic source/SQL contract test. The candidate migration is NOT
 * applied live; these assertions read the candidate text and authored sources.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const START_GATE = '002904b759e98f64905bc6f95c0bffe369b925e9';

const SQL_REL =
  'supabase/migration-candidates/20260818064000_phase_am1ce_agency_work_items_permission_cutover.sql';
const HOOK_REL = 'src/hooks/useAgencyWorkspacePermissions.ts';
const QUEUE_REL = 'src/components/agency/WorkQueueSection.tsx';
const DASHBOARD_REL = 'src/pages/AgencyDashboard.tsx';
const TEST_REL = 'src/test/phaseAM1CEAgencyWorkItemsPermissionCutover.test.tsx';
const WORKFLOW_REL = 'src/hooks/useAgencyWorkflow.ts';
const VOCAB_REL = 'src/lib/agencyWorkspacePermissions.ts';
const GENERATED_TYPES = 'src/integrations/supabase/types.ts';

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), 'utf8');

const sql = read(SQL_REL);
const hookSource = read(HOOK_REL);
const queueSource = read(QUEUE_REL);
const dashboardSource = read(DASHBOARD_REL);

/** Executable SQL only: `--` line comments stripped. */
const executable = sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const executableLower = executable.toLowerCase();

const AUTHORED_FILES = [SQL_REL, HOOK_REL, QUEUE_REL, DASHBOARD_REL, TEST_REL];

const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');

const queueCode = stripComments(queueSource);
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

describe('AM-1C-E — candidate envelope and authored scope', () => {
  it('1. is marked as a candidate and is exactly one explicit transaction', () => {
    expect(sql.split('\n')[0].trim()).toBe('-- CANDIDATE MIGRATION — NOT APPLIED LIVE.');
    expect((sql.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((sql.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
    expect(sql.indexOf('\nBEGIN;')).toBeLessThan(sql.indexOf('\nCOMMIT;'));
  });

  it('2. changes exactly the five authored files and no prohibited file', () => {
    const out = execFileSync('git', ['diff', '--name-only', `${START_GATE}..HEAD`], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    const changed = out.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(changed.sort()).toEqual([...AUTHORED_FILES].sort());
    expect(changed).not.toContain(WORKFLOW_REL);
    expect(changed).not.toContain(VOCAB_REL);
    expect(changed).not.toContain(GENERATED_TYPES);
  });
});

describe('AM-1C-E — SQL redefinition surface', () => {
  const definitions = [
    ...executableLower.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/g),
  ].map((m) => m[1]);

  it('3. redefines exactly the three Work Item functions', () => {
    expect(definitions.sort()).toEqual(
      ['create_agency_work_item', 'list_agency_work_items', 'update_agency_work_item'].sort(),
    );
  });

  it('4. does not redefine driver-owned work-item paths', () => {
    for (const fn of [
      'list_my_waiting_work_items',
      'get_my_waiting_work_item',
      'driver_respond_to_work_item',
    ]) {
      expect(definitions).not.toContain(fn);
    }
  });

  it('5. does not redefine permission, role or unrelated consumer functions', () => {
    for (const fn of [
      'is_agency_owner_or_admin',
      'current_user_has_agency_permission',
      'get_my_agency_permissions',
      'set_agency_member_permissions',
      'create_agency_package',
      'update_agency_package',
      'list_agency_clients',
      'list_agency_delegations',
      'create_agency_delegation_request',
      'revoke_agency_delegation',
      'driver_decide_delegation',
      'assistant_has_permission',
      '_agency_member_paid_operational_authority',
      'assert_agency_limit',
    ]) {
      expect(definitions).not.toContain(fn);
    }
  });

  it('6. contains no DML policy and no grant changes', () => {
    expect(executableLower).not.toMatch(/for\s+(insert|update|delete|all)\b/);
    expect(executableLower).not.toMatch(/\bgrant\b/);
    expect(executableLower).not.toMatch(/\brevoke\s+(select|insert|update|delete|all)\b/);
  });
});

describe('AM-1C-E — list_agency_work_items', () => {
  const body = fnBody('list_agency_work_items');

  it('7. broad branch uses work_items_view_all with no role shortcut', () => {
    expect(body).toContain(
      "public.current_user_has_agency_permission(_agency_id,'work_items_view_all')",
    );
    expect(body).not.toContain('is_agency_owner_or_admin');
    expect(body).not.toContain('agency_admin');
  });

  it('8. preserves the narrow assigned-member branch verbatim', () => {
    expect(body).toContain(
      '(w.assigned_member_user_id=auth.uid() AND public.is_agency_member(_agency_id,auth.uid()))',
    );
  });

  it('9. preserves signature, volatility, security and shape', () => {
    expect(body).toContain(
      'list_agency_work_items(_agency_id uuid, _status agency_work_item_status DEFAULT NULL::agency_work_item_status, _driver_user_id uuid DEFAULT NULL::uuid, _assigned_member_user_id uuid DEFAULT NULL::uuid)',
    );
    expect(body).toContain('STABLE SECURITY DEFINER');
    expect(body).toContain("SET search_path TO 'public'");
    expect(body).toContain('ORDER BY w.due_date NULLS LAST,w.created_at DESC');
  });

  it('10. does not compose manage into the read path', () => {
    expect(body).not.toContain('work_items_manage');
  });
});

describe('AM-1C-E — create_agency_work_item', () => {
  const body = fnBody('create_agency_work_item');

  it('11. authorizes on work_items_manage with no role shortcut', () => {
    expect(body).toContain(
      "public.current_user_has_agency_permission(_agency_id,'work_items_manage')",
    );
    expect(body).not.toContain('is_agency_owner_or_admin');
    expect(body).toContain("ERRCODE='42501'");
  });

  it('12. does not require view-all or any other consumer permission', () => {
    expect(body).not.toContain('work_items_view_all');
    expect(body).not.toContain('clients_view');
    expect(body).not.toContain('delegations_manage');
    expect(body).not.toContain('team_view');
  });

  it('13. preserves plan limit, client, member, paid-authority and audit behavior', () => {
    expect(body).toContain("public.assert_agency_limit(_agency_id,'create_work_item')");
    expect(body).toContain('Driver is not an approved client of this agency');
    expect(body).toContain('Assigned member must be an active agency member');
    expect(body).toContain(
      'public._agency_member_paid_operational_authority(_agency_id,_assigned_member_user_id)',
    );
    expect(body).toContain("'work_item_created','agency_work_item'");
    expect(body).toContain("ERRCODE='22023'");
  });
});

describe('AM-1C-E — update_agency_work_item', () => {
  const body = fnBody('update_agency_work_item');

  it('14. full management authority resolves from work_items_manage', () => {
    expect(body).toContain(
      "_can_manage_work_items:=public.current_user_has_agency_permission(_old.agency_id,'work_items_manage')",
    );
    expect(body).not.toContain('is_agency_owner_or_admin');
    expect(body).not.toContain('_is_admin');
  });

  it('15. initial allowed branch stays manager OR exact assigned member (fail-closed for unassigned rows)', () => {
    expect(body).toContain('_is_assigned:=COALESCE(_old.assigned_member_user_id=_uid,false)');
    // The raw nullable form (which yields NULL for unassigned rows) must be gone.
    expect(body).not.toContain('_is_assigned:=(_old.assigned_member_user_id=_uid)');
    expect(body).toContain(
      "IF NOT (_can_manage_work_items OR _is_assigned) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'",
    );
  });

  it('16. reassign or rename requires work_items_manage', () => {
    expect(body).toContain('IF (_reassigning OR _renaming) AND NOT _can_manage_work_items THEN');
  });

  it('17. preserves the independent assigned-member limited self-service path', () => {
    expect(body).toContain('IF _is_assigned AND NOT _can_manage_work_items THEN');
    expect(body).toContain('public.is_agency_member(_old.agency_id,_uid)');
    expect(body).toContain('_positive:=');
    expect(body).toContain(
      '_positive AND NOT public._agency_member_paid_operational_authority(_old.agency_id,_uid)',
    );
    expect(body).toContain("ERRCODE='P0001'");
  });

  it('18. does not compose view-all into management', () => {
    expect(body).not.toContain('work_items_view_all');
  });

  it('19. preserves reassign validation, approved-client check and audit selection', () => {
    expect(body).toContain(
      'public._agency_member_paid_operational_authority(_old.agency_id,_assigned_member_user_id)',
    );
    expect(body).toContain('Driver is no longer an approved client of this agency');
    expect(body).toContain("'work_item_assigned'");
    expect(body).toContain("'work_item_completed'");
    expect(body).toContain("'work_item_status_changed'");
    expect(body).toContain("'work_item_updated'");
    expect(body).toContain("completed_at=CASE WHEN _status='completed' THEN now()");
    expect(body).toContain("ERRCODE='42704'");
  });
});

describe('AM-1C-E — Work Item SELECT RLS', () => {
  it('20. drops only the role-derived broad policy', () => {
    const drops = [
      ...executableLower.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?([a-z0-9_]+)/g),
    ].map((m) => m[1]);
    expect(drops).toEqual(['awi_agency_admin_select']);
  });

  it('21. creates exactly one view-all SELECT policy for authenticated', () => {
    const creates = [
      ...executableLower.matchAll(/create\s+policy\s+([a-z0-9_]+)/g),
    ].map((m) => m[1]);
    expect(creates).toEqual(['awi_workspace_view_all_select']);
    expect(executable).toContain('FOR SELECT');
    expect(executable).toContain('TO authenticated');
    expect(executable).toContain(
      "USING (public.current_user_has_agency_permission(agency_id,'work_items_view_all'))",
    );
  });

  it('22. preserves the assigned-member and both driver policies', () => {
    for (const p of [
      'awi_assigned_member_select',
      'awi_driver_waiting_select',
      'awi_driver_responded_select',
    ]) {
      expect(executableLower).not.toContain(`drop policy if exists ${p}`);
      expect(executableLower).not.toContain(`create policy ${p}`);
    }
  });
});

describe('AM-1C-E — permission hook', () => {
  it('23. adds exact fail-closed view-all and manage booleans', () => {
    expect(hookCode).toContain(
      'canViewAllWorkItems: settled && resolved.work_items_view_all === true',
    );
    expect(hookCode).toContain(
      'canManageWorkItems: settled && resolved.work_items_manage === true',
    );
    expect(hookCode).toContain('canViewAllWorkItems: boolean;');
    expect(hookCode).toContain('canManageWorkItems: boolean;');
  });

  it('24. preserves all prior consumer booleans', () => {
    for (const b of [
      'canViewPackages: settled && resolved.packages_view === true',
      'canManagePackages: settled && resolved.packages_manage === true',
      'canViewClientRequests: settled && resolved.client_requests_view === true',
      'canManageClientRequests: settled && resolved.client_requests_manage === true',
      'canViewClients: settled && resolved.clients_view === true',
      'canViewDelegations: settled && resolved.delegations_view === true',
      'canManageDelegations: settled && resolved.delegations_manage === true',
    ]) {
      expect(hookCode).toContain(b);
    }
  });

  it('25. never inspects role labels', () => {
    expect(hookCode).not.toContain('agency_admin');
    expect(hookCode).not.toContain('agency_owner');
    expect(hookCode).not.toContain('my_role');
  });
});

describe('AM-1C-E — WorkQueueSection', () => {
  it('26. requires the two exact permission props and drops the role-derived prop', () => {
    expect(queueCode).toContain('canViewAllWorkItems: boolean;');
    expect(queueCode).toContain('canManageWorkItems: boolean;');
    expect(queueCode).not.toContain('canManage = false');
    expect(queueCode).not.toMatch(/\bcanManage\b\s*[:&?)]/);
  });

  it('27. broad driver/member filters are governed by view-all, not manage', () => {
    expect(queueCode).toContain(
      "driverId: canViewAllWorkItems && driverId !== 'all' ? driverId : undefined,",
    );
    expect(queueCode).toContain(
      "memberId: canViewAllWorkItems && memberId !== 'all' ? memberId : undefined,",
    );
    expect(queueCode).toContain('{canViewAllWorkItems && (');
  });

  it('28. New task button and dialog are governed by manage, not view-all', () => {
    expect(queueCode).toContain('{canManageWorkItems && (');
    expect(queueCode).toContain('New task');
    const createIdx = queueCode.indexOf('<CreateWorkItemDialog');
    expect(createIdx).toBeGreaterThan(0);
    expect(queueCode.slice(0, createIdx)).toContain('{canManageWorkItems && (');
  });

  it('29. list query stays unfiltered by workspace permission (status only)', () => {
    expect(queueCode).toContain('useAgencyWorkItems(agencyId, {');
    expect(queueCode).toContain("status: status === 'all' ? undefined : status,");
    expect(queueCode).not.toContain('enabled: canViewAllWorkItems');
    expect(queueCode).not.toContain('enabled: canManageWorkItems');
  });

  it('30. editable status renders only for manage OR the exact assignee', () => {
    expect(queueCode).toContain(
      'canManageWorkItems === true ||\n    (!!user?.id && item.assigned_member_user_id === user.id)',
    );
    expect(queueCode).toContain('{canEditStatus && (');
    // The read-only status badge always remains.
    expect(queueCode).toContain("<Badge variant=\"outline\">{item.status.replace(/_/g, ' ')}</Badge>");
  });

  it('31. driver-account links remain gated by delegation + hasPerm', () => {
    expect(queueCode).toContain('const delegation = managedDrivers.find(');
    expect(queueCode).toContain('if (delegation) {');
    for (const p of [
      'manage_loads',
      'manage_expenses',
      'manage_fuel',
      'view_reports',
      'manage_settings_limited',
    ]) {
      expect(queueCode).toContain(`hasPerm(perms, '${p}')`);
    }
    // Workspace permissions never appear in the link gating.
    const linkBlock = queueCode.slice(
      queueCode.indexOf('const links:'),
      queueCode.indexOf('return (', queueCode.indexOf('const links:')),
    );
    expect(linkBlock).not.toContain('canManageWorkItems');
    expect(linkBlock).not.toContain('canViewAllWorkItems');
  });

  it('32. preserves deep-link focus and status filter', () => {
    expect(queueCode).toContain('work-item-${focusedWorkItemId}');
    expect(queueCode).toContain("scrollIntoView({ behavior: 'smooth', block: 'center' })");
    expect(queueCode).toContain('setStatus(v as any)');
  });

  it('33. preserves existing client/member consumers unchanged', () => {
    expect(queueCode).toContain('useAgencyClients(agencyId)');
    expect(queueCode).toContain('useAgencyMembers(agencyId)');
  });
});

describe('AM-1C-E — AgencyDashboard', () => {
  it('34. destructures the exact Work Item permission booleans', () => {
    expect(dashboardCode).toContain('canViewAllWorkItems,');
    expect(dashboardCode).toContain('canManageWorkItems,');
  });

  it('35. passes exact permissions to WorkQueueSection and no role-derived authority', () => {
    expect(dashboardCode).toContain('canViewAllWorkItems={canViewAllWorkItems}');
    expect(dashboardCode).toContain('canManageWorkItems={canManageWorkItems}');
    expect(dashboardCode).not.toContain('canManage={isOwnerOrAdmin}');
    expect(dashboardCode).not.toContain('isOwnerOrAdmin');
  });

  it('36. keeps the Work queue tab broadly visible for assigned-member self-service', () => {
    expect(dashboardCode).toContain("{ value: 'work', label: 'Work queue', show: true }");
  });

  it('37. leaves other consumer tab gating unchanged', () => {
    expect(dashboardCode).toContain('const showPackages = canViewPackages || canManagePackages;');
    expect(dashboardCode).toContain(
      'const showRequests = canViewClientRequests || canManageClientRequests;',
    );
    expect(dashboardCode).toContain("{ value: 'clients', label: 'Clients', show: canViewClients }");
    expect(dashboardCode).toContain("{ value: 'activity', label: 'Activity', show: isOwner }");
    expect(dashboardCode).toContain('canManageDelegations={canManageDelegations}');
  });
});

/**
 * AM-1C-E pre-promotion security correction.
 *
 * `update_agency_work_item` previously set `_is_assigned:=(_old.assigned_member_user_id=_uid)`,
 * which evaluates to NULL on an unassigned row. `IF NOT (_can_manage_work_items OR _is_assigned)`
 * then evaluated NULL and did not raise, letting a view-only member or unrelated outsider update
 * an unassigned Work Item. The correction wraps the comparison in COALESCE(...,false) so an
 * unassigned row forces `_is_assigned` to false and the gate fails closed.
 */
describe('AM-1C-E pre-promotion security correction — fail-closed assignee boolean', () => {
  const body = fnBody('update_agency_work_item');

  it('38. _is_assigned is explicitly COALESCE(...,false), not raw nullable equality', () => {
    expect(body).toContain('_is_assigned:=COALESCE(_old.assigned_member_user_id=_uid,false)');
    // The raw nullable equality form (which yields NULL for unassigned rows) must be absent.
    expect(body).not.toContain('_is_assigned:=(_old.assigned_member_user_id=_uid)');
    // The inner equality still exists, but only inside the COALESCE wrapper.
    expect(body).toContain('COALESCE(_old.assigned_member_user_id=_uid,false)');
  });

  it('39. an unassigned row cannot turn the manager-or-assignee gate into NULL', () => {
    // For an unassigned row, _old.assigned_member_user_id IS NULL, so the COALESCE forces
    // _is_assigned to false (not NULL). With no manage permission,
    // `NOT (false OR false)` = true => RAISE 'Not allowed'. The gate must reference the
    // COALESCE'd boolean, not a raw nullable expression.
    const gate = "IF NOT (_can_manage_work_items OR _is_assigned) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'";
    expect(body).toContain(gate);
    const gateIdx = body.indexOf('IF NOT (_can_manage_work_items OR _is_assigned)');
    expect(gateIdx).toBeGreaterThan(0);
    const before = body.slice(0, gateIdx);
    // _is_assigned is assigned exactly once, and only via the COALESCE form.
    expect((before.match(/_is_assigned:=/g) ?? []).length).toBe(1);
    expect(before).toContain('_is_assigned:=COALESCE(_old.assigned_member_user_id=_uid,false)');
    // The raw nullable assignment must not survive anywhere before the gate.
    expect(before).not.toContain('_is_assigned:=(_old.assigned_member_user_id=_uid)');
  });

  it('40. initial authorization still remains exactly manager OR exact assigned member', () => {
    expect(body).toContain(
      "_can_manage_work_items:=public.current_user_has_agency_permission(_old.agency_id,'work_items_manage')",
    );
    expect(body).toContain('_is_assigned:=COALESCE(_old.assigned_member_user_id=_uid,false)');
    expect(body).toContain(
      "IF NOT (_can_manage_work_items OR _is_assigned) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'",
    );
    // No alternate authority source leaked in alongside the correction.
    expect(body).not.toContain('is_agency_owner_or_admin');
    expect(body).not.toContain('agency_admin');
    expect(body).not.toContain('_is_admin');
  });

  it('41. no other AM-1C-E SQL/function/policy contract changed by the correction', () => {
    // Still exactly the three Work Item functions redefined.
    const definitions = [
      ...executableLower.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/g),
    ].map((m) => m[1]);
    expect(definitions.sort()).toEqual(
      ['create_agency_work_item', 'list_agency_work_items', 'update_agency_work_item'].sort(),
    );
    // Still exactly one explicit transaction.
    expect((sql.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((sql.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
    // RLS surface unchanged: drops only awi_agency_admin_select, creates only awi_workspace_view_all_select.
    const drops = [
      ...executableLower.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?([a-z0-9_]+)/g),
    ].map((m) => m[1]);
    expect(drops).toEqual(['awi_agency_admin_select']);
    const creates = [...executableLower.matchAll(/create\s+policy\s+([a-z0-9_]+)/g)].map(
      (m) => m[1],
    );
    expect(creates).toEqual(['awi_workspace_view_all_select']);
    // No grants and no DML policies introduced by the correction.
    expect(executableLower).not.toMatch(/for\s+(insert|update|delete|all)\b/);
    expect(executableLower).not.toMatch(/\bgrant\b/);
    // list/create bodies are untouched by the correction (no COALESCE assignee edit there).
    const listBody = fnBody('list_agency_work_items');
    expect(listBody).not.toContain('COALESCE(_old.assigned_member_user_id=_uid,false)');
    const createBody = fnBody('create_agency_work_item');
    expect(createBody).not.toContain('COALESCE(_old.assigned_member_user_id=_uid,false)');
  });
});
