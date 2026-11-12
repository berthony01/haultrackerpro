/**
 * Regression: Owner QA Center must not redirect a super_admin while the
 * auth session or the admin_users lookup is still pending. Uses the real
 * useOwnerQaPersona and real useAdmin; only Supabase and useAuth are mocked.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';

const auth = vi.hoisted(() => ({ value: { user: null as { id: string } | null, loading: false } }));
const admin = vi.hoisted(() => ({ resolve: null as null | ((r: { data: unknown; error: unknown }) => void) }));
const rpc = vi.hoisted(() => vi.fn(async () => ({ data: null, error: null })));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth.value }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => new Promise((res) => { admin.resolve = res; }),
        }),
      }),
    }),
  },
}));

import { useOwnerQaPersona } from '@/hooks/useOwnerQaPersona';

function Gate() {
  const { isOwner, isLoading } = useOwnerQaPersona();
  if (isLoading) return <div>pending</div>;
  if (!isOwner) return <Navigate to="/dashboard" replace />;
  return <div>owner-qa-center</div>;
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/owner-qa']}>
        <Routes>
          <Route path="/owner-qa" element={<Gate />} />
          <Route path="/dashboard" element={<div>dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  admin.resolve = null;
  rpc.mockClear();
  auth.value = { user: { id: 'u1' }, loading: false };
});

describe('Owner QA Center pending-auth redirect', () => {
  it('delayed super_admin lookup stays on owner route, then succeeds', async () => {
    setup();
    await waitFor(() => expect(admin.resolve).not.toBeNull());
    expect(screen.queryByText('dashboard')).toBeNull();
    await act(async () => admin.resolve!({ data: { role: 'super_admin' }, error: null }));
    expect(await screen.findByText('owner-qa-center')).toBeTruthy();
    expect(screen.queryByText('dashboard')).toBeNull();
  });

  it('resolved ordinary user is denied', async () => {
    setup();
    await waitFor(() => expect(admin.resolve).not.toBeNull());
    await act(async () => admin.resolve!({ data: null, error: null }));
    expect(await screen.findByText('dashboard')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('non-super admin is denied', async () => {
    setup();
    await waitFor(() => expect(admin.resolve).not.toBeNull());
    await act(async () => admin.resolve!({ data: { role: 'admin' }, error: null }));
    expect(await screen.findByText('dashboard')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('admin lookup error is denied', async () => {
    setup();
    await waitFor(() => expect(admin.resolve).not.toBeNull());
    await act(async () => admin.resolve!({ data: null, error: { message: 'boom' } }));
    expect(await screen.findByText('dashboard')).toBeTruthy();
  });

  it('pending auth waits without redirecting', async () => {
    auth.value = { user: null, loading: true };
    setup();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByText('dashboard')).toBeNull();
    expect(screen.getByText('pending')).toBeTruthy();
  });
});
