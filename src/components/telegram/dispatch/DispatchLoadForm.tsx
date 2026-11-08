import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DispatchIntent, dispatchPay, dispatchPayload, emptyDispatchForm, parseDispatchForm, validateDispatchForm, type DispatchDriver, type DispatchForm } from '@/lib/dispatchWorkspace';

export function DispatchLoadForm({ drivers, enabled, save, close }: { drivers: DispatchDriver[]; enabled: boolean; save: (key: string, payload: Record<string, unknown>) => Promise<void>; close: () => void }) {
  const [form, setForm] = useState(emptyDispatchForm);
  const [source, setSource] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intent = useRef(new DispatchIntent()); const submitting = useRef(false);
  const set = (key: keyof DispatchForm, value: string) => { setForm(old => ({ ...old, [key]: value })); setReview(false); };
  const pay = dispatchPay(form);
  async function submit() {
    if (!enabled || submitting.current) return;
    const issue = validateDispatchForm(form); if (issue) { setError(issue); return; }
    submitting.current = true; setBusy(true); setError(null);
    try { const payload = dispatchPayload(form); await save(intent.current.begin(payload), payload); intent.current.clear(); close(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Save could not be confirmed. Retry the same details.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  const field = (key: keyof DispatchForm, label: string, type = 'text') => <div className="min-w-0 space-y-1" key={key}><Label htmlFor={`dispatch-${key}`}>{label}</Label><Input id={`dispatch-${key}`} type={type} value={form[key]} onChange={e => set(key, e.target.value)} disabled={busy} {...(type === 'number' ? { min: 0, step: 'any' } : {})} /></div>;
  return <section aria-label="Add dispatch load" className="min-w-0 space-y-4 border-t border-border pt-4">
    <h2 className="text-lg font-semibold">Add Load</h2>
    <Label htmlFor="dispatch-source">Paste dispatch details</Label><Textarea id="dispatch-source" value={source} onChange={e => setSource(e.target.value)} disabled={busy} />
    <Button variant="outline" disabled={!source.trim() || busy} onClick={() => { const result = parseDispatchForm(source, form); setForm(result.form); setWarnings(result.warnings); setReview(false); }}>Extract for review</Button>
    {warnings.map((warning, i) => <p key={i} className="text-sm text-muted-foreground">{warning}</p>)}
    <div className="space-y-1"><Label htmlFor="dispatch-driver">Connected driver</Label><Select value={form.relationship_id || 'none'} onValueChange={v => set('relationship_id', v === 'none' ? '' : v)} disabled={busy}><SelectTrigger id="dispatch-driver"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Select driver</SelectItem>{drivers.map(d => <SelectItem value={d.relationship_id} key={d.relationship_id}>{d.display_name}</SelectItem>)}</SelectContent></Select></div>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">{field('load_reference', 'Load reference')}{field('pickup_location', 'Pickup location')}{field('dropoff_location', 'Delivery location')}{field('load_date', 'Pickup date', 'date')}{field('dropoff_date', 'Scheduled delivery date', 'date')}{field('loaded_miles', 'Loaded miles', 'number')}{field('deadhead_miles', 'Deadhead miles', 'number')}{field('total_miles', 'Total operating miles', 'number')}</div>
    <div className="space-y-1"><Label htmlFor="dispatch-pay-model">Pay model</Label><Select value={form.pay_model} onValueChange={v => set('pay_model', v)} disabled={busy}><SelectTrigger id="dispatch-pay-model"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="loaded_miles_only">Loaded miles only</SelectItem><SelectItem value="total_miles">Total miles paid</SelectItem><SelectItem value="loaded_plus_deadhead">Loaded + deadhead pay</SelectItem><SelectItem value="flat_rate">Flat rate</SelectItem><SelectItem value="manual">Manual agreed amount</SelectItem></SelectContent></Select></div>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">{(['loaded_miles_only', 'total_miles', 'loaded_plus_deadhead'].includes(form.pay_model)) && field('rate_per_mile', 'Agreed rate per mile', 'number')}{form.pay_model === 'loaded_plus_deadhead' && field('deadhead_rate_per_mile', 'Deadhead rate per mile', 'number')}{form.pay_model === 'flat_rate' && field('flat_rate_amount', 'Flat agreed amount', 'number')}{form.pay_model === 'manual' && field('manual_amount', 'Manual agreed amount', 'number')}{field('wait_fee', 'Agreed wait fee', 'number')}{field('detention_fee', 'Agreed detention fee', 'number')}{field('other_fees', 'Other agreed fees', 'number')}</div>
    <Label htmlFor="dispatch-notes">Notes / requirements / stops</Label><Textarea id="dispatch-notes" value={form.notes} onChange={e => set('notes', e.target.value)} disabled={busy} />
    <p className="text-sm">Agreed pay: {(Math.round((pay.expectedGrossPay + Number.EPSILON) * 100) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} · {pay.totalOperatingMiles.toLocaleString()} operating miles</p>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {review && <div aria-label="Load review" className="space-y-2 border-l-2 border-primary pl-3 text-sm"><p>{drivers.find(d => d.relationship_id === form.relationship_id)?.display_name} · {form.load_reference}</p><p className="break-words">{form.pickup_location} → {form.dropoff_location}</p><p>Pickup {form.load_date} · scheduled delivery {form.dropoff_date || 'Not supplied'} · Pending</p><p className="whitespace-pre-wrap break-words">{form.notes}</p><Button disabled={!enabled || busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Confirm & save pending load'}</Button></div>}
    <div className="flex flex-wrap gap-2"><Button disabled={!enabled || busy} onClick={() => { const issue = validateDispatchForm(form); setError(issue); setReview(!issue); }}>Review load</Button><Button variant="outline" disabled={busy} onClick={close}>Close form</Button></div>
  </section>;
}