import { useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  CreditCard,
  Check,
  ExternalLink,
  Loader2,
  ShieldCheck,
  BadgeCheck,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useRecruiterBilling,
  RECRUITER_PLAN_LABELS,
  type RecruiterCheckoutFailure,
} from '@/hooks/opportunities/useRecruiterBilling';
import type { PaidPlan } from '@/lib/opportunities/recruiterBillingState';

type PerkLabel = string | { label: string; tag: 'coming-soon' };

const PLANS: { key: PaidPlan; price: string; tagline: string; perks: PerkLabel[] }[] = [
  {
    key: 'starter',
    price: '$19/mo',
    tagline: 'Better applicant tracking and trust signals.',
    perks: [
      'Enhanced applicant tracking',
      'Applicant status history',
      'Basic applicant pipeline analytics',
      'Basic referral tracking view',
      'Recruiter trust badge',
    ],
  },
  {
    key: 'growth',
    price: '$49/mo',
    tagline: 'Premium visibility and recruiting workflow.',
    perks: [
      'Priority placement',
      'Featured listing eligibility',
      'Recruiter reports (PDF/CSV)',
      'Contract workflow tools',
      'Pipeline analytics and recruiter reports',
      'Referral progress tracking',
    ],
  },
  {
    key: 'fleet',
    price: '$149/mo',
    tagline: 'Top placement and team-scale recruiting.',
    perks: [
      'Top placement eligibility',
      'Advanced analytics',
      'Priority support',
      { label: 'Team seats', tag: 'coming-soon' },
      { label: 'Bulk opportunity tools', tag: 'coming-soon' },
      { label: 'Custom recruiter profile', tag: 'coming-soon' },
      { label: 'Company-level hiring dashboard', tag: 'coming-soon' },
    ],
  },
];

const STANDARD_ACCESS_PERKS: PerkLabel[] = [
  'Standard opportunity posting for complete, non-suspended profiles',
  'Basic applicant inbox',
  'Standard marketplace placement',
  'Optional Verified Recruiter badge after verification',
];

