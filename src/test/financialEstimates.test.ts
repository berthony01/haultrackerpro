import { describe, expect, it } from 'vitest';
import { estimateFinancialScenario, type FinancialEstimateInput } from '@/lib/financialEstimates';

const base: FinancialEstimateInput = {
  miles: 1200,
  revenue: { kind: 'gross', grossPay: 3200 },
  nonFuelCostPerMile: 1.5,
  fuel: { kind: 'total', totalCost: 400 },
  otherExpenses: 100,
};
function estimate(input: FinancialEstimateInput) {
  const result = estimateFinancialScenario(input);
  if (!result.ok) throw new Error(result.errors.join(' '));
  return result.estimate;
}

describe('F2 shared what-if estimates', () => {
  it('preserves the $3200 worked example, with CPM excluding the separately added $400 fuel', () => {
    expect(estimate(base)).toEqual({
      grossRevenue: 3200, nonFuelCost: 1800, fuelCost: 400, otherExpenses: 100,
      totalExpenses: 2300, taxReserve: 0, operatingProfit: 900, afterTaxEstimate: 900,
      ratePerMile: 2.67, profitPerMile: 0.75,
    });
  });
  it('matches both calculator input scenarios for the same revenue, fuel and nonfuel costs', () => {
    const gross = estimate({ ...base, miles: 1000, revenue: { kind: 'gross', grossPay: 3000 } });
    const consumption = estimate({ ...base, miles: 1000, revenue: { kind: 'rate', ratePerMile: 3 }, fuel: { kind: 'consumption', pricePerGallon: 4, mpg: 10 } });
    expect(consumption).toEqual(gross);
  });
  it.each([undefined, null, '', 0, -1, NaN, Infinity, 'invalid'])('rejects missing/nonpositive/invalid MPG %s when fuel price is positive', mpg => {
    expect(estimateFinancialScenario({ ...base, fuel: { kind: 'consumption', pricePerGallon: 4, mpg } }).ok).toBe(false);
  });
  it('needs no MPG when fuel price is zero and never invents fuel', () => {
    expect(estimate({ ...base, fuel: { kind: 'consumption', pricePerGallon: 0, mpg: '' } }).fuelCost).toBe(0);
  });
  it.each([-1, NaN, Infinity, 'invalid'])('fails closed for invalid or negative optional costs %s', value => {
    for (const field of ['nonFuelCostPerMile', 'otherExpenses', 'taxReservePercent'] as const) {
      expect(estimateFinancialScenario({ ...base, [field]: value }).ok).toBe(false);
    }
    expect(estimateFinancialScenario({ ...base, fuel: { kind: 'total', totalCost: value } }).ok).toBe(false);
    expect(estimateFinancialScenario({ ...base, fuel: { kind: 'consumption', pricePerGallon: value, mpg: 6 } }).ok).toBe(false);
  });
  it.each([0, '', null, -1, NaN, Infinity])('requires positive finite miles and revenue %s', value => {
    expect(estimateFinancialScenario({ ...base, miles: value }).ok).toBe(false);
    expect(estimateFinancialScenario({ ...base, revenue: { kind: 'gross', grossPay: value } }).ok).toBe(false);
    expect(estimateFinancialScenario({ ...base, revenue: { kind: 'rate', ratePerMile: value } }).ok).toBe(false);
  });
  it('rounds every monetary line half-up and reconciles integer-cent sums', () => {
    const result = estimate({ miles: 1, revenue: { kind: 'gross', grossPay: '10.005' }, nonFuelCostPerMile: '1.005', fuel: { kind: 'total', totalCost: '2.005' }, otherExpenses: '0.005' });
    expect(result.grossRevenue).toBe(10.01);
    expect(result.nonFuelCost).toBe(1.01);
    expect(result.fuelCost).toBe(2.01);
    expect(result.otherExpenses).toBe(0.01);
    expect(result.totalExpenses).toBe(3.03);
    expect(result.operatingProfit).toBe(6.98);
    expect(result.afterTaxEstimate).toBe(6.98);
  });
  it('handles repeating fuel division and high precision costs without printed artifacts', () => {
    const result = estimate({ miles: 1, revenue: { kind: 'rate', ratePerMile: 2.675 }, nonFuelCostPerMile: 0.004999, fuel: { kind: 'consumption', pricePerGallon: 1, mpg: 3 }, otherExpenses: 0.335 });
    expect(result.grossRevenue).toBe(2.68);
    expect(result.nonFuelCost).toBe(0);
    expect(result.fuelCost).toBe(0.33);
    expect(result.otherExpenses).toBe(0.34);
    expect(result.totalExpenses).toBe(0.67);
    expect(result.operatingProfit.toFixed(2)).toBe('2.01');
  });
  it('keeps gross-based tax reserve separate from operating profit', () => {
    const result = estimate({ ...base, taxReservePercent: 30 });
    expect(result.taxReserve).toBe(960);
    expect(result.operatingProfit).toBe(900);
    expect(result.afterTaxEstimate).toBe(-60);
  });
  it('retains negative profit rather than inventing a zero floor', () => {
    expect(estimate({ ...base, otherExpenses: 2000 }).operatingProfit).toBe(-1000);
  });
  it('rejects finite overflow and amounts outside safe cent arithmetic', () => {
    expect(estimateFinancialScenario({ ...base, miles: 1e308, revenue: { kind: 'rate', ratePerMile: 1e308 } }).ok).toBe(false);
    expect(estimateFinancialScenario({ ...base, otherExpenses: 1e20 }).ok).toBe(false);
  });
});