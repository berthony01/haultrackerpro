// Phase 1L-F2C — Driver opportunity integration coverage.
//
// Renders the REAL OpportunitiesPage, OpportunityCard, OpportunityDetail,
// and OpportunityProfitBreakdown together with the REAL canonical view
// model and REAL canonical financial calculations. Only external hooks and
// boundary dialogs/panels are mocked so this suite exercises the true
// production surfaces between list, card, and detail.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Tables } from '@/integrations/supabase/types';
import type { OpportunitySourceRow } from '@/lib/opportunities/opportunityCanonicalView';

// Radix pointer-capture + scrollIntoView polyfills for jsdom.
beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

// -------- Mutable stores driving mocked hooks ----------------------------
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
type SavedRow = { id: string; user_id: string; opportunity_id: string; created_at: string };
type AppRow = { opportunity_id: string; application_type: 'apply' | 'request_info'; status: string };

type LoadState = { isLoading: boolean; isError: boolean; error: Error | null };
const defaultLoad: LoadState = { isLoading: false, isError: false, error: null };

const opportunitiesStore = createStore<Row[]>([]);
const savedStore = createStore<SavedRow[]>([]);
const proStore = createStore<boolean>(false);
const profileStore = createStore<any>(null);
const applicationsStore = createStore<AppRow[]>([]);
const loadStateStore = createStore<LoadState>({ ...defaultLoad });

// Spies for save/unsave/createApplication mutations.
const saveSpy = vi.fn();
const unsaveSpy = vi.fn();
const createApplicationSpy = vi.fn();

// -------- Mocks — external hooks and boundary components only ------------
vi.mock('@/hooks/opportunities/useOpportunities', () => ({
  useOpportunities: () => {
    const opportunities = opportunitiesStore.use();
    const ls = loadStateStore.use();
    return {
      opportunities,
      isLoading: ls.isLoading,
      isError: ls.isError,
      error: ls.error,
      refetch: vi.fn(),
    };
  },
}));

