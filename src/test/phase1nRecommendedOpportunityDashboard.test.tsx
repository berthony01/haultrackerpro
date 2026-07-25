// Phase 1N-B — Recommended Opportunity dashboard card coverage.
//
// Pure trust-policy tests exercise the real ranking / eligibility module.
// Card tests mock only external hooks. Deep-link tests render the real
// OpportunitiesPage with a lightweight OpportunityDetail double. Integration
// gating uses narrow source-order/prop contract assertions per the phase
// packet, only for placement / self-driver-gate wiring.

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Tables } from '@/integrations/supabase/types';
import type {
  CanonicalOpportunity,
  OpportunitySourceRow,
} from '@/lib/opportunities/opportunityCanonicalView';
import type { OpportunityMatch } from '@/lib/opportunities/opportunityMatch';
import {
  RECOMMENDED_OPPORTUNITY_DISMISSED_KEY,
  RECOMMENDED_OPPORTUNITY_OPEN_KEY,
  buildRecommendedOpportunityCandidates,
  chooseRecommendedOpportunity,
  classifyHiringCompatibility,
  getRecommendedOpportunityTimestamp,
  rankRecommendedOpportunityCandidates,
  resolveRequestedOpportunityId,
  type RecommendedOpportunityCandidate,
} from '@/lib/opportunities/recommendedOpportunity';

/* --------------------------- jsdom polyfills --------------------------- */
beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

/* ============================================================ */
/* PART A — Pure trust-policy tests                             */
/* ============================================================ */

function makeCanonical(
  overrides: Partial<{
    id: string;
    hiringStates: string[] | null;
    hiringState: string | null;
    transparency: number;
    featured: boolean;
  }> = {},
): CanonicalOpportunity {
  const statesArr = overrides.hiringStates;
  const single = overrides.hiringState;
  const c: any = {
    sourceVersion: 'canonical_v1',
    identity: {
      id: overrides.id ?? 'opp-x',
      recruiterId: 'rec-1',
      title: 'T',
      companyName: { state: 'not_disclosed' },
    },
    classification: {
      employmentModel: 'company_driver',
      teamConfiguration: 'solo',
      routeType: { state: 'not_disclosed' },
      trailerType: { state: 'not_disclosed' },
    },
    hiringArea: {
      city: { state: 'not_disclosed' },
      state:
        single != null && single !== ''
          ? { state: 'provided', value: single }
          : { state: 'not_disclosed' },
      states:
        statesArr && statesArr.length > 0
          ? { state: 'provided', value: statesArr.slice() }
          : { state: 'not_disclosed' },
      displayLabel: 'Hiring area not disclosed',
    },
    compensation: {} as any,
    operatingTerms: {} as any,
    costs: {} as any,
    content: {} as any,
    trust: {
      lifecycleStatus: 'active',
      internalReviewStatus: 'approved',
      publishedAt: { state: 'not_disclosed' },
      featured: overrides.featured === true,
      recruiterVerification: 'approved',
    },
    derived: {
      financialEstimate: {} as any,
      transparencyScore: {
        score: overrides.transparency ?? 50,
        band: 'partial',
        missingRelevantFields: [],
        conflicts: [],
        notes: [],
      },
    },
  };
  return c as CanonicalOpportunity;
}

function makeMatch(overrides: Partial<OpportunityMatch> = {}): OpportunityMatch {
  return {
    matchScore: 80,
    matchTier: 'strong',
    reasons: [],
    warnings: [],
    breakdown: {
      payProfit: 0,
      routeType: 0,
      driverType: 0,
      trailer: 0,
      deadhead: 0,
      leaseDeductions: 0,
      experience: 0,
    },
    hasSevereWarning: false,
    ...overrides,
  } as OpportunityMatch;
}

function makeCandidate(
  args: Partial<{
    id: string;
    matchScore: number;
    matchTier: OpportunityMatch['matchTier'];
    hasSevereWarning: boolean;
    hiringCompatibility: 'match' | 'neutral' | 'mismatch';
    transparency: number;
    ts: number | null;
    featured: boolean;
  }> = {},
): RecommendedOpportunityCandidate {
  const id = args.id ?? 'opp-x';
  return {
    opportunity: { id } as unknown as OpportunitySourceRow,
    canonical: makeCanonical({
      id,
      transparency: args.transparency ?? 50,
      featured: args.featured ?? false,
    }),
    match: makeMatch({
      matchScore: args.matchScore ?? 80,
      matchTier: args.matchTier ?? 'strong',
      hasSevereWarning: args.hasSevereWarning ?? false,
    }),
    hiringCompatibility: args.hiringCompatibility ?? 'neutral',
    sortableTimestamp: args.ts ?? null,
  };
}

