import { memo } from 'react';
import { FuelLog } from '@/hooks/useFuelLogs';
import { Load } from '@/hooks/useLoads';
import { formatCurrency } from '@/lib/loadUtils';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, Link2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface FuelTableProps {
  fuelLogs: FuelLog[];
  loadsMap: Map<string, Load>;
  onEdit: (log: FuelLog) => void;
  onDelete: (id: string) => void;
}

function FuelTableImpl({ fuelLogs, loadsMap, onEdit, onDelete }: FuelTableProps) {
  return (
    <div className="premium-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60">
              <th className="text-label text-left px-4 py-3">Date</th>
              <th className="text-label text-left px-4 py-3">Station</th>
              <th className="text-label text-right px-4 py-3">Gallons</th>
              <th className="text-label text-right px-4 py-3">$/Gal</th>
              <th className="text-label text-right px-4 py-3">Total</th>
              <th className="text-label text-right px-4 py-3">Odometer</th>
              <th className="text-label text-left px-4 py-3">Linked Load</th>
              <th className="text-label text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {fuelLogs.map((log) => {
              const linked = log.linked_load_id ? loadsMap.get(log.linked_load_id) : null;
              return (
                <tr
                  key={log.id}
                  className="border-b border-border/40 last:border-0 hover:bg-primary/5 transition-colors"
                >
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {format(parseISO(log.date), 'MMM d, yyyy')}
                  </td>
                  <td className="px-4 py-3 max-w-[180px]">
                    <span className="truncate block">{log.station || '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{Number(log.gallons).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    ${Number(log.price_per_gallon).toFixed(3)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono font-black text-foreground">
                      {formatCurrency(log.total_cost)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    {log.odometer ? Number(log.odometer).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 max-w-[220px]">
                    {linked ? (
                      <span className="inline-flex items-center gap-1 text-xs text-primary truncate">
                        <Link2 className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {linked.pickup_location.split(',')[0]} → {linked.dropoff_location.split(',')[0]}
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => onEdit(log)}>
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const FuelTable = memo(FuelTableImpl);
