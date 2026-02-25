import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface WeeklySnapshot {
  id: string;
  user_id: string;
  week_start: string;
  week_end: string;
  total_loads: number;
  total_loaded_miles: number;
  total_deadhead_miles: number;
  total_estimated_pay: number;
  total_actual_pay: number;
  known_difference: number;
  unpaid_count: number;
  unpaid_estimated: number;
  deadhead_percentage: number;
  finalized_at: string;
  created_at: string;
}

export function useWeeklySnapshots() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const snapshotsQuery = useQuery({
    queryKey: ['weekly_snapshots', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('weekly_snapshots')
        .select('*')
        .eq('user_id', user.id)
        .order('week_start', { ascending: false });
      if (error) throw error;
      return data as WeeklySnapshot[];
    },
    enabled: !!user,
  });

  const saveSnapshot = useMutation({
    mutationFn: async (snapshot: Omit<WeeklySnapshot, 'id' | 'created_at' | 'finalized_at'>) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('weekly_snapshots')
        .upsert(
          { ...snapshot, user_id: user.id },
          { onConflict: 'user_id,week_start' }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['weekly_snapshots'] }),
  });

  return {
    snapshots: snapshotsQuery.data ?? [],
    isLoading: snapshotsQuery.isLoading,
    saveSnapshot,
  };
}
