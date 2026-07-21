import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRecruiterProfile } from './useRecruiterProfile';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type Opportunity = Tables<'opportunities'>;
type Insert = TablesInsert<'opportunities'>;
type Update = TablesUpdate<'opportunities'>;
// The canonical authoring layer builds payloads with all fields optional;
// the hook accepts that broader shape and rebrands as Insert/Update at the
// Supabase boundary. Recruiter ownership is still enforced server-side via
// RLS and set here from the resolved recruiter profile.
export type OpportunityInsert = Partial<Omit<Insert, 'recruiter_id' | 'admin_review_status' | 'featured' | 'view_count' | 'published_at'>>;
export type OpportunityUpdate = Partial<Omit<Update, 'recruiter_id' | 'admin_review_status' | 'featured' | 'view_count' | 'published_at' | 'id'>>;

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
      const insertRow = { ...data, recruiter_id: recruiterId! } as Insert;
      const { error } = await supabase
        .from('opportunities')
        .insert(insertRow);
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
  };
}
