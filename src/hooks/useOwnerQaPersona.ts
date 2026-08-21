/**
 * Phase TG-2E3-O2 — Owner QA Mode client state.
 *
 * The server is the source of truth: `current_owner_qa_persona()` returns the
 * caller's active QA session (super-admin only, unexpired, enabled) and
 * NOTHING otherwise. There is no browser persistence — no localStorage, no
 * sessionStorage — because the server gates must agree with the UI.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAdmin } from '@/hooks/useAdmin';
import {
  isValidOwnerQaSelection,
  ownerQaPersonaLabel,
  type OwnerQaDomain,
  type OwnerQaPersona,
  type OwnerQaPersonaSelection,
} from '@/lib/billing/ownerQaPersona';

/**
 * Narrow typed RPC adapter. Generated Supabase types are intentionally NOT
 * regenerated in the candidate phase (same pattern as the TG-2E3 Telegram
 * link hook), so the three QA RPCs are called through a local cast.
 */
type QaRpcClient = {
  rpc: (
    fn: 'current_owner_qa_persona' | 'set_owner_qa_persona' | 'disable_owner_qa_persona',
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const qaRpc = supabase as unknown as QaRpcClient;

export const OWNER_QA_QUERY_KEY = ['owner-qa-persona'] as const;

interface QaSessionRow {
  domain: string;
  persona: string;
  expires_at: string;
}

export interface UseOwnerQaPersonaResult {
  /** True only for a resolved super_admin. */
  isOwner: boolean;
  /** True when the server reports an active, unexpired QA session. */
  isActive: boolean;
  domain: OwnerQaDomain | null;
  persona: OwnerQaPersona | null;
  label: string | null;
  expiresAt: string | null;
  selection: OwnerQaPersonaSelection | null;
  isLoading: boolean;
  isMutating: boolean;
  error: Error | null;
  setPersona: (domain: OwnerQaDomain, persona: OwnerQaPersona) => Promise<void>;
  disable: () => Promise<void>;
  refetch: () => void;
}

export function useOwnerQaPersona(): UseOwnerQaPersonaResult {
  const { user } = useAuth();
  const { role, isLoading: adminLoading } = useAdmin();
  const qc = useQueryClient();

  const isOwner = !!user && !adminLoading && role === 'super_admin';

  const query = useQuery({
    queryKey: OWNER_QA_QUERY_KEY,
    // Fail closed: never queried unless a resolved super_admin.
    enabled: isOwner,
    staleTime: 15_000,
    queryFn: async (): Promise<QaSessionRow | null> => {
      const { data, error } = await qaRpc.rpc('current_owner_qa_persona');
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as QaSessionRow | null;
    },
  });

  const row = isOwner ? (query.data ?? null) : null;

  const selection: OwnerQaPersonaSelection | null = useMemo(() => {
    if (!row) return null;
    if (!isValidOwnerQaSelection(row.domain, row.persona)) return null;
    if (!row.expires_at || new Date(row.expires_at).getTime() <= Date.now()) {
      return null;
    }
    return {
      domain: row.domain as OwnerQaDomain,
      persona: row.persona as OwnerQaPersona,
    };
  }, [row]);

  const invalidateEntitlements = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: OWNER_QA_QUERY_KEY });
    await qc.invalidateQueries({ queryKey: ['agency-entitlement'] });
    await qc.invalidateQueries({ queryKey: ['recruiter-billing'] });
  }, [qc]);

  const setMutation = useMutation({
    mutationFn: async (next: OwnerQaPersonaSelection) => {
      if (!isValidOwnerQaSelection(next.domain, next.persona)) {
        throw new Error('owner_qa_persona_invalid');
      }
      const { error } = await qaRpc.rpc('set_owner_qa_persona', {
        _domain: next.domain,
        _persona: next.persona,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidateEntitlements,
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      const { error } = await qaRpc.rpc('disable_owner_qa_persona');
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidateEntitlements,
  });

  // Auto-expiry: refetch exactly when the session lapses so the banner and
  // every entitlement consumer revert without a page reload.
  useEffect(() => {
    if (!selection || !row?.expires_at) return;
    const ms = new Date(row.expires_at).getTime() - Date.now();
    if (ms <= 0 || !Number.isFinite(ms)) return;
    const timer = window.setTimeout(() => {
      void invalidateEntitlements();
    }, Math.min(ms + 1_000, 2_147_483_000));
    return () => window.clearTimeout(timer);
  }, [selection, row?.expires_at, invalidateEntitlements]);

  const setPersona = useCallback(
    async (domain: OwnerQaDomain, persona: OwnerQaPersona) => {
      await setMutation.mutateAsync({ domain, persona });
    },
    [setMutation],
  );

  const disable = useCallback(async () => {
    await disableMutation.mutateAsync();
  }, [disableMutation]);

  return {
    isOwner,
    isActive: !!selection,
    domain: selection?.domain ?? null,
    persona: selection?.persona ?? null,
    label: selection
      ? ownerQaPersonaLabel(selection.domain, selection.persona)
      : null,
    expiresAt: selection ? (row?.expires_at ?? null) : null,
    selection,
    isLoading: isOwner ? query.isLoading : false,
    isMutating: setMutation.isPending || disableMutation.isPending,
    error:
      ((query.error ?? setMutation.error ?? disableMutation.error) as
        | Error
        | null) ?? null,
    setPersona,
    disable,
    refetch: () => {
      void query.refetch();
    },
  };
}
