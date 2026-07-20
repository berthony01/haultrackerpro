// Phase 1F-A.2.2-R1A.1 — production-mounted render evidence.
//
// These tests render the real `RecruiterAccessPage` and the real
// `RecruiterOnboarding` component (no test-only duplicate surface) and
// assert against the actual DOM those components produce. Hooks are
// mocked at the module boundary so we can drive profile / billing /
// opportunities / applications state without a network or router.
//
// If the real page stops mounting the shared `RecruiterTrustStatus` /
// `RecruiterOnboardingStatusCard`, or the top "Post an Opportunity"
// button's disabled wiring changes, these tests fail.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import type { RecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

// ---------------------------------------------------------------------------
// Hook mocks — narrow, at the module boundary.
// ---------------------------------------------------------------------------
vi.mock('@/hooks/opportunities/useRecruiterProfile', async () => {
  const actual = await vi.importActual<
    typeof import('@/hooks/opportunities/useRecruiterProfile')
  >('@/hooks/opportunities/useRecruiterProfile');
  return {
    ...actual,
    useRecruiterProfile: vi.fn(),
  };
});

vi.mock('@/hooks/opportunities/useRecruiterBilling', async () => {
  const actual = await vi.importActual<
    typeof import('@/hooks/opportunities/useRecruiterBilling')
  >('@/hooks/opportunities/useRecruiterBilling');
  return {
    ...actual,
    useRecruiterBilling: vi.fn(),
  };
});

vi.mock('@/hooks/opportunities/useRecruiterOpportunities', () => ({
  useRecruiterOpportunities: vi.fn(),
}));

vi.mock('@/hooks/opportunities/useOpportunityApplications', () => ({
  useOpportunityApplications: vi.fn(),
}));

vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: vi.fn(() => ({ intentRecruiter: true })),
}));

// The onboarding component imports supabase directly (for the resubmit
// RPC branch). Provide a minimal no-op stub so import evaluation succeeds.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: vi.fn(() => ({ select: vi.fn(), eq: vi.fn() })),
  },
}));

// The full billing panel isn't in scope for R1A.1 — stub it so the render
// tree is deterministic and light.
vi.mock('@/components/opportunities/RecruiterBillingPanel', () => ({
  RecruiterBillingPanel: () => (
    <div data-testid="stub-recruiter-billing-panel">billing panel stub</div>
  ),
}));

import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { useRecruiterBilling } from '@/hooks/opportunities/useRecruiterBilling';
import { useRecruiterOpportunities } from '@/hooks/opportunities/useRecruiterOpportunities';
import { useOpportunityApplications } from '@/hooks/opportunities/useOpportunityApplications';
import { RecruiterAccessPage } from '@/components/opportunities/recruiter/RecruiterAccessPage';
import { RecruiterOnboarding } from '@/components/opportunities/RecruiterOnboarding';

// ---------------------------------------------------------------------------
// Fixture helpers.
// ---------------------------------------------------------------------------
function makeProfile(overrides: Partial<RecruiterProfile> = {}): RecruiterProfile {
  return {
    id: 'rp-1',
    user_id: 'u-1',
    recruiter_name: 'Alice',
    company_name: 'Acme Freight',
    recruiter_email: 'alice@acme.example',
    recruiter_phone: null,
    company_website: null,
    company_phone: null,
    company_address: null,
    company_city: null,
    company_state: null,
    dot_number: '1234567',
    mc_number: null,
    hiring_states: [],
    equipment_types: [],
    driver_types_hired: [],
    status: 'active',
    verification_status: 'pending',
    posting_terms_accepted_at: '2026-07-17T00:00:00Z',
    posting_terms_version: '2026-07-17.v1',
    legacy_terms_grandfathered_at: null,
    admin_notes: null,
    verified_by: null,
    verified_at: null,
    created_at: '2026-07-17T00:00:00Z',
    updated_at: '2026-07-17T00:00:00Z',
    ...overrides,
  } as unknown as RecruiterProfile;
}


const incomplete = (overrides: Partial<RecruiterProfile> = {}) =>
  makeProfile({ company_name: '', ...overrides });

// ---------------------------------------------------------------------------
// Hook-mock installers.
// ---------------------------------------------------------------------------
type ProfileHook = ReturnType<typeof useRecruiterProfile>;
type BillingHook = ReturnType<typeof useRecruiterBilling>;

