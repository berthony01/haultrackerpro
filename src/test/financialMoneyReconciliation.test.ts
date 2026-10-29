import { describe, expect, it } from 'vitest';
import { toCents, sumRecognizedCents } from '@/lib/financialMoney';
import {
  summarizeLoads, summarizeFinancialPeriod, derivePaymentDisplayStatus,
  getPaymentDifference, getLoadNetProfit, getLoadRealizedRevenue,
} from '@/lib/financialCalculations';
import { aggregateReport } from '@/lib/reportAggregator';
import { computeTaxEstimate } from '@/lib/reportTax';
import { buildReportCSV } from '@/lib/reportCsv';
import { estimateFinancialScenario } from '@/lib/financialEstimates';
import type { Load } from '@/hooks/useLoads';
import type { Expense } from '@/hooks/useExpenses';
import type { FuelLog } from '@/hooks/useFuelLogs';
import type { DateRange } from '@/lib/reportRanges';

const range: DateRange = { from: '2026-05-01', to: '2026-06-30', key: 'custom', label: 'May–Jun' };
const load = (over: Partial<Load> = {}): Load => ({
  id: 'l', user_id: 'driver', load_date: '2026-05-04', dropoff_date: null,
  pickup_location: 'A', dropoff_location: 'B', loaded_miles: 100, deadhead_miles: 0,
  total_miles: 100, estimated_pay: 200, actual_pay_received: null, rate_per_mile: 2,
  wait_fee: 0, detention_fee: 0, other_fees: 0, status: 'completed',
  updated_at: '2026-05-04T00:00:00Z', pay_model: 'loaded_miles_only', ...over,
} as Load);
const expense = (over: Partial<Expense> = {}): Expense => ({
  id: 'e', user_id: 'driver', expense_date: '2026-05-04', category: 'Tolls', amount: 0,
  linked_load_id: null, notes: null, expense_type: 'variable', ...over,
} as Expense);
const fuelLog = (over: Partial<FuelLog> = {}): FuelLog => ({
  id: 'f', user_id: 'driver', date: '2026-05-04', gallons: 10, total_cost: 0, ...over,
} as FuelLog);
const taxSettings = { tax_estimator_enabled: true, federal_tax_percent: 10, state_tax_percent: 0, include_se_tax: false, buffer_percent: 0, tax_base_type: 'net' } as any;

describe('F3-P1 toCents — half away from zero from decimal text', () => {
  it.each([
    [0.005, 1], [1.005, 101], [2.675, 268], ['1.005', 101], [-0.005, -1], [-1.005, -101],
    [-2.675, -268], [0.0049, 0], [166.01, 16601], ['  12.3 ', 1230], [1e-7, 0], [1.5e3, 150000],
  ])('%s → %s cents', (v, c) => expect(toCents(v)).toBe(c));
  it.each([null, undefined, '', 'abc', NaN, Infinity, '.'])('invalid %s recognizes as 0', v => expect(toCents(v)).toBe(0));
  it('guards overflow', () => expect(() => toCents(1e20)).toThrow(RangeError));
});

