import { memo } from 'react';
import { Load, LoadUpdate } from '@/hooks/useLoads';
import { LoadStop } from '@/hooks/useLoadStops';
import { formatCurrency, formatLocation, getEffectiveDate } from '@/lib/loadUtils';
import { getLoadEffectiveRPM } from '@/lib/loadMetrics';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowRight, Pencil, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';

const statusStyles: Record<string, string> = {
  completed: 'bg-success/15 text-success border-success/30',
  pending: 'bg-warning/15 text-warning border-warning/30',
  cancelled: 'bg-destructive/15 text-destructive border-destructive/30',
};

interface LoadsTableProps {
  loads: Load[];
  stops: LoadStop[];
  onEdit: (load: Load) => void;
  onDelete: (id: string) => void;
  onSelect: (load: Load) => void;
}

function Row({ load, stopCount, onEdit, onDelete, onSelect }: {
  load: Load; stopCount: number;
  onEdit: (l: Load) => void; onDelete: (id: string) => void; onSelect: (l: Load) => void;
}) {
  const estimated = Number(load.estimated_pay ?? 0);
  const actual = load.actual_pay_received != null ? Number(load.actual_pay_received) : null;
  const diff = actual != null ? actual - estimated : null;
  const rpm = getLoadEffectiveRPM(load);
  return (
    <tr
      className="border-b border-border/60 hover:bg-secondary/40 cursor-pointer transition-colors"
      onClick={() => onSelect(load)}
    >
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap font-mono">
        {format(parseISO(getEffectiveDate(load)), 'MMM d')}
      </td>
      <td className="px-3 py-3 min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold min-w-0">
          <span className="truncate">{formatLocation(load.pickup_location)}</span>
          <ArrowRight className="h-3 w-3 text-primary shrink-0" />
          <span className="truncate">{formatLocation(load.dropoff_location)}</span>
          {stopCount > 0 && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">+{stopCount}</Badge>}
        </div>
      </td>
      <td className="px-3 py-3 text-right font-mono text-xs whitespace-nowrap">
        {load.loaded_miles}
        {Number(load.deadhead_miles) > 0 && <span className="text-muted-foreground"> +{load.deadhead_miles}</span>}
      </td>
      <td className="px-3 py-3 text-right font-mono text-sm font-bold text-primary whitespace-nowrap">
        ${rpm.toFixed(2)}
      </td>
      <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">
        {formatCurrency(estimated)}
      </td>
      <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">
        {actual != null ? (
          <span className={actual >= estimated ? 'text-success font-bold' : 'text-destructive font-bold'}>
            {formatCurrency(actual)}
          </span>
        ) : <span className="text-muted-foreground/60">—</span>}
      </td>
      <td className="px-3 py-3 text-right font-mono text-xs whitespace-nowrap">
        {diff != null ? (
          <span className={diff >= 0 ? 'text-success' : 'text-destructive'}>
            {diff >= 0 ? '+' : ''}{formatCurrency(diff)}
          </span>
        ) : <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-semibold uppercase tracking-wide ${statusStyles[load.status] ?? ''}`}>
          {load.status}
        </Badge>
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
        <div className="flex justify-end gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md" onClick={() => onEdit(load)} aria-label="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-destructive hover:text-destructive" onClick={() => onDelete(load.id)} aria-label="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

const MemoRow = memo(Row);

export function LoadsTable({ loads, stops, onEdit, onDelete, onSelect }: LoadsTableProps) {
  return (
    <div className="premium-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-secondary/30">
              <th scope="col" className="px-3 py-2.5 text-left text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Date</th>
              <th scope="col" className="px-3 py-2.5 text-left text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Route</th>
              <th scope="col" className="px-3 py-2.5 text-right text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Miles</th>
              <th scope="col" className="px-3 py-2.5 text-right text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">$/Mi</th>
              <th scope="col" className="px-3 py-2.5 text-right text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Estimated</th>
              <th scope="col" className="px-3 py-2.5 text-right text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Actual</th>
              <th scope="col" className="px-3 py-2.5 text-right text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Δ</th>
              <th scope="col" className="px-3 py-2.5 text-left text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Status</th>
              <th scope="col" className="px-3 py-2.5 text-right text-[10px] uppercase tracking-widest text-muted-foreground font-semibold w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loads.map(load => (
              <MemoRow
                key={load.id}
                load={load}
                stopCount={stops.filter(s => s.load_id === load.id).length}
                onEdit={onEdit}
                onDelete={onDelete}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
