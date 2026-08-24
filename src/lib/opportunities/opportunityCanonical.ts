// Phase 1L-DE1 — Canonical opportunity authoring module.
//
// Pure boundary between the recruiter authoring form and (a) the Phase 1L-C
// deterministic financial calculator and (b) the additive canonical storage
// contract defined in the 20260721143000 candidate migration.
//
// This module owns:
//   * The authoring state shape.
//   * Legacy row → authoring state normalization.
//   * Authoring state → canonical financial calculator input.
//   * Client-side publication readiness (single source of truth).
//   * Authoring state → database Insert/Update payload.
//
// It never talks to the database or performs I/O.

import type { Tables, TablesInsert } from '@/integrations/supabase/types';
import {
  calculateCanonicalOpportunityFinancials,
  type CanonicalEmploymentModel,
  type CanonicalMixedPayComponent,
  type CanonicalOneTimeIncentive,
  type CanonicalOpportunityFinancialEstimate,
  type CanonicalOpportunityFinancialInput,
  type CanonicalPayModel,
  type CanonicalRecurringAmount,
  type Disclosure,
  type RecurringFrequency,
} from './opportunityProfit';
import { joinBenefits, splitBenefits } from './benefitsFormat';

export type {
  CanonicalEmploymentModel,
  CanonicalPayModel,
  CanonicalOpportunityFinancialEstimate,
  RecurringFrequency,
};

export type CanonicalTeamConfiguration = 'solo' | 'team' | 'solo_or_team' | 'unspecified';
export type YesNoUnknown = 'yes' | 'no' | 'unknown';
export type EscrowRequiredState = 'required' | 'not_required' | 'not_disclosed';

export const ROUTE_TYPE_VALUES = ['Local', 'Regional', 'OTR', 'Dedicated', 'Semi-Dedicated'] as const;
export const TRAILER_TYPE_VALUES = ['Dry Van', 'Reefer', 'Flatbed', 'Tanker', 'Car Hauler', 'Intermodal', 'Other'] as const;

const EMPLOYMENT_VALUES: readonly CanonicalEmploymentModel[] = [
  'company_driver', 'contractor_1099', 'owner_operator', 'lease_purchase',
];
const TEAM_VALUES: readonly CanonicalTeamConfiguration[] = ['solo', 'team', 'solo_or_team'];
const PAY_VALUES: readonly CanonicalPayModel[] = [
  'cpm', 'percentage', 'flat_weekly', 'salary', 'mixed', 'other',
];
const FREQ_VALUES: readonly RecurringFrequency[] = ['weekly', 'biweekly', 'monthly', 'annual'];

export interface CanonicalAuthoringMixedComponent {
  label: string;
  amount: string;
  frequency: RecurringFrequency | null;
}

export interface CanonicalOpportunityAuthoringState {
  // identity
  title: string;
  company_name: string;
  // classification
  employment_model: CanonicalEmploymentModel | 'unknown';
  team_configuration: CanonicalTeamConfiguration;
  legacy_team_row: boolean;
  route_type: string;
  trailer_type: string;
  // hiring area
  hiring_city: string;
  hiring_state: string;
  hiring_states: string[];
  // description
  description: string;
  // compensation
  pay_model: CanonicalPayModel | 'unknown';
  cpm: string;
  percentage_rate: string;
  percentage_basis_label: string;
  percentage_weekly_revenue_basis: string;
  flat_weekly_pay: string;
  salary_amount: string;
  salary_frequency: RecurringFrequency | null;
  mixed_pay_components: CanonicalAuthoringMixedComponent[];
  legacy_mixed_pay_hint: boolean;
  other_pay_method_label: string;
  other_weekly_gross: string;
  recruiter_provided_weekly_gross: string;
  // mileage
  estimated_weekly_miles: string;
  estimated_loaded_miles: string;
  estimated_deadhead_miles: string;
  deadhead_paid: YesNoUnknown;
  // one-time incentive
  sign_on_bonus: string;
  // accessorial
  detention_pay: string;
  layover_pay: string;
  // operating terms
  home_time: string;
  forced_dispatch: YesNoUnknown;
  pets_allowed: YesNoUnknown;
  riders_allowed: YesNoUnknown;
  equipment_year: string;
  // costs
  fuel_paid_by: string;
  insurance_amount: string;
  insurance_frequency: RecurringFrequency | null;
  maintenance_amount: string;
  maintenance_frequency: RecurringFrequency | null;
  other_cost_amount: string;
  other_cost_frequency: RecurringFrequency | null;
  lease_amount: string;
  lease_frequency: RecurringFrequency | null;
  escrow_required_state: EscrowRequiredState | 'unspecified';
  escrow_amount: string;
  escrow_frequency: RecurringFrequency | null;
  // content
  typical_lanes: string;
  requirements: string;
  actual_benefits: string;
  // transparency
  transparency_confirmed: boolean;
}

