import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Phase R1c — real Chromium + Axe browser suite for the Recruiter billing
 * surface (RecruiterBillingPanel), driven through the REAL app route
 * (/dashboard?page=recruiter-access → RecruiterAccessRoute → RecruiterAccessPage
 * → RecruiterBillingPanel). No test-only component is used.
 *
 * Auth is 100% mocked: a fake Supabase session is injected into localStorage
 * before boot, and EVERY request to the placeholder Supabase host
 * (phase1g-r1c-test.supabase.co, baked into the build) is intercepted. A guard
 * route aborts any request to the real project host so nothing can leak.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POPUP MECHANICS (fixed after this suite's first real-Chromium run):
 *
 * `useRecruiterBilling.prepareTab()` originally opened the popup with
 *   window.open('about:blank', NAME, 'noopener,noreferrer')
 * Real-Chromium testing (this suite) proved that either 'noopener' OR
 * 'noreferrer' alone makes window.open() return `null` unconditionally
 * (Chromium treats noreferrer as implying noopener) — empirically confirmed
 * in Chromium 1228. That made the intended auto-navigate happy path dead
 * code: every successful checkout/portal response silently fell through to
 * the popup-blocked fallback-link branch. The source was corrected to open
 * the popup with no window-feature string, relying on the explicit
 * `w.opener = null` assignment already present in settleTab() for
 * anti-tabnabbing protection (the standard safe pattern for "keep a handle,
 * still close the reverse-tabnabbing vector").
 *
 * With the fix, this suite asserts the REAL happy path: a genuine popup
 * opens (satisfied by Playwright's synthetic click carrying a user-gesture
 * flag) and is navigated to the validated Stripe URL. The popup-BLOCKED
 * fallback path is still real production behavior (any browser/extension
 * that blocks the popup outright), so one dedicated test simulates a
 * blocked popup by overriding window.open to return null for that test only
 * — the only place in this suite where a browser API is stubbed rather than
 * exercised for real, and it is called out explicitly where it happens.
 * ─────────────────────────────────────────────────────────────────────────
 */

const SUPA_HOST = 'phase1g-r1c-test.supabase.co';
const REAL_SUPA_HOST = 'pngptztxwbtozwxrtbwo.supabase.co';
const PROJECT_REF = 'phase1g-r1c-test';
const LATEST_RELEASE_ID = 'v2025-04-simpler-plans';
const USER_ID = 'user-r1c-123';
const REC_ID = 'rec-r1c-1';
const ROUTE = '/dashboard?page=recruiter-access';

// FAKE mock Stripe URLs. Never real Stripe. Must satisfy the source's
// isSafeStripeCheckoutUrl / isSafeStripeBillingPortalUrl (exact host match).
const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_r1c_demo_0001';
const PORTAL_URL = 'https://billing.stripe.com/p/session/r1c_demo_portal_0001';
const UNSAFE_CHECKOUT_URL = 'https://checkout.stripe.com.evil.example/hijack';

// RECRUITER_CHECKOUT_COOLDOWN_MS in source is 5000ms.
const COOLDOWN_MS = 5000;

function baseProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: REC_ID,
    user_id: USER_ID,
    recruiter_name: 'Pat Recruiter',
    company_name: 'Acme Logistics',
    recruiter_email: 'pat@acme.example',
    recruiter_phone: null,
    dot_number: '1234567',
    mc_number: null,
    company_address: null,
    company_city: null,
    company_state: null,
    company_website: null,
    company_phone: null,
    driver_types_hired: [],
    equipment_types: [],
    hiring_states: [],
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
    ...overrides,
  };
}

function billingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bill-r1c-1',
    recruiter_id: REC_ID,
    user_id: USER_ID,
    plan: 'growth',
    status: 'active',
    active_opportunity_limit: 5,
    current_period_end: null,
    stripe_customer_id: 'cus_r1c_demo',
    stripe_subscription_id: 'sub_r1c_demo',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function fakeSession() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: 'fake-access-token-r1c',
    refresh_token: 'fake-refresh-token-r1c',
    token_type: 'bearer',
    expires_in: 31536000,
    expires_at: now + 31536000,
    user: {
      id: USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'pat@acme.example',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  };
}

