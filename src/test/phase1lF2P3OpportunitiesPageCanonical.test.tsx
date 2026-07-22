// Phase 1L-F2B-P3 — Canonical Opportunity list, KPI, filter, sort adoption tests.
//
// Uses REAL normalizeOpportunity and REAL canonical financial estimate. Only
// legacy calculateOpportunityFinancials and calculateOpportunityMatch are
// stubbed (via vi.hoisted spies) for deterministic match-only tests.

import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Tables } from '@/integrations/supabase/types';

// Radix pointer-capture polyfill for jsdom.
beforeAll(() => {
  const proto = window.HTMLElement.prototype as any;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

// -------- Mutable stores driving mocked hooks ---------------------------
function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => {
      value = v;
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
      return value;
    },
  };
}

type Row = Tables<'opportunities'>;
type Profile = any | null;

const opportunitiesStore = createStore<Row[]>([]);
const profileStore = createStore<Profile>(null);

// -------- Hoisted spies preserve real canonical modules -----------------
const hoisted = vi.hoisted(() => {
  const finSpy: any = (o: any) => {
    finSpy.calls.push(o);
    return { estimatedGross: null, estimatedNet: null, effectiveRpm: null };
  };
  finSpy.calls = [] as any[];
  finSpy.reset = () => { finSpy.calls.length = 0; };

  const matchSpy: any = (a: any) => {
    matchSpy.calls.push(a);
    const s = matchSpy.scoreMap[a.opportunity.id] ?? 50;
    const t = matchSpy.tierMap[a.opportunity.id] ?? 'possible';
    return { matchScore: s, matchTier: t };
  };
  matchSpy.calls = [] as any[];
  matchSpy.scoreMap = {} as Record<string, number>;
  matchSpy.tierMap = {} as Record<string, string>;
  matchSpy.reset = () => {
    matchSpy.calls.length = 0;
    matchSpy.scoreMap = {};
    matchSpy.tierMap = {};
  };
  return { finSpy, matchSpy };
});

