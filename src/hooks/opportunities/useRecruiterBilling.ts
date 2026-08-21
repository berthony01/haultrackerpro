import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRecruiterProfile } from './useRecruiterProfile';
import type { Tables } from '@/integrations/supabase/types';
import {
  getRecruiterCapabilitiesForTier,
  isRecruiterPaidPlanActive,
  resolveRecruiterCapabilityTier,
  isRecruiterTierAvailableForNewCheckout,
  RECRUITER_TIER_ACTIVE_OPPORTUNITY_LIMITS,
} from '@/lib/recruiterCapabilities';

import { useMyAgency } from '@/hooks/useAgency';
import { useAgencyEntitlement } from '@/hooks/useAgencyEntitlement';
import {
  resolveEffectiveBusinessEntitlement,
  type EffectiveBusinessEntitlement,
} from '@/lib/billing/effectiveBusinessEntitlement';
import { useOwnerQaPersona } from '@/hooks/useOwnerQaPersona';
import { applyBusinessQaOverlay } from '@/lib/billing/ownerQaPersona';


import {
  isSafeStripeCheckoutUrl,
  isSafeStripeBillingPortalUrl,
  parseCheckoutError,
  RECRUITER_CHECKOUT_MESSAGES,
  RECRUITER_CHECKOUT_COOLDOWN_MS,
  RECRUITER_BILLING_POPUP_NAME,
  RECRUITER_SUPPORT_CODES,
  type ParsedCheckoutError,
  type RecruiterCheckoutCode,
} from '@/lib/opportunities/recruiterCheckoutMessages';
import {
  deriveRecruiterBillingUiState,
  canStartCheckout as canStartCheckoutFn,
  shouldShowManageBilling as shouldShowManageBillingFn,
  checkStatusVisibility as checkStatusVisibilityFn,
  stateHeadline as stateHeadlineFn,
  type PaidPlan,
  type RecruiterBillingUiState,
} from '@/lib/opportunities/recruiterBillingState';
import { describeRecruiterEligibility } from '@/lib/opportunities/recruiterEligibility';

export type RecruiterBilling = Tables<'recruiter_billing_profiles'>;
export type RecruiterPlan = 'none' | 'starter' | 'growth' | 'fleet';

/**
 * Phase 1R-E1 — recruiter plan → active-opportunity ceiling. Derived from the
 * canonical tier matrix in `@/lib/recruiterCapabilities` so there is exactly
 * one client-side definition. `none` maps to the free Standard tier.
 */
export const RECRUITER_PLAN_LIMITS: Record<RecruiterPlan, number> = {
  none: RECRUITER_TIER_ACTIVE_OPPORTUNITY_LIMITS.free_verified,
  starter: RECRUITER_TIER_ACTIVE_OPPORTUNITY_LIMITS.starter,
  growth: RECRUITER_TIER_ACTIVE_OPPORTUNITY_LIMITS.growth,
  fleet: RECRUITER_TIER_ACTIVE_OPPORTUNITY_LIMITS.fleet,
};


export const RECRUITER_PLAN_LABELS: Record<RecruiterPlan, string> = {
  none: 'No Plan',
  starter: 'Starter',
  growth: 'Growth',
  fleet: 'Fleet',
};

export interface RecruiterCheckoutFailure extends Error {
  code: ParsedCheckoutError['code'];
  /** Validated Stripe URL surfaced ONLY on popup-blocked path. */
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
  const {
    profile,
    isLoading: profileLoading,
    isSuspended,
    isProfileComplete,
  } = useRecruiterProfile();

  const recruiterId = profile?.id ?? null;
  const qc = useQueryClient();

  // Deterministic single popup. Same name across window.open() calls
  // guarantees rapid clicks reuse the same tab.
  const pendingWindowRef = useRef<Window | null>(null);
  // Guard against re-entrance from a rapid second click on the SAME
  // button-press cycle (before mutation.isPending flips).
  const openingRef = useRef<boolean>(false);

  // ---- Popup helpers -----------------------------------------------------

  const prepareTab = useCallback(() => {
    if (openingRef.current) return;
    openingRef.current = true;
    try {
      // Phase 1G-R1A7-R1: real-Chromium testing proved that passing
      // 'noopener' OR 'noreferrer' as a window feature makes window.open()
      // return null unconditionally (Chromium treats noreferrer as implying
      // noopener) — so the intended auto-navigate happy path was dead code
      // in every real browser; every checkout silently fell through to the
      // popup-blocked fallback link. We instead take a real handle here and
      // close the tabnabbing vector explicitly via `w.opener = null` in
      // settleTab(), which is the standard safe pattern for this exact case.
      pendingWindowRef.current = window.open(
        'about:blank',
        RECRUITER_BILLING_POPUP_NAME,
      );
    } catch {
      pendingWindowRef.current = null;
    }
  }, []);

