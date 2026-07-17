// Phase 1F-B — Unified Recruiter Opportunity Form.
//
// One production form used for both creating and editing opportunities.
// Replaces the old five-step wizard + separate Quick-Post form. All existing
// opportunity fields, current authorization rules, publish/draft semantics,
// AI paste behavior, and the shared financial calculator are preserved.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft, Save, Send, Sparkles, ChevronDown, ChevronUp,
  AlertTriangle, Info, DollarSign,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useRecruiterOpportunities,
  type Opportunity,
  type OpportunityInsert,
} from '@/hooks/opportunities/useRecruiterOpportunities';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { calculateOpportunityFinancials } from '@/lib/opportunities/opportunityProfit';
import { splitBenefits, joinBenefits } from '@/lib/opportunities/benefitsFormat';
import { PasteOpportunityDialog, type ExtractedOpportunity } from './PasteOpportunityDialog';

interface Props {
  initial?: Opportunity | null;
  onBack: () => void;
  onSaved: () => void;
}

const DEADHEAD_OPTIONS = ['unspecified', 'paid', 'unpaid'] as const;
const TRIBOOL_OPTIONS = ['unspecified', 'yes', 'no'] as const;

type Tribool = (typeof TRIBOOL_OPTIONS)[number];
type DhOpt = (typeof DEADHEAD_OPTIONS)[number];

const HIRING_TYPES = [
  { value: 'company', label: 'Company Driver' },
  { value: 'owner_operator', label: 'Owner Operator' },
  { value: 'lease_purchase', label: 'Lease Purchase' },
  { value: '1099', label: '1099 Contractor' },
  { value: 'team', label: 'Team Driver' },
];
const ROUTE_TYPES = ['Local', 'Regional', 'OTR', 'Dedicated', 'Semi-Dedicated'];
const TRAILER_TYPES = ['Dry Van', 'Reefer', 'Flatbed', 'Tanker', 'Car Hauler', 'Intermodal', 'Other'];
const PAY_MODELS = [
  { value: 'cpm', label: 'CPM' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'flat_weekly', label: 'Flat Weekly' },
  { value: 'salary', label: 'Salary' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'other', label: 'Other' },
];
const FUEL_PAID_BY = ['Company', 'Driver', 'Split', 'Not Disclosed'];
const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];

interface FormState {
  title: string;
  company_name: string;
  hiring_city: string;
  hiring_state: string;
  hiring_states: string;
  driver_type: string;
  route_type: string;
  trailer_type: string;
  description: string;
  pay_model: string;
  cpm: string;
  percentage_pay: string;
  flat_weekly_pay: string;
  estimated_weekly_gross: string;
  estimated_weekly_miles: string;
  estimated_loaded_miles: string;
  estimated_deadhead_miles: string;
  deadhead_paid: DhOpt;
  detention_pay: string;
  layover_pay: string;
  sign_on_bonus: string;
  fuel_paid_by: string;
  insurance_deductions: string;
  escrow_required: boolean;
  escrow_amount: string;
  lease_payment: string;
  maintenance_deductions: string;
  other_deductions: string;
  home_time: string;
  forced_dispatch: Tribool;
  pets_allowed: Tribool;
  riders_allowed: Tribool;
  equipment_year: string;
  benefits: string;        // Additional Requirements
  typical_lanes: string;   // stored serialized inside benefits column
  transparency_confirmed: boolean;
}

const EMPTY: FormState = {
  title: '', company_name: '', hiring_city: '', hiring_state: '', hiring_states: '',
  driver_type: '', route_type: '', trailer_type: '', description: '',
  pay_model: '', cpm: '', percentage_pay: '', flat_weekly_pay: '',
  estimated_weekly_gross: '', estimated_weekly_miles: '',
  estimated_loaded_miles: '', estimated_deadhead_miles: '',
  deadhead_paid: 'unspecified',
  detention_pay: '', layover_pay: '', sign_on_bonus: '',
  fuel_paid_by: '', insurance_deductions: '', escrow_required: false, escrow_amount: '',
  lease_payment: '', maintenance_deductions: '', other_deductions: '',
  home_time: '', forced_dispatch: 'unspecified', pets_allowed: 'unspecified',
  riders_allowed: 'unspecified', equipment_year: '', benefits: '', typical_lanes: '',
  transparency_confirmed: false,
};

