import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MiniAppWorkspace } from '@/components/telegram/MiniAppWorkspace';
import type { MiniAppView } from '@/lib/telegramMiniApp';

const h = vi.hoisted(() => ({
  access: {} as any, acting: {} as any, profile: {} as any, perms: {} as any,
  ownerHook: vi.fn(), ownerManager: vi.fn(), staffManager: vi.fn(), ownerApps: vi.fn(), staffApps: vi.fn(), inbox: vi.fn(), onboarding: vi.fn(), navigate: vi.fn(),
  dispatch: vi.fn(),
}));
const uid = '10000000-0000-4000-8000-000000000001';
const thread = '20000000-0000-4000-8000-000000000001';
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: '10000000-0000-4000-8000-000000000001', email: 'qa@example.invalid' } }) }));
vi.mock('@/hooks/useViewMode', () => ({ useViewMode: () => h.access }));
vi.mock('@/hooks/useActingContext', () => ({ useActingContext: () => h.acting }));
vi.mock('@/hooks/opportunities/useRecruiterProfile', () => ({ useRecruiterProfile: () => { h.ownerHook(); return h.profile; } }));
vi.mock('@/hooks/recruiter/useRecruiterStaffPermissions', () => ({ useRecruiterStaffPermissions: () => h.perms }));
vi.mock('@/components/telegram/DispatchWorkspace', () => ({ DispatchWorkspace: (props: any) => { h.dispatch(props); return <div data-testid="dispatch-workspace" />; } }));
vi.mock('@/components/opportunities/RecruiterOpportunityManager', () => ({
  RecruiterOpportunityManager: (props: any) => { h.ownerManager(props); return <div data-testid="owner-manager" />; },
  RecruiterStaffOpportunityManager: (props: any) => { h.staffManager(props); return <div data-testid="staff-manager" />; },
}));
vi.mock('@/components/opportunities/RecruiterApplicationsDashboard', () => ({ RecruiterApplicationsDashboard: (props: any) => { h.ownerApps(props); return <div data-testid="owner-applications" />; } }));
vi.mock('@/components/opportunities/RecruiterStaffApplicationsDashboard', () => ({ RecruiterStaffApplicationsDashboard: (props: any) => { h.staffApps(props); return <a href="/conversations?workspace=recruiter&thread=20000000-0000-4000-8000-000000000001">Read conversation</a>; } }));
vi.mock('@/components/opportunities/RecruiterOnboarding', () => ({ RecruiterOnboarding: (props: any) => { h.onboarding(props); return <div data-testid="company-profile" />; } }));
vi.mock('@/components/conversations/RecruiterConversationInbox', () => ({ RecruiterConversationInbox: (props: any) => { h.inbox(props); return <div data-testid="conversation-inbox" />; } }));

beforeEach(() => {
  vi.clearAllMocks();
  h.access = { isLoading: false, error: null, recruiterHubAllowed: true, recruiterAccessKind: 'capability', recruiterCapabilityStatus: 'active', recruiterOperationsAllowed: true,
    staffLoading: false, staffWorkspaceError: null, staffSelectionRequired: false, staffWorkspaces: [], selectedStaffWorkspace: null, setViewMode: vi.fn(), selectStaffWorkspace: vi.fn(), clearStaffWorkspaceSelection: vi.fn() };
  h.acting = { isActingAsAssistant: false, isLoadingManagedDrivers: false };
  h.profile = { profile: { id: 'recruiter-qa', user_id: uid, company_name: 'Synthetic QA Carrier' }, isLoading: false, isSuspended: false, canPost: true };
  h.perms = { isLoading: false, error: null, canViewOpportunities: true, canCreateOpportunities: true, canViewApplications: true, canManageApplicationStatus: false, canRequestApplicationContact: false, canViewConversations: true, canReplyConversations: false };
});

const open = (view: MiniAppView = 'home', selectedThread: string | null = null) => render(<MiniAppWorkspace view={view} thread={selectedThread} navigate={h.navigate} />);
function staff() {
  h.access.recruiterAccessKind = 'staff'; h.access.recruiterCapabilityStatus = null; h.access.recruiterOperationsAllowed = false;
  h.access.selectedStaffWorkspace = { membershipId: 'member-qa', recruiterId: 'recruiter-qa', companyName: 'Synthetic QA Carrier', memberRole: 'recruiter_staff' };
}

