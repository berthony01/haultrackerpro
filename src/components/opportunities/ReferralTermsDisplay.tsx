import { Gift, Info } from 'lucide-react';
import {
  PAYMENT_TRIGGER_LABELS,
  DEFAULT_EXTERNAL_PAYMENT_DISCLAIMER,
  type PaymentTrigger,
  type RecruiterReferralSettings,
} from '@/hooks/opportunities/useRecruiterReferralSettings';
import { Skeleton } from '@/components/ui/skeleton';

interface Props {
  settings: RecruiterReferralSettings | null;
  isLoading?: boolean;
  compact?: boolean;
  /** Whether to render the external-payment disclaimer. Default: true */
  showDisclaimer?: boolean;
}

function formatTrigger(t?: string | null): string | null {
  if (!t) return null;
  if (t in PAYMENT_TRIGGER_LABELS) {
    return PAYMENT_TRIGGER_LABELS[t as PaymentTrigger];
  }
  return null;
}

function formatAmount(amt?: number | null): string | null {
  if (amt == null) return null;
  return `$${Number(amt).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function ReferralTermsDisplay({
  settings,
  isLoading,
  compact,
  showDisclaimer = true,
}: Props) {
  if (isLoading) {
    return <Skeleton className={compact ? 'h-16 w-full' : 'h-24 w-full'} />;
  }

  const enabled = !!settings?.referral_bonus_enabled;
  const amount = enabled ? formatAmount(settings?.bonus_amount) : null;
  const trigger = enabled ? formatTrigger(settings?.payment_trigger) : null;
  const waiting =
    enabled && settings?.waiting_period_days != null
      ? `${settings.waiting_period_days} day${settings.waiting_period_days === 1 ? '' : 's'}`
      : null;
  const terms = enabled ? settings?.bonus_terms?.trim() : null;
  const disclaimer = settings?.external_payment_disclaimer ?? DEFAULT_EXTERNAL_PAYMENT_DISCLAIMER;

  const noSettings = !settings;
  const noBonus = !!settings && !enabled;

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-primary shrink-0" />
          <p className="text-sm font-semibold text-foreground">
            {enabled
              ? 'External referral bonus may be offered'
              : noBonus
                ? 'No external referral bonus is currently listed'
                : 'This recruiter has not listed external referral bonus terms yet.'}
          </p>
        </div>

        {enabled && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {amount && (
              <Row label="Listed bonus amount" value={amount} />
            )}
            {trigger && <Row label="Payment trigger" value={trigger} />}
            {waiting && <Row label="Waiting period" value={waiting} />}
          </dl>
        )}

        {terms && (
          <div className="pt-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Recruiter-stated terms
            </p>
            <p className="text-xs text-foreground whitespace-pre-wrap mt-0.5">{terms}</p>
          </div>
        )}

        {noSettings && (
          <p className="text-xs text-muted-foreground">
            You can still submit a referral. Recruiters may share bonus terms externally.
          </p>
        )}
      </div>

      {showDisclaimer && (
        <div className="flex items-start gap-2 rounded-lg bg-primary/10 border border-primary/30 p-3 text-xs text-foreground">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
          <span>{disclaimer}</span>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </dt>
      <dd className="text-xs font-medium text-foreground">{value}</dd>
    </div>
  );
}
