// Phase 1O-A — Recruiter Opportunity Authoring + Review Reconstruction.
//
// Focused contract coverage for the reconstruction, held apart from the
// broader phase-1L-DE1 behavioural suite. These invariants are the reason
// Phase 1O-A exists: the four-stage authoring shell, the free-text-first
// Write & Extract entry point routed through the shared extractor, the
// three-mode Hiring Coverage editor with a Lower-48 constraint, and a
// Driver Preview that omits empty values instead of showing "Unavailable"
// or "Not disclosed" filler.

import { execFileSync } from 'node:child_process';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedOpportunity } from '@/components/opportunities/PasteOpportunityDialog';

import type { Json, Tables } from '@/integrations/supabase/types';
import type {
  OpportunityInsert,
  OpportunityUpdate,
} from '@/hooks/opportunities/useRecruiterOpportunities';

const h = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  createMutate: vi.fn<(payload: OpportunityInsert) => void>(),
  updateMutate: vi.fn<(args: { id: string; data: OpportunityUpdate }) => void>(),
  extract: vi.fn<(text: string) => Promise<ExtractedOpportunity>>(),
}));

vi.mock('sonner', () => ({ toast: { error: h.toastError, success: h.toastSuccess } }));
vi.mock('@/hooks/opportunities/useRecruiterProfile', () => ({
  useRecruiterProfile: vi.fn(),
}));
vi.mock('@/hooks/opportunities/useRecruiterOpportunities', () => ({
  useRecruiterOpportunities: vi.fn(),
}));
vi.mock('@/components/opportunities/PasteOpportunityDialog', () => ({
  extractOpportunityFromText: (text: string) => h.extract(text),
  PasteOpportunityDialog: () => null,
}));

import { RecruiterOpportunityForm } from '@/components/opportunities/RecruiterOpportunityForm';
import { useRecruiterOpportunities } from '@/hooks/opportunities/useRecruiterOpportunities';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

type Opportunity = Tables<'opportunities'>;
type RecruiterProfile = Tables<'recruiter_profiles'>;
type ProfileHook = ReturnType<typeof useRecruiterProfile>;
type OppsHook = ReturnType<typeof useRecruiterOpportunities>;

function makeRecruiterProfile(overrides: Partial<RecruiterProfile> = {}): RecruiterProfile {
  return {
    admin_notes: null, company_address: null, company_city: null,
    company_name: 'Acme Trucking', company_phone: null, company_state: null,
    company_type: 'carrier',
    company_website: null, created_at: '2026-07-01T00:00:00Z', dot_number: '123456',
    dispatch_week_start_day: 'sunday', pay_period_cadence: 'weekly', pay_period_anchor_date: null,
    driver_types_hired: [], equipment_types: [], hiring_states: [], id: 'r-1',
    legacy_terms_grandfathered_at: null, mc_number: null,
    posting_terms_accepted_at: '2026-07-17T00:00:00Z',
    posting_terms_version: '2026-07-17.v1', recruiter_email: 'jane@acme.example',
    recruiter_name: 'Jane Recruiter', recruiter_phone: null, status: 'active',
    updated_at: '2026-07-01T00:00:00Z', user_id: 'u-1', verification_status: 'approved',
    verified_at: '2026-07-01T00:00:00Z', verified_by: 'admin-1', ...overrides,
  };
}

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    actual_benefits: null, admin_review_status: 'approved', benefits: null,
    canonical_version: 1, company_name: 'Acme Trucking', cpm: 0.65,
    created_at: '2026-07-01T00:00:00Z', deadhead_paid: false,
    description: 'Great regional lane.', detention_pay: null,
    driver_type: 'company', employment_model: 'company_driver',
    equipment_year: null, escrow_amount: null, escrow_amount_frequency: null,
    escrow_required: false, escrow_required_state: null,
    estimated_deadhead_miles: null, estimated_loaded_miles: 2600,
    estimated_weekly_gross: null, estimated_weekly_miles: 2800, featured: false,
    flat_weekly_pay: null, forced_dispatch: null, fuel_paid_by: null,
    hiring_city: 'Dallas', hiring_state: 'TX', hiring_states: [],
    home_time: 'Home weekly', id: 'opp-1',
    insurance_deduction_frequency: null, insurance_deductions: null,
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
    updated_at: '2026-07-01T00:00:00Z', view_count: 0, ...overrides,
  };
}

