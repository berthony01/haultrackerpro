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
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { validThreadId } from '@/lib/conversations/conversationNavigation';
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
  existingThreadId?: string | null,
): DriverConversationState {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const exactMode = existingThreadId !== undefined;
  const active = !!enabled && !!userId && (exactMode ? validThreadId(existingThreadId) : !!opportunityId);
  const scope = JSON.stringify([userId, opportunityId, enabled, existingThreadId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => () => { currentScope.current = ''; }, []);
  const [snapshot, setSnapshot] = useState<{ scope: string; thread: ConversationThread | null; messages: ConversationMessage[]; error: string | null }>({ scope: '', thread: null, messages: [], error: null });
  const [loadingScope, setLoadingScope] = useState<string | null>(null);
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  const refetch = useCallback(() => setToken(t => t + 1), []);
  const visible = active && snapshot.scope === scope;
  const thread = visible ? snapshot.thread : null;

  useEffect(() => {
    let cancelled = false;
    if (!active || !userId) return;
    setLoadingScope(scope);
    void (async () => {
      try {
        let query = supabase.from('conversation_threads').select('*').eq('driver_user_id', userId);
        if (exactMode && existingThreadId) query = query.eq('id', existingThreadId);
        else query = query.eq('opportunity_id', opportunityId as string).in('status', [...CF1B_OPEN_STATUSES]);
        const { data, error } = await query.order('updated_at', { ascending: false }).limit(1);
        if (cancelled || currentScope.current !== scope) return;
        if (error) throw friendlyError('Unable to load this conversation.');
        const found = ((data ?? []) as ConversationThread[]).find(t => t.driver_user_id === userId &&
          (exactMode ? t.id === existingThreadId : t.opportunity_id === opportunityId)) ?? null;
        const messages = found ? await fetchMessages(found.id) : [];
        if (!cancelled && currentScope.current === scope) setSnapshot({ scope, thread: found, messages, error: null });
      } catch {
        if (!cancelled && currentScope.current === scope) setSnapshot({ scope, thread: null, messages: [], error: 'Unable to load this conversation.' });
      } finally {
        if (!cancelled && currentScope.current === scope) setLoadingScope(null);
      }
    })();
    return () => { cancelled = true; };
  }, [scope, active, userId, exactMode, existingThreadId, opportunityId, token]);
  usePoll(active, refetch);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    if (!active || currentScope.current !== scope) return;
    setBusyScope(scope);
    try {
      await action();
      if (currentScope.current === scope) refetch();
    } catch (e) {
      if (currentScope.current === scope) setSnapshot(previous => ({ ...previous, scope, error: e instanceof Error ? e.message : 'Conversation unavailable.' }));
      throw e;
    } finally {
      if (currentScope.current === scope) setBusyScope(null);
    }
  }, [active, scope, refetch]);
  const startConversation = useCallback((body: string) => run(async () => {
    if (exactMode || !opportunityId || thread) throw friendlyError('Conversation unavailable.');
    return rpc('start_opportunity_conversation', { _opportunity_id: opportunityId, _initial_message: trimmedBodyOrThrow(body), _client_message_id: newClientMessageId() }, 'Unable to start this conversation.');
  }), [run, exactMode, opportunityId, thread]);
  const sendMessage = useCallback((body: string) => run(async () => {
    if (!thread || !CF1B_OPEN_STATUSES.includes(thread.status as 'requested' | 'active')) throw friendlyError('Conversation unavailable.');
    return rpc('conversation_post_message', { _thread_id: thread.id, _body: trimmedBodyOrThrow(body), _client_message_id: newClientMessageId() }, 'Unable to send this message.');
  }), [run, thread]);
  const closeConversation = useCallback(() => run(async () => {
    if (!thread || !CF1B_OPEN_STATUSES.includes(thread.status as 'requested' | 'active')) throw friendlyError('Conversation unavailable.');
    return rpc('close_conversation_thread', { _thread_id: thread.id }, 'Unable to close this conversation.');
  }), [run, thread]);
  return { thread, messages: visible ? snapshot.messages : [], error: visible ? snapshot.error : null,
    isLoading: active && (!visible || loadingScope === scope), isBusy: busyScope === scope,
    refetch, startConversation, sendMessage, closeConversation };
}

