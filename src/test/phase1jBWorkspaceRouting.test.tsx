/**
 * Phase 1J-B1 — Capability-based workspace decisions + user-bound view mode.
 *
 * Pure tests over `src/lib/workspaceAccess.ts` and hook tests over
 * `src/hooks/useViewMode.ts` with mocked `useAuth`, `useUserCapabilities`,
 * and `useUserRole`. No Supabase, no billing, no admin.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  computeWorkspaceAccess,
  isWorkspaceAllowed,
  resolveInitialWorkspace,
  resolveRecruiterSubview,
  RECRUITER_SUBVIEWS,
  type RecruiterSubview,
  type WorkspaceRole,
} from '@/lib/workspaceAccess';
import {
  deriveUserCapabilitiesView,
  type UserCapabilityRow,
  type UserCapabilityStatus,
} from '@/lib/userCapabilities';

// --------------------------------------------------------------------------
// Hook mocks — declared BEFORE the SUT import via vi.mock hoisting.
// --------------------------------------------------------------------------
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => authMock(),
}));
vi.mock('@/hooks/useUserCapabilities', () => ({
  useUserCapabilities: () => capMock(),
}));
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => roleMock(),
}));

let authMock: () => { user: { id: string } | null; loading: boolean };
let capMock: () => {
  rows: UserCapabilityRow[] | undefined;
  isLoading: boolean;
  error: Error | null;
};
let roleMock: () => { role: WorkspaceRole | null; isLoading: boolean };

import { useViewMode } from '@/hooks/useViewMode';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
function rowsFor(
  driver: UserCapabilityStatus | null,
  recruiter: UserCapabilityStatus | null,
): UserCapabilityRow[] {
  const r: UserCapabilityRow[] = [];
  if (driver) r.push({ capability: 'driver', status: driver, activated_at: null });
  if (recruiter) r.push({ capability: 'recruiter', status: recruiter, activated_at: null });
  return r;
}

function view(
  driver: UserCapabilityStatus | null,
  recruiter: UserCapabilityStatus | null,
) {
  return deriveUserCapabilitiesView(rowsFor(driver, recruiter));
}

// ==========================================================================
// PURE — computeWorkspaceAccess
// ==========================================================================
describe('computeWorkspaceAccess', () => {
  it('driver-only active: driver workspace only, no switcher', () => {
    const d = computeWorkspaceAccess(view('active', null));
    expect(d.driverWorkspaceAllowed).toBe(true);
    expect(d.recruiterHubAllowed).toBe(false);
    expect(d.switcherAvailable).toBe(false);
    expect(d.allowedFallbackWorkspace).toBe('driver');
  });

  it('driver active + recruiter setup: hub allowed, no operations, switcher on', () => {
    const d = computeWorkspaceAccess(view('active', 'setup'));
    expect(d.recruiterHubAllowed).toBe(true);
    expect(d.recruiterOperationsAllowed).toBe(false);
    expect(d.switcherAvailable).toBe(true);
    expect(d.recruiterCapabilityStatus).toBe('setup');
  });

  it('driver active + recruiter active: full recruiter operations + switcher', () => {
    const d = computeWorkspaceAccess(view('active', 'active'));
    expect(d.recruiterOperationsAllowed).toBe(true);
    expect(d.switcherAvailable).toBe(true);
  });

  it('driver active + recruiter suspended: hub only, no operations, switcher on', () => {
    const d = computeWorkspaceAccess(view('active', 'suspended'));
    expect(d.recruiterHubAllowed).toBe(true);
    expect(d.recruiterOperationsAllowed).toBe(false);
    expect(d.switcherAvailable).toBe(true);
  });

  it('driver active + recruiter revoked: driver only, no recruiter, no switcher', () => {
    const d = computeWorkspaceAccess(view('active', 'revoked'));
    expect(d.recruiterHubAllowed).toBe(false);
    expect(d.switcherAvailable).toBe(false);
    expect(d.allowedFallbackWorkspace).toBe('driver');
  });

  it('no capabilities: everything closed', () => {
    const d = computeWorkspaceAccess(view(null, null));
    expect(d.driverWorkspaceAllowed).toBe(false);
    expect(d.recruiterHubAllowed).toBe(false);
    expect(d.allowedFallbackWorkspace).toBeNull();
  });

  it('malformed / null view: fails closed', () => {
    for (const bad of [null, undefined, {}, { rows: null }, 'x' as unknown]) {
      const d = computeWorkspaceAccess(bad as never);
      expect(d.driverWorkspaceAllowed).toBe(false);
      expect(d.recruiterHubAllowed).toBe(false);
      expect(d.allowedFallbackWorkspace).toBeNull();
    }
  });

  it('duplicated recruiter rows are dropped by the parser and produce no access', () => {
    const dup = deriveUserCapabilitiesView([
      { capability: 'driver', status: 'active', activated_at: null },
      { capability: 'recruiter', status: 'active', activated_at: null },
      { capability: 'recruiter', status: 'suspended', activated_at: null },
    ]);
    const d = computeWorkspaceAccess(dup);
    expect(d.driverWorkspaceAllowed).toBe(true);
    expect(d.recruiterHubAllowed).toBe(false);
    expect(d.switcherAvailable).toBe(false);
  });

  // --- Adversarial: forged sibling booleans are IGNORED ---
  it('forged booleans on empty rows do not grant access', () => {
    const forged = {
      rows: [],
      canEnterDriverWorkspace: true,
      hasRecruiterCapability: true,
      canOperateRecruiterWorkspace: true,
      isRecruiterSuspended: false,
      driverCapabilityStatus: 'active',
      recruiterCapabilityStatus: 'active',
      hasDriverCapability: true,
    } as unknown as Parameters<typeof computeWorkspaceAccess>[0];
    const d = computeWorkspaceAccess(forged);
    expect(d.driverWorkspaceAllowed).toBe(false);
    expect(d.recruiterHubAllowed).toBe(false);
    expect(d.recruiterOperationsAllowed).toBe(false);
    expect(d.driverCapabilityStatus).toBeNull();
    expect(d.recruiterCapabilityStatus).toBeNull();
  });

  it('driver revoked row with forged active booleans: no driver access', () => {
    const forged = {
      rows: rowsFor('revoked', null),
      canEnterDriverWorkspace: true,
      driverCapabilityStatus: 'active',
    } as unknown as Parameters<typeof computeWorkspaceAccess>[0];
    const d = computeWorkspaceAccess(forged);
    expect(d.driverWorkspaceAllowed).toBe(false);
    expect(d.driverCapabilityStatus).toBe('revoked');
  });

  it('recruiter revoked row with forged active flags: no recruiter access', () => {
    const forged = {
      rows: rowsFor('active', 'revoked'),
      hasRecruiterCapability: true,
      canOperateRecruiterWorkspace: true,
      recruiterCapabilityStatus: 'active',
    } as unknown as Parameters<typeof computeWorkspaceAccess>[0];
    const d = computeWorkspaceAccess(forged);
    expect(d.recruiterHubAllowed).toBe(false);
    expect(d.recruiterOperationsAllowed).toBe(false);
    expect(d.recruiterCapabilityStatus).toBe('revoked');
  });
});

// ==========================================================================
// PURE — resolveInitialWorkspace (fail-closed, never synthesizes driver)
// ==========================================================================
describe('resolveInitialWorkspace', () => {
  it('driver-only: lands on driver regardless of hints', () => {
    const v = view('active', null);
    expect(resolveInitialWorkspace(v).workspace).toBe('driver');
    expect(resolveInitialWorkspace(v, { preferredRole: 'recruiter' }).workspace).toBe('driver');
    const r = resolveInitialWorkspace(v, { storedPreference: 'recruiter' });
    expect(r.workspace).toBe('driver');
    expect(r.shouldClearStoredPreference).toBe(true);
  });

  it('dual (active/setup): stored preference wins when allowed', () => {
    const v = view('active', 'setup');
    const r = resolveInitialWorkspace(v, { storedPreference: 'recruiter' });
    expect(r.workspace).toBe('recruiter');
    expect(r.shouldClearStoredPreference).toBe(false);
  });

  it('dual: preferredRole honored when no stored preference', () => {
    const v = view('active', 'active');
    expect(resolveInitialWorkspace(v, { preferredRole: 'recruiter' }).workspace).toBe('recruiter');
    expect(resolveInitialWorkspace(v, { preferredRole: 'driver' }).workspace).toBe('driver');
  });

  it('dual: default to driver when no hints provided', () => {
    expect(resolveInitialWorkspace(view('active', 'setup')).workspace).toBe('driver');
  });

  it('recruiter setup only (no driver capability): lands on recruiter', () => {
    expect(resolveInitialWorkspace(view(null, 'setup')).workspace).toBe('recruiter');
  });

  it('preferred recruiter is IGNORED when recruiter revoked', () => {
    const r = resolveInitialWorkspace(view('active', 'revoked'), { preferredRole: 'recruiter' });
    expect(r.workspace).toBe('driver');
  });

  it('stale stored recruiter is flagged when recruiter missing', () => {
    const r = resolveInitialWorkspace(view('active', null), { storedPreference: 'recruiter' });
    expect(r.workspace).toBe('driver');
    expect(r.shouldClearStoredPreference).toBe(true);
  });

  it('no capabilities: workspace is null (never synthesizes driver)', () => {
    expect(resolveInitialWorkspace(view(null, null)).workspace).toBeNull();
    expect(resolveInitialWorkspace(null).workspace).toBeNull();
    expect(resolveInitialWorkspace(undefined).workspace).toBeNull();
    expect(resolveInitialWorkspace({ rows: null } as never).workspace).toBeNull();
  });

  it('bogus stored preference values are ignored', () => {
    const v = view('active', 'active');
    for (const bogus of ['admin', '', 'RECRUITER', null, undefined]) {
      const r = resolveInitialWorkspace(v, {
        storedPreference: bogus as unknown as WorkspaceRole,
      });
      expect(r.workspace).toBe('driver');
      expect(r.shouldClearStoredPreference).toBe(false);
    }
  });
});

// ==========================================================================
// PURE — resolveRecruiterSubview
// ==========================================================================
describe('resolveRecruiterSubview', () => {
  it('no recruiter capability → null', () => {
    const v = view('active', null);
    for (const s of RECRUITER_SUBVIEWS) expect(resolveRecruiterSubview(v, s)).toBeNull();
  });

  it('revoked recruiter → null', () => {
    expect(resolveRecruiterSubview(view('active', 'revoked'), 'manager')).toBeNull();
  });

  it('setup collapses operational subviews to onboarding, preserves hub/onboarding', () => {
    const v = view('active', 'setup');
    expect(resolveRecruiterSubview(v, 'manager')).toBe('onboarding');
    expect(resolveRecruiterSubview(v, 'applications')).toBe('onboarding');
    expect(resolveRecruiterSubview(v, 'reports')).toBe('onboarding');
    expect(resolveRecruiterSubview(v, 'hub')).toBe('hub');
    expect(resolveRecruiterSubview(v, 'onboarding')).toBe('onboarding');
    expect(resolveRecruiterSubview(v, null)).toBe('onboarding');
  });

  it('suspended collapses EVERY subview (including onboarding) to hub', () => {
    const v = view('active', 'suspended');
    for (const s of RECRUITER_SUBVIEWS) expect(resolveRecruiterSubview(v, s)).toBe('hub');
    expect(resolveRecruiterSubview(v, null)).toBe('hub');
    expect(resolveRecruiterSubview(v, 'not-a-subview')).toBe('hub');
  });

  it('active preserves requested subview and defaults to hub', () => {
    const v = view('active', 'active');
    for (const s of RECRUITER_SUBVIEWS) expect(resolveRecruiterSubview(v, s)).toBe(s);
    expect(resolveRecruiterSubview(v, null)).toBe('hub');
    expect(resolveRecruiterSubview(v, 'not-a-subview')).toBe('hub');
  });
});

describe('isWorkspaceAllowed', () => {
  it('mirrors driver/recruiter decisions', () => {
    const v = view('active', 'setup');
    expect(isWorkspaceAllowed(v, 'driver')).toBe(true);
    expect(isWorkspaceAllowed(v, 'recruiter')).toBe(true);
    expect(isWorkspaceAllowed(view('active', 'revoked'), 'recruiter')).toBe(false);
  });
});

describe('plan / billing independence', () => {
  it('workspaceAccess module has no import from billing/subscription/stripe modules', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/workspaceAccess.ts'), 'utf8');
    const specifiers = Array.from(src.matchAll(/from\s+['"]([^'"]+)['"]/g)).map((m) => m[1]);
    for (const spec of specifiers) {
      expect(spec).not.toMatch(/billing/i);
      expect(spec).not.toMatch(/subscription/i);
      expect(spec).not.toMatch(/stripe/i);
      expect(spec).not.toMatch(/recruiterCapabilities/);
      expect(spec).not.toMatch(/useSubscription/);
      expect(spec).not.toMatch(/useAdmin/);
    }
  });


  it('adding plan/billing-shaped fields to the view does not change decisions', () => {
    const base = view('active', 'active');
    const plated = {
      ...base,
      plan: 'enterprise',
      billing: { status: 'past_due' },
      subscription: { tier: 'pro' },
      stripeCustomerId: 'cus_x',
    } as unknown as typeof base;
    expect(computeWorkspaceAccess(plated)).toEqual(computeWorkspaceAccess(base));
    expect(
      resolveInitialWorkspace(plated, { preferredRole: 'recruiter' }),
    ).toEqual(resolveInitialWorkspace(base, { preferredRole: 'recruiter' }));
  });
});

// ==========================================================================
// HOOK — useViewMode
// ==========================================================================
describe('useViewMode hook', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    authMock = () => ({ user: null, loading: false });
    capMock = () => ({ rows: [], isLoading: false, error: null });
    roleMock = () => ({ role: null, isLoading: false });
  });


  it('no user id → effectiveRole null; nothing written to storage', () => {
    const { result } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBeNull();
    expect(result.current.canSwitch).toBe(false);
    // No unrelated keys created.
    expect(localStorage.length).toBe(0);
  });

  it('while loading → effectiveRole null', () => {
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({ rows: undefined, isLoading: true, error: null });
    const { result } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it('capability error → effectiveRole null even with a user id', () => {
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({
      rows: rowsFor('active', 'active'),
      isLoading: false,
      error: new Error('boom'),
    });
    const { result } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.canSwitch).toBe(false);
  });

  it('no capability rows (empty) → effectiveRole null; never synthesizes driver', () => {
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({ rows: [], isLoading: false, error: null });
    const { result } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBeNull();
    expect(result.current.canSwitch).toBe(false);
  });

  it('driver-only active lands on driver; recruiter setViewMode is a no-op', () => {
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({ rows: rowsFor('active', null), isLoading: false, error: null });
    const { result } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBe('driver');
    act(() => result.current.setViewMode('recruiter'));
    expect(result.current.effectiveRole).toBe('driver');
    expect(localStorage.getItem('htp_view_mode:u1')).toBeNull();
  });

  it('dual-capability active/active user can switch both ways and persists per-user', () => {
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({ rows: rowsFor('active', 'active'), isLoading: false, error: null });
    const { result } = renderHook(() => useViewMode());
    expect(result.current.canSwitch).toBe(true);
    expect(result.current.effectiveRole).toBe('driver');
    act(() => result.current.setViewMode('recruiter'));
    expect(result.current.effectiveRole).toBe('recruiter');
    expect(localStorage.getItem('htp_view_mode:u1')).toBe('recruiter');
    act(() => result.current.setViewMode('driver'));
    expect(result.current.effectiveRole).toBe('driver');
    expect(localStorage.getItem('htp_view_mode:u1')).toBe('driver');
  });

  it('same-user allowed stored preference is honored on mount', () => {
    localStorage.setItem('htp_view_mode:u1', 'recruiter');
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({ rows: rowsFor('active', 'active'), isLoading: false, error: null });
    const { result } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBe('recruiter');
  });

  it('unavailable stored mode is cleared', () => {
    localStorage.setItem('htp_view_mode:u1', 'recruiter');
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({ rows: rowsFor('active', 'revoked'), isLoading: false, error: null });
    const { result } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBe('driver');
    expect(localStorage.getItem('htp_view_mode:u1')).toBeNull();
  });

  it('user A stored recruiter does NOT affect user B', () => {
    localStorage.setItem('htp_view_mode:userA', 'recruiter');
    authMock = () => ({ user: { id: 'userB' }, loading: false });
    capMock = () => ({ rows: rowsFor('active', 'active'), isLoading: false, error: null });
    const { result } = renderHook(() => useViewMode());
    // User B has no scoped preference → default driver (no preferred role hint).
    expect(result.current.effectiveRole).toBe('driver');
    // User A's key is untouched.
    expect(localStorage.getItem('htp_view_mode:userA')).toBe('recruiter');
  });

  it('legacy unscoped `htp_view_mode` is cleared and ignored', () => {
    localStorage.setItem('htp_view_mode', 'recruiter');
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({ rows: rowsFor('active', 'active'), isLoading: false, error: null });
    const { result } = renderHook(() => useViewMode());
    expect(localStorage.getItem('htp_view_mode')).toBeNull();
    // Falls back to default (driver) — the legacy key must not become the preference.
    expect(result.current.effectiveRole).toBe('driver');
  });

  it('preferredRole hint is used when no stored preference exists', () => {
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({ rows: rowsFor('active', 'active'), isLoading: false, error: null });
    roleMock = () => ({ role: 'recruiter', isLoading: false });
    const { result } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBe('recruiter');
  });

  it('sign-out reconciles immediately to null', () => {
    let user: { id: string } | null = { id: 'u1' };
    authMock = () => ({ user, loading: false });
    capMock = () => ({ rows: rowsFor('active', 'active'), isLoading: false, error: null });
    const { result, rerender } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBe('driver');
    user = null;
    rerender();
    expect(result.current.effectiveRole).toBeNull();
  });

  it('rerender with unchanged capability rows does not create a state loop', () => {
    const stableRows = rowsFor('active', 'active');
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({ rows: stableRows, isLoading: false, error: null });
    let renders = 0;
    const { result, rerender } = renderHook(() => {
      renders++;
      return useViewMode();
    });
    const before = renders;
    expect(result.current.effectiveRole).toBe('driver');
    rerender();
    rerender();
    rerender();
    // Exactly one render per explicit rerender call (no runaway loop).
    expect(renders - before).toBe(3);
    expect(result.current.effectiveRole).toBe('driver');
  });

  it('module does not import useAdmin (no admin bypass)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/hooks/useViewMode.ts'), 'utf8');
    const specifiers = Array.from(src.matchAll(/from\s+['"]([^'"]+)['"]/g)).map((m) => m[1]);
    for (const spec of specifiers) {
      expect(spec).not.toMatch(/useAdmin/);
      expect(spec).not.toMatch(/billing/i);
      expect(spec).not.toMatch(/subscription/i);
      expect(spec).not.toMatch(/stripe/i);
    }
  });

  // ------------------------------------------------------------------
  // RENDER-GATE PROOFS — effectiveRole is derived synchronously and
  // can NEVER flash stale access on account/capability transitions.
  // ------------------------------------------------------------------
  it('user A dual-cap stored recruiter → rerender as user B driver-only never flashes recruiter', () => {
    localStorage.setItem('htp_view_mode:userA', 'recruiter');
    let user: { id: string } | null = { id: 'userA' };
    let rows: UserCapabilityRow[] = rowsFor('active', 'active');
    authMock = () => ({ user, loading: false });
    capMock = () => ({ rows, isLoading: false, error: null });
    const { result, rerender } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBe('recruiter');

    // Swap account synchronously.
    user = { id: 'userB' };
    rows = rowsFor('active', null);
    rerender();
    // First render as user B: recruiter is FORBIDDEN. Must not appear.
    expect(result.current.effectiveRole).not.toBe('recruiter');
    // Legal values are null (fail-closed) or the sole allowed workspace.
    expect(['driver', null]).toContain(result.current.effectiveRole);
    // After effects reconcile, driver is the stable state.
    expect(result.current.effectiveRole).toBe('driver');
  });

  it('recruiter active → rows rerender as recruiter revoked; never returns recruiter', () => {
    let rows: UserCapabilityRow[] = rowsFor('active', 'active');
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({ rows, isLoading: false, error: null });
    const { result, rerender } = renderHook(() => useViewMode());
    act(() => result.current.setViewMode('recruiter'));
    expect(result.current.effectiveRole).toBe('recruiter');

    // Revoke recruiter capability.
    rows = rowsFor('active', 'revoked');
    rerender();
    // BEFORE any additional effect: synchronous gate must have flipped.
    expect(result.current.effectiveRole).not.toBe('recruiter');
    // AFTER effects: stable state is driver, stored key cleared.
    rerender();
    expect(result.current.effectiveRole).not.toBe('recruiter');
    expect(result.current.effectiveRole).toBe('driver');
  });

  it('driver active → driver revoked / rows empty: effectiveRole becomes null synchronously', () => {
    let rows: UserCapabilityRow[] = rowsFor('active', null);
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({ rows, isLoading: false, error: null });
    const { result, rerender } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBe('driver');

    rows = rowsFor('revoked', null);
    rerender();
    expect(result.current.effectiveRole).toBeNull();

    rows = [];
    rerender();
    expect(result.current.effectiveRole).toBeNull();
  });

  it('loading begins after a valid mode → effectiveRole becomes null synchronously', () => {
    let loading = false;
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({
      rows: rowsFor('active', 'active'),
      isLoading: loading,
      error: null,
    });
    const { result, rerender } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBe('driver');

    loading = true;
    rerender();
    expect(result.current.effectiveRole).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it('capability error begins after a valid mode → effectiveRole becomes null synchronously', () => {
    let error: Error | null = null;
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({
      rows: rowsFor('active', 'active'),
      isLoading: false,
      error,
    });
    const { result, rerender } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBe('driver');

    error = new Error('capability fetch failed');
    rerender();
    expect(result.current.effectiveRole).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
  });

  // ------------------------------------------------------------------
  // Phase 1S-A8 — transient workspace intent (`htp_workspace_intent`).
  // Preference hint only: validated against the CURRENT capability rows,
  // consumed exactly once, and never a source of access.
  // ------------------------------------------------------------------
  it('transient driver intent beats stored recruiter AND preferredRole recruiter', () => {
    localStorage.setItem('htp_view_mode:u1', 'recruiter');
    sessionStorage.setItem('htp_workspace_intent', 'driver');
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({ rows: rowsFor('active', 'active'), isLoading: false, error: null });
    roleMock = () => ({ role: 'recruiter', isLoading: false });
    const { result } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBe('driver');
    expect(localStorage.getItem('htp_view_mode:u1')).toBe('driver');
    expect(sessionStorage.getItem('htp_workspace_intent')).toBeNull();
  });

  it('transient recruiter intent beats stored driver AND preferredRole driver', () => {
    localStorage.setItem('htp_view_mode:u1', 'driver');
    sessionStorage.setItem('htp_workspace_intent', 'recruiter');
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({ rows: rowsFor('active', 'active'), isLoading: false, error: null });
    roleMock = () => ({ role: 'driver', isLoading: false });
    const { result } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBe('recruiter');
    expect(localStorage.getItem('htp_view_mode:u1')).toBe('recruiter');
    expect(sessionStorage.getItem('htp_workspace_intent')).toBeNull();
  });

  it('forged recruiter intent on a driver-only account is rejected and cleared', () => {
    sessionStorage.setItem('htp_workspace_intent', 'recruiter');
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({ rows: rowsFor('active', null), isLoading: false, error: null });
    const { result } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBe('driver');
    expect(result.current.canSwitch).toBe(false);
    expect(result.current.recruiterHubAllowed).toBe(false);
    expect(localStorage.getItem('htp_view_mode:u1')).toBeNull();
    expect(sessionStorage.getItem('htp_workspace_intent')).toBeNull();
  });

  it('bogus transient intent values are ignored and do not alter resolution', () => {
    sessionStorage.setItem('htp_workspace_intent', 'admin');
    authMock = () => ({ user: { id: 'u1' }, loading: false });
    capMock = () => ({ rows: rowsFor('active', 'active'), isLoading: false, error: null });
    roleMock = () => ({ role: 'recruiter', isLoading: false });
    const { result } = renderHook(() => useViewMode());
    expect(result.current.effectiveRole).toBe('recruiter');
  });
});




// ==========================================================================
// PURE — equivalence: resolveRecruiterSubviewForStatus vs resolveRecruiterSubview
// ==========================================================================
describe('resolveRecruiterSubviewForStatus ↔ resolveRecruiterSubview equivalence', () => {
  const requests: (RecruiterSubview | null | 'unknown')[] = [
    'hub', 'onboarding', 'manager', 'applications', 'reports', null, 'unknown',
  ];
  const cases: [UserCapabilityStatus, UserCapabilityStatus | null][] = [
    ['active', 'setup'],
    ['active', 'active'],
    ['active', 'suspended'],
  ];
  for (const [driver, recruiter] of cases) {
    it(`recruiter=${recruiter}: shortcut equals full derivation`, async () => {
      const { resolveRecruiterSubviewForStatus, resolveRecruiterSubview } =
        await import('@/lib/workspaceAccess');
      const v = view(driver, recruiter);
      for (const req of requests) {
        expect(
          resolveRecruiterSubviewForStatus(recruiter, req as RecruiterSubview | null),
        ).toBe(resolveRecruiterSubview(v, req as RecruiterSubview | null));
      }
    });
  }
  it('recruiter revoked / missing → shortcut returns null (matches full derivation)', async () => {
    const { resolveRecruiterSubviewForStatus, resolveRecruiterSubview } =
      await import('@/lib/workspaceAccess');
    for (const req of requests) {
      expect(resolveRecruiterSubviewForStatus('revoked', req as RecruiterSubview | null)).toBeNull();
      expect(resolveRecruiterSubview(view('active', 'revoked'), req as RecruiterSubview | null)).toBeNull();
      expect(resolveRecruiterSubviewForStatus(null, req as RecruiterSubview | null)).toBeNull();
      expect(resolveRecruiterSubview(view('active', null), req as RecruiterSubview | null)).toBeNull();
    }
  });
});


