// Actual AiAssistantProvider + AiAssistant page + Router. Only auth, acting
// context and the assistant transport are stubbed.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';

const auth = vi.hoisted(() => ({ value: { user: null as any, session: null as any, loading: false } }));
const acting = vi.hoisted(() => ({ value: { actingDriver: null as any, isActingAsAssistant: false, isLoadingManagedDrivers: false } }));
const transport = vi.hoisted(() => ({
  bootstrap: vi.fn(), threads: vi.fn(), messages: vi.fn(), send: vi.fn(), deleteThread: vi.fn(), clear: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth.value }));
vi.mock('@/hooks/useActingContext', () => ({ useActingContext: () => acting.value }));
vi.mock('@/lib/assistant/api', () => ({ assistantApi: transport }));

import { AiAssistantProvider, newRequestId, sessionHintOf } from '@/hooks/useAiAssistant';
import AiAssistant from '@/pages/AiAssistant';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const D = 'dddddddd-0000-4000-8000-000000000004';
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (sub: string, session_id: unknown, extra: Record<string, unknown> = {}) => `${b64({ alg: 'none' })}.${b64({ sub, session_id, ...extra })}.sig`;
const S1 = '11111111-0000-4000-8000-000000000001';
const S2 = '22222222-0000-4000-8000-000000000002';
const signIn = (id: string, session: unknown = S1, extra: Record<string, unknown> = {}) => {
  auth.value = { user: { id }, session: { user: { id }, access_token: jwt(id, session, extra) }, loading: false };
};
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
  signIn(A); acting.value = { actingDriver: null, isActingAsAssistant: false, isLoadingManagedDrivers: false };
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
    signIn(B, S2); transport.bootstrap.mockImplementation(() => ok(boot([driverCtx(B)])));
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
    acting.value = { actingDriver: { driver_user_id: D }, isActingAsAssistant: true, isLoadingManagedDrivers: false };
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

const thread = (id: string, preview: string, scope = 'driver_self', targetId = A) => ({ id, scope, targetId, createdAt: '2026-10-20T00:00:00Z', expiresAt: '', preview });
const userMsg = (id: string, content: string) => ({ id, role: 'user', content, createdAt: '', sources: [] });

