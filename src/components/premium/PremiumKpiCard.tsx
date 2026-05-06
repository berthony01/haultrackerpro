import { motion, useReducedMotion } from 'framer-motion';
import { LucideIcon, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface PremiumKpiCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  trendPct?: number | null;
  trendLabel?: string;
  delay?: number;
}

export function PremiumKpiCard({ label, value, icon: Icon, trendPct = null, trendLabel = 'vs last week', delay = 0 }: PremiumKpiCardProps) {
  const up = (trendPct ?? 0) >= 0;
  const reduce = useReducedMotion();
  const aria = trendPct != null
    ? `${label}: ${value}, ${up ? 'up' : 'down'} ${Math.abs(trendPct).toFixed(0)}% ${trendLabel}`
    : `${label}: ${value}`;
  return (
    <motion.div
      role="group"
      aria-label={aria}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: reduce ? 0 : delay, ease: 'easeOut' }}
      className="premium-card p-4 sm:p-5"
    >
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <div className="rounded-lg bg-primary/10 p-1.5 ring-1 ring-primary/20">
          <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        </div>
      </div>
      <p className="font-mono text-2xl sm:text-[28px] font-black tracking-tight text-foreground whitespace-nowrap" style={{ fontSize: 'clamp(1.25rem, 4vw, 1.75rem)' }}>
        {value}
      </p>
      {trendPct != null && (
        <div className={`mt-2 flex items-center gap-1 text-[11px] font-semibold ${up ? 'text-success' : 'text-destructive'}`}>
          {up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />}
          <span>{up ? '+' : ''}{trendPct.toFixed(0)}%</span>
          <span className="text-muted-foreground font-normal">{trendLabel}</span>
        </div>
      )}
    </motion.div>
  );
}
