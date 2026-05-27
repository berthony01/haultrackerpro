import { describe, it, expect } from 'vitest';
import { summarizeLoads, excludeCancelled } from '@/lib/financialCalculations';
import {
  sumExpectedPay,
  sumOperatingMiles,
  fleetEffectiveRPM,
} from '@/lib/loadMetrics';
import { getWeekSummaries } from '@/lib/loadUtils';
import { computeAlerts } from '@/hooks/useSmartAlerts';
import type { Load } from '@/hooks/useLoads';

function mk(overrides: Partial<Load>): Load {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: 'u',
    load_date: '2026-05-25',
    dropoff_date: null,
    pickup_location: 'A, TX',
    dropoff_location: 'B, TX',
    loaded_miles: 100,
    deadhead_miles: 0,
    total_miles: 100,
    rate_per_mile: 2,
    wait_fee: 0,
    detention_fee: 0,
    other_fees: 0,
    estimated_pay: 200,
    actual_pay_received: null,
    status: 'completed',
    notes: null,
    created_at: '',
    updated_at: '',
    pay_model: 'loaded_miles_only',
    ...overrides,
  } as unknown as Load;
}

describe('Phase 23 — dashboard ↔ loads KPI parity (same filtered set, same numbers)', () => {
  const loads = [
    mk({ id: 'a', loaded_miles: 100, rate_per_mile: 2, estimated_pay: 200, actual_pay_received: 250 as any }),
    mk({ id: 'b', loaded_miles: 200, rate_per_mile: 2.5, estimated_pay: 500 }),
    mk({ id: 'c', status: 'cancelled' as any, loaded_miles: 999, estimated_pay: 9999 }),
  ];

  it('summarizeLoads matches direct sum/fleet helpers on excludeCancelled(loads)', () => {
    const sum = summarizeLoads(loads, []);
    const active = excludeCancelled(loads);

    // Dashboard summary fields
    expect(sum.loadCount).toBe(2);
    expect(sum.cancelledCount).toBe(1);

    // KPI-strip-style direct math on the same active set
    expect(sum.totalMiles).toBe(sumOperatingMiles(active));
    expect(sum.estimatedPay).toBe(sumExpectedPay(active));
    expect(sum.effectiveRPM).toBeCloseTo(fleetEffectiveRPM(active), 6);

    // grossRevenue uses actual when present, expected otherwise
    expect(sum.grossRevenue).toBe(250 + 500);
  });
});

describe('Phase 23A.4 — getWeekSummaries excludes cancelled loads', () => {
  const loads = [
    mk({ id: 'a', loaded_miles: 100, rate_per_mile: 2, estimated_pay: 200 }),
    mk({ id: 'b', status: 'cancelled' as any, loaded_miles: 500, estimated_pay: 5000 }),
  ];
  it('cancelled load does not inflate weekly totals', () => {
    const [week] = getWeekSummaries(loads, 1);
    expect(week.totalLoads).toBe(1);
    expect(week.totalLoadedMiles).toBe(100);
    expect(week.totalEstimatedPay).toBe(200);
  });
});

describe('Phase 23A.5 — Smart Alerts exclude cancelled loads', () => {
  it('negative-profit alert ignores cancelled load expenses-vs-revenue', () => {
    // All loads dated in this current week so they fall in range
    const today = new Date().toISOString().slice(0, 10);
    const loads = [
      mk({ id: 'a', load_date: today, dropoff_date: today, loaded_miles: 100, rate_per_mile: 2, estimated_pay: 200 }),
      mk({ id: 'cancel', status: 'cancelled' as any, load_date: today, dropoff_date: today, loaded_miles: 100, rate_per_mile: 10, estimated_pay: 1000 }),
    ];
    // No expenses → no negative-profit alert should fire.
    const alerts = computeAlerts(loads, [], 1);
    expect(alerts.find(a => a.type === 'negative_profit')).toBeUndefined();
  });
});
