// Phase CF-1C-B — Structured qualification authoring + AI text extraction.
//
// Covers the authoring state contract, persistence fail-closed semantics, the
// pure extractor merge, the recruiter authoring controls, the review preview,
// and static guards over the ai-insight extraction prompt/tool schema.
//
// Structured criteria are OPTIONAL recruiter declarations. They must never
// become publication blockers and must never rewrite the free-text
// `requirements` field.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedOpportunity } from '@/components/opportunities/PasteOpportunityDialog';
import type { Json, Tables } from '@/integrations/supabase/types';
import type {
  OpportunityInsert,
  OpportunityUpdate,
} from '@/hooks/opportunities/useRecruiterOpportunities';

import {
  AUTHORING_CDL_CLASS_VALUES,
  AUTHORING_ENDORSEMENT_CODES,
  buildOpportunityPersistencePayload,
  EMPTY_AUTHORING_STATE,
  normalizeOpportunityForAuthoring,
  validateOpportunityReadiness,
  type CanonicalOpportunityAuthoringState,
} from '@/lib/opportunities/opportunityCanonical';

const h = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  createMutate: vi.fn<(payload: OpportunityInsert) => void>(),
  updateMutate: vi.fn<(args: { id: string; data: OpportunityUpdate }) => void>(),
  pastePayload: {} as ExtractedOpportunity,
}));

vi.mock('sonner', () => ({
  toast: { error: h.toastError, success: h.toastSuccess },
}));
vi.mock('@/hooks/opportunities/useRecruiterProfile', () => ({
  useRecruiterProfile: vi.fn(),
}));
vi.mock('@/hooks/opportunities/useRecruiterOpportunities', () => ({
  useRecruiterOpportunities: vi.fn(),
}));
vi.mock('@/components/opportunities/PasteOpportunityDialog', () => ({
  extractOpportunityFromText: vi.fn(),
  PasteOpportunityDialog: ({
    open, onExtracted,
  }: { open: boolean; onExtracted: (data: ExtractedOpportunity) => void }) =>
    open ? (
      <button type="button" onClick={() => onExtracted(h.pastePayload)}>
        Apply extracted opportunity
      </button>
    ) : null,
}));

import {
  AUTHORING_ENDORSEMENT_OPTIONS,
  mergePasteIntoState,
  RecruiterOpportunityForm,
} from '@/components/opportunities/RecruiterOpportunityForm';
import { useRecruiterOpportunities } from '@/hooks/opportunities/useRecruiterOpportunities';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

type Opportunity = Tables<'opportunities'>;
type RecruiterProfile = Tables<'recruiter_profiles'> & { company_type: string | null };

const state = (
  overrides: Partial<CanonicalOpportunityAuthoringState> = {},
): CanonicalOpportunityAuthoringState => ({ ...EMPTY_AUTHORING_STATE, ...overrides });

const ROOT = process.cwd();
const readSource = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CANONICAL_SRC = 'src/lib/opportunities/opportunityCanonical.ts';
const PASTE_SRC = 'src/components/opportunities/PasteOpportunityDialog.tsx';
const FORM_SRC = 'src/components/opportunities/RecruiterOpportunityForm.tsx';
const EDGE_SRC = 'supabase/functions/ai-insight/index.ts';

/* ---------------- 1-3) authoring state defaults + normalization ---------------- */

describe('CF-1C-B 1) EMPTY authoring defaults', () => {
  it('1a) defaults are exactly the neutral empty string / empty string / empty array', () => {
    expect(EMPTY_AUTHORING_STATE.min_years_experience).toBe('');
    expect(EMPTY_AUTHORING_STATE.required_cdl_class).toBe('');
    expect(EMPTY_AUTHORING_STATE.required_endorsements).toEqual([]);
  });

  it('1b) recruiter-visible endorsement vocabulary is exactly H, N, P, T, X — S is absent', () => {
    expect([...AUTHORING_ENDORSEMENT_CODES].sort()).toEqual(['H', 'N', 'P', 'T', 'X']);
    expect(AUTHORING_ENDORSEMENT_CODES as readonly string[]).not.toContain('S');
    expect([...AUTHORING_CDL_CLASS_VALUES]).toEqual(['A', 'B', 'C']);
  });
});

