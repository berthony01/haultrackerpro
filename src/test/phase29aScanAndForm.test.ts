import { describe, it, expect } from 'vitest';
import { isValidISODate, isWithinSanityWindow } from '@/lib/sourceDate';

/**
 * Phase 29A — mirrors the helpers in ScanLoadModal.tsx so we can test them
 * without rendering the dialog. Keep these in sync with that file.
 */
function normalizeStopType(raw: unknown): string {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'pickup' || v === 'pick-up' || v === 'pick up' || v === 'pu') return 'Pickup';
  if (v === 'drop' || v === 'dropoff' || v === 'drop-off' || v === 'drop off' || v === 'delivery' || v === 'del') return 'Drop';
  return 'Stop';
}
function safeStopDate(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  return isValidISODate(raw) && isWithinSanityWindow(raw) ? raw : undefined;
}

describe('Phase 29A — AI scan stop normalization', () => {
  it('maps Dropoff → Drop', () => {
    expect(normalizeStopType('Dropoff')).toBe('Drop');
    expect(normalizeStopType('drop-off')).toBe('Drop');
    expect(normalizeStopType('delivery')).toBe('Drop');
  });
  it('keeps Pickup and Stop', () => {
    expect(normalizeStopType('Pickup')).toBe('Pickup');
    expect(normalizeStopType('pu')).toBe('Pickup');
    expect(normalizeStopType('Stop')).toBe('Stop');
    expect(normalizeStopType(undefined)).toBe('Stop');
  });
  it('rejects malformed stop_date', () => {
    expect(safeStopDate('not-a-date')).toBeUndefined();
    expect(safeStopDate('2026-13-40')).toBeUndefined();
    expect(safeStopDate(undefined)).toBeUndefined();
  });
  it('rejects in-shape but out-of-window stop_date from AI', () => {
    expect(safeStopDate('2019-01-01')).toBeUndefined();
  });
});

describe('Phase 29A — acknowledgedDropWarning reset', () => {
  /**
   * Pure reducer mirroring the useEffect reset in LoadForm. The hook resets
   * `acknowledgedDropWarning` to false whenever multiStop, stops,
   * form.dropoff_date, or form.load_date changes.
   */
  function reduce(prev: boolean, deps: { multiStop: boolean; stopsKey: string; dropoff_date: string; load_date: string }, lastDeps?: typeof deps) {
    if (!lastDeps) return false;
    const changed =
      prev !== false &&
      (deps.multiStop !== lastDeps.multiStop ||
        deps.stopsKey !== lastDeps.stopsKey ||
        deps.dropoff_date !== lastDeps.dropoff_date ||
        deps.load_date !== lastDeps.load_date);
    return changed ? false : prev;
  }

  it('resets when dropoff_date changes', () => {
    const a = { multiStop: true, stopsKey: 'a', dropoff_date: '2026-05-29', load_date: '2026-05-29' };
    const b = { ...a, dropoff_date: '2026-05-30' };
    expect(reduce(true, b, a)).toBe(false);
  });
  it('resets when stops change', () => {
    const a = { multiStop: true, stopsKey: 'a', dropoff_date: '2026-05-29', load_date: '2026-05-29' };
    const b = { ...a, stopsKey: 'b' };
    expect(reduce(true, b, a)).toBe(false);
  });
  it('does not reset when nothing relevant changes', () => {
    const a = { multiStop: true, stopsKey: 'a', dropoff_date: '2026-05-29', load_date: '2026-05-29' };
    expect(reduce(true, a, a)).toBe(true);
  });
});
