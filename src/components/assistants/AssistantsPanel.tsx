import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useAssistants, type AssistantRow } from '@/hooks/useAssistants';
import { InviteAssistantDialog } from './InviteAssistantDialog';
import { MyAgencyRequestsSection } from './MyAgencyRequestsSection';
import {
  ASSISTANT_PERMISSION_KEYS,
  PERMISSION_LABELS,
  type AssistantPermissionKey,
  type AssistantPermissions,
} from '@/lib/assistantPermissions';
import { Shield, Users } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { useToast } from '@/hooks/use-toast';

function StatusBadge({ status }: { status: AssistantRow['status'] }) {
  const map: Record<AssistantRow['status'], { label: string; variant: any }> = {
    pending: { label: 'Pending', variant: 'secondary' },
    active: { label: 'Active', variant: 'default' },
    revoked: { label: 'Revoked', variant: 'outline' },
    expired: { label: 'Expired', variant: 'outline' },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function PermissionEditor({ row }: { row: AssistantRow }) {
  const { updatePermissions } = useAssistants();
  const { toast } = useToast();
  const [perms, setPerms] = useState<AssistantPermissions>(row.permissions ?? {});
  const [open, setOpen] = useState(false);

  function toggle(k: AssistantPermissionKey) {
    setPerms((p) => ({ ...p, [k]: !p[k] }));
  }

  async function save() {
    try {
      await updatePermissions.mutateAsync({ id: row.id, permissions: perms });
      toast({ title: 'Permissions updated' });
      setOpen(false);
    } catch (e: any) {
      toast({ title: 'Could not update', description: e?.message, variant: 'destructive' });
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">Edit permissions</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Permissions for {row.invite_email}</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="space-y-2 rounded-md border p-3 my-2">
          {ASSISTANT_PERMISSION_KEYS.map((k) => (
            <label key={k} className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={!!perms[k]}
                onCheckedChange={() => toggle(k)}
                className="mt-0.5"
              />
              <span>{PERMISSION_LABELS[k]}</span>
            </label>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={save}>Save</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RevokeButton({ row }: { row: AssistantRow }) {
  const { revoke } = useAssistants();
  const { toast } = useToast();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive">Revoke</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke this assistant?</AlertDialogTitle>
          <AlertDialogDescription>
            {row.invite_email} will immediately lose access to your account. They will not be
            notified by us. You can invite them again later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={async () => {
              try {
                await revoke.mutateAsync(row.id);
                toast({ title: 'Access revoked' });
              } catch (e: any) {
                toast({ title: 'Could not revoke', description: e?.message, variant: 'destructive' });
              }
            }}
          >
            Revoke access
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function AssistantsPanel() {
  const { assistants, isLoading } = useAssistants();
  const { isPro } = useSubscription();

  const active = assistants.filter((a) => a.status === 'active');
  const pending = assistants.filter((a) => a.status === 'pending');
  const inactive = assistants.filter((a) => a.status === 'revoked' || a.status === 'expired');

  const atLimit = isPro === false && active.length >= 1;
  // Free plan rollout: 0 active. Pro: 1 active. Tighten or relax with plan tiers later.
  const allowedActive = isPro ? 1 : 0;
  const canInvite = active.length < allowedActive || (isPro && active.length + pending.length < allowedActive + 1);

  return (
    <div className="space-y-6">
      <div className="rounded-md border bg-muted/40 p-4 text-sm">
        <div className="flex items-start gap-2">
          <Shield className="mt-0.5 h-4 w-4 text-primary shrink-0" />
          <div className="space-y-2">
            <p className="font-medium">What assistants can and cannot do</p>
            <ul className="list-disc pl-5 text-muted-foreground space-y-1">
              <li>Can: enter loads, expenses, fuel, and pull reports — only with the permissions you grant.</li>
              <li>Cannot: see or change billing, cancel your subscription, delete your account, or invite other assistants.</li>
              <li>Their access ends the moment you click Revoke.</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5" />
            Your assistants
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {isPro
              ? `Pro plan: up to ${allowedActive} active assistant.`
              : 'Inviting assistants requires Pro.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => (window.location.href = '/driver/assistant-control')}
          >
            Open control center
          </Button>
          {isPro ? (
            <InviteAssistantDialog />
          ) : (
            <Button variant="outline" onClick={() => (window.location.href = '/pricing')}>
              Upgrade to invite
            </Button>
          )}
        </div>
      </div>

      {isPro && atLimit && (
        <p className="text-xs text-muted-foreground">
          You've reached the assistant limit for your plan. Revoke one to add another.
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : assistants.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assistants yet.</p>
      ) : (
        <div className="space-y-6">
          {[
            { title: 'Active', rows: active },
            { title: 'Pending', rows: pending },
            { title: 'Past', rows: inactive },
          ]
            .filter((g) => g.rows.length > 0)
            .map((g) => (
              <section key={g.title} className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">{g.title}</h3>
                <div className="rounded-md border divide-y">
                  {g.rows.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{row.invite_email}</span>
                          <StatusBadge status={row.status} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {Object.keys(row.permissions ?? {}).filter((k) => (row.permissions as any)[k]).length} permissions
                          {row.accepted_at && ` · joined ${new Date(row.accepted_at).toLocaleDateString()}`}
                          {row.last_active_at && ` · last active ${new Date(row.last_active_at).toLocaleDateString()}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {(row.status === 'active' || row.status === 'pending') && (
                          <>
                            <PermissionEditor row={row} />
                            <RevokeButton row={row} />
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}

      <div className="border-t pt-6">
        <MyAgencyRequestsSection />
        <p className="mt-3 text-xs text-muted-foreground">
          Note: an agency can only delegate work to a member who has already
          accepted their invite and signed in. Email-only invites cannot yet be
          delegated to your account.
        </p>
      </div>
    </div>
  );
}
