import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useCostProfile, computeCostProfileCPM, profileHasUsableData } from '@/hooks/useCostProfile';

export interface ProfitCheckInput {
  pickup_location: string;
  dropoff_location: string;
  loaded_miles: number;
  deadhead_miles: number;
  estimated_pay: number;
  broker_id?: string | null;
}

export type DecisionBadge = 'strong' | 'fair' | 'weak' | 'risky';

export interface ProfitCheckResult {
  decision: DecisionBadge;
  reasons: string[];
  estimatedGross: number;
  effectiveRpm: number;
  estimatedVariableCost: number;
  estimatedNet: number;
  estimatedMarginPct: number;
  hasLaneHistory: boolean;
  hasBrokerHistory: boolean;
  /** Where the cost-per-mile number came from. Drives the source label in the UI. */
  costSource: 'profile' | 'history' | 'none';
  /** True if user set min_margin_pct or min_rpm targets in their cost profile. */
  hasTargets: boolean;
  meetsMinMargin: boolean | null;
  meetsMinRpm: boolean | null;
  laneAvgRpm?: number;
  laneAvgMarginPct?: number;
  laneAvgDeadheadPct?: number;
  laneLoadCount?: number;
  brokerReliability?: number;
  brokerDaysToPay?: number;
  /** Per-bucket CPM breakdown (only present when costSource === 'profile'). */
  costBreakdown?: Record<string, number>;
  /** Warnings from the cost profile computation (e.g. 'fixed_missing_monthly_miles'). */
  costWarnings?: string[];
}

/**
 * Build the same lane key strategy used in DB recompute (pickup -> dropoff).
 */
function buildLaneKey(pickup: string, dropoff: string): string {
  return `${pickup.trim()} -> ${dropoff.trim()}`;
}

/**
 * Compute deterministic profit check from current entry + user history.
 * Returns null when not enough data is entered to estimate.
 */
