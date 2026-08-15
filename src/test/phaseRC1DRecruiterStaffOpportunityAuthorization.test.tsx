/**
 * Phase RC-1D — recruiter staff opportunity authorization.
 *
 * Covers: candidate migration contract, strict permission parser, permission
 * hook scoping, staff data hook isolation, staff route gating, staff manager
 * action visibility, and the staff authoring permission matrix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import {
  parseRecruiterStaffPermissions,
  emptyRecruiterStaffPermissions,
  RECRUITER_STAFF_PERMISSION_KEYS,
} from '@/lib/recruiterStaffPermissions';
import { staffCanSubmitOpportunity } from '@/components/opportunities/RecruiterOpportunityForm';

const MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migration-candidates/20260815034500_phase_rc1d_recruiter_staff_opportunity_authorization.sql',
);
const SQL = readFileSync(MIGRATION_PATH, 'utf8');

const HOOK_SRC = readFileSync(
  resolve(process.cwd(), 'src/hooks/recruiter/useRecruiterStaffPermissions.ts'),
  'utf8',
);
const OPP_HOOK_SRC = readFileSync(
  resolve(process.cwd(), 'src/hooks/opportunities/useRecruiterOpportunities.ts'),
  'utf8',
);
const ACCESS_ROUTE_SRC = readFileSync(
  resolve(process.cwd(), 'src/components/opportunities/recruiter/RecruiterAccessRoute.tsx'),
  'utf8',
);

/* ------------------------------------------------------------------ *
 * A/B/C/D — candidate migration contract
 * ------------------------------------------------------------------ */
