import { useState, useEffect } from 'react';
import { Crown, TrendingUp, BarChart3, Mic, CalendarCheck, PieChart, X, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MilestoneNudgesProps {
  loadsCount: number;
  expensesCount: number;
  isPro: boolean;
  onUpgrade: () => void;
  onNavigate: (page: string) => void;
}

interface Nudge {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  cta: string;
  action: 'upgrade' | string;
  condition: (loads: number, expenses: number) => boolean;
}

const nudges: Nudge[] = [
  {
    id: 'scorecard_teaser',
    icon: Crown,
    title: 'Unlock Your Driver Score',
    description: 'See how you rank across RPM, deadhead, and consistency.',
    cta: 'View Scorecard',
    action: 'upgrade',
    condition: (l) => l >= 3,
  },
  {
    id: 'add_expenses_prompt',
    icon: BarChart3,
    title: 'Track Your Expenses',
    description: 'Add expenses to see your real net profit per load.',
    cta: 'Add Expense',
    action: 'add_expense',
    condition: (l, e) => l >= 2 && e === 0,
  },
  {
    id: 'rpm_trend_teaser',
    icon: TrendingUp,
    title: 'Your RPM Trend Is Building',
    description: 'Pro shows your rate-per-mile trend over time.',
    cta: 'See Trends',
    action: 'upgrade',
    condition: (l) => l >= 5,
  },
  {
    id: 'voice_logging_teaser',
    icon: Mic,
    title: 'Log Expenses by Voice',
    description: 'Pro members can speak their expenses — no typing needed.',
    cta: 'Try Voice',
    action: 'upgrade',
    condition: (_, e) => e >= 5,
  },
  {
    id: 'weekly_closeout_teaser',
    icon: CalendarCheck,
    title: 'Close Out Your Week',
    description: 'Lock in weekly summaries to catch underpayments.',
    cta: 'Learn More',
    action: 'upgrade',
    condition: (l) => l >= 10,
  },
  {
    id: 'expense_breakdown_teaser',
    icon: PieChart,
    title: 'See Where Your Money Goes',
    description: 'Pro unlocks full expense category breakdowns.',
    cta: 'Unlock Charts',
    action: 'upgrade',
    condition: (l) => l >= 20,
  },
];

export function MilestoneNudges({ loadsCount, expensesCount, isPro, onUpgrade, onNavigate }: MilestoneNudgesProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('htp_dismissed_nudges');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  // Don't show nudges for Pro users
  if (isPro) return null;

  const activeNudges = nudges.filter(
    n => n.condition(loadsCount, expensesCount) && !dismissedIds.has(n.id)
  );

  // Show at most 1 nudge at a time (highest priority = first match)
  const nudge = activeNudges[0];
  if (!nudge) return null;

  const handleDismiss = () => {
    const next = new Set(dismissedIds);
    next.add(nudge.id);
    setDismissedIds(next);
    localStorage.setItem('htp_dismissed_nudges', JSON.stringify([...next]));
  };

  const handleAction = () => {
    if (nudge.action === 'upgrade') {
      onUpgrade();
    } else {
      onNavigate(nudge.action);
    }
  };

  const Icon = nudge.icon;

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 mb-4 flex items-start gap-3">
      <div className="rounded-lg bg-primary/10 p-2 shrink-0 mt-0.5">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-foreground">{nudge.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{nudge.description}</p>
        <Button size="sm" className="h-7 text-xs font-bold gap-1 mt-2" onClick={handleAction}>
          {nudge.cta} <ArrowRight className="h-3 w-3" />
        </Button>
      </div>
      <button onClick={handleDismiss} className="text-muted-foreground/40 hover:text-muted-foreground shrink-0">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
