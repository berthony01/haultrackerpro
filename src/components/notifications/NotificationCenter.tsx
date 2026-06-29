import { CheckCheck, Inbox, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  useNotificationList,
  useNotificationActions,
  type NotificationRow,
} from '@/hooks/useNotifications';

interface Props {
  onClose?: () => void;
  onNavigate?: (page: string) => void;
}

function routeForNotification(n: NotificationRow): string | null {
  switch (n.type) {
    // Recruiter inbox
    case 'application_submitted':
    case 'contact_request_approved':
    case 'contact_request_declined':
      return 'recruiter-access:applications';
    // Driver-facing
    case 'contact_request_created':
    case 'application_status_updated':
      return 'opportunities';
    // Recruiter profile review
    case 'recruiter_profile_approved':
    case 'recruiter_profile_rejected':
      return 'recruiter-access';
    // Opportunity admin review (recruiter)
    case 'opportunity_reviewed':
      return 'recruiter-access:manager';
    // Referrals — recruiter-side notifications go to recruiter manager;
    // driver-side referral notifications go to opportunities.
    case 'referral_created':
      return 'recruiter-access:manager';
    case 'referral_status_updated':
    case 'referral_paid_externally_marked':
    case 'referred_driver_linked':
      return 'opportunities';
    default:
      if (n.type.startsWith('contract_')) return 'contracts';
      // Phase 4B: assistant + agency notifications
      if (n.type === 'assistant_invited' || n.type === 'assistant_revoked') {
        return 'driver-assistant-control';
      }
      if (n.type === 'assistant_accepted') return 'settings';
      if (
        n.type === 'agency_client_request_approved' ||
        n.type === 'agency_client_request_declined' ||
        n.type === 'agency_client_request_cancelled' ||
        n.type === 'agency_client_request_converted_to_client' ||
        n.type === 'agency_delegation_pending' ||
        n.type === 'agency_work_item_waiting_on_driver'
      ) {
        return 'driver-assistant-control';
      }
      if (n.type.startsWith('agency_')) return 'agency-dashboard';
      return null;
  }
}

export function NotificationCenter({ onClose, onNavigate }: Props) {
  const { notifications, isLoading } = useNotificationList();
  const { markRead, markAllRead } = useNotificationActions();
  const unreadCount = notifications.reduce((n, x) => (x.read_at ? n : n + 1), 0);

  const handleClick = (n: NotificationRow) => {
    if (!n.read_at) markRead.mutate(n.id);
    const route = routeForNotification(n);
    if (route && onNavigate) {
      onNavigate(route);
      onClose?.();
    }
  };

  return (
    <div className="flex flex-col max-h-[min(70vh,500px)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-foreground">Notifications</h3>
          {unreadCount > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
              {unreadCount} new
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm font-semibold text-foreground">No notifications yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              You'll see updates here when something needs your attention.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {notifications.map((n) => {
              const isUnread = !n.read_at;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    className={`w-full text-left px-4 py-3 transition-colors hover:bg-muted/40 ${
                      isUnread ? 'bg-primary/5' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${
                          isUnread ? 'bg-primary' : 'bg-transparent'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm leading-tight ${isUnread ? 'font-bold text-foreground' : 'font-semibold text-foreground/90'}`}>
                          {n.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                        <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
