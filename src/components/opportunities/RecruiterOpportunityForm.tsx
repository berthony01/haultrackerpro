// Phase 1L-DE1 — Canonical recruiter opportunity authoring form.
//
// Six-section responsive authoring page bound to the canonical authoring
// state, using the Phase 1L-C canonical calculator and the shared
// publication-readiness validator. Legacy multi-page wizard, giant
// generic "Optional details" accordion, and misleading Profit Intelligence
// copy have been removed.

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
  ArrowLeft, Save, Send, Sparkles, Plus, Trash2, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useRecruiterOpportunities,
  type Opportunity,
} from '@/hooks/opportunities/useRecruiterOpportunities';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import {
  buildOpportunityPersistencePayload,
  EMPTY_AUTHORING_STATE,
  normalizeOpportunityForAuthoring,
  projectLegacyDriverType,
  projectLegacyPayModel,
  ROUTE_TYPE_VALUES,
  TRAILER_TYPE_VALUES,
  validateOpportunityReadiness,
  type CanonicalAuthoringMixedComponent,
  type CanonicalEmploymentModel,
  type CanonicalOpportunityAuthoringState,
  type CanonicalPayModel,
  type CanonicalTeamConfiguration,
  type EscrowRequiredState,
  type RecurringFrequency,
  type YesNoUnknown,
} from '@/lib/opportunities/opportunityCanonical';
import { PasteOpportunityDialog, type ExtractedOpportunity } from './PasteOpportunityDialog';

interface Props {
  initial?: Opportunity | null;
  onBack: () => void;
  onSaved: () => void;
}

const EMPLOYMENT_OPTIONS: Array<{ value: CanonicalEmploymentModel; label: string }> = [
  { value: 'company_driver', label: 'W-2 Company Driver' },
  { value: 'contractor_1099', label: '1099 Contractor' },
  { value: 'owner_operator', label: 'Owner-Operator' },
  { value: 'lease_purchase', label: 'Lease Purchase' },
];
const TEAM_OPTIONS: Array<{ value: CanonicalTeamConfiguration; label: string }> = [
  { value: 'solo', label: 'Solo' },
  { value: 'team', label: 'Team' },
  { value: 'solo_or_team', label: 'Solo or Team' },
];
const PAY_OPTIONS: Array<{ value: CanonicalPayModel; label: string }> = [
  { value: 'cpm', label: 'CPM' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'flat_weekly', label: 'Flat Weekly' },
  { value: 'salary', label: 'Salary' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'other', label: 'Other' },
];
const FREQ_OPTIONS: Array<{ value: RecurringFrequency; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
];
const FUEL_PAID_BY = ['Company', 'Driver', 'Split', 'Not Disclosed'];

type State = CanonicalOpportunityAuthoringState;

/* ---------------- helpers to derive state changes ---------------- */

function applyEmploymentChange(state: State, next: CanonicalEmploymentModel): State {
  const isCompany = next === 'company_driver';
  const isCostBearing = next === 'contractor_1099' || next === 'owner_operator' || next === 'lease_purchase';
  const leaseRelevant = next === 'lease_purchase';
  return {
    ...state,
    employment_model: next,
    legacy_team_row: false,
    fuel_paid_by: isCompany ? '' : state.fuel_paid_by,
    insurance_amount: isCostBearing ? state.insurance_amount : '',
    insurance_frequency: isCostBearing ? state.insurance_frequency : null,
    maintenance_amount: isCostBearing ? state.maintenance_amount : '',
    maintenance_frequency: isCostBearing ? state.maintenance_frequency : null,
    other_cost_amount: isCostBearing ? state.other_cost_amount : '',
    other_cost_frequency: isCostBearing ? state.other_cost_frequency : null,
    escrow_required_state: isCostBearing ? state.escrow_required_state : 'unspecified',
    escrow_amount: isCostBearing ? state.escrow_amount : '',
    escrow_frequency: isCostBearing ? state.escrow_frequency : null,
    lease_amount: leaseRelevant ? state.lease_amount : '',
    lease_frequency: leaseRelevant ? state.lease_frequency : null,
  };
}

