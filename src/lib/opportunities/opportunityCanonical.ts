/**
 * Phase 1L-DE1 — Canonical Opportunity Authoring Module.
 *
 * Single pure boundary between the recruiter authoring form and both
 *   1. the Phase 1L-C canonical calculator, and
 *   2. persisted `opportunities` rows.
 *
 * This module does NOT change the driver-facing surface, does NOT modify
 * the Phase 1L-C calculator, and does NOT persist anything itself.
 * Callers use it to hydrate authoring state from a stored row, evaluate
 * publication readiness, and project the state into a persistence payload.
 */

import type { Tables, TablesInsert } from '@/integrations/supabase/types';
import {
  calculateCanonicalOpportunityFinancials,
  type CanonicalEmploymentModel,
  type CanonicalOpportunityFinancialEstimate,
  type CanonicalOpportunityFinancialInput,
  type CanonicalPayModel,
  type Disclosure,
  type RecurringFrequency,
  normalizeRecurringAmountToWeekly,
} from './opportunityProfit';
import { splitBenefits, joinBenefits } from './benefitsFormat';

export type CanonicalTeamConfiguration = 'solo' | 'team' | 'solo_or_team' | 'unspecified';

const EMPLOYMENT_MODEL_VALUES: CanonicalEmploymentModel[] = [
  'company_driver',
  'contractor_1099',
  'owner_operator',
  'lease_purchase',
  'unknown',
];
const TEAM_CONFIG_VALUES: CanonicalTeamConfiguration[] = ['solo', 'team', 'solo_or_team', 'unspecified'];
const PAY_MODEL_VALUES: CanonicalPayModel[] = [
  'cpm', 'percentage', 'flat_weekly', 'salary', 'mixed', 'other', 'unknown',
];
const FREQ_VALUES: RecurringFrequency[] = ['weekly', 'biweekly', 'monthly', 'annual'];

export const ROUTE_TYPE_VALUES = ['Local', 'Regional', 'OTR', 'Dedicated', 'Semi-Dedicated'] as const;
export const TRAILER_TYPE_VALUES = ['Dry Van', 'Reefer', 'Flatbed', 'Tanker', 'Car Hauler', 'Intermodal', 'Other'] as const;

export interface CanonicalAuthoringMixedComponent {
  label: string;
  amount: string;          // form string; empty means not provided
  frequency: RecurringFrequency | null;
}

export type YesNoUnknown = 'yes' | 'no' | 'unknown';
export type EscrowRequiredState = 'required' | 'not_required' | 'not_disclosed';

export interface CanonicalOpportunityAuthoringState {
  // identity
  title: string;
  company_name: string;
  // classification
  employment_model: CanonicalEmploymentModel;
  team_configuration: CanonicalTeamConfiguration;
  route_type: string;
  trailer_type: string;
  // hiring area
  hiring_city: string;
  hiring_state: string;
  hiring_states: string[];
  // compensation
  pay_model: CanonicalPayModel;
  cpm: string;
  percentage_rate: string;
  percentage_basis_label: string;
  percentage_weekly_revenue_basis: string;
  flat_weekly_pay: string;
  salary_amount: string;
  salary_frequency: RecurringFrequency | null;
  mixed_pay_components: CanonicalAuthoringMixedComponent[];
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
  fuel_paid_by: string;
  // costs
  insurance_amount: string;
  insurance_frequency: RecurringFrequency | null;
  escrow_required_state: EscrowRequiredState | 'unspecified';
  escrow_amount: string;
  escrow_frequency: RecurringFrequency | null;
  lease_amount: string;
  lease_frequency: RecurringFrequency | null;
  maintenance_amount: string;
  maintenance_frequency: RecurringFrequency | null;
  other_cost_amount: string;
  other_cost_frequency: RecurringFrequency | null;
  // content
  description: string;
  typical_lanes: string;
  requirements: string;
  actual_benefits: string;
  // trust
  transparency_confirmed: boolean;
  // legacy provenance
  legacy_team_row: boolean;
  legacy_mixed_pay_hint: boolean;
}

export interface PublicationReadiness {
  canSaveDraft: boolean;
  canPublish: boolean;
  blockingReasons: string[];
  warnings: string[];
  financialEstimate: CanonicalOpportunityFinancialEstimate;
}

// ---------------- helpers ----------------

