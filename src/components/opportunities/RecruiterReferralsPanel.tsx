import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft,
  UserPlus,
  Inbox,
  Info,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useRecruiterReferrals,
  type RecruiterReferral,
} from '@/hooks/opportunities/useRecruiterReferrals';
import { useReferralEvents } from '@/hooks/opportunities/useDriverReferrals';
import { RecruiterReferralSettingsCard } from './RecruiterReferralSettingsCard';
import {
  RECRUITER_SELECTABLE_STATUSES,
  REFERRAL_STATUS_LABELS,
  EXTERNAL_PAYMENT_DISCLAIMER,
  referralStatusLabel,
  type ReferralStatus,
} from '@/lib/opportunities/referralStatus';

interface Props {
  recruiterId: string;
  onBack: () => void;
}

export function RecruiterReferralsPanel({ recruiterId, onBack }: Props) {
  const { referrals, isLoading, isError, refetch, updateStatus } =
    useRecruiterReferrals(recruiterId);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingExternal, setPendingExternal] = useState<{ id: string } | null>(null);

  const applyStatus = (id: string, status: ReferralStatus) => {
    updateStatus.mutate(
      { id, status },
      {
        onSuccess: () => toast.success('Referral updated'),
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  const handleSelect = (id: string, status: ReferralStatus) => {
    if (status === 'marked_paid_externally') {
      setPendingExternal({ id });
      return;
    }
    applyStatus(id, status);
  };

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
              Driver Referrals
            </h1>
            <p className="text-sm text-muted-foreground">
              Track and update referrals tied to your opportunities.
            </p>
          </div>
        </div>
      </Card>

      <div className="flex items-start gap-2 rounded-lg bg-primary/10 border border-primary/30 p-3 text-xs text-foreground">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
        <span>{EXTERNAL_PAYMENT_DISCLAIMER}</span>
      </div>

      <RecruiterReferralSettingsCard recruiterId={recruiterId} />



      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : isError ? (
        <EmptyState
          title="Unable to load referrals"
          body="Something went wrong while loading referrals."
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      ) : referrals.length === 0 ? (
        <EmptyState
          title="No driver referrals yet"
          body="When drivers refer other drivers to your opportunities, they'll show up here."
        />
      ) : (
        <div className="space-y-3">
          {referrals.map((r) => (
            <RecruiterReferralRow
              key={r.id}
              referral={r}
              expanded={expandedId === r.id}
              onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
              onChangeStatus={(s) => handleSelect(r.id, s)}
              busy={updateStatus.isPending}
            />
          ))}
        </div>
      )}

      <AlertDialog
        open={!!pendingExternal}
        onOpenChange={(o) => { if (!o) setPendingExternal(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark paid externally?</AlertDialogTitle>
            <AlertDialogDescription>
              This only marks that the recruiter paid externally. Haul Tracker Pro
              does not process or verify payment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingExternal) {
                  applyStatus(pendingExternal.id, 'marked_paid_externally');
                }
                setPendingExternal(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RecruiterReferralRow({
  referral,
  expanded,
  onToggle,
  onChangeStatus,
  busy,
}: {
  referral: RecruiterReferral;
  expanded: boolean;
  onToggle: () => void;
  onChangeStatus: (status: ReferralStatus) => void;
  busy: boolean;
}) {
  const contactSummary =
    referral.referred_driver_name ||
    referral.referred_driver_email ||
    referral.referred_driver_phone ||
    'Referred driver';
  const subContacts = [
    referral.referred_driver_name ? referral.referred_driver_email : null,
    referral.referred_driver_phone,
  ]
    .filter(Boolean)
    .join(' • ');

  const referrerLabel = referral.referring_driver_id
    ? `Driver · #${referral.referring_driver_id.slice(0, 8)}`
    : 'Driver';

  return (
    <Card className="p-5 border-border/60">
      <div className="flex flex-col gap-3">
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
            <p className="text-xs text-muted-foreground mb-2">
              Referred by: <span className="font-medium text-foreground">{referrerLabel}</span>
            </p>
            <p className="text-sm text-foreground">
              {referral.opportunities?.title ?? 'Opportunity'}
              {referral.opportunities?.company_name && (
                <span className="text-muted-foreground"> · {referral.opportunities.company_name}</span>
              )}
            </p>
            {referral.referred_driver_note && (
              <p className="text-xs text-muted-foreground mt-2 italic">
                "{referral.referred_driver_note}"
              </p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Created {new Date(referral.created_at).toLocaleDateString()} · Updated{' '}
              {new Date(referral.last_status_at).toLocaleDateString()}
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:w-56">
            <Select
              value=""
              onValueChange={(v) => onChangeStatus(v as ReferralStatus)}
              disabled={busy}
            >
              <SelectTrigger>
                <SelectValue placeholder="Update status…" />
              </SelectTrigger>
              <SelectContent>
                {RECRUITER_SELECTABLE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {REFERRAL_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={onToggle}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Timeline
            </Button>
          </div>
        </div>

        {expanded && <ReferralTimeline referralId={referral.id} />}
      </div>
    </Card>
  );
}

function ReferralTimeline({ referralId }: { referralId: string }) {
  const { data, isLoading } = useReferralEvents(referralId);
  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (!data || data.length === 0) {
    return <p className="text-xs text-muted-foreground">No status updates yet.</p>;
  }
  return (
    <ol className="space-y-2 border-l border-border/60 pl-4">
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
