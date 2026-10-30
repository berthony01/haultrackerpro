import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import type { ParsedLoadData } from '@/lib/parseLoadText';

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const h = vi.hoisted(() => ({
  onParsed: null as null | ((d: any) => void),
  settings: { default_rate_per_mile: 2.1, default_other_fees: 0 } as any,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() } }));
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: h.settings }) }));
vi.mock('@/hooks/useCostProfile', () => ({
  useCostProfile: () => ({ profile: null }),
  computeCostProfileCPM: () => ({ cpm: 0, warnings: [] }),
}));
vi.mock('@/hooks/useProfitCheck', () => ({ useProfitCheck: () => ({ result: null }) }));
vi.mock('@/components/SmartChips', () => ({ SmartChips: () => null }));
vi.mock('@/components/PasteLoadParser', () => ({
  PasteLoadParser: (p: { onParsed: (d: any) => void }) => { h.onParsed = p.onParsed; return null; },
}));
vi.mock('@/components/ScanLoadModal', () => ({ ScanLoadModal: () => null }));
vi.mock('@/components/ProfitCheckCard', () => ({ ProfitCheckCard: () => null }));
vi.mock('@/components/MultiStopEditor', () => ({ MultiStopEditor: () => null }));
import { LoadForm } from '@/components/LoadForm';
import { parseLoadText } from '@/lib/parseLoadText';
import { mergePasteIntoForm, createPasteSession, PASTE_MANAGED_FIELDS, type PasteManagedValues } from '@/lib/loadPasteMerge';
import { normalizeParsedStops } from '@/lib/stopNormalization';

// Locked fictional sample — never written to any database.
const SAMPLE = `TRIP# 84B8233
⸻
NEED EMPTY TRAILER
LIVE LOAD: Lawrence Ks Bhpb
727 N Iowa St, Bhpb
Lawrence, KS 66049
10/29/2026 00:01 - 23:55
UNLOAD: Groveport DC
3099 Rohr Road, Amazoni Shipper
Groveport, OH 43125
10/30/2026 00:01 - 23:55
NEED EMPTY TRAILER
⸻
DEADHEAD: 374 mile
LOAD MI: 705 MILE
❌Late PU: $1000
❌Late DEL: $700
❌No Update: $200
❌No PU, DEL trailer photos: $200`;

describe('locked sample TRIP# 84B8233', () => {
  const r = parseLoadText(SAMPLE);
  it('extracts the load reference', () => expect(r.load_reference).toBe('84B8233'));
  it('extracts mileage', () => {
    expect(r.deadhead_miles).toBe('374');
    expect(r.loaded_miles).toBe('705');
  });
  it('fills NO pay', () => {
    expect(r.gross_revenue).toBeUndefined();
    expect(r.flat_rate).toBeUndefined();
    expect(r.rate_per_mile).toBeUndefined();
    expect(r.wait_fee).toBeUndefined();
    expect(r.detention_fee).toBeUndefined();
  });
  it('endpoints are city/state, never penalty values', () => {
    expect(r.pickup_location).toBe('Lawrence, KS');
    expect(r.dropoff_location).toBe('Groveport, OH');
  });
  it('pickup block facility/address/window', () => {
    expect(r.stop_details?.[0]).toEqual({
      kind: 'pickup', label: 'LIVE LOAD', facility: 'Lawrence Ks Bhpb', street: '727 N Iowa St, Bhpb',
      city: 'Lawrence', state: 'KS', zip: '66049', appointment_date: '2026-10-29', window_start: '00:01', window_end: '23:55',
    });
  });
  it('delivery block facility/address/window', () => {
    expect(r.stop_details?.[1]).toEqual({
      kind: 'drop', label: 'UNLOAD', facility: 'Groveport DC', street: '3099 Rohr Road, Amazoni Shipper',
      city: 'Groveport', state: 'OH', zip: '43125', appointment_date: '2026-10-30', window_start: '00:01', window_end: '23:55',
    });
    expect(r.stop_details).toHaveLength(2);
  });
  it('dates', () => {
    expect(r.load_date).toBe('2026-10-29');
    expect(r.dropoff_date).toBe('2026-10-30');
  });
  it('penalties are conditional review warnings only', () => {
    expect(r.conditional_penalties?.map(p => p.amount)).toEqual(['1000', '700', '200', '200']);
    expect(r.review_warnings?.filter(w => w.startsWith('Conditional penalty (not revenue)'))).toHaveLength(4);
  });
  it('requirement detected once', () => expect(r.requirements).toEqual(['NEED EMPTY TRAILER']));
  it('two-block route is not multi-stop and does not reverse', () => {
    expect(r.stops).toBeUndefined();
    expect(r.multiStopDetected).toBeFalsy();
    const n = normalizeParsedStops(r);
    expect(n.pickup_location).toBe('Lawrence, KS');
    expect(n.dropoff_location).toBe('Groveport, OH');
    expect(n.interiorStops).toEqual([]);
  });
});

