/**
 * Phase 1T-E1 — Agency settlement preparation panel.
 *
 * Presentation-only surface. It never talks to the backend directly and it
 * NEVER simulates delegation authorization: exact per-driver settlement
 * permission is decided by PostgreSQL, and a declined RPC is surfaced as a
 * useful explanation rather than pre-empted from names or roles.
 */

import { useMemo } from 'react';
import { Loader2, Lock, ShieldCheck } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAgencyEntitlement } from '@/hooks/useAgencyEntitlement';
import { useAgencyClients } from '@/hooks/useAgencyWorkflow';
import {
  BusinessSettlementManager,
  type BusinessDriverOption,
} from './BusinessSettlementManager';

/** Canonical presentation-manage statuses. Backend remains authoritative. */
export const AGENCY_SETTLEMENT_MANAGE_STATUSES = [
  'active',
  'trialing',
  'manual_beta',
] as const;

export function canAgencyManageSettlementsPresentation(
  status: string | null | undefined,
): boolean {
  return AGENCY_SETTLEMENT_MANAGE_STATUSES.some((s) => s === status);
}

export interface AgencyClientLike {
  driver_user_id: string;
  driver_name: string | null;
  driver_email: string | null;
}

/** Privacy-safe agency driver options. Never falls back to a raw identifier. */
export function buildAgencyDriverOptions(
  clients: readonly AgencyClientLike[] | null | undefined,
): BusinessDriverOption[] {
  const seen = new Map<string, BusinessDriverOption>();
  for (const client of clients ?? []) {
    if (!client?.driver_user_id || seen.has(client.driver_user_id)) continue;
    const label =
      client.driver_name?.trim() || client.driver_email?.trim() || 'Agency client';
    seen.set(client.driver_user_id, { driverUserId: client.driver_user_id, label });
  }
  return [...seen.values()];
}

export interface AgencySettlementsPanelProps {
  agencyId: string;
}

export function AgencySettlementsPanel({ agencyId }: AgencySettlementsPanelProps) {
  const { entitlement, isLoading: entitlementLoading } = useAgencyEntitlement(agencyId);
  const { data: clients, isLoading: clientsLoading } = useAgencyClients(agencyId);

  const canManage = canAgencyManageSettlementsPresentation(entitlement?.status);

  const driverOptions = useMemo(
    () => buildAgencyDriverOptions(clients as AgencyClientLike[] | null | undefined),
    [clients],
  );

  if (entitlementLoading || clientsLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settlements…
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="agency-settlements-panel">
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" /> Client settlement preparation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Prepare settlement statements for client drivers who have delegated
            settlement work to your agency. Statements are recordkeeping and
            reconciliation records — HaulTrackerPro does not issue payroll,
            withhold taxes, or transfer funds.
          </p>
          <p
            className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground"
            data-testid="agency-settlements-delegation-note"
          >
            Each driver approves settlement access separately. If an action is
            declined, that driver may not have delegated settlement permission to
            your agency yet.
          </p>
          {!canManage && (
            <p
              className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500"
              data-testid="agency-settlements-locked-note"
            >
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Preparing settlement statements requires an active agency plan.
                Your agency owner can update the plan in the Overview tab.
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      <BusinessSettlementManager
        mode="agency"
        businessId={agencyId}
        driverOptions={driverOptions}
        canManage={canManage}
        blockedReason="Preparing settlement statements requires an active agency plan."
      />
    </div>
  );
}

export default AgencySettlementsPanel;
