/**
 * Phase RC-1I — recruiter STAFF settlement surface.
 *
 * Staff-only counterpart of the owner carrier settlement panel. It mounts NO
 * owner-only consumer: no recruiter profile hook, no billing/subscription
 * hook, no relationship invite/end mutation, no application pipeline. The only
 * workspace read is the RC-1I `list_recruiter_staff_settlement_relationships`
 * RPC, which is itself gated on `settlements_view`.
 *
 * All permission booleans passed in are PRESENTATION ONLY. Every write still
 * flows through the accepted Phase 1T RPCs, which independently re-derive
 * recruiter staff authorization in PostgreSQL.
 */

import { useMemo } from 'react';
import { ArrowLeft, Inbox, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BusinessSettlementManager,
  type BusinessDriverOption,
} from './BusinessSettlementManager';
import { useRecruiterStaffSettlementRelationships } from '@/hooks/settlements/useRecruiterStaffSettlementRelationships';

interface Props {
  recruiterId: string;
  companyName: string;
  canViewSettlements: boolean;
  canPrepareSettlements: boolean;
  canFinalizeSettlements: boolean;
  onBack: () => void;
}

export function RecruiterStaffSettlementsPanel({
  recruiterId,
  companyName,
  canViewSettlements,
  canPrepareSettlements,
  canFinalizeSettlements,
  onBack,
}: Props) {
  // Fail closed: without an explicit view grant nothing is fetched or mounted.
  const enabled = canViewSettlements === true;
  const { relationships, isLoading, error, refetch } =
    useRecruiterStaffSettlementRelationships(recruiterId, enabled);

  const driverOptions: readonly BusinessDriverOption[] = useMemo(
    () =>
      relationships.map((relationship) => ({
        driverUserId: relationship.driverUserId,
        label: 'Connected driver',
        relationshipId: relationship.id,
      })),
    [relationships],
  );

  const header = (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onBack} data-testid="staff-settlements-back">
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>
    </div>
  );

  if (!enabled) {
    return (
      <div className="space-y-4" data-testid="recruiter-staff-settlements-denied">
        {header}
        <Card className="border-border/60">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Settlement records are not available for your workspace access.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="recruiter-staff-settlements-panel">
      {header}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Settlements · {companyName}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>
            Settlement statements are recordkeeping and reconciliation records.
            HaulTrackerPro does not issue payroll, withhold taxes, or transfer funds.
          </p>
          <p>
            Driver connections are managed by the workspace owner. You can work only
            with drivers already connected to this workspace.
          </p>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading connected drivers…
        </p>
      ) : error ? (
        <div className="space-y-2" data-testid="recruiter-staff-settlements-error">
          <p className="text-sm text-destructive">
            Connected drivers could not be loaded.
          </p>
          <Button size="sm" variant="outline" onClick={refetch}>
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        </div>
      ) : driverOptions.length === 0 ? (
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="recruiter-staff-settlements-empty"
        >
          <Inbox className="h-4 w-4" /> No connected drivers yet.
        </p>
      ) : null}

      <BusinessSettlementManager
        mode="carrier"
        businessId={recruiterId}
        driverOptions={driverOptions}
        canManage={canPrepareSettlements || canFinalizeSettlements}
        canPrepare={canPrepareSettlements}
        canFinalize={canFinalizeSettlements}
        blockedReason="Your workspace access allows viewing settlement statements only."
      />
    </div>
  );
}
