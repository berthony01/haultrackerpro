import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAdmin } from '@/hooks/useAdmin';

const LIMIT = 100;

export interface OpportunityLite {
  id: string;
  title: string | null;
  company_name: string | null;
  recruiter_id: string | null;
  status: string | null;
  admin_review_status: string | null;
}

export interface RecruiterLite {
  id: string;
  recruiter_name: string | null;
  recruiter_email: string | null;
  company_name: string | null;
  verification_status: string | null;
  status: string | null;
}

export interface AdminApplicationRow {
  id: string;
  opportunity_id: string;
  recruiter_id: string;
  driver_user_id: string;
  status: string;
  application_type: string;
  message: string | null;
  created_at: string;
  updated_at: string;
  opportunity: OpportunityLite | null;
  recruiter: RecruiterLite | null;
}

export interface AdminContactRequestRow {
  id: string;
  application_id: string;
  driver_user_id: string;
  recruiter_user_id: string;
  status: string;
  driver_note: string | null;
  recruiter_note: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
  application: {
    id: string;
    opportunity_id: string;
    recruiter_id: string;
    status: string;
    created_at: string;
  } | null;
  opportunity: OpportunityLite | null;
  recruiter: RecruiterLite | null;
}

async function fetchOpportunitiesMap(ids: string[]): Promise<Map<string, OpportunityLite>> {
  const out = new Map<string, OpportunityLite>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from('opportunities')
    .select('id, title, company_name, recruiter_id, status, admin_review_status')
    .in('id', ids);
  if (error) throw error;
  for (const o of data ?? []) out.set(o.id, o as OpportunityLite);
  return out;
}

async function fetchRecruitersMap(ids: string[]): Promise<Map<string, RecruiterLite>> {
  const out = new Map<string, RecruiterLite>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from('recruiter_profiles')
    .select('id, recruiter_name, recruiter_email, company_name, verification_status, status')
    .in('id', ids);
  if (error) throw error;
  for (const r of data ?? []) out.set(r.id, r as RecruiterLite);
  return out;
}

export function useAdminApplications() {
  const { isAdmin } = useAdmin();
  return useQuery({
    queryKey: ['admin_applications'],
    enabled: isAdmin,
    queryFn: async (): Promise<AdminApplicationRow[]> => {
      // Explicitly omit driver_email_snapshot / driver_phone_snapshot for privacy.
      const { data, error } = await supabase
        .from('opportunity_applications')
        .select(
          'id, opportunity_id, recruiter_id, driver_user_id, status, application_type, message, created_at, updated_at',
        )
        .order('created_at', { ascending: false })
        .limit(LIMIT);
      if (error) throw error;
      const apps = data ?? [];
      const oppIds = Array.from(new Set(apps.map((a) => a.opportunity_id).filter(Boolean)));
      const recIds = Array.from(new Set(apps.map((a) => a.recruiter_id).filter(Boolean)));
      const [oppMap, recMap] = await Promise.all([
        fetchOpportunitiesMap(oppIds),
        fetchRecruitersMap(recIds),
      ]);
      return apps.map((a) => ({
        ...a,
        opportunity: oppMap.get(a.opportunity_id) ?? null,
        recruiter: recMap.get(a.recruiter_id) ?? null,
      }));
    },
  });
}

export function useAdminContactRequests() {
  const { isAdmin } = useAdmin();
  return useQuery({
    queryKey: ['admin_contact_requests'],
    enabled: isAdmin,
    queryFn: async (): Promise<AdminContactRequestRow[]> => {
      const { data, error } = await supabase
        .from('recruiter_contact_requests')
        .select(
          'id, application_id, driver_user_id, recruiter_user_id, status, driver_note, recruiter_note, responded_at, created_at, updated_at',
        )
        .order('created_at', { ascending: false })
        .limit(LIMIT);
      if (error) throw error;
      const rows = data ?? [];
      const appIds = Array.from(new Set(rows.map((r) => r.application_id).filter(Boolean)));
      let appMap = new Map<string, AdminContactRequestRow['application']>();
      if (appIds.length) {
        const { data: apps, error: appErr } = await supabase
          .from('opportunity_applications')
          .select('id, opportunity_id, recruiter_id, status, created_at')
          .in('id', appIds);
        if (appErr) throw appErr;
        for (const a of apps ?? []) appMap.set(a.id, a as any);
      }
      const oppIds = Array.from(
        new Set(Array.from(appMap.values()).map((a) => a?.opportunity_id).filter((v): v is string => !!v)),
      );
      const recIds = Array.from(
        new Set(Array.from(appMap.values()).map((a) => a?.recruiter_id).filter((v): v is string => !!v)),
      );
      const [oppMap, recMap] = await Promise.all([
        fetchOpportunitiesMap(oppIds),
        fetchRecruitersMap(recIds),
      ]);
      return rows.map((r) => {
        const app = appMap.get(r.application_id) ?? null;
        return {
          ...r,
          application: app,
          opportunity: app ? oppMap.get(app.opportunity_id) ?? null : null,
          recruiter: app ? recMap.get(app.recruiter_id) ?? null : null,
        };
      });
    },
  });
}