const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const nOrEmpty = (v: unknown): string => {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(v) : '';
};
const numOrNull = (v: string): number | null => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isPositiveFinite = (n: number | null): n is number => n != null && Number.isFinite(n) && n > 0;
const isNonNegFinite = (n: number | null): n is number => n != null && Number.isFinite(n) && n >= 0;
const toFreq = (v: unknown): RecurringFrequency | null =>
  typeof v === 'string' && (FREQ_VALUES as string[]).includes(v) ? (v as RecurringFrequency) : null;
const toYesNo = (b: boolean | null | undefined): YesNoUnknown =>
  b === true ? 'yes' : b === false ? 'no' : 'unknown';
const yesNoToBool = (v: YesNoUnknown): boolean | null =>
  v === 'yes' ? true : v === 'no' ? false : null;

const normalizeEmployment = (v: unknown): CanonicalEmploymentModel => {
  if (typeof v !== 'string') return 'unknown';
  if ((EMPLOYMENT_MODEL_VALUES as string[]).includes(v)) return v as CanonicalEmploymentModel;
  const t = v.toLowerCase().trim();
  if (t === 'company' || t === 'company_driver') return 'company_driver';
  if (t === '1099' || t === '1099_contractor' || t === 'contractor_1099') return 'contractor_1099';
  if (t === 'owner_operator') return 'owner_operator';
  if (t === 'lease_purchase') return 'lease_purchase';
  return 'unknown';
};

const isLegacyTeam = (v: unknown): boolean =>
  typeof v === 'string' && ['team', 'team_driver'].includes(v.toLowerCase().trim());

const normalizeTeam = (v: unknown): CanonicalTeamConfiguration => {
  if (typeof v !== 'string') return 'unspecified';
  return (TEAM_CONFIG_VALUES as string[]).includes(v)
    ? (v as CanonicalTeamConfiguration)
    : 'unspecified';
};

const normalizePayModel = (v: unknown): CanonicalPayModel => {
  if (typeof v !== 'string') return 'unknown';
  return (PAY_MODEL_VALUES as string[]).includes(v) ? (v as CanonicalPayModel) : 'unknown';
};

const provided = <T,>(value: T): Disclosure<T> => ({ state: 'provided', value });
const notDisclosed = <T,>(): Disclosure<T> => ({ state: 'not_disclosed' });
const notApplicable = <T,>(): Disclosure<T> => ({ state: 'not_applicable' });

export const EMPTY_AUTHORING_STATE: CanonicalOpportunityAuthoringState = {
  title: '', company_name: '',
  employment_model: 'unknown', team_configuration: 'unspecified',
  route_type: '', trailer_type: '',
  hiring_city: '', hiring_state: '', hiring_states: [],
  pay_model: 'unknown',
  cpm: '', percentage_rate: '', percentage_basis_label: '', percentage_weekly_revenue_basis: '',
  flat_weekly_pay: '',
  salary_amount: '', salary_frequency: null,
  mixed_pay_components: [],
  other_pay_method_label: '', other_weekly_gross: '',
  recruiter_provided_weekly_gross: '',
  estimated_weekly_miles: '', estimated_loaded_miles: '', estimated_deadhead_miles: '',
  deadhead_paid: 'unknown',
  sign_on_bonus: '',
  detention_pay: '', layover_pay: '',
  home_time: '',
  forced_dispatch: 'unknown', pets_allowed: 'unknown', riders_allowed: 'unknown',
  equipment_year: '', fuel_paid_by: '',
  insurance_amount: '', insurance_frequency: null,
  escrow_required_state: 'unspecified',
  escrow_amount: '', escrow_frequency: null,
  lease_amount: '', lease_frequency: null,
  maintenance_amount: '', maintenance_frequency: null,
  other_cost_amount: '', other_cost_frequency: null,
  description: '', typical_lanes: '', requirements: '', actual_benefits: '',
  transparency_confirmed: false,
  legacy_team_row: false,
  legacy_mixed_pay_hint: false,
};

// ---------------- normalize row → authoring state ----------------

type OppRow = Partial<Tables<'opportunities'>>;

interface StoredMixedComponent {
  label?: string;
  amount?: number | string | null;
  frequency?: string | null;
}

function parseStoredMixedComponents(raw: unknown): CanonicalAuthoringMixedComponent[] {
  if (!Array.isArray(raw)) return [];
  const out: CanonicalAuthoringMixedComponent[] = [];
  for (const item of raw as StoredMixedComponent[]) {
    if (!item || typeof item !== 'object') continue;
    const label = typeof item.label === 'string' ? item.label : '';
    const amount = item.amount == null ? '' : String(item.amount);
    const frequency = toFreq(item.frequency);
    out.push({ label, amount, frequency });
  }
  return out;
}

