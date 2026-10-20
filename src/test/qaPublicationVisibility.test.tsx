import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { useRecruiterQaPublicationContext } from '@/hooks/opportunities/useRecruiterQaPublicationContext';
import { getOpportunityPublicationStatus } from '@/lib/opportunities/publicationStatus';
import { RecruiterOpportunityManager, RecruiterStaffOpportunityManager } from '@/components/opportunities/RecruiterOpportunityManager';

const h = vi.hoisted(() => ({
  user: { id: 'owner' } as { id: string } | null,
  rpc: vi.fn(), owner: vi.fn(), profile: vi.fn(), billing: vi.fn(), staff: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('@/hooks/opportunities/useRecruiterProfile', () => ({ useRecruiterProfile: h.profile }));
vi.mock('@/hooks/opportunities/useRecruiterBilling', () => ({ useRecruiterBilling: h.billing }));
vi.mock('@/hooks/opportunities/useRecruiterOpportunities', () => ({
  useRecruiterOpportunities: h.owner, useRecruiterStaffOpportunities: h.staff,
}));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => ({ intentRecruiter: true }) }));
vi.mock('@/hooks/opportunities/useTelegramOpportunityDraft', () => ({
  readTelegramDraftLocator: () => null, useTelegramOpportunityDraft: () => ({}),
}));
vi.mock('@/components/opportunities/RecruiterOpportunityForm', () => ({ RecruiterOpportunityForm: () => null }));
vi.mock('@/components/opportunities/RecruiterReferralsPanel', () => ({ RecruiterReferralsPanel: () => null }));
vi.mock('@/components/opportunities/RecruiterReadinessDialog', () => ({ RecruiterReadinessDialog: () => null }));

const live = { status: 'active', admin_review_status: 'approved', published_at: '2026-10-20' };
const permissions = { canViewOpportunities: true, canCreateOpportunities: false, canEditOpportunities: true,
  canChangeOpportunityStatus: true, canDeleteOpportunities: false };
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.clearAllMocks(); h.user = { id: 'owner' };
  h.rpc.mockResolvedValue({ data: [{ recruiter_id: 'workspace-a', is_qa_fixture: true }], error: null });
  const store = { opportunities: [{ ...live, id: 'listing', recruiter_id: 'workspace-a', title: 'Listing', created_at: '2026-10-20' }],
    isLoading: false, setStatus: { mutate: vi.fn(), isPending: false }, deleteOpportunity: { mutate: vi.fn(), isPending: false },
    updateOpportunity: { isPending: false }, refetch: vi.fn() };
  h.owner.mockReturnValue(store); h.staff.mockReturnValue(store); h.billing.mockReturnValue({});
  h.profile.mockReturnValue({ profile: { id: 'workspace-a', status: 'active' }, isLoading: false });
});
afterEach(cleanup);

describe('publication context status rules', () => {
  it('public context is live', () => expect(getOpportunityPublicationStatus(live, 'public').isDriverVisible).toBe(true));
  it('QA context is never live', () => {
    expect(getOpportunityPublicationStatus(live, 'qa_only').key).toBe('qa_only');
    expect(getOpportunityPublicationStatus(live, 'qa_only').isDriverVisible).toBe(false);
  });
  it.each([undefined, 'unknown'] as const)('unverified %s defaults fail closed', context => {
    expect(getOpportunityPublicationStatus(live, context).key).toBe('visibility_unknown');
    expect(getOpportunityPublicationStatus(live, context).isDriverVisible).toBe(false);
  });
  it.each(['draft', 'paused', 'closed'])('%s lifecycle is preserved', status => {
    expect(getOpportunityPublicationStatus({ ...live, status }, 'qa_only').key).toBe(status);
  });
  it.each(['pending', 'rejected'])('%s moderation is preserved', admin_review_status => {
    expect(getOpportunityPublicationStatus({ ...live, admin_review_status }, 'qa_only').key).toBe(admin_review_status);
  });
});

