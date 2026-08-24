// Phase 1L-DE1R2R2 — Pure behavioral coverage for the canonical opportunity
// authoring module. Exercises normalization, calculator input projection,
// publication readiness, and persistence payload construction.
//
// Every test targets a specific rule in
// src/lib/opportunities/opportunityCanonical.ts and asserts against the
// current source of truth in the module — never against reimplemented
// expectations of what the rules "should" be.

import { describe, expect, it } from 'vitest';
import type { Json, Tables } from '@/integrations/supabase/types';
import {
  EMPTY_AUTHORING_STATE,
  ROUTE_TYPE_VALUES,
  TRAILER_TYPE_VALUES,
  buildCanonicalFinancialInput,
  buildOpportunityPersistencePayload,
  normalizeOpportunityForAuthoring,
  projectLegacyDriverType,
  projectLegacyPayModel,
  validateOpportunityReadiness,
  type CanonicalOpportunityAuthoringState,
} from '@/lib/opportunities/opportunityCanonical';
import { joinBenefits } from '@/lib/opportunities/benefitsFormat';

/* ---------------- typed fixture helpers ---------------- */

type OpportunityRow = Tables<'opportunities'>;

/** Exhaustive baseline row — every non-nullable column set with a plausible
 *  default. Tests supply targeted overrides. No casts. */
function makeOpportunityRow(overrides: Partial<OpportunityRow> = {}): OpportunityRow {
  return {
    actual_benefits: null,
    admin_review_status: 'pending',
    benefits: null,
    canonical_version: null,
    company_name: 'Acme Trucking',
    cpm: null,
    created_at: '2026-07-01T00:00:00Z',
    deadhead_paid: null,
    description: null,
    detention_pay: null,
    driver_type: null,
    employment_model: null,
    equipment_year: null,
    escrow_amount: null,
    escrow_amount_frequency: null,
    escrow_required: false,
    escrow_required_state: null,
    estimated_deadhead_miles: null,
    estimated_loaded_miles: null,
    estimated_weekly_gross: null,
    estimated_weekly_miles: null,
    featured: false,
    flat_weekly_pay: null,
    forced_dispatch: null,
    fuel_paid_by: null,
    hiring_city: null,
    hiring_state: null,
    hiring_states: [],
    home_time: null,
    id: 'opp-fixture',
    insurance_deduction_frequency: null,
    insurance_deductions: null,
    layover_pay: null,
    lease_payment: null,
    lease_payment_frequency: null,
    maintenance_deduction_frequency: null,
    maintenance_deductions: null,
    mixed_pay_components: [],
    other_deduction_frequency: null,
    other_deductions: null,
    other_pay_method_label: null,
    other_weekly_gross: null,
    pay_model: null,
    percentage_basis_label: null,
    percentage_pay: null,
    percentage_weekly_revenue_basis: null,
    pets_allowed: null,
    published_at: null,
    recruiter_id: 'r-fixture',
    requirements: null,
    riders_allowed: null,
    route_type: null,
    salary_amount: null,
    salary_frequency: null,
    sign_on_bonus: null,
    status: 'draft',
    team_configuration: null,
    title: 'Fixture Title',
    trailer_type: null,
    transparency_confirmed: false,
    typical_lanes: null,
    updated_at: '2026-07-01T00:00:00Z',
    view_count: 0,
    ...overrides,
  };
}

/** Convenience: authoring accepts a Partial<Row>. */
function opp(overrides: Partial<OpportunityRow> = {}): Partial<OpportunityRow> {
  return overrides;
}

/** Json-typed mixed-component fixtures (structural Json fixtures). */
type JsonRecord = { [key: string]: Json | undefined };
function mixedComponents(components: JsonRecord[]): Json {
  // JsonRecord[] is structurally a Json[], which is a Json.
  return components as Json;
}

function state(
  overrides: Partial<CanonicalOpportunityAuthoringState> = {},
): CanonicalOpportunityAuthoringState {
  return { ...EMPTY_AUTHORING_STATE, ...overrides };
}

function publishableCpmState(
  overrides: Partial<CanonicalOpportunityAuthoringState> = {},
): CanonicalOpportunityAuthoringState {
  return state({
    title: 'Regional Dry Van',
    company_name: 'Acme Trucking',
    employment_model: 'company_driver',
    team_configuration: 'solo',
    route_type: 'Regional',
    trailer_type: 'Dry Van',
    hiring_city: 'Dallas',
    hiring_state: 'TX',
    description: 'A regional lane with predictable home time.',
    home_time: 'Home weekly',
    pay_model: 'cpm',
    cpm: '0.65',
    estimated_weekly_miles: '2800',
    estimated_loaded_miles: '2600',
    deadhead_paid: 'no',
    transparency_confirmed: true,
    ...overrides,
  });
}

/* ---------------- projectLegacyDriverType ---------------- */

describe('projectLegacyDriverType', () => {
  it.each([
    ['company', 'company_driver'],
    ['company_driver', 'company_driver'],
    ['1099', 'contractor_1099'],
    ['1099_contractor', 'contractor_1099'],
    ['contractor_1099', 'contractor_1099'],
    ['owner_operator', 'owner_operator'],
    ['lease_purchase', 'lease_purchase'],
  ])('resolves %s to canonical employment without inventing a team', (input, emp) => {
    expect(projectLegacyDriverType(input)).toEqual({
      employment_model: emp,
      team_configuration: 'unspecified',
      legacy_team_row: false,
    });
  });

  it('marks team / team_driver as legacy team rows with unknown employment', () => {
    for (const value of ['team', 'team_driver']) {
      expect(projectLegacyDriverType(value)).toEqual({
        employment_model: 'unknown',
        team_configuration: 'team',
        legacy_team_row: true,
      });
    }
  });

  it('returns unknown/unspecified for null, blank, and unrecognized values', () => {
    for (const v of [null, undefined, '', '   ', 'freelancer']) {
      expect(projectLegacyDriverType(v)).toEqual({
        employment_model: 'unknown',
        team_configuration: 'unspecified',
        legacy_team_row: false,
      });
    }
  });
});

/* ---------------- projectLegacyPayModel ---------------- */

