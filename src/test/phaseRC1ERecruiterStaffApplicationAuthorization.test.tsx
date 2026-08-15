/**
 * Phase RC-1E — recruiter staff application authorization.
 *
 * Covers the candidate migration authorization contract, the permission hook
 * extension, the isolated staff application/contact hooks, the staff route
 * gating, and the staff dashboard surface contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { emptyRecruiterStaffPermissions } from '@/lib/recruiterStaffPermissions';

const SQL = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migration-candidates/20260815051500_phase_rc1e_recruiter_staff_application_authorization.sql',
  ),
  'utf8',
);
const PERM_HOOK_SRC = readFileSync(
  resolve(process.cwd(), 'src/hooks/recruiter/useRecruiterStaffPermissions.ts'),
  'utf8',
);
const APP_HOOK_SRC = readFileSync(
  resolve(process.cwd(), 'src/hooks/opportunities/useOpportunityApplications.ts'),
  'utf8',
);
const CONTACT_HOOK_SRC = readFileSync(
  resolve(process.cwd(), 'src/hooks/opportunities/useRecruiterContactRequests.ts'),
  'utf8',
);
const STAFF_DASH_SRC = readFileSync(
  resolve(process.cwd(), 'src/components/opportunities/RecruiterStaffApplicationsDashboard.tsx'),
  'utf8',
);
const ACCESS_ROUTE_SRC = readFileSync(
  resolve(process.cwd(), 'src/components/opportunities/recruiter/RecruiterAccessRoute.tsx'),
  'utf8',
);

const staffAppHookSection = APP_HOOK_SRC.slice(
  APP_HOOK_SRC.indexOf('export function useRecruiterStaffApplications'),
);
const staffContactHookSection = CONTACT_HOOK_SRC.slice(
  CONTACT_HOOK_SRC.indexOf('export function useRecruiterStaffContactRequests'),
);

/* ------------------------------------------------------------------ *
 * A — helper key surface
 * ------------------------------------------------------------------ */
describe('RC-1E application action helper', () => {
  it('accepts exactly the three RC-1E application keys', () => {
    expect(SQL).toContain(
      'CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_application_action(',
    );
    const helper = SQL.slice(
      SQL.indexOf('CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_application_action('),
      SQL.indexOf('REVOKE ALL ON FUNCTION public.current_user_can_recruiter_application_action'),
    );
    for (const key of [
      'applications_view',
      'applications_manage_status',
      'applications_request_contact',
    ]) {
      expect(helper).toContain(`'${key}'::public.recruiter_workspace_permission`);
    }
    for (const forbidden of [
      'applications_manage_notes',
      'opportunities_view',
      'opportunities_delete',
      'contracts_manage',
      'referrals_view',
      'reports_view',
      'settlements_view',
      'team_manage',
    ]) {
      expect(helper).not.toContain(forbidden);
    }
    expect(helper).toContain('auth.uid() IS NOT NULL');
    expect(helper).toContain('_recruiter_id IS NOT NULL');
    expect(helper).toContain('_permission IS NOT NULL');
    expect(helper).toContain('STABLE');
    expect(helper).toContain('SECURITY DEFINER');
    expect(helper).toContain('SET search_path = public');
  });

  it('is revoked from PUBLIC/anon and granted only to authenticated', () => {
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.current_user_can_recruiter_application_action(uuid, public.recruiter_workspace_permission) FROM PUBLIC;',
    );
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.current_user_can_recruiter_application_action(uuid, public.recruiter_workspace_permission) FROM anon;',
    );
    expect(SQL).toContain(
      'GRANT EXECUTE ON FUNCTION public.current_user_can_recruiter_application_action(uuid, public.recruiter_workspace_permission) TO authenticated;',
    );
  });

  it('does not replace or weaken the owner-only gate or RC-1B functions', () => {
    for (const fn of [
      'CREATE OR REPLACE FUNCTION public.current_user_can_manage_recruiter_opportunities',
      'CREATE OR REPLACE FUNCTION public.recruiter_profile_can_manage_opportunities',
      'CREATE OR REPLACE FUNCTION public.current_user_has_recruiter_permission',
      'CREATE OR REPLACE FUNCTION public.is_recruiter_workspace_owner',
      'CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_opportunity_action',
    ]) {
      expect(SQL).not.toContain(fn);
    }
    // Owner path reuses the unchanged gate verbatim.
    expect(SQL).toContain('public.current_user_can_manage_recruiter_opportunities(_recruiter_id)');
  });
});

