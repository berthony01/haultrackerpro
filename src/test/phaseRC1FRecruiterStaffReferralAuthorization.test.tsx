import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const SQL = read(
  'supabase/migration-candidates/20260815134500_phase_rc1f_recruiter_staff_referral_authorization.sql',
);
const PERMS_HOOK = read('src/hooks/recruiter/useRecruiterStaffPermissions.ts');
const REFERRALS_HOOK = read('src/hooks/opportunities/useRecruiterReferrals.ts');
const SETTINGS_HOOK = read('src/hooks/opportunities/useRecruiterReferralSettings.ts');
const PANEL = read('src/components/opportunities/RecruiterStaffReferralsPanel.tsx');
const ROUTE = read('src/components/opportunities/recruiter/RecruiterAccessRoute.tsx');

describe('RC-1F — referral authorization helper', () => {
  it('accepts exactly the three RC-1F permission keys', () => {
    const helper = SQL.split(
      'CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_referral_action',
    )[1].split('$function$;')[0];
    expect(helper).toContain("'referrals_view'::public.recruiter_workspace_permission");
    expect(helper).toContain("'referrals_manage_status'::public.recruiter_workspace_permission");
    expect(helper).toContain("'referral_terms_manage'::public.recruiter_workspace_permission");
    for (const key of [
      'applications_manage_notes',
      'applications_view',
      'opportunities_view',
      'contracts_manage',
      'reports_view',
      'settlements_view',
      'team_manage',
    ]) {
      expect(helper).not.toContain(key);
    }
  });

  it('uses is_recruiter_owner for owner and readiness + explicit permission for staff', () => {
    const helper = SQL.split(
      'CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_referral_action',
    )[1].split('$function$;')[0];
    expect(helper).toContain('public.is_recruiter_owner(auth.uid(), _recruiter_id)');
    expect(helper).toContain('public.recruiter_profile_can_manage_opportunities(_recruiter_id)');
    expect(helper).toContain(
      'public.current_user_has_recruiter_permission(_recruiter_id, _permission)',
    );
    expect(helper).toContain('auth.uid() IS NOT NULL');
  });

  it('revokes PUBLIC/anon and grants authenticated on every new RPC', () => {
    const fns = [
      'public.current_user_can_recruiter_referral_action(uuid, public.recruiter_workspace_permission)',
      'public.list_recruiter_referrals_safe(uuid)',
      'public.recruiter_referral_authorized_context(uuid, public.recruiter_workspace_permission)',
      'public.update_recruiter_referral_status(uuid, uuid, text)',
      'public.get_recruiter_referral_settings_for_workspace(uuid)',
      'public.upsert_recruiter_referral_settings_for_workspace(uuid, boolean, numeric, text, integer, text)',
    ];
    for (const fn of fns) {
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`);
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM anon;`);
      expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO authenticated;`);
    }
  });
});

describe('RC-1F — driver_referrals base table stays owner-only', () => {
  it('adds no staff SELECT/UPDATE policy on driver_referrals', () => {
    expect(SQL).not.toMatch(/CREATE POLICY[^;]*ON public\.driver_referrals/i);
    expect(SQL).not.toMatch(/DROP POLICY[^;]*ON public\.driver_referrals/i);
  });

  it('does not broaden recruiter_referral_settings base RLS', () => {
    expect(SQL).not.toMatch(/POLICY[^;]*ON public\.recruiter_referral_settings/i);
  });
});

describe('RC-1F — safe read and status write RPCs', () => {
  it('safe list requires referrals_view and scopes recruiter_id', () => {
    const fn = SQL.split('CREATE OR REPLACE FUNCTION public.list_recruiter_referrals_safe')[1]
      .split('$function$;')[0];
    expect(fn).toContain("'referrals_view'");
    expect(fn).toContain('recruiter_id = _recruiter_id');
    expect(fn).toMatch(/created_at DESC/i);
  });

  it('status RPC updates only status and scopes id + recruiter_id', () => {
    const fn = SQL.split('CREATE OR REPLACE FUNCTION public.update_recruiter_referral_status')[1]
      .split('$function$;')[0];
    expect(fn).toContain("'referrals_manage_status'");
    expect(fn).toMatch(/SET status = _status/);
    expect(fn).toContain('r.id = _referral_id');
    expect(fn).toContain('r.recruiter_id = _recruiter_id');
    expect(fn).not.toMatch(/SET[^;]*referred_driver_(email|phone|name)/);
    expect(fn).toContain('RETURN _updated = 1;');
  });

  it('authorized context returns only recruiter_id, never contact fields', () => {
    const fn = SQL.split(
      'CREATE OR REPLACE FUNCTION public.recruiter_referral_authorized_context',
    )[1].split('$function$;')[0];
    expect(fn).toContain('current_user_can_recruiter_referral_action');
    expect(fn).not.toContain('referred_driver_email');
    expect(fn).not.toContain('referred_driver_phone');
  });
});

describe('RC-1F — trigger changes are minimal', () => {
  const beforeUpdate = SQL.split(
    'CREATE OR REPLACE FUNCTION public.driver_referrals_before_update',
  )[1].split('$function$;')[0];

  it('preserves admin/bridge/driver/immutable behavior', () => {
    expect(beforeUpdate).toContain('is_admin');
    expect(beforeUpdate).toContain('app.referral_bridge_update');
    expect(beforeUpdate).toContain('referring_driver_id');
    expect(beforeUpdate).toContain('referred_driver_user_id');
    expect(beforeUpdate).toContain('last_status_at');
  });

  it('adds exactly the manage-status staff gate', () => {
    expect(beforeUpdate).toContain('current_user_can_recruiter_referral_action(');
    expect(beforeUpdate).toContain('OLD.recruiter_id,');
    expect(beforeUpdate).toContain(
      "'referrals_manage_status'::public.recruiter_workspace_permission",
    );
    expect(beforeUpdate).not.toContain('referral_terms_manage');
  });

  it('classifies authorized staff as recruiter with the real actor id', () => {
    const emit = SQL.split('CREATE OR REPLACE FUNCTION public.driver_referrals_emit_event')[1]
      .split('$function$;')[0];
    expect(emit).toContain('_actor uuid := auth.uid()');
    expect(emit).toContain("_role := 'admin'");
    expect(emit).toContain("_role := 'driver'");
    expect(emit).toContain("'referrals_manage_status'");
    expect(emit).toContain("_role := 'recruiter'");
  });

  it('event policy keeps existing parties and adds an RLS-safe staff branch', () => {
    const policy = SQL.split('CREATE POLICY "Referral parties view referral events"')[1].split(
      ');',
    )[0];
    expect(policy).toContain('r.referring_driver_id = auth.uid()');
    expect(policy).toContain('r.referred_driver_user_id = auth.uid()');
    expect(policy).toContain('public.is_recruiter_owner(auth.uid(), r.recruiter_id)');
    expect(policy).toContain('public.recruiter_referral_authorized_context(');
    expect(SQL).not.toMatch(/POLICY "Admins view all referral events"/);
  });
});

describe('RC-1F — settings RPC semantics', () => {
  const getFn = SQL.split(
    'CREATE OR REPLACE FUNCTION public.get_recruiter_referral_settings_for_workspace',
  )[1].split('$function$;')[0];
  const upsertFn = SQL.split(
    'CREATE OR REPLACE FUNCTION public.upsert_recruiter_referral_settings_for_workspace',
  )[1].split('$function$;')[0];

  it('read permits referrals_view OR referral_terms_manage', () => {
    expect(getFn).toContain("'referrals_view'");
    expect(getFn).toContain("'referral_terms_manage'");
  });

  it('write requires referral_terms_manage and never sets the disclaimer', () => {
    expect(upsertFn).toContain("'referral_terms_manage'");
    expect(upsertFn).not.toMatch(/external_payment_disclaimer\s*=/);
    expect(upsertFn).toContain('ON CONFLICT');
  });

  it('exposes no staff delete settings RPC', () => {
    expect(SQL).not.toMatch(/delete_recruiter_referral_settings/i);
  });
});

describe('RC-1F — frozen production functions are not replaced', () => {
  it('candidate does not redefine frozen functions', () => {
    for (const fn of [
      'bridge_application_to_referral',
      'create_driver_referral_safe',
      'driver_referrals_before_insert',
      'notify_referral_insert',
      'notify_referral_status_update',
      'current_user_has_recruiter_permission',
      'recruiter_profile_can_manage_opportunities',
      'is_recruiter_owner',
      'current_user_can_recruiter_application_action',
      'current_user_can_recruiter_opportunity_action',
    ]) {
      expect(SQL).not.toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
    }
  });

  it('touches no unrelated authorization surface', () => {
    for (const token of [
      'opportunity_applications',
      'recruiter_contact_requests',
      'contracts',
      'driver_settlements',
      'subscriptions',
      'agency_',
      'stripe',
    ]) {
      expect(SQL.toLowerCase()).not.toContain(`policy` + ` ` + token);
    }
    expect(SQL).not.toContain('request_driver_contact');
    expect(SQL).not.toContain('respond_to_contact_request');
  });
});

describe('RC-1F — client permission booleans', () => {
  it('exposes fail-closed referral booleans from the parsed map', () => {
    expect(PERMS_HOOK).toContain(
      "canViewReferrals: granted && permissions.referrals_view === true",
    );
    expect(PERMS_HOOK).toContain(
      "canManageReferralStatus: granted && permissions.referrals_manage_status === true",
    );
    expect(PERMS_HOOK).toContain(
      "canManageReferralTerms: granted && permissions.referral_terms_manage === true",
    );
  });

  it('keeps applications_manage_notes dormant', () => {
    expect(PERMS_HOOK).toContain('canManageApplicationNotes');
    expect(PANEL).not.toContain('canManageApplicationNotes');
    expect(ROUTE).not.toContain('canManageApplicationNotes');
  });
});

describe('RC-1F — staff hooks are separate and RPC-only', () => {
  it('owner hooks remain present alongside the staff hooks', () => {
    expect(REFERRALS_HOOK).toContain('export function useRecruiterReferrals(');
    expect(REFERRALS_HOOK).toContain('export function useRecruiterStaffReferrals(');
    expect(SETTINGS_HOOK).toContain('export function useRecruiterReferralSettings(');
    expect(SETTINGS_HOOK).toContain('export function useRecruiterStaffReferralSettings(');
  });

  it('staff referral hook uses safe RPCs and user+workspace scoped keys', () => {
    const staff = REFERRALS_HOOK.split('export function useRecruiterStaffReferrals(')[1];
    expect(staff).toContain("'list_recruiter_referrals_safe'");
    expect(staff).toContain("'update_recruiter_referral_status'");
    expect(staff).not.toContain(".from('driver_referrals')");
    expect(staff).toContain("['recruiter_staff_referrals', user?.id, recruiterId]");
    expect(staff).toContain('canView');
    expect(staff).toContain('canManageStatus');
  });

  it('staff settings hook uses safe RPCs, is scoped, and has no delete', () => {
    const staff = SETTINGS_HOOK.split('export function useRecruiterStaffReferralSettings(')[1];
    expect(staff).toContain("'get_recruiter_referral_settings_for_workspace'");
    expect(staff).toContain("'upsert_recruiter_referral_settings_for_workspace'");
    expect(staff).not.toContain(".from('recruiter_referral_settings')");
    expect(staff).not.toMatch(/delete/i);
    expect(staff).toContain(
      "['recruiter_staff_referral_settings', user?.id, recruiterId]",
    );
    expect(staff).toContain('canManageTerms');
  });
});

describe('RC-1F — staff panel isolation', () => {
  it('does not mount owner referral surfaces', () => {
    for (const banned of [
      'RecruiterReferralsPanel',
      'RecruiterReferralSettingsCard',
      'RecruiterReferralAnalyticsCard',
      'useRecruiterReferrals(',
      'useRecruiterReferralSettings(',
      'useRecruiterProfile',
      'useRecruiterBilling',
      'useContractReadinessMap',
      'ContractAttachment',
      'useAgency',
      'Subscription',
    ]) {
      const imports = PANEL.split('\n')
        .filter((l) => l.trimStart().startsWith('import') || /^\s+[A-Za-z]/.test(l))
        .join('\n')
        .split('interface Props')[0];
      expect(imports).not.toContain(banned);
    }
  });

  it('gates list, status control, and terms editing independently', () => {
    expect(PANEL).toContain('canViewReferrals');
    expect(PANEL).toContain('canManageReferralStatus');
    expect(PANEL).toContain('canManageReferralTerms');
    expect(PANEL).toContain('EXTERNAL_PAYMENT_DISCLAIMER');
    expect(PANEL).toContain('marked_paid_externally');
    expect(PANEL).toContain('AlertDialog');
  });
});

describe('RC-1F — staff route entry', () => {
  it('adds a permission-gated referrals entry that fails closed', () => {
    expect(ROUTE).toContain("'home' | 'opportunities' | 'applications' | 'referrals'");
    expect(ROUTE).toContain('const canOpenReferrals =');
    expect(ROUTE).toContain('!perms.isLoading &&');
    expect(ROUTE).toContain('(perms.canViewReferrals || perms.canManageReferralTerms)');
    expect(ROUTE).toContain('data-testid="staff-open-referrals"');
    expect(ROUTE).toContain('<RecruiterStaffReferralsPanel');
  });

  it('never mounts the owner referral panel in staff mode', () => {
    const staffBranch = ROUTE.split('StaffWorkspaceRoute')[1] ?? '';
    expect(staffBranch).not.toContain('<RecruiterReferralsPanel');
  });

  it('leaves the RC-1D opportunity entry unchanged', () => {
    expect(ROUTE).toContain('data-testid="staff-open-opportunities"');
    expect(ROUTE).toContain(
      'const canOpenOpportunities =\n    !perms.isLoading && !perms.error && perms.canViewOpportunities;',
    );
  });
});
