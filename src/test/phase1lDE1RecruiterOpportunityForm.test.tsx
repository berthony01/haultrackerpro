// Phase 1L-DE1R2 — Rendered behavior of the canonical recruiter authoring
// form. Covers structure, employment/team/pay-model conditional rendering,
// paste-to-autofill safety, publish/draft routing, publication readiness
// surfacing, and source integrity (no wizard, no legacy accordion).

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  pastePayload: {} as Record<string, unknown>,
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
  }: { open: boolean; onExtracted: (data: Record<string, unknown>) => void }) =>
    open ? (
      <button type="button" onClick={() => onExtracted(h.pastePayload)}>
        Apply extracted opportunity
      </button>
    ) : null,
}));

import { RecruiterOpportunityForm } from '@/components/opportunities/RecruiterOpportunityForm';
import { useRecruiterOpportunities } from '@/hooks/opportunities/useRecruiterOpportunities';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

function installMocks(company = 'Acme Trucking') {
  vi.mocked(useRecruiterProfile).mockImplementation(() => ({
    profile: {
      id: 'r-1', user_id: 'u-1', company_name: company,
      verification_status: 'approved', status: 'active',
    },
    isLoading: false,
    isApproved: true,
    isVerified: true,
    canPost: true,
    refetch: vi.fn(),
  } as never));
  vi.mocked(useRecruiterOpportunities).mockImplementation(() => ({
    opportunities: [],
    isLoading: false, isError: false, error: null, refetch: vi.fn(),
    recruiterId: 'r-1', isApproved: true, canPost: true, isVerified: true,
    createOpportunity: { mutate: h.createMutate, isPending: false },
    updateOpportunity: { mutate: h.updateMutate, isPending: false },
    setStatus: { mutate: vi.fn(), isPending: false },
  } as never));
}

function makeOpportunity(overrides: Record<string, unknown> = {}) {
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
  } as never;
}

