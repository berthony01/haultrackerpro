import { supabase } from '@/integrations/supabase/client';

/** AI assistant transport. Invokes ONLY the assistant-chat backend function,
 *  through the existing client and session. No new client, no fallback. */

export type AssistantScope = 'driver_self' | 'driver_delegate' | 'recruiter' | 'agency';
export interface AssistantContext { scope: AssistantScope; targetId: string; label: string; tools: string[] }
export interface AssistantSourceCard { key: string; label: string; href: string }
export interface AssistantMessage { id: string; role: 'user' | 'assistant'; content: string; createdAt: string; sources: AssistantSourceCard[] }
export interface AssistantThread { id: string; scope: AssistantScope; targetId: string; createdAt: string; expiresAt: string; preview: string }
export interface Cursor { before: string; beforeId: string }
export interface BootstrapData {
  available: true; generationEnabled: boolean; retentionDays: number;
  limits: { daily: number; perMinute: number; maxChars: number };
  contexts: AssistantContext[]; contextsTruncated: boolean;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string };

export type AssistantRequest =
  | { action: 'bootstrap' }
  | { action: 'threads'; cursor?: Cursor | null }
  | { action: 'messages'; threadId: string; cursor?: Cursor | null }
  | { action: 'send'; requestId: string; content: string; threadId?: string | null; scope?: AssistantScope; targetId?: string }
  | { action: 'delete'; threadId: string }
  | { action: 'clear'; confirm: true };

export async function invokeAssistant<T>(body: AssistantRequest): Promise<ApiResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('assistant-chat', { body });
    if (!error) return { ok: true, data: data as T };
    const ctx = (error as { context?: Response }).context;
    const status = ctx && typeof ctx.status === 'number' ? ctx.status : 0;
    let code = 'unavailable';
    try { const j = ctx ? await ctx.clone().json() : null; if (j && typeof j.error === 'string') code = j.error; if (j && typeof j.reason === 'string') code = j.reason; } catch { /* non-JSON */ }
    return { ok: false, status, code };
  } catch {
    return { ok: false, status: 0, code: 'unavailable' };
  }
}

export const assistantApi = {
  bootstrap: () => invokeAssistant<BootstrapData>({ action: 'bootstrap' }),
  threads: (cursor?: Cursor | null) => invokeAssistant<{ threads: AssistantThread[]; nextCursor: Cursor | null }>({ action: 'threads', cursor: cursor ?? null }),
  messages: (threadId: string, cursor?: Cursor | null) => invokeAssistant<{ messages: AssistantMessage[]; nextCursor: Cursor | null }>({ action: 'messages', threadId, cursor: cursor ?? null }),
  send: (req: Omit<Extract<AssistantRequest, { action: 'send' }>, 'action'>) => invokeAssistant<{ threadId: string; reply?: AssistantMessage; pending?: boolean }>({ action: 'send', ...req }),
  deleteThread: (threadId: string) => invokeAssistant<{ deleted: boolean }>({ action: 'delete', threadId }),
  clear: () => invokeAssistant<{ cleared: number }>({ action: 'clear', confirm: true }),
};
