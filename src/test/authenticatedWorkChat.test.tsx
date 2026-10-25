import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, configure } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { computeWorkspaceAccess } from '@/lib/workspaceAccess';
import { deriveUserCapabilitiesView, type UserCapabilityStatus } from '@/lib/userCapabilities';
import { HOME_INTAKE_NEXT_PATH, INTAKE_OPENING_PROMPT } from '@/lib/home/conversationIntake';
import { consumePendingProfileAnswers, clearPendingProfileAnswers } from '@/lib/home/pendingProfileHandoff';

const state = vi.hoisted(() => ({
  user: { id: 'driver-a' } as { id: string } | null, sessionUser: undefined as string | null | undefined,
  authListeners: new Set<(event: string, session: unknown) => void>(),
  authLoading: false, access: {} as Record<string, any>,
  acting: false, actingLoading: false, loads: [] as any[],
  profiles: {} as Record<string, any>, profileLoading: false, profileError: false,
  profileRead: vi.fn(), mutation: vi.fn(), rpc: vi.fn(), model: vi.fn(),
  realWorkspace: false, realOpportunities: false, capabilityRows: [] as any[], recruiterMount: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => {
  const sid = state.sessionUser === undefined ? state.user?.id : state.sessionUser;
  return { user: state.user, session: sid ? { user: { id: sid } } : null, loading: state.authLoading, signOut: vi.fn() };
} }));
vi.mock('@/hooks/useViewMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useViewMode')>();
  return { ...actual, useViewMode: () => state.realWorkspace ? actual.useViewMode() : state.access };
});
vi.mock('@/hooks/useUserCapabilities', () => ({ useUserCapabilities: () => ({
  rows: state.capabilityRows, isLoading: false, error: null,
}) }));
vi.mock('@/hooks/recruiter/useRecruiterStaffWorkspace', () => ({ useRecruiterStaffWorkspace: () => ({
  workspaces: [], selectedWorkspace: null, isLoading: false, error: null, requiresSelection: false,
}) }));
vi.mock('@/hooks/useActingContext', () => ({ useActingContext: () => ({
  isActingAsAssistant: state.acting, isLoadingManagedDrivers: state.actingLoading,
  actingDriver: null, permissions: {}, exitActingAs: vi.fn(),
}) }));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => ({ role: 'recruiter', isDriver: false, isLoading: false }) }));
vi.mock('@/hooks/opportunities/useDriverOpportunityProfile', () => ({ useDriverOpportunityProfile: () => {
  state.profileRead(state.user?.id);
  return { profile: state.profiles[state.user?.id ?? ''] ?? null, isLoading: state.profileLoading,
    isError: state.profileError, upsertProfile: { mutate: state.mutation }, deleteProfile: { mutate: state.mutation } };
} }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: (...args: unknown[]) => state.rpc(...args), from: (...args: unknown[]) => state.mutation(...args),
  functions: { invoke: (...args: unknown[]) => state.model(...args) },
  auth: { onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
    state.authListeners.add(cb);
    return { data: { subscription: { unsubscribe: () => state.authListeners.delete(cb) } } };
  } },
} }));
vi.mock('@/hooks/useLoads', () => ({ useLoads: () => ({ loads: state.loads, isLoading: false,
  addLoad: { mutate: state.mutation }, updateLoad: { mutate: state.mutation }, deleteLoad: { mutate: state.mutation } }) }));
