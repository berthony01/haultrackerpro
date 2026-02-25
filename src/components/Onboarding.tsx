import { Truck, Clock, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface OnboardingProps {
  onGetStarted: () => void;
}

export function Onboarding({ onGetStarted }: OnboardingProps) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="text-center space-y-3 pt-4">
        <div className="inline-flex items-center justify-center rounded-2xl bg-primary p-4 mx-auto">
          <Truck className="h-10 w-10 text-primary-foreground" />
        </div>
        <h1 className="text-3xl font-black font-heading tracking-tight">Welcome to HaulTracker!</h1>
        <p className="text-muted-foreground">Your loads. Your money. All tracked.</p>
      </div>

      <Card className="border-2 border-primary/20 shadow-lg">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-2">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-bold text-lg">Log your first load in under 30 seconds</p>
              <p className="text-sm text-muted-foreground">Just enter pickup, drop-off, miles, and rate — we do the math.</p>
            </div>
          </div>

          <ul className="space-y-2 text-sm text-muted-foreground pl-1">
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              Track every load with estimated pay
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0" />
              Compare estimated vs actual pay received
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-warning shrink-0" />
              Weekly & monthly summaries at a glance
            </li>
          </ul>

          <Button
            className="w-full h-12 text-base font-bold gap-2"
            onClick={onGetStarted}
          >
            Log Your First Load <ArrowRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
