import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type Load = Tables<'loads'>;
export type LoadInsert = Omit<TablesInsert<'loads'>, 'user_id' | 'id' | 'created_at' | 'updated_at' | 'estimated_pay' | 'gross_revenue'> & { gross_revenue?: number | null; dropoff_date?: string | null };
export type LoadUpdate = Omit<TablesUpdate<'loads'>, 'user_id' | 'id' | 'created_at' | 'updated_at' | 'estimated_pay'> & { dropoff_date?: string | null };

interface DateRange {
  from?: string;
  to?: string;
}

export function useLoads(dateRange?: DateRange) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const loadsQuery = useQuery({
    queryKey: ['loads', user?.id, dateRange?.from, dateRange?.to],
    queryFn: async () => {
      if (!user) return [];
      let query = supabase
        .from('loads')
        .select('*')
        .eq('user_id', user.id)
        .order('dropoff_date', { ascending: false });

      if (dateRange?.from) query = query.gte('load_date', dateRange.from);
      if (dateRange?.to) query = query.lte('load_date', dateRange.to);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const addLoad = useMutation({
    mutationFn: async (data: LoadInsert) => {
      if (!user) throw new Error('Not authenticated');
      const { data: result, error } = await supabase
        .from('loads')
        .insert({ ...data, user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loads'] }),
  });

  const updateLoad = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: LoadUpdate }) => {
      const { error } = await supabase
        .from('loads')
        .update(data)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loads'] }),
  });

  const deleteLoad = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('loads').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loads'] }),
  });

  return {
    loads: loadsQuery.data ?? [],
    isLoading: loadsQuery.isLoading,
    addLoad,
    updateLoad,
    deleteLoad,
  };
}
