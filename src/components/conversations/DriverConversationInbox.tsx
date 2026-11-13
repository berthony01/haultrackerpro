import { Link } from 'react-router-dom';
import { BriefcaseBusiness, MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useDriverConversationThreads } from '@/hooks/conversations/useConversations';
import { DriverConversationDialog } from './DriverConversationDialog';

interface Props {
  selectedThreadId: string | null;
  onSelectedThreadChange: (id: string | null) => void;
}

export function DriverConversationInbox({ selectedThreadId, onSelectedThreadChange }: Props) {
  const { threads, opportunityTitles, isLoading, error } = useDriverConversationThreads(true);
  const selected = threads.find(t => t.id === selectedThreadId) ?? null;
  return (
    <section aria-label="Driver conversations" className="space-y-4">
      {error && <p role="alert" className="text-destructive">Unable to load conversations.</p>}
      {isLoading && threads.length === 0 ? <p role="status">Loading conversations…</p> :
        threads.length === 0 ? (
          <div className="premium-card flex flex-col items-center px-5 py-8 text-center sm:px-8 sm:py-10">
            <div className="mb-4 rounded-2xl bg-primary/10 p-3 text-primary ring-1 ring-primary/20">
              <MessageSquareText className="h-7 w-7" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-bold">No conversations yet</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Review an opportunity and use its available application or contact options. When a recruiter conversation starts, it will appear here.
            </p>
            <Button asChild className="mt-5 min-h-12 w-full gap-2 sm:w-auto">
              <Link to="/dashboard?page=opportunities">
                <BriefcaseBusiness className="h-4 w-4" aria-hidden="true" />
                Explore opportunities
              </Link>
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {threads.map(t => (
              <li key={t.id}>
                <Button variant="outline" className="h-auto min-h-[44px] w-full justify-between gap-3 whitespace-normal text-left" onClick={() => onSelectedThreadChange(t.id)}>
                  <span className="min-w-0 break-words">{t.opportunity_id ? opportunityTitles[t.opportunity_id] ?? 'Opportunity' : 'General enquiry'}</span>
                  <Badge variant="outline">{t.status === 'requested' ? 'Requested' : t.status === 'active' ? 'Active' : t.status === 'closed' ? 'Closed' : 'Declined'}</Badge>
                </Button>
              </li>
            ))}
          </ul>
        )}
      {selectedThreadId && !selected && !isLoading && <p role="status">Conversation unavailable.</p>}
      {selected && <DriverConversationDialog key={selected.id} open onOpenChange={open => { if (!open) onSelectedThreadChange(null); }}
        existingThreadId={selected.id} opportunityId={selected.opportunity_id ?? ''}
        opportunityTitle={selected.opportunity_id ? opportunityTitles[selected.opportunity_id] ?? 'Opportunity' : 'General enquiry'} />}
    </section>
  );
}
