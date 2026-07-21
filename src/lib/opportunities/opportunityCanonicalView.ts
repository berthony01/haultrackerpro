// Phase 1L-F1 — Canonical driver-facing view model and listing transparency.
//
// This module is the sole raw opportunity-row → canonical read-model boundary.
// It reuses (never duplicates) the Phase 1L-DE1 authoring normalizer and the
// Phase 1L-C canonical financial calculator. It never talks to the database,
// performs I/O, invents unstored fields, or measures profitability.

import type { Tables } from '@/integrations/supabase/types';
import {
  buildCanonicalFinancialInput,
  normalizeOpportunityForAuthoring,
  type CanonicalOpportunityAuthoringState,
  type CanonicalTeamConfiguration,
} from './opportunityCanonical';
import {
  calculateCanonicalOpportunityFinancials,
  type CanonicalEmploymentModel,
  type CanonicalMixedPayComponent,
  type CanonicalOpportunityFinancialEstimate,
  type CanonicalPayModel,
  type CanonicalRecurringAmount,
  type Disclosure,
  type RecurringFrequency,
} from './opportunityProfit';

export type {
  Disclosure,
  CanonicalRecurringAmount,
  CanonicalMixedPayComponent,
  CanonicalOpportunityFinancialEstimate,
  CanonicalEmploymentModel,
  CanonicalPayModel,
  RecurringFrequency,
  CanonicalTeamConfiguration,
};

/* ============================== source shape ============================== */

export type OpportunitySourceRow = Tables<'opportunities'> & {
  recruiter?: {
    verification_status?: string | null;
    status?: string | null;
  } | null;
};

/* ============================ canonical shape ============================= */

export type RecruiterVerification =
  | 'approved'
  | 'suspended'
  | 'pending'
  | 'rejected'
  | 'none';

export interface CanonicalOpportunity {
  sourceVersion: 'canonical_v1' | 'legacy';
  identity: {
    id: string;
    recruiterId: string;
    title: string;
    companyName: Disclosure<string>;
  };
  classification: {
    employmentModel: CanonicalEmploymentModel;
    teamConfiguration: CanonicalTeamConfiguration;
    routeType: Disclosure<string>;
    trailerType: Disclosure<string>;
  };
  hiringArea: {
    city: Disclosure<string>;
    state: Disclosure<string>;
    states: Disclosure<string[]>;
    displayLabel: string;
  };
  compensation: {
    payModel: CanonicalPayModel | 'unknown';
    recurringPay: {
      cpm: Disclosure<number>;
      percentage: Disclosure<{
        rate: number;
        weeklyRevenueBasis: number | null;
        basisLabel: string | null;
      }>;
      flatWeekly: Disclosure<number>;
      salary: Disclosure<CanonicalRecurringAmount>;
      mixedComponents: CanonicalMixedPayComponent[];
      otherMethod: {
        label: Disclosure<string>;
        weeklyGross: Disclosure<number>;
      };
      recruiterProvidedWeeklyGross: Disclosure<number>;
    };
    oneTimeIncentives: {
      signOnBonus: Disclosure<number>;
    };
    mileage: {
      totalWeeklyMiles: Disclosure<number>;
      loadedWeeklyMiles: Disclosure<number>;
      deadheadWeeklyMiles: Disclosure<number>;
      deadheadPaid: Disclosure<boolean>;
    };
    accessorialPay: {
      detention: Disclosure<string>;
      layover: Disclosure<string>;
    };
  };
  operatingTerms: {
    homeTime: Disclosure<string>;
    forcedDispatch: Disclosure<boolean>;
    petsAllowed: Disclosure<boolean>;
    ridersAllowed: Disclosure<boolean>;
    equipmentYear: Disclosure<string>;
  };
  costs: {
    fuelPaidBy: Disclosure<string>;
    insurance: Disclosure<CanonicalRecurringAmount>;
    maintenance: Disclosure<CanonicalRecurringAmount>;
    otherRecurringCost: Disclosure<CanonicalRecurringAmount>;
    lease: Disclosure<CanonicalRecurringAmount>;
    escrowRequired: Disclosure<boolean>;
    escrowAmount: Disclosure<CanonicalRecurringAmount>;
  };
  content: {
    description: Disclosure<string>;
    typicalLanes: Disclosure<string>;
    requirements: Disclosure<string>;
    actualBenefits: Disclosure<string>;
  };
  trust: {
    lifecycleStatus: string;
    internalReviewStatus: string;
    publishedAt: Disclosure<string>;
    featured: boolean;
    recruiterVerification: RecruiterVerification;
  };
  derived: {
    financialEstimate: CanonicalOpportunityFinancialEstimate;
    transparencyScore: ListingTransparency;
  };
}

