import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Home, PauseCircle, PlayCircle, RefreshCcw, Lock, ChevronRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useRecurringExpenses, isTemplateActive } from '@/hooks/useRecurringExpenses';
import { useHomeTimeMode } from '@/hooks/useHomeTimeMode';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';

interface HomeTimeDashboardCardProps {
  isPro: boolean;
  isTrialing?: boolean;
  onNavigate?: (page: string) => void;
}

/**
 * Compact dashboard card surfacing Home Time Mode + a one-tap shortcut to the
 * Recurring Expenses page. Kept lightweight so it doesn't crowd the dashboard.
 */
export function HomeTimeDashboardCard({ isPro, isTrialing = false, onNavigate }: HomeTimeDashboardCardProps) {
  const { templates } = useRecurringExpenses();
  const { isActive, startedAt, start, end, isPending } = useHomeTimeMode();

  const [showStart, setShowStart] = useState(false);
  const [showEnd, setShowEnd] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const hasAccess = isPro || isTrialing;
  const activeCount = templates.filter(isTemplateActive).length;
  const pausedCount = templates.length - activeCount;

  // Hide entirely if user is free AND has no templates AND home time isn't on —
  // nothing useful to show yet.
  if (!hasAccess && templates.length === 0 && !isActive) return null;

  return (
    <>
      <Card className={`shadow-card transition-colors ${isActive ? 'border-primary/40 bg-primary/5' : ''}`}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className={`rounded-xl p-2.5 shrink-0 ${isActive ? 'bg-primary/15' : 'bg-muted'}`}>
              <Home className={`h-5 w-5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-sm">Home Time Mode</p>
                {isActive && <Badge variant="default" className="text-[10px]">Active</Badge>}
                {!hasAccess && <Badge variant="outline" className="text-[10px] gap-1"><Lock className="h-2.5 w-2.5" /> Pro</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                {isActive
                  ? 'Recurring road expenses are paused. Resume when you head back out.'
                  : templates.length === 0
                  ? 'Heading home? Add a recurring expense first, then pause them all in one tap while off the road.'
                  : 'Heading home? Pause your recurring expenses while you are off the road.'}
              </p>
              {isActive && startedAt && (
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                  Started {format(parseISO(startedAt), 'MMM d, yyyy')}
                </p>
              )}
            </div>
            {isActive ? (
              <Button
                size="sm"
                className="shrink-0 rounded-xl font-bold gap-1.5"
                onClick={() => setShowEnd(true)}
                disabled={isPending}
              >
                <PlayCircle className="h-4 w-4" /> Back on Road
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 rounded-xl font-bold gap-1.5"
                onClick={() => {
                  if (!hasAccess) { setShowUpgrade(true); return; }
                  if (activeCount === 0) {
                    onNavigate?.('recurring_expenses');
                    return;
                  }
                  setShowStart(true);
                }}
                disabled={isPending}
              >
                <PauseCircle className="h-4 w-4" /> Start
              </Button>
            )}
          </div>

          {/* Recurring shortcut — only when there are templates to manage */}
          {templates.length > 0 && onNavigate && (
            <button
              onClick={() => onNavigate('recurring_expenses')}
              className="mt-3 w-full flex items-center justify-between gap-2 rounded-xl bg-muted/50 hover:bg-muted px-3 py-2 transition-colors text-left active:scale-[0.99]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <RefreshCcw className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-bold truncate">
                  Recurring Expenses
                </span>
                <span className="text-[11px] text-muted-foreground truncate">
                  {activeCount} active{pausedCount > 0 ? ` · ${pausedCount} paused` : ''}
                </span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showStart} onOpenChange={setShowStart}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start Home Time?</AlertDialogTitle>
            <AlertDialogDescription>
              This will pause all {activeCount} active recurring expense{activeCount === 1 ? '' : 's'}. No new expenses will be auto-generated until you tap "Back on the Road". Templates you previously paused manually will stay paused.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => start({ onDone: () => setShowStart(false) })}>
              Start Home Time
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showEnd} onOpenChange={setShowEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Back on the Road?</AlertDialogTitle>
            <AlertDialogDescription>
              This resumes the recurring expenses that Home Time Mode paused. Manually-paused templates will stay paused. Skipped months won't be backfilled — generation picks up from this month forward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => end({ onDone: () => setShowEnd(false) })}>
              Resume Recurring
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProUpgradeModal open={showUpgrade} onOpenChange={setShowUpgrade} featureName="Home Time Mode" />
    </>
  );
}