describe('Phase 1N-B trust policy (pure)', () => {
  it('overlap → match', () => {
    const c = makeCanonical({ hiringStates: ['tx', 'OK'] });
    expect(classifyHiringCompatibility(c, ['ok', 'ga'])).toBe('match');
  });

  it('explicit non-overlap → mismatch', () => {
    const c = makeCanonical({ hiringStates: ['TX', 'OK'] });
    expect(classifyHiringCompatibility(c, ['CA', 'NY'])).toBe('mismatch');
  });

  it('empty driver preferences or undisclosed listing → neutral', () => {
    const cWith = makeCanonical({ hiringStates: ['TX'] });
    const cWithout = makeCanonical();
    expect(classifyHiringCompatibility(cWith, [])).toBe('neutral');
    expect(classifyHiringCompatibility(cWith, null)).toBe('neutral');
    expect(classifyHiringCompatibility(cWithout, ['TX'])).toBe('neutral');
  });

  it('higher match score beats a featured lower-score listing', () => {
    const lo = makeCandidate({ id: 'a', matchScore: 82, featured: true });
    const hi = makeCandidate({ id: 'b', matchScore: 88, featured: false });
    expect(rankRecommendedOpportunityCandidates([lo, hi])[0].canonical.identity.id).toBe('b');
  });

  it('at equal score, explicit hiring match beats neutral', () => {
    const neutral = makeCandidate({ id: 'a', matchScore: 80, hiringCompatibility: 'neutral' });
    const match = makeCandidate({ id: 'b', matchScore: 80, hiringCompatibility: 'match' });
    expect(rankRecommendedOpportunityCandidates([neutral, match])[0].canonical.identity.id).toBe('b');
  });

  it('at equal score/geo, higher transparency wins', () => {
    const low = makeCandidate({ id: 'a', transparency: 40 });
    const high = makeCandidate({ id: 'b', transparency: 90 });
    expect(rankRecommendedOpportunityCandidates([low, high])[0].canonical.identity.id).toBe('b');
  });

  it('at equal score/geo/transparency, newer valid timestamp wins', () => {
    const older = makeCandidate({ id: 'a', ts: 1000 });
    const newer = makeCandidate({ id: 'b', ts: 2000 });
    expect(rankRecommendedOpportunityCandidates([older, newer])[0].canonical.identity.id).toBe('b');
    const missing = makeCandidate({ id: 'c', ts: null });
    const dated = makeCandidate({ id: 'd', ts: 500 });
    expect(rankRecommendedOpportunityCandidates([missing, dated])[0].canonical.identity.id).toBe('d');
  });

  it('featured/priority wins only after score+geo+transparency+timestamp are equal', () => {
    const plain = makeCandidate({ id: 'a', ts: 1000, featured: false });
    const feat = makeCandidate({ id: 'b', ts: 1000, featured: true });
    expect(rankRecommendedOpportunityCandidates([plain, feat])[0].canonical.identity.id).toBe('b');
    // If any organic signal differs, featured must NOT win.
    const featLowerScore = makeCandidate({ id: 'b', matchScore: 79, featured: true, ts: 1000 });
    const plainHigherScore = makeCandidate({ id: 'a', matchScore: 80, featured: false, ts: 1000 });
    expect(
      rankRecommendedOpportunityCandidates([featLowerScore, plainHigherScore])[0].canonical.identity.id,
    ).toBe('a');
  });

  it('id ascending is the final deterministic tie-break', () => {
    const b = makeCandidate({ id: 'b', ts: 1000, featured: false });
    const a = makeCandidate({ id: 'a', ts: 1000, featured: false });
    expect(rankRecommendedOpportunityCandidates([b, a])[0].canonical.identity.id).toBe('a');
  });

  it('chooseRecommendedOpportunity excludes possible/weak, severe-warning, hiring mismatch, and dismissed candidates', () => {
    const possible = makeCandidate({ id: 'p', matchScore: 60, matchTier: 'possible' });
    const weak = makeCandidate({ id: 'w', matchScore: 30, matchTier: 'weak' });
    const severe = makeCandidate({ id: 's', matchScore: 90, matchTier: 'excellent', hasSevereWarning: true });
    const mismatch = makeCandidate({ id: 'm', matchScore: 90, matchTier: 'excellent', hiringCompatibility: 'mismatch' });
    const strong = makeCandidate({ id: 'ok', matchScore: 75, matchTier: 'strong' });
    expect(chooseRecommendedOpportunity([possible, weak, severe, mismatch, strong])?.canonical.identity.id).toBe('ok');
    // Dismissed excludes even the winner.
    const excellent = makeCandidate({ id: 'e', matchScore: 95, matchTier: 'excellent' });
    expect(chooseRecommendedOpportunity([excellent, strong], ['e'])?.canonical.identity.id).toBe('ok');
    // Nothing eligible → null.
    expect(chooseRecommendedOpportunity([possible, weak, severe, mismatch])).toBeNull();
  });

  it('resolveRequestedOpportunityId returns only exact currently visible ids', () => {
    expect(resolveRequestedOpportunityId('  opp-1  ', ['opp-1', 'opp-2'])).toBe('opp-1');
    expect(resolveRequestedOpportunityId('opp-3', ['opp-1'])).toBeNull();
    expect(resolveRequestedOpportunityId('', ['opp-1'])).toBeNull();
    expect(resolveRequestedOpportunityId(null, ['opp-1'])).toBeNull();
  });

  it('getRecommendedOpportunityTimestamp prefers published_at over created_at, ignores invalid', () => {
    expect(
      getRecommendedOpportunityTimestamp({
        published_at: '2026-07-20T00:00:00Z',
        created_at: '2026-07-01T00:00:00Z',
      }),
    ).toBe(Date.parse('2026-07-20T00:00:00Z'));
    expect(
      getRecommendedOpportunityTimestamp({ published_at: null, created_at: '2026-07-01T00:00:00Z' }),
    ).toBe(Date.parse('2026-07-01T00:00:00Z'));
    expect(getRecommendedOpportunityTimestamp({ published_at: null, created_at: null })).toBeNull();
    expect(getRecommendedOpportunityTimestamp({ published_at: 'nope', created_at: 'also-nope' })).toBeNull();
  });

  it('buildRecommendedOpportunityCandidates runs one normalize/match per opportunity', () => {
    const row = makeRow({ id: 'r1', title: 'Foo', hiring_states: ['TX'] });
    const profile = { profile_completed: true, preferred_states: ['TX'] } as any;
    const out = buildRecommendedOpportunityCandidates([row as unknown as OpportunitySourceRow], profile);
    expect(out).toHaveLength(1);
    expect(out[0].canonical.identity.id).toBe('r1');
    expect(out[0].hiringCompatibility).toBe('match');
  });
});

