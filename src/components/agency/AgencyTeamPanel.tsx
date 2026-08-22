/**
 * Phase RW-1 — Agency Team & permission management surface.
 *
 * Reuses the RecruiterTeamPanel UX/security shape, but NONE of its permission
 * semantics or RPCs. Every authority decision here is fail-closed:
 *  - only the canonical Agency owner ever sees invite / revoke / permission
 *    assignment controls;
 *  - a non-owner member with the read-only `team_view` permission sees the
 *    roster and nothing else;
 *  - role labels (`agency_member`, `agency_admin`) are descriptive only and
 *    grant no permission at all;
 *  - the 11 workspace permissions are independent booleans — toggling one
 *    never changes another;
 *  - the database is the only authority (get_agency_member_permissions /
 *    set_agency_member_permissions). No table is read directly.
 *
 * Agency workspace permissions control Agency Console tools ONLY. They never
 * grant access to a driver's account — that stays a separate, driver-approved
 * Driver Assistant delegation.
 */
import { useEffect, useMemo, useState } from 'react';
import { Copy, ShieldCheck, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useToast } from '@/hooks/use-toast';
import {
  AGENCY_WORKSPACE_PERMISSION_KEYS,
  AGENCY_WORKSPACE_PERMISSION_LABELS,
  emptyAgencyWorkspacePermissions,
  type AgencyWorkspacePermissionKey,
  type ParsedAgencyWorkspacePermissions,
} from '@/lib/agencyWorkspacePermissions';
import {
  useAgencyMemberPermissions,
  useAgencyMembers,
  useAgencyMutations,
  type AgencyMember,
  type AgencyRole,
} from '@/hooks/useAgency';
import { ProfessionalProfileSummaryCard } from '@/components/profiles/ProfessionalProfileCard';
import { useAuthorizedProfessionalProfiles } from '@/hooks/useProfessionalProfile';

/** Descriptive invite roles. `agency_owner` is never invitable. */
const INVITE_ROLE_OPTIONS: { value: Exclude<AgencyRole, 'agency_owner'>; label: string }[] = [
  { value: 'agency_member', label: 'Member (descriptive label)' },
  { value: 'agency_admin', label: 'Admin (descriptive label)' },
];

const DRIVER_ACCESS_NOTE =
  "Workspace permissions control Agency Console tools only. They never grant access to a driver's account — each driver must still approve a Driver Assistant delegation separately.";

