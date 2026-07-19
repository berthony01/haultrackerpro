import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Radix pointer-capture polyfill for jsdom.
beforeAll(() => {
  const proto = window.HTMLElement.prototype as any;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

// -- Mocks: keep OpportunityDetail real, mock only data hooks. -----------
const driverApplicationsRef: { current: any[] } = { current: [] };
const submitMutateAsync = vi.fn();
const createMutate = vi.fn();

vi.mock('@/hooks/opportunities/useOpportunityApplications', () => ({
  useOpportunityApplications: () => ({
    driverApplications: driverApplicationsRef.current,
    submitApplication: { mutateAsync: submitMutateAsync, isPending: false },
    createApplication: { mutate: createMutate, isPending: false },
  }),
}));
vi.mock('@/hooks/opportunities/useSavedOpportunities', () => ({
  useSavedOpportunities: () => ({
    saved: [] as any[],
    save: { mutate: vi.fn() },
    unsave: { mutate: vi.fn() },
  }),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

import { OpportunityDetail } from '@/components/opportunities/OpportunityDetail';

const opportunity: any = {
  id: 'opp-1',
  recruiter_id: 'rec-1',
  title: 'OTR Reefer',
  company_name: 'Acme Freight',
  hiring_city: 'Dallas',
  hiring_state: 'TX',
  driver_type: 'Company',
  route_type: 'OTR',
  trailer_type: 'Reefer',
  home_time: 'Weekly',
  pay_model: 'CPM',
  cpm: 0.62,
  featured: false,
  deadhead_paid: true,
};

const driverProfile: any = {
  id: 'p1',
  user_id: 'u1',
  full_name: 'Jane Driver',
  city: 'Dallas',
  state: 'TX',
  cdl_class: 'A',
  years_experience: 5,
  email: 'jane@example.com',
  phone: '5551234567',
  profile_completed: true,
  allow_verified_recruiter_contact: true,
  contact_preference: 'in_app',
};

function renderPage(overrides: { isPro?: boolean; apps?: any[] } = {}) {
  driverApplicationsRef.current = overrides.apps ?? [];
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OpportunityDetail
        opportunity={opportunity}
        onBack={vi.fn()}
        isPro={overrides.isPro ?? false}
        onUpgrade={vi.fn()}
        driverProfile={driverProfile}
        onEditProfile={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  submitMutateAsync.mockReset();
  createMutate.mockReset();
  driverApplicationsRef.current = [];
});

describe('OpportunityDetail — Apply Now integration', () => {
  it('renders Apply Now as primary action and Request Info as secondary', () => {
    renderPage();
    const apply = screen.getByRole('button', { name: /^Apply Now$/ });
    const req = screen.getByRole('button', { name: /Request Info/ });
    expect(apply).toBeInTheDocument();
    expect(req).toBeInTheDocument();
    // Apply Now is the primary variant (no `variant="outline"` -> default primary styling)
    expect(apply.className).not.toMatch(/border-input/);
    // Request Info is outline (secondary)
    expect(req.className).toMatch(/border/);
  });

  it('is available to a non-Pro driver without upgrade gating', () => {
    renderPage({ isPro: false });
    const apply = screen.getByRole('button', { name: /^Apply Now$/ });
    expect(apply).toBeEnabled();
    expect(apply).not.toHaveTextContent(/Pro/i);
    expect(apply).not.toHaveTextContent(/Upgrade/i);
  });

  it('opens the Apply Now dialog when clicked', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Apply Now$/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Apply to OTR Reefer/i)).toBeInTheDocument();
  });

  it('is NOT blocked by an existing request_info row', () => {
    renderPage({
      apps: [{ opportunity_id: 'opp-1', application_type: 'request_info', status: 'new' }],
    });
    expect(screen.getByRole('button', { name: /^Apply Now$/ })).toBeEnabled();
  });

  it('does NOT falsely mark Request Info as sent when only a formal apply exists', () => {
    renderPage({
      apps: [{ opportunity_id: 'opp-1', application_type: 'apply', status: 'new' }],
    });
    // Request Info button remains enabled/available (formal apply does not disable it)
    expect(screen.getByRole('button', { name: /Request Info/ })).toBeEnabled();
  });

  it('disables Request Info when a request_info row already exists', () => {
    renderPage({
      apps: [{ opportunity_id: 'opp-1', application_type: 'request_info', status: 'new' }],
    });
    expect(screen.getByRole('button', { name: /Info Requested/i })).toBeDisabled();
  });

  const ACTIVE_STATUSES = [
    'new', 'viewed', 'contact_requested', 'call_scheduled',
    'waiting_documents', 'interviewing', 'offer_sent', 'onboarding',
  ];
  for (const status of ACTIVE_STATUSES) {
    it(`disables Apply Now with active status "${status}"`, () => {
      renderPage({
        apps: [{ opportunity_id: 'opp-1', application_type: 'apply', status }],
      });
      const btn = screen.getByRole('button', { name: /Application Submitted/i });
      expect(btn).toBeDisabled();
      expect(btn).not.toHaveTextContent(/Request Sent/i);
    });
  }

  it('shows "Apply Again" for a rejected formal application and reopens the dialog', async () => {
    renderPage({
      apps: [{ opportunity_id: 'opp-1', application_type: 'apply', status: 'rejected' }],
    });
    const btn = screen.getByRole('button', { name: /Apply Again/i });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows "Apply Again" for a withdrawn formal application', async () => {
    renderPage({
      apps: [{ opportunity_id: 'opp-1', application_type: 'apply', status: 'withdrawn' }],
    });
    const btn = screen.getByRole('button', { name: /Apply Again/i });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows "Hired" completed state and blocks another application', () => {
    renderPage({
      apps: [{ opportunity_id: 'opp-1', application_type: 'apply', status: 'hired' }],
    });
    const btn = screen.getByRole('button', { name: /^Hired$/ });
    expect(btn).toBeDisabled();
  });

  it('allows formal apply and request_info to coexist independently', () => {
    renderPage({
      apps: [
        { opportunity_id: 'opp-1', application_type: 'apply', status: 'rejected' },
        { opportunity_id: 'opp-1', application_type: 'request_info', status: 'new' },
      ],
    });
    expect(screen.getByRole('button', { name: /Apply Again/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Info Requested/i })).toBeDisabled();
  });
});
