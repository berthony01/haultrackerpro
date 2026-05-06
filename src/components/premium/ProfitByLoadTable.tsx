import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { formatCurrency, formatLocation, getEffectiveDate } from '@/lib/loadUtils';
import { getLoadExpectedPay, getLoadOperatingMiles } from '@/lib/loadMetrics';
import { motion } from 'framer-motion';

interface Props {
  loads: Load[];
  expenses: Expense[];
  onViewAll?: () => void;
}

export function ProfitByLoadTable({ loads, expenses, onViewAll }: Props) {
  const sorted = [...loads].sort((a, b) => getEffectiveDate(b).localeCompare(getEffectiveDate(a))).slice(0, 6);

  const expensesByLoad = (loadId: string) =>
    expenses.filter(e => (e as any).load_id === loadId).reduce((s, e) => s + Number(e.amount), 0);

  let totalRev = 0, totalExp = 0, totalNet = 0, totalMiles = 0;
  const rows = sorted.map(l => {
    const rev = l.actual_pay_received != null ? Number(l.actual_pay_received) : getLoadExpectedPay(l);
    const exp = expensesByLoad(l.id);
    const net = rev - exp;
    const miles = getLoadOperatingMiles(l);
    const ppm = miles > 0 ? net / miles : 0;
    totalRev += rev; totalExp += exp; totalNet += net; totalMiles += miles;
    const id = (l as any).load_number || `#${l.id.slice(0, 5)}`;
    return { id: l.id, label: id, route: `${formatLocation(l.pickup_location)} → ${formatLocation(l.dropoff_location)}`, rev, exp, net, ppm };
  });
  const totalPpm = totalMiles > 0 ? totalNet / totalMiles : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="premium-card p-4 sm:p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-foreground">Profit by Load</p>
        {onViewAll && (
          <button onClick={onViewAll} className="text-[11px] font-semibold text-primary hover:underline">
            View All Loads →
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No loads in range.</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs min-w-[520px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-semibold py-2 px-2">Load #</th>
                <th className="text-left font-semibold py-2 px-2">Route</th>
                <th className="text-right font-semibold py-2 px-2">Revenue</th>
                <th className="text-right font-semibold py-2 px-2">Expenses</th>
                <th className="text-right font-semibold py-2 px-2">Net Profit</th>
                <th className="text-right font-semibold py-2 px-2">$/Mile</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rows.map(r => (
                <tr key={r.id} className="border-t border-border/40 hover:bg-secondary/30 transition-colors">
                  <td className="py-2 px-2 font-bold text-foreground">{r.label}</td>
                  <td className="py-2 px-2 text-muted-foreground font-sans">{r.route}</td>
                  <td className="py-2 px-2 text-right text-foreground">{formatCurrency(r.rev)}</td>
                  <td className="py-2 px-2 text-right text-destructive">{formatCurrency(r.exp)}</td>
                  <td className={`py-2 px-2 text-right font-bold ${r.net >= 0 ? 'text-success' : 'text-destructive'}`}>{formatCurrency(r.net)}</td>
                  <td className="py-2 px-2 text-right text-foreground">{formatCurrency(r.ppm)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border/70 font-bold">
                <td className="py-2 px-2 font-sans uppercase text-[10px] tracking-wider text-muted-foreground">Total</td>
                <td />
                <td className="py-2 px-2 text-right text-foreground">{formatCurrency(totalRev)}</td>
                <td className="py-2 px-2 text-right text-destructive">{formatCurrency(totalExp)}</td>
                <td className={`py-2 px-2 text-right ${totalNet >= 0 ? 'text-success' : 'text-destructive'}`}>{formatCurrency(totalNet)}</td>
                <td className="py-2 px-2 text-right text-foreground">{formatCurrency(totalPpm)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}
