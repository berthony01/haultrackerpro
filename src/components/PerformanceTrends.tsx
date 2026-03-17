import { useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { formatCurrency, weekStartDayToNumber, getEffectiveDate } from '@/lib/loadUtils';
import { useUserSettings } from '@/hooks/useUserSettings';
import { Card, CardContent } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { startOfWeek, endOfWeek, subWeeks, parseISO, isWithinInterval, format, subDays } from 'date-fns';
import { TrendingUp, BarChart3 } from 'lucide-react';

interface PerformanceTrendsProps {
  loads: Load[];
}

export function PerformanceTrends({ loads }: PerformanceTrendsProps) {
  const { settings } = useUserSettings();
  const wso = weekStartDayToNumber(settings?.week_start_day);
  const { weeklyData, avg30Earnings, avg30PerMile, hasEnoughData } = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = subDays(now, 30);

    const weeks = [];
    for (let i = 3; i >= 0; i--) {
      const ref = subWeeks(now, i);
      const start = startOfWeek(ref, { weekStartsOn: wso });
      const end = endOfWeek(ref, { weekStartsOn: wso });
      const weekLoads = loads.filter(l => {
        const d = parseISO(getEffectiveDate(l));
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

    const last30 = loads.filter(l => parseISO(getEffectiveDate(l)) >= thirtyDaysAgo);
    const totalEst = last30.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
    const totalMiles = last30.reduce((s, l) => s + Number(l.loaded_miles), 0);
    const weeksCount = Math.max(1, Math.ceil(last30.length > 0 ? 4 : 1));

    return {
      weeklyData: weeks,
      avg30Earnings: last30.length > 0 ? totalEst / weeksCount : 0,
      avg30PerMile: totalMiles > 0 ? totalEst / totalMiles : 0,
      hasEnoughData: loads.length >= 3,
    };
  }, [loads, wso]);

  if (!hasEnoughData) {
    return (
      <Card className="border-dashed border-2 border-muted-foreground/20">
        <CardContent className="py-10 text-center">
          <BarChart3 className="h-8 w-8 text-muted-foreground/25 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground leading-relaxed">
            Log more loads to unlock trend insights.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h2 className="text-label">Performance Trends</h2>
      </div>

      <Card className="card-premium">
        <CardContent className="p-4">
          <p className="text-label mb-3">Last 4 Weeks Earnings</p>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData} barGap={2}>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} width={45} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 12, border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
                  formatter={(value: number, name: string) => [formatCurrency(value), name === 'estimated' ? 'Estimated' : 'Actual']}
                />
                <Bar dataKey="estimated" fill="hsl(25, 95%, 53%)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="actual" fill="hsl(152, 60%, 42%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card className="card-premium">
          <CardContent className="p-3 text-center">
            <p className="text-label">30-Day Avg/Wk</p>
            <p className="text-value-lg text-primary mt-0.5">{formatCurrency(avg30Earnings)}</p>
          </CardContent>
        </Card>
        <Card className="card-premium">
          <CardContent className="p-3 text-center">
            <p className="text-label">Avg $/Mile (30d)</p>
            <p className="text-value-lg text-primary mt-0.5">{formatCurrency(avg30PerMile)}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
