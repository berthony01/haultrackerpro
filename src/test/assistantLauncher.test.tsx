import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';

const st = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null, loading: false,
  role: 'driver' as 'driver' | 'recruiter' | null, driverAllowed: true, acting: false, actingId: null as string | null,
  ai: null as any, agency: null as null | { status: string }, managed: [] as { driver_user_id: string }[],
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: st.user, session: st.user ? { user: { id: st.user.id } } : null, loading: st.loading }) }));
vi.mock('@/hooks/useViewMode', () => ({ useViewMode: () => ({ effectiveRole: st.role, driverWorkspaceAllowed: st.driverAllowed, isLoading: false, error: null }) }));
vi.mock('@/hooks/useActingContext', () => ({ useActingContext: () => ({ isActingAsAssistant: st.acting, isLoadingManagedDrivers: false, managedDrivers: st.managed, actingDriver: st.actingId ? { driver_user_id: st.actingId } : null }) }));
vi.mock('@/hooks/useAgency', () => ({ useMyAgency: () => ({ data: st.agency, isLoading: false, error: null }) }));
vi.mock('@/hooks/useAiAssistant', () => ({ useAiAssistant: () => st.ai }));
vi.mock('@/components/home/DriverWorkConversation', () => ({ default: (p: { theme?: string }) => <div data-testid="guided-find-work" data-theme={p.theme} /> }));

import { HaulTrackerAssistantLauncher, openHaulTrackerAssistant, isAssistantRoute, resolveAudience, GUIDED_LABEL, AI_LABEL } from '@/components/assistant/HaulTrackerAssistantLauncher';

function aiStub(generationEnabled: boolean) {
  const send = vi.fn(); const ensureLoaded = vi.fn();
  return { send, ensureLoaded, identityReady: true, setDraft: vi.fn(), loadOlderMessages: vi.fn(),
    currentContext: { scope: 'driver_self', targetId: 'u1', label: 'Me', tools: [] },
    state: { availability: 'ready', generationEnabled, contexts: [{ scope: 'driver_self', targetId: 'u1' }], messages: [], draft: 'hello', maxChars: 2000, sending: false, lastChange: 'replace', messagesCursor: null, messagesLoading: false } };
}
let nav: (p: string) => void = () => {};
function Nav() { nav = useNavigate(); return null; }
const mount = (path = '/dashboard') => render(<MemoryRouter initialEntries={[path]}><Nav /><HaulTrackerAssistantLauncher /></MemoryRouter>);