export const EMPTY_AUTHORING_STATE: CanonicalOpportunityAuthoringState = {
  title: '',
  company_name: '',
  employment_model: 'unknown',
  team_configuration: 'unspecified',
  legacy_team_row: false,
  route_type: '',
  trailer_type: '',
  hiring_city: '',
  hiring_state: '',
  hiring_states: [],
  description: '',
  pay_model: 'unknown',
  cpm: '',
  percentage_rate: '',
  percentage_basis_label: '',
  percentage_weekly_revenue_basis: '',
  flat_weekly_pay: '',
  salary_amount: '',
  salary_frequency: null,
  mixed_pay_components: [],
  legacy_mixed_pay_hint: false,
  other_pay_method_label: '',
  other_weekly_gross: '',
  recruiter_provided_weekly_gross: '',
  estimated_weekly_miles: '',
  estimated_loaded_miles: '',
  estimated_deadhead_miles: '',
  deadhead_paid: 'unknown',
  sign_on_bonus: '',
  detention_pay: '',
  layover_pay: '',
  home_time: '',
  forced_dispatch: 'unknown',
  pets_allowed: 'unknown',
  riders_allowed: 'unknown',
  equipment_year: '',
  fuel_paid_by: '',
  insurance_amount: '',
  insurance_frequency: null,
  maintenance_amount: '',
  maintenance_frequency: null,
  other_cost_amount: '',
  other_cost_frequency: null,
  lease_amount: '',
  lease_frequency: null,
  escrow_required_state: 'unspecified',
  escrow_amount: '',
  escrow_frequency: null,
  typical_lanes: '',
  requirements: '',
  actual_benefits: '',
  transparency_confirmed: false,
};

/* ---------------- primitive helpers ---------------- */

type Opp = Partial<Tables<'opportunities'>>;

const s = (v: unknown): string => (v == null ? '' : String(v));
const numToStr = (v: unknown): string => {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '';
};
const isEmptyStr = (v: string): boolean => v.trim().length === 0;
const isFreq = (v: unknown): v is RecurringFrequency => typeof v === 'string' && (FREQ_VALUES as readonly string[]).includes(v);
const isEmployment = (v: unknown): v is CanonicalEmploymentModel => typeof v === 'string' && (EMPLOYMENT_VALUES as readonly string[]).includes(v);
const isTeam = (v: unknown): v is CanonicalTeamConfiguration => typeof v === 'string' && (TEAM_VALUES as readonly string[]).includes(v);
const isPay = (v: unknown): v is CanonicalPayModel => typeof v === 'string' && (PAY_VALUES as readonly string[]).includes(v);

/* ---------------- legacy → canonical projections ---------------- */

interface LegacyProjection {
  employment_model: CanonicalEmploymentModel | 'unknown';
  team_configuration: CanonicalTeamConfiguration;
  legacy_team_row: boolean;
}

export function projectLegacyDriverType(driverType: string | null | undefined): LegacyProjection {
  const dt = (driverType ?? '').trim().toLowerCase();
  switch (dt) {
    case 'company':
    case 'company_driver':
      return { employment_model: 'company_driver', team_configuration: 'unspecified', legacy_team_row: false };
    case '1099':
    case '1099_contractor':
    case 'contractor_1099':
      return { employment_model: 'contractor_1099', team_configuration: 'unspecified', legacy_team_row: false };
    case 'owner_operator':
      return { employment_model: 'owner_operator', team_configuration: 'unspecified', legacy_team_row: false };
    case 'lease_purchase':
      return { employment_model: 'lease_purchase', team_configuration: 'unspecified', legacy_team_row: false };
    case 'team':
    case 'team_driver':
      return { employment_model: 'unknown', team_configuration: 'team', legacy_team_row: true };
    default:
      return { employment_model: 'unknown', team_configuration: 'unspecified', legacy_team_row: false };
  }
}

export function projectLegacyPayModel(payModel: string | null | undefined): CanonicalPayModel | 'unknown' {
  const pm = (payModel ?? '').trim().toLowerCase();
  return isPay(pm) ? pm : 'unknown';
}

