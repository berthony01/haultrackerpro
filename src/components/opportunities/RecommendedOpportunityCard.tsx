// Phase 1N-B / Phase 1O-B — Dashboard "Recommended Opportunity" card.
//
// Same information hierarchy as the reconstructed OpportunityCard:
// title → company → pay → hiring coverage → compact facts row → secondary
// trust indicators → match badge visually secondary → single primary action.
// Unprovided facts are hidden entirely (never rendered as filler).

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
  Home,
  Briefcase,
  Users,
  Sparkles,
} from 'lucide-react';
import { useOpportunities } from '@/hooks/opportunities/useOpportunities';
import { useDriverOpportunityProfile } from '@/hooks/opportunities/useDriverOpportunityProfile';
import { OpportunityMatchBadge } from './OpportunityMatchBadge';
import { displayHiringCoverage } from './OpportunityCard';
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

const EMPLOYMENT_LABEL: Record<string, string> = {
  company_driver: 'Company Driver',
  contractor_1099: '1099 Contractor',
  owner_operator: 'Owner-Operator',
  lease_purchase: 'Lease-Purchase',
};

const TEAM_LABEL: Record<string, string> = {
  solo: 'Solo',
  team: 'Team',
  solo_or_team: 'Team optional',
};

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

  if (oppsLoading || profileLoading || oppsError || profileError) {
    return null;
  }

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

  if (!chosen) return null;

  const c = chosen.canonical;
  const fe = c.derived.financialEstimate;
  const companyName =
    c.identity.companyName.state === 'provided' ? c.identity.companyName.value : null;
  const coverage = displayHiringCoverage(c);
  const showGross =
    typeof fe.recurringWeeklyGross === 'number' &&
    Number.isFinite(fe.recurringWeeklyGross);
  const grossLabel =
    fe.grossSource === 'recruiter_provided'
      ? 'Recruiter weekly gross'
      : 'Derived weekly gross';

  const employmentLabel = EMPLOYMENT_LABEL[c.classification.employmentModel] ?? null;
  const teamLabel = TEAM_LABEL[c.classification.teamConfiguration] ?? null;
  const routeLabel =
    c.classification.routeType.state === 'provided' ? c.classification.routeType.value : null;
  const trailerLabel =
    c.classification.trailerType.state === 'provided' ? c.classification.trailerType.value : null;
  const homeTimeLabel =
    c.operatingTerms.homeTime.state === 'provided' ? c.operatingTerms.homeTime.value : null;

  const facts: { icon: typeof MapPin; label: string; value: string }[] = [];
  if (employmentLabel) facts.push({ icon: Briefcase, label: 'Employment', value: employmentLabel });
  if (teamLabel) facts.push({ icon: Users, label: 'Config', value: teamLabel });
  if (routeLabel) facts.push({ icon: MapPin, label: 'Route', value: routeLabel });
  if (trailerLabel) facts.push({ icon: Truck, label: 'Trailer', value: trailerLabel });
  if (homeTimeLabel) facts.push({ icon: Home, label: 'Home time', value: homeTimeLabel });

  return (
    <Card
      data-testid="recommended-opportunity-card"
      className="p-5 border-primary/30 bg-gradient-to-br from-card via-card to-primary/5"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="rounded-xl bg-primary/15 p-2 shrink-0">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
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
        {/* Title / company */}
        <div>
          <p className="text-sm font-bold text-foreground truncate">
            {c.identity.title}
          </p>
          {companyName && (
            <p className="text-xs text-muted-foreground truncate">{companyName}</p>
          )}
        </div>

        {/* Dominant pay + coverage */}
        {(showGross || coverage) && (
          <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
            {showGross && (
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {grossLabel}
                </p>
                <p className="text-xl font-black text-primary leading-none whitespace-nowrap">
                  {fmtMoney(fe.recurringWeeklyGross as number)}
                  <span className="text-xs font-bold text-muted-foreground ml-1">/wk</span>
                </p>
              </div>
            )}
            {coverage && (
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Hiring
                </p>
                <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-primary shrink-0" aria-hidden />
                  <span className="truncate">{coverage}</span>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Compact facts */}
        {facts.length > 0 && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            {facts.map((f) => (
              <MiniStat key={f.label} icon={f.icon} label={f.label} value={f.value} />
            ))}
          </div>
        )}

        {/* Secondary trust indicators */}
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant="outline"
            className="border-success/40 text-success gap-1 text-[10px]"
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
              className="bg-primary/10 text-primary border-primary/20 text-[10px]"
              title="Priority placement — recruiter-paid placement, separate from the recommendation match."
              aria-label="Priority placement — recruiter-paid placement, separate from the recommendation match."
            >
              Priority placement
            </Badge>
          )}
        </div>

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

// Kept for backward compatibility with any legacy imports.
export { DollarSign, Gauge };
