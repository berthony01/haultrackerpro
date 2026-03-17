import { useState } from 'react';
import { Load, LoadUpdate } from '@/hooks/useLoads';
import { formatCurrency, formatLocation } from '@/lib/loadUtils';
import { LoadStop } from '@/hooks/useLoadStops';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { MapPin, Pencil, Trash2, ChevronRight, DollarSign, Check, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';

interface LoadCardProps {
  load: Load;
  stops?: LoadStop[];
  onEdit: (load: Load) => void;
  onDelete: (id: string) => void;
  onUpdate?: (id: string, data: LoadUpdate) => void;
  onTap?: () => void;
}

const statusStyles: Record<string, string> = {
  completed: 'bg-success/15 text-success border-success/30',
  pending: 'bg-warning/15 text-warning border-warning/30',
  cancelled: 'bg-destructive/15 text-destructive border-destructive/30',
};

export function LoadCard({ load, stops = [], onEdit, onDelete, onUpdate, onTap }: LoadCardProps) {
  const [showPayInput, setShowPayInput] = useState(false);
  const [payValue, setPayValue] = useState('');

  const estimated = Number(load.estimated_pay ?? 0);
  const actual = load.actual_pay_received != null ? Number(load.actual_pay_received) : null;
  const diff = actual != null ? actual - estimated : null;
  const showAddPay = actual == null && load.status !== 'cancelled';
  const stopsCount = stops.length;

  const handleSavePay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const val = parseFloat(payValue);
    if (isNaN(val) || val < 0) {
      toast.error('Enter a valid amount');
      return;
    }
    const updates: LoadUpdate = { actual_pay_received: val };
    if (load.status === 'pending') updates.status = 'completed';
    onUpdate?.(load.id, updates);
    setShowPayInput(false);
    setPayValue('');
    toast.success('Actual pay saved');
  };

  return (
    <Card
      className="shadow-card hover:shadow-card-hover transition-all duration-200 cursor-pointer active:scale-[0.98] animate-slide-up"
      onClick={onTap}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Date + Status row */}
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-xs font-semibold text-muted-foreground">
                {(load as any).dropoff_date && (load as any).dropoff_date !== load.load_date
                  ? `${format(parseISO(load.load_date), 'MMM d')} → ${format(parseISO((load as any).dropoff_date), 'MMM d, yyyy')}`
                  : format(parseISO(load.load_date), 'MMM d, yyyy')}
              </span>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-semibold uppercase tracking-wide ${statusStyles[load.status] ?? ''}`}>
                {load.status}
              </Badge>
              {stopsCount > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-semibold">
                  +{stopsCount} stop{stopsCount !== 1 ? 's' : ''}
                </Badge>
              )}
            </div>

            {/* Route */}
            <div className="space-y-1.5 mb-3">
              <div className="flex items-center gap-2 text-sm">
                <div className="w-2 h-2 rounded-full bg-success shrink-0" />
                <span className="truncate font-medium">{formatLocation(load.pickup_location)}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="w-2 h-2 rounded-full bg-destructive shrink-0" />
                <span className="truncate font-medium">{formatLocation(load.dropoff_location)}</span>
              </div>
            </div>

            {/* Stats row */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium">{load.loaded_miles} mi</span>
              <span>{load.deadhead_miles} DH</span>
              <span>${load.rate_per_mile}/mi</span>
            </div>
          </div>

          {/* Pay column */}
          <div className="text-right shrink-0 flex flex-col items-end">
            <p className="text-lg font-black font-mono text-primary leading-tight">
              {formatCurrency(estimated)}
            </p>
            <p className="text-[10px] text-muted-foreground">estimated</p>
            {actual != null && (
              <div className="mt-1.5">
                <p className={`text-sm font-bold font-mono leading-tight ${actual >= estimated ? 'text-success' : 'text-destructive'}`}>
                  {formatCurrency(actual)}
                </p>
                <p className={`text-[10px] font-mono font-semibold ${diff! >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {diff! >= 0 ? '+' : ''}{formatCurrency(diff!)}
                </p>
              </div>
            )}
            <div className="flex gap-1 mt-2.5">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={(e) => { e.stopPropagation(); onEdit(load); }}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(load.id); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Add Actual Pay CTA */}
        {showAddPay && !showPayInput && (
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-3 h-9 text-xs font-semibold gap-1.5 rounded-xl border-primary/30 text-primary hover:bg-primary/5 active:scale-95 transition-transform"
            onClick={(e) => { e.stopPropagation(); setPayValue(estimated.toString()); setShowPayInput(true); }}
          >
            <DollarSign className="h-3.5 w-3.5" /> Add Actual Pay
          </Button>
        )}

        {/* Inline pay input */}
        {showPayInput && (
          <div className="flex items-center gap-2 mt-3" onClick={e => e.stopPropagation()}>
            <div className="relative flex-1">
              <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="number"
                step="0.01"
                min="0"
                value={payValue}
                onChange={e => setPayValue(e.target.value)}
                className="h-9 text-sm font-mono pl-8 rounded-xl"
                placeholder="0.00"
                autoFocus
              />
            </div>
            <Button size="icon" className="h-9 w-9 rounded-xl shrink-0" onClick={handleSavePay}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-9 w-9 rounded-xl shrink-0" onClick={(e) => { e.stopPropagation(); setShowPayInput(false); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Tap hint */}
        {!showPayInput && (
          <div className="flex items-center justify-center gap-1 mt-2 pt-2 border-t border-border/50">
            <span className="text-[10px] text-muted-foreground/60 font-medium">Tap for details</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LoadCardSkeleton() {
  return (
    <Card className="shadow-card">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-3">
            <div className="flex gap-2">
              <div className="skeleton-shimmer h-4 w-20 rounded" />
              <div className="skeleton-shimmer h-4 w-16 rounded" />
            </div>
            <div className="space-y-2">
              <div className="skeleton-shimmer h-4 w-40 rounded" />
              <div className="skeleton-shimmer h-4 w-36 rounded" />
            </div>
            <div className="skeleton-shimmer h-3 w-28 rounded" />
          </div>
          <div className="space-y-2 text-right">
            <div className="skeleton-shimmer h-6 w-20 rounded ml-auto" />
            <div className="skeleton-shimmer h-3 w-12 rounded ml-auto" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
