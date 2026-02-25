import { Load } from '@/hooks/useLoads';
import { WeekSummary } from '@/lib/types';
import { startOfWeek, endOfWeek, format, parseISO, isWithinInterval, startOfMonth, endOfMonth } from 'date-fns';

export function getWeekSummaries(loads: Load[]): WeekSummary[] {
  const weekMap = new Map<string, Load[]>();

  loads.forEach(load => {
    const date = parseISO(load.load_date);
    const weekStart = startOfWeek(date, { weekStartsOn: 1 });
    const key = weekStart.toISOString();
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key)!.push(load);
  });

  const summaries: WeekSummary[] = [];
  weekMap.forEach((weekLoads, key) => {
    const start = parseISO(key);
    const end = endOfWeek(start, { weekStartsOn: 1 });
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

export function getCurrentWeekLoads(loads: Load[]): Load[] {
  const now = new Date();
  const start = startOfWeek(now, { weekStartsOn: 1 });
  const end = endOfWeek(now, { weekStartsOn: 1 });
  return loads.filter(l => {
    const d = parseISO(l.load_date);
    return isWithinInterval(d, { start, end });
  });
}

export function getCurrentMonthLoads(loads: Load[]): Load[] {
  const now = new Date();
  const start = startOfMonth(now);
  const end = endOfMonth(now);
  return loads.filter(l => {
    const d = parseISO(l.load_date);
    return isWithinInterval(d, { start, end });
  });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(num));
}

function escapeCSV(val: string | number | null | undefined): string {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportToCSV(loads: Load[], filename: string) {
  const headers = ['Date', 'Pickup', 'Dropoff', 'Loaded Miles', 'Deadhead Miles', 'Rate/Mile', 'Fees', 'Estimated Pay', 'Actual Pay', 'Difference', 'Status', 'Notes'];
  const rows = loads.map(l => {
    const fees = Number(l.wait_fee) + Number(l.detention_fee) + Number(l.other_fees);
    const est = Number(l.estimated_pay ?? 0);
    const act = l.actual_pay_received != null ? Number(l.actual_pay_received) : null;
    const diff = act != null ? act - est : null;
    return [l.load_date, l.pickup_location, l.dropoff_location, l.loaded_miles, l.deadhead_miles, l.rate_per_mile, fees.toFixed(2), est.toFixed(2), act != null ? act.toFixed(2) : '', diff != null ? diff.toFixed(2) : '', l.status, l.notes ?? ''].map(escapeCSV);
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

export function exportToPDF(loads: Load[], filename: string) {
  const headers = ['Date', 'Pickup', 'Dropoff', 'Miles', 'Est Pay', 'Act Pay', 'Diff', 'Status'];
  const rows = loads.map(l => {
    const est = Number(l.estimated_pay ?? 0);
    const act = l.actual_pay_received != null ? Number(l.actual_pay_received) : null;
    const diff = act != null ? act - est : null;
    return [l.load_date, l.pickup_location, l.dropoff_location, String(l.loaded_miles), `$${est.toFixed(2)}`, act != null ? `$${act.toFixed(2)}` : '-', diff != null ? `$${diff.toFixed(2)}` : '-', l.status];
  });

  const colWidths = [65, 80, 80, 40, 55, 55, 50, 55];
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
    currentContent += `BT /F1 14 Tf ${marginX} ${pageH - 30} Td (${filename} - Page ${page}) Tj ET\n`;
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
