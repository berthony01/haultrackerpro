import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { format } from 'date-fns';
import { getPresetRange as getSharedPresetRange, formatShowingRange } from '@/lib/reportRanges';
import { getShowingLabel } from '@/components/DashboardView';

/**
 * Phase 23B parity guard: the Dashboard and DateRangeFilter must derive the
 * shared This Week / Last Week / This Month / Last Month windows from the
 * same source (reportRanges). This test pins the calendar anchor and asserts
 * both layers agree.
 */

const ANCHOR = new Date('2026-05-27T12:00:00'); // Wed

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(ANCHOR);
});
afterAll(() => vi.useRealTimers());

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

describe('Dashboard ↔ reportRanges parity (anchor 2026-05-27)', () => {
  for (const wso of [0, 1] as const) {
    describe(`weekStartsOn=${wso}`, () => {
      const keys = ['this_week', 'last_week', 'this_month', 'last_month'] as const;

      it('Dashboard getShowingLabel uses the same window as reportRanges.getPresetRange', () => {
        for (const k of keys) {
          const shared = getSharedPresetRange(k, wso);
          const label = getShowingLabel(k, wso) as string;
          const expected = `Showing: ${format(new Date(shared.from + 'T00:00:00'), 'MMM d, yyyy')} - ${format(new Date(shared.to + 'T00:00:00'), 'MMM d, yyyy')}`;
          expect(label).toBe(expected);
        }
      });
    });
  }

  it('Monday start: this_week = May 25 → May 31; last_week = May 18 → May 24', () => {
    const tw = getSharedPresetRange('this_week', 1);
    expect(tw.from).toBe('2026-05-25');
    expect(tw.to).toBe('2026-05-31');
    const lw = getSharedPresetRange('last_week', 1);
    expect(lw.from).toBe('2026-05-18');
    expect(lw.to).toBe('2026-05-24');
  });

  it('Sunday start: this_week = May 24 → May 30; last_week = May 17 → May 23', () => {
    const tw = getSharedPresetRange('this_week', 0);
    expect(tw.from).toBe('2026-05-24');
    expect(tw.to).toBe('2026-05-30');
    const lw = getSharedPresetRange('last_week', 0);
    expect(lw.from).toBe('2026-05-17');
    expect(lw.to).toBe('2026-05-23');
  });

  it('this_month / last_month at the anchor', () => {
    const tm = getSharedPresetRange('this_month', 0);
    expect(tm.from).toBe('2026-05-01');
    expect(tm.to).toBe('2026-05-31');
    const lm = getSharedPresetRange('last_month', 0);
    expect(lm.from).toBe('2026-04-01');
    expect(lm.to).toBe('2026-04-30');
  });

  it('formatShowingRange (DateRangeFilter footer) emits the same dates the dashboard does', () => {
    // The two helpers use slightly different separators by design ("–" vs "-")
    // but the resolved dates must match exactly.
    const r = getSharedPresetRange('this_week', 1);
    const filterLabel = formatShowingRange({ from: r.from, to: r.to }) ?? '';
    const dashLabel = getShowingLabel('this_week', 1) ?? '';
    const stripSep = (s: string) => s.replace(/[\u2013-]/g, '|');
    expect(stripSep(filterLabel)).toBe(stripSep(dashLabel));
  });
});
