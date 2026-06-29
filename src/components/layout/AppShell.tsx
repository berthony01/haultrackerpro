import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Phase 6C — Shared dark-navy app shell wrapper for standalone authenticated
 * pages (assistant, agency, driver control surfaces) that don't render inside
 * the main dashboard `Index.tsx` shell. Activates the same `.app-shell` /
 * `body.app-shell-active` tokens so Radix portals (Sheet, Dialog, Popover,
 * Toast) inherit the dark theme and pages stop rendering as light-theme
 * islands.
 */
export function AppShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    document.body.classList.add('app-shell-active');
    return () => document.body.classList.remove('app-shell-active');
  }, []);

  return (
    <div className={cn('app-shell min-h-screen bg-background text-foreground', className)}>
      {children}
    </div>
  );
}

export default AppShell;