describe('projectLegacyPayModel', () => {
  it.each(['cpm', 'percentage', 'flat_weekly', 'salary', 'mixed', 'other'])(
    'accepts recognized value %s (case/whitespace insensitive)',
    (v) => {
      expect(projectLegacyPayModel(v.toUpperCase())).toBe(v);
      expect(projectLegacyPayModel(` ${v} `)).toBe(v);
    },
  );

  it('returns unknown for null, blank, or unrecognized values', () => {
    for (const v of [null, undefined, '', 'per_load']) {
      expect(projectLegacyPayModel(v)).toBe('unknown');
    }
  });
});

/* ---------------- normalizeOpportunityForAuthoring ---------------- */

describe('normalizeOpportunityForAuthoring', () => {
  it('returns a fresh EMPTY_AUTHORING_STATE for null/undefined inputs', () => {
    for (const v of [null, undefined]) {
      const result = normalizeOpportunityForAuthoring(v);
      expect(result).toEqual(EMPTY_AUTHORING_STATE);
      expect(result).not.toBe(EMPTY_AUTHORING_STATE);
    }
  });

  it('canonical employment/team override legacy driver_type projection', () => {
    const result = normalizeOpportunityForAuthoring(opp({
      title: 'x',
      company_name: 'y',
      driver_type: 'team',
      employment_model: 'owner_operator',
      team_configuration: 'solo',
    }));
    expect(result.employment_model).toBe('owner_operator');
    expect(result.team_configuration).toBe('solo');
    expect(result.legacy_team_row).toBe(false);
  });

  it('legacy team_driver row remains unknown employment with legacy_team_row=true', () => {
    const result = normalizeOpportunityForAuthoring(opp({ driver_type: 'team' }));
    expect(result.employment_model).toBe('unknown');
    expect(result.team_configuration).toBe('team');
    expect(result.legacy_team_row).toBe(true);
  });

  it('does not infer pay_model from numeric legacy columns', () => {
    const result = normalizeOpportunityForAuthoring(opp({ cpm: 0.55, flat_weekly_pay: 1400 }));
    expect(result.pay_model).toBe('unknown');
    expect(result.cpm).toBe('0.55');
    expect(result.flat_weekly_pay).toBe('');
  });

  it('preserves recognized stored pay_model as-is', () => {
    expect(normalizeOpportunityForAuthoring(opp({ pay_model: 'percentage' })).pay_model).toBe('percentage');
    expect(normalizeOpportunityForAuthoring(opp({ pay_model: 'weird' })).pay_model).toBe('unknown');
  });

  it('canonical salary amount disables legacy flat_weekly_pay fallback', () => {
    const result = normalizeOpportunityForAuthoring(opp({
      pay_model: 'salary', flat_weekly_pay: 1200, salary_amount: 2000,
    }));
    expect(result.salary_amount).toBe('2000');
    expect(result.salary_frequency).toBeNull();
  });

  it('canonical salary frequency alone disables legacy flat_weekly_pay fallback', () => {
    const result = normalizeOpportunityForAuthoring(opp({
      pay_model: 'salary', flat_weekly_pay: 1200, salary_frequency: 'annual',
    }));
    expect(result.salary_amount).toBe('');
    expect(result.salary_frequency).toBe('annual');
  });

  it('hydrates legacy flat_weekly_pay only when pay_model=salary and both canonical fields absent', () => {
    const result = normalizeOpportunityForAuthoring(opp({ pay_model: 'salary', flat_weekly_pay: 1200 }));
    expect(result.salary_amount).toBe('1200');
    expect(result.salary_frequency).toBe('weekly');
  });

  it('preserves zero and false values through normalization', () => {
    const result = normalizeOpportunityForAuthoring(opp({
      cpm: 0, sign_on_bonus: 0,
      deadhead_paid: false, forced_dispatch: false, pets_allowed: false, riders_allowed: false,
    }));
    expect(result.cpm).toBe('0');
    expect(result.sign_on_bonus).toBe('0');
    expect(result.deadhead_paid).toBe('no');
    expect(result.forced_dispatch).toBe('no');
    expect(result.pets_allowed).toBe('no');
    expect(result.riders_allowed).toBe('no');
  });

  it('stored transparency_confirmed=true round-trips as true', () => {
    const result = normalizeOpportunityForAuthoring(opp({ transparency_confirmed: true }));
    expect(result.transparency_confirmed).toBe(true);
  });

  it('stored transparency_confirmed=false, null, or absent all normalize to false', () => {
    expect(normalizeOpportunityForAuthoring(opp({ transparency_confirmed: false })).transparency_confirmed).toBe(false);
    // Adversarial historical row where transparency_confirmed slipped through
    // as null: preserve the exhaustive typed row and inject the runtime value
    // via Object.defineProperty — no cast, no unsafe assertion.
    const row = makeOpportunityRow();
    Object.defineProperty(row, 'transparency_confirmed', {
      value: null, writable: true, enumerable: true, configurable: true,
    });
    expect(normalizeOpportunityForAuthoring(row).transparency_confirmed).toBe(false);
    expect(normalizeOpportunityForAuthoring(opp({})).transparency_confirmed).toBe(false);
  });

  it('canonical escrow_required_state wins over legacy escrow_required', () => {
    const result = normalizeOpportunityForAuthoring(opp({
      escrow_required_state: 'not_required', escrow_required: true,
    }));
    expect(result.escrow_required_state).toBe('not_required');
  });

  it('legacy escrow_required=true (no canonical state) becomes required', () => {
    const result = normalizeOpportunityForAuthoring(opp({ escrow_required: true }));
    expect(result.escrow_required_state).toBe('required');
  });

  it.each<boolean | null>([false, null])(
    'legacy escrow_required=%p becomes unspecified (never fabricates not_required)',
    (v) => {
      // escrow_required is non-nullable in the Row; assign the adversarial
      // runtime value onto a typed row via Object.defineProperty.
      const row = makeOpportunityRow();
      Object.defineProperty(row, 'escrow_required', {
        value: v, writable: true, enumerable: true, configurable: true,
      });
      const result = normalizeOpportunityForAuthoring(row);
      expect(result.escrow_required_state).toBe('unspecified');
    },
  );

  it('legacy escrow_required=undefined (absent) becomes unspecified', () => {
    const result = normalizeOpportunityForAuthoring(opp({}));
    expect(result.escrow_required_state).toBe('unspecified');
  });

  it('splits legacy benefits with lane/requirement markers into dedicated fields', () => {
    const stored = joinBenefits({ typical_lanes: 'Dallas → Houston', requirements: 'Class A CDL' });
    const result = normalizeOpportunityForAuthoring(opp({ benefits: stored }));
    expect(result.typical_lanes).toBe('Dallas → Houston');
    expect(result.requirements).toBe('Class A CDL');
  });

  it('markerless legacy benefits populate requirements only', () => {
    const result = normalizeOpportunityForAuthoring(opp({ benefits: 'Legacy free-form text' }));
    expect(result.typical_lanes).toBe('');
    expect(result.requirements).toBe('Legacy free-form text');
  });

  it('dedicated canonical typical_lanes and requirements take precedence independently', () => {
    const stored = joinBenefits({ typical_lanes: 'LegacyLanes', requirements: 'LegacyReqs' });
    const result = normalizeOpportunityForAuthoring(opp({ typical_lanes: 'CanonLanes', benefits: stored }));
    expect(result.typical_lanes).toBe('CanonLanes');
    expect(result.requirements).toBe('LegacyReqs');
  });

  it('actual_benefits never falls back to legacy benefits column', () => {
    const result = normalizeOpportunityForAuthoring(opp({ benefits: 'Legacy text', actual_benefits: null }));
    expect(result.actual_benefits).toBe('');
  });

  it('canonical mixed components are preserved without inventing legacy hints (canonical_version=1)', () => {
    const result = normalizeOpportunityForAuthoring(opp({
      pay_model: 'mixed', canonical_version: 1,
      mixed_pay_components: mixedComponents([{ label: 'CPM base', amount: 0.5, frequency: 'weekly' }]),
    }));
    expect(result.mixed_pay_components).toEqual([{ label: 'CPM base', amount: '0.5', frequency: 'weekly' }]);
    expect(result.legacy_mixed_pay_hint).toBe(false);
  });

  it('canonical_version=1 with an empty mixed array does not raise the legacy hint', () => {
    const result = normalizeOpportunityForAuthoring(opp({
      pay_model: 'mixed', canonical_version: 1,
      mixed_pay_components: mixedComponents([]),
    }));
    expect(result.mixed_pay_components).toEqual([]);
    expect(result.legacy_mixed_pay_hint).toBe(false);
  });

  it('legacy mixed row with exactly one usable component preserves it and does not raise the hint', () => {
    const result = normalizeOpportunityForAuthoring(opp({
      pay_model: 'mixed',
      mixed_pay_components: mixedComponents([
        { label: 'CPM base', amount: 0.5, frequency: 'weekly' },
      ]),
    }));
    expect(result.mixed_pay_components).toEqual([
      { label: 'CPM base', amount: '0.5', frequency: 'weekly' },
    ]);
    expect(result.legacy_mixed_pay_hint).toBe(false);
  });

  it('legacy mixed row without canonical_version and no usable components clears components + sets hint', () => {
    const result = normalizeOpportunityForAuthoring(opp({
      pay_model: 'mixed',
      mixed_pay_components: mixedComponents([{ label: '', amount: null, frequency: null }]),
    }));
    expect(result.mixed_pay_components).toEqual([]);
    expect(result.legacy_mixed_pay_hint).toBe(true);
  });

  it('malformed partial mixed objects are discarded under the legacy hint path', () => {
    const result = normalizeOpportunityForAuthoring(opp({
      pay_model: 'mixed',
      mixed_pay_components: mixedComponents([{ label: 'Only label' }]),
    }));
    expect(result.mixed_pay_components).toEqual([]);
    expect(result.legacy_mixed_pay_hint).toBe(true);
  });

  it('hiring_states is always a new array and ignores non-string fixtures', () => {
    // Adversarial JSON-derived heterogeneous array injected onto the typed
    // row via Object.defineProperty — no cast at the fixture boundary.
    const row = makeOpportunityRow();
    const source: unknown[] = ['TX', 5, 'OK', null];
    Object.defineProperty(row, 'hiring_states', {
      value: source, writable: true, enumerable: true, configurable: true,
    });
    const result = normalizeOpportunityForAuthoring(row);
    expect(result.hiring_states).toEqual(['TX', 'OK']);
    expect(result.hiring_states).not.toBe(source);
  });

  it('missing hiring_states remains an empty array (never null)', () => {
    const result = normalizeOpportunityForAuthoring(opp({}));
    expect(result.hiring_states).toEqual([]);
  });
});

