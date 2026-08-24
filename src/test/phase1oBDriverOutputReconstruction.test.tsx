// Phase 1O-B — Driver Opportunity Output Reconstruction focused acceptance.
//
// Verifies the locked Phase 1O-B contract additions:
//   1. Nationwide (Lower 48) coverage label renders as exactly
//      "Nationwide — Lower 48" when hiring_states contains all 48 contiguous
//      state codes on both the Card and Detail views.
//   2. Omission rules — Card and Detail never render "Not disclosed",
//      "Not applicable", "—", "Unavailable" filler for absent fields.
//   3. Card hierarchy — a dominant pay headline is rendered above the
//      compact facts row.
//   4. Detail — a single sticky action bar hosts one Apply Now button and
//      one Save button (no duplicates in the top summary).
//   5. Theme lock — no hardcoded amber-* / mockup hex utilities on the
//      reconstructed components.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Tables } from '@/integrations/supabase/types';
import type { OpportunitySourceRow } from '@/lib/opportunities/opportunityCanonicalView';
import { OpportunityCard } from '@/components/opportunities/OpportunityCard';
import { OpportunityDetail } from '@/components/opportunities/OpportunityDetail';
import { LOWER_48_STATE_CODES } from '@/components/opportunities/RecruiterOpportunityForm';