describe('AI assistant review corrections', () => {
  it('paid access loss still permits confirmed own clear with no contexts, histories or generation', async () => {
    transport.bootstrap.mockImplementation(() => ok(boot([], { generationEnabled: false })));
    transport.clear.mockImplementation(() => ok({ cleared: 0 }));
    render(<App />);
    await screen.findByText('The AI assistant is included with paid plans.');
    const clear = screen.getByRole('button', { name: 'Clear history' });
    expect(clear).toBeEnabled();
    expect(sendBtn()).toBeDisabled();
    fireEvent.click(clear);
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/every AI assistant conversation saved for your account, in every workspace/)).toBeInTheDocument();
    expect(transport.clear).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Clear history' })); });
    expect(transport.clear).toHaveBeenCalledTimes(1);
    expect(transport.clear).toHaveBeenCalledWith();
    expect(transport.send).not.toHaveBeenCalled();
    expect(transport.deleteThread).not.toHaveBeenCalled();
    expect(transport.messages).not.toHaveBeenCalled();
  });

  it('page 21 managed target requires explicit continuation after the 20-page operation bound', async () => {
    acting.value = { actingDriver: { driver_user_id: D }, isActingAsAssistant: true, isLoadingManagedDrivers: false };
    transport.bootstrap.mockImplementation((offset = 0) => ok(boot(offset === 1000
      ? [{ scope: 'driver_delegate', targetId: D, label: 'Dana', tools: ['loads'] }]
      : [driverCtx(), { scope: 'driver_delegate', targetId: B, label: 'Other driver', tools: ['loads'] }],
    { nextOffset: offset === 1000 ? null : offset + 50 })));
    render(<App />);
    const more = await screen.findByRole('button', { name: 'Continue searching' });
    expect(transport.bootstrap).toHaveBeenCalledTimes(20);
    expect(transport.bootstrap.mock.calls.map((c) => c[0])).toEqual([undefined, ...Array.from({ length: 19 }, (_, i) => (i + 1) * 50)]);
    expect(screen.queryByText('The AI assistant is not available for this driver.')).toBeNull();
    expect((screen.getByLabelText('AI assistant workspace') as HTMLSelectElement).value).toBe('');
    expect(sendBtn()).toBeDisabled();
    await act(async () => { fireEvent.click(more); });
    const select = screen.getByLabelText('AI assistant workspace') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(`driver_delegate:${D}`));
    expect(transport.bootstrap).toHaveBeenCalledTimes(21);
    expect(transport.bootstrap).toHaveBeenLastCalledWith(1000);
    expect(select.options).toHaveLength(1);
    expect(select).toBeDisabled();
    expect(within(select).queryByText(/My driver workspace|Other driver/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue searching' })).toBeNull();
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('failed pinned continuation retains its offset and incomplete state for explicit retry', async () => {
    acting.value = { actingDriver: { driver_user_id: D }, isActingAsAssistant: true, isLoadingManagedDrivers: false };
    let attempts = 0;
    transport.bootstrap.mockImplementation((offset = 0) => {
      if (offset !== 1000) return ok(boot([driverCtx()], { nextOffset: offset + 50 }));
      attempts += 1;
      return attempts === 1 ? Promise.resolve({ ok: false, status: 503, code: 'unavailable' })
        : ok(boot([{ scope: 'driver_delegate', targetId: D, label: 'Dana', tools: ['loads'] }], { nextOffset: null }));
    });
    render(<App />);
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Continue searching' })); });
    expect(await screen.findByText(/The search could not continue right now/)).toBeInTheDocument();
    expect(screen.queryByText('The AI assistant is not available for this driver.')).toBeNull();
    expect(sendBtn()).toBeDisabled();
    expect((screen.getByLabelText('AI assistant workspace') as HTMLSelectElement).value).toBe('');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue searching' })); });
    await waitFor(() => expect((screen.getByLabelText('AI assistant workspace') as HTMLSelectElement).value).toBe(`driver_delegate:${D}`));
    expect(transport.bootstrap.mock.calls.slice(-2).map((c) => c[0])).toEqual([1000, 1000]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('identity change during pinned continuation discards the old target and delayed history', async () => {
    acting.value = { actingDriver: { driver_user_id: D }, isActingAsAssistant: true, isLoadingManagedDrivers: false };
    const pending = deferred<any>();
    transport.bootstrap.mockImplementation((offset = 0) => offset === 1000 ? pending.p : ok(boot([driverCtx()], { nextOffset: offset + 50 })));
    const { rerender } = render(<App />);
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Continue searching' })); });
    expect(transport.bootstrap).toHaveBeenLastCalledWith(1000);
    signIn(B, S2);
    transport.bootstrap.mockImplementation(() => ok(boot([{ scope: 'driver_delegate', targetId: D, label: 'New identity workspace', tools: ['loads'] }], { nextOffset: null })));
    rerender(<App />);
    await waitFor(() => expect((screen.getByLabelText('AI assistant workspace') as HTMLSelectElement).selectedOptions[0]?.textContent).toContain('New identity workspace'));
    const historyCalls = transport.threads.mock.calls.length;
    await act(async () => { pending.resolve({ ok: true, data: boot([{ scope: 'driver_delegate', targetId: D, label: 'OLD PRIVATE TARGET', tools: ['loads'] }], { nextOffset: null }) }); });
    expect(screen.queryByText(/OLD PRIVATE TARGET/)).toBeNull();
    expect((screen.getByLabelText('AI assistant workspace') as HTMLSelectElement).selectedOptions[0]?.textContent).toContain('New identity workspace');
    expect(transport.threads).toHaveBeenCalledTimes(historyCalls);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('session hint: only a well-formed JWT session_id; missing or malformed fails closed', async () => {
    expect(sessionHintOf(jwt(A, S1))).toBe(S1);
    expect(sessionHintOf(jwt(A, 'not-a-uuid'))).toBeNull();
    expect(sessionHintOf(jwt(A, undefined))).toBeNull();
    expect(sessionHintOf('t-opaque')).toBeNull();
    signIn(A, null); render(<App />);
    await act(async () => {});
    expect(transport.bootstrap).not.toHaveBeenCalled();
    expect(screen.queryByText(/I can read your/)).toBeNull();
  });

  it('same user, same session token refresh preserves; different session resets and drops delayed old response', async () => {
    const pending = deferred<any>();
    transport.send.mockImplementationOnce(() => ok({ threadId: 'th-1', reply: reply('m1', 'First reply') })).mockImplementationOnce(() => pending.p);
    const { rerender } = render(<App />);
    await screen.findByText(/I can read your/);
    fireEvent.change(input(), { target: { value: 'One' } });
    await act(async () => { fireEvent.click(sendBtn()); });
    await screen.findByText('First reply');
    signIn(A, S1, { exp: 999 }); rerender(<App />); // refreshed token, same session
    expect(screen.getByText('First reply')).toBeInTheDocument();
    fireEvent.change(input(), { target: { value: 'Two' } });
    await act(async () => { fireEvent.click(sendBtn()); });
    signIn(A, S2); rerender(<App />); // same user, different session
    expect(screen.queryByText('First reply')).toBeNull();
    await act(async () => { pending.resolve({ ok: true, data: { threadId: 'th-1', reply: reply('m2', 'OLD SESSION REPLY') } }); });
    expect(screen.queryByText('OLD SESSION REPLY')).toBeNull();
    expect(transport.bootstrap).toHaveBeenCalledTimes(2);
  });

  it('acting with unresolved target or loading fails closed, never personal; A to B to A pinned', async () => {
    acting.value = { actingDriver: null, isActingAsAssistant: true, isLoadingManagedDrivers: false };
    const { rerender } = render(<App />);
    await act(async () => {});
    expect(transport.bootstrap).not.toHaveBeenCalled();
    acting.value = { actingDriver: { driver_user_id: D }, isActingAsAssistant: true, isLoadingManagedDrivers: true }; rerender(<App />);
    await act(async () => {});
    expect(transport.bootstrap).not.toHaveBeenCalled();
    transport.bootstrap.mockImplementation(() => ok(boot([driverCtx(), { scope: 'driver_delegate', targetId: D, label: 'Dana', tools: ['loads'] }, { scope: 'driver_delegate', targetId: B, label: 'Bo', tools: ['loads'] }])));
    acting.value = { actingDriver: { driver_user_id: D }, isActingAsAssistant: true, isLoadingManagedDrivers: false }; rerender(<App />);
    const select = await screen.findByLabelText('AI assistant workspace') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(`driver_delegate:${D}`));
    fireEvent.change(input(), { target: { value: 'for Dana' } });
    acting.value = { actingDriver: { driver_user_id: B }, isActingAsAssistant: true, isLoadingManagedDrivers: false }; rerender(<App />);
    await waitFor(() => expect((screen.getByLabelText('AI assistant workspace') as HTMLSelectElement).value).toBe(`driver_delegate:${B}`));
    expect(input().value).toBe('');
    acting.value = { actingDriver: { driver_user_id: D }, isActingAsAssistant: true, isLoadingManagedDrivers: false }; rerender(<App />);
    await waitFor(() => expect((screen.getByLabelText('AI assistant workspace') as HTMLSelectElement).value).toBe(`driver_delegate:${D}`));
    expect(input().value).toBe('');
    expect(within(screen.getByLabelText('AI assistant workspace')).queryByText(/My driver workspace/)).toBeNull();
  });

  it('pinned target beyond the first page is found by bounded sequential pages; personal contexts never shown', async () => {
    acting.value = { actingDriver: { driver_user_id: D }, isActingAsAssistant: true, isLoadingManagedDrivers: false };
    const page = (n: number) => Array.from({ length: 50 }, (_, i) => ({ scope: 'driver_delegate', targetId: `cccccccc-0000-4000-8000-${String(n * 100 + i).padStart(12, '0')}`, label: `X${i}`, tools: ['loads'] }));
    transport.bootstrap.mockImplementation((offset?: number) => ok(!offset ? boot([driverCtx(), ...page(1)], { contextsTruncated: true, nextOffset: 51 })
      : offset === 51 ? boot(page(2), { contextsTruncated: true, nextOffset: 101 })
      : boot([{ scope: 'driver_delegate', targetId: D, label: 'Dana', tools: ['loads'] }], { nextOffset: null })));
    render(<App />);
    const select = await screen.findByLabelText('AI assistant workspace') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(`driver_delegate:${D}`));
    expect(transport.bootstrap.mock.calls.map((c) => c[0])).toEqual([undefined, 51, 101]);
    expect(select.options).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more workspaces' })).toBeNull();
  });

  it('pinned target missing after all pages shows not-available, no fallback', async () => {
    acting.value = { actingDriver: { driver_user_id: D }, isActingAsAssistant: true, isLoadingManagedDrivers: false };
    transport.bootstrap.mockImplementation(() => ok(boot([driverCtx()], { nextOffset: null })));
    render(<App />);
    expect(await screen.findByText('The AI assistant is not available for this driver.')).toBeInTheDocument();
    expect(screen.queryByText(/I can read your/)).toBeNull();
  });

  it('context pagination: Load more workspaces appends the next page and hides when complete', async () => {
    const extraCtx = { scope: 'agency', targetId: 'eeeeeeee-0000-4000-8000-000000000201', label: 'Local Agency', tools: ['packages'] };
    transport.bootstrap.mockImplementation((offset?: number) => ok(offset ? boot([extraCtx], { nextOffset: null }) : boot([driverCtx(), recruiterCtx], { contextsTruncated: true, nextOffset: 2 })));
    render(<App />);
    const more = await screen.findByRole('button', { name: 'Load more workspaces' });
    await act(async () => { fireEvent.click(more); });
    const select = screen.getByLabelText('AI assistant workspace') as HTMLSelectElement;
    await waitFor(() => expect(select.options).toHaveLength(3));
    expect(transport.bootstrap).toHaveBeenLastCalledWith(2);
    expect(screen.queryByRole('button', { name: 'Load more workspaces' })).toBeNull();
  });

  it('draft clears on explicit context switch, new conversation and opening a thread', async () => {
    transport.threads.mockImplementation(() => ok({ threads: [thread('th-1', 'Recent chat')], nextCursor: null }));
    transport.messages.mockImplementation(() => ok({ messages: [], nextCursor: null }));
    render(<App />);
    await screen.findByText(/I can read your/);
    fireEvent.change(input(), { target: { value: 'driver draft' } });
    fireEvent.change(screen.getByLabelText('AI assistant workspace'), { target: { value: `recruiter:${recruiterCtx.targetId}` } });
    expect(input().value).toBe('');
    fireEvent.change(input(), { target: { value: 'recruiter draft' } });
    fireEvent.click(within(screen.getByLabelText('Conversation history').parentElement!).getByRole('button', { name: /New conversation/ }));
    expect(input().value).toBe('');
    fireEvent.change(input(), { target: { value: 'another draft' } });
    await act(async () => { fireEvent.click(within(screen.getByLabelText('Conversation history')).getByText('Recent chat')); });
    expect(input().value).toBe('');
  });

  it('context switch while messages load does not leave loading stuck', async () => {
    const pend = deferred<any>();
    transport.threads.mockImplementation(() => ok({ threads: [thread('th-1', 'Recent chat')], nextCursor: null }));
    transport.messages.mockImplementation(() => pend.p);
    render(<App />);
    { const item = await within(await screen.findByLabelText('Conversation history')).findByText('Recent chat'); await act(async () => { fireEvent.click(item); }); }
    fireEvent.change(screen.getByLabelText('AI assistant workspace'), { target: { value: `recruiter:${recruiterCtx.targetId}` } });
    await act(async () => { pend.resolve({ ok: true, data: { messages: [reply('x', 'LATE')], nextCursor: null } }); });
    expect(screen.queryByText('LATE')).toBeNull();
    expect(await screen.findByText('Which of my opportunities were updated most recently?')).toBeInTheDocument();
  });

  it('deleting a previous thread while another is open keeps the current one; late delete does not clear it', async () => {
    const del = deferred<any>();
    transport.threads.mockImplementation(() => ok({ threads: [thread('th-1', 'First chat'), thread('th-2', 'Second chat')], nextCursor: null }));
    transport.messages.mockImplementation((id: string) => ok({ messages: [reply(`r-${id}`, `Reply of ${id}`)], nextCursor: null }));
    transport.deleteThread.mockImplementation(() => del.p);
    render(<App />);
    const aside = await screen.findByLabelText('Conversation history');
    await act(async () => { fireEvent.click(await within(aside).findByText('First chat')); });
    await screen.findByText('Reply of th-1');
    fireEvent.click(within(aside).getByRole('button', { name: 'Delete conversation First chat' }));
    await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete conversation' })); });
    await act(async () => { fireEvent.click(within(aside).getByText('Second chat')); });
    await screen.findByText('Reply of th-2');
    fireEvent.change(input(), { target: { value: 'keep me' } });
    await act(async () => { del.resolve({ ok: true, data: { deleted: true } }); });
    expect(screen.getByText('Reply of th-2')).toBeInTheDocument();
    expect(input().value).toBe('keep me');
    expect(within(aside).queryByText('First chat')).toBeNull();
  });

  it('clear history resets draft, sending and pending completions', async () => {
    const pending = deferred<any>();
    transport.threads.mockImplementation(() => ok({ threads: [thread('th-1', 'Recent chat')], nextCursor: null }));
    transport.send.mockImplementation(() => pending.p);
    transport.clear.mockImplementation(() => ok({ cleared: 1 }));
    render(<App />);
    await screen.findByText(/I can read your/);
    fireEvent.change(input(), { target: { value: 'In flight' } });
    await act(async () => { fireEvent.click(sendBtn()); });
    expect(screen.getByText('Thinking…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear history' })); });
    expect(screen.queryByText('Thinking…')).toBeNull();
    await act(async () => { pending.resolve({ ok: true, data: { threadId: 'th-9', reply: reply('m9', 'AFTER CLEAR') } }); });
    expect(screen.queryByText('AFTER CLEAR')).toBeNull(); expect(screen.queryByText('In flight')).toBeNull();
    expect(input().value).toBe('');
  });

  it('delete and clear failures show a safe notice and do not report success', async () => {
    transport.threads.mockImplementation(() => ok({ threads: [thread('th-1', 'Recent chat')], nextCursor: null }));
    transport.deleteThread.mockImplementation(() => ok({ deleted: false }));
    transport.clear.mockImplementation(() => Promise.resolve({ ok: false, status: 503, code: 'unavailable' }));
    render(<App />);
    const aside = await screen.findByLabelText('Conversation history');
    fireEvent.click(await within(aside).findByRole('button', { name: 'Delete conversation Recent chat' }));
    await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete conversation' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be deleted');
    expect(within(aside).getByText('Recent chat')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear history' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be cleared');
    expect(within(aside).getByText('Recent chat')).toBeInTheDocument();
  });

  it('load older keeps the viewport; duplicate concurrent older fetch is guarded; new reply scrolls to bottom', async () => {
    const older = deferred<any>();
    let height = 900;
    transport.threads.mockImplementation(() => ok({ threads: [thread('th-1', 'Recent chat')], nextCursor: null }));
    transport.messages.mockImplementation((_id: string, cursor: any) => cursor ? older.p : ok({ messages: [reply('m2', 'Newest reply')], nextCursor: { before: '2026-10-01T00:00:00Z', beforeId: 'b' } }));
    transport.send.mockImplementation(() => ok({ threadId: 'th-1', reply: reply('m3', 'Brand new reply') }));
    render(<App />);
    const t = screen.getByTestId('ai-transcript');
    Object.defineProperty(t, 'scrollHeight', { configurable: true, get: () => height });
    { const item = await within(await screen.findByLabelText('Conversation history')).findByText('Recent chat'); await act(async () => { fireEvent.click(item); }); }
    await screen.findByText('Newest reply');
    expect(t.scrollTop).toBe(900);
    t.scrollTop = 0; // reader scrolled to top
    const btn = screen.getByRole('button', { name: 'Load older messages' });
    fireEvent.click(btn); fireEvent.click(btn);
    expect(transport.messages).toHaveBeenCalledTimes(2);
    height = 1500;
    await act(async () => { older.resolve({ ok: true, data: { messages: [userMsg('m1', 'Older question')], nextCursor: null } }); });
    await screen.findByText('Older question');
    expect(t.scrollTop).toBe(600);
    height = 1800;
    fireEvent.change(input(), { target: { value: 'Next' } });
    await act(async () => { fireEvent.click(sendBtn()); });
    await screen.findByText('Brand new reply');
    expect(t.scrollTop).toBe(1800);
  });

  it('request ids: getRandomValues RFC 4122 v4 fallback; no secure source fails closed without sending', async () => {
    const real = globalThis.crypto;
    const fake = { getRandomValues: real.getRandomValues.bind(real) };
    vi.stubGlobal('crypto', fake);
    const ids = new Set(Array.from({ length: 50 }, () => newRequestId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    vi.stubGlobal('crypto', undefined);
    expect(() => newRequestId()).toThrow();
    render(<App />);
    await screen.findByText(/I can read your/);
    fireEvent.change(input(), { target: { value: 'No random' } });
    await act(async () => { fireEvent.click(sendBtn()); });
    expect(transport.send).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('temporarily unavailable');
    expect(input().value).toBe('No random');
    vi.unstubAllGlobals();
  });
});
