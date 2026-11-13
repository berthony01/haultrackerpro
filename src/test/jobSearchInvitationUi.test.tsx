import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ invitationsAvailable: vi.fn(), listMyInvitations: vi.fn(), respondToInvitation: vi.fn() }));
vi.mock('@/lib/jobSearch/jobSearchInvitationApi', () => api);
import { DriverJobSearchInvitations } from '@/components/conversations/DriverJobSearchInvitations';

const inv = { id: 'i1', status: 'pending', message: 'Hello driver', created_at: '', expires_at: '', thread_id: null, company_name: 'Acme Freight', recruiter_name: 'R', verified: true,
  opportunity_id: 'o1', opportunity_title: 'Regional CDL-A', opportunity_company: 'Acme', hiring_city: 'Dallas', hiring_state: 'TX', route_type: 'Regional', opportunity_open: true };

describe('driver invitations (HJ-2 gated)', () => {
  beforeEach(() => vi.resetAllMocks());
  it('renders nothing and never lists when the backend is unavailable', async () => {
    api.invitationsAvailable.mockResolvedValue(false);
    const { container } = render(<DriverJobSearchInvitations onOpenThread={() => {}} />);
    await waitFor(() => expect(api.invitationsAvailable).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
    expect(api.listMyInvitations).not.toHaveBeenCalled();
  });
  it('accept opens the returned conversation thread', async () => {
    api.invitationsAvailable.mockResolvedValue(true);
    api.listMyInvitations.mockResolvedValue([inv]);
    api.respondToInvitation.mockResolvedValue({ status: 'accepted', thread_id: 't1' });
    const open = vi.fn();
    render(<DriverJobSearchInvitations onOpenThread={open} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept and start conversation' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('t1'));
    expect(api.respondToInvitation).toHaveBeenCalledWith('i1', 'accept');
  });
  it('decline does not open a conversation', async () => {
    api.invitationsAvailable.mockResolvedValue(true);
    api.listMyInvitations.mockResolvedValue([inv]);
    api.respondToInvitation.mockResolvedValue({ status: 'declined', thread_id: null });
    const open = vi.fn();
    render(<DriverJobSearchInvitations onOpenThread={open} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(api.respondToInvitation).toHaveBeenCalledWith('i1', 'decline'));
    expect(open).not.toHaveBeenCalled();
  });
});
