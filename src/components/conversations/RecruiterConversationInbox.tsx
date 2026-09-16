/**
 * Phase CF-1B — shared recruiter conversation inbox (owner + staff).
 *
 * Fail-closed: `canView === false` renders no thread content at all.
 * `canReply === false` renders readable messages with no mutation control.
 * Every mutation is a CF-1A RPC; the server re-resolves recruiter authority
 * on every call, so client props are UX only.
 *
 * Peer identity is neutral ("Driver") — no profile, auth.users, or
 * driver_opportunity_profiles lookup exists in this component.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Loader2, MessageSquare } from 'lucide-react';
import {
  useConversationMessages,
  useRecruiterConversationActions,
  useRecruiterConversationThreads,
  type ConversationMessage,
} from '@/hooks/conversations/useConversations';

interface Props {
  recruiterId: string;
  companyName?: string | null;
  canView: boolean;
  canReply: boolean;
  onBack?: () => void;
}

function MessageRow({ message }: { message: ConversationMessage }) {
  const fromRecruiter = message.sender_actor_type === 'recruiter';
  return (
    <div
      className={`flex ${fromRecruiter ? 'justify-end' : 'justify-start'}`}
      data-testid="conversation-message"
      data-actor={message.sender_actor_type}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 ${
          fromRecruiter ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
        }`}
      >
        <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">
          {fromRecruiter ? 'You' : 'Driver'}
        </p>
        <p className="text-sm whitespace-pre-line break-words">{message.body}</p>
      </div>
    </div>
  );
}

export function RecruiterConversationInbox({
  recruiterId,
  companyName,
  canView,
  canReply,
  onBack,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const { threads, opportunityTitles, isLoading, error, refetch } =
    useRecruiterConversationThreads(recruiterId, canView);
  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId],
  );
  const {
    messages,
    isLoading: messagesLoading,
    refetch: refetchMessages,
  } = useConversationMessages(selected?.id ?? null, canView && !!selected);

  const { isBusy, actionError, acceptThread, declineThread, replyToThread, closeThread } =
    useRecruiterConversationActions(() => {
      refetch();
      refetchMessages();
    });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [selected?.id, messages.length]);

  if (!canView) {
    return (
      <Card
        className="p-5 border-border/60"
        role="status"
        data-testid="recruiter-conversation-inbox-unavailable"
      >
        <p className="text-sm text-muted-foreground">Conversations are unavailable.</p>
      </Card>
    );
  }

  const handleReply = async () => {
    if (!selected) return;
    await replyToThread(selected.id, reply);
    setReply('');
  };

  return (
    <Card className="p-5 border-border/60" data-testid="recruiter-conversation-inbox">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
            <MessageSquare className="h-4 w-4 text-primary" aria-hidden />
            Conversation Inbox
          </h3>
          {companyName && (
            <p className="text-xs text-muted-foreground break-words">{companyName}</p>
          )}
        </div>
        {!canReply && (
          <Badge variant="outline" data-testid="conversation-view-only">
            View only
          </Badge>
        )}
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        )}
      </div>

      {(error || actionError) && (
        <p role="alert" className="mb-3 text-sm text-destructive break-words">
          {error ?? actionError}
        </p>
      )}

      {isLoading && threads.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" />
        </div>
      ) : threads.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="conversation-empty">
          No open driver conversations yet.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
          <ul className="space-y-2" data-testid="conversation-thread-list">
            {threads.map((t) => {
              const title = t.opportunity_id
                ? (opportunityTitles[t.opportunity_id] ?? 'Opportunity')
                : 'General enquiry';
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    data-testid="conversation-thread-item"
                    aria-current={selectedId === t.id}
                    className={`w-full min-h-[44px] rounded-xl border p-3 text-left ${
                      selectedId === t.id ? 'border-primary/50 bg-primary/5' : 'border-border/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-foreground">Driver</span>
                      <Badge
                        variant={t.status === 'requested' ? 'default' : 'outline'}
                        className="text-[10px]"
                      >
                        {t.status === 'requested' ? 'Requested' : 'Active'}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground break-words">{title}</p>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="min-w-0">
            {!selected ? (
              <p className="text-sm text-muted-foreground">
                Select a conversation to read it.
              </p>
            ) : (
              <div className="space-y-3" data-testid="conversation-thread-detail">
                {messagesLoading && messages.length === 0 ? (
                  <div className="flex items-center justify-center py-6 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading messages" />
                  </div>
                ) : (
                  <div
                    className="max-h-[42vh] space-y-2 overflow-y-auto pr-1"
                    data-testid="conversation-message-list"
                  >
                    {messages.map((m) => (
                      <MessageRow key={m.id} message={m} />
                    ))}
                    <div ref={bottomRef} />
                  </div>
                )}

                {canReply && selected.status === 'requested' && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      onClick={() => void acceptThread(selected.id)}
                      disabled={isBusy}
                      className="flex-1 min-h-[44px]"
                      data-testid="conversation-accept"
                    >
                      Accept
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void declineThread(selected.id)}
                      disabled={isBusy}
                      className="flex-1 min-h-[44px]"
                      data-testid="conversation-decline"
                    >
                      Decline
                    </Button>
                  </div>
                )}

                {canReply && selected.status === 'active' && (
                  <div className="space-y-2" data-testid="conversation-composer">
                    <Textarea
                      aria-label="Reply to driver"
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      rows={3}
                      maxLength={4000}
                      placeholder="Write a reply…"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        onClick={() => void handleReply()}
                        disabled={isBusy || reply.trim().length === 0}
                        className="flex-1 min-h-[44px]"
                        data-testid="conversation-send"
                      >
                        Send Reply
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void closeThread(selected.id)}
                        disabled={isBusy}
                        className="flex-1 min-h-[44px]"
                        data-testid="conversation-close"
                      >
                        Close
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
