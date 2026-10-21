import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type { ConversationThread } from '@/hooks/conversations/useConversations';

const state = vi.hoisted(() => ({
  user: { id: 'driver-a' } as { id: string } | null,
  loading: false,
  acting: false,
  access: {} as Record<string, unknown>,
  profile: null as Record<string, unknown> | null,
  profileLoading: false,
  profileSuspended: false,
  canPost: true,
  profileCalls: 0,
  threads: [] as Record<string, unknown>[],
  messages: [] as Record<string, unknown>[],
  errorTable: '',
  calls: [] as { table: string; filters: [string, unknown][] }[],
  deferred: null as null | { table: string; promise: Promise<{ data: unknown; error: unknown }> },
  rpc: vi.fn(async () => ({ data: 'ok', error: null })),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: state.user, loading: state.loading, signOut: vi.fn() }) }));
vi.mock('@/hooks/useViewMode', () => ({ useViewMode: () => state.access }));
vi.mock('@/hooks/useActingContext', () => ({ useActingContext: () => ({ isActingAsAssistant: state.acting, isLoadingManagedDrivers: false }) }));
vi.mock('@/hooks/opportunities/useRecruiterProfile', () => ({ useRecruiterProfile: () => {
  state.profileCalls++;
  return { profile: state.profile, isLoading: state.profileLoading, isSuspended: state.profileSuspended, canPost: state.canPost };
} }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: state.rpc,
  from: (table: string) => {
    const filters: [string, unknown][] = [];
    let statuses: unknown[] | null = null;
    let limit = Infinity;
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
      in: (key: string, value: unknown[]) => { if (key === 'status') statuses = value; return chain; },
      order: (_key: string, _options: unknown) => chain,
      limit: (value: number) => { limit = value; return chain; },
      then: (done: (result: { data: unknown; error: unknown }) => unknown) => {
        state.calls.push({ table, filters: [...filters] });
        if (state.deferred?.table === table) return state.deferred.promise.then(done);
        const rows = table === 'conversation_threads' ? state.threads : table === 'conversation_messages' ? state.messages : [];
        const data = rows.filter(row => filters.every(([key, value]) => row[key] === value) && (!statuses || statuses.includes(row.status))).slice(0, limit);
        return Promise.resolve({ data, error: state.errorTable === table ? { message: 'private SQL detail' } : null }).then(done);
      },
    };
    return chain;
  },
} }));

import Conversations from '@/pages/Conversations';
import { AppSidebar } from '@/components/premium/AppSidebar';
import { BottomNav } from '@/components/BottomNav';
import { DriverConversationDialog } from '@/components/conversations/DriverConversationDialog';
import { RecruiterConversationInbox } from '@/components/conversations/RecruiterConversationInbox';
import { useDriverConversationThreads, useRecruiterConversationThreads, useConversationMessages, useDriverOpportunityConversation } from '@/hooks/conversations/useConversations';
import { conversationUrl, matchingConversation, validThreadId } from '@/lib/conversations/conversationNavigation';

