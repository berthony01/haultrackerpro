import { describe, it, expect } from 'vitest';
import { computeLoadPay } from '@/lib/computeLoadPay';

describe('computeLoadPay — pay models', () => {
  it('loaded_miles_only: gross = loaded * rate + fees', () => {
    const r = computeLoadPay({
      payModel: 'loaded_miles_only',
      loadedMiles: 500,
      deadheadMiles: 50,
      loadedRpm: 2.5,
      fees: 25,
    });
    expect(r.expectedGrossPay).toBe(500 * 2.5 + 25);
    expect(r.paidMiles).toBe(500);
    expect(r.totalOperatingMiles).toBe(550);
    expect(r.deadheadPct).toBeCloseTo((50 / 550) * 100, 5);
    expect(r.warnings).toEqual([]);
  });

  it('loaded_miles_only with legacy DH paid at same rate adds DH revenue', () => {
    const r = computeLoadPay({
      payModel: 'loaded_miles_only',
      loadedMiles: 100,
      deadheadMiles: 25,
      loadedRpm: 2,
      legacyDhPayMode: 'same',
    });
    expect(r.expectedGrossPay).toBe(100 * 2 + 25 * 2);
    expect(r.paidMiles).toBe(125);
  });

  it('total_miles: gross = total * rate', () => {
    const r = computeLoadPay({
      payModel: 'total_miles',
      loadedMiles: 100,
      deadheadMiles: 50,
      totalMiles: 150,
      loadedRpm: 1.2,
    });
    expect(r.expectedGrossPay).toBe(150 * 1.2);
    expect(r.paidMiles).toBe(150);
    expect(r.paidRpm).toBeCloseTo(1.2, 5);
  });

  it('loaded_plus_deadhead: gross = loaded*r1 + dh*r2', () => {
    const r = computeLoadPay({
      payModel: 'loaded_plus_deadhead',
      loadedMiles: 200,
      deadheadMiles: 50,
      loadedRpm: 2.0,
      dhRpm: 1.0,
    });
    expect(r.expectedGrossPay).toBe(200 * 2 + 50 * 1);
    expect(r.paidMiles).toBe(250);
  });

  it('flat_rate: effective RPM = flat / total miles', () => {
    const r = computeLoadPay({
      payModel: 'flat_rate',
      loadedMiles: 200,
      deadheadMiles: 50,
      flatRate: 750,
    });
    expect(r.expectedGrossPay).toBe(750);
    expect(r.totalOperatingMiles).toBe(250);
    expect(r.effectiveRpm).toBeCloseTo(3, 5);
  });

  it('manual: gross = manualGross + fees', () => {
    const r = computeLoadPay({
      payModel: 'manual',
      loadedMiles: 100,
      deadheadMiles: 0,
      manualGross: 500,
      fees: 50,
    });
    expect(r.expectedGrossPay).toBe(550);
  });

  it('warns when total mismatches loaded+deadhead by >2mi', () => {
    const r = computeLoadPay({
      payModel: 'loaded_miles_only',
      loadedMiles: 100,
      deadheadMiles: 50,
      totalMiles: 200,
      loadedRpm: 2,
    });
    expect(r.warnings.some(w => /mismatch/i.test(w))).toBe(true);
  });

  it('warns when flat rate is missing', () => {
    const r = computeLoadPay({ payModel: 'flat_rate', loadedMiles: 100, deadheadMiles: 0 });
    expect(r.warnings.some(w => /flat-rate amount/i.test(w))).toBe(true);
  });

  it('handles zero miles without divide-by-zero', () => {
    const r = computeLoadPay({ payModel: 'manual', manualGross: 100 });
    expect(r.effectiveRpm).toBe(0);
    expect(r.paidRpm).toBe(0);
  });

  it('total_miles uses total when loaded+deadhead unknown', () => {
    const r = computeLoadPay({ payModel: 'total_miles', totalMiles: 300, loadedRpm: 1 });
    expect(r.expectedGrossPay).toBe(300);
    expect(r.paidMiles).toBe(300);
  });

  it('deadhead > total triggers warning', () => {
    const r = computeLoadPay({
      payModel: 'total_miles',
      totalMiles: 100,
      deadheadMiles: 150,
      loadedRpm: 1,
    });
    expect(r.warnings.some(w => /deadhead/i.test(w))).toBe(true);
  });
});

