import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { LATEST_RELEASE_ID } from '@/lib/releaseNotes';
import { supabase } from '@/integrations/supabase/client';

const KEY_PREFIX = 'htp:release-seen:';

function readLocal(userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(KEY_PREFIX + userId);
  } catch {
    return null;
  }
}

function writeLocal(userId: string, releaseId: string) {
  try {
    localStorage.setItem(KEY_PREFIX + userId, releaseId);
  } catch {
    /* storage may be unavailable; safe to ignore */
  }
}

/**
 * Per-user "What's New" dismiss tracking, persisted in `profiles.last_seen_release_id`.
 *
 * - Waits for auth to settle before deciding whether to show the modal.
 * - Treats a missing or unloaded value as NOT seen (so we never spam users
 *   who already dismissed it on another device).
 * - Persists with an upsert so users without a profile row still save state.
 */
export function useReleaseNotesSeen() {
  const { user, loading } = useAuth();
  const userId = user?.id;
  const [lastSeenId, setLastSeenId] = useState<string | null>(null);
  const [dbLoaded, setDbLoaded] = useState(false);

  // Reconcile from DB whenever the user changes
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setDbLoaded(false);
      setLastSeenId(null);
      return;
    }

    // Hydrate cached value first to avoid a flash for returning users on the same device
    const cached = readLocal(userId);
    if (cached) setLastSeenId(cached);
    setDbLoaded(false);

    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('last_seen_release_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (cancelled) return;

      if (!error && data) {
        const remote = (data as { last_seen_release_id: string | null }).last_seen_release_id ?? null;
        setLastSeenId(remote ?? cached ?? null);
        if (remote) writeLocal(userId, remote);
      }
      setDbLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const markSeen = useCallback(
    async (releaseId: string = LATEST_RELEASE_ID) => {
      if (!userId) return;
      // Optimistic local update
      writeLocal(userId, releaseId);
      setLastSeenId(releaseId);
      // Persist to DB so it survives storage clearing / new devices.
      // Use upsert so users that don't have a profile row yet still save state.
      try {
        await supabase
          .from('profiles')
          .upsert(
            { user_id: userId, last_seen_release_id: releaseId },
            { onConflict: 'user_id' },
          );
      } catch {
        /* keep local cache; will retry on next markSeen */
      }
    },
    [userId],
  );

  // Wait for both auth and the DB read before deciding whether to show the modal.
  const ready = !loading && !!userId && dbLoaded;
  const hasSeenLatest = !ready ? true : lastSeenId === LATEST_RELEASE_ID;

  return { ready, hasSeenLatest, lastSeenId, markSeen };
}