export function normalizeOpportunityForAuthoring(
  row: OppRow | null | undefined,
): CanonicalOpportunityAuthoringState {
  if (!row) return { ...EMPTY_AUTHORING_STATE };

  const rowEmployment = row.employment_model as string | null | undefined;
  let employment: CanonicalEmploymentModel;
  let team: CanonicalTeamConfiguration;
  let legacyTeam = false;

  if (typeof rowEmployment === 'string' && rowEmployment) {
    employment = normalizeEmployment(rowEmployment);
  } else if (isLegacyTeam(row.driver_type)) {
    employment = 'unknown';
    legacyTeam = true;
  } else {
    employment = normalizeEmployment(row.driver_type ?? null);
  }

  const rowTeam = row.team_configuration as string | null | undefined;
  if (typeof rowTeam === 'string' && rowTeam) {
    team = normalizeTeam(rowTeam);
  } else if (isLegacyTeam(row.driver_type)) {
    team = 'team';
  } else {
    team = 'unspecified';
  }

  const payModel = normalizePayModel(row.pay_model);

  // Salary hydration precedence: new columns > legacy flat_weekly_pay (labelled weekly)
  let salaryAmount = nOrEmpty(row.salary_amount as number | null | undefined);
  let salaryFrequency = toFreq(row.salary_frequency);
  if (!salaryAmount && payModel === 'salary' && row.flat_weekly_pay != null) {
    salaryAmount = nOrEmpty(row.flat_weekly_pay);
    salaryFrequency = 'weekly';
  }

  const split = splitBenefits(row.benefits ?? null);
  const typicalLanes = s(row.typical_lanes) || split.typical_lanes;
  const requirements = s(row.requirements) || split.requirements;
  const actualBenefits = s(row.actual_benefits);

  // Escrow state precedence
  let escrowState: CanonicalOpportunityAuthoringState['escrow_required_state'];
  const esCol = row.escrow_required_state as string | null | undefined;
  if (esCol === 'required' || esCol === 'not_required' || esCol === 'not_disclosed') {
    escrowState = esCol;
  } else if (row.escrow_required === true) {
    escrowState = 'required';
  } else {
    escrowState = 'unspecified';
  }

  const legacyMixedHint = payModel === 'mixed' && !Array.isArray(row.mixed_pay_components as unknown[])
    ? false
    : payModel === 'mixed' && Array.isArray(row.mixed_pay_components) && (row.mixed_pay_components as unknown[]).length === 0;

  return {
    title: s(row.title),
    company_name: s(row.company_name),
    employment_model: employment,
    team_configuration: team,
    route_type: s(row.route_type),
    trailer_type: s(row.trailer_type),
    hiring_city: s(row.hiring_city),
    hiring_state: s(row.hiring_state),
    hiring_states: Array.isArray(row.hiring_states) ? [...row.hiring_states] : [],
    pay_model: payModel,
    cpm: nOrEmpty(row.cpm),
    percentage_rate: nOrEmpty(row.percentage_pay),
    percentage_basis_label: s(row.percentage_basis_label),
    percentage_weekly_revenue_basis: nOrEmpty(row.percentage_weekly_revenue_basis),
    flat_weekly_pay: payModel === 'salary' ? '' : nOrEmpty(row.flat_weekly_pay),
    salary_amount: salaryAmount,
    salary_frequency: salaryFrequency,
    mixed_pay_components: parseStoredMixedComponents(row.mixed_pay_components),
    other_pay_method_label: s(row.other_pay_method_label),
    other_weekly_gross: nOrEmpty(row.other_weekly_gross),
    recruiter_provided_weekly_gross: nOrEmpty(row.estimated_weekly_gross),
    estimated_weekly_miles: nOrEmpty(row.estimated_weekly_miles),
    estimated_loaded_miles: nOrEmpty(row.estimated_loaded_miles),
    estimated_deadhead_miles: nOrEmpty(row.estimated_deadhead_miles),
    deadhead_paid: toYesNo(row.deadhead_paid ?? null),
    sign_on_bonus: nOrEmpty(row.sign_on_bonus),
    detention_pay: s(row.detention_pay),
    layover_pay: s(row.layover_pay),
    home_time: s(row.home_time),
    forced_dispatch: toYesNo(row.forced_dispatch ?? null),
    pets_allowed: toYesNo(row.pets_allowed ?? null),
    riders_allowed: toYesNo(row.riders_allowed ?? null),
    equipment_year: s(row.equipment_year),
    fuel_paid_by: s(row.fuel_paid_by),
    insurance_amount: nOrEmpty(row.insurance_deductions),
    insurance_frequency: toFreq(row.insurance_deduction_frequency),
    escrow_required_state: escrowState,
    escrow_amount: nOrEmpty(row.escrow_amount),
    escrow_frequency: toFreq(row.escrow_amount_frequency),
    lease_amount: nOrEmpty(row.lease_payment),
    lease_frequency: toFreq(row.lease_payment_frequency),
    maintenance_amount: nOrEmpty(row.maintenance_deductions),
    maintenance_frequency: toFreq(row.maintenance_deduction_frequency),
    other_cost_amount: nOrEmpty(row.other_deductions),
    other_cost_frequency: toFreq(row.other_deduction_frequency),
    description: s(row.description),
    typical_lanes: typicalLanes,
    requirements: requirements,
    actual_benefits: actualBenefits,
    transparency_confirmed: !!row.transparency_confirmed,
    legacy_team_row: legacyTeam,
    legacy_mixed_pay_hint: legacyMixedHint,
  };
}