/* ============================================================ */
/* PART B — Card behavior                                       */
/* ============================================================ */

type Row = Tables<'opportunities'>;
function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    actual_benefits: null,
    admin_review_status: 'approved',
    benefits: null,
    canonical_version: 1,
    company_name: null,
    cpm: null,
    created_at: '2026-07-01T00:00:00Z',
    deadhead_paid: null,
    description: null,
    detention_pay: null,
    driver_type: null,
    employment_model: null,
    equipment_year: null,
    escrow_amount: null,
    escrow_amount_frequency: null,
    escrow_required: false,
    escrow_required_state: null,
    estimated_deadhead_miles: null,
    estimated_loaded_miles: null,
    estimated_weekly_gross: null,
    estimated_weekly_miles: null,
    featured: false,
    flat_weekly_pay: null,
    forced_dispatch: null,
    fuel_paid_by: null,
    hiring_city: null,
    hiring_state: null,
    hiring_states: [],
    home_time: null,
    id: 'row-x',
    insurance_deduction_frequency: null,
    insurance_deductions: null,
    layover_pay: null,
    lease_payment: null,
    lease_payment_frequency: null,
    maintenance_deduction_frequency: null,
    maintenance_deductions: null,
    mixed_pay_components: [],
    other_deduction_frequency: null,
    other_deductions: null,
    other_pay_method_label: null,
    other_weekly_gross: null,
    pay_model: null,
    percentage_basis_label: null,
    percentage_pay: null,
    percentage_weekly_revenue_basis: null,
    pets_allowed: null,
    published_at: null,
    recruiter_id: 'rec-1',
    requirements: null,
    riders_allowed: null,
    route_type: null,
    salary_amount: null,
    salary_frequency: null,
    sign_on_bonus: null,
    status: 'active',
    team_configuration: null,
    title: 'Untitled',
    trailer_type: null,
    transparency_confirmed: false,
    typical_lanes: null,
    updated_at: '2026-07-01T00:00:00Z',
    view_count: 0,
    ...overrides,
  } as Row;
}

