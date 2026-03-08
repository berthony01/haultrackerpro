import { useState } from 'react';
import { FuelLogInsert, FuelLog } from '@/hooks/useFuelLogs';
import { Load } from '@/hooks/useLoads';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Fuel, DollarSign, Gauge, Calendar, MapPin, FileText, ArrowLeft, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

interface FuelLogFormProps {
  onSubmit: (data: FuelLogInsert) => void;
  onCancel: () => void;
  loading?: boolean;
  loads?: Load[];
  initialData?: FuelLog | null;
}

export function FuelLogForm({ onSubmit, onCancel, loading, loads = [], initialData }: FuelLogFormProps) {
  const [date, setDate] = useState(initialData?.date ?? format(new Date(), 'yyyy-MM-dd'));
  const [station, setStation] = useState(initialData?.station ?? '');
  const [gallons, setGallons] = useState(initialData?.gallons?.toString() ?? '');
  const [pricePerGallon, setPricePerGallon] = useState(initialData?.price_per_gallon?.toString() ?? '');
  const [odometer, setOdometer] = useState(initialData?.odometer?.toString() ?? '');
  const [linkedLoadId, setLinkedLoadId] = useState(initialData?.linked_load_id ?? '');
  const [notes, setNotes] = useState(initialData?.notes ?? '');

  // Auto-calculate total cost
  const totalCost = (parseFloat(gallons) || 0) * (parseFloat(pricePerGallon) || 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gallons || !pricePerGallon) return;
    
    onSubmit({
      date,
      station: station.trim() || null,
      gallons: parseFloat(gallons),
      price_per_gallon: parseFloat(pricePerGallon),
      total_cost: totalCost,
      odometer: odometer ? parseFloat(odometer) : null,
      linked_load_id: linkedLoadId || null,
      notes: notes.trim() || null,
    });
  };

  // Recent loads for linking
  const recentLoads = loads.slice(0, 10);

  return (
    <form onSubmit={handleSubmit} className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-3 mb-2">
        <Button type="button" variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={onCancel}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h2 className="text-xl font-black font-heading">{initialData ? 'Edit Fuel Log' : 'Log Fuel Purchase'}</h2>
          <p className="text-sm text-muted-foreground">Track your fuel costs</p>
        </div>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-4 space-y-4">
          {/* Date */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" /> Date
            </Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 rounded-xl"
              required
            />
          </div>

          {/* Station */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" /> Fuel Station
            </Label>
            <Input
              placeholder="e.g., Pilot Travel Center"
              value={station}
              onChange={(e) => setStation(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>

          {/* Gallons + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Fuel className="h-3.5 w-3.5 text-muted-foreground" /> Gallons
              </Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                placeholder="0.000"
                value={gallons}
                onChange={(e) => setGallons(e.target.value)}
                className="h-11 rounded-xl"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" /> Price/Gallon
              </Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="0.000"
                  value={pricePerGallon}
                  onChange={(e) => setPricePerGallon(e.target.value)}
                  className="h-11 pl-9 rounded-xl"
                  required
                />
              </div>
            </div>
          </div>

          {/* Total Cost (calculated) */}
          <div className="p-3 rounded-xl bg-primary/5 border border-primary/20">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Total Cost</span>
              <span className="text-xl font-black font-mono text-primary">
                ${totalCost.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Odometer */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5 text-muted-foreground" /> Odometer (optional)
            </Label>
            <Input
              type="number"
              step="1"
              min="0"
              placeholder="Current mileage"
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>

          {/* Link to Load */}
          {recentLoads.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Link to Load (optional)</Label>
              <Select value={linkedLoadId || 'none'} onValueChange={(v) => setLinkedLoadId(v === 'none' ? '' : v)}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue placeholder="Select a load" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No link</SelectItem>
                  {recentLoads.map((load) => (
                    <SelectItem key={load.id} value={load.id}>
                      {format(new Date(load.load_date), 'MMM d')} — {load.pickup_location.split(',')[0]} → {load.dropoff_location.split(',')[0]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" /> Notes (optional)
            </Label>
            <Textarea
              placeholder="Any additional notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[80px] rounded-xl resize-none"
            />
          </div>
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex gap-3">
        <Button type="button" variant="outline" className="flex-1 h-12 rounded-xl font-bold" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1 h-12 rounded-xl font-bold gap-2" disabled={loading || !gallons || !pricePerGallon}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fuel className="h-4 w-4" />}
          {initialData ? 'Update' : 'Save Fuel Log'}
        </Button>
      </div>
    </form>
  );
}
