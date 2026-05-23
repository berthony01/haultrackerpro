import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft,
  UserPlus,
  Inbox,
  Info,
  ChevronDown,
  ChevronUp,
  Clock,
} from 'lucide-react';
import {
  useDriverReferrals,
  useReferralEvents,
  type DriverReferral,
} from '@/hooks/opportunities/useDriverReferrals';
import {
  EXTERNAL_PAYMENT_DISCLAIMER,
  referralStatusLabel,
} from '@/lib/opportunities/referralStatus';

interface Props {
  onBack: () => void;
}

export function DriverReferralsPanel({ onBack }: Props) {
  const { referrals, isLoading, isError, refetch } = useDriverReferrals();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-6 animate-fade-in">
      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="rounded-2xl bg-primary p-3 shadow-primary shrink-0">
            <UserPlus className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1">
              My Referrals
            </h1>
            <p className="text-sm text-muted-foreground">
              Track drivers you've referred to recruiter opportunities.
            </p>
          </div>
        </div>
      </Card>

      <div className="flex items-start gap-2 rounded-lg bg-primary/10 border border-primary/30 p-3 text-xs text-foreground">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
        <span>{EXTERNAL_PAYMENT_DISCLAIMER}</span>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : isError ? (
        <EmptyState
          title="Unable to load referrals"
          body="Something went wrong while loading your referrals."
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      ) : referrals.length === 0 ? (
        <EmptyState
          title="You have not referred any drivers yet"
          body="Open an approved opportunity and tap 'Refer a Driver' to get started."
        />
      ) : (
        <div className="space-y-3">
          {referrals.map((r) => (
            <ReferralRow
              key={r.id}
              referral={r}
              expanded={expandedId === r.id}
              onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReferralRow({
  referral,
  expanded,
  onToggle,
}: {
  referral: DriverReferral;
  expanded: boolean;
  onToggle: () => void;
}) {
  const contactSummary =
    referral.referred_driver_name ||
    referral.referred_driver_email ||
    referral.referred_driver_phone ||
    'Driver';
  const subContacts = [
    referral.referred_driver_name ? referral.referred_driver_email : null,
    referral.referred_driver_phone,
  ]
    .filter(Boolean)
    .join(' • ');

  return (
    <Card className="p-5 border-border/60">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="text-base font-bold text-foreground truncate">{contactSummary}</h3>
            <Badge variant="outline" className="border-primary/40 text-primary">
              {referralStatusLabel(referral.status)}
            </Badge>
          </div>
          {subContacts && (
            <p className="text-xs text-muted-foreground mb-2 truncate">{subContacts}</p>
          )}
          <p className="text-sm text-foreground">
            {referral.opportunities?.title ?? 'Opportunity'}
            {referral.opportunities?.company_name && (
              <span className="text-muted-foreground"> · {referral.opportunities.company_name}</span>
            )}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Updated {new Date(referral.last_status_at).toLocaleDateString()}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onToggle}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Timeline
        </Button>
      </div>

      {expanded && <ReferralTimeline referralId={referral.id} />}
    </Card>
  );
}

function ReferralTimeline({ referralId }: { referralId: string }) {
  const { data, isLoading } = useReferralEvents(referralId);

  if (isLoading) return <Skeleton className="h-20 w-full mt-4" />;
  if (!data || data.length === 0) {
    return (
      <p className="text-xs text-muted-foreground mt-4">No status updates yet.</p>
    );
  }

  return (
    <ol className="mt-4 space-y-2 border-l border-border/60 pl-4">
      {data.map((ev) => (
        <li key={ev.id} className="relative">
          <span className="absolute -left-[1.05rem] top-1.5 h-2 w-2 rounded-full bg-primary" />
          <p className="text-sm font-semibold text-foreground">
            {referralStatusLabel(ev.new_status)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {new Date(ev.created_at).toLocaleString()}
            {ev.actor_role ? ` · ${ev.actor_role}` : ''}
          </p>
          {ev.note && <p className="text-xs text-muted-foreground mt-0.5">{ev.note}</p>}
        </li>
      ))}
    </ol>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="p-10 border-dashed border-border/60 text-center">
      <div className="mx-auto mb-3 inline-flex rounded-2xl bg-muted/40 p-3">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-base font-bold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">{body}</p>
      {action}
    </Card>
  );
}
