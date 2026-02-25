import { useState } from 'react';
import { Load, LoadUpdate } from '@/hooks/useLoads';
import { LoadCard, LoadCardSkeleton } from '@/components/LoadCard';
import { LoadDetailSheet } from '@/components/LoadDetailSheet';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { Truck, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

interface LoadsListViewProps {
  loads: Load[];
  onEdit: (load: Load) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: LoadUpdate) => void;
  onDuplicate: (load: Load) => void;
  onDateRangeChange: (from?: string, to?: string) => void;
  isLoading?: boolean;
  initialPayFilter?: string;
}

export function LoadsListView({ loads, onEdit, onDelete, onUpdate, onDuplicate, onDateRangeChange, isLoading, initialPayFilter }: LoadsListViewProps) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [payFilter, setPayFilter] = useState(initialPayFilter || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLoad, setSelectedLoad] = useState<Load | null>(null);

  const filtered = loads.filter(l => {
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    if (payFilter === 'missing_pay') {
      if (l.status === 'cancelled') return false;
      if (l.actual_pay_received != null) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!l.pickup_location.toLowerCase().includes(q) && !l.dropoff_location.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-black font-heading">My Loads</h1>
        <p className="text-sm text-muted-foreground">{filtered.length} loads</p>
      </div>

      <DateRangeFilter onRangeChange={onDateRangeChange} />

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search city or state..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-8 text-xs pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-28 h-8 text-xs">
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
          <SelectTrigger className="w-28 h-8 text-xs">
            <SelectValue placeholder="All pay" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Pay</SelectItem>
            <SelectItem value="missing_pay">Missing Pay</SelectItem>
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
          <CardContent className="py-12 text-center">
            <div className="inline-flex items-center justify-center rounded-2xl bg-muted p-4 mb-4">
              <Truck className="h-10 w-10 text-muted-foreground/40" />
            </div>
            <p className="font-bold text-lg">No loads found</p>
            <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(load => (
            <LoadCard key={load.id} load={load} onEdit={onEdit} onDelete={onDelete} onUpdate={onUpdate} onTap={() => setSelectedLoad(load)} />
          ))}
        </div>
      )}

      <LoadDetailSheet
        load={selectedLoad}
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
