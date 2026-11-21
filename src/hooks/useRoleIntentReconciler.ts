import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Reconcile only an explicit recruiter continuation from the Auth page or
 * OAuth redirect. The server RPC can reclassify a fresh Driver-intent profile;
 * calling it on an ordinary login is therefore NOT safe. These hints request
 * reconciliation only, never authorize a workspace or grant a capability.
 */
export function useRoleIntentReconciler() {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const attempts = useRef(new Map<string, symbol>());
  const identity = useRef({ userId: user?.id ?? null, generation: 0 });
  const mounted = useRef(true);
  if (identity.current.userId !== (user?.id ?? null)) {
    identity.current = {
      userId: user?.id ?? null,
      generation: identity.current.generation + 1,
    };
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    if (attempts.current.has(user.id)) return;

    let recruiterIntent = false;
    try {
      const stored = sessionStorage.getItem('htp_auth_intent');
      if (stored === 'recruiter') recruiterIntent = true;
    } catch {}
    const urlIntent = new URLSearchParams(window.location.search).get('intent');
    if (urlIntent === 'recruiter') recruiterIntent = true;
    if (!recruiterIntent) return;

    const userId = user.id;
    const generation = identity.current.generation;
    const token = Symbol(userId);
    attempts.current.set(userId, token);
    const isCurrent = () => mounted.current &&
      identity.current.userId === userId && identity.current.generation === generation;
    const allowRetry = () => {
      // A late failure may release A's guard, never another account's attempt.
      if (attempts.current.get(userId) === token) attempts.current.delete(userId);
    };

    (async () => {
      let applied = false;
      try {
        const { data, error } = await supabase.rpc('apply_recruiter_intent');
        if (error) {
          // Transient failure — allow retry on next mount, don't flip UI.
          allowRetry();
          return;
        }
        const payload = (data ?? {}) as { applied?: boolean };
        applied = !!payload.applied;
      } catch {
        allowRetry();
        return;
      }
      if (!isCurrent()) return;
      // A settled response consumes only still-matching explicit hints.
      // Errors retain them for retry; stale responses cannot clear B's hints.
      try {
        if (sessionStorage.getItem('htp_auth_intent') === 'recruiter') {
          sessionStorage.removeItem('htp_auth_intent');
        }
      } catch {}
      if (urlIntent === 'recruiter') {
        const url = new URL(window.location.href);
        if (url.searchParams.get('intent') === 'recruiter') {
          url.searchParams.delete('intent');
          window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
        }
      }
      if (applied) {
        queryClient.invalidateQueries({ queryKey: ['user-role-profile-intent', userId] });
        queryClient.invalidateQueries({ queryKey: ['user-role-recruiter-check', userId] });
      }
    })();
  }, [user, loading, queryClient]);
}
