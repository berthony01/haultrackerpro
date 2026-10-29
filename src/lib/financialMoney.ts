/**
 * Recorded-money precision helpers (F3-P1).
 *
 * Converts an original finite decimal value (number or string) to integer
 * cents with deterministic signed half-away-from-zero rounding. The decimal
 * text is parsed digit-by-digit (BigInt), so binary float artifacts such as
 * 1.005 → 1.00499999… never affect rounding. Stored values are never changed;
 * this is read-time recognition only.
 *
 * Invalid / non-finite / empty inputs recognize as 0 cents (same fail-safe as
 * the previous `Number(v) || 0` aggregation). Values beyond
 * Number.MAX_SAFE_INTEGER cents throw a RangeError instead of losing precision.
 */

const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);

export function toCents(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number' && !Number.isFinite(value)) return 0;
  const text = (typeof value === 'number' ? String(value) : String(value)).trim();
  const m = DECIMAL.exec(text);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return 0;
  const [, sign, whole, frac = '', exp = '0'] = m;
  const digits = BigInt((whole + frac) || '0');
  // value = digits × 10^(exp - frac.length); cents = value × 100
  const shift = Number(exp) - frac.length + 2;
  let absCents: bigint;
  if (shift >= 0) {
    if (shift > 40) throw new RangeError('Monetary value too large');
    absCents = digits * BigInt(10) ** BigInt(shift);
  } else {
    const div = BigInt(10) ** BigInt(-shift);
    absCents = (digits * BigInt(2) + div) / (div * BigInt(2)); // half away from zero
  }
  if (absCents > MAX) throw new RangeError('Monetary value too large');
  const n = Number(absCents);
  return sign === '-' && n !== 0 ? -n : n;
}

/** Integer cents → dollars (exact for safe-integer cents). */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

/** Sum integer cents with a safe-integer guard. */
export function sumCents(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) {
    total += v;
    if (!Number.isSafeInteger(total)) throw new RangeError('Monetary total too large');
  }
  return total;
}

/** Recognize each value to cents individually, then sum. */
export function sumRecognizedCents<T>(items: T[], pick: (item: T) => unknown): number {
  return sumCents(items.map(i => toCents(pick(i))));
}

/** Round a ratio to `places` decimals, half away from zero (display ratios). */
export function roundRatio(value: number, places = 4): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** places;
  const r = Math.sign(value) * Math.round(Math.abs(value) * f + Number.EPSILON * f) / f;
  return Object.is(r, -0) ? 0 : r;
}
