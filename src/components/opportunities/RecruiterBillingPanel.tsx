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
} from '@/hooks/opportunities/useRecruiterBilling';

type PaidPlan = Exclude<RecruiterPlan, 'none'>;

type PerkLabel = string | { label: string; tag: 'coming-soon' };

const PLANS: { key: PaidPlan; price: string; tagline: string; perks: PerkLabel[] }[] = [
  {
    key: 'starter',
    price: '$19/mo',
    tagline: 'Better applicant tracking and trust signals.',
    perks: [
      'Enhanced applicant tracking',
      'Applicant notes & status history',
      'Basic listing analytics',
      { label: 'Basic referral tracking view', tag: 'coming-soon' },
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
      'Pipeline analytics',
      { label: 'Referral progress tracking', tag: 'coming-soon' },
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
    ],
  },
];

const FREE_VERIFIED_PERKS: PerkLabel[] = [
  'Unlimited standard opportunity posts',
  'Admin-reviewed listings',
  'Basic applicant inbox',
  'Standard marketplace placement',
  'Verified recruiter profile',
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

  const handleUpgrade = (p: PaidPlan) => {
    startCheckout.mutate(p, {
      onSuccess: () => toast.success('Opening checkout in a new tab…'),
      onError: (e: Error) => toast.error(e.message),
    });
  };

  const handlePortal = () => {
    openPortal.mutate(undefined, {
      onSuccess: () => toast.success('Opening billing portal…'),
      onError: (e: Error) => toast.error(e.message),
    });
  };

  const currentPlanLabel = isBillingActive
    ? RECRUITER_PLAN_LABELS[plan]
    : 'Free Verified';

  return (
    <Card className="p-5 border-border/60 bg-gradient-to-br from-card via-card to-primary/5 space-y-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary p-2.5 shadow-primary shrink-0">
          <CreditCard className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-foreground">Recruiter Plan</h2>
          <p className="text-xs text-muted-foreground">
            Verified recruiters can post unlimited standard opportunities. Paid plans unlock premium recruiting tools.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
        </Button>
      </div>

      {/* Recruiter Access / Status card */}
      <Card className="p-4 border-border/60 bg-muted/20 space-y-3">
        <div className="flex items-center gap-2">
          <BadgeCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Recruiter Access</h3>
        </div>
        <div className="grid sm:grid-cols-2 gap-2 text-xs text-foreground">
          <AccessRow
            label="Standard opportunity posting"
            value="Unlimited for verified recruiters"
          />
          <AccessRow label="Listing review" value="Admin-reviewed for driver trust" />
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
                {isBillingActive ? 'Unlocked by your plan' : 'Based on paid plan'}
              </span>
            }
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Standard posting is based on recruiter approval. Premium features are based on your paid plan.
        </p>
      </Card>

      {/* Free Verified card */}
      <Card className="p-4 border-border/60">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold text-foreground">Verified Recruiter Access</h3>
          {!isBillingActive && <Badge variant="default">Current</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Free · Included once your recruiter profile is approved.
        </p>
        <ul className="space-y-1">
          {FREE_VERIFIED_PERKS.map((perk, i) => (
            <PerkItem key={i} perk={perk} />
          ))}
        </ul>
      </Card>

      {/* Paid plans */}
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
                onClick={() => handleUpgrade(p.key)}
              >
                {isCurrent ? 'Active' : `Choose ${RECRUITER_PLAN_LABELS[p.key]}`}
              </Button>
            </Card>
          );
        })}
      </div>

      {billing?.stripe_subscription_id && (
        <Button variant="outline" size="sm" onClick={handlePortal} disabled={openPortal.isPending}>
          <ExternalLink className="h-4 w-4" /> Manage Billing
        </Button>
      )}

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
