/**
 * Phase CF-1B — web conversation MVP data layer.
 *
 * Reads come from `conversation_threads` / `conversation_messages` under the
 * CF-1A RLS SELECT policies. EVERY mutation goes through a CF-1A SECURITY
 * DEFINER RPC — this module never inserts, updates, or deletes a conversation
 * row directly, and never sends an actor identity, recruiter id, or driver id
 * as client input. Client state is UX only; the database is authoritative.
 *
 * No admin check, no profile / auth.users / driver_opportunity_profiles read,
 * no application, contact-request, offer, contract, referral, settlement,
 * billing, or Telegram coupling.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables } from '@/integrations/supabase/types';

export type ConversationThread = Tables<'conversation_threads'>;
export type ConversationMessage = Tables<'conversation_messages'>;

/** Threads surfaced by CF-1B. Terminal threads are out of scope. */
export const CF1B_OPEN_STATUSES = ['requested', 'active'] as const;

/** Modest refresh cadence while a conversation surface is open. */
export const CONVERSATION_POLL_MS = 5000;

/** Browser-compatible client message id. Idempotency key only. */
export function newClientMessageId(): string {
  const c: Crypto | undefined =
    typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Deterministic-shape fallback for environments without randomUUID.
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Concise, non-leaking user-facing message. Server text is never surfaced raw. */
function friendlyError(fallback: string): Error {
  return new Error(fallback);
}

// Narrow local RPC adapter — generated types are not edited by this phase.
type ConversationRpc = (
  fn:
    | 'start_opportunity_conversation'
    | 'accept_conversation_thread'
    | 'decline_conversation_thread'
    | 'conversation_post_message'
    | 'close_conversation_thread',
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

const callConversationRpc = supabase.rpc.bind(supabase) as unknown as ConversationRpc;

async function rpc(
  fn: Parameters<ConversationRpc>[0],
  args: Record<string, unknown>,
  failureMessage: string,
): Promise<unknown> {
  let resp: { data: unknown; error: unknown };
  try {
    resp = await callConversationRpc(fn, args);
  } catch {
    throw friendlyError(failureMessage);
  }
  if (resp.error) throw friendlyError(failureMessage);
  return resp.data;
}

function trimmedBodyOrThrow(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 4000) {
    throw friendlyError('Enter a message between 1 and 4000 characters.');
  }
  return trimmed;
}

/** Polls `tick` on a modest interval while `active`; always clears on unmount. */
function usePoll(active: boolean, tick: () => void) {
  const ref = useRef(tick);
  ref.current = tick;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => ref.current(), CONVERSATION_POLL_MS);
    return () => clearInterval(id);
  }, [active]);
}

async function fetchMessages(threadId: string): Promise<ConversationMessage[]> {
  const { data, error } = await supabase
    .from('conversation_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (error) throw friendlyError('Unable to load messages.');
  return (data ?? []) as ConversationMessage[];
}

/* ------------------------------ driver side ------------------------------ */

export interface DriverConversationState {
  thread: ConversationThread | null;
  messages: ConversationMessage[];
  isLoading: boolean;
  isBusy: boolean;
  error: string | null;
  refetch: () => void;
  startConversation: (body: string) => Promise<void>;
  sendMessage: (body: string) => Promise<void>;
  closeConversation: () => Promise<void>;
}

/**
 * Driver's own open conversation for one opportunity. Scoped to the
 * authenticated driver AND enforced again by CF-1A RLS.
 */
export function useDriverOpportunityConversation(
  opportunityId: string | null | undefined,
  enabled: boolean,
): DriverConversationState {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const active = !!enabled && !!opportunityId && !!userId;

  const [thread, setThread] = useState<ConversationThread | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  const generationRef = useRef(0);

  const refetch = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;

    if (!active) {
      setThread(null);
      setMessages([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    void (async () => {
      try {
        const { data, error: threadError } = await supabase
          .from('conversation_threads')
          .select('*')
          .eq('opportunity_id', opportunityId as string)
          .eq('driver_user_id', userId as string)
          .in('status', [...CF1B_OPEN_STATUSES])
          .order('updated_at', { ascending: false })
          .limit(1);
        if (threadError) throw friendlyError('Unable to load this conversation.');
        const found = ((data ?? []) as ConversationThread[])[0] ?? null;
        const list = found ? await fetchMessages(found.id) : [];
        if (generation !== generationRef.current) return;
        setThread(found);
        setMessages(list);
        setError(null);
      } catch (e) {
        if (generation !== generationRef.current) return;
        setThread(null);
        setMessages([]);
        setError(e instanceof Error ? e.message : 'Unable to load this conversation.');
      } finally {
        if (generation === generationRef.current) setIsLoading(false);
      }
    })();
  }, [active, opportunityId, userId, token]);

  usePoll(active, refetch);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setIsBusy(true);
      setError(null);
      try {
        await fn();
        refetch();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        throw e;
      } finally {
        setIsBusy(false);
      }
    },
    [refetch],
  );

  const startConversation = useCallback(
    (body: string) =>
      run(async () => {
        if (!opportunityId) throw friendlyError('Opportunity unavailable.');
        await rpc(
          'start_opportunity_conversation',
          {
            _opportunity_id: opportunityId,
            _initial_message: trimmedBodyOrThrow(body),
            _client_message_id: newClientMessageId(),
          },
          'Unable to start this conversation.',
        );
      }),
    [opportunityId, run],
  );

  const sendMessage = useCallback(
    (body: string) =>
      run(async () => {
        if (!thread) throw friendlyError('Conversation unavailable.');
        await rpc(
          'conversation_post_message',
          {
            _thread_id: thread.id,
            _body: trimmedBodyOrThrow(body),
            _client_message_id: newClientMessageId(),
          },
          'Unable to send this message.',
        );
      }),
    [thread, run],
  );

  const closeConversation = useCallback(
    () =>
      run(async () => {
        if (!thread) throw friendlyError('Conversation unavailable.');
        await rpc(
          'close_conversation_thread',
          { _thread_id: thread.id },
          'Unable to close this conversation.',
        );
      }),
    [thread, run],
  );

  return {
    thread,
    messages,
    isLoading,
    isBusy,
    error,
    refetch,
    startConversation,
    sendMessage,
    closeConversation,
  };
}

