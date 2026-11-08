import { useEffect, type MouseEvent } from 'react';
import { BriefcaseBusiness, ClipboardList, Home, MessageSquare, Plus, Settings, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useViewMode } from '@/hooks/useViewMode';
import { useActingContext } from '@/hooks/useActingContext';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { useRecruiterStaffPermissions } from '@/hooks/recruiter/useRecruiterStaffPermissions';
import { RecruiterOpportunityManager, RecruiterStaffOpportunityManager } from '@/components/opportunities/RecruiterOpportunityManager';
import { RecruiterApplicationsDashboard } from '@/components/opportunities/RecruiterApplicationsDashboard';
import { RecruiterStaffApplicationsDashboard } from '@/components/opportunities/RecruiterStaffApplicationsDashboard';
import { RecruiterOnboarding } from '@/components/opportunities/RecruiterOnboarding';
import { RecruiterConversationInbox } from '@/components/conversations/RecruiterConversationInbox';
import { validThreadId } from '@/lib/conversations/conversationNavigation';
import type { RecruiterStaffWorkspace } from '@/lib/recruiterStaffWorkspaceResolution';
import type { MiniAppView } from '@/lib/telegramMiniApp';
import { MiniAppNotice } from './MiniAppNotice';
import { DispatchWorkspace } from './DispatchWorkspace';

export type MiniAppNavigate = (view: MiniAppView, thread?: string | null) => void;
export type MiniAppWorkspaceProps = { view: MiniAppView; thread: string | null; navigate: MiniAppNavigate };

function MiniAppNavigation({ view, allowed, navigate }: { view: MiniAppView; allowed: readonly MiniAppView[]; navigate: MiniAppNavigate }) {
  const tabs = [
    { view: 'home' as const, label: 'Home', Icon: Home },
    { view: 'opportunities' as const, label: 'Jobs', Icon: BriefcaseBusiness },
    { view: 'applications' as const, label: 'Applicants', Icon: ClipboardList },
    { view: 'conversations' as const, label: 'Inbox', Icon: MessageSquare },
    { view: 'account' as const, label: 'Account', Icon: Settings },
  ];
  return <nav aria-label="Mini App navigation" className="mini-app-navigation">
    <div className="mx-auto grid w-full max-w-4xl grid-cols-5 gap-1 px-2">
      {tabs.filter(tab => allowed.includes(tab.view)).map(({ view: target, label, Icon }) => <button key={target} type="button" aria-current={view === target || (view === 'post' && target === 'opportunities') ? 'page' : undefined}
        onClick={() => navigate(target)} className="flex min-h-[60px] min-w-0 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl text-[11px] font-medium text-muted-foreground aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />{label}
      </button>)}
    </div>
  </nav>;
}

function WorkspaceFrame({ title, subtitle, children, allowed, ...props }: MiniAppWorkspaceProps & { title: string; subtitle: string; children: React.ReactNode; allowed: MiniAppView[] }) {
  // Existing applicant cards keep their canonical website links. Inside this
  // surface, a permitted recruiter conversation opens in the Mini App inbox.
  const interceptConversation = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[href]');
    if (!anchor) return;
    const url = new URL(anchor.getAttribute('href')!, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== '/conversations' || url.searchParams.get('workspace') !== 'recruiter') return;
    event.preventDefault();
    props.navigate('conversations', url.searchParams.get('thread'));
  };
  return <section onClickCapture={interceptConversation} className="min-w-0 space-y-5">
    <div className={`flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border/60 bg-card/60 ${props.view === 'dispatch' ? 'px-4 py-3' : 'p-4'}`}>
      <div className="min-w-0"><p className="break-words text-base font-bold">{title}</p><p className="mt-1 text-xs text-muted-foreground">{subtitle}</p></div>
      {allowed.includes('post') && props.view !== 'post' && props.view !== 'dispatch' && <Button size="sm" onClick={() => props.navigate('post')}><Plus className="mr-1 h-4 w-4" />New job</Button>}
    </div>
    {children}
    <MiniAppNavigation view={props.view} allowed={allowed} navigate={props.navigate} />
  </section>;
}

function HomeTiles({ allowed, navigate }: { allowed: MiniAppView[]; navigate: MiniAppNavigate }) {
  const tiles = [
    { view: 'post' as const, title: 'Post opportunity', body: 'Start a new job post. Review the details, save a draft or publish.', Icon: Plus },
    { view: 'opportunities' as const, title: 'My opportunities', body: 'Resume saved drafts and manage your listings.', Icon: BriefcaseBusiness },
    { view: 'applications' as const, title: 'Applications', body: 'Review applicants and keep your hiring pipeline moving.', Icon: ClipboardList },
    { view: 'conversations' as const, title: 'Conversations', body: 'Read and reply to your HaulTracker conversations.', Icon: MessageSquare },
    { view: 'dispatch' as const, title: 'Dispatch', body: 'Connected drivers, assigned loads and confirmed deliveries.', Icon: Truck },
  ];
  return <div className="grid min-w-0 gap-3 sm:grid-cols-2">
    {tiles.filter(tile => allowed.includes(tile.view)).map(({ view, title, body, Icon }) => <button type="button" key={view} onClick={() => navigate(view)} className="group min-w-0 rounded-2xl border border-border/60 bg-card p-5 text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
      <span className="block text-lg font-bold">{title}</span><span className="mt-2 block text-sm leading-relaxed text-muted-foreground">{body}</span>
    </button>)}
    {tiles.every(tile => !allowed.includes(tile.view)) && <MiniAppNotice title="No recruiting tools assigned">Your administrator controls the recruiting permissions available in this workspace. Dispatch tools remain available through the bot and website.</MiniAppNotice>}
  </div>;
}

