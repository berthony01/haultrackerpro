import { useCallback, useEffect, useState } from 'react';
import { useUserRole, UserRole } from '@/hooks/useUserRole';

const STORAGE_KEY = 'htp_view_mode';

function readStored(): UserRole | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'driver' || v === 'recruiter' ? v : null;
  } catch {
    return null;
  }
}

/**
 * View-mode hook for accounts that can legitimately render both the driver
 * and recruiter UI (today: admins). For everyone else `effectiveRole` is
 * pinned to the real role from `useUserRole` so localStorage tampering can
 * never grant cross-role access.
 *
 * canSwitch is intentionally limited to `isAdmin`. We do not yet have a
 * `driver_profiles` table to *confirm* a non-admin is genuinely dual-role,
 * and the plan's safeguard #1 forbids inferring it from load activity.
 */
export function useViewMode() {
  const { role, isAdmin, isLoading: roleLoading } = useUserRole();
  const canSwitch = !!isAdmin;

  const [viewMode, setViewModeState] = useState<UserRole>(() => {
    return readStored() ?? 'driver';
  });

  // When auth/role finishes loading, reconcile the stored value against
  // what the user is actually allowed to see.
  useEffect(() => {
    if (roleLoading) return;
    if (!canSwitch) {
      // Non-switchable users: force to real role and clear any stale flag.
      setViewModeState(role);
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      return;
    }
    const stored = readStored();
    if (stored) {
      setViewModeState(stored);
    } else {
      // First time for an admin: default to driver view.
      setViewModeState('driver');
    }
  }, [roleLoading, canSwitch, role]);

  const setViewMode = useCallback((next: UserRole) => {
    if (!canSwitch) return;
    setViewModeState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  }, [canSwitch]);

  // Safety net: if a non-switchable user somehow has a divergent viewMode
  // (e.g. mid-render before the effect runs), force the real role.
  const effectiveRole: UserRole = canSwitch ? viewMode : role;

  return {
    effectiveRole,
    viewMode: effectiveRole,
    setViewMode,
    canSwitch,
    isLoading: roleLoading,
  };
}
