/**
 * Phase TG-2E3-A — Telegram account-linking UI hook (candidate).
 *
 * Reads ONLY the current user's own `telegram_user_links` row (RLS is
 * authoritative) and calls ONLY the already-live TG-2B RPCs
 * `issue_telegram_link_token` and `revoke_my_telegram_link`.
 *
 * No new backend object, migration, Edge Function, Telegram API call
 * (sendMessage/setWebhook/getUpdates), chat binding, or load logic is
 * introduced here.
 *
 * SECURITY: the raw link token exists ONLY inside the immediate connect
 * function scope. It is never stored in React state, the query cache,
 * localStorage, sessionStorage, URL state, analytics, logs, toasts, or the
 * database. `telegram_user_id` is never selected or surfaced.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export const TELEGRAM_BOT_USERNAME = 'HaulTrackerProDispatchBot';
export const TELEGRAM_DEEP_LINK_PREFIX = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=`;

/** Raw tokens are exactly 64 lowercase hex characters. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function isValidTelegramLinkToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export function buildTelegramDeepLink(token: string): string {
  return `${TELEGRAM_DEEP_LINK_PREFIX}${encodeURIComponent(token)}`;
}

const FRIENDLY_ERRORS: Record<string, string> = {
  telegram_not_authenticated: 'Please sign in again before connecting Telegram.',
  telegram_already_linked: 'This account is already connected to Telegram.',
};

export function friendlyTelegramError(raw: unknown, fallback: string): string {
  const message = typeof raw === 'string' ? raw : (raw as { message?: string })?.message ?? '';
  for (const key of Object.keys(FRIENDLY_ERRORS)) {
    if (message.includes(key)) return FRIENDLY_ERRORS[key];
  }
  return fallback;
}

// Narrow RPC adapter — generated Supabase types are NOT edited in this phase.
type TelegramRpc = (
  fn: 'issue_telegram_link_token' | 'revoke_my_telegram_link',
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

const callTelegramRpc = supabase.rpc.bind(supabase) as unknown as TelegramRpc;

export interface TelegramLinkRow {
  status: string | null;
  linked_at: string | null;
  revoked_at: string | null;
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120000;

export function useTelegramLink() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ['telegram-user-link', user?.id ?? null];

  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isAwaitingConfirmation, setIsAwaitingConfirmation] = useState(false);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    enabled: !!user?.id,
    queryFn: async (): Promise<TelegramLinkRow | null> => {
      const { data: row, error: queryError } = await supabase
        .from('telegram_user_links')
        // telegram_user_id is intentionally NOT selected.
        .select('status, linked_at, revoked_at')
        .eq('user_id', user!.id)
        .order('linked_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (queryError) throw queryError;
      return (row as TelegramLinkRow | null) ?? null;
    },
  });

  const connected = data?.status === 'active';
  const previouslyConnected = data?.status === 'revoked';

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    if (pollDeadline.current) {
      clearTimeout(pollDeadline.current);
      pollDeadline.current = null;
    }
    setIsAwaitingConfirmation(false);
  }, []);

  // Stop polling as soon as the link becomes active.
  useEffect(() => {
    if (connected) stopPolling();
  }, [connected, stopPolling]);

  // Always stop polling on unmount.
  useEffect(() => stopPolling, [stopPolling]);

  const startAwaitingConfirmation = useCallback(() => {
    stopPolling();
    setIsAwaitingConfirmation(true);
    pollTimer.current = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey });
    }, POLL_INTERVAL_MS);
    pollDeadline.current = setTimeout(stopPolling, POLL_TIMEOUT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, stopPolling, user?.id]);

  /**
   * Issues a one-time link token and hands the deep link to `openDeepLink`.
   * The token never leaves this function scope.
   */
  const connect = useCallback(
    async (openDeepLink: (url: string) => void, onFailure?: () => void) => {
      setIsConnecting(true);
      try {
        const { data: rpcData, error: rpcError } = await callTelegramRpc('issue_telegram_link_token');
        if (rpcError) {
          onFailure?.();
          return { ok: false as const, message: friendlyTelegramError(rpcError, 'Could not start Telegram connection.') };
        }
        if (!isValidTelegramLinkToken(rpcData)) {
          onFailure?.();
          return { ok: false as const, message: 'Could not start Telegram connection.' };
        }
        openDeepLink(buildTelegramDeepLink(rpcData));
        startAwaitingConfirmation();
        return { ok: true as const };
      } finally {
        setIsConnecting(false);
      }
    },
    [startAwaitingConfirmation],
  );

  const disconnect = useCallback(async () => {
    setIsDisconnecting(true);
    try {
      const { error: rpcError } = await callTelegramRpc('revoke_my_telegram_link');
      if (rpcError) {
        return { ok: false as const, message: friendlyTelegramError(rpcError, 'Could not disconnect Telegram.') };
      }
      stopPolling();
      await queryClient.invalidateQueries({ queryKey });
      await refetch();
      return { ok: true as const };
    } finally {
      setIsDisconnecting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, refetch, stopPolling, user?.id]);

  return {
    connected,
    previouslyConnected,
    linkedAt: data?.linked_at ?? null,
    revokedAt: data?.revoked_at ?? null,
    isLoading,
    error,
    refetch,
    connect,
    disconnect,
    isConnecting,
    isDisconnecting,
    isAwaitingConfirmation,
    stopPolling,
  };
}
