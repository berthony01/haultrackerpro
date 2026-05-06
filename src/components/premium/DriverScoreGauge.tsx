import { motion } from 'framer-motion';

interface Props {
  score: number;          // 0-100
  tier?: string;
  percentileLabel?: string;
}

export function DriverScoreGauge({ score, tier, percentileLabel }: Props) {
  const clamped = Math.max(0, Math.min(100, score));
  const angle = (clamped / 100) * 180; // half-circle
  const color = clamped >= 80 ? 'hsl(142 71% 45%)' : clamped >= 60 ? 'hsl(48 96% 53%)' : clamped >= 40 ? 'hsl(25 100% 55%)' : 'hsl(0 84% 60%)';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="premium-card p-5"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-3">Driver Score</p>
      <div className="relative w-full aspect-[2/1] max-w-[220px] mx-auto">
        <svg viewBox="0 0 200 110" className="w-full h-full">
          {/* track */}
          <path d="M 15 100 A 85 85 0 0 1 185 100" fill="none" stroke="hsl(220 30% 18%)" strokeWidth="14" strokeLinecap="round" />
          {/* progress */}
          <motion.path
            d="M 15 100 A 85 85 0 0 1 185 100"
            fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
            strokeDasharray="267"
            initial={{ strokeDashoffset: 267 }}
            animate={{ strokeDashoffset: 267 - (267 * angle) / 180 }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          <span className="font-mono text-4xl font-black text-foreground leading-none">{Math.round(clamped)}</span>
          {tier && <span className="text-xs font-semibold mt-1" style={{ color }}>{tier}</span>}
        </div>
      </div>
      {percentileLabel && (
        <p className="text-center text-[11px] text-muted-foreground mt-2">{percentileLabel}</p>
      )}
    </motion.div>
  );
}
