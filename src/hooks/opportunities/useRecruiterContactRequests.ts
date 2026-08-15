import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type ContactRequestStatus = 'pending' | 'approved' | 'declined' | 'expired';

export interface RecruiterContactRequest {
  id: string;
  application_id: string;
  recruiter_user_id: string;
  driver_user_id: string;
  status: ContactRequestStatus;
  recruiter_note: string | null;
  driver_note: string | null;
  created_at: string;
  updated_at: string;
  responded_at: string | null;
}

/**
 * Controlled recruiter↔driver contact-permission requests.
 * - Recruiters create requests via RPC `request_driver_contact`.
 * - Drivers approve/decline via RPC `respond_to_contact_request`.
 * - Reads use RLS-scoped SELECT on `recruiter_contact_requests`.
 */
export function useRecruiterContactRequests(applicationIds: string[] = []) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const keyIds = [...applicationIds].sort().join(',');

  const listQuery = useQuery({
    queryKey: ['recruiter_contact_requests', 'by-apps', keyIds, user?.id],
    queryFn: async () => {
      if (!user || applicationIds.length === 0) return [] as RecruiterContactRequest[];
      const { data, error } = await supabase
        .from('recruiter_contact_requests' as any)
        .select('*')
        .in('application_id', applicationIds)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RecruiterContactRequest[];
    },
    enabled: !!user && applicationIds.length > 0,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['recruiter_contact_requests'] });
    qc.invalidateQueries({ queryKey: ['application_events'] });
    qc.invalidateQueries({ queryKey: ['opportunity_applications'] });
  };

  const requestContact = useMutation({
    mutationFn: async (args: { applicationId: string; recruiterNote?: string }) => {
      const { error } = await supabase.rpc('request_driver_contact' as any, {
        application_id: args.applicationId,
        recruiter_note: args.recruiterNote ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const respond = useMutation({
    mutationFn: async (args: {
      requestId: string;
      decision: 'approved' | 'declined';
      driverNote?: string;
    }) => {
      const { error } = await supabase.rpc('respond_to_contact_request' as any, {
        request_id: args.requestId,
        decision: args.decision,
        driver_note: args.driverNote ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    requests: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    refetch: listQuery.refetch,
    requestContact,
    respond,
  };
}

/**
 * Phase RC-1E — recruiter STAFF contact-request hook.
 *
 * Separate from the owner/driver hook above (unchanged). Exposes NO driver
 * respond mutation. Client booleans are UX only; the database remains
 * authoritative for both listing and request creation.
 */
export interface RecruiterStaffContactPermissions {
  canViewApplications: boolean;
  canRequestApplicationContact: boolean;
}

export function useRecruiterStaffContactRequests(args: {
  recruiterId: string | null | undefined;
  applicationIds?: string[];
  permissions: RecruiterStaffContactPermissions;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const recruiterId = args.recruiterId ?? null;
  const applicationIds = args.applicationIds ?? [];
  const canView = args.permissions.canViewApplications === true;
  const canRequest = args.permissions.canRequestApplicationContact === true;
  const keyIds = [...applicationIds].sort().join(',');

  const listQuery = useQuery({
    queryKey: ['recruiter_staff_contact_requests', user?.id, recruiterId, keyIds],
    queryFn: async () => {
      if (!user || !recruiterId || !canView || applicationIds.length === 0) {
        return [] as RecruiterContactRequest[];
      }
      const { data, error } = await supabase
        .from('recruiter_contact_requests' as any)
        .select('*')
        .in('application_id', applicationIds)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RecruiterContactRequest[];
    },
    enabled: !!user && !!recruiterId && canView && applicationIds.length > 0,
  });

  const requestContact = useMutation({
    mutationFn: async (mutArgs: { applicationId: string; recruiterNote?: string }) => {
      if (!user) throw new Error('Not authenticated');
      if (!recruiterId) throw new Error('Not authorized');
      if (!canRequest) throw new Error('Not authorized');
      const { error } = await supabase.rpc('request_driver_contact' as any, {
        application_id: mutArgs.applicationId,
        recruiter_note: mutArgs.recruiterNote ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recruiter_staff_contact_requests'] });
      qc.invalidateQueries({ queryKey: ['recruiter_staff_applications'] });
      qc.invalidateQueries({ queryKey: ['application_events'] });
    },
  });

  return {
    requests: canView ? (listQuery.data ?? []) : [],
    isLoading: canView ? listQuery.isLoading : false,
    isError: canView ? listQuery.isError : false,
    refetch: listQuery.refetch,
    requestContact,
  };
}

/** Pick the most relevant request for an application (latest by created_at) */
export function latestRequestForApp(
  requests: RecruiterContactRequest[],
  applicationId: string,
): RecruiterContactRequest | null {
  return requests.find((r) => r.application_id === applicationId) ?? null;
}

