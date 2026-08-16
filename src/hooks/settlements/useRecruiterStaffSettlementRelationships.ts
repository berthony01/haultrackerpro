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
 * Fail closed: the query is only enabled for an authenticated user + a
 * recruiter workspace id + an explicit `canViewSettlements === true`. A
 * malformed payload throws an unavailable state; rows are NEVER silently
 * skipped or fabricated.
 *
 * Uses React Query. No `.from()` table read, no profile / billing / Agency /
 * application / driver-profile hook, no storage of any kind.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface RecruiterStaffSettlementRelationship {
  relationshipId: string;
  driverUserId: string;
  driverName: string;
  invitedAt: string;
  acceptedAt: string | null;
}

/** Exact — and only — row keys the safe RPC is allowed to return. */
export const RECRUITER_STAFF_SETTLEMENT_RELATIONSHIP_ROW_KEYS = [
  'relationship_id',
  'driver_user_id',
  'driver_name',
  'invited_at',
  'accepted_at',
] as const;

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

/**
 * Strict, fail-closed row parser. Returns null for ANY deviation: a non-array
 * payload, a non-plain-object row, a missing key, an unknown extra key, or a
 * value of the wrong type. A single malformed row invalidates the whole
 * payload — rows are never silently filtered.
 */
export function parseRecruiterStaffSettlementRelationships(
  payload: unknown,
): RecruiterStaffSettlementRelationship[] | null {
  if (!Array.isArray(payload)) return null;
  const out: RecruiterStaffSettlementRelationship[] = [];
  for (const row of payload) {
    if (!isPlainObject(row)) return null;

    const keys = Object.keys(row);
    if (keys.length !== RECRUITER_STAFF_SETTLEMENT_RELATIONSHIP_ROW_KEYS.length) {
      return null;
    }
    for (const key of keys) {
      if (
        !(RECRUITER_STAFF_SETTLEMENT_RELATIONSHIP_ROW_KEYS as readonly string[]).includes(
          key,
        )
      ) {
        return null;
      }
    }
    for (const key of RECRUITER_STAFF_SETTLEMENT_RELATIONSHIP_ROW_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(row, key)) return null;
    }

    if (
      !isNonEmptyString(row.relationship_id) ||
      !isNonEmptyString(row.driver_user_id) ||
      !isNonEmptyString(row.driver_name) ||
      !isNonEmptyString(row.invited_at)
    ) {
      return null;
    }
    const acceptedAt = row.accepted_at;
    if (!(acceptedAt === null || typeof acceptedAt === 'string')) {
      return null;
    }

    out.push({
      relationshipId: row.relationship_id,
      driverUserId: row.driver_user_id,
      driverName: row.driver_name,
      invitedAt: row.invited_at,
      acceptedAt,
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

export function useRecruiterStaffSettlementRelationships(
  recruiterId: string | null | undefined,
  canViewSettlements: boolean,
): RecruiterStaffSettlementRelationshipsState {
  const { user } = useAuth();
  const id = recruiterId ?? null;
  const enabled = !!user?.id && !!id && canViewSettlements === true;

  const query = useQuery({
    queryKey: ['recruiter_staff_settlement_relationships', user?.id, id],
    enabled,
    queryFn: async (): Promise<RecruiterStaffSettlementRelationship[]> => {
      const resp = await callListStaffRelationships(
        'list_recruiter_staff_settlement_relationships',
        { _recruiter_id: id as string },
      );
      if (resp.error) throw new Error('Unable to load settlement drivers.');
      const parsed = parseRecruiterStaffSettlementRelationships(resp.data);
      if (!parsed) throw new Error('Unable to load settlement drivers.');
      return parsed;
    },
  });

  return {
    relationships: query.data ?? [],
    isLoading: enabled && query.isLoading,
    error: query.error ?? null,
    refetch: () => {
      void query.refetch();
    },
  };
}
