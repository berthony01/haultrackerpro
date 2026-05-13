import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export type OpportunityApplication = Tables<'opportunity_applications'>;
export type OpportunityApplicationInsert = Omit<TablesInsert<'opportunity_applications'>, 'driver_user_id'>;

export type RecruiterApplicationStatus =
  | 'viewed'
  | 'contacted'
  | 'interviewing'
  | 'hired'
  | 'rejected';

const APPLICATION_SELECT_DRIVER = '*, opportunities:opportunity_id(id,title,company_name,hiring_city,hiring_state,status,admin_review_status)';
const APPLICATION_SELECT_RECRUITER = '*, opportunities:opportunity_id(id,title,company_name,hiring_city,hiring_state,status,admin_review_status,route_type,driver_type,trailer_type,deadhead_paid,lease_payment,insurance_deductions,maintenance_deductions,other_deductions,escrow_amount,escrow_required,estimated_weekly_gross,flat_weekly_pay,cpm,percentage_pay,estimated_weekly_miles,estimated_loaded_miles,estimated_deadhead_miles), driver_profile:driver_profile_id(id,full_name,city,state,cdl_class,years_experience,preferred_driver_type,preferred_route_type,endorsements,trailer_experience,min_weekly_gross,min_weekly_net,min_effective_rpm)';

/**
 * Driver-facing: list own applications, create new ones, withdraw own.
 * Recruiter-facing: list applications for opportunities they own and update status (RLS enforced).
 */
export function useOpportunityApplications(opts: { recruiterId?: string } = {}) {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Driver: own applications (with limited related opportunity context)
  const driverQuery = useQuery({
    queryKey: ['opportunity_applications', 'driver', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('opportunity_applications')
        .select(APPLICATION_SELECT_DRIVER)
        .eq('driver_user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  // Recruiter: applications tied to one of their opportunities, with limited driver-profile context
  const recruiterQuery = useQuery({
    queryKey: ['opportunity_applications', 'recruiter', opts.recruiterId],
    queryFn: async () => {
      if (!opts.recruiterId) return [];
      const { data, error } = await supabase
        .from('opportunity_applications')
        .select(APPLICATION_SELECT_RECRUITER)
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

  // Driver withdraws own request via SECURITY DEFINER RPC
  const withdrawApplication = useMutation({
    mutationFn: async (applicationId: string) => {
      const { error } = await supabase.rpc('withdraw_opportunity_application', {
        application_id: applicationId,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opportunity_applications'] }),
  });

  // Recruiter updates only the status field; trigger blocks anything else.
  const updateApplicationStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: RecruiterApplicationStatus }) => {
      const { error } = await supabase
        .from('opportunity_applications')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opportunity_applications'] }),
  });

  return {
    // Driver
    driverApplications: driverQuery.data ?? [],
    isLoadingDriver: driverQuery.isLoading,
    isErrorDriver: driverQuery.isError,
    refetchDriver: driverQuery.refetch,
    // Recruiter
    recruiterApplications: recruiterQuery.data ?? [],
    isLoadingRecruiter: recruiterQuery.isLoading,
    isErrorRecruiter: recruiterQuery.isError,
    refetchRecruiter: recruiterQuery.refetch,
    // Mutations
    createApplication,
    withdrawApplication,
    updateApplicationStatus,
  };
}
