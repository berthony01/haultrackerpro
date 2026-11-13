import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useConversationMessages,
  useDriverConversationThreads,
  useDriverOpportunityConversation,
  useRecruiterConversationThreads,
} from '@/hooks/conversations/useConversations';

type Result = { data: unknown[]; error: unknown };
const state = vi.hoisted(() => ({
  userId: 'driver-1' as string | null,
  requests: [] as { table: string; resolve: (result: Result) => void }[],
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: state.userId ? { id: state.userId } : null }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: vi.fn(),
  from: (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const key of ['select', 'eq', 'in', 'order', 'limit']) chain[key] = () => chain;
    chain.then = (done: (result: Result) => unknown) => new Promise<Result>(resolve => {
      state.requests.push({ table, resolve });
    }).then(done);
    return chain;
  },
} }));

async function settle(data: unknown[] = [], error: unknown = null) {
  await act(async () => {
    const request = state.requests.shift();
    if (!request) throw new Error('Expected a pending read');
    request.resolve({ data, error });
  });
}

beforeEach(() => { vi.useFakeTimers(); state.userId = 'driver-1'; state.requests = []; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('conversation initial loading versus five-second background polling', () => {
  const cases: ReadonlyArray<readonly [string, () => { isLoading: boolean; error: string | null }]> = [
    ['driver inbox', () => useDriverConversationThreads(true)],
    ['recruiter inbox', () => useRecruiterConversationThreads('rec-1', true)],
    ['messages', () => useConversationMessages('thread-1', true)],
    ['driver dialog', () => useDriverOpportunityConversation('opp-1', true)],
  ];

  it.each(cases)('%s keeps its loaded empty snapshot during three polls', async (_name, hook) => {
    const { result } = renderHook(hook);
    expect(result.current.isLoading).toBe(true);
    await act(async () => {});
    await settle();
    expect(result.current.isLoading).toBe(false);
    for (let poll = 0; poll < 3; poll += 1) {
      await act(async () => { vi.advanceTimersByTime(5000); });
      expect(state.requests).toHaveLength(1);
      expect(result.current.isLoading).toBe(false);
      await settle();
      expect(result.current.isLoading).toBe(false);
    }
  });

  it.each(cases)('%s clears previous scope and ignores cancelled reads on identity change', async (_name, hook) => {
    const { result, rerender } = renderHook(hook);
    await act(async () => {});
    await settle();
    await act(async () => { vi.advanceTimersByTime(5000); });
    state.userId = 'driver-2';
    rerender();
    expect(result.current.isLoading).toBe(true);
    await settle([{ id: 'stale', driver_user_id: 'driver-1' }]);
    expect(result.current.isLoading).toBe(true);
    await settle();
    expect(result.current.isLoading).toBe(false);
    state.userId = null;
    rerender();
    expect(result.current.isLoading).toBe(false);
    await act(async () => { vi.advanceTimersByTime(15000); });
    expect(state.requests).toHaveLength(0);
  });

  it.each(cases)('%s reports a generic refresh failure and recovers on the next poll', async (_name, hook) => {
    const { result } = renderHook(hook);
    await act(async () => {});
    await settle();
    await act(async () => { vi.advanceTimersByTime(5000); });
    await settle([], new Error('SECRET other-driver@example.com'));
    expect(result.current.error).toMatch(/^Unable to load/);
    expect(result.current.error).not.toContain('SECRET');
    expect(result.current.error).not.toContain('other-driver');
    expect(result.current.isLoading).toBe(false);
    await act(async () => { vi.advanceTimersByTime(5000); });
    await settle();
    expect(result.current.error).toBeNull();
  });

  it('new threads and messages arrive through unchanged polling', async () => {
    const { result } = renderHook(() => useDriverConversationThreads(true));
    await act(async () => {});
    await settle();
    await act(async () => { vi.advanceTimersByTime(5000); });
    await settle([{ id: 'thread-1', driver_user_id: 'driver-1', opportunity_id: null, status: 'active' }]);
    expect(result.current.threads.map(thread => thread.id)).toEqual(['thread-1']);
    const messages = renderHook(() => useConversationMessages('thread-1', true));
    await act(async () => {});
    await settle();
    act(() => messages.result.current.refetch());
    await act(async () => {});
    expect(messages.result.current.isLoading).toBe(false);
    await settle([{ id: 'msg-1', body: 'New reply' }]);
    expect(messages.result.current.messages.map(message => message.body)).toEqual(['New reply']);
  });

  it('changing recruiter workspace requires a fresh snapshot', async () => {
    const { result, rerender } = renderHook(({ recruiterId }) => useRecruiterConversationThreads(recruiterId, true), {
      initialProps: { recruiterId: 'rec-1' },
    });
    await act(async () => {});
    await settle([{ id: 'old-thread', recruiter_id: 'rec-1', opportunity_id: null }]);
    expect(result.current.threads).toHaveLength(1);
    rerender({ recruiterId: 'rec-2' });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.threads).toEqual([]);
    await act(async () => {});
    await settle();
    expect(result.current.isLoading).toBe(false);
  });
});