/**
 * Phase 6C.6 — Source Date Authority helpers.
 *
 * Pure helpers for deciding whether a date extracted from an external source
 * (pasted text, OCR/AI rate-con scan, etc.) should overwrite a form field.
 *
 * Constitution rule: when a source business date is confidently extracted and
 * valid, it is authoritative over the app's entry/upload (today) default.
 * The app's "today" default is only a fallback when no valid source date is
 * present.
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

/**
 * Resolve load_date when a paste/OCR result is applied to the form.
 *
 * Precedence:
 *   1. valid incoming source date → use it (overrides today default)
 *   2. otherwise → keep current
 */
export function applySourceLoadDate(
  current: string,
  incoming: string | undefined | null,
): string {
  if (isValidISODate(incoming)) return incoming as string;
  return current;
}

/**
 * Resolve dropoff_date when a paste/OCR result is applied to the form.
 *
 * Precedence:
 *   1. valid incoming source date → use it
 *   2. otherwise → keep current (do not invent a dropoff date)
 */
export function applySourceDropoffDate(
  current: string,
  incoming: string | undefined | null,
): string {
  if (isValidISODate(incoming)) return incoming as string;
  return current;
}
