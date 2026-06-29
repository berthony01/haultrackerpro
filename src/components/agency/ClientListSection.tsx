import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { Users } from 'lucide-react';
import { useAgencyClients, useRevokeAgencyDelegation } from '@/hooks/useAgencyWorkflow';
import { useToast } from '@/hooks/use-toast';

/**
 * Phase 4A — Agency client list with a working revoke-delegation control.
 *
 * The revoke action calls the SECURITY DEFINER `revoke_agency_delegation` RPC,
 * which (1) marks the delegation revoked, (2) syncs the matching
 * driver_assistants row to revoked, and (3) writes audit entries to both
 * agency_audit_log and assistant_audit_log. UI is purely cosmetic — the
 * RPC enforces who is allowed to revoke (agency owner/admin or the driver).
 */
export function ClientListSection({ agencyId }: { agencyId: string }) {
  const { data: clients, isLoading } = useAgencyClients(agencyId);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Active clients
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !clients || clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active clients yet. Once a driver approves a delegation request, they'll appear
            here.
          </p>
        ) : (
          <div className="divide-y border rounded-md">
            {clients.map((c) => (
              <div
                key={c.delegation_id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">
                    {c.driver_name || c.driver_email || c.driver_user_id.slice(0, 8)}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    Assistant: {c.member_email}
                    {c.package_name ? ` · ${c.package_name}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {c.last_activity_at && (
                    <span className="text-xs text-muted-foreground">
                      Last activity {new Date(c.last_activity_at).toLocaleDateString()}
                    </span>
                  )}
                  <RevokeClientButton
                    delegationId={c.delegation_id}
                    driverLabel={c.driver_name || c.driver_email || 'this driver'}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RevokeClientButton({
  delegationId,
  driverLabel,
}: {
  delegationId: string;
  driverLabel: string;
}) {
  const { toast } = useToast();
  const revoke = useRevokeAgencyDelegation();
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive" disabled={busy}>
          End access
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>End agency access for {driverLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            Your assigned assistant will immediately lose access to {driverLabel}'s account, and
            this driver will be removed from your active client list. Open work items remain
            visible to your team but do not imply ongoing access. The driver is notified through
            their activity log.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={async () => {
              setBusy(true);
              try {
                await revoke.mutateAsync(delegationId);
                toast({ title: 'Access ended' });
              } catch (e: any) {
                toast({
                  title: 'Could not end access',
                  description: e?.message,
                  variant: 'destructive',
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            End access
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
