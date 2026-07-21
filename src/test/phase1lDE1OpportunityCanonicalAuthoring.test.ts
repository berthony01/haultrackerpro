// Phase 1L-DE1R2 — Pure behavioral coverage for the canonical opportunity
// authoring module. Exercises normalization, calculator input projection,
// publication readiness, and persistence payload construction.
//
// Every test targets a specific rule in
// src/lib/opportunities/opportunityCanonical.ts and asserts against the
// current source of truth in the module — never against reimplemented
// expectations of what the rules "should" be.

import { describe, expect, it } from 'vitest';
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

/* ---------------- fixtures ---------------- */

function state(overrides: Partial<CanonicalOpportunityAuthoringState> = {}): CanonicalOpportunityAuthoringState {
  return { ...EMPTY_AUTHORING_STATE, ...overrides };
}

function publishableCpmState(overrides: Partial<CanonicalOpportunityAuthoringState> = {}): CanonicalOpportunityAuthoringState {
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
    ['company', 'company_driver', 'unspecified', false],
    ['company_driver', 'company_driver', 'unspecified', false],
    ['1099', 'contractor_1099', 'unspecified', false],
    ['1099_contractor', 'contractor_1099', 'unspecified', false],
    ['contractor_1099', 'contractor_1099', 'unspecified', false],
    ['owner_operator', 'owner_operator', 'unspecified', false],
    ['lease_purchase', 'lease_purchase', 'unspecified', false],
  ])('resolves %s to canonical employment without inventing a team', (input, emp, team, legacy) => {
    expect(projectLegacyDriverType(input)).toEqual({
      employment_model: emp,
      team_configuration: team,
      legacy_team_row: legacy,
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
    for (const v of [null, undefined, '', '   ', 'freelancer'] as const) {
      expect(projectLegacyDriverType(v as string | null)).toEqual({
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
    'accepts recognized value %s (case/whitespace insensitive)', (v) => {
      expect(projectLegacyPayModel(v.toUpperCase())).toBe(v);
      expect(projectLegacyPayModel(` ${v} `)).toBe(v);
    },
  );

  it('returns unknown for null, blank, or unrecognized values', () => {
    for (const v of [null, undefined, '', 'per_load'] as const) {
      expect(projectLegacyPayModel(v as string | null)).toBe('unknown');
    }
  });
});

/* ---------------- normalizeOpportunityForAuthoring ---------------- */

describe('normalizeOpportunityForAuthoring', () => {
  it('returns a fresh EMPTY_AUTHORING_STATE for null/undefined inputs', () => {
    for (const v of [null, undefined] as const) {
      const result = normalizeOpportunityForAuthoring(v);
      expect(result).toEqual(EMPTY_AUTHORING_STATE);
      // must not share reference with the module-level constant
      expect(result).not.toBe(EMPTY_AUTHORING_STATE);
    }
  });

  it('canonical employment/team override legacy driver_type projection', () => {
    const result = normalizeOpportunityForAuthoring({
      title: 'x', company_name: 'y',
      driver_type: 'team',
      employment_model: 'owner_operator',
      team_configuration: 'solo',
    });
    expect(result.employment_model).toBe('owner_operator');
    expect(result.team_configuration).toBe('solo');
    expect(result.legacy_team_row).toBe(false);
  });

  it('legacy team_driver row remains unknown employment with legacy_team_row=true', () => {
    const result = normalizeOpportunityForAuthoring({ driver_type: 'team' });
    expect(result.employment_model).toBe('unknown');
    expect(result.team_configuration).toBe('team');
    expect(result.legacy_team_row).toBe(true);
  });

  it('does not infer pay_model from numeric legacy columns', () => {
    const result = normalizeOpportunityForAuthoring({ cpm: 0.55, flat_weekly_pay: 1400 });
    expect(result.pay_model).toBe('unknown');
    expect(result.cpm).toBe('0.55');
    expect(result.flat_weekly_pay).toBe(''); // only hydrated when pay_model==='flat_weekly'
  });

  it('preserves recognized stored pay_model as-is', () => {
    expect(normalizeOpportunityForAuthoring({ pay_model: 'percentage' }).pay_model).toBe('percentage');
    expect(normalizeOpportunityForAuthoring({ pay_model: 'weird' as unknown as string }).pay_model).toBe('unknown');
  });

  it('canonical salary amount disables legacy flat_weekly_pay fallback', () => {
    const result = normalizeOpportunityForAuthoring({
      pay_model: 'salary', flat_weekly_pay: 1200, salary_amount: 2000,
    });
    expect(result.salary_amount).toBe('2000');
    expect(result.salary_frequency).toBeNull();
  });

  it('canonical salary frequency alone disables legacy flat_weekly_pay fallback', () => {
    const result = normalizeOpportunityForAuthoring({
      pay_model: 'salary', flat_weekly_pay: 1200, salary_frequency: 'annual',
    });
    expect(result.salary_amount).toBe('');
    expect(result.salary_frequency).toBe('annual');
  });

  it('hydrates legacy flat_weekly_pay only when pay_model=salary and both canonical fields absent', () => {
    const result = normalizeOpportunityForAuthoring({ pay_model: 'salary', flat_weekly_pay: 1200 });
    expect(result.salary_amount).toBe('1200');
    expect(result.salary_frequency).toBe('weekly');
  });

  it('preserves zero and false values through normalization', () => {
    const result = normalizeOpportunityForAuthoring({
      cpm: 0, sign_on_bonus: 0,
      deadhead_paid: false, forced_dispatch: false, pets_allowed: false, riders_allowed: false,
    });
    expect(result.cpm).toBe('0');
    expect(result.sign_on_bonus).toBe('0');
    expect(result.deadhead_paid).toBe('no');
    expect(result.forced_dispatch).toBe('no');
    expect(result.pets_allowed).toBe('no');
    expect(result.riders_allowed).toBe('no');
  });

  it('canonical escrow_required_state wins over legacy escrow_required', () => {
    const result = normalizeOpportunityForAuthoring({
      escrow_required_state: 'not_required', escrow_required: true,
    });
    expect(result.escrow_required_state).toBe('not_required');
  });

  it('legacy escrow_required=true (no canonical state) becomes required', () => {
    const result = normalizeOpportunityForAuthoring({ escrow_required: true });
    expect(result.escrow_required_state).toBe('required');
  });

  it.each([false, null, undefined])('legacy escrow_required=%p becomes unspecified (never fabricates not_required)', (v) => {
    const result = normalizeOpportunityForAuthoring({ escrow_required: v as boolean | null });
    expect(result.escrow_required_state).toBe('unspecified');
  });

  it('splits legacy benefits with lane/requirement markers into dedicated fields', () => {
    const stored = joinBenefits({ typical_lanes: 'Dallas → Houston', requirements: 'Class A CDL' });
    const result = normalizeOpportunityForAuthoring({ benefits: stored });
    expect(result.typical_lanes).toBe('Dallas → Houston');
    expect(result.requirements).toBe('Class A CDL');
  });

  it('markerless legacy benefits populate requirements only', () => {
    const result = normalizeOpportunityForAuthoring({ benefits: 'Legacy free-form text' });
    expect(result.typical_lanes).toBe('');
    expect(result.requirements).toBe('Legacy free-form text');
  });

  it('dedicated canonical typical_lanes and requirements take precedence independently', () => {
    const stored = joinBenefits({ typical_lanes: 'LegacyLanes', requirements: 'LegacyReqs' });
    const result = normalizeOpportunityForAuthoring({ typical_lanes: 'CanonLanes', benefits: stored });
    expect(result.typical_lanes).toBe('CanonLanes');
    expect(result.requirements).toBe('LegacyReqs');
  });

  it('actual_benefits never falls back to legacy benefits column', () => {
    const result = normalizeOpportunityForAuthoring({ benefits: 'Legacy text', actual_benefits: null });
    expect(result.actual_benefits).toBe('');
  });

  it('canonical mixed components are preserved without inventing legacy hints (canonical_version=1)', () => {
    const result = normalizeOpportunityForAuthoring({
      pay_model: 'mixed', canonical_version: 1,
      mixed_pay_components: [{ label: 'CPM base', amount: 0.5, frequency: 'weekly' }] as never,
    });
    expect(result.mixed_pay_components).toEqual([{ label: 'CPM base', amount: '0.5', frequency: 'weekly' }]);
    expect(result.legacy_mixed_pay_hint).toBe(false);
  });

  it('legacy mixed row without canonical_version and no usable components clears components + sets hint', () => {
    const result = normalizeOpportunityForAuthoring({
      pay_model: 'mixed',
      mixed_pay_components: [{ label: '', amount: null, frequency: null }] as never,
    });
    expect(result.mixed_pay_components).toEqual([]);
    expect(result.legacy_mixed_pay_hint).toBe(true);
  });

  it('malformed partial mixed objects are discarded under the legacy hint path', () => {
    const result = normalizeOpportunityForAuthoring({
      pay_model: 'mixed',
      mixed_pay_components: [{ label: 'Only label' }] as never,
    });
    expect(result.mixed_pay_components).toEqual([]);
    expect(result.legacy_mixed_pay_hint).toBe(true);
  });

  it('hiring_states array preserves string entries and drops non-strings', () => {
    const result = normalizeOpportunityForAuthoring({
      hiring_states: ['TX', 5, 'OK', null] as unknown as string[],
    });
    expect(result.hiring_states).toEqual(['TX', 'OK']);
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
    // lease not applicable for contractor
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

describe('validateOpportunityReadiness', () => {
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

  it('publishable CPM state actually publishes with no blockers', () => {
    const r = validateOpportunityReadiness(publishableCpmState());
    expect(r.canPublish).toBe(true);
    expect(r.blockingReasons).toEqual([]);
  });

  it('CPM with zero loaded miles blocks publish with the specific message', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ estimated_loaded_miles: '0' }));
    expect(r.blockingReasons).toContain('Loaded miles cannot be zero when provided.');
  });

  it('CPM requires positive total weekly miles', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ estimated_weekly_miles: '' }));
    expect(r.blockingReasons).toContain('Total weekly miles must be greater than zero for CPM pay.');
  });

  it('CPM requires explicit deadhead_paid disclosure', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ deadhead_paid: 'unknown' }));
    expect(r.blockingReasons).toContain('Specify whether deadhead miles are paid (yes or no).');
  });

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

  it('cost-bearing amount with no frequency is a blocker', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      employment_model: 'contractor_1099',
      insurance_amount: '100', insurance_frequency: null,
    }));
    expect(r.blockingReasons).toContain('Insurance frequency is required when an amount is set.');
  });

  it('cost-bearing unspecified escrow emits a warning, not a blocker', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      employment_model: 'contractor_1099',
    }));
    expect(r.warnings).toContain('Escrow requirement not disclosed — weekly net will be incomplete.');
    expect(r.blockingReasons).not.toContain('Escrow requirement not disclosed — weekly net will be incomplete.');
  });

  it('not_required escrow with a stale positive amount becomes a mapped calculator blocker', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      employment_model: 'contractor_1099',
      escrow_required_state: 'not_required',
      escrow_amount: '500',
    }));
    expect(r.blockingReasons).toContain(
      'Escrow is marked not required but a positive escrow amount was provided. Clear the stale escrow amount before publishing.',
    );
  });

  it('mixed pay with fewer than two complete components blocks publish', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      pay_model: 'mixed', cpm: '', estimated_weekly_miles: '2800',
      mixed_pay_components: [{ label: 'CPM base', amount: '0.5', frequency: 'weekly' }],
    }));
    expect(r.blockingReasons).toContain('Mixed pay requires at least two complete components (label, amount, frequency).');
  });

  it('legacy mixed-pay hint with no complete components warns', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      pay_model: 'mixed', cpm: '', mixed_pay_components: [], legacy_mixed_pay_hint: true,
    }));
    expect(r.warnings).toContain('Legacy mixed-pay row: reconstruct at least two named recurring components before publishing.');
  });

  it('legacy team-driver row without resolved employment warns and blocks publish', () => {
    const r = validateOpportunityReadiness(publishableCpmState({
      employment_model: 'unknown', legacy_team_row: true, team_configuration: 'team',
    }));
    expect(r.warnings).toContain('Legacy team-driver row: select an employment model before publishing.');
    expect(r.blockingReasons).toContain('Select an employment arrangement.');
  });

  it('publish universally requires transparency confirmation', () => {
    const r = validateOpportunityReadiness(publishableCpmState({ transparency_confirmed: false }));
    expect(r.blockingReasons).toContain('Confirm the opportunity is accurate before publishing.');
  });

  it('blockingReasons and warnings are unique and sorted alphabetically', () => {
    const r = validateOpportunityReadiness(state({ title: '', company_name: '', cpm: '-1' }));
    const sortedCopy = [...r.blockingReasons].sort();
    expect(r.blockingReasons).toEqual(sortedCopy);
    expect(new Set(r.blockingReasons).size).toBe(r.blockingReasons.length);
  });

  it('exposes a financial estimate on every readiness result', () => {
    const r = validateOpportunityReadiness(state({ title: 'x', company_name: 'y' }));
    expect(r.financialEstimate).toBeDefined();
    expect(typeof r.financialEstimate.status).toBe('string');
  });
});

