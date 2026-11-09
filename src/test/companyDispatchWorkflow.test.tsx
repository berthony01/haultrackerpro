import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadCard } from '@/components/LoadCard';
import { useLoads, type Load } from '@/hooks/useLoads';
import DispatchDashboard from '@/pages/DispatchDashboard';
import DriverCompanyConnections from '@/pages/DriverCompanyConnections';

const h = vi.hoisted(() => ({
  userId: 'owner',
  targetUserId: 'owner',
  acting: false,
  canView: true,
  rpc: vi.fn(),
  profile: vi.fn(),
  access: {} as Record<string, unknown>,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: h.userId } }) }));
vi.mock('@/hooks/useActingContext', () => ({
  useActingContext: () => ({ isActingAsAssistant: h.acting, isLoadingManagedDrivers: false }),
  useTargetUserId: () => h.targetUserId,
}));
vi.mock('@/hooks/useViewMode', () => ({ useViewMode: () => h.access }));
vi.mock('@/hooks/opportunities/useRecruiterProfile', () => ({ useRecruiterProfile: h.profile }));
vi.mock('@/hooks/recruiter/useRecruiterStaffPermissions', () => ({
  useRecruiterStaffPermissions: () => ({ canViewLoads: h.canView, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/components/telegram/DispatchWorkspace', () => ({
  DispatchWorkspace: ({ recruiterId }: { recruiterId: string }) => <section aria-label="Dispatch workspace">{recruiterId}</section>,
}));

function providers() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function Providers({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}><HelmetProvider><MemoryRouter>{children}</MemoryRouter></HelmetProvider></QueryClientProvider>;
  };
}

const emptyConnections = { invites: [], relationships: [], can_invite: false };
const ownerWorkspace = { recruiterAccessKind: 'capability', recruiterCapabilityStatus: 'active', recruiterOperationsAllowed: true, recruiterHubAllowed: true };
beforeEach(() => {
  h.userId = h.targetUserId = 'owner';
  h.canView = true;
  h.acting = false;
  h.access = {
    isLoading: false, error: null, recruiterAccessKind: null, recruiterCapabilityStatus: null,
    recruiterHubAllowed: false, recruiterOperationsAllowed: false, driverWorkspaceAllowed: false,
    setViewMode: vi.fn(), staffWorkspaces: [],
  };
  h.rpc.mockReset();
  h.profile.mockReset().mockReturnValue({ profile: { id: 'company-a', company_name: 'Fixture Carrier' }, isLoading: false });
});
afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe('Website Dispatch and company connections', () => {
  it('lets the company owner start a connection without an applicant record', async () => {
    Object.assign(h.access, ownerWorkspace);
    h.rpc.mockImplementation(async (fn: string) => ({
      data: fn === 'company_driver_connections'
        ? { ...emptyConnections, can_invite: true }
        : { id: 'request-a', status: 'pending' },
      error: null,
    }));
    render(<DispatchDashboard />, { wrapper: providers() });
    expect(screen.getByRole('region', { name: 'Dispatch workspace' })).toHaveTextContent('company-a');
    expect(h.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect drivers' }));
    const email = await screen.findByLabelText('Driver’s account email');
    fireEvent.change(email, { target: { value: 'driver@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create connection request' }));
    await screen.findByText(/Request saved/);
    expect(h.rpc).toHaveBeenCalledWith('company_driver_invite', { _recruiter_id: 'company-a', _email: 'driver@example.test' });
  });

  it('mounts the staff load board with load access and removes it when access is denied', () => {
    h.userId = 'staff';
    Object.assign(h.access, {
      recruiterAccessKind: 'staff', recruiterHubAllowed: true,
      selectedStaffWorkspace: { recruiterId: 'company-b', membershipId: 'staff-b', companyName: 'Company B' },
    });
    const view = render(<DispatchDashboard />, { wrapper: providers() });
    expect(screen.getByRole('region', { name: 'Dispatch workspace' })).toHaveTextContent('company-b');
    expect(screen.queryByRole('button', { name: 'Connect drivers' })).toBeNull();
    expect(h.profile).not.toHaveBeenCalled();
    h.canView = false;
    view.rerender(<DispatchDashboard />);
    expect(screen.queryByRole('region', { name: 'Dispatch workspace' })).toBeNull();
    expect(screen.getByText('Dispatch access required')).toBeInTheDocument();
  });

  it('denies driver-only and delegated-assistant visits to the company load board', () => {
    h.access.driverWorkspaceAllowed = true;
    const view = render(<DispatchDashboard />, { wrapper: providers() });
    expect(screen.getByText('No Dispatch workspace connected')).toBeInTheDocument();
    Object.assign(h.access, ownerWorkspace);
    h.acting = true;
    view.rerender(<DispatchDashboard />);
    expect(screen.queryByRole('region', { name: 'Dispatch workspace' })).toBeNull();
    expect(h.profile).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('shows company consent before accepting as the driver and updates the connection list on confirmation', async () => {
    h.userId = 'driver';
    h.access.driverWorkspaceAllowed = true;
    let accepted = false;
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'company_driver_respond') {
        accepted = true;
        return { data: { status: 'accepted', relationship_id: 'rel' }, error: null };
      }
      const row = { id: 'invite', company_name: 'Fixture Carrier' };
      return { data: {
        ...emptyConnections,
        invites: accepted ? [] : [{ ...row, status: 'pending', expires_at: '2026-12-01T00:00:00Z' }],
        relationships: accepted ? [{ ...row, id: 'rel', status: 'active' }] : [],
      }, error: null };
    });
    render(<DriverCompanyConnections />, { wrapper: providers() });
    const accept = await screen.findByRole('button', { name: 'Accept connection' });
    expect(screen.getByText(/Accepting lets this company assign loads/)).toHaveTextContent('personal expenses, tax settings');
    expect(h.rpc.mock.calls.every(([fn]) => fn === 'company_driver_connections')).toBe(true);
    fireEvent.click(accept);
    await screen.findByRole('button', { name: 'Disconnect' });
    expect(h.rpc).toHaveBeenCalledWith('company_driver_respond', { _invite_id: 'invite', _accept: true });
    expect(screen.queryByRole('button', { name: 'Accept connection' })).toBeNull();
  });
});

const pendingLoad = {
  id: 'assigned', user_id: 'driver', load_reference: 'DRIVERQA1',
  carrier_driver_relationship_id: 'rel', dispatch_company_name: 'Fixture Carrier',
  load_date: '2026-01-30', dropoff_date: '2026-01-31', created_at: '2026-01-30T12:00:00Z',
  status: 'pending', pickup_location: 'Dallas, TX', dropoff_location: 'Austin, TX',
  loaded_miles: 14.5, total_miles: 14.5, estimated_pay: 29.15, rate_per_mile: 2.01,
} as Load;

describe('Driver assignment updates', () => {
  it('refreshes an open driver view without clearing it and pauses hidden polling', async () => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    h.userId = h.targetUserId = 'driver';
    let resolveRefresh!: (value: unknown) => void;
    const delayed = new Promise(resolve => { resolveRefresh = resolve; });
    h.rpc.mockResolvedValueOnce({ data: { loads: [pendingLoad], totalCount: 1 }, error: null })
      .mockReturnValueOnce(delayed);
    const { result } = renderHook(() => useLoads(undefined, undefined, { watchDispatch: true }), { wrapper: providers() });
    await act(() => vi.advanceTimersByTimeAsync(5));
    expect(result.current.loads[0]?.status).toBe('pending');
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.loads[0]?.status).toBe('pending');
    await act(async () => {
      resolveRefresh({ data: { loads: [{ ...pendingLoad, status: 'completed', actual_delivery_date: '2026-02-01' }], totalCount: 1 }, error: null });
      await vi.advanceTimersByTimeAsync(5);
    });
    expect(result.current.loads[0]).toMatchObject({ id: 'assigned', status: 'completed', actual_delivery_date: '2026-02-01' });
    act(() => focusManager.setFocused(false));
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });

  it('clears a previously cached target when the authenticated account changes', async () => {
    h.userId = 'assistant-a';
    h.targetUserId = 'driver';
    h.rpc.mockResolvedValueOnce({ data: { loads: [pendingLoad], totalCount: 1 }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    const { result, rerender } = renderHook(() => useLoads(), { wrapper: providers() });
    await waitFor(() => expect(result.current.loads).toHaveLength(1));
    h.userId = 'assistant-b';
    rerender();
    expect(result.current.loads).toEqual([]);
    await waitFor(() => expect(result.current.error).toEqual({ code: '42501' }));
    expect(result.current.loads).toEqual([]);
  });

  it('records actual pay without marking a pending company assignment delivered', () => {
    const update = vi.fn();
    render(<LoadCard load={pendingLoad} onEdit={vi.fn()} onDelete={vi.fn()} onUpdate={update} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record Actual Pay' }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '27.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save actual pay' }));
    expect(update).toHaveBeenCalledWith('assigned', { actual_pay_received: 27.5 });
  });
});
