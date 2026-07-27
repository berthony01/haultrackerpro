/**
 * Phase 1Q-A — Recruiter onboarding referral-preference integration.
 *
 * Renders the real `RecruiterOnboarding` component. Only external hook
 * boundaries and the direct supabase client (used for the resubmit RPC
 * branch) are stubbed. The referral-settings hook is mocked at its
 * module boundary so we can observe exact save-decision calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import type { RecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

vi.mock('@/hooks/opportunities/useRecruiterProfile', async () => {
  const actual = await vi.importActual<
    typeof import('@/hooks/opportunities/useRecruiterProfile')
  >('@/hooks/opportunities/useRecruiterProfile');
  return { ...actual, useRecruiterProfile: vi.fn() };
});

vi.mock('@/hooks/opportunities/useRecruiterReferralSettings', async () => {
  const actual = await vi.importActual<
    typeof import('@/hooks/opportunities/useRecruiterReferralSettings')
  >('@/hooks/opportunities/useRecruiterReferralSettings');
  return { ...actual, useRecruiterReferralSettings: vi.fn() };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: vi.fn(() => ({ select: vi.fn(), eq: vi.fn(), delete: vi.fn() })),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { useRecruiterReferralSettings } from '@/hooks/opportunities/useRecruiterReferralSettings';
import { RecruiterOnboarding } from '@/components/opportunities/RecruiterOnboarding';
import { toast } from 'sonner';

type RefSettings = ReturnType<typeof useRecruiterReferralSettings>;

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
    company_type: 'carrier',
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

type ProfileMockOpts = {
  profile: RecruiterProfile | null;
  saveMock?: ReturnType<typeof vi.fn>;
  saveIsPending?: boolean;
  isSuspended?: boolean;
  refetchProfile?: ReturnType<typeof vi.fn>;
};

function installProfileHook(opts: ProfileMockOpts) {
  const saveMock =
    opts.saveMock ??
    vi.fn((_payload, cbs?: { onSuccess?: () => void | Promise<void> }) => {
      return cbs?.onSuccess?.();
    });
  const refetch =
    opts.refetchProfile ?? vi.fn(async () => opts.profile);
  vi.mocked(useRecruiterProfile).mockReturnValue({
    profile: opts.profile,
    isLoading: false,
    isApproved: false,
    isSuspended: !!opts.isSuspended,
    canPost: true,
    isVerified: false,
    isProfileComplete: true,
    upsertProfile: { mutate: vi.fn() },
    saveRecruiterProfile: { mutate: saveMock, isPending: !!opts.saveIsPending },
    approveRecruiter: { mutate: vi.fn() },
    rejectRecruiter: { mutate: vi.fn() },
    suspendRecruiter: { mutate: vi.fn() },
    refetchProfile: refetch,
  } as unknown as ReturnType<typeof useRecruiterProfile>);
  return { saveMock, refetch };
}

type RefMockOpts = {
  settings?: {
    referral_bonus_enabled: boolean;
    bonus_amount: number | null;
    payment_trigger: string | null;
    waiting_period_days: number | null;
    bonus_terms: string | null;
  } | null;
  isLoading?: boolean;
  saveDecisionImpl?: (args: unknown) => Promise<unknown>;
  saveDecisionIsPending?: boolean;
};

function installReferralHook(opts: RefMockOpts = {}) {
  const impl =
    opts.saveDecisionImpl ??
    vi.fn(async () => ({ decision: 'later' as const }));
  const mutateAsync = vi.fn(impl);
  vi.mocked(useRecruiterReferralSettings).mockReturnValue({
    settings: opts.settings ?? null,
    isLoading: !!opts.isLoading,
    isError: false,
    error: null,
    refetch: vi.fn(),
    upsert: { mutate: vi.fn(), isPending: false },
    saveDecision: {
      mutate: vi.fn(),
      mutateAsync,
      isPending: !!opts.saveDecisionIsPending,
    },
  } as unknown as RefSettings);
  return { mutateAsync };
}

async function submit() {
  const btn = await screen.findByTestId('recruiter-onboarding-submit');
  fireEvent.click(btn);
  return btn;
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe('Phase 1Q-A — Recruiter onboarding referral preference', () => {
  it('renders exact primary question, all three choices, defaults to Decide later when no settings row exists', () => {
    installProfileHook({ profile: makeProfile() });
    installReferralHook({ settings: null });
    render(<RecruiterOnboarding onBack={() => {}} />);

    expect(
      screen.getByText(
        'Are you willing to pay a driver for referring another driver who gets hired?',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Yes, I offer an external referral bonus'),
    ).toBeInTheDocument();
    expect(screen.getByText('No, not currently')).toBeInTheDocument();
    expect(screen.getByText("I'll decide later")).toBeInTheDocument();

    const later = screen.getByTestId('referral-decision-later') as HTMLInputElement;
    expect(later.getAttribute('data-state')).toBe('checked');
    expect(screen.queryByTestId('referral-details-panel')).not.toBeInTheDocument();
  });

  it('YES reveals detail controls; NO and Decide later hide them', async () => {
    installProfileHook({ profile: makeProfile() });
    installReferralHook({ settings: null });
    render(<RecruiterOnboarding onBack={() => {}} />);

    fireEvent.click(screen.getByTestId('referral-decision-yes'));
    expect(await screen.findByTestId('referral-details-panel')).toBeInTheDocument();
    expect(screen.getByLabelText(/Bonus amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Waiting period/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Referral bonus terms/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('referral-decision-no'));
    await waitFor(() =>
      expect(screen.queryByTestId('referral-details-panel')).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('referral-decision-later'));
    await waitFor(() =>
      expect(screen.queryByTestId('referral-details-panel')).not.toBeInTheDocument(),
    );
  });

  it('hydrates YES + saved details from an existing enabled settings row', async () => {
    installProfileHook({ profile: makeProfile() });
    installReferralHook({
      settings: {
        referral_bonus_enabled: true,
        bonus_amount: 500,
        payment_trigger: 'after_waiting_period',
        waiting_period_days: 30,
        bonus_terms: 'Paid after 30 days.',
      },
    });
    render(<RecruiterOnboarding onBack={() => {}} />);

    const yes = await screen.findByTestId('referral-decision-yes');
    await waitFor(() => expect(yes.getAttribute('data-state')).toBe('checked'));
    expect((screen.getByLabelText(/Bonus amount/i) as HTMLInputElement).value).toBe(
      '500',
    );
    expect(
      (screen.getByLabelText(/Waiting period/i) as HTMLInputElement).value,
    ).toBe('30');
    expect(
      (screen.getByLabelText(/Referral bonus terms/i) as HTMLTextAreaElement).value,
    ).toBe('Paid after 30 days.');
  });

  it('hydrates NO from an existing disabled settings row', async () => {
    installProfileHook({ profile: makeProfile() });
    installReferralHook({
      settings: {
        referral_bonus_enabled: false,
        bonus_amount: null,
        payment_trigger: null,
        waiting_period_days: null,
        bonus_terms: null,
      },
    });
    render(<RecruiterOnboarding onBack={() => {}} />);

    const no = await screen.findByTestId('referral-decision-no');
    await waitFor(() => expect(no.getAttribute('data-state')).toBe('checked'));
    expect(screen.queryByTestId('referral-details-panel')).not.toBeInTheDocument();
  });

  it('YES: saves profile first, refetches, then persists YES exactly once with expected payload', async () => {
    const freshProfile = makeProfile({ id: 'rp-fresh' });
    const { saveMock, refetch } = installProfileHook({
      profile: makeProfile(),
      refetchProfile: vi.fn(async () => freshProfile),
    });
    const { mutateAsync } = installReferralHook({ settings: null });

    render(<RecruiterOnboarding onBack={() => {}} />);

    fireEvent.click(screen.getByTestId('referral-decision-yes'));
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), {
      target: { value: '500' },
    });
    fireEvent.change(screen.getByLabelText(/Waiting period/i), {
      target: { value: '30' },
    });
    fireEvent.change(screen.getByLabelText(/Referral bonus terms/i), {
      target: { value: '$500 after 30 days.' },
    });

    await submit();

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    const call = mutateAsync.mock.calls[0][0] as {
      recruiterId: string;
      decision: string;
      details: {
        referral_bonus_enabled: boolean;
        bonus_amount: number | null;
        waiting_period_days: number | null;
        bonus_terms: string | null;
      };
    };
    expect(call.recruiterId).toBe('rp-fresh');
    expect(call.decision).toBe('yes');
    expect(call.details.referral_bonus_enabled).toBe(true);
    expect(call.details.bonus_amount).toBe(500);
    expect(call.details.waiting_period_days).toBe(30);
    expect(call.details.bonus_terms).toBe('$500 after 30 days.');

    // Save order: profile save call precedes referral save.
    const saveOrder = saveMock.mock.invocationCallOrder[0];
    const refOrder = mutateAsync.mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(refOrder);
  });

  it('NO: persists exactly once with enabled=false and all optional fields cleared', async () => {
    const { saveMock } = installProfileHook({ profile: makeProfile() });
    const { mutateAsync } = installReferralHook({ settings: null });

    render(<RecruiterOnboarding onBack={() => {}} />);
    fireEvent.click(screen.getByTestId('referral-decision-no'));
    await submit();

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    const call = mutateAsync.mock.calls[0][0] as {
      decision: string;
      details: {
        referral_bonus_enabled: boolean;
        bonus_amount: number | null;
        payment_trigger: string | null;
        waiting_period_days: number | null;
        bonus_terms: string | null;
      };
    };
    expect(call.decision).toBe('no');
    expect(call.details.referral_bonus_enabled).toBe(false);
    expect(call.details.bonus_amount).toBeNull();
    expect(call.details.payment_trigger).toBeNull();
    expect(call.details.waiting_period_days).toBeNull();
    expect(call.details.bonus_terms).toBeNull();
  });

  it('Decide later: invokes saveDecision with decision=later exactly once and does not upsert a false row', async () => {
    installProfileHook({ profile: makeProfile() });
    const { mutateAsync } = installReferralHook({ settings: null });

    render(<RecruiterOnboarding onBack={() => {}} />);
    await submit();

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const call = mutateAsync.mock.calls[0][0] as { decision: string };
    expect(call.decision).toBe('later');
  });

  it('Profile-save failure: performs zero referral mutation', async () => {
    const saveMock = vi.fn((_p, _cbs) => {
      // simulates a failed save that never calls onSuccess
    });
    installProfileHook({ profile: makeProfile(), saveMock });
    const { mutateAsync } = installReferralHook({ settings: null });

    render(<RecruiterOnboarding onBack={() => {}} />);
    await submit();

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('Referral-save failure after profile success: shows exact partial-save warning', async () => {
    installProfileHook({ profile: makeProfile() });
    const impl = vi.fn(async () => {
      throw new Error('boom');
    });
    installReferralHook({ settings: null, saveDecisionImpl: impl });

    render(<RecruiterOnboarding onBack={() => {}} />);
    fireEvent.click(screen.getByTestId('referral-decision-no'));
    await submit();

    await waitFor(() => expect(impl).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Recruiter profile saved, but your referral preference could not be saved. Please retry or update it later in Driver Referrals.',
      ),
    );
  });

  it('Referral choice/details are absent from the recruiter-profile payload', async () => {
    const { saveMock } = installProfileHook({ profile: makeProfile() });
    installReferralHook({ settings: null });

    render(<RecruiterOnboarding onBack={() => {}} />);
    fireEvent.click(screen.getByTestId('referral-decision-yes'));
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), {
      target: { value: '500' },
    });
    await submit();

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const payload = saveMock.mock.calls[0][0] as Record<string, unknown>;
    for (const forbidden of [
      'referral_bonus_enabled',
      'bonus_amount',
      'payment_trigger',
      'waiting_period_days',
      'bonus_terms',
      'referral_decision',
    ]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
    // Untouched authoritative fields still present.
    expect(payload).toHaveProperty('company_type');
    expect(payload).toHaveProperty('recruiter_name');
  });

  it('Submit is disabled while referral settings are hydrating and while referral persistence is pending', () => {
    installProfileHook({ profile: makeProfile() });
    installReferralHook({ isLoading: true });
    const { unmount } = render(<RecruiterOnboarding onBack={() => {}} />);
    expect(
      (screen.getByTestId('recruiter-onboarding-submit') as HTMLButtonElement).disabled,
    ).toBe(true);
    unmount();

    installProfileHook({ profile: makeProfile() });
    installReferralHook({ saveDecisionIsPending: true });
    render(<RecruiterOnboarding onBack={() => {}} />);
    expect(
      (screen.getByTestId('recruiter-onboarding-submit') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('Rejected-profile resubmission still runs after referral integration', async () => {
    const rejected = makeProfile({ verification_status: 'rejected' });
    const { saveMock } = installProfileHook({ profile: rejected });
    const { mutateAsync } = installReferralHook({ settings: null });

    render(<RecruiterOnboarding onBack={() => {}} />);
    await submit();

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    // Referral persistence still runs after the rejected-resubmit branch.
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    // Button copy remains the rejected resubmit label.
    expect(
      screen.getByTestId('recruiter-onboarding-submit').textContent,
    ).toMatch(/Resubmit for Badge Review/i);
  });
});
