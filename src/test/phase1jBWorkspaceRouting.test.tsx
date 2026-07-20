// @vitest-environment node
/**
 * Phase 1J-B1 — Capability-based workspace decisions.
 *
 * Pure tests over `src/lib/workspaceAccess.ts`. No React, no Supabase,
 * no billing. Proves the additive product model turn-for-turn:
 *
 *   - driver / recruiter statuses combine into per-workspace access,
 *     switcher availability, and initial-workspace resolution.
 *   - suspended/setup collapse operational recruiter subviews.
 *   - revoked / missing recruiter cannot select recruiter.
 *   - admin-shaped inputs do NOT grant recruiter access.
 *   - stored/preferred hints are validated against real access;
 *     stale stored recruiter is flagged for cleanup.
 *   - plan/billing-shaped inputs are irrelevant (module never sees them
 *     and the decision matrix is identical regardless of any extra props).
 */
import { describe, it, expect } from 'vitest';
import {
  computeWorkspaceAccess,
  isWorkspaceAllowed,
  resolveInitialWorkspace,
  resolveRecruiterSubview,
  RECRUITER_SUBVIEWS,
  type WorkspaceRole,
} from '@/lib/workspaceAccess';
import {
  deriveUserCapabilitiesView,
  type UserCapabilityRow,
  type UserCapabilityStatus,
} from '@/lib/userCapabilities';

function view(
  driver: UserCapabilityStatus | null,
  recruiter: UserCapabilityStatus | null,
) {
  const rows: UserCapabilityRow[] = [];
  if (driver) rows.push({ capability: 'driver', status: driver, activated_at: null });
  if (recruiter) rows.push({ capability: 'recruiter', status: recruiter, activated_at: null });
  return deriveUserCapabilitiesView(rows);
}

