/**
 * Phase RW-3 — Workspace discoverability & naming reconciliation.
 *
 * Surface-only contract. Proves the canonical user-facing workspace
 * vocabulary is applied consistently on the workspace entry/shell
 * surfaces WITHOUT changing routes, capability gating, acting-assistant
 * filtering, or any authorization module.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import fs from 'node:fs';
import path from 'node:path';

import CapabilityLauncher from '@/pages/CapabilityLauncher';
import { AppSidebar } from '@/components/premium/AppSidebar';
import { BottomNav } from '@/components/BottomNav';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signOut: vi.fn(), user: { id: 'assistant-user' } }),
}));

// ---- AssistantDashboard dependency isolation (surface test only) ----
const managedDriversRef: { current: any[] } = { current: [] };
const agencyRef: { current: any } = { current: null };
const beginActingAsMock = vi.fn();

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/layout/PageNav', () => ({
  PageNav: () => <nav data-testid="page-nav" />,
}));
vi.mock('@/hooks/useActingContext', () => ({
  useActingContext: () => ({
    managedDrivers: managedDriversRef.current,
    isLoadingManagedDrivers: false,
    beginActingAs: beginActingAsMock,
  }),
}));
vi.mock('@/hooks/useAssistantAudit', () => ({
  useMyAssistantAudit: () => ({ data: [] }),
  useMyPendingAssistantInvites: () => ({ data: [] }),
  formatAuditAction: () => 'action',
}));
vi.mock('@/hooks/useAgency', () => ({
  useMyAgency: () => ({ data: agencyRef.current }),
}));
vi.mock('@/components/profiles/ProfessionalProfileCard', () => ({
  MyProfessionalProfileCard: () => <div data-testid="professional-profile-card" />,
}));

import AssistantDashboard from '@/pages/AssistantDashboard';

const CANONICAL_WORKSPACE_NAMES = [
  'Driver Dashboard',
  'Recruiter Command Center',
  'Assistant Access Center',
  'Agency Console',
  'Admin Console',
  'Owner QA Center',
] as const;

const STALE_SHELL_LABELS = ['Recruiter Console', 'Load & Pay Manager', 'Assistant Console'];

function src(rel: string) {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

beforeEach(() => {
  navigateMock.mockReset();
  beginActingAsMock.mockReset();
  managedDriversRef.current = [];
  agencyRef.current = null;
  sessionStorage.clear();
  cleanup();
});

describe('RW-3 (1) — canonical workspace vocabulary', () => {
  it('is exactly the six approved names', () => {
    expect([...CANONICAL_WORKSPACE_NAMES]).toEqual([
      'Driver Dashboard',
      'Recruiter Command Center',
      'Assistant Access Center',
      'Agency Console',
      'Admin Console',
      'Owner QA Center',
    ]);
    expect(new Set(CANONICAL_WORKSPACE_NAMES).size).toBe(6);
  });
});

describe('RW-3 (2) — /start workspace directory', () => {
  function renderLauncher() {
    return render(
      <HelmetProvider>
        <MemoryRouter>
          <CapabilityLauncher />
        </MemoryRouter>
      </HelmetProvider>,
    );
  }

  it('renders exactly four tiles with the canonical workspace labels', () => {
    const { container } = renderLauncher();
    const tiles = Array.from(container.querySelectorAll('[data-capability]'));
    expect(tiles).toHaveLength(4);
    expect(tiles.map((t) => t.getAttribute('data-capability'))).toEqual([
      'driver',
      'recruiter',
      'assistant',
      'agency',
    ]);
    expect(within(tiles[0] as HTMLElement).getByText('Driver Dashboard')).toBeInTheDocument();
    expect(within(tiles[1] as HTMLElement).getByText('Recruiter Command Center')).toBeInTheDocument();
    expect(within(tiles[2] as HTMLElement).getByText('Assistant Access Center')).toBeInTheDocument();
    expect(within(tiles[3] as HTMLElement).getByText('Agency Console')).toBeInTheDocument();
  });

  it('uses "Choose a workspace" as the heading', () => {
    renderLauncher();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Choose a workspace');
  });

  it('does not use the old action phrases as primary tile labels', () => {
    const launcherSrc = src('src/pages/CapabilityLauncher.tsx');
    for (const stale of [
      "label: 'Track my trucking business'",
      "label: 'Post driver opportunities'",
      "label: 'Help drivers as an assistant'",
      "label: 'Build a back-office agency'",
    ]) {
      expect(launcherSrc).not.toContain(stale);
    }
  });

  it('keeps the exact existing tile routes', () => {
    const { container } = renderLauncher();
    const expected: Record<string, string> = {
      driver: '/dashboard',
      recruiter: '/recruiter',
      assistant: '/assistant',
      agency: '/agency',
    };
    for (const [id, to] of Object.entries(expected)) {
      navigateMock.mockReset();
      fireEvent.click(container.querySelector(`[data-capability="${id}"]`) as HTMLElement);
      expect(navigateMock).toHaveBeenCalledWith(to);
    }
  });

  it('preserves htp_workspace_intent semantics', () => {
    const { container } = renderLauncher();
    fireEvent.click(container.querySelector('[data-capability="driver"]') as HTMLElement);
    expect(sessionStorage.getItem('htp_workspace_intent')).toBe('driver');
    fireEvent.click(container.querySelector('[data-capability="recruiter"]') as HTMLElement);
    expect(sessionStorage.getItem('htp_workspace_intent')).toBe('recruiter');
    fireEvent.click(container.querySelector('[data-capability="assistant"]') as HTMLElement);
    expect(sessionStorage.getItem('htp_workspace_intent')).toBeNull();
    sessionStorage.setItem('htp_workspace_intent', 'driver');
    fireEvent.click(container.querySelector('[data-capability="agency"]') as HTMLElement);
    expect(sessionStorage.getItem('htp_workspace_intent')).toBeNull();
  });
});

describe('RW-3 (3-5) — Assistant Access Center discoverability', () => {
  function renderAssistant() {
    return render(
      <MemoryRouter>
        <AssistantDashboard />
      </MemoryRouter>,
    );
  }

  it('keeps the exact h1 and the not-a-separate-dashboard explanation', () => {
    renderAssistant();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Assistant Access Center');
    expect(
      screen.getByText(/isn't a separate dashboard or analytics workspace/i),
    ).toBeInTheDocument();
  });

  it('exposes a visible Switch Workspace action that navigates to /start', () => {
    renderAssistant();
    const btn = screen.getByTestId('assistant-switch-workspace');
    expect(btn).toHaveTextContent('Switch Workspace');
    fireEvent.click(btn);
    expect(navigateMock).toHaveBeenCalledWith('/start');
  });

  it('empty state opens the Driver Dashboard under the canonical label', () => {
    renderAssistant();
    const btn = screen.getByRole('button', { name: /Open Driver Dashboard/i });
    fireEvent.click(btn);
    expect(navigateMock).toHaveBeenCalledWith('/dashboard');
  });

  it('agency CTA reads "Open Agency Console" when an agency exists and routes /agency', () => {
    agencyRef.current = { id: 'agency-1', name: 'Acme Back Office' };
    renderAssistant();
    const cta = within(screen.getByTestId('assistant-agency-cta')).getByRole('button', {
      name: /Open Agency Console/i,
    });
    fireEvent.click(cta);
    expect(navigateMock).toHaveBeenCalledWith('/agency');
  });

  it('agency CTA keeps creation intent when no agency exists', () => {
    renderAssistant();
    expect(
      within(screen.getByTestId('assistant-agency-cta')).getByRole('button', {
        name: /Create Agency Workspace/i,
      }),
    ).toBeInTheDocument();
  });
});

describe('RW-3 (6-7) — AppSidebar shell naming', () => {
  function renderSidebar(props: Parameters<typeof AppSidebar>[0]) {
    return render(
      <MemoryRouter>
        <AppSidebar {...props} />
      </MemoryRouter>,
    );
  }

  it('recruiter active shell: first nav label and console label are canonical', () => {
    renderSidebar({
      active: 'recruiter-access',
      onNavigate: vi.fn(),
      role: 'recruiter',
      recruiterCapabilityStatus: 'active',
      recruiterOperationsAllowed: true,
    });
    const first = document.querySelector('[data-nav-id="recruiter-access"]');
    expect(first).toHaveTextContent('Recruiter Command Center');
    expect(screen.getAllByText('Recruiter Command Center').length).toBeGreaterThanOrEqual(2);
  });

  it('recruiter hub-only shell also uses Recruiter Command Center', () => {
    renderSidebar({
      active: 'recruiter-access',
      onNavigate: vi.fn(),
      role: 'recruiter',
      recruiterCapabilityStatus: 'setup',
      recruiterOperationsAllowed: false,
    });
    expect(document.querySelector('[data-nav-id="recruiter-access"]')).toHaveTextContent(
      'Recruiter Command Center',
    );
  });

  it('driver shell console label is Driver Dashboard', () => {
    renderSidebar({
      active: 'dashboard',
      onNavigate: vi.fn(),
      role: 'driver',
      recruiterCapabilityStatus: null,
      recruiterOperationsAllowed: false,
    });
    expect(screen.getByText('Driver Dashboard')).toBeInTheDocument();
  });

  it('acting-assistant shell stays in Driver Dashboard context', () => {
    renderSidebar({
      active: 'dashboard',
      onNavigate: vi.fn(),
      role: 'driver',
      recruiterCapabilityStatus: null,
      recruiterOperationsAllowed: false,
      assistantPermissions: { view_dashboard: true, manage_loads: true } as any,
    });
    expect(screen.getByText('Driver Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Assistant Console')).toBeNull();
  });

  it('acting-assistant shell still hides cross-shell href entries', () => {
    renderSidebar({
      active: 'dashboard',
      onNavigate: vi.fn(),
      role: 'driver',
      recruiterCapabilityStatus: null,
      recruiterOperationsAllowed: false,
      assistantPermissions: { view_dashboard: true, manage_loads: true } as any,
    });
    expect(screen.queryByText('Switch Workspace')).toBeNull();
    expect(screen.queryByText('Assistants & Agency')).toBeNull();
    expect(document.querySelector('[data-nav-id="nav:switch-workspace"]')).toBeNull();
    expect(document.querySelector('[data-nav-id="nav:assistant-control"]')).toBeNull();
  });

  it('stale shell labels are absent from the production component source', () => {
    const sidebarSrc = src('src/components/premium/AppSidebar.tsx');
    for (const stale of STALE_SHELL_LABELS) {
      expect(sidebarSrc).not.toContain(stale);
    }
  });
});

describe('RW-3 (8) — BottomNav recruiter naming', () => {
  function renderBottomNav(props: Parameters<typeof BottomNav>[0]) {
    return render(
      <MemoryRouter>
        <BottomNav {...props} />
      </MemoryRouter>,
    );
  }
  const openMore = () => fireEvent.click(screen.getByLabelText('More'));

  it('recruiter active More uses Recruiter Command Center and keeps /start', () => {
    renderBottomNav({
      active: 'recruiter-access',
      onNavigate: vi.fn(),
      role: 'recruiter',
      recruiterCapabilityStatus: 'active',
      recruiterOperationsAllowed: true,
    } as any);
    openMore();
    expect(screen.getByText('Recruiter Command Center')).toBeInTheDocument();
    expect(screen.queryByText('Recruiter Dashboard')).toBeNull();
    fireEvent.click(screen.getByText('Switch Workspace'));
    expect(navigateMock).toHaveBeenCalledWith('/start');
  });

  it('recruiter hub-only More uses Recruiter Command Center and keeps /start', () => {
    renderBottomNav({
      active: 'recruiter-access',
      onNavigate: vi.fn(),
      role: 'recruiter',
      recruiterCapabilityStatus: 'setup',
      recruiterOperationsAllowed: false,
    } as any);
    openMore();
    expect(screen.getByText('Recruiter Command Center')).toBeInTheDocument();
    expect(screen.queryByText('Recruiter Dashboard')).toBeNull();
    fireEvent.click(screen.getByText('Switch Workspace'));
    expect(navigateMock).toHaveBeenCalledWith('/start');
  });
});

describe('RW-3 (9) — Recruiter Command Center surface', () => {
  const recruiterSrc = src('src/components/opportunities/recruiter/RecruiterAccessPage.tsx');

  it('main h1 is Recruiter Command Center', () => {
    expect(recruiterSrc).toMatch(
      /<h1[^>]*>\s*\n?\s*Recruiter Command Center\s*\n?\s*<\/h1>/,
    );
    expect(recruiterSrc).not.toMatch(/<h1[^>]*>\s*\n?\s*Recruiter Access\s*\n?\s*<\/h1>/);
  });

  it('top back button reads Back to Driver Dashboard', () => {
    expect(recruiterSrc).toContain('Back to Driver Dashboard');
    expect(recruiterSrc).not.toMatch(/\/> Back to Dashboard/);
  });

  it('hero badge remains canonical', () => {
    expect(recruiterSrc).toContain('Recruiter Command Center');
    expect(recruiterSrc).toContain('How Recruiter Access Works');
  });
});

describe('RW-3 (10) — Agency Console surface', () => {
  const agencySrc = src('src/pages/AgencyDashboard.tsx');

  it('h1 remains Agency Console', () => {
    expect(agencySrc).toMatch(/<h1[^>]*>Agency Console<\/h1>/);
  });

  it('Switch Workspace button still navigates to /start', () => {
    expect(agencySrc).toMatch(/navigate\('\/start'\)[\s\S]{0,120}Switch Workspace/);
    expect(agencySrc).not.toContain('Switch workspace');
  });

  it('header copy uses canonical workspace names', () => {
    expect(agencySrc).toContain('Driver Dashboard');
    expect(agencySrc).toContain('Recruiter Command Center');
    expect(agencySrc).not.toContain('recruiter Console');
    expect(agencySrc).not.toContain('driver Dashboard');
  });
});

describe('RW-3 (11) — Owner QA Center shortcuts', () => {
  const ownerSrc = src('src/pages/OwnerQaCenter.tsx');

  it('TEST_SURFACES uses canonical labels for the four workspace routes', () => {
    expect(ownerSrc).toMatch(/to: '\/dashboard', label: 'Driver Dashboard'/);
    expect(ownerSrc).toMatch(/to: '\/recruiter', label: 'Recruiter Command Center'/);
    expect(ownerSrc).toMatch(/to: '\/assistant', label: 'Assistant Access Center'/);
    expect(ownerSrc).toMatch(/to: '\/agency', label: 'Agency Console'/);
  });

  it('preserves the two non-workspace helper surfaces and their routes', () => {
    expect(ownerSrc).toMatch(/to: '\/dashboard\?page=opportunities', label: 'Opportunities'/);
    expect(ownerSrc).toMatch(
      /to: '\/driver\/assistant-control', label: 'Driver Assistant Control'/,
    );
  });
});

describe('RW-3 (12) — Admin surfaces remain canonical, unedited', () => {
  const adminSrc = src('src/components/admin/AdminSidebar.tsx');

  it('AdminSidebar still says Admin Console and Owner QA Center', () => {
    expect(adminSrc).toContain('Admin Console');
    expect(adminSrc).toContain('Owner QA Center');
    expect(adminSrc).toContain("to=\"/owner-qa\"");
  });
});

describe('RW-3 (13) — no new workspace system or authorization changes', () => {
  it('CapabilityLauncher still imports no authorization/billing modules', () => {
    const launcherSrc = src('src/pages/CapabilityLauncher.tsx');
    const specs = Array.from(launcherSrc.matchAll(/from\s+['"]([^'"]+)['"]/g)).map((m) => m[1]);
    for (const spec of specs) {
      expect(spec).not.toMatch(/supabase|billing|subscription|stripe/i);
      expect(spec).not.toMatch(/useUserRole|useAdmin|workspaceAccess|useViewMode/);
    }
  });

  it('AppSidebar still delegates recruiter tiering to the existing policy module', () => {
    const sidebarSrc = src('src/components/premium/AppSidebar.tsx');
    expect(sidebarSrc).toContain("from '@/lib/dashboardWorkspacePolicy'");
    expect(sidebarSrc).toContain('resolveRecruiterNavTier');
    expect(sidebarSrc).toContain("from '@/lib/assistantPermissions'");
  });

  it('the four workspace routes are unchanged', () => {
    const launcherSrc = src('src/pages/CapabilityLauncher.tsx');
    for (const to of ['/dashboard', '/recruiter', '/assistant', '/agency']) {
      expect(launcherSrc).toContain(`to: '${to}'`);
    }
  });
});
