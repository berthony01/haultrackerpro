import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'driver-a' } as { id: string } | null, loading: false },
  rpc: vi.fn(), invalidateQueries: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => queryClient }));
const queryClient = { invalidateQueries: mocks.invalidateQueries };
import { useRoleIntentReconciler } from '@/hooks/useRoleIntentReconciler';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth = { user: { id: 'driver-a' }, loading: false };
  mocks.rpc.mockResolvedValue({ data: { applied: true }, error: null });
  sessionStorage.clear();
  window.history.replaceState({}, '', '/dashboard');
});
afterEach(cleanup);

describe('explicit recruiter intent reconciliation', () => {
  it.each([null, 'driver', 'assistant', 'agency', 'unknown', 'Recruiter'])('never calls RPC for stored intent %s', async intent => {
    if (intent !== null) sessionStorage.setItem('htp_auth_intent', intent);
    renderHook(useRoleIntentReconciler);
    await act(async () => {});
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['driver', 'assistant', 'agency', 'unknown', 'Recruiter'])('never calls RPC for URL intent %s', async intent => {
    window.history.replaceState({}, '', `/dashboard?intent=${intent}`);
    renderHook(useRoleIntentReconciler);
    await act(async () => {});
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['stored', 'url'])('reconciles explicit %s recruiter intent once, then safely cleans its hint', async source => {
    if (source === 'stored') sessionStorage.setItem('htp_auth_intent', 'recruiter');
    else window.history.replaceState({}, '', '/dashboard?intent=recruiter&next=%2Frecruiter#keep');
    const { rerender } = renderHook(useRoleIntentReconciler);
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2));
    mocks.auth = { ...mocks.auth, user: { id: 'driver-a' } };
    rerender();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('apply_recruiter_intent');
    expect(sessionStorage.getItem('htp_auth_intent')).toBeNull();
    expect(new URLSearchParams(window.location.search).get('intent')).toBeNull();
    if (source === 'url') {
      expect(new URLSearchParams(window.location.search).get('next')).toBe('/recruiter');
      expect(window.location.hash).toBe('#keep');
    }
  });
  it('waits for settled authentication', async () => {
    sessionStorage.setItem('htp_auth_intent', 'recruiter');
    mocks.auth.loading = true;
    const { rerender } = renderHook(useRoleIntentReconciler);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.auth = { ...mocks.auth, loading: false };
    rerender();
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
  });
  it.each(['returned', 'thrown'])('preserves explicit hint and permits retry after %s error', async kind => {
    sessionStorage.setItem('htp_auth_intent', 'recruiter');
    if (kind === 'returned') mocks.rpc.mockResolvedValueOnce({ error: new Error('temporary') });
    else mocks.rpc.mockRejectedValueOnce(new Error('temporary'));
    const { rerender } = renderHook(useRoleIntentReconciler);
    await act(async () => {});
    expect(sessionStorage.getItem('htp_auth_intent')).toBe('recruiter');
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    mocks.auth = { ...mocks.auth, user: { id: 'driver-a' } };
    rerender();
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
  });
  it('stale A completion cannot clear B hints or invalidate B identity', async () => {
    let finish: ((value: unknown) => void) | undefined;
    mocks.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    sessionStorage.setItem('htp_auth_intent', 'recruiter');
    const { rerender } = renderHook(useRoleIntentReconciler);
    mocks.auth = { user: { id: 'assistant-b' }, loading: false };
    sessionStorage.setItem('htp_auth_intent', 'assistant');
    rerender();
    await act(async () => { finish?.({ data: { applied: true }, error: null }); });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('htp_auth_intent')).toBe('assistant');
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });
  it('successful account reconciliation is not repeated after A to B to A switching', async () => {
    sessionStorage.setItem('htp_auth_intent', 'recruiter');
    const { rerender } = renderHook(useRoleIntentReconciler);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    await act(async () => {});
    mocks.auth = { user: { id: 'recruiter-b' }, loading: false };
    sessionStorage.setItem('htp_auth_intent', 'recruiter');
    rerender();
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
    await act(async () => {});
    mocks.auth = { user: { id: 'driver-a' }, loading: false };
    sessionStorage.setItem('htp_auth_intent', 'recruiter');
    rerender();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});