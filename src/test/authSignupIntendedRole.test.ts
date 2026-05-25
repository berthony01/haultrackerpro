import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase client BEFORE importing the hook
const signUpMock = vi.fn(async () => ({ data: { user: null, session: null }, error: null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      signUp: (...args: any[]) => signUpMock(...args),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => {}),
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  },
}));

import { renderHook, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { createElement, type ReactNode } from 'react';

function wrapper({ children }: { children: ReactNode }) {
  return createElement(AuthProvider, null, children);
}

describe('useAuth signUp intended_role metadata', () => {
  beforeEach(() => {
    signUpMock.mockClear();
  });

  it('defaults intended_role to driver when not provided', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.signUp('d@x.com', 'pw123456', 'Driver Dan');
    });
    expect(signUpMock).toHaveBeenCalledTimes(1);
    const call = signUpMock.mock.calls[0][0] as any;
    expect(call.options.data.intended_role).toBe('driver');
    expect(call.options.data.display_name).toBe('Driver Dan');
  });

  it('passes intended_role=recruiter when role is recruiter', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.signUp('r@x.com', 'pw123456', 'Rec Rita', 'recruiter');
    });
    const call = signUpMock.mock.calls[0][0] as any;
    expect(call.options.data.intended_role).toBe('recruiter');
  });

  it('treats any non-recruiter value as driver', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.signUp('x@x.com', 'pw123456', 'X', 'driver');
    });
    const call = signUpMock.mock.calls[0][0] as any;
    expect(call.options.data.intended_role).toBe('driver');
  });
});