describe('money fail-closed', () => {
  it('unlabelled $ amount no longer becomes gross', () => {
    const r = parseLoadText('Dallas, TX to Atlanta, GA\n$1500');
    expect(r.gross_revenue).toBeUndefined();
    expect(r.review_warnings?.some(w => w.includes('not labelled as pay'))).toBe(true);
  });
  it('explicit gross/flat/rate/fees still work', () => {
    expect(parseLoadText('Gross: $2,450').gross_revenue).toBe('2450');
    expect(parseLoadText('Flat rate: $850').flat_rate).toBe('850');
    expect(parseLoadText('Dallas TX to Atlanta GA, 780 mi, $2.45/mi').rate_per_mile).toBe('2.45');
    expect(parseLoadText('Detention fee: $75').detention_fee).toBe('75');
  });
  it('penalty with gross-like word cannot become revenue', () => {
    expect(parseLoadText('Late delivery fine total pay: $500').gross_revenue).toBeUndefined();
  });
  it('Late PU: $1000 never becomes pickup location', () => {
    const r = parseLoadText('Late PU: $1000\nLate DEL: $700');
    expect(r.pickup_location).toBeUndefined();
    expect(r.dropoff_location).toBeUndefined();
  });
});

describe('simple forms preserved', () => {
  it('from X to Y', () => {
    const r = parseLoadText('from Dallas, TX to Atlanta, GA');
    expect(r.pickup_location).toBe('Dallas, TX');
    expect(r.dropoff_location).toBe('Atlanta, GA');
  });
  it('Pickup: / Delivery:', () => {
    const r = parseLoadText('Pickup: Dallas, TX\nDelivery: Atlanta, GA');
    expect(r.pickup_location).toBe('Dallas, TX');
    expect(r.dropoff_location).toBe('Atlanta, GA');
  });
});

describe('load reference safety', () => {
  it('LOAD# and TRIP ID', () => {
    expect(parseLoadText('LOAD# 55A123').load_reference).toBe('55A123');
    expect(parseLoadText('Trip ID: T-1123J49SR').load_reference).toBe('T-1123J49SR');
  });
  it('no label, date, money or plain word', () => {
    expect(parseLoadText('84B8233').load_reference).toBeUndefined();
    expect(parseLoadText('Load: $1000').load_reference).toBeUndefined();
    expect(parseLoadText('Trip# ABCDEF').load_reference).toBeUndefined();
  });
  it('conflicting references left blank with warning', () => {
    const r = parseLoadText('TRIP# 111AAA\nLOAD# 222BBB');
    expect(r.load_reference).toBeUndefined();
    expect(r.review_warnings?.some(w => w.includes('Multiple load references'))).toBe(true);
  });
});

describe('ambiguous and multi-stop blocks', () => {
  it('block without City, ST ZIP is left blank with warning', () => {
    const r = parseLoadText('PICKUP: Acme\n123 Main St\nDELIVERY: Beta\n9 Elm St');
    expect(r.pickup_location).toBeUndefined();
    expect(r.dropoff_location).toBeUndefined();
    expect(r.review_warnings?.some(w => w.includes('no "City, ST ZIP"'))).toBe(true);
  });
  it('route ending in pickup is not guessed', () => {
    const r = parseLoadText('UNLOAD: A\nDallas, TX 75001\nPICKUP: B\nAustin, TX 78701');
    expect(r.pickup_location).toBeUndefined();
    expect(r.stops).toBeUndefined();
  });
  it('three blocks keep order and kinds; interior saved as Stop', () => {
    const r = parseLoadText('PICKUP: A\nDallas, TX 75001\nPICKUP: B\nWaco, TX 76701\nDELIVERY: C\nAustin, TX 78701');
    expect(r.stops?.map(s => [s.location, s.stop_type])).toEqual([
      ['Dallas, TX', 'Pickup'], ['Waco, TX', 'Pickup'], ['Austin, TX', 'Drop'],
    ]);
    const n = normalizeParsedStops(r);
    expect(n.pickup_location).toBe('Dallas, TX');
    expect(n.dropoff_location).toBe('Austin, TX');
    expect(n.interiorStops.map(s => [s.location, s.stop_type])).toEqual([['Waco, TX', 'Stop']]);
    expect(r.review_warnings?.some(w => w.includes('review only'))).toBe(true);
  });
});

