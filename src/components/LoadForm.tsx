import { useState } from 'react';
import { Load, LoadInsert } from '@/hooks/useLoads';
import { useUserSettings } from '@/hooks/useUserSettings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency } from '@/lib/loadUtils';
import { calculateEstimatedPay } from '@/lib/types';
import { MapPin, DollarSign, Route, Clock, X, FileText } from 'lucide-react';

interface LoadFormProps {
  onSubmit: (data: LoadInsert) => void;
  onCancel?: () => void;
  initialData?: Load;
  loading?: boolean;
}

export function LoadForm({ onSubmit, onCancel, initialData, loading }: LoadFormProps) {
  const { settings } = useUserSettings();

  const [form, setForm] = useState({
    load_date: initialData?.load_date || new Date().toISOString().split('T')[0],
    pickup_location: initialData?.pickup_location || '',
    dropoff_location: initialData?.dropoff_location || '',
    loaded_miles: initialData?.loaded_miles?.toString() || '',
    deadhead_miles: initialData?.deadhead_miles?.toString() || '',
    rate_per_mile: initialData?.rate_per_mile?.toString() || (settings?.default_rate_per_mile?.toString() ?? ''),
    wait_fee: initialData?.wait_fee?.toString() || '0',
    detention_fee: initialData?.detention_fee?.toString() || '0',
    other_fees: initialData?.other_fees?.toString() || (settings?.default_other_fees?.toString() ?? '0'),
    actual_pay_received: initialData?.actual_pay_received?.toString() || '',
    notes: initialData?.notes || '',
    status: initialData?.status || 'completed',
  });

  const estimated = calculateEstimatedPay(
    parseFloat(form.loaded_miles) || 0,
    parseFloat(form.rate_per_mile) || 0,
    parseFloat(form.wait_fee) || 0,
    parseFloat(form.detention_fee) || 0,
    parseFloat(form.other_fees) || 0
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      load_date: form.load_date,
      pickup_location: form.pickup_location.trim(),
      dropoff_location: form.dropoff_location.trim(),
      loaded_miles: parseFloat(form.loaded_miles) || 0,
      deadhead_miles: parseFloat(form.deadhead_miles) || 0,
      rate_per_mile: parseFloat(form.rate_per_mile) || 0,
      wait_fee: parseFloat(form.wait_fee) || 0,
      detention_fee: parseFloat(form.detention_fee) || 0,
      other_fees: parseFloat(form.other_fees) || 0,
      actual_pay_received: form.actual_pay_received ? parseFloat(form.actual_pay_received) : null,
      notes: form.notes.trim() || null,
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
              <Label htmlFor="load_date">Date</Label>
              <Input id="load_date" type="date" value={form.load_date} onChange={e => update('load_date', e.target.value)} required />
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
            <Label htmlFor="pickup_location" className="flex items-center gap-1">
              <MapPin className="h-3 w-3 text-success" /> Pickup
            </Label>
            <Input id="pickup_location" placeholder="Dallas, TX" value={form.pickup_location} onChange={e => update('pickup_location', e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="dropoff_location" className="flex items-center gap-1">
              <MapPin className="h-3 w-3 text-destructive" /> Drop-off
            </Label>
            <Input id="dropoff_location" placeholder="Atlanta, GA" value={form.dropoff_location} onChange={e => update('dropoff_location', e.target.value)} required />
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

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="wait_fee" className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Wait
              </Label>
              <Input id="wait_fee" type="number" step="0.01" min="0" placeholder="0" value={form.wait_fee} onChange={e => update('wait_fee', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="detention_fee" className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Detention
              </Label>
              <Input id="detention_fee" type="number" step="0.01" min="0" placeholder="0" value={form.detention_fee} onChange={e => update('detention_fee', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="other_fees" className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" /> Other
              </Label>
              <Input id="other_fees" type="number" step="0.01" min="0" placeholder="0" value={form.other_fees} onChange={e => update('other_fees', e.target.value)} />
            </div>
          </div>

          {/* Actual pay */}
          <div>
            <Label htmlFor="actual_pay_received" className="flex items-center gap-1">
              <DollarSign className="h-3 w-3 text-success" /> Actual Pay Received
            </Label>
            <Input id="actual_pay_received" type="number" step="0.01" min="0" placeholder="Leave blank if not yet paid" value={form.actual_pay_received} onChange={e => update('actual_pay_received', e.target.value)} />
          </div>

          {/* Notes */}
          <div>
            <Label htmlFor="notes" className="flex items-center gap-1">
              <FileText className="h-3 w-3" /> Notes
            </Label>
            <Textarea id="notes" placeholder="Optional notes..." rows={2} value={form.notes} onChange={e => update('notes', e.target.value)} />
          </div>

          {/* Pay preview */}
          <div className="rounded-lg bg-secondary p-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-secondary-foreground/60">Estimated</p>
                <p className="text-2xl font-black font-mono text-primary">{formatCurrency(estimated)}</p>
              </div>
              {form.actual_pay_received && (
                <div className="text-right">
                  <p className="text-xs text-secondary-foreground/60">Actual</p>
                  <p className={`text-2xl font-black font-mono ${parseFloat(form.actual_pay_received) >= estimated ? 'text-success' : 'text-destructive'}`}>
                    {formatCurrency(parseFloat(form.actual_pay_received) || 0)}
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
