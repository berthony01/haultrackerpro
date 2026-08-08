import { useState, useMemo, useEffect, useRef } from 'react';
import { format as formatDate, subDays } from 'date-fns';

/**
 * Phase 1N — Local-calendar-safe "today" as YYYY-MM-DD.
 * Avoids `new Date().toISOString()` which shifts negative-UTC users a day.
 */
function localTodayYMD(): string {
  return formatDate(new Date(), 'yyyy-MM-dd');
}
function localDaysAgoYMD(days: number): string {
  return formatDate(subDays(new Date(), days), 'yyyy-MM-dd');
}
/** Human-readable rendering for the reporting summary, e.g. "July 19, 2026". */
function formatReportingDate(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return formatDate(dt, 'MMMM d, yyyy');
}
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
import {
  normalizeParsedStops,
  deriveTrailingDropDate,
  normalizeEditorStopsForSave,
  normalizeEditorStopsForUi,
} from '@/lib/stopNormalization';

import { DateInput } from '@/components/ui/date-input';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

import { MapPin, DollarSign, Route, Clock, X, FileText, AlertCircle, Info, Camera, Crown, Receipt, ChevronDown } from 'lucide-react';
import { PayModel, PAY_MODEL_LABELS, PAY_MODEL_DESCRIPTIONS, PAY_MODEL_VALUES, isPayModel, resolvePayModel } from '@/lib/payModels';
import { computeLoadPay } from '@/lib/computeLoadPay';
import { useCostProfile, computeCostProfileCPM } from '@/hooks/useCostProfile';
import { toast } from 'sonner';
import { SmartChips } from '@/components/SmartChips';
import { MultiStopEditor } from '@/components/MultiStopEditor';
import { PasteLoadParser } from '@/components/PasteLoadParser';
import { ScanLoadModal } from '@/components/ScanLoadModal';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ParsedLoadData } from '@/lib/parseLoadText';
import { resolveImportedLoadDate, resolveImportedDropoffDate } from '@/lib/sourceDate';
import { mergePasteIntoForm, createPasteSession, type PasteSession } from '@/lib/loadPasteMerge';

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
  /** Navigate user to settings page (used by deadhead-pay warning). */
  onOpenSettings?: () => void;
}

const SAMPLE_LOAD = {
  pickup_location: 'Atlanta, GA',
  dropoff_location: 'Miami, FL',
  loaded_miles: '650',
  deadhead_miles: '50',
  rate_per_mile: '2.50',
};

