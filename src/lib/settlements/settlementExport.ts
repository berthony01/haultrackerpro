/**
 * Phase 1T-F1 — Settlement CSV + browser print export.
 *
 * Client-only, dependency-light recordkeeping export. This module NEVER talks
 * to the backend: it imports no Supabase client, no hooks, no auth, no
 * subscription/role logic, and no settlement service. It receives already
 * presentation-safe data and renders an offline copy of a visible statement.
 *
 * Raw database identifiers (settlement id, item id, driver user id, agency id,
 * recruiter id, relationship id, match id) are intentionally absent from the
 * public contract, so they can never reach a generated file.
 */

/* ------------------------------------------------------------- contracts - */

export interface SettlementExportStatement {
  sourceLabel: string;
  payerLabel: string;
  driverLabel?: string | null;
  status: string;
  versionNumber: number;
  periodStart: string | null;
  periodEnd: string | null;
  payDate: string | null;
  statementReference: string | null;
  reportedGrossAmount: number | null;
  reportedNetAmount: number | null;
  notes: string | null;
}

export interface SettlementExportItem {
  itemType?: string | null;
  category?: string | null;
  description?: string | null;
  amount?: number | null;
  payMethod?: string | null;
  quantity?: number | null;
  rate?: number | null;
  unitLabel?: string | null;
  loadReference?: string | null;
  pickupDate?: string | null;
  deliveryDate?: string | null;
  origin?: string | null;
  destination?: string | null;
  loadedMiles?: number | null;
  deadheadMiles?: number | null;
  payableMiles?: number | null;
  eligibleRevenue?: number | null;
  expectedAmount?: number | null;
}

export const SETTLEMENT_EXPORT_TITLE = 'HaulTracker Pro — Settlement Record';

export const SETTLEMENT_EXPORT_DISCLAIMER =
  'Recordkeeping and reconciliation copy only. HaulTracker Pro does not issue payroll, transfer funds, or file tax forms.';

const ITEM_COLUMNS = [
  'Line Type',
  'Category',
  'Description',
  'Amount',
  'Expected Amount',
  'Pay Method',
  'Quantity',
  'Rate',
  'Unit',
  'Load Reference',
  'Pickup Date',
  'Delivery Date',
  'Origin',
  'Destination',
  'Loaded Miles',
  'Deadhead Miles',
  'Payable Miles',
  'Eligible Revenue',
] as const;

/* ----------------------------------------------------------- value safety - */

/** Null, undefined, and non-finite numbers all render blank — never `NaN`. */
function safeText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  return value;
}