/* ------------------------------------------------------------------ *
 * B — safe list authorization + contact masking
 * ------------------------------------------------------------------ */
describe('list_recruiter_applications_safe', () => {
  const fn = SQL.slice(
    SQL.indexOf('CREATE OR REPLACE FUNCTION public.list_recruiter_applications_safe'),
    SQL.indexOf('CREATE OR REPLACE FUNCTION public.list_recruiter_application_summaries'),
  );

  it('authorizes through applications_view instead of the owner-only gate', () => {
    expect(fn).toContain("_recruiter_id, 'applications_view'::public.recruiter_workspace_permission");
    expect(fn).not.toContain('IF NOT public.current_user_can_manage_recruiter_opportunities');
    expect(fn).toContain("RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'");
  });

  it('masks phone/email snapshots unless applications_request_contact passes', () => {
    expect(fn).toContain(
      "_recruiter_id, 'applications_request_contact'::public.recruiter_workspace_permission",
    );
    const phone = fn.slice(fn.indexOf("'driver_phone_snapshot'"), fn.indexOf("'driver_email_snapshot'"));
    expect(phone).toContain('WHEN _can_see_contact');
    const email = fn.slice(fn.indexOf("'driver_email_snapshot'"), fn.indexOf("'opportunities'"));
    expect(email).toContain('WHEN _can_see_contact');
  });

  it('preserves the existing driver consent + approved-request conditions', () => {
    expect(fn).toContain('COALESCE(dop.allow_verified_recruiter_contact, false)');
    expect(fn).toContain("dop.contact_preference = 'phone'");
    expect(fn).toContain("dop.contact_preference = 'email'");
    expect(fn).toContain("rcr.application_id = oa.id AND rcr.status = 'approved'");
    expect(fn).toContain('WHERE oa.recruiter_id = _recruiter_id');
    expect(fn).toContain('ORDER BY oa.created_at DESC');
  });
});

/* ------------------------------------------------------------------ *
 * C — summaries authorization
 * ------------------------------------------------------------------ */
describe('list_recruiter_application_summaries', () => {
  const fn = SQL.slice(
    SQL.indexOf('CREATE OR REPLACE FUNCTION public.list_recruiter_application_summaries'),
    SQL.indexOf('DROP POLICY IF EXISTS "Recruiter updates application status"'),
  );

  it('preserves the legacy owner branch exactly', () => {
    expect(fn).toContain('WHERE rp.id = _recruiter_id AND rp.user_id = _uid');
    expect(fn).toContain("rp.status <> 'suspended' AND rp.verification_status <> 'suspended'");
  });

  it('adds a staff branch requiring posting readiness and applications_view', () => {
    expect(fn).toContain('public.recruiter_profile_can_manage_opportunities(_recruiter_id)');
    expect(fn).toContain(
      "_recruiter_id, 'applications_view'::public.recruiter_workspace_permission",
    );
  });

  it('keeps output and ordering unchanged', () => {
    expect(fn).toContain(
      'SELECT oa.id, oa.opportunity_id, oa.status, oa.created_at, oa.updated_at',
    );
    expect(fn).toContain('ORDER BY oa.created_at DESC');
  });
});

/* ------------------------------------------------------------------ *
 * D/E — RLS + triggers
 * ------------------------------------------------------------------ */
