import { describe, it, expect } from 'vitest';
import { aggregateReport } from '@/lib/reportAggregator';
import type { Load } from '@/hooks/useLoads';
import type { Expense } from '@/hooks/useExpenses';
import type { FuelLog } from '@/hooks/useFuelLogs';

const range = { from: '2025-01-01', to: '2025-01-31', label: 'Jan 2025', key: 'jan_2025' } as const;

const baseLoad: Load = {
  id: 'L1',
  user_id: 'u',
  pickup_location: 'A',
  dropoff_location: 'B',
  load_date: '2025-01-05',
  dropoff_date: null,
  loaded_miles: 1000,
  deadhead_miles: 0,
  rate_per_mile: 2,
  estimated_pay: 2000,
  actual_pay_received: 2000,
  status: 'completed',
  payment_status: 'paid',
  pay_model: 'loaded_miles_only',
} as unknown as Load;

const fuelExpense: Expense = {
  id: 'E1',
  user_id: 'u',
  category: 'Fuel',
  amount: 500,
  expense_date: '2025-01-10',
  vendor: null,
  notes: null,
} as unknown as Expense;

const nonFuelExpense: Expense = {
  id: 'E2',
  user_id: 'u',
  category: 'Maintenance',
  amount: 200,
  expense_date: '2025-01-12',
  vendor: null,
  notes: null,
} as unknown as Expense;

const fuelLog: FuelLog = {
  id: 'F1',
  user_id: 'u',
  date: '2025-01-15',
  total_cost: 500,
  gallons: 100,
  price_per_gallon: 5,
  odometer: null,
  location: null,
  notes: null,
  load_id: null,
} as unknown as FuelLog;

function run(expenses: Expense[], fuelLogs: FuelLog[]) {
  return aggregateReport({
    loads: [baseLoad],
    expenses,
    fuelLogs,
    settings: null,
    range,
    preparedFor: 'Test',
  });
}

describe('reportAggregator — fuel double-count policy', () => {
  it('counts $500 Fuel expense when no Fuel Logs exist', () => {
    const agg = run([fuelExpense], []);
    // No logs → Fuel category is the canonical source.
    expect(agg.profit.fuelCost).toBe(0);            // fuel.totalCost comes from logs
    expect(agg.profit.expensesTotal).toBe(500);     // Fuel expense flows through expensesTotal
    expect(agg.expenseStats.fuel).toBe(500);
    expect(agg.profit.netAfterExpenses).toBe(2000 - 500);
    expect(agg.expenseStats.deductibleEstimate).toBe(500);
  });

  it('counts $500 Fuel Log when no Fuel expense exists', () => {
    const agg = run([], [fuelLog]);
    expect(agg.profit.fuelCost).toBe(500);
    expect(agg.profit.expensesTotal).toBe(0);
    expect(agg.expenseStats.fuel).toBe(500);
    expect(agg.profit.netAfterExpenses).toBe(2000 - 500);
    expect(agg.expenseStats.deductibleEstimate).toBe(500);
  });

  it('counts fuel exactly once when both Fuel Log and Fuel expense exist', () => {
    const agg = run([fuelExpense, nonFuelExpense], [fuelLog]);
    // Logs win — fuel-category expense is excluded from math.
    expect(agg.profit.fuelCost).toBe(500);
    expect(agg.profit.expensesTotal).toBe(200);          // only non-fuel expense
    expect(agg.expenseStats.fuel).toBe(500);             // logs, not 500+500
    expect(agg.profit.netAfterExpenses).toBe(2000 - 200 - 500); // = 1300, NOT 800
    expect(agg.expenseStats.deductibleEstimate).toBe(700);     // 200 + 500
    // Non-fuel expenses remain fully counted in byCategory.
    expect(agg.expenseStats.byCategory.find(c => c.category === 'Maintenance')?.total).toBe(200);
    // Fuel category is excluded from byCategory under the logs-canonical policy.
    expect(agg.expenseStats.byCategory.find(c => c.category === 'Fuel')).toBeUndefined();
  });

  it('excludes cancelled loads from revenue (regression guard)', () => {
    const cancelled = { ...baseLoad, id: 'L2', status: 'cancelled' } as unknown as Load;
    const agg = aggregateReport({
      loads: [baseLoad, cancelled],
      expenses: [],
      fuelLogs: [fuelLog],
      settings: null,
      range,
      preparedFor: 'Test',
    });
    expect(agg.cancelledLoads).toHaveLength(1);
    expect(agg.activeLoads).toHaveLength(1);
    expect(agg.profit.grossRevenue).toBe(2000);
  });
});
