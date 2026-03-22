import { useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { startOfWeek, subWeeks, parseISO, differenceInCalendarWeeks, isWithinInterval, endOfWeek } from 'date-fns';
import { weekStartDayToNumber, getEffectiveDate } from '@/lib/loadUtils';

export type Tier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

export interface ScorecardMetric {
  label: string;
  score: number;
  maxScore: number;
  detail: string;
  recommendation: string;
}

export interface ScorecardResult {
  totalScore: number;
  tier: Tier;
  metrics: ScorecardMetric[];
}

function getTier(score: number): Tier {
  if (score >= 80) return 'Platinum';
  if (score >= 60) return 'Gold';
  if (score >= 40) return 'Silver';
  return 'Bronze';
}

export function computeScorecard(loads: Load[], expenses: Expense[], weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0): ScorecardResult {
  const now = new Date();
  const last30Loads = loads.filter(l => {
    const d = parseISO(getEffectiveDate(l));
    return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) <= 30;
  });

  // 1. RPM Performance (0–25)
  const totalMiles = last30Loads.reduce((s, l) => s + Number(l.loaded_miles), 0);
  const totalRev = last30Loads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const rpm = totalMiles > 0 ? totalRev / totalMiles : 0;
  // Scale: $3+/mi = 25, $0 = 0, linear
  const rpmScore = Math.min(25, Math.round((rpm / 3) * 25));
  const rpmDetail = totalMiles > 0 ? `$${rpm.toFixed(2)}/mi (30-day)` : 'No loads yet';

  // 2. Deadhead Efficiency (0–20)
  const totalDH = last30Loads.reduce((s, l) => s + Number(l.deadhead_miles), 0);
  const totalAllMiles = totalMiles + totalDH;
  const dhPct = totalAllMiles > 0 ? (totalDH / totalAllMiles) * 100 : 0;
  // Scale: 0% DH = 20, 40%+ = 0, linear
  const dhScore = Math.max(0, Math.min(20, Math.round((1 - dhPct / 40) * 20)));
  const dhDetail = totalAllMiles > 0 ? `${dhPct.toFixed(1)}% deadhead` : 'No miles logged';

  // 3. Expense Ratio Control (0–20)
  const last30Expenses = expenses.filter(e => {
    const d = parseISO(e.expense_date);
    return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) <= 30;
  });
  const totalExp = last30Expenses.reduce((s, e) => s + Number(e.amount), 0);
  const expRatio = totalRev > 0 ? (totalExp / totalRev) * 100 : 0;
  // Scale: 0% = 20, 100%+ = 0, linear
  const expScore = totalRev > 0 ? Math.max(0, Math.min(20, Math.round((1 - expRatio / 100) * 20))) : 10;
  const expDetail = totalRev > 0 ? `${expRatio.toFixed(0)}% of revenue` : 'No revenue data';

  // 4. Profit Trend (0–20)
  const thisWeek = { start: startOfWeek(now, { weekStartsOn }), end: endOfWeek(now, { weekStartsOn }) };
  const lastWeek = { start: startOfWeek(subWeeks(now, 1), { weekStartsOn }), end: endOfWeek(subWeeks(now, 1), { weekStartsOn }) };
  const twLoads = loads.filter(l => isWithinInterval(parseISO(getEffectiveDate(l)), thisWeek));
  const lwLoads = loads.filter(l => isWithinInterval(parseISO(getEffectiveDate(l)), lastWeek));
  const twRev = twLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const lwRev = lwLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const twExp = expenses.filter(e => isWithinInterval(parseISO(e.expense_date), thisWeek)).reduce((s, e) => s + Number(e.amount), 0);
  const lwExp = expenses.filter(e => isWithinInterval(parseISO(e.expense_date), lastWeek)).reduce((s, e) => s + Number(e.amount), 0);
  const twProfit = twRev - twExp;
  const lwProfit = lwRev - lwExp;
  let profitScore = 10; // neutral
  let profitDetail = 'No comparison data';
  if (lwProfit > 0 && twLoads.length > 0) {
    const change = ((twProfit - lwProfit) / lwProfit) * 100;
    profitScore = Math.max(0, Math.min(20, Math.round(10 + (change / 5))));
    profitDetail = `${change >= 0 ? '+' : ''}${change.toFixed(0)}% vs last week`;
  } else if (twLoads.length > 0) {
    profitDetail = twProfit >= 0 ? 'Profitable this week' : 'Negative profit this week';
    profitScore = twProfit >= 0 ? 14 : 4;
  }

  // 5. Logging Streak (0–15)
  // Consecutive weeks with ≥ 1 load, counting backwards from current week
  let streak = 0;
  for (let w = 0; w < 52; w++) {
    const ws = startOfWeek(subWeeks(now, w), { weekStartsOn });
    const we = endOfWeek(subWeeks(now, w), { weekStartsOn });
    const hasLoad = loads.some(l => isWithinInterval(parseISO(getEffectiveDate(l)), { start: ws, end: we }));
    if (hasLoad) streak++;
    else break;
  }
  // Scale: 12+ weeks = 15, linear
  const streakScore = Math.min(15, Math.round((streak / 12) * 15));
  const streakDetail = `${streak} week${streak !== 1 ? 's' : ''} streak`;

  const totalScore = rpmScore + dhScore + expScore + profitScore + streakScore;

  // Actionable recommendations based on score thresholds
  const rpmRec = rpmScore >= 20 ? 'Great RPM — keep targeting high-paying lanes.' :
    rpmScore >= 10 ? 'Try negotiating rates above $2.50/mi or reducing short-haul loads.' :
    totalMiles > 0 ? 'Focus on longer hauls and avoid loads under $2/mi to boost RPM.' : 'Log loads to start tracking your rate per mile.';

  const dhRec = dhScore >= 16 ? 'Excellent deadhead control — your planning is paying off.' :
    dhScore >= 8 ? 'Look for backhauls or nearby loads to cut empty miles.' :
    'Over 30% deadhead is costly. Use load boards to find loads closer to your drop-off.';

  const expRec = expScore >= 16 ? 'Expenses are well controlled relative to revenue.' :
    expScore >= 8 ? 'Review recurring expenses — small cuts add up weekly.' :
    'Expenses are eating into profit. Audit fuel stops, tolls, and subscriptions.';

  const profitRec = profitScore >= 14 ? 'Profit trend is strong — maintain consistency.' :
    profitScore >= 8 ? 'Profit dipped slightly. Check if expenses spiked or revenue dropped.' :
    'Profit is declining. Compare this week\'s loads and expenses to find the gap.';

  const streakRec = streakScore >= 12 ? 'Amazing consistency! Your logging streak builds better data.' :
    streakScore >= 6 ? 'Good streak going. Log at least 1 load every week to keep it.' :
    'Log loads weekly to build your streak and unlock better insights.';

  return {
    totalScore,
    tier: getTier(totalScore),
    metrics: [
      { label: 'RPM Performance', score: rpmScore, maxScore: 25, detail: rpmDetail, recommendation: rpmRec },
      { label: 'Deadhead Efficiency', score: dhScore, maxScore: 20, detail: dhDetail, recommendation: dhRec },
      { label: 'Expense Control', score: expScore, maxScore: 20, detail: expDetail, recommendation: expRec },
      { label: 'Profit Trend', score: profitScore, maxScore: 20, detail: profitDetail, recommendation: profitRec },
      { label: 'Logging Streak', score: streakScore, maxScore: 15, detail: streakDetail, recommendation: streakRec },
    ],
  };
}

export function useDriverScorecard(loads: Load[], expenses: Expense[], weekStartDay?: string | null) {
  const wso = weekStartDayToNumber(weekStartDay);
  return useMemo(() => computeScorecard(loads, expenses, wso), [loads, expenses, wso]);
}
