/**
 * Phase TG-2E3-O12 — Owner QA Center UX.
 *
 * Proves the owner-only QA control page reuses the EXISTING Owner QA session
 * hook, never touches Stripe/billing, and only links to routes that actually
 * exist in App.tsx.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setPersona = vi.fn(async () => {});
const disable = vi.fn(async () => {});

const qaState = {
  isOwner: true,
  isActive: false,
  domain: null as string | null,
  persona: null as string | null,
  label: null as string | null,
  expiresAt: null as string | null,
  selection: null as unknown,
  isLoading: false,
  isMutating: false,
  error: null as Error | null,
  setPersona,
  disable,
  refetch: vi.fn(),
};

vi.mock('@/hooks/useOwnerQaPersona', () => ({
  useOwnerQaPersona: () => qaState,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Supabase must never be reached by this page.
const invoke = vi.fn(async () => ({ data: null, error: null }));
const rpc = vi.fn(async () => ({ data: null, error: null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke }, rpc },
}));

import OwnerQaCenter from '@/pages/OwnerQaCenter';

const root = path.resolve(__dirname, '../..');
const pageSource = readFileSync(
  path.join(root, 'src/pages/OwnerQaCenter.tsx'),
  'utf8',
);
const appSource = readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const sidebarSource = readFileSync(
  path.join(root, 'src/components/admin/AdminSidebar.tsx'),
  'utf8',
);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/owner-qa']}>
      <OwnerQaCenter />
    </MemoryRouter>,
  );
}

/**
 * O13 integration: rendering OwnerQaCenter legitimately invokes the
 * `owner_qa_fixture_reset_preview` RPC on mount. Assert that the preview is
 * the only rpc invoked by mere render / persona-switch / end-QA flows, that
 * the destructive `owner_qa_fixture_reset` is never called without the
 * explicit O13 confirmation, and that no billing/Stripe/checkout surface is
 * ever touched from this page.
 */
function expectOnlyAuthorizedResetRpc() {
  expect(rpc).toHaveBeenCalledWith('owner_qa_fixture_reset_preview');
  for (const call of rpc.mock.calls) {
    expect(call[0]).toBe('owner_qa_fixture_reset_preview');
  }
  expect(rpc).not.toHaveBeenCalledWith('owner_qa_fixture_reset');
  for (const call of rpc.mock.calls) {
    expect(String(call[0])).not.toMatch(
      /checkout|stripe|billing|portal|subscription|customer|payment|invoice/i,
    );
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(qaState, {
    isOwner: true,
    isActive: false,
    domain: null,
    persona: null,
    label: null,
    expiresAt: null,
    isLoading: false,
    isMutating: false,
    error: null,
  });
});

describe('O12 — access control', () => {
  it('A) non-owner does not render the Owner QA Center', () => {
    qaState.isOwner = false;
    renderPage();
    expect(screen.queryByTestId('owner-qa-center')).toBeNull();
    expect(screen.queryByText('Owner QA Center')).toBeNull();
  });

  it('A2) renders nothing while ownership is still resolving', () => {
    qaState.isLoading = true;
    renderPage();
    expect(screen.queryByTestId('owner-qa-center')).toBeNull();
  });
});

describe('O12 — inactive owner state', () => {
  it('B) renders the control center with no Stripe/billing action', () => {
    renderPage();
    expect(screen.getByTestId('owner-qa-center')).toBeInTheDocument();
    expect(screen.getByTestId('owner-qa-state-badge')).toHaveTextContent('Inactive');
    expect(screen.queryByTestId('owner-qa-end')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    // No billing invocation surface: no edge-function names, no billing hooks.
    expect(pageSource).not.toMatch(
      /create-checkout|customer-portal|recruiter-billing-portal|agency-customer-portal|functions\.invoke|useSubscription|useAgencyEntitlement|useRecruiterBilling/,
    );
  });
});

describe('O12 — active owner state', () => {
  beforeEach(() => {
    Object.assign(qaState, {
      isActive: true,
      domain: 'recruiter',
      persona: 'growth',
      label: 'Recruiter Growth',
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
  });

  it('C) shows current domain, persona and remaining session time', () => {
    renderPage();
    expect(screen.getByTestId('owner-qa-state-badge')).toHaveTextContent('Active');
    expect(screen.getByTestId('owner-qa-current-domain')).toHaveTextContent('Recruiter');
    expect(screen.getByTestId('owner-qa-current-persona')).toHaveTextContent('Recruiter Growth');
    expect(screen.getByTestId('owner-qa-expiry')).toHaveTextContent(/min remaining/);
  });

  it('C2) marks the active persona as selected', () => {
    renderPage();
    expect(screen.getByTestId('owner-qa-persona-recruiter-growth')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('owner-qa-persona-driver-pro_monthly')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('E) End QA Mode calls the existing disable method', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('owner-qa-end'));
    await waitFor(() => expect(disable).toHaveBeenCalledTimes(1));
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('O12 — persona switching', () => {
  it('D) calls the existing setPersona with the exact domain/persona and no billing call', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('owner-qa-persona-agency-agency_team'));
    await waitFor(() => expect(setPersona).toHaveBeenCalledTimes(1));
    expect(setPersona).toHaveBeenCalledWith('agency', 'agency_team');
    expect(invoke).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('D2) exposes every live persona from the source-of-truth vocabulary', () => {
    renderPage();
    for (const id of [
      'driver-free',
      'driver-pro_monthly',
      'driver-pro_yearly',
      'recruiter-free_verified',
      'recruiter-starter',
      'recruiter-growth',
      'recruiter-fleet',
      'agency-assistant_free',
      'agency-agency_starter',
      'agency-agency_team',
      'agency-agency_growth',
    ]) {
      expect(screen.getByTestId(`owner-qa-persona-${id}`)).toBeInTheDocument();
    }
  });
});

describe('O12 — shortcuts and wiring', () => {
  it('F) every shortcut targets a route that exists in App.tsx', () => {
    renderPage();
    const hrefs = screen
      .getAllByTestId('owner-qa-shortcut')
      .map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const routePath = href.split('?')[0];
      expect(appSource).toContain(`path="${routePath}"`);
    }
  });

  it('F2) no fixture UUIDs are hardcoded in the page', () => {
    expect(pageSource).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });

  it('F3) route is registered behind the existing admin guard', () => {
    expect(appSource).toMatch(
      /path="\/owner-qa"\s+element=\{<AdminRoute><OwnerQaCenter \/><\/AdminRoute>\}/,
    );
  });

  it('F4) navigation entry is owner-only in the admin sidebar', () => {
    expect(sidebarSource).toContain("role === 'super_admin'");
    expect(sidebarSource).toContain('to="/owner-qa"');
  });
});
