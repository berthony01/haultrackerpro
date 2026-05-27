import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAdmin } from '@/hooks/useAdmin';

// Caps documented in Phase 9 report. Admin-only via existing RLS.
export const LEADERBOARD_CAPS = {
  recruiters: 1000,
  billing: 1000,
  opportunities: 5000,
  applications: 5000,
  contactRequests: 5000,
} as const;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export type PerformanceLabel =
  | 'Top Performer'
  | 'Strong'
  | 'Developing'
  | 'Low Activity'
  | 'Needs Attention';

export interface RecentRecruiterOpportunity {
  id: string;
  title: string | null;
  company_name: string | null;
  status: string | null;
  admin_review_status: string | null;
  created_at: string | null;
  published_at: string | null;
  hiring_city: string | null;
  hiring_state: string | null;
  trailer_type: string | null;
  driver_type: string | null;
  route_type: string | null;
}

export const RECENT_OPPORTUNITY_DISPLAY_CAP = 10;

export interface LeaderboardRow {
  recruiter_profile_id: string;
  recruiter_user_id: string;
  recruiter_name: string;
  recruiter_email: string | null;
  recruiter_phone: string | null;
  company_name: string;
  company_city: string | null;
  company_state: string | null;
  verification_status: string;
  account_status: string;
  created_at: string;
  billing_plan: string | null;
  billing_status: string | null;
  active_opportunity_limit: number | null;
  current_period_end: string | null;
  priority_placement_included: boolean;
  total_opportunities: number;
  active_opportunities: number;
  pending_opportunities: number;
  approved_opportunities: number;
  rejected_opportunities: number;
  flagged_opportunities: number;
  removed_opportunities: number;
  opportunities_30d: number;
  total_applications: number;
  applications_30d: number;
  total_contact_requests: number;
  contact_requests_30d: number;
  responded_contact_requests: number;
  application_per_active_opportunity: number;
  contact_request_per_application: number;
  response_rate: number;
  performance_score: number;
  performance_label: PerformanceLabel;
  performance_flags: string[];
  // For details breakdown
  score_breakdown: {
    listing: number;
    active: number;
    interest: number;
    contact: number;
    account_billing: number;
  };
  recent_opportunities: RecentRecruiterOpportunity[];
}

function clamp(n: number, max = 100) {
  return Math.max(0, Math.min(max, n));
}

function listingPoints(total: number): number {
  if (total === 0) return 0;
  if (total === 1) return 10;
  if (total <= 3) return 18;
  return 25;
}
function activePoints(active: number): number {
  if (active === 0) return 0;
  if (active === 1) return 10;
  if (active <= 3) return 16;
  return 20;
}
function interestPoints(apps: number): number {
  if (apps === 0) return 0;
  if (apps <= 2) return 10;
  if (apps <= 5) return 18;
  return 25;
}
function contactPoints(cr: number): number {
  if (cr === 0) return 0;
  if (cr <= 2) return 7;
  if (cr <= 5) return 12;
  return 15;
}

function labelForScore(score: number): PerformanceLabel {
  if (score >= 80) return 'Top Performer';
  if (score >= 60) return 'Strong';
  if (score >= 40) return 'Developing';
  if (score >= 20) return 'Low Activity';
  return 'Needs Attention';
}

