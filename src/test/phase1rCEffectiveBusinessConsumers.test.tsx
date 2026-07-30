// Phase 1R-C — production consumer conversion gate.
//
// Proves that recruiter premium consumers (contracts workflow + recruiter
// reports) are driven by the EFFECTIVE business entitlement capabilities
// rather than a raw recruiter plan/status comparison, and that unresolved
// (loading / error / conflict) entitlement states fail closed.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// --- hoisted mock state -----------------------------------------------------

const billingMocks = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
const profileMocks = vi.hoisted(() => ({
  profile: { id: 'rec-1', company_name: 'Real Freight LLC' } as Record<
    string,
    unknown
  > | null,
}));
const appsMocks = vi.hoisted(() => ({
  lastRecruiterId: undefined as string | undefined,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/opportunities/useRecruiterBilling', async () => {
  const actual = await vi.importActual<
    typeof import('@/hooks/opportunities/useRecruiterBilling')
  >('@/hooks/opportunities/useRecruiterBilling');
  return {
    ...actual,
    useRecruiterBilling: () => billingMocks.value,
  };
});

vi.mock('@/hooks/opportunities/useRecruiterProfile', () => ({
  useRecruiterProfile: () => ({
    profile: profileMocks.profile,
    isLoading: false,
    isApproved: true,
    isSuspended: false,
    isProfileComplete: true,
    canPost: true,
  }),
}));

vi.mock('@/hooks/opportunities/useOpportunityApplications', () => ({
  useOpportunityApplications: (args: { recruiterId?: string }) => {
    appsMocks.lastRecruiterId = args?.recruiterId;
    return {
      recruiterApplications: [],
      isLoadingRecruiter: false,
      isErrorRecruiter: false,
      refetchRecruiter: vi.fn(),
    };
  },
}));

vi.mock('@/hooks/contracts/useContractsPipeline', async () => {
  const actual = await vi.importActual<
    typeof import('@/hooks/contracts/useContractsPipeline')
  >('@/hooks/contracts/useContractsPipeline');
  return {
    ...actual,
    useContractsPipeline: () => ({
      pipeline: new Map(),
      isLoading: false,
      refetch: vi.fn(),
    }),
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => Promise.resolve({ data: [], error: null });
      chain.in = () => Promise.resolve({ data: [], error: null });
      return chain;
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}));

import { RecruiterContractsView } from '@/components/contracts/RecruiterContractsView';
import { useRecruiterReportData } from '@/hooks/recruiter/useRecruiterReportData';
import { getRecruiterCapabilitiesForTier } from '@/lib/recruiterCapabilities';

// --- helpers ----------------------------------------------------------------

type Scenario = {
  tier: 'free_verified' | 'starter' | 'growth' | 'fleet';
  state?: 'loading' | 'resolved' | 'error' | 'conflict';
  source?: 'none' | 'free_standard' | 'recruiter_subscription' | 'agency_included';
  plan?: 'none' | 'starter' | 'growth' | 'fleet';
};

function setBilling({
  tier,
  state = 'resolved',
  source = 'free_standard',
  plan = 'none',
}: Scenario) {
  // Unresolved entitlement states never grant premium capabilities.
  const premiumTier = state === 'resolved' ? tier : 'free_verified';
  const caps = getRecruiterCapabilitiesForTier({
    tier: premiumTier,
    canPostStandardOpportunities: true,
  });
  billingMocks.value = {
    ...caps,
    isLoading: false,
    plan,
    status: plan === 'none' ? 'inactive' : 'active',
    isBillingActive: plan !== 'none',
    limit: 0,
    activeCount: 0,
    businessEntitlementState: state,
    effectiveRecruiterTier: premiumTier,
    effectiveRecruiterPlan: premiumTier === 'free_verified' ? 'none' : premiumTier,
    effectiveAgencyPlan: source === 'agency_included' ? 'agency_team' : null,
    entitlementSource: source,
    billingManagementContext: 'none',
    hasEffectivePremiumRecruiterAccess: premiumTier !== 'free_verified',
    isBusinessEntitlementLoading: state === 'loading',
    startCheckout: { mutate: vi.fn(), isPending: false },
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderContracts() {
  return render(<RecruiterContractsView />, { wrapper });
}

beforeEach(() => {
  profileMocks.profile = { id: 'rec-1', company_name: 'Real Freight LLC' };
  appsMocks.lastRecruiterId = undefined;
  setBilling({ tier: 'free_verified' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Contract workflow consumer
// ---------------------------------------------------------------------------

describe('Phase 1R-C — RecruiterContractsView effective capability gating', () => {
  it('agency-included growth access unlocks contracts with no recruiter subscription', async () => {
    setBilling({
      tier: 'growth',
      source: 'agency_included',
      plan: 'none',
    });
    renderContracts();
    await waitFor(() =>
      expect(screen.queryByText(/Upgrade required/i)).toBeNull(),
    );
    expect(
      screen.queryByTestId('recruiter-contracts-entitlement-unavailable'),
    ).toBeNull();
    // Applications are fetched for the recruiter — access was granted.
    expect(appsMocks.lastRecruiterId).toBe('rec-1');
  });

  it('agency-included fleet access also unlocks contracts', async () => {
    setBilling({ tier: 'fleet', source: 'agency_included', plan: 'none' });
    renderContracts();
    await waitFor(() =>
      expect(screen.queryByText(/Upgrade required/i)).toBeNull(),
    );
    expect(appsMocks.lastRecruiterId).toBe('rec-1');
  });

  it('recruiter growth subscription still unlocks contracts (no regression)', async () => {
    setBilling({
      tier: 'growth',
      source: 'recruiter_subscription',
      plan: 'growth',
    });
    renderContracts();
    await waitFor(() =>
      expect(screen.queryByText(/Upgrade required/i)).toBeNull(),
    );
    expect(appsMocks.lastRecruiterId).toBe('rec-1');
  });

  it('free standard access shows the upgrade card and never fetches applications', async () => {
    setBilling({ tier: 'free_verified' });
    renderContracts();
    expect(await screen.findByText(/Upgrade required/i)).toBeInTheDocument();
    expect(appsMocks.lastRecruiterId).toBeUndefined();
  });

  it('starter tier does not unlock contract workflow tools', async () => {
    setBilling({
      tier: 'starter',
      source: 'recruiter_subscription',
      plan: 'starter',
    });
    renderContracts();
    expect(await screen.findByText(/Upgrade required/i)).toBeInTheDocument();
    expect(appsMocks.lastRecruiterId).toBeUndefined();
  });

  it('conflict state fails closed with the unavailable notice, not an upgrade prompt', async () => {
    setBilling({ tier: 'growth', state: 'conflict', source: 'none' });
    renderContracts();
    const card = await screen.findByTestId(
      'recruiter-contracts-entitlement-unavailable',
    );
    expect(card.textContent).toMatch(/overlapping business subscriptions/i);
    expect(screen.queryByText(/Upgrade required/i)).toBeNull();
    expect(appsMocks.lastRecruiterId).toBeUndefined();
  });

  it('error state fails closed with the unavailable notice', async () => {
    setBilling({ tier: 'growth', state: 'error', source: 'none' });
    renderContracts();
    const card = await screen.findByTestId(
      'recruiter-contracts-entitlement-unavailable',
    );
    expect(card.textContent).toMatch(/couldn't confirm your plan access/i);
    expect(appsMocks.lastRecruiterId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Recruiter report data consumer
// ---------------------------------------------------------------------------

const RANGE = { from: '2026-07-01', to: '2026-07-31', label: 'July' } as never;

describe('Phase 1R-C — useRecruiterReportData effective capability gating', () => {
  it('agency-included growth is report eligible with no recruiter subscription', () => {
    setBilling({ tier: 'growth', source: 'agency_included', plan: 'none' });
    const { result } = renderHook(() => useRecruiterReportData(RANGE), {
      wrapper,
    });
    expect(result.current.planEligible).toBe(true);
  });

  it('free standard is not report eligible', () => {
    setBilling({ tier: 'free_verified' });
    const { result } = renderHook(() => useRecruiterReportData(RANGE), {
      wrapper,
    });
    expect(result.current.planEligible).toBe(false);
  });

  it('starter is not report eligible', () => {
    setBilling({
      tier: 'starter',
      source: 'recruiter_subscription',
      plan: 'starter',
    });
    const { result } = renderHook(() => useRecruiterReportData(RANGE), {
      wrapper,
    });
    expect(result.current.planEligible).toBe(false);
  });

  it('recruiter fleet subscription remains report eligible', () => {
    setBilling({
      tier: 'fleet',
      source: 'recruiter_subscription',
      plan: 'fleet',
    });
    const { result } = renderHook(() => useRecruiterReportData(RANGE), {
      wrapper,
    });
    expect(result.current.planEligible).toBe(true);
  });

  it('conflict and error states fail closed for reports', () => {
    for (const state of ['conflict', 'error', 'loading'] as const) {
      setBilling({ tier: 'growth', state, source: 'none' });
      const { result, unmount } = renderHook(
        () => useRecruiterReportData(RANGE),
        { wrapper },
      );
      expect(result.current.planEligible).toBe(false);
      unmount();
    }
  });
});
