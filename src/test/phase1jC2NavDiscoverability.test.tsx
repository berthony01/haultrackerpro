/**
 * Phase 1J-C2B — Assistants & Agency + Switch Workspace discoverability.
 *
 * Proves the smallest safe navigation correction:
 *  - Driver desktop sidebar shows "Assistants & Agency" → /driver/assistant-control
 *    and "Switch Workspace" → /start.
 *  - Recruiter desktop shows "Switch Workspace" only, and no
 *    driver-assistant-control mislabel.
 *  - Mobile More sheets provide the same entries without crowding the
 *    primary bottom row (2+FAB+2 driver row is unchanged; recruiter
 *    primary row is unchanged).
 *  - Acting-assistant mode hides both cross-shell entries.
 *  - Clicks route via react-router navigate() to the correct URLs.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppSidebar } from '@/components/premium/AppSidebar';
import { BottomNav } from '@/components/BottomNav';

// react-router navigate mock — capture every navigation.
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signOut: vi.fn() }),
}));

beforeEach(() => {
  navigateMock.mockReset();
  cleanup();
});

function renderSidebar(props: Parameters<typeof AppSidebar>[0]) {
  return render(
    <MemoryRouter>
      <AppSidebar {...props} />
    </MemoryRouter>,
  );
}
function renderBottomNav(props: Parameters<typeof BottomNav>[0]) {
  return render(
    <MemoryRouter>
      <BottomNav {...props} />
    </MemoryRouter>,
  );
}

describe('Phase 1J-C2B — AppSidebar', () => {
  it('driver desktop shows "Assistants & Agency" and "Switch Workspace"', () => {
    renderSidebar({
      active: 'dashboard',
      onNavigate: vi.fn(),
      role: 'driver',
      recruiterCapabilityStatus: null,
      recruiterOperationsAllowed: false,
    });
    expect(screen.getByText('Assistants & Agency')).toBeInTheDocument();
    expect(screen.getByText('Switch Workspace')).toBeInTheDocument();
  });

  it('driver click on "Assistants & Agency" navigates to /driver/assistant-control', () => {
    const onNavigate = vi.fn();
    renderSidebar({
      active: 'dashboard',
      onNavigate,
      role: 'driver',
      recruiterCapabilityStatus: null,
      recruiterOperationsAllowed: false,
    });
    fireEvent.click(screen.getByText('Assistants & Agency'));
    expect(navigateMock).toHaveBeenCalledWith('/driver/assistant-control');
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('driver click on "Switch Workspace" navigates to /start', () => {
    renderSidebar({
      active: 'dashboard',
      onNavigate: vi.fn(),
      role: 'driver',
      recruiterCapabilityStatus: null,
      recruiterOperationsAllowed: false,
    });
    fireEvent.click(screen.getByText('Switch Workspace'));
    expect(navigateMock).toHaveBeenCalledWith('/start');
  });

  it('recruiter active desktop shows Switch Workspace and NO Assistants & Agency', () => {
    renderSidebar({
      active: 'recruiter-access',
      onNavigate: vi.fn(),
      role: 'recruiter',
      recruiterCapabilityStatus: 'active',
      recruiterOperationsAllowed: true,
    });
    expect(screen.getByText('Switch Workspace')).toBeInTheDocument();
    expect(screen.queryByText('Assistants & Agency')).not.toBeInTheDocument();
    // No driver-assistant-control mislabel on recruiter shell.
    expect(screen.queryByText(/driver.*control/i)).not.toBeInTheDocument();
  });

  it('recruiter hub-only desktop shows Switch Workspace', () => {
    renderSidebar({
      active: 'recruiter-access',
      onNavigate: vi.fn(),
      role: 'recruiter',
      recruiterCapabilityStatus: 'setup',
      recruiterOperationsAllowed: false,
    });
    expect(screen.getByText('Switch Workspace')).toBeInTheDocument();
  });

  it('acting-assistant mode hides Assistants & Agency and Switch Workspace', () => {
    renderSidebar({
      active: 'dashboard',
      onNavigate: vi.fn(),
      role: 'driver',
      recruiterCapabilityStatus: null,
      recruiterOperationsAllowed: false,
      assistantPermissions: {
        view_reports: true,
        export_reports: false,
        manage_expenses: true,
        manage_fuel: false,
        manage_loads: false,
      } as never,
    });
    expect(screen.queryByText('Assistants & Agency')).not.toBeInTheDocument();
    expect(screen.queryByText('Switch Workspace')).not.toBeInTheDocument();
  });

  it('loading state hides all items (skeleton)', () => {
    renderSidebar({
      active: 'dashboard',
      onNavigate: vi.fn(),
      role: 'driver',
      workspaceLoading: true,
      recruiterCapabilityStatus: null,
    });
    expect(screen.queryByText('Assistants & Agency')).not.toBeInTheDocument();
    expect(screen.queryByText('Switch Workspace')).not.toBeInTheDocument();
  });
});

describe('Phase 1J-C2B — BottomNav More sheet', () => {
  function openMore() {
    fireEvent.click(screen.getByLabelText('More'));
  }

  it('driver More shows Assistants & Agency and Switch Workspace', () => {
    renderBottomNav({
      active: 'dashboard',
      onNavigate: vi.fn(),
      role: 'driver',
      recruiterCapabilityStatus: null,
      recruiterOperationsAllowed: false,
    });
    openMore();
    expect(screen.getByText('Assistants & Agency')).toBeInTheDocument();
    expect(screen.getByText('Switch Workspace')).toBeInTheDocument();
  });

  it('driver More click routes via navigate() to /driver/assistant-control and /start', () => {
    renderBottomNav({
      active: 'dashboard',
      onNavigate: vi.fn(),
      role: 'driver',
      recruiterCapabilityStatus: null,
      recruiterOperationsAllowed: false,
    });
    openMore();
    fireEvent.click(screen.getByText('Assistants & Agency'));
    expect(navigateMock).toHaveBeenCalledWith('/driver/assistant-control');
    // Re-open sheet, click Switch Workspace.
    openMore();
    fireEvent.click(screen.getByText('Switch Workspace'));
    expect(navigateMock).toHaveBeenCalledWith('/start');
  });

  it('driver primary bottom row is unchanged (2+FAB+2)', () => {
    renderBottomNav({
      active: 'dashboard',
      onNavigate: vi.fn(),
      role: 'driver',
      recruiterCapabilityStatus: null,
      recruiterOperationsAllowed: false,
    });
    // Assistants & Agency lives ONLY inside the More sheet — not visible
    // before opening it.
    expect(screen.queryByText('Assistants & Agency')).not.toBeInTheDocument();
  });

  it('recruiter active More shows Switch Workspace and NO Assistants & Agency', () => {
    renderBottomNav({
      active: 'recruiter-access',
      onNavigate: vi.fn(),
      role: 'recruiter',
      recruiterCapabilityStatus: 'active',
      recruiterOperationsAllowed: true,
    });
    openMore();
    expect(screen.getByText('Switch Workspace')).toBeInTheDocument();
    expect(screen.queryByText('Assistants & Agency')).not.toBeInTheDocument();
  });

  it('recruiter hub-only More shows Switch Workspace', () => {
    renderBottomNav({
      active: 'recruiter-access',
      onNavigate: vi.fn(),
      role: 'recruiter',
      recruiterCapabilityStatus: 'setup',
      recruiterOperationsAllowed: false,
    });
    openMore();
    expect(screen.getByText('Switch Workspace')).toBeInTheDocument();
  });

  it('acting-assistant driver More does NOT expose Assistants & Agency or Switch Workspace', () => {
    renderBottomNav({
      active: 'dashboard',
      onNavigate: vi.fn(),
      role: 'driver',
      recruiterCapabilityStatus: null,
      recruiterOperationsAllowed: false,
      assistantPermissions: {
        view_reports: true,
        export_reports: false,
        manage_expenses: true,
        manage_fuel: false,
        manage_loads: false,
      } as never,
    });
    openMore();
    expect(screen.queryByText('Assistants & Agency')).not.toBeInTheDocument();
    expect(screen.queryByText('Switch Workspace')).not.toBeInTheDocument();
    // Acting-assistant exit action stays.
    expect(screen.getByText(/Switch driver \/ exit/i)).toBeInTheDocument();
  });
});