export function LoadForm({ onSubmit, onCancel, initialData, initialStops, loading, recentLoads = [], isPro = false, firstTimeUser = false, onOpenSettings }: LoadFormProps) {
  const { settings } = useUserSettings();
  const { profile: costProfile } = useCostProfile();
  const lastLoad = recentLoads[0] ?? null;

  const isPercentagePay = settings?.pay_type === 'percentage';
  const useSample = firstTimeUser && !initialData;

  // Parse DH-pay tag out of existing notes (edit mode); defaults for new loads.
  const initialDh = useMemo(() => readDhFromNotes(initialData?.notes ?? null), [initialData?.notes]);

  const [form, setForm] = useState({
    load_date: initialData?.load_date || localTodayYMD(),
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
    pay_model: resolvePayModel(initialData?.pay_model, (settings as any)?.default_pay_model) as PayModel,
    total_miles: initialData?.total_miles?.toString() ?? '',
    flat_rate_amount: initialData?.flat_rate_amount?.toString() ?? '',
    dh_rate_per_mile: (initialData as any)?.deadhead_rate_per_mile?.toString() ?? '',
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
  const [acknowledgedDropWarning, setAcknowledgedDropWarning] = useState(false);

  // Phase 29G: per-field dirty tracking so a second paste/scan into the same
  // form cannot silently carry stale imported dates from the previous load.
  // Flipped to true only when the driver edits the DateInput directly.
  const [userTouchedLoadDate, setUserTouchedLoadDate] = useState(false);
  const [userTouchedDropoffDate, setUserTouchedDropoffDate] = useState(false);

  // Phase 1N-A: untouched-today confirmation for NEW completed loads.
  // Blocks the first submit when the pickup date is still the auto-filled
  // local "today" and the user hasn't intentionally set it. The user
  // acknowledges by clicking "Save as Today", which sets ack=true so the
  // next submit passes cleanly. Any real date change flips
  // `userTouchedLoadDate` and skips the guard entirely.
  const [showTodayConfirm, setShowTodayConfirm] = useState(false);
  const [acknowledgedTodayDate, setAcknowledgedTodayDate] = useState(false);
  const initialTodayRef = useRef<string>(localTodayYMD());

  // Phase 29A: reset the "save again to confirm" acknowledgement whenever the
  // user changes anything that could move the load into or out of the risky
  // missing-final-stop-date state. Without this, once a user dismisses the
  // warning they could never see it again even after editing dates back to a
  // risky configuration.
  useEffect(() => {
    setAcknowledgedDropWarning(false);
  }, [multiStop, stops, form.dropoff_date, form.load_date]);

  // Phase 1N-A: any real change to the pickup date or status resets the
  // untouched-today acknowledgement so the guard behaves safely if the user
  // toggles back into the risky state.
  useEffect(() => {
    setAcknowledgedTodayDate(false);
    setShowTodayConfirm(false);
  }, [form.load_date, form.status, saveAsPending]);

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

  const payCalc = useMemo(() => {
    return computeLoadPay({
      payModel: form.pay_model,
      loadedMiles: parseFloat(form.loaded_miles) || 0,
      deadheadMiles: parseFloat(form.deadhead_miles) || 0,
      totalMiles: parseFloat(form.total_miles) || 0,
      loadedRpm: parseFloat(form.rate_per_mile) || 0,
      dhRpm: parseFloat(form.dh_rate_per_mile) || 0,
      flatRate: parseFloat(form.flat_rate_amount) || 0,
      manualGross: parseFloat(form.gross_revenue) || 0,
      fees: (parseFloat(form.wait_fee) || 0) + (parseFloat(form.detention_fee) || 0) + (parseFloat(form.other_fees) || 0),
      legacyDhPayMode: form.dh_pay_status,
      legacyDhPayRate: parseFloat(form.dh_pay_rate) || 0,
    });
  }, [form.pay_model, form.loaded_miles, form.deadhead_miles, form.total_miles, form.rate_per_mile, form.dh_rate_per_mile, form.flat_rate_amount, form.gross_revenue, form.wait_fee, form.detention_fee, form.other_fees, form.dh_pay_status, form.dh_pay_rate]);

  const estimated = useMemo(() => {
    if (isCancelled) return 0;
    // Percentage-based pay: gross × percentage + fees (handled separately from pay_model)
    if (isPercentagePay && form.gross_revenue && settings?.pay_percentage) {
      const grossRev = parseFloat(form.gross_revenue) || 0;
      const pct = Number(settings.pay_percentage) / 100;
      return grossRev * pct + (parseFloat(form.wait_fee) || 0) + (parseFloat(form.detention_fee) || 0) + (parseFloat(form.other_fees) || 0);
    }
    return payCalc.expectedGrossPay;
  }, [payCalc, form.gross_revenue, form.wait_fee, form.detention_fee, form.other_fees, isCancelled, isPercentagePay, settings?.pay_percentage]);

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
    // Rate per mile is conditionally required based on pay model
    const rpmRaw = form.rate_per_mile;
    const rpm = parseFloat(rpmRaw);
    const rpmRequired =
      form.pay_model === 'loaded_miles_only' ||
      form.pay_model === 'total_miles' ||
      form.pay_model === 'loaded_plus_deadhead';
    if (rpmRequired) {
      if (rpmRaw === '' || isNaN(rpm) || rpm <= 0) errs.rate_per_mile = 'Rate per mile is required';
    } else if (rpmRaw !== '' && (isNaN(rpm) || rpm < 0)) {
      errs.rate_per_mile = 'Must be 0 or positive';
    }
    // Flat rate requires flat_rate_amount
    if (form.pay_model === 'flat_rate') {
      const flat = parseFloat(form.flat_rate_amount);
      if (!form.flat_rate_amount || isNaN(flat) || flat <= 0) {
        errs.flat_rate_amount = 'Flat rate amount is required';
      }
    }
    // Manual requires either gross revenue (percentage) or actual pay
    if (form.pay_model === 'manual') {
      const gross = parseFloat(form.gross_revenue);
      const actual = parseFloat(form.actual_pay_received);
      const hasGross = !isNaN(gross) && gross > 0;
      const hasActual = !isNaN(actual) && actual > 0;
      if (!hasGross && !hasActual) {
        errs.actual_pay_received = 'Enter expected gross or actual pay received';
      }
    }
    // Loaded + deadhead: dh rate optional but must be valid if present
    if (form.pay_model === 'loaded_plus_deadhead' && form.dh_rate_per_mile) {
      const dhr = parseFloat(form.dh_rate_per_mile);
      if (isNaN(dhr) || dhr < 0) errs.dh_rate_per_mile = 'Must be 0 or positive';
    }
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

    // Phase 1N-A: untouched-today confirmation guard for NEW completed loads.
    // Only fires when: new load, final status completed, pickup date never
    // intentionally touched, and the pickup date still equals the local
    // "today" that was auto-filled when the form mounted. Skipped in edit
    // mode, for pending/cancelled, and once the user acknowledges.
    const isNewCompletedUntouched =
      !initialData &&
      finalStatus === 'completed' &&
      !userTouchedLoadDate &&
      form.load_date === initialTodayRef.current &&
      form.load_date === localTodayYMD();
    if (isNewCompletedUntouched && !acknowledgedTodayDate) {
      setShowTodayConfirm(true);
      return;
    }

    // Format stop locations
    const rawFormattedStops = multiStop ? stops.map((s, i) => ({
      ...s,
      stop_order: i + 1,
      location: formatLocation(s.location),
    })) : [];

    // Phase 29D: enforce canonical endpoint model on manual save. Promote any
    // explicit leading Pickup / trailing Drop row out of load_stops and into
    // top-level fields, so the saved row is always [Pickup endpoint] + interior
    // stops + [Drop endpoint] with no duplicates.
    const normalized = multiStop
      ? normalizeEditorStopsForSave({
          pickup_location: formatLocation(form.pickup_location),
          dropoff_location: formatLocation(form.dropoff_location),
          load_date: form.load_date,
          dropoff_date: form.dropoff_date,
          stops: rawFormattedStops,
        })
      : {
          pickup_location: formatLocation(form.pickup_location),
          dropoff_location: formatLocation(form.dropoff_location),
          load_date: form.load_date,
          dropoff_date: form.dropoff_date || form.load_date,
          interiorStops: [] as typeof rawFormattedStops,
        };

    // Phase 29B/D: ONLY an explicit final Drop stop with a valid stop_date may
    // override the manual dropoff_date. Intermediate Stop dates never override.
    // After Phase 29D promotion, the final Drop is reflected in
    // `normalized.dropoff_date` directly, but we still need to detect the
    // "user enabled multi-stop but left every stop date blank" risk case.
    const explicitFinalDrop = multiStop ? deriveTrailingDropDate(normalizeEditorStopsForUi(rawFormattedStops)) : null;
    const needsDropWarning =
      multiStop &&
      rawFormattedStops.length >= 1 &&
      !explicitFinalDrop &&
      (!form.dropoff_date || form.dropoff_date === form.load_date);
    if (needsDropWarning && !acknowledgedDropWarning) {
      setAcknowledgedDropWarning(true);
      toast.warning('Final Drop stop date is missing. This load may be counted on the pickup date instead of the delivery date. Tap save again to confirm.', { duration: 7000 });
      return;
    }

    onSubmit({
      load_date: normalized.load_date,
      dropoff_date: normalized.dropoff_date,
      pickup_location: normalized.pickup_location,
      dropoff_location: normalized.dropoff_location,
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
      pay_model: form.pay_model,
      total_miles: form.total_miles ? parseFloat(form.total_miles) : null,
      flat_rate_amount: form.pay_model === 'flat_rate' && form.flat_rate_amount ? parseFloat(form.flat_rate_amount) : null,
      deadhead_rate_per_mile: form.pay_model === 'loaded_plus_deadhead' && form.dh_rate_per_mile ? parseFloat(form.dh_rate_per_mile) : null,
      // Persist computed expected gross pay (single source of truth from computeLoadPay)
      // so dashboards/reports/exports reflect the active pay model. For percentage-pay
      // users we already routed `estimated` through the percentage formula above.
      estimated_pay: finalStatus === 'cancelled' ? 0 : Math.max(0, Number(estimated.toFixed(2))),
    } as any, normalized.interiorStops);
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
    // Phase 1N-A-R1: single local-today value drives both the copied form's
    // pickup date and the untouched-today baseline ref, so the completed-today
    // guard still fires if the user later flips this copied load to completed
    // without intentionally changing Pickup Date.
    const copyToday = localTodayYMD();
    setForm({
      load_date: copyToday,
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
      pay_model: resolvePayModel(lastLoad.pay_model, (settings as any)?.default_pay_model),
      total_miles: lastLoad.total_miles?.toString() ?? '',
      flat_rate_amount: lastLoad.flat_rate_amount?.toString() ?? '',
      dh_rate_per_mile: (lastLoad as any).deadhead_rate_per_mile?.toString() ?? '',
    });
    // Phase 29B: copying a previous load is treated as a fresh single-stop load —
    // clear any lingering multi-stop state from a prior paste/scan/edit session.
    setMultiStop(false);
    setStops([]);
    setMultiStopBanner(null);
    setSaveAsPending(true);
    // Phase 1N-A-R1: reset date-intent + today-confirmation state so a
    // previously touched historical date on the prior form does not carry
    // forward into the copied form and silently bypass the completed-today guard.
    initialTodayRef.current = copyToday;
    setUserTouchedLoadDate(false);
    setUserTouchedDropoffDate(false);
    setAcknowledgedTodayDate(false);
    setShowTodayConfirm(false);
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
                // Phase 29C: normalize FIRST so endpoint promotion (incl. final
                // Drop stop_date → top-level dropoff_date) flows into form state.
                const norm = normalizeParsedStops(data);
                // Phase 29G: per-field date dirty tracking — stale imported
                // dates from a prior paste must not silently carry forward.
                const loadRes = resolveImportedLoadDate(form.load_date, data.load_date, userTouchedLoadDate);
                const dropRes = resolveImportedDropoffDate(form.dropoff_date, norm.dropoff_date ?? data.dropoff_date, userTouchedDropoffDate);
                if (loadRes.kept === 'manual') toast.info('No pickup date found in imported text. Kept your manual pickup date.');
                if (dropRes.kept === 'manual') toast.info('No delivery date found in imported text. Kept your manual drop-off date.');
                // Atomic apply: always reset mileage fields on a new paste so a
                // stale "loaded_miles" from a previous paste can't leak into the
                // new load if this paste only contains deadhead (and vice versa).
                setForm(prev => {
                  // Phase 1S-B1: paste-managed fields go through the pure merge
                  // helper so stale imported values from a previous paste are
                  // removed while manual edits survive.
                  const merged = mergePasteIntoForm({
                    session: pasteSessionRef.current,
                    current: {
                      pickup_location: prev.pickup_location,
                      dropoff_location: prev.dropoff_location,
                      rate_per_mile: prev.rate_per_mile,
                      gross_revenue: prev.gross_revenue,
                      flat_rate_amount: prev.flat_rate_amount,
                      dh_rate_per_mile: prev.dh_rate_per_mile,
                      wait_fee: prev.wait_fee,
                      detention_fee: prev.detention_fee,
                      pay_model: prev.pay_model,
                    },
                    notes: prev.notes,
                    incoming: {
                      pickup_location: norm.pickup_location ?? data.pickup_location,
                      dropoff_location: norm.dropoff_location ?? data.dropoff_location,
                      rate_per_mile: data.rate_per_mile,
                      gross_revenue: data.gross_revenue,
                      flat_rate_amount: data.flat_rate,
                      dh_rate_per_mile: data.deadhead_rate_per_mile,
                      wait_fee: data.wait_fee,
                      detention_fee: data.detention_fee,
                      pay_model: isPayModel(data.pay_model_suggestion) ? data.pay_model_suggestion : undefined,
                    },
                    fallbacks: {
                      pickup_location: '',
                      dropoff_location: '',
                      rate_per_mile: settings?.default_rate_per_mile?.toString() ?? '',
                      gross_revenue: '',
                      flat_rate_amount: '',
                      dh_rate_per_mile: '',
                      wait_fee: '0',
                      detention_fee: '0',
                      pay_model: resolvePayModel(null, (settings as any)?.default_pay_model),
                    },
                    tripId: data.trip_id,
                  });
                  pasteSessionRef.current = merged.session;
                  return {
                    ...prev,
                    ...merged.values,
                    pay_model: merged.values.pay_model as PayModel,
                    notes: merged.notes,
                    loaded_miles: data.loaded_miles ?? '',
                    deadhead_miles: data.deadhead_miles ?? '',
                    load_date: loadRes.value,
                    dropoff_date: dropRes.value,
                    // Phase 6C.4: reset total_miles like loaded/deadhead so a
                    // stale total from a previous paste can't leak into the new load.
                    total_miles: data.total_miles ?? '',
                  };
                });
                // Phase 6: surface a confirmation summary so the user can verify
                // detected miles + DH + trip ID before saving. DH defaults to "Unpaid".
                setParserDetected({
                  loaded_miles: data.loaded_miles,
                  deadhead_miles: data.deadhead_miles,
                  trip_id: data.trip_id,
                });
                // Phase 29B: interior stops only go into stops state.
                // When no interior stops exist (single-stop or [Pickup,Drop]),
                // clear stale stop state from any previous multi-stop parse.
                if (norm.multiStop) {
                  setMultiStop(true);
                  setStops(norm.interiorStops.map((s, i) => ({
                    stop_order: i + 1,
                    location: s.location,
                    stop_type: s.stop_type,
                    detention_minutes: null,
                    stop_date: (s as any).stop_date ?? null,
                  })));
                  setMultiStopBanner(`${norm.interiorStops.length + 2} stops detected. Review stops before logging.`);
                } else {
                  setMultiStop(false);
                  setStops([]);
                  setMultiStopBanner(null);
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
                // Phase 29: only seed dropoff from pickup for single-stop loads when the
                // user hasn't typed a dropoff yet. Multi-stop derives from final stop date.
                const prevPickup = form.load_date;
                setUserTouchedLoadDate(true);
                update('load_date', val);
                if (!multiStop && (!form.dropoff_date || form.dropoff_date === prevPickup)) {
                  update('dropoff_date', val);
                }
              }} />
              {/* Phase 1N-A: pickup date shortcuts for historical entry. */}
              <div className="flex flex-wrap gap-1.5 mt-2" data-testid="pickup-date-shortcuts">
                {[
                  { label: 'Today', days: 0 },
                  { label: 'Yesterday', days: 1 },
                  { label: '2 days ago', days: 2 },
                  { label: '3 days ago', days: 3 },
                ].map(({ label, days }) => (
                  <Button
                    key={label}
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Set pickup date to ${label.toLowerCase()}`}
                    className="h-7 px-2 text-[11px] rounded-md"
                    onClick={() => {
                      const val = localDaysAgoYMD(days);
                      const prevPickup = form.load_date;
                      setUserTouchedLoadDate(true);
                      update('load_date', val);
                      if (!multiStop && (!form.dropoff_date || form.dropoff_date === prevPickup)) {
                        update('dropoff_date', val);
                      }
                    }}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Choose pickup date"
                  className="h-7 px-2 text-[11px] rounded-md"
                  onClick={() => {
                    // Reuse the existing DateInput contract: its trigger is a
                    // button with id={id}, so clicking it opens the calendar
                    // popover without introducing a second date input.
                    const el = document.getElementById('load_date') as HTMLElement | null;
                    el?.focus();
                    el?.click();
                  }}
                >
                  Choose date
                </Button>
              </div>
              <FieldError field="load_date" />
            </div>
            <div>
              <Label htmlFor="dropoff_date">Drop-off Date</Label>
              {/* Phase 29: do NOT mask blank dropoff with load_date — driver must see when it's empty. */}
              <DateInput id="dropoff_date" value={form.dropoff_date} onChange={(val) => { setUserTouchedDropoffDate(true); update('dropoff_date', val); }} />
              <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
                Used for dashboard, weekly totals, reports, and exports. {multiStop ? 'Manual Drop-off Date stays in control unless a final Drop stop date is provided.' : 'If blank, pickup date is used.'}
              </p>
              {multiStop && (() => {
                const explicit = deriveTrailingDropDate(normalizeEditorStopsForUi(stops));
                return explicit ? (
                  <p className="text-[10px] text-primary mt-1 leading-snug">
                    Final Drop stop date {explicit} will be used for reporting.
                  </p>
                ) : null;
              })()}
            </div>
          </div>

          {/* Phase 1N-A: live reporting-date summary. */}
          {(() => {
            const effective = form.dropoff_date && /^\d{4}-\d{2}-\d{2}$/.test(form.dropoff_date)
              ? form.dropoff_date
              : (form.load_date && /^\d{4}-\d{2}-\d{2}$/.test(form.load_date) ? form.load_date : '');
            const pretty = effective ? formatReportingDate(effective) : null;
            return (
              <p
                className="text-[11px] text-muted-foreground leading-snug"
                data-testid="reporting-date-summary"
              >
                {pretty ? (
                  <>This load will count toward <span className="font-semibold text-foreground">{pretty}</span> in dashboard totals and reports.</>
                ) : (
                  <>This load will count toward the delivery date you enter in dashboard totals and reports.</>
                )}
              </p>
            );
          })()}

          {/* Phase 1N-A: untouched-today confirmation panel. */}
          {showTodayConfirm && (
            <div
              className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2"
              role="alertdialog"
              aria-label="Confirm today's date"
              data-testid="today-confirm-panel"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <p className="text-xs font-semibold text-foreground leading-relaxed">
                  This completed load is dated today. Did this load actually happen today?
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs flex-1"
                  onClick={() => {
                    setShowTodayConfirm(false);
                    const el = document.getElementById('load_date') as HTMLElement | null;
                    el?.focus();
                    el?.click();
                  }}
                >
                  Change Date
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs flex-1"
                  onClick={() => {
                    setAcknowledgedTodayDate(true);
                    setShowTodayConfirm(false);
                  }}
                >
                  Save as Today
                </Button>
              </div>
            </div>
          )}


          <div>
            <Label htmlFor="status">Status</Label>
            <Select value={form.status} onValueChange={v => { update('status', v); if (v === 'cancelled' && !form.notes) update('notes', 'Cancelled by dispatcher'); }}>
              <SelectTrigger id="status"><SelectValue /></SelectTrigger>
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
              <p className="text-xs text-muted-foreground">Add route stops between pickup and final delivery</p>
            </div>
            <Switch aria-label="Multi-stop load" checked={multiStop} onCheckedChange={setMultiStop} />
          </div>

          {multiStop && (
            <MultiStopEditor stops={stops} onChange={setStops} errors={stopErrors} />
          )}

          {/* Pay Model selector — drives how pay is calculated for this load */}
          {!isPercentagePay && (
            <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-3 space-y-2">
              <Label htmlFor="pay_model" className="text-xs font-bold flex items-center gap-1">
                <DollarSign className="h-3 w-3 text-primary" /> Pay Model
              </Label>
              <Select value={form.pay_model} onValueChange={v => update('pay_model', v)}>
                <SelectTrigger id="pay_model" className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAY_MODEL_VALUES.map(m => (
                    <SelectItem key={m} value={m} data-testid={`pay-model-option-${m}`}>{PAY_MODEL_LABELS[m]}</SelectItem>
                  ))}

                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground/80 leading-relaxed">
                {PAY_MODEL_DESCRIPTIONS[form.pay_model]}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="loaded_miles">{form.pay_model === 'flat_rate' ? 'Trip / Loaded Miles (optional)' : 'Trip / Loaded Miles'}</Label>
              <Input id="loaded_miles" type="number" step="any" {...numericProps} placeholder="0" value={form.loaded_miles} onChange={e => update('loaded_miles', e.target.value)} required={form.pay_model !== 'flat_rate' && form.pay_model !== 'manual' && form.pay_model !== 'total_miles'} />
              <FieldError field="loaded_miles" />
            </div>
            <div>
              <Label htmlFor="deadhead_miles">Deadhead Miles</Label>
              <Input id="deadhead_miles" type="number" step="any" {...numericProps} placeholder="0" value={form.deadhead_miles} onChange={e => update('deadhead_miles', e.target.value)} />
              <FieldError field="deadhead_miles" />
            </div>
          </div>

          {/* Total Miles is always available — dispatcher posts often include it
              even when the driver is paid loaded miles only. Used for effective RPM
              and reconciliation across all pay models. */}
          <div>
            <Label htmlFor="total_miles">
              Total Miles {form.pay_model === 'total_miles' ? '(paid)' : '(optional)'}
            </Label>
            <Input id="total_miles" type="number" step="any" {...numericProps} placeholder="0" value={form.total_miles} onChange={e => update('total_miles', e.target.value)} />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Trip miles usually means loaded miles. Total miles usually means trip + deadhead.
            </p>
          </div>

          {/* Flat Rate amount */}
          {form.pay_model === 'flat_rate' && (
            <div>
              <Label htmlFor="flat_rate_amount" className="flex items-center gap-1">
                <DollarSign className="h-3 w-3 text-primary" /> Flat Rate ($)
              </Label>
              <Input id="flat_rate_amount" type="number" step="0.01" {...numericProps} placeholder="0.00" value={form.flat_rate_amount} onChange={e => update('flat_rate_amount', e.target.value)} required />
            </div>
          )}

          {/* Deadhead rate input for loaded_plus_deadhead model */}
          {form.pay_model === 'loaded_plus_deadhead' && (
            <div>
              <Label htmlFor="dh_rate_per_mile" className="flex items-center gap-1">
                <DollarSign className="h-3 w-3 text-primary" /> Deadhead Rate ($/mi)
              </Label>
              <Input id="dh_rate_per_mile" type="number" step="0.01" {...numericProps} placeholder="0.00" value={form.dh_rate_per_mile} onChange={e => update('dh_rate_per_mile', e.target.value)} />
            </div>
          )}

          {/* Mileage reconciliation warnings */}
          {!isPercentagePay && payCalc.warnings.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 space-y-1">
              {payCalc.warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-warning-foreground flex items-start gap-1.5">
                  <AlertCircle className="h-3 w-3 text-warning mt-0.5 shrink-0" /> {w}
                </p>
              ))}
            </div>
          )}

          {/* Deadhead Pay Status (legacy) — only relevant for the Loaded Miles Only model */}
          {!isPercentagePay && form.pay_model === 'loaded_miles_only' && (parseFloat(form.deadhead_miles) || 0) > 0 && (
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

          {form.pay_model !== 'flat_rate' && form.pay_model !== 'manual' && (
            <div>
              <Label htmlFor="rate_per_mile" className="flex items-center gap-1">
                <DollarSign className="h-3 w-3 text-primary" /> Rate Per Mile
                {(form.pay_model === 'loaded_miles_only' || form.pay_model === 'total_miles' || form.pay_model === 'loaded_plus_deadhead') && (
                  <span className="text-destructive">*</span>
                )}
              </Label>
              <Input id="rate_per_mile" type="number" step="0.01" {...numericProps} placeholder="0.00" value={form.rate_per_mile} onChange={e => update('rate_per_mile', e.target.value)} />
              <FieldError field="rate_per_mile" />
            </div>
          )}

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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="detention_fee" className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Detention Fee
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
              <Switch aria-label="Save as Pending" checked={saveAsPending} onCheckedChange={setSaveAsPending} />
            </div>
          )}

          {/* Phase 2: Deadhead unpaid education card */}
          {(() => {
            const dh = parseFloat(form.deadhead_miles) || 0;
            if (isCancelled) return null;
            if (dh <= 0) return null;
            if (form.pay_model !== 'loaded_miles_only') return null;
            if (form.dh_pay_status !== 'unpaid') return null;
            return (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                  <div className="text-xs leading-relaxed">
                    <p className="font-bold text-warning mb-1">Heads up: deadhead miles are set to unpaid.</p>
                    <p className="text-foreground/80">
                      If your company actually pays you for empty miles, change <span className="font-semibold">Deadhead Pay → "Paid at same rate"</span> or
                      <span className="font-semibold"> Pay Model → "Total Miles Paid"</span> so HaulTrackerPro shows your real earnings.
                    </p>
                  </div>
                </div>
                {onOpenSettings && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs w-full"
                    onClick={onOpenSettings}
                  >
                    Open Pay Settings
                  </Button>
                )}
              </div>
            );
          })()}

          {/* Live financial preview */}
          {(() => {
            const loaded = parseFloat(form.loaded_miles) || 0;
            const dh = parseFloat(form.deadhead_miles) || 0;
            const totalMi = loaded + dh;
            const contractRate = parseFloat(form.rate_per_mile) || 0;
            const gross = isCancelled ? 0 : estimated;
            const effRPM = totalMi > 0 ? gross / totalMi : 0;
            const loadedRPM = loaded > 0 ? gross / loaded : 0;
            const costProfileResult = computeCostProfileCPM(costProfile, totalMi);
            const cpm = costProfileResult.cpm;
            const fixedMissingMiles = costProfileResult.warnings.includes('fixed_missing_monthly_miles');
            const estExpenses = cpm * totalMi;
            const netProfit = gross - estExpenses;
            const netRPM = totalMi > 0 ? netProfit / totalMi : 0;
            const dhImpactPct = loadedRPM > 0 ? ((loadedRPM - effRPM) / loadedRPM) * 100 : 0;
            const actualNum = parseFloat(form.actual_pay_received);
            const hasActual = !isCancelled && form.actual_pay_received && Number.isFinite(actualNum);

            const LabelWithTip = ({ label, tip }: { label: string; tip: string }) => (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground underline decoration-dotted decoration-muted-foreground/40 cursor-help">
                    {label}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px] text-xs">{tip}</TooltipContent>
              </Tooltip>
            );

            return (
              <TooltipProvider delayDuration={150}>
              <div className={`rounded-lg p-4 space-y-3 ${isCancelled ? 'bg-destructive/10' : 'bg-secondary'}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs text-muted-foreground">Estimated Gross Revenue</p>
                    <p className={`text-2xl font-black font-mono ${isCancelled ? 'text-destructive' : 'text-primary'}`}>
                      {formatCurrency(gross)}
                    </p>
                    {isCancelled && <p className="text-xs text-destructive mt-0.5">Cancelled — pay set to $0</p>}
                  </div>
                  {hasActual && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Actual</p>
                      <p className={`text-2xl font-black font-mono ${actualNum >= gross ? 'text-success' : 'text-destructive'}`}>
                        {formatCurrency(actualNum)}
                      </p>
                    </div>
                  )}
                </div>

                {!isCancelled && (
                  <>
                    <div className="space-y-2 text-xs pt-2 border-t border-border/50">
                      {/* Broker rate */}
                      <div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Broker Rate (per loaded mile)</span>
                          <span className="font-mono font-semibold">${contractRate.toFixed(2)}/mi</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground/80 leading-tight mt-0.5">What the broker pays you per loaded mile.</p>
                      </div>

                      {/* Real pay per mile */}
                      <div>
                        <div className="flex justify-between">
                          <LabelWithTip label="Your Real Pay Per Mile" tip="Technical term: Effective RPM" />
                          <span className="font-mono font-semibold text-primary">${effRPM.toFixed(2)}/mi</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground/80 leading-tight mt-0.5">Includes your empty/deadhead miles. This is what your truck actually earns per mile rolling.</p>
                      </div>

                      <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-1">
                        <div className="flex justify-between">
                          <LabelWithTip label="Est. Fuel & Truck Costs" tip="Technical term: Estimated Variable Cost" />
                          <span className="font-mono font-semibold">{cpm > 0 ? formatCurrency(estExpenses) : '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Est. Take-Home (after costs)</span>
                          <span className={`font-mono font-semibold ${cpm > 0 ? (netProfit >= 0 ? 'text-success' : 'text-destructive') : ''}`}>
                            {cpm > 0 ? formatCurrency(netProfit) : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <LabelWithTip label="Take-Home Per Mile" tip="Technical term: Net RPM" />
                          <span className={`font-mono font-semibold ${cpm > 0 ? (netRPM >= 0 ? 'text-success' : 'text-destructive') : ''}`}>
                            {cpm > 0 ? `$${netRPM.toFixed(2)}/mi` : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Empty Miles Drag</span>
                          <span className="font-mono font-semibold">
                            {dh > 0 && loadedRPM > 0 ? `−${dhImpactPct.toFixed(1)}%` : '—'}
                          </span>
                        </div>
                      </div>
                      {dh > 0 && loadedRPM > 0 && (
                        <p className="text-[10px] text-muted-foreground/80 leading-tight">How much your empty miles lower your real pay per mile.</p>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug pt-1 border-t border-border/30">
                      <Info className="inline h-3 w-3 mr-1 -mt-0.5" />
                      Your broker rate has not changed. "Real Pay Per Mile" spreads your pay across all miles you drove, loaded + empty, so you can see what your truck actually earns.
                      {cpm <= 0 && !fixedMissingMiles && ' Add a Cost Profile in Settings to see Take-Home & Take-Home Per Mile.'}
                    </p>
                    {fixedMissingMiles && (
                      <div className="flex items-start gap-1.5 text-[11px] rounded-md bg-warning/10 border border-warning/30 px-2 py-1.5 mt-1">
                        <AlertCircle className="h-3 w-3 text-warning shrink-0 mt-0.5" />
                        <span className="text-warning leading-relaxed">
                          Fixed monthly costs aren't included — add <span className="font-bold">Estimated monthly miles</span> in Settings → My Cost Profile.
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
              </TooltipProvider>
            );
          })()}

          {/* Phase 3: Profit Check */}
          {profitCheck && !isCancelled && <ProfitCheckCard result={profitCheck} />}

          <Button type="submit" data-testid="load-form-submit" className="w-full h-12 text-base font-bold" disabled={loading}>
            {loading ? 'Saving...' : initialData ? 'Update Load' : saveAsPending ? 'Save as Pending' : 'Log Load'}
          </Button>

        </form>
      </CardContent>

      {/* Scan Load Modal */}
      <ScanLoadModal
        open={showScanLoad}
        onOpenChange={setShowScanLoad}
        onParsed={(data: ParsedLoadData) => {
          // Phase 29C: normalize FIRST so endpoint promotion (incl. final Drop
          // stop_date → top-level dropoff_date) flows in for BOTH AI and
          // regex-fallback scan payloads.
          const norm = normalizeParsedStops(data);
          // Scanner safety: only fill EMPTY fields. Never overwrite values the
          // user (or a previous paste) already set, and never write null/undefined.
          const fillIfEmpty = (current: string, incoming: string | undefined): string => {
            const hasIncoming = incoming != null && String(incoming).trim() !== '';
            if (!hasIncoming) return current;
            const isEmpty = current == null || String(current).trim() === '' || current === '0';
            return isEmpty ? String(incoming) : current;
          };
          // Phase 29G: per-field date dirty tracking — same rule as paste so a
          // second scan into the same form cannot silently inherit a prior
          // imported pickup/drop-off date.
          const loadRes = resolveImportedLoadDate(form.load_date, data.load_date, userTouchedLoadDate);
          const dropRes = resolveImportedDropoffDate(form.dropoff_date, norm.dropoff_date ?? data.dropoff_date, userTouchedDropoffDate);
          if (loadRes.kept === 'manual') toast.info('No pickup date found in imported text. Kept your manual pickup date.');
          if (dropRes.kept === 'manual') toast.info('No delivery date found in imported text. Kept your manual drop-off date.');
          setForm(prev => ({
            ...prev,
            pickup_location: fillIfEmpty(prev.pickup_location, norm.pickup_location ?? data.pickup_location),
            dropoff_location: fillIfEmpty(prev.dropoff_location, norm.dropoff_location ?? data.dropoff_location),
            loaded_miles: fillIfEmpty(prev.loaded_miles, data.loaded_miles),
            deadhead_miles: fillIfEmpty(prev.deadhead_miles, data.deadhead_miles),
            rate_per_mile: fillIfEmpty(prev.rate_per_mile, data.rate_per_mile),
            gross_revenue: fillIfEmpty(prev.gross_revenue, data.gross_revenue),
            load_date: loadRes.value,
            dropoff_date: dropRes.value,
            total_miles: fillIfEmpty(prev.total_miles, data.total_miles),
            flat_rate_amount: fillIfEmpty(prev.flat_rate_amount, data.flat_rate),
            dh_rate_per_mile: fillIfEmpty(prev.dh_rate_per_mile, data.deadhead_rate_per_mile),
            // Pay model: only adopt suggestion if user hasn't explicitly chosen one yet
            pay_model: isPayModel(data.pay_model_suggestion) && (prev.pay_model === 'loaded_miles_only')
              ? data.pay_model_suggestion
              : prev.pay_model,
          }));
          // Phase 29B: interior stops only go into stops state; clear stale
          // state when no interior stops.
          if (norm.multiStop) {
            setMultiStop(true);
            setStops(norm.interiorStops.map((s, i) => ({
              stop_order: i + 1,
              location: s.location,
              stop_type: s.stop_type,
              detention_minutes: null,
              stop_date: (s as any).stop_date ?? null,
            })));
            setMultiStopBanner(`${norm.interiorStops.length + 2} stops detected. Review stops before logging.`);
          } else {
            setMultiStop(false);
            setStops([]);
            setMultiStopBanner(null);
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