function renderForm(initial: unknown = null) {
  return render(
    <RecruiterOpportunityForm
      initial={initial as never}
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
function payloadOf(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls[0]?.[0];
}
function updateArgs() {
  return h.updateMutate.mock.calls[0]?.[0] as { id: string; data: Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.pastePayload = {};
  installMocks();
});

afterEach(() => cleanup());

describe('Phase 1L-DE1R2 — form structure', () => {
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

  it('renders separate employment and driving-configuration chip rows', () => {
    renderForm();
    expect(screen.getByTestId('employment-arrangement')).toBeInTheDocument();
    expect(screen.getByTestId('driving-configuration')).toBeInTheDocument();
  });

  it('shows exactly one transparency confirmation and no legacy duplicates', () => {
    renderForm();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByLabelText('Transparency confirmation')).toBeInTheDocument();
    expect(screen.queryByText(/drivers will see Haul Tracker Pro/i)).toBeNull();
    expect(screen.queryByText(/misleading or unverifiable/i)).toBeNull();
  });

  it('uses Post/Edit heading based on presence of initial', () => {
    const { unmount } = renderForm();
    expect(screen.getByRole('heading', { name: 'Post Opportunity' })).toBeInTheDocument();
    unmount();
    renderForm(makeOpportunity());
    expect(screen.getByRole('heading', { name: 'Edit Opportunity' })).toBeInTheDocument();
  });

  it('prefills company from a late-arriving recruiter profile without overwriting typed input', () => {
    // Late profile scenario: profile begins without company_name, then arrives.
    vi.mocked(useRecruiterProfile).mockImplementation(() => ({
      profile: { id: 'r-1', company_name: '', verification_status: 'approved', status: 'active' },
      isLoading: false, isApproved: true, isVerified: true, canPost: true, refetch: vi.fn(),
    } as never));
    const { rerender } = renderForm();
    expect(screen.getByLabelText('Company Name')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Company Name'), { target: { value: 'Typed Company' } });
    installMocks('Late Profile Company');
    rerender(<RecruiterOpportunityForm initial={null} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText('Company Name')).toHaveValue('Typed Company');
  });
});

describe('Phase 1L-DE1R2 — employment-driven cost visibility', () => {
  it('company-driver hides cost fields and shows the not-applicable notice', () => {
    renderForm();
    chooseChip('employment-arrangement', 'W-2 Company Driver');
    expect(screen.queryByTestId('cost-fields')).toBeNull();
    expect(screen.getByText(/Ownership operating-cost fields are not applicable to company-driver listings\. Estimated/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Fuel Paid By')).toBeNull();
  });

  it('contractor exposes cost fields but no lease payment', () => {
    renderForm();
    chooseChip('employment-arrangement', '1099 Contractor');
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

  it('escrow amount/frequency inputs only appear when escrow is required', () => {
    renderForm();
    chooseChip('employment-arrangement', '1099 Contractor');
    expect(screen.queryByLabelText('Escrow Amount ($)')).toBeNull();
    fireEvent.click(screen.getByLabelText('Escrow Required?'));
    fireEvent.click(screen.getByRole('option', { name: 'Required' }));
    expect(screen.getByLabelText('Escrow Amount ($)')).toBeInTheDocument();
    expect(screen.getByLabelText('Escrow Frequency')).toBeInTheDocument();
  });
});

describe('Phase 1L-DE1R2 — pay-model conditional inputs', () => {
  it.each([
    ['CPM', 'CPM Rate ($/mi)'],
    ['Percentage', 'Percentage (%)'],
    ['Flat Weekly', 'Flat Weekly Pay ($)'],
    ['Salary', 'Salary Amount ($)'],
    ['Other', 'Pay Method Label'],
  ])('%s pay model reveals its dedicated input (%s)', (chip, label) => {
    renderForm();
    fireEvent.click(within(screen.getByTestId('pay-model')).getByRole('button', { name: chip }));
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it('Mixed pay model reveals the mixed components editor', () => {
    renderForm();
    fireEvent.click(within(screen.getByTestId('pay-model')).getByRole('button', { name: 'Mixed' }));
    expect(screen.getByTestId('mixed-components-editor')).toBeInTheDocument();
  });
});

describe('Phase 1L-DE1R2 — review summary', () => {
  it('renders $0 for an explicit zero sign-on bonus', () => {
    renderForm(makeOpportunity({ sign_on_bonus: 0 }));
    expect(screen.getByTestId('review-onetime')).toHaveTextContent('$0');
  });

  it('marks the estimated weekly net as unavailable for company drivers', () => {
    renderForm(makeOpportunity({ employment_model: 'company_driver' }));
    expect(screen.getByTestId('review-net')).toHaveTextContent('Not available for company drivers');
  });
});

describe('Phase 1L-DE1R2 — paste-to-autofill safety', () => {
  it('never overwrites resolved title, company, employment, team, or pay model', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Opportunity Title'), { target: { value: 'Typed Title' } });
    fireEvent.change(screen.getByLabelText('Company Name'), { target: { value: 'Typed Company' } });
    chooseChip('employment-arrangement', 'Owner-Operator');
    chooseChip('driving-configuration', 'Solo');
    fireEvent.click(within(screen.getByTestId('pay-model')).getByRole('button', { name: 'CPM' }));

    h.pastePayload = {
      title: 'Pasted Title', company_name: 'Pasted Company',
      driver_type: 'team', pay_model: 'percentage',
    };
    fireEvent.click(screen.getByRole('button', { name: 'Paste to auto-fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply extracted opportunity' }));

    expect(screen.getByLabelText('Opportunity Title')).toHaveValue('Typed Title');
    expect(screen.getByLabelText('Company Name')).toHaveValue('Typed Company');
    // Employment/team resolved before paste — driver_type=team must not overwrite them.
    const em = screen.getByTestId('employment-arrangement');
    expect(within(em).getByRole('button', { name: 'Owner-Operator' })).toHaveAttribute('aria-pressed', 'true');
    // Pay model resolved before paste — remains CPM (CPM input still visible).
    expect(screen.getByLabelText('CPM Rate ($/mi)')).toBeInTheDocument();
  });

  it('paste can project team when team is still unspecified even if employment already resolved', () => {
    renderForm();
    chooseChip('employment-arrangement', 'Owner-Operator');
    h.pastePayload = { driver_type: 'team' };
    fireEvent.click(screen.getByRole('button', { name: 'Paste to auto-fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply extracted opportunity' }));
    const team = screen.getByTestId('driving-configuration');
    expect(within(team).getByRole('button', { name: 'Team' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('preserves false booleans through paste', () => {
    renderForm();
    h.pastePayload = {
      title: 'x', company_name: 'y',
      deadhead_paid: false, forced_dispatch: false, pets_allowed: false, riders_allowed: false,
    };
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

describe('Phase 1L-DE1R2 — draft / publish routing', () => {
  it('minimal draft routes through createOpportunity with status=draft', () => {
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
    renderForm(makeOpportunity({ id: undefined }));
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
    renderForm(makeOpportunity({ employment_model: null, driver_type: null, team_configuration: null }));
    expect(screen.getByRole('button', { name: 'Publish Opportunity' })).toBeDisabled();
    expect(screen.getByTestId('publish-blockers')).toBeInTheDocument();
    // even if the user forces a click, no mutation runs
    fireEvent.click(screen.getByRole('button', { name: 'Publish Opportunity' }));
    expect(h.createMutate).not.toHaveBeenCalled();
    expect(h.updateMutate).not.toHaveBeenCalled();
  });

  it('transparency confirmation change is reflected in the persisted payload', () => {
    renderForm(makeOpportunity({ transparency_confirmed: true }));
    fireEvent.click(screen.getByLabelText('Transparency confirmation'));
    clickSaveDraft();
    expect(updateArgs().data.transparency_confirmed).toBe(false);
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
});

describe('Phase 1L-DE1R2 — source integrity', () => {
  it('does not reintroduce wizard scaffolding, generic optional accordion, or Quick Post', () => {
    const root = path.resolve(__dirname, '..');
    const form = fs.readFileSync(path.join(root, 'components/opportunities/RecruiterOpportunityForm.tsx'), 'utf8');
    expect(fs.existsSync(path.join(root, 'components/opportunities/RecruiterQuickPostForm.tsx'))).toBe(false);
    for (const forbidden of [
      'Step 1 of', 'Switch to detailed editor',
      'confirm_drivers_see_intel', 'confirm_misleading_removed',
      'RecruiterQuickPostForm', 'optional-details-section',
    ]) {
      expect(form).not.toContain(forbidden);
    }
  });
});
