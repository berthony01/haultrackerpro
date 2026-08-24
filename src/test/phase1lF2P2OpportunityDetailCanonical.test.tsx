// Phase 1L-F2B-P2-R1 — canonical OpportunityDetail adoption tests.
//
// Strict, deterministic coverage of the driver-facing detail rendering as the
// second production consumer of the Phase 1L-F1 canonical view model. Every
// assertion is scoped to a labeled KV row or a named Card region so we never
// prove text by counting global occurrences of a value like "No" or
// "Not disclosed".
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Tables } from '@/integrations/supabase/types';
import type { OpportunitySourceRow } from '@/lib/opportunities/opportunityCanonicalView';

beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

const driverApplicationsRef: { current: unknown[] } = { current: [] };
vi.mock('@/hooks/opportunities/useOpportunityApplications', () => ({
  useOpportunityApplications: () => ({
    driverApplications: driverApplicationsRef.current,
    submitApplication: { mutateAsync: vi.fn(), isPending: false },
    createApplication: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/hooks/opportunities/useSavedOpportunities', () => ({
  useSavedOpportunities: () => ({
    saved: [] as unknown[],
    save: { mutate: vi.fn() },
    unsave: { mutate: vi.fn() },
  }),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));
vi.mock('@/components/opportunities/ReferDriverDialog', () => ({
  ReferDriverDialog: () => null,
}));
vi.mock('@/components/opportunities/ApplyNowDialog', () => ({
  ApplyNowDialog: () => null,
}));

import { OpportunityDetail } from '@/components/opportunities/OpportunityDetail';

type Row = Tables<'opportunities'>;

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    actual_benefits: null,
    admin_review_status: 'pending',
    benefits: null,
    canonical_version: null,
    company_name: 'Acme Trucking',
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
    id: '00000000-0000-0000-0000-000000000001',
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
    recruiter_id: '00000000-0000-0000-0000-0000000000aa',
    requirements: null,
    riders_allowed: null,
    route_type: null,
    salary_amount: null,
    salary_frequency: null,
    sign_on_bonus: null,
    status: 'active',
    team_configuration: null,
    title: 'Test Opportunity',
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
  return { ...makeRow(rest as Partial<Row>), recruiter: recruiter ?? null };
}

function fullBase(overrides: Partial<OpportunitySourceRow> = {}): OpportunitySourceRow {
  return source({
    canonical_version: 1,
    title: 'OTR Reefer Solo',
    company_name: 'Acme Freight',
    employment_model: 'contractor_1099',
    team_configuration: 'solo',
    route_type: 'OTR',
    trailer_type: 'Reefer',
    hiring_city: 'Dallas',
    hiring_state: 'TX',
    description: 'A full description of the opportunity.',
    home_time: 'Weekly',
    forced_dispatch: false,
    pets_allowed: true,
    riders_allowed: false,
    equipment_year: '2022',
    typical_lanes: 'TX -> OK',
    requirements: 'Class A CDL, 1yr experience.',
    actual_benefits: 'PTO and health.',
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
    detention_pay: '$25/hr after 2 hr',
    layover_pay: '$150/night',
    sign_on_bonus: 5000,
    featured: true,
    admin_review_status: 'approved',
    ...overrides,
  });
}

const incompleteProfile = { id: 'p2', user_id: 'u2', profile_completed: false } as never;

function renderDetail(row: OpportunitySourceRow, isPro = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OpportunityDetail
        opportunity={row as never}
        onBack={vi.fn()}
        isPro={isPro}
        onUpgrade={vi.fn()}
        driverProfile={incompleteProfile}
        onOpenPreferencesForApply={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

// Scope helper: return the KV wrapper div for a given label. The KV renders
// <div class="rounded-lg bg-muted/30 p-3"><p>label</p><p>value</p></div>, so
// `.closest('div')` on the label lands on that wrapper. Throws if the label
// resolves to more than one node so tests never silently rely on ordering.
function kvRow(label: string): HTMLElement {
  const els = screen.getAllByText(label);
  expect(els.length, `expected exactly 1 KV label "${label}", got ${els.length}`).toBe(1);
  const wrapper = els[0].closest('div');
  if (!wrapper) throw new Error(`no wrapper for KV "${label}"`);
  return wrapper as HTMLElement;
}

function financialCard(): HTMLElement {
  const heading = screen.getByText('Financial Disclosure');
  const card = heading.closest('.p-5');
  if (!card) throw new Error('Financial Disclosure card not found');
  return card as HTMLElement;
}

function sectionCard(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  const card = heading.closest('.p-5');
  if (!card) throw new Error(`section card not found for heading "${title}"`);
  return card as HTMLElement;
}

function feKV(label: string): HTMLElement {
  const card = financialCard();
  let el: HTMLElement | null = within(card).getByText(label);
  while (el && !el.classList.contains('bg-muted/30')) el = el.parentElement;
  if (!el) throw new Error(`no financial KV wrapper for "${label}"`);
  return el;
}

beforeEach(() => {
  driverApplicationsRef.current = [];
});

/* =========================================================================
 * Listing Transparency (exact hydration)
 * ========================================================================= */
describe('Phase 1L-F2B-P2-R1 · Listing Transparency', () => {
  it('renders exact "Transparency 100 · Complete" badge, matching title and aria-label, and neutral disclaimer', () => {
    renderDetail(fullBase());
    expect(screen.getByText('Transparency 100 · Complete')).toBeInTheDocument();
    const descriptor =
      'Listing transparency: 100 out of 100, Complete. Measures disclosure completeness and consistency, not profitability.';
    expect(screen.getByTitle(descriptor)).toBeInTheDocument();
    expect(screen.getByLabelText(descriptor)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Listing Transparency measures disclosure completeness and consistency, not profitability.',
      ),
    ).toBeInTheDocument();
  });
});

/* =========================================================================
 * Trust separation (Featured vs. Verified Recruiter)
 * ========================================================================= */
describe('Phase 1L-F2B-P2-R1 · Trust separation', () => {
  it('Featured with no recruiter shows Priority placement and no Verified Recruiter', () => {
    renderDetail(fullBase({ featured: true }));
    expect(screen.getByText('Priority placement')).toBeInTheDocument();
    expect(screen.queryByText('Verified Recruiter')).toBeNull();
  });

  it('Approved active recruiter shows Verified Recruiter without requiring Featured', () => {
    renderDetail(
      fullBase({
        featured: false,
        recruiter: { verification_status: 'approved', status: 'active' },
      }),
    );
    expect(screen.getByText('Verified Recruiter')).toBeInTheDocument();
    expect(screen.queryByText('Priority placement')).toBeNull();
  });

  it('Approved but suspended recruiter does not show Verified Recruiter', () => {
    renderDetail(
      fullBase({
        featured: false,
        recruiter: { verification_status: 'approved', status: 'suspended' },
      }),
    );
    expect(screen.queryByText('Verified Recruiter')).toBeNull();
  });
});

/* =========================================================================
 * Legacy language removal
 * ========================================================================= */
describe('Phase 1L-F2B-P2-R1 · Legacy profit language removed', () => {
  it('removes legacy phrases and tone words while keeping the neutral profitability disclaimer', () => {
    renderDetail(fullBase());
    for (const phrase of ['Approved Opportunity', 'Profit Intelligence', 'Profit Clarity Score']) {
      expect(screen.queryByText(phrase)).toBeNull();
    }
    for (const word of ['Strong', 'Solid', 'Mixed', 'Risky']) {
      expect(screen.queryAllByText(word)).toHaveLength(0);
    }
    expect(
      screen.getByText(
        'Listing Transparency measures disclosure completeness and consistency, not profitability.',
      ),
    ).toBeInTheDocument();
  });
});

/* =========================================================================
 * All seven pay-model states
 * ========================================================================= */
describe('Phase 1L-F2B-P2-R1 · Pay-model states', () => {
  it('CPM contractor_1099 (fullBase) renders CPM value, loaded miles, and derived weekly gross', () => {
    renderDetail(fullBase());
    expect(within(kvRow('Pay model')).getByText('CPM')).toBeInTheDocument();
    expect(within(kvRow('Loaded weekly miles')).getByText('2,300 mi')).toBeInTheDocument();
    expect(within(kvRow('Derived weekly gross')).getByText('$1,380')).toBeInTheDocument();
    // CPM value $0.60/mi is unique to the CPM KV.
    expect(screen.getByText('$0.60/mi')).toBeInTheDocument();
  });

  it('Percentage owner_operator renders rate, revenue basis, basis label, and derived gross', () => {
    renderDetail(
      fullBase({
        employment_model: 'owner_operator',
        pay_model: 'percentage',
        cpm: null,
        percentage_pay: 25,
        percentage_weekly_revenue_basis: 6000,
        percentage_basis_label: 'linehaul revenue',
      }),
    );
    expect(within(kvRow('Pay model')).getByText('Percentage')).toBeInTheDocument();
    expect(within(kvRow('Percentage rate')).getByText('25%')).toBeInTheDocument();
    expect(within(kvRow('Weekly revenue basis')).getByText('$6,000')).toBeInTheDocument();
    expect(within(kvRow('Percentage basis')).getByText('linehaul revenue')).toBeInTheDocument();
    expect(within(kvRow('Derived weekly gross')).getByText('$1,500')).toBeInTheDocument();
  });

  it('Flat weekly company_driver renders flat pay row and derived weekly gross', () => {
    renderDetail(
      fullBase({
        employment_model: 'company_driver',
        pay_model: 'flat_weekly',
        cpm: null,
        flat_weekly_pay: 1600,
        estimated_weekly_miles: null,
        estimated_loaded_miles: null,
        estimated_deadhead_miles: null,
        deadhead_paid: null,
      }),
    );
    expect(within(kvRow('Pay model')).getByText('Flat weekly')).toBeInTheDocument();
    expect(within(kvRow('Flat weekly pay')).getByText('$1,600')).toBeInTheDocument();
    expect(within(kvRow('Derived weekly gross')).getByText('$1,600')).toBeInTheDocument();
  });

  it('Salary company_driver renders amount, frequency, and derived weekly gross', () => {
    renderDetail(
      fullBase({
        employment_model: 'company_driver',
        pay_model: 'salary',
        cpm: null,
        salary_amount: 78000,
        salary_frequency: 'annual',
        estimated_weekly_miles: null,
        estimated_loaded_miles: null,
        estimated_deadhead_miles: null,
        deadhead_paid: null,
      }),
    );
    expect(within(kvRow('Salary amount')).getByText('$78,000')).toBeInTheDocument();
    expect(within(kvRow('Salary frequency')).getByText('annual')).toBeInTheDocument();
    expect(within(kvRow('Derived weekly gross')).getByText('$1,500')).toBeInTheDocument();
  });

  it('Mixed company_driver renders each component label + amount and derived weekly gross', () => {
    renderDetail(
      fullBase({
        employment_model: 'company_driver',
        pay_model: 'mixed',
        cpm: null,
        flat_weekly_pay: null,
        estimated_weekly_miles: null,
        estimated_loaded_miles: null,
        estimated_deadhead_miles: null,
        deadhead_paid: null,
        mixed_pay_components: [
          { label: 'Base', amount: 1000, frequency: 'weekly' },
          { label: 'Bonus', amount: 200, frequency: 'weekly' },
        ] as unknown as Row['mixed_pay_components'],
      }),
    );
    expect(screen.getByText('Base')).toBeInTheDocument();
    expect(screen.getByText('Bonus')).toBeInTheDocument();
    expect(screen.getByText('$1,000 weekly')).toBeInTheDocument();
    expect(screen.getByText('$200 weekly')).toBeInTheDocument();
    expect(within(kvRow('Derived weekly gross')).getByText('$1,200')).toBeInTheDocument();
  });

  it('Other company_driver renders method label, other weekly gross, and derived weekly gross', () => {
    renderDetail(
      fullBase({
        employment_model: 'company_driver',
        pay_model: 'other',
        cpm: null,
        other_pay_method_label: 'per-load',
        other_weekly_gross: 1500,
        estimated_weekly_miles: null,
        estimated_loaded_miles: null,
        estimated_deadhead_miles: null,
        deadhead_paid: null,
      }),
    );
    expect(within(kvRow('Other pay method')).getByText('per-load')).toBeInTheDocument();
    expect(within(kvRow('Other weekly gross')).getByText('$1,500')).toBeInTheDocument();
    expect(within(kvRow('Derived weekly gross')).getByText('$1,500')).toBeInTheDocument();
  });

  it('Unknown pay_model with recruiter-provided gross omits Pay model filler and shows Recruiter weekly gross (omission rules)', () => {
    renderDetail(
      fullBase({
        employment_model: 'company_driver',
        pay_model: null,
        cpm: null,
        estimated_weekly_gross: 1500,
        estimated_weekly_miles: null,
        estimated_loaded_miles: null,
        estimated_deadhead_miles: null,
        deadhead_paid: null,
      }),
    );
    // Pay model row is absent under omission rules (no "Not disclosed" filler).
    expect(screen.queryByText('Pay model')).toBeNull();
    expect(within(kvRow('Recruiter weekly gross')).getByText('$1,500')).toBeInTheDocument();
    for (const label of [
      'Flat weekly pay',
      'Salary amount',
      'Percentage rate',
      'Other pay method',
      'Loaded weekly miles',
      'Mixed pay components',
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });
});

/* =========================================================================
 * One-time incentive isolation
 * ========================================================================= */
describe('Phase 1L-F2B-P2-R1 · One-time incentive isolation', () => {
  const base = (bonus: number | null) =>
    fullBase({
      employment_model: 'company_driver',
      pay_model: 'flat_weekly',
      cpm: null,
      flat_weekly_pay: 1600,
      sign_on_bonus: bonus,
      estimated_weekly_miles: null,
      estimated_loaded_miles: null,
      estimated_deadhead_miles: null,
      deadhead_paid: null,
    });

  it('null sign-on bonus: recurring gross unchanged, sign-on bonus row absent (omission rules)', () => {
    renderDetail(base(null));
    expect(within(kvRow('Derived weekly gross')).getByText('$1,600')).toBeInTheDocument();
    expect(screen.queryByText(/Sign-on bonus/i)).toBeNull();
  });

  it('$10,000 sign-on bonus: recurring gross still $1,600 and Sign-on bonus callout shows $10,000', () => {
    renderDetail(base(10000));
    expect(within(kvRow('Derived weekly gross')).getByText('$1,600')).toBeInTheDocument();
    expect(screen.getByText('Sign-on bonus: $10,000')).toBeInTheDocument();
  });
});

/* =========================================================================
 * Ownership-cost gating (company_driver / unknown employment)
 * ========================================================================= */
describe('Phase 1L-F2B-P2-R1 · Ownership-cost gating', () => {
  it('Pro company_driver: no ownership-cost KVs and exact company-driver note', () => {
    renderDetail(
      fullBase({
        employment_model: 'company_driver',
        pay_model: 'flat_weekly',
        cpm: null,
        flat_weekly_pay: 1600,
        insurance_deductions: 100,
        insurance_deduction_frequency: 'weekly',
        lease_payment: 400,
        lease_payment_frequency: 'weekly',
        escrow_required_state: 'required',
        escrow_amount: 500,
        escrow_amount_frequency: 'weekly',
        estimated_weekly_miles: null,
        estimated_loaded_miles: null,
        estimated_deadhead_miles: null,
        deadhead_paid: null,
      }),
      true,
    );
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

  it('Pro unknown employment: no ownership-cost KVs and exact unknown-employment note', () => {
    renderDetail(fullBase({ employment_model: null }), true);
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
      screen.getByText(
        'Employment arrangement must be disclosed before ownership-cost net can be estimated.',
      ),
    ).toBeInTheDocument();
  });
});

/* =========================================================================
 * Cost-bearing financial estimate (Pro)
 * ========================================================================= */
describe('Phase 1L-F2B-P2-R1 · Cost-bearing financial estimate', () => {
  it('Complete 1099 fullBase renders exact recurring gross, costs, net, rpm, and deadhead percent', () => {
    renderDetail(fullBase(), true);
    expect(within(feKV('Derived weekly gross')).getByText('$1,380')).toBeInTheDocument();
    expect(within(feKV('Known weekly costs')).getByText('$175')).toBeInTheDocument();
    expect(within(feKV('Estimated weekly net')).getByText('$1,205')).toBeInTheDocument();
    expect(within(feKV('Gross per total mile')).getByText('$0.55/mi')).toBeInTheDocument();
    expect(within(feKV('Net per total mile')).getByText('$0.48/mi')).toBeInTheDocument();
    expect(within(feKV('Deadhead %')).getByText('8%')).toBeInTheDocument();
  });

  it('Lease-purchase renders Lease payment KV, updated known weekly costs, and updated net', () => {
    renderDetail(
      fullBase({
        employment_model: 'lease_purchase',
        lease_payment: 400,
        lease_payment_frequency: 'weekly',
      }),
      true,
    );
    expect(within(feKV('Lease payment')).getByText('$400 weekly')).toBeInTheDocument();
    expect(within(feKV('Known weekly costs')).getByText('$575')).toBeInTheDocument();
    expect(within(feKV('Estimated weekly net')).getByText('$805')).toBeInTheDocument();
  });

  it('Incomplete cost-bearing: Financial Disclosure marked Incomplete, Missing disclosures list includes Insurance, no fabricated $0 for unknown metrics', () => {
    renderDetail(
      fullBase({
        insurance_deductions: null,
        insurance_deduction_frequency: null,
      }),
      true,
    );
    const card = financialCard();
    expect(within(card).getByText('Incomplete')).toBeInTheDocument();
    const missing = within(card).getByText('Missing disclosures').parentElement as HTMLElement;
    expect(within(missing).getByText('Insurance')).toBeInTheDocument();
    expect(within(feKV('Known weekly costs')).getByText('—')).toBeInTheDocument();
    expect(within(feKV('Estimated weekly net')).getByText('—')).toBeInTheDocument();
  });

  it('Recruiter/derived conflict: status "Conflict" with exact conflict line', () => {
    renderDetail(
      fullBase({
        employment_model: 'company_driver',
        pay_model: 'flat_weekly',
        cpm: null,
        flat_weekly_pay: 1000,
        estimated_weekly_gross: 1500,
        estimated_weekly_miles: null,
        estimated_loaded_miles: null,
        estimated_deadhead_miles: null,
        deadhead_paid: null,
      }),
      true,
    );
    const card = financialCard();
    expect(within(card).getByText('Conflict')).toBeInTheDocument();
    expect(
      within(card).getByText(
        'Recruiter-provided weekly gross ($1500.00) differs from derived gross ($1000.00) by more than 10%.',
      ),
    ).toBeInTheDocument();
  });
});

/* =========================================================================
 * Zero / false preservation
 * ========================================================================= */
describe('Phase 1L-F2B-P2-R1 · Zero and false preservation', () => {
  it('zero mileage disclosures render "0 mi" in the mileage KVs that remain visible for CPM', () => {
    renderDetail(
      fullBase({
        estimated_weekly_miles: 0,
        estimated_loaded_miles: 0,
        estimated_deadhead_miles: 0,
      }),
    );
    // Under CPM, Loaded miles is exposed inside the Pay section as
    // "Loaded weekly miles"; other mileage KVs live in the coverage section.
    expect(within(kvRow('Weekly miles')).getByText('0 mi')).toBeInTheDocument();
    expect(within(kvRow('Deadhead miles')).getByText('0 mi')).toBeInTheDocument();
    expect(within(kvRow('Loaded weekly miles')).getByText('0 mi')).toBeInTheDocument();
  });

  it('deadhead_paid=false with positive deadhead miles renders "Unpaid" in its own KV', () => {
    renderDetail(fullBase({ deadhead_paid: false }));
    expect(within(kvRow('Deadhead paid?')).getByText('Unpaid')).toBeInTheDocument();
  });

  it('forced_dispatch/pets_allowed/riders_allowed = false render "No" in each labeled KV', () => {
    renderDetail(
      fullBase({ forced_dispatch: false, pets_allowed: false, riders_allowed: false }),
    );
    expect(within(kvRow('Forced dispatch')).getByText('No')).toBeInTheDocument();
    expect(within(kvRow('Pets allowed')).getByText('No')).toBeInTheDocument();
    expect(within(kvRow('Riders allowed')).getByText('No')).toBeInTheDocument();
  });
});

/* =========================================================================
 * Disclosure distinction (not_disclosed vs not_applicable)
 * ========================================================================= */
describe('Phase 1L-F2B-P2-R1 · Disclosure distinction', () => {
  it('flat-weekly company_driver with no mileage or route/trailer/home_time: all filler rows are omitted (Phase 1O-B)', () => {
    renderDetail(
      fullBase({
        employment_model: 'company_driver',
        pay_model: 'flat_weekly',
        cpm: null,
        flat_weekly_pay: 1600,
        route_type: null,
        trailer_type: null,
        home_time: null,
        estimated_weekly_miles: null,
        estimated_loaded_miles: null,
        estimated_deadhead_miles: null,
        deadhead_paid: null,
      }),
    );
    // No "Not disclosed" / "Not applicable" filler anywhere.
    expect(screen.queryByText(/Not disclosed/i)).toBeNull();
    expect(screen.queryByText(/Not applicable/i)).toBeNull();
    // Mileage / route / trailer / home-time rows are absent entirely.
    expect(screen.queryByText('Weekly miles')).toBeNull();
    expect(screen.queryByText('Loaded miles')).toBeNull();
    expect(screen.queryByText('Deadhead miles')).toBeNull();
    expect(screen.queryByText('Home time')).toBeNull();
  });

  it('content sections omit their headings entirely when they have no populated content (Phase 1O-B)', () => {
    renderDetail(
      fullBase({
        actual_benefits: null,
        typical_lanes: null,
        requirements: null,
        description: null,
      }),
    );
    expect(screen.queryByRole('heading', { name: 'Benefits' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Typical Lanes' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Requirements' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'About this Opportunity' })).toBeNull();
    expect(screen.queryByText(/Not disclosed/i)).toBeNull();
  });
});

/* =========================================================================
 * Action bar, Free CTA, and Refer-a-Driver gating
 * ========================================================================= */
describe('Phase 1L-F2B-P2-R1 · Actions and Free CTA', () => {
  it('Free renders unlock CTA, all action buttons, and Refer a Driver gated with Pro suffix', () => {
    renderDetail(fullBase(), false);
    expect(screen.getByText('Unlock detailed financial disclosures')).toBeInTheDocument();
    expect(screen.queryByText('Financial Disclosure')).toBeNull();
    expect(screen.getByRole('button', { name: /Back to Opportunities/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeInTheDocument();
    // Phase OD-1 — Request Info retired from the driver Opportunity Detail page.
    expect(screen.queryByRole('button', { name: /Request Info/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Apply Now$/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Refer a Driver — Pro feature' }),
    ).toBeInTheDocument();
  });

  it('Pro renders Refer a Driver without the Pro suffix and shows Financial Disclosure card', () => {
    renderDetail(fullBase(), true);
    expect(screen.getByRole('button', { name: /^Refer a Driver$/ })).toBeInTheDocument();
    expect(screen.getByText('Financial Disclosure')).toBeInTheDocument();
    expect(screen.queryByText('Unlock detailed financial disclosures')).toBeNull();
  });
});