/* ========================= transparency contract ========================== */

export type ListingTransparencyBand =
  | 'complete'
  | 'mostly_complete'
  | 'partial'
  | 'sparse';

export interface ListingTransparency {
  score: number;
  band: ListingTransparencyBand;
  missingRelevantFields: string[];
  conflicts: string[];
  notes: string[];
}

/* ============================== helpers =================================== */

const isFin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function strDisc(val: string, relevant: boolean): Disclosure<string> {
  if (!relevant) return { state: 'not_applicable' };
  const t = val.trim();
  if (t === '') return { state: 'not_disclosed' };
  return { state: 'provided', value: t };
}

function numDiscFromStr(val: string, relevant: boolean): Disclosure<number> {
  if (!relevant) return { state: 'not_applicable' };
  const t = val.trim();
  if (t === '') return { state: 'not_disclosed' };
  return { state: 'provided', value: Number(t) };
}

function boolDiscFromYNU(
  v: 'yes' | 'no' | 'unknown',
  relevant: boolean,
): Disclosure<boolean> {
  if (!relevant) return { state: 'not_applicable' };
  if (v === 'yes') return { state: 'provided', value: true };
  if (v === 'no') return { state: 'provided', value: false };
  return { state: 'not_disclosed' };
}

function recurringDisc(
  amountStr: string,
  freq: RecurringFrequency | null,
  relevant: boolean,
): Disclosure<CanonicalRecurringAmount> {
  if (!relevant) return { state: 'not_applicable' };
  const blank = amountStr.trim() === '';
  if (blank && freq == null) return { state: 'not_disclosed' };
  if (blank) return { state: 'provided', value: { amount: NaN, frequency: freq } };
  return { state: 'provided', value: { amount: Number(amountStr), frequency: freq } };
}

function hiringAreaDisplay(city: string, state: string, states: string[]): string {
  const c = city.trim();
  const s = state.trim();
  if (c && s) return `${c}, ${s}`;
  const nonblank = states.map((x) => (x ?? '').trim()).filter((x) => x !== '');
  if (nonblank.length > 0) return nonblank.join(', ');
  return 'Hiring area not disclosed';
}

function mapRecruiterVerification(
  recruiter: OpportunitySourceRow['recruiter'],
): RecruiterVerification {
  const vs = recruiter?.verification_status;
  const st = recruiter?.status;
  if (vs === 'approved' && st !== 'suspended') return 'approved';
  if (st === 'suspended') return 'suspended';
  if (vs === 'pending') return 'pending';
  if (vs === 'rejected') return 'rejected';
  return 'none';
}

function isRecurringComplete(d: Disclosure<CanonicalRecurringAmount>): boolean {
  if (d.state !== 'provided') return false;
  const { amount, frequency } = d.value;
  if (!isFin(amount) || amount < 0) return false;
  if (frequency == null) return false;
  return true;
}

/* ============================== normalize ================================= */

