/**
 * Phase 1F-A.2.1A — Client cutover for server-authoritative terms.
 *
 * Cases 32-37 from the Stage 1F-A.2.1A test contract.
 * These tests verify the client can no longer forge or short-circuit
 * consent stamping. All actual privilege enforcement lives in the
 * database (see phase1fRecruiterPostingRuntime.test.ts). These cases
 * cover the client contract only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted supabase mock ---------------------------------------------------
type UpsertCall = { table: string; payload: Record<string, unknown>; opts: unknown };
type RpcCall = { fn: string; args: Record<string, unknown> };
const upsertCalls: UpsertCall[] = [];
const rpcCalls: RpcCall[] = [];
let upsertNextError: Error | null = null;
let rpcNextError: Error | null = null;
let rpcNextData: string | null = '2026-07-17T00:00:00Z';

vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => ({
    upsert: (payload: Record<string, unknown>, opts: unknown) => {
      upsertCalls.push({ table, payload, opts });
      const err = upsertNextError;
      upsertNextError = null;
      return Promise.resolve({ error: err });
    },
  });
  const rpc = (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    const err = rpcNextError;
    const data = rpcNextData;
    rpcNextError = null;
    return Promise.resolve({ data, error: err });
  };
  return { supabase: { from, rpc } };
});
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'client-user-1' } }),
}));
vi.mock('@/hooks/useAdmin', () => ({ useAdmin: () => ({ isAdmin: false }) }));

// Only useMutation surfaces are exercised; provide a lightweight stand-in
// so we don't need a real QueryClientProvider.
vi.mock('@tanstack/react-query', async () => {
  const useMutation = (opts: { mutationFn: (v: unknown) => Promise<unknown> }) => ({
    mutateAsync: (v: unknown) => opts.mutationFn(v),
    isPending: false,
  });
  const useQuery = () => ({ data: null, isLoading: false });
  const useQueryClient = () => ({ invalidateQueries: () => undefined });
  return { useMutation, useQuery, useQueryClient };
});
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useEffect: () => undefined };
});

// eslint-disable-next-line import/first
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

const baseData = {
  recruiter_name: 'Alice',
  recruiter_email: 'a@x.example',
  company_name: 'Acme',
  dot_number: '1234567',
} as const;

beforeEach(() => {
  upsertCalls.length = 0;
  rpcCalls.length = 0;
  upsertNextError = null;
  rpcNextError = null;
  rpcNextData = '2026-07-17T00:00:00Z';
});

describe('Phase 1F-A.2.1A client cutover', () => {
  it('32. saveRecruiterProfile upsert payload never contains posting_terms_* / legacy_terms_grandfathered_at', async () => {
    const hook = useRecruiterProfile();
    await hook.saveRecruiterProfile.mutateAsync({
      data: {
        ...baseData,
        // Even if a caller sneaks these in, the mutation must strip them.
        posting_terms_accepted_at: '2099-01-01T00:00:00Z',
        posting_terms_version: 'forged',
        legacy_terms_grandfathered_at: '2099-01-01T00:00:00Z',
      } as unknown as Parameters<typeof hook.saveRecruiterProfile.mutateAsync>[0]['data'],
      acceptTerms: true,
    });
    expect(upsertCalls.length).toBe(1);
    const p = upsertCalls[0].payload;
    expect(p).not.toHaveProperty('posting_terms_accepted_at');
    expect(p).not.toHaveProperty('posting_terms_version');
    expect(p).not.toHaveProperty('legacy_terms_grandfathered_at');
    expect(p.user_id).toBe('client-user-1');
  });

  it('33. legacy upsertProfile also strips protected columns', async () => {
    const hook = useRecruiterProfile();
    await hook.upsertProfile.mutateAsync({
      ...baseData,
      posting_terms_accepted_at: '2099-01-01T00:00:00Z',
      posting_terms_version: 'forged',
    } as unknown as Parameters<typeof hook.upsertProfile.mutateAsync>[0]);
    const p = upsertCalls[0].payload;
    expect(p).not.toHaveProperty('posting_terms_accepted_at');
    expect(p).not.toHaveProperty('posting_terms_version');
  });

  it('34. when acceptTerms=true, saveRecruiterProfile calls RPC with correct version', async () => {
    const hook = useRecruiterProfile();
    await hook.saveRecruiterProfile.mutateAsync({ data: { ...baseData }, acceptTerms: true });
    expect(rpcCalls.length).toBe(1);
    expect(rpcCalls[0].fn).toBe('accept_recruiter_posting_terms');
    expect(rpcCalls[0].args._version).toBe('2026-07-17.v1');
  });

  it('35. when acceptTerms=false, RPC is not called', async () => {
    const hook = useRecruiterProfile();
    const r = await hook.saveRecruiterProfile.mutateAsync({ data: { ...baseData }, acceptTerms: false });
    expect(rpcCalls.length).toBe(0);
    expect(r.acceptedAt).toBeNull();
  });

  it('36. upsert failure aborts mutation and RPC is never invoked', async () => {
    upsertNextError = new Error('upsert boom');
    const hook = useRecruiterProfile();
    await expect(
      hook.saveRecruiterProfile.mutateAsync({ data: { ...baseData }, acceptTerms: true }),
    ).rejects.toThrow(/boom/);
    expect(rpcCalls.length).toBe(0);
  });

  it('37. RPC failure surfaces as mutation error (no silent success)', async () => {
    rpcNextError = new Error('version mismatch');
    const hook = useRecruiterProfile();
    await expect(
      hook.saveRecruiterProfile.mutateAsync({ data: { ...baseData }, acceptTerms: true }),
    ).rejects.toThrow(/version mismatch/);
    expect(upsertCalls.length).toBe(1);
    expect(rpcCalls.length).toBe(1);
  });
});