describe('RC-1E RLS surface', () => {
  it('broadens only the recruiter application UPDATE policy', () => {
    expect(SQL).toContain(
      'DROP POLICY IF EXISTS "Recruiter updates application status" ON public.opportunity_applications;',
    );
    const policy = SQL.slice(
      SQL.indexOf('CREATE POLICY "Recruiter updates application status"'),
      SQL.indexOf('-- E) application_events'),
    );
    expect(policy).toContain('FOR UPDATE');
    expect(policy).toContain(
      "recruiter_id, 'applications_manage_status'::public.recruiter_workspace_permission",
    );
    expect(policy).toContain('WITH CHECK');
  });

  it('adds no recruiter SELECT policy and leaves admin/driver policies untouched', () => {
    expect(SQL).not.toContain('Admins view all applications');
    expect(SQL).not.toContain('Admins update applications');
    expect(SQL).not.toContain('Driver views own applications');
    expect(SQL).not.toContain('Driver inserts own application');
    expect(SQL).not.toContain('Admins view all application events');
    expect(SQL).not.toContain('Driver views own application events');
    expect(SQL).not.toContain('rcr_driver_select');
    expect(SQL).not.toContain('rcr_admin_all');
    expect(SQL).not.toContain('ON public.opportunity_applications\n  FOR SELECT');
  });

  it('does not replace existing application update/snapshot/contract triggers', () => {
    for (const guard of [
      'opportunity_applications_update_guard',
      'snapshot_freeze',
      'require_contract_for_hire',
      'contact_snapshot_guard',
      'bridge_application_to_referral',
      'bridge_app_to_referral',
    ]) {
      expect(SQL).not.toContain(guard);
    }
  });

  it('extends the recruiter events policy with a staff branch only', () => {
    const policy = SQL.slice(
      SQL.indexOf('CREATE POLICY "Recruiter views events for own applications"'),
      SQL.indexOf('CREATE OR REPLACE FUNCTION public.application_events_emit'),
    );
    // Existing owner branch preserved verbatim.
    expect(policy).toContain('JOIN public.recruiter_profiles rp ON rp.id = oa.recruiter_id');
    expect(policy).toContain('rp.user_id = auth.uid()');
    expect(policy).toContain("rp.status <> 'suspended'");
    expect(policy).toContain("rp.verification_status <> 'suspended'");
    // Staff branch.
    expect(policy).toContain(
      "oa.recruiter_id, 'applications_view'::public.recruiter_workspace_permission",
    );
  });

  it('classifies an authorized staff status change as a recruiter actor', () => {
    const emitter = SQL.slice(
      SQL.indexOf('CREATE OR REPLACE FUNCTION public.application_events_emit'),
      SQL.indexOf('-- F) Contact request authorization'),
    );
    expect(emitter).toContain(
      "'applications_manage_status'::public.recruiter_workspace_permission",
    );
    expect(emitter).toContain('IF NOT _is_recruiter THEN');
    // Existing precedence and payload are preserved.
    expect(emitter).toContain('IF public.is_admin(_actor) THEN');
    expect(emitter).toContain("_actor_type := 'admin';");
    expect(emitter).toContain('ELSIF _is_driver THEN');
    expect(emitter).toContain("_actor_type := 'recruiter';");
    expect(emitter).toContain("_actor_type := 'system';");
    expect(emitter).toContain("VALUES (NEW.id, 'driver', NEW.driver_user_id, 'application_created', '{}'::jsonb)");
    expect(emitter).toContain(
      "jsonb_build_object('from', OLD.status, 'to', NEW.status)",
    );
  });
});

/* ------------------------------------------------------------------ *
 * F — contact request authorization
 * ------------------------------------------------------------------ */
