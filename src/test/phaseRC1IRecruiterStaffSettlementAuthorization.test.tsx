/**
 * Phase RC-1I (acceptance-corrected) — Recruiter staff settlement
 * authorization contract.
 *
 * Locks the CORRECTED architecture:
 *   * exactly three settlement permission keys, canonical owner exclusion,
 *     no role labels;
 *   * recruiter profile status = 'active' (NOT posting-readiness / the
 *     `recruiter_profile_can_manage_opportunities` helper);
 *   * VIEW-FOUNDATIONAL permission semantics — prepare/finalize alone deny;
 *   * standalone billing rb.recruiter_id = rp.id AND rb.user_id = rp.user_id,
 *     plan starter|growth|fleet, status active|trialing;
 *   * paid Agency-owner conflict anchored to rp.user_id;
 *   * safe relationship RPC returning exactly five fields with a safe
 *     driver-name fallback;
 *   * EXACTLY three additive staff SELECT policies (settlements / items /
 *     events) and none on relationships or matches;
 *   * exactly eight widened lifecycle functions, owner helper first;
 *   * React Query relationship hook with a strict five-key row allowlist;
 *   * panel + manager presentation gating with the backward-compatible
 *     effective formulas.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseRecruiterStaffSettlementRelationships } from '@/hooks/settlements/useRecruiterStaffSettlementRelationships';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const SQL_PATH =
  'supabase/migration-candidates/20260816113000_phase_rc1i_recruiter_staff_settlement_authorization.sql';

const SQL = read(SQL_PATH);
const PERMS_HOOK = read('src/hooks/recruiter/useRecruiterStaffPermissions.ts');
const REL_HOOK = read('src/hooks/settlements/useRecruiterStaffSettlementRelationships.ts');
const PANEL = read('src/components/settlements/RecruiterStaffSettlementsPanel.tsx');
const MANAGER = read('src/components/settlements/BusinessSettlementManager.tsx');
const ROUTE = read('src/components/opportunities/recruiter/RecruiterAccessRoute.tsx');

/** Body of a SQL function definition, comments excluded. */
function fnBody(header: string): string {
  const idx = SQL.indexOf(header);
  expect(idx).toBeGreaterThan(-1);
  const after = SQL.slice(idx);
  return after.slice(0, after.indexOf('$function$;') + 11);
}

const HELPER = fnBody(
  'FUNCTION public.settlement_current_user_can_recruiter_staff_action(',
);
const REL_HELPER = fnBody(
  'FUNCTION public.settlement_current_user_can_recruiter_staff_relationship_action(',
);
const LIST_RPC = fnBody(
  'CREATE FUNCTION public.list_recruiter_staff_settlement_relationships(',
);

const LIFECYCLE: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['settlement_create_carrier_draft', ['settlements_prepare']],
  ['settlement_update_draft_header', ['settlements_prepare']],
  ['settlement_add_draft_item', ['settlements_prepare']],
  ['settlement_update_draft_item', ['settlements_prepare']],
  ['settlement_delete_draft_item', ['settlements_prepare']],
  ['settlement_finalize_draft', ['settlements_finalize']],
  ['settlement_void_finalized', ['settlements_finalize']],
  ['settlement_create_correction_draft', ['settlements_prepare', 'settlements_finalize']],
];

const lifecycleBody = (name: string) => {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const idx = SQL.indexOf(marker);
  expect(idx).toBeGreaterThan(-1);
  return SQL.slice(idx).split('\n$$;')[0];
};

/* ------------------------------------------------- 1) helper vocabulary --- */

