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
      // Phase 28B: drivers no longer have direct SELECT on the recruiter
      // table, so we cannot join it client-side. Use the safe RPC that
      // server-side filters to approved / non-suspended recruiters and
      // never returns recruiter PII or internal admin fields.
      const { data, error } = await (supabase as any).rpc(
        'list_driver_visible_opportunities',
        {
          _state: filters.state ?? null,
          _driver_type: filters.driverType ?? null,
          _route_type: filters.routeType ?? null,
        },
      );
      if (error) throw error;
      return (data ?? []) as Opportunity[];
    },
    enabled: !!user,
  });

  return {
    opportunities: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
