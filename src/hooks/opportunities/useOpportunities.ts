import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables } from '@/integrations/supabase/types';

export type Opportunity = Tables<'opportunities'>;

export interface OpportunityFilters {
  state?: string;
  driverType?: string;
  routeType?: string;
}

export function useOpportunities(filters: OpportunityFilters = {}) {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['opportunities', filters],
    queryFn: async () => {
      let q = supabase
        .from('opportunities')
        .select('*')
        .eq('status', 'active')
        .eq('admin_review_status', 'approved')
        .order('featured', { ascending: false })
        .order('published_at', { ascending: false, nullsFirst: false });

      if (filters.state) q = q.eq('hiring_state', filters.state);
      if (filters.driverType) q = q.eq('driver_type', filters.driverType);
      if (filters.routeType) q = q.eq('route_type', filters.routeType);

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  return {
    opportunities: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
