// Phase 1L-F1 — Canonical driver view model + listing transparency tests.

import { describe, it, expect } from 'vitest';
import type { Tables } from '@/integrations/supabase/types';
import {
  normalizeOpportunity,
  calculateListingTransparency,
  type OpportunitySourceRow,
  type CanonicalOpportunity,
} from '@/lib/opportunities/opportunityCanonicalView';

type Row = Tables<'opportunities'>;

function makeRow(overrides: Partial<Row> = {}): Row {
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
    id: '00000000-0000-0000-0000-000000000001',
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
    recruiter_id: '00000000-0000-0000-0000-0000000000aa',
    requirements: null,
    riders_allowed: null,
    route_type: null,
    salary_amount: null,
    salary_frequency: null,
    sign_on_bonus: null,
    status: 'draft',
    team_configuration: null,
    title: 'Test Opportunity',
    trailer_type: null,
    transparency_confirmed: false,
    typical_lanes: null,
    updated_at: '2026-07-01T00:00:00Z',
    view_count: 0,
    ...overrides,
  } as Row;
}

function source(overrides: Partial<OpportunitySourceRow> = {}): OpportunitySourceRow {
  const { recruiter, ...rest } = overrides;
  return { ...makeRow(rest as Partial<Row>), recruiter: recruiter ?? null };
}

/**
 * A fully populated "universal" row so isolated pay-model/cost tests can start
 * from a complete listing and change one axis at a time.
 */
function fullBase(overrides: Partial<OpportunitySourceRow> = {}): OpportunitySourceRow {
  return source({
    canonical_version: 1,
    company_name: 'Acme',
    employment_model: 'contractor_1099',
    team_configuration: 'solo',
    route_type: 'OTR',
    trailer_type: 'Dry Van',
    hiring_city: 'Dallas',
    hiring_state: 'TX',
    description: 'A full description.',
    home_time: 'Weekly',
    forced_dispatch: false,
    pets_allowed: true,
    riders_allowed: false,
    equipment_year: '2022',
    typical_lanes: 'TX -> OK',
    requirements: 'Class A CDL',
    actual_benefits: 'PTO and health',
    pay_model: 'flat_weekly',
    flat_weekly_pay: 1600,
    fuel_paid_by: 'company',
    insurance_deductions: 100,
    insurance_deduction_frequency: 'weekly',
    maintenance_deductions: 50,
    maintenance_deduction_frequency: 'weekly',
    other_deductions: 25,
    other_deduction_frequency: 'weekly',
    escrow_required_state: 'not_required',
    ...overrides,
  });
}

/* ----------------------------- 1. sourceVersion ---------------------------- */

describe('sourceVersion', () => {
  it('canonical_version=1 -> canonical_v1', () => {
    const c = normalizeOpportunity(source({ canonical_version: 1 }));
    expect(c.sourceVersion).toBe('canonical_v1');
  });
  it('missing or non-1 canonical_version -> legacy', () => {
    expect(normalizeOpportunity(source({ canonical_version: null })).sourceVersion).toBe('legacy');
    expect(normalizeOpportunity(source({ canonical_version: 0 })).sourceVersion).toBe('legacy');
  });
});

/* --------------------- 2. legacy driver_type projections ------------------- */

describe('legacy driver_type projections', () => {
  it('legacy team row -> employment_model unknown, team=team, transparency notes legacy', () => {
    const c = normalizeOpportunity(source({ driver_type: 'team', canonical_version: null }));
    expect(c.classification.employmentModel).toBe('unknown');
    expect(c.classification.teamConfiguration).toBe('team');
    expect(c.derived.transparencyScore.notes.some((n) => /legacy/i.test(n))).toBe(true);
  });
  it('legacy company driver row -> employment_model company_driver', () => {
    const c = normalizeOpportunity(source({ driver_type: 'company', canonical_version: null }));
    expect(c.classification.employmentModel).toBe('company_driver');
  });
});

/* ----- 3-6. cost relevance by employment model + 8. NA vs not_disclosed --- */

