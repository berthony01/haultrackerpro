import { Load } from '@/hooks/useLoads';
import { formatCurrency, formatLocation, getEffectiveDate } from '@/lib/loadUtils';
import { getLoadExpectedPay } from '@/lib/loadMetrics';
import { format, parseISO } from 'date-fns';
import { CheckCircle2, Clock, CalendarClock } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

interface Props {
  loads: Load[];
  onViewAll?: () => void;
}

function statusFor(load: Load): { key: 'completed' | 'in_progress' | 'scheduled'; label: string; Icon: any; color: string } {
  if (load.status === 'completed' || load.actual_pay_received != null) {
    return { key: 'completed', label: 'Completed', Icon: CheckCircle2, color: 'text-success' };
  }
  const today = new Date().toISOString().split('T')[0];
  const eff = getEffectiveDate(load);
  if (eff > today) return { key: 'scheduled', label: 'Scheduled', Icon: CalendarClock, color: 'text-warning' };
  return { key: 'in_progress', label: 'In Progress', Icon: Clock, color: 'text-primary' };
}

export function RecentLoadsPanel({ loads, onViewAll }: Props) {
  const sorted = [...loads]
    .filter(l => (l.status ?? 'completed') !== 'cancelled')
    .sort((a, b) => getEffectiveDate(b).localeCompare(getEffectiveDate(a)))
    .slice(0, 5);


  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="premium-card p-4 sm:p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-foreground">Recent Loads</p>
        {onViewAll && (
          <button onClick={onViewAll} className="text-[11px] font-semibold text-primary hover:underline">
            View All
          </button>
        )}
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No loads yet.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map(load => {
            const s = statusFor(load);
            const pay = load.actual_pay_received != null ? Number(load.actual_pay_received) : getLoadExpectedPay(load);
            const id = (load as any).load_number || `#${load.id.slice(0, 5)}`;
            return (
              <li key={load.id} className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-secondary/40 transition-colors">
                <s.Icon className={`h-4 w-4 shrink-0 ${s.color}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground">{id}</span>
                    <span className={`text-[10px] font-semibold ${s.color}`}>{s.label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {formatLocation(load.pickup_location)} → {formatLocation(load.dropoff_location)}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">
                    {(() => { try { return format(parseISO(getEffectiveDate(load)), 'MMM d, yyyy'); } catch { return ''; } })()}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono text-sm font-bold text-foreground">{formatCurrency(pay)}</p>
                  <p className="text-[10px] text-muted-foreground">Profit</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}
