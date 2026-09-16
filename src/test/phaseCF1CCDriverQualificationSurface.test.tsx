// Phase CF-1C-C — Driver qualification surface on OpportunityDetail.
//
// Proves the four evaluator statuses render correctly, that the panel is
// advisory only (Talk to Recruiter stays present and enabled in every state),
// that no conversation side effect is produced merely by rendering, and that
// no guaranteed-qualification wording exists in the surface source.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';
import path from 'node:path';
import type { Tables } from '@/integrations/supabase/types';

beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

const h = vi.hoisted(() => ({
  startConversation: vi.fn(),
  sendMessage: vi.fn(),
  closeConversation: vi.fn(),
  conversationHook: vi.fn(),
}));

vi.mock('@/hooks/opportunities/useOpportunityApplications', () => ({
  useOpportunityApplications: () => ({
    driverApplications: [] as unknown[],
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
vi.mock('@/components/opportunities/ReferDriverDialog', () => ({ ReferDriverDialog: () => null }));
vi.mock('@/components/opportunities/ApplyNowDialog', () => ({ ApplyNowDialog: () => null }));

// The real conversation hook is replaced so we can prove rendering the
// qualification panel never triggers a conversation mutation.
vi.mock('@/hooks/conversations/useConversations', () => ({
  useDriverOpportunityConversation: (...args: unknown[]) => {
    h.conversationHook(...args);
    return {
      thread: null,
      messages: [],
      isLoading: false,
      isBusy: false,
      error: null,
      refetch: vi.fn(),
      startConversation: h.startConversation,
      sendMessage: h.sendMessage,
      closeConversation: h.closeConversation,
    };
  },
  CF1B_OPEN_STATUSES: ['requested', 'active'] as const,
  CONVERSATION_POLL_MS: 5000,
  newClientMessageId: () => 'test-client-message-id',
}));

import { OpportunityDetail } from '@/components/opportunities/OpportunityDetail';
import { OpportunityQualificationPanel } from '@/components/opportunities/OpportunityQualificationPanel';
import { evaluateKnownOpportunityQualification } from '@/lib/opportunities/opportunityQualification';

type Row = Tables<'opportunities'>;
type DriverProfile = Tables<'driver_opportunity_profiles'>;

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    actual_benefits: null,
    admin_review_status: 'approved',
    benefits: null,
    canonical_version: 1,
    company_name: 'Acme Trucking',
    cpm: null,
    created_at: '2026-09-01T00:00:00Z',
    deadhead_paid: null,
    description: null,
    detention_pay: null,
    driver_type: null,
    employment_model: 'company_driver',
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
    min_years_experience: null,
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
    published_at: '2026-09-01T00:00:00Z',
    recruiter_id: '00000000-0000-0000-0000-0000000000aa',
    required_cdl_class: null,
    required_endorsements: [],
    requirements: null,
    riders_allowed: null,
    route_type: null,
    salary_amount: null,
    salary_frequency: null,
    sign_on_bonus: null,
    status: 'active',
    team_configuration: null,
    title: 'Regional Dry Van',
    trailer_type: null,
    transparency_confirmed: true,
    typical_lanes: null,
    updated_at: '2026-09-01T00:00:00Z',
    view_count: 0,
    ...overrides,
  } as Row;
}

function makeDriver(overrides: Partial<DriverProfile> = {}): DriverProfile {
  return {
    id: 'dp-1',
    user_id: 'u-1',
    profile_completed: true,
    cdl_class: 'A',
    years_experience: 5,
    endorsements: ['H (Hazmat)'],
    ...overrides,
  } as unknown as DriverProfile;
}

function renderDetail(row: Row, driverProfile: DriverProfile | null, onPrefs = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <OpportunityDetail
        opportunity={row}
        onBack={vi.fn()}
        isPro={false}
        onUpgrade={vi.fn()}
        driverProfile={driverProfile}
        onOpenPreferencesForApply={onPrefs}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onPrefs };
}

function panel(): HTMLElement {
  return screen.getByTestId('opportunity-qualification-panel');
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

/* -------------------------------------------------------------------------- */
/* Status: no_structured_criteria                                             */
/* -------------------------------------------------------------------------- */

describe('CF-1C-C — no_structured_criteria', () => {
  it('renders no panel when the recruiter declared no structured criteria', () => {
    renderDetail(makeRow(), makeDriver());
    expect(screen.queryByTestId('opportunity-qualification-panel')).toBeNull();
  });

  it('renders no panel even when free-text requirements exist', () => {
    renderDetail(makeRow({ requirements: 'Clean MVR required.' }), makeDriver());
    expect(screen.queryByTestId('opportunity-qualification-panel')).toBeNull();
    expect(screen.queryByTestId('qualification-manual-review')).toBeNull();
  });

  it('standalone panel returns null for a no_structured_criteria result', () => {
    const result = evaluateKnownOpportunityQualification({}, {});
    expect(result.status).toBe('no_structured_criteria');
    const { container } = render(
      <OpportunityQualificationPanel result={result} onOpenPreferences={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

/* -------------------------------------------------------------------------- */
/* Status: meets_known_criteria                                               */
/* -------------------------------------------------------------------------- */

describe('CF-1C-C — meets_known_criteria', () => {
  const row = makeRow({
    min_years_experience: 2,
    required_cdl_class: 'A',
    required_endorsements: ['H'],
  });

  it('renders the calm positive comparison copy', () => {
    renderDetail(row, makeDriver());
    expect(panel()).toHaveAttribute('data-status', 'meets_known_criteria');
    expect(
      screen.getByText(
        'Based on your Driver Work Profile, you meet the criteria HaulTracker can compare.',
      ),
    ).toBeInTheDocument();
  });

  it('lists each met criterion', () => {
    renderDetail(row, makeDriver());
    expect(screen.getByTestId('qualification-met-list')).toBeInTheDocument();
    expect(screen.getByTestId('qualification-criterion-experience')).toBeInTheDocument();
    expect(screen.getByTestId('qualification-criterion-cdl_class')).toBeInTheDocument();
    expect(screen.getByTestId('qualification-criterion-endorsements')).toBeInTheDocument();
  });

  it('never claims guaranteed qualification, eligibility, approval, or hiring', () => {
    renderDetail(row, makeDriver());
    const text = panel().textContent ?? '';
    for (const forbidden of [
      /guarantee/i,
      /you are qualified/i,
      /you qualify/i,
      /eligible/i,
      /approved/i,
      /hired/i,
    ]) {
      expect(text).not.toMatch(forbidden);
    }
  });

  it('omits the manual-review line when requirements are blank', () => {
    renderDetail(row, makeDriver());
    expect(screen.queryByTestId('qualification-manual-review')).toBeNull();
  });

  it('shows the manual-review line without changing the status', () => {
    renderDetail(makeRow({ ...row, requirements: '  Clean MVR.  ' }), makeDriver());
    expect(panel()).toHaveAttribute('data-status', 'meets_known_criteria');
    expect(screen.getByTestId('qualification-manual-review')).toHaveTextContent(
      'The recruiter may have additional requirements to review.',
    );
  });

  it('X on the driver profile satisfies a required H and N', () => {
    renderDetail(
      makeRow({ required_endorsements: ['H', 'N'] }),
      makeDriver({ endorsements: ['X (Hazmat+Tanker)'] }),
    );
    expect(panel()).toHaveAttribute('data-status', 'meets_known_criteria');
  });
});

/* -------------------------------------------------------------------------- */
/* Status: needs_driver_information                                           */
/* -------------------------------------------------------------------------- */

describe('CF-1C-C — needs_driver_information', () => {
  const row = makeRow({ min_years_experience: 2, required_cdl_class: 'A' });
  const emptyDriver = makeDriver({
    years_experience: null,
    cdl_class: null,
    endorsements: null,
  });

  it('explains which recorded information is missing', () => {
    renderDetail(row, emptyDriver);
    expect(panel()).toHaveAttribute('data-status', 'needs_driver_information');
    const list = screen.getByTestId('qualification-unknown-list');
    expect(list).toHaveTextContent('Years of driving experience are not recorded on your profile.');
    expect(list).toHaveTextContent('A recognized CDL class is not recorded on your profile.');
  });

  it('exposes the recruiter-listed requirement alongside each missing detail', () => {
    renderDetail(row, emptyDriver);
    expect(screen.getByTestId('qualification-criterion-experience')).toHaveTextContent('2+ years');
    expect(screen.getByTestId('qualification-criterion-cdl_class')).toHaveTextContent('Class A');
  });

  it('invokes the existing preferences callback from Update Opportunity Preferences', () => {
    const onPrefs = vi.fn();
    renderDetail(row, emptyDriver, onPrefs);
    fireEvent.click(screen.getByTestId('qualification-open-preferences'));
    expect(onPrefs).toHaveBeenCalledTimes(1);
  });

  it('treats a missing driver profile as needing information, not as a pass or failure', () => {
    renderDetail(row, null);
    expect(panel()).toHaveAttribute('data-status', 'needs_driver_information');
  });

  it('performs no automatic profile write', () => {
    const onPrefs = vi.fn();
    renderDetail(row, emptyDriver, onPrefs);
    // Rendering alone must not call anything; only the explicit click does.
    expect(onPrefs).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Status: does_not_meet_known_criteria                                       */
/* -------------------------------------------------------------------------- */

describe('CF-1C-C — does_not_meet_known_criteria', () => {
  const row = makeRow({
    min_years_experience: 5,
    required_endorsements: ['X'],
    requirements: 'Clean MVR required.',
  });
  const shortDriver = makeDriver({ years_experience: 1, endorsements: ['H (Hazmat)', 'N (Tanker)'] });

  it('renders the failed criteria details', () => {
    renderDetail(row, shortDriver);
    expect(panel()).toHaveAttribute('data-status', 'does_not_meet_known_criteria');
    const list = screen.getByTestId('qualification-failed-list');
    expect(list).toHaveTextContent('Recorded experience is below the 5-year minimum.');
    expect(list).toHaveTextContent('Missing required endorsement(s): X.');
  });

  it('states plainly that the recruiter makes the final hiring decision', () => {
    renderDetail(row, shortDriver);
    expect(panel()).toHaveTextContent('The recruiter makes the final hiring decision');
  });

  it('keeps the manual-review line secondary without altering the status', () => {
    renderDetail(row, shortDriver);
    expect(screen.getByTestId('qualification-manual-review')).toBeInTheDocument();
    expect(panel()).toHaveAttribute('data-status', 'does_not_meet_known_criteria');
  });

  it('H + N alone does not satisfy a required X', () => {
    renderDetail(makeRow({ required_endorsements: ['X'] }), shortDriver);
    expect(panel()).toHaveAttribute('data-status', 'does_not_meet_known_criteria');
  });

  it('a failure outranks an unknown criterion', () => {
    renderDetail(
      makeRow({ min_years_experience: 5, required_cdl_class: 'A' }),
      makeDriver({ years_experience: 1, cdl_class: null }),
    );
    expect(panel()).toHaveAttribute('data-status', 'does_not_meet_known_criteria');
  });
});

/* -------------------------------------------------------------------------- */
/* No hard gate — Talk to Recruiter in every state                            */
/* -------------------------------------------------------------------------- */

describe('CF-1C-C — Talk to Recruiter remains ungated', () => {
  const cases: Array<[string, Row, DriverProfile | null]> = [
    ['no_structured_criteria', makeRow(), makeDriver()],
    [
      'meets_known_criteria',
      makeRow({ min_years_experience: 1, required_cdl_class: 'A' }),
      makeDriver(),
    ],
    [
      'needs_driver_information',
      makeRow({ min_years_experience: 1 }),
      makeDriver({ years_experience: null }),
    ],
    [
      'does_not_meet_known_criteria',
      makeRow({ min_years_experience: 20 }),
      makeDriver({ years_experience: 1 }),
    ],
  ];

  it.each(cases)('Talk to Recruiter is present and enabled for %s', (_label, row, driver) => {
    renderDetail(row, driver);
    const cta = screen.getByTestId('opportunity-talk-to-recruiter');
    expect(cta).toBeInTheDocument();
    expect(cta).toBeEnabled();
    expect(cta).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('Talk to Recruiter still opens the conversation dialog on a known failure', () => {
    renderDetail(makeRow({ min_years_experience: 20 }), makeDriver({ years_experience: 1 }));
    fireEvent.click(screen.getByTestId('opportunity-talk-to-recruiter'));
    expect(screen.getByTestId('driver-conversation-dialog')).toBeInTheDocument();
  });

  it('Apply action remains present in every qualification state', () => {
    for (const [, row, driver] of cases) {
      renderDetail(row, driver);
      expect(screen.getByRole('button', { name: /Apply Now|Complete Preferences to Apply/ })).toBeEnabled();
      cleanup();
    }
  });

  it('rendering the panel produces no conversation mutation side effect', () => {
    renderDetail(makeRow({ min_years_experience: 20 }), makeDriver({ years_experience: 1 }));
    expect(h.startConversation).not.toHaveBeenCalled();
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(h.closeConversation).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Static scope guards                                                        */
/* -------------------------------------------------------------------------- */

describe('CF-1C-C — scope guard', () => {
  const root = path.resolve(__dirname, '..');
  const panelSrc = fs.readFileSync(
    path.join(root, 'components/opportunities/OpportunityQualificationPanel.tsx'),
    'utf8',
  );
  const detailSrc = fs.readFileSync(
    path.join(root, 'components/opportunities/OpportunityDetail.tsx'),
    'utf8',
  );

  it('the panel is purely presentational — no client, RPC, or fetch access', () => {
    for (const forbidden of [
      'supabase',
      '.rpc(',
      'fetch(',
      'useQuery',
      'useMutation',
      'ai-insight',
      'stripe',
      'telegram',
    ]) {
      expect(panelSrc.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('the panel never writes to a driver profile or starts a conversation', () => {
    for (const forbidden of [
      'driver_opportunity_profiles',
      'upsertProfile',
      'start_opportunity_conversation',
      'conversation_post_message',
    ]) {
      expect(panelSrc).not.toContain(forbidden);
    }
  });

  it('neither surface uses guaranteed-qualification wording in source', () => {
    for (const src of [panelSrc, detailSrc]) {
      expect(src).not.toMatch(/you are qualified|guaranteed qualif|you qualify for/i);
    }
  });

  it('OpportunityDetail contains no hard block keyed on qualification status', () => {
    // The conversation CTA must never be conditionally disabled by status.
    expect(detailSrc).not.toMatch(/disabled=\{[^}]*qualification[^}]*\}/);
    expect(detailSrc).not.toMatch(/qualification\.status[^\n]*setShowConversation/);
  });

  it('OpportunityDetail reads only the four approved opportunity criteria inputs', () => {
    expect(detailSrc).toContain('min_years_experience: o.min_years_experience');
    expect(detailSrc).toContain('required_cdl_class: o.required_cdl_class');
    expect(detailSrc).toContain('required_endorsements: o.required_endorsements');
    expect(detailSrc).toContain('requirements: o.requirements');
  });

  it('OpportunityDetail reuses the existing preferences callback for the panel', () => {
    expect(detailSrc).toContain('onOpenPreferences={onOpenPreferencesForApply}');
  });
});
