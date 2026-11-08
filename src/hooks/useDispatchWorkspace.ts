import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { dispatchPermissions, type DispatchPage, type DispatchPermissions } from '@/lib/dispatchWorkspace';
import { parseRecruiterStaffPermissions } from '@/lib/recruiterStaffPermissions';

export type DispatchRpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
export const dispatchRpc = supabase.rpc.bind(supabase) as unknown as DispatchRpc;
const denied: DispatchPermissions = { view: false, create: false, status: false };
export interface DispatchQuery { relationship: string; bucket: 'active' | 'history'; status: string; offset: number; date: string; driverOffset: number }
interface DispatchState { scope: string; queryKey: string; permissions: DispatchPermissions; page: DispatchPage | null; error: string | null; loading: boolean; verified: boolean }
interface InFlight { scope: string; queryKey: string; generation: number; promise: Promise<void> }

export function useDispatchWorkspace(recruiterId: string, query: DispatchQuery) {
  const { user } = useAuth();
  const scope = `${user?.id ?? ''}:${recruiterId}`;
  const latestScope = useRef(scope); latestScope.current = scope;
  const generation = useRef(0);
  const inFlight = useRef<InFlight | null>(null);
  const [state, setState] = useState<DispatchState | null>(null);
  const queryKey = JSON.stringify(query);
  const invalidate = useCallback(() => { generation.current += 1; inFlight.current = null; }, []);

  // Focus, visibility and polling often arrive together in Telegram. Reuse a
  // matching read; a confirmed mutation explicitly forces a newer read instead.
  const refresh = useCallback((force = false): Promise<void> => {
    const running = inFlight.current;
    if (!force && running?.scope === scope && running.queryKey === queryKey && running.generation === generation.current) return running.promise;
    const seq = ++generation.current;
    const valid = () => seq === generation.current && latestScope.current === scope;
    if (!user?.id || !recruiterId) { setState(null); return Promise.resolve(); }
    setState(old => ({ scope, queryKey, permissions: old?.scope === scope ? old.permissions : denied,
      page: old?.scope === scope && old.queryKey === queryKey ? old.page : null, error: null, loading: true, verified: false }));
    const request = async () => {
      let accessDenied = false;
      const deniedByServer = (error: unknown) => !!error && typeof error === 'object' && ('code' in error && error.code === '42501' || 'message' in error && String(error.message).includes('dispatch_not_authorized'));
      try {
        const resolved = await dispatchRpc('get_my_recruiter_permissions', { _recruiter_id: recruiterId });
        if (!valid()) return;
        if (resolved.error) { accessDenied = deniedByServer(resolved.error); throw new Error('Your dispatch permissions could not be verified.'); }
        const parsed = parseRecruiterStaffPermissions(resolved.data);
        if (!parsed) { accessDenied = true; throw new Error('Your dispatch permissions could not be verified.'); }
        const permissions = dispatchPermissions(parsed);
        if (!permissions.view) { setState({ scope, queryKey, permissions: denied, page: null, error: 'Dispatch access is not assigned in this workspace.', loading: false, verified: true }); return; }
        const q = JSON.parse(queryKey) as DispatchQuery;
        const result = await dispatchRpc('dispatch_mini_read', { _recruiter_id: recruiterId, _relationship_id: q.relationship || null, _bucket: q.bucket, _status: q.status || null, _offset: q.offset, _limit: 25, _as_of: q.date, _driver_offset: q.driverOffset });
        if (!valid()) return;
        if (result.error) { accessDenied = deniedByServer(result.error); throw new Error('Dispatch loads could not be loaded. Retry or check workspace access.'); }
        const page = result.data as DispatchPage | null;
        if (!page || !Array.isArray(page.loads) || !Array.isArray(page.drivers) || !Array.isArray(page.summaries) || !Number.isFinite(page.total)) throw new Error('The dispatch response could not be verified.');
        setState({ scope, queryKey, permissions, page, error: null, loading: false, verified: true });
      } catch (error) {
        if (valid()) setState(old => ({ scope, queryKey, permissions: !accessDenied && old?.scope === scope ? old.permissions : denied, page: null,
          error: error instanceof Error ? error.message : 'Dispatch is unavailable.', loading: false, verified: false }));
      }
    };
    const promise = request().finally(() => { if (inFlight.current?.generation === seq) inFlight.current = null; });
    inFlight.current = { scope, queryKey, generation: seq, promise };
    return promise;
  }, [scope, user?.id, recruiterId, queryKey]);

  useEffect(() => {
    void refresh();
    const recheck = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(recheck, 15000);
    window.addEventListener('focus', recheck); document.addEventListener('visibilitychange', recheck);
    return () => { invalidate(); window.clearInterval(timer); window.removeEventListener('focus', recheck); document.removeEventListener('visibilitychange', recheck); };
  }, [refresh, invalidate]);
  const scoped = state?.scope === scope ? state : null;
  const sameQuery = scoped?.queryKey === queryKey;
  return { scope, permissions: scoped?.permissions ?? denied, page: sameQuery ? scoped?.page ?? null : null,
    error: sameQuery ? scoped?.error ?? null : null, loading: sameQuery ? scoped?.loading ?? true : true,
    verified: sameQuery ? scoped?.verified ?? false : false, refresh };
}
