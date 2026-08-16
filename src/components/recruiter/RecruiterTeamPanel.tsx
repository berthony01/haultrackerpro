/**
 * Phase RC-1J-D — Recruiter Team panel.
 *
 * Reusable for the canonical owner and for delegated staff. Every authority
 * decision is fail-closed on the props resolved upstream (owner semantics or
 * RC-1B `team_view` / `team_manage`), and the database remains authoritative:
 * this component never infers authority from the descriptive
 * `recruiter_admin` role label and never reads a table directly.
 */
import { useMemo, useState } from 'react';
import { ArrowLeft, Copy, Loader2, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  RECRUITER_STAFF_PERMISSION_KEYS,
  RECRUITER_STAFF_PERMISSION_LABELS,
  type ParsedRecruiterStaffPermissions,
  type RecruiterStaffPermissionKey,
} from '@/lib/recruiterStaffPermissions';
import {
  useRecruiterTeam,
  type RecruiterTeamMember,
} from '@/hooks/recruiter/useRecruiterTeam';

/**
 * DORMANT permission — reserved, never operationalized by RC-1J-D. Its current
 * value is always preserved on edit and is always false for a new invite.
 */
const DORMANT_PERMISSIONS: readonly RecruiterStaffPermissionKey[] = ['applications_manage_notes'];

const ROLE_OPTIONS = [
  { value: 'recruiter_staff', label: 'Staff (descriptive label)' },
  { value: 'recruiter_admin', label: 'Admin (descriptive label)' },
] as const;

function emptyPermissionMap(): Record<RecruiterStaffPermissionKey, boolean> {
  const out = {} as Record<RecruiterStaffPermissionKey, boolean>;
  for (const key of RECRUITER_STAFF_PERMISSION_KEYS) out[key] = false;
  return out;
}

/**
 * Team dependency (the ONLY permission dependency in this phase):
 * `team_manage` is operational only alongside `team_view`.
 */
function applyTeamDependency(
  map: Record<RecruiterStaffPermissionKey, boolean>,
  changed: RecruiterStaffPermissionKey,
): Record<RecruiterStaffPermissionKey, boolean> {
  const next = { ...map };
  if (changed === 'team_manage' && next.team_manage) next.team_view = true;
  if (changed === 'team_view' && !next.team_view) next.team_manage = false;
  return next;
}

