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
 * Uses localStorage as a fast cache to prevent the modal from flashing
 * on page load before the profile query resolves.
 */
export function useReleaseNotesSeen() {
  const { user, loading } = useAuth();
  const [lastSeenId, setLastSeenId] = useState<string | null>(() => readLocal(user?.id));
  const [dbLoaded, setDbLoaded] = useState(false);

  // Reconcile from DB whenever the user changes
  useEffect(() => {
    let cancelled = false;
    const uid = user?.id;
    if (!uid) {
      setDbLoaded(false);
      setLastSeenId(null);
      return;
    }

    // Hydrate cached value first to avoid a flash
    setLastSeenId(readLocal(uid));
    setDbLoaded(false);

    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('last_seen_release_id')
        .eq('user_id', uid)
        .maybeSingle();

      if (cancelled) return;

      if (!error && data) {
        const remote = (data as { last_seen_release_id: string | null }).last_seen_release_id ?? null;
        setLastSeenId(remote);
        if (remote) writeLocal(uid, remote);
      }
      setDbLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const markSeen = useCallback(
    async (releaseId: string = LATEST_RELEASE_ID) => {
      const uid = user?.id;
      if (!uid) return;
      // Optimistic local update
      writeLocal(uid, releaseId);
      setLastSeenId(releaseId);
      // Persist to DB so it survives storage clearing / new devices
      try {
        await supabase
          .from('profiles')
          .update({ last_seen_release_id: releaseId })
          .eq('user_id', uid);
      } catch {
        /* keep local cache; will retry on next markSeen */
      }
    },
    [user?.id],
  );

  // Wait for both auth and the DB read before deciding whether to show the modal,
  // so we don't briefly show it to users who already dismissed it on another device.
  const ready = !loading && !!user?.id && dbLoaded;
  const hasSeenLatest = !ready ? true : lastSeenId === LATEST_RELEASE_ID;

  return { ready, hasSeenLatest, lastSeenId, markSeen };
}
