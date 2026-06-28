import { useActingContext } from '@/hooks/useActingContext';
import { Button } from '@/components/ui/button';
import { UserCog, X } from 'lucide-react';

/**
 * Persistent banner shown whenever the signed-in user is acting on behalf of
 * a driver. Renders nothing in self-mode.
 */
export function ActingAsBanner() {
  const { actingDriver, exitActingAs } = useActingContext();
  if (!actingDriver) return null;
  return (
    <div className="sticky top-0 z-50 w-full bg-amber-500/95 text-amber-950 border-b border-amber-700/40">
      <div className="container mx-auto flex items-center justify-between gap-3 px-3 py-2 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <UserCog className="h-4 w-4 shrink-0" />
          <span className="truncate">
            Acting for <strong>{actingDriver.driver_name ?? actingDriver.driver_email}</strong>.
            All changes save to their account.
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-amber-950 hover:bg-amber-600/40"
          onClick={exitActingAs}
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Exit assistant mode
        </Button>
      </div>
    </div>
  );
}