function fmt(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

interface PermissionEditorProps {
  value: Record<RecruiterStaffPermissionKey, boolean>;
  baseline: Record<RecruiterStaffPermissionKey, boolean>;
  isOwnerActor: boolean;
  actorPermissions?: ParsedRecruiterStaffPermissions | null;
  onChange: (next: Record<RecruiterStaffPermissionKey, boolean>) => void;
}

function PermissionEditor({
  value,
  baseline,
  isOwnerActor,
  actorPermissions,
  onChange,
}: PermissionEditorProps) {
  return (
    <div className="space-y-2" data-testid="team-permission-editor">
      {RECRUITER_STAFF_PERMISSION_KEYS.map((key) => {
        const dormant = DORMANT_PERMISSIONS.includes(key);
        const actorHolds = isOwnerActor || actorPermissions?.[key] === true;
        // Delegated anti-escalation mirrors the RC-1J-C backend rule: a
        // permission may only move to true when the acting manager holds it.
        // Preserving an already-true value is allowed; turning it false is
        // allowed and cannot be reversed in this session.
        const lockedOff = !isOwnerActor && !actorHolds && !value[key];
        const disabled = dormant || lockedOff;
        return (
          <label
            key={key}
            className="flex items-start gap-3 rounded-md border border-border/50 p-2.5"
          >
            <Checkbox
              checked={value[key]}
              disabled={disabled}
              data-testid={`team-permission-${key}`}
              onCheckedChange={(checked) => {
                if (disabled) return;
                onChange(applyTeamDependency({ ...value, [key]: checked === true }, key));
              }}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                {RECRUITER_STAFF_PERMISSION_LABELS[key]}
              </span>
              {dormant && (
                <span className="block text-xs text-muted-foreground">
                  Reserved — not available yet. Current value is preserved.
                </span>
              )}
              {!dormant && lockedOff && (
                <span className="block text-xs text-muted-foreground">
                  You cannot grant a permission you do not hold.
                </span>
              )}
              {!dormant && !lockedOff && !actorHolds && baseline[key] && (
                <span className="block text-xs text-muted-foreground">
                  You do not hold this permission — you may keep it or remove it.
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export interface RecruiterTeamPanelProps {
  recruiterId: string;
  companyName: string;
  canViewTeam: boolean;
  canManageTeam: boolean;
  isOwnerActor: boolean;
  /** Full parsed RC-1B map for delegated staff; null/undefined for the owner. */
  actorPermissions?: ParsedRecruiterStaffPermissions | null;
  onBack?: () => void;
}

export function RecruiterTeamPanel({
  recruiterId,
  companyName,
  canViewTeam,
  canManageTeam,
  isOwnerActor,
  actorPermissions = null,
  onBack,
}: RecruiterTeamPanelProps) {
  const viewAllowed = canViewTeam === true;
  const manageAllowed = viewAllowed && canManageTeam === true;
  const { toast } = useToast();

  const team = useRecruiterTeam(recruiterId, viewAllowed);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('recruiter_staff');
  const [invitePerms, setInvitePerms] = useState(emptyPermissionMap);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const [editMember, setEditMember] = useState<RecruiterTeamMember | null>(null);
  const [editPerms, setEditPerms] = useState(emptyPermissionMap);
  const [confirmRevoke, setConfirmRevoke] = useState<RecruiterTeamMember | null>(null);

  const ordered = useMemo(() => {
    const rank = (m: RecruiterTeamMember) =>
      m.isOwner ? 0 : m.status === 'revoked' ? 2 : 1;
    return [...team.members].sort((a, b) => rank(a) - rank(b));
  }, [team.members]);

  if (!viewAllowed) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="recruiter-team-unavailable"
        className="flex min-h-[30vh] items-center justify-center py-10 text-sm text-muted-foreground"
      >
        Team management is unavailable for your account.
      </div>
    );
  }

  const seat = team.seatStatus;

  const showInviteUrl = (payload: Record<string, unknown>) => {
    const token = typeof payload.invite_token === 'string' ? payload.invite_token : null;
    if (!token) return;
    setInviteUrl(`${window.location.origin}/recruiter/invite/${token}`);
  };

  const copyInviteUrl = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast({ title: 'Invitation link copied' });
    } catch {
      toast({ title: 'Copy the link manually', variant: 'destructive' });
    }
  };

  const submitInvite = async () => {
    try {
      const payload = await team.inviteMember.mutateAsync({
        email: inviteEmail.trim(),
        role: inviteRole,
        permissions: { ...invitePerms, applications_manage_notes: false },
      });
      showInviteUrl(payload);
      setInviteOpen(false);
      setInviteEmail('');
      setInvitePerms(emptyPermissionMap());
      toast({ title: 'Invitation created' });
    } catch {
      toast({ title: 'Unable to create invitation', variant: 'destructive' });
    }
  };

  const refreshInvite = async (member: RecruiterTeamMember) => {
    try {
      const payload = await team.inviteMember.mutateAsync({
        email: member.inviteEmail,
        role: member.role,
        permissions: { ...member.permissions },
      });
      showInviteUrl(payload);
      toast({ title: 'Invitation link refreshed' });
    } catch {
      toast({ title: 'Unable to refresh invitation', variant: 'destructive' });
    }
  };

  const submitPermissions = async () => {
    if (!editMember) return;
    try {
      await team.setPermissions.mutateAsync({
        membershipId: editMember.membershipId,
        permissions: {
          ...editPerms,
          applications_manage_notes: editMember.permissions.applications_manage_notes,
        },
      });
      setEditMember(null);
      toast({ title: 'Permissions updated' });
    } catch {
      toast({ title: 'Unable to update permissions', variant: 'destructive' });
    }
  };

  const changeRole = async (member: RecruiterTeamMember, role: string) => {
    try {
      await team.setRole.mutateAsync({ membershipId: member.membershipId, role });
      toast({ title: 'Role label updated', description: 'Role labels grant no permissions.' });
    } catch {
      toast({ title: 'Unable to update role', variant: 'destructive' });
    }
  };

  const doRevoke = async () => {
    if (!confirmRevoke) return;
    try {
      await team.revokeMember.mutateAsync({ membershipId: confirmRevoke.membershipId });
      setConfirmRevoke(null);
      toast({ title: 'Access revoked' });
    } catch {
      toast({ title: 'Unable to revoke access', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-5" data-testid="recruiter-team-panel">
      <div className="flex flex-wrap items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
          </Button>
        )}
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Recruiter Team
          </p>
          <h2 className="text-xl font-black tracking-tight text-foreground break-words">
            {companyName}
          </h2>
        </div>
      </div>

      {/* Seat status — server RPC is the only source of seat truth. */}
      <Card className="p-5 border-border/60" data-testid="recruiter-team-seat-card">
        <div className="flex items-start gap-3">
          <Users className="mt-0.5 h-5 w-5 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-foreground">Workspace seats</h3>
            {team.isLoading && (
              <p className="mt-1 text-sm text-muted-foreground">Loading seat status…</p>
            )}
            {!team.isLoading && seat && (
              <>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {seat.occupiedSeats} of {seat.seatLimit} seats used
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  The workspace owner is included in this count, and active members plus
                  unexpired pending invitations each consume a seat.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Available seats: {seat.availableSeats}
                </p>
                {seat.seatLimit === 1 && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Your current recruiter Team capacity is owner-only.
                  </p>
                )}
                {!seat.withinLimit && (
                  <Alert variant="destructive" className="mt-3">
                    <AlertDescription>
                      This workspace exceeds its current seat allowance. Delegated staff
                      permissions are paused by backend enforcement until the owner brings the
                      workspace back within limit.
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
            {!team.isLoading && !seat && (
              <p className="mt-1 text-sm text-muted-foreground">Seat status unavailable.</p>
            )}
          </div>
          {manageAllowed && (
            <Button
              size="sm"
              data-testid="team-invite-button"
              disabled={!seat?.canInvite}
              onClick={() => {
                setInvitePerms(emptyPermissionMap());
                setInviteEmail('');
                setInviteRole('recruiter_staff');
                setInviteOpen(true);
              }}
            >
              <UserPlus className="mr-1.5 h-4 w-4" /> Invite
            </Button>
          )}
        </div>
      </Card>

      {inviteUrl && (
        <Card className="p-4 border-primary/40" data-testid="team-invite-url-card">
          <p className="text-sm font-semibold text-foreground">One-time invitation link</p>
          <p className="mt-1 break-all text-xs text-muted-foreground">{inviteUrl}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            The recipient must sign in using the exact invited email address.
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={copyInviteUrl}>
            <Copy className="mr-1.5 h-4 w-4" /> Copy link
          </Button>
        </Card>
      )}

      {/* Members */}
      <Card className="p-5 border-border/60">
        <h3 className="mb-3 text-base font-bold text-foreground">Members</h3>
        {team.isLoading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading team…
          </div>
        )}
        {!team.isLoading && ordered.length === 0 && (
          <p className="py-4 text-sm text-muted-foreground">No team members yet.</p>
        )}
        <div className="space-y-3">
          {ordered.map((m) => {
            const mutable = manageAllowed && !m.isOwner && (m.status === 'pending' || m.status === 'active');
            return (
              <div
                key={m.membershipId}
                data-testid={`team-member-row-${m.membershipId}`}
                className="rounded-lg border border-border/60 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-all text-sm font-semibold text-foreground">
                    {m.inviteEmail || 'Team member'}
                  </span>
                  {m.isOwner ? (
                    <Badge variant="secondary" data-testid="team-owner-badge">
                      <ShieldCheck className="mr-1 h-3 w-3" /> Owner · Full access
                    </Badge>
                  ) : (
                    <>
                      <Badge variant="outline">
                        {m.role === 'recruiter_admin' ? 'Admin' : 'Staff'} label
                      </Badge>
                      <Badge variant={m.status === 'active' ? 'default' : 'outline'}>
                        {m.status === 'revoked'
                          ? 'Revoked'
                          : m.isExpiredPending
                            ? 'Expired invite'
                            : m.status === 'pending'
                              ? 'Pending'
                              : 'Active'}
                      </Badge>
                    </>
                  )}
                </div>
                {!m.isOwner && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {m.permissionCount} permission{m.permissionCount === 1 ? '' : 's'} · invited{' '}
                    {fmt(m.invitedAt)}
                    {m.acceptedAt ? ` · accepted ${fmt(m.acceptedAt)}` : ''}
                    {m.revokedAt ? ` · revoked ${fmt(m.revokedAt)}` : ''}
                  </p>
                )}
                {m.isOwner && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Owner membership cannot be modified.
                  </p>
                )}

                {mutable && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Select value={m.role} onValueChange={(v) => void changeRole(m, v)}>
                      <SelectTrigger className="h-9 w-[220px]" aria-label="Descriptive role label">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`team-edit-permissions-${m.membershipId}`}
                      onClick={() => {
                        setEditMember(m);
                        setEditPerms({ ...m.permissions });
                      }}
                    >
                      Edit permissions
                    </Button>
                    {m.status === 'pending' && (
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`team-refresh-invite-${m.membershipId}`}
                        onClick={() => void refreshInvite(m)}
                      >
                        Refresh invite link
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      data-testid={`team-revoke-${m.membershipId}`}
                      onClick={() => setConfirmRevoke(m)}
                    >
                      Revoke
                    </Button>
                  </div>
                )}
                {mutable && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Role labels are descriptive only and grant no permissions.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>
              Permissions start fully off. Role labels are descriptive only.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="team-invite-email">Email</Label>
              <Input
                id="team-invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Descriptive role label</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <PermissionEditor
              value={invitePerms}
              baseline={emptyPermissionMap()}
              isOwnerActor={isOwnerActor}
              actorPermissions={actorPermissions}
              onChange={setInvitePerms}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitInvite()}
              disabled={!inviteEmail.trim() || team.inviteMember.isPending}
            >
              Create invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permissions dialog */}
      <Dialog open={!!editMember} onOpenChange={(o) => !o && setEditMember(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit permissions</DialogTitle>
            <DialogDescription>
              Access is enforced by the server; these controls only request a change.
            </DialogDescription>
          </DialogHeader>
          {editMember && (
            <PermissionEditor
              value={editPerms}
              baseline={editMember.permissions}
              isOwnerActor={isOwnerActor}
              actorPermissions={actorPermissions}
              onChange={setEditPerms}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMember(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitPermissions()}
              disabled={team.setPermissions.isPending}
            >
              Save permissions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <Dialog open={!!confirmRevoke} onOpenChange={(o) => !o && setConfirmRevoke(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke workspace access?</DialogTitle>
            <DialogDescription>
              {confirmRevoke?.inviteEmail} will immediately lose access to this recruiter
              workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void doRevoke()}
              disabled={team.revokeMember.isPending}
            >
              Revoke access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default RecruiterTeamPanel;
