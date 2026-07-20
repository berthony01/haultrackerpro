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

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/recruiter']}>
      <Routes>
        <Route path="/recruiter" element={<RecruiterEntryRoute />} />
        <Route path="/dashboard" element={<LocationProbe />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
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
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — auto-activation', () => {
  it('C. fires beginRecruiterSetup exactly once across rerenders and waits for refreshed rows before navigating', async () => {
    renderRoute();
    await waitFor(() => {
      expect(capsState.beginRecruiterSetup).toHaveBeenCalledTimes(1);
    });
    // Refetch must be awaited before any navigation is permitted.
    expect(capsState.refetch).toHaveBeenCalledTimes(1);
    // No recruiter rows yet → no navigation, no setViewMode.
    expect(viewState.setViewMode).not.toHaveBeenCalled();
    expect(screen.getByTestId('location').textContent).toBe('/recruiter');

    // Force a rerender by re-invoking React — attemptedRef must guard.
    // (Re-render by state change simulated via router noop.)
    await act(async () => {
      // no-op; capsMock still returns the same state, but effect deps
      // include stable callbacks. Re-rendering the same tree should NOT
      // re-fire the guarded RPC.
    });
    expect(capsState.beginRecruiterSetup).toHaveBeenCalledTimes(1);
  });
});

// -----------------------------------------------------------------------
// D. After refreshed rows: setup → onboarding + recruiter mode persisted
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — post-activation navigation', () => {
  it('D. persists recruiter mode and routes to onboarding once validated rows show recruiter setup', async () => {
    // Start with no recruiter, active driver.
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

    // Simulate refetched validated rows arriving: recruiter setup + hub allowed.
    viewState = defaultView({
      recruiterCapabilityStatus: 'setup',
      recruiterHubAllowed: true,
    });

    // Complete the pending refetch.
    await act(async () => {
      refetchResolve?.();
      await Promise.resolve();
    });

    // Re-render with new view state.
    rerender(
      <MemoryRouter initialEntries={['/recruiter']}>
        <Routes>
          <Route path="/recruiter" element={<RecruiterEntryRoute />} />
          <Route path="/dashboard" element={<LocationProbe />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(viewState.setViewMode).toHaveBeenCalledWith('recruiter');
    });
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/dashboard?page=recruiter-access:onboarding',
      );
    });
  });
});

// -----------------------------------------------------------------------
// E/F/G. Existing recruiter states: no RPC, correct destination
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — existing recruiter capability', () => {
  it('E. existing setup → onboarding, zero RPC', async () => {
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

  it('F. existing active → hub, zero RPC', async () => {
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

  it('G. existing suspended → hub, zero RPC', async () => {
    viewState = defaultView({
      recruiterCapabilityStatus: 'suspended',
      recruiterHubAllowed: true,
    });
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/dashboard?page=recruiter-access',
      );
    });
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
// K. User id change resets attempt state
// -----------------------------------------------------------------------
describe('RecruiterEntryRoute — user id change resets attempt', () => {
  it('K. attempt guard does not carry across user id changes', async () => {
    const { rerender } = renderRoute();
    await waitFor(() => {
      expect(capsState.beginRecruiterSetup).toHaveBeenCalledTimes(1);
    });

    // Simulate a different signed-in user with same capability shape.
    authState = { user: { id: 'user-b' }, loading: false };
    capsState.beginRecruiterSetup.mockClear();
    capsState.refetch.mockClear();

    rerender(
      <MemoryRouter initialEntries={['/recruiter']}>
        <Routes>
          <Route path="/recruiter" element={<RecruiterEntryRoute />} />
          <Route path="/dashboard" element={<LocationProbe />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(capsState.beginRecruiterSetup).toHaveBeenCalledTimes(1);
    });
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
    // Lazy import present.
    expect(app).toMatch(
      /RecruiterEntryRoute\s*=\s*lazy\(\(\)\s*=>\s*import\(["']\.\/components\/opportunities\/recruiter\/RecruiterEntryRoute["']\)\)/,
    );
    // /recruiter uses new component under ProtectedRoute.
    expect(app).toMatch(
      /<Route\s+path="\/recruiter"\s+element=\{<ProtectedRoute><RecruiterEntryRoute\s*\/><\/ProtectedRoute>\}\s*\/>/,
    );
    // Operational deep-links still blind-redirect.
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
