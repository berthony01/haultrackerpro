import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  deriveUserCapabilitiesView,
  type UserCapabilityRow,
  type UserCapabilityStatus,
  type UserCapabilitiesView,
} from '@/lib/userCapabilities';

/**
 * Phase 1J-A — Server-authoritative additive capability hook.
 *
 * Sources capability rows exclusively from the two new RPCs
 * (`get_my_user_capabilities`, `begin_recruiter_setup`). Never infers
 * capabilities from localStorage, sessionStorage, loads, billing, Stripe,
 * recruiter plan, or client-supplied roles.
 */
export interface UseUserCapabilitiesResult extends UserCapabilitiesView {
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
  beginRecruiterSetup: () => Promise<UserCapabilityStatus>;
  beginRecruiterSetupPending: boolean;
}

const EMPTY: UserCapabilityRow[] = [];

export function useUserCapabilities(): UseUserCapabilitiesResult {
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['user-capabilities', user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<UserCapabilityRow[]> => {
      const { data, error } = await (supabase as any).rpc('get_my_user_capabilities');
      if (error) throw error;
      const rows = Array.isArray(data) ? (data as UserCapabilityRow[]) : EMPTY;
      return rows;
    },
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<UserCapabilityStatus> => {
      const { data, error } = await (supabase as any).rpc('begin_recruiter_setup');
      if (error) throw error;
      return data as UserCapabilityStatus;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-capabilities', user?.id] });
    },
  });

  const beginRecruiterSetup = useCallback(async () => {
    return await mutation.mutateAsync();
  }, [mutation]);

  const view = useMemo(
    () => deriveUserCapabilitiesView(query.data ?? EMPTY),
    [query.data],
  );

  return {
    ...view,
    isLoading: authLoading || (!!user && query.isLoading),
    error: (query.error as Error | null) ?? null,
    refetch: query.refetch,
    beginRecruiterSetup,
    beginRecruiterSetupPending: mutation.isPending,
  };
}
