/**
 * Phase 1T-F2 — Statement-line net vs reported-net reconciliation helper.
 *
 * PURE module. No React, Supabase, hooks, auth, subscription, services,
 * storage, network, DOM, timers, or database access. It performs an
 * informational recordkeeping comparison only: it never decides amounts owed,
 * payroll, tax, worker classification, or deduction legality, and it never
 * blocks any lifecycle action.
 *
 * Server semantics this mirrors (already confirmed, do not re-derive):
 *  - every stored item amount is finite and non-negative
 *  - additions:    load_pay, earning, reimbursement
 *  - subtractions: deduction, withholding
 *  - reported net may legitimately be negative
 */

export interface SettlementReconciliationItem {
  itemType: string | null | undefined;
  amount: number | null | undefined;
}

export interface SettlementReconciliationResult {
  status: 'ready' | 'no_items' | 'invalid_lines';
  lineCount: number;
  creditTotal: number | null;
  subtractionTotal: number | null;
  lineNetTotal: number | null;
  reportedNetAmount: number | null;
  difference: number | null;
  matchesReportedNet: boolean | null;
}

const ADDITION_TYPES = new Set(['load_pay', 'earning', 'reimbursement']);
const SUBTRACTION_TYPES = new Set(['deduction', 'withholding']);

/** Rounds a dollar amount to whole cents. Returns null when not finite. */
function toCents(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function fromCents(cents: number): number {
  return cents / 100;
}

export function computeSettlementReconciliation(
  items: readonly SettlementReconciliationItem[],
  reportedNetAmount: number | null | undefined,
): SettlementReconciliationResult {
  const reportedCents = toCents(reportedNetAmount);
  const reportedNet = reportedCents === null ? null : fromCents(reportedCents);

  if (items.length === 0) {
    return {
      status: 'no_items',
      lineCount: 0,
      creditTotal: null,
      subtractionTotal: null,
      lineNetTotal: null,
      reportedNetAmount: reportedNet,
      difference: null,
      matchesReportedNet: null,
    };
  }

  const failClosed = (): SettlementReconciliationResult => ({
    status: 'invalid_lines',
    lineCount: items.length,
    creditTotal: null,
    subtractionTotal: null,
    lineNetTotal: null,
    reportedNetAmount: reportedNet,
    difference: null,
    matchesReportedNet: null,
  });

  let creditCents = 0;
  let subtractionCents = 0;

  for (const item of items) {
    const type = typeof item.itemType === 'string' ? item.itemType.trim() : '';
    const isAddition = ADDITION_TYPES.has(type);
    const isSubtraction = SUBTRACTION_TYPES.has(type);
    if (!isAddition && !isSubtraction) return failClosed();

    const cents = toCents(item.amount);
    if (cents === null || cents < 0) return failClosed();

    if (isAddition) {
      creditCents += cents;
      if (!Number.isSafeInteger(creditCents)) return failClosed();
    } else {
      subtractionCents += cents;
      if (!Number.isSafeInteger(subtractionCents)) return failClosed();
    }
  }

  const netCents = creditCents - subtractionCents;
  if (!Number.isSafeInteger(netCents)) return failClosed();

  const comparable = reportedCents !== null;
  const differenceCents = comparable ? netCents - reportedCents : null;
  if (differenceCents !== null && !Number.isSafeInteger(differenceCents)) {
    return failClosed();
  }

  return {
    status: 'ready',
    lineCount: items.length,
    creditTotal: fromCents(creditCents),
    subtractionTotal: fromCents(subtractionCents),
    lineNetTotal: fromCents(netCents),
    reportedNetAmount: reportedNet,
    difference: differenceCents === null ? null : fromCents(differenceCents),
    matchesReportedNet: differenceCents === null ? null : differenceCents === 0,
  };
}
