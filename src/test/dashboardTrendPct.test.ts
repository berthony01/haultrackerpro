import { describe, it, expect } from 'vitest';
import { computeTrendPct } from '@/components/DashboardView';

describe('computeTrendPct', () => {
  it('returns null when prev=0 and curr>0', () => {
    expect(computeTrendPct(100, 0)).toBeNull();
  });
  it('returns null when prev=0 and curr=0', () => {
    expect(computeTrendPct(0, 0)).toBeNull();
  });
  it('returns null when prev=0 and curr<0', () => {
    expect(computeTrendPct(-50, 0)).toBeNull();
  });
  it('returns null when prev is null', () => {
    expect(computeTrendPct(100, null)).toBeNull();
  });
  it('returns null when prev is undefined', () => {
    expect(computeTrendPct(100, undefined)).toBeNull();
  });
  it('returns null when curr is null', () => {
    expect(computeTrendPct(null, 100)).toBeNull();
  });
  it('returns null when curr is undefined', () => {
    expect(computeTrendPct(undefined, 100)).toBeNull();
  });
  it('returns null when values are non-finite', () => {
    expect(computeTrendPct(Infinity, 10)).toBeNull();
    expect(computeTrendPct(10, NaN)).toBeNull();
  });
  it('computes normal positive case', () => {
    expect(computeTrendPct(150, 100)).toBeCloseTo(50);
  });
  it('computes normal negative case', () => {
    expect(computeTrendPct(77, 100)).toBeCloseTo(-23);
  });
  it('handles prev negative, curr positive (uses |prev|)', () => {
    // (50 - (-100)) / 100 * 100 = 150
    expect(computeTrendPct(50, -100)).toBeCloseTo(150);
  });
  it('never returns NaN or Infinity', () => {
    const cases: Array<[number | null | undefined, number | null | undefined]> = [
      [0, 0], [1, 0], [-1, 0], [null, null], [undefined, undefined], [NaN, 1], [1, Infinity],
    ];
    for (const [c, p] of cases) {
      const r = computeTrendPct(c, p);
      expect(r === null || Number.isFinite(r)).toBe(true);
    }
  });
});