export function normalizeOpportunityForAuthoring(
  row: Opp | null | undefined,
): CanonicalOpportunityAuthoringState {
  const base: CanonicalOpportunityAuthoringState = { ...EMPTY_AUTHORING_STATE };
  if (!row) return base;

  const legacy = projectLegacyDriverType(row.driver_type ?? null);
  const rowEmployment = row.employment_model;
  const rowTeam = row.team_configuration;

  base.title = s(row.title);
  base.company_name = s(row.company_name);
  base.transparency_confirmed = row.transparency_confirmed === true;
  base.employment_model = isEmployment(rowEmployment) ? rowEmployment : legacy.employment_model;
  base.team_configuration = isTeam(rowTeam) ? rowTeam : legacy.team_configuration;
  base.legacy_team_row = base.employment_model === 'unknown' && legacy.legacy_team_row;
  base.route_type = s(row.route_type);
  base.trailer_type = s(row.trailer_type);
  base.hiring_city = s(row.hiring_city);
  base.hiring_state = s(row.hiring_state);
  base.hiring_states = Array.isArray(row.hiring_states)
    ? (row.hiring_states as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  base.description = s(row.description);

  // Pay model — preserve recognized stored value exactly; never infer from
  // legacy numeric fields when stored pay_model is missing or unrecognized.
  const rowPay = row.pay_model;
  base.pay_model = isPay(rowPay) ? rowPay : 'unknown';

  base.cpm = numToStr(row.cpm);
  base.percentage_rate = numToStr(row.percentage_pay);
  base.percentage_basis_label = s(row.percentage_basis_label);
  base.percentage_weekly_revenue_basis = numToStr(row.percentage_weekly_revenue_basis);

  // Salary — either new field being present marks canonical salary
  // provenance and disables the legacy `flat_weekly_pay` fallback. The legacy
  // fallback only applies when both new fields are absent and stored
  // pay_model === 'salary'.
  const rowSalaryAmt = row.salary_amount;
  const rowSalaryFreq = row.salary_frequency;
  if (rowSalaryAmt != null || rowSalaryFreq != null) {
    base.salary_amount = numToStr(rowSalaryAmt);
    base.salary_frequency = isFreq(rowSalaryFreq) ? rowSalaryFreq : null;
  } else if (rowPay === 'salary' && row.flat_weekly_pay != null) {
    base.salary_amount = numToStr(row.flat_weekly_pay);
    base.salary_frequency = 'weekly';
  }

  base.flat_weekly_pay = base.pay_model === 'flat_weekly' ? numToStr(row.flat_weekly_pay) : '';

  // Mixed — canonical only; legacy rows never invent canonical components.
  // A "usable" canonical component requires all three: nonblank label, finite
  // nonnegative amount, and a recognized recurring frequency.
  const rawMixed = row.mixed_pay_components as unknown;
  const normalizedMixed: CanonicalAuthoringMixedComponent[] = Array.isArray(rawMixed)
    ? rawMixed
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && !Array.isArray(c))
        .map((c) => ({
          label: s(c.label),
          amount: numToStr(c.amount),
          frequency: isFreq(c.frequency) ? (c.frequency as RecurringFrequency) : null,
        }))
    : [];
  const usableMixed = normalizedMixed.filter((c) => {
    if (!c.label.trim()) return false;
    if (!c.frequency) return false;
    const n = Number(c.amount);
    return c.amount.trim() !== '' && Number.isFinite(n) && n >= 0;
  });
  const legacyMixedHint = rowPay === 'mixed' && usableMixed.length === 0 && row.canonical_version !== 1;
  base.mixed_pay_components = legacyMixedHint ? [] : normalizedMixed;
  base.legacy_mixed_pay_hint = legacyMixedHint;

  base.other_pay_method_label = s(row.other_pay_method_label);
  base.other_weekly_gross = numToStr(row.other_weekly_gross);
  base.recruiter_provided_weekly_gross = numToStr(row.estimated_weekly_gross);

  base.estimated_weekly_miles = numToStr(row.estimated_weekly_miles);
  base.estimated_loaded_miles = numToStr(row.estimated_loaded_miles);
  base.estimated_deadhead_miles = numToStr(row.estimated_deadhead_miles);
  base.deadhead_paid = row.deadhead_paid === true ? 'yes' : row.deadhead_paid === false ? 'no' : 'unknown';

  base.sign_on_bonus = numToStr(row.sign_on_bonus);
  base.detention_pay = s(row.detention_pay);
  base.layover_pay = s(row.layover_pay);
  base.home_time = s(row.home_time);
  base.forced_dispatch = row.forced_dispatch === true ? 'yes' : row.forced_dispatch === false ? 'no' : 'unknown';
  base.pets_allowed = row.pets_allowed === true ? 'yes' : row.pets_allowed === false ? 'no' : 'unknown';
  base.riders_allowed = row.riders_allowed === true ? 'yes' : row.riders_allowed === false ? 'no' : 'unknown';
  base.equipment_year = s(row.equipment_year);

  base.fuel_paid_by = s(row.fuel_paid_by);
  base.insurance_amount = numToStr(row.insurance_deductions);
  base.insurance_frequency = isFreq(row.insurance_deduction_frequency) ? (row.insurance_deduction_frequency as RecurringFrequency) : null;
  base.maintenance_amount = numToStr(row.maintenance_deductions);
  base.maintenance_frequency = isFreq(row.maintenance_deduction_frequency) ? (row.maintenance_deduction_frequency as RecurringFrequency) : null;
  base.other_cost_amount = numToStr(row.other_deductions);
  base.other_cost_frequency = isFreq(row.other_deduction_frequency) ? (row.other_deduction_frequency as RecurringFrequency) : null;
  base.lease_amount = numToStr(row.lease_payment);
  base.lease_frequency = isFreq(row.lease_payment_frequency) ? (row.lease_payment_frequency as RecurringFrequency) : null;

  // Escrow — new state wins; absent-new + legacy true -> required; absent-new
  // + legacy false or null -> unspecified (never synthesize "not_required").
  const escrowState = row.escrow_required_state;
  if (escrowState === 'required' || escrowState === 'not_required' || escrowState === 'not_disclosed') {
    base.escrow_required_state = escrowState;
  } else if (row.escrow_required === true) {
    base.escrow_required_state = 'required';
  } else {
    base.escrow_required_state = 'unspecified';
  }
  base.escrow_amount = numToStr(row.escrow_amount);
  base.escrow_frequency = isFreq(row.escrow_amount_frequency) ? (row.escrow_amount_frequency as RecurringFrequency) : null;

  // Content — field-by-field precedence. Dedicated canonical fields win
  // individually; the dedicated `actual_benefits` field never falls back to
  // legacy `benefits`.
  const canonLanes = s(row.typical_lanes);
  const canonReqs = s(row.requirements);
  const canonBenefits = s(row.actual_benefits);
  const split = splitBenefits(row.benefits ?? null);
  base.typical_lanes = !isEmptyStr(canonLanes) ? canonLanes : split.typical_lanes;
  base.requirements = !isEmptyStr(canonReqs) ? canonReqs : split.requirements;
  base.actual_benefits = canonBenefits;

  return base;
}

