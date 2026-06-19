import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Durable role-intent reconciler.
 *
 * Problem this solves:
 *   `lovable.auth.signInWithOAuth('google', …)` cannot carry
 *   `raw_user_meta_data.intended_role`, so `handle_new_user()` writes
 *   `profiles.intended_role = 'driver'` for every Google signup — even when
 *   the user clicked "Sign up as recruiter". Only sessionStorage was tracking
 *   the intent, which evaporates with the tab and silently demotes recruiters
 *   to drivers on their next login.
 *
 * Fix:
 *   When the user is authenticated AND we see a recruiter intent flag
 *   (sessionStorage `htp_auth_intent` set by the Auth page, or `?intent=recruiter`
 *   on the post-OAuth URL), upsert `profiles.intended_role = 'recruiter'`
 *   exactly once per session, then invalidate the role query so the rest of
 *   the app sees the recruiter role immediately.
 *
 * Email signups already work via `signUp({ options: { data: { intended_role } } })`
 * which feeds `handle_new_user()` — this hook just brings Google parity.
 */
export function useRoleIntentReconciler() {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const ranForUser = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    if (ranForUser.current === user.id) return;

    let recruiterIntent = false;
    try {
      const stored = sessionStorage.getItem('htp_auth_intent');
      if (stored === 'recruiter') recruiterIntent = true;
      const urlIntent = new URLSearchParams(window.location.search).get('intent');
      if (urlIntent === 'recruiter') recruiterIntent = true;
    } catch {}

    if (!recruiterIntent) {
      ranForUser.current = user.id;
      return;
    }

    ranForUser.current = user.id;
    (async () => {
      try {
        // Server-authoritative: the RPC runs SECURITY DEFINER, validates
        // auth.uid(), and is the only client-reachable path allowed to flip
        // intended_role (a BEFORE UPDATE trigger pins it for plain UPDATEs).
        const { error } = await supabase.rpc('apply_recruiter_intent');
        if (error) {
          // Do NOT silently grant recruiter intent on failure — allow retry
          // on next mount and skip cache invalidation so we don't flip the UI
          // based on the stale driver row.
          ranForUser.current = null;
          return;
        }
      } catch {
        ranForUser.current = null;
        return;
      }
      try {
        sessionStorage.removeItem('htp_auth_intent');
      } catch {}
      // Refetch role so Index / BottomNav / AppSidebar flip immediately.
      queryClient.invalidateQueries({ queryKey: ['user-role-profile-intent', user.id] });
      queryClient.invalidateQueries({ queryKey: ['user-role-recruiter-check', user.id] });
    })();
  }, [user, loading, queryClient]);
}