interface FnResponse {
  status: number;
  body: unknown;
}

interface MockState {
  profile: Record<string, unknown> | null;
  billing: Record<string, unknown> | null;
  checkout: FnResponse;
  portal: FnResponse;
  counts: { checkout: number; portal: number; billingReads: number };
}

interface SetupOpts {
  profile?: Record<string, unknown> | null;
  billing?: Record<string, unknown> | null;
  checkout?: FnResponse;
  portal?: FnResponse;
  /** Artificial network latency before the checkout function responds.
   *  Used only to make a race-condition test (rapid double-click) exercise
   *  a realistic in-flight window instead of racing against an
   *  instantaneous local mock. Zero by default. */
  checkoutDelayMs?: number;
}

async function setup(context: BrowserContext, opts: SetupOpts = {}): Promise<MockState> {
  const state: MockState = {
    profile: opts.profile !== undefined ? opts.profile : baseProfile(),
    billing: opts.billing !== undefined ? opts.billing : null,
    checkout: opts.checkout ?? { status: 200, body: { url: CHECKOUT_URL } },
    portal: opts.portal ?? { status: 200, body: { url: PORTAL_URL } },
    counts: { checkout: 0, portal: 0, billingReads: 0 },
  };
  const checkoutDelayMs = opts.checkoutDelayMs ?? 0;

  // Inject the fake session + "release notes seen" flag BEFORE app boot so the
  // app comes up authenticated and the "What's New" modal never covers the
  // billing panel / accessibility tree.
  await context.addInitScript(
    ({ ref, sess, uid, releaseId }) => {
      try {
        window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
        window.localStorage.setItem(`htp:release-seen:${uid}`, releaseId);
      } catch {
        /* ignore */
      }
    },
    { ref: PROJECT_REF, sess: fakeSession(), uid: USER_ID, releaseId: LATEST_RELEASE_ID },
  );

  const json = (route: Route, body: unknown, headers: Record<string, string> = {}) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify(body),
    });

  await context.route(`**/${SUPA_HOST}/**`, async (route) => {
    const req = route.request();
    const method = req.method();
    const p = new URL(req.url()).pathname;

    // Realtime websocket handshake — block so it never hangs the test.
    if (p.includes('/realtime/')) return route.abort();

    // Auth — session already injected; satisfy any refresh/user probe.
    if (p.includes('/auth/v1/token')) return json(route, fakeSession());
    if (p.includes('/auth/v1/user')) return json(route, fakeSession().user);
    if (p.startsWith('/auth/')) return json(route, {});

    // Role / identity RPCs.
    if (p.includes('/rest/v1/rpc/is_current_user_recruiter')) return json(route, true);
    if (p.includes('/rest/v1/rpc/get_my_recruiter_profile_safe'))
      return json(route, state.profile ? [state.profile] : []);
    if (p.includes('/rest/v1/rpc/apply_recruiter_intent')) return json(route, { applied: false });
    // Any other RPC (managed drivers, delegations, applications, etc.).
    if (p.startsWith('/rest/v1/rpc/')) return json(route, []);

    // profiles: used by useUserRole (intended_role) AND useReleaseNotesSeen
    // (last_seen_release_id). maybeSingle() fetches as a list.
    if (p.includes('/rest/v1/profiles'))
      return json(route, [{ intended_role: 'recruiter', last_seen_release_id: LATEST_RELEASE_ID }]);

    // Not an admin → effectiveRole stays pinned to the real 'recruiter' role.
    if (p.includes('/rest/v1/admin_users')) return json(route, []);

    if (p.includes('/rest/v1/recruiter_billing_profiles')) {
      state.counts.billingReads += 1;
      return json(route, state.billing ? [state.billing] : []);
    }

    if (p.includes('/rest/v1/opportunities')) {
      if (method === 'HEAD')
        return route.fulfill({ status: 200, headers: { 'content-range': '*/0' }, body: '' });
      return json(route, []);
    }

    // Edge functions.
    if (p.includes('/functions/v1/create-recruiter-checkout')) {
      state.counts.checkout += 1;
      if (checkoutDelayMs > 0) await new Promise((r) => setTimeout(r, checkoutDelayMs));
      return route.fulfill({
        status: state.checkout.status,
        contentType: 'application/json',
        body: JSON.stringify(state.checkout.body),
      });
    }
    if (p.includes('/functions/v1/recruiter-billing-portal')) {
      state.counts.portal += 1;
      return route.fulfill({
        status: state.portal.status,
        contentType: 'application/json',
        body: JSON.stringify(state.portal.body),
      });
    }
    // check-subscription and any other function → harmless empty payload.
    if (p.includes('/functions/v1/')) return json(route, {});

    // Any other REST table read (loads, expenses, notifications HEAD, etc.).
    if (method === 'HEAD')
      return route.fulfill({ status: 200, headers: { 'content-range': '*/0' }, body: '' });
    if (p.startsWith('/rest/v1/')) return json(route, []);
    return json(route, {});
  });

  // Hard guard: NOTHING may reach the real Supabase project host.
  await context.route(`**/${REAL_SUPA_HOST}/**`, (route) => route.abort('failed'));

  // Swallow realtime websockets without connecting to any real server.
  try {
    await context.routeWebSocket(`**/${SUPA_HOST}/**`, () => {});
  } catch {
    /* older Playwright without routeWebSocket — REST route.abort covers it */
  }

  return state;
}

