import { useState, memo } from 'react';
import { Load, LoadUpdate } from '@/hooks/useLoads';
import { formatCurrency, formatLocation, getEffectiveDate } from '@/lib/loadUtils';
import { getLoadEffectiveRPM } from '@/lib/loadMetrics';
import { derivePaymentDisplayStatus, getPaymentDifference, getLoadExpectedPay } from '@/lib/financialCalculations';
import { LoadStop } from '@/hooks/useLoadStops';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Pencil, Trash2, ChevronRight, DollarSign, Check, X, ArrowRight } from 'lucide-react';
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

function LoadCardImpl({ load, stops = [], onEdit, onDelete, onUpdate, onTap }: LoadCardProps) {
  const [showPayInput, setShowPayInput] = useState(false);
  const [payValue, setPayValue] = useState('');

  const estimated = Number(load.estimated_pay ?? 0);
  const actual = load.actual_pay_received != null ? Number(load.actual_pay_received) : null;
  const diff = actual != null ? actual - estimated : null;
  const showAddPay = actual == null && load.status !== 'cancelled';
  const stopsCount = stops.length;
  const rpm = getLoadEffectiveRPM(load);
  const payShown = actual ?? estimated;

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
      className="premium-card cursor-pointer active:scale-[0.99] transition-transform duration-150"
      onClick={onTap}
      role="button"
      aria-label={`Load ${formatLocation(load.pickup_location)} to ${formatLocation(load.dropoff_location)}, ${formatCurrency(payShown)}`}
    >
      <CardContent className="p-4">
        {/* Top meta row */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
              {format(parseISO(getEffectiveDate(load)), 'MMM d')}
            </span>
            <span className="h-1 w-1 rounded-full bg-border shrink-0" />
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-semibold uppercase tracking-wide ${statusStyles[load.status] ?? ''}`}>
              {load.status}
            </Badge>
            {load.payment_status && load.payment_status !== 'unpaid' && (
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-semibold uppercase tracking-wide ${
                load.payment_status === 'paid' ? 'bg-success/15 text-success border-success/30' :
                load.payment_status === 'overdue' || (load.payment_due_date && !load.paid_date && new Date(load.payment_due_date) < new Date()) ? 'bg-destructive/15 text-destructive border-destructive/30' :
                load.payment_status === 'short_paid' ? 'bg-warning/15 text-warning border-warning/30' :
                'bg-primary/15 text-primary border-primary/30'
              }`}>
                {load.payment_status === 'short_paid' ? 'short' : load.payment_status}
              </Badge>
            )}
            {stopsCount > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-semibold">
                +{stopsCount}
              </Badge>
            )}
          </div>
          <div className="flex gap-0.5 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={(e) => { e.stopPropagation(); onEdit(load); }} aria-label="Edit load">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(load.id); }} aria-label="Delete load">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Route — primary scan target */}
        <div className="flex items-center gap-2 mb-3 min-w-0">
          <span className="font-semibold text-[15px] truncate">{formatLocation(load.pickup_location)}</span>
          <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="font-semibold text-[15px] truncate">{formatLocation(load.dropoff_location)}</span>
        </div>

        {/* Profit row — biggest visual weight */}
        <div className="flex items-end justify-between gap-3 pt-2 border-t border-border/60">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              {actual != null ? 'Actual Pay' : 'Estimated'}
            </p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <p className={`font-mono font-black leading-tight tracking-tight ${actual != null ? (actual >= estimated ? 'text-success' : 'text-destructive') : 'text-foreground'}`} style={{ fontSize: 'clamp(1.25rem, 5vw, 1.5rem)' }}>
                {formatCurrency(payShown)}
              </p>
              {diff != null && (
                <span className={`text-[11px] font-mono font-bold ${diff >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {diff >= 0 ? '+' : ''}{formatCurrency(diff)}
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold" title="Effective RPM = gross ÷ all miles, including deadhead.">Eff. RPM</p>
            <p className="font-mono font-black text-primary text-lg leading-tight">${rpm.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">Contract ${Number(load.rate_per_mile).toFixed(2)}/mi</p>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground font-medium">
          <span className="font-mono">{load.loaded_miles} mi loaded</span>
          {Number(load.deadhead_miles) > 0 && (
            <>
              <span className="h-0.5 w-0.5 rounded-full bg-border" />
              <span className="font-mono">{load.deadhead_miles} mi DH</span>
            </>
          )}
        </div>

        {/* Add Actual Pay CTA */}
        {showAddPay && !showPayInput && (
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-3 h-9 text-xs font-semibold gap-1.5 rounded-lg border-primary/30 text-primary hover:bg-primary/10"
            onClick={(e) => { e.stopPropagation(); setPayValue(estimated.toString()); setShowPayInput(true); }}
          >
            <DollarSign className="h-3.5 w-3.5" /> Record Actual Pay
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
                className="h-9 text-sm font-mono pl-8 rounded-lg"
                placeholder="0.00"
                autoFocus
              />
            </div>
            <Button size="icon" className="h-9 w-9 rounded-lg shrink-0" onClick={handleSavePay} aria-label="Save actual pay">
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-9 w-9 rounded-lg shrink-0" onClick={(e) => { e.stopPropagation(); setShowPayInput(false); }} aria-label="Cancel">
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Tap hint */}
        {!showPayInput && (
          <div className="flex items-center justify-end gap-0.5 mt-2 text-muted-foreground/50">
            <span className="text-[10px] font-medium">Details</span>
            <ChevronRight className="h-3 w-3" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const LoadCard = memo(LoadCardImpl);

export function LoadCardSkeleton() {
  return (
    <Card className="premium-card">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-3">
            <div className="flex gap-2">
              <div className="skeleton-shimmer h-4 w-20 rounded" />
              <div className="skeleton-shimmer h-4 w-16 rounded" />
            </div>
            <div className="skeleton-shimmer h-5 w-48 rounded" />
            <div className="skeleton-shimmer h-6 w-32 rounded" />
            <div className="skeleton-shimmer h-3 w-28 rounded" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
