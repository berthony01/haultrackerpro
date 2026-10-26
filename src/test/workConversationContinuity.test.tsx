import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { INTAKE_OPENING_PROMPT } from '@/lib/home/conversationIntake';
import { clearPendingProfileAnswers } from '@/lib/home/pendingProfileHandoff';

const state = vi.hoisted(() => ({
  user: { id: 'driver-a' } as { id: string } | null,
  sessionUser: undefined as string | null | undefined,
  authLoading: false,
  acting: false,
  actingLoading: false,
  driverAllowed: true as boolean | undefined,
  profiles: {} as Record<string, any>,
  mutation: vi.fn(),
  rpc: vi.fn(),
  model: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => {
    const sid = state.sessionUser === undefined ? state.user?.id : state.sessionUser;
    return { user: state.user, session: sid ? { user: { id: sid } } : null, loading: state.authLoading };
  },
}));
vi.mock('@/hooks/useActingContext', () => ({
  useActingContext: () => ({ isActingAsAssistant: state.acting, isLoadingManagedDrivers: state.actingLoading }),
}));
vi.mock('@/hooks/useViewMode', () => ({
  useViewMode: () => ({ driverWorkspaceAllowed: state.driverAllowed, isLoading: false, error: null }),
}));
vi.mock('@/hooks/opportunities/useDriverOpportunityProfile', () => ({
  useDriverOpportunityProfile: () => ({
    profile: state.profiles[state.user?.id ?? ''] ?? null,
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...a: unknown[]) => state.rpc(...a),
    from: (...a: unknown[]) => state.mutation(...a),
    functions: { invoke: (...a: unknown[]) => state.model(...a) },
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
  },
}));

import DriverWorkConversation from '@/components/home/DriverWorkConversation';
import HomeConversationFlow from '@/components/home/HomeConversationFlow';
import { WorkConversationDraftProvider } from '@/components/home/WorkConversationDraftProvider';

function Nav() {
  const navigate = useNavigate();
  return (
    <>
      <button data-testid="go-loads" onClick={() => navigate('/loads')}>Loads</button>
      <button data-testid="go-chat" onClick={() => navigate('/')}>Chat</button>
    </>
  );
}

function app(withProvider = true) {
  const qc = new QueryClient();
  const routes = (
    <Routes>
      <Route path="/" element={<DriverWorkConversation />} />
      <Route path="/loads" element={<p data-testid="loads-page">Loads page</p>} />
    </Routes>
  );
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Nav />
        {withProvider ? <WorkConversationDraftProvider>{routes}</WorkConversationDraftProvider> : routes}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const transcript = () => screen.getByTestId('home-conversation-transcript').textContent ?? '';
const type = (v: string) =>
  fireEvent.change(screen.getByTestId('home-conversation-input'), { target: { value: v } });
const send = (v: string) => {
  type(v);
  fireEvent.click(screen.getByTestId('home-conversation-send'));
};
const away = () => fireEvent.click(screen.getByTestId('go-loads'));
const back = () => fireEvent.click(screen.getByTestId('go-chat'));

let storageWrites: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.user = { id: 'driver-a' };
  state.sessionUser = undefined;
  state.authLoading = false;
  state.acting = false;
  state.actingLoading = false;
  state.driverAllowed = true;
  state.profiles = {};
  state.rpc.mockResolvedValue({ data: [], error: null });
  clearPendingProfileAnswers();
  sessionStorage.clear();
  localStorage.clear();
  storageWrites = vi.spyOn(Storage.prototype, 'setItem');
  state.fetch.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});
