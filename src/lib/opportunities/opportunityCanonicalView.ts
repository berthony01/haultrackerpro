// Phase 1L-F1 — Canonical driver-facing view model and listing transparency.
//
// This module is the sole raw opportunity-row → canonical read-model boundary.
// It reuses (never duplicates) the Phase 1L-DE1 authoring normalizer and the
// Phase 1L-C canonical financial calculator. All financial disclosures are
// sourced from the single `buildCanonicalFinancialInput(state)` result so the
// view can never diverge from the calculator's contract. Non-financial
// disclosures (fuel responsibility, "Other" pay label, operating terms,
// content) continue to normalize from authoring state.

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
} from './opportunityProfit';

export type {
  Disclosure,
  CanonicalRecurringAmount,
  CanonicalMixedPayComponent,
  CanonicalOpportunityFinancialEstimate,
  CanonicalEmploymentModel,
  CanonicalPayModel,
};

/* ============================== source shape ============================== */

export type OpportunitySourceRow = Tables<'opportunities'> & {
  recruiter?: {
    verification_status?: string | null;
    status?: string | null;
  } | null;
};

type RecruiterVerification =
  | 'approved'
  | 'suspended'
  | 'pending'
  | 'rejected'
  | 'none';

/* ============================ canonical shape ============================= */

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
    payModel: CanonicalPayModel;
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

const isFin = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);

