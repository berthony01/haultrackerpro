import { useState, useMemo, memo } from 'react';
import { FuelLog } from '@/hooks/useFuelLogs';
import { Load } from '@/hooks/useLoads';
import { formatCurrency } from '@/lib/loadUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Fuel, Pencil, Trash2, Search, ArrowLeft, Gauge, Link2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { FuelKpiStrip } from '@/components/fuel/FuelKpiStrip';
import { FuelTable } from '@/components/fuel/FuelTable';

interface FuelLogsListViewProps {
  fuelLogs: FuelLog[];
  loads: Load[];
  onEdit: (log: FuelLog) => void;
  onDelete: (id: string) => void;
  isLoading?: boolean;
  onBack: () => void;
}

export function FuelLogsListView({ fuelLogs, loads, onEdit, onDelete, isLoading, onBack }: FuelLogsListViewProps) {
  const [search, setSearch] = useState('');

  const filteredLogs = useMemo(() => {
    if (!search.trim()) return fuelLogs;
    const s = search.toLowerCase();
    return fuelLogs.filter(
      (log) =>
        log.station?.toLowerCase().includes(s) ||
        log.notes?.toLowerCase().includes(s) ||
        log.date.includes(s)
    );
  }, [fuelLogs, search]);

  const loadsMap = useMemo(() => {
    const m = new Map<string, Load>();
    loads.forEach(l => m.set(l.id, l));
    return m;
  }, [loads]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Premium Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-black tracking-tight truncate">Fuel Logs</h1>
          <p className="text-sm text-muted-foreground truncate">Every gallon, every fill-up, every dollar</p>
        </div>
      </div>

      {/* KPI Strip */}
      <FuelKpiStrip fuelLogs={filteredLogs} />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by station, notes, or date…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 pl-9 rounded-xl bg-card/40 border-border/60 text-xs"
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="premium-card p-4">
              <div className="skeleton-shimmer h-16 rounded" />
            </div>
          ))}
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="premium-card border-dashed">
          <div className="py-12 text-center">
            <div className="inline-flex items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20 p-4 mb-4">
              <Fuel className="h-10 w-10 text-primary/60" />
            </div>
            <p className="font-bold text-lg">No fuel logs yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Start tracking your fuel purchases to see analytics.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filteredLogs.map((log) => (
              <FuelLogRowCard
                key={log.id}
                log={log}
                linkedLoad={log.linked_load_id ? loadsMap.get(log.linked_load_id) ?? null : null}
                onEdit={() => onEdit(log)}
                onDelete={() => onDelete(log.id)}
              />
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block">
            <FuelTable
              fuelLogs={filteredLogs}
              loadsMap={loadsMap}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </div>
        </>
      )}
    </div>
  );
}

interface FuelLogRowCardProps {
  log: FuelLog;
  linkedLoad: Load | null;
  onEdit: () => void;
  onDelete: () => void;
}

const FuelLogRowCard = memo(function FuelLogRowCard({
  log,
  linkedLoad,
  onEdit,
  onDelete,
}: FuelLogRowCardProps) {
  return (
    <Card className="premium-card">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 shrink-0 ring-1 ring-primary/20">
            <Fuel className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-muted-foreground font-mono whitespace-nowrap">
                    {format(parseISO(log.date), 'MMM d, yyyy')}
                  </span>
                  {log.station && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-semibold truncate max-w-[150px]">
                      {log.station}
                    </Badge>
                  )}
                </div>
                <p className="text-xl font-mono font-black text-foreground mt-0.5 whitespace-nowrap">
                  {formatCurrency(log.total_cost)}
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground font-mono mt-1">
                  <span>{Number(log.gallons).toFixed(2)} gal</span>
                  <span>${Number(log.price_per_gallon).toFixed(3)}/gal</span>
                  {log.odometer && (
                    <span className="inline-flex items-center gap-1">
                      <Gauge className="h-3 w-3" />
                      {Number(log.odometer).toLocaleString()} mi
                    </span>
                  )}
                </div>
                {linkedLoad && (
                  <p className="text-[11px] text-primary mt-1 truncate flex items-center gap-1">
                    <Link2 className="h-3 w-3 shrink-0" />
                    {linkedLoad.pickup_location.split(',')[0]} → {linkedLoad.dropoff_location.split(',')[0]}
                  </p>
                )}
                {log.notes && (
                  <p className="text-[11px] text-muted-foreground/70 mt-1 truncate">{log.notes}</p>
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={onEdit}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg text-destructive hover:text-destructive"
                  onClick={onDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