describe('computeWorkspaceAccess', () => {
  it('driver-only active: driver workspace only, no switcher', () => {
    const d = computeWorkspaceAccess(view('active', null));
    expect(d.driverWorkspaceAllowed).toBe(true);
    expect(d.recruiterHubAllowed).toBe(false);
    expect(d.recruiterOperationsAllowed).toBe(false);
    expect(d.switcherAvailable).toBe(false);
    expect(d.allowedFallbackWorkspace).toBe('driver');
  });

  it('driver active + recruiter setup: hub allowed, no operations, switcher on', () => {
    const d = computeWorkspaceAccess(view('active', 'setup'));
    expect(d.driverWorkspaceAllowed).toBe(true);
    expect(d.recruiterHubAllowed).toBe(true);
    expect(d.recruiterOperationsAllowed).toBe(false);
    expect(d.switcherAvailable).toBe(true);
    expect(d.recruiterCapabilityStatus).toBe('setup');
  });

  it('driver active + recruiter active: full recruiter operations + switcher', () => {
    const d = computeWorkspaceAccess(view('active', 'active'));
    expect(d.recruiterOperationsAllowed).toBe(true);
    expect(d.switcherAvailable).toBe(true);
    expect(d.allowedFallbackWorkspace).toBe('driver');
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
    expect(d.recruiterOperationsAllowed).toBe(false);
    expect(d.switcherAvailable).toBe(false);
    expect(d.allowedFallbackWorkspace).toBe('driver');
  });

  it('no capabilities: everything closed', () => {
    const d = computeWorkspaceAccess(view(null, null));
    expect(d.driverWorkspaceAllowed).toBe(false);
    expect(d.recruiterHubAllowed).toBe(false);
    expect(d.switcherAvailable).toBe(false);
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
});

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
    expect(
      resolveInitialWorkspace(v, { preferredRole: 'recruiter' }).workspace,
    ).toBe('recruiter');
    expect(
      resolveInitialWorkspace(v, { preferredRole: 'driver' }).workspace,
    ).toBe('driver');
  });

  it('dual: default to driver when no hints provided', () => {
    expect(resolveInitialWorkspace(view('active', 'setup')).workspace).toBe('driver');
  });

  it('recruiter setup only (no driver capability): lands on recruiter', () => {
    const v = view(null, 'setup');
    expect(resolveInitialWorkspace(v).workspace).toBe('recruiter');
  });

  it('preferred recruiter is IGNORED when recruiter revoked', () => {
    const v = view('active', 'revoked');
    const r = resolveInitialWorkspace(v, { preferredRole: 'recruiter' });
    expect(r.workspace).toBe('driver');
    expect(r.shouldClearStoredPreference).toBe(false);
  });

  it('stale stored recruiter is flagged when recruiter missing', () => {
    const v = view('active', null);
    const r = resolveInitialWorkspace(v, { storedPreference: 'recruiter' });
    expect(r.workspace).toBe('driver');
    expect(r.shouldClearStoredPreference).toBe(true);
  });

  it('no capabilities: workspace is null', () => {
    expect(resolveInitialWorkspace(view(null, null)).workspace).toBeNull();
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

describe('resolveRecruiterSubview', () => {
  it('no recruiter capability → null', () => {
    const v = view('active', null);
    for (const s of RECRUITER_SUBVIEWS) {
      expect(resolveRecruiterSubview(v, s)).toBeNull();
    }
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

  it('suspended collapses operational subviews to hub', () => {
    const v = view('active', 'suspended');
    expect(resolveRecruiterSubview(v, 'manager')).toBe('hub');
    expect(resolveRecruiterSubview(v, 'applications')).toBe('hub');
    expect(resolveRecruiterSubview(v, 'reports')).toBe('hub');
    expect(resolveRecruiterSubview(v, 'onboarding')).toBe('onboarding');
    expect(resolveRecruiterSubview(v, null)).toBe('hub');
  });

  it('active preserves requested subview and defaults to hub', () => {
    const v = view('active', 'active');
    for (const s of RECRUITER_SUBVIEWS) {
      expect(resolveRecruiterSubview(v, s)).toBe(s);
    }
    expect(resolveRecruiterSubview(v, null)).toBe('hub');
    expect(resolveRecruiterSubview(v, 'not-a-subview')).toBe('hub');
  });
});

describe('isWorkspaceAllowed', () => {
  it('mirrors driver/recruiter decisions', () => {
    const v = view('active', 'setup');
    expect(isWorkspaceAllowed(v, 'driver')).toBe(true);
    expect(isWorkspaceAllowed(v, 'recruiter')).toBe(true);
    const nope = view('active', 'revoked');
    expect(isWorkspaceAllowed(nope, 'recruiter')).toBe(false);
  });
});

describe('admin-shaped inputs do not grant recruiter access', () => {
  it('a view carrying an unrelated `isAdmin` field grants nothing extra', () => {
    const v = view('active', null) as unknown as Record<string, unknown>;
    v.isAdmin = true;
    v.adminRole = 'super_admin';
    const d = computeWorkspaceAccess(v as never);
    expect(d.recruiterHubAllowed).toBe(false);
    expect(d.recruiterOperationsAllowed).toBe(false);
    expect(d.switcherAvailable).toBe(false);
  });
});

describe('plan / billing independence', () => {
  it('workspaceAccess module has no import from billing/subscription/stripe modules', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../lib/workspaceAccess.ts', import.meta.url), 'utf8'),
    );
    // Extract only import specifiers to avoid matching prose comments.
    const specifiers = Array.from(src.matchAll(/from\s+['"]([^'"]+)['"]/g)).map((m) => m[1]);
    for (const spec of specifiers) {
      expect(spec).not.toMatch(/billing/i);
      expect(spec).not.toMatch(/subscription/i);
      expect(spec).not.toMatch(/stripe/i);
      expect(spec).not.toMatch(/recruiterCapabilities/);
      expect(spec).not.toMatch(/useSubscription/);
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
    const a = computeWorkspaceAccess(base);
    const b = computeWorkspaceAccess(plated);
    expect(b).toEqual(a);

    const r1 = resolveInitialWorkspace(base, { preferredRole: 'recruiter' });
    const r2 = resolveInitialWorkspace(plated, { preferredRole: 'recruiter' });
    expect(r2).toEqual(r1);
  });
});
