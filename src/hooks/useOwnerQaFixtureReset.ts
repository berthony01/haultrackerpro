/**
 * Phase TG-2E3-O13 — Owner QA fixture reset client state.
 *
 * The server is the source of truth. Both RPCs are owner-only SECURITY DEFINER
 * functions that resolve the caller's registered QA fixture roots themselves —
 * no root or row identifier is ever supplied from the browser. There is no
 * billing, Stripe, Telegram, or email call on this path.
 */

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOwnerQaPersona } from '@/hooks/useOwnerQaPersona';

/** Narrow typed RPC adapter (generated types are not regenerated for candidates). */
type ResetRpcClient = {
  rpc: (
    fn: 'owner_qa_fixture_reset_preview' | 'owner_qa_fixture_reset',
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const resetRpc = supabase as unknown as ResetRpcClient;

export const OWNER_QA_RESET_PREVIEW_KEY = ['owner-qa-fixture-reset-preview'] as const;

export const OWNER_QA_RESET_CATEGORIES = [
  'carrier_relationships',
  'assistant_relationships',
  'agency_delegations',
  'driver_profiles',
  'loads',
  'expenses',
  'fuel_logs',
  'applications',
  'application_events',
  'referrals',
  'agency_work_items',
  'settlements',
  'settlement_items',
  'settlement_matches',
  'notifications',
  'lane_stats',
  'broker_stats',
  'operating_metrics',
] as const;

export type OwnerQaResetCategory = (typeof OWNER_QA_RESET_CATEGORIES)[number];

export interface OwnerQaResetSummary {
  counts: Record<OwnerQaResetCategory, number>;
  totalRows: number;
  rootsIntact: boolean;
}

function toSummary(raw: unknown): OwnerQaResetSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>;
  if (!row || typeof row !== 'object') return null;
  const counts = {} as Record<OwnerQaResetCategory, number>;
  for (const key of OWNER_QA_RESET_CATEGORIES) {
    const n = Number(row[key] ?? 0);
    counts[key] = Number.isFinite(n) ? n : 0;
  }
  const total = Number(row.total_rows ?? 0);
  return {
    counts,
    totalRows: Number.isFinite(total) ? total : 0,
    rootsIntact: row.roots_intact !== false,
  };
}

export interface UseOwnerQaFixtureResetResult {
  isOwner: boolean;
  preview: OwnerQaResetSummary | null;
  isLoading: boolean;
  isResetting: boolean;
  error: Error | null;
  reset: () => Promise<OwnerQaResetSummary | null>;
  refetch: () => void;
}

export function useOwnerQaFixtureReset(): UseOwnerQaFixtureResetResult {
  const { isOwner } = useOwnerQaPersona();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: OWNER_QA_RESET_PREVIEW_KEY,
    // Fail closed: never queried unless a resolved super_admin.
    enabled: isOwner,
    staleTime: 15_000,
    queryFn: async (): Promise<OwnerQaResetSummary | null> => {
      const { data, error } = await resetRpc.rpc('owner_qa_fixture_reset_preview');
      if (error) throw new Error(error.message);
      return toSummary(data);
    },
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<OwnerQaResetSummary | null> => {
      const { data, error } = await resetRpc.rpc('owner_qa_fixture_reset');
      if (error) throw new Error(error.message);
      return toSummary(data);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: OWNER_QA_RESET_PREVIEW_KEY });
    },
  });

  const reset = useCallback(async () => mutation.mutateAsync(), [mutation]);

  const preview = useMemo(
    () => (isOwner ? (query.data ?? null) : null),
    [isOwner, query.data],
  );

  return {
    isOwner,
    preview,
    isLoading: isOwner ? query.isLoading : false,
    isResetting: mutation.isPending,
    error: ((query.error ?? mutation.error) as Error | null) ?? null,
    reset,
    refetch: () => {
      void query.refetch();
    },
  };
}
