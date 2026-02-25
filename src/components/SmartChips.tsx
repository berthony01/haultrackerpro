import { useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { UserSettings } from '@/hooks/useUserSettings';
import { Button } from '@/components/ui/button';
import { Zap, RotateCcw, Copy, Navigation, DollarSign } from 'lucide-react';

interface SmartChipsProps {
  settings: UserSettings | null;
  lastLoad: Load | null;
  recentLoads: Load[];
  onUseDefaultRate: () => void;
  onUseLastRate: () => void;
  onCopyLastLoad: () => void;
  onApplyLane: (pickup: string, dropoff: string) => void;
  onApplyRate: (rate: number) => void;
}


export function SmartChips({ settings, lastLoad, recentLoads, onUseDefaultRate, onUseLastRate, onCopyLastLoad, onApplyLane, onApplyRate }: SmartChipsProps) {
  const hasEnoughLoads = recentLoads.length >= 3;

  const commonLanes = useMemo(() => {
    if (!hasEnoughLoads) return [];
    const laneCounts = new Map<string, { pickup: string; dropoff: string; count: number }>();
    recentLoads.forEach(l => {
      const key = `${l.pickup_location}→${l.dropoff_location}`;
      const existing = laneCounts.get(key);
      if (existing) existing.count++;
      else laneCounts.set(key, { pickup: l.pickup_location, dropoff: l.dropoff_location, count: 1 });
    });
    return Array.from(laneCounts.values())
      .filter(l => l.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 2);
  }, [recentLoads, hasEnoughLoads]);

  const commonRates = useMemo(() => {
    if (!hasEnoughLoads) return [];
    const rateCounts = new Map<number, number>();
    recentLoads.forEach(l => {
      const r = Number(l.rate_per_mile);
      if (r > 0) rateCounts.set(r, (rateCounts.get(r) || 0) + 1);
    });
    return Array.from(rateCounts.entries())
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([rate, count]) => ({ rate, count }));
  }, [recentLoads, hasEnoughLoads]);

  const chipClass = "text-[11px] h-7 px-2.5 rounded-xl gap-1 active:scale-95 transition-transform";

  return (
    <div className="flex flex-wrap gap-1.5">
      {settings?.default_rate_per_mile != null && (
        <Button type="button" variant="outline" size="sm" className={chipClass} onClick={onUseDefaultRate}>
          <Zap className="h-3 w-3" /> Default Rate
        </Button>
      )}
      {lastLoad && (
        <>
          <Button type="button" variant="outline" size="sm" className={chipClass} onClick={onUseLastRate}>
            <RotateCcw className="h-3 w-3" /> Last Rate
          </Button>
          <Button type="button" variant="outline" size="sm" className={chipClass} onClick={onCopyLastLoad}>
            <Copy className="h-3 w-3" /> Copy Last Load
          </Button>
        </>
      )}
      {commonLanes.map((lane, i) => (
        <Button
          key={`lane-${i}`}
          type="button"
          variant="outline"
          size="sm"
          className={`${chipClass} border-primary/30 text-primary`}
          onClick={() => onApplyLane(lane.pickup, lane.dropoff)}
        >
          <Navigation className="h-3 w-3" />
          {lane.pickup.split(',')[0]} → {lane.dropoff.split(',')[0]}
        </Button>
      ))}
      {commonRates.map((r, i) => (
        <Button
          key={`rate-${i}`}
          type="button"
          variant="outline"
          size="sm"
          className={`${chipClass} border-primary/30 text-primary`}
          onClick={() => onApplyRate(r.rate)}
        >
          <DollarSign className="h-3 w-3" /> ${r.rate.toFixed(2)}/mi
        </Button>
      ))}
    </div>
  );
}