function strDisc(value: string, relevant: boolean): Disclosure<string> {
  if (!relevant) return { state: 'not_applicable' };
  const t = value.trim();
  if (t === '') return { state: 'not_disclosed' };
  return { state: 'provided', value: t };
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

// Wrap an already-built financial-input disclosure with view-side relevance.
// Never re-parses raw source values.
function naIfIrrelevant<T>(d: Disclosure<T>, relevant: boolean): Disclosure<T> {
  return relevant ? d : { state: 'not_applicable' };
}

function hiringAreaDisplay(
  city: string,
  state: string,
  filteredStates: string[],
): string {
  const c = city.trim();
  const s = state.trim();
  if (c && s) return `${c}, ${s}`;
  if (filteredStates.length > 0) return filteredStates.join(', ');
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

/* ============================== normalize ================================= */

export function normalizeOpportunity(source: OpportunitySourceRow): CanonicalOpportunity {
  const state: CanonicalOpportunityAuthoringState = normalizeOpportunityForAuthoring(source);
  const financialInput = buildCanonicalFinancialInput(state);
  const financialEstimate = calculateCanonicalOpportunityFinancials(financialInput);

  const employmentModel: CanonicalEmploymentModel =
    state.employment_model === 'unknown' ? 'unknown' : state.employment_model;
  const leaseRelevant = employmentModel === 'lease_purchase';
  const costBearing =
    employmentModel === 'contractor_1099' ||
    employmentModel === 'owner_operator' ||
    leaseRelevant;

  const payModel: CanonicalPayModel = state.pay_model;
  const otherRelevant = payModel === 'other';

  // Mileage view relevance — wraps calculator-input disclosures.
  const anyMileageProvided =
    financialInput.totalWeeklyMiles.state === 'provided' ||
    financialInput.loadedWeeklyMiles.state === 'provided' ||
    financialInput.deadheadWeeklyMiles.state === 'provided';
  const payUsesMiles = payModel === 'cpm' || payModel === 'percentage';
  const totalMilesRelevant = payUsesMiles;
  const loadedMilesRelevant = payModel === 'cpm';
  const deadheadMilesRelevant = payUsesMiles || anyMileageProvided;
  const deadheadPaidRelevant = payUsesMiles;

  // Escrow amount view relevance — cost-bearing AND explicitly required.
  const escrowExplicitlyRequired =
    financialInput.costs.escrowRequired.state === 'provided' &&
    financialInput.costs.escrowRequired.value === true;
  const escrowAmountRelevant = costBearing && escrowExplicitlyRequired;

  // Sign-on bonus — sourced from calculator input's one-time incentives.
  const signOnBonus: Disclosure<number> =
    financialInput.oneTimeIncentives.length > 0
      ? financialInput.oneTimeIncentives[0].amount
      : { state: 'not_disclosed' };

  // Hiring area — trim + filter blanks once, use everywhere.
  const filteredStates = state.hiring_states
    .map((x) => (x ?? '').trim())
    .filter((x) => x !== '');
  const statesDisc: Disclosure<string[]> =
    filteredStates.length > 0
      ? { state: 'provided', value: filteredStates.slice() }
      : { state: 'not_disclosed' };
  const displayLabel = hiringAreaDisplay(state.hiring_city, state.hiring_state, filteredStates);

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
      companyName:
        state.company_name.trim() === ''
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
        cpm: financialInput.cpm,
        percentage: financialInput.percentage,
        flatWeekly: financialInput.flatWeeklyPay,
        salary: financialInput.salary,
        mixedComponents: financialInput.mixedComponents,
        otherMethod: {
          label: strDisc(state.other_pay_method_label, otherRelevant),
          weeklyGross: financialInput.otherWeeklyGross,
        },
        recruiterProvidedWeeklyGross: financialInput.recruiterProvidedWeeklyGross,
      },
      oneTimeIncentives: { signOnBonus },
      mileage: {
        totalWeeklyMiles: naIfIrrelevant(financialInput.totalWeeklyMiles, totalMilesRelevant),
        loadedWeeklyMiles: naIfIrrelevant(financialInput.loadedWeeklyMiles, loadedMilesRelevant),
        deadheadWeeklyMiles: naIfIrrelevant(financialInput.deadheadWeeklyMiles, deadheadMilesRelevant),
        deadheadPaid: naIfIrrelevant(financialInput.deadheadPaid, deadheadPaidRelevant),
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
      insurance: financialInput.costs.insurance,
      maintenance: financialInput.costs.maintenance,
      otherRecurringCost: financialInput.costs.other,
      lease: financialInput.costs.lease,
      escrowRequired: financialInput.costs.escrowRequired,
      escrowAmount: naIfIrrelevant(financialInput.costs.escrowAmount, escrowAmountRelevant),
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
  return canonical;
}

/* ========================== listing transparency ========================== */

const strComplete = (d: Disclosure<string>): boolean =>
  d.state === 'provided' && typeof d.value === 'string' && d.value.trim() !== '';

const boolComplete = (d: Disclosure<boolean>): boolean => d.state === 'provided';

const numPosComplete = (d: Disclosure<number>): boolean =>
  d.state === 'provided' && isFin(d.value) && d.value > 0;

const recurringComplete = (d: Disclosure<CanonicalRecurringAmount>): boolean => {
  if (d.state !== 'provided') return false;
  const { amount, frequency } = d.value;
  if (!isFin(amount) || amount < 0) return false;
  if (frequency == null) return false;
  return true;
};

export function calculateListingTransparency(canonical: CanonicalOpportunity): ListingTransparency {
  const missing = new Set<string>();
  const notes: string[] = [
    'Listing transparency measures disclosure completeness and consistency, not profitability.',
  ];
  if (canonical.sourceVersion === 'legacy') {
    notes.push('Legacy opportunity row; some canonical disclosures may be unavailable.');
  }

  const checklist: { key: string; complete: boolean }[] = [];
  const add = (key: string, complete: boolean): void => {
    checklist.push({ key, complete });
    if (!complete) missing.add(key);
  };

  const c = canonical;

  /* --- Universal --- */
  add('companyName', strComplete(c.identity.companyName));
  add('employmentModel', c.classification.employmentModel !== 'unknown');
  add('teamConfiguration', c.classification.teamConfiguration !== 'unspecified');
  add('routeType', strComplete(c.classification.routeType));
  add('trailerType', strComplete(c.classification.trailerType));
  const hiringComplete =
    (strComplete(c.hiringArea.city) && strComplete(c.hiringArea.state)) ||
    (c.hiringArea.states.state === 'provided' && c.hiringArea.states.value.length > 0);
  add('hiringArea', hiringComplete);
  add('description', strComplete(c.content.description));
  add('homeTime', strComplete(c.operatingTerms.homeTime));
  add('forcedDispatch', boolComplete(c.operatingTerms.forcedDispatch));
  add('petsAllowed', boolComplete(c.operatingTerms.petsAllowed));
  add('ridersAllowed', boolComplete(c.operatingTerms.ridersAllowed));
  add('equipmentYear', strComplete(c.operatingTerms.equipmentYear));
  add('typicalLanes', strComplete(c.content.typicalLanes));
  add('requirements', strComplete(c.content.requirements));
  add('actualBenefits', strComplete(c.content.actualBenefits));

  /* --- Pay-model additions --- */
  const pm = c.compensation.payModel;
  const rp = c.compensation.recurringPay;
  if (pm === 'cpm') {
    add('cpm', numPosComplete(rp.cpm));
    add('totalWeeklyMiles', numPosComplete(c.compensation.mileage.totalWeeklyMiles));
    add('loadedWeeklyMiles', numPosComplete(c.compensation.mileage.loadedWeeklyMiles));
    add('deadheadPaid', boolComplete(c.compensation.mileage.deadheadPaid));
  } else if (pm === 'percentage') {
    if (rp.percentage.state === 'provided') {
      const v = rp.percentage.value;
      add('percentageRate', isFin(v.rate) && v.rate > 0);
      add(
        'percentageBasisLabel',
        typeof v.basisLabel === 'string' && v.basisLabel.trim() !== '',
      );
      add(
        'percentageWeeklyRevenueBasis',
        isFin(v.weeklyRevenueBasis) && (v.weeklyRevenueBasis as number) > 0,
      );
    } else {
      add('percentageRate', false);
      add('percentageBasisLabel', false);
      add('percentageWeeklyRevenueBasis', false);
    }
  } else if (pm === 'flat_weekly') {
    add('flatWeeklyPay', numPosComplete(rp.flatWeekly));
  } else if (pm === 'salary') {
    if (rp.salary.state === 'provided') {
      const s = rp.salary.value;
      add('salaryAmount', isFin(s.amount) && s.amount > 0);
      add('salaryFrequency', s.frequency != null);
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
    add('otherPayMethodLabel', strComplete(rp.otherMethod.label));
    add('otherWeeklyGross', numPosComplete(rp.otherMethod.weeklyGross));
  } else {
    // unknown
    add('payModel', false);
  }

  /* --- Cost-bearing additions --- */
  const em = c.classification.employmentModel;
  if (em === 'contractor_1099' || em === 'owner_operator' || em === 'lease_purchase') {
    add('fuelPaidBy', strComplete(c.costs.fuelPaidBy));
    add('insurance', recurringComplete(c.costs.insurance));
    add('maintenance', recurringComplete(c.costs.maintenance));
    add('otherRecurringCost', recurringComplete(c.costs.otherRecurringCost));
    add('escrowRequired', boolComplete(c.costs.escrowRequired));
    if (em === 'lease_purchase') {
      add('leasePayment', recurringComplete(c.costs.lease));
    }
    if (
      c.costs.escrowRequired.state === 'provided' &&
      c.costs.escrowRequired.value === true
    ) {
      add('escrowAmount', recurringComplete(c.costs.escrowAmount));
    }
  }

  /* --- Score --- */
  const total = checklist.length;
  const completeCount = checklist.filter((x) => x.complete).length;
  const basePct = total > 0 ? Math.round((completeCount / total) * 100) : 0;

  // Conflict deduplication + capped penalty.
  const conflictArr = Array.from(new Set(c.derived.financialEstimate.conflicts))
    .sort((a, b) => a.localeCompare(b));
  const penalty = Math.min(conflictArr.length * 15, 30);

  const score = Math.max(0, Math.min(100, basePct - penalty));

  const band: ListingTransparencyBand =
    score >= 90
      ? 'complete'
      : score >= 75
        ? 'mostly_complete'
        : score >= 50
          ? 'partial'
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
