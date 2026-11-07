import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { readMiniAppRuntime } from '@/lib/telegramMiniApp';

type Connection = { phase: 'checking' | 'linked' | 'not_linked' | 'error'; busy: boolean; code: string | null; preserveWorkspace: boolean };
const initial: Connection = { phase: 'checking', busy: false, code: null, preserveWorkspace: false };

export function useTelegramMiniAppConnection(userId: string, accessToken: string) {
  const [connection, setConnection] = useState<Connection>(initial);
  const generation = useRef(0);
  const connecting = useRef(false);
  const verify = useCallback(async (action: 'status' | 'connect' = 'status') => {
    if (connecting.current) return;
    if (action === 'connect') connecting.current = true;
    const request = ++generation.current;
    setConnection(previous => ({ ...previous, busy: true, code: null }));
    try {
      const runtime = readMiniAppRuntime();
      if (!runtime?.initData || !userId || !accessToken) throw new Error('unavailable');
      // The explicit token belongs to the account displayed when the action
      // started. A concurrent account switch cannot connect the next account.
      const { data, error } = await supabase.functions.invoke('telegram-mini-app', {
        timeout: 15000,
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { action, initData: runtime.initData },
      });
      if (request !== generation.current) return;
      let code: string | null = null;
      if (error) {
        try {
          const response = (error as { context?: Response }).context;
          if (response instanceof Response) code = (await response.clone().json())?.code ?? null;
        } catch { /* Never expose raw transport or server details. */ }
        if (request !== generation.current) return;
      }
      if (!error && (data?.status === 'linked' || data?.status === 'not_linked')) {
        setConnection({ phase: data.status, busy: false, code: null, preserveWorkspace: data.status === 'linked' });
      } else {
        const boundedCode = typeof code === 'string' ? code : 'mini_app_unavailable';
        setConnection(previous => ({ phase: 'error', busy: false, code: boundedCode,
          preserveWorkspace: previous.preserveWorkspace && !['sign_in_required', 'telegram_session_expired', 'telegram_connection_conflict'].includes(boundedCode) }));
      }
    } catch {
      if (request === generation.current) setConnection(previous => ({ ...previous, phase: 'error', busy: false, code: 'mini_app_unavailable' }));
    } finally {
      if (action === 'connect') connecting.current = false;
    }
  }, [userId, accessToken]);

  useEffect(() => {
    const requests = generation;
    void verify();
    const recheck = () => { void verify(); };
    const runtime = readMiniAppRuntime();
    const interval = setInterval(recheck, 30000);
    runtime?.onEvent('activated', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      ++requests.current;
      clearInterval(interval);
      runtime?.offEvent('activated', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [verify]);

  return { ...connection, retry: () => verify('status'), connect: () => verify('connect') };
}
