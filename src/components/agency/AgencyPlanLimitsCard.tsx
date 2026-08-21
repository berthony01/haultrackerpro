import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, Info, CreditCard, AlertTriangle } from 'lucide-react';
import { useAgencyEntitlement } from '@/hooks/useAgencyEntitlement';
import {
  ASSISTANT_AGENCY_PLANS,
  ALL_AGENCY_PLAN_KEYS,
  effectiveLimits,
  OUTSIDE_PAYMENTS_DISCLAIMER,
  type AssistantAgencyPlanKey,
} from '@/lib/agencyPlans';
import { useAgencyMembers, useMyAgency } from '@/hooks/useAgency';
import { useAgencyClients, useAgencyPackages } from '@/hooks/useAgencyWorkflow';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useOwnerQaPersona } from '@/hooks/useOwnerQaPersona';
import type { OwnerQaAgencyPersona } from '@/lib/billing/ownerQaPersona';
import {
  AGENCY_CHECKOUT_MESSAGES,
  agencyCheckoutMessageForCode,
  isSafeAgencyStripeCheckoutUrl,
  parseAgencyCheckoutError,
} from '@/lib/agencyCheckoutMessages';

/**
 * Phase TG-2E3-O4 — the three paid Agency QA personas offered while Owner QA
 * mode is active. Deliberately excludes `assistant_free` (not a paid plan) and
 * mirrors ALL_AGENCY_PLAN_KEYS without redefining any plan data.
 */
const AGENCY_QA_PERSONAS: readonly OwnerQaAgencyPersona[] = [
  'agency_starter',
  'agency_team',
  'agency_growth',
];


interface Props {
  agencyId: string;
}

function fmtLimit(used: number, limit: number | null) {
  if (limit === null) return `${used} / unlimited`;
  return `${used} / ${limit}`;
}

// Sanitize ?plan= against the strict agency plan allowlist. Phase 8B.
function sanitizeAgencyPlanKey(raw: string | null | undefined): AssistantAgencyPlanKey {
  if (raw && (ALL_AGENCY_PLAN_KEYS as string[]).includes(raw)) {
    return raw as AssistantAgencyPlanKey;
  }
  return 'agency_team';
}

/**
 * Phase 8B / Phase 1S-A2 — Plan & Limits card with real Stripe billing CTAs.
 *
 * - cancelled + no Stripe identity → billing never started: "Not active"
 *   badge + "Start Agency Billing" (owner only)
 * - cancelled + Stripe identity/history → "Restart Billing" (owner only)
 * - manual_beta → grandfathered beta workspace notice
 * - active / trialing → "Manage Billing"  // trial-allowlist: Stripe subscription status
 * - past_due → warning + "Manage Billing"
 * - Non-owners see read-only "Only the agency owner can manage billing."
 */