/* ---------------- buildCanonicalFinancialInput ---------------- */

describe('buildCanonicalFinancialInput', () => {
  it('marks all ownership costs and escrow not_applicable for company driver', () => {
    const input = buildCanonicalFinancialInput(state({
      employment_model: 'company_driver', pay_model: 'cpm', cpm: '0.6',
      insurance_amount: '500', insurance_frequency: 'monthly',
      escrow_required_state: 'required', escrow_amount: '1000', escrow_frequency: 'weekly',
    }));
    expect(input.costs.insurance.state).toBe('not_applicable');
    expect(input.costs.maintenance.state).toBe('not_applicable');
    expect(input.costs.other.state).toBe('not_applicable');
    expect(input.costs.lease.state).toBe('not_applicable');
    expect(input.costs.escrowRequired.state).toBe('not_applicable');
    expect(input.costs.escrowAmount.state).toBe('not_applicable');
  });

  it('cost-bearing blank amount and no frequency yields not_disclosed', () => {
    const input = buildCanonicalFinancialInput(state({
      employment_model: 'contractor_1099', pay_model: 'cpm', cpm: '0.6',
    }));
    expect(input.costs.insurance.state).toBe('not_disclosed');
    expect(input.costs.maintenance.state).toBe('not_disclosed');
    expect(input.costs.other.state).toBe('not_disclosed');
    expect(input.costs.lease.state).toBe('not_applicable');
  });

  it('lease-purchase enables lease as cost-bearing input', () => {
    const input = buildCanonicalFinancialInput(state({
      employment_model: 'lease_purchase', pay_model: 'cpm', cpm: '0.6',
      lease_amount: '850', lease_frequency: 'weekly',
    }));
    expect(input.costs.lease).toEqual({
      state: 'provided',
      value: { amount: 850, frequency: 'weekly' },
    });
  });

  it('nonblank cost amount with no frequency projects provided with null frequency', () => {
    const input = buildCanonicalFinancialInput(state({
      employment_model: 'contractor_1099', pay_model: 'cpm', cpm: '0.6',
      insurance_amount: '250', insurance_frequency: null,
    }));
    expect(input.costs.insurance).toEqual({
      state: 'provided',
      value: { amount: 250, frequency: null },
    });
  });

  it('blank cost amount paired with a frequency preserves NaN + frequency', () => {
    const input = buildCanonicalFinancialInput(state({
      employment_model: 'owner_operator', pay_model: 'cpm', cpm: '0.6',
      insurance_amount: '', insurance_frequency: 'monthly',
    }));
    expect(input.costs.insurance.state).toBe('provided');
    if (input.costs.insurance.state === 'provided') {
      expect(input.costs.insurance.value.frequency).toBe('monthly');
      expect(Number.isNaN(input.costs.insurance.value.amount)).toBe(true);
    }
  });

  it('provided zero cost amount is preserved as provided (not not_disclosed)', () => {
    const input = buildCanonicalFinancialInput(state({
      employment_model: 'contractor_1099', pay_model: 'cpm', cpm: '0.6',
      insurance_amount: '0', insurance_frequency: 'monthly',
    }));
    expect(input.costs.insurance).toEqual({
      state: 'provided',
      value: { amount: 0, frequency: 'monthly' },
    });
  });

  it('unspecified escrow with frequency-only stale input is provided NaN with that frequency', () => {
    const input = buildCanonicalFinancialInput(state({
      employment_model: 'contractor_1099', pay_model: 'cpm', cpm: '0.6',
      escrow_required_state: 'unspecified', escrow_amount: '', escrow_frequency: 'weekly',
    }));
    expect(input.costs.escrowRequired.state).toBe('not_disclosed');
    expect(input.costs.escrowAmount.state).toBe('provided');
    if (input.costs.escrowAmount.state === 'provided') {
      expect(input.costs.escrowAmount.value.frequency).toBe('weekly');
      expect(Number.isNaN(input.costs.escrowAmount.value.amount)).toBe(true);
    }
  });

  it('explicit not_disclosed escrow with frequency-only stale input is provided NaN with that frequency', () => {
    const input = buildCanonicalFinancialInput(state({
      employment_model: 'contractor_1099', pay_model: 'cpm', cpm: '0.6',
      escrow_required_state: 'not_disclosed', escrow_amount: '', escrow_frequency: 'monthly',
    }));
    expect(input.costs.escrowRequired.state).toBe('not_disclosed');
    expect(input.costs.escrowAmount.state).toBe('provided');
    if (input.costs.escrowAmount.state === 'provided') {
      expect(input.costs.escrowAmount.value.frequency).toBe('monthly');
      expect(Number.isNaN(input.costs.escrowAmount.value.amount)).toBe(true);
    }
  });

  it('unspecified escrow with a stale amount is passed as provided so the calculator can diagnose', () => {
    const input = buildCanonicalFinancialInput(state({
      employment_model: 'contractor_1099', pay_model: 'cpm', cpm: '0.6',
      escrow_required_state: 'unspecified', escrow_amount: '250', escrow_frequency: null,
    }));
    expect(input.costs.escrowRequired.state).toBe('not_disclosed');
    expect(input.costs.escrowAmount).toEqual({
      state: 'provided',
      value: { amount: 250, frequency: null },
    });
  });

  it('not_required escrow without any stale input is not_applicable', () => {
    const input = buildCanonicalFinancialInput(state({
      employment_model: 'contractor_1099', pay_model: 'cpm', cpm: '0.6',
      escrow_required_state: 'not_required',
    }));
    expect(input.costs.escrowRequired).toEqual({ state: 'provided', value: false });
    expect(input.costs.escrowAmount.state).toBe('not_applicable');
  });

  it('not_required escrow with a stale positive amount is passed as provided', () => {
    const input = buildCanonicalFinancialInput(state({
      employment_model: 'contractor_1099', pay_model: 'cpm', cpm: '0.6',
      escrow_required_state: 'not_required', escrow_amount: '500', escrow_frequency: null,
    }));
    expect(input.costs.escrowAmount).toEqual({
      state: 'provided',
      value: { amount: 500, frequency: null },
    });
  });

  it('sign-on bonus zero is emitted as a provided one-time incentive of zero', () => {
    const input = buildCanonicalFinancialInput(state({ sign_on_bonus: '0' }));
    expect(input.oneTimeIncentives).toEqual([
      { label: 'Sign-on bonus', amount: { state: 'provided', value: 0 } },
    ]);
  });

  it('empty sign-on bonus emits no one-time incentives', () => {
    const input = buildCanonicalFinancialInput(state({ sign_on_bonus: '' }));
    expect(input.oneTimeIncentives).toEqual([]);
  });

  it('non-CPM state does not project a CPM disclosure', () => {
    const input = buildCanonicalFinancialInput(state({ pay_model: 'flat_weekly', flat_weekly_pay: '1500' }));
    expect(input.cpm.state).toBe('not_applicable');
    expect(input.flatWeeklyPay).toEqual({ state: 'provided', value: 1500 });
  });
});

