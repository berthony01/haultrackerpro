// Phase 1F-B.1 — production-rendered Recruiter opportunity form contract.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  statusMutate: vi.fn(),
  refetch: vi.fn(),
  billingRefresh: vi.fn(),
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
vi.mock('@/hooks/opportunities/useRecruiterBilling', () => ({
  useRecruiterBilling: vi.fn(() => ({ refresh: h.billingRefresh })),
}));
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: vi.fn(() => ({ intentRecruiter: true })),
}));
vi.mock('@/components/opportunities/RecruiterReferralsPanel', () => ({
  RecruiterReferralsPanel: () => <div data-testid="stub-referrals-panel" />,
}));
vi.mock('@/components/opportunities/PasteOpportunityDialog', () => ({
  PasteOpportunityDialog: ({
    open,
    onExtracted,
  }: {
    open: boolean;
    onExtracted: (data: Record<string, unknown>) => void;
  }) => open ? (
    <button type="button" onClick={() => onExtracted(h.pastePayload)}>
      Apply extracted opportunity
    </button>
  ) : null,
}));

import { RecruiterOpportunityForm } from '@/components/opportunities/RecruiterOpportunityForm';
import { RecruiterOpportunityManager } from '@/components/opportunities/RecruiterOpportunityManager';
import { useRecruiterOpportunities } from '@/hooks/opportunities/useRecruiterOpportunities';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { joinBenefits } from '@/lib/opportunities/benefitsFormat';

let profileState: ReturnType<typeof makeProfile> | null;
let opportunitiesState: ReturnType<typeof makeOpportunity>[];

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    user_id: 'u-1',
    recruiter_name: 'Jane Recruiter',
    company_name: 'Acme Trucking',
    recruiter_email: 'jane@acme.example',
    dot_number: '123456',
    mc_number: null,
    status: 'active',
    verification_status: 'pending',
    posting_terms_accepted_at: '2026-07-17T00:00:00Z',
    posting_terms_version: '2026-07-17.v1',
    legacy_terms_grandfathered_at: null,
    ...overrides,
  };
}

function makeOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'opp-1',
    recruiter_id: 'r-1',
    title: 'Regional Dry Van',
    company_name: 'Acme Trucking',
    status: 'active',
    admin_review_status: 'approved',
    hiring_city: 'Dallas',
    hiring_state: 'TX',
    hiring_states: [],
    driver_type: 'company',
    route_type: 'Regional',
    trailer_type: 'Dry Van',
    description: 'Great regional lane.',
    pay_model: 'cpm',
    cpm: 0.65,
    percentage_pay: null,
    flat_weekly_pay: null,
    estimated_weekly_gross: 1800,
    estimated_weekly_miles: 2800,
    estimated_loaded_miles: null,
    estimated_deadhead_miles: null,
    deadhead_paid: null,
    detention_pay: null,
    layover_pay: null,
    sign_on_bonus: null,
    fuel_paid_by: null,
    insurance_deductions: null,
    escrow_required: false,
    escrow_amount: null,
    lease_payment: null,
    maintenance_deductions: null,
    other_deductions: null,
    home_time: null,
    forced_dispatch: null,
    pets_allowed: null,
    riders_allowed: null,
    equipment_year: null,
    benefits: null,
    transparency_confirmed: true,
    featured: false,
    view_count: 0,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    published_at: null,
    ...overrides,
  };
}

function installHookMocks() {
  vi.mocked(useRecruiterProfile).mockImplementation(() => ({
    profile: profileState,
    isLoading: false,
    isApproved: profileState?.verification_status === 'approved',
    isVerified: profileState?.verification_status === 'approved',
    canPost: true,
    refetch: vi.fn(),
  } as never));
  vi.mocked(useRecruiterOpportunities).mockImplementation(() => ({
    opportunities: opportunitiesState,
    isLoading: false,
    isError: false,
    error: null,
    refetch: h.refetch,
    recruiterId: profileState?.id ?? null,
    isApproved: profileState?.verification_status === 'approved',
    canPost: true,
    isVerified: profileState?.verification_status === 'approved',
    createOpportunity: { mutate: h.createMutate, isPending: false },
    updateOpportunity: { mutate: h.updateMutate, isPending: false },
    setStatus: { mutate: h.statusMutate, isPending: false },
  } as never));
}

function renderForm(initial: ReturnType<typeof makeOpportunity> | null = null) {
  return render(
    <RecruiterOpportunityForm initial={initial as never} onBack={vi.fn()} onSaved={vi.fn()} />,
  );
}