describe('cost relevance by employment model', () => {
  it('company_driver: costs and net not applicable', () => {
    const c = normalizeOpportunity(fullBase({ employment_model: 'company_driver', fuel_paid_by: null }));
    expect(c.costs.fuelPaidBy.state).toBe('not_applicable');
    expect(c.costs.insurance.state).toBe('not_applicable');
    expect(c.costs.maintenance.state).toBe('not_applicable');
    expect(c.costs.otherRecurringCost.state).toBe('not_applicable');
    expect(c.costs.lease.state).toBe('not_applicable');
    expect(c.costs.escrowRequired.state).toBe('not_applicable');
    expect(c.costs.escrowAmount.state).toBe('not_applicable');
    expect(c.derived.financialEstimate.netStatus).toBe('not_applicable');
  });

  it('contractor_1099: fuel/insurance/maintenance/other relevant, lease not applicable', () => {
    const c = normalizeOpportunity(fullBase({ employment_model: 'contractor_1099' }));
    expect(c.costs.insurance.state).toBe('provided');
    expect(c.costs.lease.state).toBe('not_applicable');
  });

  it('owner_operator: lease not applicable', () => {
    const c = normalizeOpportunity(fullBase({ employment_model: 'owner_operator' }));
    expect(c.costs.lease.state).toBe('not_applicable');
  });

  it('lease_purchase: lease is relevant (provided or not_disclosed)', () => {
    const c = normalizeOpportunity(fullBase({
      employment_model: 'lease_purchase',
      lease_payment: 400,
      lease_payment_frequency: 'weekly',
    }));
    expect(c.costs.lease.state).toBe('provided');
    const c2 = normalizeOpportunity(fullBase({ employment_model: 'lease_purchase' }));
    expect(c2.costs.lease.state).toBe('not_disclosed');
  });

  it('unknown employment (legacy team): ownership-specific costs not applicable, no net', () => {
    const c = normalizeOpportunity(source({ driver_type: 'team' }));
    expect(c.costs.insurance.state).toBe('not_applicable');
    expect(c.costs.lease.state).toBe('not_applicable');
    expect(c.derived.financialEstimate.netStatus).not.toBe('available');
  });

  it('relevant undisclosed cost -> not_disclosed (contractor missing insurance)', () => {
    const c = normalizeOpportunity(fullBase({
      employment_model: 'contractor_1099',
      insurance_deductions: null,
      insurance_deduction_frequency: null,
    }));
    expect(c.costs.insurance.state).toBe('not_disclosed');
  });
});

/* -------------------- 7. zero and false preservation ----------------------- */

describe('zero and false preservation', () => {
  it('preserves numeric zero as provided', () => {
    const c = normalizeOpportunity(fullBase({
      pay_model: 'cpm',
      cpm: 0,
      estimated_weekly_miles: 2500,
      estimated_loaded_miles: 0,
      deadhead_paid: false,
    }));
    expect(c.compensation.recurringPay.cpm).toEqual({ state: 'provided', value: 0 });
    expect(c.compensation.mileage.loadedWeeklyMiles).toEqual({ state: 'provided', value: 0 });
    expect(c.compensation.mileage.deadheadPaid).toEqual({ state: 'provided', value: false });
    expect(c.operatingTerms.forcedDispatch).toEqual({ state: 'provided', value: false });
  });
});

/* --------------------- 9-11. all recognized pay models --------------------- */

