import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface LoadStop {
  id: string;
  user_id: string;
  load_id: string;
  stop_order: number;
  location: string;
  stop_type: string;
  detention_minutes: number | null;
  stop_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoadStopInput {
  stop_order: number;
  location: string;
  stop_type: string;
  detention_minutes?: number | null;
  stop_date?: string | null;
}

export function useLoadStops(loadIds?: string[]) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const stopsQuery = useQuery({
    queryKey: ['load_stops', user?.id, loadIds],
    queryFn: async () => {
      if (!user) return [];
      let query = supabase
        .from('load_stops' as any)
        .select('*')
        .eq('user_id', user.id)
        .order('stop_order', { ascending: true });

      if (loadIds && loadIds.length > 0) {
        query = query.in('load_id', loadIds);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as LoadStop[];
    },
    enabled: !!user,
  });

  const saveStopsForLoad = useMutation({
    mutationFn: async ({ loadId, stops }: { loadId: string; stops: LoadStopInput[] }) => {
      if (!user) throw new Error('Not authenticated');

      // Delete existing stops for this load
      await supabase
        .from('load_stops' as any)
        .delete()
        .eq('load_id', loadId)
        .eq('user_id', user.id);

      if (stops.length === 0) return [];

      const rows = stops.map((s, i) => ({
        user_id: user.id,
        load_id: loadId,
        stop_order: i + 1,
        location: s.location,
        stop_type: s.stop_type,
        detention_minutes: s.detention_minutes ?? null,
        stop_date: s.stop_date ?? null,
      }));

      const { data, error } = await supabase
        .from('load_stops' as any)
        .insert(rows as any)
        .select();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['load_stops'] }),
  });

  return {
    stops: stopsQuery.data ?? [],
    isLoading: stopsQuery.isLoading,
    saveStopsForLoad,
    getStopsForLoad: (loadId: string) => (stopsQuery.data ?? []).filter(s => s.load_id === loadId),
  };
}