beforeEach(() => { Object.assign(st, { user: { id: 'u1' }, loading: false, role: 'driver', driverAllowed: true, acting: false, actingId: null, ai: aiStub(false), agency: null, managed: [] }); });
const openBubble = (path?: string) => { const r = mount(path); fireEvent.click(screen.getByTestId('assistant-launcher')); return r; };
const choose = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
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
  it('self-driver starts on an interactive menu; Find Work mounts only after choosing it, in dark theme', async () => {
    openBubble();
    expect(screen.getByRole('dialog').className).toContain('ht-assistant-dark');
    expect(screen.getByRole('tab', { name: GUIDED_LABEL })).toBeTruthy();
    expect(screen.getByRole('tab', { name: AI_LABEL })).toBeTruthy();
    expect(screen.getByText('What do you need help with?')).toBeTruthy();
    expect(screen.queryByTestId('guided-find-work')).toBeNull();
    choose(/Find work/);
    const fw = await screen.findByTestId('guided-find-work');
    expect(fw.getAttribute('data-theme')).toBe('dark');
    choose(/Start over/);
    expect(screen.queryByTestId('guided-find-work')).toBeNull();
    expect(screen.getByRole('link', { name: 'Conversations' }).getAttribute('href')).toBe('/conversations');
  });
  it('follow-up choices, Back and route actions work', () => {
    openBubble(); choose(/Loads and expenses/); choose(/Add a load/);
    expect(screen.getByRole('link', { name: /Add a load/ }).getAttribute('href')).toBe('/dashboard?page=add');
    choose(/Back/); expect(screen.getByRole('button', { name: /Log an expense/ })).toBeTruthy();
    choose(/Back/); expect(screen.getByText('What do you need help with?')).toBeTruthy();
  });
  it.each([
    ['recruiter', '/recruiter', /Applications/, '/recruiter/applications'],
    ['agency', '/agency', /Delegation and access/, '/assistants-agencies'],
    ['acting', '/dashboard', /Tasks I can do/, '/assistant'],
  ])('%s gets its own interactive menu and never the driver intake', (who, path, topic, href) => {
    if (who === 'recruiter') st.role = 'recruiter';
    if (who === 'agency') { st.role = 'recruiter'; st.agency = { status: 'active' }; }
    if (who === 'acting') { st.acting = true; st.actingId = 'd9'; }
    openBubble(path);
    expect(screen.queryByRole('button', { name: /Find work/ })).toBeNull();
    choose(topic);
    expect(screen.getAllByRole('link').some((l) => l.getAttribute('href') === href)).toBe(true);
    expect(screen.queryByTestId('guided-find-work')).toBeNull();
  });
  it('visiting /agency without an active agency fails closed to general help', () => {
    st.role = null; st.agency = null; openBubble('/agency');
    expect(screen.getByTestId('assistant-guided').getAttribute('data-audience')).toBe('general');
    cleanup(); st.agency = { status: 'disabled' }; openBubble('/agency');
    expect(screen.getByTestId('assistant-guided').getAttribute('data-audience')).toBe('general');
  });
  it('audience resolution is fail closed', () => {
    const base = { isActing: false, onAssistantRoute: false, managesDrivers: false, isAgency: false, role: null, driverAllowed: null, error: null };
    expect(resolveAudience(base)).toBe('general');
    expect(resolveAudience({ ...base, role: 'driver', driverAllowed: false })).toBe('general');
    expect(resolveAudience({ ...base, role: 'driver', driverAllowed: true, error: new Error('x') })).toBe('general');
    expect(resolveAudience({ ...base, onAssistantRoute: true })).toBe('general');
    expect(resolveAudience({ ...base, onAssistantRoute: true, managesDrivers: true })).toBe('acting_assistant');
    expect(resolveAudience({ ...base, isActing: true, role: 'driver', driverAllowed: true })).toBe('acting_assistant');
  });
  it('keeps the chosen topic across close/reopen and navigation, resets on identity change', () => {
    const r = openBubble(); choose(/Reports and profit/);
    act(() => nav('/conversations'));
    fireEvent.click(screen.getByTestId('assistant-launcher'));
    expect(screen.getByRole('heading', { name: 'Reports and profit' })).toBeTruthy();
    st.user = { id: 'u2' };
    r.rerender(<MemoryRouter initialEntries={['/dashboard']}><Nav /><HaulTrackerAssistantLauncher /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('assistant-launcher'));
    expect(screen.getByText('What do you need help with?')).toBeTruthy();
  });
  it('AI mode uses the shared store; send stays disabled while generation is off', () => {
    mount(); fireEvent.click(screen.getByTestId('assistant-launcher'));
    fireEvent.click(screen.getByRole('tab', { name: AI_LABEL }));
    expect(st.ai.ensureLoaded).toHaveBeenCalled();
    expect(screen.getByTestId('assistant-ai-disabled').textContent).toContain('Guided help remains available');
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Message the AI assistant/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy');
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
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('assistant-launcher'));
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
  it('menu bridge opens the same bubble on the current page; unhandled where no bubble is mounted', () => {
    mount('/dashboard');
    let handled = false;
    act(() => { handled = openHaulTrackerAssistant(); });
    expect(handled).toBe(true);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('tab', { name: GUIDED_LABEL })).toBeTruthy();
    cleanup();
    mount('/ai-assistant');
    expect(openHaulTrackerAssistant()).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('tabs: high-contrast selected style, ARIA wiring and Left/Right/Home/End keyboard', () => {
    openBubble();
    const g = screen.getByRole('tab', { name: GUIDED_LABEL }); const a = screen.getByRole('tab', { name: AI_LABEL });
    expect(g.className).toContain('bg-primary'); expect(g.className).toContain('text-primary-foreground');
    expect(a.className).toContain('bg-secondary'); expect(a.className).toContain('text-foreground'); expect(a.className).toContain('border-border');
    expect(g.className).toContain('min-h-[44px]'); expect(g.className).toContain('whitespace-normal');
    expect(g.tabIndex).toBe(0); expect(a.tabIndex).toBe(-1);
    const panel = screen.getByRole('tabpanel');
    expect(g.getAttribute('aria-controls')).toBe(panel.id); expect(panel.getAttribute('aria-labelledby')).toBe(g.id);
    fireEvent.keyDown(g, { key: 'ArrowRight' });
    expect(a.getAttribute('aria-selected')).toBe('true'); expect(document.activeElement).toBe(a); expect(a.tabIndex).toBe(0);
    fireEvent.keyDown(a, { key: 'ArrowRight' }); expect(g.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(g, { key: 'End' }); expect(a.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(a, { key: 'Home' }); expect(g.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(g, { key: 'ArrowLeft' }); expect(a.getAttribute('aria-selected')).toBe('true');
  });
  it('Pro disabled state offers Switch to Free help which switches mode', () => {
    openBubble(); fireEvent.click(screen.getByRole('tab', { name: AI_LABEL }));
    choose('Switch to Free help');
    expect(screen.getByRole('tab', { name: GUIDED_LABEL }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('assistant-guided')).toBeTruthy();
  });
  it('expand keeps mode and draft; footer readable; Escape still closes', () => {
    st.ai = aiStub(true); openBubble(); fireEvent.click(screen.getByRole('tab', { name: AI_LABEL }));
    const d = screen.getByRole('dialog'); expect(d.getAttribute('data-expanded')).toBe('false');
    choose('Expand assistant');
    expect(d.getAttribute('data-expanded')).toBe('true'); expect(d.className).toContain('max-h-[100dvh]');
    expect(screen.getByRole('tab', { name: AI_LABEL }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByRole('textbox', { name: /Message the AI assistant/ }) as HTMLTextAreaElement).value).toBe('hello');
    expect(screen.getByTestId('assistant-footer').className).toContain('text-[13px]');
    expect(screen.getByTestId('assistant-ai-disclosure').className).toContain('text-xs');
    choose('Shrink assistant'); expect(d.getAttribute('data-expanded')).toBe('false');
    fireEvent.keyDown(d, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('assistant-launcher')).toBeTruthy();
  });
});
