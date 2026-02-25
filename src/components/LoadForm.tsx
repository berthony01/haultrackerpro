import { useState, useMemo } from 'react';
import { Load, LoadInsert } from '@/hooks/useLoads';
import { LoadStopInput } from '@/hooks/useLoadStops';
import { useUserSettings } from '@/hooks/useUserSettings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency, formatLocation } from '@/lib/loadUtils';
import { calculateEstimatedPay } from '@/lib/types';
import { MapPin, DollarSign, Route, Clock, X, FileText, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { SmartChips } from '@/components/SmartChips';
import { MultiStopEditor } from '@/components/MultiStopEditor';

interface LoadFormProps {
  onSubmit: (data: LoadInsert, stops?: LoadStopInput[]) => void;
  onCancel?: () => void;
  initialData?: Load;
  initialStops?: LoadStopInput[];
  loading?: boolean;
  recentLoads?: Load[];
}

export function LoadForm({ onSubmit, onCancel, initialData, initialStops, loading, recentLoads = [] }: LoadFormProps) {
  const { settings } = useUserSettings();
  const lastLoad = recentLoads[0] ?? null;

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

  const [multiStop, setMultiStop] = useState((initialStops && initialStops.length > 0) || false);
  const [stops, setStops] = useState<LoadStopInput[]>(initialStops ?? []);
  const [stopErrors, setStopErrors] = useState<Record<number, string>>({});
  const [saveAsPending, setSaveAsPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isCancelled = (saveAsPending ? 'pending' : form.status) === 'cancelled';

  const estimated = useMemo(() => {
    if (isCancelled) return 0;
    return calculateEstimatedPay(
      parseFloat(form.loaded_miles) || 0,
      parseFloat(form.rate_per_mile) || 0,
      parseFloat(form.wait_fee) || 0,
      parseFloat(form.detention_fee) || 0,
      parseFloat(form.other_fees) || 0
    );
  }, [form.loaded_miles, form.rate_per_mile, form.wait_fee, form.detention_fee, form.other_fees, isCancelled]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.load_date) errs.load_date = 'Date is required';
    if (!form.pickup_location.trim()) errs.pickup_location = 'Pickup is required';
    if (!form.dropoff_location.trim()) errs.dropoff_location = 'Drop-off is required';

    const loadedMiles = parseFloat(form.loaded_miles);
    if (isNaN(loadedMiles) || loadedMiles < 0) errs.loaded_miles = 'Must be 0 or positive';
    const deadheadMiles = parseFloat(form.deadhead_miles);
    if (form.deadhead_miles && (isNaN(deadheadMiles) || deadheadMiles < 0)) errs.deadhead_miles = 'Must be 0 or positive';
    const rpm = parseFloat(form.rate_per_mile);
    if (isNaN(rpm) || rpm < 0) errs.rate_per_mile = 'Must be 0 or positive';
    if (form.wait_fee && parseFloat(form.wait_fee) < 0) errs.wait_fee = 'Cannot be negative';
    if (form.detention_fee && parseFloat(form.detention_fee) < 0) errs.detention_fee = 'Cannot be negative';
    if (form.other_fees && parseFloat(form.other_fees) < 0) errs.other_fees = 'Cannot be negative';
    if (form.actual_pay_received && parseFloat(form.actual_pay_received) < 0) errs.actual_pay_received = 'Cannot be negative';

    // Validate stops
    const sErrs: Record<number, string> = {};
    if (multiStop) {
      stops.forEach((s, i) => {
        if (!s.location.trim()) sErrs[i] = 'Location is required';
        if (s.detention_minutes != null && s.detention_minutes < 0) sErrs[i] = 'Detention cannot be negative';
      });
    }

    setErrors(errs);
    setStopErrors(sErrs);
    if (Object.keys(errs).length > 0 || Object.keys(sErrs).length > 0) {
      toast.error('Please fix the errors before submitting');
      return false;
    }
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const finalStatus = saveAsPending ? 'pending' : form.status;

    // Format stop locations
    const formattedStops = multiStop ? stops.map((s, i) => ({
      ...s,
      stop_order: i + 1,
      location: formatLocation(s.location),
    })) : [];

    onSubmit({
      load_date: form.load_date,
      pickup_location: formatLocation(form.pickup_location),
      dropoff_location: formatLocation(form.dropoff_location),
      loaded_miles: parseFloat(form.loaded_miles) || 0,
      deadhead_miles: parseFloat(form.deadhead_miles) || 0,
      rate_per_mile: parseFloat(form.rate_per_mile) || 0,
      wait_fee: parseFloat(form.wait_fee) || 0,
      detention_fee: parseFloat(form.detention_fee) || 0,
      other_fees: parseFloat(form.other_fees) || 0,
      actual_pay_received: form.actual_pay_received ? parseFloat(form.actual_pay_received) : null,
      notes: form.notes.trim() || null,
      status: finalStatus,
    }, formattedStops);
  };

  const update = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const handleUseDefaultRate = () => {
    if (settings?.default_rate_per_mile != null) {
      update('rate_per_mile', settings.default_rate_per_mile.toString());
      toast.success('Default rate applied');
    }
  };

  const handleUseLastRate = () => {
    if (lastLoad) {
      update('rate_per_mile', lastLoad.rate_per_mile.toString());
      toast.success('Last rate applied');
    }
  };

  const handleCopyLastLoad = () => {
    if (!lastLoad) return;
    setForm({
      load_date: new Date().toISOString().split('T')[0],
      pickup_location: lastLoad.pickup_location,
      dropoff_location: lastLoad.dropoff_location,
      loaded_miles: lastLoad.loaded_miles.toString(),
      deadhead_miles: lastLoad.deadhead_miles.toString(),
      rate_per_mile: lastLoad.rate_per_mile.toString(),
      wait_fee: lastLoad.wait_fee.toString(),
      detention_fee: lastLoad.detention_fee.toString(),
      other_fees: lastLoad.other_fees.toString(),
      actual_pay_received: '',
      notes: lastLoad.notes || '',
      status: 'pending',
    });
    setSaveAsPending(true);
    toast.success('Last load copied');
  };

  const FieldError = ({ field }: { field: string }) =>
    errors[field] ? (
      <p className="text-xs text-destructive flex items-center gap-1 mt-0.5">
        <AlertCircle className="h-3 w-3" /> {errors[field]}
      </p>
    ) : null;

  const numericProps = {
    inputMode: 'decimal' as const,
    pattern: '[0-9]*\\.?[0-9]*',
    min: '0',
  };

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
          {/* Quick Default Chips */}
          {!initialData && (
            <SmartChips
              settings={settings}
              lastLoad={lastLoad}
              recentLoads={recentLoads}
              onUseDefaultRate={handleUseDefaultRate}
              onUseLastRate={handleUseLastRate}
              onCopyLastLoad={handleCopyLastLoad}
              onApplyLane={(pickup, dropoff) => {
                update('pickup_location', pickup);
                update('dropoff_location', dropoff);
                toast.success('Common lane applied');
              }}
              onApplyRate={(rate) => {
                update('rate_per_mile', rate.toString());
                toast.success('Common rate applied');
              }}
            />
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="load_date">Date</Label>
              <Input id="load_date" type="date" value={form.load_date} onChange={e => update('load_date', e.target.value)} required />
              <FieldError field="load_date" />
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select value={form.status} onValueChange={v => { update('status', v); if (v === 'cancelled' && !form.notes) update('notes', 'Cancelled by dispatcher'); }}>
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
            <FieldError field="pickup_location" />
          </div>
          <div>
            <Label htmlFor="dropoff_location" className="flex items-center gap-1">
              <MapPin className="h-3 w-3 text-destructive" /> Drop-off
            </Label>
            <Input id="dropoff_location" placeholder="Atlanta, GA" value={form.dropoff_location} onChange={e => update('dropoff_location', e.target.value)} required />
            <FieldError field="dropoff_location" />
          </div>

          {/* Multi-stop toggle */}
          <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
            <div>
              <p className="text-sm font-medium">Multi-stop load?</p>
              <p className="text-xs text-muted-foreground">Add intermediate stops</p>
            </div>
            <Switch checked={multiStop} onCheckedChange={setMultiStop} />
          </div>

          {multiStop && (
            <MultiStopEditor stops={stops} onChange={setStops} errors={stopErrors} />
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="loaded_miles">Loaded Miles</Label>
              <Input id="loaded_miles" type="number" step="0.1" {...numericProps} placeholder="0" value={form.loaded_miles} onChange={e => update('loaded_miles', e.target.value)} required />
              <FieldError field="loaded_miles" />
            </div>
            <div>
              <Label htmlFor="deadhead_miles">Deadhead Miles</Label>
              <Input id="deadhead_miles" type="number" step="0.1" {...numericProps} placeholder="0" value={form.deadhead_miles} onChange={e => update('deadhead_miles', e.target.value)} />
              <FieldError field="deadhead_miles" />
            </div>
          </div>

          <div>
            <Label htmlFor="rate_per_mile" className="flex items-center gap-1">
              <DollarSign className="h-3 w-3 text-primary" /> Rate Per Mile
            </Label>
            <Input id="rate_per_mile" type="number" step="0.01" {...numericProps} placeholder="0.00" value={form.rate_per_mile} onChange={e => update('rate_per_mile', e.target.value)} required />
            <FieldError field="rate_per_mile" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="wait_fee" className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Wait Fee
              </Label>
              <Input id="wait_fee" type="number" step="0.01" {...numericProps} placeholder="0" value={form.wait_fee} onChange={e => update('wait_fee', e.target.value)} />
              <FieldError field="wait_fee" />
            </div>
            <div>
              <Label htmlFor="detention_fee" className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Detention
              </Label>
              <Input id="detention_fee" type="number" step="0.01" {...numericProps} placeholder="0" value={form.detention_fee} onChange={e => update('detention_fee', e.target.value)} />
              <FieldError field="detention_fee" />
            </div>
            <div>
              <Label htmlFor="other_fees" className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" /> Other Fees
              </Label>
              <Input id="other_fees" type="number" step="0.01" {...numericProps} placeholder="0" value={form.other_fees} onChange={e => update('other_fees', e.target.value)} />
              <FieldError field="other_fees" />
            </div>
          </div>

          {/* Actual pay */}
          <div>
            <Label htmlFor="actual_pay_received" className="flex items-center gap-1">
              <DollarSign className="h-3 w-3 text-success" /> Actual Pay Received
            </Label>
            <Input id="actual_pay_received" type="number" step="0.01" {...numericProps} placeholder="Leave blank if not yet paid" value={form.actual_pay_received} onChange={e => update('actual_pay_received', e.target.value)} />
            <FieldError field="actual_pay_received" />
          </div>

          {/* Notes */}
          <div>
            <Label htmlFor="notes" className="flex items-center gap-1">
              <FileText className="h-3 w-3" /> Notes
            </Label>
            <Textarea id="notes" placeholder="Optional notes..." rows={2} value={form.notes} onChange={e => update('notes', e.target.value)} />
          </div>

          {/* Save as Pending toggle */}
          {!initialData && form.status !== 'pending' && (
            <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
              <div>
                <p className="text-sm font-medium">Save as Pending</p>
                <p className="text-xs text-muted-foreground">I will finalize later</p>
              </div>
              <Switch checked={saveAsPending} onCheckedChange={setSaveAsPending} />
            </div>
          )}

          {/* Live pay calculation */}
          <div className={`rounded-lg p-4 ${isCancelled ? 'bg-destructive/10' : 'bg-secondary'}`}>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-muted-foreground">Estimated Pay</p>
                <p className={`text-2xl font-black font-mono ${isCancelled ? 'text-destructive' : 'text-primary'}`}>
                  {formatCurrency(estimated)}
                </p>
                {isCancelled && <p className="text-xs text-destructive mt-0.5">Cancelled — pay set to $0</p>}
              </div>
              {form.actual_pay_received && !isCancelled && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Actual</p>
                  <p className={`text-2xl font-black font-mono ${parseFloat(form.actual_pay_received) >= estimated ? 'text-success' : 'text-destructive'}`}>
                    {formatCurrency(parseFloat(form.actual_pay_received) || 0)}
                  </p>
                </div>
              )}
            </div>
          </div>

          <Button type="submit" className="w-full h-12 text-base font-bold" disabled={loading}>
            {loading ? 'Saving...' : initialData ? 'Update Load' : saveAsPending ? 'Save as Pending' : 'Log Load'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