describe('RC-1I — staff settlement helper vocabulary', () => {
  it('accepts exactly the three settlement permission keys', () => {
    expect(HELPER).toContain("'settlements_view'::public.recruiter_workspace_permission");
    expect(HELPER).toContain("'settlements_prepare'::public.recruiter_workspace_permission");
    expect(HELPER).toContain(
      "'settlements_finalize'::public.recruiter_workspace_permission",
    );
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

  it('excludes the canonical recruiter owner and uses no role label', () => {
    expect(HELPER).toContain('NOT public.is_recruiter_owner(auth.uid(), _recruiter_id)');
    for (const role of ["'recruiter_admin'", "'recruiter_staff'", 'rm.role', '.role =']) {
      expect(HELPER).not.toContain(role);
    }
  });

  it('requires a non-null authenticated caller and workspace', () => {
    expect(HELPER).toContain('auth.uid() IS NOT NULL');
    expect(HELPER).toContain('_recruiter_id IS NOT NULL');
    expect(HELPER).toContain('_permission IS NOT NULL');
  });
});

/* ------------------ 2) profile status, NOT posting readiness -------------- */

describe('RC-1I — recruiter profile status, not posting readiness', () => {
  it('never calls recruiter_profile_can_manage_opportunities anywhere in RC-1I', () => {
    expect(SQL).not.toContain('recruiter_profile_can_manage_opportunities');
  });

  it('requires recruiter profile status = active directly', () => {
    expect(HELPER).toContain('FROM public.recruiter_profiles rp');
    expect(HELPER).toContain('rp.id = _recruiter_id');
    expect(HELPER).toContain("rp.status = 'active'");
  });

  it('does not consult verification / readiness columns', () => {
    for (const token of ['verified', 'verification', 'is_ready', 'readiness']) {
      expect(HELPER).not.toContain(token);
    }
  });
});

/* ------------------------------ 3) standalone billing --------------------- */

describe('RC-1I — standalone billing rule', () => {
  it('anchors the billing row to the canonical recruiter owner', () => {
    expect(HELPER).toContain('JOIN public.recruiter_billing_profiles rb');
    expect(HELPER).toContain('ON rb.recruiter_id = rp.id');
    expect(HELPER).toContain('AND rb.user_id = rp.user_id');
  });

  it('allows exactly starter, growth and fleet', () => {
    expect(HELPER).toContain("rb.plan IN ('starter', 'growth', 'fleet')");
    expect(HELPER).not.toContain("'free'");
  });

  it('allows exactly active and trialing billing statuses', () => {
    expect(HELPER).toContain("rb.status IN ('active', 'trialing')");
    for (const bad of ["'past_due'", "'canceled'", "'cancelled'", "'incomplete'"]) {
      expect(HELPER).not.toContain(bad);
    }
  });
});

/* --------------------------- 4) Agency conflict check --------------------- */

describe('RC-1I — paid Agency owner conflict', () => {
  it('is a NOT EXISTS conflict check anchored to rp.user_id', () => {
    expect(HELPER).toContain('NOT EXISTS (');
    expect(HELPER).toContain('FROM public.agency_profiles ap');
    expect(HELPER).toContain('JOIN public.agency_members am');
    expect(HELPER).toContain('am.member_user_id = rp.user_id');
    expect(HELPER).toContain("am.role = 'agency_owner'");
    expect(HELPER).toContain("am.status = 'active'");
    expect(HELPER).toContain('JOIN public.agency_entitlements ae');
    expect(HELPER).toContain(
      "ae.plan_key IN ('agency_starter', 'agency_team', 'agency_growth')",
    );
    expect(HELPER).toContain("ae.status IN ('active', 'trialing')");
    expect(HELPER).toContain('WHERE ap.owner_user_id = rp.user_id');
  });

  it('never anchors the Agency check to the staff caller', () => {
    expect(HELPER).not.toContain('am.member_user_id = auth.uid()');
    expect(HELPER).not.toContain('ap.owner_user_id = auth.uid()');
  });

  it('never treats Agency entitlement as an authorization path', () => {
    expect(HELPER).not.toContain('OR EXISTS (\n      SELECT 1\n      FROM public.agency');
  });
});

/* ------------------------ 5) view-foundational semantics ------------------ */

describe('RC-1I — view-foundational permission semantics', () => {
  it('always requires settlements_view in addition to the requested key', () => {
    const viewCheck = `public.current_user_has_recruiter_permission(
          _recruiter_id,
          'settlements_view'::public.recruiter_workspace_permission)`;
    expect(HELPER).toContain(viewCheck);
    expect(HELPER).toContain(
      'public.current_user_has_recruiter_permission(_recruiter_id, _permission)',
    );
  });

  it('AND-joins both permission checks so prepare/finalize alone deny', () => {
    const idxView = HELPER.indexOf("'settlements_view'::public.recruiter_workspace_permission)");
    const idxAny = HELPER.indexOf(
      'public.current_user_has_recruiter_permission(_recruiter_id, _permission)',
    );
    expect(idxView).toBeGreaterThan(-1);
    expect(idxAny).toBeGreaterThan(idxView);
    expect(HELPER.slice(idxView, idxAny)).toContain('AND');
    expect(HELPER).not.toContain('OR public.current_user_has_recruiter_permission');
  });

  it('grants nothing through role presets or defaults', () => {
    expect(HELPER).not.toContain('COALESCE(');
    expect(HELPER).not.toContain('TRUE;');
  });
});

/* ----------------------------- relationship helper ------------------------ */

describe('RC-1I — relationship helper', () => {
  it('delegates to the corrected workspace helper', () => {
    expect(REL_HELPER).toContain(
      'public.settlement_current_user_can_recruiter_staff_action(\n          _recruiter_id, _permission)',
    );
  });

  it('requires the exact ACTIVE relationship triple', () => {
    expect(REL_HELPER).toContain('FROM public.carrier_driver_relationships r');
    expect(REL_HELPER).toContain('r.id = _relationship_id');
    expect(REL_HELPER).toContain('r.recruiter_id = _recruiter_id');
    expect(REL_HELPER).toContain('r.driver_user_id = _driver_user_id');
    expect(REL_HELPER).toContain("r.status = 'active'");
  });
});

/* ------------------------------ 6) safe list RPC -------------------------- */

describe('RC-1I — safe relationship list RPC', () => {
  it('returns exactly the five allowed columns', () => {
    const returns = LIST_RPC.split('RETURNS TABLE (')[1].split(')')[0];
    const cols = returns
      .split('\n')
      .map((l) => l.trim().replace(/,$/, ''))
      .filter(Boolean);
    expect(cols).toEqual([
      'relationship_id uuid',
      'driver_user_id uuid',
      'driver_name text',
      'invited_at timestamptz',
      'accepted_at timestamptz',
    ]);
  });

  it('never projects recruiter_id, status, created_at, contact or billing data', () => {
    const projection = LIST_RPC.split('RETURN QUERY')[1].split('FROM public.')[0];
    expect(projection).not.toContain('r.recruiter_id,');
    expect(projection).not.toContain('r.status');
    expect(projection).not.toContain('created_at');
    for (const banned of [
      'phone',
      'email',
      'address',
      'contact_preference',
      'notes',
      'billing',
      'plan',
    ]) {
      expect(projection).not.toContain(banned);
    }
  });

  it('uses the safe driver-name fallback via a LEFT JOIN', () => {
    expect(LIST_RPC).toContain(
      'LEFT JOIN public.driver_opportunity_profiles dop\n    ON dop.user_id = r.driver_user_id',
    );
    expect(LIST_RPC).toContain("NULLIF(btrim(COALESCE(dop.full_name, '')), '')");
    expect(LIST_RPC).toContain("'Connected driver'");
  });

  it('is gated on settlements_view and lists only active relationships', () => {
    expect(LIST_RPC).toContain(
      'IF NOT public.settlement_current_user_can_recruiter_staff_action(',
    );
    expect(LIST_RPC).toContain("'settlements_view'::public.recruiter_workspace_permission");
    expect(LIST_RPC).toContain("RAISE EXCEPTION 'recruiter_staff_settlements_not_authorized'");
    expect(LIST_RPC).toContain("AND r.status = 'active'");
  });

  it('orders deterministically', () => {
    expect(LIST_RPC).toContain('ORDER BY COALESCE(r.accepted_at, r.invited_at), r.id;');
  });

  it('revokes PUBLIC/anon and grants authenticated', () => {
    for (const fn of [
      'settlement_current_user_can_recruiter_staff_action(uuid, public.recruiter_workspace_permission)',
      'list_recruiter_staff_settlement_relationships(uuid)',
    ]) {
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC;`);
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM anon;`);
      expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated`);
    }
  });
});

/* -------------------------- 7) exactly three policies --------------------- */

describe('RC-1I — exactly three additive staff SELECT policies', () => {
  const created = [...SQL.matchAll(/CREATE POLICY (\w+)\s+ON (public\.\w+)/g)].map((m) => [
    m[1],
    m[2],
  ]);

  it('creates exactly three policies, on settlements / items / events', () => {
    expect(created).toEqual([
      ['driver_settlements_select_recruiter_staff', 'public.driver_settlements'],
      ['driver_settlement_items_select_recruiter_staff', 'public.driver_settlement_items'],
      ['driver_settlement_events_select_recruiter_staff', 'public.driver_settlement_events'],
    ]);
  });

  it('creates no policy on relationships or matches', () => {
    expect(SQL).not.toContain('CREATE POLICY carrier_driver_relationships_select_recruiter_staff');
    expect(SQL).not.toContain('CREATE POLICY driver_settlement_matches_select_recruiter_staff');
    expect(SQL).not.toContain('ON public.carrier_driver_relationships\n  FOR SELECT');
    expect(SQL).not.toContain('ON public.driver_settlement_matches');
  });

  it('creates SELECT-only policies — no mutation policy of any kind', () => {
    const policyBlock = SQL.split('-- D) Additive STAFF SELECT policies')[1].split(
      '-- E) Lifecycle',
    )[0];
    expect(policyBlock).toContain('FOR SELECT');
    for (const verb of ['FOR INSERT', 'FOR UPDATE', 'FOR DELETE', 'FOR ALL']) {
      expect(policyBlock).not.toContain(verb);
    }
    expect(policyBlock).not.toContain('WITH CHECK');
  });

  it('drops only the three RC-1I policy names, never a baseline policy', () => {
    const dropped = [...SQL.matchAll(/DROP POLICY IF EXISTS (\w+)/g)].map((m) => m[1]);
    expect(dropped).toEqual([
      'driver_settlements_select_recruiter_staff',
      'driver_settlement_items_select_recruiter_staff',
      'driver_settlement_events_select_recruiter_staff',
    ]);
    expect(SQL).not.toContain('ALTER POLICY');
  });

  it('scopes READ to carrier-issued statements via the workspace helper', () => {
    const policyBlock = SQL.split('-- D) Additive STAFF SELECT policies')[1].split(
      '-- E) Lifecycle',
    )[0];
    expect(policyBlock).toContain("driver_settlements.source = 'carrier_issued'");
    expect(policyBlock).toContain(
      'driver_settlements.carrier_recruiter_profile_id IS NOT NULL',
    );
    expect(policyBlock).toContain(
      'public.settlement_current_user_can_recruiter_staff_action(',
    );
    // Historical reads must not require a still-active relationship.
    expect(policyBlock).not.toContain(
      'settlement_current_user_can_recruiter_staff_relationship_action',
    );
  });
});

/* -------------------------- 8/9) lifecycle functions ---------------------- */

describe('RC-1I — exactly eight widened lifecycle functions', () => {
  it('replaces exactly the eight expected functions', () => {
    const replaced = [
      ...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g),
    ].map((m) => m[1]);
    expect(replaced).toEqual([
      'settlement_current_user_can_recruiter_staff_action',
      'settlement_current_user_can_recruiter_staff_relationship_action',
      ...LIFECYCLE.map(([name]) => name),
    ]);
  });

  it('keeps frozen relationship / load-match functions absent', () => {
    for (const frozen of [
      'settlement_invite_driver',
      'settlement_end_relationship',
      'settlement_accept_relationship',
      'settlement_decline_relationship',
      'settlement_match_load',
      'settlement_reject_load_match',
      'settlement_suggest_load_matches',
    ]) {
      expect(SQL).not.toContain(`FUNCTION public.${frozen}(`);
    }
  });

  it.each(LIFECYCLE.map(([name, keys]) => [name, keys] as const))(
    '%s keeps the owner helper first and adds only its mapped staff key(s)',
    (name, keys) => {
      const body = lifecycleBody(name);
      const owner = body.indexOf('public.settlement_current_user_can_manage_carrier(');
      const staff = body.indexOf(
        'public.settlement_current_user_can_recruiter_staff_relationship_action(',
      );
      expect(owner).toBeGreaterThan(-1);
      expect(staff).toBeGreaterThan(owner);
      for (const key of keys) {
        expect(body).toContain(`'${key}'::public.recruiter_workspace_permission`);
      }
      const allKeys = ['settlements_view', 'settlements_prepare', 'settlements_finalize'];
      for (const key of allKeys.filter((k) => !keys.includes(k))) {
        expect(body).not.toContain(`'${key}'::public.recruiter_workspace_permission`);
      }
      // View-foundational: no duplicated settlements_view call in the body.
      expect(body).not.toContain("'settlements_view'::public.recruiter_workspace_permission");
    },
  );

  it('keeps auth.uid() as the recorded actor in every lifecycle function', () => {
    for (const [name] of LIFECYCLE) {
      expect(lifecycleBody(name)).toContain('auth.uid()');
    }
  });

  it('requires BOTH keys for the correction/supersede path', () => {
    const body = lifecycleBody('settlement_create_correction_draft');
    expect(body).toContain("'settlements_prepare'::public.recruiter_workspace_permission");
    expect(body).toContain("'settlements_finalize'::public.recruiter_workspace_permission");
  });
});

/* ------------------------------ 10) client hook --------------------------- */

describe('RC-1I — relationship hook transport and query key', () => {
  it('uses React Query and only the safe RPC', () => {
    expect(REL_HOOK).toContain("import { useQuery } from '@tanstack/react-query'");
    expect(REL_HOOK).toContain('useQuery({');
    expect(REL_HOOK).toContain("'list_recruiter_staff_settlement_relationships'");
    expect(REL_HOOK).not.toContain('supabase.from(');
    expect(REL_HOOK).not.toContain('useEffect');
    for (const banned of [
      'localStorage',
      'sessionStorage',
      'useRecruiterProfile',
      'recruiter_billing_profiles',
    ]) {
      expect(REL_HOOK).not.toContain(banned);
    }
  });

  it('keys the query by authenticated user and recruiter workspace', () => {
    expect(REL_HOOK).toContain(
      "queryKey: ['recruiter_staff_settlement_relationships', user?.id, id]",
    );
  });

  it('enables only for user + workspace + explicit canViewSettlements === true', () => {
    expect(REL_HOOK).toContain(
      'const enabled = !!user?.id && !!id && canViewSettlements === true;',
    );
    expect(REL_HOOK).toContain('enabled,');
  });
});

describe('RC-1I — strict relationship row parser', () => {
  const row = {
    relationship_id: 'rel-1',
    driver_user_id: 'drv-1',
    driver_name: 'Jordan Ellis',
    invited_at: '2026-08-01T00:00:00Z',
    accepted_at: '2026-08-02T00:00:00Z',
  };

  it('accepts the exact five-key row and maps to the client shape', () => {
    expect(parseRecruiterStaffSettlementRelationships([row])).toEqual([
      {
        relationshipId: 'rel-1',
        driverUserId: 'drv-1',
        driverName: 'Jordan Ellis',
        invitedAt: '2026-08-01T00:00:00Z',
        acceptedAt: '2026-08-02T00:00:00Z',
      },
    ]);
  });

  it('accepts a null accepted_at', () => {
    const parsed = parseRecruiterStaffSettlementRelationships([
      { ...row, accepted_at: null },
    ]);
    expect(parsed?.[0].acceptedAt).toBeNull();
  });

  it('accepts an empty list', () => {
    expect(parseRecruiterStaffSettlementRelationships([])).toEqual([]);
  });

  it.each([null, undefined, {}, 'rows', 42])('rejects non-array payload %p', (bad) => {
    expect(parseRecruiterStaffSettlementRelationships(bad)).toBeNull();
  });

  it('rejects a non-plain-object row', () => {
    class Exotic {}
    expect(parseRecruiterStaffSettlementRelationships([new Exotic()])).toBeNull();
    expect(parseRecruiterStaffSettlementRelationships([['a']])).toBeNull();
    expect(parseRecruiterStaffSettlementRelationships([null])).toBeNull();
  });

  it.each([
    'relationship_id',
    'driver_user_id',
    'driver_name',
    'invited_at',
    'accepted_at',
  ])('rejects a row missing %s', (key) => {
    const partial: Record<string, unknown> = { ...row };
    delete partial[key];
    expect(parseRecruiterStaffSettlementRelationships([partial])).toBeNull();
  });

  it('rejects any unknown extra key', () => {
    expect(
      parseRecruiterStaffSettlementRelationships([{ ...row, status: 'active' }]),
    ).toBeNull();
    expect(
      parseRecruiterStaffSettlementRelationships([{ ...row, driver_phone: '555' }]),
    ).toBeNull();
  });

  it.each([
    ['relationship_id', ''],
    ['driver_user_id', ''],
    ['driver_name', ''],
    ['invited_at', ''],
    ['relationship_id', 7],
    ['accepted_at', 7],
  ])('rejects a malformed %s value', (key, value) => {
    expect(
      parseRecruiterStaffSettlementRelationships([{ ...row, [key]: value }]),
    ).toBeNull();
  });

  it('never silently skips rows — one bad row invalidates the payload', () => {
    expect(
      parseRecruiterStaffSettlementRelationships([row, { ...row, driver_name: '' }]),
    ).toBeNull();
  });
});

/* --------------------------------- 11) panel ------------------------------ */

describe('RC-1I — staff settlements panel', () => {
  it('labels drivers with the safe RPC name, never a raw uuid', () => {
    expect(PANEL).toContain('label: relationship.driverName');
    expect(PANEL).toContain('relationshipId: relationship.relationshipId');
    expect(PANEL).not.toContain("label: 'Connected driver'");
    expect(PANEL).not.toContain('label: relationship.driverUserId');
  });

  it('mounts the manager with canManage={false} plus granular gates', () => {
    expect(PANEL).toContain('canManage={false}');
    expect(PANEL).toContain('canPrepare={canPrepareSettlements}');
    expect(PANEL).toContain('canFinalize={canFinalizeSettlements}');
  });

  it('keeps the owner-controlled-connection note and no plan/upgrade UI', () => {
    expect(PANEL).toContain('Driver connections are managed by the workspace owner.');
    for (const banned of ['Upgrade', 'upgrade', 'pricing', 'Agency']) {
      expect(PANEL).not.toContain(banned);
    }
  });

  it('fetches nothing without an explicit view grant', () => {
    expect(PANEL).toContain('const enabled = canViewSettlements === true;');
  });
});

/* -------------------------------- 12) manager ----------------------------- */

describe('RC-1I — manager effective permission formulas', () => {
  it('uses the exact backward-compatible fallbacks', () => {
    expect(MANAGER).toContain('const effectiveCanPrepare = canPrepare ?? canManage;');
    expect(MANAGER).toContain('const effectiveCanFinalize = canFinalize ?? canManage;');
  });

  it('never ANDs the optional staff permissions with canManage', () => {
    expect(MANAGER).not.toContain('canManage && (canPrepare');
    expect(MANAGER).not.toContain('canManage && (canFinalize');
  });

  it('gates create/edit on prepare and finalize/void on finalize', () => {
    expect(MANAGER).toContain('const allowPrepare = effectiveCanPrepare;');
    expect(MANAGER).toContain('const allowFinalize = effectiveCanFinalize;');
    expect(MANAGER).toContain('{allowPrepare && (');
    expect(MANAGER).toContain('{allowPrepare && creating && (');
    expect(MANAGER).toContain('const editable = isDraft && allowPrepare;');
    expect(MANAGER).toContain('{isDraft && allowFinalize && (');
    expect(MANAGER).toContain('{allowPrepare && allowFinalize && (');
  });

  it('shows the neutral read-only note only when both effective gates are false', () => {
    expect(MANAGER).toContain('{!effectiveCanPrepare && !effectiveCanFinalize && (');
    expect(MANAGER).not.toContain('{!canManage && (');
  });
});

/* ------------------------- 13/14) scope of the change --------------------- */

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });

const hasRef = (ref: string) => {
  try {
    git('cat-file', '-e', `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

/** Commit immediately preceding all RC-1I work (RC-1H generated baseline). */
const RC1I_BASELINE = 'ae98371382db217408ec74313a9a9076fecbcf36';
/** Rejected RC-1I candidate — accepted route/permission wiring lives here. */
const RC1I_REJECTED_CANDIDATE = '31e6806e959528bbc9fe25aaf8bb0bc30a198749';

const RC1I_ALLOWLIST = [
  'src/components/opportunities/recruiter/RecruiterAccessRoute.tsx',
  'src/components/settlements/BusinessSettlementManager.tsx',
  'src/components/settlements/RecruiterStaffSettlementsPanel.tsx',
  'src/hooks/recruiter/useRecruiterStaffPermissions.ts',
  'src/hooks/settlements/useRecruiterStaffSettlementRelationships.ts',
  'src/test/phaseRC1IRecruiterStaffSettlementAuthorization.test.tsx',
  SQL_PATH,
];

describe('RC-1I — change scope', () => {
  it('leaves the accepted route and permission wiring untouched by the correction', () => {
    if (!hasRef(RC1I_REJECTED_CANDIDATE)) return;
    const changed = git(
      'diff',
      '--name-only',
      RC1I_REJECTED_CANDIDATE,
      'HEAD',
      '--',
      'src/components/opportunities/recruiter/RecruiterAccessRoute.tsx',
      'src/hooks/recruiter/useRecruiterStaffPermissions.ts',
    )
      .split('\n')
      .filter(Boolean);
    expect(changed).toEqual([]);
  });

  it('keeps the functional RC-1I diff inside the original seven files', () => {
    if (!hasRef(RC1I_BASELINE)) return;
    const changed = git('diff', '--name-only', RC1I_BASELINE, 'HEAD')
      .split('\n')
      .filter(Boolean);
    expect(changed.length).toBeGreaterThan(0);
    for (const file of changed) expect(RC1I_ALLOWLIST).toContain(file);
    expect(changed).not.toContain('src/integrations/supabase/types.ts');
  });

  it('still exposes the accepted route and permission wiring', () => {
    expect(ROUTE).toContain('RecruiterStaffSettlementsPanel');
    expect(ROUTE).toContain('canViewSettlements');
    expect(PERMS_HOOK).toContain('canViewSettlements');
    expect(PERMS_HOOK).toContain('canPrepareSettlements');
    expect(PERMS_HOOK).toContain('canFinalizeSettlements');
  });
});
