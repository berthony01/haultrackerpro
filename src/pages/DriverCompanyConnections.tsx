import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Building2, MailCheck, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { COMPANY_CONNECTION_CONSENT } from '@/components/dispatch/CompanyDriverConnectionsPanel';
import { useActingContext } from '@/hooks/useActingContext';
import {
  useCompanyConnectionAction, useCompanyDriverConnections, type CompanyDriverConnection,
} from '@/hooks/useCompanyDriverConnections';
import { useViewMode } from '@/hooks/useViewMode';
import {
  useAcceptMyCarrierDriverRelationship, useDeclineMyCarrierDriverRelationship,
  useEndCarrierDriverRelationship,
} from '@/hooks/settlements/useSettlementData';
import SEOHead from '@/components/SEOHead';

function DriverConnections() {
  const query = useCompanyDriverConnections();
  const respond = useCompanyConnectionAction();
  const acceptLegacy = useAcceptMyCarrierDriverRelationship();
  const declineLegacy = useDeclineMyCarrierDriverRelationship();
  const disconnect = useEndCarrierDriverRelationship();
  const [disconnecting, setDisconnecting] = useState<CompanyDriverConnection | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);
  const busy = respond.isPending || acceptLegacy.isPending || declineLegacy.isPending || disconnect.isPending;

  async function handleResponse(id: string, accept: boolean, legacy = false) {
    setFeedback(null);
    try {
      if (legacy) {
        const mutation = accept ? acceptLegacy : declineLegacy;
        await mutation.mutateAsync({ _relationship_id: id });
      } else {
        const response = await respond.mutateAsync({
          fn: 'company_driver_respond', args: { _invite_id: id, _accept: accept },
        }) as { status?: string; relationship_id?: string } | null;
        if (response?.status !== (accept ? 'accepted' : 'declined') || (accept && !response.relationship_id)) {
          throw new Error('Unconfirmed response');
        }
      }
      setFeedback({ message: accept ? 'Company connected. Look for assigned loads under Loads.' : 'Request declined.' });
    } catch {
      setFeedback({ message: 'Your response could not be confirmed. Refresh your connections and try again.', error: true });
    }
  }

  async function handleDisconnect() {
    if (!disconnecting) return;
    setFeedback(null);
    try {
      await disconnect.mutateAsync({ _relationship_id: disconnecting.id });
      setDisconnecting(null);
      setFeedback({ message: 'Company disconnected. Your load and settlement history stays in your account.' });
    } catch {
      setDisconnecting(null);
      setFeedback({ message: 'The disconnect could not be confirmed. Refresh your connections and try again.', error: true });
    }
  }

  if (query.isLoading) return <p role="status" className="premium-card p-5 text-sm text-muted-foreground">Loading company connections…</p>;
  if (query.error) return (
    <div role="alert" className="premium-card space-y-3 p-5">
      <p>Company connections could not be verified.</p>
      <Button className="min-h-12" variant="outline" onClick={() => void query.refetch()}>Retry</Button>
    </div>
  );
  const invites = [
    ...(query.data?.invites ?? []).map(invite => ({ ...invite, legacy: false as const })),
    ...(query.data?.relationships ?? []).filter(row => row.status === 'invited').map(row => ({ ...row, legacy: true, expires_at: null })),
  ];
  const connected = (query.data?.relationships ?? []).filter(row => row.status === 'active');
  return (
    <div className="space-y-6">
      {feedback && <p role={feedback.error ? 'alert' : 'status'} className="rounded-xl border border-border bg-card p-3 text-sm">{feedback.message}</p>}
      <section className="space-y-3" aria-labelledby="pending-company-connections">
        <div className="flex items-center gap-2">
          <MailCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 id="pending-company-connections" className="text-lg font-bold">Requests to review</h2>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">Review the company name and consent details before accepting or declining.</p>
        {invites.length === 0 && (
          <div className="premium-card p-5">
            <p className="font-semibold">No pending requests</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Ask your company to invite the verified email you use here. You can return to the dashboard without connecting.</p>
          </div>
        )}
        {invites.map(invite => (
          <article key={invite.id} className="premium-card space-y-3 p-4 sm:p-5">
            <h3 className="break-words text-lg font-semibold">{invite.company_name || 'Company workspace'}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{COMPANY_CONNECTION_CONSENT}</p>
            {invite.expires_at && <p className="text-xs text-muted-foreground">Request expires {invite.expires_at.slice(0, 10)}.</p>}
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-12" disabled={busy} onClick={() => void handleResponse(invite.id, true, invite.legacy)}>Accept connection</Button>
              <Button className="min-h-12" variant="outline" disabled={busy} onClick={() => void handleResponse(invite.id, false, invite.legacy)}>Decline</Button>
            </div>
          </article>
        ))}
      </section>
      <section className="space-y-3" aria-labelledby="active-company-connections">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 id="active-company-connections" className="text-lg font-bold">Connected companies</h2>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">These companies can assign work under the access you approved.</p>
        {connected.length === 0 && (
          <div className="premium-card p-5">
            <p className="font-semibold">No companies connected yet</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">After you accept a request, that company will appear here. You can disconnect later and keep your existing records.</p>
          </div>
        )}
        {connected.map(company => (
          <div key={company.id} className="premium-card flex min-w-0 flex-wrap items-center justify-between gap-3 p-4">
            <p className="min-w-0 break-words font-semibold">{company.company_name || 'Company workspace'}</p>
            <Button className="min-h-12" variant="outline" disabled={busy} onClick={() => setDisconnecting(company)}>Disconnect</Button>
          </div>
        ))}
      </section>
      <AlertDialog open={!!disconnecting} onOpenChange={open => { if (!open && !busy) setDisconnecting(null); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">Disconnect from {disconnecting?.company_name}?</AlertDialogTitle>
            <AlertDialogDescription>Your company will lose access to assign and update these loads. Your records remain in your account.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-12" disabled={busy}>Keep connected</AlertDialogCancel>
            <Button className="min-h-12" variant="destructive" disabled={busy} onClick={() => void handleDisconnect()}>Disconnect company</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function DriverCompanyConnections() {
  useEffect(() => {
    document.body.classList.add('app-shell-active');
    return () => document.body.classList.remove('app-shell-active');
  }, []);
  const access = useViewMode();
  const acting = useActingContext();
  const loading = access.isLoading || acting.isLoadingManagedDrivers;
  const allowed = !loading && !access.error && access.driverWorkspaceAllowed && !acting.isActingAsAssistant;
  return (
    <main className="app-shell min-h-screen w-full px-4 py-6 text-foreground sm:px-6">
      <SEOHead title="Company connections | HaulTrackerPro" description="Manage company connections to your driver account." path="/driver/company-connections" noindex />
      <div className="mx-auto w-full max-w-3xl space-y-6">
      <Button asChild variant="outline" className="min-h-12 gap-2">
        <Link to="/dashboard" onClick={() => { if (allowed) access.setViewMode('driver'); }}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to dashboard
        </Link>
      </Button>
      <header className="space-y-4">
        <div>
          <p className="text-label">Driver workspace</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Company connections</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Choose which companies can assign loads to your driver account, and review every request before you approve it.</p>
        </div>
        <div className="premium-card flex items-start gap-3 p-4 sm:p-5">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-bold">Why connections matter</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Approval lets a company assign and update its loads and share settlements with you. Your other loads, personal expenses, tax settings, and account access stay private.</p>
          </div>
        </div>
      </header>
      {loading ? <p role="status" className="premium-card p-5 text-sm text-muted-foreground">Checking your driver access…</p> : allowed ? <DriverConnections /> : (
        <div role="alert" className="premium-card space-y-3 p-5">
          <p>Open your own active driver workspace to review company requests.</p>
          <Button asChild className="min-h-12"><Link to="/start">Choose a workspace</Link></Button>
        </div>
      )}
      </div>
    </main>
  );
}
