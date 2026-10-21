import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useViewMode } from '@/hooks/useViewMode';
import { useActingContext } from '@/hooks/useActingContext';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { DriverConversationInbox } from '@/components/conversations/DriverConversationInbox';
import { RecruiterConversationInbox } from '@/components/conversations/RecruiterConversationInbox';
import { conversationUrl, validThreadId } from '@/lib/conversations/conversationNavigation';

/** Owner hooks mount only after the personal capability gate; never for staff. */
function OwnerInbox({ selectedThreadId, onSelect }: { selectedThreadId: string | null; onSelect: (id: string) => void }) {
  const { user } = useAuth();
  const { profile, isLoading, isSuspended, canPost } = useRecruiterProfile();
  if (isLoading) return <p role="status">Loading conversations…</p>;
  if (!profile || profile.user_id !== user?.id || isSuspended || !canPost) return <p role="status">Conversations are unavailable for this workspace.</p>;
  return <RecruiterConversationInbox key={`${user?.id}:${profile.id}`} recruiterId={profile.id} canView canReply
    includeHistory selectedThreadId={selectedThreadId} onSelectedThreadChange={onSelect} />;
}

export default function Conversations() {
  const { user, loading } = useAuth();
  const access = useViewMode();
  const acting = useActingContext();
  const [query, setQuery] = useSearchParams();
  const workspace = query.get('workspace') ?? access.effectiveRole;
  const threadHint = query.get('thread');
  const blocked = loading || !user || access.isLoading || !!access.error || acting.isActingAsAssistant || acting.isLoadingManagedDrivers;
  const driverAllowed = !blocked && access.driverWorkspaceAllowed;
  const recruiterAllowed = !blocked && access.recruiterAccessKind === 'capability' &&
    access.recruiterCapabilityStatus === 'active' && access.recruiterOperationsAllowed;
  const selectedThreadId = validThreadId(threadHint) ? threadHint : null;
  const select = (id: string | null) => {
    const next = new URLSearchParams(query);
    if (id) next.set('thread', id); else next.delete('thread');
    if (workspace === 'driver' || workspace === 'recruiter') next.set('workspace', workspace);
    setQuery(next);
  };
  const allowed = workspace === 'driver' ? driverAllowed : workspace === 'recruiter' ? recruiterAllowed : false;
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <header className="space-y-3">
          <h1 className="text-2xl font-bold">Conversations</h1>
          <p className="text-sm text-muted-foreground">{workspace === 'recruiter' ? 'Your conversations with drivers.' : 'Your conversations with recruiters.'}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link onClick={() => { if (allowed && (workspace === 'driver' || workspace === 'recruiter')) access.setViewMode(workspace); }} to={workspace === 'recruiter' ? '/dashboard?page=recruiter-access' : '/dashboard'}>Return to Dashboard</Link></Button>
            <Button asChild variant="ghost"><Link to="/start">Workspaces</Link></Button>
            {driverAllowed && workspace !== 'driver' && <Button asChild variant="outline"><Link to={conversationUrl('driver')}>Driver Conversations</Link></Button>}
            {recruiterAllowed && workspace !== 'recruiter' && <Button asChild variant="outline"><Link to={conversationUrl('recruiter')}>Recruiter Conversations</Link></Button>}
          </div>
        </header>
        {loading || access.isLoading ? <p role="status">Loading conversations…</p> : !allowed ?
          <p role="status">Conversations are unavailable for this workspace.</p> : threadHint && !validThreadId(threadHint) ?
            <p role="status">Conversation unavailable.</p> : workspace === 'driver' ?
              <DriverConversationInbox key={user?.id} selectedThreadId={selectedThreadId} onSelectedThreadChange={select} /> :
              <OwnerInbox key={user?.id} selectedThreadId={selectedThreadId} onSelect={select} />}
      </div>
    </main>
  );
}
