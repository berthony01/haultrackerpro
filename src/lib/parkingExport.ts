import { format, parseISO } from 'date-fns';
import type { Expense } from '@/hooks/useExpenses';
import type { Load } from '@/hooks/useLoads';
import { formatCurrency } from '@/lib/loadUtils';

export interface ParkingExportRange {
  label: string;
  from: string; // yyyy-MM-dd
  to: string; // yyyy-MM-dd
}

interface ExportRow {
  date: string;
  amount: number;
  linkedLoad: string;
  notes: string;
}

function buildRows(expenses: Expense[], loads: Load[], range: ParkingExportRange): ExportRow[] {
  const loadsMap = new Map(loads.map((l) => [l.id, l]));
  return expenses
    .filter((e) => e.category === 'Parking')
    .filter((e) => e.expense_date >= range.from && e.expense_date <= range.to)
    .sort((a, b) => a.expense_date.localeCompare(b.expense_date))
    .map((e) => {
      const linked = e.linked_load_id ? loadsMap.get(e.linked_load_id) : null;
      return {
        date: format(parseISO(e.expense_date), 'MM/dd/yyyy'),
        amount: Number(e.amount),
        linkedLoad: linked ? `${linked.pickup_location} → ${linked.dropoff_location}` : '',
        notes: e.notes ?? '',
      };
    });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function escapeCsv(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export async function exportParkingCSV(
  expenses: Expense[],
  loads: Load[],
  range: ParkingExportRange,
  driverName?: string,
): Promise<{ count: number; total: number }> {
  const rows = buildRows(expenses, loads, range);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  // Route through the premium HaulTracker Pro CSV builder so parking exports
  // share the same branded header + executive summary as every other report.
  const [{ aggregateReport }, { buildReportCSV, downloadCSV }] = await Promise.all([
    import('@/lib/reportAggregator'),
    import('@/lib/reportCsv'),
  ]);

  const parkingExpenses = expenses.filter(
    (e) => e.category === 'Parking' && e.expense_date >= range.from && e.expense_date <= range.to,
  );

  const agg = aggregateReport({
    loads: [],
    expenses: parkingExpenses,
    fuelLogs: [],
    settings: null,
    range: { from: range.from, to: range.to, label: range.label, key: 'custom' },
    preparedFor: driverName || 'HaulTrackerPro Driver',
  });

  const filename = `parking-expenses_${range.label.replace(/\s+/g, '-').toLowerCase()}_${range.from}_to_${range.to}.csv`;
  downloadCSV(filename, buildReportCSV('expense', agg));
  return { count: rows.length, total };
}

export async function exportParkingPDF(
  expenses: Expense[],
  loads: Load[],
  range: ParkingExportRange,
  driverName?: string,
): Promise<{ count: number; total: number }> {
  const rows = buildRows(expenses, loads, range);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  // Route through the premium HaulTracker Pro PDF builder so parking exports
  // share the same navy/orange branded shell as every other report.
  const [{ aggregateReport }, { buildReportPdf, downloadPdfBlob }] = await Promise.all([
    import('@/lib/reportAggregator'),
    import('@/lib/reportPdf'),
  ]);

  const parkingExpenses = expenses.filter(
    (e) => e.category === 'Parking' && e.expense_date >= range.from && e.expense_date <= range.to,
  );

  const agg = aggregateReport({
    loads: [],
    expenses: parkingExpenses,
    fuelLogs: [],
    settings: null,
    range: { from: range.from, to: range.to, label: range.label, key: 'custom' },
    preparedFor: driverName || 'HaulTrackerPro Driver',
  });

  const filename = `parking-expenses_${range.label.replace(/\s+/g, '-').toLowerCase()}_${range.from}_to_${range.to}.pdf`;
  downloadPdfBlob(filename, buildReportPdf('expense', agg));
  return { count: rows.length, total };
}
