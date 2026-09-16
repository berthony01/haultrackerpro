/**
 * Phase CF-1C-C — Driver-facing surface for the pure CF-1C-A structured
 * qualification evaluator.
 *
 * Purely presentational. It receives an already-computed `QualificationResult`
 * and renders it. No database, network, AI, RPC, conversation, application, or
 * profile-write behavior lives here, and nothing in this panel gates any
 * action: `Talk to Recruiter` and `Apply` remain owned by OpportunityDetail
 * and are unaffected by every status below.
 *
 * Wording contract: this panel describes only the KNOWN STRUCTURED CRITERIA the
 * recruiter recorded, compared against the driver's own recorded Work Profile.
 * It must never claim the driver is qualified, eligible, approved, or hired.
 */
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, ClipboardList, Info } from 'lucide-react';
import type {
  QualificationCriterionResult,
  QualificationResult,
} from '@/lib/opportunities/opportunityQualification';

interface Props {
  result: QualificationResult;
  /**
   * Existing OpportunityDetail preferences callback. Reused as-is — this panel
   * introduces no navigation state of its own.
   */
  onOpenPreferences: () => void;
}

/** Secondary, never status-changing note about free-text recruiter requirements. */
const MANUAL_REVIEW_COPY = 'The recruiter may have additional requirements to review.';

function CriterionList({
  items,
  testid,
  tone,
}: {
  items: QualificationCriterionResult[];
  testid: string;
  tone: 'warn' | 'info';
}) {
  if (items.length === 0) return null;
  const Icon = tone === 'warn' ? AlertTriangle : Info;
  const iconClass = tone === 'warn' ? 'text-destructive' : 'text-primary';
  return (
    <ul className="space-y-1.5 mt-2" data-testid={testid}>
      {items.map((c) => (
        <li
          key={c.key}
          className="flex items-start gap-2 text-xs text-foreground"
          data-testid={`qualification-criterion-${c.key}`}
        >
          <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${iconClass}`} aria-hidden />
          <span className="break-words">
            {c.detail}
            {c.required ? (
              <span className="text-muted-foreground"> (Recruiter listed: {c.required})</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function OpportunityQualificationPanel({ result, onOpenPreferences }: Props) {
  // Nothing structured was recorded by the recruiter — render nothing rather
  // than an empty, noisy panel.
  if (result.status === 'no_structured_criteria') return null;

  const manualReview = result.manualReviewRequired ? (
    <p className="text-[11px] text-muted-foreground mt-2 break-words" data-testid="qualification-manual-review">
      {MANUAL_REVIEW_COPY}
    </p>
  ) : null;

  if (result.status === 'meets_known_criteria') {
    return (
      <Card
        className="p-4 border-success/30 bg-success/[0.06]"
        data-testid="opportunity-qualification-panel"
        data-status={result.status}
        aria-label="Listed criteria comparison"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground mb-1">Listed Criteria</h3>
            <p className="text-xs text-foreground break-words">
              Based on your Driver Work Profile, you meet the criteria HaulTracker can compare.
            </p>
            <CriterionList items={result.met} testid="qualification-met-list" tone="info" />
            {manualReview}
          </div>
        </div>
      </Card>
    );
  }

  if (result.status === 'needs_driver_information') {
    return (
      <Card
        className="p-4 border-border/60 bg-muted/20"
        data-testid="opportunity-qualification-panel"
        data-status={result.status}
        aria-label="Listed criteria comparison"
      >
        <div className="flex items-start gap-3">
          <ClipboardList className="h-4 w-4 text-primary mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0 w-full">
            <h3 className="text-sm font-bold text-foreground mb-1">Listed Criteria</h3>
            <p className="text-xs text-foreground break-words">
              This recruiter listed criteria we cannot compare yet because some details are not
              recorded on your Driver Work Profile.
            </p>
            <CriterionList items={result.unknown} testid="qualification-unknown-list" tone="info" />
            {manualReview}
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenPreferences}
              className="mt-3 min-h-[44px] w-full sm:w-auto"
              data-testid="qualification-open-preferences"
            >
              Update Opportunity Preferences
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // does_not_meet_known_criteria — advisory only, never a block.
  return (
    <Card
      className="p-4 border-destructive/30 bg-destructive/[0.05]"
      data-testid="opportunity-qualification-panel"
      data-status={result.status}
      aria-label="Listed criteria comparison"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0 w-full">
          <h3 className="text-sm font-bold text-foreground mb-1">Listed Criteria</h3>
          <p className="text-xs text-foreground break-words">
            Your current Driver Work Profile does not match one or more criteria this recruiter
            listed. The recruiter makes the final hiring decision, and you can still start a
            conversation.
          </p>
          <CriterionList items={result.failed} testid="qualification-failed-list" tone="warn" />
          {manualReview}
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenPreferences}
            className="mt-3 min-h-[44px] w-full sm:w-auto"
            data-testid="qualification-open-preferences"
          >
            Update Opportunity Preferences
          </Button>
        </div>
      </div>
    </Card>
  );
}
