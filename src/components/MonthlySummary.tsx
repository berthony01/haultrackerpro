import { useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { formatCurrency, formatNumber, exportToCSV, exportToPDF } from '@/lib/loadUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Calendar, DollarSign, Route, TrendingUp, TrendingDown, Trophy, AlertTriangle, FileSpreadsheet, Download } from 'lucide-react';
import { startOfMonth, endOfMonth, subMonths, format, parseISO, isWithinInterval } from 'date-fns';

interface MonthlySummaryProps {
  loads: Load[];
  onBack: () => void;
}

export function MonthlySummary({ loads, onBack }: MonthlySummaryProps) {
  const months = useMemo(() => {
    const now = new Date();
    return [0, 1, 2].map(offset => {
      const d = subMonths(now, offset);
      const start = startOfMonth(d);
      const end = endOfMonth(d);
      const monthLoads = loads.filter(l =>
        isWithinInterval(parseISO(l.load_date), { start, end })
      );
      return { label: format(d, 'MMMM yyyy'), start, end, loads: monthLoads, offset };
    });
  }, [loads]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-xl" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-black font-heading">Monthly Summary</h1>
          <p className="text-sm text-muted-foreground">Review and export month-by-month</p>
        </div>
      </div>

      {months.map(month => (
        <MonthCard key={month.label} label={month.label} loads={month.loads} allLoads={loads} />
      ))}
    </div>
  );
}

function MonthCard({ label, loads }: { label: string; loads: Load[]; allLoads: Load[] }) {
  const stats = useMemo(() => {
    const nonCancelled = loads.filter(l => l.status !== 'cancelled');
    const estimated = nonCancelled.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
    const paidLoads = nonCancelled.filter(l => l.actual_pay_received != null);
    const actual = paidLoads.reduce((s, l) => s + Number(l.actual_pay_received ?? 0), 0);
    const paidEstimated = paidLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
    const difference = paidLoads.length > 0 ? actual - paidEstimated : null;
    const loadedMiles = nonCancelled.reduce((s, l) => s + Number(l.loaded_miles), 0);
    const deadheadMiles = nonCancelled.reduce((s, l) => s + Number(l.deadhead_miles), 0);
    const totalMiles = loadedMiles + deadheadMiles;
    const deadheadPct = totalMiles > 0 ? (deadheadMiles / totalMiles) * 100 : 0;

    const sorted = [...nonCancelled].sort(
      (a, b) => Number(b.estimated_pay ?? 0) - Number(a.estimated_pay ?? 0)
    );
    const highest = sorted[0] ?? null;
    const lowest = sorted.length > 1 ? sorted[sorted.length - 1] : null;

    return { estimated, actual, difference, loadedMiles, deadheadPct, highest, lowest, totalLoads: nonCancelled.length, paidCount: paidLoads.length };
  }, [loads]);

  if (loads.length === 0) {
    return (
      <Card className="border-dashed border-2 border-muted-foreground/20">
        <CardContent className="py-6 text-center">
          <p className="font-semibold">{label}</p>
          <p className="text-sm text-muted-foreground">No loads logged</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-heading flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" /> {label}
          </CardTitle>
          <Badge variant="secondary" className="font-mono">{stats.totalLoads} loads</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Earnings Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-secondary p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Estimated</p>
            <p className="text-lg font-black font-mono text-primary">{formatCurrency(stats.estimated)}</p>
          </div>
          <div className="rounded-lg bg-secondary p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Actual</p>
            <p className="text-lg font-black font-mono text-foreground">
              {stats.paidCount > 0 ? formatCurrency(stats.actual) : '—'}
            </p>
          </div>
          {stats.difference != null && (
            <div className={`rounded-lg p-3 ${stats.difference >= 0 ? 'bg-success/10' : 'bg-destructive/10'}`}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Difference</p>
              <p className={`text-lg font-black font-mono ${stats.difference >= 0 ? 'text-success' : 'text-destructive'}`}>
                {stats.difference >= 0 ? '+' : ''}{formatCurrency(stats.difference)}
              </p>
            </div>
          )}
          <div className="rounded-lg bg-secondary p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Deadhead %</p>
            <p className={`text-lg font-black font-mono ${stats.deadheadPct < 15 ? 'text-success' : stats.deadheadPct < 30 ? 'text-warning' : 'text-destructive'}`}>
              {stats.deadheadPct.toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Best / Worst Loads */}
        {stats.highest && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <Trophy className="h-3.5 w-3.5 text-primary" />
              <span className="text-muted-foreground">Highest:</span>
              <span className="font-bold">{formatCurrency(Number(stats.highest.estimated_pay ?? 0))}</span>
              <span className="text-muted-foreground truncate">
                {stats.highest.pickup_location} → {stats.highest.dropoff_location}
              </span>
            </div>
            {stats.lowest && stats.lowest.id !== stats.highest.id && (
              <div className="flex items-center gap-2 text-xs">
                <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Lowest:</span>
                <span className="font-bold">{formatCurrency(Number(stats.lowest.estimated_pay ?? 0))}</span>
                <span className="text-muted-foreground truncate">
                  {stats.lowest.pickup_location} → {stats.lowest.dropoff_location}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Export Buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 text-xs rounded-xl"
            onClick={() => exportToCSV(loads, `month-${label.replace(/\s/g, '-')}`)}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 text-xs rounded-xl"
            onClick={() => exportToPDF(loads, `month-${label.replace(/\s/g, '-')}`)}
          >
            <Download className="h-3.5 w-3.5" /> PDF
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