const FIELD_LABELS: Record<string, string> = {
  cpm: 'CPM rate',
  percentage_pay: 'Percentage pay',
  flat_weekly_pay: 'Flat weekly pay',
  estimated_weekly_gross: 'Estimated weekly gross',
  estimated_weekly_miles: 'Estimated weekly miles',
  estimated_loaded_miles: 'Loaded miles',
  estimated_deadhead_miles: 'Deadhead miles',
  sign_on_bonus: 'Sign-on bonus',
  insurance_deductions: 'Insurance deduction',
  escrow_amount: 'Escrow amount',
  lease_payment: 'Lease payment',
  maintenance_deductions: 'Maintenance deduction',
  other_deductions: 'Other deductions',
};

const numOrNull = (v: string): number | null => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};
const triToBool = (v: Tribool) => v === 'yes' ? true : v === 'no' ? false : null;
const dhToBool = (v: DhOpt) => v === 'paid' ? true : v === 'unpaid' ? false : null;
const boolToTri = (b: boolean | null | undefined): Tribool =>
  b === true ? 'yes' : b === false ? 'no' : 'unspecified';
const boolToDh = (b: boolean | null | undefined): DhOpt =>
  b === true ? 'paid' : b === false ? 'unpaid' : 'unspecified';
const splitList = (s: string) => s.split(',').map((p) => p.trim()).filter(Boolean);

/** Advanced-detail fields that live behind the collapsible section. */
function hasAdvancedData(f: FormState): boolean {
  return (
    !!f.hiring_states.trim() ||
    !!f.typical_lanes.trim() ||
    !!f.estimated_loaded_miles ||
    !!f.estimated_deadhead_miles ||
    f.deadhead_paid !== 'unspecified' ||
    !!f.detention_pay.trim() ||
    !!f.layover_pay.trim() ||
    !!f.sign_on_bonus ||
    !!f.fuel_paid_by.trim() ||
    !!f.insurance_deductions ||
    !!f.escrow_required ||
    !!f.escrow_amount ||
    !!f.lease_payment ||
    !!f.maintenance_deductions ||
    !!f.other_deductions ||
    !!f.home_time.trim() ||
    f.forced_dispatch !== 'unspecified' ||
    f.pets_allowed !== 'unspecified' ||
    f.riders_allowed !== 'unspecified' ||
    !!f.equipment_year.trim() ||
    !!f.benefits.trim()
  );
}


function mergeExtractedOpportunity(
  current: FormState,
  data: ExtractedOpportunity,
): { nextForm: FormState; advancedFilled: boolean } {
  const next = { ...current };
  let advancedFilled = false;

  const fillString = (key: keyof FormState, value?: string, advanced = false) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const existing = next[key];
    if (typeof existing === 'string' && !existing.trim()) {
      (next[key] as string) = value;
      if (advanced) advancedFilled = true;
    }
  };
  const fillNumber = (key: keyof FormState, value?: number, advanced = false) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    if (next[key] === '') {
      (next[key] as string) = String(value);
      if (advanced) advancedFilled = true;
    }
  };
  const fillTriState = (
    key: 'forced_dispatch' | 'pets_allowed' | 'riders_allowed',
    value?: boolean,
  ) => {
    if (typeof value === 'boolean' && next[key] === 'unspecified') {
      next[key] = value ? 'yes' : 'no';
      advancedFilled = true;
    }
  };

  fillString('title', data.title);
  fillString('company_name', data.company_name);
  fillString('hiring_city', data.hiring_city);
  fillString('hiring_state', data.hiring_state);
  fillString('driver_type', data.driver_type);
  fillString('route_type', data.route_type);
  fillString('trailer_type', data.trailer_type);
  fillString('description', data.description);
  fillString('pay_model', data.pay_model);
  fillNumber('cpm', data.cpm);
  fillNumber('percentage_pay', data.percentage_pay);
  fillNumber('flat_weekly_pay', data.flat_weekly_pay);
  fillNumber('estimated_weekly_gross', data.estimated_weekly_gross);
  fillNumber('estimated_weekly_miles', data.estimated_weekly_miles);

  if (Array.isArray(data.hiring_states) && data.hiring_states.length && !next.hiring_states.trim()) {
    next.hiring_states = data.hiring_states.join(', ');
    advancedFilled = true;
  }
  fillNumber('estimated_loaded_miles', data.estimated_loaded_miles, true);
  fillNumber('estimated_deadhead_miles', data.estimated_deadhead_miles, true);
  if (typeof data.deadhead_paid === 'boolean' && next.deadhead_paid === 'unspecified') {
    next.deadhead_paid = data.deadhead_paid ? 'paid' : 'unpaid';
    advancedFilled = true;
  }
  fillString('detention_pay', data.detention_pay, true);
  fillString('layover_pay', data.layover_pay, true);
  fillNumber('sign_on_bonus', data.sign_on_bonus, true);
  fillString('fuel_paid_by', data.fuel_paid_by, true);
  fillNumber('insurance_deductions', data.insurance_deductions, true);
  if (data.escrow_required === true && !next.escrow_required) {
    next.escrow_required = true;
    advancedFilled = true;
  }
  fillNumber('escrow_amount', data.escrow_amount, true);
  fillNumber('lease_payment', data.lease_payment, true);
  fillNumber('maintenance_deductions', data.maintenance_deductions, true);
  fillNumber('other_deductions', data.other_deductions, true);
  fillString('home_time', data.home_time, true);
  fillTriState('forced_dispatch', data.forced_dispatch);
  fillTriState('pets_allowed', data.pets_allowed);
  fillTriState('riders_allowed', data.riders_allowed);
  fillString('equipment_year', data.equipment_year, true);
  fillString('typical_lanes', data.typical_lanes, true);
  const requirements = data.requirements?.trim()
    ? data.requirements
    : data.benefits?.trim()
      ? data.benefits
      : undefined;
  fillString('benefits', requirements, true);

  return { nextForm: next, advancedFilled };
}

