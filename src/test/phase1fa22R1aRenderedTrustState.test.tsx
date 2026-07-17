// Phase 1F-A.2.2-R1A — rendered component behaviour tests.
//
// Renders the two exported presentation subcomponents used by both the
// real Recruiter Access page and the Recruiter onboarding view, and
// asserts the actual DOM: labels, badges, and enabled/disabled controls.
// Source-string tests remain supplemental — this file is the primary
// evidence that visible trust state matches canonical eligibility.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import {
  RecruiterTrustStatus,
  RecruiterAccessControls,
} from '@/components/opportunities/recruiter/RecruiterAccessPage';
import { RecruiterOnboardingStatusCard } from '@/components/opportunities/RecruiterOnboarding';
import type { RecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

// ---------------------------------------------------------------------------
// Fixture helpers — a complete, consented, non-suspended profile by default.
// ---------------------------------------------------------------------------
function makeProfile(overrides: Partial<RecruiterProfile> = {}): RecruiterProfile {
  return {
    id: 'rp-1',
    user_id: 'u-1',
    recruiter_name: 'Alice',
    company_name: 'Acme Freight',
    recruiter_email: 'alice@acme.example',
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
    ...overrides,
  } as unknown as RecruiterProfile;
}

const incomplete = (overrides: Partial<RecruiterProfile> = {}) =>
  makeProfile({ company_name: '', ...overrides });

// ---------------------------------------------------------------------------
// RecruiterAccessControls — full rendered matrix.
//
// Covers every row required by phase 1F-A.2.2-R1A section 2:
//   - incomplete pending / rejected / approved  → disabled + no Verified
//   - complete pending / rejected               → enabled + no Verified
//   - complete approved                         → enabled + Verified visible
//   - status='suspended'                        → disabled
//   - verification_status='suspended'           → disabled
//   - complete + billing inactive               → still enabled (billing
//                                                  does not gate posting)
// ---------------------------------------------------------------------------
describe('RecruiterAccessControls — visible trust state + enabled/disabled', () => {
  const noop = vi.fn();
  const controlIds = ['controls-post', 'controls-manage', 'controls-applications'];

  function renderControls(profile: RecruiterProfile | null, isBillingActive = true) {
    return render(
      <RecruiterAccessControls
        profile={profile}
        isBillingActive={isBillingActive}
        onPost={noop}
        onManage={noop}
        onApplications={noop}
      />,
    );
  }

  function expectDisabled() {
    for (const id of controlIds) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
  }

  function expectEnabled() {
    for (const id of controlIds) {
      expect(screen.getByTestId(id)).not.toBeDisabled();
    }
  }

  function expectNoVerifiedBadge() {
    expect(screen.queryByTestId('recruiter-verified-badge')).toBeNull();
  }

  it('missing profile → disabled + setup-required label + no Verified badge', () => {
    renderControls(null, false);
    expectDisabled();
    expect(screen.getByTestId('recruiter-posting-label')).toHaveTextContent(
      /Setup required/i,
    );
    expectNoVerifiedBadge();
  });

  it.each([
    ['pending', /Pending Verification/i],
    ['rejected', /Verification Not Approved/i],
    ['approved', /Verified/i],
  ] as const)(
    'incomplete + %s → disabled, standard posting NOT enabled, no Verified badge',
    (v, verificationRegex) => {
      renderControls(incomplete({ verification_status: v }), true);
      expectDisabled();
      expect(screen.getByTestId('recruiter-posting-label')).toHaveTextContent(
        /standard posting not enabled/i,
      );
      expect(screen.getByTestId('recruiter-verification-label')).toHaveTextContent(
        verificationRegex,
      );
      expectNoVerifiedBadge();
    },
  );

  it('complete + pending → enabled, "Standard posting enabled" + Pending Verification, no Verified badge', () => {
    renderControls(makeProfile({ verification_status: 'pending' }), true);
    expectEnabled();
    expect(screen.getByTestId('recruiter-posting-label')).toHaveTextContent(
      /^Standard posting enabled$/,
    );
    expect(screen.getByTestId('recruiter-verification-label')).toHaveTextContent(
      /Pending Verification/i,
    );
    expectNoVerifiedBadge();
  });

  it('complete + rejected → enabled, "Verification Not Approved" visible, no Verified badge', () => {
    renderControls(makeProfile({ verification_status: 'rejected' }), true);
    expectEnabled();
    expect(screen.getByTestId('recruiter-posting-label')).toHaveTextContent(
      /^Standard posting enabled$/,
    );
    expect(screen.getByTestId('recruiter-verification-label')).toHaveTextContent(
      /Verification Not Approved/i,
    );
    expectNoVerifiedBadge();
  });

  it('complete + approved → enabled AND visible "Verified Recruiter" badge', () => {
    renderControls(makeProfile({ verification_status: 'approved' }), true);
    expectEnabled();
    const verified = screen.getByTestId('recruiter-verified-badge');
    expect(verified).toBeInTheDocument();
    expect(verified).toHaveTextContent(/Verified Recruiter/);
    expect(screen.getByTestId('recruiter-verification-label')).toHaveTextContent(
      /Verified Recruiter/,
    );
  });

  it('status=suspended → disabled + Suspended verification label', () => {
    renderControls(makeProfile({ status: 'suspended' }), true);
    expectDisabled();
    expect(screen.getByTestId('recruiter-verification-label')).toHaveTextContent(
      /Suspended/i,
    );
    expectNoVerifiedBadge();
  });

  it('verification_status=suspended → disabled + Suspended', () => {
    renderControls(makeProfile({ verification_status: 'suspended' as never }), true);
    expectDisabled();
    expect(screen.getByTestId('recruiter-verification-label')).toHaveTextContent(
      /Suspended/i,
    );
    expectNoVerifiedBadge();
  });

  it('billing inactive with an eligible complete profile → still ENABLED (billing does not gate posting)', () => {
    renderControls(makeProfile({ verification_status: 'pending' }), false);
    expectEnabled();
  });
});

// ---------------------------------------------------------------------------
// RecruiterTrustStatus — data attributes lock the canonical state.
// ---------------------------------------------------------------------------
describe('RecruiterTrustStatus — canonical state exposure', () => {
  it.each([
    [null, { state: 'missing_profile', canPost: 'false', verified: 'false' }],
    [makeProfile({ verification_status: 'approved' }), { state: 'verified', canPost: 'true', verified: 'true' }],
    [makeProfile({ verification_status: 'pending' }), { state: 'active_unverified', canPost: 'true', verified: 'false' }],
    [makeProfile({ verification_status: 'rejected' }), { state: 'active_unverified', canPost: 'true', verified: 'false' }],
    [incomplete({ verification_status: 'pending' }), { state: 'incomplete_profile', canPost: 'false', verified: 'false' }],
    [makeProfile({ status: 'suspended' }), { state: 'suspended', canPost: 'false', verified: 'false' }],
  ] as const)('exposes canonical state via data-* attributes', (profile, expected) => {
    render(<RecruiterTrustStatus profile={profile as RecruiterProfile | null} />);
    const el = screen.getByTestId('recruiter-trust-status');
    expect(el.getAttribute('data-state')).toBe(expected.state);
    expect(el.getAttribute('data-can-post')).toBe(expected.canPost);
    expect(el.getAttribute('data-verified')).toBe(expected.verified);
  });
});

// ---------------------------------------------------------------------------
// RecruiterOnboardingStatusCard — full onboarding matrix.
// ---------------------------------------------------------------------------
describe('RecruiterOnboardingStatusCard — visible status matrix', () => {
  function renderCard(profile: RecruiterProfile | null) {
    render(<RecruiterOnboardingStatusCard profile={profile} />);
    return screen.getByTestId('recruiter-onboarding-status');
  }

  it.each([
    ['pending' as const],
    ['rejected' as const],
    ['approved' as const],
  ])('incomplete + %s → NEVER shows Standard Posting Enabled and NEVER Verified badge', (v) => {
    const el = renderCard(incomplete({ verification_status: v }));
    expect(el.getAttribute('data-can-post')).toBe('false');
    expect(within(el).queryByText(/Standard Posting Enabled/)).toBeNull();
    expect(within(el).queryByTestId('onboarding-verified-badge')).toBeNull();
    expect(within(el).getByTestId('onboarding-posting-label')).toHaveTextContent(
      /standard posting not enabled/i,
    );
  });

  it('complete + pending → posting enabled + pending review, no Verified badge', () => {
    const el = renderCard(makeProfile({ verification_status: 'pending' }));
    expect(el.getAttribute('data-can-post')).toBe('true');
    expect(within(el).getByText(/^Standard Posting Enabled$/)).toBeInTheDocument();
    expect(within(el).getByTestId('onboarding-verification-label')).toHaveTextContent(
      /Pending Verification/i,
    );
    expect(within(el).queryByTestId('onboarding-verified-badge')).toBeNull();
  });

  it('complete + rejected → posting enabled + Verification Not Approved, no Verified badge', () => {
    const el = renderCard(makeProfile({ verification_status: 'rejected' }));
    expect(el.getAttribute('data-can-post')).toBe('true');
    expect(
      within(el).getByText(/Standard Posting Enabled — Verification Not Approved/),
    ).toBeInTheDocument();
    expect(within(el).queryByTestId('onboarding-verified-badge')).toBeNull();
  });

  it('complete + approved → posting enabled + Verified Recruiter visible', () => {
    const el = renderCard(makeProfile({ verification_status: 'approved' }));
    expect(el.getAttribute('data-can-post')).toBe('true');
    expect(el.getAttribute('data-verified')).toBe('true');
    expect(
      within(el).getByText(/Verified Recruiter — Standard Posting Enabled/),
    ).toBeInTheDocument();
    expect(within(el).getByTestId('onboarding-verified-badge')).toBeInTheDocument();
  });

  it('status=suspended → blocked (Recruiter Access Suspended)', () => {
    const el = renderCard(makeProfile({ status: 'suspended' }));
    expect(el.getAttribute('data-can-post')).toBe('false');
    expect(within(el).getByText(/Recruiter Access Suspended/)).toBeInTheDocument();
    expect(within(el).queryByTestId('onboarding-verified-badge')).toBeNull();
  });

  it('verification_status=suspended → blocked', () => {
    const el = renderCard(makeProfile({ verification_status: 'suspended' as never }));
    expect(el.getAttribute('data-can-post')).toBe('false');
    expect(within(el).getByText(/Recruiter Access Suspended/)).toBeInTheDocument();
  });
});
