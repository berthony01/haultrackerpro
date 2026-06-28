import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useAssistants } from '@/hooks/useAssistants';
import {
  ASSISTANT_PERMISSION_KEYS,
  PERMISSION_DEFAULTS,
  PERMISSION_LABELS,
  type AssistantPermissionKey,
  type AssistantPermissions,
} from '@/lib/assistantPermissions';
import { useToast } from '@/hooks/use-toast';
import { UserPlus, Copy, Check } from 'lucide-react';

export function InviteAssistantDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [perms, setPerms] = useState<AssistantPermissions>(PERMISSION_DEFAULTS);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { invite } = useAssistants();
  const { toast } = useToast();

  function reset() {
    setEmail('');
    setPerms(PERMISSION_DEFAULTS);
    setInviteLink(null);
    setCopied(false);
  }

  function toggle(k: AssistantPermissionKey) {
    setPerms((p) => ({ ...p, [k]: !p[k] }));
  }

  async function handleSubmit() {
    try {
      const result = await invite.mutateAsync({ email: email.trim(), permissions: perms });
      const link = `${window.location.origin}/assistant/invite/${result.invite_token}`;
      setInviteLink(link);
      toast({ title: 'Invitation created', description: 'Share the link with your assistant.' });
    } catch (e: any) {
      toast({ title: 'Could not create invitation', description: e?.message ?? 'Unknown error', variant: 'destructive' });
    }
  }

  async function copyLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite assistant
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite an assistant</DialogTitle>
        </DialogHeader>

        {!inviteLink ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Invite someone you trust to help manage your loads, expenses, receipts, and reports.
              They will never see your billing, plan, or account settings.
            </p>

            <div className="space-y-2">
              <Label htmlFor="ai-email">Assistant email</Label>
              <Input
                id="ai-email"
                type="email"
                placeholder="assistant@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="space-y-2 rounded-md border p-3">
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
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={!email || invite.isPending}>
                {invite.isPending ? 'Creating…' : 'Create invitation'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              Share this link with <strong>{email}</strong>. They will need to sign in to HaulTrackerPro
              with that exact email to accept.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={inviteLink} className="font-mono text-xs" />
              <Button onClick={copyLink} variant="secondary" size="icon" aria-label="Copy link">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
