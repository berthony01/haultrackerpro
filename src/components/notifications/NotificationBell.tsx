import { useState } from 'react';
import { Bell } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/hooks/useNotifications';
import { NotificationCenter } from './NotificationCenter';

interface Props {
  onNavigate?: (page: string) => void;
}

export function NotificationBell({ onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const { unreadCount } = useNotifications();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
          className="relative text-muted-foreground hover:text-foreground rounded-xl h-10 w-10"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-4 text-center shadow-primary">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(380px,calc(100vw-1rem))] p-0 border-border/60 bg-card shadow-xl"
      >
        <NotificationCenter
          onClose={() => setOpen(false)}
          onNavigate={onNavigate}
        />
      </PopoverContent>
    </Popover>
  );
}