vi.mock('@/hooks/opportunities/useSavedOpportunities', () => ({
  useSavedOpportunities: () => {
    const saved = savedStore.use();
    return {
      saved,
      save: { mutate: saveSpy, isPending: false },
      unsave: { mutate: unsaveSpy, isPending: false },
    };
  },
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => {
    const isPro = proStore.use();
    return { isPro, isLoading: false, error: null };
  },
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

vi.mock('@/hooks/opportunities/useOpportunityApplications', () => ({
  useOpportunityApplications: () => {
    const driverApplications = applicationsStore.use();
    return {
      driverApplications,
      submitApplication: { mutateAsync: vi.fn().mockResolvedValue({ result_code: 'created' }), isPending: false },
      createApplication: { mutate: createApplicationSpy, isPending: false },
    };
  },
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

// Boundary dialogs/panels — deterministic test doubles.
vi.mock('@/components/opportunities/ReferDriverDialog', () => ({
  ReferDriverDialog: () => null,
}));

const applyDialogProps: { current: any } = { current: null };
vi.mock('@/components/opportunities/ApplyNowDialog', () => ({
  ApplyNowDialog: (props: any) => {
    applyDialogProps.current = props;
    if (!props.open) return null;
    return (
      <div role="dialog" data-testid="apply-dialog">
        <p data-testid="apply-dialog-id">{props.opportunityId}</p>
        <p data-testid="apply-dialog-title">{props.opportunityTitle}</p>
        <p data-testid="apply-dialog-company">{props.companyName}</p>
        <button onClick={() => props.onOpenPreferences?.()}>Open Preferences</button>
        <button onClick={() => props.onOpenChange?.(false)}>Close Apply</button>
      </div>
    );
  },
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
      <button onClick={onBack}>Apps Back</button>
    </div>
  ),
}));

vi.mock('@/components/opportunities/DriverReferralsPanel', () => ({
  DriverReferralsPanel: ({ onBack }: any) => (
    <div data-testid="referrals-panel">
      <button onClick={onBack}>Referrals Back</button>
    </div>
  ),
}));

import { OpportunitiesPage } from '@/components/opportunities/OpportunitiesPage';

// -------- Row builder ----------------------------------------------------
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

function source(overrides: Partial<OpportunitySourceRow> = {}): OpportunitySourceRow {
  const { recruiter, ...rest } = overrides;
  return { ...makeRow(rest as Partial<Row>), recruiter: recruiter ?? null } as OpportunitySourceRow;
}

/** Fully-complete 1099 CPM canonical opportunity (Phase 1L-F2B P1/P2 fixture). */
function contractorFullBase(overrides: Partial<OpportunitySourceRow> = {}): OpportunitySourceRow {
  return source({
    id: 'opp-full',
    canonical_version: 1,
    title: 'OTR Reefer Solo',
    company_name: 'Acme Freight',
    employment_model: 'contractor_1099',
    team_configuration: 'solo',
    route_type: 'OTR',
    trailer_type: 'Reefer',
    hiring_city: 'Dallas',
    hiring_state: 'TX',
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
    cpm: 0.6,
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
    ...overrides,
  });
}

// -------- Render helpers -------------------------------------------------
function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OpportunitiesPage onUpgrade={vi.fn()} />
    </QueryClientProvider>,
  );
}

/** Locate the card node (has "View Details" button) for a given canonical title. */
function cardFor(title: string): HTMLElement {
  const heading = screen.getAllByRole('heading', { name: title })[0];
  const card = heading.closest('.p-5');
  if (!card) throw new Error(`card not found for title "${title}"`);
  return card as HTMLElement;
}

/** KV wrapper for a card metric label (Est. net, Deadhead, etc.). */
function cardRowFor(card: HTMLElement, label: string): HTMLElement {
  const el = within(card).getByText(label);
  return el.closest('div')!.parentElement as HTMLElement;
}

/** KV wrapper inside real OpportunityDetail (rounded-lg bg-muted/30 p-3). */
function detailKV(label: string): HTMLElement {
  const els = screen.getAllByText(label);
  expect(els.length, `expected exactly 1 KV label "${label}", got ${els.length}`).toBe(1);
  const wrapper = els[0].closest('div');
  if (!wrapper) throw new Error(`no KV wrapper for "${label}"`);
  return wrapper as HTMLElement;
}

/** Real OpportunityDetail's Financial Disclosure card. */
function financialCard(): HTMLElement {
  const heading = screen.getByText('Financial Disclosure');
  const card = heading.closest('.p-5');
  if (!card) throw new Error('Financial Disclosure card not found');
  return card as HTMLElement;
}

function detailHeaderCard(title: string): HTMLElement {
  const h = screen.getByRole('heading', { level: 1, name: title });
  const card = h.closest('.p-6');
  if (!card) throw new Error('detail header card not found');
  return card as HTMLElement;
}

async function openDetailByTitle(title: string) {
  const card = cardFor(title);
  await userEvent.click(within(card).getByRole('button', { name: 'View Details' }));
  // Detail header is an <h1>.
  await screen.findByRole('heading', { level: 1, name: title });
}

// -------- Lifecycle ------------------------------------------------------
beforeEach(() => {
  saveSpy.mockClear();
  unsaveSpy.mockClear();
  createApplicationSpy.mockClear();
  applyDialogProps.current = null;
  try {
    sessionStorage.clear();
  } catch {}
  opportunitiesStore.set([]);
  savedStore.set([]);
  proStore.set(false);
  profileStore.set(null);
  applicationsStore.set([]);
  loadStateStore.set({ ...defaultLoad });
});

afterEach(() => {
  try {
    sessionStorage.clear();
  } catch {}
  opportunitiesStore.set([]);
  savedStore.set([]);
  proStore.set(false);
  profileStore.set(null);
  applicationsStore.set([]);
  loadStateStore.set({ ...defaultLoad });
});

// =========================================================================
// 1. REAL LIST CARD CANONICAL RENDERING
// =========================================================================
describe('Phase 1L-F2C · Real list card canonical rendering', () => {
  it('1. renders canonical identity, classification, transparency 100 · Complete, and canonical financial metrics for a contractor_1099 CPM row; no legacy profit copy', () => {
    proStore.set(true);
    opportunitiesStore.set([contractorFullBase() as unknown as Row]);
    renderPage();

    const card = cardFor('OTR Reefer Solo');
    expect(within(card).getByText('Acme Freight')).toBeInTheDocument();
    expect(within(card).getByText('1099 Contractor')).toBeInTheDocument();
    expect(within(card).getByText('Solo')).toBeInTheDocument();
    expect(within(card).getByText('OTR')).toBeInTheDocument();
    expect(within(card).getByText('Reefer')).toBeInTheDocument();
    expect(within(card).getByText('Weekly')).toBeInTheDocument();
    expect(within(card).getByText('Transparency 100 · Complete')).toBeInTheDocument();
    expect(within(cardRowFor(card, 'Derived weekly gross')).getByText('$1,380')).toBeInTheDocument();
    expect(within(cardRowFor(card, 'Est. net')).getByText('$1,205')).toBeInTheDocument();
    expect(within(cardRowFor(card, 'Gross per total mile')).getByText('$0.55')).toBeInTheDocument();

    const body = document.body.textContent || '';
    expect(body).not.toMatch(/Profit-first/i);
    expect(body).not.toMatch(/Profit Clarity/i);
    expect(body).not.toMatch(/Profit Score/i);
    expect(body).not.toMatch(/Highest Estimated Net/i);
    expect(body).not.toMatch(/Best Effective RPM/i);
  });
});

// =========================================================================
// 2. REAL CARD → REAL DETAIL FINANCIAL CONSISTENCY
// =========================================================================
describe('Phase 1L-F2C · Card → detail financial consistency', () => {
  it('2. click View Details preserves canonical identity/transparency and renders exact Financial Disclosure metrics for Pro', async () => {
    proStore.set(true);
    opportunitiesStore.set([contractorFullBase() as unknown as Row]);
    renderPage();

    await openDetailByTitle('OTR Reefer Solo');

    const header = detailHeaderCard('OTR Reefer Solo');
    expect(within(header).getByText('Acme Freight')).toBeInTheDocument();
    expect(within(header).getByText('1099 Contractor')).toBeInTheDocument();
    expect(within(header).getByText('Solo')).toBeInTheDocument();
    expect(within(header).getByText('OTR')).toBeInTheDocument();
    expect(within(header).getByText('Reefer')).toBeInTheDocument();
    expect(within(header).getByText('Weekly')).toBeInTheDocument();
    expect(within(header).getByText(/Dallas, TX/)).toBeInTheDocument();

    expect(screen.getByText('Transparency 100 · Complete')).toBeInTheDocument();
    expect(
      screen.getByTitle(
        'Listing transparency: 100 out of 100, Complete. Measures disclosure completeness and consistency, not profitability.',
      ),
    ).toBeInTheDocument();

    const fc = financialCard();
    expect(within(fc).getByText('$1,380')).toBeInTheDocument();
    expect(within(fc).getByText('$175')).toBeInTheDocument();
    expect(within(fc).getByText('$1,205')).toBeInTheDocument();
    expect(within(fc).getByText('$0.55/mi')).toBeInTheDocument();
    expect(within(fc).getByText('$0.48/mi')).toBeInTheDocument();
    expect(within(fc).getByText('8%')).toBeInTheDocument();

    const body = document.body.textContent || '';
    expect(body).not.toMatch(/Profit Clarity/i);
    expect(body).not.toMatch(/Profit Score/i);
  });
});

// =========================================================================
// 3. DETAIL BACK NAVIGATION
// =========================================================================
describe('Phase 1L-F2C · Detail Back navigation', () => {
  it('3. Back to Opportunities returns the card list for the same opportunity', async () => {
    opportunitiesStore.set([contractorFullBase() as unknown as Row]);
    renderPage();
    await openDetailByTitle('OTR Reefer Solo');
    await userEvent.click(screen.getByRole('button', { name: /Back to Opportunities/ }));
    // Back on the list — the card's View Details button reappears.
    const card = cardFor('OTR Reefer Solo');
    expect(within(card).getByRole('button', { name: 'View Details' })).toBeInTheDocument();
  });
});

// =========================================================================
// 4. LIST STATE SURVIVES DETAIL ROUND TRIP
// =========================================================================
describe('Phase 1L-F2C · List state survives detail round trip', () => {
  it('4. search filter is preserved through open-detail + Back; still one filtered card', async () => {
    opportunitiesStore.set([
      contractorFullBase({ id: 'opp-alpha', title: 'Alpha OTR', company_name: 'Alpha Freight' }) as unknown as Row,
      contractorFullBase({ id: 'opp-beta', title: 'Beta Regional', company_name: 'Beta Lines' }) as unknown as Row,
    ]);
    renderPage();

    const searchInput = screen.getByPlaceholderText(/Search title/i) as HTMLInputElement;
    await userEvent.type(searchInput, 'Beta');
    // Only one card visible.
    expect(cardFor('Beta Regional')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Alpha OTR' })).toBeNull();

    await openDetailByTitle('Beta Regional');
    await userEvent.click(screen.getByRole('button', { name: /Back to Opportunities/ }));

    const preservedInput = screen.getByPlaceholderText(/Search title/i) as HTMLInputElement;
    expect(preservedInput.value).toBe('Beta');
    expect(cardFor('Beta Regional')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Alpha OTR' })).toBeNull();
  });
});

// =========================================================================
// 5. COMPANY-DRIVER SAFETY ACROSS BOTH SURFACES
// =========================================================================
describe('Phase 1L-F2C · Company driver ownership-cost gating', () => {
  it('5. company_driver flat_weekly with raw deduction values suppresses net/ownership metrics on card and detail; exact company-driver note on detail', async () => {
    proStore.set(true);
    const cd = source({
      id: 'opp-cd',
      canonical_version: 1,
      title: 'Company Driver Job',
      company_name: 'Big Co',
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
      insurance_deductions: 200,
      insurance_deduction_frequency: 'weekly',
      maintenance_deductions: 100,
      maintenance_deduction_frequency: 'weekly',
      lease_payment: 400,
      lease_payment_frequency: 'weekly',
      escrow_required_state: 'required',
      escrow_amount: 500,
      escrow_amount_frequency: 'weekly',
      other_deductions: 50,
      other_deduction_frequency: 'weekly',
    });
    opportunitiesStore.set([cd as unknown as Row]);
    renderPage();

    const card = cardFor('Company Driver Job');
    expect(within(card).queryByText('Est. net')).toBeNull();
    expect(within(card).queryByText('Gross per total mile')).toBeNull();
    expect(within(card).getByText('$1,600')).toBeInTheDocument(); // Derived weekly gross recurring

    await openDetailByTitle('Company Driver Job');
    for (const label of [
      'Known weekly costs',
      'Estimated weekly net',
      'Net per total mile',
      'Lease payment',
      'Escrow amount',
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(
      screen.getByText('Company driver: employer-borne operating costs are excluded.'),
    ).toBeInTheDocument();
  });
});

// =========================================================================
// 6. UNKNOWN-EMPLOYMENT SAFETY ACROSS BOTH SURFACES
// =========================================================================
describe('Phase 1L-F2C · Unknown employment gating', () => {
  it('6. unknown employment omits any "Employment not disclosed" filler on card and detail, suppresses ownership net/cost metrics, and still surfaces the exact financial-disclosure safety note produced by OpportunityProfitBreakdown', async () => {
    proStore.set(true);
    opportunitiesStore.set([
      contractorFullBase({
        id: 'opp-unk',
        title: 'Unknown Job',
        employment_model: null,
        driver_type: null,
      }) as unknown as Row,
    ]);
    renderPage();

    const card = cardFor('Unknown Job');
    // Phase 1O-B omission rules: never render filler like
    // "Employment not disclosed", "Not disclosed", or "Not applicable".
    expect(within(card).queryByText('Employment not disclosed')).toBeNull();
    expect(within(card).queryByText(/Not disclosed/i)).toBeNull();
    expect(within(card).queryByText(/Not applicable/i)).toBeNull();
    // Ownership-cost metrics must still be suppressed.
    expect(within(card).queryByText('Est. net')).toBeNull();
    expect(within(card).queryByText('Gross per total mile')).toBeNull();

    await openDetailByTitle('Unknown Job');
    const header = detailHeaderCard('Unknown Job');
    expect(within(header).queryByText('Employment not disclosed')).toBeNull();
    for (const label of ['Known weekly costs', 'Estimated weekly net', 'Net per total mile']) {
      expect(screen.queryByText(label)).toBeNull();
    }
    // The financial-disclosure safety note is still produced by
    // OpportunityProfitBreakdown for unknown-employment listings.
    expect(
      screen.getByText(
        'Employment arrangement must be disclosed before ownership-cost net can be estimated.',
      ),
    ).toBeInTheDocument();
  });
});

// =========================================================================
// 7. DISCLOSURE-STATE CONSISTENCY
// =========================================================================
describe('Phase 1L-F2C · Disclosure-state consistency', () => {
  it('7. flat_weekly company_driver with no route/trailer/home_time/mileage: card and detail keep Company Driver + Solo, omit route/trailer/home/mileage rows entirely, and never render Not disclosed / Not applicable filler', async () => {
    const row = source({
      id: 'opp-disc',
      canonical_version: 1,
      title: 'Sparse Details',
      company_name: 'Sparse Co',
      employment_model: 'company_driver',
      team_configuration: 'solo',
      pay_model: 'flat_weekly',
      flat_weekly_pay: 1400,
      route_type: null,
      trailer_type: null,
      home_time: null,
      estimated_weekly_miles: null,
      estimated_loaded_miles: null,
      estimated_deadhead_miles: null,
      deadhead_paid: null,
      description: 'desc',
      forced_dispatch: false,
      pets_allowed: true,
      riders_allowed: false,
      equipment_year: '2022',
      typical_lanes: 'TX->OK',
      requirements: 'CDL A',
      actual_benefits: 'PTO',
      hiring_city: 'Dallas',
      hiring_state: 'TX',
    });
    opportunitiesStore.set([row as unknown as Row]);
    renderPage();

    const card = cardFor('Sparse Details');
    // Preserved facts.
    expect(within(card).getByText('Company Driver')).toBeInTheDocument();
    expect(within(card).getByText('Solo')).toBeInTheDocument();
    // Route / Trailer / Home time facts are omitted entirely — no filler
    // "Not disclosed" chip / stat renders in their place.
    expect(within(card).queryByText('Route')).toBeNull();
    expect(within(card).queryByText('Trailer')).toBeNull();
    expect(within(card).queryByText('Home time')).toBeNull();
    // Weekly miles / Deadhead stat rows are omitted (no filler).
    expect(within(card).queryByText('Weekly miles')).toBeNull();
    expect(within(card).queryByText('Deadhead')).toBeNull();
    // Prohibited filler must not appear anywhere on the card.
    expect(within(card).queryByText(/Not disclosed/i)).toBeNull();
    expect(within(card).queryByText(/Not applicable/i)).toBeNull();

    await openDetailByTitle('Sparse Details');
    const header = detailHeaderCard('Sparse Details');
    expect(within(header).getByText('Company Driver')).toBeInTheDocument();
    expect(within(header).getByText('Solo')).toBeInTheDocument();
    // Sections whose only content is disclosure-absent must not surface
    // filler; Home time KV is omitted rather than showing "Not disclosed".
    expect(screen.queryByText(/Not disclosed/i)).toBeNull();
    expect(screen.queryByText(/Not applicable/i)).toBeNull();
    // No mileage KVs for a listing with no disclosed miles.
    expect(screen.queryByText('Weekly miles')).toBeNull();
    expect(screen.queryByText('Loaded miles')).toBeNull();
    expect(screen.queryByText('Loaded weekly miles')).toBeNull();
    expect(screen.queryByText('Deadhead miles')).toBeNull();
  });
});

// =========================================================================
// 8. ZERO AND FALSE PRESERVATION
// =========================================================================
describe('Phase 1L-F2C · Zero and false preservation', () => {
  it('8. CPM row with explicit zero miles, deadhead_paid=false, and false lifestyle booleans preserves "0 mi", "Unpaid", and "No" on card and detail (uses Phase 1O-B "Loaded weekly miles" label where the CPM loaded value now appears)', async () => {
    const row = contractorFullBase({
      id: 'opp-zero',
      title: 'Zero Row',
      estimated_weekly_miles: 0,
      estimated_loaded_miles: 0,
      estimated_deadhead_miles: 0,
      deadhead_paid: false,
      forced_dispatch: false,
      pets_allowed: false,
      riders_allowed: false,
    });
    opportunitiesStore.set([row as unknown as Row]);
    renderPage();

    const card = cardFor('Zero Row');
    // Card: weekly miles "0 mi", deadhead "0 mi · unpaid".
    expect(within(cardRowFor(card, 'Weekly miles')).getByText('0 mi')).toBeInTheDocument();
    expect(within(cardRowFor(card, 'Deadhead')).getByText('0 mi · unpaid')).toBeInTheDocument();
    // No fallback dash / Not disclosed in those rows.
    expect(within(cardRowFor(card, 'Weekly miles')).queryByText('—')).toBeNull();
    expect(within(cardRowFor(card, 'Weekly miles')).queryByText('Not disclosed')).toBeNull();

    await openDetailByTitle('Zero Row');
    // CPM listings now surface loaded miles under the pay section using
    // the Phase 1O-B label "Loaded weekly miles".
    expect(within(detailKV('Loaded weekly miles')).getByText('0 mi')).toBeInTheDocument();
    expect(within(detailKV('Weekly miles')).getByText('0 mi')).toBeInTheDocument();
    expect(within(detailKV('Deadhead miles')).getByText('0 mi')).toBeInTheDocument();
    expect(within(detailKV('Deadhead paid?')).getByText('Unpaid')).toBeInTheDocument();
    expect(within(detailKV('Forced dispatch')).getByText('No')).toBeInTheDocument();
    expect(within(detailKV('Pets allowed')).getByText('No')).toBeInTheDocument();
    expect(within(detailKV('Riders allowed')).getByText('No')).toBeInTheDocument();
  });
});

// =========================================================================
// 9. ONE-TIME INCENTIVE ISOLATION
// =========================================================================
describe('Phase 1L-F2C · One-time incentive isolation', () => {
  it('9. company_driver flat_weekly $1,600 recurring with $10,000 sign-on: card and detail show recurring $1,600; card still never shows $10,000; detail exposes $10,000 only inside the separate "Sign-on bonus: $10,000" callout, not a legacy KV row', async () => {
    const row = source({
      id: 'opp-bonus',
      canonical_version: 1,
      title: 'Bonus Row',
      company_name: 'Bonus Co',
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
      sign_on_bonus: 10000,
    });
    opportunitiesStore.set([row as unknown as Row]);
    renderPage();

    const card = cardFor('Bonus Row');
    expect(within(cardRowFor(card, 'Derived weekly gross')).getByText('$1,600')).toBeInTheDocument();
    // Card must not surface $10,000 anywhere.
    expect(within(card).queryByText('$10,000')).toBeNull();

    await openDetailByTitle('Bonus Row');
    expect(within(detailKV('Derived weekly gross')).getByText('$1,600')).toBeInTheDocument();
    // Phase 1O-B: sign-on bonus is now a separate callout, not a KV row.
    // The row-form KV lookup must find nothing.
    expect(() => detailKV('Sign-on bonus')).toThrow();
    expect(screen.getByText('Sign-on bonus: $10,000')).toBeInTheDocument();
  });
});

// =========================================================================
// 10. TRUST SEPARATION — FEATURED ONLY
// =========================================================================
describe('Phase 1L-F2C · Trust separation — featured only', () => {
  it('10. Featured with no approved active recruiter renders Priority placement on card and detail; never Verified Recruiter', async () => {
    opportunitiesStore.set([
      contractorFullBase({
        id: 'opp-feat',
        title: 'Featured Only',
        featured: true,
        recruiter: null,
      }) as unknown as Row,
    ]);
    renderPage();

    const card = cardFor('Featured Only');
    expect(within(card).getByText('Priority placement')).toBeInTheDocument();
    expect(within(card).queryByText('Verified Recruiter')).toBeNull();

    await openDetailByTitle('Featured Only');
    expect(screen.getByText('Priority placement')).toBeInTheDocument();
    expect(screen.queryByText('Verified Recruiter')).toBeNull();
  });
});

// =========================================================================
// 11. TRUST SEPARATION — VERIFIED ACTIVE / SUSPENDED
// =========================================================================
describe('Phase 1L-F2C · Trust separation — verified active vs suspended', () => {
  it('11a. Approved active recruiter renders Verified Recruiter on card and detail without requiring Priority placement', async () => {
    opportunitiesStore.set([
      contractorFullBase({
        id: 'opp-ver',
        title: 'Verified Active',
        featured: false,
        recruiter: { verification_status: 'approved', status: 'active' },
      }) as unknown as Row,
    ]);
    renderPage();
    const card = cardFor('Verified Active');
    expect(within(card).getByText('Verified Recruiter')).toBeInTheDocument();
    expect(within(card).queryByText('Priority placement')).toBeNull();

    await openDetailByTitle('Verified Active');
    expect(screen.getByText('Verified Recruiter')).toBeInTheDocument();
    expect(screen.queryByText('Priority placement')).toBeNull();
  });

  it('11b. Approved but suspended recruiter renders no Verified Recruiter on card or detail', async () => {
    opportunitiesStore.set([
      contractorFullBase({
        id: 'opp-sus',
        title: 'Suspended Row',
        featured: false,
        recruiter: { verification_status: 'approved', status: 'suspended' },
      }) as unknown as Row,
    ]);
    renderPage();
    const card = cardFor('Suspended Row');
    expect(within(card).queryByText('Verified Recruiter')).toBeNull();

    await openDetailByTitle('Suspended Row');
    expect(screen.queryByText('Verified Recruiter')).toBeNull();
  });
});

// =========================================================================
// 12. SAVE WIRING
// =========================================================================
describe('Phase 1L-F2C · Save wiring', () => {
  it('12. Save on card invokes save.mutate with exact opportunity id; then Unsave invokes unsave.mutate with same id', async () => {
    const row = contractorFullBase({ id: 'opp-save', title: 'Save Row' });
    opportunitiesStore.set([row as unknown as Row]);
    const firstRender = renderPage();

    const card = cardFor('Save Row');
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0]).toBe('opp-save');
    expect(unsaveSpy).not.toHaveBeenCalled();

    // Unmount before mutating the saved store, then seed and rerender so
    // the newly mounted tree observes the saved row deterministically.
    firstRender.unmount();
    savedStore.set([
      { id: 's1', user_id: 'u1', opportunity_id: 'opp-save', created_at: '2026-07-01T00:00:00Z' },
    ]);
    renderPage();
    const card2 = cardFor('Save Row');
    const unsaveBtn = within(card2).getByRole('button', { name: 'Unsave' });
    fireEvent.click(unsaveBtn);
    expect(unsaveSpy).toHaveBeenCalledTimes(1);
    expect(unsaveSpy.mock.calls[0][0]).toBe('opp-save');
  });
});

// =========================================================================
// 13. APPLY-TO-PREFERENCES INTEGRATION SMOKE
// =========================================================================
describe('Phase 1L-F2C · Apply-to-preferences integration smoke', () => {
  it('13. With incomplete profile, Apply Now on detail opens ApplyNowDialog for exact id/title/company; Open Preferences switches to DriverOpportunityProfile', async () => {
    profileStore.set({ profile_completed: false, email: 'x@example.com', phone: '5551234567' });
    opportunitiesStore.set([
      contractorFullBase({ id: 'opp-apply', title: 'Apply Row', company_name: 'Apply Co' }) as unknown as Row,
    ]);
    renderPage();

    await openDetailByTitle('Apply Row');
    await userEvent.click(screen.getByRole('button', { name: /^Complete Preferences to Apply$/ }));
    const dialog = await screen.findByTestId('apply-dialog');
    expect(within(dialog).getByTestId('apply-dialog-id')).toHaveTextContent('opp-apply');
    expect(within(dialog).getByTestId('apply-dialog-title')).toHaveTextContent('Apply Row');
    expect(within(dialog).getByTestId('apply-dialog-company')).toHaveTextContent('Apply Co');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Open Preferences' }));
    expect(await screen.findByTestId('prefs-mock')).toBeInTheDocument();
  });
});

// =========================================================================
// 14. FREE / PRO FINANCIAL GATING
// =========================================================================
describe('Phase 1L-F2C · Free vs Pro financial gating', () => {
  it('14a. isPro=false: detail shows exact unlock CTA and no Financial Disclosure card', async () => {
    proStore.set(false);
    opportunitiesStore.set([contractorFullBase({ id: 'opp-free', title: 'Free Row' }) as unknown as Row]);
    renderPage();
    await openDetailByTitle('Free Row');
    expect(screen.getByText('Unlock detailed financial disclosures')).toBeInTheDocument();
    expect(screen.queryByText('Financial Disclosure')).toBeNull();
  });

  it('14b. isPro=true: detail shows Financial Disclosure and no unlock CTA', async () => {
    proStore.set(true);
    opportunitiesStore.set([contractorFullBase({ id: 'opp-pro', title: 'Pro Row' }) as unknown as Row]);
    renderPage();
    await openDetailByTitle('Pro Row');
    expect(screen.getByText('Financial Disclosure')).toBeInTheDocument();
    expect(screen.queryByText('Unlock detailed financial disclosures')).toBeNull();
  });
});
