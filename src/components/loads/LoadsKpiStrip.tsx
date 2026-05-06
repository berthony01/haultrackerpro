import { Hash, DollarSign, Route, TrendingUp } from 'lucide-react';
import { Load } from '@/hooks/useLoads';
import { sumExpectedPay, sumOperatingMiles, fleetEffectiveRPM } from '@/lib/loadMetrics';
import { formatCurrency, formatNumber } from '@/lib/loadUtils';
import { useMemo } from 'react';

interface LoadsKpiStripProps {
  loads: Load[];
}

export function LoadsKpiStrip({ loads }: LoadsKpiStripProps) {
  const stats = useMemo(() => ({
    count: loads.length,
    revenue: sumExpectedPay(loads),
    miles: sumOperatingMiles(loads),
    rpm: fleetEffectiveRPM(loads),
  }), [loads]);

  const tiles = [
    { label: 'Loads', value: String(stats.count), icon: Hash },
    { label: 'Revenue', value: formatCurrency(stats.revenue), icon: DollarSign },
    { label: 'Miles', value: formatNumber(stats.miles), icon: Route },
    { label: 'Avg $/Mile', value: `$${stats.rpm.toFixed(2)}`, icon: TrendingUp },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {tiles.map(t => (
        <div key={t.label} className="premium-card p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t.label}</p>
            <div className="rounded-lg bg-primary/10 p-1.5 ring-1 ring-primary/20">
              <t.icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            </div>
          </div>
          <p className="font-mono font-black tracking-tight text-foreground whitespace-nowrap" style={{ fontSize: 'clamp(1.1rem, 3.4vw, 1.5rem)' }}>
            {t.value}
          </p>
        </div>
      ))}
    </div>
  );
}
