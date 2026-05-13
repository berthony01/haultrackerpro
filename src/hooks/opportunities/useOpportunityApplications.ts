import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export type OpportunityApplication = Tables<'opportunity_applications'>;
export type OpportunityApplicationInsert = Omit<TablesInsert<'opportunity_applications'>, 'driver_user_id'>;

/**
 * Driver-facing: list own applications, create new ones.
 * Recruiter-facing: list applications for opportunities they own (filtered server-side via RLS).
 */
export function useOpportunityApplications(opts: { recruiterId?: string } = {}) {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Driver: own applications
  const driverQuery = useQuery({
    queryKey: ['opportunity_applications', 'driver', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('opportunity_applications')
        .select('*, opportunities:opportunity_id(*)')
        .eq('driver_user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  // Recruiter: applications tied to one of their opportunities
  const recruiterQuery = useQuery({
    queryKey: ['opportunity_applications', 'recruiter', opts.recruiterId],
    queryFn: async () => {
      if (!opts.recruiterId) return [];
      const { data, error } = await supabase
        .from('opportunity_applications')
        .select('*, opportunities:opportunity_id(*)')
        .eq('recruiter_id', opts.recruiterId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!opts.recruiterId,
  });

  const createApplication = useMutation({
    mutationFn: async (data: OpportunityApplicationInsert) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('opportunity_applications')
        .insert({ ...data, driver_user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opportunity_applications'] }),
  });

  return {
    driverApplications: driverQuery.data ?? [],
    recruiterApplications: recruiterQuery.data ?? [],
    isLoadingDriver: driverQuery.isLoading,
    isLoadingRecruiter: recruiterQuery.isLoading,
    createApplication,
  };
}
