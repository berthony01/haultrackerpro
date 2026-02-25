import { useState, useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { formatCurrency, formatNumber } from '@/lib/loadUtils';
import { StatCard, StatCardSkeleton } from '@/components/StatCard';
import { DollarSign, Route, Truck, TrendingUp, TrendingDown, AlertTriangle, MapPin, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subWeeks, subMonths, parseISO, isWithinInterval } from 'date-fns';

interface DashboardViewProps {
  loads: Load[];
  isLoading?: boolean;
  onNavigate?: (page: string, options?: { filter?: string }) => void;
}

type PresetKey = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year' | 'custom';

const presets: { key: PresetKey; label: string }[] = [
  { key: 'this_week', label: 'This Week' },
  { key: 'last_week', label: 'Last Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'this_year', label: 'This Year' },
  { key: 'custom', label: 'Custom' },
];

function getPresetRange(key: PresetKey): { start: Date; end: Date } {
  const now = new Date();
  switch (key) {
    case 'this_week': return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    case 'last_week': { const lw = subWeeks(now, 1); return { start: startOfWeek(lw, { weekStartsOn: 1 }), end: endOfWeek(lw, { weekStartsOn: 1 }) }; }
    case 'this_month': return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'last_month': { const lm = subMonths(now, 1); return { start: startOfMonth(lm), end: endOfMonth(lm) }; }
    case 'this_year': return { start: startOfYear(now), end: endOfYear(now) };
    default: return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
  }
}

export function DashboardView({ loads, isLoading, onNavigate }: DashboardViewProps) {
  const [activePreset, setActivePreset] = useState<PresetKey>('this_week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const showCustom = activePreset === 'custom';

  const filteredLoads = useMemo(() => {
    if (activePreset === 'custom') {
      return loads.filter(l => {
        const d = l.load_date;
        if (customFrom && d < customFrom) return false;
        if (customTo && d > customTo) return false;
        return true;
      });
    }
    const { start, end } = getPresetRange(activePreset);
    return loads.filter(l => {
      const d = parseISO(l.load_date);
      return isWithinInterval(d, { start, end });
    });
  }, [loads, activePreset, customFrom, customTo]);

  const estimated = filteredLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const actual = filteredLoads.reduce((s, l) => s + Number(l.actual_pay_received ?? 0), 0);
  const loadedMiles = filteredLoads.reduce((s, l) => s + Number(l.loaded_miles), 0);
  const deadheadMiles = filteredLoads.reduce((s, l) => s + Number(l.deadhead_miles), 0);
  const completedLoads = filteredLoads.filter(l => l.status === 'completed' || l.status === 'Completed');
  const paidLoads = filteredLoads.filter(l => l.actual_pay_received != null);
  const missingPayCount = filteredLoads.filter(l => l.actual_pay_received == null).length;
  const paidEstimated = paidLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const knownDifference = paidLoads.length > 0 ? actual - paidEstimated : null;
  const unpaidEstimated = filteredLoads
    .filter(l => l.actual_pay_received == null)
    .reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-black font-heading">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your hauling overview</p>
      </div>

      {/* Date Range Filter */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {presets.map(p => (
            <Button
              key={p.key}
              variant={activePreset === p.key ? 'default' : 'outline'}
              size="sm"
              className={`text-xs h-8 px-3 rounded-xl active:scale-95 transition-transform ${activePreset === p.key ? 'shadow-primary' : ''}`}
              onClick={() => setActivePreset(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {showCustom && (
          <div className="flex gap-2 items-center">
            <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-9 text-xs flex-1 rounded-xl" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-9 text-xs flex-1 rounded-xl" />
          </div>
        )}
      </div>

      {/* Loading skeletons */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Est. Earnings" value={formatCurrency(estimated)} icon={DollarSign} />
            <StatCard
              label="Actual Earnings"
              value={formatCurrency(actual)}
              icon={DollarSign}
              subtitle={paidLoads.length > 0 ? `${paidLoads.length} paid` : 'No payments yet'}
            />
            <StatCard label="Loads Done" value={completedLoads.length.toString()} icon={Truck} />
            <StatCard label="Loaded Miles" value={formatNumber(loadedMiles)} icon={Route} />
            <StatCard label="Deadhead Miles" value={formatNumber(deadheadMiles)} icon={MapPin} />
            {knownDifference != null && (
              <StatCard
                label="Known Difference"
                value={`${knownDifference >= 0 ? '+' : ''}${formatCurrency(knownDifference)}`}
                icon={knownDifference >= 0 ? TrendingUp : TrendingDown}
                subtitle={knownDifference >= 0 ? 'Overpaid' : 'Underpaid'}
                variant={knownDifference >= 0 ? 'success' : 'danger'}
              />
            )}
            {missingPayCount > 0 && (
              <div
                className="cursor-pointer active:scale-95 transition-transform"
                onClick={() => onNavigate?.('loads', { filter: 'missing_pay' })}
              >
                <StatCard
                  label="Unpaid / Unknown"
                  value={formatCurrency(unpaidEstimated)}
                  icon={AlertTriangle}
                  subtitle={`${missingPayCount} load${missingPayCount > 1 ? 's' : ''} — tap to view`}
                  variant="warning"
                />
              </div>
            )}
            {knownDifference == null && missingPayCount === 0 && (
              <StatCard
                label="Avg $/Mile"
                value={loadedMiles > 0 ? formatCurrency(estimated / loadedMiles) : '$0'}
                icon={TrendingUp}
              />
            )}
          </div>




          {/* Empty State */}
          {filteredLoads.length === 0 && (
            <Card className="border-dashed border-2 border-muted-foreground/20 shadow-card">
              <CardContent className="py-12 text-center">
                <div className="inline-flex items-center justify-center rounded-2xl bg-muted p-4 mb-4">
                  <Truck className="h-10 w-10 text-muted-foreground/40" />
                </div>
                <p className="font-bold text-lg">No loads in this period</p>
                <p className="text-sm text-muted-foreground mt-1 mb-4">Try a different date range or log a new load</p>
                {onNavigate && (
                  <Button className="gap-2 rounded-xl shadow-primary active:scale-95 transition-transform" onClick={() => onNavigate('add')}>
                    <Plus className="h-4 w-4" /> Log a Load
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