  // Phase 1R-D2-B6-B1 — every access to the popup WindowProxy (including the
  // `closed` getter, `opener`, `location`, and `close`) is contained inside
  // try/catch. In sandboxed/opaque preview windows those property reads can
  // themselves throw; an uncaught throw here surfaced the full preview error
  // overlay instead of the controlled checkout fallback UI.
  const isTabUsable = (w: Window | null): boolean => {
    if (!w) return false;
    try {
      return !w.closed;
    } catch {
      return false;
    }
  };

  const closeTabBestEffort = (w: Window | null): void => {
    if (!w) return;
    try {
      w.close();
    } catch {
      /* ignore */
    }
  };

  const settleTab = useCallback(
    (validatedUrl: string): { opened: boolean; url: string } => {
      const w = pendingWindowRef.current;
      pendingWindowRef.current = null;
      openingRef.current = false;
      if (isTabUsable(w)) {
        try {
          (w as unknown as { opener: unknown }).opener = null;
          (w as Window).location.href = validatedUrl;
          return { opened: true, url: validatedUrl };
        } catch {
          closeTabBestEffort(w);
        }
      }
      return { opened: false, url: validatedUrl };
    },
    [],
  );

  const discardTab = useCallback(() => {
    const w = pendingWindowRef.current;
    pendingWindowRef.current = null;
    openingRef.current = false;
    if (isTabUsable(w)) {
      closeTabBestEffort(w);
    }
  }, []);


  // ---- Queries -----------------------------------------------------------

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
  // Phase 1R-E1-R1 — the raw ceiling is EXACTLY the canonical per-plan value.
  // A stale `active_opportunity_limit` column value from a pre-1R-E1 row is
  // never allowed to over-grant (or under-grant) the plan's canonical ceiling.
  // The raw `billing` row remains exposed separately for callers that need it.
  const limit = RECRUITER_PLAN_LIMITS[plan] ?? RECRUITER_PLAN_LIMITS.none;


  const status = billing?.status ?? 'inactive';
  const isBillingActive = status === 'active' || status === 'trialing'; // trial-allowlist
  const activeCount = activeCountQuery.data ?? 0;

  /** @deprecated Legacy pre-pivot posting-limit flag. */
  const legacyCanSubmitMore_DO_NOT_USE_FOR_STANDARD_POSTING =
    isBillingActive && activeCount < limit;

  // ---- Phase 1R-C: effective business entitlement ------------------------
  //
  // RAW recruiter billing (above) stays the ONLY source for recruiter Stripe
  // checkout / portal / subscription fields. The EFFECTIVE entitlement below
  // may additionally come from an included agency entitlement and is the
  // source for premium feature capability gates.
  const myAgency = useMyAgency();
  const agencyId = myAgency.data?.id ?? null;
  const agencyEnt = useAgencyEntitlement(agencyId);
  const hasRealAgency = !!agencyId;

  const recruiterSourceState: 'ready' | 'loading' | 'error' = billingQuery.isError
    ? 'error'
    : profileLoading || billingQuery.isLoading
      ? 'loading'
      : 'ready';

  const agencySourceState: 'ready' | 'loading' | 'error' =
    myAgency.isError || (hasRealAgency && agencyEnt.isError)
      ? 'error'
      : myAgency.isLoading || (hasRealAgency && agencyEnt.isLoading)
        ? 'loading'
        : 'ready';

  // `get_my_agency` joins agency_members with `am.status = 'active'`, so a
  // returned row proves the caller is an ACTIVE member of that agency.
  const agencyMembershipStatus = myAgency.data ? 'active' : null;
  const agencyMembershipRole = myAgency.data?.my_role ?? null;

  const agencyEntitlementRow = agencyEnt.entitlement;
  const agencyHasRow = agencyEnt.hasRow;

  // Phase TG-2E3-O2 — Owner QA persona overlay (super_admin only, server-resident).
  const ownerQa = useOwnerQaPersona();
  const ownerQaSelection = ownerQa.isActive ? ownerQa.selection : null;

