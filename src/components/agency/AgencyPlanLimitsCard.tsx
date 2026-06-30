import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Info } from 'lucide-react';
import { useAgencyEntitlement } from '@/hooks/useAgencyEntitlement';
import {
  ASSISTANT_AGENCY_PLANS,
  effectiveLimits,
  OUTSIDE_PAYMENTS_DISCLAIMER,
} from '@/lib/agencyPlans';
import { useAgencyMembers } from '@/hooks/useAgency';
import { useAgencyClients, useAgencyPackages } from '@/hooks/useAgencyWorkflow';

interface Props {
  agencyId: string;
}

function fmtLimit(used: number, limit: number | null) {
  if (limit === null) return `${used} / unlimited`;
  return `${used} / ${limit}`;
}

/**
 * Phase 7 — Plan & Limits card for the agency dashboard.
 *
 * Read-only. Reads the agency_entitlements row (falls back to manual_beta
 * Agency Starter for existing beta agencies). Shows plan, status, and
 * current usage vs limits. Does NOT trigger Stripe checkout — agency
 * billing is wired in Phase 8.
 */
export function AgencyPlanLimitsCard({ agencyId }: Props) {
  const { entitlement, hasRow, isLoading } = useAgencyEntitlement(agencyId);
  const { data: members } = useAgencyMembers(agencyId);
  const { data: packages } = useAgencyPackages(agencyId);
  const { data: clients } = useAgencyClients(agencyId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Plan &amp; limits</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Loading plan…</p></CardContent>
      </Card>
    );
  }

  const plan = ASSISTANT_AGENCY_PLANS[entitlement.planKey];
  const limits = effectiveLimits(entitlement);
  const usedMembers = (members ?? []).filter((m) => m.status === 'active').length;
  const usedPackages = (packages ?? []).filter((p: any) => p.is_active !== false).length;
  const usedClients = (clients ?? []).filter((c: any) => c.status === 'active').length;

  const statusBadge: Record<typeof entitlement.status, { label: string; tone: string }> = {
    manual_beta: { label: 'Beta', tone: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
    trialing: { label: 'Trial', tone: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
    active: { label: 'Active', tone: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
    past_due: { label: 'Past due', tone: 'bg-destructive/15 text-destructive border-destructive/30' },
    cancelled: { label: 'Cancelled', tone: 'bg-muted text-muted-foreground border-border' },
  };
  const badge = statusBadge[entitlement.status];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Plan &amp; limits
          </CardTitle>
          <Badge variant="outline" className={badge.tone}>{badge.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sm font-semibold">{plan.label}</p>
          <p className="text-xs text-muted-foreground">
            {plan.tagline}
            {plan.monthlyPrice > 0 && ` · $${plan.monthlyPrice}/mo`}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-md border p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Members</p>
            <p className="mt-1 font-semibold tabular-nums">{fmtLimit(usedMembers, limits.memberLimit)}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Driver clients</p>
            <p className="mt-1 font-semibold tabular-nums">{fmtLimit(usedClients, limits.activeClientLimit)}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Service packages</p>
            <p className="mt-1 font-semibold tabular-nums">{fmtLimit(usedPackages, limits.servicePackageLimit)}</p>
          </div>
        </div>

        {!hasRow && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300 flex gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Beta access — your agency workspace is open at Agency Starter limits. Agency billing
              will be enabled in a future release.
            </span>
          </div>
        )}

        <p className="text-xs text-muted-foreground">{OUTSIDE_PAYMENTS_DISCLAIMER}</p>
      </CardContent>
    </Card>
  );
}