// ---------------- state → canonical financial input ----------------

function costDisclosureAmount(
  amountStr: string,
  frequency: RecurringFrequency | null,
  relevant: boolean,
): Disclosure<{ amount: number; frequency: RecurringFrequency | null }> {
  if (!relevant) return notApplicable();
  const n = numOrNull(amountStr);
  if (amountStr === '' && frequency == null) return notDisclosed();
  if (n == null) return provided({ amount: NaN, frequency });
  return provided({ amount: n, frequency });
}

function escrowRequiredDisclosure(
  state: CanonicalOpportunityAuthoringState['escrow_required_state'],
  relevant: boolean,
): Disclosure<boolean> {
  if (!relevant) return notApplicable();
  if (state === 'required') return provided(true);
  if (state === 'not_required') return provided(false);
  return notDisclosed();
}

export function buildCanonicalFinancialInput(
  state: CanonicalOpportunityAuthoringState,
): CanonicalOpportunityFinancialInput {
  const em = state.employment_model;
  const pm = state.pay_model;
  const isCostBearing = em === 'contractor_1099' || em === 'owner_operator' || em === 'lease_purchase';
  const leaseRelevant = em === 'lease_purchase';

  // CPM
  const cpm: Disclosure<number> = pm === 'cpm'
    ? (state.cpm === '' ? notDisclosed() : provided(numOrNull(state.cpm) ?? NaN))
    : notApplicable();

  // Percentage
  const percentage: Disclosure<{ rate: number; weeklyRevenueBasis: number | null; basisLabel: string | null }> =
    pm === 'percentage'
      ? (state.percentage_rate === '' && !state.percentage_basis_label && !state.percentage_weekly_revenue_basis
          ? notDisclosed()
          : provided({
              rate: numOrNull(state.percentage_rate) ?? NaN,
              weeklyRevenueBasis: numOrNull(state.percentage_weekly_revenue_basis),
              basisLabel: state.percentage_basis_label || null,
            }))
      : notApplicable();

  // Flat weekly
  const flatWeekly: Disclosure<number> = pm === 'flat_weekly'
    ? (state.flat_weekly_pay === '' ? notDisclosed() : provided(numOrNull(state.flat_weekly_pay) ?? NaN))
    : notApplicable();

  // Salary
  const salary: Disclosure<{ amount: number; frequency: RecurringFrequency | null }> = pm === 'salary'
    ? (state.salary_amount === '' && state.salary_frequency == null
        ? notDisclosed()
        : provided({ amount: numOrNull(state.salary_amount) ?? NaN, frequency: state.salary_frequency }))
    : notApplicable();

  // Mixed
  const mixedComponents = pm === 'mixed'
    ? state.mixed_pay_components.map((c) => ({
        label: c.label,
        amount: (c.amount === '' && c.frequency == null)
          ? notDisclosed<{ amount: number; frequency: RecurringFrequency | null }>()
          : provided({ amount: numOrNull(c.amount) ?? NaN, frequency: c.frequency }),
      }))
    : [];

  // Other
  const otherWeeklyGross: Disclosure<number> = pm === 'other'
    ? (state.other_weekly_gross === '' ? notDisclosed() : provided(numOrNull(state.other_weekly_gross) ?? NaN))
    : notApplicable();

  const recruiterGross: Disclosure<number> = state.recruiter_provided_weekly_gross === ''
    ? notDisclosed()
    : provided(numOrNull(state.recruiter_provided_weekly_gross) ?? NaN);

  const totalMiles: Disclosure<number> = state.estimated_weekly_miles === ''
    ? notDisclosed()
    : provided(numOrNull(state.estimated_weekly_miles) ?? NaN);
  const loadedMiles: Disclosure<number> = state.estimated_loaded_miles === ''
    ? notDisclosed()
    : provided(numOrNull(state.estimated_loaded_miles) ?? NaN);
  const deadheadMiles: Disclosure<number> = state.estimated_deadhead_miles === ''
    ? notDisclosed()
    : provided(numOrNull(state.estimated_deadhead_miles) ?? NaN);
  const deadheadPaid: Disclosure<boolean> = state.deadhead_paid === 'unknown'
    ? notDisclosed()
    : provided(state.deadhead_paid === 'yes');

  const oneTimeIncentives = state.sign_on_bonus === ''
    ? []
    : [{ label: 'Sign-on bonus', amount: provided(numOrNull(state.sign_on_bonus) ?? NaN) }];

  return {
    employmentModel: em,
    payModel: pm,
    cpm, percentage, flatWeeklyPay: flatWeekly, salary, mixedComponents,
    otherWeeklyGross,
    recruiterProvidedWeeklyGross: recruiterGross,
    totalWeeklyMiles: totalMiles,
    loadedWeeklyMiles: loadedMiles,
    deadheadWeeklyMiles: deadheadMiles,
    deadheadPaid,
    costs: {
      insurance: costDisclosureAmount(state.insurance_amount, state.insurance_frequency, isCostBearing),
      maintenance: costDisclosureAmount(state.maintenance_amount, state.maintenance_frequency, isCostBearing),
      other: costDisclosureAmount(state.other_cost_amount, state.other_cost_frequency, isCostBearing),
      lease: costDisclosureAmount(state.lease_amount, state.lease_frequency, leaseRelevant),
      escrowRequired: escrowRequiredDisclosure(state.escrow_required_state, isCostBearing),
      escrowAmount: (isCostBearing && state.escrow_required_state === 'required')
        ? costDisclosureAmount(state.escrow_amount, state.escrow_frequency, true)
        : (isCostBearing && state.escrow_required_state === 'not_required' && state.escrow_amount === '' && state.escrow_frequency == null
            ? notDisclosed()
            : isCostBearing
              ? costDisclosureAmount(state.escrow_amount, state.escrow_frequency, true)
              : notApplicable()),
    },
    oneTimeIncentives,
  };
}

