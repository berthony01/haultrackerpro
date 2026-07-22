// Phase 1L-F2D — rendered UI + real hook integration for safe recruiter
// opportunity deletion. Mocks only external boundaries; renders the real
// RecruiterOpportunityManager wired to the real useRecruiterOpportunities.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';


const h = vi.hoisted(() => {
  function makeOpp(overrides: Record<string, unknown>) {
    return {
      id: 'opp',
      recruiter_id: 'r-1',
      title: 'Row',
      company_name: 'Acme Trucking',
      status: 'draft',
      admin_review_status: 'approved',
      published_at: null,
      driver_type: null,
      route_type: null,
      trailer_type: null,
      estimated_weekly_gross: null,
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
      ...overrides,
    };
  }
  return {
    rpc: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    billingRefresh: vi.fn(),
    updateEq2: vi.fn(async () => ({ error: null })),
    opportunities: [
      makeOpp({ id: 'opp-draft', title: 'Draft Row', company_name: 'Acme Trucking', status: 'draft' }),
      makeOpp({ id: 'opp-closed', title: 'Closed Row', company_name: 'Acme Trucking', status: 'closed' }),
      makeOpp({ id: 'opp-active', title: 'Active Row', company_name: 'Acme Trucking', status: 'active', published_at: '2026-07-15T00:00:00Z' }),
      makeOpp({ id: 'opp-paused', title: 'Paused Row', company_name: 'Acme Trucking', status: 'paused' }),
    ],
  };
});

vi.mock('sonner', () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
}));

// Auth + profile + role + billing mocks.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1' }, session: null, loading: false }),
}));
vi.mock('@/hooks/opportunities/useRecruiterProfile', () => ({
  useRecruiterProfile: () => ({
    profile: {
      id: 'r-1',
      user_id: 'u-1',
      recruiter_name: 'Jane',
      company_name: 'Acme Trucking',
      recruiter_email: 'jane@acme.example',
      dot_number: '1',
      mc_number: null,
      status: 'active',
      verification_status: 'approved',
      posting_terms_accepted_at: '2026-07-17T00:00:00Z',
      posting_terms_version: 'v1',
      legacy_terms_grandfathered_at: null,
    },
    isLoading: false,
    isApproved: true,
    canPost: true,
    isVerified: true,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({ intentRecruiter: true }),
}));
vi.mock('@/hooks/opportunities/useRecruiterBilling', () => ({
  useRecruiterBilling: () => ({ refresh: h.billingRefresh }),
}));
vi.mock('@/components/opportunities/RecruiterReferralsPanel', () => ({
  RecruiterReferralsPanel: () => <div data-testid="stub-referrals" />,
}));


vi.mock('@/integrations/supabase/client', () => {
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        order: async () => ({ data: h.opportunities, error: null }),
      }),
    }),
    update: () => ({
      eq: () => ({
        eq: h.updateEq2,
      }),
    }),
  }));
  return { supabase: { from, rpc: h.rpc } };
});

import { RecruiterOpportunityManager } from '@/components/opportunities/RecruiterOpportunityManager';