function applyPayModelChange(state: State, next: CanonicalPayModel): State {
  return {
    ...state,
    pay_model: next,
    cpm: next === 'cpm' ? state.cpm : '',
    percentage_rate: next === 'percentage' ? state.percentage_rate : '',
    percentage_basis_label: next === 'percentage' ? state.percentage_basis_label : '',
    percentage_weekly_revenue_basis: next === 'percentage' ? state.percentage_weekly_revenue_basis : '',
    flat_weekly_pay: next === 'flat_weekly' ? state.flat_weekly_pay : '',
    salary_amount: next === 'salary' ? state.salary_amount : '',
    salary_frequency: next === 'salary' ? state.salary_frequency : null,
    mixed_pay_components: next === 'mixed' ? state.mixed_pay_components : [],
    other_pay_method_label: next === 'other' ? state.other_pay_method_label : '',
    other_weekly_gross: next === 'other' ? state.other_weekly_gross : '',
  };
}

/* ---------------- paste merge ---------------- */

function mergePasteIntoState(current: State, data: ExtractedOpportunity): State {
  const next = { ...current };
  const strFill = (key: keyof State, value?: string) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const cur = next[key];
    if (typeof cur === 'string' && !cur.trim()) (next[key] as string) = value;
  };
  const numFill = (key: keyof State, value?: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    if (next[key] === '') (next[key] as string) = String(value);
  };

  strFill('title', data.title);
  strFill('company_name', data.company_name);
  strFill('hiring_city', data.hiring_city);
  strFill('hiring_state', data.hiring_state);
  strFill('description', data.description);
  strFill('detention_pay', data.detention_pay);
  strFill('layover_pay', data.layover_pay);
  strFill('home_time', data.home_time);
  strFill('equipment_year', data.equipment_year);
  strFill('fuel_paid_by', data.fuel_paid_by);
  strFill('typical_lanes', data.typical_lanes);
  const requirements = data.requirements?.trim() ? data.requirements : data.benefits?.trim() ? data.benefits : undefined;
  strFill('requirements', requirements);

  if (Array.isArray(data.hiring_states) && data.hiring_states.length && next.hiring_states.length === 0) {
    next.hiring_states = [...data.hiring_states];
  }

  // Legacy driver_type → canonical employment/team via shared projection.
  // Employment and team configuration are projected independently and never
  // overwrite a resolved recruiter selection.
  if (data.driver_type) {
    const proj = projectLegacyDriverType(data.driver_type);
    if (next.employment_model === 'unknown' && proj.employment_model !== 'unknown') {
      next.employment_model = proj.employment_model;
    }
    if (next.team_configuration === 'unspecified' && proj.team_configuration !== 'unspecified') {
      next.team_configuration = proj.team_configuration;
    }
  }
  if (data.route_type && !next.route_type) next.route_type = data.route_type;
  if (data.trailer_type && !next.trailer_type) next.trailer_type = data.trailer_type;

  if (data.pay_model && next.pay_model === 'unknown') {
    const pm = projectLegacyPayModel(data.pay_model);
    if (pm !== 'unknown') next.pay_model = pm;
  }

  numFill('cpm', data.cpm);
  numFill('percentage_rate', data.percentage_pay);
  numFill('flat_weekly_pay', data.flat_weekly_pay);
  numFill('recruiter_provided_weekly_gross', data.estimated_weekly_gross);
  numFill('estimated_weekly_miles', data.estimated_weekly_miles);
  numFill('estimated_loaded_miles', data.estimated_loaded_miles);
  numFill('estimated_deadhead_miles', data.estimated_deadhead_miles);
  numFill('sign_on_bonus', data.sign_on_bonus);
  numFill('insurance_amount', data.insurance_deductions);
  numFill('escrow_amount', data.escrow_amount);
  numFill('lease_amount', data.lease_payment);
  numFill('maintenance_amount', data.maintenance_deductions);
  numFill('other_cost_amount', data.other_deductions);

  if (typeof data.deadhead_paid === 'boolean' && next.deadhead_paid === 'unknown') {
    next.deadhead_paid = data.deadhead_paid ? 'yes' : 'no';
  }
  if (typeof data.forced_dispatch === 'boolean' && next.forced_dispatch === 'unknown') {
    next.forced_dispatch = data.forced_dispatch ? 'yes' : 'no';
  }
  if (typeof data.pets_allowed === 'boolean' && next.pets_allowed === 'unknown') {
    next.pets_allowed = data.pets_allowed ? 'yes' : 'no';
  }
  if (typeof data.riders_allowed === 'boolean' && next.riders_allowed === 'unknown') {
    next.riders_allowed = data.riders_allowed ? 'yes' : 'no';
  }
  if (data.escrow_required === true && next.escrow_required_state === 'unspecified') {
    next.escrow_required_state = 'required';
  }

  return next;
}

