import { useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { formatCurrency, formatNumber, getCurrentWeekLoads, weekStartDayToNumber } from '@/lib/loadUtils';
import { useUserSettings } from '@/hooks/useUserSettings';
import { Card, CardContent } from '@/components/ui/card';
import { DollarSign, Truck, TrendingUp, TrendingDown, MapPin } from 'lucide-react';

interface WeeklyFocusCardProps {
  loads: Load[];
}

export function WeeklyFocusCard({ loads }: WeeklyFocusCardProps) {
  const { settings } = useUserSettings();
  const weekStartsOn = weekStartDayToNumber(settings?.week_start_day);
  const weekLoads = useMemo(() => getCurrentWeekLoads(loads, weekStartsOn), [loads, weekStartsOn]);

  const estimated = weekLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const paidLoads = weekLoads.filter(l => l.actual_pay_received != null);
  const actual = paidLoads.reduce((s, l) => s + Number(l.actual_pay_received ?? 0), 0);
  const paidEstimated = paidLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const knownDiff = paidLoads.length > 0 ? actual - paidEstimated : null;
  const loadedMiles = weekLoads.reduce((s, l) => s + Number(l.loaded_miles), 0);
  const deadheadMiles = weekLoads.reduce((s, l) => s + Number(l.deadhead_miles), 0);
  const totalMiles = loadedMiles + deadheadMiles;
  const deadheadPct = totalMiles > 0 ? (deadheadMiles / totalMiles) * 100 : 0;
  const deadheadColor = deadheadPct < 15 ? 'text-success' : deadheadPct < 30 ? 'text-warning' : 'text-destructive';

  if (weekLoads.length === 0) return null;

  return (
    <Card className="shadow-elevated card-premium border-primary/10 animate-fade-in">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-label">Current Week Performance</p>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Truck className="h-3.5 w-3.5" />
            <span className="text-xs font-bold">{weekLoads.length} load{weekLoads.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Primary earnings row */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">Estimated</p>
            <p className="text-value-xl text-primary">{formatCurrency(estimated)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">Actual</p>
            <p className="text-value-xl">{formatCurrency(actual)}</p>
            {paidLoads.length > 0 && (
              <p className="text-[10px] text-muted-foreground">{paidLoads.length} paid</p>
            )}
          </div>
        </div>

        {/* Secondary metrics */}
        <div className="flex items-center gap-4 pt-3 border-t border-border/50">
          {knownDiff != null && (
            <div className="flex items-center gap-1.5">
              {knownDiff >= 0 ? (
                <TrendingUp className="h-3.5 w-3.5 text-success" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-destructive" />
              )}
              <span className={`text-xs font-bold font-mono ${knownDiff >= 0 ? 'text-success' : 'text-destructive'}`}>
                {knownDiff >= 0 ? '+' : ''}{formatCurrency(knownDiff)}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <MapPin className={`h-3.5 w-3.5 ${deadheadColor}`} />
            <span className={`text-xs font-bold font-mono ${deadheadColor}`}>
              {deadheadPct.toFixed(1)}%
            </span>
            <span className="text-[10px] text-muted-foreground">deadhead</span>
          </div>
          <div className="ml-auto text-right">
            <span className="text-xs font-bold font-mono">{formatNumber(loadedMiles)}</span>
            <span className="text-[10px] text-muted-foreground ml-1">mi</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