/* ---------------- state → canonical calculator input ---------------- */

// Blank amount + no frequency -> not disclosed. Any nonblank amount preserves
// zero, negative, and NaN so the calculator can produce diagnostics. A blank
// amount paired with a selected frequency is preserved as an invalid amount
// (NaN) with that frequency so validation still surfaces the missing amount.
function amountDisclosure(amountStr: string, freq: RecurringFrequency | null): Disclosure<CanonicalRecurringAmount> {
  const blank = amountStr.trim() === '';
  if (blank && freq == null) return { state: 'not_disclosed' };
  if (blank) return { state: 'provided', value: { amount: NaN, frequency: freq } };
  return { state: 'provided', value: { amount: Number(amountStr), frequency: freq } };
}

// Blank -> not disclosed. Any nonblank string -> provided(Number(v)),
// preserving zero, negative, and NaN. Never downgrade a nonblank invalid
// value to not disclosed — the calculator diagnoses it.
function numDisclosure(v: string): Disclosure<number> {
  if (v.trim() === '') return { state: 'not_disclosed' };
  return { state: 'provided', value: Number(v) };
}

function boolDisclosure(v: YesNoUnknown): Disclosure<boolean> {
  if (v === 'yes') return { state: 'provided', value: true };
  if (v === 'no') return { state: 'provided', value: false };
  return { state: 'not_disclosed' };
}

