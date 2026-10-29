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
import { toCents, centsToDollars, sumCents } from '@/lib/financialMoney';

// ── Filters ────────────────────────────────────────────────────────────────

/** Operational filter only; financial KPIs must use onlyFinanciallyCompleted. */
export function excludeCancelled<T extends { status?: string | null }>(loads: T[]): T[] {
  return loads.filter(l => (l.status ?? 'completed') !== 'cancelled');
}

/** Returns only cancelled loads (for the dedicated "Cancelled" report section). */
export function onlyCancelled<T extends { status?: string | null }>(loads: T[]): T[] {
  return loads.filter(l => (l.status ?? 'completed') === 'cancelled');
}

/**
 * Fuel double-count policy — single source of truth.
 *
 * When fuel logs exist for the period, fuel logs are the canonical fuel cost
 * source. Expense rows with `category === 'Fuel'` are dropped from math so we
 * don't double-count when the driver logs fuel both ways. Returns:
 *   - `expensesForMath`: expenses safe to feed to summarizeLoads
 *   - `fuelTotal`: sum of fuel-log total_cost (canonical fuel cost)
 *   - `combinedExpensesTotal`: non-fuel expenses + canonical fuel cost
 *
 * Used by Dashboard, Reports, CSV/PDF exports so every surface agrees.
 */
