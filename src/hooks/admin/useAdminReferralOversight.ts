import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAdmin } from '@/hooks/useAdmin';
import {
  aggregateAdminReferrals,
  type AdminReferralRow,
  type AdminOpportunityRow,
  type AdminRecruiterRow,
  type AdminReferralSettingsRow,
  type AdminTimeframe,
} from '@/lib/opportunities/adminReferralAggregator';

export type { AdminTimeframe } from '@/lib/opportunities/adminReferralAggregator';

export function useAdminReferralOversight(timeframe: AdminTimeframe = 'all') {
  const { isAdmin } = useAdmin();

  const query = useQuery({
    queryKey: ['admin-referral-oversight'],
    enabled: isAdmin,
    queryFn: async () => {
      const [refsRes, oppsRes, recsRes, settingsRes] = await Promise.all([
        supabase
          .from('driver_referrals')
          .select(
            'id,status,opportunity_id,recruiter_id,referring_driver_id,referred_driver_name,created_at,last_status_at',
          )
          .order('created_at', { ascending: false })
          .limit(2000),
        supabase.from('opportunities').select('id,title,recruiter_id').limit(2000),
        supabase
          .from('recruiter_profiles')
          .select('id,company_name,recruiter_name,recruiter_email')
          .limit(2000),
        supabase.from('recruiter_referral_settings').select('*').limit(2000),
      ]);
      if (refsRes.error) throw refsRes.error;
      if (oppsRes.error) throw oppsRes.error;
      if (recsRes.error) throw recsRes.error;
      if (settingsRes.error) throw settingsRes.error;
      return {
        referrals: (refsRes.data ?? []) as AdminReferralRow[],
        opportunities: (oppsRes.data ?? []) as AdminOpportunityRow[],
        recruiters: (recsRes.data ?? []) as AdminRecruiterRow[],
        settings: (settingsRes.data ?? []) as AdminReferralSettingsRow[],
      };
    },
  });

  const aggregate = useMemo(() => {
    const d = query.data;
    if (!d) return null;
    return aggregateAdminReferrals({ ...d, timeframe });
  }, [query.data, timeframe]);

  return {
    aggregate,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