describe('CF-1C-B 2) neutral existing row normalization', () => {
  it('2a) null / null / [] normalizes to the neutral authoring defaults', () => {
    const result = normalizeOpportunityForAuthoring({
      min_years_experience: null,
      required_cdl_class: null,
      required_endorsements: [],
    });
    expect(result.min_years_experience).toBe('');
    expect(result.required_cdl_class).toBe('');
    expect(result.required_endorsements).toEqual([]);
  });

  it('2b) an entirely absent row still yields neutral criteria', () => {
    const result = normalizeOpportunityForAuthoring(null);
    expect(result.min_years_experience).toBe('');
    expect(result.required_cdl_class).toBe('');
    expect(result.required_endorsements).toEqual([]);
  });
});

describe('CF-1C-B 3) populated normalization', () => {
  it('3a) numeric years become a string, class is preserved, endorsements uppercase/dedupe', () => {
    const result = normalizeOpportunityForAuthoring({
      min_years_experience: 2.5,
      required_cdl_class: 'A',
      required_endorsements: ['h', 'H', 't'],
    });
    expect(result.min_years_experience).toBe('2.5');
    expect(result.required_cdl_class).toBe('A');
    expect(result.required_endorsements).toEqual(['H', 'T']);
  });

  it('3b) unsupported class and unsupported codes fail closed to neutral', () => {
    const result = normalizeOpportunityForAuthoring({
      min_years_experience: 'not-a-number',
      required_cdl_class: 'D',
      required_endorsements: ['S', 'Z', '', 'n'],
    });
    expect(result.min_years_experience).toBe('');
    expect(result.required_cdl_class).toBe('');
    expect(result.required_endorsements).toEqual(['N']);
  });

  it('3c) a non-array endorsements value never produces null', () => {
    const result = normalizeOpportunityForAuthoring({
      required_endorsements: null as unknown as string[],
    });
    expect(result.required_endorsements).toEqual([]);
  });
});

/* ---------------- 4-6) persistence payload ---------------- */

describe('CF-1C-B 4) neutral persistence payload', () => {
  it('4a) blank criteria persist as null / null / [] and endorsements are never null', () => {
    const payload = buildOpportunityPersistencePayload(
      state({ title: 'x', company_name: 'y' }),
      'draft',
    );
    expect(payload.min_years_experience).toBeNull();
    expect(payload.required_cdl_class).toBeNull();
    expect(payload.required_endorsements).toEqual([]);
    expect(payload.required_endorsements).not.toBeNull();
  });
});

describe('CF-1C-B 5) populated persistence payload', () => {
  it('5a) populated criteria persist as number / class / deduped uppercase array', () => {
    const payload = buildOpportunityPersistencePayload(
      state({
        title: 'x',
        company_name: 'y',
        min_years_experience: '2',
        required_cdl_class: 'A',
        required_endorsements: ['t', 'H', 'H'],
      }),
      'draft',
    );
    expect(payload.min_years_experience).toBe(2);
    expect(payload.required_cdl_class).toBe('A');
    expect(payload.required_endorsements).toEqual(['T', 'H']);
  });

  it('5b) decimal years are preserved exactly', () => {
    const payload = buildOpportunityPersistencePayload(
      state({ title: 'x', company_name: 'y', min_years_experience: '1.5' }),
      'draft',
    );
    expect(payload.min_years_experience).toBe(1.5);
  });
});

