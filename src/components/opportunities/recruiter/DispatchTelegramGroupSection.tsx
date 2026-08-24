/**
 * Phase TG-2F-C1 — recruiter-owner "Dispatch Telegram Group" connection UX
 * (candidate).
 *
 * Scope guard: this component issues a one-time bind CODE only. It performs no
 * Telegram API call, creates no chat binding, reads no binding state, and
 * makes no dispatch decision. The server RPCs remain authoritative — the
 * permission check here is UX only.
 *
 * SECURITY: the raw bind token is rendered from hook memory and copied to the
 * clipboard on explicit user action. It is never persisted, never logged, and
 * never placed in a Telegram URL.
 */
import { useState } from 'react';
import { Users, RefreshCw, Loader2, Copy, Check, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useTelegramLink } from '@/hooks/useTelegramLink';
import {
  useTelegramDispatchBind,
  formatRemaining,
  TELEGRAM_DISPATCH_BOT_USERNAME,
} from '@/hooks/useTelegramDispatchBind';
import { useRecruiterStaffPermissions } from '@/hooks/recruiter/useRecruiterStaffPermissions';

/**
 * Local test seam (allowlisted file only). Clipboard access is performed
 * through this indirection so focused tests can observe the copy without
 * mocking jsdom's read-only clipboard. The command is passed straight through
 * and never stored or logged.
 */
export const dispatchBindClipboard = {
  write: async (text: string): Promise<boolean> => {
    try {
      if (!navigator?.clipboard?.writeText) return false;
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },
};

interface Props {
  recruiterId: string | null | undefined;
}

export function DispatchTelegramGroupSection({ recruiterId }: Props) {
  const { connected: personalTelegramConnected, isLoading: linkLoading } = useTelegramLink();
  const { canDispatchLoads, isLoading: permissionsLoading } =
    useRecruiterStaffPermissions(recruiterId ?? null);
  const { command, secondsRemaining, isExpired, isGenerating, generate } =
    useTelegramDispatchBind(recruiterId ?? null);
  const [copied, setCopied] = useState(false);

  const isLoading = linkLoading || permissionsLoading;
  const canGenerate = !!recruiterId && personalTelegramConnected && canDispatchLoads;

  const handleGenerate = async () => {
    setCopied(false);
    const result = await generate();
    if (result.ok === false) toast.error(result.message);
  };

  const handleCopy = async () => {
    if (!command) return;
    const ok = await dispatchBindClipboard.write(command);
    if (ok) {
      setCopied(true);
      toast.success('Command copied');
    } else {
      toast.error('Could not copy. Select the command and copy it manually.');
    }
  };

  return (
    <div className="premium-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-label flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" aria-hidden="true" /> Dispatch Telegram group
        </p>
        {isLoading ? (
          <Skeleton className="h-5 w-24 rounded-full" />
        ) : canGenerate ? (
          <Badge variant="secondary">Ready to connect</Badge>
        ) : (
          <Badge variant="outline">Setup required</Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Connect a Telegram group to this recruiter workspace so dispatch can happen where your team
        already talks. You finish the connection inside Telegram — nothing here connects a group on
        its own.
      </p>

      {isLoading ? (
        <Skeleton className="h-11 w-full rounded-xl" />
      ) : (
        <>
          {!personalTelegramConnected && (
            <p className="text-xs text-destructive flex items-start gap-2" role="alert">
              <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              Connect your personal Telegram account above first. The group command must be sent
              from that same Telegram identity.
            </p>
          )}
          {personalTelegramConnected && !canDispatchLoads && (
            <p className="text-xs text-destructive flex items-start gap-2" role="alert">
              <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              You do not have dispatch permission in this recruiter workspace.
            </p>
          )}

          <ol className="text-xs text-muted-foreground leading-relaxed space-y-1 list-decimal pl-4">
            <li>Make sure your personal Telegram account is connected above.</li>
            <li>
              Add <span className="font-semibold text-foreground">@{TELEGRAM_DISPATCH_BOT_USERNAME}</span>{' '}
              to the Telegram group you want to use.
            </li>
            <li>Generate a one-time connection command below and copy it.</li>
            <li>
              Paste that command into that group from your connected Telegram account. The code
              works once and expires in 15 minutes.
            </li>
          </ol>

          {command && !isExpired && (
            <div className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Command generated — complete the connection in Telegram
              </p>
              <p
                className="font-mono text-[11px] text-foreground break-all leading-relaxed"
                data-testid="dispatch-bind-command"
              >
                {command}
              </p>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 rounded-lg"
                  aria-label="Copy connection command"
                  onClick={handleCopy}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy command'}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Expires in {formatRemaining(secondsRemaining)}
                </span>
              </div>
            </div>
          )}

          {command && isExpired && (
            <p className="text-xs text-destructive" role="alert">
              That connection command expired. Generate a new one.
            </p>
          )}

          <Button
            className="w-full h-11 rounded-xl font-bold gap-2"
            aria-label={command ? 'Generate new connection command' : 'Generate connection command'}
            disabled={!canGenerate || isGenerating}
            onClick={handleGenerate}
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {command ? 'Generate new command' : 'Generate connection command'}
          </Button>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Generating a new command immediately cancels any earlier one.
          </p>
        </>
      )}
    </div>
  );
}
