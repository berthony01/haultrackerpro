import { createContext, useContext, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useActingContext } from '@/hooks/useActingContext';
import {
  assistantApi, type AssistantContext, type AssistantMessage, type AssistantThread, type Cursor,
} from '@/lib/assistant/api';

/**
 * AI assistant app-memory store. Holds the current thread, transcript page and
 * unsent draft for the CURRENT identity only, in memory (no browser storage).
 * Identity = user id + JWT session_id (validated cache-isolation hint, never
 * authorization) + pinned managed target. Every async completion is guarded by
 * an identity epoch, a view epoch (context/thread) and a history epoch
 * (delete/clear), so stale results never appear (A to B to A included).
 * Context choices are hints; the server reauthorizes everything.
 */

export type AvailabilityState = 'idle' | 'loading' | 'ready' | 'unavailable';
export type Notice = null | 'limit' | 'busy' | 'failed' | 'forbidden' | 'disabled' | 'unavailable' | 'pending'
  | 'delete_failed' | 'clear_failed';
export interface AiAssistantState {
  availability: AvailabilityState;
  generationEnabled: boolean;
  retentionDays: number | null;
  maxChars: number;
  contexts: AssistantContext[];
  contextsNextOffset: number | null;
  contextsLoading: boolean;
  /** Pages searched so far while looking for an explicit managed target. */
  contextsSearchPages: number;
  contextKey: string | null;
  threads: AssistantThread[];
  threadsCursor: Cursor | null;
  threadsLoading: boolean;
  threadId: string | null;
  messages: AssistantMessage[];
  messagesCursor: Cursor | null;
  messagesLoading: boolean;
  /** How the transcript last changed; the page keeps the viewport on 'prepend'. */
  lastChange: 'replace' | 'append' | 'prepend';
  draft: string;
  sending: boolean;
  notice: Notice;
}

const initial = (): AiAssistantState => ({
  availability: 'idle', generationEnabled: false, retentionDays: null, maxChars: 2000, contexts: [],
  contextsNextOffset: null, contextsLoading: false, contextsSearchPages: 0, contextKey: null,
  threads: [], threadsCursor: null, threadsLoading: false, threadId: null, messages: [], messagesCursor: null,
  messagesLoading: false, lastChange: 'replace', draft: '', sending: false, notice: null,
});

export const contextKeyOf = (c: { scope: string; targetId: string }) => `${c.scope}:${c.targetId}`;
/** Max sequential context pages searched for a pinned managed target (50 per page). */
export const MAX_PIN_SEARCH_PAGES = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** JWT session_id as a cache-isolation hint only. Missing/malformed returns null (fail closed). */
export function sessionHintOf(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4)));
    const sid = payload && typeof payload === 'object' ? (payload as { session_id?: unknown }).session_id : null;
    return typeof sid === 'string' && UUID.test(sid) ? sid.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** RFC 4122 v4 request id. crypto.randomUUID, else crypto.getRandomValues; otherwise throws (fail closed). */
export function newRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (!c || typeof c.getRandomValues !== 'function') throw new Error('no secure random source');
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface AiAssistantApi {
  state: AiAssistantState;
  /** Explicit managed target when acting for a driver; UI pins to it. */
  pinnedDriverId: string | null;
  identityReady: boolean;
  currentContext: AssistantContext | null;
  visibleThreads: AssistantThread[];
  ensureLoaded(): void;
  loadMoreContexts(): void;
  selectContext(key: string): void;
  newConversation(): void;
  openThread(id: string): void;
  loadOlderMessages(): void;
  loadMoreThreads(): void;
  setDraft(text: string): void;
  send(text?: string): Promise<void>;
  deleteThread(id: string): Promise<boolean>;
  clearHistory(): Promise<boolean>;
}

const Ctx = createContext<AiAssistantApi | null>(null);

function noticeFor(code: string, status: number): Notice {
  if (status === 429) return code === 'busy' ? 'busy' : 'limit';
  if (code === 'disabled') return 'disabled';
  if (status === 403 || status === 401) return 'forbidden';
  if (code === 'failed') return 'failed';
  return 'unavailable';
}

