import { describe, it, expect } from 'vitest';
import { selectCostSource } from '@/hooks/useProfitCheck';

describe('selectCostSource', () => {
  it('uses profile CPM when profile produces a positive number', () => {
    const r = selectCostSource({ profileCpm: 1.42, profileWarnings: [], historyCpm: 1.1 });
    expect(r.cpm).toBe(1.42);
    expect(r.source).toBe('profile');
  });

  it('falls back to history when profile is zero and has no warnings', () => {
    const r = selectCostSource({ profileCpm: 0, profileWarnings: [], historyCpm: 1.1 });
    expect(r.cpm).toBe(1.1);
    expect(r.source).toBe('history');
  });

  it('preserves source=profile when profile has warnings even if history CPM exists', () => {
    // Regression: previously, a fixed-only profile with missing monthly miles
    // could be silently masked by history CPM, hiding the configuration warning.
    const r = selectCostSource({
      profileCpm: 0,
      profileWarnings: ['fixed_missing_monthly_miles'],
      historyCpm: 1.1,
    });
    expect(r.cpm).toBe(0);
    expect(r.source).toBe('profile');
  });

  it('returns none when there is no usable signal anywhere', () => {
    const r = selectCostSource({ profileCpm: 0, profileWarnings: [], historyCpm: 0 });
    expect(r.cpm).toBe(0);
    expect(r.source).toBe('none');
  });
});
