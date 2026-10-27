import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';

const st = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null, loading: false,
  role: 'driver' as 'driver' | 'recruiter' | null, driverAllowed: true, acting: false, actingId: null as string | null,
  ai: null as any,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: st.user, session: st.user ? { user: { id: st.user.id } } : null, loading: st.loading }) }));
vi.mock('@/hooks/useViewMode', () => ({ useViewMode: () => ({ effectiveRole: st.role, driverWorkspaceAllowed: st.driverAllowed, isLoading: false, error: null }) }));
vi.mock('@/hooks/useActingContext', () => ({ useActingContext: () => ({ isActingAsAssistant: st.acting, isLoadingManagedDrivers: false, actingDriver: st.actingId ? { driver_user_id: st.actingId } : null }) }));
vi.mock('@/hooks/useAiAssistant', () => ({ useAiAssistant: () => st.ai }));
vi.mock('@/components/home/DriverWorkConversation', () => ({ default: () => <div data-testid="guided-find-work" /> }));

import { HaulTrackerAssistantLauncher, isAssistantRoute, GUIDED_LABEL, AI_LABEL } from '@/components/assistant/HaulTrackerAssistantLauncher';

function aiStub(generationEnabled: boolean) {
  const send = vi.fn(); const ensureLoaded = vi.fn();
  return { send, ensureLoaded, identityReady: true, setDraft: vi.fn(), loadOlderMessages: vi.fn(),
    currentContext: { scope: 'driver_self', targetId: 'u1', label: 'Me', tools: [] },
    state: { availability: 'ready', generationEnabled, contexts: [{ scope: 'driver_self', targetId: 'u1' }], messages: [], draft: 'hello', maxChars: 2000, sending: false, lastChange: 'replace', messagesCursor: null, messagesLoading: false } };
}
let nav: (p: string) => void = () => {};
function Nav() { nav = useNavigate(); return null; }
const mount = (path = '/dashboard') => render(<MemoryRouter initialEntries={[path]}><Nav /><HaulTrackerAssistantLauncher /></MemoryRouter>);

beforeEach(() => { Object.assign(st, { user: { id: 'u1' }, loading: false, role: 'driver', driverAllowed: true, acting: false, actingId: null, ai: aiStub(false) }); });
afterEach(cleanup);

describe('HaulTracker Assistant launcher', () => {
  it('route gate: app areas only, never public, auth, full AI page or Find Work', () => {
    for (const p of ['/dashboard', '/conversations', '/assistant', '/agency', '/recruiter', '/recruiter/applications', '/driver/work-items']) expect(isAssistantRoute(p)).toBe(true);
    for (const p of ['/', '/auth', '/pricing', '/privacy', '/ai-assistant', '/find-work', '/recruiter/faq', '/agency/invite/x', '/agency/request/a']) expect(isAssistantRoute(p)).toBe(false);
  });
  it('not shown when signed out or on excluded routes', () => {
    st.user = null; mount(); expect(screen.queryByTestId('assistant-launcher')).toBeNull(); cleanup();
    st.user = { id: 'u1' }; mount('/ai-assistant'); expect(screen.queryByTestId('assistant-launcher')).toBeNull();
  });
  it('self-driver guided mode shows the canonical Find Work flow and labels', async () => {
    mount(); fireEvent.click(screen.getByTestId('assistant-launcher'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('tab', { name: GUIDED_LABEL })).toBeTruthy();
    expect(screen.getByRole('tab', { name: AI_LABEL })).toBeTruthy();
    expect(await screen.findByTestId('guided-find-work')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Conversations' }).getAttribute('href')).toBe('/conversations');
  });
  it.each([['recruiter', 'Recruiter hub'], ['acting', 'Assistant dashboard']])('%s gets role-safe links and no driver Find Work', (who, link) => {
    if (who === 'recruiter') st.role = 'recruiter'; else { st.acting = true; st.actingId = 'd9'; }
    mount(); fireEvent.click(screen.getByTestId('assistant-launcher'));
    expect(screen.getByRole('link', { name: new RegExp(link) })).toBeTruthy();
    expect(screen.queryByTestId('guided-find-work')).toBeNull();
  });
  it('AI mode uses the shared store; send stays disabled while generation is off', () => {
    mount(); fireEvent.click(screen.getByTestId('assistant-launcher'));
    fireEvent.click(screen.getByRole('tab', { name: AI_LABEL }));
    expect(st.ai.ensureLoaded).toHaveBeenCalled();
    expect(screen.getByTestId('assistant-ai-disabled')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('link', { name: /Open full workspace/ }).getAttribute('href')).toBe('/ai-assistant');
    expect(st.ai.send).not.toHaveBeenCalled();
  });
  it('AI mode can send through the existing store only when the server enables generation', () => {
    st.ai = aiStub(true); mount(); fireEvent.click(screen.getByTestId('assistant-launcher'));
    fireEvent.click(screen.getByRole('tab', { name: AI_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(st.ai.send).toHaveBeenCalledTimes(1);
  });
  it('keeps chosen mode across page changes, closes on Escape, resets on identity switch', () => {
    const r = mount(); fireEvent.click(screen.getByTestId('assistant-launcher'));
    fireEvent.click(screen.getByRole('tab', { name: AI_LABEL }));
    act(() => nav('/conversations'));
    expect(screen.getByRole('tab', { name: AI_LABEL }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('assistant-launcher'));
    expect(screen.getByRole('tab', { name: AI_LABEL }).getAttribute('aria-selected')).toBe('true');
    st.user = { id: 'u2' };
    r.rerender(<MemoryRouter initialEntries={['/dashboard']}><Nav /><HaulTrackerAssistantLauncher /></MemoryRouter>);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('assistant-launcher'));
    expect(screen.getByRole('tab', { name: GUIDED_LABEL }).getAttribute('aria-selected')).toBe('true');
  });
});
