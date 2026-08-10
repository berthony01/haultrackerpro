/**
 * Phase 1T-E1 — Carrier (standalone paid recruiter) settlement panel.
 *
 * Presentation-only surface for carrier↔driver relationship administration and
 * carrier settlement issuance. It never talks to the backend directly: all
 * settlement reads/writes flow through the accepted Phase 1T orchestration
 * hooks, and all recruiter context comes from existing canonical consumers.
 * PostgreSQL remains the sole authority for entitlement and authorization.
 */

import { useMemo, useState } from 'react';
import { Link2, Loader2, Lock, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { useRecruiterBilling } from '@/hooks/opportunities/useRecruiterBilling';
import { useOpportunityApplications } from '@/hooks/opportunities/useOpportunityApplications';
import {
  useEndCarrierDriverRelationship,
  useInviteCarrierDriverRelationship,
  useVisibleCarrierDriverRelationships,
} from '@/hooks/settlements/useSettlementData';
import {
  BusinessSettlementManager,
  describeSettlementError,
  formatDate,
  type BusinessDriverOption,
} from './BusinessSettlementManager';

/* --------------------------------------------------------------- helpers - */

export interface CarrierDriverRelationshipLike {
  id: string;
  recruiter_id: string;
  driver_user_id: string;
  status: string;
  invited_at: string;
  accepted_at: string | null;
  ended_at: string | null;
}

export const CARRIER_RELATIONSHIP_STATUS_LABELS: Record<string, string> = {
  invited: 'Invited',
  active: 'Connected',
  inactive: 'Inactive',
  ended: 'Ended',
};

export interface CarrierDriverCandidate {
  driverUserId: string;
  label: string;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function readObject(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = source[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Privacy-safe candidate derivation from the recruiter-visible application
 * rows ONLY. No driver profile or auth table is ever queried here and no raw
 * identifier is ever used as a label.
 */
export function deriveCarrierDriverCandidates(
  applications: readonly unknown[] | null | undefined,
): CarrierDriverCandidate[] {
  const seen = new Map<string, CarrierDriverCandidate>();
  for (const entry of applications ?? []) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const driverUserId = readString(row, 'driver_user_id');
    if (!driverUserId || seen.has(driverUserId)) continue;

    const profile = readObject(row, 'driver_profile');
    const opportunity = readObject(row, 'opportunities');
    const fullName = profile ? readString(profile, 'full_name') : null;
    const opportunityTitle = opportunity ? readString(opportunity, 'title') : null;
    // A posting title is NOT an identity: when the driver's approved name is
    // absent, label the person as an applicant and keep the posting as context.
    const label =
      fullName ??
      (opportunityTitle
        ? `Driver applicant · ${opportunityTitle}`
        : 'Driver applicant');


    seen.set(driverUserId, { driverUserId, label });
  }
  return [...seen.values()];
}

/** Presentation-only ownership filter over the RLS-visible relationship rows. */
export function filterCarrierRelationships<T extends CarrierDriverRelationshipLike>(
  rows: readonly T[] | null | undefined,
  recruiterId: string,
): T[] {
  if (!rows || !recruiterId) return [];
  return rows.filter((row) => row.recruiter_id === recruiterId);
}

/**
 * Presentation-only: only ACTIVE exact relationships may feed carrier
 * settlement creation, and each option carries its exact relationship id.
 */
export function buildCarrierDriverOptions(
  relationships: readonly CarrierDriverRelationshipLike[],
  candidateLabels: ReadonlyMap<string, string>,
): BusinessDriverOption[] {
  return relationships
    .filter((row) => row.status === 'active')
    .map((row) => ({
      driverUserId: row.driver_user_id,
      relationshipId: row.id,
      label: candidateLabels.get(row.driver_user_id) ?? 'Connected driver',
    }));
}

/* ------------------------------------------------------------- component - */

export interface CarrierSettlementsPanelProps {
  /** Existing canonical recruiter billing anchor supplied by the parent page. */
  onManagePlan?: () => void;
}

export function CarrierSettlementsPanel({ onManagePlan }: CarrierSettlementsPanelProps) {
  const { profile, isLoading: profileLoading } = useRecruiterProfile();
  const billing = useRecruiterBilling();
  const recruiterId = profile?.id ?? '';

  const { recruiterApplications, isLoadingRecruiter } = useOpportunityApplications({
    recruiterId: recruiterId || undefined,
  });
  const relationshipsQuery = useVisibleCarrierDriverRelationships();
  const invite = useInviteCarrierDriverRelationship();
  const endRelationship = useEndCarrierDriverRelationship();

  const [selectedCandidateId, setSelectedCandidateId] = useState('');

  // Standalone paid recruiter subscription is the ONLY presentation signal that
  // enables carrier settlement issuance. Agency-included recruiter premium is
  // explicitly excluded — the backend fails closed on that conflict too.
  const isStandalonePaidRecruiter =
    (billing.isPaidRecruiterPlanActive ?? false) &&
    (billing.entitlementSource ?? 'free_standard') === 'recruiter_subscription';
  const isAgencyIncluded = (billing.entitlementSource ?? 'free_standard') === 'agency_included';

  const candidates = useMemo(
    () => deriveCarrierDriverCandidates(recruiterApplications),
    [recruiterApplications],
  );
  const candidateLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const candidate of candidates) map.set(candidate.driverUserId, candidate.label);
    return map;
  }, [candidates]);

  const relationships = useMemo(
    () =>
      filterCarrierRelationships(
        relationshipsQuery.data as CarrierDriverRelationshipLike[] | null | undefined,
        recruiterId,
      ),
    [relationshipsQuery.data, recruiterId],
  );

  const relationshipByDriver = useMemo(() => {
    const map = new Map<string, CarrierDriverRelationshipLike>();
    for (const row of relationships) map.set(row.driver_user_id, row);
    return map;
  }, [relationships]);

  const driverOptions = useMemo(
    () => buildCarrierDriverOptions(relationships, candidateLabels),
    [relationships, candidateLabels],
  );

  const runInvite = async (driverUserId: string) => {
    if (!recruiterId || !driverUserId) return;
    try {
      await invite.mutateAsync({
        _recruiter_id: recruiterId,
        _driver_user_id: driverUserId,
      });
      toast.success('Invitation sent to the driver');
      setSelectedCandidateId('');
    } catch (error) {
      toast.error(describeSettlementError(error));
    }
  };

  const runEnd = async (relationshipId: string) => {
    try {
      await endRelationship.mutateAsync({ _relationship_id: relationshipId });
      toast.success('Driver connection ended');
    } catch (error) {
      toast.error(describeSettlementError(error));
    }
  };

  if (profileLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settlements…
      </p>
    );
  }

  const selectedRelationship = selectedCandidateId
    ? relationshipByDriver.get(selectedCandidateId) ?? null
    : null;
  const inviteLabel =
    selectedRelationship && ['inactive', 'ended'].includes(selectedRelationship.status)
      ? 'Re-invite driver'
      : 'Connect driver';
  const inviteDisabled =
    !selectedCandidateId ||
    invite.isPending ||
    !isStandalonePaidRecruiter ||
    (selectedRelationship
      ? ['invited', 'active'].includes(selectedRelationship.status)
      : false);

  return (
    <div
      className="space-y-4 [&_button]:min-h-11 sm:[&_button]:min-h-0 [&_select]:min-h-11 sm:[&_select]:min-h-0 [&_input]:min-h-11 sm:[&_input]:min-h-0"
      data-testid="carrier-settlements-panel"
    >
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" /> Driver settlement statements
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Issue and manage settlement statements for drivers who have accepted
            your carrier connection. Statements are recordkeeping and
            reconciliation records — HaulTrackerPro does not issue payroll,
            withhold taxes, or transfer funds.
          </p>

          {isAgencyIncluded && (
            <p
              className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground"
              data-testid="carrier-settlements-agency-included-note"
            >
              Your recruiter premium is included with an agency plan. Business
              settlement preparation for agency clients belongs in your Agency
              workspace. Carrier settlement issuance requires a standalone paid
              recruiter subscription.
            </p>
          )}

          {!isStandalonePaidRecruiter && !isAgencyIncluded && (
            <div
              className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500"
              data-testid="carrier-settlements-locked-note"
            >
              <p className="flex items-start gap-2">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Carrier settlement statements require a paid recruiter plan.
                  Existing driver connections can still be ended for cleanup.
                </span>
              </p>
              {onManagePlan && (
                <Button size="sm" variant="outline" onClick={onManagePlan}>
                  View recruiter plans
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> Driver connections
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="carrier-candidate">Connect a driver who applied to you</Label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="carrier-candidate"
                className="h-10 w-full min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm sm:min-w-[14rem]"
                value={selectedCandidateId}
                onChange={(e) => setSelectedCandidateId(e.target.value)}
                data-testid="carrier-candidate-select"
              >
                <option value="">Select a driver…</option>
                {candidates.map((candidate) => (
                  <option key={candidate.driverUserId} value={candidate.driverUserId}>
                    {candidate.label}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={inviteDisabled}
                onClick={() => runInvite(selectedCandidateId)}
                data-testid="carrier-invite-driver"
              >
                <Link2 className="h-4 w-4" /> {inviteLabel}
              </Button>
            </div>
            {isLoadingRecruiter ? (
              <p className="text-xs text-muted-foreground">Loading driver applicants…</p>
            ) : candidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Drivers appear here once they apply to one of your opportunities.
              </p>
            ) : null}
          </div>

          {relationshipsQuery.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading connections…
            </p>
          ) : relationshipsQuery.isError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">Connections could not be loaded.</p>
              <Button size="sm" variant="outline" onClick={() => relationshipsQuery.refetch()}>
                <RefreshCw className="h-4 w-4" /> Retry
              </Button>
            </div>
          ) : relationships.length === 0 ? (
            <p className="text-sm text-muted-foreground">No driver connections yet.</p>
          ) : (
            <div className="divide-y rounded-md border border-border/60">
              {relationships.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center gap-3 p-3"
                  data-testid="carrier-relationship-row"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 max-w-full truncate text-sm font-medium">
                        {candidateLabels.get(row.driver_user_id) ?? 'Connected driver'}
                      </span>
                      <Badge variant="outline">
                        {CARRIER_RELATIONSHIP_STATUS_LABELS[row.status] ?? 'Connection'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Invited {formatDate(row.invited_at)}
                      {row.accepted_at ? ` · Accepted ${formatDate(row.accepted_at)}` : ''}
                      {row.ended_at ? ` · Ended ${formatDate(row.ended_at)}` : ''}
                    </p>
                  </div>
                  {row.status !== 'ended' && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          data-testid="carrier-end-relationship"
                        >
                          End connection
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>End this driver connection?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The driver stays in your records and existing statements are
                            preserved. Nothing is deleted.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                              void runEnd(row.id);
                            }}
                          >
                            End connection
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {recruiterId && (
        <BusinessSettlementManager
          mode="carrier"
          businessId={recruiterId}
          driverOptions={driverOptions}
          canManage={isStandalonePaidRecruiter}
          blockedReason={
            isAgencyIncluded
              ? 'Agency-included recruiter premium does not cover carrier settlement issuance. Prepare client statements in your Agency workspace instead.'
              : 'Carrier settlement statements require a standalone paid recruiter plan.'
          }
        />
      )}
    </div>
  );
}

export default CarrierSettlementsPanel;
