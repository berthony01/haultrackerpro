import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft, Briefcase, DollarSign, Home, ShieldCheck, Save, Lock, Send,
  Truck, ChevronRight, Eye, Lock as LockIcon, CheckCircle2, AlertTriangle,
  Info, MapPin, HelpCircle, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useRecruiterOpportunities,
  type Opportunity,
  type OpportunityInsert,
} from '@/hooks/opportunities/useRecruiterOpportunities';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { calculateOpportunityFinancials, profitScoreLabel } from '@/lib/opportunities/opportunityProfit';
import { splitBenefits, joinBenefits } from '@/lib/opportunities/benefitsFormat';
import { PasteOpportunityDialog, type ExtractedOpportunity } from './PasteOpportunityDialog';

interface Props {
  initial?: Opportunity | null;
  /** Optional pre-filled values used when creating new (e.g. handoff from Quick Post). */
  seed?: Partial<OpportunityInsert> | null;
  onBack: () => void;
  onSaved: () => void;
  canSubmitForReview?: boolean;
  submitBlockReason?: string | null;
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
  // basic
  title: string;
  company_name: string;
  hiring_city: string;
  hiring_state: string;
  hiring_states: string;
  driver_type: string;
  route_type: string;
  trailer_type: string;
  description: string;
  // pay
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
  // lifestyle
  home_time: string;
  forced_dispatch: Tribool;
  pets_allowed: Tribool;
  riders_allowed: Tribool;
  equipment_year: string;
  benefits: string;          // requirements (Step 4)
  typical_lanes: string;     // lanes (Step 2) — serialized into benefits column
  // confirm
  transparency_confirmed: boolean;
  confirm_drivers_see_intel: boolean;
  confirm_misleading_removed: boolean;
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
  transparency_confirmed: false, confirm_drivers_see_intel: false, confirm_misleading_removed: false,
};

// Friendlier labels for validation errors (D5 fix).
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

const STEPS = [
  { id: 1, title: 'Job Basics', short: 'Tell drivers the basics about this opportunity.', icon: Briefcase, tint: 'bg-primary/10 text-primary' },
  { id: 2, title: 'Route & Equipment', short: 'Tell drivers about the routes, equipment, and expectations.', icon: Truck, tint: 'bg-sky-500/10 text-sky-400' },
  { id: 3, title: 'Pay & Deductions', short: 'Provide clear pay details and list any known deductions.', icon: DollarSign, tint: 'bg-amber-500/10 text-amber-400' },
  { id: 4, title: 'Home Time & Requirements', short: 'Set expectations for home time and driver requirements.', icon: Home, tint: 'bg-violet-500/10 text-violet-400' },
  { id: 5, title: 'Transparency Review', short: 'Review your opportunity for accuracy and transparency.', icon: ShieldCheck, tint: 'bg-emerald-500/10 text-emerald-400' },
];

