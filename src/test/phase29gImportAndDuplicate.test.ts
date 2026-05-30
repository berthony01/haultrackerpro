import { describe, it, expect } from 'vitest';
import {
  resolveImportedLoadDate,
  resolveImportedDropoffDate,
} from '@/lib/sourceDate';
import {
  normalizeParsedStops,
  normalizeLegacyEditStops,
} from '@/lib/stopNormalization';

const NOW = new Date('2026-05-21T12:00:00');
const TODAY_ISO = '2026-05-21';

describe('Phase 29G — Import date carryover (paste/scan)', () => {
  describe('resolveImportedLoadDate', () => {
    it('applies valid in-window incoming date', () => {
      const r = resolveImportedLoadDate('2024-01-01', '2026-05-15', false, NOW);
      expect(r).toEqual({ value: '2026-05-15', kept: 'imported' });
    });
    it('when no incoming and not touched → resets to today (no stale carryover)', () => {
      const r = resolveImportedLoadDate('2024-02-02', undefined, false, NOW);
      expect(r).toEqual({ value: TODAY_ISO, kept: 'reset' });
    });
    it('when no incoming but user touched → preserves manual value', () => {
      const r = resolveImportedLoadDate('2026-05-10', null, true, NOW);
      expect(r).toEqual({ value: '2026-05-10', kept: 'manual' });
    });
    it('rejects out-of-window date and falls back', () => {
      const r = resolveImportedLoadDate('2026-05-10', '2020-01-01', false, NOW);
      expect(r.kept).toBe('reset');
    });
    it('rejects invalid ISO and falls back to manual when touched', () => {
      const r = resolveImportedLoadDate('2026-05-10', 'garbage', true, NOW);
      expect(r).toEqual({ value: '2026-05-10', kept: 'manual' });
    });
  });

  describe('resolveImportedDropoffDate', () => {
    it('applies valid in-window incoming dropoff', () => {
      const r = resolveImportedDropoffDate('', '2026-05-22', false, NOW);
      expect(r).toEqual({ value: '2026-05-22', kept: 'imported' });
    });
    it('no incoming + not touched → CLEARS to blank (no stale dropoff carryover)', () => {
      const r = resolveImportedDropoffDate('2024-12-31', undefined, false, NOW);
      expect(r).toEqual({ value: '', kept: 'reset' });
    });
    it('no incoming + touched → preserves manual dropoff', () => {
      const r = resolveImportedDropoffDate('2026-05-22', null, true, NOW);
      expect(r).toEqual({ value: '2026-05-22', kept: 'manual' });
    });
    it('invalid incoming + touched → keeps manual, signals manual', () => {
      const r = resolveImportedDropoffDate('2026-05-22', '', true, NOW);
      expect(r).toEqual({ value: '2026-05-22', kept: 'manual' });
    });
  });
});

describe('Phase 29G — Interior endpoint coercion in normalizeParsedStops', () => {
  it('coerces stray interior Pickup/Drop types to Stop after promotion', () => {
    const norm = normalizeParsedStops({
      stops: [
        { stop_order: 1, location: 'Dallas, TX', stop_type: 'Pickup', stop_date: '2026-05-10' } as any,
        { stop_order: 2, location: 'Memphis, TN', stop_type: 'Drop', stop_date: '2026-05-11' } as any,
        { stop_order: 3, location: 'Nashville, TN', stop_type: 'Pickup', stop_date: '2026-05-12' } as any,
        { stop_order: 4, location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-13' } as any,
      ],
    } as any);
    expect(norm.pickup_location).toBe('Dallas, TX');
    expect(norm.dropoff_location).toBe('Atlanta, GA');
    expect(norm.dropoff_date).toBe('2026-05-13');
    expect(norm.interiorStops).toHaveLength(2);
    for (const s of norm.interiorStops) {
      expect(s.stop_type).toBe('Stop');
    }
  });

  it('keeps final dropoff_date from final endpoint stop_date when interior rows are coerced', () => {
    const norm = normalizeParsedStops({
      stops: [
        { stop_order: 1, location: 'A', stop_type: 'Pickup', stop_date: '2026-05-10' } as any,
        { stop_order: 2, location: 'B', stop_type: 'Stop', stop_date: '2026-05-11' } as any,
        { stop_order: 3, location: 'C', stop_type: 'Drop', stop_date: '2026-05-13' } as any,
      ],
    } as any);
    expect(norm.dropoff_date).toBe('2026-05-13');
    expect(norm.interiorStops).toHaveLength(1);
    expect(norm.interiorStops[0].stop_type).toBe('Stop');
  });
});

describe('Phase 29G — Duplicate flow normalizes legacy stops', () => {
  it('strips legacy Pickup/Drop endpoint rows matching top-level fields', () => {
    const today = '2026-05-21';
    const norm = normalizeLegacyEditStops({
      pickup_location: 'Dallas, TX',
      dropoff_location: 'Atlanta, GA',
      load_date: today,
      dropoff_date: today,
      stops: [
        { stop_order: 1, location: 'Dallas, TX', stop_type: 'Pickup', detention_minutes: null, stop_date: null },
        { stop_order: 2, location: 'Memphis, TN', stop_type: 'Stop', detention_minutes: null, stop_date: null },
        { stop_order: 3, location: 'Atlanta, GA', stop_type: 'Drop', detention_minutes: null, stop_date: null },
      ],
    });
    expect(norm.editorStops).toHaveLength(1);
    expect(norm.editorStops[0].location).toBe('Memphis, TN');
    expect(norm.editorStops[0].stop_date).toBeNull();
  });

  it('coerces blank/invalid stop_type rows to Stop and keeps stop_date cleared', () => {
    const today = '2026-05-21';
    const norm = normalizeLegacyEditStops({
      pickup_location: 'Dallas, TX',
      dropoff_location: 'Atlanta, GA',
      load_date: today,
      dropoff_date: today,
      stops: [
        { stop_order: 1, location: 'Memphis, TN', stop_type: '', detention_minutes: null, stop_date: null },
        { stop_order: 2, location: 'Birmingham, AL', stop_type: 'weird', detention_minutes: null, stop_date: null },
      ],
    });
    for (const s of norm.editorStops) {
      expect(s.stop_type).toBe('Stop');
      expect(s.stop_date).toBeNull();
    }
  });

  it('preserves valid interior stops without reintroducing endpoints', () => {
    const today = '2026-05-21';
    const norm = normalizeLegacyEditStops({
      pickup_location: 'Dallas, TX',
      dropoff_location: 'Atlanta, GA',
      load_date: today,
      dropoff_date: today,
      stops: [
        { stop_order: 1, location: 'Memphis, TN', stop_type: 'Stop', detention_minutes: null, stop_date: null },
        { stop_order: 2, location: 'Birmingham, AL', stop_type: 'Stop', detention_minutes: null, stop_date: null },
      ],
    });
    expect(norm.editorStops.map(s => s.location)).toEqual(['Memphis, TN', 'Birmingham, AL']);
    expect(norm.hasConflict).toBe(false);
  });
});
