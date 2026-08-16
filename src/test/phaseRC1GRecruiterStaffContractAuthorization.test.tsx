/**
 * Phase RC-1G — Recruiter staff contract authorization source contract.
 *
 * These assertions lock the authorization architecture: exact permission
 * vocabulary, no role shortcut, owner preservation, staff readiness +
 * explicit permission + standalone Growth/Fleet billing, SELECT-only staff
 * RLS, safe-projection limits, Edge Function gating, and fail-closed routing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const SQL = read(
  'supabase/migration-candidates/20260816020000_phase_rc1g_recruiter_staff_contract_authorization.sql',
);
const PERMS_HOOK = read('src/hooks/recruiter/useRecruiterStaffPermissions.ts');
const CONTRACTS_HOOK = read('src/hooks/contracts/useRecruiterStaffContracts.ts');
const STAFF_VIEW = read('src/components/contracts/RecruiterStaffContractsView.tsx');
const ATTACHMENT = read('src/components/contracts/ContractAttachment.tsx');
const ROUTE = read('src/components/opportunities/recruiter/RecruiterAccessRoute.tsx');
const UPLOAD_FN = read('supabase/functions/upload-contract/index.ts');
const CONFIRM_FN = read('supabase/functions/confirm-contract-upload/index.ts');
const PARSE_FN = read('supabase/functions/parse-contract/index.ts');
const ANALYZE_FN = read('supabase/functions/analyze-contract/index.ts');

const HELPER = SQL.split(
  'CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_contract_action',
)[1].split('$function$;')[0];

const PIPELINE = SQL.split(
  'CREATE OR REPLACE FUNCTION public.list_recruiter_contract_pipeline_safe',
)[1].split('$function$;')[0];

const SUMMARY = SQL.split(
  'CREATE OR REPLACE FUNCTION public.get_application_contract_summary',
)[1];

describe('RC-1G — contract action helper vocabulary', () => {
  it('accepts exactly the two RC-1G permission keys', () => {
    expect(HELPER).toContain("'contracts_view'::public.recruiter_workspace_permission");
    expect(HELPER).toContain("'contracts_manage'::public.recruiter_workspace_permission");
    for (const key of [
      'opportunities_view',
      'opportunities_create',
      'applications_view',
      'applications_manage_status',
      'applications_manage_notes',
      'referrals_view',
      'referral_terms_manage',
      'reports_view',
      'settlements_view',
      'team_manage',
    ]) {
      expect(HELPER).not.toContain(key);
    }
  });

  it('has no role-label shortcut anywhere in the migration', () => {
    expect(SQL).not.toMatch(/'recruiter_admin'/);
    expect(SQL).not.toMatch(/'recruiter_staff'/);
    expect(SQL).not.toMatch(/recruiter_member_role/);
  });

  it('preserves the canonical owner branch', () => {
    expect(HELPER).toContain('public.is_recruiter_owner(auth.uid(), _recruiter_id)');
    expect(HELPER).toContain('auth.uid() IS NOT NULL');
  });

  it('requires readiness + explicit permission + standalone Growth/Fleet billing for staff', () => {
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

  it('never consults Agency-included recruiter entitlement', () => {
    expect(SQL).not.toMatch(/agency_entitlements/i);
    expect(SQL).not.toMatch(/agency_profiles/i);
    expect(SQL).not.toMatch(/agency_members/i);
    expect(SQL).not.toMatch(/get_agency_entitlement/i);
  });
});

describe('RC-1G — grants', () => {
  const fns = [
    'public.current_user_can_recruiter_contract_action(uuid, public.recruiter_workspace_permission)',
    'public.recruiter_contract_authorized_context(uuid, public.recruiter_workspace_permission)',
    'public.recruiter_contract_application_context(uuid, public.recruiter_workspace_permission)',
    'public.list_recruiter_contract_pipeline_safe(uuid)',
    'public.get_application_contract_summary(uuid)',
  ];
  it('revokes PUBLIC/anon and grants authenticated on every RPC', () => {
    for (const fn of fns) {
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`);
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM anon;`);
      expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO authenticated;`);
    }
  });
});

describe('RC-1G — staff RLS is SELECT-only', () => {
  const tables = [
    'public.contracts',
    'public.contract_versions',
    'public.contract_reviews',
    'public.contract_clauses',
    'public.contract_signatures',
    'public.contract_audit_log',
    'storage.objects',
  ];

  it('adds one staff SELECT policy per contract surface', () => {
    for (const t of tables) {
      const re = new RegExp(`CREATE POLICY "RC1G[^"]*"\\s*\\nON ${t.replace('.', '\\.')}\\s*\\nFOR SELECT`);
      expect(SQL).toMatch(re);
    }
  });

  it('adds no staff INSERT/UPDATE/DELETE/ALL policy', () => {
    expect(SQL).not.toMatch(/CREATE POLICY[\s\S]{0,400}?FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(SQL).not.toMatch(/WITH CHECK/);
  });

  it('does not drop or weaken existing owner/driver/admin policies', () => {
    // Only RC1G-prefixed policies may be dropped (idempotent re-run).
    const drops = SQL.match(/DROP POLICY IF EXISTS "([^"]+)"/g) ?? [];
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) expect(d).toContain('"RC1G ');
  });

  it('scopes the storage policy to the contract-documents bucket and application path', () => {
    expect(SQL).toContain("bucket_id = 'contract-documents'");
    expect(SQL).toContain("(storage.foldername(name))[1] = 'contracts'");
    expect(SQL).toContain('recruiter_contract_application_context(');
  });
});

describe('RC-1G — RLS-safe contexts return authorization context only', () => {
  it('contract context returns only recruiter_id/application_id', () => {
    const fn = SQL.split(
      'CREATE OR REPLACE FUNCTION public.recruiter_contract_authorized_context',
    )[1].split('$function$;')[0];
    expect(fn).toContain('RETURNS TABLE(recruiter_id uuid, application_id uuid)');
    expect(fn).toContain('SELECT c.recruiter_id, c.application_id');
    for (const leak of ['extracted_text', 'storage_path', 'ai_findings', 'signature', 'metadata']) {
      expect(fn).not.toContain(leak);
    }
  });

  it('application context returns only recruiter_id', () => {
    const fn = SQL.split(
      'CREATE OR REPLACE FUNCTION public.recruiter_contract_application_context',
    )[1].split('$function$;')[0];
    expect(fn).toContain('RETURNS TABLE(recruiter_id uuid)');
    expect(fn).toContain('SELECT oa.recruiter_id');
  });
});

describe('RC-1G — safe contract pipeline projection', () => {
  it('requires contracts_view and scopes to the recruiter workspace', () => {
    expect(PIPELINE).toContain("'contracts_view'::public.recruiter_workspace_permission");
    expect(PIPELINE).toContain('oa.recruiter_id = _recruiter_id');
    expect(PIPELINE).toContain('public.current_user_can_recruiter_contract_action(');
  });

  it('exposes only minimal driver/opportunity/contract display fields', () => {
    expect(PIPELINE).toContain("'full_name', dop.full_name");
    expect(PIPELINE).toContain("'title', o.title");
    expect(PIPELINE).toContain("'company_name', o.company_name");
    expect(PIPELINE).toContain("'has_driver_signature'");
  });

  it('excludes contact, notes, billing, text, signature-evidence and audit fields', () => {
    for (const leak of [
      'phone',
      'email',
      'contact_snapshot',
      'admin_notes',
      'recruiter_notes',
      'contact_request',
      'message',
      'extracted_text',
      'signature_ip',
      'ip_address',
      'user_agent',
      'evidence',
      'plan',
      'stripe',
      'audit',
    ]) {
      expect(PIPELINE.toLowerCase()).not.toContain(leak);
    }
  });

  it('includes applications that are still awaiting a contract', () => {
    expect(PIPELINE).toContain('LEFT JOIN public.contracts c ON c.application_id = oa.id');
  });
});

describe('RC-1G — get_application_contract_summary', () => {
  it('preserves the existing party/admin branch and adds only a staff view branch', () => {
    expect(SUMMARY).toContain('public.is_application_party(_uid, _application_id)');
    expect(SUMMARY).toContain('public.is_admin(_uid)');
    expect(SUMMARY).toContain('recruiter_contract_application_context(');
    expect(SUMMARY).toContain("'contracts_view'::public.recruiter_workspace_permission");
    expect(SUMMARY).not.toContain("'contracts_manage'");
  });

  it('does not redefine is_application_party', () => {
    expect(SQL).not.toMatch(/FUNCTION public\.is_application_party/);
  });

  it('preserves the existing response shape', () => {
    for (const key of [
      "'id', oa.id",
      "'status', oa.status",
      "'recruiter_id', oa.recruiter_id",
      "'driver_user_id', oa.driver_user_id",
      "'driver_profile_id', oa.driver_profile_id",
      "'opportunities'",
      "'driver_profile'",
      "'recruiter'",
    ]) {
      expect(SUMMARY).toContain(key);
    }
  });
});

describe('RC-1G — frozen functions are not redefined', () => {
  it('leaves guards, triggers and hire gate untouched', () => {
    for (const fn of [
      'opportunity_applications_require_contract_for_hire',
      'contracts_field_guard',
      'contracts_status_client_lock',
      'contracts_status_guard',
      'contract_versions_field_guard',
      'contract_signatures_validate',
      'contract_audit_log_guard',
      'notify_contract_change',
      'is_recruiter_owner',
      'current_user_has_recruiter_permission',
      'recruiter_profile_can_manage_opportunities',
    ]) {
      expect(SQL).not.toContain(`FUNCTION public.${fn}(`);
    }
  });

  it('does not touch driver review/signing edge functions', () => {
    for (const f of ['review-contract', 'sign-contract', 'rewrite-contract-clause']) {
      expect(existsSync(resolve(process.cwd(), `supabase/functions/${f}/index.ts`))).toBe(true);
    }
  });
});

describe('RC-1G — Edge Function staff authorization', () => {
  const fns: [string, string][] = [
    ['upload-contract', UPLOAD_FN],
    ['confirm-contract-upload', CONFIRM_FN],
    ['parse-contract', PARSE_FN],
    ['analyze-contract', ANALYZE_FN],
  ];

  it('every recruiter-side function gates staff on contracts_manage via the server helper', () => {
    for (const [name, src] of fns) {
      expect(src, name).toContain('current_user_can_recruiter_contract_action');
      expect(src, name).toContain('_permission: "contracts_manage"');
      // Must go through the AUTHENTICATED user client so auth.uid() is the staff caller.
      expect(src, name).toContain('userClient.rpc(');
      expect(src, name).toContain('staffOk === true');
    }
  });

  it('never authorizes staff by role label', () => {
    for (const [name, src] of fns) {
      expect(src, name).not.toContain('recruiter_admin');
      expect(src, name).not.toContain('recruiter_staff');
      expect(src, name).not.toContain('recruiter_members');
    }
  });

  it('preserves the standalone Growth/Fleet plan rule everywhere', () => {
    for (const [name, src] of fns) {
      expect(src, name).toContain('recruiter_billing_profiles');
      expect(src, name).toContain('recruiter_plan_required');
    }
  });

  it('staff upload stores the canonical owner while auditing the real staff caller', () => {
    expect(UPLOAD_FN).toContain('const ownerUserId = rp.user_id as string;');
    expect(UPLOAD_FN).toContain('recruiter_user_id: ownerUserId,');
    expect(UPLOAD_FN).not.toContain('recruiter_user_id: userId');
    expect(UPLOAD_FN).toContain('actor_user_id: userId');
    expect(UPLOAD_FN).toContain('actor_role: "recruiter"');
  });

  it('confirm preserves stale-confirm and terminal-status protections', () => {
    expect(CONFIRM_FN).toContain('stale_version_confirm');
    expect(CONFIRM_FN).toContain('terminal_status_blocked');
    expect(CONFIRM_FN).toContain('TERMINAL_BLOCKED');
  });

  it('parse still forbids drivers from triggering parsing', () => {
    expect(PARSE_FN).toContain('if (!isAdmin && !isRecruiter) {');
    expect(PARSE_FN).not.toContain('isDriver');
  });

  it('analyze keeps force admin-only and the driver new-analysis prohibition', () => {
    expect(ANALYZE_FN).toContain('if (force && !isAdmin) return json({ error: "Only admin can force re-analysis" }, 403);');
    expect(ANALYZE_FN).toContain('if (!existing && !isRecruiter && !isAdmin)');
  });
});

describe('RC-1G — client permission booleans', () => {
  it('adds fail-closed contract booleans from exact RC-1B keys', () => {
    expect(PERMS_HOOK).toContain('canViewContracts: boolean;');
    expect(PERMS_HOOK).toContain('canManageContracts: boolean;');
    expect(PERMS_HOOK).toContain(
      "canViewContracts: granted && permissions.contracts_view === true,",
    );
    expect(PERMS_HOOK).toContain(
      "canManageContracts: granted && permissions.contracts_manage === true,",
    );
  });
});

describe('RC-1G — staff contracts hook isolation', () => {
  it('reads only the safe pipeline RPC', () => {
    expect(CONTRACTS_HOOK).toContain("'list_recruiter_contract_pipeline_safe'");
    expect(CONTRACTS_HOOK).not.toMatch(/\.from\(['"]opportunity_applications['"]\)/);
    expect(CONTRACTS_HOOK).not.toMatch(/\.from\(['"]contracts['"]\)/);
  });

  it('scopes the query key by authenticated user and recruiter workspace', () => {
    expect(CONTRACTS_HOOK).toContain(
      "queryKey: ['recruiter_staff_contracts', user?.id, recruiterId]",
    );
    expect(CONTRACTS_HOOK).toContain('enabled: !!user && !!recruiterId && canView');
  });

  it('mounts no owner profile/billing/agency hook', () => {
    for (const owner of [
      'useRecruiterProfile',
      'useRecruiterBilling',
      'useSubscription',
      'useAgency',
      'useOpportunityApplications',
    ]) {
      expect(CONTRACTS_HOOK).not.toContain(owner);
    }
  });
});

describe('RC-1G — staff contracts view isolation', () => {
  it('does not import owner surfaces', () => {
    for (const owner of [
      'RecruiterContractsView',
      'useRecruiterProfile',
      'useRecruiterBilling',
      'useOpportunityApplications',
      'startCheckout',
      'Upgrade to Growth',
      'RecruiterReportsPanel',
      'Settlement',
      'Referral',
      'Agency',
    ]) {
      expect(STAFF_VIEW.split('RecruiterStaffContractsView').join('')).not.toContain(owner);
    }
  });

  it('fails closed without contracts_view and gates mutations on contracts_manage', () => {
    expect(STAFF_VIEW).toContain('const canView = canViewContracts === true;');
    expect(STAFF_VIEW).toContain('const canManage = canManageContracts === true;');
    expect(STAFF_VIEW).toContain('data-testid="recruiter-staff-contracts-forbidden"');
    expect(STAFF_VIEW).toContain('canManageRecruiterContract={canManage}');
  });

  it('renders a neutral unavailable state rather than a billing upgrade CTA', () => {
    expect(STAFF_VIEW).toContain("title=\"Unable to load contracts\"");
    expect(STAFF_VIEW).not.toContain('Upgrade');
    expect(STAFF_VIEW).not.toContain('checkout');
  });

  it('invents no recruiter signature or review action', () => {
    expect(STAFF_VIEW).not.toContain('signContract');
    expect(STAFF_VIEW).not.toContain('reviewContract');
  });
});

describe('RC-1G — ContractAttachment gating', () => {
  it('defaults the recruiter-management prop to owner-compatible true', () => {
    expect(ATTACHMENT).toContain('canManageRecruiterContract?: boolean;');
    expect(ATTACHMENT).toContain('canManageRecruiterContract = true,');
    expect(ATTACHMENT).toContain(
      "const recruiterCanManage = role === 'recruiter' && canManageRecruiterContract !== false;",
    );
  });

  it('gates upload, parse and analyze on that prop', () => {
    expect(ATTACHMENT).toContain('{recruiterCanManage && (');
    expect(ATTACHMENT).toContain("{recruiterCanManage && hasContract && parseStatus !== 'parsed' && (");
    expect(ATTACHMENT).toContain("role === 'recruiter' && recruiterCanManage");
  });

  it('keeps viewing available and does not expose driver decision controls to recruiters', () => {
    expect(ATTACHMENT).toContain("{hasContract && (\n              <Button variant=\"ghost\" size=\"sm\" onClick={handleView}");
    expect(ATTACHMENT).toContain("{role === 'driver' && hasContract && (");
  });
});

describe('RC-1G — staff route wiring', () => {
  it('opens Contracts only on settled contracts_view', () => {
    expect(ROUTE).toContain(
      '!perms.isLoading && !perms.error && perms.canViewContracts',
    );
    expect(ROUTE).toContain("data-testid=\"staff-open-contracts\"");
    expect(ROUTE).toContain("staffView === 'contracts' && canOpenContracts");
  });

  it('passes both booleans to the staff view', () => {
    expect(ROUTE).toContain('canViewContracts={perms.canViewContracts}');
    expect(ROUTE).toContain('canManageContracts={perms.canManageContracts}');
  });

  it('adds no owner Contracts routing in this phase', () => {
    expect(ROUTE).not.toContain('RecruiterContractsView');
  });
});
