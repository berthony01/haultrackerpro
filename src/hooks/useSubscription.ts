import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAdmin } from '@/hooks/useAdmin';
import { isProStatus, PlanKey } from '@/lib/billing/plans';
import { useOwnerQaPersona } from '@/hooks/useOwnerQaPersona';
import { driverQaOverlay } from '@/lib/billing/ownerQaPersona';


export interface SubscriptionState {
  isLoading: boolean;
  isPro: boolean;
  planKey: PlanKey;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
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

  const fetchSubscription = useCallback(async () => {
    if (!user) {
      setPlanKey('free');
      setStatus('free');
      setCancelAtPeriodEnd(false);
      setCurrentPeriodEnd(null);
      setIsLoading(false);
      return;
    }

    // Admin override — always Pro
    if (isAdmin) {
      setPlanKey('pro_monthly');
      setStatus('active');
      setCancelAtPeriodEnd(false);
      setCurrentPeriodEnd(null);
      setIsLoading(false);
      return;
    }

    try {
      // Read from subscriptions table (canonical source)
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('plan_key, status, cancel_at_period_end, current_period_end')
        .eq('user_id', user.id)
        .maybeSingle();

      if (sub) {
        setPlanKey((sub.plan_key as PlanKey) || 'free');
        setStatus(sub.status || 'free');
        setCancelAtPeriodEnd(sub.cancel_at_period_end || false);
        setCurrentPeriodEnd(sub.current_period_end || null);
      }

      // Sync with Stripe (can only upgrade, never downgrade admin/manual overrides)
      try {
        const { data } = await supabase.functions.invoke('check-subscription');
        if (data?.subscribed === true) {
          const { data: freshSub } = await supabase
            .from('subscriptions')
            .select('plan_key, status, cancel_at_period_end, current_period_end')
            .eq('user_id', user.id)
            .maybeSingle();
          if (freshSub) {
            setPlanKey((freshSub.plan_key as PlanKey) || 'free');
            setStatus(freshSub.status || 'free');
            setCancelAtPeriodEnd(freshSub.cancel_at_period_end || false);
            setCurrentPeriodEnd(freshSub.current_period_end || null);
          }
        } else if (sub && !isProStatus(sub.status)) {
          setPlanKey('free');
          setStatus('free');
        }
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

  return {
    isLoading,
    isPro,
    planKey,
    status,
    cancelAtPeriodEnd,
    currentPeriodEnd,
    refetch: fetchSubscription,
  };
}