/* ---------------- validateOpportunityReadiness ---------------- */

describe('validateOpportunityReadiness — draft rules', () => {
  it('blank title/company block even a draft save', () => {
    const r = validateOpportunityReadiness(state());
    expect(r.canSaveDraft).toBe(false);
    expect(r.blockingReasons).toEqual(expect.arrayContaining([
      'Opportunity title is required.',
      'Company name is required.',
    ]));
  });

  it('minimal title + company with no other fields is draftable', () => {
    const r = validateOpportunityReadiness(state({ title: 'x', company_name: 'y' }));
    expect(r.canSaveDraft).toBe(true);
    expect(r.canPublish).toBe(false);
  });

  it('invalid numeric input blocks draft', () => {
    const r = validateOpportunityReadiness(state({ title: 'x', company_name: 'y', cpm: '-1' }));
    expect(r.canSaveDraft).toBe(false);
    expect(r.blockingReasons).toContain('Fix invalid numeric values (must be zero or greater).');
  });
});

describe('validateOpportunityReadiness — universal publish blockers', () => {
  it('unresolved employment blocks publish with its own blocker', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ employment_model: 'unknown' }));
    expect(r.blockingReasons).toContain('Select an employment arrangement.');
  });

  it('unresolved team blocks publish with its own blocker', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ team_configuration: 'unspecified' }));
    expect(r.blockingReasons).toContain('Select a driving configuration (Solo, Team, or Solo or Team).');
  });

  it('missing route type blocks publish', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ route_type: '' }));
    expect(r.blockingReasons).toContain('Select a route type.');
  });

  it('missing trailer type blocks publish', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ trailer_type: '' }));
    expect(r.blockingReasons).toContain('Select a trailer type.');
  });

  it('missing city/state and no hiring_states blocks publish', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      hiring_city: '', hiring_state: '', hiring_states: [],
    }));
    expect(r.blockingReasons).toContain('Provide a hiring city and state, or at least one hiring state.');
  });

  it('hiring_states alone satisfies the hiring-area requirement', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      hiring_city: '', hiring_state: '', hiring_states: ['TX'],
    }));
    expect(r.blockingReasons).not.toContain('Provide a hiring city and state, or at least one hiring state.');
  });

  it('missing description blocks publish', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ description: '' }));
    expect(r.blockingReasons).toContain('Description is required.');
  });

  it('missing home time blocks publish', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ home_time: '' }));
    expect(r.blockingReasons).toContain('Home time is required.');
  });

  it('unknown pay_model blocks publish', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ pay_model: 'unknown', cpm: '' }));
    expect(r.blockingReasons).toContain('Select a pay model.');
  });

  it('publish universally requires transparency confirmation', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ transparency_confirmed: false }));
    expect(r.blockingReasons).toContain('Confirm the opportunity is accurate before publishing.');
  });
});