vi.mock('@/hooks/useExpenses', () => ({ useExpenses: () => ({ expenses: [], addExpense: { mutate: state.mutation }, updateExpense: { mutate: state.mutation } }) }));
vi.mock('@/hooks/useFuelLogs', () => ({ useFuelLogs: () => ({ fuelLogs: [], addFuelLog: { mutate: state.mutation }, updateFuelLog: { mutate: state.mutation } }) }));
vi.mock('@/hooks/useLoadStops', () => ({ useLoadStops: () => ({ saveStopsForLoad: { mutate: state.mutation } }) }));
vi.mock('@/hooks/useFeedback', () => ({ useFeedback: () => ({ responses: [] }) }));
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { onboarding_completed: true } }) }));
vi.mock('@/hooks/useSmartAlerts', () => ({ useSmartAlerts: () => ({ alerts: [] }) }));
vi.mock('@/hooks/useDriverScorecard', () => ({ useDriverScorecard: () => ({}) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isLoading: false, isPro: false }) }));
vi.mock('@/hooks/useAdmin', () => ({ useAdmin: () => ({ isAdmin: false }) }));
vi.mock('@/hooks/useDriverReportSettings', () => ({ useDriverReportSettings: () => ({ data: null }) }));
vi.mock('@/hooks/useReleaseNotesSeen', () => ({ useReleaseNotesSeen: () => ({ ready: false, hasSeenLatest: true }) }));
vi.mock('@/components/SEOHead', () => ({ default: () => null }));
vi.mock('@/components/DashboardView', () => ({ DashboardView: () => <div data-testid="existing-dashboard" /> }));
vi.mock('@/components/Onboarding', () => ({ Onboarding: () => <div data-testid="existing-onboarding" /> }));
vi.mock('@/components/LoadForm', () => ({ LoadForm: () => null }));
vi.mock('@/components/ExpenseForm', () => ({ ExpenseForm: () => null }));
vi.mock('@/components/FuelLogForm', () => ({ FuelLogForm: () => null }));
vi.mock('@/components/FuelLogsListView', () => ({ FuelLogsListView: () => null }));
vi.mock('@/components/ExpensesListView', () => ({ ExpensesListView: () => null }));
vi.mock('@/components/LoadsListView', () => ({ LoadsListView: () => null }));
vi.mock('@/components/ReportsView', () => ({ ReportsView: () => null }));
vi.mock('@/components/SettingsView', () => ({ SettingsView: () => null }));
vi.mock('@/components/WeeklyCloseout', () => ({ WeeklyCloseout: () => null }));
vi.mock('@/components/MonthlySummary', () => ({ MonthlySummary: () => null }));
vi.mock('@/components/FeedbackModal', () => ({ FeedbackModal: () => null }));
vi.mock('@/components/OnboardingModal', () => ({ OnboardingModal: () => null }));
vi.mock('@/components/AlertsView', () => ({ AlertsView: () => null }));
vi.mock('@/components/opportunities/OpportunitiesPage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/opportunities/OpportunitiesPage')>();
  return { ...actual, OpportunitiesPage: (props: React.ComponentProps<typeof actual.OpportunitiesPage>) =>
    state.realWorkspace || state.realOpportunities ? <actual.OpportunitiesPage {...props} /> : null };
});
vi.mock('@/hooks/opportunities/useOpportunities', () => ({ useOpportunities: () => ({ opportunities: [], isLoading: false }) }));
vi.mock('@/hooks/opportunities/useSavedOpportunities', () => ({ useSavedOpportunities: () => ({ saved: [], save: { mutate: state.mutation }, unsave: { mutate: state.mutation } }) }));
vi.mock('@/components/opportunities/recruiter/RecruiterAccessRoute', () => ({ RecruiterAccessRoute: () => {
  state.recruiterMount(); return <div data-testid="recruiter-hub" />;
} }));
vi.mock('@/components/opportunities/recruiter/RecruiterSettingsView', () => ({ RecruiterSettingsView: () => null }));
vi.mock('@/components/RecurringExpensesView', () => ({ RecurringExpensesView: () => null }));
vi.mock('@/components/DriverScorecard', () => ({ DriverScorecard: () => null }));
vi.mock('@/components/WhatsNewModal', () => ({ WhatsNewModal: () => null }));
vi.mock('@/components/contracts/DriverContractsView', () => ({ DriverContractsView: () => null }));
vi.mock('@/components/contracts/RecruiterContractsView', () => ({ RecruiterContractsView: () => null }));
vi.mock('@/components/settlements/DriverSettlementsView', () => ({ DriverSettlementsView: () => null }));
vi.mock('@/components/AddActionModal', () => ({ AddActionModal: () => null }));
vi.mock('@/components/SmartReminders', () => ({ SmartReminders: () => null }));
vi.mock('@/components/MilestoneNudges', () => ({ MilestoneNudges: () => null }));
vi.mock('@/components/WhatsNewCard', () => ({ WhatsNewCard: () => null }));
vi.mock('@/components/ViewModeSwitch', () => ({ ViewModeSwitch: () => null }));
vi.mock('@/components/notifications/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/contracts/ContractActionsCard', () => ({ ContractActionsCard: () => null }));

// The real destination is lazy-loaded; allow its cold import to settle.
configure({ asyncUtilTimeout: 5000 });

