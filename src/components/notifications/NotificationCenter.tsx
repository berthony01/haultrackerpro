import { CheckCheck, Inbox, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications, type NotificationRow } from '@/hooks/useNotifications';

interface Props {
  onClose?: () => void;
  onNavigate?: (page: string) => void;
}

function routeForNotification(n: NotificationRow): string | null {
  const t = n.type;
  if (t.startsWith('application_') || t.startsWith('contact_request_')) {
    return 'recruiter-access:applications'; // recruiter side — driver side will be intercepted below
  }
  if (t.startsWith('contract_')) return 'contracts';
  if (t === 'recruiter_profile_approved' || t === 'recruiter_profile_rejected') return 'recruiter-access';
  if (t === 'opportunity_reviewed') return 'recruiter-access:manager';
  return null;
}

export function NotificationCenter({ onClose, onNavigate }: Props) {
  const { notifications, isLoading, unreadCount, markRead, markAllRead } = useNotifications();

  const handleClick = (n: NotificationRow) => {
    if (!n.read_at) markRead.mutate(n.id);
    const route = routeForNotification(n);
    if (route && onNavigate) {
      // For driver-facing application/contact events, route to opportunities instead
      if (
        (n.type.startsWith('application_') || n.type.startsWith('contact_request_')) &&
        route === 'recruiter-access:applications'
      ) {
        onNavigate('opportunities');
      } else {
        onNavigate(route);
      }
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
