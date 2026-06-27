import { describe, it, expect } from 'vitest';
import { applyFuelLogPolicy, summarizeLoads } from '@/lib/financialCalculations';
import type { Load } from '@/hooks/useLoads';
import type { Expense } from '@/hooks/useExpenses';

function mkLoad(p: Partial<Load> = {}): Load {
  return {
    id: 'l1', user_id: 'u', load_date: '2026-06-01', dropoff_date: '2026-06-01',
    pickup_location: 'A, TX', dropoff_location: 'B, TX',
    loaded_miles: 500, deadhead_miles: 50, total_miles: 550,
    rate_per_mile: 2, wait_fee: 0, detention_fee: 0, other_fees: 0,
    estimated_pay: 1000, actual_pay_received: null,
    status: 'completed', notes: null, created_at: '', updated_at: '',
    pay_model: 'loaded_miles_only',
    ...p,
  } as unknown as Load;
}

function mkExp(p: Partial<Expense> = {}): Expense {
  return {
    id: 'e1', user_id: 'u', expense_date: '2026-06-01',
    category: 'Maintenance', amount: 100, gallons: null,
    linked_load_id: null, notes: null, expense_type: 'variable',
    created_at: '', updated_at: '',
    ...p,
  } as unknown as Expense;
}

describe('Phase 4 — fuel log double-count policy (Dashboard ↔ Reports parity)', () => {
  it('drops Fuel-category expense rows when fuel logs exist; combined total uses fuel logs once', () => {
    const expenses = [mkExp({ category: 'Maintenance', amount: 100 }), mkExp({ id: 'e2', category: 'Fuel', amount: 999 })];
    const fuelLogs = [{ total_cost: 300 }, { total_cost: 50 }];
    const r = applyFuelLogPolicy(expenses, fuelLogs);
    expect(r.expensesForMath.map(e => e.category)).toEqual(['Maintenance']);
    expect(r.fuelTotal).toBe(350);
    expect(r.combinedExpensesTotal).toBe(100 + 350);
  });

  it('falls back to Fuel-category expenses when no fuel logs are present', () => {
    const expenses = [mkExp({ category: 'Fuel', amount: 280 })];
    const r = applyFuelLogPolicy(expenses, []);
    expect(r.expensesForMath).toHaveLength(1);
    expect(r.fuelTotal).toBe(0);
    expect(r.combinedExpensesTotal).toBe(280);
  });

  it('Dashboard-style net profit matches Reports-style net (revenue − non-fuel − fuel logs)', () => {
    const loads = [mkLoad()];
    const expenses = [mkExp({ amount: 100 }), mkExp({ id: 'e2', category: 'Fuel', amount: 999 })];
    const fuelLogs = [{ total_cost: 200 }];
    const policy = applyFuelLogPolicy(expenses, fuelLogs);
    const summary = summarizeLoads(loads, policy.expensesForMath);
    const dashboardNet = summary.grossRevenue - policy.combinedExpensesTotal;
    // Reports formula (reportAggregator): gross − non-fuel expenses − fuel.totalCost
    const reportsNet = summary.grossRevenue - summary.expensesTotal - policy.fuelTotal;
    expect(dashboardNet).toBe(reportsNet);
    expect(dashboardNet).toBe(1000 - 100 - 200);
  });
});