// ---------------- readiness validator ----------------

function anyNumericInvalid(state: CanonicalOpportunityAuthoringState): string[] {
  const invalid: string[] = [];
  const check = (key: string, v: string) => {
    if (v === '') return;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) invalid.push(`${key} must be 0 or higher.`);
  };
  check('CPM rate', state.cpm);
  check('Percentage rate', state.percentage_rate);
  check('Percentage weekly revenue basis', state.percentage_weekly_revenue_basis);
  check('Flat weekly pay', state.flat_weekly_pay);
  check('Salary amount', state.salary_amount);
  check('Other weekly gross', state.other_weekly_gross);
  check('Recruiter-provided weekly gross', state.recruiter_provided_weekly_gross);
  check('Total weekly miles', state.estimated_weekly_miles);
  check('Loaded miles', state.estimated_loaded_miles);
  check('Deadhead miles', state.estimated_deadhead_miles);
  check('Sign-on bonus', state.sign_on_bonus);
  check('Insurance amount', state.insurance_amount);
  check('Escrow amount', state.escrow_amount);
  check('Lease payment', state.lease_amount);
  check('Maintenance amount', state.maintenance_amount);
  check('Other cost amount', state.other_cost_amount);
  state.mixed_pay_components.forEach((c, i) => check(`Mixed pay component #${i + 1} amount`, c.amount));
  return invalid;
}

