import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAdmin } from '@/hooks/useAdmin';

export type UserRole = 'driver' | 'recruiter';

/**
 * Derives the user's primary role from existing data:
 * - recruiter = has a row in `recruiter_profiles`
 * - driver    = everyone else
 *
 * Admin / owner accounts are tracked separately via `useAdmin()` and keep
 * cross-role access for management/testing. This hook intentionally does NOT
 * create a new role system — it just reads what already exists.
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

  const isRecruiter = !!recruiterQuery.data;
  const role: UserRole = isRecruiter ? 'recruiter' : 'driver';
  const isLoading = authLoading || adminLoading || recruiterQuery.isLoading;

  return { role, isRecruiter, isDriver: !isRecruiter, isAdmin, isLoading };
}
