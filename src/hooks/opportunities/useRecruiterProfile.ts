import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export type RecruiterProfile = Tables<'recruiter_profiles'>;
export type RecruiterProfileUpsert = Omit<TablesInsert<'recruiter_profiles'>, 'user_id'>;

export function useRecruiterProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['recruiter_profile', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('recruiter_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const upsertProfile = useMutation({
    mutationFn: async (data: RecruiterProfileUpsert) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('recruiter_profiles')
        .upsert({ ...data, user_id: user.id }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recruiter_profile'] }),
  });

  const profile = profileQuery.data ?? null;
  const isApproved =
    !!profile &&
    profile.verification_status === 'approved' &&
    profile.status === 'active';
  const isSuspended = !!profile && profile.status === 'suspended';

  return {
    profile,
    isLoading: profileQuery.isLoading,
    isApproved,
    isSuspended,
    upsertProfile,
  };
}