export function validateOpportunityReadiness(
  state: CanonicalOpportunityAuthoringState,
): PublicationReadiness {
  const blocking = new Set<string>();
  const warnings = new Set<string>();

  const invalidNumeric = anyNumericInvalid(state);
  invalidNumeric.forEach((m) => blocking.add(m));

  const canSaveDraft =
    !!state.title.trim() && !!state.company_name.trim() && invalidNumeric.length === 0;

  // universal
  if (!state.title.trim()) blocking.add('Opportunity title is required.');
  if (!state.company_name.trim()) blocking.add('Company name is required.');
  if (state.employment_model === 'unknown') {
    blocking.add('Select the employment arrangement (Company / 1099 / Owner-Operator / Lease Purchase).');
    if (state.legacy_team_row) {
      warnings.add('Legacy Team Driver row cannot publish until the employment arrangement is selected.');
    }
  }
  if (state.team_configuration === 'unspecified') {
    blocking.add('Select the driving configuration (Solo, Team, or Solo or Team).');
  }
  if (!(ROUTE_TYPE_VALUES as readonly string[]).includes(state.route_type)) {
    blocking.add('Route type is required.');
  }
  if (!(TRAILER_TYPE_VALUES as readonly string[]).includes(state.trailer_type)) {
    blocking.add('Trailer type is required.');
  }
  const hasHiringArea =
    (!!state.hiring_city.trim() && !!state.hiring_state.trim()) || state.hiring_states.length > 0;
  if (!hasHiringArea) blocking.add('Provide a hiring city+state or at least one hiring state.');
  if (!state.description.trim()) blocking.add('Description is required to publish.');
  if (!state.home_time.trim()) blocking.add('Home time statement is required.');
  if (state.pay_model === 'unknown') blocking.add('Select a pay model.');
  if (!state.transparency_confirmed) blocking.add('Confirm the transparency statement to publish.');

  // pay-model specific
  const pm = state.pay_model;
  const num = numOrNull;
  if (pm === 'cpm') {
    const cpm = num(state.cpm);
    if (!isPositiveFinite(cpm)) blocking.add('CPM must be greater than zero.');
    const total = num(state.estimated_weekly_miles);
    if (!isPositiveFinite(total)) blocking.add('Total weekly miles must be greater than zero for CPM listings.');
    const loaded = num(state.estimated_loaded_miles);
    if (loaded != null && loaded === 0) blocking.add('Loaded miles cannot be zero.');
    if (state.deadhead_paid === 'unknown') blocking.add('Indicate whether deadhead miles are paid.');
  } else if (pm === 'percentage') {
    const rate = num(state.percentage_rate);
    if (!isPositiveFinite(rate)) blocking.add('Percentage must be greater than zero.');
    if (!state.percentage_basis_label.trim()) blocking.add('Percentage basis label is required.');
    const basis = num(state.percentage_weekly_revenue_basis);
    if (!isPositiveFinite(basis)) blocking.add('Percentage weekly revenue basis must be greater than zero.');
  } else if (pm === 'flat_weekly') {
    const flat = num(state.flat_weekly_pay);
    if (!isPositiveFinite(flat)) blocking.add('Flat weekly amount must be greater than zero.');
  } else if (pm === 'salary') {
    const amt = num(state.salary_amount);
    if (!isPositiveFinite(amt)) blocking.add('Salary amount must be greater than zero.');
    if (state.salary_frequency == null) blocking.add('Salary pay period is required.');
  } else if (pm === 'mixed') {
    let complete = 0;
    for (let i = 0; i < state.mixed_pay_components.length; i += 1) {
      const c = state.mixed_pay_components[i];
      const n = num(c.amount);
      const labelOk = !!c.label.trim();
      const amtOk = isNonNegFinite(n);
      const freqOk = c.frequency != null;
      if (labelOk && amtOk && freqOk) complete += 1;
      else if (!labelOk || !amtOk || !freqOk) {
        blocking.add(`Mixed pay component #${i + 1} needs a label, amount, and pay period.`);
      }
    }
    if (complete < 2) blocking.add('Provide at least two complete mixed pay components.');
  } else if (pm === 'other') {
    if (!state.other_pay_method_label.trim()) blocking.add('Describe the pay method label for Other pay.');
    const gross = num(state.other_weekly_gross);
    if (!isPositiveFinite(gross)) blocking.add('Supported weekly gross must be greater than zero for Other pay.');
  }

  // Cost rules for cost-bearing models
  const em = state.employment_model;
  const costBearing = em === 'contractor_1099' || em === 'owner_operator' || em === 'lease_purchase';
  if (costBearing) {
    const costs: Array<{ label: string; amount: string; frequency: RecurringFrequency | null; relevant: boolean }> = [
      { label: 'Insurance', amount: state.insurance_amount, frequency: state.insurance_frequency, relevant: true },
      { label: 'Maintenance', amount: state.maintenance_amount, frequency: state.maintenance_frequency, relevant: true },
      { label: 'Other recurring cost', amount: state.other_cost_amount, frequency: state.other_cost_frequency, relevant: true },
      { label: 'Lease payment', amount: state.lease_amount, frequency: state.lease_frequency, relevant: em === 'lease_purchase' },
    ];
    for (const c of costs) {
      if (!c.relevant) continue;
      const n = num(c.amount);
      if (c.amount !== '' && n != null && c.frequency == null) {
        blocking.add(`${c.label} needs a frequency when an amount is provided.`);
      }
      if (c.amount === '' && c.frequency == null) {
        warnings.add(`${c.label} is not disclosed; estimated net will be incomplete.`);
      }
    }
    // Escrow
    if (state.escrow_required_state === 'required') {
      const n = num(state.escrow_amount);
      if (!isNonNegFinite(n)) blocking.add('Escrow amount is required when escrow is required.');
      if (state.escrow_frequency == null) blocking.add('Escrow frequency is required when escrow is required.');
    } else if (state.escrow_required_state === 'not_required') {
      const n = num(state.escrow_amount);
      if (n != null && n > 0) blocking.add('Escrow is marked not required but a positive escrow amount is set.');
    } else if (state.escrow_required_state === 'unspecified' || state.escrow_required_state === 'not_disclosed') {
      warnings.add('Escrow requirement is not disclosed; estimated net will be incomplete.');
    }
  }

  // Run the canonical calculator to compute financial estimate + conflict
  const input = buildCanonicalFinancialInput(state);
  const estimate = calculateCanonicalOpportunityFinancials(input);
  if (estimate.status === 'conflict') {
    estimate.conflicts.forEach((c) => blocking.add(c));
  }

  // Legacy mixed hint
  if (state.legacy_mixed_pay_hint) {
    warnings.add('Legacy mixed-pay row: reconstruct at least two named pay components before publishing.');
  }

  const sortDedup = (set: Set<string>) => Array.from(set).sort((a, b) => a.localeCompare(b));

  const canPublish = canSaveDraft && blocking.size === 0;

  return {
    canSaveDraft,
    canPublish,
    blockingReasons: sortDedup(blocking),
    warnings: sortDedup(warnings),
    financialEstimate: estimate,
  };
}

