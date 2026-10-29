/**
 * Pure mileage math helpers shared by getLoadOperatingMiles and computeLoadPay.
 *
 * Phase 6C.4 — Stored Derived Field Sanity:
 * `total_miles` is a stored/optional summary; `loaded_miles` + `deadhead_miles`
 * are raw component fields. When the stored summary is missing, zero, or
 * clearly contradicts the raw components, fall back to the component sum so
 * downstream pay / RPM / KPI calculations don't get poisoned by stale or
 * corrupted totals.
 */

const TOLERANCE_MI = 2;

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export interface ResolveOperatingMilesInput {
  loadedMiles?: number | null;
  deadheadMiles?: number | null;
  totalMiles?: number | null;
}

/** A nonzero itemized sum and an explicit total must agree within 2 miles. */
export function hasMileageContradiction(input: ResolveOperatingMilesInput): boolean {
  const componentTotal = num(input.loadedMiles) + num(input.deadheadMiles);
  return input.totalMiles != null && componentTotal > 0 &&
    Math.abs(num(input.totalMiles) - componentTotal) > TOLERANCE_MI;
}

/**
 * Returns the trustworthy total operating miles for a load.
 * A nonzero component sum is the itemized distance, even if only one component
 * is supplied. Missing components contribute zero; never infer extra mileage
 * from a contradictory summary. Total-only loads remain trusted when neither
 * component contributes mileage. This is read-time math, never a row repair.
 */
export function resolveOperatingMiles(input: ResolveOperatingMilesInput): number {
  const loaded = num(input.loadedMiles);
  const dh = num(input.deadheadMiles);
  const stored = num(input.totalMiles);
  const componentTotal = loaded + dh;

  if (componentTotal > 0) {
    if (stored <= 0) return componentTotal;
    if (hasMileageContradiction(input)) return componentTotal;
    return stored;
  }
  if (stored > 0) return stored;
  return 0;
}
