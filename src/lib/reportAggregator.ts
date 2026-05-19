import type { Load } from '@/hooks/useLoads';
import type { Expense } from '@/hooks/useExpenses';
import type { FuelLog } from '@/hooks/useFuelLogs';
import type { UserSettings } from '@/hooks/useUserSettings';
import { parseISO, isWithinInterval, endOfDay, format, startOfMonth } from 'date-fns';
import { summarizeLoads, excludeCancelled, onlyCancelled } from '@/lib/financialCalculations';
import { getEffectiveDate } from '@/lib/loadUtils';
import { getLoadExpectedPay, getLoadOperatingMiles } from '@/lib/loadMetrics';
import { computeTaxEstimate, type TaxEstimateResult } from '@/lib/reportTax';
import type { DateRange } from '@/lib/reportRanges';

export type ReportType =
  | 'full_profit'
  | 'weekly_performance'
  | 'load_summary'
  | 'expense'
  | 'fuel'
  | 'mileage'
  | 'tax_estimate'
  | 'settlement_dispute'
  | 'year_end_tax';

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  full_profit: 'Full Profit Report',
  weekly_performance: 'Weekly Performance Report',
  load_summary: 'Load Summary Report',
  expense: 'Expense Report',
  fuel: 'Fuel Report',
  mileage: 'Mileage Report',
  tax_estimate: 'Tax Estimate Report',
  settlement_dispute: 'Settlement Dispute Report',
  year_end_tax: 'Year-End Tax Prep Report',
};

export const REPORT_SUBTITLES: Record<ReportType, string> = {
  full_profit: 'Profit, Expenses & Tax Summary',
  weekly_performance: 'Weekly Performance Snapshot',
  load_summary: 'Load Activity Summary',
  expense: 'Expense Detail & Categories',
  fuel: 'Fuel Cost & Efficiency Detail',
  mileage: 'Mileage & Pay Per Mile',
  tax_estimate: 'Estimated Tax Reserve',
  settlement_dispute: 'Settlement & Pay Discrepancy',
  year_end_tax: 'Annual Tax Prep Summary',
};

export interface CategoryTotal { category: string; total: number; count: number }
export interface MonthlyBucket { month: string; gross: number; expenses: number; fuel: number; net: number; loads: number }

export interface ReportAggregation {
  range: DateRange;
  /** All in-range loads (active + cancelled). Kept for backward compat. */
  loads: Load[];
  /** In-range loads with `status !== 'cancelled'`. Use for revenue/lane/broker breakdowns. */
  activeLoads: Load[];
  cancelledLoads: Load[];
  expenses: Expense[];
  fuelLogs: FuelLog[];
  summary: ReturnType<typeof summarizeLoads>;
  fuel: {
    totalCost: number;
    totalGallons: number;
    avgPricePerGallon: number;
    fuelCostPerMile: number;
    stops: number;
    highestPurchase: number;
    lowestPurchase: number;
    avgFuelCostPerLoad: number;
  };
  tax: TaxEstimateResult;
  profit: {
    grossRevenue: number;
    actualPay: number;
    differenceUnpaid: number;
    fuelCost: number;
    expensesTotal: number;
    estimatedTaxReserve: number;
    netAfterExpenses: number;
    netAfterTax: number;
    profitPerMile: number;
    avgPayPerLoad: number;
    avgRatePerMile: number;
  };
  expenseStats: {
    totalEntries: number;
    largest: number;
    average: number;
    byCategory: CategoryTotal[];
    fuel: number;
    maintenance: number;
    tolls: number;
    parking: number;
    other: number;
    deductibleEstimate: number;
  };
  loadStats: {
    completed: number;
    cancelled: number;
    bestPaying: { label: string; amount: number } | null;
    bestMileage: { label: string; miles: number } | null;
    payModelBreakdown: { model: string; count: number; gross: number }[];
    avgMilesPerLoad: number;
    revenuePerLoadedMile: number;
    realPayPerTotalMile: number;
    deadheadPct: number;
  };
  monthly: MonthlyBucket[];
  preparedFor: string;
  isEmpty: boolean;
}

