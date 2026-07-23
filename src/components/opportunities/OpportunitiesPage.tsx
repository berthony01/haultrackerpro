import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Phase 1J-C1 — Pure fail-closed helpers (exported for direct unit tests).
// ---------------------------------------------------------------------------

/**
 * Decides what should happen after a completed Preferences save that
 * originated from an Apply Now attempt on `originId`.
 *
 *  - 'resume'         → origin still exists AND selectedId matches origin;
 *                       parent may mint a resume token for `originId`.
 *  - 'clear-to-list'  → origin missing OR selectedId no longer equals origin;
 *                       parent MUST clear origin/resume, and MUST clear
 *                       selectedId, and MUST NOT resume Apply anywhere.
 *  - 'no-origin'      → not an Apply-origin save; do nothing.
 */
export function resolveApplyResumeAfterSave(input: {
  originId: string | null;
  selectedId: string | null;
  existingIds: string[];
}): 'resume' | 'clear-to-list' | 'no-origin' {
  if (!input.originId) return 'no-origin';
  const stillExists = input.existingIds.includes(input.originId);
  const matches = input.selectedId === input.originId;
  if (stillExists && matches) return 'resume';
  return 'clear-to-list';
}

/**
 * Pure reducer for the onResumeApplyConsumed callback. Returns null ONLY
 * when both the current opportunity AND the current token match the
 * consumed token; otherwise returns `prev` unchanged. A stale callback
 * bound to an older selection/token can never clear newer resume state.
 */
export function consumeMatchingResumeState<
  T extends { opportunityId: string; token: string },
>(prev: T | null, selectedId: string | null, consumedToken: string): T | null {
  if (!prev) return prev;
  if (prev.token !== consumedToken) return prev;
  if (prev.opportunityId !== selectedId) return prev;
  return null;
}

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  BriefcaseBusiness,
  Search,
  ShieldCheck,
  DollarSign,
  Gauge,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useOpportunities } from '@/hooks/opportunities/useOpportunities';
import { useSavedOpportunities } from '@/hooks/opportunities/useSavedOpportunities';
import { useSubscription } from '@/hooks/useSubscription';
import { useDriverOpportunityProfile } from '@/hooks/opportunities/useDriverOpportunityProfile';
import { OpportunityCard } from './OpportunityCard';
import { OpportunityDetail } from './OpportunityDetail';
import { DriverOpportunityProfile } from './DriverOpportunityProfile';
import { DriverApplicationsPanel } from './DriverApplicationsPanel';
import { DriverReferralsPanel } from './DriverReferralsPanel';
import { UserCog, ArrowRight, CheckCircle2, Mailbox, Info, UserPlus } from 'lucide-react';
import { calculateOpportunityFinancials } from '@/lib/opportunities/opportunityProfit';
import { calculateOpportunityMatch, type MatchTier } from '@/lib/opportunities/opportunityMatch';
import {
  normalizeOpportunity,
  type OpportunitySourceRow,
  type CanonicalOpportunity,
} from '@/lib/opportunities/opportunityCanonicalView';
import {
  RECOMMENDED_OPPORTUNITY_OPEN_KEY,
  resolveRequestedOpportunityId,
} from '@/lib/opportunities/recommendedOpportunity';

interface Props {
  onUpgrade: () => void;
  onViewChange?: (view: 'list' | 'recruiter' | 'driver-profile') => void;
}

const ANY = 'any';

// Phase 1L-F2B-P3 — sortable timestamp helper: published_at first,
// then created_at; invalid or missing sort last (null).
function getSortableTs(o: { published_at: string | null; created_at: string | null }): number | null {
  const parse = (s: string | null): number | null => {
    if (!s) return null;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  };
  const p = parse(o.published_at);
  if (p != null) return p;
  return parse(o.created_at);
}

