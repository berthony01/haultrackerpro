import { useState } from 'react';
import { Load } from '@/hooks/useLoads';
import { LoadCard } from '@/components/LoadCard';
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
  onDateRangeChange: (from?: string, to?: string) => void;
  isLoading?: boolean;
}

export function LoadsListView({ loads, onEdit, onDelete, onDateRangeChange, isLoading }: LoadsListViewProps) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLoad, setSelectedLoad] = useState<Load | null>(null);

  const filtered = loads.filter(l => {
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
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
          <SelectTrigger className="w-32 h-8 text-xs">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="p-8 text-center">
            <Truck className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-semibold">No loads found</p>
            <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(load => (
            <LoadCard key={load.id} load={load} onEdit={onEdit} onDelete={onDelete} onTap={() => setSelectedLoad(load)} />
          ))}
        </div>
      )}

      <LoadDetailSheet
        load={selectedLoad}
        open={!!selectedLoad}
        onOpenChange={open => { if (!open) setSelectedLoad(null); }}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
}
