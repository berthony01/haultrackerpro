import { useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { FuelLog } from '@/hooks/useFuelLogs';
import { getEffectiveDate } from '@/lib/loadUtils';
import { getLoadExpectedPay } from '@/lib/loadMetrics';
import { format, parseISO } from 'date-fns';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { motion, useReducedMotion } from 'framer-motion';

interface Props {
  loads: Load[];
  expenses: Expense[];
  /**
   * Optional fuel logs in the same range. When provided AND non-empty, fuel
   * logs are the canonical fuel cost source for per-day expenses; Expense
   * rows with category === 'Fuel' are dropped to avoid double-counting.
   * Mirrors the policy in `applyFuelLogPolicy` / reportAggregator.
   */
  fuelLogs?: FuelLog[];
}

/**
 * Per-day Net Profit for the Profit Overview chart and its tooltip.
 * Must equal revenue - expenses (signed); covered by unit tests.
 */
export function computeDailyNetProfit(revenue: number, expenses: number): number {
  return revenue - expenses;
}

export function ProfitOverviewChart({ loads, expenses, fuelLogs = [] }: Props) {
  const data = useMemo(() => {
    const map = new Map<string, { date: string; revenue: number; expenses: number; net: number }>();
    // Phase 23A.2: cancelled loads must not contribute to daily revenue/net.
    loads
      .filter(l => (l.status ?? 'completed') !== 'cancelled')
      .forEach(l => {
        const d = getEffectiveDate(l);
        const e = map.get(d) ?? { date: d, revenue: 0, expenses: 0, net: 0 };
        const pay = l.actual_pay_received != null ? Number(l.actual_pay_received) : getLoadExpectedPay(l);
        e.revenue += pay;
        map.set(d, e);
      });

    const fuelLogsExist = fuelLogs.length > 0;
    const expensesForMath = fuelLogsExist
      ? expenses.filter(ex => ex.category !== 'Fuel')
      : expenses;

    expensesForMath.forEach(ex => {
      const d = ex.expense_date;
      const e = map.get(d) ?? { date: d, revenue: 0, expenses: 0, net: 0 };
      e.expenses += Number(ex.amount);
      map.set(d, e);
    });

    fuelLogs.forEach(f => {
      const d = f.date;
      const e = map.get(d) ?? { date: d, revenue: 0, expenses: 0, net: 0 };
      e.expenses += Number(f.total_cost);
      map.set(d, e);
    });
    return Array.from(map.values())
      .map(d => ({
        ...d,
        net: computeDailyNetProfit(d.revenue, Math.abs(d.expenses)),
        expenses: -Math.abs(d.expenses),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [loads, expenses, fuelLogs]);


  const empty = data.length === 0;
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 16 }}
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
                contentStyle={{ background: 'hsl(220 46% 9%)', border: '1px solid hsl(220 30% 22%)', borderRadius: 12, fontSize: 12, color: 'hsl(220 12% 92%)' }}
                labelStyle={{ color: 'hsl(220 12% 92%)', fontWeight: 600 }}
                itemStyle={{ color: 'hsl(220 12% 88%)' }}
                formatter={(v: any, name: any) => {
                  const num = Number(v);
                  // Revenue/Expenses bars display magnitude; Net Profit keeps its sign.
                  if (name === 'Net Profit') {
                    const sign = num < 0 ? '-' : '';
                    return [`${sign}$${Math.abs(num).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, name];
                  }
                  return [`$${Math.abs(num).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, name];
                }}
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
