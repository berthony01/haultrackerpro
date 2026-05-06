import { Load } from '@/hooks/useLoads';
import type { Expense } from '@/hooks/useExpenses';
import type { LoadStop } from '@/hooks/useLoadStops';
import { WeekSummary } from '@/lib/types';
import { getScheduleCLine, groupByScheduleC } from '@/lib/scheduleCMapping';
import { startOfWeek, endOfWeek, format, parseISO, isWithinInterval, startOfMonth, endOfMonth } from 'date-fns';
import {
  getLoadOperatingMiles,
  getLoadEffectiveRPM,
  getLoadExpectedPay,
  sumOperatingMiles,
  sumExpectedPay,
  fleetEffectiveRPM,
} from '@/lib/loadMetrics';

/** Get the effective date for grouping — uses dropoff_date if available, otherwise load_date */
export function getEffectiveDate(load: Load): string {
  return (load as any).dropoff_date ?? load.load_date;
}

// ── Canonical CSV header rows (single source of truth) ──────────────────────
// FAQ live previews import these so docs cannot drift from the real exports.
export const CSV_HEADERS_LOADS = [
  'Date', 'Pickup', 'Dropoff', 'Stops Summary', 'Pay Model', 'Loaded Miles',
  'Deadhead Miles', 'Total Miles', 'Rate/Mile', 'Deadhead Rate/Mile', 'Flat Rate',
  'Effective RPM', 'Wait Fee', 'Detention Fee', 'Other Fees', 'Estimated Pay',
  'Actual Pay', 'Difference', 'Status', 'Notes', 'Company Name', 'Company Start Date',
] as const;

export const CSV_HEADERS_PROFIT = [
  'Date', 'Pickup', 'Dropoff', 'Stops Summary', 'Estimated Pay', 'Actual Pay',
  'Linked Expenses', 'Net Load Profit', 'Company Name', 'Company Start Date',
] as const;

export const CSV_HEADERS_SCHEDULE_C = [
  'Schedule C Line', 'Line Description', 'Categories', 'Total Amount',
] as const;

/** Convert user setting string ('sunday', 'monday', etc.) to date-fns weekStartsOn number (0=Sun, 1=Mon, ...) */
export function weekStartDayToNumber(day?: string | null): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const map: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  return map[(day ?? 'sunday').toLowerCase()] ?? 0;
}

/** Get the pay-week range for the week containing `date` */
export function getPayWeekRange(date: Date, weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0) {
  const start = startOfWeek(date, { weekStartsOn });
  const end = endOfWeek(date, { weekStartsOn });
  return { start, end };
}

