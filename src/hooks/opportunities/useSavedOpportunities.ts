import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables } from '@/integrations/supabase/types';

export type SavedOpportunity = Tables<'saved_opportunities'>;

export function useSavedOpportunities() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['saved_opportunities', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('saved_opportunities')
        .select('*, opportunities:opportunity_id(*)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const save = useMutation({
    mutationFn: async (opportunityId: string) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('saved_opportunities')
        .insert({ user_id: user.id, opportunity_id: opportunityId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved_opportunities'] }),
  });

  const unsave = useMutation({
    mutationFn: async (opportunityId: string) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('saved_opportunities')
        .delete()
        .eq('user_id', user.id)
        .eq('opportunity_id', opportunityId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved_opportunities'] }),
  });

  return {
    saved: query.data ?? [],
    isLoading: query.isLoading,
    save,
    unsave,
  };
}
