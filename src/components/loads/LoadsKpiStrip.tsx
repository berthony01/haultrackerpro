import { Hash, DollarSign, Route, TrendingUp, Info } from 'lucide-react';
import { Load } from '@/hooks/useLoads';
import { summarizeLoads, FINANCIAL_TOOLTIPS } from '@/lib/financialCalculations';
import { formatCurrency, formatNumber } from '@/lib/loadUtils';
import { useMemo } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface LoadsKpiStripProps {
  loads: Load[];
}

export function LoadsKpiStrip({ loads }: LoadsKpiStripProps) {
  const summary = useMemo(() => summarizeLoads(loads, []), [loads]);

  const tiles = [
    { label: 'Loads', value: String(summary.loadCount), icon: Hash, tip: 'Active loads in this view (cancelled excluded).', excludesCancelled: true },
    { label: 'Gross Revenue', value: formatCurrency(summary.grossRevenue), icon: DollarSign, tip: FINANCIAL_TOOLTIPS.grossRevenue },
    { label: 'Total Miles', value: formatNumber(summary.totalMiles), icon: Route, tip: 'Loaded + deadhead miles across all active loads.' },
    { label: 'Effective RPM', value: `$${summary.effectiveRPM.toFixed(2)}`, icon: TrendingUp, tip: FINANCIAL_TOOLTIPS.effectiveRPM },
  ];

  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map(t => (
          <Tooltip key={t.label}>
            <TooltipTrigger asChild>
              <div className="premium-card p-4 cursor-help">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t.label}</p>
                    {t.excludesCancelled && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="Excludes cancelled loads"
                            className="inline-flex items-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Info className="h-3 w-3 text-muted-foreground/70" aria-hidden="true" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">Excludes cancelled loads</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <div className="rounded-lg bg-primary/10 p-1.5 ring-1 ring-primary/20">
                    <t.icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  </div>
                </div>
                <p className="font-mono font-black tracking-tight text-foreground whitespace-nowrap" style={{ fontSize: 'clamp(1.1rem, 3.4vw, 1.5rem)' }}>
                  {t.value}
                </p>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[240px] text-xs">{t.tip}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
