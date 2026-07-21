// Phase 1L-DE1R2R1 — Rendered behavior of the canonical recruiter authoring
// form. Covers structure, exact vocabularies, employment/team/pay-model
// conditional rendering, paste-to-autofill safety, publish/draft routing,
// stored transparency round trip, publication-readiness surfacing, and
// source integrity (no wizard, no legacy accordion, no quick post).

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedOpportunity } from '@/components/opportunities/PasteOpportunityDialog';
import type { Tables } from '@/integrations/supabase/types';

const h = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
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
  PasteOpportunityDialog: ({
    open, onExtracted,
  }: { open: boolean; onExtracted: (data: ExtractedOpportunity) => void }) =>
    open ? (
      <button type="button" onClick={() => onExtracted(h.pastePayload)}>
        Apply extracted opportunity
      </button>
    ) : null,
}));

import { RecruiterOpportunityForm } from '@/components/opportunities/RecruiterOpportunityForm';
import { useRecruiterOpportunities } from '@/hooks/opportunities/useRecruiterOpportunities';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

type Opportunity = Tables<'opportunities'>;
type ProfileHook = ReturnType<typeof useRecruiterProfile>;
type OppsHook = ReturnType<typeof useRecruiterOpportunities>;

function makeProfileHook(company = 'Acme Trucking'): ProfileHook {
  return {
    profile: {
      id: 'r-1', user_id: 'u-1', company_name: company,
      verification_status: 'approved', status: 'active',
    },
    isLoading: false,
    isApproved: true,
    isSuspended: false,
    canPost: true,
    isVerified: true,
    isProfileComplete: true,
    refetch: vi.fn(),
  } as unknown as ProfileHook;
}

function makeOppsHook(): OppsHook {
  return {
    opportunities: [],
    isLoading: false, isError: false, error: null, refetch: vi.fn(),
    recruiterId: 'r-1', isApproved: true, canPost: true, isVerified: true,
    createOpportunity: { mutate: h.createMutate, isPending: false },
    updateOpportunity: { mutate: h.updateMutate, isPending: false },
    setStatus: { mutate: vi.fn(), isPending: false },
  } as unknown as OppsHook;
}

function installMocks(company = 'Acme Trucking') {
  vi.mocked(useRecruiterProfile).mockReturnValue(makeProfileHook(company));
  vi.mocked(useRecruiterOpportunities).mockReturnValue(makeOppsHook());
}

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp-1', recruiter_id: 'r-1',
    title: 'Regional Dry Van', company_name: 'Acme Trucking',
    canonical_version: 1, employment_model: 'company_driver', team_configuration: 'solo',
    route_type: 'Regional', trailer_type: 'Dry Van',
    hiring_city: 'Dallas', hiring_state: 'TX', hiring_states: [],
    description: 'Great regional lane.',
    home_time: 'Home weekly',
    pay_model: 'cpm', cpm: 0.65,
    estimated_weekly_miles: 2800, estimated_loaded_miles: 2600,
    deadhead_paid: false,
    transparency_confirmed: true,
    status: 'active', admin_review_status: 'approved',
    driver_type: 'company',
    ...overrides,
  } as unknown as Opportunity;
}

