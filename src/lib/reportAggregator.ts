import type { Load } from '@/hooks/useLoads';
import type { Expense } from '@/hooks/useExpenses';
import type { FuelLog } from '@/hooks/useFuelLogs';
import type { UserSettings } from '@/hooks/useUserSettings';
import { parseISO, isWithinInterval, endOfDay } from 'date-fns';
import { summarizeLoads, excludeCancelled } from '@/lib/financialCalculations';
import { getEffectiveDate } from '@/lib/loadUtils';
import { computeTaxEstimate, type TaxEstimateResult } from '@/lib/reportTax';
import type { DateRange } from '@/lib/reportRanges';

export type ReportType =
  | 'full_profit'
  | 'load_summary'
  | 'expense'
  | 'fuel'
  | 'mileage'
  | 'tax_estimate'
  | 'settlement_dispute'
  | 'year_end_tax';

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  full_profit: 'Full Profit Report',
  load_summary: 'Load Summary Report',
  expense: 'Expense Report',
  fuel: 'Fuel Report',
  mileage: 'Mileage Report',
  tax_estimate: 'Tax Estimate Report',
  settlement_dispute: 'Settlement Dispute Report',
  year_end_tax: 'Year-End Tax Prep Report',
};

export interface ReportAggregation {
  range: DateRange;
  loads: Load[];
  expenses: Expense[];
  fuelLogs: FuelLog[];
  summary: ReturnType<typeof summarizeLoads>;
  fuel: {
    totalCost: number;
    totalGallons: number;
    avgPricePerGallon: number;
    fuelCostPerMile: number;
  };
  tax: TaxEstimateResult;
  profit: {
    grossRevenue: number;
    fuelCost: number;
    expensesTotal: number;
    estimatedTaxReserve: number;
    netAfterExpenses: number;
    netAfterTax: number;
    profitPerMile: number;
    avgPayPerLoad: number;
  };
  preparedFor: string;
  isEmpty: boolean;
}

function inRange(dateStr: string, range: DateRange): boolean {
  const d = parseISO(dateStr);
  const start = parseISO(range.from);
  const end = endOfDay(parseISO(range.to));
  return isWithinInterval(d, { start, end });
}

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

  const fuelTotalCost = filteredFuel.reduce((s, f) => s + Number(f.total_cost), 0);
  const fuelTotalGallons = filteredFuel.reduce((s, f) => s + Number(f.gallons), 0);
  const fuel = {
    totalCost: fuelTotalCost,
    totalGallons: fuelTotalGallons,
    avgPricePerGallon: fuelTotalGallons > 0 ? fuelTotalCost / fuelTotalGallons : 0,
    fuelCostPerMile: summary.totalMiles > 0 ? fuelTotalCost / summary.totalMiles : 0,
  };

  // Tax: use shared formula, applied to in-range data only
  const tax = computeTaxEstimate(excludeCancelled(filteredLoads), filteredExpenses, settings);

  const grossRevenue = summary.grossRevenue;
  const expensesTotal = summary.expensesTotal; // already from filteredExpenses
  const netAfterExpenses = grossRevenue - expensesTotal - fuel.totalCost;
  const netAfterTax = netAfterExpenses - tax.totalTax;
  const profit = {
    grossRevenue,
    fuelCost: fuel.totalCost,
    expensesTotal,
    estimatedTaxReserve: tax.totalTax,
    netAfterExpenses,
    netAfterTax,
    profitPerMile: summary.totalMiles > 0 ? netAfterExpenses / summary.totalMiles : 0,
    avgPayPerLoad: summary.loadCount > 0 ? grossRevenue / summary.loadCount : 0,
  };

  const isEmpty =
    filteredLoads.length === 0 && filteredExpenses.length === 0 && filteredFuel.length === 0;

  return {
    range,
    loads: filteredLoads,
    expenses: filteredExpenses,
    fuelLogs: filteredFuel,
    summary,
    fuel,
    tax,
    profit,
    preparedFor,
    isEmpty,
  };
}
