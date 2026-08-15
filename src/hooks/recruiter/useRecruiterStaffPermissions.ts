/**
 * Phase RC-1D — recruiter staff permission resolution hook.
 *
 * Reads ONLY `get_my_recruiter_permissions(_recruiter_id)` (RC-1B) and parses
 * it strictly. Client state is UX only; the database is authoritative.
 *
 * Fail-closed: loading, error, or malformed payload => every boolean false.
 * Mounts no profile, billing, opportunity, application, referral, contract,
 * settlement, or Agency query.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  emptyRecruiterStaffPermissions,
  parseRecruiterStaffPermissions,
  type ParsedRecruiterStaffPermissions,
} from '@/lib/recruiterStaffPermissions';

// Narrow local adapter — generated types are not edited here.
type GetMyRecruiterPermissionsRpc = (
  fn: 'get_my_recruiter_permissions',
  args: { _recruiter_id: string },
) => PromiseLike<{ data: unknown; error: unknown }>;

const callGetMyRecruiterPermissions = supabase.rpc.bind(
  supabase,
) as unknown as GetMyRecruiterPermissionsRpc;

export interface RecruiterStaffPermissionsState {
  permissions: ParsedRecruiterStaffPermissions;
  canViewOpportunities: boolean;
  canCreateOpportunities: boolean;
  canEditOpportunities: boolean;
  canChangeOpportunityStatus: boolean;
  canDeleteOpportunities: boolean;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

export function useRecruiterStaffPermissions(
  recruiterId: string | null | undefined,
): RecruiterStaffPermissionsState {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const query = useQuery({
    // Query key is scoped to BOTH the authenticated user and the workspace so
    // no permission map can leak across accounts through the cache.
    queryKey: ['recruiter_staff_permissions', userId, recruiterId ?? null],
    enabled: !!userId && !!recruiterId,
    queryFn: async (): Promise<ParsedRecruiterStaffPermissions> => {
      const resp = await callGetMyRecruiterPermissions(
        'get_my_recruiter_permissions',
        { _recruiter_id: recruiterId as string },
      );
      if (resp.error) throw new Error('Unable to resolve workspace permissions.');
      const parsed = parseRecruiterStaffPermissions(resp.data);
      if (!parsed) throw new Error('Unable to resolve workspace permissions.');
      return parsed;
    },
  });

  const resolved =
    query.data && !query.isError ? query.data : emptyRecruiterStaffPermissions();
  const granted = query.isSuccess && !!query.data;

  return {
    permissions: resolved,
    canViewOpportunities: granted && resolved.opportunities_view === true,
    canCreateOpportunities: granted && resolved.opportunities_create === true,
    canEditOpportunities: granted && resolved.opportunities_edit === true,
    canChangeOpportunityStatus: granted && resolved.opportunities_change_status === true,
    canDeleteOpportunities: granted && resolved.opportunities_delete === true,
    isLoading: !!userId && !!recruiterId && query.isPending,
    error: query.error ?? null,
    refetch: () => { void query.refetch(); },
  };
}