export function normalizeOpportunity(source: OpportunitySourceRow): CanonicalOpportunity {
  const state: CanonicalOpportunityAuthoringState = normalizeOpportunityForAuthoring(source);

  const employmentModel: CanonicalEmploymentModel =
    state.employment_model === 'unknown' ? 'unknown' : state.employment_model;
  const isCompany = employmentModel === 'company_driver';
  const leaseRelevant = employmentModel === 'lease_purchase';
  const costBearing =
    employmentModel === 'contractor_1099' ||
    employmentModel === 'owner_operator' ||
    leaseRelevant;

  const payModel: CanonicalPayModel | 'unknown' = state.pay_model;

  // Mileage relevance
  const anyMileageProvided =
    state.estimated_weekly_miles.trim() !== '' ||
    state.estimated_loaded_miles.trim() !== '' ||
    state.estimated_deadhead_miles.trim() !== '';
  const payUsesMiles = payModel === 'cpm' || payModel === 'percentage';
  const totalMilesRelevant = payUsesMiles;
  const loadedMilesRelevant = payModel === 'cpm';
  const deadheadMilesRelevant = payUsesMiles || anyMileageProvided;
  const deadheadPaidRelevant = payUsesMiles;

  // Pay model per-field relevance
  const cpmRelevant = payModel === 'cpm';
  const percentageRelevant = payModel === 'percentage';
  const flatRelevant = payModel === 'flat_weekly';
  const salaryRelevant = payModel === 'salary';
  const mixedRelevant = payModel === 'mixed';
  const otherRelevant = payModel === 'other';

  /* ---- percentage disclosure ---- */
  const pctDisc: Disclosure<{ rate: number; weeklyRevenueBasis: number | null; basisLabel: string | null }> =
    (() => {
      if (!percentageRelevant) return { state: 'not_applicable' };
      const rateT = state.percentage_rate.trim();
      const basisT = state.percentage_weekly_revenue_basis.trim();
      const label = state.percentage_basis_label.trim();
      if (!rateT && !basisT && !label) return { state: 'not_disclosed' };
      return {
        state: 'provided',
        value: {
          rate: rateT ? Number(rateT) : 0,
          weeklyRevenueBasis: basisT ? Number(basisT) : null,
          basisLabel: label || null,
        },
      };
    })();

  /* ---- salary disclosure ---- */
  const salaryDisc: Disclosure<CanonicalRecurringAmount> = (() => {
    if (!salaryRelevant) return { state: 'not_applicable' };
    const amt = state.salary_amount.trim();
    const freq = state.salary_frequency;
    if (amt === '' && freq == null) return { state: 'not_disclosed' };
    if (amt === '') return { state: 'provided', value: { amount: NaN, frequency: freq } };
    return { state: 'provided', value: { amount: Number(amt), frequency: freq } };
  })();

  /* ---- mixed components ---- */
  const mixedComponents: CanonicalMixedPayComponent[] = mixedRelevant
    ? state.mixed_pay_components.map((c) => {
        const blank = c.amount.trim() === '';
        const amountDisc: Disclosure<CanonicalRecurringAmount> = (() => {
          if (blank && c.frequency == null) return { state: 'not_disclosed' };
          if (blank) return { state: 'provided', value: { amount: NaN, frequency: c.frequency } };
          return { state: 'provided', value: { amount: Number(c.amount), frequency: c.frequency } };
        })();
        return { label: c.label, amount: amountDisc };
      })
    : [];

  /* ---- costs / escrow ---- */
  const insurance = recurringDisc(state.insurance_amount, state.insurance_frequency, costBearing);
  const maintenance = recurringDisc(state.maintenance_amount, state.maintenance_frequency, costBearing);
  const otherRecurringCost = recurringDisc(state.other_cost_amount, state.other_cost_frequency, costBearing);
  const lease = recurringDisc(state.lease_amount, state.lease_frequency, leaseRelevant);

  let escrowRequired: Disclosure<boolean>;
  let escrowAmount: Disclosure<CanonicalRecurringAmount>;
  if (!costBearing) {
    escrowRequired = { state: 'not_applicable' };
    escrowAmount = { state: 'not_applicable' };
  } else if (state.escrow_required_state === 'required') {
    escrowRequired = { state: 'provided', value: true };
    escrowAmount = recurringDisc(state.escrow_amount, state.escrow_frequency, true);
  } else if (state.escrow_required_state === 'not_required') {
    escrowRequired = { state: 'provided', value: false };
    escrowAmount = { state: 'not_applicable' };
  } else {
    escrowRequired = { state: 'not_disclosed' };
    escrowAmount = { state: 'not_disclosed' };
  }

  /* ---- one-time incentives ---- */
  const signOnBonus: Disclosure<number> = (() => {
    const t = state.sign_on_bonus.trim();
    if (t === '') return { state: 'not_disclosed' };
    return { state: 'provided', value: Number(t) };
  })();

  /* ---- financial estimate (reuse Phase 1L-C) ---- */
  const financialEstimate = calculateCanonicalOpportunityFinancials(
    buildCanonicalFinancialInput(state),
  );

  /* ---- hiring area ---- */
  const displayLabel = hiringAreaDisplay(state.hiring_city, state.hiring_state, state.hiring_states);
  const statesDisc: Disclosure<string[]> =
    state.hiring_states.length > 0
      ? { state: 'provided', value: state.hiring_states.slice() }
      : { state: 'not_disclosed' };

  /* ---- trust ---- */
  const recruiterVerification = mapRecruiterVerification(source.recruiter ?? null);
  const publishedAt: Disclosure<string> = source.published_at
    ? { state: 'provided', value: source.published_at }
    : { state: 'not_disclosed' };

  const canonical: CanonicalOpportunity = {
    sourceVersion: source.canonical_version === 1 ? 'canonical_v1' : 'legacy',
    identity: {
      id: source.id,
      recruiterId: source.recruiter_id,
      title: state.title,
      companyName: state.company_name.trim() === ''
        ? { state: 'not_disclosed' }
        : { state: 'provided', value: state.company_name.trim() },
    },
    classification: {
      employmentModel,
      teamConfiguration: state.team_configuration,
      routeType: strDisc(state.route_type, true),
      trailerType: strDisc(state.trailer_type, true),
    },
    hiringArea: {
      city: strDisc(state.hiring_city, true),
      state: strDisc(state.hiring_state, true),
      states: statesDisc,
      displayLabel,
    },
    compensation: {
      payModel,
      recurringPay: {
        cpm: numDiscFromStr(state.cpm, cpmRelevant),
        percentage: pctDisc,
        flatWeekly: numDiscFromStr(state.flat_weekly_pay, flatRelevant),
        salary: salaryDisc,
        mixedComponents,
        otherMethod: {
          label: strDisc(state.other_pay_method_label, otherRelevant),
          weeklyGross: numDiscFromStr(state.other_weekly_gross, otherRelevant),
        },
        recruiterProvidedWeeklyGross: numDiscFromStr(state.recruiter_provided_weekly_gross, true),
      },
      oneTimeIncentives: { signOnBonus },
      mileage: {
        totalWeeklyMiles: numDiscFromStr(state.estimated_weekly_miles, totalMilesRelevant),
        loadedWeeklyMiles: numDiscFromStr(state.estimated_loaded_miles, loadedMilesRelevant),
        deadheadWeeklyMiles: numDiscFromStr(state.estimated_deadhead_miles, deadheadMilesRelevant),
        deadheadPaid: boolDiscFromYNU(state.deadhead_paid, deadheadPaidRelevant),
      },
      accessorialPay: {
        detention: strDisc(state.detention_pay, true),
        layover: strDisc(state.layover_pay, true),
      },
    },
    operatingTerms: {
      homeTime: strDisc(state.home_time, true),
      forcedDispatch: boolDiscFromYNU(state.forced_dispatch, true),
      petsAllowed: boolDiscFromYNU(state.pets_allowed, true),
      ridersAllowed: boolDiscFromYNU(state.riders_allowed, true),
      equipmentYear: strDisc(state.equipment_year, true),
    },
    costs: {
      fuelPaidBy: strDisc(state.fuel_paid_by, costBearing),
      insurance,
      maintenance,
      otherRecurringCost,
      lease,
      escrowRequired,
      escrowAmount,
    },
    content: {
      description: strDisc(state.description, true),
      typicalLanes: strDisc(state.typical_lanes, true),
      requirements: strDisc(state.requirements, true),
      actualBenefits: strDisc(state.actual_benefits, true),
    },
    trust: {
      lifecycleStatus: source.status,
      internalReviewStatus: source.admin_review_status,
      publishedAt,
      featured: source.featured === true,
      recruiterVerification,
    },
    derived: {
      // filled below to close reference cycle cleanly
      financialEstimate,
      transparencyScore: {
        score: 0,
        band: 'sparse',
        missingRelevantFields: [],
        conflicts: [],
        notes: [],
      },
    },
  };

  canonical.derived.transparencyScore = calculateListingTransparency(canonical);
  // isCompany used implicitly for readability; retained to signal intent.
  void isCompany;
  return canonical;
}

