import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft,
  ShieldCheck,
  Users,
  Building2,
  Inbox,
  History,
  Info,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useAssistants } from '@/hooks/useAssistants';
import { useAssistantsWithSource, type AssistantWithSourceRow } from '@/hooks/useAssistantsWithSource';
import {
  useDriverDecideDelegation,
  useMyAgencyRequests,
  useMyDriverAgencyAudit,
  useMyPendingDelegations,
  useRevokeAgencyDelegation,
  formatAgencyAuditAction,
} from '@/hooks/useAgencyWorkflow';
import {
  ASSISTANT_PERMISSION_KEYS,
  PERMISSION_LABELS,
} from '@/lib/assistantPermissions';

/**
 * Phase 4A — Driver Assistant Control Center.
 *
 * One driver-facing surface for everything assistant/agency-related:
 *   • Active assistants (direct invite or agency delegation) with revoke
 *   • Pending delegation approvals
 *   • Submitted agency service requests
 *   • Recent agency activity on the driver's account
 *
 * Security: every data source on this page is driver-scoped server-side
 * (auth.uid()) — this page never accepts a driver id from the URL.
 */
export default function DriverAssistantControl() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { data: assistants, isLoading: assistantsLoading } = useAssistantsWithSource();
  const { data: pending, isLoading: pendingLoading } = useMyPendingDelegations();
  const { data: myRequests, isLoading: requestsLoading } = useMyAgencyRequests();
  const { data: audit, isLoading: auditLoading } = useMyDriverAgencyAudit(50);

  if (loading) return null;
  if (!user) {
    return (
      <AppShell>
        <div className="container mx-auto max-w-md px-4 py-8">
          <p>Please sign in.</p>
        </div>
      </AppShell>
    );
  }

  const active = (assistants ?? []).filter((a) => a.status === 'active');
  const pendingInvites = (assistants ?? []).filter((a) => a.status === 'pending');
  const past = (assistants ?? []).filter((a) => a.status === 'revoked' || a.status === 'expired');
  const pendingCount = pending?.length ?? 0;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6 space-y-6">
      <header className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="-ml-2">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Assistant control center
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage who can help with your account, and review every agency action on your behalf.
          </p>
        </div>
      </header>

      {/* Safety explainer — non-dismissible, always visible */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="h-4 w-4 text-primary" />
            How access works
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>
            Submitting a request to an agency does <b>not</b> grant any access to your account.
          </p>
          <p>
            An assistant only gets access after <b>you approve a specific delegation</b>, and you
            choose exactly which permissions they get.
          </p>
          <p>
            You can revoke any assistant — direct or agency-delegated — at any time. Access ends
            immediately.
          </p>
        </CardContent>
      </Card>

      {/* Pending delegation approvals — priority surface */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Inbox className="h-4 w-4 text-primary" />
            Agency approvals
            {pendingCount > 0 && (
              <Badge variant="default" className="ml-1">
                {pendingCount} waiting
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Agencies waiting for your approval to assign someone to your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : pendingCount === 0 ? (
            <p className="text-sm text-muted-foreground">No pending approvals.</p>
          ) : (
            <div className="space-y-2">
              {pending!.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {r.agency_name} → {r.member_email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.package_name ?? 'Custom request'} · requested{' '}
                      {new Date(r.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => navigate('/driver/agency-approvals')}>
                    Review
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active assistants */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Active assistants
          </CardTitle>
          <CardDescription>
            People who currently have permission to act on your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {assistantsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : active.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active assistants.</p>
          ) : (
            <div className="space-y-2">
              {active.map((a) => (
                <AssistantRow key={a.id} row={a} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending invites — separate from active */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Inbox className="h-4 w-4 text-primary" />
            Pending invites
            {pendingInvites.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {pendingInvites.length}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Invited assistants who haven't accepted yet. They do <b>not</b> have access until they
            accept and you have approved any required permissions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {assistantsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : pendingInvites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending invites.</p>
          ) : (
            <div className="space-y-2">
              {pendingInvites.map((a) => (
                <AssistantRow key={a.id} row={a} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Past / revoked */}
      {past.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Past assistants
            </CardTitle>
            <CardDescription>
              Previously had access. None of these can act on your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {past.map((a) => (
                <div key={a.id} className="text-xs text-muted-foreground p-2 border rounded-md">
                  {a.invite_email} ·{' '}
                  <Badge variant="outline" className="ml-1">
                    {a.status}
                  </Badge>
                  {a.revoked_at && (
                    <> · ended {new Date(a.revoked_at).toLocaleDateString()}</>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Submitted agency requests */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Your submitted agency requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {requestsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !myRequests || myRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You haven't asked any agency for help yet.
            </p>
          ) : (
            <div className="space-y-2">
              {myRequests.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{r.agency_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.package_name ?? 'Custom'} · submitted{' '}
                      {new Date(r.created_at).toLocaleDateString()}
                      {r.decided_at && (
                        <> · decided {new Date(r.decided_at).toLocaleDateString()}</>
                      )}
                    </p>
                    {r.message && (
                      <p className="text-xs text-muted-foreground italic mt-1">"{r.message}"</p>
                    )}
                  </div>
                  <Badge variant="outline">{requestStatusLabel(r.status)}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agency activity log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            Agency activity on your account
          </CardTitle>
          <CardDescription>
            Everything an agency or its assistants have done that involves your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {auditLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !audit || audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agency activity yet.</p>
          ) : (
            <div className="divide-y border rounded-md text-sm">
              {audit.map((r) => (
                <div key={r.id} className="p-3">
                  <p>{formatAgencyAuditAction(r.action, r.entity_type)}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function requestStatusLabel(s: string): string {
  switch (s) {
    case 'pending':
      return 'Awaiting agency';
    case 'approved':
      return 'Approved by agency';
    case 'declined':
      return 'Declined';
    case 'cancelled':
      return 'Cancelled';
    case 'converted_to_client':
      return 'Active client';
    default:
      return s;
  }
}

function AssistantRow({ row }: { row: AssistantWithSourceRow }) {
  const { toast } = useToast();
  const { revoke } = useAssistants();
  const revokeDelegation = useRevokeAgencyDelegation();
  const isAgency = row.source === 'agency' && !!row.delegation_id;
  const [busy, setBusy] = useState(false);

  const permsGranted = ASSISTANT_PERMISSION_KEYS.filter((k) => (row.permissions as any)?.[k]);

  async function handleRevoke() {
    setBusy(true);
    try {
      if (isAgency && row.delegation_id) {
        await revokeDelegation.mutateAsync(row.delegation_id);
        toast({
          title: 'Agency access revoked',
          description: `${row.invite_email} can no longer act on your account, and the agency relationship is ended.`,
        });
      } else {
        await revoke.mutateAsync(row.id);
        toast({
          title: 'Assistant revoked',
          description: `${row.invite_email} no longer has access.`,
        });
      }
    } catch (e: any) {
      toast({
        title: 'Could not revoke',
        description: e?.message,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{row.invite_email}</span>
          <Badge variant={row.status === 'active' ? 'default' : 'secondary'}>{row.status}</Badge>
          {isAgency ? (
            <Badge variant="outline" className="gap-1">
              <Building2 className="h-3 w-3" />
              via {row.agency_name ?? 'agency'}
            </Badge>
          ) : (
            <Badge variant="outline">direct invite</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {permsGranted.length === 0
            ? 'No permissions granted'
            : permsGranted.map((k) => PERMISSION_LABELS[k]).join(' · ')}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {row.accepted_at && <>Joined {new Date(row.accepted_at).toLocaleDateString()} · </>}
          {row.last_active_at
            ? `Last active ${new Date(row.last_active_at).toLocaleDateString()}`
            : 'No activity yet'}
        </p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" className="text-destructive" disabled={busy}>
            {isAgency ? 'Revoke agency access' : 'Revoke'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isAgency ? 'End agency access?' : 'Revoke this assistant?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isAgency ? (
                <>
                  <b>{row.invite_email}</b> will lose access immediately. The agency relationship
                  with <b>{row.agency_name}</b> will also end, and they will no longer be able to
                  open new work items on your account. Past work items remain in their records but
                  do not imply ongoing access.
                </>
              ) : (
                <>
                  <b>{row.invite_email}</b> will immediately lose access to your account. You can
                  invite them again later.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleRevoke}
            >
              {isAgency ? 'End agency access' : 'Revoke access'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
