import { describe, it, expect } from 'vitest';
import { DispatchIntent, dispatchAgreedCents, dispatchPermissions, dispatchPayload, dispatchPay, emptyDispatchForm, localDispatchDate, parseDispatchForm, validDeliveryDate, validDispatchReference, validateDispatchForm } from '@/lib/dispatchWorkspace';
import { parseDispatchStatusReportCommand } from '../../supabase/functions/_shared/telegram-dispatch-group-proposals';
import { computeLoadPay } from '@/lib/computeLoadPay';
import { telegramMiniAppKeyboard, telegramDispatchEntry } from '../../supabase/functions/_shared/telegram-mini-app-buttons';
import { classifyUpdate } from '../../supabase/functions/_shared/telegram-poll-ingest';
import { miniAppView } from '@/lib/telegramMiniApp';

const valid = () => ({ ...emptyDispatchForm(), relationship_id: 'relationship', load_reference: 'LOAD-1234', pickup_location: 'Dallas, TX', dropoff_location: 'Austin, TX', loaded_miles: '200.45', deadhead_miles: '10', total_miles: '210.45', rate_per_mile: '2.015' });
describe('Dispatcher Mini App deterministic rules', () => {
  it.each([false,true])('view permission %s never follows create/status permission', view => {
    expect(dispatchPermissions({ loads_view: view, loads_dispatch: true, loads_update_status: true })).toEqual({view,create:view,status:view});
  });
  it.each([{}, null, { loads_view:'true', loads_dispatch:true }, { loads_view:true, loads_dispatch:false, loads_update_status:false }])('fails closed for independent permission matrix %j', p => {
    const permissions=dispatchPermissions(p); expect(permissions.create).toBe(false); expect(permissions.status).toBe(false);
  });
  it.each(['L123', 'HTP-QA-GEN2','LOAD-1234567890123456789'])('accepts group-compatible reference %s', ref => {
    expect(validDispatchReference(ref)).toBe(true);
    expect(parseDispatchStatusReportCommand(`/delivered@HaulTrackerBot ${ref}`)?.reference).toBe(ref);
  });
  it.each(['ABC','LETTERS','123','REF WITH1 SPACE','X'.repeat(24)+'1','AB1_','AB1-','A_12'])('rejects incompatible reference %s', ref => expect(validDispatchReference(ref)).toBe(false));
  it.each(['1','20245'])('blocks contradictory total %s in either direction', total_miles => expect(validateDispatchForm({...valid(), total_miles})).toMatch(/within 2 miles/));
  it('preserves the historical 0.75-mile tolerance and total-only loads', () => {
    expect(validateDispatchForm({...valid(),total_miles:'211.2'})).toBeNull();
    expect(dispatchPay({...valid(),loaded_miles:'',deadhead_miles:'',total_miles:'302.75',pay_model:'total_miles'}).totalOperatingMiles).toBe(302.75);
  });
  it.each(['loaded_miles_only','loaded_plus_deadhead','total_miles','flat_rate','manual'] as const)('uses canonical pay math for %s and rounds only pay', pay_model => {
    const form={...valid(),pay_model,deadhead_rate_per_mile:'1.005',flat_rate_amount:'100.005',manual_amount:'200.005',wait_fee:'10.005'};
    const oracle=computeLoadPay({payModel:pay_model,loadedMiles:200.45,deadheadMiles:10,totalMiles:210.45,loadedRpm:2.015,dhRpm:1.005,flatRate:100.005,manualGross:200.005,fees:10.005});
    expect(dispatchPay(form)).toEqual(oracle); expect(dispatchPayload(form).loaded_miles).toBe(200.45); expect(dispatchPayload(form).rate_per_mile).toBe(2.015);
  });
  it('rounds a decimal 1.005 flat amount to 1.01 without rewriting the original input', () => {const p=dispatchPayload({...valid(),pay_model:'flat_rate',flat_rate_amount:'1.005'});expect(p.estimated_pay).toBe(1.01);expect(p.flat_rate_amount).toBe(1.005);});
  it.each([['14.5','2.01',2915],['1.15','0.1',12],['201.05','0.1',2011]])('recognizes exact decimal miles %s × rate %s in cents', (loaded_miles,rate_per_mile,cents) => {
    const form={...valid(),loaded_miles,rate_per_mile,deadhead_miles:'',total_miles:''};
    expect(dispatchAgreedCents(form)).toBe(cents);
    expect(dispatchPayload(form).estimated_pay).toBe(cents/100);
  });
  it('replacing pasted source clears route, dates and mileage absent from the new source', () => {
    const prior={...valid(),dropoff_date:'2026-11-07',notes:'Dispatcher instruction'};
    const first=parseDispatchForm('LOAD# OLD123\nPickup: Miami, FL\nDelivery: Tampa, FL\nFlat rate $500',prior);
    const next=parseDispatchForm('LOAD# NEW123\nFlat rate $400',first.form);
    expect(next.form).toMatchObject({relationship_id:prior.relationship_id,load_reference:'NEW123',pickup_location:'',dropoff_location:'',load_date:'',dropoff_date:'',loaded_miles:'',deadhead_miles:'',total_miles:''});
    expect(next.form.notes).toContain('Dispatcher instruction');
    expect(next.form.notes).not.toContain('OLD123');
    expect(validateDispatchForm(next.form)).toMatch(/locations/);
  });
  it('does not inherit pay after a paste with only conditional penalties', () => {
    const source='TRIP# 84B8233\nNEED EMPTY TRAILER\nLate fee $100 penalty\nPickup: Dallas, TX\nDelivery: Austin, TX';
    const p=parseDispatchForm(source,{...valid(),wait_fee:'100',detention_fee:'200',other_fees:'300'}); expect(p.form.rate_per_mile).toBe(''); expect(p.form.manual_amount).toBe(''); expect(p.form.wait_fee).toBe(''); expect(p.form.detention_fee).toBe(''); expect(p.form.other_fees).toBe(''); expect(p.form.notes).toContain(source);expect(p.warnings.join(' ')).toMatch(/No explicit agreed pay/);
  });
  it('keeps every multi-stop source, appointment and requirement available for review', () => {
    const source='TRIP# AB1234\nPickup: Dallas, TX\nStop 2: Waco, TX\nDelivery: Austin, TX\nMULTI STOP\nAppointment window 08:00-10:00\nNEED EMPTY TRAILER';
    const p=parseDispatchForm(source,valid());expect(p.form.notes).toContain(source);expect(p.form.notes).toContain('conditional penalties are not earnings');
  });
  it('requires explicit pay even when zero is intentionally agreed', () => {expect(validateDispatchForm({...valid(),rate_per_mile:''})).toMatch(/explicit agreed/);expect(validateDispatchForm({...valid(),rate_per_mile:'0'})).toBeNull();});
  it.each(['2026-11-09','2026-10-30','2026-02-30',''])('rejects invalid/future/pre-pickup actual delivery %s', date => expect(validDeliveryDate(date,'2026-11-01','2026-11-08')).toBe(false));
  it('uses local date fields without UTC conversion', () => expect(localDispatchDate(new Date(2026,10,8,0,1))).toBe('2026-11-08'));
  it('binds ambiguous retries to exact payload and keeps the key until explicit abandonment', () => {
    let n=0;const intent=new DispatchIntent(()=>`key-${++n}`);expect(intent.begin({load:'1',date:'2026-11-08'})).toBe('key-1');expect(intent.begin({load:'1',date:'2026-11-08'})).toBe('key-1');expect(()=>intent.begin({load:'1',date:'2026-11-07'})).toThrow(/previous attempt/);intent.clear();expect(intent.begin({load:'1',date:'2026-11-07'})).toBe('key-2');
  });
  it('opens the Dispatch destination and restricts web_app keyboard to private chat', () => {
    expect(miniAppView('?view=dispatch')).toBe('dispatch');const rows=[[{text:'Open Dispatch',url:'https://haultrackerpro.com/telegram?view=dispatch'}]];
    expect(telegramMiniAppKeyboard(rows,123)[0][0]).toEqual({text:'Open Dispatch',web_app:{url:rows[0][0].url}});expect(telegramMiniAppKeyboard(rows,-123)[0][0]).toEqual(rows[0][0]);
  });
  it('offers a sign-in entry without depending on opportunity-viewing authority', () => {
    const entry=telegramDispatchEntry('dispatch');
    expect(entry?.text).toContain('check your dispatch access');
    expect(entry?.buttons[0][0].url).toBe('https://haultrackerpro.com/telegram?view=dispatch');
    expect(telegramDispatchEntry('menu')).toBeNull();
  });
  it('classifies only exact private /start dispatch and preserves link priority', () => {
    const update=(text:string,type='private')=>({telegramUserId:123,telegramChatId:type==='private'?123:-123,chatType:type,text,callbackQueryId:null} as Parameters<typeof classifyUpdate>[0]);
    expect(classifyUpdate(update('/start dispatch'))).toEqual({kind:'menu',command:'dispatch'});
    expect(classifyUpdate(update(`/start ${'a'.repeat(64)}`))).toEqual({kind:'start',rawToken:'a'.repeat(64)});
    expect(classifyUpdate(update('/start dispatch '))).not.toEqual({kind:'menu',command:'dispatch'});expect(classifyUpdate(update('/start dispatch','group')).kind).toBe('ignored');
  });
});
