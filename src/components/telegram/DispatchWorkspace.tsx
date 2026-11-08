import { useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { DispatchIntent, dispatchMiles, localDispatchDate, validDeliveryDate, type DispatchLoad } from '@/lib/dispatchWorkspace';
import { dispatchRpc, useDispatchWorkspace, type DispatchQuery } from '@/hooks/useDispatchWorkspace';
import { DispatchLoadForm } from './dispatch/DispatchLoadForm';

const money = (n: number | null) => n === null ? 'Not supplied' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const dateLabel = (date: string | null) => date ? `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}` : 'Not supplied';
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
    setFeedback('Load saved as pending.'); void workspace.refresh();
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
    finally { submitting.current = false; if (mounted.current && scope.current === activeScope) { setBusy(false); void workspace.refresh(); } }
  }
  const filter = (patch: Partial<DispatchQuery>) => setQuery(old => ({ ...old, ...patch, offset: 0 }));
  const page = workspace.page;
  const drivers = page?.drivers ?? [];
  return <section className="min-w-0 space-y-4 pb-4" aria-label="Dispatch workspace">
    <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-2xl font-bold">Dispatch</h1><div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Refresh dispatch" onClick={() => void workspace.refresh()} disabled={workspace.loading}><RefreshCw className="h-4 w-4" /></Button>{workspace.permissions.create && <Button disabled={!workspace.verified || workspace.loading} onClick={() => setAdd(true)}><Plus className="mr-1 h-4 w-4" />Add Load</Button>}</div></div>
    {feedback && <p role="status" className="break-words text-sm">{feedback}</p>}
    {workspace.error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{workspace.error}</p><Button variant="outline" onClick={() => void workspace.refresh()}>Retry</Button></div>}
    {workspace.loading && <p role="status" className="text-sm text-muted-foreground">Refreshing loads and permissions…</p>}
    {workspace.permissions.view && <>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor="dispatch-filter-driver">Driver</Label><Select value={query.relationship || 'all'} onValueChange={v => filter({ relationship: v === 'all' ? '' : v })}><SelectTrigger id="dispatch-filter-driver"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All connected drivers</SelectItem>{drivers.map(d => <SelectItem key={d.relationship_id} value={d.relationship_id}>{d.display_name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label htmlFor="dispatch-summary-date">Summary date</Label><Input id="dispatch-summary-date" type="date" value={query.date} onChange={e => { if (e.target.value) filter({ date: e.target.value }); }} /></div></div>
      {(page?.driver_total ?? 0) > 50 && <div className="flex items-center gap-2"><Button variant="outline" size="icon" aria-label="Previous drivers" disabled={query.driverOffset === 0} onClick={() => filter({ driverOffset: query.driverOffset - 50, relationship: '' })}><ChevronLeft className="h-4 w-4" /></Button><span className="text-xs">Drivers {query.driverOffset + 1}–{Math.min(query.driverOffset + 50, page?.driver_total ?? 0)}</span><Button variant="outline" size="icon" aria-label="Next drivers" disabled={query.driverOffset + 50 >= (page?.driver_total ?? 0)} onClick={() => filter({ driverOffset: query.driverOffset + 50, relationship: '' })}><ChevronRight className="h-4 w-4" /></Button></div>}
      {add && workspace.permissions.create && <DispatchLoadForm key={workspace.scope} drivers={drivers} enabled={workspace.verified && !workspace.loading} save={save} close={() => setAdd(false)} />}
      {!workspace.loading && page?.summaries.map(s => <section key={s.relationship_id} className="space-y-2 border-b border-border py-3"><h2 className="font-semibold">{s.display_name}</h2><div className="grid grid-cols-2 gap-3 text-sm"><p>Day · {s.daily_count} delivered<br /><span className="text-primary">{Number(s.daily_miles).toLocaleString()} mi</span></p><p>Week of {dateLabel(page.week_start)} · {s.weekly_count} delivered<br /><span className="text-primary">{Number(s.weekly_miles).toLocaleString()} mi</span></p><p>Completed · {s.completed_count} / {Number(s.completed_miles).toLocaleString()} mi</p><p>Active · {s.active_count} / {Number(s.active_miles).toLocaleString()} mi</p><p>Cancelled · {s.cancelled_count} / {Number(s.cancelled_miles).toLocaleString()} mi</p><p className="text-muted-foreground">Date unconfirmed · {s.unconfirmed_count} / {Number(s.unconfirmed_miles).toLocaleString()} mi</p></div></section>)}
      <div className="flex flex-wrap items-center gap-2"><Button variant={query.bucket === 'active' ? 'default' : 'outline'} onClick={() => filter({ bucket: 'active', status: '' })}>Active</Button><Button variant={query.bucket === 'history' ? 'default' : 'outline'} onClick={() => filter({ bucket: 'history', status: '' })}>History</Button><Select value={query.status || 'all'} onValueChange={v => filter({ status: v === 'all' ? '' : v })}><SelectTrigger aria-label="Load status" className="w-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{(query.bucket === 'active' ? ['pending', 'en_route'] : ['completed', 'cancelled']).map(s => <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>)}</SelectContent></Select></div>
      {!workspace.loading && page && page.loads.length === 0 && <p className="py-6 text-sm text-muted-foreground">{page.driver_total === 0 ? 'No active connected drivers.' : 'No loads match these filters.'}</p>}
      {!workspace.loading && page?.loads.map(load => <article key={load.id} className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h2 className="break-words font-semibold">{load.load_reference || 'Reference not supplied'}</h2><p className="break-words text-sm text-muted-foreground">{load.display_name}</p></div><span className="text-xs font-medium capitalize">{load.status.replace('_', ' ')}</span></div><p className="break-words text-sm">{load.pickup_location} → {load.dropoff_location}</p><p className="text-xs text-muted-foreground">Pickup {dateLabel(load.load_date)} · scheduled {dateLabel(load.dropoff_date)}</p>{load.status === 'completed' && <p className="text-xs">Actual delivery {load.actual_delivery_date ? dateLabel(load.actual_delivery_date) : 'Date unconfirmed'}</p>}<p className="text-sm">{dispatchMiles(load).toLocaleString()} operating miles · agreed {money(load.estimated_pay)}</p>{workspace.permissions.status && ['pending', 'en_route'].includes(load.status) && <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!workspace.verified || busy} onClick={() => { intent.current.clear(); setDelivery(''); setConfirm({ load, status: 'completed', scope: workspace.scope }); }}><Check className="mr-1 h-4 w-4" />Mark Delivered</Button><Button size="sm" variant="outline" disabled={!workspace.verified || busy} onClick={() => { intent.current.clear(); setConfirm({ load, status: 'cancelled', scope: workspace.scope }); }}><X className="mr-1 h-4 w-4" />Cancel Load</Button></div>}</article>)}
      {page && <div className="flex items-center justify-between gap-2"><Button size="icon" variant="outline" aria-label="Previous loads" disabled={query.offset === 0 || workspace.loading} onClick={() => setQuery(q => ({ ...q, offset: Math.max(0, q.offset - 25) }))}><ChevronLeft className="h-4 w-4" /></Button><span className="text-xs">{page.total === 0 ? '0' : `${query.offset + 1}–${Math.min(query.offset + 25, page.total)}`} of {page.total}</span><Button size="icon" variant="outline" aria-label="Next loads" disabled={query.offset + 25 >= page.total || workspace.loading} onClick={() => setQuery(q => ({ ...q, offset: q.offset + 25 }))}><ChevronRight className="h-4 w-4" /></Button></div>}
    </>}
    <AlertDialog open={!!confirm && confirm.scope === workspace.scope && workspace.permissions.status}>
      <AlertDialogContent className="max-h-[90dvh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg"><AlertDialogHeader><AlertDialogTitle>{confirm?.status === 'completed' ? 'Confirm delivery' : 'Confirm load cancellation'}</AlertDialogTitle><AlertDialogDescription className="break-words">{confirm?.load.load_reference} · {confirm?.load.display_name}{confirm?.status === 'cancelled' ? ' — cancel this load permanently?' : ' — enter the date delivery actually happened.'}</AlertDialogDescription></AlertDialogHeader>{confirm?.status === 'completed' && <div className="space-y-2"><Label htmlFor="actual-delivery">Actual delivery date</Label><Input id="actual-delivery" type="date" min={confirm.load.load_date} max={localDispatchDate()} value={delivery} disabled={busy} onChange={e => setDelivery(e.target.value)} /></div>}{feedback && <p role="alert" className="break-words text-sm text-destructive">{feedback}</p>}<AlertDialogFooter><Button variant="outline" disabled={busy} onClick={() => { setConfirm(null); intent.current.clear(); }}>Keep unchanged / Close</Button><Button disabled={!workspace.verified || busy} onClick={() => void update()}>{busy ? 'Confirming…' : confirm?.status === 'completed' ? 'Confirm Delivered' : 'Yes, cancel this load'}</Button></AlertDialogFooter></AlertDialogContent>
  </section>;
}