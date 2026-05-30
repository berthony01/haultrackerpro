import { describe, it, expect } from 'vitest';
import {
  normalizeParsedStops,
  normalizeEditorStopsForSave,
  normalizeLegacyEditStops,
} from '@/lib/stopNormalization';

describe('Phase 29D — normalizeEditorStopsForSave (manual save)', () => {
  it('promotes explicit trailing Drop to top-level dropoff_location + dropoff_date', () => {
    const out = normalizeEditorStopsForSave({
      pickup_location: 'Dallas, TX',
      dropoff_location: 'OLD CITY, ZZ',
      load_date: '2026-05-29',
      dropoff_date: '',
      stops: [
        { stop_order: 1, location: 'Memphis, TN', stop_type: 'Stop', stop_date: null },
        { stop_order: 2, location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-30' },
      ],
    });
    expect(out.dropoff_location).toBe('Atlanta, GA');
    expect(out.dropoff_date).toBe('2026-05-30');
    expect(out.interiorStops).toHaveLength(1);
    expect(out.interiorStops[0].location).toBe('Memphis, TN');
  });

  it('promotes explicit leading Pickup to top-level pickup_location + load_date', () => {
    const out = normalizeEditorStopsForSave({
      pickup_location: 'OLD CITY, ZZ',
      dropoff_location: 'Atlanta, GA',
      load_date: '2026-05-28',
      dropoff_date: '2026-05-30',
      stops: [
        { stop_order: 1, location: 'Dallas, TX', stop_type: 'Pickup', stop_date: '2026-05-29' },
        { stop_order: 2, location: 'Memphis, TN', stop_type: 'Stop', stop_date: null },
      ],
    });
    expect(out.pickup_location).toBe('Dallas, TX');
    expect(out.load_date).toBe('2026-05-29');
    expect(out.interiorStops).toHaveLength(1);
    expect(out.interiorStops[0].location).toBe('Memphis, TN');
  });

  it('saves zero interior stops when only Pickup+Drop are present', () => {
    const out = normalizeEditorStopsForSave({
      pickup_location: 'X', dropoff_location: 'Y',
      load_date: '2026-05-29', dropoff_date: '',
      stops: [
        { stop_order: 1, location: 'Dallas, TX', stop_type: 'Pickup' },
        { stop_order: 2, location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-30' },
      ],
    });
    expect(out.interiorStops).toHaveLength(0);
    expect(out.pickup_location).toBe('Dallas, TX');
    expect(out.dropoff_location).toBe('Atlanta, GA');
    expect(out.dropoff_date).toBe('2026-05-30');
  });

  it('does NOT promote a row typed Stop by position alone', () => {
    const out = normalizeEditorStopsForSave({
      pickup_location: 'Dallas, TX', dropoff_location: 'Atlanta, GA',
      load_date: '2026-05-29', dropoff_date: '2026-05-30',
      stops: [
        { stop_order: 1, location: 'Memphis, TN', stop_type: 'Stop', stop_date: '2026-06-01' },
      ],
    });
    expect(out.pickup_location).toBe('Dallas, TX');
    expect(out.dropoff_location).toBe('Atlanta, GA');
    expect(out.interiorStops).toHaveLength(1);
    expect(out.interiorStops[0].location).toBe('Memphis, TN');
  });

  it('explicit Drop row overrides stale top-level dropoff_location', () => {
    const out = normalizeEditorStopsForSave({
      pickup_location: 'Dallas, TX', dropoff_location: 'WRONG, ZZ',
      load_date: '2026-05-29', dropoff_date: '2026-05-30',
      stops: [
        { stop_order: 1, location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-31' },
      ],
    });
    expect(out.dropoff_location).toBe('Atlanta, GA');
    expect(out.dropoff_date).toBe('2026-05-31');
  });
});

describe('Phase 29D — normalizeLegacyEditStops', () => {
  it('strips legacy Pickup/Drop rows that match top-level endpoints', () => {
    const out = normalizeLegacyEditStops({
      pickup_location: 'Dallas, TX',
      dropoff_location: 'Atlanta, GA',
      load_date: '2026-05-29',
      dropoff_date: '2026-05-30',
      stops: [
        { stop_order: 1, location: 'Dallas, TX', stop_type: 'Pickup' },
        { stop_order: 2, location: 'Memphis, TN', stop_type: 'Stop' },
        { stop_order: 3, location: 'Atlanta, GA', stop_type: 'Drop' },
      ],
    });
    expect(out.editorStops).toHaveLength(1);
    expect(out.editorStops[0].location).toBe('Memphis, TN');
    expect(out.hasConflict).toBe(false);
  });

  it('seeds missing top-level dates from legacy endpoint rows', () => {
    const out = normalizeLegacyEditStops({
      pickup_location: 'Dallas, TX',
      dropoff_location: 'Atlanta, GA',
      load_date: '',
      dropoff_date: '',
      stops: [
        { stop_order: 1, location: 'Dallas, TX', stop_type: 'Pickup', stop_date: '2026-05-29' },
        { stop_order: 2, location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-30' },
      ],
    });
    expect(out.load_date).toBe('2026-05-29');
    expect(out.dropoff_date).toBe('2026-05-30');
    expect(out.editorStops).toHaveLength(0);
  });

  it('preserves and flags conflicting legacy endpoint rows', () => {
    const out = normalizeLegacyEditStops({
      pickup_location: 'Dallas, TX',
      dropoff_location: 'Atlanta, GA',
      load_date: '2026-05-29',
      dropoff_date: '2026-05-30',
      stops: [
        { stop_order: 1, location: 'DIFFERENT, ZZ', stop_type: 'Drop', stop_date: '2026-05-31' },
      ],
    });
    expect(out.hasConflict).toBe(true);
    expect(out.editorStops).toHaveLength(1);
  });
});

describe('Phase 29D — single-stop normalizeParsedStops cannot collapse endpoints', () => {
  it('single Drop row does NOT overwrite incoming pickup_location', () => {
    const n = normalizeParsedStops({
      pickup_location: 'Dallas, TX',
      dropoff_location: 'PLACEHOLDER',
      stops: [{ location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-30' }],
    });
    expect(n.pickup_location).toBe('Dallas, TX');
    expect(n.dropoff_location).toBe('Atlanta, GA');
    expect(n.dropoff_date).toBe('2026-05-30');
    expect(n.multiStop).toBe(false);
  });

  it('single Pickup row does NOT overwrite incoming dropoff_location', () => {
    const n = normalizeParsedStops({
      pickup_location: 'PLACEHOLDER',
      dropoff_location: 'Atlanta, GA',
      stops: [{ location: 'Dallas, TX', stop_type: 'Pickup' }],
    });
    expect(n.pickup_location).toBe('Dallas, TX');
    expect(n.dropoff_location).toBe('Atlanta, GA');
    expect(n.multiStop).toBe(false);
  });

  it('single untyped / Stop row does NOT overwrite either endpoint', () => {
    const n = normalizeParsedStops({
      pickup_location: 'Dallas, TX',
      dropoff_location: 'Atlanta, GA',
      stops: [{ location: 'Memphis, TN', stop_type: 'Stop' }],
    });
    expect(n.pickup_location).toBe('Dallas, TX');
    expect(n.dropoff_location).toBe('Atlanta, GA');
    expect(n.multiStop).toBe(false);
  });

  it('two-stop [Pickup, Drop] still promotes both endpoints (regression)', () => {
    const n = normalizeParsedStops({
      stops: [
        { location: 'Dallas, TX', stop_type: 'Pickup', stop_date: '2026-05-29' },
        { location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-30' },
      ],
    });
    expect(n.pickup_location).toBe('Dallas, TX');
    expect(n.dropoff_location).toBe('Atlanta, GA');
    expect(n.dropoff_date).toBe('2026-05-30');
    expect(n.multiStop).toBe(false);
  });
});
