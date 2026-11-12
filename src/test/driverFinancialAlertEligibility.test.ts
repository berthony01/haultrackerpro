import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { computeAlerts } from '@/hooks/useSmartAlerts';
import { onlyFinanciallyCompleted } from '@/lib/financialCalculations';
import type { Load } from '@/hooks/useLoads';
import type { Expense } from '@/hooks/useExpenses';

const ANCHOR = new Date('2026-11-12T12:00:00Z');
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(ANCHOR);
});
afterAll(() => vi.useRealTimers());

function load(status: string | null, daysAgo: number, actualPay: number | null = null): Load {
  const date = new Date(ANCHOR.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);
  return {
    id: `fixture-${status}-${daysAgo}`,
    user_id: 'synthetic',
    load_date: date,
    dropoff_date: date,
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
    actual_pay_received: actualPay,
    status,
    notes: null,
    created_at: '',
    updated_at: '',
    pay_model: 'loaded_miles_only',
  } as unknown as Load;
}
const hasMissingPay = (ls: Load[]) => computeAlerts(ls, []).find(a => a.type === 'missing_pay');

describe('Driver financial smart alerts use completed-load eligibility', () => {
  it('never reports pending, en_route or cancelled loads as missing actual payment', () => {
    const loads = [
      load('pending', 20),
      load('en_route', 18),
      load('cancelled', 16),
    ];
    expect(onlyFinanciallyCompleted(loads)).toHaveLength(0);
    expect(hasMissingPay(loads)).toBeUndefined();
  });

  it('reports genuinely completed, old loads with no recorded actual payment', () => {
    const alert = hasMissingPay([load('completed', 18)]);
    expect(alert?.message).toContain('1 load');
    expect(alert?.type).toBe('missing_pay');
  });

  it('treats a legacy null-status load as completed consistently with financial KPIs', () => {
    const loads = [load(null, 18)];
    expect(onlyFinanciallyCompleted(loads)).toHaveLength(1);
    expect(hasMissingPay(loads)).toBeDefined();
  });

  it('ignores a completed load with a saved actual payment', () => {
    expect(hasMissingPay([load('completed', 18, 200)])).toBeUndefined();
  });

  it('does not flag an otherwise eligible load in the first seven days', () => {
    expect(hasMissingPay([load('completed', 5)])).toBeUndefined();
  });

  it('counts only completed overdue loads among mixed operational statuses', () => {
    const alert = hasMissingPay([
      load('pending', 30),
      load('cancelled', 30),
      load('en_route', 30),
      load('completed', 30),
      load('completed', 20),
    ]);
    expect(alert?.message).toContain('2 loads');
    expect(alert?.dedupeKey).toBe('missing_pay_count_2');
  });

  it('does not generate negative profit or mileage alerts for unfinished loads', () => {
    const expenses = [{ expense_date: '2026-11-11', amount: 350 }] as Expense[];
    const alertTypes = computeAlerts([load('pending', 1), load('en_route', 1)], expenses).map(a => a.type);
    expect(alertTypes).not.toContain('negative_profit');
    expect(alertTypes).not.toContain('high_deadhead');
    expect(alertTypes).not.toContain('high_expense_ratio');
    expect(alertTypes).not.toContain('low_rpm');
  });

  it('still generates a real negative-profit alert for a completed current-week load', () => {
    const expenses = [{ expense_date: '2026-11-11', amount: 350 }] as Expense[];
    const alerts = computeAlerts([load('completed', 1)], expenses);
    expect(alerts.some(a => a.type === 'negative_profit')).toBe(true);
  });
});
