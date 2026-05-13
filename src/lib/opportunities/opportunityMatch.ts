/**
 * Opportunity Match Engine — Phase 9
 *
 * Pure, deterministic matching layer. No AI, no DB, no mutation.
 * Scores how well a single opportunity fits a single driver profile,
 * given pre-computed opportunity financials. All logic is explainable.
 */

import type { Tables } from '@/integrations/supabase/types';
import type { OpportunityFinancials } from './opportunityProfit';

type OpportunityRow = Tables<'opportunities'>;
type DriverProfileRow = Tables<'driver_opportunity_profiles'>;

/** Subset of opportunity fields the match engine reads. */
export type MatchOpportunity = Pick<
  OpportunityRow,
  | 'route_type'
  | 'driver_type'
  | 'trailer_type'
  | 'deadhead_paid'
  | 'lease_payment'
  | 'insurance_deductions'
  | 'maintenance_deductions'
  | 'other_deductions'
> & {
  // Forward-compatible: some opportunities may carry an experience requirement.
  min_years_experience?: number | null;
};

/** Subset of the driver profile the match engine reads. */
export type MatchDriverProfile = Pick<
  DriverProfileRow,
  | 'preferred_route_type'
  | 'preferred_driver_type'
  | 'trailer_experience'
  | 'min_weekly_gross'
  | 'min_weekly_net'
  | 'min_effective_rpm'
  | 'years_experience'
>;

export type MatchTier = 'excellent' | 'strong' | 'possible' | 'weak';

export interface OpportunityMatchBreakdown {
  payProfit: number;
  routeType: number;
  driverType: number;
  trailer: number;
  deadhead: number;
  leaseDeductions: number;
  experience: number;
}

export interface OpportunityMatch {
  matchScore: number;
  matchTier: MatchTier;
  reasons: string[];
  warnings: string[];
  breakdown: OpportunityMatchBreakdown;
  hasSevereWarning: boolean;
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const norm = (v: unknown): string =>
  String(v ?? '').trim().toLowerCase();

const tierFor = (score: number): MatchTier => {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'strong';
  if (score >= 50) return 'possible';
  return 'weak';
};

export function tierLabel(tier: MatchTier): string {
  switch (tier) {
    case 'excellent': return 'Excellent Fit';
    case 'strong': return 'Strong Fit';
    case 'possible': return 'Possible Fit';
    case 'weak': return 'Weak Fit';
  }
}

export interface CalculateMatchInput {
  opportunity: MatchOpportunity;
  driverProfile: MatchDriverProfile;
  opportunityFinancials: OpportunityFinancials;
}

export function calculateOpportunityMatch({
  opportunity,
  driverProfile,
  opportunityFinancials: f,
}: CalculateMatchInput): OpportunityMatch {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const breakdown: OpportunityMatchBreakdown = {
    payProfit: 0,
    routeType: 0,
    driverType: 0,
    trailer: 0,
    deadhead: 0,
    leaseDeductions: 0,
    experience: 0,
  };
  let score = 50;

  // ===== Pay / Profit Fit =====
  const minNet = num(driverProfile.min_weekly_net);
  const minGross = num(driverProfile.min_weekly_gross);
  const minRpm = num(driverProfile.min_effective_rpm);

  if (f.estimatedNet != null && minNet != null) {
    if (f.estimatedNet >= minNet) {
      score += 20; breakdown.payProfit += 20;
      reasons.push('Estimated net exceeds your weekly target');
    } else {
      warnings.push('Estimated net may fall below your weekly net goal');
    }
  }
  if (f.estimatedGross != null && minGross != null) {
    if (f.estimatedGross >= minGross) {
      score += 10; breakdown.payProfit += 10;
      reasons.push('Estimated gross meets your weekly gross target');
    } else {
      warnings.push('Estimated gross may fall below your weekly gross goal');
    }
  }
  if (f.netRpm != null && f.netRpm >= 1.75) {
    score += 10; breakdown.payProfit += 10;
    reasons.push('Strong net RPM');
  }
  if (f.effectiveRpm != null && f.effectiveRpm >= 2.0) {
    score += 5; breakdown.payProfit += 5;
    reasons.push('Strong effective RPM');
  }
  if (minRpm != null && f.effectiveRpm != null && f.effectiveRpm < minRpm) {
    warnings.push('Effective RPM is below your minimum RPM target');
  }

  // ===== Route Type Match =====
  const oppRoute = norm(opportunity.route_type);
  const driverRoute = norm(driverProfile.preferred_route_type);
  if (oppRoute && driverRoute && oppRoute === driverRoute) {
    score += 10; breakdown.routeType += 10;
    reasons.push('Matches your preferred route type');
  }

  // ===== Driver Type Match =====
  const oppDriver = norm(opportunity.driver_type);
  const driverPref = norm(driverProfile.preferred_driver_type);
  if (oppDriver && driverPref && oppDriver === driverPref) {
    score += 10; breakdown.driverType += 10;
    reasons.push('Matches your preferred driver type');
  }

  // ===== Trailer Match =====
  const oppTrailer = norm(opportunity.trailer_type);
  const trailerExp = (driverProfile.trailer_experience ?? []).map(norm).filter(Boolean);
  if (oppTrailer && trailerExp.length > 0 && trailerExp.includes(oppTrailer)) {
    score += 5; breakdown.trailer += 5;
    reasons.push('Trailer type aligns with your experience');
  }

  // ===== Deadhead Logic =====
  if (f.hasUnpaidDeadhead) {
    score -= 15; breakdown.deadhead -= 15;
    warnings.push('Deadhead appears unpaid');
  } else if (f.hasUnknownDeadheadPay) {
    score -= 5; breakdown.deadhead -= 5;
    warnings.push('Deadhead pay is not disclosed');
  }
  if (f.deadheadPercentage != null && f.deadheadPercentage > 25) {
    score -= 10; breakdown.deadhead -= 10;
    warnings.push('Deadhead percentage is high');
  }

  // ===== Lease / Deduction Risk =====
  const lease = num(opportunity.lease_payment) ?? 0;
  if (lease > 0) {
    score -= 10; breakdown.leaseDeductions -= 10;
    warnings.push('Lease payment detected');
  }
  if (f.totalKnownDeductions > 700) {
    score -= 10; breakdown.leaseDeductions -= 10;
    warnings.push('High deduction risk');
  }

  // ===== Experience Fit =====
  const driverYears = num(driverProfile.years_experience);
  const requiredYears = num(opportunity.min_years_experience);
  if (requiredYears != null && driverYears != null) {
    if (driverYears >= requiredYears) {
      score += 5; breakdown.experience += 5;
      reasons.push('You meet the experience requirement');
    } else {
      score -= 20; breakdown.experience -= 20;
      warnings.push('Experience requirement may not match');
    }
  } else if (driverYears != null && driverYears >= 2) {
    score += 5; breakdown.experience += 5;
  }

  // ===== Clamp =====
  const matchScore = Math.max(0, Math.min(100, Math.round(score)));
  const matchTier = tierFor(matchScore);

  const hasSevereWarning =
    f.hasUnpaidDeadhead ||
    f.totalKnownDeductions > 700 ||
    (requiredYears != null && driverYears != null && driverYears < requiredYears);

  return { matchScore, matchTier, reasons, warnings, breakdown, hasSevereWarning };
}
