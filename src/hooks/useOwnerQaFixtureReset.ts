/**
 * Phase TG-2E3-O13 — Owner QA fixture reset client state.
 *
 * The server is the source of truth. Both RPCs are owner-only SECURITY DEFINER
 * functions that resolve the caller's registered QA fixture roots themselves —
 * no root or row identifier is ever supplied from the browser. There is no
 * billing, Stripe, Telegram, or email call on this path.
 *
 * Deliberately dependency-free (no query client) so the owner-only page keeps
 * its existing render contract.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [preview, setPreview] = useState<OwnerQaResetSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    // Fail closed: never queried unless a resolved super_admin.
    if (!isOwner) {
      setPreview(null);
      return;
    }
    setIsLoading(true);
    try {
      const { data, error: rpcError } = await resetRpc.rpc(
        'owner_qa_fixture_reset_preview',
      );
      if (rpcError) throw new Error(rpcError.message);
      if (!mounted.current) return;
      setPreview(toSummary(data));
      setError(null);
    } catch (e) {
      if (mounted.current) setError(e as Error);
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, [isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = useCallback(async (): Promise<OwnerQaResetSummary | null> => {
    setIsResetting(true);
    try {
      const { data, error: rpcError } = await resetRpc.rpc('owner_qa_fixture_reset');
      if (rpcError) throw new Error(rpcError.message);
      const summary = toSummary(data);
      await load();
      return summary;
    } finally {
      if (mounted.current) setIsResetting(false);
    }
  }, [load]);

  return {
    isOwner,
    preview,
    isLoading,
    isResetting,
    error,
    reset,
    refetch: () => {
      void load();
    },
  };
}
