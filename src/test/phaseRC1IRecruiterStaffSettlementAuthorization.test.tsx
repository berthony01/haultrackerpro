/**
 * Phase RC-1I — Recruiter staff settlement authorization contract.
 *
 * Locks the authorization architecture: exact permission vocabulary, owner
 * exclusion from the staff path, no role shortcut, readiness + explicit
 * permission + standalone Growth/Fleet billing, no Agency entitlement, exact
 * active relationship binding, carrier-issued-only lifecycle widening,
 * additive-only RLS, fail-closed client parsing and presentation gating.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRecruiterStaffSettlementRelationships } from '@/hooks/settlements/useRecruiterStaffSettlementRelationships';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const SQL = read(
  'supabase/migration-candidates/20260816113000_phase_rc1i_recruiter_staff_settlement_authorization.sql',
);
const PERMS_HOOK = read('src/hooks/recruiter/useRecruiterStaffPermissions.ts');
const REL_HOOK = read('src/hooks/settlements/useRecruiterStaffSettlementRelationships.ts');
const PANEL = read('src/components/settlements/RecruiterStaffSettlementsPanel.tsx');
const MANAGER = read('src/components/settlements/BusinessSettlementManager.tsx');
const ROUTE = read('src/components/opportunities/recruiter/RecruiterAccessRoute.tsx');

const section = (start: string, end = '$function$;') =>
  SQL.split(start)[1].split(end)[0];

const HELPER = section(
  'CREATE OR REPLACE FUNCTION public.settlement_current_user_can_recruiter_staff_action',
);
const REL_HELPER = section(
  'CREATE OR REPLACE FUNCTION public.settlement_current_user_can_recruiter_staff_relationship_action',
);
const LIST_RPC = section(
  'CREATE OR REPLACE FUNCTION public.list_recruiter_staff_settlement_relationships',
);

const LIFECYCLE = [
  ['settlement_create_carrier_draft', ['settlements_prepare']],
  ['settlement_update_draft_header', ['settlements_prepare']],
  ['settlement_add_draft_item', ['settlements_prepare']],
  ['settlement_update_draft_item', ['settlements_prepare']],
  ['settlement_delete_draft_item', ['settlements_prepare']],
  ['settlement_finalize_draft', ['settlements_finalize']],
  ['settlement_void_finalized', ['settlements_finalize']],
  ['settlement_create_correction_draft', ['settlements_prepare', 'settlements_finalize']],
] as const;

const lifecycleBody = (name: string) =>
  SQL.split(`CREATE OR REPLACE FUNCTION public.${name}(`)[1].split('\n$$;')[0];

/* ------------------------------------------------------- workspace helper - */

