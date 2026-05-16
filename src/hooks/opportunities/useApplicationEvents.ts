import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ApplicationEvent {
  id: string;
  application_id: string;
  actor_type: 'driver' | 'recruiter' | 'system' | 'admin';
  actor_user_id: string | null;
  event_type: string;
  metadata: Record<string, any>;
  created_at: string;
}

export function useApplicationEvents(applicationId?: string | null) {
  return useQuery({
    queryKey: ['application_events', applicationId],
    enabled: !!applicationId,
    queryFn: async (): Promise<ApplicationEvent[]> => {
      if (!applicationId) return [];
      const { data, error } = await supabase
        .from('application_events' as any)
        .select('*')
        .eq('application_id', applicationId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ApplicationEvent[];
    },
  });
}