export function RecruiterBillingPanel() {
  const hook = useRecruiterBilling();
  const {
    plan,
    isBillingActive,
    isLoading,
    startCheckout,
    openPortal,
    refresh,
  } = hook;
  // Defensive defaults: legacy call sites (and rendered-copy tests) mock
  // this hook with a narrower shape. When new-state fields are absent, the
  // panel degrades to the eligible-idle, no-headline default rather than
  // throwing.
  const prepareTab = hook.prepareTab ?? (() => {});
  const uiState = hook.uiState ?? ({ kind: 'eligible_idle' } as const);
  const canStartCheckout = hook.canStartCheckout ?? true;
  const showManageBilling =
    hook.showManageBilling ?? !!hook.billing?.stripe_subscription_id;
  const checkStatus =
    hook.checkStatus ?? { visible: false, clickable: false };
  const headline = hook.headline ?? null;
  const checkServerStatus = hook.checkServerStatus ?? (() => {});

  const [pendingPlan, setPendingPlan] = useState<PaidPlan | null>(null);
  // Phase 1G-R1A7-R1: real-Chromium rapid-double-click testing proved that
  // React Query's `isPending` flag is NOT synchronously available between
  // two near-instant clicks (it only reflects true after React commits the
  // state update from the first mutate() call), so relying on it alone let
  // a second click slip a second checkout/portal request through. This ref
  // is set synchronously, before any async work, and is the single source
  // of truth for "an action is already in flight" — closing that race.
  const actionInFlightRef = useRef(false);
  const [fallback, setFallback] = useState<{
    url: string;
    label: string;
    kind: 'checkout' | 'portal';
  } | null>(null);

  const isPending = startCheckout.isPending || openPortal.isPending;

  const handleUpgrade = (p: PaidPlan) => {
    if (isPending) return;
    if (!canStartCheckout) return;
    setFallback(null);
    // Synchronous popup MUST come before any awaited work so browsers
    // treat it as user-gesture initiated. Same deterministic name across
    // clicks → at most one window ever exists.
    prepareTab();
    setPendingPlan(p);
    startCheckout.mutate(p, {
      onSuccess: () => {
        setPendingPlan(null);
        toast.success('Opening checkout in a new tab…');
      },
      onError: (e: Error) => {
        setPendingPlan(null);
        const err = e as RecruiterCheckoutFailure;
        if (err.fallbackUrl) {
          setFallback({
            url: err.fallbackUrl,
            label: 'Continue to secure checkout',
            kind: 'checkout',
          });
        }
        toast.error(err.message);
      },
    });
  };

  const handlePortal = () => {
    if (isPending) return;
    setFallback(null);
    prepareTab();
    openPortal.mutate(undefined, {
      onSuccess: () => {
        toast.success('Opening billing portal…');
      },
      onError: (e: Error) => {
        const err = e as RecruiterCheckoutFailure;
        if (err.fallbackUrl) {
          setFallback({
            url: err.fallbackUrl,
            label: 'Open billing portal',
            kind: 'portal',
          });
        }
        toast.error(err.message);
      },
    });
  };

  const currentPlanLabel = isBillingActive
    ? RECRUITER_PLAN_LABELS[plan]
    : 'Standard Access';

  const isErrorState =
    uiState.kind === 'retryable_error' ||
    uiState.kind === 'support_required' ||
    uiState.kind === 'popup_blocked_checkout' ||
    uiState.kind === 'popup_blocked_portal';

  return (
    <Card
      className="p-5 border-border/60 bg-gradient-to-br from-card via-card to-primary/5 space-y-5 overflow-hidden"
      aria-labelledby="recruiter-billing-heading"
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="rounded-xl bg-primary p-2.5 shadow-primary shrink-0">
          <CreditCard className="h-5 w-5 text-primary-foreground" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="recruiter-billing-heading" className="text-lg font-bold text-foreground">
            Recruiter Plan
          </h2>
          <p className="text-xs text-muted-foreground break-words">
            {'Recruiters with a complete, non-suspended profile can post standard opportunities.'}{' '}
            {'Verification adds a Verified Recruiter badge.'}{' '}
            {'Paid plans add premium recruiting tools, limits, and reporting.'}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={refresh}
          disabled={isLoading}
          aria-label="Refresh billing status"
          aria-busy={isLoading || undefined}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            'Refresh'
          )}
        </Button>
      </div>

      {headline && (
        <div
          role={isErrorState ? 'alert' : 'status'}
          aria-live={isErrorState ? 'assertive' : 'polite'}
          data-testid="recruiter-billing-status"
          data-state={uiState.kind}
          className={
            isErrorState
              ? 'text-xs text-destructive space-y-2'
              : 'text-xs text-muted-foreground space-y-2'
          }
        >
          <p className="break-words">{headline}</p>

          {checkStatus.visible && (
            <Button
              size="sm"
              variant="outline"
              type="button"
              data-testid="recruiter-billing-check-status"
              disabled={!checkStatus.clickable}
              onClick={checkServerStatus}
            >
              Check status
            </Button>
          )}

          {fallback && (
            <Button
              asChild
              size="sm"
              variant="outline"
              data-testid={
                fallback.kind === 'checkout'
                  ? 'recruiter-billing-fallback'
                  : 'recruiter-billing-portal-fallback'
              }
            >
              <a
                href={fallback.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {fallback.label}
              </a>
            </Button>
          )}
        </div>
      )}

      <Card className="p-4 border-border/60 bg-muted/20 space-y-3">
        <div className="flex items-center gap-2">
          <BadgeCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          <h3 className="text-sm font-bold text-foreground">Recruiter Access</h3>
        </div>
        <div className="grid sm:grid-cols-2 gap-2 text-xs text-foreground">
          <AccessRow
            label="Standard opportunity posting"
            value="Included with a complete, non-suspended recruiter profile"
          />
          <AccessRow
            label="Verified Recruiter badge"
            value="Optional trust signal added after verification"
          />
          <AccessRow
            label="Current plan"
            value={
              <Badge variant={isBillingActive ? 'default' : 'outline'} className="capitalize">
                {currentPlanLabel}
              </Badge>
            }
          />
          <AccessRow
            label="Premium features"
            value={
              <span className="text-muted-foreground">
                {isBillingActive ? 'Unlocked by your plan' : 'Included with paid plans'}
              </span>
            }
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Standard posting depends on profile completeness and suspension
          status, not verification or payment. Verification adds a Verified
          Recruiter badge. Premium recruiting tools are included with paid
          plans.
        </p>
      </Card>

      <Card className="p-4 border-border/60">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold text-foreground">Standard Recruiter Access</h3>
          {!isBillingActive && <Badge variant="default">Current</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Free · Included with a complete, non-suspended Recruiter profile.
        </p>
        <ul className="space-y-1">
          {STANDARD_ACCESS_PERKS.map((perk, i) => (
            <PerkItem key={i} perk={perk} />
          ))}
        </ul>
      </Card>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          <h3 className="text-sm font-bold text-foreground">
            Upgrade for premium recruiting tools
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Premium visibility, reports, contract tools, analytics, and
          recruiting workflow features.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {PLANS.map((p) => {
          const isCurrent = isBillingActive && plan === p.key;
          const disabled =
            isPending || isCurrent || !canStartCheckout;
          return (
            <Card
              key={p.key}
              className={`p-4 border-border/60 ${isCurrent ? 'ring-2 ring-primary' : ''}`}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold text-foreground">
                  {RECRUITER_PLAN_LABELS[p.key]}
                </h3>
                {isCurrent && <Badge variant="default">Current</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mb-1">{p.price}</p>
              <p className="text-[11px] text-muted-foreground mb-3">{p.tagline}</p>
              <ul className="space-y-1 mb-3">
                {p.perks.map((perk, i) => (
                  <PerkItem key={i} perk={perk} />
                ))}
              </ul>
              <Button
                size="sm"
                className="w-full"
                variant={isCurrent ? 'outline' : 'default'}
                disabled={disabled}
                aria-busy={pendingPlan === p.key || undefined}
                data-testid={`recruiter-plan-button-${p.key}`}
                onClick={() => handleUpgrade(p.key)}
              >
                {pendingPlan === p.key ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Preparing…</span>
                  </>
                ) : isCurrent ? (
                  'Active'
                ) : (
                  `Choose ${RECRUITER_PLAN_LABELS[p.key]}`
                )}
              </Button>
            </Card>
          );
        })}
      </div>

      {showManageBilling && (
        <Button
          variant="outline"
          size="sm"
          onClick={handlePortal}
          disabled={isPending}
          aria-busy={openPortal.isPending || undefined}
          data-testid="recruiter-manage-billing"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" /> Manage Billing
        </Button>
      )}

      <p className="text-[11px] text-muted-foreground">
        Referral bonuses, if offered, are paid externally by recruiters. Haul
        Tracker Pro tracks referral progress only and does not process,
        verify, or guarantee payments.
      </p>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Billing is
        processed securely by Stripe.
      </p>
    </Card>
  );
}

function PerkItem({ perk }: { perk: PerkLabel }) {
  const isObj = typeof perk === 'object';
  const label = isObj ? perk.label : perk;
  return (
    <li className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
      <Check className="h-3 w-3 text-primary mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        {label}
        {isObj && (
          <Badge variant="outline" className="ml-1.5 px-1 py-0 text-[9px] font-medium">
            Coming soon
          </Badge>
        )}
      </span>
    </li>
  );
}

function AccessRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
      <div className="text-xs font-semibold text-foreground">{value}</div>
    </div>
  );
}