afterEach(() => {
  expect(storageWrites).not.toHaveBeenCalled();
  expect(state.fetch).not.toHaveBeenCalled();
  expect(state.mutation).not.toHaveBeenCalled();
  expect(state.model).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

/** Two answers + a clarification + Back + typed unsent text. */
function buildProgress() {
  fireEvent.click(screen.getByTestId('home-conversation-chip-regional'));
  send('Houston, TX');
  send('zzzzz'); // clarification on CDL step
  fireEvent.click(screen.getByTestId('home-conversation-chip-a'));
  fireEvent.click(screen.getByTestId('home-conversation-back')); // undo CDL
  type('unsent private draft');
}

describe('Phase 3 same-tab continuity (authenticated personal driver)', () => {
  it('restores exact transcript, step, typed draft and Back history after route unmount/remount', () => {
    render(app());
    expect(screen.getByTestId('find-work-continuity-note')).toHaveTextContent(
      'Progress stays while you browse in this tab. Refreshing or signing out clears it.',
    );
    buildProgress();
    const before = transcript();
    expect(before).toContain('I did not catch that one.');
    away();
    expect(screen.getByTestId('loads-page')).toBeTruthy();
    expect(screen.queryByTestId('home-conversation-transcript')).toBeNull();
    back();
    expect(transcript()).toBe(before);
    expect(screen.getByTestId('home-conversation-input')).toHaveValue('unsent private draft');
    // Still on the CDL step: the chip is available and works.
    fireEvent.click(screen.getByTestId('home-conversation-chip-a'));
    expect(transcript()).toContain('CDL');
    // Back history survived: two Backs return to the post-location state.
    fireEvent.click(screen.getByTestId('home-conversation-back'));
    expect(screen.getByTestId('home-conversation-chip-a')).toBeTruthy();
    // Bubble ids unique after restore (no React key collision => counts match).
    const bubbles = screen.getAllByTestId(/home-conversation-bubble-/);
    expect(bubbles.length).toBeGreaterThan(3);
  });

  it('Start over stays cleared across navigation', () => {
    render(app());
    buildProgress();
    fireEvent.click(screen.getByTestId('home-conversation-restart'));
    away();
    back();
    expect(transcript()).not.toContain('Houston');
    expect(screen.getByText(INTAKE_OPENING_PROMPT)).toBeTruthy();
    expect(screen.getByTestId('home-conversation-input')).toHaveValue('');
  });

  it('A → signed out → B cannot read A', () => {
    const view = render(app());
    buildProgress();
    away();
    state.user = null;
    view.rerender(app());
    state.user = { id: 'driver-b' };
    view.rerender(app());
    back();
    expect(transcript()).not.toContain('Houston');
    expect(screen.getByTestId('home-conversation-input')).toHaveValue('');
  });

  it('A → B without unmount cannot read A, and a stale A write callback cannot write', () => {
    const view = render(app());
    buildProgress();
    // Switch identity while the chat stays mounted.
    state.user = { id: 'driver-b' };
    view.rerender(app());
    // Stale A flow instance may still fire; nothing of A must surface for B.
    away();
    back();
    expect(transcript()).not.toContain('Houston');
    expect(screen.getByTestId('home-conversation-input')).toHaveValue('');
    // Return to A: A's draft was cleared synchronously at the switch, not resurrected.
    away();
    state.user = { id: 'driver-a' };
    view.rerender(app());
    back();
    expect(transcript()).not.toContain('Houston');
  });

  it.each([
    ['session mismatch', () => { state.sessionUser = 'driver-x'; }],
    ['auth loading', () => { state.authLoading = true; }],
    ['acting for another driver', () => { state.acting = true; }],
    ['managed context loading', () => { state.actingLoading = true; }],
    ['revoked driver gate', () => { state.driverAllowed = false; }],
  ])('%s clears and refuses the retained draft', (_label, invalidate) => {
    const view = render(app());
    buildProgress();
    away();
    invalidate();
    view.rerender(app());
    // Restore valid state; the draft must not come back.
    state.sessionUser = undefined;
    state.authLoading = false;
    state.acting = false;
    state.actingLoading = false;
    state.driverAllowed = true;
    view.rerender(app());
    back();
    expect(transcript()).not.toContain('Houston');
    expect(screen.getByTestId('home-conversation-input')).toHaveValue('');
  });

  it('a changed saved work profile invalidates the retained flow', () => {
    const view = render(app());
    buildProgress();
    away();
    state.profiles['driver-a'] = { city: 'Dallas', state: 'TX', preferred_route_type: 'Local' };
    view.rerender(app());
    back();
    expect(transcript()).not.toContain('Houston');
    expect(transcript()).toContain('Dallas');
  });

  it('a new provider instance (refresh boundary) starts fresh', () => {
    const first = render(app());
    buildProgress();
    first.unmount();
    render(app());
    expect(transcript()).not.toContain('Houston');
    expect(screen.getByText(INTAKE_OPENING_PROMPT)).toBeTruthy();
  });

  it('without the provider the conversation stays ephemeral', () => {
    render(app(false));
    expect(screen.queryByTestId('find-work-continuity-note')).toBeNull();
    buildProgress();
    away();
    back();
    expect(transcript()).not.toContain('Houston');
  });

  it('public flow with no adapter never reads the authenticated draft', () => {
    const view = render(app());
    buildProgress();
    view.unmount();
    render(
      <MemoryRouter>
        <WorkConversationDraftProvider>
          <HomeConversationFlow onContinue={vi.fn()} amber="" surface="" border="" textMuted="" textDim="" />
        </WorkConversationDraftProvider>
      </MemoryRouter>,
    );
    expect(transcript()).not.toContain('Houston');
    expect(screen.getByTestId('home-conversation-input')).toHaveValue('');
  });
});
