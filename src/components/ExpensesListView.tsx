import { useState, useMemo, useEffect, memo } from 'react';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Expense, EXPENSE_CATEGORIES } from '@/hooks/useExpenses';
import { Load } from '@/hooks/useLoads';
import { formatCurrency } from '@/lib/loadUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Receipt, Search, Pencil, Trash2, Fuel, Wrench, Shield, ArrowLeft, RefreshCcw, Link2 } from 'lucide-react';
import { format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subWeeks, subMonths } from 'date-fns';
import { useUserSettings } from '@/hooks/useUserSettings';
import { weekStartDayToNumber } from '@/lib/loadUtils';
import { ParkingExportButton } from '@/components/ParkingExportButton';
import { ExpensesKpiStrip } from '@/components/expenses/ExpensesKpiStrip';
import { ExpensesTable } from '@/components/expenses/ExpensesTable';

interface ExpensesListViewProps {
  expenses: Expense[];
  loads: Load[];
  onEdit: (expense: Expense) => void;
  onDelete: (id: string) => void;
  isLoading?: boolean;
  onBack?: () => void;
  onNavigate?: (page: string) => void;
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

export function ExpensesListView({ expenses, loads, onEdit, onDelete, isLoading, onBack, onNavigate }: ExpensesListViewProps) {
  const { settings } = useUserSettings();
  const weekStartsOn = weekStartDayToNumber(settings?.week_start_day);

  const [activePreset, setActivePreset] = useState<PresetKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const PAGE_SIZE = 50;

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

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginatedExpenses = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => { setCurrentPage(0); }, [activePreset, customFrom, customTo, categoryFilter, search]);

  const totalFiltered = filtered.reduce((s, e) => s + Number(e.amount), 0);

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      onDelete(deleteTarget);
      setDeleteTarget(null);
    }
  };

  const loadsMapForTable = loadsMap;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Premium Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <Button variant="ghost" size="icon" className="rounded-xl shrink-0" onClick={onBack}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-black tracking-tight truncate">Expenses</h1>
            <p className="text-sm text-muted-foreground truncate">Track every dollar that hits your bottom line</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ParkingExportButton expenses={expenses} loads={loads} />
          {onNavigate && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl gap-1.5 text-xs font-bold border-border/60 bg-card/40"
              onClick={() => onNavigate('recurring_expenses')}
            >
              <RefreshCcw className="h-3.5 w-3.5" /> Recurring
            </Button>
          )}
        </div>
      </div>

      {/* KPI Strip — premium tokens */}
      <ExpensesKpiStrip expenses={filtered} />

      {/* Date Presets — ghost pills, orange active */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {presetOptions.map(p => {
            const active = activePreset === p.key;
            return (
              <button
                key={p.key}
                type="button"
                aria-pressed={active}
                onClick={() => setActivePreset(p.key)}
                className={[
                  'h-8 px-3 rounded-full text-xs font-semibold transition-all duration-200',
                  active
                    ? 'bg-primary text-primary-foreground shadow-primary'
                    : 'bg-card/40 text-muted-foreground border border-border/60 hover:text-foreground hover:border-primary/40',
                ].join(' ')}
              >
                {p.label}
              </button>
            );
          })}
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
          <SelectTrigger className="h-10 text-xs rounded-xl flex-1 bg-card/40 border-border/60">
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search notes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-10 text-xs pl-9 rounded-xl bg-card/40 border-border/60"
          />
        </div>
      </div>

      {/* Expense List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="premium-card p-4">
              <div className="flex gap-3">
                <div className="skeleton-shimmer rounded-xl w-10 h-10 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton-shimmer h-3 w-20 rounded" />
                  <div className="skeleton-shimmer h-5 w-24 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="premium-card border-dashed">
          <div className="py-14 text-center">
            <div className="inline-flex items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20 p-5 mb-5">
              <Receipt className="h-12 w-12 text-primary/60" />
            </div>
            <p className="font-bold text-lg">No expenses found</p>
            <p className="text-sm text-muted-foreground mt-1.5">
              {expenses.length === 0 ? 'Start logging expenses to see them here.' : 'Try adjusting your filters.'}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {paginatedExpenses.map(expense => (
              <ExpenseRowCard
                key={expense.id}
                expense={expense}
                linkedLoad={expense.linked_load_id ? loadsMap.get(expense.linked_load_id) ?? null : null}
                onEdit={() => onEdit(expense)}
                onDelete={() => setDeleteTarget(expense.id)}
              />
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block">
            <ExpensesTable
              expenses={paginatedExpenses}
              loadsMap={loadsMapForTable}
              onEdit={onEdit}
              onDelete={(id) => setDeleteTarget(id)}
            />
          </div>
        </>
      )}

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                className={currentPage === 0 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const pageNum = totalPages <= 5 ? i : Math.min(Math.max(currentPage - 2, 0), totalPages - 5) + i;
              return (
                <PaginationItem key={pageNum}>
                  <PaginationLink
                    isActive={pageNum === currentPage}
                    onClick={() => setCurrentPage(pageNum)}
                    className="cursor-pointer"
                  >
                    {pageNum + 1}
                  </PaginationLink>
                </PaginationItem>
              );
            })}
            <PaginationItem>
              <PaginationNext
                onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                className={currentPage >= totalPages - 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
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

const categoryIconMap: Record<string, typeof Receipt> = {
  Fuel: Fuel,
  Maintenance: Wrench,
  Insurance: Shield,
};

interface ExpenseRowCardProps {
  expense: Expense;
  linkedLoad: Load | null;
  onEdit: () => void;
  onDelete: () => void;
}

const ExpenseRowCard = memo(function ExpenseRowCard({
  expense,
  linkedLoad,
  onEdit,
  onDelete,
}: ExpenseRowCardProps) {
  const Icon = categoryIconMap[expense.category] || Receipt;
  return (
    <Card className="premium-card">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 shrink-0 ring-1 ring-primary/20">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm">{expense.category}</span>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {format(parseISO(expense.expense_date), 'MMM d, yyyy')}
                  </span>
                </div>
                <p className="text-xl font-mono font-black text-foreground mt-0.5 whitespace-nowrap">
                  {formatCurrency(expense.amount)}
                </p>
                {expense.gallons && (
                  <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{expense.gallons} gal</p>
                )}
                {linkedLoad ? (
                  <p className="text-[11px] text-primary mt-1 truncate flex items-center gap-1">
                    <Link2 className="h-3 w-3 shrink-0" />
                    {linkedLoad.pickup_location} → {linkedLoad.dropoff_location}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground/50 mt-1">No linked load</p>
                )}
                {expense.notes && (
                  <p className="text-[11px] text-muted-foreground mt-1 truncate">{expense.notes}</p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={onEdit}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg text-destructive hover:text-destructive"
                  onClick={onDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

