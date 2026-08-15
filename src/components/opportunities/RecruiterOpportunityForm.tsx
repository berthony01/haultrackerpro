// Phase 1O-A — Free-text-first, four-stage recruiter opportunity authoring.
//
// Reconstructs the recruiter authoring experience into four progressively
// disclosed stages (Write & Extract, Essentials, Optional Details, Review &
// Publish). Persistence semantics, canonical calculations, mutations, and
// publication-readiness rules are unchanged — only the authoring UX and the
// Review composition are new.

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
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import {
  ArrowLeft, ArrowRight, Save, Send, Sparkles, Plus, Trash2, AlertTriangle,
  CheckCircle2, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useRecruiterOpportunities,
  type Opportunity,
  type OpportunityInsert,
  type OpportunityUpdate,
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
import {
  PasteOpportunityDialog,
  extractOpportunityFromText,
  type ExtractedOpportunity,
} from './PasteOpportunityDialog';
import { RecruiterReadinessDialog } from './RecruiterReadinessDialog';
import { resolveRecruiterReadiness } from '@/lib/opportunities/resolveRecruiterReadiness';


interface Props {
  initial?: Opportunity | null;
  /** Phase 1R-E1 — canonical active-opportunity ceiling, supplied by the manager. */
  activeOpportunityLimit?: number | null;
  isAtActiveOpportunityLimit?: boolean;
  activeOpportunityLimitMessage?: string | null;
  onBack: () => void;
  onSaved: () => void;
  /**
   * Phase RC-1D — optional externally supplied STAFF controller. When present
   * the exported wrapper renders the shared core directly and NO owner hook
   * (recruiter profile, readiness self-heal, billing) is ever mounted.
   */
  staffController?: RecruiterOpportunityStaffController | null;
}

/** Phase RC-1D — staff authoring controller supplied by the staff manager. */
export interface RecruiterOpportunityStaffController {
  recruiterId: string;
  companyName: string | null;
  isPending: boolean;
  permissions: {
    canCreate: boolean;
    canEdit: boolean;
    canChangeStatus: boolean;
  };
  create: (
    payload: OpportunityInsert,
    handlers: { onSuccess: () => void; onError: (e: Error) => void },
  ) => void;
  update: (
    id: string,
    payload: OpportunityUpdate,
    handlers: { onSuccess: () => void; onError: (e: Error) => void },
  ) => void;
}

/**
 * Phase RC-1D — pure staff permission matrix for a save attempt.
 *
 * New draft            => create
 * New publish          => create + change_status
 * Existing, no status  => edit
 * Existing w/ status   => edit + change_status
 */
export function staffCanSubmitOpportunity(args: {
  isExisting: boolean;
  currentStatus: string | null;
  mode: 'draft' | 'publish';
  permissions: { canCreate: boolean; canEdit: boolean; canChangeStatus: boolean };
}): boolean {
  const { isExisting, currentStatus, mode, permissions } = args;
  if (!isExisting) {
    if (!permissions.canCreate) return false;
    return mode === 'draft' ? true : permissions.canChangeStatus;
  }
  if (!permissions.canEdit) return false;
  const targetStatus = mode === 'publish' ? 'active' : 'draft';
  const statusChanges = currentStatus !== targetStatus;
  return statusChanges ? permissions.canChangeStatus : true;
}

const STAFF_PERMISSION_MESSAGE =
  'You do not have permission to perform this action in this workspace.';



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

/**
 * Fixed set of 48 contiguous US state codes. Excludes AK, HI, DC, and all
 * territories per the Phase 1O-A Hiring Coverage contract.
 */
export const LOWER_48_STATE_CODES: readonly string[] = [
  'AL','AR','AZ','CA','CO','CT','DE','FL','GA','IA',
  'ID','IL','IN','KS','KY','LA','MA','MD','ME','MI',
  'MN','MO','MS','MT','NC','ND','NE','NH','NJ','NM',
  'NV','NY','OH','OK','OR','PA','RI','SC','SD','TN',
  'TX','UT','VA','VT','WA','WI','WV','WY',
] as const;

const LOWER_48_SET = new Set(LOWER_48_STATE_CODES);

export type HiringCoverageMode = 'nationwide' | 'selected' | 'local';

export function inferHiringCoverageMode(state: CanonicalOpportunityAuthoringState): HiringCoverageMode {
  const hs = state.hiring_states;
  if (
    hs.length === LOWER_48_STATE_CODES.length &&
    hs.every((c) => LOWER_48_SET.has(c))
  ) {
    return 'nationwide';
  }
  if (hs.length >= 1) return 'selected';
  return 'local';
}

function applyCoverageMode(
  s: CanonicalOpportunityAuthoringState,
  mode: HiringCoverageMode,
): CanonicalOpportunityAuthoringState {
  if (mode === 'nationwide') {
    return { ...s, hiring_states: [...LOWER_48_STATE_CODES], hiring_city: '', hiring_state: '' };
  }
  if (mode === 'selected') {
    const prior = inferHiringCoverageMode(s);
    return {
      ...s,
      hiring_city: '',
      hiring_state: '',
      hiring_states: prior === 'nationwide' ? [] : s.hiring_states,
    };
  }
  return { ...s, hiring_states: [] };
}

type StageKey = 'write' | 'essentials' | 'optional' | 'review';
const STAGES: Array<{ key: StageKey; label: string }> = [
  { key: 'write', label: 'Write & Extract' },
  { key: 'essentials', label: 'Essentials' },
  { key: 'optional', label: 'Optional Details' },
  { key: 'review', label: 'Review & Publish' },
];

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

/**
 * Phase RC-1D — internal controller consumed by the shared authoring core.
 * The core mounts NO owner hook; owner behavior is supplied by
 * `OwnerBoundRecruiterOpportunityForm`, staff behavior by the staff manager.
 */
interface OpportunityFormController {
  mode: 'owner' | 'staff';
  isPending: boolean;
  defaultCompanyName: string | null;
  create: (
    payload: OpportunityInsert,
    handlers: { onSuccess: () => void; onError: (e: Error) => void },
  ) => void;
  update: (
    id: string,
    payload: OpportunityUpdate,
    handlers: { onSuccess: () => void; onError: (e: Error) => void },
  ) => void;
  /** Owner: readiness defense-in-depth. Staff: always true (server authoritative). */
  confirmPublishReady: () => Promise<boolean>;
  staffPermissions?: { canCreate: boolean; canEdit: boolean; canChangeStatus: boolean };
}

/**
 * Exported wrapper — intentionally hook-free so the staff path never mounts
 * owner recruiter-profile / readiness / billing logic.
 */
export function RecruiterOpportunityForm(props: Props) {
  const staff = props.staffController ?? null;
  if (staff) {
    const controller: OpportunityFormController = {
      mode: 'staff',
      isPending: staff.isPending,
      defaultCompanyName: staff.companyName,
      create: staff.create,
      update: staff.update,
      confirmPublishReady: () => Promise.resolve(true),
      staffPermissions: staff.permissions,
    };
    return <RecruiterOpportunityFormCore {...props} controller={controller} />;
  }
  return <OwnerBoundRecruiterOpportunityForm {...props} />;
}

function OwnerBoundRecruiterOpportunityForm(props: Props) {
  const { createOpportunity, updateOpportunity } = useRecruiterOpportunities();
  const { profile, refetchProfile } = useRecruiterProfile();
  const [readinessOpen, setReadinessOpen] = useState(false);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const settle = (v: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(v);
  };

  const controller: OpportunityFormController = {
    mode: 'owner',
    isPending: createOpportunity.isPending || updateOpportunity.isPending,
    defaultCompanyName: profile?.company_name ?? null,
    create: (payload, handlers) => createOpportunity.mutate(payload, handlers),
    update: (id, payload, handlers) =>
      updateOpportunity.mutate({ id, data: payload }, handlers),
    // Phase 1P-A1 — publish defense-in-depth: refetch the recruiter profile
    // immediately before the mutation and abort into the readiness dialog if
    // the caller no longer satisfies posting requirements.
    confirmPublishReady: async () => {
      const fresh = await refetchProfile();
      const rr = resolveRecruiterReadiness(fresh);
      if (rr.ready) return true;
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setReadinessOpen(true);
      });
    },
  };

  return (
    <>
      <RecruiterOpportunityFormCore {...props} controller={controller} />
      <RecruiterReadinessDialog
        open={readinessOpen}
        onOpenChange={(v) => {
          setReadinessOpen(v);
          if (!v) settle(false);
        }}
        profile={profile}
        onReady={() => settle(true)}
        actionLabel="Publish"
      />
    </>
  );
}

