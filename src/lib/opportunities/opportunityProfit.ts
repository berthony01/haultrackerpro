/**
 * Opportunity Profit Intelligence
 *
 * Pure, deterministic calculations for the Opportunities profit layer.
 * No AI, no DB, no mutation. Recruiter-provided estimates only — never
 * presented as guaranteed pay.
 */

import type { Tables } from '@/integrations/supabase/types';

export type OpportunityLike = Pick<
  Tables<'opportunities'>,
  | 'estimated_weekly_gross'
  | 'flat_weekly_pay'
  | 'cpm'
  | 'percentage_pay'
  | 'estimated_weekly_miles'
  | 'estimated_loaded_miles'
  | 'estimated_deadhead_miles'
  | 'deadhead_paid'
  | 'insurance_deductions'
  | 'escrow_amount'
  | 'escrow_required'
  | 'lease_payment'
  | 'maintenance_deductions'
  | 'other_deductions'
>;

export interface OpportunityFinancials {
  estimatedGross: number | null;
  estimatedWeeklyMiles: number | null;
  estimatedLoadedMiles: number | null;
  estimatedDeadheadMiles: number | null;
  totalKnownDeductions: number;
  estimatedNet: number | null;
  grossPerMile: number | null;
  effectiveRpm: number | null;
  netRpm: number | null;
  deadheadPercentage: number | null;
  hasUnpaidDeadhead: boolean;
  hasUnknownDeadheadPay: boolean;
  hasLeaseRisk: boolean;
  hasHighDeductionRisk: boolean;
  missingPayData: boolean;
  profitScore: number;
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const numOr0 = (v: unknown): number => num(v) ?? 0;

export function calculateOpportunityFinancials(
  o: OpportunityLike | null | undefined
): OpportunityFinancials {
  const empty: OpportunityFinancials = {
    estimatedGross: null,
    estimatedWeeklyMiles: null,
    estimatedLoadedMiles: null,
    estimatedDeadheadMiles: null,
    totalKnownDeductions: 0,
    estimatedNet: null,
    grossPerMile: null,
    effectiveRpm: null,
    netRpm: null,
    deadheadPercentage: null,
    hasUnpaidDeadhead: false,
    hasUnknownDeadheadPay: false,
    hasLeaseRisk: false,
    hasHighDeductionRisk: false,
    missingPayData: true,
    profitScore: 0,
  };
  if (!o) return empty;

  const weeklyMiles = num(o.estimated_weekly_miles);
  const loadedMiles = num(o.estimated_loaded_miles);
  const deadheadMiles = num(o.estimated_deadhead_miles);
  const cpm = num(o.cpm);
  const flatWeekly = num(o.flat_weekly_pay);
  const weeklyGross = num(o.estimated_weekly_gross);
  const percentage = num(o.percentage_pay);

  // Estimated gross precedence
  let estimatedGross: number | null = null;
  if (weeklyGross != null) estimatedGross = weeklyGross;
  else if (flatWeekly != null) estimatedGross = flatWeekly;
  else if (cpm != null && loadedMiles != null) estimatedGross = cpm * loadedMiles;

  // percentage_pay alone cannot derive gross
  const missingPayData =
    estimatedGross == null && (percentage != null || (cpm != null && loadedMiles == null));
  const noPayAtAll = estimatedGross == null && percentage == null && cpm == null && flatWeekly == null;

  const totalKnownDeductions =
    numOr0(o.insurance_deductions) +
    numOr0(o.escrow_amount) +
    numOr0(o.lease_payment) +
    numOr0(o.maintenance_deductions) +
    numOr0(o.other_deductions);

  const estimatedNet = estimatedGross != null ? estimatedGross - totalKnownDeductions : null;

  const totalMiles =
    weeklyMiles ?? ((loadedMiles ?? 0) + (deadheadMiles ?? 0) || null);

  const grossPerMile =
    estimatedGross != null && loadedMiles != null && loadedMiles > 0
      ? estimatedGross / loadedMiles
      : null;

  const effectiveRpm =
    estimatedGross != null && totalMiles != null && totalMiles > 0
      ? estimatedGross / totalMiles
      : null;

  const netRpm =
    estimatedNet != null && totalMiles != null && totalMiles > 0
      ? estimatedNet / totalMiles
      : null;

  const deadheadPercentage =
    deadheadMiles != null && totalMiles != null && totalMiles > 0
      ? (deadheadMiles / totalMiles) * 100
      : null;

  const hasUnpaidDeadhead = o.deadhead_paid === false && (deadheadMiles ?? 0) > 0;
  const hasUnknownDeadheadPay = o.deadhead_paid == null && (deadheadMiles ?? 0) > 0;
  const hasLeaseRisk = numOr0(o.lease_payment) > 0;
  const hasHighDeductionRisk = totalKnownDeductions > 500;

  // Profit score (deterministic, 0-100)
  let score = 70;
  if (estimatedNet != null && estimatedNet > 1500) score += 10;
  if (netRpm != null && netRpm >= 1.75) score += 5;
  if (o.deadhead_paid === true) score += 5;
  if (hasUnpaidDeadhead) score -= 10;
  if (totalKnownDeductions > 500) score -= 10;
  if (hasLeaseRisk) score -= 10;
  if (missingPayData || noPayAtAll) score -= 10;
  if (hasUnknownDeadheadPay) score -= 5;
  const profitScore = Math.max(0, Math.min(100, score));

  return {
    estimatedGross,
    estimatedWeeklyMiles: weeklyMiles,
    estimatedLoadedMiles: loadedMiles,
    estimatedDeadheadMiles: deadheadMiles,
    totalKnownDeductions,
    estimatedNet,
    grossPerMile,
    effectiveRpm,
    netRpm,
    deadheadPercentage,
    hasUnpaidDeadhead,
    hasUnknownDeadheadPay,
    hasLeaseRisk,
    hasHighDeductionRisk,
    missingPayData: missingPayData || noPayAtAll,
    profitScore,
  };
}

export function profitScoreLabel(score: number): { label: string; tone: 'success' | 'primary' | 'warn' | 'destructive' } {
  if (score >= 80) return { label: 'Strong', tone: 'success' };
  if (score >= 65) return { label: 'Solid', tone: 'primary' };
  if (score >= 45) return { label: 'Mixed', tone: 'warn' };
  return { label: 'Risky', tone: 'destructive' };
}

// ============================================================================
// Phase 1L-C — Canonical Opportunity Financial Calculation API
// Additive. Does not alter legacy calculateOpportunityFinancials behavior.
// See docs/PHASE_1L_OPPORTUNITY_CANONICAL_CONTRACT.md
// ============================================================================

export type Disclosure<T> =
  | { state: 'provided'; value: T }
  | { state: 'not_disclosed' }
  | { state: 'not_applicable' };

export type CanonicalEmploymentModel =
  | 'company_driver'
  | 'contractor_1099'
  | 'owner_operator'
  | 'lease_purchase'
  | 'unknown';

export type CanonicalPayModel =
  | 'cpm'
  | 'percentage'
  | 'flat_weekly'
  | 'salary'
  | 'mixed'
  | 'other'
  | 'unknown';

export type RecurringFrequency = 'weekly' | 'biweekly' | 'monthly' | 'annual';

export interface CanonicalRecurringAmount {
  amount: number;
  frequency: RecurringFrequency | null;
}

export interface CanonicalMixedPayComponent {
  label: string;
  amount: Disclosure<CanonicalRecurringAmount>;
}

export interface CanonicalOneTimeIncentive {
  label: string;
  amount: Disclosure<number>;
}

export interface CanonicalOpportunityFinancialInput {
  employmentModel: CanonicalEmploymentModel;
  payModel: CanonicalPayModel;
  cpm: Disclosure<number>;
  percentage: Disclosure<{ rate: number; weeklyRevenueBasis: number | null; basisLabel: string | null }>;
  flatWeeklyPay: Disclosure<number>;
  salary: Disclosure<CanonicalRecurringAmount>;
  mixedComponents: CanonicalMixedPayComponent[];
  otherWeeklyGross: Disclosure<number>;
  recruiterProvidedWeeklyGross: Disclosure<number>;
  totalWeeklyMiles: Disclosure<number>;
  loadedWeeklyMiles: Disclosure<number>;
  deadheadWeeklyMiles: Disclosure<number>;
  deadheadPaid: Disclosure<boolean>;
  costs: {
    insurance: Disclosure<CanonicalRecurringAmount>;
    maintenance: Disclosure<CanonicalRecurringAmount>;
    other: Disclosure<CanonicalRecurringAmount>;
    lease: Disclosure<CanonicalRecurringAmount>;
    escrowRequired: Disclosure<boolean>;
    escrowAmount: Disclosure<CanonicalRecurringAmount>;
  };
  oneTimeIncentives: CanonicalOneTimeIncentive[];
}

export interface CanonicalOpportunityFinancialEstimate {
  status: 'available' | 'incomplete' | 'not_applicable' | 'conflict';
  recurringWeeklyGross: number | null;
  grossSource: 'derived' | 'recruiter_provided' | null;
  totalKnownWeeklyCosts: number | null;
  estimatedWeeklyNet: number | null;
  netStatus: 'available' | 'incomplete' | 'not_applicable';
  effectiveRpm: number | null;
  netRpm: number | null;
  deadheadPercentage: number | null;
  oneTimeIncentiveTotal: number;
  assumptions: string[];
  missingInputs: string[];
  invalidInputs: string[];
  conflicts: string[];
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function normalizeRecurringAmountToWeekly(value: CanonicalRecurringAmount): number | null {
  if (!value || value.frequency == null) return null;
  const { amount, frequency } = value;
  if (!isFiniteNumber(amount) || amount < 0) return null;
  switch (frequency) {
    case 'weekly':
      return amount;
    case 'biweekly':
      return amount / 2;
    case 'monthly':
      return (amount * 12) / 52;
    case 'annual':
      return amount / 52;
    default:
      return null;
  }
}

type CostKey = 'insurance' | 'maintenance' | 'other' | 'lease';

const COST_MISSING_LABELS: Record<CostKey, string> = {
  insurance: 'insurance',
  maintenance: 'maintenance',
  other: 'other recurring costs',
  lease: 'lease payment',
};

function relevantCostKeys(model: CanonicalEmploymentModel): CostKey[] {
  switch (model) {
    case 'contractor_1099':
    case 'owner_operator':
      return ['insurance', 'maintenance', 'other'];
    case 'lease_purchase':
      return ['insurance', 'maintenance', 'other', 'lease'];
    default:
      return [];
  }
}

export function calculateCanonicalOpportunityFinancials(
  input: CanonicalOpportunityFinancialInput,
): CanonicalOpportunityFinancialEstimate {
  const missing = new Set<string>();
  const invalid = new Set<string>();
  const conflicts = new Set<string>();
  const assumptions = new Set<string>();

  // -------- Deterministic gross by pay model --------
  let deterministicGross: number | null = null;
  let payModelDeterministicRequired = true;

  const pm = input.payModel;
  if (pm === 'cpm') {
    const cpmOk = input.cpm.state === 'provided' && isFiniteNumber(input.cpm.value) && input.cpm.value > 0;
    const loadedOk =
      input.loadedWeeklyMiles.state === 'provided' &&
      isFiniteNumber(input.loadedWeeklyMiles.value) &&
      input.loadedWeeklyMiles.value > 0;
    if (!cpmOk) {
      if (input.cpm.state === 'provided') invalid.add('cpm');
      else missing.add('cpm');
    }
    if (!loadedOk) {
      if (input.loadedWeeklyMiles.state === 'provided') invalid.add('loadedWeeklyMiles');
      else missing.add('loadedWeeklyMiles');
    }
    if (cpmOk && loadedOk) {
      const cpmVal = (input.cpm as { state: 'provided'; value: number }).value;
      const lmVal = (input.loadedWeeklyMiles as { state: 'provided'; value: number }).value;
      deterministicGross = cpmVal * lmVal;
    }
  } else if (pm === 'percentage') {
    if (input.percentage.state !== 'provided') {
      missing.add('percentage');
    } else {
      const { rate, weeklyRevenueBasis, basisLabel } = input.percentage.value;
      const rateOk = isFiniteNumber(rate) && rate > 0;
      const basisOk = isFiniteNumber(weeklyRevenueBasis) && (weeklyRevenueBasis as number) > 0;
      const labelOk = typeof basisLabel === 'string' && basisLabel.trim() !== '';
      if (!rateOk) invalid.add('percentageRate');
      if (!basisOk) missing.add('percentageWeeklyRevenueBasis');
      if (!labelOk) missing.add('percentageBasisLabel');
      if (rateOk && basisOk && labelOk) {
        deterministicGross = (weeklyRevenueBasis as number) * (rate / 100);
      }
    }
  } else if (pm === 'flat_weekly') {
    if (input.flatWeeklyPay.state === 'provided') {
      if (isFiniteNumber(input.flatWeeklyPay.value) && input.flatWeeklyPay.value > 0) {
        deterministicGross = input.flatWeeklyPay.value;
      } else {
        invalid.add('flatWeeklyPay');
      }
    } else {
      missing.add('flatWeeklyPay');
    }
  } else if (pm === 'salary') {
    if (input.salary.state === 'provided') {
      const s = input.salary.value;
      if (!isFiniteNumber(s.amount) || s.amount <= 0) invalid.add('salaryAmount');
      if (s.frequency == null) missing.add('salaryFrequency');
      const wk = normalizeRecurringAmountToWeekly(s);
      if (wk != null && s.amount > 0) deterministicGross = wk;
    } else {
      missing.add('salary');
    }
  } else if (pm === 'mixed') {
    const complete: number[] = [];
    for (let i = 0; i < input.mixedComponents.length; i += 1) {
      const c = input.mixedComponents[i];
      if (c.amount.state !== 'provided') continue;
      const labelOk = typeof c.label === 'string' && c.label.trim() !== '';
      const amt = c.amount.value;
      const amtOk = isFiniteNumber(amt.amount) && amt.amount >= 0;
      const freqOk = amt.frequency != null;
      if (labelOk && amtOk && freqOk) {
        const wk = normalizeRecurringAmountToWeekly(amt);
        if (wk != null) complete.push(wk);
      } else {
        invalid.add(`mixedComponent[${i}]`);
      }
    }
    if (complete.length < 2) {
      missing.add('mixedComponents');
    } else {
      deterministicGross = complete.reduce((a, b) => a + b, 0);
    }
  } else if (pm === 'other') {
    if (input.otherWeeklyGross.state === 'provided') {
      if (isFiniteNumber(input.otherWeeklyGross.value) && input.otherWeeklyGross.value > 0) {
        deterministicGross = input.otherWeeklyGross.value;
      } else {
        invalid.add('otherWeeklyGross');
      }
    } else {
      missing.add('otherWeeklyGross');
    }
  } else {
    payModelDeterministicRequired = false;
    missing.add('payModel');
  }

  // -------- Recruiter-provided gross and conflict handling --------
  let recruiterGross: number | null = null;
  if (input.recruiterProvidedWeeklyGross.state === 'provided') {
    const v = input.recruiterProvidedWeeklyGross.value;
    if (isFiniteNumber(v) && v > 0) {
      recruiterGross = v;
    } else {
      invalid.add('recruiterProvidedWeeklyGross');
    }
  }

  let recurringWeeklyGross: number | null = null;
  let grossSource: 'derived' | 'recruiter_provided' | null = null;
  let hasConflict = false;

  if (deterministicGross != null) {
    recurringWeeklyGross = deterministicGross;
    grossSource = 'derived';
    if (recruiterGross != null && deterministicGross > 0) {
      const ratio = Math.abs(recruiterGross - deterministicGross) / deterministicGross;
      if (ratio > 0.10) {
        hasConflict = true;
        conflicts.add(
          `Recruiter-provided weekly gross ($${recruiterGross.toFixed(2)}) differs from derived gross ($${deterministicGross.toFixed(2)}) by more than 10%.`,
        );
      }
    }
  } else if (recruiterGross != null) {
    recurringWeeklyGross = recruiterGross;
    grossSource = 'recruiter_provided';
  }

  // -------- Mileage --------
  const totalMilesProvided =
    input.totalWeeklyMiles.state === 'provided' ? input.totalWeeklyMiles.value : null;
  const totalMilesValid = isFiniteNumber(totalMilesProvided) && (totalMilesProvided as number) > 0;
  if (input.totalWeeklyMiles.state === 'provided' && !totalMilesValid) {
    invalid.add('totalWeeklyMiles');
  }

  const deadheadMilesProvided =
    input.deadheadWeeklyMiles.state === 'provided' ? input.deadheadWeeklyMiles.value : null;
  const deadheadMilesValid = isFiniteNumber(deadheadMilesProvided) && (deadheadMilesProvided as number) >= 0;

  const effectiveRpm =
    recurringWeeklyGross != null && totalMilesValid
      ? recurringWeeklyGross / (totalMilesProvided as number)
      : null;

  const deadheadPercentage =
    totalMilesValid && deadheadMilesValid
      ? ((deadheadMilesProvided as number) / (totalMilesProvided as number)) * 100
      : null;

  // -------- Costs & Net --------
  const em = input.employmentModel;
  const costModels: CanonicalEmploymentModel[] = ['contractor_1099', 'owner_operator', 'lease_purchase'];
  const isCostBearing = costModels.includes(em);
  const isCompanyDriver = em === 'company_driver';
  const isUnknownEm = em === 'unknown';

  let totalKnownWeeklyCosts: number | null = null;
  let estimatedWeeklyNet: number | null = null;
  let netStatus: 'available' | 'incomplete' | 'not_applicable' = 'incomplete';

  if (isCompanyDriver) {
    netStatus = 'not_applicable';
    assumptions.add('Company driver: employer-borne operating costs excluded from net.');
  } else if (isUnknownEm) {
    netStatus = 'incomplete';
    missing.add('employmentModel');
  } else if (isCostBearing) {
    const relevant = relevantCostKeys(em);
    let sum = 0;
    let netIncomplete = false;

    // Escrow handling
    const escrowRequired = input.costs.escrowRequired;
    if (escrowRequired.state === 'provided' && escrowRequired.value === true) {
      const ea = input.costs.escrowAmount;
      if (ea.state === 'provided') {
        const wk = normalizeRecurringAmountToWeekly(ea.value);
        if (wk == null) {
          if (!isFiniteNumber(ea.value.amount) || ea.value.amount < 0) invalid.add('escrowAmount');
          else if (ea.value.frequency == null) missing.add('escrowAmountFrequency');
          netIncomplete = true;
        } else {
          sum += wk;
        }
      } else {
        missing.add('escrowAmount');
        netIncomplete = true;
      }
    } else if (escrowRequired.state === 'provided' && escrowRequired.value === false) {
      const ea = input.costs.escrowAmount;
      if (ea.state === 'provided') {
        if (isFiniteNumber(ea.value.amount) && ea.value.amount > 0) {
          hasConflict = true;
          conflicts.add('Escrow marked not required but a positive escrow amount was provided.');
        }
      }
    } else {
      missing.add('escrowRequired');
      netIncomplete = true;
    }

    const costMap: Record<CostKey, Disclosure<CanonicalRecurringAmount>> = {
      insurance: input.costs.insurance,
      maintenance: input.costs.maintenance,
      other: input.costs.other,
      lease: input.costs.lease,
    };

    for (const key of relevant) {
      const disc = costMap[key];
      if (disc.state === 'provided') {
        const wk = normalizeRecurringAmountToWeekly(disc.value);
        if (wk == null) {
          if (!isFiniteNumber(disc.value.amount) || disc.value.amount < 0) invalid.add(`${key}Amount`);
          else if (disc.value.frequency == null) missing.add(`${key}Frequency`);
          netIncomplete = true;
        } else {
          sum += wk;
        }
      } else {
        missing.add(COST_MISSING_LABELS[key]);
        netIncomplete = true;
      }
    }

    if (netIncomplete || recurringWeeklyGross == null) {
      netStatus = 'incomplete';
    } else {
      totalKnownWeeklyCosts = sum;
      estimatedWeeklyNet = recurringWeeklyGross - sum;
      netStatus = 'available';
      assumptions.add('Net is before taxes.');
    }
  } else {
    netStatus = 'incomplete';
  }

  const netRpm =
    estimatedWeeklyNet != null && totalMilesValid
      ? estimatedWeeklyNet / (totalMilesProvided as number)
      : null;

  // -------- One-time incentives --------
  let oneTimeIncentiveTotal = 0;
  for (let i = 0; i < input.oneTimeIncentives.length; i += 1) {
    const inc = input.oneTimeIncentives[i];
    if (inc.amount.state !== 'provided') continue;
    const v = inc.amount.value;
    if (isFiniteNumber(v) && v >= 0) {
      oneTimeIncentiveTotal += v;
    } else {
      invalid.add(`oneTimeIncentive[${i}]`);
    }
  }

  // -------- Overall status --------
  let status: 'available' | 'incomplete' | 'not_applicable' | 'conflict';

  const compensationFieldsAllNA =
    input.cpm.state === 'not_applicable' &&
    input.percentage.state === 'not_applicable' &&
    input.flatWeeklyPay.state === 'not_applicable' &&
    input.salary.state === 'not_applicable' &&
    input.otherWeeklyGross.state === 'not_applicable' &&
    input.recruiterProvidedWeeklyGross.state === 'not_applicable' &&
    input.mixedComponents.length === 0;
  const fullyNotApplicable = pm === 'unknown' && compensationFieldsAllNA;

  if (hasConflict) {
    status = 'conflict';
  } else if (fullyNotApplicable) {
    status = 'not_applicable';
  } else {
    let incomplete = false;
    if (payModelDeterministicRequired && deterministicGross == null) incomplete = true;
    if (isUnknownEm) incomplete = true;
    if (isCostBearing && netStatus === 'incomplete') incomplete = true;
    if (!totalMilesValid && input.totalWeeklyMiles.state === 'provided') incomplete = true;
    if (invalid.size > 0) incomplete = true;
    status = incomplete ? 'incomplete' : 'available';
  }

  const sortDedup = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b));

  return {
    status,
    recurringWeeklyGross,
    grossSource,
    totalKnownWeeklyCosts,
    estimatedWeeklyNet,
    netStatus,
    effectiveRpm,
    netRpm,
    deadheadPercentage,
    oneTimeIncentiveTotal,
    assumptions: sortDedup(assumptions),
    missingInputs: sortDedup(missing),
    invalidInputs: sortDedup(invalid),
    conflicts: sortDedup(conflicts),
  };
}
