import { useState, useMemo, useEffect } from 'react';
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
import { DateInput } from '@/components/ui/date-input';
import { calculateEstimatedPay } from '@/lib/types';
import { MapPin, DollarSign, Route, Clock, X, FileText, AlertCircle, Info, Camera, Crown, Receipt, ChevronDown } from 'lucide-react';
import { PayModel, PAY_MODEL_LABELS, PAY_MODEL_DESCRIPTIONS, PAY_MODEL_VALUES, isPayModel, resolvePayModel } from '@/lib/payModels';
import { computeLoadPay } from '@/lib/computeLoadPay';
import { toast } from 'sonner';
import { SmartChips } from '@/components/SmartChips';
import { MultiStopEditor } from '@/components/MultiStopEditor';
import { PasteLoadParser } from '@/components/PasteLoadParser';
import { ScanLoadModal } from '@/components/ScanLoadModal';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ParsedLoadData } from '@/lib/parseLoadText';
import { useProfitCheck } from '@/hooks/useProfitCheck';
import { ProfitCheckCard } from '@/components/ProfitCheckCard';

/**
 * Deadhead pay status persisted inside the load `notes` field as a structured tag
 * (no DB migration). Format: `[dh_pay:unpaid]` or `[dh_pay:same]` or `[dh_pay:custom:0.85]`.
 */
type DhPayStatus = 'unpaid' | 'same' | 'custom';
const DH_TAG_RE = /\s*\[dh_pay:(unpaid|same|custom)(?::([\d.]+))?\]\s*/i;

function readDhFromNotes(notes: string | null | undefined): { status: DhPayStatus; rate: string; cleanNotes: string } {
  if (!notes) return { status: 'unpaid', rate: '', cleanNotes: '' };
  const m = notes.match(DH_TAG_RE);
  if (!m) return { status: 'unpaid', rate: '', cleanNotes: notes };
  return {
    status: m[1].toLowerCase() as DhPayStatus,
    rate: m[2] ?? '',
    cleanNotes: notes.replace(DH_TAG_RE, ' ').trim(),
  };
}

function writeDhToNotes(cleanNotes: string, status: DhPayStatus, rate: string): string | null {
  const tag =
    status === 'custom' && rate ? `[dh_pay:custom:${rate}]`
    : status === 'same' ? `[dh_pay:same]`
    : status === 'unpaid' ? `[dh_pay:unpaid]`
    : '';
  const base = (cleanNotes || '').trim();
  if (!tag) return base || null;
  // Default 'unpaid' with no notes → keep notes null to avoid noise.
  if (status === 'unpaid' && !base) return null;
  return `${base}${base ? ' ' : ''}${tag}`.trim();
}

interface LoadFormProps {
  onSubmit: (data: LoadInsert, stops?: LoadStopInput[]) => void;
  onCancel?: () => void;
  initialData?: Load;
  initialStops?: LoadStopInput[];
  loading?: boolean;
  recentLoads?: Load[];
  isPro?: boolean;
  /** Pre-fill the form with a sample load for first-time users with zero loads logged. */
  firstTimeUser?: boolean;
}

const SAMPLE_LOAD = {
  pickup_location: 'Atlanta, GA',
  dropoff_location: 'Miami, FL',
  loaded_miles: '650',
  deadhead_miles: '50',
  rate_per_mile: '2.50',
};