export function buildCanonicalFinancialInput(
  state: CanonicalOpportunityAuthoringState,
): CanonicalOpportunityFinancialInput {
  const employment = state.employment_model === 'unknown' ? 'unknown' : state.employment_model;
  const payModel = state.pay_model === 'unknown' ? 'unknown' : state.pay_model;
  const isCompany = employment === 'company_driver';
  const leaseRelevant = employment === 'lease_purchase';
  const costBearing = employment === 'contractor_1099' || employment === 'owner_operator' || leaseRelevant;

  const percentageDisc: Disclosure<{ rate: number; weeklyRevenueBasis: number | null; basisLabel: string | null }> =
    (() => {
      if (payModel !== 'percentage') return { state: 'not_applicable' };
      const rateTrim = state.percentage_rate.trim();
      const basisTrim = state.percentage_weekly_revenue_basis.trim();
      const label = state.percentage_basis_label.trim();
      if (!rateTrim && !basisTrim && !label) return { state: 'not_disclosed' };
      const rate = rateTrim ? Number(rateTrim) : 0;
      const basis = basisTrim ? Number(basisTrim) : null;
      return {
        state: 'provided',
        value: {
          rate,
          weeklyRevenueBasis: basis,
          basisLabel: label || null,
        },
      };
    })();

  const salaryDisc: Disclosure<CanonicalRecurringAmount> = payModel !== 'salary'
    ? { state: 'not_applicable' }
    : amountDisclosure(state.salary_amount, state.salary_frequency);

  const cpmDisc: Disclosure<number> = payModel !== 'cpm' ? { state: 'not_applicable' } : numDisclosure(state.cpm);
  const flatDisc: Disclosure<number> = payModel !== 'flat_weekly' ? { state: 'not_applicable' } : numDisclosure(state.flat_weekly_pay);
  const otherDisc: Disclosure<number> = payModel !== 'other' ? { state: 'not_applicable' } : numDisclosure(state.other_weekly_gross);

  const mixed: CanonicalMixedPayComponent[] = payModel === 'mixed'
    ? state.mixed_pay_components.map((c) => ({
        label: c.label,
        amount: amountDisclosure(c.amount, c.frequency),
      }))
    : [];

  const oneTime: CanonicalOneTimeIncentive[] = (() => {
    if (state.sign_on_bonus.trim() === '') return [];
    return [{ label: 'Sign-on bonus', amount: numDisclosure(state.sign_on_bonus) }];
  })();

  const na: Disclosure<CanonicalRecurringAmount> = { state: 'not_applicable' };
  const naB: Disclosure<boolean> = { state: 'not_applicable' };

  // Escrow calculator input:
  //  * company driver -> both not applicable
  //  * non-cost-bearing (unknown employment) -> both not applicable
  //  * required -> pass required=true + amount disclosure
  //  * not_required + no stale amount/frequency -> amount not applicable
  //  * not_required + any stale amount/frequency -> amount disclosure (so
  //    positive stale amounts still trigger the calculator's conflict)
  //  * unspecified / not_disclosed -> required not disclosed; amount not
  //    disclosed unless a nonblank amount must be diagnosed
  let escrowRequiredDisc: Disclosure<boolean>;
  let escrowAmountDisc: Disclosure<CanonicalRecurringAmount>;

  if (isCompany || !costBearing) {
    escrowRequiredDisc = naB;
    escrowAmountDisc = na;
  } else if (state.escrow_required_state === 'required') {
    escrowRequiredDisc = { state: 'provided', value: true };
    escrowAmountDisc = amountDisclosure(state.escrow_amount, state.escrow_frequency);
  } else if (state.escrow_required_state === 'not_required') {
    escrowRequiredDisc = { state: 'provided', value: false };
    const hasStale = state.escrow_amount.trim() !== '' || state.escrow_frequency != null;
    escrowAmountDisc = hasStale
      ? amountDisclosure(state.escrow_amount, state.escrow_frequency)
      : { state: 'not_applicable' };
  } else {
    // 'unspecified' or 'not_disclosed'
    escrowRequiredDisc = { state: 'not_disclosed' };
    const hasStale = state.escrow_amount.trim() !== '' || state.escrow_frequency != null;
    escrowAmountDisc = hasStale
      ? amountDisclosure(state.escrow_amount, state.escrow_frequency)
      : { state: 'not_disclosed' };
  }

  return {
    employmentModel: employment,
    payModel,
    cpm: cpmDisc,
    percentage: percentageDisc,
    flatWeeklyPay: flatDisc,
    salary: salaryDisc,
    mixedComponents: mixed,
    otherWeeklyGross: otherDisc,
    recruiterProvidedWeeklyGross: numDisclosure(state.recruiter_provided_weekly_gross),
    totalWeeklyMiles: numDisclosure(state.estimated_weekly_miles),
    loadedWeeklyMiles: numDisclosure(state.estimated_loaded_miles),
    deadheadWeeklyMiles: numDisclosure(state.estimated_deadhead_miles),
    deadheadPaid: boolDisclosure(state.deadhead_paid),
    costs: {
      insurance: costBearing ? amountDisclosure(state.insurance_amount, state.insurance_frequency) : na,
      maintenance: costBearing ? amountDisclosure(state.maintenance_amount, state.maintenance_frequency) : na,
      other: costBearing ? amountDisclosure(state.other_cost_amount, state.other_cost_frequency) : na,
      lease: leaseRelevant ? amountDisclosure(state.lease_amount, state.lease_frequency) : na,
      escrowRequired: escrowRequiredDisc,
      escrowAmount: escrowAmountDisc,
    },
    oneTimeIncentives: oneTime,
  };
}

/* ---------------- publication readiness ---------------- */

export interface PublicationReadiness {
  canSaveDraft: boolean;
  canPublish: boolean;
  blockingReasons: string[];
  warnings: string[];
  financialEstimate: CanonicalOpportunityFinancialEstimate;
}

function parseNumStrict(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function anyInvalidNumericProvided(state: CanonicalOpportunityAuthoringState): boolean {
  const numeric = [
    state.cpm, state.percentage_rate, state.percentage_weekly_revenue_basis,
    state.flat_weekly_pay, state.salary_amount, state.other_weekly_gross,
    state.recruiter_provided_weekly_gross,
    state.estimated_weekly_miles, state.estimated_loaded_miles, state.estimated_deadhead_miles,
    state.sign_on_bonus,
    state.insurance_amount, state.maintenance_amount, state.other_cost_amount,
    state.lease_amount, state.escrow_amount,
  ];
  return numeric.some((v) => {
    const t = v.trim();
    if (!t) return false;
    const n = Number(t);
    return !Number.isFinite(n) || n < 0;
  });
}

function validateCostPair(
  label: string,
  amountStr: string,
  freq: RecurringFrequency | null,
  push: (r: string) => void,
  warn: (r: string) => void,
): void {
  const t = amountStr.trim();
  if (!t && freq == null) { warn(`${label} not disclosed — weekly net will be incomplete.`); return; }
  if (!t && freq != null) { push(`${label} amount is required when a frequency is set.`); return; }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) { push(`${label} amount must be zero or a positive number.`); return; }
  if (freq == null) push(`${label} frequency is required when an amount is set.`);
}

