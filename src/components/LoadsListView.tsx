import { Load } from '@/lib/types';
import { LoadCard } from '@/components/LoadCard';
import { Truck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface LoadsListViewProps {
  loads: Load[];
  onEdit: (load: Load) => void;
  onDelete: (id: string) => void;
}

export function LoadsListView({ loads, onEdit, onDelete }: LoadsListViewProps) {
  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-black font-heading">My Loads</h1>
        <p className="text-sm text-muted-foreground">{loads.length} total loads</p>
      </div>

      {loads.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="p-8 text-center">
            <Truck className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-semibold">No loads yet</p>
            <p className="text-sm text-muted-foreground mt-1">Start logging to see your loads here</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {loads.map(load => (
            <LoadCard key={load.id} load={load} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
