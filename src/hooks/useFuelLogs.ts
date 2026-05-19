import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { sumOperatingMiles, sumExpectedPay } from '@/lib/loadMetrics';

export interface FuelLog {
  id: string;
  user_id: string;
  date: string;
  station: string | null;
  gallons: number;
  price_per_gallon: number;
  total_cost: number;
  odometer: number | null;
  linked_load_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FuelLogInsert {
  date: string;
  station?: string | null;
  gallons: number;
  price_per_gallon: number;
  total_cost: number;
  odometer?: number | null;
  linked_load_id?: string | null;
  notes?: string | null;
}

export interface FuelLogUpdate extends Partial<FuelLogInsert> {}

export function useFuelLogs(dateRange?: { from?: string; to?: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['fuel_logs', user?.id, dateRange?.from, dateRange?.to],
    queryFn: async () => {
      if (!user) return [];
      const buildQuery = () => {
        let q = supabase
          .from('fuel_logs' as any)
          .select('*')
          .eq('user_id', user.id)
          .order('date', { ascending: false });
        if (dateRange?.from) q = q.gte('date', dateRange.from);
        if (dateRange?.to) q = q.lte('date', dateRange.to);
        return q;
      };

      // Fetch ALL rows in batches to bypass Supabase's default 1000-row cap.
      // Matches the useExpenses pattern so fuel analytics/reports never silently
      // undercount past 1k logs. Safety cap: 50 pages = 50k rows.
      const FETCH_SIZE = 1000;
      const all: FuelLog[] = [];
      let offset = 0;
      for (let i = 0; i < 50; i++) {
        const { data, error } = await buildQuery().range(offset, offset + FETCH_SIZE - 1);
        if (error) throw error;
        const batch = (data ?? []) as unknown as FuelLog[];
        all.push(...batch);
        if (batch.length < FETCH_SIZE) break;
        offset += FETCH_SIZE;
      }
      return all;
    },
    enabled: !!user,
  });

  const addFuelLog = useMutation({
    mutationFn: async (data: FuelLogInsert) => {
      if (!user) throw new Error('Not authenticated');
      const { data: result, error } = await supabase
        .from('fuel_logs' as any)
        .insert({ ...data, user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return result as unknown as FuelLog;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fuel_logs'] }),
  });

  const updateFuelLog = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FuelLogUpdate }) => {
      if (!user) throw new Error('Not authenticated');
      const { data: result, error } = await supabase
        .from('fuel_logs' as any)
        .update(data)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();
      if (error) throw error;
      return result as unknown as FuelLog;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fuel_logs'] }),
  });

  const deleteFuelLog = useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('fuel_logs' as any)
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fuel_logs'] }),
  });

  return {
    fuelLogs: query.data ?? [],
    isLoading: query.isLoading,
    addFuelLog,
    updateFuelLog,
    deleteFuelLog,
  };
}

// Analytics helpers
export function useFuelAnalytics(fuelLogs: FuelLog[], loads: any[]) {
  const totalFuelCost = fuelLogs.reduce((sum, log) => sum + Number(log.total_cost), 0);
  const totalGallons = fuelLogs.reduce((sum, log) => sum + Number(log.gallons), 0);
  const totalOperatingMiles = sumOperatingMiles(loads);
  const totalRevenue = sumExpectedPay(loads);

  const fuelCostPerMile = totalOperatingMiles > 0 ? totalFuelCost / totalOperatingMiles : 0;
  const fuelPercentOfRevenue = totalRevenue > 0 ? (totalFuelCost / totalRevenue) * 100 : 0;
  const avgPricePerGallon = totalGallons > 0 ? totalFuelCost / totalGallons : 0;

  return {
    totalFuelCost,
    totalGallons,
    fuelCostPerMile,
    fuelPercentOfRevenue,
    avgPricePerGallon,
  };
}
