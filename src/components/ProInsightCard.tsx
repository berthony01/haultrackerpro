import { useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { getEffectiveDate } from '@/lib/loadUtils';
import { parseISO } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Crown, TrendingUp, BarChart3, Mic, PieChart, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@/lib/loadUtils';

interface ProInsightCardProps {
  loads: Load[];
  expenses: Expense[];
  isPro: boolean;
  isTrialing?: boolean;
  onNavigate?: (page: string) => void;
}

interface InsightData {
  icon: React.ElementType;
  iconColor: string;
  title: string;
  metric: string;
  metricLabel: string;
  description: string;
  cta: string;
  ctaPage: string;
}

export function ProInsightCard({ loads, expenses, isPro, isTrialing = false, onNavigate }: ProInsightCardProps) {
  const navigate = useNavigate();

  const insight = useMemo((): InsightData | null => {
    // Don't compute for Pro or trialing users, or users with < 3 loads
    if (isPro || isTrialing || loads.length < 3) return null;
    const now = new Date();

    // Last 30 days data
    const recentLoads = loads.filter(l => {
      const d = parseISO(getEffectiveDate(l));
      return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) <= 30;
    });

    const recentExpenses = expenses.filter(e => {
      const d = parseISO(e.expense_date);
      return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) <= 30;
    });

    const totalMiles = recentLoads.reduce((s, l) => s + Number(l.loaded_miles), 0);
    const totalRev = recentLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
    const totalDH = recentLoads.reduce((s, l) => s + Number(l.deadhead_miles), 0);
    const totalExp = recentExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const totalAllMiles = totalMiles + totalDH;
    const dhPct = totalAllMiles > 0 ? (totalDH / totalAllMiles) * 100 : 0;
    const rpm = totalMiles > 0 ? totalRev / totalMiles : 0;
    const expRatio = totalRev > 0 ? (totalExp / totalRev) * 100 : 0;

    // Compute estimated scorecard score (simplified version)
    const rpmScore = Math.min(25, Math.round((rpm / 3) * 25));
    const dhScore = Math.max(0, Math.min(20, Math.round((1 - dhPct / 40) * 20)));
    const expScore = totalRev > 0 ? Math.max(0, Math.min(20, Math.round((1 - expRatio / 100) * 20))) : 10;
    const streakScore = Math.min(15, Math.round((Math.min(loads.length, 10) / 10) * 15));
    const trendScore = 10; // Neutral estimate
    const totalScore = rpmScore + dhScore + expScore + streakScore + trendScore;

    // Pick the most impactful insight to show based on user's data
    const insights: InsightData[] = [];

    // Always show the scorecard score if we have enough data
    if (recentLoads.length >= 3) {
      insights.push({
        icon: Crown,
        iconColor: 'text-warning',
        title: 'Your estimated Driver Score',
        metric: `${totalScore}/100`,
        metricLabel: totalScore >= 80 ? 'Platinum tier' : totalScore >= 60 ? 'Gold tier' : totalScore >= 40 ? 'Silver tier' : 'Bronze tier',
        description: 'Upgrade to see your full breakdown — which metrics are pulling you up and which are dragging you down.',
        cta: 'See Full Scorecard',
        ctaPage: 'scorecard',
      });
    }

    // Show deadhead insight if it's high
    if (dhPct > 15 && totalAllMiles > 100) {
      insights.push({
        icon: TrendingUp,
        iconColor: 'text-primary',
        title: 'Your deadhead is costing you',
        metric: `${dhPct.toFixed(1)}%`,
        metricLabel: `${Math.round(totalDH)} empty miles this month`,
        description: "Pro's Deadhead % Chart shows your trend over time so you can see if it's improving or getting worse.",
        cta: 'See Deadhead Trend',
        ctaPage: 'reports',
      });
    }

    // Show expense insight if they're logging expenses
    if (totalExp > 0 && totalRev > 0) {
      insights.push({
        icon: PieChart,
        iconColor: 'text-primary',
        title: 'Your expense breakdown',
        metric: `${expRatio.toFixed(0)}%`,
        metricLabel: `${formatCurrency(totalExp)} of ${formatCurrency(totalRev)} revenue`,
        description: "Pro's Expense Breakdown Chart shows exactly which categories eat the most profit — fuel, tolls, maintenance, or something else.",
        cta: 'See Expense Breakdown',
        ctaPage: 'reports',
      });
    }

    // Show voice logging pitch if they log lots of expenses manually
    if (expenses.length >= 5) {
      insights.push({
        icon: Mic,
        iconColor: 'text-primary',
        title: `You've logged ${expenses.length} expenses by hand`,
        metric: `${expenses.length}`,
        metricLabel: 'expenses typed manually',
        description: 'Pro lets you speak expenses out loud — "$85 fuel at Pilot" — and AI logs it instantly. No more typing at truck stops.',
        cta: 'Try AI Voice Logging',
        ctaPage: 'scorecard',
      });
    }

    // Show RPM chart pitch
    if (recentLoads.length >= 5 && rpm > 0) {
      insights.push({
        icon: BarChart3,
        iconColor: 'text-primary',
        title: 'Your RPM this month',
        metric: `$${rpm.toFixed(2)}/mi`,
        metricLabel: `across ${recentLoads.length} loads`,
        description: "Pro's RPM Trend Chart shows how your rate changes week over week — so you can spot when to negotiate harder.",
        cta: 'See RPM Trend',
        ctaPage: 'reports',
      });
    }

    if (insights.length === 0) return null;

    // Rotate through insights based on day of month so it doesn't feel stale
    const dayIndex = new Date().getDate() % insights.length;
    return insights[dayIndex];
  }, [loads, expenses]);

  if (!insight) return null;

  const Icon = insight.icon;

  return (
    <Card className="shadow-card border-primary/20 overflow-hidden">
      <CardContent className="p-0">
        {/* Header strip */}
        <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: 'hsl(25, 95%, 53%, 0.08)' }}>
          <Crown className="h-3.5 w-3.5 text-warning" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-warning">What You're Missing</span>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 bg-primary/10">
              <Icon className={`h-5 w-5 ${insight.iconColor}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">{insight.title}</p>
              <p className="text-2xl font-black font-heading leading-tight">{insight.metric}</p>
              <p className="text-[11px] text-muted-foreground">{insight.metricLabel}</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            {insight.description}
          </p>

          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 rounded-xl font-bold gap-1.5 h-9 text-xs"
              onClick={() => navigate('/pricing')}
            >
              <Crown className="h-3.5 w-3.5" /> Upgrade to Pro
            </Button>
            {onNavigate && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl font-bold gap-1 h-9 text-xs border-primary/30 text-primary"
                onClick={() => onNavigate(insight.ctaPage)}
              >
                {insight.cta} <ArrowRight className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
