import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUserRole, type UserRole } from '@/hooks/useUserRole';
import { useUserCapabilities } from '@/hooks/useUserCapabilities';
import {
  computeWorkspaceAccess,
  isWorkspaceAllowed,
  resolveInitialWorkspace,
  type WorkspaceRole,
} from '@/lib/workspaceAccess';

const STORAGE_KEY = 'htp_view_mode';

function readStored(): WorkspaceRole | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'driver' || v === 'recruiter' ? v : null;
  } catch {
    return null;
  }
}

function writeStored(v: WorkspaceRole) {
  try { localStorage.setItem(STORAGE_KEY, v); } catch {}
}

function clearStored() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

/**
 * Phase 1J-B1 — Capability-driven view mode.
 *
 * Authorization comes exclusively from `useUserCapabilities`. `useUserRole`
 * is consulted ONLY for its `intended_role` hint (preferred initial
 * workspace when the account can enter both). Admin status is NOT an
 * authorization signal here — admin alone does not grant recruiter
 * workspace. localStorage stores a preference; it never grants access.
 */
export function useViewMode() {
  const capabilities = useUserCapabilities();
  const { role: preferredRole, isLoading: roleLoading } = useUserRole();
  const decisions = useMemo(() => computeWorkspaceAccess(capabilities), [capabilities]);

  const isLoading = capabilities.isLoading || roleLoading;
  const error = capabilities.error ?? null;

  const [viewMode, setViewModeState] = useState<WorkspaceRole | null>(null);

  useEffect(() => {
    if (isLoading) return;
    const stored = readStored();
    const { workspace, shouldClearStoredPreference } = resolveInitialWorkspace(
      capabilities,
      { preferredRole: preferredRole as WorkspaceRole | null, storedPreference: stored },
    );
    if (shouldClearStoredPreference) clearStored();
    setViewModeState(workspace);
  }, [isLoading, capabilities, preferredRole]);

  const setViewMode = useCallback(
    (next: WorkspaceRole) => {
      if (!isWorkspaceAllowed(capabilities, next)) return;
      setViewModeState(next);
      writeStored(next);
    },
    [capabilities],
  );

  const effectiveRole: UserRole =
    (viewMode ?? decisions.allowedFallbackWorkspace ?? 'driver') as UserRole;

  return {
    effectiveRole,
    viewMode: effectiveRole,
    setViewMode,
    canSwitch: decisions.switcherAvailable,
    isLoading,
    error,
    driverWorkspaceAllowed: decisions.driverWorkspaceAllowed,
    recruiterHubAllowed: decisions.recruiterHubAllowed,
    recruiterOperationsAllowed: decisions.recruiterOperationsAllowed,
    driverCapabilityStatus: decisions.driverCapabilityStatus,
    recruiterCapabilityStatus: decisions.recruiterCapabilityStatus,
  };
}