function OwnerWorkspace(props: MiniAppWorkspaceProps) {
  const { user } = useAuth();
  const { profile, isLoading, isSuspended, canPost } = useRecruiterProfile();
  const dispatchPerms = useRecruiterStaffPermissions(profile?.user_id === user?.id ? profile?.id : null);
  if (isLoading) return <MiniAppNotice title="Loading your workspace…" />;
  if (isSuspended || (profile && profile.user_id !== user?.id)) return <MiniAppNotice title="Workspace unavailable">Your recruiter workspace cannot be opened right now.</MiniAppNotice>;
  const allowed: MiniAppView[] = ['home', 'post', 'opportunities', 'account', ...(canPost ? ['applications', 'conversations'] as const : [])];
  if (!dispatchPerms.isLoading && !dispatchPerms.error && dispatchPerms.canViewLoads) allowed.push('dispatch');
  const home = () => props.navigate('home');
  let content: React.ReactNode;
  if (props.view === 'dispatch') content = dispatchPerms.isLoading ? <MiniAppNotice title="Loading your dispatch permissions…" /> : allowed.includes('dispatch') && profile ? <DispatchWorkspace key={`${user?.id}:${profile.id}`} recruiterId={profile.id} /> : <MiniAppNotice title="Dispatch permission required"><Button variant="outline" onClick={home}>Return home</Button></MiniAppNotice>;
  else if (!allowed.includes(props.view)) content = <MiniAppNotice title="Complete your recruiter profile"><Button onClick={() => props.navigate('account')}>Open company profile</Button></MiniAppNotice>;
  else if (props.view === 'post' || props.view === 'opportunities') content = <RecruiterOpportunityManager key={`${user?.id}:${props.view}`} initialAction={props.view === 'post' ? 'create' : undefined} onCreationFinished={() => props.navigate('opportunities')} onBack={home} />;
  else if (props.view === 'applications') content = <RecruiterApplicationsDashboard onBack={home} />;
  else if (props.view === 'conversations') content = profile ? <RecruiterConversationInbox key={`${user?.id}:${profile.id}`} recruiterId={profile.id} canView canReply includeHistory selectedThreadId={validThreadId(props.thread) ? props.thread : null} onSelectedThreadChange={id => props.navigate('conversations', id)} /> : null;
  else if (props.view === 'account') content = <RecruiterOnboarding onBack={home} />;
  else content = <><div><h1 className="text-2xl font-bold">Your recruiting workspace</h1><p className="mt-2 text-sm text-muted-foreground">The same opportunities and conversations you use on HaulTrackerPro.com.</p></div>
    {!canPost && <MiniAppNotice title="Finish your company profile">Complete the required company details and posting terms before publishing. <Button className="mt-3" onClick={() => props.navigate('account')}>Complete profile</Button></MiniAppNotice>}
    <HomeTiles allowed={allowed} navigate={props.navigate} /></>;
  return <WorkspaceFrame {...props} allowed={allowed} title={profile?.company_name || 'Recruiter workspace'} subtitle={`Owner · ${user?.email ?? 'HaulTracker account'}`}>{content}</WorkspaceFrame>;
}

