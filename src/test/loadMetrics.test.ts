import { describe, it, expect } from 'vitest';
import {
  getLoadOperatingMiles,
  getLoadEffectiveRPM,
  getLoadPaidMiles,
} from '@/lib/loadMetrics';
import { summarizeLoads } from '@/lib/financialCalculations';
import { resolveOperatingMiles } from '@/lib/mileageMath';

const mk = (overrides: any = {}): any => ({
  id: 'l1',
  status: 'completed',
  loaded_miles: 0,
  deadhead_miles: 0,
  total_miles: null,
  rate_per_mile: 0,
  estimated_pay: null,
  actual_pay_received: null,
  pay_model: 'loaded_miles_only',
  ...overrides,
});

describe('Phase 6C.3 — getLoadOperatingMiles sanity guard', () => {
  it('1. total_miles missing, loaded + deadhead present → returns sum', () => {
    expect(getLoadOperatingMiles(mk({ loaded_miles: 100, deadhead_miles: 20 }))).toBe(120);
  });

  it('2. corrupted total_miles=1 with valid components → returns components', () => {
    const l = mk({ loaded_miles: 994.79, deadhead_miles: 45, total_miles: 1, estimated_pay: 852.63 });
    expect(getLoadOperatingMiles(l)).toBeCloseTo(1039.79, 2);
    expect(getLoadEffectiveRPM(l)).toBeCloseTo(852.63 / 1039.79, 4);
  });

  it('3. total_miles less than loaded_miles → returns components', () => {
    expect(getLoadOperatingMiles(mk({ loaded_miles: 500, deadhead_miles: 50, total_miles: 200 }))).toBe(550);
  });

  it('4. total_miles less than components by >2 → returns components', () => {
    expect(getLoadOperatingMiles(mk({ loaded_miles: 500, deadhead_miles: 50, total_miles: 540 }))).toBe(550);
  });

  it('5. total_miles equals components → returns stored', () => {
    expect(getLoadOperatingMiles(mk({ loaded_miles: 500, deadhead_miles: 50, total_miles: 550 }))).toBe(550);
  });

  it('6. total_miles within 2mi tolerance below components → returns stored', () => {
    expect(getLoadOperatingMiles(mk({ loaded_miles: 500, deadhead_miles: 50, total_miles: 549 }))).toBe(549);
  });

  it('7. total_miles greater than components by >2 → returns components', () => {
    expect(getLoadOperatingMiles(mk({ loaded_miles: 500, deadhead_miles: 50, total_miles: 600 }))).toBe(550);
  });

  it('8. only total_miles exists → returns stored', () => {
    expect(getLoadOperatingMiles(mk({ total_miles: 700 }))).toBe(700);
  });

  it('9. no mileage at all → returns 0', () => {
    expect(getLoadOperatingMiles(mk())).toBe(0);
  });

  it('10. summarizeLoads totalMiles uses corrected operating miles', () => {
    const loads = [
      mk({ id: 'a', loaded_miles: 994.79, deadhead_miles: 45, total_miles: 1, estimated_pay: 852.63, rate_per_mile: 0.82 }),
      mk({ id: 'b', loaded_miles: 1000, deadhead_miles: 100, total_miles: 1100, estimated_pay: 1000, rate_per_mile: 1 }),
    ];
    const s = summarizeLoads(loads, []);
    expect(s.totalMiles).toBeCloseTo(1039.79 + 1100, 2);
    expect(s.effectiveRPM).toBeCloseTo((852.63 + 1000) / (1039.79 + 1100), 4);
  });

  it('11. pay-model logic unaffected: loaded_plus_deadhead paid miles still loaded+dh', () => {
    const l = mk({ pay_model: 'loaded_plus_deadhead', loaded_miles: 500, deadhead_miles: 50, total_miles: 1 });
    expect(getLoadPaidMiles(l)).toBe(550);
    // operating miles corrected:
    expect(getLoadOperatingMiles(l)).toBe(550);
  });

  it('12. getLoadPaidMiles for loaded_miles_only unchanged when no deadhead pay', () => {
    const l = mk({ pay_model: 'loaded_miles_only', loaded_miles: 500, deadhead_miles: 50, total_miles: 1 });
    expect(getLoadPaidMiles(l)).toBe(500);
  });

  it('oversized 20245 total resolves to 202.45 miles and $0.82 RPM without mutation', () => {
    const load = Object.freeze(mk({ loaded_miles: 195.45, deadhead_miles: 7, total_miles: 20245, estimated_pay: 166.01 }));
    expect(getLoadOperatingMiles(load)).toBeCloseTo(202.45, 8);
    expect(getLoadEffectiveRPM(load).toFixed(2)).toBe('0.82');
    expect(load.total_miles).toBe(20245);
    expect(load.estimated_pay).toBe(166.01);
  });

  it.each([201.7, 203.2, 200.45, 204.45])('preserves historical total %s within inclusive 2-mile tolerance', total => {
    expect(resolveOperatingMiles({ loadedMiles: 195.45, deadheadMiles: 7, totalMiles: total })).toBe(total);
  });

  it('preserves a 0.75-mile difference even below loaded miles', () => {
    expect(resolveOperatingMiles({ loadedMiles: 195.45, deadheadMiles: 0, totalMiles: 194.7 })).toBe(194.7);
  });

  it.each([
    [{ loadedMiles: null, deadheadMiles: null, totalMiles: 700 }, 700],
    [{ loadedMiles: 0, deadheadMiles: 0, totalMiles: 700 }, 700],
    [{ loadedMiles: null, deadheadMiles: null, totalMiles: null }, 0],
    [{ loadedMiles: 0, deadheadMiles: 0, totalMiles: 0 }, 0],
    [{ loadedMiles: 195.45, deadheadMiles: 7, totalMiles: null }, 202.45],
    [{ loadedMiles: 195.45, deadheadMiles: 7, totalMiles: 0 }, 202.45],
    [{ loadedMiles: 195.45, deadheadMiles: null, totalMiles: 20245 }, 195.45],
    [{ loadedMiles: null, deadheadMiles: 7, totalMiles: 20245 }, 7],
  ])('handles missing, zero and partially itemized mileage: %j', (input, expected) => {
    expect(resolveOperatingMiles(input)).toBeCloseTo(expected, 8);
  });
});