function renderMgr() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RecruiterOpportunityManager onBack={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function waitForList() {
  await screen.findByTestId('opportunity-row-opp-draft');
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe('Phase 1L-F2D — row delete visibility', () => {
  it('draft row exposes delete permanently with exact test id and label', async () => {
    renderMgr();
    await waitForList();
    const row = within(screen.getByTestId('opportunity-row-opp-draft'));
    const btn = row.getByTestId('delete-opportunity-opp-draft');
    expect(btn).toHaveTextContent('Delete permanently');
  });
  it('closed row exposes delete permanently with exact test id', async () => {
    renderMgr();
    await waitForList();
    const row = within(screen.getByTestId('opportunity-row-opp-closed'));
    expect(row.getByTestId('delete-opportunity-opp-closed')).toBeInTheDocument();
  });
  it('active row does not render a delete control', async () => {
    renderMgr();
    await waitForList();
    const row = within(screen.getByTestId('opportunity-row-opp-active'));
    expect(row.queryByTestId('delete-opportunity-opp-active')).toBeNull();
    expect(row.queryByText('Delete permanently')).toBeNull();
  });
  it('paused row does not render a delete control', async () => {
    renderMgr();
    await waitForList();
    const row = within(screen.getByTestId('opportunity-row-opp-paused'));
    expect(row.queryByTestId('delete-opportunity-opp-paused')).toBeNull();
  });
});

async function openDeleteDialog(rowId = 'opp-draft') {
  renderMgr();
  await waitForList();
  fireEvent.click(
    within(screen.getByTestId(`opportunity-row-${rowId}`))
      .getByTestId(`delete-opportunity-${rowId}`),
  );
  return within(await screen.findByRole('alertdialog'));
}

describe('Phase 1L-F2D — confirmation dialog', () => {
  it('opens with exact title', async () => {
    const dlg = await openDeleteDialog();
    expect(dlg.getByRole('heading', { name: 'Delete opportunity permanently?' })).toBeInTheDocument();
  });
  it('identifies the exact opportunity title and company', async () => {
    const dlg = await openDeleteDialog();
    expect(dlg.getByText(/Draft Row/)).toBeInTheDocument();
    expect(dlg.getByText(/Acme Trucking/)).toBeInTheDocument();
  });
  it('renders both exact warning sentences', async () => {
    const dlg = await openDeleteDialog();
    expect(dlg.getByText('This cannot be undone.')).toBeInTheDocument();
    expect(
      dlg.getByText(
        'Listings with connected applications, referrals, offers, contracts, or reports cannot be deleted.',
      ),
    ).toBeInTheDocument();
  });
  it('cancel closes and calls no RPC', async () => {
    const dlg = await openDeleteDialog();
    fireEvent.click(dlg.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe('Phase 1L-F2D — RPC dispatch and result mapping', () => {
  it('confirm invokes the exact RPC once with the exact opportunity id and closes on deleted', async () => {
    h.rpc.mockResolvedValueOnce({ data: { result_code: 'deleted' }, error: null });
    const dlg = await openDeleteDialog();
    fireEvent.click(dlg.getByTestId('confirm-delete-opportunity'));
    await vi.waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('delete_recruiter_opportunity', {
      p_opportunity_id: 'opp-draft',
    });
    expect(h.toastSuccess).toHaveBeenCalledWith('Opportunity deleted permanently');
  });

  it('status_blocked shows the exact public-safe text and keeps dialog open', async () => {
    h.rpc.mockResolvedValueOnce({ data: { result_code: 'status_blocked' }, error: null });
    const dlg = await openDeleteDialog();
    fireEvent.click(dlg.getByTestId('confirm-delete-opportunity'));
    await vi.waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith(
        'Close this opportunity before deleting it permanently.',
      );
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it('related_records shows the exact approved text and keeps dialog open', async () => {
    h.rpc.mockResolvedValueOnce({
      data: { result_code: 'related_records', blockers: ['applications', 'contracts'] },
      error: null,
    });
    const dlg = await openDeleteDialog();
    fireEvent.click(dlg.getByTestId('confirm-delete-opportunity'));
    await vi.waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith(
        'This opportunity cannot be deleted because it has connected applications, referrals, offers, contracts, or reports. Keep it closed to preserve those records.',
      );
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('not_found shows the exact non-enumerating text and keeps dialog open', async () => {
    h.rpc.mockResolvedValueOnce({ data: { result_code: 'not_found' }, error: null });
    const dlg = await openDeleteDialog();
    fireEvent.click(dlg.getByTestId('confirm-delete-opportunity'));
    await vi.waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith(
        'This opportunity could not be found or you do not have permission to delete it.',
      );
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('low-level supabase error leaks nothing and maps to generic text', async () => {
    const leaky = {
      message: 'permission denied for table opportunities; policy admin_delete_opportunities',
      code: '42501',
    };
    h.rpc.mockResolvedValueOnce({ data: null, error: leaky });
    const dlg = await openDeleteDialog();
    fireEvent.click(dlg.getByTestId('confirm-delete-opportunity'));
    await vi.waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith('Unable to delete this opportunity right now.');
    });
    const shown = h.toastError.mock.calls.map((c) => String(c[0])).join('\n');
    expect(shown).not.toMatch(/permission denied/);
    expect(shown).not.toMatch(/admin_delete_opportunities/);
    expect(shown).not.toMatch(/opportunities/);
    expect(shown).not.toMatch(/42501/);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('malformed response maps to generic text and keeps dialog open', async () => {
    h.rpc.mockResolvedValueOnce({ data: { unexpected: true }, error: null });
    const dlg = await openDeleteDialog();
    fireEvent.click(dlg.getByTestId('confirm-delete-opportunity'));
    await vi.waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith('Unable to delete this opportunity right now.');
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('failed deletion never triggers a success toast', async () => {
    h.rpc.mockResolvedValueOnce({ data: { result_code: 'status_blocked' }, error: null });
    const dlg = await openDeleteDialog();
    fireEvent.click(dlg.getByTestId('confirm-delete-opportunity'));
    await vi.waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it('successful deletion does not call billing.refresh (no duplicate manual refetch)', async () => {
    h.rpc.mockResolvedValueOnce({ data: { result_code: 'deleted' }, error: null });
    const dlg = await openDeleteDialog();
    fireEvent.click(dlg.getByTestId('confirm-delete-opportunity'));
    await vi.waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(h.billingRefresh).not.toHaveBeenCalled();
  });
});

describe('Phase 1L-F2D — pending RPC disables all controls', () => {
  it('confirm/cancel and row controls disable while deletion is pending', async () => {
    let resolveRpc!: (v: unknown) => void;
    h.rpc.mockImplementationOnce(
      () => new Promise((res) => { resolveRpc = res; }),
    );
    const dlg = await openDeleteDialog();
    fireEvent.click(dlg.getByTestId('confirm-delete-opportunity'));
    await vi.waitFor(() => {
      expect(dlg.getByTestId('confirm-delete-opportunity')).toBeDisabled();
    });
    expect(dlg.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    const row = within(screen.getByTestId('opportunity-row-opp-draft'));
    expect(row.getByTestId('delete-opportunity-opp-draft')).toBeDisabled();
    expect(row.getByRole('button', { name: 'Edit' })).toBeDisabled();
    resolveRpc({ data: { result_code: 'deleted' }, error: null });
  });
});

describe('Phase 1L-F2D — existing lifecycle controls remain wired', () => {
  it('draft row still renders Publish alongside Delete permanently', async () => {
    renderMgr();
    await waitForList();
    const row = within(screen.getByTestId('opportunity-row-opp-draft'));
    expect(row.getByRole('button', { name: /Publish/ })).toBeInTheDocument();
    expect(row.getByTestId('delete-opportunity-opp-draft')).toBeInTheDocument();
  });
  it('active row still renders Pause and Close', async () => {
    renderMgr();
    await waitForList();
    const row = within(screen.getByTestId('opportunity-row-opp-active'));
    expect(row.getByRole('button', { name: /Pause/ })).toBeInTheDocument();
    expect(row.getByRole('button', { name: /Close/ })).toBeInTheDocument();
  });
  it('paused row still renders Activate and Close', async () => {
    renderMgr();
    await waitForList();
    const row = within(screen.getByTestId('opportunity-row-opp-paused'));
    expect(row.getByRole('button', { name: /Activate/ })).toBeInTheDocument();
    expect(row.getByRole('button', { name: /Close/ })).toBeInTheDocument();
  });
  it('closed row still renders Activate alongside Delete permanently', async () => {
    renderMgr();
    await waitForList();
    const row = within(screen.getByTestId('opportunity-row-opp-closed'));
    expect(row.getByRole('button', { name: /Activate/ })).toBeInTheDocument();
    expect(row.getByTestId('delete-opportunity-opp-closed')).toBeInTheDocument();
  });
});
