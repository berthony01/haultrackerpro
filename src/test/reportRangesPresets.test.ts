import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getPresetRange, isDateInRange, getPreviousComparisonRange } from '@/lib/reportRanges';

describe('reportRanges — week-start aware presets (anchor 2026-05-27)', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-27T12:00:00'));
  });
  afterAll(() => vi.useRealTimers());

  it('Monday start: this_week = May 25 → May 31; last_week = May 18 → May 24', () => {
    const tw = getPresetRange('this_week', 1);
    expect(tw.from).toBe('2026-05-25');
    expect(tw.to).toBe('2026-05-31');
    const lw = getPresetRange('last_week', 1);
    expect(lw.from).toBe('2026-05-18');
    expect(lw.to).toBe('2026-05-24');
  });

  it('Sunday start: this_week = May 24 → May 30; last_week = May 17 → May 23', () => {
    const tw = getPresetRange('this_week', 0);
    expect(tw.from).toBe('2026-05-24');
    expect(tw.to).toBe('2026-05-30');
    const lw = getPresetRange('last_week', 0);
    expect(lw.from).toBe('2026-05-17');
    expect(lw.to).toBe('2026-05-23');
  });

  it('isDateInRange is inclusive on both ends', () => {
    const r = { from: '2026-05-25', to: '2026-05-31' };
    expect(isDateInRange('2026-05-25', r)).toBe(true);
    expect(isDateInRange('2026-05-31', r)).toBe(true);
    expect(isDateInRange('2026-05-24', r)).toBe(false);
    expect(isDateInRange('2026-06-01', r)).toBe(false);
  });

  it('getPreviousComparisonRange returns previous window for this_week and custom', () => {
    const tw = getPresetRange('this_week', 1); // 2026-05-25 → 2026-05-31
    const prev = getPreviousComparisonRange('this_week', tw, 1);
    expect(prev?.from).toBe('2026-05-18');
    expect(prev?.to).toBe('2026-05-24');

    const custom = { key: 'custom' as const, label: 'Custom', from: '2026-05-10', to: '2026-05-20' };
    const prevCustom = getPreviousComparisonRange('custom', custom, 1);
    // Equal-length (11-day inclusive window) ending just before from.
    expect(prevCustom?.to).toBe('2026-05-09');
    expect(prevCustom?.from).toBe('2026-04-29');
  });
});
