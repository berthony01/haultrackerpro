import { describe, it, expect } from 'vitest';
import { computeCostProfileCPM, type CostProfile } from '@/hooks/useCostProfile';

const base: CostProfile = {
  id: 'x',
  user_id: 'u',
  truck_payment: 1800,
  trailer_payment: 200,
  insurance_monthly: 600,
  permits_licensing_monthly: 100,
  eld_software_monthly: 80,
  other_fixed_monthly: 0,
  avg_mpg: null,
  diesel_price_per_gallon: null,
  maintenance_per_mile: null,
  tires_per_mile: null,
  tolls_per_mile: null,
  meals_per_day: null,
  lodging_per_day: null,
  min_margin_pct: null,
  min_rpm: null,
  days_per_1000_miles: null,
  estimated_monthly_miles: 10000,
  created_at: '',
  updated_at: '',
};

describe('computeCostProfileCPM', () => {
  it('spreads fixed monthly costs across estimated monthly miles', () => {
    const { cpm, breakdown, warnings } = computeCostProfileCPM(base, 500);
    // 1800 + 200 + 600 + 100 + 80 = 2780 / 10000 = 0.278
    expect(cpm).toBeCloseTo(0.278, 3);
    expect(breakdown.truck).toBeCloseTo(0.18, 3);
    expect(breakdown.trailer).toBeCloseTo(0.02, 3);
    expect(breakdown.insurance).toBeCloseTo(0.06, 3);
    expect(warnings).toHaveLength(0);
  });

  it('emits a warning and drops fixed share when monthly miles is missing', () => {
    const { cpm, breakdown, warnings } = computeCostProfileCPM(
      { ...base, estimated_monthly_miles: 0 },
      500,
    );
    expect(cpm).toBe(0);
    expect(breakdown.truck).toBeUndefined();
    expect(warnings).toContain('fixed_missing_monthly_miles');
  });

  it('itemized buckets sum to total CPM', () => {
    const { cpm, breakdown } = computeCostProfileCPM(
      { ...base, avg_mpg: 6, diesel_price_per_gallon: 3.6, maintenance_per_mile: 0.1 },
      500,
    );
    const sum = Object.values(breakdown).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(cpm, 6);
  });
});