export function RecruiterOpportunityForm({
  initial, seed, onBack, onSaved, canSubmitForReview = true, submitBlockReason,
}: Props) {
  const { createOpportunity, updateOpportunity } = useRecruiterOpportunities();
  const { profile } = useRecruiterProfile();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [step, setStep] = useState(1);
  const [pasteOpen, setPasteOpen] = useState(false);


  useEffect(() => {
    if (!initial) {
      // Prefill from Quick Post seed (if handed off) then recruiter profile company name.
      if (seed) {
        const split = splitBenefits(seed.benefits ?? null);
        setForm((f) => ({
          ...f,
          title: seed.title ?? f.title,
          company_name: seed.company_name ?? f.company_name,
          hiring_city: seed.hiring_city ?? f.hiring_city,
          hiring_state: seed.hiring_state ?? f.hiring_state,
          hiring_states: (seed.hiring_states ?? []).join(', ') || f.hiring_states,
          driver_type: seed.driver_type ?? f.driver_type,
          route_type: seed.route_type ?? f.route_type,
          trailer_type: seed.trailer_type ?? f.trailer_type,
          description: seed.description ?? f.description,
          pay_model: seed.pay_model ?? f.pay_model,
          cpm: seed.cpm != null ? String(seed.cpm) : f.cpm,
          percentage_pay: seed.percentage_pay != null ? String(seed.percentage_pay) : f.percentage_pay,
          flat_weekly_pay: seed.flat_weekly_pay != null ? String(seed.flat_weekly_pay) : f.flat_weekly_pay,
          estimated_weekly_gross: seed.estimated_weekly_gross != null ? String(seed.estimated_weekly_gross) : f.estimated_weekly_gross,
          estimated_weekly_miles: seed.estimated_weekly_miles != null ? String(seed.estimated_weekly_miles) : f.estimated_weekly_miles,
          home_time: seed.home_time ?? f.home_time,
          typical_lanes: split.typical_lanes || f.typical_lanes,
          benefits: split.requirements || f.benefits,
          transparency_confirmed: seed.transparency_confirmed ?? f.transparency_confirmed,
          confirm_drivers_see_intel: seed.transparency_confirmed ?? f.confirm_drivers_see_intel,
          confirm_misleading_removed: seed.transparency_confirmed ?? f.confirm_misleading_removed,
        }));
      } else if (profile?.company_name) {
        setForm((f) => f.company_name ? f : { ...f, company_name: profile.company_name ?? '' });
      }
      return;
    }
    setForm({
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
      benefits: splitBenefits(initial.benefits).requirements,
      typical_lanes: splitBenefits(initial.benefits).typical_lanes,
      transparency_confirmed: !!initial.transparency_confirmed,
      confirm_drivers_see_intel: !!initial.transparency_confirmed,
      confirm_misleading_removed: !!initial.transparency_confirmed,
    });
  }, [initial, profile]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const numericFields = useMemo<(keyof FormState)[]>(() => [
    'cpm','percentage_pay','flat_weekly_pay','estimated_weekly_gross',
    'estimated_weekly_miles','estimated_loaded_miles','estimated_deadhead_miles',
    'sign_on_bonus','insurance_deductions','escrow_amount','lease_payment',
    'maintenance_deductions','other_deductions',
  ], []);

  // Derived: financials preview using the same calculator
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

  // Opportunity strength score (UI-only completeness guidance)
  const strength = useMemo(() => {
    const checks = [
      !!form.title.trim(),
      !!form.company_name.trim(),
      !!form.route_type.trim(),
      !!form.trailer_type.trim(),
      !!(form.estimated_weekly_gross || form.cpm || form.flat_weekly_pay || form.percentage_pay),
      !!form.estimated_weekly_miles,
      form.deadhead_paid !== 'unspecified',
      !!form.home_time.trim(),
      !!(form.insurance_deductions || form.escrow_amount || form.lease_payment || form.maintenance_deductions || form.other_deductions || form.fuel_paid_by),
      form.transparency_confirmed && form.confirm_drivers_see_intel && form.confirm_misleading_removed,
    ];
    const pct = Math.round((checks.filter(Boolean).length / checks.length) * 100);
    let label = 'Incomplete';
    if (pct >= 80) label = 'Great';
    else if (pct >= 60) label = 'Good';
    else if (pct >= 40) label = 'Needs More Detail';
    const suggestions: string[] = [];
    if (!form.detention_pay) suggestions.push('Consider adding detention pay details');
    if (!form.sign_on_bonus) suggestions.push('Add sign-on bonus (if available)');
    if (!form.equipment_year) suggestions.push('List equipment year range');
    if (form.deadhead_paid === 'unspecified') suggestions.push('Disclose deadhead pay');
    return { pct, label, suggestions };
  }, [form]);

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
      if (!form.transparency_confirmed || !form.confirm_drivers_see_intel || !form.confirm_misleading_removed) {
        return 'Please confirm all transparency checkboxes to submit.';
      }
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
    transparency_confirmed:
      form.transparency_confirmed && form.confirm_drivers_see_intel && form.confirm_misleading_removed,
    status: mode === 'submit' ? 'active' : 'draft',
  });

  const save = (mode: 'draft' | 'submit') => {
    const err = validate(mode);
    if (err) { toast.error(err); return; }
    const payload = buildPayload(mode);
    const onSuccess = () => {
      toast.success(mode === 'submit' ? 'Submitted for review' : 'Draft saved');
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
  const isLastStep = step === STEPS.length;

  const handleNext = () => {
    if (step < STEPS.length) setStep(step + 1);
  };

  // Merge AI-extracted fields into form state without overwriting non-empty values the
  // recruiter has already typed. Strings replace empty strings; numbers replace ''
  // strings; booleans replace the 'unspecified' tribool/dh sentinels.
  const handleExtracted = (data: ExtractedOpportunity) => {
    setForm((f) => {
      const next = { ...f };
      const setStr = (k: keyof FormState, v?: string) => {
        if (v && typeof v === 'string' && !(next[k] as string)) (next[k] as string) = v;
      };
      const setNum = (k: keyof FormState, v?: number) => {
        if (typeof v === 'number' && Number.isFinite(v) && !(next[k] as string)) {
          (next[k] as string) = String(v);
        }
      };
      const setTri = (k: 'forced_dispatch' | 'pets_allowed' | 'riders_allowed', v?: boolean) => {
        if (typeof v === 'boolean' && next[k] === 'unspecified') {
          next[k] = v ? 'yes' : 'no';
        }
      };
      setStr('title', data.title);
      setStr('company_name', data.company_name);
      setStr('hiring_city', data.hiring_city);
      setStr('hiring_state', data.hiring_state);
      if (Array.isArray(data.hiring_states) && data.hiring_states.length && !next.hiring_states) {
        next.hiring_states = data.hiring_states.join(', ');
      }
      setStr('driver_type', data.driver_type);
      setStr('route_type', data.route_type);
      setStr('trailer_type', data.trailer_type);
      setStr('description', data.description);
      setStr('pay_model', data.pay_model);
      setNum('cpm', data.cpm);
      setNum('percentage_pay', data.percentage_pay);
      setNum('flat_weekly_pay', data.flat_weekly_pay);
      setNum('estimated_weekly_gross', data.estimated_weekly_gross);
      setNum('estimated_weekly_miles', data.estimated_weekly_miles);
      setNum('estimated_loaded_miles', data.estimated_loaded_miles);
      setNum('estimated_deadhead_miles', data.estimated_deadhead_miles);
      if (typeof data.deadhead_paid === 'boolean' && next.deadhead_paid === 'unspecified') {
        next.deadhead_paid = data.deadhead_paid ? 'paid' : 'unpaid';
      }
      setStr('detention_pay', data.detention_pay);
      setStr('layover_pay', data.layover_pay);
      setNum('sign_on_bonus', data.sign_on_bonus);
      setStr('fuel_paid_by', data.fuel_paid_by);
      setNum('insurance_deductions', data.insurance_deductions);
      if (typeof data.escrow_required === 'boolean') next.escrow_required = next.escrow_required || data.escrow_required;
      setNum('escrow_amount', data.escrow_amount);
      setNum('lease_payment', data.lease_payment);
      setNum('maintenance_deductions', data.maintenance_deductions);
      setNum('other_deductions', data.other_deductions);
      setStr('home_time', data.home_time);
      setTri('forced_dispatch', data.forced_dispatch);
      setTri('pets_allowed', data.pets_allowed);
      setTri('riders_allowed', data.riders_allowed);
      setStr('equipment_year', data.equipment_year);
      setStr('typical_lanes', data.typical_lanes);
      setStr('benefits', data.requirements ?? data.benefits);
      return next;
    });
  };


  return (
    <div className="animate-fade-in pb-32">
      {/* Header */}
      <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground mb-3"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Recruiter Access
          </button>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
            {initial ? 'Edit Trucking Opportunity' : 'Post a Trucking Opportunity'}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl mt-1">
            Create a structured opportunity that helps drivers understand pay, route, deadhead, deductions, and real earning potential.
          </p>
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPasteOpen(true)}
              disabled={pending}
            >
              <Sparkles className="h-4 w-4" /> Paste opportunity to auto-fill
            </Button>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" onClick={() => save('draft')} disabled={pending}>
            <Save className="h-4 w-4" /> Save Draft
          </Button>
          {isLastStep ? (
            <Button
              onClick={() => save('submit')}
              disabled={pending || !canSubmitForReview}
              title={submitBlockReason ?? undefined}
            >
              {!canSubmitForReview && <Lock className="h-4 w-4 mr-1" />}
              <Send className="h-4 w-4" /> Submit for Review
            </Button>
          ) : (
            <Button onClick={handleNext}>
              Save &amp; Continue <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <PasteOpportunityDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        onExtracted={handleExtracted}
      />


      {/* Step progress */}
      <StepProgress current={step} onStepClick={setStep} />

      {/* Main grid: form + sticky preview */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 mt-6">
        <div className="space-y-4 min-w-0">
          {STEPS.map((s) => {
            const isActive = step === s.id;
            if (!isActive) {
              return (
                <CollapsedSectionCard
                  key={s.id}
                  step={s}
                  onClick={() => setStep(s.id)}
                />
              );
            }
            return (
              <Card key={s.id} className="p-5 sm:p-6 border-border/60 bg-card/60 backdrop-blur">
                <div className="mb-5">
                  <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">
                    Section {s.id} of {STEPS.length}
                  </p>
                  <h2 className="text-xl sm:text-2xl font-black text-foreground mt-1">{s.title}</h2>
                  <p className="text-sm text-muted-foreground mt-1">{s.short}</p>
                </div>

                {s.id === 1 && <Step1 form={form} set={set} />}
                {s.id === 2 && <Step2 form={form} set={set} />}
                {s.id === 3 && <Step3 form={form} set={set} />}
                {s.id === 4 && <Step4 form={form} set={set} />}
                {s.id === 5 && (
                  <Step5
                    form={form}
                    set={set}
                    financials={financials}
                  />
                )}

                {/* Step nav */}
                <div className="mt-6 flex items-center justify-between gap-3 pt-5 border-t border-border/40">
                  <Button
                    variant="ghost"
                    onClick={() => setStep(Math.max(1, step - 1))}
                    disabled={step === 1}
                  >
                    <ArrowLeft className="h-4 w-4" /> Previous
                  </Button>
                  {isLastStep ? (
                    <Button
                      onClick={() => save('submit')}
                      disabled={pending || !canSubmitForReview}
                      title={submitBlockReason ?? undefined}
                    >
                      {!canSubmitForReview && <Lock className="h-4 w-4 mr-1" />}
                      <Send className="h-4 w-4" /> Submit for Review
                    </Button>
                  ) : (
                    <Button onClick={handleNext}>
                      Save &amp; Continue <ChevronRight className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}

          {/* Why transparency matters */}
          <Card className="p-4 border-border/60 bg-sky-500/5 border-sky-500/20">
            <div className="flex gap-3">
              <div className="rounded-lg bg-sky-500/15 text-sky-400 p-2 shrink-0 self-start">
                <Info className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">Why Transparency Matters</h4>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Drivers value honest, accurate information. Opportunities with complete pay, miles, and home time details receive more requests and higher quality applications.
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Sticky preview */}
        <aside className="lg:sticky lg:top-4 self-start space-y-4">
          <DriverPreviewPanel form={form} financials={financials} />
          <OpportunityStrengthPanel pct={strength.pct} label={strength.label} suggestions={strength.suggestions} />
          {!canSubmitForReview && submitBlockReason && (
            <Card className="p-4 border-border/60 bg-amber-500/5 border-amber-500/30">
              <div className="flex gap-2">
                <LockIcon className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">{submitBlockReason}</p>
              </div>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ================= Step Progress ================= */

function StepProgress({ current, onStepClick }: { current: number; onStepClick: (n: number) => void }) {
  return (
    <div className="relative">
      <div className="grid grid-cols-5 gap-2">
        {STEPS.map((s, i) => {
          const isActive = s.id === current;
          const isComplete = s.id < current;
          return (
            <button
              key={s.id}
              onClick={() => onStepClick(s.id)}
              className="group flex flex-col items-center text-center gap-2"
            >
              <div className="relative w-full flex items-center justify-center">
                {i > 0 && (
                  <span
                    className={`absolute left-0 right-1/2 top-1/2 -translate-y-1/2 h-px ${
                      isComplete || isActive ? 'bg-primary/60' : 'bg-border/60'
                    }`}
                  />
                )}
                {i < STEPS.length - 1 && (
                  <span
                    className={`absolute left-1/2 right-0 top-1/2 -translate-y-1/2 h-px ${
                      isComplete ? 'bg-primary/60' : 'bg-border/60'
                    }`}
                  />
                )}
                <span
                  className={`relative z-10 h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-primary'
                      : isComplete
                        ? 'bg-primary/20 text-primary border border-primary/40'
                        : 'bg-muted/30 text-muted-foreground border border-border/60'
                  }`}
                >
                  {isComplete ? <CheckCircle2 className="h-4 w-4" /> : s.id}
                </span>
              </div>
              <span
                className={`text-[11px] sm:text-xs font-semibold leading-tight ${
                  isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                }`}
              >
                {s.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CollapsedSectionCard({
  step, onClick,
}: { step: typeof STEPS[number]; onClick: () => void }) {
  const Icon = step.icon;
  return (
    <button
      onClick={onClick}
      className="w-full text-left group"
    >
      <Card className="p-4 sm:p-5 border-border/60 bg-card/40 hover:bg-card/70 hover:border-primary/40 transition-all">
        <div className="flex items-center gap-4">
          <div className={`rounded-xl p-2.5 ${step.tint} shrink-0`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">
              Section {step.id} of {STEPS.length}
            </p>
            <h3 className="text-base font-bold text-foreground truncate">{step.title}</h3>
            <p className="text-xs text-muted-foreground truncate">{step.short}</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary shrink-0" />
        </div>
      </Card>
    </button>
  );
}

/* ================= Step 1: Job Basics ================= */

function Step1({
  form, set,
}: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  return (
    <div className="space-y-5">
      <Field label="Opportunity Title" required count={`${form.title.length}/100`}>
        <Input
          value={form.title}
          onChange={(e) => set('title', e.target.value.slice(0, 100))}
          placeholder="Example: Regional Dry Van Driver Needed"
        />
      </Field>

      <Field label="Company Name" required helper="This will appear to drivers.">
        <Input
          value={form.company_name}
          onChange={(e) => set('company_name', e.target.value)}
          placeholder="ABC Logistics LLC"
        />
      </Field>

      <Field label="Hiring Type" required>
        <div className="flex flex-wrap gap-2">
          {HIRING_TYPES.map((h) => {
            const selected = form.driver_type === h.value;
            return (
              <button
                key={h.value}
                type="button"
                onClick={() => set('driver_type', h.value)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                  selected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-muted-foreground border-border/60 hover:border-primary/40 hover:text-foreground'
                }`}
              >
                {h.label}
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-4">
        <Field label="Route Type" required>
          <Select value={form.route_type || 'unset'} onValueChange={(v) => set('route_type', v === 'unset' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="Select route type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Not set</SelectItem>
              {ROUTE_TYPES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Hiring Location" required>
          <Input
            value={form.hiring_city}
            onChange={(e) => set('hiring_city', e.target.value)}
            placeholder="Dallas"
          />
        </Field>
        <Field label="State">
          <Select value={form.hiring_state || 'unset'} onValueChange={(v) => set('hiring_state', v === 'unset' ? '' : v)}>
            <SelectTrigger className="w-[100px]"><SelectValue placeholder="TX" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">—</SelectItem>
              {US_STATES.map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Hiring States" helper="Comma-separated (e.g. TX, OK, AR, LA)">
        <Input
          value={form.hiring_states}
          onChange={(e) => set('hiring_states', e.target.value)}
          placeholder="Select states you are hiring in"
        />
      </Field>

      <Field label="Short Opportunity Summary" required count={`${form.description.length}/500`}>
        <Textarea
          rows={4}
          value={form.description}
          onChange={(e) => set('description', e.target.value.slice(0, 500))}
          placeholder="Briefly describe the opportunity, lanes, and what drivers can expect."
        />
      </Field>
    </div>
  );
}

/* ================= Step 2: Route & Equipment ================= */

function Step2({
  form, set,
}: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  return (
    <div className="space-y-5">
      <Field label="Trailer Type" required>
        <div className="flex flex-wrap gap-2">
          {TRAILER_TYPES.map((t) => {
            const selected = form.trailer_type === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => set('trailer_type', t)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                  selected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-muted-foreground border-border/60 hover:border-primary/40 hover:text-foreground'
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Typical Lanes" helper={'One per line — example: "Dallas, TX → Houston, TX"'}>
        <Textarea
          rows={3}
          value={form.typical_lanes}
          onChange={(e) => set('typical_lanes', e.target.value)}
          placeholder={'Dallas, TX → Houston, TX\nMidwest → Southeast'}
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <NumField label="Estimated Weekly Miles" value={form.estimated_weekly_miles} onChange={(v) => set('estimated_weekly_miles', v)} />
        <NumField label="Loaded Miles" value={form.estimated_loaded_miles} onChange={(v) => set('estimated_loaded_miles', v)} />
        <NumField label="Deadhead Miles" value={form.estimated_deadhead_miles} onChange={(v) => set('estimated_deadhead_miles', v)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Deadhead Paid?">
          <Select value={form.deadhead_paid} onValueChange={(v) => set('deadhead_paid', v as DhOpt)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unspecified">Not Disclosed</SelectItem>
              <SelectItem value="paid">Yes</SelectItem>
              <SelectItem value="unpaid">No</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <TriField label="Forced Dispatch?" value={form.forced_dispatch} onChange={(v) => set('forced_dispatch', v)} />
        <TriField label="Pets Allowed?" value={form.pets_allowed} onChange={(v) => set('pets_allowed', v)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TriField label="Riders Allowed?" value={form.riders_allowed} onChange={(v) => set('riders_allowed', v)} />
        <Field label="Equipment Year / Truck Info">
          <Input
            value={form.equipment_year}
            onChange={(e) => set('equipment_year', e.target.value)}
            placeholder="Example: 2020–2024 Freightliner Cascadia"
          />
        </Field>
      </div>
    </div>
  );
}

/* ================= Step 3: Pay & Deductions ================= */

function Step3({
  form, set,
}: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  const showCpm = form.pay_model === 'cpm' || form.pay_model === 'mixed';
  const showPct = form.pay_model === 'percentage' || form.pay_model === 'mixed';
  const showFlat = form.pay_model === 'flat_weekly' || form.pay_model === 'salary' || form.pay_model === 'mixed';

  return (
    <div className="space-y-5">
      <Field label="Pay Model" required>
        <div className="flex flex-wrap gap-2">
          {PAY_MODELS.map((p) => {
            const selected = form.pay_model === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => set('pay_model', p.value)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                  selected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-muted-foreground border-border/60 hover:border-primary/40 hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
        <Field label="Fuel Paid By">
          <Select value={form.fuel_paid_by || 'unset'} onValueChange={(v) => set('fuel_paid_by', v === 'unset' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Not Disclosed</SelectItem>
              {FUEL_PAID_BY.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <NumField label="Sign-On Bonus ($)" value={form.sign_on_bonus} onChange={(v) => set('sign_on_bonus', v)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Detention Pay">
          <Input value={form.detention_pay} onChange={(e) => set('detention_pay', e.target.value)} placeholder="Example: $25/hr after 2 hrs" />
        </Field>
        <Field label="Layover Pay">
          <Input value={form.layover_pay} onChange={(e) => set('layover_pay', e.target.value)} placeholder="Example: $150/day" />
        </Field>
      </div>

      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Known Deductions</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <NumField label="Insurance Deduction" value={form.insurance_deductions} onChange={(v) => set('insurance_deductions', v)} />
          <NumField label="Escrow Amount" value={form.escrow_amount} onChange={(v) => set('escrow_amount', v)} />
          <NumField label="Lease Payment" value={form.lease_payment} onChange={(v) => set('lease_payment', v)} />
          <NumField label="Maintenance Deduction" value={form.maintenance_deductions} onChange={(v) => set('maintenance_deductions', v)} />
          <NumField label="Other Deductions" value={form.other_deductions} onChange={(v) => set('other_deductions', v)} />
          <Field label="Escrow Required?">
            <label className="flex items-center gap-2 pt-2">
              <Checkbox checked={form.escrow_required} onCheckedChange={(v) => set('escrow_required', !!v)} />
              <span className="text-sm">Yes, escrow required</span>
            </label>
          </Field>
        </div>
      </div>

      <Card className="p-4 border-primary/20 bg-primary/5">
        <div className="flex gap-3">
          <HelpCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            HaulTrackerPro uses these numbers to estimate gross, net, RPM, deadhead impact, deductions, and driver-facing Profit Intelligence. Be accurate. Misleading opportunities may be removed.
          </p>
        </div>
      </Card>
    </div>
  );
}

/* ================= Step 4: Home Time & Requirements ================= */

function Step4({
  form, set,
}: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  return (
    <div className="space-y-5">
      <Field label="Home Time">
        <Input
          value={form.home_time}
          onChange={(e) => set('home_time', e.target.value)}
          placeholder="Example: Home weekly, every 2 weeks, weekends home"
        />
      </Field>

      <Field label="Additional Requirements" helper="Experience, CDL class, endorsements, MVR/drug test, background — describe what you require.">
        <Textarea
          rows={5}
          value={form.benefits}
          onChange={(e) => set('benefits', e.target.value)}
          placeholder={'Example:\n• 1 year OTR experience\n• Class A CDL\n• Hazmat preferred\n• Clean MVR last 3 years'}
        />
      </Field>

      <Card className="p-3 border-border/60 bg-muted/20">
        <p className="text-[11px] text-muted-foreground">
          Tip: Adding clear requirements reduces unqualified driver requests and improves your response rate.
        </p>
      </Card>
    </div>
  );
}

/* ================= Step 5: Transparency Review ================= */

function Step5({
  form, set, financials,
}: {
  form: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  financials: ReturnType<typeof calculateOpportunityFinancials>;
}) {
  const warnings: string[] = [];
  if (financials.hasUnpaidDeadhead) warnings.push('Deadhead appears unpaid.');
  if (financials.hasUnknownDeadheadPay) warnings.push('Deadhead pay is not disclosed.');
  if (financials.hasLeaseRisk) warnings.push('Lease payment detected — drivers will see this.');
  if (financials.hasHighDeductionRisk) warnings.push('High deductions may significantly reduce take-home pay.');
  if (financials.missingPayData) warnings.push('Pay data is incomplete.');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4 border-border/60">
          <h4 className="text-xs uppercase tracking-wider font-bold text-muted-foreground mb-3">Opportunity Summary</h4>
          <ReviewRow label="Title" value={form.title || '—'} />
          <ReviewRow label="Company" value={form.company_name || '—'} />
          <ReviewRow label="Route Type" value={form.route_type || '—'} />
          <ReviewRow label="Trailer Type" value={form.trailer_type || '—'} />
          <ReviewRow label="Hiring Location" value={[form.hiring_city, form.hiring_state].filter(Boolean).join(', ') || '—'} />
          <ReviewRow label="Hiring States" value={form.hiring_states || '—'} />
        </Card>
        <Card className="p-4 border-border/60">
          <h4 className="text-xs uppercase tracking-wider font-bold text-muted-foreground mb-3">Pay Preview</h4>
          <ReviewRow label="Est. Weekly Gross" value={fmtUsd(financials.estimatedGross)} />
          <ReviewRow label="Est. Weekly Net" value={fmtUsd(financials.estimatedNet)} />
          <ReviewRow label="Effective RPM" value={financials.effectiveRpm != null ? `$${financials.effectiveRpm.toFixed(2)}` : '—'} />
          <ReviewRow label="Net RPM" value={financials.netRpm != null ? `$${financials.netRpm.toFixed(2)}` : '—'} />
          <ReviewRow label="Deadhead %" value={financials.deadheadPercentage != null ? `${financials.deadheadPercentage.toFixed(1)}%` : '—'} />
          <ReviewRow label="Known Deductions" value={fmtUsd(financials.totalKnownDeductions)} />
        </Card>
      </div>

      {warnings.length > 0 && (
        <Card className="p-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h4 className="text-sm font-bold text-foreground">Transparency Warnings</h4>
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-5">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </Card>
      )}

      <Card className="p-4 border-border/60 space-y-3">
        <h4 className="text-sm font-bold text-foreground">Recruiter Confirmation</h4>
        <ConfirmCheck
          checked={form.transparency_confirmed}
          onChange={(v) => set('transparency_confirmed', v)}
          label="I confirm this opportunity information is accurate."
        />
        <ConfirmCheck
          checked={form.confirm_misleading_removed}
          onChange={(v) => set('confirm_misleading_removed', v)}
          label="I understand misleading opportunities may be removed."
        />
        <ConfirmCheck
          checked={form.confirm_drivers_see_intel}
          onChange={(v) => set('confirm_drivers_see_intel', v)}
          label="I understand drivers will see estimated Profit Intelligence based on the information provided."
        />
      </Card>
    </div>
  );
}

function ConfirmCheck({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} className="mt-0.5" />
      <span className="text-sm text-foreground leading-snug">{label}</span>
    </label>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold text-foreground truncate max-w-[60%] text-right">{value}</span>
    </div>
  );
}

/* ================= Driver Preview Panel ================= */

function DriverPreviewPanel({
  form, financials,
}: { form: FormState; financials: ReturnType<typeof calculateOpportunityFinancials> }) {
  const lane = form.hiring_city && form.hiring_state ? `${form.hiring_city}, ${form.hiring_state}` : '—';
  const states = form.hiring_states ? form.hiring_states : '—';
  const scoreInfo = profitScoreLabel(financials.profitScore);
  const toneMap: Record<typeof scoreInfo.tone, string> = {
    success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    primary: 'bg-primary/15 text-primary border-primary/30',
    warn: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    destructive: 'bg-red-500/15 text-red-400 border-red-500/30',
  };

  return (
    <Card className="p-4 border-border/60 bg-card/60 backdrop-blur">
      <div className="flex items-center gap-2 mb-1">
        <Eye className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Driver Preview</h3>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">
        This is how drivers will see your opportunity.
      </p>

      <div className="rounded-xl border border-border/60 bg-background/40 p-4">
        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">
          New Opportunity
        </Badge>
        <h4 className="text-base font-black text-foreground mt-2 truncate">
          {form.title || 'Untitled Opportunity'}
        </h4>
        <p className="text-xs text-muted-foreground">{form.company_name || 'Your Company'}</p>

        <div className="flex flex-wrap gap-1.5 mt-2">
          {form.route_type && <Badge variant="outline" className="text-[10px]">{form.route_type}</Badge>}
          {form.trailer_type && <Badge variant="outline" className="text-[10px]">{form.trailer_type}</Badge>}
          {form.driver_type && (
            <Badge variant="outline" className="text-[10px] capitalize">
              {HIRING_TYPES.find((h) => h.value === form.driver_type)?.label ?? form.driver_type}
            </Badge>
          )}
        </div>

        <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3 w-3" /> {lane}
          </div>
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3 w-3" /> Hiring in: {states}
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-border/30">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Earnings Preview</p>
          <PreviewRow label="Est. Weekly Gross" value={fmtUsd(financials.estimatedGross)} tone="success" />
          <PreviewRow label="Est. Weekly Net" value={fmtUsd(financials.estimatedNet)} tone="success" />
          <PreviewRow label="Est. Weekly Miles" value={financials.estimatedWeeklyMiles?.toLocaleString() ?? '—'} />
          <PreviewRow label="Est. Deadhead" value={financials.estimatedDeadheadMiles != null ? `${financials.estimatedDeadheadMiles} mi` : '—'} />
          <PreviewRow label="Effective RPM" value={financials.effectiveRpm != null ? `$${financials.effectiveRpm.toFixed(2)}` : '—'} />
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-muted-foreground">Profit Score</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${toneMap[scoreInfo.tone]}`}>
              {scoreInfo.label}
            </span>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-border/30">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">What Drivers Will See</p>
          <ul className="text-[11px] text-muted-foreground space-y-1">
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> Pay &amp; Deductions</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> Route &amp; Deadhead</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> Home Time</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> Requirements</li>
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> Company Info</li>
          </ul>
          <div className="mt-3 rounded-md bg-muted/20 border border-border/40 px-2.5 py-2 flex items-center gap-2">
            <LockIcon className="h-3 w-3 text-muted-foreground shrink-0" />
            <p className="text-[10px] text-muted-foreground">Contact info shared after approved request.</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

function PreviewRow({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-bold ${tone === 'success' ? 'text-emerald-400' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}

function OpportunityStrengthPanel({ pct, label, suggestions }: { pct: number; label: string; suggestions: string[] }) {
  return (
    <Card className="p-4 border-border/60 bg-card/60 backdrop-blur">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-foreground">Opportunity Strength</h3>
        <span className="text-sm font-black text-primary">{pct}%</span>
      </div>
      <Progress value={pct} className="h-2 mb-2" />
      <p className="text-[11px] text-muted-foreground mb-3">
        {pct >= 80
          ? 'Great job! Your opportunity is very transparent.'
          : pct >= 60
            ? 'Good — adding more detail will improve driver response.'
            : pct >= 40
              ? 'Needs more detail to attract qualified drivers.'
              : 'Incomplete — fill in more sections to publish a strong opportunity.'}
      </p>
      {suggestions.length > 0 && (
        <>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">
            Suggestions to Improve
          </p>
          <ul className="space-y-1 text-[11px] text-muted-foreground list-disc pl-4">
            {suggestions.slice(0, 4).map((s) => <li key={s}>{s}</li>)}
          </ul>
        </>
      )}
      <p className="text-[10px] text-muted-foreground/70 mt-3">Status: <span className="font-semibold text-foreground">{label}</span></p>
    </Card>
  );
}

/* ================= Field primitives ================= */

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
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/**
 * Specialized CPM input with a $ adornment, a helper showing the expected
 * format ("$/mile — example: 0.65"), a live "≈ $X/week at Y miles" hint
 * using the recruiter's own weekly-miles input, and a sanity warning if the
 * value looks like cents instead of dollars (e.g. 65 instead of 0.65).
 */
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
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="unspecified">Not disclosed</SelectItem>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

function fmtUsd(n: number | null): string {
  if (n == null) return '—';
  return `$${Math.round(n).toLocaleString()}`;
}
