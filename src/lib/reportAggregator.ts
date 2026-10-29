import type { Load } from '@/hooks/useLoads';
import type { Expense } from '@/hooks/useExpenses';
import type { FuelLog } from '@/hooks/useFuelLogs';
import type { UserSettings } from '@/hooks/useUserSettings';
import { parseISO, isWithinInterval, endOfDay, format, startOfMonth } from 'date-fns';
import { summarizeFinancialPeriod, excludeCancelled, onlyFinanciallyCompleted, onlyCancelled, getLoadRealizedRevenue } from '@/lib/financialCalculations';
import { getEffectiveDate } from '@/lib/loadUtils';
import { getLoadExpectedPay, getLoadOperatingMiles } from '@/lib/loadMetrics';
import { computeTaxEstimate, type TaxEstimateResult } from '@/lib/reportTax';
import type { DateRange } from '@/lib/reportRanges';
import { toCents, centsToDollars, sumCents } from '@/lib/financialMoney';

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
  /** Operational noncancelled detail rows; never use for financial totals. */
  activeLoads: Load[];
  completedLoads: Load[];
  cancelledLoads: Load[];
  expenses: Expense[];
  fuelLogs: FuelLog[];
  summary: ReturnType<typeof summarizeFinancialPeriod>;
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
/** Recorded money recognized to cents (F3-P1). */
const money = (v: any) => centsToDollars(toCents(v));

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

  const summary = summarizeFinancialPeriod(filteredLoads, filteredExpenses, filteredFuel);
  const { expensesForMath, fuelLogsExist, canonicalFuelTotal } = summary.fuelPolicy;
  const cancelledLoads = onlyCancelled(filteredLoads);
  const activeLoads = excludeCancelled(filteredLoads);
  const completedLoads = onlyFinanciallyCompleted(filteredLoads);

  // Fuel
  const fuelTotalCost = canonicalFuelTotal;
  const fuelTotalGallons = filteredFuel.reduce((s, f) => s + num(f.gallons), 0);
  const fuelCosts = filteredFuel.map(f => money(f.total_cost));
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

  // Tax (in-range) — pass the math-eligible expenses so fuel-category rows
  // are not double-counted when Fuel Logs already supply the fuel cost.
  // When Fuel Logs are canonical, synthesize a single report-only Fuel
  // expense representing the Fuel Log total so tax math deducts fuel
  // exactly once. The synthetic row is never persisted, never surfaced in
  // detail tables, byCategory, or monthly buckets.
  // fuelTotalCost already computed above for fuel stats.
  const syntheticFuelExpenseForTax: Expense | null =
    fuelLogsExist && fuelTotalCost > 0
      ? ({
          id: '__report_only_fuel_logs__',
          user_id: '__report_only__',
          expense_date: range.from,
          category: 'Fuel',
          amount: fuelTotalCost,
          gallons: null,
          linked_load_id: null,
          notes: null,
          expense_type: 'variable',
          created_at: range.from,
          updated_at: range.from,
        } as unknown as Expense)
      : null;
  const taxExpenses = syntheticFuelExpenseForTax
    ? [...expensesForMath, syntheticFuelExpenseForTax]
    : expensesForMath;
  const tax = computeTaxEstimate(completedLoads, taxExpenses, settings);

  // Export breakdown keeps fuel separate; summary.expensesTotal is inclusive.
  const actualPay = summary.actualPay;
  const expectedPay = summary.estimatedPay;
  const differenceUnpaid = centsToDollars(toCents(expectedPay) - toCents(actualPay));
  const grossRevenue = summary.grossRevenue;
  const expensesTotal = summary.fuelPolicy.otherExpensesTotal;
  const netAfterExpenses = summary.netProfit;
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
    profitPerMile: summary.netRPM,
    avgPayPerLoad: summary.loadCount > 0 ? grossRevenue / summary.loadCount : 0,
    avgRatePerMile: summary.effectiveRPM,
  };

  // Expense stats — built from `expensesForMath` so byCategory / totals do
  // not duplicate fuel-category rows already counted via Fuel Logs.
  // Category totals accumulate integer cents, converted once below.
  const catMap = new Map<string, { total: number; count: number }>();
  let largest = 0;
  for (const e of expensesForMath) {
    const amtCents = toCents(e.amount);
    if (amtCents / 100 > largest) largest = amtCents / 100;
    const cur = catMap.get(e.category) ?? { total: 0, count: 0 };
    cur.total = sumCents([cur.total, amtCents]); cur.count += 1;
    catMap.set(e.category, cur);
  }
  const byCategory = [...catMap.entries()]
    .map(([category, v]) => ({ category, total: centsToDollars(v.total), count: v.count }))
    .sort((a, b) => b.total - a.total);
  const catTotal = (name: string) => catMap.get(name)?.total ?? 0;
  const knownCats = new Set(['Fuel', 'Maintenance', 'Repairs', 'Tires', 'Tolls', 'Parking']);
  const otherTotal = centsToDollars(sumCents(byCategory.filter(c => !knownCats.has(c.category)).map(c => toCents(c.total))));
  // Fuel line: prefer Fuel Logs when present, else the Fuel expense category.
  // Never sum both — that was the source of the double-count.
  const fuelStat = canonicalFuelTotal;
  const expenseStats = {
    totalEntries: summary.fuelPolicy.totalEntryCount,
    largest: Math.max(largest, ...fuelCosts, 0),
    average: summary.fuelPolicy.totalEntryCount > 0 ? summary.expensesTotal / summary.fuelPolicy.totalEntryCount : 0,
    byCategory,
    fuel: fuelStat,
    maintenance: centsToDollars(sumCents(['Maintenance', 'Repairs', 'Tires'].map(c => toCents(catTotal(c))))),
    tolls: catTotal('Tolls'),
    parking: catTotal('Parking'),
    other: otherTotal,
    // Deductible = non-fuel expenses + canonical fuel cost (single-counted).
    deductibleEstimate: summary.expensesTotal,
  };


  // Load stats
  let bestPaying: { label: string; amount: number } | null = null;
  let bestMileage: { label: string; miles: number } | null = null;
  const payModelMap = new Map<string, { count: number; gross: number }>();
  for (const l of completedLoads) {
    const pay = getLoadRealizedRevenue(l);
    if (!bestPaying || pay > bestPaying.amount) {
      bestPaying = { label: `${l.pickup_location} → ${l.dropoff_location}`, amount: pay };
    }
    const miles = getLoadOperatingMiles(l);
    if (!bestMileage || miles > bestMileage.miles) {
      bestMileage = { label: `${l.pickup_location} → ${l.dropoff_location}`, miles };
    }
    const m = (l as any).pay_model ?? 'loaded_miles_only';
    const cur = payModelMap.get(m) ?? { count: 0, gross: 0 };
    cur.count += 1; cur.gross = centsToDollars(toCents(cur.gross) + toCents(pay));
    payModelMap.set(m, cur);
  }
  const loadStats = {
    completed: completedLoads.length,
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
  for (const l of completedLoads) {
    const key = format(startOfMonth(parseISO(getEffectiveDate(l))), 'yyyy-MM');
    const cur = monthMap.get(key) ?? { month: key, gross: 0, expenses: 0, fuel: 0, net: 0, loads: 0 };
    cur.gross += getLoadRealizedRevenue(l);
    cur.loads += 1;
    monthMap.set(key, cur);
  }
  for (const e of expensesForMath) {
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
    .map(b => {
      const monthOf = (date: string) => format(startOfMonth(parseISO(date)), 'yyyy-MM');
      // Reuse the period's eligible expense rows so the selected-range fuel
      // policy also holds across months (no excluded Fuel row reintroduced).
      const period = summarizeFinancialPeriod(
        completedLoads.filter(l => monthOf(getEffectiveDate(l)) === b.month),
        expensesForMath.filter(e => monthOf(e.expense_date) === b.month),
        filteredFuel.filter(f => monthOf(f.date) === b.month),
      );
      return { ...b, gross: period.grossRevenue, loads: period.loadCount,
        expenses: period.fuelPolicy.otherExpensesTotal,
        fuel: period.fuelPolicy.canonicalFuelTotal, net: period.netProfit };
    })
    .sort((a, b) => a.month.localeCompare(b.month));

  const isEmpty =
    filteredLoads.length === 0 && filteredExpenses.length === 0 && filteredFuel.length === 0;

  return {
    range,
    loads: filteredLoads,
    activeLoads,
    completedLoads,
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