describe('validateOpportunityReadiness — pay-model readiness matrix', () => {
  it('CPM invalid: missing rate and miles', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ cpm: '', estimated_weekly_miles: '' }));
    expect(r.blockingReasons).toContain('CPM must be greater than zero.');
    expect(r.blockingReasons).toContain('Total weekly miles must be greater than zero for CPM pay.');
  });

  it('CPM valid: full publishable state publishes', () => {
    const r = validateOpportunityReadiness(publishableCpmState());
    expect(r.canPublish).toBe(true);
    expect(r.blockingReasons).toEqual([]);
  });

  // Phase OD-1 — CPM is stored as dollars per mile. Cents-shaped entry (75)
  // must be blocked, never silently converted.
  it('CPM above $5.00/mi blocks publish as cents-shaped entry', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ cpm: '75' }));
    expect(r.canPublish).toBe(false);
    expect(r.blockingReasons).toContain(
      'CPM must be entered in dollars per mile (example: 75 cents = 0.75).',
    );
  });

  it('CPM at the $5.00/mi boundary remains publishable', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ cpm: '5' }));
    expect(r.blockingReasons).not.toContain(
      'CPM must be entered in dollars per mile (example: 75 cents = 0.75).',
    );
  });

  it('CPM with zero loaded miles blocks publish with the specific message', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ estimated_loaded_miles: '0' }));
    expect(r.blockingReasons).toContain('Loaded miles cannot be zero when provided.');
  });

  it('CPM requires explicit deadhead_paid disclosure', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ deadhead_paid: 'unknown' }));
    expect(r.blockingReasons).toContain('Specify whether deadhead miles are paid (yes or no).');
  });

  it('Percentage invalid: missing rate, label, and basis', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      pay_model: 'percentage', cpm: '',
    }));
    expect(r.blockingReasons).toEqual(expect.arrayContaining([
      'Percentage rate must be greater than zero.',
      'Percentage basis label is required.',
      'Percentage weekly revenue basis must be greater than zero.',
    ]));
  });

  it('Percentage valid publishes', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      pay_model: 'percentage', cpm: '',
      percentage_rate: '25', percentage_basis_label: 'Gross line-haul',
      percentage_weekly_revenue_basis: '6000',
    }));
    expect(r.canPublish).toBe(true);
  });

  it('Flat weekly invalid: missing amount', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      pay_model: 'flat_weekly', cpm: '',
    }));
    expect(r.blockingReasons).toContain('Flat weekly pay must be greater than zero.');
  });

  it('Flat weekly valid publishes', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      pay_model: 'flat_weekly', cpm: '', flat_weekly_pay: '1500',
    }));
    expect(r.canPublish).toBe(true);
  });

  it('Salary invalid: missing amount and frequency', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      pay_model: 'salary', cpm: '',
    }));
    expect(r.blockingReasons).toEqual(expect.arrayContaining([
      'Salary amount must be greater than zero.',
      'Salary pay period is required.',
    ]));
  });

  it('Salary valid publishes', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      pay_model: 'salary', cpm: '',
      salary_amount: '85000', salary_frequency: 'annual',
    }));
    expect(r.canPublish).toBe(true);
  });

  it('Mixed with fewer than two complete components blocks publish', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      pay_model: 'mixed', cpm: '',
      mixed_pay_components: [{ label: 'CPM base', amount: '0.5', frequency: 'weekly' }],
    }));
    expect(r.blockingReasons).toContain('Mixed pay requires at least two complete components (label, amount, frequency).');
  });

  it('Mixed with two complete components publishes', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      pay_model: 'mixed', cpm: '',
      mixed_pay_components: [
        { label: 'CPM base', amount: '0.5', frequency: 'weekly' },
        { label: 'Weekly guarantee', amount: '250', frequency: 'weekly' },
      ],
    }));
    expect(r.canPublish).toBe(true);
  });

  it('Other invalid: missing label and gross', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      pay_model: 'other', cpm: '',
    }));
    expect(r.blockingReasons).toEqual(expect.arrayContaining([
      'Pay method label is required for “Other”.',
      'Supported weekly gross must be greater than zero for “Other”.',
    ]));
  });

  it('Other valid publishes', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      pay_model: 'other', cpm: '',
      other_pay_method_label: 'Guarantee + activity', other_weekly_gross: '1600',
    }));
    expect(r.canPublish).toBe(true);
  });
});

