import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRecruiterProfile } from './useRecruiterProfile';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type Opportunity = Tables<'opportunities'>;
type Insert = TablesInsert<'opportunities'>;
type Update = TablesUpdate<'opportunities'>;
export type OpportunityInsert = Omit<Insert, 'recruiter_id' | 'admin_review_status' | 'featured' | 'view_count' | 'published_at'>;
export type OpportunityUpdate = Omit<Update, 'recruiter_id' | 'admin_review_status' | 'featured' | 'view_count' | 'published_at' | 'id'>;

// Phase 1L-F2D — canonical result contract for the safe delete RPC.
export type DeleteRecruiterOpportunityResult = {
  result_code: 'deleted' | 'not_found' | 'status_blocked' | 'related_records';
  blockers?: string[];
};

// Local narrow adapter for the newly added RPC. Generated types have not been
// regenerated yet because the migration is still a candidate. The adapter is
// the sole authorized workaround; no `any`, `@ts-ignore`, or generated-type
// edits are used.
type DeleteRecruiterOpportunityRpc = (
  fn: 'delete_recruiter_opportunity',
  args: { p_opportunity_id: string },
) => PromiseLike<{ data: unknown; error: unknown }>;

const callDeleteRecruiterOpportunity = supabase.rpc.bind(supabase) as unknown as DeleteRecruiterOpportunityRpc;

const GENERIC_DELETE_ERROR = 'Unable to delete this opportunity right now.';

function parseDeleteResult(x: unknown): DeleteRecruiterOpportunityResult | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const obj = x as Record<string, unknown>;
  const code = obj.result_code;
  if (
    code !== 'deleted' &&
    code !== 'not_found' &&
    code !== 'status_blocked' &&
    code !== 'related_records'
  ) {
    return null;
  }
  if (code === 'related_records') {
    const b = obj.blockers;
    if (!Array.isArray(b) || b.length === 0 || !b.every((x) => typeof x === 'string')) {
      return null;
    }
    return { result_code: 'related_records', blockers: [...(b as string[])] };
  }
  return { result_code: code };
}

/* -------------------------------------------------------------------------
 * Phase RB-3A-0A — canonical opportunity CREATION boundary.
 *
 * Creation no longer direct-inserts into public.opportunities. It goes through
 * the SECURITY DEFINER RPC `create_recruiter_opportunity`, which re-asserts the
 * EXACT same predicate as the RLS WITH CHECK
 * (`current_user_can_recruiter_opportunity_action(recruiter_id,
 * 'opportunities_create')`) and performs an ordinary INSERT, so every existing
 * BEFORE INSERT guard (billing/active limit, staff action, canonical
 * publication, field validation, featured) still fires unchanged.
 *
 * Client-side `canPost` / staff permission checks below remain UX prechecks
 * only; they are no longer the sole enforcement.
 *
 * Narrow adapter because generated types are not regenerated until the
 * migration is applied. No `any`, no `@ts-ignore`, no generated-type edits.
 * ---------------------------------------------------------------------- */
type CreateRecruiterOpportunityRpc = (
  fn: 'create_recruiter_opportunity',
  args: { _recruiter_id: string; _payload: OpportunityInsert },
) => PromiseLike<{ data: unknown; error: unknown }>;

const callCreateRecruiterOpportunity =
  supabase.rpc.bind(supabase) as unknown as CreateRecruiterOpportunityRpc;

const GENERIC_CREATE_ERROR = 'Unable to post this opportunity right now.';

/** Deterministic server sentinels → stable UI copy. */
const CREATE_ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Sign in again to post an opportunity.',
  permission_denied:
    'You do not have permission to post opportunities for this workspace.',
  invalid_payload: GENERIC_CREATE_ERROR,
  unknown_field: GENERIC_CREATE_ERROR,
};

