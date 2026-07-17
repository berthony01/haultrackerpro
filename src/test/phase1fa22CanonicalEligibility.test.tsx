// Phase 1F-A.2.2 — RecruiterAccessPage / RecruiterOnboarding canonical
// eligibility behavior + source-integrity tests.
//
// Behavior tests render each component through jsdom with mocked hooks
// and assert the copy/enabled-state matrix required by the phase spec.
// Source-integrity tests fail if either component reintroduces a local
// three-field completeness rule instead of using describeRecruiterEligibility.

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { RecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

// ---------------------------------------------------------------------------
// Hook mocks — mutable state so each test can drive the eligibility matrix.
// ---------------------------------------------------------------------------
const hoisted = vi.hoisted(() => {
  return {
    state: {
      profile: null as RecruiterProfile | null,
      isBillingActive: false,
      intentRecruiter: false,
    },
  };
});

vi.mock('@/hooks/opportunities/useRecruiterProfile', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/hooks/opportunities/useRecruiterProfile')
  >();
  return {
    ...actual,
    useRecruiterProfile: () => ({
      profile: hoisted.state.profile,
      isLoading: false,
      isApproved:
        !!hoisted.state.profile &&
        hoisted.state.profile.verification_status === 'approved' &&
        hoisted.state.profile.status === 'active',
      isSuspended:
        !!hoisted.state.profile &&
        (hoisted.state.profile.status === 'suspended' ||
          hoisted.state.profile.verification_status === 'suspended'),
      isVerified:
        !!hoisted.state.profile &&
        hoisted.state.profile.verification_status === 'approved' &&
        hoisted.state.profile.status === 'active',
      isProfileComplete: false,
      canPost: false,
      upsertProfile: { mutate: vi.fn(), isPending: false },
      saveRecruiterProfile: { mutate: vi.fn(), isPending: false },
      approveRecruiter: { mutate: vi.fn() },
      rejectRecruiter: { mutate: vi.fn() },
      suspendRecruiter: { mutate: vi.fn() },
    }),
  };
});

vi.mock('@/hooks/opportunities/useRecruiterBilling', () => ({
  useRecruiterBilling: () => ({
    isBillingActive: hoisted.state.isBillingActive,
    plan: 'free' as const,
    status: 'inactive',
    isLoading: false,
  }),
  RECRUITER_PLAN_LABELS: { free: 'Free', starter: 'Starter', growth: 'Growth', fleet: 'Fleet' },
}));

vi.mock('@/hooks/opportunities/useRecruiterOpportunities', () => ({
  useRecruiterOpportunities: () => ({ opportunities: [], isLoading: false }),
}));

vi.mock('@/hooks/opportunities/useOpportunityApplications', () => ({
  useOpportunityApplications: () => ({ recruiterApplications: [], isLoadingRecruiter: false }),
}));

vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({ intentRecruiter: hoisted.state.intentRecruiter }),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }));
vi.mock('@/hooks/useAdmin', () => ({ useAdmin: () => ({ isAdmin: false }) }));

// Neutralize the billing panel — it pulls in query client etc. we don't need.
vi.mock('../RecruiterBillingPanel', () => ({ RecruiterBillingPanel: () => null }));
vi.mock('@/components/opportunities/RecruiterBillingPanel', () => ({
  RecruiterBillingPanel: () => null,
}));

