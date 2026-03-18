import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type Load = Tables<'loads'>;
export type LoadInsert = Omit<TablesInsert<'loads'>, 'user_id' | 'id' | 'created_at' | 'updated_at' | 'estimated_pay' | 'gross_revenue'> & { gross_revenue?: number | null; dropoff_date?: string | null };
export type LoadUpdate = Omit<TablesUpdate<'loads'>, 'user_id' | 'id' | 'created_at' | 'updated_at' | 'estimated_pay'> & { dropoff_date?: string | null };

/** Canonical period date: drop-off first, pickup fallback */
function getEffectiveDate(load: Load): string {
  return load.dropoff_date ?? load.load_date;
}

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
      const { data, error } = await supabase
        .from('loads')
        .select('*')
        .eq('user_id', user.id);
      if (error) throw error;

      // Filter by effective date (dropoff_date ?? load_date)
      let filtered = data ?? [];
      if (dateRange?.from) {
        filtered = filtered.filter(l => getEffectiveDate(l) >= dateRange.from!);
      }
      if (dateRange?.to) {
        filtered = filtered.filter(l => getEffectiveDate(l) <= dateRange.to!);
      }

      // Sort by effective date descending, tie-break by created_at descending
      filtered.sort((a, b) => {
        const cmp = getEffectiveDate(b).localeCompare(getEffectiveDate(a));
        if (cmp !== 0) return cmp;
        return b.created_at.localeCompare(a.created_at);
      });

      return filtered;
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