export function getWeekSummaries(loads: Load[], weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0): WeekSummary[] {
  const weekMap = new Map<string, Load[]>();

  loads.forEach(load => {
    const date = parseISO(getEffectiveDate(load));
    const ws = startOfWeek(date, { weekStartsOn });
    const key = ws.toISOString();
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key)!.push(load);
  });

  const summaries: WeekSummary[] = [];
  weekMap.forEach((weekLoads, key) => {
    const start = parseISO(key);
    const end = endOfWeek(start, { weekStartsOn });
    const totalLoadedMiles = weekLoads.reduce((s, l) => s + Number(l.loaded_miles), 0);
    const totalEstimatedPay = sumExpectedPay(weekLoads);
    const totalActualPay = weekLoads.reduce((s, l) => s + Number(l.actual_pay_received ?? 0), 0);
    summaries.push({
      weekLabel: `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      totalLoads: weekLoads.length,
      totalLoadedMiles,
      totalDeadheadMiles: weekLoads.reduce((s, l) => s + Number(l.deadhead_miles), 0),
      totalEstimatedPay,
      totalActualPay,
      // Effective RPM uses TOTAL operating miles and respects pay_model.
      avgRatePerMile: fleetEffectiveRPM(weekLoads),
    });
  });

  return summaries.sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export function getCurrentWeekLoads(loads: Load[], weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0): Load[] {
  const now = new Date();
  const start = startOfWeek(now, { weekStartsOn });
  const end = endOfWeek(now, { weekStartsOn });
  return loads.filter(l => {
    const d = parseISO(getEffectiveDate(l));
    return isWithinInterval(d, { start, end });
  });
}

export function getCurrentMonthLoads(loads: Load[]): Load[] {
  const now = new Date();
  const start = startOfMonth(now);
  const end = endOfMonth(now);
  return loads.filter(l => {
    const d = parseISO(getEffectiveDate(l));
    return isWithinInterval(d, { start, end });
  });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(num));
}

// US state abbreviations for location formatting
const US_STATES: Record<string, string> = {
  alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',
  connecticut:'CT',delaware:'DE',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',
  illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',
  maine:'ME',maryland:'MD',massachusetts:'MA',michigan:'MI',minnesota:'MN',
  mississippi:'MS',missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV',
  'new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY',
  'north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',
  pennsylvania:'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',
  tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA',
  'west virginia':'WV',wisconsin:'WI',wyoming:'WY',
};

const STATE_ABBRS = new Set(Object.values(US_STATES));

function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

/**
 * Formats a location string to "City, ST" format.
 * Handles: "las vegas nv", "las vegas, nv", "Las Vegas NV", "kenosha wi" etc.
 */
export function formatLocation(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  // Split on comma if present, otherwise split on whitespace
  let parts: string[];
  if (trimmed.includes(',')) {
    parts = trimmed.split(',').map(p => p.trim()).filter(Boolean);
  } else {
    parts = trimmed.split(/\s+/);
  }

  if (parts.length < 2) return toTitleCase(trimmed);

  const lastPart = parts[parts.length - 1].toLowerCase();

  // Check if last part is a 2-letter state abbreviation
  if (lastPart.length === 2 && STATE_ABBRS.has(lastPart.toUpperCase())) {
    const city = toTitleCase(parts.slice(0, -1).join(' '));
    return `${city}, ${lastPart.toUpperCase()}`;
  }

  // Check if last 2 parts form a state name (e.g., "new york")
  if (parts.length >= 3) {
    const twoWordState = `${parts[parts.length - 2]} ${lastPart}`.toLowerCase();
    if (US_STATES[twoWordState]) {
      const city = toTitleCase(parts.slice(0, -2).join(' '));
      return `${city}, ${US_STATES[twoWordState]}`;
    }
  }

  // Check if last part is a full state name
  if (US_STATES[lastPart]) {
    const city = toTitleCase(parts.slice(0, -1).join(' '));
    return `${city}, ${US_STATES[lastPart]}`;
  }

  // Already has comma — just title-case city, uppercase last part if 2 chars
  if (raw.includes(',') && parts.length === 2 && parts[1].length === 2) {
    return `${toTitleCase(parts[0])}, ${parts[1].toUpperCase()}`;
  }

  return toTitleCase(trimmed);
}

function escapeCSV(val: string | number | null | undefined): string {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildStopsSummary(load: Load, stops: LoadStop[]): string {
  const loadStops = stops.filter(s => s.load_id === load.id).sort((a, b) => a.stop_order - b.stop_order);
  if (loadStops.length === 0) return '';
  return [load.pickup_location, ...loadStops.map(s => s.location), load.dropoff_location]
    .map(formatLocation).join(' → ');
}

export function exportToCSV(loads: Load[], filename: string, stops: LoadStop[] = [], companyMeta?: { companyName?: string; companyStartDate?: string }) {
  const headers = [...CSV_HEADERS_LOADS];
  const rows = loads.map(l => {
    const est = getLoadExpectedPay(l);
    const act = l.actual_pay_received != null ? Number(l.actual_pay_received) : null;
    const diff = act != null ? (act - est).toFixed(2) : '';
    const summary = buildStopsSummary(l, stops);
    const totalMi = getLoadOperatingMiles(l);
    const effRpm = getLoadEffectiveRPM(l);
    const payModel = (l as any).pay_model ?? 'loaded_miles_only';
    const dhRate = (l as any).deadhead_rate_per_mile;
    const flatRate = (l as any).flat_rate_amount;
    return [
      getEffectiveDate(l), l.pickup_location, l.dropoff_location, summary,
      payModel,
      l.loaded_miles, l.deadhead_miles,
      (l as any).total_miles ?? '',
      l.rate_per_mile,
      dhRate != null ? Number(dhRate).toFixed(2) : '',
      flatRate != null ? Number(flatRate).toFixed(2) : '',
      effRpm.toFixed(2),
      Number(l.wait_fee).toFixed(2), Number(l.detention_fee).toFixed(2), Number(l.other_fees).toFixed(2),
      est.toFixed(2), act != null ? act.toFixed(2) : '', diff,
      l.status, l.notes ?? '',
      companyMeta?.companyName ?? '', companyMeta?.companyStartDate ?? ''
    ].map(escapeCSV);
  });
  const footerRows = [[], ['Generated by HaulTrackerPro.com'].map(escapeCSV)];
  const csv = [headers.join(','), ...rows.map(r => r.join(',')), ...footerRows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportProfitCSV(loads: Load[], expenses: Expense[], filename: string = 'profit-report', stops: LoadStop[] = [], companyMeta?: { companyName?: string; companyStartDate?: string }) {
  // Cancelled loads are excluded from financial totals
  const activeLoads = loads.filter(l => (l.status ?? 'completed') !== 'cancelled');
  const cancelledLoads = loads.filter(l => (l.status ?? 'completed') === 'cancelled');

  const totalRevenue = activeLoads.reduce((s, l) => s + Number(l.actual_pay_received ?? getLoadExpectedPay(l) ?? 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const totalMiles = sumOperatingMiles(activeLoads);
  const netProfit = totalRevenue - totalExpenses;
  const netPerMile = totalMiles > 0 ? netProfit / totalMiles : 0;

  const headers = [...CSV_HEADERS_PROFIT];
  const rows = activeLoads.map(l => {
    const est = getLoadExpectedPay(l);
    const act = l.actual_pay_received != null ? Number(l.actual_pay_received) : null;
    const linkedExp = expenses.filter(e => e.linked_load_id === l.id).reduce((s, e) => s + Number(e.amount), 0);
    const pay = act ?? est;
    const netLoadProfit = pay - linkedExp;
    const summary = buildStopsSummary(l, stops);
    return [
      getEffectiveDate(l), l.pickup_location, l.dropoff_location, summary,
      est.toFixed(2), act != null ? act.toFixed(2) : '',
      linkedExp.toFixed(2), netLoadProfit.toFixed(2),
      companyMeta?.companyName ?? '', companyMeta?.companyStartDate ?? ''
    ].map(escapeCSV);
  });

  // Summary rows
  rows.push([]);
  rows.push(['SUMMARY (cancelled loads excluded)'].map(escapeCSV));
  rows.push(['Total Revenue', '', '', '', totalRevenue.toFixed(2), '', '', '', '', ''].map(escapeCSV));
  rows.push(['Total Expenses', '', '', '', '', '', totalExpenses.toFixed(2), '', '', ''].map(escapeCSV));
  rows.push(['Net Profit', '', '', '', '', '', '', netProfit.toFixed(2), '', ''].map(escapeCSV));
  rows.push(['Net $/Mile', '', '', '', '', '', '', netPerMile.toFixed(2), '', ''].map(escapeCSV));

  // Cancelled loads section
  if (cancelledLoads.length > 0) {
    rows.push([]);
    rows.push([`CANCELLED LOADS (${cancelledLoads.length}) — excluded from totals`].map(escapeCSV));
    cancelledLoads.forEach(l => {
      rows.push([
        getEffectiveDate(l), l.pickup_location, l.dropoff_location, buildStopsSummary(l, stops),
        '0.00', '0.00', '0.00', '0.00', '', ''
      ].map(escapeCSV));
    });
  }

  rows.push([]);
  rows.push(['Generated by HaulTrackerPro.com'].map(escapeCSV));

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToPDF(loads: Load[], filename: string, stops: LoadStop[] = [], companyMeta?: { companyName?: string; companyStartDate?: string }) {
  const headers = ['Date', 'Pickup', 'Dropoff', 'Model', 'Ld Mi', 'DH Mi', 'Tot Mi', 'Eff RPM', 'Est Pay', 'Act Pay', 'Status'];
  const payModelLabel = (m?: string | null) => {
    switch (m) {
      case 'total_miles': return 'Total';
      case 'loaded_plus_deadhead': return 'Ld+DH';
      case 'flat_rate': return 'Flat';
      case 'manual': return 'Manual';
      default: return 'Loaded';
    }
  };
  const rows = loads.map(l => {
    const est = getLoadExpectedPay(l);
    const act = l.actual_pay_received != null ? Number(l.actual_pay_received) : null;
    const tot = getLoadOperatingMiles(l);
    const effRpm = getLoadEffectiveRPM(l);
    return [
      getEffectiveDate(l), l.pickup_location, l.dropoff_location,
      payModelLabel((l as any).pay_model),
      String(l.loaded_miles), String(l.deadhead_miles),
      tot ? String(tot) : '',
      `$${effRpm.toFixed(2)}`,
      `$${est.toFixed(2)}`, act != null ? `$${act.toFixed(2)}` : '', l.status,
    ];
  });

  // Summary totals
  const totalLoaded = loads.reduce((s, l) => s + Number(l.loaded_miles), 0);
  const totalDH = loads.reduce((s, l) => s + Number(l.deadhead_miles), 0);
  const totalEst = sumExpectedPay(loads);
  const totalAct = loads.reduce((s, l) => s + Number(l.actual_pay_received ?? 0), 0);

  const colWidths = [50, 60, 60, 38, 32, 32, 36, 44, 50, 50, 42];
  const pageW = 595;
  const pageH = 842;
  const marginX = 30;
  const rowH = 18;
  const headerH = 22;
  const bodyFont = 8;
  const headFont = 9;

  let y = 50;
  let page = 1;
  const pages: string[] = [];
  let currentContent = '';

  const brandName = companyMeta?.companyName || 'HaulTrackerPro';

  const startPage = () => {
    y = 50;
    // Branded header
    currentContent += `BT /F1 14 Tf ${marginX} ${pageH - 30} Td (${brandName} - Load Report) Tj ET\n`;
    currentContent += `BT /F1 8 Tf ${marginX} ${pageH - 44} Td (Generated: ${format(new Date(), 'MMM d, yyyy')} | Page ${page}) Tj ET\n`;
    y += 10;
    if (page === 1) {
      // Summary block
      y += 6;
      currentContent += `BT /F1 9 Tf ${marginX} ${pageH - y} Td (Summary: ${loads.length} loads | ${totalLoaded.toLocaleString()} loaded mi | Est: $${totalEst.toFixed(0)} | Act: $${totalAct.toFixed(0)}) Tj ET\n`;
      y += 18;
    }
    // Header row background
    currentContent += `0.92 0.92 0.92 rg ${marginX - 2} ${pageH - y - 4} ${colWidths.reduce((a, b) => a + b, 0) + 4} ${headerH} re f\n`;
    currentContent += `0 0 0 rg\n`;
    let x = marginX;
    headers.forEach((h, i) => {
      currentContent += `BT /F1 ${headFont} Tf ${x} ${pageH - y} Td (${h}) Tj ET\n`;
      x += colWidths[i];
    });
    y += headerH;
  };

  startPage();
  let rowIdx = 0;

  rows.forEach(row => {
    if (y > pageH - 50) {
      // Footer
      currentContent += `BT /F1 7 Tf ${marginX} 20 Td (${brandName} - haultrackerpro.com) Tj ET\n`;
      pages.push(currentContent);
      currentContent = '';
      page++;
      startPage();
    }
    // Alternating row shading
    if (rowIdx % 2 === 1) {
      currentContent += `0.96 0.96 0.96 rg ${marginX - 2} ${pageH - y - 4} ${colWidths.reduce((a, b) => a + b, 0) + 4} ${rowH} re f\n`;
      currentContent += `0 0 0 rg\n`;
    }
    let x = marginX;
    row.forEach((cell, i) => {
      const clean = cell.replace(/[()\\]/g, ' ').substring(0, 22);
      currentContent += `BT /F1 ${bodyFont} Tf ${x} ${pageH - y} Td (${clean}) Tj ET\n`;
      x += colWidths[i];
    });
    y += rowH;
    rowIdx++;
  });

  // Footer on last page
  currentContent += `BT /F1 7 Tf ${marginX} 20 Td (${brandName} - haultrackerpro.com) Tj ET\n`;
  pages.push(currentContent);

  // Build minimal PDF
  const objs: string[] = [];
  objs.push('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj');
  const pageRefs = pages.map((_, i) => `${i + 4} 0 R`).join(' ');
  objs.push(`2 0 obj<</Type/Pages/Kids[${pageRefs}]/Count ${pages.length}>>endobj`);
  objs.push('3 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj');

  pages.forEach((content, i) => {
    const streamObj = i + 4 + pages.length;
    objs.push(`${i + 4} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pageW} ${pageH}]/Contents ${streamObj} 0 R/Resources<</Font<</F1 3 0 R>>>>>>endobj`);
  });
  pages.forEach((content, i) => {
    const idx = i + 4 + pages.length;
    objs.push(`${idx} 0 obj<</Length ${content.length}>>stream\n${content}endstream\nendobj`);
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach(obj => {
    offsets.push(pdf.length);
    pdf += obj + '\n';
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(o => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF`;

  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportScheduleCSummary(
  expenses: { category: string; amount: number; expense_date: string }[],
  filename: string = 'schedule-c-summary',
  companyMeta?: { companyName?: string }
) {
  const sorted = groupByScheduleC(expenses);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

  const headers = [...CSV_HEADERS_SCHEDULE_C];
  const rows = sorted.map(g => [
    `Line ${g.line}`,
    g.description,
    g.categories.join(', '),
    g.total.toFixed(2),
  ].map(v => `"${v}"`));

  const metaRows = [
    [`"Schedule C Expense Summary"`, '', '', ''],
    [`"Generated: ${new Date().toLocaleDateString()}"`, `"${companyMeta?.companyName ?? 'HaulTrackerPro'}"`, '', ''],
    [`"Total Expenses: $${totalExpenses.toFixed(2)}"`, `"${expenses.length} transactions"`, '', ''],
    ['', '', '', ''],
  ];

  const detailHeaders = ['Date', 'Category', 'Schedule C Line', 'Amount'];
  const detailRows = expenses
    .sort((a, b) => a.category.localeCompare(b.category))
    .map(e => [
      e.expense_date,
      e.category,
      `Line ${getScheduleCLine(e.category).line}`,
      e.amount.toFixed(2),
    ].map(v => `"${v}"`));

  const csv = [
    ...metaRows.map(r => r.join(',')),
    headers.join(','),
    ...rows.map(r => r.join(',')),
    '',
    '"DETAIL BY TRANSACTION"',
    detailHeaders.join(','),
    ...detailRows.map(r => r.join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
