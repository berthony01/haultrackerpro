import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Copy, Link2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCompanyConnectionAction, useCompanyDriverConnections } from '@/hooks/useCompanyDriverConnections';

export const COMPANY_CONNECTION_CONSENT = 'Accepting lets this company assign loads to your account, update those loads to delivered or cancelled, and share settlement statements. Its authorized dispatchers can see your loads for this company, routes, mileage, and agreed driver pay. Your other loads, personal expenses, tax settings, and account access stay private. You can disconnect later and keep your existing records.';
const DRIVER_CONNECTION_LINK = 'https://haultrackerpro.com/driver/company-connections';

export function CompanyDriverConnectionsPanel({ recruiterId }: { recruiterId: string }) {
  const query = useCompanyDriverConnections(recruiterId);
  const action = useCompanyConnectionAction();
  const [email, setEmail] = useState('');
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      const result = await action.mutateAsync({
        fn: 'company_driver_invite',
        args: { _recruiter_id: recruiterId, _email: email.trim() },
      }) as { id?: string; status?: string } | null;
      if (!result?.id || !['pending', 'accepted'].includes(result.status ?? '')) throw new Error('Unconfirmed request');
      setEmail('');
      setFeedback({
        message: result.status === 'accepted'
          ? 'This driver has already accepted your request.'
          : 'Request saved. Ask the driver to sign in with this email and open Company connections.',
      });
    } catch {
      setFeedback({ error: true, message: 'Request was not confirmed. Check company access and try again.' });
    }
  }

  async function revoke(id: string) {
    setFeedback(null);
    try {
      await action.mutateAsync({ fn: 'company_driver_revoke', args: { _recruiter_id: recruiterId, _invite_id: id } });
      setFeedback({ message: 'Pending request revoked.' });
    } catch {
      setFeedback({ error: true, message: 'Revocation was not confirmed. Refresh and try again.' });
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(DRIVER_CONNECTION_LINK);
      setFeedback({ message: 'Driver connection link copied.' });
    } catch {
      setFeedback({ error: true, message: 'Select and copy the link shown above.' });
    }
  }

  const connected = query.data?.relationships.filter(row => row.status === 'active') ?? [];
  return (
    <section className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-6" aria-label="Company driver connections">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <UserPlus className="h-5 w-5 shrink-0 text-primary" />Connect your drivers
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Invite an existing employee by their HaulTrackerPro account email. They can also create a driver account with that email.
          The driver must accept before you can assign loads.
        </p>
      </div>
      {query.isLoading ? <p role="status">Loading connections…</p> : query.error ? (
        <div role="alert">
          <p>Connections could not be verified.</p>
          <Button variant="outline" className="mt-2 min-h-12" onClick={() => void query.refetch()}>Retry connections</Button>
        </div>
      ) : (
        <>
          {query.data?.can_invite ? (
            <form onSubmit={e => void invite(e)} className="space-y-3">
              <Label htmlFor="company-driver-email">Driver’s account email</Label>
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
                <Input id="company-driver-email" type="email" autoComplete="off" maxLength={254} required className="min-h-12 min-w-0 flex-1" value={email} onChange={e => setEmail(e.target.value)} disabled={action.isPending} />
                <Button type="submit" className="min-h-12 shrink-0" disabled={action.isPending}>
                  {action.isPending ? 'Saving…' : 'Create connection request'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Requests expire after 7 days. Saving a request does not send an email.</p>
            </form>
          ) : <p className="text-sm text-muted-foreground">Creating requests requires the carrier owner’s active company plan.</p>}
          <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
            <p className="font-semibold">Driver’s next step</p>
            <p>Share this link with the driver. They can sign in and review the request in Company connections.</p>
            <p className="select-all break-all text-xs text-muted-foreground">{DRIVER_CONNECTION_LINK}</p>
            <Button className="min-h-12" variant="outline" onClick={() => void copyLink()}><Copy className="h-4 w-4" />Copy driver link</Button>
          </div>
          <details>
            <summary className="min-h-12 cursor-pointer py-3 font-semibold">Connection requests ({query.data?.invites.length ?? 0})</summary>
            <div className="space-y-2">
              {query.data?.invites.map(row => (
                <div key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                  <div className="min-w-0">
                    <p className="break-all text-sm font-medium">{row.email}</p>
                    <p className="text-xs capitalize text-muted-foreground">{row.status} · expires {row.expires_at.slice(0, 10)}</p>
                  </div>
                  {row.status === 'pending' && <Button className="min-h-12" variant="outline" disabled={action.isPending} onClick={() => void revoke(row.id)}>Revoke request</Button>}
                </div>
              ))}
            </div>
          </details>
          <div className="space-y-2">
            <h3 className="font-semibold">Connected drivers</h3>
            {connected.map(row => (
              <p key={row.id} className="flex items-center gap-2 break-words rounded-xl bg-muted/40 p-3 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />{row.driver_name}
              </p>
            ))}
            {connected.length === 0 && <p className="text-sm text-muted-foreground">Your drivers appear here after they accept.</p>}
          </div>
        </>
      )}
      {feedback && <p role={feedback.error ? 'alert' : 'status'} className="break-words text-sm">{feedback.message}</p>}
    </section>
  );
}

export function DriverCompanyConnectionNotice() {
  const { data, error } = useCompanyDriverConnections();
  const count = error ? 0 : (data?.invites.length ?? 0) + (data?.relationships.filter(row => row.status === 'invited').length ?? 0);
  if (!count) return null;
  return (
    <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-semibold">
          <Link2 className="h-5 w-5 shrink-0" />Company connection {count === 1 ? 'request' : 'requests'}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Review who can assign loads to your account.</p>
      </div>
      <Button asChild className="min-h-12"><Link to="/driver/company-connections">Review requests ({count})</Link></Button>
    </div>
  );
}
