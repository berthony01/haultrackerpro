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

/**
 * Returns the trustworthy total operating miles for a load.
 * See Phase 6C.3 / 6C.4 sanity rules.
 */
export function resolveOperatingMiles(input: ResolveOperatingMilesInput): number {
  const loaded = num(input.loadedMiles);
  const dh = num(input.deadheadMiles);
  const stored = num(input.totalMiles);
  const componentTotal = loaded + dh;

  if (componentTotal > 0) {
    if (stored <= 0) return componentTotal;
    if (loaded > 0 && stored < loaded) return componentTotal;
    if (stored < componentTotal - TOLERANCE_MI) return componentTotal;
    return stored;
  }
  if (stored > 0) return stored;
  return 0;
}
