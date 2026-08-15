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
