import { Fuel, DollarSign, Droplet, TrendingUp } from 'lucide-react';
import { FuelLog } from '@/hooks/useFuelLogs';
import { formatCurrency } from '@/lib/loadUtils';
import { useMemo } from 'react';

interface FuelKpiStripProps {
  fuelLogs: FuelLog[];
}

/** 4-tile premium KPI strip mirroring dashboard / Loads / Expenses pattern. */
export function FuelKpiStrip({ fuelLogs }: FuelKpiStripProps) {
  const stats = useMemo(() => {
    const totalCost = fuelLogs.reduce((s, l) => s + Number(l.total_cost), 0);
    const totalGallons = fuelLogs.reduce((s, l) => s + Number(l.gallons), 0);
    const avgPpg = totalGallons > 0 ? totalCost / totalGallons : 0;
    return {
      count: fuelLogs.length,
      totalCost,
      totalGallons,
      avgPpg,
    };
  }, [fuelLogs]);

  const tiles = [
    { label: 'Fill-Ups', value: String(stats.count), icon: Fuel, sub: 'records' },
    { label: 'Total Spend', value: formatCurrency(stats.totalCost), icon: DollarSign, sub: 'filtered' },
    { label: 'Total Gallons', value: stats.totalGallons.toFixed(1), icon: Droplet, sub: 'gal' },
    { label: 'Avg $/Gal', value: stats.avgPpg > 0 ? `$${stats.avgPpg.toFixed(3)}` : '—', icon: TrendingUp, sub: 'pump avg' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {tiles.map(t => (
        <div key={t.label} className="premium-card p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-label">{t.label}</p>
            <div className="rounded-lg bg-primary/10 p-1.5 ring-1 ring-primary/20">
              <t.icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            </div>
          </div>
          <p
            className="font-mono font-black tracking-tight text-foreground whitespace-nowrap overflow-hidden text-ellipsis"
            style={{ fontSize: 'clamp(1.05rem, 3.2vw, 1.5rem)' }}
          >
            {t.value}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1 truncate">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}
