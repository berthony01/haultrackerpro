// Phase 1L-DE1R2R2 — Manager ↔ canonical form integration. Uses exhaustive
// typed Row factories (no factory-level casts) and derives the recruiter
// eligibility surface from the shared canonical helpers so this file never
// reimplements the "can post" rule.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Json, Tables } from '@/integrations/supabase/types';
import type {
  OpportunityInsert,
  OpportunityUpdate,
} from '@/hooks/opportunities/useRecruiterOpportunities';
import {
  describeRecruiterEligibility,
  isProfileCompleteForPosting,
} from '@/lib/opportunities/recruiterEligibility';

const h = vi.hoisted(() => ({
  refetch: vi.fn(),
  billingRefresh: vi.fn(),
  statusMutate: vi.fn(),
  createMutate: vi.fn<(payload: OpportunityInsert) => void>(),
  updateMutate: vi.fn<(args: { id: string; data: OpportunityUpdate }) => void>(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
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
  PasteOpportunityDialog: () => null,
}));

import { RecruiterOpportunityManager } from '@/components/opportunities/RecruiterOpportunityManager';
import { useRecruiterOpportunities } from '@/hooks/opportunities/useRecruiterOpportunities';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

type Profile = Tables<'recruiter_profiles'> & { company_type: string | null };
type Opportunity = Tables<'opportunities'>;
type ProfileHook = ReturnType<typeof useRecruiterProfile>;
type OppsHook = ReturnType<typeof useRecruiterOpportunities>;

/* ---------------- exhaustive typed factories ---------------- */

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    admin_notes: null,
    company_address: null,
    company_city: null,
    company_name: 'Acme Trucking',
    company_type: 'carrier',
    company_phone: null,
    company_state: null,
    company_website: null,
    created_at: '2026-07-01T00:00:00Z',
    dot_number: '123456',
    dispatch_week_start_day: 'sunday',
    pay_period_cadence: 'weekly',
    pay_period_anchor_date: null,
    driver_types_hired: [],
    equipment_types: [],
    hiring_states: [],
    id: 'r-1',
    legacy_terms_grandfathered_at: null,
    mc_number: null,
    posting_terms_accepted_at: '2026-07-17T00:00:00Z',
    posting_terms_version: '2026-07-17.v1',
    recruiter_email: 'jane@acme.example',
    recruiter_name: 'Jane Recruiter',
    recruiter_phone: null,
    status: 'active',
    updated_at: '2026-07-01T00:00:00Z',
    user_id: 'u-1',
    verification_status: 'approved',
    verified_at: '2026-07-01T00:00:00Z',
    verified_by: 'admin-1',
    ...overrides,
  };
}

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    actual_benefits: null,
    admin_review_status: 'approved',
    benefits: null,
    canonical_version: 1,
    company_name: 'Acme Trucking',
    cpm: 0.65,
    created_at: '2026-07-01T00:00:00Z',
    deadhead_paid: false,
    description: 'Great regional lane.',
    detention_pay: null,
    driver_type: 'company',
    employment_model: 'company_driver',
    equipment_year: null,
    escrow_amount: null,
    escrow_amount_frequency: null,
    escrow_required: false,
    escrow_required_state: null,
    estimated_deadhead_miles: null,
    estimated_loaded_miles: 2600,
    estimated_weekly_gross: null,
    estimated_weekly_miles: 2800,
    featured: false,
    flat_weekly_pay: null,
    forced_dispatch: null,
    fuel_paid_by: null,
    hiring_city: 'Dallas',
    hiring_state: 'TX',
    hiring_states: [],
    home_time: 'Home weekly',
    id: 'opp-1',
    insurance_deduction_frequency: null,
    insurance_deductions: null,
    layover_pay: null,
    lease_payment: null,
    lease_payment_frequency: null,
    maintenance_deduction_frequency: null,
    maintenance_deductions: null,
    mixed_pay_components: [] as Json,
    other_deduction_frequency: null,
    other_deductions: null,
    other_pay_method_label: null,
    other_weekly_gross: null,
    pay_model: 'cpm',
    percentage_basis_label: null,
    percentage_pay: null,
    percentage_weekly_revenue_basis: null,
    pets_allowed: null,
    published_at: '2026-07-01T00:00:00Z',
    recruiter_id: 'r-1',
    requirements: null,
    riders_allowed: null,
    route_type: 'Regional',
    salary_amount: null,
    salary_frequency: null,
    sign_on_bonus: null,
    status: 'active',
    team_configuration: 'solo',
    title: 'Regional Dry Van',
    trailer_type: 'Dry Van',
    transparency_confirmed: true,
    typical_lanes: null,
    updated_at: '2026-07-01T00:00:00Z',
    view_count: 0,
    ...overrides,
  };
}

