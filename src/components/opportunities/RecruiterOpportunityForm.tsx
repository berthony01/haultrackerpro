import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Briefcase, DollarSign, Gift, Wallet, Home, ShieldCheck, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  useRecruiterOpportunities,
  type Opportunity,
  type OpportunityInsert,
} from '@/hooks/opportunities/useRecruiterOpportunities';

interface Props {
  initial?: Opportunity | null;
  onBack: () => void;
  onSaved: () => void;
}

const PAY_MODELS = ['cpm', 'percentage', 'flat_weekly', 'mixed'];
const DEADHEAD_OPTIONS = ['unspecified', 'paid', 'unpaid'] as const;
const TRIBOOL_OPTIONS = ['unspecified', 'yes', 'no'] as const;

type Tribool = (typeof TRIBOOL_OPTIONS)[number];
type DhOpt = (typeof DEADHEAD_OPTIONS)[number];

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
  // extra
  detention_pay: string;
  layover_pay: string;
  sign_on_bonus: string;
  // deductions
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
  benefits: string;
  description: string;
  // confirm
  transparency_confirmed: boolean;
}

const EMPTY: FormState = {
  title: '', company_name: '', hiring_city: '', hiring_state: '', hiring_states: '',
  driver_type: '', route_type: '', trailer_type: '',
  pay_model: '', cpm: '', percentage_pay: '', flat_weekly_pay: '',
  estimated_weekly_gross: '', estimated_weekly_miles: '',
  estimated_loaded_miles: '', estimated_deadhead_miles: '',
  deadhead_paid: 'unspecified',
  detention_pay: '', layover_pay: '', sign_on_bonus: '',
  fuel_paid_by: '', insurance_deductions: '', escrow_required: false, escrow_amount: '',
  lease_payment: '', maintenance_deductions: '', other_deductions: '',
  home_time: '', forced_dispatch: 'unspecified', pets_allowed: 'unspecified',
  riders_allowed: 'unspecified', equipment_year: '', benefits: '', description: '',
  transparency_confirmed: false,
};

const numOrNull = (v: string): number | null => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n;
};

const triToBool = (v: Tribool): boolean | null =>
  v === 'yes' ? true : v === 'no' ? false : null;
const dhToBool = (v: DhOpt): boolean | null =>
  v === 'paid' ? true : v === 'unpaid' ? false : null;
const boolToTri = (b: boolean | null | undefined): Tribool =>
  b === true ? 'yes' : b === false ? 'no' : 'unspecified';
const boolToDh = (b: boolean | null | undefined): DhOpt =>
  b === true ? 'paid' : b === false ? 'unpaid' : 'unspecified';
const splitList = (s: string) => s.split(',').map((p) => p.trim()).filter(Boolean);

