import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  deriveUserCapabilitiesView,
  parseUserCapabilityRows,
  parseUserCapabilityStatus,
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
 * recruiter plan, or client-supplied roles. All RPC payloads are passed
 * through the pure parsers in `@/lib/userCapabilities`.
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
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: ['user-capabilities', userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<UserCapabilityRow[]> => {
      const { data, error } = await (supabase as any).rpc('get_my_user_capabilities');
      if (error) throw error;
      return parseUserCapabilityRows(data);
    },
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<UserCapabilityStatus> => {
      if (!userId) {
        throw new Error('Not authenticated');
      }
      const { data, error } = await (supabase as any).rpc('begin_recruiter_setup');
      if (error) throw error;
      return parseUserCapabilityStatus(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-capabilities', userId] });
    },
  });

  const beginRecruiterSetup = useCallback(async () => {
    if (!userId) {
      throw new Error('Not authenticated');
    }
    return await mutation.mutateAsync();
  }, [mutation, userId]);

  const view = useMemo(
    () => deriveUserCapabilitiesView(query.data ?? EMPTY),
    [query.data],
  );

  return {
    ...view,
    isLoading: authLoading || (!!userId && query.isLoading),
    error: (query.error as Error | null) ?? null,
    refetch: query.refetch,
    beginRecruiterSetup,
    beginRecruiterSetupPending: mutation.isPending,
  };
}
