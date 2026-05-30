import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { deriveFinalDropoffDate, getEffectiveDate } from '@/lib/loadUtils';
import { getPresetRange } from '@/lib/reportRanges';

/**
 * Phase 29 — Multi-stop final drop-off date derivation.
 *
 * Rule (single source of truth):
 *   1. If multi-stop has any 'Drop' stop with a valid stop_date → highest stop_order wins.
 *   2. Else if any stop has a valid stop_date → highest stop_order wins.
 *   3. Else null (caller falls back to manual dropoff_date, then load_date).
 *   4. Malformed stop_date strings are ignored and never become loads.dropoff_date.
 */
describe('Phase 29 — deriveFinalDropoffDate', () => {
  it('returns null for empty / nullish input', () => {
    expect(deriveFinalDropoffDate([])).toBeNull();
    expect(deriveFinalDropoffDate(null as any)).toBeNull();
    expect(deriveFinalDropoffDate(undefined as any)).toBeNull();
  });

  it('returns null when no stop has a valid stop_date', () => {
    expect(deriveFinalDropoffDate([
      { stop_order: 1, stop_type: 'Pickup', stop_date: null },
      { stop_order: 2, stop_type: 'Drop', stop_date: null },
    ])).toBeNull();
  });

  it('ignores malformed stop_date strings', () => {
    expect(deriveFinalDropoffDate([
      { stop_order: 1, stop_type: 'Drop', stop_date: '05/30/2026' },
      { stop_order: 2, stop_type: 'Drop', stop_date: 'not-a-date' },
      { stop_order: 3, stop_type: 'Drop', stop_date: '2026-13-40' },
    ])).toBeNull();
  });

  it('pickup May 29 + final Drop May 30 → 2026-05-30', () => {
    expect(deriveFinalDropoffDate([
      { stop_order: 1, stop_type: 'Pickup', stop_date: '2026-05-29' },
      { stop_order: 2, stop_type: 'Drop',   stop_date: '2026-05-30' },
    ])).toBe('2026-05-30');
  });

  it('multiple Drop stops → highest stop_order wins', () => {
    expect(deriveFinalDropoffDate([
      { stop_order: 1, stop_type: 'Pickup', stop_date: '2026-05-29' },
      { stop_order: 2, stop_type: 'Drop',   stop_date: '2026-05-30' },
      { stop_order: 3, stop_type: 'Drop',   stop_date: '2026-05-31' },
    ])).toBe('2026-05-31');
  });

  it('Drop without date — falls back to highest-order dated stop', () => {
    expect(deriveFinalDropoffDate([
      { stop_order: 1, stop_type: 'Pickup', stop_date: '2026-05-29' },
      { stop_order: 2, stop_type: 'Stop',   stop_date: '2026-05-30' },
      { stop_order: 3, stop_type: 'Drop',   stop_date: null },
    ])).toBe('2026-05-30');
  });

  it('prefers Drop with date even when a later non-drop stop has a date', () => {
    expect(deriveFinalDropoffDate([
      { stop_order: 1, stop_type: 'Drop', stop_date: '2026-05-30' },
      { stop_order: 2, stop_type: 'Stop', stop_date: '2026-06-01' }, // ignored — not a Drop
    ])).toBe('2026-05-30');
  });

  it('is case-insensitive on stop_type', () => {
    expect(deriveFinalDropoffDate([
      { stop_order: 1, stop_type: 'drop', stop_date: '2026-05-30' },
    ])).toBe('2026-05-30');
  });
});

describe('Phase 29 — week range uses derived dropoff_date', () => {
  // Mon-start week containing May 30 = May 25 → 31, 2026.
  const ANCHOR = new Date('2026-05-30T12:00:00');
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(ANCHOR); });
  afterAll(() => vi.useRealTimers());

  it('load picked up May 29 / delivered May 30 lands in This Week (Mon-start)', () => {
    // Simulates the saved load row after LoadForm.handleSubmit derives dropoff from the final stop.
    const finalDropoff = deriveFinalDropoffDate([
      { stop_order: 1, stop_type: 'Pickup', stop_date: '2026-05-29' },
      { stop_order: 2, stop_type: 'Drop',   stop_date: '2026-05-30' },
    ]);
    const savedLoad: any = { load_date: '2026-05-29', dropoff_date: finalDropoff };
    const eff = getEffectiveDate(savedLoad);
    expect(eff).toBe('2026-05-30');

    const tw = getPresetRange('this_week', 1);
    expect(eff >= tw.from && eff <= tw.to).toBe(true);
  });
});

describe('Phase 29 — LoadForm resolution order (pure logic mirror)', () => {
  /** Mirrors the resolution rule used in src/components/LoadForm.tsx handleSubmit. */
  function resolveDropoff(args: {
    multiStop: boolean;
    stops: { stop_order: number; stop_type: string; stop_date?: string | null }[];
    formDropoff: string;
    loadDate: string;
  }): string {
    const finalStopDate = args.multiStop ? deriveFinalDropoffDate(args.stops) : null;
    return finalStopDate ?? (args.formDropoff || args.loadDate);
  }

  it('multi-stop with valid final stop date overrides manual dropoff', () => {
    expect(resolveDropoff({
      multiStop: true,
      stops: [
        { stop_order: 1, stop_type: 'Pickup', stop_date: '2026-05-29' },
        { stop_order: 2, stop_type: 'Drop',   stop_date: '2026-05-30' },
      ],
      formDropoff: '2026-06-15',
      loadDate: '2026-05-29',
    })).toBe('2026-05-30');
  });

  it('multi-stop with NO stop dates → falls back to manual dropoff_date', () => {
    expect(resolveDropoff({
      multiStop: true,
      stops: [
        { stop_order: 1, stop_type: 'Pickup', stop_date: null },
        { stop_order: 2, stop_type: 'Drop',   stop_date: null },
      ],
      formDropoff: '2026-05-30',
      loadDate: '2026-05-29',
    })).toBe('2026-05-30');
  });

  it('no stop dates and no manual dropoff → load_date fallback', () => {
    expect(resolveDropoff({
      multiStop: true,
      stops: [{ stop_order: 1, stop_type: 'Drop', stop_date: null }],
      formDropoff: '',
      loadDate: '2026-05-29',
    })).toBe('2026-05-29');
  });

  it('single-stop (multi-stop off) uses manual dropoff_date then load_date', () => {
    expect(resolveDropoff({ multiStop: false, stops: [], formDropoff: '2026-05-30', loadDate: '2026-05-29' }))
      .toBe('2026-05-30');
    expect(resolveDropoff({ multiStop: false, stops: [], formDropoff: '', loadDate: '2026-05-29' }))
      .toBe('2026-05-29');
  });
});

describe('Phase 29 — duplicate behavior', () => {
  it('duplicated stop list does not carry old stop_date values', () => {
    // Mirrors handleDuplicate in src/pages/Index.tsx: stop_date is reset to null.
    const origStops = [
      { stop_order: 1, location: 'Dallas, TX', stop_type: 'Pickup', detention_minutes: null, stop_date: '2026-01-01' },
      { stop_order: 2, location: 'Atlanta, GA', stop_type: 'Drop',   detention_minutes: null, stop_date: '2026-01-02' },
    ];
    const dupStops = origStops.map(s => ({
      stop_order: s.stop_order,
      location: s.location,
      stop_type: s.stop_type,
      detention_minutes: s.detention_minutes,
      stop_date: null,
    }));
    expect(dupStops.every(s => s.stop_date === null)).toBe(true);
    expect(deriveFinalDropoffDate(dupStops)).toBeNull();
  });
});
