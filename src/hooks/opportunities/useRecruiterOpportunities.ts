import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRecruiterProfile } from './useRecruiterProfile';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type Opportunity = Tables<'opportunities'>;
export type OpportunityInsert = Omit<
  TablesInsert<'opportunities'>,
  'recruiter_id' | 'admin_review_status' | 'featured' | 'view_count' | 'published_at'
>;
export type OpportunityUpdate = Omit<
  TablesUpdate<'opportunities'>,
  'recruiter_id' | 'admin_review_status' | 'featured' | 'view_count' | 'published_at' | 'id'
>;

export function useRecruiterOpportunities() {
  const { user } = useAuth();
  const { profile, isApproved } = useRecruiterProfile();
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

  const requireApproved = () => {
    if (!isApproved || !recruiterId) {
      throw new Error('Recruiter must be approved to manage opportunities.');
    }
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['recruiter_opportunities'] });
    qc.invalidateQueries({ queryKey: ['opportunities'] });
  };

  const createOpportunity = useMutation({
    mutationFn: async (data: OpportunityInsert) => {
      requireApproved();
      const { error } = await supabase
        .from('opportunities')
        .insert({ ...data, recruiter_id: recruiterId! });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateOpportunity = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: OpportunityUpdate }) => {
      requireApproved();
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
      requireApproved();
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
    createOpportunity,
    updateOpportunity,
    setStatus,
  };
}
