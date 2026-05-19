import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type Load = Tables<'loads'>;
// `estimated_pay` is now app-written (no longer a DB-generated column) so the
// pay-model engine (computeLoadPay) can persist correct values for flat_rate,
// total_miles, loaded_plus_deadhead, and manual loads. Keep it optional on
// insert/update so callers that don't compute it (legacy paths) still work.
export type LoadInsert = Omit<TablesInsert<'loads'>, 'user_id' | 'id' | 'created_at' | 'updated_at' | 'gross_revenue'> & { estimated_pay?: number | null; gross_revenue?: number | null; dropoff_date?: string | null; invoice_submitted_date?: string | null; pod_submitted_date?: string | null; payment_due_date?: string | null; paid_date?: string | null; short_paid_amount?: number | null; payment_status?: string; payment_notes?: string | null };
export type LoadUpdate = Omit<TablesUpdate<'loads'>, 'user_id' | 'id' | 'created_at' | 'updated_at'> & { estimated_pay?: number | null; dropoff_date?: string | null; invoice_submitted_date?: string | null; pod_submitted_date?: string | null; payment_due_date?: string | null; paid_date?: string | null; short_paid_amount?: number | null; payment_status?: string; payment_notes?: string | null };

/** Canonical period date: drop-off first, pickup fallback */
function getEffectiveDate(load: Load): string {
  return load.dropoff_date ?? load.load_date;
}

interface DateRange {
  from?: string;
  to?: string;
}

const PAGE_SIZE = 50;

/**
 * Build a Supabase `.or()` filter so the server returns any load whose
 * load_date OR dropoff_date falls inside the requested window. Previously
 * we filtered only on load_date, which silently dropped loads picked up
 * before the window but delivered inside it.
 */
function buildEffectiveDateOr(from?: string, to?: string): string | null {
  const loadParts: string[] = [];
  const dropParts: string[] = [];
  if (from) {
    loadParts.push(`load_date.gte.${from}`);
    dropParts.push(`dropoff_date.gte.${from}`);
  }
  if (to) {
    loadParts.push(`load_date.lte.${to}`);
    dropParts.push(`dropoff_date.lte.${to}`);
  }
  if (loadParts.length === 0) return null;
  const loadClause = loadParts.length > 1 ? `and(${loadParts.join(',')})` : loadParts[0];
  const dropClause = dropParts.length > 1 ? `and(${dropParts.join(',')})` : dropParts[0];
  return `${loadClause},${dropClause}`;
}

export function useLoads(dateRange?: DateRange, page?: number) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const loadsQuery = useQuery({
    queryKey: ['loads', user?.id, dateRange?.from, dateRange?.to, page],
    queryFn: async () => {
      if (!user) return { loads: [], totalCount: 0 };

      let query = supabase
        .from('loads')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)
        .order('load_date', { ascending: false });

      // Server-side effective-date filtering (load_date OR dropoff_date).
      // NOTE: totalCount reflects this OR-prefilter which is a superset of the
      // client-filtered list below — it never underfetches.
      const orFilter = buildEffectiveDateOr(dateRange?.from, dateRange?.to);
      if (orFilter) query = query.or(orFilter);

      // Apply pagination range if page is provided
      if (page !== undefined) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        query = query.range(from, to);
      }

      const { data, error, count } = await query;
      if (error) throw error;

      let filtered = data ?? [];

      // Client-side refinement on effective date for precision
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

      return { loads: filtered, totalCount: count ?? filtered.length };
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
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('loads')
        .update(data)
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loads'] }),
  });

  const deleteLoad = useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('loads')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loads'] }),
  });

  return {
    loads: loadsQuery.data?.loads ?? [],
    totalCount: loadsQuery.data?.totalCount ?? 0,
    isLoading: loadsQuery.isLoading,
    addLoad,
    updateLoad,
    deleteLoad,
    pageSize: PAGE_SIZE,
  };
}
