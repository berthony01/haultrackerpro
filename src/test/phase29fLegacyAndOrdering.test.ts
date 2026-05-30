import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  normalizeLegacyEditStops,
  normalizeEditorStopsForUi,
  normalizeEditorStopsForSave,
  deriveTrailingDropDate,
} from '@/lib/stopNormalization';
import { parseLoadText } from '@/lib/parseLoadText';

const base = {
  pickup_location: 'Dallas, TX',
  dropoff_location: 'Atlanta, GA',
  load_date: '',
  dropoff_date: '',
};

describe('Phase 29F — normalizeLegacyEditStops untyped endpoint handling', () => {
  it('strips a typed Pickup row matching pickup location (regression)', () => {
    const out = normalizeLegacyEditStops({
      ...base,
      stops: [
        { stop_order: 1, location: 'Dallas, TX', stop_type: 'Pickup', stop_date: '2026-05-29' },
        { stop_order: 2, location: 'Memphis, TN', stop_type: 'Stop', stop_date: null },
      ],
    });
    expect(out.editorStops).toHaveLength(1);
    expect(out.editorStops[0].location).toBe('Memphis, TN');
    expect(out.load_date).toBe('2026-05-29');
    expect(out.hasConflict).toBe(false);
  });

  it('strips an untyped leading row whose location matches pickup', () => {
    const out = normalizeLegacyEditStops({
      ...base,
      stops: [
        { stop_order: 1, location: 'Dallas, TX', stop_type: '', stop_date: '2026-05-29' },
        { stop_order: 2, location: 'Memphis, TN', stop_type: 'Stop', stop_date: null },
      ],
    });
    expect(out.editorStops).toHaveLength(1);
    expect(out.editorStops[0].location).toBe('Memphis, TN');
    expect(out.load_date).toBe('2026-05-29');
    expect(out.hasConflict).toBe(false);
  });

  it('strips an untyped trailing row whose location matches dropoff', () => {
    const out = normalizeLegacyEditStops({
      ...base,
      stops: [
        { stop_order: 1, location: 'Memphis, TN', stop_type: 'Stop', stop_date: null },
        { stop_order: 2, location: 'Atlanta, GA', stop_type: '', stop_date: '2026-05-30' },
      ],
    });
    expect(out.editorStops).toHaveLength(1);
    expect(out.editorStops[0].location).toBe('Memphis, TN');
    expect(out.dropoff_date).toBe('2026-05-30');
    expect(out.hasConflict).toBe(false);
  });

  it('preserves and flags an untyped trailing row that conflicts with dropoff', () => {
    const out = normalizeLegacyEditStops({
      ...base,
      stops: [
        { stop_order: 1, location: 'Memphis, TN', stop_type: 'Stop', stop_date: null },
        { stop_order: 2, location: 'Nashville, TN', stop_type: '', stop_date: null },
      ],
    });
    expect(out.editorStops).toHaveLength(2);
    expect(out.editorStops[1].stop_type).toBe('Stop');
  });

  it('flags a typed Drop row conflict with dropoff_location', () => {
    const out = normalizeLegacyEditStops({
      ...base,
      stops: [
        { stop_order: 1, location: 'Houston, TX', stop_type: 'Drop', stop_date: '2026-05-30' },
      ],
    });
    expect(out.hasConflict).toBe(true);
    expect(out.editorStops).toHaveLength(1);
  });

  it('normalizes any remaining blank/invalid stop_type to Stop', () => {
    const out = normalizeLegacyEditStops({
      ...base,
      stops: [
        { stop_order: 1, location: 'Memphis, TN', stop_type: '', stop_date: null },
        { stop_order: 2, location: 'Nashville, TN', stop_type: 'WeirdValue', stop_date: null },
      ],
    });
    out.editorStops.forEach(s => expect(['Pickup', 'Drop', 'Stop']).toContain(s.stop_type));
  });
});

