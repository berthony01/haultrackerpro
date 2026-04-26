import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface DriverProfile {
  user_id: string;
  display_name: string | null;
  driver_handle: string | null;
  handle_emoji: string | null;
  handle_public: boolean;
}

export const HANDLE_EMOJIS = ['🚛', '🛻', '🚚', '🐺', '🦅', '⚡', '🔥', '👑', '⭐', '🏆', '🛞', '🤘'];

export function useDriverProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['driver-profile', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<DriverProfile | null> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, display_name, driver_handle, handle_emoji, handle_public')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as DriverProfile | null;
    },
  });
}

export function useUpdateDriverProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Pick<DriverProfile, 'driver_handle' | 'handle_emoji' | 'handle_public'>>) => {
      if (!user) throw new Error('Not signed in');
      const { error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver-profile', user?.id] });
      qc.invalidateQueries({ queryKey: ['driver-leaderboard'] });
      toast.success('Public profile updated');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Could not save handle');
    },
  });
}

/** Quick availability check — returns true if available (or unchanged for current user). */
export async function checkHandleAvailable(handle: string, currentUserId?: string): Promise<boolean> {
  const normalized = handle.trim().toLowerCase();
  if (!normalized) return false;
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('driver_handle', normalized)
    .eq('handle_public', true)
    .maybeSingle();
  if (error) return false;
  if (!data) return true;
  return data.user_id === currentUserId;
}