export function validateOpportunityReadiness(
  state: CanonicalOpportunityAuthoringState,
): PublicationReadiness {
  const blockers = new Set<string>();
  const warns = new Set<string>();

  // Draft-only rules
  if (isEmptyStr(state.title)) blockers.add('Opportunity title is required.');
  if (isEmptyStr(state.company_name)) blockers.add('Company name is required.');
  if (anyInvalidNumericProvided(state)) blockers.add('Fix invalid numeric values (must be zero or greater).');

  const draftBlockers = new Set(blockers);
  const canSaveDraft = draftBlockers.size === 0;

  // Publish-universal
  if (state.employment_model === 'unknown') blockers.add('Select an employment arrangement.');
  if (state.team_configuration === 'unspecified') blockers.add('Select a driving configuration (Solo, Team, or Solo or Team).');
  if (!(ROUTE_TYPE_VALUES as readonly string[]).includes(state.route_type)) blockers.add('Select a route type.');
  if (!(TRAILER_TYPE_VALUES as readonly string[]).includes(state.trailer_type)) blockers.add('Select a trailer type.');
  const hasCityState = !isEmptyStr(state.hiring_city) && !isEmptyStr(state.hiring_state);
  if (!hasCityState && state.hiring_states.length === 0) blockers.add('Provide a hiring city and state, or at least one hiring state.');
  if (isEmptyStr(state.description)) blockers.add('Description is required.');
  if (isEmptyStr(state.home_time)) blockers.add('Home time is required.');
  if (state.pay_model === 'unknown') blockers.add('Select a pay model.');
  if (!state.transparency_confirmed) blockers.add('Confirm the opportunity is accurate before publishing.');

  // Pay-model specific
  if (state.pay_model === 'cpm') {
    const cpm = parseNumStrict(state.cpm);
    if (cpm === null || !Number.isFinite(cpm) || cpm <= 0) blockers.add('CPM must be greater than zero.');
    // Phase OD-1 — CPM is stored as dollars per mile. Values above $5.00/mi are
    // almost always cents entered without the decimal (75 instead of 0.75).
    // Reject rather than auto-convert: bad input must never be guessed.
    else if (cpm > 5) blockers.add('CPM must be entered in dollars per mile (example: 75 cents = 0.75).');
    const total = parseNumStrict(state.estimated_weekly_miles);
    if (total === null || !Number.isFinite(total) || total <= 0) blockers.add('Total weekly miles must be greater than zero for CPM pay.');
    const loaded = parseNumStrict(state.estimated_loaded_miles);
    if (loaded !== null && Number.isFinite(loaded) && loaded === 0) blockers.add('Loaded miles cannot be zero when provided.');
    if (state.deadhead_paid === 'unknown') blockers.add('Specify whether deadhead miles are paid (yes or no).');
  } else if (state.pay_model === 'percentage') {
    const rate = parseNumStrict(state.percentage_rate);
    if (rate === null || !Number.isFinite(rate) || rate <= 0) blockers.add('Percentage rate must be greater than zero.');
    if (isEmptyStr(state.percentage_basis_label)) blockers.add('Percentage basis label is required.');
    const basis = parseNumStrict(state.percentage_weekly_revenue_basis);
    if (basis === null || !Number.isFinite(basis) || basis <= 0) blockers.add('Percentage weekly revenue basis must be greater than zero.');
  } else if (state.pay_model === 'flat_weekly') {
    const flat = parseNumStrict(state.flat_weekly_pay);
    if (flat === null || !Number.isFinite(flat) || flat <= 0) blockers.add('Flat weekly pay must be greater than zero.');
  } else if (state.pay_model === 'salary') {
    const amt = parseNumStrict(state.salary_amount);
    if (amt === null || !Number.isFinite(amt) || amt <= 0) blockers.add('Salary amount must be greater than zero.');
    if (!isFreq(state.salary_frequency)) blockers.add('Salary pay period is required.');
  } else if (state.pay_model === 'mixed') {
    const complete = state.mixed_pay_components.filter((c) => {
      if (!c.label.trim()) return false;
      const n = parseNumStrict(c.amount);
      if (n === null || !Number.isFinite(n) || n < 0) return false;
      if (!isFreq(c.frequency)) return false;
      return true;
    });
    if (complete.length < 2) blockers.add('Mixed pay requires at least two complete components (label, amount, frequency).');
    state.mixed_pay_components.forEach((c, i) => {
      if (!c.label.trim() && (c.amount.trim() || c.frequency != null)) {
        blockers.add(`Mixed component ${i + 1} needs a label.`);
      }
      const n = parseNumStrict(c.amount);
      if (c.amount.trim() && (n === null || !Number.isFinite(n) || n < 0)) {
        blockers.add(`Mixed component ${i + 1} amount must be zero or greater.`);
      }
      if (c.amount.trim() && !isFreq(c.frequency)) {
        blockers.add(`Mixed component ${i + 1} frequency is required.`);
      }
    });
    if (state.legacy_mixed_pay_hint && complete.length < 2) {
      warns.add('Legacy mixed-pay row: reconstruct at least two named recurring components before publishing.');
    }
  } else if (state.pay_model === 'other') {
    if (isEmptyStr(state.other_pay_method_label)) blockers.add('Pay method label is required for “Other”.');
    const gross = parseNumStrict(state.other_weekly_gross);
    if (gross === null || !Number.isFinite(gross) || gross <= 0) blockers.add('Supported weekly gross must be greater than zero for “Other”.');
  }

  // Legacy team-row without resolved employment
  if (state.legacy_team_row && state.employment_model === 'unknown') {
    warns.add('Legacy team-driver row: select an employment model before publishing.');
  }

  // Cost-bearing validation (warnings — not universal blockers per contract)
  const em = state.employment_model;
  const costBearing = em === 'contractor_1099' || em === 'owner_operator' || em === 'lease_purchase';
  if (costBearing) {
    const push = (r: string) => blockers.add(r);
    const warn = (r: string) => warns.add(r);
    validateCostPair('Insurance', state.insurance_amount, state.insurance_frequency, push, warn);
    validateCostPair('Maintenance', state.maintenance_amount, state.maintenance_frequency, push, warn);
    validateCostPair('Other recurring cost', state.other_cost_amount, state.other_cost_frequency, push, warn);
    if (em === 'lease_purchase') {
      validateCostPair('Lease payment', state.lease_amount, state.lease_frequency, push, warn);
    }
    if (state.escrow_required_state === 'required') {
      const amt = parseNumStrict(state.escrow_amount);
      if (amt === null || !Number.isFinite(amt) || amt < 0) blockers.add('Escrow amount is required when escrow is required.');
      if (!isFreq(state.escrow_frequency)) blockers.add('Escrow frequency is required when escrow is required.');
    } else if (
      state.escrow_required_state === 'unspecified'
      || state.escrow_required_state === 'not_disclosed'
    ) {
      warns.add('Escrow requirement not disclosed — weekly net will be incomplete.');
    }
    // 'not_required' with a stale amount is diagnosed by the calculator via
    // the escrow conflict path and surfaced in blocker mapping below.
  }

  // Financial calculator — conflict + status diagnostics. Each calculator
  // conflict is mapped to a specific recruiter-facing blocker.
  const financialEstimate = calculateCanonicalOpportunityFinancials(buildCanonicalFinancialInput(state));
  for (const conflict of financialEstimate.conflicts) {
    if (conflict.includes('Recruiter-provided weekly gross')) {
      blockers.add('Recruiter-provided weekly gross differs from derived gross by more than 10%. Resolve the conflict before publishing.');
    } else if (conflict.includes('Escrow marked not required')) {
      blockers.add('Escrow is marked not required but a positive escrow amount was provided. Clear the stale escrow amount before publishing.');
    } else {
      blockers.add('Resolve the financial input conflict before publishing.');
    }
  }

  const blockingReasons = Array.from(blockers).sort();
  const warnings = Array.from(warns).sort();
  return {
    canSaveDraft,
    canPublish: canSaveDraft && blockingReasons.length === 0,
    blockingReasons,
    warnings,
    financialEstimate,
  };
}

