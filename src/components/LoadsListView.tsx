import { useState } from 'react';
import { Load } from '@/hooks/useLoads';
import { LoadCard } from '@/components/LoadCard';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { Truck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface LoadsListViewProps {
  loads: Load[];
  onEdit: (load: Load) => void;
  onDelete: (id: string) => void;
  onDateRangeChange: (from?: string, to?: string) => void;
  isLoading?: boolean;
}

export function LoadsListView({ loads, onEdit, onDelete, onDateRangeChange, isLoading }: LoadsListViewProps) {
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = statusFilter === 'all' ? loads : loads.filter(l => l.status === statusFilter);

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-black font-heading">My Loads</h1>
        <p className="text-sm text-muted-foreground">{filtered.length} loads</p>
      </div>

      <DateRangeFilter onRangeChange={onDateRangeChange} />

      <Select value={statusFilter} onValueChange={setStatusFilter}>
        <SelectTrigger className="w-40 h-8 text-xs">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="completed">Completed</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </SelectContent>
      </Select>

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
            <LoadCard key={load.id} load={load} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
