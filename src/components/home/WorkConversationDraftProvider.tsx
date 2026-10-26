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
 * state. A retained snapshot is usable only while auth is resolved,
 * user.id === session.user.id, managed-driver context is resolved and the user
 * is NOT acting for another driver.
 *
 * Epoch boundary: every validity/owner transition and every explicit clear()
 * starts a new epoch. Consumers obtain a lease bound to the epoch current at
 * lease time; a lease from any earlier epoch is permanently rejected, even if
 * the same owner later becomes valid again (A → signed out → A, A → B → A,
 * acting/revocation → A).
 */
export const PERSONAL_DRIVER_SCOPE = 'personal-driver-self' as const;

interface Store {
  owner: string;
  epoch: number;
  scope: typeof PERSONAL_DRIVER_SCOPE;
  fingerprint: string;
  snapshot: ConversationDraftSnapshot;
}

export interface WorkConversationDraftLease {
  read(fingerprint: string): ConversationDraftSnapshot | null;
  write(fingerprint: string, snapshot: ConversationDraftSnapshot): boolean;
}

export interface WorkConversationDraftStore {
  /** Returns a lease bound to the current epoch, or null when identity is not valid now. */
  lease(owner: string): WorkConversationDraftLease | null;
  /** Clears the retained draft and invalidates every previously issued lease. */
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
  const epochRef = useRef(0);
  const storeRef = useRef<Store | null>(null);

  // Synchronous fail-closed transition during render (refs only, no setState).
  if (liveOwnerRef.current !== liveOwner) {
    epochRef.current += 1;
    storeRef.current = null;
  }
  liveOwnerRef.current = liveOwner;

  const api = useMemo<WorkConversationDraftStore>(() => {
    const current = (owner: string, epoch: number) =>
      !!owner && liveOwnerRef.current === owner && epochRef.current === epoch;
    return {
      lease(owner) {
        if (!owner || liveOwnerRef.current !== owner) return null;
        const epoch = epochRef.current;
        return {
          read(fingerprint) {
            if (!current(owner, epoch)) return null;
            const s = storeRef.current;
            if (!s || s.owner !== owner || s.epoch !== epoch || s.scope !== PERSONAL_DRIVER_SCOPE) return null;
            if (s.fingerprint !== fingerprint) {
              storeRef.current = null;
              return null;
            }
            return s.snapshot;
          },
          write(fingerprint, snapshot) {
            if (!current(owner, epoch)) return false;
            storeRef.current = {
              owner,
              epoch,
              scope: PERSONAL_DRIVER_SCOPE,
              fingerprint,
              snapshot: Object.freeze(snapshot),
            };
            return true;
          },
        };
      },
      clear() {
        epochRef.current += 1;
        storeRef.current = null;
      },
    };
  }, []);

  return <DraftContext.Provider value={api}>{children}</DraftContext.Provider>;
}

/** Returns null outside the provider: consumers then keep ephemeral behavior. */
export function useWorkConversationDraftStore(): WorkConversationDraftStore | null {
  return useContext(DraftContext);
}
