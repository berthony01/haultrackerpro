import { useState } from 'react';
import { differenceInDays, parseISO } from 'date-fns';
import { Crown, X, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TrialBannerProps {
  trialEnd: string;
  onUpgrade: () => void;
}

export function TrialBanner({ trialEnd, onUpgrade }: TrialBannerProps) {
  const daysLeft = Math.max(0, differenceInDays(parseISO(trialEnd), new Date()));

  let urgency: 'green' | 'yellow' | 'red' = 'green';
  if (daysLeft <= 3) urgency = 'red';
  else if (daysLeft <= 7) urgency = 'yellow';

  const colors = {
    green: 'bg-success/10 border-success/30 text-success',
    yellow: 'bg-warning/10 border-warning/30 text-warning',
    red: 'bg-destructive/10 border-destructive/30 text-destructive',
  };

  return (
    <div className={`rounded-xl border px-4 py-3 mb-4 flex items-center justify-between gap-3 ${colors[urgency]}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        <Crown className="h-4 w-4 shrink-0" />
        <p className="text-sm font-semibold truncate">
          Pro Trial — {daysLeft} day{daysLeft !== 1 ? 's' : ''} left
        </p>
      </div>
      {daysLeft <= 7 && (
        <Button size="sm" className="shrink-0 h-8 text-xs font-bold gap-1" onClick={onUpgrade}>
          Upgrade <ArrowRight className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

interface TrialExpiredBannerProps {
  onUpgrade: () => void;
}

export function TrialExpiredBanner({ onUpgrade }: TrialExpiredBannerProps) {
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem('htp_trial_expired_dismissed') === 'true'
  );

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem('htp_trial_expired_dismissed', 'true');
    setDismissed(true);
  };

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <Crown className="h-4 w-4 shrink-0 text-destructive" />
        <p className="text-sm font-semibold text-destructive truncate">
          Your Pro trial has ended
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" className="h-8 text-xs font-bold gap-1" onClick={onUpgrade}>
          Upgrade <ArrowRight className="h-3 w-3" />
        </Button>
        <button onClick={handleDismiss} className="text-destructive/50 hover:text-destructive">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
