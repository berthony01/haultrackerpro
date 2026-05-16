import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAdmin } from '@/hooks/useAdmin';

export type UserRole = 'driver' | 'recruiter';

/** Read sticky recruiter intent set during signup/OAuth round-trip. */
function readRecruiterIntent(): boolean {
  try {
    if (sessionStorage.getItem('htp_auth_intent') === 'recruiter') return true;
    if (sessionStorage.getItem('htp_recruiter_intent') === '1') return true;
  } catch {}
  return false;
}

/**
 * Derives the user's primary role from existing data:
 * - recruiter = has a row in `recruiter_profiles` OR has fresh recruiter signup intent
 *   (so a brand-new recruiter isn't bounced out of /recruiter-access before
 *   they complete onboarding and the profile row gets written)
 * - driver    = everyone else
 *
 * Admin / owner accounts are tracked separately via `useAdmin()` and keep
 * cross-role access for management/testing.
 */
export function useUserRole() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useAdmin();

  const recruiterQuery = useQuery({
    queryKey: ['user-role-recruiter-check', user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data, error } = await supabase
        .from('recruiter_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const hasRecruiterProfile = !!recruiterQuery.data;
  const intentRecruiter = readRecruiterIntent();
  const isRecruiter = hasRecruiterProfile || intentRecruiter;
  const role: UserRole = isRecruiter ? 'recruiter' : 'driver';
  const isLoading = authLoading || adminLoading || recruiterQuery.isLoading;

  return {
    role,
    isRecruiter,
    isDriver: !isRecruiter,
    isAdmin,
    isLoading,
    hasRecruiterProfile,
    intentRecruiter,
  };
}
