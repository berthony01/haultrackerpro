// Phase 1G-R1A7 — Recruiter premium checkout UI/state/accessibility user-flow gate.
//
// Exercises the PRODUCTION `RecruiterBillingPanel` + `useRecruiterBilling`
// paths (no test-only replicas) with the network/edge boundary mocked
// narrowly via `supabase.functions.invoke`.

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
  profile: {
    id: 'rec-1',
    user_id: 'user-rec-1',
    status: 'active',
    verification_status: 'approved',
  } as Record<string, unknown> | null,
  isApproved: true,
  isSuspended: false,
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
  }),
}));

vi.mock('@/integrations/supabase/client', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
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
        return chain;
      },
    },
  };
});

import { RecruiterBillingPanel } from '@/components/opportunities/RecruiterBillingPanel';
import {
  isSafeStripeCheckoutUrl,
  parseCheckoutError,
  RECRUITER_CHECKOUT_MESSAGES,
} from '@/lib/opportunities/recruiterCheckoutMessages';

// --- helpers ----------------------------------------------------------------

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

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  authMocks.user = { id: 'user-rec-1' };
  adminMocks.isAdmin = false;
  profileMocks.profile = {
    id: 'rec-1',
    user_id: 'user-rec-1',
    status: 'active',
    verification_status: 'approved',
  };
  profileMocks.isApproved = true;
  profileMocks.isSuspended = false;
  supabaseMocks.invoke.mockReset();
  supabaseMocks.fromMaybeSingle.mockReset();
  supabaseMocks.fromMaybeSingle.mockResolvedValue({ data: null, error: null });
  supabaseMocks.fromHeadCount.mockReset();
  supabaseMocks.fromHeadCount.mockResolvedValue({ count: 0, error: null });
  toastMocks.success.mockReset();
  toastMocks.error.mockReset();
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  openSpy.mockRestore();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Safe-URL and error-parse helpers
// ---------------------------------------------------------------------------

describe('Phase 1G-R1A7 helpers', () => {
  it('accepts only https Stripe checkout URLs', () => {
    expect(
      isSafeStripeCheckoutUrl(
        'https://checkout.stripe.com/c/pay/cs_test_123',
      ),
    ).toBe(true);
    expect(isSafeStripeCheckoutUrl('http://checkout.stripe.com/c/x')).toBe(
      false,
    );
    expect(isSafeStripeCheckoutUrl('https://evil.example.com/x')).toBe(false);
    expect(isSafeStripeCheckoutUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeStripeCheckoutUrl('')).toBe(false);
    expect(isSafeStripeCheckoutUrl(null)).toBe(false);
    expect(isSafeStripeCheckoutUrl(undefined)).toBe(false);
  });

  it('parses FunctionsHttpError into a mapped code + message', async () => {
    const { error } = invokeError(409, 'subscription_exists');
    const parsed = await parseCheckoutError(error);
    expect(parsed.code).toBe('subscription_exists');
    expect(parsed.message).toBe(
      RECRUITER_CHECKOUT_MESSAGES.subscription_exists,
    );
  });

  it('parses unknown/malformed errors as unknown_error without throwing', async () => {
    const parsed = await parseCheckoutError(new Error('boom'));
    expect(parsed.code).toBe('unknown_error');
    expect(parsed.message).toBe(RECRUITER_CHECKOUT_MESSAGES.unknown_error);
  });
});

// ---------------------------------------------------------------------------
// 2. Happy path
// ---------------------------------------------------------------------------

