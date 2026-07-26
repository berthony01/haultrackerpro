/**
 * Phase 1P-A4 — Legacy recruiter inline readiness repair dialog.
 *
 * Proves the RecruiterReadinessDialog contract:
 *   - Exact title, canonical ordered missing labels.
 *   - Only currently-missing controls render.
 *   - Carrier reveals DOT/MC; every other company type removes the
 *     authority blocker.
 *   - Missing terms renders exactly three unchecked agreements and Save
 *     is disabled until all three are checked.
 *   - Terms-missing flow uses `saveRecruiterProfile` (RPC-stamped consent).
 *   - Accepted/grandfathered flow uses `upsertProfile` (no consent restamp).
 *   - Ready refetch invokes `onReady` once and closes.
 *   - Still-incomplete refetch keeps the dialog open with the canonical reason.
 *   - Safe error formatter surfaces underlying `Error.cause.message`.
 *   - Cancel and suspended never mutate or continue.
 *   - Verified approval does NOT bypass missing readiness requirements.
 *   - Client payload NEVER includes protected consent columns.
 *   - Mobile-safe scrollable DialogContent contract.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecruiterProfile } from '@/lib/opportunities/recruiterEligibility';

// ---- mock useRecruiterProfile ---------------------------------------------

type UpsertPayload = Record<string, unknown>;

const mocks = {
  profile: null as RecruiterProfile | null,
  refetchProfile: vi.fn(),
  upsertProfileFn: vi.fn(),
  saveRecruiterProfileFn: vi.fn(),
};

vi.mock('@/hooks/opportunities/useRecruiterProfile', async () => {
  const actual = await vi.importActual<
    typeof import('@/hooks/opportunities/useRecruiterProfile')
  >('@/hooks/opportunities/useRecruiterProfile');
  return {
    ...actual,
    useRecruiterProfile: () => ({
      profile: mocks.profile,
      isLoading: false,
      refetchProfile: mocks.refetchProfile,
      upsertProfile: { mutateAsync: mocks.upsertProfileFn, isPending: false },
      saveRecruiterProfile: {
        mutateAsync: mocks.saveRecruiterProfileFn,
        isPending: false,
      },
    }),
  };
});

// Import AFTER mock is registered.
import { RecruiterReadinessDialog } from '@/components/opportunities/RecruiterReadinessDialog';
import {
  DIALOG_MISSING_LABELS,
  RECRUITER_AGREEMENT_STATEMENTS,
} from '@/lib/opportunities/resolveRecruiterReadiness';

// ---- helpers ---------------------------------------------------------------

const CANONICAL_LABELS = [
  DIALOG_MISSING_LABELS.recruiter_name,
  DIALOG_MISSING_LABELS.company_name,
  DIALOG_MISSING_LABELS.recruiter_email_missing,
  DIALOG_MISSING_LABELS.company_type,
  DIALOG_MISSING_LABELS.posting_terms,
];

function baseProfile(overrides: Partial<RecruiterProfile> = {}): RecruiterProfile {
  return {
    id: 'rp-1',
    user_id: 'u-1',
    recruiter_name: '',
    company_name: '',
    recruiter_email: null,
    recruiter_phone: null,
    company_website: null,
    company_phone: null,
    company_address: null,
    company_city: null,
    company_state: null,
    dot_number: null,
    mc_number: null,
    hiring_states: [],
    equipment_types: [],
    driver_types_hired: [],
    status: 'active',
    verification_status: 'pending',
    posting_terms_accepted_at: null,
    posting_terms_version: null,
    legacy_terms_grandfathered_at: null,
    admin_notes: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    verified_at: null,
    verified_by: null,
    ...overrides,
  } as RecruiterProfile;
}

function readyProfile(overrides: Partial<RecruiterProfile> = {}): RecruiterProfile {
  return baseProfile({
    recruiter_name: 'Jane R',
    company_name: 'Acme Co',
    recruiter_email: 'jane@acme.co',
    dot_number: '1234567',
    posting_terms_accepted_at: '2024-06-01T00:00:00Z',
    posting_terms_version: 'v1',
    ...overrides,
    // company_type is not in the typed row but stored on the profile.
  }) as RecruiterProfile & { company_type: string };
}

function withCompanyType(
  p: RecruiterProfile,
  t: 'carrier' | 'third_party_recruiter' | 'staffing_agency' | 'independent_recruiter' | null,
): RecruiterProfile {
  return { ...(p as unknown as Record<string, unknown>), company_type: t } as unknown as RecruiterProfile;
}

function renderDialog(props: Partial<React.ComponentProps<typeof RecruiterReadinessDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onReady = vi.fn();
  render(
    <RecruiterReadinessDialog
      open
      onOpenChange={onOpenChange}
      onReady={onReady}
      actionLabel="Post an Opportunity"
      {...props}
    />,
  );
  return { onOpenChange, onReady };
}

// ---- tests -----------------------------------------------------------------

describe('Phase 1P-A4 — Legacy recruiter inline readiness dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile = withCompanyType(baseProfile(), null);
    mocks.refetchProfile.mockResolvedValue(mocks.profile);
    mocks.upsertProfileFn.mockResolvedValue(undefined);
    mocks.saveRecruiterProfileFn.mockResolvedValue(undefined);
    // jsdom lacks pointer-capture APIs that Radix Select touches.
    if (!(Element.prototype as unknown as { hasPointerCapture?: unknown }).hasPointerCapture) {
      (Element.prototype as unknown as Record<string, unknown>).hasPointerCapture = () => false;
      (Element.prototype as unknown as Record<string, unknown>).releasePointerCapture = () => {};
      (Element.prototype as unknown as Record<string, unknown>).setPointerCapture = () => {};
      (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
    }
  });

  it('renders locked title and canonical ordered missing labels for a fully-empty legacy profile', () => {
    renderDialog();
    expect(screen.getByTestId('readiness-dialog-title')).toHaveTextContent(
      /^Complete Your Recruiter Setup$/,
    );
    const summary = screen.getByTestId('readiness-missing-summary').textContent ?? '';
    // Canonical order preserved (recruiter_email_missing before company_type before dot_or_mc before posting_terms).
    const positions = CANONICAL_LABELS.map((l) => summary.indexOf(l));
    positions.forEach((p) => expect(p).toBeGreaterThanOrEqual(0));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it('renders only the missing controls (not the already-satisfied ones)', () => {
    mocks.profile = withCompanyType(
      baseProfile({
        recruiter_name: 'Jane',
        company_name: 'Acme',
        recruiter_email: 'jane@acme.co',
      }),
      null,
    );
    renderDialog();
    expect(screen.queryByTestId('rr-recruiter-name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rr-company-name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rr-recruiter-email')).not.toBeInTheDocument();
    expect(screen.getByTestId('rr-company-type')).toBeInTheDocument();
  });

  it('selecting carrier reveals DOT/MC and other types remove the authority blocker', async () => {
    const user = userEvent.setup();
    mocks.profile = withCompanyType(
      baseProfile({
        recruiter_name: 'Jane',
        company_name: 'Acme',
        recruiter_email: 'jane@acme.co',
        posting_terms_accepted_at: '2024-06-01T00:00:00Z',
        posting_terms_version: 'v1',
      }),
      null,
    );
    renderDialog();

    // No DOT/MC fields until a type is chosen.
    expect(screen.queryByTestId('rr-dot-number')).not.toBeInTheDocument();

    // Pick Carrier via the Radix Select trigger.
    await user.click(screen.getByTestId('rr-company-type'));
    await user.click(await screen.findByRole('option', { name: /Motor Carrier|Carrier/i }));
    expect(await screen.findByTestId('rr-dot-number')).toBeInTheDocument();
    expect(screen.getByTestId('rr-mc-number')).toBeInTheDocument();

    // Switch to a non-carrier type -> DOT/MC block disappears.
    await user.click(screen.getByTestId('rr-company-type'));
    await user.click(await screen.findByRole('option', { name: /Staffing Agency/i }));
    expect(screen.queryByTestId('rr-dot-number')).not.toBeInTheDocument();
  });

  it('renders exactly three unchecked agreements when terms are missing and Save is disabled until all checked', async () => {
    const user = userEvent.setup();
    renderDialog();
    RECRUITER_AGREEMENT_STATEMENTS.forEach((t) =>
      expect(screen.getByText(t)).toBeInTheDocument(),
    );
    expect(screen.getByTestId('readiness-dialog-primary')).toBeDisabled();
    await user.click(screen.getByTestId('rr-agree-1'));
    await user.click(screen.getByTestId('rr-agree-2'));
    expect(screen.getByTestId('readiness-dialog-primary')).toBeDisabled();
    await user.click(screen.getByTestId('rr-agree-3'));
    expect(screen.getByTestId('readiness-dialog-primary')).not.toBeDisabled();
  });

  it('terms-missing save flow calls saveRecruiterProfile (secure RPC path) and never sends protected consent columns', async () => {
    const user = userEvent.setup();
    mocks.profile = withCompanyType(
      readyProfile({ posting_terms_accepted_at: null, posting_terms_version: null }),
      'carrier',
    );
    // After save the refetched profile becomes ready.
    mocks.refetchProfile.mockResolvedValue(
      withCompanyType(readyProfile(), 'carrier'),
    );
    const { onReady } = renderDialog();

    await user.click(screen.getByTestId('rr-agree-1'));
    await user.click(screen.getByTestId('rr-agree-2'));
    await user.click(screen.getByTestId('rr-agree-3'));
    await user.click(screen.getByTestId('readiness-dialog-primary'));

    await waitFor(() => expect(mocks.saveRecruiterProfileFn).toHaveBeenCalledTimes(1));
    expect(mocks.upsertProfileFn).not.toHaveBeenCalled();
    const payload = mocks.saveRecruiterProfileFn.mock.calls[0][0];
    // Payload must NEVER include consent/grandfathering columns.
    expect(payload).not.toHaveProperty('posting_terms_accepted_at');
    expect(payload).not.toHaveProperty('posting_terms_version');
    expect(payload).not.toHaveProperty('legacy_terms_grandfathered_at');
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('accepted/grandfathered terms use upsertProfile (no consent restamp)', async () => {
    const user = userEvent.setup();
    mocks.profile = withCompanyType(
      readyProfile({ company_name: '' }), // missing only company_name
      'carrier',
    );
    mocks.refetchProfile.mockResolvedValue(
      withCompanyType(readyProfile(), 'carrier'),
    );
    const { onReady } = renderDialog();

    await user.type(screen.getByTestId('rr-company-name'), 'Acme Freight');
    await user.click(screen.getByTestId('readiness-dialog-primary'));

    await waitFor(() => expect(mocks.upsertProfileFn).toHaveBeenCalledTimes(1));
    expect(mocks.saveRecruiterProfileFn).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('ready refetch invokes onReady exactly once and closes the dialog', async () => {
    const user = userEvent.setup();
    mocks.profile = withCompanyType(readyProfile({ company_name: '' }), 'carrier');
    mocks.refetchProfile.mockResolvedValue(
      withCompanyType(readyProfile(), 'carrier'),
    );
    const { onReady, onOpenChange } = renderDialog();
    await user.type(screen.getByTestId('rr-company-name'), 'Acme');
    await user.click(screen.getByTestId('readiness-dialog-primary'));
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('still-incomplete refetch keeps the dialog open with the canonical reason surfaced', async () => {
    const user = userEvent.setup();
    mocks.profile = withCompanyType(readyProfile({ company_name: '' }), 'carrier');
    // Refetch still missing company_name — dialog must stay open.
    mocks.refetchProfile.mockResolvedValue(
      withCompanyType(readyProfile({ company_name: '' }), 'carrier'),
    );
    const { onReady } = renderDialog();
    await user.type(screen.getByTestId('rr-company-name'), 'Acme');
    await user.click(screen.getByTestId('readiness-dialog-primary'));
    await waitFor(() => expect(screen.getByTestId('readiness-error')).toBeInTheDocument());
    expect(onReady).not.toHaveBeenCalled();
  });

  it('safe error formatter surfaces the true underlying reason (Error.cause.message)', async () => {
    const user = userEvent.setup();
    mocks.profile = withCompanyType(readyProfile({ company_name: '' }), 'carrier');
    const err = new Error('Wrapper message');
    (err as Error & { cause?: unknown }).cause = { message: 'RLS blocked update' };
    mocks.upsertProfileFn.mockRejectedValueOnce(err);
    renderDialog();
    await user.type(screen.getByTestId('rr-company-name'), 'Acme');
    await user.click(screen.getByTestId('readiness-dialog-primary'));
    await waitFor(() =>
      expect(screen.getByTestId('readiness-error')).toHaveTextContent(
        'RLS blocked update',
      ),
    );
  });

  it('Cancel closes the dialog and performs no mutation or continuation', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onReady } = renderDialog();
    await user.click(screen.getByTestId('readiness-dialog-close'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.upsertProfileFn).not.toHaveBeenCalled();
    expect(mocks.saveRecruiterProfileFn).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });

  it('suspended profile: shows suspension reason and hides the save button', () => {
    mocks.profile = withCompanyType(baseProfile({ status: 'suspended' }), null);
    renderDialog();
    expect(screen.getByTestId('readiness-suspended-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('readiness-dialog-primary')).not.toBeInTheDocument();
  });

  it('verified approval does NOT bypass missing readiness (still shows the checklist)', () => {
    mocks.profile = withCompanyType(
      baseProfile({ verification_status: 'approved' }),
      null,
    );
    renderDialog();
    // Still incomplete — checklist must render.
    expect(screen.getByTestId('readiness-missing-list')).toBeInTheDocument();
    expect(screen.getByTestId('readiness-dialog-primary')).toBeInTheDocument();
  });

  it('DialogContent contract: scrollable + non-horizontally-overflowing (mobile-safe)', () => {
    renderDialog();
    const content = screen.getByTestId('recruiter-readiness-dialog');
    expect(content.className).toMatch(/overflow-y-auto/);
    expect(content.className).toMatch(/overflow-x-hidden/);
  });
});
