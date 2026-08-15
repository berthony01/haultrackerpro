import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables } from '@/integrations/supabase/types';
import type { ReferralStatus } from '@/lib/opportunities/referralStatus';


export type RecruiterReferral = Tables<'driver_referrals'> & {
  opportunities?: {
    id: string;
    title: string | null;
    company_name: string | null;
  } | null;
};

const SELECT = '*, opportunities:opportunity_id(id,title,company_name)';

/** Recruiter-facing: list referrals tied to own recruiter profile + update status. */
export function useRecruiterReferrals(recruiterId?: string | null) {
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ['driver_referrals', 'recruiter', recruiterId],
    enabled: !!recruiterId,
    queryFn: async (): Promise<RecruiterReferral[]> => {
      if (!recruiterId) return [];
      const { data, error } = await supabase
        .from('driver_referrals')
        .select(SELECT)
        .eq('recruiter_id', recruiterId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RecruiterReferral[];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ReferralStatus }) => {
      const { error } = await supabase
        .from('driver_referrals')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver_referrals'] });
      qc.invalidateQueries({ queryKey: ['referral_status_events'] });
    },
  });

  return {
    referrals: list.data ?? [],
    isLoading: list.isLoading,
    isError: list.isError,
    error: list.error,
    refetch: list.refetch,
    updateStatus,
  };
}

/**
 * Phase RC-1F — recruiter STAFF referral data hook.
 *
 * Completely separate from the owner hook above (which is unchanged).
 * Mounts NO recruiter profile, billing, subscription, analytics, contract,
 * application, report, or settlement query.
 *
 * Reads go ONLY through `list_recruiter_referrals_safe(_recruiter_id)`, and
 * status writes go ONLY through `update_recruiter_referral_status(...)`.
 * There is no direct `.from('driver_referrals')` access on this path — the
 * recruiter direct table policies stay owner-only. Client booleans are UX
 * only; PostgreSQL remains authoritative.
 */
export function useRecruiterStaffReferrals(args: {
  recruiterId: string | null | undefined;
  canViewReferrals: boolean;
  canManageReferralStatus: boolean;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const recruiterId = args.recruiterId ?? null;
  const canView = args.canViewReferrals === true;
  const canManageStatus = args.canManageReferralStatus === true;

  const list = useQuery({
    // Scoped by authenticated user AND recruiter workspace so no payload can
    // leak across accounts or workspaces through the cache.
    queryKey: ['recruiter_staff_referrals', user?.id, recruiterId],
    enabled: !!user && !!recruiterId && canView,
    queryFn: async (): Promise<RecruiterReferral[]> => {
      if (!user || !recruiterId || !canView) return [];
      const { data, error } = await (supabase as any).rpc(
        'list_recruiter_referrals_safe',
        { _recruiter_id: recruiterId },
      );
      if (error) throw error;
      return (data ?? []) as unknown as RecruiterReferral[];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ReferralStatus }) => {
      if (!user) throw new Error('Not authenticated');
      if (!recruiterId) throw new Error('Not authorized');
      if (!canManageStatus) throw new Error('Not authorized');
      const { data, error } = await (supabase as any).rpc(
        'update_recruiter_referral_status',
        {
          _recruiter_id: recruiterId,
          _referral_id: id,
          _status: status,
        },
      );
      if (error) throw error;
      if (data !== true) throw new Error('Referral not found');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recruiter_staff_referrals'] });
      qc.invalidateQueries({ queryKey: ['referral_status_events'] });
    },
  });

  return {
    referrals: canView ? (list.data ?? []) : [],
    isLoading: canView ? list.isLoading : false,
    isError: canView ? list.isError : false,
    error: list.error,
    refetch: list.refetch,
    updateStatus,
  };
}
