// Phase 1L-F2B-P1-R1 — Canonical OpportunityCard adoption tests (strengthened).

import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { Tables } from '@/integrations/supabase/types';
import { OpportunityCard } from '@/components/opportunities/OpportunityCard';
import type { OpportunitySourceRow } from '@/lib/opportunities/opportunityCanonicalView';
import type { DriverOpportunityProfile } from '@/hooks/opportunities/useDriverOpportunityProfile';

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

/** Fully populated canonical row. */
function fullBase(overrides: Partial<OpportunitySourceRow> = {}): OpportunitySourceRow {
  return source({
    canonical_version: 1,
    company_name: 'Acme Freight',
    employment_model: 'contractor_1099',
    team_configuration: 'solo',
    route_type: 'OTR',
    trailer_type: 'Dry Van',
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

function completedDriverProfile(
  overrides: Partial<DriverOpportunityProfile> = {},
): DriverOpportunityProfile {
  return {
    allow_verified_recruiter_contact: true,
    available_start_date: null,
    cdl_class: 'A',
    city: 'Dallas',
    contact_preference: 'email',
    created_at: '2026-07-01T00:00:00Z',
    email: 'd@example.com',
    endorsements: [],
    full_name: 'Test Driver',
    id: '00000000-0000-0000-0000-0000000000bb',
    min_effective_rpm: null,
    min_weekly_gross: null,
    min_weekly_net: null,
    phone: null,
    preferred_driver_type: 'contractor_1099',
    preferred_home_time: 'Weekly',
    preferred_route_type: 'OTR',
    preferred_states: ['TX'],
    profile_completed: true,
    state: 'TX',
    trailer_experience: ['Dry Van'],
    updated_at: '2026-07-01T00:00:00Z',
    user_id: '00000000-0000-0000-0000-0000000000cc',
    visibility: 'verified_only',
    willing_to_relocate: false,
    years_experience: 5,
    ...overrides,
  };
}

function renderCard(
  props: Partial<ComponentProps<typeof OpportunityCard>> & {
    opportunity: OpportunitySourceRow;
  },
) {
  const defaults = {
    isSaved: false,
    onView: vi.fn(),
    onToggleSave: vi.fn(),
    saving: false,
    isPro: false,
    driverProfile: null,
  };
  return render(<OpportunityCard {...defaults} {...props} opportunity={props.opportunity as never} />);
}

/** Locate the metric row for a given canonical stat label (e.g. "Est. net"). */
function rowFor(label: string): HTMLElement {
  const labelNode = screen.getByText(label);
  return labelNode.closest('div')!.parentElement as HTMLElement;
}

/* ================================ 1. Transparency badge ============================== */

describe('Phase 1L-F2B-P1 · Transparency badge', () => {
  it('renders exact transparency 100 · Complete text, title, and aria-label for Free user', () => {
    renderCard({ opportunity: fullBase({}), isPro: false });
    const badge = screen.getByLabelText(
      'Listing transparency: 100 out of 100, Complete. Measures disclosure completeness and consistency, not profitability.',
    );
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute('title')).toBe(
      'Listing transparency: 100 out of 100, Complete. Measures disclosure completeness and consistency, not profitability.',
    );
    expect(badge.textContent).toContain('Transparency 100 · Complete');
  });

  it('renders the same 100 · Complete badge when isPro is true (no subscription gate)', () => {
    renderCard({ opportunity: fullBase({}), isPro: true });
    expect(screen.getByText(/Transparency 100 · Complete/)).toBeInTheDocument();
  });

  it('renders a Sparse-band transparency badge for a bare listing', () => {
    renderCard({ opportunity: source({}), isPro: false });
    const badge = screen.getByLabelText(/^Listing transparency: \d{1,3} out of 100, Sparse\./);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toMatch(/Transparency \d{1,3} · Sparse/);
  });
});

/* ================================ 2. No legacy profit copy ========================== */

describe('Phase 1L-F2B-P1 · No legacy profit copy', () => {
  it('does not render any legacy profit-score badge or wording, even for Pro', () => {
    const { container } = renderCard({ opportunity: fullBase({}), isPro: true });
    expect(container.textContent || '').not.toMatch(/Profit Clarity|Profit Score/i);
    // "Profitability" only appears inside the required disclosure disclaimer;
    // no standalone legacy tone labels may exist.
    for (const word of ['Strong', 'Solid', 'Mixed', 'Risky']) {
      expect(screen.queryByText(new RegExp(`^${word}$`))).toBeNull();
    }
  });
});

/* ================================ 3. Company-driver / unknown suppress net =========== */

describe('Phase 1L-F2B-P1 · Company driver / unknown employment suppress Est. net', () => {
  it('company driver with raw deductions renders exact canonical mileage, no Est. net or RPM', () => {
    const opp = fullBase({
      employment_model: 'company_driver',
      insurance_deductions: 200,
      insurance_deduction_frequency: 'weekly',
      maintenance_deductions: 100,
      maintenance_deduction_frequency: 'weekly',
    });
    renderCard({ opportunity: opp, isPro: true });
    expect(screen.queryByText('Est. net')).toBeNull();
    expect(screen.queryByText('Gross per total mile')).toBeNull();
    expect(screen.queryByText(/Based on your cost profile|After your cost profile/)).toBeNull();
    expect(within(rowFor('Weekly miles')).getByText('2,500 mi')).toBeInTheDocument();
    expect(within(rowFor('Deadhead')).getByText('200 mi · paid')).toBeInTheDocument();
  });

  it('unknown employment does not render Est. net or Gross per total mile', () => {
    const opp = fullBase({ employment_model: null, canonical_version: null, driver_type: null });
    renderCard({ opportunity: opp, isPro: true });
    expect(screen.queryByText('Est. net')).toBeNull();
    expect(screen.queryByText('Gross per total mile')).toBeNull();
  });
});

/* ================================ 4. Cost-bearing exact values ====================== */

describe('Phase 1L-F2B-P1 · Cost-bearing employment renders exact canonical net + RPM', () => {
  it('1099 contractor renders Est. net $1,205 and Gross per total mile $0.55', () => {
    renderCard({ opportunity: fullBase({ employment_model: 'contractor_1099' }), isPro: true });
    expect(within(rowFor('Est. net')).getByText('$1,205')).toBeInTheDocument();
    expect(within(rowFor('Gross per total mile')).getByText('$0.55')).toBeInTheDocument();
  });

  it('owner-operator renders Est. net $1,205 and Gross per total mile $0.55', () => {
    renderCard({ opportunity: fullBase({ employment_model: 'owner_operator' }), isPro: true });
    expect(within(rowFor('Est. net')).getByText('$1,205')).toBeInTheDocument();
    expect(within(rowFor('Gross per total mile')).getByText('$0.55')).toBeInTheDocument();
  });

  it('lease-purchase with $400/wk lease renders Est. net $805 and Gross per total mile $0.55', () => {
    const opp = fullBase({
      employment_model: 'lease_purchase',
      lease_payment: 400,
      lease_payment_frequency: 'weekly',
    });
    renderCard({ opportunity: opp, isPro: true });
    expect(within(rowFor('Est. net')).getByText('$805')).toBeInTheDocument();
    expect(within(rowFor('Gross per total mile')).getByText('$0.55')).toBeInTheDocument();
  });
});

/* ================================ 5. Deadhead unpaid preserved ====================== */

describe('Phase 1L-F2B-P1 · Deadhead disclosure', () => {
  it('deadhead_paid=false renders exact "150 mi · unpaid"; false is preserved', () => {
    const opp = fullBase({ deadhead_paid: false, estimated_deadhead_miles: 150 });
    renderCard({ opportunity: opp, isPro: false });
    expect(within(rowFor('Deadhead')).getByText('150 mi · unpaid')).toBeInTheDocument();
  });
});

/* ================================ 6. Zero mileage preserved ========================= */

describe('Phase 1L-F2B-P1 · Zero mileage disclosure', () => {
  it('provided zero total weekly miles renders exact "0 mi"', () => {
    const opp = fullBase({
      pay_model: 'cpm',
      cpm: 0.6,
      estimated_weekly_miles: 0,
      estimated_loaded_miles: 0,
      estimated_deadhead_miles: 0,
      deadhead_paid: true,
    });
    renderCard({ opportunity: opp, isPro: false });
    const row = rowFor('Weekly miles');
    expect(within(row).getByText('0 mi')).toBeInTheDocument();
    expect(within(row).queryByText('—')).toBeNull();
    expect(within(row).queryByText('Not disclosed')).toBeNull();
  });
});

/* ================================ 7. Canonical labels =============================== */

describe('Phase 1L-F2B-P1 · Canonical classification and disclosure labels', () => {
  it('renders canonical employment, team, route, trailer, home time, hiring, and company labels', () => {
    const opp = fullBase({
      employment_model: 'owner_operator',
      team_configuration: 'team',
    });
    renderCard({ opportunity: opp });
    expect(screen.getByText('Owner-Operator')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('OTR')).toBeInTheDocument();
    expect(screen.getByText('Dry Van')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText(/^Dallas, TX$/)).toBeInTheDocument();
    expect(screen.getByText('Acme Freight')).toBeInTheDocument();
  });

  it('flat_weekly company driver omits unpopulated route/trailer/home rows and hides mileage rows entirely (Phase 1O-B omission rules)', () => {
    const opp = source({
      canonical_version: 1,
      employment_model: 'company_driver',
      company_name: '',
      team_configuration: null,
      pay_model: 'flat_weekly',
      flat_weekly_pay: 1400,
    });
    renderCard({ opportunity: opp });
    expect(screen.getByText('Company Driver')).toBeInTheDocument();
    // Omission rules: no "Not disclosed" / "Not applicable" / "—" filler anywhere.
    expect(screen.queryByText(/Not disclosed/i)).toBeNull();
    expect(screen.queryByText(/Not applicable/i)).toBeNull();
    expect(screen.queryByText('Team setup not disclosed')).toBeNull();
    expect(screen.queryByText('Company not disclosed')).toBeNull();
    // Mileage rows are absent (not "Not applicable") under flat_weekly.
    expect(screen.queryByText('Weekly miles')).toBeNull();
    expect(screen.queryByText('Deadhead')).toBeNull();
  });

  it('unknown employment omits the employment fact rather than rendering "Employment not disclosed" filler', () => {
    const opp = source({ canonical_version: 1, employment_model: null, driver_type: null });
    renderCard({ opportunity: opp });
    expect(screen.queryByText('Employment not disclosed')).toBeNull();
    expect(screen.queryByText(/Not disclosed/i)).toBeNull();
  });
});

/* ================================ 8. Trust independence ============================ */

describe('Phase 1L-F2B-P1 · Featured and Verified Recruiter are independent', () => {
  it('Featured alone does not render Verified Recruiter', () => {
    const opp = fullBase({ featured: true, recruiter: null });
    renderCard({ opportunity: opp });
    expect(screen.getByText('Priority placement')).toBeInTheDocument();
    expect(screen.queryByText('Verified Recruiter')).toBeNull();
  });

  it('Approved active recruiter renders Verified Recruiter without Featured', () => {
    const opp = fullBase({
      featured: false,
      recruiter: { verification_status: 'approved', status: 'active' },
    });
    renderCard({ opportunity: opp });
    expect(screen.getByText('Verified Recruiter')).toBeInTheDocument();
    expect(screen.queryByText('Priority placement')).toBeNull();
  });

  it('Suspended approved recruiter does not render Verified Recruiter', () => {
    const opp = fullBase({
      recruiter: { verification_status: 'approved', status: 'suspended' },
    });
    renderCard({ opportunity: opp });
    expect(screen.queryByText('Verified Recruiter')).toBeNull();
  });
});

/* ================================ 9. Match + interactions =========================== */

describe('Phase 1L-F2B-P1 · Match badge and interactions preserved', () => {
  it('renders exact "70% Strong Fit" match badge for canonical fullBase + completed driver profile', () => {
    render(
      <OpportunityCard
        opportunity={fullBase({}) as never}
        isSaved={false}
        onView={vi.fn()}
        onToggleSave={vi.fn()}
        driverProfile={completedDriverProfile()}
        isPro={false}
      />,
    );
    expect(screen.getByText(/70% Strong Fit/)).toBeInTheDocument();
  });

  it('Save triggers onToggleSave, View Details triggers onView', () => {
    const onView = vi.fn();
    const onToggleSave = vi.fn();
    render(
      <OpportunityCard
        opportunity={fullBase({}) as never}
        isSaved={false}
        onView={onView}
        onToggleSave={onToggleSave}
        driverProfile={null}
        isPro={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onToggleSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'View Details' }));
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('isSaved=true renders the Unsave control', () => {
    renderCard({ opportunity: fullBase({}), isSaved: true });
    expect(screen.getByRole('button', { name: 'Unsave' })).toBeInTheDocument();
  });

  it('saving=true disables the save control and clicking it does not invoke onToggleSave', () => {
    const onToggleSave = vi.fn();
    render(
      <OpportunityCard
        opportunity={fullBase({}) as never}
        isSaved={false}
        onView={vi.fn()}
        onToggleSave={onToggleSave}
        driverProfile={null}
        isPro={false}
        saving
      />,
    );
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onToggleSave).not.toHaveBeenCalled();
  });
});

/* ================================ 10. Gross source behavior ========================= */

describe('Phase 1L-F2B-P1 · Gross value and source labels', () => {
  it('sign-on bonus does not alter recurring weekly gross; both display $1,600', () => {
    const withoutBonus = fullBase({
      sign_on_bonus: null,
      pay_model: 'flat_weekly',
      flat_weekly_pay: 1600,
    });
    const withBonus = fullBase({
      sign_on_bonus: 10000,
      pay_model: 'flat_weekly',
      flat_weekly_pay: 1600,
    });

    const { unmount } = renderCard({ opportunity: withoutBonus });
    expect(within(rowFor('Derived weekly gross')).getByText('$1,600')).toBeInTheDocument();
    unmount();

    renderCard({ opportunity: withBonus });
    expect(within(rowFor('Derived weekly gross')).getByText('$1,600')).toBeInTheDocument();
  });

  it('CPM-derived weekly gross renders as "Derived weekly gross" with exact value $1,380', () => {
    renderCard({ opportunity: fullBase({}) });
    expect(within(rowFor('Derived weekly gross')).getByText('$1,380')).toBeInTheDocument();
  });

  it('Recruiter-provided weekly gross under unknown pay model renders as "Recruiter weekly gross" $1,500', () => {
    const opp = source({
      canonical_version: 1,
      employment_model: 'company_driver',
      pay_model: null,
      estimated_weekly_gross: 1500,
    });
    renderCard({ opportunity: opp });
    expect(within(rowFor('Recruiter weekly gross')).getByText('$1,500')).toBeInTheDocument();
  });
});