describe('CF-1C-B 6) invalid values fail closed and never block publication', () => {
  const invalidCases: Array<[string, Partial<CanonicalOpportunityAuthoringState>]> = [
    ['non-numeric years', { min_years_experience: 'abc' }],
    ['negative years', { min_years_experience: '-3' }],
    ['unsupported class', { required_cdl_class: 'D' }],
    ['lowercase junk class', { required_cdl_class: 'z' }],
    ['unsupported endorsement codes', { required_endorsements: ['S', 'Q'] }],
  ];

  it.each(invalidCases)('6a) %s persists neutrally', (_label, overrides) => {
    const payload = buildOpportunityPersistencePayload(
      state({ title: 'x', company_name: 'y', ...overrides }),
      'draft',
    );
    if ('min_years_experience' in overrides) expect(payload.min_years_experience).toBeNull();
    if ('required_cdl_class' in overrides) expect(payload.required_cdl_class).toBeNull();
    if ('required_endorsements' in overrides) expect(payload.required_endorsements).toEqual([]);
  });

  it.each(invalidCases)('6b) %s adds no blocker and no warning', (_label, overrides) => {
    const baseline = validateOpportunityReadiness(state({ title: 'x', company_name: 'y' }));
    const withCriteria = validateOpportunityReadiness(
      state({ title: 'x', company_name: 'y', ...overrides }),
    );
    expect(withCriteria.blockingReasons).toEqual(baseline.blockingReasons);
    expect(withCriteria.warnings).toEqual(baseline.warnings);
    expect(withCriteria.canSaveDraft).toBe(baseline.canSaveDraft);
  });

  it('6c) valid structured criteria also add no blocker', () => {
    const baseline = validateOpportunityReadiness(state({ title: 'x', company_name: 'y' }));
    const withCriteria = validateOpportunityReadiness(state({
      title: 'x',
      company_name: 'y',
      min_years_experience: '2',
      required_cdl_class: 'A',
      required_endorsements: ['H'],
    }));
    expect(withCriteria.blockingReasons).toEqual(baseline.blockingReasons);
  });

  it('6d) structured criteria are excluded from the global invalid-numeric blocker set', () => {
    const src = readSource(CANONICAL_SRC);
    const fnStart = src.indexOf('function anyInvalidNumericProvided');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = src.slice(fnStart, src.indexOf('\n}', fnStart));
    expect(fnBody).not.toContain('min_years_experience');
    expect(fnBody).not.toContain('required_cdl_class');
    expect(fnBody).not.toContain('required_endorsements');
  });
});

/* ---------------- 7) free-text requirements preserved ---------------- */

describe('CF-1C-B 7) free-text requirements is never rewritten from structured criteria', () => {
  const freeText = '• Clean MVR last 3 years\n• No DUI\n• SAP program complete';

  it('7a) normalization preserves the stored free text verbatim', () => {
    const result = normalizeOpportunityForAuthoring({
      requirements: freeText,
      min_years_experience: 2,
      required_cdl_class: 'A',
      required_endorsements: ['H'],
    });
    expect(result.requirements).toBe(freeText);
  });

  it('7b) persistence preserves the free text verbatim alongside structured criteria', () => {
    const payload = buildOpportunityPersistencePayload(
      state({
        title: 'x',
        company_name: 'y',
        requirements: freeText,
        min_years_experience: '2',
        required_cdl_class: 'A',
        required_endorsements: ['H'],
      }),
      'draft',
    );
    expect(payload.requirements).toBe(freeText);
  });

  it('7c) setting structured criteria does not change the persisted requirements value', () => {
    const withoutCriteria = buildOpportunityPersistencePayload(
      state({ title: 'x', company_name: 'y', requirements: freeText }),
      'draft',
    );
    const withCriteria = buildOpportunityPersistencePayload(
      state({
        title: 'x',
        company_name: 'y',
        requirements: freeText,
        min_years_experience: '4',
        required_cdl_class: 'B',
        required_endorsements: ['N'],
      }),
      'draft',
    );
    expect(withCriteria.requirements).toBe(withoutCriteria.requirements);
  });
});

/* ---------------- 8-9) extractor merge ---------------- */

