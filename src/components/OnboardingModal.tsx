import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Truck, DollarSign, ClipboardCheck, ArrowRight } from 'lucide-react';

interface OnboardingModalProps {
  open: boolean;
  onComplete: () => void;
}

const slides = [
  {
    icon: Truck,
    title: 'Track Every Load',
    description: 'Log your loads in seconds — miles, rate, locations, and fees. Keep a complete record of every haul.',
    color: 'bg-primary/10 text-primary',
  },
  {
    icon: DollarSign,
    title: 'Know Your Real Profit',
    description: 'Track expenses like fuel, tolls, and maintenance. See your true net profit and cost per mile.',
    color: 'bg-success/10 text-success',
  },
  {
    icon: ClipboardCheck,
    title: 'Close Out Every Week',
    description: 'Finalize your weekly summary to spot trends, catch underpayments, and keep your records clean.',
    color: 'bg-warning/10 text-warning',
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
            {isLast ? 'Log Your First Load' : 'Next'}
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
