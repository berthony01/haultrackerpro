/**
 * HaulTrackerPro — Canonical financial calculations.
 *
 * This module is the SINGLE source of truth for revenue, profit, RPM, and
 * payment-status math used by the dashboard, load list/cards, reports, and
 * exports. It wraps the lower-level pay calculator (`computeLoadPay`) and the
 * load-level helpers in `loadMetrics` and adds:
 *
 *   - Cancelled-load filtering (driver-facing totals never include cancelled)
 *   - Net Profit / Net RPM / Margin % / Cost-per-Mile aggregates
 *   - Derived payment display status (paid / pending / underpaid / overpaid /
 *     cancelled) without requiring a DB enum change
 *
 * Naming convention used everywhere in the UI (tooltips must match):
 *   - **Contract Rate**     — the rate entered on the load (e.g. $0.82/mi)
 *   - **Loaded RPM**        — gross ÷ loaded miles
 *   - **Effective RPM**     — gross ÷ total operating miles (incl. deadhead)
 *   - **Net RPM**           — net profit ÷ total operating miles
 *   - **Cost / Mile**       — total expenses ÷ total operating miles
 *
 * Effective RPM is NOT the contract rate. The driver's contract rate never
 * changes; Effective RPM only shows what the load actually pays per mile when
 * unpaid deadhead is folded in.
 */

import type { Load } from '@/hooks/useLoads';
import type { Expense } from '@/hooks/useExpenses';
import {
  getLoadExpectedPay,
  getLoadEffectiveRPM,
  getLoadPaidRPM,
  getLoadOperatingMiles,
  getDeadheadPercentage,
  sumExpectedPay,
  sumActualPay,
  sumOperatingMiles,
  sumLoadedMiles,
  sumDeadheadMiles,
  fleetEffectiveRPM,
  fleetDeadheadPct,
} from '@/lib/loadMetrics';

// ── Filters ────────────────────────────────────────────────────────────────

/** Returns loads with `status === 'cancelled'` removed. Use before any KPI sum. */
export function excludeCancelled<T extends { status?: string | null }>(loads: T[]): T[] {
  return loads.filter(l => (l.status ?? 'completed') !== 'cancelled');
}

/** Returns only cancelled loads (for the dedicated "Cancelled" report section). */
export function onlyCancelled<T extends { status?: string | null }>(loads: T[]): T[] {
  return loads.filter(l => (l.status ?? 'completed') === 'cancelled');
}

// ── Per-load helpers (re-exported for one-stop import) ─────────────────────

export {
  getLoadExpectedPay,
  getLoadEffectiveRPM,
  getLoadPaidRPM,
  getLoadOperatingMiles,
  getDeadheadPercentage,
};

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Realized revenue for a single load.
 *
 * Uses `actual_pay_received` when present, otherwise the persisted
 * `estimated_pay` (which the form writes via `computeLoadPay`). Cancelled
 * loads always return $0.
 */
export function getLoadRealizedRevenue(load: Load): number {
  if ((load.status ?? 'completed') === 'cancelled') return 0;
  const actual = load.actual_pay_received;
  if (actual != null && Number.isFinite(Number(actual))) return Number(actual);
  return getLoadExpectedPay(load);
}

/** Net Profit for a single load given its allocated expenses (already filtered). */
export function getLoadNetProfit(load: Load, loadExpenses: Expense[] = []): number {
  const exp = loadExpenses.reduce((s, e) => s + num(e.amount), 0);
  return getLoadRealizedRevenue(load) - exp;
}

/** Net RPM for a single load. */
export function getLoadNetRPM(load: Load, loadExpenses: Expense[] = []): number {
  const miles = getLoadOperatingMiles(load);
  if (miles <= 0) return 0;
  return getLoadNetProfit(load, loadExpenses) / miles;
}

// ── Payment display status ─────────────────────────────────────────────────

export type PaymentDisplayStatus =
  | 'cancelled'
  | 'pending'
  | 'paid'
  | 'underpaid'
  | 'overpaid';

/**
 * Derives a driver-friendly payment status from the load row. Does not require
 * a DB schema change — read-only.
 */
export function derivePaymentDisplayStatus(load: Load): PaymentDisplayStatus {
  if ((load.status ?? 'completed') === 'cancelled') return 'cancelled';
  const actual = load.actual_pay_received;
  if (actual == null) return 'pending';
  const a = Number(actual);
  const expected = getLoadExpectedPay(load);
  // Penny-tolerant comparison
  if (Math.abs(a - expected) < 0.005) return 'paid';
  return a > expected ? 'overpaid' : 'underpaid';
}

/**
 * Difference between actual pay received and expected gross. Positive = the
 * broker overpaid. Returns null when no actual pay is recorded.
 */
export function getPaymentDifference(load: Load): number | null {
  if (load.actual_pay_received == null) return null;
  return Number(load.actual_pay_received) - getLoadExpectedPay(load);
}

// ── Aggregate / fleet helpers ──────────────────────────────────────────────

export interface LoadFinancialSummary {
  /** Active load count (cancelled excluded). */
  loadCount: number;
  cancelledCount: number;

