import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Home, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';


export interface PageNavCrumb {
  label: string;
  href?: string;
}

export interface PageNavHome {
  /** Label for the home button. Defaults to "Dashboard". */
  label?: string;
  /** Destination route. Defaults to `/dashboard`. */
  to?: string;
}

interface PageNavProps {
  /** Ordered breadcrumb trail. The last entry represents the current page and
   *  is rendered as plain text (no link), regardless of whether `href` is set. */
  trail?: PageNavCrumb[];
  /** Where the "Dashboard" home button should go. Defaults to `/dashboard`.
   *  Kept for backwards compatibility — prefer `home`. */
  homeHref?: string;
  /** Override the home button label + destination. Use this on standalone
   *  workspaces (e.g. `/agency`, `/assistant`) so the home button returns to
   *  that workspace instead of the driver Dashboard. */
  home?: PageNavHome;
  /** Hide the Back (history -1) button. Defaults to false. */
  hideBack?: boolean;
  className?: string;
}

/**
 * Shared top navigation strip for standalone authenticated pages. Provides:
 *  - A Back button (`history.back`) so users can always reverse their last step.
 *  - A persistent home button so users can return to their workspace root
 *    (driver Dashboard by default, but overridable per workspace) from any
 *    page regardless of how deep they are.
 *  - A clickable breadcrumb trail showing where the user is and letting them
 *    jump back to any prior step.
 */
export function PageNav({
  trail = [],
  homeHref = '/dashboard',
  home,
  hideBack = false,
  className,
}: PageNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const resolvedHomeTo = home?.to ?? homeHref;
  const resolvedHomeLabel = home?.label ?? 'Dashboard';


  // React Router marks the initial history entry with key === 'default'.
  // If the user landed directly (notification deep-link, bookmark, auth
  // continuation, new tab), there is no safe in-app history to pop back to,
  // so fall back to the Dashboard instead of leaving the app.
  const hasSafeHistory = location.key !== 'default';

  const handleBack = () => {
    if (hasSafeHistory) {
      navigate(-1);
    } else {
      navigate(resolvedHomeTo);
    }
  };


  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground',
        className,
      )}
    >
      {!hideBack && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          aria-label={hasSafeHistory ? 'Go back' : `Back to ${resolvedHomeLabel}`}
          data-testid="pagenav-back"
          className="-ml-2 h-8 px-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
      )}


      <Button
        asChild
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-muted-foreground hover:text-foreground"
      >
        <Link to={resolvedHomeTo} aria-label={`Go to ${resolvedHomeLabel}`}>
          <Home className="mr-1 h-4 w-4" />
          {resolvedHomeLabel}
        </Link>
      </Button>


      {trail.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 min-w-0">
          {trail.map((crumb, i) => {
            const isLast = i === trail.length - 1;
            return (
              <span key={`${crumb.label}-${i}`} className="flex items-center gap-1 min-w-0">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
                {isLast || !crumb.href ? (
                  <span
                    className="truncate font-medium text-foreground"
                    aria-current={isLast ? 'page' : undefined}
                  >
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    to={crumb.href}
                    className="truncate hover:text-foreground hover:underline underline-offset-4"
                  >
                    {crumb.label}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>
      )}
    </div>
  );
}

export default PageNav;
