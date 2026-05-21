import { describe, it, expect } from 'vitest';
import {
  resolveDeadheadPay,
  parseLegacyDeadheadPayFromNotes,
  getResolvedDeadheadPayAmount,
} from '@/lib/deadheadPay';
import { getLoadExpectedPay, getLoadPaidMiles, getLoadPaidRPM } from '@/lib/loadMetrics';


const base = {
  loaded_miles: 100,
  deadhead_miles: 50,
  rate_per_mile: 2,
  deadhead_rate_per_mile: 0,
  pay_model: 'loaded_miles_only',
  notes: null,
  deadhead_pay_status: null,
  deadhead_pay_amount: null,
} as any;

describe('deadheadPay — structured fields (precedence #1-3)', () => {
  it('unpaid → 0, source structured', () => {
    const r = resolveDeadheadPay({ ...base, deadhead_pay_status: 'unpaid' });
    expect(r.amount).toBe(0);
    expect(r.source).toBe('structured');
    expect(r.status).toBe('unpaid');
    expect(r.warning).toBeUndefined();
  });

  it('per_mile → dhMiles × dhRate', () => {
    const r = resolveDeadheadPay({
      ...base,
      deadhead_pay_status: 'per_mile',
      deadhead_rate_per_mile: 0.9,
    });
    expect(r.amount).toBeCloseTo(50 * 0.9);
    expect(r.source).toBe('structured');
  });

  it('flat → deadhead_pay_amount', () => {
    const r = resolveDeadheadPay({
      ...base,
      deadhead_pay_status: 'flat',
      deadhead_pay_amount: 75,
    });
    expect(r.amount).toBe(75);
    expect(r.source).toBe('structured');
  });

  it('per_mile missing rate → 0 + missing_rate warning', () => {
    const r = resolveDeadheadPay({
      ...base,
      deadhead_pay_status: 'per_mile',
      deadhead_rate_per_mile: null,
    });
    expect(r.amount).toBe(0);
    expect(r.warning).toBe('missing_rate');
  });

  it('flat missing amount → 0 + missing_amount warning', () => {
    const r = resolveDeadheadPay({
      ...base,
      deadhead_pay_status: 'flat',
      deadhead_pay_amount: null,
    });
    expect(r.amount).toBe(0);
    expect(r.warning).toBe('missing_amount');
  });
});

describe('deadheadPay — legacy notes fallback', () => {
  it('[dh_pay:unpaid] → 0', () => {
    const r = resolveDeadheadPay({ ...base, notes: 'foo [dh_pay:unpaid] bar' });
    expect(r.amount).toBe(0);
    expect(r.source).toBe('legacy_notes');
  });

  it('[dh_pay:same] → dhMiles × loadedRate', () => {
    const r = resolveDeadheadPay({ ...base, notes: '[dh_pay:same]' });
    expect(r.amount).toBe(50 * 2);
    expect(r.source).toBe('legacy_notes');
  });

  it('[dh_pay:custom:0.85] → dhMiles × 0.85', () => {
    const r = resolveDeadheadPay({ ...base, notes: '[dh_pay:custom:0.85]' });
    expect(r.amount).toBeCloseTo(50 * 0.85);
    expect(r.source).toBe('legacy_notes');
  });

  it('malformed tag → source none, amount 0', () => {
    const r = resolveDeadheadPay({ ...base, notes: 'random text no tag' });
    expect(r.source).toBe('none');
    expect(r.amount).toBe(0);
  });

  it('parser returns null for missing or unrelated notes', () => {
    expect(parseLegacyDeadheadPayFromNotes(null)).toBeNull();
    expect(parseLegacyDeadheadPayFromNotes('hello')).toBeNull();
  });
});

describe('deadheadPay — conflict: structured wins over notes', () => {
  it('structured unpaid beats [dh_pay:custom:1.00]', () => {
    const r = resolveDeadheadPay({
      ...base,
      deadhead_pay_status: 'unpaid',
      notes: '[dh_pay:custom:1.00]',
    });
    expect(r.amount).toBe(0);
    expect(r.source).toBe('structured');
  });
});

describe('deadheadPay — pay_model_rate path', () => {
  it('loaded_plus_deadhead with dh rate uses pay_model_rate source', () => {
    const r = resolveDeadheadPay({
      ...base,
      pay_model: 'loaded_plus_deadhead',
      deadhead_rate_per_mile: 1,
    });
    expect(r.source).toBe('pay_model_rate');
    expect(r.amount).toBe(50);
  });
});

