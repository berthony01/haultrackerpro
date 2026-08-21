/**
 * Phase TG-2E3-O4 — Owner QA agency context safety.
 *
 * Proves that while the platform owner holds ANY active Owner QA session the
 * Agency Plan & Limits card never renders or invokes real Stripe billing, and
 * that normal (QA OFF) billing behaviour is untouched.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (test-file local only)
// ---------------------------------------------------------------------------
const invoke = vi.fn(async () => ({ data: { url: null }, error: null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...(a as [])) } },
}));

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

const entitlementState = {
  entitlement: {
    planKey: 'agency_starter',
    status: 'cancelled',
    stripeCustomerId: null as string | null,
    stripeSubscriptionId: null as string | null,
    memberLimit: 3,
    activeClientLimit: 5,
    servicePackageLimit: 3,
  },
  isLoading: false,
  refetch: vi.fn(),
};
vi.mock('@/hooks/useAgencyEntitlement', () => ({
  useAgencyEntitlement: () => entitlementState,
}));

const agencyState = { data: { my_role: 'agency_owner' } as { my_role: string } };
vi.mock('@/hooks/useAgency', () => ({
  useMyAgency: () => agencyState,
  useAgencyMembers: () => ({ data: [] }),
}));
vi.mock('@/hooks/useAgencyWorkflow', () => ({
  useAgencyPackages: () => ({ data: [] }),
  useAgencyClients: () => ({ data: [] }),
}));

const setPersona = vi.fn(async () => {});
const qaState = {
  isOwner: false,
  isActive: false,
  domain: null as string | null,
  persona: null as string | null,
  label: null as string | null,
  isMutating: false,
  setPersona,
};
vi.mock('@/hooks/useOwnerQaPersona', () => ({
  useOwnerQaPersona: () => qaState,
}));

import { AgencyPlanLimitsCard } from '@/components/agency/AgencyPlanLimitsCard';

const setQaOff = () => {
  Object.assign(qaState, {
    isOwner: false,
    isActive: false,
    domain: null,
    persona: null,
    label: null,
  });
};

const setQa = (domain: string, persona: string, label: string) => {
  Object.assign(qaState, {
    isOwner: true,
    isActive: true,
    domain,
    persona,
    label,
  });
};

const renderCard = () => render(<AgencyPlanLimitsCard agencyId="agency-1" />);

const realBillingCtas = () =>
  screen.queryAllByRole('button', {
    name: /Start Agency Billing|Restart Billing|Manage Billing/i,
  });

beforeEach(() => {
  vi.clearAllMocks();
  setQaOff();
  agencyState.data = { my_role: 'agency_owner' };
  entitlementState.entitlement.status = 'cancelled';
  entitlementState.entitlement.stripeCustomerId = null;
  entitlementState.entitlement.stripeSubscriptionId = null;
});

describe('TG-2E3-O4 — Owner QA agency billing safety', () => {
  it('1. QA OFF + real agency owner + never-started entitlement keeps the real Start Agency Billing path', () => {
    renderCard();
    expect(
      screen.getByRole('button', { name: /Start Agency Billing/i }),
    ).toBeTruthy();
    expect(screen.queryByText(/Agency QA testing/i)).toBeNull();
  });

  it('2. Owner QA active as Recruiter Fleet hides real billing CTAs, warns about context, and offers exactly 3 Agency QA choices', () => {
    setQa('recruiter', 'fleet', 'Recruiter Fleet');
    renderCard();

    expect(realBillingCtas()).toHaveLength(0);
    expect(screen.getByText(/Agency QA testing/i)).toBeTruthy();
    expect(
      screen.getByText(/does not override Agency entitlements/i),
    ).toBeTruthy();
    expect(screen.getByText(/Recruiter Fleet/i)).toBeTruthy();

    const qaChoices = screen.getAllByRole('button', {
      name: /Switch QA —|Testing QA —/i,
    });
    expect(qaChoices).toHaveLength(3);
  });

  it('3. Selecting Agency Team from Recruiter Fleet QA calls setPersona only and never invokes Stripe functions', async () => {
    setQa('recruiter', 'fleet', 'Recruiter Fleet');
    renderCard();

    fireEvent.click(
      screen.getByRole('button', { name: /Switch QA — Agency Team/i }),
    );

    await waitFor(() => expect(setPersona).toHaveBeenCalledTimes(1));
    expect(setPersona).toHaveBeenCalledWith('agency', 'agency_team');

    const invoked = invoke.mock.calls.map((c) => (c as unknown[])[0]);
    expect(invoked).not.toContain('create-agency-checkout');
    expect(invoked).not.toContain('agency-customer-portal');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('4. Owner QA active as Agency Team marks it active, keeps real billing CTAs absent, and still allows switching', () => {
    setQa('agency', 'agency_team', 'Agency Team');
    entitlementState.entitlement.status = 'active';
    entitlementState.entitlement.stripeCustomerId = 'cus_x';
    entitlementState.entitlement.stripeSubscriptionId = 'sub_x';
    renderCard();

    expect(realBillingCtas()).toHaveLength(0);
    expect(screen.getByText(/Active QA plan/i)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Testing QA — Agency Team/i }),
    ).toBeTruthy();
    expect(
      screen.queryByText(/does not override Agency entitlements/i),
    ).toBeNull();
    expect(
      screen.getAllByRole('button', { name: /Switch QA —/i }),
    ).toHaveLength(2);
  });

  it('5. Non-owner member behaviour is unchanged (read-only, no QA section)', () => {
    agencyState.data = { my_role: 'agency_member' };
    renderCard();

    expect(realBillingCtas()).toHaveLength(0);
    expect(
      screen.getByText(/Only the agency owner can manage billing/i),
    ).toBeTruthy();
    expect(screen.queryByText(/Agency QA testing/i)).toBeNull();
  });

  it('5b. Non-owner agency member with Owner QA active renders read-only copy and never shows QA switcher or real billing CTAs', () => {
    // super_admin Owner QA active (Recruiter Fleet) but signed in as a
    // non-owner member of the agency being viewed.
    setQa('recruiter', 'fleet', 'Recruiter Fleet');
    agencyState.data = { my_role: 'agency_member' };
    renderCard();

    expect(realBillingCtas()).toHaveLength(0);
    expect(
      screen.getByText(/Only the agency owner can manage billing/i),
    ).toBeTruthy();
    expect(screen.queryByText(/Agency QA testing/i)).toBeNull();
    expect(
      screen.queryAllByRole('button', { name: /Switch QA —|Testing QA —/i }),
    ).toHaveLength(0);
    expect(setPersona).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('6. QA OFF owner still invokes the existing checkout path when Start Agency Billing is clicked', async () => {
    renderCard();
    fireEvent.click(
      screen.getByRole('button', { name: /Start Agency Billing/i }),
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect((invoke.mock.calls[0] as unknown[])[0]).toBe('create-agency-checkout');
    expect(setPersona).not.toHaveBeenCalled();
  });
});
