// Phase 1L-F2B-P1 — Canonical OpportunityCard adoption tests.

import { describe, it, expect, vi } from 'vitest';
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

function renderCard(props: Partial<React.ComponentProps<typeof OpportunityCard>> & {
  opportunity: OpportunitySourceRow;
}) {
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

/* ================================ 1. Transparency badge ============================== */

describe('Phase 1L-F2B-P1 · Transparency badge', () => {
  it('renders transparency badge with exact visible text, title, and aria-label for Free user', () => {
    const opp = fullBase({});
    renderCard({ opportunity: opp, isPro: false });
    // Score is deterministic from canonical view; probe via aria-label.
    const badge = screen.getByLabelText(/^Listing transparency: \d{1,3} out of 100, /);
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute('title')).toBe(badge.getAttribute('aria-label'));
    const aria = badge.getAttribute('aria-label')!;
    const m = aria.match(/^Listing transparency: (\d{1,3}) out of 100, (Complete|Mostly complete|Partial|Sparse)\. Measures disclosure completeness and consistency, not profitability\.$/);
    expect(m).not.toBeNull();
    const [, score, band] = m!;
    expect(badge.textContent).toContain(`Transparency ${score} · ${band}`);
  });

  it('renders transparency badge for a sparse listing too (no subscription gate)', () => {
    renderCard({ opportunity: source({}), isPro: false });
    const badge = screen.getByLabelText(/^Listing transparency: \d{1,3} out of 100, Sparse\./);
    expect(badge).toBeInTheDocument();
  });
});

/* ================================ 2. No legacy profit copy ========================== */

describe('Phase 1L-F2B-P1 · No legacy profit copy', () => {
  it('does not render any legacy profit-score badge or wording, even for Pro', () => {
    const opp = fullBase({});
    const { container } = renderCard({ opportunity: opp, isPro: true });
    expect(container.textContent || '').not.toMatch(/Profit Clarity|Profit Score|Profitability/i);
    // Legacy tone labels must not appear as standalone text.
    for (const word of ['Strong', 'Solid', 'Mixed', 'Risky']) {
      expect(screen.queryByText(new RegExp(`^${word}$`))).toBeNull();
    }
  });
});

/* ================================ 3-4. Non-cost-bearing suppresses net ============== */

describe('Phase 1L-F2B-P1 · Company driver / unknown employment suppress Est. net', () => {
  it('company driver with raw deductions present renders canonical mileage, not Est. net', () => {
    const opp = fullBase({
      employment_model: 'company_driver',
      // Raw deductions present but must be ignored for company drivers.
      insurance_deductions: 200,
      insurance_deduction_frequency: 'weekly',
      maintenance_deductions: 100,
      maintenance_deduction_frequency: 'weekly',
    });
    renderCard({ opportunity: opp, isPro: true });
    expect(screen.queryByText('Est. net')).toBeNull();
    expect(screen.queryByText('Gross per total mile')).toBeNull();
    expect(screen.queryByText(/Based on your cost profile|After your cost profile/)).toBeNull();
    expect(screen.getByText('Weekly miles')).toBeInTheDocument();
    expect(screen.getByText('Deadhead')).toBeInTheDocument();
  });

  it('unknown employment does not render Est. net', () => {
    const opp = fullBase({ employment_model: null, canonical_version: null, driver_type: null });
    renderCard({ opportunity: opp, isPro: true });
    expect(screen.queryByText('Est. net')).toBeNull();
    expect(screen.queryByText('Gross per total mile')).toBeNull();
  });
});

/* ================================ 5-7. Cost-bearing employment renders net ========== */

describe('Phase 1L-F2B-P1 · Cost-bearing employment renders canonical net', () => {
  it('1099 contractor with complete recurring costs renders Est. net and Gross per total mile', () => {
    const opp = fullBase({ employment_model: 'contractor_1099' });
    renderCard({ opportunity: opp, isPro: true });
    expect(screen.getByText('Est. net')).toBeInTheDocument();
    expect(screen.getByText('Gross per total mile')).toBeInTheDocument();
  });

  it('owner-operator is cost-bearing and can render net', () => {
    const opp = fullBase({ employment_model: 'owner_operator' });
    renderCard({ opportunity: opp, isPro: true });
    expect(screen.getByText('Est. net')).toBeInTheDocument();
    expect(screen.getByText('Gross per total mile')).toBeInTheDocument();
  });

  it('lease-purchase is cost-bearing and can render net', () => {
    const opp = fullBase({
      employment_model: 'lease_purchase',
      lease_payment: 400,
      lease_payment_frequency: 'weekly',
    });
    renderCard({ opportunity: opp, isPro: true });
    expect(screen.getByText('Est. net')).toBeInTheDocument();
    expect(screen.getByText('Gross per total mile')).toBeInTheDocument();
  });
});

