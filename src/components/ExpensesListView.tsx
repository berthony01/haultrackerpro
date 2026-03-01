import { useState, useMemo } from 'react';
import { Expense, EXPENSE_CATEGORIES } from '@/hooks/useExpenses';
import { Load } from '@/hooks/useLoads';
import { formatCurrency } from '@/lib/loadUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Receipt, Search, Pencil, Trash2, Fuel, Wrench, Shield, CircleDollarSign, ArrowLeft } from 'lucide-react';
import { format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subWeeks, subMonths } from 'date-fns';
import { useUserSettings } from '@/hooks/useUserSettings';
import { weekStartDayToNumber } from '@/lib/loadUtils';

interface ExpensesListViewProps {
  expenses: Expense[];
  loads: Load[];
  onEdit: (expense: Expense) => void;
  onDelete: (id: string) => void;
  isLoading?: boolean;
  onBack?: () => void;
}

type PresetKey = 'all' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year' | 'custom';

const presetOptions: { key: PresetKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'this_week', label: 'This Week' },
  { key: 'last_week', label: 'Last Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'this_year', label: 'This Year' },
  { key: 'custom', label: 'Custom' },
];

const categoryIcons: Record<string, typeof Receipt> = {
  Fuel: Fuel,
  Maintenance: Wrench,
  Insurance: Shield,
};

function getPresetRange(key: PresetKey, weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6): { start: Date; end: Date } | null {
  if (key === 'all' || key === 'custom') return null;
  const now = new Date();
  switch (key) {
    case 'this_week': return { start: startOfWeek(now, { weekStartsOn }), end: endOfWeek(now, { weekStartsOn }) };
    case 'last_week': { const lw = subWeeks(now, 1); return { start: startOfWeek(lw, { weekStartsOn }), end: endOfWeek(lw, { weekStartsOn }) }; }
    case 'this_month': return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'last_month': { const lm = subMonths(now, 1); return { start: startOfMonth(lm), end: endOfMonth(lm) }; }
    case 'this_year': return { start: startOfYear(now), end: endOfYear(now) };
    default: return null;
  }
}

export function ExpensesListView({ expenses, loads, onEdit, onDelete, isLoading, onBack }: ExpensesListViewProps) {
  const { settings } = useUserSettings();
  const weekStartsOn = weekStartDayToNumber(settings?.week_start_day);

  const [activePreset, setActivePreset] = useState<PresetKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const loadsMap = useMemo(() => {
    const m = new Map<string, Load>();
    loads.forEach(l => m.set(l.id, l));
    return m;
  }, [loads]);

  const filtered = useMemo(() => {
    let list = [...expenses];

    // Date filter
    if (activePreset === 'custom') {
      list = list.filter(e => {
        if (customFrom && e.expense_date < customFrom) return false;
        if (customTo && e.expense_date > customTo) return false;
        return true;
      });
    } else if (activePreset !== 'all') {
      const range = getPresetRange(activePreset, weekStartsOn);
      if (range) {
        const startStr = format(range.start, 'yyyy-MM-dd');
        const endStr = format(range.end, 'yyyy-MM-dd');
        list = list.filter(e => e.expense_date >= startStr && e.expense_date <= endStr);
      }
    }

    // Category filter
    if (categoryFilter !== 'all') {
      list = list.filter(e => e.category === categoryFilter);
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        (e.notes?.toLowerCase().includes(q)) ||
        e.category.toLowerCase().includes(q) ||
        formatCurrency(e.amount).includes(q)
      );
    }

    return list;
  }, [expenses, activePreset, customFrom, customTo, categoryFilter, search, weekStartsOn]);

  const totalFiltered = filtered.reduce((s, e) => s + Number(e.amount), 0);

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      onDelete(deleteTarget);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="icon" className="rounded-xl" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <div>
          <h1 className="text-2xl font-black font-heading">Expenses</h1>
          <p className="text-sm text-muted-foreground">Manage your expenses</p>
        </div>
      </div>

      {/* Total Summary */}
      <Card className="card-premium shadow-card">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 shrink-0">
            <CircleDollarSign className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-label">Total Expenses (filtered)</p>
            <p className="text-value-lg mt-0.5 whitespace-nowrap" style={{ fontSize: 'clamp(1rem, 5vw, 1.5rem)' }}>
              {formatCurrency(totalFiltered)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{filtered.length} expense{filtered.length !== 1 ? 's' : ''}</p>
          </div>
        </CardContent>
      </Card>

      {/* Date Presets */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {presetOptions.map(p => (
            <Button
              key={p.key}
              variant={activePreset === p.key ? 'default' : 'outline'}
              size="sm"
              className={`text-xs h-8 px-3 rounded-xl active:scale-95 transition-all duration-200 ${activePreset === p.key ? 'shadow-primary' : ''}`}
              onClick={() => setActivePreset(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {activePreset === 'custom' && (
          <div className="flex gap-2 items-center animate-fade-in">
            <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-9 text-xs flex-1 rounded-xl" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-9 text-xs flex-1 rounded-xl" />
          </div>
        )}
      </div>

      {/* Category + Search Filters */}
      <div className="flex gap-2">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-9 text-xs rounded-xl flex-1">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {EXPENSE_CATEGORIES.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search notes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-9 text-xs pl-8 rounded-xl"
          />
        </div>
      </div>

      {/* Expense List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="shadow-card">
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <div className="skeleton-shimmer rounded-xl w-10 h-10 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton-shimmer h-3 w-20 rounded" />
                    <div className="skeleton-shimmer h-5 w-16 rounded" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed border-2 border-muted-foreground/20 shadow-card">
          <CardContent className="py-14 text-center">
            <div className="inline-flex items-center justify-center rounded-2xl bg-muted p-5 mb-5">
              <Receipt className="h-12 w-12 text-muted-foreground/30" />
            </div>
            <p className="font-bold text-lg">No expenses found</p>
            <p className="text-sm text-muted-foreground mt-1.5">
              {expenses.length === 0 ? 'Start logging expenses to see them here.' : 'Try adjusting your filters.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(expense => {
            const IconComp = categoryIcons[expense.category] || Receipt;
            const linkedLoad = expense.linked_load_id ? loadsMap.get(expense.linked_load_id) : null;

            return (
              <Card key={expense.id} className="card-premium shadow-card hover:shadow-card-hover transition-all duration-300">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-primary/10 p-2.5 shrink-0">
                      <IconComp className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm">{expense.category}</span>
                            <span className="text-xs text-muted-foreground">
                              {format(parseISO(expense.expense_date), 'MMM d, yyyy')}
                            </span>
                          </div>
                          <p className="text-lg font-black mt-0.5">{formatCurrency(expense.amount)}</p>
                          {expense.gallons && (
                            <p className="text-xs text-muted-foreground">{expense.gallons} gal</p>
                          )}
                          {linkedLoad ? (
                            <p className="text-xs text-primary mt-1 truncate">
                              🔗 {linkedLoad.pickup_location} → {linkedLoad.dropoff_location}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground/50 mt-1">No linked load</p>
                          )}
                          {expense.notes && (
                            <p className="text-xs text-muted-foreground mt-1 truncate">{expense.notes}</p>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => onEdit(expense)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-destructive hover:text-destructive" onClick={() => setDeleteTarget(expense.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
