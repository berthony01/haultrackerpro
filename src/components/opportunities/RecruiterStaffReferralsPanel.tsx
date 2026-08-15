/**
 * Phase RC-1F — recruiter STAFF referrals surface.
 *
 * Staff-only, permission-gated, and completely isolated from owner surfaces:
 * it does NOT import RecruiterReferralsPanel, RecruiterReferralSettingsCard,
 * RecruiterReferralAnalyticsCard, useRecruiterReferrals,
 * useRecruiterReferralSettings, or any billing / profile / contract /
 * application / report / settlement / Agency / subscription surface.
 *
 * All data flows through the RC-1F staff hooks (safe RPCs only). Client
 * booleans are UX only; PostgreSQL remains authoritative.
 */
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
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
  useRecruiterStaffReferrals,
  type RecruiterReferral,
} from '@/hooks/opportunities/useRecruiterReferrals';
import {
  useRecruiterStaffReferralSettings,
  PAYMENT_TRIGGER_LABELS,
  type PaymentTrigger,
} from '@/hooks/opportunities/useRecruiterReferralSettings';
import { useReferralEvents } from '@/hooks/opportunities/useDriverReferrals';
import {
  RECRUITER_SELECTABLE_STATUSES,
  REFERRAL_STATUS_LABELS,
  EXTERNAL_PAYMENT_DISCLAIMER,
  referralStatusLabel,
  type ReferralStatus,
} from '@/lib/opportunities/referralStatus';

interface Props {
  recruiterId: string;
  companyName: string;
  canViewReferrals: boolean;
  canManageReferralStatus: boolean;
  canManageReferralTerms: boolean;
  onBack: () => void;
}

export function RecruiterStaffReferralsPanel({
  recruiterId,
  companyName,
  canViewReferrals,
  canManageReferralStatus,
  canManageReferralTerms,
  onBack,
}: Props) {
  const canView = canViewReferrals === true;
  const canManageStatus = canManageReferralStatus === true;
  const canManageTerms = canManageReferralTerms === true;

  return (
    <div className="space-y-6 animate-fade-in" data-testid="staff-referrals-panel">
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
            <p className="text-sm text-muted-foreground break-words">{companyName}</p>
          </div>
        </div>
      </Card>

      <div className="flex items-start gap-2 rounded-lg bg-primary/10 border border-primary/30 p-3 text-xs text-foreground">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
        <span>{EXTERNAL_PAYMENT_DISCLAIMER}</span>
      </div>

      {(canView || canManageTerms) && (
        <StaffReferralTermsSection
          recruiterId={recruiterId}
          canViewReferrals={canView}
          canManageReferralTerms={canManageTerms}
        />
      )}

      {canView ? (
        <StaffReferralList
          recruiterId={recruiterId}
          canViewReferrals={canView}
          canManageReferralStatus={canManageStatus}
        />
      ) : (
        <EmptyState
          title="Referral records are not available to you"
          body="Your workspace owner has not granted referral visibility for this workspace."
        />
      )}
    </div>
  );
}

function StaffReferralList({
  recruiterId,
  canViewReferrals,
  canManageReferralStatus,
}: {
  recruiterId: string;
  canViewReferrals: boolean;
  canManageReferralStatus: boolean;
}) {
  const { referrals, isLoading, isError, refetch, updateStatus } =
    useRecruiterStaffReferrals({
      recruiterId,
      canViewReferrals,
      canManageReferralStatus,
    });
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

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
      </div>
    );
  }
  if (isError) {
    return (
      <EmptyState
        title="Unable to load referrals"
        body="Something went wrong while loading referrals."
        action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
      />
    );
  }
  if (referrals.length === 0) {
    return (
      <EmptyState
        title="No driver referrals yet"
        body="When drivers refer other drivers to this workspace's opportunities, they'll show up here."
      />
    );
  }

  return (
    <>
      <div className="space-y-3">
        {referrals.map((r) => (
          <StaffReferralRow
            key={r.id}
            referral={r}
            expanded={expandedId === r.id}
            onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
            onChangeStatus={(s) => handleSelect(r.id, s)}
            canManageReferralStatus={canManageReferralStatus}
            busy={updateStatus.isPending}
          />
        ))}
      </div>

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
    </>
  );
}