/** A fully-complete 1099 CPM row so the match engine can score cleanly. */
function eligibleRow(overrides: Partial<Row> = {}): Row {
  return makeRow({
    id: 'opp-hot',
    title: 'OTR Reefer Solo',
    company_name: 'Acme Freight',
    employment_model: 'contractor_1099',
    team_configuration: 'solo',
    route_type: 'OTR',
    trailer_type: 'Reefer',
    hiring_city: 'Dallas',
    hiring_state: 'TX',
    hiring_states: ['TX', 'OK'],
    description: 'A full description.',
    home_time: 'Weekly',
    forced_dispatch: false,
    pets_allowed: true,
    riders_allowed: false,
    equipment_year: '2022',
    typical_lanes: 'TX -> OK',
    requirements: 'Class A CDL',
    actual_benefits: 'PTO and health',
    pay_model: 'cpm',
    cpm: 0.65,
    estimated_weekly_miles: 2500,
    estimated_loaded_miles: 2300,
    estimated_deadhead_miles: 200,
    deadhead_paid: true,
    fuel_paid_by: 'company',
    insurance_deductions: 100,
    insurance_deduction_frequency: 'weekly',
    maintenance_deductions: 50,
    maintenance_deduction_frequency: 'weekly',
    other_deductions: 25,
    other_deduction_frequency: 'weekly',
    escrow_required_state: 'not_required',
    published_at: '2026-07-15T00:00:00Z',
    ...overrides,
  });
}

const completedProfile: any = {
  profile_completed: true,
  preferred_states: ['TX'],
  preferred_route_type: 'OTR',
  preferred_driver_type: null,
  trailer_experience: ['Reefer'],
  min_weekly_gross: 1000,
  min_weekly_net: 800,
  min_effective_rpm: 0.5,
  years_experience: 5,
  visibility: 'private',
};

/* Mutable stores wired into vi.mock. */
function createStore<T>(initial: T) {
  let v = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => v,
    set: (n: T) => {
      v = n;
      listeners.forEach((l) => l());
    },
    use: () => {
      const [, setTick] = React.useState(0);
      React.useEffect(() => {
        const l = () => setTick((t) => t + 1);
        listeners.add(l);
        return () => {
          listeners.delete(l);
        };
      }, []);
      return v;
    },
  };
}

const opportunitiesStore = createStore<Row[]>([]);
const profileStore = createStore<any>(null);
const loadStateStore = createStore<{ isLoading: boolean; isError: boolean }>({
  isLoading: false,
  isError: false,
});
const profileLoadStateStore = createStore<{ isLoading: boolean; isError: boolean }>({
  isLoading: false,
  isError: false,
});

vi.mock('@/hooks/opportunities/useOpportunities', () => ({
  useOpportunities: () => {
    const opportunities = opportunitiesStore.use();
    const ls = loadStateStore.use();
    return {
      opportunities,
      isLoading: ls.isLoading,
      isError: ls.isError,
      error: null,
      refetch: vi.fn(),
    };
  },
}));
vi.mock('@/hooks/opportunities/useDriverOpportunityProfile', () => ({
  useDriverOpportunityProfile: () => {
    const profile = profileStore.use();
    const ls = profileLoadStateStore.use();
    return {
      profile,
      isLoading: ls.isLoading,
      isError: ls.isError,
      error: null,
      refetch: vi.fn(),
      upsertProfile: { mutate: vi.fn(), isPending: false },
      deleteProfile: { mutate: vi.fn(), isPending: false },
    };
  },
}));