describe('CF-1C-B 8) extractor merge fills only neutral criteria', () => {
  it('8a) fills all three when recruiter state is neutral', () => {
    const merged = mergePasteIntoState(state(), {
      min_years_experience: 2,
      required_cdl_class: 'A',
      required_endorsements: ['h', 'T'],
    });
    expect(merged.min_years_experience).toBe('2');
    expect(merged.required_cdl_class).toBe('A');
    expect(merged.required_endorsements).toEqual(['H', 'T']);
  });

  it('8b) never overwrites recruiter-entered values', () => {
    const merged = mergePasteIntoState(
      state({
        min_years_experience: '5',
        required_cdl_class: 'B',
        required_endorsements: ['P'],
      }),
      {
        min_years_experience: 1,
        required_cdl_class: 'A',
        required_endorsements: ['H'],
      },
    );
    expect(merged.min_years_experience).toBe('5');
    expect(merged.required_cdl_class).toBe('B');
    expect(merged.required_endorsements).toEqual(['P']);
  });

  it('8c) rejects unsupported extracted values rather than storing them', () => {
    const merged = mergePasteIntoState(state(), {
      min_years_experience: -1,
      required_cdl_class: 'D',
      required_endorsements: ['S', 'Q'],
    });
    expect(merged.min_years_experience).toBe('');
    expect(merged.required_cdl_class).toBe('');
    expect(merged.required_endorsements).toEqual([]);
  });

  it('8d) an extraction with no structured fields leaves criteria neutral', () => {
    const merged = mergePasteIntoState(state(), { title: 'Regional Dry Van' });
    expect(merged.min_years_experience).toBe('');
    expect(merged.required_cdl_class).toBe('');
    expect(merged.required_endorsements).toEqual([]);
  });

  it('8e) the merge is pure — the input state object is not mutated', () => {
    const before = state();
    mergePasteIntoState(before, { min_years_experience: 3, required_cdl_class: 'A' });
    expect(before.min_years_experience).toBe('');
    expect(before.required_cdl_class).toBe('');
  });
});

describe('CF-1C-B 9) no local inference of structured criteria', () => {
  it('9a) trailer / route / driver type and free text never produce structured criteria', () => {
    const merged = mergePasteIntoState(state(), {
      trailer_type: 'Tanker',
      route_type: 'OTR',
      driver_type: 'company',
      title: 'Class A Hazmat Driver',
      description: 'Hazmat tanker freight, doubles experience preferred.',
      requirements: 'Class A CDL with hazmat and tanker endorsements, 2 years experience',
    });
    expect(merged.min_years_experience).toBe('');
    expect(merged.required_cdl_class).toBe('');
    expect(merged.required_endorsements).toEqual([]);
    // Free text is still merged as free text.
    expect(merged.requirements).toContain('Class A CDL');
  });

  it('9b) separately extracted H and N are never combined into X locally', () => {
    const merged = mergePasteIntoState(state(), { required_endorsements: ['H', 'N'] });
    expect(merged.required_endorsements).toEqual(['H', 'N']);
    expect(merged.required_endorsements).not.toContain('X');
  });
});

/* ---------------- 10-11) rendered recruiter form ---------------- */

function makeRecruiterProfile(): RecruiterProfile {
  const impl: unknown = {
    admin_notes: null, company_address: null, company_city: null,
    company_name: 'Acme Trucking', company_type: 'carrier', company_phone: null,
    company_state: null, company_website: null, created_at: '2026-07-01T00:00:00Z',
    dot_number: '123456', dispatch_week_start_day: 'sunday', pay_period_cadence: 'weekly',
    pay_period_anchor_date: null, driver_types_hired: [], equipment_types: [],
    hiring_states: [], id: 'r-1', legacy_terms_grandfathered_at: null,
    posting_terms_accepted_at: '2026-07-17T00:00:00Z', posting_terms_version: '2026-07-17.v1',
    recruiter_email: 'jane@acme.example', recruiter_name: 'Jane Recruiter',
    recruiter_phone: null, status: 'active', updated_at: '2026-07-01T00:00:00Z',
    user_id: 'u-1', verification_status: 'approved', verified_at: '2026-07-01T00:00:00Z',
    verified_by: 'admin-1',
  };
  return impl as RecruiterProfile;
}

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  const impl: unknown = {
    min_years_experience: null, required_cdl_class: null, required_endorsements: [],
    actual_benefits: null, admin_review_status: 'approved', benefits: null,
    canonical_version: 1, company_name: 'Acme Trucking', cpm: 0.65,
    created_at: '2026-07-01T00:00:00Z', deadhead_paid: false,
    description: 'Great regional lane.', detention_pay: null, driver_type: 'company',
    employment_model: 'company_driver', equipment_year: null, escrow_amount: null,
    escrow_amount_frequency: null, escrow_required: false, escrow_required_state: null,
    estimated_deadhead_miles: null, estimated_loaded_miles: 2600,
    estimated_weekly_gross: null, estimated_weekly_miles: 2800, featured: false,
    flat_weekly_pay: null, forced_dispatch: null, fuel_paid_by: null,
    hiring_city: 'Dallas', hiring_state: 'TX', hiring_states: [], home_time: 'Home weekly',
    id: 'opp-1', insurance_deduction_frequency: null, insurance_deductions: null,
    layover_pay: null, lease_payment: null, lease_payment_frequency: null,
    maintenance_deduction_frequency: null, maintenance_deductions: null,
    mixed_pay_components: [] as Json, other_deduction_frequency: null,
    other_deductions: null, other_pay_method_label: null, other_weekly_gross: null,
    pay_model: 'cpm', percentage_basis_label: null, percentage_pay: null,
    percentage_weekly_revenue_basis: null, pets_allowed: null,
    published_at: '2026-07-01T00:00:00Z', recruiter_id: 'r-1', requirements: null,
    riders_allowed: null, route_type: 'Regional', salary_amount: null,
    salary_frequency: null, sign_on_bonus: null, status: 'active',
    team_configuration: 'solo', title: 'Regional Dry Van', trailer_type: 'Dry Van',
    transparency_confirmed: true, typical_lanes: null,
    updated_at: '2026-07-01T00:00:00Z', view_count: 0,
    ...overrides,
  };
  return impl as Opportunity;
}

