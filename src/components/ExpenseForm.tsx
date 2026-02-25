import { useState } from 'react';
import { ExpenseInsert, EXPENSE_CATEGORIES } from '@/hooks/useExpenses';
import { Load } from '@/hooks/useLoads';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Receipt, X, AlertCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';

interface ExpenseFormProps {
  onSubmit: (data: ExpenseInsert) => void;
  onCancel?: () => void;
  loading?: boolean;
  loads?: Load[];
}

export function ExpenseForm({ onSubmit, onCancel, loading, loads = [] }: ExpenseFormProps) {
  const [form, setForm] = useState({
    expense_date: new Date().toISOString().split('T')[0],
    category: '',
    amount: '',
    gallons: '',
    linked_load_id: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isFuel = form.category === 'Fuel';

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.expense_date) errs.expense_date = 'Date is required';
    if (!form.category) errs.category = 'Category is required';
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) errs.amount = 'Amount must be greater than 0';
    if (form.gallons) {
      const g = parseFloat(form.gallons);
      if (isNaN(g) || g < 0) errs.gallons = 'Gallons cannot be negative';
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error('Please fix the errors before submitting');
      return false;
    }
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    onSubmit({
      expense_date: form.expense_date,
      category: form.category,
      amount: parseFloat(form.amount),
      gallons: isFuel && form.gallons ? parseFloat(form.gallons) : null,
      linked_load_id: form.linked_load_id || null,
      notes: form.notes.trim() || null,
    });
  };

  const update = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const FieldError = ({ field }: { field: string }) =>
    errors[field] ? (
      <p className="text-xs text-destructive flex items-center gap-1 mt-0.5">
        <AlertCircle className="h-3 w-3" /> {errors[field]}
      </p>
    ) : null;

  return (
    <Card className="border-2 border-primary/20 shadow-lg">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl font-heading flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            Add Expense
          </CardTitle>
          {onCancel && (
            <Button variant="ghost" size="icon" onClick={onCancel}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="expense_date">Date</Label>
              <Input id="expense_date" type="date" value={form.expense_date} onChange={e => update('expense_date', e.target.value)} required />
              <FieldError field="expense_date" />
            </div>
            <div>
              <Label htmlFor="category">Category</Label>
              <Select value={form.category} onValueChange={v => update('category', v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError field="category" />
            </div>
          </div>

          <div>
            <Label htmlFor="amount">Amount ($)</Label>
            <Input id="amount" type="number" step="0.01" min="0.01" placeholder="0.00" value={form.amount} onChange={e => update('amount', e.target.value)} required />
            <FieldError field="amount" />
          </div>

          {isFuel && (
            <div className="animate-fade-in">
              <Label htmlFor="gallons">Gallons (optional)</Label>
              <Input id="gallons" type="number" step="0.01" min="0" placeholder="0.00" value={form.gallons} onChange={e => update('gallons', e.target.value)} />
              <FieldError field="gallons" />
            </div>
          )}

          <div>
            <Label htmlFor="linked_load">Link to Load (optional)</Label>
            <Select value={form.linked_load_id} onValueChange={v => update('linked_load_id', v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="No link" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No link</SelectItem>
                {loads.slice(0, 50).map(l => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.pickup_location} → {l.dropoff_location} ({format(parseISO(l.load_date), 'MMM d')})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="expense_notes">Notes (optional)</Label>
            <Textarea id="expense_notes" placeholder="Optional notes..." rows={2} value={form.notes} onChange={e => update('notes', e.target.value)} />
          </div>

          <Button type="submit" className="w-full h-12 text-base font-bold" disabled={loading}>
            {loading ? 'Saving...' : 'Save Expense'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
