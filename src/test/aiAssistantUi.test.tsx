// Actual AiAssistantProvider + AiAssistant page + Router. Only auth, acting
// context and the assistant transport are stubbed.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';

const auth = vi.hoisted(() => ({ value: { user: null as any, session: null as any, loading: false } }));
const acting = vi.hoisted(() => ({ value: { actingDriver: null as any, isLoadingManagedDrivers: false } }));
const transport = vi.hoisted(() => ({
  bootstrap: vi.fn(), threads: vi.fn(), messages: vi.fn(), send: vi.fn(), deleteThread: vi.fn(), clear: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth.value }));
vi.mock('@/hooks/useActingContext', () => ({ useActingContext: () => acting.value }));
vi.mock('@/lib/assistant/api', () => ({ assistantApi: transport }));

import { AiAssistantProvider } from '@/hooks/useAiAssistant';
import AiAssistant from '@/pages/AiAssistant';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const D = 'dddddddd-0000-4000-8000-000000000004';
const signIn = (id: string) => { auth.value = { user: { id }, session: { user: { id }, access_token: `t-${id}` }, loading: false }; };
const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });
const boot = (contexts: any[], extra: Partial<Record<string, unknown>> = {}) => ({
  available: true, generationEnabled: true, retentionDays: 30, limits: { daily: 20, perMinute: 5, maxChars: 2000 }, contexts, contextsTruncated: false, ...extra,
});
const driverCtx = (id = A) => ({ scope: 'driver_self', targetId: id, label: 'My driver workspace', tools: ['loads', 'expenses'] });
const recruiterCtx = { scope: 'recruiter', targetId: 'rrrrrrrr-0000-4000-8000-000000000101', label: 'Local Company', tools: ['opportunities', 'applications'] };
const reply = (id: string, content: string, sources: any[] = []) => ({ id, role: 'assistant', content, createdAt: '2026-10-26T00:00:00Z', sources });
function deferred<T>() { let resolve!: (v: T) => void; const p = new Promise<T>((r) => { resolve = r; }); return { p, resolve }; }

