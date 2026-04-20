import { Load } from '@/hooks/useLoads';
import type { LaneStat, BrokerStat, OperatingMetrics } from '@/hooks/usePersonalIntelligence';
import type { SmartAlert } from '@/hooks/useSmartAlerts';
import { differenceInDays, parseISO } from 'date-fns';
import { getEffectiveDate } from '@/lib/loadUtils';

interface BuildArgs {
  loads: Load[];
  lanes: LaneStat[];
  brokers: (BrokerStat & { broker_name: string })[];
  operatingMetrics: OperatingMetrics | null;
  targets?: {
    target_margin_pct?: number | null;
    target_deadhead_pct?: number | null;
    target_rpm?: number | null;
  } | null;
}

/**
 * Grounded profit-defense alerts derived from personal intelligence
 * tables. All thresholds are deterministic and explainable.
 */
export function buildProfitDefenseAlerts({
  loads,
  lanes,
  brokers,
  operatingMetrics,
  targets,
}: BuildArgs): SmartAlert[] {
  const alerts: SmartAlert[] = [];
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);

  // 1. Repeated weak lane — lane run >= 2x with avg net profit < 0 OR margin < 10%
  const weakLanes = lanes
    .filter(l => l.load_count >= 2 && (Number(l.avg_net_profit) < 0 || Number(l.avg_margin_pct) < 10))
    .sort((a, b) => Number(a.avg_net_profit) - Number(b.avg_net_profit))
    .slice(0, 1);
  for (const lane of weakLanes) {
    const np = Number(lane.avg_net_profit);
    alerts.push({
      type: 'weak_lane_repeat',
      severity: np < 0 ? 'critical' : 'warning',
      tier: 'advanced',
      title: 'Repeated Weak Lane',
      message: `${lane.lane_key} ran ${lane.load_count}x at avg net ${np >= 0 ? '$' : '-$'}${Math.abs(Math.round(np))} (${Number(lane.avg_margin_pct).toFixed(0)}% margin). Consider raising rate or skipping.`,
      ctaLabel: 'View Loads',
      ctaRoute: 'loads',
      dedupeKey: `weak_lane_${lane.lane_key}_${todayKey.slice(0, 7)}`,
    });
  }

  // 2. Broker delay — avg days to pay > 35 with at least 2 loads
  const slowBrokers = brokers
    .filter(b => b.load_count >= 2 && Number(b.days_to_pay_avg ?? 0) > 35)
    .sort((a, b) => Number(b.days_to_pay_avg ?? 0) - Number(a.days_to_pay_avg ?? 0))
    .slice(0, 1);
  for (const b of slowBrokers) {
    alerts.push({
      type: 'broker_delay',
      severity: 'warning',
      tier: 'advanced',
      title: 'Slow-Paying Broker',
      message: `${b.broker_name} averages ${Math.round(Number(b.days_to_pay_avg))} days to pay across ${b.load_count} loads. Tighten terms or require quick-pay.`,
      ctaLabel: 'View Loads',
      ctaRoute: 'loads',
      dedupeKey: `broker_delay_${b.broker_id}_${todayKey.slice(0, 7)}`,
    });
  }

  // 3. Broker unpaid exposure climbing — broker has >= 2 unpaid loads
  const exposed = brokers
    .filter(b => b.unpaid_count >= 2)
    .sort((a, b) => b.unpaid_count - a.unpaid_count)
    .slice(0, 1);
  for (const b of exposed) {
    alerts.push({
      type: 'unpaid_exposure',
      severity: 'critical',
      tier: 'advanced',
      title: 'Unpaid Exposure Climbing',
      message: `${b.broker_name} has ${b.unpaid_count} unpaid load${b.unpaid_count > 1 ? 's' : ''}. Pause new loads with this broker until paid.`,
      ctaLabel: 'View Loads',
      ctaRoute: 'loads',
      dedupeKey: `unpaid_exposure_${b.broker_id}_${todayKey.slice(0, 10)}`,
    });
  }

  // 4. Margin drop — 90-day rolling margin below user's target by >= 5pts (or below 15% if no target)
  if (operatingMetrics) {
    const margin = Number(operatingMetrics.rolling_margin_pct);
    const target = Number(targets?.target_margin_pct ?? 25);
    if (margin > 0 && margin < target - 5) {
      alerts.push({
        type: 'margin_drop',
        severity: margin < 10 ? 'critical' : 'warning',
        tier: 'advanced',
        title: 'Margin Below Target',
        message: `Your 90-day margin is ${margin.toFixed(1)}%, vs your ${target}% target. Variable + fuel costs are eating into profit.`,
        ctaLabel: 'View Reports',
        ctaRoute: 'reports',
        dedupeKey: `margin_drop_${todayKey.slice(0, 7)}`,
      });
    }

    // 5. Deadhead spike — 90-day deadhead above target + 5pts (or above 25% if no target)
    const dh = Number(operatingMetrics.rolling_deadhead_pct);
    const dhTarget = Number(targets?.target_deadhead_pct ?? 20);
    if (dh > dhTarget + 5) {
      alerts.push({
        type: 'deadhead_spike',
        severity: 'warning',
        tier: 'advanced',
        title: 'Deadhead Spike',
        message: `Rolling 90-day deadhead is ${dh.toFixed(1)}% vs your ${dhTarget}% target. Each empty mile is unpaid wear.`,
        ctaLabel: 'View Loads',
        ctaRoute: 'loads',
        dedupeKey: `deadhead_spike_${todayKey.slice(0, 7)}`,
      });
    }
  }

  // 6. Old unpaid load aging > 45 days
  const veryOldUnpaid = loads.filter(
    l => l.actual_pay_received == null && l.status !== 'cancelled' &&
      differenceInDays(now, parseISO(getEffectiveDate(l))) > 45
  );
  if (veryOldUnpaid.length > 0) {
    const total = veryOldUnpaid.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
    alerts.push({
      type: 'aging_unpaid',
      severity: 'critical',
      tier: 'advanced',
      title: 'Aging Unpaid Loads',
      message: `${veryOldUnpaid.length} load${veryOldUnpaid.length > 1 ? 's' : ''} >45 days old still unpaid (~$${Math.round(total)}). Escalate collection now.`,
      ctaLabel: 'Review',
      ctaRoute: 'loads',
      dedupeKey: `aging_unpaid_${veryOldUnpaid.length}_${todayKey.slice(0, 10)}`,
    });
  }

  return alerts;
}

