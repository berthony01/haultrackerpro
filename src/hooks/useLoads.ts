import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTargetUserId } from '@/hooks/useActingContext';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import { getEffectiveDate } from '@/lib/loadEffectiveDate';

export type Load = Tables<'loads'> & { actual_delivery_date?: string | null; dispatch_company_name?: string | null };
// `estimated_pay` is now app-written (no longer a DB-generated column) so the
// pay-model engine (computeLoadPay) can persist correct values for flat_rate,
// total_miles, loaded_plus_deadhead, and manual loads. Keep it optional on
// insert/update so callers that don't compute it (legacy paths) still work.
export type LoadInsert = Omit<TablesInsert<'loads'>, 'user_id' | 'id' | 'created_at' | 'updated_at' | 'gross_revenue'> & { estimated_pay?: number | null; gross_revenue?: number | null; dropoff_date?: string | null; invoice_submitted_date?: string | null; pod_submitted_date?: string | null; payment_due_date?: string | null; paid_date?: string | null; short_paid_amount?: number | null; payment_status?: string; payment_notes?: string | null };
export type LoadUpdate = Omit<TablesUpdate<'loads'>, 'user_id' | 'id' | 'created_at' | 'updated_at'> & { estimated_pay?: number | null; dropoff_date?: string | null; invoice_submitted_date?: string | null; pod_submitted_date?: string | null; payment_due_date?: string | null; paid_date?: string | null; short_paid_amount?: number | null; payment_status?: string; payment_notes?: string | null };

interface DateRange {
  from?: string;
  to?: string;
}

const PAGE_SIZE = 50;

type DriverLoadsRpc = (fn: 'driver_loads_page', args: { _driver_user_id: string; _from: string | null; _to: string | null; _offset: number; _limit: number }) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
const readDriverLoads = supabase.rpc.bind(supabase) as unknown as DriverLoadsRpc;

export function useLoads(dateRange?: DateRange, page?: number, options?: { enabled?: boolean; watchDispatch?: boolean }) {
  const { user } = useAuth();
  const targetUserId = useTargetUserId();
  const queryClient = useQueryClient();

  const loadsQuery = useQuery({
    queryKey: ['loads', user?.id, targetUserId, dateRange?.from, dateRange?.to, page],
    queryFn: async () => {
      if (!targetUserId) return { loads: [], totalCount: 0 };

      const readPage = async (offset: number, limit: number) => {
        const { data, error } = await readDriverLoads('driver_loads_page', { _driver_user_id: targetUserId, _from: dateRange?.from ?? null, _to: dateRange?.to ?? null, _offset: offset, _limit: limit });
        if (error) throw error;
        const result = data as { loads?: Load[]; totalCount?: number } | null;
        if (!result || !Array.isArray(result.loads) || !Number.isInteger(result.totalCount) || result.totalCount! < 0) throw new Error('Load refresh was not confirmed.');
        return { loads: result.loads, count: result.totalCount! };
      };

      let rawData: Load[] = [];
      let count: number | null = null;

      if (page !== undefined) {
        const fromIdx = page * PAGE_SIZE;
        const result = await readPage(fromIdx, PAGE_SIZE);
        rawData = result.loads;
        count = result.count;
      } else {
        const FETCH_SIZE = 1000;
        let offset = 0;
        for (let i = 0; i < 50; i++) {
          const { loads: batch, count: c } = await readPage(offset, FETCH_SIZE);
          rawData.push(...batch);
          if (typeof c === 'number') count = c;
          if (batch.length < FETCH_SIZE || rawData.length >= c) break;
          offset += FETCH_SIZE;
        }
      }

      let filtered = rawData;
      if (dateRange?.from) filtered = filtered.filter(l => getEffectiveDate(l) >= dateRange.from!);
      if (dateRange?.to) filtered = filtered.filter(l => getEffectiveDate(l) <= dateRange.to!);
      filtered.sort((a, b) => {
        const cmp = getEffectiveDate(b).localeCompare(getEffectiveDate(a));
        if (cmp !== 0) return cmp;
        return b.created_at.localeCompare(a.created_at);
      });

      return { loads: filtered, totalCount: count ?? filtered.length };
    },
    enabled: !!user?.id && !!targetUserId && options?.enabled !== false,
    // Cross-account dispatch changes reach an already open driver dashboard.
    // Background reads retain same-scope data and pause while the tab is hidden.
    refetchInterval: options?.watchDispatch && user?.id === targetUserId ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const addLoad = useMutation({
    mutationFn: async (data: LoadInsert) => {
      if (!targetUserId) throw new Error('Not authenticated');
      const { data: result, error } = await supabase
        .from('loads')
        .insert({ ...data, user_id: targetUserId })
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loads'] }),
  });

  const updateLoad = useMutation({
    mutationFn: async ({ id, data, expectedStatus }: { id: string; data: LoadUpdate; expectedStatus?: string }) => {
      if (!targetUserId) throw new Error('Not authenticated');
      const update = supabase
        .from('loads')
        .update(data)
        .eq('id', id)
        .eq('user_id', targetUserId);
      if (expectedStatus !== undefined) {
        const { data: changed, error } = await update.eq('status', expectedStatus).select('id').maybeSingle();
        if (error) throw error;
        if (!changed) throw new Error('The load status changed. Reopen the load before updating its status.');
        return;
      }
      const { error } = await update;
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loads'] }),
  });

  const deleteLoad = useMutation({
    mutationFn: async (id: string) => {
      // Deletes are owner-only; assistants cannot delete in Phase 1.
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
    loads: (loadsQuery.error as { code?: string } | null)?.code === '42501' ? [] : loadsQuery.data?.loads ?? [],
    totalCount: (loadsQuery.error as { code?: string } | null)?.code === '42501' ? 0 : loadsQuery.data?.totalCount ?? 0,
    isLoading: loadsQuery.isLoading,
    error: loadsQuery.error,
    refetch: loadsQuery.refetch,
    addLoad,
    updateLoad,
    deleteLoad,
    pageSize: PAGE_SIZE,
  };
}
