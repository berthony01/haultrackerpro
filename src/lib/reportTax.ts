// Tax estimate — extracted verbatim from src/components/TaxEstimateCard.tsx
// DO NOT modify the formula. Reuses the exact IRS SE method already shipped.
import type { Load } from '@/hooks/useLoads';
import type { Expense } from '@/hooks/useExpenses';
import type { UserSettings } from '@/hooks/useUserSettings';

export interface TaxEstimateResult {
  enabled: boolean;
  seTax: number;
  federalTax: number;
  stateTax: number;
  bufferTax: number;
  totalTax: number;
  netProfit: number;
  grossRevenue: number;
  totalExpenses: number;
  profitAfterTax: number;
  baseLabel: 'gross' | 'net';
  totalPercent: number;
}

export function computeTaxEstimate(
  loads: Load[],
  expenses: Expense[],
  settings: UserSettings | null,
): TaxEstimateResult {
  const empty: TaxEstimateResult = {
    enabled: false, seTax: 0, federalTax: 0, stateTax: 0, bufferTax: 0,
    totalTax: 0, netProfit: 0, grossRevenue: 0, totalExpenses: 0,
    profitAfterTax: 0, baseLabel: 'net', totalPercent: 0,
  };
  if (!settings?.tax_estimator_enabled) return empty;

  const federalRate = Number(settings.federal_tax_percent ?? 0) / 100;
  const stateRate = Number(settings.state_tax_percent ?? 0) / 100;
  const includeSE = settings.include_se_tax ?? false;
  const seRate = includeSE ? Number(settings.se_tax_percent ?? 15.3) / 100 : 0;
  const bufferRate = Number(settings.buffer_percent ?? 0) / 100;

  const totalRate = federalRate + stateRate + seRate + bufferRate;

  const paidLoads = loads.filter(l => l.actual_pay_received != null);
  const grossRevenue =
    paidLoads.reduce((s, l) => s + Number(l.actual_pay_received ?? 0), 0) +
    loads.filter(l => l.actual_pay_received == null).reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);

  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const netProfit = grossRevenue - totalExpenses;
  const baseLabel: 'gross' | 'net' = settings.tax_base_type === 'gross' ? 'gross' : 'net';
  const taxBase = baseLabel === 'gross' ? grossRevenue : netProfit;

  if (totalRate <= 0 || taxBase <= 0) {
    return {
      ...empty, enabled: true,
      grossRevenue, totalExpenses, netProfit, profitAfterTax: netProfit,
      baseLabel, totalPercent: totalRate * 100,
    };
  }

  const seAdjustedBase = taxBase * 0.9235;
  const seTax = includeSE ? seAdjustedBase * seRate : 0;
  const seDeduction = seTax / 2;
  const incomeForIncomeTax = Math.max(0, taxBase - seDeduction);
  const federalTax = incomeForIncomeTax * federalRate;
  const stateTax = incomeForIncomeTax * stateRate;
  const bufferTax = taxBase * bufferRate;
  const totalTax = seTax + federalTax + stateTax + bufferTax;

  return {
    enabled: true,
    seTax, federalTax, stateTax, bufferTax, totalTax,
    netProfit, grossRevenue, totalExpenses,
    profitAfterTax: netProfit - totalTax,
    baseLabel,
    totalPercent: totalRate * 100,
  };
}

export const TAX_DISCLAIMER =
  'Estimated tax reserve is based on your current HaulTracker Pro settings and is not tax advice.';