describe('F3-P1 canonical engine sums per-record recognized cents', () => {
  it('sums sub-penny load revenues as individually rounded cents (not raw float sum)', () => {
    // Raw sum 3 × 100.005 = 300.015; per-line cents = 3 × 100.01 = 300.03.
    const loads = [1, 2, 3].map(i => load({ id: `l${i}`, estimated_pay: 100.005 }));
    const s = summarizeLoads(loads);
    expect(s.grossRevenue).toBe(300.03);
    expect(s.estimatedPay).toBe(300.03);
    expect(getLoadRealizedRevenue(loads[0])).toBe(100.01);
    expect(sumRecognizedCents(loads, l => l.estimated_pay)).toBe(30003);
  });
  it('counts only completed + legacy null statuses as earned', () => {
    const loads = [
      load({ id: 'c', estimated_pay: 1.005 }), load({ id: 'n', status: null as any, estimated_pay: 2.675 }),
      load({ id: 'p', status: 'pending', estimated_pay: 999 }), load({ id: 'r', status: 'en_route', estimated_pay: 999 }),
      load({ id: 'x', status: 'cancelled', estimated_pay: 999 }),
    ];
    const s = summarizeLoads(loads);
    expect(s.grossRevenue).toBe(3.69);
    expect(s.loadCount).toBe(2);
    expect(s.cancelledCount).toBe(1);
  });
  it('preserves negative expense corrections and nets in cents', () => {
    const s = summarizeLoads([load({ estimated_pay: 100 })], [
      expense({ id: 'a', amount: 10.005 }), expense({ id: 'b', amount: -2.675 }),
    ]);
    expect(s.expensesTotal).toBe(7.33); // 10.01 − 2.68
    expect(s.netProfit).toBe(92.67);
    expect(getLoadNetProfit(load({ estimated_pay: 100 }), [expense({ amount: 0.005 })])).toBe(99.99);
  });
  it('treats a one-cent underpayment as real; exact cents as paid', () => {
    const paid = load({ estimated_pay: 166.005, actual_pay_received: 166.01 });
    const under = load({ id: 'u', estimated_pay: 166.01, actual_pay_received: 166.0 });
    expect(derivePaymentDisplayStatus(paid)).toBe('paid');
    expect(derivePaymentDisplayStatus(under)).toBe('underpaid');
    expect(getPaymentDifference(under)).toBe(-0.01);
    const s = summarizeLoads([paid, under, load({ id: 'p', estimated_pay: 0.005 })]);
    expect(s.underpaidCount).toBe(1);
    expect(s.paymentDifferenceTotal).toBe(-0.01);
    expect(s.pendingPaymentEstimated).toBe(0.01);
  });
  it('single-counts fuel: logs replace Fuel expenses, else Fuel expenses used', () => {
    const exps = [expense({ id: 'f', category: 'Fuel', amount: 50.005 }), expense({ id: 't', amount: 1.005 })];
    const withLogs = summarizeFinancialPeriod([load()], exps, [fuelLog({ total_cost: 20.005 }), fuelLog({ id: 'g', total_cost: 0.005 })]);
    expect(withLogs.fuelPolicy.canonicalFuelTotal).toBe(20.02);
    expect(withLogs.expensesTotal).toBe(21.03);
    expect(withLogs.fuelPolicy.otherExpensesTotal).toBe(1.01);
    expect(withLogs.netProfit).toBe(178.97);
    const noLogs = summarizeFinancialPeriod([load()], exps, []);
    expect(noLogs.fuelPolicy.canonicalFuelTotal).toBe(50.01);
    expect(noLogs.expensesTotal).toBe(51.02);
  });
  it('zero-mile completed load keeps money and returns zero ratios', () => {
    const s = summarizeFinancialPeriod([load({ loaded_miles: 0, deadhead_miles: 0, total_miles: 0, estimated_pay: 0.005 })]);
    expect(s.grossRevenue).toBe(0.01);
    expect(s.effectiveRPM).toBe(0);
    expect(s.netRPM).toBe(0);
  });
});

describe('F3-P1 report / tax / CSV reconciliation', () => {
  const loads = [
    load({ id: 'm1', estimated_pay: 100.005 }), load({ id: 'm2', load_date: '2026-06-03', estimated_pay: 200.005, actual_pay_received: 200 }),
    load({ id: 'p', status: 'pending', estimated_pay: 500 }),
  ];
  const exps = [
    expense({ id: 'e1', amount: 10.005 }), expense({ id: 'e2', expense_date: '2026-06-03', category: 'Parking', amount: 1.005 }),
    expense({ id: 'e3', expense_date: '2026-06-04', category: 'Tolls', amount: -0.005 }), expense({ id: 'fx', category: 'Fuel', amount: 99 }),
  ];
  const fuel = [fuelLog({ total_cost: 30.005 }), fuelLog({ id: 'g', date: '2026-06-05', total_cost: 2.675 })];
  const agg = aggregateReport({ loads, expenses: exps, fuelLogs: fuel, settings: taxSettings, range, preparedFor: 'x' });

  it('aggregate profit equals canonical cents', () => {
    expect(agg.profit.grossRevenue).toBe(300.01); // 100.01 + 200.00
    expect(agg.profit.fuelCost).toBe(32.69);
    expect(agg.profit.expensesTotal).toBe(11.01); // 10.01 + 1.01 − 0.01
    expect(agg.profit.netAfterExpenses).toBe(256.31);
    expect(agg.profit.differenceUnpaid).toBe(100.02);
  });
  it('category and monthly buckets reconcile to the period totals', () => {
    const cat = agg.expenseStats.byCategory;
    expect(cat.find(c => c.category === 'Tolls')!.total).toBe(10);
    expect(cat.find(c => c.category === 'Parking')!.total).toBe(1.01);
    expect(cat.some(c => c.category === 'Fuel')).toBe(false);
    const cents = (xs: number[]) => xs.reduce((s, v) => s + Math.round(v * 100), 0);
    expect(cents(agg.monthly.map(m => m.gross))).toBe(30001);
    expect(cents(agg.monthly.map(m => m.expenses))).toBe(1101);
    expect(cents(agg.monthly.map(m => m.fuel))).toBe(3269);
    expect(cents(agg.monthly.map(m => m.net))).toBe(25631);
  });
  it('tax input equals recognized money; tax formula unchanged', () => {
    expect(agg.tax.grossRevenue).toBe(300.01);
    expect(agg.tax.totalExpenses).toBe(43.7); // 11.01 + synthetic fuel 32.69
    expect(agg.tax.netProfit).toBe(256.31);
    expect(agg.tax.totalTax).toBeCloseTo(25.631, 10);
    const direct = computeTaxEstimate([load({ estimated_pay: 1.005 })], [expense({ amount: 0.005 })], taxSettings);
    expect(direct.netProfit).toBe(1);
  });
  it('CSV prints the same reconciled totals', () => {
    const csv = buildReportCSV('full_profit' as any, agg as any);
    expect(csv).toContain('300.01');
    expect(csv).toContain('256.31');
  });
});

