import { PayModel } from '@/lib/payModels';

export interface ComputeLoadPayInput {
  payModel: PayModel;
  loadedMiles?: number | null;
  deadheadMiles?: number | null;
  totalMiles?: number | null;
  loadedRpm?: number | null;            // $/mi for loaded
  dhRpm?: number | null;                // $/mi for deadhead (loaded_plus_deadhead model)
  flatRate?: number | null;
  manualGross?: number | null;
  fees?: number;                         // wait + detention + other (already summed)
  /** For 'loaded_miles_only', adds DH revenue layer when paid same/custom (legacy behaviour). */
  legacyDhPayMode?: 'unpaid' | 'same' | 'custom';
  legacyDhPayRate?: number | null;
}

export interface ComputeLoadPayResult {
  paidMiles: number;
  totalOperatingMiles: number;
  expectedGrossPay: number;       // what client should write to estimated_pay
  effectiveRpm: number;           // gross / total operating miles
  paidRpm: number;                // gross / paid miles (==effective for total_miles)
  deadheadPct: number;            // deadhead / total_operating_miles * 100
  warnings: string[];
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * Pure pay/profit calculator. Single source of truth for the form preview, the
 * value persisted to `estimated_pay`, and downstream "effective RPM" displays.
 *
 * Backward compatibility: when `payModel === 'loaded_miles_only'` and a legacy
 * deadhead-pay mode is supplied, the result matches the historical formula
 * `(loaded * rate) + fees + dhRevenueLayer`.
 */
export function computeLoadPay(input: ComputeLoadPayInput): ComputeLoadPayResult {
  const loaded = num(input.loadedMiles);
  const deadhead = num(input.deadheadMiles);
  const totalRaw = num(input.totalMiles);
  const fees = num(input.fees);
  const warnings: string[] = [];

  // Resolve total operating miles. Prefer explicit total when present and self-consistent.
  let totalOperatingMiles = loaded + deadhead;
  if (totalRaw > 0) {
    totalOperatingMiles = totalRaw;
    if (loaded > 0 && deadhead >= 0 && Math.abs(loaded + deadhead - totalRaw) > 2) {
      warnings.push(
        `Mileage mismatch: loaded (${loaded}) + deadhead (${deadhead}) = ${loaded + deadhead}, but total miles = ${totalRaw}.`,
      );
    }
    if (loaded > 0 && totalRaw < loaded) {
      warnings.push('Total miles is less than loaded miles.');
    }
    if (deadhead > 0 && deadhead > totalRaw) {
      warnings.push('Deadhead miles is greater than total miles.');
    }
  }

  let expectedGrossPay = 0;
  let paidMiles = 0;

  switch (input.payModel) {
    case 'loaded_miles_only': {
      const rate = num(input.loadedRpm);
      if (loaded === 0) warnings.push('Loaded Miles Only: enter loaded miles to estimate pay.');
      paidMiles = loaded;
      let dhRevenue = 0;
      if (deadhead > 0 && input.legacyDhPayMode === 'same') {
        dhRevenue = deadhead * rate;
        paidMiles += deadhead;
      } else if (deadhead > 0 && input.legacyDhPayMode === 'custom') {
        dhRevenue = deadhead * num(input.legacyDhPayRate);
        paidMiles += deadhead;
      }
      expectedGrossPay = loaded * rate + dhRevenue + fees;
      break;
    }
    case 'total_miles': {
      const rate = num(input.loadedRpm); // rate field reused for "rate per mile"
      const miles = totalRaw > 0 ? totalRaw : totalOperatingMiles;
      if (miles === 0) warnings.push('Total Miles Paid: enter total miles (or loaded + deadhead) to estimate pay.');
      paidMiles = miles;
      expectedGrossPay = miles * rate + fees;
      break;
    }
    case 'loaded_plus_deadhead': {
      const rL = num(input.loadedRpm);
      const rD = num(input.dhRpm);
      if (loaded === 0 && deadhead === 0) warnings.push('Loaded + Deadhead Pay: enter loaded and/or deadhead miles.');
      paidMiles = loaded + deadhead;
      expectedGrossPay = loaded * rL + deadhead * rD + fees;
      break;
    }
    case 'flat_rate': {
      const flat = num(input.flatRate);
      if (flat === 0) warnings.push('Flat Rate: enter the flat-rate amount for this load.');
      if (totalOperatingMiles === 0) warnings.push('Flat Rate: enter loaded and/or deadhead miles to compute effective RPM.');
      paidMiles = totalOperatingMiles; // flat covers all miles
      expectedGrossPay = flat + fees;
      break;
    }
    case 'manual': {
      const m = num(input.manualGross);
      paidMiles = totalOperatingMiles;
      expectedGrossPay = m + fees;
      break;
    }
  }

  const effectiveRpm = totalOperatingMiles > 0 ? expectedGrossPay / totalOperatingMiles : 0;
  const paidRpm = paidMiles > 0 ? expectedGrossPay / paidMiles : 0;
  const deadheadPct = totalOperatingMiles > 0 ? (deadhead / totalOperatingMiles) * 100 : 0;

  return {
    paidMiles,
    totalOperatingMiles,
    expectedGrossPay: Math.max(0, expectedGrossPay),
    effectiveRpm,
    paidRpm,
    deadheadPct,
    warnings,
  };
}
