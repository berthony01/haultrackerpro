import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAdmin } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
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
  const { user } = useAuth();
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

  const fetchPrev = async (id: string) => {
    const { data } = await supabase
      .from('opportunities')
      .select('id, recruiter_id, admin_review_status, status, title, company_name')
      .eq('id', id)
      .maybeSingle();
    if (!data) return { prev: null, recruiterUserId: null as string | null };
    let recruiterUserId: string | null = null;
    if (data.recruiter_id) {
      const { data: rp } = await supabase
        .from('recruiter_profiles')
        .select('user_id')
        .eq('id', data.recruiter_id)
        .maybeSingle();
      recruiterUserId = rp?.user_id ?? null;
    }
    return { prev: data, recruiterUserId };
  };

  const writeAudit = async (
    action: string,
    targetUserId: string | null,
    metadata: Record<string, unknown>,
  ) => {
    if (!user) return;
    const { error } = await supabase.from('admin_audit_log').insert({
      admin_user_id: user.id,
      action,
      target_user_id: targetUserId,
      metadata: metadata as never,
    });
    if (error) throw new Error(`Audit log failed: ${error.message}`);
  };

  const approve = useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated');
      const { prev, recruiterUserId } = await fetchPrev(id);
      const publishedAt = new Date().toISOString();
      const { error } = await supabase
        .from('opportunities')
        .update({
          admin_review_status: 'approved',
          status: 'active',
          published_at: publishedAt,
        })
        .eq('id', id);
      if (error) throw error;
      await writeAudit('opportunity.approve', recruiterUserId, {
        opportunity_id: id,
        recruiter_id: prev?.recruiter_id ?? null,
        recruiter_user_id: recruiterUserId,
        previous_admin_review_status: prev?.admin_review_status ?? null,
        previous_status: prev?.status ?? null,
        new_admin_review_status: 'approved',
        new_status: 'active',
        published_at: publishedAt,
        source: 'admin_opportunities_panel',
      });
    },
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated');
      const { prev, recruiterUserId } = await fetchPrev(id);
      const { error } = await supabase
        .from('opportunities')
        .update({ admin_review_status: 'rejected' })
        .eq('id', id);
      if (error) throw error;
      await writeAudit('opportunity.reject', recruiterUserId, {
        opportunity_id: id,
        recruiter_id: prev?.recruiter_id ?? null,
        recruiter_user_id: recruiterUserId,
        previous_admin_review_status: prev?.admin_review_status ?? null,
        new_admin_review_status: 'rejected',
        source: 'admin_opportunities_panel',
      });
    },
    onSuccess: invalidate,
  });

  const flag = useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated');
      const { prev, recruiterUserId } = await fetchPrev(id);
      const { error } = await supabase
        .from('opportunities')
        .update({ admin_review_status: 'flagged' })
        .eq('id', id);
      if (error) throw error;
      await writeAudit('opportunity.flag', recruiterUserId, {
        opportunity_id: id,
        recruiter_id: prev?.recruiter_id ?? null,
        recruiter_user_id: recruiterUserId,
        previous_admin_review_status: prev?.admin_review_status ?? null,
        new_admin_review_status: 'flagged',
        source: 'admin_opportunities_panel',
      });
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated');
      const { prev, recruiterUserId } = await fetchPrev(id);
      const { error } = await supabase
        .from('opportunities')
        .update({ status: 'removed', admin_review_status: 'rejected' })
        .eq('id', id);
      if (error) throw error;
      await writeAudit('opportunity.remove', recruiterUserId, {
        opportunity_id: id,
        recruiter_id: prev?.recruiter_id ?? null,
        recruiter_user_id: recruiterUserId,
        previous_admin_review_status: prev?.admin_review_status ?? null,
        previous_status: prev?.status ?? null,
        new_admin_review_status: 'rejected',
        new_status: 'removed',
        source: 'admin_opportunities_panel',
      });
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