describe('RC-1I — staff settlement helper vocabulary', () => {
  it('accepts exactly the three settlement permission keys', () => {
    expect(HELPER).toContain("'settlements_view'::public.recruiter_workspace_permission");
    expect(HELPER).toContain("'settlements_prepare'::public.recruiter_workspace_permission");
    expect(HELPER).toContain("'settlements_finalize'::public.recruiter_workspace_permission");
    for (const key of [
      'opportunities_view',
      'applications_view',
      'contracts_view',
      'referrals_view',
      'reports_view',
      'team_manage',
    ]) {
      expect(HELPER).not.toContain(key);
    }
  });

  it('excludes the canonical recruiter owner from the staff path', () => {
    expect(HELPER).toContain('NOT public.is_recruiter_owner(auth.uid(), _recruiter_id)');
    expect(HELPER).toContain('auth.uid() IS NOT NULL');
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

  it('has no role-label shortcut anywhere in the migration', () => {
    expect(SQL).not.toMatch(/'recruiter_admin'/);
    expect(SQL).not.toMatch(/'recruiter_staff'/);
    expect(SQL).not.toMatch(/'recruiter_owner'/);
    expect(SQL).not.toMatch(/recruiter_member_role/);
  });

  it('never consults Agency entitlement or Agency tables', () => {
    expect(SQL).not.toMatch(/agency_entitlements/);
    expect(SQL).not.toMatch(/get_agency_entitlement/);
    expect(SQL).not.toMatch(/agency_members/);
    expect(SQL).not.toMatch(/settlement_current_user_can_manage_agency\s*\(\s*_/);
  });

  it('is not executable by anon or PUBLIC', () => {
    for (const fn of [
      'settlement_current_user_can_recruiter_staff_action',
      'settlement_current_user_can_recruiter_staff_relationship_action',
      'list_recruiter_staff_settlement_relationships',
    ]) {
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${fn}`);
      expect(SQL).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[^\\n]*authenticated`));
    }
    expect(SQL).not.toMatch(/GRANT EXECUTE[^\n]*TO[^\n]*anon/);
  });
});

/* ---------------------------------------------------- relationship helper - */

describe('RC-1I — exact relationship binding', () => {
  it('delegates to the workspace helper and requires the exact active triple', () => {
    expect(REL_HELPER).toContain(
      'public.settlement_current_user_can_recruiter_staff_action(',
    );
    expect(REL_HELPER).toContain('FROM public.carrier_driver_relationships r');
    expect(REL_HELPER).toContain('r.id = _relationship_id');
    expect(REL_HELPER).toContain('r.recruiter_id = _recruiter_id');
    expect(REL_HELPER).toContain('r.driver_user_id = _driver_user_id');
    expect(REL_HELPER).toContain("r.status = 'active'");
  });

  it('rejects null identifiers fail-closed', () => {
    expect(REL_HELPER).toContain('_recruiter_id IS NOT NULL');
    expect(REL_HELPER).toContain('_relationship_id IS NOT NULL');
    expect(REL_HELPER).toContain('_driver_user_id IS NOT NULL');
  });
});

/* ------------------------------------------------------------- listing RPC */

describe('RC-1I — staff relationship listing RPC', () => {
  it('requires settlements_view and raises otherwise', () => {
    expect(LIST_RPC).toContain(
      "'settlements_view'::public.recruiter_workspace_permission",
    );
    expect(LIST_RPC).toContain("RAISE EXCEPTION 'recruiter_staff_settlements_not_authorized'");
    expect(LIST_RPC).not.toContain('settlements_prepare');
    expect(LIST_RPC).not.toContain('settlements_finalize');
  });

  it('returns only active relationships of the requested workspace', () => {
    expect(LIST_RPC).toContain('r.recruiter_id = _recruiter_id');
    expect(LIST_RPC).toContain("r.status = 'active'");
  });

  it('exposes no driver contact, financial or billing columns', () => {
    for (const forbidden of ['email', 'phone', 'full_name', 'amount', 'stripe', 'plan']) {
      expect(LIST_RPC.toLowerCase()).not.toContain(forbidden);
    }
  });
});

/* -------------------------------------------------------------------- RLS - */

describe('RC-1I — additive staff SELECT policies', () => {
  const tables = [
    'carrier_driver_relationships',
    'driver_settlements',
    'driver_settlement_items',
    'driver_settlement_matches',
    'driver_settlement_events',
  ];

  it('adds one new staff SELECT policy per settlement table', () => {
    for (const table of tables) {
      expect(SQL).toContain(`CREATE POLICY ${table}_select_recruiter_staff`);
      expect(SQL).toContain(`ON public.${table}`);
    }
  });

  it('never drops or alters an existing settlement policy', () => {
    expect(SQL).not.toContain('_select_authorized');
    expect(SQL).not.toMatch(/ALTER POLICY/);
    expect(SQL).not.toMatch(/DISABLE ROW LEVEL SECURITY/);
  });

  it('grants staff read only for carrier-issued statements', () => {
    const policySection = SQL.split('D) Additive STAFF SELECT policies')[1].split(
      'E) Lifecycle RPC',
    )[0];
    expect(policySection).toContain("source = 'carrier_issued'");
    expect(policySection).not.toContain("'agency_prepared'");
    expect(policySection).not.toContain("'driver_imported'");
    expect(policySection).not.toContain('FOR UPDATE');
    expect(policySection).not.toContain('FOR INSERT');
    expect(policySection).not.toContain('FOR DELETE');
    expect(policySection).not.toContain('FOR ALL');
  });

  it('only ever uses settlements_view in the read policies', () => {
    const policySection = SQL.split('D) Additive STAFF SELECT policies')[1].split(
      'E) Lifecycle RPC',
    )[0];
    expect(policySection).not.toContain('settlements_prepare');
    expect(policySection).not.toContain('settlements_finalize');
  });
});

/* ------------------------------------------------------- lifecycle widening */

describe('RC-1I — lifecycle RPC carrier-branch extension', () => {
  it('redefines exactly the eight authorized lifecycle functions', () => {
    const declared = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.settlement_(?!current_user_can_recruiter_staff)[a-z_]+\(/g,
    )!;
    expect(declared).toHaveLength(LIFECYCLE.length);
    for (const [name] of LIFECYCLE) {
      expect(SQL).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`);
    }
  });

  it.each(LIFECYCLE.map(([name, keys]) => [name, keys] as const))(
    '%s keeps the owner helper and adds only its mapped staff keys',
    (name, keys) => {
      const body = lifecycleBody(name);
      expect(body).toContain('public.settlement_current_user_can_manage_carrier(');
      expect(body).toContain(
        'public.settlement_current_user_can_recruiter_staff_relationship_action(',
      );
      for (const key of keys) {
        expect(body).toContain(`'${key}'::public.recruiter_workspace_permission`);
      }
      for (const key of ['settlements_view', 'settlements_prepare', 'settlements_finalize']) {
        if (!(keys as readonly string[]).includes(key)) {
          expect(body).not.toContain(`'${key}'::public.recruiter_workspace_permission`);
        }
      }
    },
  );

  it('adds exactly one staff call per lifecycle function except correction', () => {
    for (const [name, keys] of LIFECYCLE) {
      const body = lifecycleBody(name);
      const calls = body.match(
        /settlement_current_user_can_recruiter_staff_relationship_action\(/g,
      )!;
      expect(calls).toHaveLength(keys.length);
    }
  });

  it('requires BOTH prepare and finalize for correction / supersede', () => {
    const body = lifecycleBody('settlement_create_correction_draft');
    expect(body).toMatch(
      /settlements_prepare'::public\.recruiter_workspace_permission\)\s*AND\s*public\.settlement_current_user_can_recruiter_staff_relationship_action/,
    );
  });

  it('never widens the driver-imported or agency-prepared branches', () => {
    for (const [name] of LIFECYCLE) {
      const body = lifecycleBody(name);
      const driverBranch = body.split("= 'driver_imported' THEN")[1];
      if (driverBranch) {
        const scoped = driverBranch.split('ELSIF')[0];
        expect(scoped).not.toContain('recruiter_staff_relationship_action');
      }
      const agencyBranch = body.split("= 'agency_prepared' THEN")[1];
      if (agencyBranch) {
        const scoped = agencyBranch.split('ELSE')[0];
        expect(scoped).not.toContain('recruiter_staff_relationship_action');
      }
    }
  });

  it('never redefines a frozen owner or driver authorization helper', () => {
    for (const frozen of [
      'settlement_current_user_can_manage_carrier',
      'settlement_current_user_can_administer_carrier',
      'settlement_current_user_can_manage_agency',
      'settlement_current_user_can_manage_driver_import',
      'settlement_current_user_can_assist_driver',
      'settlement_current_user_can_view_settlement',
      'current_user_has_recruiter_permission',
      'is_recruiter_owner',
    ]) {
      expect(SQL).not.toContain(`CREATE OR REPLACE FUNCTION public.${frozen}(`);
      expect(SQL).not.toContain(`DROP FUNCTION public.${frozen}`);
    }
  });
});

/* --------------------------------------------------------- client contract */

describe('RC-1I — client permission booleans', () => {
  it('exposes the three settlement booleans strictly from the parsed map', () => {
    expect(PERMS_HOOK).toContain(
      'canViewSettlements: granted && permissions.settlements_view === true',
    );
    expect(PERMS_HOOK).toContain(
      'canPrepareSettlements: granted && permissions.settlements_prepare === true',
    );
    expect(PERMS_HOOK).toContain(
      'canFinalizeSettlements: granted && permissions.settlements_finalize === true',
    );
  });
});

describe('RC-1I — relationship payload parsing', () => {
  const RID = '11111111-1111-4111-8111-111111111111';
  const row = {
    id: '22222222-2222-4222-8222-222222222222',
    recruiter_id: RID,
    driver_user_id: '33333333-3333-4333-8333-333333333333',
    status: 'active',
    accepted_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
  };

  it('parses an exact well-formed payload', () => {
    const parsed = parseRecruiterStaffSettlementRelationships([row], RID);
    expect(parsed).toHaveLength(1);
    expect(parsed![0].driverUserId).toBe(row.driver_user_id);
  });

  it('returns an empty list for an empty payload', () => {
    expect(parseRecruiterStaffSettlementRelationships([], RID)).toEqual([]);
  });

  it.each([null, undefined, {}, 'x', 7, true])(
    'rejects non-array payload %p',
    (payload) => {
      expect(parseRecruiterStaffSettlementRelationships(payload, RID)).toBeNull();
    },
  );

  it('rejects the whole payload when a single row is malformed', () => {
    expect(
      parseRecruiterStaffSettlementRelationships([row, { ...row, id: 1 }], RID),
    ).toBeNull();
    expect(
      parseRecruiterStaffSettlementRelationships([row, { ...row, driver_user_id: '' }], RID),
    ).toBeNull();
  });

  it('rejects a row belonging to another workspace', () => {
    expect(
      parseRecruiterStaffSettlementRelationships(
        [{ ...row, recruiter_id: '44444444-4444-4444-8444-444444444444' }],
        RID,
      ),
    ).toBeNull();
  });

  it('rejects a non-active relationship row', () => {
    for (const status of ['invited', 'inactive', 'ended']) {
      expect(
        parseRecruiterStaffSettlementRelationships([{ ...row, status }], RID),
      ).toBeNull();
    }
  });
});

describe('RC-1I — staff hook and surface fail closed', () => {
  it('only reads the RC-1I listing RPC', () => {
    expect(REL_HOOK).toContain("'list_recruiter_staff_settlement_relationships'");
    expect(REL_HOOK).not.toContain(".from('");
    expect(REL_HOOK).not.toContain('recruiter_billing_profiles');
    expect(REL_HOOK).not.toContain('useRecruiterProfile');
  });

  it('returns an empty list on loading, error, or malformed payload', () => {
    expect(REL_HOOK).toContain(
      'scoped && !scoped.error && scoped.relationships ? scoped.relationships : []',
    );
  });

  it('mounts no owner-only recruiter consumer in the staff panel', () => {
    for (const forbidden of [
      'useRecruiterProfile',
      'useRecruiterBilling',
      'useOpportunityApplications',
      'useInviteCarrierDriverRelationship',
      'useEndCarrierDriverRelationship',
      'useVisibleCarrierDriverRelationships',
      'CarrierSettlementsPanel',
    ]) {
      expect(PANEL).not.toContain(forbidden);
    }
  });

  it('does not fetch or mount the manager without settlements_view', () => {
    expect(PANEL).toContain('const enabled = canViewSettlements === true');
    expect(PANEL).toContain('recruiter-staff-settlements-denied');
  });

  it('passes the granular presentation gates through to the manager', () => {
    expect(PANEL).toContain('canPrepare={canPrepareSettlements}');
    expect(PANEL).toContain('canFinalize={canFinalizeSettlements}');
    expect(PANEL).toContain('canManage={canPrepareSettlements || canFinalizeSettlements}');
  });
});

describe('RC-1I — manager presentation gating stays backward compatible', () => {
  it('defaults both granular gates to canManage when omitted', () => {
    expect(MANAGER).toContain('const allowPrepare = canManage && (canPrepare ?? true)');
    expect(MANAGER).toContain('const allowFinalize = canManage && (canFinalize ?? true)');
  });

  it('binds authoring to prepare and lifecycle to finalize', () => {
    expect(MANAGER).toContain('const editable = isDraft && allowPrepare');
    expect(MANAGER).toContain('{allowPrepare && creating && (');
    expect(MANAGER).toContain('{isDraft && allowFinalize && (');
    expect(MANAGER).toContain('{allowPrepare && allowFinalize && (');
    expect(MANAGER).toContain('{(allowPrepare || allowFinalize) && (');
  });
});

describe('RC-1I — recruiter shell entry point', () => {
  it('opens the settlement surface only on settlements_view', () => {
    expect(ROUTE).toContain(
      'const canOpenSettlements =\n    !perms.isLoading && !perms.error && perms.canViewSettlements;',
    );
    expect(ROUTE).toContain("staffView === 'settlements' && canOpenSettlements");
    expect(ROUTE).toContain('data-testid="staff-open-settlements"');
  });

  it('never opens the surface on prepare or finalize alone', () => {
    const gate = ROUTE.split('const canOpenSettlements =')[1].split(';')[0];
    expect(gate).not.toContain('canPrepareSettlements');
    expect(gate).not.toContain('canFinalizeSettlements');
  });
});