function PermissionEditorDialog({
  member,
  onClose,
}: {
  member: AgencyMember;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { setPermissions } = useAgencyMutations();
  const { data, isLoading, isError } = useAgencyMemberPermissions(member.id);

  // Fail closed until the database answers with a complete, valid map.
  const [draft, setDraft] = useState<ParsedAgencyWorkspacePermissions>(() =>
    emptyAgencyWorkspacePermissions(),
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (data) {
      setDraft({ ...data });
      setLoaded(true);
    }
  }, [data]);

  const canSave = loaded && !isLoading && !isError && !setPermissions.isPending;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit permissions</DialogTitle>
          <DialogDescription>
            {member.invite_email} — role labels do not grant permissions. Only the
            checkboxes below decide what this teammate can do in the Agency Console.
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">{DRIVER_ACCESS_NOTE}</p>

        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading permissions…</p>
        )}
        {isError && (
          <p className="text-sm text-destructive" data-testid="agency-permission-load-error">
            Could not load this member's permissions. Nothing was changed.
          </p>
        )}

        {!isError && (
          <div className="space-y-2" data-testid="agency-permission-editor">
            {AGENCY_WORKSPACE_PERMISSION_KEYS.map((key: AgencyWorkspacePermissionKey) => (
              <label
                key={key}
                className="flex items-start gap-3 rounded-md border border-border/50 p-2.5"
              >
                <Checkbox
                  checked={draft[key] === true}
                  disabled={!loaded}
                  data-testid={`agency-permission-${key}`}
                  onCheckedChange={(checked) => {
                    if (!loaded) return;
                    // Exactly one independent boolean changes. No dependency,
                    // no implication, no role-derived defaults.
                    setDraft((prev) => ({ ...prev, [key]: checked === true }));
                  }}
                />
                <span className="text-sm font-medium text-foreground">
                  {AGENCY_WORKSPACE_PERMISSION_LABELS[key]}
                </span>
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            data-testid="agency-permission-save"
            onClick={async () => {
              if (!canSave) return;
              // Always send a COMPLETE map of every known permission key.
              const payload: Record<string, boolean> = {};
              for (const key of AGENCY_WORKSPACE_PERMISSION_KEYS) {
                payload[key] = draft[key] === true;
              }
              try {
                await setPermissions.mutateAsync({
                  member_id: member.id,
                  permissions: payload,
                });
                toast({ title: 'Permissions updated' });
                onClose();
              } catch (e: any) {
                toast({
                  title: 'Could not save permissions',
                  description: e?.message,
                  variant: 'destructive',
                });
              }
            }}
          >
            Save permissions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgencyTeamPanel({
  agencyId,
  isOwner,
  canViewTeam,
}: {
  agencyId: string;
  /** Canonical Agency owner — the ONLY write authority on this surface. */
  isOwner: boolean;
  /** Read-only `team_view` workspace permission. Never a write grant. */
  canViewTeam: boolean;
}) {
  const { toast } = useToast();
  const { invite, revoke } = useAgencyMutations();
  const { data: members } = useAgencyMembers(agencyId);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] =
    useState<Exclude<AgencyRole, 'agency_owner'>>('agency_member');
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<AgencyMember | null>(null);

  const memberUserIds = useMemo(
    () => (members ?? []).map((member) => member.member_user_id),
    [members],
  );
  const { data: memberProfiles = {} } = useAuthorizedProfessionalProfiles(memberUserIds);

  const activeCount = (members ?? []).filter((m) => m.status === 'active').length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              {canViewTeam ? 'Team' : 'Your membership'}
            </CardTitle>
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              {activeCount} active
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">{DRIVER_ACCESS_NOTE}</p>
          {!isOwner && (
            <p className="text-xs text-muted-foreground" data-testid="agency-team-readonly-note">
              Read-only. Inviting, removing, and assigning permissions stay with the
              agency owner.
            </p>
          )}

          {isOwner && (
            <div className="space-y-3 rounded-md border border-border/60 p-3">
              <div className="space-y-2">
                <Label htmlFor="ag-invite-email">Invite member by email</Label>
                <Input
                  id="ag-invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ag-invite-role">Role label</Label>
                <Select
                  value={inviteRole}
                  onValueChange={(v) =>
                    setInviteRole(v as Exclude<AgencyRole, 'agency_owner'>)
                  }
                >
                  <SelectTrigger id="ag-invite-role" data-testid="agency-invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVITE_ROLE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Role labels are descriptive only — they grant no permissions.
                  Assign permissions explicitly after the invite is created; they
                  take effect only within the member's authorized Agency workspace.
                </p>

              </div>
              <Button
                disabled={invite.isPending || inviteEmail.trim() === ''}
                onClick={async () => {
                  try {
                    const r = await invite.mutateAsync({
                      agency_id: agencyId,
                      email: inviteEmail.trim(),
                      role: inviteRole,
                    });
                    const link = `${window.location.origin}/agency/invite/${r.invite_token}`;
                    setLastInviteLink(link);
                    setInviteEmail('');
                    toast({ title: 'Invite created — share the link' });
                  } catch (e: any) {
                    toast({
                      title: 'Could not invite',
                      description: e?.message,
                      variant: 'destructive',
                    });
                  }
                }}
              >
                Invite
              </Button>
            </div>
          )}

          {isOwner && lastInviteLink && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-2">
              <p className="font-medium">Share this link with your teammate</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-background px-2 py-1">
                  {lastInviteLink}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Copy invite link"
                  onClick={() => {
                    navigator.clipboard.writeText(lastInviteLink);
                    toast({ title: 'Link copied' });
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {!members || members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members yet.</p>
          ) : (
            <div className="rounded-md border divide-y">
              {members.map((m) => {
                const manageable =
                  isOwner && m.role !== 'agency_owner' && m.status !== 'revoked';
                return (
                  <div key={m.id} className="p-3 text-sm space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{m.invite_email}</p>
                        <p className="text-xs text-muted-foreground">
                          {m.role.replace('agency_', '')} · {m.status}
                        </p>
                      </div>
                      {manageable && (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`agency-edit-permissions-${m.id}`}
                            onClick={() => setEditingMember(m)}
                          >
                            Edit permissions
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="ghost" className="text-destructive">
                                Revoke
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove this member?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {m.invite_email} will lose access to your agency, and any
                                  driver access assigned to them through this agency will
                                  end. Direct Driver Assistant access granted to them
                                  separately by a driver is not affected.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={async () => {
                                    try {
                                      await revoke.mutateAsync(m.id);
                                      toast({ title: 'Member removed' });
                                    } catch (e: any) {
                                      toast({
                                        title: 'Could not remove',
                                        description: e?.message,
                                        variant: 'destructive',
                                      });
                                    }
                                  }}
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                    </div>
                    <ProfessionalProfileSummaryCard
                      summary={m.member_user_id ? memberProfiles[m.member_user_id] : null}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {isOwner && editingMember && (
        <PermissionEditorDialog
          member={editingMember}
          onClose={() => setEditingMember(null)}
        />
      )}
    </div>
  );
}

export default AgencyTeamPanel;
