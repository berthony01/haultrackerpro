import { useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { getEffectiveDate } from '@/lib/loadUtils';
import { getLoadExpectedPay } from '@/lib/loadMetrics';
import { format, parseISO } from 'date-fns';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { motion } from 'framer-motion';

interface Props {
  loads: Load[];
  expenses: Expense[];
}

export function ProfitOverviewChart({ loads, expenses }: Props) {
  const data = useMemo(() => {
    const map = new Map<string, { date: string; revenue: number; expenses: number; net: number }>();
    loads.forEach(l => {
      const d = getEffectiveDate(l);
      const e = map.get(d) ?? { date: d, revenue: 0, expenses: 0, net: 0 };
      const pay = l.actual_pay_received != null ? Number(l.actual_pay_received) : getLoadExpectedPay(l);
      e.revenue += pay;
      map.set(d, e);
    });
    expenses.forEach(ex => {
      const d = ex.expense_date;
      const e = map.get(d) ?? { date: d, revenue: 0, expenses: 0, net: 0 };
      e.expenses += Number(ex.amount);
      map.set(d, e);
    });
    return Array.from(map.values())
      .map(d => ({ ...d, expenses: -Math.abs(d.expenses), net: d.revenue + (-Math.abs(d.expenses) * 0) - Math.abs(d.expenses) === 0 ? d.revenue : d.revenue - Math.abs(d.expenses) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [loads, expenses]);

  const empty = data.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="premium-card p-4 sm:p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-foreground">Profit Overview</p>
        <span className="text-[10px] text-muted-foreground">Revenue · Expenses · Net</span>
      </div>
      {empty ? (
        <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
          Log loads and expenses to see your profit chart.
        </div>
      ) : (
        <div className="h-64 sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="hsl(220 30% 18%)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'hsl(220 12% 62%)' }}
                tickFormatter={(v) => { try { return format(parseISO(v), 'MMM d'); } catch { return v; } }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'hsl(220 12% 62%)' }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`}
              />
              <Tooltip
                contentStyle={{ background: 'hsl(220 46% 9%)', border: '1px solid hsl(220 30% 22%)', borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: 'hsl(220 12% 82%)' }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" name="Revenue" fill="hsl(142 71% 45%)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="expenses" name="Expenses" fill="hsl(0 84% 60%)" radius={[0, 0, 4, 4]} maxBarSize={28} />
              <Line
                type="monotone" dataKey="net" name="Net Profit"
                stroke="hsl(25 100% 55%)" strokeWidth={2.5}
                dot={{ r: 3, fill: 'hsl(25 100% 55%)', stroke: 'hsl(25 100% 55%)' }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </motion.div>
  );
}
