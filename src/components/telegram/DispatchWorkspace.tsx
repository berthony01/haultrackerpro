import { useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Check, X, ChevronLeft, ChevronRight, MapPin, ArrowDown, Truck, CalendarDays, AlertCircle, LoaderCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { DispatchIntent, dispatchMiles, localDispatchDate, validDeliveryDate, type DispatchLoad, type DispatchPage } from '@/lib/dispatchWorkspace';
import { dispatchRpc, useDispatchWorkspace, type DispatchQuery } from '@/hooks/useDispatchWorkspace';
import { DispatchLoadForm } from './dispatch/DispatchLoadForm';

const money = (n: number | null) => n === null ? 'Not supplied' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const dateLabel = (date: string | null) => date ? `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}` : 'Not supplied';
const number = (n: number) => Number(n).toLocaleString();
const loadWord = (n: number) => Number(n) === 1 ? 'load' : 'loads';

function DriverSummary({ summary: s, weekStart }: { summary: DispatchPage['summaries'][number]; weekStart: string }) {
  return <section className="dispatch-surface space-y-3" aria-label={`${s.display_name} delivery summary`}>
    <div className="flex items-center gap-2"><span className="dispatch-icon"><Truck className="h-4 w-4" /></span><h2 className="min-w-0 break-words font-semibold">{s.display_name}</h2></div>
    <div className="grid min-w-0 grid-cols-2 gap-3">
      <div className="dispatch-stat"><p className="dispatch-caption">Delivered today</p><p className="dispatch-stat-number">{s.daily_count}<span>{loadWord(s.daily_count)}</span></p><p className="dispatch-stat-detail">{number(s.daily_miles)} mi</p></div>
      <div className="dispatch-stat"><p className="dispatch-caption">This week</p><p className="dispatch-stat-number">{s.weekly_count}<span>{loadWord(s.weekly_count)}</span></p><p className="dispatch-stat-detail">{number(s.weekly_miles)} mi</p></div>
    </div>
    <details className="dispatch-other-totals"><summary>Other load totals<span className="dispatch-caption">Week of {dateLabel(weekStart)}</span></summary>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="dispatch-caption">Completed</dt><dd>{s.completed_count} {loadWord(s.completed_count)} · {number(s.completed_miles)} mi</dd></div>
        <div><dt className="dispatch-caption">Active</dt><dd>{s.active_count} {loadWord(s.active_count)} · {number(s.active_miles)} mi</dd></div>
        <div><dt className="dispatch-caption">Cancelled</dt><dd>{s.cancelled_count} {loadWord(s.cancelled_count)} · {number(s.cancelled_miles)} mi</dd></div>
        <div><dt className="dispatch-caption">Delivery date unconfirmed</dt><dd>{s.unconfirmed_count} {loadWord(s.unconfirmed_count)} · {number(s.unconfirmed_miles)} mi</dd></div>
      </dl>
    </details>
  </section>;
}

function LoadCard({ load, canUpdate, disabled, onStatus }: { load: DispatchLoad; canUpdate: boolean; disabled: boolean; onStatus: (load: DispatchLoad, status: 'completed' | 'cancelled') => void }) {
  return <article className="dispatch-load-card">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1"><p className="dispatch-caption">Load reference</p><h2 className="break-words text-lg font-bold tracking-tight">{load.load_reference || 'Reference not supplied'}</h2></div>
      <span className={`dispatch-status dispatch-status-${load.status}`}>{load.status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}<span className="capitalize">{load.status.replace('_', ' ')}</span></span>
    </div>
    <p className="flex items-center gap-2 text-sm font-medium text-slate-200"><Truck className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />{load.display_name}</p>
    <div className="dispatch-route">
      <div className="flex min-w-0 gap-3"><MapPin className="mt-1 h-4 w-4 shrink-0 text-orange-200" aria-hidden="true" /><div className="min-w-0"><p className="dispatch-caption">Pickup</p><p className="break-words font-semibold">{load.pickup_location}</p><p className="dispatch-caption">{dateLabel(load.load_date)}</p></div></div>
      <ArrowDown className="ml-0.5 h-3 w-3 text-slate-500" aria-hidden="true" />
      <div className="flex min-w-0 gap-3"><MapPin className="mt-1 h-4 w-4 shrink-0 text-sky-200" aria-hidden="true" /><div className="min-w-0"><p className="dispatch-caption">Delivery</p><p className="break-words font-semibold">{load.dropoff_location}</p><p className="dispatch-caption">Scheduled {dateLabel(load.dropoff_date)}</p></div></div>
    </div>
    {load.status === 'completed' && <p className="dispatch-delivery-date"><CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />Actual delivery: {load.actual_delivery_date ? dateLabel(load.actual_delivery_date) : 'Date unconfirmed'}</p>}
    <div className="grid min-w-0 grid-cols-2 gap-3"><div className="dispatch-load-metric"><p className="dispatch-caption">Operating miles</p><p>{number(dispatchMiles(load))}<span> mi</span></p></div><div className="dispatch-load-metric"><p className="dispatch-caption">Agreed pay</p><p className="text-orange-200">{money(load.estimated_pay)}</p></div></div>
    {canUpdate && ['pending', 'en_route'].includes(load.status) && <div className="dispatch-load-actions"><Button className="dispatch-confirm" disabled={disabled} onClick={() => onStatus(load, 'completed')}><Check className="h-4 w-4" />Mark Delivered</Button><Button variant="outline" className="dispatch-danger" disabled={disabled} onClick={() => onStatus(load, 'cancelled')}><X className="h-4 w-4" />Cancel Load</Button></div>}
  </article>;
}

export function DispatchWorkspace({ recruiterId }: { recruiterId: string }) {
  const [query, setQuery] = useState<DispatchQuery>({ relationship: '', bucket: 'active', status: '', offset: 0, date: localDispatchDate(), driverOffset: 0 });
  const workspace = useDispatchWorkspace(recruiterId, query);
  const [add, setAdd] = useState(false);
  const [confirm, setConfirm] = useState<{ load: DispatchLoad; status: 'completed' | 'cancelled'; scope: string } | null>(null);
  const [delivery, setDelivery] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const intent = useRef(new DispatchIntent()); const submitting = useRef(false);
  const mounted = useRef(true); const scope = useRef(workspace.scope); scope.current = workspace.scope;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!workspace.permissions.create) setAdd(false); if (!workspace.permissions.status) setConfirm(null); }, [workspace.permissions.create, workspace.permissions.status]);
  const activeScope = workspace.scope;
  async function save(key: string, payload: Record<string, unknown>) {
    if (!workspace.verified || !workspace.permissions.create) throw new Error('Dispatch permission must be refreshed before saving.');
    const result = await dispatchRpc('dispatch_mini_create', { _recruiter_id: recruiterId, _relationship_id: payload.relationship_id, _idempotency_key: key, _payload: payload });
    if (!mounted.current || scope.current !== activeScope) throw new Error('The workspace changed. Reopen Dispatch to check the result.');
    if (result.error || !(result.data as { id?: string } | null)?.id) throw new Error('Save was not confirmed. Retry exactly the same details; no success is assumed.');
    setFeedback('Load saved as pending.'); void workspace.refresh(true);
  }
  function startStatus(load: DispatchLoad, status: 'completed' | 'cancelled') {
    if (!workspace.verified || !workspace.permissions.status) return;
    intent.current.clear(); setDelivery(''); setFeedback(null); setConfirm({ load, status, scope: workspace.scope });
  }
  async function update() {
    if (!confirm || confirm.scope !== workspace.scope || !workspace.verified || !workspace.permissions.status || submitting.current) return;
    if (confirm.status === 'completed' && !validDeliveryDate(delivery, confirm.load.load_date)) { setFeedback('Enter the actual delivery date, no earlier than pickup and not in the future.'); return; }
    const payload = { relationship: confirm.load.relationship_id, load: confirm.load.id, expected: confirm.load.status, status: confirm.status, delivery: confirm.status === 'completed' ? delivery : null };
    submitting.current = true; setBusy(true); setFeedback(null);
    try {
      const key = intent.current.begin(payload);
      const result = await dispatchRpc('dispatch_mini_status', { _recruiter_id: recruiterId, _relationship_id: payload.relationship, _load_id: payload.load, _expected_status: payload.expected, _new_status: payload.status, _actual_delivery_date: payload.delivery, _local_today: localDispatchDate(), _idempotency_key: key });
      if (!mounted.current || scope.current !== activeScope) return;
      if (result.error || !(result.data as { id?: string } | null)?.id) throw new Error('Status was not confirmed. Refresh and retry the same confirmation if needed.');
      intent.current.clear(); setConfirm(null); setFeedback(payload.status === 'completed' ? 'Delivery confirmed.' : 'Cancellation confirmed.');
    } catch (e) { if (mounted.current && scope.current === activeScope) setFeedback(e instanceof Error ? e.message : 'The status change could not be confirmed.'); }
    finally { submitting.current = false; if (mounted.current && scope.current === activeScope) { setBusy(false); void workspace.refresh(true); } }
  }
  const filter = (patch: Partial<DispatchQuery>) => setQuery(old => ({ ...old, ...patch, offset: 0 }));
  const page = workspace.page;
  const drivers = page?.drivers ?? [];
  return <section className="dispatch-workspace min-w-0 space-y-4 pb-4" aria-label="Dispatch workspace">
    <div className="space-y-4"><div><p className="dispatch-eyebrow">Your dispatch desk</p><h1 className="text-3xl font-bold tracking-tight">Dispatch</h1><p className="mt-1 text-sm text-slate-300">Assign loads. Confirm deliveries. Keep drivers moving.</p></div>
      <div className="flex gap-2">{workspace.permissions.create && <Button className="dispatch-primary min-w-0 flex-1" disabled={!workspace.verified || workspace.loading} onClick={() => setAdd(true)}><Plus className="h-5 w-5" />Add Load</Button>}<Button variant="outline" className="dispatch-secondary" aria-label="Refresh dispatch" onClick={() => void workspace.refresh()} disabled={workspace.loading}><RefreshCw className={`h-4 w-4 ${workspace.loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />Refresh</Button></div>
    </div>
    <div className="dispatch-sync-line" role="status" aria-live="polite">{workspace.loading ? <><LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />{page ? 'Updating loads and checking access…' : 'Loading loads and checking access…'}</> : workspace.error ? 'Updates paused. Check the message below.' : <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />Loads are up to date</>}</div>
    {feedback && !confirm && <p role="status" className="dispatch-feedback"><CheckCircle2 className="h-4 w-4 shrink-0" />{feedback}</p>}
    {workspace.error && <div role="alert" className="dispatch-error"><div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>{workspace.error}</p></div><Button className="dispatch-secondary mt-3" variant="outline" onClick={() => void workspace.refresh()}>Retry</Button></div>}
    {workspace.permissions.view && <>
      <div className="dispatch-surface space-y-3"><div className="grid min-w-0 gap-3 sm:grid-cols-2"><div className="space-y-2"><Label className="dispatch-label" htmlFor="dispatch-filter-driver">Driver</Label><Select value={query.relationship || 'all'} onValueChange={v => filter({ relationship: v === 'all' ? '' : v })}><SelectTrigger className="dispatch-field" id="dispatch-filter-driver"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All connected drivers</SelectItem>{drivers.map(d => <SelectItem key={d.relationship_id} value={d.relationship_id}>{d.display_name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label className="dispatch-label" htmlFor="dispatch-summary-date">Summary date</Label><Input className="dispatch-field" id="dispatch-summary-date" type="date" value={query.date} onChange={e => { if (e.target.value) filter({ date: e.target.value }); }} /></div></div></div>
      {(page?.driver_total ?? 0) > 50 && <div className="flex items-center gap-2"><Button className="dispatch-secondary" variant="outline" size="icon" aria-label="Previous drivers" disabled={query.driverOffset === 0} onClick={() => filter({ driverOffset: query.driverOffset - 50, relationship: '' })}><ChevronLeft className="h-4 w-4" /></Button><span className="text-xs">Drivers {query.driverOffset + 1}–{Math.min(query.driverOffset + 50, page?.driver_total ?? 0)}</span><Button className="dispatch-secondary" variant="outline" size="icon" aria-label="Next drivers" disabled={query.driverOffset + 50 >= (page?.driver_total ?? 0)} onClick={() => filter({ driverOffset: query.driverOffset + 50, relationship: '' })}><ChevronRight className="h-4 w-4" /></Button></div>}
      {add && workspace.permissions.create && <div hidden={!!workspace.error}><DispatchLoadForm key={workspace.scope} drivers={drivers} enabled={workspace.verified && !workspace.loading} save={save} close={() => setAdd(false)} /></div>}
      {page?.summaries.map(s => <DriverSummary key={s.relationship_id} summary={s} weekStart={page.week_start} />)}
      <div className="space-y-3"><div className="dispatch-view-switch" aria-label="Load lists"><Button className="dispatch-view-toggle" variant="ghost" aria-pressed={query.bucket === 'active'} onClick={() => filter({ bucket: 'active', status: '' })}>Active</Button><Button className="dispatch-view-toggle" variant="ghost" aria-pressed={query.bucket === 'history'} onClick={() => filter({ bucket: 'history', status: '' })}>History</Button></div><Select value={query.status || 'all'} onValueChange={v => filter({ status: v === 'all' ? '' : v })}><SelectTrigger aria-label="Load status" className="dispatch-field w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{(query.bucket === 'active' ? ['pending', 'en_route'] : ['completed', 'cancelled']).map(s => <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>)}</SelectContent></Select></div>
      <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-bold">{query.bucket === 'active' ? 'Active loads' : 'Load history'}</h2>{page && <span className="dispatch-count">{page.total} {loadWord(page.total)}</span>}</div>
      {workspace.loading && !page && <div className="dispatch-surface space-y-3" aria-label="Loading dispatch loads"><div className="h-4 w-1/2 rounded bg-slate-700/60" /><div className="h-20 rounded-xl bg-slate-800/70" /><p className="dispatch-caption">Your loads will appear here.</p></div>}
      {page && page.loads.length === 0 && <div className="dispatch-surface py-7 text-center"><Truck className="mx-auto mb-3 h-7 w-7 text-slate-400" /><p className="font-semibold">{page.driver_total === 0 ? 'No active connected drivers.' : 'No loads match these filters.'}</p><p className="dispatch-caption mt-2">{page.driver_total === 0 ? 'Connect a driver from your workspace on HaulTrackerPro.com.' : query.bucket === 'active' ? 'New loads start here as Pending.' : 'Delivered and cancelled loads appear in History.'}</p></div>}
      {page?.loads.map(load => <LoadCard key={load.id} load={load} canUpdate={workspace.permissions.status} disabled={!workspace.verified || busy} onStatus={startStatus} />)}
      {page && <div className="flex items-center justify-between gap-2"><Button className="dispatch-secondary" size="icon" variant="outline" aria-label="Previous loads" disabled={query.offset === 0 || workspace.loading} onClick={() => setQuery(q => ({ ...q, offset: Math.max(0, q.offset - 25) }))}><ChevronLeft className="h-4 w-4" /></Button><span className="text-sm text-slate-300">{page.total === 0 ? '0' : `${query.offset + 1}–${Math.min(query.offset + 25, page.total)}`} of {page.total}</span><Button className="dispatch-secondary" size="icon" variant="outline" aria-label="Next loads" disabled={query.offset + 25 >= page.total || workspace.loading} onClick={() => setQuery(q => ({ ...q, offset: q.offset + 25 }))}><ChevronRight className="h-4 w-4" /></Button></div>}
    </>}
    <AlertDialog open={!!confirm && confirm.scope === workspace.scope && workspace.permissions.status && !workspace.error}>
      <AlertDialogContent className="dispatch-dialog max-h-[90dvh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg"><AlertDialogHeader><AlertDialogTitle className="text-xl">{confirm?.status === 'completed' ? 'Confirm delivery' : 'Confirm load cancellation'}</AlertDialogTitle><AlertDialogDescription className="break-words text-slate-300">{confirm?.load.load_reference} · {confirm?.load.display_name}{confirm?.status === 'cancelled' ? '. This removes the load from Active. Confirm only if the load is cancelled.' : '. Enter the date delivery actually happened.'}</AlertDialogDescription></AlertDialogHeader>{confirm?.status === 'completed' && <div className="space-y-2"><Label className="dispatch-label" htmlFor="actual-delivery">Actual delivery date</Label><Input className="dispatch-field" id="actual-delivery" type="date" min={confirm.load.load_date} max={localDispatchDate()} value={delivery} disabled={busy} onChange={e => { setDelivery(e.target.value); setFeedback(null); }} /></div>}{feedback && <p role="alert" className="dispatch-error">{feedback}</p>}<AlertDialogFooter className="gap-2"><Button className="dispatch-secondary" variant="outline" disabled={busy} onClick={() => { setConfirm(null); intent.current.clear(); }}>Keep unchanged / Close</Button><Button className={confirm?.status === 'completed' ? 'dispatch-confirm' : 'dispatch-danger'} disabled={!workspace.verified || busy} onClick={() => void update()}>{busy ? 'Confirming…' : confirm?.status === 'completed' ? 'Confirm Delivered' : 'Yes, cancel this load'}</Button></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </section>;
}
