import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTargetUserId } from '@/hooks/useActingContext';
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
  // Scope to the acting driver when an assistant is acting; otherwise self.
  // RLS additionally enforces this server-side.
  const targetUserId = useTargetUserId();
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['cost_profile', targetUserId],
    queryFn: async () => {
      if (!targetUserId) return null;
      const { data, error } = await supabase
        .from('cost_profile' as any)
        .select('*')
        .eq('user_id', targetUserId)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as CostProfile) ?? null;
    },
    enabled: !!targetUserId,
    staleTime: 60_000,
  });

  const upsertProfile = useMutation({
    mutationFn: async (updates: CostProfileUpdate) => {
      if (!targetUserId) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('cost_profile' as any)
        .upsert({ user_id: targetUserId, ...updates } as any, { onConflict: 'user_id' });
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
