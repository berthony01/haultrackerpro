import { useState } from 'react';
import { Load, LoadInsert } from '@/hooks/useLoads';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency } from '@/lib/loadUtils';
import { calculateEstimatedPay } from '@/lib/types';
import { MapPin, DollarSign, Route, Clock, X } from 'lucide-react';

interface LoadFormProps {
  onSubmit: (data: LoadInsert) => void;
  onCancel?: () => void;
  initialData?: Load;
  loading?: boolean;
}

export function LoadForm({ onSubmit, onCancel, initialData, loading }: LoadFormProps) {
  const [form, setForm] = useState({
    date: initialData?.date || new Date().toISOString().split('T')[0],
    pickup: initialData?.pickup || '',
    dropoff: initialData?.dropoff || '',
    loaded_miles: initialData?.loaded_miles?.toString() || '',
    deadhead_miles: initialData?.deadhead_miles?.toString() || '',
    rate_per_mile: initialData?.rate_per_mile?.toString() || '',
    wait_fee: initialData?.wait_fee?.toString() || '0',
    detention_fee: initialData?.detention_fee?.toString() || '0',
    actual_pay: initialData?.actual_pay?.toString() || '',
    status: initialData?.status || 'completed',
  });

  const estimated = calculateEstimatedPay(
    parseFloat(form.loaded_miles) || 0,
    parseFloat(form.rate_per_mile) || 0,
    parseFloat(form.wait_fee) || 0,
    parseFloat(form.detention_fee) || 0
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      date: form.date,
      pickup: form.pickup.trim(),
      dropoff: form.dropoff.trim(),
      loaded_miles: parseFloat(form.loaded_miles) || 0,
      deadhead_miles: parseFloat(form.deadhead_miles) || 0,
      rate_per_mile: parseFloat(form.rate_per_mile) || 0,
      wait_fee: parseFloat(form.wait_fee) || 0,
      detention_fee: parseFloat(form.detention_fee) || 0,
      actual_pay: form.actual_pay ? parseFloat(form.actual_pay) : null,
      status: form.status,
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" value={form.date} onChange={e => update('date', e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select value={form.status} onValueChange={v => update('status', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="pickup" className="flex items-center gap-1">
              <MapPin className="h-3 w-3 text-success" /> Pickup
            </Label>
            <Input id="pickup" placeholder="Dallas, TX" value={form.pickup} onChange={e => update('pickup', e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="dropoff" className="flex items-center gap-1">
              <MapPin className="h-3 w-3 text-destructive" /> Drop-off
            </Label>
            <Input id="dropoff" placeholder="Atlanta, GA" value={form.dropoff} onChange={e => update('dropoff', e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="loaded_miles">Loaded Miles</Label>
              <Input id="loaded_miles" type="number" step="0.1" min="0" placeholder="0" value={form.loaded_miles} onChange={e => update('loaded_miles', e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="deadhead_miles">Deadhead Miles</Label>
              <Input id="deadhead_miles" type="number" step="0.1" min="0" placeholder="0" value={form.deadhead_miles} onChange={e => update('deadhead_miles', e.target.value)} />
            </div>
          </div>

          <div>
            <Label htmlFor="rate_per_mile" className="flex items-center gap-1">
              <DollarSign className="h-3 w-3 text-primary" /> Rate Per Mile
            </Label>
            <Input id="rate_per_mile" type="number" step="0.01" min="0" placeholder="0.00" value={form.rate_per_mile} onChange={e => update('rate_per_mile', e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="wait_fee" className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Wait Fee
              </Label>
              <Input id="wait_fee" type="number" step="0.01" min="0" placeholder="0.00" value={form.wait_fee} onChange={e => update('wait_fee', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="detention_fee" className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Detention Fee
              </Label>
              <Input id="detention_fee" type="number" step="0.01" min="0" placeholder="0.00" value={form.detention_fee} onChange={e => update('detention_fee', e.target.value)} />
            </div>
          </div>

          {/* Actual pay */}
          <div>
            <Label htmlFor="actual_pay" className="flex items-center gap-1">
              <DollarSign className="h-3 w-3 text-success" /> Actual Pay Received
            </Label>
            <Input id="actual_pay" type="number" step="0.01" min="0" placeholder="Leave blank if not yet paid" value={form.actual_pay} onChange={e => update('actual_pay', e.target.value)} />
          </div>

          {/* Pay preview */}
          <div className="rounded-lg bg-secondary p-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-secondary-foreground/60">Estimated</p>
                <p className="text-2xl font-black font-mono text-primary">{formatCurrency(estimated)}</p>
              </div>
              {form.actual_pay && (
                <div className="text-right">
                  <p className="text-xs text-secondary-foreground/60">Actual</p>
                  <p className={`text-2xl font-black font-mono ${parseFloat(form.actual_pay) >= estimated ? 'text-success' : 'text-destructive'}`}>
                    {formatCurrency(parseFloat(form.actual_pay) || 0)}
                  </p>
                </div>
              )}
            </div>
          </div>

          <Button type="submit" className="w-full h-12 text-base font-bold" disabled={loading}>
            {loading ? 'Saving...' : initialData ? 'Update Load' : 'Log Load'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
