import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRecruiterProfile } from './useRecruiterProfile';
import type { Tables } from '@/integrations/supabase/types';
import {
  getRecruiterPlanCapabilities,
  isRecruiterPaidPlanActive,
  resolveRecruiterCapabilityTier,
} from '@/lib/recruiterCapabilities';

export type RecruiterBilling = Tables<'recruiter_billing_profiles'>;
export type RecruiterPlan = 'none' | 'starter' | 'growth' | 'fleet';


export const RECRUITER_PLAN_LIMITS: Record<RecruiterPlan, number> = {
  none: 0,
  starter: 1,
  growth: 5,
  fleet: 25,
};

export const RECRUITER_PLAN_LABELS: Record<RecruiterPlan, string> = {
  none: 'No Plan',
  starter: 'Starter',
  growth: 'Growth',
  fleet: 'Fleet',
};

export function useRecruiterBilling() {
  const { user } = useAuth();
  const { profile, isApproved, isSuspended } = useRecruiterProfile();
  const recruiterId = profile?.id ?? null;
  const qc = useQueryClient();


  const billingQuery = useQuery({
    queryKey: ['recruiter_billing', recruiterId],
    queryFn: async () => {
      if (!recruiterId) return null;
      const { data, error } = await supabase
        .from('recruiter_billing_profiles')
        .select('*')
        .eq('recruiter_id', recruiterId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!recruiterId,
    refetchOnWindowFocus: true,
  });

  const activeCountQuery = useQuery({
    queryKey: ['recruiter_active_opportunity_count', recruiterId],
    queryFn: async () => {
      if (!recruiterId) return 0;
      const { count, error } = await supabase
        .from('opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('recruiter_id', recruiterId)
        .eq('status', 'active');
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user && !!recruiterId,
  });

  const billing = billingQuery.data ?? null;
  const plan = (billing?.plan ?? 'none') as RecruiterPlan;
  const limit = billing?.active_opportunity_limit ?? RECRUITER_PLAN_LIMITS[plan];
  const status = billing?.status ?? 'inactive';
  const isBillingActive = status === 'active' || status === 'trialing'; // trial-allowlist
  const activeCount = activeCountQuery.data ?? 0;
  // Legacy: canSubmitMore is the pre-capability-layer numeric gate. Kept for
  // backward compatibility with existing consumers. New code should prefer
  // `capabilities.canPostStandardOpportunities`.
  const canSubmitMore = isBillingActive && activeCount < limit;

  // New capability layer. Approval/suspension come from the recruiter profile
  // hook (real `isApproved`/`isSuspended` values derived from
  // recruiter_profiles), not invented boolean fields.
  const capabilities = getRecruiterPlanCapabilities({
    plan,
    status,
    isApprovedRecruiter: isApproved,
    isSuspended,
  });

  const capabilityTier = capabilities.tier;
  const isPaidRecruiterPlanActive = isRecruiterPaidPlanActive(plan, status);

  const startCheckout = useMutation({
    mutationFn: async (selectedPlan: Exclude<RecruiterPlan, 'none'>) => {
      const { data, error } = await supabase.functions.invoke('create-recruiter-checkout', {
        body: { plan: selectedPlan },
      });
      if (error) throw error;
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error('No checkout URL returned');
      window.open(url, '_blank');
    },
  });


  const openPortal = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('recruiter-billing-portal');
      if (error) throw error;
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error('No portal URL returned');
      window.open(url, '_blank');
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['recruiter_billing'] });
    qc.invalidateQueries({ queryKey: ['recruiter_active_opportunity_count'] });
  };

  return {
    billing,
    plan,
    status,
    limit,
    activeCount,
    isBillingActive,
    canSubmitMore,
    isLoading: billingQuery.isLoading || activeCountQuery.isLoading,
    startCheckout,
    openPortal,
    refresh,
    // Capability layer (new)
    capabilities,
    capabilityTier,
    isPaidRecruiterPlanActive,
    canPostStandardOpportunitiesCapability: capabilities.canPostStandardOpportunities,
    canUsePriorityPlacement: capabilities.canUsePriorityPlacement,
    canUseFeaturedListings: capabilities.canUseFeaturedListings,
    canExportRecruiterReports: capabilities.canExportRecruiterReports,
    canViewAdvancedRecruiterReports: capabilities.canViewAdvancedRecruiterReports,
    canUseContractWorkflowTools: capabilities.canUseContractWorkflowTools,
    canUseReferralTracking: capabilities.canUseReferralTracking,
    canUseTeamSeats: capabilities.canUseTeamSeats,
    canUseBulkOpportunityTools: capabilities.canUseBulkOpportunityTools,
  };
}

export { resolveRecruiterCapabilityTier, isRecruiterPaidPlanActive };

