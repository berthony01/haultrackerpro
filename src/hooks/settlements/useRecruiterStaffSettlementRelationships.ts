/**
 * Phase RC-1I — recruiter STAFF settlement relationship resolution hook.
 *
 * Reads ONLY the RC-1I SECURITY DEFINER RPC
 * `list_recruiter_staff_settlement_relationships(_recruiter_id)`, which itself
 * requires the RC-1B `settlements_view` permission on an ACTIVE, non-owner
 * membership of a standalone paid recruiter workspace. This hook performs NO
 * authorization of its own — PostgreSQL is the sole authority. Client state is
 * UX only.
 *
 * Fail closed: loading, error, or a malformed payload => empty relationship
 * list.
 *
 * ARCHITECTURE NOTE — intentional compatibility deviation (same as RC-1C
 * `useRecruiterStaffWorkspace` and RC-1D `useRecruiterStaffPermissions`): a
 * generation-guarded `useEffect` fetch is used instead of React Query because
 * the recruiter shell is mounted by existing consumers/tests without a
 * `QueryClientProvider`. Resolution is strictly scoped to the authenticated
 * user AND the recruiter workspace.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface RecruiterStaffSettlementRelationship {
  id: string;
  recruiterId: string;
  driverUserId: string;
  status: string;
  acceptedAt: string | null;
  createdAt: string | null;
}

// Narrow local adapter — generated types are not edited here.
type ListStaffRelationshipsRpc = (
  fn: 'list_recruiter_staff_settlement_relationships',
  args: { _recruiter_id: string },
) => PromiseLike<{ data: unknown; error: unknown }>;

const callListStaffRelationships = supabase.rpc.bind(
  supabase,
) as unknown as ListStaffRelationshipsRpc;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Strict, fail-closed row parser. A single malformed row invalidates the whole
 * payload — rows are never silently filtered.
 */
export function parseRecruiterStaffSettlementRelationships(
  payload: unknown,
  recruiterId: string,
): RecruiterStaffSettlementRelationship[] | null {
  if (!Array.isArray(payload)) return null;
  const out: RecruiterStaffSettlementRelationship[] = [];
  for (const row of payload) {
    if (!isPlainObject(row)) return null;
    if (
      !isNonEmptyString(row.id) ||
      !isNonEmptyString(row.recruiter_id) ||
      !isNonEmptyString(row.driver_user_id) ||
      !isNonEmptyString(row.status)
    ) {
      return null;
    }
    // Defense in depth: the server already scopes by workspace.
    if (row.recruiter_id !== recruiterId) return null;
    if (row.status !== 'active') return null;
    out.push({
      id: row.id,
      recruiterId: row.recruiter_id,
      driverUserId: row.driver_user_id,
      status: row.status,
      acceptedAt: nullableString(row.accepted_at),
      createdAt: nullableString(row.created_at),
    });
  }
  return out;
}

export interface RecruiterStaffSettlementRelationshipsState {
  relationships: RecruiterStaffSettlementRelationship[];
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

interface Resolved {
  userId: string;
  recruiterId: string;
  relationships: RecruiterStaffSettlementRelationship[] | null;
  error: unknown;
}

export function useRecruiterStaffSettlementRelationships(
  recruiterId: string | null | undefined,
  enabled: boolean,
): RecruiterStaffSettlementRelationshipsState {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const id = recruiterId ?? null;
  const active = !!userId && !!id && enabled;

  const requestRef = useRef(0);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(active);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    requestRef.current += 1;
    const generation = requestRef.current;

    if (!userId || !id || !enabled) {
      setResolved(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let cancelled = false;

    void (async () => {
      let payload: unknown = null;
      let error: unknown = null;
      try {
        const resp = await callListStaffRelationships(
          'list_recruiter_staff_settlement_relationships',
          { _recruiter_id: id },
        );
        if (resp.error) error = new Error('Unable to load settlement drivers.');
        else payload = resp.data;
      } catch {
        error = new Error('Unable to load settlement drivers.');
      }
      if (cancelled || generation !== requestRef.current) return;

      const parsed = error
        ? null
        : parseRecruiterStaffSettlementRelationships(payload, id);
      setResolved({
        userId,
        recruiterId: id,
        relationships: parsed,
        error:
          error ?? (parsed ? null : new Error('Unable to load settlement drivers.')),
      });
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, id, enabled, reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const scoped =
    resolved && resolved.userId === userId && resolved.recruiterId === id
      ? resolved
      : null;
  const relationships =
    scoped && !scoped.error && scoped.relationships ? scoped.relationships : [];

  return {
    relationships,
    isLoading: active && isLoading,
    error: scoped?.error ?? null,
    refetch,
  };
}