async function createRecruiterOpportunityViaRpc(
  recruiterId: string,
  data: OpportunityInsert,
): Promise<void> {
  let resp: { data: unknown; error: unknown };
  try {
    resp = await callCreateRecruiterOpportunity('create_recruiter_opportunity', {
      _recruiter_id: recruiterId,
      _payload: data,
    });
  } catch {
    throw new Error(GENERIC_CREATE_ERROR);
  }
  if (resp.error) {
    const raw = (resp.error as { message?: unknown })?.message;
    const msg = typeof raw === 'string' ? raw.trim() : '';
    // Guard-trigger messages (plan limit, publication validation, staff action)
    // are product copy already and must reach the user unchanged.
    throw new Error(CREATE_ERROR_MESSAGES[msg] ?? (msg || GENERIC_CREATE_ERROR));
  }
  const result = resp.data;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(GENERIC_CREATE_ERROR);
  }
  const obj = result as Record<string, unknown>;
  if (obj.result_code !== 'created' || typeof obj.opportunity_id !== 'string') {
    throw new Error(GENERIC_CREATE_ERROR);
  }
}


export function useRecruiterOpportunities() {
  const { user } = useAuth();
  const { profile, isApproved, canPost, isVerified } = useRecruiterProfile();
  const qc = useQueryClient();

  const recruiterId = profile?.id ?? null;

  const listQuery = useQuery({
    queryKey: ['recruiter_opportunities', recruiterId],
    queryFn: async () => {
      if (!recruiterId) return [] as Opportunity[];
      const { data, error } = await supabase
        .from('opportunities')
        .select('*')
        .eq('recruiter_id', recruiterId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && !!recruiterId,
  });

  // Phase 1F-A: posting requires a complete, non-suspended profile.
  // Admin verification is NOT required.
  const requireCanPost = () => {
    if (!canPost || !recruiterId) {
      throw new Error('Complete your recruiter profile to post opportunities.');
    }
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['recruiter_opportunities'] });
    qc.invalidateQueries({ queryKey: ['opportunities'] });
  };

  const createOpportunity = useMutation({
    mutationFn: async (data: OpportunityInsert) => {
      requireCanPost();
      await createRecruiterOpportunityViaRpc(recruiterId!, data);
    },
    onSuccess: invalidate,
  });

  const updateOpportunity = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: OpportunityUpdate }) => {
      requireCanPost();
      const { error } = await supabase
        .from('opportunities')
        .update(data)
        .eq('id', id)
        .eq('recruiter_id', recruiterId!);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'paused' | 'closed' | 'draft' }) => {
      requireCanPost();
      const { error } = await supabase
        .from('opportunities')
        .update({ status })
        .eq('id', id)
        .eq('recruiter_id', recruiterId!);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteOpportunity = useMutation({
    mutationFn: async (id: string): Promise<DeleteRecruiterOpportunityResult> => {
      requireCanPost();
      let resp: { data: unknown; error: unknown };
      try {
        resp = await callDeleteRecruiterOpportunity(
          'delete_recruiter_opportunity',
          { p_opportunity_id: id },
        );
      } catch {
        throw new Error(GENERIC_DELETE_ERROR);
      }
      if (resp.error) {
        throw new Error(GENERIC_DELETE_ERROR);
      }
      const parsed = parseDeleteResult(resp.data);
      if (!parsed) {
        throw new Error(GENERIC_DELETE_ERROR);
      }
      switch (parsed.result_code) {
        case 'deleted':
          return parsed;
        case 'status_blocked':
          throw new Error('Close this opportunity before deleting it permanently.');
        case 'related_records':
          throw new Error(
            'This opportunity cannot be deleted because it has connected applications, referrals, offers, contracts, or reports. Keep it closed to preserve those records.',
          );
        case 'not_found':
          throw new Error(
            'This opportunity could not be found or you do not have permission to delete it.',
          );
      }
    },
    onSuccess: invalidate,
  });

  return {
    opportunities: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    error: listQuery.error,
    refetch: listQuery.refetch,
    recruiterId,
    isApproved,
    canPost,
    isVerified,
    createOpportunity,
    updateOpportunity,
    setStatus,
    deleteOpportunity,
  };
}

/* -------------------------------------------------------------------------
 * Phase RC-1D — recruiter STAFF opportunity store.
 *
 * Deliberately separate from the owner hook above: it never mounts
 * `useRecruiterProfile`, billing, referrals, or readiness. Client permission
 * checks only avoid useless calls; the database RLS + staff action guard are
 * authoritative.
 * ---------------------------------------------------------------------- */

