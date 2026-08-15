import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole, type UserRole } from '@/hooks/useUserRole';
import { useUserCapabilities } from '@/hooks/useUserCapabilities';
import { useRecruiterStaffWorkspace } from '@/hooks/recruiter/useRecruiterStaffWorkspace';
import {
  computeWorkspaceAccess,
  type WorkspaceRole,
} from '@/lib/workspaceAccess';
import type { UserCapabilitiesView, UserCapabilityRow } from '@/lib/userCapabilities';

const LEGACY_UNSCOPED_KEY = 'htp_view_mode';
const STORAGE_PREFIX = 'htp_view_mode:';
/** Phase 1S-A8 — transient, one-shot workspace choice hint written by
 *  `/auth` and `/start`. Preference ONLY: never grants capability access. */
const WORKSPACE_INTENT_KEY = 'htp_workspace_intent';

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

/** Read the transient workspace intent. Only `driver`/`recruiter` are
 *  accepted; anything else (including a forged value) is treated as null. */
function readWorkspaceIntent(): WorkspaceRole | null {
  try {
    const v = sessionStorage.getItem(WORKSPACE_INTENT_KEY);
    return v === 'driver' || v === 'recruiter' ? v : null;
  } catch {
    return null;
  }
}

function clearWorkspaceIntent() {
  try { sessionStorage.removeItem(WORKSPACE_INTENT_KEY); } catch {}
}


/**
 * Phase 1J-B1 — Capability-driven, user-bound view mode with a
 * synchronous render-time access gate.
 *
 * `effectiveRole` is derived synchronously on every render from the
 * currently validated capability view. It is non-null only when all of
 * these hold on THIS render:
 *   - auth, capability, and role are not loading
 *   - an authenticated `user.id` is present
 *   - no capability error
 *   - the current selection (in-memory or scoped storage) is allowed by
 *     the validated capability rows
 * Otherwise `effectiveRole` is `null` immediately, before any effect
 * runs. A reconciliation effect may still persist/clear the scoped
 * storage preference and normalize in-memory state to the next allowed
 * workspace, but it is NEVER the sole access guard.
 *
 * Storage is bound to `htp_view_mode:<userId>`. The legacy unscoped
 * `htp_view_mode` key is proactively cleared and never trusted. Admin
 * status is NOT an authorization signal.
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

  // In-memory selection tracks explicit switches only. It is validated
  // synchronously on every render against `trustedView` before being
  // exposed as `effectiveRole`.
  const [selection, setSelection] = useState<WorkspaceRole | null>(null);

  // Legacy unscoped key must never be trusted; clear it once on mount.
  useEffect(() => {
    try { localStorage.removeItem(LEGACY_UNSCOPED_KEY); } catch {}
  }, []);

  // -------------------------------------------------------------------
  // SYNCHRONOUS render-time access gate.
  // No effect has run yet. This is the source of truth for consumers.
  // -------------------------------------------------------------------
  const effectiveRole: WorkspaceRole | null = useMemo(() => {
    if (isLoading) return null;
    if (!userId) return null;
    if (!trustedView) return null;

    // Transient one-shot workspace intent (explicit Driver/Recruiter
    // choice on /auth or /start) takes precedence over stored preference
    // and preferredRole — but ONLY when the CURRENT validated capability
    // rows allow it. A forged/stale intent grants nothing.
    const intent = readWorkspaceIntent();
    if (intent && isWorkspaceAllowed(trustedView, intent)) {
      return intent;
    }

    // Honor an explicit in-memory selection only if it is still allowed
    // by the CURRENT validated rows (not last render's rows).
    if (selection && isWorkspaceAllowed(trustedView, selection)) {
      return selection;
    }

    // Otherwise resolve from scoped stored preference + preferred role
    // hint. `resolveInitialWorkspace` fails closed and never synthesizes
    // driver when no capability exists.
    const stored = readStored(scopedKey(userId));
    return resolveInitialWorkspace(trustedView, {
      preferredRole: (preferredRole as WorkspaceRole | null) ?? null,
      storedPreference: stored,
    }).workspace;
  }, [isLoading, userId, trustedView, selection, preferredRole]);

  // Reconciliation effect: persist/clear scoped storage and normalize
  // in-memory selection to the currently effective role. This runs
  // AFTER render and is never the access guard.
  useEffect(() => {
    if (isLoading) return;
    if (!userId) {
      if (selection !== null) setSelection(null);
      return;
    }
    if (!trustedView) {
      if (selection !== null) setSelection(null);
      return;
    }
    const key = scopedKey(userId);

    // Consume the transient workspace intent exactly once, after
    // capabilities have resolved. Allowed → persist + normalize.
    // Rejected → discard silently and fall through to existing behavior.
    const intent = readWorkspaceIntent();
    if (intent) {
      clearWorkspaceIntent();
      if (isWorkspaceAllowed(trustedView, intent)) {
        writeStored(key, intent);
        if (selection !== intent) setSelection(intent);
        return;
      }
    }

    const stored = readStored(key);
    if (stored && !isWorkspaceAllowed(trustedView, stored)) {
      clearStored(key);
    }
    // Drop any stale selection that is no longer allowed.
    if (selection && !isWorkspaceAllowed(trustedView, selection)) {
      setSelection(null);
    }
  }, [isLoading, userId, trustedView, selection]);


  const setViewMode = useCallback(
    (next: WorkspaceRole) => {
      if (!userId) return;
      if (!trustedView) return;
      if (!isWorkspaceAllowed(trustedView, next)) return;
      setSelection(next);
      writeStored(scopedKey(userId), next);
    },
    [userId, trustedView],
  );

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
