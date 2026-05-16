import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  payload: Record<string, any> | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPreferences {
  id: string;
  user_id: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  application_events: boolean;
  contact_request_events: boolean;
  contract_events: boolean;
  recruiter_status_events: boolean;
}

const LIST_LIMIT = 30;

export function useNotifications() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: ['notifications', user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<NotificationRow[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('notifications' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT);
      if (error) throw error;
      return (data ?? []) as unknown as NotificationRow[];
    },
  });

  const notifications = listQuery.data ?? [];
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  // Realtime: subscribe to inserts/updates for this user
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['notifications', user.id] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, qc]);

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('mark_notification_read' as any, { notification_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('mark_all_notifications_read' as any);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  });

  return {
    notifications,
    unreadCount,
    isLoading: listQuery.isLoading,
    refetch: listQuery.refetch,
    markRead,
    markAllRead,
  };
}

export function useNotificationPreferences() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['notification_preferences', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<NotificationPreferences | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('notification_preferences' as any)
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as NotificationPreferences | null;
    },
  });

  const upsert = useMutation({
    mutationFn: async (patch: Partial<Omit<NotificationPreferences, 'id' | 'user_id'>>) => {
      if (!user) throw new Error('Not authenticated');
      const current = query.data;
      if (current) {
        const { error } = await supabase
          .from('notification_preferences' as any)
          .update(patch)
          .eq('user_id', user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('notification_preferences' as any)
          .insert({ user_id: user.id, ...patch });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification_preferences', user?.id] }),
  });

  return {
    preferences: query.data ?? null,
    isLoading: query.isLoading,
    upsert,
  };
}
