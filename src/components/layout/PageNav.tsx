import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Home, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';


export interface PageNavCrumb {
  label: string;
  href?: string;
}

interface PageNavProps {
  /** Ordered breadcrumb trail. The last entry represents the current page and
   *  is rendered as plain text (no link), regardless of whether `href` is set. */
  trail?: PageNavCrumb[];
  /** Where the "Dashboard" home button should go. Defaults to `/dashboard`. */
  homeHref?: string;
  /** Hide the Back (history -1) button. Defaults to false. */
  hideBack?: boolean;
  className?: string;
}

/**
 * Shared top navigation strip for standalone authenticated pages. Provides:
 *  - A Back button (`history.back`) so users can always reverse their last step.
 *  - A persistent Dashboard home button so users can return to /dashboard from
 *    any page regardless of how deep they are.
 *  - A clickable breadcrumb trail showing where the user is and letting them
 *    jump back to any prior step.
 */
export function PageNav({
  trail = [],
  homeHref = '/dashboard',
  hideBack = false,
  className,
}: PageNavProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // React Router marks the initial history entry with key === 'default'.
  // If the user landed directly (notification deep-link, bookmark, auth
  // continuation, new tab), there is no safe in-app history to pop back to,
  // so fall back to the Dashboard instead of leaving the app.
  const hasSafeHistory = location.key !== 'default';

  const handleBack = () => {
    if (hasSafeHistory) {
      navigate(-1);
    } else {
      navigate(homeHref);
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
          onClick={() => navigate(-1)}
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
        <Link to={homeHref} aria-label="Go to Dashboard">
          <Home className="mr-1 h-4 w-4" />
          Dashboard
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
