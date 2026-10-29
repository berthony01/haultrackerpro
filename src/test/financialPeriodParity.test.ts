import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { inflateSync } from 'node:zlib';
import { summarizeFinancialPeriod } from '@/lib/financialCalculations';
import { aggregateReport } from '@/lib/reportAggregator';
import { buildReportCSV } from '@/lib/reportCsv';
import { buildReportPdf } from '@/lib/reportPdf';
import { getWeekSummaries } from '@/lib/loadUtils';
import type { Load } from '@/hooks/useLoads';
import type { Expense } from '@/hooks/useExpenses';
import type { FuelLog } from '@/hooks/useFuelLogs';
import type { DateRange } from '@/lib/reportRanges';

const state = vi.hoisted(() => ({ fuel: [] as FuelLog[] }));
vi.mock('@/hooks/useFuelLogs', () => ({ useFuelLogs: (range?: { from?: string; to?: string }) => ({
  fuelLogs: state.fuel.filter(f => (!range?.from || f.date >= range.from) && (!range?.to || f.date <= range.to)),
}) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'driver', email: 'fixture@example.test' } }) }));
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { week_start_day: 'monday' } }) }));
vi.mock('@/hooks/useLoadStops', () => ({ useLoadStops: () => ({ stops: [] }) }));
vi.mock('@/hooks/useCostProfile', () => ({ useCostProfile: () => ({ profile: null }), profileHasUsableData: () => false }));
vi.mock('@/hooks/useDriverScorecard', () => ({ useDriverScorecard: () => ({ totalScore: 0, tier: 'fixture' }) }));
vi.mock('@/components/WeeklyFocusCard', () => ({ WeeklyFocusCard: () => null }));
vi.mock('@/components/SmartLoadAdvisor', () => ({ SmartLoadAdvisor: () => null }));
vi.mock('@/components/ContributionMarginCard', () => ({ ContributionMarginCard: () => null }));
vi.mock('@/components/FuelAnalyticsCard', () => ({ FuelAnalyticsCard: () => null }));
vi.mock('@/components/TaxEstimateCard', () => ({ TaxEstimateCard: () => null }));
vi.mock('@/components/premium/ProfitOverviewChart', () => ({ ProfitOverviewChart: () => null }));
vi.mock('@/components/premium/ExpenseDonut', () => ({ ExpenseDonut: () => null }));
vi.mock('@/components/premium/DriverScoreGauge', () => ({ DriverScoreGauge: () => null }));
vi.mock('@/components/premium/RecentLoadsPanel', () => ({ RecentLoadsPanel: () => null }));
vi.mock('@/components/premium/ProfitByLoadTable', () => ({ ProfitByLoadTable: () => null }));
// The real page KPI code is rendered; unrelated widgets/network calls are excluded.
import { DashboardView } from '@/components/DashboardView';
import { ReportsView } from '@/components/ReportsView';

const range: DateRange = { from: '2026-05-01', to: '2026-05-31', key: 'custom', label: 'May' };
const load = (over: Partial<Load> = {}): Load => ({
  id: 'l', user_id: 'driver', load_date: '2026-05-04', dropoff_date: null,
  pickup_location: 'A', dropoff_location: 'B', loaded_miles: 100, deadhead_miles: 20,
  total_miles: 120, estimated_pay: 200, actual_pay_received: null, rate_per_mile: 2,
  wait_fee: 0, detention_fee: 0, other_fees: 0, status: 'completed',
  updated_at: '2026-05-04T00:00:00Z', pay_model: 'loaded_miles_only', ...over,
} as Load);
const expense = (amount: number, category = 'Maintenance', date = '2026-05-04'): Expense => ({
  id: `${category}-${date}`, user_id: 'driver', amount, category, expense_date: date,
} as Expense);
const fuel = (amount: number, date = '2026-05-04'): FuelLog => ({
  id: date, user_id: 'driver', total_cost: amount, date, gallons: 10, price_per_gallon: amount / 10,
} as FuelLog);
const aggregate = (loads: Load[], expenses: Expense[], fuelLogs: FuelLog[], selected = range, settings = null) =>
  aggregateReport({ loads, expenses, fuelLogs, range: selected, settings, preparedFor: 'Fixture' });

afterEach(() => { cleanup(); state.fuel = []; });

