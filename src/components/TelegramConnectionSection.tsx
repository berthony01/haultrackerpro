/**
 * Phase TG-2E3-A — shared Telegram account-linking UI (candidate).
 *
 * Mounted once in the driver Settings surface and once in the recruiter
 * Settings surface. No backend, migration, Edge Function, Telegram API call,
 * chat binding, or dispatch logic lives here. The raw link token is never
 * rendered, stored, or logged.
 */
import { useState } from 'react';
import { Send, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTelegramLink, TELEGRAM_BOT_USERNAME } from '@/hooks/useTelegramLink';

/**
 * Local test seam (allowlisted file only). Same-tab navigation is performed
 * through this indirection so focused tests can observe the handoff without
 * mocking jsdom's read-only location. The URL is passed straight through and
 * never stored.
 */
export const telegramHandoff = {
  navigate: (url: string) => {
    window.location.assign(url);
  },
};

export function TelegramConnectionSection() {
  const {
    connected,
    previouslyConnected,
    linkedAt,
    isLoading,
    refetch,
    connect,
    disconnect,
    isConnecting,
    isDisconnecting,
    isAwaitingConfirmation,
  } = useTelegramLink();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [handoffFailed, setHandoffFailed] = useState(false);

  const handleConnect = async () => {
    // Same-tab handoff: no popup, no about:blank, no retained window handle.
    // The deep link exists only as the immediate callback argument.
    const result = await connect((url) => {
      telegramHandoff.navigate(url);
    });
    if (!result.ok) {
      setHandoffFailed(true);
      toast.error(result.message);
    } else {
      setHandoffFailed(false);
    }
  };



  const handleDisconnect = async () => {
    const result = await disconnect();
    setConfirmDisconnect(false);
    if (result.ok) {
      toast.success('Telegram disconnected');
    } else {
      toast.error(result.message);
    }
  };

  const formattedLinkedAt = linkedAt ? new Date(linkedAt).toLocaleDateString() : null;

  return (
    <div className="premium-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-label flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" aria-hidden="true" /> Telegram
        </p>
        {isLoading ? (
          <Skeleton className="h-5 w-24 rounded-full" />
        ) : connected ? (
          <Badge variant="default">Connected</Badge>
        ) : (
          <Badge variant="secondary">Not connected</Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Connecting lets HaulTracker Pro securely recognize this account inside the HaulTracker Pro
        Dispatch bot (@{TELEGRAM_BOT_USERNAME}) on Telegram.
      </p>

      {isLoading ? (
        <Skeleton className="h-11 w-full rounded-xl" />
      ) : connected ? (
        <div className="space-y-2">
          {formattedLinkedAt && (
            <p className="text-xs text-muted-foreground">Connected on {formattedLinkedAt}</p>
          )}
          <Button
            variant="outline"
            className="w-full h-11 rounded-xl font-bold"
            aria-label="Disconnect Telegram"
            disabled={isDisconnecting}
            onClick={() => setConfirmDisconnect(true)}
          >
            {isDisconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Disconnect
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {previouslyConnected && formattedLinkedAt && (
            <p className="text-xs text-muted-foreground">Previously connected on {formattedLinkedAt}</p>
          )}
          <Button
            className="w-full h-11 rounded-xl font-bold gap-2"
            aria-label={previouslyConnected ? 'Reconnect Telegram' : 'Connect Telegram'}
            disabled={isConnecting}
            onClick={handleConnect}
          >
            {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {previouslyConnected ? 'Reconnect Telegram' : 'Connect Telegram'}
          </Button>
          {isAwaitingConfirmation && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Waiting for Telegram confirmation…</p>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                aria-label="Refresh Telegram connection status"
                onClick={() => void refetch()}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh status
              </Button>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Telegram?</AlertDialogTitle>
            <AlertDialogDescription>
              Telegram will stop recognizing this HaulTracker Pro account. This does not delete any
              of your HaulTracker Pro data. You can reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDisconnecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDisconnecting}
              onClick={(e) => {
                e.preventDefault();
                void handleDisconnect();
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>

      </AlertDialog>
    </div>
  );
}