describe('getLoadExpectedPay — historical protection + integration', () => {
  it('uses estimated_pay when present (never recalculates)', () => {
    const load = {
      ...base,
      estimated_pay: 999,
      notes: '[dh_pay:custom:5.00]', // would otherwise add 250
    };
    expect(getLoadExpectedPay(load as any)).toBe(999);
  });

  it('null estimated_pay + legacy [dh_pay:same] adds deadhead pay on top', () => {
    // loaded_miles_only: model gross = 100 * 2 = 200; +legacy same: 50 * 2 = 100
    const load = { ...base, estimated_pay: null, notes: '[dh_pay:same]' };
    expect(getLoadExpectedPay(load as any)).toBe(300);
  });

  it('null estimated_pay + legacy [dh_pay:custom:0.85]', () => {
    const load = { ...base, estimated_pay: null, notes: '[dh_pay:custom:0.85]' };
    expect(getLoadExpectedPay(load as any)).toBeCloseTo(200 + 50 * 0.85);
  });

  it('loaded_plus_deadhead path is unchanged (no double counting)', () => {
    const load = {
      ...base,
      estimated_pay: null,
      pay_model: 'loaded_plus_deadhead',
      deadhead_rate_per_mile: 1,
    };
    // computeLoadPay already includes 100*2 + 50*1 = 250; resolver source is
    // pay_model_rate which we intentionally skip in the additive integration.
    expect(getLoadExpectedPay(load as any)).toBe(250);
  });

  it('loaded_miles_only with no deadhead signal is unchanged', () => {
    const load = { ...base, estimated_pay: null };
    expect(getLoadExpectedPay(load as any)).toBe(200);
  });

  it('structured unpaid + null estimated_pay does not add anything', () => {
    const load = { ...base, estimated_pay: null, deadhead_pay_status: 'unpaid' };
    expect(getLoadExpectedPay(load as any)).toBe(200);
  });

  it('structured per_mile adds dhMiles × dhRate', () => {
    const load = {
      ...base,
      estimated_pay: null,
      deadhead_pay_status: 'per_mile',
      deadhead_rate_per_mile: 0.9,
    };
    expect(getLoadExpectedPay(load as any)).toBeCloseTo(200 + 50 * 0.9);
  });

  it('getResolvedDeadheadPayAmount mirrors resolveDeadheadPay.amount', () => {
    const load = { ...base, deadhead_pay_status: 'flat', deadhead_pay_amount: 42 };
    expect(getResolvedDeadheadPayAmount(load as any)).toBe(42);
  });
});

describe('getLoadExpectedPay — Phase 6C.1 no double-count guard', () => {
  it('loaded_plus_deadhead + structured per_mile + null est_pay does NOT double-count', () => {
    const load = {
      ...base,
      estimated_pay: null,
      pay_model: 'loaded_plus_deadhead',
      deadhead_rate_per_mile: 1,
      deadhead_pay_status: 'per_mile',
    };
    // computeLoadPay: 100*2 + 50*1 = 250. Resolver must NOT add another 50.
    expect(getLoadExpectedPay(load as any)).toBe(250);
  });

  it('loaded_plus_deadhead + structured flat + null est_pay does NOT double-count', () => {
    const load = {
      ...base,
      estimated_pay: null,
      pay_model: 'loaded_plus_deadhead',
      deadhead_rate_per_mile: 1,
      deadhead_pay_status: 'flat',
      deadhead_pay_amount: 999,
    };
    expect(getLoadExpectedPay(load as any)).toBe(250);
  });

  it('total_miles + structured per_mile does NOT add extra deadhead pay', () => {
    const load = {
      ...base,
      estimated_pay: null,
      pay_model: 'total_miles',
      total_miles: 150,
      deadhead_pay_status: 'per_mile',
      deadhead_rate_per_mile: 0.9,
    };
    // total_miles: 150 * 2 = 300. No add-on.
    expect(getLoadExpectedPay(load as any)).toBe(300);
  });

  it('flat_rate + structured flat does NOT add extra deadhead pay', () => {
    const load = {
      ...base,
      estimated_pay: null,
      pay_model: 'flat_rate',
      flat_rate_amount: 500,
      deadhead_pay_status: 'flat',
      deadhead_pay_amount: 75,
    };
    expect(getLoadExpectedPay(load as any)).toBe(500);
  });

  it('manual + structured flat does NOT add extra deadhead pay (manual gross treated as 0 in fallback)', () => {
    const load = {
      ...base,
      estimated_pay: null,
      pay_model: 'manual',
      deadhead_pay_status: 'flat',
      deadhead_pay_amount: 75,
    };
    // computeLoadPay fallback uses manualGross: 0 → base 0; resolver skipped.
    expect(getLoadExpectedPay(load as any)).toBe(0);
  });

  it('loaded_miles_only + structured per_mile still adds deadhead pay', () => {
    const load = {
      ...base,
      estimated_pay: null,
      deadhead_pay_status: 'per_mile',
      deadhead_rate_per_mile: 0.9,
    };
    expect(getLoadExpectedPay(load as any)).toBeCloseTo(200 + 50 * 0.9);
  });

  it('loaded_miles_only + legacy notes still adds deadhead pay', () => {
    const load = { ...base, estimated_pay: null, notes: '[dh_pay:same]' };
    expect(getLoadExpectedPay(load as any)).toBe(300);
  });

  it('estimated_pay-present still authoritative regardless of structured/legacy', () => {
    const load = {
      ...base,
      estimated_pay: 777,
      pay_model: 'loaded_plus_deadhead',
      deadhead_pay_status: 'flat',
      deadhead_pay_amount: 999,
      notes: '[dh_pay:custom:5.00]',
    };
    expect(getLoadExpectedPay(load as any)).toBe(777);
  });
});

