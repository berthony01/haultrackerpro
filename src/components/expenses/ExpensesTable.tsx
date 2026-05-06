import { memo } from 'react';
import { Expense } from '@/hooks/useExpenses';
import { Load } from '@/hooks/useLoads';
import { formatCurrency } from '@/lib/loadUtils';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, Receipt, Fuel, Wrench, Shield, Link2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface ExpensesTableProps {
  expenses: Expense[];
  loadsMap: Map<string, Load>;
  onEdit: (expense: Expense) => void;
  onDelete: (id: string) => void;
}

const categoryIcons: Record<string, typeof Receipt> = {
  Fuel: Fuel,
  Maintenance: Wrench,
  Insurance: Shield,
};

/**
 * Desktop expenses table — same density rhythm as LoadsTable.
 * Visual only: edit/delete handlers preserved verbatim.
 */
function ExpensesTableImpl({ expenses, loadsMap, onEdit, onDelete }: ExpensesTableProps) {
  return (
    <div className="premium-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60">
              <th className="text-label text-left px-4 py-3">Date</th>
              <th className="text-label text-left px-4 py-3">Category</th>
              <th className="text-label text-left px-4 py-3">Type</th>
              <th className="text-label text-right px-4 py-3">Amount</th>
              <th className="text-label text-left px-4 py-3">Linked Load</th>
              <th className="text-label text-left px-4 py-3">Notes</th>
              <th className="text-label text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => {
              const Icon = categoryIcons[e.category] || Receipt;
              const linked = e.linked_load_id ? loadsMap.get(e.linked_load_id) : null;
              const type = (e as { expense_type?: string }).expense_type ?? 'variable';
              return (
                <tr
                  key={e.id}
                  className="border-b border-border/40 last:border-0 hover:bg-primary/5 transition-colors"
                >
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {format(parseISO(e.expense_date), 'MMM d, yyyy')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="rounded-md bg-primary/10 p-1 ring-1 ring-primary/15">
                        <Icon className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <span className="font-semibold">{e.category}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono font-black text-foreground">
                      {formatCurrency(e.amount)}
                    </span>
                    {e.gallons ? (
                      <div className="text-[10px] text-muted-foreground font-mono">{e.gallons} gal</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 max-w-[220px]">
                    {linked ? (
                      <span className="inline-flex items-center gap-1 text-xs text-primary truncate">
                        <Link2 className="h-3 w-3 shrink-0" />
                        <span className="truncate">{linked.pickup_location} → {linked.dropoff_location}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-[260px]">
                    <span className="text-xs text-muted-foreground truncate block">{e.notes || '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => onEdit(e)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg text-destructive hover:text-destructive"
                      onClick={() => onDelete(e.id)}
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

export const ExpensesTable = memo(ExpensesTableImpl);
