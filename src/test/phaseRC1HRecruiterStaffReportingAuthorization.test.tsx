/**
 * Phase RC-1H — Recruiter staff reporting authorization contract.
 *
 * Locks the authorization architecture: exact permission vocabulary, owner
 * exclusion from the staff path, no role shortcut, readiness + explicit
 * permission + standalone Growth/Fleet billing, no Agency entitlement, no RLS
 * changes, minimal safe payload, workspace-scoped contact requests, separate
 * view/export RPCs, fail-closed client booleans, and owner report output
 * compatibility.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildRecruiterReportCSV } from '@/lib/recruiterReports/csv';
import { aggregateRecruiterReport } from '@/lib/recruiterReports/aggregator';
import { normalizeRecruiterStaffReportPayload } from '@/hooks/recruiter/useRecruiterStaffReportData';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const SQL = read(
  'supabase/migration-candidates/20260816033000_phase_rc1h_recruiter_staff_reporting_authorization.sql',
);
const PERMS_HOOK = read('src/hooks/recruiter/useRecruiterStaffPermissions.ts');
const REPORT_HOOK = read('src/hooks/recruiter/useRecruiterStaffReportData.ts');
const PANEL = read('src/components/recruiter/RecruiterStaffReportsPanel.tsx');
const ROUTE = read('src/components/opportunities/recruiter/RecruiterAccessRoute.tsx');
const CSV_SRC = read('src/lib/recruiterReports/csv.ts');
const PDF_SRC = read('src/lib/recruiterReports/pdf.ts');

const HELPER = SQL.split(
  'CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_staff_report_action',
)[1].split('$function$;')[0];

const BUILDER = SQL.split(
  'CREATE OR REPLACE FUNCTION public._build_recruiter_staff_report_payload',
)[1].split('$function$;')[0];

const VIEW_RPC = SQL.split(
  'CREATE OR REPLACE FUNCTION public.get_recruiter_staff_report_view_data',
)[1].split('$function$;')[0];

const EXPORT_RPC = SQL.split(
  'CREATE OR REPLACE FUNCTION public.get_recruiter_staff_report_export_data',
)[1].split('$function$;')[0];

describe('RC-1H — staff report helper vocabulary', () => {
  it('accepts exactly reports_view and reports_export', () => {
    expect(HELPER).toContain("'reports_view'::public.recruiter_workspace_permission");
    expect(HELPER).toContain("'reports_export'::public.recruiter_workspace_permission");
    for (const key of [
      'opportunities_view',
      'opportunities_create',
      'applications_view',
      'applications_manage_status',
      'contracts_view',
      'contracts_manage',
      'referrals_view',
      'referral_terms_manage',
      'settlements_view',
      'team_manage',
    ]) {
      expect(HELPER).not.toContain(key);
    }
  });

  it('explicitly excludes the canonical recruiter owner from the staff path', () => {
    expect(HELPER).toContain('NOT public.is_recruiter_owner(auth.uid(), _recruiter_id)');
    expect(HELPER).toContain('auth.uid() IS NOT NULL');
  });

  it('has no role-label shortcut anywhere in the migration', () => {
    expect(SQL).not.toMatch(/'recruiter_admin'/);
    expect(SQL).not.toMatch(/'recruiter_staff'/);
    expect(SQL).not.toMatch(/recruiter_member_role/);
  });

  it('requires readiness + explicit permission + standalone Growth/Fleet billing', () => {
    expect(HELPER).toContain('public.recruiter_profile_can_manage_opportunities(_recruiter_id)');
    expect(HELPER).toContain(
      'public.current_user_has_recruiter_permission(_recruiter_id, _permission)',
    );
    expect(HELPER).toContain('public.recruiter_billing_profiles b');
    expect(HELPER).toContain("b.plan IN ('growth', 'fleet')");
    expect(HELPER).toContain("b.status IN ('active', 'trialing')");
    expect(HELPER).toContain('SECURITY DEFINER');
    expect(HELPER).toContain('SET search_path = public');
  });

  it('never consults Agency entitlement', () => {
    expect(SQL).not.toMatch(/agency_entitlement/i);
    expect(SQL).not.toMatch(/agency_members/i);
    expect(SQL).not.toMatch(/get_agency_entitlement/i);
    expect(SQL).not.toMatch(/agency_included/i);
    expect(SQL).not.toMatch(/effective_recruiter_tier/i);
  });
});

describe('RC-1H — wrapper authorization', () => {
  it('view RPC requires reports_view', () => {
    expect(VIEW_RPC).toContain(
      "public.current_user_can_recruiter_staff_report_action(\n       _recruiter_id,\n       'reports_view'",
    );
    expect(VIEW_RPC).not.toContain("'reports_export'");
    expect(VIEW_RPC).toContain("ERRCODE = '42501'");
  });

  it('export RPC requires BOTH reports_view and reports_export', () => {
    expect(EXPORT_RPC).toContain("'reports_view'::public.recruiter_workspace_permission");
    expect(EXPORT_RPC).toContain("'reports_export'::public.recruiter_workspace_permission");
    // Two independent fail-closed checks — export alone is insufficient.
    expect(
      (EXPORT_RPC.match(/current_user_can_recruiter_staff_report_action/g) ?? []).length,
    ).toBe(2);
  });

  it('validates the date range in both wrappers', () => {
    for (const fn of [VIEW_RPC, EXPORT_RPC]) {
      expect(fn).toContain('_from IS NULL OR _to IS NULL OR _from > _to');
    }
  });

  it('revokes PUBLIC/anon on public RPCs and keeps the builder internal', () => {
    for (const sig of [
      'public.get_recruiter_staff_report_view_data(uuid, date, date)',
      'public.get_recruiter_staff_report_export_data(uuid, date, date)',
      'public.current_user_can_recruiter_staff_report_action(uuid, public.recruiter_workspace_permission)',
    ]) {
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`);
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM anon;`);
      expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`);
    }
    const builderSig = 'public._build_recruiter_staff_report_payload(uuid, date, date)';
    expect(SQL).toContain(`REVOKE ALL ON FUNCTION ${builderSig} FROM PUBLIC;`);
    expect(SQL).toContain(`REVOKE ALL ON FUNCTION ${builderSig} FROM anon;`);
    expect(SQL).toContain(`REVOKE ALL ON FUNCTION ${builderSig} FROM authenticated;`);
    expect(SQL).not.toContain(`GRANT EXECUTE ON FUNCTION ${builderSig} TO authenticated;`);
  });

  it('creates or alters no RLS policy and no table', () => {
    expect(SQL).not.toMatch(/CREATE POLICY/i);
    expect(SQL).not.toMatch(/ALTER POLICY/i);
    expect(SQL).not.toMatch(/DROP POLICY/i);
    expect(SQL).not.toMatch(/ALTER TABLE/i);
    expect(SQL).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it('does not redefine any frozen resolver', () => {
    for (const fn of [
      'FUNCTION public.current_user_has_recruiter_permission',
      'FUNCTION public.recruiter_profile_can_manage_opportunities',
      'FUNCTION public.is_recruiter_owner',
      'FUNCTION public.current_user_can_recruiter_contract_action',
      'FUNCTION public.current_user_can_recruiter_referral_action',
      'FUNCTION public.current_user_can_recruiter_application_action',
    ]) {
      expect(SQL).not.toContain(`CREATE OR REPLACE ${fn}`);
    }
  });
});

describe('RC-1H — safe payload projection', () => {
  it('returns only the allowlisted report fields', () => {
    for (const field of [
      "'id', o.id",
      "'title', o.title",
      "'view_count', o.view_count",
      "'published_at', o.published_at",
      "'opportunity_id', oa.opportunity_id",
      "'event_type', ae.event_type",
      "'application_id', c.application_id",
    ]) {
      expect(BUILDER).toContain(field);
    }
  });

  it('excludes every sensitive field', () => {
    for (const forbidden of [
      'stripe',
      'customer_id',
      'subscription',
      'driver_user_id',
      'driver_profile',
      'full_name',
      'recruiter_email',
      'recruiter_phone',
      'recruiter_note',
      'driver_note',
      'extracted_text',
      'signature',
      'ip_address',
      'user_agent',
      'audit',
      'loads',
      'expenses',
      'fuel',
      'rpm',
      'tax',
    ]) {
      expect(BUILDER.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('exposes neutral header compatibility values only', () => {
    expect(BUILDER).toContain("'audience', 'staff'");
    expect(BUILDER).toContain("'plan', 'workspace'");
    expect(BUILDER).toContain("'planStatus', 'authorized'");
    expect(BUILDER).toContain("'activeLimit', 0");
  });

  it('scopes contact requests to the workspace via application ownership', () => {
    const block = BUILDER.split('public.recruiter_contact_requests cr')[1].split(';')[0];
    expect(block).toContain('JOIN public.opportunity_applications oa ON oa.id = cr.application_id');
    expect(block).toContain('oa.recruiter_id = _recruiter_id');
    expect(block).not.toContain('auth.uid()');
    expect(BUILDER).not.toContain('cr.recruiter_user_id');
  });
});

describe('RC-1H — client permission booleans', () => {
  it('are exact and fail-closed', () => {
    expect(PERMS_HOOK).toContain(
      'canViewReports: granted && permissions.reports_view === true',
    );
    expect(PERMS_HOOK).toContain(
      'canExportReports: granted && permissions.reports_export === true',
    );
    expect(PERMS_HOOK).not.toMatch(/recruiter_admin|recruiter_staff/);
  });
});

describe('RC-1H — staff report hook', () => {
  it('calls only the two exact RPCs and no table', () => {
    expect(REPORT_HOOK).toContain("'get_recruiter_staff_report_view_data'");
    expect(REPORT_HOOK).toContain("'get_recruiter_staff_report_export_data'");
    expect(REPORT_HOOK).not.toMatch(/supabase\s*\.\s*from\(/);
    expect(REPORT_HOOK).not.toMatch(/\.from\(/);
  });

  it('mounts no owner profile / billing / Agency hook', () => {
    for (const bad of [
      'useRecruiterProfile',
      'useRecruiterBilling',
      'useRecruiterReportData',
      'useAgency',
      'useAgencyEntitlement',
      'useSubscription',
    ]) {
      expect(REPORT_HOOK).not.toContain(bad);
    }
  });

  it('scopes the cache key by user + workspace + range', () => {
    expect(REPORT_HOOK).toContain("'recruiter_staff_report_data'");
    expect(REPORT_HOOK).toContain('user?.id');
    expect(REPORT_HOOK).toContain('recruiterId');
    expect(REPORT_HOOK).toContain('range?.from');
    expect(REPORT_HOOK).toContain('range?.to');
  });

  it('normalizes payloads fail-closed', () => {
    const range = { from: '2026-01-01', to: '2026-01-31', label: 'x' };
    expect(normalizeRecruiterStaffReportPayload(null, range)).toBeNull();
    expect(normalizeRecruiterStaffReportPayload('nope', range)).toBeNull();
    expect(normalizeRecruiterStaffReportPayload([], range)).toBeNull();
    expect(normalizeRecruiterStaffReportPayload({ header: {} }, range)).toBeNull();

    const ok = normalizeRecruiterStaffReportPayload(
      {
        header: {
          companyName: 'Acme Carriers',
          recruiterName: 'Dana',
          verificationStatus: 'verified',
          audience: 'staff',
          plan: 'fleet',
          planStatus: 'active',
          activeLimit: 99,
          activeCount: 3,
        },
        opportunities: [],
        applications: [],
        events: [],
        contactRequests: [],
        contracts: [],
      },
      range,
    );
    expect(ok).not.toBeNull();
    // Server-provided plan/billing values are never trusted or surfaced.
    expect(ok!.header.plan).toBe('workspace');
    expect(ok!.header.planStatus).toBe('authorized');
    expect(ok!.header.activeLimit).toBe(0);
    expect(ok!.header.audience).toBe('staff');
  });
});

describe('RC-1H — route wiring', () => {
  it('opens reports only with reports_view', () => {
    expect(ROUTE).toContain(
      'const canOpenReports =\n    !perms.isLoading && !perms.error && perms.canViewReports;',
    );
    expect(ROUTE).toContain("staffView === 'reports' && canOpenReports");
    expect(ROUTE).toContain('{canOpenReports && (');
    expect(ROUTE).not.toContain('perms.canExportReports &&');
  });

  it('mounts the staff panel and leaves the owner report route intact', () => {
    expect(ROUTE).toContain('<RecruiterStaffReportsPanel');
    expect(ROUTE).toContain('canViewReports={perms.canViewReports}');
    expect(ROUTE).toContain('canExportReports={perms.canExportReports}');
    expect(ROUTE).toContain("import('@/components/recruiter/RecruiterReportsPanel')");
    expect(ROUTE).toContain('<RecruiterReportsPanel');
  });
});

describe('RC-1H — staff panel isolation', () => {
  it('imports no owner / billing / Agency / operational surface', () => {
    for (const bad of [
      'useRecruiterReportData',
      'RecruiterReportsPanel',
      'useRecruiterProfile',
      'useRecruiterBilling',
      'useAgency',
      'useSubscription',
      'Checkout',
      'Upgrade to',
      'Crown',
    ]) {
      expect(PANEL).not.toContain(bad);
    }
  });

  it('fetches a fresh export payload before generating PDF/CSV', () => {
    const gen = PANEL.split('const generate = async ()')[1];
    expect(gen).toContain('await loadExportData()');
    const exportIdx = gen.indexOf('await loadExportData()');
    expect(exportIdx).toBeGreaterThan(-1);
    expect(gen.indexOf('buildRecruiterReportCSV')).toBeGreaterThan(exportIdx);
    expect(gen.indexOf('buildRecruiterReportPDF')).toBeGreaterThan(exportIdx);
    expect(gen).not.toContain('aggregate,');
  });

  it('gates export controls on both permissions', () => {
    expect(PANEL).toContain('const canExport = canView && canExportReports === true;');
    expect(PANEL).toContain('{canExport && (');
  });
});

describe('RC-1H — report output privacy compatibility', () => {
  const base = {
    companyName: 'Acme Carriers',
    recruiterName: 'Dana',
    verificationStatus: 'verified',
    plan: 'growth',
    planStatus: 'active',
    activeLimit: 25,
    activeCount: 2,
  };
  const range = { from: '2026-01-01', to: '2026-01-31', label: 'Jan' };
  const input = {
    range,
    opportunities: [],
    applications: [],
    events: [],
    contactRequests: [],
    contracts: [],
  };

  it('owner CSV output is unchanged when audience is absent', () => {
    const csv = buildRecruiterReportCSV(
      'activity',
      aggregateRecruiterReport({ ...input, header: { ...base } }),
    );
    expect(csv).toContain('Plan,Growth');
    expect(csv).toContain('Billing Status,Active');
    expect(csv).toContain('Premium Tools,Active');
    expect(csv).toContain('Priority Placement,Included');
  });

  it('staff CSV output omits all plan/billing/upgrade lines', () => {
    const csv = buildRecruiterReportCSV(
      'activity',
      aggregateRecruiterReport({
        ...input,
        header: { ...base, plan: 'workspace', planStatus: 'authorized', audience: 'staff' as const },
      }),
    );
    expect(csv).toContain('Company,Acme Carriers');
    expect(csv).toContain('Date Range,2026-01-01 to 2026-01-31');
    expect(csv).toContain('EXECUTIVE SUMMARY');
    expect(csv).toContain('DISCLAIMER');
    expect(csv).not.toContain('Plan,');
    expect(csv).not.toContain('Billing Status');
    expect(csv).not.toContain('Premium Tools');
    expect(csv).not.toContain('Priority Placement');
    expect(csv).not.toContain('Upgrade');
  });

  it('PDF renderer branches on the staff audience only', () => {
    expect(PDF_SRC).toContain("if (data.header.audience === 'staff')");
    expect(CSV_SRC).toContain("const isStaff = data.header.audience === 'staff';");
    expect(CSV_SRC).toContain('if (!isStaff) {');
  });
});

describe('RC-1H — frozen files', () => {
  const changed = execFileSync(
    'git',
    ['diff', '--name-only', 'fc79efd7100216edc1ad4caf4378059a9408df89'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);

  it('leaves the owner report hook and panel untouched', () => {
    expect(changed).not.toContain('src/hooks/recruiter/useRecruiterReportData.ts');
    expect(changed).not.toContain('src/components/recruiter/RecruiterReportsPanel.tsx');
  });

  it('leaves generated Supabase types untouched', () => {
    expect(changed).not.toContain('src/integrations/supabase/types.ts');
  });

  it('changes only allowlisted files', () => {
    const allowed = new Set([
      'supabase/migration-candidates/20260816033000_phase_rc1h_recruiter_staff_reporting_authorization.sql',
      'src/hooks/recruiter/useRecruiterStaffPermissions.ts',
      'src/hooks/recruiter/useRecruiterStaffReportData.ts',
      'src/components/recruiter/RecruiterStaffReportsPanel.tsx',
      'src/components/opportunities/recruiter/RecruiterAccessRoute.tsx',
      'src/lib/recruiterReports/aggregator.ts',
      'src/lib/recruiterReports/csv.ts',
      'src/lib/recruiterReports/pdf.ts',
      'src/test/phaseRC1HRecruiterStaffReportingAuthorization.test.tsx',
    ]);
    for (const f of changed) expect(allowed.has(f)).toBe(true);
  });
});
