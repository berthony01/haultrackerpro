import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface DriverPoints {
  user_id: string;
  total_points: number;
  weekly_points: number;
  parking_points: number;
  load_points: number;
  streak_days: number;
  last_activity_date: string | null;
  weekly_period_start: string | null;
  best_weekly_points: number;
  best_weekly_period_start: string | null;
  updated_at: string;
}

export function useDriverPoints() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['driver-points', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<DriverPoints | null> => {
      const { data, error } = await supabase
        .from('driver_points')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as DriverPoints | null;
    },
  });

  // Realtime: refresh on any change to this user's points row.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`driver-points-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_points', filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ['driver-points', user.id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, qc]);

  return query;
}

export function tierFor(total: number): { name: string; color: string } {
  if (total >= 400) return { name: 'Platinum', color: 'text-blue-300' };
  if (total >= 150) return { name: 'Gold', color: 'text-yellow-400' };
  if (total >= 50) return { name: 'Silver', color: 'text-slate-300' };
  return { name: 'Bronze', color: 'text-orange-400' };
}

/** Returns the next tier name and points needed to reach it, or null if already at top tier. */
export function nextTierProgress(total: number): { next: string; threshold: number; toGo: number } | null {
  if (total < 50) return { next: 'Silver', threshold: 50, toGo: 50 - total };
  if (total < 150) return { next: 'Gold', threshold: 150, toGo: 150 - total };
  if (total < 400) return { next: 'Platinum', threshold: 400, toGo: 400 - total };
  return null;
}

// Deterministic mock percentile from user id — keeps the dashboard honest-feeling
// without a real leaderboard query.
export function mockPercentile(userId: string | undefined, total: number): number {
  if (!userId) return 50;
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  const base = 60 + (h % 30); // 60..89
  const bonus = Math.min(8, Math.floor(total / 50));
  return Math.min(95, base + bonus);
}