describe('Mini App workspace permissions', () => {
  it('opens Dispatch for staff with load access and no opportunity access', () => {
    staff(); h.perms.canViewLoads=true; h.perms.canViewOpportunities=false; h.perms.canCreateOpportunities=false;
    open('dispatch'); expect(screen.getByTestId('dispatch-workspace')).toBeInTheDocument();
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({recruiterId:'recruiter-qa'}));expect(h.ownerHook).not.toHaveBeenCalled();
  });
  it('does not mount Dispatch without explicit load-view access', () => {
    staff(); h.perms.canViewLoads=false;open('dispatch');expect(h.dispatch).not.toHaveBeenCalled();
  });
  it('shows owner tasks and opens the selected destination directly', () => {
    open(); expect(screen.getByText('Synthetic QA Carrier')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Post opportunity Start/ })); expect(h.navigate).toHaveBeenCalledWith('post');
  });
  it('hands Post Opportunity to the existing readiness-gated manager without writing a draft', () => {
    open('post'); expect(h.ownerManager).toHaveBeenCalledWith(expect.objectContaining({ initialAction: 'create' }));
    expect(h.staffManager).not.toHaveBeenCalled();
  });
  it.each(['isLoading', 'error'] as const)('does not mount business hooks while capability %s is unresolved', field => {
    h.access[field] = field === 'error' ? new Error('unavailable') : true;
    open('post'); expect(h.ownerHook).not.toHaveBeenCalled(); expect(h.ownerManager).not.toHaveBeenCalled();
  });
  it.each(['suspended', 'revoked', null])('does not mount owner data for capability %s', status => {
    h.access.recruiterCapabilityStatus = status; open('applications');
    expect(h.ownerHook).not.toHaveBeenCalled(); expect(h.ownerApps).not.toHaveBeenCalled();
  });
  it('requires both the hub and operational access for an active owner', () => {
    h.access.recruiterOperationsAllowed = false; open('post'); expect(h.ownerHook).not.toHaveBeenCalled();
  });
  it('keeps setup accounts in the existing company onboarding', () => {
    h.access.recruiterCapabilityStatus = 'setup'; h.access.recruiterOperationsAllowed = false; open('post');
    expect(screen.getByTestId('company-profile')).toBeInTheDocument(); expect(h.ownerManager).not.toHaveBeenCalled(); expect(h.ownerHook).not.toHaveBeenCalled();
  });
  it('does not expose a cached profile belonging to another user', () => {
    h.profile.profile.user_id = 'other-user'; open();
    expect(screen.queryByText('Synthetic QA Carrier')).not.toBeInTheDocument(); expect(h.ownerApps).not.toHaveBeenCalled();
  });
  it('keeps delegated-driver contexts outside the recruiter workspace', () => {
    h.acting.isActingAsAssistant = true; open('conversations'); expect(h.ownerHook).not.toHaveBeenCalled(); expect(h.inbox).not.toHaveBeenCalled();
  });
  it('does not substitute a staff membership for a conflicting personal capability', () => {
    staff(); h.access.recruiterCapabilityStatus = 'setup'; open('opportunities');
    expect(h.staffManager).not.toHaveBeenCalled(); expect(h.ownerHook).not.toHaveBeenCalled();
  });
  it('uses staff controllers without mounting owner hooks', () => {
    staff(); open('post'); expect(h.staffManager).toHaveBeenCalledWith(expect.objectContaining({ recruiterId: 'recruiter-qa', initialAction: 'create', permissions: h.perms }));
    expect(h.ownerHook).not.toHaveBeenCalled(); expect(h.ownerManager).not.toHaveBeenCalled();
  });
  it.each(['post', 'opportunities', 'applications', 'conversations'] as const)('requires the specific staff permission for %s', view => {
    staff(); h.perms.canViewOpportunities = false; h.perms.canCreateOpportunities = false; h.perms.canViewApplications = false; h.perms.canViewConversations = false;
    open(view); expect(screen.getByRole('heading', { name: 'Permission required' })).toBeInTheDocument();
    expect(h.staffManager).not.toHaveBeenCalled(); expect(h.staffApps).not.toHaveBeenCalled(); expect(h.inbox).not.toHaveBeenCalled(); expect(h.ownerHook).not.toHaveBeenCalled();
  });
  it('removes a staff form immediately if creation permission is revoked', () => {
    staff(); const view = open('post'); expect(screen.getByTestId('staff-manager')).toBeInTheDocument();
    h.perms.canCreateOpportunities = false; view.rerender(<MiniAppWorkspace view="post" thread={null} navigate={h.navigate} />);
    expect(screen.queryByTestId('staff-manager')).not.toBeInTheDocument();
  });
  it('passes view-only conversation access without adding reply or history permission', () => {
    staff(); open('conversations', thread);
    expect(h.inbox).toHaveBeenCalledWith(expect.objectContaining({ canView: true, canReply: false, includeHistory: false, selectedThreadId: thread }));
  });
  it('keeps applicant conversation links inside the Mini App', () => {
    staff(); open('applications'); fireEvent.click(screen.getByRole('link', { name: 'Read conversation' }));
    expect(h.navigate).toHaveBeenCalledWith('conversations', thread);
  });
  it('requires explicit selection from server-discovered staff workspaces', () => {
    staff(); h.access.selectedStaffWorkspace = null; h.access.staffSelectionRequired = true;
    h.access.staffWorkspaces = [{ membershipId: 'member-qa', recruiterId: 'recruiter-qa', companyName: 'Synthetic QA Carrier' }];
    open('post'); fireEvent.click(screen.getByRole('button', { name: 'Synthetic QA Carrier' }));
    expect(h.access.selectStaffWorkspace).toHaveBeenCalledWith('recruiter-qa'); expect(h.staffManager).not.toHaveBeenCalled();
  });
});
