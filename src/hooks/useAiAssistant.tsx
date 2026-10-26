import { createContext, useCallback, useContext, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useActingContext } from '@/hooks/useActingContext';
import {
  assistantApi, type AssistantContext, type AssistantMessage, type AssistantThread, type Cursor,
} from '@/lib/assistant/api';

/**
 * AI assistant app-memory store. Holds the current thread, transcript page and
 * unsent draft for the CURRENT identity only, in memory (no browser storage).
 * Every async completion is guarded by an epoch that changes on identity,
 * session, acting-context, context or thread change, so stale results never
 * appear (A→B→A included). Context choices are hints; the server reauthorizes.
 */

export type AvailabilityState = 'idle' | 'loading' | 'ready' | 'unavailable';
export interface AiAssistantState {
  availability: AvailabilityState;
  generationEnabled: boolean;
  retentionDays: number | null;
  maxChars: number;
  contexts: AssistantContext[];
  contextKey: string | null;
  threads: AssistantThread[];
  threadsCursor: Cursor | null;
  threadsLoading: boolean;
  threadId: string | null;
  messages: AssistantMessage[];
  messagesCursor: Cursor | null;
  messagesLoading: boolean;
  draft: string;
  sending: boolean;
  notice: null | 'limit' | 'busy' | 'failed' | 'forbidden' | 'disabled' | 'unavailable' | 'pending';
}

const initial = (): AiAssistantState => ({
  availability: 'idle', generationEnabled: false, retentionDays: null, maxChars: 2000, contexts: [], contextKey: null,
  threads: [], threadsCursor: null, threadsLoading: false, threadId: null, messages: [], messagesCursor: null,
  messagesLoading: false, draft: '', sending: false, notice: null,
});

export const contextKeyOf = (c: { scope: string; targetId: string }) => `${c.scope}:${c.targetId}`;

export interface AiAssistantApi {
  state: AiAssistantState;
  /** Explicit managed target when acting for a driver; UI pins to it. */
  pinnedDriverId: string | null;
  identityReady: boolean;
  currentContext: AssistantContext | null;
  visibleThreads: AssistantThread[];
  ensureLoaded(): void;
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

function noticeFor(code: string, status: number): AiAssistantState['notice'] {
  if (status === 429) return code === 'busy' ? 'busy' : 'limit';
  if (code === 'disabled') return 'disabled';
  if (status === 403 || status === 401) return 'forbidden';
  if (code === 'failed') return 'failed';
  return 'unavailable';
}
const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : '00000000-0000-4000-8000-000000000000');

