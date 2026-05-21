/**
 * Parse a "YYYY-MM-DD" string (the value emitted by a native <input type="date">)
 * into a Date anchored at LOCAL midnight.
 *
 * Why: `new Date("YYYY-MM-DD")` is parsed by the JS runtime as UTC midnight.
 * In any negative-UTC timezone (e.g. America/New_York at UTC-4/UTC-5) that
 * resolves to the previous local calendar day, which shifts Custom date-range
 * boundaries by one day. Splitting into numeric (year, month-1, day) and using
 * the multi-arg Date constructor avoids the UTC interpretation entirely.
 *
 * Contract: throws RangeError on malformed input (not a non-empty string in
 * exact YYYY-MM-DD shape, or values that don't form a real calendar date).
 */
export function parseLocalYMD(ymd: string): Date {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new RangeError(`parseLocalYMD: expected "YYYY-MM-DD", got ${JSON.stringify(ymd)}`);
  }
  const [yStr, mStr, dStr] = ymd.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  // Guard against silent rollover (e.g. "2026-02-31").
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new RangeError(`parseLocalYMD: not a real calendar date: ${ymd}`);
  }
  return date;
}
