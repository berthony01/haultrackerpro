import { useState, useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { useUserSettings } from '@/hooks/useUserSettings';
import { weekStartDayToNumber, formatCurrency, formatNumber } from '@/lib/loadUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear,
  parseISO, isWithinInterval, format, eachDayOfInterval, eachMonthOfInterval,
} from 'date-fns';
import { TrendingUp, BarChart3, Crown, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Props {
  loads: Load[];
  expenses: Expense[];
  isPro?: boolean;
}

type Range = 'week' | 'month' | 'year';

const rangeLabels: { key: Range; label: string }[] = [
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'year', label: 'This Year' },
];

function getRange(range: Range, weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6) {
  const now = new Date();
  switch (range) {
    case 'week': return { start: startOfWeek(now, { weekStartsOn }), end: endOfWeek(now, { weekStartsOn }) };
    case 'month': return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'year': return { start: startOfYear(now), end: endOfYear(now) };
  }
}

function CurrencyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card p-2 shadow-card text-xs">
      <p className="font-semibold text-card-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
}

function PercentTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card p-2 shadow-card text-xs">
      <p className="font-semibold text-card-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value.toFixed(1)}%
        </p>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-[140px] text-xs text-muted-foreground">
      {message}
    </div>
  );
}

export function PerformanceCharts({ loads, expenses }: Props) {
  const { settings } = useUserSettings();
  const weekStartsOn = weekStartDayToNumber(settings?.week_start_day);
  const [activeRange, setActiveRange] = useState<Range>('week');

  const { start, end } = useMemo(() => getRange(activeRange, weekStartsOn), [activeRange, weekStartsOn]);

  const filteredLoads = useMemo(
    () => loads.filter(l => isWithinInterval(parseISO(l.load_date), { start, end })),
    [loads, start, end]
  );
  const filteredExpenses = useMemo(
    () => expenses.filter(e => isWithinInterval(parseISO(e.expense_date), { start, end })),
    [expenses, start, end]
  );

  // Build time buckets
  const buckets = useMemo(() => {
    if (activeRange === 'year') {
      return eachMonthOfInterval({ start, end }).map(d => ({
        date: d,
        key: format(d, 'yyyy-MM'),
        label: format(d, 'MMM'),
      }));
    }
    return eachDayOfInterval({ start, end }).map(d => ({
      date: d,
      key: format(d, 'yyyy-MM-dd'),
      label: activeRange === 'week' ? format(d, 'EEE') : format(d, 'MMM d'),
    }));
  }, [start, end, activeRange]);

  // Aggregate data per bucket
  const chartData = useMemo(() => {
    return buckets.map(b => {
      const bLoads = filteredLoads.filter(l => {
        if (activeRange === 'year') return l.load_date.startsWith(b.key);
        return l.load_date === b.key;
      });
      const bExpenses = filteredExpenses.filter(e => {
        if (activeRange === 'year') return e.expense_date.startsWith(b.key);
        return e.expense_date === b.key;
      });

      const revenue = bLoads.reduce((s, l) => s + Number(l.actual_pay_received ?? l.estimated_pay ?? 0), 0);
      const expenseTotal = bExpenses.reduce((s, e) => s + Number(e.amount), 0);
      const loadedMiles = bLoads.reduce((s, l) => s + Number(l.loaded_miles), 0);
      const deadheadMiles = bLoads.reduce((s, l) => s + Number(l.deadhead_miles), 0);
      const totalMiles = loadedMiles + deadheadMiles;

      return {
        label: b.label,
        revenue,
        expenses: expenseTotal,
        netProfit: revenue - expenseTotal,
        rpm: loadedMiles > 0 ? revenue / loadedMiles : null,
        deadheadPct: totalMiles > 0 ? (deadheadMiles / totalMiles) * 100 : null,
      };
    });
  }, [buckets, filteredLoads, filteredExpenses, activeRange]);

  // Expense breakdown by category
  const expenseBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    filteredExpenses.forEach(e => {
      const cat = e.category || 'Other';
      map.set(cat, (map.get(cat) ?? 0) + Number(e.amount));
    });
    return Array.from(map.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [filteredExpenses]);

  const hasLoads = filteredLoads.length > 0;
  const hasExpenses = filteredExpenses.length > 0;
  const hasLoadedMiles = filteredLoads.some(l => Number(l.loaded_miles) > 0);
  const hasDeadhead = filteredLoads.some(l => Number(l.deadhead_miles) > 0);

  const primaryColor = 'hsl(25, 95%, 53%)';
  const successColor = 'hsl(152, 60%, 42%)';
  const destructiveColor = 'hsl(0, 84%, 60%)';
  const warningColor = 'hsl(38, 92%, 50%)';
  const mutedStroke = 'hsl(220, 10%, 46%)';

  return (
    <Card className="card-premium shadow-card">
      <CardContent className="pt-5 pb-4 px-4 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold font-heading">Performance</h3>
          </div>
        </div>

        {/* Time range toggle */}
        <div className="flex gap-1.5">
          {rangeLabels.map(r => (
            <Button
              key={r.key}
              variant={activeRange === r.key ? 'default' : 'outline'}
              size="sm"
              className={`text-xs h-7 px-3 rounded-xl active:scale-95 transition-all duration-200 ${activeRange === r.key ? 'shadow-primary' : ''}`}
              onClick={() => setActiveRange(r.key)}
            >
              {r.label}
            </Button>
          ))}
        </div>

        {/* Chart 1: Net Profit Trend */}
        <div>
          <p className="text-label mb-2">Net Profit Trend</p>
          {hasLoads ? (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 87%)" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke={mutedStroke} />
                <YAxis tick={{ fontSize: 10 }} stroke={mutedStroke} tickFormatter={v => `$${v}`} width={45} />
                <Tooltip content={<CurrencyTooltip />} />
                <Line type="monotone" dataKey="netProfit" name="Net Profit" stroke={primaryColor} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No loads for this period" />
          )}
        </div>

        {/* Chart 2: Revenue vs Expenses */}
        <div>
          <p className="text-label mb-2">Revenue vs Expenses</p>
          {hasLoads || hasExpenses ? (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 87%)" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke={mutedStroke} />
                <YAxis tick={{ fontSize: 10 }} stroke={mutedStroke} tickFormatter={v => `$${v}`} width={45} />
                <Tooltip content={<CurrencyTooltip />} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke={primaryColor} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="expenses" name="Expenses" stroke={destructiveColor} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No data for this period" />
          )}
        </div>

        {/* Chart 3: Avg RPM Trend */}
        <div>
          <p className="text-label mb-2">Avg Rate Per Mile</p>
          {hasLoadedMiles ? (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 87%)" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke={mutedStroke} />
                <YAxis tick={{ fontSize: 10 }} stroke={mutedStroke} tickFormatter={v => `$${v}`} width={45} />
                <Tooltip content={<CurrencyTooltip />} />
                <Line type="monotone" dataKey="rpm" name="RPM" stroke={successColor} strokeWidth={2} dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="RPM requires loaded miles" />
          )}
        </div>

        {/* Chart 4: Deadhead % Trend */}
        <div>
          <p className="text-label mb-2">Deadhead % Trend</p>
          {hasDeadhead ? (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 87%)" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke={mutedStroke} />
                <YAxis tick={{ fontSize: 10 }} stroke={mutedStroke} tickFormatter={v => `${v}%`} width={40} />
                <Tooltip content={<PercentTooltip />} />
                <Line type="monotone" dataKey="deadheadPct" name="Deadhead %" stroke={warningColor} strokeWidth={2} dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="Deadhead tracking not available for this period" />
          )}
        </div>

        {/* Chart 5: Expense Breakdown by Category */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="h-3 w-3 text-muted-foreground" />
            <p className="text-label">Expense Breakdown</p>
          </div>
          {expenseBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(100, expenseBreakdown.length * 32)}>
              <BarChart data={expenseBreakdown} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} stroke={mutedStroke} tickFormatter={v => `$${v}`} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} stroke={mutedStroke} width={70} />
                <Tooltip content={<CurrencyTooltip />} />
                <Bar dataKey="amount" name="Amount" fill={primaryColor} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No expenses for this period" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
