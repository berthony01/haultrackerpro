import { useRef } from 'react';
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
import {
  isSafeStripeCheckoutUrl,
  isSafeStripeBillingPortalUrl,
  parseCheckoutError,
  RECRUITER_CHECKOUT_MESSAGES,
  type ParsedCheckoutError,
} from '@/lib/opportunities/recruiterCheckoutMessages';

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

// Codes that indicate the server made progress on billing state and the
// client should refetch billing so any subsequent action sees fresh state.
const REFETCH_CODES = new Set<ParsedCheckoutError['code']>([
  'in_progress',
  'subscription_exists',
  'checkout_processing',
  'unknown_subscription_status',
]);

export interface RecruiterCheckoutFailure extends Error {
  code: ParsedCheckoutError['code'];
  /**
   * Fallback URL surfaced ONLY when the browser blocked the sync-opened tab.
   * Validated against `checkout.stripe.com` or `billing.stripe.com` before
   * being set. Never populated on any other failure path.
   */
  fallbackUrl?: string;
}

function makeFailure(
  code: ParsedCheckoutError['code'],
  message: string,
  fallbackUrl?: string,
): RecruiterCheckoutFailure {
  const err = new Error(message) as RecruiterCheckoutFailure;
  err.code = code;
  if (fallbackUrl) err.fallbackUrl = fallbackUrl;
  return err;
}

export function useRecruiterBilling() {
  const { user } = useAuth();
  const { profile, isApproved, isSuspended } = useRecruiterProfile();
  const recruiterId = profile?.id ?? null;
  const qc = useQueryClient();

  // Track the sync-opened blank tab across the async invoke, so we can either
  // navigate it to the validated Stripe URL or close it if the server call
  // fails. Popup blockers null the return value of window.open — we detect
  // that and surface an accessible fallback with the validated URL only.
  const pendingWindowRef = useRef<Window | null>(null);

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
   */
  const legacyCanSubmitMore_DO_NOT_USE_FOR_STANDARD_POSTING =
    isBillingActive && activeCount < limit;

  const capabilities = getRecruiterPlanCapabilities({
    plan,
    status,
    isApprovedRecruiter: isApproved,
    isSuspended,
  });

  const capabilityTier = capabilities.tier;
  const isPaidRecruiterPlanActive = isRecruiterPaidPlanActive(plan, status);

  const refetchBilling = () => {
    qc.invalidateQueries({ queryKey: ['recruiter_billing'] });
    qc.invalidateQueries({ queryKey: ['recruiter_active_opportunity_count'] });
  };

  /**
   * prepareTab: open the popup SYNCHRONOUSLY inside the click handler that
   * calls startCheckout.mutate(). Browsers only allow window.open() to bypass
   * the popup blocker when called directly from a user gesture — we can't do
   * this after `await`. If the browser blocks it, `pendingWindowRef.current`
   * is null and we surface a fallback button with the validated URL.
   */
  const prepareTab = () => {
    try {
      pendingWindowRef.current = window.open(
        'about:blank',
        '_blank',
        'noopener,noreferrer',
      );
    } catch {
      pendingWindowRef.current = null;
    }
  };

  const settleTab = (
    validatedUrl: string,
  ): { opened: boolean; url: string } => {
    const w = pendingWindowRef.current;
    pendingWindowRef.current = null;
    if (w && !w.closed) {
      try {
        // Belt-and-suspenders: prevent reverse-tabnabbing in case the browser
        // ignored the noopener hint on window.open (Safari edge cases).
        (w as { opener: unknown }).opener = null;
        w.location.href = validatedUrl;
        return { opened: true, url: validatedUrl };
      } catch {
        try {
          w.close();
        } catch {
          /* ignore */
        }
      }
    }
    return { opened: false, url: validatedUrl };
  };

  const discardTab = () => {
    const w = pendingWindowRef.current;
    pendingWindowRef.current = null;
    if (w && !w.closed) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
  };

  const startCheckout = useMutation({
    mutationFn: async (selectedPlan: Exclude<RecruiterPlan, 'none'>) => {
      const { data, error } = await supabase.functions.invoke(
        'create-recruiter-checkout',
        { body: { plan: selectedPlan } },
      );
      if (error) {
        const parsed = await parseCheckoutError(error);
        discardTab();
        if (REFETCH_CODES.has(parsed.code)) refetchBilling();
        throw makeFailure(parsed.code, parsed.message);
      }
      const url = (data as { url?: unknown } | null)?.url;
      if (!isSafeStripeCheckoutUrl(url)) {
        discardTab();
        throw makeFailure(
          'session_invalid',
          RECRUITER_CHECKOUT_MESSAGES.session_invalid,
        );
      }
      const { opened } = settleTab(url);
      if (!opened) {
        // Popup blocked. Surface a validated URL for a user-clickable fallback.
        throw makeFailure(
          'checkout_ready',
          'Your browser blocked the checkout tab. Click "Continue to secure checkout" to open it.',
          url,
        );
      }
      return { code: 'checkout_ready' as const, plan: selectedPlan };
    },
  });

  const openPortal = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        'recruiter-billing-portal',
      );
      if (error) {
        discardTab();
        throw makeFailure(
          'internal_error',
          RECRUITER_CHECKOUT_MESSAGES.internal_error,
        );
      }
      const url = (data as { url?: unknown } | null)?.url;
      if (!isSafeStripeBillingPortalUrl(url)) {
        discardTab();
        throw makeFailure(
          'session_invalid',
          RECRUITER_CHECKOUT_MESSAGES.session_invalid,
        );
      }
      const { opened } = settleTab(url);
      if (!opened) {
        throw makeFailure(
          'checkout_ready',
          'Your browser blocked the billing portal tab. Click "Open billing portal" to continue.',
          url,
        );
      }
      return { code: 'portal_ready' as const };
    },
  });

  return {
    billing,
    plan,
    status,
    limit,
    activeCount,
    isBillingActive,
    /**
     * @deprecated Legacy pre-pivot posting-limit flag.
     */
    canSubmitMore: legacyCanSubmitMore_DO_NOT_USE_FOR_STANDARD_POSTING,
    isLoading: billingQuery.isLoading || activeCountQuery.isLoading,
    startCheckout,
    openPortal,
    /** Call synchronously from the click handler BEFORE mutate(). */
    prepareTab,
    refresh: refetchBilling,
    // Capability layer
    capabilities,
    capabilityTier,
    isPaidRecruiterPlanActive,
    canPostStandardOpportunitiesCapability:
      capabilities.canPostStandardOpportunities,
    canUsePriorityPlacement: capabilities.canUsePriorityPlacement,
    canUseFeaturedListings: capabilities.canUseFeaturedListings,
    canExportRecruiterReports: capabilities.canExportRecruiterReports,
    canViewAdvancedRecruiterReports:
      capabilities.canViewAdvancedRecruiterReports,
    canUseContractWorkflowTools: capabilities.canUseContractWorkflowTools,
    canUseReferralTracking: capabilities.canUseReferralTracking,
    canUseTeamSeats: capabilities.canUseTeamSeats,
    canUseBulkOpportunityTools: capabilities.canUseBulkOpportunityTools,
  };
}

export { resolveRecruiterCapabilityTier, isRecruiterPaidPlanActive };
