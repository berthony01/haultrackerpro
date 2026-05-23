import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Settings, Info, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  useRecruiterReferralSettings,
  PAYMENT_TRIGGER_LABELS,
  DEFAULT_EXTERNAL_PAYMENT_DISCLAIMER,
  type PaymentTrigger,
} from '@/hooks/opportunities/useRecruiterReferralSettings';

interface Props {
  recruiterId: string;
}

const TRIGGER_NONE = 'none';

export function RecruiterReferralSettingsCard({ recruiterId }: Props) {
  const { settings, isLoading, upsert } = useRecruiterReferralSettings(recruiterId);

  const [enabled, setEnabled] = useState(false);
  const [bonusAmount, setBonusAmount] = useState('');
  const [trigger, setTrigger] = useState<PaymentTrigger | typeof TRIGGER_NONE>(TRIGGER_NONE);
  const [waitingDays, setWaitingDays] = useState('');
  const [terms, setTerms] = useState('');

  useEffect(() => {
    if (settings) {
      setEnabled(settings.referral_bonus_enabled);
      setBonusAmount(settings.bonus_amount != null ? String(settings.bonus_amount) : '');
      setTrigger((settings.payment_trigger as PaymentTrigger) ?? TRIGGER_NONE);
      setWaitingDays(
        settings.waiting_period_days != null ? String(settings.waiting_period_days) : '',
      );
      setTerms(settings.bonus_terms ?? '');
    }
  }, [settings]);

  const disclaimer = settings?.external_payment_disclaimer ?? DEFAULT_EXTERNAL_PAYMENT_DISCLAIMER;

  const handleSave = () => {
    const amt = bonusAmount.trim() === '' ? null : Number(bonusAmount);
    const days = waitingDays.trim() === '' ? null : Number(waitingDays);

    if (amt != null && (Number.isNaN(amt) || amt < 0)) {
      toast.error('Bonus amount must be 0 or greater');
      return;
    }
    if (days != null && (Number.isNaN(days) || days < 0)) {
      toast.error('Waiting period must be 0 or greater');
      return;
    }

    upsert.mutate(
      {
        referral_bonus_enabled: enabled,
        bonus_amount: amt,
        payment_trigger: trigger === TRIGGER_NONE ? null : trigger,
        waiting_period_days: days,
        bonus_terms: terms,
      },
      {
        onSuccess: () => toast.success('Referral settings saved'),
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  return (
    <Card className="p-5 border-border/60">
      <div className="flex items-start gap-3 mb-4">
        <div className="rounded-xl bg-primary/15 p-2.5 shrink-0">
          <Settings className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-foreground">Referral Settings</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Set the referral terms drivers will see when they refer another driver to your
            opportunities. Referral bonuses, if offered, are paid externally by you. Haul Tracker
            Pro tracks progress only and does not process or guarantee payments.
          </p>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="space-y-5">
          {/* Bonus enabled */}
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3">
            <div className="min-w-0">
              <Label htmlFor="bonus-enabled" className="text-sm font-semibold text-foreground">
                Offer external referral bonus
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                This tells drivers you may offer a referral bonus outside Haul Tracker Pro.
              </p>
            </div>
            <Switch id="bonus-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <fieldset disabled={!enabled} className="space-y-4 disabled:opacity-60">
            <div>
              <Label htmlFor="bonus-amount" className="text-sm">Bonus amount</Label>
              <Input
                id="bonus-amount"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="Example: 500"
                value={bonusAmount}
                onChange={(e) => setBonusAmount(e.target.value)}
                className="mt-1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Optional. Leave blank if your terms are flexible.
              </p>
            </div>

            <div>
              <Label htmlFor="payment-trigger" className="text-sm">Payment trigger</Label>
              <Select
                value={trigger}
                onValueChange={(v) => setTrigger(v as PaymentTrigger | typeof TRIGGER_NONE)}
              >
                <SelectTrigger id="payment-trigger" className="mt-1">
                  <SelectValue placeholder="Select trigger…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TRIGGER_NONE}>Not specified</SelectItem>
                  {(Object.keys(PAYMENT_TRIGGER_LABELS) as PaymentTrigger[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {PAYMENT_TRIGGER_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Informational only. Does not create a payment obligation inside Haul Tracker Pro.
              </p>
            </div>

            <div>
              <Label htmlFor="waiting-days" className="text-sm">Waiting period (days)</Label>
              <Input
                id="waiting-days"
                type="number"
                min={0}
                step="1"
                inputMode="numeric"
                placeholder="Example: 30"
                value={waitingDays}
                onChange={(e) => setWaitingDays(e.target.value)}
                className="mt-1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Example: 30 days after hire. Optional.
              </p>
            </div>

            <div>
              <Label htmlFor="bonus-terms" className="text-sm">Referral bonus terms</Label>
              <Textarea
                id="bonus-terms"
                placeholder="Example: $500 paid externally after the referred driver completes 30 days and remains in good standing."
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                maxLength={1000}
                rows={4}
                className="mt-1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Describe your informational terms. Avoid guarantees — payment is external.
              </p>
            </div>
          </fieldset>

          {/* Disclaimer (read-only) */}
          <div className="flex items-start gap-2 rounded-lg bg-primary/10 border border-primary/30 p-3 text-xs text-foreground">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <span>{disclaimer}</span>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={upsert.isPending}>
              <Save className="h-4 w-4" />
              {upsert.isPending ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
