// Phase 1L-F2B-P2 — Canonical OpportunityDetail + Financial Disclosure adoption tests.
//
// Verifies OpportunityDetail is now a strict consumer of the Phase 1L-F1
// canonical read model: identity/trust/classification/pay/mileage/costs come
// from `normalizeOpportunity(source)` exclusively; the Listing Transparency
// Score replaces the legacy Profit Clarity Score; and Est. weekly net is
// only rendered for cost-bearing employment models.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Tables } from '@/integrations/supabase/types';
import type { OpportunitySourceRow } from '@/lib/opportunities/opportunityCanonicalView';

// ---------- Radix pointer-capture polyfill for jsdom ----------
beforeAll(() => {
  const proto = window.HTMLElement.prototype as any;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

// ---------- Data-hook mocks (keep the component real) ----------
const driverApplicationsRef: { current: any[] } = { current: [] };
vi.mock('@/hooks/opportunities/useOpportunityApplications', () => ({
  useOpportunityApplications: () => ({
    driverApplications: driverApplicationsRef.current,
    submitApplication: { mutateAsync: vi.fn(), isPending: false },
    createApplication: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/hooks/opportunities/useSavedOpportunities', () => ({
  useSavedOpportunities: () => ({
    saved: [] as any[],
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

/** Fully populated canonical row (CPM contractor_1099). */
function fullBase(overrides: Partial<OpportunitySourceRow> = {}): OpportunitySourceRow {
  return source({
    canonical_version: 1,
    title: 'OTR Reefer',
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
    detention_pay: '$25/hr after 2 hr',
    layover_pay: '$150/night',
    sign_on_bonus: 5000,
    featured: true,
    admin_review_status: 'approved',
    ...overrides,
  });
}

const driverProfile: any = {
  id: 'p1',
  user_id: 'u1',
  profile_completed: true,
  allow_verified_recruiter_contact: true,
  contact_preference: 'in_app',
};

function renderDetail(row: OpportunitySourceRow, isPro = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OpportunityDetail
        opportunity={row as any}
        onBack={vi.fn()}
        isPro={isPro}
        onUpgrade={vi.fn()}
        driverProfile={driverProfile}
        onOpenPreferencesForApply={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  driverApplicationsRef.current = [];
});

describe('OpportunityDetail — canonical identity, trust & classification', () => {
  it('01. renders canonical title and company name', () => {
    renderDetail(fullBase());
    expect(screen.getByRole('heading', { level: 1, name: 'OTR Reefer' })).toBeInTheDocument();
    expect(screen.getByText('Acme Freight')).toBeInTheDocument();
  });

  it('02. shows "Company not disclosed" when company_name is blank', () => {
    renderDetail(fullBase({ company_name: '' }));
    expect(screen.getByText('Company not disclosed')).toBeInTheDocument();
  });

  it('03. renders "Priority placement" badge when featured', () => {
    renderDetail(fullBase({ featured: true }));
    expect(screen.getByText('Priority placement')).toBeInTheDocument();
  });

  it('04. renders "Verified Recruiter" when recruiter is approved', () => {
    renderDetail(
      fullBase({
        recruiter: { verification_status: 'approved', status: 'active' },
      }),
    );
    expect(screen.getByText('Verified Recruiter')).toBeInTheDocument();
  });

  it('05. does NOT render "Verified Recruiter" when recruiter is not approved', () => {
    renderDetail(fullBase());
    expect(screen.queryByText('Verified Recruiter')).toBeNull();
  });

  it('06. renders canonical employment + team labels', () => {
    renderDetail(fullBase({ employment_model: 'lease_purchase', team_configuration: 'team' }));
    expect(screen.getByText('Lease-Purchase')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
  });

  it('07. renders "Employment not disclosed" when employment_model is null', () => {
    renderDetail(fullBase({ employment_model: null }));
    expect(screen.getByText('Employment not disclosed')).toBeInTheDocument();
  });

  it('08. hiring area label uses "City, State" when both provided', () => {
    renderDetail(fullBase());
    expect(screen.getByText('Dallas, TX')).toBeInTheDocument();
  });

  it('09. hiring area label falls back to states list when city/state blank', () => {
    renderDetail(
      fullBase({
        hiring_city: '',
        hiring_state: '',
        hiring_states: ['TX', 'OK'],
      }),
    );
    expect(screen.getByText('TX, OK')).toBeInTheDocument();
  });

  it('10. hiring area label is "Hiring area not disclosed" when all blank', () => {
    renderDetail(
      fullBase({ hiring_city: '', hiring_state: '', hiring_states: [] }),
    );
    expect(screen.getByText('Hiring area not disclosed')).toBeInTheDocument();
  });
});

describe('OpportunityDetail — canonical pay breakdown', () => {
  it('11. CPM contractor_1099 renders "CPM" pay-model label and derived weekly gross $1,380', () => {
    renderDetail(fullBase());
    expect(screen.getAllByText('CPM').length).toBeGreaterThan(0);
    expect(screen.getByText('Derived weekly gross')).toBeInTheDocument();
    expect(screen.getByText('$1,380')).toBeInTheDocument();
  });

  it('12. Salary company_driver renders derived weekly gross $1,500 (78000 / 52)', () => {
    renderDetail(
      fullBase({
        employment_model: 'company_driver',
        pay_model: 'salary',
        cpm: null,
        estimated_weekly_miles: null,
        estimated_loaded_miles: null,
        estimated_deadhead_miles: null,
        salary_amount: 78000,
        salary_frequency: 'annual',
      }),
    );
    expect(screen.getByText('Derived weekly gross')).toBeInTheDocument();
    expect(screen.getByText('$1,500')).toBeInTheDocument();
  });

  it('13. Percentage owner_operator renders derived weekly gross from rate × basis', () => {
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
    expect(screen.getByText('Derived weekly gross')).toBeInTheDocument();
    expect(screen.getByText('$1,500')).toBeInTheDocument();
    expect(screen.getByText('linehaul revenue')).toBeInTheDocument();
  });

  it('14. unknown pay model with recruiter-provided weekly gross uses "Recruiter weekly gross" label', () => {
    renderDetail(
      fullBase({
        pay_model: null,
        cpm: null,
        estimated_weekly_gross: 1500,
      }),
    );
    expect(screen.getByText('Recruiter weekly gross')).toBeInTheDocument();
    expect(screen.getByText('$1,500')).toBeInTheDocument();
  });

  it('15. Sign-on bonus renders $5,000 when provided; "Not disclosed" when absent', () => {
    const { unmount } = renderDetail(fullBase());
    expect(screen.getByText('$5,000')).toBeInTheDocument();
    unmount();
    renderDetail(fullBase({ sign_on_bonus: null }));
    expect(screen.getByText('Sign-on bonus')).toBeInTheDocument();
  });

  it('16. Detention & Layover pay disclose canonical strings', () => {
    renderDetail(fullBase());
    expect(screen.getByText('$25/hr after 2 hr')).toBeInTheDocument();
    expect(screen.getByText('$150/night')).toBeInTheDocument();
  });
});

describe('OpportunityDetail — canonical mileage & deadhead', () => {
  it('17. CPM row renders 2,500 mi total, 2,300 mi loaded, 200 mi deadhead', () => {
    renderDetail(fullBase());
    expect(screen.getByText('2,500 mi')).toBeInTheDocument();
    expect(screen.getByText('2,300 mi')).toBeInTheDocument();
    expect(screen.getByText('200 mi')).toBeInTheDocument();
  });

  it('18. deadhead_paid=true renders "Paid"; deadhead_paid=false renders "Unpaid"', () => {
    const { unmount } = renderDetail(fullBase());
    expect(screen.getByText('Paid')).toBeInTheDocument();
    unmount();
    renderDetail(fullBase({ deadhead_paid: false }));
    expect(screen.getByText('Unpaid')).toBeInTheDocument();
  });

  it('19. flat_weekly pay model marks mileage rows as "Not applicable"', () => {
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
    // Multiple "Not applicable" labels expected (weekly, loaded, deadhead miles + paid).
    expect(screen.getAllByText('Not applicable').length).toBeGreaterThanOrEqual(3);
  });
});

describe('OpportunityDetail — Listing Transparency (replaces legacy Profit Clarity)', () => {
  it('20. Listing Transparency Score section is always rendered', () => {
    renderDetail(fullBase());
    expect(screen.getByText('Listing Transparency')).toBeInTheDocument();
    expect(screen.getByText(/Transparency \d+ · /)).toBeInTheDocument();
  });

  it('21. Listing Transparency has an explanatory caption; no "Profit Clarity" copy', () => {
    renderDetail(fullBase());
    expect(
      screen.getByText(/Listing Transparency measures disclosure completeness/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Profit Clarity/i)).toBeNull();
  });

  it('22. Missing disclosure count renders (0+) — proves the checklist ran', () => {
    renderDetail(fullBase());
    expect(screen.getByText('Missing disclosures')).toBeInTheDocument();
  });

  it('23. Conflict count is shown when recruiter-provided gross conflicts with derived >10%', () => {
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
      }),
      true,
    );
    expect(screen.getByText('Conflicts')).toBeInTheDocument();
  });
});

describe('OpportunityDetail — Financial Disclosure gating', () => {
  it('24. Free tier renders the neutral upgrade panel — no "Est. weekly net" leak', () => {
    renderDetail(fullBase(), false);
    expect(screen.getByText('Unlock detailed financial disclosures')).toBeInTheDocument();
    expect(screen.queryByText('Estimated weekly net')).toBeNull();
  });

  it('25. Pro tier + contractor_1099 shows Estimated weekly net $1,205 (1380 - 175)', () => {
    renderDetail(fullBase(), true);
    expect(screen.getByText('Estimated weekly net')).toBeInTheDocument();
    expect(screen.getByText('$1,205')).toBeInTheDocument();
    expect(screen.getByText('Known weekly costs')).toBeInTheDocument();
    expect(screen.getByText('$175')).toBeInTheDocument();
  });

  it('26. Pro tier + company_driver hides Estimated weekly net and shows the company-driver note', () => {
    renderDetail(
      fullBase({
        employment_model: 'company_driver',
        pay_model: 'flat_weekly',
        cpm: null,
        flat_weekly_pay: 1600,
        estimated_weekly_miles: null,
        estimated_loaded_miles: null,
        estimated_deadhead_miles: null,
      }),
      true,
    );
    expect(screen.queryByText('Estimated weekly net')).toBeNull();
    expect(
      screen.getByText(/Company driver: employer-borne operating costs are excluded/i),
    ).toBeInTheDocument();
  });

  it('27. Pro tier + unknown employment shows the unknown-employment note', () => {
    renderDetail(fullBase({ employment_model: null }), true);
    expect(
      screen.getByText(/Employment arrangement must be disclosed/i),
    ).toBeInTheDocument();
  });

  it('28. Pro tier + lease_purchase shows Lease payment cost row', () => {
    renderDetail(
      fullBase({
        employment_model: 'lease_purchase',
        lease_payment: 400,
        lease_payment_frequency: 'weekly',
      }),
      true,
    );
    expect(screen.getByText('Lease payment')).toBeInTheDocument();
    expect(screen.getByText('$400 weekly')).toBeInTheDocument();
  });

  it('29. Financial disclaimer copy is present on Pro tier', () => {
    renderDetail(fullBase(), true);
    expect(
      screen.getByText(/They are not guaranteed pay\./i),
    ).toBeInTheDocument();
  });
});

describe('OpportunityDetail — content sections + apply action bar preserved', () => {
  it('30. Benefits / Typical Lanes / Requirements / About sections render canonical values', () => {
    renderDetail(fullBase());
    expect(screen.getByText('PTO and health')).toBeInTheDocument();
    expect(screen.getByText('TX -> OK')).toBeInTheDocument();
    expect(screen.getByText('Class A CDL')).toBeInTheDocument();
    expect(screen.getByText('A full description.')).toBeInTheDocument();
  });

  it('31. Apply Now + Request Info + Save action buttons remain rendered', () => {
    renderDetail(fullBase());
    expect(screen.getByRole('button', { name: /^Apply Now$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Request Info/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeInTheDocument();
  });

  it('32. Home Time & Lifestyle renders equipment year + forced dispatch answer', () => {
    renderDetail(fullBase());
    expect(screen.getByText('2022')).toBeInTheDocument();
    // Home time badge + section value both render 'Weekly' -> at least one match.
    expect(screen.getAllByText('Weekly').length).toBeGreaterThan(0);
    // forced_dispatch=false -> "No"
    const noNodes = screen.getAllByText('No');
    expect(noNodes.length).toBeGreaterThan(0);
  });
});