export function AiAssistantProvider({ children }: { children: ReactNode }) {
  const { user, session, loading } = useAuth();
  const { actingDriver, isLoadingManagedDrivers } = useActingContext();
  const valid = !loading && !!user?.id && !!session?.user?.id && session.user.id === user.id && !isLoadingManagedDrivers;
  const pinnedDriverId = valid ? actingDriver?.driver_user_id ?? null : null;
  const identity = valid ? `${user!.id}|${session!.access_token ? 'session' : ''}|${pinnedDriverId ?? 'self'}` : null;
  const userKey = valid ? user!.id : null;

  const [, bump] = useReducer((x: number) => x + 1, 0);
  const stateRef = useRef<AiAssistantState>(initial());
  const identityRef = useRef<string | null>(identity);
  const userKeyRef = useRef<string | null>(userKey);
  const epochRef = useRef(0); // identity epoch
  const viewRef = useRef(0); // context/thread epoch within identity

  // Synchronous fail-closed reset during render (refs only).
  if (identityRef.current !== identity || userKeyRef.current !== userKey) {
    identityRef.current = identity; userKeyRef.current = userKey;
    epochRef.current += 1; viewRef.current += 1;
    stateRef.current = initial();
  }

  const api = useMemo<Omit<AiAssistantApi, 'state' | 'pinnedDriverId' | 'identityReady' | 'currentContext' | 'visibleThreads'>>(() => {
    const token = () => ({ epoch: epochRef.current, view: viewRef.current });
    const live = (t: { epoch: number }) => t.epoch === epochRef.current && identityRef.current !== null;
    const liveView = (t: { epoch: number; view: number }) => live(t) && t.view === viewRef.current;
    const patch = (p: Partial<AiAssistantState>) => { stateRef.current = { ...stateRef.current, ...p }; bump(); };
    const s = () => stateRef.current;
    const pinned = () => { const id = identityRef.current; const part = id?.split('|')[2]; return part && part !== 'self' ? part : null; };
    const allowedContexts = (list: AssistantContext[]) => {
      const p = pinned();
      return p ? list.filter((c) => c.scope === 'driver_delegate' && c.targetId === p) : list;
    };
    const threadAllowed = (t: AssistantThread) => {
      const p = pinned();
      return p ? t.scope === 'driver_delegate' && t.targetId === p : true;
    };

    const loadThreads = async (more: boolean) => {
      const t = token(); if (!live(t) || s().threadsLoading) return;
      patch({ threadsLoading: true });
      const r = await assistantApi.threads(more ? s().threadsCursor : null);
      if (!live(t)) return;
      if (!r.ok) { patch({ threadsLoading: false }); return; }
      patch({ threadsLoading: false, threads: more ? [...s().threads, ...r.data.threads] : r.data.threads, threadsCursor: r.data.nextCursor });
    };
    const loadMessages = async (threadId: string, older: boolean) => {
      const t = token(); if (!live(t)) return;
      patch({ messagesLoading: true });
      const r = await assistantApi.messages(threadId, older ? s().messagesCursor : null);
      if (!liveView(t) || s().threadId !== threadId) return;
      if (!r.ok) { patch({ messagesLoading: false, notice: noticeFor(r.code, r.status) }); return; }
      const page = [...r.data.messages].reverse();
      patch({ messagesLoading: false, messages: older ? [...page, ...s().messages] : page, messagesCursor: r.data.nextCursor });
    };

    return {
      ensureLoaded() {
        const t = token();
        if (!live(t) || s().availability !== 'idle') return;
        patch({ availability: 'loading' });
        void (async () => {
          const r = await assistantApi.bootstrap();
          if (!live(t)) return;
          if (!r.ok || !r.data || r.data.available !== true) { patch({ availability: 'unavailable' }); return; }
          const contexts = allowedContexts(r.data.contexts ?? []);
          patch({
            availability: 'ready', generationEnabled: r.data.generationEnabled === true,
            retentionDays: r.data.retentionDays === 30 ? 30 : null, maxChars: r.data.limits?.maxChars ?? 2000,
            contexts, contextKey: s().contextKey ?? (contexts[0] ? contextKeyOf(contexts[0]) : null),
          });
          void loadThreads(false);
        })();
      },
      selectContext(key) {
        if (!s().contexts.some((c) => contextKeyOf(c) === key) || key === s().contextKey) return;
        viewRef.current += 1;
        patch({ contextKey: key, threadId: null, messages: [], messagesCursor: null, notice: null, sending: false });
      },
      newConversation() {
        viewRef.current += 1;
        patch({ threadId: null, messages: [], messagesCursor: null, notice: null, sending: false });
      },
      openThread(id) {
        const th = s().threads.find((x) => x.id === id);
        if (!th || !threadAllowed(th)) return;
        const key = contextKeyOf(th);
        if (!s().contexts.some((c) => contextKeyOf(c) === key)) return;
        viewRef.current += 1;
        patch({ threadId: id, contextKey: key, messages: [], messagesCursor: null, notice: null, sending: false });
        void loadMessages(id, false);
      },
      loadOlderMessages() { const id = s().threadId; if (id && s().messagesCursor) void loadMessages(id, true); },
      loadMoreThreads() { if (s().threadsCursor) void loadThreads(true); },
      setDraft(text) { if (identityRef.current) patch({ draft: text }); },
      async send(text) {
        const content = (text ?? s().draft).trim();
        const ctx = s().contexts.find((c) => contextKeyOf(c) === s().contextKey);
        if (!content || content.length > s().maxChars || !ctx || s().sending || !s().generationEnabled) return;
        const t = token();
        const threadId = s().threadId;
        const optimistic: AssistantMessage = { id: `local-${newId()}`, role: 'user', content, createdAt: new Date().toISOString(), sources: [] };
        patch({ sending: true, notice: null, draft: '', messages: [...s().messages, optimistic] });
        const r = await assistantApi.send(threadId ? { requestId: newId(), content, threadId } : { requestId: newId(), content, scope: ctx.scope, targetId: ctx.targetId });
        if (!liveView(t)) return;
        if (!r.ok) {
          patch({ sending: false, notice: noticeFor(r.code, r.status), draft: content, messages: s().messages.filter((m) => m.id !== optimistic.id) });
          return;
        }
        if (r.data.pending || !r.data.reply) { patch({ sending: false, notice: 'pending', threadId: r.data.threadId }); return; }
        const isNew = !threadId;
        patch({ sending: false, threadId: r.data.threadId, messages: [...s().messages, r.data.reply] });
        if (isNew) void loadThreads(false);
      },
      async deleteThread(id) {
        const t = token(); if (!live(t)) return false;
        const r = await assistantApi.deleteThread(id);
        if (!live(t) || !r.ok) return false;
        const wasCurrent = s().threadId === id;
        if (wasCurrent) viewRef.current += 1;
        patch({ threads: s().threads.filter((x) => x.id !== id), ...(wasCurrent ? { threadId: null, messages: [], messagesCursor: null } : {}) });
        return true;
      },
      async clearHistory() {
        const t = token(); if (!live(t)) return false;
        const r = await assistantApi.clear();
        if (!live(t) || !r.ok) return false;
        viewRef.current += 1;
        patch({ threads: [], threadsCursor: null, threadId: null, messages: [], messagesCursor: null, notice: null });
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
