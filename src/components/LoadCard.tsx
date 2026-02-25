import { Load } from '@/hooks/useLoads';
import { formatCurrency } from '@/lib/loadUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, Pencil, Trash2, Route } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface LoadCardProps {
  load: Load;
  onEdit: (load: Load) => void;
  onDelete: (id: string) => void;
}

const statusStyles: Record<string, string> = {
  completed: 'bg-success/15 text-success border-success/30',
  pending: 'bg-warning/15 text-warning border-warning/30',
  cancelled: 'bg-destructive/15 text-destructive border-destructive/30',
};

export function LoadCard({ load, onEdit, onDelete }: LoadCardProps) {
  const estimated = Number(load.estimated_pay ?? 0);
  const actual = load.actual_pay_received != null ? Number(load.actual_pay_received) : null;
  const diff = actual != null ? actual - estimated : null;

  return (
    <Card className="animate-slide-up hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Route className="h-4 w-4 text-primary shrink-0" />
              <span className="text-xs font-medium text-muted-foreground">
                {format(parseISO(load.load_date), 'MMM d, yyyy')}
              </span>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusStyles[load.status] ?? ''}`}>
                {load.status}
              </Badge>
            </div>
            <div className="space-y-1 mb-3">
              <div className="flex items-center gap-1.5 text-sm">
                <MapPin className="h-3 w-3 text-success shrink-0" />
                <span className="truncate font-medium">{load.pickup_location}</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <MapPin className="h-3 w-3 text-destructive shrink-0" />
                <span className="truncate font-medium">{load.dropoff_location}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{load.loaded_miles} mi loaded</span>
              <span>{load.deadhead_miles} mi DH</span>
              <span>${load.rate_per_mile}/mi</span>
            </div>
            {load.notes && (
              <p className="text-xs text-muted-foreground mt-2 italic truncate">📝 {load.notes}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground">Est.</p>
            <p className="text-lg font-black font-mono text-primary">
              {formatCurrency(estimated)}
            </p>
            {actual != null && (
              <>
                <p className="text-xs text-muted-foreground mt-1">Actual</p>
                <p className={`text-sm font-bold font-mono ${actual >= estimated ? 'text-success' : 'text-destructive'}`}>
                  {formatCurrency(actual)}
                </p>
                <p className={`text-[10px] font-mono ${diff! >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {diff! >= 0 ? '+' : ''}{formatCurrency(diff!)}
                </p>
              </>
            )}
            <div className="flex gap-1 mt-2">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(load)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete(load.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
