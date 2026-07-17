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

    ranForUser.current = user.id;

    // Phase 1E: even without a fresh hint, verify server-side once per
    // session. The RPC is SECURITY DEFINER and idempotent — it only
    // flips intent for fresh signups or existing recruiters, so calling
    // it for every session is safe and closes the gap where an OAuth
    // recruiter lost the sessionStorage hint on tab close.
    (async () => {
      let applied = false;
      try {
        const { data, error } = await supabase.rpc('apply_recruiter_intent');
        if (error) {
          // Transient failure — allow retry on next mount, don't flip UI.
          ranForUser.current = null;
          return;
        }
        const payload = (data ?? {}) as { applied?: boolean };
        applied = !!payload.applied;
      } catch {
        ranForUser.current = null;
        return;
      }
      // Clear the session hint regardless of outcome so we don't loop on
      // an ineligible driver. If they later complete the real recruiter
      // application, that flow will set intended_role server-side.
      if (recruiterIntent) {
        try {
          sessionStorage.removeItem('htp_auth_intent');
        } catch {}
      }
      if (applied) {
        queryClient.invalidateQueries({ queryKey: ['user-role-profile-intent', user.id] });
        queryClient.invalidateQueries({ queryKey: ['user-role-recruiter-check', user.id] });
      }
    })();
  }, [user, loading, queryClient]);
}
