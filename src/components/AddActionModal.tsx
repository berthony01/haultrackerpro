import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Truck, Receipt, Fuel } from 'lucide-react';

interface AddActionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddLoad: () => void;
  onAddExpense: () => void;
  onAddFuelLog?: () => void;
}

export function AddActionModal({ open, onOpenChange, onAddLoad, onAddExpense, onAddFuelLog }: AddActionModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center font-heading">What would you like to add?</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3 pt-2">
          <Button
            variant="outline"
            className="h-24 flex-col gap-2 rounded-xl border-primary/30 hover:border-primary active:scale-95 transition-all duration-200"
            onClick={() => { onOpenChange(false); onAddLoad(); }}
          >
            <Truck className="h-7 w-7 text-primary" />
            <span className="font-bold text-sm">Add Load</span>
          </Button>
          <Button
            variant="outline"
            className="h-24 flex-col gap-2 rounded-xl border-primary/30 hover:border-primary active:scale-95 transition-all duration-200"
            onClick={() => { onOpenChange(false); onAddExpense(); }}
          >
            <Receipt className="h-7 w-7 text-primary" />
            <span className="font-bold text-sm">Add Expense</span>
          </Button>
          <Button
            variant="outline"
            className="h-24 flex-col gap-2 rounded-xl border-warning/30 hover:border-warning active:scale-95 transition-all duration-200"
            onClick={() => { onOpenChange(false); onAddFuelLog?.(); }}
          >
            <Fuel className="h-7 w-7 text-warning" />
            <span className="font-bold text-sm">Fuel Log</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
