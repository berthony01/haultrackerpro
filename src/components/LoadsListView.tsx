import { useState, useEffect } from 'react';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Load, LoadUpdate } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { useLoadStops } from '@/hooks/useLoadStops';
import { LoadCard, LoadCardSkeleton } from '@/components/LoadCard';
import { LoadDetailSheet } from '@/components/LoadDetailSheet';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { Truck, Search, TrendingUp, Route, Hash, DollarSign } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { formatCurrency, formatNumber } from '@/lib/loadUtils';
import { sumExpectedPay, sumOperatingMiles, fleetEffectiveRPM } from '@/lib/loadMetrics';

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

  const loadIds = loads.map(l => l.id);
  const { stops } = useLoadStops(loadIds);

  const filtered = loads.filter(l => {
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
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginatedLoads = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => { setCurrentPage(0); }, [statusFilter, payFilter, searchQuery]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-black font-heading">My Loads</h1>
        <p className="text-sm text-muted-foreground">{filtered.length} load{filtered.length !== 1 ? 's' : ''}</p>
      </div>

      <DateRangeFilter onRangeChange={onDateRangeChange} />

      {/* Summary Card */}
      {(() => {
        const totalLoads = filtered.length;
        const totalRevenue = filtered.reduce((s, l) => s + (l.gross_revenue ?? l.estimated_pay ?? 0), 0);
        const totalMiles = filtered.reduce((s, l) => s + (l.loaded_miles || 0), 0);
        const avgPerMile = totalMiles > 0 ? totalRevenue / totalMiles : 0;

        return totalLoads > 0 ? (
          <Card className="card-premium shadow-card">
            <CardContent className="p-4">
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center">
                  <div className="flex items-center justify-center mb-1">
                    <Hash className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <p className="text-lg font-black">{totalLoads}</p>
                  <p className="text-[10px] text-muted-foreground">Loads</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center mb-1">
                    <DollarSign className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <p className="text-lg font-black">{formatCurrency(totalRevenue)}</p>
                  <p className="text-[10px] text-muted-foreground">Revenue</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center mb-1">
                    <Route className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <p className="text-lg font-black">{formatNumber(totalMiles)}</p>
                  <p className="text-[10px] text-muted-foreground">Miles</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center mb-1">
                    <TrendingUp className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <p className="text-lg font-black">${avgPerMile.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">Avg $/mi</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null;
      })()}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search city or state..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-8 text-xs pl-8 rounded-xl"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-28 h-8 text-xs rounded-xl">
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
          <SelectTrigger className="w-28 h-8 text-xs rounded-xl">
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

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <LoadCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed border-2 border-muted-foreground/20 shadow-card">
          <CardContent className="py-14 text-center">
            <div className="inline-flex items-center justify-center rounded-2xl bg-muted p-5 mb-5">
              <Truck className="h-12 w-12 text-muted-foreground/30" />
            </div>
            <p className="font-bold text-lg">No loads match your filters</p>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">Try adjusting your date range or filters above.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
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
