import type { ReportAggregation, ReportType } from '@/lib/reportAggregator';
import { REPORT_TYPE_LABELS } from '@/lib/reportAggregator';
import { TAX_DISCLAIMER } from '@/lib/reportTax';
import { getEffectiveDate } from '@/lib/loadUtils';
import { getLoadExpectedPay, getLoadOperatingMiles } from '@/lib/loadMetrics';
import { format, parseISO } from 'date-fns';

// ── Formatting helpers ────────────────────────────────────────────────
const esc = (v: string | number | null | undefined): string => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (...cells: (string | number | null | undefined)[]) =>
  cells.map(esc).join(',');
const blank = () => '';

const money = (n: number): string => {
  if (!Number.isFinite(n)) return '$0.00';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `($${abs})` : `$${abs}`;
};
const miles = (n: number): string =>
  Number.isFinite(n)
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
const pct = (n: number): string => `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;
const intStr = (n: number): string => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0');
const safeDate = (s?: string | null): string => {
  if (!s) return '';
  try { return format(parseISO(s), 'MM/dd/yyyy'); } catch { return s; }
};

const PAY_MODEL_LABELS: Record<string, string> = {
  loaded_miles_only: 'Loaded Miles Only',
  total_miles: 'Total Miles',
  loaded_plus_deadhead: 'Loaded + Deadhead',
  flat_rate: 'Flat Rate',
  manual: 'Manual',
};
const payModelLabel = (m?: string | null) =>
  m ? (PAY_MODEL_LABELS[m] ?? m.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())) : 'Loaded Miles Only';

const STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  cancelled: 'Cancelled',
  pending: 'Pending',
};
const statusLabel = (s?: string | null) =>
  s ? (STATUS_LABELS[s] ?? s.charAt(0).toUpperCase() + s.slice(1)) : 'Completed';

// ── Builder ───────────────────────────────────────────────────────────
export function buildReportCSV(type: ReportType, agg: ReportAggregation): string {
  const lines: string[] = [];
  const title = REPORT_TYPE_LABELS[type];

  // SECTION 1 — Header
  lines.push(row(`HaulTracker Pro — ${title}`));
  lines.push(row('Website', 'haultrackerpro.com'));
  lines.push(row('Prepared For', agg.preparedFor));
  lines.push(row('Date Range', `${safeDate(agg.range.from)} to ${safeDate(agg.range.to)}`));
  lines.push(row('Generated', format(new Date(), 'MM/dd/yyyy HH:mm')));
  lines.push(blank());

  // SECTION 2 — Executive Summary
  lines.push(row('EXECUTIVE SUMMARY'));
  lines.push(row('Metric', 'Value'));
  lines.push(row('Total Loads', intStr(agg.summary.loadCount + agg.loadStats.cancelled)));
  lines.push(row('Completed Loads', intStr(agg.loadStats.completed)));
  lines.push(row('Cancelled Loads', intStr(agg.loadStats.cancelled)));
  lines.push(row('Total Gross Pay', money(agg.profit.grossRevenue)));
  lines.push(row('Actual Pay', money(agg.profit.actualPay)));
  lines.push(row('Difference / Unpaid', money(agg.profit.differenceUnpaid)));
  lines.push(row('Loaded Miles', miles(agg.summary.loadedMiles)));
  lines.push(row('Deadhead Miles', miles(agg.summary.deadheadMiles)));
  lines.push(row('Total Miles', miles(agg.summary.totalMiles)));
  lines.push(row('Deadhead %', pct(agg.loadStats.deadheadPct)));
  lines.push(row('Average Rate Per Mile', money(agg.profit.avgRatePerMile)));
  lines.push(row('Average Pay Per Load', money(agg.profit.avgPayPerLoad)));
  lines.push(row('Fuel Cost', money(agg.profit.fuelCost)));
  lines.push(row('Other Expenses', money(agg.profit.expensesTotal)));
  lines.push(row('Total Expenses', money(agg.profit.fuelCost + agg.profit.expensesTotal)));
  lines.push(row('Estimated Tax Reserve', money(agg.profit.estimatedTaxReserve)));
  lines.push(row('Net After Expenses', money(agg.profit.netAfterExpenses)));
  lines.push(row('Net After Estimated Tax', money(agg.profit.netAfterTax)));
  lines.push(row('Profit Per Mile', money(agg.profit.profitPerMile)));
  lines.push(blank());

  // SECTION 3 — Performance Snapshot (profit-related types)
  const wantsSnapshot = type === 'full_profit' || type === 'weekly_performance' || type === 'year_end_tax';
  if (wantsSnapshot) {
    lines.push(row('PERFORMANCE SNAPSHOT'));
    lines.push(row('Metric', 'Value'));
    lines.push(row('Gross Pay', money(agg.profit.grossRevenue)));
    lines.push(row('Minus Fuel + Expenses', money(-(agg.profit.fuelCost + agg.profit.expensesTotal))));
    lines.push(row('Minus Estimated Tax Reserve', money(-agg.profit.estimatedTaxReserve)));
    lines.push(row('Estimated Net Profit', money(agg.profit.netAfterTax)));
    lines.push(blank());
  }

  // SECTION 4 — Detailed tables (gated by report type, same as before)
  const wantsLoads = type !== 'expense' && type !== 'fuel' && type !== 'tax_estimate';
  const wantsExpenses = type === 'full_profit' || type === 'weekly_performance' || type === 'expense' || type === 'year_end_tax';
  const wantsFuel = type === 'full_profit' || type === 'weekly_performance' || type === 'fuel' || type === 'year_end_tax' || type === 'mileage';
  const wantsTax = type === 'full_profit' || type === 'tax_estimate' || type === 'year_end_tax';

  if (agg.isEmpty) {
    lines.push(row('No data found in the selected date range.'));
    lines.push(blank());
  }

  if (wantsLoads && agg.loads.length > 0) {
    lines.push(row('LOAD BREAKDOWN'));
    lines.push(row('Date', 'Pickup', 'Dropoff', 'Loaded Mi', 'Deadhead Mi', 'Total Mi', 'Pay Model', 'Estimated Pay', 'Actual Pay', 'Status', 'Notes'));
    for (const l of agg.loads) {
      lines.push(row(
        safeDate(getEffectiveDate(l)),
        l.pickup_location,
        l.dropoff_location,
        miles(Number(l.loaded_miles ?? 0)),
        miles(Number(l.deadhead_miles ?? 0)),
        miles(getLoadOperatingMiles(l)),
        payModelLabel((l as any).pay_model),
        money(getLoadExpectedPay(l)),
        l.actual_pay_received != null ? money(Number(l.actual_pay_received)) : '',
        statusLabel(l.status),
        l.notes ?? '',
      ));
    }
    lines.push(blank());
  }

  if (wantsExpenses && agg.expenses.length > 0) {
    lines.push(row('EXPENSE BREAKDOWN'));
    lines.push(row('Date', 'Category', 'Type', 'Amount', 'Notes'));
    for (const e of agg.expenses) {
      lines.push(row(
        safeDate(e.expense_date),
        e.category,
        (e as any).expense_type ?? '',
        money(Number(e.amount)),
        (e as any).notes ?? '',
      ));
    }
    lines.push(row('', '', 'Total', money(agg.profit.expensesTotal), ''));
    lines.push(blank());
  }

  if (wantsFuel && agg.fuelLogs.length > 0) {
    lines.push(row('FUEL BREAKDOWN'));
    lines.push(row('Date', 'Station', 'Gallons', 'Price/Gal', 'Total Cost', 'Odometer', 'Notes'));
    for (const f of agg.fuelLogs) {
      lines.push(row(
        safeDate(f.date),
        f.station ?? '',
        Number(f.gallons).toFixed(2),
        money(Number(f.price_per_gallon)),
        money(Number(f.total_cost)),
        f.odometer ?? '',
        f.notes ?? '',
      ));
    }
    lines.push(row('Totals', '', agg.fuel.totalGallons.toFixed(2), money(agg.fuel.avgPricePerGallon), money(agg.fuel.totalCost), '', ''));
    lines.push(blank());
  }

  if (wantsTax) {
    lines.push(row('TAX ESTIMATE'));
    if (!agg.tax.enabled) {
      lines.push(row('Tax estimator is not enabled in your settings.'));
    } else {
      lines.push(row('Metric', 'Value'));
      lines.push(row('Base', agg.tax.baseLabel));
      lines.push(row('Self-Employment Tax', money(agg.tax.seTax)));
      lines.push(row('Federal Income Tax', money(agg.tax.federalTax)));
      lines.push(row('State Income Tax', money(agg.tax.stateTax)));
      lines.push(row('Buffer', money(agg.tax.bufferTax)));
      lines.push(row('Total Estimated Tax', money(agg.tax.totalTax)));
      lines.push(row('Profit After Estimated Tax', money(agg.tax.profitAfterTax)));
    }
    lines.push(blank());
  }

  // SECTION 5 — Disclaimer
  lines.push(row('DISCLAIMER'));
  lines.push(row(TAX_DISCLAIMER));
  lines.push(blank());

  // SECTION 6 — Footer
  lines.push(row('Generated by HaulTracker Pro — haultrackerpro.com'));

  return lines.join('\n');
}

export function downloadCSV(filename: string, csv: string) {
  // Prepend UTF-8 BOM so Excel renders accented chars and the em dash correctly.
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
