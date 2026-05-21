/**
 * Phase 6C.6 — Source Date Authority helpers.
 * Phase 6C.8 — Temporal sanity guard.
 *
 * Pure helpers for deciding whether a date extracted from an external source
 * (pasted text, OCR/AI rate-con scan, etc.) should overwrite a form field.
 *
 * Constitution rule: when a source business date is confidently extracted and
 * valid, it is authoritative over the app's entry/upload (today) default.
 * The app's "today" default is only a fallback when no valid source date is
 * present.
 *
 * Phase 6C.8 adds a temporal sanity window: AI/OCR can hallucinate the year
 * (e.g. "5/17" → 2024 instead of current year), saving loads ~years in the
 * past so they fall outside every dashboard/loads period filter. We now
 * reject any source date that lands outside [today − 60d, today + 30d] and
 * fall back to the current value (today's default in the typical case).
 *
 * No UI, no DB, no business math — string in, string out.
 */

/** Strict YYYY-MM-DD ISO check that also validates calendar correctness. */
export function isValidISODate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(`${v}T00:00:00`);
  return (
    !Number.isNaN(dt.getTime()) &&
    dt.getFullYear() === y &&
    dt.getMonth() + 1 === m &&
    dt.getDate() === d
  );
}

/** Phase 6C.8 — sanity window around "today". */
const PAST_WINDOW_DAYS = 60;
const FUTURE_WINDOW_DAYS = 30;

/**
 * Returns true when `iso` is within [today − 60d, today + 30d] in local time.
 * Used to defend against AI year-hallucination on scanned rate cons.
 * `now` is injectable for tests.
 */
export function isWithinSanityWindow(
  iso: string,
  now: Date = new Date(),
): boolean {
  if (!isValidISODate(iso)) return false;
  const target = new Date(`${iso}T00:00:00`).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const min = today - PAST_WINDOW_DAYS * day;
  const max = today + FUTURE_WINDOW_DAYS * day;
  return target >= min && target <= max;
}

/**
 * Resolve load_date when a paste/OCR result is applied to the form.
 *
 * Precedence:
 *   1. valid + in-window incoming source date → use it (overrides today)
 *   2. otherwise → keep current (defends against AI year hallucinations)
 */
export function applySourceLoadDate(
  current: string,
  incoming: string | undefined | null,
  now: Date = new Date(),
): string {
  if (isValidISODate(incoming) && isWithinSanityWindow(incoming, now)) {
    return incoming;
  }
  return current;
}

/**
 * Resolve dropoff_date when a paste/OCR result is applied to the form.
 *
 * Precedence:
 *   1. valid + in-window incoming source date → use it
 *   2. otherwise → keep current (do not invent a dropoff date)
 */
export function applySourceDropoffDate(
  current: string,
  incoming: string | undefined | null,
  now: Date = new Date(),
): string {
  if (isValidISODate(incoming) && isWithinSanityWindow(incoming, now)) {
    return incoming;
  }
  return current;
}
