/**
 * Phase 1Q-A / 1Q-A-R1 — Recruiter onboarding referral-preference integration.
 *
 * Renders the real `RecruiterOnboarding` component and, in a dedicated
 * describe block, exercises the REAL `useRecruiterReferralSettings` hook
 * with only the supabase client mocked at its external boundary.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  renderHook,
  act,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';

import type { RecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

// Radix pointer-capture polyfill so <Select> works under jsdom.
beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as {
    hasPointerCapture: () => boolean;
    releasePointerCapture: () => void;
    setPointerCapture: () => void;
    scrollIntoView: () => void;
  };
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

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

// Rich supabase mock: `.from(...)` returns a chainable builder capturing
// every call so hook tests can assert exact table/predicate/payload.
const supabaseState: {
  rpcResult: { data: unknown; error: unknown };
  upsertResult: { data: unknown; error: unknown };
  deleteResult: { error: unknown };
  maybeSingleResult: { data: unknown; error: unknown };
  rpcCalls: Array<{ name: string; args: unknown }>;
  upsertCalls: Array<{ table: string; payload: unknown; options: unknown }>;
  deleteCalls: Array<{ table: string; eq?: { col: string; val: unknown } }>;
} = {
  rpcResult: { data: null, error: null },
  upsertResult: { data: { id: 'row' }, error: null },
  deleteResult: { error: null },
  maybeSingleResult: { data: null, error: null },
  rpcCalls: [],
  upsertCalls: [],
  deleteCalls: [],
};

function resetSupabaseState() {
  supabaseState.rpcResult = { data: null, error: null };
  supabaseState.upsertResult = { data: { id: 'row' }, error: null };
  supabaseState.deleteResult = { error: null };
  supabaseState.maybeSingleResult = { data: null, error: null };
  supabaseState.rpcCalls = [];
  supabaseState.upsertCalls = [];
  supabaseState.deleteCalls = [];
}

vi.mock('@/integrations/supabase/client', () => {
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    builder.upsert = (payload: unknown, options: unknown) => {
      supabaseState.upsertCalls.push({ table, payload, options });
      return {
        select: () => ({
          single: async () => supabaseState.upsertResult,
        }),
      };
    };
    builder.delete = () => {
      const del: { eq: (col: string, val: unknown) => Promise<{ error: unknown }> } =
        {
          eq: async (col: string, val: unknown) => {
            supabaseState.deleteCalls.push({ table, eq: { col, val } });
            return { error: supabaseState.deleteResult.error };
          },
        };
      return del;
    };
    builder.select = () => ({
      eq: () => ({
        maybeSingle: async () => supabaseState.maybeSingleResult,
      }),
    });
    return builder;
  });
  const rpc = vi.fn(async (name: string, args: unknown) => {
    supabaseState.rpcCalls.push({ name, args });
    return supabaseState.rpcResult;
  });
  return { supabase: { from, rpc } };
});

// Phase 1R-D2-B6-A-R3 — NARROW mock of `useQueryClient` only. Every other
// TanStack export (QueryClient, QueryClientProvider, useQuery, useMutation)
// remains the ACTUAL implementation so the real-hook describe below still
// exercises production code. When `queryClientOverride.current` is null the
// real `useQueryClient` is used verbatim.
const queryClientOverride = vi.hoisted(() => ({
  current: null as null | { invalidateQueries: (...args: unknown[]) => unknown },
}));

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>(
      '@tanstack/react-query',
    );
  return {
    ...actual,
    useQueryClient: (...args: unknown[]) =>
      queryClientOverride.current ??
      (actual.useQueryClient as unknown as (...a: unknown[]) => unknown)(...args),
  };
});

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

const PARTIAL_WARNING =
  'Recruiter profile saved, but your referral preference could not be saved. Please retry or update it later in Driver Referrals.';

beforeEach(() => {
  vi.clearAllMocks();
  resetSupabaseState();
  cleanup();
});

describe('Phase 1Q-A — Recruiter onboarding referral preference (component)', () => {
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
    // Trigger reflects the hydrated saved value.
    expect(screen.getByTestId('ref-trigger').textContent).toMatch(
      /After waiting period/i,
    );
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

  it('YES: profile save → fresh refetch → referral save (with real trigger, $500, 30 days, terms)', async () => {
    const freshProfile = makeProfile({ id: 'rp-fresh' });
    const { saveMock, refetch } = installProfileHook({
      profile: makeProfile(),
      refetchProfile: vi.fn(async () => freshProfile),
    });
    const { mutateAsync } = installReferralHook({ settings: null });

    render(<RecruiterOnboarding onBack={() => {}} />);
    const user = userEvent.setup();

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

    // Real trigger selection via Radix Select.
    await user.click(screen.getByTestId('ref-trigger'));
    await user.click(await screen.findByText('After waiting period'));

    await submit();

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    const call = mutateAsync.mock.calls[0][0] as {
      recruiterId: string;
      decision: string;
      details: {
        referral_bonus_enabled: boolean;
        bonus_amount: number | null;
        payment_trigger: string | null;
        waiting_period_days: number | null;
        bonus_terms: string | null;
      };
    };
    expect(call.recruiterId).toBe('rp-fresh');
    expect(call.decision).toBe('yes');
    expect(call.details.referral_bonus_enabled).toBe(true);
    expect(call.details.bonus_amount).toBe(500);
    expect(call.details.payment_trigger).toBe('after_waiting_period');
    expect(call.details.waiting_period_days).toBe(30);
    expect(call.details.bonus_terms).toBe('$500 after 30 days.');

    // Ordering: profile save < refetch < referral mutation.
    const saveOrder = saveMock.mock.invocationCallOrder[0];
    const refetchOrder = refetch.mock.invocationCallOrder[0];
    const refMutOrder = mutateAsync.mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(refetchOrder);
    expect(refetchOrder).toBeLessThan(refMutOrder);
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

  it('Decide later: invokes saveDecision with decision=later exactly once', async () => {
    installProfileHook({ profile: makeProfile() });
    const { mutateAsync } = installReferralHook({ settings: null });

    render(<RecruiterOnboarding onBack={() => {}} />);
    await submit();

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const call = mutateAsync.mock.calls[0][0] as { decision: string };
    expect(call.decision).toBe('later');
  });

  it('Profile-save failure via onError: shows safe profile toast, zero refetch and zero referral mutation', async () => {
    const saveMock = vi.fn(
      (_p, cbs?: { onError?: (e: Error) => void }) => {
        cbs?.onError?.(new Error('validation exploded'));
      },
    );
    const { refetch } = installProfileHook({ profile: makeProfile(), saveMock });
    const { mutateAsync } = installReferralHook({ settings: null });

    render(<RecruiterOnboarding onBack={() => {}} />);
    await submit();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('validation exploded'),
    );
    expect(refetch).not.toHaveBeenCalled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('Fresh refetch throws → zero referral mutation, exact partial-save warning, no stale id used', async () => {
    const refetch = vi.fn(async () => {
      throw new Error('network');
    });
    installProfileHook({ profile: makeProfile({ id: 'rp-stale' }), refetchProfile: refetch });
    const { mutateAsync } = installReferralHook({ settings: null });

    render(<RecruiterOnboarding onBack={() => {}} />);
    fireEvent.click(screen.getByTestId('referral-decision-no'));
    await submit();

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(PARTIAL_WARNING),
    );
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('Fresh refetch returns empty id → zero referral mutation, exact partial-save warning', async () => {
    const refetch = vi.fn(async () => ({ ...makeProfile(), id: '   ' } as RecruiterProfile));
    installProfileHook({ profile: makeProfile({ id: 'rp-stale' }), refetchProfile: refetch });
    const { mutateAsync } = installReferralHook({ settings: null });

    render(<RecruiterOnboarding onBack={() => {}} />);
    await submit();

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(PARTIAL_WARNING),
    );
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('Referral-save failure after profile success: exact partial-save warning; no referral-success toast', async () => {
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
      expect(toast.error).toHaveBeenCalledWith(PARTIAL_WARNING),
    );
    // No success toast claims the referral preference was saved.
    const successCalls = vi.mocked(toast.success).mock.calls.map((c) => String(c[0]));
    for (const msg of successCalls) {
      expect(msg.toLowerCase()).not.toContain('referral');
    }
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

  it('Rejected-profile resubmission: profile save → resubmit RPC (with exact args) → fresh refetch → referral mutation', async () => {
    const rejected = makeProfile({ id: 'rp-rejected', verification_status: 'rejected' });
    const freshProfile = makeProfile({ id: 'rp-fresh' });
    const refetch = vi.fn(async () => freshProfile);
    const { saveMock } = installProfileHook({
      profile: rejected,
      refetchProfile: refetch,
    });
    const { mutateAsync } = installReferralHook({ settings: null });

    render(<RecruiterOnboarding onBack={() => {}} />);
    await submit();

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const { supabase } = await import('@/integrations/supabase/client');
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));
    expect(vi.mocked(supabase.rpc).mock.calls[0][0]).toBe('resubmit_recruiter_profile');
    expect(vi.mocked(supabase.rpc).mock.calls[0][1]).toEqual({ profile_id: 'rp-rejected' });
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    // Order: saveProfile < rpc < refetch < referral mutation.
    const saveOrder = saveMock.mock.invocationCallOrder[0];
    const rpcOrder = vi.mocked(supabase.rpc).mock.invocationCallOrder[0];
    const refetchOrder = refetch.mock.invocationCallOrder[0];
    const refMutOrder = mutateAsync.mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(rpcOrder);
    expect(rpcOrder).toBeLessThan(refetchOrder);
    expect(refetchOrder).toBeLessThan(refMutOrder);

    // Rejected button copy remains.
    expect(
      screen.getByTestId('recruiter-onboarding-submit').textContent,
    ).toMatch(/Resubmit for Badge Review/i);

    // Fresh id — not the stale rejected id — was used.
    expect(
      (mutateAsync.mock.calls[0][0] as { recruiterId: string }).recruiterId,
    ).toBe('rp-fresh');
  });

  it('Rejected-resubmit RPC failure: no fresh refetch, no referral mutation', async () => {
    const rejected = makeProfile({ verification_status: 'rejected' });
    const refetch = vi.fn(async () => rejected);
    const { saveMock } = installProfileHook({
      profile: rejected,
      refetchProfile: refetch,
    });
    const { mutateAsync } = installReferralHook({ settings: null });

    supabaseState.rpcResult = { data: null, error: { message: 'rpc failed' } };

    render(<RecruiterOnboarding onBack={() => {}} />);
    await submit();

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('rpc failed'),
    );
    expect(refetch).not.toHaveBeenCalled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('Payment trigger sentinel: Not specified maps to payment_trigger: null', async () => {
    const freshProfile = makeProfile({ id: 'rp-fresh' });
    installProfileHook({
      profile: makeProfile(),
      refetchProfile: vi.fn(async () => freshProfile),
    });
    const { mutateAsync } = installReferralHook({ settings: null });

    render(<RecruiterOnboarding onBack={() => {}} />);
    const user = userEvent.setup();

    fireEvent.click(screen.getByTestId('referral-decision-yes'));
    // Default trigger is the "Not specified" sentinel; leave as-is.
    expect(screen.getByTestId('ref-trigger').textContent).toMatch(/Not specified/i);
    await submit();

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const call = mutateAsync.mock.calls[0][0] as {
      details: { payment_trigger: string | null };
    };
    expect(call.details.payment_trigger).toBeNull();

    // Confirm the sentinel is never sent by re-selecting Not specified after
    // choosing a real trigger, then submitting again.
    vi.mocked(toast.success).mockClear();
    mutateAsync.mockClear();
    await user.click(screen.getByTestId('ref-trigger'));
    await user.click(await screen.findByText('When referred driver is hired'));
    await user.click(screen.getByTestId('ref-trigger'));
    await user.click(await screen.findByText('Not specified'));
    await submit();

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const call2 = mutateAsync.mock.calls[0][0] as {
      details: { payment_trigger: string | null };
    };
    expect(call2.details.payment_trigger).toBeNull();
  });

  it('Previously selected trigger can be cleared to Not specified and persisted as null', async () => {
    const freshProfile = makeProfile({ id: 'rp-fresh' });
    installProfileHook({
      profile: makeProfile(),
      refetchProfile: vi.fn(async () => freshProfile),
    });
    const { mutateAsync } = installReferralHook({
      settings: {
        referral_bonus_enabled: true,
        bonus_amount: 500,
        payment_trigger: 'after_waiting_period',
        waiting_period_days: 30,
        bonus_terms: 'x',
      },
    });

    render(<RecruiterOnboarding onBack={() => {}} />);
    const user = userEvent.setup();

    // Hydrated with real trigger; now clear it via the sentinel.
    await waitFor(() =>
      expect(screen.getByTestId('ref-trigger').textContent).toMatch(/After waiting period/i),
    );
    await user.click(screen.getByTestId('ref-trigger'));
    await user.click(await screen.findByText('Not specified'));
    await submit();

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const call = mutateAsync.mock.calls[0][0] as {
      details: { payment_trigger: string | null };
    };
    expect(call.details.payment_trigger).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Real-hook coverage — exercise the ACTUAL `useRecruiterReferralSettings`
// against the mocked supabase client with an explicit QueryClient wrapper.
// ---------------------------------------------------------------------------

describe('Phase 1Q-A-R1 — useRecruiterReferralSettings.saveDecision (real hook)', () => {
  function makeWrapper() {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);
    return { qc, invalidateSpy, wrapper };
  }

  async function loadActualHook() {
    const actual = await vi.importActual<
      typeof import('@/hooks/opportunities/useRecruiterReferralSettings')
    >('@/hooks/opportunities/useRecruiterReferralSettings');
    return actual.useRecruiterReferralSettings;
  }

  it('null hook recruiterId: saveDecision(rp-fresh) invalidates ["recruiter_referral_settings","rp-fresh"] and NOT null', async () => {
    const useHook = await loadActualHook();
    const { invalidateSpy, wrapper } = makeWrapper();
    const { result } = renderHook(() => useHook(null), { wrapper });

    await act(async () => {
      await result.current.saveDecision.mutateAsync({
        recruiterId: 'rp-fresh',
        decision: 'no',
        details: {
          referral_bonus_enabled: false,
          bonus_amount: null,
          payment_trigger: null,
          waiting_period_days: null,
          bonus_terms: null,
        },
      });
    });

    const keys = invalidateSpy.mock.calls.map(
      (c) => (c[0] as { queryKey: unknown[] }).queryKey,
    );
    expect(keys).toContainEqual(['recruiter_referral_settings', 'rp-fresh']);
    for (const k of keys) {
      expect(k).not.toEqual(['recruiter_referral_settings', null]);
    }
  });

  it('stale hook recruiterId: invalidates the explicit id, not the stale hook id', async () => {
    const useHook = await loadActualHook();
    const { invalidateSpy, wrapper } = makeWrapper();
    const { result } = renderHook(() => useHook('rp-old'), { wrapper });

    await act(async () => {
      await result.current.saveDecision.mutateAsync({
        recruiterId: '  rp-fresh  ',
        decision: 'later',
        details: {
          referral_bonus_enabled: false,
          bonus_amount: null,
          payment_trigger: null,
          waiting_period_days: null,
          bonus_terms: null,
        },
      });
    });

    const keys = invalidateSpy.mock.calls.map(
      (c) => (c[0] as { queryKey: unknown[] }).queryKey,
    );
    expect(keys).toContainEqual(['recruiter_referral_settings', 'rp-fresh']);
    for (const k of keys) {
      expect(k).not.toEqual(['recruiter_referral_settings', 'rp-old']);
    }
  });

  it('later: performs delete().eq("recruiter_id","rp-fresh") and no upsert', async () => {
    const useHook = await loadActualHook();
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useHook(null), { wrapper });

    await act(async () => {
      await result.current.saveDecision.mutateAsync({
        recruiterId: 'rp-fresh',
        decision: 'later',
        details: {
          referral_bonus_enabled: false,
          bonus_amount: null,
          payment_trigger: null,
          waiting_period_days: null,
          bonus_terms: null,
        },
      });
    });

    expect(supabaseState.deleteCalls).toEqual([
      {
        table: 'recruiter_referral_settings',
        eq: { col: 'recruiter_id', val: 'rp-fresh' },
      },
    ]);
    expect(supabaseState.upsertCalls).toHaveLength(0);
  });

  it('invalid decision: throws "Invalid referral decision" and performs no supabase call', async () => {
    const useHook = await loadActualHook();
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useHook(null), { wrapper });

    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.saveDecision.mutateAsync({
          recruiterId: 'rp-fresh',
          decision: 'bogus' as unknown as 'yes',
          details: {
            referral_bonus_enabled: false,
            bonus_amount: null,
            payment_trigger: null,
            waiting_period_days: null,
            bonus_terms: null,
          },
        });
      } catch (e) {
        caught = e;
      }
    });
    expect((caught as Error).message).toBe('Invalid referral decision');
    expect(supabaseState.deleteCalls).toHaveLength(0);
    expect(supabaseState.upsertCalls).toHaveLength(0);
  });

  it('yes: upserts enabled=true with exact detail payload', async () => {
    const useHook = await loadActualHook();
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useHook(null), { wrapper });

    await act(async () => {
      await result.current.saveDecision.mutateAsync({
        recruiterId: 'rp-fresh',
        decision: 'yes',
        details: {
          referral_bonus_enabled: true,
          bonus_amount: 500,
          payment_trigger: 'after_waiting_period',
          waiting_period_days: 30,
          bonus_terms: '  $500 after 30 days.  ',
        },
      });
    });

    expect(supabaseState.upsertCalls).toHaveLength(1);
    const { table, payload, options } = supabaseState.upsertCalls[0];
    expect(table).toBe('recruiter_referral_settings');
    expect(options).toEqual({ onConflict: 'recruiter_id' });
    expect(payload).toEqual({
      recruiter_id: 'rp-fresh',
      referral_bonus_enabled: true,
      bonus_amount: 500,
      payment_trigger: 'after_waiting_period',
      waiting_period_days: 30,
      bonus_terms: '$500 after 30 days.',
    });
  });

  it('no: upserts enabled=false with every optional field cleared', async () => {
    const useHook = await loadActualHook();
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useHook(null), { wrapper });

    await act(async () => {
      await result.current.saveDecision.mutateAsync({
        recruiterId: 'rp-fresh',
        decision: 'no',
        details: {
          referral_bonus_enabled: true, // callers may pass anything; NO wins.
          bonus_amount: 999,
          payment_trigger: 'on_hire',
          waiting_period_days: 7,
          bonus_terms: 'ignored',
        },
      });
    });

    expect(supabaseState.upsertCalls).toHaveLength(1);
    expect(supabaseState.upsertCalls[0].payload).toEqual({
      recruiter_id: 'rp-fresh',
      referral_bonus_enabled: false,
      bonus_amount: null,
      payment_trigger: null,
      waiting_period_days: null,
      bonus_terms: null,
    });
  });

  it('validation: rejects negative amount, non-integer waiting, invalid trigger', async () => {
    const useHook = await loadActualHook();
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useHook(null), { wrapper });

    const call = (details: {
      referral_bonus_enabled: boolean;
      bonus_amount: number | null;
      payment_trigger: string | null;
      waiting_period_days: number | null;
      bonus_terms: string | null;
    }) =>
      result.current.saveDecision.mutateAsync({
        recruiterId: 'rp-fresh',
        decision: 'yes',
        details: details as unknown as {
          referral_bonus_enabled: boolean;
          bonus_amount: number | null;
          payment_trigger:
            | 'on_hire'
            | 'after_waiting_period'
            | 'recruiter_defined'
            | 'other'
            | null;
          waiting_period_days: number | null;
          bonus_terms: string | null;
        },
      });

    for (const bad of [
      {
        referral_bonus_enabled: true,
        bonus_amount: -1,
        payment_trigger: null,
        waiting_period_days: null,
        bonus_terms: null,
      },
      {
        referral_bonus_enabled: true,
        bonus_amount: null,
        payment_trigger: null,
        waiting_period_days: 1.5,
        bonus_terms: null,
      },
      {
        referral_bonus_enabled: true,
        bonus_amount: null,
        payment_trigger: 'weird',
        waiting_period_days: null,
        bonus_terms: null,
      },
    ]) {
      let err: unknown = null;
      await act(async () => {
        try {
          await call(bad);
        } catch (e) {
          err = e;
        }
      });
      expect(err).toBeInstanceOf(Error);
    }
    expect(supabaseState.upsertCalls).toHaveLength(0);
  });
});
