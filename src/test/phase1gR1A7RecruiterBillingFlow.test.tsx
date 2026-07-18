// Phase 1G-R1A7-R1 corrected — Recruiter premium checkout UI/state
// user-flow gate. Exercises the PRODUCTION `RecruiterBillingPanel` +
// `useRecruiterBilling` code paths (no replicas) with only the network
// boundary (`supabase.functions.invoke` + `.from(...).maybeSingle()`)
// and `useAuth` / `useRecruiterProfile` narrowly mocked.

import {
  act,
  cleanup,
  render,
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
vi.mock('@/hooks/opportunities/useRecruiterProfile', () => ({
  useRecruiterProfile: () => ({
    profile: profileMocks.profile,
    isApproved: profileMocks.isApproved,
    isSuspended: profileMocks.isSuspended,
    isLoading: profileMocks.isLoading,
  }),
}));

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
  it('opens the deterministic named popup synchronously with noopener,noreferrer', async () => {
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
      'noopener,noreferrer',
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
    vi.useFakeTimers();
    supabaseMocks.invoke.mockResolvedValueOnce(invokeError(409, 'in_progress'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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
    const cs = screen.getByTestId('recruiter-billing-check-status');
    expect(cs).toBeDisabled();
  });

  it('enables Check Status after cooldown and refetches on click', async () => {
    vi.useFakeTimers();
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
  { status: 'trialing', dataState: 'sub_trialing', fragment: /trial/i, blocks: true },
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
        plan: c.status === 'active' || c.status === 'trialing' ? 'starter' : 'none',
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