describe('F3-P1 what-if 4-decimal per-mile from reconciled cents', () => {
  it('keeps $900 / $0.7500 and 4-decimal rate', () => {
    const r = estimateFinancialScenario({ miles: 1200, revenue: { kind: 'gross', grossPay: 3200 }, nonFuelCostPerMile: 1.5, fuel: { kind: 'total', totalCost: 400 }, otherExpenses: 100 });
    if (r.ok === false) throw new Error('fail');
    expect(r.estimate.operatingProfit).toBe(900);
    expect(r.estimate.operatingProfitPerMile.toFixed(4)).toBe('0.7500');
    expect(r.estimate.ratePerMile).toBe(2.6667);
  });
  it('after-tax per mile uses reconciled after-tax cents', () => {
    const r = estimateFinancialScenario({ miles: 3, revenue: { kind: 'gross', grossPay: 10 }, fuel: { kind: 'total', totalCost: 0 }, taxReservePercent: 10 });
    if (r.ok === false) throw new Error('fail');
    expect(r.estimate.afterTaxEstimate).toBe(9);
    expect(r.estimate.profitPerMile).toBe(3);
    expect(r.estimate.operatingProfitPerMile).toBe(3.3333);
  });
});

describe('F3-P1 correction — expense category stats are dollars, not cents', () => {
  const exps = [
    expense({ id: 'm', category: 'Maintenance', amount: 100.05 }),
    expense({ id: 'r', category: 'Repairs', amount: 23.45 }),
    expense({ id: 't', category: 'Tires', amount: 1 }),
    expense({ id: 'to', category: 'Tolls', amount: 7.3 }),
    expense({ id: 'p', category: 'Parking', amount: 4.2 }),
    expense({ id: 'dup', category: 'Fuel', amount: 300 }), // duplicate; fuel logs win
  ];
  const fuel = [fuelLog({ total_cost: 150.25 }), fuelLog({ id: 'g', total_cost: 49.75 })];
  const agg = aggregateReport({ loads: [load({ estimated_pay: 1000 })], expenses: exps, fuelLogs: fuel, settings: null, range, preparedFor: 'x' });

  it('maintenance/tolls/parking/fuel are exact dollars', () => {
    expect(agg.expenseStats.maintenance).toBe(124.5);
    expect(agg.expenseStats.tolls).toBe(7.3);
    expect(agg.expenseStats.parking).toBe(4.2);
    expect(agg.expenseStats.fuel).toBe(200);
    expect(agg.expenseStats.other).toBe(0);
  });
  it('category totals + canonical fuel equal the canonical summary (no double count)', () => {
    const byCat = agg.expenseStats.byCategory.reduce((s, c) => s + Math.round(c.total * 100), 0);
    expect(agg.expenseStats.byCategory.some(c => c.category === 'Fuel')).toBe(false);
    expect(byCat).toBe(13600);
    expect(byCat + Math.round(agg.expenseStats.fuel * 100)).toBe(Math.round(agg.summary.expensesTotal * 100));
    expect(agg.summary.expensesTotal).toBe(336);
    expect(agg.expenseStats.deductibleEstimate).toBe(336);
  });
  it('expense PDF prints dollar values', async () => {
    const { buildReportPdf } = await import('@/lib/reportPdf');
    const { inflateSync } = await import('node:zlib');
    const pdf = buildReportPdf('expense', agg);
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = reject;
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(pdf);
    });
    const raw = Buffer.from(bytes).toString('latin1');
    const text = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m => {
      try { return inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return m[1]; }
    }).join('\n');
    for (const v of ['($124.50)', '($7.30)', '($4.20)', '($200.00)', '($336.00)']) expect(text).toContain(v);
    expect(text).not.toContain('$12,450.00');
    expect(text).not.toContain('$730.00');
  });
});
