import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables, TablesUpdate } from '@/integrations/supabase/types';

export type UserSettings = Tables<'user_settings'>;
export type UserSettingsUpdate = Pick<TablesUpdate<'user_settings'>, 'default_rate_per_mile' | 'default_other_fees' | 'week_start_day' | 'currency'>;

export function useUserSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ['user_settings', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const updateSettings = useMutation({
    mutationFn: async (updates: UserSettingsUpdate) => {
      if (!user) throw new Error('Not authenticated');
      // Upsert in case row doesn't exist yet (legacy users)
      const { error } = await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, ...updates }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user_settings'] }),
  });

  return {
    settings: settingsQuery.data ?? null,
    isLoading: settingsQuery.isLoading,
    updateSettings,
  };
}
