// Phase 1R-C — production consumer conversion gate.
//
// Proves that recruiter premium consumers (contracts workflow + recruiter
// reports) are driven by the EFFECTIVE business entitlement capabilities
// rather than a raw recruiter plan/status comparison, and that unresolved
// (loading / error / conflict) entitlement states fail closed.

import fs from 'node:fs';
import path from 'node:path';
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

// ---------------------------------------------------------------------------
// Phase 1R-C-R1 — report consumer header + cache identity behavior
// ---------------------------------------------------------------------------

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

function sharedWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('Phase 1R-C-R1 — recruiter report header and cache identity', () => {
  it('agency-included access produces an effective-plan header marked included_with_agency', async () => {
    setBilling({ tier: 'growth', source: 'agency_included', plan: 'none' });
    const qc = makeClient();
    const { result } = renderHook(() => useRecruiterReportData(RANGE), {
      wrapper: sharedWrapper(qc),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data!.header.plan).toBe('growth');
    expect(result.current.data!.header.planStatus).toBe('included_with_agency');
    expect(result.current.entitlementSource).toBe('agency_included');
  });

  it('recruiter-subscription access produces a raw-status header', async () => {
    setBilling({ tier: 'fleet', source: 'recruiter_subscription', plan: 'fleet' });
    const qc = makeClient();
    const { result } = renderHook(() => useRecruiterReportData(RANGE), {
      wrapper: sharedWrapper(qc),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data!.header.plan).toBe('fleet');
    expect(result.current.data!.header.planStatus).toBe('active');
  });

  it('changing effective plan/source/status for the same recruiter and range creates a new cache entry and header', async () => {
    const qc = makeClient();

    setBilling({ tier: 'fleet', source: 'recruiter_subscription', plan: 'fleet' });
    const first = renderHook(() => useRecruiterReportData(RANGE), {
      wrapper: sharedWrapper(qc),
    });
    await waitFor(() => expect(first.result.current.data).not.toBeNull());
    const firstHeader = first.result.current.data!.header;
    expect(firstHeader.plan).toBe('fleet');
    expect(firstHeader.planStatus).toBe('active');
    const keysAfterFirst = qc
      .getQueryCache()
      .getAll()
      .filter((q) => q.queryKey[0] === 'recruiter-report-data');
    expect(keysAfterFirst).toHaveLength(1);
    first.unmount();

    // Same recruiter + same range, different effective plan/source/status.
    setBilling({ tier: 'growth', source: 'agency_included', plan: 'none' });
    const second = renderHook(() => useRecruiterReportData(RANGE), {
      wrapper: sharedWrapper(qc),
    });
    await waitFor(() => expect(second.result.current.data).not.toBeNull());
    const secondHeader = second.result.current.data!.header;
    expect(secondHeader.plan).toBe('growth');
    expect(secondHeader.planStatus).toBe('included_with_agency');

    const reportKeys = qc
      .getQueryCache()
      .getAll()
      .filter((q) => q.queryKey[0] === 'recruiter-report-data')
      .map((q) => JSON.stringify(q.queryKey));
    expect(reportKeys).toHaveLength(2);
    expect(new Set(reportKeys).size).toBe(2);
    second.unmount();
  });
});

// ---------------------------------------------------------------------------
// Phase 1R-C-R1 — authoritative SQL and production source contract guards
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

describe('Phase 1R-C-R1 — authoritative get_my_agency SQL guard', () => {
  it('the latest get_my_agency definition joins agency_members with an active status filter', () => {
    const migrationsDir = path.join(REPO_ROOT, 'supabase/migrations');
    const marker = 'CREATE OR REPLACE FUNCTION public.get_my_agency';
    const matching = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) =>
        fs.readFileSync(path.join(migrationsDir, f), 'utf8').includes(marker),
      );

    expect(matching.length).toBeGreaterThan(0);

    const latest = matching[matching.length - 1];
    const sql = fs.readFileSync(path.join(migrationsDir, latest), 'utf8');
    const start = sql.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const bodyStart = sql.indexOf('$$', start);
    expect(bodyStart).toBeGreaterThan(-1);
    const bodyEnd = sql.indexOf('$$;', bodyStart + 2);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
    const body = sql.slice(bodyStart, bodyEnd);

    expect(body).toMatch(/public\.agency_members\s+am/);
    expect(body).toMatch(/am\.member_user_id\s*=\s*auth\.uid\(\)/);
    expect(body).toMatch(/am\.status\s*=\s*'active'/);
  });
});

describe('Phase 1R-C-R1 — production consumer source guards', () => {
  it('useRecruiterReportData keys the query on effective plan, source, and raw status', () => {
    const src = readRepoFile('src/hooks/recruiter/useRecruiterReportData.ts');
    const keyStart = src.indexOf("'recruiter-report-data'");
    expect(keyStart).toBeGreaterThan(-1);
    const keyBlock = src.slice(keyStart, src.indexOf('],', keyStart));
    expect(keyBlock).toContain('effectivePlan');
    expect(keyBlock).toContain('entitlementSource');
    expect(keyBlock).toContain('billing.status');

    expect(src).toContain('billing.canExportRecruiterReports === true');
    expect(src).not.toMatch(/plan\s*===\s*'growth'/);
    expect(src).not.toMatch(/plan\s*===\s*'fleet'/);
  });

  it('contract consumers gate on canUseContractWorkflowTools, not a raw recruiter plan', () => {
    for (const file of [
      'src/components/contracts/ContractActionsCard.tsx',
      'src/components/contracts/RecruiterContractsView.tsx',
    ]) {
      const src = readRepoFile(file);
      expect(src).toContain('canUseContractWorkflowTools');
      expect(src).not.toMatch(/\bplan\s*===\s*'(starter|growth|fleet)'/);
      expect(src).not.toMatch(/\bstatus\s*===\s*'active'\s*&&\s*plan\b/);
    }
  });

  it('RecruiterAccessPage summarizes premium from effective entitlement fields', () => {
    const src = readRepoFile(
      'src/components/opportunities/recruiter/RecruiterAccessPage.tsx',
    );
    expect(src).toContain('hasEffectivePremiumRecruiterAccess');
    expect(src).toContain('effectiveRecruiterPlan');
    expect(src).toContain('canUsePriorityPlacement');
    expect(src).toContain("=== 'agency_included'");
  });

  it('useRecruiterBilling composes the real resolver and invalidates both agency prefixes', () => {
    const src = readRepoFile('src/hooks/opportunities/useRecruiterBilling.ts');
    expect(src).toContain(
      "from '@/lib/billing/effectiveBusinessEntitlement'",
    );
    expect(src).toContain('resolveEffectiveBusinessEntitlement({');
    for (const field of [
      'businessEntitlementState',
      'effectiveRecruiterTier',
      'effectiveRecruiterPlan',
      'entitlementSource',
      'billingManagementContext',
      'hasEffectivePremiumRecruiterAccess',
      'isBusinessEntitlementLoading',
    ]) {
      expect(src).toContain(field);
    }
    expect(src).toContain("queryKey: ['my-agency']");
    expect(src).toContain("queryKey: ['agency-entitlement']");
  });
});