describe('contact request authorization', () => {
  const fn = SQL.slice(
    SQL.indexOf('CREATE OR REPLACE FUNCTION public.request_driver_contact'),
    SQL.indexOf('DROP POLICY IF EXISTS "rcr_recruiter_select"'),
  );

  it('replaces only the owner identity/eligibility gate', () => {
    expect(fn).toContain(
      "_app.recruiter_id, 'applications_request_contact'::public.recruiter_workspace_permission",
    );
    expect(fn).not.toContain('_rp.user_id <> auth.uid()');
    expect(fn).toContain("RAISE EXCEPTION 'Application not found' USING ERRCODE = 'P0002'");
    expect(fn).toContain("RAISE EXCEPTION 'Application is closed' USING ERRCODE = '22023'");
    expect(fn).toContain(
      "RAISE EXCEPTION 'Contact request already exists for this application' USING ERRCODE = '22023'",
    );
    expect(fn).toContain("_note := NULLIF(left(coalesce(recruiter_note, ''), 300), '');");
    expect(fn).toContain("(_app.id, auth.uid(), _app.driver_user_id, 'pending', _note)");
    expect(fn).toContain('RETURN _id;');
  });

  it('leaves the driver response function and event/notification triggers untouched', () => {
    expect(SQL).not.toContain('respond_to_contact_request');
    expect(SQL).not.toContain('rcr_emit_event');
    expect(SQL).not.toContain('notify_');
    expect(SQL).not.toContain('create_notification');
  });

  it('gates the recruiter contact select policy on applications_view', () => {
    const policy = SQL.slice(SQL.indexOf('CREATE POLICY "rcr_recruiter_select"'));
    expect(policy).toContain('FOR SELECT');
    expect(policy).toContain(
      "oa.recruiter_id, 'applications_view'::public.recruiter_workspace_permission",
    );
  });
});

/* ------------------------------------------------------------------ *
 * G — no out-of-scope backend authorization changes
 * ------------------------------------------------------------------ */
describe('RC-1E scope containment', () => {
  it('touches no out-of-scope authorization surface', () => {
    for (const forbidden of [
      'submit_opportunity_application',
      'submit_request_info',
      'withdraw_opportunity_application',
      'record_driver_application_response',
      'driver_referrals',
      'contracts',
      'driver_settlements',
      'recruiter_billing_profiles',
      'subscriptions',
      'agency_',
      'stripe',
    ]) {
      expect(SQL).not.toContain(forbidden);
    }
  });

  it('leaves applications_manage_notes dormant across the whole phase', () => {
    expect(SQL).not.toContain('applications_manage_notes');
    expect(STAFF_DASH_SRC).not.toContain('applications_manage_notes');
    expect(STAFF_DASH_SRC).not.toContain('canManageApplicationNotes');
    expect(ACCESS_ROUTE_SRC).not.toContain('canManageApplicationNotes');
    expect(staffAppHookSection).not.toContain('canManageApplicationNotes');
    expect(staffContactHookSection).not.toContain('canManageApplicationNotes');
    // Exposed for future UI only, in the permission hook.
    expect(PERM_HOOK_SRC).toContain('canManageApplicationNotes');
  });
});

/* ------------------------------------------------------------------ *
 * H — permission hook
 * ------------------------------------------------------------------ */
describe('permission hook application booleans', () => {
  it('exposes the three RC-1E booleans fail-closed on the parsed map', () => {
    expect(PERM_HOOK_SRC).toContain(
      'canViewApplications: granted && permissions.applications_view === true',
    );
    expect(PERM_HOOK_SRC).toContain(
      'canManageApplicationStatus: granted && permissions.applications_manage_status === true',
    );
    expect(PERM_HOOK_SRC).toContain('permissions.applications_request_contact === true');
  });

  it('keeps the RC-1D scoped resolution architecture', () => {
    expect(PERM_HOOK_SRC).toContain('get_my_recruiter_permissions');
    expect(PERM_HOOK_SRC).toContain(
      'resolved && resolved.userId === userId && resolved.recruiterId === id ? resolved : null',
    );
    expect(PERM_HOOK_SRC).toContain('emptyRecruiterStaffPermissions()');
    expect(PERM_HOOK_SRC).not.toContain('useRecruiterProfile');
    expect(PERM_HOOK_SRC).not.toContain('useQuery(');
  });
});

/* ------------------------------------------------------------------ *
 * I — staff data hooks
 * ------------------------------------------------------------------ */
