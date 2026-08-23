/**
 * Phase RW-2 — Owner QA relationship & workspace scenario client state.
 *
 * The server is the sole authority. All three RPCs are owner-only SECURITY
 * DEFINER functions that resolve the caller's registered QA fixture roots
 * themselves — no root id, user id, or scenario identity is ever supplied from
 * the browser, and no scenario state is ever persisted in localStorage or
 * sessionStorage. Returned state is a safe summary only: it can never contain
 * a UUID, email, token, or billing identifier.
 *
 * This hook touches no billing, Stripe, subscription, or Telegram surface.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useOwnerQaPersona } from '@/hooks/useOwnerQaPersona';

/** The exact RW-2 scenario vocabulary. No other scenario exists. */
export const OWNER_QA_RELATIONSHIP_SCENARIOS = [
  'assistant_none',
  'assistant_one',
  'assistant_many',
  'agency_owner_populated',
  'agency_admin',
  'agency_member',
  'recruiter_staff_one',
  'recruiter_admin_multi',
] as const;

export type OwnerQaRelationshipScenario =
  (typeof OWNER_QA_RELATIONSHIP_SCENARIOS)[number];

export function isOwnerQaRelationshipScenario(
  value: unknown,
): value is OwnerQaRelationshipScenario {
  return (
    typeof value === 'string' &&
    (OWNER_QA_RELATIONSHIP_SCENARIOS as readonly string[]).includes(value)
  );
}

/** Narrow typed RPC adapter (generated Supabase types are NOT regenerated). */
type ScenarioRpcClient = {
  rpc: (
    fn:
      | 'owner_qa_relationship_scenario_state'
      | 'owner_qa_apply_relationship_scenario'
      | 'owner_qa_clear_relationship_scenario',
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function getScenarioRpc(): Promise<ScenarioRpcClient> {
  const { supabase } = await import('@/integrations/supabase/client');
  return supabase as unknown as ScenarioRpcClient;
}

export interface OwnerQaRelationshipState {
  active: boolean;
  scenario: OwnerQaRelationshipScenario | null;
  assistantDriverCount: number;
  agencyRole: string | null;
  agencyPermissionCount: number;
  recruiterWorkspaceCount: number;
  recruiterRoles: string[];
}

function toInt(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

/**
 * Strict fail-closed parser. Anything unrecognised collapses to the inactive
 * shape rather than being surfaced as a scenario.
 */
export function parseOwnerQaRelationshipState(
  raw: unknown,
): OwnerQaRelationshipState | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>;
  if (!row || typeof row !== 'object') return null;

  const scenario = isOwnerQaRelationshipScenario(row.scenario)
    ? row.scenario
    : null;

  const roles = Array.isArray(row.recruiter_roles)
    ? row.recruiter_roles.filter((r): r is string => typeof r === 'string')
    : [];

  return {
    active: row.active === true && scenario !== null,
    scenario,
    assistantDriverCount: toInt(row.assistant_driver_count),
    agencyRole: typeof row.agency_role === 'string' ? row.agency_role : null,
    agencyPermissionCount: toInt(row.agency_permission_count),
    recruiterWorkspaceCount: toInt(row.recruiter_workspace_count),
    recruiterRoles: roles,
  };
}

/**
 * Query keys that actually exist in this codebase and are affected when the
 * synthetic relationship topology changes. Recruiter staff workspace hooks are
 * effect-based and refetch on mount, so nothing is invented for them.
 */
const AFFECTED_QUERY_KEYS: readonly string[] = [
  'managed-drivers',
  'my-assistants',
  'my-assistants-with-source',
  'my-agency',
  'agency-members',
  'agency-workspace-permissions',
  'agency-member-permissions',
];

export interface UseOwnerQaRelationshipScenarioResult {
  isOwner: boolean;
  state: OwnerQaRelationshipState | null;
  isLoading: boolean;
  isApplying: boolean;
  error: Error | null;
  apply: (
    scenario: OwnerQaRelationshipScenario,
  ) => Promise<OwnerQaRelationshipState | null>;
  clear: () => Promise<OwnerQaRelationshipState | null>;
  refetch: () => void;
}

export function useOwnerQaRelationshipScenario(): UseOwnerQaRelationshipScenarioResult {
  const { isOwner } = useOwnerQaPersona();

  // The Owner QA page is rendered inside the app provider tree, but this hook
  // must never hard-crash the owner surface if a query client is absent.
  let queryClient: QueryClient | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    queryClient = useQueryClient();
  } catch {
    queryClient = null;
  }

  const [state, setState] = useState<OwnerQaRelationshipState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
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
      setState(null);
      return;
    }
    setIsLoading(true);
    try {
      const client = await getScenarioRpc();
      const { data, error: rpcError } = await client.rpc(
        'owner_qa_relationship_scenario_state',
      );
      if (rpcError) throw new Error(rpcError.message);
      if (!mounted.current) return;
      setState(parseOwnerQaRelationshipState(data));
      setError(null);
    } catch (e) {
      if (mounted.current) {
        setState(null);
        setError(e as Error);
      }
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, [isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  const invalidateRelationshipCaches = useCallback(() => {
    if (!queryClient) return;
    for (const key of AFFECTED_QUERY_KEYS) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }, [queryClient]);

  const apply = useCallback(
    async (scenario: OwnerQaRelationshipScenario) => {
      if (!isOwnerQaRelationshipScenario(scenario)) {
        throw new Error('owner_qa_relationship_scenario_invalid');
      }
      setIsApplying(true);
      try {
        const client = await getScenarioRpc();
        const { data, error: rpcError } = await client.rpc(
          'owner_qa_apply_relationship_scenario',
          { _scenario: scenario },
        );
        if (rpcError) throw new Error(rpcError.message);
        const next = parseOwnerQaRelationshipState(
          (data as { state?: unknown } | null)?.state ?? data,
        );
        if (mounted.current) setState(next);
        invalidateRelationshipCaches();
        await load();
        return next;
      } finally {
        if (mounted.current) setIsApplying(false);
      }
    },
    [invalidateRelationshipCaches, load],
  );

  const clear = useCallback(async () => {
    setIsApplying(true);
    try {
      const client = await getScenarioRpc();
      const { data, error: rpcError } = await client.rpc(
        'owner_qa_clear_relationship_scenario',
      );
      if (rpcError) throw new Error(rpcError.message);
      const next = parseOwnerQaRelationshipState(
        (data as { state?: unknown } | null)?.state ?? data,
      );
      if (mounted.current) setState(next);
      invalidateRelationshipCaches();
      await load();
      return next;
    } finally {
      if (mounted.current) setIsApplying(false);
    }
  }, [invalidateRelationshipCaches, load]);

  return {
    isOwner,
    state,
    isLoading,
    isApplying,
    error,
    apply,
    clear,
    refetch: () => {
      void load();
    },
  };
}
