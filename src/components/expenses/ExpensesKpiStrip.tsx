import { Hash, CircleDollarSign, Tag, CalendarDays } from 'lucide-react';
import { Expense } from '@/hooks/useExpenses';
import { formatCurrency } from '@/lib/loadUtils';
import { useMemo } from 'react';

interface ExpensesKpiStripProps {
  expenses: Expense[];
}

/**
 * KPI strip for the Expenses list.
 * Mirrors the dashboard / Loads KPI tile system exactly:
 *   - .premium-card surface, 1rem radius, gradient border
 *   - .text-label micro-labels (uppercase, tracking-widest)
 *   - mono numerics with clamp() responsive sizing
 *   - orange icon chip with ring
 */
export function ExpensesKpiStrip({ expenses }: ExpensesKpiStripProps) {
  const stats = useMemo(() => {
    const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const catTotals = expenses.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + Number(e.amount);
      return acc;
    }, {} as Record<string, number>);
    const topEntry = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
    const avg = expenses.length > 0 ? total / expenses.length : 0;
    return {
      count: expenses.length,
      total,
      avg,
      topCategory: topEntry?.[0] ?? '—',
      topAmount: topEntry?.[1] ?? 0,
    };
  }, [expenses]);

  const tiles = [
    { label: 'Expenses', value: String(stats.count), icon: Hash, sub: 'records' },
    { label: 'Total Spend', value: formatCurrency(stats.total), icon: CircleDollarSign, sub: 'filtered' },
    { label: 'Avg / Expense', value: formatCurrency(stats.avg), icon: CalendarDays, sub: 'mean' },
    { label: 'Top Category', value: stats.topCategory, icon: Tag, sub: stats.topAmount > 0 ? formatCurrency(stats.topAmount) : '—' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {tiles.map(t => (
        <div key={t.label} className="premium-card p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-label">{t.label}</p>
            <div className="rounded-lg bg-primary/10 p-1.5 ring-1 ring-primary/20">
              <t.icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            </div>
          </div>
          <p
            className="font-mono font-black tracking-tight text-foreground whitespace-nowrap overflow-hidden text-ellipsis"
            style={{ fontSize: 'clamp(1.05rem, 3.2vw, 1.5rem)' }}
          >
            {t.value}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1 truncate">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}
