import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { createIdempotencyStore } from '@/lib/opportunities/submissionIdempotency';

// ---- Pure store (used by legacy façade only) ----

describe('createIdempotencyStore — legacy façade stability', () => {
  it('same slot reuses reserved key until released', () => {
    let n = 0;
    const store = createIdempotencyStore(() => `gen-${++n}`);
    const k1 = store.acquire('request_info', 'opp-1');
    const k2 = store.acquire('request_info', 'opp-1');
    expect(k1).toBe('gen-1');
    expect(k2).toBe('gen-1');
    store.release('request_info', 'opp-1');
    const k3 = store.acquire('request_info', 'opp-1');
    expect(k3).toBe('gen-2');
  });

  it('caller-supplied key ≥ 8 chars is preserved and not tracked', () => {
    const store = createIdempotencyStore(() => 'GEN');
    const caller = 'caller-key-abc-123';
    expect(store.acquire('request_info', 'opp-1', caller)).toBe(caller);
    expect(store.size()).toBe(0);
  });
});

// ---- Hook: idempotency_key REQUIRED for dedicated mutations ----

const rpcCalls: Array<{ fn: string; args: any }> = [];
const rpcResponses: Array<{ data?: any; error?: any }> = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      const next = rpcResponses.shift() ?? {
        data: [{ application_id: 'a', application_status: 'new', result_code: 'created' }],
      };
      return Promise.resolve(next);
    },
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    }),
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'driver-user-1' } }),
}));

import { useOpportunityApplications } from '@/hooks/opportunities/useOpportunityApplications';

function makeWrapper(mutationRetry = 0) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: mutationRetry, retryDelay: 0 },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function reset() {
  rpcCalls.length = 0;
  rpcResponses.length = 0;
}

const applyArgs = (opp: string, key: string) => ({
  opportunity_id: opp,
  idempotency_key: key,
  message: null,
  availability_confirmed: true,
  requirements_confirmed: true,
  truth_attestation: true,
  preferred_contact_method: 'email' as const,
  contact_sharing_consent: false,
});