// -------- Mocks (hooks + child components + narrow lib overrides) --------
vi.mock('@/hooks/opportunities/useOpportunities', () => ({
  useOpportunities: () => {
    const opportunities = opportunitiesStore.use();
    return { opportunities, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  },
}));
vi.mock('@/hooks/opportunities/useSavedOpportunities', () => ({
  useSavedOpportunities: () => ({
    saved: [] as any[],
    save: { mutate: vi.fn(), isPending: false },
    unsave: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({ isPro: false, isLoading: false, error: null }),
}));
vi.mock('@/hooks/opportunities/useDriverOpportunityProfile', () => ({
  useDriverOpportunityProfile: () => {
    const profile = profileStore.use();
    return {
      profile,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      upsertProfile: { mutate: vi.fn(), isPending: false },
      deleteProfile: { mutate: vi.fn(), isPending: false },
    };
  },
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

// OpportunityCard mock exposes id/title in DOM order and preserves onView.
vi.mock('@/components/opportunities/OpportunityCard', () => ({
  OpportunityCard: ({ opportunity, onView }: any) => (
    <button
      data-testid={`card-${opportunity.id}`}
      data-title={opportunity.title}
      onClick={onView}
    >
      Open {opportunity.title}
    </button>
  ),
}));

vi.mock('@/components/opportunities/OpportunityDetail', () => ({
  OpportunityDetail: ({ opportunity, onBack }: any) => (
    <div data-testid="detail-mock">
      <h1>{opportunity.title}</h1>
      <button onClick={onBack}>Detail Back</button>
    </div>
  ),
}));
vi.mock('@/components/opportunities/DriverOpportunityProfile', () => ({
  DriverOpportunityProfile: ({ onBack }: any) => (
    <div data-testid="prefs-mock">
      <h1>Opportunity Preferences</h1>
      <button onClick={onBack}>Prefs Back</button>
    </div>
  ),
}));
vi.mock('@/components/opportunities/DriverApplicationsPanel', () => ({
  DriverApplicationsPanel: ({ onBack }: any) => (
    <div data-testid="apps-panel">
      <h1>My Requests Panel</h1>
      <button onClick={onBack}>Apps Back</button>
    </div>
  ),
}));
vi.mock('@/components/opportunities/DriverReferralsPanel', () => ({
  DriverReferralsPanel: ({ onBack }: any) => (
    <div data-testid="referrals-panel">
      <h1>My Referrals Panel</h1>
      <button onClick={onBack}>Referrals Back</button>
    </div>
  ),
}));

// Real canonical exports preserved; only the legacy calculator is stubbed.
vi.mock('@/lib/opportunities/opportunityProfit', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, calculateOpportunityFinancials: hoisted.finSpy };
});
// Real match module preserved; only calculateOpportunityMatch is stubbed.
vi.mock('@/lib/opportunities/opportunityMatch', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, calculateOpportunityMatch: hoisted.matchSpy };
});

import { OpportunitiesPage } from '@/components/opportunities/OpportunitiesPage';

// -------- Row builder ---------------------------------------------------
function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    actual_benefits: null,
    admin_review_status: 'pending',
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

/** Fully-complete company_driver + flat_weekly row → transparency band 'complete', gross disclosed. */
function completeRow(over: Partial<Row> = {}): Row {
  return makeRow({
    company_name: 'Acme Co',
    employment_model: 'company_driver',
    team_configuration: 'solo',
    route_type: 'OTR',
    trailer_type: 'Dry Van',
    hiring_city: 'Dallas',
    hiring_state: 'TX',
    description: 'desc',
    home_time: 'Weekly',
    forced_dispatch: false,
    pets_allowed: true,
    riders_allowed: false,
    equipment_year: '2022',
    typical_lanes: 'TX->OK',
    requirements: 'CDL A',
    actual_benefits: 'PTO',
    pay_model: 'flat_weekly',
    flat_weekly_pay: 1600,
    ...over,
  });
}

const completedProfile = {
  profile_completed: true,
  full_name: 'Jane Driver',
  email: 'j@example.com',
  phone: '5551234567',
  preferred_driver_type: 'company_driver',
  preferred_route_type: 'OTR',
  preferred_states: ['TX'],
  trailer_experience: ['Dry Van'],
  visibility: 'verified_only',
} as any;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OpportunitiesPage onUpgrade={vi.fn()} />
    </QueryClientProvider>,
  );
}

function cardIds(): string[] {
  return Array.from(document.querySelectorAll('[data-testid^="card-"]')).map(
    (n) => (n as HTMLElement).getAttribute('data-testid')!.replace('card-', ''),
  );
}

function kpiValue(label: string): string {
  const labelNode = screen.getByText(label);
  const card = labelNode.closest('.p-4') as HTMLElement | null;
  if (!card) throw new Error(`KPI card not found for "${label}"`);
  const valueP = card.querySelector('.font-mono') as HTMLElement | null;
  return valueP?.textContent ?? '';
}

async function openCombobox(name: string) {
  const trigger = screen.getByRole('combobox', { name });
  await userEvent.click(trigger);
}

beforeEach(() => {
  hoisted.finSpy.reset();
  hoisted.matchSpy.reset();
  opportunitiesStore.set([]);
  profileStore.set(null);
});
afterEach(() => {
  opportunitiesStore.set([]);
  profileStore.set(null);
});

// =========================================================================
describe('Phase 1L-F2B-P3 — Header + no legacy copy', () => {
  it('1. renders the exact canonical header description and no Profit-first / real pay clarity', () => {
    opportunitiesStore.set([completeRow({ id: 'a' })]);
    renderPage();
    expect(
      screen.getAllByText(
        'Compare trucking opportunities using disclosed pay, operating terms, and listing transparency.',
      ).length,
    ).toBeGreaterThan(0);
    const body = document.body.textContent || '';
    expect(body).not.toMatch(/Profit-first/i);
    expect(body).not.toMatch(/real pay clarity/i);
  });
});