describe('staff application hook', () => {
  it('is separate and reads only through the safe RPC', () => {
    expect(staffAppHookSection.length).toBeGreaterThan(100);
    expect(staffAppHookSection).toContain("'list_recruiter_applications_safe'");
    expect(staffAppHookSection).not.toContain('useRecruiterProfile');
    expect(staffAppHookSection).not.toContain('useRecruiterBilling');
    expect(staffAppHookSection).not.toContain('driver_user_id');
  });

  it('scopes the query key by user and workspace and requires view permission', () => {
    expect(staffAppHookSection).toContain(
      "queryKey: ['recruiter_staff_applications', user?.id, recruiterId]",
    );
    expect(staffAppHookSection).toContain('enabled: !!user && !!recruiterId && canView');
    expect(staffAppHookSection).toContain(
      'const canView = args.permissions.canViewApplications === true;',
    );
  });

  it('gates the status mutation and scopes it to the workspace', () => {
    const mutation = staffAppHookSection.slice(
      staffAppHookSection.indexOf('const updateApplicationStatus'),
    );
    expect(mutation).toContain("if (!canManageStatus) throw new Error('Not authorized');");
    expect(mutation).toContain('.update({ status })');
    expect(mutation).toContain(".eq('id', id)");
    expect(mutation).toContain(".eq('recruiter_id', recruiterId)");
    expect(mutation).toContain("qc.invalidateQueries({ queryKey: ['application_events'] })");
  });

  it('leaves the owner/driver hook unchanged', () => {
    expect(APP_HOOK_SRC).toContain(
      'export function useOpportunityApplications(opts: { recruiterId?: string } = {})',
    );
    expect(APP_HOOK_SRC).toContain(
      "queryKey: ['opportunity_applications', 'recruiter', opts.recruiterId]",
    );
  });
});

describe('staff contact hook', () => {
  it('is permission-gated and exposes no driver respond mutation', () => {
    expect(staffContactHookSection.length).toBeGreaterThan(100);
    expect(staffContactHookSection).not.toContain('respond_to_contact_request');
    expect(staffContactHookSection).toContain("supabase.rpc('request_driver_contact' as any");
    expect(staffContactHookSection).toContain(
      "if (!canRequest) throw new Error('Not authorized');",
    );
    expect(staffContactHookSection).toContain(
      "queryKey: ['recruiter_staff_contact_requests', user?.id, recruiterId, keyIds]",
    );
    expect(staffContactHookSection).toContain('const keyIds = [...applicationIds].sort().join');
  });

  it('leaves the existing owner/driver contact hook unchanged', () => {
    expect(CONTACT_HOOK_SRC).toContain(
      'export function useRecruiterContactRequests(applicationIds: string[] = [])',
    );
    expect(CONTACT_HOOK_SRC).toContain("supabase.rpc('respond_to_contact_request' as any");
  });
});

/* ------------------------------------------------------------------ *
 * J — staff dashboard surface contract
 * ------------------------------------------------------------------ */
describe('staff applications dashboard surface', () => {
  it('mounts no owner/billing/contract/referral/report/settlement surface', () => {
    for (const forbidden of [
      'useRecruiterProfile',
      'useRecruiterBilling',
      'useContractReadinessMap',
      'ContractAttachment',
      'useAgency',
      'useDriverReferrals',
      'useRecruiterReferral',
      'useRecruiterReportData',
      'useSettlement',
      'useSubscription',
      'RecruiterReadinessDialog',
      '/pricing',
    ]) {
      expect(STAFF_DASH_SRC).not.toContain(forbidden);
    }
    expect(STAFF_DASH_SRC).toContain('useRecruiterStaffApplications');
    expect(STAFF_DASH_SRC).toContain('useRecruiterStaffContactRequests');
  });

  it('fails closed without view permission and gates actions independently', () => {
    expect(STAFF_DASH_SRC).toContain('if (!canViewApplications)');
    expect(STAFF_DASH_SRC).toContain('{canManageApplicationStatus && allowed.length > 0 && (');
    expect(STAFF_DASH_SRC).toContain('{canRequestApplicationContact && (');
    expect(STAFF_DASH_SRC).toContain('canRequest={canRequestApplicationContact}');
    expect(STAFF_DASH_SRC).toContain('if (!canManageApplicationStatus) return;');
  });
});

/* ------------------------------------------------------------------ *
 * K — staff route gating (rendered)
 * ------------------------------------------------------------------ */