  const effectiveBusinessEntitlement: EffectiveBusinessEntitlement = useMemo(
    () =>
      resolveEffectiveBusinessEntitlement(
        applyBusinessQaOverlay(
          {
            sourceState: {
              recruiterBilling: recruiterSourceState,
              agencyEntitlement: agencySourceState,
            },
            recruiterBilling: {
              hasRow: !!billing,
              plan: billing?.plan ?? null,
              status: billing?.status ?? null,
            },
            agencyEntitlement: {
              hasRow: agencyHasRow,
              planKey: agencyHasRow ? agencyEntitlementRow.planKey : null,
              status: agencyHasRow ? agencyEntitlementRow.status : null,
              source: agencyHasRow ? agencyEntitlementRow.source : null,
            },
            agencyMembership: {
              role: agencyMembershipRole,
              status: agencyMembershipStatus,
            },
            recruiterProfile: {
              exists: !!profile,
              readyToPost: isProfileComplete,
              suspended: isSuspended,
            },
          },
          ownerQaSelection,
        ),
      ),
    [
      recruiterSourceState,
      agencySourceState,
      billing,
      agencyHasRow,
      agencyEntitlementRow.planKey,
      agencyEntitlementRow.status,
      agencyEntitlementRow.source,
      agencyMembershipRole,
      agencyMembershipStatus,
      profile,
      isProfileComplete,
      isSuspended,
      ownerQaSelection,
    ],
  );


  const effectiveRecruiterTier = effectiveBusinessEntitlement.effectiveRecruiterTier;
  const effectiveRecruiterPlan: RecruiterPlan =
    effectiveRecruiterTier === 'free_verified' ? 'none' : effectiveRecruiterTier;
  const hasEffectivePremiumRecruiterAccess =
    effectiveBusinessEntitlement.state === 'resolved' &&
    effectiveRecruiterTier !== 'free_verified';
  const isBusinessEntitlementLoading =
    effectiveBusinessEntitlement.state === 'loading';

  const capabilities = getRecruiterCapabilitiesForTier({
    tier: effectiveRecruiterTier,
    canPostStandardOpportunities:
      effectiveBusinessEntitlement.canPostStandardOpportunities,
  });

  // Phase 1R-E1-R1 — effective, entitlement-aware active-opportunity ceiling.
  // Fail closed: an unresolved (loading / error) or conflicting business
  // entitlement grants ZERO activation headroom. It never falls back to the
  // free ceiling of 1, and it never reads the raw agency DB limit column.
  const isBusinessEntitlementConflict =
    effectiveBusinessEntitlement.state === 'conflict';
  const effectiveActiveOpportunityLimit =
    effectiveBusinessEntitlement.state === 'resolved'
      ? RECRUITER_PLAN_LIMITS[effectiveRecruiterPlan]
      : 0;
  const remainingActiveOpportunities = Math.max(
    0,
    effectiveActiveOpportunityLimit - activeCount,
  );
  // Phase 1R-E1-R2 — the active count must be BOTH settled and successful.
  // A failed count query previously fell back to 0 and could wrongly grant
  // activation headroom; it now fails closed exactly like an unresolved
  // entitlement. The raw query error is never surfaced to the recruiter.
  const activeCountUnavailable = activeCountQuery.isError;
  const activeCountSettled = !activeCountQuery.isLoading;
  const canActivateAnotherOpportunity: boolean =
    effectiveBusinessEntitlement.state === 'resolved' &&
    effectiveActiveOpportunityLimit > 0 &&
    activeCountSettled &&
    !activeCountUnavailable &&
    activeCount < effectiveActiveOpportunityLimit;
  const isAtActiveOpportunityLimit =
    activeCountSettled && !canActivateAnotherOpportunity;
  const activeOpportunityLimitMessage = !isAtActiveOpportunityLimit
    ? null
    : isBusinessEntitlementConflict
      ? 'We found two paid business subscriptions on your account, so publishing is paused. Contact support to resolve your billing before publishing another opportunity.'
      : effectiveActiveOpportunityLimit === 0 || activeCountUnavailable
        ? 'We could not confirm your plan, so publishing is paused. Refresh in a moment, or contact support if this keeps happening.'
        : `You've reached your plan limit of ${effectiveActiveOpportunityLimit} active ${
            effectiveActiveOpportunityLimit === 1
              ? 'opportunity'
              : 'opportunities'
          }. Pause or close a listing, or upgrade your plan, to publish another.`;




