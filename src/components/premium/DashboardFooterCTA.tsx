import { TrendingUp, ArrowRight } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

interface Props { onClick?: () => void; }

export function DashboardFooterCTA({ onClick }: Props) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="premium-card p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4"
      style={{ borderColor: 'hsl(25 100% 50% / 0.35)' }}
    >
      <div className="rounded-xl bg-primary/15 p-3 ring-1 ring-primary/30">
        <TrendingUp className="h-6 w-6 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-base font-black text-foreground leading-tight">Track every mile. Every dollar. Every decision.</p>
        <p className="text-xs text-muted-foreground mt-1">HaulTrackerPro helps owner-operators run smarter and keep more of what they earn.</p>
      </div>
      <button onClick={onClick} className="btn-orange-glow rounded-xl px-4 sm:px-5 h-11 font-bold text-sm whitespace-nowrap inline-flex items-center gap-2 self-stretch sm:self-auto justify-center">
        Add Load <ArrowRight className="h-4 w-4" />
      </button>
    </motion.div>
  );
}