let nav: ReturnType<typeof useNavigate>;
function NavGrab() { nav = useNavigate(); return null; }
function App() {
  return (
    <AiAssistantProvider>
      <MemoryRouter initialEntries={['/ai-assistant']}>
        <NavGrab />
        <Routes>
          <Route path="/ai-assistant" element={<AiAssistant />} />
          <Route path="*" element={<p>Elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </AiAssistantProvider>
  );
}
const input = () => screen.getByLabelText('Message the AI assistant') as HTMLTextAreaElement;
const sendBtn = () => screen.getByRole('button', { name: 'Send' });

beforeEach(() => {
  signIn(A); acting.value = { actingDriver: null, isLoadingManagedDrivers: false };
  Object.values(transport).forEach((f) => f.mockReset());
  transport.threads.mockImplementation(() => ok({ threads: [], nextCursor: null }));
  transport.bootstrap.mockImplementation(() => ok(boot([driverCtx(), recruiterCtx])));
  sessionStorage.clear(); localStorage.clear();
});
afterEach(() => cleanup());

describe('AI assistant page', () => {
  it('unavailable backend shows truthful state, disables Send, keeps Find Work and inbox links', async () => {
    transport.bootstrap.mockImplementation(() => Promise.resolve({ ok: false, status: 0, code: 'unavailable' }));
    render(<App />);
    expect(await screen.findByText('AI assistant is not enabled in this environment yet.')).toBeInTheDocument();
    expect(sendBtn()).toBeDisabled();
    expect(screen.getByRole('link', { name: /Find Work/ })).toHaveAttribute('href', '/find-work');
    expect(screen.getByRole('link', { name: /Conversations/ })).toHaveAttribute('href', '/conversations');
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('no automatic transcript creation on open or context switch; role-aware prompts', async () => {
    render(<App />);
    expect(await screen.findByText(/most recent loads, most recent expenses/)).toBeInTheDocument();
    expect(screen.getByText('Conversations are kept for 30 days unless you delete them sooner.', { exact: false })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('AI assistant workspace'), { target: { value: `recruiter:${recruiterCtx.targetId}` } });
    expect(screen.getByText('Which of my opportunities were updated most recently?')).toBeInTheDocument();
    expect(screen.queryByText(/unpaid/)).toBeNull();
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('free user sees paid-plan explanation, not driver assumptions', async () => {
    transport.bootstrap.mockImplementation(() => ok(boot([])));
    render(<App />);
    expect(await screen.findByText('The AI assistant is included with paid plans.')).toBeInTheDocument();
    expect(sendBtn()).toBeDisabled();
  });

  it('generation disabled: Send disabled, history controls remain', async () => {
    transport.bootstrap.mockImplementation(() => ok(boot([driverCtx()], { generationEnabled: false })));
    render(<App />);
    expect(await screen.findByText(/AI replies are not turned on/)).toBeInTheDocument();
    fireEvent.change(input(), { target: { value: 'Hi' } });
    expect(sendBtn()).toBeDisabled();
  });

  it('send creates thread on first message, renders text safely with server source cards, auto-scrolls transcript only', async () => {
    transport.send.mockImplementation(() => ok({ threadId: 'th-1', reply: reply('m2', '<img src=x onerror=alert(1)> answer', [{ key: 'loads', label: 'Your loads (most recent)', href: '/dashboard?page=loads' }]) }));
    render(<App />);
    await screen.findByText(/I can read your/);
    const t = screen.getByTestId('ai-transcript');
    Object.defineProperty(t, 'scrollHeight', { configurable: true, get: () => 900 });
    fireEvent.change(input(), { target: { value: 'What loads?' } });
    await act(async () => { fireEvent.click(sendBtn()); });
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ content: 'What loads?', scope: 'driver_self', targetId: A }));
    expect(await screen.findByText('<img src=x onerror=alert(1)> answer')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: /Your loads/ })).toHaveAttribute('href', '/dashboard?page=loads');
    expect(t.scrollTop).toBe(900);
    expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toContain('What loads?');
  });

  it('errors and limits keep the typed message and show plain explanations', async () => {
    transport.send.mockImplementation(() => Promise.resolve({ ok: false, status: 429, code: 'limit_daily' }));
    render(<App />);
    await screen.findByText(/I can read your/);
    fireEvent.change(input(), { target: { value: 'Retry me' } });
    await act(async () => { fireEvent.click(sendBtn()); });
    expect(await screen.findByRole('alert')).toHaveTextContent('limit');
    expect(input().value).toBe('Retry me');
  });

  it('unsent draft and current thread survive navigation in the same tab', async () => {
    transport.send.mockImplementation(() => ok({ threadId: 'th-1', reply: reply('m2', 'Kept reply') }));
    render(<App />);
    await screen.findByText(/I can read your/);
    fireEvent.change(input(), { target: { value: 'First' } });
    await act(async () => { fireEvent.click(sendBtn()); });
    await screen.findByText('Kept reply');
    fireEvent.change(input(), { target: { value: 'unsent words' } });
    act(() => nav('/elsewhere')); expect(screen.getByText('Elsewhere')).toBeInTheDocument();
    act(() => nav('/ai-assistant'));
    expect(await screen.findByText('Kept reply')).toBeInTheDocument();
    expect(input().value).toBe('unsent words');
    expect(transport.bootstrap).toHaveBeenCalledTimes(1);
  });

  it('remount after refresh loads actual history with pagination', async () => {
    transport.threads.mockImplementation((cursor: any) => ok(cursor
      ? { threads: [{ id: 'th-old', scope: 'driver_self', targetId: A, createdAt: '2026-10-01T00:00:00Z', expiresAt: '', preview: 'Older chat' }], nextCursor: null }
      : { threads: [{ id: 'th-1', scope: 'driver_self', targetId: A, createdAt: '2026-10-20T00:00:00Z', expiresAt: '', preview: 'Recent chat' }], nextCursor: { before: 'x', beforeId: 'y' } }));
    transport.messages.mockImplementation((_id: string, cursor: any) => ok(cursor
      ? { messages: [{ id: 'm0', role: 'user', content: 'Oldest message', createdAt: '', sources: [] }], nextCursor: null }
      : { messages: [reply('m2', 'Newest reply'), { id: 'm1', role: 'user', content: 'Newer question', createdAt: '', sources: [] }], nextCursor: { before: 'a', beforeId: 'b' } }));
    render(<App />);
    const aside = await screen.findByLabelText('Conversation history');
    fireEvent.click(await within(aside).findByText('Recent chat'));
    expect(await screen.findByText('Newest reply')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load older messages' })); });
    expect(await screen.findByText('Oldest message')).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(aside).getByRole('button', { name: 'Load more' })); });
    expect(await within(aside).findByText('Older chat')).toBeInTheDocument();
  });

  it('delete and clear require explicit confirmation identifying scope', async () => {
    transport.threads.mockImplementation(() => ok({ threads: [{ id: 'th-1', scope: 'driver_self', targetId: A, createdAt: '2026-10-20T00:00:00Z', expiresAt: '', preview: 'Recent chat' }], nextCursor: null }));
    transport.deleteThread.mockImplementation(() => ok({ deleted: true }));
    transport.clear.mockImplementation(() => ok({ cleared: 1 }));
    render(<App />);
    const aside = await screen.findByLabelText('Conversation history');
    fireEvent.click(await within(aside).findByRole('button', { name: 'Delete conversation Recent chat' }));
    expect(await screen.findByText(/permanently deletes “Recent chat”/)).toBeInTheDocument();
    expect(transport.deleteThread).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(transport.deleteThread).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(await screen.findByText(/every AI assistant conversation saved for your account, in every workspace/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear history' })); });
    expect(transport.clear).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(aside).queryByText('Recent chat')).toBeNull());
  });

  it('A→B→A while a reply is pending: stale reply never appears, state resets', async () => {
    const pending = deferred<any>();
    transport.send.mockImplementation(() => pending.p);
    const { rerender } = render(<App />);
    await screen.findByText(/I can read your/);
    fireEvent.change(input(), { target: { value: 'A private question' } });
    await act(async () => { fireEvent.click(sendBtn()); });
    signIn(B); transport.bootstrap.mockImplementation(() => ok(boot([driverCtx(B)])));
    rerender(<App />);
    expect(screen.queryByText('A private question')).toBeNull();
    signIn(A); rerender(<App />);
    await act(async () => { pending.resolve({ ok: true, data: { threadId: 'th-a', reply: reply('ma', 'STALE A REPLY') } }); });
    expect(screen.queryByText('STALE A REPLY')).toBeNull();
    expect(screen.queryByText('A private question')).toBeNull();
  });

  it('context switch while pending drops the old reply', async () => {
    const pending = deferred<any>();
    transport.send.mockImplementation(() => pending.p);
    render(<App />);
    await screen.findByText(/I can read your/);
    fireEvent.change(input(), { target: { value: 'Driver question' } });
    await act(async () => { fireEvent.click(sendBtn()); });
    fireEvent.change(screen.getByLabelText('AI assistant workspace'), { target: { value: `recruiter:${recruiterCtx.targetId}` } });
    await act(async () => { pending.resolve({ ok: true, data: { threadId: 'th-d', reply: reply('md', 'DRIVER REPLY') } }); });
    expect(screen.queryByText('DRIVER REPLY')).toBeNull();
  });

  it('acting for a driver pins to that managed target only', async () => {
    acting.value = { actingDriver: { driver_user_id: D }, isLoadingManagedDrivers: false };
    transport.bootstrap.mockImplementation(() => ok(boot([driverCtx(), { scope: 'driver_delegate', targetId: D, label: 'Dana', tools: ['loads'] }, { scope: 'driver_delegate', targetId: B, label: 'Other driver', tools: ['loads'] }])));
    transport.threads.mockImplementation(() => ok({ threads: [
      { id: 'th-self', scope: 'driver_self', targetId: A, createdAt: '2026-10-20T00:00:00Z', expiresAt: '', preview: 'My personal chat' },
      { id: 'th-d', scope: 'driver_delegate', targetId: D, createdAt: '2026-10-20T00:00:00Z', expiresAt: '', preview: 'Dana chat' },
    ], nextCursor: null }));
    render(<App />);
    const select = await screen.findByLabelText('AI assistant workspace') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(`driver_delegate:${D}`));
    expect(select).toBeDisabled();
    expect(within(select).queryByText(/Other driver|My driver workspace/)).toBeNull();
    expect(await screen.findAllByText('Dana chat')).not.toHaveLength(0);
    expect(screen.queryByText('My personal chat')).toBeNull();
  });

  it('sign-out resets synchronously', async () => {
    transport.send.mockImplementation(() => ok({ threadId: 'th-1', reply: reply('m2', 'Secret reply') }));
    const { rerender } = render(<App />);
    await screen.findByText(/I can read your/);
    fireEvent.change(input(), { target: { value: 'Q' } });
    await act(async () => { fireEvent.click(sendBtn()); });
    await screen.findByText('Secret reply');
    auth.value = { user: null, session: null, loading: false }; rerender(<App />);
    expect(screen.queryByText('Secret reply')).toBeNull();
  });
});