export function RecruiterOpportunityForm({ initial, onBack, onSaved }: Props) {
  const { createOpportunity, updateOpportunity } = useRecruiterOpportunities();
  const { profile } = useRecruiterProfile();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [optionalOpen, setOptionalOpen] = useState<boolean>(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const initializedRef = useRef(false);

  // Edit hydration runs once. Create-mode company prefill remains responsive to late profile data.
  useEffect(() => {
    if (initial) {
      if (initializedRef.current) return;
      const split = splitBenefits(initial.benefits);
      const next: FormState = {
        title: initial.title ?? '',
        company_name: initial.company_name ?? '',
        hiring_city: initial.hiring_city ?? '',
        hiring_state: initial.hiring_state ?? '',
        hiring_states: (initial.hiring_states ?? []).join(', '),
        driver_type: initial.driver_type ?? '',
        route_type: initial.route_type ?? '',
        trailer_type: initial.trailer_type ?? '',
        description: initial.description ?? '',
        pay_model: initial.pay_model ?? '',
        cpm: initial.cpm?.toString() ?? '',
        percentage_pay: initial.percentage_pay?.toString() ?? '',
        flat_weekly_pay: initial.flat_weekly_pay?.toString() ?? '',
        estimated_weekly_gross: initial.estimated_weekly_gross?.toString() ?? '',
        estimated_weekly_miles: initial.estimated_weekly_miles?.toString() ?? '',
        estimated_loaded_miles: initial.estimated_loaded_miles?.toString() ?? '',
        estimated_deadhead_miles: initial.estimated_deadhead_miles?.toString() ?? '',
        deadhead_paid: boolToDh(initial.deadhead_paid),
        detention_pay: initial.detention_pay ?? '',
        layover_pay: initial.layover_pay ?? '',
        sign_on_bonus: initial.sign_on_bonus?.toString() ?? '',
        fuel_paid_by: initial.fuel_paid_by ?? '',
        insurance_deductions: initial.insurance_deductions?.toString() ?? '',
        escrow_required: !!initial.escrow_required,
        escrow_amount: initial.escrow_amount?.toString() ?? '',
        lease_payment: initial.lease_payment?.toString() ?? '',
        maintenance_deductions: initial.maintenance_deductions?.toString() ?? '',
        other_deductions: initial.other_deductions?.toString() ?? '',
        home_time: initial.home_time ?? '',
        forced_dispatch: boolToTri(initial.forced_dispatch),
        pets_allowed: boolToTri(initial.pets_allowed),
        riders_allowed: boolToTri(initial.riders_allowed),
        equipment_year: initial.equipment_year ?? '',
        benefits: split.requirements,
        typical_lanes: split.typical_lanes,
        transparency_confirmed: !!initial.transparency_confirmed,
      };
      setForm(next);
      setOptionalOpen(hasAdvancedData(next));
      initializedRef.current = true;
      return;
    }
    if (profile?.company_name) {
      setForm((current) => current.company_name
        ? current
        : { ...current, company_name: profile.company_name ?? '' });
    }
  }, [initial, profile]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const numericFields = useMemo<(keyof FormState)[]>(() => [
    'cpm','percentage_pay','flat_weekly_pay','estimated_weekly_gross',
    'estimated_weekly_miles','estimated_loaded_miles','estimated_deadhead_miles',
    'sign_on_bonus','insurance_deductions','escrow_amount','lease_payment',
    'maintenance_deductions','other_deductions',
  ], []);

  const financials = useMemo(() => calculateOpportunityFinancials({
    estimated_weekly_gross: numOrNull(form.estimated_weekly_gross),
    flat_weekly_pay: numOrNull(form.flat_weekly_pay),
    cpm: numOrNull(form.cpm),
    percentage_pay: numOrNull(form.percentage_pay),
    estimated_weekly_miles: numOrNull(form.estimated_weekly_miles),
    estimated_loaded_miles: numOrNull(form.estimated_loaded_miles),
    estimated_deadhead_miles: numOrNull(form.estimated_deadhead_miles),
    deadhead_paid: dhToBool(form.deadhead_paid),
    insurance_deductions: numOrNull(form.insurance_deductions),
    escrow_amount: numOrNull(form.escrow_amount),
    escrow_required: form.escrow_required,
    lease_payment: numOrNull(form.lease_payment),
    maintenance_deductions: numOrNull(form.maintenance_deductions),
    other_deductions: numOrNull(form.other_deductions),
  }), [form]);

  const validate = (mode: 'draft' | 'submit'): string | null => {
    if (!form.title.trim()) return 'Title is required.';
    if (!form.company_name.trim()) return 'Company name is required.';
    for (const k of numericFields) {
      const v = form[k] as string;
      if (v !== '' && (Number.isNaN(Number(v)) || Number(v) < 0)) {
        const friendly = FIELD_LABELS[k as string] ?? (k as string).replace(/_/g, ' ');
        return `${friendly} must be 0 or higher.`;
      }
    }
    if (mode === 'submit') {
      if (!form.driver_type.trim()) return 'Hiring type is required.';
      if (!form.route_type.trim()) return 'Route type is required.';
      if (!form.trailer_type.trim()) return 'Trailer type is required.';
      if (!form.pay_model.trim()) return 'Pay model is required.';
      const hasPay =
        !!numOrNull(form.estimated_weekly_gross) ||
        !!numOrNull(form.cpm) ||
        !!numOrNull(form.flat_weekly_pay) ||
        !!numOrNull(form.percentage_pay);
      if (!hasPay) return 'Provide at least one pay value (weekly gross, CPM, flat weekly, or percentage).';
      if (!form.transparency_confirmed) return 'Please confirm the transparency statement to publish.';
    }
    return null;
  };

  const buildPayload = (mode: 'draft' | 'submit'): OpportunityInsert => ({
    title: form.title.trim(),
    company_name: form.company_name.trim(),
    hiring_city: form.hiring_city.trim() || null,
    hiring_state: form.hiring_state.trim() || null,
    hiring_states: splitList(form.hiring_states),
    driver_type: form.driver_type.trim() || null,
    route_type: form.route_type.trim() || null,
    trailer_type: form.trailer_type.trim() || null,
    pay_model: form.pay_model.trim() || null,
    cpm: numOrNull(form.cpm),
    percentage_pay: numOrNull(form.percentage_pay),
    flat_weekly_pay: numOrNull(form.flat_weekly_pay),
    estimated_weekly_gross: numOrNull(form.estimated_weekly_gross),
    estimated_weekly_miles: numOrNull(form.estimated_weekly_miles),
    estimated_loaded_miles: numOrNull(form.estimated_loaded_miles),
    estimated_deadhead_miles: numOrNull(form.estimated_deadhead_miles),
    deadhead_paid: dhToBool(form.deadhead_paid),
    detention_pay: form.detention_pay.trim() || null,
    layover_pay: form.layover_pay.trim() || null,
    sign_on_bonus: numOrNull(form.sign_on_bonus),
    fuel_paid_by: form.fuel_paid_by.trim() || null,
    insurance_deductions: numOrNull(form.insurance_deductions),
    escrow_required: form.escrow_required,
    escrow_amount: numOrNull(form.escrow_amount),
    lease_payment: numOrNull(form.lease_payment),
    maintenance_deductions: numOrNull(form.maintenance_deductions),
    other_deductions: numOrNull(form.other_deductions),
    home_time: form.home_time.trim() || null,
    forced_dispatch: triToBool(form.forced_dispatch),
    pets_allowed: triToBool(form.pets_allowed),
    riders_allowed: triToBool(form.riders_allowed),
    equipment_year: form.equipment_year.trim() || null,
    benefits: joinBenefits({ typical_lanes: form.typical_lanes, requirements: form.benefits }) || null,
    description: form.description.trim() || null,
    transparency_confirmed: form.transparency_confirmed,
    status: mode === 'submit' ? 'active' : 'draft',
  });

  const save = (mode: 'draft' | 'submit') => {
    const err = validate(mode);
    if (err) { toast.error(err); return; }
    const payload = buildPayload(mode);
    const onSuccess = () => {
      toast.success(mode === 'submit' ? 'Opportunity published — live to drivers now' : 'Draft saved');
      onSaved();
    };
    const onError = (e: Error) => toast.error(e.message);
    if (initial?.id) {
      updateOpportunity.mutate({ id: initial.id, data: payload }, { onSuccess, onError });
    } else {
      createOpportunity.mutate(payload, { onSuccess, onError });
    }
  };

  const pending = createOpportunity.isPending || updateOpportunity.isPending;

  // Paste-to-autofill is computed synchronously so advanced expansion is deterministic.
  const handleExtracted = (data: ExtractedOpportunity) => {
    const { nextForm, advancedFilled } = mergeExtractedOpportunity(form, data);
    setForm(nextForm);
    if (advancedFilled) setOptionalOpen(true);
  };

  const showCpm = form.pay_model === 'cpm' || form.pay_model === 'mixed';
  const showPct = form.pay_model === 'percentage' || form.pay_model === 'mixed';
  const showFlat = form.pay_model === 'flat_weekly' || form.pay_model === 'salary' || form.pay_model === 'mixed';

  const warnings: string[] = [];
  if (financials.hasUnpaidDeadhead) warnings.push('Deadhead appears unpaid.');
  if (financials.hasUnknownDeadheadPay) warnings.push('Deadhead pay is not disclosed.');
  if (financials.hasLeaseRisk) warnings.push('Lease payment detected — drivers will see this.');
  if (financials.hasHighDeductionRisk) warnings.push('High deductions may significantly reduce take-home pay.');
  if (financials.missingPayData) warnings.push('Pay data is incomplete.');

  return (
    <div className="animate-fade-in pb-16" data-testid="recruiter-opportunity-form">
      {/* Header */}
      <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground mb-3"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
            {initial ? 'Edit Opportunity' : 'Post Opportunity'}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl mt-1">
            Share the essentials so drivers can compare pay, route, and take-home honestly.
            Only the required fields are marked. Extra detail helps you attract better matches.
          </p>
          <div className="mt-3">
            <Button
              type="button"
              size="sm"
              onClick={() => setPasteOpen(true)}
              disabled={pending}
              className="bg-primary text-primary-foreground hover:bg-primary/90 border border-primary shadow-sm"
            >
              <Sparkles className="h-4 w-4" /> Paste to auto-fill
            </Button>
          </div>
        </div>
      </div>

      <PasteOpportunityDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        onExtracted={handleExtracted}
      />

      {/* Essentials */}
      <Card className="p-5 sm:p-6 border-border/60 space-y-5" data-testid="essentials-section">
        <SectionHeader title="Essentials" subtitle="The core details drivers need to evaluate this opportunity." />

        <Field label="Opportunity Title" required count={`${form.title.length}/100`}>
          <Input
            value={form.title}
            onChange={(e) => set('title', e.target.value.slice(0, 100))}
            placeholder="Example: Regional Dry Van Driver Needed"
            aria-label="Opportunity Title"
          />
        </Field>

        <Field label="Company Name" required helper="Shown to drivers.">
          <Input
            value={form.company_name}
            onChange={(e) => set('company_name', e.target.value)}
            placeholder="ABC Logistics LLC"
            aria-label="Company Name"
          />
        </Field>

        <Field label="Hiring Type" required>
          <ChipRow
            value={form.driver_type}
            onChange={(v) => set('driver_type', v)}
            options={HIRING_TYPES}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Route Type" required>
            <Select value={form.route_type || 'unset'} onValueChange={(v) => set('route_type', v === 'unset' ? '' : v)}>
              <SelectTrigger aria-label="Route Type"><SelectValue placeholder="Select route type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Select…</SelectItem>
                {ROUTE_TYPES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Trailer Type" required>
            <Select value={form.trailer_type || 'unset'} onValueChange={(v) => set('trailer_type', v === 'unset' ? '' : v)}>
              <SelectTrigger aria-label="Trailer Type"><SelectValue placeholder="Select trailer type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Select…</SelectItem>
                {TRAILER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-4">
          <Field label="Hiring City" helper="Optional — helps drivers see where you're hiring.">
            <Input
              value={form.hiring_city}
              onChange={(e) => set('hiring_city', e.target.value)}
              placeholder="Dallas"
              aria-label="Hiring City"
            />
          </Field>
          <Field label="State">
            <Select value={form.hiring_state || 'unset'} onValueChange={(v) => set('hiring_state', v === 'unset' ? '' : v)}>
              <SelectTrigger aria-label="State"><SelectValue placeholder="TX" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">—</SelectItem>
                {US_STATES.map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        {/* Pay */}
        <div className="pt-2">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-bold text-foreground">Pay</h3>
          </div>

          <Field label="Pay Model" required>
            <ChipRow
              value={form.pay_model}
              onChange={(v) => set('pay_model', v)}
              options={PAY_MODELS}
            />
          </Field>

          {!form.pay_model && (
            <div className="mt-3 rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>Pick a pay model to reveal the matching rate fields.</span>
            </div>
          )}

          {form.pay_model && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {showCpm && (
                <CpmField
                  value={form.cpm}
                  onChange={(v) => set('cpm', v)}
                  weeklyMiles={form.estimated_weekly_miles}
                />
              )}
              {showPct && <NumField label="Percentage Pay (%)" value={form.percentage_pay} onChange={(v) => set('percentage_pay', v)} />}
              {showFlat && <NumField label="Flat Weekly Pay ($)" value={form.flat_weekly_pay} onChange={(v) => set('flat_weekly_pay', v)} />}
              <NumField label="Est. Weekly Gross ($)" value={form.estimated_weekly_gross} onChange={(v) => set('estimated_weekly_gross', v)} />
              <NumField label="Est. Weekly Miles" value={form.estimated_weekly_miles} onChange={(v) => set('estimated_weekly_miles', v)} />
            </div>
          )}
        </div>

        <Field label="Short Description" count={`${form.description.length}/500`} helper="Optional but recommended — a couple of sentences goes a long way.">
          <Textarea
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value.slice(0, 500))}
            placeholder="Briefly describe the opportunity, lanes, and what drivers can expect."
            aria-label="Short Description"
          />
        </Field>
      </Card>

      {/* Optional details (collapsible) */}
      <Card className="mt-5 border-border/60" data-testid="optional-details-section" data-open={optionalOpen ? 'true' : 'false'}>
        <button
          type="button"
          onClick={() => setOptionalOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/20 rounded-lg transition-colors"
          data-testid="optional-details-toggle"
          aria-expanded={optionalOpen}
        >
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground">Optional details</h3>
            <p className="text-xs text-muted-foreground">
              Lanes, deductions, home time, requirements — all optional but they build driver trust.
            </p>
          </div>
          {optionalOpen
            ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
        </button>

        {optionalOpen && (
          <div className="px-5 pb-6 space-y-5 border-t border-border/40 pt-5" data-testid="optional-details-body">
            <Field label="Hiring States" helper="Comma-separated (example: TX, OK, AR, LA)">
              <Input
                value={form.hiring_states}
                onChange={(e) => set('hiring_states', e.target.value)}
                placeholder="TX, OK, AR"
                aria-label="Hiring States"
              />
            </Field>

            <Field label="Typical Lanes" helper={'One per line — example: "Dallas, TX → Houston, TX"'}>
              <Textarea
                rows={3}
                value={form.typical_lanes}
                onChange={(e) => set('typical_lanes', e.target.value)}
                placeholder={'Dallas, TX → Houston, TX\nMidwest → Southeast'}
                aria-label="Typical Lanes"
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <NumField label="Loaded Miles" value={form.estimated_loaded_miles} onChange={(v) => set('estimated_loaded_miles', v)} />
              <NumField label="Deadhead Miles" value={form.estimated_deadhead_miles} onChange={(v) => set('estimated_deadhead_miles', v)} />
              <Field label="Deadhead Paid?">
                <Select value={form.deadhead_paid} onValueChange={(v) => set('deadhead_paid', v as DhOpt)}>
                  <SelectTrigger aria-label="Deadhead Paid?"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unspecified">Not disclosed</SelectItem>
                    <SelectItem value="paid">Yes</SelectItem>
                    <SelectItem value="unpaid">No</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <TriField label="Forced Dispatch?" value={form.forced_dispatch} onChange={(v) => set('forced_dispatch', v)} />
              <TriField label="Pets Allowed?" value={form.pets_allowed} onChange={(v) => set('pets_allowed', v)} />
              <TriField label="Riders Allowed?" value={form.riders_allowed} onChange={(v) => set('riders_allowed', v)} />
            </div>

            <Field label="Equipment Year / Truck Info">
              <Input
                value={form.equipment_year}
                onChange={(e) => set('equipment_year', e.target.value)}
                placeholder="Example: 2020–2024 Freightliner Cascadia"
                aria-label="Equipment Year / Truck Info"
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Detention Pay">
                <Input value={form.detention_pay} onChange={(e) => set('detention_pay', e.target.value)} placeholder="Example: $25/hr after 2 hrs" aria-label="Detention Pay" />
              </Field>
              <Field label="Layover Pay">
                <Input value={form.layover_pay} onChange={(e) => set('layover_pay', e.target.value)} placeholder="Example: $150/day" aria-label="Layover Pay" />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <NumField label="Sign-On Bonus ($)" value={form.sign_on_bonus} onChange={(v) => set('sign_on_bonus', v)} />
              <Field label="Fuel Paid By">
                <Select value={form.fuel_paid_by || 'unset'} onValueChange={(v) => set('fuel_paid_by', v === 'unset' ? '' : v)}>
                  <SelectTrigger aria-label="Fuel Paid By"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">Not disclosed</SelectItem>
                    {FUEL_PAID_BY.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Home Time">
                <Input
                  value={form.home_time}
                  onChange={(e) => set('home_time', e.target.value)}
                  placeholder="Home weekly, every 2 weeks"
                  aria-label="Home Time"
                />
              </Field>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Deductions</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <NumField label="Insurance Deduction" value={form.insurance_deductions} onChange={(v) => set('insurance_deductions', v)} />
                <NumField label="Escrow Amount" value={form.escrow_amount} onChange={(v) => set('escrow_amount', v)} />
                <NumField label="Lease Payment" value={form.lease_payment} onChange={(v) => set('lease_payment', v)} />
                <NumField label="Maintenance Deduction" value={form.maintenance_deductions} onChange={(v) => set('maintenance_deductions', v)} />
                <NumField label="Other Deductions" value={form.other_deductions} onChange={(v) => set('other_deductions', v)} />
                <Field label="Escrow Required?">
                  <label className="flex items-center gap-2 pt-2">
                    <Checkbox checked={form.escrow_required} onCheckedChange={(v) => set('escrow_required', !!v)} aria-label="Escrow Required?" />
                    <span className="text-sm">Yes, escrow required</span>
                  </label>
                </Field>
              </div>
            </div>

            <Field label="Additional Requirements" helper="Experience, CDL class, endorsements, MVR/drug test, background.">
              <Textarea
                rows={4}
                value={form.benefits}
                onChange={(e) => set('benefits', e.target.value)}
                placeholder={'Example:\n• 1 year OTR experience\n• Class A CDL\n• Clean MVR last 3 years'}
                aria-label="Additional Requirements"
              />
            </Field>
          </div>
        )}
      </Card>

      {/* Summary + warnings */}
      <Card className="mt-5 p-5 border-border/60" data-testid="earnings-summary">
        <h3 className="text-sm font-bold text-foreground mb-3">Earnings Summary</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <SummaryStat label="Est. Weekly Gross" value={fmtUsd(financials.estimatedGross)} />
          <SummaryStat label="Est. Weekly Net" value={fmtUsd(financials.estimatedNet)} />
          <SummaryStat label="Effective RPM" value={financials.effectiveRpm != null ? `$${financials.effectiveRpm.toFixed(2)}` : '—'} />
          <SummaryStat label="Deadhead %" value={financials.deadheadPercentage != null ? `${financials.deadheadPercentage.toFixed(1)}%` : '—'} />
        </div>
        {warnings.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <h4 className="text-xs font-bold text-foreground">Heads up</h4>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-5">
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </div>
        )}
      </Card>

      {/* Transparency confirmation */}
      <Card className="mt-5 p-5 border-border/60" data-testid="transparency-confirmation">
        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            checked={form.transparency_confirmed}
            onCheckedChange={(v) => set('transparency_confirmed', !!v)}
            className="mt-0.5"
            aria-label="Transparency confirmation"
          />
          <span className="text-sm text-foreground leading-snug">
            I confirm this opportunity is accurate. Drivers will see the pay, miles, deductions, and
            estimated Profit Intelligence based on the information I provide.
          </span>
        </label>
      </Card>

      {/* Actions */}
      <div
        className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3"
        data-testid="form-actions"
      >
        <Button variant="outline" onClick={() => save('draft')} disabled={pending}>
          <Save className="h-4 w-4" /> Save Draft
        </Button>
        <Button onClick={() => save('submit')} disabled={pending}>
          <Send className="h-4 w-4" /> Publish Opportunity
        </Button>
      </div>
    </div>
  );
}

/* ================= Small presentational primitives ================= */

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-lg font-black text-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
    </div>
  );
}

function Field({
  label, required, helper, count, children,
}: {
  label: string;
  required?: boolean;
  helper?: string;
  count?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-semibold text-foreground">
          {label} {required && <span className="text-primary">*</span>}
        </Label>
        {count && <span className="text-[10px] text-muted-foreground">{count}</span>}
      </div>
      {children}
      {helper && <p className="text-[11px] text-muted-foreground">{helper}</p>}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function CpmField({
  value, onChange, weeklyMiles,
}: { value: string; onChange: (v: string) => void; weeklyMiles: string }) {
  const num = value === '' ? null : Number(value);
  const validNum = num != null && !Number.isNaN(num) && num >= 0 ? num : null;
  const miles = Number(weeklyMiles);
  const validMiles = !Number.isNaN(miles) && miles > 0 ? miles : null;
  const weekly = validNum != null && validMiles != null ? Math.round(validNum * validMiles) : null;
  const looksLikeCents = validNum != null && validNum > 2;

  return (
    <Field
      label="CPM Rate ($/mi)"
      helper={
        looksLikeCents
          ? `⚠️ ${validNum} looks like cents. Enter dollars per mile (example: 0.65 for 65¢/mi).`
          : weekly != null
            ? `≈ $${weekly.toLocaleString()}/week at ${validMiles!.toLocaleString()} miles`
            : '$/mile — example: 0.65 for 65 cents per mile'
      }
    >
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
        <Input
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          max={5}
          aria-label="CPM Rate ($/mi)"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.65"
          className={`pl-7 ${looksLikeCents ? 'border-amber-500/60 focus-visible:ring-amber-500/40' : ''}`}
        />
      </div>
    </Field>
  );
}

function TriField({ label, value, onChange }: { label: string; value: Tribool; onChange: (v: Tribool) => void }) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={(v) => onChange(v as Tribool)}>
        <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="unspecified">Not disclosed</SelectItem>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

function ChipRow({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
              selected
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border/60 hover:border-primary/40 hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
      <p className="text-sm font-black text-foreground mt-0.5">{value}</p>
    </div>
  );
}

function fmtUsd(n: number | null): string {
  if (n == null) return '—';
  return `$${Math.round(n).toLocaleString()}`;
}
