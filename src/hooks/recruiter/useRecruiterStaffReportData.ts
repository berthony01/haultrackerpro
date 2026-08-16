/**
 * Phase RC-1H — recruiter STAFF reporting data hook.
 *
 * Reads ONLY the two safe SECURITY DEFINER RPCs:
 *   * get_recruiter_staff_report_view_data   (requires reports_view)
 *   * get_recruiter_staff_report_export_data (requires reports_view AND reports_export)
 *
 * The database is authoritative. The booleans passed in here are UX only.
 *
 * Deliberately mounts NO owner surface: no recruiter profile hook, no
 * billing / subscription / checkout hook, no Agency hook, and NO direct table
 * query of any kind. The query key is scoped by authenticated user id AND
 * recruiter workspace id AND range so no payload can be served across
 * accounts, workspaces, or ranges from cache.
 */
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type {
  RecruiterReportInput,
  RecruiterReportRange,
} from '@/lib/recruiterReports/aggregator';

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    : [];

/**
 * Strict, fail-closed normalization. Anything malformed yields `null`, which
 * the panel renders as an unavailable state — never partial report data.
 */
export function normalizeRecruiterStaffReportPayload(
  payload: unknown,
  range: RecruiterReportRange,
): RecruiterReportInput | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const h = p.header;
  if (!h || typeof h !== 'object' || Array.isArray(h)) return null;
  const header = h as Record<string, unknown>;

  const companyName = str(header.companyName);
  const recruiterName = str(header.recruiterName);
  if (!companyName || !recruiterName) return null;

  return {
    header: {
      companyName,
      recruiterName,
      verificationStatus: str(header.verificationStatus) ?? 'unknown',
      // Neutral compatibility values only — never a real plan/billing label.
      plan: 'workspace',
      planStatus: 'authorized',
      activeLimit: 0,
      activeCount: num(header.activeCount),
      audience: 'staff',
    },
    range,
    opportunities: arr(p.opportunities)
      .map(o => ({
        id: str(o.id) ?? '',
        title: str(o.title) ?? '—',
        status: str(o.status) ?? 'unknown',
        view_count: typeof o.view_count === 'number' ? o.view_count : 0,
        published_at: str(o.published_at),
      }))
      .filter(o => o.id !== ''),
    applications: arr(p.applications)
      .map(a => ({
        id: str(a.id) ?? '',
        opportunity_id: str(a.opportunity_id) ?? '',
        status: str(a.status) ?? 'unknown',
        created_at: str(a.created_at) ?? '',
        updated_at: str(a.updated_at) ?? '',
      }))
      .filter(a => a.id !== '' && a.created_at !== ''),
    events: arr(p.events)
      .map(e => ({
        application_id: str(e.application_id) ?? '',
        event_type: str(e.event_type) ?? '',
        created_at: str(e.created_at) ?? '',
      }))
      .filter(e => e.application_id !== '' && e.created_at !== ''),
    contactRequests: arr(p.contactRequests)
      .map(c => ({
        id: str(c.id) ?? '',
        status: str(c.status) ?? 'unknown',
        created_at: str(c.created_at) ?? '',
      }))
      .filter(c => c.id !== '' && c.created_at !== ''),
    contracts: arr(p.contracts)
      .map(c => ({
        id: str(c.id) ?? '',
        application_id: str(c.application_id) ?? '',
        status: str(c.status) ?? 'unknown',
        updated_at: str(c.updated_at) ?? '',
      }))
      .filter(c => c.id !== '' && c.application_id !== ''),
  };
}

export function useRecruiterStaffReportData(args: {
  recruiterId: string | null | undefined;
  range: RecruiterReportRange | null;
  canViewReports: boolean;
  canExportReports: boolean;
}) {
  const { user } = useAuth();
  const recruiterId = args.recruiterId ?? null;
  const range = args.range;
  const canView = args.canViewReports === true;
  const canExport = args.canExportReports === true;
  const validRange = !!range && !!range.from && !!range.to && range.from <= range.to;

  const query = useQuery({
    queryKey: [
      'recruiter_staff_report_data',
      user?.id,
      recruiterId,
      range?.from,
      range?.to,
    ],
    enabled: !!user && !!recruiterId && canView && validRange,
    queryFn: async (): Promise<RecruiterReportInput | null> => {
      if (!user || !recruiterId || !range || !canView || !validRange) return null;
      const { data, error } = await (supabase as any).rpc(
        'get_recruiter_staff_report_view_data',
        { _recruiter_id: recruiterId, _from: range.from, _to: range.to },
      );
      if (error) throw error;
      return normalizeRecruiterStaffReportPayload(data, range);
    },
  });

  /**
   * Separate export-authorized fetch. The cached view payload is NEVER used
   * as the official export authorization path.
   */
  const loadExportData = useCallback(async (): Promise<RecruiterReportInput | null> => {
    if (!user || !recruiterId || !range || !canView || !canExport || !validRange) {
      return null;
    }
    const { data, error } = await (supabase as any).rpc(
      'get_recruiter_staff_report_export_data',
      { _recruiter_id: recruiterId, _from: range.from, _to: range.to },
    );
    if (error) throw error;
    return normalizeRecruiterStaffReportPayload(data, range);
  }, [user, recruiterId, range, canView, canExport, validRange]);

  return {
    data: canView ? (query.data ?? null) : null,
    isLoading: canView && validRange ? query.isLoading : false,
    isError: canView ? query.isError : false,
    error: query.error,
    refetch: query.refetch,
    loadExportData,
  };
}
