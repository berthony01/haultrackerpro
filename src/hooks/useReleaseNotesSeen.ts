import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { LATEST_RELEASE_ID } from '@/lib/releaseNotes';

const KEY_PREFIX = 'htp:release-seen:';

function readSeen(userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(KEY_PREFIX + userId);
  } catch {
    return null;
  }
}

/**
 * Per-user "What's New" dismiss tracking using localStorage.
 * Avoids a DB migration for a purely UX preference.
 */
export function useReleaseNotesSeen() {
  const { user, loading } = useAuth();
  const [lastSeenId, setLastSeenId] = useState<string | null>(() => readSeen(user?.id));

  useEffect(() => {
    setLastSeenId(readSeen(user?.id));
  }, [user?.id]);

  const markSeen = useCallback(
    (releaseId: string = LATEST_RELEASE_ID) => {
      if (!user?.id) return;
      try {
        localStorage.setItem(KEY_PREFIX + user.id, releaseId);
      } catch {
        /* storage may be unavailable; safe to ignore */
      }
      setLastSeenId(releaseId);
    },
    [user?.id],
  );

  const ready = !loading && !!user?.id;
  const hasSeenLatest = !ready ? true : lastSeenId === LATEST_RELEASE_ID;

  return { ready, hasSeenLatest, lastSeenId, markSeen };
}