function RecruiterOpportunityFormCore({
  initial,
  activeOpportunityLimit,
  isAtActiveOpportunityLimit,
  activeOpportunityLimitMessage,
  onBack,
  onSaved,
  controller,
}: Props & { controller: OpportunityFormController }) {


  // Phase 1R-E1 — publishing a listing that is not already active consumes
  // one slot against the canonical active-opportunity ceiling.
  const publishConsumesSlot = initial?.status !== 'active';
  const activeLimit = activeOpportunityLimit ?? 1;
  const atActiveLimit = publishConsumesSlot && isAtActiveOpportunityLimit === true;
  const activeLimitMessage =
    activeOpportunityLimitMessage ??
    `You've reached your plan limit of ${activeLimit} active ${
      activeLimit === 1 ? 'opportunity' : 'opportunities'
    }. Pause or close a listing, or upgrade your plan, to publish another.`;



  const [state, setState] = useState<State>(() =>
    initial ? normalizeOpportunityForAuthoring(initial) : { ...EMPTY_AUTHORING_STATE },
  );
  const [stage, setStage] = useState<StageKey>(initial ? 'essentials' : 'write');
  // Coverage mode is user-driven, not purely derived — clicking "Selected States"
  // from an empty state must open the state grid without pre-seeding hiring_states.
  // We initialise from the (possibly hydrated) canonical state and thereafter
  // update on explicit user selection or on paste-merge results that resolve it.
  const initialMode = useMemo(
    () => inferHiringCoverageMode(
      initial ? normalizeOpportunityForAuthoring(initial) : EMPTY_AUTHORING_STATE,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [coverageMode, setCoverageMode] = useState<HiringCoverageMode>(initialMode);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [rawText, setRawText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const hydratedRef = useRef(!!initial);

  useEffect(() => {
    if (initial && !hydratedRef.current) {
      const norm = normalizeOpportunityForAuthoring(initial);
      setState(norm);
      setCoverageMode(inferHiringCoverageMode(norm));
      hydratedRef.current = true;
      return;
    }
    if (!initial && controller.defaultCompanyName) {
      setState((cur) =>
        cur.company_name
          ? cur
          : { ...cur, company_name: controller.defaultCompanyName ?? '' },
      );
    }
  }, [initial, controller.defaultCompanyName]);

  const set = <K extends keyof State>(k: K, v: State[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const readiness = useMemo(() => validateOpportunityReadiness(state), [state]);
  const pending = controller.isPending;

  // Phase RC-1D — staff permission matrix for each save target.
  const staffPerms = controller.staffPermissions ?? null;
  const staffCanSaveDraft =
    !staffPerms ||
    staffCanSubmitOpportunity({
      isExisting: !!initial?.id,
      currentStatus: initial?.status ?? null,
      mode: 'draft',
      permissions: staffPerms,
    });
  const staffCanPublish =
    !staffPerms ||
    staffCanSubmitOpportunity({
      isExisting: !!initial?.id,
      currentStatus: initial?.status ?? null,
      mode: 'publish',
      permissions: staffPerms,
    });

  const save = async (mode: 'draft' | 'publish') => {
    if (mode === 'draft' && !staffCanSaveDraft) {
      toast.error(STAFF_PERMISSION_MESSAGE);
      return;
    }
    if (mode === 'publish' && !staffCanPublish) {
      toast.error(STAFF_PERMISSION_MESSAGE);
      return;
    }
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
    if (mode === 'publish' && atActiveLimit) {
      toast.error(activeLimitMessage);
      return;
    }

    if (mode === 'publish') {
      const ready = await controller.confirmPublishReady();
      if (!ready) return;
    }
    const payload = buildOpportunityPersistencePayload(state, mode);
    const onSuccess = () => {
      toast.success(mode === 'publish' ? 'Opportunity published — live to drivers now' : 'Draft saved');
      onSaved();
    };
    const onError = (e: Error) => {
      const cause = (e as Error & { cause?: unknown }).cause;
      const detail =
        cause && typeof cause === 'object' && cause !== null && 'message' in cause
          ? String((cause as { message?: unknown }).message ?? '')
          : '';
      toast.error(detail ? `${e.message} — ${detail}` : e.message);
    };
    if (initial?.id) {
      controller.update(initial.id, payload, { onSuccess, onError });
    } else {
      controller.create(payload, { onSuccess, onError });
    }
  };



  const handleExtracted = (data: ExtractedOpportunity) => {
    setState((cur) => {
      const merged = mergePasteIntoState(cur, data);
      // If the extractor resolved coverage information, reflect it in the
      // user-visible mode; otherwise leave the current selection alone.
      const inferred = inferHiringCoverageMode(merged);
      if (inferred !== inferHiringCoverageMode(cur)) setCoverageMode(inferred);
      return merged;
    });
  };


  const runInlineExtract = async () => {
    setExtracting(true);
    try {
      const parsed = await extractOpportunityFromText(rawText);
      handleExtracted(parsed);
      toast.success('Fields extracted. Review and adjust before submitting.');
      setStage('essentials');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  };

  const em = state.employment_model;
  const isCompany = em === 'company_driver';
  const isCostBearing = em === 'contractor_1099' || em === 'owner_operator' || em === 'lease_purchase';
  const leaseRelevant = em === 'lease_purchase';

  const stageIndex = STAGES.findIndex((s) => s.key === stage);
  const goNext = () => {
    if (stageIndex < STAGES.length - 1) setStage(STAGES[stageIndex + 1].key);
  };
  const goPrev = () => {
    if (stageIndex > 0) setStage(STAGES[stageIndex - 1].key);
  };

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

      {/* Owner readiness dialog is rendered by OwnerBoundRecruiterOpportunityForm. */}




      {/* Stage navigation */}
      <StageTabs current={stage} onSelect={setStage} />

      {/* Stage panels — only the active stage is mounted; state is preserved in useState above. */}
      {stage === 'write' && (
        <Card className="p-5 sm:p-6 border-border/60 space-y-4" data-testid="stage-write">
          <StageHeader
            step={1}
            title="Write & Extract"
            subtitle="Paste a job posting or type it freely. Our extractor pre-fills the form so you only review."
          />
          <Field label="Write or paste the opportunity" helper="30+ characters unlocks Extract details.">
            <Textarea
              rows={12}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={'Example:\n\nABC Logistics is hiring company drivers for regional dry van runs out of Dallas, TX. Pay is $0.65/mile, average 2,800 miles per week. Home weekends. No-touch freight. Sign-on bonus $2,000.'}
              aria-label="Write or paste the opportunity"
              className="font-mono text-xs"
            />
          </Field>
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              We send only what you paste to the extractor. Nothing is saved until you publish.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={runInlineExtract}
                disabled={extracting || rawText.trim().length < 30}
              >
                {extracting
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Extracting…</>
                  : <><Sparkles className="h-4 w-4" /> Extract details</>}
              </Button>
              <Button type="button" onClick={goNext}>
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {stage === 'essentials' && (
        <Card className="p-5 sm:p-6 border-border/60 space-y-5" data-testid="stage-essentials">
          <StageHeader
            step={2}
            title="Essentials"
            subtitle="Confirm the fields drivers must see. Optional details come next."
          />

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

          <HiringCoverageEditor
            state={state}
            mode={coverageMode}
            onModeChange={(m) => {
              setCoverageMode(m);
              setState((s) => applyCoverageMode(s, m));
            }}
            onCityChange={(v) => set('hiring_city', v)}
            onStateChange={(v) => set('hiring_state', v.toUpperCase().slice(0, 2))}
            onStatesChange={(list) => set('hiring_states', list)}
          />


          <Field label="Home Time" required>
            <Input value={state.home_time} onChange={(e) => set('home_time', e.target.value)}
              placeholder="Home weekly, every 2 weeks…" aria-label="Home Time" />
          </Field>

          <div className="pt-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Main Pay Model
            </p>
            <Field label="Pay Model" required>
              <ChipRow<CanonicalPayModel>
                value={state.pay_model === 'unknown' ? null : state.pay_model}
                options={PAY_OPTIONS}
                onChange={(v) => setState((s) => applyPayModelChange(s, v))}
                testId="pay-model"
              />
            </Field>

            {state.pay_model === 'cpm' && (
              <div className="mt-4">
                <NumField label="CPM Rate ($/mi)" value={state.cpm} onChange={(v) => set('cpm', v)} />
              </div>
            )}
            {state.pay_model === 'percentage' && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              <div className="mt-4">
                <NumField label="Flat Weekly Pay ($)" value={state.flat_weekly_pay} onChange={(v) => set('flat_weekly_pay', v)} />
              </div>
            )}
            {state.pay_model === 'salary' && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <NumField label="Salary Amount ($)" value={state.salary_amount} onChange={(v) => set('salary_amount', v)} />
                <Field label="Salary Pay Period" required>
                  <FreqSelect value={state.salary_frequency} onChange={(v) => set('salary_frequency', v)} ariaLabel="Salary Pay Period" />
                </Field>
              </div>
            )}
            {state.pay_model === 'mixed' && (
              <div className="mt-4">
                <MixedComponentsEditor
                  components={state.mixed_pay_components}
                  onChange={(comps) => set('mixed_pay_components', comps)}
                />
              </div>
            )}
            {state.pay_model === 'other' && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Pay Method Label" required>
                  <Input value={state.other_pay_method_label} onChange={(e) => set('other_pay_method_label', e.target.value)}
                    placeholder="Guarantee + activity bonuses" aria-label="Pay Method Label" />
                </Field>
                <NumField label="Supported Weekly Gross ($)" value={state.other_weekly_gross}
                  onChange={(v) => set('other_weekly_gross', v)} />
              </div>
            )}
          </div>

          <StageNav onPrev={goPrev} onNext={goNext} isFirst={false} isLast={false} />
        </Card>
      )}

      {stage === 'optional' && (
        <Card className="p-5 sm:p-6 border-border/60 space-y-4" data-testid="stage-optional">
          <StageHeader
            step={3}
            title="Optional Details"
            subtitle="Everything else drivers may care about. Skip any group that does not apply."
          />
          <Accordion type="multiple" className="w-full">
            {/* Mileage & Runs */}
            <AccordionItem value="mileage" data-testid="group-mileage">
              <AccordionTrigger>Mileage & Runs</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2">
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
                  <NumField label="Recruiter-provided Weekly Gross ($)" value={state.recruiter_provided_weekly_gross}
                    onChange={(v) => set('recruiter_provided_weekly_gross', v)} />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Bonuses & Accessorial Pay */}
            <AccordionItem value="bonuses" data-testid="group-bonuses">
              <AccordionTrigger>Bonuses & Accessorial Pay</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2">
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
                  <NumField label="Sign-On Bonus ($)" value={state.sign_on_bonus} onChange={(v) => set('sign_on_bonus', v)} />
                  <p className="text-[11px] text-muted-foreground">
                    One-time incentives are displayed separately from weekly earnings. Never included in gross, net, or RPM.
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Costs & Operating Terms */}
            <AccordionItem value="costs" data-testid="group-costs">
              <AccordionTrigger>Costs & Operating Terms</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2">
                  {isCompany && (
                    <p className="text-xs text-muted-foreground rounded-md bg-muted/30 px-3 py-2">
                      Operating-cost fields do not apply to W-2 company-driver opportunities.
                    </p>
                  )}

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
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Benefits & Equipment */}
            <AccordionItem value="benefits" data-testid="group-benefits">
              <AccordionTrigger>Benefits & Equipment</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2">
                  <Field label="Equipment Year / Truck Info">
                    <Input value={state.equipment_year} onChange={(e) => set('equipment_year', e.target.value)}
                      placeholder="2020–2024 Freightliner Cascadia" aria-label="Equipment Year / Truck Info" />
                  </Field>
                  <Field label="Actual Benefits (health, retirement, PTO)">
                    <Textarea rows={3} value={state.actual_benefits}
                      onChange={(e) => set('actual_benefits', e.target.value)}
                      placeholder="Medical after 60 days, 401k with match, 2 weeks PTO"
                      aria-label="Actual Benefits" />
                  </Field>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Driver Requirements & Description */}
            <AccordionItem value="requirements" data-testid="group-requirements">
              <AccordionTrigger>Driver Requirements & Description</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2">
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
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <StageNav onPrev={goPrev} onNext={goNext} isFirst={false} isLast={false} />
        </Card>
      )}

      {stage === 'review' && (
        <div className="space-y-5" data-testid="stage-review">
          <StageHeader
            step={4}
            title="Review & Publish"
            subtitle="Confirm the checklist and preview drivers will see. Publish when you're ready."
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <PublicationChecklist readiness={readiness} />
            <DriverPreview state={state} readiness={readiness} coverageMode={coverageMode} />
          </div>

          <Card className="p-5 sm:p-6 border-border/60 space-y-4">
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

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3" data-testid="form-actions">
              <Button variant="outline" onClick={goPrev} type="button">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button variant="outline" onClick={() => save('draft')}
                disabled={pending || !readiness.canSaveDraft}>
                <Save className="h-4 w-4" /> Save Draft
              </Button>
              <Button onClick={() => save('publish')}
                data-testid="publish-opportunity"
                disabled={pending || !readiness.canPublish || atActiveLimit}>
                <Send className="h-4 w-4" /> Publish Opportunity

              </Button>
            </div>
            {atActiveLimit && (
              <p
                className="mt-3 text-xs text-destructive sm:text-right"
                data-testid="form-active-opportunity-limit-message"
              >
                {activeLimitMessage}
              </p>
            )}

          </Card>
        </div>
      )}
    </div>
  );
}

