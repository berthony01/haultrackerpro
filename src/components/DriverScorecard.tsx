import { ScorecardResult, Tier } from '@/hooks/useDriverScorecard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, Trophy, TrendingUp, Route, DollarSign, Flame, Target, Lock, Lightbulb } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface DriverScorecardProps {
  scorecard: ScorecardResult;
  onBack: () => void;
  isPro?: boolean;
}

const tierConfig: Record<Tier, { color: string; bg: string; emoji: string }> = {
  Bronze: { color: 'text-orange-700', bg: 'bg-orange-100 dark:bg-orange-900/30', emoji: '🥉' },
  Silver: { color: 'text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800/40', emoji: '🥈' },
  Gold: { color: 'text-yellow-600', bg: 'bg-yellow-100 dark:bg-yellow-900/30', emoji: '🥇' },
  Platinum: { color: 'text-primary', bg: 'bg-primary/10', emoji: '💎' },
};

const metricIcons = [TrendingUp, Route, DollarSign, Target, Flame];

export function DriverScorecard({ scorecard, onBack, isPro = false }: DriverScorecardProps) {
  const navigate = useNavigate();
  const tier = tierConfig[scorecard.tier];

  if (!isPro) {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-black font-heading">Driver Scorecard</h1>
            <p className="text-sm text-muted-foreground">Your performance at a glance</p>
          </div>
        </div>

        <Card className="shadow-card">
          <CardContent className="py-12 text-center">
            <Lock className="h-12 w-12 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-lg font-bold">Unlock Your Scorecard</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
              See your overall driver score, tier ranking, and detailed performance metrics across 5 categories.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {['RPM', 'Deadhead', 'Expenses', 'Profit', 'Streak'].map(m => (
                <Badge key={m} variant="outline" className="text-[10px] text-muted-foreground">
                  {m}
                </Badge>
              ))}
            </div>
            <Button size="sm" className="mt-5 rounded-xl" onClick={() => navigate('/pricing')}>
              Upgrade to Pro
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-black font-heading">Driver Scorecard</h1>
          <p className="text-sm text-muted-foreground">Your performance at a glance</p>
        </div>
      </div>

      {/* Overall Score */}
      <Card className="shadow-card overflow-hidden">
        <CardContent className="p-6 text-center">
          <div className={`inline-flex items-center justify-center rounded-2xl ${tier.bg} px-5 py-3 mb-4`}>
            <span className="text-5xl font-black font-mono">{scorecard.totalScore}</span>
            <span className="text-lg text-muted-foreground font-bold ml-1">/100</span>
          </div>
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="text-2xl">{tier.emoji}</span>
            <Badge className={`${tier.bg} ${tier.color} border-0 text-sm font-bold px-3`}>
              {scorecard.tier}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Based on your last 30 days of activity</p>
        </CardContent>
      </Card>

      {/* Metric Cards */}
      <div className="space-y-3">
        {scorecard.metrics.map((metric, i) => {
          const Icon = metricIcons[i];
          const pct = (metric.score / metric.maxScore) * 100;
          const barColor = pct >= 75 ? 'bg-success' : pct >= 40 ? 'bg-warning' : 'bg-destructive';

          return (
            <Card key={metric.label} className="shadow-card">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="rounded-lg bg-muted p-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold">{metric.label}</p>
                      <p className="text-xs font-mono font-bold">
                        {metric.score}<span className="text-muted-foreground">/{metric.maxScore}</span>
                      </p>
                    </div>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">{metric.detail}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Scoring Guide */}
      <Card className="shadow-card">
        <CardContent className="p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Tier Guide</p>
          <div className="grid grid-cols-2 gap-2">
            {(['Bronze', 'Silver', 'Gold', 'Platinum'] as Tier[]).map(t => {
              const c = tierConfig[t];
              const range = t === 'Bronze' ? '0–39' : t === 'Silver' ? '40–59' : t === 'Gold' ? '60–79' : '80–100';
              return (
                <div key={t} className={`rounded-xl ${c.bg} p-2.5 text-center ${scorecard.tier === t ? 'ring-2 ring-primary/30' : ''}`}>
                  <span className="text-lg">{c.emoji}</span>
                  <p className={`text-xs font-bold ${c.color}`}>{t}</p>
                  <p className="text-[10px] text-muted-foreground">{range} pts</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
