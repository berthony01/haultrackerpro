import { describe, it, expect } from 'vitest';
import {
  deriveTrailingDropDate,
  deriveExplicitFinalDropDate,
  normalizeEditorStopsForSave,
} from '@/lib/stopNormalization';

const mk = (o: number, type: string, date: string | null = null) => ({
  stop_order: o,
  stop_type: type,
  stop_date: date,
  location: 'X, TX',
});

describe('Phase 29E — deriveTrailingDropDate (manual-editor helper)', () => {
  it('returns null when an interior row is Drop but the trailing row is Stop', () => {
    const stops = [mk(1, 'Drop', '2026-05-30'), mk(2, 'Stop', '2026-05-31')];
    expect(deriveTrailingDropDate(stops)).toBeNull();
    // The legacy helper still finds the interior Drop — proving the helpers
    // diverge intentionally.
    expect(deriveExplicitFinalDropDate(stops)).toBe('2026-05-30');
  });

  it('returns the date when the trailing row is Drop with a valid stop_date', () => {
    const stops = [mk(1, 'Stop', '2026-05-29'), mk(2, 'Drop', '2026-05-30')];
    expect(deriveTrailingDropDate(stops)).toBe('2026-05-30');
  });

  it('returns null when trailing Drop has no date', () => {
    const stops = [mk(1, 'Stop'), mk(2, 'Drop', null)];
    expect(deriveTrailingDropDate(stops)).toBeNull();
  });

  it('returns null when trailing Drop has an invalid date', () => {
    const stops = [mk(1, 'Stop'), mk(2, 'Drop', 'not-a-date')];
    expect(deriveTrailingDropDate(stops)).toBeNull();
  });

  it('uses stop_order (not array position) to find the trailing row', () => {
    const stops = [mk(2, 'Drop', '2026-05-30'), mk(1, 'Stop', '2026-05-29')];
    expect(deriveTrailingDropDate(stops)).toBe('2026-05-30');
  });

  it('returns null for empty / nullish input', () => {
    expect(deriveTrailingDropDate([])).toBeNull();
    expect(deriveTrailingDropDate(null)).toBeNull();
    expect(deriveTrailingDropDate(undefined)).toBeNull();
  });
});

describe('Phase 29E — save / warning / note agreement', () => {
  const base = {
    pickup_location: 'Dallas, TX',
    dropoff_location: 'Atlanta, GA',
    load_date: '2026-05-29',
    dropoff_date: '',
  };

  it('interior-only Drop: save does NOT promote, helper returns null (warning fires, no note)', () => {
    const stops = [
      { stop_order: 1, location: 'Memphis, TN', stop_type: 'Drop', stop_date: '2026-05-30' },
      { stop_order: 2, location: 'Atlanta, GA', stop_type: 'Stop', stop_date: '2026-05-31' },
    ];
    const saved = normalizeEditorStopsForSave({ ...base, stops });
    // dropoff_date falls back to load_date (no trailing-Drop promotion)
    expect(saved.dropoff_date).toBe('2026-05-29');
    expect(deriveTrailingDropDate(stops)).toBeNull();
  });

  it('trailing Drop: save promotes, helper returns same date (warning suppressed, note shown)', () => {
    const stops = [
      { stop_order: 1, location: 'Memphis, TN', stop_type: 'Stop', stop_date: '2026-05-29' },
      { stop_order: 2, location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-30' },
    ];
    const saved = normalizeEditorStopsForSave({ ...base, stops });
    expect(saved.dropoff_date).toBe('2026-05-30');
    expect(saved.dropoff_location).toBe('Atlanta, GA');
    expect(deriveTrailingDropDate(stops)).toBe('2026-05-30');
  });

  it('adding a Stop after a trailing Drop demotes the Drop — only one final-delivery candidate remains', () => {
    // Simulating MultiStopEditor.addStop demotion behaviour
    const before = [
      { stop_order: 1, location: 'Memphis, TN', stop_type: 'Stop', stop_date: '2026-05-29' },
      { stop_order: 2, location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-30' },
    ];
    const trailingIsDrop = before[before.length - 1].stop_type.toLowerCase() === 'drop';
    const demoted = trailingIsDrop
      ? before.map((s, i) => i === before.length - 1 ? { ...s, stop_type: 'Stop' } : s)
      : before;
    const after = [...demoted, { stop_order: demoted.length + 1, location: '', stop_type: 'Stop', stop_date: null }];
    const dropCount = after.filter(s => s.stop_type.toLowerCase() === 'drop').length;
    expect(dropCount).toBe(0);
    expect(deriveTrailingDropDate(after)).toBeNull();
  });
});
