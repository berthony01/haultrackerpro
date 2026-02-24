import { Load, WeekSummary } from '@/lib/types';
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
    const totalLoadedMiles = weekLoads.reduce((s, l) => s + l.loadedMiles, 0);
    const totalPay = weekLoads.reduce((s, l) => s + l.totalPay, 0);
    summaries.push({
      weekLabel: `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      totalLoads: weekLoads.length,
      totalLoadedMiles,
      totalDeadheadMiles: weekLoads.reduce((s, l) => s + l.deadheadMiles, 0),
      totalPay,
      avgRatePerMile: totalLoadedMiles > 0 ? totalPay / totalLoadedMiles : 0,
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
  const headers = ['Date', 'Pickup', 'Drop-off', 'Loaded Miles', 'Deadhead Miles', 'Rate/Mile', 'Wait Fee', 'Detention Fee', 'Total Pay'];
  const rows = loads.map(l => [
    l.date, l.pickup, l.dropoff, l.loadedMiles, l.deadheadMiles,
    l.ratePerMile, l.waitFee, l.detentionFee, l.totalPay.toFixed(2)
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
