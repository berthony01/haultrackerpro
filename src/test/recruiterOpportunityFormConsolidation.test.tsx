// Phase 1F-B — Recruiter opportunity form consolidation.
//
// Renders the actual production `RecruiterOpportunityManager` +
// `RecruiterOpportunityForm` (no test-only duplicates) with narrow
// module-boundary mocks and asserts:
//   1. Manager opens the unified form directly from "Post Opportunity"
//      and from the empty-state CTA — no intermediate "Quick Post" step.
//   2. Editing an existing opportunity opens the same unified form
//      populated with the row's data.
//   3. The unified form is a single page (essentials always visible,
//      optional details behind one collapsible section) — not a
//      five-step wizard, no "Step 1 of 5" scaffolding.
//   4. The header title matches the mode ("Post Opportunity" vs
//      "Edit Opportunity") and "Paste to auto-fill" stays available.
//   5. Actions render exactly once (Save Draft + Publish Opportunity),
//      not duplicated top and bottom.
//   6. `RecruiterQuickPostForm` is fully removed from the module tree.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/hooks/opportunities/useRecruiterProfile', () => ({
  useRecruiterProfile: vi.fn(),
}));
vi.mock('@/hooks/opportunities/useRecruiterOpportunities', () => ({
  useRecruiterOpportunities: vi.fn(),
}));
vi.mock('@/hooks/opportunities/useRecruiterBilling', () => ({
  useRecruiterBilling: vi.fn(() => ({ refresh: vi.fn() })),
}));
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: vi.fn(() => ({ intentRecruiter: true })),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: vi.fn(() => ({ select: vi.fn(), eq: vi.fn() })),
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
  },
}));
vi.mock('@/components/opportunities/RecruiterReferralsPanel', () => ({
  RecruiterReferralsPanel: () => <div data-testid="stub-referrals-panel" />,
}));

import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { useRecruiterOpportunities } from '@/hooks/opportunities/useRecruiterOpportunities';
import { RecruiterOpportunityManager } from '@/components/opportunities/RecruiterOpportunityManager';

const eligibleProfile = {
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
} as never;

const sampleOpportunity = {
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
} as never;

function mockManager(opportunities: unknown[]) {
  (useRecruiterProfile as unknown as vi.Mock).mockReturnValue({
    profile: eligibleProfile,
    isLoading: false,
    isApproved: false,
    isVerified: false,
    canPost: true,
    refetch: vi.fn(),
  });
  (useRecruiterOpportunities as unknown as vi.Mock).mockReturnValue({
    opportunities,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    recruiterId: 'r-1',
    isApproved: false,
    canPost: true,
    isVerified: false,
    createOpportunity: { mutate: vi.fn(), isPending: false },
    updateOpportunity: { mutate: vi.fn(), isPending: false },
    setStatus: { mutate: vi.fn(), isPending: false },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Phase 1F-B — unified Recruiter opportunity form', () => {
  it('opens the unified form directly when the top "Post Opportunity" button is clicked', () => {
    mockManager([sampleOpportunity]);
    render(<RecruiterOpportunityManager onBack={() => {}} />);

    fireEvent.click(screen.getByTestId('post-opportunity-cta'));

    const form = screen.getByTestId('recruiter-opportunity-form');
    expect(form).toBeInTheDocument();
    expect(within(form).getByRole('heading', { name: /post opportunity/i })).toBeInTheDocument();
    // Essentials + collapsible optional section, no wizard scaffolding.
    expect(within(form).getByTestId('essentials-section')).toBeInTheDocument();
    expect(within(form).getByTestId('optional-details-section')).toBeInTheDocument();
    expect(within(form).queryByText(/step\s*\d+\s*of\s*\d+/i)).toBeNull();
  });

  it('opens the unified form from the empty-state CTA (no Quick Post handoff)', () => {
    mockManager([]);
    render(<RecruiterOpportunityManager onBack={() => {}} />);

    fireEvent.click(screen.getByTestId('empty-state-cta'));

    expect(screen.getByTestId('recruiter-opportunity-form')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /post opportunity/i })).toBeInTheDocument();
  });

  it('editing an existing opportunity opens the same unified form pre-filled', () => {
    mockManager([sampleOpportunity]);
    render(<RecruiterOpportunityManager onBack={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    const form = screen.getByTestId('recruiter-opportunity-form');
    expect(within(form).getByRole('heading', { name: /edit opportunity/i })).toBeInTheDocument();
    expect(within(form).getByDisplayValue('Regional Dry Van')).toBeInTheDocument();
    expect(within(form).getByDisplayValue('Acme Trucking')).toBeInTheDocument();
  });

  it('keeps "Paste to auto-fill" available and only renders one action row', () => {
    mockManager([]);
    render(<RecruiterOpportunityManager onBack={() => {}} />);
    fireEvent.click(screen.getByTestId('empty-state-cta'));

    expect(screen.getByRole('button', { name: /paste to auto-fill/i })).toBeInTheDocument();

    // Single action row, no duplicated top/bottom action sets.
    expect(screen.getAllByTestId('form-actions')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /save draft/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /publish opportunity/i })).toHaveLength(1);
  });

  it('optional details are collapsed by default in create mode and toggle on click', () => {
    mockManager([]);
    render(<RecruiterOpportunityManager onBack={() => {}} />);
    fireEvent.click(screen.getByTestId('empty-state-cta'));

    const section = screen.getByTestId('optional-details-section');
    expect(section.getAttribute('data-open')).toBe('false');
    expect(screen.queryByTestId('optional-details-body')).toBeNull();

    fireEvent.click(screen.getByTestId('optional-details-toggle'));

    expect(screen.getByTestId('optional-details-section').getAttribute('data-open')).toBe('true');
    expect(screen.getByTestId('optional-details-body')).toBeInTheDocument();
  });

  it('RecruiterQuickPostForm is no longer present in the manager module', () => {
    const managerSrc = fs.readFileSync(
      path.resolve(__dirname, '../components/opportunities/RecruiterOpportunityManager.tsx'),
      'utf8',
    );
    expect(managerSrc).not.toMatch(/RecruiterQuickPostForm/);
  });
});
