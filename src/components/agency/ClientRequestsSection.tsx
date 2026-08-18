import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Inbox } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAgencyMembers } from '@/hooks/useAgency';
import { useAgencyWorkspacePermissions } from '@/hooks/useAgencyWorkspacePermissions';
import {
  useAgencyClientRequests,
  useAgencyPackages,
  useCreateDelegationRequest,
  useSetClientRequestStatus,
  type AgencyClientRequestRow,
} from '@/hooks/useAgencyWorkflow';
import {
  ASSISTANT_PERMISSION_KEYS,
  PERMISSION_LABELS,
  type AssistantPermissionKey,
  type AssistantPermissions,
} from '@/lib/assistantPermissions';

/**
 * Phase AM-1C-B / AM-1C-D — Client requests consume the AM-1B Agency workspace
 * permission contract.
 *
 * `client_requests_view` controls broad list visibility, `client_requests_manage`
 * controls direct request workflow (decline/status/assignment). The two are
 * independent: manage never implies view.
 *
 * AM-1C-D: Agency-side delegation creation is governed exclusively by
 * `delegations_manage`. It is NOT a client-request permission and must never
 * gate the request list or direct request management, and no role label grants
 * it. The `create_agency_delegation_request` RPC remains authoritative.
 *
 * Permission separation: the assignment dialog's package fallback query is
 * itself gated on `packages_view`. A member may validly hold
 * `client_requests_view + delegations_manage` without package visibility.
 */
export function ClientRequestsSection({ agencyId }: { agencyId: string }) {
  const {
    canViewClientRequests,
    canManageClientRequests,
    canManageDelegations,
    canViewPackages,
    isLoading: permissionsLoading,
    isError: permissionsError,
  } = useAgencyWorkspacePermissions(agencyId);
  const { data: requests, isLoading } = useAgencyClientRequests(agencyId, {
    enabled: canViewClientRequests,
  });
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'declined'>('pending');
  const filtered =
    requests?.filter((r) => filter === 'all' || r.status === filter) ?? [];


  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Inbox className="h-4 w-4 text-primary" />
            Client requests
          </CardTitle>
          {canViewClientRequests && (
            <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {permissionsLoading ? (
          <p className="text-sm text-muted-foreground">Checking your access…</p>
        ) : permissionsError ? (
          <p className="text-sm text-muted-foreground">
            We couldn't confirm your access to client requests.
          </p>
        ) : !canViewClientRequests ? (
          <p className="text-sm text-muted-foreground">
            You don't have access to view this agency's client requests.
          </p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests match this filter.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => (
              <ClientRequestRow
                key={r.id}
                agencyId={agencyId}
                req={r}
                canManageClientRequests={canManageClientRequests}
                canCreateDelegation={canCreateDelegation}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ClientRequestRow({
  agencyId,
  req,
  canManageClientRequests,
  canCreateDelegation,
}: {
  agencyId: string;
  req: AgencyClientRequestRow;
  canManageClientRequests: boolean;
  canCreateDelegation: boolean;
}) {
  const [open, setOpen] = useState(false);
  const setStatus = useSetClientRequestStatus();
  const { toast } = useToast();

  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium truncate">
            {req.driver_name || req.driver_email || 'Driver'}
          </p>
          <p className="text-xs text-muted-foreground truncate">{req.driver_email}</p>
          {req.package_name && (
            <p className="text-xs mt-1">
              Package: <span className="font-medium">{req.package_name}</span>
            </p>
          )}
          {req.message && (
            <p className="text-xs mt-1 line-clamp-2 text-muted-foreground">{req.message}</p>
          )}
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{req.status}</Badge>
            {req.preferred_contact_method && <span>{req.preferred_contact_method}</span>}
            {req.phone && <span>{req.phone}</span>}
          </div>
        </div>
        <div className="flex flex-col gap-2 items-end">
          {req.status === 'pending' && (
            <>
              {canCreateDelegation && (
                <Button size="sm" onClick={() => setOpen(true)}>
                  Assign &amp; request delegation
                </Button>
              )}
              {canManageClientRequests && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await setStatus.mutateAsync({ id: req.id, status: 'declined' });
                      toast({ title: 'Request declined' });
                    } catch (e: any) {
                      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
                    }
                  }}
                >
                  Decline
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {canCreateDelegation && open && (
        <AssignDelegationDialog
          open={open}
          onOpenChange={setOpen}
          agencyId={agencyId}
          req={req}
        />
      )}
    </div>
  );
}

function AssignDelegationDialog({
  open,
  onOpenChange,
  agencyId,
  req,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  agencyId: string;
  req: AgencyClientRequestRow;
}) {
  const { data: members } = useAgencyMembers(agencyId);
  const { data: packages } = useAgencyPackages(agencyId);
  const create = useCreateDelegationRequest();
  const { toast } = useToast();
  const activeMembers = (members ?? []).filter((m) => m.status === 'active');
  const [memberId, setMemberId] = useState<string | null>(null);
  const pkg = packages?.find((p) => p.id === req.selected_package_id);
  const seed: AssistantPermissions =
    req.requested_permissions && Object.keys(req.requested_permissions).length > 0
      ? req.requested_permissions
      : pkg?.recommended_permissions ?? {};
  const [perms, setPerms] = useState<AssistantPermissions>(seed);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request driver approval</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            The driver must explicitly approve this delegation before the assistant can manage
            their account.
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium">Assign agency member</label>
            <Select value={memberId ?? undefined} onValueChange={setMemberId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a member" />
              </SelectTrigger>
              <SelectContent>
                {activeMembers.map((m) => (
                  <SelectItem key={m.id} value={m.member_user_id ?? m.id}>
                    {m.invite_email} · {m.role.replace('agency_', '')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeMembers.length === 0 && (
              <p className="text-xs text-destructive">
                Invite at least one active member before assigning a client.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Permissions to request</label>
            <div className="rounded-md border p-3 space-y-2">
              {ASSISTANT_PERMISSION_KEYS.map((k: AssistantPermissionKey) => (
                <label key={k} className="flex items-center justify-between text-sm">
                  <span>{PERMISSION_LABELS[k]}</span>
                  <Switch
                    checked={!!perms[k]}
                    onCheckedChange={() =>
                      setPerms((p) => ({ ...p, [k]: !p[k] }))
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!memberId || create.isPending}
            onClick={async () => {
              try {
                await create.mutateAsync({
                  client_request_id: req.id,
                  member_user_id: memberId!,
                  requested_permissions: perms,
                });
                toast({ title: 'Driver approval requested' });
                onOpenChange(false);
              } catch (e: any) {
                toast({
                  title: 'Could not request delegation',
                  description: e?.message,
                  variant: 'destructive',
                });
              }
            }}
          >
            Send request to driver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
