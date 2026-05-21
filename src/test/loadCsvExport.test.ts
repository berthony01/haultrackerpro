import { describe, it, expect } from 'vitest';
import { buildLoadCsvRow, CSV_HEADERS_LOADS }  from '@/lib/loadUtils';
import { getLoadOperatingMiles } from '@/lib/loadMetrics';

describe('Phase 6C.5 — general load CSV total miles consistency', () => {
  const baseLoad: any = {
    id: 'l1',
    status: 'completed',
    load_date: '2025-01-15',
    pickup_location: 'Dallas, TX',
    dropoff_location: 'Houston, TX',
    loaded_miles: 994.79,
    deadhead_miles: 45,
    total_miles: 1,
    rate_per_mile: 0.82,
    wait_fee: 0,
    detention_fee: 0,
    other_fees: 0,
    estimated_pay: 852.63,
    actual_pay_received: null,
    pay_model: 'loaded_miles_only',
    notes: null,
  };

  it('corrupted total_miles=1 exports corrected operating miles', () => {
    const row = buildLoadCsvRow(baseLoad, []);
    const totalMiIndex = CSV_HEADERS_LOADS.indexOf('Total Miles');
    expect(totalMiIndex).toBe(7);
    expect(row[totalMiIndex]).toBeCloseTo(1039.79, 2);
  });

  it('header order remains unchanged', () => {
    expect(CSV_HEADERS_LOADS).toEqual([
      'Date', 'Pickup', 'Dropoff', 'Stops Summary', 'Pay Model', 'Loaded Miles',
      'Deadhead Miles', 'Total Miles', 'Rate/Mile', 'Deadhead Rate/Mile', 'Flat Rate',
      'Effective RPM', 'Wait Fee', 'Detention Fee', 'Other Fees', 'Estimated Pay',
      'Actual Pay', 'Difference', 'Status', 'Notes', 'Company Name', 'Company Start Date',
    ]);
  });

  it('effective RPM column still uses getLoadEffectiveRPM', () => {
    const row = buildLoadCsvRow(baseLoad, []);
    const effRpmIndex = CSV_HEADERS_LOADS.indexOf('Effective RPM');
    expect(effRpmIndex).toBe(11);
    expect(row[effRpmIndex]).toBe(getLoadOperatingMiles(baseLoad) > 0
      ? (852.63 / getLoadOperatingMiles(baseLoad)).toFixed(2)
      : '0.00');
  });

  it('valid stored total_miles within tolerance is preserved', () => {
    const load = { ...baseLoad, total_miles: 1040 };
    const row = buildLoadCsvRow(load, []);
    const totalMiIndex = CSV_HEADERS_LOADS.indexOf('Total Miles');
    expect(row[totalMiIndex]).toBe(1040);
  });

  it('clean load with no corruption uses stored total_miles', () => {
    const load = { ...baseLoad, loaded_miles: 500, deadhead_miles: 50, total_miles: 550, estimated_pay: 500 };
    const row = buildLoadCsvRow(load, []);
    const totalMiIndex = CSV_HEADERS_LOADS.indexOf('Total Miles');
    expect(row[totalMiIndex]).toBe(550);
  });
});