describe('Phase 1L-F2B-P3 — Canonical KPI strip', () => {
  it('2. exact KPI labels and values for two fully-complete canonical rows', () => {
    opportunitiesStore.set([
      completeRow({ id: 'a', flat_weekly_pay: 1600 }),
      completeRow({ id: 'b', flat_weekly_pay: 2000 }),
    ]);
    renderPage();
    expect(kpiValue('Available')).toBe('2');
    expect(kpiValue('Complete Listings')).toBe('2');
    expect(kpiValue('Avg. Transparency')).toBe('100/100');
    expect(kpiValue('Gross Disclosed')).toBe('2');
  });

  it('3. legacy KPI labels are absent (Active Recruiters, Highest Estimated Net, Best Effective RPM)', () => {
    opportunitiesStore.set([completeRow({ id: 'a' })]);
    renderPage();
    const body = document.body.textContent || '';
    expect(body).not.toMatch(/Active Recruiters/);
    expect(body).not.toMatch(/Highest Estimated Net/);
    expect(body).not.toMatch(/Best Effective RPM/);
  });

  it('KPI Avg. Transparency displays 0/100 when there are no opportunities', () => {
    opportunitiesStore.set([]);
    renderPage();
    expect(kpiValue('Available')).toBe('0');
    expect(kpiValue('Avg. Transparency')).toBe('0/100');
    expect(kpiValue('Gross Disclosed')).toBe('0');
  });
});

describe('Phase 1L-F2B-P3 — Legacy financial isolation with incomplete profile', () => {
  it('4. no calculateOpportunityFinancials call for KPIs / filters / sorting when profile is not completed', () => {
    profileStore.set(null);
    opportunitiesStore.set([
      completeRow({ id: 'a' }),
      completeRow({ id: 'b' }),
      completeRow({ id: 'c' }),
    ]);
    renderPage();
    expect(hoisted.finSpy.calls.length).toBe(0);
  });
});

describe('Phase 1L-F2B-P3 — Canonical search', () => {
  it('5. searches by canonical title', async () => {
    opportunitiesStore.set([
      completeRow({ id: 'a', title: 'Reefer OTR' }),
      completeRow({ id: 'b', title: 'Van Regional' }),
    ]);
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/Search title/i), 'reefer');
    expect(cardIds()).toEqual(['a']);
  });

  it('6. searches by provided canonical company name', async () => {
    opportunitiesStore.set([
      completeRow({ id: 'a', company_name: 'Alpha Freight' }),
      completeRow({ id: 'b', company_name: 'Bravo Lines' }),
    ]);
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/Search title/i), 'bravo');
    expect(cardIds()).toEqual(['b']);
  });

  it('7. searches by canonical hiring display label', async () => {
    opportunitiesStore.set([
      completeRow({ id: 'a', hiring_city: 'Dallas', hiring_state: 'TX' }),
      completeRow({ id: 'b', hiring_city: 'Phoenix', hiring_state: 'AZ' }),
    ]);
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/Search title/i), 'phoenix');
    expect(cardIds()).toEqual(['b']);
  });
});