/* ----------------------------- recruiter side ---------------------------- */

export interface RecruiterConversationListState {
  threads: ConversationThread[];
  requestedCount: number;
  opportunityTitles: Record<string, string>;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Requested/active threads for one recruiter workspace. Read access is
 * governed entirely by the CF-1A SELECT policy; `enabled` is UX gating only.
 */
export function useRecruiterConversationThreads(
  recruiterId: string | null | undefined,
  enabled: boolean,
): RecruiterConversationListState {
  const active = !!enabled && !!recruiterId;
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [opportunityTitles, setOpportunityTitles] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  const generationRef = useRef(0);

  const refetch = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;

    if (!active) {
      setThreads([]);
      setOpportunityTitles({});
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    void (async () => {
      try {
        const { data, error: listError } = await supabase
          .from('conversation_threads')
          .select('*')
          .eq('recruiter_id', recruiterId as string)
          .in('status', [...CF1B_OPEN_STATUSES])
          .order('updated_at', { ascending: false });
        if (listError) throw friendlyError('Unable to load conversations.');
        const rows = (data ?? []) as ConversationThread[];

        // Opportunity titles only — already readable context, no driver data.
        const ids = Array.from(
          new Set(rows.map((r) => r.opportunity_id).filter((v): v is string => !!v)),
        );
        let titles: Record<string, string> = {};
        if (ids.length > 0) {
          const { data: opps } = await supabase
            .from('opportunities')
            .select('id, title')
            .in('id', ids);
          titles = Object.fromEntries(
            ((opps ?? []) as { id: string; title: string | null }[]).map((o) => [
              o.id,
              o.title ?? 'Opportunity',
            ]),
          );
        }
        if (generation !== generationRef.current) return;
        setThreads(rows);
        setOpportunityTitles(titles);
        setError(null);
      } catch (e) {
        if (generation !== generationRef.current) return;
        setThreads([]);
        setOpportunityTitles({});
        setError(e instanceof Error ? e.message : 'Unable to load conversations.');
      } finally {
        if (generation === generationRef.current) setIsLoading(false);
      }
    })();
  }, [active, recruiterId, token]);

  usePoll(active, refetch);

  const requestedCount = useMemo(
    () => threads.filter((t) => t.status === 'requested').length,
    [threads],
  );

  return { threads, requestedCount, opportunityTitles, isLoading, error, refetch };
}

export interface ConversationThreadMessagesState {
  messages: ConversationMessage[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useConversationMessages(
  threadId: string | null | undefined,
  enabled: boolean,
): ConversationThreadMessagesState {
  const active = !!enabled && !!threadId;
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  const generationRef = useRef(0);

  const refetch = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;

    if (!active) {
      setMessages([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    void (async () => {
      try {
        const list = await fetchMessages(threadId as string);
        if (generation !== generationRef.current) return;
        setMessages(list);
        setError(null);
      } catch (e) {
        if (generation !== generationRef.current) return;
        setMessages([]);
        setError(e instanceof Error ? e.message : 'Unable to load messages.');
      } finally {
        if (generation === generationRef.current) setIsLoading(false);
      }
    })();
  }, [active, threadId, token]);

  usePoll(active, refetch);

  return { messages, isLoading, error, refetch };
}

export interface RecruiterConversationActions {
  isBusy: boolean;
  actionError: string | null;
  acceptThread: (threadId: string) => Promise<void>;
  declineThread: (threadId: string) => Promise<void>;
  replyToThread: (threadId: string, body: string) => Promise<void>;
  closeThread: (threadId: string) => Promise<void>;
}

/** Recruiter mutations — RPC only. Authority is re-resolved server-side. */
export function useRecruiterConversationActions(
  onChanged: () => void,
): RecruiterConversationActions {
  const [isBusy, setIsBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  const run = useCallback(async (fn: () => Promise<void>) => {
    setIsBusy(true);
    setActionError(null);
    try {
      await fn();
      changedRef.current();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setIsBusy(false);
    }
  }, []);

  const acceptThread = useCallback(
    (threadId: string) =>
      run(() =>
        rpc(
          'accept_conversation_thread',
          { _thread_id: threadId },
          'Unable to accept this conversation.',
        ).then(() => undefined),
      ),
    [run],
  );

  const declineThread = useCallback(
    (threadId: string) =>
      run(() =>
        rpc(
          'decline_conversation_thread',
          { _thread_id: threadId },
          'Unable to decline this conversation.',
        ).then(() => undefined),
      ),
    [run],
  );

  const replyToThread = useCallback(
    (threadId: string, body: string) =>
      run(async () => {
        await rpc(
          'conversation_post_message',
          {
            _thread_id: threadId,
            _body: trimmedBodyOrThrow(body),
            _client_message_id: newClientMessageId(),
          },
          'Unable to send this message.',
        );
      }),
    [run],
  );

  const closeThread = useCallback(
    (threadId: string) =>
      run(() =>
        rpc(
          'close_conversation_thread',
          { _thread_id: threadId },
          'Unable to close this conversation.',
        ).then(() => undefined),
      ),
    [run],
  );

  return { isBusy, actionError, acceptThread, declineThread, replyToThread, closeThread };
}
