// Phase 1N-E4-A — Recruiter profile self-heal contract.
//
// Proves useRecruiterProfile()'s profileQuery.queryFn algorithm:
//   1. no user → null, no RPC
//   2. existing profile → single get_my_recruiter_profile_safe call, no self-heal
//   3. missing profile → get_my_recruiter_profile_safe → ensure_my_recruiter_setup_state({}) → get_my_recruiter_profile_safe
//   4. still missing after successful self-heal → null, no loop
//   5/6/7. errors on first-read / self-heal / second-read propagate exactly
//   8. self-heal RPC is invoked with exactly {} and no identity argument
//   9. unchanged normal hook contract (query key, no mutation on read path)

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ----- Mutable test controls -----
type RpcCall = { fn: string; args: unknown };
const rpcCalls: RpcCall[] = [];

interface RpcResult {
  data: unknown;
  error: Error | null;
}
// FIFO per-fn queue of scripted results.
const rpcQueue: Record<string, RpcResult[]> = {
  get_my_recruiter_profile_safe: [],
  ensure_my_recruiter_setup_state: [],
};

const authState = vi.hoisted(() => ({ userId: 'user-1' as string | null }));

vi.mock('@/integrations/supabase/client', () => {
  const rpc = (fn: string, args: unknown = undefined) => {
    rpcCalls.push({ fn, args });
    const q = rpcQueue[fn];
    const next = q && q.length ? q.shift()! : { data: null, error: null };
    return Promise.resolve(next);
  };
  const channel = () => {
    const ch = {
      on: () => ch,
      subscribe: () => ch,
    };
    return ch;
  };
  const removeChannel = () => {};
  return { supabase: { rpc, channel, removeChannel } };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authState.userId ? { id: authState.userId } : null }),
}));
vi.mock('@/hooks/useAdmin', () => ({ useAdmin: () => ({ isAdmin: false }) }));

// Import AFTER mocks are registered.
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { Wrapper, client };
}

function queueSafe(result: RpcResult) {
  rpcQueue.get_my_recruiter_profile_safe.push(result);
}
function queueHeal(result: RpcResult) {
  rpcQueue.ensure_my_recruiter_setup_state.push(result);
}

const PROFILE_ROW = {
  id: 'rp-1',
  user_id: 'user-1',
  recruiter_name: 'R',
  company_name: 'Co',
  recruiter_email: 'r@x.co',
  dot_number: '123',
  mc_number: null,
  status: 'active',
  verification_status: 'approved',
};

beforeEach(() => {
  rpcCalls.length = 0;
  rpcQueue.get_my_recruiter_profile_safe.length = 0;
  rpcQueue.ensure_my_recruiter_setup_state.length = 0;
  authState.userId = 'user-1';
});

