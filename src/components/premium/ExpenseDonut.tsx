import { useMemo } from 'react';
import { Expense } from '@/hooks/useExpenses';
import { formatCurrency } from '@/lib/loadUtils';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { motion } from 'framer-motion';

interface Props { expenses: Expense[]; }

const PALETTE = [
  'hsl(25 100% 55%)',   // primary orange
  'hsl(0 84% 60%)',     // red
  'hsl(38 92% 55%)',    // amber
  'hsl(265 70% 60%)',   // purple
  'hsl(200 80% 55%)',   // blue
  'hsl(220 12% 50%)',   // gray (other)
];

const GROUP: Record<string, string> = {
  Fuel: 'Fuel',
  Maintenance: 'Maintenance', Repairs: 'Maintenance', Tires: 'Maintenance',
  Insurance: 'Insurance',
  'Truck Payment': 'Truck Payment', 'Lease Payment': 'Truck Payment',
};

export function ExpenseDonut({ expenses }: Props) {
  const { data, total } = useMemo(() => {
    const buckets: Record<string, number> = {};
    let total = 0;
    expenses.forEach(e => {
      const grp = GROUP[e.category] ?? 'Other';
      buckets[grp] = (buckets[grp] ?? 0) + Number(e.amount);
      total += Number(e.amount);
    });
    const data = Object.entries(buckets)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    return { data, total };
  }, [expenses]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="premium-card p-4 sm:p-5"
    >
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-foreground mb-3">Expense Breakdown</p>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">No expenses logged.</p>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="relative w-40 h-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" innerRadius={48} outerRadius={70} strokeWidth={0}>
                  {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'hsl(220 46% 9%)', border: '1px solid hsl(220 30% 22%)', borderRadius: 12, fontSize: 12 }}
                  formatter={(v: any) => formatCurrency(Number(v))}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <p className="font-mono text-base font-black text-foreground">{formatCurrency(total)}</p>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Total</p>
            </div>
          </div>
          <ul className="flex-1 w-full space-y-1.5">
            {data.map((d, i) => {
              const pct = total > 0 ? (d.value / total) * 100 : 0;
              return (
                <li key={d.name} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                  <span className="text-muted-foreground flex-1 truncate">{d.name}</span>
                  <span className="font-mono font-bold text-foreground whitespace-nowrap">{formatCurrency(d.value)}</span>
                  <span className="text-muted-foreground tabular-nums w-12 text-right">{pct.toFixed(1)}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </motion.div>
  );
}