function StaffWorkspace({ workspace, changeWorkspace, ...props }: MiniAppWorkspaceProps & { workspace: RecruiterStaffWorkspace; changeWorkspace?: () => void }) {
  const perms = useRecruiterStaffPermissions(workspace.recruiterId);
  if (perms.isLoading) return <MiniAppNotice title="Loading your workspace permissions…" />;
  if (perms.error) return <MiniAppNotice title="Workspace unavailable">Your current permissions could not be verified.</MiniAppNotice>;
  const allowed: MiniAppView[] = ['home', 'account'];
  if (perms.canViewOpportunities) allowed.push('opportunities');
  if (perms.canViewOpportunities && perms.canCreateOpportunities) allowed.push('post');
  if (perms.canViewApplications) allowed.push('applications');
  if (perms.canViewConversations) allowed.push('conversations');
  if (perms.canViewLoads) allowed.push('dispatch');
  const home = () => props.navigate('home');
  let content: React.ReactNode;
  if (!allowed.includes(props.view)) content = <MiniAppNotice title="Permission required">This action has not been assigned to you in this workspace. <Button variant="outline" className="mt-3" onClick={home}>Return home</Button></MiniAppNotice>;
  else if (props.view === 'dispatch') content = <DispatchWorkspace key={`${workspace.membershipId}:${workspace.recruiterId}`} recruiterId={workspace.recruiterId} />;
  else if (props.view === 'post' || props.view === 'opportunities') content = <RecruiterStaffOpportunityManager key={`${workspace.membershipId}:${props.view}`} recruiterId={workspace.recruiterId} companyName={workspace.companyName} initialAction={props.view === 'post' ? 'create' : undefined} onCreationFinished={() => props.navigate('opportunities')} onBack={home} permissions={perms} />;
  else if (props.view === 'applications') content = <RecruiterStaffApplicationsDashboard recruiterId={workspace.recruiterId} companyName={workspace.companyName} canViewApplications={perms.canViewApplications} canManageApplicationStatus={perms.canManageApplicationStatus} canRequestApplicationContact={perms.canRequestApplicationContact} onBack={home} />;
  else if (props.view === 'conversations') content = <RecruiterConversationInbox key={workspace.membershipId} recruiterId={workspace.recruiterId} canView={perms.canViewConversations} canReply={perms.canReplyConversations} includeHistory={false} selectedThreadId={validThreadId(props.thread) ? props.thread : null} onSelectedThreadChange={id => props.navigate('conversations', id)} />;
  else if (props.view === 'account') content = <MiniAppNotice title="Your team workspace"><p>Your administrator manages your permissions for {workspace.companyName}. Company ownership and billing remain with the workspace owner.</p>{changeWorkspace && <Button variant="outline" className="mt-3" onClick={changeWorkspace}>Choose another workspace</Button>}</MiniAppNotice>;
  else content = <><div><h1 className="text-2xl font-bold">Your team workspace</h1><p className="mt-2 text-sm text-muted-foreground">Tools assigned to you by {workspace.companyName}.</p></div><HomeTiles allowed={allowed} navigate={props.navigate} /></>;
  return <WorkspaceFrame {...props} allowed={allowed} title={workspace.companyName} subtitle={workspace.memberRole === 'recruiter_admin' ? 'Workspace administrator' : 'Workspace staff'}>{content}</WorkspaceFrame>;
}

export function MiniAppWorkspace(props: MiniAppWorkspaceProps) {
  const access = useViewMode();
  const acting = useActingContext();
  const { isLoading: accessLoading, error: accessError, recruiterHubAllowed, setViewMode } = access;
  useEffect(() => {
    if (!accessLoading && !accessError && recruiterHubAllowed && !acting.isActingAsAssistant) setViewMode('recruiter');
  }, [accessLoading, accessError, recruiterHubAllowed, setViewMode, acting.isActingAsAssistant]);
  if (access.isLoading || acting.isLoadingManagedDrivers) return <MiniAppNotice title="Loading your account access…" />;
  if (access.error || acting.isActingAsAssistant) return <MiniAppNotice title="Workspace unavailable">Open your own HaulTracker workspace on the website to check access.</MiniAppNotice>;
  if (access.recruiterAccessKind === 'capability') {
    if (!access.recruiterHubAllowed) return <MiniAppNotice title="Workspace unavailable" />;
    if (access.recruiterCapabilityStatus === 'setup') return <><MiniAppNotice title="Complete your recruiter profile">Add your company details and accept the posting terms to begin.</MiniAppNotice><RecruiterOnboarding onBack={() => props.navigate('home')} /></>;
    if (access.recruiterCapabilityStatus !== 'active' || !access.recruiterOperationsAllowed) return <MiniAppNotice title="Workspace unavailable">This account does not currently have active recruiter access.</MiniAppNotice>;
    return <OwnerWorkspace {...props} />;
  }
  if (access.recruiterCapabilityStatus !== null) return <MiniAppNotice title="Workspace unavailable" />;
  if (access.staffLoading) return <MiniAppNotice title="Loading your team access…" />;
  if (access.staffWorkspaceError) return <MiniAppNotice title="Team access unavailable">Try again or check your workspace invitation on the website.</MiniAppNotice>;
  if (access.staffSelectionRequired) return <MiniAppNotice title="Choose your workspace"><div className="mt-3 grid gap-3">{access.staffWorkspaces.map(workspace => <Button key={workspace.membershipId} variant="outline" className="min-h-12 h-auto whitespace-normal" onClick={() => access.selectStaffWorkspace(workspace.recruiterId)}>{workspace.companyName}</Button>)}</div></MiniAppNotice>;
  if (access.recruiterAccessKind === 'staff' && access.recruiterHubAllowed && access.selectedStaffWorkspace) return <StaffWorkspace key={access.selectedStaffWorkspace.membershipId} {...props} workspace={access.selectedStaffWorkspace} changeWorkspace={access.staffWorkspaces.length > 1 ? access.clearStaffWorkspaceSelection : undefined} />;
  return <MiniAppNotice title="No recruiter workspace connected">This Mini App is for recruiters and authorized recruiting staff. Complete your team invitation or add a recruiter workspace on HaulTrackerPro.com.</MiniAppNotice>;
}