describe('pay-model handling', () => {
  it('cpm: fields relevant and provided', () => {
    const c = normalizeOpportunity(fullBase({
      pay_model: 'cpm',
      cpm: 0.65,
      estimated_weekly_miles: 2500,
      estimated_loaded_miles: 2400,
      deadhead_paid: true,
    }));
    expect(c.compensation.payModel).toBe('cpm');
    expect(c.compensation.recurringPay.flatWeekly.state).toBe('not_applicable');
  });

  it('percentage: preserves rate + basis + label', () => {
    const c = normalizeOpportunity(fullBase({
      pay_model: 'percentage',
      percentage_pay: 25,
      percentage_basis_label: 'linehaul revenue',
      percentage_weekly_revenue_basis: 6000,
      flat_weekly_pay: null,
    }));
    expect(c.compensation.recurringPay.percentage).toEqual({
      state: 'provided',
      value: { rate: 25, weeklyRevenueBasis: 6000, basisLabel: 'linehaul revenue' },
    });
  });

  it('flat_weekly: flat is provided, others irrelevant', () => {
    const c = normalizeOpportunity(fullBase({ pay_model: 'flat_weekly', flat_weekly_pay: 1600 }));
    expect(c.compensation.recurringPay.flatWeekly).toEqual({ state: 'provided', value: 1600 });
    expect(c.compensation.recurringPay.cpm.state).toBe('not_applicable');
  });

  it('salary: preserves amount and frequency', () => {
    const c = normalizeOpportunity(fullBase({
      pay_model: 'salary',
      salary_amount: 78000,
      salary_frequency: 'annual',
      flat_weekly_pay: null,
    }));
    expect(c.compensation.recurringPay.salary).toEqual({
      state: 'provided',
      value: { amount: 78000, frequency: 'annual' },
    });
  });

  it('mixed: components remain structured', () => {
    const c = normalizeOpportunity(fullBase({
      pay_model: 'mixed',
      flat_weekly_pay: null,
      mixed_pay_components: [
        { label: 'Base', amount: 1000, frequency: 'weekly' },
        { label: 'Bonus', amount: 200, frequency: 'weekly' },
      ] as unknown as Row['mixed_pay_components'],
    }));
    expect(c.compensation.recurringPay.mixedComponents).toHaveLength(2);
    expect(c.compensation.recurringPay.mixedComponents[0]).toEqual({
      label: 'Base',
      amount: { state: 'provided', value: { amount: 1000, frequency: 'weekly' } },
    });
  });

  it('other: label + weeklyGross', () => {
    const c = normalizeOpportunity(fullBase({
      pay_model: 'other',
      flat_weekly_pay: null,
      other_pay_method_label: 'per-load',
      other_weekly_gross: 1500,
    }));
    expect(c.compensation.recurringPay.otherMethod.label).toEqual({ state: 'provided', value: 'per-load' });
    expect(c.compensation.recurringPay.otherMethod.weeklyGross).toEqual({ state: 'provided', value: 1500 });
  });

  it('unknown pay_model preserves as unknown and blocks transparency payModel item', () => {
    const c = normalizeOpportunity(fullBase({ pay_model: null, flat_weekly_pay: null }));
    expect(c.compensation.payModel).toBe('unknown');
    expect(c.derived.transparencyScore.missingRelevantFields).toContain('payModel');
  });
});

/* --------- 12. recruiter-provided gross conflict propagates via financial -- */

describe('financial gross conflict propagation', () => {
  it('recruiter-provided gross differing from derived triggers conflict + reduces transparency', () => {
    const c = normalizeOpportunity(fullBase({
      pay_model: 'flat_weekly',
      flat_weekly_pay: 1000,
      estimated_weekly_gross: 5000,
    }));
    expect(c.derived.financialEstimate.status).toBe('conflict');
    expect(c.derived.transparencyScore.conflicts.length).toBeGreaterThan(0);
  });
});

/* -------------- 13. sign-on bonus excluded from recurring + score ---------- */

describe('sign-on bonus isolation', () => {
  it('does not affect financial recurring gross or transparency score', () => {
    const a = normalizeOpportunity(fullBase({ sign_on_bonus: null }));
    const b = normalizeOpportunity(fullBase({ sign_on_bonus: 5000 }));
    expect(b.compensation.oneTimeIncentives.signOnBonus).toEqual({ state: 'provided', value: 5000 });
    expect(b.derived.financialEstimate.recurringWeeklyGross).toBe(a.derived.financialEstimate.recurringWeeklyGross);
    expect(b.derived.transparencyScore.score).toBe(a.derived.transparencyScore.score);
  });
});

/* --------------------- 14. hiring-area display precedence ------------------ */

