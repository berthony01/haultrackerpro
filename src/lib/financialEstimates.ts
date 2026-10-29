/** What-if scenarios only; recorded financial reports use financialCalculations.
 * Decimal inputs are calculated as fractions. Each monetary line is rounded to
 * cents half-up (ties away from zero), then totals are summed in integer cents.
 * Tax reserve is gross × the entered percentage, NOT an actual tax calculation.
 * Per-mile cost always EXCLUDES the separately supplied fuel cost.
 */
export type EstimateInput = number | string | null | undefined;
export interface FinancialEstimateInput {
  miles: EstimateInput;
  revenue: { kind: 'rate'; ratePerMile: EstimateInput } | { kind: 'gross'; grossPay: EstimateInput };
  nonFuelCostPerMile?: EstimateInput;
  fuel: { kind: 'consumption'; pricePerGallon: EstimateInput; mpg: EstimateInput } | { kind: 'total'; totalCost: EstimateInput };
  otherExpenses?: EstimateInput;
  taxReservePercent?: EstimateInput;
}
export interface FinancialEstimate {
  grossRevenue: number;
  nonFuelCost: number;
  fuelCost: number;
  otherExpenses: number;
  totalExpenses: number;
  taxReserve: number;
  operatingProfit: number;
  afterTaxEstimate: number;
  /** Gross ÷ miles, 4 decimals (half away from zero) from reconciled cents. */
  ratePerMile: number;
  /** Operating profit (before tax reserve) ÷ miles, 4 decimals. */
  operatingProfitPerMile: number;
  /** After-tax estimate ÷ miles, 4 decimals. */
  profitPerMile: number;
}
export type FinancialEstimateResult =
  | { ok: true; estimate: FinancialEstimate }
  | { ok: false; errors: string[] };

type Fraction = { n: bigint; d: bigint };
const zero = BigInt(0);
const one = BigInt(1);
const hundred = BigInt(100);
const maxCents = BigInt(Number.MAX_SAFE_INTEGER);
function fraction(value: number): Fraction {
  const [mantissa, exponent = '0'] = String(value).split('e');
  const [whole, decimals = ''] = mantissa.split('.');
  const scale = decimals.length - Number(exponent);
  const n = BigInt(whole + decimals);
  return scale >= 0
    ? { n, d: BigInt(10) ** BigInt(scale) }
    : { n: n * BigInt(10) ** BigInt(-scale), d: one };
}
const multiply = (a: Fraction, b: Fraction): Fraction => ({ n: a.n * b.n, d: a.d * b.d });
const divide = (a: Fraction, b: Fraction): Fraction => ({ n: a.n * b.d, d: a.d * b.n });
function cents(a: Fraction): bigint {
  return roundTo(a, hundred);
}
const tenThousand = BigInt(10000);
function roundTo(a: Fraction, factor: bigint): bigint {
  const scaled = a.n * factor;
  const sign = scaled < zero ? -one : one;
  const absolute = scaled * sign;
  return sign * ((absolute * BigInt(2) + a.d) / (a.d * BigInt(2)));
}

export function estimateFinancialScenario(input: FinancialEstimateInput): FinancialEstimateResult {
  const errors: string[] = [];
  const read = (value: EstimateInput, label: string, positive = false): number => {
    const n = value == null || value === '' ? 0 : Number(value);
    if (!Number.isFinite(n) || n < 0 || (positive && n === 0)) {
      errors.push(`${label}: enter a finite ${positive ? 'positive' : 'nonnegative'} value.`);
      return 0;
    }
    return n;
  };
  const miles = read(input.miles, 'Miles', true);
  const pay = input.revenue.kind === 'rate'
    ? read(input.revenue.ratePerMile, 'Rate Per Mile', true)
    : read(input.revenue.grossPay, 'Load Pay', true);
  const cpm = read(input.nonFuelCostPerMile, 'Nonfuel Cost Per Mile');
  const other = read(input.otherExpenses, 'Other Expenses');
  const tax = read(input.taxReservePercent, 'Tax Reserve Percentage');
  let fuel: Fraction = fraction(0);
  if (input.fuel.kind === 'consumption') {
    const price = read(input.fuel.pricePerGallon, 'Fuel Price');
    const mpg = read(input.fuel.mpg, 'Truck MPG');
    if (price > 0 && mpg <= 0) errors.push('Truck MPG: enter a positive MPG when Fuel Price is entered.');
    if (mpg > 0) fuel = multiply(divide(fraction(miles), fraction(mpg)), fraction(price));
  } else {
    fuel = fraction(read(input.fuel.totalCost, 'Fuel Cost'));
  }
  if (errors.length) return { ok: false, errors };
  const gross = cents(input.revenue.kind === 'rate' ? multiply(fraction(miles), fraction(pay)) : fraction(pay));
  const nonFuel = cents(multiply(fraction(miles), fraction(cpm)));
  const fuelCents = cents(fuel);
  const otherCents = cents(fraction(other));
  const expenses = nonFuel + fuelCents + otherCents;
  const reserve = cents(multiply({ n: gross, d: hundred }, { n: fraction(tax).n, d: fraction(tax).d * hundred }));
  const operating = gross - expenses;
  const afterTax = operating - reserve;
  // Per-mile ratios: 4 decimals from the reconciled cent totals.
  const perMile = (c: bigint) => roundTo(divide({ n: c, d: hundred }, fraction(miles)), tenThousand);
  const rpm = perMile(gross);
  const opm = perMile(operating);
  const ppm = perMile(afterTax);
  const values = [gross, nonFuel, fuelCents, otherCents, expenses, reserve, operating, afterTax];
  if ([...values, rpm, opm, ppm].some(v => v > maxCents || v < -maxCents)) {
    return { ok: false, errors: ['Values are too large to estimate safely. Enter smaller amounts or mileage.'] };
  }
  const [grossRevenue, nonFuelCost, fuelCost, otherExpenses, totalExpenses, taxReserve, operatingProfit, afterTaxEstimate] = values.map(v => Number(v) / 100);
  const [ratePerMile, operatingProfitPerMile, profitPerMile] = [rpm, opm, ppm].map(v => Number(v) / 10000);
  return { ok: true, estimate: { grossRevenue, nonFuelCost, fuelCost, otherExpenses, totalExpenses, taxReserve, operatingProfit, afterTaxEstimate, ratePerMile, operatingProfitPerMile, profitPerMile } };
}