function choose(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

function clickPublish() {
  fireEvent.click(screen.getByRole('button', { name: 'Publish Opportunity' }));
}

function mutationPayload(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls[0]?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  profileState = makeProfile();
  opportunitiesState = [];
  h.pastePayload = {};
  installHookMocks();
});

afterEach(() => cleanup());

describe('Phase 1F-B.1 — unified manager flow', () => {
  it('opens the unified create form directly from the top CTA', () => {
    opportunitiesState = [makeOpportunity()];
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    fireEvent.click(screen.getByTestId('post-opportunity-cta'));
    expect(screen.getByTestId('recruiter-opportunity-form')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Post Opportunity' })).toBeInTheDocument();
  });

  it('opens the same unified form directly from the empty-state CTA', () => {
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    fireEvent.click(screen.getByTestId('empty-state-cta'));
    expect(screen.getByTestId('recruiter-opportunity-form')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Post Opportunity' })).toBeInTheDocument();
  });

  it('opens edit in the same form and hydrates essential values', async () => {
    opportunitiesState = [makeOpportunity()];
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('heading', { name: 'Edit Opportunity' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Opportunity Title')).toHaveValue('Regional Dry Van');
    expect(screen.getByLabelText('Company Name')).toHaveValue('Acme Trucking');
  });

  it.each(['pending', 'rejected'])('%s verification can open the form and publish', (verification) => {
    profileState = makeProfile({ verification_status: verification });
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    fireEvent.click(screen.getByTestId('empty-state-cta'));
    expect(screen.getByRole('button', { name: 'Publish Opportunity' })).toBeEnabled();
  });

  it.each([
    ['status', { status: 'suspended' }],
    ['verification status', { verification_status: 'suspended' }],
  ])('blocks a profile suspended by %s through the canonical gate', (_label, overrides) => {
    profileState = makeProfile(overrides);
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    expect(screen.queryByTestId('post-opportunity-cta')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish Opportunity' })).toBeNull();
  });

  it('uses status-only controls and copy that separates verification from access', () => {
    opportunitiesState = [makeOpportunity({ admin_review_status: 'rejected' })];
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    expect(screen.getByText(/Completed recruiter profiles can post/i)).toBeInTheDocument();
    expect(screen.getByText(/Verification adds trust/i)).toBeInTheDocument();
    expect(screen.queryByText(/Review:/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Resubmit for Review/i })).toBeNull();
    expect(screen.queryByText(/reviewed before going live/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});

describe('Phase 1F-B.1 — structure and progressive disclosure', () => {
  it('renders Essentials without a wizard and exactly one action area', () => {
    renderForm();
    expect(screen.getByTestId('essentials-section')).toBeInTheDocument();
    expect(screen.getAllByTestId('form-actions')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Save Draft' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Publish Opportunity' })).toHaveLength(1);
    expect(screen.queryByText(/Step\s*\d+\s*of\s*\d+/i)).toBeNull();
  });

  it('keeps Optional details collapsed for a blank create form', () => {
    renderForm();
    expect(screen.getByTestId('optional-details-section')).toHaveAttribute('data-open', 'false');
    expect(screen.queryByTestId('optional-details-body')).toBeNull();
  });

  it('auto-opens Optional details when an edit contains advanced data', async () => {
    renderForm(makeOpportunity({ estimated_loaded_miles: 2400, home_time: 'Weekly' }));
    expect(await screen.findByTestId('optional-details-body')).toBeInTheDocument();
    expect(screen.getByLabelText('Loaded Miles')).toHaveValue(2400);
    expect(screen.getByLabelText('Home Time')).toHaveValue('Weekly');
  });

  it('renders one transparency statement and none of the legacy confirmations', () => {
    renderForm();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByLabelText('Transparency confirmation')).toBeInTheDocument();
    expect(screen.queryByText(/drivers will see Haul Tracker Pro/i)).toBeNull();
    expect(screen.queryByText(/misleading or unverifiable/i)).toBeNull();
  });

  it('prefills company when a late profile arrives without overwriting user input', async () => {
    profileState = null;
    const view = renderForm();
    expect(screen.getByLabelText('Company Name')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Company Name'), { target: { value: 'Typed Company' } });
    profileState = makeProfile({ company_name: 'Late Profile Company' });
    view.rerender(<RecruiterOpportunityForm initial={null} onBack={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Company Name')).toHaveValue('Typed Company'));
  });
});

describe('Phase 1F-B.1 — paste-to-autofill', () => {
  it('opens Optional details, fills empty fields, and preserves typed title/company/pay', async () => {
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('Company Name')).toHaveValue('Acme Trucking'));
    fireEvent.change(screen.getByLabelText('Opportunity Title'), { target: { value: 'Typed Title' } });
    fireEvent.change(screen.getByLabelText('Company Name'), { target: { value: 'Typed Company' } });
    fireEvent.click(screen.getByRole('button', { name: 'CPM' }));
    fireEvent.change(await screen.findByLabelText('CPM Rate ($/mi)'), { target: { value: '0.72' } });

    h.pastePayload = {
      title: 'Pasted Title',
      company_name: 'Pasted Company',
      pay_model: 'percentage',
      cpm: 0.61,
      hiring_states: ['TX', 'OK'],
      estimated_loaded_miles: 2500,
      requirements: '',
      benefits: 'Two years experience',
    };
    fireEvent.click(screen.getByRole('button', { name: 'Paste to auto-fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply extracted opportunity' }));

    await waitFor(() => expect(screen.getByTestId('optional-details-section')).toHaveAttribute('data-open', 'true'));
    expect(screen.getByLabelText('Opportunity Title')).toHaveValue('Typed Title');
    expect(screen.getByLabelText('Company Name')).toHaveValue('Typed Company');
    expect(screen.getByLabelText('CPM Rate ($/mi)')).toHaveValue(0.72);
    expect(screen.getByLabelText('Hiring States')).toHaveValue('TX, OK');
    expect(screen.getByLabelText('Loaded Miles')).toHaveValue(2500);
    expect(screen.getByLabelText('Additional Requirements')).toHaveValue('Two years experience');
  });

  it('treats pasted false booleans as supplied advanced data and preserves them in the payload', async () => {
    h.pastePayload = {
      title: 'Boolean Test',
      company_name: 'Acme Trucking',
      deadhead_paid: false,
      forced_dispatch: false,
      pets_allowed: false,
      riders_allowed: false,
    };
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Paste to auto-fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply extracted opportunity' }));
    await waitFor(() => expect(screen.getByTestId('optional-details-section')).toHaveAttribute('data-open', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => expect(h.createMutate).toHaveBeenCalledTimes(1));
    const data = mutationPayload(h.createMutate);
    expect(data).toMatchObject({
      deadhead_paid: false,
      forced_dispatch: false,
      pets_allowed: false,
      riders_allowed: false,
      status: 'draft',
    });
  });
});

describe('Phase 1F-B.1 — conditional pay fields', () => {
  it.each([
    ['cpm', true, false, false],
    ['percentage', false, true, false],
    ['flat_weekly', false, false, true],
    ['salary', false, false, true],
    ['mixed', true, true, true],
  ])('renders matching inputs for %s', async (payModel, cpm, percentage, flat) => {
    renderForm(makeOpportunity({ pay_model: payModel }));
    await screen.findByLabelText('Est. Weekly Gross ($)');
    expect(!!screen.queryByLabelText('CPM Rate ($/mi)')).toBe(cpm);
    expect(!!screen.queryByLabelText('Percentage Pay (%)')).toBe(percentage);
    expect(!!screen.queryByLabelText('Flat Weekly Pay ($)')).toBe(flat);
  });
});

describe('Phase 1F-B.1 — validation contract', () => {
  it.each([
    ['Title is required.', { title: '' }],
    ['Company name is required.', { company_name: '' }],
    ['Hiring type is required.', { driver_type: null }],
    ['Route type is required.', { route_type: null }],
    ['Trailer type is required.', { trailer_type: null }],
    ['Pay model is required.', { pay_model: null }],
    ['Provide at least one pay value (weekly gross, CPM, flat weekly, or percentage).', {
      cpm: 0,
      percentage_pay: 0,
      flat_weekly_pay: 0,
      estimated_weekly_gross: 0,
    }],
    ['Please confirm the transparency statement to publish.', { transparency_confirmed: false }],
  ])('rejects publish with: %s', async (message, overrides) => {
    renderForm(makeOpportunity(overrides));
    clickPublish();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(message));
    expect(h.updateMutate).not.toHaveBeenCalled();
  });

  it('allows a minimal draft with only title/company and emits status draft', async () => {
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('Company Name')).toHaveValue('Acme Trucking'));
    fireEvent.change(screen.getByLabelText('Opportunity Title'), { target: { value: 'Minimal Draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => expect(h.createMutate).toHaveBeenCalledTimes(1));
    expect(mutationPayload(h.createMutate)).toMatchObject({
      title: 'Minimal Draft',
      company_name: 'Acme Trucking',
      route_type: null,
      trailer_type: null,
      pay_model: null,
      transparency_confirmed: false,
      status: 'draft',
    });
  });

  it('rejects a draft containing a negative numeric value', async () => {
    renderForm(makeOpportunity({ cpm: -1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('CPM rate must be 0 or higher.'));
    expect(h.updateMutate).not.toHaveBeenCalled();
  });
});

describe('Phase 1F-B.1 — create/update payload routing', () => {
  it('creates an active opportunity from a valid publish', async () => {
    h.pastePayload = {
      title: 'New Regional Role',
      driver_type: 'company',
      route_type: 'Regional',
      trailer_type: 'Dry Van',
      pay_model: 'cpm',
      cpm: 0.68,
    };
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('Company Name')).toHaveValue('Acme Trucking'));
    fireEvent.click(screen.getByRole('button', { name: 'Paste to auto-fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply extracted opportunity' }));
    fireEvent.click(screen.getByLabelText('Transparency confirmation'));
    clickPublish();
    await waitFor(() => expect(h.createMutate).toHaveBeenCalledTimes(1));
    expect(mutationPayload(h.createMutate)).toMatchObject({
      title: 'New Regional Role',
      company_name: 'Acme Trucking',
      driver_type: 'company',
      route_type: 'Regional',
      trailer_type: 'Dry Van',
      pay_model: 'cpm',
      cpm: 0.68,
      transparency_confirmed: true,
      status: 'active',
    });
  });

  it('routes edit publish through updateOpportunity with the exact ID', async () => {
    renderForm(makeOpportunity({ id: 'existing-42' }));
    clickPublish();
    await waitFor(() => expect(h.updateMutate).toHaveBeenCalledTimes(1));
    const call = mutationPayload(h.updateMutate);
    expect(call.id).toBe('existing-42');
    expect(call.data.status).toBe('active');
  });

  it('round-trips every advanced field through an edit draft payload', async () => {
    const benefits = joinBenefits({
      typical_lanes: 'Dallas → Houston\nTulsa → Little Rock',
      requirements: 'Two years OTR\nClean MVR',
    });
    renderForm(makeOpportunity({
      hiring_states: ['TX', 'OK'],
      estimated_loaded_miles: 2450,
      estimated_deadhead_miles: 180,
      deadhead_paid: false,
      forced_dispatch: false,
      pets_allowed: true,
      riders_allowed: false,
      equipment_year: '2022-2025 Cascadia',
      detention_pay: '$25/hr after 2 hours',
      layover_pay: '$150/day',
      sign_on_bonus: 2500,
      fuel_paid_by: 'Company',
      insurance_deductions: 125,
      escrow_required: true,
      escrow_amount: 1000,
      lease_payment: 850,
      maintenance_deductions: 175,
      other_deductions: 40,
      home_time: 'Home weekly',
      benefits,
    }));
    await screen.findByTestId('optional-details-body');
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => expect(h.updateMutate).toHaveBeenCalledTimes(1));
    const { id, data } = mutationPayload(h.updateMutate);
    expect(id).toBe('opp-1');
    expect(data).toMatchObject({
      hiring_states: ['TX', 'OK'],
      estimated_loaded_miles: 2450,
      estimated_deadhead_miles: 180,
      deadhead_paid: false,
      forced_dispatch: false,
      pets_allowed: true,
      riders_allowed: false,
      equipment_year: '2022-2025 Cascadia',
      detention_pay: '$25/hr after 2 hours',
      layover_pay: '$150/day',
      sign_on_bonus: 2500,
      fuel_paid_by: 'Company',
      insurance_deductions: 125,
      escrow_required: true,
      escrow_amount: 1000,
      lease_payment: 850,
      maintenance_deductions: 175,
      other_deductions: 40,
      home_time: 'Home weekly',
      benefits,
      status: 'draft',
    });
  });
});

describe('Phase 1F-B.1 — source integrity', () => {
  it('removes the old wizard, Quick Post, duplicate confirmations, and review-flow copy', () => {
    const root = path.resolve(__dirname, '..');
    const form = fs.readFileSync(path.join(root, 'components/opportunities/RecruiterOpportunityForm.tsx'), 'utf8');
    const manager = fs.readFileSync(path.join(root, 'components/opportunities/RecruiterOpportunityManager.tsx'), 'utf8');
    expect(fs.existsSync(path.join(root, 'components/opportunities/RecruiterQuickPostForm.tsx'))).toBe(false);
    for (const forbidden of [
      'Save & Continue',
      'Switch to detailed editor',
      'confirm_drivers_see_intel',
      'confirm_misleading_removed',
      'RecruiterQuickPostForm',
    ]) {
      expect(`${form}\n${manager}`).not.toContain(forbidden);
    }
    expect(manager).not.toMatch(/Resubmit for Review|Review:\s*\{|reviewed before going live/i);
  });
});
