import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  type CostProfile,
  type CostProfileUpdate,
  type CPMBreakdownKey,
  CPM_BREAKDOWN_LABELS,
  profileHasUsableData,
  computeCostProfileCPM,
} from '@/lib/costProfileMath';

// Re-export pure helpers + types so existing import paths keep working.
export {
  type CostProfile,
  type CostProfileUpdate,
  type CPMBreakdownKey,
  CPM_BREAKDOWN_LABELS,
  profileHasUsableData,
  computeCostProfileCPM,
};

export function useCostProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['cost_profile', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('cost_profile' as any)
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as CostProfile) ?? null;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const upsertProfile = useMutation({
    mutationFn: async (updates: CostProfileUpdate) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('cost_profile' as any)
        .upsert({ user_id: user.id, ...updates } as any, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cost_profile'] }),
  });

  return {
    profile: profileQuery.data ?? null,
    isLoading: profileQuery.isLoading,
    upsertProfile,
    hasUsableData: profileHasUsableData(profileQuery.data),
  };
}