let profileState: Profile | null;
let opportunitiesState: Opportunity[];

/** Boundary cast for hook returns: the full UseMutationResult surface is
 *  impractical to spell out; the mock intentionally satisfies only the
 *  properties the manager reads. Both hook mocks are the only casts in
 *  this file — everything else is a real, typed Tables<...> row.
 *
 *  Eligibility flags MUST be derived on every hook invocation so that a
 *  test that mutates `profileState` after `beforeEach` observes the new
 *  eligibility surface (canonical helpers are the single source of truth). */
function installHookMocks() {
  vi.mocked(useRecruiterProfile).mockImplementation(() => {
    const eligibility = describeRecruiterEligibility(profileState, { intentRecruiter: true });
    const suspended = eligibility.state === 'suspended';
    const canPost = eligibility.canPost;
    const isVerified = eligibility.state === 'verified';
    const impl: unknown = {
      profile: profileState,
      isLoading: false,
      isApproved: isVerified,
      isSuspended: suspended,
      isVerified,
      isProfileComplete: isProfileCompleteForPosting(profileState),
      canPost,
      refetch: vi.fn(),
      refetchProfile: vi.fn(async () => profileState),
      upsertProfile: { mutateAsync: vi.fn(), isPending: false },
      saveRecruiterProfile: { mutateAsync: vi.fn(), isPending: false },
    };
    return impl as ProfileHook;
  });

  vi.mocked(useRecruiterOpportunities).mockImplementation(() => {
    const eligibility = describeRecruiterEligibility(profileState, { intentRecruiter: true });
    const canPost = eligibility.canPost;
    const isVerified = eligibility.state === 'verified';
    const impl: unknown = {
      opportunities: opportunitiesState,
      isLoading: false, isError: false, error: null, refetch: h.refetch,
      recruiterId: profileState?.id ?? null,
      isApproved: isVerified,
      canPost, isVerified,
      createOpportunity: { mutate: h.createMutate, isPending: false },
      updateOpportunity: { mutate: h.updateMutate, isPending: false },
      setStatus: { mutate: h.statusMutate, isPending: false },
    };
    return impl as OppsHook;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  profileState = makeProfile();
  opportunitiesState = [];
  installHookMocks();
});

afterEach(() => cleanup());

describe('Phase 1L-DE1R2R1 — manager ↔ canonical form', () => {
  it('opens the canonical form from the top CTA', async () => {
    opportunitiesState = [makeOpportunity()];
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    fireEvent.click(screen.getByTestId('post-opportunity-cta'));
    // openCreate awaits refetchProfile before switching views; wait for
    // the canonical form to mount.
    await waitFor(() => expect(screen.getByTestId('recruiter-opportunity-form')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Post Opportunity' })).toBeInTheDocument();
  });

  it('opens the canonical form from the empty-state CTA', async () => {
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    fireEvent.click(screen.getByTestId('empty-state-cta'));
    await waitFor(() => expect(screen.getByTestId('recruiter-opportunity-form')).toBeInTheDocument());
  });

  it('edit routes into the same canonical form and hydrates canonical values', () => {
    opportunitiesState = [makeOpportunity()];
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByTestId('recruiter-opportunity-form')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit Opportunity' })).toBeInTheDocument();
    // Editing an opportunity opens on the Essentials stage — Title/Company/Home
    // Time all live there and hydrate from the seeded row.
    expect(screen.getByLabelText('Opportunity Title')).toHaveValue('Regional Dry Van');
    expect(screen.getByLabelText('Company Name')).toHaveValue('Acme Trucking');
    expect(screen.getByLabelText('Home Time')).toHaveValue('Home weekly');
    // Transparency confirmation lives on the Review stage — navigate to verify hydration.
    fireEvent.click(screen.getByRole('tab', { name: /Review & Publish/ }));
    expect(screen.getByLabelText('Transparency confirmation')).toBeChecked();
  });


  it('completed, pending-verification profile may post (per shared eligibility helper)', () => {
    profileState = makeProfile({ verification_status: 'pending' });
    expect(describeRecruiterEligibility(profileState).canPost).toBe(true);
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    expect(screen.getByTestId('post-opportunity-cta')).toBeInTheDocument();
    expect(screen.getByTestId('empty-state-cta')).toBeInTheDocument();
  });

  it('completed, rejected-verification profile may post (per shared eligibility helper)', () => {
    profileState = makeProfile({ verification_status: 'rejected' });
    expect(describeRecruiterEligibility(profileState).canPost).toBe(true);
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    expect(screen.getByTestId('post-opportunity-cta')).toBeInTheDocument();
    expect(screen.getByTestId('empty-state-cta')).toBeInTheDocument();
  });

  it.each([
    ['status', { status: 'suspended' } as Partial<Profile>],
    ['verification status', { verification_status: 'suspended' } as Partial<Profile>],
  ])('blocks a profile suspended by %s at the manager gate', (_label, overrides) => {
    profileState = makeProfile(overrides);
    expect(describeRecruiterEligibility(profileState).state).toBe('suspended');
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    expect(screen.queryByTestId('post-opportunity-cta')).toBeNull();
    expect(screen.queryByTestId('empty-state-cta')).toBeNull();
    expect(screen.queryByTestId('recruiter-opportunity-form')).toBeNull();
  });

  it('renders status controls without legacy admin-review copy', () => {
    opportunitiesState = [makeOpportunity()];
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    expect(screen.getByText(/Completed Recruiter profiles can post/i)).toBeInTheDocument();
    expect(screen.getByText(/Verification adds trust/i)).toBeInTheDocument();
    expect(screen.queryByText(/Review:/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Resubmit for Review/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('create flow reaches createOpportunity.mutate with status=draft and canonical_version=1', async () => {
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    fireEvent.click(screen.getByTestId('empty-state-cta'));
    // openCreate awaits refetchProfile; wait for the canonical form.
    await waitFor(() => expect(screen.getByTestId('recruiter-opportunity-form')).toBeInTheDocument());
    // New opportunities open on the Write & Extract stage; navigate to
    // Essentials for the Title input, then to Review for Save Draft.
    fireEvent.click(screen.getByRole('tab', { name: /Essentials/ }));
    fireEvent.change(screen.getByLabelText('Opportunity Title'), { target: { value: 'New Draft' } });
    fireEvent.click(screen.getByRole('tab', { name: /Review & Publish/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    expect(h.createMutate).toHaveBeenCalledTimes(1);
    const call = h.createMutate.mock.calls[0];
    if (!call) throw new Error('createOpportunity.mutate not called');
    const payload: OpportunityInsert = call[0];
    expect(payload).toMatchObject({
      title: 'New Draft', company_name: 'Acme Trucking',
      status: 'draft', canonical_version: 1,
    });
    expect(h.updateMutate).not.toHaveBeenCalled();
  });

  it('edit flow reaches updateOpportunity.mutate with the exact opportunity ID', () => {
    opportunitiesState = [makeOpportunity({ id: 'opp-abc' })];
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // Editing opens on Essentials; Save Draft lives on Review.
    fireEvent.click(screen.getByRole('tab', { name: /Review & Publish/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    expect(h.updateMutate).toHaveBeenCalledTimes(1);
    const call = h.updateMutate.mock.calls[0];
    if (!call) throw new Error('updateOpportunity.mutate not called');
    const args: { id: string; data: OpportunityUpdate } = call[0];
    expect(args.id).toBe('opp-abc');
    expect(args.data.status).toBe('draft');
    expect(h.createMutate).not.toHaveBeenCalled();
  });


  it('does not reintroduce Quick Post, wizard, or legacy confirmations in source', () => {
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
