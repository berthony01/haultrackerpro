import { ProfitCheckResult } from '@/hooks/useProfitCheck';
import { formatCurrency } from '@/lib/loadUtils';
import { TrendingUp, TrendingDown, AlertTriangle, ShieldCheck, Sparkles, Info } from 'lucide-react';

interface ProfitCheckCardProps {
  result: ProfitCheckResult;
}

const DECISION_META: Record<ProfitCheckResult['decision'], {
  label: string;
  className: string;
  Icon: typeof TrendingUp;
}> = {
  strong: { label: 'Strong load', className: 'bg-success/10 text-success border-success/30', Icon: ShieldCheck },
  fair: { label: 'Fair load', className: 'bg-primary/10 text-primary border-primary/30', Icon: TrendingUp },
  weak: { label: 'Weak load', className: 'bg-warning/10 text-warning border-warning/30', Icon: TrendingDown },
  risky: { label: 'Risky load', className: 'bg-destructive/10 text-destructive border-destructive/30', Icon: AlertTriangle },
};

export function ProfitCheckCard({ result }: ProfitCheckCardProps) {
  const meta = DECISION_META[result.decision];
  const { Icon } = meta;
  const hasHistory = result.hasLaneHistory || result.hasBrokerHistory;

  return (
    <div className="rounded-xl border-2 border-primary/20 bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Profit Check</span>
        {!hasHistory && (
          <span className="ml-auto text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            Estimate only
          </span>
        )}
      </div>

      <div className="p-4 space-y-3">
        {/* Decision badge */}
        <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${meta.className}`}>
          <Icon className="h-3.5 w-3.5" />
          {meta.label}
        </div>

        {/* Numbers */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Effective RPM</p>
            <p className="text-base font-black font-mono">${result.effectiveRpm.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Est. Net</p>
            <p className={`text-base font-black font-mono ${result.estimatedNet < 0 ? 'text-destructive' : 'text-foreground'}`}>
              {formatCurrency(result.estimatedNet)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Est. Variable Cost</p>
            <p className="text-sm font-bold font-mono text-muted-foreground">
              {result.estimatedVariableCost > 0 ? formatCurrency(result.estimatedVariableCost) : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Est. Margin</p>
            <p className={`text-sm font-bold font-mono ${result.estimatedMarginPct < 0 ? 'text-destructive' : result.estimatedMarginPct < 15 ? 'text-warning' : 'text-success'}`}>
              {result.estimatedVariableCost > 0 ? `${result.estimatedMarginPct.toFixed(0)}%` : '—'}
            </p>
          </div>
        </div>

        {/* Reasons */}
        {result.reasons.length > 0 && (
          <ul className="space-y-1 pt-1 border-t border-border/40">
            {result.reasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs leading-relaxed">
                <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground shrink-0" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        )}

        {!hasHistory && (
          <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground pt-1 border-t border-border/40">
            <Info className="h-3 w-3 shrink-0 mt-0.5" />
            <span>Log more loads on this lane to unlock history-based confidence.</span>
          </div>
        )}
      </div>
    </div>
  );
}