describe('validateOpportunityReadiness — cost & escrow validation', () => {
  it('cost-bearing escrow required without amount/frequency emits specific blockers', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      employment_model: 'contractor_1099',
      escrow_required_state: 'required',
    }));
    expect(r.blockingReasons).toEqual(expect.arrayContaining([
      'Escrow amount is required when escrow is required.',
      'Escrow frequency is required when escrow is required.',
    ]));
  });

  it('cost-bearing amount with no frequency blocks publish and financial status stays incomplete', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      employment_model: 'contractor_1099',
      insurance_amount: '100', insurance_frequency: null,
    }));
    expect(r.blockingReasons).toContain('Insurance frequency is required when an amount is set.');
    expect(r.financialEstimate.status).toBe('incomplete');
    expect(r.financialEstimate.totalKnownWeeklyCosts).toBeNull();
  });

  it('cost-bearing unspecified escrow emits a warning, not a blocker', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      employment_model: 'contractor_1099',
    }));
    expect(r.warnings).toContain('Escrow requirement not disclosed — weekly net will be incomplete.');
    expect(r.blockingReasons).not.toContain('Escrow requirement not disclosed — weekly net will be incomplete.');
  });

  it('cost-bearing explicit not_disclosed escrow emits the same warning and never blocks', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      employment_model: 'contractor_1099',
      escrow_required_state: 'not_disclosed',
    }));
    expect(r.warnings).toContain('Escrow requirement not disclosed — weekly net will be incomplete.');
    expect(r.blockingReasons).not.toContain('Escrow requirement not disclosed — weekly net will be incomplete.');
    expect(r.canPublish).toBe(true);
  });

  it('not_required escrow with a stale positive amount maps only to the escrow blocker', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      employment_model: 'contractor_1099',
      escrow_required_state: 'not_required',
      escrow_amount: '500',
    }));
    expect(r.blockingReasons).toContain(
      'Escrow is marked not required but a positive escrow amount was provided. Clear the stale escrow amount before publishing.',
    );
    expect(r.blockingReasons).not.toContain(
      'Recruiter-provided weekly gross differs from derived gross by more than 10%. Resolve the conflict before publishing.',
    );
  });

  it('recruiter-provided gross conflict >10% maps only to the recruiter-gross blocker', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      recruiter_provided_weekly_gross: '5000',
    }));
    expect(r.blockingReasons).toContain(
      'Recruiter-provided weekly gross differs from derived gross by more than 10%. Resolve the conflict before publishing.',
    );
    expect(r.blockingReasons).not.toContain(
      'Escrow is marked not required but a positive escrow amount was provided. Clear the stale escrow amount before publishing.',
    );
  });
});

describe('validateOpportunityReadiness — warnings & structural rules', () => {
  it('legacy mixed-pay hint with no complete components warns', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      pay_model: 'mixed', cpm: '', mixed_pay_components: [], legacy_mixed_pay_hint: true,
    }));
    expect(r.warnings).toContain('Legacy mixed-pay row: reconstruct at least two named recurring components before publishing.');
  });

  it('legacy mixed-pay warning disappears once two complete components exist', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      pay_model: 'mixed', cpm: '', legacy_mixed_pay_hint: true,
      mixed_pay_components: [
        { label: 'CPM base', amount: '0.5', frequency: 'weekly' },
        { label: 'Weekly guarantee', amount: '250', frequency: 'weekly' },
      ],
    }));
    expect(r.warnings).not.toContain('Legacy mixed-pay row: reconstruct at least two named recurring components before publishing.');
    expect(r.canPublish).toBe(true);
  });

  it('legacy team-driver row without resolved employment warns and blocks publish', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      employment_model: 'unknown', legacy_team_row: true, team_configuration: 'team',
    }));
    expect(r.warnings).toContain('Legacy team-driver row: select an employment model before publishing.');
    expect(r.blockingReasons).toContain('Select an employment arrangement.');
  });

  it('blockingReasons and warnings are unique and sorted alphabetically', () => {
    const r = validateOpportunityReadiness(state({ title: '', company_name: '', cpm: '-1' }));
    const sortedCopy = [...r.blockingReasons].sort();
    expect(r.blockingReasons).toEqual(sortedCopy);
    expect(new Set(r.blockingReasons).size).toBe(r.blockingReasons.length);
    const warnCopy = [...r.warnings].sort();
    expect(r.warnings).toEqual(warnCopy);
    expect(new Set(r.warnings).size).toBe(r.warnings.length);
  });

  it('exposes a financial estimate on every readiness result', () => {
    const r = validateOpportunityReadiness(state({ title: 'x', company_name: 'y' }));
    expect(r.financialEstimate).toBeDefined();
    expect(typeof r.financialEstimate.status).toBe('string');
  });

  it('sign-on bonus (positive or zero) leaves every recurring financial output identical to the no-bonus baseline', () => {
    const baseline = validateOpportunityReadiness(publishableCpmState());
    const withPositive = validateOpportunityReadiness(publishableCpmState({ sign_on_bonus: '5000' }));
    const withZero = validateOpportunityReadiness(publishableCpmState({ sign_on_bonus: '0' }));

    for (const other of [withPositive, withZero]) {
      expect(other.financialEstimate.status).toBe(baseline.financialEstimate.status);
      expect(other.financialEstimate.recurringWeeklyGross).toBe(baseline.financialEstimate.recurringWeeklyGross);
      expect(other.financialEstimate.estimatedWeeklyNet).toBe(baseline.financialEstimate.estimatedWeeklyNet);
      expect(other.financialEstimate.netStatus).toBe(baseline.financialEstimate.netStatus);
      expect(other.financialEstimate.effectiveRpm).toBe(baseline.financialEstimate.effectiveRpm);
    }

    // Only the one-time total surface reflects the bonus.
    expect(baseline.financialEstimate.oneTimeIncentiveTotal).toBe(0);
    expect(withPositive.financialEstimate.oneTimeIncentiveTotal).toBe(5000);
    expect(withZero.financialEstimate.oneTimeIncentiveTotal).toBe(0);
  });
});

/* ---------------- buildOpportunityPersistencePayload ---------------- */

