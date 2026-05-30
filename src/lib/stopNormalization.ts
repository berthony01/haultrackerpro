/**
 * Phase 29B–D — Canonical stop-model normalization for paste, scan, manual
 * entry, and edit flows.
 *
 * Rules:
 *  - Top-level fields (pickup_location, dropoff_location, load_date,
 *    dropoff_date) are the canonical endpoints.
 *  - Saved load_stops rows store INTERIOR (intermediate) stops only.
 *  - The manual MultiStopEditor temporarily allows a trailing Drop row in
 *    UI state so the driver can set the final delivery date; that row is
 *    promoted to top-level dropoff_location/dropoff_date by
 *    `normalizeEditorStopsForSave` before persisting.
 *  - First Pickup and last Drop are stripped out of the interior list and
 *    promoted to the top-level endpoints.
 *  - Only explicitly typed rows ('Pickup' / 'Drop') promote to endpoints in
 *    manual entry — positional fallback is reserved for paste/scan parsers
 *    that already know about [Pickup, ..., Drop] convention.
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

const typeOf = (s: { stop_type?: string | null } | undefined | null) =>
  (s?.stop_type ?? '').trim().toLowerCase();

/** Normalize a parsed/scanned stop list into endpoints + interior list. */
export function normalizeParsedStops(
  data: Pick<ParsedLoadData, 'stops' | 'pickup_location' | 'dropoff_location' | 'dropoff_date'>,
): NormalizedStops {
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

  // Phase 29D: single-stop AI payload must NEVER fill both endpoints from the
  // same row. Branch by explicit type; untyped/Stop rows leave both endpoints
  // alone so the AI cannot collapse a route.
  if (stops.length === 1) {
    const only = stops[0];
    const t = typeOf(only);
    const baseDropoff = isValidIso(data.dropoff_date) ? data.dropoff_date : undefined;
    if (t === 'pickup') {
      return {
        pickup_location: only.location ?? data.pickup_location,
        dropoff_location: data.dropoff_location,
        dropoff_date: baseDropoff,
        interiorStops: [],
        multiStop: false,
      };
    }
    if (t === 'drop') {
      return {
        pickup_location: data.pickup_location,
        dropoff_location: only.location ?? data.dropoff_location,
        dropoff_date: isValidIso(only.stop_date) ? only.stop_date : baseDropoff,
        interiorStops: [],
        multiStop: false,
      };
    }
    // Untyped or 'Stop' — do not overwrite either endpoint.
    return {
      pickup_location: data.pickup_location,
      dropoff_location: data.dropoff_location,
      dropoff_date: baseDropoff,
      interiorStops: [],
      multiStop: false,
    };
  }

  const isPickup = (s: ParsedStopData) => typeOf(s) === 'pickup';
  const isDrop = (s: ParsedStopData) => typeOf(s) === 'drop';

  let firstPickupIdx = stops.findIndex(isPickup);
  let lastDropIdx = -1;
  for (let i = stops.length - 1; i >= 0; i--) {
    if (isDrop(stops[i])) { lastDropIdx = i; break; }
  }
  // Positional fallback (matches parseLoadText convention) — only safe when
  // we have at least 2 stops.
  if (firstPickupIdx === -1) firstPickupIdx = 0;
  if (lastDropIdx === -1 || lastDropIdx <= firstPickupIdx) lastDropIdx = stops.length - 1;

  const pickupStop = stops[firstPickupIdx];
  const dropStop = stops[lastDropIdx];

  // Phase 29G: coerce any interior row to plain 'Stop' — never retain a stale
  // 'Pickup'/'Drop' type that some AI payloads emit for intermediate rows.
  const interiorStops =
    firstPickupIdx < lastDropIdx
      ? stops.slice(firstPickupIdx + 1, lastDropIdx).map(s => ({ ...s, stop_type: 'Stop' }))
      : [];

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
 * pickup or dropoff endpoint. Used by route rendering / CSV summary so legacy
 * rows do not display endpoints twice.
 */
export function dedupeRouteStops<T extends { location: string; stop_type?: string }>(
  pickup: string,
  dropoff: string,
  stops: T[],
): T[] {
  if (!stops || stops.length === 0) return stops ?? [];
  const norm = (s: string) => (s ?? '').trim().toLowerCase();
  const t = (s: T) => (s.stop_type ?? '').trim().toLowerCase();
  const typeIs = (s: T, tag: string) => t(s) === tag;
  // Phase 29C: a row is treated as a legacy untyped endpoint only when its
  // stop_type is missing entirely. Rows explicitly typed 'Stop' that happen
  // to share the same city as an endpoint must be preserved.
  const isUntypedEndpointAt = (s: T, endpoint: string) =>
    t(s) === '' && norm(s.location) === norm(endpoint);

  let out = stops;
  if (out.length > 0 && (typeIs(out[0], 'pickup') || isUntypedEndpointAt(out[0], pickup))) {
    out = out.slice(1);
  }
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

/**
 * Phase 29E/F — Manual-editor-only derivation. Returns the trailing Drop
 * row's stop_date ONLY when:
 *   - the LAST row (by stop_order ascending; ties broken by later array
 *     position) is typed 'Drop'
 *   - that row has a valid ISO stop_date
 * Returns null otherwise. This mirrors `normalizeEditorStopsForSave`, so the
 * inline note, missing-final-date warning, and save path all agree.
 */
export function deriveTrailingDropDate(
  stops: { stop_order: number; stop_type: string; stop_date?: string | null }[] | null | undefined,
): string | null {
  if (!stops || stops.length === 0) return null;
  // Phase 29F: explicit deterministic tie-break — equal stop_order falls back
  // to original array position so later entries always win.
  const indexed = stops.map((s, i) => ({ s, i }));
  indexed.sort((a, b) => {
    if (a.s.stop_order !== b.s.stop_order) return a.s.stop_order - b.s.stop_order;
    return a.i - b.i;
  });
  const last = indexed[indexed.length - 1].s;
  if ((last.stop_type ?? '').toLowerCase() !== 'drop') return null;
  if (!isValidIso(last.stop_date)) return null;
  return last.stop_date!;
}

/**
 * Phase 29F — UI-side renumbering helper. Use after add/remove/edit in
 * MultiStopEditor so `stop_order` is always sequential 1..N and matches array
 * position. Pure: preserves all other fields. The save path renumbers again
 * defensively, but UI consumers (inline note, warning gate) need the same
 * canonical ordering as save.
 */
export function normalizeEditorStopsForUi<
  T extends {
    stop_order?: number;
    location: string;
    stop_type: string;
    stop_date?: string | null;
    detention_minutes?: number | null;
  },
>(stops: T[] | null | undefined): T[] {
  if (!stops || stops.length === 0) return [];
  return stops.map((s, i) => ({ ...s, stop_order: i + 1 }));
}


// ───────────────────────────────────────────────────────────────────────────
// Phase 29D — Manual editor save normalization
// ───────────────────────────────────────────────────────────────────────────

export interface EditorStopForSave {
  stop_order: number;
  location: string;
  stop_type: string;
  detention_minutes?: number | null;
  stop_date?: string | null;
}

export interface NormalizedEditorSave {
  pickup_location: string;
  dropoff_location: string;
  load_date: string;
  dropoff_date: string;
  /** Interior stops only — leading Pickup / trailing Drop have been promoted out. */
  interiorStops: EditorStopForSave[];
}

/**
 * Normalize the manual editor's stops on save.
 *
 * Rules (Phase 29D):
 *  1. Top-level fields remain canonical.
 *  2. If the editor's leading row is explicitly typed 'Pickup':
 *     - promote its location to top-level pickup_location
 *     - if it has a valid stop_date, promote it to top-level load_date
 *     - strip that row from interior stops
 *  3. If the editor's trailing row is explicitly typed 'Drop':
 *     - promote its location to top-level dropoff_location
 *     - if it has a valid stop_date, promote it to top-level dropoff_date
 *     - strip that row from interior stops
 *  4. Remaining rows are interior stops only.
 *  5. Rows typed 'Stop' are NEVER promoted by position alone.
 *  6. An explicit final Drop row's location overrides any stale top-level
 *     dropoff_location — driver intent wins.
 */
export function normalizeEditorStopsForSave(args: {
  pickup_location: string;
  dropoff_location: string;
  load_date: string;
  dropoff_date: string;
  stops: EditorStopForSave[];
}): NormalizedEditorSave {
  const incoming = (args.stops ?? []).slice();
  let pickup = args.pickup_location;
  let dropoff = args.dropoff_location;
  let loadDate = args.load_date;
  let dropDate = args.dropoff_date;

  if (incoming.length > 0 && typeOf(incoming[0]) === 'pickup') {
    const head = incoming.shift()!;
    if (head.location && head.location.trim()) pickup = head.location;
    if (isValidIso(head.stop_date)) loadDate = head.stop_date as string;
  }
  if (incoming.length > 0 && typeOf(incoming[incoming.length - 1]) === 'drop') {
    const tail = incoming.pop()!;
    if (tail.location && tail.location.trim()) dropoff = tail.location;
    if (isValidIso(tail.stop_date)) dropDate = tail.stop_date as string;
  }

  const interiorStops = incoming.map((s, i) => ({
    stop_order: i + 1,
    location: s.location,
    stop_type: s.stop_type || 'Stop',
    detention_minutes: s.detention_minutes ?? null,
    stop_date: s.stop_date ?? null,
  }));

  return {
    pickup_location: pickup,
    dropoff_location: dropoff,
    load_date: loadDate,
    dropoff_date: dropDate || loadDate,
    interiorStops,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Phase 29D — Legacy edit normalization
// ───────────────────────────────────────────────────────────────────────────

export interface LegacyEditNormalization {
  load_date: string;
  dropoff_date: string;
  /** Stops to seed into the editor — interior stops only when safe to strip. */
  editorStops: EditorStopForSave[];
  /** True when a legacy endpoint row conflicted with top-level data — caller
   *  may want to surface a warning instead of silently dropping it. */
  hasConflict: boolean;
}

/**
 * Phase 29D/F — Strip legacy Pickup/Drop endpoint rows from a saved
 * load_stops list when they match the top-level endpoints. When they
 * conflict, keep them so the driver can review.
 *
 * Phase 29F: also treats a leading/trailing row as a legacy endpoint when
 * its stop_type is missing/blank/invalid AND its location matches the
 * top-level pickup/dropoff. Conflicting untyped endpoint rows are preserved
 * and flagged. Remaining rows always end up with a valid stop_type ('Stop')
 * so the editor Select never renders a blank value.
 */
const VALID_EDITOR_TYPES = new Set(['pickup', 'drop', 'stop']);

export function normalizeLegacyEditStops(args: {
  pickup_location: string;
  dropoff_location: string;
  load_date: string;
  dropoff_date: string;
  stops: EditorStopForSave[];
}): LegacyEditNormalization {
  let loadDate = args.load_date;
  let dropDate = args.dropoff_date;
  const stops = (args.stops ?? []).slice();
  let hasConflict = false;

  const norm = (s: string) => (s ?? '').trim().toLowerCase();
  const isUntypedOrInvalid = (s: EditorStopForSave) =>
    !VALID_EDITOR_TYPES.has(typeOf(s));

  // Leading endpoint: typed Pickup OR untyped row whose location matches pickup
  if (stops.length > 0) {
    const head = stops[0];
    const t = typeOf(head);
    const sameCity = norm(head.location) === norm(args.pickup_location);
    if (t === 'pickup') {
      if (sameCity) {
        if (!loadDate && isValidIso(head.stop_date)) loadDate = head.stop_date as string;
        stops.shift();
      } else {
        hasConflict = true;
      }
    } else if (isUntypedOrInvalid(head) && sameCity) {
      if (!loadDate && isValidIso(head.stop_date)) loadDate = head.stop_date as string;
      stops.shift();
    }
  }
  // Trailing endpoint: typed Drop OR untyped row whose location matches dropoff
  if (stops.length > 0) {
    const tail = stops[stops.length - 1];
    const t = typeOf(tail);
    const sameCity = norm(tail.location) === norm(args.dropoff_location);
    if (t === 'drop') {
      if (sameCity) {
        if (!dropDate && isValidIso(tail.stop_date)) dropDate = tail.stop_date as string;
        stops.pop();
      } else {
        hasConflict = true;
      }
    } else if (isUntypedOrInvalid(tail) && sameCity) {
      if (!dropDate && isValidIso(tail.stop_date)) dropDate = tail.stop_date as string;
      stops.pop();
    }
  }

  return {
    load_date: loadDate,
    dropoff_date: dropDate,
    editorStops: stops.map((s, i) => ({
      ...s,
      stop_order: i + 1,
      // Phase 29F: any remaining row with a missing/blank/invalid stop_type
      // (e.g. an untyped intermediate row that did NOT match an endpoint)
      // becomes a plain 'Stop' so the Select never renders empty.
      stop_type: VALID_EDITOR_TYPES.has(typeOf(s))
        ? (typeOf(s) === 'pickup' ? 'Pickup' : typeOf(s) === 'drop' ? 'Drop' : 'Stop')
        : 'Stop',
    })),
    hasConflict,
  };
}
