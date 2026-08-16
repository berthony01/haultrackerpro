// Recruiter-only reporting aggregator.
// CRITICAL: this module must NEVER touch driver loads / expenses / fuel / profit / RPM / tax data.
// It only consumes recruiter-owned rows that the caller has fetched via RLS.

import { format, parseISO, isWithinInterval, endOfDay } from 'date-fns';

export type RecruiterReportType = 'activity' | 'pipeline';

export interface RecruiterReportRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  label: string;
}

export interface RecruiterReportHeader {
  companyName: string;
  recruiterName: string;
  verificationStatus: string;
  plan: string;
  planStatus: string;
  activeLimit: number;
  activeCount: number;
  /**
   * Phase RC-1H — optional privacy discriminator. Absent (or 'owner') keeps
   * the existing owner report output byte-identical. 'staff' instructs the
   * CSV/PDF renderers to omit every plan/billing/premium/upgrade line.
   */
  audience?: 'owner' | 'staff';
}


export interface AppRow {
  id: string;
  opportunity_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface OppRow {
  id: string;
  title: string;
  status: string;
  view_count: number | null;
  published_at: string | null;
}

export interface EventRow {
  application_id: string;
  event_type: string;
  created_at: string;
}

export interface ContactReqRow {
  id: string;
  status: string;
  created_at: string;
}

export interface ContractRow {
  id: string;
  application_id: string;
  status: string;
  updated_at: string;
}

export interface RecruiterReportInput {
  header: RecruiterReportHeader;
  range: RecruiterReportRange;
  applications: AppRow[];
  opportunities: OppRow[];
  events: EventRow[];
  contactRequests: ContactReqRow[];
  contracts: ContractRow[];
}

export interface PipelineRow {
  opportunityId: string;
  title: string;
  status: string;
  applications: number;
  interviews: number;
  offers: number;
  hired: number;
  rejected: number;
  withdrawn: number;
  contractBlocked: number;
  viewCount: number;
}

export interface RecruiterReportData {
  header: RecruiterReportHeader;
  range: RecruiterReportRange;
  generatedAt: string;
  kpis: {
    activeOpportunities: number;
    totalApplications: number;
    interviews: number;
    offersSent: number;
    hired: number;
    rejected: number;
    withdrawn: number;
  };
  applicationsByStatus: Array<{ status: string; count: number }>;
  contactRequests: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
  };
  contractStatusSummary: Array<{ status: string; count: number }>;
  opportunitiesBlockedByContract: Array<{
    applicationId: string;
    opportunityTitle: string;
    applicationStatus: string;
    contractStatus: string;
  }>;
  topOpportunities: Array<{ title: string; applications: number; viewCount: number }>;
  pipeline: PipelineRow[];
  isEmpty: boolean;
}

const inRange = (iso: string, range: RecruiterReportRange): boolean => {
  try {
    const d = parseISO(iso);
    return isWithinInterval(d, {
      start: parseISO(range.from),
      end: endOfDay(parseISO(range.to)),
    });
  } catch {
    return false;
  }
};

