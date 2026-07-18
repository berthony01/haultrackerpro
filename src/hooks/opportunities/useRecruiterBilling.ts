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
  /**
   * @deprecated Legacy pre-pivot posting-limit flag.
   * Reflects the old "billing active + activeCount < active_opportunity_limit"
   * pay-to-post model. DO NOT use for standard opportunity posting — standard
   * posting is now verified-access based (recruiter approval/suspension).
   * Use `canPostStandardOpportunitiesCapability` (from this hook) or
   * `capabilities.canPostStandardOpportunities` instead. For premium tooling,
   * use the specific capability flags (`canUsePriorityPlacement`,
   * `canUseContractWorkflowTools`, `canExportRecruiterReports`, etc.).
   */
  const legacyCanSubmitMore_DO_NOT_USE_FOR_STANDARD_POSTING =
    isBillingActive && activeCount < limit;

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
      // Phase 1G-R1A7: extract structured {code,message}, validate URL is a
      // real Stripe checkout URL before redirecting, and never leak raw
      // server errors, IDs, or stale URLs to the browser.
      const { data, error } = await supabase.functions.invoke(
        'create-recruiter-checkout',
        { body: { plan: selectedPlan } },
      );
      if (error) {
        const parsed = await parseCheckoutError(error);
        const err = new Error(parsed.message) as Error & {
          code: ParsedCheckoutError['code'];
        };
        err.code = parsed.code;
        throw err;
      }
      const url = (data as { url?: unknown } | null)?.url;
      if (!isSafeStripeCheckoutUrl(url)) {
        const err = new Error(
          RECRUITER_CHECKOUT_MESSAGES.session_invalid,
        ) as Error & { code: ParsedCheckoutError['code'] };
        err.code = 'session_invalid';
        throw err;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
      return { code: 'checkout_ready' as const };
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
    /**
     * @deprecated Legacy pre-pivot posting-limit flag. Do NOT use for standard
     * opportunity posting. Use `canPostStandardOpportunitiesCapability` or a
     * specific premium capability flag instead. Kept only as a compatibility
     * alias for any unknown external consumers.
     */
    canSubmitMore: legacyCanSubmitMore_DO_NOT_USE_FOR_STANDARD_POSTING,
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