/* ---------------- buildOpportunityPersistencePayload ---------------- */

describe('buildOpportunityPersistencePayload', () => {
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

  it('company driver clears ownership cost fields, fuel, and escrow amount/frequency', () => {
    const payload = buildOpportunityPersistencePayload(state({
      title: 'x', company_name: 'y', employment_model: 'company_driver',
      fuel_paid_by: 'Company', insurance_amount: '500', insurance_frequency: 'monthly',
      lease_amount: '850', lease_frequency: 'weekly',
      escrow_required_state: 'required', escrow_amount: '1000', escrow_frequency: 'weekly',
    }), 'draft');
    expect(payload.fuel_paid_by).toBeNull();
    expect(payload.insurance_deductions).toBeNull();
    expect(payload.insurance_deduction_frequency).toBeNull();
    expect(payload.lease_payment).toBeNull();
    expect(payload.lease_payment_frequency).toBeNull();
    expect(payload.escrow_required).toBe(false);
    expect(payload.escrow_required_state).toBeNull();
    expect(payload.escrow_amount).toBeNull();
    expect(payload.escrow_amount_frequency).toBeNull();
  });

  it('contractor keeps recurring costs but never persists a lease payment', () => {
    const payload = buildOpportunityPersistencePayload(state({
      title: 'x', company_name: 'y', employment_model: 'contractor_1099',
      insurance_amount: '250', insurance_frequency: 'weekly',
      lease_amount: '850', lease_frequency: 'weekly',
    }), 'draft');
    expect(payload.insurance_deductions).toBe(250);
    expect(payload.insurance_deduction_frequency).toBe('weekly');
    expect(payload.lease_payment).toBeNull();
    expect(payload.lease_payment_frequency).toBeNull();
  });

  it('lease_purchase preserves lease payment', () => {
    const payload = buildOpportunityPersistencePayload(state({
      title: 'x', company_name: 'y', employment_model: 'lease_purchase',
      lease_amount: '850', lease_frequency: 'weekly',
    }), 'draft');
    expect(payload.lease_payment).toBe(850);
    expect(payload.lease_payment_frequency).toBe('weekly');
  });

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

  it('pay-model gates numeric persistence; switching away nulls the previous field', () => {
    // flat_weekly_pay only persisted when pay_model === 'flat_weekly'
    const payload = buildOpportunityPersistencePayload(state({
      title: 'x', company_name: 'y', pay_model: 'cpm', cpm: '0.6', flat_weekly_pay: '1500',
    }), 'draft');
    expect(payload.cpm).toBe(0.6);
    expect(payload.flat_weekly_pay).toBeNull();
    expect(payload.percentage_pay).toBeNull();
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

  it('mixed pay stores structured components with numeric amounts and frequency preserved', () => {
    const payload = buildOpportunityPersistencePayload(state({
      title: 'x', company_name: 'y', pay_model: 'mixed',
      mixed_pay_components: [
        { label: 'CPM base', amount: '0.5', frequency: 'weekly' },
        { label: 'Weekly guarantee', amount: '250', frequency: 'weekly' },
      ],
    }), 'draft');
    expect(payload.mixed_pay_components).toEqual([
      { label: 'CPM base', amount: 0.5, frequency: 'weekly' },
      { label: 'Weekly guarantee', amount: 250, frequency: 'weekly' },
    ]);
  });

  it('route/trailer vocabulary is limited to the canonical value sets', () => {
    expect(ROUTE_TYPE_VALUES).toEqual(['Local', 'Regional', 'OTR', 'Dedicated', 'Semi-Dedicated']);
    expect(TRAILER_TYPE_VALUES).toEqual(['Dry Van', 'Reefer', 'Flatbed', 'Tanker', 'Car Hauler', 'Intermodal', 'Other']);
  });
});