// ---------------- persistence projection ----------------

const EMPLOYMENT_TO_LEGACY_DRIVER_TYPE: Record<CanonicalEmploymentModel, string | null> = {
  company_driver: 'company',
  contractor_1099: '1099',
  owner_operator: 'owner_operator',
  lease_purchase: 'lease_purchase',
  unknown: null,
};

type PersistencePayload = Omit<
  TablesInsert<'opportunities'>,
  'recruiter_id' | 'admin_review_status' | 'featured' | 'view_count' | 'published_at' | 'id'
>;

export function buildOpportunityPersistencePayload(
  state: CanonicalOpportunityAuthoringState,
  mode: 'draft' | 'publish',
): PersistencePayload {
  const em = state.employment_model;
  const pm = state.pay_model;
  const isCompany = em === 'company_driver';
  const isCostBearing = em === 'contractor_1099' || em === 'owner_operator' || em === 'lease_purchase';
  const leaseRelevant = em === 'lease_purchase';

  const trimOrNull = (v: string) => (v.trim() === '' ? null : v.trim());

  // costs
  const insuranceAmount = isCostBearing ? numOrNull(state.insurance_amount) : null;
  const insuranceFreq = isCostBearing ? state.insurance_frequency : null;
  const maintAmount = isCostBearing ? numOrNull(state.maintenance_amount) : null;
  const maintFreq = isCostBearing ? state.maintenance_frequency : null;
  const otherCostAmount = isCostBearing ? numOrNull(state.other_cost_amount) : null;
  const otherCostFreq = isCostBearing ? state.other_cost_frequency : null;
  const leaseAmount = leaseRelevant ? numOrNull(state.lease_amount) : null;
  const leaseFreq = leaseRelevant ? state.lease_frequency : null;

  const escrowState = isCostBearing && state.escrow_required_state !== 'unspecified'
    ? state.escrow_required_state
    : null;
  const escrowRequiredBool = escrowState === 'required';
  const escrowAmount = escrowState === 'required'
    ? numOrNull(state.escrow_amount)
    : (escrowState === 'not_required' ? null : (isCostBearing ? numOrNull(state.escrow_amount) : null));
  const escrowFreq = escrowState === 'required'
    ? state.escrow_frequency
    : (escrowState === 'not_required' ? null : (isCostBearing ? state.escrow_frequency : null));

  // pay-model exclusive clearing
  const cpmVal = pm === 'cpm' ? numOrNull(state.cpm) : null;
  const pctVal = pm === 'percentage' ? numOrNull(state.percentage_rate) : null;
  const flatVal = pm === 'flat_weekly' ? numOrNull(state.flat_weekly_pay) : null;
  const salaryAmt = pm === 'salary' ? numOrNull(state.salary_amount) : null;
  const salaryFreq = pm === 'salary' ? state.salary_frequency : null;
  const mixedComponents = pm === 'mixed'
    ? state.mixed_pay_components
        .filter((c) => c.label.trim() !== '' || c.amount !== '' || c.frequency != null)
        .map((c) => ({
          label: c.label.trim(),
          amount: numOrNull(c.amount),
          frequency: c.frequency,
        }))
    : [];
  const otherLabel = pm === 'other' ? trimOrNull(state.other_pay_method_label) : null;
  const otherWeekly = pm === 'other' ? numOrNull(state.other_weekly_gross) : null;
  const percentageBasisLabel = pm === 'percentage' ? trimOrNull(state.percentage_basis_label) : null;
  const percentageWeeklyBasis = pm === 'percentage' ? numOrNull(state.percentage_weekly_revenue_basis) : null;

  const legacyDriverType = EMPLOYMENT_TO_LEGACY_DRIVER_TYPE[em];

  const status = mode === 'publish' ? 'active' : 'draft';

  // Preserve legacy dual-write for benefits
  const legacyBenefits = joinBenefits({
    typical_lanes: state.typical_lanes,
    requirements: state.requirements,
  }) || null;

  return {
    canonical_version: 1,
    title: state.title.trim(),
    company_name: state.company_name.trim(),
    employment_model: em === 'unknown' ? null : em,
    team_configuration: state.team_configuration === 'unspecified' ? null : state.team_configuration,
    driver_type: legacyDriverType,
    route_type: trimOrNull(state.route_type),
    trailer_type: trimOrNull(state.trailer_type),
    hiring_city: trimOrNull(state.hiring_city),
    hiring_state: trimOrNull(state.hiring_state),
    hiring_states: state.hiring_states.slice(),
    pay_model: pm === 'unknown' ? null : pm,
    cpm: cpmVal,
    percentage_pay: pctVal,
    percentage_basis_label: percentageBasisLabel,
    percentage_weekly_revenue_basis: percentageWeeklyBasis,
    flat_weekly_pay: flatVal,
    salary_amount: salaryAmt,
    salary_frequency: salaryFreq,
    mixed_pay_components: mixedComponents as unknown as PersistencePayload['mixed_pay_components'],
    other_pay_method_label: otherLabel,
    other_weekly_gross: otherWeekly,
    estimated_weekly_gross: numOrNull(state.recruiter_provided_weekly_gross),
    estimated_weekly_miles: numOrNull(state.estimated_weekly_miles),
    estimated_loaded_miles: numOrNull(state.estimated_loaded_miles),
    estimated_deadhead_miles: numOrNull(state.estimated_deadhead_miles),
    deadhead_paid: yesNoToBool(state.deadhead_paid),
    detention_pay: trimOrNull(state.detention_pay),
    layover_pay: trimOrNull(state.layover_pay),
    sign_on_bonus: numOrNull(state.sign_on_bonus),
    fuel_paid_by: isCompany ? null : trimOrNull(state.fuel_paid_by),
    insurance_deductions: insuranceAmount,
    insurance_deduction_frequency: insuranceFreq,
    escrow_required: escrowRequiredBool,
    escrow_required_state: escrowState,
    escrow_amount: escrowAmount,
    escrow_amount_frequency: escrowFreq,
    lease_payment: leaseAmount,
    lease_payment_frequency: leaseFreq,
    maintenance_deductions: maintAmount,
    maintenance_deduction_frequency: maintFreq,
    other_deductions: otherCostAmount,
    other_deduction_frequency: otherCostFreq,
    home_time: trimOrNull(state.home_time),
    forced_dispatch: yesNoToBool(state.forced_dispatch),
    pets_allowed: yesNoToBool(state.pets_allowed),
    riders_allowed: yesNoToBool(state.riders_allowed),
    equipment_year: trimOrNull(state.equipment_year),
    typical_lanes: trimOrNull(state.typical_lanes),
    requirements: trimOrNull(state.requirements),
    actual_benefits: trimOrNull(state.actual_benefits),
    benefits: legacyBenefits,
    description: trimOrNull(state.description),
    transparency_confirmed: state.transparency_confirmed,
    status,
  };
}

// Re-exports for downstream consumers.
export { normalizeRecurringAmountToWeekly };
export type {
  CanonicalEmploymentModel,
  CanonicalPayModel,
  CanonicalOpportunityFinancialEstimate,
  CanonicalOpportunityFinancialInput,
  Disclosure,
  RecurringFrequency,
};
