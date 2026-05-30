/**
 * Phase 29B — Canonical stop-model normalization for paste/scan flows.
 *
 * Rules:
 *  - Top-level fields (pickup_location, dropoff_location, load_date, dropoff_date)
 *    are the canonical endpoints.
 *  - load_stops / `stops` state stores INTERIOR (intermediate) stops only.
 *  - First Pickup and last Drop are stripped out of the interior list and
 *    promoted to the top-level endpoints. If the source only contains
 *    [Pickup, Drop] with no interior stops, multiStop is OFF — we don't save
 *    duplicate endpoint rows.
 *  - A valid YYYY-MM-DD stop_date on the final Drop stop is surfaced as the
 *    derived top-level dropoff_date so paste/scan can fill it when missing.
 *  - This is pure: no React, no DB. Tested directly.
 */
import type { ParsedStopData, ParsedLoadData } from './parseLoadText';

export interface NormalizedStops {
  pickup_location?: string;
  dropoff_location?: string;
  /** Drop-off date derived from final explicit Drop stop's stop_date, when valid. */
  dropoff_date?: string;
  /** Interior stops only — never includes the leading Pickup or trailing Drop. */
  interiorStops: ParsedStopData[];
  /** True iff at least one interior stop exists. */
  multiStop: boolean;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidIso(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Normalize a parsed/scanned stop list into endpoints + interior list. */
export function normalizeParsedStops(data: Pick<ParsedLoadData, 'stops' | 'pickup_location' | 'dropoff_location' | 'dropoff_date'>): NormalizedStops {
  const stops = data.stops ?? [];
  if (stops.length === 0) {
    return {
      pickup_location: data.pickup_location,
      dropoff_location: data.dropoff_location,
      dropoff_date: isValidIso(data.dropoff_date) ? data.dropoff_date : undefined,
      interiorStops: [],
      multiStop: false,
    };
  }

  const isPickup = (s: ParsedStopData) => (s.stop_type ?? '').toLowerCase() === 'pickup';
  const isDrop = (s: ParsedStopData) => (s.stop_type ?? '').toLowerCase() === 'drop';

  let firstPickupIdx = stops.findIndex(isPickup);
  let lastDropIdx = -1;
  for (let i = stops.length - 1; i >= 0; i--) {
    if (isDrop(stops[i])) { lastDropIdx = i; break; }
  }
  // Positional fallback (matches parseLoadText convention).
  if (firstPickupIdx === -1) firstPickupIdx = 0;
  if (lastDropIdx === -1 || lastDropIdx <= firstPickupIdx) lastDropIdx = stops.length - 1;

  const pickupStop = stops[firstPickupIdx];
  const dropStop = stops[lastDropIdx];

  const interiorStops =
    firstPickupIdx < lastDropIdx ? stops.slice(firstPickupIdx + 1, lastDropIdx) : [];

  // Derived dropoff_date: prefer explicit Drop stop_date, fall back to incoming.
  const derivedDropoffDate =
    dropStop && isValidIso(dropStop.stop_date)
      ? dropStop.stop_date
      : (isValidIso(data.dropoff_date) ? data.dropoff_date : undefined);

  return {
    pickup_location: pickupStop?.location ?? data.pickup_location,
    dropoff_location: dropStop?.location ?? data.dropoff_location,
    dropoff_date: derivedDropoffDate,
    interiorStops,
    multiStop: interiorStops.length > 0,
  };
}

/**
 * Remove leading/trailing entries from a stop list that duplicate the load's
 * pickup or dropoff endpoint. Supports legacy rows where Pickup/Drop were
 * stored inside load_stops (so the route display / CSV summary don't show
 * the endpoints twice).
 */
export function dedupeRouteStops<T extends { location: string; stop_type?: string }>(
  pickup: string,
  dropoff: string,
  stops: T[],
): T[] {
  if (!stops || stops.length === 0) return stops ?? [];
  const norm = (s: string) => (s ?? '').trim().toLowerCase();
  const typeOf = (s: T) => (s.stop_type ?? '').trim().toLowerCase();
  const typeIs = (s: T, t: string) => typeOf(s) === t;
  const typeMissing = (s: T) => typeOf(s) === '' || typeOf(s) === 'stop' ? typeOf(s) === '' : false;
  // Phase 29C: a row is treated as a legacy untyped endpoint only when its
  // stop_type is missing entirely. Rows explicitly typed 'Stop' that happen
  // to share the same city as an endpoint must be preserved.
  const isUntypedEndpointAt = (s: T, endpoint: string) =>
    typeOf(s) === '' && norm(s.location) === norm(endpoint);

  let out = stops;
  // Strip leading row if it's explicitly Pickup, or an untyped legacy row
  // whose location matches the pickup endpoint.
  if (out.length > 0 && (typeIs(out[0], 'pickup') || isUntypedEndpointAt(out[0], pickup))) {
    out = out.slice(1);
  }
  // Strip trailing row if it's explicitly Drop, or an untyped legacy row
  // whose location matches the dropoff endpoint.
  if (out.length > 0) {
    const last = out[out.length - 1];
    if (typeIs(last, 'drop') || isUntypedEndpointAt(last, dropoff)) {
      out = out.slice(0, -1);
    }
  }
  return out;
}

/**
 * Save-path drop-off derivation: ONLY an explicit final Drop stop with a
 * valid stop_date may override the manual dropoff_date. Intermediate-stop
 * dates never override.
 */
export function deriveExplicitFinalDropDate(
  stops: { stop_order: number; stop_type: string; stop_date?: string | null }[] | null | undefined,
): string | null {
  if (!stops || stops.length === 0) return null;
  const drops = stops.filter(
    s => (s.stop_type ?? '').toLowerCase() === 'drop' && isValidIso(s.stop_date),
  );
  if (drops.length === 0) return null;
  return [...drops].sort((a, b) => b.stop_order - a.stop_order)[0].stop_date!;
}
