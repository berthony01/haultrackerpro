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
      const { error } = await supabase
        .from('opportunities')
        .insert({ ...data, recruiter_id: recruiterId! });
      if (error) throw error;
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
      const { error } = await supabase
        .from('opportunities')
        .insert({ ...data, recruiter_id: id! });
      if (error) throw error;
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