function installHooks({
  profile,
  isBillingActive = true,
}: {
  profile: RecruiterProfile | null;
  isBillingActive?: boolean;
}) {
  const isSuspended =
    !!profile &&
    (profile.status === 'suspended' ||
      profile.verification_status === 'suspended');

  vi.mocked(useRecruiterProfile).mockReturnValue({
    profile,
    isLoading: false,
    isApproved:
      !!profile &&
      profile.verification_status === 'approved' &&
      profile.status === 'active',
    isSuspended,
    canPost: false, // page uses canonical eligibility, not this field
    isVerified:
      !!profile &&
      profile.verification_status === 'approved' &&
      profile.status === 'active',
    isProfileComplete: false,
    upsertProfile: { mutate: vi.fn() },
    saveRecruiterProfile: { mutate: vi.fn(), isPending: false },
    approveRecruiter: { mutate: vi.fn() },
    rejectRecruiter: { mutate: vi.fn() },
    suspendRecruiter: { mutate: vi.fn() },
  } as unknown as ProfileHook);

  vi.mocked(useRecruiterBilling).mockReturnValue({
    isBillingActive,
    plan: 'none',
    status: isBillingActive ? 'active' : 'inactive',
    isLoading: false,
  } as unknown as BillingHook);

  vi.mocked(useRecruiterOpportunities).mockReturnValue({
    opportunities: [],
    isLoading: false,
  } as unknown as ReturnType<typeof useRecruiterOpportunities>);

  vi.mocked(useOpportunityApplications).mockReturnValue({
    recruiterApplications: [],
    isLoadingRecruiter: false,
  } as unknown as ReturnType<typeof useOpportunityApplications>);
}

