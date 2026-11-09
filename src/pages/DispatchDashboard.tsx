import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useViewMode } from '@/hooks/useViewMode';
import { useActingContext } from '@/hooks/useActingContext';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { useRecruiterStaffPermissions } from '@/hooks/recruiter/useRecruiterStaffPermissions';
import { DispatchWorkspace } from '@/components/telegram/DispatchWorkspace';
import { CompanyDriverConnectionsPanel } from '@/components/dispatch/CompanyDriverConnectionsPanel';
import SEOHead from '@/components/SEOHead';

function ScopedDispatch({ recruiterId, companyName, owner }: { recruiterId: string; companyName: string; owner: boolean }) {
  const perms = useRecruiterStaffPermissions(recruiterId);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  if (perms.isLoading) return <p role="status">Loading Dispatch permissions…</p>;
  if (perms.error || !perms.canViewLoads) return (
    <div role="alert">
      <h1 className="text-2xl font-bold">Dispatch access required</h1>
      <p className="mt-2 text-muted-foreground">Your company owner controls access to view, assign, and update loads.</p>
      <Button className="mt-4 min-h-12" variant="outline" onClick={perms.refetch}>Check access again</Button>
    </div>
  );
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-primary">Company workspace</p>
          <p className="break-words text-xl font-bold">{companyName}</p>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            The website and Telegram Mini App share assignments and load history.
            Enter the driver’s agreed pay when assigning a load.
          </p>
        </div>
        {owner && (
          <Button className="min-h-12" variant="outline" aria-expanded={connectionsOpen} onClick={() => setConnectionsOpen(open => !open)}>
            {connectionsOpen ? 'Close driver connections' : 'Connect drivers'}
          </Button>
        )}
      </header>
      {owner && connectionsOpen && <CompanyDriverConnectionsPanel recruiterId={recruiterId} />}
      <div className="min-w-0 rounded-2xl bg-slate-950 p-3 sm:p-5">
        <DispatchWorkspace recruiterId={recruiterId} />
      </div>
    </div>
  );
}
function OwnerDispatch() {
  const { profile, isLoading } = useRecruiterProfile();
  if (isLoading) return <p role="status">Loading company…</p>;
  if (!profile?.id) return <p role="alert">Your company workspace could not be verified.</p>;
  return <ScopedDispatch key={profile.id} recruiterId={profile.id} companyName={profile.company_name ?? 'Your company'} owner />;
}
export default function DispatchDashboard() {
  const { user } = useAuth();
  const access = useViewMode();
  const acting = useActingContext();
  const { isLoading, error, recruiterHubAllowed, setViewMode } = access;
  const { isActingAsAssistant } = acting;
  useEffect(() => {
    if (!isLoading && !error && recruiterHubAllowed && !isActingAsAssistant) setViewMode('recruiter');
  }, [isLoading, error, recruiterHubAllowed, setViewMode, isActingAsAssistant]);

  let content: React.ReactNode;
  if (access.isLoading || acting.isLoadingManagedDrivers) content = <p role="status">Loading workspace…</p>;
  else if (access.error || acting.isActingAsAssistant) content = <p role="alert">Dispatch is available in your own authorized company workspace.</p>;
  else if (access.recruiterAccessKind === 'capability' && access.recruiterCapabilityStatus === 'active' && access.recruiterOperationsAllowed) content = <OwnerDispatch key={user?.id} />;
  else if (access.recruiterCapabilityStatus !== null) content = <p role="alert">Active company access is required. Check your workspace setup.</p>;
  else if (access.staffLoading) content = <p role="status">Checking team access…</p>;
  else if (access.staffWorkspaceError) content = <p role="alert">Team access could not be verified.</p>;
  else if (access.staffSelectionRequired) content = (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Choose your Dispatch workspace</h1>
      {access.staffWorkspaces.map(workspace => (
        <Button className="min-h-12 w-full whitespace-normal" variant="outline" key={workspace.membershipId} onClick={() => access.selectStaffWorkspace(workspace.recruiterId)}>
          {workspace.companyName}
        </Button>
      ))}
    </div>
  );
  else if (access.recruiterAccessKind === 'staff' && access.recruiterHubAllowed && access.selectedStaffWorkspace) {
    const workspace = access.selectedStaffWorkspace;
    content = (
      <>
        <ScopedDispatch key={workspace.membershipId} recruiterId={workspace.recruiterId} companyName={workspace.companyName} owner={false} />
        {access.staffWorkspaces.length > 1 && <Button variant="outline" className="mt-4 min-h-12" onClick={access.clearStaffWorkspaceSelection}>Change company workspace</Button>}
      </>
    );
  } else content = (
    <div>
      <h1 className="text-2xl font-bold">No Dispatch workspace connected</h1>
      <p className="mt-2 text-muted-foreground">Ask your company owner to invite you as a team member with Dispatch permissions. Drivers receive assigned loads in their own Driver dashboard.</p>
    </div>
  );

  return (
    <main className="mx-auto min-h-screen w-full min-w-0 max-w-5xl space-y-6 px-4 py-6">
      <SEOHead title="Dispatch | HaulTrackerPro" description="Your company Dispatch workspace." path="/dispatch" noindex />
      <Button asChild variant="outline" className="min-h-12">
        <Link to={access.recruiterHubAllowed ? '/dashboard?page=recruiter-access' : '/dashboard'}>Back to workspace</Link>
      </Button>
      {content}
    </main>
  );
}