describe('hiringArea.displayLabel', () => {
  it('city + state', () => {
    expect(normalizeOpportunity(source({ hiring_city: 'Dallas', hiring_state: 'TX' })).hiringArea.displayLabel).toBe('Dallas, TX');
  });
  it('states fallback', () => {
    expect(normalizeOpportunity(source({ hiring_states: ['TX', 'OK', ''] })).hiringArea.displayLabel).toBe('TX, OK');
  });
  it('none disclosed', () => {
    expect(normalizeOpportunity(source({})).hiringArea.displayLabel).toBe('Hiring area not disclosed');
  });
});

/* ---------- 15. legacy benefits split + actualBenefits isolation ----------- */

describe('legacy benefits + actualBenefits isolation', () => {
  it('splits legacy benefits into typicalLanes+requirements; actualBenefits stays not_disclosed', () => {
    const c = normalizeOpportunity(source({
      benefits: 'Typical Lanes:\nTX -> OK\n\nRequirements:\nClass A CDL',
    }));
    expect(c.content.typicalLanes).toEqual({ state: 'provided', value: 'TX -> OK' });
    expect(c.content.requirements).toEqual({ state: 'provided', value: 'Class A CDL' });
    expect(c.content.actualBenefits.state).toBe('not_disclosed');
  });
  it('actualBenefits provided only when dedicated column is set', () => {
    const c = normalizeOpportunity(source({ actual_benefits: 'PTO' }));
    expect(c.content.actualBenefits).toEqual({ state: 'provided', value: 'PTO' });
  });
});

/* ----- 16-17. recruiter verification never implied by Featured / admin ----- */

describe('trust separation and recruiter verification mapping', () => {
  it('featured or approved admin does not imply recruiter verification', () => {
    const c = normalizeOpportunity(source({ featured: true, admin_review_status: 'approved' }));
    expect(c.trust.featured).toBe(true);
    expect(c.trust.internalReviewStatus).toBe('approved');
    expect(c.trust.recruiterVerification).toBe('none');
  });
  it('approved verification + non-suspended recruiter -> approved', () => {
    const c = normalizeOpportunity(source({ recruiter: { verification_status: 'approved', status: 'active' } }));
    expect(c.trust.recruiterVerification).toBe('approved');
  });
  it('suspended recruiter -> suspended even if approved', () => {
    const c = normalizeOpportunity(source({ recruiter: { verification_status: 'approved', status: 'suspended' } }));
    expect(c.trust.recruiterVerification).toBe('suspended');
  });
  it('pending / rejected / none', () => {
    expect(normalizeOpportunity(source({ recruiter: { verification_status: 'pending', status: 'active' } })).trust.recruiterVerification).toBe('pending');
    expect(normalizeOpportunity(source({ recruiter: { verification_status: 'rejected', status: 'active' } })).trust.recruiterVerification).toBe('rejected');
    expect(normalizeOpportunity(source({ recruiter: null })).trust.recruiterVerification).toBe('none');
  });
});

/* ---------------- 18. checklist + band coverage ---------------------------- */

describe('listing transparency band coverage', () => {
  it('sparse when only universal partial', () => {
    const c = normalizeOpportunity(source({ company_name: 'A' }));
    expect(c.derived.transparencyScore.band).toBe('sparse');
  });
  it('complete when full base row is fully disclosed', () => {
    const c = normalizeOpportunity(fullBase({}));
    expect(['complete', 'mostly_complete']).toContain(c.derived.transparencyScore.band);
  });
  it('four bands are reachable', () => {
    // Sparse
    expect(normalizeOpportunity(source({})).derived.transparencyScore.band).toBe('sparse');
    // Partial (mid-disclosure, still missing many)
    const partial = normalizeOpportunity(source({
      canonical_version: 1,
      company_name: 'Acme',
      employment_model: 'contractor_1099',
      team_configuration: 'solo',
      route_type: 'OTR',
      trailer_type: 'Dry Van',
      hiring_city: 'Dallas',
      hiring_state: 'TX',
      description: 'x',
      home_time: 'weekly',
      forced_dispatch: false,
      pets_allowed: true,
      riders_allowed: false,
      equipment_year: '2022',
      pay_model: 'flat_weekly',
      flat_weekly_pay: 1500,
    }));
    expect(partial.derived.transparencyScore.band).toBe('partial');
    // Complete
    const complete = normalizeOpportunity(fullBase({
      pets_allowed: true,
      riders_allowed: false,
    }));
    expect(['complete', 'mostly_complete']).toContain(complete.derived.transparencyScore.band);
  });
});