export function useAdminRecruiterLeaderboard() {
  const { isAdmin } = useAdmin();

  return useQuery({
    queryKey: ['admin-recruiter-leaderboard'],
    enabled: isAdmin,
    queryFn: async (): Promise<LeaderboardRow[]> => {
      const [recRes, billRes, oppRes, appRes, crRes] = await Promise.all([
        supabase
          .from('recruiter_profiles')
          .select(
            'id,user_id,recruiter_name,recruiter_email,recruiter_phone,company_name,company_city,company_state,verification_status,status,created_at'
          )
          .order('created_at', { ascending: false })
          .limit(LEADERBOARD_CAPS.recruiters),
        supabase
          .from('recruiter_billing_profiles')
          .select('recruiter_id,user_id,plan,status,current_period_end,active_opportunity_limit')
          .limit(LEADERBOARD_CAPS.billing),
        supabase
          .from('opportunities')
          .select('id,recruiter_id,status,admin_review_status,created_at,title,company_name,published_at,hiring_city,hiring_state,trailer_type,driver_type,route_type')
          .order('created_at', { ascending: false })
          .limit(LEADERBOARD_CAPS.opportunities),
        supabase
          .from('opportunity_applications')
          .select('id,opportunity_id,recruiter_id,status,created_at')
          .order('created_at', { ascending: false })
          .limit(LEADERBOARD_CAPS.applications),
        supabase
          .from('recruiter_contact_requests')
          .select('id,application_id,recruiter_user_id,status,responded_at,created_at')
          .order('created_at', { ascending: false })
          .limit(LEADERBOARD_CAPS.contactRequests),
      ]);

      if (recRes.error) throw recRes.error;
      if (billRes.error) throw billRes.error;
      if (oppRes.error) throw oppRes.error;
      if (appRes.error) throw appRes.error;
      if (crRes.error) throw crRes.error;

      const recruiters = recRes.data ?? [];
      const billing = billRes.data ?? [];
      const opportunities = oppRes.data ?? [];
      const applications = appRes.data ?? [];
      const contactRequests = crRes.data ?? [];

      const now = Date.now();
      const cutoff = now - THIRTY_DAYS_MS;

      const billingByRecruiterId = new Map<string, (typeof billing)[number]>();
      for (const b of billing) {
        if (b.recruiter_id) billingByRecruiterId.set(b.recruiter_id, b);
      }

      // Map opportunity_id -> recruiter_id (for application fallback)
      const oppRecruiter = new Map<string, string>();
      for (const o of opportunities) {
        if (o.id && o.recruiter_id) oppRecruiter.set(o.id, o.recruiter_id);
      }

      // user_id -> recruiter_profile_id (for contact_requests mapping)
      const userIdToRecId = new Map<string, string>();
      for (const r of recruiters) {
        if (r.user_id && r.id) userIdToRecId.set(r.user_id, r.id);
      }

      type Agg = {
        total: number;
        active: number;
        pending: number;
        approved: number;
        rejected: number;
        flagged: number;
        removed: number;
        opp30d: number;
        apps: Set<string>;
        apps30d: number;
        cr: Set<string>;
        cr30d: number;
        crResponded: number;
      };
      const agg = new Map<string, Agg>();
      const empty = (): Agg => ({
        total: 0,
        active: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        flagged: 0,
        removed: 0,
        opp30d: 0,
        apps: new Set(),
        apps30d: 0,
        cr: new Set(),
        cr30d: 0,
        crResponded: 0,
      });
      for (const r of recruiters) agg.set(r.id, empty());

      // Opportunities
      for (const o of opportunities) {
        if (!o.recruiter_id) continue;
        const a = agg.get(o.recruiter_id);
        if (!a) continue;
        a.total++;
        if (o.status === 'active') a.active++;
        if (o.status === 'removed') a.removed++;
        switch (o.admin_review_status) {
          case 'pending':
            a.pending++;
            break;
          case 'approved':
            a.approved++;
            break;
          case 'rejected':
            a.rejected++;
            break;
          case 'flagged':
            a.flagged++;
            break;
        }
        if (o.created_at && new Date(o.created_at).getTime() >= cutoff) a.opp30d++;
      }

      // Applications: prefer recruiter_id; fall back to opportunity mapping. Count once via Set.
      for (const ap of applications) {
        const recId = ap.recruiter_id || (ap.opportunity_id ? oppRecruiter.get(ap.opportunity_id) : undefined);
        if (!recId) continue;
        const a = agg.get(recId);
        if (!a) continue;
        if (a.apps.has(ap.id)) continue;
        a.apps.add(ap.id);
        if (ap.created_at && new Date(ap.created_at).getTime() >= cutoff) a.apps30d++;
      }

      // Contact requests: map by recruiter_user_id -> recruiter_profile.id. Count once via Set.
      for (const cr of contactRequests) {
        const recId = cr.recruiter_user_id ? userIdToRecId.get(cr.recruiter_user_id) : undefined;
        if (!recId) continue;
        const a = agg.get(recId);
        if (!a) continue;
        if (a.cr.has(cr.id)) continue;
        a.cr.add(cr.id);
        if (cr.created_at && new Date(cr.created_at).getTime() >= cutoff) a.cr30d++;
        if (cr.responded_at || cr.status === 'responded' || cr.status === 'completed') a.crResponded++;
      }

      // Recent opportunities per recruiter (display-only, capped). Opportunities are
      // already ordered by created_at desc from the query above, so accumulating in
      // iteration order with a length cap yields the newest entries first.
      const recentByRecruiter = new Map<string, RecentRecruiterOpportunity[]>();
      for (const o of opportunities) {
        if (!o.recruiter_id) continue;
        let list = recentByRecruiter.get(o.recruiter_id);
        if (!list) {
          list = [];
          recentByRecruiter.set(o.recruiter_id, list);
        }
        if (list.length >= RECENT_OPPORTUNITY_DISPLAY_CAP) continue;
        list.push({
          id: o.id,
          title: (o as { title?: string | null }).title ?? null,
          company_name: (o as { company_name?: string | null }).company_name ?? null,
          status: o.status ?? null,
          admin_review_status: o.admin_review_status ?? null,
          created_at: o.created_at ?? null,
          published_at: (o as { published_at?: string | null }).published_at ?? null,
          hiring_city: (o as { hiring_city?: string | null }).hiring_city ?? null,
          hiring_state: (o as { hiring_state?: string | null }).hiring_state ?? null,
          trailer_type: (o as { trailer_type?: string | null }).trailer_type ?? null,
          driver_type: (o as { driver_type?: string | null }).driver_type ?? null,
          route_type: (o as { route_type?: string | null }).route_type ?? null,
        });
      }

      // Build rows
      const rows: LeaderboardRow[] = recruiters.map((r) => {

        const a = agg.get(r.id) ?? empty();
        const b = billingByRecruiterId.get(r.id);
        const billing_plan = b?.plan ?? null;
        const billing_status = b?.status ?? null;
        const billingActive = billing_status === 'active' || billing_status === 'trialing';
        const isGrowthOrFleet = billing_plan === 'growth' || billing_plan === 'fleet';
        const priority_placement_included = billingActive && isGrowthOrFleet;

        const totalApps = a.apps.size;
        const totalCr = a.cr.size;

        // Score
        const sListing = listingPoints(a.total);
        const sActive = activePoints(a.active);
        const sInterest = interestPoints(totalApps);
        const sContact = contactPoints(totalCr);
        const approvedOrActive =
          r.verification_status === 'approved' || r.status === 'active';
        const sAccount =
          (approvedOrActive ? 5 : 0) + (billingActive ? 5 : 0) + (isGrowthOrFleet ? 5 : 0);
        const performance_score = clamp(sListing + sActive + sInterest + sContact + sAccount);
        const performance_label = labelForScore(performance_score);

        // Flags
        const flags: string[] = [];
        if (a.active === 0) flags.push('No active listings');
        if (a.active > 0 && totalApps === 0) flags.push('No driver applications');
        if (totalApps > 0 && totalCr === 0) flags.push('No contact requests');
        if (billing_status === 'past_due') flags.push('Past due billing');
        if (r.status === 'suspended' || r.verification_status === 'suspended')
          flags.push('Suspended account');
        if (r.verification_status === 'pending') flags.push('Pending review');

        return {
          recruiter_profile_id: r.id,
          recruiter_user_id: r.user_id,
          recruiter_name: r.recruiter_name ?? '—',
          recruiter_email: r.recruiter_email ?? null,
          recruiter_phone: r.recruiter_phone ?? null,
          company_name: r.company_name ?? '—',
          company_city: r.company_city ?? null,
          company_state: r.company_state ?? null,
          verification_status: r.verification_status ?? 'unknown',
          account_status: r.status ?? 'unknown',
          created_at: r.created_at,
          billing_plan,
          billing_status,
          active_opportunity_limit: b?.active_opportunity_limit ?? null,
          current_period_end: b?.current_period_end ?? null,
          priority_placement_included,
          total_opportunities: a.total,
          active_opportunities: a.active,
          pending_opportunities: a.pending,
          approved_opportunities: a.approved,
          rejected_opportunities: a.rejected,
          flagged_opportunities: a.flagged,
          removed_opportunities: a.removed,
          opportunities_30d: a.opp30d,
          total_applications: totalApps,
          applications_30d: a.apps30d,
          total_contact_requests: totalCr,
          contact_requests_30d: a.cr30d,
          responded_contact_requests: a.crResponded,
          application_per_active_opportunity: a.active > 0 ? totalApps / a.active : 0,
          contact_request_per_application: totalApps > 0 ? totalCr / totalApps : 0,
          response_rate: totalCr > 0 ? (a.crResponded / totalCr) * 100 : 0,
          performance_score,
          performance_label,
          performance_flags: flags,
          score_breakdown: {
            listing: sListing,
            active: sActive,
            interest: sInterest,
            contact: sContact,
            account_billing: sAccount,
          },
        };
      });

      return rows;
    },
  });
}