describe('scoped RPC hook', () => {
  it.each([true, false])('parses boolean %s with exact scoped RPC', async is_qa_fixture => {
    h.rpc.mockResolvedValue({ data: [{ recruiter_id: 'workspace-a', is_qa_fixture }], error: null });
    const { result } = renderHook(() => useRecruiterQaPublicationContext('workspace-a', true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.context).toBe(is_qa_fixture ? 'qa_only' : 'public'));
    expect(h.rpc).toHaveBeenCalledWith('get_recruiter_qa_publication_context', { _recruiter_id: 'workspace-a' });
  });
  it.each([[], null, {}, [null], [{ recruiter_id: 'other', is_qa_fixture: false }],
    [{ recruiter_id: 'workspace-a', is_qa_fixture: 'false' }],
    [{ recruiter_id: 'workspace-a', is_qa_fixture: false }, { recruiter_id: 'workspace-a', is_qa_fixture: false }]])('malformed/zero rows %j stay unknown', async data => {
    h.rpc.mockResolvedValue({ data, error: null });
    const { result } = renderHook(() => useRecruiterQaPublicationContext('workspace-a', true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.context).toBe('unknown');
    expect(getOpportunityPublicationStatus(live, result.current.context).isDriverVisible).toBe(false);
  });
  it('errors stay unknown', async () => {
    h.rpc.mockResolvedValue({ data: [{ recruiter_id: 'workspace-a', is_qa_fixture: false }], error: new Error('denied') });
    const { result } = renderHook(() => useRecruiterQaPublicationContext('workspace-a', true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.context).toBe('unknown');
  });
  it('loading never reports live', () => {
    h.rpc.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRecruiterQaPublicationContext('workspace-a', true), { wrapper: wrapper() });
    expect(result.current.context).toBe('unknown');
    expect(getOpportunityPublicationStatus(live, result.current.context).isDriverVisible).toBe(false);
  });
  it.each(['denied', 'signed_out', 'no_workspace'])('%s performs no RPC', reason => {
    if (reason === 'signed_out') h.user = null;
    const { result } = renderHook(() => useRecruiterQaPublicationContext(reason === 'no_workspace' ? null : 'workspace-a', reason !== 'denied'), { wrapper: wrapper() });
    expect(result.current.context).toBe('unknown'); expect(h.rpc).not.toHaveBeenCalled();
  });
  it('workspace/account switches never reuse previous metadata and denial hides cache', async () => {
    const { result, rerender } = renderHook(({ id, access }) => useRecruiterQaPublicationContext(id, access),
      { initialProps: { id: 'workspace-a', access: true }, wrapper: wrapper() });
    await waitFor(() => expect(result.current.context).toBe('qa_only'));
    h.rpc.mockReturnValue(new Promise(() => {}));
    rerender({ id: 'workspace-b', access: true }); expect(result.current.context).toBe('unknown');
    expect(h.rpc).toHaveBeenLastCalledWith('get_recruiter_qa_publication_context', { _recruiter_id: 'workspace-b' });
    h.user = { id: 'staff' }; rerender({ id: 'workspace-a', access: true });
    expect(result.current.context).toBe('unknown');
    rerender({ id: 'workspace-a', access: false }); expect(result.current.context).toBe('unknown');
  });
});

describe('owner/staff manager integration', () => {
  it.each(['owner', 'staff'])('%s passes real context without changing listing actions', async mode => {
    render(mode === 'owner' ? <RecruiterOpportunityManager onBack={vi.fn()} /> :
      <RecruiterStaffOpportunityManager recruiterId="workspace-a" companyName="Company" permissions={permissions} onBack={vi.fn()} />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByTestId('publication-status-listing').getAttribute('data-publication-state')).toBe('qa_only'));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(h.rpc).toHaveBeenCalledWith('get_recruiter_qa_publication_context', { _recruiter_id: 'workspace-a' });
    if (mode === 'staff') { expect(h.owner).not.toHaveBeenCalled(); expect(h.profile).not.toHaveBeenCalled(); expect(h.billing).not.toHaveBeenCalled(); }
  });
  it('denied staff mounts no owner hooks and performs no metadata RPC', () => {
    render(<RecruiterStaffOpportunityManager recruiterId="workspace-a" companyName={null} permissions={{ ...permissions, canViewOpportunities: false }} onBack={vi.fn()} />, { wrapper: wrapper() });
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.owner).not.toHaveBeenCalled(); expect(h.profile).not.toHaveBeenCalled();
  });
});
