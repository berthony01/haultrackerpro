import { ProfitCheckResult } from '@/hooks/useProfitCheck';
import { CPM_BREAKDOWN_LABELS } from '@/hooks/useCostProfile';
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
  const hasCost = result.costSource !== 'none';

  const sourceLabel =
    result.costSource === 'profile' ? 'Based on your Cost Profile'
    : result.costSource === 'history' ? 'Based on 60-day actuals'
    : null;

  return (
    <div className="rounded-xl border-2 border-primary/20 bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Profit Check</span>
        {!hasHistory && !hasCost && (
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
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold" title="Technical term: Effective RPM">Real Pay/Mile</p>
            <p className="text-base font-black font-mono">${result.effectiveRpm.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Est. Take-Home</p>
            <p className={`text-base font-black font-mono ${result.estimatedNet < 0 ? 'text-destructive' : 'text-foreground'}`}>
              {formatCurrency(result.estimatedNet)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold" title="Technical term: Estimated Variable Cost">Est. Fuel & Truck Costs</p>
            <p className="text-sm font-bold font-mono text-muted-foreground">
              {result.estimatedVariableCost > 0 ? formatCurrency(result.estimatedVariableCost) : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Profit Margin</p>
            <p className={`text-sm font-bold font-mono ${result.estimatedMarginPct < 0 ? 'text-destructive' : result.estimatedMarginPct < 15 ? 'text-warning' : 'text-success'}`}>
              {result.estimatedVariableCost > 0 ? `${result.estimatedMarginPct.toFixed(0)}%` : '—'}
            </p>
          </div>
        </div>

        {/* Plain-English info row */}
        <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground pt-1 border-t border-border/40 leading-snug">
          <Info className="h-3 w-3 shrink-0 mt-0.5" />
          <span>
            "Real Pay/Mile" includes empty miles. "Fuel & Truck Costs" is the estimated cost of running this load — fuel, maintenance, and other operating costs from your Cost Profile.
          </span>
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

        {/* Personal target verdict */}
        {result.hasTargets && hasCost && (
          <div className="space-y-1 pt-1 border-t border-border/40">
            {result.meetsMinMargin != null && (
              <div className={`flex items-center gap-1.5 text-xs font-bold ${result.meetsMinMargin ? 'text-success' : 'text-destructive'}`}>
                <span>{result.meetsMinMargin ? '✓' : '✗'}</span>
                <span>{result.meetsMinMargin ? 'Meets your minimum margin' : 'Below your minimum margin'}</span>
              </div>
            )}
            {result.meetsMinRpm != null && (
              <div className={`flex items-center gap-1.5 text-xs font-bold ${result.meetsMinRpm ? 'text-success' : 'text-destructive'}`}>
                <span>{result.meetsMinRpm ? '✓' : '✗'}</span>
                <span>{result.meetsMinRpm ? 'Meets your minimum $/mile' : 'Below your minimum $/mile'}</span>
              </div>
            )}
          </div>
        )}

        {sourceLabel && (
          <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground pt-1 border-t border-border/40">
            <Info className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{sourceLabel}</span>
          </div>
        )}

        {/* Per-bucket CPM breakdown — shows the driver where every cent of cost is going */}
        {result.costSource === 'profile' && result.costBreakdown && Object.keys(result.costBreakdown).length > 0 && (
          <div className="pt-2 border-t border-border/40 space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Cost breakdown on this load</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {Object.entries(result.costBreakdown).map(([k, v]) => {
                const label = CPM_BREAKDOWN_LABELS[k as keyof typeof CPM_BREAKDOWN_LABELS] ?? k;
                const totalMiles = result.estimatedVariableCost > 0 && result.effectiveRpm > 0
                  ? result.estimatedGross / result.effectiveRpm
                  : 0;
                const tripCost = v * totalMiles;
                return (
                  <div key={k} className="flex items-baseline justify-between text-[11px]">
                    <span className="capitalize text-muted-foreground">{label}</span>
                    <span className="font-mono font-semibold">
                      ${v.toFixed(2)}<span className="text-muted-foreground">/mi</span>
                      <span className="text-muted-foreground"> · {formatCurrency(tripCost)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {result.costWarnings?.includes('fixed_missing_monthly_miles') && (
          <div className="flex items-start gap-1.5 text-[11px] pt-1 border-t border-border/40 rounded-md bg-warning/5 px-2 py-1.5">
            <AlertTriangle className="h-3 w-3 text-warning shrink-0 mt-0.5" />
            <span className="text-warning leading-relaxed">
              Fixed monthly costs aren't applied — set <span className="font-bold">Estimated monthly miles</span> in Settings → My Cost Profile.
            </span>
          </div>
        )}

        {!hasCost && (
          <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground pt-1 border-t border-border/40">
            <Info className="h-3 w-3 shrink-0 mt-0.5" />
            <span>Set up your <span className="font-bold text-primary">Cost Profile</span> in Settings to see real profitability before you accept loads.</span>
          </div>
        )}
      </div>
    </div>
  );
}
