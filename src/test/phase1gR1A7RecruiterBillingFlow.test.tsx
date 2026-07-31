// Phase 1G-R1A7-R1 corrected — Recruiter premium checkout UI/state
// user-flow gate. Exercises the PRODUCTION `RecruiterBillingPanel` +
// `useRecruiterBilling` code paths (no replicas) with only the network
// boundary (`supabase.functions.invoke` + `.from(...).maybeSingle()`)
// and `useAuth` / `useRecruiterProfile` narrowly mocked.

import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';

import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- mocks (hoisted) --------------------------------------------------------

const authMocks = vi.hoisted(() => ({
  user: { id: 'user-rec-1' } as { id: string } | null,
}));
const adminMocks = vi.hoisted(() => ({ isAdmin: false }));
const profileMocks = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  isApproved: true,
  isSuspended: false,
  isLoading: false,
}));
// Phase 1R-C: agency sources feeding the effective business entitlement.
const agencyMocks = vi.hoisted(() => ({
  agency: null as Record<string, unknown> | null,
  agencyLoading: false,
  agencyError: false,
  entitlement: null as Record<string, unknown> | null,
  hasRow: false,
  entLoading: false,
  entError: false,
}));
const supabaseMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  fromMaybeSingle: vi.fn(async () => ({ data: null, error: null })),
  fromHeadCount: vi.fn(async () => ({ count: 0, error: null })),
}));
const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastMocks.success(...a),
    error: (...a: unknown[]) => toastMocks.error(...a),
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authMocks.user }),
}));
vi.mock('@/hooks/useAdmin', () => ({
  useAdmin: () => ({ isAdmin: adminMocks.isAdmin }),
}));
vi.mock('@/hooks/opportunities/useRecruiterProfile', async () => {
  const { isProfileCompleteForPosting } = await vi.importActual<
    typeof import('@/lib/opportunities/recruiterEligibility')
  >('@/lib/opportunities/recruiterEligibility');
  return {
    useRecruiterProfile: () => {
      const complete = isProfileCompleteForPosting(
        profileMocks.profile as never,
      );
      return {
        profile: profileMocks.profile,
        isApproved: profileMocks.isApproved,
        isSuspended: profileMocks.isSuspended,
        isLoading: profileMocks.isLoading,
        isProfileComplete: complete,
        canPost:
          !!profileMocks.profile && !profileMocks.isSuspended && complete,
      };
    },
  };
});

// Phase 1R-C: narrow default agency mocks. With no agency present the
// effective entitlement resolves exactly as recruiter-only, so every
// pre-existing test in this file keeps its original behavior.
vi.mock('@/hooks/useAgency', () => ({
  useMyAgency: () => ({
    data: agencyMocks.agency,
    isLoading: agencyMocks.agencyLoading,
    isError: agencyMocks.agencyError,
  }),
}));
vi.mock('@/hooks/useAgencyEntitlement', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agencyPlans')>(
    '@/lib/agencyPlans',
  );
  return {
    useAgencyEntitlement: (agencyId: string | null | undefined) => ({
      entitlement:
        agencyMocks.entitlement ?? actual.defaultBetaEntitlement(agencyId ?? ''),
      hasRow: agencyMocks.hasRow,
      isLoading: agencyMocks.entLoading,
      isError: agencyMocks.entError,
      error: null,
      refetch: () => {},
    }),
  };
});


vi.mock('@/integrations/supabase/client', () => {
  const billingChain = {
    select: () => billingChain,
    eq: () => billingChain,
    maybeSingle: () => supabaseMocks.fromMaybeSingle(),
  };
  const countChain = {
    select: (_c: string, _o: { count: string; head: boolean }) => countChain,
    eq: () => countChain,
    then: (resolve: (v: unknown) => void) =>
      supabaseMocks.fromHeadCount().then(resolve),
  };
  return {
    supabase: {
      functions: { invoke: (...a: unknown[]) => supabaseMocks.invoke(...a) },
      from: (table: string) => {
        if (table === 'opportunities') return countChain;
        return billingChain;
      },
    },
  };
});

import { RecruiterBillingPanel } from '@/components/opportunities/RecruiterBillingPanel';
// Phase 1R-C-R1: the REAL hook is exercised directly (only its dependency /
// network boundary is mocked above).
import { useRecruiterBilling } from '@/hooks/opportunities/useRecruiterBilling';

import {
  isSafeStripeCheckoutUrl,
  isSafeStripeBillingPortalUrl,
  parseCheckoutError,
  RECRUITER_CHECKOUT_MESSAGES,
  RECRUITER_BILLING_POPUP_NAME,
  RECRUITER_CHECKOUT_COOLDOWN_MS,
  classifyRecruiterSubscriptionStatus,
} from '@/lib/opportunities/recruiterCheckoutMessages';

// --- helpers ----------------------------------------------------------------

const COMPLETE_PROFILE = {
  id: 'rec-1',
  user_id: 'user-rec-1',
  status: 'active',
  verification_status: 'approved',
  recruiter_name: 'Real Recruiter',
  company_name: 'Real Freight LLC',
  company_type: 'carrier',
  recruiter_email: 'recruiter@example.com',
  dot_number: '123456',
  mc_number: null,
  posting_terms_accepted_at: new Date().toISOString(),
};

const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_ok';
const PORTAL_URL = 'https://billing.stripe.com/session/bs_test_ok';

function makeWindow() {
  return {
    closed: false,
    opener: {} as unknown,
    location: { href: '' },
    close: vi.fn(function (this: { closed: boolean }) {
      this.closed = true;
    }),
  };
}

function renderPanel() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RecruiterBillingPanel />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

function invokeError(status: number, code: string) {
  const body = JSON.stringify({ code, message: 'server' });
  const response = new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
  const err = Object.assign(new Error('FunctionsHttpError'), {
    context: response,
    name: 'FunctionsHttpError',
  });
  return { data: null, error: err };
}