describe('computeLoadPay — Phase 6C.4 operating-mile sanity', () => {
  it('corrupted totalMiles=1 with valid components uses componentTotal', () => {
    const r = computeLoadPay({
      payModel: 'loaded_miles_only',
      loadedMiles: 994.79,
      deadheadMiles: 45,
      totalMiles: 1,
      loadedRpm: 2,
    });
    expect(r.totalOperatingMiles).toBeCloseTo(1039.79, 5);
  });

  it('total_miles model with corrupted totalMiles uses corrected miles for gross', () => {
    const r = computeLoadPay({
      payModel: 'total_miles',
      loadedMiles: 500,
      deadheadMiles: 50,
      totalMiles: 1,
      loadedRpm: 2,
    });
    expect(r.expectedGrossPay).toBe(550 * 2);
    expect(r.paidMiles).toBe(550);
  });

  it('loaded_miles_only: corrupted totalMiles → gross unchanged, effectiveRpm corrected', () => {
    const r = computeLoadPay({
      payModel: 'loaded_miles_only',
      loadedMiles: 500,
      deadheadMiles: 50,
      totalMiles: 1,
      loadedRpm: 2,
    });
    expect(r.expectedGrossPay).toBe(1000);
    expect(r.effectiveRpm).toBeCloseTo(1000 / 550, 5);
  });

  it('loaded_plus_deadhead: corrupted totalMiles → gross unchanged, effectiveRpm corrected', () => {
    const r = computeLoadPay({
      payModel: 'loaded_plus_deadhead',
      loadedMiles: 500,
      deadheadMiles: 50,
      totalMiles: 1,
      loadedRpm: 2,
      dhRpm: 1,
    });
    expect(r.expectedGrossPay).toBe(500 * 2 + 50);
    expect(r.effectiveRpm).toBeCloseTo(1050 / 550, 5);
  });

  it('flat_rate: corrupted totalMiles → flat gross, effectiveRpm corrected', () => {
    const r = computeLoadPay({
      payModel: 'flat_rate',
      loadedMiles: 500,
      deadheadMiles: 50,
      totalMiles: 1,
      flatRate: 1100,
    });
    expect(r.expectedGrossPay).toBe(1100);
    expect(r.totalOperatingMiles).toBe(550);
    expect(r.effectiveRpm).toBeCloseTo(2, 5);
  });

  it('manual: corrupted totalMiles → manual gross, effectiveRpm corrected', () => {
    const r = computeLoadPay({
      payModel: 'manual',
      loadedMiles: 500,
      deadheadMiles: 50,
      totalMiles: 1,
      manualGross: 1100,
    });
    expect(r.expectedGrossPay).toBe(1100);
    expect(r.totalOperatingMiles).toBe(550);
    expect(r.effectiveRpm).toBeCloseTo(2, 5);
  });

  it('totalMiles greater than loaded+deadhead remains trusted', () => {
    const r = computeLoadPay({
      payModel: 'total_miles',
      loadedMiles: 500,
      deadheadMiles: 50,
      totalMiles: 600,
      loadedRpm: 1,
    });
    expect(r.totalOperatingMiles).toBe(600);
    expect(r.expectedGrossPay).toBe(600);
  });

  it('totalMiles within 2mi tolerance remains trusted', () => {
    const r = computeLoadPay({
      payModel: 'total_miles',
      loadedMiles: 500,
      deadheadMiles: 50,
      totalMiles: 549,
      loadedRpm: 1,
    });
    expect(r.totalOperatingMiles).toBe(549);
  });

  it('only totalMiles exists remains trusted', () => {
    const r = computeLoadPay({
      payModel: 'total_miles',
      totalMiles: 300,
      loadedRpm: 1,
    });
    expect(r.totalOperatingMiles).toBe(300);
    expect(r.expectedGrossPay).toBe(300);
  });
});