import DriverWorkConversation from '@/components/home/DriverWorkConversation';
import FindWork from '@/pages/FindWork';
import Index from '@/pages/Index';
import { DriverOpportunityProfile } from '@/components/opportunities/DriverOpportunityProfile';
import { hasPendingProfileAnswers } from '@/lib/home/pendingProfileHandoff';
import { AppSidebar } from '@/components/premium/AppSidebar';
import { BottomNav } from '@/components/BottomNav';

function capability(driver: UserCapabilityStatus | null, recruiter: UserCapabilityStatus | null = null) {
  const rows = [];
  if (driver) rows.push({ capability: 'driver' as const, status: driver, activated_at: null });
  if (recruiter) rows.push({ capability: 'recruiter' as const, status: recruiter, activated_at: null });
  const decisions = computeWorkspaceAccess(deriveUserCapabilitiesView(rows));
  state.capabilityRows = rows;
  state.access = { ...decisions, effectiveRole: decisions.allowedFallbackWorkspace, isLoading: false,
    error: null, setViewMode: vi.fn(), recruiterWorkspaceStatus: recruiter, canSwitch: false };
}
const fullProfile = { city: 'Houston', state: 'TX', cdl_class: 'A', years_experience: 5,
  preferred_route_type: 'Regional', preferred_home_time: 'Weekly', trailer_experience: ['Flatbed'],
  min_weekly_gross: 1800, full_name: 'PRIVATE NAME', phone: 'PRIVATE PHONE' };
