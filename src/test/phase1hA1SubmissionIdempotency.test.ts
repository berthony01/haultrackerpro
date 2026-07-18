import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { createIdempotencyStore } from '@/lib/opportunities/submissionIdempotency';

// ---- Pure store: attempt-scoped stability, caller-key preservation ----

describe('createIdempotencyStore — attempt-scoped stability', () => {
  it('retry within the same in-flight attempt reuses the reserved key', () => {
    let n = 0;
    const store = createIdempotencyStore(() => `gen-${++n}`);
    const k1 = store.acquire('apply', 'opp-1');
    const k2 = store.acquire('apply', 'opp-1'); // simulated React Query retry
    expect(k1).toBe('gen-1');
    expect(k2).toBe('gen-1');
    expect(store.size()).toBe(1);
  });

  it('a new submission attempt after settlement gets a fresh key', () => {
    let n = 0;
    const store = createIdempotencyStore(() => `gen-${++n}`);
    const first = store.acquire('apply', 'opp-1');
    store.release('apply', 'opp-1');
    const second = store.acquire('apply', 'opp-1');
    expect(first).toBe('gen-1');
    expect(second).toBe('gen-2');
    expect(first).not.toBe(second);
  });

  it('scopes keys per (kind, opportunity_id)', () => {
    let n = 0;
    const store = createIdempotencyStore(() => `gen-${++n}`);
    const a = store.acquire('apply', 'opp-1');
    const b = store.acquire('request_info', 'opp-1');
    const c = store.acquire('apply', 'opp-2');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('caller-provided key is preserved exactly and not tracked', () => {
    let n = 0;
    const store = createIdempotencyStore(() => `gen-${++n}`);
    const caller = 'caller-key-abc-123';
    const k = store.acquire('apply', 'opp-1', caller);
    expect(k).toBe(caller);
    expect(store.size()).toBe(0);
    // Releasing with the same caller key must not evict a concurrently
    // generated reservation for the same slot.
    const gen = store.acquire('apply', 'opp-1');
    store.release('apply', 'opp-1', caller);
    expect(store.acquire('apply', 'opp-1')).toBe(gen);
  });

  it('caller key shorter than 8 chars is ignored (falls back to generated)', () => {
    const store = createIdempotencyStore(() => 'GEN');
    expect(store.acquire('apply', 'opp-1', 'short')).toBe('GEN');
  });
});

// ---- Hook: retry reuses key, next attempt gets a fresh key, fail-closed types ----

const rpcCalls: Array<{ fn: string; args: any }> = [];
const rpcResponses: Array<{ data?: any; error?: any }> = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      const next = rpcResponses.shift() ?? { data: [{ application_id: 'a', application_status: 'new', result_code: 'created' }] };
      return Promise.resolve(next);
    },
    from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }),
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'driver-user-1' } }),
}));

import { useOpportunityApplications } from '@/hooks/opportunities/useOpportunityApplications';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function reset() {
  rpcCalls.length = 0;
  rpcResponses.length = 0;
}

describe('useOpportunityApplications — submission-attempt-scoped idempotency', () => {
  it('React Query retry reuses the same idempotency key within one attempt', async () => {
    reset();
    // First call: transient error → triggers a retry; second call: created.
    rpcResponses.push({ data: null, error: { message: 'transient' } });
    rpcResponses.push({ data: [{ application_id: 'a1', application_status: 'new', result_code: 'created' }] });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 1, retryDelay: 0 } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useOpportunityApplications(), { wrapper });

    await act(async () => {
      await result.current.submitApplication.mutateAsync({
        opportunity_id: 'opp-1',
        message: null,
        availability_confirmed: true,
        requirements_confirmed: true,
        truth_attestation: true,
        preferred_contact_method: 'email',
        contact_sharing_consent: false,
      });
    });

    expect(rpcCalls.length).toBe(2);
    expect(rpcCalls[0].args._idempotency_key).toBe(rpcCalls[1].args._idempotency_key);
  });

  it('a new submission attempt after settlement gets a fresh idempotency key', async () => {
    reset();
    rpcResponses.push({ data: [{ application_id: 'a1', application_status: 'rejected', result_code: 'created' }] });
    rpcResponses.push({ data: [{ application_id: 'a2', application_status: 'new', result_code: 'created' }] });

    const wrapper = makeWrapper();
    const { result } = renderHook(() => useOpportunityApplications(), { wrapper });

    await act(async () => {
      await result.current.submitApplication.mutateAsync({
        opportunity_id: 'opp-1',
        message: null,
        availability_confirmed: true,
        requirements_confirmed: true,
        truth_attestation: true,
        preferred_contact_method: 'email',
        contact_sharing_consent: false,
      });
    });
    // Wait for onSettled to run (React Query settles after mutateAsync resolves,
    // but onSettled fires synchronously in the same tick — assert on next mutate).
    await waitFor(() => expect(rpcCalls.length).toBe(1));

    await act(async () => {
      await result.current.submitApplication.mutateAsync({
        opportunity_id: 'opp-1',
        message: null,
        availability_confirmed: true,
        requirements_confirmed: true,
        truth_attestation: true,
        preferred_contact_method: 'email',
        contact_sharing_consent: false,
      });
    });

    expect(rpcCalls.length).toBe(2);
    expect(rpcCalls[0].args._idempotency_key).not.toBe(rpcCalls[1].args._idempotency_key);
  });

  it('caller-provided idempotency_key is passed to the RPC verbatim', async () => {
    reset();
    rpcResponses.push({ data: [{ application_id: 'a1', application_status: 'new', result_code: 'created' }] });
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useOpportunityApplications(), { wrapper });

    const callerKey = 'caller-supplied-idem-key-42';
    await act(async () => {
      await result.current.submitApplication.mutateAsync({
        opportunity_id: 'opp-9',
        idempotency_key: callerKey,
        message: null,
        availability_confirmed: true,
        requirements_confirmed: true,
        truth_attestation: true,
        preferred_contact_method: 'email',
        contact_sharing_consent: false,
      });
    });
    expect(rpcCalls[0].args._idempotency_key).toBe(callerKey);
  });

  it('legacy createApplication fails closed for application_type = "apply"', async () => {
    reset();
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useOpportunityApplications(), { wrapper });
    await expect(
      result.current.createApplication.mutateAsync({
        opportunity_id: 'opp-1',
        recruiter_id: 'r',
        application_type: 'apply' as any,
      } as any),
    ).rejects.toThrow(/Formal apply requires the submitApplication mutation/);
    expect(rpcCalls.length).toBe(0);
  });

  it('legacy createApplication fails closed for unknown application_type', async () => {
    reset();
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useOpportunityApplications(), { wrapper });
    await expect(
      result.current.createApplication.mutateAsync({
        opportunity_id: 'opp-1',
        recruiter_id: 'r',
        application_type: 'callback' as any,
      } as any),
    ).rejects.toThrow(/Unsupported application_type: callback/);
    expect(rpcCalls.length).toBe(0);
  });
});