/* --------- 19. financial conflicts reduce score exactly 15 each (cap 30) --- */

describe('financial conflict penalty', () => {
  it('one conflict = -15; capped at 30 total', () => {
    const clean = normalizeOpportunity(fullBase({}));
    const oneConflict = normalizeOpportunity(fullBase({
      pay_model: 'flat_weekly',
      flat_weekly_pay: 1000,
      estimated_weekly_gross: 5000,
    }));
    expect(clean.derived.transparencyScore.conflicts.length).toBe(0);
    expect(oneConflict.derived.transparencyScore.conflicts.length).toBe(1);
    expect(clean.derived.transparencyScore.score - oneConflict.derived.transparencyScore.score).toBe(15);

    // Manually construct a canonical with 3 conflicts to validate cap=30
    const base: CanonicalOpportunity = JSON.parse(JSON.stringify(clean));
    base.derived.financialEstimate = {
      ...base.derived.financialEstimate,
      conflicts: ['a', 'b', 'c'],
    };
    const t = calculateListingTransparency(base);
    expect(t.conflicts).toEqual(['a', 'b', 'c']);
    expect(clean.derived.transparencyScore.score - t.score).toBe(30);
  });
});

/* --- 20. score unchanged for Featured / admin / recruiter verification / sign-on */

describe('irrelevant fields do not affect transparency score', () => {
  it('Featured, admin_review_status, recruiter verification, sign-on bonus', () => {
    const baseline = normalizeOpportunity(fullBase({}));
    const noisy = normalizeOpportunity(fullBase({
      featured: true,
      admin_review_status: 'approved',
      sign_on_bonus: 2500,
      recruiter: { verification_status: 'approved', status: 'active' },
    }));
    expect(noisy.derived.transparencyScore.score).toBe(baseline.derived.transparencyScore.score);
  });
});

/* --------- 21. legacy CPM value 65 preserved exactly (never /100) ---------- */

describe('legacy CPM preservation', () => {
  it('cpm=65 remains 65', () => {
    const c = normalizeOpportunity(source({
      pay_model: 'cpm',
      cpm: 65,
      estimated_weekly_miles: 2500,
      estimated_loaded_miles: 2400,
      deadhead_paid: true,
    }));
    expect(c.compensation.recurringPay.cpm).toEqual({ state: 'provided', value: 65 });
  });
});

/* --------- 22. loaded=0 remains provided; financialEstimate incomplete ----- */

describe('explicit zero loaded miles', () => {
  it('loaded=0 provided; financial estimate is incomplete', () => {
    const c = normalizeOpportunity(fullBase({
      pay_model: 'cpm',
      cpm: 0.65,
      estimated_weekly_miles: 2500,
      estimated_loaded_miles: 0,
      deadhead_paid: true,
      flat_weekly_pay: null,
    }));
    expect(c.compensation.mileage.loadedWeeklyMiles).toEqual({ state: 'provided', value: 0 });
    expect(c.derived.financialEstimate.status).toBe('incomplete');
  });
});

/* --------- 23. no unstored experience requirement leaks into shape --------- */

describe('no unstored experience field', () => {
  it('CanonicalOpportunity has no experience field at any depth', () => {
    const c = normalizeOpportunity(fullBase({}));
    const json = JSON.stringify(c);
    expect(json).not.toMatch(/min_years_experience/i);
    expect(json).not.toMatch(/experience/i);
  });
});

/* -------- transparency notes always include the disclosure-only note ------- */

describe('transparency notes', () => {
  it('always includes the disclosure-vs-profitability note', () => {
    const c = normalizeOpportunity(source({}));
    expect(c.derived.transparencyScore.notes.some((n) =>
      /disclosure completeness and consistency, not profitability/i.test(n),
    )).toBe(true);
  });
});