  loadedMiles: number;
  deadheadMiles: number;
  totalMiles: number;
  deadheadPct: number;

  /** Sum of expected pay (uses `estimated_pay`). */
  estimatedPay: number;
  /** Sum of `actual_pay_received` for loads where it's recorded. */
  actualPay: number;
  /**
   * Driver-facing "Gross Revenue":
   *   Σ actual where present, else expected, for non-cancelled loads.
   */
  grossRevenue: number;

  expensesTotal: number;
  netProfit: number;

  /** Average contract rate weighted by loaded miles. $0 when no loaded miles. */
  avgContractRate: number;
  /** Gross ÷ total operating miles (canonical Effective RPM). */
  effectiveRPM: number;
  /** Net Profit ÷ total operating miles. */
  netRPM: number;
  /** Total expenses ÷ total operating miles. */
  costPerMile: number;
  /** Net profit as a % of gross revenue. 0 when revenue is 0. */
  marginPct: number;

  /** Pending payment counters (excluding cancelled). */
  pendingPaymentCount: number;
  /** Σ expected for loads with no actual pay yet. */
  pendingPaymentEstimated: number;
  /** Σ (actual - expected) for loads where actual is recorded. */
  paymentDifferenceTotal: number;
  underpaidCount: number;
  overpaidCount: number;
}

/** Build the full summary used by dashboard cards and reports. */
export function summarizeLoads(allLoads: Load[], expenses: Expense[] = []): LoadFinancialSummary {
  const active = excludeCancelled(allLoads);
  const cancelled = onlyCancelled(allLoads);

  const estimatedPay = sumExpectedPay(active);
  const actualPay = sumActualPay(active);
  const grossRevenue = active.reduce((s, l) => s + getLoadRealizedRevenue(l), 0);

  const loadedMiles = sumLoadedMiles(active);
  const deadheadMiles = sumDeadheadMiles(active);
  const totalMiles = sumOperatingMiles(active);

  const expensesTotal = expenses.reduce((s, e) => s + num(e.amount), 0);
  const netProfit = grossRevenue - expensesTotal;

  // Weighted avg contract rate = Σ(loaded * rate) / Σ(loaded)
  let weightedRate = 0;
  for (const l of active) {
    const lm = num(l.loaded_miles);
    if (lm > 0) weightedRate += lm * num(l.rate_per_mile);
  }
  const avgContractRate = loadedMiles > 0 ? weightedRate / loadedMiles : 0;

  const effectiveRPM = totalMiles > 0 ? grossRevenue / totalMiles : 0;
  const netRPM = totalMiles > 0 ? netProfit / totalMiles : 0;
  const costPerMile = totalMiles > 0 ? expensesTotal / totalMiles : 0;
  const marginPct = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;

  let pendingPaymentCount = 0;
  let pendingPaymentEstimated = 0;
  let paymentDifferenceTotal = 0;
  let underpaidCount = 0;
  let overpaidCount = 0;
  for (const l of active) {
    const status = derivePaymentDisplayStatus(l);
    if (status === 'pending') {
      pendingPaymentCount += 1;
      pendingPaymentEstimated += getLoadExpectedPay(l);
    } else if (status === 'underpaid') {
      underpaidCount += 1;
      paymentDifferenceTotal += getPaymentDifference(l) ?? 0;
    } else if (status === 'overpaid') {
      overpaidCount += 1;
      paymentDifferenceTotal += getPaymentDifference(l) ?? 0;
    }
  }

  return {
    loadCount: active.length,
    cancelledCount: cancelled.length,
    loadedMiles,
    deadheadMiles,
    totalMiles,
    deadheadPct: fleetDeadheadPct(active),
    estimatedPay,
    actualPay,
    grossRevenue,
    expensesTotal,
    netProfit,
    avgContractRate,
    effectiveRPM,
    netRPM,
    costPerMile,
    marginPct,
    pendingPaymentCount,
    pendingPaymentEstimated,
    paymentDifferenceTotal,
    underpaidCount,
    overpaidCount,
  };
}

// ── Tooltip copy (single source so labels stay consistent) ─────────────────

export const FINANCIAL_TOOLTIPS = {
  grossRevenue: 'Total estimated or confirmed load income before expenses. Cancelled loads are excluded.',
  netProfit: 'Gross revenue minus all expenses in the selected period.',
  effectiveRPM: 'Gross revenue divided by all miles, including deadhead. This is not your contract rate — it shows what the load actually pays per mile.',
  netRPM: 'Net profit divided by all miles (including deadhead).',
  contractRate: 'Your agreed pay rate for the load. Effective RPM may be lower when deadhead miles are included.',
  loadedRPM: 'Gross revenue divided by loaded miles only.',
  costPerMile: 'Total expenses divided by all miles driven.',
  deadheadPct: 'Share of total miles driven empty (no freight). Lower is better.',
  marginPct: 'Net profit as a percentage of gross revenue.',
} as const;

// Re-export commonly used aggregate helpers so callers only need this module.
export {
  sumExpectedPay,
  sumActualPay,
  sumLoadedMiles,
  sumDeadheadMiles,
  sumOperatingMiles,
  fleetEffectiveRPM,
  fleetDeadheadPct,
};
