import { useState, useMemo } from 'react';
import { FuelLog } from '@/hooks/useFuelLogs';
import { Load } from '@/hooks/useLoads';
import { formatCurrency } from '@/lib/loadUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Fuel, Pencil, Trash2, Search, ArrowLeft, Calendar, Gauge, Link } from 'lucide-react';
import { format, parseISO } from 'date-fns';

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

  const totalCost = filteredLogs.reduce((sum, log) => sum + Number(log.total_cost), 0);
  const totalGallons = filteredLogs.reduce((sum, log) => sum + Number(log.gallons), 0);

  const getLinkedLoadInfo = (loadId: string | null) => {
    if (!loadId) return null;
    const load = loads.find((l) => l.id === loadId);
    if (!load) return null;
    return `${load.pickup_location.split(',')[0]} → ${load.dropoff_location.split(',')[0]}`;
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-black font-heading">Fuel Logs</h1>
          <p className="text-sm text-muted-foreground">Track your fuel purchases</p>
        </div>
      </div>

      {/* Summary */}
      <Card className="shadow-card bg-primary/5 border-primary/20">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Total Cost</p>
              <p className="text-xl font-black font-mono text-primary">{formatCurrency(totalCost)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Total Gallons</p>
              <p className="text-xl font-black font-mono">{totalGallons.toFixed(1)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search fuel logs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 pl-10 rounded-xl"
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="shadow-card">
              <CardContent className="p-4">
                <div className="skeleton-shimmer h-16 rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredLogs.length === 0 ? (
        <Card className="border-dashed border-2 border-muted-foreground/20 shadow-card">
          <CardContent className="py-12 text-center">
            <div className="inline-flex items-center justify-center rounded-2xl bg-muted p-4 mb-4">
              <Fuel className="h-10 w-10 text-muted-foreground/30" />
            </div>
            <p className="font-bold text-lg">No fuel logs yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Start tracking your fuel purchases to see analytics.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredLogs.map((log) => {
            const linkedLoad = getLinkedLoadInfo(log.linked_load_id);
            return (
              <Card key={log.id} className="shadow-card hover:shadow-card-hover transition-all duration-200">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Date + Station */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-muted-foreground">
                          {format(parseISO(log.date), 'MMM d, yyyy')}
                        </span>
                        {log.station && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-semibold truncate max-w-[150px]">
                            {log.station}
                          </Badge>
                        )}
                      </div>

                      {/* Details */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-medium">{log.gallons.toFixed(2)} gal</span>
                        <span>${Number(log.price_per_gallon).toFixed(3)}/gal</span>
                        {log.odometer && (
                          <span className="flex items-center gap-1">
                            <Gauge className="h-3 w-3" />
                            {log.odometer.toLocaleString()} mi
                          </span>
                        )}
                      </div>

                      {/* Linked Load */}
                      {linkedLoad && (
                        <div className="flex items-center gap-1 mt-1.5 text-[10px] text-primary/80">
                          <Link className="h-3 w-3" />
                          {linkedLoad}
                        </div>
                      )}

                      {/* Notes */}
                      {log.notes && (
                        <p className="text-xs text-muted-foreground/70 mt-1.5 truncate">{log.notes}</p>
                      )}
                    </div>

                    {/* Cost + Actions */}
                    <div className="text-right shrink-0 flex flex-col items-end">
                      <p className="text-lg font-black font-mono text-primary leading-tight">
                        {formatCurrency(log.total_cost)}
                      </p>
                      <div className="flex gap-1 mt-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg"
                          onClick={() => onEdit(log)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg text-destructive hover:text-destructive"
                          onClick={() => onDelete(log.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