describe('buildOpportunityPersistencePayload — mode/status/version', () => {
  it('sets canonical_version=1, driver_type projection, and mode-driven status', () => {
    const draft = buildOpportunityPersistencePayload(
      publishableCpmState({ employment_model: 'owner_operator' }), 'draft');
    expect(draft.canonical_version).toBe(1);
    expect(draft.status).toBe('draft');
    expect(draft.driver_type).toBe('owner_operator');

    const publish = buildOpportunityPersistencePayload(publishableCpmState(), 'publish');
    expect(publish.status).toBe('active');
    expect(publish.driver_type).toBe('company');
  });

  it('never persists null for hiring_states (always an array)', () => {
    const payload = buildOpportunityPersistencePayload(state({ title: 'x', company_name: 'y' }), 'draft');
    expect(Array.isArray(payload.hiring_states)).toBe(true);
    expect(payload.hiring_states).toEqual([]);
  });

  it('hiring_states array is a copy, never a shared reference', () => {
    const src = state({ title: 'x', company_name: 'y', hiring_states: ['TX', 'OK'] });
    const payload = buildOpportunityPersistencePayload(src, 'draft');
    expect(payload.hiring_states).toEqual(['TX', 'OK']);
    expect(payload.hiring_states).not.toBe(src.hiring_states);
  });
});

describe('buildOpportunityPersistencePayload — employment-model clearing', () => {
  const filledCosts: Partial<CanonicalOpportunityAuthoringState> = {
    title: 'x', company_name: 'y', fuel_paid_by: 'Company',
    insurance_amount: '500', insurance_frequency: 'monthly',
    maintenance_amount: '100', maintenance_frequency: 'weekly',
    other_cost_amount: '25', other_cost_frequency: 'weekly',
    lease_amount: '850', lease_frequency: 'weekly',
    escrow_required_state: 'required', escrow_amount: '1000', escrow_frequency: 'weekly',
  };

  it('company driver clears ownership cost fields, fuel, and escrow amount/frequency', () => {
    const payload = buildOpportunityPersistencePayload(state({
      ...filledCosts, employment_model: 'company_driver',
    }), 'draft');
    expect(payload.fuel_paid_by).toBeNull();
    expect(payload.insurance_deductions).toBeNull();
    expect(payload.insurance_deduction_frequency).toBeNull();
    expect(payload.maintenance_deductions).toBeNull();
    expect(payload.other_deductions).toBeNull();
    expect(payload.lease_payment).toBeNull();
    expect(payload.lease_payment_frequency).toBeNull();
    expect(payload.escrow_required).toBe(false);
    expect(payload.escrow_required_state).toBeNull();
    expect(payload.escrow_amount).toBeNull();
    expect(payload.escrow_amount_frequency).toBeNull();
  });

  it('contractor keeps recurring costs but never persists a lease payment', () => {
    const payload = buildOpportunityPersistencePayload(state({
      ...filledCosts, employment_model: 'contractor_1099',
    }), 'draft');
    expect(payload.insurance_deductions).toBe(500);
    expect(payload.insurance_deduction_frequency).toBe('monthly');
    expect(payload.lease_payment).toBeNull();
    expect(payload.lease_payment_frequency).toBeNull();
  });

  it('owner-operator keeps recurring costs but never persists a lease payment', () => {
    const payload = buildOpportunityPersistencePayload(state({
      ...filledCosts, employment_model: 'owner_operator',
    }), 'draft');
    expect(payload.insurance_deductions).toBe(500);
    expect(payload.lease_payment).toBeNull();
    expect(payload.lease_payment_frequency).toBeNull();
  });

  it('lease_purchase preserves lease payment along with other recurring costs', () => {
    const payload = buildOpportunityPersistencePayload(state({
      ...filledCosts, employment_model: 'lease_purchase',
    }), 'draft');
    expect(payload.lease_payment).toBe(850);
    expect(payload.lease_payment_frequency).toBe('weekly');
    expect(payload.insurance_deductions).toBe(500);
  });
});

describe('buildOpportunityPersistencePayload — escrow persistence', () => {
  it('escrow not_required persists state without amount or frequency', () => {
    const payload = buildOpportunityPersistencePayload(state({
      title: 'x', company_name: 'y', employment_model: 'contractor_1099',
      escrow_required_state: 'not_required', escrow_amount: '500', escrow_frequency: 'weekly',
    }), 'draft');
    expect(payload.escrow_required).toBe(false);
    expect(payload.escrow_required_state).toBe('not_required');
    expect(payload.escrow_amount).toBeNull();
    expect(payload.escrow_amount_frequency).toBeNull();
  });

  it('escrow required persists amount, frequency, and boolean', () => {
    const payload = buildOpportunityPersistencePayload(state({
      title: 'x', company_name: 'y', employment_model: 'contractor_1099',
      escrow_required_state: 'required', escrow_amount: '1000', escrow_frequency: 'weekly',
    }), 'draft');
    expect(payload.escrow_required).toBe(true);
    expect(payload.escrow_required_state).toBe('required');
    expect(payload.escrow_amount).toBe(1000);
    expect(payload.escrow_amount_frequency).toBe('weekly');
  });
});

