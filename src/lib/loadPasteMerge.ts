/**
 * Phase 1S-B1 — Driver paste reliability.
 *
 * Pure merge helper used by LoadForm when a driver pastes load text more than
 * once into the same unsaved form. Its only job is to make sure values that
 * were imported by a PREVIOUS paste do not silently survive into the NEW load
 * when the new paste omits them — without destroying anything the driver typed
 * manually and without touching unrelated form state.
 *
 * Contract per paste-managed field:
 *   1. New paste has a value            → apply it, mark it paste-owned.
 *   2. New paste omits it AND the current value still exactly equals the prior
 *      paste-owned value                → clear it back to the defined fallback.
 *   3. New paste omits it AND the value differs from the prior paste-owned
 *      value                            → the driver changed it: keep it and
 *                                         drop paste ownership.
 *
 * Mileage fields (loaded/deadhead/total) are intentionally NOT handled here —
 * they remain fresh-per-paste and are reset by LoadForm on every paste.
 */

export const PASTE_MANAGED_FIELDS = [
  'pickup_location',
  'dropoff_location',
  'rate_per_mile',
  'gross_revenue',
  'flat_rate_amount',
  'dh_rate_per_mile',
  'wait_fee',
  'detention_fee',
  'pay_model',
] as const;

export type PasteManagedField = (typeof PASTE_MANAGED_FIELDS)[number];

export type PasteManagedValues = Record<PasteManagedField, string>;

export interface PasteSession {
  /** Values this helper wrote during the most recent paste, per field. */
  owned: Partial<Record<PasteManagedField, string>>;
  /** Trip ID the parser appended to notes during the most recent paste. */
  tripId: string | null;
}

export function createPasteSession(): PasteSession {
  return { owned: {}, tripId: null };
}

export interface PasteMergeInput {
  /** Provenance from the previous paste (or a fresh session). */
  session: PasteSession;
  /** Current form values for the paste-managed fields. */
  current: PasteManagedValues;
  /** Current notes field contents. */
  notes: string;
  /** Values present in the NEW paste. Absent/empty means "not provided". */
  incoming: Partial<Record<PasteManagedField, string | undefined>>;
  /** Fallback to restore when an untouched prior imported value is cleared. */
  fallbacks: PasteManagedValues;
  /** Trip ID from the NEW paste, if any. */
  tripId?: string;
}

export interface PasteMergeResult {
  values: PasteManagedValues;
  notes: string;
  session: PasteSession;
}

function hasValue(v: string | undefined | null): v is string {
  return v != null && String(v).trim() !== '';
}

/** Exact text of the parser-added Trip ID note line. */
export function tripIdNoteLine(tripId: string): string {
  return `Trip ID: ${tripId}`;
}

/**
 * Remove the exact parser-added Trip ID line if it is still present unchanged.
 * A driver-edited variant is never removed.
 */
function removeParserTripIdLine(notes: string, tripId: string): string {
  const target = tripIdNoteLine(tripId);
  const lines = notes.split('\n');
  const idx = lines.findIndex(l => l === target);
  if (idx === -1) return notes;
  lines.splice(idx, 1);
  return lines.join('\n');
}

export function mergePasteIntoForm(input: PasteMergeInput): PasteMergeResult {
  const { session, current, incoming, fallbacks } = input;
  const values = { ...current } as PasteManagedValues;
  const nextOwned: Partial<Record<PasteManagedField, string>> = {};

  for (const field of PASTE_MANAGED_FIELDS) {
    const next = incoming[field];
    if (hasValue(next)) {
      values[field] = String(next);
      nextOwned[field] = String(next);
      continue;
    }
    const prior = session.owned[field];
    if (prior !== undefined && current[field] === prior) {
      // Untouched value imported by the previous paste → clear to fallback.
      values[field] = fallbacks[field];
    }
    // Otherwise the driver owns it now; keep the value, drop paste ownership.
  }

  // --- Trip ID provenance ---
  let notes = input.notes;
  if (session.tripId) {
    notes = removeParserTripIdLine(notes, session.tripId);
  }
  let tripId: string | null = null;
  if (hasValue(input.tripId)) {
    tripId = String(input.tripId);
    const line = tripIdNoteLine(tripId);
    if (!notes.split('\n').includes(line)) {
      notes = notes ? `${notes}\n${line}` : line;
    }
  }

  return { values, notes, session: { owned: nextOwned, tripId } };
}