function withBilling(row: Record<string, unknown>) {
  supabaseMocks.fromMaybeSingle.mockResolvedValue({ data: row, error: null });
}

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  authMocks.user = { id: 'user-rec-1' };
  adminMocks.isAdmin = false;
  profileMocks.profile = { ...COMPLETE_PROFILE };
  profileMocks.isApproved = true;
  profileMocks.isSuspended = false;
  profileMocks.isLoading = false;
  agencyMocks.agency = null;
  agencyMocks.agencyLoading = false;
  agencyMocks.agencyError = false;
  agencyMocks.entitlement = null;
  agencyMocks.hasRow = false;
  agencyMocks.entLoading = false;
  agencyMocks.entError = false;

  supabaseMocks.invoke.mockReset();
  supabaseMocks.fromMaybeSingle.mockReset();
  supabaseMocks.fromMaybeSingle.mockResolvedValue({ data: null, error: null });
  supabaseMocks.fromHeadCount.mockReset();
  supabaseMocks.fromHeadCount.mockResolvedValue({ count: 0, error: null });
  toastMocks.success.mockReset();
  toastMocks.error.mockReset();
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => makeWindow() as unknown as Window);
});

afterEach(() => {
  cleanup();
  openSpy.mockRestore();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Safe-URL validators (exact-host, https-only, no subdomain tricks)
// ---------------------------------------------------------------------------

describe('safe checkout URL validator', () => {
  it('accepts https checkout.stripe.com', () => {
    expect(isSafeStripeCheckoutUrl(CHECKOUT_URL)).toBe(true);
  });
  it('rejects http', () => {
    expect(isSafeStripeCheckoutUrl('http://checkout.stripe.com/x')).toBe(false);
  });
  it('rejects wrong host', () => {
    expect(isSafeStripeCheckoutUrl('https://evil.example.com/x')).toBe(false);
  });
  it('rejects subdomain-trick host', () => {
    expect(
      isSafeStripeCheckoutUrl('https://checkout.stripe.com.evil.example/x'),
    ).toBe(false);
  });
  it('rejects billing portal host', () => {
    expect(isSafeStripeCheckoutUrl(PORTAL_URL)).toBe(false);
  });
  it('rejects javascript: pseudo-URL', () => {
    expect(isSafeStripeCheckoutUrl('javascript:alert(1)')).toBe(false);
  });
  it('rejects empty / null / undefined', () => {
    expect(isSafeStripeCheckoutUrl('')).toBe(false);
    expect(isSafeStripeCheckoutUrl(null)).toBe(false);
    expect(isSafeStripeCheckoutUrl(undefined)).toBe(false);
  });
});

describe('safe billing-portal URL validator', () => {
  it('accepts https billing.stripe.com', () => {
    expect(isSafeStripeBillingPortalUrl(PORTAL_URL)).toBe(true);
  });
  it('rejects http', () => {
    expect(isSafeStripeBillingPortalUrl('http://billing.stripe.com/s')).toBe(
      false,
    );
  });
  it('rejects checkout host', () => {
    expect(isSafeStripeBillingPortalUrl(CHECKOUT_URL)).toBe(false);
  });
  it('rejects subdomain-trick host', () => {
    expect(
      isSafeStripeBillingPortalUrl('https://billing.stripe.com.evil.example/s'),
    ).toBe(false);
  });
  it('rejects null / undefined', () => {
    expect(isSafeStripeBillingPortalUrl(null)).toBe(false);
    expect(isSafeStripeBillingPortalUrl(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Safe error parsing — never leaks raw platform info
// ---------------------------------------------------------------------------

describe('safe error parsing', () => {
  it('maps known code to public message', async () => {
    const { error } = invokeError(409, 'subscription_exists');
    const parsed = await parseCheckoutError(error);
    expect(parsed.code).toBe('subscription_exists');
    expect(parsed.message).toBe(
      RECRUITER_CHECKOUT_MESSAGES.subscription_exists,
    );
  });
  it('parses malformed / non-Response error as unknown_error', async () => {
    const parsed = await parseCheckoutError(new Error('boom raw internal'));
    expect(parsed.code).toBe('unknown_error');
    expect(parsed.message).toBe(RECRUITER_CHECKOUT_MESSAGES.unknown_error);
    expect(parsed.message).not.toMatch(/boom raw internal/);
  });
  it('never surfaces server IDs from body', async () => {
    const body = JSON.stringify({
      code: 'internal_error',
      customer_id: 'cus_leaky_123',
      subscription_id: 'sub_leaky_456',
    });
    const resp = new Response(body, {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
    const err = Object.assign(new Error('x'), { context: resp });
    const parsed = await parseCheckoutError(err);
    expect(parsed.message).not.toMatch(/cus_leaky|sub_leaky/);
  });
});

// ---------------------------------------------------------------------------
// 3. Subscription-status classifier fails closed
// ---------------------------------------------------------------------------

describe('subscription status classifier', () => {
  it('maps unrecognized upstream string to unknown', () => {
    expect(classifyRecruiterSubscriptionStatus('brand_new_status')).toBe(
      'unknown',
    );
  });
  it('maps null / missing to inactive', () => {
    expect(classifyRecruiterSubscriptionStatus(null)).toBe('inactive');
    expect(classifyRecruiterSubscriptionStatus(undefined)).toBe('inactive');
  });
});

// ---------------------------------------------------------------------------
// 4. Eligible checkout happy path — spinner only on selected plan,
//    named popup, correct navigation, other plans still disabled while pending
// ---------------------------------------------------------------------------

describe('eligible checkout happy path', () => {
  it('opens the deterministic named popup synchronously with no window-feature string (real-Chromium: noopener/noreferrer force a null return and were removed; anti-tabnabbing is enforced via w.opener = null instead)', async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: { code: 'checkout_ready', url: CHECKOUT_URL },
      error: null,
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    expect(openSpy).toHaveBeenCalledWith(
      'about:blank',
      RECRUITER_BILLING_POPUP_NAME,
    );
  });

  it('navigates the prepared window to the validated Stripe URL', async () => {
    const w = makeWindow();
    openSpy.mockReturnValue(w as unknown as Window);
    supabaseMocks.invoke.mockResolvedValue({
      data: { code: 'checkout_ready', url: CHECKOUT_URL },
      error: null,
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    await waitFor(() => expect(w.location.href).toBe(CHECKOUT_URL));
    expect(w.opener).toBeNull();
  });

  it('spinner appears only on the clicked plan; other plan buttons stay disabled during pending', async () => {
    let resolveInvoke: (v: unknown) => void = () => {};
    supabaseMocks.invoke.mockImplementation(
      () => new Promise((r) => (resolveInvoke = r)),
    );
    const user = userEvent.setup();
    renderPanel();
    const starter = screen.getByRole('button', { name: /Choose Starter/i });
    const growth = screen.getByRole('button', { name: /Choose Growth/i });
    const fleet = screen.getByRole('button', { name: /Choose Fleet/i });
    await user.click(starter);
    expect(starter).toHaveAttribute('aria-busy', 'true');
    expect(growth).not.toHaveAttribute('aria-busy');
    expect(fleet).not.toHaveAttribute('aria-busy');
    expect(growth).toBeDisabled();
    expect(fleet).toBeDisabled();
    await act(async () => {
      resolveInvoke({
        data: { code: 'checkout_ready', url: CHECKOUT_URL },
        error: null,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Rapid double-click — exactly one invoke, one window
// ---------------------------------------------------------------------------

describe('rapid double click', () => {
  it('only issues one invoke and reuses one named window on rapid clicks', async () => {
    let resolveInvoke: (v: unknown) => void = () => {};
    supabaseMocks.invoke.mockImplementation(
      () => new Promise((r) => (resolveInvoke = r)),
    );
    const user = userEvent.setup();
    renderPanel();
    const btn = screen.getByRole('button', { name: /Choose Starter/i });
    await user.click(btn);
    await user.click(btn);
    expect(supabaseMocks.invoke).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(btn).toBeDisabled();
    await act(async () => {
      resolveInvoke({
        data: { code: 'checkout_ready', url: CHECKOUT_URL },
        error: null,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// 6. Server in_progress / processing lock, cooldown, Check Status
// ---------------------------------------------------------------------------

describe('server in_progress state', () => {
  it('locks all plan buttons and shows Check Status disabled during cooldown', async () => {
    supabaseMocks.invoke.mockResolvedValueOnce(invokeError(409, 'in_progress'));
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    await waitFor(() =>
      expect(screen.getByTestId('recruiter-billing-status')).toHaveAttribute(
        'data-state',
        'in_progress',
      ),
    );
    for (const p of ['starter', 'growth', 'fleet']) {
      expect(screen.getByTestId(`recruiter-plan-button-${p}`)).toBeDisabled();
    }
    expect(screen.getByTestId('recruiter-billing-check-status')).toBeDisabled();
  });

  it('enables Check Status after cooldown and refetches on click', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    supabaseMocks.invoke.mockResolvedValueOnce(invokeError(409, 'in_progress'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    await waitFor(() =>
      expect(screen.getByTestId('recruiter-billing-check-status')).toBeDisabled(),
    );
    await act(async () => {
      vi.advanceTimersByTime(RECRUITER_CHECKOUT_COOLDOWN_MS + 50);
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('recruiter-billing-check-status'),
      ).not.toBeDisabled(),
    );
    const before = supabaseMocks.fromMaybeSingle.mock.calls.length;
    await user.click(screen.getByTestId('recruiter-billing-check-status'));
    await waitFor(() =>
      expect(supabaseMocks.fromMaybeSingle.mock.calls.length).toBeGreaterThan(
        before,
      ),
    );
  });
});

describe('server checkout_processing state', () => {
  it('surfaces processing headline and disables plan buttons', async () => {
    supabaseMocks.invoke.mockResolvedValueOnce(
      invokeError(409, 'checkout_processing'),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    await waitFor(() =>
      expect(screen.getByTestId('recruiter-billing-status')).toHaveAttribute(
        'data-state',
        'processing',
      ),
    );
    expect(screen.getByTestId('recruiter-plan-button-starter')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 7. Subscription-state rendering + blocking (every state)
// ---------------------------------------------------------------------------

const SUB_CASES: {
  status: string;
  dataState: string;
  fragment: RegExp;
  blocks: boolean;
}[] = [
  { status: 'active', dataState: 'sub_active', fragment: /is active/i, blocks: true },
  { status: 'trialing', dataState: 'sub_trialing', fragment: /trial/i, blocks: true }, // trial-allowlist
  { status: 'past_due', dataState: 'sub_past_due', fragment: /payment did not go through/i, blocks: true },
  { status: 'unpaid', dataState: 'sub_unpaid', fragment: /unpaid/i, blocks: true },
  { status: 'incomplete', dataState: 'sub_incomplete', fragment: /was not completed/i, blocks: true },
  { status: 'paused', dataState: 'sub_paused', fragment: /paused/i, blocks: true },
  { status: 'canceled', dataState: 'sub_canceled', fragment: /canceled/i, blocks: false },
  { status: 'incomplete_expired', dataState: 'sub_incomplete_expired', fragment: /expired/i, blocks: false },
  { status: 'brand_new', dataState: 'sub_unknown', fragment: /syncing/i, blocks: true },
];

describe('subscription-state rendering + blocking', () => {
  for (const c of SUB_CASES) {
    it(`status=${c.status} renders correct copy and ${c.blocks ? 'blocks' : 'allows'} checkout`, async () => {
      withBilling({
        recruiter_id: 'rec-1',
        plan: c.status === 'active' || c.status === 'trialing' ? 'starter' : 'none', // trial-allowlist
        status: c.status,
        stripe_customer_id: 'cus_x',
        stripe_subscription_id: c.status === 'inactive' ? null : 'sub_x',
        active_opportunity_limit: null,
      });
      renderPanel();
      await waitFor(() =>
        expect(screen.getByTestId('recruiter-billing-status')).toHaveAttribute(
          'data-state',
          c.dataState,
        ),
      );
      expect(screen.getByTestId('recruiter-billing-status')).toHaveTextContent(
        c.fragment,
      );
      const growthBtn = screen.getByTestId('recruiter-plan-button-growth');
      if (c.blocks) {
        expect(growthBtn).toBeDisabled();
      } else {
        expect(growthBtn).not.toBeDisabled();
      }
    });
  }

  it('inactive (no billing row) allows checkout when eligible', async () => {
    renderPanel();
    await waitFor(() =>
      expect(
        screen.getByTestId('recruiter-plan-button-starter'),
      ).not.toBeDisabled(),
    );
  });
});

// ---------------------------------------------------------------------------
// 8. Eligibility gating states
// ---------------------------------------------------------------------------

describe('eligibility gating', () => {
  it('profile.status=suspended blocks checkout regardless of billing', async () => {
    profileMocks.profile = { ...COMPLETE_PROFILE, status: 'suspended' };
    profileMocks.isSuspended = true;
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId('recruiter-billing-status')).toHaveAttribute(
        'data-state',
        'suspended',
      ),
    );
    for (const p of ['starter', 'growth', 'fleet']) {
      expect(screen.getByTestId(`recruiter-plan-button-${p}`)).toBeDisabled();
    }
  });

  it('verification_status=suspended blocks checkout', async () => {
    profileMocks.profile = {
      ...COMPLETE_PROFILE,
      verification_status: 'suspended',
    };
    profileMocks.isSuspended = true;
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId('recruiter-billing-status')).toHaveAttribute(
        'data-state',
        'suspended',
      ),
    );
    expect(screen.getByTestId('recruiter-plan-button-starter')).toBeDisabled();
  });

  it('missing profile shows missing_profile state and blocks checkout', async () => {
    profileMocks.profile = null;
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId('recruiter-billing-status')).toHaveAttribute(
        'data-state',
        'missing_profile',
      ),
    );
    expect(screen.getByTestId('recruiter-plan-button-starter')).toBeDisabled();
  });

  it('loading profile shows loading state and blocks checkout', async () => {
    profileMocks.isLoading = true;
    renderPanel();
    expect(screen.getByTestId('recruiter-billing-status')).toHaveAttribute(
      'data-state',
      'loading',
    );
    expect(screen.getByTestId('recruiter-plan-button-starter')).toBeDisabled();
  });

  it('incomplete profile (missing DOT/MC) shows ineligible and blocks checkout', async () => {
    profileMocks.profile = {
      ...COMPLETE_PROFILE,
      dot_number: null,
      mc_number: null,
    };
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId('recruiter-billing-status')).toHaveAttribute(
        'data-state',
        'ineligible',
      ),
    );
    expect(screen.getByTestId('recruiter-plan-button-starter')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 9. subscription_exists refresh
// ---------------------------------------------------------------------------

describe('subscription_exists → refetch', () => {
  it('shows the error and refetches billing so state converges', async () => {
    supabaseMocks.invoke.mockResolvedValueOnce(
      invokeError(409, 'subscription_exists'),
    );
    const user = userEvent.setup();
    renderPanel();
    const before = supabaseMocks.fromMaybeSingle.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        RECRUITER_CHECKOUT_MESSAGES.subscription_exists,
      ),
    );
    await waitFor(() =>
      expect(supabaseMocks.fromMaybeSingle.mock.calls.length).toBeGreaterThan(
        before,
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// 10. Unsafe checkout / portal URLs never open
// ---------------------------------------------------------------------------

describe('unsafe URL rejection', () => {
  it('never navigates when the server returns a non-Stripe checkout URL', async () => {
    const w = makeWindow();
    openSpy.mockReturnValue(w as unknown as Window);
    supabaseMocks.invoke.mockResolvedValue({
      data: { code: 'checkout_ready', url: 'https://evil.example.com/x' },
      error: null,
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled());
    expect(w.location.href).toBe('');
    expect(w.close).toHaveBeenCalled();
  });

  it('never navigates when the server returns a non-Stripe portal URL', async () => {
    withBilling({
      recruiter_id: 'rec-1',
      plan: 'starter',
      status: 'active',
      stripe_customer_id: 'cus_x',
      stripe_subscription_id: 'sub_x',
      active_opportunity_limit: null,
    });
    const w = makeWindow();
    openSpy.mockReturnValue(w as unknown as Window);
    supabaseMocks.invoke.mockResolvedValue({
      data: { url: 'https://evil.example.com/portal' },
      error: null,
    });
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId('recruiter-manage-billing')).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId('recruiter-manage-billing'));
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled());
    expect(w.location.href).toBe('');
    expect(w.close).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 11. Popup-blocked fallbacks (checkout + portal)
// ---------------------------------------------------------------------------

describe('popup blocked fallbacks', () => {
  it('checkout: shows validated URL fallback link when popup is blocked', async () => {
    openSpy.mockReturnValue(null);
    supabaseMocks.invoke.mockResolvedValue({
      data: { code: 'checkout_ready', url: CHECKOUT_URL },
      error: null,
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    const link = await screen.findByTestId('recruiter-billing-fallback');
    expect(link).toHaveAttribute('href', CHECKOUT_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // Popup-blocked path must NOT be treated as success.
    expect(toastMocks.success).not.toHaveBeenCalled();
  });

  it('portal: shows validated URL fallback link when popup is blocked', async () => {
    withBilling({
      recruiter_id: 'rec-1',
      plan: 'starter',
      status: 'active',
      stripe_customer_id: 'cus_x',
      stripe_subscription_id: 'sub_x',
      active_opportunity_limit: null,
    });
    openSpy.mockReturnValue(null);
    supabaseMocks.invoke.mockResolvedValue({
      data: { url: PORTAL_URL },
      error: null,
    });
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId('recruiter-manage-billing')).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId('recruiter-manage-billing'));
    const link = await screen.findByTestId('recruiter-billing-portal-fallback');
    expect(link).toHaveAttribute('href', PORTAL_URL);
  });
});

// ---------------------------------------------------------------------------
// 12. Blank popup closes on server failure
// ---------------------------------------------------------------------------

describe('blank popup lifecycle on failure', () => {
  it('closes the pre-opened blank window when the server errors', async () => {
    const w = makeWindow();
    openSpy.mockReturnValue(w as unknown as Window);
    supabaseMocks.invoke.mockResolvedValueOnce(
      invokeError(500, 'transient_error'),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    await waitFor(() => expect(w.close).toHaveBeenCalled());
  });
});

// ---------------------------------------------------------------------------
// 13. Successful portal navigation
// ---------------------------------------------------------------------------

describe('portal happy path', () => {
  it('navigates prepared window to validated billing URL', async () => {
    withBilling({
      recruiter_id: 'rec-1',
      plan: 'starter',
      status: 'active',
      stripe_customer_id: 'cus_x',
      stripe_subscription_id: 'sub_x',
      active_opportunity_limit: null,
    });
    const w = makeWindow();
    openSpy.mockReturnValue(w as unknown as Window);
    supabaseMocks.invoke.mockResolvedValue({
      data: { url: PORTAL_URL },
      error: null,
    });
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId('recruiter-manage-billing')).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId('recruiter-manage-billing'));
    await waitFor(() => expect(w.location.href).toBe(PORTAL_URL));
    expect(w.opener).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 14. Remount rehydrates server-authoritative state
// ---------------------------------------------------------------------------

describe('remount rehydrates from server', () => {
  const cases: {
    label: string;
    row: Record<string, unknown> | null;
    dataState: string;
  }[] = [
    {
      label: 'active',
      row: {
        recruiter_id: 'rec-1',
        plan: 'starter',
        status: 'active',
        stripe_customer_id: 'cus_x',
        stripe_subscription_id: 'sub_x',
      },
      dataState: 'sub_active',
    },
    {
      label: 'past_due',
      row: {
        recruiter_id: 'rec-1',
        plan: 'starter',
        status: 'past_due',
        stripe_customer_id: 'cus_x',
        stripe_subscription_id: 'sub_x',
      },
      dataState: 'sub_past_due',
    },
    {
      label: 'incomplete',
      row: {
        recruiter_id: 'rec-1',
        plan: 'starter',
        status: 'incomplete',
        stripe_customer_id: 'cus_x',
        stripe_subscription_id: 'sub_x',
      },
      dataState: 'sub_incomplete',
    },
    { label: 'no subscription', row: null, dataState: 'eligible_idle' },
  ];

  for (const c of cases) {
    it(`remount reflects server state: ${c.label}`, async () => {
      if (c.row) withBilling(c.row);
      const { unmount } = renderPanel();
      await waitFor(() => {
        if (c.dataState === 'eligible_idle') {
          expect(
            screen.getByTestId('recruiter-plan-button-starter'),
          ).not.toBeDisabled();
        } else {
          expect(
            screen.getByTestId('recruiter-billing-status'),
          ).toHaveAttribute('data-state', c.dataState);
        }
      });
      unmount();
      renderPanel();
      await waitFor(() => {
        if (c.dataState === 'eligible_idle') {
          expect(
            screen.getByTestId('recruiter-plan-button-starter'),
          ).not.toBeDisabled();
        } else {
          expect(
            screen.getByTestId('recruiter-billing-status'),
          ).toHaveAttribute('data-state', c.dataState);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 15. Focus and re-enable behavior
// ---------------------------------------------------------------------------

describe('focus and re-enable', () => {
  it('button re-enables after a retryable error and remains focus-reachable', async () => {
    supabaseMocks.invoke.mockResolvedValueOnce(
      invokeError(500, 'transient_error'),
    );
    const user = userEvent.setup();
    renderPanel();
    const btn = screen.getByRole('button', { name: /Choose Starter/i });
    await user.click(btn);
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled());
    await waitFor(() => expect(btn).not.toBeDisabled());
    btn.focus();
    expect(btn).toHaveFocus();
  });

  it('activation via keyboard Enter starts checkout', async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: { code: 'checkout_ready', url: CHECKOUT_URL },
      error: null,
    });
    const user = userEvent.setup();
    renderPanel();
    const btn = screen.getByRole('button', { name: /Choose Starter/i });
    await waitFor(() => expect(btn).not.toBeDisabled());
    btn.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openSpy).toHaveBeenCalled());
  });
});

// ---------------------------------------------------------------------------
// 16. Standard-posting copy is independent of premium billing state
// ---------------------------------------------------------------------------

describe('standard posting independence', () => {
  it('renders the standard-posting copy in every billing state', async () => {
    withBilling({
      recruiter_id: 'rec-1',
      plan: 'starter',
      status: 'past_due',
      stripe_customer_id: 'cus_x',
      stripe_subscription_id: 'sub_x',
    });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(/Standard Recruiter Access/i)).toBeInTheDocument(),
    );
    expect(
      screen.getAllByText(/complete, non-suspended/i).length,
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 17. Support-required error surfaces as support message, no retry loop
// ---------------------------------------------------------------------------

describe('support required surface', () => {
  it('renders a support-focused message for customer_conflict and disables plan buttons', async () => {
    supabaseMocks.invoke.mockResolvedValueOnce(
      invokeError(500, 'customer_conflict'),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    await waitFor(() =>
      expect(screen.getByTestId('recruiter-billing-status')).toHaveAttribute(
        'data-state',
        'support_required',
      ),
    );
    expect(screen.getByTestId('recruiter-plan-button-starter')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 18. UI never leaks server internals in the visible message
// ---------------------------------------------------------------------------

describe('safe messaging', () => {
  it('does not surface raw error names or IDs in the visible status region', async () => {
    supabaseMocks.invoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('DatabaseException: cus_leaky_777'), {
        context: null,
      }),
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    await waitFor(() =>
      expect(screen.getByTestId('recruiter-billing-status')).toBeInTheDocument(),
    );
    const text = screen.getByTestId('recruiter-billing-status').textContent ?? '';
    expect(text).not.toMatch(/cus_leaky_777|DatabaseException/);
  });
});

// ---------------------------------------------------------------------------
// Phase 1R-C — effective business entitlement rendering in the production panel
// ---------------------------------------------------------------------------

function withAgency(
  planKey: string,
  status: string,
  source: string,
  role = 'agency_owner',
) {
  agencyMocks.agency = { id: 'agency-1', my_role: role };
  agencyMocks.hasRow = true;
  agencyMocks.entitlement = {
    agencyId: 'agency-1',
    planKey,
    status,
    source,
    activeClientLimit: null,
    memberLimit: null,
    servicePackageLimit: null,
    currentPeriodEnd: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  };
}

describe('Phase 1R-C — agency-included recruiter premium access', () => {
  it('stripe agency_team owner: renders included access, hides recruiter upgrade actions', async () => {
    withAgency('agency_team', 'active', 'stripe');
    renderPanel();
    await waitFor(() =>
      expect(
        screen.getByTestId('recruiter-agency-included-access'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('recruiter-agency-included-access').textContent,
    ).toMatch(/Growth/);
    expect(screen.queryByTestId('recruiter-plan-button-starter')).toBeNull();
    expect(screen.queryByTestId('recruiter-plan-button-growth')).toBeNull();
    expect(screen.queryByTestId('recruiter-plan-button-fleet')).toBeNull();
    expect(supabaseMocks.invoke).not.toHaveBeenCalled();
  });

  it('admin_seed agency_growth owner: included at Fleet with no recruiter billing action', async () => {
    withAgency('agency_growth', 'active', 'admin_seed');
    renderPanel();
    const card = await screen.findByTestId('recruiter-agency-included-access');
    expect(card.textContent).toMatch(/Fleet/);
    expect(card.textContent).toMatch(/No recruiter billing action is required/i);
    expect(screen.queryByTestId('recruiter-plan-button-growth')).toBeNull();
  });

  it('manual_beta agency: no inclusion — recruiter upgrade actions remain available', async () => {
    withAgency('agency_starter', 'manual_beta', 'manual');
    renderPanel();
    await waitFor(() =>
      expect(
        screen.getByTestId('recruiter-plan-button-starter'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('recruiter-agency-included-access')).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByTestId('recruiter-plan-button-starter'),
      ).not.toBeDisabled(),
    );
  });

  it('non-owner member of a paid stripe agency: no inclusion granted', async () => {
    withAgency('agency_team', 'active', 'stripe', 'agency_member');
    renderPanel();
    await waitFor(() =>
      expect(
        screen.getByTestId('recruiter-plan-button-starter'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('recruiter-agency-included-access')).toBeNull();
  });

  it('agency sources still loading: checkout is blocked fail-closed', async () => {
    agencyMocks.agency = { id: 'agency-1', my_role: 'agency_owner' };
    agencyMocks.agencyLoading = true;
    renderPanel();
    await waitFor(() =>
      expect(
        screen.getByTestId('recruiter-plan-button-starter'),
      ).toBeDisabled(),
    );
    expect(supabaseMocks.invoke).not.toHaveBeenCalled();
  });

  it('agency source error: renders error card and blocks checkout', async () => {
    agencyMocks.agency = { id: 'agency-1', my_role: 'agency_owner' };
    agencyMocks.hasRow = true;
    agencyMocks.entError = true;
    renderPanel();
    await waitFor(() =>
      expect(
        screen.getByTestId('recruiter-business-entitlement-error'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId('recruiter-plan-button-starter')).toBeDisabled();
    expect(supabaseMocks.invoke).not.toHaveBeenCalled();
  });

  it('recruiter subscription + agency inclusion: conflict card, premium paused, checkout blocked', async () => {
    withBilling({ plan: 'starter', status: 'active', current_period_end: null });
    withAgency('agency_team', 'active', 'stripe');
    renderPanel();
    await waitFor(() =>
      expect(
        screen.getByTestId('recruiter-business-entitlement-conflict'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('recruiter-agency-included-access')).toBeNull();
    expect(screen.getByTestId('recruiter-plan-button-growth')).toBeDisabled();
    expect(supabaseMocks.invoke).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 1R-C-R1 — DIRECT real-hook contract tests for `useRecruiterBilling`.
//
// These exercise the production hook itself (not a rendered panel and not a
// mocked hook), proving the raw-versus-effective output contract, fail-closed
// behavior, posting truth, refresh invalidation, and input non-mutation.
// ---------------------------------------------------------------------------

type BillingHookResult = ReturnType<typeof useRecruiterBilling>;

function renderBillingHook() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const rendered = renderHook(() => useRecruiterBilling(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
  return { qc, result: rendered.result, unmount: rendered.unmount };
}

async function settledHook() {
  const h = renderBillingHook();
  await waitFor(() => expect(h.result.current.isLoading).toBe(false));
  await waitFor(() =>
    expect(h.result.current.businessEntitlementState).not.toBe('loading'),
  );
  return h;
}

describe('Phase 1R-C-R1 — real useRecruiterBilling raw vs effective contract', () => {
  it('no recruiter billing row + active stripe agency_starter owner yields included starter premium', async () => {
    withAgency('agency_starter', 'active', 'stripe');
    const { result } = await settledHook();
    const r = result.current as BillingHookResult;

    expect(r.plan).toBe('none');
    expect(r.status).toBe('inactive');
    expect(r.billing).toBeNull();
    expect(r.effectiveRecruiterPlan).toBe('starter');
    expect(r.effectiveRecruiterTier).toBe('starter');
    expect(r.capabilityTier).toBe('starter');
    expect(r.entitlementSource).toBe('agency_included');
    expect(r.billingManagementContext).toBe('agency');
    expect(r.businessEntitlementState).toBe('resolved');
    expect(r.hasEffectivePremiumRecruiterAccess).toBe(true);
    expect(r.canStartCheckout).toBe(false);
    expect(r.isPaidRecruiterPlanActive).toBe(false);
  });

  const AGENCY_TIER_MATRIX: ReadonlyArray<{
    agencyPlan: string;
    recruiterPlan: 'starter' | 'growth' | 'fleet';
  }> = [
    { agencyPlan: 'agency_starter', recruiterPlan: 'starter' },
    { agencyPlan: 'agency_team', recruiterPlan: 'growth' },
    { agencyPlan: 'agency_growth', recruiterPlan: 'fleet' },
  ];

  // trial-allowlist: Stripe subscription status literals, not user-facing copy
  const PREMIUM_AGENCY_STATUSES = ['active', 'trialing'] as const; // trial-allowlist — Stripe status literal, not user-facing copy

  for (const status of PREMIUM_AGENCY_STATUSES) {
    for (const { agencyPlan, recruiterPlan } of AGENCY_TIER_MATRIX) {
      it(`maps ${agencyPlan} (${status}) to recruiter ${recruiterPlan}`, async () => {
        withAgency(agencyPlan, status, 'stripe');
        const { result } = await settledHook();
        const r = result.current as BillingHookResult;
        expect(r.effectiveRecruiterTier).toBe(recruiterPlan);
        expect(r.effectiveRecruiterPlan).toBe(recruiterPlan);
        expect(r.effectiveAgencyPlan).toBe(agencyPlan);
        expect(r.entitlementSource).toBe('agency_included');
        expect(r.plan).toBe('none');
        expect(r.canStartCheckout).toBe(false);
      });
    }
  }

  it('active explicit recruiter plan with no includable agency preserves raw and effective recruiter values', async () => {
    withBilling({
      recruiter_id: 'rec-1',
      plan: 'growth',
      status: 'active',
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_1',
    });
    const { result } = await settledHook();
    const r = result.current as BillingHookResult;

    expect(r.plan).toBe('growth');
    expect(r.status).toBe('active');
    expect(r.effectiveRecruiterPlan).toBe('growth');
    expect(r.effectiveRecruiterTier).toBe('growth');
    expect(r.entitlementSource).toBe('recruiter_subscription');
    expect(r.billingManagementContext).toBe('recruiter');
    expect(r.effectiveAgencyPlan).toBeNull();
    expect(r.businessEntitlementState).toBe('resolved');
    expect(r.hasEffectivePremiumRecruiterAccess).toBe(true);
    expect(r.isPaidRecruiterPlanActive).toBe(true);
  });

  for (const role of ['agency_admin', 'agency_member'] as const) {
    it(`agency role ${role} never receives included recruiter premium`, async () => {
      withAgency('agency_growth', 'active', 'stripe', role);
      const { result } = await settledHook();
      const r = result.current as BillingHookResult;
      expect(r.effectiveRecruiterTier).toBe('free_verified');
      expect(r.effectiveRecruiterPlan).toBe('none');
      expect(r.entitlementSource).toBe('free_standard');
      expect(r.hasEffectivePremiumRecruiterAccess).toBe(false);
    });
  }

  it('agency entitlement with hasRow=false grants nothing', async () => {
    agencyMocks.agency = { id: 'agency-1', my_role: 'agency_owner' };
    agencyMocks.hasRow = false;
    const { result } = await settledHook();
    const r = result.current as BillingHookResult;
    expect(r.effectiveRecruiterTier).toBe('free_verified');
    expect(r.entitlementSource).toBe('free_standard');
    expect(r.hasEffectivePremiumRecruiterAccess).toBe(false);
  });

  it('manual_beta agency grants no premium but preserves the effective agency plan', async () => {
    withAgency('agency_team', 'manual_beta', 'manual');
    const { result } = await settledHook();
    const r = result.current as BillingHookResult;
    expect(r.effectiveRecruiterTier).toBe('free_verified');
    expect(r.effectiveAgencyPlan).toBe('agency_team');
    expect(r.entitlementSource).toBe('free_standard');
    expect(r.billingManagementContext).toBe('none');
  });

  it('past_due agency grants no premium and keeps an agency billing context', async () => {
    withAgency('agency_team', 'past_due', 'stripe');
    const { result } = await settledHook();
    const r = result.current as BillingHookResult;
    expect(r.effectiveRecruiterTier).toBe('free_verified');
    expect(r.hasEffectivePremiumRecruiterAccess).toBe(false);
    expect(r.billingManagementContext).toBe('agency');
  });

  it('unknown agency entitlement source fails closed', async () => {
    withAgency('agency_growth', 'active', 'mystery_source');
    const { result } = await settledHook();
    const r = result.current as BillingHookResult;
    expect(r.effectiveRecruiterTier).toBe('free_verified');
    expect(r.effectiveAgencyPlan).toBeNull();
    expect(r.entitlementSource).toBe('free_standard');
    expect(r.hasEffectivePremiumRecruiterAccess).toBe(false);
  });

  it('agency source loading fails closed while loading', async () => {
    withAgency('agency_growth', 'active', 'stripe');
    agencyMocks.entLoading = true;
    const { result } = renderBillingHook();
    await waitFor(() =>
      expect(result.current.businessEntitlementState).toBe('loading'),
    );
    expect(result.current.effectiveRecruiterTier).toBe('free_verified');
    expect(result.current.isBusinessEntitlementLoading).toBe(true);
    expect(result.current.hasEffectivePremiumRecruiterAccess).toBe(false);
    expect(result.current.canStartCheckout).toBe(false);
  });

  it('agency source error fails closed', async () => {
    withAgency('agency_growth', 'active', 'stripe');
    agencyMocks.entError = true;
    const { result } = renderBillingHook();
    await waitFor(() =>
      expect(result.current.businessEntitlementState).toBe('error'),
    );
    expect(result.current.effectiveRecruiterTier).toBe('free_verified');
    expect(result.current.hasEffectivePremiumRecruiterAccess).toBe(false);
    expect(result.current.canStartCheckout).toBe(false);
  });

  for (const source of ['manual', 'admin_seed'] as const) {
    it(`active ${source} included access maps the tier but reports billing context none`, async () => {
      withAgency('agency_team', 'active', source);
      const { result } = await settledHook();
      const r = result.current as BillingHookResult;
      expect(r.effectiveRecruiterTier).toBe('growth');
      expect(r.entitlementSource).toBe('agency_included');
      expect(r.billingManagementContext).toBe('none');
      expect(r.canStartCheckout).toBe(false);
    });
  }

  it('active stripe included access reports billing context agency', async () => {
    withAgency('agency_team', 'active', 'stripe');
    const { result } = await settledHook();
    expect(result.current.billingManagementContext).toBe('agency');
  });

  it('recruiter subscription + includable agency is an explicit fail-closed conflict', async () => {
    withBilling({
      recruiter_id: 'rec-1',
      plan: 'starter',
      status: 'active',
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_1',
    });
    withAgency('agency_team', 'active', 'stripe');
    const { result } = await settledHook();
    const r = result.current as BillingHookResult;

    expect(r.businessEntitlementState).toBe('conflict');
    expect(r.businessEntitlementConflictReason).toBe(
      'dual_paid_business_entitlement',
    );
    expect(r.effectiveRecruiterTier).toBe('free_verified');
    expect(r.effectiveRecruiterPlan).toBe('none');
    expect(r.effectiveAgencyPlan).toBeNull();
    expect(r.entitlementSource).toBe('none');
    expect(r.billingManagementContext).toBe('conflict');
    expect(r.hasEffectivePremiumRecruiterAccess).toBe(false);
    expect(r.canStartCheckout).toBe(false);
    // Raw recruiter billing is untouched by the conflict.
    expect(r.plan).toBe('starter');
    expect(r.status).toBe('active');
  });
});

describe('Phase 1R-C-R1 — real hook posting truth', () => {
  it('complete, non-suspended, unverified recruiter can still post standard opportunities', async () => {
    profileMocks.profile = {
      ...COMPLETE_PROFILE,
      verification_status: 'pending',
    };
    const { result } = await settledHook();
    expect(result.current.canPostStandardOpportunitiesCapability).toBe(true);
  });

  it('incomplete profile cannot post standard opportunities', async () => {
    profileMocks.profile = { ...COMPLETE_PROFILE, company_name: '' };
    const { result } = await settledHook();
    expect(result.current.canPostStandardOpportunitiesCapability).toBe(false);
  });

  it('suspended profile cannot post but keeps its effective paid tier', async () => {
    profileMocks.isSuspended = true;
    withAgency('agency_growth', 'active', 'stripe');
    const { result } = await settledHook();
    expect(result.current.canPostStandardOpportunitiesCapability).toBe(false);
    expect(result.current.effectiveRecruiterTier).toBe('fleet');
    expect(result.current.effectiveRecruiterPlan).toBe('fleet');
  });
});

describe('Phase 1R-C-R1 — real hook refresh invalidation and input purity', () => {
  it('refresh() invalidates exactly the recruiter and agency query-key prefixes', async () => {
    const { qc, result } = await settledHook();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    act(() => {
      result.current.refresh();
    });
    const keys = spy.mock.calls.map(
      (c) => (c[0] as { queryKey: unknown[] }).queryKey[0],
    );
    expect(keys).toEqual([
      'recruiter_billing',
      'recruiter_active_opportunity_count',
      'recruiter_profile',
      'my-agency',
      'agency-entitlement',
    ]);
    spy.mockRestore();
  });

  it('does not mutate the agency/profile source objects during resolution', async () => {
    withAgency('agency_team', 'active', 'stripe');
    const agencySnapshot = JSON.stringify(agencyMocks.agency);
    const entitlementSnapshot = JSON.stringify(agencyMocks.entitlement);
    const profileSnapshot = JSON.stringify(profileMocks.profile);

    const { result } = await settledHook();
    expect(result.current.entitlementSource).toBe('agency_included');

    expect(JSON.stringify(agencyMocks.agency)).toBe(agencySnapshot);
    expect(JSON.stringify(agencyMocks.entitlement)).toBe(entitlementSnapshot);
    expect(JSON.stringify(profileMocks.profile)).toBe(profileSnapshot);
  });
});

// ---------------------------------------------------------------------------
// Phase 1R-D2-B6-B1 — eligibility alignment + hostile popup containment
// ---------------------------------------------------------------------------

function makeHostileWindow() {
  return {
    get closed(): boolean {
      throw new DOMException('cross-origin', 'SecurityError');
    },
    set opener(_v: unknown) {
      throw new DOMException('cross-origin', 'SecurityError');
    },
    get opener(): unknown {
      throw new DOMException('cross-origin', 'SecurityError');
    },
    get location(): { href: string } {
      throw new DOMException('cross-origin', 'SecurityError');
    },
    close: vi.fn(() => {
      throw new DOMException('cross-origin', 'SecurityError');
    }),
  };
}

describe('Phase 1R-D2-B6-B1 — pending verification remains client-eligible', () => {
  it('complete profile with verification_status=pending navigates to the validated Stripe URL', async () => {
    profileMocks.profile = {
      ...COMPLETE_PROFILE,
      verification_status: 'pending',
    };
    profileMocks.isApproved = false;
    const w = makeWindow();
    openSpy.mockReturnValue(w as unknown as Window);
    supabaseMocks.invoke.mockResolvedValue({
      data: { code: 'checkout_ready', url: CHECKOUT_URL },
      error: null,
    });
    const user = userEvent.setup();
    renderPanel();

    const starter = screen.getByTestId('recruiter-plan-button-starter');
    await waitFor(() => expect(starter).not.toBeDisabled());
    await user.click(starter);

    await waitFor(() => expect(w.location.href).toBe(CHECKOUT_URL));
    expect(supabaseMocks.invoke).toHaveBeenCalledTimes(1);
  });
});

describe('Phase 1R-D2-B6-B1 — hostile popup containment', () => {
  it('successful checkout with a throwing popup falls back to the validated link without crashing', async () => {
    const hostile = makeHostileWindow();
    openSpy.mockReturnValue(hostile as unknown as Window);
    supabaseMocks.invoke.mockResolvedValue({
      data: { code: 'checkout_ready', url: CHECKOUT_URL },
      error: null,
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('recruiter-plan-button-starter'));

    const link = await screen.findByTestId('recruiter-billing-fallback');
    expect(link).toHaveAttribute('href', CHECKOUT_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(toastMocks.success).not.toHaveBeenCalled();
    // The panel is still rendered: no full-render exception occurred.
    expect(screen.getByTestId('recruiter-plan-button-starter')).toBeInTheDocument();
  });

  it('known server error with a throwing popup shows the controlled error and re-enables the plan button', async () => {
    const hostile = makeHostileWindow();
    openSpy.mockReturnValue(hostile as unknown as Window);
    supabaseMocks.invoke.mockResolvedValueOnce(
      invokeError(409, 'subscription_exists'),
    );
    const user = userEvent.setup();
    renderPanel();
    const starter = screen.getByTestId('recruiter-plan-button-starter');
    await user.click(starter);

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        RECRUITER_CHECKOUT_MESSAGES.subscription_exists,
      ),
    );
    // Panel survived: no full render exception.
    expect(
      screen.getByTestId('recruiter-plan-button-starter'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByTestId('recruiter-plan-button-starter'),
      ).not.toBeDisabled(),
    );
  });
});
