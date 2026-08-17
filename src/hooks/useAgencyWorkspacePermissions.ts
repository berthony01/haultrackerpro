/**
 * Phase AM-1C-A — Agency workspace permission resolution hook.
 *
 * Thin authenticated React Query wrapper around the AM-1B RPC
 * `get_my_agency_permissions(_agency_id)`. The database is the only authority;
 * this hook is UX gating only.
 *
 * Fail-closed: missing user, missing agency id, RPC error, or a malformed
 * payload resolves to an all-false permission map. Role labels are never
 * consulted and there are no role presets.
 *
 * Agency workspace permission does NOT grant driver-account access.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  emptyAgencyWorkspacePermissions,
  parseAgencyWorkspacePermissions,
  type ParsedAgencyWorkspacePermissions,
} from '@/lib/agencyWorkspacePermissions';

// Narrow local adapter — generated types are not edited in this phase.
type GetMyAgencyPermissionsRpc = (
  fn: 'get_my_agency_permissions',
  args: { _agency_id: string },
) => PromiseLike<{ data: unknown; error: unknown }>;

const callGetMyAgencyPermissions = supabase.rpc.bind(
  supabase,
) as unknown as GetMyAgencyPermissionsRpc;

export interface AgencyWorkspacePermissionsState {
  permissions: ParsedAgencyWorkspacePermissions;
  isLoading: boolean;
  isError: boolean;
  /** AM-1C-A consumer booleans (exact boolean true semantics). */
  canViewPackages: boolean;
  canManagePackages: boolean;
  /** AM-1C-B consumer booleans (exact boolean true semantics). */
  canViewClientRequests: boolean;
  canManageClientRequests: boolean;
}

export function useAgencyWorkspacePermissions(
  agencyId: string | null | undefined,
): AgencyWorkspacePermissionsState {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = !!userId && !!agencyId;

  const query = useQuery({
    // User id AND agency id are part of the key: no cross-user or
    // cross-workspace cache bleed.
    queryKey: ['agency-workspace-permissions', userId, agencyId],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<ParsedAgencyWorkspacePermissions> => {
      const { data, error } = await callGetMyAgencyPermissions('get_my_agency_permissions', {
        _agency_id: agencyId as string,
      });
      if (error) throw error;
      const parsed = parseAgencyWorkspacePermissions(data);
      // Malformed payload never grants anything.
      return parsed ?? emptyAgencyWorkspacePermissions();
    },
  });

  const resolved =
    enabled && query.isSuccess && query.data
      ? query.data
      : emptyAgencyWorkspacePermissions();

  const isLoading = enabled ? query.isPending : false;
  const isError = enabled ? query.isError : false;
  const settled = enabled && query.isSuccess && !isError;

  return {
    permissions: resolved,
    isLoading,
    isError,
    canViewPackages: settled && resolved.packages_view === true,
    canManagePackages: settled && resolved.packages_manage === true,
  };
}
