import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Truck, DollarSign, ClipboardCheck, ArrowRight, Settings, Mic, Camera, Award, BarChart3 } from 'lucide-react';

interface OnboardingModalProps {
  open: boolean;
  onComplete: () => void;
  onNavigateSettings?: () => void;
}

const slides = [
  {
    icon: Truck,
    title: 'Track Every Load',
    description: 'Log your loads in seconds — miles, rate, locations, and fees. Keep a complete record of every haul.',
    color: 'bg-primary/10 text-primary',
  },
  {
    icon: Settings,
    title: 'Set Your Default Rate',
    description: 'Set your default rate per mile so profit calculations are accurate from the start.',
    color: 'bg-accent/10 text-accent-foreground',
    hasSettingsLink: true,
  },
  {
    icon: DollarSign,
    title: 'Know Your Real Profit',
    description: 'Track expenses like fuel, tolls, and maintenance. See your true net profit and cost per mile.',
    color: 'bg-success/10 text-success',
  },
  {
    icon: ClipboardCheck,
    title: "You're Starting on Pro",
    description: 'You have 14 days of full Pro access — voice logging, receipt scanning, driver scorecard, and all charts unlocked.',
    color: 'bg-primary/10 text-primary',
    isProSlide: true,
  },
];

export function OnboardingModal({ open, onComplete, onNavigateSettings }: OnboardingModalProps) {
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

          {/* Pro features grid on trial slide */}
          {(slide as any).isProSlide && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              {[
                { icon: Mic, label: 'Voice Logging' },
                { icon: Camera, label: 'Receipt Scan' },
                { icon: Award, label: 'Driver Score' },
                { icon: BarChart3, label: 'All Charts' },
              ].map(f => (
                <div key={f.label} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                  <f.icon className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">{f.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Settings link on rate slide */}
          {(slide as any).hasSettingsLink && onNavigateSettings && (
            <button
              onClick={onNavigateSettings}
              className="text-sm font-semibold text-primary hover:underline transition-colors"
            >
              Set My Default Rate →
            </button>
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
