// Phase 1K-B — recruiter publication status UI contract.
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getOpportunityPublicationStatus,
  type OpportunityPublicationInput,
} from '@/lib/opportunities/publicationStatus';

const h = vi.hoisted(() => ({
  refetch: vi.fn(),
  statusMutate: vi.fn(),
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  billingRefresh: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
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

import { RecruiterOpportunityManager } from '@/components/opportunities/RecruiterOpportunityManager';
import { useRecruiterOpportunities } from '@/hooks/opportunities/useRecruiterOpportunities';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

function input(overrides: Partial<OpportunityPublicationInput> = {}): OpportunityPublicationInput {
  return {
    status: 'active',
    admin_review_status: 'approved',
    published_at: '2026-07-20T00:00:00Z',
    ...overrides,
  };
}

describe('Phase 1K-B — getOpportunityPublicationStatus matrix', () => {
  it('draft', () => {
    expect(getOpportunityPublicationStatus(input({ status: 'draft', published_at: null }))).toEqual({
      key: 'draft',
      label: 'Draft — not visible',
      description: 'Not visible to drivers until you publish it.',
      variant: 'outline',
      isDriverVisible: false,
    });
  });

  it('paused', () => {
    expect(getOpportunityPublicationStatus(input({ status: 'paused' }))).toEqual({
      key: 'paused',
      label: 'Paused — not visible',
      description: 'Not visible to drivers while the listing is paused.',
      variant: 'secondary',
      isDriverVisible: false,
    });
  });

  it('closed', () => {
    expect(getOpportunityPublicationStatus(input({ status: 'closed' }))).toEqual({
      key: 'closed',
      label: 'Closed — not visible',
      description: 'Not visible to drivers because the listing is closed.',
      variant: 'secondary',
      isDriverVisible: false,
    });
  });

  it('active + rejected', () => {
    expect(
      getOpportunityPublicationStatus(input({ admin_review_status: 'rejected' })),
    ).toEqual({
      key: 'rejected',
      label: 'Changes required',
      description: 'Not visible to drivers because this opportunity was rejected.',
      variant: 'destructive',
      isDriverVisible: false,
    });
  });

  it('active + pending', () => {
    expect(
      getOpportunityPublicationStatus(
        input({ admin_review_status: 'pending', published_at: null }),
      ),
    ).toEqual({
      key: 'pending',
      label: 'Pending publication',
      description:
        'Active in your dashboard, but not visible to drivers while publication is pending.',
      variant: 'secondary',
      isDriverVisible: false,
    });
  });

  it('active + approved + non-null published_at => live', () => {
    expect(getOpportunityPublicationStatus(input())).toEqual({
      key: 'live',
      label: 'Live to drivers',
      description: 'Visible in the driver opportunities marketplace.',
      variant: 'default',
      isDriverVisible: true,
    });
  });

  it('active + approved + null published_at => incomplete', () => {
    expect(
      getOpportunityPublicationStatus(input({ published_at: null })),
    ).toEqual({
      key: 'incomplete',
      label: 'Publication incomplete',
      description:
        'Active and approved, but not visible to drivers because publication has not completed.',
      variant: 'destructive',
      isDriverVisible: false,
    });
  });

  it('unknown fallback => not_visible', () => {
    expect(
      getOpportunityPublicationStatus(
        input({ status: 'archived', admin_review_status: null, published_at: null }),
      ),
    ).toEqual({
      key: 'not_visible',
      label: 'Not visible to drivers',
      description: 'This opportunity is not currently visible in the driver marketplace.',
      variant: 'outline',
      isDriverVisible: false,
    });
  });

  it('active + approved + empty-string published_at is never live', () => {
    const s = getOpportunityPublicationStatus(input({ published_at: '' }));
    expect(s.key).toBe('incomplete');
    expect(s.isDriverVisible).toBe(false);
  });

  it('active + approved + null published_at is never live', () => {
    const s = getOpportunityPublicationStatus(input({ published_at: null }));
    expect(s.key).not.toBe('live');
    expect(s.isDriverVisible).toBe(false);
  });

  it('active + rejected + stale non-null published_at is still rejected/not visible', () => {
    const s = getOpportunityPublicationStatus(
      input({ admin_review_status: 'rejected', published_at: '2020-01-01T00:00:00Z' }),
    );
    expect(s.key).toBe('rejected');
    expect(s.isDriverVisible).toBe(false);
  });

  it('paused + approved + non-null published_at is paused/not visible', () => {
    const s = getOpportunityPublicationStatus(input({ status: 'paused' }));
    expect(s.key).toBe('paused');
    expect(s.isDriverVisible).toBe(false);
  });
});

function makeProfile() {
  return {
    id: 'r-1',
    user_id: 'u-1',
    recruiter_name: 'Jane Recruiter',
    company_name: 'Acme Trucking',
    recruiter_email: 'jane@acme.example',
    dot_number: '123456',
    mc_number: null,
    status: 'active',
    verification_status: 'approved',
    posting_terms_accepted_at: '2026-07-17T00:00:00Z',
    posting_terms_version: '2026-07-17.v1',
    legacy_terms_grandfathered_at: null,
  };
}

function makeOpp(overrides: Record<string, unknown>) {
  return {
    id: 'opp',
    recruiter_id: 'r-1',
    title: 'Regional Dry Van',
    company_name: 'Acme Trucking',
    status: 'active',
    admin_review_status: 'approved',
    published_at: null,
    driver_type: 'company',
    route_type: 'Regional',
    trailer_type: 'Dry Van',
    estimated_weekly_gross: 1800,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useRecruiterProfile).mockImplementation(() => ({
    profile: makeProfile(),
    isLoading: false,
    isApproved: true,
    isVerified: true,
    canPost: true,
    refetch: vi.fn(),
  } as never));
  vi.mocked(useRecruiterOpportunities).mockImplementation(() => ({
    opportunities: [
      makeOpp({ id: 'opp-live', title: 'Live Row', published_at: '2026-07-15T00:00:00Z' }),
      makeOpp({ id: 'opp-incomplete', title: 'Incomplete Row', published_at: null }),
      makeOpp({ id: 'opp-pending', title: 'Pending Row', admin_review_status: 'pending', published_at: null }),
      makeOpp({ id: 'opp-draft', title: 'Draft Row', status: 'draft', published_at: null }),
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: h.refetch,
    recruiterId: 'r-1',
    isApproved: true,
    canPost: true,
    isVerified: true,
    createOpportunity: { mutate: h.createMutate, isPending: false },
    updateOpportunity: { mutate: h.updateMutate, isPending: false },
    setStatus: { mutate: h.statusMutate, isPending: false },
  } as never));
});

afterEach(() => cleanup());

describe('Phase 1K-B — RecruiterOpportunityManager rendered publication status', () => {
  it('renders each row with the correct publication state, label, and description', () => {
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);

    const live = within(screen.getByTestId('opportunity-row-opp-live'));
    expect(live.getByTestId('publication-status-opp-live')).toHaveAttribute(
      'data-publication-state',
      'live',
    );
    expect(live.getByTestId('publication-status-opp-live')).toHaveTextContent('Live to drivers');
    expect(live.getByTestId('publication-status-description-opp-live')).toHaveTextContent(
      'Visible in the driver opportunities marketplace.',
    );
    expect(live.getByText('Listing: active')).toBeInTheDocument();

    const incomplete = within(screen.getByTestId('opportunity-row-opp-incomplete'));
    expect(incomplete.getByTestId('publication-status-opp-incomplete')).toHaveAttribute(
      'data-publication-state',
      'incomplete',
    );
    expect(incomplete.getByTestId('publication-status-opp-incomplete')).toHaveTextContent(
      'Publication incomplete',
    );
    expect(
      incomplete.getByTestId('publication-status-description-opp-incomplete'),
    ).toHaveTextContent(
      'Active and approved, but not visible to drivers because publication has not completed.',
    );
    expect(incomplete.queryByText('Live to drivers')).toBeNull();
    expect(incomplete.getByText('Listing: active')).toBeInTheDocument();
    // Existing Edit/Pause/Close controls remain on the active incomplete row.
    expect(incomplete.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(incomplete.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(incomplete.getByRole('button', { name: 'Close' })).toBeInTheDocument();

    const pending = within(screen.getByTestId('opportunity-row-opp-pending'));
    expect(pending.getByTestId('publication-status-opp-pending')).toHaveAttribute(
      'data-publication-state',
      'pending',
    );
    expect(pending.getByTestId('publication-status-opp-pending')).toHaveTextContent(
      'Pending publication',
    );
    expect(pending.getByText('Listing: active')).toBeInTheDocument();

    const draft = within(screen.getByTestId('opportunity-row-opp-draft'));
    expect(draft.getByTestId('publication-status-opp-draft')).toHaveAttribute(
      'data-publication-state',
      'draft',
    );
    expect(draft.getByTestId('publication-status-opp-draft')).toHaveTextContent(
      'Draft — not visible',
    );
    expect(draft.getByText('Listing: draft')).toBeInTheDocument();
  });

  it('preserves existing posting/verification header truth and appends the visibility sentence', () => {
    render(<RecruiterOpportunityManager onBack={vi.fn()} />);
    expect(
      screen.getByText(/Completed Recruiter profiles can post opportunities immediately\./i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Verification adds trust and a badge/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Each listing shows its driver visibility separately from its lifecycle status\./i),
    ).toBeInTheDocument();
  });
});
