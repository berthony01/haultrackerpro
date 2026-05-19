import { describe, it, expect } from 'vitest';
import { computeTaxEstimate } from '@/lib/reportTax';
import type { Load } from '@/hooks/useLoads';
import type { Expense } from '@/hooks/useExpenses';
import type { UserSettings } from '@/hooks/useUserSettings';

const load = (actual: number): Load => ({
  id: 'L', user_id: 'u',
  pickup_location: 'A', dropoff_location: 'B',
  load_date: '2025-01-05', dropoff_date: null,
  loaded_miles: 1000, deadhead_miles: 0, rate_per_mile: 2,
  estimated_pay: actual, actual_pay_received: actual,
  status: 'completed', payment_status: 'paid',
  pay_model: 'loaded_miles_only',
} as unknown as Load);

const expense = (amt: number): Expense => ({
  id: 'E', user_id: 'u', category: 'Maintenance',
  amount: amt, expense_date: '2025-01-10', vendor: null, notes: null,
} as unknown as Expense);

const baseSettings = {
  tax_estimator_enabled: true,
  federal_tax_percent: 12,
  state_tax_percent: 5,
  se_tax_percent: 15.3,
  include_se_tax: true,
  buffer_percent: 0,
  tax_base_type: 'net',
} as unknown as UserSettings;

describe('computeTaxEstimate — effectivePercent', () => {
  it('effectivePercent equals totalTax / taxBase * 100 when taxBase > 0', () => {
    const r = computeTaxEstimate([load(10000)], [expense(2000)], baseSettings);
    const taxBase = r.netProfit; // base = net
    expect(taxBase).toBeGreaterThan(0);
    expect(r.effectivePercent).toBeCloseTo((r.totalTax / taxBase) * 100, 6);
  });

  it('effectivePercent is lower than nominal totalPercent for a normal SE case', () => {
    const r = computeTaxEstimate([load(10000)], [expense(2000)], baseSettings);
    expect(r.effectivePercent).toBeLessThan(r.totalPercent);
    expect(r.totalPercent).toBeCloseTo(12 + 5 + 15.3, 6);
  });

  it('effectivePercent is 0 when taxBase <= 0', () => {
    const r = computeTaxEstimate([load(1000)], [expense(5000)], baseSettings);
    expect(r.netProfit).toBeLessThan(0);
    expect(r.effectivePercent).toBe(0);
  });
});