export function OpportunitiesPage({ onUpgrade, onViewChange }: Props) {
  const { opportunities, isLoading, isError, error, refetch } = useOpportunities();
  const { saved, save, unsave } = useSavedOpportunities();
  const { isPro } = useSubscription();
  const { profile, isLoading: profileLoading, isError: profileIsError, refetch: refetchProfile } = useDriverOpportunityProfile();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showDriverApps, setShowDriverApps] = useState(false);
  const [showReferrals, setShowReferrals] = useState(false);
  // Phase 1J-C1: single apply-origin marker + atomic resume state so a
  // successful Preferences completion can resume Apply Now exactly once
  // on the originating opportunity — and nothing else.
  const [preferencesOrigin, setPreferencesOrigin] = useState<
    { kind: 'apply'; opportunityId: string } | null
  >(null);
  const [resumeState, setResumeState] = useState<
    { opportunityId: string; token: string } | null
  >(null);
  // Deterministic monotonic per-mount resume-token counter (no timestamps,
  // no crypto.randomUUID) so tests and audits are reproducible.
  const resumeTokenCounterRef = useRef(0);
  const mintResumeToken = () => `resume-${++resumeTokenCounterRef.current}`;
  // Manual entry into Preferences must clear any stale Apply origin/resume
  // state AND any stale selected opportunity so a completed manual save can
  // never revive an old Apply flow and Back always returns to the list.
  const openPreferencesManual = () => {
    setPreferencesOrigin(null);
    setResumeState(null);
    setSelectedId(null);
    setShowProfile(true);
  };


  const [search, setSearch] = useState('');
  const [employment, setEmployment] = useState<string>(ANY);
  const [teamSetup, setTeamSetup] = useState<string>(ANY);
  const [routeType, setRouteType] = useState<string>(ANY);
  const [trailerType, setTrailerType] = useState<string>(ANY);
  const [minGross, setMinGross] = useState<string>('');
  const [paidDeadheadOnly, setPaidDeadheadOnly] = useState(false);
  const [matchTierFilter, setMatchTierFilter] = useState<string>(ANY);
  const [sortBy, setSortBy] = useState<string>('recommended');

  const matchEnabled = !!profile && profile.profile_completed;

  // Honor deep-link routing for driver-profile from /dashboard?page=opportunities&view=driver-profile.
  // Recruiter view is now its own top-level route (page=recruiter-access) handled by Index.
  useEffect(() => {
    try {
      const v = sessionStorage.getItem('htp_opportunities_initial_view');
      if (!v) return;
      sessionStorage.removeItem('htp_opportunities_initial_view');
      if (v === 'driver-profile') {
        // Deep-link entry is functionally a manual entry: never resume Apply.
        openPreferencesManual();
      }
      // 'list' is the default — no-op.
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notify parent of current top-level view so sidebar/header stay in sync.
  useEffect(() => {
    if (!onViewChange) return;
    if (showProfile) {
      onViewChange('driver-profile');
    } else {
      onViewChange('list');
    }
  }, [showProfile, onViewChange]);

  const savedIds = useMemo(() => new Set(saved.map((s) => s.opportunity_id)), [saved]);

  // Phase 1L-F2B-P3 — SINGLE canonical map: exactly one normalizeOpportunity
  // call per raw row. All list-page KPIs, filters, search, disclosure
  // decisions, and non-match sorting consume the canonical object below.
  const canonicalRows = useMemo(
    () =>
      opportunities.map((o) => ({
        opportunity: o,
        canonical: normalizeOpportunity(o as OpportunitySourceRow),
      })),
    [opportunities],
  );

  const routeTypes = useMemo(() => {
    const set = new Set<string>();
    for (const { canonical: c } of canonicalRows) {
      if (c.classification.routeType.state === 'provided') set.add(c.classification.routeType.value);
    }
    return Array.from(set).sort();
  }, [canonicalRows]);

  const trailerTypes = useMemo(() => {
    const set = new Set<string>();
    for (const { canonical: c } of canonicalRows) {
      if (c.classification.trailerType.state === 'provided') set.add(c.classification.trailerType.value);
    }
    return Array.from(set).sort();
  }, [canonicalRows]);

  type Entry = {
    opportunity: (typeof canonicalRows)[number]['opportunity'];
    canonical: CanonicalOpportunity;
    match: ReturnType<typeof calculateOpportunityMatch> | null;
  };

  const filtered = useMemo<Entry[]>(() => {
    const min = Number(minGross) || 0;
    const q = search.trim().toLowerCase();
    const base = canonicalRows.filter(({ canonical: c }) => {
      if (q) {
        const parts: string[] = [c.identity.title];
        if (c.identity.companyName.state === 'provided') parts.push(c.identity.companyName.value);
        parts.push(c.hiringArea.displayLabel);
        if (!parts.join(' ').toLowerCase().includes(q)) return false;
      }
      if (employment !== ANY && c.classification.employmentModel !== employment) return false;
      if (teamSetup !== ANY && c.classification.teamConfiguration !== teamSetup) return false;
      if (routeType !== ANY) {
        if (c.classification.routeType.state !== 'provided' || c.classification.routeType.value !== routeType) return false;
      }
      if (trailerType !== ANY) {
        if (c.classification.trailerType.state !== 'provided' || c.classification.trailerType.value !== trailerType) return false;
      }
      if (min > 0) {
        const g = c.derived.financialEstimate.recurringWeeklyGross;
        if (g == null || !Number.isFinite(g) || g < min) return false;
      }
      if (paidDeadheadOnly) {
        const d = c.compensation.mileage.deadheadPaid;
        if (d.state !== 'provided' || d.value !== true) return false;
      }
      return true;
    });

    let scored: Entry[];
    if (matchEnabled && profile) {
      // Legacy calculator is ONLY invoked inside the completed-profile
      // match-scoring branch, exactly once per candidate row, purely as
      // opportunityFinancials input to calculateOpportunityMatch.
      scored = base.map(({ opportunity: o, canonical }) => {
        const f = calculateOpportunityFinancials(o);
        const match = calculateOpportunityMatch({ opportunity: o, driverProfile: profile, opportunityFinancials: f });
        return { opportunity: o, canonical, match };
      });
      if (matchTierFilter !== ANY) {
        scored = scored.filter((s) => s.match?.matchTier === matchTierFilter);
      }
    } else {
      scored = base.map(({ opportunity: o, canonical }) => ({ opportunity: o, canonical, match: null }));
    }

    const newestCompare = (a: Entry, b: Entry): number => {
      const at = getSortableTs(a.opportunity);
      const bt = getSortableTs(b.opportunity);
      if (at == null && bt == null) return a.opportunity.id.localeCompare(b.opportunity.id);
      if (at == null) return 1;
      if (bt == null) return -1;
      if (bt !== at) return bt - at;
      return a.opportunity.id.localeCompare(b.opportunity.id);
    };

    // Never mutate source arrays: copy first.
    const sorted = [...scored];
    if (sortBy === 'recommended') {
      if (matchEnabled) {
        sorted.sort((a, b) => ((b.match?.matchScore ?? 0) - (a.match?.matchScore ?? 0)) || newestCompare(a, b));
      } else {
        sorted.sort(newestCompare);
      }
    } else if (sortBy === 'newest') {
      sorted.sort(newestCompare);
    } else if (sortBy === 'transparency') {
      sorted.sort((a, b) =>
        (b.canonical.derived.transparencyScore.score - a.canonical.derived.transparencyScore.score) ||
        newestCompare(a, b),
      );
    } else if (sortBy === 'weekly_gross') {
      sorted.sort((a, b) => {
        const ag = a.canonical.derived.financialEstimate.recurringWeeklyGross;
        const bg = b.canonical.derived.financialEstimate.recurringWeeklyGross;
        const aFin = typeof ag === 'number' && Number.isFinite(ag);
        const bFin = typeof bg === 'number' && Number.isFinite(bg);
        if (aFin && bFin) {
          if (bg !== ag) return (bg as number) - (ag as number);
        } else if (aFin) {
          return -1;
        } else if (bFin) {
          return 1;
        }
        const t = b.canonical.derived.transparencyScore.score - a.canonical.derived.transparencyScore.score;
        if (t !== 0) return t;
        return newestCompare(a, b);
      });
    }
    return sorted;
  }, [canonicalRows, search, employment, teamSetup, routeType, trailerType, minGross, paidDeadheadOnly, matchEnabled, profile, matchTierFilter, sortBy]);

  const kpis = useMemo(() => {
    const total = canonicalRows.length;
    let completeCount = 0;
    let sumScore = 0;
    let grossDisclosed = 0;
    for (const { canonical: c } of canonicalRows) {
      if (c.derived.transparencyScore.band === 'complete') completeCount++;
      sumScore += c.derived.transparencyScore.score;
      const g = c.derived.financialEstimate.recurringWeeklyGross;
      if (typeof g === 'number' && Number.isFinite(g)) grossDisclosed++;
    }
    const avg = total > 0 ? Math.round(sumScore / total) : 0;
    return { total, completeCount, avg, grossDisclosed };
  }, [canonicalRows]);

  const handleToggleSave = (id: string) => {
    const isSaved = savedIds.has(id);
    const m = isSaved ? unsave : save;
    m.mutate(id, {
      onSuccess: () => toast.success(isSaved ? 'Removed from saved' : 'Saved successfully'),
      onError: (e: Error) => toast.error(e.message),
    });
  };

  const selected = useMemo(
    () => opportunities.find((o) => o.id === selectedId) || null,
    [opportunities, selectedId]
  );

  // Phase 1J-C1 hook-order correction: `existingIds` and
  // `handleResumeApplyConsumed` are declared here — BEFORE the first
  // conditional return below — so React always calls the same set of
  // hooks in the same order across every render (list, applications
  // panel, referrals panel, preferences, and opportunity detail).
  const existingIds = useMemo(() => opportunities.map((o) => o.id), [opportunities]);

  // Stable resume-consume reducer bound to the currently selected opportunity.
  // Uses the pure `consumeMatchingResumeState` helper so a callback captured
  // by a stale render cannot clear a newer resume token or clear resume
  // state that now targets a different opportunity.
  const handleResumeApplyConsumed = useCallback(
    (consumedToken: string) => {
      setResumeState((prev) => consumeMatchingResumeState(prev, selectedId, consumedToken));
    },
    [selectedId],
  );

  // Phase 1N-B — Dashboard "Recommended Opportunity" deep-link continuity.
  // Hook-order-safe: declared BEFORE the first conditional return below and
  // scheduled once, after opportunities finish loading, to consume any
  // sessionStorage id set by the dashboard card. Uses the safe RPC result
  // as the only allowlist. Removing the key here prevents Back from
  // reopening the detail. Invalid/missing/stale ids fail closed to the list.
  const recommendedOpenIdProcessedRef = useRef(false);
  useEffect(() => {
    if (isLoading) return;
    if (recommendedOpenIdProcessedRef.current) return;
    recommendedOpenIdProcessedRef.current = true;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(RECOMMENDED_OPPORTUNITY_OPEN_KEY);
      sessionStorage.removeItem(RECOMMENDED_OPPORTUNITY_OPEN_KEY);
    } catch {
      raw = null;
    }
    if (raw == null) return;
    const resolved = resolveRequestedOpportunityId(
      raw,
      opportunities.map((o) => o.id),
    );
    if (!resolved) return;
    // Clear any stale Preferences Apply-origin/resume state and close all
    // sibling subviews so the resolved opportunity opens cleanly.
    setPreferencesOrigin(null);
    setResumeState(null);
    setShowProfile(false);
    setShowDriverApps(false);
    setShowReferrals(false);
    setSelectedId(resolved);
  }, [isLoading, opportunities]);



  if (isError) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-primary p-3 shadow-primary shrink-0">
              <BriefcaseBusiness className="h-6 w-6 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1">
                Opportunities
              </h1>
              <p className="text-sm text-muted-foreground">
                Compare trucking opportunities using disclosed pay, operating terms, and listing transparency.
              </p>
            </div>
          </div>
        </Card>
        <EmptyState
          title="Unable to load opportunities"
          body={error && (error as Error).message ? (error as Error).message : 'Something went wrong while loading opportunities. Please try again.'}
          action={
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (showDriverApps) {
    return (
      <DriverApplicationsPanel
        onBack={() => setShowDriverApps(false)}
        onViewOpportunity={(id) => { setShowDriverApps(false); setSelectedId(id); }}
      />
    );
  }

  if (showReferrals) {
    return <DriverReferralsPanel onBack={() => setShowReferrals(false)} isPro={isPro} onUpgrade={onUpgrade} />;
  }



  if (showProfile) {
    return (
      <DriverOpportunityProfile
        onBack={() => {
          // Capture then clear origin/resume unconditionally — Back must
          // never auto-open Apply, and stale origin state must never leak.
          const wasApplyOrigin = preferencesOrigin?.kind === 'apply';
          const originId = wasApplyOrigin ? preferencesOrigin!.opportunityId : null;
          setPreferencesOrigin(null);
          setResumeState(null);
          setShowProfile(false);
          if (wasApplyOrigin && originId) {
            const stillExists = opportunities.some((o) => o.id === originId);
            const selectionMatches = selectedId === originId;
            if (stillExists && selectionMatches) {
              // Selection was preserved through Preferences — return to it.
              // No-op setSelectedId keeps the same detail visible.
            } else {
              // Origin missing OR selectedId no longer equals origin —
              // fail closed to the list. Never force selectedId back to
              // the old origin after a mismatch.
              setSelectedId(null);
            }
          }
          // Manual origin (preferencesOrigin === null) — openPreferencesManual
          // already cleared selectedId, so we return to the list naturally.
        }}
        onSaveSuccess={({ completed }) => {
          if (!completed) return;
          if (preferencesOrigin?.kind !== 'apply') return;
          const originId = preferencesOrigin.opportunityId;
          const decision = resolveApplyResumeAfterSave({
            originId,
            selectedId,
            existingIds,
          });
          if (decision === 'clear-to-list') {
            // Fail closed: clear origin, resume, prefs surface, AND the
            // stale selectedId unconditionally — never reveal a different
            // selected opportunity after a stale Apply-origin save.
            setPreferencesOrigin(null);
            setResumeState(null);
            setShowProfile(false);
            setSelectedId(null);
            return;
          }
          if (decision === 'no-origin') return;
          // decision === 'resume'
          const token = mintResumeToken();
          setPreferencesOrigin(null);
          setResumeState({ opportunityId: originId, token });
          setShowProfile(false);
        }}
      />
    );
  }

  if (selected) {
    const token =
      resumeState && resumeState.opportunityId === selected.id
        ? resumeState.token
        : null;
    return (
      <OpportunityDetail
        opportunity={selected}
        onBack={() => {
          setSelectedId(null);
          setResumeState(null);
        }}
        isPro={isPro}
        onUpgrade={onUpgrade}
        driverProfile={profile}
        onOpenPreferencesForApply={() => {
          // Preserve selectedId — the parent must return to this exact
          // opportunity after Preferences completion.
          setPreferencesOrigin({ kind: 'apply', opportunityId: selected.id });
          setResumeState(null);
          setShowProfile(true);
        }}
        resumeApplyToken={token}
        onResumeApplyConsumed={handleResumeApplyConsumed}
      />

    );
  }


  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-primary p-3 shadow-primary shrink-0">
            <BriefcaseBusiness className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1">
              Opportunities
            </h1>
            <p className="text-sm text-muted-foreground">
              Compare trucking opportunities using disclosed pay, operating terms, and listing transparency.
            </p>
          </div>
        </div>
      </Card>

      {/* Opportunity Preferences entry card */}
      {profileIsError ? (
        <EmptyState
          title="Unable to load your preferences"
          body="Something went wrong while loading your Opportunity Preferences."
          action={
            <Button variant="outline" onClick={() => refetchProfile()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          }
        />
      ) : !profileLoading && (
        <ProfileEntryCard
          state={!profile ? 'none' : profile.profile_completed ? 'complete' : 'incomplete'}
          profile={profile}
          onClick={openPreferencesManual}
        />
      )}

      {/* My Requests entry */}
      <Card className="p-5 border-border/60">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-primary/15 p-3 shrink-0">
            <Mailbox className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-foreground mb-1">My Requests</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Track the opportunities you requested information about.
            </p>
            <Button onClick={() => setShowDriverApps(true)} variant="outline">
              View My Requests <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* My Referrals entry */}
      <Card className="p-5 border-border/60">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-primary/15 p-3 shrink-0">
            <UserPlus className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-foreground mb-1">My Referrals</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Track drivers you've referred to opportunities. Bonuses, if offered, are paid externally by the recruiter.
            </p>
            <Button onClick={() => setShowReferrals(true)} variant="outline">
              View My Referrals <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={BriefcaseBusiness} label="Available" value={kpis.total.toString()} />
        <Kpi icon={ShieldCheck} label="Complete Listings" value={kpis.completeCount.toString()} />
        <Kpi icon={Gauge} label="Avg. Transparency" value={`${kpis.avg}/100`} />
        <Kpi icon={DollarSign} label="Gross Disclosed" value={kpis.grossDisclosed.toString()} />
      </div>

      {/* Filters */}
      <Card className="p-4 border-border/60 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title, company, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <FilterSelect
            label="Employment"
            value={employment}
            onChange={setEmployment}
            options={[
              { value: 'company_driver', label: 'Company Driver' },
              { value: 'contractor_1099', label: '1099 Contractor' },
              { value: 'owner_operator', label: 'Owner-Operator' },
              { value: 'lease_purchase', label: 'Lease-Purchase' },
            ]}
          />
          <FilterSelect
            label="Team setup"
            value={teamSetup}
            onChange={setTeamSetup}
            options={[
              { value: 'solo', label: 'Solo' },
              { value: 'team', label: 'Team' },
              { value: 'solo_or_team', label: 'Team optional' },
            ]}
          />
          <FilterSelect
            label="Route type"
            value={routeType}
            onChange={setRouteType}
            options={routeTypes.map((v) => ({ value: v, label: v }))}
          />
          <FilterSelect
            label="Trailer"
            value={trailerType}
            onChange={setTrailerType}
            options={trailerTypes.map((v) => ({ value: v, label: v }))}
          />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <label htmlFor="min-gross" className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Min recurring weekly gross
            </label>
            <Input
              id="min-gross"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="0"
              value={minGross}
              onChange={(e) => setMinGross(e.target.value)}
              aria-label="Min recurring weekly gross"
            />
          </div>
          <FilterSelect
            label="Sort by"
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: 'recommended', label: 'Recommended' },
              { value: 'newest', label: 'Newest' },
              { value: 'transparency', label: 'Listing transparency' },
              { value: 'weekly_gross', label: 'Weekly gross' },
            ]}
            includeAny={false}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <div className="flex items-center gap-2">
            <Switch checked={paidDeadheadOnly} onCheckedChange={setPaidDeadheadOnly} id="paid-dh" />
            <label htmlFor="paid-dh" className="text-sm text-foreground cursor-pointer">
              Paid deadhead only
            </label>
          </div>
          {matchEnabled && (
            <div className="ml-auto min-w-[180px]">
              <Select value={matchTierFilter} onValueChange={setMatchTierFilter}>
                <SelectTrigger aria-label="Match tier">
                  <SelectValue placeholder="All matches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>All matches</SelectItem>
                  <SelectItem value="excellent">Excellent Fit</SelectItem>
                  <SelectItem value="strong">Strong Fit</SelectItem>
                  <SelectItem value="possible">Possible Fit</SelectItem>
                  <SelectItem value="weak">Weak Fit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </Card>

      {/* List */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : opportunities.length === 0 ? (
        <EmptyState
          title="No opportunities yet"
          body="Recruiters are joining HaulTrackerPro now. Check back soon for new openings."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No results match your filters"
          body="Try clearing filters or broadening your criteria."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setEmployment(ANY);
                setTeamSetup(ANY);
                setRouteType(ANY);
                setTrailerType(ANY);
                setMinGross('');
                setPaidDeadheadOnly(false);
                setMatchTierFilter(ANY);
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(({ opportunity: o }) => (
            <OpportunityCard
              key={o.id}
              opportunity={o}
              isSaved={savedIds.has(o.id)}
              onView={() => setSelectedId(o.id)}
              onToggleSave={() => handleToggleSave(o.id)}
              saving={save.isPending || unsave.isPending}
              isPro={isPro}
              driverProfile={profile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: typeof BriefcaseBusiness; label: string; value: string }) {
  return (
    <Card className="p-4 border-border/60">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <div className="rounded-lg bg-primary/10 p-1.5"><Icon className="h-3.5 w-3.5 text-primary" /></div>
      </div>
      <p className="font-mono text-xl font-black text-foreground whitespace-nowrap">{value}</p>
    </Card>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  includeAny = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  includeAny?: boolean;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder={includeAny ? 'Any' : undefined} />
        </SelectTrigger>
        <SelectContent>
          {includeAny && <SelectItem value={ANY}>Any</SelectItem>}
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <Card className="p-10 border-dashed border-border/60 text-center">
      <div className="mx-auto mb-3 inline-flex rounded-2xl bg-muted/40 p-3">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-base font-bold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">{body}</p>
      {action}
    </Card>
  );
}

function ProfileEntryCard({
  state,
  profile,
  onClick,
}: {
  state: 'none' | 'incomplete' | 'complete';
  profile: ReturnType<typeof useDriverOpportunityProfile>['profile'];
  onClick: () => void;
}) {
  const cfg =
    state === 'none'
      ? {
          title: 'Complete Your Opportunity Preferences',
          body: 'Your HaulTrackerPro account is already your driver identity. Add a few preferences so we can show better matches and help approved recruiters understand what you’re looking for.',
          cta: 'Set Preferences',
          icon: UserCog,
        }
      : state === 'incomplete'
      ? {
          title: 'Complete Your Opportunity Preferences',
          body: 'A few more details unlock better-matched opportunities and richer recruiter context.',
          cta: 'Set Preferences',
          icon: UserCog,
        }
      : {
          title: 'Your Opportunity Preferences Are Ready',
          body: 'Approved recruiters will see this context when you request info on an opportunity.',
          cta: 'Edit Preferences',
          icon: CheckCircle2,
        };

  const Icon = cfg.icon;

  return (
    <Card className="p-5 border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card">
      <div className="flex items-start gap-4">
        <div className="rounded-2xl bg-primary/15 p-3 shrink-0">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-foreground mb-1">{cfg.title}</h3>
          <p className="text-sm text-muted-foreground mb-3">{cfg.body}</p>
          {state === 'complete' && profile && (
            <div className="flex flex-wrap gap-2 mb-3 text-xs">
              {profile.preferred_driver_type && (
                <Badge variant="outline">{profile.preferred_driver_type}</Badge>
              )}
              {profile.preferred_route_type && (
                <Badge variant="outline">{profile.preferred_route_type}</Badge>
              )}
              {(profile.min_weekly_net || profile.min_weekly_gross) && (
                <Badge variant="outline">
                  Min ${Number(profile.min_weekly_net || profile.min_weekly_gross).toLocaleString()}/wk
                  {profile.min_weekly_net ? ' net' : ' gross'}
                </Badge>
              )}
              <Badge variant="outline" className="capitalize">
                {String(profile.visibility).replace('_', ' ')}
              </Badge>
            </div>
          )}
          {state === 'complete' ? (
            <p className="text-xs text-muted-foreground/80 mb-3 flex items-start gap-1.5">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              <span>Preferences only affect match quality and what approved recruiters see when you request info. Your HaulTrackerPro account is unchanged.</span>
            </p>
          ) : (
            <div className="mb-3 rounded-lg border border-border/40 bg-muted/30 p-3">
              <div className="flex items-start gap-2">
                <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground mb-0.5">Why Opportunity Preferences?</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Your main HaulTrackerPro account stays the same. These preferences only help improve match quality and show approved recruiters the information you choose to share when you request info.
                  </p>
                </div>
              </div>
            </div>
          )}
          <Button onClick={onClick} variant={state === 'complete' ? 'outline' : 'default'}>
            {cfg.cta} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