describe('Phase 29F — normalizeEditorStopsForUi renumbering', () => {
  it('renumbers stop_order sequentially after add/remove/edit sequence', () => {
    let stops = [
      { stop_order: 1, location: 'A', stop_type: 'Stop', stop_date: null, detention_minutes: null },
      { stop_order: 2, location: 'B', stop_type: 'Stop', stop_date: null, detention_minutes: null },
      { stop_order: 3, location: 'C', stop_type: 'Stop', stop_date: null, detention_minutes: null },
    ];
    stops = normalizeEditorStopsForUi(stops.filter((_, i) => i !== 1));
    expect(stops.map(s => s.stop_order)).toEqual([1, 2]);
    stops = normalizeEditorStopsForUi([
      ...stops,
      { stop_order: 999, location: 'D', stop_type: 'Stop', stop_date: null, detention_minutes: null },
    ]);
    expect(stops.map(s => s.stop_order)).toEqual([1, 2, 3]);
    stops = normalizeEditorStopsForUi(stops.map((s, i) => i === 1 ? { ...s, location: 'B2' } : s));
    expect(stops.map(s => s.stop_order)).toEqual([1, 2, 3]);
    expect(stops[1].location).toBe('B2');
  });

  it('handles empty / nullish input', () => {
    expect(normalizeEditorStopsForUi([])).toEqual([]);
    expect(normalizeEditorStopsForUi(null as any)).toEqual([]);
    expect(normalizeEditorStopsForUi(undefined as any)).toEqual([]);
  });
});

describe('Phase 29F — deriveTrailingDropDate deterministic tie-break', () => {
  it('breaks stop_order ties by later array position', () => {
    const stops = [
      { stop_order: 2, stop_type: 'Stop', stop_date: '2026-05-29', location: 'A' },
      { stop_order: 2, stop_type: 'Drop', stop_date: '2026-05-30', location: 'B' },
    ];
    expect(deriveTrailingDropDate(stops)).toBe('2026-05-30');
  });

  it('inline-note helper and save-path output stay aligned after UI renumbering', () => {
    const raw = [
      { stop_order: 99, location: 'Memphis, TN', stop_type: 'Stop', stop_date: '2026-05-29', detention_minutes: null },
      { stop_order: 1, location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-30', detention_minutes: null },
    ];
    const renumbered = normalizeEditorStopsForUi(raw);
    const noteDate = deriveTrailingDropDate(renumbered);
    const saved = normalizeEditorStopsForSave({
      pickup_location: 'Dallas, TX',
      dropoff_location: 'Atlanta, GA',
      load_date: '2026-05-29',
      dropoff_date: '',
      stops: renumbered,
    });
    expect(noteDate).toBe('2026-05-30');
    expect(saved.dropoff_date).toBe('2026-05-30');
    expect(saved.interiorStops).toHaveLength(1);
  });
});

describe('Phase 29F — parser stop_date strictness', () => {
  const ANCHOR = new Date('2026-05-20T12:00:00Z');
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(ANCHOR); });
  afterAll(() => vi.useRealTimers());

  it('does not absorb an unrelated date elsewhere in the stop block', () => {
    const sample = `1#: AAA\nDallas, TX 75001\nNotes: was originally booked 06/15/2026 but rescheduled\n—————————————\n2#: BBB\nDrop\n2026-05-30\nAtlanta, GA 30301`;
    const r = parseLoadText(sample);
    expect(r.stops?.[0].stop_date).toBeUndefined();
    expect(r.stops?.[1].stop_date).toBe('2026-05-30');
  });

  it('still populates a clean bare-date line', () => {
    const sample = `1#: AAA\nPickup\n2026-05-29\nDallas, TX 75001\n—————————————\n2#: BBB\nDrop\n2026-05-30\nAtlanta, GA 30301`;
    const r = parseLoadText(sample);
    expect(r.stops?.[0].stop_date).toBe('2026-05-29');
    expect(r.stops?.[1].stop_date).toBe('2026-05-30');
  });

  it('leaves stop_date undefined when multiple ambiguous dates appear', () => {
    const sample = `1#: AAA\nPickup\n2026-05-29\nAppt: 2026-05-30\nDallas, TX 75001\n—————————————\n2#: BBB\nDrop\n2026-05-31\nAtlanta, GA 30301`;
    const r = parseLoadText(sample);
    expect(r.stops?.[0].stop_date).toBeUndefined();
    expect(r.stops?.[1].stop_date).toBe('2026-05-31');
  });
});