/**
 * Build weekly closeout recommendations grouped into:
 *   lanesToRepeat, lanesToAvoid, brokersToWatch
 */
export interface WeeklyRecommendations {
  lanesToRepeat: { lane_key: string; avg_net_profit: number; avg_rpm: number; load_count: number }[];
  lanesToAvoid: { lane_key: string; avg_net_profit: number; avg_margin_pct: number; load_count: number }[];
  brokersToWatch: { broker_name: string; reason: string; metric: string }[];
}

export function buildWeeklyRecommendations(
  lanes: LaneStat[],
  brokers: (BrokerStat & { broker_name: string })[],
): WeeklyRecommendations {
  const lanesToRepeat = lanes
    .filter(l => l.load_count >= 2 && Number(l.avg_net_profit) > 0)
    .sort((a, b) => Number(b.avg_net_profit) - Number(a.avg_net_profit))
    .slice(0, 3)
    .map(l => ({
      lane_key: l.lane_key,
      avg_net_profit: Number(l.avg_net_profit),
      avg_rpm: Number(l.avg_rpm),
      load_count: l.load_count,
    }));

  const lanesToAvoid = lanes
    .filter(l => l.load_count >= 2 && (Number(l.avg_net_profit) < 0 || Number(l.avg_margin_pct) < 10))
    .sort((a, b) => Number(a.avg_net_profit) - Number(b.avg_net_profit))
    .slice(0, 3)
    .map(l => ({
      lane_key: l.lane_key,
      avg_net_profit: Number(l.avg_net_profit),
      avg_margin_pct: Number(l.avg_margin_pct),
      load_count: l.load_count,
    }));

  const brokersToWatch: WeeklyRecommendations['brokersToWatch'] = [];
  for (const b of brokers) {
    if (b.load_count < 2) continue;
    const reasons: string[] = [];
    let metric = '';
    if (b.unpaid_count >= 2) {
      reasons.push('rising unpaid exposure');
      metric = `${b.unpaid_count} unpaid`;
    }
    if (Number(b.days_to_pay_avg ?? 0) > 35) {
      reasons.push('slow payments');
      if (!metric) metric = `${Math.round(Number(b.days_to_pay_avg))}d to pay`;
    }
    if (Number(b.reliability_score ?? 100) < 70) {
      reasons.push('low reliability');
      if (!metric) metric = `score ${Math.round(Number(b.reliability_score))}/100`;
    }
    if (b.short_pay_count >= 2) {
      reasons.push('repeated short-pays');
      if (!metric) metric = `${b.short_pay_count} short-paid`;
    }
    if (reasons.length > 0) {
      brokersToWatch.push({
        broker_name: b.broker_name,
        reason: reasons.join(', '),
        metric,
      });
    }
  }
  brokersToWatch.sort((a, b) => a.broker_name.localeCompare(b.broker_name));

  return { lanesToRepeat, lanesToAvoid, brokersToWatch: brokersToWatch.slice(0, 3) };
}