describe('load_reference paste merge', () => {
  const blank = Object.fromEntries(PASTE_MANAGED_FIELDS.map(f => [f, ''])) as PasteManagedValues;
  it('is paste-managed', () => expect(PASTE_MANAGED_FIELDS).toContain('load_reference'));
  it('stale paste-owned reference cleared on re-paste', () => {
    const a = mergePasteIntoForm({ session: createPasteSession(), current: blank, notes: '', incoming: { load_reference: '84B8233' }, fallbacks: blank });
    expect(a.values.load_reference).toBe('84B8233');
    const b = mergePasteIntoForm({ session: a.session, current: a.values, notes: '', incoming: {}, fallbacks: blank });
    expect(b.values.load_reference).toBe('');
  });
  it('manual edit survives re-paste', () => {
    const a = mergePasteIntoForm({ session: createPasteSession(), current: blank, notes: '', incoming: { load_reference: '84B8233' }, fallbacks: blank });
    const edited = { ...a.values, load_reference: 'MY-REF-1' };
    const b = mergePasteIntoForm({ session: a.session, current: edited, notes: '', incoming: {}, fallbacks: blank });
    expect(b.values.load_reference).toBe('MY-REF-1');
  });
});

describe('LoadForm paste pay safety (default RPM configured = 2.1)', () => {
  afterEach(cleanup);
  const WARN = 'No agreed load pay detected; enter/verify pay before saving';
  const mount = () => {
    const view = render(React.createElement(LoadForm, { onSubmit: vi.fn() }));
    const rate = () => (view.getByLabelText(/Rate per Mile/i) as HTMLInputElement).value;
    const paste = (txt: string) => act(() => { h.onParsed!(parseLoadText(txt) as ParsedLoadData); });
    return { ...view, rate, paste };
  };

  it('manual entry keeps default rate', () => {
    const v = mount();
    expect(v.rate()).toBe('2.1');
  });
  it('sample with no pay clears autofilled default and warns', () => {
    const v = mount();
    v.paste(SAMPLE);
    expect(v.rate()).toBe('');
    expect(v.getByText(new RegExp(WARN))).toBeTruthy();
    expect((v.getByLabelText(/Load Reference/i) as HTMLInputElement).value).toBe('84B8233');
  });
  it('explicit RPM is used and no warning', () => {
    const v = mount();
    v.paste('Dallas TX to Atlanta GA, 780 mi, $2.45/mi');
    expect(v.rate()).toBe('2.45');
    expect(v.queryByText(new RegExp(WARN))).toBeNull();
  });
  it('deliberate manual rate survives a no-pay paste', () => {
    const v = mount();
    fireEvent.change(v.getByLabelText(/Rate per Mile/i), { target: { value: '3.00' } });
    v.paste(SAMPLE);
    expect(v.rate()).toBe('3.00');
    expect(v.getByText(new RegExp(WARN))).toBeTruthy();
  });
  it('re-paste: explicit rate then no-pay clears to blank, not default', () => {
    const v = mount();
    v.paste('Dallas TX to Atlanta GA, 780 mi, $2.45/mi');
    expect(v.rate()).toBe('2.45');
    v.paste(SAMPLE);
    expect(v.rate()).toBe('');
  });
  it('settings re-hydration does not refill pay after paste', () => {
    const v = mount();
    v.paste(SAMPLE);
    h.settings = { ...h.settings };
    v.rerender(React.createElement(LoadForm, { onSubmit: vi.fn() }));
    expect(v.rate()).toBe('');
    h.settings = { default_rate_per_mile: 2.1, default_other_fees: 0 };
  });
});