describe('buildOpportunityPersistencePayload — pay-model gating', () => {
  const base: Partial<CanonicalOpportunityAuthoringState> = {
    title: 'x', company_name: 'y',
    cpm: '0.6', percentage_rate: '25', percentage_basis_label: 'Gross',
    percentage_weekly_revenue_basis: '6000', flat_weekly_pay: '1500',
    salary_amount: '85000', salary_frequency: 'annual',
    other_pay_method_label: 'Guarantee', other_weekly_gross: '1600',
    mixed_pay_components: [
      { label: 'CPM base', amount: '0.5', frequency: 'weekly' },
      { label: 'Weekly guarantee', amount: '250', frequency: 'weekly' },
    ],
  };

  it('CPM persists only cpm; clears every other pay-model field', () => {
    const payload = buildOpportunityPersistencePayload(state({ ...base, pay_model: 'cpm' }), 'draft');
    expect(payload.cpm).toBe(0.6);
    expect(payload.percentage_pay).toBeNull();
    expect(payload.percentage_basis_label).toBeNull();
    expect(payload.percentage_weekly_revenue_basis).toBeNull();
    expect(payload.flat_weekly_pay).toBeNull();
    expect(payload.salary_amount).toBeNull();
    expect(payload.salary_frequency).toBeNull();
    expect(payload.other_pay_method_label).toBeNull();
    expect(payload.other_weekly_gross).toBeNull();
    expect(payload.mixed_pay_components).toEqual([]);
  });

  it('Percentage persists rate/label/basis; clears every other pay-model field', () => {
    const payload = buildOpportunityPersistencePayload(state({ ...base, pay_model: 'percentage' }), 'draft');
    expect(payload.percentage_pay).toBe(25);
    expect(payload.percentage_basis_label).toBe('Gross');
    expect(payload.percentage_weekly_revenue_basis).toBe(6000);
    expect(payload.cpm).toBeNull();
    expect(payload.flat_weekly_pay).toBeNull();
    expect(payload.salary_amount).toBeNull();
    expect(payload.other_weekly_gross).toBeNull();
  });

  it('Flat weekly persists only flat_weekly_pay', () => {
    const payload = buildOpportunityPersistencePayload(state({ ...base, pay_model: 'flat_weekly' }), 'draft');
    expect(payload.flat_weekly_pay).toBe(1500);
    expect(payload.cpm).toBeNull();
    expect(payload.percentage_pay).toBeNull();
    expect(payload.salary_amount).toBeNull();
  });

  it('Salary persists amount and frequency', () => {
    const payload = buildOpportunityPersistencePayload(state({ ...base, pay_model: 'salary' }), 'draft');
    expect(payload.salary_amount).toBe(85000);
    expect(payload.salary_frequency).toBe('annual');
    expect(payload.flat_weekly_pay).toBeNull();
    expect(payload.cpm).toBeNull();
  });

  it('Mixed persists structured components and clears scalar pay fields', () => {
    const payload = buildOpportunityPersistencePayload(state({ ...base, pay_model: 'mixed' }), 'draft');
    expect(payload.mixed_pay_components).toEqual([
      { label: 'CPM base', amount: 0.5, frequency: 'weekly' },
      { label: 'Weekly guarantee', amount: 250, frequency: 'weekly' },
    ]);
    expect(payload.cpm).toBeNull();
    expect(payload.flat_weekly_pay).toBeNull();
    expect(payload.salary_amount).toBeNull();
  });

  it('Other persists label and gross; clears every other pay-model field', () => {
    const payload = buildOpportunityPersistencePayload(state({ ...base, pay_model: 'other' }), 'draft');
    expect(payload.other_pay_method_label).toBe('Guarantee');
    expect(payload.other_weekly_gross).toBe(1600);
    expect(payload.cpm).toBeNull();
    expect(payload.percentage_pay).toBeNull();
    expect(payload.flat_weekly_pay).toBeNull();
    expect(payload.salary_amount).toBeNull();
    expect(payload.mixed_pay_components).toEqual([]);
  });
});

describe('buildOpportunityPersistencePayload — content, benefits, transparency', () => {
  it('legacy benefits column contains only lanes and requirements, never actual_benefits', () => {
    const payload = buildOpportunityPersistencePayload(state({
      title: 'x', company_name: 'y',
      typical_lanes: 'Dallas → Houston',
      requirements: 'Class A CDL',
      actual_benefits: 'Medical after 60 days',
    }), 'draft');
    expect(payload.typical_lanes).toBe('Dallas → Houston');
    expect(payload.requirements).toBe('Class A CDL');
    expect(payload.actual_benefits).toBe('Medical after 60 days');
    expect(payload.benefits).toBe(joinBenefits({
      typical_lanes: 'Dallas → Houston',
      requirements: 'Class A CDL',
    }));
    expect(payload.benefits ?? '').not.toContain('Medical after 60 days');
  });

  it('transparency_confirmed=true persists exactly true', () => {
    const payload = buildOpportunityPersistencePayload(
      state({ title: 'x', company_name: 'y', transparency_confirmed: true }), 'draft');
    expect(payload.transparency_confirmed).toBe(true);
  });

  it('transparency_confirmed=false persists exactly false', () => {
    const payload = buildOpportunityPersistencePayload(
      state({ title: 'x', company_name: 'y', transparency_confirmed: false }), 'draft');
    expect(payload.transparency_confirmed).toBe(false);
  });

  it('preserves zero and false booleans through persistence', () => {
    const payload = buildOpportunityPersistencePayload(state({
      title: 'x', company_name: 'y',
      sign_on_bonus: '0',
      deadhead_paid: 'no', forced_dispatch: 'no', pets_allowed: 'no', riders_allowed: 'no',
    }), 'draft');
    expect(payload.sign_on_bonus).toBe(0);
    expect(payload.deadhead_paid).toBe(false);
    expect(payload.forced_dispatch).toBe(false);
    expect(payload.pets_allowed).toBe(false);
    expect(payload.riders_allowed).toBe(false);
  });

  it('one-time sign_on_bonus persists only to sign_on_bonus, never to a recurring field', () => {
    const payload = buildOpportunityPersistencePayload(state({
      title: 'x', company_name: 'y', pay_model: 'cpm', cpm: '0.6', sign_on_bonus: '3000',
    }), 'draft');
    expect(payload.sign_on_bonus).toBe(3000);
    expect(payload.flat_weekly_pay).toBeNull();
    expect(payload.estimated_weekly_gross).toBeNull();
    expect(payload.salary_amount).toBeNull();
  });

  it('unspecified team_configuration persists as null', () => {
    const payload = buildOpportunityPersistencePayload(state({ title: 'x', company_name: 'y' }), 'draft');
    expect(payload.team_configuration).toBeNull();
  });

  it('trims text fields and stores empty as null', () => {
    const payload = buildOpportunityPersistencePayload(state({
      title: '  Padded  ', company_name: '  Acme  ',
      description: '   ', detention_pay: ' $25/hr ',
    }), 'draft');
    expect(payload.title).toBe('Padded');
    expect(payload.company_name).toBe('Acme');
    expect(payload.description).toBeNull();
    expect(payload.detention_pay).toBe('$25/hr');
  });

  it('route/trailer vocabulary is limited to the canonical value sets', () => {
    expect(ROUTE_TYPE_VALUES).toEqual(['Local', 'Regional', 'OTR', 'Dedicated', 'Semi-Dedicated']);
    expect(TRAILER_TYPE_VALUES).toEqual(['Dry Van', 'Reefer', 'Flatbed', 'Tanker', 'Car Hauler', 'Intermodal', 'Other']);
  });
});