// Boundary mocks used only when the full OpportunitiesPage renders.
vi.mock('@/hooks/opportunities/useSavedOpportunities', () => ({
  useSavedOpportunities: () => ({
    saved: [],
    save: { mutate: vi.fn(), isPending: false },
    unsave: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({ isPro: false, isLoading: false, error: null }),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));
vi.mock('@/components/opportunities/DriverOpportunityProfile', () => ({
  DriverOpportunityProfile: () => <div data-testid="prefs" />,
}));
vi.mock('@/components/opportunities/DriverApplicationsPanel', () => ({
  DriverApplicationsPanel: () => <div data-testid="apps" />,
}));
vi.mock('@/components/opportunities/DriverReferralsPanel', () => ({
  DriverReferralsPanel: () => <div data-testid="refs" />,
}));
vi.mock('@/components/opportunities/OpportunityDetail', () => ({
  OpportunityDetail: ({ opportunity, onBack }: any) => (
    <div data-testid="detail-mock">
      <p data-testid="detail-id">{opportunity.id}</p>
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

// Import the SUT after mocks are declared.
import { RecommendedOpportunityCard } from '@/components/opportunities/RecommendedOpportunityCard';
import { OpportunitiesPage } from '@/components/opportunities/OpportunitiesPage';

function renderCard(onNavigate = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RecommendedOpportunityCard onNavigate={onNavigate} />
    </QueryClientProvider>,
  );
  return { onNavigate, ...utils };
}

function resetStores() {
  opportunitiesStore.set([]);
  profileStore.set(null);
  loadStateStore.set({ isLoading: false, isError: false });
  profileLoadStateStore.set({ isLoading: false, isError: false });
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
}

beforeEach(() => resetStores());
afterEach(() => resetStores());

describe('Phase 1N-B card behavior', () => {
  it('incomplete/missing profile renders "Complete Your Opportunity Preferences" and navigates to opportunity-preferences', async () => {
    profileStore.set(null);
    const { onNavigate } = renderCard();
    expect(screen.getByText('Complete Your Opportunity Preferences')).toBeTruthy();
    expect(screen.queryByText('Recommended Opportunity')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Set Opportunity Preferences/i }));
    expect(onNavigate).toHaveBeenCalledWith('opportunity-preferences');
    // Also verify with an incomplete-but-present profile.
    profileStore.set({ profile_completed: false, preferred_states: [] });
    expect(screen.getByText('Complete Your Opportunity Preferences')).toBeTruthy();
    expect(screen.queryByText('Recommended Opportunity')).toBeNull();
  });

  it('completed profile with eligible candidate renders full recommendation surface', () => {
    profileStore.set(completedProfile);
    opportunitiesStore.set([eligibleRow()]);
    const { container } = renderCard();
    expect(screen.getByText('Recommended Opportunity')).toBeTruthy();
    expect(screen.getByText('OTR Reefer Solo')).toBeTruthy();
    expect(screen.getByText('Acme Freight')).toBeTruthy();
    expect(screen.getByText('Verified Recruiter')).toBeTruthy();
    // Hiring, route, trailer surfaced.
    expect(screen.getByText('Dallas, TX')).toBeTruthy();
    expect(screen.getByText('OTR')).toBeTruthy();
    expect(screen.getByText('Reefer')).toBeTruthy();
    // Truthful gross source label (derived from cpm × loaded miles).
    expect(screen.getByText('Derived weekly gross')).toBeTruthy();
    // Primary actions remain reachable.
    expect(screen.getByRole('button', { name: /View Opportunity/i })).toBeTruthy();
    // Phase 1O-B omission contract: matching/transparency data may be
    // omitted from this compact surface, and no filler chips may render.
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Not disclosed/i);
    expect(text).not.toMatch(/Not applicable/i);
    expect(text).not.toMatch(/Unavailable/i);
    // No standalone em-dash cells (em-dashes embedded in prose like
    // "Nationwide — Lower 48" are permitted; a bare "—" chip is not).
    const bareEmDash = Array.from(container.querySelectorAll('*')).some(
      (el) => (el.textContent ?? '').trim() === '—',
    );
    expect(bareEmDash).toBe(false);
  });

  it('featured candidate renders "Priority placement" and never "Featured Load"', () => {
    profileStore.set(completedProfile);
    opportunitiesStore.set([eligibleRow({ featured: true })]);
    const { container } = renderCard();
    expect(screen.getByText('Priority placement')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Featured Load/);
  });

  it('View Opportunity stores exact id and navigates to opportunities', async () => {
    profileStore.set(completedProfile);
    opportunitiesStore.set([eligibleRow({ id: 'opp-abc' })]);
    const { onNavigate } = renderCard();
    await userEvent.click(screen.getByRole('button', { name: /View Opportunity/i }));
    expect(sessionStorage.getItem(RECOMMENDED_OPPORTUNITY_OPEN_KEY)).toBe('opp-abc');
    expect(onNavigate).toHaveBeenCalledWith('opportunities');
  });

  it('View All removes stale open-id and navigates to opportunities', async () => {
    sessionStorage.setItem(RECOMMENDED_OPPORTUNITY_OPEN_KEY, 'stale');
    profileStore.set(completedProfile);
    opportunitiesStore.set([eligibleRow()]);
    const { onNavigate } = renderCard();
    await userEvent.click(screen.getByRole('button', { name: /View All Opportunities/i }));
    expect(sessionStorage.getItem(RECOMMENDED_OPPORTUNITY_OPEN_KEY)).toBeNull();
    expect(onNavigate).toHaveBeenCalledWith('opportunities');
  });

  it('Dismiss persists id for the session and advances or hides when nothing left', async () => {
    profileStore.set(completedProfile);
    // Two eligible candidates so dismiss advances to the next.
    opportunitiesStore.set([
      eligibleRow({ id: 'opp-1', title: 'One' }),
      eligibleRow({ id: 'opp-2', title: 'Two', published_at: '2026-07-14T00:00:00Z' }),
    ]);
    renderCard();
    // Whichever is chosen first, dismiss should advance to the other.
    const firstTitle = screen.getByTestId('recommended-opportunity-card').textContent!;
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss recommended opportunity' }));
    const persisted = JSON.parse(
      sessionStorage.getItem(RECOMMENDED_OPPORTUNITY_DISMISSED_KEY) ?? '[]',
    );
    expect(Array.isArray(persisted) && persisted.length === 1).toBe(true);
    const secondCard = screen.getByTestId('recommended-opportunity-card');
    expect(secondCard.textContent).not.toBe(firstTitle);
    // Dismiss the second → card hidden.
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss recommended opportunity' }));
    expect(screen.queryByTestId('recommended-opportunity-card')).toBeNull();
    expect(screen.queryByText('Recommended Opportunity')).toBeNull();
  });

  it('no eligible candidate renders no recommendation', () => {
    profileStore.set(completedProfile);
    // Low match: weak content, no pay disclosed.
    opportunitiesStore.set([makeRow({ id: 'meh', title: 'Meh' })]);
    renderCard();
    expect(screen.queryByText('Recommended Opportunity')).toBeNull();
  });

  it('loading and error states fail closed', () => {
    profileStore.set(completedProfile);
    opportunitiesStore.set([eligibleRow()]);
    loadStateStore.set({ isLoading: true, isError: false });
    const { unmount } = renderCard();
    expect(screen.queryByText('Recommended Opportunity')).toBeNull();
    expect(screen.queryByText('Complete Your Opportunity Preferences')).toBeNull();
    unmount();
    loadStateStore.set({ isLoading: false, isError: true });
    renderCard();
    expect(screen.queryByText('Recommended Opportunity')).toBeNull();
  });

  it('advisory copy contains no guaranteed employment/pay/profit wording', () => {
    profileStore.set(completedProfile);
    opportunitiesStore.set([eligibleRow()]);
    const { container } = renderCard();
    const text = container.textContent ?? '';
    expect(text).toMatch(/Verify pay, requirements, availability, and terms directly with the recruiter/);
    expect(text).not.toMatch(/guarantee/i);
    expect(text).not.toMatch(/approved earnings/i);
    expect(text).not.toMatch(/assured/i);
  });
});

/* ============================================================ */
/* PART C — Deep-link continuity                                */
/* ============================================================ */

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OpportunitiesPage onUpgrade={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('Phase 1N-B deep-link continuity', () => {
  it('valid stored id opens that exact OpportunityDetail once after opportunities load', async () => {
    profileStore.set(completedProfile);
    opportunitiesStore.set([
      eligibleRow({ id: 'opp-1', title: 'One' }),
      eligibleRow({ id: 'opp-2', title: 'Two' }),
    ]);
    sessionStorage.setItem(RECOMMENDED_OPPORTUNITY_OPEN_KEY, 'opp-2');
    renderPage();
    const detail = await screen.findByTestId('detail-mock');
    expect(within(detail).getByTestId('detail-id').textContent).toBe('opp-2');
    // Key removed so Back does not reopen detail.
    expect(sessionStorage.getItem(RECOMMENDED_OPPORTUNITY_OPEN_KEY)).toBeNull();
  });

  it('invalid/stale id stays on the list and does not open a different detail', async () => {
    profileStore.set(completedProfile);
    opportunitiesStore.set([eligibleRow({ id: 'opp-1', title: 'One' })]);
    sessionStorage.setItem(RECOMMENDED_OPPORTUNITY_OPEN_KEY, 'opp-not-here');
    renderPage();
    // Give the effect a chance to run.
    await screen.findByRole('heading', { level: 1, name: 'Opportunities' });
    expect(screen.queryByTestId('detail-mock')).toBeNull();
    expect(sessionStorage.getItem(RECOMMENDED_OPPORTUNITY_OPEN_KEY)).toBeNull();
  });

  it('key removal prevents reopening after Back returns to the list', async () => {
    profileStore.set(completedProfile);
    opportunitiesStore.set([eligibleRow({ id: 'opp-9', title: 'Nine' })]);
    sessionStorage.setItem(RECOMMENDED_OPPORTUNITY_OPEN_KEY, 'opp-9');
    renderPage();
    const detail = await screen.findByTestId('detail-mock');
    expect(within(detail).getByTestId('detail-id').textContent).toBe('opp-9');
    await userEvent.click(within(detail).getByRole('button', { name: 'Back' }));
    // Back returns to the list; storage was already cleared, so no re-open.
    await screen.findByRole('heading', { level: 1, name: 'Opportunities' });
    expect(screen.queryByTestId('detail-mock')).toBeNull();
    expect(sessionStorage.getItem(RECOMMENDED_OPPORTUNITY_OPEN_KEY)).toBeNull();
  });
});

/* ============================================================ */
/* PART D — Integration / gating source contracts               */
/* ============================================================ */

const DASHBOARD_SRC = fs.readFileSync(
  path.resolve(__dirname, '../components/DashboardView.tsx'),
  'utf8',
);
const INDEX_SRC = fs.readFileSync(
  path.resolve(__dirname, '../pages/Index.tsx'),
  'utf8',
);

describe('Phase 1N-B integration / gating', () => {
  it('DashboardView opts in via showRecommendedOpportunity + onNavigate and mounts the card between the primary grid and ProfitByLoadTable', () => {
    // Default false + prop wiring.
    expect(DASHBOARD_SRC).toMatch(/showRecommendedOpportunity\?: boolean/);
    expect(DASHBOARD_SRC).toMatch(/showRecommendedOpportunity = false/);
    // Guarded render.
    expect(DASHBOARD_SRC).toMatch(
      /showRecommendedOpportunity && onNavigate[\s\S]*?RecommendedOpportunityCard/,
    );
    // Placement: card must appear before ProfitByLoadTable in the source.
    const cardIdx = DASHBOARD_SRC.indexOf('<RecommendedOpportunityCard');
    const tableIdx = DASHBOARD_SRC.indexOf('<ProfitByLoadTable');
    expect(cardIdx).toBeGreaterThan(0);
    expect(tableIdx).toBeGreaterThan(cardIdx);
    // And AFTER RecentLoadsPanel (which lives in the grid).
    const gridIdx = DASHBOARD_SRC.indexOf('<RecentLoadsPanel');
    expect(gridIdx).toBeGreaterThan(0);
    expect(cardIdx).toBeGreaterThan(gridIdx);
  });

  it('Index.tsx passes the exact self-driver / non-assistant gate to DashboardView', () => {
    expect(INDEX_SRC).toMatch(
      /showRecommendedOpportunity=\{!isActingAsAssistant && effectiveRole === 'driver' && driverWorkspaceAllowed\}/,
    );
  });
});