describe('F1 canonical financial period', () => {
  it.each([
    ['logs only', [], [fuel(50)], 50, 150, 'fuel_logs'],
    ['expense only', [expense(50, 'Fuel')], [], 50, 150, 'expenses'],
    ['both single-count', [expense(900, 'Fuel'), expense(25)], [fuel(50)], 75, 125, 'fuel_logs'],
    ['no fuel', [expense(25)], [], 25, 175, 'expenses'],
    ['zero profit', [expense(200)], [], 200, 0, 'expenses'],
    ['negative profit', [expense(250)], [], 250, -50, 'expenses'],
  ] as const)('%s: period and export aggregate agree', (_name, expenses, logs, cost, net, source) => {
    const summary = summarizeFinancialPeriod([load()], [...expenses], [...logs]);
    const agg = aggregate([load()], [...expenses], [...logs]);
    expect(summary.expensesTotal).toBe(cost);
    expect(summary.netProfit).toBe(net);
    expect(summary.fuelPolicy.source).toBe(source);
    expect(summary.costPerMile).toBeCloseTo(cost / 120, 10);
    expect(summary.netRPM).toBeCloseTo(net / 120, 10);
    expect(summary.marginPct).toBeCloseTo(net / 200 * 100, 10);
    expect(agg.summary).toEqual(summary);
    expect(agg.profit.netAfterExpenses).toBe(net);
    expect(agg.profit.profitPerMile).toBe(summary.netRPM);
    expect(agg.profit.fuelCost + agg.profit.expensesTotal).toBe(cost);
    expect(agg.expenseStats.deductibleEstimate).toBe(cost);
    expect(agg.monthly[0].net).toBe(net);
  });

  it('uses realized fallback, canonical mileage, and only completed/legacy loads for every financial bucket', () => {
    const loads = [
      load({ id: 'actual', loaded_miles: 195.45, deadhead_miles: 7, total_miles: 20245, estimated_pay: 166.01, actual_pay_received: 150 }),
      load({ id: 'legacy', status: null, loaded_miles: 0, deadhead_miles: 0, total_miles: 100, estimated_pay: 80 }),
      ...['pending', 'en_route', 'cancelled', 'unknown'].map(status => load({ id: status, status: status as Load['status'], estimated_pay: 9999, actual_pay_received: 9999 })),
    ];
    const before = structuredClone(loads);
    const agg = aggregate(loads, [], []);
    expect(agg.summary.grossRevenue).toBe(230);
    expect(agg.summary.totalMiles).toBeCloseTo(302.45, 8);
    expect(agg.profit.actualPay).toBe(150);
    expect(agg.profit.differenceUnpaid).toBeCloseTo(96.01, 8);
    expect(agg.loadStats.completed).toBe(2);
    expect(agg.cancelledLoads).toHaveLength(1);
    expect(agg.activeLoads).toHaveLength(5); // retained operational details
    expect(agg.monthly[0].loads).toBe(2);
    expect(agg.monthly[0].gross).toBe(230);
    expect(agg.loadStats.payModelBreakdown[0].gross).toBe(230);
    expect(loads).toEqual(before);
  });

  it('tax retains the existing algorithm, deducts canonical fuel once, and excludes unearned actual pay', () => {
    const settings = { tax_estimator_enabled: true, tax_base_type: 'net', federal_tax_percent: 10,
      state_tax_percent: 0, include_se_tax: false, se_tax_percent: 0, buffer_percent: 0 };
    const agg = aggregate([load({ actual_pay_received: 250 }), load({ status: 'en_route', actual_pay_received: 9000 })],
      [expense(900, 'Fuel'), expense(25)], [fuel(50)], range, settings as any);
    expect(agg.tax.grossRevenue).toBe(250);
    expect(agg.tax.totalExpenses).toBe(75);
    expect(agg.tax.netProfit).toBe(175);
    expect(agg.tax.totalTax).toBe(17.5);
    expect(agg.profit.netAfterExpenses).toBe(175);
    expect(agg.profit.netAfterTax).toBe(157.5);
    expect(agg.expenses).toHaveLength(2); // no synthetic persisted/detail row
  });

  it('preserves expected weekly weighted RPM and drop-off Sunday/Monday boundaries', () => {
    const loads = [load({ id: 'sun', load_date: '2026-05-01', dropoff_date: '2026-05-03', actual_pay_received: 150 }),
      load({ id: 'mon', load_date: '2026-05-04', estimated_pay: 100, total_miles: 60, loaded_miles: 50, deadhead_miles: 10 }),
      ...['pending', 'en_route', 'cancelled'].map(status => load({ status: status as Load['status'], estimated_pay: 9000 })),
    ];
    const sunday = getWeekSummaries(loads, 0);
    expect(sunday).toHaveLength(1);
    expect(sunday[0].totalLoads).toBe(2);
    expect(sunday[0].totalEstimatedPay).toBe(300);
    expect(sunday[0].totalActualPay).toBe(150);
    expect(sunday[0].avgRatePerMile).toBeCloseTo(300 / 180, 8);
    expect(summarizeFinancialPeriod(loads).effectiveRPM).toBeCloseTo(250 / 180, 8); // intentionally realized
    const monday = getWeekSummaries(loads, 1);
    expect(monday).toHaveLength(2);
    expect(monday.map(w => w.totalEstimatedPay)).toEqual([100, 200]);
  });

  it('handles zero/null miles without NaN and explicit zero actual pay without fallback', () => {
    const summary = summarizeFinancialPeriod([load({ loaded_miles: 0, deadhead_miles: 0, total_miles: null, actual_pay_received: 0 })], [expense(20)]);
    expect(summary.grossRevenue).toBe(0);
    expect(summary.netProfit).toBe(-20);
    expect([summary.effectiveRPM, summary.netRPM, summary.costPerMile, summary.marginPct]).toEqual([0, 0, 0, 0]);
  });

  it('filters exact selected dates and retains period-wide fuel precedence in monthly buckets', () => {
    const broad = { ...range, from: '2026-04-01' };
    const loads = [load(), load({ load_date: '2026-04-30', estimated_pay: 100 })];
    const expenses = [expense(90, 'Fuel', '2026-04-30'), expense(25)];
    const logs = [fuel(50), fuel(5000, '2026-06-01')];
    const agg = aggregate(loads, expenses, logs, broad);
    expect(agg.summary.grossRevenue).toBe(300);
    expect(agg.summary.expensesTotal).toBe(75);
    expect(agg.monthly.reduce((s, m) => s + m.net, 0)).toBe(225);
    expect(agg.monthly.reduce((s, m) => s + m.fuel + m.expenses, 0)).toBe(75);
    const may = aggregate(loads, expenses, logs);
    expect(may.summary.grossRevenue).toBe(200);
    expect(may.summary.expensesTotal).toBe(75);
    expect(summarizeFinancialPeriod(loads, expenses, logs).expensesTotal).toBe(5075); // all time
  });
});

