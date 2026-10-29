import { describe, it, expect } from 'vitest';
import { summarizeLoads, excludeCancelled } from '@/lib/financialCalculations';
import {
  sumExpectedPay,
  sumOperatingMiles,
  fleetEffectiveRPM,
} from '@/lib/loadMetrics';
import { getWeekSummaries, buildLoadCsvRow } from '@/lib/loadUtils';
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

  it('Dashboard and LoadsKpiStrip share summarizeLoads → identical totals', () => {
    // Both surfaces call summarizeLoads(filteredLoads, ...). Same input → same numbers.
    const dashSum = summarizeLoads(loads, []);
    const kpiSum = summarizeLoads(loads, []);
    expect(dashSum.loadCount).toBe(kpiSum.loadCount);
    expect(dashSum.grossRevenue).toBe(kpiSum.grossRevenue);
    expect(dashSum.totalMiles).toBe(kpiSum.totalMiles);
    expect(dashSum.effectiveRPM).toBe(kpiSum.effectiveRPM);

    // And it respects the documented rules.
    expect(dashSum.loadCount).toBe(2);
    expect(dashSum.cancelledCount).toBe(1);
    expect(dashSum.totalMiles).toBe(sumOperatingMiles(excludeCancelled(loads)));
    expect(dashSum.estimatedPay).toBe(sumExpectedPay(excludeCancelled(loads)));
    // grossRevenue uses actual when present, expected otherwise
    expect(dashSum.grossRevenue).toBe(250 + 500);
    // Effective RPM = gross revenue / total operating miles
    expect(dashSum.effectiveRPM).toBeCloseTo(750 / 300, 6);
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

describe('Oversized mileage — summary, weekly and export parity', () => {
  it('uses 202.45 miles and $0.82 RPM everywhere while retaining saved pay and total', () => {
    const load = mk({ loaded_miles: 195.45, deadhead_miles: 7, total_miles: 20245, estimated_pay: 166.01 });
    const summary = summarizeLoads([load], []);
    const [week] = getWeekSummaries([load], 1);
    const row = buildLoadCsvRow(load, []);
    expect(summary.totalMiles).toBeCloseTo(202.45, 8);
    expect(summary.effectiveRPM.toFixed(2)).toBe('0.82');
    expect(week.avgRatePerMile).toBeCloseTo(summary.effectiveRPM, 8);
    expect(week.totalEstimatedPay).toBe(166.01);
    expect(row[7]).toBeCloseTo(202.45, 8);
    expect(row[11]).toBe('0.82');
    expect(row[15]).toBe('166.01');
    expect(load.total_miles).toBe(20245);
  });

  it('keeps actual payments and expenses unchanged and excludes pending/cancelled from completed summary', () => {
    const load = mk({ loaded_miles: 195.45, deadhead_miles: 7, total_miles: 20245, estimated_pay: 166.01, actual_pay_received: 150 });
    const expenses = [{ amount: 30 }] as Parameters<typeof summarizeLoads>[1];
    const summary = summarizeLoads([
      load,
      mk({ status: 'pending', total_miles: 20245, estimated_pay: 9999 }),
      mk({ status: 'cancelled', total_miles: 20245, estimated_pay: 9999 }),
    ], expenses);
    expect(summary.loadCount).toBe(1);
    expect(summary.cancelledCount).toBe(1);
    expect(summary.totalMiles).toBeCloseTo(202.45, 8);
    expect(summary.estimatedPay).toBe(166.01);
    expect(summary.actualPay).toBe(150);
    expect(summary.grossRevenue).toBe(150);
    expect(summary.expensesTotal).toBe(30);
    expect(summary.netProfit).toBe(120);
    expect(summary.effectiveRPM).toBeCloseTo(150 / 202.45, 8);
    expect(load.actual_pay_received).toBe(150);
    expect(expenses[0].amount).toBe(30);
  });

  it('zero/null mileage produces finite zero summary and weekly RPM', () => {
    const load = mk({ loaded_miles: 0, deadhead_miles: 0, total_miles: null, estimated_pay: 166.01 });
    expect(summarizeLoads([load], []).effectiveRPM).toBe(0);
    expect(getWeekSummaries([load], 1)[0].avgRatePerMile).toBe(0);
  });
});
