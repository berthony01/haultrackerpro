import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { useRecruiterBilling, RECRUITER_PLAN_LABELS } from '@/hooks/opportunities/useRecruiterBilling';
import type {
  RecruiterReportRange,
  RecruiterReportInput,
} from '@/lib/recruiterReports/aggregator';

/**
 * Fetches all recruiter-owned data needed to build Activity / Pipeline reports.
 * Every query is filtered by `recruiter_id` (or recruiter ownership) — RLS
 * additionally enforces this. Driver loads / expenses / fuel are never queried.
 */
export function useRecruiterReportData(range: RecruiterReportRange | null, enabled = true) {
  const { user } = useAuth();
  const { profile } = useRecruiterProfile();
  const billing = useRecruiterBilling();

  const recruiterId = profile?.id ?? null;
  const isReady = !!user && !!recruiterId && !!range && enabled;

  // Server-side eligibility (defence-in-depth on top of UI gating):
  // only Growth/Fleet & active or trialing-status recruiters can build reports. // trial-allowlist
  const planEligible =
    (billing.plan === 'growth' || billing.plan === 'fleet') && billing.isBillingActive;

  const query = useQuery({
    queryKey: ['recruiter-report-data', recruiterId, range?.from, range?.to],
    enabled: isReady && planEligible,
    queryFn: async (): Promise<RecruiterReportInput> => {
      if (!recruiterId || !range || !profile) throw new Error('Not ready');

      // Opportunities owned by this recruiter (full set — counts are not range-bound)
      const { data: opps, error: oppsErr } = await supabase
        .from('opportunities')
        .select('id,title,status,view_count,published_at')
        .eq('recruiter_id', recruiterId);
      if (oppsErr) throw oppsErr;

      // Applications for this recruiter — Phase 28A: recruiters no longer
      // have direct SELECT on opportunity_applications. Use the non-PII
      // summary RPC (id, opportunity_id, status, created_at, updated_at only).
      const { data: apps, error: appsErr } = await (supabase as any).rpc(
        'list_recruiter_application_summaries',
        { _recruiter_id: recruiterId },
      );
      if (appsErr) throw appsErr;

      const appIds = (apps ?? []).map(a => a.id);

      // Events for those applications
      let events: { application_id: string; event_type: string; created_at: string }[] = [];
      if (appIds.length > 0) {
        const { data, error } = await supabase
          .from('application_events')
          .select('application_id,event_type,created_at')
          .in('application_id', appIds);
        if (error) throw error;
        events = data ?? [];
      }

      // Contact requests for this recruiter
      const { data: contactReq, error: crErr } = await supabase
        .from('recruiter_contact_requests')
        .select('id,status,created_at')
        .eq('recruiter_user_id', user!.id);
      if (crErr) throw crErr;

      // Contracts for this recruiter
      const { data: contracts, error: cErr } = await supabase
        .from('contracts')
        .select('id,application_id,status,updated_at')
        .eq('recruiter_id', recruiterId);
      if (cErr) throw cErr;

      return {
        header: {
          companyName: profile.company_name,
          recruiterName: profile.recruiter_name,
          verificationStatus: profile.verification_status,
          plan: billing.plan,
          planStatus: billing.status,
          activeLimit: billing.limit,
          activeCount: billing.activeCount,
        },
        range,
        opportunities: opps ?? [],
        applications: apps ?? [],
        events,
        contactRequests: contactReq ?? [],
        contracts: (contracts ?? []) as any,
      };
    },
  });

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
    recruiterId,
    planEligible,
    planLabel: RECRUITER_PLAN_LABELS[billing.plan],
    billingPlan: billing.plan,
    billingStatus: billing.status,
  };
}