export function applyFuelLogPolicy<E extends { category?: string | null; amount?: number | string | null }>(
  expenses: E[],
  fuelLogs: { total_cost?: number | string | null }[],
): { expensesForMath: E[]; fuelTotal: number; combinedExpensesTotal: number } {
  const fuelLogsExist = fuelLogs.length > 0;
  const expensesForMath = fuelLogsExist
    ? expenses.filter(e => e.category !== 'Fuel')
    : expenses;
  // Each record is recognized in integer cents, then summed (F3-P1).
  const fuelCents = sumCents(fuelLogs.map(f => Math.max(0, toCents(f.total_cost))));
  const nonFuelCents = sumCents(expensesForMath.map(e => toCents(e.amount)));
  return {
    expensesForMath,
    fuelTotal: centsToDollars(fuelCents),
    combinedExpensesTotal: centsToDollars(nonFuelCents + fuelCents),
  };
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
 * Phase TG-1 (hardened in TG-1R) — financial completion test.
 *
 * FAIL CLOSED: only the exact status `completed` is financially earned. The
 * operational statuses `pending` / `en_route` describe assigned work that has
 * not been earned yet, `cancelled` is never earned, and any unknown, future,
 * or malformed non-null status is treated as NOT complete rather than being
 * silently counted as revenue.
 *
 * A null/undefined status remains backwards-compatible with legacy rows
 * written before the status vocabulary existed and is treated as completed.
 *
 * This is deliberately narrower than `excludeCancelled()`, which remains the
 * broad operational "not cancelled" helper for surfaces that mean exactly that.
 */
export function isCompletedLoadForFinancials(
  load: { status?: string | null } | null | undefined,
): boolean {
  if (!load) return false;
  const status = load.status;
  if (status == null) return true;
  return status === 'completed';
}


/** Returns only financially completed loads (see `isCompletedLoadForFinancials`). */
export function onlyFinanciallyCompleted<T extends { status?: string | null }>(loads: T[]): T[] {
  return loads.filter(isCompletedLoadForFinancials);
}

/**
 * Realized revenue for a single load.
 *
 * Uses `actual_pay_received` when present, otherwise the persisted
 * `estimated_pay` (which the form writes via `computeLoadPay`). Loads that are
 * not financially complete — `pending`, `en_route`, `cancelled` — always
 * return $0.
 */
export function getLoadRealizedRevenue(load: Load): number {
  return centsToDollars(getLoadRealizedRevenueCents(load));
}

/** Recognized expected pay for one load, in integer cents (half away from zero). */
export function getLoadExpectedPayCents(load: Load): number {
  return toCents(getLoadExpectedPay(load));
}

/** Recognized realized revenue for one load, in integer cents. */
export function getLoadRealizedRevenueCents(load: Load): number {
  if (!isCompletedLoadForFinancials(load)) return 0;
  const actual = load.actual_pay_received;
  if (actual != null && Number.isFinite(Number(actual))) return toCents(actual);
  return getLoadExpectedPayCents(load);
}

/** Net Profit for a single load given its allocated expenses (already filtered). */
export function getLoadNetProfit(load: Load, loadExpenses: Expense[] = []): number {
  const exp = sumCents(loadExpenses.map(e => toCents(e.amount)));
  return centsToDollars(getLoadRealizedRevenueCents(load) - exp);
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
  // Compare recognized cents: a one-cent difference is a real difference.
  const a = toCents(actual);
  const expected = getLoadExpectedPayCents(load);
  if (a === expected) return 'paid';
  return a > expected ? 'overpaid' : 'underpaid';
}

/**
 * Difference between actual pay received and expected gross. Positive = the
 * broker overpaid. Returns null when no actual pay is recorded.
 */
export function getPaymentDifference(load: Load): number | null {
  if (load.actual_pay_received == null) return null;
  return centsToDollars(toCents(load.actual_pay_received) - getLoadExpectedPayCents(load));
}

// ── Aggregate / fleet helpers ──────────────────────────────────────────────

export interface LoadFinancialSummary {
  /** Financially completed load count (pending/en_route/cancelled excluded). */
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
   *   Σ actual where present, else expected, for financially completed loads.
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

/**
 * Build the full summary used by dashboard cards and reports.
 *
 * Phase TG-1: every financial figure (mileage, expected/actual pay, gross
 * revenue, RPM, profit, payment counters, `loadCount`) is derived from
 * FINANCIALLY COMPLETED loads only. Assigned-but-unearned operational loads
 * (`pending`, `en_route`) contribute nothing. `cancelledCount` still counts
 * cancelled loads. Nothing is removed from the caller's source array.
 */
export function summarizeLoads(allLoads: Load[], expenses: Expense[] = []): LoadFinancialSummary {
  const completed = onlyFinanciallyCompleted(allLoads);
  const cancelled = onlyCancelled(allLoads);

  // F3-P1: every recorded amount is recognized per row in integer cents, then
  // summed and netted in cents. Raw stored values are never altered.
  const estimatedPayCents = sumCents(completed.map(getLoadExpectedPayCents));
  const actualPayCents = sumCents(completed.map(l => toCents(l.actual_pay_received)));
  const grossCents = sumCents(completed.map(getLoadRealizedRevenueCents));
  const expensesCents = sumCents(expenses.map(e => toCents(e.amount)));
  const estimatedPay = centsToDollars(estimatedPayCents);
  const actualPay = centsToDollars(actualPayCents);
  const grossRevenue = centsToDollars(grossCents);

  const loadedMiles = sumLoadedMiles(completed);
  const deadheadMiles = sumDeadheadMiles(completed);
  const totalMiles = sumOperatingMiles(completed);

  const expensesTotal = centsToDollars(expensesCents);
  const netProfit = centsToDollars(grossCents - expensesCents);

  // Weighted avg contract rate = Σ(loaded * rate) / Σ(loaded)
  let weightedRate = 0;
  for (const l of completed) {
    const lm = num(l.loaded_miles);
    if (lm > 0) weightedRate += lm * num(l.rate_per_mile);
  }
  const avgContractRate = loadedMiles > 0 ? weightedRate / loadedMiles : 0;

  const effectiveRPM = totalMiles > 0 ? grossRevenue / totalMiles : 0;
  const netRPM = totalMiles > 0 ? netProfit / totalMiles : 0;
  const costPerMile = totalMiles > 0 ? expensesTotal / totalMiles : 0;
  const marginPct = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;

  let pendingPaymentCount = 0;
  let pendingCents = 0;
  let differenceCents = 0;
  let underpaidCount = 0;
  let overpaidCount = 0;
  for (const l of completed) {
    const status = derivePaymentDisplayStatus(l);
    if (status === 'pending') {
      pendingPaymentCount += 1;
      pendingCents += getLoadExpectedPayCents(l);
    } else if (status === 'underpaid' || status === 'overpaid') {
      if (status === 'underpaid') underpaidCount += 1; else overpaidCount += 1;
      differenceCents += toCents(l.actual_pay_received) - getLoadExpectedPayCents(l);
    }
  }
  const pendingPaymentEstimated = centsToDollars(pendingCents);
  const paymentDifferenceTotal = centsToDollars(differenceCents);

  return {
    loadCount: completed.length,
    cancelledCount: cancelled.length,
    loadedMiles,
    deadheadMiles,
    totalMiles,
    deadheadPct: fleetDeadheadPct(completed),
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

/**
 * Canonical period adapter. Callers supply owner-scoped, date-filtered inputs.
 * Fuel logs replace Fuel expense records when at least one log is present;
 * otherwise recorded Fuel expenses remain the source. No rows are changed.
 * Operating profit is before tax reserve (tax remains a separate estimate).
 */
export function summarizeFinancialPeriod(
  loads: Load[],
  expenses: Expense[] = [],
  fuelLogs: { total_cost?: number | string | null }[] = [],
) {
  const policy = applyFuelLogPolicy(expenses, fuelLogs);
  const base = summarizeLoads(loads, policy.expensesForMath);
  const expensesTotal = policy.combinedExpensesTotal;
  const netProfit = centsToDollars(toCents(base.grossRevenue) - toCents(expensesTotal));
  const fuelLogsExist = fuelLogs.length > 0;
  const fuelExpenses = expenses.filter(e => e.category === 'Fuel');
  const canonicalFuelTotal = fuelLogsExist
    ? policy.fuelTotal
    : centsToDollars(sumCents(fuelExpenses.map(e => toCents(e.amount))));

  return {
    ...base,
    expensesTotal,
    netProfit,
    netRPM: base.totalMiles > 0 ? netProfit / base.totalMiles : 0,
    costPerMile: base.totalMiles > 0 ? expensesTotal / base.totalMiles : 0,
    marginPct: base.grossRevenue > 0 ? netProfit / base.grossRevenue * 100 : 0,
    fuelPolicy: {
      ...policy,
      fuelLogsExist,
      source: fuelLogsExist ? 'fuel_logs' as const : 'expenses' as const,
      canonicalFuelTotal,
      otherExpensesTotal: centsToDollars(toCents(expensesTotal) - toCents(canonicalFuelTotal)),
      expenseEntryCount: policy.expensesForMath.length,
      fuelLogCount: fuelLogs.length,
      totalEntryCount: policy.expensesForMath.length + fuelLogs.length,
    },
  };
}

// ── Tooltip copy (single source so labels stay consistent) ─────────────────

export const FINANCIAL_TOOLTIPS = {
  grossRevenue: 'Completed load income before expenses: actual pay when recorded, otherwise expected pay. Pending, en-route and cancelled loads are excluded.',
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
