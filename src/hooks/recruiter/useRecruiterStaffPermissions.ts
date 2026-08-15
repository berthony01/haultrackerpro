/**
 * Phase RC-1D — recruiter staff permission resolution hook.
 *
 * Reads ONLY `get_my_recruiter_permissions(_recruiter_id)` (RC-1B) and parses
 * it strictly. Client state is UX only; the database is authoritative.
 *
 * Fail-closed: loading, error, or malformed payload => every boolean false.
 * Mounts no profile, billing, opportunity, application, referral, contract,
 * settlement, or Agency query.
 *
 * ARCHITECTURE NOTE — intentional compatibility deviation (same as RC-1C
 * `useRecruiterStaffWorkspace`): this hook uses a generation-guarded
 * `useEffect` fetch instead of React Query because the recruiter shell is
 * mounted by existing consumers/tests without a `QueryClientProvider`.
 * Resolution is still strictly scoped to the authenticated user AND the
 * recruiter workspace, so no permission map can leak across accounts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Phase RC-1E — application authorization booleans (UX only). */
  canViewApplications: boolean;
  canManageApplicationStatus: boolean;
  canRequestApplicationContact: boolean;
  /**
   * Phase RC-1E — parsed RC-1B boolean exposed for future UI ONLY.
   * DORMANT: no RC-1E surface consumes it operationally.
   */
  canManageApplicationNotes: boolean;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}


interface Resolved {
  /** Scope guard: the exact (user, recruiter) pair the payload belongs to. */
  userId: string;
  recruiterId: string;
  permissions: ParsedRecruiterStaffPermissions | null;
  error: unknown;
}

export function useRecruiterStaffPermissions(
  recruiterId: string | null | undefined,
): RecruiterStaffPermissionsState {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const id = recruiterId ?? null;

  const requestRef = useRef(0);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(!!userId && !!id);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // Invalidate any in-flight request on EVERY run, including logout.
    requestRef.current += 1;
    const generation = requestRef.current;

    if (!userId || !id) {
      setResolved(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let cancelled = false;

    void (async () => {
      let payload: unknown = null;
      let error: unknown = null;
      try {
        const resp = await callGetMyRecruiterPermissions(
          'get_my_recruiter_permissions',
          { _recruiter_id: id },
        );
        if (resp.error) error = new Error('Unable to resolve workspace permissions.');
        else payload = resp.data;
      } catch {
        error = new Error('Unable to resolve workspace permissions.');
      }
      if (cancelled || generation !== requestRef.current) return;

      const parsed = error ? null : parseRecruiterStaffPermissions(payload);
      setResolved({
        userId,
        recruiterId: id,
        permissions: parsed,
        error: error ?? (parsed ? null : new Error('Unable to resolve workspace permissions.')),
      });
      setIsLoading(false);
    })();

    return () => { cancelled = true; };
  }, [userId, id, reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  // Fail closed unless the resolved payload belongs to the exact current pair.
  const scoped =
    resolved && resolved.userId === userId && resolved.recruiterId === id ? resolved : null;
  const granted = !!scoped && !scoped.error && !!scoped.permissions;
  const permissions = granted
    ? (scoped!.permissions as ParsedRecruiterStaffPermissions)
    : emptyRecruiterStaffPermissions();

  return {
    permissions,
    canViewOpportunities: granted && permissions.opportunities_view === true,
    canCreateOpportunities: granted && permissions.opportunities_create === true,
    canEditOpportunities: granted && permissions.opportunities_edit === true,
    canChangeOpportunityStatus: granted && permissions.opportunities_change_status === true,
    canDeleteOpportunities: granted && permissions.opportunities_delete === true,
    isLoading: !!userId && !!id && isLoading,
    error: scoped?.error ?? null,
    refetch,
  };
}
