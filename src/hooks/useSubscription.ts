import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAdmin } from '@/hooks/useAdmin';
import { isProStatus, PlanKey } from '@/lib/billing/plans';

export interface SubscriptionState {
  isLoading: boolean;
  isPro: boolean;
  isTrialing: boolean;
  planKey: PlanKey;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  refetch: () => void;
}

export function useSubscription(): SubscriptionState {
  const { user } = useAuth();
  const { isAdmin, isLoading: isAdminLoading } = useAdmin();
  const [isLoading, setIsLoading] = useState(true);
  const [planKey, setPlanKey] = useState<PlanKey>('free');
  const [status, setStatus] = useState('free');
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
  const [trialEnd, setTrialEnd] = useState<string | null>(null);

  const fetchSubscription = useCallback(async () => {
    if (!user) {
      setPlanKey('free');
      setStatus('free');
      setCancelAtPeriodEnd(false);
      setCurrentPeriodEnd(null);
      setTrialEnd(null);
      setIsLoading(false);
      return;
    }

    // Admin override — always Pro
    if (isAdmin) {
      setPlanKey('pro_monthly');
      setStatus('active');
      setCancelAtPeriodEnd(false);
      setCurrentPeriodEnd(null);
      setTrialEnd(null);
      setIsLoading(false);
      return;
    }

    try {
      // Read from subscriptions table (canonical source)
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('plan_key, status, cancel_at_period_end, current_period_end, trial_end')
        .eq('user_id', user.id)
        .maybeSingle();

      if (sub) {
        setPlanKey((sub.plan_key as PlanKey) || 'free');
        setStatus(sub.status || 'free');
        setCancelAtPeriodEnd(sub.cancel_at_period_end || false);
        setCurrentPeriodEnd(sub.current_period_end || null);
        setTrialEnd(sub.trial_end || null);
      }

      // Also trigger edge function to sync with Stripe (can only upgrade, never downgrade admin/manual overrides)
      try {
        const { data } = await supabase.functions.invoke('check-subscription');
        if (data?.subscribed === true) {
          // Re-read subscription after edge function may have updated it
          const { data: freshSub } = await supabase
            .from('subscriptions')
            .select('plan_key, status, cancel_at_period_end, current_period_end, trial_end')
            .eq('user_id', user.id)
            .maybeSingle();
          if (freshSub) {
            setPlanKey((freshSub.plan_key as PlanKey) || 'free');
            setStatus(freshSub.status || 'free');
            setCancelAtPeriodEnd(freshSub.cancel_at_period_end || false);
            setCurrentPeriodEnd(freshSub.current_period_end || null);
            setTrialEnd(freshSub.trial_end || null);
          }
        } else if (sub && !isProStatus(sub.status)) {
          // Only downgrade if DB already shows non-pro
          setPlanKey('free');
          setStatus('free');
        }
        // If sub shows pro but edge says no → keep DB value (manual override)
      } catch {
        // Keep DB-based state on error
      }
    } catch {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  }, [user, isAdmin]);

  useEffect(() => {
    if (isAdminLoading) return;
    fetchSubscription();

    // Refetch on tab focus / visibility change instead of polling every 60s.
    // Throttle to at most once per 30s to avoid bursts on rapid tab switching.
    let lastFetch = Date.now();
    const maybeRefetch = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastFetch < 30_000) return;
      lastFetch = now;
      fetchSubscription();
    };

    window.addEventListener('focus', maybeRefetch);
    document.addEventListener('visibilitychange', maybeRefetch);
    return () => {
      window.removeEventListener('focus', maybeRefetch);
      document.removeEventListener('visibilitychange', maybeRefetch);
    };
  }, [fetchSubscription, isAdminLoading]);

  const isPro = isAdmin || isProStatus(status);
  const isTrialing = status === 'trialing';

  return {
    isLoading,
    isPro,
    isTrialing,
    planKey,
    status,
    cancelAtPeriodEnd,
    currentPeriodEnd,
    trialEnd,
    refetch: fetchSubscription,
  };
}