function installMocks() {
  const profile = makeRecruiterProfile();
  const profileImpl: unknown = {
    profile, isLoading: false, isApproved: true, isSuspended: false,
    canPost: true, isVerified: true, isProfileComplete: true, refetch: vi.fn(),
  };
  vi.mocked(useRecruiterProfile).mockReturnValue(profileImpl as ProfileHook);
  const oppsImpl: unknown = {
    opportunities: [], isLoading: false, isError: false, error: null, refetch: vi.fn(),
    recruiterId: 'r-1', isApproved: true, canPost: true, isVerified: true,
    createOpportunity: { mutate: h.createMutate, isPending: false },
    updateOpportunity: { mutate: h.updateMutate, isPending: false },
    setStatus: { mutate: vi.fn(), isPending: false },
  };
  vi.mocked(useRecruiterOpportunities).mockReturnValue(oppsImpl as OppsHook);
}

function renderForm(initial: Opportunity | null = null) {
  return render(<RecruiterOpportunityForm initial={initial} onBack={vi.fn()} onSaved={vi.fn()} />);
}

function stageTab(label: string) {
  return screen.getByRole('tab', { name: new RegExp(label) });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.extract.mockReset();
  installMocks();
});

afterEach(() => cleanup());

describe('Phase 1O-A — four-stage authoring shell', () => {
  it('mounts exactly four ordered stage tabs with the exact reconstruction labels', () => {
    renderForm();
    const tabs = within(screen.getByRole('tablist', { name: /authoring stages/i }))
      .getAllByRole('tab').map((t) => t.textContent?.replace(/^\d+/, '').trim() ?? '');
    expect(tabs).toEqual([
      'Write & Extract',
      'Essentials',
      'Optional Details',
      'Review & Publish',
    ]);
  });

  it('new opportunities start on Write & Extract; editing an existing opportunity starts on Essentials', () => {
    const { unmount } = renderForm();
    expect(stageTab('Write & Extract')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('stage-write')).toBeInTheDocument();
    unmount();

    renderForm(makeOpportunity());
    expect(stageTab('Essentials')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('stage-essentials')).toBeInTheDocument();
  });

  it('Write & Extract exposes a free-text area and gates Extract details behind 30+ characters', () => {
    renderForm();
    const area = screen.getByLabelText('Write or paste the opportunity');
    const extract = screen.getByRole('button', { name: /Extract details/i });
    expect(area).toBeInTheDocument();
    expect(extract).toBeDisabled();
    fireEvent.change(area, { target: { value: 'too short' } });
    expect(extract).toBeDisabled();
    fireEvent.change(area, { target: { value: 'This opportunity is a regional dry van run out of Dallas paying well.' } });
    expect(extract).toBeEnabled();
  });
});

describe('Phase 1O-A — inline extractor routes through the shared helper', () => {
  it('Extract details forwards the raw text to extractOpportunityFromText and merges the parsed result into essentials', async () => {
    h.extract.mockResolvedValueOnce({
      title: 'Extracted Title',
      home_time: 'Home weekly',
    } as ExtractedOpportunity);

    renderForm();
    const area = screen.getByLabelText('Write or paste the opportunity');
    const text = 'ABC Logistics is hiring regional dry van drivers out of Dallas, TX.';
    fireEvent.change(area, { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: /Extract details/i }));

    await vi.waitFor(() => expect(h.extract).toHaveBeenCalledTimes(1));
    expect(h.extract).toHaveBeenCalledWith(text);

    fireEvent.click(stageTab('Essentials'));
    // Unresolved fields adopt the extracted values.
    await vi.waitFor(() =>
      expect(screen.getByLabelText('Opportunity Title')).toHaveValue('Extracted Title'),
    );
    expect(screen.getByLabelText('Home Time')).toHaveValue('Home weekly');
  });


  it('extractor failures surface as toast errors and leave the form untouched', async () => {
    h.extract.mockRejectedValueOnce(new Error('AI returned no structured data.'));
    renderForm();
    const area = screen.getByLabelText('Write or paste the opportunity');
    fireEvent.change(area, { target: { value: 'Regional dry van driver opportunity out of Dallas, TX right now.' } });
    fireEvent.click(screen.getByRole('button', { name: /Extract details/i }));

    await vi.waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    fireEvent.click(stageTab('Essentials'));
    expect(screen.getByLabelText('Opportunity Title')).toHaveValue('');
  });
});