// ---------------------------------------------------------------------------
// Real RecruiterAccessPage — trust badges + top Post button + tool cards.
// ---------------------------------------------------------------------------
describe('RecruiterAccessPage (production-mounted) — visible trust + real Post button', () => {
  const noop = vi.fn();

  function renderPage() {
    return render(
      <RecruiterAccessPage
        onBack={noop}
        onOpenOnboarding={noop}
        onManage={noop}
        onApplications={noop}
      />,
    );
  }

  function topPostButton() {
    // The real top-of-page action is a <Button> with text
    // "Post an Opportunity". Query by role+name so we're not selecting
    // a synthetic test-only surface.
    return screen.getByRole('button', { name: /Post an Opportunity/i });
  }

  function trustStatus() {
    return screen.getByTestId('recruiter-trust-status');
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('null profile → top Post disabled; setup/onboarding entry visible; no Verified badge', () => {
    installHooks({ profile: null });
    renderPage();
    expect(topPostButton()).toBeDisabled();
    // Real onboarding entry card (production) surfaces the CTA.
    expect(screen.getByTestId('finish-recruiter-setup-cta')).toBeInTheDocument();
    expect(screen.queryByTestId('recruiter-verified-badge')).toBeNull();
    expect(trustStatus().getAttribute('data-can-post')).toBe('false');
  });

  it.each([
    ['pending' as const, /Pending Verification/i],
    ['rejected' as const, /Verification Not Approved/i],
    ['approved' as const, /Verified/i],
  ])(
    'incomplete + %s → real top Post disabled, setup-required state visible, NO Verified Recruiter badge',
    (v, verifRegex) => {
      installHooks({ profile: incomplete({ verification_status: v }) });
      renderPage();
      expect(topPostButton()).toBeDisabled();
      // Real StateCard for incomplete surfaces the required-fields copy.
      expect(screen.getAllByText(/Finish your recruiter profile/i)[0]).toBeInTheDocument();
      // Trust badge exposes canonical state to the DOM.
      expect(trustStatus().getAttribute('data-state')).toBe('incomplete_profile');
      expect(
        within(trustStatus()).getByTestId('recruiter-verification-label'),
      ).toHaveTextContent(verifRegex);
      expect(screen.queryByTestId('recruiter-verified-badge')).toBeNull();
    },
  );

  it('complete + pending → top Post ENABLED, Pending Verification visible, no Verified badge, tool cards mounted', () => {
    installHooks({ profile: makeProfile({ verification_status: 'pending' }) });
    renderPage();
    expect(topPostButton()).not.toBeDisabled();
    expect(
      within(trustStatus()).getByTestId('recruiter-verification-label'),
    ).toHaveTextContent(/Pending Verification/i);
    expect(screen.queryByTestId('recruiter-verified-badge')).toBeNull();
    // Real production ToolCard grid is visible for eligible states.
    expect(screen.getByText('Your Recruiting Tools')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Create Post/i }),
    ).not.toBeDisabled();
  });

  it('complete + rejected → top Post ENABLED, Verification Not Approved visible, no Verified badge', () => {
    installHooks({ profile: makeProfile({ verification_status: 'rejected' }) });
    renderPage();
    expect(topPostButton()).not.toBeDisabled();
    expect(
      within(trustStatus()).getByTestId('recruiter-verification-label'),
    ).toHaveTextContent(/Verification Not Approved/i);
    expect(screen.queryByTestId('recruiter-verified-badge')).toBeNull();
  });

  it('complete + approved → top Post ENABLED and verification label reads Verified Recruiter (rendered once)', () => {
    installHooks({ profile: makeProfile({ verification_status: 'approved' }) });
    renderPage();
    expect(topPostButton()).not.toBeDisabled();
    // The duplicate `recruiter-verified-badge` affirmation was removed;
    // the verification label alone conveys the Verified Recruiter status.
    expect(screen.queryByTestId('recruiter-verified-badge')).toBeNull();
    const verificationLabel = within(trustStatus()).getByTestId('recruiter-verification-label');
    expect(verificationLabel).toHaveTextContent(/Verified Recruiter/);
    expect(trustStatus().getAttribute('data-verified')).toBe('true');
  });

  it('status=suspended → top Post disabled, suspended state visible, tool cards hidden', () => {
    installHooks({ profile: makeProfile({ status: 'suspended' }) });
    renderPage();
    expect(topPostButton()).toBeDisabled();
    expect(screen.getAllByText(/Recruiter Access Suspended/i)[0]).toBeInTheDocument();
    // Production hides the ToolsGrid outside of active_* states.
    expect(screen.queryByText('Your Recruiting Tools')).toBeNull();
  });

  it('verification_status=suspended → top Post disabled, suspended state visible', () => {
    installHooks({
      profile: makeProfile({ verification_status: 'suspended' as never }),
    });
    renderPage();
    expect(topPostButton()).toBeDisabled();
    expect(screen.getAllByText(/Recruiter Access Suspended/i)[0]).toBeInTheDocument();
    expect(screen.queryByText('Your Recruiting Tools')).toBeNull();
  });

  it('billing INACTIVE with complete eligible profile → top Post still ENABLED (billing does not gate posting)', () => {
    installHooks({
      profile: makeProfile({ verification_status: 'pending' }),
      isBillingActive: false,
    });
    renderPage();
    expect(topPostButton()).not.toBeDisabled();
    // Production still mounts the ToolsGrid for active_no_billing.
    expect(screen.getByText('Your Recruiting Tools')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Create Post/i }),
    ).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Real RecruiterOnboarding — the single status card mounted in production.
// ---------------------------------------------------------------------------
describe('RecruiterOnboarding (production-mounted) — canonical status card', () => {
  const noop = vi.fn();

  function renderOnboarding() {
    return render(<RecruiterOnboarding onBack={noop} />);
  }

  function statusCard() {
    return screen.getByTestId('recruiter-onboarding-status');
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['pending' as const],
    ['rejected' as const],
    ['approved' as const],
  ])(
    'incomplete + %s → status card renders, NEVER says "Standard Posting Enabled" and NEVER shows Verified badge',
    (v) => {
      installHooks({ profile: incomplete({ verification_status: v }) });
      renderOnboarding();
      const card = statusCard();
      expect(card.getAttribute('data-can-post')).toBe('false');
      expect(within(card).queryByText(/Standard Posting Enabled/)).toBeNull();
      expect(within(card).queryByTestId('onboarding-verified-badge')).toBeNull();
      expect(
        within(card).getByTestId('onboarding-status-body'),
      ).toHaveTextContent(/Standard posting is not enabled yet/i);
    },
  );

  it('complete + pending → posting enabled, Pending Verification, no Verified badge', () => {
    installHooks({ profile: makeProfile({ verification_status: 'pending' }) });
    renderOnboarding();
    const card = statusCard();
    expect(card.getAttribute('data-can-post')).toBe('true');
    expect(
      within(card).getByTestId('onboarding-status-title'),
    ).toHaveTextContent(/^Standard Posting Enabled$/);
    expect(
      within(card).getByTestId('onboarding-verification-label'),
    ).toHaveTextContent(/Pending Verification/i);
    expect(within(card).queryByTestId('onboarding-verified-badge')).toBeNull();
  });

  it('complete + rejected → posting enabled, Verification Not Approved, "Unverified" badge, no Verified badge', () => {
    installHooks({ profile: makeProfile({ verification_status: 'rejected' }) });
    renderOnboarding();
    const card = statusCard();
    expect(card.getAttribute('data-can-post')).toBe('true');
    expect(
      within(card).getByTestId('onboarding-status-title'),
    ).toHaveTextContent(/Standard Posting Enabled — Verification Not Approved/);
    expect(
      within(card).getByTestId('onboarding-verification-label'),
    ).toHaveTextContent(/Unverified/);
    expect(within(card).queryByTestId('onboarding-verified-badge')).toBeNull();
  });

  it('complete + approved → posting enabled, Verified Recruiter badge visible', () => {
    installHooks({ profile: makeProfile({ verification_status: 'approved' }) });
    renderOnboarding();
    const card = statusCard();
    expect(card.getAttribute('data-can-post')).toBe('true');
    expect(card.getAttribute('data-verified')).toBe('true');
    expect(
      within(card).getByTestId('onboarding-status-title'),
    ).toHaveTextContent(/Verified Recruiter — Standard Posting Enabled/);
    expect(within(card).getByTestId('onboarding-verified-badge')).toBeInTheDocument();
  });

  it('status=suspended → Recruiter Access Suspended, no Verified badge', () => {
    installHooks({ profile: makeProfile({ status: 'suspended' }) });
    renderOnboarding();
    const card = statusCard();
    expect(card.getAttribute('data-can-post')).toBe('false');
    expect(
      within(card).getByTestId('onboarding-status-title'),
    ).toHaveTextContent(/Recruiter Access Suspended/);
    expect(within(card).queryByTestId('onboarding-verified-badge')).toBeNull();
  });

  it('verification_status=suspended → Recruiter Access Suspended', () => {
    installHooks({
      profile: makeProfile({ verification_status: 'suspended' as never }),
    });
    renderOnboarding();
    const card = statusCard();
    expect(card.getAttribute('data-can-post')).toBe('false');
    expect(
      within(card).getByTestId('onboarding-status-title'),
    ).toHaveTextContent(/Recruiter Access Suspended/);
  });
});

