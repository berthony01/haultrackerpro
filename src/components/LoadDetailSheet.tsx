import { Load } from '@/hooks/useLoads';
import { formatCurrency } from '@/lib/loadUtils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, Pencil, Trash2, Calendar, DollarSign, TrendingUp, TrendingDown, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface LoadDetailSheetProps {
  load: Load | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (load: Load) => void;
  onDelete: (id: string) => void;
}

const statusStyles: Record<string, string> = {
  completed: 'bg-success/15 text-success border-success/30',
  pending: 'bg-warning/15 text-warning border-warning/30',
  cancelled: 'bg-destructive/15 text-destructive border-destructive/30',
};

export function LoadDetailSheet({ load, open, onOpenChange, onEdit, onDelete }: LoadDetailSheetProps) {
  if (!load) return null;

  const estimated = Number(load.estimated_pay ?? 0);
  const actual = load.actual_pay_received != null ? Number(load.actual_pay_received) : null;
  const diff = actual != null ? actual - estimated : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left pb-2">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg font-black font-heading">Load Details</SheetTitle>
            <Badge variant="outline" className={`text-xs px-2 py-0.5 ${statusStyles[load.status] ?? ''}`}>
              {load.status}
            </Badge>
          </div>
        </SheetHeader>

        <div className="space-y-5 pt-2">
          {/* Date */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>{format(parseISO(load.load_date), 'EEEE, MMM d, yyyy')}</span>
          </div>

          {/* Route */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-success shrink-0" />
              <span className="text-sm font-medium">{load.pickup_location}</span>
            </div>
            <div className="ml-2 border-l-2 border-dashed border-muted-foreground/30 h-4" />
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-destructive shrink-0" />
              <span className="text-sm font-medium">{load.dropoff_location}</span>
            </div>
          </div>

          {/* Miles */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">Loaded Miles</p>
              <p className="text-lg font-bold font-mono">{load.loaded_miles}</p>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">Deadhead Miles</p>
              <p className="text-lg font-bold font-mono">{load.deadhead_miles}</p>
            </div>
          </div>

          {/* Pay */}
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg bg-primary/5 p-3">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Estimated Pay</span>
              </div>
              <span className="text-lg font-black font-mono text-primary">{formatCurrency(estimated)}</span>
            </div>

            {actual != null && (
              <>
                <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    <span className="text-sm font-medium">Actual Pay</span>
                  </div>
                  <span className="text-lg font-bold font-mono">{formatCurrency(actual)}</span>
                </div>
                <div className={`flex items-center justify-between rounded-lg p-3 ${diff! >= 0 ? 'bg-success/10' : 'bg-destructive/10'}`}>
                  <div className="flex items-center gap-2">
                    {diff! >= 0 ? <TrendingUp className="h-4 w-4 text-success" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
                    <span className="text-sm font-medium">Difference</span>
                  </div>
                  <span className={`text-lg font-bold font-mono ${diff! >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {diff! >= 0 ? '+' : ''}{formatCurrency(diff!)}
                  </span>
                </div>
              </>
            )}
            {actual == null && (
              <p className="text-xs text-muted-foreground italic">No actual pay entered yet</p>
            )}
          </div>

          {/* Fee breakdown */}
          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground text-sm mb-1">Fee Breakdown</p>
            <div className="flex justify-between"><span>Rate/Mile</span><span className="font-mono">${load.rate_per_mile}/mi</span></div>
            {Number(load.wait_fee) > 0 && <div className="flex justify-between"><span>Wait Fee</span><span className="font-mono">{formatCurrency(Number(load.wait_fee))}</span></div>}
            {Number(load.detention_fee) > 0 && <div className="flex justify-between"><span>Detention Fee</span><span className="font-mono">{formatCurrency(Number(load.detention_fee))}</span></div>}
            {Number(load.other_fees) > 0 && <div className="flex justify-between"><span>Other Fees</span><span className="font-mono">{formatCurrency(Number(load.other_fees))}</span></div>}
          </div>

          {/* Notes */}
          {load.notes && (
            <div className="rounded-lg bg-muted p-3">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Notes</span>
              </div>
              <p className="text-sm">{load.notes}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2 pb-4">
            <Button className="flex-1" onClick={() => { onOpenChange(false); onEdit(load); }}>
              <Pencil className="h-4 w-4 mr-1" /> Edit Load
            </Button>
            <Button variant="destructive" size="icon" onClick={() => { onOpenChange(false); onDelete(load.id); }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
