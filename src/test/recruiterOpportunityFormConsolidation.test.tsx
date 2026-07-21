// Phase 1L-DE1R2R1 — Manager ↔ canonical form integration.
//
// Focused on the manager surface: eligibility gating, CTA routing to the
// canonical form, edit hydration, mutation routing (create/update), and
// separation from admin-review semantics. Detailed form behavior is covered
// in phase1lDE1RecruiterOpportunityForm.test.tsx.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tables } from '@/integrations/supabase/types';

const h = vi.hoisted(() => ({
  refetch: vi.fn(),
  billingRefresh: vi.fn(),
  statusMutate: vi.fn(),
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
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

type Profile = Tables<'recruiter_profiles'>;
type Opportunity = Tables<'opportunities'>;
type ProfileHook = ReturnType<typeof useRecruiterProfile>;
type OppsHook = ReturnType<typeof useRecruiterOpportunities>;

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'r-1', user_id: 'u-1',
    recruiter_name: 'Jane Recruiter', company_name: 'Acme Trucking',
    recruiter_email: 'jane@acme.example', dot_number: '123456', mc_number: null,
    status: 'active', verification_status: 'approved',
    posting_terms_accepted_at: '2026-07-17T00:00:00Z',
    posting_terms_version: '2026-07-17.v1',
    legacy_terms_grandfathered_at: null,
    ...overrides,
  } as unknown as Profile;
}

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp-1', recruiter_id: 'r-1',
    title: 'Regional Dry Van', company_name: 'Acme Trucking',
    canonical_version: 1,
    status: 'active', admin_review_status: 'approved',
    driver_type: 'company', employment_model: 'company_driver', team_configuration: 'solo',
    route_type: 'Regional', trailer_type: 'Dry Van',
    hiring_city: 'Dallas', hiring_state: 'TX', hiring_states: [],
    description: 'Great regional lane.',
    home_time: 'Home weekly',
    pay_model: 'cpm', cpm: 0.65,
    estimated_weekly_miles: 2800, estimated_loaded_miles: 2600,
    deadhead_paid: false, transparency_confirmed: true,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
    published_at: '2026-07-01T00:00:00Z',
    ...overrides,
  } as unknown as Opportunity;
}

let profileState: Profile | null;
let opportunitiesState: Opportunity[];

function installHookMocks() {
  const suspended =
    !!profileState &&
    (profileState.status === 'suspended' || profileState.verification_status === 'suspended');
  const canPost = !!profileState && !suspended;

  vi.mocked(useRecruiterProfile).mockImplementation(() => ({
    profile: profileState,
    isLoading: false,
    isApproved: profileState?.verification_status === 'approved',
    isSuspended: suspended,
    isVerified: profileState?.verification_status === 'approved',
    isProfileComplete: true,
    canPost,
    refetch: vi.fn(),
  } as unknown as ProfileHook));

  vi.mocked(useRecruiterOpportunities).mockImplementation(() => ({
    opportunities: opportunitiesState,
    isLoading: false, isError: false, error: null, refetch: h.refetch,
    recruiterId: profileState?.id ?? null,
    isApproved: profileState?.verification_status === 'approved',
    canPost, isVerified: profileState?.verification_status === 'approved',
    createOpportunity: { mutate: h.createMutate, isPending: false },
    updateOpportunity: { mutate: h.updateMutate, isPending: false },
    setStatus: { mutate: h.statusMutate, isPending: false },
  } as unknown as OppsHook));
}

beforeEach(() => {
  vi.clearAllMocks();
  profileState = makeProfile();
  opportunitiesState = [];
  installHookMocks();
});

afterEach(() => cleanup());

describe('Phase 1L-DE1R2R1 — manager ↔ canonical form', () => {
  it('opens the canonical form from the top CTA', () => {
    opportunitiesState = [makeOpportunity()];
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    fireEvent.click(screen.getByTestId('post-opportunity-cta'));
    expect(screen.getByTestId('recruiter-opportunity-form')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Post Opportunity' })).toBeInTheDocument();
  });

  it('opens the canonical form from the empty-state CTA', () => {
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    fireEvent.click(screen.getByTestId('empty-state-cta'));
    expect(screen.getByTestId('recruiter-opportunity-form')).toBeInTheDocument();
  });

  it('edit routes into the same canonical form and hydrates canonical values', () => {
    opportunitiesState = [makeOpportunity()];
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByTestId('recruiter-opportunity-form')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit Opportunity' })).toBeInTheDocument();
    expect(screen.getByLabelText('Opportunity Title')).toHaveValue('Regional Dry Van');
    expect(screen.getByLabelText('Company Name')).toHaveValue('Acme Trucking');
    expect(screen.getByLabelText('Home Time')).toHaveValue('Home weekly');
    // Source correction: stored transparency=true must hydrate as checked.
    expect(screen.getByLabelText('Transparency confirmation')).toBeChecked();
  });

  it('completed, pending-verification profile may post', () => {
    profileState = makeProfile({ verification_status: 'pending' });
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    expect(screen.getByTestId('post-opportunity-cta')).toBeInTheDocument();
    expect(screen.getByTestId('empty-state-cta')).toBeInTheDocument();
  });

  it('completed, rejected-verification profile may post', () => {
    profileState = makeProfile({ verification_status: 'rejected' });
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    expect(screen.getByTestId('post-opportunity-cta')).toBeInTheDocument();
    expect(screen.getByTestId('empty-state-cta')).toBeInTheDocument();
  });

  it.each([
    ['status', { status: 'suspended' } as Partial<Profile>],
    ['verification status', { verification_status: 'suspended' } as Partial<Profile>],
  ])('blocks a profile suspended by %s at the manager gate', (_label, overrides) => {
    profileState = makeProfile(overrides);
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

  it('create flow reaches createOpportunity.mutate with status=draft and canonical_version=1', () => {
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    fireEvent.click(screen.getByTestId('empty-state-cta'));
    fireEvent.change(screen.getByLabelText('Opportunity Title'), { target: { value: 'New Draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    expect(h.createMutate).toHaveBeenCalledTimes(1);
    const payload = h.createMutate.mock.calls[0]?.[0] as Record<string, unknown>;
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
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    expect(h.updateMutate).toHaveBeenCalledTimes(1);
    const args = h.updateMutate.mock.calls[0]?.[0] as { id: string; data: Record<string, unknown> };
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