function StaffReferralRow({
  referral,
  expanded,
  onToggle,
  onChangeStatus,
  canManageReferralStatus,
  busy,
}: {
  referral: RecruiterReferral;
  expanded: boolean;
  onToggle: () => void;
  onChangeStatus: (status: ReferralStatus) => void;
  canManageReferralStatus: boolean;
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
            {canManageReferralStatus && (
              <Select
                value=""
                onValueChange={(v) => onChangeStatus(v as ReferralStatus)}
                disabled={busy}
              >
                <SelectTrigger data-testid="staff-referral-status-select">
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
            )}
            <Button size="sm" variant="outline" onClick={onToggle}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Timeline
            </Button>
          </div>
        </div>

        {expanded && <StaffReferralTimeline referralId={referral.id} />}
      </div>
    </Card>
  );
}

function StaffReferralTimeline({ referralId }: { referralId: string }) {
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
        </li>
      ))}
    </ol>
  );
}

const TRIGGER_OPTIONS: PaymentTrigger[] = [
  'on_hire',
  'after_waiting_period',
  'recruiter_defined',
  'other',
];

function StaffReferralTermsSection({
  recruiterId,
  canViewReferrals,
  canManageReferralTerms,
}: {
  recruiterId: string;
  canViewReferrals: boolean;
  canManageReferralTerms: boolean;
}) {
  const { settings, isLoading, upsert } = useRecruiterStaffReferralSettings({
    recruiterId,
    canViewReferrals,
    canManageReferralTerms,
  });

  const [enabled, setEnabled] = useState(false);
  const [amount, setAmount] = useState('');
  const [trigger, setTrigger] = useState<PaymentTrigger | 'none'>('none');
  const [waitDays, setWaitDays] = useState('');
  const [terms, setTerms] = useState('');

  useEffect(() => {
    setEnabled(settings?.referral_bonus_enabled === true);
    setAmount(settings?.bonus_amount != null ? String(settings.bonus_amount) : '');
    setTrigger((settings?.payment_trigger as PaymentTrigger | null) ?? 'none');
    setWaitDays(
      settings?.waiting_period_days != null ? String(settings.waiting_period_days) : '',
    );
    setTerms(settings?.bonus_terms ?? '');
  }, [settings]);

  const handleSave = () => {
    if (!canManageReferralTerms) return;
    upsert.mutate(
      {
        referral_bonus_enabled: enabled,
        bonus_amount: amount.trim() === '' ? null : Number(amount),
        payment_trigger: trigger === 'none' ? null : trigger,
        waiting_period_days: waitDays.trim() === '' ? null : Number(waitDays),
        bonus_terms: terms,
      },
      {
        onSuccess: () => toast.success('Referral terms saved'),
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  return (
    <Card className="p-5 border-border/60" data-testid="staff-referral-terms">
      <h2 className="text-base font-bold text-foreground mb-1">Referral terms</h2>
      <p className="text-xs text-muted-foreground mb-4">
        {canManageReferralTerms
          ? 'These terms are shown to drivers considering a referral.'
          : 'View only — your workspace owner has not granted terms management.'}
      </p>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="staff-referral-enabled" className="text-sm">
              Referral bonus offered
            </Label>
            <Switch
              id="staff-referral-enabled"
              checked={enabled}
              disabled={!canManageReferralTerms}
              onCheckedChange={setEnabled}
            />
          </div>

          {enabled && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="staff-referral-amount" className="text-sm">Bonus amount</Label>
                <Input
                  id="staff-referral-amount"
                  inputMode="decimal"
                  value={amount}
                  disabled={!canManageReferralTerms}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Payment trigger</Label>
                <Select
                  value={trigger}
                  disabled={!canManageReferralTerms}
                  onValueChange={(v) => setTrigger(v as PaymentTrigger | 'none')}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select trigger" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not specified</SelectItem>
                    {TRIGGER_OPTIONS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {PAYMENT_TRIGGER_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="staff-referral-wait" className="text-sm">Waiting period (days)</Label>
                <Input
                  id="staff-referral-wait"
                  inputMode="numeric"
                  value={waitDays}
                  disabled={!canManageReferralTerms}
                  onChange={(e) => setWaitDays(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="staff-referral-terms" className="text-sm">Bonus terms</Label>
                <Textarea
                  id="staff-referral-terms"
                  value={terms}
                  disabled={!canManageReferralTerms}
                  onChange={(e) => setTerms(e.target.value)}
                  rows={3}
                />
              </div>
            </>
          )}

          {settings?.external_payment_disclaimer && (
            <p className="text-[11px] text-muted-foreground">
              {settings.external_payment_disclaimer}
            </p>
          )}

          {canManageReferralTerms && (
            <Button
              onClick={handleSave}
              disabled={upsert.isPending}
              data-testid="staff-referral-terms-save"
            >
              Save referral terms
            </Button>
          )}
        </div>
      )}
    </Card>
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