/* ---------------- state → persistence payload ---------------- */

export type OpportunityPersistencePayload = Omit<
  TablesInsert<'opportunities'>,
  'recruiter_id' | 'admin_review_status' | 'featured' | 'view_count' | 'published_at'
>;

function toLegacyDriverType(m: CanonicalEmploymentModel | 'unknown'): string | null {
  switch (m) {
    case 'company_driver': return 'company';
    case 'contractor_1099': return '1099';
    case 'owner_operator': return 'owner_operator';
    case 'lease_purchase': return 'lease_purchase';
    default: return null;
  }
}

function nOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function buildOpportunityPersistencePayload(
  state: CanonicalOpportunityAuthoringState,
  mode: 'draft' | 'publish',
): OpportunityPersistencePayload {
  const em = state.employment_model === 'unknown' ? null : state.employment_model;
  const isCompany = em === 'company_driver';
  const leaseRelevant = em === 'lease_purchase';
  const costBearing = em === 'contractor_1099' || em === 'owner_operator' || leaseRelevant;

  const legacyBenefits = joinBenefits({
    typical_lanes: state.typical_lanes,
    requirements: state.requirements,
  });

  const mixedForStorage = state.pay_model === 'mixed'
    ? state.mixed_pay_components
        .filter((c) => c.label.trim() || c.amount.trim() || c.frequency != null)
        .map((c) => ({
          label: c.label.trim(),
          amount: nOrNull(c.amount),
          frequency: c.frequency,
        }))
    : [];

  return {
    canonical_version: 1,
    title: state.title.trim(),
    company_name: state.company_name.trim(),
    status: mode === 'publish' ? 'active' : 'draft',
    driver_type: toLegacyDriverType(state.employment_model),
    employment_model: em,
    team_configuration: state.team_configuration === 'unspecified' ? null : state.team_configuration,
    route_type: state.route_type || null,
    trailer_type: state.trailer_type || null,
    hiring_city: state.hiring_city.trim() || null,
    hiring_state: state.hiring_state.trim() || null,
    hiring_states: state.hiring_states.slice(),
    description: state.description.trim() || null,
    pay_model: state.pay_model === 'unknown' ? null : state.pay_model,
    cpm: state.pay_model === 'cpm' ? nOrNull(state.cpm) : null,
    percentage_pay: state.pay_model === 'percentage' ? nOrNull(state.percentage_rate) : null,
    percentage_basis_label: state.pay_model === 'percentage' ? (state.percentage_basis_label.trim() || null) : null,
    percentage_weekly_revenue_basis: state.pay_model === 'percentage' ? nOrNull(state.percentage_weekly_revenue_basis) : null,
    flat_weekly_pay: state.pay_model === 'flat_weekly' ? nOrNull(state.flat_weekly_pay) : null,
    salary_amount: state.pay_model === 'salary' ? nOrNull(state.salary_amount) : null,
    salary_frequency: state.pay_model === 'salary' ? state.salary_frequency : null,
    mixed_pay_components: mixedForStorage,
    other_pay_method_label: state.pay_model === 'other' ? (state.other_pay_method_label.trim() || null) : null,
    other_weekly_gross: state.pay_model === 'other' ? nOrNull(state.other_weekly_gross) : null,
    estimated_weekly_gross: nOrNull(state.recruiter_provided_weekly_gross),
    estimated_weekly_miles: nOrNull(state.estimated_weekly_miles),
    estimated_loaded_miles: nOrNull(state.estimated_loaded_miles),
    estimated_deadhead_miles: nOrNull(state.estimated_deadhead_miles),
    deadhead_paid: state.deadhead_paid === 'unknown' ? null : state.deadhead_paid === 'yes',
    sign_on_bonus: nOrNull(state.sign_on_bonus),
    detention_pay: state.detention_pay.trim() || null,
    layover_pay: state.layover_pay.trim() || null,
    home_time: state.home_time.trim() || null,
    forced_dispatch: state.forced_dispatch === 'unknown' ? null : state.forced_dispatch === 'yes',
    pets_allowed: state.pets_allowed === 'unknown' ? null : state.pets_allowed === 'yes',
    riders_allowed: state.riders_allowed === 'unknown' ? null : state.riders_allowed === 'yes',
    equipment_year: state.equipment_year.trim() || null,
    fuel_paid_by: isCompany ? null : (state.fuel_paid_by.trim() || null),
    insurance_deductions: costBearing ? nOrNull(state.insurance_amount) : null,
    insurance_deduction_frequency: costBearing ? state.insurance_frequency : null,
    maintenance_deductions: costBearing ? nOrNull(state.maintenance_amount) : null,
    maintenance_deduction_frequency: costBearing ? state.maintenance_frequency : null,
    other_deductions: costBearing ? nOrNull(state.other_cost_amount) : null,
    other_deduction_frequency: costBearing ? state.other_cost_frequency : null,
    lease_payment: leaseRelevant ? nOrNull(state.lease_amount) : null,
    lease_payment_frequency: leaseRelevant ? state.lease_frequency : null,
    escrow_required: isCompany
      ? false
      : (state.escrow_required_state === 'required'),
    escrow_required_state: costBearing
      ? (state.escrow_required_state === 'unspecified' ? null : state.escrow_required_state)
      : null,
    escrow_amount: costBearing && state.escrow_required_state === 'required' ? nOrNull(state.escrow_amount) : null,
    escrow_amount_frequency: costBearing && state.escrow_required_state === 'required' ? state.escrow_frequency : null,
    typical_lanes: state.typical_lanes.trim() || null,
    requirements: state.requirements.trim() || null,
    actual_benefits: state.actual_benefits.trim() || null,
    benefits: legacyBenefits || null,
    transparency_confirmed: state.transparency_confirmed,
  };
}
