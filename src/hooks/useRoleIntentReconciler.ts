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
        // Upsert — if handle_new_user already created the row we just flip
        // intended_role to 'recruiter'; if it raced, we create it.
        const { error } = await supabase
          .from('profiles')
          .upsert(
            { user_id: user.id, intended_role: 'recruiter' },
            { onConflict: 'user_id' },
          );
        if (error) {
          // Retry as a plain update in case upsert hit a NOT NULL we don't know about.
          await supabase
            .from('profiles')
            .update({ intended_role: 'recruiter' })
            .eq('user_id', user.id);
        }
      } catch {
        // Non-fatal — the sessionStorage fallback in useUserRole will still
        // render the recruiter UI for this session; we just won't have
        // durability across sessions until the user re-authenticates.
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
