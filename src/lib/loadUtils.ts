import { Load } from '@/hooks/useLoads';
import type { Expense } from '@/hooks/useExpenses';
import type { LoadStop } from '@/hooks/useLoadStops';
import { WeekSummary } from '@/lib/types';
import { startOfWeek, endOfWeek, format, parseISO, isWithinInterval, startOfMonth, endOfMonth } from 'date-fns';

/** Get the effective date for grouping — uses dropoff_date if available, otherwise load_date */
export function getEffectiveDate(load: Load): string {
  return (load as any).dropoff_date ?? load.load_date;
}

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
    const totalEstimatedPay = weekLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
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
      avgRatePerMile: totalLoadedMiles > 0 ? totalEstimatedPay / totalLoadedMiles : 0,
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
  const headers = ['Date', 'Pickup', 'Dropoff', 'Stops Summary', 'Loaded Miles', 'Deadhead Miles', 'Rate/Mile', 'Wait Fee', 'Detention Fee', 'Other Fees', 'Estimated Pay', 'Actual Pay', 'Difference', 'Status', 'Notes', 'Company Name', 'Company Start Date'];
  const rows = loads.map(l => {
    const est = Number(l.estimated_pay ?? 0);
    const act = l.actual_pay_received != null ? Number(l.actual_pay_received) : null;
    const diff = act != null ? (act - est).toFixed(2) : '';
    const summary = buildStopsSummary(l, stops);
    return [
      getEffectiveDate(l), l.pickup_location, l.dropoff_location, summary,
      l.loaded_miles, l.deadhead_miles, l.rate_per_mile,
      Number(l.wait_fee).toFixed(2), Number(l.detention_fee).toFixed(2), Number(l.other_fees).toFixed(2),
      est.toFixed(2), act != null ? act.toFixed(2) : '', diff,
      l.status, l.notes ?? '',
      companyMeta?.companyName ?? '', companyMeta?.companyStartDate ?? ''
    ].map(escapeCSV);
  });
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportProfitCSV(loads: Load[], expenses: Expense[], filename: string = 'profit-report', stops: LoadStop[] = [], companyMeta?: { companyName?: string; companyStartDate?: string }) {
  const totalRevenue = loads.reduce((s, l) => s + Number(l.actual_pay_received ?? l.estimated_pay ?? 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const totalMiles = loads.reduce((s, l) => s + Number(l.loaded_miles) + Number(l.deadhead_miles), 0);
  const netProfit = totalRevenue - totalExpenses;
  const netPerMile = totalMiles > 0 ? netProfit / totalMiles : 0;

  const headers = ['Date', 'Pickup', 'Dropoff', 'Stops Summary', 'Estimated Pay', 'Actual Pay', 'Linked Expenses', 'Net Load Profit', 'Company Name', 'Company Start Date'];
  const rows = loads.map(l => {
    const est = Number(l.estimated_pay ?? 0);
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
  rows.push(['SUMMARY'].map(escapeCSV));
  rows.push(['Total Revenue', '', '', '', totalRevenue.toFixed(2), '', '', '', '', ''].map(escapeCSV));
  rows.push(['Total Expenses', '', '', '', '', '', totalExpenses.toFixed(2), '', '', ''].map(escapeCSV));
  rows.push(['Net Profit', '', '', '', '', '', '', netProfit.toFixed(2), '', ''].map(escapeCSV));
  rows.push(['Net $/Mile', '', '', '', '', '', '', netPerMile.toFixed(2), '', ''].map(escapeCSV));

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
  const headers = ['Date', 'Pickup', 'Dropoff', 'Ld Mi', 'DH Mi', '$/Mi', 'Wait', 'Det.', 'Other', 'Est Pay', 'Act Pay', 'Diff', 'Status'];
  const rows = loads.map(l => {
    const est = Number(l.estimated_pay ?? 0);
    const act = l.actual_pay_received != null ? Number(l.actual_pay_received) : null;
    const diff = act != null ? act - est : null;
    return [getEffectiveDate(l), l.pickup_location, l.dropoff_location, String(l.loaded_miles), String(l.deadhead_miles), `$${Number(l.rate_per_mile).toFixed(2)}`, `$${Number(l.wait_fee).toFixed(2)}`, `$${Number(l.detention_fee).toFixed(2)}`, `$${Number(l.other_fees).toFixed(2)}`, `$${est.toFixed(2)}`, act != null ? `$${act.toFixed(2)}` : '', diff != null ? `$${diff.toFixed(2)}` : '', l.status];
  });

  const colWidths = [48, 58, 58, 28, 28, 30, 34, 34, 34, 45, 45, 40, 40];
  const pageW = 595;
  const pageH = 842;
  const marginX = 30;
  const rowH = 16;
  const headerH = 20;

  let y = 50;
  let page = 1;
  const pages: string[] = [];
  let currentContent = '';

  const startPage = () => {
    y = 50;
    const titleParts = [filename, `Page ${page}`];
    if (companyMeta?.companyName) titleParts.unshift(companyMeta.companyName);
    currentContent += `BT /F1 14 Tf ${marginX} ${pageH - 30} Td (${titleParts.join(' - ')}) Tj ET\n`;
    if (companyMeta?.companyStartDate && page === 1) {
      currentContent += `BT /F1 8 Tf ${marginX} ${pageH - 44} Td (Company Start: ${companyMeta.companyStartDate}) Tj ET\n`;
      y += 10;
    }
    // Header row
    let x = marginX;
    headers.forEach((h, i) => {
      currentContent += `BT /F1 7 Tf ${x} ${pageH - y} Td (${h}) Tj ET\n`;
      x += colWidths[i];
    });
    y += headerH;
  };

  startPage();

  rows.forEach(row => {
    if (y > pageH - 40) {
      pages.push(currentContent);
      currentContent = '';
      page++;
      startPage();
    }
    let x = marginX;
    row.forEach((cell, i) => {
      const clean = cell.replace(/[()\\]/g, ' ').substring(0, 20);
      currentContent += `BT /F1 6 Tf ${x} ${pageH - y} Td (${clean}) Tj ET\n`;
      x += colWidths[i];
    });
    y += rowH;
  });
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