function renderForm(initial: Opportunity | null = null) {
  return render(
    <RecruiterOpportunityForm initial={initial} onBack={vi.fn()} onSaved={vi.fn()} />,
  );
}

function gotoStage(label: string) {
  fireEvent.click(screen.getByRole('tab', { name: new RegExp(label) }));
}

function openRequirementsGroup() {
  gotoStage('Optional Details');
  const group = screen.getByTestId('group-requirements');
  const trigger = within(group).getByRole('button');
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.pastePayload = {} as ExtractedOpportunity;
  const profileHook: unknown = {
    profile: makeRecruiterProfile(), isLoading: false, isApproved: true,
    isSuspended: false, canPost: true, isVerified: true, isProfileComplete: true,
    refetch: vi.fn(), refetchProfile: vi.fn(async () => makeRecruiterProfile()),
    upsertProfile: { mutateAsync: vi.fn(), isPending: false },
    saveRecruiterProfile: { mutateAsync: vi.fn(), isPending: false },
  };
  const oppsHook: unknown = {
    opportunities: [], isLoading: false, isError: false, error: null, refetch: vi.fn(),
    recruiterId: 'r-1', isApproved: true, canPost: true, isVerified: true,
    createOpportunity: { mutate: h.createMutate, isPending: false },
    updateOpportunity: { mutate: h.updateMutate, isPending: false },
    setStatus: { mutate: vi.fn(), isPending: false },
  };
  vi.mocked(useRecruiterProfile).mockReturnValue(
    profileHook as ReturnType<typeof useRecruiterProfile>,
  );
  vi.mocked(useRecruiterOpportunities).mockReturnValue(
    oppsHook as ReturnType<typeof useRecruiterOpportunities>,
  );
});

afterEach(() => cleanup());

