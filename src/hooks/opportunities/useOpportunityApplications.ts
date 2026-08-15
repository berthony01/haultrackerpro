import { useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';
import type { RecruiterTransition } from '@/lib/opportunities/applicationStatus';
import {
  createIdempotencyStore,
  type IdempotencyStore,
} from '@/lib/opportunities/submissionIdempotency';


// Phase 1H-A1 — public-safe RPC outcome contract. Kept local until A2/A3
// expand generated types coverage. Any business-outcome result_code other
// than 'created' or 'idempotent_replay' is a controlled failure the hook
// converts into a mutation error, so callers never treat a non-success
// server outcome as a silent success.
export type SubmissionResultCode =
  | 'created'
  | 'idempotent_replay'
  | 'duplicate_same_type'
  | 'opportunity_unavailable'
  | 'self_opportunity'
  | 'profile_required'
  | 'restricted'
  | 'invalid_input'
  | 'question_required';

export interface SubmissionResult {
  application_id: string | null;
  application_status: string | null;
  result_code: SubmissionResultCode;
}

const SUBMISSION_SUCCESS_CODES: ReadonlySet<SubmissionResultCode> = new Set([
  'created',
  'idempotent_replay',
]);

function assertSubmissionSuccess(row: SubmissionResult | null | undefined): SubmissionResult {
  if (!row || !row.result_code) {
    throw new Error('submission_failed:empty_response');
  }
  if (!SUBMISSION_SUCCESS_CODES.has(row.result_code)) {
    throw new Error(`submission_failed:${row.result_code}`);
  }
  return row;
}

// Restored alias (item 3). Consumers import the row shape as
// `OpportunityApplication`. Insert shape stays separate.
export type OpportunityApplication = Tables<'opportunity_applications'>;
export type OpportunityApplicationInsert = Omit<TablesInsert<'opportunity_applications'>, 'driver_user_id'>;

// FIX 4: Recruiter-selectable statuses via the ordinary UPDATE path are
// strictly the RecruiterTransition set. onboarding/hired/withdrawn are
// server-workflow-only and MUST NOT be settable from the client mutation.
export type RecruiterApplicationStatus = RecruiterTransition;

export type DriverResponseType =
  | 'still_interested'
  | 'request_callback'
  | 'need_more_info'
  | 'not_interested';

const APPLICATION_SELECT_DRIVER = '*, opportunities:opportunity_id(id,title,company_name,hiring_city,hiring_state,status,admin_review_status)';
const APPLICATION_SELECT_RECRUITER = '*, opportunities:opportunity_id(id,title,company_name,hiring_city,hiring_state,status,admin_review_status,route_type,driver_type,trailer_type,deadhead_paid,lease_payment,insurance_deductions,maintenance_deductions,other_deductions,escrow_amount,escrow_required,estimated_weekly_gross,flat_weekly_pay,cpm,percentage_pay,estimated_weekly_miles,estimated_loaded_miles,estimated_deadhead_miles), driver_profile:driver_profile_id(id,full_name,city,state,cdl_class,years_experience,preferred_driver_type,preferred_route_type,endorsements,trailer_experience,min_weekly_gross,min_weekly_net,min_effective_rpm)';

/**
 * Driver-facing: list own applications, create new ones, withdraw own.
 * Recruiter-facing: list applications for opportunities they own and update status (RLS enforced).
 */
export function useOpportunityApplications(opts: { recruiterId?: string } = {}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  // Submission-attempt-scoped idempotency store: one key per in-flight
  // submission (kind, opportunity_id). Released in onSettled so the NEXT
  // user action for the same opportunity/type receives a fresh key. Retries
  // within a single React Query mutation attempt reuse the reserved key
  // because `mutationFn` re-runs but `onSettled` only fires after the whole
  // attempt (including retries) has settled.
  const idempotencyStoreRef = useRef<IdempotencyStore>();
  if (!idempotencyStoreRef.current) {
    idempotencyStoreRef.current = createIdempotencyStore();
  }
  const store = idempotencyStoreRef.current;



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

  // Recruiter: applications tied to one of their opportunities. Phase 28 — go
  // through public.list_recruiter_applications_safe(_recruiter_id) so
  // driver_phone_snapshot / driver_email_snapshot are only revealed when an
  // approved contact request exists AND the driver still consents.
  const recruiterQuery = useQuery({
    queryKey: ['opportunity_applications', 'recruiter', opts.recruiterId],
    queryFn: async () => {
      if (!opts.recruiterId) return [];
      const { data, error } = await (supabase as any).rpc(
        'list_recruiter_applications_safe',
        { _recruiter_id: opts.recruiterId },
      );
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!opts.recruiterId,
  });


  // Formal apply (item 3) — REQUIRES a caller-supplied idempotency_key so a
  // legitimate reapplication after rejected/withdrawn cannot silently reuse
  // a stale key. React Query retries reuse the same caller value verbatim
  // because the key lives in mutation `variables`, not in a hook-level cache.
  const submitApplication = useMutation({
    mutationFn: async (args: {
      opportunity_id: string;
      idempotency_key: string;
      message?: string | null;
      availability_confirmed: boolean;
      requirements_confirmed: boolean;
      truth_attestation: boolean;
      preferred_contact_method: 'phone' | 'email' | 'sms' | 'in_app';
      contact_sharing_consent: boolean;
    }): Promise<SubmissionResult> => {
      if (!user) throw new Error('Not authenticated');
      if (!args.idempotency_key || args.idempotency_key.length < 8) {
        throw new Error('submission_failed:invalid_input');
      }
      const { data, error } = await (supabase as any).rpc('submit_opportunity_application', {
        _opportunity_id: args.opportunity_id,
        _idempotency_key: args.idempotency_key,
        _message: args.message ?? null,
        _availability_confirmed: args.availability_confirmed,
        _requirements_confirmed: args.requirements_confirmed,
        _truth_attestation: args.truth_attestation,
        _preferred_contact_method: args.preferred_contact_method,
        _contact_sharing_consent: args.contact_sharing_consent,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? (data[0] as SubmissionResult | undefined) : (data as SubmissionResult | undefined);
      return assertSubmissionSuccess(row ?? null);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opportunity_applications'] }),
  });

  // Driver-initiated question (item 3) — also REQUIRES a caller-supplied
  // idempotency_key. Same reasoning as formal apply: retries reuse the exact
  // caller value, and a distinct user action must supply a distinct value.
  const submitRequestInfo = useMutation({
    mutationFn: async (args: {
      opportunity_id: string;
      idempotency_key: string;
      question: string;
      preferred_contact_method: 'phone' | 'email' | 'sms' | 'in_app';
      contact_sharing_consent: boolean;
    }): Promise<SubmissionResult> => {
      if (!user) throw new Error('Not authenticated');
      if (!args.idempotency_key || args.idempotency_key.length < 8) {
        throw new Error('submission_failed:invalid_input');
      }
      const { data, error } = await (supabase as any).rpc('submit_request_info', {
        _opportunity_id: args.opportunity_id,
        _idempotency_key: args.idempotency_key,
        _question: args.question,
        _preferred_contact_method: args.preferred_contact_method,
        _contact_sharing_consent: args.contact_sharing_consent,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? (data[0] as SubmissionResult | undefined) : (data as SubmissionResult | undefined);
      return assertSubmissionSuccess(row ?? null);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opportunity_applications'] }),
  });

  // Back-compat façade for legacy `createApplication.mutate(...)` callsites.
  // Fails closed for unsupported application_type values (no silent misrouting)
  // and reuses the same per-opportunity stable idempotency key across retries.
  const createApplication = useMutation({
    mutationFn: async (data: OpportunityApplicationInsert): Promise<SubmissionResult> => {
      if (!user) throw new Error('Not authenticated');
      if (data.application_type === 'apply') {
        throw new Error('Formal apply requires the submitApplication mutation with whitelisted attestations.');
      }
      if (data.application_type !== 'request_info') {
        throw new Error(`Unsupported application_type: ${String(data.application_type)}`);
      }
      const preferred = ((data as unknown as { preferred_contact_method?: string })
        .preferred_contact_method as 'phone' | 'email' | 'sms' | 'in_app' | undefined) ?? 'in_app';
      const explicitConsent = (data as unknown as { contact_sharing_consent?: boolean })
        .contact_sharing_consent === true;
      const callerKey = (data as unknown as { idempotency_key?: string }).idempotency_key;
      const key = store.acquire('request_info', data.opportunity_id, callerKey);
      const { data: rpcData, error } = await (supabase as any).rpc('submit_request_info', {
        _opportunity_id: data.opportunity_id,
        _idempotency_key: key,
        _question: data.message ?? '',
        _preferred_contact_method: preferred,
        _contact_sharing_consent: explicitConsent,
      });
      if (error) throw error;
      const row = Array.isArray(rpcData) ? (rpcData[0] as SubmissionResult | undefined) : (rpcData as SubmissionResult | undefined);
      return assertSubmissionSuccess(row ?? null);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opportunity_applications'] }),
    // v1 permits only one initial inquiry per opportunity, so the generated
    // key must persist for the hook lifetime. Do NOT release on settle — a
    // fresh key would defeat idempotency across separate user actions.
  });

  const withdrawApplication = useMutation({
    mutationFn: async (applicationId: string) => {
      const { error } = await supabase.rpc('withdraw_opportunity_application', {
        application_id: applicationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['opportunity_applications'] });
      qc.invalidateQueries({ queryKey: ['application_events'] });
    },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['opportunity_applications'] });
      qc.invalidateQueries({ queryKey: ['application_events'] });
    },
  });

  // Driver records a structured response (does not change application status)
  const recordDriverResponse = useMutation({
    mutationFn: async (args: { applicationId: string; responseType: DriverResponseType; note?: string }) => {
      const { error } = await supabase.rpc('record_driver_application_response' as any, {
        application_id: args.applicationId,
        response_type: args.responseType,
        note: args.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['application_events'] });
      qc.invalidateQueries({ queryKey: ['opportunity_applications'] });
    },
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
    submitApplication,
    submitRequestInfo,
    withdrawApplication,
    updateApplicationStatus,
    recordDriverResponse,
  };
}

/**
 * Phase RC-1E — recruiter STAFF application data hook.
 *
 * Completely separate from the owner/driver hook above (which is unchanged).
 * Mounts NO recruiter profile, billing, subscription, contract, referral,
 * report, settlement, or personal driver query.
 *
 * Reads go ONLY through `list_recruiter_applications_safe(_recruiter_id)`;
 * the database masks contact snapshots for staff lacking
 * `applications_request_contact`. Client booleans are UX only — PostgreSQL
 * remains authoritative for every operation.
 */
export interface RecruiterStaffApplicationPermissions {
  canViewApplications: boolean;
  canManageApplicationStatus: boolean;
}

export function useRecruiterStaffApplications(args: {
  recruiterId: string | null | undefined;
  permissions: RecruiterStaffApplicationPermissions;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const recruiterId = args.recruiterId ?? null;
  const canView = args.permissions.canViewApplications === true;
  const canManageStatus = args.permissions.canManageApplicationStatus === true;

  const listQuery = useQuery({
    // Scoped by authenticated user AND workspace so no payload can leak
    // across accounts or workspaces through the cache.
    queryKey: ['recruiter_staff_applications', user?.id, recruiterId],
    queryFn: async () => {
      if (!user || !recruiterId || !canView) return [] as any[];
      const { data, error } = await (supabase as any).rpc(
        'list_recruiter_applications_safe',
        { _recruiter_id: recruiterId },
      );
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!user && !!recruiterId && canView,
  });

  const updateApplicationStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: RecruiterApplicationStatus }) => {
      if (!user) throw new Error('Not authenticated');
      if (!recruiterId) throw new Error('Not authorized');
      if (!canManageStatus) throw new Error('Not authorized');
      const { data, error } = await (supabase as any).rpc(
        'update_recruiter_application_status',
        {
          _recruiter_id: recruiterId,
          _application_id: id,
          _status: status,
        },
      );
      if (error) throw error;
      if (data !== true) throw new Error('Application not found');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recruiter_staff_applications'] });
      qc.invalidateQueries({ queryKey: ['opportunity_applications'] });
      qc.invalidateQueries({ queryKey: ['application_events'] });
    },
  });

  return {
    applications: canView ? (listQuery.data ?? []) : [],
    isLoading: canView ? listQuery.isLoading : false,
    isError: canView ? listQuery.isError : false,
    refetch: listQuery.refetch,
    updateApplicationStatus,
  };
}