function renderForm(initial: Opportunity | null = null) {
  return render(
    <RecruiterOpportunityForm
      initial={initial}
      onBack={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
}

function clickPublish() {
  fireEvent.click(screen.getByRole('button', { name: 'Publish Opportunity' }));
}
function clickSaveDraft() {
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
}
function chooseChip(testId: string, label: string) {
  const row = screen.getByTestId(testId);
  fireEvent.click(within(row).getByRole('button', { name: label }));
}
function choosePay(label: string) {
  fireEvent.click(within(screen.getByTestId('pay-model')).getByRole('button', { name: label }));
}
function payloadOf(mock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return mock.mock.calls[0]?.[0] as Record<string, unknown>;
}
function updateArgs(): { id: string; data: Record<string, unknown> } {
  return h.updateMutate.mock.calls[0]?.[0] as { id: string; data: Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.pastePayload = {} as ExtractedOpportunity;
  installMocks();
});

afterEach(() => cleanup());

describe('Phase 1L-DE1R2R1 — form structure', () => {
  it('renders all six canonical sections and a single action area', () => {
    renderForm();
    for (const id of [
      'section-basics', 'section-compensation', 'section-operations',
      'section-costs', 'section-content', 'section-review',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getAllByTestId('form-actions')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Save Draft' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Publish Opportunity' })).toHaveLength(1);
  });

  it('renders the exact header supporting copy', () => {
    renderForm();
    expect(screen.getByText(/Required details adapt to the selected employment arrangement and pay model\. Review the/i)).toBeInTheDocument();
  });

  it('shows exactly one transparency confirmation with the exact attestation copy', () => {
    renderForm();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByLabelText('Transparency confirmation')).toBeInTheDocument();
    expect(screen.getByText(
      /I confirm this opportunity is accurate: pay, miles, costs, and estimated earnings are labeled/i,
    )).toBeInTheDocument();
    expect(screen.queryByText(/misleading or unverifiable/i)).toBeNull();
  });

  it('renders exact employment and team choices', () => {
    renderForm();
    const em = screen.getByTestId('employment-arrangement');
    for (const label of ['W-2 Company Driver', '1099 Contractor', 'Owner-Operator', 'Lease Purchase']) {
      expect(within(em).getByRole('button', { name: label })).toBeInTheDocument();
    }
    const team = screen.getByTestId('driving-configuration');
    for (const label of ['Solo', 'Team', 'Solo or Team']) {
      expect(within(team).getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('route select exposes only the canonical route vocabulary', () => {
    renderForm();
    fireEvent.click(screen.getByLabelText('Route Type'));
    for (const label of ['Local', 'Regional', 'OTR', 'Dedicated', 'Semi-Dedicated']) {
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
    }
  });

  it('trailer select exposes only the canonical trailer vocabulary; Step Deck / Power Only / Hopper are absent', () => {
    renderForm();
    fireEvent.click(screen.getByLabelText('Trailer Type'));
    for (const label of ['Dry Van', 'Reefer', 'Flatbed', 'Tanker', 'Car Hauler', 'Intermodal', 'Other']) {
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
    }
    for (const forbidden of ['Step Deck', 'Power Only', 'Hopper']) {
      expect(screen.queryByRole('option', { name: forbidden })).toBeNull();
    }
  });

  it('uses Post/Edit heading based on presence of initial', () => {
    const { unmount } = renderForm();
    expect(screen.getByRole('heading', { name: 'Post Opportunity' })).toBeInTheDocument();
    unmount();
    renderForm(makeOpportunity());
    expect(screen.getByRole('heading', { name: 'Edit Opportunity' })).toBeInTheDocument();
  });

  it('prefills company from a late-arriving recruiter profile without overwriting typed input', () => {
    vi.mocked(useRecruiterProfile).mockReturnValue({
      profile: { id: 'r-1', company_name: '', verification_status: 'approved', status: 'active' },
      isLoading: false, isApproved: true, isSuspended: false, canPost: true,
      isVerified: true, isProfileComplete: true, refetch: vi.fn(),
    } as unknown as ProfileHook);
    const { rerender } = renderForm();
    expect(screen.getByLabelText('Company Name')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Company Name'), { target: { value: 'Typed Company' } });
    installMocks('Late Profile Company');
    rerender(<RecruiterOpportunityForm initial={null} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText('Company Name')).toHaveValue('Typed Company');
  });
});

describe('Phase 1L-DE1R2R1 — employment-driven cost visibility', () => {
  it('company-driver hides cost fields, hides fuel, and shows the not-applicable / take-home copy', () => {
    renderForm();
    chooseChip('employment-arrangement', 'W-2 Company Driver');
    expect(screen.queryByTestId('cost-fields')).toBeNull();
    expect(screen.getByText(
      /Ownership operating-cost fields are not applicable to company-driver listings\. Estimated\s+take-home is unavailable under the current canonical model\./i,
    )).toBeInTheDocument();
    expect(screen.queryByLabelText('Fuel Paid By')).toBeNull();
  });

  it('contractor exposes cost fields, fuel, and no lease payment', () => {
    renderForm();
    chooseChip('employment-arrangement', '1099 Contractor');
    expect(screen.getByTestId('cost-fields')).toBeInTheDocument();
    expect(screen.getByLabelText('Fuel Paid By')).toBeInTheDocument();
    expect(screen.queryByLabelText('Lease payment amount ($)')).toBeNull();
  });

  it('owner-operator exposes cost fields, fuel, and no lease payment', () => {
    renderForm();
    chooseChip('employment-arrangement', 'Owner-Operator');
    expect(screen.getByTestId('cost-fields')).toBeInTheDocument();
    expect(screen.getByLabelText('Fuel Paid By')).toBeInTheDocument();
    expect(screen.queryByLabelText('Lease payment amount ($)')).toBeNull();
  });

  it('lease-purchase exposes the lease payment cost row', () => {
    renderForm();
    chooseChip('employment-arrangement', 'Lease Purchase');
    expect(screen.getByLabelText('Lease payment amount ($)')).toBeInTheDocument();
    expect(screen.getByLabelText('Lease payment frequency')).toBeInTheDocument();
  });

  it('escrow amount/frequency appear only for Required, and disappear on Not required / Not disclosed', () => {
    renderForm();
    chooseChip('employment-arrangement', '1099 Contractor');
    expect(screen.queryByLabelText('Escrow Amount ($)')).toBeNull();

    fireEvent.click(screen.getByLabelText('Escrow Required?'));
    fireEvent.click(screen.getByRole('option', { name: 'Required' }));
    expect(screen.getByLabelText('Escrow Amount ($)')).toBeInTheDocument();
    expect(screen.getByLabelText('Escrow Frequency')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Escrow Required?'));
    fireEvent.click(screen.getByRole('option', { name: 'Not required' }));
    expect(screen.queryByLabelText('Escrow Amount ($)')).toBeNull();
    expect(screen.queryByLabelText('Escrow Frequency')).toBeNull();

    fireEvent.click(screen.getByLabelText('Escrow Required?'));
    fireEvent.click(screen.getByRole('option', { name: 'Explicitly not disclosed' }));
    expect(screen.queryByLabelText('Escrow Amount ($)')).toBeNull();
    expect(screen.queryByLabelText('Escrow Frequency')).toBeNull();
  });
});

describe('Phase 1L-DE1R2R1 — pay-model conditional inputs', () => {
  const CPM_LABELS = ['CPM Rate ($/mi)'];
  const PCT_LABELS = ['Percentage (%)', 'Percentage Basis Label', 'Weekly Revenue Basis ($)'];
  const FLAT_LABELS = ['Flat Weekly Pay ($)'];
  const SAL_LABELS = ['Salary Amount ($)', 'Salary Pay Period'];
  const OTHER_LABELS = ['Pay Method Label', 'Supported Weekly Gross ($)'];
  const ALL_SCALAR: Record<string, string[]> = {
    cpm: CPM_LABELS, percentage: PCT_LABELS, flat_weekly: FLAT_LABELS,
    salary: SAL_LABELS, other: OTHER_LABELS,
  };

  it.each([
    ['CPM', 'cpm'],
    ['Percentage', 'percentage'],
    ['Flat Weekly', 'flat_weekly'],
    ['Salary', 'salary'],
    ['Other', 'other'],
  ])('%s reveals its required inputs and hides every other pay-model input', (chip, key) => {
    renderForm();
    choosePay(chip);
    for (const label of ALL_SCALAR[key]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    for (const [other, labels] of Object.entries(ALL_SCALAR)) {
      if (other === key) continue;
      for (const label of labels) {
        expect(screen.queryByLabelText(label)).toBeNull();
      }
    }
    expect(screen.queryByTestId('mixed-components-editor')).toBeNull();
  });

  it('Mixed reveals the mixed components editor and hides every scalar pay-model input', () => {
    renderForm();
    choosePay('Mixed');
    expect(screen.getByTestId('mixed-components-editor')).toBeInTheDocument();
    for (const labels of Object.values(ALL_SCALAR)) {
      for (const label of labels) {
        expect(screen.queryByLabelText(label)).toBeNull();
      }
    }
  });

  it('Mixed editor supports two complete components and produces a publishable payload', () => {
    renderForm(makeOpportunity({
      pay_model: 'mixed',
      cpm: null,
      mixed_pay_components: [
        { label: 'CPM base', amount: 0.5, frequency: 'weekly' },
        { label: 'Weekly guarantee', amount: 250, frequency: 'weekly' },
      ] as unknown as Opportunity['mixed_pay_components'],
    }));
    // Both component rows render, so the editor supports two components.
    expect(screen.getByTestId('mixed-component-0')).toBeInTheDocument();
    expect(screen.getByTestId('mixed-component-1')).toBeInTheDocument();
    expect(screen.getByLabelText('Mixed component 1 label')).toHaveValue('CPM base');
    expect(screen.getByLabelText('Mixed component 2 label')).toHaveValue('Weekly guarantee');
    clickPublish();
    expect(h.updateMutate).toHaveBeenCalledTimes(1);
    const { data } = updateArgs();
    expect(data.pay_model).toBe('mixed');
    expect(data.status).toBe('active');
    expect(data.mixed_pay_components).toEqual([
      { label: 'CPM base', amount: 0.5, frequency: 'weekly' },
      { label: 'Weekly guarantee', amount: 250, frequency: 'weekly' },
    ]);
  });
});

describe('Phase 1L-DE1R2R1 — review summary', () => {
  it('renders $0 for an explicit zero sign-on bonus', () => {
    renderForm(makeOpportunity({ sign_on_bonus: 0 }));
    expect(screen.getByTestId('review-onetime')).toHaveTextContent('$0');
  });

  it('marks the estimated weekly net as unavailable for company drivers', () => {
    renderForm(makeOpportunity({ employment_model: 'company_driver' }));
    expect(screen.getByTestId('review-net')).toHaveTextContent('Not available for company drivers');
  });
});

describe('Phase 1L-DE1R2R1 — paste-to-autofill safety', () => {
  it('never overwrites resolved title, company, employment, team, or pay model', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Opportunity Title'), { target: { value: 'Typed Title' } });
    fireEvent.change(screen.getByLabelText('Company Name'), { target: { value: 'Typed Company' } });
    chooseChip('employment-arrangement', 'Owner-Operator');
    chooseChip('driving-configuration', 'Solo');
    choosePay('CPM');

    h.pastePayload = {
      title: 'Pasted Title', company_name: 'Pasted Company',
      driver_type: 'team', pay_model: 'percentage',
    } as ExtractedOpportunity;
    fireEvent.click(screen.getByRole('button', { name: 'Paste to auto-fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply extracted opportunity' }));

    expect(screen.getByLabelText('Opportunity Title')).toHaveValue('Typed Title');
    expect(screen.getByLabelText('Company Name')).toHaveValue('Typed Company');
    const em = screen.getByTestId('employment-arrangement');
    expect(within(em).getByRole('button', { name: 'Owner-Operator' })).toHaveAttribute('aria-pressed', 'true');
    const team = screen.getByTestId('driving-configuration');
    // Solo was explicitly selected before paste; driver_type=team must not overwrite it.
    expect(within(team).getByRole('button', { name: 'Solo' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(team).getByRole('button', { name: 'Team' })).toHaveAttribute('aria-pressed', 'false');
    // CPM input still visible.
    expect(screen.getByLabelText('CPM Rate ($/mi)')).toBeInTheDocument();
  });

  it('paste can project team when team is still unspecified even if employment already resolved', () => {
    renderForm();
    chooseChip('employment-arrangement', 'Owner-Operator');
    h.pastePayload = { driver_type: 'team' } as ExtractedOpportunity;
    fireEvent.click(screen.getByRole('button', { name: 'Paste to auto-fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply extracted opportunity' }));
    const team = screen.getByTestId('driving-configuration');
    expect(within(team).getByRole('button', { name: 'Team' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('paste can fill unresolved employment independently of team', () => {
    renderForm();
    chooseChip('driving-configuration', 'Solo');
    h.pastePayload = { driver_type: 'owner_operator' } as ExtractedOpportunity;
    fireEvent.click(screen.getByRole('button', { name: 'Paste to auto-fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply extracted opportunity' }));
    const em = screen.getByTestId('employment-arrangement');
    expect(within(em).getByRole('button', { name: 'Owner-Operator' })).toHaveAttribute('aria-pressed', 'true');
    const team = screen.getByTestId('driving-configuration');
    expect(within(team).getByRole('button', { name: 'Solo' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('preserves false booleans through paste', () => {
    renderForm();
    h.pastePayload = {
      title: 'x', company_name: 'y',
      deadhead_paid: false, forced_dispatch: false, pets_allowed: false, riders_allowed: false,
    } as ExtractedOpportunity;
    fireEvent.click(screen.getByRole('button', { name: 'Paste to auto-fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply extracted opportunity' }));
    clickSaveDraft();
    const data = payloadOf(h.createMutate);
    expect(data).toMatchObject({
      deadhead_paid: false, forced_dispatch: false, pets_allowed: false, riders_allowed: false,
      status: 'draft', canonical_version: 1,
    });
  });
});

describe('Phase 1L-DE1R2R1 — draft / publish routing', () => {
  it('minimal draft routes through createOpportunity with status=draft and canonical_version=1', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Opportunity Title'), { target: { value: 'Minimal Draft' } });
    clickSaveDraft();
    expect(h.createMutate).toHaveBeenCalledTimes(1);
    expect(payloadOf(h.createMutate)).toMatchObject({
      title: 'Minimal Draft', company_name: 'Acme Trucking',
      status: 'draft', canonical_version: 1,
    });
  });

  it('valid publish emits a fully populated create call with status=active', () => {
    renderForm(makeOpportunity({ id: undefined as unknown as string }));
    clickPublish();
    expect(h.createMutate).toHaveBeenCalledTimes(1);
    expect(payloadOf(h.createMutate)).toMatchObject({
      title: 'Regional Dry Van', company_name: 'Acme Trucking',
      employment_model: 'company_driver', team_configuration: 'solo',
      route_type: 'Regional', trailer_type: 'Dry Van',
      pay_model: 'cpm', cpm: 0.65,
      transparency_confirmed: true, status: 'active', canonical_version: 1,
    });
  });

  it('edit publish routes through updateOpportunity with the exact ID', () => {
    renderForm(makeOpportunity({ id: 'existing-42' }));
    clickPublish();
    expect(h.updateMutate).toHaveBeenCalledTimes(1);
    const { id, data } = updateArgs();
    expect(id).toBe('existing-42');
    expect(data.status).toBe('active');
  });

  it('publish is blocked and disabled when readiness surfaces blockers', () => {
    renderForm(makeOpportunity({
      employment_model: null as unknown as string,
      driver_type: null, team_configuration: null,
    }));
    expect(screen.getByRole('button', { name: 'Publish Opportunity' })).toBeDisabled();
    expect(screen.getByTestId('publish-blockers')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish Opportunity' }));
    expect(h.createMutate).not.toHaveBeenCalled();
    expect(h.updateMutate).not.toHaveBeenCalled();
  });

  it('stored transparency_confirmed=true hydrates the checkbox as checked and persists true with no user toggle', () => {
    renderForm(makeOpportunity({ transparency_confirmed: true }));
    expect(screen.getByLabelText('Transparency confirmation')).toBeChecked();
    clickSaveDraft();
    expect(updateArgs().data.transparency_confirmed).toBe(true);
  });

  it('stored transparency_confirmed=false hydrates unchecked and publish remains blocked until checked', () => {
    renderForm(makeOpportunity({ transparency_confirmed: false }));
    expect(screen.getByLabelText('Transparency confirmation')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Publish Opportunity' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Transparency confirmation'));
    expect(screen.getByLabelText('Transparency confirmation')).toBeChecked();
    clickPublish();
    expect(h.updateMutate).toHaveBeenCalledTimes(1);
    expect(updateArgs().data.transparency_confirmed).toBe(true);
  });

  it('legacy benefits column persisted from canonical lanes + requirements only', () => {
    renderForm(makeOpportunity({
      typical_lanes: 'Dallas → Houston',
      requirements: 'Class A CDL',
      actual_benefits: 'Medical after 60 days',
    }));
    clickSaveDraft();
    const { data } = updateArgs();
    expect(data.typical_lanes).toBe('Dallas → Houston');
    expect(data.requirements).toBe('Class A CDL');
    expect(data.actual_benefits).toBe('Medical after 60 days');
    expect(String(data.benefits ?? '')).not.toContain('Medical after 60 days');
    expect(String(data.benefits ?? '')).toContain('Typical Lanes:');
    expect(String(data.benefits ?? '')).toContain('Requirements:');
  });

  it('legacy benefits without canonical fields hydrates and round-trips into requirements only', () => {
    renderForm(makeOpportunity({
      typical_lanes: null, requirements: null,
      benefits: 'Legacy freeform requirements text',
    }));
    expect(screen.getByLabelText('Requirements')).toHaveValue('Legacy freeform requirements text');
    expect(screen.getByLabelText('Typical Lanes')).toHaveValue('');
    clickSaveDraft();
    const { data } = updateArgs();
    expect(data.requirements).toBe('Legacy freeform requirements text');
    expect(data.typical_lanes).toBeNull();
  });

  it('renders shared readiness blockers and warnings from the readiness validator', () => {
    renderForm(makeOpportunity({
      transparency_confirmed: false, home_time: null,
    }));
    const blockers = screen.getByTestId('publish-blockers');
    expect(blockers).toHaveTextContent('Confirm the opportunity is accurate before publishing.');
    expect(blockers).toHaveTextContent('Home time is required.');
  });
});

describe('Phase 1L-DE1R2R1 — source integrity', () => {
  it('does not reintroduce wizard scaffolding, generic optional accordion, Quick Post, duplicate confirmations, or legacy review-flow copy', () => {
    const root = path.resolve(__dirname, '..');
    const form = fs.readFileSync(path.join(root, 'components/opportunities/RecruiterOpportunityForm.tsx'), 'utf8');
    expect(fs.existsSync(path.join(root, 'components/opportunities/RecruiterQuickPostForm.tsx'))).toBe(false);
    for (const forbidden of [
      'Step 1 of', 'Switch to detailed editor',
      'confirm_drivers_see_intel', 'confirm_misleading_removed',
      'RecruiterQuickPostForm', 'optional-details-section',
      'Resubmit for Review', 'reviewed before going live',
    ]) {
      expect(form).not.toContain(forbidden);
    }
  });
});
