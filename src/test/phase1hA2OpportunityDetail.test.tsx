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
// Hermetic isolation: ReferDriverDialog pulls in useDriverReferrals -> Supabase client.
// The referral workflow is out of scope for A2 OpportunityDetail integration tests.
vi.mock('@/components/opportunities/ReferDriverDialog', () => ({
  ReferDriverDialog: () => null,
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

function renderPage(
  overrides: { isPro?: boolean; apps?: any[]; profile?: any } = {},
) {
  driverApplicationsRef.current = overrides.apps ?? [];
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OpportunityDetail
        opportunity={opportunity}
        onBack={vi.fn()}
        isPro={overrides.isPro ?? false}
        onUpgrade={vi.fn()}
        driverProfile={'profile' in overrides ? overrides.profile : driverProfile}
        onOpenPreferencesForApply={vi.fn()}
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
  // Phase OD-1 — NEW driver-facing Request Info submission is retired from this
  // page. Formal Apply is the only submission CTA; Save/Refer stay secondary.
  it('renders Apply Now as primary action and does NOT render Request Info', () => {
    renderPage();
    const apply = screen.getByRole('button', { name: /^Apply Now$/ });
    expect(apply).toBeInTheDocument();
    // Apply Now is the primary variant (no `variant="outline"` -> default primary styling)
    expect(apply.className).not.toMatch(/border-input/);
    expect(screen.queryByRole('button', { name: /Request Info/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Info Requested/i })).toBeNull();
    // Secondary actions remain intact.
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refer a Driver/i })).toBeInTheDocument();
  });

  it('renders "Complete Preferences to Apply" when preferences are incomplete, still enabled', async () => {
    renderPage({ profile: null });
    const btn = screen.getByRole('button', { name: /Complete Preferences to Apply/i });
    expect(btn).toBeEnabled();
    expect(
      screen.getByText(/Complete your Opportunity Preferences to apply/i),
    ).toBeInTheDocument();
    // Existing dialog / preferences-required path remains reachable.
    await userEvent.click(btn);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('does not show the incomplete-preferences label once preferences are complete', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /Complete Preferences to Apply/i })).toBeNull();
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

// ---------------------------------------------------------------------------
// Phase 1H-A2 CLOSEOUT — post-success rerender + Apply Again fresh-key proofs
// ---------------------------------------------------------------------------

describe('OpportunityDetail — post-success page state', () => {
  it('after a successful Apply Now submission, refreshed hook data disables Apply Now while Request Info stays independent', async () => {
    submitMutateAsync.mockResolvedValue({ result_code: 'created' });
    const { rerender } = renderPage({ apps: [] });
    // Pre: Apply Now available.
    expect(screen.getByRole('button', { name: /^Apply Now$/ })).toBeEnabled();
    // Open dialog + submit successfully.
    await userEvent.click(screen.getByRole('button', { name: /^Apply Now$/ }));
    const dialog = await screen.findByRole('dialog');
    const within = (root: HTMLElement) => root;
    await userEvent.click(dialog.querySelector('label[for="apply-availability"]')!);
    await userEvent.click(dialog.querySelector('label[for="apply-requirements"]')!);
    await userEvent.click(dialog.querySelector('label[for="apply-truth"]')!);
    void within(dialog);
    await userEvent.click(screen.getByRole('button', { name: /Submit Application/i }));
    await new Promise((r) => setTimeout(r, 30));
    expect(submitMutateAsync).toHaveBeenCalledTimes(1);
    // Simulate React Query invalidation returning the new formal apply row.
    driverApplicationsRef.current = [
      { opportunity_id: 'opp-1', application_type: 'apply', status: 'new' },
    ];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={qc}>
        <OpportunityDetail
          opportunity={opportunity}
          onBack={vi.fn()}
          isPro={false}
          onUpgrade={vi.fn()}
          driverProfile={driverProfile}
          onOpenPreferencesForApply={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const applyBtn = screen.getByRole('button', { name: /Application Submitted/i });
    expect(applyBtn).toBeDisabled();
    // Request Info remains independently available (no request_info row exists).
    expect(screen.getByRole('button', { name: /Request Info/ })).toBeEnabled();
  });
});

describe('OpportunityDetail — Apply Again fresh idempotency keys', () => {
  it('rejected Apply Again attempt receives a fresh idempotency key', async () => {
    submitMutateAsync.mockResolvedValue({ result_code: 'created' });
    renderPage({
      apps: [{ opportunity_id: 'opp-1', application_type: 'apply', status: 'rejected' }],
    });
    await userEvent.click(screen.getByRole('button', { name: /Apply Again/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(dialog.querySelector('label[for="apply-availability"]')!);
    await userEvent.click(dialog.querySelector('label[for="apply-requirements"]')!);
    await userEvent.click(dialog.querySelector('label[for="apply-truth"]')!);
    await userEvent.click(screen.getByRole('button', { name: /Submit Application/i }));
    await new Promise((r) => setTimeout(r, 30));
    expect(submitMutateAsync).toHaveBeenCalledTimes(1);
    const key = submitMutateAsync.mock.calls[0][0].idempotency_key;
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThanOrEqual(8);
  });

  it('withdrawn Apply Again attempt receives a fresh idempotency key', async () => {
    submitMutateAsync.mockResolvedValue({ result_code: 'created' });
    renderPage({
      apps: [{ opportunity_id: 'opp-1', application_type: 'apply', status: 'withdrawn' }],
    });
    await userEvent.click(screen.getByRole('button', { name: /Apply Again/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(dialog.querySelector('label[for="apply-availability"]')!);
    await userEvent.click(dialog.querySelector('label[for="apply-requirements"]')!);
    await userEvent.click(dialog.querySelector('label[for="apply-truth"]')!);
    await userEvent.click(screen.getByRole('button', { name: /Submit Application/i }));
    await new Promise((r) => setTimeout(r, 30));
    expect(submitMutateAsync).toHaveBeenCalledTimes(1);
    const key = submitMutateAsync.mock.calls[0][0].idempotency_key;
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// Phase 1J-C1 additive — resume-token matrix on real OpportunityDetail.
// ---------------------------------------------------------------------------

function renderDetail(overrides: {
  apps?: any[];
  profile?: any;
  token?: string | null;
  onConsumed?: (t: string) => void;
} = {}) {
  driverApplicationsRef.current = overrides.apps ?? [];
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onConsumed = overrides.onConsumed ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <OpportunityDetail
        opportunity={opportunity}
        onBack={vi.fn()}
        isPro={false}
        onUpgrade={vi.fn()}
        driverProfile={overrides.profile === undefined ? driverProfile : overrides.profile}
        onOpenPreferencesForApply={vi.fn()}
        resumeApplyToken={overrides.token ?? null}
        onResumeApplyConsumed={onConsumed}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onConsumed };
}

function rerenderDetail(
  rerender: (ui: React.ReactElement) => void,
  next: { apps?: any[]; profile?: any; token?: string | null; onConsumed?: (t: string) => void },
) {
  if (next.apps !== undefined) driverApplicationsRef.current = next.apps;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  rerender(
    <QueryClientProvider client={qc}>
      <OpportunityDetail
        opportunity={opportunity}
        onBack={vi.fn()}
        isPro={false}
        onUpgrade={vi.fn()}
        driverProfile={next.profile === undefined ? driverProfile : next.profile}
        onOpenPreferencesForApply={vi.fn()}
        resumeApplyToken={next.token ?? null}
        onResumeApplyConsumed={next.onConsumed ?? vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('OpportunityDetail — Phase 1J-C1 resume-token matrix', () => {
  it('1. incomplete driverProfile + token: no dialog and no consume', async () => {
    const consumed = vi.fn();
    renderDetail({
      profile: { ...driverProfile, profile_completed: false },
      token: 'resume-1',
      onConsumed: consumed,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(consumed).not.toHaveBeenCalled();
  });

  it('2. same token becomes eligible after completed rerender: opens once, consumes once', async () => {
    const consumed = vi.fn();
    const { rerender } = renderDetail({
      profile: { ...driverProfile, profile_completed: false },
      token: 'resume-1',
      onConsumed: consumed,
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    rerenderDetail(rerender, {
      profile: { ...driverProfile, profile_completed: true },
      token: 'resume-1',
      onConsumed: consumed,
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(consumed).toHaveBeenCalledWith('resume-1');
  });

  it('3. rerenders after close do not reopen', async () => {
    const consumed = vi.fn();
    const { rerender } = renderDetail({ token: 'resume-1', onConsumed: consumed });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // Parent clears token after consume.
    rerenderDetail(rerender, { token: null, onConsumed: consumed });
    // Close dialog via cancel.
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Ordinary rerenders must not reopen.
    rerenderDetail(rerender, { token: null, onConsumed: consumed });
    rerenderDetail(rerender, { token: null, onConsumed: consumed });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(consumed).toHaveBeenCalledTimes(1);
  });

  it('4. distinct later token on same opportunity opens once', async () => {
    const consumed = vi.fn();
    const { rerender } = renderDetail({ token: 'resume-1', onConsumed: consumed });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    rerenderDetail(rerender, { token: null, onConsumed: consumed });
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    // Later distinct token.
    rerenderDetail(rerender, { token: 'resume-2', onConsumed: consumed });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(consumed).toHaveBeenCalledTimes(2);
    expect(consumed.mock.calls.map((c) => c[0])).toEqual(['resume-1', 'resume-2']);
  });

  it('5. active formal state blocks open/consume even with token', async () => {
    const consumed = vi.fn();
    renderDetail({
      apps: [{ opportunity_id: 'opp-1', application_type: 'apply', status: 'interviewing' }],
      token: 'resume-1',
      onConsumed: consumed,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(consumed).not.toHaveBeenCalled();
  });

  it('6. completed (hired) formal state blocks open/consume even with token', async () => {
    const consumed = vi.fn();
    renderDetail({
      apps: [{ opportunity_id: 'opp-1', application_type: 'apply', status: 'hired' }],
      token: 'resume-1',
      onConsumed: consumed,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(consumed).not.toHaveBeenCalled();
  });

  it('7. reapplyable formal state permits resume', async () => {
    const consumed = vi.fn();
    renderDetail({
      apps: [{ opportunity_id: 'opp-1', application_type: 'apply', status: 'rejected' }],
      token: 'resume-1',
      onConsumed: consumed,
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(consumed).toHaveBeenCalledTimes(1);
  });

  it('8. no token: ordinary behavior unchanged (dialog does not auto-open)', async () => {
    const consumed = vi.fn();
    renderDetail({ token: null, onConsumed: consumed });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(consumed).not.toHaveBeenCalled();
  });
});



