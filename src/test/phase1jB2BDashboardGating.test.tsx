/**
 * Phase 1J-B2B — dashboard workspace policy + subview resolver tests.
 *
 * Pure-function coverage for the capability-authorized dashboard shell:
 *   1. resolveDashboardNavigation() matrix (driver / setup / active /
 *      suspended / revoked / null; recruiter targets, driver-only pages,
 *      shared contracts+settings, adversarial active-without-ops).
 *   2. resolveRecruiterSubviewForStatus() status-only shortcut used by
 *      Index/RecruiterAccessRoute so they don't re-derive capabilities.
 *   3. resolveRecruiterNavTier() drives the sidebar/bottom nav slots.
 *   4. parseRecruiterSubviewFromPage() + isRecruiterPageId() helpers.
 *
 * NO React rendering. NO Supabase. Every case runs against the exact
 * pure function used at runtime by Index.tsx and RecruiterAccessRoute.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveDashboardNavigation,
  resolveRecruiterNavTier,
  parseRecruiterSubviewFromPage,
  isRecruiterPageId,
  DRIVER_ONLY_PAGES,
} from '@/lib/dashboardWorkspacePolicy';
import { resolveRecruiterSubviewForStatus } from '@/lib/workspaceAccess';

const base = {
  requestedPage: 'dashboard',
  effectiveWorkspace: 'driver' as const,
  recruiterCapabilityStatus: null,
  recruiterHubAllowed: false,
  recruiterOperationsAllowed: false,
};

describe('isRecruiterPageId', () => {
  it('recognizes bare and subview recruiter page ids', () => {
    expect(isRecruiterPageId('recruiter-access')).toBe(true);
    expect(isRecruiterPageId('recruiter-access:manager')).toBe(true);
    expect(isRecruiterPageId('recruiter-access:reports')).toBe(true);
    expect(isRecruiterPageId('dashboard')).toBe(false);
    expect(isRecruiterPageId('contracts')).toBe(false);
  });
});

describe('parseRecruiterSubviewFromPage', () => {
  it('returns hub for bare id, known sub for :segment, hub for unknown', () => {
    expect(parseRecruiterSubviewFromPage('recruiter-access')).toBe('hub');
    expect(parseRecruiterSubviewFromPage('recruiter-access:manager')).toBe('manager');
    expect(parseRecruiterSubviewFromPage('recruiter-access:applications')).toBe('applications');
    expect(parseRecruiterSubviewFromPage('recruiter-access:reports')).toBe('reports');
    expect(parseRecruiterSubviewFromPage('recruiter-access:onboarding')).toBe('onboarding');
    expect(parseRecruiterSubviewFromPage('recruiter-access:wat')).toBe('hub');
  });
  it('returns null for non-recruiter pages', () => {
    expect(parseRecruiterSubviewFromPage('dashboard')).toBeNull();
    expect(parseRecruiterSubviewFromPage('contracts')).toBeNull();
  });
});

describe('resolveRecruiterSubviewForStatus', () => {
  it('active preserves requested subview and defaults to hub', () => {
    expect(resolveRecruiterSubviewForStatus('active', 'manager')).toBe('manager');
    expect(resolveRecruiterSubviewForStatus('active', 'applications')).toBe('applications');
    expect(resolveRecruiterSubviewForStatus('active', null)).toBe('hub');
  });
  it('setup collapses operational subviews to onboarding', () => {
    expect(resolveRecruiterSubviewForStatus('setup', 'manager')).toBe('onboarding');
    expect(resolveRecruiterSubviewForStatus('setup', 'applications')).toBe('onboarding');
    expect(resolveRecruiterSubviewForStatus('setup', 'reports')).toBe('onboarding');
    expect(resolveRecruiterSubviewForStatus('setup', 'hub')).toBe('hub');
    expect(resolveRecruiterSubviewForStatus('setup', null)).toBe('onboarding');
  });
  it('suspended forces hub for every subview including onboarding', () => {
    expect(resolveRecruiterSubviewForStatus('suspended', 'manager')).toBe('hub');
    expect(resolveRecruiterSubviewForStatus('suspended', 'onboarding')).toBe('hub');
    expect(resolveRecruiterSubviewForStatus('suspended', null)).toBe('hub');
  });
  it('revoked / null returns null (no hub access)', () => {
    expect(resolveRecruiterSubviewForStatus('revoked', 'manager')).toBeNull();
    expect(resolveRecruiterSubviewForStatus(null, 'hub')).toBeNull();
  });
});

describe('resolveRecruiterNavTier', () => {
  it('returns active only for active + operationsAllowed', () => {
    expect(resolveRecruiterNavTier('active', true)).toBe('active');
    expect(resolveRecruiterNavTier('active', false)).toBe('hub_only');
  });
  it('setup and suspended → hub_only', () => {
    expect(resolveRecruiterNavTier('setup', false)).toBe('hub_only');
    expect(resolveRecruiterNavTier('suspended', false)).toBe('hub_only');
  });
  it('revoked / null → none', () => {
    expect(resolveRecruiterNavTier('revoked', true)).toBe('none');
    expect(resolveRecruiterNavTier(null, true)).toBe('none');
  });
});

describe('resolveDashboardNavigation — fail-closed / loading', () => {
  it('null workspace → unresolved (never synthesizes driver)', () => {
    const r = resolveDashboardNavigation({ ...base, effectiveWorkspace: null });
    expect(r.unresolved).toBe(true);
    expect(r.recruiterSubview).toBeNull();
  });
});

describe('resolveDashboardNavigation — driver workspace', () => {
  it('recruiter targets collapse to dashboard', () => {
    const r = resolveDashboardNavigation({
      ...base,
      requestedPage: 'recruiter-access:manager',
    });
    expect(r).toEqual({ page: 'dashboard', recruiterSubview: null, unresolved: false });
  });
  it('driver-only pages pass through', () => {
    for (const p of ['dashboard', 'loads', 'expenses', 'fuel', 'reports', 'add']) {
      const r = resolveDashboardNavigation({ ...base, requestedPage: p });
      expect(r).toEqual({ page: p, recruiterSubview: null, unresolved: false });
    }
  });
  it('shared contracts + settings resolve to driver variants', () => {
    expect(resolveDashboardNavigation({ ...base, requestedPage: 'contracts' }))
      .toEqual({ page: 'contracts', recruiterSubview: null, unresolved: false });
    expect(resolveDashboardNavigation({ ...base, requestedPage: 'settings' }))
      .toEqual({ page: 'settings', recruiterSubview: null, unresolved: false });
  });
});

describe('resolveDashboardNavigation — recruiter workspace guardrails', () => {
  const rec = {
    ...base,
    effectiveWorkspace: 'recruiter' as const,
  };

  it('recruiter workspace + hubAllowed=false → unresolved (fail closed)', () => {
    const r = resolveDashboardNavigation({
      ...rec,
      recruiterCapabilityStatus: 'active',
      recruiterHubAllowed: false,
      recruiterOperationsAllowed: true,
      requestedPage: 'recruiter-access:manager',
    });
    expect(r.unresolved).toBe(true);
  });

  it('recruiter workspace + revoked status → unresolved', () => {
    const r = resolveDashboardNavigation({
      ...rec,
      recruiterCapabilityStatus: 'revoked',
      recruiterHubAllowed: true,
      requestedPage: 'recruiter-access',
    });
    expect(r.unresolved).toBe(true);
  });

  it('recruiter workspace + null status → unresolved', () => {
    const r = resolveDashboardNavigation({
      ...rec,
      recruiterHubAllowed: true,
      requestedPage: 'recruiter-access',
    });
    expect(r.unresolved).toBe(true);
  });
});

describe('resolveDashboardNavigation — recruiter/setup', () => {
  const setup = {
    ...base,
    effectiveWorkspace: 'recruiter' as const,
    recruiterCapabilityStatus: 'setup' as const,
    recruiterHubAllowed: true,
    recruiterOperationsAllowed: false,
  };

  it('operational subview requests collapse to onboarding', () => {
    for (const sub of ['manager', 'applications', 'reports']) {
      const r = resolveDashboardNavigation({
        ...setup,
        requestedPage: `recruiter-access:${sub}`,
      });
      expect(r).toEqual({
        page: 'recruiter-access',
        recruiterSubview: 'onboarding',
        unresolved: false,
      });
    }
  });

  it('hub and onboarding pass through', () => {
    expect(
      resolveDashboardNavigation({ ...setup, requestedPage: 'recruiter-access' })
    ).toEqual({ page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false });
    expect(
      resolveDashboardNavigation({ ...setup, requestedPage: 'recruiter-access:hub' })
    ).toEqual({ page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false });
    expect(
      resolveDashboardNavigation({ ...setup, requestedPage: 'recruiter-access:onboarding' })
    ).toEqual({ page: 'recruiter-access', recruiterSubview: 'onboarding', unresolved: false });
  });

  it('driver-only pages collapse to recruiter hub', () => {
    for (const p of ['dashboard', 'loads', 'add', 'reports']) {
      const r = resolveDashboardNavigation({ ...setup, requestedPage: p });
      expect(r).toEqual({
        page: 'recruiter-access',
        recruiterSubview: 'hub',
        unresolved: false,
      });
    }
  });

  it('contracts + settings collapse to hub during setup', () => {
    expect(resolveDashboardNavigation({ ...setup, requestedPage: 'contracts' }))
      .toEqual({ page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false });
    expect(resolveDashboardNavigation({ ...setup, requestedPage: 'settings' }))
      .toEqual({ page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false });
  });
});

describe('resolveDashboardNavigation — recruiter/active', () => {
  const active = {
    ...base,
    effectiveWorkspace: 'recruiter' as const,
    recruiterCapabilityStatus: 'active' as const,
    recruiterHubAllowed: true,
    recruiterOperationsAllowed: true,
  };

  it('preserves manager / applications / reports subviews', () => {
    for (const sub of ['manager', 'applications', 'reports', 'hub', 'onboarding']) {
      const r = resolveDashboardNavigation({
        ...active,
        requestedPage: `recruiter-access:${sub}`,
      });
      expect(r).toEqual({
        page: 'recruiter-access',
        recruiterSubview: sub,
        unresolved: false,
      });
    }
  });

  it('shared contracts + settings resolve to recruiter variants', () => {
    expect(resolveDashboardNavigation({ ...active, requestedPage: 'contracts' }))
      .toEqual({ page: 'contracts', recruiterSubview: null, unresolved: false });
    expect(resolveDashboardNavigation({ ...active, requestedPage: 'settings' }))
      .toEqual({ page: 'settings', recruiterSubview: null, unresolved: false });
  });

  it('driver-only pages collapse to hub', () => {
    for (const p of DRIVER_ONLY_PAGES) {
      const r = resolveDashboardNavigation({ ...active, requestedPage: p });
      expect(r).toEqual({
        page: 'recruiter-access',
        recruiterSubview: 'hub',
        unresolved: false,
      });
    }
  });
});

describe('resolveDashboardNavigation — recruiter/active WITHOUT operations (adversarial)', () => {
  const inconsistent = {
    ...base,
    effectiveWorkspace: 'recruiter' as const,
    recruiterCapabilityStatus: 'active' as const,
    recruiterHubAllowed: true,
    recruiterOperationsAllowed: false,
  };

  it('every operational subview collapses to hub', () => {
    for (const sub of ['manager', 'applications', 'reports', 'onboarding']) {
      const r = resolveDashboardNavigation({
        ...inconsistent,
        requestedPage: `recruiter-access:${sub}`,
      });
      expect(r.recruiterSubview).toBe('hub');
    }
  });

  it('contracts + settings collapse to hub', () => {
    expect(
      resolveDashboardNavigation({ ...inconsistent, requestedPage: 'contracts' })
    ).toEqual({ page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false });
    expect(
      resolveDashboardNavigation({ ...inconsistent, requestedPage: 'settings' })
    ).toEqual({ page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false });
  });
});

describe('resolveDashboardNavigation — recruiter/suspended', () => {
  const suspended = {
    ...base,
    effectiveWorkspace: 'recruiter' as const,
    recruiterCapabilityStatus: 'suspended' as const,
    recruiterHubAllowed: true,
    recruiterOperationsAllowed: false,
  };

  it('every recruiter subview, contracts, settings, driver-only → hub', () => {
    for (const p of [
      'recruiter-access',
      'recruiter-access:manager',
      'recruiter-access:applications',
      'recruiter-access:reports',
      'recruiter-access:onboarding',
      'contracts',
      'settings',
      'dashboard',
      'loads',
    ]) {
      const r = resolveDashboardNavigation({ ...suspended, requestedPage: p });
      expect(r).toEqual({
        page: 'recruiter-access',
        recruiterSubview: 'hub',
        unresolved: false,
      });
    }
  });
});