function Location() { const loc = useLocation(); return <output data-testid="location">{loc.pathname}{loc.search}</output>; }
function tree(child: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><Location />{child}</MemoryRouter>
  </QueryClientProvider>;
}
beforeEach(() => {
  cleanup(); vi.clearAllMocks(); state.user = { id: 'driver-a' }; state.sessionUser = undefined; state.authLoading = false;
  state.realWorkspace = false; state.realOpportunities = false;
  state.acting = false; state.actingLoading = false; state.loads = [];
  state.profiles = {}; state.profileLoading = false; state.profileError = false;
  state.rpc.mockResolvedValue({ data: [], error: null }); capability('active');
  clearPendingProfileAnswers(); localStorage.clear(); sessionStorage.clear();
  window.history.replaceState({}, '', '/dashboard');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

for (const surface of ['shared', 'route'] as const) {
  const child = () => surface === 'shared' ? <DriverWorkConversation /> : <FindWork />;
  describe(`${surface}: canonical personal Driver gate`, () => {
    it.each([null, 'active'] as const)('allows active Driver with recruiter status %s, regardless of legacy role', (recruiter) => {
      capability('active', recruiter); render(tree(child()));
      expect(screen.getByTestId('home-conversation-surface')).toBeTruthy();
      expect(state.profileRead).toHaveBeenCalledWith('driver-a');
    });
    it.each([null, 'revoked', 'suspended', 'setup'] as const)('denies Driver status %s before profile reads', (driver) => {
      capability(driver, 'active'); state.profiles['driver-a'] = fullProfile;
      render(tree(child()));
      expect(state.profileRead).not.toHaveBeenCalled();
      expect(screen.queryByTestId('home-conversation-surface')).toBeNull();
    });
    it.each(['signed-out', 'auth-loading', 'cap-loading', 'cap-error', 'unknown', 'assistant', 'acting-pending'])('denies %s before profile reads', (condition) => {
      if (condition === 'signed-out') state.user = null;
      if (condition === 'auth-loading') state.authLoading = true;
      if (condition === 'cap-loading') state.access.isLoading = true;
      if (condition === 'cap-error') state.access.error = new Error('private failure');
      if (condition === 'unknown') state.access.driverWorkspaceAllowed = undefined;
      if (condition === 'assistant') state.acting = true;
      if (condition === 'acting-pending') state.actingLoading = true;
      render(tree(child()));
      expect(state.profileRead).not.toHaveBeenCalled();
      expect(screen.queryByTestId('home-conversation-surface')).toBeNull();
      expect(document.body.textContent).not.toContain('private failure');
    });
    it('drops transcript, seeded profile and typed draft immediately on A → B and signout', () => {
      state.profiles['driver-a'] = fullProfile;
      const view = render(tree(child()));
      expect(screen.getByTestId('home-conversation-transcript').textContent).toContain('Houston');
      fireEvent.click(screen.getByTestId('home-conversation-confirm-change'));
      fireEvent.change(screen.getByTestId('home-conversation-input'), { target: { value: 'private draft A' } });
      state.user = { id: 'driver-b' }; view.rerender(tree(child()));
      expect(screen.getByTestId('home-conversation-transcript').textContent).not.toContain('Houston');
      expect(screen.getByTestId('home-conversation-input')).toHaveValue('');
      state.user = null; view.rerender(tree(child()));
      expect(screen.queryByTestId('home-conversation-surface')).toBeNull();
    });
    it('unmounts on capability loss and returns with a fresh transcript/draft', () => {
      const view = render(tree(child()));
      fireEvent.click(screen.getByTestId('home-conversation-chip-local'));
      fireEvent.change(screen.getByTestId('home-conversation-input'), { target: { value: 'draft' } });
      capability('revoked'); view.rerender(tree(child()));
      expect(screen.queryByTestId('home-conversation-transcript')).toBeNull();
      capability('active'); view.rerender(tree(child()));
      expect(screen.getByTestId('home-conversation-input')).toHaveValue('');
      expect(screen.getByText(INTAKE_OPENING_PROMPT)).toBeTruthy();
    });
  });
}

describe('read-only profile-aware flow and review handoff', () => {
  it('supports Change and Start over without storage, mutations or model calls', () => {
    state.profiles['driver-a'] = fullProfile;
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    render(tree(<DriverWorkConversation />));
    expect(document.body.textContent).not.toMatch(/PRIVATE NAME|PRIVATE PHONE/);
    fireEvent.click(screen.getByTestId('home-conversation-confirm-change'));
    fireEvent.click(screen.getByTestId('home-conversation-chip-local'));
    expect(screen.getByTestId('home-conversation-transcript').textContent).toContain('Local');
    fireEvent.click(screen.getByTestId('home-conversation-restart'));
    expect(screen.getByText(INTAKE_OPENING_PROMPT)).toBeTruthy();
    expect(state.mutation).not.toHaveBeenCalled(); expect(state.model).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });
  it('continues with employment-only memory handoff to the existing review form and only reads teasers', async () => {
    state.profiles['driver-a'] = fullProfile;
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    render(tree(<DriverWorkConversation />));
    fireEvent.click(screen.getByTestId('home-conversation-confirm-yes'));
    await waitFor(() => expect(state.rpc).toHaveBeenCalled());
    expect(state.rpc.mock.calls.every(([name]) => name === 'list_public_opportunity_teasers')).toBe(true);
    fireEvent.click(screen.getByTestId('home-conversation-continue'));
    expect(screen.getByTestId('location').textContent).toBe(HOME_INTAKE_NEXT_PATH);
    expect(consumePendingProfileAnswers('driver-a')).toMatchObject({ city: 'Houston', preferred_route_type: 'Regional' });
    expect(consumePendingProfileAnswers('driver-a')).toBeNull();
    expect(state.mutation).not.toHaveBeenCalled(); expect(state.model).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });
  it('profile error ignores any cached seed and shows only the generic fallback', () => {
    state.profiles['driver-a'] = fullProfile; state.profileError = true;
    render(tree(<DriverWorkConversation />));
    expect(screen.getByTestId('find-work-profile-error')).toHaveTextContent('We could not load your saved work profile');
    expect(screen.getByText(INTAKE_OPENING_PROMPT)).toBeTruthy();
    expect(document.body.textContent).not.toContain('Houston');
  });
});

describe('persistent navigation remains separate from human Conversations', () => {
  it('desktop guided entry opens /find-work while Opportunities and Conversations remain unchanged', () => {
    render(tree(<AppSidebar active="dashboard" role="driver" onNavigate={vi.fn()} />));
    expect(screen.getByRole('button', { name: 'Opportunities' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Conversations' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Talk to HaulTracker' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/find-work');
    fireEvent.click(screen.getByRole('button', { name: 'Conversations' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/conversations?workspace=driver');
  });
  it('mobile Driver More opens guided chat and preserves the existing human conversation link', () => {
    render(tree(<BottomNav active="dashboard" role="driver" onNavigate={vi.fn()} />));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByText('Conversations')).toBeTruthy();
    expect(screen.getByText('Opportunity Preferences')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Talk to HaulTracker' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/find-work');
  });
  it.each(['assistant', 'loading', 'recruiter-active', 'recruiter-no-ops', 'recruiter-null'])('adds no guided navigation for %s', (condition) => {
    const props = { active: 'dashboard', onNavigate: vi.fn(), role: condition.startsWith('recruiter') ? 'recruiter' as const : 'driver' as const,
      workspaceLoading: condition === 'loading', assistantPermissions: condition === 'assistant' ? {} : null,
      recruiterCapabilityStatus: condition === 'recruiter-null' ? null : 'active' as const,
      recruiterOperationsAllowed: condition === 'recruiter-active' };
    render(tree(<><AppSidebar {...props} /><BottomNav {...props} /></>));
    const more = screen.queryByRole('button', { name: 'More' }); if (more) fireEvent.click(more);
    expect(screen.queryByText('Talk to HaulTracker')).toBeNull();
  });
});

describe('actual Index settled dashboard integration', () => {
  it.each([0, 4])('expanded chat appears before the preserved content branch with %s loads', async (count) => {
    state.loads = Array.from({ length: count }, (_, i) => ({ id: String(i) }));
    render(tree(<Index />));
    expect(await screen.findByTestId('home-conversation-surface')).toBeTruthy();
    const content = screen.getByTestId(count === 0 ? 'existing-onboarding' : 'existing-dashboard');
    expect(screen.getByTestId('home-conversation-surface').compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it.each(['recruiter', 'loading', 'error', 'null', 'assistant', 'no-driver', 'acting-pending'])('never mounts chat for %s', (condition) => {
    state.loads = [{ id: 'existing' }];
    if (condition === 'recruiter') { capability('active', 'active'); state.access.effectiveRole = 'recruiter'; }
    if (condition === 'loading') state.access.isLoading = true;
    if (condition === 'error') state.access.error = new Error('unavailable');
    if (condition === 'null') state.access.effectiveRole = null;
    if (condition === 'assistant') state.acting = true;
    if (condition === 'no-driver') state.access.driverWorkspaceAllowed = false;
    if (condition === 'acting-pending') state.actingLoading = true;
    render(tree(<Index />));
    expect(screen.queryByTestId('home-conversation-surface')).toBeNull();
  });
  it('switching to another dashboard page removes the chat and preserves navigation', async () => {
    state.loads = [{ id: 'existing' }]; render(tree(<Index />));
    expect(await screen.findByTestId('home-conversation-surface')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Loads' })[0]);
    expect(screen.queryByTestId('home-conversation-surface')).toBeNull();
  });
});

/** Keep the real URL handler, workspace hook/policy, opportunities entry, and review form. */
function ReviewJourney() {
  const location = useLocation();
  // Index intentionally reads the browser URL rather than MemoryRouter's location.
  window.history.replaceState({}, '', `${location.pathname}${location.search}`);
  return location.pathname === '/find-work' ? <FindWork /> : <Index />;
}

describe('canonical workspace handoff reaches the actual review destination', () => {
  it('dual-capability recruiter workspace continues Find Work into Driver profile review without saving', async () => {
    capability('active', 'active'); state.realWorkspace = true;
    state.profiles['driver-a'] = fullProfile;
    localStorage.setItem('htp_view_mode:driver-a', 'recruiter');
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    render(<QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/find-work']}><Location /><ReviewJourney /></MemoryRouter>
    </QueryClientProvider>);
    expect(localStorage.getItem('htp_view_mode:driver-a')).toBe('recruiter');
    fireEvent.click(await screen.findByTestId('home-conversation-confirm-yes'));
    fireEvent.click(await screen.findByTestId('home-conversation-continue'));
    expect(screen.getByTestId('location')).toHaveTextContent(HOME_INTAKE_NEXT_PATH);
    expect(await screen.findByTestId('driver-profile-pending-review-note')).toHaveTextContent('not saved yet');
    expect(screen.getByDisplayValue('Houston')).toBeTruthy();
    expect(localStorage.getItem('htp_view_mode:driver-a')).toBe('driver');
    expect(screen.queryByTestId('recruiter-hub')).toBeNull();
    expect(state.recruiterMount).not.toHaveBeenCalled();
    expect(writes.mock.calls.every(([key, value]) =>
      (key === 'htp_view_mode:driver-a' && value === 'driver') ||
      (key === 'htp_opportunities_initial_view' && value === 'driver-profile'),
    )).toBe(true);
    expect(state.mutation).not.toHaveBeenCalled();
    expect(state.model).not.toHaveBeenCalled();
  });

  it.each([null, 'revoked'] as const)('Driver status %s cannot acquire review access using the destination hint', async (driver) => {
    capability(driver, 'active'); state.realWorkspace = true;
    localStorage.setItem('htp_view_mode:driver-a', 'recruiter');
    render(<QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[HOME_INTAKE_NEXT_PATH]}><ReviewJourney /></MemoryRouter>
    </QueryClientProvider>);
    expect(await screen.findByTestId('recruiter-hub')).toBeTruthy();
    expect(screen.queryByTestId('driver-profile-pending-review-note')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save Preferences' })).toBeNull();
    expect(localStorage.getItem('htp_view_mode:driver-a')).toBe('recruiter');
    expect(sessionStorage.getItem('htp_opportunities_initial_view')).toBeNull();
    expect(state.mutation).not.toHaveBeenCalled();
  });

  it('ordinary Driver continues into the actual unsaved review and consumes the memory handoff once', async () => {
    capability('active'); state.realWorkspace = true;
    state.profiles['driver-a'] = fullProfile;
    render(<QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/find-work']}><Location /><ReviewJourney /></MemoryRouter>
    </QueryClientProvider>);
    fireEvent.click(await screen.findByTestId('home-conversation-confirm-yes'));
    fireEvent.click(await screen.findByTestId('home-conversation-continue'));
    expect(await screen.findByTestId('driver-profile-pending-review-note')).toHaveTextContent('not saved yet');
    expect(screen.getByDisplayValue('Houston')).toBeTruthy();
    expect(consumePendingProfileAnswers('driver-a')).toBeNull();
    expect(state.recruiterMount).not.toHaveBeenCalled();
    expect(state.mutation).not.toHaveBeenCalled();
    expect(state.model).not.toHaveBeenCalled();
  });

  it.each(['auth-swap', 'signout', 'revoked', 'error', 'loading', 'assistant'])('cancels a pending review on %s and does not resume it after recovery', async (condition) => {
    capability('active', 'active'); state.access.effectiveRole = 'recruiter';
    // Leave the canonical switch unresolved to exercise cancellation mid-handoff.
    window.history.replaceState({}, '', HOME_INTAKE_NEXT_PATH);
    const view = render(tree(<Index />));
    expect(state.access.setViewMode).toHaveBeenCalledWith('driver');
    expect(window.location.search).toContain('view=driver-profile');
    if (condition === 'auth-swap') state.user = { id: 'driver-b' };
    if (condition === 'signout') { state.user = null; state.access.effectiveRole = null; }
    if (condition === 'revoked') capability('revoked', 'active');
    if (condition === 'error') { state.access.error = new Error('unavailable'); state.access.effectiveRole = null; }
    if (condition === 'loading') { state.access.isLoading = true; state.access.effectiveRole = null; }
    if (condition === 'assistant') state.acting = true;
    view.rerender(tree(<Index />));
    expect(screen.queryByTestId('driver-profile-pending-review-note')).toBeNull();
    expect(sessionStorage.getItem('htp_opportunities_initial_view')).toBeNull();
    expect(window.location.search).toBe('');
    state.user = { id: 'driver-b' }; state.acting = false; capability('active');
    view.rerender(tree(<Index />));
    expect(await screen.findByTestId('existing-onboarding')).toBeTruthy();
    expect(screen.queryByTestId('driver-profile-pending-review-note')).toBeNull();
    expect(state.mutation).not.toHaveBeenCalled();
  });

  it('a generic Opportunities URL does not switch a dual-capability recruiter workspace', async () => {
    capability('active', 'active'); state.realWorkspace = true;
    localStorage.setItem('htp_view_mode:driver-a', 'recruiter');
    render(<QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/dashboard?page=opportunities']}><ReviewJourney /></MemoryRouter>
    </QueryClientProvider>);
    expect(await screen.findByTestId('recruiter-hub')).toBeTruthy();
    expect(localStorage.getItem('htp_view_mode:driver-a')).toBe('recruiter');
    expect(sessionStorage.getItem('htp_opportunities_initial_view')).toBeNull();
    expect(state.mutation).not.toHaveBeenCalled();
  });

  it('dashboard-embedded chat Continue opens the unsaved review on the same mounted Index', async () => {
    // Settled workspace (no dependency churn after click) with the real destination page.
    capability('active'); state.realOpportunities = true; state.loads = [{ id: 'existing' }];
    state.profiles['driver-a'] = fullProfile;
    render(<QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/dashboard']}><Location /><ReviewJourney /></MemoryRouter>
    </QueryClientProvider>);
    expect(await screen.findByTestId('existing-dashboard')).toBeTruthy();
    fireEvent.click(await screen.findByTestId('home-conversation-confirm-yes'));
    fireEvent.click(await screen.findByTestId('home-conversation-continue'));
    expect(screen.getByTestId('location')).toHaveTextContent(HOME_INTAKE_NEXT_PATH);
    expect(await screen.findByTestId('driver-profile-pending-review-note')).toHaveTextContent('not saved yet');
    expect(screen.getByDisplayValue('Houston')).toBeTruthy();
    expect(screen.queryByTestId('home-conversation-surface')).toBeNull();
    expect(consumePendingProfileAnswers('driver-a')).toBeNull();
    expect(window.location.search).toBe('');
    expect(state.mutation).not.toHaveBeenCalled();
    expect(state.rpc.mock.calls.every(([name]) => name === 'list_public_opportunity_teasers')).toBe(true);
    expect(state.model).not.toHaveBeenCalled();
  });
});

describe('pending profile handoff is isolated per account (same tab, no reload)', () => {
  const emit = (event: string, id: string | null) =>
    [...state.authListeners].forEach((cb) => cb(event, id ? { user: { id } } : null));
  async function continueAsA() {
    state.profiles['driver-a'] = fullProfile;
    const view = render(tree(<DriverWorkConversation />));
    fireEvent.click(screen.getByTestId('home-conversation-confirm-yes'));
    await waitFor(() => expect(state.rpc).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('home-conversation-continue'));
    view.unmount();
  }
  function expectBSeesNothingFromA() {
    render(tree(<DriverOpportunityProfile onBack={vi.fn()} />));
    expect(screen.queryByTestId('driver-profile-pending-review-note')).toBeNull();
    expect(screen.queryByTestId('driver-profile-pending-badge')).toBeNull();
    expect(screen.queryByDisplayValue('Houston')).toBeNull();
    expect(state.mutation).not.toHaveBeenCalled();
  }
  it.each(['switch-no-event', 'switch-with-event', 'signout-then-b'])('account B never receives A answers: %s', async (mode) => {
    await continueAsA();
    if (mode === 'switch-with-event') emit('SIGNED_IN', 'driver-b');
    if (mode === 'signout-then-b') { state.user = null; emit('SIGNED_OUT', null); }
    state.user = { id: 'driver-b' };
    expectBSeesNothingFromA();
    expect(hasPendingProfileAnswers()).toBe(false);
  });
  it('sign-out alone drops A answers before any profile mount', async () => {
    await continueAsA();
    expect(hasPendingProfileAnswers()).toBe(true);
    emit('SIGNED_OUT', null);
    expect(hasPendingProfileAnswers()).toBe(false);
    expect(state.authListeners.size).toBe(0);
  });
  it('stale Continue after the session changed to B stores nothing', async () => {
    state.profiles['driver-a'] = fullProfile;
    const view = render(tree(<DriverWorkConversation />));
    fireEvent.click(screen.getByTestId('home-conversation-confirm-yes'));
    await waitFor(() => expect(state.rpc).toHaveBeenCalled());
    state.sessionUser = 'driver-b'; view.rerender(tree(<DriverWorkConversation />));
    fireEvent.click(screen.getByTestId('home-conversation-continue'));
    expect(hasPendingProfileAnswers()).toBe(false);
    state.user = { id: 'driver-b' }; state.sessionUser = undefined; view.unmount();
    expectBSeesNothingFromA();
  });
  it('same owner still receives the exact unsaved employment answers once', async () => {
    await continueAsA();
    render(tree(<DriverOpportunityProfile onBack={vi.fn()} />));
    expect(screen.getByTestId('driver-profile-pending-review-note')).toHaveTextContent('not saved yet');
    expect(screen.getByDisplayValue('Houston')).toBeTruthy();
    expect(screen.queryByDisplayValue('PRIVATE NAME')).toBeNull();
    expect(hasPendingProfileAnswers()).toBe(false);
    expect(state.authListeners.size).toBe(0);
    expect(state.mutation).not.toHaveBeenCalled();
  });
});
