import { useState, useEffect } from 'react';
import { classifyCategory } from '@/lib/expenseClassifier';
import { Badge } from '@/components/ui/badge';
import { ExpenseInsert, Expense, EXPENSE_CATEGORIES } from '@/hooks/useExpenses';
import { Load } from '@/hooks/useLoads';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Receipt, X, AlertCircle, Mic, Camera, RefreshCcw, Lock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { VoiceExpenseModal } from '@/components/VoiceExpenseModal';
import { ReceiptScanModal } from '@/components/ReceiptScanModal';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';
import type { ParsedExpense } from '@/lib/parseExpenseText';
import { categorizeExpense } from '@/lib/categorizeExpense';
import { useRecurringExpenses } from '@/hooks/useRecurringExpenses';

interface ExpenseFormProps {
  onSubmit: (data: ExpenseInsert) => void;
  onCancel?: () => void;
  loading?: boolean;
  loads?: Load[];
  initialData?: Expense | null;
  isPro?: boolean;
}

export function ExpenseForm({ onSubmit, onCancel, loading, loads = [], initialData, isPro = false }: ExpenseFormProps) {
  const isEdit = !!initialData;

  const [form, setForm] = useState({
    expense_date: initialData?.expense_date ?? new Date().toISOString().split('T')[0],
    category: initialData?.category ?? '',
    amount: initialData?.amount?.toString() ?? '',
    gallons: initialData?.gallons?.toString() ?? '',
    linked_load_id: initialData?.linked_load_id ?? '',
    notes: initialData?.notes ?? '',
    expense_type: (initialData as any)?.expense_type ?? 'variable' as 'fixed' | 'variable',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // "Make this recurring" sub-form (create only, Pro only)
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [recurringName, setRecurringName] = useState('');
  const [recurringEndDate, setRecurringEndDate] = useState('');
  const { addTemplate } = useRecurringExpenses();

  // Auto-classify expense type when category changes
  useEffect(() => {
    if (form.category && !isEdit) {
      const autoType = classifyCategory(form.category);
      setForm(prev => ({ ...prev, expense_type: autoType }));
    }
  }, [form.category, isEdit]);

  // Modal states
  const [showVoice, setShowVoice] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState('');

  useEffect(() => {
    if (initialData) {
      setForm({
        expense_date: initialData.expense_date,
        category: initialData.category,
        amount: initialData.amount.toString(),
        gallons: initialData.gallons?.toString() ?? '',
        linked_load_id: initialData.linked_load_id ?? '',
        notes: initialData.notes ?? '',
        expense_type: (initialData as any)?.expense_type ?? 'variable',
      });
    }
  }, [initialData]);

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
      expense_type: form.expense_type,
    });
  };

  const update = (key: string, value: string) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      // AI Auto-categorization: when notes change and no category selected yet, try to detect
      if (key === 'notes' && !prev.category && isPro && value.length >= 3) {
        const detected = categorizeExpense(value);
        if (detected) {
          next.category = detected;
          toast.success(`Auto-detected: ${detected}`, { duration: 2000 });
        }
      }
      return next;
    });
    if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  /** Autofill only empty fields — never overwrite user-entered values */
  const handleAutofill = (parsed: ParsedExpense) => {
    setForm(prev => ({
      ...prev,
      amount: prev.amount ? prev.amount : (parsed.amount != null ? parsed.amount.toString() : prev.amount),
      category: prev.category ? prev.category : (parsed.category ?? prev.category),
      expense_date: prev.expense_date !== new Date().toISOString().split('T')[0] ? prev.expense_date : (parsed.date ?? prev.expense_date),
      notes: prev.notes ? prev.notes : (parsed.notes ?? prev.notes),
    }));
    toast.success('Form auto-filled with parsed data');
  };

  const handleAIButton = (type: 'voice' | 'receipt') => {
    if (!isPro) {
      setUpgradeFeature(type === 'voice' ? 'AI Voice Logging' : 'AI Receipt Scanning');
      setShowUpgrade(true);
      return;
    }
    if (type === 'voice') setShowVoice(true);
    else setShowReceipt(true);
  };

  const FieldError = ({ field }: { field: string }) =>
    errors[field] ? (
      <p className="text-xs text-destructive flex items-center gap-1 mt-0.5">
        <AlertCircle className="h-3 w-3" /> {errors[field]}
      </p>
    ) : null;

  return (
    <>
      <Card className="border-2 border-primary/20 shadow-lg">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-heading flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              {isEdit ? 'Edit Expense' : 'Add Expense'}
            </CardTitle>
            {onCancel && (
              <Button variant="ghost" size="icon" onClick={onCancel}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          {/* AI Quick Actions */}
          {!isEdit && (
            <div className="flex gap-2 mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 h-9 text-xs rounded-xl border-primary/30 hover:border-primary"
                onClick={() => handleAIButton('voice')}
              >
                <Mic className="h-3.5 w-3.5 mr-1.5 text-primary" />
                Voice Log
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 h-9 text-xs rounded-xl border-primary/30 hover:border-primary"
                onClick={() => handleAIButton('receipt')}
              >
                <Camera className="h-3.5 w-3.5 mr-1.5 text-primary" />
                Scan Receipt
              </Button>
            </div>
          )}
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
                {/* Fixed/Variable Classification */}
                {form.category && (
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">Type:</p>
                      <Badge variant={form.expense_type === 'fixed' ? 'secondary' : 'outline'} className="text-[10px] cursor-pointer" onClick={() => setForm(prev => ({ ...prev, expense_type: 'fixed' }))}>
                        Fixed
                      </Badge>
                      <Badge variant={form.expense_type === 'variable' ? 'secondary' : 'outline'} className="text-[10px] cursor-pointer" onClick={() => setForm(prev => ({ ...prev, expense_type: 'variable' }))}>
                        Variable
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {form.expense_type === 'fixed' ? 'Monthly overhead' : 'Per-trip cost'}
                    </p>
                  </div>
                )}
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
              <Select value={form.linked_load_id || 'none'} onValueChange={v => update('linked_load_id', v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="No link" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No link</SelectItem>
                  {loads.slice(0, 50).map(l => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.pickup_location} → {l.dropoff_location} ({format(parseISO(l.dropoff_date ?? l.load_date), 'MMM d')})
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
              {loading ? 'Saving...' : isEdit ? 'Update Expense' : 'Save Expense'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* AI Modals */}
      <VoiceExpenseModal open={showVoice} onOpenChange={setShowVoice} onAutofill={handleAutofill} />
      <ReceiptScanModal open={showReceipt} onOpenChange={setShowReceipt} onAutofill={handleAutofill} />
      <ProUpgradeModal open={showUpgrade} onOpenChange={setShowUpgrade} featureName={upgradeFeature} />
    </>
  );
}