describe('useOpportunityApplications — required caller idempotency_key contract', () => {
  it('React Query retry reuses the caller-supplied idempotency_key verbatim', async () => {
    reset();
    rpcResponses.push({ data: null, error: { message: 'transient' } });
    rpcResponses.push({
      data: [{ application_id: 'a1', application_status: 'new', result_code: 'created' }],
    });
    const wrapper = makeWrapper(1);
    const { result } = renderHook(() => useOpportunityApplications(), { wrapper });
    const callerKey = 'caller-reapply-attempt-42';
    await act(async () => {
      await result.current.submitApplication.mutateAsync(applyArgs('opp-1', callerKey));
    });
    expect(rpcCalls.length).toBe(2);
    expect(rpcCalls[0].args._idempotency_key).toBe(callerKey);
    expect(rpcCalls[1].args._idempotency_key).toBe(callerKey);
  });

  it('same caller key replays; a new caller key creates a new formal application', async () => {
    reset();
    // First attempt: created (later becomes rejected server-side).
    rpcResponses.push({
      data: [{ application_id: 'a1', application_status: 'new', result_code: 'created' }],
    });
    // Reapply with SAME key → server returns idempotent_replay (still success).
    rpcResponses.push({
      data: [{ application_id: 'a1', application_status: 'rejected', result_code: 'idempotent_replay' }],
    });
    // Reapply with NEW key after rejection → new row created.
    rpcResponses.push({
      data: [{ application_id: 'a2', application_status: 'new', result_code: 'created' }],
    });
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useOpportunityApplications(), { wrapper });

    const keyA = 'submission-attempt-A-key';
    const keyB = 'submission-attempt-B-key';

    await act(async () => {
      await result.current.submitApplication.mutateAsync(applyArgs('opp-1', keyA));
    });
    await act(async () => {
      await result.current.submitApplication.mutateAsync(applyArgs('opp-1', keyA));
    });
    await act(async () => {
      await result.current.submitApplication.mutateAsync(applyArgs('opp-1', keyB));
    });
    await waitFor(() => expect(rpcCalls.length).toBe(3));

    expect(rpcCalls[0].args._idempotency_key).toBe(keyA);
    expect(rpcCalls[1].args._idempotency_key).toBe(keyA);
    expect(rpcCalls[2].args._idempotency_key).toBe(keyB);
    expect(rpcCalls[0].args._idempotency_key).not.toBe(rpcCalls[2].args._idempotency_key);
  });

  it('submitApplication rejects a missing/short caller key without touching the RPC', async () => {
    reset();
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useOpportunityApplications(), { wrapper });
    await expect(
      result.current.submitApplication.mutateAsync(applyArgs('opp-1', 'short')),
    ).rejects.toThrow(/submission_failed:invalid_input/);
    expect(rpcCalls.length).toBe(0);
  });

  it('submitRequestInfo passes caller key verbatim and rejects short keys client-side', async () => {
    reset();
    rpcResponses.push({
      data: [{ application_id: 'r1', application_status: 'new', result_code: 'created' }],
    });
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useOpportunityApplications(), { wrapper });
    const callerKey = 'inquiry-key-abcdef-01';
    await act(async () => {
      await result.current.submitRequestInfo.mutateAsync({
        opportunity_id: 'opp-9',
        idempotency_key: callerKey,
        question: 'Can you share details?',
        preferred_contact_method: 'email',
        contact_sharing_consent: false,
      });
    });
    expect(rpcCalls[0].args._idempotency_key).toBe(callerKey);

    await expect(
      result.current.submitRequestInfo.mutateAsync({
        opportunity_id: 'opp-9',
        idempotency_key: 'x',
        question: 'q',
        preferred_contact_method: 'email',
        contact_sharing_consent: false,
      }),
    ).rejects.toThrow(/submission_failed:invalid_input/);
    expect(rpcCalls.length).toBe(1);
  });

  it('legacy createApplication request_info retains one stable generated key per opportunity', async () => {
    reset();
    rpcResponses.push({
      data: [{ application_id: 'r1', application_status: 'new', result_code: 'created' }],
    });
    rpcResponses.push({
      data: [{ application_id: 'r1', application_status: 'new', result_code: 'idempotent_replay' }],
    });
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useOpportunityApplications(), { wrapper });

    await act(async () => {
      await result.current.createApplication.mutateAsync({
        opportunity_id: 'opp-legacy',
        recruiter_id: 'r',
        application_type: 'request_info',
        message: 'legacy question',
      } as any);
    });
    await act(async () => {
      await result.current.createApplication.mutateAsync({
        opportunity_id: 'opp-legacy',
        recruiter_id: 'r',
        application_type: 'request_info',
        message: 'legacy question',
      } as any);
    });
    expect(rpcCalls.length).toBe(2);
    expect(rpcCalls[0].args._idempotency_key).toBe(rpcCalls[1].args._idempotency_key);
  });

  it('legacy createApplication fails closed for apply / unknown / callback types', async () => {
    reset();
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useOpportunityApplications(), { wrapper });
    await expect(
      result.current.createApplication.mutateAsync({
        opportunity_id: 'opp-1',
        recruiter_id: 'r',
        application_type: 'apply',
      } as any),
    ).rejects.toThrow(/Formal apply requires the submitApplication mutation/);
    await expect(
      result.current.createApplication.mutateAsync({
        opportunity_id: 'opp-1',
        recruiter_id: 'r',
        application_type: 'callback',
      } as any),
    ).rejects.toThrow(/Unsupported application_type: callback/);
    await expect(
      result.current.createApplication.mutateAsync({
        opportunity_id: 'opp-1',
        recruiter_id: 'r',
        application_type: 'whatever',
      } as any),
    ).rejects.toThrow(/Unsupported application_type: whatever/);
    expect(rpcCalls.length).toBe(0);
  });
});
