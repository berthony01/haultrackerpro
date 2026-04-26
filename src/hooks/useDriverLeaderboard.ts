import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface LeaderboardRow {
  user_id: string;
  weekly_points: number;
  total_points: number;
  parking_points: number;
  load_points: number;
  streak_days: number;
  tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  rank: number;
  masked_display_name: string;
}

export function useDriverLeaderboard(limit = 10) {
  return useQuery({
    queryKey: ['driver-leaderboard', limit],
    queryFn: async (): Promise<LeaderboardRow[]> => {
      const { data, error } = await supabase.rpc('get_weekly_driver_leaderboard', {
        _limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as unknown as LeaderboardRow[];
    },
    staleTime: 60_000,
  });
}

export function useMyLeaderboardRank(limit = 10) {
  const { user } = useAuth();
  const { data: rows = [], isLoading } = useDriverLeaderboard(limit);
  const me = user ? rows.find((r) => r.user_id === user.id) ?? null : null;
  const top = rows[0] ?? null;
  return { me, top, rows, isLoading };
}

export function pointsSource(parking: number, load: number): 'Parking' | 'Loads' | 'Balanced' {
  if (parking === 0 && load === 0) return 'Balanced';
  if (parking > load * 1.5) return 'Parking';
  if (load > parking * 1.5) return 'Loads';
  return 'Balanced';
}
