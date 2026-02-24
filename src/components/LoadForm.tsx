import { useState } from 'react';
import { Load } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/loadUtils';
import { calculateTotalPay } from '@/lib/types';
import { MapPin, DollarSign, Route, Clock, X } from 'lucide-react';

interface LoadFormProps {
  onSubmit: (data: Omit<Load, 'id' | 'totalPay' | 'createdAt'>) => void;
  onCancel?: () => void;
  initialData?: Load;
}

export function LoadForm({ onSubmit, onCancel, initialData }: LoadFormProps) {
  const [form, setForm] = useState({
    date: initialData?.date || new Date().toISOString().split('T')[0],
    pickup: initialData?.pickup || '',
    dropoff: initialData?.dropoff || '',
    loadedMiles: initialData?.loadedMiles?.toString() || '',
    deadheadMiles: initialData?.deadheadMiles?.toString() || '',
    ratePerMile: initialData?.ratePerMile?.toString() || '',
    waitFee: initialData?.waitFee?.toString() || '0',
    detentionFee: initialData?.detentionFee?.toString() || '0',
  });

  const preview = calculateTotalPay({
    date: form.date,
    pickup: form.pickup,
    dropoff: form.dropoff,
    loadedMiles: parseFloat(form.loadedMiles) || 0,
    deadheadMiles: parseFloat(form.deadheadMiles) || 0,
    ratePerMile: parseFloat(form.ratePerMile) || 0,
    waitFee: parseFloat(form.waitFee) || 0,
    detentionFee: parseFloat(form.detentionFee) || 0,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      date: form.date,
      pickup: form.pickup.trim(),
      dropoff: form.dropoff.trim(),
      loadedMiles: parseFloat(form.loadedMiles) || 0,
      deadheadMiles: parseFloat(form.deadheadMiles) || 0,
      ratePerMile: parseFloat(form.ratePerMile) || 0,
      waitFee: parseFloat(form.waitFee) || 0,
      detentionFee: parseFloat(form.detentionFee) || 0,
    });
  };

  const update = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <Card className="border-2 border-primary/20 shadow-lg">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl font-heading flex items-center gap-2">
            <Route className="h-5 w-5 text-primary" />
            {initialData ? 'Edit Load' : 'Log New Load'}
          </CardTitle>
          {onCancel && (
            <Button variant="ghost" size="icon" onClick={onCancel}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" value={form.date} onChange={e => update('date', e.target.value)} required />
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <Label htmlFor="pickup" className="flex items-center gap-1">
                <MapPin className="h-3 w-3 text-success" /> Pickup Location
              </Label>
              <Input id="pickup" placeholder="e.g. Dallas, TX" value={form.pickup} onChange={e => update('pickup', e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="dropoff" className="flex items-center gap-1">
                <MapPin className="h-3 w-3 text-destructive" /> Drop-off Location
              </Label>
              <Input id="dropoff" placeholder="e.g. Atlanta, GA" value={form.dropoff} onChange={e => update('dropoff', e.target.value)} required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="loadedMiles">Loaded Miles</Label>
              <Input id="loadedMiles" type="number" step="0.1" min="0" placeholder="0" value={form.loadedMiles} onChange={e => update('loadedMiles', e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="deadheadMiles">Deadhead Miles</Label>
              <Input id="deadheadMiles" type="number" step="0.1" min="0" placeholder="0" value={form.deadheadMiles} onChange={e => update('deadheadMiles', e.target.value)} />
            </div>
          </div>

          <div>
            <Label htmlFor="ratePerMile" className="flex items-center gap-1">
              <DollarSign className="h-3 w-3 text-primary" /> Rate Per Mile
            </Label>
            <Input id="ratePerMile" type="number" step="0.01" min="0" placeholder="0.00" value={form.ratePerMile} onChange={e => update('ratePerMile', e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="waitFee" className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Wait Fee
              </Label>
              <Input id="waitFee" type="number" step="0.01" min="0" placeholder="0.00" value={form.waitFee} onChange={e => update('waitFee', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="detentionFee" className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Detention Fee
              </Label>
              <Input id="detentionFee" type="number" step="0.01" min="0" placeholder="0.00" value={form.detentionFee} onChange={e => update('detentionFee', e.target.value)} />
            </div>
          </div>

          {/* Live pay preview */}
          <div className="rounded-lg bg-secondary p-4 text-center">
            <p className="text-sm text-secondary-foreground/70">Estimated Pay</p>
            <p className="text-3xl font-black font-mono text-primary animate-count-up">
              {formatCurrency(preview)}
            </p>
          </div>

          <Button type="submit" className="w-full h-12 text-base font-bold">
            {initialData ? 'Update Load' : 'Log Load'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
