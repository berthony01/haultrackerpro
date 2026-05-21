/**
 * Single source of truth for load-derived metrics.
 *
 * All dashboards, reports, alerts, scorecard, charts, AI summaries, and CSV/PDF
 * exports MUST use these helpers instead of computing RPM / mileage / pay
 * inline. They respect `pay_model` (with `loaded_miles_only` as the safe legacy
 * default), handle null/undefined safely, and never divide by zero.
 *
 * The helpers are pure and do not mutate the input load.
 *
 * Quick reference:
 *   getLoadOperatingMiles(l)  -> total physical miles (loaded + deadhead, or stored total)
 *   getLoadPaidMiles(l)       -> miles the driver is actually paid for (depends on pay_model)
 *   getLoadExpectedPay(l)     -> expected gross $ (uses persisted estimated_pay if set)
 *   getLoadEffectiveRPM(l)    -> $/mi over total operating miles  ← the canonical RPM
 *   getLoadPaidRPM(l)         -> $/mi over paid miles only
 *   getDeadheadPercentage(l)  -> deadhead / total operating miles * 100
 *
 * Aggregate helpers: sumOperatingMiles, sumDeadheadMiles, sumExpectedPay,
 * sumActualPay, fleetEffectiveRPM, fleetDeadheadPct.
 */

import type { Load } from '@/hooks/useLoads';
import { computeLoadPay } from '@/lib/computeLoadPay';
import { resolvePayModel, type PayModel } from '@/lib/payModels';
import { resolveDeadheadPay } from '@/lib/deadheadPay';

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** Effective pay model for a load (legacy NULL → loaded_miles_only). */
export function getLoadPayModel(load: Load): PayModel {
  return resolvePayModel((load as any).pay_model, null);
}

/**
 * Total physical miles driven for the load.
 * Uses persisted `total_miles` when > 0, otherwise loaded + deadhead.
 */
export function getLoadOperatingMiles(load: Load): number {
  const stored = num((load as any).total_miles);
  if (stored > 0) return stored;
  return num(load.loaded_miles) + num(load.deadhead_miles);
}

/**
 * Miles the driver is actually paid for, per their pay model.
 * - loaded_miles_only      → loaded
 * - total_miles            → total operating
 * - loaded_plus_deadhead   → loaded + deadhead
 * - flat_rate              → total operating (flat covers all miles)
 * - manual                 → total operating
 */
export function getLoadPaidMiles(load: Load): number {
  const model = getLoadPayModel(load);
  const loaded = num(load.loaded_miles);
  const dh = num(load.deadhead_miles);
  const total = getLoadOperatingMiles(load);
  switch (model) {
    case 'loaded_miles_only': {
      // Phase 6C.2: if resolved deadhead pay is actually paid (structured or
      // legacy notes, amount > 0, deadhead miles > 0), treat deadhead miles
      // as paid miles so paid RPM mirrors expected pay. Otherwise legacy
      // behavior: loaded miles only.
      if (dh > 0) {
        const resolved = resolveDeadheadPay(load as any);
        if (
          (resolved.source === 'structured' || resolved.source === 'legacy_notes') &&
          resolved.amount > 0
        ) {
          return loaded + dh;
        }
      }
      return loaded;
    }
    case 'total_miles':       return total;
    case 'loaded_plus_deadhead': return loaded + dh;
    case 'flat_rate':         return total;
    case 'manual':            return total;
  }
}


function fees(load: Load): number {
  return num(load.wait_fee) + num(load.detention_fee) + num(load.other_fees);
}

/**
 * Expected gross pay for the load.
 * Prefers the persisted `estimated_pay` (written by the form via computeLoadPay).
 * For legacy rows where it is null, falls back to a model-aware computation so
 * dashboards never show $0 for a real load.
 */
