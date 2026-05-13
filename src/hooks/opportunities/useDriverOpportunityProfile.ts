import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export type DriverOpportunityProfile = Tables<'driver_opportunity_profiles'>;
export type DriverOpportunityProfileUpsert = Omit<TablesInsert<'driver_opportunity_profiles'>, 'user_id'>;

export function useDriverOpportunityProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['driver_opportunity_profile', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('driver_opportunity_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const upsertProfile = useMutation({
    mutationFn: async (data: DriverOpportunityProfileUpsert) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('driver_opportunity_profiles')
        .upsert({ ...data, user_id: user.id }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver_opportunity_profile'] }),
  });

  const deleteProfile = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('driver_opportunity_profiles')
        .delete()
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver_opportunity_profile'] }),
  });

  return {
    profile: profileQuery.data ?? null,
    isLoading: profileQuery.isLoading,
    isError: profileQuery.isError,
    error: profileQuery.error as Error | null,
    refetch: profileQuery.refetch,
    upsertProfile,
    deleteProfile,
  };
}
