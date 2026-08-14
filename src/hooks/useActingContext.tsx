import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { AssistantPermissions } from '@/lib/assistantPermissions';

export interface ManagedDriver {
  delegate_id: string;
  driver_user_id: string;
  driver_email: string;
  driver_name: string | null;
  permissions: AssistantPermissions;
  accepted_at: string | null;
  last_active_at: string | null;
  /**
   * Phase DA-1 — the MANAGED DRIVER's canonical Driver Pro entitlement, as
   * resolved server-side. Driver-workspace Pro gates while acting as an
   * assistant must use this, never the assistant's own subscription.
   */
  driver_is_pro: boolean;
}


interface ActingContextValue {
  /** The driver the assistant is currently acting for, if any. */
  actingDriver: ManagedDriver | null;
  /** user.id when self, driver_user_id when acting as assistant. Use this for all data scoping. */
  targetUserId: string | null;
  /** True iff currently acting for someone other than self. */
  isActingAsAssistant: boolean;
  /** All drivers this user can act as. */
  managedDrivers: ManagedDriver[];
  isLoadingManagedDrivers: boolean;
  /** Permissions for the current acting context (null when self — full access). */
  permissions: AssistantPermissions | null;
  beginActingAs: (driverUserId: string) => void;
  exitActingAs: () => void;
}

const ActingContext = createContext<ActingContextValue | null>(null);

const STORAGE_KEY = 'haultracker.actingAs';

export function ActingContextProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [actingDriverId, setActingDriverId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  // Reset on user change / sign-out.
  useEffect(() => {
    if (!user) {
      setActingDriverId(null);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
  }, [user]);

  const managedQuery = useQuery({
    queryKey: ['managed-drivers', user?.id],
    queryFn: async (): Promise<ManagedDriver[]> => {
      if (!user) return [];
      const { data, error } = await (supabase as any).rpc('get_my_managed_drivers');
      if (error) throw error;
      return ((data ?? []) as ManagedDriver[]).map((d) => ({
        ...d,
        permissions: (d.permissions ?? {}) as AssistantPermissions,
        // Fail closed: absent/malformed server value is treated as non-Pro.
        driver_is_pro: d.driver_is_pro === true,
      }));

    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const managedDrivers = managedQuery.data ?? [];

  // Validate persisted acting id against the server-returned list.
  useEffect(() => {
    if (!actingDriverId) return;
    if (managedQuery.isLoading) return;
    const ok = managedDrivers.some((d) => d.driver_user_id === actingDriverId);
    if (!ok) {
      setActingDriverId(null);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
  }, [actingDriverId, managedDrivers, managedQuery.isLoading]);

  const actingDriver = useMemo(
    () => managedDrivers.find((d) => d.driver_user_id === actingDriverId) ?? null,
    [managedDrivers, actingDriverId],
  );

  const beginActingAs = useCallback((driverUserId: string) => {
    setActingDriverId(driverUserId);
    try {
      sessionStorage.setItem(STORAGE_KEY, driverUserId);
    } catch {}
  }, []);

  const exitActingAs = useCallback(() => {
    setActingDriverId(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  const value = useMemo<ActingContextValue>(
    () => ({
      actingDriver,
      targetUserId: actingDriver?.driver_user_id ?? user?.id ?? null,
      isActingAsAssistant: !!actingDriver,
      managedDrivers,
      isLoadingManagedDrivers: managedQuery.isLoading,
      permissions: actingDriver?.permissions ?? null,
      beginActingAs,
      exitActingAs,
    }),
    [actingDriver, user?.id, managedDrivers, managedQuery.isLoading, beginActingAs, exitActingAs],
  );

  return <ActingContext.Provider value={value}>{children}</ActingContext.Provider>;
}

export function useActingContext(): ActingContextValue {
  const ctx = useContext(ActingContext);
  if (ctx) return ctx;
  // Safe fallback so components that render outside the provider during HMR
  // don't crash — they just see "self" with no acting context.
  return {
    actingDriver: null,
    targetUserId: null,
    isActingAsAssistant: false,
    managedDrivers: [],
    isLoadingManagedDrivers: false,
    permissions: null,
    beginActingAs: () => {},
    exitActingAs: () => {},
  };
}

/**
 * Returns the user id that data hooks should scope to:
 *   - the driver they are acting for, if any;
 *   - otherwise the signed-in user's id.
 *
 * This is the single source of truth used by useLoads, useExpenses, etc.
 * Because RLS enforces the same rule server-side, a bug here cannot leak
 * data — Postgres will simply refuse the read or write.
 */
export function useTargetUserId(): string | null {
  const { user } = useAuth();
  const { actingDriver } = useActingContext();
  return actingDriver?.driver_user_id ?? user?.id ?? null;
}