export function getLoadExpectedPay(load: Load): number {
  const persisted = (load as any).estimated_pay;
  if (persisted != null && Number.isFinite(Number(persisted))) {
    return Number(persisted);
  }
  const model = getLoadPayModel(load);
  const r = computeLoadPay({
    payModel: model,
    loadedMiles: num(load.loaded_miles),
    deadheadMiles: num(load.deadhead_miles),
    totalMiles: num((load as any).total_miles),
    loadedRpm: num(load.rate_per_mile),
    dhRpm: num((load as any).deadhead_rate_per_mile),
    flatRate: num((load as any).flat_rate_amount),
    manualGross: 0,
    fees: fees(load),
  });
  let base = r.expectedGrossPay;
  // Phase 6C: when estimated_pay is null, honor structured/legacy deadhead pay
  // signals that computeLoadPay's model path does NOT already account for.
  // - 'pay_model_rate' is skipped: loaded_plus_deadhead already included it above.
  // - 'structured' / 'legacy_notes' are added on top so legacy notes-tag loads
  //   no longer underreport gross pay. Historical loads with estimated_pay set
  //   are protected by the early-return above.
  // Phase 6C.1: Only add resolved deadhead pay for loaded_miles_only, the one
  // model where computeLoadPay does NOT already include deadhead revenue.
  // Other models (loaded_plus_deadhead, total_miles, flat_rate, manual) would
  // double-count if we added the resolver amount on top.
  if (model === 'loaded_miles_only') {
    const dh = resolveDeadheadPay(load as any);
    if (dh.source === 'structured' || dh.source === 'legacy_notes') {
      base += dh.amount;
    }
  }
  return base;
}

/** Canonical RPM: gross pay / total operating miles. Use this everywhere. */
export function getLoadEffectiveRPM(load: Load): number {
  const miles = getLoadOperatingMiles(load);
  if (miles <= 0) return 0;
  return getLoadExpectedPay(load) / miles;
}

/** Pay-model–aware RPM: gross pay / paid miles. Useful for "what am I paid per paid mile". */
export function getLoadPaidRPM(load: Load): number {
  const paid = getLoadPaidMiles(load);
  if (paid <= 0) return 0;
  return getLoadExpectedPay(load) / paid;
}

/** Deadhead share of total operating miles, as a percent (0-100). */
export function getDeadheadPercentage(load: Load): number {
  const total = getLoadOperatingMiles(load);
  if (total <= 0) return 0;
  return (num(load.deadhead_miles) / total) * 100;
}

// ── Aggregate helpers ──────────────────────────────────────────────────────

export function sumOperatingMiles(loads: Load[]): number {
  return loads.reduce((s, l) => s + getLoadOperatingMiles(l), 0);
}

export function sumLoadedMiles(loads: Load[]): number {
  return loads.reduce((s, l) => s + num(l.loaded_miles), 0);
}

export function sumDeadheadMiles(loads: Load[]): number {
  return loads.reduce((s, l) => s + num(l.deadhead_miles), 0);
}

export function sumPaidMiles(loads: Load[]): number {
  return loads.reduce((s, l) => s + getLoadPaidMiles(l), 0);
}

export function sumExpectedPay(loads: Load[]): number {
  return loads.reduce((s, l) => s + getLoadExpectedPay(l), 0);
}

export function sumActualPay(loads: Load[]): number {
  return loads.reduce((s, l) => s + num(l.actual_pay_received), 0);
}

/** Fleet/group RPM = total expected gross pay / total operating miles. */
export function fleetEffectiveRPM(loads: Load[]): number {
  const miles = sumOperatingMiles(loads);
  if (miles <= 0) return 0;
  return sumExpectedPay(loads) / miles;
}

/** Fleet/group deadhead % = total deadhead / total operating miles * 100. */
export function fleetDeadheadPct(loads: Load[]): number {
  const total = sumOperatingMiles(loads);
  if (total <= 0) return 0;
  return (sumDeadheadMiles(loads) / total) * 100;
}