export interface RecruiterStaffOpportunityPermissions {
  canViewOpportunities: boolean;
  canCreateOpportunities: boolean;
  canEditOpportunities: boolean;
  canChangeOpportunityStatus: boolean;
  canDeleteOpportunities: boolean;
}

const STAFF_DENIED = 'You do not have permission to perform this action in this workspace.';

export function useRecruiterStaffOpportunities({
  recruiterId,
  permissions,
}: {
  recruiterId: string | null | undefined;
  permissions: RecruiterStaffOpportunityPermissions;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const id = recruiterId ?? null;

  const listQuery = useQuery({
    queryKey: ['recruiter_staff_opportunities', user?.id ?? null, id],
    queryFn: async () => {
      if (!id) return [] as Opportunity[];
      const { data, error } = await supabase
        .from('opportunities')
        .select('*')
        .eq('recruiter_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && !!id && permissions.canViewOpportunities === true,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['recruiter_staff_opportunities'] });
    qc.invalidateQueries({ queryKey: ['opportunities'] });
  };

  const require = (allowed: boolean) => {
    if (!allowed || !id) throw new Error(STAFF_DENIED);
  };

  const createOpportunity = useMutation({
    mutationFn: async (data: OpportunityInsert) => {
      require(permissions.canCreateOpportunities);
      if (data.status === 'active') require(permissions.canChangeOpportunityStatus);
      await createRecruiterOpportunityViaRpc(id!, data);
    },
    onSuccess: invalidate,
  });

  const updateOpportunity = useMutation({
    mutationFn: async ({ id: oppId, data }: { id: string; data: OpportunityUpdate }) => {
      require(permissions.canEditOpportunities);
      // Phase RC-1D correction: a status-bearing payload also requires status
      // permission when it represents an ACTUAL status change. Same-status
      // content saves (e.g. active -> active) remain edit-only, matching the
      // staff form matrix. If the current status cannot be proven from the
      // loaded workspace list, fail closed and demand status permission.
      if (data.status !== undefined) {
        const current = (listQuery.data ?? []).find((o) => o.id === oppId);
        if (!current || current.status !== data.status) {
          require(permissions.canChangeOpportunityStatus);
        }
      }
      const { error } = await supabase
        .from('opportunities')
        .update(data)
        .eq('id', oppId)
        .eq('recruiter_id', id!);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });


  const setStatus = useMutation({
    mutationFn: async ({
      id: oppId,
      status,
    }: { id: string; status: 'active' | 'paused' | 'closed' | 'draft' }) => {
      require(permissions.canChangeOpportunityStatus);
      const { error } = await supabase
        .from('opportunities')
        .update({ status })
        .eq('id', oppId)
        .eq('recruiter_id', id!);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteOpportunity = useMutation({
    mutationFn: async (oppId: string): Promise<DeleteRecruiterOpportunityResult> => {
      require(permissions.canDeleteOpportunities);
      let resp: { data: unknown; error: unknown };
      try {
        resp = await callDeleteRecruiterOpportunity(
          'delete_recruiter_opportunity',
          { p_opportunity_id: oppId },
        );
      } catch {
        throw new Error(GENERIC_DELETE_ERROR);
      }
      if (resp.error) throw new Error(GENERIC_DELETE_ERROR);
      const parsed = parseDeleteResult(resp.data);
      if (!parsed) throw new Error(GENERIC_DELETE_ERROR);
      switch (parsed.result_code) {
        case 'deleted':
          return parsed;
        case 'status_blocked':
          throw new Error('Close this opportunity before deleting it permanently.');
        case 'related_records':
          throw new Error(
            'This opportunity cannot be deleted because it has connected applications, referrals, offers, contracts, or reports. Keep it closed to preserve those records.',
          );
        case 'not_found':
          throw new Error(
            'This opportunity could not be found or you do not have permission to delete it.',
          );
      }
    },
    onSuccess: invalidate,
  });

  return {
    opportunities: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    error: listQuery.error,
    refetch: listQuery.refetch,
    recruiterId: id,
    createOpportunity,
    updateOpportunity,
    setStatus,
    deleteOpportunity,
  };
}

