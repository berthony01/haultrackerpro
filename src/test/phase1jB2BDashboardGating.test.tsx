/**
 * Phase 1J-B2B — Dashboard/recruiter/nav capability gating tests.
 *
 * Pure policy matrix + rendered proofs for RecruiterAccessRoute,
 * AppSidebar, BottomNav, and Index integration. Every test runs
 * against the exact functions/components used at runtime.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import {
  resolveDashboardNavigation,
  isDashboardNavigationSettled,
  resolveRecruiterNavTier,
  parseRecruiterSubviewFromPage,
  isRecruiterPageId,
  DRIVER_ONLY_PAGES,
} from '@/lib/dashboardWorkspacePolicy';
import { resolveRecruiterSubviewForStatus } from '@/lib/workspaceAccess';

// --------------------------------------------------------------------------
// Child component mocks so RecruiterAccessRoute mounts are observable.
// --------------------------------------------------------------------------
vi.mock('@/components/opportunities/recruiter/RecruiterAccessPage', () => ({
  RecruiterAccessPage: (p: any) => (
    <div data-testid="recruiter-access-page">
      <button data-testid="cb-manage" onClick={p.onManage}>manage</button>
      <button data-testid="cb-apps" onClick={p.onApplications}>apps</button>
      <button data-testid="cb-onboarding" onClick={p.onOpenOnboarding}>onb</button>
    </div>
  ),
}));
vi.mock('@/components/opportunities/RecruiterOnboarding', () => ({
  RecruiterOnboarding: () => <div data-testid="recruiter-onboarding" />,
}));
vi.mock('@/components/opportunities/RecruiterOpportunityManager', () => ({
  RecruiterOpportunityManager: () => <div data-testid="recruiter-manager" />,
}));
vi.mock('@/components/opportunities/RecruiterApplicationsDashboard', () => ({
  RecruiterApplicationsDashboard: () => <div data-testid="recruiter-apps" />,
}));
vi.mock('@/components/recruiter/RecruiterReportsPanel', () => ({
  RecruiterReportsPanel: () => <div data-testid="recruiter-reports" />,
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false, signOut: vi.fn() }),
}));

import { RecruiterAccessRoute } from '@/components/opportunities/recruiter/RecruiterAccessRoute';
import { AppSidebar } from '@/components/premium/AppSidebar';
import { BottomNav } from '@/components/BottomNav';

const base = {
  requestedPage: 'dashboard',
  effectiveWorkspace: 'driver' as const,
  recruiterCapabilityStatus: null,
  recruiterHubAllowed: false,
  recruiterOperationsAllowed: false,
};

beforeEach(() => cleanup());

// ==========================================================================
// PURE — helpers, resolvers, policy matrix (retained from prior turn).
// ==========================================================================
describe('isRecruiterPageId', () => {
  it('recognizes bare and subview recruiter page ids', () => {
    expect(isRecruiterPageId('recruiter-access')).toBe(true);
    expect(isRecruiterPageId('recruiter-access:manager')).toBe(true);
    expect(isRecruiterPageId('dashboard')).toBe(false);
  });
});

describe('parseRecruiterSubviewFromPage', () => {
  it('returns hub / known / unknown subs correctly', () => {
    expect(parseRecruiterSubviewFromPage('recruiter-access')).toBe('hub');
    expect(parseRecruiterSubviewFromPage('recruiter-access:manager')).toBe('manager');
    expect(parseRecruiterSubviewFromPage('recruiter-access:wat')).toBe('hub');
    expect(parseRecruiterSubviewFromPage('dashboard')).toBeNull();
  });
});

describe('resolveRecruiterSubviewForStatus', () => {
  it('active preserves; setup collapses ops→onboarding; suspended→hub; revoked/null→null', () => {
    expect(resolveRecruiterSubviewForStatus('active', 'manager')).toBe('manager');
    expect(resolveRecruiterSubviewForStatus('setup', 'manager')).toBe('onboarding');
    expect(resolveRecruiterSubviewForStatus('setup', null)).toBe('onboarding');
    expect(resolveRecruiterSubviewForStatus('suspended', 'onboarding')).toBe('hub');
    expect(resolveRecruiterSubviewForStatus('revoked', 'manager')).toBeNull();
    expect(resolveRecruiterSubviewForStatus(null, 'hub')).toBeNull();
  });
});

describe('resolveRecruiterNavTier', () => {
  it('active only when active+ops; setup/suspended→hub_only; revoked/null→none', () => {
    expect(resolveRecruiterNavTier('active', true)).toBe('active');
    expect(resolveRecruiterNavTier('active', false)).toBe('hub_only');
    expect(resolveRecruiterNavTier('setup', false)).toBe('hub_only');
    expect(resolveRecruiterNavTier('suspended', false)).toBe('hub_only');
    expect(resolveRecruiterNavTier('revoked', true)).toBe('none');
    expect(resolveRecruiterNavTier(null, true)).toBe('none');
  });
});

describe('resolveDashboardNavigation matrix', () => {
  it('null workspace → unresolved', () => {
    const r = resolveDashboardNavigation({ ...base, effectiveWorkspace: null });
    expect(r.unresolved).toBe(true);
  });
  it('driver: recruiter targets collapse to dashboard', () => {
    expect(
      resolveDashboardNavigation({ ...base, requestedPage: 'recruiter-access:manager' }),
    ).toEqual({ page: 'dashboard', recruiterSubview: null, unresolved: false });
  });
  it('driver: driver-only pages pass through', () => {
    for (const p of ['dashboard', 'loads', 'expenses', 'fuel', 'reports', 'add']) {
      expect(resolveDashboardNavigation({ ...base, requestedPage: p })).toEqual({
        page: p, recruiterSubview: null, unresolved: false,
      });
    }
  });
  it('recruiter workspace: hubAllowed=false → unresolved', () => {
    const r = resolveDashboardNavigation({
      ...base, effectiveWorkspace: 'recruiter', requestedPage: 'recruiter-access',
      recruiterCapabilityStatus: 'active', recruiterHubAllowed: false, recruiterOperationsAllowed: true,
    });
    expect(r.unresolved).toBe(true);
  });
  it('recruiter workspace: revoked → unresolved', () => {
    const r = resolveDashboardNavigation({
      ...base, effectiveWorkspace: 'recruiter', requestedPage: 'recruiter-access',
      recruiterCapabilityStatus: 'revoked', recruiterHubAllowed: true,
    });
    expect(r.unresolved).toBe(true);
  });
  it('recruiter/setup: operational subs → onboarding; contracts/settings → hub', () => {
    const setup = {
      ...base, effectiveWorkspace: 'recruiter' as const,
      recruiterCapabilityStatus: 'setup' as const,
      recruiterHubAllowed: true, recruiterOperationsAllowed: false,
    };
    for (const sub of ['manager', 'applications', 'reports']) {
      expect(
        resolveDashboardNavigation({ ...setup, requestedPage: `recruiter-access:${sub}` }),
      ).toEqual({ page: 'recruiter-access', recruiterSubview: 'onboarding', unresolved: false });
    }
    expect(resolveDashboardNavigation({ ...setup, requestedPage: 'contracts' }))
      .toEqual({ page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false });
    expect(resolveDashboardNavigation({ ...setup, requestedPage: 'settings' }))
      .toEqual({ page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false });
  });
  it('recruiter/active+ops: preserves subs; contracts/settings → recruiter variants', () => {
    const active = {
      ...base, effectiveWorkspace: 'recruiter' as const,
      recruiterCapabilityStatus: 'active' as const,
      recruiterHubAllowed: true, recruiterOperationsAllowed: true,
    };
    for (const sub of ['manager', 'applications', 'reports', 'hub', 'onboarding']) {
      expect(
        resolveDashboardNavigation({ ...active, requestedPage: `recruiter-access:${sub}` }),
      ).toEqual({ page: 'recruiter-access', recruiterSubview: sub, unresolved: false });
    }
    expect(resolveDashboardNavigation({ ...active, requestedPage: 'contracts' }))
      .toEqual({ page: 'contracts', recruiterSubview: null, unresolved: false });
    expect(resolveDashboardNavigation({ ...active, requestedPage: 'settings' }))
      .toEqual({ page: 'settings', recruiterSubview: null, unresolved: false });
    for (const p of DRIVER_ONLY_PAGES) {
      expect(resolveDashboardNavigation({ ...active, requestedPage: p })).toEqual({
        page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false,
      });
    }
  });
  it('recruiter/active WITHOUT ops (adversarial): everything → hub', () => {
    const bad = {
      ...base, effectiveWorkspace: 'recruiter' as const,
      recruiterCapabilityStatus: 'active' as const,
      recruiterHubAllowed: true, recruiterOperationsAllowed: false,
    };
    for (const p of ['recruiter-access:manager', 'recruiter-access:applications',
      'recruiter-access:reports', 'contracts', 'settings']) {
      expect(resolveDashboardNavigation({ ...bad, requestedPage: p })).toEqual({
        page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false,
      });
    }
  });
  it('recruiter/suspended: everything → hub', () => {
    const susp = {
      ...base, effectiveWorkspace: 'recruiter' as const,
      recruiterCapabilityStatus: 'suspended' as const,
      recruiterHubAllowed: true, recruiterOperationsAllowed: false,
    };
    for (const p of ['recruiter-access:manager', 'recruiter-access:onboarding',
      'contracts', 'settings', 'dashboard']) {
      expect(resolveDashboardNavigation({ ...susp, requestedPage: p })).toEqual({
        page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false,
      });
    }
  });
});

// ==========================================================================
// PURE — isDashboardNavigationSettled
// ==========================================================================
describe('isDashboardNavigationSettled', () => {
  it('null / unresolved decision → false', () => {
    expect(isDashboardNavigationSettled('dashboard', null, null)).toBe(false);
    expect(isDashboardNavigationSettled('dashboard', null, {
      page: 'dashboard', recruiterSubview: null, unresolved: true,
    })).toBe(false);
  });
  it('page mismatch → false', () => {
    expect(isDashboardNavigationSettled('loads', null, {
      page: 'dashboard', recruiterSubview: null, unresolved: false,
    })).toBe(false);
  });
  it('recruiter page: subview mismatch → false; match → true', () => {
    expect(isDashboardNavigationSettled('recruiter-access', 'manager', {
      page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false,
    })).toBe(false);
    expect(isDashboardNavigationSettled('recruiter-access', 'manager', {
      page: 'recruiter-access', recruiterSubview: 'manager', unresolved: false,
    })).toBe(true);
  });
  it('non-recruiter page: subview ignored, page match → true', () => {
    expect(isDashboardNavigationSettled('loads', null, {
      page: 'loads', recruiterSubview: null, unresolved: false,
    })).toBe(true);
  });
});

// ==========================================================================
// RENDERED — RecruiterAccessRoute
// ==========================================================================
function renderRoute(props: Partial<React.ComponentProps<typeof RecruiterAccessRoute>>) {
  return render(
    <MemoryRouter>
      <RecruiterAccessRoute onBack={vi.fn()} {...props} />
    </MemoryRouter>,
  );
}

describe('RecruiterAccessRoute — rendered gate matrix', () => {
  it('loading → neutral panel, no child mounts', () => {
    renderRoute({ workspaceLoading: true, recruiterCapabilityStatus: 'active', recruiterHubAllowed: true, recruiterOperationsAllowed: true });
    expect(screen.getByTestId('recruiter-access-neutral')).toBeTruthy();
    expect(screen.queryByTestId('recruiter-access-page')).toBeNull();
    expect(screen.queryByTestId('recruiter-manager')).toBeNull();
  });
  it('workspaceError → neutral panel', () => {
    renderRoute({ workspaceError: new Error('x'), recruiterCapabilityStatus: 'active', recruiterHubAllowed: true, recruiterOperationsAllowed: true });
    expect(screen.getByTestId('recruiter-access-neutral')).toBeTruthy();
    expect(screen.queryByTestId('recruiter-access-page')).toBeNull();
  });
  it('hubAllowed=false → neutral panel', () => {
    renderRoute({ recruiterCapabilityStatus: 'active', recruiterHubAllowed: false, recruiterOperationsAllowed: true, initialView: 'manager' });
    expect(screen.getByTestId('recruiter-access-neutral')).toBeTruthy();
    expect(screen.queryByTestId('recruiter-manager')).toBeNull();
  });
  it('revoked / null status → neutral panel', () => {
    renderRoute({ recruiterCapabilityStatus: 'revoked', recruiterHubAllowed: true });
    expect(screen.getByTestId('recruiter-access-neutral')).toBeTruthy();
    cleanup();
    renderRoute({ recruiterCapabilityStatus: null, recruiterHubAllowed: true });
    expect(screen.getByTestId('recruiter-access-neutral')).toBeTruthy();
  });

  const activeProps = {
    recruiterCapabilityStatus: 'active' as const,
    recruiterHubAllowed: true,
    recruiterOperationsAllowed: true,
  };
  it('active+ops: hub → RecruiterAccessPage', () => {
    renderRoute({ ...activeProps, initialView: 'hub' });
    expect(screen.getByTestId('recruiter-access-page')).toBeTruthy();
  });
  it('active+ops: manager mounts', () => {
    renderRoute({ ...activeProps, initialView: 'manager' });
    expect(screen.getByTestId('recruiter-manager')).toBeTruthy();
  });
  it('active+ops: applications mounts', () => {
    renderRoute({ ...activeProps, initialView: 'applications' });
    expect(screen.getByTestId('recruiter-apps')).toBeTruthy();
  });
  it('active+ops: onboarding mounts', () => {
    renderRoute({ ...activeProps, initialView: 'onboarding' });
    expect(screen.getByTestId('recruiter-onboarding')).toBeTruthy();
  });

  it('active WITHOUT ops: operational subs collapse to hub', () => {
    renderRoute({
      recruiterCapabilityStatus: 'active', recruiterHubAllowed: true,
      recruiterOperationsAllowed: false, initialView: 'manager',
    });
    expect(screen.getByTestId('recruiter-access-page')).toBeTruthy();
    expect(screen.queryByTestId('recruiter-manager')).toBeNull();
  });

  it('setup: manager → onboarding (never manager)', () => {
    renderRoute({
      recruiterCapabilityStatus: 'setup', recruiterHubAllowed: true,
      recruiterOperationsAllowed: false, initialView: 'manager',
    });
    expect(screen.getByTestId('recruiter-onboarding')).toBeTruthy();
    expect(screen.queryByTestId('recruiter-manager')).toBeNull();
  });
  it('setup: applications → onboarding', () => {
    renderRoute({
      recruiterCapabilityStatus: 'setup', recruiterHubAllowed: true,
      recruiterOperationsAllowed: false, initialView: 'applications',
    });
    expect(screen.getByTestId('recruiter-onboarding')).toBeTruthy();
    expect(screen.queryByTestId('recruiter-apps')).toBeNull();
  });
  it('setup: hub renders hub page', () => {
    renderRoute({
      recruiterCapabilityStatus: 'setup', recruiterHubAllowed: true,
      recruiterOperationsAllowed: false, initialView: 'hub',
    });
    expect(screen.getByTestId('recruiter-access-page')).toBeTruthy();
  });

  it('suspended: onboarding request → hub only', () => {
    renderRoute({
      recruiterCapabilityStatus: 'suspended', recruiterHubAllowed: true,
      recruiterOperationsAllowed: false, initialView: 'onboarding',
    });
    expect(screen.getByTestId('recruiter-access-page')).toBeTruthy();
    expect(screen.queryByTestId('recruiter-onboarding')).toBeNull();
  });

  it('active→suspended rerender: manager child does not remain mounted', () => {
    const { rerender } = render(
      <MemoryRouter>
        <RecruiterAccessRoute
          onBack={vi.fn()}
          initialView="manager"
          recruiterCapabilityStatus="active"
          recruiterHubAllowed={true}
          recruiterOperationsAllowed={true}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('recruiter-manager')).toBeTruthy();
    rerender(
      <MemoryRouter>
        <RecruiterAccessRoute
          onBack={vi.fn()}
          initialView="manager"
          recruiterCapabilityStatus="suspended"
          recruiterHubAllowed={true}
          recruiterOperationsAllowed={false}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('recruiter-manager')).toBeNull();
    expect(screen.getByTestId('recruiter-access-page')).toBeTruthy();
  });
});

// ==========================================================================
// RENDERED — AppSidebar strict capability tiers
// ==========================================================================
function renderSidebar(props: any) {
  return render(
    <MemoryRouter>
      <AppSidebar active="dashboard" onNavigate={vi.fn()} {...props} />
    </MemoryRouter>,
  );
}

describe('AppSidebar — capability tier gating', () => {
  it('driver workspace + recruiter active status: driver items only', () => {
    renderSidebar({
      role: 'driver', recruiterCapabilityStatus: 'active', recruiterOperationsAllowed: true,
    });
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.queryByText('Manage Opportunities')).toBeNull();
    expect(screen.queryByText('Recruiter Dashboard')).toBeNull();
  });
  it('recruiter workspace + active+ops: full recruiter items', () => {
    renderSidebar({
      role: 'recruiter', recruiterCapabilityStatus: 'active', recruiterOperationsAllowed: true,
    });
    expect(screen.getByText('Manage Opportunities')).toBeTruthy();
    expect(screen.getByText('Applications')).toBeTruthy();
    expect(screen.getByText('Reports')).toBeTruthy();
  });
  it('recruiter workspace + setup: hub only, no ops/contracts/settings', () => {
    renderSidebar({ role: 'recruiter', recruiterCapabilityStatus: 'setup' });
    expect(screen.getByText('Recruiter Dashboard')).toBeTruthy();
    expect(screen.queryByText('Manage Opportunities')).toBeNull();
    expect(screen.queryByText('Contracts')).toBeNull();
    expect(screen.queryByText('Settings')).toBeNull();
  });
  it('recruiter workspace + suspended: hub only', () => {
    renderSidebar({ role: 'recruiter', recruiterCapabilityStatus: 'suspended' });
    expect(screen.getByText('Recruiter Dashboard')).toBeTruthy();
    expect(screen.queryByText('Manage Opportunities')).toBeNull();
  });
  it('recruiter workspace + revoked: no recruiter workspace links even with role=recruiter', () => {
    renderSidebar({ role: 'recruiter', recruiterCapabilityStatus: 'revoked' });
    expect(screen.queryByText('Recruiter Dashboard')).toBeNull();
    expect(screen.queryByText('Manage Opportunities')).toBeNull();
  });
  it('recruiter workspace + explicit null status: no recruiter workspace links', () => {
    renderSidebar({ role: 'recruiter', recruiterCapabilityStatus: null });
    expect(screen.queryByText('Recruiter Dashboard')).toBeNull();
  });
  it('legacy (prop omitted) + role=recruiter: preserves legacy full nav', () => {
    renderSidebar({ role: 'recruiter' });
    expect(screen.getByText('Manage Opportunities')).toBeTruthy();
  });
  it('loading: skeleton only, no actionable workspace links', () => {
    renderSidebar({ role: 'driver', recruiterCapabilityStatus: null, workspaceLoading: true });
    expect(screen.queryByText('Dashboard')).toBeNull();
    expect(screen.queryByText('Recruiter Dashboard')).toBeNull();
  });
});

// ==========================================================================
// RENDERED — BottomNav strict capability tiers
// ==========================================================================
function renderBottom(props: any) {
  return render(
    <MemoryRouter>
      <BottomNav active="dashboard" onNavigate={vi.fn()} {...props} />
    </MemoryRouter>,
  );
}

describe('BottomNav — capability tier gating', () => {
  it('recruiter workspace + active+ops: shows Home/Opps/Apps + More', () => {
    renderBottom({
      role: 'recruiter', recruiterCapabilityStatus: 'active', recruiterOperationsAllowed: true,
    });
    expect(screen.getByLabelText('Home')).toBeTruthy();
    expect(screen.getByLabelText('Opps')).toBeTruthy();
    expect(screen.getByLabelText('Apps')).toBeTruthy();
  });
  it('recruiter workspace + setup: only Home + More', () => {
    renderBottom({ role: 'recruiter', recruiterCapabilityStatus: 'setup' });
    expect(screen.getByLabelText('Home')).toBeTruthy();
    expect(screen.queryByLabelText('Opps')).toBeNull();
    expect(screen.queryByLabelText('Apps')).toBeNull();
  });
  it('recruiter workspace + suspended: only Home + More', () => {
    renderBottom({ role: 'recruiter', recruiterCapabilityStatus: 'suspended' });
    expect(screen.getByLabelText('Home')).toBeTruthy();
    expect(screen.queryByLabelText('Opps')).toBeNull();
  });
  it('recruiter workspace + revoked: no recruiter workspace link', () => {
    renderBottom({ role: 'recruiter', recruiterCapabilityStatus: 'revoked' });
    expect(screen.queryByLabelText('Home')).toBeNull();
    expect(screen.queryByLabelText('Opps')).toBeNull();
  });
  it('recruiter workspace + explicit null: no recruiter workspace link', () => {
    renderBottom({ role: 'recruiter', recruiterCapabilityStatus: null });
    expect(screen.queryByLabelText('Home')).toBeNull();
    expect(screen.queryByLabelText('Opps')).toBeNull();
  });
  it('driver workspace + recruiter active: driver nav remains', () => {
    renderBottom({
      role: 'driver', recruiterCapabilityStatus: 'active', recruiterOperationsAllowed: true,
    });
    expect(screen.getByLabelText('Dashboard')).toBeTruthy();
    expect(screen.queryByLabelText('Home')).toBeNull();
  });
  it('loading: renders bottom-nav-loading skeleton, no Sheet/More/Add/Home/Dashboard', () => {
    renderBottom({ role: 'driver', recruiterCapabilityStatus: null, workspaceLoading: true });
    expect(screen.getByTestId('bottom-nav-loading')).toBeTruthy();
    expect(screen.queryByLabelText('More')).toBeNull();
    expect(screen.queryByLabelText('Add new load or expense')).toBeNull();
    expect(screen.queryByLabelText('Dashboard')).toBeNull();
    expect(screen.queryByLabelText('Home')).toBeNull();
    expect(screen.queryByLabelText('Opps')).toBeNull();
    expect(screen.queryByLabelText('Apps')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

// ==========================================================================
// RENDERED — BottomNav More sheet interaction contents by tier
// ==========================================================================
describe('BottomNav — More sheet interaction contents', () => {
  function openMore() {
    const btn = screen.getByLabelText('More');
    fireEvent.click(btn);
  }

  it('recruiter active+ops: More sheet shows full recruiter menu', () => {
    renderBottom({
      role: 'recruiter', recruiterCapabilityStatus: 'active', recruiterOperationsAllowed: true,
    });
    openMore();
    expect(screen.getByText('Recruiter Dashboard')).toBeTruthy();
    expect(screen.getByText('Manage Opportunities')).toBeTruthy();
    expect(screen.getByText('Applications')).toBeTruthy();
    expect(screen.getByText('Reports')).toBeTruthy();
    expect(screen.getByText('Contracts')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('Sign Out')).toBeTruthy();
  });

  it('recruiter setup: More sheet has ONLY Recruiter Dashboard + Sign Out', () => {
    renderBottom({ role: 'recruiter', recruiterCapabilityStatus: 'setup' });
    openMore();
    expect(screen.getByText('Recruiter Dashboard')).toBeTruthy();
    expect(screen.getByText('Sign Out')).toBeTruthy();
    expect(screen.queryByText('Manage Opportunities')).toBeNull();
    expect(screen.queryByText('Applications')).toBeNull();
    expect(screen.queryByText('Reports')).toBeNull();
    expect(screen.queryByText('Contracts')).toBeNull();
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('recruiter suspended: More sheet has ONLY Recruiter Dashboard + Sign Out', () => {
    renderBottom({ role: 'recruiter', recruiterCapabilityStatus: 'suspended' });
    openMore();
    expect(screen.getByText('Recruiter Dashboard')).toBeTruthy();
    expect(screen.getByText('Sign Out')).toBeTruthy();
    expect(screen.queryByText('Manage Opportunities')).toBeNull();
    expect(screen.queryByText('Applications')).toBeNull();
  });

  it('recruiter explicit null: More sheet has ONLY Sign Out — no Recruiter Dashboard', () => {
    renderBottom({ role: 'recruiter', recruiterCapabilityStatus: null });
    openMore();
    expect(screen.getByText('Sign Out')).toBeTruthy();
    expect(screen.queryByText('Recruiter Dashboard')).toBeNull();
    expect(screen.queryByText('Manage Opportunities')).toBeNull();
    expect(screen.queryByText('Applications')).toBeNull();
    expect(screen.queryByText('Reports')).toBeNull();
  });

  it('recruiter revoked: More sheet has ONLY Sign Out', () => {
    renderBottom({ role: 'recruiter', recruiterCapabilityStatus: 'revoked' });
    openMore();
    expect(screen.getByText('Sign Out')).toBeTruthy();
    expect(screen.queryByText('Recruiter Dashboard')).toBeNull();
    expect(screen.queryByText('Manage Opportunities')).toBeNull();
  });

  it('driver workspace + recruiter active: driver More menu, not recruiter menu', () => {
    renderBottom({
      role: 'driver', recruiterCapabilityStatus: 'active', recruiterOperationsAllowed: true,
    });
    openMore();
    expect(screen.getByText('Reports')).toBeTruthy();
    expect(screen.getByText('Expenses')).toBeTruthy();
    expect(screen.getByText('Fuel')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('Sign Out')).toBeTruthy();
    expect(screen.queryByText('Manage Opportunities')).toBeNull();
    expect(screen.queryByText('Applications')).toBeNull();
    expect(screen.queryByText('Recruiter Dashboard')).toBeNull();
  });
});

// ==========================================================================
// RENDERED — RecruiterAccessRoute callback interactions
// ==========================================================================
describe('RecruiterAccessRoute — hub callback interactions', () => {
  it('setup hub: click Manage → onboarding, click Applications → onboarding, never manager/apps', () => {
    renderRoute({
      recruiterCapabilityStatus: 'setup', recruiterHubAllowed: true,
      recruiterOperationsAllowed: false, initialView: 'hub',
    });
    fireEvent.click(screen.getByTestId('cb-manage'));
    expect(screen.getByTestId('recruiter-onboarding')).toBeTruthy();
    expect(screen.queryByTestId('recruiter-manager')).toBeNull();
    cleanup();
    renderRoute({
      recruiterCapabilityStatus: 'setup', recruiterHubAllowed: true,
      recruiterOperationsAllowed: false, initialView: 'hub',
    });
    fireEvent.click(screen.getByTestId('cb-apps'));
    expect(screen.getByTestId('recruiter-onboarding')).toBeTruthy();
    expect(screen.queryByTestId('recruiter-apps')).toBeNull();
  });

  it('active+ops hub: click Manage → manager', () => {
    renderRoute({
      recruiterCapabilityStatus: 'active', recruiterHubAllowed: true,
      recruiterOperationsAllowed: true, initialView: 'hub',
    });
    fireEvent.click(screen.getByTestId('cb-manage'));
    expect(screen.getByTestId('recruiter-manager')).toBeTruthy();
  });

  it('active+ops hub: click Applications → apps', () => {
    renderRoute({
      recruiterCapabilityStatus: 'active', recruiterHubAllowed: true,
      recruiterOperationsAllowed: true, initialView: 'hub',
    });
    fireEvent.click(screen.getByTestId('cb-apps'));
    expect(screen.getByTestId('recruiter-apps')).toBeTruthy();
  });

  it('active WITHOUT ops: click Manage/Applications stays on hub', () => {
    renderRoute({
      recruiterCapabilityStatus: 'active', recruiterHubAllowed: true,
      recruiterOperationsAllowed: false, initialView: 'hub',
    });
    fireEvent.click(screen.getByTestId('cb-manage'));
    expect(screen.getByTestId('recruiter-access-page')).toBeTruthy();
    expect(screen.queryByTestId('recruiter-manager')).toBeNull();
    fireEvent.click(screen.getByTestId('cb-apps'));
    expect(screen.queryByTestId('recruiter-apps')).toBeNull();
    expect(screen.getByTestId('recruiter-access-page')).toBeTruthy();
  });

  it('suspended hub: onboarding/manage/apps callbacks stay on hub', () => {
    renderRoute({
      recruiterCapabilityStatus: 'suspended', recruiterHubAllowed: true,
      recruiterOperationsAllowed: false, initialView: 'hub',
    });
    fireEvent.click(screen.getByTestId('cb-onboarding'));
    fireEvent.click(screen.getByTestId('cb-manage'));
    fireEvent.click(screen.getByTestId('cb-apps'));
    expect(screen.getByTestId('recruiter-access-page')).toBeTruthy();
    expect(screen.queryByTestId('recruiter-onboarding')).toBeNull();
    expect(screen.queryByTestId('recruiter-manager')).toBeNull();
    expect(screen.queryByTestId('recruiter-apps')).toBeNull();
  });

  it('active+ops initial reports mounts RecruiterReportsPanel (lazy)', async () => {
    renderRoute({
      recruiterCapabilityStatus: 'active', recruiterHubAllowed: true,
      recruiterOperationsAllowed: true, initialView: 'reports',
    });
    expect(await screen.findByTestId('recruiter-reports')).toBeTruthy();
  });

  it('active→setup rerender: manager child collapses synchronously to onboarding', () => {
    const { rerender } = render(
      <MemoryRouter>
        <RecruiterAccessRoute
          onBack={vi.fn()}
          initialView="manager"
          recruiterCapabilityStatus="active"
          recruiterHubAllowed={true}
          recruiterOperationsAllowed={true}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('recruiter-manager')).toBeTruthy();
    rerender(
      <MemoryRouter>
        <RecruiterAccessRoute
          onBack={vi.fn()}
          initialView="manager"
          recruiterCapabilityStatus="setup"
          recruiterHubAllowed={true}
          recruiterOperationsAllowed={false}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('recruiter-manager')).toBeNull();
    expect(screen.getByTestId('recruiter-onboarding')).toBeTruthy();
  });
});


// ==========================================================================
// SOURCE — Index & module import audits
// ==========================================================================
describe('Source audits', () => {
  async function readSrc(rel: string) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
  }

  it('Index.tsx does not use useUserRole / role intent storage', async () => {
    const src = await readSrc('src/pages/Index.tsx');
    // Real imports only (comments are ignored: strip line comments first).
    const stripped = src.replace(/\/\/.*$/gm, '');
    expect(/from ['"]@\/hooks\/useUserRole['"]/.test(stripped)).toBe(false);
    expect(/htp_auth_intent['"]\s*[),]/.test(stripped)).toBe(false);
    expect(/htp_recruiter_intent['"]\s*[),]/.test(stripped)).toBe(false);
    expect(/intent=recruiter/.test(stripped)).toBe(false);
  });

  it('Index.tsx uses resolveDashboardNavigation + settled helper + workspaceError gate', async () => {
    const src = await readSrc('src/pages/Index.tsx');
    expect(src).toMatch(/resolveDashboardNavigation/);
    expect(src).toMatch(/isDashboardNavigationSettled/);
    expect(src).toMatch(/workspaceError/);
    expect(src).toMatch(/renderDecision/);
    expect(src).toMatch(/navigationSettled/);
    expect(src).toMatch(/workspaceUnavailable/);
    expect(src).toMatch(/handleWorkspaceSwitch/);
  });

  it('Index.tsx passes capability + workspaceError props to RecruiterAccessRoute', async () => {
    const src = await readSrc('src/pages/Index.tsx');
    // Find the RecruiterAccessRoute JSX block.
    const block = src.slice(src.indexOf('<RecruiterAccessRoute'), src.indexOf('/>', src.indexOf('<RecruiterAccessRoute')));
    expect(block).toMatch(/recruiterCapabilityStatus=/);
    expect(block).toMatch(/recruiterHubAllowed=/);
    expect(block).toMatch(/recruiterOperationsAllowed=/);
    expect(block).toMatch(/workspaceError=/);
    expect(block).toMatch(/workspaceLoading=/);
  });

  it('Index.tsx guards recruiter ContractActionsCard on active+ops', async () => {
    const src = await readSrc('src/pages/Index.tsx');
    // Match the recruiter ContractActionsCard render conditional.
    const m = src.match(/recruiterCapabilityStatus === 'active' && recruiterOperationsAllowed[\s\S]{0,120}ContractActionsCard role="recruiter"/);
    expect(m).toBeTruthy();
  });

  it('AppSidebar + BottomNav receive capability props from Index', async () => {
    const src = await readSrc('src/pages/Index.tsx');
    const sidebar = src.slice(src.indexOf('<AppSidebar'), src.indexOf('/>', src.indexOf('<AppSidebar')));
    expect(sidebar).toMatch(/recruiterCapabilityStatus=/);
    expect(sidebar).toMatch(/recruiterOperationsAllowed=/);
    expect(sidebar).toMatch(/workspaceLoading=\{workspaceShellBlocked\}/);
    const bottom = src.slice(src.indexOf('<BottomNav'), src.indexOf('/>', src.indexOf('<BottomNav')));
    expect(bottom).toMatch(/recruiterCapabilityStatus=/);
    expect(bottom).toMatch(/recruiterOperationsAllowed=/);
    expect(bottom).toMatch(/workspaceLoading=\{workspaceShellBlocked\}/);
  });

  it('Index.tsx defines workspaceShellBlocked from loading/unavailable/settled', async () => {
    const src = await readSrc('src/pages/Index.tsx');
    expect(src).toMatch(/const\s+workspaceShellBlocked\s*=[\s\S]{0,200}workspaceLoading[\s\S]{0,200}workspaceUnavailable[\s\S]{0,200}navigationSettled/);
  });

  it('Index.tsx gates both ViewModeSwitch surfaces on !workspaceShellBlocked', async () => {
    const src = await readSrc('src/pages/Index.tsx');
    const matches = src.match(/canSwitch\s*&&\s*!workspaceShellBlocked/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    // And no legacy `!workspaceLoading` gate remains on ViewModeSwitch.
    expect(/canSwitch\s*&&\s*!workspaceLoading\s*&&/.test(src)).toBe(false);
  });

  it('Index.tsx conditionally renders workspace modals only when shell is not blocked', async () => {
    const src = await readSrc('src/pages/Index.tsx');
    // A single guard wraps all four modals.
    const guardIdx = src.indexOf('{!workspaceShellBlocked && (');
    expect(guardIdx).toBeGreaterThan(-1);
    const region = src.slice(guardIdx);
    expect(region).toMatch(/<AddActionModal/);
    expect(region).toMatch(/<FeedbackModal/);
    expect(region).toMatch(/<OnboardingModal/);
    expect(region).toMatch(/<WhatsNewModal/);
    // And they are not ALSO rendered unguarded elsewhere in the file.
    const before = src.slice(0, guardIdx);
    expect(before).not.toMatch(/<AddActionModal/);
    expect(before).not.toMatch(/<FeedbackModal/);
    expect(before).not.toMatch(/<OnboardingModal/);
    expect(before).not.toMatch(/<WhatsNewModal/);
  });

  it('Index.tsx first-time onboarding effect requires driver+driverWorkspaceAllowed and no workspaceError', async () => {
    const src = await readSrc('src/pages/Index.tsx');
    // Locate the effect that toggles setShowOnboardingModal(true).
    const effectIdx = src.indexOf('setShowOnboardingModal(true)');
    expect(effectIdx).toBeGreaterThan(-1);
    // Scan a window of the enclosing effect body.
    const start = Math.max(0, src.lastIndexOf('useEffect(', effectIdx));
    const region = src.slice(start, effectIdx);
    expect(region).toMatch(/if\s*\(\s*workspaceLoading\s*\)\s*return\s*;/);
    expect(region).toMatch(/if\s*\(\s*workspaceError\s*\)\s*return\s*;/);
    expect(region).toMatch(/effectiveRole\s*!==\s*['"]driver['"]/);
    expect(region).toMatch(/!\s*driverWorkspaceAllowed/);
    // Must not fall back to inferring driver from !isRecruiterView.
    expect(region).not.toMatch(/isRecruiterView/);
  });

  it('Index.tsx showOnboarding requires exact driver workspace', async () => {
    const src = await readSrc('src/pages/Index.tsx');
    const m = src.match(/const\s+showOnboarding\s*=[\s\S]{0,400}?;\s*\n/);
    expect(m).toBeTruthy();
    const body = m![0];
    expect(body).toMatch(/effectiveRole\s*===\s*['"]driver['"]/);
    expect(body).toMatch(/driverWorkspaceAllowed/);
    expect(body).not.toMatch(/!\s*isRecruiterView/);
  });

  it('Index.tsx renders AddActionModal only under exact driver workspace', async () => {
    const src = await readSrc('src/pages/Index.tsx');
    const tagIdx = src.indexOf('<AddActionModal');
    expect(tagIdx).toBeGreaterThan(-1);
    // Look back a small window for the driver-workspace guard.
    const window = src.slice(Math.max(0, tagIdx - 300), tagIdx);
    expect(window).toMatch(/effectiveRole\s*===\s*['"]driver['"]\s*&&\s*driverWorkspaceAllowed/);
  });

  it('Index.tsx renders OnboardingModal only under exact driver workspace', async () => {
    const src = await readSrc('src/pages/Index.tsx');
    const tagIdx = src.indexOf('<OnboardingModal');
    expect(tagIdx).toBeGreaterThan(-1);
    const window = src.slice(Math.max(0, tagIdx - 300), tagIdx);
    expect(window).toMatch(/effectiveRole\s*===\s*['"]driver['"]\s*&&\s*driverWorkspaceAllowed/);
  });

  it('Index.tsx FeedbackModal and WhatsNewModal remain shell-blocked but not driver-only', async () => {
    const src = await readSrc('src/pages/Index.tsx');
    // Both must live inside the workspaceShellBlocked guard.
    const guardIdx = src.indexOf('{!workspaceShellBlocked && (');
    expect(guardIdx).toBeGreaterThan(-1);
    const region = src.slice(guardIdx);
    const feedbackIdx = region.indexOf('<FeedbackModal');
    const whatsNewIdx = region.indexOf('<WhatsNewModal');
    expect(feedbackIdx).toBeGreaterThan(-1);
    expect(whatsNewIdx).toBeGreaterThan(-1);
    // Neither is nested under an exact driver-workspace condition.
    const fbWindow = region.slice(Math.max(0, feedbackIdx - 200), feedbackIdx);
    const wnWindow = region.slice(Math.max(0, whatsNewIdx - 200), whatsNewIdx);
    expect(fbWindow).not.toMatch(/effectiveRole\s*===\s*['"]driver['"]\s*&&\s*driverWorkspaceAllowed/);
    expect(wnWindow).not.toMatch(/effectiveRole\s*===\s*['"]driver['"]\s*&&\s*driverWorkspaceAllowed/);
  });

  it('RecruiterAccessRoute source: no useMemo import, no useMemoSafe helper', async () => {
    const src = await readSrc('src/components/opportunities/recruiter/RecruiterAccessRoute.tsx');
    // useMemo must not be imported.
    const importLine = src.match(/^import\s*\{([^}]+)\}\s*from\s*['"]react['"];/m);
    expect(importLine).toBeTruthy();
    expect(importLine![1]).not.toMatch(/\buseMemo\b/);
    // The misleading local helper is gone.
    expect(src).not.toMatch(/useMemoSafe/);
  });

  it('dashboardWorkspacePolicy has no forbidden imports', async () => {
    const src = await readSrc('src/lib/dashboardWorkspacePolicy.ts');
    const specifiers = Array.from(src.matchAll(/from\s+['"]([^'"]+)['"]/g)).map((m) => m[1]);
    for (const spec of specifiers) {
      expect(spec).not.toMatch(/useAdmin/);
      expect(spec).not.toMatch(/billing/i);
      expect(spec).not.toMatch(/subscription/i);
      expect(spec).not.toMatch(/stripe/i);
      expect(spec).not.toMatch(/useUserRole/);
      expect(spec).not.toMatch(/recruiterProfile/);
      expect(spec).not.toMatch(/supabase/i);
    }
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(/localStorage|sessionStorage/.test(codeOnly)).toBe(false);
  });

  it('RecruiterAccessRoute has no forbidden imports', async () => {
    const src = await readSrc('src/components/opportunities/recruiter/RecruiterAccessRoute.tsx');
    const specifiers = Array.from(src.matchAll(/from\s+['"]([^'"]+)['"]/g)).map((m) => m[1]);
    for (const spec of specifiers) {
      expect(spec).not.toMatch(/useAdmin/);
      expect(spec).not.toMatch(/billing/i);
      expect(spec).not.toMatch(/subscription/i);
      expect(spec).not.toMatch(/stripe/i);
      expect(spec).not.toMatch(/useUserRole/);
      expect(spec).not.toMatch(/useRecruiterProfile/);
      expect(spec).not.toMatch(/supabase/i);
    }
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(/localStorage|sessionStorage/.test(codeOnly)).toBe(false);
  });

  it('App.tsx retains the four recruiter subview redirects', async () => {
    const src = await readSrc('src/App.tsx');
    for (const p of [
      '/recruiter/manage', '/recruiter/applications',
      '/recruiter/reports', '/recruiter/onboarding',
    ]) {
      expect(src).toContain(p);
    }
    // And still routes /recruiter to the entry route.
    expect(src).toMatch(/path="\/recruiter"[\s\S]*?RecruiterEntryRoute/);
  });
});