/* ---------------- form ---------------- */

export function RecruiterOpportunityForm({ initial, onBack, onSaved }: Props) {
  const { createOpportunity, updateOpportunity } = useRecruiterOpportunities();
  const { profile } = useRecruiterProfile();
  const [state, setState] = useState<State>(() =>
    initial ? normalizeOpportunityForAuthoring(initial) : { ...EMPTY_AUTHORING_STATE },
  );
  const [pasteOpen, setPasteOpen] = useState(false);
  const hydratedRef = useRef(!!initial);

  useEffect(() => {
    if (initial && !hydratedRef.current) {
      setState(normalizeOpportunityForAuthoring(initial));
      hydratedRef.current = true;
      return;
    }
    if (!initial && profile?.company_name) {
      setState((cur) => cur.company_name ? cur : { ...cur, company_name: profile.company_name ?? '' });
    }
  }, [initial, profile]);

  const set = <K extends keyof State>(k: K, v: State[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const readiness = useMemo(() => validateOpportunityReadiness(state), [state]);
  const pending = createOpportunity.isPending || updateOpportunity.isPending;

  const save = (mode: 'draft' | 'publish') => {
    if (mode === 'draft' && !readiness.canSaveDraft) {
      const msg = readiness.blockingReasons[0] ?? 'Fix the highlighted issues before saving.';
      toast.error(msg);
      return;
    }
    if (mode === 'publish' && !readiness.canPublish) {
      const msg = readiness.blockingReasons[0] ?? 'Fix the highlighted issues before publishing.';
      toast.error(msg);
      return;
    }
    const payload = buildOpportunityPersistencePayload(state, mode);
    const onSuccess = () => {
      toast.success(mode === 'publish' ? 'Opportunity published — live to drivers now' : 'Draft saved');
      onSaved();
    };
    const onError = (e: Error) => toast.error(e.message);
    if (initial?.id) {
      updateOpportunity.mutate({ id: initial.id, data: payload }, { onSuccess, onError });
    } else {
      createOpportunity.mutate(payload, { onSuccess, onError });
    }
  };

  const handleExtracted = (data: ExtractedOpportunity) => {
    setState((cur) => mergePasteIntoState(cur, data));
  };

  const em = state.employment_model;
  const isCompany = em === 'company_driver';
  const isCostBearing = em === 'contractor_1099' || em === 'owner_operator' || em === 'lease_purchase';
  const leaseRelevant = em === 'lease_purchase';

  return (
    <div className="animate-fade-in pb-16 space-y-5" data-testid="recruiter-opportunity-form">
      {/* Header */}
      <div className="flex flex-col gap-3 mb-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground self-start"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
              {initial ? 'Edit Opportunity' : 'Post Opportunity'}
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl mt-1">
              Required details adapt to the selected employment arrangement and pay model. Review the
              live calculation before publishing.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => setPasteOpen(true)}
            disabled={pending}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Sparkles className="h-4 w-4" /> Paste to auto-fill
          </Button>
        </div>
      </div>

      <PasteOpportunityDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        onExtracted={handleExtracted}
      />

      {/* Section 1 — Opportunity Basics */}
      <Card className="p-5 sm:p-6 border-border/60 space-y-5" data-testid="section-basics">
        <SectionHeader n={1} title="Opportunity Basics" subtitle="Title, company, and how this role is classified." />
        <Field label="Opportunity Title" required>
          <Input value={state.title} onChange={(e) => set('title', e.target.value.slice(0, 100))}
            placeholder="Regional Dry Van Driver" aria-label="Opportunity Title" />
        </Field>
        <Field label="Company Name" required>
          <Input value={state.company_name} onChange={(e) => set('company_name', e.target.value)}
            placeholder="ABC Logistics LLC" aria-label="Company Name" />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Employment Arrangement" required>
            <ChipRow<CanonicalEmploymentModel>
              value={state.employment_model === 'unknown' ? null : state.employment_model}
              options={EMPLOYMENT_OPTIONS}
              onChange={(v) => setState((s) => applyEmploymentChange(s, v))}
              testId="employment-arrangement"
            />
          </Field>
          <Field label="Driving Configuration" required>
            <ChipRow<CanonicalTeamConfiguration>
              value={state.team_configuration === 'unspecified' ? null : state.team_configuration}
              options={TEAM_OPTIONS}
              onChange={(v) => set('team_configuration', v)}
              testId="driving-configuration"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Route Type" required>
            <SelectField
              ariaLabel="Route Type"
              value={state.route_type}
              options={ROUTE_TYPE_VALUES as readonly string[]}
              onChange={(v) => set('route_type', v)}
            />
          </Field>
          <Field label="Trailer Type" required>
            <SelectField
              ariaLabel="Trailer Type"
              value={state.trailer_type}
              options={TRAILER_TYPE_VALUES as readonly string[]}
              onChange={(v) => set('trailer_type', v)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-4">
          <Field label="Hiring City">
            <Input value={state.hiring_city} onChange={(e) => set('hiring_city', e.target.value)}
              placeholder="Dallas" aria-label="Hiring City" />
          </Field>
          <Field label="Hiring State">
            <Input value={state.hiring_state} onChange={(e) => set('hiring_state', e.target.value.toUpperCase().slice(0, 2))}
              placeholder="TX" aria-label="Hiring State" />
          </Field>
        </div>
        <Field label="Additional Hiring States" helper="Comma-separated (TX, OK, AR)">
          <Input
            value={state.hiring_states.join(', ')}
            onChange={(e) => set('hiring_states',
              e.target.value.split(',').map((v) => v.trim().toUpperCase()).filter(Boolean))}
            aria-label="Additional Hiring States"
          />
        </Field>
      </Card>

      {/* Section 2 — Compensation */}
      <Card className="p-5 sm:p-6 border-border/60 space-y-5" data-testid="section-compensation">
        <SectionHeader n={2} title="Compensation" subtitle="Pick a pay model — only relevant fields appear." />
        <Field label="Pay Model" required>
          <ChipRow<CanonicalPayModel>
            value={state.pay_model === 'unknown' ? null : state.pay_model}
            options={PAY_OPTIONS}
            onChange={(v) => setState((s) => applyPayModelChange(s, v))}
            testId="pay-model"
          />
        </Field>

        {state.pay_model === 'cpm' && (
          <NumField label="CPM Rate ($/mi)" value={state.cpm} onChange={(v) => set('cpm', v)} />
        )}
        {state.pay_model === 'percentage' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <NumField label="Percentage (%)" value={state.percentage_rate} onChange={(v) => set('percentage_rate', v)} />
            <Field label="Percentage Basis Label" required>
              <Input value={state.percentage_basis_label} onChange={(e) => set('percentage_basis_label', e.target.value)}
                placeholder="Gross line-haul revenue" aria-label="Percentage Basis Label" />
            </Field>
            <NumField label="Weekly Revenue Basis ($)" value={state.percentage_weekly_revenue_basis}
              onChange={(v) => set('percentage_weekly_revenue_basis', v)} />
          </div>
        )}
        {state.pay_model === 'flat_weekly' && (
          <NumField label="Flat Weekly Pay ($)" value={state.flat_weekly_pay} onChange={(v) => set('flat_weekly_pay', v)} />
        )}
        {state.pay_model === 'salary' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <NumField label="Salary Amount ($)" value={state.salary_amount} onChange={(v) => set('salary_amount', v)} />
            <Field label="Salary Pay Period" required>
              <FreqSelect value={state.salary_frequency} onChange={(v) => set('salary_frequency', v)} ariaLabel="Salary Pay Period" />
            </Field>
          </div>
        )}
        {state.pay_model === 'mixed' && (
          <MixedComponentsEditor
            components={state.mixed_pay_components}
            onChange={(comps) => set('mixed_pay_components', comps)}
          />
        )}
        {state.pay_model === 'other' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Pay Method Label" required>
              <Input value={state.other_pay_method_label} onChange={(e) => set('other_pay_method_label', e.target.value)}
                placeholder="Guarantee + activity bonuses" aria-label="Pay Method Label" />
            </Field>
            <NumField label="Supported Weekly Gross ($)" value={state.other_weekly_gross}
              onChange={(v) => set('other_weekly_gross', v)} />
          </div>
        )}

        <NumField label="Recruiter-provided Weekly Gross ($)" value={state.recruiter_provided_weekly_gross}
          onChange={(v) => set('recruiter_provided_weekly_gross', v)} />

        <div className="pt-3 border-t border-border/40">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            One-Time Incentives
          </p>
          <NumField label="Sign-On Bonus ($)" value={state.sign_on_bonus} onChange={(v) => set('sign_on_bonus', v)} />
          <p className="text-[11px] text-muted-foreground mt-1">
            Displayed separately from weekly earnings. Never included in gross, net, or RPM.
          </p>
        </div>
      </Card>

      {/* Section 3 — Schedule, Routes & Operations */}
      <Card className="p-5 sm:p-6 border-border/60 space-y-5" data-testid="section-operations">
        <SectionHeader n={3} title="Schedule, Routes & Operations" subtitle="Miles, deadhead, and operating terms." />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <NumField label="Total Weekly Miles" value={state.estimated_weekly_miles}
            onChange={(v) => set('estimated_weekly_miles', v)} />
          <NumField label="Loaded Miles" value={state.estimated_loaded_miles}
            onChange={(v) => set('estimated_loaded_miles', v)} />
          <NumField label="Deadhead Miles" value={state.estimated_deadhead_miles}
            onChange={(v) => set('estimated_deadhead_miles', v)} />
        </div>
        <Field label="Deadhead Paid?">
          <YesNoSelect ariaLabel="Deadhead Paid?" value={state.deadhead_paid}
            onChange={(v) => set('deadhead_paid', v)} />
        </Field>
        <Field label="Home Time" required>
          <Input value={state.home_time} onChange={(e) => set('home_time', e.target.value)}
            placeholder="Home weekly, every 2 weeks…" aria-label="Home Time" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Detention Pay">
            <Input value={state.detention_pay} onChange={(e) => set('detention_pay', e.target.value)}
              placeholder="$25/hr after 2 hrs" aria-label="Detention Pay" />
          </Field>
          <Field label="Layover Pay">
            <Input value={state.layover_pay} onChange={(e) => set('layover_pay', e.target.value)}
              placeholder="$150/day" aria-label="Layover Pay" />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Forced Dispatch?">
            <YesNoSelect ariaLabel="Forced Dispatch?" value={state.forced_dispatch}
              onChange={(v) => set('forced_dispatch', v)} />
          </Field>
          <Field label="Pets Allowed?">
            <YesNoSelect ariaLabel="Pets Allowed?" value={state.pets_allowed}
              onChange={(v) => set('pets_allowed', v)} />
          </Field>
          <Field label="Riders Allowed?">
            <YesNoSelect ariaLabel="Riders Allowed?" value={state.riders_allowed}
              onChange={(v) => set('riders_allowed', v)} />
          </Field>
        </div>
        <Field label="Equipment Year / Truck Info">
          <Input value={state.equipment_year} onChange={(e) => set('equipment_year', e.target.value)}
            placeholder="2020–2024 Freightliner Cascadia" aria-label="Equipment Year / Truck Info" />
        </Field>
      </Card>

      {/* Section 4 — Equipment, Costs & Benefits */}
      <Card className="p-5 sm:p-6 border-border/60 space-y-5" data-testid="section-costs">
        <SectionHeader n={4} title="Equipment, Costs & Benefits"
          subtitle={isCompany
            ? 'Ownership operating-cost fields are not applicable to company-driver listings.'
            : 'Enter recurring costs the driver bears. Use “Not disclosed” to leave blank.'} />

        {!isCompany && (
          <Field label="Fuel Paid By">
            <Select value={state.fuel_paid_by || 'unset'}
              onValueChange={(v) => set('fuel_paid_by', v === 'unset' ? '' : v)}>
              <SelectTrigger aria-label="Fuel Paid By"><SelectValue placeholder="Not disclosed" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Not disclosed</SelectItem>
                {FUEL_PAID_BY.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        )}

        {isCompany && (
          <p className="text-xs text-muted-foreground rounded-md bg-muted/30 px-3 py-2">
            Ownership operating-cost fields are not applicable to company-driver listings. Estimated
            take-home is unavailable under the current canonical model.
          </p>
        )}

        {isCostBearing && (
          <div className="space-y-4" data-testid="cost-fields">
            <CostRow label="Insurance" amount={state.insurance_amount} frequency={state.insurance_frequency}
              onAmount={(v) => set('insurance_amount', v)} onFrequency={(v) => set('insurance_frequency', v)} />
            <CostRow label="Maintenance" amount={state.maintenance_amount} frequency={state.maintenance_frequency}
              onAmount={(v) => set('maintenance_amount', v)} onFrequency={(v) => set('maintenance_frequency', v)} />
            <CostRow label="Other recurring cost" amount={state.other_cost_amount} frequency={state.other_cost_frequency}
              onAmount={(v) => set('other_cost_amount', v)} onFrequency={(v) => set('other_cost_frequency', v)} />
            {leaseRelevant && (
              <CostRow label="Lease payment" amount={state.lease_amount} frequency={state.lease_frequency}
                onAmount={(v) => set('lease_amount', v)} onFrequency={(v) => set('lease_frequency', v)} />
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Escrow Required?">
                <Select
                  value={state.escrow_required_state}
                  onValueChange={(v) => set('escrow_required_state',
                    (v === 'unspecified' ? 'unspecified' : v) as EscrowRequiredState | 'unspecified')}
                >
                  <SelectTrigger aria-label="Escrow Required?"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unspecified">Not disclosed</SelectItem>
                    <SelectItem value="required">Required</SelectItem>
                    <SelectItem value="not_required">Not required</SelectItem>
                    <SelectItem value="not_disclosed">Explicitly not disclosed</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {state.escrow_required_state === 'required' && (
                <>
                  <NumField label="Escrow Amount ($)" value={state.escrow_amount}
                    onChange={(v) => set('escrow_amount', v)} />
                  <Field label="Escrow Frequency">
                    <FreqSelect ariaLabel="Escrow Frequency" value={state.escrow_frequency}
                      onChange={(v) => set('escrow_frequency', v)} />
                  </Field>
                </>
              )}
            </div>
          </div>
        )}

        <Field label="Actual Benefits (health, retirement, PTO)">
          <Textarea rows={3} value={state.actual_benefits}
            onChange={(e) => set('actual_benefits', e.target.value)}
            placeholder="Medical after 60 days, 401k with match, 2 weeks PTO"
            aria-label="Actual Benefits" />
        </Field>
      </Card>

      {/* Section 5 — Qualifications & Description */}
      <Card className="p-5 sm:p-6 border-border/60 space-y-5" data-testid="section-content">
        <SectionHeader n={5} title="Qualifications & Description" subtitle="How this role reads to drivers." />
        <Field label="Description" required>
          <Textarea rows={4} value={state.description}
            onChange={(e) => set('description', e.target.value.slice(0, 800))}
            placeholder="Briefly describe the role, lanes, and expectations."
            aria-label="Description" />
        </Field>
        <Field label="Typical Lanes" helper='One per line — "Dallas, TX → Houston, TX"'>
          <Textarea rows={3} value={state.typical_lanes}
            onChange={(e) => set('typical_lanes', e.target.value)}
            placeholder={'Dallas, TX → Houston, TX\nMidwest → Southeast'}
            aria-label="Typical Lanes" />
        </Field>
        <Field label="Requirements" helper="Experience, CDL class, endorsements, MVR/drug test.">
          <Textarea rows={4} value={state.requirements}
            onChange={(e) => set('requirements', e.target.value)}
            placeholder={'• 1 year OTR experience\n• Class A CDL\n• Clean MVR last 3 years'}
            aria-label="Requirements" />
        </Field>
      </Card>

      {/* Section 6 — Review & Publish */}
      <Card className="p-5 sm:p-6 border-border/60 space-y-5" data-testid="section-review">
        <SectionHeader n={6} title="Review & Publish" subtitle="Canonical summary before you publish." />
        <ReviewSummary state={state} readiness={readiness} />

        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            checked={state.transparency_confirmed}
            onCheckedChange={(v) => set('transparency_confirmed', !!v)}
            className="mt-0.5"
            aria-label="Transparency confirmation"
          />
          <span className="text-sm text-foreground leading-snug">
            I confirm this opportunity is accurate: pay, miles, costs, and estimated earnings are labeled
            with their source.
          </span>
        </label>

        {readiness.blockingReasons.length > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3" data-testid="publish-blockers">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <h4 className="text-xs font-bold text-foreground">Fix before publishing</h4>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-5">
              {readiness.blockingReasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
        )}
        {readiness.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3" data-testid="publish-warnings">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <h4 className="text-xs font-bold text-foreground">Heads up</h4>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-5">
              {readiness.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3" data-testid="form-actions">
          <Button variant="outline" onClick={() => save('draft')}
            disabled={pending || !readiness.canSaveDraft}>
            <Save className="h-4 w-4" /> Save Draft
          </Button>
          <Button onClick={() => save('publish')}
            disabled={pending || !readiness.canPublish}>
            <Send className="h-4 w-4" /> Publish Opportunity
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- primitives ---------------- */

function SectionHeader({ n, title, subtitle }: { n: number; title: string; subtitle: string }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-widest text-primary">Section {n}</p>
      <h2 className="text-lg font-black text-foreground mt-1">{title}</h2>
      <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
    </div>
  );
}

function Field({
  label, required, helper, children,
}: { label: string; required?: boolean; helper?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-foreground">
        {label} {required && <span className="text-primary">*</span>}
      </Label>
      {children}
      {helper && <p className="text-[11px] text-muted-foreground">{helper}</p>}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <Input type="number" inputMode="decimal" min={0} step="0.01" aria-label={label}
        value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function SelectField({ ariaLabel, value, options, onChange }: {
  ariaLabel: string; value: string; options: readonly string[]; onChange: (v: string) => void;
}) {
  return (
    <Select value={value || 'unset'} onValueChange={(v) => onChange(v === 'unset' ? '' : v)}>
      <SelectTrigger aria-label={ariaLabel}><SelectValue placeholder="Select…" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="unset">Select…</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function YesNoSelect({ ariaLabel, value, onChange }: {
  ariaLabel: string; value: YesNoUnknown; onChange: (v: YesNoUnknown) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as YesNoUnknown)}>
      <SelectTrigger aria-label={ariaLabel}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="unknown">Not disclosed</SelectItem>
        <SelectItem value="yes">Yes</SelectItem>
        <SelectItem value="no">No</SelectItem>
      </SelectContent>
    </Select>
  );
}

function FreqSelect({ ariaLabel, value, onChange }: {
  ariaLabel: string; value: RecurringFrequency | null; onChange: (v: RecurringFrequency | null) => void;
}) {
  return (
    <Select value={value ?? 'unset'} onValueChange={(v) => onChange(v === 'unset' ? null : (v as RecurringFrequency))}>
      <SelectTrigger aria-label={ariaLabel}><SelectValue placeholder="Not disclosed" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="unset">Not disclosed</SelectItem>
        {FREQ_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function ChipRow<T extends string>({ value, options, onChange, testId }: {
  value: T | null;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" data-testid={testId}>
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
            aria-pressed={selected}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function CostRow({ label, amount, frequency, onAmount, onFrequency }: {
  label: string; amount: string; frequency: RecurringFrequency | null;
  onAmount: (v: string) => void; onFrequency: (v: RecurringFrequency | null) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid={`cost-row-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
      <NumField label={`${label} amount ($)`} value={amount} onChange={onAmount} />
      <Field label={`${label} frequency`}>
        <FreqSelect ariaLabel={`${label} frequency`} value={frequency} onChange={onFrequency} />
      </Field>
    </div>
  );
}

function MixedComponentsEditor({ components, onChange }: {
  components: CanonicalAuthoringMixedComponent[];
  onChange: (v: CanonicalAuthoringMixedComponent[]) => void;
}) {
  const update = (i: number, patch: Partial<CanonicalAuthoringMixedComponent>) => {
    onChange(components.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  };
  const add = () => onChange([...components, { label: '', amount: '', frequency: null }]);
  const remove = (i: number) => onChange(components.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3" data-testid="mixed-components-editor">
      {components.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Add at least two named components (e.g. CPM base + weekly guarantee).
        </p>
      )}
      {components.map((c, i) => (
        <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_180px_auto] gap-2 items-end"
          data-testid={`mixed-component-${i}`}>
          <Field label={`Component ${i + 1} label`}>
            <Input value={c.label} onChange={(e) => update(i, { label: e.target.value })}
              placeholder="CPM base" aria-label={`Mixed component ${i + 1} label`} />
          </Field>
          <NumField label="Amount ($)" value={c.amount}
            onChange={(v) => update(i, { amount: v })} />
          <Field label="Frequency">
            <FreqSelect ariaLabel={`Mixed component ${i + 1} frequency`} value={c.frequency}
              onChange={(v) => update(i, { frequency: v })} />
          </Field>
          <Button variant="outline" size="sm" type="button" onClick={() => remove(i)}
            aria-label={`Remove mixed component ${i + 1}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="h-4 w-4" /> Add pay component
      </Button>
    </div>
  );
}

function ReviewSummary({ state, readiness }: {
  state: CanonicalOpportunityAuthoringState; readiness: ReturnType<typeof validateOpportunityReadiness>;
}) {
  const fe = readiness.financialEstimate;
  const grossLabel = fe.grossSource === 'derived' ? 'Derived' : fe.grossSource === 'recruiter_provided' ? 'Recruiter-provided' : '—';
  const fmt = (n: number | null) => n == null ? '—' : `$${Math.round(n).toLocaleString()}`;
  const rpm = fe.effectiveRpm == null ? '—' : `$${fe.effectiveRpm.toFixed(2)}`;
  const isCompany = state.employment_model === 'company_driver';
  const netLine = isCompany
    ? 'Not available for company drivers'
    : fe.netStatus === 'available'
      ? `${fmt(fe.estimatedWeeklyNet)} · Before taxes`
      : 'Unavailable';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="review-summary">
      <SumCard label="Employment"
        value={state.employment_model === 'unknown' ? '—' : EMPLOYMENT_OPTIONS.find((o) => o.value === state.employment_model)?.label ?? '—'} />
      <SumCard label="Driving configuration"
        value={state.team_configuration === 'unspecified' ? '—' : TEAM_OPTIONS.find((o) => o.value === state.team_configuration)?.label ?? '—'} />
      <SumCard label="Pay model" value={state.pay_model === 'unknown' ? '—' : state.pay_model} />
      <SumCard label="Financial status" value={fe.status} />
      <SumCard label={`Recurring weekly gross (${grossLabel})`} value={fmt(fe.recurringWeeklyGross)} />
      <SumCard label="Estimated weekly net" value={netLine} testId="review-net" />
      <SumCard label="Effective RPM" value={fe.effectiveRpm == null ? '—' : rpm} />
      <SumCard label="One-time incentives total" value={fmt(fe.oneTimeIncentiveTotal ?? null)} testId="review-onetime" />
    </div>
  );
}

function SumCard({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2" data-testid={testId}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
      <p className="text-sm font-black text-foreground mt-0.5">{value}</p>
    </div>
  );
}
