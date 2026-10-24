import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShieldCheck, RefreshCw, Pause, Ban } from 'lucide-react';
import { CDL_CLASS_CHOICES, DRIVER_TYPE_CHOICES, HOME_TIME_CHOICES, ROUTE_TYPE_CHOICES, TRAILER_CHOICES } from '@/lib/home/conversationIntake';
import { JOB_SEARCH_STATES, buildJobSearchCardReview, type JobSearchCardPayload } from '@/lib/jobSearch/jobSearchCardContract';
import { consumeJobSearchCardHandoff, type CardSeed } from '@/lib/jobSearch/jobSearchCardHandoff';
import { useCardScope, useJobSearchCard, type CardScope, type OwnCardState } from '@/hooks/jobSearch/useJobSearchCard';

export const CARD_ERRORS = {
  unavailable: 'Job-search cards are not available right now.',
  denied: 'This action is not available for your current account.',
  stale: 'The card changed. Your draft is preserved. Review the latest status before trying again.',
  no_card: 'No card was withdrawn. Refresh and try again if a card appears.',
  invalid: 'Please check your card and try again.',
  unknown: 'The result is unknown. Retry the same request to check its outcome.',
};
export default function DriverJobSearchCard() {
  const scope = useCardScope();
  if (!scope.personal || !scope.key) return <p role="status" className="text-muted-foreground">{scope.loading ? 'Loading…' : 'Job-search card management is unavailable in this account context.'}</p>;
  return <ConnectedDriverCard key={scope.key} scope={scope} />;
}
function ConnectedDriverCard({ scope }: { scope: CardScope }) {
  const state = useJobSearchCard(scope);
  const [seed] = useState(() => consumeJobSearchCardHandoff(scope.owner ?? ''));
  return <DriverJobSearchCardView state={state} canPublish={scope.canPublish} seed={seed ?? undefined} />;
}
type Draft = { state: string; cdl_class: string; years_experience: string; experience_qualifier: string; preferred_route_type: string; preferred_home_time: string; preferred_driver_type: string; trailer_experience: string[]; available_start_date: string; min_weekly_gross: string; includeGross: boolean };
function draftFrom(p?: CardSeed | JobSearchCardPayload): Draft {
  return { state: p?.state ?? '', cdl_class: p?.cdl_class ?? '', years_experience: p?.years_experience === undefined ? '' : String(p.years_experience), experience_qualifier: '', preferred_route_type: p?.preferred_route_type ?? '', preferred_home_time: p?.preferred_home_time ?? '', preferred_driver_type: p?.preferred_driver_type ?? '', trailer_experience: [...p?.trailer_experience ?? []], available_start_date: '', min_weekly_gross: '', includeGross: false };
}
function payloadFrom(d: Draft): JobSearchCardPayload {
  if (!d.years_experience.trim() || !d.experience_qualifier) throw new RangeError('Explicit experience required');
  return buildJobSearchCardReview({ state: d.state, cdl_class: d.cdl_class, years_experience: Number(d.years_experience), experience_qualifier: d.experience_qualifier, preferred_route_type: d.preferred_route_type, preferred_home_time: d.preferred_home_time,
    ...(d.preferred_driver_type ? { preferred_driver_type: d.preferred_driver_type } : {}),
    ...(d.trailer_experience.length ? { trailer_experience: d.trailer_experience } : {}),
    ...(d.available_start_date ? { available_start_date: d.available_start_date } : {}),
    ...(d.includeGross ? { min_weekly_gross: Number(d.min_weekly_gross) } : {}),
  }).payload;
}
export function EmploymentCardDetails({ payload }: { payload: JobSearchCardPayload }) {
  const review = buildJobSearchCardReview(payload);
  return <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
    {Object.entries({ State: payload.state, CDL: `Class ${payload.cdl_class}`, Experience: review.experience, Routes: payload.preferred_route_type, 'Home time': payload.preferred_home_time, ...(payload.preferred_driver_type ? { 'Driver type': payload.preferred_driver_type } : {}), ...(payload.trailer_experience?.length ? { Trailers: payload.trailer_experience.join(', ') } : {}), ...(payload.available_start_date ? { 'Start date': new Date(`${payload.available_start_date}T12:00:00`).toLocaleDateString('en-US') } : {}), ...(payload.min_weekly_gross ? { 'Weekly gross goal': `$${payload.min_weekly_gross.toLocaleString('en-US')}` } : {}) }).map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-muted-foreground">{k}</dt><dd className="break-words font-medium">{v}</dd></div>)}
  </dl>;
}
export function DriverJobSearchCardView({ state, canPublish, seed }: { state: OwnCardState; canPublish: boolean; seed?: CardSeed }) {
  const [draft, setDraft] = useState(() => draftFrom(seed));
  const [editing, setEditing] = useState(Boolean(seed));
  const [review, setReview] = useState<JobSearchCardPayload | null>(null);
  const [consent, setConsent] = useState(false);
  const [dirty, setDirty] = useState(Boolean(seed));
  const [validity, setValidity] = useState(false);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  const version = state.card ? `${state.card.id}:${state.card.revision}` : 'none';
  useEffect(() => { setReview(null); setConsent(false); }, [version, canPublish]);
  useEffect(() => { if (review) reviewRef.current?.focus(); }, [review]);
  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    if (state.uncertain || state.busy) return;
    setDraft(d => ({ ...d, [key]: value })); setDirty(true); setReview(null); setConsent(false); setValidity(false);
  }
  const blocked = state.busy || !state.ready || state.error === 'unavailable' || state.uncertain;
  async function lifecycle(action: 'pause' | 'withdraw') {
    setReview(null); setConsent(false);
    await state.submit({ action, revision: state.card?.revision ?? 0, commandId: crypto.randomUUID() });
  }
  async function publish() {
    if (!review || !consent || blocked || !canPublish) return;
    const success = await state.submit({ action: 'publish', revision: state.card?.revision ?? 0, commandId: crypto.randomUUID(), payload: review });
    setReview(null); setConsent(false);
    if (success) { setEditing(false); setDirty(false); }
  }
  const snapshotStatus = state.card?.status === 'published' && Date.parse(state.card.expires_at) <= Date.now() ? 'expired' : state.card?.status;
  return <section className="min-w-0 space-y-6 text-foreground" aria-label="My job-search card">
    <header className="space-y-2"><ShieldCheck className="h-7 w-7 text-primary" /><h1 className="text-2xl font-bold">My job-search card</h1>
      <p className="text-sm text-muted-foreground">This card contains no name, phone or email. Publishing this card does not change your work-profile/contact sharing settings.</p>
    </header>
    <div className="flex flex-wrap items-center gap-3"><strong className="capitalize" role="status">{state.uncertain ? 'Outcome not confirmed' : state.ready ? snapshotStatus ?? 'No published card' : 'Status not confirmed'}</strong>
      <Button variant="outline" size="sm" disabled={state.busy} onClick={() => void state.refresh()}><RefreshCw className="mr-2 h-4 w-4" />Refresh status</Button></div>
    {state.error && <p role="alert" className="text-sm text-muted-foreground">{CARD_ERRORS[state.error]}</p>}
    {state.uncertain && <Button disabled={state.busy} onClick={() => void state.retry()}>Retry same request</Button>}
    {state.card && <div className="space-y-4 border-y border-border py-4"><EmploymentCardDetails payload={state.card.payload} /><p className="text-sm text-muted-foreground">Expires {new Date(state.card.expires_at).toLocaleDateString('en-US')}. Audience: approved recruiters.</p></div>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={!canPublish || blocked} onClick={() => { if (!dirty) setDraft(draftFrom(state.card?.payload)); setEditing(true); setReview(null); setConsent(false); }}>{state.card ? 'Edit / review renewal' : 'Create card'}</Button>
      {state.card && <><Button variant="outline" disabled={blocked} onClick={() => void lifecycle('pause')}><Pause className="mr-2 h-4 w-4" />Pause</Button><Button variant="outline" disabled={blocked} onClick={() => void lifecycle('withdraw')}><Ban className="mr-2 h-4 w-4" />Withdraw</Button></>}
    </div>
    {!canPublish && <p className="text-sm text-muted-foreground">You can still read and withdraw your own card. An active personal Driver account is required to publish.</p>}
    {editing && canPublish && <form className="space-y-5" onSubmit={e => { e.preventDefault(); try { setReview(payloadFrom(draft)); setConsent(false); setValidity(false); } catch { setValidity(true); } }}>
      <fieldset disabled={blocked} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Choice label="State" value={draft.state} options={JOB_SEARCH_STATES} onChange={v => change('state', v)} />
        <Choice label="CDL class" value={draft.cdl_class} options={CDL_CLASS_CHOICES} onChange={v => change('cdl_class', v)} />
        <div className="space-y-2"><Label htmlFor="card-years">Years of experience</Label><Input id="card-years" type="number" min={0} max={60} step={1} required value={draft.years_experience} onChange={e => change('years_experience', e.target.value)} /></div>
        <Choice label="Experience qualifier" value={draft.experience_qualifier} options={['exact', 'at_least', 'less_than']} labels={['Exactly', 'At least', 'Less than']} onChange={v => change('experience_qualifier', v)} />
        <Choice label="Route type" value={draft.preferred_route_type} options={ROUTE_TYPE_CHOICES} onChange={v => change('preferred_route_type', v)} />
        <Choice label="Home time" value={draft.preferred_home_time} options={HOME_TIME_CHOICES} onChange={v => change('preferred_home_time', v)} />
        <Choice label="Driver type (optional)" value={draft.preferred_driver_type} options={DRIVER_TYPE_CHOICES} optional onChange={v => change('preferred_driver_type', v)} />
        <div className="space-y-2"><Label htmlFor="card-start">Start date (optional)</Label><Input id="card-start" type="date" value={draft.available_start_date} onChange={e => change('available_start_date', e.target.value)} /></div>
        <div className="space-y-3 sm:col-span-2"><Label>Trailer experience (optional)</Label><div className="flex flex-wrap gap-4">{TRAILER_CHOICES.map(t => <label key={t} className="flex items-center gap-2 text-sm"><Checkbox checked={draft.trailer_experience.includes(t)} onCheckedChange={checked => change('trailer_experience', checked === true ? [...draft.trailer_experience, t] : draft.trailer_experience.filter(v => v !== t))} />{t}</label>)}</div></div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.includeGross} onCheckedChange={v => change('includeGross', v === true)} />Include weekly gross goal</label>
        {draft.includeGross && <div className="space-y-2"><Label htmlFor="card-gross">Weekly gross goal</Label><Input id="card-gross" type="number" min="0.01" max={100000} step="any" required value={draft.min_weekly_gross} onChange={e => change('min_weekly_gross', e.target.value)} /></div>}
      </fieldset>
      {validity && <p role="alert" className="text-sm text-destructive">Choose each required field and explicitly confirm your experience qualifier.</p>}
      <Button type="submit" variant="outline" disabled={blocked}>Review exact card</Button>
    </form>}
    {review && canPublish && <div className="space-y-4 border-t border-border pt-5"><h2 ref={reviewRef} tabIndex={-1} className="text-lg font-semibold">Review before sharing</h2><EmploymentCardDetails payload={review} />
      <p className="text-sm text-muted-foreground">Shared with approved recruiters for 14 days from publication. No contact details are included.</p>
      <label className="flex items-start gap-3 text-sm"><Checkbox checked={consent} disabled={blocked} onCheckedChange={v => setConsent(v === true)} /><span>I choose to share this exact job-search card with approved recruiters.</span></label>
      <Button className="h-auto min-h-11 w-full whitespace-normal py-3" disabled={blocked || !consent} onClick={() => void publish()}>Make me available to approved recruiters</Button>
    </div>}
  </section>;
}
function Choice({ label, value, options, labels, onChange, optional }: { label: string; value: string; options: readonly string[]; labels?: string[]; onChange: (v: string) => void; optional?: boolean }) {
  return <div className="min-w-0 space-y-2"><Label>{label}</Label><Select value={value || 'none'} onValueChange={v => onChange(v === 'none' ? '' : v)}><SelectTrigger aria-label={label} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{optional ? 'Not included' : 'Choose…'}</SelectItem>{options.map((o, i) => <SelectItem key={o} value={o}>{labels?.[i] ?? o}</SelectItem>)}</SelectContent></Select></div>;
}
