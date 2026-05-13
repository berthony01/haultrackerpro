import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Check, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  useRecruiterBilling,
  RECRUITER_PLAN_LIMITS,
  RECRUITER_PLAN_LABELS,
  type RecruiterPlan,
} from '@/hooks/opportunities/useRecruiterBilling';

const PLANS: { key: Exclude<RecruiterPlan, 'none'>; price: string; perks: string[] }[] = [
  { key: 'starter', price: '$49/mo', perks: ['1 active opportunity', 'Approved listings', 'Driver applications'] },
  { key: 'growth', price: '$149/mo', perks: ['Up to 5 active opportunities', 'Driver applications', 'Profit-first listings'] },
  { key: 'fleet', price: '$399/mo', perks: ['Up to 25 active opportunities', 'Driver applications', 'Full visibility'] },
];

export function RecruiterBillingPanel() {
  const {
    billing, plan, status, limit, activeCount, isBillingActive, isLoading,
    startCheckout, openPortal, refresh,
  } = useRecruiterBilling();

  const handleUpgrade = (p: Exclude<RecruiterPlan, 'none'>) => {
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

  return (
    <Card className="p-5 border-border/60 bg-gradient-to-br from-card via-card to-primary/5 space-y-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary p-2.5 shadow-primary shrink-0">
          <CreditCard className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-foreground">Recruiter Plan</h2>
          <p className="text-xs text-muted-foreground">
            Active billing is required to submit opportunities for review.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Plan" value={RECRUITER_PLAN_LABELS[plan]} />
        <Stat
          label="Status"
          value={
            <Badge variant={isBillingActive ? 'default' : 'outline'} className="capitalize">
              {status}
            </Badge>
          }
        />
        <Stat label="Active" value={`${activeCount} / ${limit}`} />
      </div>

      {!isBillingActive && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
          Choose a recruiter plan to submit opportunities for review.
        </div>
      )}
      {isBillingActive && activeCount >= limit && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
          You've reached your active opportunity limit. Upgrade to post more.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {PLANS.map((p) => {
          const isCurrent = isBillingActive && plan === p.key;
          return (
            <Card key={p.key} className={`p-4 border-border/60 ${isCurrent ? 'ring-2 ring-primary' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold text-foreground">{RECRUITER_PLAN_LABELS[p.key]}</h3>
                {isCurrent && <Badge variant="default">Current</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mb-2">{p.price}</p>
              <p className="text-[11px] text-muted-foreground mb-3">
                {RECRUITER_PLAN_LIMITS[p.key]} active opportunit{RECRUITER_PLAN_LIMITS[p.key] === 1 ? 'y' : 'ies'}
              </p>
              <ul className="space-y-1 mb-3">
                {p.perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <Check className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                    <span>{perk}</span>
                  </li>
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

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
      <div className="text-sm font-bold text-foreground">{value}</div>
    </div>
  );
}