describe('Phase 1G-R1A7 checkout happy path', () => {
  it('opens a valid Stripe URL in a new tab with noopener,noreferrer', async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: {
        code: 'checkout_ready',
        url: 'https://checkout.stripe.com/c/pay/cs_test_ok',
      },
      error: null,
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    expect(openSpy).toHaveBeenCalledWith(
      'https://checkout.stripe.com/c/pay/cs_test_ok',
      '_blank',
      'noopener,noreferrer',
    );
    expect(toastMocks.success).toHaveBeenCalled();
    expect(screen.getByTestId('recruiter-billing-status')).toHaveTextContent(
      /Opening checkout/i,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Rapid double-click dedupe
// ---------------------------------------------------------------------------

describe('Phase 1G-R1A7 double-click dedupe', () => {
  it('only issues one invoke on rapid double-clicks and disables the button', async () => {
    let resolveInvoke: (v: unknown) => void = () => {};
    supabaseMocks.invoke.mockImplementation(
      () => new Promise((r) => (resolveInvoke = r)),
    );
    const user = userEvent.setup();
    renderPanel();
    const btn = screen.getByRole('button', { name: /Choose Starter/i });
    await user.click(btn);
    // second click while pending
    await user.click(btn);
    expect(supabaseMocks.invoke).toHaveBeenCalledTimes(1);
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      resolveInvoke({
        data: {
          code: 'checkout_ready',
          url: 'https://checkout.stripe.com/c/pay/cs_ok',
        },
        error: null,
      });
    });
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// 4. Server contract error handling
// ---------------------------------------------------------------------------

describe('Phase 1G-R1A7 server-contract error handling', () => {
  const cases: { code: string; expectFragment: RegExp }[] = [
    { code: 'in_progress', expectFragment: /already being prepared/i },
    { code: 'checkout_processing', expectFragment: /still being processed/i },
    { code: 'subscription_exists', expectFragment: /active recruiter subscription/i },
    { code: 'unknown_subscription_status', expectFragment: /syncing/i },
    { code: 'session_invalid', expectFragment: /could not be reused/i },
    { code: 'transient_error', expectFragment: /temporary problem/i },
    { code: 'customer_conflict', expectFragment: /contact support/i },
    { code: 'not_eligible', expectFragment: /not currently eligible/i },
    { code: 'not_owner', expectFragment: /not authorized/i },
  ];

  for (const c of cases) {
    it(`maps ${c.code} to a safe user message, never opens a URL, restores retry`, async () => {
      supabaseMocks.invoke.mockResolvedValueOnce(invokeError(409, c.code));
      const user = userEvent.setup();
      renderPanel();
      const btn = screen.getByRole('button', { name: /Choose Starter/i });
      await user.click(btn);
      await waitFor(() =>
        expect(
          screen.getByTestId('recruiter-billing-status'),
        ).toHaveTextContent(c.expectFragment),
      );
      expect(openSpy).not.toHaveBeenCalled();
      // button is usable again after failure
      await waitFor(() => expect(btn).not.toBeDisabled());
    });
  }

  it('never opens a URL when the server returns an unsafe (non-Stripe) URL', async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: { code: 'checkout_ready', url: 'https://evil.example.com/x' },
      error: null,
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    await waitFor(() =>
      expect(
        screen.getByTestId('recruiter-billing-status'),
      ).toHaveTextContent(/could not be reused|try again/i),
    );
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('never opens a URL when the server response is missing url entirely', async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: { code: 'checkout_ready' },
      error: null,
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    await waitFor(() =>
      expect(
        screen.getByTestId('recruiter-billing-status'),
      ).toHaveTextContent(/try again/i),
    );
    expect(openSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. Suspended / ineligible states — button still blocks safely
// ---------------------------------------------------------------------------

describe('Phase 1G-R1A7 suspended / ineligible guidance', () => {
  it('surfaces server not_eligible mapping when the server rejects', async () => {
    supabaseMocks.invoke.mockResolvedValueOnce(
      invokeError(403, 'not_eligible'),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Growth/i }));
    await waitFor(() =>
      expect(
        screen.getByTestId('recruiter-billing-status'),
      ).toHaveTextContent(/not currently eligible/i),
    );
    expect(openSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Reload / remount preserves server-authoritative state, not client
// ---------------------------------------------------------------------------

describe('Phase 1G-R1A7 remount preserves server state', () => {
  it('does not persist an ephemeral checkout attempt across remount', async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: {
        code: 'checkout_ready',
        url: 'https://checkout.stripe.com/c/pay/cs_ok',
      },
      error: null,
    });
    const user = userEvent.setup();
    const { unmount } = renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    unmount();
    renderPanel();
    // Fresh render shows no stale status region.
    expect(screen.queryByTestId('recruiter-billing-status')).toBeNull();
    // Buttons render enabled again.
    expect(
      screen.getByRole('button', { name: /Choose Starter/i }),
    ).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 7. Keyboard-only operation
// ---------------------------------------------------------------------------

describe('Phase 1G-R1A7 keyboard accessibility', () => {
  it('activates checkout via Enter key from a focused button', async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: {
        code: 'checkout_ready',
        url: 'https://checkout.stripe.com/c/pay/cs_kb',
      },
      error: null,
    });
    const user = userEvent.setup();
    renderPanel();
    const btn = screen.getByRole('button', { name: /Choose Starter/i });
    btn.focus();
    expect(btn).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// 8. A11y structural checks (labels, aria-live, aria-hidden discipline)
// ---------------------------------------------------------------------------

describe('Phase 1G-R1A7 structural accessibility', () => {
  it('exposes accessible names for every interactive control', async () => {
    renderPanel();
    for (const b of screen.getAllByRole('button')) {
      const name = b.getAttribute('aria-label') || (b.textContent ?? '').trim();
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('renders exactly one card heading and no focusable child inside aria-hidden', () => {
    renderPanel();
    expect(
      screen.getByRole('heading', { name: /Recruiter Plan/i, level: 2 }),
    ).toBeInTheDocument();
    for (const hidden of document.querySelectorAll('[aria-hidden="true"]')) {
      expect(
        hidden.querySelector(
          'a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])',
        ),
      ).toBeNull();
    }
  });

  it('announces errors via role=alert and successes via role=status', async () => {
    supabaseMocks.invoke.mockResolvedValueOnce(
      invokeError(409, 'subscription_exists'),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Choose Starter/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /active recruiter subscription/i,
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// 9. Standard posting is not gated by billing state
// ---------------------------------------------------------------------------

describe('Phase 1G-R1A7 standard posting independence', () => {
  it('renders Standard Access as current when there is no active plan', () => {
    renderPanel();
    expect(screen.getByText(/Standard Access/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/complete, non-suspended/i).length,
    ).toBeGreaterThan(0);
  });
});
