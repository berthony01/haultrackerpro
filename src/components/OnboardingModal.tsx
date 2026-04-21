import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Truck, ArrowRight, Sparkles, DollarSign, Route } from 'lucide-react';

interface OnboardingModalProps {
  open: boolean;
  onComplete: () => void;
  /** Kept for backward compat — no longer used in the shortened flow. */
  onNavigateSettings?: () => void;
}

const slides = [
  {
    icon: Truck,
    title: 'Welcome to HaulTrackerPro',
    description: "Log loads in seconds, see real profit per haul, and stop driving blind. Let's log your first load — we'll pre-fill an example so you can see how it works in 30 seconds.",
    color: 'bg-primary/10 text-primary',
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
  const [step, setStep] = useState(0);
  const isLast = step === slides.length - 1;
  const slide = slides[step];

  const handleNext = () => {
    if (isLast) {
      onComplete();
    } else {
      setStep(s => s + 1);
    }
  };

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
          >
            {isLast ? 'Log My First Load' : 'Next'}
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
