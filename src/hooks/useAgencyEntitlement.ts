import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  ASSISTANT_AGENCY_PLANS,
  type AgencyEntitlement,
  type AssistantAgencyPlanKey,
  type AgencyEntitlementStatus,
  defaultUnsubscribedEntitlement,
  effectiveLimits,
} from '@/lib/agencyPlans';

/**
 * Phase 7 / Phase 1S-A2 — Read the entitlement row for an agency.
 *
 * Reads via the `get_agency_entitlement(_agency_id)` security-definer RPC,
 * so callers don't need direct table access.
 *
 * Missing row = fail closed. There is no implicit beta grant: when the
 * agency has no entitlement row we return an Agency Starter *shape* in
 * `cancelled` status so limits render, while billing reads as not active.
 * Agencies holding an explicit `manual_beta` row remain grandfathered and
 * keep working at their plan's limits.
 */
export interface UseAgencyEntitlementResult {
  entitlement: AgencyEntitlement;
  /** True when a real DB row backs the entitlement; false for fallback. */
  hasRow: boolean;
  isLoading: boolean;
  /** Phase 1R-C — surfaced so entitlement consumers can fail closed. */
  isError: boolean;
  /** Phase 1R-C — surfaced so entitlement consumers can fail closed. */
  error: Error | null;
  refetch: () => void;
}


interface EntitlementRow {
  id: string;
  agency_id: string;
  plan_key: AssistantAgencyPlanKey;
  status: AgencyEntitlementStatus;
  source: 'manual' | 'stripe' | 'admin_seed';
  active_client_limit: number | null;
  member_limit: number | null;
  service_package_limit: number | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

export function useAgencyEntitlement(
  agencyId: string | null | undefined,
): UseAgencyEntitlementResult {
  const q = useQuery({
    queryKey: ['agency-entitlement', agencyId],
    enabled: !!agencyId,
    staleTime: 60_000,
    queryFn: async (): Promise<EntitlementRow | null> => {
      const { data, error } = await (supabase as any).rpc(
        'get_agency_entitlement',
        { _agency_id: agencyId },
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as EntitlementRow | null;
    },
  });

  // Phase TG-2E3-O2 — Owner QA persona overlay (super_admin only, server-resident
  // session). Mirrors the server `get_effective_agency_limits` QA branch so the
  // rendered plan/limits match the limits the server will actually enforce.
  // Real `agency_entitlements` rows are never modified.
  const ownerQa = useOwnerQaPersona();
  const qa =
    ownerQa.isActive && ownerQa.domain === 'agency'
      ? agencyQaOverlay(ownerQa.persona)
      : null;

  const row = q.data;
  const baseEntitlement: AgencyEntitlement = row
    ? {
        agencyId: row.agency_id,
        planKey: row.plan_key,
        status: row.status,
        source: row.source,
        activeClientLimit: row.active_client_limit,
        memberLimit: row.member_limit,
        servicePackageLimit: row.service_package_limit,
        currentPeriodEnd: row.current_period_end,
        stripeCustomerId: row.stripe_customer_id,
        stripeSubscriptionId: row.stripe_subscription_id,
      }
    : defaultUnsubscribedEntitlement(agencyId ?? '');

  const entitlement: AgencyEntitlement = qa
    ? {
        ...baseEntitlement,
        planKey: qa.planKey,
        status: qa.status,
        activeClientLimit: qa.activeClientLimit,
        memberLimit: qa.memberLimit,
        servicePackageLimit: qa.servicePackageLimit,
      }
    : baseEntitlement;

  return {
    entitlement,
    hasRow: qa ? qa.hasRow : !!row,
    isLoading: q.isLoading,
    isError: q.isError,
    error: (q.error as Error | null) ?? null,
    refetch: () => q.refetch(),
  };
}



export { ASSISTANT_AGENCY_PLANS, effectiveLimits };
