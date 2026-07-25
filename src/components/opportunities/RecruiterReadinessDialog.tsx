import { AlertTriangle, Ban, CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { RecruiterProfile } from '@/lib/opportunities/recruiterEligibility';
import {
  READINESS_MESSAGES,
  resolveRecruiterReadiness,
  type ReadinessToken,
} from '@/lib/opportunities/resolveRecruiterReadiness';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: RecruiterProfile | null;
  /** Fired when the recruiter chooses to complete their setup. */
  onOpenOnboarding: () => void;
  /** Fired when readiness is satisfied and the user confirms Continue. */
  onContinue?: () => void;
  /** Optional context label ("Post an Opportunity" | "Publish"). */
  actionLabel?: string;
}

const LEGACY_SUBTITLE =
  'Your recruiter profile needs a quick update before you can publish opportunities.';

export function RecruiterReadinessDialog({
  open,
  onOpenChange,
  profile,
  onOpenOnboarding,
  onContinue,
  actionLabel,
}: Props) {
  const readiness = resolveRecruiterReadiness(profile);

  const missingItems: ReadinessToken[] = readiness.suspended
    ? ['suspended']
    : readiness.missing;

  const suspended = readiness.suspended;
  const showLegacySubtitle =
    !suspended && !readiness.ready && readiness.legacyUpdateRequired;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md sm:max-w-lg"
        data-testid="recruiter-readiness-dialog"
        data-state-suspended={suspended ? 'true' : 'false'}
        data-state-ready={readiness.ready ? 'true' : 'false'}
        data-state-legacy={showLegacySubtitle ? 'true' : 'false'}
      >
        <DialogHeader>
          <DialogTitle data-testid="readiness-dialog-title">
            Complete Your Recruiter Setup
          </DialogTitle>
          {showLegacySubtitle && (
            <DialogDescription data-testid="readiness-dialog-subtitle">
              {LEGACY_SUBTITLE}
            </DialogDescription>
          )}
          {suspended && (
            <DialogDescription>
              {READINESS_MESSAGES.suspended}
            </DialogDescription>
          )}
          {readiness.ready && !suspended && (
            <DialogDescription>
              {actionLabel
                ? `You're ready to ${actionLabel.toLowerCase()}.`
                : 'You are ready to continue.'}
            </DialogDescription>
          )}
        </DialogHeader>

        <ul
          className="space-y-3 my-2"
          data-testid="readiness-missing-list"
          role="list"
        >
          {readiness.ready ? (
            <li className="flex items-start gap-3 text-sm text-foreground">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" aria-hidden />
              <span>Your recruiter setup is complete.</span>
            </li>
          ) : (
            missingItems.map((token) => {
              const Icon = token === 'suspended' ? Ban : XCircle;
              const iconClass =
                token === 'suspended'
                  ? 'text-destructive'
                  : 'text-muted-foreground';
              const emphasise = token === 'posting_terms';
              return (
                <li
                  key={token}
                  className="flex items-start gap-3 text-sm text-foreground"
                  data-testid={`readiness-missing-${token}`}
                >
                  <Icon
                    className={`h-5 w-5 shrink-0 mt-0.5 ${iconClass}`}
                    aria-hidden
                  />
                  <span className={emphasise ? 'font-semibold' : undefined}>
                    {READINESS_MESSAGES[token]}
                  </span>
                </li>
              );
            })
          )}
        </ul>

        {!suspended && !readiness.ready && (
          <div
            className="rounded-lg border border-border/60 bg-muted/30 p-3 flex items-start gap-3 text-xs text-muted-foreground"
            data-testid="readiness-help-hint"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-primary" aria-hidden />
            <span>
              Complete your recruiter profile to unlock standard posting. All
              agreements must be re-accepted in the onboarding form.
            </span>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="readiness-dialog-close"
          >
            Cancel
          </Button>
          {suspended ? (
            <Button
              variant="outline"
              disabled
              data-testid="readiness-dialog-suspended"
            >
              Contact support
            </Button>
          ) : readiness.ready ? (
            <Button
              onClick={() => {
                onOpenChange(false);
                onContinue?.();
              }}
              data-testid="readiness-dialog-continue"
            >
              Continue to Opportunity
            </Button>
          ) : (
            <Button
              onClick={() => {
                onOpenChange(false);
                onOpenOnboarding();
              }}
              data-testid="readiness-dialog-primary"
            >
              {readiness.missing.includes('posting_terms') &&
              readiness.missing.length === 1
                ? 'Review and accept terms'
                : 'Complete Recruiter Setup'}
              <ExternalLink className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
