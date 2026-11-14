import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';

const signUp = vi.fn().mockResolvedValue({ error: null });
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { signUp: (...a: unknown[]) => signUp(...a), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }) } },
}));
import { AuthProvider, useAuth } from '@/hooks/useAuth';

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;
const meta = () => (signUp.mock.calls.at(-1)![0] as any).options.data;

describe('RD-1 signup sends explicit signup_capability', () => {
  beforeEach(() => signUp.mockClear());
  for (const c of ['driver', 'recruiter', 'assistant', 'agency'] as const) {
    it(c, async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });
      await act(() => result.current.signUp('a@b.co', 'pw123456', 'A', c === 'recruiter' ? 'recruiter' : 'driver', { signupCapability: c }));
      expect(meta().signup_capability).toBe(c);
      expect(meta().intended_role).toBe(c === 'recruiter' ? 'recruiter' : 'driver');
    });
  }
});
