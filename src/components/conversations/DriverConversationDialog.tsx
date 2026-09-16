/**
 * Phase CF-1B — driver conversation surface for a single opportunity.
 *
 * Mounted only from the OpportunityDetail sticky decision bar. All writes go
 * through CF-1A RPCs via `useConversations`. The peer is labeled neutrally as
 * "Recruiter" — no profile, auth.users, or driver-profile lookup exists here.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, MessageSquare, Send } from 'lucide-react';
import {
  useDriverOpportunityConversation,
  type ConversationMessage,
} from '@/hooks/conversations/useConversations';

const DEFAULT_INITIAL_MESSAGE =
  "Hi, I'm interested in this opportunity and would like to speak with a recruiter.";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunityId: string;
  opportunityTitle: string;
  companyName?: string | null;
}

function MessageRow({ message }: { message: ConversationMessage }) {
  // Actor is server-derived on insert; the client never supplies it.
  const mine = message.sender_actor_type === 'driver';
  return (
    <div
      className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
      data-testid="conversation-message"
      data-actor={message.sender_actor_type}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 ${
          mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
        }`}
      >
        <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">
          {mine ? 'You' : 'Recruiter'}
        </p>
        <p className="text-sm whitespace-pre-line break-words">{message.body}</p>
      </div>
    </div>
  );
}

export function DriverConversationDialog({
  open,
  onOpenChange,
  opportunityId,
  opportunityTitle,
  companyName,
}: Props) {
  const {
    thread,
    messages,
    isLoading,
    isBusy,
    error,
    startConversation,
    sendMessage,
    closeConversation,
  } = useDriverOpportunityConversation(opportunityId, open);

  const [draft, setDraft] = useState(DEFAULT_INITIAL_MESSAGE);
  const [reply, setReply] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft(DEFAULT_INITIAL_MESSAGE);
      setReply('');
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [thread?.id, messages.length]);

  const statusLabel = useMemo(() => {
    if (!thread) return null;
    if (thread.status === 'requested') return 'Waiting for recruiter';
    if (thread.status === 'active') return 'Connected';
    return null;
  }, [thread]);

  const handleStart = async () => {
    try {
      await startConversation(draft);
    } catch {
      /* error surfaced through hook state */
    }
  };

  const handleSend = async () => {
    try {
      await sendMessage(reply);
      setReply('');
    } catch {
      /* error surfaced through hook state */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="driver-conversation-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-primary" aria-hidden />
            Driver conversation
          </DialogTitle>
          <DialogDescription className="break-words">
            {opportunityTitle}
            {companyName ? ` · ${companyName}` : ''}
          </DialogDescription>
        </DialogHeader>

        {statusLabel && (
          <Badge variant="outline" className="w-fit" data-testid="conversation-status">
            {statusLabel}
          </Badge>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive break-words">
            {error}
          </p>
        )}

        {isLoading && !thread ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" />
          </div>
        ) : !thread ? (
          <div className="space-y-3">
            <label htmlFor="cf1b-initial-message" className="text-sm font-semibold text-foreground">
              Your message
            </label>
            <Textarea
              id="cf1b-initial-message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              maxLength={4000}
            />
            <Button
              onClick={handleStart}
              disabled={isBusy || draft.trim().length === 0}
              className="w-full min-h-[44px]"
            >
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Start Conversation
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div
              className="max-h-[42vh] space-y-2 overflow-y-auto pr-1"
              data-testid="conversation-message-list"
            >
              {messages.map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
              <div ref={bottomRef} />
            </div>

            <Textarea
              aria-label="Message the recruiter"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Write a message…"
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={handleSend}
                disabled={isBusy || reply.trim().length === 0}
                className="flex-1 min-h-[44px]"
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send
              </Button>
              <Button
                variant="outline"
                onClick={() => void closeConversation()}
                disabled={isBusy}
                className="flex-1 min-h-[44px]"
              >
                Close Conversation
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