function inRange(dateStr: string, range: DateRange): boolean {
  const d = parseISO(dateStr);
  const start = parseISO(range.from);
  const end = endOfDay(parseISO(range.to));
  return isWithinInterval(d, { start, end });
}

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function aggregateReport(args: {
  loads: Load[];
  expenses: Expense[];
  fuelLogs: FuelLog[];
  settings: UserSettings | null;
  range: DateRange;
  preparedFor: string;
}): ReportAggregation {
  const { loads, expenses, fuelLogs, settings, range, preparedFor } = args;

  const filteredLoads = loads.filter(l => inRange(getEffectiveDate(l), range));
  const filteredExpenses = expenses.filter(e => inRange(e.expense_date, range));
  const filteredFuel = fuelLogs.filter(f => inRange(f.date, range));

  const summary = summarizeLoads(filteredLoads, filteredExpenses);
  const cancelledLoads = onlyCancelled(filteredLoads);
  const activeLoads = excludeCancelled(filteredLoads);

  // Fuel
  const fuelTotalCost = filteredFuel.reduce((s, f) => s + num(f.total_cost), 0);
  const fuelTotalGallons = filteredFuel.reduce((s, f) => s + num(f.gallons), 0);
  const fuelCosts = filteredFuel.map(f => num(f.total_cost));
  const fuel = {
    totalCost: fuelTotalCost,
    totalGallons: fuelTotalGallons,
    avgPricePerGallon: fuelTotalGallons > 0 ? fuelTotalCost / fuelTotalGallons : 0,
    fuelCostPerMile: summary.totalMiles > 0 ? fuelTotalCost / summary.totalMiles : 0,
    stops: filteredFuel.length,
    highestPurchase: fuelCosts.length ? Math.max(...fuelCosts) : 0,
    lowestPurchase: fuelCosts.length ? Math.min(...fuelCosts) : 0,
    avgFuelCostPerLoad: summary.loadCount > 0 ? fuelTotalCost / summary.loadCount : 0,
  };

  // Tax (in-range)
  const tax = computeTaxEstimate(activeLoads, filteredExpenses, settings);

  // Profit
  const actualPay = activeLoads.reduce(
    (s, l) => s + (l.actual_pay_received != null ? num(l.actual_pay_received) : 0), 0);
  const expectedPay = activeLoads.reduce((s, l) => s + getLoadExpectedPay(l), 0);
  const differenceUnpaid = expectedPay - actualPay;
  const grossRevenue = summary.grossRevenue;
  const expensesTotal = summary.expensesTotal;
  const netAfterExpenses = grossRevenue - expensesTotal - fuel.totalCost;
  const netAfterTax = netAfterExpenses - tax.totalTax;
  const profit = {
    grossRevenue,
    actualPay,
    differenceUnpaid,
    fuelCost: fuel.totalCost,
    expensesTotal,
    estimatedTaxReserve: tax.totalTax,
    netAfterExpenses,
    netAfterTax,
    profitPerMile: summary.totalMiles > 0 ? netAfterExpenses / summary.totalMiles : 0,
    avgPayPerLoad: summary.loadCount > 0 ? grossRevenue / summary.loadCount : 0,
    avgRatePerMile: summary.totalMiles > 0 ? grossRevenue / summary.totalMiles : 0,
  };

  // Expense stats
  const catMap = new Map<string, { total: number; count: number }>();
  let largest = 0;
  for (const e of filteredExpenses) {
    const amt = num(e.amount);
    if (amt > largest) largest = amt;
    const cur = catMap.get(e.category) ?? { total: 0, count: 0 };
    cur.total += amt; cur.count += 1;
    catMap.set(e.category, cur);
  }
  const byCategory = [...catMap.entries()]
    .map(([category, v]) => ({ category, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total);
  const catTotal = (name: string) => catMap.get(name)?.total ?? 0;
  const knownCats = new Set(['Fuel', 'Maintenance', 'Repairs', 'Tires', 'Tolls', 'Parking']);
  const otherTotal = byCategory.filter(c => !knownCats.has(c.category)).reduce((s, c) => s + c.total, 0);
  const expenseStats = {
    totalEntries: filteredExpenses.length,
    largest,
    average: filteredExpenses.length > 0 ? expensesTotal / filteredExpenses.length : 0,
    byCategory,
    fuel: catTotal('Fuel') + fuel.totalCost,
    maintenance: catTotal('Maintenance') + catTotal('Repairs') + catTotal('Tires'),
    tolls: catTotal('Tolls'),
    parking: catTotal('Parking'),
    other: otherTotal,
    deductibleEstimate: expensesTotal + fuel.totalCost,
  };

  // Load stats
  let bestPaying: { label: string; amount: number } | null = null;
  let bestMileage: { label: string; miles: number } | null = null;
  const payModelMap = new Map<string, { count: number; gross: number }>();
  for (const l of activeLoads) {
    const pay = getLoadExpectedPay(l);
    if (!bestPaying || pay > bestPaying.amount) {
      bestPaying = { label: `${l.pickup_location} → ${l.dropoff_location}`, amount: pay };
    }
    const miles = getLoadOperatingMiles(l);
    if (!bestMileage || miles > bestMileage.miles) {
      bestMileage = { label: `${l.pickup_location} → ${l.dropoff_location}`, miles };
    }
    const m = (l as any).pay_model ?? 'loaded_miles_only';
    const cur = payModelMap.get(m) ?? { count: 0, gross: 0 };
    cur.count += 1; cur.gross += pay;
    payModelMap.set(m, cur);
  }
  const loadStats = {
    completed: activeLoads.length,
    cancelled: cancelledLoads.length,
    bestPaying,
    bestMileage,
    payModelBreakdown: [...payModelMap.entries()].map(([model, v]) => ({ model, ...v })),
    avgMilesPerLoad: summary.loadCount > 0 ? summary.totalMiles / summary.loadCount : 0,
    revenuePerLoadedMile: summary.loadedMiles > 0 ? grossRevenue / summary.loadedMiles : 0,
    realPayPerTotalMile: summary.totalMiles > 0 ? actualPay / summary.totalMiles : 0,
    deadheadPct: summary.deadheadPct,
  };

  // Monthly breakdown (year-end)
  const monthMap = new Map<string, MonthlyBucket>();
  for (const l of activeLoads) {
    const key = format(startOfMonth(parseISO(getEffectiveDate(l))), 'yyyy-MM');
    const cur = monthMap.get(key) ?? { month: key, gross: 0, expenses: 0, fuel: 0, net: 0, loads: 0 };
    cur.gross += getLoadExpectedPay(l);
    cur.loads += 1;
    monthMap.set(key, cur);
  }
  for (const e of filteredExpenses) {
    const key = format(startOfMonth(parseISO(e.expense_date)), 'yyyy-MM');
    const cur = monthMap.get(key) ?? { month: key, gross: 0, expenses: 0, fuel: 0, net: 0, loads: 0 };
    cur.expenses += num(e.amount);
    monthMap.set(key, cur);
  }
  for (const f of filteredFuel) {
    const key = format(startOfMonth(parseISO(f.date)), 'yyyy-MM');
    const cur = monthMap.get(key) ?? { month: key, gross: 0, expenses: 0, fuel: 0, net: 0, loads: 0 };
    cur.fuel += num(f.total_cost);
    monthMap.set(key, cur);
  }
  const monthly = [...monthMap.values()]
    .map(b => ({ ...b, net: b.gross - b.expenses - b.fuel }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const isEmpty =
    filteredLoads.length === 0 && filteredExpenses.length === 0 && filteredFuel.length === 0;

  return {
    range,
    loads: filteredLoads,
    cancelledLoads,
    expenses: filteredExpenses,
    fuelLogs: filteredFuel,
    summary,
    fuel,
    tax,
    profit,
    expenseStats,
    loadStats,
    monthly,
    preparedFor,
    isEmpty,
  };
}