const countBy = <T,>(rows: T[], key: (r: T) => string): Array<{ status: string; count: number }> => {
  const m = new Map<string, number>();
  rows.forEach(r => {
    const k = key(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  });
  return [...m.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
};

export function aggregateRecruiterReport(input: RecruiterReportInput): RecruiterReportData {
  const { header, range, applications, opportunities, events, contactRequests, contracts } = input;

  // Filter rows to the date range (created_at for apps, contact requests, events).
  const apps = applications.filter(a => inRange(a.created_at, range));
  const eventsInRange = events.filter(e => inRange(e.created_at, range));
  const contactReq = contactRequests.filter(c => inRange(c.created_at, range));

  const appById = new Map(applications.map(a => [a.id, a]));
  const oppById = new Map(opportunities.map(o => [o.id, o]));

  // KPIs from application status (source of truth for status breakdown).
  const statusBreakdown = countBy(apps, a => a.status);
  const statusCount = (s: string) => apps.filter(a => a.status === s).length;

  // Interviews/offers via events as a secondary signal (counted by app+event type)
  const interviewEvents = eventsInRange.filter(e =>
    e.event_type === 'call_scheduled' || e.event_type === 'interviewing'
  );
  const offerEvents = eventsInRange.filter(e => e.event_type === 'offer_sent');

  const interviews = Math.max(
    statusCount('interviewing') + statusCount('call_scheduled') + statusCount('waiting_documents'),
    new Set(interviewEvents.map(e => e.application_id)).size
  );
  const offersSent = Math.max(
    statusCount('offer_sent') + statusCount('hired'),
    new Set(offerEvents.map(e => e.application_id)).size
  );

  // Contracts attached to in-range applications
  const inRangeAppIds = new Set(apps.map(a => a.id));
  const inRangeContracts = contracts.filter(c => inRangeAppIds.has(c.application_id));
  const contractStatusSummary = countBy(inRangeContracts, c => c.status);

  // Opportunities blocked by contract: app in offer_sent (or attempting hire) where
  // a contract exists but status NOT IN (approved, signed).
  const blocked = apps
    .filter(a => a.status === 'offer_sent')
    .map(a => {
      const c = inRangeContracts.find(x => x.application_id === a.id);
      if (!c) return { app: a, contractStatus: 'no_contract' as const };
      if (c.status === 'approved' || c.status === 'signed') return null;
      return { app: a, contractStatus: c.status };
    })
    .filter((x): x is { app: AppRow; contractStatus: string } => x !== null)
    .map(({ app, contractStatus }) => ({
      applicationId: app.id,
      opportunityTitle: oppById.get(app.opportunity_id)?.title ?? '—',
      applicationStatus: app.status,
      contractStatus,
    }));

  // Top opportunities — rank by application count first, then view_count.
  const appsPerOpp = new Map<string, number>();
  apps.forEach(a => appsPerOpp.set(a.opportunity_id, (appsPerOpp.get(a.opportunity_id) ?? 0) + 1));
  const topOpportunities = opportunities
    .map(o => ({
      title: o.title,
      applications: appsPerOpp.get(o.id) ?? 0,
      viewCount: Math.max(0, Number(o.view_count ?? 0)),
    }))
    .sort((a, b) => b.applications - a.applications || b.viewCount - a.viewCount)
    .slice(0, 5);

  // Pipeline rows (one per opportunity, recruiter-owned only)
  const pipeline: PipelineRow[] = opportunities.map(o => {
    const oppApps = apps.filter(a => a.opportunity_id === o.id);
    const oppAppIds = new Set(oppApps.map(a => a.id));
    const oppEvents = eventsInRange.filter(e => oppAppIds.has(e.application_id));
    const oppContracts = inRangeContracts.filter(c => oppAppIds.has(c.application_id));

    return {
      opportunityId: o.id,
      title: o.title,
      status: o.status,
      applications: oppApps.length,
      interviews: Math.max(
        oppApps.filter(a => ['interviewing', 'call_scheduled', 'waiting_documents'].includes(a.status)).length,
        new Set(oppEvents.filter(e => e.event_type === 'call_scheduled' || e.event_type === 'interviewing').map(e => e.application_id)).size
      ),
      offers: Math.max(
        oppApps.filter(a => a.status === 'offer_sent' || a.status === 'hired').length,
        new Set(oppEvents.filter(e => e.event_type === 'offer_sent').map(e => e.application_id)).size
      ),
      hired: oppApps.filter(a => a.status === 'hired').length,
      rejected: oppApps.filter(a => a.status === 'rejected').length,
      withdrawn: oppApps.filter(a => a.status === 'withdrawn').length,
      contractBlocked: oppContracts.filter(c => !['approved', 'signed'].includes(c.status)).length,
      viewCount: Math.max(0, Number(o.view_count ?? 0)),
    };
  }).sort((a, b) => b.applications - a.applications);

  return {
    header,
    range,
    generatedAt: format(new Date(), 'MM/dd/yyyy HH:mm'),
    kpis: {
      activeOpportunities: opportunities.filter(o => o.status === 'active').length,
      totalApplications: apps.length,
      interviews,
      offersSent,
      hired: statusCount('hired'),
      rejected: statusCount('rejected'),
      withdrawn: statusCount('withdrawn'),
    },
    applicationsByStatus: statusBreakdown,
    contactRequests: {
      total: contactReq.length,
      byStatus: countBy(contactReq, c => c.status),
    },
    contractStatusSummary,
    opportunitiesBlockedByContract: blocked,
    topOpportunities,
    pipeline,
    isEmpty:
      apps.length === 0 &&
      opportunities.length === 0 &&
      contactReq.length === 0 &&
      inRangeContracts.length === 0,
  };
}

export const REPORT_TYPE_LABEL: Record<RecruiterReportType, string> = {
  activity: 'Recruiter Activity Report',
  pipeline: 'Recruiter Pipeline Report',
};