const T1 = '00000000-0000-0000-0000-000000000001';
const T2 = '00000000-0000-0000-0000-000000000002';
const FOREIGN = '00000000-0000-0000-0000-000000000003';
function thread(id = T1, driver = 'driver-a', recruiter = 'recruiter-a', status = 'closed') {
  return { id, driver_user_id: driver, recruiter_id: recruiter, opportunity_id: 'opportunity-a', status, created_at: '2026-10-01', updated_at: '2026-10-21' } as unknown as ConversationThread;
}
function deferred() {
  let resolve: (result: { data: unknown; error: unknown }) => void = () => {};
  const promise = new Promise<{ data: unknown; error: unknown }>(done => { resolve = done; });
  return { promise, resolve };
}
function Location() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><span data-testid="location">{location.pathname}{location.search}</span><button onClick={() => navigate(-1)}>Browser Back</button></>;
}
function route(url = conversationUrl('driver')) {
  return render(<MemoryRouter initialEntries={[url]}><Location /><Conversations /></MemoryRouter>);
}
beforeEach(() => {
  cleanup();
  state.user = { id: 'driver-a' }; state.loading = false; state.acting = false;
  state.access = { effectiveRole: 'driver', isLoading: false, error: null, driverWorkspaceAllowed: true,
    recruiterAccessKind: 'capability', recruiterCapabilityStatus: 'active', recruiterOperationsAllowed: true };
  state.profile = { id: 'recruiter-a', user_id: 'driver-a' };
  state.profileLoading = false; state.profileSuspended = false; state.canPost = true; state.profileCalls = 0;
  state.threads = []; state.messages = []; state.errorTable = ''; state.calls = []; state.deferred = null; state.rpc.mockClear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('exact handoff identity and URL hints', () => {
  it('matches opportunity AND applicant AND known recruiter with multiple applicants', () => {
    const rows = [thread(T1, 'driver-a'), thread(T2, 'driver-b'), thread(FOREIGN, 'driver-b', 'other-recruiter')];
    expect(matchingConversation(rows, 'opportunity-a', 'driver-b', 'recruiter-a')?.id).toBe(T2);
    expect(matchingConversation(rows, 'opportunity-a', 'driver-a', 'other-recruiter')).toBeNull();
  });
  it('absent match and absent driver never hand off', () => {
    expect(matchingConversation([thread()], 'other-opportunity', 'driver-a')).toBeNull();
    expect(matchingConversation([thread()], 'opportunity-a', null)).toBeNull();
  });
  it('only optional UUID thread locators are included', () => {
    expect(conversationUrl('driver', T1)).toBe(`/conversations?workspace=driver&thread=${T1}`);
    expect(conversationUrl('recruiter', 'forged')).toBe('/conversations?workspace=recruiter');
    expect(validThreadId('')).toBe(false);
  });
});

describe('protected workspace page', () => {
  it.each(['setup', 'suspended', 'revoked', null])('denies owner status %s without mounting owner hooks or querying threads', status => {
    state.access.recruiterCapabilityStatus = status;
    route(conversationUrl('recruiter', T1));
    expect(screen.getByRole('status')).toHaveTextContent('unavailable');
    expect(state.profileCalls).toBe(0); expect(state.calls).toEqual([]);
  });
  it.each(['isLoading', 'error', 'recruiterOperationsAllowed', 'recruiterAccessKind'])('fails closed for %s', field => {
    state.access[field] = field === 'isLoading' ? true : field === 'error' ? new Error('private') : field === 'recruiterAccessKind' ? 'staff' : false;
    route(conversationUrl('recruiter'));
    expect(state.profileCalls).toBe(0); expect(state.calls).toEqual([]);
  });
  it('staff overlay active never becomes owner operations', () => {
    state.access.recruiterAccessKind = 'staff'; state.access.recruiterCapabilityStatus = null;
    route(conversationUrl('recruiter', T1));
    expect(state.profileCalls).toBe(0); expect(state.calls).toEqual([]);
  });
  it('acting assistant is blocked even with both personal capabilities', () => {
    state.acting = true; route(conversationUrl('driver', T1));
    expect(state.calls).toEqual([]); expect(screen.getByRole('status')).toHaveTextContent('unavailable');
  });
  it('unauthorized driver and unknown workspace do not query', () => {
    state.access.driverWorkspaceAllowed = false; route(conversationUrl('driver'));
    expect(state.calls).toEqual([]); cleanup(); route('/conversations?workspace=agency'); expect(state.calls).toEqual([]);
  });
  it.each(['loading', 'missing', 'suspended', 'not-ready', 'foreign-owner'])('owner profile %s cannot mount inbox', condition => {
    if (condition === 'loading') state.profileLoading = true;
    if (condition === 'missing') state.profile = null;
    if (condition === 'suspended') state.profileSuspended = true;
    if (condition === 'not-ready') state.canPost = false;
    if (condition === 'foreign-owner') state.profile = { id: 'recruiter-a', user_id: 'other' };
    route(conversationUrl('recruiter')); expect(state.calls).toEqual([]);
  });
  it('invalid thread locator never mounts conversation reads', () => {
    route('/conversations?workspace=driver&thread=invalid'); expect(state.calls).toEqual([]); expect(state.rpc).not.toHaveBeenCalled();
  });
  it('query survives same-thread selection, Back, and fresh mount; no start on navigation', async () => {
    state.threads = [thread()];
    const url = conversationUrl('driver', T1);
    route(url);
    await screen.findByTestId('driver-conversation-dialog');
    expect(screen.getByTestId('location')).toHaveTextContent(url);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/conversations?workspace=driver'));
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
    await screen.findByTestId('driver-conversation-dialog');
    expect(screen.getByTestId('location')).toHaveTextContent(url);
    cleanup(); route(url); await screen.findByTestId('driver-conversation-dialog');
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('dedicated owner includes closed history without mutation controls', async () => {
    state.threads = [thread()]; state.messages = [{ id: 'm1', thread_id: T1, sender_actor_type: 'driver', body: 'History' }];
    route(conversationUrl('recruiter', T1));
    await screen.findByText('History');
    expect(screen.queryByTestId('conversation-composer')).toBeNull();
    expect(screen.queryByTestId('conversation-accept')).toBeNull();
    expect(screen.queryByTestId('conversation-close')).toBeNull();
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe('desktop and mobile discovery', () => {
  it.each(['driver', 'recruiter'] as const)('desktop %s entry navigates to canonical role', role => {
    render(<MemoryRouter><Location /><AppSidebar active="dashboard" onNavigate={vi.fn()} role={role} recruiterCapabilityStatus="active" recruiterOperationsAllowed /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Conversations' }));
    expect(screen.getByTestId('location')).toHaveTextContent(conversationUrl(role)); expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each(['driver', 'recruiter'] as const)('mobile More %s entry navigates to canonical role', role => {
    render(<MemoryRouter><Location /><BottomNav active="dashboard" onNavigate={vi.fn()} role={role} recruiterCapabilityStatus="active" recruiterOperationsAllowed /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'More' })); fireEvent.click(screen.getByRole('button', { name: 'Conversations' }));
    expect(screen.getByTestId('location')).toHaveTextContent(conversationUrl(role)); expect(state.rpc).not.toHaveBeenCalled();
  });
  it('assistant sidebar and More never gain a chat permission', () => {
    render(<MemoryRouter><AppSidebar active="dashboard" onNavigate={vi.fn()} role="driver" assistantPermissions={{}} /><BottomNav active="dashboard" onNavigate={vi.fn()} role="driver" assistantPermissions={{}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'More' })); expect(screen.queryByRole('button', { name: 'Conversations' })).toBeNull();
  });
  it.each(['setup', 'suspended', 'revoked'] as const)('nonoperational recruiter %s has no chat navigation', status => {
    render(<MemoryRouter><AppSidebar active="dashboard" onNavigate={vi.fn()} role="recruiter" recruiterCapabilityStatus={status} /><BottomNav active="dashboard" onNavigate={vi.fn()} role="recruiter" recruiterCapabilityStatus={status} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'More' })); expect(screen.queryByRole('button', { name: 'Conversations' })).toBeNull();
  });
});

describe('identity-bound lists and messages', () => {
  it('driver explicitly filters its identity and includes terminal history', async () => {
    state.threads = [thread(), thread(T2, 'driver-b')];
    const hook = renderHook(() => useDriverConversationThreads(true));
    await waitFor(() => expect(hook.result.current.threads).toHaveLength(1));
    expect(hook.result.current.threads[0].status).toBe('closed');
    expect(state.calls.find(c => c.table === 'conversation_threads')?.filters).toContainEqual(['driver_user_id', 'driver-a']);
  });
  it('auth A to B synchronously hides list before effects and late A is ignored', async () => {
    state.threads = [thread()]; const seen: string[][] = [];
    const hook = renderHook(() => { const result = useDriverConversationThreads(true); seen.push(result.threads.map(t => t.id)); return result; });
    await waitFor(() => expect(hook.result.current.threads).toHaveLength(1));
    const late = deferred(); state.deferred = { table: 'conversation_threads', promise: late.promise };
    act(() => hook.result.current.refetch());
    await waitFor(() => expect(state.calls.filter(c => c.table === 'conversation_threads')).toHaveLength(2));
    state.deferred = null; state.user = { id: 'driver-b' }; state.threads = [thread(T2, 'driver-b')]; const index = seen.length;
    hook.rerender(); expect(seen[index]).toEqual([]);
    await waitFor(() => expect(hook.result.current.threads[0]?.id).toBe(T2));
    await act(async () => late.resolve({ data: [thread()], error: null }));
    expect(hook.result.current.threads.map(t => t.id)).toEqual([T2]);
  });
  it('recruiter workspace changes synchronously hide rows and ignore late old workspace', async () => {
    state.threads = [thread()];
    const hook = renderHook(({ id }) => useRecruiterConversationThreads(id, true, true), { initialProps: { id: 'recruiter-a' } });
    await waitFor(() => expect(hook.result.current.threads).toHaveLength(1));
    const late = deferred(); state.deferred = { table: 'conversation_threads', promise: late.promise };
    act(() => hook.result.current.refetch()); await waitFor(() => expect(state.calls.filter(c => c.table === 'conversation_threads')).toHaveLength(2));
    state.deferred = null; state.threads = [thread(T2, 'driver-a', 'recruiter-b')]; hook.rerender({ id: 'recruiter-b' });
    expect(hook.result.current.threads).toEqual([]); await waitFor(() => expect(hook.result.current.threads[0]?.id).toBe(T2));
    await act(async () => late.resolve({ data: [thread()], error: null })); expect(hook.result.current.threads[0]?.id).toBe(T2);
  });
  it('disabled list clears synchronously and no polling persists after unmount', async () => {
    state.threads = [thread()]; const hook = renderHook(({ enabled }) => useDriverConversationThreads(enabled), { initialProps: { enabled: true } });
    await waitFor(() => expect(hook.result.current.threads).toHaveLength(1)); hook.rerender({ enabled: false });
    expect(hook.result.current.threads).toEqual([]); hook.unmount(); const count = state.calls.length;
    vi.useFakeTimers(); await act(async () => { vi.advanceTimersByTime(10000); }); vi.useRealTimers(); expect(state.calls).toHaveLength(count);
  });
  it('late list completion after unmount does not fetch titles or update', async () => {
    const late = deferred(); state.deferred = { table: 'conversation_threads', promise: late.promise };
    const hook = renderHook(() => useDriverConversationThreads(true)); await waitFor(() => expect(state.calls).toHaveLength(1)); hook.unmount();
    await act(async () => late.resolve({ data: [thread()], error: null })); expect(state.calls.map(c => c.table)).toEqual(['conversation_threads']);
  });
  it('thread switch hides prior messages synchronously and ignores late prior read', async () => {
    state.messages = [{ id: 'm1', thread_id: T1, body: 'Old' }];
    const hook = renderHook(({ id }) => useConversationMessages(id, true), { initialProps: { id: T1 } });
    await waitFor(() => expect(hook.result.current.messages).toHaveLength(1));
    const late = deferred(); state.deferred = { table: 'conversation_messages', promise: late.promise }; act(() => hook.result.current.refetch());
    await waitFor(() => expect(state.calls).toHaveLength(2));
    state.deferred = null; state.messages = [{ id: 'm2', thread_id: T2, body: 'New' }]; hook.rerender({ id: T2 });
    expect(hook.result.current.messages).toEqual([]); await waitFor(() => expect(hook.result.current.messages[0]?.id).toBe('m2'));
    await act(async () => late.resolve({ data: [{ id: 'm1', body: 'Old' }], error: null })); expect(hook.result.current.messages[0]?.id).toBe('m2');
  });
  it('message errors are controlled and never expose backend detail', async () => {
    state.errorTable = 'conversation_messages'; const hook = renderHook(() => useConversationMessages(T1, true));
    await waitFor(() => expect(hook.result.current.error).toBe('Unable to load messages.')); expect(hook.result.current.messages).toEqual([]);
  });
});

describe('exact existing mode versus opportunity start mode', () => {
  it.each(['missing', 'foreign', 'invalid'])('%s exact thread never composes, fetches messages, or starts', async condition => {
    state.threads = condition === 'foreign' ? [thread(T1, 'driver-b')] : [];
    render(<DriverConversationDialog open onOpenChange={vi.fn()} opportunityId="opportunity-a" opportunityTitle="Opportunity" existingThreadId={condition === 'invalid' ? 'bad' : T1} />);
    await screen.findByText('Conversation unavailable.'); expect(screen.queryByRole('textbox')).toBeNull();
    expect(state.calls.filter(c => c.table === 'conversation_messages')).toEqual([]); expect(state.rpc).not.toHaveBeenCalled();
  });
  it('terminal exact thread reads history but cannot send or start', async () => {
    state.threads = [thread()]; state.messages = [{ id: 'm1', thread_id: T1, sender_actor_type: 'recruiter', body: 'Closed history' }];
    render(<DriverConversationDialog open onOpenChange={vi.fn()} opportunityId="opportunity-a" opportunityTitle="Opportunity" existingThreadId={T1} />);
    await screen.findByText('Closed history'); expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Conversations' })).toHaveAttribute('href', conversationUrl('driver', T1)); expect(state.rpc).not.toHaveBeenCalled();
  });
  it('opportunity mode still starts through unchanged RPC', async () => {
    render(<DriverConversationDialog open onOpenChange={vi.fn()} opportunityId="opportunity-a" opportunityTitle="Opportunity" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start Conversation' }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith('start_opportunity_conversation', expect.objectContaining({ _opportunity_id: 'opportunity-a' })));
  });
  it('exact hook refuses programmatic start even if no thread exists', async () => {
    const hook = renderHook(() => useDriverOpportunityConversation('opportunity-a', true, T1));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    await act(async () => { await expect(hook.result.current.startConversation('Do not create')).rejects.toThrow('unavailable'); }); expect(state.rpc).not.toHaveBeenCalled();
  });
  it('unverified driver query selection never fetches messages', async () => {
    state.threads = [thread(T2)]; route(conversationUrl('driver', T1));
    await screen.findByText('Conversation unavailable.'); expect(state.calls.filter(c => c.table === 'conversation_messages')).toEqual([]); expect(state.rpc).not.toHaveBeenCalled();
  });
  it('recruiter thread switching clears draft and old messages', async () => {
    state.threads = [thread(T1, 'driver-a', 'recruiter-a', 'active'), thread(T2, 'driver-b', 'recruiter-a', 'active')];
    state.messages = [{ id: 'm1', thread_id: T1, sender_actor_type: 'driver', body: 'First thread' }];
    const view = render(<RecruiterConversationInbox recruiterId="recruiter-a" canView canReply includeHistory selectedThreadId={T1} />);
    await screen.findByText('First thread'); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First draft' } });
    state.messages = [{ id: 'm2', thread_id: T2, sender_actor_type: 'driver', body: 'Second thread' }];
    view.rerender(<RecruiterConversationInbox recruiterId="recruiter-a" canView canReply includeHistory selectedThreadId={T2} />);
    expect(screen.getByRole('textbox')).toHaveValue(''); expect(screen.queryByText('First thread')).toBeNull(); await screen.findByText('Second thread');
  });
  it('recruiter foreign selection never mounts messages or mutation controls', async () => {
    state.threads = [thread()]; render(<RecruiterConversationInbox recruiterId="recruiter-a" canView canReply includeHistory selectedThreadId={FOREIGN} />);
    await screen.findByText('Conversation unavailable.'); expect(state.calls.filter(c => c.table === 'conversation_messages')).toEqual([]); expect(state.rpc).not.toHaveBeenCalled();
  });
  it('view-only inbox reads without reply controls, denied inbox reads nothing', async () => {
    state.threads = [thread(T1, 'driver-a', 'recruiter-a', 'active')];
    const view = render(<RecruiterConversationInbox recruiterId="recruiter-a" canView canReply={false} includeHistory selectedThreadId={T1} />);
    await screen.findByTestId('conversation-thread-detail'); expect(screen.queryByRole('textbox')).toBeNull();
    state.calls = []; view.rerender(<RecruiterConversationInbox recruiterId="recruiter-a" canView={false} canReply includeHistory selectedThreadId={T1} />);
    expect(screen.queryByTestId('conversation-thread-detail')).toBeNull(); expect(state.calls).toEqual([]);
  });
});
