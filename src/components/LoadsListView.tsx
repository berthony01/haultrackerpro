import { useState, useEffect, useMemo } from 'react';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Load, LoadUpdate } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { useLoadStops } from '@/hooks/useLoadStops';
import { LoadCard, LoadCardSkeleton } from '@/components/LoadCard';
import { LoadDetailSheet } from '@/components/LoadDetailSheet';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { LoadsKpiStrip } from '@/components/loads/LoadsKpiStrip';
import { LoadsTable } from '@/components/loads/LoadsTable';
import { Truck, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

interface LoadsListViewProps {
  loads: Load[];
  expenses?: Expense[];
  onEdit: (load: Load) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: LoadUpdate) => void;
  onDuplicate: (load: Load) => void;
  onDateRangeChange: (from?: string, to?: string) => void;
  isLoading?: boolean;
  initialPayFilter?: string;
}

export function LoadsListView({ loads, expenses = [], onEdit, onDelete, onUpdate, onDuplicate, onDateRangeChange, isLoading, initialPayFilter }: LoadsListViewProps) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [payFilter, setPayFilter] = useState(initialPayFilter || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLoad, setSelectedLoad] = useState<Load | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const PAGE_SIZE = 50;

  const loadIds = useMemo(() => loads.map(l => l.id), [loads]);
  const { stops } = useLoadStops(loadIds);

  const filtered = useMemo(() => loads.filter(l => {
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    if (payFilter === 'missing_pay') {
      if (l.status === 'cancelled') return false;
      if (l.actual_pay_received != null) return false;
    }
    if (payFilter === 'unpaid') {
      if (l.payment_status !== 'unpaid' && l.payment_status !== 'invoiced') return false;
    }
    if (payFilter === 'overdue') {
      const isOverdue = l.payment_status === 'overdue' || (l.payment_due_date && !l.paid_date && new Date(l.payment_due_date) < new Date());
      if (!isOverdue) return false;
    }
    if (payFilter === 'paid') {
      if (l.payment_status !== 'paid') return false;
    }
    if (payFilter === 'short_paid') {
      if (l.payment_status !== 'short_paid') return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!l.pickup_location.toLowerCase().includes(q) && !l.dropoff_location.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [loads, statusFilter, payFilter, searchQuery]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginatedLoads = useMemo(
    () => filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
    [filtered, currentPage]
  );

  useEffect(() => { setCurrentPage(0); }, [statusFilter, payFilter, searchQuery, loads]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Loads</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} load{filtered.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Date range */}
      <DateRangeFilter onRangeChange={onDateRangeChange} />

      {/* KPI strip */}
      {filtered.length > 0 && <LoadsKpiStrip loads={filtered} />}

      {/* Filter bar */}
      <div className="premium-card p-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search city or state..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-9 text-xs pl-8 rounded-lg bg-secondary/40 border-border/60"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32 h-9 text-xs rounded-lg bg-secondary/40 border-border/60">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Select value={payFilter} onValueChange={setPayFilter}>
            <SelectTrigger className="w-32 h-9 text-xs rounded-lg bg-secondary/40 border-border/60">
              <SelectValue placeholder="All pay" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Pay</SelectItem>
              <SelectItem value="missing_pay">Pending Pay</SelectItem>
              <SelectItem value="unpaid">Unpaid</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="short_paid">Short Paid</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <LoadCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="premium-card border-dashed">
          <CardContent className="py-14 text-center">
            <div className="inline-flex items-center justify-center rounded-2xl bg-secondary/60 p-5 mb-5">
              <Truck className="h-10 w-10 text-muted-foreground/40" />
            </div>
            <p className="font-bold text-base">No loads match your filters</p>
            <p className="text-sm text-muted-foreground mt-1.5">Try adjusting your date range or filters above.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {paginatedLoads.map(load => (
              <LoadCard
                key={load.id}
                load={load}
                stops={stops.filter(s => s.load_id === load.id)}
                onEdit={onEdit}
                onDelete={onDelete}
                onUpdate={onUpdate}
                onTap={() => setSelectedLoad(load)}
              />
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block">
            <LoadsTable
              loads={paginatedLoads}
              stops={stops}
              onEdit={onEdit}
              onDelete={onDelete}
              onSelect={setSelectedLoad}
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

      <LoadDetailSheet
        load={selectedLoad}
        expenses={expenses}
        stops={stops}
        open={!!selectedLoad}
        onOpenChange={open => { if (!open) setSelectedLoad(null); }}
        onEdit={onEdit}
        onDelete={onDelete}
        onUpdate={onUpdate}
        onDuplicate={onDuplicate}
      />
    </div>
  );
}
