import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Tables } from '@/integrations/supabase/types';

export type LaneStat = Tables<'lane_stats'>;
export type BrokerStat = Tables<'broker_stats'>;
export type OperatingMetrics = Tables<'operating_metrics'>;

export function usePersonalIntelligence() {
  const { user } = useAuth();

  const lanesQuery = useQuery({
    queryKey: ['lane_stats', user?.id],
    queryFn: async () => {
      if (!user) return [] as LaneStat[];
      const { data, error } = await supabase
        .from('lane_stats')
        .select('*')
        .eq('user_id', user.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const brokersQuery = useQuery({
    queryKey: ['broker_stats_with_names', user?.id],
    queryFn: async () => {
      if (!user) return [] as (BrokerStat & { broker_name: string })[];
      const { data: stats, error } = await supabase
        .from('broker_stats')
        .select('*')
        .eq('user_id', user.id);
      if (error) throw error;
      if (!stats || stats.length === 0) return [];
      const brokerIds = stats.map(s => s.broker_id);
      const { data: brokers } = await supabase
        .from('brokers')
        .select('id, name')
        .in('id', brokerIds);
      const nameMap = new Map((brokers ?? []).map(b => [b.id, b.name]));
      return stats.map(s => ({ ...s, broker_name: nameMap.get(s.broker_id) ?? 'Unknown' }));
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const opQuery = useQuery({
    queryKey: ['operating_metrics', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('operating_metrics')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  return {
    lanes: lanesQuery.data ?? [],
    brokers: brokersQuery.data ?? [],
    operatingMetrics: opQuery.data ?? null,
    isLoading: lanesQuery.isLoading || brokersQuery.isLoading || opQuery.isLoading,
  };
}
