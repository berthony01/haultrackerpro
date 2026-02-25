import { LoadStopInput } from '@/hooks/useLoadStops';
import { formatLocation } from '@/lib/loadUtils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, MapPin } from 'lucide-react';

interface MultiStopEditorProps {
  stops: LoadStopInput[];
  onChange: (stops: LoadStopInput[]) => void;
  errors?: Record<number, string>;
}

export function MultiStopEditor({ stops, onChange, errors = {} }: MultiStopEditorProps) {
  const addStop = () => {
    onChange([...stops, { stop_order: stops.length + 1, location: '', stop_type: 'Stop', detention_minutes: null }]);
  };

  const removeStop = (index: number) => {
    onChange(stops.filter((_, i) => i !== index));
  };

  const updateStop = (index: number, field: keyof LoadStopInput, value: any) => {
    const updated = stops.map((s, i) => i === index ? { ...s, [field]: value } : s);
    onChange(updated);
  };

  return (
    <div className="space-y-3 rounded-xl border border-primary/20 p-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-primary" /> Stops
        </p>
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1 text-primary" onClick={addStop}>
          <Plus className="h-3 w-3" /> Add Stop
        </Button>
      </div>

      {stops.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">No stops added yet. Tap "Add Stop" above.</p>
      )}

      {stops.map((stop, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1 space-y-2">
            <div className="flex gap-2">
              <div className="w-24 shrink-0">
                <Select value={stop.stop_type} onValueChange={v => updateStop(i, 'stop_type', v)}>
                  <SelectTrigger className="h-9 text-xs rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pickup">Pickup</SelectItem>
                    <SelectItem value="Stop">Stop</SelectItem>
                    <SelectItem value="Drop">Drop</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder="City, ST"
                value={stop.location}
                onChange={e => updateStop(i, 'location', e.target.value)}
                className="h-9 text-sm rounded-lg flex-1"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Det. min</Label>
              <Input
                type="number"
                min="0"
                placeholder="0"
                value={stop.detention_minutes ?? ''}
                onChange={e => updateStop(i, 'detention_minutes', e.target.value ? parseInt(e.target.value) : null)}
                className="h-7 text-xs rounded-lg w-20"
              />
            </div>
            {errors[i] && (
              <p className="text-xs text-destructive">{errors[i]}</p>
            )}
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-destructive hover:text-destructive" onClick={() => removeStop(i)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
