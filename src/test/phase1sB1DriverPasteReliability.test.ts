import { describe, it, expect } from 'vitest';
import { parseLoadText } from '@/lib/parseLoadText';
import {
  createPasteSession,
  mergePasteIntoForm,
  tripIdNoteLine,
  type PasteManagedValues,
  type PasteSession,
} from '@/lib/loadPasteMerge';
import { resolveImportedLoadDate, resolveImportedDropoffDate } from '@/lib/sourceDate';

const DEFAULT_RATE = '2.10';

const FALLBACKS: PasteManagedValues = {
  pickup_location: '',
  dropoff_location: '',
  rate_per_mile: DEFAULT_RATE,
  gross_revenue: '',
  flat_rate_amount: '',
  dh_rate_per_mile: '',
  wait_fee: '0',
  detention_fee: '0',
  pay_model: 'loaded_miles_only',
};

const EMPTY_FORM: PasteManagedValues = {
  pickup_location: '',
  dropoff_location: '',
  rate_per_mile: DEFAULT_RATE,
  gross_revenue: '',
  flat_rate_amount: '',
  dh_rate_per_mile: '',
  wait_fee: '0',
  detention_fee: '0',
  pay_model: 'loaded_miles_only',
};

/**
 * Minimal simulation of the LoadForm paste path using the REAL production
 * functions: parseLoadText + mergePasteIntoForm. Mileage fields are
 * fresh-per-paste exactly as LoadForm applies them.
 */
interface SimState {
  values: PasteManagedValues;
  notes: string;
  loaded_miles: string;
  deadhead_miles: string;
  total_miles: string;
  session: PasteSession;
}

function initialState(overrides: Partial<SimState> = {}): SimState {
  return {
    values: { ...EMPTY_FORM },
    notes: '',
    loaded_miles: '',
    deadhead_miles: '',
    total_miles: '',
    session: createPasteSession(),
    ...overrides,
  };
}

function applyPaste(state: SimState, text: string): SimState {
  const data = parseLoadText(text);
  const merged = mergePasteIntoForm({
    session: state.session,
    current: state.values,
    notes: state.notes,
    incoming: {
      pickup_location: data.pickup_location,
      dropoff_location: data.dropoff_location,
      rate_per_mile: data.rate_per_mile,
      gross_revenue: data.gross_revenue,
      flat_rate_amount: data.flat_rate,
      dh_rate_per_mile: data.deadhead_rate_per_mile,
      wait_fee: data.wait_fee,
      detention_fee: data.detention_fee,
      pay_model: data.pay_model_suggestion,
    },
    fallbacks: FALLBACKS,
    tripId: data.trip_id,
  });
  return {
    values: merged.values,
    notes: merged.notes,
    session: merged.session,
    // Fresh-per-paste mileage, matching LoadForm.
    loaded_miles: data.loaded_miles ?? '',
    deadhead_miles: data.deadhead_miles ?? '',
    total_miles: data.total_miles ?? '',
  };
}

const PASTE_A = [
  'Origin: Dallas, TX',
  'Dest: Atlanta, GA',
  'Trip ID: T-AAA111',
  'Loaded miles: 780',
  'DH 40 miles',
  'Total miles: 820',
  'Rate: $2.45/mi',
  'DH rate $1.00',
  'Gross: $1911',
  'Detention fee: $75',
  'Waiting fee: $50',
].join('\n');

const PASTE_B_MINIMAL = 'Loaded miles: 300';

describe('Phase 1S-B1 — paste-managed field lifecycle', () => {
  it('Paste A fills locations/rate/gross/fees/pay model', () => {
    const s = applyPaste(initialState(), PASTE_A);
    expect(s.values.pickup_location).toBe('Dallas, TX');
    expect(s.values.dropoff_location).toBe('Atlanta, GA');
    expect(s.values.rate_per_mile).toBe('2.45');
    expect(s.values.gross_revenue).toBe('1911');
    expect(s.values.dh_rate_per_mile).toBe('1.00');
    expect(s.values.detention_fee).toBe('75');
    expect(s.values.wait_fee).toBe('50');
    expect(s.values.pay_model).toBe('loaded_plus_deadhead');
    expect(s.notes).toBe(tripIdNoteLine('T-AAA111'));
  });

  it('Paste B removes only untouched A-imported values and restores fallbacks', () => {
    const a = applyPaste(initialState(), PASTE_A);
    const b = applyPaste(a, PASTE_B_MINIMAL);
    expect(b.values.pickup_location).toBe('');
    expect(b.values.dropoff_location).toBe('');
    expect(b.values.rate_per_mile).toBe(DEFAULT_RATE);
    expect(b.values.gross_revenue).toBe('');
    expect(b.values.flat_rate_amount).toBe('');
    expect(b.values.dh_rate_per_mile).toBe('');
    expect(b.values.detention_fee).toBe('0');
    expect(b.values.wait_fee).toBe('0');
    expect(b.values.pay_model).toBe('loaded_miles_only');
  });

  it('loaded/deadhead/total are fresh-per-paste and cannot leak from A to B', () => {
    const a = applyPaste(initialState(), PASTE_A);
    expect(a.loaded_miles).toBe('780');
    expect(a.deadhead_miles).toBe('40');
    expect(a.total_miles).toBe('820');
    const b = applyPaste(a, 'Rate: $3.00/mi');
    expect(b.loaded_miles).toBe('');
    expect(b.deadhead_miles).toBe('');
    expect(b.total_miles).toBe('');
  });

  it('a manual edit to an A-imported field survives a Paste B that omits it', () => {
    const a = applyPaste(initialState(), PASTE_A);
    a.values.rate_per_mile = '3.25';       // driver edits the imported rate
    a.values.pickup_location = 'Houston, TX';
    const b = applyPaste(a, PASTE_B_MINIMAL);
    expect(b.values.rate_per_mile).toBe('3.25');
    expect(b.values.pickup_location).toBe('Houston, TX');
    // Ownership was dropped, so a THIRD omitting paste still keeps the manual value.
    const c = applyPaste(b, PASTE_B_MINIMAL);
    expect(c.values.rate_per_mile).toBe('3.25');
    expect(c.values.pickup_location).toBe('Houston, TX');
  });

  it('flat rate imported by A is cleared when B omits it', () => {
    const a = applyPaste(initialState(), 'Dallas to Houston flat $850 250 mi');
    expect(a.values.flat_rate_amount).toBe('850');
    expect(a.values.pay_model).toBe('flat_rate');
    const b = applyPaste(a, 'Loaded miles: 300');
    expect(b.values.flat_rate_amount).toBe('');
    expect(b.values.pay_model).toBe('loaded_miles_only');
  });
});