describe('F1 production page KPIs and generated exports', () => {
  it('renders equal Dashboard/Reports all-time and selected-range headline metrics', () => {
    const loads = [load(), load({ load_date: '2026-04-30', estimated_pay: 100 })];
    const expenses = [expense(900, 'Fuel'), expense(25)];
    state.fuel = [fuel(50), fuel(70, '2026-04-30')];
    const dash = render(createElement(DashboardView, { loads, expenses, fuelLogs: state.fuel, isAssistantView: true }));
    fireEvent.click(dash.getByRole('button', { name: 'All Time', exact: true }));
    const metric = (root: HTMLElement, id: string) => Number(root.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-value'));
    const report = render(createElement(ReportsView, { loads, expenses, isPro: false, canExport: false }));
    for (const [d, r, expected] of [
      ['gross-revenue-v', 'gross-revenue', 300], ['total-expenses', 'total-expenses', 145],
      ['net-profit-v', 'net-profit', 155], ['operating-miles', 'operating-miles', 240],
    ] as const) {
      expect(metric(dash.container, `dashboard-${d}`)).toBe(expected);
      expect(metric(report.container, `reports-${r}`)).toBe(expected);
    }
    fireEvent.click(dash.getByRole('button', { name: 'Custom', exact: true }));
    const dates = dash.container.querySelectorAll('input[type="date"]');
    fireEvent.change(dates[0], { target: { value: range.from } });
    fireEvent.change(dates[1], { target: { value: range.to } });
    const agg = aggregate(loads, expenses, state.fuel);
    expect(metric(dash.container, 'dashboard-total-expenses')).toBe(agg.summary.expensesTotal);
    expect(metric(dash.container, 'dashboard-net-profit-v')).toBe(agg.summary.netProfit);
    expect(metric(dash.container, 'dashboard-effective-rpm')).toBe(agg.summary.effectiveRPM);
  });

  it('CSV and real PDF consume the same numerical aggregate, keeping pending operational status', async () => {
    const agg = aggregate([load(), load({ status: 'pending', estimated_pay: 9000 })], [expense(900, 'Fuel'), expense(25)], [fuel(50)]);
    const csv = buildReportCSV('full_profit', agg);
    expect(csv).toContain('Total Gross Pay,$200.00');
    expect(csv).toContain('Total Expenses,$75.00');
    expect(csv).toContain('Net After Expenses,$125.00');
    expect(csv).toContain('Completed Loads,1');
    const pdf = buildReportPdf('full_profit', agg);
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = reject;
      reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('Expected PDF bytes'));
      reader.readAsArrayBuffer(pdf);
    });
    const raw = Buffer.from(bytes).toString('latin1');
    const streams = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m => {
      try { return inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return m[1]; }
    }).join('\n');
    expect(streams).toContain('($200.00)');
    expect(streams).toContain('($75.00)');
    expect(streams).toContain('($125.00)');
    expect(streams).toContain('(Pending)');
  });
});