export function useProfitCheck(input: ProfitCheckInput | null) {
  const { user } = useAuth();
  const { settings } = useUserSettings();
  const { profile: costProfile } = useCostProfile();
  const laneKey = input ? buildLaneKey(input.pickup_location, input.dropoff_location) : '';

  const laneStatsQuery = useQuery({
    queryKey: ['lane_stats_lookup', user?.id, laneKey],
    queryFn: async () => {
      if (!user || !laneKey || laneKey === ' -> ') return null;
      const { data } = await supabase
        .from('lane_stats')
        .select('*')
        .eq('user_id', user.id)
        .eq('lane_key', laneKey)
        .maybeSingle();
      return data;
    },
    enabled: !!user && !!input && !!input.pickup_location && !!input.dropoff_location,
    staleTime: 60_000,
  });

  const brokerStatsQuery = useQuery({
    queryKey: ['broker_stats_lookup', user?.id, input?.broker_id],
    queryFn: async () => {
      if (!user || !input?.broker_id) return null;
      const { data } = await supabase
        .from('broker_stats')
        .select('*')
        .eq('user_id', user.id)
        .eq('broker_id', input.broker_id)
        .maybeSingle();
      return data;
    },
    enabled: !!user && !!input?.broker_id,
    staleTime: 60_000,
  });

  const opMetricsQuery = useQuery({
    queryKey: ['operating_metrics_lookup', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('operating_metrics')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  if (!input) {
    return { result: null as ProfitCheckResult | null, isLoading: false };
  }

  const isLoading =
    laneStatsQuery.isLoading || brokerStatsQuery.isLoading || opMetricsQuery.isLoading;

  const totalMiles = (input.loaded_miles || 0) + (input.deadhead_miles || 0);
  if (totalMiles <= 0 || input.estimated_pay <= 0) {
    return { result: null, isLoading };
  }

  const lane = laneStatsQuery.data;
  const broker = brokerStatsQuery.data;
  const op = opMetricsQuery.data;

  // Layered CPM: prefer driver-defined Cost Profile, fall back to rolling 60-day actuals.
  const profileResult = profileHasUsableData(costProfile)
    ? computeCostProfileCPM(costProfile, totalMiles)
    : { cpm: 0, breakdown: {}, warnings: [] as string[] };
  const profileCPM = profileResult.cpm;
  const historyCPM = op?.rolling_cost_per_mile ? Number(op.rolling_cost_per_mile) : 0;
  const cpm = profileCPM > 0 ? profileCPM : historyCPM;
  const costSource: 'profile' | 'history' | 'none' =
    profileCPM > 0 ? 'profile' : historyCPM > 0 ? 'history' : 'none';

  const estimatedVariableCost = cpm > 0 ? cpm * totalMiles : 0;
  const effectiveRpm = input.estimated_pay / totalMiles;
  const estimatedNet = input.estimated_pay - estimatedVariableCost;
  const estimatedMarginPct = input.estimated_pay > 0 ? (estimatedNet / input.estimated_pay) * 100 : 0;
  const deadheadPct = totalMiles > 0 ? (input.deadhead_miles / totalMiles) * 100 : 0;

  // Personal targets — Cost Profile takes priority over user_settings (Cost Profile is the
  // explicit "minimum acceptable" line, while user_settings targets are looser goals).
  const profileMinMargin = costProfile?.min_margin_pct != null ? Number(costProfile.min_margin_pct) : null;
  const profileMinRpm = costProfile?.min_rpm != null ? Number(costProfile.min_rpm) : null;
  const targetRpm = profileMinRpm ?? (settings?.target_rpm ? Number(settings.target_rpm) : null);
  const targetMargin = profileMinMargin ?? (settings?.target_margin_pct ? Number(settings.target_margin_pct) : null);
  const targetDeadhead = settings?.target_deadhead_pct ? Number(settings.target_deadhead_pct) : null;

  const meetsMinMargin = profileMinMargin != null && cpm > 0 ? estimatedMarginPct >= profileMinMargin : null;
  const meetsMinRpm = profileMinRpm != null ? effectiveRpm >= profileMinRpm : null;
  const hasTargets = profileMinMargin != null || profileMinRpm != null;

  const reasons: string[] = [];
  let score = 0;
  let signals = 0;

  // RPM vs target or lane avg
  if (targetRpm) {
    signals++;
    if (effectiveRpm >= targetRpm * 1.1) { score += 2; reasons.push(`Effective RPM beats your target ($${effectiveRpm.toFixed(2)} vs $${targetRpm.toFixed(2)}).`); }
    else if (effectiveRpm >= targetRpm * 0.95) { score += 1; }
    else { score -= 2; reasons.push(`Effective RPM is below your target ($${effectiveRpm.toFixed(2)} vs $${targetRpm.toFixed(2)}).`); }
  }

  if (lane && lane.load_count >= 2 && Number(lane.avg_rpm) > 0) {
    signals++;
    const laneAvg = Number(lane.avg_rpm);
    if (effectiveRpm >= laneAvg * 1.1) { score += 2; reasons.push(`This load pays more than your usual ${laneKey} runs ($${effectiveRpm.toFixed(2)} vs $${laneAvg.toFixed(2)}).`); }
    else if (effectiveRpm >= laneAvg * 0.95) { score += 1; }
    else { score -= 2; reasons.push(`Similar loads on this lane have paid more ($${laneAvg.toFixed(2)} avg vs $${effectiveRpm.toFixed(2)}).`); }
  }

  // Margin
  if (targetMargin && cpm > 0) {
    signals++;
    if (estimatedMarginPct >= targetMargin) { score += 2; reasons.push(`Estimated margin (${estimatedMarginPct.toFixed(0)}%) meets your target.`); }
    else if (estimatedMarginPct >= targetMargin * 0.85) { score += 0; }
    else { score -= 2; reasons.push(`Estimated margin (${estimatedMarginPct.toFixed(0)}%) is below your target (${targetMargin.toFixed(0)}%).`); }
  } else if (cpm > 0) {
    signals++;
    if (estimatedMarginPct < 0) { score -= 3; reasons.push(`Estimated to lose money after variable costs.`); }
    else if (estimatedMarginPct < 15) { score -= 1; reasons.push(`Thin margin estimated (${estimatedMarginPct.toFixed(0)}%).`); }
    else { score += 1; }
  }

  // Deadhead
  if (targetDeadhead) {
    signals++;
    if (deadheadPct <= targetDeadhead) { score += 1; }
    else if (deadheadPct <= targetDeadhead * 1.5) { score -= 1; reasons.push(`Deadhead (${deadheadPct.toFixed(0)}%) is above your target.`); }
    else { score -= 2; reasons.push(`Deadhead (${deadheadPct.toFixed(0)}%) is much higher than your target.`); }
  } else if (deadheadPct > 30) {
    signals++;
    score -= 1;
    reasons.push(`High deadhead (${deadheadPct.toFixed(0)}% of total miles).`);
  }

  // Broker reliability
  if (broker && broker.load_count >= 2) {
    signals++;
    const rel = broker.reliability_score != null ? Number(broker.reliability_score) : null;
    const dtp = broker.days_to_pay_avg != null ? Number(broker.days_to_pay_avg) : null;
    if (rel != null) {
      if (rel >= 80) { score += 1; }
      else if (rel < 60) { score -= 2; reasons.push(`This broker has paid slowly or short on recent loads (reliability ${rel.toFixed(0)}/100).`); }
    }
    if (dtp != null && dtp > 45) {
      score -= 1;
      reasons.push(`This broker averages ${dtp.toFixed(0)} days to pay — watch cash flow.`);
    }
  }

  // Decision badge
  let decision: DecisionBadge;
  if (signals === 0) {
    decision = 'fair';
    reasons.push('Not enough history yet — this is an entry-only estimate.');
  } else if (score >= 3) decision = 'strong';
  else if (score >= 0) decision = 'fair';
  else if (score >= -3) decision = 'weak';
  else decision = 'risky';

  return {
    isLoading,
    result: {
      decision,
      reasons: reasons.slice(0, 4),
      estimatedGross: input.estimated_pay,
      effectiveRpm,
      estimatedVariableCost,
      estimatedNet,
      estimatedMarginPct,
      hasLaneHistory: !!(lane && lane.load_count >= 2),
      hasBrokerHistory: !!(broker && broker.load_count >= 2),
      costSource,
      hasTargets,
      meetsMinMargin,
      meetsMinRpm,
      laneAvgRpm: lane ? Number(lane.avg_rpm) : undefined,
      laneAvgMarginPct: lane ? Number(lane.avg_margin_pct) : undefined,
      laneAvgDeadheadPct: lane && Number(lane.avg_loaded_miles) + Number(lane.avg_deadhead_miles) > 0
        ? (Number(lane.avg_deadhead_miles) / (Number(lane.avg_loaded_miles) + Number(lane.avg_deadhead_miles))) * 100
        : undefined,
      laneLoadCount: lane?.load_count,
      brokerReliability: broker?.reliability_score != null ? Number(broker.reliability_score) : undefined,
      brokerDaysToPay: broker?.days_to_pay_avg != null ? Number(broker.days_to_pay_avg) : undefined,
      costBreakdown: costSource === 'profile' ? profileResult.breakdown : undefined,
      costWarnings: costSource === 'profile' ? profileResult.warnings : undefined,
    },
  };
}