export function RecruiterOpportunityForm({ initial, onBack, onSaved }: Props) {
  const { createOpportunity, updateOpportunity } = useRecruiterOpportunities();
  const [form, setForm] = useState<FormState>(EMPTY);

  useEffect(() => {
    if (!initial) return;
    setForm({
      title: initial.title ?? '',
      company_name: initial.company_name ?? '',
      hiring_city: initial.hiring_city ?? '',
      hiring_state: initial.hiring_state ?? '',
      hiring_states: (initial.hiring_states ?? []).join(', '),
      driver_type: initial.driver_type ?? '',
      route_type: initial.route_type ?? '',
      trailer_type: initial.trailer_type ?? '',
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
      benefits: initial.benefits ?? '',
      description: initial.description ?? '',
      transparency_confirmed: !!initial.transparency_confirmed,
    });
  }, [initial]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const numericFields = useMemo<(keyof FormState)[]>(
    () => [
      'cpm','percentage_pay','flat_weekly_pay','estimated_weekly_gross',
      'estimated_weekly_miles','estimated_loaded_miles','estimated_deadhead_miles',
      'sign_on_bonus','insurance_deductions','escrow_amount','lease_payment',
      'maintenance_deductions','other_deductions',
    ],
    []
  );

  const validate = (mode: 'draft' | 'submit'): string | null => {
    if (!form.title.trim()) return 'Title is required.';
    if (!form.company_name.trim()) return 'Company name is required.';

    for (const k of numericFields) {
      const v = form[k] as string;
      if (v !== '' && (Number.isNaN(Number(v)) || Number(v) < 0)) {
        return `${k.replace(/_/g, ' ')} cannot be negative.`;
      }
    }

    if (mode === 'submit') {
      if (!form.driver_type.trim()) return 'Driver type is required.';
      if (!form.route_type.trim()) return 'Route type is required.';
      if (!form.trailer_type.trim()) return 'Trailer type is required.';
      if (!form.pay_model.trim()) return 'Pay model is required.';
      const hasPay =
        !!numOrNull(form.estimated_weekly_gross) ||
        !!numOrNull(form.cpm) ||
        !!numOrNull(form.flat_weekly_pay) ||
        !!numOrNull(form.percentage_pay);
      if (!hasPay) return 'Provide at least one pay value (weekly gross, CPM, flat weekly, or percentage).';
      if (!form.transparency_confirmed) return 'Please confirm transparency to submit.';
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
    benefits: form.benefits.trim() || null,
    description: form.description.trim() || null,
    transparency_confirmed: mode === 'submit',
    status: mode === 'submit' ? 'active' : 'draft',
  });

  const save = (mode: 'draft' | 'submit') => {
    const err = validate(mode);
    if (err) {
      toast.error(err);
      return;
    }
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

  return (
    <div className="space-y-6 animate-fade-in pb-32">
      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="rounded-2xl bg-primary p-3 shadow-primary shrink-0">
            <Briefcase className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1">
              {initial ? 'Edit Opportunity' : 'New Opportunity'}
            </h1>
            <p className="text-sm text-muted-foreground">
              Profit-first listings build trust. Be transparent on pay, miles, and deductions.
            </p>
          </div>
        </div>
      </Card>

      <Section icon={Briefcase} title="Basic Details">
        <Field label="Title *">
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Company Name *">
          <Input value={form.company_name} onChange={(e) => set('company_name', e.target.value)} />
        </Field>
        <Field label="Driver Type">
          <Input placeholder="Company / OO / Lease" value={form.driver_type} onChange={(e) => set('driver_type', e.target.value)} />
        </Field>
        <Field label="Route Type">
          <Input placeholder="OTR / Regional / Local" value={form.route_type} onChange={(e) => set('route_type', e.target.value)} />
        </Field>
        <Field label="Trailer Type">
          <Input placeholder="Dry Van / Reefer / Flatbed" value={form.trailer_type} onChange={(e) => set('trailer_type', e.target.value)} />
        </Field>
        <Field label="Hiring City">
          <Input value={form.hiring_city} onChange={(e) => set('hiring_city', e.target.value)} />
        </Field>
        <Field label="Hiring State">
          <Input value={form.hiring_state} onChange={(e) => set('hiring_state', e.target.value)} />
        </Field>
        <Field label="Hiring States (comma separated)" full>
          <Input placeholder="TX, OK, AR" value={form.hiring_states} onChange={(e) => set('hiring_states', e.target.value)} />
        </Field>
      </Section>

      <Section icon={DollarSign} title="Pay Details">
        <div className="col-span-full rounded-lg bg-primary/5 border border-primary/20 p-3 text-xs text-muted-foreground">
          HaulTrackerPro uses these numbers to estimate gross, net, RPM, and driver-facing profit clarity. Be accurate. Misleading opportunities may be removed.
        </div>
        <Field label="Pay Model">
          <Select value={form.pay_model || 'unset'} onValueChange={(v) => set('pay_model', v === 'unset' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Not set</SelectItem>
              {PAY_MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <NumField label="CPM ($/mi)" value={form.cpm} onChange={(v) => set('cpm', v)} />
        <NumField label="Percentage Pay (%)" value={form.percentage_pay} onChange={(v) => set('percentage_pay', v)} />
        <NumField label="Flat Weekly Pay ($)" value={form.flat_weekly_pay} onChange={(v) => set('flat_weekly_pay', v)} />
        <NumField label="Est. Weekly Gross ($)" value={form.estimated_weekly_gross} onChange={(v) => set('estimated_weekly_gross', v)} />
        <NumField label="Est. Weekly Miles" value={form.estimated_weekly_miles} onChange={(v) => set('estimated_weekly_miles', v)} />
        <NumField label="Est. Loaded Miles" value={form.estimated_loaded_miles} onChange={(v) => set('estimated_loaded_miles', v)} />
        <NumField label="Est. Deadhead Miles" value={form.estimated_deadhead_miles} onChange={(v) => set('estimated_deadhead_miles', v)} />
        <Field label="Deadhead Paid?">
          <Select value={form.deadhead_paid} onValueChange={(v) => set('deadhead_paid', v as DhOpt)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unspecified">Not disclosed</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="unpaid">Unpaid</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </Section>

      <Section icon={Gift} title="Extra Pay">
        <Field label="Detention Pay">
          <Input value={form.detention_pay} onChange={(e) => set('detention_pay', e.target.value)} />
        </Field>
        <Field label="Layover Pay">
          <Input value={form.layover_pay} onChange={(e) => set('layover_pay', e.target.value)} />
        </Field>
        <NumField label="Sign-On Bonus ($)" value={form.sign_on_bonus} onChange={(v) => set('sign_on_bonus', v)} />
      </Section>

      <Section icon={Wallet} title="Deductions / Costs">
        <div className="col-span-full rounded-lg bg-primary/5 border border-primary/20 p-3 text-xs text-muted-foreground">
          Deductions feed driver-facing net pay and Profit Clarity score. Accurate disclosure builds trust.
        </div>
        <Field label="Fuel Paid By">
          <Input placeholder="Carrier / Driver / Split" value={form.fuel_paid_by} onChange={(e) => set('fuel_paid_by', e.target.value)} />
        </Field>
        <NumField label="Insurance Deductions" value={form.insurance_deductions} onChange={(v) => set('insurance_deductions', v)} />
        <Field label="Escrow Required?">
          <label className="flex items-center gap-2 pt-2">
            <Checkbox checked={form.escrow_required} onCheckedChange={(v) => set('escrow_required', !!v)} />
            <span className="text-sm">Yes, escrow required</span>
          </label>
        </Field>
        <NumField label="Escrow Amount" value={form.escrow_amount} onChange={(v) => set('escrow_amount', v)} />
        <NumField label="Lease Payment" value={form.lease_payment} onChange={(v) => set('lease_payment', v)} />
        <NumField label="Maintenance Deductions" value={form.maintenance_deductions} onChange={(v) => set('maintenance_deductions', v)} />
        <NumField label="Other Deductions" value={form.other_deductions} onChange={(v) => set('other_deductions', v)} />
      </Section>

      <Section icon={Home} title="Lifestyle / Job Conditions">
        <Field label="Home Time">
          <Input placeholder="Weekly / Bi-weekly / 7 on 7 off" value={form.home_time} onChange={(e) => set('home_time', e.target.value)} />
        </Field>
        <TriField label="Forced Dispatch" value={form.forced_dispatch} onChange={(v) => set('forced_dispatch', v)} />
        <TriField label="Pets Allowed" value={form.pets_allowed} onChange={(v) => set('pets_allowed', v)} />
        <TriField label="Riders Allowed" value={form.riders_allowed} onChange={(v) => set('riders_allowed', v)} />
        <Field label="Equipment Year">
          <Input value={form.equipment_year} onChange={(e) => set('equipment_year', e.target.value)} />
        </Field>
        <Field label="Benefits" full>
          <Textarea rows={3} value={form.benefits} onChange={(e) => set('benefits', e.target.value)} />
        </Field>
        <Field label="Description" full>
          <Textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
      </Section>

      <Card className="p-5 border-border/60">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Transparency</h3>
        </div>
        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            checked={form.transparency_confirmed}
            onCheckedChange={(v) => set('transparency_confirmed', !!v)}
            className="mt-0.5"
          />
          <span className="text-sm text-foreground">
            I confirm this information is accurate and understand misleading opportunities may be removed.
          </span>
        </label>
      </Card>

      {/* Sticky save */}
      <div className="fixed bottom-20 lg:bottom-6 inset-x-0 z-30 px-4">
        <div className="max-w-4xl mx-auto">
          <Card className="p-3 border-border/60 bg-card/95 backdrop-blur shadow-lg flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground hidden sm:block">
              Drafts stay private. Submit for Review to publish after admin approval.
            </p>
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" onClick={() => save('draft')} disabled={pending}>
                <Save className="h-4 w-4" /> Save Draft
              </Button>
              <Button onClick={() => save('submit')} disabled={pending}>
                Submit for Review
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon: Icon, title, children,
}: { icon: typeof Briefcase; title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 border-border/60">
      <div className="flex items-center gap-2 mb-4">
        <div className="rounded-lg bg-primary/10 p-1.5">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">{title}</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
    </Card>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? 'sm:col-span-2 space-y-1.5' : 'space-y-1.5'}>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</Label>
      {children}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <Input type="number" inputMode="decimal" min={0} value={value} onChange={(e) => onChange(e.target.value)} />
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