const permissionState = {
  permissions: emptyRecruiterStaffPermissions(),
  canViewOpportunities: false,
  canCreateOpportunities: false,
  canEditOpportunities: false,
  canChangeOpportunityStatus: false,
  canDeleteOpportunities: false,
  canViewApplications: false,
  canManageApplicationStatus: false,
  canRequestApplicationContact: false,
  canManageApplicationNotes: false,
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
vi.mock('@/components/opportunities/RecruiterStaffApplicationsDashboard', () => ({
  RecruiterStaffApplicationsDashboard: (props: {
    recruiterId: string;
    canManageApplicationStatus: boolean;
    canRequestApplicationContact: boolean;
  }) => (
    <div
      data-testid="staff-applications"
      data-recruiter={props.recruiterId}
      data-status={String(props.canManageApplicationStatus)}
      data-contact={String(props.canRequestApplicationContact)}
    />
  ),
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
        initialView="applications"
        recruiterCapabilityStatus={null}
        recruiterHubAllowed
        recruiterOperationsAllowed={false}
        recruiterAccessKind="staff"
        selectedStaffWorkspace={workspace}
      />
    </MemoryRouter>,
  );
}

describe('staff route application gating', () => {
  beforeEach(() => {
    Object.assign(permissionState, {
      permissions: emptyRecruiterStaffPermissions(),
      canViewOpportunities: false,
      canCreateOpportunities: false,
      canEditOpportunities: false,
      canChangeOpportunityStatus: false,
      canDeleteOpportunities: false,
      canViewApplications: false,
      canManageApplicationStatus: false,
      canRequestApplicationContact: false,
      canManageApplicationNotes: false,
      isLoading: false,
      error: null,
    });
  });

  it('never mounts the owner applications dashboard in staff mode', () => {
    permissionState.canViewApplications = true;
    renderStaffRoute();
    expect(screen.queryByTestId('owner-applications')).toBeNull();
    expect(screen.queryByTestId('owner-access-page')).toBeNull();
    expect(screen.getByTestId('recruiter-staff-workspace-home')).toBeTruthy();
  });

  it('hides Manage Applications without view permission', () => {
    renderStaffRoute();
    expect(screen.queryByTestId('staff-open-applications')).toBeNull();
  });

  it('hides Manage Applications while permissions are loading', () => {
    permissionState.isLoading = true;
    permissionState.canViewApplications = true;
    renderStaffRoute();
    expect(screen.queryByTestId('staff-open-applications')).toBeNull();
  });

  it('hides Manage Applications on permission error', () => {
    permissionState.error = new Error('nope');
    permissionState.canViewApplications = true;
    renderStaffRoute();
    expect(screen.queryByTestId('staff-open-applications')).toBeNull();
  });

  it('shows Manage Applications only with explicit view permission', () => {
    permissionState.canViewApplications = true;
    renderStaffRoute();
    expect(screen.getByTestId('staff-open-applications')).toBeTruthy();
    expect(screen.queryByTestId('staff-applications')).toBeNull();
  });

  it('mounts only the staff dashboard with the resolved booleans after selection', async () => {
    permissionState.canViewApplications = true;
    permissionState.canManageApplicationStatus = true;
    const { default: userEventDefault } = await import('@testing-library/user-event');
    const user = userEventDefault.setup();
    renderStaffRoute();
    await user.click(screen.getByTestId('staff-open-applications'));
    const dash = screen.getByTestId('staff-applications');
    expect(dash.getAttribute('data-recruiter')).toBe('r1');
    expect(dash.getAttribute('data-status')).toBe('true');
    expect(dash.getAttribute('data-contact')).toBe('false');
    expect(screen.queryByTestId('owner-applications')).toBeNull();
  });

  it('keeps RC-1D opportunity behavior unchanged', () => {
    permissionState.canViewOpportunities = true;
    renderStaffRoute();
    expect(screen.getByTestId('staff-open-opportunities')).toBeTruthy();
    expect(screen.queryByTestId('staff-manager')).toBeNull();
    const staffIdx = ACCESS_ROUTE_SRC.indexOf("recruiterAccessKind === 'staff'");
    expect(ACCESS_ROUTE_SRC.indexOf("safeView === 'manager'")).toBeGreaterThan(staffIdx);
    expect(ACCESS_ROUTE_SRC.indexOf("safeView === 'applications'")).toBeGreaterThan(staffIdx);
  });
});