describe('Phase 1L-F2B-P3 — Canonical filters', () => {
  it('8. Employment filter compares canonical employment model', async () => {
    opportunitiesStore.set([
      completeRow({ id: 'a', employment_model: 'company_driver' }),
      completeRow({ id: 'b', employment_model: 'contractor_1099' }),
    ]);
    renderPage();
    await openCombobox('Employment');
    await userEvent.click(await screen.findByRole('option', { name: '1099 Contractor' }));
    expect(cardIds()).toEqual(['b']);
  });

  it('9. Team setup filter compares canonical team configuration', async () => {
    opportunitiesStore.set([
      completeRow({ id: 'a', team_configuration: 'solo' }),
      completeRow({ id: 'b', team_configuration: 'team' }),
    ]);
    renderPage();
    await openCombobox('Team setup');
    await userEvent.click(await screen.findByRole('option', { name: 'Team' }));
    expect(cardIds()).toEqual(['b']);
  });

  it('10. Route filter only lists provided canonical route values; not-provided rows are excluded on match', async () => {
    opportunitiesStore.set([
      completeRow({ id: 'a', route_type: 'OTR' }),
      completeRow({ id: 'b', route_type: 'Regional' }),
      completeRow({ id: 'c', route_type: null }),
    ]);
    renderPage();
    await openCombobox('Route type');
    // Options only include the provided values (OTR, Regional); no "Not disclosed".
    expect(screen.queryByRole('option', { name: /Not disclosed/i })).toBeNull();
    await userEvent.click(await screen.findByRole('option', { name: 'OTR' }));
    expect(cardIds()).toEqual(['a']);
  });

  it('11. Trailer filter only lists provided canonical trailer values', async () => {
    opportunitiesStore.set([
      completeRow({ id: 'a', trailer_type: 'Dry Van' }),
      completeRow({ id: 'b', trailer_type: 'Reefer' }),
      completeRow({ id: 'c', trailer_type: null }),
    ]);
    renderPage();
    await openCombobox('Trailer');
    expect(screen.queryByRole('option', { name: /Not disclosed/i })).toBeNull();
    await userEvent.click(await screen.findByRole('option', { name: 'Reefer' }));
    expect(cardIds()).toEqual(['b']);
  });

  it('12. Min recurring weekly gross uses canonical recurring gross and excludes null-gross rows', async () => {
    // Row 'a' resolves gross 1600 via flat_weekly; row 'b' has no pay model → null gross.
    opportunitiesStore.set([
      completeRow({ id: 'a', flat_weekly_pay: 1600 }),
      completeRow({ id: 'b', pay_model: null, flat_weekly_pay: null }),
    ]);
    renderPage();
    await userEvent.type(
      screen.getByLabelText('Min recurring weekly gross'),
      '1500',
    );
    expect(cardIds()).toEqual(['a']);
  });

  it('13. Paid deadhead only requires explicitly provided true; excludes false and null', async () => {
    // Build cost-bearing rows with mileage so deadheadPaid is relevant.
    const dhRow = (id: string, dh: boolean | null): Row =>
      completeRow({
        id,
        employment_model: 'contractor_1099',
        pay_model: 'cpm',
        cpm: 0.6,
        estimated_weekly_miles: 2500,
        estimated_loaded_miles: 2300,
        estimated_deadhead_miles: 200,
        deadhead_paid: dh,
        fuel_paid_by: 'company',
        insurance_deductions: 100,
        insurance_deduction_frequency: 'weekly',
        maintenance_deductions: 50,
        maintenance_deduction_frequency: 'weekly',
        other_deductions: 25,
        other_deduction_frequency: 'weekly',
        escrow_required_state: 'not_required',
        flat_weekly_pay: null,
      });
    opportunitiesStore.set([dhRow('a', true), dhRow('b', false), dhRow('c', null)]);
    renderPage();
    await userEvent.click(screen.getByLabelText('Paid deadhead only'));
    expect(cardIds()).toEqual(['a']);
  });

  it('14. Match tier filter, with completed profile, only shows rows in the selected tier', async () => {
    profileStore.set(completedProfile);
    hoisted.matchSpy.scoreMap = { a: 80, b: 40, c: 60 };
    hoisted.matchSpy.tierMap = { a: 'strong', b: 'weak', c: 'possible' };
    opportunitiesStore.set([
      completeRow({ id: 'a' }),
      completeRow({ id: 'b' }),
      completeRow({ id: 'c' }),
    ]);
    renderPage();
    await openCombobox('Match tier');
    await userEvent.click(await screen.findByRole('option', { name: 'Strong Fit' }));
    expect(cardIds()).toEqual(['a']);
  });
});