/* ========================== listing transparency ========================== */

// Types accepted by the transparency calculator. Accept any object with the
// canonical shape sans transparencyScore so it can be safely called from
// within `normalizeOpportunity` before `transparencyScore` is finalized.
type CanonicalBase = CanonicalOpportunity;

export function calculateListingTransparency(canonicalBase: CanonicalBase): ListingTransparency {
  const missing = new Set<string>();
  const notes: string[] = [
    'Listing transparency measures disclosure completeness and consistency, not profitability.',
  ];
  if (canonicalBase.sourceVersion === 'legacy') {
    notes.push('Legacy opportunity row; some canonical fields may be inferred from stored legacy columns.');
  }

  const checklist: { key: string; complete: boolean }[] = [];
  const add = (key: string, complete: boolean): void => {
    checklist.push({ key, complete });
    if (!complete) missing.add(key);
  };

  const c = canonicalBase;

  // Universal
  add('companyName', c.identity.companyName.state === 'provided');
  add('employmentModel', c.classification.employmentModel !== 'unknown');
  add('teamConfiguration', c.classification.teamConfiguration !== 'unspecified');
  add('routeType', c.classification.routeType.state === 'provided');
  add('trailerType', c.classification.trailerType.state === 'provided');
  add('hiringArea', c.hiringArea.displayLabel !== 'Hiring area not disclosed');
  add('description', c.content.description.state === 'provided');
  add('homeTime', c.operatingTerms.homeTime.state === 'provided');
  add('forcedDispatch', c.operatingTerms.forcedDispatch.state === 'provided');
  add('petsAllowed', c.operatingTerms.petsAllowed.state === 'provided');
  add('ridersAllowed', c.operatingTerms.ridersAllowed.state === 'provided');
  add('equipmentYear', c.operatingTerms.equipmentYear.state === 'provided');
  add('typicalLanes', c.content.typicalLanes.state === 'provided');
  add('requirements', c.content.requirements.state === 'provided');
  add('actualBenefits', c.content.actualBenefits.state === 'provided');

  // Pay-model additions
  const pm = c.compensation.payModel;
  const rp = c.compensation.recurringPay;
  if (pm === 'cpm') {
    add('cpm', rp.cpm.state === 'provided');
    add('totalWeeklyMiles', c.compensation.mileage.totalWeeklyMiles.state === 'provided');
    add('loadedWeeklyMiles', c.compensation.mileage.loadedWeeklyMiles.state === 'provided');
    add('deadheadPaid', c.compensation.mileage.deadheadPaid.state === 'provided');
  } else if (pm === 'percentage') {
    const pct = rp.percentage;
    if (pct.state === 'provided') {
      const v = pct.value;
      add('percentageRate', isFin(v.rate) && v.rate > 0);
      add('percentageBasisLabel', typeof v.basisLabel === 'string' && v.basisLabel.trim() !== '');
      add('percentageWeeklyRevenueBasis', isFin(v.weeklyRevenueBasis) && (v.weeklyRevenueBasis as number) > 0);
    } else {
      add('percentageRate', false);
      add('percentageBasisLabel', false);
      add('percentageWeeklyRevenueBasis', false);
    }
  } else if (pm === 'flat_weekly') {
    add('flatWeeklyPay', rp.flatWeekly.state === 'provided');
  } else if (pm === 'salary') {
    const sal = rp.salary;
    if (sal.state === 'provided') {
      add('salaryAmount', isFin(sal.value.amount) && sal.value.amount > 0);
      add('salaryFrequency', sal.value.frequency != null);
    } else {
      add('salaryAmount', false);
      add('salaryFrequency', false);
    }
  } else if (pm === 'mixed') {
    const completeComponents = rp.mixedComponents.filter((cmp) => {
      if (cmp.amount.state !== 'provided') return false;
      const { amount, frequency } = cmp.amount.value;
      if (!cmp.label || cmp.label.trim() === '') return false;
      if (!isFin(amount) || amount < 0) return false;
      if (frequency == null) return false;
      return true;
    });
    add('mixedComponents', completeComponents.length >= 2);
  } else if (pm === 'other') {
    add('otherPayMethodLabel', rp.otherMethod.label.state === 'provided');
    add('otherWeeklyGross', rp.otherMethod.weeklyGross.state === 'provided');
  } else {
    // unknown
    add('payModel', false);
  }

  // Cost-bearing additions
  const em = c.classification.employmentModel;
  if (em === 'contractor_1099' || em === 'owner_operator' || em === 'lease_purchase') {
    add('fuelPaidBy', c.costs.fuelPaidBy.state === 'provided');
    add('insurance', isRecurringComplete(c.costs.insurance));
    add('maintenance', isRecurringComplete(c.costs.maintenance));
    add('otherRecurringCost', isRecurringComplete(c.costs.otherRecurringCost));
    add('escrowRequired', c.costs.escrowRequired.state === 'provided');
    if (em === 'lease_purchase') {
      add('leasePayment', isRecurringComplete(c.costs.lease));
    }
    if (
      c.costs.escrowRequired.state === 'provided' &&
      c.costs.escrowRequired.value === true
    ) {
      add('escrowAmount', isRecurringComplete(c.costs.escrowAmount));
    }
  }

  // Base score
  const total = checklist.length;
  const complete = checklist.filter((x) => x.complete).length;
  const basePct = total > 0 ? Math.round((complete / total) * 100) : 0;

  // Conflict penalty (from canonical financial estimate). 15 each, capped at 30.
  const conflictArr = c.derived.financialEstimate.conflicts.slice().sort((a, b) => a.localeCompare(b));
  const penalty = Math.min(conflictArr.length * 15, 30);

  const score = Math.max(0, Math.min(100, basePct - penalty));

  const band: ListingTransparencyBand =
    score >= 90 ? 'complete'
      : score >= 75 ? 'mostly_complete'
        : score >= 50 ? 'partial'
          : 'sparse';

  const missingSorted = Array.from(missing).sort((a, b) => a.localeCompare(b));

  return {
    score,
    band,
    missingRelevantFields: missingSorted,
    conflicts: conflictArr,
    notes,
  };
}