// ---------------------------------------------------------------------------
// Phase 1J-C2 additive rendered coverage — visible copy + posting behavior
// for the eight recruiter states, plus DOT/MC clarification and rejected
// resubmit CTA. Uses the same production mounts as the trust-state suite.
// ---------------------------------------------------------------------------
import { useUserRole } from '@/hooks/useUserRole';

const FORBIDDEN_PHRASES: RegExp[] = [
  /Apply for Recruiter Access/i,
  /Start Application/i,
  /submit your recruiter profile for review/i,
  /before approval/i,
];

function expectNoForbidden(container: HTMLElement) {
  const text = container.textContent ?? '';
  for (const re of FORBIDDEN_PHRASES) {
    expect(text, `forbidden phrase ${re} found in rendered DOM`).not.toMatch(re);
  }
}

describe('Phase 1J-C2 — RecruiterAccessPage rendered copy (production-mounted)', () => {
  const noop = vi.fn();
  function renderPage() {
    return render(
      <RecruiterAccessPage
        onBack={noop}
        onOpenOnboarding={noop}
        onManage={noop}
        onApplications={noop}
      />,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useUserRole).mockReturnValue({ intentRecruiter: true } as never);
  });

  it('missing profile + NO recruiter intent → shows "Add Recruiter Workspace" and "Set Up Recruiter Profile"', () => {
    vi.mocked(useUserRole).mockReturnValue({ intentRecruiter: false } as never);
    installHooks({ profile: null });
    const { container } = renderPage();
    expect(screen.getByRole('heading', { name: /Add Recruiter Workspace/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Set Up Recruiter Profile/ }),
    ).toBeInTheDocument();
    // Setup copy uses completion language, not application/review-gate language.
    expect(container.textContent).toMatch(
      /Add the recruiter workspace to your account\. Standard posting unlocks as soon as your profile is complete — no admin approval or paid plan is required\./,
    );
    expect(container.textContent).not.toMatch(
      /Add recruiter as an additional workspace on your account\. Standard posting unlocks as soon as your profile is complete — no admin approval needed to post\./,
    );
    expectNoForbidden(container);
  });

  it('missing profile + recruiter intent → uses completion language ("not complete yet") and Finish Recruiter Setup CTA', () => {
    installHooks({ profile: null });
    const { container } = renderPage();
    expect(container.textContent).toMatch(/profile is not complete yet/i);
    expect(container.textContent).not.toMatch(/not submitted yet/i);
    expect(
      screen.getByRole('button', { name: /Finish Recruiter Setup/ }),
    ).toBeInTheDocument();
    expectNoForbidden(container);
  });

  it('incomplete profile → mentions DOT or MC and posting terms; top Post disabled', () => {
    installHooks({ profile: incomplete({ verification_status: 'pending' }) });
    const { container } = renderPage();
    expect(container.textContent).toMatch(/DOT or MC/);
    expect(container.textContent).toMatch(/posting terms/i);
    expect(screen.getByRole('button', { name: /Post an Opportunity/i })).toBeDisabled();
    expectNoForbidden(container);
  });

  it('complete + pending → Post enabled and badge review pending language visible', () => {
    installHooks({ profile: makeProfile({ verification_status: 'pending' }) });
    const { container } = renderPage();
    expect(screen.getByRole('button', { name: /Post an Opportunity/i })).not.toBeDisabled();
    expect(
      within(screen.getByTestId('recruiter-trust-status')).getByTestId(
        'recruiter-verification-label',
      ),
    ).toHaveTextContent(/Pending Verification/i);
    expectNoForbidden(container);
  });

  it('complete + rejected → Post enabled, badge-not-approved language, resubmission available while posting stays enabled', () => {
    installHooks({ profile: makeProfile({ verification_status: 'rejected' }) });
    const { container } = renderPage();
    expect(screen.getByRole('button', { name: /Post an Opportunity/i })).not.toBeDisabled();
    expect(
      within(screen.getByTestId('recruiter-trust-status')).getByTestId(
        'recruiter-verification-label',
      ),
    ).toHaveTextContent(/Verification Not Approved/i);
    expectNoForbidden(container);
  });

  it('complete + approved → Post enabled and Verified Recruiter visible', () => {
    installHooks({ profile: makeProfile({ verification_status: 'approved' }) });
    const { container } = renderPage();
    expect(screen.getByRole('button', { name: /Post an Opportunity/i })).not.toBeDisabled();
    expect(container.textContent).toMatch(/Verified Recruiter/);
    expectNoForbidden(container);
  });

  it('suspended → Post disabled', () => {
    installHooks({ profile: makeProfile({ status: 'suspended' }) });
    const { container } = renderPage();
    expect(screen.getByRole('button', { name: /Post an Opportunity/i })).toBeDisabled();
    expectNoForbidden(container);
  });

  it('billing ACTIVE vs INACTIVE → posting parity for eligible profile', () => {
    installHooks({ profile: makeProfile({ verification_status: 'pending' }), isBillingActive: true });
    renderPage();
    expect(screen.getByRole('button', { name: /Post an Opportunity/i })).not.toBeDisabled();
    // remount in inactive state
    cleanup();
    vi.clearAllMocks();
    vi.mocked(useUserRole).mockReturnValue({ intentRecruiter: true } as never);
    installHooks({ profile: makeProfile({ verification_status: 'pending' }), isBillingActive: false });
    renderPage();
    expect(screen.getByRole('button', { name: /Post an Opportunity/i })).not.toBeDisabled();
  });
});

describe('Phase 1J-C2 — RecruiterOnboarding rendered copy (production-mounted)', () => {
  const noop = vi.fn();
  function renderOnboarding() {
    return render(<RecruiterOnboarding onBack={noop} />);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useUserRole).mockReturnValue({ intentRecruiter: true } as never);
  });

  it('form contains the corrected DOT/MC clarification sentence', () => {
    installHooks({ profile: null });
    const { container } = renderOnboarding();
    expect(container.textContent).toMatch(
      /Provide at least one DOT or MC number\. It is required to complete your recruiter profile and is also used for Verified Recruiter badge review\. Standard posting unlocks when the required profile and posting terms are complete; badge approval is separate\./,
    );
    expectNoForbidden(container);
  });

  it('rejected profile → shows "Resubmit for Badge Review" button', () => {
    installHooks({ profile: makeProfile({ verification_status: 'rejected' }) });
    const { container } = renderOnboarding();
    expect(
      screen.getByRole('button', { name: /Resubmit for Badge Review/i }),
    ).toBeInTheDocument();
    expectNoForbidden(container);
  });
});
