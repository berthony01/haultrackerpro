import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAdmin } from '@/hooks/useAdmin';
import type { Tables } from '@/integrations/supabase/types';

export type AdminRecruiter = Tables<'recruiter_profiles'> & {
  billing?: Pick<
    Tables<'recruiter_billing_profiles'>,
    'plan' | 'status' | 'active_opportunity_limit' | 'current_period_end'
  > | null;
  active_opportunity_count?: number;
};

export type RecruiterFilter = 'pending' | 'approved' | 'rejected' | 'suspended' | 'all';

export function useAdminRecruiters(filter: RecruiterFilter = 'pending') {
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['admin_recruiters', filter],
    enabled: isAdmin,
    queryFn: async (): Promise<AdminRecruiter[]> => {
      let q = supabase
        .from('recruiter_profiles')
        .select(
          `*, billing:recruiter_billing_profiles (
             plan, status, active_opportunity_limit, current_period_end
           )`
        )
        .order('created_at', { ascending: false })
        .limit(200);

      if (filter === 'suspended') q = q.eq('status', 'suspended');
      else if (filter !== 'all') q = q.eq('verification_status', filter);

      const { data, error } = await q;
      if (error) throw error;

      const rows = (data ?? []) as Array<
        Tables<'recruiter_profiles'> & {
          billing: Array<Pick<
            Tables<'recruiter_billing_profiles'>,
            'plan' | 'status' | 'active_opportunity_limit' | 'current_period_end'
          >> | null;
        }
      >;

      // Active opp counts (one query, then map)
      const ids = rows.map((r) => r.id);
      const counts = new Map<string, number>();
      if (ids.length > 0) {
        const { data: opps } = await supabase
          .from('opportunities')
          .select('recruiter_id, status')
          .in('recruiter_id', ids)
          .eq('status', 'active');
        (opps ?? []).forEach((o) => {
          counts.set(o.recruiter_id, (counts.get(o.recruiter_id) ?? 0) + 1);
        });
      }

      return rows.map((r) => ({
        ...r,
        billing: Array.isArray(r.billing) ? r.billing[0] ?? null : r.billing,
        active_opportunity_count: counts.get(r.id) ?? 0,
      }));
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin_recruiters'] });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('recruiter_profiles')
        .update({
          verification_status: 'approved',
          status: 'active',
          verified_at: new Date().toISOString(),
          verified_by: user.id,
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('recruiter_profiles')
        .update({ verification_status: 'rejected' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const suspend = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('recruiter_profiles')
        .update({ status: 'suspended', verification_status: 'suspended' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    recruiters: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    approve,
    reject,
    suspend,
  };
}

export function useRecruiterBillingSummary() {
  const { isAdmin } = useAdmin();
  return useQuery({
    queryKey: ['admin_recruiter_billing_summary'],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recruiter_billing_profiles')
        .select('plan, status, active_opportunity_limit');
      if (error) throw error;
      const rows = data ?? [];
      const summary = {
        total: rows.length,
        active: 0,
        past_due: 0,
        canceled: 0,
        inactive: 0,
        starter: 0,
        growth: 0,
        fleet: 0,
        capacity: 0,
      };
      for (const r of rows) {
        const s = (r.status ?? 'inactive').toLowerCase();
        if (s === 'active' || s === 'trialing') summary.active++; // trial-allowlist
        else if (s === 'past_due') summary.past_due++;
        else if (s === 'canceled' || s === 'cancelled') summary.canceled++;
        else summary.inactive++;
        const p = (r.plan ?? '').toLowerCase();
        if (p === 'starter') summary.starter++;
        else if (p === 'growth') summary.growth++;
        else if (p === 'fleet') summary.fleet++;
        if (s === 'active' || s === 'trialing') { // trial-allowlist
          summary.capacity += r.active_opportunity_limit ?? 0;
        }
      }
      return summary;
    },
  });
}