describe('CF-1C-B 10) optional structured controls in the authoring form', () => {
  it('10a) renders the structured criteria subsection with all three controls', () => {
    renderForm();
    openRequirementsGroup();
    const section = screen.getByTestId('structured-qualification-criteria');
    expect(within(section).getByLabelText('Minimum CDL experience (years)')).toBeInTheDocument();
    expect(within(section).getByLabelText('Required CDL class')).toBeInTheDocument();
    expect(within(section).getByTestId('criteria-endorsements')).toBeInTheDocument();
  });

  it('10b) renders exactly the H, N, X, T, P chips — S is absent', () => {
    renderForm();
    openRequirementsGroup();
    const chips = within(screen.getByTestId('criteria-endorsements')).getAllByRole('button');
    expect(chips.map((c) => c.getAttribute('data-testid'))).toEqual([
      'criteria-endorsement-H',
      'criteria-endorsement-N',
      'criteria-endorsement-X',
      'criteria-endorsement-T',
      'criteria-endorsement-P',
    ]);
    expect(screen.queryByTestId('criteria-endorsement-S')).toBeNull();
    expect(AUTHORING_ENDORSEMENT_OPTIONS.map((o) => o.code)).not.toContain('S');
  });

  it('10c) helper copy explains structured comparison and points other rules at Requirements', () => {
    renderForm();
    openRequirementsGroup();
    const section = screen.getByTestId('structured-qualification-criteria');
    expect(section.textContent).toMatch(/Driver Work Profiles/);
    expect(section.textContent).toMatch(/Requirements/);
  });

  it('10d) the structured subsection is rendered above the free-text Requirements field', () => {
    renderForm();
    openRequirementsGroup();
    const section = screen.getByTestId('structured-qualification-criteria');
    const freeText = screen.getByLabelText('Requirements');
    expect(
      section.compareDocumentPosition(freeText) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('10e) the endorsement chips toggle on and off', () => {
    renderForm();
    openRequirementsGroup();
    const chip = screen.getByTestId('criteria-endorsement-H');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(screen.getByTestId('criteria-endorsement-H')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('criteria-endorsement-H'));
    expect(screen.getByTestId('criteria-endorsement-H')).toHaveAttribute('aria-pressed', 'false');
  });

  it('10f) the free-text Requirements field is still present and unchanged', () => {
    renderForm();
    openRequirementsGroup();
    expect(screen.getByLabelText('Requirements')).toBeInTheDocument();
  });
});

describe('CF-1C-B 11) review preview shows structured criteria only when set', () => {
  it('11a) renders no structured rows when nothing is declared', () => {
    renderForm(makeOpportunity());
    gotoStage('Review & Publish');
    const preview = screen.getByTestId('driver-preview');
    expect(within(preview).queryByText(/Minimum experience/i)).toBeNull();
    expect(within(preview).queryByText(/Required CDL class/i)).toBeNull();
    expect(within(preview).queryByText(/Required endorsements/i)).toBeNull();
  });

  it('11b) renders populated structured criteria before publish', () => {
    renderForm(makeOpportunity({
      min_years_experience: 2,
      required_cdl_class: 'A',
      required_endorsements: ['H', 'T'],
    }));
    gotoStage('Review & Publish');
    const preview = screen.getByTestId('driver-preview');
    expect(within(preview).getByText('Minimum experience')).toBeInTheDocument();
    expect(within(preview).getByText('2+ years')).toBeInTheDocument();
    expect(within(preview).getByText('Required CDL class')).toBeInTheDocument();
    expect(within(preview).getByText('Class A')).toBeInTheDocument();
    expect(within(preview).getByText('Required endorsements')).toBeInTheDocument();
    expect(within(preview).getByText('H, T')).toBeInTheDocument();
  });

  it('11c) renders only the declared subset', () => {
    renderForm(makeOpportunity({ required_cdl_class: 'B' }));
    gotoStage('Review & Publish');
    const preview = screen.getByTestId('driver-preview');
    expect(within(preview).getByText('Class B')).toBeInTheDocument();
    expect(within(preview).queryByText('Minimum experience')).toBeNull();
    expect(within(preview).queryByText('Required endorsements')).toBeNull();
  });
});

/* ---------------- 12) edge-function extraction contract ---------------- */

describe('CF-1C-B 12) ai-insight parse_opportunity extraction contract', () => {
  const edge = readSource(EDGE_SRC);

  it('12a) the tool schema declares all three structured fields', () => {
    expect(edge).toMatch(/min_years_experience:\s*\{/);
    expect(edge).toMatch(/required_cdl_class:\s*\{/);
    expect(edge).toMatch(/required_endorsements:\s*\{/);
  });

  it('12b) the CDL class enum is exactly A, B, C', () => {
    const m = edge.match(/required_cdl_class:\s*\{[\s\S]*?enum:\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const values = (m as RegExpMatchArray)[1].split(',').map((v) => v.trim().replace(/"/g, ''));
    expect(values).toEqual(['A', 'B', 'C']);
  });

  it('12c) the endorsement item enum is exactly H, N, P, T, X and never S', () => {
    const m = edge.match(/required_endorsements:\s*\{[\s\S]*?enum:\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const values = (m as RegExpMatchArray)[1].split(',').map((v) => v.trim().replace(/"/g, ''));
    expect(values).toEqual(['H', 'N', 'P', 'T', 'X']);
    expect(values).not.toContain('S');
  });

  it('12d) min_years_experience is a non-negative number', () => {
    const m = edge.match(/min_years_experience:\s*\{([\s\S]*?)\},/);
    expect(m).not.toBeNull();
    expect((m as RegExpMatchArray)[1]).toMatch(/type:\s*"number"/);
    expect((m as RegExpMatchArray)[1]).toMatch(/minimum:\s*0/);
  });

  it('12e) the prompt requires explicit statements and forbids inference', () => {
    const prompt = edge.slice(
      edge.indexOf('parse_opportunity: `'),
      edge.indexOf('};', edge.indexOf('parse_opportunity: `')),
    );
    expect(prompt).toMatch(/explicit/i);
    expect(prompt).toMatch(/Do NOT infer a class from route type, trailer type/);
    expect(prompt).toMatch(/Do NOT infer N from a tanker trailer/);
    expect(prompt).toMatch(/Never emit S/);
    expect(prompt).toMatch(/preferred/);
    expect(prompt).toMatch(/Never invent qualification criteria/);
  });

  it('12f) X is only emitted when explicitly required, never derived from H + N', () => {
    expect(edge).toMatch(/do NOT convert a separately stated H and N into X/i);
  });

  it('12g) free-text requirements extraction behavior is preserved and additive', () => {
    expect(edge).toMatch(/requirements: experience, CDL class, endorsements, MVR rules, drug test, age requirements/i);
    expect(edge).toMatch(/MVR, DUI, SAP, road test, drug test/);
    expect(edge).toMatch(/Never strip them from `requirements`/);
  });

  it('12h) model, auth, Pro gating and cache logic are untouched', () => {
    expect(edge).toMatch(/parse_opportunity: "google\/gemini-3-flash-preview"/);
    expect(edge).toMatch(/const PRO_TYPES = new Set\(\["lane_advice", "weekly_report", "tax_tips", "parse_expense", "parse_ratecon"\]\)/);
    expect(edge).toMatch(/const cacheableTypes = \["lane_advice", "weekly_report", "tax_tips"\]/);
    expect(edge).toMatch(/supabase\.auth\.getUser\(token\)/);
  });
});

/* ---------------- 13) scope guard ---------------- */

describe('CF-1C-B 13) scope guard', () => {
  const clientFiles = [CANONICAL_SRC, PASTE_SRC, FORM_SRC];

  it.each(clientFiles)('13a) %s introduces no billing/Stripe/Telegram coupling', (rel) => {
    const src = readSource(rel);
    expect(src).not.toMatch(/stripe/i);
    expect(src).not.toMatch(/telegram/i);
    expect(src).not.toMatch(/checkout_intent/i);
  });

  it.each(clientFiles)('13b) %s introduces no application/conversation coupling', (rel) => {
    const src = readSource(rel);
    expect(src).not.toMatch(/opportunity_applications/);
    expect(src).not.toMatch(/conversation_threads/);
    expect(src).not.toMatch(/conversation_messages/);
    expect(src).not.toMatch(/start_opportunity_conversation/);
  });

  it.each(clientFiles)('13c) %s introduces no auth/RLS/migration coupling', (rel) => {
    const src = readSource(rel);
    expect(src).not.toMatch(/auth\.users/);
    expect(src).not.toMatch(/row level security/i);
    expect(src).not.toMatch(/CREATE POLICY/i);
    expect(src).not.toMatch(/ALTER TABLE/i);
  });

  it('13d) the canonical module remains pure — no database or network I/O', () => {
    const src = readSource(CANONICAL_SRC);
    expect(src).not.toMatch(/supabase/);
    expect(src).not.toMatch(/\bfetch\(/);
  });

  it('13e) extraction still funnels through the single centralized invocation', () => {
    const paste = readSource(PASTE_SRC);
    expect(paste.match(/supabase\.functions\.invoke/g) ?? []).toHaveLength(1);
    expect(paste).toMatch(/type: 'parse_opportunity'/);
    const form = readSource(FORM_SRC);
    expect(form).toMatch(/extractOpportunityFromText/);
    expect(form).not.toMatch(/functions\.invoke/);
  });

  it('13f) the qualification and match engines were not edited by this phase', () => {
    const qual = readSource('src/lib/opportunities/opportunityQualification.ts');
    expect(qual).not.toMatch(/CF-1C-B/);
    const match = readSource('src/lib/opportunities/opportunityMatch.ts');
    expect(match).not.toMatch(/CF-1C-B/);
    expect(match).toMatch(/min_years_experience/);
  });
});
