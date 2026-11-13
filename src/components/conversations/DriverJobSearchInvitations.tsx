import { useCallback, useEffect, useState } from 'react';
import { MailOpen, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { invitationsAvailable, listMyInvitations, respondToInvitation, type DriverInvitation } from '@/lib/jobSearch/jobSearchInvitationApi';

/** Renders nothing unless the server confirms the invitation backend is live. */
export function DriverJobSearchInvitations({ onOpenThread }: { onOpenThread: (threadId: string) => void }) {
  const [available, setAvailable] = useState(false);
  const [rows, setRows] = useState<DriverInvitation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setRows(await listMyInvitations()); setError(null); } catch { setError('Unable to load invitations.'); }
  }, []);
  useEffect(() => { let live = true; void invitationsAvailable().then(ok => { if (live) { setAvailable(ok); if (ok) void refresh(); } }); return () => { live = false; }; }, [refresh]);
  if (!available) return null;
  const act = async (inv: DriverInvitation, response: 'accept' | 'decline' | 'block') => {
    setBusy(inv.id); setError(null);
    try { const r = await respondToInvitation(inv.id, response); await refresh(); if (r.status === 'accepted' && r.thread_id) onOpenThread(r.thread_id); }
    catch { setError('That invitation could not be updated. It may have expired or closed.'); }
    finally { setBusy(null); }
  };
  return <section aria-label="Opportunity invitations" className="space-y-3">
    <h2 className="flex items-center gap-2 text-base font-bold"><MailOpen className="h-5 w-5 text-primary" aria-hidden="true" />Invitations</h2>
    <p className="text-xs text-muted-foreground">Recruiters only see your anonymous job-search card. Your name and contact stay private unless you accept.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {rows.length === 0 ? <p role="status" className="text-sm text-muted-foreground">No invitations yet.</p> : <ul className="space-y-3">
      {rows.map(inv => <li key={inv.id} className="premium-card space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 break-words font-semibold">{inv.opportunity_title}</p>
          <Badge variant="outline" className="capitalize">{inv.status}</Badge>
        </div>
        <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          {inv.company_name ?? 'Company'}
          {inv.verified && <span className="inline-flex items-center gap-1 text-primary"><ShieldCheck className="h-4 w-4" aria-hidden="true" />Verified recruiter</span>}
          {(inv.hiring_city || inv.hiring_state) && <span>· {[inv.hiring_city, inv.hiring_state].filter(Boolean).join(', ')}</span>}
          {inv.route_type && <span>· {inv.route_type}</span>}
        </p>
        <p className="whitespace-pre-wrap break-words text-sm">{inv.message}</p>
        {inv.status === 'pending' && <div className="flex flex-wrap gap-2 pt-1">
          <Button className="min-h-11" disabled={busy === inv.id || !inv.opportunity_open} onClick={() => void act(inv, 'accept')}>Accept and start conversation</Button>
          <Button variant="outline" className="min-h-11" disabled={busy === inv.id} onClick={() => void act(inv, 'decline')}>Decline</Button>
          <Button variant="ghost" className="min-h-11" disabled={busy === inv.id} onClick={() => void act(inv, 'block')}>Block this company</Button>
        </div>}
        {inv.status === 'accepted' && inv.thread_id && <Button variant="outline" className="min-h-11" onClick={() => onOpenThread(inv.thread_id!)}>Open conversation</Button>}
      </li>)}
    </ul>}
  </section>;
}
