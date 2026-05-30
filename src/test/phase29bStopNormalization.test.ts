import { describe, it, expect } from 'vitest';
import {
  normalizeParsedStops,
  dedupeRouteStops,
  deriveExplicitFinalDropDate,
} from '@/lib/stopNormalization';

describe('Phase 29B — normalizeParsedStops', () => {
  it('full route [Pickup, Stop, Drop] → endpoints + 1 interior stop', () => {
    const n = normalizeParsedStops({
      stops: [
        { location: 'Dallas, TX', stop_type: 'Pickup' },
        { location: 'Memphis, TN', stop_type: 'Stop' },
        { location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-30' },
      ],
    });
    expect(n.pickup_location).toBe('Dallas, TX');
    expect(n.dropoff_location).toBe('Atlanta, GA');
    expect(n.dropoff_date).toBe('2026-05-30');
    expect(n.interiorStops).toHaveLength(1);
    expect(n.interiorStops[0].location).toBe('Memphis, TN');
    expect(n.multiStop).toBe(true);
  });

  it('two-stop [Pickup, Drop] → no interior stops, multiStop=false', () => {
    const n = normalizeParsedStops({
      stops: [
        { location: 'Dallas, TX', stop_type: 'Pickup', stop_date: '2026-05-29' },
        { location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-30' },
      ],
    });
    expect(n.multiStop).toBe(false);
    expect(n.interiorStops).toEqual([]);
    expect(n.pickup_location).toBe('Dallas, TX');
    expect(n.dropoff_location).toBe('Atlanta, GA');
    expect(n.dropoff_date).toBe('2026-05-30');
  });

  it('empty stops returns no multiStop', () => {
    expect(normalizeParsedStops({}).multiStop).toBe(false);
  });
});

describe('Phase 29B — dedupeRouteStops (legacy data)', () => {
  it('strips leading row matching pickup and trailing row matching dropoff', () => {
    const out = dedupeRouteStops('Dallas, TX', 'Atlanta, GA', [
      { location: 'Dallas, TX', stop_type: 'Pickup' },
      { location: 'Memphis, TN', stop_type: 'Stop' },
      { location: 'Atlanta, GA', stop_type: 'Drop' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].location).toBe('Memphis, TN');
  });

  it('keeps interior-only list intact', () => {
    const out = dedupeRouteStops('Dallas, TX', 'Atlanta, GA', [
      { location: 'Memphis, TN', stop_type: 'Stop' },
    ]);
    expect(out).toHaveLength(1);
  });
});

describe('Phase 29B — deriveExplicitFinalDropDate', () => {
  it('returns date only for explicit Drop stop with valid date', () => {
    expect(deriveExplicitFinalDropDate([
      { stop_order: 1, stop_type: 'Stop', stop_date: '2026-05-30' },
    ])).toBeNull();
    expect(deriveExplicitFinalDropDate([
      { stop_order: 1, stop_type: 'Drop', stop_date: '2026-05-30' },
    ])).toBe('2026-05-30');
  });

  it('intermediate Stop date alone does NOT override manual dropoff', () => {
    // Mirrors LoadForm save rule: explicit final Drop date > manual dropoff > load_date
    const stops = [
      { stop_order: 1, stop_type: 'Pickup', stop_date: '2026-05-29' },
      { stop_order: 2, stop_type: 'Stop', stop_date: '2026-06-15' },
    ];
    const explicit = deriveExplicitFinalDropDate(stops);
    const manualDropoff = '2026-05-30';
    const loadDate = '2026-05-29';
    const resolved = explicit ?? (manualDropoff || loadDate);
    expect(resolved).toBe('2026-05-30');
  });

  it('picks highest stop_order Drop with valid date', () => {
    expect(deriveExplicitFinalDropDate([
      { stop_order: 1, stop_type: 'Drop', stop_date: '2026-05-30' },
      { stop_order: 2, stop_type: 'Drop', stop_date: '2026-05-31' },
    ])).toBe('2026-05-31');
  });
});