/** RFC-style CSV escaping for commas, quotes, CR, LF, and CRLF. */
export function escapeCsvValue(value: string | number | null | undefined): string {
  const text = safeText(value);
  if (text === '') return '';
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvRow(values: ReadonlyArray<string | number | null | undefined>): string {
  return values.map(escapeCsvValue).join(',');
}

function periodText(statement: SettlementExportStatement): string {
  const start = safeText(statement.periodStart);
  const end = safeText(statement.periodEnd);
  if (!start && !end) return '';
  return `${start || 'Unspecified'} to ${end || 'Unspecified'}`;
}

/* ------------------------------------------------------------------- CSV - */

export function buildSettlementCsv(
  statement: SettlementExportStatement,
  items: readonly SettlementExportItem[],
): string {
  const lines: string[] = [];

  lines.push(csvRow([SETTLEMENT_EXPORT_TITLE]));
  lines.push(csvRow(['Statement source', statement.sourceLabel]));
  lines.push(csvRow(['Payer', statement.payerLabel]));
  if (statement.driverLabel !== null && statement.driverLabel !== undefined) {
    lines.push(csvRow(['Driver', statement.driverLabel]));
  }
  lines.push(csvRow(['Status', statement.status]));
  lines.push(csvRow(['Version', statement.versionNumber]));
  lines.push(csvRow(['Period', periodText(statement)]));
  lines.push(csvRow(['Period start', statement.periodStart]));
  lines.push(csvRow(['Period end', statement.periodEnd]));
  lines.push(csvRow(['Pay date', statement.payDate]));
  lines.push(csvRow(['Statement reference', statement.statementReference]));
  lines.push(csvRow(['Reported gross', statement.reportedGrossAmount]));
  lines.push(csvRow(['Reported net', statement.reportedNetAmount]));
  lines.push(csvRow(['Notes', statement.notes]));
  lines.push(csvRow(['Generated', new Date().toISOString()]));

  lines.push('');
  lines.push(csvRow(['STATEMENT LINES']));
  lines.push(csvRow([...ITEM_COLUMNS]));

  for (const item of items) {
    lines.push(
      csvRow([
        item.itemType,
        item.category,
        item.description,
        item.amount,
        item.expectedAmount,
        item.payMethod,
        item.quantity,
        item.rate,
        item.unitLabel,
        item.loadReference,
        item.pickupDate,
        item.deliveryDate,
        item.origin,
        item.destination,
        item.loadedMiles,
        item.deadheadMiles,
        item.payableMiles,
        item.eligibleRevenue,
      ]),
    );
  }

  lines.push('');
  lines.push(csvRow([SETTLEMENT_EXPORT_DISCLAIMER]));

  return lines.join('\r\n');
}

/* -------------------------------------------------------------- download - */

/** Filenames only ever contain date-range text — never an identifier. */
/**
 * Only a plain calendar date may reach a filename. Anything else — including
 * any identifier-shaped value — degrades to `unspecified`.
 */
export function sanitizeFilenameSegment(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : 'unspecified';
}


export function buildSettlementCsvFilename(
  statement: SettlementExportStatement,
): string {
  const start = sanitizeFilenameSegment(statement.periodStart);
  const end = sanitizeFilenameSegment(statement.periodEnd);
  return `haultrackerpro-settlement_${start}_to_${end}.csv`;
}

export function downloadSettlementCsv(
  statement: SettlementExportStatement,
  items: readonly SettlementExportItem[],
): void {
  const csv = buildSettlementCsv(statement, items);
  // Leading BOM keeps accented characters readable in spreadsheet apps.
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = buildSettlementCsvFilename(statement);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/* ----------------------------------------------------------------- print - */

/** Escapes every HTML-significant character. No raw interpolation anywhere. */
export function escapeHtml(value: string | number | null | undefined): string {
  return safeText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function summaryRow(label: string, value: string | number | null | undefined): string {
  const text = escapeHtml(value);
  return `<tr><th scope="row">${escapeHtml(label)}</th><td>${text === '' ? '&mdash;' : text}</td></tr>`;
}

export function buildSettlementPrintHtml(
  statement: SettlementExportStatement,
  items: readonly SettlementExportItem[],
): string {
  const summaryRows = [
    summaryRow('Statement source', statement.sourceLabel),
    summaryRow('Payer', statement.payerLabel),
    statement.driverLabel !== null && statement.driverLabel !== undefined
      ? summaryRow('Driver', statement.driverLabel)
      : '',
    summaryRow('Status', statement.status),
    summaryRow('Version', statement.versionNumber),
    summaryRow('Period', periodText(statement)),
    summaryRow('Pay date', statement.payDate),
    summaryRow('Statement reference', statement.statementReference),
    summaryRow('Reported gross', statement.reportedGrossAmount),
    summaryRow('Reported net', statement.reportedNetAmount),
    summaryRow('Notes', statement.notes),
  ].join('');

  const headerCells = ITEM_COLUMNS.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join('');

  const bodyRows =
    items.length === 0
      ? `<tr><td colspan="${ITEM_COLUMNS.length}">No statement lines.</td></tr>`
      : items
          .map((item) =>
            `<tr>${[
              item.itemType,
              item.category,
              item.description,
              item.amount,
              item.expectedAmount,
              item.payMethod,
              item.quantity,
              item.rate,
              item.unitLabel,
              item.loadReference,
              item.pickupDate,
              item.deliveryDate,
              item.origin,
              item.destination,
              item.loadedMiles,
              item.deadheadMiles,
              item.payableMiles,
              item.eligibleRevenue,
            ]
              .map((v) => `<td>${escapeHtml(v)}</td>`)
              .join('')}</tr>`,
          )
          .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(SETTLEMENT_EXPORT_TITLE)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 20px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; vertical-align: top; word-break: break-word; }
  table.summary th { width: 32%; background: #f2f2f2; }
  p.disclaimer { margin-top: 20px; font-size: 10px; color: #444; }
  @media print { body { margin: 0; } thead { display: table-header-group; } }
</style>
</head>
<body>
<h1>${escapeHtml(SETTLEMENT_EXPORT_TITLE)}</h1>
<h2>Summary</h2>
<table class="summary"><tbody>${summaryRows}</tbody></table>
<h2>Statement lines</h2>
<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>
<p class="disclaimer">${escapeHtml(SETTLEMENT_EXPORT_DISCLAIMER)}</p>
</body>
</html>`;
}

export function printSettlement(
  statement: SettlementExportStatement,
  items: readonly SettlementExportItem[],
): void {
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('Unable to open print window');
  }
  win.document.write(buildSettlementPrintHtml(statement, items));
  win.document.close();
  win.focus();
  win.print();
}
