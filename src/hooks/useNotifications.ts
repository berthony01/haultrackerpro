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
  assistant_events: boolean;
  agency_events: boolean;
}

const LIST_LIMIT = 30;

const listKey = (userId?: string) => ['notifications', userId] as const;
const countKey = (userId?: string) => ['notifications_unread_count', userId] as const;

/**
 * Realtime + accurate unread count. Owns the single realtime channel
 * for the current user so the bell stays live without the dropdown
 * needing its own subscription.
 */
export function useNotificationUnreadCount() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: countKey(user?.id),
    enabled: !!user,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<number> => {
      if (!user) return 0;
      const { count, error } = await supabase
        .from('notifications' as any)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('read_at', null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => {
          qc.invalidateQueries({ queryKey: listKey(user.id) });
          qc.invalidateQueries({ queryKey: countKey(user.id) });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, qc]);

  return query.data ?? 0;
}

/**
 * List of latest notifications. No realtime subscription — relies on
 * `useNotificationUnreadCount` (mounted on the bell) to invalidate
 * this query when new rows arrive.
 */
export function useNotificationList() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: listKey(user?.id),
    enabled: !!user,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<NotificationRow[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('notifications' as any)
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT);
      if (error) throw error;
      return (data ?? []) as unknown as NotificationRow[];
    },
  });

  return {
    notifications: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

export function useNotificationActions() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: listKey(user?.id) });
    qc.invalidateQueries({ queryKey: countKey(user?.id) });
  };

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('mark_notification_read' as any, { notification_id: id });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('mark_all_notifications_read' as any);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { markRead, markAllRead };
}

/**
 * Back-compat wrapper. Prefer the focused hooks above.
 * Composes count + list + actions; only use where you genuinely need all three.
 */
export function useNotifications() {
  const unreadCount = useNotificationUnreadCount();
  const { notifications, isLoading, refetch } = useNotificationList();
  const { markRead, markAllRead } = useNotificationActions();
  return { notifications, unreadCount, isLoading, refetch, markRead, markAllRead };
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