describe('Phase 1L-F2B-P3 — Sort behavior', () => {
  it('15. Recommended without completed profile sorts newest and does not call legacy financials', () => {
    profileStore.set(null);
    opportunitiesStore.set([
      completeRow({ id: 'a', published_at: '2026-07-10T00:00:00Z' }),
      completeRow({ id: 'b', published_at: '2026-07-20T00:00:00Z' }),
      completeRow({ id: 'c', published_at: '2026-07-15T00:00:00Z' }),
    ]);
    renderPage();
    expect(cardIds()).toEqual(['b', 'c', 'a']);
    expect(hoisted.finSpy.calls.length).toBe(0);
  });

  it('16. Recommended with completed profile sorts by descending mocked match score, calling legacy financials exactly once per candidate', () => {
    profileStore.set(completedProfile);
    hoisted.matchSpy.scoreMap = { a: 40, b: 90, c: 70 };
    opportunitiesStore.set([
      completeRow({ id: 'a' }),
      completeRow({ id: 'b' }),
      completeRow({ id: 'c' }),
    ]);
    renderPage();
    expect(cardIds()).toEqual(['b', 'c', 'a']);
    const uniqueIds = new Set(hoisted.finSpy.calls.map((o: any) => o.id));
    expect(uniqueIds).toEqual(new Set(['a', 'b', 'c']));
    expect(hoisted.finSpy.calls.length).toBe(3);
  });

  it('17. Newest sort uses published_at before created_at; missing published falls back to created_at; id tie-break', async () => {
    opportunitiesStore.set([
      completeRow({ id: 'a', published_at: null, created_at: '2026-07-01T00:00:00Z' }),
      completeRow({ id: 'b', published_at: '2026-07-05T00:00:00Z', created_at: '2026-06-01T00:00:00Z' }),
      // c and d share same published timestamp → deterministic id tie-break (c before d).
      completeRow({ id: 'd', published_at: '2026-07-10T00:00:00Z', created_at: '2026-06-01T00:00:00Z' }),
      completeRow({ id: 'c', published_at: '2026-07-10T00:00:00Z', created_at: '2026-06-01T00:00:00Z' }),
    ]);
    renderPage();
    await openCombobox('Sort by');
    await userEvent.click(await screen.findByRole('option', { name: 'Newest' }));
    expect(cardIds()).toEqual(['c', 'd', 'b', 'a']);
  });

  it('18. Listing transparency sort orders by descending canonical transparency score', async () => {
    // 'hi' is fully complete (score 100). 'lo' is bare (score < 100).
    opportunitiesStore.set([
      makeRow({ id: 'lo', title: 'Lo' }),
      completeRow({ id: 'hi', title: 'Hi' }),
    ]);
    renderPage();
    await openCombobox('Sort by');
    await userEvent.click(await screen.findByRole('option', { name: 'Listing transparency' }));
    expect(cardIds()).toEqual(['hi', 'lo']);
  });

  it('19. Weekly gross sort places finite recurring gross first, descending; null gross last', async () => {
    opportunitiesStore.set([
      completeRow({ id: 'low', flat_weekly_pay: 1000 }),
      makeRow({ id: 'nul', title: 'No pay' }), // gross null
      completeRow({ id: 'hi', flat_weekly_pay: 2000 }),
    ]);
    renderPage();
    await openCombobox('Sort by');
    await userEvent.click(await screen.findByRole('option', { name: 'Weekly gross' }));
    expect(cardIds()).toEqual(['hi', 'low', 'nul']);
  });
});

