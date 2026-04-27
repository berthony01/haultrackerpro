import { useMemo, useState, useEffect } from 'react';
import { startOfWeek, endOfWeek, subWeeks, parseISO, format, getISOWeek, getISOWeekYear } from 'date-fns';
import { useLoads } from '@/hooks/useLoads';
import { usePersonalIntelligence } from '@/hooks/usePersonalIntelligence';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles, TrendingUp, TrendingDown, Building2, X, Lock, Crown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { buildWeeklyRecommendations } from '@/lib/profitDefenseAlerts';
import { formatCurrency, getEffectiveDate } from '@/lib/loadUtils';

interface WeeklyPulseCardProps {
  isPro: boolean;
}

function dismissKey() {
  const now = new Date();
  return `weekly_pulse_dismissed_${getISOWeekYear(now)}-W${String(getISOWeek(now)).padStart(2, '0')}`;
}

export function WeeklyPulseCard({ isPro }: WeeklyPulseCardProps) {
  const navigate = useNavigate();
  const { loads, isLoading } = useLoads();
  const { lanes, brokers, operatingMetrics } = usePersonalIntelligence();
  const hasAccess = isPro;

  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(localStorage.getItem(dismissKey()) === '1');
  }, []);

  const lastWeek = useMemo(() => {
    const now = new Date();
    const start = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    const end = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    const startKey = format(start, 'yyyy-MM-dd');
    const endKey = format(end, 'yyyy-MM-dd');
    const inRange = loads.filter(l => {
      const d = getEffectiveDate(l);
      return d >= startKey && d <= endKey;
    });
    const revenue = inRange.reduce((s, l) => s + Number(l.actual_pay_received ?? l.estimated_pay ?? 0), 0);
    const loadedMiles = inRange.reduce((s, l) => s + Number(l.loaded_miles ?? 0), 0);
    const deadheadMiles = inRange.reduce((s, l) => s + Number(l.deadhead_miles ?? 0), 0);
    const cpm = Number(operatingMetrics?.rolling_cost_per_mile ?? 0);
    const variableCost = (loadedMiles + deadheadMiles) * cpm;
    const net = revenue - variableCost;
    const margin = revenue > 0 ? (net / revenue) * 100 : 0;
    return { start, end, loads: inRange, revenue, loadedMiles, net, margin };
  }, [loads, operatingMetrics]);

  const recs = useMemo(() => buildWeeklyRecommendations(lanes, brokers), [lanes, brokers]);

  if (isLoading || dismissed) return null;

  const dayOfWeek = new Date().getDay(); // 1=Mon, 2=Tue
  const isPulseDay = dayOfWeek === 1 || dayOfWeek === 2;
  if (!isPulseDay) return null;

  const hasContent =
    lastWeek.loads.length > 0 ||
    recs.lanesToRepeat.length > 0 ||
    recs.lanesToAvoid.length > 0 ||
    recs.brokersToWatch.length > 0;
  if (!hasContent) return null;

  const handleDismiss = () => {
    localStorage.setItem(dismissKey(), '1');
    setDismissed(true);
  };

  if (!hasAccess) {
    return (
      <Card className="shadow-card overflow-hidden border-primary/20">
        <CardContent className="p-0">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/10">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Weekly Pulse</span>
          </div>
          <div className="p-4 text-center space-y-3">
            <Lock className="h-8 w-8 text-muted-foreground/20 mx-auto" />
            <div>
              <p className="text-sm font-bold">Your weekly recap is ready</p>
              <p className="text-xs text-muted-foreground mt-1">
                Top lane to repeat, lane to avoid, and broker to watch — every Monday from your own data.
              </p>
            </div>
            <Button size="sm" className="rounded-xl font-bold gap-1.5" onClick={() => navigate('/pricing')}>
              <Crown className="h-3.5 w-3.5" /> Unlock Weekly Pulse
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const topRepeat = recs.lanesToRepeat[0];
  const topAvoid = recs.lanesToAvoid[0];
  const topBroker = recs.brokersToWatch[0];

  return (
    <Card className="shadow-card overflow-hidden border-primary/20">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/10">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Weekly Pulse</span>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {format(lastWeek.start, 'MMM d')}–{format(lastWeek.end, 'MMM d')}
          </span>
          <button
            onClick={handleDismiss}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Last week summary */}
        {lastWeek.loads.length > 0 && (
          <div className="px-4 py-3 border-b border-border/40 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Revenue</div>
              <div className="text-sm font-bold">{formatCurrency(lastWeek.revenue)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Net</div>
              <div className={`text-sm font-bold ${lastWeek.net >= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(lastWeek.net)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Margin</div>
              <div className={`text-sm font-bold ${lastWeek.margin >= 15 ? 'text-success' : lastWeek.margin >= 0 ? 'text-foreground' : 'text-destructive'}`}>
                {lastWeek.margin.toFixed(1)}%
              </div>
            </div>
          </div>
        )}

        <div className="p-4 space-y-3">
          {topRepeat && (
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 h-7 w-7 rounded-full bg-success/10 flex items-center justify-center shrink-0">
                <TrendingUp className="h-3.5 w-3.5 text-success" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wide text-success">Repeat</div>
                <div className="text-sm font-semibold truncate">{topRepeat.lane_key}</div>
                <div className="text-xs text-muted-foreground">
                  Avg net {formatCurrency(topRepeat.avg_net_profit)} · ${topRepeat.avg_rpm.toFixed(2)}/mi · {topRepeat.load_count}x
                </div>
              </div>
            </div>
          )}

          {topAvoid && (
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 h-7 w-7 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <TrendingDown className="h-3.5 w-3.5 text-destructive" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wide text-destructive">Avoid</div>
                <div className="text-sm font-semibold truncate">{topAvoid.lane_key}</div>
                <div className="text-xs text-muted-foreground">
                  Avg net {formatCurrency(topAvoid.avg_net_profit)} · {topAvoid.avg_margin_pct.toFixed(0)}% margin · {topAvoid.load_count}x
                </div>
              </div>
            </div>
          )}

          {topBroker && (
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Building2 className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wide text-primary">Watch</div>
                <div className="text-sm font-semibold truncate">{topBroker.broker_name}</div>
                <div className="text-xs text-muted-foreground">
                  {topBroker.reason}{topBroker.metric ? ` · ${topBroker.metric}` : ''}
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
