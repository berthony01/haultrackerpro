/**
 * Phase RC-1E — recruiter staff application authorization acceptance contract.
 * Source-contract coverage is intentionally narrow and fail-closed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const SQL = read('supabase/migration-candidates/20260815051500_phase_rc1e_recruiter_staff_application_authorization.sql');
const PERM = read('src/hooks/recruiter/useRecruiterStaffPermissions.ts');
const APPS = read('src/hooks/opportunities/useOpportunityApplications.ts');
const CONTACTS = read('src/hooks/opportunities/useRecruiterContactRequests.ts');
const DASH = read('src/components/opportunities/RecruiterStaffApplicationsDashboard.tsx');
const ROUTE = read('src/components/opportunities/recruiter/RecruiterAccessRoute.tsx');
const OWNER_DASH = read('src/components/opportunities/RecruiterApplicationsDashboard.tsx');

const between = (source: string, start: string, end: string) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b);
};

const helper = between(
  SQL,
  'CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_application_action(',
  'REVOKE ALL ON FUNCTION public.current_user_can_recruiter_application_action',
);
const safeList = between(
  SQL,
  'CREATE OR REPLACE FUNCTION public.list_recruiter_applications_safe',
  'CREATE OR REPLACE FUNCTION public.list_recruiter_application_summaries',
);
const summaries = between(
  SQL,
  'CREATE OR REPLACE FUNCTION public.list_recruiter_application_summaries',
  '-- ---------------------------------------------------------------------------\n-- D)',
);
const eventPolicy = between(
  SQL,
  'CREATE POLICY "Recruiter views events for own applications"',
  'CREATE OR REPLACE FUNCTION public.application_events_emit',
);
const emitter = between(
  SQL,
  'CREATE OR REPLACE FUNCTION public.application_events_emit',
  '-- ---------------------------------------------------------------------------\n-- F)',
);
const requestContact = between(
  SQL,
  'CREATE OR REPLACE FUNCTION public.request_driver_contact',
  'DROP POLICY IF EXISTS "rcr_recruiter_select"',
);
const staffApps = APPS.slice(APPS.indexOf('export function useRecruiterStaffApplications'));
const staffContacts = CONTACTS.slice(CONTACTS.indexOf('export function useRecruiterStaffContactRequests'));

describe('RC-1E backend permission surface', () => {
  it('authorizes exactly view, status, and contact-request application keys', () => {
    for (const key of ['applications_view', 'applications_manage_status', 'applications_request_contact']) {
      expect(helper).toContain(`'${key}'::public.recruiter_workspace_permission`);
    }
    for (const key of ['applications_manage_notes', 'opportunities_view', 'contracts_manage', 'referrals_view', 'reports_view', 'settlements_view', 'team_manage']) {
      expect(helper).not.toContain(key);
    }
  });

  it('keeps the canonical owner gate and RC-1B functions unchanged', () => {
    expect(helper).toContain('public.current_user_can_manage_recruiter_opportunities(_recruiter_id)');
    expect(helper).toContain('public.recruiter_profile_can_manage_opportunities(_recruiter_id)');
    expect(helper).toContain('public.current_user_has_recruiter_permission(_recruiter_id, _permission)');
    expect(SQL).not.toContain('CREATE OR REPLACE FUNCTION public.current_user_can_manage_recruiter_opportunities');
    expect(SQL).not.toContain('CREATE OR REPLACE FUNCTION public.current_user_has_recruiter_permission');
  });

  it('revokes helper/context/status RPC from PUBLIC and anon', () => {
    for (const fn of [
      'current_user_can_recruiter_application_action(uuid, public.recruiter_workspace_permission)',
      'recruiter_application_authorized_context(uuid, public.recruiter_workspace_permission)',
      'update_recruiter_application_status(uuid, uuid, text)',
    ]) {
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC;`);
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM anon;`);
      expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated;`);
    }
  });

  it('uses RLS-safe authorized application context without adding recruiter SELECT', () => {
    const context = between(SQL, 'CREATE OR REPLACE FUNCTION public.recruiter_application_authorized_context', 'REVOKE ALL ON FUNCTION public.recruiter_application_authorized_context');
    expect(context).toContain('SECURITY DEFINER');
    expect(context).toContain('FROM public.opportunity_applications oa');
    expect(context).toContain('public.current_user_can_recruiter_application_action(oa.recruiter_id, _permission)');
    expect(SQL).not.toContain('ON public.opportunity_applications\n  FOR SELECT');
  });

  it('routes staff status through a narrow RPC and preserves owner direct UPDATE RLS', () => {
    const rpc = between(SQL, 'CREATE OR REPLACE FUNCTION public.update_recruiter_application_status', 'REVOKE ALL ON FUNCTION public.update_recruiter_application_status');
    expect(rpc).toContain("'applications_manage_status'::public.recruiter_workspace_permission");
    expect(rpc).toContain('UPDATE public.opportunity_applications');
    expect(rpc).toContain('SET status = _status');
    expect(rpc).toContain('WHERE id = _application_id');
    expect(rpc).toContain('AND recruiter_id = _recruiter_id');
    expect(rpc).not.toContain('SET message');
    const policy = between(SQL, 'CREATE POLICY "Recruiter updates application status"', '-- ---------------------------------------------------------------------------\n-- E)');
    expect(policy).toContain('public.current_user_can_manage_recruiter_opportunities(recruiter_id)');
    expect(policy).not.toContain('applications_manage_status');
  });
});

describe('RC-1E application privacy and legacy compatibility', () => {
  it('safe list requires view and separately masks contacts without contact permission', () => {
    expect(safeList).toContain("_recruiter_id, 'applications_view'::public.recruiter_workspace_permission");
    expect(safeList).toContain("_recruiter_id, 'applications_request_contact'::public.recruiter_workspace_permission");
    expect(safeList).toContain('WHEN _can_see_contact');
    expect(safeList).toContain('COALESCE(dop.allow_verified_recruiter_contact, false)');
    expect(safeList).toContain("rcr.application_id = oa.id AND rcr.status = 'approved'");
  });

  it('preserves the lighter legacy owner summary branch and adds staff view', () => {
    expect(summaries).toContain('WHERE rp.id = _recruiter_id AND rp.user_id = _uid');
    expect(summaries).toContain("rp.status <> 'suspended' AND rp.verification_status <> 'suspended'");
    expect(summaries).toContain('public.recruiter_profile_can_manage_opportunities(_recruiter_id)');
    expect(summaries).toContain("'applications_view'::public.recruiter_workspace_permission");
  });

  it('makes staff application timeline RLS-safe while preserving owner branch', () => {
    expect(eventPolicy).toContain('JOIN public.recruiter_profiles rp ON rp.id = oa.recruiter_id');
    expect(eventPolicy).toContain('rp.user_id = auth.uid()');
    expect(eventPolicy).toContain('public.recruiter_application_authorized_context(');
    expect(eventPolicy).toContain("'applications_view'::public.recruiter_workspace_permission");
  });

  it('attributes authorized staff status events to the real recruiter actor', () => {
    expect(emitter).toContain("'applications_manage_status'::public.recruiter_workspace_permission");
    expect(emitter).toContain("_actor_type := 'recruiter';");
    expect(emitter).toContain('actor_user_id');
    expect(emitter).toContain("jsonb_build_object('from', OLD.status, 'to', NEW.status)");
  });

  it('preserves request-contact owner and non-owner error contracts', () => {
    expect(requestContact).toContain('_rp public.recruiter_profiles;');
    expect(requestContact).toContain('IF _rp.user_id = auth.uid() THEN');
    expect(requestContact).toContain('public.current_user_can_manage_recruiter_opportunities(_rp.id)');
    expect(requestContact).toContain("RAISE EXCEPTION 'Recruiter profile is not eligible for contact requests' USING ERRCODE = '42501'");
    expect(requestContact).toContain("'applications_request_contact'::public.recruiter_workspace_permission");
    expect(requestContact).toContain("RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'");
    expect(requestContact).toContain("RAISE EXCEPTION 'Application is closed' USING ERRCODE = '22023'");
    expect(requestContact).toContain("RAISE EXCEPTION 'Contact request already exists for this application' USING ERRCODE = '22023'");
    expect(requestContact).toContain("NULLIF(left(coalesce(recruiter_note, ''), 300), '')");
    expect(requestContact).toContain("(_app.id, auth.uid(), _app.driver_user_id, 'pending', _note)");
  });

  it('uses RLS-safe context for recruiter contact-request SELECT', () => {
    const policy = SQL.slice(SQL.indexOf('CREATE POLICY "rcr_recruiter_select"'));
    expect(policy).toContain('public.recruiter_application_authorized_context(');
    expect(policy).toContain("'applications_view'::public.recruiter_workspace_permission");
  });
});

describe('RC-1E scope containment', () => {
  it('does not replace protected referral/contract/notification/driver workflow functions', () => {
    for (const fn of [
      'bridge_application_to_referral',
      'opportunity_applications_require_contract_for_hire',
      'opportunity_applications_update_guard',
      'opportunity_applications_snapshot_freeze',
      'opportunity_applications_contact_snapshot_guard',
      'respond_to_contact_request',
      'submit_opportunity_application',
      'submit_request_info',
      'withdraw_opportunity_application',
      'record_driver_application_response',
    ]) {
      expect(SQL).not.toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
    }
    expect(SQL).not.toContain('create_notification');
    expect(SQL).not.toContain('driver_settlements');
    expect(SQL).not.toContain('recruiter_billing_profiles');
    expect(SQL).not.toContain('stripe');
  });

  it('keeps applications_manage_notes dormant operationally', () => {
    expect(helper).not.toContain('applications_manage_notes');
    expect(staffApps).not.toContain('canManageApplicationNotes');
    expect(staffContacts).not.toContain('canManageApplicationNotes');
    expect(DASH).not.toContain('canManageApplicationNotes');
    expect(ROUTE).not.toContain('canManageApplicationNotes');
    expect(PERM).toContain('canManageApplicationNotes');
  });
});

describe('RC-1E client permission and staff hooks', () => {
  it('extends the scoped fail-closed permission hook with application booleans', () => {
    expect(PERM).toContain('resolved.userId === userId && resolved.recruiterId === id');
    expect(PERM).toContain('emptyRecruiterStaffPermissions()');
    expect(PERM).toContain('canViewApplications: granted && permissions.applications_view === true');
    expect(PERM).toContain('canManageApplicationStatus: granted && permissions.applications_manage_status === true');
    expect(PERM).toContain('permissions.applications_request_contact === true');
  });

  it('keeps staff reads on the safe RPC and status writes on the guarded RPC', () => {
    expect(staffApps).toContain("'list_recruiter_applications_safe'");
    expect(staffApps).toContain("queryKey: ['recruiter_staff_applications', user?.id, recruiterId]");
    expect(staffApps).toContain('enabled: !!user && !!recruiterId && canView');
    expect(staffApps).toContain("if (!canManageStatus) throw new Error('Not authorized');");
    expect(staffApps).toContain("'update_recruiter_application_status'");
    expect(staffApps).toContain('_recruiter_id: recruiterId');
    expect(staffApps).toContain('_application_id: id');
    expect(staffApps).toContain('_status: status');
    expect(staffApps).not.toContain(".from('opportunity_applications')");
  });

  it('keeps staff contact requests permission-gated and exposes no driver response mutation', () => {
    expect(staffContacts).toContain("if (!canRequest) throw new Error('Not authorized');");
    expect(staffContacts).toContain("supabase.rpc('request_driver_contact' as any");
    expect(staffContacts).toContain("queryKey: ['recruiter_staff_contact_requests', user?.id, recruiterId, keyIds]");
    expect(staffContacts).not.toContain('respond_to_contact_request');
  });

  it('leaves the original owner/driver application hook present', () => {
    expect(APPS).toContain('export function useOpportunityApplications(opts: { recruiterId?: string } = {})');
    expect(APPS).toContain("queryKey: ['opportunity_applications', 'recruiter', opts.recruiterId]");
  });
});

describe('RC-1E staff UI routing surface', () => {
  it('staff dashboard mounts only staff-safe application surfaces', () => {
    expect(DASH).toContain('useRecruiterStaffApplications');
    expect(DASH).toContain('useRecruiterStaffContactRequests');
    expect(DASH).toContain('ApplicationTimeline');
    for (const forbidden of ['useRecruiterProfile', 'useRecruiterBilling', 'useContractReadinessMap', 'ContractAttachment', 'useRecruiterReportData', 'useSettlement', 'useSubscription', 'RecruiterReadinessDialog']) {
      expect(DASH).not.toContain(forbidden);
    }
    expect(DASH).toContain('if (!canViewApplications)');
    expect(DASH).toContain('canManageApplicationStatus');
    expect(DASH).toContain('canRequestApplicationContact');
  });

  it('staff route gates Applications before owner operational branches', () => {
    expect(ROUTE).toContain('staff-open-applications');
    expect(ROUTE).toContain('RecruiterStaffApplicationsDashboard');
    const staff = ROUTE.indexOf("recruiterAccessKind === 'staff'");
    expect(staff).toBeGreaterThanOrEqual(0);
    expect(ROUTE.indexOf("safeView === 'applications'")).toBeGreaterThan(staff);
  });

  it('does not modify the owner dashboard into a staff-aware component', () => {
    expect(OWNER_DASH).not.toContain('RecruiterStaffApplicationsDashboard');
    expect(OWNER_DASH).not.toContain('useRecruiterStaffApplications');
  });
});
