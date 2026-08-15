/**
 * Phase RC-1C — Recruiter STAFF workspace discovery + selection hook.
 *
 * Reads ONLY the new `get_my_recruiter_staff_workspaces` RPC. No
 * permissions query, no billing/profile/opportunity/application query.
 * localStorage holds a user-scoped PREFERENCE only; every selection is
 * revalidated against the current server rows through the pure resolver.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  recruiterStaffWorkspaceStorageKey,
  resolveRecruiterStaffWorkspace,
  type RecruiterStaffWorkspace,
} from '@/lib/recruiterStaffWorkspaceResolution';

function readStored(userId: string): string | null {
  try {
    const v = localStorage.getItem(recruiterStaffWorkspaceStorageKey(userId));
    return typeof v === 'string' && v.trim().length > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeStored(userId: string, recruiterId: string) {
  try {
    localStorage.setItem(recruiterStaffWorkspaceStorageKey(userId), recruiterId);
  } catch { /* preference only */ }
}

function clearStored(userId: string) {
  try {
    localStorage.removeItem(recruiterStaffWorkspaceStorageKey(userId));
  } catch { /* preference only */ }
}

export interface UseRecruiterStaffWorkspaceResult {
  workspaces: RecruiterStaffWorkspace[];
  selectedWorkspace: RecruiterStaffWorkspace | null;
  requiresSelection: boolean;
  isLoading: boolean;
  error: Error | null;
  selectWorkspace: (recruiterId: string) => void;
  clearSelection: () => void;
}

export function useRecruiterStaffWorkspace(): UseRecruiterStaffWorkspaceResult {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;

  // In-memory selection is scoped to the user it was made for so a user
  // change can never leak the previous user's workspace context.
  const [selection, setSelection] = useState<{ userId: string; recruiterId: string } | null>(null);

  // Self-contained fetch (no react-query dependency) so this hook can be
  // consumed by `useViewMode` anywhere in the shell. Every response is
  // bound to the user id it was requested for.
  const [query, setQuery] = useState<{
    userId: string | null;
    data: unknown;
    error: unknown;
    loading: boolean;
  }>({ userId: null, data: null, error: null, loading: false });
  const requestRef = useRef(0);

  useEffect(() => {
    // Invalidate any in-flight request FIRST, on every run (including the
    // logout / no-user path) so a stale response can never commit state.
    const generation = ++requestRef.current;
    if (!userId) {
      setQuery({ userId: null, data: null, error: null, loading: false });
      return;
    }
    setQuery({ userId, data: null, error: null, loading: true });
    void (async () => {
      try {
        const { data, error } = await rpcGetMyRecruiterStaffWorkspaces();
        if (requestRef.current !== generation) return;
        if (error) {
          setQuery({ userId, data: null, error, loading: false });
          return;
        }
        setQuery({ userId, data, error: null, loading: false });
      } catch (e) {
        if (requestRef.current !== generation) return;
        setQuery({ userId, data: null, error: e, loading: false });
      }
    })();
  }, [userId]);

  // Never expose another user's payload.
  const payload = query.userId === userId ? query.data : null;

  const isLoading = authLoading || (!!userId && (query.loading || query.userId !== userId));

  const resolution = useMemo(() => {
    if (!userId) return null;
    if (isLoading) return null;
    if (query.error) return null;
    const inMemory = selection && selection.userId === userId ? selection.recruiterId : null;
    const stored = inMemory ?? readStored(userId);
    return resolveRecruiterStaffWorkspace(payload, stored);
  }, [userId, isLoading, query.error, payload, selection]);

  // Reconcile stored preference against the CURRENT validated rows.
  // Housekeeping ONLY, and never during render; access is decided
  // synchronously by the resolver above.
  const shouldClearStored =
    !!resolution && 'shouldClearStoredSelection' in resolution
      ? resolution.shouldClearStoredSelection
      : false;
  useEffect(() => {
    if (!userId) return;
    if (!shouldClearStored) return;
    clearStored(userId);
  }, [userId, shouldClearStored]);

  const workspaces: RecruiterStaffWorkspace[] = useMemo(() => {
    if (!resolution || resolution.kind === 'invalid') return [];
    return resolution.workspaces as RecruiterStaffWorkspace[];
  }, [resolution]);

  const selectWorkspace = useCallback(
    (recruiterId: string) => {
      if (!userId) return;
      const match = workspaces.find(w => w.recruiterId === recruiterId);
      if (!match) return; // never accept an id outside current validated rows
      writeStored(userId, match.recruiterId);
      setSelection({ userId, recruiterId: match.recruiterId });
    },
    [userId, workspaces],
  );

  const clearSelection = useCallback(() => {
    if (!userId) return;
    clearStored(userId);
    setSelection(null);
  }, [userId]);

  const staffError: Error | null = useMemo(() => {
    if (query.error) {
      return query.error instanceof Error ? query.error : new Error(String(query.error));
    }
    if (resolution?.kind === 'invalid') {
      return new Error(`Recruiter workspace data invalid (${resolution.reason})`);
    }
    return null;
  }, [query.error, resolution]);

  return {
    workspaces,
    selectedWorkspace: resolution?.kind === 'selected' ? resolution.selected : null,
    requiresSelection: resolution?.kind === 'selection_required',
    isLoading,
    error: staffError,
    selectWorkspace,
    clearSelection,
  };
}