export interface RecruiterConversationListState {
  threads: ConversationThread[];
  requestedCount: number;
  opportunityTitles: Record<string, string>;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/** Identity-bound reads; the filter narrows RLS, never replaces it. */
function useScopedConversationThreads(recruiterId: string | null | undefined, enabled: boolean, includeHistory: boolean, driver: boolean): RecruiterConversationListState {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const active = !!enabled && !!userId && (driver || !!recruiterId);
  const scope = JSON.stringify([userId, recruiterId, enabled, includeHistory, driver]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => () => { currentScope.current = ''; }, []);
  const [snapshot, setSnapshot] = useState<{ scope: string; threads: ConversationThread[]; opportunityTitles: Record<string, string>; error: string | null }>({ scope: '', threads: [], opportunityTitles: {}, error: null });
  const [loadingScope, setLoadingScope] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  const refetch = useCallback(() => setToken(t => t + 1), []);
  useEffect(() => {
    let cancelled = false;
    if (!active || !userId) return;
    setLoadingScope(scope);
    void (async () => {
      try {
        let query = supabase.from('conversation_threads').select('*');
        query = driver ? query.eq('driver_user_id', userId) : query.eq('recruiter_id', recruiterId as string);
        if (!includeHistory) query = query.in('status', [...CF1B_OPEN_STATUSES]);
        const { data, error } = await query.order('updated_at', { ascending: false });
        if (cancelled || currentScope.current !== scope) return;
        if (error) throw friendlyError('Unable to load conversations.');
        const threads = ((data ?? []) as ConversationThread[]).filter(t => driver ? t.driver_user_id === userId : t.recruiter_id === recruiterId);
        const ids = Array.from(new Set(threads.map(t => t.opportunity_id).filter((id): id is string => !!id)));
        let opportunityTitles: Record<string, string> = {};
        if (ids.length) {
          const { data: opportunities } = await supabase.from('opportunities').select('id, title').in('id', ids);
          opportunityTitles = Object.fromEntries((opportunities ?? []).map(o => [o.id, o.title ?? 'Opportunity']));
        }
        if (!cancelled && currentScope.current === scope) setSnapshot({ scope, threads, opportunityTitles, error: null });
      } catch {
        if (!cancelled && currentScope.current === scope) setSnapshot({ scope, threads: [], opportunityTitles: {}, error: 'Unable to load conversations.' });
      } finally {
        if (!cancelled && currentScope.current === scope) setLoadingScope(null);
      }
    })();
    return () => { cancelled = true; };
  }, [scope, active, userId, recruiterId, includeHistory, driver, token]);
  usePoll(active, refetch);
  const visible = active && snapshot.scope === scope;
  const threads = visible ? snapshot.threads : [];
  return { threads, requestedCount: threads.filter(t => t.status === 'requested').length,
    opportunityTitles: visible ? snapshot.opportunityTitles : {}, error: visible ? snapshot.error : null,
    isLoading: active && (!visible || loadingScope === scope), refetch };
}

export function useDriverConversationThreads(enabled: boolean) {
  return useScopedConversationThreads(null, enabled, true, true);
}

export function useRecruiterConversationThreads(recruiterId: string | null | undefined, enabled: boolean, includeHistory = false) {
  return useScopedConversationThreads(recruiterId, enabled, includeHistory, false);
}

export interface ConversationThreadMessagesState {
  messages: ConversationMessage[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/** Caller must select from its currently validated, scoped thread list first. */
export function useConversationMessages(threadId: string | null | undefined, enabled: boolean): ConversationThreadMessagesState {
  const { user } = useAuth();
  const active = !!enabled && !!threadId && !!user?.id;
  const scope = JSON.stringify([user?.id, threadId, enabled]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => () => { currentScope.current = ''; }, []);
  const [snapshot, setSnapshot] = useState<{ scope: string; messages: ConversationMessage[]; error: string | null }>({ scope: '', messages: [], error: null });
  const [loadingScope, setLoadingScope] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  const refetch = useCallback(() => setToken(t => t + 1), []);
  useEffect(() => {
    let cancelled = false;
    if (!active || !threadId) return;
    setLoadingScope(scope);
    void (async () => {
      try {
        const messages = await fetchMessages(threadId);
        if (!cancelled && currentScope.current === scope) setSnapshot({ scope, messages, error: null });
      } catch {
        if (!cancelled && currentScope.current === scope) setSnapshot({ scope, messages: [], error: 'Unable to load messages.' });
      } finally {
        if (!cancelled && currentScope.current === scope) setLoadingScope(null);
      }
    })();
    return () => { cancelled = true; };
  }, [scope, active, threadId, token]);
  usePoll(active, refetch);
  const visible = active && snapshot.scope === scope;
  return { messages: visible ? snapshot.messages : [], error: visible ? snapshot.error : null,
    isLoading: active && (!visible || loadingScope === scope), refetch };
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
  surfaceKey = '',
): RecruiterConversationActions {
  const { user } = useAuth();
  const scope = JSON.stringify([user?.id, surfaceKey]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => () => { currentScope.current = ''; }, []);
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{ scope: string; message: string } | null>(null);
  const isBusy = busyScope === scope;
  const actionError = errorState?.scope === scope ? errorState.message : null;
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  const run = useCallback(async (fn: () => Promise<void>) => {
    if (currentScope.current !== scope) return;
    setBusyScope(scope);
    setErrorState(null);
    try {
      await fn();
      if (currentScope.current === scope) changedRef.current();
    } catch (e) {
      if (currentScope.current === scope) setErrorState({ scope, message: e instanceof Error ? e.message : 'Something went wrong.' });
    } finally {
      if (currentScope.current === scope) setBusyScope(null);
    }
  }, [scope]);

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