describe('RC-1D migration contract', () => {
  it('creates the permission-aware action helper only for the five opportunity keys', () => {
    expect(SQL).toContain(
      'CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_opportunity_action(',
    );
    for (const key of [
      'opportunities_view',
      'opportunities_create',
      'opportunities_edit',
      'opportunities_change_status',
      'opportunities_delete',
    ]) {
      expect(SQL).toContain(`'${key}'::public.recruiter_workspace_permission`);
    }
    for (const forbidden of [
      'applications_view',
      'reports_view',
      'settlements_view',
      'team_manage',
      'contracts_manage',
    ]) {
      expect(SQL).not.toContain(forbidden);
    }
  });

  it('does not replace or weaken the owner-only gate', () => {
    expect(SQL).not.toContain(
      'CREATE OR REPLACE FUNCTION public.current_user_can_manage_recruiter_opportunities',
    );
    expect(SQL).toContain(
      'public.current_user_can_manage_recruiter_opportunities(_recruiter_id)',
    );
  });

  it('requires posting-ready workspace AND explicit RC-1B permission on the staff path', () => {
    expect(SQL).toContain('public.recruiter_profile_can_manage_opportunities(_recruiter_id)');
    expect(SQL).toContain(
      'public.current_user_has_recruiter_permission(_recruiter_id, _permission)',
    );
    expect(SQL).toContain('auth.uid() IS NOT NULL');
    expect(SQL).toContain('_recruiter_id IS NOT NULL');
    expect(SQL).toContain('_permission IS NOT NULL');
  });

  it('is security definer, search_path pinned, and pinned to authenticated', () => {
    expect(SQL).toContain('SECURITY DEFINER');
    expect(SQL).toContain('SET search_path = public');
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.current_user_can_recruiter_opportunity_action\(uuid, public\.recruiter_workspace_permission\) FROM PUBLIC;/,
    );
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.current_user_can_recruiter_opportunity_action\(uuid, public\.recruiter_workspace_permission\) TO authenticated;/,
    );
  });

  it('installs the staff action guard trigger so it fires before billing/publication guards', () => {
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.opportunities_staff_action_guard()');
    expect(SQL).toContain('CREATE TRIGGER trg_opportunities_a_staff_action_guard');
    expect(SQL).toContain('BEFORE INSERT OR UPDATE ON public.opportunities');
    // Sorts before the pre-existing trigger names.
    expect('trg_opportunities_a_staff_action_guard' < 'trg_opportunities_billing_guard').toBe(true);
  });

  it('enforces the exact staff action rules in the guard', () => {
    expect(SQL).toContain('IF public.is_admin(auth.uid()) THEN');
    expect(SQL).toContain('IF _owns_recruiter_profile THEN');
    expect(SQL).toContain("NEW.status = 'active' AND NOT public.current_user_can_recruiter_opportunity_action(");
    expect(SQL).toContain('NEW.recruiter_id IS DISTINCT FROM OLD.recruiter_id');
    expect(SQL).toContain("USING ERRCODE = '42501'");
    for (const excluded of [
      "- 'id'",
      "- 'recruiter_id'",
      "- 'status'",
      "- 'admin_review_status'",
      "- 'featured'",
      "- 'view_count'",
      "- 'published_at'",
      "- 'created_at'",
      "- 'updated_at'",
    ]) {
      expect(SQL).toContain(excluded);
    }
    expect(SQL).toContain('_content_changed AND NOT public.current_user_can_recruiter_opportunity_action(');
    expect(SQL).toContain('_status_changed AND NOT public.current_user_can_recruiter_opportunity_action(');
  });

  it('modifies only the three recruiter policies and adds no recruiter DELETE policy', () => {
    expect(SQL).toContain('DROP POLICY IF EXISTS "Recruiter views own opportunities"');
    expect(SQL).toContain('DROP POLICY IF EXISTS "Recruiter inserts own opportunities"');
    expect(SQL).toContain('DROP POLICY IF EXISTS "Recruiter updates own opportunities"');
    expect(SQL).not.toContain('Admins view all opportunities');
    expect(SQL).not.toContain('Authenticated view approved active opportunities');
    expect(SQL).not.toContain('driver_can_access_opportunity');
    expect(SQL).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/);
    expect(SQL).not.toContain('opportunity_applications a\n     WHERE a.opportunity_id'.slice(0, 0) + 'ALTER POLICY');
  });

  it('preserves raw owner read and adds only view-permission staff read', () => {
    expect(SQL).toContain('rp.id = opportunities.recruiter_id');
    expect(SQL).toContain('rp.user_id = auth.uid()');
    expect(SQL).toContain("opportunities.recruiter_id,\n      'opportunities_view'::public.recruiter_workspace_permission");
  });

  it('adapts only authorization inside the existing guards and delete RPC', () => {
    // Billing limits preserved verbatim.
    expect(SQL).toContain('effective_recruiter_active_opportunity_limit');
    expect(SQL).toContain('pg_advisory_xact_lock(_lock_namespace');
    expect(SQL).toContain("'active_opportunity_limit_reached'");
    expect(SQL).toContain('business_entitlement_conflict');
    // Publication behavior preserved.
    expect(SQL).toContain("NEW.admin_review_status := CASE WHEN _is_eligible THEN 'approved' ELSE 'pending' END;");
    expect(SQL).toContain('app.allow_featured_sync');
    // Delete RPC contract preserved.
    expect(SQL).toContain("'result_code', 'not_found'");
    expect(SQL).toContain("'result_code', 'status_blocked'");
    expect(SQL).toContain("'result_code', 'related_records'");
    expect(SQL).toContain("'result_code', 'deleted'");
    expect(SQL).toContain('DELETE FROM public.saved_opportunities');
    expect(SQL).toContain(
      "v_recruiter_id, 'opportunities_delete'::public.recruiter_workspace_permission",
    );
  });

  it('does not touch applications, referrals, reports, contracts, or settlements authorization', () => {
    expect(SQL).not.toContain('list_recruiter_applications_safe');
    expect(SQL).not.toContain('request_driver_contact');
    expect(SQL).not.toContain('CREATE POLICY "Recruiter'.concat(' views applications'));
    expect(SQL).not.toContain('driver_settlements');
  });
});

/* ------------------------------------------------------------------ *
 * G — strict permission parser
 * ------------------------------------------------------------------ */