  const refetchBilling = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['recruiter_billing'] });
    qc.invalidateQueries({ queryKey: ['recruiter_active_opportunity_count'] });
    qc.invalidateQueries({ queryKey: ['recruiter_profile'] });
    // Phase 1R-C: effective entitlement also depends on agency state.
    qc.invalidateQueries({ queryKey: ['my-agency'] });
    qc.invalidateQueries({ queryKey: ['agency-entitlement'] });
  }, [qc]);


  // ---- Server-progress + error state (drives the UI state machine) ------

  const [serverProgress, setServerProgress] = useState<{
    kind: 'in_progress' | 'processing';
    cooldownActive: boolean;
  } | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCooldownTimer = () => {
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
  };

  useEffect(() => () => clearCooldownTimer(), []);

  const startServerProgress = (kind: 'in_progress' | 'processing') => {
    clearCooldownTimer();
    setServerProgress({ kind, cooldownActive: true });
    cooldownTimerRef.current = setTimeout(() => {
      setServerProgress((s) => (s ? { ...s, cooldownActive: false } : null));
    }, RECRUITER_CHECKOUT_COOLDOWN_MS);
  };

  const clearServerProgress = () => {
    clearCooldownTimer();
    setServerProgress(null);
  };

  const [popupBlockedCheckout, setPopupBlockedCheckout] = useState<{
    url: string;
    plan: PaidPlan;
  } | null>(null);
  const [popupBlockedPortal, setPopupBlockedPortal] = useState<{
    url: string;
  } | null>(null);
  const [supportError, setSupportError] = useState<string | null>(null);
  const [retryableError, setRetryableError] = useState<string | null>(null);
  const [startingPlan, setStartingPlan] = useState<PaidPlan | null>(null);
  const [portalOpening, setPortalOpening] = useState<boolean>(false);

  const clearTransient = () => {
    setPopupBlockedCheckout(null);
    setPopupBlockedPortal(null);
    setSupportError(null);
    setRetryableError(null);
  };

  // ---- Derived UI state --------------------------------------------------

  const premiumEligible = useMemo(() => {
    if (!profile) return false;
    if (isSuspended) return false;
    return describeRecruiterEligibility(profile).canPost;
  }, [profile, isSuspended]);

  const uiState: RecruiterBillingUiState = useMemo(
    () =>
      deriveRecruiterBillingUiState({
        profileLoading,
        billingLoading: billingQuery.isLoading,
        profileMissing: !profileLoading && !profile,
        suspended: isSuspended,
        premiumEligible,
        subscriptionStatusRaw: billing?.status,
        hasSubscriptionRow: !!billing,
        starting: startingPlan,
        portalOpening,
        popupBlockedCheckout,
        popupBlockedPortal,
        serverProgress,
        supportError,
        retryableError,
      }),
    [
      profileLoading,
      billingQuery.isLoading,
      profile,
      isSuspended,
      premiumEligible,
      billing,
      startingPlan,
      portalOpening,
      popupBlockedCheckout,
      popupBlockedPortal,
      serverProgress,
      supportError,
      retryableError,
    ],
  );

  // Phase 1R-C fail-closed client guard: recruiter checkout requires the
  // existing recruiter UI-state permission AND a fully resolved business
  // entitlement that is not already included through an agency.
  const canStartCheckout =
    canStartCheckoutFn(uiState) &&
    effectiveBusinessEntitlement.state === 'resolved' &&
    effectiveBusinessEntitlement.entitlementSource !== 'agency_included';

  const showManageBilling = shouldShowManageBillingFn(
    uiState,
    !!billing?.stripe_subscription_id,
  );
  const checkStatus = checkStatusVisibilityFn(uiState);
  const headline = stateHeadlineFn(uiState);

  // ---- Mutations ---------------------------------------------------------

  const startCheckout = useMutation({
    mutationFn: async (selectedPlan: PaidPlan) => {
      clearTransient();
      setStartingPlan(selectedPlan);
      try {
        const { data, error } = await supabase.functions.invoke(
          'create-recruiter-checkout',
          { body: { plan: selectedPlan } },
        );
        if (error) {
          const parsed = await parseCheckoutError(error);
          discardTab();
          handleServerCode(parsed.code);
          throw makeFailure(parsed.code, parsed.message);
        }
        const url = (data as { url?: unknown } | null)?.url;
        if (!isSafeStripeCheckoutUrl(url)) {
          discardTab();
          setRetryableError(RECRUITER_CHECKOUT_MESSAGES.session_invalid);
          throw makeFailure(
            'session_invalid',
            RECRUITER_CHECKOUT_MESSAGES.session_invalid,
          );
        }
        const { opened } = settleTab(url);
        if (!opened) {
          setPopupBlockedCheckout({ url, plan: selectedPlan });
          throw makeFailure(
            'checkout_ready',
            'Your browser blocked the checkout tab. Click "Continue to secure checkout" to open it.',
            url,
          );
        }
        return { code: 'checkout_ready' as const, plan: selectedPlan };
      } finally {
        setStartingPlan(null);
      }
    },
  });

  const openPortal = useMutation({
    mutationFn: async () => {
      clearTransient();
      setPortalOpening(true);
      try {
        const { data, error } = await supabase.functions.invoke(
          'recruiter-billing-portal',
        );
        if (error) {
          discardTab();
          setRetryableError(RECRUITER_CHECKOUT_MESSAGES.internal_error);
          throw makeFailure(
            'internal_error',
            RECRUITER_CHECKOUT_MESSAGES.internal_error,
          );
        }
        const url = (data as { url?: unknown } | null)?.url;
        if (!isSafeStripeBillingPortalUrl(url)) {
          discardTab();
          setRetryableError(RECRUITER_CHECKOUT_MESSAGES.session_invalid);
          throw makeFailure(
            'session_invalid',
            RECRUITER_CHECKOUT_MESSAGES.session_invalid,
          );
        }
        const { opened } = settleTab(url);
        if (!opened) {
          setPopupBlockedPortal({ url });
          throw makeFailure(
            'checkout_ready',
            'Your browser blocked the billing portal tab. Click "Open billing portal" to continue.',
            url,
          );
        }
        return { code: 'portal_ready' as const };
      } finally {
        setPortalOpening(false);
      }
    },
  });

  function handleServerCode(code: RecruiterCheckoutCode | 'unknown_error') {
    if (code === 'in_progress') {
      startServerProgress('in_progress');
      refetchBilling();
      return;
    }
    if (code === 'checkout_processing') {
      startServerProgress('processing');
      refetchBilling();
      return;
    }
    if (code === 'subscription_exists' || code === 'unknown_subscription_status') {
      refetchBilling();
      return;
    }
    if (RECRUITER_SUPPORT_CODES.has(code)) {
      setSupportError(RECRUITER_CHECKOUT_MESSAGES[code]);
      return;
    }
    setRetryableError(RECRUITER_CHECKOUT_MESSAGES[code]);
  }

  // Called by the "Check Status" cooldown button.
  const checkServerStatus = useCallback(() => {
    clearServerProgress();
    setRetryableError(null);
    refetchBilling();
  }, [refetchBilling]);

  // Called by the Refresh button top-right — always allowed.
  const refresh = useCallback(() => {
    refetchBilling();
  }, [refetchBilling]);

  return {
    // Raw billing (kept for existing callers)
    billing,
    plan,
    status,
    limit,
    activeCount,
    isBillingActive,
    canSubmitMore: legacyCanSubmitMore_DO_NOT_USE_FOR_STANDARD_POSTING,
    isLoading:
      profileLoading ||
      billingQuery.isLoading ||
      activeCountQuery.isLoading ||
      myAgency.isLoading ||
      (hasRealAgency && agencyEnt.isLoading),

    // Phase 1R-E1: canonical active-opportunity ceiling + headroom
    effectiveActiveOpportunityLimit,
    remainingActiveOpportunities,
    isAtActiveOpportunityLimit,
    canActivateAnotherOpportunity,
    activeOpportunityLimitMessage,
    isRecruiterTierAvailableForNewCheckout,




    // Phase 1R-C: effective business entitlement (additive, never overwrites
    // the raw recruiter billing fields above)
    effectiveBusinessEntitlement,
    businessEntitlementState: effectiveBusinessEntitlement.state,
    businessEntitlementConflictReason: effectiveBusinessEntitlement.conflictReason,
    effectiveRecruiterTier,
    effectiveRecruiterPlan,
    effectiveAgencyPlan: effectiveBusinessEntitlement.effectiveAgencyPlan,
    entitlementSource: effectiveBusinessEntitlement.entitlementSource,
    billingManagementContext: effectiveBusinessEntitlement.billingManagementContext,
    hasEffectivePremiumRecruiterAccess,
    isBusinessEntitlementLoading,


    // Discriminated UI state (single source of truth for the panel)
    uiState,
    canStartCheckout,
    showManageBilling,
    checkStatus,
    headline,
    checkServerStatus,

    // Mutations + popup coordination
    startCheckout,
    openPortal,
    prepareTab,
    refresh,

    // Capability layer (now resolved from the EFFECTIVE recruiter tier)
    capabilities,
    capabilityTier: capabilities.tier,
    isPaidRecruiterPlanActive: isRecruiterPaidPlanActive(plan, status),
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
