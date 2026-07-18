import { useState } from 'react';
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
  type RecruiterPlan,
  type RecruiterCheckoutFailure,
} from '@/hooks/opportunities/useRecruiterBilling';
import { RECRUITER_SUBSCRIPTION_STATUS_MESSAGES } from '@/lib/opportunities/recruiterCheckoutMessages';

type PaidPlan = Exclude<RecruiterPlan, 'none'>;

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
  const {
    billing,
    plan,
    status,
    isBillingActive,
    isLoading,
    startCheckout,
    openPortal,
    refresh,
  } = useRecruiterBilling();

  // Phase 1G-R1A7: aria-live status region. Complements sonner toasts with
  // an assistive-tech-friendly announcement anchored to the billing card.
  const [statusMessage, setStatusMessage] = useState<{
    kind: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const handleUpgrade = (p: PaidPlan) => {
    if (startCheckout.isPending) return; // hard client-side dedupe on rapid clicks
    setStatusMessage({ kind: 'info', text: 'Preparing secure checkout…' });
    startCheckout.mutate(p, {
      onSuccess: () => {
        setStatusMessage({
          kind: 'success',
          text: 'Opening checkout in a new tab.',
        });
        toast.success('Opening checkout in a new tab…');
      },
      onError: (e: Error) => {
        setStatusMessage({ kind: 'error', text: e.message });
        toast.error(e.message);
      },
    });
  };

  const handlePortal = () => {
    if (openPortal.isPending) return;
    openPortal.mutate(undefined, {
      onSuccess: () => {
        setStatusMessage({
          kind: 'success',
          text: 'Opening billing portal in a new tab.',
        });
        toast.success('Opening billing portal…');
      },
      onError: (e: Error) => {
        setStatusMessage({ kind: 'error', text: e.message });
        toast.error(e.message);
      },
    });
  };

  const currentPlanLabel = isBillingActive
    ? RECRUITER_PLAN_LABELS[plan]
    : 'Standard Access';

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
            Recruiters with a complete, non-suspended profile can post standard opportunities. Verification adds a Verified Recruiter badge. Paid plans add premium recruiting tools, limits, and reporting.
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

      {statusMessage && (
        <div
          role={statusMessage.kind === 'error' ? 'alert' : 'status'}
          aria-live={statusMessage.kind === 'error' ? 'assertive' : 'polite'}
          data-testid="recruiter-billing-status"
          className={
            statusMessage.kind === 'error'
              ? 'text-xs text-destructive'
              : 'text-xs text-muted-foreground'
          }
        >
          {statusMessage.text}
        </div>
      )}

      <Card className="p-4 border-border/60 bg-muted/20 space-y-3">
        <div className="flex items-center gap-2">
          <BadgeCheck className="h-4 w-4 text-primary" />
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
          Standard posting depends on profile completeness and suspension status, not verification or payment. Verification adds a Verified Recruiter badge. Premium recruiting tools are included with paid plans.
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
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Upgrade for premium recruiting tools</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Premium visibility, reports, contract tools, analytics, and recruiting workflow features.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {PLANS.map((p) => {
          const isCurrent = isBillingActive && plan === p.key;
          return (
            <Card key={p.key} className={`p-4 border-border/60 ${isCurrent ? 'ring-2 ring-primary' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold text-foreground">{RECRUITER_PLAN_LABELS[p.key]}</h3>
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
                disabled={startCheckout.isPending || isCurrent}
                aria-busy={startCheckout.isPending || undefined}
                onClick={() => handleUpgrade(p.key)}
              >
                {startCheckout.isPending ? (
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

      {billing?.stripe_subscription_id && (
        <Button
          variant="outline"
          size="sm"
          onClick={handlePortal}
          disabled={openPortal.isPending}
          aria-busy={openPortal.isPending || undefined}
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" /> Manage Billing
        </Button>
      )}

      <p className="text-[11px] text-muted-foreground">
        Referral bonuses, if offered, are paid externally by recruiters. Haul Tracker Pro tracks referral progress only and does not process, verify, or guarantee payments.
      </p>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3 w-3" /> Billing is processed securely by Stripe.
      </p>
    </Card>
  );
}

function PerkItem({ perk }: { perk: PerkLabel }) {
  const isObj = typeof perk === 'object';
  const label = isObj ? perk.label : perk;
  return (
    <li className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
      <Check className="h-3 w-3 text-primary mt-0.5 shrink-0" />
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
