import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { startOfWeek, endOfWeek, subWeeks, parseISO, isWithinInterval, differenceInDays } from 'date-fns';
import { weekStartDayToNumber, getEffectiveDate } from '@/lib/loadUtils';

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertTier = 'basic' | 'advanced';

export interface SmartAlert {
  type: string;
  severity: AlertSeverity;
  tier: AlertTier;
  title: string;
  message: string;
  ctaLabel?: string;
  ctaRoute?: string;
  dedupeKey: string;
}

function getWeekRange(weeksAgo: number, weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0) {
  const now = new Date();
  const ref = subWeeks(now, weeksAgo);
  return { start: startOfWeek(ref, { weekStartsOn }), end: endOfWeek(ref, { weekStartsOn }) };
}

function filterByRange(loads: Load[], start: Date, end: Date) {
  return loads.filter(l => isWithinInterval(parseISO(getEffectiveDate(l)), { start, end }));
}

export function computeAlerts(loads: Load[], expenses: Expense[], weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0): SmartAlert[] {
  const alerts: SmartAlert[] = [];
  const now = new Date();

  // Current week loads/expenses
  const thisWeek = getWeekRange(0, weekStartsOn);
  const lastWeek = getWeekRange(1, weekStartsOn);
  const thisWeekLoads = filterByRange(loads, thisWeek.start, thisWeek.end);
  const lastWeekLoads = filterByRange(loads, lastWeek.start, lastWeek.end);

  // === Profit calculations (this week) ===
  const thisWeekRevenue = thisWeekLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const thisWeekExpenses = expenses
    .filter(e => isWithinInterval(parseISO(e.expense_date), { start: thisWeek.start, end: thisWeek.end }))
    .reduce((s, e) => s + Number(e.amount), 0);
  const thisWeekProfit = thisWeekRevenue - thisWeekExpenses;

  const lastWeekRevenue = lastWeekLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const lastWeekExpenses = expenses
    .filter(e => isWithinInterval(parseISO(e.expense_date), { start: lastWeek.start, end: lastWeek.end }))
    .reduce((s, e) => s + Number(e.amount), 0);
  const lastWeekProfit = lastWeekRevenue - lastWeekExpenses;

  // 1. Negative profit
  if (thisWeekLoads.length > 0 && thisWeekProfit < 0) {
    alerts.push({
      type: 'negative_profit',
      severity: 'critical',
      tier: 'basic',
      title: 'Negative Profit This Week',
      message: `You're spending more than you're earning this week. Revenue: $${thisWeekRevenue.toFixed(0)}, Expenses: $${thisWeekExpenses.toFixed(0)}.`,
      ctaLabel: 'View Expenses',
      ctaRoute: 'reports',
      dedupeKey: `negative_profit_${thisWeek.start.toISOString().slice(0, 10)}`,
    });
  }

  // 2. Profit dropped ≥ 20%
  if (lastWeekProfit > 0 && thisWeekLoads.length > 0) {
    const dropPct = ((lastWeekProfit - thisWeekProfit) / lastWeekProfit) * 100;
    if (dropPct >= 20) {
      const dollarDrop = lastWeekProfit - thisWeekProfit;
      alerts.push({
      type: 'profit_drop',
      severity: 'warning',
      tier: 'advanced',
      title: 'Profit Dropped This Week',
        message: `Profit is down ${dropPct.toFixed(0)}% ($${dollarDrop.toFixed(0)}) compared to last week.`,
        ctaLabel: 'View Dashboard',
        ctaRoute: 'dashboard',
        dedupeKey: `profit_drop_${thisWeek.start.toISOString().slice(0, 10)}`,
      });
    }
  }

  // 3. Deadhead ratio > 20% (all-time for period)
  const totalLoaded = thisWeekLoads.reduce((s, l) => s + Number(l.loaded_miles), 0);
  const totalDH = thisWeekLoads.reduce((s, l) => s + Number(l.deadhead_miles), 0);
  const totalMi = totalLoaded + totalDH;
  if (totalMi > 0 && (totalDH / totalMi) * 100 > 20) {
    alerts.push({
      type: 'high_deadhead',
      severity: 'warning',
      tier: 'basic',
      title: 'High Deadhead This Week',
      message: `Your deadhead ratio is ${((totalDH / totalMi) * 100).toFixed(1)}%. Aim for under 20%.`,
      ctaLabel: 'View Loads',
      ctaRoute: 'loads',
      dedupeKey: `high_deadhead_${thisWeek.start.toISOString().slice(0, 10)}`,
    });
  }

  // 4. RPM below 30-day average by ≥ 15%
  const last30Loads = loads.filter(l => differenceInDays(now, parseISO(getEffectiveDate(l))) <= 30);
  const avg30Miles = last30Loads.reduce((s, l) => s + Number(l.loaded_miles), 0);
  const avg30Rev = last30Loads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const avg30RPM = avg30Miles > 0 ? avg30Rev / avg30Miles : 0;
  const thisWeekRPM = totalLoaded > 0 ? thisWeekRevenue / totalLoaded : 0;
  if (avg30RPM > 0 && thisWeekRPM > 0 && ((avg30RPM - thisWeekRPM) / avg30RPM) * 100 >= 15) {
    alerts.push({
      type: 'low_rpm',
      severity: 'warning',
      tier: 'advanced',
      title: 'Low Rate Per Mile',
      message: `This week's RPM ($${thisWeekRPM.toFixed(2)}) is ${(((avg30RPM - thisWeekRPM) / avg30RPM) * 100).toFixed(0)}% below your 30-day average ($${avg30RPM.toFixed(2)}).`,
      ctaLabel: 'Review Loads',
      ctaRoute: 'loads',
      dedupeKey: `low_rpm_${thisWeek.start.toISOString().slice(0, 10)}`,
    });
  }

  // 5. Expense ratio > 70%
  if (thisWeekRevenue > 0 && (thisWeekExpenses / thisWeekRevenue) * 100 > 70) {
    alerts.push({
      type: 'high_expense_ratio',
      severity: 'warning',
      tier: 'advanced',
      title: 'High Expense Ratio',
      message: `Expenses are ${((thisWeekExpenses / thisWeekRevenue) * 100).toFixed(0)}% of revenue this week. Target below 70%.`,
      ctaLabel: 'View Reports',
      ctaRoute: 'reports',
      dedupeKey: `high_expense_${thisWeek.start.toISOString().slice(0, 10)}`,
    });
  }

  // 6. Missing actual pay older than 7 days
  const missingPayLoads = loads.filter(
    l => l.actual_pay_received == null && differenceInDays(now, parseISO(getEffectiveDate(l))) > 7
  );
  if (missingPayLoads.length > 0) {
    alerts.push({
      type: 'missing_pay',
      severity: 'info',
      tier: 'basic',
      title: 'Missing Pay Records',
      message: `${missingPayLoads.length} load${missingPayLoads.length > 1 ? 's' : ''} older than 7 days still missing actual pay.`,
      ctaLabel: 'Review',
      ctaRoute: 'loads',
      dedupeKey: `missing_pay_count_${missingPayLoads.length}`,
    });
  }

  // Sort by severity
  const severityOrder: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}

export function useSmartAlerts(loads: Load[], expenses: Expense[], weekStartDay?: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const wso = weekStartDayToNumber(weekStartDay);

  const dismissedQuery = useQuery({
    queryKey: ['alert_dismissals', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('user_alerts')
        .select('dedupe_key')
        .eq('user_id', user.id);
      if (error) throw error;
      return (data ?? []).map(d => d.dedupe_key);
    },
    enabled: !!user,
  });

  const dismissAlert = useMutation({
    mutationFn: async (dedupeKey: string) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('user_alerts')
        .upsert({ user_id: user.id, dedupe_key: dedupeKey }, { onConflict: 'user_id,dedupe_key' });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alert_dismissals'] }),
  });

  const allAlerts = useMemo(() => computeAlerts(loads, expenses, wso), [loads, expenses, wso]);
  const dismissedKeys = new Set(dismissedQuery.data ?? []);
  const activeAlerts = allAlerts.filter(a => !dismissedKeys.has(a.dedupeKey));

  return { alerts: activeAlerts, allAlerts, dismissAlert, isLoading: dismissedQuery.isLoading };
}
