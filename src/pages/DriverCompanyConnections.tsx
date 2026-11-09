import { useState } from 'react';
import { Link } from 'react-router-dom';
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

  if (query.isLoading) return <p role="status">Loading company connections…</p>;
  if (query.error) return (
    <div role="alert" className="space-y-3">
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
        <h2 id="pending-company-connections" className="text-lg font-bold">Requests to review</h2>
        {invites.length === 0 && <p className="text-sm text-muted-foreground">No pending requests. Ask your company to invite the email you use here. Verify that email to receive the request.</p>}
        {invites.map(invite => (
          <article key={invite.id} className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
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
        <h2 id="active-company-connections" className="text-lg font-bold">Connected companies</h2>
        {connected.length === 0 && <p className="text-sm text-muted-foreground">Your connected companies will appear here.</p>}
        {connected.map(company => (
          <div key={company.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
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
  const access = useViewMode();
  const acting = useActingContext();
  const loading = access.isLoading || acting.isLoadingManagedDrivers;
  const allowed = !loading && !access.error && access.driverWorkspaceAllowed && !acting.isActingAsAssistant;
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl space-y-6 px-4 py-6">
      <SEOHead title="Company connections | HaulTrackerPro" description="Manage company connections to your driver account." path="/driver/company-connections" noindex />
      <Button asChild variant="outline" className="min-h-12">
        <Link to="/dashboard" onClick={() => { if (allowed) access.setViewMode('driver'); }}>Back to dashboard</Link>
      </Button>
      <header>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Company connections</h1>
        <p className="mt-2 text-sm text-muted-foreground">Choose which companies can assign loads to your driver account.</p>
      </header>
      {loading ? <p role="status">Checking your driver access…</p> : allowed ? <DriverConnections /> : (
        <div role="alert" className="space-y-3">
          <p>Open your own active driver workspace to review company requests.</p>
          <Button asChild className="min-h-12"><Link to="/start">Choose a workspace</Link></Button>
        </div>
      )}
    </main>
  );
}
