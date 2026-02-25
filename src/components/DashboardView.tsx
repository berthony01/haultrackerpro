import { Load } from '@/hooks/useLoads';
import { getCurrentWeekLoads, getCurrentMonthLoads, formatCurrency, formatNumber, getWeekSummaries } from '@/lib/loadUtils';
import { StatCard } from '@/components/StatCard';
import { DollarSign, Route, Truck, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface DashboardViewProps {
  loads: Load[];
}

export function DashboardView({ loads }: DashboardViewProps) {
  const weekLoads = getCurrentWeekLoads(loads);
  const monthLoads = getCurrentMonthLoads(loads);
  const weekEstimated = weekLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const weekActual = weekLoads.reduce((s, l) => s + Number(l.actual_pay ?? 0), 0);
  const monthEstimated = monthLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const monthActual = monthLoads.reduce((s, l) => s + Number(l.actual_pay ?? 0), 0);
  const weekMiles = weekLoads.reduce((s, l) => s + Number(l.loaded_miles), 0);
  const monthMiles = monthLoads.reduce((s, l) => s + Number(l.loaded_miles), 0);
  const weekSummaries = getWeekSummaries(loads).slice(0, 4);

  const paidWeekLoads = weekLoads.filter(l => l.actual_pay != null);
  const weekDiff = paidWeekLoads.length > 0 ? weekActual - paidWeekLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0) : null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-black font-heading">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your hauling overview</p>
      </div>

      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">This Week</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Est. Earnings" value={formatCurrency(weekEstimated)} icon={DollarSign} />
          <StatCard label="Loads" value={weekLoads.length.toString()} icon={Truck} />
          <StatCard label="Loaded Miles" value={formatNumber(weekMiles)} icon={Route} />
          {weekDiff != null ? (
            <StatCard
              label="Pay Diff"
              value={`${weekDiff >= 0 ? '+' : ''}${formatCurrency(weekDiff)}`}
              icon={weekDiff >= 0 ? TrendingUp : TrendingDown}
              subtitle={weekDiff >= 0 ? 'Overpaid' : 'Underpaid'}
            />
          ) : (
            <StatCard label="Avg/Load" value={weekLoads.length > 0 ? formatCurrency(weekEstimated / weekLoads.length) : '$0'} icon={TrendingUp} />
          )}
        </div>
      </div>

      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">This Month</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Est. Earnings" value={formatCurrency(monthEstimated)} icon={DollarSign} />
          <StatCard label="Actual Paid" value={formatCurrency(monthActual)} icon={DollarSign} subtitle={monthActual > 0 ? `${monthLoads.filter(l => l.actual_pay != null).length} paid` : 'No payments yet'} />
          <StatCard label="Total Miles" value={formatNumber(monthMiles)} icon={Route} />
          <StatCard label="Avg $/Mile" value={monthMiles > 0 ? formatCurrency(monthEstimated / monthMiles) : '$0'} icon={TrendingUp} />
        </div>
      </div>

      {weekSummaries.length > 0 && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Recent Weeks</h2>
          <div className="space-y-2">
            {weekSummaries.map(w => (
              <Card key={w.startDate}>
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">{w.weekLabel}</p>
                    <p className="text-xs text-muted-foreground">{w.totalLoads} loads · {formatNumber(w.totalLoadedMiles)} mi</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black font-mono text-primary">{formatCurrency(w.totalEstimatedPay)}</p>
                    {w.totalActualPay > 0 && (
                      <p className="text-xs font-mono text-muted-foreground">Actual: {formatCurrency(w.totalActualPay)}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {loads.length === 0 && (
        <Card className="border-dashed border-2">
          <CardContent className="p-8 text-center">
            <Truck className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-semibold">No loads logged yet</p>
            <p className="text-sm text-muted-foreground mt-1">Tap the + button to log your first load</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
