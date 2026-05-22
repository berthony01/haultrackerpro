import { describe, it, expect } from 'vitest';
import { computeTaxEstimate } from '@/lib/reportTax';
import type { Load } from '@/hooks/useLoads';
import type { Expense } from '@/hooks/useExpenses';
import type { UserSettings } from '@/hooks/useUserSettings';

// Minimal settings turning on the estimator with a 0% rate so we only
// assert grossRevenue (the field this phase is changing). Zero rates keep
// totalRate <= 0 path active and skip SE/income math.
const settings = {
  tax_estimator_enabled: true,
  tax_base_type: 'gross',
  federal_tax_percent: 0,
  state_tax_percent: 0,
  include_se_tax: false,
  se_tax_percent: 0,
  buffer_percent: 0,
} as unknown as UserSettings;

const baseLoad = (over: Partial<Load>): Load =>
  ({
    id: 'x',
    user_id: 'u',
    load_date: '2026-05-01',
    pickup_location: 'A',
    dropoff_location: 'B',
    loaded_miles: 0,
    deadhead_miles: 0,
    rate_per_mile: 0,
    estimated_pay: null,
    actual_pay_received: null,
    status: 'completed',
    payment_status: 'unpaid',
    pay_model: 'loaded_miles_only',
    ...over,
  } as unknown as Load);

const expenses: Expense[] = [];

describe('reportTax grossRevenue canonical fallback', () => {
  it('1) paid load uses actual_pay_received', () => {
    const r = computeTaxEstimate(
      [baseLoad({ actual_pay_received: 1200, estimated_pay: 1000 })],
      expenses,
      settings,
    );
    expect(r.grossRevenue).toBe(1200);
  });

  it('2) unpaid load with estimated_pay present uses estimated_pay', () => {
    const r = computeTaxEstimate(
      [baseLoad({ actual_pay_received: null, estimated_pay: 900 })],
      expenses,
      settings,
    );
    expect(r.grossRevenue).toBe(900);
  });

  it('3) unpaid loaded_miles_only with null estimated_pay computes from miles*rate', () => {
    const r = computeTaxEstimate(
      [baseLoad({
        pay_model: 'loaded_miles_only',
        loaded_miles: 100,
        rate_per_mile: 2,
        estimated_pay: null,
      } as any)],
      expenses,
      settings,
    );
    expect(r.grossRevenue).toBe(200);
  });

  it('4) unpaid flat_rate load with null estimated_pay uses flat_rate_amount', () => {
    const r = computeTaxEstimate(
      [baseLoad({
        pay_model: 'flat_rate',
        flat_rate_amount: 750,
        estimated_pay: null,
      } as any)],
      expenses,
      settings,
    );
    expect(r.grossRevenue).toBe(750);
  });

  it('5) unpaid loaded_plus_deadhead does not double-count deadhead', () => {
    const r = computeTaxEstimate(
      [baseLoad({
        pay_model: 'loaded_plus_deadhead',
        loaded_miles: 100,
        deadhead_miles: 50,
        rate_per_mile: 2,
        deadhead_rate_per_mile: 1,
        estimated_pay: null,
      } as any)],
      expenses,
      settings,
    );
    // loaded 100*2 + deadhead 50*1 = 250 (no extra DH addition)
    expect(r.grossRevenue).toBe(250);
  });

  it('7) empty/invalid load fields return 0 safely (no NaN)', () => {
    const r = computeTaxEstimate(
      [baseLoad({ estimated_pay: null, actual_pay_received: null } as any)],
      expenses,
      settings,
    );
    expect(Number.isFinite(r.grossRevenue)).toBe(true);
    expect(r.grossRevenue).toBe(0);
  });
});
