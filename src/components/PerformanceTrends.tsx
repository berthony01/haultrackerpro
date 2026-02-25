import { useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { formatCurrency } from '@/lib/loadUtils';
import { Card, CardContent } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { startOfWeek, endOfWeek, subWeeks, parseISO, isWithinInterval, format, subDays } from 'date-fns';
import { TrendingUp, BarChart3 } from 'lucide-react';

interface PerformanceTrendsProps {
  loads: Load[];
}

export function PerformanceTrends({ loads }: PerformanceTrendsProps) {
  const { weeklyData, avg30Earnings, avg30PerMile, hasEnoughData } = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = subDays(now, 30);

    // Last 4 weeks
    const weeks = [];
    for (let i = 3; i >= 0; i--) {
      const ref = subWeeks(now, i);
      const start = startOfWeek(ref, { weekStartsOn: 1 });
      const end = endOfWeek(ref, { weekStartsOn: 1 });
      const weekLoads = loads.filter(l => {
        const d = parseISO(l.load_date);
        return isWithinInterval(d, { start, end });
      });
      const est = weekLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
      const act = weekLoads.reduce((s, l) => s + Number(l.actual_pay_received ?? 0), 0);
      weeks.push({
        label: format(start, 'MMM d'),
        estimated: Math.round(est),
        actual: Math.round(act),
      });
    }

    // 30-day metrics
    const last30 = loads.filter(l => parseISO(l.load_date) >= thirtyDaysAgo);
    const totalEst = last30.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
    const totalMiles = last30.reduce((s, l) => s + Number(l.loaded_miles), 0);
    const weeksCount = Math.max(1, Math.ceil(last30.length > 0 ? 4 : 1));

    return {
      weeklyData: weeks,
      avg30Earnings: last30.length > 0 ? totalEst / weeksCount : 0,
      avg30PerMile: totalMiles > 0 ? totalEst / totalMiles : 0,
      hasEnoughData: loads.length >= 3,
    };
  }, [loads]);

  if (!hasEnoughData) {
    return (
      <Card className="border-dashed border-2 border-muted-foreground/20">
        <CardContent className="py-8 text-center">
          <BarChart3 className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Log more loads to unlock trend insights.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Performance Trends</h2>
      </div>

      {/* Bar Chart */}
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-3">Last 4 Weeks Earnings</p>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData} barGap={2}>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} width={45} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  formatter={(value: number, name: string) => [formatCurrency(value), name === 'estimated' ? 'Estimated' : 'Actual']}
                />
                <Bar dataKey="estimated" fill="hsl(25, 95%, 53%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" fill="hsl(152, 60%, 42%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* 30-day metrics */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">30-Day Avg/Wk</p>
            <p className="text-lg font-black font-mono text-primary">{formatCurrency(avg30Earnings)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg $/Mile (30d)</p>
            <p className="text-lg font-black font-mono text-primary">{formatCurrency(avg30PerMile)}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
