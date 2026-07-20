/**
 * Phase 1J-B2A — Rendered tests for the controlled recruiter entry route.
 *
 * All authorization decisions are proved through mocked capability views;
 * no Supabase, billing, admin, plan, or profile signals are consulted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { UserCapabilityStatus } from '@/lib/userCapabilities';

// -----------------------------------------------------------------------
// Mocks — declared before SUT import.
// -----------------------------------------------------------------------
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => authMock(),
}));
vi.mock('@/hooks/useUserCapabilities', () => ({
  useUserCapabilities: () => capsMock(),
}));
vi.mock('@/hooks/useViewMode', () => ({
  useViewMode: () => viewMock(),
}));

type AuthMock = { user: { id: string } | null; loading: boolean };
type CapsMock = {
  isLoading: boolean;
  error: Error | null;
  refetch: ReturnType<typeof vi.fn>;
  beginRecruiterSetup: ReturnType<typeof vi.fn>;
};
type ViewMock = {
  setViewMode: ReturnType<typeof vi.fn>;
  recruiterHubAllowed: boolean;
  recruiterCapabilityStatus: UserCapabilityStatus | null;
  driverCapabilityStatus: UserCapabilityStatus | null;
};

let authMock: () => AuthMock;
let capsMock: () => CapsMock;
let viewMock: () => ViewMock;

import RecruiterEntryRoute from '@/components/opportunities/recruiter/RecruiterEntryRoute';

// -----------------------------------------------------------------------
// Test harness
// -----------------------------------------------------------------------
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function Tree() {
  return (
    <MemoryRouter initialEntries={['/recruiter']}>
      <LocationProbe />
      <Routes>
        <Route path="/recruiter" element={<RecruiterEntryRoute />} />
        <Route path="/dashboard" element={<div data-testid="dashboard-page" />} />
        <Route path="*" element={<div data-testid="other-page" />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderRoute() {
  return render(<Tree />);
}

function defaultAuth(): AuthMock {
  return { user: { id: 'user-a' }, loading: false };
}
function defaultCaps(overrides: Partial<CapsMock> = {}): CapsMock {
  return {
    isLoading: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(undefined),
    beginRecruiterSetup: vi.fn().mockResolvedValue('setup' as UserCapabilityStatus),
    ...overrides,
  };
}
function defaultView(overrides: Partial<ViewMock> = {}): ViewMock {
  return {
    setViewMode: vi.fn(),
    recruiterHubAllowed: false,
    recruiterCapabilityStatus: null,
    driverCapabilityStatus: 'active',
    ...overrides,
  };
}

let authState: AuthMock;
let capsState: CapsMock;
let viewState: ViewMock;

beforeEach(() => {
  authState = defaultAuth();
  capsState = defaultCaps();
  viewState = defaultView();
  authMock = () => authState;
  capsMock = () => capsState;
  viewMock = () => viewState;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------
// A. Loading
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — loading', () => {
  it('A. renders neutral loading and does not touch RPC/mode/nav while auth loads', async () => {
    authState = { user: null, loading: true };
    renderRoute();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(capsState.beginRecruiterSetup).not.toHaveBeenCalled();
    expect(viewState.setViewMode).not.toHaveBeenCalled();
    expect(screen.getByTestId('location').textContent).toBe('/recruiter');
  });

  it('A2. renders neutral loading while capability query is loading', async () => {
    capsState = defaultCaps({ isLoading: true });
    renderRoute();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(capsState.beginRecruiterSetup).not.toHaveBeenCalled();
    expect(viewState.setViewMode).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// B. Missing user defense in depth
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — missing user defense', () => {
  it('B. never calls RPC, never sets recruiter mode, never navigates when user is null', () => {
    authState = { user: null, loading: false };
    renderRoute();
    expect(capsState.beginRecruiterSetup).not.toHaveBeenCalled();
    expect(viewState.setViewMode).not.toHaveBeenCalled();
    expect(screen.getByTestId('location').textContent).toBe('/recruiter');
  });
});

// -----------------------------------------------------------------------
// C. Active driver + missing recruiter — exactly one auto RPC call
// (Real rerender proof, not no-op act.)
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — auto-activation', () => {
  it('C. fires beginRecruiterSetup exactly once across a real rerender', async () => {
    const { rerender } = renderRoute();
    await waitFor(() => {
      expect(capsState.beginRecruiterSetup).toHaveBeenCalledTimes(1);
    });
    expect(capsState.refetch).toHaveBeenCalledTimes(1);
    expect(viewState.setViewMode).not.toHaveBeenCalled();
    expect(screen.getByTestId('location').textContent).toBe('/recruiter');

    // Real re-render of the mounted route with identical mock state.
    rerender(<Tree />);
    await act(async () => {
      await Promise.resolve();
    });
    rerender(<Tree />);
    expect(capsState.beginRecruiterSetup).toHaveBeenCalledTimes(1);
  });
});

// -----------------------------------------------------------------------
// D. After refreshed rows: setup → onboarding + recruiter mode persisted
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — post-activation navigation', () => {
  it('D. persists recruiter mode and routes to onboarding once validated rows show recruiter setup', async () => {
    let refetchResolve: (() => void) | null = null;
    capsState = defaultCaps({
      refetch: vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            refetchResolve = resolve;
          }),
      ),
    });
    const { rerender } = renderRoute();

    await waitFor(() => {
      expect(capsState.beginRecruiterSetup).toHaveBeenCalledTimes(1);
    });

    // Validated rows now indicate setup + hubAllowed.
    viewState = defaultView({
      recruiterCapabilityStatus: 'setup',
      recruiterHubAllowed: true,
    });

    await act(async () => {
      refetchResolve?.();
      await Promise.resolve();
    });

    rerender(<Tree />);

    await waitFor(() => {
      expect(viewState.setViewMode).toHaveBeenCalledWith('recruiter');
    });
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/dashboard?page=recruiter-access:onboarding',
      );
    });
    // Order: setViewMode called at least once before location becomes
    // recruiter destination (both must be true simultaneously).
    expect(viewState.setViewMode).toHaveBeenCalledWith('recruiter');
  });
});

// -----------------------------------------------------------------------
// E/F/G. Existing recruiter states: no RPC, correct destination
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — existing recruiter capability', () => {
  it('E. existing setup + hubAllowed → onboarding, zero RPC, recruiter mode persisted', async () => {
    viewState = defaultView({
      recruiterCapabilityStatus: 'setup',
      recruiterHubAllowed: true,
    });
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/dashboard?page=recruiter-access:onboarding',
      );
    });
    expect(capsState.beginRecruiterSetup).not.toHaveBeenCalled();
    expect(viewState.setViewMode).toHaveBeenCalledWith('recruiter');
  });

  it('F. existing active + hubAllowed → hub, zero RPC, recruiter mode persisted', async () => {
    viewState = defaultView({
      recruiterCapabilityStatus: 'active',
      recruiterHubAllowed: true,
    });
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/dashboard?page=recruiter-access',
      );
    });
    expect(capsState.beginRecruiterSetup).not.toHaveBeenCalled();
    expect(viewState.setViewMode).toHaveBeenCalledWith('recruiter');
  });

  it('G. existing suspended + hubAllowed → hub with setViewMode(recruiter) persisted', async () => {
    viewState = defaultView({
      recruiterCapabilityStatus: 'suspended',
      recruiterHubAllowed: true,
    });
    renderRoute();
    await waitFor(() => {
      expect(viewState.setViewMode).toHaveBeenCalledWith('recruiter');
    });
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/dashboard?page=recruiter-access',
      );
    });
    expect(capsState.beginRecruiterSetup).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// G2. Eligible status but hubAllowed=false → fail closed on entry route
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — fail-closed when hub not authorized', () => {
  it('G2a. setup + hubAllowed=false → zero setViewMode, location stays /recruiter', async () => {
    viewState = defaultView({
      recruiterCapabilityStatus: 'setup',
      recruiterHubAllowed: false,
    });
    renderRoute();
    // Allow any pending effects to settle.
    await act(async () => {
      await Promise.resolve();
    });
    expect(viewState.setViewMode).not.toHaveBeenCalled();
    expect(screen.getByTestId('location').textContent).toBe('/recruiter');
    expect(capsState.beginRecruiterSetup).not.toHaveBeenCalled();
    // Neutral preparation UI (role=status), not blocked alert.
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('G2b. active + hubAllowed=false → zero setViewMode, location stays /recruiter', async () => {
    viewState = defaultView({
      recruiterCapabilityStatus: 'active',
      recruiterHubAllowed: false,
    });
    renderRoute();
    await act(async () => {
      await Promise.resolve();
    });
    expect(viewState.setViewMode).not.toHaveBeenCalled();
    expect(screen.getByTestId('location').textContent).toBe('/recruiter');
    expect(capsState.beginRecruiterSetup).not.toHaveBeenCalled();
  });

  it('G2c. suspended + hubAllowed=false → zero setViewMode, location stays /recruiter', async () => {
    viewState = defaultView({
      recruiterCapabilityStatus: 'suspended',
      recruiterHubAllowed: false,
    });
    renderRoute();
    await act(async () => {
      await Promise.resolve();
    });
    expect(viewState.setViewMode).not.toHaveBeenCalled();
    expect(screen.getByTestId('location').textContent).toBe('/recruiter');
    expect(capsState.beginRecruiterSetup).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// H. Revoked — blocked, no RPC, no recruiter mode, escape available
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — revoked', () => {
  it('H. revoked recruiter shows blocked panel and never activates', () => {
    viewState = defaultView({
      recruiterCapabilityStatus: 'revoked',
      recruiterHubAllowed: false,
    });
    renderRoute();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(capsState.beginRecruiterSetup).not.toHaveBeenCalled();
    expect(viewState.setViewMode).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /back to driver dashboard/i })).toBeTruthy();
  });
});

// -----------------------------------------------------------------------
// I. Fail-closed on malformed/empty/driver-non-active
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — fail-closed capability', () => {
  it('I1. driver revoked → blocked, no RPC', () => {
    viewState = defaultView({
      driverCapabilityStatus: 'revoked',
      recruiterCapabilityStatus: null,
    });
    renderRoute();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(capsState.beginRecruiterSetup).not.toHaveBeenCalled();
  });

  it('I2. empty capability rows (driver null) → blocked, no RPC', () => {
    viewState = defaultView({
      driverCapabilityStatus: null,
      recruiterCapabilityStatus: null,
    });
    renderRoute();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(capsState.beginRecruiterSetup).not.toHaveBeenCalled();
  });

  it('I3. capability query error → blocked, no RPC', () => {
    capsState = defaultCaps({ error: new Error('boom') });
    renderRoute();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(capsState.beginRecruiterSetup).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// J. RPC failure — error UI, no navigation, Try Again = exactly one more call
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — RPC failure', () => {
  it('J. shows error, does not navigate, retry triggers exactly one additional call', async () => {
    capsState = defaultCaps({
      beginRecruiterSetup: vi
        .fn()
        .mockRejectedValueOnce(new Error('rpc down'))
        .mockResolvedValueOnce('setup' as UserCapabilityStatus),
    });
    renderRoute();
    await waitFor(() => {
      expect(capsState.beginRecruiterSetup).toHaveBeenCalledTimes(1);
    });
    await screen.findByText(/rpc down/i);
    expect(screen.getByTestId('location').textContent).toBe('/recruiter');
    expect(viewState.setViewMode).not.toHaveBeenCalled();

    const retry = screen.getByRole('button', { name: /try again/i });
    await act(async () => {
      fireEvent.click(retry);
    });
    await waitFor(() => {
      expect(capsState.beginRecruiterSetup).toHaveBeenCalledTimes(2);
    });
  });
});

// -----------------------------------------------------------------------
// K. In-flight user race: A pending → switch to B → A completes.
//    A completion must not touch B's state or navigate.
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — in-flight user race isolation', () => {
  it('K1. stale A rejection after switch to B does not touch B state or navigate', async () => {
    // A's RPC never resolves until we release it.
    let rejectA: ((e: Error) => void) | null = null;
    const beginA = vi.fn().mockImplementation(
      () =>
        new Promise<UserCapabilityStatus>((_res, rej) => {
          rejectA = (e) => rej(e);
        }),
    );
    const refetchA = vi.fn().mockResolvedValue(undefined);
    const setViewA = viewState.setViewMode;
    capsState = defaultCaps({ beginRecruiterSetup: beginA, refetch: refetchA });

    const { rerender } = renderRoute();
    await waitFor(() => {
      expect(beginA).toHaveBeenCalledTimes(1);
    });

    // Switch to user B with fresh caps/view (still driver-only).
    const beginB = vi.fn().mockResolvedValue('setup' as UserCapabilityStatus);
    const refetchB = vi.fn().mockResolvedValue(undefined);
    const setViewB = vi.fn();
    authState = { user: { id: 'user-b' }, loading: false };
    capsState = defaultCaps({ beginRecruiterSetup: beginB, refetch: refetchB });
    viewState = defaultView({ setViewMode: setViewB });

    rerender(<Tree />);

    await waitFor(() => {
      expect(beginB).toHaveBeenCalledTimes(1);
    });

    // Now let A's stale attempt reject.
    await act(async () => {
      rejectA?.(new Error('A stale error'));
      await Promise.resolve();
      await Promise.resolve();
    });

    // A's completion must be a strict no-op:
    // - No stale error UI for A.
    expect(screen.queryByText(/A stale error/i)).toBeNull();
    // - No refetch fired for A.
    expect(refetchA).not.toHaveBeenCalled();
    // - Did not call A's setViewMode.
    expect(setViewA).not.toHaveBeenCalled();
    // - Did not navigate anywhere for A.
    expect(screen.getByTestId('location').textContent).toBe('/recruiter');

    // Complete B normally with validated recruiter rows.
    viewState = defaultView({
      setViewMode: setViewB,
      recruiterCapabilityStatus: 'setup',
      recruiterHubAllowed: true,
    });
    rerender(<Tree />);

    await waitFor(() => {
      expect(setViewB).toHaveBeenCalledWith('recruiter');
    });
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/dashboard?page=recruiter-access:onboarding',
      );
    });
    // Confirm B did exactly one activation attempt.
    expect(beginB).toHaveBeenCalledTimes(1);
  });

  it('K2. stale A success after switch to B does not refetch A, set A mode, or navigate', async () => {
    let resolveA: ((v: UserCapabilityStatus) => void) | null = null;
    const beginA = vi.fn().mockImplementation(
      () =>
        new Promise<UserCapabilityStatus>((res) => {
          resolveA = (v) => res(v);
        }),
    );
    const refetchA = vi.fn().mockResolvedValue(undefined);
    const setViewA = viewState.setViewMode;
    capsState = defaultCaps({ beginRecruiterSetup: beginA, refetch: refetchA });

    const { rerender } = renderRoute();
    await waitFor(() => {
      expect(beginA).toHaveBeenCalledTimes(1);
    });

    // Switch to B.
    const beginB = vi.fn().mockResolvedValue('setup' as UserCapabilityStatus);
    const refetchB = vi.fn().mockResolvedValue(undefined);
    const setViewB = vi.fn();
    authState = { user: { id: 'user-b' }, loading: false };
    capsState = defaultCaps({ beginRecruiterSetup: beginB, refetch: refetchB });
    viewState = defaultView({ setViewMode: setViewB });
    rerender(<Tree />);

    await waitFor(() => {
      expect(beginB).toHaveBeenCalledTimes(1);
    });

    // Now let A's stale attempt resolve successfully.
    await act(async () => {
      resolveA?.('setup' as UserCapabilityStatus);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Captured A refetch must NOT be invoked; only B's may.
    expect(refetchA).not.toHaveBeenCalled();
    expect(setViewA).not.toHaveBeenCalled();
    expect(screen.getByTestId('location').textContent).toBe('/recruiter');
  });
});

// -----------------------------------------------------------------------
// L. Import surface — no forbidden authorization sources
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — import surface', () => {
  it('L. does not import from useAdmin, billing, subscription, Stripe, recruiter profile, or useUserRole', () => {
    const src = readFileSync(
      resolve(__dirname, '../components/opportunities/recruiter/RecruiterEntryRoute.tsx'),
      'utf8',
    );
    const forbidden = [
      'useAdmin',
      'useSubscription',
      'useRecruiterBilling',
      'useUserRole',
      'useRecruiterProfile',
      'billing/plans',
      'recruiterCapabilities',
      'stripe',
      'Stripe',
    ];
    for (const needle of forbidden) {
      expect(src, `must not reference ${needle}`).not.toMatch(new RegExp(needle));
    }
  });
});

// -----------------------------------------------------------------------
// M. App route proof — /recruiter uses RecruiterEntryRoute, deep links unchanged
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — App route wiring', () => {
  it('M. /recruiter renders RecruiterEntryRoute while operational deep-link redirects are unchanged', () => {
    const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
    expect(app).toMatch(
      /RecruiterEntryRoute\s*=\s*lazy\(\(\)\s*=>\s*import\(["']\.\/components\/opportunities\/recruiter\/RecruiterEntryRoute["']\)\)/,
    );
    expect(app).toMatch(
      /<Route\s+path="\/recruiter"\s+element=\{<ProtectedRoute><RecruiterEntryRoute\s*\/><\/ProtectedRoute>\}\s*\/>/,
    );
    expect(app).toMatch(
      /path="\/recruiter\/manage"[\s\S]*?Navigate to="\/dashboard\?page=recruiter-access:manager"/,
    );
    expect(app).toMatch(
      /path="\/recruiter\/applications"[\s\S]*?Navigate to="\/dashboard\?page=recruiter-access:applications"/,
    );
    expect(app).toMatch(
      /path="\/recruiter\/reports"[\s\S]*?Navigate to="\/dashboard\?page=recruiter-access:reports"/,
    );
    expect(app).toMatch(
      /path="\/recruiter\/onboarding"[\s\S]*?Navigate to="\/dashboard\?page=recruiter-access:onboarding"/,
    );
  });
});
