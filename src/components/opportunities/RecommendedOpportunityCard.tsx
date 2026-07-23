// Phase 1N-B — Dashboard "Recommended Opportunity" card.
//
// One compact, trust-safe recommendation surfaced on the driver dashboard.
// Fails closed on loading/errors, degrades to a "Complete Your Opportunity
// Preferences" prompt when the profile is missing/incomplete, and never
// shows a recommendation the driver hasn't already earned by disclosing
// preferences. Uses only the existing `useOpportunities()` (safe RPC that
// returns approved/non-suspended recruiter listings) and
// `useDriverOpportunityProfile()` hooks — no new queries.

import { useCallback, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ShieldCheck,
  UserCog,
  ArrowRight,
  X,
  MapPin,
  DollarSign,
  Gauge,
  Truck,
  Sparkles,
  Info,
} from 'lucide-react';
import { useOpportunities } from '@/hooks/opportunities/useOpportunities';
import { useDriverOpportunityProfile } from '@/hooks/opportunities/useDriverOpportunityProfile';
import { OpportunityMatchBadge } from './OpportunityMatchBadge';
import type { OpportunitySourceRow } from '@/lib/opportunities/opportunityCanonicalView';
import {
  RECOMMENDED_OPPORTUNITY_DISMISSED_KEY,
  RECOMMENDED_OPPORTUNITY_OPEN_KEY,
  buildRecommendedOpportunityCandidates,
  chooseRecommendedOpportunity,
} from '@/lib/opportunities/recommendedOpportunity';

interface Props {
  onNavigate: (page: string) => void;
}

const RECRUITER_TRUST_LABEL =
  'Verified Recruiter — listings on this dashboard are limited to approved, non-suspended recruiters by the driver-visible listing service.';

const ADVISORY_COPY =
  'Based on your saved preferences and disclosed listing details. Verify pay, requirements, availability, and terms directly with the recruiter.';

function readInitialDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(RECOMMENDED_OPPORTUNITY_DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function persistDismissed(ids: Set<string>): void {
  try {
    sessionStorage.setItem(
      RECOMMENDED_OPPORTUNITY_DISMISSED_KEY,
      JSON.stringify(Array.from(ids)),
    );
  } catch {
    /* ignore — session-only best-effort */
  }
}

function fmtMoney(v: number): string {
  return `$${Math.round(v).toLocaleString()}`;
}

export function RecommendedOpportunityCard({ onNavigate }: Props) {
  const {
    opportunities,
    isLoading: oppsLoading,
    isError: oppsError,
  } = useOpportunities();
  const {
    profile,
    isLoading: profileLoading,
    isError: profileError,
  } = useDriverOpportunityProfile();

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() =>
    readInitialDismissed(),
  );

  const matchEnabled = !!profile && profile.profile_completed === true;

  const candidates = useMemo(() => {
    if (!matchEnabled || !profile) return [];
    return buildRecommendedOpportunityCandidates(
      opportunities as unknown as OpportunitySourceRow[],
      profile,
    );
  }, [matchEnabled, profile, opportunities]);

  const chosen = useMemo(
    () =>
      matchEnabled
        ? chooseRecommendedOpportunity(candidates, Array.from(dismissedIds))
        : null,
    [matchEnabled, candidates, dismissedIds],
  );

  const handleView = useCallback(() => {
    if (!chosen) return;
    try {
      sessionStorage.setItem(
        RECOMMENDED_OPPORTUNITY_OPEN_KEY,
        chosen.canonical.identity.id,
      );
    } catch {
      /* ignore */
    }
    onNavigate('opportunities');
  }, [chosen, onNavigate]);

  const handleViewAll = useCallback(() => {
    try {
      sessionStorage.removeItem(RECOMMENDED_OPPORTUNITY_OPEN_KEY);
    } catch {
      /* ignore */
    }
    onNavigate('opportunities');
  }, [onNavigate]);

  const handleDismiss = useCallback(() => {
    if (!chosen) return;
    const id = chosen.canonical.identity.id;
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      persistDismissed(next);
      return next;
    });
  }, [chosen]);

  // Fail closed on loading/error — do not show a misleading recommendation.
  if (oppsLoading || profileLoading || oppsError || profileError) {
    return null;
  }

  // Missing or incomplete profile → single "Complete Your Opportunity
  // Preferences" prompt. No recommendation, no priority label.
  if (!profile || profile.profile_completed !== true) {
    return (
      <Card
        data-testid="recommended-opportunity-preferences-prompt"
        className="p-5 border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card"
      >
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-primary/15 p-3 shrink-0">
            <UserCog className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-foreground mb-1">
              Complete Your Opportunity Preferences
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Add a few preferences so we can surface better-matched recruiter
              opportunities for you.
            </p>
            <Button onClick={() => onNavigate('opportunity-preferences')}>
              Set Opportunity Preferences <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // Completed profile but no eligible excellent/strong safe candidate → nothing.
  if (!chosen) return null;

  const c = chosen.canonical;
  const fe = c.derived.financialEstimate;
  const routeType =
    c.classification.routeType.state === 'provided'
      ? c.classification.routeType.value
      : 'Not disclosed';
  const trailerType =
    c.classification.trailerType.state === 'provided'
      ? c.classification.trailerType.value
      : 'Not disclosed';
  const companyName =
    c.identity.companyName.state === 'provided'
      ? c.identity.companyName.value
      : 'Company not disclosed';
  const showGross =
    typeof fe.recurringWeeklyGross === 'number' &&
    Number.isFinite(fe.recurringWeeklyGross);
  const grossLabel =
    fe.grossSource === 'recruiter_provided'
      ? 'Recruiter weekly gross'
      : 'Derived weekly gross';
  const transparency = c.derived.transparencyScore.score;

  return (
    <Card
      data-testid="recommended-opportunity-card"
      className="p-5 border-primary/30 bg-gradient-to-br from-card via-card to-primary/5"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="rounded-xl bg-primary/15 p-2 shrink-0">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <h3 className="text-base font-bold text-foreground truncate">
            Recommended Opportunity
          </h3>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss recommended opportunity"
          className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-sm font-bold text-foreground truncate">
            {c.identity.title}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {companyName}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge
            variant="outline"
            className="border-success/40 text-success gap-1"
            title={RECRUITER_TRUST_LABEL}
            aria-label={RECRUITER_TRUST_LABEL}
          >
            <ShieldCheck className="h-3 w-3" aria-hidden /> Verified Recruiter
          </Badge>
          <OpportunityMatchBadge
            score={chosen.match.matchScore}
            tier={chosen.match.matchTier}
          />
          {c.trust.featured && (
            <Badge
              variant="secondary"
              className="bg-primary/15 text-primary border-primary/20"
              title="Priority placement — recruiter-paid placement, separate from the recommendation match."
              aria-label="Priority placement — recruiter-paid placement, separate from the recommendation match."
            >
              Priority placement
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <MiniStat
            icon={MapPin}
            label="Hiring"
            value={c.hiringArea.displayLabel}
          />
          <MiniStat icon={Truck} label="Route" value={routeType} />
          <MiniStat icon={Gauge} label="Trailer" value={trailerType} />
          {showGross ? (
            <MiniStat
              icon={DollarSign}
              label={grossLabel}
              value={fmtMoney(fe.recurringWeeklyGross as number)}
            />
          ) : (
            <MiniStat
              icon={Info}
              label="Listing transparency"
              value={`${transparency}/100`}
            />
          )}
        </div>

        {showGross && (
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              Listing transparency:
            </span>{' '}
            {transparency}/100
          </p>
        )}

        <p className="text-xs text-muted-foreground leading-relaxed">
          {ADVISORY_COPY}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleView}>
            View Opportunity <ArrowRight className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={handleViewAll}>
            View All Opportunities
          </Button>
        </div>
      </div>
    </Card>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <Icon className="h-4 w-4 mt-0.5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </p>
        <p className="text-sm font-semibold text-foreground truncate">
          {value}
        </p>
      </div>
    </div>
  );
}
