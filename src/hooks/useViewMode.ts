import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole, type UserRole } from '@/hooks/useUserRole';
import { useUserCapabilities } from '@/hooks/useUserCapabilities';
import {
  computeWorkspaceAccess,
  isWorkspaceAllowed,
  resolveInitialWorkspace,
  type WorkspaceRole,
} from '@/lib/workspaceAccess';
import type { UserCapabilitiesView, UserCapabilityRow } from '@/lib/userCapabilities';

const LEGACY_UNSCOPED_KEY = 'htp_view_mode';
const STORAGE_PREFIX = 'htp_view_mode:';

function scopedKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function readStored(key: string): WorkspaceRole | null {
  try {
    const v = localStorage.getItem(key);
    return v === 'driver' || v === 'recruiter' ? v : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, v: WorkspaceRole) {
  try { localStorage.setItem(key, v); } catch {}
}

function clearStored(key: string) {
  try { localStorage.removeItem(key); } catch {}
}

/**
 * Phase 1J-B1 — Capability-driven, user-bound view mode.
 *
 * Authorization comes exclusively from `useUserCapabilities`. `useUserRole`
 * is consulted ONLY for its `intended_role` hint (preferred initial
 * workspace when the account can enter both). `useAuth` is consulted ONLY
 * for the authenticated user id (to scope the stored preference) and auth
 * loading. Admin status is NOT an authorization signal — admin alone does
 * not grant recruiter workspace.
 *
 * Storage is bound to `htp_view_mode:<userId>`. The legacy unscoped
 * `htp_view_mode` key is proactively cleared on every mount and never
 * trusted. A signed-out session or a session with a capability error
 * always yields `effectiveRole = null`.
 *
 * Effect stability: the reconciliation effect depends on stable primitive
 * fields (`rows` reference from React Query, `preferredRole` string,
 * `userId` string, boolean flags) so unchanged capability data does not
 * re-trigger the effect.
 */
export function useViewMode() {
  const { user, loading: authLoading } = useAuth();
  const capabilities = useUserCapabilities();
  const { role: preferredRole, isLoading: roleLoading } = useUserRole();

  const userId = user?.id ?? null;
  const rows = capabilities.rows as readonly UserCapabilityRow[] | undefined;
  const hasError = !!capabilities.error;
  const isLoading =
    authLoading || capabilities.isLoading || roleLoading;

  // Stable trusted view: a plain object holding only the validated rows.
  // Every downstream consumer re-derives access from these rows.
  const trustedView = useMemo<UserCapabilitiesView | null>(() => {
    if (hasError || !rows) return null;
    return { rows: rows as UserCapabilityRow[] } as UserCapabilitiesView;
  }, [rows, hasError]);

  const decisions = useMemo(
    () => computeWorkspaceAccess(trustedView),
    [trustedView],
  );

  const [viewMode, setViewModeState] = useState<WorkspaceRole | null>(null);

  // Legacy unscoped key must never be trusted; clear it once on mount and
  // whenever the effect runs (cheap, idempotent).
  useEffect(() => {
    try { localStorage.removeItem(LEGACY_UNSCOPED_KEY); } catch {}
  }, []);

  useEffect(() => {
    if (isLoading) return;
    // No user id → fail closed and never persist or read a preference.
    if (!userId) {
      setViewModeState(null);
      return;
    }
    // Capability error → fail closed. Do not fall back to prior data.
    if (!trustedView) {
      setViewModeState(null);
      return;
    }
    const key = scopedKey(userId);
    const stored = readStored(key);
    const { workspace, shouldClearStoredPreference } = resolveInitialWorkspace(
      trustedView,
      {
        preferredRole: (preferredRole as WorkspaceRole | null) ?? null,
        storedPreference: stored,
      },
    );
    if (shouldClearStoredPreference) clearStored(key);
    setViewModeState(workspace);
  }, [isLoading, trustedView, userId, preferredRole]);

  const setViewMode = useCallback(
    (next: WorkspaceRole) => {
      if (!userId) return;
      if (!isWorkspaceAllowed(trustedView, next)) return;
      setViewModeState(next);
      writeStored(scopedKey(userId), next);
    },
    [userId, trustedView],
  );

  const effectiveRole: WorkspaceRole | null = viewMode;

  return {
    effectiveRole,
    viewMode: effectiveRole,
    setViewMode,
    canSwitch: decisions.switcherAvailable,
    isLoading,
    error: capabilities.error ?? null,
    driverWorkspaceAllowed: decisions.driverWorkspaceAllowed,
    recruiterHubAllowed: decisions.recruiterHubAllowed,
    recruiterOperationsAllowed: decisions.recruiterOperationsAllowed,
    driverCapabilityStatus: decisions.driverCapabilityStatus,
    recruiterCapabilityStatus: decisions.recruiterCapabilityStatus,
  };
}

// Re-export UserRole type for backward compatibility with any callers
// that imported it from this module.
export type { UserRole };
