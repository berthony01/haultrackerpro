import { useState } from 'react';
import { Load, LoadUpdate } from '@/hooks/useLoads';
import { formatCurrency, formatLocation } from '@/lib/loadUtils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MapPin, Pencil, Trash2, Calendar, DollarSign, TrendingUp, TrendingDown, FileText, Copy, Ban, Check } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';

interface LoadDetailSheetProps {
  load: Load | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (load: Load) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: LoadUpdate) => void;
  onDuplicate: (load: Load) => void;
}

const statusStyles: Record<string, string> = {
  completed: 'bg-success/15 text-success border-success/30',
  pending: 'bg-warning/15 text-warning border-warning/30',
  cancelled: 'bg-destructive/15 text-destructive border-destructive/30',
};

export function LoadDetailSheet({ load, open, onOpenChange, onEdit, onDelete, onUpdate, onDuplicate }: LoadDetailSheetProps) {
  const [actualPayInput, setActualPayInput] = useState('');
  const [editingPay, setEditingPay] = useState(false);

  if (!load) return null;

  const estimated = Number(load.estimated_pay ?? 0);
  const actual = load.actual_pay_received != null ? Number(load.actual_pay_received) : null;
  const diff = actual != null ? actual - estimated : null;

  const handleSaveActualPay = () => {
    const val = parseFloat(actualPayInput);
    if (isNaN(val) || val < 0) {
      toast.error('Enter a valid amount');
      return;
    }
    const updates: LoadUpdate = { actual_pay_received: val };
    if (load.status === 'pending') updates.status = 'completed';
    onUpdate(load.id, updates);
    setEditingPay(false);
    toast.success('Payment recorded');
  };

  const handleMarkCancelled = () => {
    onUpdate(load.id, { status: 'cancelled', notes: load.notes || 'Cancelled by dispatcher' });
    onOpenChange(false);
    toast.success('Load marked as cancelled');
  };

  const startEditPay = () => {
    setActualPayInput(actual?.toString() ?? '');
    setEditingPay(true);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) setEditingPay(false); onOpenChange(o); }}>
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
              <span className="text-sm font-medium">{formatLocation(load.pickup_location)}</span>
            </div>
            <div className="ml-2 border-l-2 border-dashed border-muted-foreground/30 h-4" />
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-destructive shrink-0" />
              <span className="text-sm font-medium">{formatLocation(load.dropoff_location)}</span>
            </div>
          </div>

          {/* Miles */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-muted p-3">
              <p className="text-label">Loaded Miles</p>
              <p className="text-lg font-bold font-mono">{load.loaded_miles}</p>
            </div>
            <div className="rounded-xl bg-muted p-3">
              <p className="text-label">Deadhead Miles</p>
              <p className="text-lg font-bold font-mono">{load.deadhead_miles}</p>
            </div>
          </div>

          {/* Pay */}
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl bg-primary/5 p-3">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Estimated Pay</span>
              </div>
              <span className="text-value-lg text-primary">{formatCurrency(estimated)}</span>
            </div>

            {/* Editable Actual Pay */}
            <div className="flex items-center justify-between rounded-xl bg-muted p-3">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                <span className="text-sm font-medium">Actual Pay</span>
              </div>
              {editingPay ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={actualPayInput}
                    onChange={e => setActualPayInput(e.target.value)}
                    className="h-8 w-28 text-sm font-mono text-right rounded-lg"
                    autoFocus
                  />
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleSaveActualPay}>
                    <Check className="h-4 w-4 text-success" />
                  </Button>
                </div>
              ) : (
                <button onClick={startEditPay} className="text-lg font-bold font-mono hover:underline cursor-pointer">
                  {actual != null ? formatCurrency(actual) : <span className="text-xs text-muted-foreground italic">Tap to enter</span>}
                </button>
              )}
            </div>

            {diff != null && (
              <div className={`flex items-center justify-between rounded-xl p-3 ${diff >= 0 ? 'bg-success/10' : 'bg-destructive/10'}`}>
                <div className="flex items-center gap-2">
                  {diff >= 0 ? <TrendingUp className="h-4 w-4 text-success" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
                  <span className="text-sm font-medium">Difference</span>
                </div>
                <span className={`text-lg font-bold font-mono ${diff >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {diff >= 0 ? '+' : ''}{formatCurrency(diff)}
                </span>
              </div>
            )}
          </div>

          {/* Record Payment CTA */}
          {actual == null && load.status !== 'cancelled' && !editingPay && (
            <Button
              className="w-full gap-2 rounded-xl shadow-primary active:scale-95 transition-all duration-200 h-11 text-sm font-bold"
              onClick={startEditPay}
            >
              <DollarSign className="h-4 w-4" /> Record Payment
            </Button>
          )}

          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground text-sm mb-1">Fee Breakdown</p>
            <div className="flex justify-between"><span>Rate/Mile</span><span className="font-mono">${load.rate_per_mile}/mi</span></div>
            {Number(load.wait_fee) > 0 && <div className="flex justify-between"><span>Wait Fee</span><span className="font-mono">{formatCurrency(Number(load.wait_fee))}</span></div>}
            {Number(load.detention_fee) > 0 && <div className="flex justify-between"><span>Detention Fee</span><span className="font-mono">{formatCurrency(Number(load.detention_fee))}</span></div>}
            {Number(load.other_fees) > 0 && <div className="flex justify-between"><span>Other Fees</span><span className="font-mono">{formatCurrency(Number(load.other_fees))}</span></div>}
          </div>

          {/* Notes */}
          {load.notes && (
            <div className="rounded-xl bg-muted p-3">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Notes</span>
              </div>
              <p className="text-sm leading-relaxed">{load.notes}</p>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2 pt-2 pb-4">
            <div className="flex gap-2">
              <Button className="flex-1 rounded-xl" onClick={() => { onOpenChange(false); onEdit(load); }}>
                <Pencil className="h-4 w-4 mr-1" /> Edit Load
              </Button>
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => { onOpenChange(false); onDuplicate(load); }}>
                <Copy className="h-4 w-4 mr-1" /> Duplicate
              </Button>
            </div>
            <div className="flex gap-2">
              {load.status !== 'cancelled' && (
                <Button variant="outline" className="flex-1 text-destructive hover:text-destructive rounded-xl" onClick={handleMarkCancelled}>
                  <Ban className="h-4 w-4 mr-1" /> Cancel Load
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className={`rounded-xl ${load.status !== 'cancelled' ? '' : 'flex-1'}`}>
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this load?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove the load from {load.pickup_location} to {load.dropoff_location} on {format(parseISO(load.load_date), 'MMM d, yyyy')}. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => { onOpenChange(false); onDelete(load.id); }}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
