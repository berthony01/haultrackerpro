import { describe, it, expect } from 'vitest';
import {
  normalizeParsedStops,
  dedupeRouteStops,
  deriveExplicitFinalDropDate,
} from '@/lib/stopNormalization';
import { applySourceDropoffDate } from '@/lib/sourceDate';

/**
 * Phase 29C regression tests — endpoint promotion in paste/scan flows and
 * hardened legacy dedupe.
 *
 * LoadForm paste/scan handlers compute:
 *   const norm = normalizeParsedStops(data);
 *   form.pickup_location  = norm.pickup_location  ?? data.pickup_location  ?? prev
 *   form.dropoff_location = norm.dropoff_location ?? data.dropoff_location ?? prev
 *   form.dropoff_date     = applySourceDropoffDate(prev, norm.dropoff_date ?? data.dropoff_date)
 *
 * Save uses: explicit final Drop stop_date > manual dropoff_date > load_date.
 */

function applyToForm(prev: { pickup_location: string; dropoff_location: string; dropoff_date: string }, data: any) {
  const norm = normalizeParsedStops(data);
  return {
    pickup_location: norm.pickup_location ?? data.pickup_location ?? prev.pickup_location,
    dropoff_location: norm.dropoff_location ?? data.dropoff_location ?? prev.dropoff_location,
    dropoff_date: applySourceDropoffDate(prev.dropoff_date, norm.dropoff_date ?? data.dropoff_date),
    interiorStops: norm.interiorStops,
    multiStop: norm.multiStop,
  };
}

const emptyPrev = { pickup_location: '', dropoff_location: '', dropoff_date: '' };

describe('Phase 29C — paste integration: [Pickup, Stop, Drop] with final Drop stop_date', () => {
  it('promotes final Drop stop_date 2026-05-30 to form.dropoff_date', () => {
    const data = {
      load_date: '2026-05-29',
      stops: [
        { location: 'Dallas, TX', stop_type: 'Pickup', stop_date: '2026-05-29' },
        { location: 'Memphis, TN', stop_type: 'Stop' },
        { location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-30' },
      ],
    };
    const out = applyToForm(emptyPrev, data);
    expect(out.pickup_location).toBe('Dallas, TX');
    expect(out.dropoff_location).toBe('Atlanta, GA');
    expect(out.dropoff_date).toBe('2026-05-30');
    expect(out.multiStop).toBe(true);
    expect(out.interiorStops).toHaveLength(1);
    expect(out.interiorStops[0].location).toBe('Memphis, TN');
  });
});

describe('Phase 29C — two-stop paste [Pickup, Drop dated] still promotes top-level date', () => {
  it('sets dropoff_date and leaves multiStop false', () => {
    const data = {
      stops: [
        { location: 'Dallas, TX', stop_type: 'Pickup' },
        { location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-30' },
      ],
    };
    const out = applyToForm(emptyPrev, data);
    expect(out.multiStop).toBe(false);
    expect(out.interiorStops).toHaveLength(0);
    expect(out.dropoff_date).toBe('2026-05-30');
    expect(out.pickup_location).toBe('Dallas, TX');
    expect(out.dropoff_location).toBe('Atlanta, GA');
  });
});

describe('Phase 29C — scan fallback (usedAI=false / parseLoadText shape)', () => {
  it('promotes norm.dropoff_date even without top-level dropoff_date', () => {
    // parseLoadText-style payload: top-level dropoff_date undefined, stop_date on final Drop.
    const data = {
      pickup_location: 'Dallas, TX',
      dropoff_location: 'Atlanta, GA',
      load_date: '2026-05-29',
      stops: [
        { location: 'Dallas, TX', stop_type: 'Pickup' },
        { location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-30' },
      ],
    };
    const out = applyToForm(emptyPrev, data);
    expect(out.dropoff_date).toBe('2026-05-30');
  });
});

describe('Phase 29C — save integration honors promoted dropoff_date', () => {
  it('with no interior Drop stop in saved load_stops, top-level dropoff is used', () => {
    // After Phase 29B normalization, endpoints are NOT saved into load_stops.
    // So deriveExplicitFinalDropDate over saved interior stops returns null,
    // and the resolved dropoff falls back to form.dropoff_date (2026-05-30).
    const data = {
      stops: [
        { location: 'Dallas, TX', stop_type: 'Pickup', stop_date: '2026-05-29' },
        { location: 'Memphis, TN', stop_type: 'Stop' },
        { location: 'Atlanta, GA', stop_type: 'Drop', stop_date: '2026-05-30' },
      ],
    };
    const form = applyToForm(emptyPrev, data);
    const savedInteriorStops = form.interiorStops.map((s, i) => ({
      stop_order: i + 1,
      stop_type: s.stop_type ?? 'Stop',
      stop_date: (s as any).stop_date ?? null,
    }));
    const explicitFinalDrop = deriveExplicitFinalDropDate(savedInteriorStops);
    const loadDate = '2026-05-29';
    const resolvedDropoff = explicitFinalDrop ?? (form.dropoff_date || loadDate);
    expect(resolvedDropoff).toBe('2026-05-30');
  });
});

describe('Phase 29C — dedupeRouteStops preserves real same-city Stops', () => {
  it('keeps leading Stop whose location equals pickup city', () => {
    const out = dedupeRouteStops('Dallas, TX', 'Atlanta, GA', [
      { location: 'Dallas, TX', stop_type: 'Stop' },
      { location: 'Memphis, TN', stop_type: 'Stop' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].location).toBe('Dallas, TX');
  });

  it('keeps trailing Stop whose location equals dropoff city', () => {
    const out = dedupeRouteStops('Dallas, TX', 'Atlanta, GA', [
      { location: 'Memphis, TN', stop_type: 'Stop' },
      { location: 'Atlanta, GA', stop_type: 'Stop' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].location).toBe('Atlanta, GA');
  });

  it('still removes typed Pickup/Drop endpoint rows from legacy lists', () => {
    const out = dedupeRouteStops('Dallas, TX', 'Atlanta, GA', [
      { location: 'Dallas, TX', stop_type: 'Pickup' },
      { location: 'Memphis, TN', stop_type: 'Stop' },
      { location: 'Atlanta, GA', stop_type: 'Drop' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].location).toBe('Memphis, TN');
  });

  it('still removes legacy untyped endpoint rows by location match', () => {
    const out = dedupeRouteStops('Dallas, TX', 'Atlanta, GA', [
      { location: 'Dallas, TX' },
      { location: 'Memphis, TN' },
      { location: 'Atlanta, GA' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].location).toBe('Memphis, TN');
  });
});
