import { Load } from '@/lib/types';
import { formatCurrency } from '@/lib/loadUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapPin, Pencil, Trash2, Route } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface LoadCardProps {
  load: Load;
  onEdit: (load: Load) => void;
  onDelete: (id: string) => void;
}

export function LoadCard({ load, onEdit, onDelete }: LoadCardProps) {
  return (
    <Card className="animate-slide-up hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Route className="h-4 w-4 text-primary shrink-0" />
              <span className="text-xs font-medium text-muted-foreground">
                {format(parseISO(load.date), 'MMM d, yyyy')}
              </span>
            </div>
            <div className="space-y-1 mb-3">
              <div className="flex items-center gap-1.5 text-sm">
                <MapPin className="h-3 w-3 text-success shrink-0" />
                <span className="truncate font-medium">{load.pickup}</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <MapPin className="h-3 w-3 text-destructive shrink-0" />
                <span className="truncate font-medium">{load.dropoff}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{load.loadedMiles} mi loaded</span>
              <span>{load.deadheadMiles} mi DH</span>
              <span>${load.ratePerMile}/mi</span>
              {load.waitFee > 0 && <span>Wait: {formatCurrency(load.waitFee)}</span>}
              {load.detentionFee > 0 && <span>Det: {formatCurrency(load.detentionFee)}</span>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-black font-mono text-primary">
              {formatCurrency(load.totalPay)}
            </p>
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
