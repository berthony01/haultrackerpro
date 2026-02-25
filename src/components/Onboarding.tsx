import { Truck, ArrowRight, DollarSign, BarChart3, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface OnboardingProps {
  onGetStarted: () => void;
}

const features = [
  { icon: DollarSign, color: 'text-primary', label: 'Track every load with estimated pay' },
  { icon: BarChart3, color: 'text-success', label: 'Compare estimated vs actual pay received' },
  { icon: FileText, color: 'text-warning', label: 'Weekly & monthly summaries at a glance' },
];

export function Onboarding({ onGetStarted }: OnboardingProps) {
  return (
    <div className="space-y-8 animate-fade-in pt-4">
      {/* Hero */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center rounded-3xl bg-secondary p-5 mx-auto shadow-primary">
          <Truck className="h-12 w-12 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-black font-heading tracking-tight">Welcome to<br /><span className="text-gradient">HaulTracker</span></h1>
          <p className="text-muted-foreground mt-2 text-sm">Your loads. Your money. All tracked.</p>
        </div>
      </div>

      {/* Feature cards */}
      <div className="space-y-3">
        {features.map((f, i) => (
          <Card key={i} className="shadow-card animate-slide-up" style={{ animationDelay: `${i * 100}ms` }}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="rounded-xl bg-muted p-3 shrink-0">
                <f.icon className={`h-5 w-5 ${f.color}`} />
              </div>
              <p className="text-sm font-semibold">{f.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* CTA */}
      <Button
        className="w-full h-14 text-base font-bold gap-2 rounded-2xl shadow-primary active:scale-[0.98] transition-transform"
        onClick={onGetStarted}
      >
        Log Your First Load <ArrowRight className="h-5 w-5" />
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Takes less than 30 seconds — just enter miles and rate.
      </p>
    </div>
  );
}
