import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useActingContext } from '@/hooks/useActingContext';
import type { ConversationDraftSnapshot } from '@/components/home/HomeConversationFlow';

/**
 * Phase 3 foundation: same-tab, memory-only continuity for the personal Driver
 * guided conversation. Nothing here is serialized, logged, transmitted or
 * written to any browser storage. A page refresh destroys it.
 *
 * Identity is derived ONLY from the existing AuthProvider + ActingContext
 * state. The retained snapshot is readable/writable only while:
 *   auth is resolved, user.id === session.user.id, managed-driver context is
 *   resolved, and the user is NOT acting for another driver.
 * Any other state clears the snapshot synchronously and fails closed.
 */
export const PERSONAL_DRIVER_SCOPE = 'personal-driver-self' as const;

interface Store {
  owner: string;
  scope: typeof PERSONAL_DRIVER_SCOPE;
  fingerprint: string;
  snapshot: ConversationDraftSnapshot;
}

export interface WorkConversationDraftStore {
  read(owner: string, fingerprint: string): ConversationDraftSnapshot | null;
  write(owner: string, fingerprint: string, snapshot: ConversationDraftSnapshot): boolean;
  clear(): void;
}

const DraftContext = createContext<WorkConversationDraftStore | null>(null);

export function WorkConversationDraftProvider({ children }: { children: ReactNode }) {
  const { user, session, loading } = useAuth();
  const { isActingAsAssistant, isLoadingManagedDrivers } = useActingContext();

  const valid =
    !loading &&
    !!user?.id &&
    !!session?.user?.id &&
    session.user.id === user.id &&
    !isLoadingManagedDrivers &&
    !isActingAsAssistant;
  const liveOwner = valid ? (user!.id as string) : null;

  const liveOwnerRef = useRef<string | null>(liveOwner);
  const storeRef = useRef<Store | null>(null);

  // Synchronous fail-closed invalidation during render (ref only, no setState).
  liveOwnerRef.current = liveOwner;
  if (storeRef.current && storeRef.current.owner !== liveOwner) storeRef.current = null;

  const api = useMemo<WorkConversationDraftStore>(
    () => ({
      read(owner, fingerprint) {
        const live = liveOwnerRef.current;
        const s = storeRef.current;
        if (!owner || live !== owner) return null;
        if (!s || s.owner !== owner || s.scope !== PERSONAL_DRIVER_SCOPE) return null;
        if (s.fingerprint !== fingerprint) {
          storeRef.current = null;
          return null;
        }
        return s.snapshot;
      },
      write(owner, fingerprint, snapshot) {
        if (!owner || liveOwnerRef.current !== owner) return false;
        storeRef.current = {
          owner,
          scope: PERSONAL_DRIVER_SCOPE,
          fingerprint,
          snapshot: Object.freeze(snapshot),
        };
        return true;
      },
      clear() {
        storeRef.current = null;
      },
    }),
    [],
  );

  return <DraftContext.Provider value={api}>{children}</DraftContext.Provider>;
}

/** Returns null outside the provider: consumers then keep ephemeral behavior. */
export function useWorkConversationDraftStore(): WorkConversationDraftStore | null {
  return useContext(DraftContext);
}
