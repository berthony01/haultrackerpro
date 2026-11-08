import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, ClipboardPaste, FileCheck2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DispatchIntent, dispatchAgreedCents, dispatchPay, dispatchPayload, emptyDispatchForm, parseDispatchForm, validateDispatchForm, type DispatchDriver, type DispatchForm } from '@/lib/dispatchWorkspace';

function FormSection({ step, title, description, children }: { step: number; title: string; description?: string; children: ReactNode }) {
  return <fieldset className="dispatch-form-section"><legend><span className="dispatch-step">{step}</span>{title}</legend>{description && <p className="dispatch-caption mb-4">{description}</p>}<div className="space-y-4">{children}</div></fieldset>;
}

export function DispatchLoadForm({ drivers, enabled, save, close }: { drivers: DispatchDriver[]; enabled: boolean; save: (key: string, payload: Record<string, unknown>) => Promise<void>; close: () => void }) {
  const [form, setForm] = useState(emptyDispatchForm);
  const [source, setSource] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const intent = useRef(new DispatchIntent()); const submitting = useRef(false);
  const set = (key: keyof DispatchForm, value: string) => { setForm(old => ({ ...old, [key]: value })); setReview(false); };
  const pay = dispatchPay(form);
  let agreedPay: string;
  try { agreedPay = (dispatchAgreedCents(form) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
  catch { agreedPay = 'Check pay details'; }
  useEffect(() => { if (review) { reviewRef.current?.focus({ preventScroll: true }); reviewRef.current?.scrollIntoView?.({ block: 'nearest' }); } }, [review]);
  async function submit() {
    if (!enabled || submitting.current) return;
    const issue = validateDispatchForm(form); if (issue) { setError(issue); return; }
    if (!drivers.some(driver => driver.relationship_id === form.relationship_id)) { setError('Select a currently connected driver before saving.'); return; }
    submitting.current = true; setBusy(true); setError(null);
    try { const payload = dispatchPayload(form); await save(intent.current.begin(payload), payload); intent.current.clear(); close(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Save could not be confirmed. Retry the same details.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  const field = (key: keyof DispatchForm, label: string, type = 'text', required = false, hint?: string) => <div className="min-w-0 space-y-2" key={key}><Label className="dispatch-label" htmlFor={`dispatch-${key}`}>{label}</Label><Input className="dispatch-field" id={`dispatch-${key}`} type={type} value={form[key]} aria-required={required || undefined} aria-describedby={hint ? `dispatch-${key}-hint` : undefined} onChange={e => set(key, e.target.value)} disabled={busy} {...(type === 'number' ? { min: 0, step: 'any', inputMode: 'decimal' as const } : {})} />{hint && <p id={`dispatch-${key}-hint`} className="dispatch-caption">{hint}</p>}</div>;
  return <section aria-label="Add dispatch load" className="dispatch-load-form dispatch-surface space-y-5">
    <div><p className="dispatch-eyebrow">New assignment</p><h2 className="mt-1 text-2xl font-bold">Add a load</h2><p className="mt-2 text-sm text-slate-300">Paste your dispatch details or enter them below. Check everything before saving.</p></div>
    <div className="dispatch-paste-panel space-y-3"><Label className="dispatch-label flex items-center gap-2" htmlFor="dispatch-source"><ClipboardPaste className="h-4 w-4" aria-hidden="true" />Paste dispatch details</Label><Textarea className="dispatch-field min-h-28" id="dispatch-source" rows={4} placeholder="Paste the load reference, pickup, delivery, miles and agreed pay…" value={source} onChange={e => setSource(e.target.value)} disabled={busy} /><Button className="dispatch-secondary w-full" variant="outline" disabled={!source.trim() || busy} onClick={() => { const result = parseDispatchForm(source, form); setForm(result.form); setWarnings(result.warnings); setReview(false); setError(null); }}>Extract for review</Button><p className="dispatch-caption">Extraction fills what it can identify. You can correct every field.</p></div>
    {warnings.length > 0 && <div className="dispatch-review-warnings"><p className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4 shrink-0" />Check the extracted details</p><ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
    <FormSection step={1} title="Driver & reference" description="Choose the connected driver who will receive this load.">
      <div className="space-y-2"><Label className="dispatch-label" htmlFor="dispatch-driver">Connected driver</Label><Select value={form.relationship_id || 'none'} onValueChange={v => set('relationship_id', v === 'none' ? '' : v)} disabled={busy}><SelectTrigger className="dispatch-field" id="dispatch-driver" aria-required="true"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Select driver</SelectItem>{drivers.map(d => <SelectItem value={d.relationship_id} key={d.relationship_id}>{d.display_name}</SelectItem>)}</SelectContent></Select></div>
      {field('load_reference', 'Load reference', 'text', true, 'Use the dispatch reference, such as LOAD1234. It must be unique in this workspace.')}
    </FormSection>
    <FormSection step={2} title="Pickup & delivery">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{field('pickup_location', 'Pickup location', 'text', true)}{field('dropoff_location', 'Delivery location', 'text', true)}{field('load_date', 'Pickup date', 'date', true)}{field('dropoff_date', 'Scheduled delivery date', 'date', false, 'Optional. The actual delivery date is confirmed when the load is delivered.')}</div>
    </FormSection>
    <FormSection step={3} title="Miles" description="Enter loaded and empty miles separately.">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{field('loaded_miles', 'Loaded miles', 'number')}{field('deadhead_miles', 'Deadhead miles', 'number')}{field('total_miles', 'Total operating miles', 'number', false, 'Optional. If supplied, this should match loaded plus deadhead miles.')}</div>
    </FormSection>
    <FormSection step={4} title="Agreed pay" description="Use the amount or rates agreed for this load.">
      <div className="space-y-2"><Label className="dispatch-label" htmlFor="dispatch-pay-model">Pay model</Label><Select value={form.pay_model} onValueChange={v => set('pay_model', v)} disabled={busy}><SelectTrigger className="dispatch-field" id="dispatch-pay-model"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="loaded_miles_only">Loaded miles only</SelectItem><SelectItem value="total_miles">Total miles paid</SelectItem><SelectItem value="loaded_plus_deadhead">Loaded + deadhead pay</SelectItem><SelectItem value="flat_rate">Flat rate</SelectItem><SelectItem value="manual">Manual agreed amount</SelectItem></SelectContent></Select></div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{(['loaded_miles_only', 'total_miles', 'loaded_plus_deadhead'].includes(form.pay_model)) && field('rate_per_mile', 'Agreed rate per mile', 'number', true)}{form.pay_model === 'loaded_plus_deadhead' && field('deadhead_rate_per_mile', 'Deadhead rate per mile', 'number', true)}{form.pay_model === 'flat_rate' && field('flat_rate_amount', 'Flat agreed amount', 'number', true)}{form.pay_model === 'manual' && field('manual_amount', 'Manual agreed amount', 'number', true)}</div>
      <details className="dispatch-extra-fees"><summary>Additional agreed fees<span className="dispatch-caption">Optional</span></summary><div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">{field('wait_fee', 'Agreed wait fee', 'number')}{field('detention_fee', 'Agreed detention fee', 'number')}{field('other_fees', 'Other agreed fees', 'number')}</div></details>
      <div className="dispatch-pay-preview"><div><p className="dispatch-caption">Agreed pay</p><p className="text-2xl font-bold text-orange-200">{agreedPay}</p></div><div className="text-right"><p className="dispatch-caption">Operating miles</p><p className="text-xl font-semibold">{pay.totalOperatingMiles.toLocaleString()}<span className="text-sm text-slate-300"> mi</span></p></div></div>
    </FormSection>
    <div className="space-y-2"><Label className="dispatch-label" htmlFor="dispatch-notes">Notes / requirements / stops</Label><Textarea className="dispatch-field min-h-24" id="dispatch-notes" rows={4} value={form.notes} onChange={e => set('notes', e.target.value)} disabled={busy} /><p className="dispatch-caption">Keep appointments, requirements and extra stops here. The original dispatch text is preserved for review.</p></div>
    {error && <p role="alert" className="dispatch-error flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
    {review && <div aria-label="Load review" ref={reviewRef} tabIndex={-1} className="dispatch-load-review space-y-4"><div className="flex items-center gap-2"><FileCheck2 className="h-5 w-5 text-orange-200" /><h3 className="text-lg font-bold">Review before saving</h3></div><div><p className="font-bold">{form.load_reference}</p><p className="mt-1 text-sm text-slate-200">{drivers.find(d => d.relationship_id === form.relationship_id)?.display_name}</p></div><div className="space-y-2 text-sm"><p className="break-words"><span className="dispatch-caption">Pickup: </span>{form.pickup_location} · {form.load_date}</p><p className="break-words"><span className="dispatch-caption">Delivery: </span>{form.dropoff_location} · {form.dropoff_date || 'Not supplied'}</p></div><p className="text-lg font-bold text-orange-200">{agreedPay}<span className="ml-2 text-sm font-normal text-slate-200">· {pay.totalOperatingMiles.toLocaleString()} mi</span></p><p className="text-sm text-slate-300">This load will be saved as Pending. Delivery is confirmed separately.</p>{form.notes && <details className="text-sm"><summary className="cursor-pointer text-slate-200">Notes and original dispatch text</summary><p className="mt-3 whitespace-pre-wrap break-words text-slate-300">{form.notes}</p></details>}<Button className="dispatch-primary w-full" disabled={!enabled || busy} onClick={() => void submit()}><CheckCircle2 className="h-4 w-4" />{busy ? 'Saving…' : 'Confirm & save pending load'}</Button></div>}
    <div className="dispatch-form-footer"><Button className="dispatch-secondary" variant="outline" disabled={busy} onClick={close}><X className="h-4 w-4" />Close form</Button><Button className="dispatch-primary" disabled={!enabled || busy} onClick={() => { const issue = validateDispatchForm(form); setError(issue); setReview(!issue); }}><FileCheck2 className="h-4 w-4" />Review load</Button></div>
    <p className="dispatch-caption" style={{ minHeight: 36 }} aria-live="polite">{busy ? 'Saving this load…' : !enabled ? 'Checking workspace access. Your entered details stay in this form.' : 'Review the details, then confirm to save this load as Pending.'}</p>
  </section>;
}
