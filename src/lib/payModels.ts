/**
 * Driver pay model — describes HOW a driver gets paid for a load.
 * Stored on `loads.pay_model` (nullable; null = legacy `loaded_miles_only`).
 * Default per-user is `user_settings.default_pay_model` (also nullable).
 */
export type PayModel =
  | 'loaded_miles_only'
  | 'total_miles'
  | 'loaded_plus_deadhead'
  | 'flat_rate'
  | 'manual';

export const PAY_MODEL_VALUES: PayModel[] = [
  'loaded_miles_only',
  'total_miles',
  'loaded_plus_deadhead',
  'flat_rate',
  'manual',
];

export const PAY_MODEL_LABELS: Record<PayModel, string> = {
  loaded_miles_only: 'Loaded Miles Only',
  total_miles: 'Total Miles Paid',
  loaded_plus_deadhead: 'Loaded + Deadhead Pay',
  flat_rate: 'Flat Rate',
  manual: 'Manual',
};

export const PAY_MODEL_DESCRIPTIONS: Record<PayModel, string> = {
  loaded_miles_only: 'Driver paid only for miles under freight (typical owner-operator).',
  total_miles: 'Driver paid for every mile, loaded and empty (typical 1099 contractor).',
  loaded_plus_deadhead: 'Loaded miles at one rate, deadhead miles at a separate rate (lease-purchase).',
  flat_rate: 'Fixed dollar amount for the whole load, regardless of miles.',
  manual: 'Enter the expected gross pay yourself.',
};

export function isPayModel(v: unknown): v is PayModel {
  return typeof v === 'string' && (PAY_MODEL_VALUES as string[]).includes(v);
}

/** Resolve effective pay model from a load row + user default. Null/unknown → loaded_miles_only. */
export function resolvePayModel(
  loadValue: string | null | undefined,
  userDefault?: string | null,
): PayModel {
  if (isPayModel(loadValue)) return loadValue;
  if (isPayModel(userDefault)) return userDefault;
  return 'loaded_miles_only';
}
