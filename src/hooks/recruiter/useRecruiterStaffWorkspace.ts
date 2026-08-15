/**
 * Phase RC-1C — Recruiter STAFF workspace discovery + selection hook.
 *
 * Reads ONLY the new `get_my_recruiter_staff_workspaces` RPC. No
 * permissions query, no billing/profile/opportunity/application query.
 * localStorage holds a user-scoped PREFERENCE only; every selection is
 * revalidated against the current server rows through the pure resolver.
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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

  const query = useQuery({
    queryKey: ['recruiter-staff-workspaces', userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<unknown> => {
      const { data, error } = await (supabase as any).rpc(
        'get_my_recruiter_staff_workspaces',
      );
      if (error) throw error;
      return data;
    },
  });

  const isLoading = authLoading || (!!userId && query.isLoading);

  const resolution = useMemo(() => {
    if (!userId) return null;
    if (isLoading) return null;
    if (query.error) return null;
    const inMemory = selection && selection.userId === userId ? selection.recruiterId : null;
    const stored = inMemory ?? readStored(userId);
    return resolveRecruiterStaffWorkspace(query.data, stored);
  }, [userId, isLoading, query.error, query.data, selection]);

  // Reconcile stored preference against the CURRENT validated rows.
  // This is housekeeping only; access is decided synchronously above.
  if (userId && resolution && 'shouldClearStoredSelection' in resolution) {
    if (resolution.shouldClearStoredSelection) {
      clearStored(userId);
    }
  }

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