// Import AFTER mocks so the components pick up the mocked hooks.
import { RecruiterAccessPage } from '@/components/opportunities/recruiter/RecruiterAccessPage';
import { RecruiterOnboarding } from '@/components/opportunities/RecruiterOnboarding';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeProfile(overrides: Partial<RecruiterProfile> = {}): RecruiterProfile {
  return {
    id: 'rp-1',
    user_id: 'u-1',
    recruiter_name: 'Alice',
    company_name: 'Acme',
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
    verified_at: null,
    verified_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as unknown as RecruiterProfile;
}

function reset() {
  hoisted.state.profile = null;
  hoisted.state.isBillingActive = false;
  hoisted.state.intentRecruiter = false;
  cleanup();
}

// ---------------------------------------------------------------------------
// RecruiterAccessPage — post/manage/requests enablement matrix
// ---------------------------------------------------------------------------
const noop = () => undefined;
function renderAccess() {
  render(
    <RecruiterAccessPage
      onBack={noop}
      onOpenOnboarding={noop}
      onManage={noop}
      onApplications={noop}
    />,
  );
}

function getPostButton(): HTMLButtonElement {
  const buttons = screen.getAllByRole('button', { name: /post an opportunity/i });
  return buttons[0] as HTMLButtonElement;
}

describe('RecruiterAccessPage — canonical posting matrix', () => {
  beforeEach(reset);

  it('incomplete + pending → post disabled + explicit requirements copy', () => {
    hoisted.state.profile = makeProfile({
      company_name: '',
      verification_status: 'pending',
    });
    renderAccess();
    expect(getPostButton()).toBeDisabled();
    expect(screen.getAllByText(/DOT or MC/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/posting terms/i).length).toBeGreaterThan(0);
  });

  it('incomplete + rejected → post disabled', () => {
    hoisted.state.profile = makeProfile({
      company_name: '',
      verification_status: 'rejected',
    });
    renderAccess();
    expect(getPostButton()).toBeDisabled();
  });

  it('incomplete + approved → post disabled (verification does not override completeness)', () => {
    hoisted.state.profile = makeProfile({
      company_name: '',
      verification_status: 'approved',
    });
    renderAccess();
    expect(getPostButton()).toBeDisabled();
  });

  it('complete + pending → post enabled, no Verified state', () => {
    hoisted.state.profile = makeProfile({ verification_status: 'pending' });
    renderAccess();
    expect(getPostButton()).not.toBeDisabled();
    expect(screen.queryByText(/^Verified$/)).toBeNull();
  });

  it('complete + rejected + not suspended → post enabled, no Verified state', () => {
    hoisted.state.profile = makeProfile({ verification_status: 'rejected' });
    renderAccess();
    expect(getPostButton()).not.toBeDisabled();
    expect(screen.queryByText(/^Verified$/)).toBeNull();
  });

  it('complete + approved → post enabled', () => {
    hoisted.state.profile = makeProfile({ verification_status: 'approved' });
    renderAccess();
    expect(getPostButton()).not.toBeDisabled();
  });

  it('status suspended → post disabled', () => {
    hoisted.state.profile = makeProfile({ status: 'suspended' });
    renderAccess();
    expect(getPostButton()).toBeDisabled();
  });

  it('verification suspended → post disabled', () => {
    hoisted.state.profile = makeProfile({ verification_status: 'suspended' });
    renderAccess();
    expect(getPostButton()).toBeDisabled();
  });

  it('billing never gates posting when profile complete', () => {
    hoisted.state.profile = makeProfile({ verification_status: 'pending' });
    hoisted.state.isBillingActive = false;
    renderAccess();
    expect(getPostButton()).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// RecruiterOnboarding — status card copy matrix
// ---------------------------------------------------------------------------
function renderOnboarding() {
  render(<RecruiterOnboarding onBack={noop} />);
}

describe('RecruiterOnboarding — status card matrix', () => {
  beforeEach(reset);

  it('incomplete + pending → does NOT say posting is enabled', () => {
    hoisted.state.profile = makeProfile({
      company_name: '',
      verification_status: 'pending',
    });
    renderOnboarding();
    expect(screen.getByText(/Finish your recruiter profile/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Standard Posting Enabled$/i)).toBeNull();
  });

  it('incomplete + rejected → does NOT say posting is enabled', () => {
    hoisted.state.profile = makeProfile({
      company_name: '',
      verification_status: 'rejected',
    });
    renderOnboarding();
    expect(screen.getByText(/Finish your recruiter profile/i)).toBeInTheDocument();
  });

  it('incomplete + approved → does NOT say posting is enabled', () => {
    hoisted.state.profile = makeProfile({
      company_name: '',
      verification_status: 'approved',
    });
    renderOnboarding();
    expect(screen.getByText(/Finish your recruiter profile/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Verified Recruiter — Standard Posting Enabled$/i)).toBeNull();
  });

  it('complete + pending → shows Standard Posting Enabled + Pending Verification', () => {
    hoisted.state.profile = makeProfile({ verification_status: 'pending' });
    renderOnboarding();
    expect(screen.getByText(/^Standard Posting Enabled$/i)).toBeInTheDocument();
    expect(screen.getByText(/Pending Verification/i)).toBeInTheDocument();
  });

  it('complete + rejected → Standard Posting Enabled + Unverified', () => {
    hoisted.state.profile = makeProfile({ verification_status: 'rejected' });
    renderOnboarding();
    expect(
      screen.getByText(/Standard Posting Enabled — Verification Not Approved/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Unverified$/i)).toBeInTheDocument();
  });

  it('complete + approved → Verified Recruiter badge + posting enabled', () => {
    hoisted.state.profile = makeProfile({ verification_status: 'approved' });
    renderOnboarding();
    expect(
      screen.getByText(/Verified Recruiter — Standard Posting Enabled/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Verified$/i)).toBeInTheDocument();
  });

  it('suspended (status) → Access Suspended, no posting-enabled copy', () => {
    hoisted.state.profile = makeProfile({ status: 'suspended' });
    renderOnboarding();
    expect(screen.getByText(/Recruiter Access Suspended/i)).toBeInTheDocument();
  });

  it('suspended (verification) → Access Suspended', () => {
    hoisted.state.profile = makeProfile({ verification_status: 'suspended' });
    renderOnboarding();
    expect(screen.getByText(/Recruiter Access Suspended/i)).toBeInTheDocument();
  });

  it('footer copy separates standard posting eligibility from verification review', () => {
    hoisted.state.profile = makeProfile({ verification_status: 'pending' });
    renderOnboarding();
    expect(
      screen.getByText(/standard posting eligibility.*Verified Recruiter/i, { selector: 'p' }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Source integrity — components MUST use canonical eligibility helpers.
// ---------------------------------------------------------------------------
describe('Source integrity — one canonical completeness rule', () => {
  const files = [
    'src/components/opportunities/recruiter/RecruiterAccessPage.tsx',
    'src/components/opportunities/RecruiterOnboarding.tsx',
  ];

  for (const rel of files) {
    const body = readFileSync(resolve(process.cwd(), rel), 'utf8');

    it(`${rel} imports canonical eligibility helpers`, () => {
      // Either the eligibility helper directly, or values re-exposed by the
      // useRecruiterProfile hook, are acceptable — but SOMETHING canonical
      // must be present.
      const usesHelper =
        body.includes('describeRecruiterEligibility') ||
        body.includes('isProfileCompleteForPosting') ||
        body.includes('hasAcceptedPostingTerms');
      expect(usesHelper, `${rel} must consume canonical eligibility`).toBe(true);
    });

    it(`${rel} contains no local three-field completeness check`, () => {
      // A local check would combine isNonEmpty over recruiter_name +
      // company_name + recruiter_email in the same file. Flag any such
      // shape so a future refactor can't silently reintroduce it.
      const hasIsNonEmpty = /function\s+isNonEmpty\b/.test(body);
      expect(hasIsNonEmpty, `${rel} must not redeclare isNonEmpty`).toBe(false);

      const nameAndCompany =
        /recruiter_name[\s\S]{0,120}company_name[\s\S]{0,120}recruiter_email/.test(body);
      const looksLikeLocalRule =
        nameAndCompany && /\.trim\(\)\.length|isNonEmpty\(/.test(body);
      expect(
        looksLikeLocalRule,
        `${rel} must not reimplement a name+company+email completeness rule`,
      ).toBe(false);
    });

    it(`${rel} does not gate posting on verification approval`, () => {
      // Forbidden shapes: gating logic that treats verification_status ===
      // 'approved' as a posting prerequisite. Reading the value for the
      // Verified badge is fine.
      const gatedByApproval =
        /(canPost|postDisabled|allowPost|eligible)[^;\n]{0,80}verification_status\s*===?\s*['"]approved['"]/.test(
          body,
        ) ||
        /verification_status\s*===?\s*['"]approved['"][^;\n]{0,80}(canPost|allowPost|eligible)/.test(
          body,
        );
      expect(gatedByApproval, `${rel} must not gate posting on approval`).toBe(false);
    });
  }
});
