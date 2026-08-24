/**
 * Phase TG-2F-C1 — recruiter dispatch-group bind code issuance (candidate).
 *
 * Calls ONLY the already-live TG-2F-B RPC `issue_telegram_dispatch_bind_token`.
 * No new backend object, migration, Edge Function, Telegram API call, chat
 * binding, or load logic is introduced here.
 *
 * SECURITY: the raw bind token lives ONLY in React memory for the lifetime of
 * this hook instance. It is never written to localStorage, sessionStorage, a
 * cookie, the URL, a query cache key, analytics, a log line, a toast, or the
 * database. It is never placed in a Telegram deep link.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/** Public, non-secret bot handle. Matches the live dispatch bot. */
export const TELEGRAM_DISPATCH_BOT_USERNAME = 'HaulTrackerProDispatchBot';

/** Server-side TTL of a dispatch bind token (TG-2F-B: 15 minutes). */
export const DISPATCH_BIND_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Raw bind tokens are exactly 64 lowercase hex characters. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function isValidDispatchBindToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export function buildDispatchBindCommand(token: string): string {
  return `/bind ${token}`;
}

const FRIENDLY_ERRORS: Record<string, string> = {
  telegram_not_authenticated: 'Please sign in again before generating a connection code.',
  telegram_dispatch_bind_invalid_input: 'Could not generate a connection code.',
  telegram_workspace_not_available: 'This recruiter workspace is not available.',
  telegram_dispatch_not_authorized:
    'You do not have dispatch permission for this recruiter workspace.',
};

export function friendlyDispatchBindError(raw: unknown, fallback: string): string {
  const message = typeof raw === 'string' ? raw : (raw as { message?: string })?.message ?? '';
  for (const key of Object.keys(FRIENDLY_ERRORS)) {
    if (message.includes(key)) return FRIENDLY_ERRORS[key];
  }
  return fallback;
}

/** Remaining whole seconds until expiry, floored at 0. */
export function remainingSeconds(expiresAtMs: number | null, nowMs: number): number {
  if (expiresAtMs === null) return 0;
  return Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000));
}

export function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Narrow RPC adapter — generated Supabase types are NOT edited in this phase.
type DispatchBindRpc = (
  fn: 'issue_telegram_dispatch_bind_token',
  args: { _recruiter_id: string },
) => PromiseLike<{ data: unknown; error: unknown }>;

const callDispatchBindRpc = supabase.rpc.bind(supabase) as unknown as DispatchBindRpc;

export interface UseTelegramDispatchBindResult {
  /** Raw token — memory only. Never persist or log this. */
  token: string | null;
  command: string | null;
  expiresAt: number | null;
  secondsRemaining: number;
  isExpired: boolean;
  isGenerating: boolean;
  generate: () => Promise<{ ok: true } | { ok: false; message: string }>;
  clear: () => void;
}

export function useTelegramDispatchBind(
  recruiterId: string | null | undefined,
): UseTelegramDispatchBindResult {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = useCallback(() => {
    setToken(null);
    setExpiresAt(null);
  }, []);

  // A workspace change must never leave a previous workspace's code on screen.
  useEffect(() => {
    clear();
  }, [recruiterId, clear]);

  useEffect(() => {
    if (expiresAt === null) {
      if (ticker.current) {
        clearInterval(ticker.current);
        ticker.current = null;
      }
      return;
    }
    setNow(Date.now());
    ticker.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (ticker.current) {
        clearInterval(ticker.current);
        ticker.current = null;
      }
    };
  }, [expiresAt]);

  const generate = useCallback(async () => {
    if (!recruiterId) {
      return { ok: false as const, message: 'Could not generate a connection code.' };
    }
    setIsGenerating(true);
    try {
      const { data, error } = await callDispatchBindRpc('issue_telegram_dispatch_bind_token', {
        _recruiter_id: recruiterId,
      });
      if (error) {
        // Generating a new code replaces any earlier one; a failure must not
        // leave a stale code visible.
        clear();
        return {
          ok: false as const,
          message: friendlyDispatchBindError(error, 'Could not generate a connection code.'),
        };
      }
      if (!isValidDispatchBindToken(data)) {
        clear();
        return { ok: false as const, message: 'Could not generate a connection code.' };
      }
      setToken(data);
      setExpiresAt(Date.now() + DISPATCH_BIND_TOKEN_TTL_MS);
      return { ok: true as const };
    } catch {
      // Raw error detail is intentionally never surfaced or logged: it can
      // echo the request payload.
      clear();
      return { ok: false as const, message: 'Could not generate a connection code.' };
    } finally {
      setIsGenerating(false);
    }
  }, [recruiterId, clear]);

  const secondsRemaining = remainingSeconds(expiresAt, now);

  return {
    token,
    command: token ? buildDispatchBindCommand(token) : null,
    expiresAt,
    secondsRemaining,
    isExpired: expiresAt !== null && secondsRemaining === 0,
    isGenerating,
    generate,
    clear,
  };
}