describe('Phase 1N-E4-A — useRecruiterProfile self-heal', () => {
  it('1. no authenticated user → no RPC, hook stays disabled/null', async () => {
    authState.userId = null;
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRecruiterProfile(), { wrapper: Wrapper });
    // Query is disabled (enabled: !!user); give React a tick.
    await new Promise((r) => setTimeout(r, 20));
    expect(rpcCalls).toEqual([]);
    expect(result.current.profile).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('2. existing profile fast path — single safe read, no self-heal', async () => {
    queueSafe({ data: [PROFILE_ROW], error: null });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRecruiterProfile(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.profile).not.toBeNull());
    expect(result.current.profile?.id).toBe('rp-1');
    const fns = rpcCalls.map((c) => c.fn);
    expect(fns).toEqual(['get_my_recruiter_profile_safe']);
    expect(fns).not.toContain('ensure_my_recruiter_setup_state');
  });

  it('3. missing profile self-heals then re-reads', async () => {
    queueSafe({ data: [], error: null });
    queueHeal({ data: null, error: null });
    queueSafe({ data: [PROFILE_ROW], error: null });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRecruiterProfile(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.profile).not.toBeNull());
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      'get_my_recruiter_profile_safe',
      'ensure_my_recruiter_setup_state',
      'get_my_recruiter_profile_safe',
    ]);
    expect(result.current.profile?.id).toBe('rp-1');
  });

  it('4. still missing after successful self-heal → null, no loop', async () => {
    queueSafe({ data: [], error: null });
    queueHeal({ data: null, error: null });
    queueSafe({ data: [], error: null });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRecruiterProfile(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profile).toBeNull();
    // Exactly three calls in order; no third safe read.
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      'get_my_recruiter_profile_safe',
      'ensure_my_recruiter_setup_state',
      'get_my_recruiter_profile_safe',
    ]);
  });

  it('5. first safe-read error propagates; self-heal never called', async () => {
    const err = new Error('first-read-boom');
    queueSafe({ data: null, error: err });
    const { Wrapper, client } = makeWrapper();
    const { result } = renderHook(() => useRecruiterProfile(), { wrapper: Wrapper });
    await waitFor(() =>
      expect(client.getQueryState(['recruiter_profile', 'user-1'])?.status).toBe('error'),
    );
    expect(rpcCalls.map((c) => c.fn)).toEqual(['get_my_recruiter_profile_safe']);
    // Exact-identity cache error proof: the same Error object thrown by the
    // first safe-read reaches React Query's cache unmodified.
    expect(client.getQueryState(['recruiter_profile', 'user-1'])?.error).toBe(err);
    expect(result.current.profile).toBeNull();
  });

  it('6. self-heal error propagates; no second safe read', async () => {
    const err = new Error('heal-boom');
    queueSafe({ data: [], error: null });
    queueHeal({ data: null, error: err });
    const { Wrapper, client } = makeWrapper();
    const { result } = renderHook(() => useRecruiterProfile(), { wrapper: Wrapper });
    await waitFor(() =>
      expect(client.getQueryState(['recruiter_profile', 'user-1'])?.status).toBe('error'),
    );
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      'get_my_recruiter_profile_safe',
      'ensure_my_recruiter_setup_state',
    ]);
    expect(client.getQueryState(['recruiter_profile', 'user-1'])?.error).toBe(err);
    expect(result.current.profile).toBeNull();
  });

  it('7. second safe-read error propagates; call order remains exact', async () => {
    const err = new Error('second-read-boom');
    queueSafe({ data: [], error: null });
    queueHeal({ data: null, error: null });
    queueSafe({ data: null, error: err });
    const { Wrapper, client } = makeWrapper();
    const { result } = renderHook(() => useRecruiterProfile(), { wrapper: Wrapper });
    await waitFor(() =>
      expect(client.getQueryState(['recruiter_profile', 'user-1'])?.status).toBe('error'),
    );
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      'get_my_recruiter_profile_safe',
      'ensure_my_recruiter_setup_state',
      'get_my_recruiter_profile_safe',
    ]);
    expect(client.getQueryState(['recruiter_profile', 'user-1'])?.error).toBe(err);
    expect(result.current.profile).toBeNull();
  });

  it('8. self-heal RPC receives exactly {} and no identity argument', async () => {
    queueSafe({ data: [], error: null });
    queueHeal({ data: null, error: null });
    queueSafe({ data: [PROFILE_ROW], error: null });
    const { Wrapper } = makeWrapper();
    renderHook(() => useRecruiterProfile(), { wrapper: Wrapper });
    await waitFor(() =>
      expect(rpcCalls.some((c) => c.fn === 'ensure_my_recruiter_setup_state')).toBe(true),
    );
    const healCall = rpcCalls.find((c) => c.fn === 'ensure_my_recruiter_setup_state');
    expect(healCall).toBeDefined();
    expect(healCall!.args).toEqual({});
    const args = healCall!.args as Record<string, unknown>;
    expect(args).not.toHaveProperty('user_id');
    expect(args).not.toHaveProperty('id');
    expect(args).not.toHaveProperty('target');
    expect(args).not.toHaveProperty('_user_id');
    expect(Object.keys(args)).toHaveLength(0);
  });

  it('9. unchanged hook contract — query key, source shape, no mutation on read', async () => {
    // Source-level assertions: the query key and the safe-read primitive
    // remain the canonical read path; the query function does not invoke
    // any mutation helper (upsertProfile / saveRecruiterProfile / etc.).
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/hooks/opportunities/useRecruiterProfile.ts'),
      'utf8',
    );
    expect(src).toMatch(/queryKey:\s*\['recruiter_profile',\s*user\?\.id\]/);
    expect(src).toMatch(/get_my_recruiter_profile_safe/);
    expect(src).toMatch(/ensure_my_recruiter_setup_state/);

    // Behavior: existing-profile path returns the exact row shape and
    // does not call any mutation-style RPC (accept_recruiter_posting_terms).
    queueSafe({ data: [PROFILE_ROW], error: null });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRecruiterProfile(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.profile).not.toBeNull());
    expect(result.current.profile).toMatchObject(PROFILE_ROW);
    const fns = rpcCalls.map((c) => c.fn);
    expect(fns).not.toContain('accept_recruiter_posting_terms');
    expect(fns).not.toContain('ensure_my_recruiter_setup_state');
  });
});
