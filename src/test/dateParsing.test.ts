import { describe, it, expect } from 'vitest';
import { parseLocalYMD } from '@/lib/dateParsing';

describe('parseLocalYMD', () => {
  it('returns a Date with local year/month/day matching the input', () => {
    const d = parseLocalYMD('2026-05-11');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4); // May (0-indexed)
    expect(d.getDate()).toBe(11);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });

  it('toDateString reflects the local calendar day (no UTC shift)', () => {
    // Regression: `new Date("2026-05-11")` would yield UTC midnight, which in
    // America/New_York renders as "Sun May 10 2026". parseLocalYMD must not.
    const d = parseLocalYMD('2026-05-11');
    expect(d.toDateString()).toMatch(/May 11 2026$/);
    // Mid-year date avoids any month-boundary ambiguity from DST in extreme zones.
    const d2 = parseLocalYMD('2026-07-04');
    expect(d2.toDateString()).toMatch(/Jul 4 2026$/);
  });

  it('throws RangeError on malformed input', () => {
    expect(() => parseLocalYMD('')).toThrow(RangeError);
    expect(() => parseLocalYMD('2026/05/11')).toThrow(RangeError);
    expect(() => parseLocalYMD('2026-5-11')).toThrow(RangeError);
    expect(() => parseLocalYMD('not-a-date')).toThrow(RangeError);
    // Real-shape but impossible day.
    expect(() => parseLocalYMD('2026-02-31')).toThrow(RangeError);
    expect(() => parseLocalYMD(undefined as unknown as string)).toThrow(RangeError);
  });

  it('matches the multi-arg Date constructor exactly (epoch equality)', () => {
    const a = parseLocalYMD('2026-05-17').getTime();
    const b = new Date(2026, 4, 17, 0, 0, 0, 0).getTime();
    expect(a).toBe(b);
  });
});