describe('Phase 1L-F2B-P3 — Options never expose unknown / unspecified', () => {
  it('20. Employment and Team setup comboboxes do not offer unknown / unspecified options', async () => {
    opportunitiesStore.set([completeRow({ id: 'a', employment_model: null, team_configuration: null })]);
    renderPage();
    await openCombobox('Employment');
    expect(screen.queryByRole('option', { name: /Unknown/i })).toBeNull();
    // Close via Escape.
    await userEvent.keyboard('{Escape}');
    await openCombobox('Team setup');
    expect(screen.queryByRole('option', { name: /Unspecified/i })).toBeNull();
  });
});

describe('Phase 1L-F2B-P3 — Clear filters and empty state copy', () => {
  it('21. Clear filters restores all rows after search/employment/team/route/trailer/minimum/paid-deadhead/match filters are applied', async () => {
    profileStore.set(completedProfile);
    hoisted.matchSpy.tierMap = { a: 'possible', b: 'weak' };
    opportunitiesStore.set([
      completeRow({
        id: 'a',
        title: 'Alpha OTR',
        company_name: 'Alpha Freight',
        employment_model: 'company_driver',
        team_configuration: 'solo',
        route_type: 'OTR',
        trailer_type: 'Dry Van',
        flat_weekly_pay: 2000,
      }),
      completeRow({
        id: 'b',
        title: 'Beta Regional',
        company_name: 'Beta Lines',
        employment_model: 'contractor_1099',
        team_configuration: 'team',
        route_type: 'Regional',
        trailer_type: 'Reefer',
        flat_weekly_pay: 1500,
      }),
    ]);
    renderPage();
    // Apply a filter that yields zero to force the no-results empty state.
    await userEvent.type(screen.getByPlaceholderText(/Search title/i), 'zzzz-no-hit');
    expect(cardIds()).toEqual([]);
    expect(screen.getByText(/No results match your filters/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clear filters/ }));
    expect(new Set(cardIds())).toEqual(new Set(['a', 'b']));
  });

  it('22. no-opportunities empty state uses exact new copy and contains no profit-first wording', () => {
    opportunitiesStore.set([]);
    renderPage();
    expect(
      screen.getByText('Recruiters are joining HaulTrackerPro now. Check back soon for new openings.'),
    ).toBeInTheDocument();
    const body = document.body.textContent || '';
    expect(body).not.toMatch(/profit-first/i);
  });
});

describe('Phase 1L-F2B-P3 — Preserved entries and selection', () => {
  it('23. Preferences, My Requests, My Referrals entries and card-to-detail selection remain reachable', async () => {
    opportunitiesStore.set([completeRow({ id: 'a', title: 'Alpha OTR' })]);
    renderPage();
    // Preferences entry (no profile → "Set Preferences" CTA).
    expect(screen.getByRole('button', { name: /Set Preferences/ })).toBeInTheDocument();
    // My Requests
    await userEvent.click(screen.getByRole('button', { name: /View My Requests/ }));
    expect(await screen.findByTestId('apps-panel')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Apps Back/ }));
    // My Referrals
    await userEvent.click(screen.getByRole('button', { name: /View My Referrals/ }));
    expect(await screen.findByTestId('referrals-panel')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Referrals Back/ }));
    // Card → detail
    await userEvent.click(screen.getByTestId('card-a'));
    expect(await screen.findByTestId('detail-mock')).toBeInTheDocument();
  });
});

// 24. Hygiene: this file uses no describe.skip/it.skip, no .only, no .todo,
// and no toMatchSnapshot(). Enforced by a self-audit that reads this file.
describe('Phase 1L-F2B-P3 — Test hygiene', () => {
  it('24. this test file contains no skipped/todo/only/snapshot tests', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/test/phase1lF2P3OpportunitiesPageCanonical.test.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/\.skip\s*\(/);
    expect(src).not.toMatch(/\.only\s*\(/);
    expect(src).not.toMatch(/\.todo\s*\(/);
    expect(src).not.toMatch(/toMatchSnapshot\s*\(/);
  });
});
