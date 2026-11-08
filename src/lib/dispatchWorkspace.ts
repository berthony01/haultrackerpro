import { computeLoadPay } from './computeLoadPay';
import { hasMileageContradiction, resolveOperatingMiles } from './mileageMath';
import { toCents } from './financialMoney';
import { parseLoadText, type ParsedLoadData } from './parseLoadText';
import type { PayModel } from './payModels';

export interface DispatchPermissions { view: boolean; create: boolean; status: boolean }
export function dispatchPermissions(value: unknown): DispatchPermissions {
  const p = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { view: p.loads_view === true, create: p.loads_view === true && p.loads_dispatch === true, status: p.loads_view === true && p.loads_update_status === true };
}
export interface DispatchDriver { relationship_id: string; display_name: string }
export interface DispatchLoad {
  id: string; relationship_id: string; display_name: string; load_reference: string;
  pickup_location: string; dropoff_location: string; load_date: string; dropoff_date: string | null;
  status: 'pending' | 'en_route' | 'completed' | 'cancelled'; loaded_miles: number; deadhead_miles: number;
  total_miles: number | null; estimated_pay: number | null; actual_delivery_date: string | null;
}
export interface DispatchSummary {
  relationship_id: string; display_name: string; daily_count: number; daily_miles: number;
  weekly_count: number; weekly_miles: number; completed_count: number; completed_miles: number;
  unconfirmed_count: number; unconfirmed_miles: number; active_count: number; active_miles: number;
  cancelled_count: number; cancelled_miles: number;
}
export interface DispatchPage { loads: DispatchLoad[]; total: number; drivers: DispatchDriver[]; driver_total: number; summaries: DispatchSummary[]; week_start: string }
export interface DispatchForm {
  relationship_id: string; load_reference: string; pickup_location: string; dropoff_location: string;
  load_date: string; dropoff_date: string; loaded_miles: string; deadhead_miles: string; total_miles: string;
  pay_model: PayModel; rate_per_mile: string; deadhead_rate_per_mile: string; flat_rate_amount: string;
  manual_amount: string; wait_fee: string; detention_fee: string; other_fees: string; notes: string;
}
export function localDispatchDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export const emptyDispatchForm = (): DispatchForm => ({ relationship_id: '', load_reference: '', pickup_location: '', dropoff_location: '', load_date: localDispatchDate(), dropoff_date: '', loaded_miles: '', deadhead_miles: '', total_miles: '', pay_model: 'loaded_miles_only', rate_per_mile: '', deadhead_rate_per_mile: '', flat_rate_amount: '', manual_amount: '', wait_fee: '', detention_fee: '', other_fees: '', notes: '' });
const number = (s: string) => s === '' ? 0 : Number(s);
export const validDispatchReference = (s: string) => /^(?=.*\d)[A-Z0-9][A-Z0-9_-]{3,23}$/.test(s.trim().toUpperCase());
export function dispatchPay(form: DispatchForm) {
  return computeLoadPay({ payModel: form.pay_model, loadedMiles: number(form.loaded_miles), deadheadMiles: number(form.deadhead_miles), totalMiles: form.total_miles === '' ? null : number(form.total_miles), loadedRpm: number(form.rate_per_mile), dhRpm: number(form.deadhead_rate_per_mile), flatRate: number(form.flat_rate_amount), manualGross: number(form.manual_amount), fees: number(form.wait_fee) + number(form.detention_fee) + number(form.other_fees) });
}
export function validateDispatchForm(form: DispatchForm): string | null {
  if (!form.relationship_id) return 'Select an active connected driver.';
  if (!validDispatchReference(form.load_reference)) return 'Use a 4–24 character reference containing a digit, letters, hyphens or underscores.';
  if (!form.pickup_location.trim() || !form.dropoff_location.trim()) return 'Enter pickup and delivery locations.';
  if (!validDate(form.load_date) || (form.dropoff_date && (!validDate(form.dropoff_date) || form.dropoff_date < form.load_date))) return 'Check pickup and scheduled delivery dates.';
  const numeric = ['loaded_miles', 'deadhead_miles', 'total_miles', 'rate_per_mile', 'deadhead_rate_per_mile', 'flat_rate_amount', 'manual_amount', 'wait_fee', 'detention_fee', 'other_fees'] as const;
  if (numeric.some(k => form[k] !== '' && (!Number.isFinite(Number(form[k])) || Number(form[k]) < 0))) return 'Miles, rates and agreed fees must be nonnegative numbers.';
  if (hasMileageContradiction({ loadedMiles: number(form.loaded_miles), deadheadMiles: number(form.deadhead_miles), totalMiles: form.total_miles === '' ? null : number(form.total_miles) })) return 'Correct total miles to agree with loaded plus deadhead within 2 miles.';
  const required = form.pay_model === 'manual' ? form.manual_amount : form.pay_model === 'flat_rate' ? form.flat_rate_amount : form.rate_per_mile;
  if (required === '' || (form.pay_model === 'loaded_plus_deadhead' && form.deadhead_rate_per_mile === '')) return 'Enter the explicit agreed pay amount or rates; no saved default is assumed.';
  if (form.notes.length > 5000 || form.pickup_location.length > 200 || form.dropoff_location.length > 200) return 'Location or notes are too long.';
  return null;
}
export function validDate(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s; }
export function validDeliveryDate(date: string, pickup: string, today = localDispatchDate()) { return validDate(date) && date >= pickup && date <= today; }
export function dispatchPayload(form: DispatchForm) {
  const payload: Record<string, unknown> = { ...form, load_reference: form.load_reference.trim().toUpperCase(), pickup_location: form.pickup_location.trim(), dropoff_location: form.dropoff_location.trim(), dropoff_date: form.dropoff_date || null, notes: form.notes.trim() || null };
  for (const key of ['loaded_miles', 'deadhead_miles', 'rate_per_mile', 'wait_fee', 'detention_fee', 'other_fees'] as const) payload[key] = number(form[key]);
  for (const key of ['total_miles', 'flat_rate_amount', 'deadhead_rate_per_mile', 'manual_amount'] as const) payload[key] = form[key] === '' ? null : Number(form[key]);
  payload.estimated_pay = toCents(dispatchPay(form).expectedGrossPay) / 100;
  return payload;
}
export function parseDispatchForm(source: string, current: DispatchForm): { form: DispatchForm; parsed: ParsedLoadData; warnings: string[] } {
  const parsed = parseLoadText(source);
  const form = { ...current };
  const mappings = { load_reference: 'load_reference', pickup_location: 'pickup_location', dropoff_location: 'dropoff_location', load_date: 'load_date', dropoff_date: 'dropoff_date', loaded_miles: 'loaded_miles', deadhead_miles: 'deadhead_miles', total_miles: 'total_miles', rate_per_mile: 'rate_per_mile', deadhead_rate_per_mile: 'deadhead_rate_per_mile', flat_rate: 'flat_rate_amount', gross_revenue: 'manual_amount', wait_fee: 'wait_fee', detention_fee: 'detention_fee' } as const;
  for (const [from, to] of Object.entries(mappings)) { const v = parsed[from as keyof ParsedLoadData]; if (typeof v === 'string') Object.assign(form, { [to]: v }); }
  // Paste replaces pay evidence, never inherits a previously typed/default rate.
  form.rate_per_mile = parsed.rate_per_mile ?? ''; form.deadhead_rate_per_mile = parsed.deadhead_rate_per_mile ?? '';
  form.flat_rate_amount = parsed.flat_rate ?? ''; form.manual_amount = parsed.gross_revenue ?? '';
  form.pay_model = parsed.pay_model_suggestion ?? (parsed.gross_revenue ? 'manual' : 'loaded_miles_only');
  const warnings = [...(parsed.review_warnings ?? [])];
  if (!parsed.rate_per_mile && !parsed.flat_rate && !parsed.gross_revenue) warnings.push('No explicit agreed pay extracted. Enter it before saving.');
  if (parsed.multiStopDetected || parsed.stop_details?.length || parsed.stops?.length) warnings.push('Stop-by-stop tracking is not part of this view; full source and stop details are retained in notes.');
  // Preserve source verbatim for conditional penalties, appointments, requirements and every stop.
  form.notes = [current.notes, 'Dispatch source — review only (conditional penalties are not earnings):', source].filter(Boolean).join('\n');
  return { form, parsed, warnings };
}
export const dispatchMiles = (load: DispatchLoad) => resolveOperatingMiles({ loadedMiles: Number(load.loaded_miles), deadheadMiles: Number(load.deadhead_miles), totalMiles: load.total_miles == null ? null : Number(load.total_miles) });

/** One intent survives ambiguous failures. A changed payload must be explicitly abandoned. */
export class DispatchIntent {
  private pending: { key: string; fingerprint: string } | null = null;
  constructor(private key: () => string = () => crypto.randomUUID()) {}
  begin(payload: unknown): string {
    const fingerprint = JSON.stringify(payload);
    if (this.pending && this.pending.fingerprint !== fingerprint) throw new Error('Resolve or abandon the previous attempt before submitting changed details.');
    this.pending ??= { key: this.key(), fingerprint };
    return this.pending.key;
  }
  clear() { this.pending = null; }
}