describe('Phase 1S-B1 — parser-added Trip ID provenance', () => {
  it('Trip ID A is replaced by Trip ID B with no duplicate', () => {
    const a = applyPaste(initialState(), PASTE_A);
    const b = applyPaste(a, 'Trip ID: T-BBB222\nLoaded miles: 300');
    expect(b.notes).toBe(tripIdNoteLine('T-BBB222'));
    expect(b.notes).not.toContain('T-AAA111');
    expect(b.notes.split('\n').filter(l => l.startsWith('Trip ID:')).length).toBe(1);
  });

  it('Paste B with no Trip ID removes an untouched parser-added Trip ID A', () => {
    const a = applyPaste(initialState(), PASTE_A);
    const b = applyPaste(a, PASTE_B_MINIMAL);
    expect(b.notes).toBe('');
  });

  it('a driver-modified old Trip ID note is preserved', () => {
    const a = applyPaste(initialState(), PASTE_A);
    a.notes = 'Trip ID: T-AAA111 (confirmed with dispatch)';
    const b = applyPaste(a, PASTE_B_MINIMAL);
    expect(b.notes).toBe('Trip ID: T-AAA111 (confirmed with dispatch)');
  });

  it('driver notes written alongside the parser line survive replacement', () => {
    const a = applyPaste(initialState(), PASTE_A);
    a.notes = `Reefer at 34F\n${tripIdNoteLine('T-AAA111')}`;
    const b = applyPaste(a, 'Trip ID: T-BBB222');
    expect(b.notes).toBe(`Reefer at 34F\n${tripIdNoteLine('T-BBB222')}`);
  });
});

describe('Phase 1S-B1 — parsed dates flow through source-date resolution', () => {
  it('explicit pickup/delivery dates resolve without stale carryover', () => {
    const a = parseLoadText('Pickup Date: 05/29/2026\nDelivery Date: 05/31/2026');
    const loadA = resolveImportedLoadDate('', a.load_date, false);
    const dropA = resolveImportedDropoffDate('', a.dropoff_date, false);
    expect(loadA.value).toBe('2026-05-29');
    expect(dropA.value).toBe('2026-05-31');

    // Second paste with no dates must not keep the imported ones.
    const b = parseLoadText('Loaded miles: 300');
    const loadB = resolveImportedLoadDate(loadA.value, b.load_date, false);
    const dropB = resolveImportedDropoffDate(dropA.value, b.dropoff_date, false);
    expect(loadB.value).not.toBe('2026-05-29');
    expect(dropB.value).toBe('');
  });

  it('a manually set drop-off date is preserved when the new paste omits it', () => {
    const b = parseLoadText('Loaded miles: 300');
    const dropB = resolveImportedDropoffDate('2026-06-15', b.dropoff_date, true);
    expect(dropB.value).toBe('2026-06-15');
    expect(dropB.kept).toBe('manual');
  });
});

describe('Phase 1S-B1 — real-world two-paste sequence retains nothing stale', () => {
  it('no old rate, gross, fee, flat/DH rate, pay model, location, mileage, total, endpoint, or Trip ID survives', () => {
    const a = applyPaste(initialState(), PASTE_A);
    const b = applyPaste(a, [
      '📍1#: AAA',
      'Loaded - Preloaded',
      'Uxbridge, MA 01569',
      '—————————————',
      '📍2#: BBB',
      'Empty - Drop',
      'Castleton, NY 12033',
      '',
      'DH 25 miles',
      '🚛Trip: 257.10mi',
    ].join('\n'));

    expect(b.values.pickup_location).toBe('Uxbridge, MA');
    expect(b.values.dropoff_location).toBe('Castleton, NY');
    expect(b.values.rate_per_mile).toBe(DEFAULT_RATE);
    expect(b.values.gross_revenue).toBe('');
    expect(b.values.flat_rate_amount).toBe('');
    expect(b.values.dh_rate_per_mile).toBe('');
    expect(b.values.wait_fee).toBe('0');
    expect(b.values.detention_fee).toBe('0');
    expect(b.values.pay_model).toBe('loaded_miles_only');
    expect(b.loaded_miles).toBe('257.10');
    expect(b.deadhead_miles).toBe('25');
    expect(b.total_miles).toBe('');
    expect(b.notes).toBe('');
    expect(JSON.stringify(b)).not.toContain('T-AAA111');
    expect(JSON.stringify(b.values)).not.toContain('Dallas');
    expect(JSON.stringify(b.values)).not.toContain('Atlanta');
  });
});