// Locators
const panel = (page: Page) => page.locator('[aria-labelledby="recruiter-billing-heading"]');
const heading = (page: Page) => page.locator('#recruiter-billing-heading');
const statusRegion = (page: Page) => page.getByTestId('recruiter-billing-status');
const checkStatusBtn = (page: Page) => page.getByTestId('recruiter-billing-check-status');
const fallbackLink = (page: Page) => page.getByTestId('recruiter-billing-fallback');
const portalFallbackLink = (page: Page) => page.getByTestId('recruiter-billing-portal-fallback');
const manageBillingBtn = (page: Page) => page.getByTestId('recruiter-manage-billing');
const planBtn = (page: Page, key: 'starter' | 'growth' | 'fleet') =>
  page.getByTestId(`recruiter-plan-button-${key}`);

async function gotoPanel(page: Page) {
  await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
  await expect(heading(page)).toBeVisible({ timeout: 20_000 });
  await expect(heading(page)).toHaveText('Recruiter Plan');
}

async function tabUntil(page: Page, testId: string, max = 60): Promise<number> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-testid') ?? null,
    );
    if (active === testId) return i + 1;
  }
  return -1;
}

test.describe('Recruiter billing surface — R1c', () => {
  test('eligible-idle renders the real panel with three enabled plan buttons and no error surfaces', async ({
    page,
  }) => {
    await setup(page.context(), { billing: null });
    await gotoPanel(page);

    // Idle state → no headline/status region, no fallback, no Manage Billing.
    await expect(statusRegion(page)).toHaveCount(0);
    await expect(fallbackLink(page)).toHaveCount(0);
    await expect(manageBillingBtn(page)).toHaveCount(0);

    for (const key of ['starter', 'growth', 'fleet'] as const) {
      await expect(planBtn(page, key)).toBeVisible();
      await expect(planBtn(page, key)).toBeEnabled();
    }

    // Standard-access copy is present regardless of billing.
    await expect(panel(page)).toContainText('Standard Recruiter Access');
    await expect(panel(page)).toContainText('Standard opportunity posting');
  });

  test('eligible first checkout: one request, one real popup auto-navigated to the validated Stripe URL', async ({
    page,
  }) => {
    const state = await setup(page.context(), {
      billing: null,
      checkout: { status: 200, body: { url: CHECKOUT_URL } },
    });
    await gotoPanel(page);

    const popupPromise = page.context().waitForEvent('page', { timeout: 8_000 });
    await planBtn(page, 'growth').click();

    // Real happy path: a genuine popup opens synchronously off the click and
    // is navigated to the validated Stripe checkout URL. No fallback link,
    // no error surface — this is success.
    const popup = await popupPromise;
    await popup.waitForURL(CHECKOUT_URL, { timeout: 10_000 }).catch(() => {});
    expect(popup.url()).toBe(CHECKOUT_URL);
    expect(new URL(popup.url()).hostname).toBe('checkout.stripe.com');
    expect(await popup.evaluate(() => window.opener)).toBeNull();

    await expect(fallbackLink(page)).toHaveCount(0);
    await expect(statusRegion(page)).toHaveCount(0);

    // Exactly one checkout request, exactly one popup opened.
    expect(state.counts.checkout).toBe(1);
    await popup.close();
  });

  test('rapid double-click issues exactly one checkout request and opens at most one popup', async ({
    page,
  }) => {
    // A realistic network delay is required to actually exercise the
    // in-flight race window: against an instantaneous local mock, the first
    // request can complete (and the client's in-flight guard reset) before
    // the second click even lands, which would make this test pass for the
    // wrong reason. 300ms comfortably exceeds Playwright's real click-to-
    // click latency (empirically ~50-70ms here) so the second click always
    // lands while the first request is still pending.
    const state = await setup(page.context(), {
      billing: null,
      checkoutDelayMs: 300,
    });
    await gotoPanel(page);

    let popups = 0;
    page.context().on('page', () => {
      popups += 1;
    });

    const btn = planBtn(page, 'growth');
    await btn.click({ delay: 0 });
    await btn.click({ delay: 0, force: true }).catch(() => {});

    await page.waitForTimeout(800);

    expect(state.counts.checkout).toBe(1);
    expect(popups).toBeLessThanOrEqual(1);
  });

  test('popup-blocked fallback link is a validated Stripe URL with safe rel/target and is not treated as success', async ({
    page,
  }) => {
    await setup(page.context(), {
      billing: null,
      checkout: { status: 200, body: { url: CHECKOUT_URL } },
    });
    // The ONLY stub in this suite: simulate a real popup blocker (a browser
    // or extension that returns null from window.open) so the fallback path
    // is deterministically exercised. Everything else in this suite uses the
    // real, unstubbed window.open.
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await gotoPanel(page);

    await planBtn(page, 'growth').click();
    await expect(fallbackLink(page)).toBeVisible({ timeout: 10_000 });

    const link = fallbackLink(page);
    expect(await link.getAttribute('href')).toBe(CHECKOUT_URL);
    expect(await link.getAttribute('target')).toBe('_blank');
    expect(await link.getAttribute('rel')).toContain('noopener');
    expect(await link.getAttribute('rel')).toContain('noreferrer');
    await expect(statusRegion(page)).toHaveAttribute('data-state', 'popup_blocked_checkout');
    // Not treated as success: no active subscription copy appeared.
    await expect(panel(page)).not.toContainText('Your recruiter subscription is active.');
  });

  test('server failure is not treated as success: error headline, no fallback link, buttons recover', async ({
    page,
  }) => {
    await setup(page.context(), {
      billing: null,
      checkout: { status: 500, body: { code: 'internal_error' } },
    });
    await gotoPanel(page);

    await planBtn(page, 'growth').click();

    await expect(statusRegion(page)).toBeVisible({ timeout: 10_000 });
    await expect(statusRegion(page)).toHaveAttribute('data-state', 'retryable_error');
    await expect(statusRegion(page)).toContainText(
      'Billing is temporarily unavailable. Please try again later.',
    );
    await expect(fallbackLink(page)).toHaveCount(0);
    // retryable_error still permits a fresh checkout → button re-enabled.
    await expect(planBtn(page, 'starter')).toBeEnabled();
  });

  test('unsafe checkout URL is rejected (no fallback, session-invalid error), never opened', async ({
    page,
  }) => {
    await setup(page.context(), {
      billing: null,
      checkout: { status: 200, body: { url: UNSAFE_CHECKOUT_URL } },
    });
    await gotoPanel(page);

    await planBtn(page, 'growth').click();

    await expect(statusRegion(page)).toBeVisible({ timeout: 10_000 });
    await expect(statusRegion(page)).toHaveAttribute('data-state', 'retryable_error');
    await expect(statusRegion(page)).toContainText(
      'The previous checkout could not be reused. Please try again.',
    );
    await expect(fallbackLink(page)).toHaveCount(0);
  });

  test('in_progress: buttons locked, Check Status visible-then-clickable after cooldown, then refetches', async ({
    page,
  }) => {
    const state = await setup(page.context(), {
      billing: null,
      checkout: { status: 409, body: { code: 'in_progress' } },
    });
    await gotoPanel(page);

    await planBtn(page, 'growth').click();

    await expect(statusRegion(page)).toHaveAttribute('data-state', 'in_progress', {
      timeout: 10_000,
    });
    await expect(statusRegion(page)).toContainText('A checkout is already being prepared');
    // Plan buttons locked while a checkout is in progress.
    await expect(planBtn(page, 'starter')).toBeDisabled();
    // Check Status visible but not yet clickable (cooldown).
    await expect(checkStatusBtn(page)).toBeVisible();
    await expect(checkStatusBtn(page)).toBeDisabled();

    const readsBefore = state.counts.billingReads;
    // After the cooldown window it becomes clickable.
    await expect(checkStatusBtn(page)).toBeEnabled({ timeout: COOLDOWN_MS + 4_000 });
    await checkStatusBtn(page).click();

    // Clicking it refetches billing from the (mocked) server.
    await expect.poll(() => state.counts.billingReads).toBeGreaterThan(readsBefore);
    // Server progress cleared → back to idle (billing still null).
    await expect(statusRegion(page)).toHaveCount(0);
  });

  test('checkout_processing: processing headline and Check Status surface shown', async ({
    page,
  }) => {
    await setup(page.context(), {
      billing: null,
      checkout: { status: 409, body: { code: 'checkout_processing' } },
    });
    await gotoPanel(page);

    await planBtn(page, 'growth').click();

    await expect(statusRegion(page)).toHaveAttribute('data-state', 'processing', {
      timeout: 10_000,
    });
    await expect(statusRegion(page)).toContainText('Your previous checkout is still being processed');
    await expect(checkStatusBtn(page)).toBeVisible();
    await expect(planBtn(page, 'starter')).toBeDisabled();
  });

  // Subscription-state matrix.
  const SUB_CASES: {
    status: string;
    kind: string;
    headline: string;
    canStart: boolean;
  }[] = [
    { status: 'active', kind: 'sub_active', headline: 'Your recruiter subscription is active.', canStart: false },
    { status: 'trialing', kind: 'sub_trialing', headline: 'Your recruiter subscription is currently in a trial. Use Manage Billing to review or change plans.', canStart: false },
    { status: 'past_due', kind: 'sub_past_due', headline: 'Your last payment did not go through. Please update your payment method in Manage Billing to keep premium features.', canStart: false },
    { status: 'unpaid', kind: 'sub_unpaid', headline: 'Your subscription is unpaid. Please update your payment method in Manage Billing to restore premium features.', canStart: false },
    { status: 'incomplete', kind: 'sub_incomplete', headline: 'Your last checkout was not completed. Please finish payment from Manage Billing, or wait for it to expire before starting a new one.', canStart: false },
    { status: 'paused', kind: 'sub_paused', headline: 'Your subscription is paused. Use Manage Billing to resume premium features.', canStart: false },
    { status: 'canceled', kind: 'sub_canceled', headline: 'Your subscription has been canceled. You can start a new plan below.', canStart: true },
    { status: 'incomplete_expired', kind: 'sub_incomplete_expired', headline: 'Your previous checkout expired. You can start a new checkout below.', canStart: true },
    { status: 'some_unrecognized_status', kind: 'sub_unknown', headline: 'Your subscription status is currently syncing. Please refresh in a moment.', canStart: false },
  ];

  for (const c of SUB_CASES) {
    test(`subscription state "${c.status}" → ${c.kind} with correct copy and blocking behavior`, async ({
      page,
    }) => {
      await setup(page.context(), { billing: billingRow({ status: c.status, plan: 'growth' }) });
      await gotoPanel(page);

      await expect(statusRegion(page)).toHaveAttribute('data-state', c.kind);
      await expect(statusRegion(page)).toContainText(c.headline);

      if (c.canStart) {
        await expect(planBtn(page, 'starter')).toBeEnabled();
      } else {
        await expect(planBtn(page, 'starter')).toBeDisabled();
      }

      // Billing history exists → Manage Billing is offered.
      await expect(manageBillingBtn(page)).toBeVisible();

      if (c.kind === 'sub_unknown') {
        await expect(checkStatusBtn(page)).toBeVisible();
        await expect(checkStatusBtn(page)).toBeEnabled();
      }
    });
  }

  test('suspended recruiter: billing panel is correctly gated out and the suspended notice blocks posting', async ({
    page,
  }) => {
    // The real RecruiterAccessPage only mounts RecruiterBillingPanel for an
    // eligible (canPost) recruiter. A suspended recruiter therefore never
    // reaches the panel — the correct blocking behavior is the suspended
    // StateCard + disabled "Post an Opportunity". (The panel's internal
    // 'suspended' branch is defensive/unreachable via this route.)
    await setup(page.context(), {
      profile: baseProfile({ status: 'suspended', verification_status: 'suspended' }),
      billing: null,
    });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Recruiter Access Suspended', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(heading(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Post an Opportunity/ })).toBeDisabled();
  });

  test('premium-ineligible (incomplete profile): panel gated out, profile-completion prompt blocks posting', async ({
    page,
  }) => {
    // Incomplete profile (no DOT/MC) → canPost false → panel not mounted.
    await setup(page.context(), {
      profile: baseProfile({ dot_number: null, mc_number: null }),
      billing: null,
    });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Finish your recruiter profile').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(heading(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Post an Opportunity/ })).toBeDisabled();
  });

  test('Manage Billing portal flow opens a real popup auto-navigated to the validated billing URL', async ({
    page,
  }) => {
    const state = await setup(page.context(), {
      billing: billingRow({ status: 'active' }),
      portal: { status: 200, body: { url: PORTAL_URL } },
    });
    await gotoPanel(page);

    await expect(manageBillingBtn(page)).toBeVisible();
    const popupPromise = page.context().waitForEvent('page', { timeout: 8_000 });
    await manageBillingBtn(page).click();

    const popup = await popupPromise;
    await popup.waitForURL(PORTAL_URL, { timeout: 10_000 }).catch(() => {});
    expect(popup.url()).toBe(PORTAL_URL);
    expect(new URL(popup.url()).hostname).toBe('billing.stripe.com');
    expect(await popup.evaluate(() => window.opener)).toBeNull();

    await expect(portalFallbackLink(page)).toHaveCount(0);
    expect(state.counts.portal).toBe(1);
    await popup.close();
  });

  test('Manage Billing portal: blocked popup surfaces a validated billing.stripe.com fallback link', async ({
    page,
  }) => {
    const state = await setup(page.context(), {
      billing: billingRow({ status: 'active' }),
      portal: { status: 200, body: { url: PORTAL_URL } },
    });
    // Only stub in this test: simulate a blocked popup (see checkout's
    // equivalent test above for rationale).
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await gotoPanel(page);

    await expect(manageBillingBtn(page)).toBeVisible();
    await manageBillingBtn(page).click();

    await expect(portalFallbackLink(page)).toBeVisible({ timeout: 10_000 });
    const href = await portalFallbackLink(page).getAttribute('href');
    expect(href).toBe(PORTAL_URL);
    expect(new URL(href!).hostname).toBe('billing.stripe.com');
    await expect(statusRegion(page)).toHaveAttribute('data-state', 'popup_blocked_portal');
    expect(state.counts.portal).toBe(1);
  });

  test('Manage Billing portal failure surfaces a retryable error, not a portal link', async ({
    page,
  }) => {
    // Billing row present (so Manage Billing is offered) but status 'inactive'
    // → uiState is eligible_idle, so the portal retryable error is not masked
    // by a sub_* state.
    await setup(page.context(), {
      billing: billingRow({ status: 'inactive' }),
      portal: { status: 500, body: { code: 'internal_error' } },
    });
    await gotoPanel(page);

    await manageBillingBtn(page).click();
    await expect(statusRegion(page)).toHaveAttribute('data-state', 'retryable_error', {
      timeout: 10_000,
    });
    await expect(portalFallbackLink(page)).toHaveCount(0);
  });

  test('reload rehydrates panel state from mocked server (active subscription persists)', async ({
    page,
  }) => {
    await setup(page.context(), { billing: billingRow({ status: 'active' }) });
    await gotoPanel(page);
    await expect(statusRegion(page)).toHaveAttribute('data-state', 'sub_active');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(heading(page)).toBeVisible({ timeout: 20_000 });
    await expect(statusRegion(page)).toHaveAttribute('data-state', 'sub_active');
    await expect(manageBillingBtn(page)).toBeVisible();
  });

  test('keyboard-only: Tab reaches a plan button with visible focus, Enter and Space activate checkout, no trap', async ({
    page,
  }) => {
    const state = await setup(page.context(), { billing: null });
    // Blocked-popup stub so keyboard activation is observed via the
    // deterministic fallback-link surface (see rationale on the dedicated
    // popup-blocked test above) rather than racing a real popup window.
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await gotoPanel(page);

    // Start from a known control inside the panel, then drive with Tab only.
    await page.getByRole('button', { name: 'Refresh billing status' }).focus();
    const steps = await tabUntil(page, 'recruiter-plan-button-starter');
    expect(steps).toBeGreaterThan(0); // reachable by keyboard (no trap before it)

    // Visible keyboard focus (Chromium :focus-visible after Tab navigation).
    const focusVisible = await page.evaluate(
      () => document.activeElement?.matches(':focus-visible') ?? false,
    );
    expect(focusVisible).toBe(true);

    // Enter activates the focused plan button.
    await page.keyboard.press('Enter');
    await expect(fallbackLink(page)).toBeVisible({ timeout: 10_000 });
    expect(state.counts.checkout).toBe(1);

    // Space activation on a fresh load.
    const state2 = await setup(page.context(), { billing: null });
    void state2;
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(heading(page)).toBeVisible({ timeout: 20_000 });
    await planBtn(page, 'growth').focus();
    // Can continue tabbing past the plan buttons → not trapped.
    await page.keyboard.press('Tab');
    const movedOff = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') !== 'recruiter-plan-button-growth',
    );
    expect(movedOff).toBe(true);
    await planBtn(page, 'growth').focus();
    await page.keyboard.press('Space');
    await expect(fallbackLink(page)).toBeVisible({ timeout: 10_000 });
  });

  test('standard-posting copy is independent of billing state', async ({ page }) => {
    // Active subscription — premium is live, but standard-access copy is unchanged.
    await setup(page.context(), { billing: billingRow({ status: 'active' }) });
    await gotoPanel(page);
    await expect(panel(page)).toContainText('Standard Recruiter Access');
    await expect(panel(page)).toContainText('Standard opportunity posting');
    await expect(panel(page)).toContainText(
      'Included with a complete, non-suspended Recruiter profile',
    );
  });

  test('Axe: eligible-idle state has zero serious/critical violations', async ({ page }) => {
    await setup(page.context(), { billing: null });
    await gotoPanel(page);

    const results = await new AxeBuilder({ page })
      .include('[aria-labelledby="recruiter-billing-heading"]')
      .analyze();

    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    const lower = results.violations.filter(
      (v) => v.impact !== 'serious' && v.impact !== 'critical',
    );
    if (lower.length) {
      console.log(
        'Axe (eligible-idle) non-serious violations:',
        JSON.stringify(lower.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))),
      );
    }
    // Phase 1G-R1A7-R1: the app-wide primary theme token was previously
    // 2.87:1 (later measured 4.38:1 after a first darkening pass) against
    // white text — below WCAG AA 4.5:1. It has been corrected (--primary
    // darkened to 25 100% 33% in src/index.css) and re-verified against
    // Axe's actual rendered-pixel measurement, not just the theoretical HSL
    // math. No carve-out: every serious/critical violation fails this gate.
    expect(seriousOrCritical.map((v) => ({ id: v.id, impact: v.impact }))).toEqual([]);
  });

  test('Axe: popup-blocked (error) state has zero serious/critical violations', async ({ page }) => {
    await setup(page.context(), { billing: null });
    // Simulate a blocked popup (see the dedicated popup-blocked test above
    // for rationale) so this Axe scan actually covers that state's markup.
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await gotoPanel(page);
    await planBtn(page, 'growth').click();
    await expect(fallbackLink(page)).toBeVisible({ timeout: 10_000 });

    const results = await new AxeBuilder({ page })
      .include('[aria-labelledby="recruiter-billing-heading"]')
      .analyze();

    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    const lower = results.violations.filter(
      (v) => v.impact !== 'serious' && v.impact !== 'critical',
    );
    if (lower.length) {
      console.log(
        'Axe (popup-blocked) non-serious violations:',
        JSON.stringify(lower.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))),
      );
    }
    // No carve-out (see the eligible-idle Axe test above for the contrast
    // fix this relies on). Every serious/critical violation fails this gate.
    expect(seriousOrCritical.map((v) => ({ id: v.id, impact: v.impact }))).toEqual([]);
  });

  const VIEWPORTS: { w: number; h: number; shot?: string }[] = [
    { w: 320, h: 568 },
    { w: 375, h: 812, shot: 'mobile-375x812' },
    { w: 390, h: 844 },
    { w: 768, h: 1024 },
    { w: 1280, h: 900, shot: 'desktop-1280x900' },
    { w: 1440, h: 900 },
  ];

  test('responsive: no horizontal overflow across required viewports (+ mobile/desktop screenshots)', async ({
    page,
  }, testInfo) => {
    await setup(page.context(), { billing: billingRow({ status: 'active' }) });

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await gotoPanel(page);
      await panel(page).scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);

      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      // Allow 1px sub-pixel rounding tolerance.
      expect(
        metrics.scrollWidth,
        `horizontal overflow at ${vp.w}x${vp.h} (scrollWidth ${metrics.scrollWidth} > clientWidth ${metrics.clientWidth})`,
      ).toBeLessThanOrEqual(metrics.clientWidth + 1);

      // Primary controls remain rendered with a real box (not clipped to zero).
      const box = await planBtn(page, 'starter').boundingBox();
      expect(box, `starter plan button missing at ${vp.w}x${vp.h}`).not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);

      if (vp.shot) {
        await page.screenshot({
          path: testInfo.outputPath(`recruiter-billing-${vp.shot}.png`),
          fullPage: true,
        });
      }
    }
  });
});
