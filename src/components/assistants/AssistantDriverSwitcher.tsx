import { useActingContext } from '@/hooks/useActingContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ChevronDown, UserCog, X } from 'lucide-react';

/**
 * Header / banner control that lets an assistant who manages two or more
 * drivers switch between them without leaving the current workflow.
 *
 * UI convenience only — every read and write is enforced by RLS/RPC server-side.
 */
export function AssistantDriverSwitcher({ compact = false }: { compact?: boolean }) {
  const { managedDrivers, actingDriver, beginActingAs, exitActingAs } = useActingContext();
  if (managedDrivers.length < 2) return null;

  const label = actingDriver
    ? actingDriver.driver_name || actingDriver.driver_email
    : 'Pick driver';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={
            compact
              ? 'h-7 text-amber-950 hover:bg-amber-600/40'
              : 'gap-1.5'
          }
        >
          <UserCog className="h-3.5 w-3.5" />
          <span className="max-w-[140px] truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Switch driver</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {managedDrivers.map((d) => {
          const active = actingDriver?.driver_user_id === d.driver_user_id;
          return (
            <DropdownMenuItem
              key={d.delegate_id}
              onSelect={() => beginActingAs(d.driver_user_id)}
              className={active ? 'bg-accent/60' : ''}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {d.driver_name || d.driver_email}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {d.driver_email}
                </div>
              </div>
            </DropdownMenuItem>
          );
        })}
        {actingDriver && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={exitActingAs}>
              <X className="mr-2 h-3.5 w-3.5" />
              Exit assistant mode
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