export function AiAssistantProvider({ children }: { children: ReactNode }) {
  const { user, session, loading } = useAuth();
  const { actingDriver, isActingAsAssistant, isLoadingManagedDrivers } = useActingContext();
  const sessionHint = sessionHintOf(session?.access_token);
  // Acting but target unresolved: fail closed, never fall back to personal contexts.
  const actingResolved = !isActingAsAssistant || !!actingDriver?.driver_user_id;
  const valid = !loading && !!user?.id && !!session?.user?.id && session.user.id === user.id
    && !isLoadingManagedDrivers && !!sessionHint && actingResolved;
  const pinnedDriverId = valid && isActingAsAssistant ? actingDriver?.driver_user_id ?? null : null;
  const identity = valid ? `${user!.id}|${sessionHint}|${pinnedDriverId ?? 'self'}` : null;

  const [, bump] = useReducer((x: number) => x + 1, 0);
  const stateRef = useRef<AiAssistantState>(initial());
  const identityRef = useRef<string | null>(identity);
  const epochRef = useRef(0); // identity epoch
  const viewRef = useRef(0); // context/thread epoch within identity
  const historyRef = useRef(0); // delete/clear epoch within identity

  // Synchronous fail-closed reset during render (refs only).
  if (identityRef.current !== identity) {
    identityRef.current = identity;
    epochRef.current += 1; viewRef.current += 1; historyRef.current += 1;
    stateRef.current = initial();
  }

  const api = useMemo<Omit<AiAssistantApi, 'state' | 'pinnedDriverId' | 'identityReady' | 'currentContext' | 'visibleThreads'>>(() => {
    const token = () => ({ epoch: epochRef.current, view: viewRef.current, history: historyRef.current });
    type Tok = ReturnType<typeof token>;
    const live = (t: Tok) => t.epoch === epochRef.current && identityRef.current !== null;
    const liveView = (t: Tok) => live(t) && t.view === viewRef.current;
    const liveHistory = (t: Tok) => live(t) && t.history === historyRef.current;
    const patch = (p: Partial<AiAssistantState>) => { stateRef.current = { ...stateRef.current, ...p }; bump(); };
    const s = () => stateRef.current;
    const pinned = () => { const part = identityRef.current?.split('|')[2]; return part && part !== 'self' ? part : null; };
    const threadAllowed = (th: AssistantThread) => { const p = pinned(); return p ? th.scope === 'driver_delegate' && th.targetId === p : true; };
    // Leaving the current view: drop draft, flags and pending completions for it.
    const resetView = (p: Partial<AiAssistantState>) => {
      viewRef.current += 1;
      patch({ threadId: null, messages: [], messagesCursor: null, messagesLoading: false, lastChange: 'replace', notice: null, sending: false, draft: '', ...p });
    };

    const loadThreads = async (more: boolean) => {
      const t = token(); if (!live(t) || s().threadsLoading) return;
      patch({ threadsLoading: true });
      const r = await assistantApi.threads(more ? s().threadsCursor : null);
      if (!liveHistory(t)) return;
      if (!r.ok) { patch({ threadsLoading: false }); return; }
      patch({ threadsLoading: false, threads: more ? [...s().threads, ...r.data.threads] : r.data.threads, threadsCursor: r.data.nextCursor });
    };
    const loadMessages = async (threadId: string, older: boolean) => {
      const t = token(); if (!live(t)) return;
      if (older && s().messagesLoading) return; // no duplicate concurrent older fetch
      patch({ messagesLoading: true });
      const r = await assistantApi.messages(threadId, older ? s().messagesCursor : null);
      if (!liveView(t) || s().threadId !== threadId) return;
      if (!r.ok) { patch({ messagesLoading: false, notice: noticeFor(r.code, r.status) }); return; }
      const page = [...r.data.messages].reverse();
      patch({
        messagesLoading: false, messages: older ? [...page, ...s().messages] : page, messagesCursor: r.data.nextCursor,
        lastChange: older ? 'prepend' : 'replace',
      });
    };

    return {
      ensureLoaded() {
        const t = token();
        if (!live(t) || s().availability !== 'idle') return;
        patch({ availability: 'loading', contextsSearchPages: 0 });
        void (async () => {
          const p = pinned();
          let r = await assistantApi.bootstrap();
          if (!live(t)) return;
          if (!r.ok || !r.data || r.data.available !== true) { patch({ availability: 'unavailable' }); return; }
          const first = r.data;
          let contexts: AssistantContext[];
          let nextOffset: number | null = typeof first.nextOffset === 'number' ? first.nextOffset : null;
          if (p) {
            // Bounded sequential discovery of the explicit managed target only. Personal and
            // other contexts are never shown while acting.
            let found = (first.contexts ?? []).find((c) => c.scope === 'driver_delegate' && c.targetId === p) ?? null;
            let pages = 1;
            patch({ contextsSearchPages: pages });
            while (!found && nextOffset !== null && pages < MAX_PIN_SEARCH_PAGES) {
              r = await assistantApi.bootstrap(nextOffset);
              if (!live(t)) return;
              if (!r.ok || !r.data || r.data.available !== true) { patch({ availability: 'unavailable' }); return; }
              pages += 1; patch({ contextsSearchPages: pages });
              found = (r.data.contexts ?? []).find((c) => c.scope === 'driver_delegate' && c.targetId === p) ?? null;
              nextOffset = typeof r.data.nextOffset === 'number' ? r.data.nextOffset : null;
            }
            contexts = found ? [found] : [];
            nextOffset = null;
          } else {
            contexts = first.contexts ?? [];
          }
          patch({
            availability: 'ready', generationEnabled: first.generationEnabled === true,
            retentionDays: first.retentionDays === 30 ? 30 : null, maxChars: first.limits?.maxChars ?? 2000,
            contexts, contextsNextOffset: nextOffset,
            contextKey: s().contextKey ?? (contexts[0] ? contextKeyOf(contexts[0]) : null),
          });
          void loadThreads(false);
        })();
      },
      loadMoreContexts() {
        const t = token(); const off = s().contextsNextOffset;
        if (!live(t) || pinned() || off === null || s().contextsLoading) return;
        patch({ contextsLoading: true });
        void (async () => {
          const r = await assistantApi.bootstrap(off);
          if (!live(t)) return;
          if (!r.ok || !r.data || r.data.available !== true) { patch({ contextsLoading: false, notice: 'unavailable' }); return; }
          const seen = new Set(s().contexts.map(contextKeyOf));
          const add = (r.data.contexts ?? []).filter((c) => !seen.has(contextKeyOf(c)));
          patch({ contextsLoading: false, contexts: [...s().contexts, ...add], contextsNextOffset: typeof r.data.nextOffset === 'number' ? r.data.nextOffset : null });
        })();
      },
      selectContext(key) {
        if (!s().contexts.some((c) => contextKeyOf(c) === key) || key === s().contextKey) return;
        resetView({ contextKey: key });
      },
      newConversation() { resetView({}); },
      openThread(id) {
        const th = s().threads.find((x) => x.id === id);
        if (!th || !threadAllowed(th)) return;
        const key = contextKeyOf(th);
        if (!s().contexts.some((c) => contextKeyOf(c) === key)) return;
        if (id === s().threadId) return;
        resetView({ threadId: id, contextKey: key });
        void loadMessages(id, false);
      },
      loadOlderMessages() { const id = s().threadId; if (id && s().messagesCursor && !s().messagesLoading) void loadMessages(id, true); },
      loadMoreThreads() { if (s().threadsCursor) void loadThreads(true); },
      setDraft(text) { if (identityRef.current) patch({ draft: text }); },
      async send(text) {
        const content = (text ?? s().draft).trim();
        const ctx = s().contexts.find((c) => contextKeyOf(c) === s().contextKey);
        if (!content || content.length > s().maxChars || !ctx || s().sending || !s().generationEnabled) return;
        let requestId: string;
        try { requestId = newRequestId(); } catch { patch({ notice: 'unavailable' }); return; }
        const t = token();
        const threadId = s().threadId;
        const optimistic: AssistantMessage = { id: `local-${requestId}`, role: 'user', content, createdAt: new Date().toISOString(), sources: [] };
        patch({ sending: true, notice: null, draft: '', messages: [...s().messages, optimistic], lastChange: 'append' });
        const r = await assistantApi.send(threadId ? { requestId, content, threadId } : { requestId, content, scope: ctx.scope, targetId: ctx.targetId });
        if (!liveView(t)) return;
        if (!r.ok) {
          patch({ sending: false, notice: noticeFor(r.code, r.status), draft: content, messages: s().messages.filter((m) => m.id !== optimistic.id), lastChange: 'append' });
          return;
        }
        if (r.data.pending || !r.data.reply) { patch({ sending: false, notice: 'pending', threadId: r.data.threadId }); return; }
        const isNew = !threadId;
        patch({ sending: false, threadId: r.data.threadId, messages: [...s().messages, r.data.reply], lastChange: 'append' });
        if (isNew) void loadThreads(false);
      },
      async deleteThread(id) {
        const t = token(); if (!live(t)) return false;
        const r = await assistantApi.deleteThread(id);
        if (!live(t)) return false;
        if (!r.ok || r.data?.deleted !== true) { patch({ notice: 'delete_failed' }); return false; }
        historyRef.current += 1; // in-flight list loads must not re-add it
        const threads = s().threads.filter((x) => x.id !== id);
        // Only the conversation currently open for that thread is reset; another open
        // or new conversation the user moved to is left untouched.
        if (s().threadId === id) resetView({ threads, threadsLoading: false });
        else patch({ threads, threadsLoading: false });
        return true;
      },
      async clearHistory() {
        const t = token(); if (!live(t)) return false;
        const r = await assistantApi.clear();
        if (!live(t)) return false;
        if (!r.ok) { patch({ notice: 'clear_failed' }); return false; }
        historyRef.current += 1;
        resetView({ threads: [], threadsCursor: null, threadsLoading: false });
        return true;
      },
    };
    // Stable across renders; identity guarded via refs.
  }, []);

  const state = stateRef.current;
  const currentContext = state.contexts.find((c) => contextKeyOf(c) === state.contextKey) ?? null;
  const visibleThreads = state.threads.filter((t) =>
    (pinnedDriverId ? t.scope === 'driver_delegate' && t.targetId === pinnedDriverId : true)
    && state.contexts.some((c) => contextKeyOf(c) === contextKeyOf(t)));
  const value: AiAssistantApi = { ...api, state, pinnedDriverId, identityReady: valid, currentContext, visibleThreads };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAiAssistant(): AiAssistantApi | null {
  return useContext(Ctx);
}
