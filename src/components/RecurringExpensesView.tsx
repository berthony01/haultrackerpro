import { useState } from 'react';
import { useRecurringExpenses, RecurringExpenseTemplateInsert, RecurringExpenseTemplate } from '@/hooks/useRecurringExpenses';
import { EXPENSE_CATEGORIES } from '@/hooks/useExpenses';
import { classifyCategory } from '@/lib/expenseClassifier';
import { formatCurrency } from '@/lib/loadUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { RefreshCcw, Plus, Pencil, Trash2, Pause, Play, ArrowLeft, X, Lock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';

interface RecurringExpensesViewProps {
  isPro: boolean;
  onBack: () => void;
}

export function RecurringExpensesView({ isPro, onBack }: RecurringExpensesViewProps) {
  const { templates, isLoading, addTemplate, updateTemplate, toggleActive, deleteTemplate } = useRecurringExpenses();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RecurringExpenseTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const handleAdd = () => {
    if (!isPro) {
      setShowUpgrade(true);
      return;
    }
    setEditing(null);
    setShowForm(true);
  };

  const handleEdit = (template: RecurringExpenseTemplate) => {
    setEditing(template);
    setShowForm(true);
  };

  const handleToggle = (template: RecurringExpenseTemplate) => {
    toggleActive.mutate(
      { id: template.id, is_active: !template.is_active },
      {
        onSuccess: () => toast.success(template.is_active ? 'Template paused' : 'Template resumed'),
        onError: (e) => toast.error(e.message),
      }
    );
  };

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      deleteTemplate.mutate(deleteTarget, {
        onSuccess: () => toast.success('Template deleted'),
        onError: (e) => toast.error(e.message),
      });
      setDeleteTarget(null);
    }
  };

  if (showForm) {
    return (
      <RecurringExpenseForm
        initialData={editing}
        onSubmit={(data) => {
          if (editing) {
            updateTemplate.mutate({ id: editing.id, data }, {
              onSuccess: () => { toast.success('Template updated'); setShowForm(false); setEditing(null); },
              onError: (e) => toast.error(e.message),
            });
          } else {
            addTemplate.mutate(data, {
              onSuccess: () => { toast.success('Template created'); setShowForm(false); },
              onError: (e) => toast.error(e.message),
            });
          }
        }}
        onCancel={() => { setShowForm(false); setEditing(null); }}
        loading={addTemplate.isPending || updateTemplate.isPending}
      />
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-xl" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-black font-heading">Recurring Expenses</h1>
            <p className="text-sm text-muted-foreground">Auto-generate monthly expenses</p>
          </div>
        </div>
        <Button size="sm" className="rounded-xl gap-1.5 font-bold" onClick={handleAdd}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {!isPro && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex items-center gap-3">
            <Lock className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">Pro Feature</p>
              <p className="text-xs text-muted-foreground">Recurring expenses auto-generate monthly. Upgrade to Pro to use this feature.</p>
            </div>
            <Button size="sm" className="shrink-0 rounded-xl font-bold" onClick={() => setShowUpgrade(true)}>
              Upgrade
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Template List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="shadow-card">
              <CardContent className="p-4">
                <div className="skeleton-shimmer h-16 rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <Card className="border-dashed border-2 border-muted-foreground/20 shadow-card">
          <CardContent className="py-14 text-center">
            <div className="inline-flex items-center justify-center rounded-2xl bg-muted p-5 mb-5">
              <RefreshCcw className="h-12 w-12 text-muted-foreground/30" />
            </div>
            <p className="font-bold text-lg">No recurring expenses</p>
            <p className="text-sm text-muted-foreground mt-1.5">
              Set up templates for monthly expenses like insurance, truck payments, or phone bills.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {templates.map((template) => (
            <Card key={template.id} className={`card-premium shadow-card transition-all duration-300 ${!template.is_active ? 'opacity-60' : ''}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-primary/10 p-2.5 shrink-0">
                    <RefreshCcw className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm truncate">{template.template_name}</span>
                          {!template.is_active && (
                            <Badge variant="secondary" className="text-[10px]">Paused</Badge>
                          )}
                        </div>
                        <p className="text-lg font-black mt-0.5">{formatCurrency(template.amount)}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-[10px]">{template.category}</Badge>
                          <span className="text-xs text-muted-foreground capitalize">{template.frequency}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Start: {format(parseISO(template.start_date), 'MMM d, yyyy')}
                          {template.end_date && ` · End: ${format(parseISO(template.end_date), 'MMM d, yyyy')}`}
                        </p>
                        {template.last_generated_date && (
                          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                            Last generated: {format(parseISO(template.last_generated_date), 'MMM yyyy')}
                          </p>
                        )}
                        {template.notes && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">{template.notes}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => handleToggle(template)}>
                          {template.is_active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => handleEdit(template)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-destructive hover:text-destructive" onClick={() => setDeleteTarget(template.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this template?</AlertDialogTitle>
            <AlertDialogDescription>This won't delete previously generated expenses. Future generation will stop.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProUpgradeModal open={showUpgrade} onOpenChange={setShowUpgrade} featureName="Recurring Expenses" />
    </div>
  );
}

// --- Form Component ---

interface RecurringExpenseFormProps {
  initialData?: RecurringExpenseTemplate | null;
  onSubmit: (data: RecurringExpenseTemplateInsert) => void;
  onCancel: () => void;
  loading?: boolean;
}

function RecurringExpenseForm({ initialData, onSubmit, onCancel, loading }: RecurringExpenseFormProps) {
  const isEdit = !!initialData;

  const [form, setForm] = useState({
    template_name: initialData?.template_name ?? '',
    category: initialData?.category ?? '',
    amount: initialData?.amount?.toString() ?? '',
    start_date: initialData?.start_date ?? new Date().toISOString().split('T')[0],
    end_date: initialData?.end_date ?? '',
    notes: initialData?.notes ?? '',
    expense_type: initialData?.expense_type ?? 'fixed' as string,
  });

  const update = (key: string, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'category' && !isEdit) {
        next.expense_type = classifyCategory(value);
      }
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!form.template_name.trim()) { toast.error('Template name is required'); return; }
    if (!form.category) { toast.error('Category is required'); return; }
    if (isNaN(amount) || amount <= 0) { toast.error('Amount must be greater than 0'); return; }

    onSubmit({
      template_name: form.template_name.trim(),
      category: form.category,
      amount,
      frequency: 'monthly',
      start_date: form.start_date,
      end_date: form.end_date || null,
      notes: form.notes.trim() || null,
      expense_type: form.expense_type,
    });
  };

  return (
    <Card className="border-2 border-primary/20 shadow-lg animate-fade-in">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl font-heading flex items-center gap-2">
            <RefreshCcw className="h-5 w-5 text-primary" />
            {isEdit ? 'Edit Template' : 'New Recurring Expense'}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="template_name">Template Name</Label>
            <Input
              id="template_name"
              placeholder="e.g. Monthly Insurance"
              value={form.template_name}
              onChange={(e) => update('template_name', e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="category">Category</Label>
              <Select value={form.category} onValueChange={(v) => update('category', v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="amount">Amount ($)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => update('amount', e.target.value)}
                required
              />
            </div>
          </div>

          {form.category && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">Type:</p>
              <Badge variant={form.expense_type === 'fixed' ? 'secondary' : 'outline'} className="text-[10px] cursor-pointer" onClick={() => setForm((p) => ({ ...p, expense_type: 'fixed' }))}>
                Fixed
              </Badge>
              <Badge variant={form.expense_type === 'variable' ? 'secondary' : 'outline'} className="text-[10px] cursor-pointer" onClick={() => setForm((p) => ({ ...p, expense_type: 'variable' }))}>
                Variable
              </Badge>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="start_date">Start Date</Label>
              <Input
                id="start_date"
                type="date"
                value={form.start_date}
                onChange={(e) => update('start_date', e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="end_date">End Date (optional)</Label>
              <Input
                id="end_date"
                type="date"
                value={form.end_date}
                onChange={(e) => update('end_date', e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label>Frequency</Label>
            <p className="text-sm text-muted-foreground mt-1">Monthly (generated on the 1st of each month)</p>
          </div>

          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="Optional notes..."
              rows={2}
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
            />
          </div>

          <Button type="submit" className="w-full h-12 text-base font-bold" disabled={loading}>
            {loading ? 'Saving...' : isEdit ? 'Update Template' : 'Create Template'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
