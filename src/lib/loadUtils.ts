import { Load } from '@/hooks/useLoads';
import { WeekSummary } from '@/lib/types';
import { startOfWeek, endOfWeek, format, parseISO, isWithinInterval, startOfMonth, endOfMonth } from 'date-fns';

export function getWeekSummaries(loads: Load[]): WeekSummary[] {
  const weekMap = new Map<string, Load[]>();

  loads.forEach(load => {
    const date = parseISO(load.date);
    const weekStart = startOfWeek(date, { weekStartsOn: 1 });
    const key = weekStart.toISOString();
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key)!.push(load);
  });

  const summaries: WeekSummary[] = [];
  weekMap.forEach((weekLoads, key) => {
    const start = parseISO(key);
    const end = endOfWeek(start, { weekStartsOn: 1 });
    const totalLoadedMiles = weekLoads.reduce((s, l) => s + Number(l.loaded_miles), 0);
    const totalEstimatedPay = weekLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
    const totalActualPay = weekLoads.reduce((s, l) => s + Number(l.actual_pay ?? 0), 0);
    summaries.push({
      weekLabel: `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      totalLoads: weekLoads.length,
      totalLoadedMiles,
      totalDeadheadMiles: weekLoads.reduce((s, l) => s + Number(l.deadhead_miles), 0),
      totalEstimatedPay,
      totalActualPay,
      avgRatePerMile: totalLoadedMiles > 0 ? totalEstimatedPay / totalLoadedMiles : 0,
    });
  });

  return summaries.sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export function getCurrentWeekLoads(loads: Load[]): Load[] {
  const now = new Date();
  const start = startOfWeek(now, { weekStartsOn: 1 });
  const end = endOfWeek(now, { weekStartsOn: 1 });
  return loads.filter(l => {
    const d = parseISO(l.date);
    return isWithinInterval(d, { start, end });
  });
}

export function getCurrentMonthLoads(loads: Load[]): Load[] {
  const now = new Date();
  const start = startOfMonth(now);
  const end = endOfMonth(now);
  return loads.filter(l => {
    const d = parseISO(l.date);
    return isWithinInterval(d, { start, end });
  });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(num));
}

export function exportToCSV(loads: Load[], filename: string) {
  const headers = ['Date', 'Pickup', 'Drop-off', 'Loaded Miles', 'Deadhead Miles', 'Rate/Mile', 'Wait Fee', 'Detention Fee', 'Estimated Pay', 'Actual Pay', 'Status'];
  const rows = loads.map(l => [
    l.date, l.pickup, l.dropoff, l.loaded_miles, l.deadhead_miles,
    l.rate_per_mile, l.wait_fee, l.detention_fee, l.estimated_pay, l.actual_pay ?? '', l.status
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
