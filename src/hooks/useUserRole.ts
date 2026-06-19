import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAdmin } from '@/hooks/useAdmin';

export type UserRole = 'driver' | 'recruiter';

/**
 * Derives the user's primary role from server-authoritative data:
 * - recruiter = has a row in `recruiter_profiles`
 *   OR has `profiles.intended_role = 'recruiter'` (durable signup intent,
 *   written only by `handle_new_user` from signup metadata or by the
 *   `apply_recruiter_intent` RPC after an eligibility check).
 * - driver    = everyone else
 *
 * SessionStorage is intentionally NOT consulted here. Client storage
 * can't be trusted to set a role; the recruiter-intent hint in
 * sessionStorage only nudges the reconciler to call the RPC, and the
 * RPC decides whether to write.
 *
 * Admin / owner accounts are tracked separately via `useAdmin()`.
 */

export function useUserRole() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useAdmin();
  const recruiterQuery = useQuery({
    queryKey: ['user-role-recruiter-check', user?.id],
    queryFn: async () => {
      if (!user) return false;
      // Phase 28A: use safe RPC; recruiters no longer have direct SELECT on
      // recruiter_profiles, so .from('recruiter_profiles').select('id') is gone.
      const { data, error } = await (supabase as any).rpc('is_current_user_recruiter');
      if (error) throw error;
      return !!data;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const intentQuery = useQuery({
    queryKey: ['user-role-profile-intent', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('intended_role')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return (data?.intended_role as UserRole | undefined) ?? null;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const hasRecruiterProfile = !!recruiterQuery.data;
  const profileIntentRecruiter = intentQuery.data === 'recruiter';
  const sessionIntentRecruiter = readRecruiterIntent();
  const isRecruiter = hasRecruiterProfile || profileIntentRecruiter || sessionIntentRecruiter;
  const role: UserRole = isRecruiter ? 'recruiter' : 'driver';
  const isLoading =
    authLoading || adminLoading || recruiterQuery.isLoading || intentQuery.isLoading;

  return {
    role,
    isRecruiter,
    isDriver: !isRecruiter,
    isAdmin,
    isLoading,
    hasRecruiterProfile,
    intentRecruiter: profileIntentRecruiter || sessionIntentRecruiter,
  };
}
