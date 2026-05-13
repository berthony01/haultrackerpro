import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAdmin } from '@/hooks/useAdmin';
import type { Tables } from '@/integrations/supabase/types';

export type AdminOpportunity = Tables<'opportunities'> & {
  recruiter?: Pick<
    Tables<'recruiter_profiles'>,
    'id' | 'recruiter_name' | 'company_name' | 'recruiter_email' | 'verification_status' | 'status'
  > | null;
};

export type ReviewFilter = 'pending' | 'approved' | 'rejected' | 'flagged' | 'removed' | 'all';

export function useAdminOpportunities(filter: ReviewFilter = 'pending') {
  const { isAdmin } = useAdmin();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['admin_opportunities', filter],
    enabled: isAdmin,
    queryFn: async (): Promise<AdminOpportunity[]> => {
      let q = supabase
        .from('opportunities')
        .select(
          `*, recruiter:recruiter_profiles!opportunities_recruiter_id_fkey (
             id, recruiter_name, company_name, recruiter_email, verification_status, status
           )`
        )
        .order('created_at', { ascending: false })
        .limit(200);

      if (filter === 'removed') q = q.eq('status', 'removed');
      else if (filter !== 'all') q = q.eq('admin_review_status', filter);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AdminOpportunity[];
    },
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['admin_opportunities'] });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('opportunities')
        .update({
          admin_review_status: 'approved',
          status: 'active',
          published_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('opportunities')
        .update({ admin_review_status: 'rejected' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const flag = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('opportunities')
        .update({ admin_review_status: 'flagged' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('opportunities')
        .update({ status: 'removed', admin_review_status: 'rejected' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    opportunities: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    approve,
    reject,
    flag,
    remove,
  };
}