/* ---------------- stage primitives ---------------- */

function StageTabs({ current, onSelect }: { current: StageKey; onSelect: (k: StageKey) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Opportunity authoring stages"
      className="flex flex-wrap gap-2"
      data-testid="stage-tabs"
    >
      {STAGES.map((s, i) => {
        const active = s.key === current;
        return (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={active}
            aria-current={active ? 'step' : undefined}
            onClick={() => onSelect(s.key)}
            data-testid={`stage-tab-${s.key}`}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
              active
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border/60 hover:border-primary/40 hover:text-foreground'
            }`}
          >
            <span className="tabular-nums text-[10px] opacity-70 mr-1.5">{i + 1}</span>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

function StageHeader({ step, title, subtitle }: { step: number; title: string; subtitle: string }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-widest text-primary">Step {step} of {STAGES.length}</p>
      <h2 className="text-lg font-black text-foreground mt-1">{title}</h2>
      <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
    </div>
  );
}

function StageNav({
  onPrev, onNext, isFirst, isLast,
}: { onPrev: () => void; onNext: () => void; isFirst: boolean; isLast: boolean }) {
  return (
    <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-3 pt-2">
      <Button type="button" variant="outline" onClick={onPrev} disabled={isFirst}>
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>
      <Button type="button" onClick={onNext} disabled={isLast}>
        Continue <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

/* ---------------- hiring coverage ---------------- */

function HiringCoverageEditor({
  state, mode, onModeChange, onCityChange, onStateChange, onStatesChange,
}: {
  state: State;
  mode: HiringCoverageMode;
  onModeChange: (m: HiringCoverageMode) => void;
  onCityChange: (v: string) => void;
  onStateChange: (v: string) => void;
  onStatesChange: (list: string[]) => void;
}) {
  const modeOptions: Array<{ value: HiringCoverageMode; label: string }> = [
    { value: 'nationwide', label: 'Nationwide — Lower 48' },
    { value: 'selected', label: 'Selected States' },
    { value: 'local', label: 'Local / Metro Area' },
  ];

  const toggleState = (code: string) => {
    const has = state.hiring_states.includes(code);
    const next = has
      ? state.hiring_states.filter((c) => c !== code)
      : [...state.hiring_states, code].sort();
    onStatesChange(next);
  };

  return (
    <div className="space-y-3" data-testid="hiring-coverage">
      <Field label="Hiring Coverage" required>
        <div className="flex flex-wrap gap-2" data-testid="hiring-coverage-modes" role="radiogroup" aria-label="Hiring Coverage">
          {modeOptions.map((o) => {
            const active = o.value === mode;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-pressed={active}
                onClick={() => onModeChange(o.value)}
                data-testid={`coverage-mode-${o.value}`}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-muted-foreground border-border/60 hover:border-primary/40 hover:text-foreground'
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </Field>

      {mode === 'nationwide' && (
        <p className="text-xs text-muted-foreground rounded-md bg-muted/30 px-3 py-2" data-testid="coverage-nationwide-hint">
          Drivers in all 48 contiguous states will see this opportunity.
        </p>
      )}

      {mode === 'selected' && (
        <div className="space-y-2" data-testid="coverage-selected">
          <p className="text-[11px] text-muted-foreground">
            Choose one or more contiguous states. AK, HI, and DC are not eligible.
          </p>
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
            {LOWER_48_STATE_CODES.map((code) => {
              const on = state.hiring_states.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => toggleState(code)}
                  aria-pressed={on}
                  aria-label={`Hiring state ${code}`}
                  data-testid={`coverage-state-${code}`}
                  className={`px-2 py-1.5 rounded-md text-[11px] font-bold border transition-colors ${
                    on
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-muted-foreground border-border/60 hover:border-primary/40 hover:text-foreground'
                  }`}
                >
                  {code}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {state.hiring_states.length} state{state.hiring_states.length === 1 ? '' : 's'} selected.
          </p>
        </div>
      )}

      {mode === 'local' && (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-4" data-testid="coverage-local">
          <Field label="Hiring City" required>
            <Input value={state.hiring_city} onChange={(e) => onCityChange(e.target.value)}
              placeholder="Dallas" aria-label="Hiring City" />
          </Field>
          <Field label="Hiring State" required>
            <Input value={state.hiring_state} onChange={(e) => onStateChange(e.target.value)}
              placeholder="TX" aria-label="Hiring State" />
          </Field>
        </div>
      )}
    </div>
  );
}

/* ---------------- review composition ---------------- */

function PublicationChecklist({
  readiness,
}: { readiness: ReturnType<typeof validateOpportunityReadiness> }) {
  const blockers = readiness.blockingReasons;
  const warnings = readiness.warnings;
  const ok = blockers.length === 0;

  return (
    <Card className="p-5 sm:p-6 border-border/60 space-y-4" data-testid="publication-checklist">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-primary">Publication Checklist</p>
        <p className="text-xs text-muted-foreground mt-1">
          Complete the required details before publishing. Warnings do not block publication.
        </p>
      </div>

      {ok && (
        <div
          className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3"
          data-testid="publish-ok"
        >
          <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold text-foreground">Ready to publish</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">No required details are missing.</p>
          </div>
        </div>
      )}

      {blockers.length > 0 && (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3"
          data-testid="publish-blockers"
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <h4 className="text-xs font-bold text-foreground">
              {blockers.length} blocker{blockers.length === 1 ? '' : 's'}
            </h4>
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-5">
            {blockers.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div
          className="rounded-lg border border-warning/30 bg-warning/5 p-3"
          data-testid="publish-warnings"
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <h4 className="text-xs font-bold text-foreground">
              {warnings.length} warning{warnings.length === 1 ? '' : 's'}
            </h4>
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-5">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}


function DriverPreview({
  state, readiness, coverageMode,
}: {
  state: State;
  readiness: ReturnType<typeof validateOpportunityReadiness>;
  coverageMode: HiringCoverageMode;
}) {
  const fe = readiness.financialEstimate;
  const rows: Array<{ label: string; value: string }> = [];

  const payLabel = state.pay_model === 'unknown'
    ? null
    : PAY_OPTIONS.find((o) => o.value === state.pay_model)?.label ?? null;
  const grossLabel = fe.grossSource === 'derived'
    ? 'Derived'
    : fe.grossSource === 'recruiter_provided'
      ? 'Recruiter-provided'
      : null;

  const payDetails: string[] = [];
  if (payLabel) payDetails.push(payLabel);
  if (fe.recurringWeeklyGross != null && grossLabel) {
    payDetails.push(`$${Math.round(fe.recurringWeeklyGross).toLocaleString()}/wk (${grossLabel})`);
  }
  if (fe.effectiveRpm != null) payDetails.push(`$${fe.effectiveRpm.toFixed(2)} RPM`);
  if (payDetails.length > 0) rows.push({ label: 'Main pay offer', value: payDetails.join(' · ') });

  const coverageValue = coverageMode === 'nationwide'
    ? 'Nationwide — Lower 48'
    : coverageMode === 'selected'
      ? state.hiring_states.length > 0
        ? `Selected states: ${state.hiring_states.join(', ')}`
        : ''
      : state.hiring_city && state.hiring_state
        ? `${state.hiring_city}, ${state.hiring_state}`
        : '';
  if (coverageValue) rows.push({ label: 'Hiring coverage', value: coverageValue });

  const emLabel = state.employment_model === 'unknown'
    ? null
    : EMPLOYMENT_OPTIONS.find((o) => o.value === state.employment_model)?.label ?? null;
  if (emLabel) rows.push({ label: 'Employment arrangement', value: emLabel });

  const teamLabel = state.team_configuration === 'unspecified'
    ? null
    : TEAM_OPTIONS.find((o) => o.value === state.team_configuration)?.label ?? null;
  if (teamLabel) rows.push({ label: 'Driving configuration', value: teamLabel });

  if (state.route_type) rows.push({ label: 'Route type', value: state.route_type });
  if (state.trailer_type) rows.push({ label: 'Trailer type', value: state.trailer_type });
  if (state.home_time.trim()) rows.push({ label: 'Home time', value: state.home_time.trim() });

  // Optional recurring net — only when actually available and applicable.
  if (fe.netStatus === 'available' && fe.estimatedWeeklyNet != null) {
    rows.push({
      label: 'Estimated weekly net',
      value: `$${Math.round(fe.estimatedWeeklyNet).toLocaleString()} · Before taxes`,
    });
  }

  // One-time incentives — only when > 0, always labeled separately from recurring pay.
  if (fe.oneTimeIncentiveTotal > 0) {
    rows.push({
      label: 'One-time incentives',
      value: `$${Math.round(fe.oneTimeIncentiveTotal).toLocaleString()} (paid separately from weekly earnings)`,
    });
  }

  const title = state.title.trim();
  const company = state.company_name.trim();
  const description = state.description.trim();

  return (
    <Card className="p-5 sm:p-6 border-border/60 space-y-4" data-testid="driver-preview">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-primary">Driver Preview</p>
        <p className="text-xs text-muted-foreground mt-1">
          This is how the populated opportunity details will appear to drivers.
        </p>
      </div>

      {(title || company) && (
        <div className="space-y-2">
          {title && (
            <h3 className="text-xl font-black text-foreground leading-tight">{title}</h3>
          )}
          {company && (
            <p className="text-sm font-semibold text-muted-foreground">{company}</p>
          )}
        </div>
      )}


      {rows.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="driver-preview-rows">
          {rows.map((r) => (
            <div
              key={r.label}
              className="rounded-lg border border-border/60 bg-card/40 px-3 py-2"
              data-testid={`preview-row-${r.label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
            >
              <dt className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                {r.label}
              </dt>
              <dd className="text-sm font-black text-foreground mt-0.5">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {description && (
        <div className="pt-2 border-t border-border/40">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
            About this role
          </p>
          <p className="text-sm text-foreground whitespace-pre-line">{description}</p>
        </div>
      )}
    </Card>
  );
}

/* ---------------- primitives ---------------- */

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
