import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { dispatchPermissions, type DispatchPage, type DispatchPermissions } from '@/lib/dispatchWorkspace';

// Local typed adapter: candidate RPCs are intentionally not in generated live types.
export type DispatchRpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
export const dispatchRpc = supabase.rpc.bind(supabase) as unknown as DispatchRpc;
const denied: DispatchPermissions = { view: false, create: false, status: false };
export interface DispatchQuery { relationship: string; bucket: 'active' | 'history'; status: string; offset: number; date: string; driverOffset: number }
export function useDispatchWorkspace(recruiterId: string, query: DispatchQuery) {
  const { user } = useAuth();
  const scope = `${user?.id ?? ''}:${recruiterId}`;
  const latestScope = useRef(scope); latestScope.current = scope;
  const generation = useRef(0);
  const [state, setState] = useState<{ scope: string; permissions: DispatchPermissions; page: DispatchPage | null; error: string | null; loading: boolean; verified: boolean } | null>(null);
  const queryKey = JSON.stringify(query);
  const refresh = useCallback(async () => {
    const seq = ++generation.current;
    const valid = () => seq === generation.current && latestScope.current === scope;
    if (!user?.id || !recruiterId) { setState(null); return; }
    setState(old => ({ scope, permissions: old?.scope === scope ? old.permissions : denied, page: old?.scope === scope ? old.page : null, error: null, loading: true, verified: false }));
    try {
      const resolved = await dispatchRpc('get_my_recruiter_permissions', { _recruiter_id: recruiterId });
      if (!valid()) return;
      if (resolved.error) throw new Error('Your dispatch permissions could not be verified.');
      const permissions = dispatchPermissions(resolved.data);
      if (!permissions.view) { setState({ scope, permissions: denied, page: null, error: 'Dispatch access is not assigned in this workspace.', loading: false, verified: true }); return; }
      const q = JSON.parse(queryKey) as DispatchQuery;
      const result = await dispatchRpc('dispatch_mini_read', { _recruiter_id: recruiterId, _relationship_id: q.relationship || null, _bucket: q.bucket, _status: q.status || null, _offset: q.offset, _limit: 25, _as_of: q.date, _driver_offset: q.driverOffset });
      if (!valid()) return;
      if (result.error) throw new Error('Dispatch loads could not be loaded. Retry or check workspace access.');
      const page = result.data as DispatchPage | null;
      if (!page || !Array.isArray(page.loads) || !Array.isArray(page.drivers) || !Array.isArray(page.summaries) || !Number.isFinite(page.total)) throw new Error('The dispatch response could not be verified.');
      setState({ scope, permissions, page, error: null, loading: false, verified: true });
    } catch (error) {
      if (valid()) setState({ scope, permissions: denied, page: null, error: error instanceof Error ? error.message : 'Dispatch is unavailable.', loading: false, verified: false });
    }
  }, [scope, user?.id, recruiterId, queryKey]);
  useEffect(() => {
    void refresh();
    const focus = () => { void refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(focus, 15000);
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visible);
    return () => { ++generation.current; window.clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const scoped = state?.scope === scope ? state : null;
  return { scope, permissions: scoped?.permissions ?? denied, page: scoped?.page ?? null, error: scoped?.error ?? null, loading: scoped?.loading ?? true, verified: scoped?.verified ?? false, refresh };
}