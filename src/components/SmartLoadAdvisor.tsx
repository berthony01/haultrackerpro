import { useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { getEffectiveDate, formatCurrency } from '@/lib/loadUtils';
import { parseISO } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Map, Lock, Crown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface SmartLoadAdvisorProps {
  loads: Load[];
  expenses: Expense[];
  isPro: boolean;
  isTrialing?: boolean;
}

interface LaneData {
  lane: string;
  pickup: string;
  dropoff: string;
  count: number;
  avgRPM: number;
  totalRevenue: number;
  totalMiles: number;
  avgDeadheadPct: number;
}

function normalizeCityName(location: string): string {
  return location.trim().split(',')[0].trim().substring(0, 25);
}

export function SmartLoadAdvisor({ loads, isPro, isTrialing = false }: SmartLoadAdvisorProps) {
  const navigate = useNavigate();
  const isProAccess = isPro || isTrialing;

  const analysis = useMemo(() => {
    const now = new Date();
    const recentLoads = loads.filter(l => {
      const d = parseISO(getEffectiveDate(l));
      return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) <= 60;
    });

    if (recentLoads.length < 5) return null;

    const laneMap: globalThis.Map<string, Load[]> = new globalThis.Map();
    recentLoads.forEach(l => {
      const pickup = normalizeCityName(l.pickup_location);
      const dropoff = normalizeCityName(l.dropoff_location);
      const key = `${pickup} → ${dropoff}`;
      const arr = laneMap.get(key) || [];
      arr.push(l);
      laneMap.set(key, arr);
    });

    const lanes: LaneData[] = [];
    laneMap.forEach((laneLoads, lane) => {
      if (laneLoads.length < 2) return;
      const parts = lane.split(' → ');
      const totalMiles = laneLoads.reduce((s, l) => s + Number(l.loaded_miles), 0);
      const totalRev = laneLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
      const totalDH = laneLoads.reduce((s, l) => s + Number(l.deadhead_miles), 0);
      const totalAllMiles = totalMiles + totalDH;

      lanes.push({
        lane,
        pickup: parts[0],
        dropoff: parts[1],
        count: laneLoads.length,
        avgRPM: totalMiles > 0 ? totalRev / totalMiles : 0,
        totalRevenue: totalRev,
        totalMiles,
        avgDeadheadPct: totalAllMiles > 0 ? (totalDH / totalAllMiles) * 100 : 0,
      });
    });

    if (lanes.length < 2) return null;

    lanes.sort((a, b) => b.avgRPM - a.avgRPM);

    const bestLane = lanes[0];
    const worstLane = lanes[lanes.length - 1];
    const avgRPM = recentLoads.reduce((s, l) => s + Number(l.loaded_miles), 0) > 0
      ? recentLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0) / recentLoads.reduce((s, l) => s + Number(l.loaded_miles), 0)
      : 0;

    const worstLaneWeeklyLoads = worstLane.count / 8;
    const rpmDiff = avgRPM - worstLane.avgRPM;
    const potentialWeeklyGain = rpmDiff > 0 ? rpmDiff * (worstLane.totalMiles / worstLane.count) * worstLaneWeeklyLoads : 0;

    return { lanes, bestLane, worstLane, avgRPM, potentialWeeklyGain, totalLoadsAnalyzed: recentLoads.length };
  }, [loads]);

  if (!analysis) return null;

  if (!isProAccess) {
    return (
      <Card className="shadow-card overflow-hidden">
        <CardContent className="p-0">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5">
            <Map className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Smart Load Advisor</span>
            <span className="ml-auto">
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">Pro</span>
            </span>
          </div>
          <div className="p-4 text-center space-y-3">
            <Lock className="h-8 w-8 text-muted-foreground/20 mx-auto" />
            <div>
              <p className="text-sm font-bold">Your lane analysis is ready</p>
              <p className="text-xs text-muted-foreground mt-1">
                We analyzed {analysis.totalLoadsAnalyzed} loads across {analysis.lanes.length} lanes. Upgrade to see which lanes make you the most money.
              </p>
            </div>
            <Button size="sm" className="rounded-xl font-bold gap-1.5" onClick={() => navigate('/pricing')}>
              <Crown className="h-3.5 w-3.5" /> Unlock Insights
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-card overflow-hidden">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5">
          <Map className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Smart Load Advisor</span>
          <span className="text-[10px] text-muted-foreground ml-auto">{analysis.totalLoadsAnalyzed} loads · 60 days</span>
        </div>
        <div className="p-4 space-y-3">
          {/* Best Lane */}
          <div className="flex items-start gap-3 rounded-xl bg-success/5 p-3">
            <TrendingUp className="h-4 w-4 text-success shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-success">Best Lane</p>
              <p className="text-sm font-bold truncate">{analysis.bestLane.lane}</p>
              <p className="text-xs text-muted-foreground">
                ${analysis.bestLane.avgRPM.toFixed(2)}/mi · {analysis.bestLane.count} loads · {formatCurrency(analysis.bestLane.totalRevenue)} total
              </p>
            </div>
          </div>

          {/* Worst Lane */}
          <div className="flex items-start gap-3 rounded-xl bg-destructive/5 p-3">
            <TrendingDown className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-destructive">Weakest Lane</p>
              <p className="text-sm font-bold truncate">{analysis.worstLane.lane}</p>
              <p className="text-xs text-muted-foreground">
                ${analysis.worstLane.avgRPM.toFixed(2)}/mi · {analysis.worstLane.count} loads
                {analysis.worstLane.avgDeadheadPct > 20 && ` · ${analysis.worstLane.avgDeadheadPct.toFixed(0)}% deadhead`}
              </p>
            </div>
          </div>

          {/* Recommendation */}
          {analysis.potentialWeeklyGain > 10 && (
            <div className="rounded-xl bg-primary/5 p-3">
              <p className="text-xs leading-relaxed">
                <span className="font-bold">💡 Tip:</span> If you replaced your{' '}
                <span className="font-semibold">{analysis.worstLane.pickup} → {analysis.worstLane.dropoff}</span>{' '}
                loads with runs at your average RPM (${analysis.avgRPM.toFixed(2)}/mi), you could earn an estimated{' '}
                <span className="font-bold text-success">~{formatCurrency(analysis.potentialWeeklyGain)}/week</span> more.
              </p>
            </div>
          )}

          {/* All Lanes Ranked */}
          {analysis.lanes.length > 2 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">All Lanes by RPM</p>
              {analysis.lanes.slice(0, 6).map((lane, i) => (
                <div key={lane.lane} className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0">
                  <span className="truncate flex-1 mr-2">
                    <span className="font-mono text-muted-foreground mr-1.5">{i + 1}.</span>
                    {lane.lane}
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-muted-foreground">{lane.count}x</span>
                    <span className={`font-bold ${i === 0 ? 'text-success' : i === analysis.lanes.length - 1 ? 'text-destructive' : ''}`}>
                      ${lane.avgRPM.toFixed(2)}/mi
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
