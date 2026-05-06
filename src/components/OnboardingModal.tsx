import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Truck, ArrowRight, Sparkles, DollarSign, Route, Wallet, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserSettings } from '@/hooks/useUserSettings';
import type { PayModel } from '@/lib/payModels';

interface OnboardingModalProps {
  open: boolean;
  onComplete: () => void;
  /** Kept for backward compat — no longer used in the shortened flow. */
  onNavigateSettings?: () => void;
}

type PayChoice = {
  key: string;
  label: string;
  description: string;
  pay_model: PayModel;
  dh_pay_status?: 'unpaid' | 'same' | 'custom';
};

const PAY_CHOICES: PayChoice[] = [
  {
    key: 'loaded_only',
    label: 'Loaded miles only',
    description: 'I only get paid for loaded miles.',
    pay_model: 'loaded_miles_only',
    dh_pay_status: 'unpaid',
  },
  {
    key: 'all_miles',
    label: 'All miles (loaded + deadhead)',
    description: 'I get paid for both loaded and empty miles.',
    pay_model: 'total_miles',
    dh_pay_status: 'same',
  },
  {
    key: 'split_rates',
    label: 'Loaded + deadhead at separate rates',
    description: 'My loaded miles and deadhead miles use different rates.',
    pay_model: 'loaded_plus_deadhead',
    dh_pay_status: 'custom',
  },
  {
    key: 'flat',
    label: 'Flat rate per load',
    description: 'I usually get paid a flat amount per load.',
    pay_model: 'flat_rate',
  },
  {
    key: 'manual',
    label: 'Manual / Other',
    description: 'My pay structure varies.',
    pay_model: 'manual',
  },
];

const slides = [
  {
    icon: Truck,
    title: 'Welcome to HaulTrackerPro',
    description: "Log loads in seconds, see real profit per haul, and stop driving blind. Let's log your first load — we'll pre-fill an example so you can see how it works in 30 seconds.",
    color: 'bg-primary/10 text-primary',
  },
  {
    icon: Wallet,
    title: 'How are you typically paid?',
    description: "We'll set up your defaults so your earnings show correctly from day one.",
    color: 'bg-primary/10 text-primary',
    isPayQuestion: true,
  },
  {
    icon: Sparkles,
    title: "We'll Pre-Fill An Example",
    description: 'On the next screen, the form has a sample load (Atlanta → Miami, 650 mi, $2.50/mi). Edit it to match your real run, or just save it to feel the flow. You can delete the example anytime.',
    color: 'bg-accent/10 text-accent-foreground',
    showFeatures: true,
  },
];

export function OnboardingModal({ open, onComplete }: OnboardingModalProps) {
  const { user } = useAuth();
  const { settings } = useUserSettings();
  const [step, setStep] = useState(0);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isLast = step === slides.length - 1;
  const slide = slides[step];

  // Don't overwrite users who already configured pay settings.
  const hasExistingPaySetup = !!(settings && (
    (settings as any).default_pay_model ||
    ((settings as any).default_dh_pay_status && (settings as any).default_dh_pay_status !== 'unpaid')
  ));

  const handleNext = async () => {
    // On the pay-question step, persist defaults before advancing.
    if ((slide as any).isPayQuestion && selectedChoice && user && !hasExistingPaySetup) {
      const choice = PAY_CHOICES.find(c => c.key === selectedChoice);
      if (choice) {
        setSaving(true);
        try {
          const updates: Record<string, any> = { default_pay_model: choice.pay_model };
          if (choice.dh_pay_status) updates.default_dh_pay_status = choice.dh_pay_status;
          await supabase
            .from('user_settings')
            .upsert({ user_id: user.id, ...updates }, { onConflict: 'user_id' });
        } catch (e) {
          // Non-blocking: don't trap user in onboarding if write fails.
          console.warn('Failed to save pay defaults', e);
        } finally {
          setSaving(false);
        }
      }
    }

    if (isLast) {
      onComplete();
    } else {
      setStep(s => s + 1);
    }
  };

  const payQuestionUnanswered = (slide as any).isPayQuestion && !selectedChoice && !hasExistingPaySetup;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden [&>button]:hidden" onPointerDownOutside={e => e.preventDefault()}>
        <div className="px-6 pt-10 pb-8 text-center space-y-5">
          <div className={`inline-flex items-center justify-center rounded-3xl p-5 mx-auto ${slide.color}`}>
            <slide.icon className="h-12 w-12" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-black font-heading">{slide.title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{slide.description}</p>
          </div>

          {(slide as any).isPayQuestion && (
            <div className="space-y-2 text-left">
              {hasExistingPaySetup ? (
                <p className="text-xs text-muted-foreground text-center italic">
                  You've already configured pay defaults in Settings. Skipping.
                </p>
              ) : (
                PAY_CHOICES.map(choice => {
                  const selected = selectedChoice === choice.key;
                  return (
                    <button
                      key={choice.key}
                      type="button"
                      onClick={() => setSelectedChoice(choice.key)}
                      className={`w-full text-left rounded-xl border-2 px-3 py-2.5 transition-colors active:scale-[0.99] ${
                        selected
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-card hover:border-primary/40'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center ${
                          selected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                        }`}>
                          {selected && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold leading-tight">{choice.label}</p>
                          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{choice.description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {(slide as any).showFeatures && (
            <div className="grid grid-cols-3 gap-2 pt-1">
              {[
                { icon: Route, label: '650 mi' },
                { icon: DollarSign, label: '$2.50/mi' },
                { icon: Truck, label: 'ATL → MIA' },
              ].map(f => (
                <div key={f.label} className="flex flex-col items-center gap-1 rounded-lg bg-muted/50 px-2 py-3">
                  <f.icon className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold text-foreground whitespace-nowrap">{f.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Dots */}
          <div className="flex items-center justify-center gap-2 pt-2">
            {slides.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/20'
                }`}
              />
            ))}
          </div>

          <Button
            className="w-full h-12 text-base font-bold gap-2 rounded-xl shadow-primary active:scale-[0.98] transition-transform"
            onClick={handleNext}
            disabled={saving || payQuestionUnanswered}
          >
            {isLast ? 'Log My First Load' : saving ? 'Saving…' : 'Next'}
            <ArrowRight className="h-5 w-5" />
          </Button>

          {!isLast && (
            <button
              onClick={onComplete}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
