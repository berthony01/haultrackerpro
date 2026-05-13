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