describe('parseRecruiterStaffPermissions', () => {
  const full = (value: boolean) =>
    Object.fromEntries(RECRUITER_STAFF_PERMISSION_KEYS.map((k) => [k, value]));

  it('accepts a complete boolean map', () => {
    const parsed = parseRecruiterStaffPermissions(full(true));
    expect(parsed).not.toBeNull();
    expect(parsed?.opportunities_view).toBe(true);
  });

  it.each([null, undefined, [], 'x', 7, true])('rejects non-object payload %p', (payload) => {
    expect(parseRecruiterStaffPermissions(payload as unknown)).toBeNull();
  });

  it('rejects missing keys', () => {
    const partial = full(true);
    delete (partial as Record<string, unknown>).opportunities_view;
    expect(parseRecruiterStaffPermissions(partial)).toBeNull();
  });

  it('rejects unknown extra keys', () => {
    expect(parseRecruiterStaffPermissions({ ...full(true), extra_key: true })).toBeNull();
  });

  it('rejects non-boolean values', () => {
    expect(parseRecruiterStaffPermissions({ ...full(true), opportunities_edit: 'true' })).toBeNull();
    expect(parseRecruiterStaffPermissions({ ...full(true), opportunities_edit: 1 })).toBeNull();
  });

  it('empty map denies everything', () => {
    const empty = emptyRecruiterStaffPermissions();
    for (const key of RECRUITER_STAFF_PERMISSION_KEYS) expect(empty[key]).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * H/I — hook contracts
 * ------------------------------------------------------------------ */
describe('permission + data hook contracts', () => {
  it('permission query key is scoped to user AND recruiter', () => {
    expect(HOOK_SRC).toContain("queryKey: ['recruiter_staff_permissions', userId, recruiterId ?? null]");
  });

  it('permission hook fails closed on error/malformed payload', () => {
    expect(HOOK_SRC).toContain('emptyRecruiterStaffPermissions()');
    expect(HOOK_SRC).toContain('parseRecruiterStaffPermissions(resp.data)');
    expect(HOOK_SRC).toContain('const granted = query.isSuccess && !!query.data;');
  });

  it('permission hook reads only get_my_recruiter_permissions', () => {
    expect(HOOK_SRC).toContain('get_my_recruiter_permissions');
    expect(HOOK_SRC).not.toContain('useRecruiterProfile');
    expect(HOOK_SRC).not.toContain('useRecruiterBilling');
    expect(HOOK_SRC).not.toContain('from(');
  });

  it('staff opportunity store is separate and never uses the owner profile hook', () => {
    const staffSection = OPP_HOOK_SRC.slice(
      OPP_HOOK_SRC.indexOf('export function useRecruiterStaffOpportunities'),
    );
    expect(staffSection.length).toBeGreaterThan(100);
    expect(staffSection).not.toContain('useRecruiterProfile(');
    expect(staffSection).not.toContain('requireCanPost');
    expect(staffSection).toContain("queryKey: ['recruiter_staff_opportunities', user?.id ?? null, id]");
    expect(staffSection).toContain('permissions.canViewOpportunities === true');
    expect(staffSection).toContain('require(permissions.canCreateOpportunities)');
    expect(staffSection).toContain('require(permissions.canEditOpportunities)');
    expect(staffSection).toContain('require(permissions.canChangeOpportunityStatus)');
    expect(staffSection).toContain('require(permissions.canDeleteOpportunities)');
  });

  it('owner hook behavior is unchanged', () => {
    expect(OPP_HOOK_SRC).toContain('export function useRecruiterOpportunities()');
    expect(OPP_HOOK_SRC).toContain("const { profile, isApproved, canPost, isVerified } = useRecruiterProfile();");
    expect(OPP_HOOK_SRC).toContain("qc.invalidateQueries({ queryKey: ['recruiter_opportunities'] });");
  });
});

/* ------------------------------------------------------------------ *
 * J — staff route gating
 * ------------------------------------------------------------------ */
const permissionState = {
  permissions: emptyRecruiterStaffPermissions(),
  canViewOpportunities: false,
  canCreateOpportunities: false,
  canEditOpportunities: false,
  canChangeOpportunityStatus: false,
  canDeleteOpportunities: false,
  isLoading: false,
  error: null as unknown,
  refetch: () => {},
};

vi.mock('@/hooks/recruiter/useRecruiterStaffPermissions', () => ({
  useRecruiterStaffPermissions: () => permissionState,
}));

vi.mock('@/components/opportunities/RecruiterOpportunityManager', () => ({
  RecruiterOpportunityManager: () => <div data-testid="owner-manager" />,
  RecruiterStaffOpportunityManager: (props: { recruiterId: string }) => (
    <div data-testid="staff-manager">{props.recruiterId}</div>
  ),
}));
vi.mock('@/components/opportunities/recruiter/RecruiterAccessPage', () => ({
  RecruiterAccessPage: () => <div data-testid="owner-access-page" />,
}));
vi.mock('@/components/opportunities/RecruiterOnboarding', () => ({
  RecruiterOnboarding: () => <div data-testid="owner-onboarding" />,
}));
vi.mock('@/components/opportunities/RecruiterApplicationsDashboard', () => ({
  RecruiterApplicationsDashboard: () => <div data-testid="owner-applications" />,
}));

import { RecruiterAccessRoute } from '@/components/opportunities/recruiter/RecruiterAccessRoute';

const workspace = {
  membershipId: 'm1',
  recruiterId: 'r1',
  companyName: 'Acme Freight',
  recruiterName: 'Dana',
  memberRole: 'recruiter_staff' as const,
  memberSince: '2026-01-01T00:00:00Z',
};

function renderStaffRoute() {
  return render(
    <MemoryRouter>
      <RecruiterAccessRoute
        onBack={() => {}}
        initialView="manager"
        recruiterCapabilityStatus={null}
        recruiterHubAllowed
        recruiterOperationsAllowed={false}
        recruiterAccessKind="staff"
        selectedStaffWorkspace={workspace}
      />
    </MemoryRouter>,
  );
}

describe('staff route gating', () => {
  beforeEach(() => {
    Object.assign(permissionState, {
      permissions: emptyRecruiterStaffPermissions(),
      canViewOpportunities: false,
      canCreateOpportunities: false,
      canEditOpportunities: false,
      canChangeOpportunityStatus: false,
      canDeleteOpportunities: false,
      isLoading: false,
      error: null,
    });
  });

  it('never mounts owner children in staff mode', () => {
    renderStaffRoute();
    expect(screen.getByTestId('recruiter-staff-workspace-home')).toBeTruthy();
    expect(screen.queryByTestId('owner-access-page')).toBeNull();
    expect(screen.queryByTestId('owner-manager')).toBeNull();
    expect(screen.queryByTestId('owner-onboarding')).toBeNull();
    expect(screen.queryByTestId('owner-applications')).toBeNull();
  });

  it('hides Manage Opportunities without view permission', () => {
    renderStaffRoute();
    expect(screen.queryByTestId('staff-open-opportunities')).toBeNull();
  });

  it('hides Manage Opportunities while permissions are loading', () => {
    permissionState.isLoading = true;
    permissionState.canViewOpportunities = true;
    renderStaffRoute();
    expect(screen.queryByTestId('staff-open-opportunities')).toBeNull();
  });

  it('hides Manage Opportunities on permission error', () => {
    permissionState.error = new Error('nope');
    permissionState.canViewOpportunities = true;
    renderStaffRoute();
    expect(screen.queryByTestId('staff-open-opportunities')).toBeNull();
  });

  it('shows Manage Opportunities only with resolved view permission', () => {
    permissionState.canViewOpportunities = true;
    renderStaffRoute();
    expect(screen.getByTestId('staff-open-opportunities')).toBeTruthy();
    expect(screen.queryByTestId('staff-manager')).toBeNull();
  });

  it('staff branch returns before owner operational children in source order', () => {
    const staffIdx = ACCESS_ROUTE_SRC.indexOf("recruiterAccessKind === 'staff'");
    const managerIdx = ACCESS_ROUTE_SRC.indexOf("safeView === 'manager'");
    expect(staffIdx).toBeGreaterThan(-1);
    expect(managerIdx).toBeGreaterThan(staffIdx);
  });
});

/* ------------------------------------------------------------------ *
 * L — staff authoring permission matrix
 * ------------------------------------------------------------------ */
describe('staffCanSubmitOpportunity matrix', () => {
  const p = (canCreate: boolean, canEdit: boolean, canChangeStatus: boolean) => ({
    canCreate,
    canEdit,
    canChangeStatus,
  });

  it('new draft requires create only', () => {
    expect(
      staffCanSubmitOpportunity({ isExisting: false, currentStatus: null, mode: 'draft', permissions: p(true, false, false) }),
    ).toBe(true);
    expect(
      staffCanSubmitOpportunity({ isExisting: false, currentStatus: null, mode: 'draft', permissions: p(false, true, true) }),
    ).toBe(false);
  });

  it('new publish requires create + change_status', () => {
    expect(
      staffCanSubmitOpportunity({ isExisting: false, currentStatus: null, mode: 'publish', permissions: p(true, false, false) }),
    ).toBe(false);
    expect(
      staffCanSubmitOpportunity({ isExisting: false, currentStatus: null, mode: 'publish', permissions: p(true, false, true) }),
    ).toBe(true);
  });

  it('existing draft save requires edit only', () => {
    expect(
      staffCanSubmitOpportunity({ isExisting: true, currentStatus: 'draft', mode: 'draft', permissions: p(false, true, false) }),
    ).toBe(true);
  });

  it('existing save that changes status requires edit + change_status', () => {
    expect(
      staffCanSubmitOpportunity({ isExisting: true, currentStatus: 'active', mode: 'draft', permissions: p(false, true, false) }),
    ).toBe(false);
    expect(
      staffCanSubmitOpportunity({ isExisting: true, currentStatus: 'active', mode: 'draft', permissions: p(false, true, true) }),
    ).toBe(true);
  });

  it('publishing a non-active listing requires edit + change_status', () => {
    expect(
      staffCanSubmitOpportunity({ isExisting: true, currentStatus: 'paused', mode: 'publish', permissions: p(false, true, false) }),
    ).toBe(false);
    expect(
      staffCanSubmitOpportunity({ isExisting: true, currentStatus: 'paused', mode: 'publish', permissions: p(false, true, true) }),
    ).toBe(true);
  });

  it('saving an already-active listing as active requires edit only', () => {
    expect(
      staffCanSubmitOpportunity({ isExisting: true, currentStatus: 'active', mode: 'publish', permissions: p(false, true, false) }),
    ).toBe(true);
  });

  it('no edit permission always blocks existing listings', () => {
    expect(
      staffCanSubmitOpportunity({ isExisting: true, currentStatus: 'draft', mode: 'draft', permissions: p(true, false, true) }),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * K — staff manager surface contract
 * ------------------------------------------------------------------ */
describe('staff manager surface', () => {
  const MANAGER_SRC = readFileSync(
    resolve(process.cwd(), 'src/components/opportunities/RecruiterOpportunityManager.tsx'),
    'utf8',
  );
  const staffSection = MANAGER_SRC.slice(
    MANAGER_SRC.indexOf('export function RecruiterStaffOpportunityManager'),
  );

  it('exists and is isolated from owner hooks', () => {
    expect(staffSection.length).toBeGreaterThan(100);
    expect(staffSection).not.toContain('useRecruiterProfile');
    expect(staffSection).not.toContain('useRecruiterBilling');
    expect(staffSection).not.toContain('useUserRole');
    expect(staffSection).not.toContain('RecruiterReferralsPanel');
    expect(staffSection).not.toContain('RecruiterReadinessDialog');
    expect(staffSection).toContain('useRecruiterStaffOpportunities');
  });

  it('gates every action on the permission booleans', () => {
    expect(staffSection).toContain('if (!permissions.canViewOpportunities)');
    expect(staffSection).toContain('{permissions.canCreateOpportunities && (');
    expect(staffSection).toContain('canEdit={permissions.canEditOpportunities}');
    expect(staffSection).toContain('canChangeStatus={permissions.canChangeOpportunityStatus}');
    expect(staffSection).toContain('canDeletePermission={permissions.canDeleteOpportunities}');
  });

  it('owner manager still mounts billing/referrals/readiness', () => {
    const ownerSection = MANAGER_SRC.slice(
      MANAGER_SRC.indexOf('export function RecruiterOpportunityManager'),
      MANAGER_SRC.indexOf('function OpportunityRow'),
    );
    expect(ownerSection).toContain('useRecruiterBilling()');
    expect(ownerSection).toContain('useRecruiterProfile()');
    expect(ownerSection).toContain('RecruiterReferralsPanel');
    expect(ownerSection).toContain('RecruiterReadinessDialog');
  });

  it('form wrapper is hook-free and staff path bypasses owner binding', () => {
    const FORM_SRC = readFileSync(
      resolve(process.cwd(), 'src/components/opportunities/RecruiterOpportunityForm.tsx'),
      'utf8',
    );
    const wrapper = FORM_SRC.slice(
      FORM_SRC.indexOf('export function RecruiterOpportunityForm(props: Props)'),
      FORM_SRC.indexOf('function OwnerBoundRecruiterOpportunityForm'),
    );
    expect(wrapper).not.toContain('useState');
    expect(wrapper).not.toContain('useRecruiterProfile');
    expect(wrapper).toContain('return <RecruiterOpportunityFormCore {...props} controller={controller} />;');
    expect(FORM_SRC).toContain('function OwnerBoundRecruiterOpportunityForm');
    expect(FORM_SRC).toContain('const { profile, refetchProfile } = useRecruiterProfile();');
  });
});