export function LoadForm({ onSubmit, onCancel, initialData, initialStops, loading, recentLoads = [], isPro = false, firstTimeUser = false }: LoadFormProps) {
  const { settings } = useUserSettings();
  const lastLoad = recentLoads[0] ?? null;

  const isPercentagePay = settings?.pay_type === 'percentage';
  const useSample = firstTimeUser && !initialData;

  // Parse DH-pay tag out of existing notes (edit mode); defaults for new loads.
  const initialDh = useMemo(() => readDhFromNotes(initialData?.notes ?? null), [initialData?.notes]);

  const [form, setForm] = useState({
    load_date: initialData?.load_date || new Date().toISOString().split('T')[0],
    dropoff_date: initialData?.dropoff_date || '',
    pickup_location: initialData?.pickup_location || (useSample ? SAMPLE_LOAD.pickup_location : ''),
    dropoff_location: initialData?.dropoff_location || (useSample ? SAMPLE_LOAD.dropoff_location : ''),
    loaded_miles: initialData?.loaded_miles?.toString() || (useSample ? SAMPLE_LOAD.loaded_miles : ''),
    deadhead_miles: initialData?.deadhead_miles?.toString() || (useSample ? SAMPLE_LOAD.deadhead_miles : ''),
    rate_per_mile: initialData?.rate_per_mile?.toString() || (settings?.default_rate_per_mile?.toString() ?? (useSample ? SAMPLE_LOAD.rate_per_mile : '')),
    wait_fee: initialData?.wait_fee?.toString() || '0',
    detention_fee: initialData?.detention_fee?.toString() || '0',
    other_fees: initialData?.other_fees?.toString() || (settings?.default_other_fees?.toString() ?? '0'),
    actual_pay_received: initialData?.actual_pay_received?.toString() || '',
    notes: initialDh.cleanNotes,
    status: initialData?.status || 'completed',
    gross_revenue: initialData?.gross_revenue?.toString() || '',
    invoice_submitted_date: initialData?.invoice_submitted_date || '',
    pod_submitted_date: initialData?.pod_submitted_date || '',
    payment_due_date: initialData?.payment_due_date || '',
    paid_date: initialData?.paid_date || '',
    short_paid_amount: initialData?.short_paid_amount?.toString() || '',
    payment_status: initialData?.payment_status || 'unpaid',
    payment_notes: initialData?.payment_notes || '',
    dh_pay_status: (initialData ? initialDh.status : ((settings as any)?.default_dh_pay_status as DhPayStatus | undefined) ?? initialDh.status) as DhPayStatus,
    dh_pay_rate: initialData ? initialDh.rate : ((settings as any)?.default_dh_pay_rate?.toString() ?? initialDh.rate),
  });
  const [showPaymentTracking, setShowPaymentTracking] = useState(
    !!(initialData?.invoice_submitted_date || initialData?.pod_submitted_date || initialData?.payment_due_date || initialData?.paid_date || (initialData?.short_paid_amount && Number(initialData.short_paid_amount) > 0) || initialData?.payment_notes)
  );

  // Last parser detection summary (Phase 6) — shown briefly above the form fields after a paste.
  const [parserDetected, setParserDetected] = useState<{
    loaded_miles?: string;
    deadhead_miles?: string;
    trip_id?: string;
  } | null>(null);

  // Sync default settings when they load asynchronously (only for new loads)
  useEffect(() => {
    if (!initialData && settings) {
      const sDh = (settings as any).default_dh_pay_status as DhPayStatus | undefined;
      const sDhRate = (settings as any).default_dh_pay_rate?.toString() ?? '';
      setForm(prev => ({
        ...prev,
        rate_per_mile: prev.rate_per_mile || (settings.default_rate_per_mile?.toString() ?? ''),
        other_fees: prev.other_fees === '0' || prev.other_fees === '' ? (settings.default_other_fees?.toString() ?? '0') : prev.other_fees,
        // Only apply DH defaults if user hasn't already touched them this session
        dh_pay_status: prev.dh_pay_status === 'unpaid' && !prev.dh_pay_rate && sDh ? sDh : prev.dh_pay_status,
        dh_pay_rate: prev.dh_pay_rate || sDhRate,
      }));
    }
  }, [settings, initialData]);

  const [multiStop, setMultiStop] = useState((initialStops && initialStops.length > 0) || false);
  const [stops, setStops] = useState<LoadStopInput[]>(initialStops ?? []);
  const [stopErrors, setStopErrors] = useState<Record<number, string>>({});
  const [saveAsPending, setSaveAsPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showScanLoad, setShowScanLoad] = useState(false);
  const [showScanUpgrade, setShowScanUpgrade] = useState(false);
  const [multiStopBanner, setMultiStopBanner] = useState<string | null>(null);

  const isCancelled = (saveAsPending ? 'pending' : form.status) === 'cancelled';

  // Deadhead revenue layer (Phase 5).
  // Skipped for percentage pay (gross already includes everything).
  const deadheadRevenue = useMemo(() => {
    if (isCancelled || isPercentagePay) return 0;
    const dhMiles = parseFloat(form.deadhead_miles) || 0;
    if (dhMiles <= 0) return 0;
    if (form.dh_pay_status === 'same') {
      return dhMiles * (parseFloat(form.rate_per_mile) || 0);
    }
    if (form.dh_pay_status === 'custom') {
      return dhMiles * (parseFloat(form.dh_pay_rate) || 0);
    }
    return 0; // unpaid
  }, [form.deadhead_miles, form.rate_per_mile, form.dh_pay_status, form.dh_pay_rate, isCancelled, isPercentagePay]);

  const estimated = useMemo(() => {
    if (isCancelled) return 0;
    // Percentage-based pay calculation
    if (isPercentagePay && form.gross_revenue && settings?.pay_percentage) {
      const grossRev = parseFloat(form.gross_revenue) || 0;
      const pct = Number(settings.pay_percentage) / 100;
      return grossRev * pct + (parseFloat(form.wait_fee) || 0) + (parseFloat(form.detention_fee) || 0) + (parseFloat(form.other_fees) || 0);
    }
    // CPM-based pay calculation (default) + paid deadhead layer
    return calculateEstimatedPay(
      parseFloat(form.loaded_miles) || 0,
      parseFloat(form.rate_per_mile) || 0,
      parseFloat(form.wait_fee) || 0,
      parseFloat(form.detention_fee) || 0,
      parseFloat(form.other_fees) || 0
    ) + deadheadRevenue;
  }, [form.loaded_miles, form.rate_per_mile, form.wait_fee, form.detention_fee, form.other_fees, form.gross_revenue, isCancelled, isPercentagePay, settings?.pay_percentage, deadheadRevenue]);

  // Phase 3: Pre-load profit check (deterministic, personal-history based)
  const profitCheckInput = useMemo(() => {
    if (isCancelled) return null;
    const loaded = parseFloat(form.loaded_miles) || 0;
    const deadhead = parseFloat(form.deadhead_miles) || 0;
    if (loaded <= 0 || estimated <= 0) return null;
    if (!form.pickup_location.trim() || !form.dropoff_location.trim()) return null;
    return {
      pickup_location: formatLocation(form.pickup_location),
      dropoff_location: formatLocation(form.dropoff_location),
      loaded_miles: loaded,
      deadhead_miles: deadhead,
      estimated_pay: estimated,
      broker_id: initialData?.broker_id ?? null,
    };
  }, [form.loaded_miles, form.deadhead_miles, form.pickup_location, form.dropoff_location, estimated, isCancelled, initialData?.broker_id]);

  const { result: profitCheck } = useProfitCheck(profitCheckInput);

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
      dropoff_date: form.dropoff_date || form.load_date,
      pickup_location: formatLocation(form.pickup_location),
      dropoff_location: formatLocation(form.dropoff_location),
      loaded_miles: parseFloat(form.loaded_miles) || 0,
      deadhead_miles: parseFloat(form.deadhead_miles) || 0,
      rate_per_mile: parseFloat(form.rate_per_mile) || 0,
      wait_fee: parseFloat(form.wait_fee) || 0,
      detention_fee: parseFloat(form.detention_fee) || 0,
      other_fees: parseFloat(form.other_fees) || 0,
      actual_pay_received: form.actual_pay_received ? parseFloat(form.actual_pay_received) : null,
      notes: writeDhToNotes(form.notes.trim(), form.dh_pay_status, form.dh_pay_rate),
      status: finalStatus,
      gross_revenue: form.gross_revenue ? parseFloat(form.gross_revenue) : null,
      invoice_submitted_date: form.invoice_submitted_date || null,
      pod_submitted_date: form.pod_submitted_date || null,
      payment_due_date: form.payment_due_date || null,
      paid_date: form.paid_date || null,
      short_paid_amount: form.short_paid_amount ? parseFloat(form.short_paid_amount) : null,
      payment_status: form.payment_status,
      payment_notes: form.payment_notes.trim() || null,
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
    const lastDh = readDhFromNotes(lastLoad.notes ?? null);
    setForm({
      load_date: new Date().toISOString().split('T')[0],
      dropoff_date: '',
      pickup_location: lastLoad.pickup_location,
      dropoff_location: lastLoad.dropoff_location,
      loaded_miles: lastLoad.loaded_miles.toString(),
      deadhead_miles: lastLoad.deadhead_miles.toString(),
      rate_per_mile: lastLoad.rate_per_mile.toString(),
      wait_fee: lastLoad.wait_fee.toString(),
      detention_fee: lastLoad.detention_fee.toString(),
      other_fees: lastLoad.other_fees.toString(),
      actual_pay_received: '',
      notes: lastDh.cleanNotes,
      status: 'pending',
      gross_revenue: lastLoad.gross_revenue?.toString() || '',
      invoice_submitted_date: '',
      pod_submitted_date: '',
      payment_due_date: '',
      paid_date: '',
      short_paid_amount: '',
      payment_status: 'unpaid',
      payment_notes: '',
      dh_pay_status: lastDh.status,
      dh_pay_rate: lastDh.rate,
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
          {/* First-time user banner */}
          {firstTimeUser && !initialData && (
            <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3 flex items-start gap-2">
              <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="text-xs text-foreground leading-relaxed">
                <span className="font-bold">We pre-filled an example load</span> (Atlanta → Miami). Edit any field to match your real run, or save it as-is to see the dashboard come alive. You can delete it anytime.
              </div>
            </div>
          )}

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

          {/* Paste Load Parser */}
          {!initialData && (
            <PasteLoadParser
              isPro={isPro}
              onParsed={(data: ParsedLoadData) => {
                // Atomic apply: always reset mileage fields on a new paste so a
                // stale "loaded_miles" from a previous paste can't leak into the
                // new load if this paste only contains deadhead (and vice versa).
                setForm(prev => ({
                  ...prev,
                  pickup_location: data.pickup_location ?? prev.pickup_location,
                  dropoff_location: data.dropoff_location ?? prev.dropoff_location,
                  loaded_miles: data.loaded_miles ?? '',
                  deadhead_miles: data.deadhead_miles ?? '',
                  rate_per_mile: data.rate_per_mile ?? prev.rate_per_mile,
                  gross_revenue: data.gross_revenue ?? prev.gross_revenue,
                  load_date: data.load_date ?? prev.load_date,
                }));
                // Phase 6: surface a confirmation summary so the user can verify
                // detected miles + DH + trip ID before saving. DH defaults to "Unpaid".
                setParserDetected({
                  loaded_miles: data.loaded_miles,
                  deadhead_miles: data.deadhead_miles,
                  trip_id: data.trip_id,
                });
                if (data.trip_id) {
                  // Append trip ID into notes (only once) so it persists with the load.
                  setForm(prev => prev.notes.includes(data.trip_id!)
                    ? prev
                    : { ...prev, notes: prev.notes ? `${prev.notes}\nTrip ID: ${data.trip_id}` : `Trip ID: ${data.trip_id}` });
                }
                // Multi-stop auto-detection
                if (data.multiStopDetected && data.stops && data.stops.length >= 2) {
                  setMultiStop(true);
                  setStops(data.stops.map((s, i) => ({
                    stop_order: i + 1,
                    location: s.location,
                    stop_type: s.stop_type,
                    detention_minutes: null,
                  })));
                  setMultiStopBanner(`${data.detectedStopsCount} stops detected. Review stops before logging.`);
                }
              }}
            />
          )}

          {/* Phase 6: Parser detection summary */}
          {parserDetected && (parserDetected.loaded_miles || parserDetected.deadhead_miles || parserDetected.trip_id) && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-1.5 animate-fade-in">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5 text-primary" /> Detected
                </p>
                <button type="button" onClick={() => setParserDetected(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </div>
              <ul className="text-[11px] text-foreground/90 space-y-0.5">
                {parserDetected.trip_id && <li>• Trip ID: <span className="font-mono">{parserDetected.trip_id}</span></li>}
                {parserDetected.loaded_miles && <li>• Loaded/Trip Miles: <span className="font-bold">{parserDetected.loaded_miles}</span></li>}
                {parserDetected.deadhead_miles && <li>• Deadhead Miles: <span className="font-bold">{parserDetected.deadhead_miles}</span></li>}
                {parserDetected.deadhead_miles && (
                  <li>• Deadhead Pay: <span className="font-bold">{form.dh_pay_status === 'unpaid' ? 'Unpaid by default' : form.dh_pay_status === 'same' ? 'Same as loaded rate' : 'Custom rate'}</span></li>
                )}
              </ul>
            </div>
          )}

          {!initialData && (
            <div className="space-y-1.5">
              <Button
                variant="outline"
                className="w-full h-11 gap-2 rounded-xl border-primary/30 text-primary font-bold text-sm"
                onClick={() => {
                  if (!isPro) {
                    setShowScanUpgrade(true);
                    return;
                  }
                  setShowScanLoad(true);
                }}
              >
                <Camera className="h-4 w-4" />
                Scan Rate Con Screenshot
                {!isPro && (
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-warning font-bold">
                    <Crown className="h-3 w-3" /> Pro
                  </span>
                )}
              </Button>
              <p className="text-[10px] text-muted-foreground/60 text-center leading-relaxed px-2">
                Accuracy varies by image quality and format. Always review extracted fields before saving.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="load_date">Pickup Date</Label>
              <DateInput id="load_date" value={form.load_date} onChange={(val) => {
                update('load_date', val);
                if (!form.dropoff_date || form.dropoff_date === form.load_date) {
                  update('dropoff_date', val);
                }
              }} />
              <FieldError field="load_date" />
            </div>
            <div>
              <Label htmlFor="dropoff_date">Drop-off Date</Label>
              <DateInput id="dropoff_date" value={form.dropoff_date || form.load_date} onChange={(val) => update('dropoff_date', val)} />
            </div>
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

          {/* Multi-stop auto-detection banner */}
          {multiStopBanner && (
            <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-2.5 text-sm text-primary">
              <Info className="h-4 w-4 shrink-0" />
              <span>{multiStopBanner}</span>
              <button type="button" className="ml-auto" onClick={() => setMultiStopBanner(null)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

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
              <Input id="loaded_miles" type="number" step="any" {...numericProps} placeholder="0" value={form.loaded_miles} onChange={e => update('loaded_miles', e.target.value)} required />
              <FieldError field="loaded_miles" />
            </div>
            <div>
              <Label htmlFor="deadhead_miles">Deadhead Miles</Label>
              <Input id="deadhead_miles" type="number" step="any" {...numericProps} placeholder="0" value={form.deadhead_miles} onChange={e => update('deadhead_miles', e.target.value)} />
              <FieldError field="deadhead_miles" />
            </div>
          </div>

          {/* Deadhead Pay Status (Phase 4) — only shown when DH miles > 0 and CPM pay */}
          {!isPercentagePay && (parseFloat(form.deadhead_miles) || 0) > 0 && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
              <Label htmlFor="dh_pay_status" className="text-xs font-bold flex items-center gap-1">
                <DollarSign className="h-3 w-3 text-primary" /> Deadhead Pay
              </Label>
              <Select value={form.dh_pay_status} onValueChange={v => update('dh_pay_status', v)}>
                <SelectTrigger id="dh_pay_status" className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unpaid">Unpaid deadhead</SelectItem>
                  <SelectItem value="same">Paid at same rate as loaded miles</SelectItem>
                  <SelectItem value="custom">Paid at different rate</SelectItem>
                </SelectContent>
              </Select>
              {form.dh_pay_status === 'custom' && (
                <div>
                  <Label htmlFor="dh_pay_rate" className="text-xs">Deadhead Rate ($/mi)</Label>
                  <Input id="dh_pay_rate" type="number" step="0.01" {...numericProps} placeholder="0.00" value={form.dh_pay_rate} onChange={e => update('dh_pay_rate', e.target.value)} />
                </div>
              )}
              {deadheadRevenue > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Adds <span className="font-bold text-success">{formatCurrency(deadheadRevenue)}</span> to estimated pay.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground/80 leading-relaxed">
                Some companies pay deadhead miles and some do not. Choose how this load pays so your profit numbers stay accurate.
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="rate_per_mile" className="flex items-center gap-1">
              <DollarSign className="h-3 w-3 text-primary" /> Rate Per Mile
            </Label>
            <Input id="rate_per_mile" type="number" step="0.01" {...numericProps} placeholder="0.00" value={form.rate_per_mile} onChange={e => update('rate_per_mile', e.target.value)} required />
            <FieldError field="rate_per_mile" />
          </div>

          {/* Gross Revenue field for Percentage pay type */}
          {isPercentagePay && (
            <div>
              <Label htmlFor="gross_revenue" className="flex items-center gap-1">
                <DollarSign className="h-3 w-3 text-warning" /> Gross Load Revenue ($)
              </Label>
              <Input id="gross_revenue" type="number" step="0.01" {...numericProps} placeholder="0.00" value={form.gross_revenue} onChange={e => update('gross_revenue', e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-0.5">Enter the total load revenue to estimate your percentage pay.</p>
              <FieldError field="gross_revenue" />
            </div>
          )}

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

          {/* Payment Tracking (collapsible) */}
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 text-sm font-medium hover:bg-muted transition-colors"
              onClick={() => setShowPaymentTracking(!showPaymentTracking)}
            >
              <span className="flex items-center gap-1.5">
                <Receipt className="h-3.5 w-3.5 text-primary" />
                Payment Tracking
              </span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showPaymentTracking ? 'rotate-180' : ''}`} />
            </button>
            {showPaymentTracking && (
              <div className="p-4 space-y-3 border-t border-border/40">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="invoice_submitted_date" className="text-xs">Invoice Submitted</Label>
                    <DateInput id="invoice_submitted_date" value={form.invoice_submitted_date} onChange={(val) => update('invoice_submitted_date', val)} />
                  </div>
                  <div>
                    <Label htmlFor="pod_submitted_date" className="text-xs">POD Submitted</Label>
                    <DateInput id="pod_submitted_date" value={form.pod_submitted_date} onChange={(val) => update('pod_submitted_date', val)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="payment_due_date" className="text-xs">Payment Due</Label>
                    <DateInput id="payment_due_date" value={form.payment_due_date} onChange={(val) => update('payment_due_date', val)} />
                  </div>
                  <div>
                    <Label htmlFor="paid_date" className="text-xs">Paid Date</Label>
                    <DateInput id="paid_date" value={form.paid_date} onChange={(val) => update('paid_date', val)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="payment_status" className="text-xs">Payment Status</Label>
                    <Select value={form.payment_status} onValueChange={v => update('payment_status', v)}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unpaid">Unpaid</SelectItem>
                        <SelectItem value="invoiced">Invoiced</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="short_paid">Short Paid</SelectItem>
                        <SelectItem value="overdue">Overdue</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="short_paid_amount" className="text-xs">Short-Paid Amount</Label>
                    <Input id="short_paid_amount" type="number" step="0.01" {...numericProps} placeholder="0.00" value={form.short_paid_amount} onChange={e => update('short_paid_amount', e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="payment_notes" className="text-xs">Payment Notes</Label>
                  <Textarea id="payment_notes" placeholder="Invoice #, dispute details..." rows={2} value={form.payment_notes} onChange={e => update('payment_notes', e.target.value)} className="text-xs" />
                </div>
              </div>
            )}
          </div>


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

          {/* Phase 3: Profit Check */}
          {profitCheck && !isCancelled && <ProfitCheckCard result={profitCheck} />}

          <Button type="submit" className="w-full h-12 text-base font-bold" disabled={loading}>
            {loading ? 'Saving...' : initialData ? 'Update Load' : saveAsPending ? 'Save as Pending' : 'Log Load'}
          </Button>
        </form>
      </CardContent>

      {/* Scan Load Modal */}
      <ScanLoadModal
        open={showScanLoad}
        onOpenChange={setShowScanLoad}
        onParsed={(data: ParsedLoadData) => {
          // Atomic apply (same reasoning as PasteLoadParser handler above).
          setForm(prev => ({
            ...prev,
            pickup_location: data.pickup_location ?? prev.pickup_location,
            dropoff_location: data.dropoff_location ?? prev.dropoff_location,
            loaded_miles: data.loaded_miles ?? '',
            deadhead_miles: data.deadhead_miles ?? '',
            rate_per_mile: data.rate_per_mile ?? prev.rate_per_mile,
            gross_revenue: data.gross_revenue ?? prev.gross_revenue,
            load_date: data.load_date ?? prev.load_date,
          }));
          if (data.multiStopDetected && data.stops && data.stops.length >= 2) {
            setMultiStop(true);
            setStops(data.stops.map((s, i) => ({
              stop_order: i + 1,
              location: s.location,
              stop_type: s.stop_type,
              detention_minutes: null,
            })));
            setMultiStopBanner(`${data.detectedStopsCount} stops detected. Review stops before logging.`);
          }
        }}
      />

      {/* Scan Upgrade Modal */}
      {showScanUpgrade && (
        <Dialog open={showScanUpgrade} onOpenChange={setShowScanUpgrade}>
          <DialogContent className="sm:max-w-xs">
            <div className="text-center py-4 space-y-4">
              <div className="inline-flex items-center justify-center rounded-2xl bg-primary/10 p-4">
                <Camera className="h-8 w-8 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold">Scan Rate Confirmations</h3>
                <p className="text-sm text-muted-foreground">
                  Upload a screenshot of your rate con and auto-fill the load form with AI-powered OCR. Available on Pro.
                </p>
              </div>
              <Button
                className="w-full rounded-xl font-bold gap-1.5"
                onClick={() => { setShowScanUpgrade(false); window.location.href = '/pricing'; }}
              >
                <Crown className="h-4 w-4" /> Upgrade to Pro
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