describe('Phase 1O-A — Hiring Coverage modes', () => {
  function gotoEssentials() { fireEvent.click(stageTab('Essentials')); }

  it('exposes exactly the three coverage modes as an accessible radiogroup', () => {
    renderForm();
    gotoEssentials();
    const group = screen.getByRole('radiogroup', { name: 'Hiring Coverage' });
    const modes = within(group).getAllByRole('radio').map((r) => r.textContent?.trim() ?? '');
    expect(modes).toEqual(['Nationwide — Lower 48', 'Selected States', 'Local / Metro Area']);
  });

  it('Nationwide surfaces the Lower-48 hint and no state selector or local city/state', () => {
    renderForm();
    gotoEssentials();
    fireEvent.click(screen.getByTestId('coverage-mode-nationwide'));
    expect(screen.getByTestId('coverage-nationwide-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('coverage-selected')).toBeNull();
    expect(screen.queryByTestId('coverage-local')).toBeNull();
  });

  it('Selected States exposes exactly the 48 contiguous state chips (AK / HI / DC absent)', () => {
    // Coverage mode is inferred from state — seed a single hiring state so the
    // form opens in the Selected-States mode.
    renderForm(makeOpportunity({
      hiring_states: ['TX'],
      hiring_city: '',
      hiring_state: '',
    }));
    gotoEssentials();
    const grid = screen.getByTestId('coverage-selected');
    const codes = within(grid).getAllByRole('button').map((b) => b.textContent?.trim() ?? '');
    expect(codes).toHaveLength(48);
    expect(new Set(codes).size).toBe(48);
    for (const forbidden of ['AK', 'HI', 'DC']) {
      expect(codes).not.toContain(forbidden);
    }
  });


  it('Local mode exposes a single hiring city + state pair', () => {
    renderForm();
    gotoEssentials();
    fireEvent.click(screen.getByTestId('coverage-mode-local'));
    const local = screen.getByTestId('coverage-local');
    expect(within(local).getByLabelText('Hiring City')).toBeInTheDocument();
    expect(within(local).getByLabelText('Hiring State')).toBeInTheDocument();
    expect(screen.queryByTestId('coverage-selected')).toBeNull();
  });
});

describe('Phase 1O-A — Driver Preview truthfulness', () => {
  function gotoReview() { fireEvent.click(stageTab('Review & Publish')); }

  it('omits any row whose value is missing rather than printing filler like "Unavailable" or "—"', () => {
    renderForm(makeOpportunity({
      sign_on_bonus: null,
      detention_pay: null,
      layover_pay: null,
      benefits: null,
      actual_benefits: null,
      typical_lanes: null,
      requirements: null,
    }));
    gotoReview();
    const preview = screen.getByTestId('driver-preview');
    expect(preview.textContent ?? '').not.toMatch(/Unavailable/i);
    expect(preview.textContent ?? '').not.toMatch(/Not disclosed/i);
    expect(within(preview).queryByText(/^—$/)).toBeNull();
    expect(within(preview).queryByText(/^N\/A$/)).toBeNull();
  });

  it('renders positive optional values when present (sign-on bonus routed through the one-time incentive row)', () => {
    renderForm(makeOpportunity({ sign_on_bonus: 2500 }));
    gotoReview();
    const preview = screen.getByTestId('driver-preview');
    expect(within(preview).getByText(/\$2,500/)).toBeInTheDocument();
    expect(within(preview).getByText(/paid separately from weekly earnings/i)).toBeInTheDocument();
  });

});

describe('Phase 1O-A-R2 — interactive Selected States entry from empty state', () => {
  it('clicking Selected States from an empty/local start opens the 48-chip grid without pre-seeding hiring_states', () => {
    renderForm();
    fireEvent.click(stageTab('Essentials'));
    fireEvent.click(screen.getByTestId('coverage-mode-selected'));
    const grid = screen.getByTestId('coverage-selected');
    const codes = within(grid).getAllByRole('button').map((b) => b.textContent?.trim() ?? '');
    expect(codes).toHaveLength(48);
    const pressed = within(grid).getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toEqual([]);
  });
});

describe('Phase 1O-A-R2 — locked publication checklist + preview + cost-note copy', () => {
  function gotoReview() { fireEvent.click(stageTab('Review & Publish')); }

  it('Publication Checklist uses the locked helper sentence and success detail', () => {
    renderForm(makeOpportunity());
    gotoReview();
    const checklist = screen.getByTestId('publication-checklist');
    expect(within(checklist).getByText(
      'Complete the required details before publishing. Warnings do not block publication.',
    )).toBeInTheDocument();
    expect(within(checklist).getByText('No required details are missing.')).toBeInTheDocument();
  });

  it('Driver Preview uses the locked helper sentence and omits the empty-title placeholder', () => {
    renderForm();
    fireEvent.click(stageTab('Review & Publish'));
    const preview = screen.getByTestId('driver-preview');
    expect(within(preview).getByText(
      'This is how the populated opportunity details will appear to drivers.',
    )).toBeInTheDocument();
    expect(preview.textContent ?? '').not.toMatch(/Add a title on Essentials/i);
  });

  it('company-driver operating-cost note uses the locked W-2 sentence', () => {
    renderForm(makeOpportunity({ employment_model: 'company_driver' }));
    fireEvent.click(stageTab('Optional Details'));
    const trigger = within(screen.getByTestId('group-costs')).getByRole('button');
    if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
    expect(screen.getByText(
      'Operating-cost fields do not apply to W-2 company-driver opportunities.',
    )).toBeInTheDocument();
  });

});

describe('Phase 1O-A-R2 — historical scope, start-gate, and theme lock proofs (fail-closed)', () => {
  // The Phase 1O-A implementation base — the commit immediately before any
  // Phase 1O-A work began.
  const ORIGINAL_BASE_SHA = 'c4248feb39c4e2ebd575d48dae41a395bc8107a1';
  // The accepted Phase 1O-A terminal SHA (final R2 commit). All Phase 1O-A
  // authorized diffs must sit inside base..terminal — later authorized
  // phases (1O-B and beyond) live outside this window and must NOT be
  // treated as Phase 1O-A scope violations.
  const ACCEPTED_TERMINAL_SHA = '8938b17a9258de877e8a86f8cb431ef0fbc2797d';
  const AUTHORIZED_FILES = new Set([
    'src/components/opportunities/RecruiterOpportunityForm.tsx',
    'src/components/opportunities/PasteOpportunityDialog.tsx',
    'src/test/phase1oARecruiterOpportunityAuthoringReconstruction.test.tsx',
    'src/test/phase1lDE1RecruiterOpportunityForm.test.tsx',
    'src/test/recruiterOpportunityFormConsolidation.test.tsx',
  ]);

  function isAncestor(a: string, b: string): boolean {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  it('the pinned original base SHA is ancestor of the accepted Phase 1O-A terminal SHA', () => {
    expect(isAncestor(ORIGINAL_BASE_SHA, ACCEPTED_TERMINAL_SHA)).toBe(true);
  });

  it('the accepted Phase 1O-A terminal SHA is ancestor of the current HEAD', () => {
    expect(isAncestor(ACCEPTED_TERMINAL_SHA, 'HEAD')).toBe(true);
  });

  it('the historical Phase 1O-A diff (base..accepted-terminal) equals exactly the five authorized files, no missing and no extras', () => {
    const out = execFileSync(
      'git',
      ['diff', '--name-only', `${ORIGINAL_BASE_SHA}..${ACCEPTED_TERMINAL_SHA}`],
      { encoding: 'utf8' },
    ).trim();
    const changed = new Set(
      out.split('\n').map((s) => s.trim()).filter(Boolean),
    );
    // No missing.
    for (const authorized of AUTHORIZED_FILES) {
      expect(
        changed.has(authorized),
        `missing from historical Phase 1O-A diff: ${authorized}`,
      ).toBe(true);
    }
    // No extras.
    for (const path of changed) {
      expect(
        AUTHORIZED_FILES.has(path),
        `unauthorized file in historical Phase 1O-A diff: ${path}`,
      ).toBe(true);
    }
    // And the exact size matches.
    expect(changed.size).toBe(AUTHORIZED_FILES.size);
  });

  it('RecruiterOpportunityForm.tsx at the accepted Phase 1O-A terminal SHA contains no raw amber utility classes (theme-token lock)', () => {
    const src = execFileSync(
      'git',
      ['show', `${ACCEPTED_TERMINAL_SHA}:src/components/opportunities/RecruiterOpportunityForm.tsx`],
      { encoding: 'utf8' },
    );
    expect(src).not.toMatch(/\bamber-\d{3}\b/);
    expect(src).toMatch(/border-warning\/30/);
    expect(src).toMatch(/bg-warning\/5/);
    expect(src).toMatch(/text-warning\b/);
  });
});