describe('getLoadPaidMiles — Phase 6C.2 companion metric consistency', () => {
  it('loaded_miles_only + structured per_mile (amount > 0) includes deadhead miles', () => {
    const load = {
      ...base,
      deadhead_pay_status: 'per_mile',
      deadhead_rate_per_mile: 1,
    };
    expect(getLoadPaidMiles(load as any)).toBe(150);
  });

  it('loaded_miles_only + structured flat (amount > 0) includes deadhead miles', () => {
    const load = {
      ...base,
      deadhead_pay_status: 'flat',
      deadhead_pay_amount: 75,
    };
    expect(getLoadPaidMiles(load as any)).toBe(150);
  });

  it('loaded_miles_only + legacy [dh_pay:same] includes deadhead miles', () => {
    const load = { ...base, notes: '[dh_pay:same]' };
    expect(getLoadPaidMiles(load as any)).toBe(150);
  });

  it('loaded_miles_only + legacy [dh_pay:custom:0.85] includes deadhead miles', () => {
    const load = { ...base, notes: '[dh_pay:custom:0.85]' };
    expect(getLoadPaidMiles(load as any)).toBe(150);
  });

  it('loaded_miles_only + structured unpaid does NOT include deadhead miles', () => {
    const load = { ...base, deadhead_pay_status: 'unpaid' };
    expect(getLoadPaidMiles(load as any)).toBe(100);
  });

  it('loaded_miles_only + per_mile missing rate does NOT include deadhead miles', () => {
    const load = {
      ...base,
      deadhead_pay_status: 'per_mile',
      deadhead_rate_per_mile: null,
    };
    expect(getLoadPaidMiles(load as any)).toBe(100);
  });

  it('loaded_miles_only + flat missing amount does NOT include deadhead miles', () => {
    const load = {
      ...base,
      deadhead_pay_status: 'flat',
      deadhead_pay_amount: null,
    };
    expect(getLoadPaidMiles(load as any)).toBe(100);
  });

  it('loaded_miles_only + malformed/no notes does NOT include deadhead miles', () => {
    const load = { ...base, notes: 'random no tag' };
    expect(getLoadPaidMiles(load as any)).toBe(100);
  });

  it('loaded_plus_deadhead remains loaded + deadhead (no change, no double count)', () => {
    const load = {
      ...base,
      pay_model: 'loaded_plus_deadhead',
      deadhead_rate_per_mile: 1,
      deadhead_pay_status: 'per_mile',
    };
    expect(getLoadPaidMiles(load as any)).toBe(150);
  });

  it('total_miles remains total miles (no extra logic)', () => {
    const load = {
      ...base,
      pay_model: 'total_miles',
      total_miles: 175,
      deadhead_pay_status: 'per_mile',
      deadhead_rate_per_mile: 1,
    };
    expect(getLoadPaidMiles(load as any)).toBe(175);
  });

  it('flat_rate remains total operating miles', () => {
    const load = {
      ...base,
      pay_model: 'flat_rate',
      flat_rate_amount: 500,
      deadhead_pay_status: 'flat',
      deadhead_pay_amount: 75,
    };
    // total = loaded(100) + dh(50) = 150
    expect(getLoadPaidMiles(load as any)).toBe(150);
  });

  it('manual remains total operating miles', () => {
    const load = {
      ...base,
      pay_model: 'manual',
      deadhead_pay_status: 'flat',
      deadhead_pay_amount: 75,
    };
    expect(getLoadPaidMiles(load as any)).toBe(150);
  });

  it('getLoadPaidRPM reflects updated paid miles for loaded_miles_only paid-deadhead row', () => {
    const load = {
      ...base,
      estimated_pay: null,
      deadhead_pay_status: 'per_mile',
      deadhead_rate_per_mile: 1,
    };
    // expected pay = 100*2 + 50*1 = 250; paid miles = 150; rpm = 1.666...
    expect(getLoadPaidRPM(load as any)).toBeCloseTo(250 / 150);
  });

  it('estimated_pay-present does not affect getLoadPaidMiles incorrectly', () => {
    const load = {
      ...base,
      estimated_pay: 777,
      deadhead_pay_status: 'per_mile',
      deadhead_rate_per_mile: 1,
    };
    // estimated_pay is authoritative for expected pay only; paid miles still
    // honors resolved deadhead pay for loaded_miles_only.
    expect(getLoadPaidMiles(load as any)).toBe(150);
  });
});