export function AgencyPlanLimitsCard({ agencyId }: Props) {
  const { entitlement, isLoading, refetch } = useAgencyEntitlement(agencyId);
  const { data: members } = useAgencyMembers(agencyId);
  const { data: packages } = useAgencyPackages(agencyId);
  const { data: clients } = useAgencyClients(agencyId);
  const { data: agency } = useMyAgency();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  // Phase TG-2E3-O4 — Owner QA context safety. While the platform owner holds
  // ANY active QA session, real Stripe billing controls are withheld entirely.
  const ownerQa = useOwnerQaPersona();
  const qaActive = ownerQa.isOwner && ownerQa.isActive;
  const qaIsAgency = qaActive && ownerQa.domain === 'agency';

  const isOwner = agency?.my_role === 'agency_owner';
  const preselectedPlan = sanitizeAgencyPlanKey(searchParams.get('plan'));
  const [selectedPlan, setSelectedPlan] = useState<AssistantAgencyPlanKey>(preselectedPlan);


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
  // Server-side invite_member limit counts both pending and active members as
  // reserving a seat. Keep the UI usage count identical so owners don't see
  // false available capacity.
  const usedMembers = (members ?? []).filter(
    (m) => m.status === 'active' || m.status === 'pending',
  ).length;
  const usedPackages = (packages ?? []).filter((p: any) => p.is_active !== false).length;
  // list_agency_clients() already returns only approved/active clients
  // (one row per driver) — count rows directly. Filtering on a non-existent
  // `status` field used to silently report 0.
  const usedClients = (clients ?? []).length;

  // Phase 1S-A2 — distinguish "billing never started" from "previously
  // cancelled". A placeholder entitlement is created with status `cancelled`
  // and no Stripe identity, so the absence of both Stripe IDs is the signal.
  const billingNeverStarted =
    entitlement.status === 'cancelled' &&
    !entitlement.stripeCustomerId &&
    !entitlement.stripeSubscriptionId;
  const previouslyCancelled = entitlement.status === 'cancelled' && !billingNeverStarted;
  const isGrandfatheredBeta = entitlement.status === 'manual_beta';

  const statusBadge: Record<typeof entitlement.status, { label: string; tone: string }> = {
    manual_beta: { label: 'Beta', tone: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
    trialing: { label: 'Trial', tone: 'bg-blue-500/15 text-blue-600 border-blue-500/30' }, // trial-allowlist — Stripe subscription status, not marketing
    active: { label: 'Active', tone: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
    past_due: { label: 'Past due', tone: 'bg-destructive/15 text-destructive border-destructive/30' },
    cancelled: { label: 'Cancelled', tone: 'bg-muted text-muted-foreground border-border' },
  };
  const badge = billingNeverStarted
    ? { label: 'Not active', tone: 'bg-muted text-muted-foreground border-border' }
    : statusBadge[entitlement.status];

  const startCheckout = async (planKey: AssistantAgencyPlanKey) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-agency-checkout', {
        body: { agencyId, planKey },
      });
      if (error) {
        const parsed = await parseAgencyCheckoutError(error);
        toast({
          title: 'Could not start agency billing',
          description: parsed.message,
          variant: 'destructive',
        });
        return;
      }
      if (isSafeAgencyStripeCheckoutUrl(data?.url)) {
        window.location.href = data.url;
        return;
      }
      const fallback = agencyCheckoutMessageForCode(data?.code);
      toast({
        title: 'Could not start agency billing',
        description: fallback.message,
        variant: 'destructive',
      });
    } catch {
      toast({
        title: 'Could not start agency billing',
        description: AGENCY_CHECKOUT_MESSAGES.unknown_error,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const openPortal = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('agency-customer-portal', {
        body: { agencyId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error('No portal URL returned');
    } catch (e: any) {
      toast({
        title: 'Could not open billing portal',
        description: e?.message ?? 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const selectQaPlan = async (persona: OwnerQaAgencyPersona) => {
    try {
      await ownerQa.setPersona('agency', persona);
      toast({
        title: 'QA plan switched',
        description: `Now testing ${ASSISTANT_AGENCY_PLANS[persona].label}. Real billing is unchanged.`,
      });
    } catch (e: any) {
      toast({
        title: 'Could not switch QA plan',
        description: e?.message ?? 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const showStartCta =
    !qaActive &&
    isOwner &&
    (entitlement.status === 'manual_beta' ||
      entitlement.status === 'cancelled' ||
      !entitlement.stripeSubscriptionId);

  const showPortalCta =
    !qaActive &&
    isOwner &&
    !!entitlement.stripeCustomerId &&
    ['active', 'trialing', 'past_due'].includes(entitlement.status);  // trial-allowlist: Stripe subscription status


  // Refresh entitlement when we land back from Stripe success.
  if (typeof window !== 'undefined' && searchParams.get('billing') === 'success') {
    // fire-and-forget; React Query handles dedup
    setTimeout(() => refetch(), 0);
  }

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

        <p className="text-xs text-muted-foreground">
          Pending invites count toward your member limit.
        </p>

        {entitlement.status === 'past_due' && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Your last agency payment did not succeed. Update payment in the billing
              portal to keep adding clients, members, and packages.
            </span>
          </div>
        )}
        {billingNeverStarted && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300 flex gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Agency billing has not been started. A paid plan is required before you can
              use paid agency operations — sharing your private request link, accepting or
              advancing new client requests, adding agency members, driver clients, or
              service packages, and creating new work items. You can still view your
              workspace and manage what already exists.
            </span>
          </div>
        )}
        {previouslyCancelled && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Agency billing is cancelled. You can still view your data and manage existing
              members, but adding new clients, members, or packages is paused until billing
              is restarted.
            </span>
          </div>
        )}

        {isGrandfatheredBeta && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300 flex gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Grandfathered beta workspace — this agency keeps {plan.label} limits at no
              charge. New agencies must start a paid plan.
            </span>
          </div>
        )}

        {qaActive && isOwner ? (
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Agency QA testing
            </p>
            <p className="text-xs text-muted-foreground">
              Owner QA mode is active. Real billing is unchanged and disabled during
              QA testing — no charge, no subscription change, and no Stripe checkout
              or billing portal is reachable from this card while QA is on.
            </p>
            {!qaIsAgency && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300 flex gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  You&rsquo;re currently testing {ownerQa.label ?? 'another workspace'}.
                  That does not override Agency entitlements. Choose an Agency QA plan
                  below.
                </span>
              </div>
            )}
            <div className="space-y-2">
              {AGENCY_QA_PERSONAS.map((k) => {
                const p = ASSISTANT_AGENCY_PLANS[k];
                const isActivePlan = qaIsAgency && ownerQa.persona === k;
                return (
                  <div
                    key={k}
                    className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
                      isActivePlan ? 'border-primary bg-primary/10' : 'border-border'
                    }`}
                  >
                    <div className="text-xs">
                      <p className="font-semibold">
                        {p.label}
                        {isActivePlan && (
                          <span className="ml-2 text-primary">· Active QA plan</span>
                        )}
                      </p>
                      <p className="text-muted-foreground">
                        ${p.monthlyPrice}/mo plan limits (display only)
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={isActivePlan ? 'secondary' : 'outline'}
                      disabled={ownerQa.isMutating || isActivePlan}
                      onClick={() => selectQaPlan(k)}
                    >
                      {isActivePlan ? `Testing QA — ${p.label}` : `Switch QA — ${p.label}`}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : isOwner ? (

          <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Agency billing
            </p>
            {showStartCta && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {ALL_AGENCY_PLAN_KEYS.map((k) => {
                    const p = ASSISTANT_AGENCY_PLANS[k];
                    const selected = selectedPlan === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setSelectedPlan(k)}
                        className={`rounded-md border px-2 py-2 text-left text-xs transition ${
                          selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
                        }`}
                      >
                        <p className="font-semibold">{p.label}</p>
                        <p className="text-muted-foreground">${p.monthlyPrice}/mo</p>
                      </button>
                    );
                  })}
                </div>
                <Button
                  className="w-full gap-2"
                  disabled={busy}
                  onClick={() => startCheckout(selectedPlan)}
                >
                  <CreditCard className="h-4 w-4" />
                  {previouslyCancelled
                    ? `Restart Billing — ${ASSISTANT_AGENCY_PLANS[selectedPlan].label}`
                    : `Start Agency Billing — ${ASSISTANT_AGENCY_PLANS[selectedPlan].label}`}
                </Button>
              </>
            )}
            {showPortalCta && (
              <Button
                className="w-full gap-2"
                variant={entitlement.status === 'past_due' ? 'default' : 'outline'}
                disabled={busy}
                onClick={openPortal}
              >
                <CreditCard className="h-4 w-4" />
                Manage Billing
              </Button>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only the agency owner can manage billing.
          </p>
        )}

        <p className="text-xs text-muted-foreground">{OUTSIDE_PAYMENTS_DISCLAIMER}</p>
      </CardContent>
    </Card>
  );
}