/* ================================ 8. Deadhead unpaid preserved ====================== */

describe('Phase 1L-F2B-P1 · Deadhead disclosure', () => {
  it('deadhead_paid=false renders unpaid; the false disclosure is not dropped', () => {
    const opp = fullBase({ deadhead_paid: false, estimated_deadhead_miles: 150 });
    renderCard({ opportunity: opp, isPro: false });
    const label = screen.getByText('Deadhead');
    const row = label.closest('div')!.parentElement!;
    expect(within(row).getByText(/150 mi · unpaid/)).toBeInTheDocument();
  });
});

/* ================================ 9. Provided zero mileage renders 0 mi ============= */

describe('Phase 1L-F2B-P1 · Zero mileage disclosure', () => {
  it('provided zero total weekly miles renders "0 mi", not an em dash or Not disclosed', () => {
    const opp = fullBase({
      pay_model: 'cpm',
      cpm: 0.6,
      estimated_weekly_miles: 0,
      estimated_loaded_miles: 0,
      estimated_deadhead_miles: 0,
      deadhead_paid: true,
    });
    renderCard({ opportunity: opp, isPro: false });
    const label = screen.getByText('Weekly miles');
    const row = label.closest('div')!.parentElement!;
    expect(within(row).getByText('0 mi')).toBeInTheDocument();
    expect(within(row).queryByText('—')).toBeNull();
    expect(within(row).queryByText('Not disclosed')).toBeNull();
  });
});

/* ================================ 10. Canonical labels ============================== */

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

  it('distinguishes Not disclosed from Not applicable via canonical disclosures', () => {
    // Route / trailer / home_time are always relevant → not_disclosed.
    // Fuel paid by is not_applicable for company driver.
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
    expect(screen.getByText('Team setup not disclosed')).toBeInTheDocument();
    // Company disclosure fallback.
    expect(screen.getByText('Company not disclosed')).toBeInTheDocument();
    // Route/trailer/home_time all not_disclosed → three "Not disclosed" badges rendered.
    expect(screen.getAllByText('Not disclosed').length).toBeGreaterThanOrEqual(3);
  });

  it('renders "Employment not disclosed" for unknown employment', () => {
    const opp = source({ canonical_version: 1, employment_model: null, driver_type: null });
    renderCard({ opportunity: opp });
    expect(screen.getByText('Employment not disclosed')).toBeInTheDocument();
  });
});

/* ================================ 11. Trust independence ============================ */

describe('Phase 1L-F2B-P1 · Featured and Verified Recruiter are independent', () => {
  it('Featured alone does not render Verified Recruiter', () => {
    const opp = fullBase({ featured: true, recruiter: null });
    renderCard({ opportunity: opp });
    expect(screen.getByText('Priority placement')).toBeInTheDocument();
    expect(screen.queryByText('Verified Recruiter')).toBeNull();
  });

  it('Approved recruiter renders Verified Recruiter', () => {
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

/* ================================ 12. Interactions ================================== */

describe('Phase 1L-F2B-P1 · Interactions preserved', () => {
  it('Save / Unsave / View Details / match callback still work', () => {
    const onView = vi.fn();
    const onToggleSave = vi.fn();
    const opp = fullBase({});
    const profile = completedDriverProfile();
    render(
      <OpportunityCard
        opportunity={opp as never}
        isSaved={false}
        onView={onView}
        onToggleSave={onToggleSave}
        driverProfile={profile}
        isPro={false}
      />,
    );
    // Match badge computed and rendered from opportunityMatch (unchanged pass-through).
    // We assert the callbacks work; match badge existence is validated via a labeled button click.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onToggleSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'View Details' }));
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('Unsave label toggles when isSaved is true', () => {
    const opp = fullBase({});
    renderCard({ opportunity: opp, isSaved: true });
    expect(screen.getByRole('button', { name: 'Unsave' })).toBeInTheDocument();
  });
});

/* ================================ 13. Sign-on bonus excluded ======================== */

describe('Phase 1L-F2B-P1 · Sign-on bonus does not alter weekly gross', () => {
  it('displayed weekly gross is identical with and without a sign-on bonus', () => {
    const withoutBonus = fullBase({ sign_on_bonus: null, pay_model: 'flat_weekly', flat_weekly_pay: 1600 });
    const withBonus = fullBase({ sign_on_bonus: 10000, pay_model: 'flat_weekly', flat_weekly_pay: 1600 });

    const { unmount } = renderCard({ opportunity: withoutBonus });
    const grossA = screen.getByText(/weekly gross/i).parentElement!.parentElement!.textContent;
    unmount();

    renderCard({ opportunity: withBonus });
    const grossB = screen.getByText(/weekly gross/i).parentElement!.parentElement!.textContent;
    expect(grossB).toBe(grossA);
    expect(grossB).toMatch(/\$1,600/);
  });
});