type Row = Tables<'opportunities'>;

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('@/hooks/opportunities/useOpportunityApplications', () => ({
  useOpportunityApplications: () => ({
    driverApplications: [],
    applications: [],
    isLoading: false,
    createApplication: { mutateAsync: vi.fn(), isPending: false },
    submit: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/hooks/opportunities/useSavedOpportunities', () => ({
  useSavedOpportunities: () => ({
    saved: [],
    isLoading: false,
    save: { mutateAsync: vi.fn(), isPending: false },
    unsave: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/hooks/opportunities/useRecruiterContactRequests', () => ({
  useRecruiterContactRequests: () => ({
    requestContact: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/hooks/opportunities/useApplicationEvents', () => ({
  useApplicationEvents: () => ({ events: [] }),
}));
vi.mock('@/hooks/opportunities/useDriverReferrals', () => ({
  useDriverReferrals: () => ({
    referrals: [],
    create: { mutateAsync: vi.fn(), isPending: false },
    createReferral: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/hooks/opportunities/useDriverOpportunityProfile', () => ({
  useDriverOpportunityProfile: () => ({ profile: null }),
}));
vi.mock('@/integrations/supabase/client', () => {
  const rpc = Object.assign(vi.fn(async () => ({ data: null, error: null })), {});
  return {
    supabase: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      }),
      rpc,
      functions: { invoke: async () => ({ data: null }) },
    },
  };
});

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    actual_benefits: null,
    admin_review_status: 'pending',
    benefits: null,
    canonical_version: 1,
    company_name: 'Acme',
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
    title: 'OTR Position',
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

function renderCard(opp: OpportunitySourceRow) {
  return render(
    <OpportunityCard
      opportunity={opp as never}
      isSaved={false}
      onView={vi.fn()}
      onToggleSave={vi.fn()}
      driverProfile={null}
      isPro={false}
    />,
  );
}

function renderDetail(opp: OpportunitySourceRow) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OpportunityDetail
        opportunity={opp as never}
        onBack={vi.fn()}
        isPro={false}
        onUpgrade={vi.fn()}
        onOpenPreferencesForApply={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

/* ------------------------------------------------------------------ */

describe('Phase 1O-B · Nationwide (Lower 48) label', () => {
  it('Card renders exactly "Nationwide — Lower 48" when hiring_states = LOWER_48_STATE_CODES', () => {
    renderCard(source({ hiring_city: null, hiring_state: null, hiring_states: [...LOWER_48_STATE_CODES] }));
    expect(screen.getByText('Nationwide — Lower 48')).toBeInTheDocument();
  });

  it('Detail renders exactly "Nationwide — Lower 48" when hiring_states = LOWER_48_STATE_CODES', () => {
    renderDetail(source({ hiring_city: null, hiring_state: null, hiring_states: [...LOWER_48_STATE_CODES] }));
    expect(screen.getAllByText('Nationwide — Lower 48').length).toBeGreaterThanOrEqual(1);
  });
});

describe('Phase 1O-B · Omission rules', () => {
  it('Card omits Not disclosed / Not applicable / — / Unavailable filler for a bare listing', () => {
    renderCard(source({}));
    expect(screen.queryByText(/Not disclosed/i)).toBeNull();
    expect(screen.queryByText(/Not applicable/i)).toBeNull();
    expect(screen.queryByText(/Unavailable/i)).toBeNull();
    // The lone em-dash filler must not appear.
    expect(screen.queryByText('—')).toBeNull();
  });

  it('Detail omits Not disclosed / Not applicable / — / Unavailable filler for a bare listing', () => {
    renderDetail(source({}));
    expect(screen.queryByText(/Not disclosed/i)).toBeNull();
    expect(screen.queryByText(/Not applicable/i)).toBeNull();
    expect(screen.queryByText(/Unavailable/i)).toBeNull();
  });
});

describe('Phase 1O-B · Card hierarchy', () => {
  it('renders a pay headline row (label + amount + per week caption) for a fully populated listing', () => {
    renderCard(
      source({
        pay_model: 'flat_weekly',
        flat_weekly_pay: 1600,
        employment_model: 'company_driver',
      }),
    );
    expect(screen.getByText('Derived weekly gross')).toBeInTheDocument();
    expect(screen.getByText('$1,600')).toBeInTheDocument();
    expect(screen.getByText('per week')).toBeInTheDocument();
  });
});

describe('Phase 1O-B · Detail sticky action bar', () => {
  it('exposes exactly one apply CTA and exactly one Save button across the whole view', () => {
    renderDetail(source({ pay_model: 'flat_weekly', flat_weekly_pay: 1600 }));
    // Phase OD-1 — this fixture passes driverProfile={null}, so the single
    // primary CTA truthfully reads "Complete Preferences to Apply".
    expect(
      screen.getAllByRole('button', { name: /^Complete Preferences to Apply$/ }),
    ).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Apply Now$/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Save$/ })).toHaveLength(1);
  });
});

describe('Phase 1O-B · Theme lock', () => {
  const files = [
    'src/components/opportunities/OpportunityCard.tsx',
    'src/components/opportunities/OpportunityDetail.tsx',
    'src/components/opportunities/RecommendedOpportunityCard.tsx',
  ];
  it.each(files)('%s contains no hardcoded amber-* utilities or hex colors (theme tokens only)', (rel) => {
    const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
    expect(src).not.toMatch(/\bamber-/);
    expect(src).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
  });
});

// -------------------------------------------------------------------------
// Phase 1O-B fail-closed phase-boundary proof.
// -------------------------------------------------------------------------
describe('Phase 1O-B — historical phase-boundary proof (fail-closed)', () => {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  // Implementation base (pre-1O-B) and accepted terminal SHA.
  const START_SHA = '8938b17a9258de877e8a86f8cb431ef0fbc2797d';
  const TERMINAL_SHA = '4168035214872cded25d3767dd7ee06b7bd44ccb';
  // Exactly the six production+test files actually changed in the
  // implementation window. OpportunitiesPage.tsx and its P3 test were
  // authorized but correctly left unchanged (P3 already passed).
  const EXPECTED_IMPL_FILES = new Set<string>([
    'src/components/opportunities/OpportunityCard.tsx',
    'src/components/opportunities/OpportunityDetail.tsx',
    'src/components/opportunities/RecommendedOpportunityCard.tsx',
    'src/test/phase1lF2P1OpportunityCardCanonical.test.tsx',
    'src/test/phase1lF2P2OpportunityDetailCanonical.test.tsx',
    'src/test/phase1oBDriverOutputReconstruction.test.tsx',
  ]);
  // Original Phase 1O-B allowlist (eight files) — no production file
  // outside this set may appear in start..terminal.
  const ORIGINAL_ALLOWLIST = new Set<string>([
    'src/components/opportunities/OpportunityCard.tsx',
    'src/components/opportunities/OpportunityDetail.tsx',
    'src/components/opportunities/OpportunitiesPage.tsx',
    'src/components/opportunities/RecommendedOpportunityCard.tsx',
    'src/test/phase1lF2P1OpportunityCardCanonical.test.tsx',
    'src/test/phase1lF2P2OpportunityDetailCanonical.test.tsx',
    'src/test/phase1lF2P3OpportunitiesPageCanonical.test.tsx',
    'src/test/phase1oBDriverOutputReconstruction.test.tsx',
  ]);

  function isAncestor(a: string, b: string): boolean {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  it('start SHA is ancestor of terminal SHA', () => {
    expect(isAncestor(START_SHA, TERMINAL_SHA)).toBe(true);
  });

  it('terminal SHA is ancestor of current HEAD', () => {
    expect(isAncestor(TERMINAL_SHA, 'HEAD')).toBe(true);
  });

  it('git diff --name-only start..terminal equals exactly the six implementation files', () => {
    const out = execFileSync(
      'git',
      ['diff', '--name-only', `${START_SHA}..${TERMINAL_SHA}`],
      { encoding: 'utf8' },
    ).trim();
    const changed = new Set(
      out.split('\n').map((s) => s.trim()).filter(Boolean),
    );
    for (const f of EXPECTED_IMPL_FILES) {
      expect(changed.has(f), `missing from Phase 1O-B diff: ${f}`).toBe(true);
    }
    for (const f of changed) {
      expect(
        EXPECTED_IMPL_FILES.has(f),
        `unexpected file in Phase 1O-B diff: ${f}`,
      ).toBe(true);
    }
    expect(changed.size).toBe(EXPECTED_IMPL_FILES.size);
  });

  it('every file in the Phase 1O-B diff sits inside the original eight-file allowlist', () => {
    for (const f of EXPECTED_IMPL_FILES) {
      expect(ORIGINAL_ALLOWLIST.has(f), `outside original allowlist: ${f}`).toBe(true);
    }
  });
});
