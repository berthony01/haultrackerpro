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

/**
 * Plain-object guard. Supabase JSON payloads carry Object.prototype (or a null
 * prototype); arrays, class instances and exotic objects are rejected.
 */
const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * Defense-in-depth unknown-key rejection: an accidental future server addition
 * of a PII / billing / driver-financial field must fail closed rather than
 * flow into client state.
 */
const keysExactly = (o: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const keys = Object.keys(o);
  if (keys.length !== allowed.length) return false;
  for (const k of allowed) if (!Object.prototype.hasOwnProperty.call(o, k)) return false;
  for (const k of keys) if (!allowed.includes(k)) return false;
  return true;
};

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNonEmptyStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isFiniteNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const TOP_LEVEL_KEYS = [
  'header',
  'range',
  'opportunities',
  'applications',
  'events',
  'contactRequests',
  'contracts',
] as const;

const HEADER_KEYS = [
  'companyName',
  'recruiterName',
  'verificationStatus',
  'audience',
  'plan',
  'planStatus',
  'activeLimit',
  'activeCount',
] as const;

const RANGE_KEYS = ['from', 'to', 'label'] as const;

const OPPORTUNITY_KEYS = ['id', 'title', 'status', 'view_count', 'published_at'] as const;
const APPLICATION_KEYS = [
  'id',
  'opportunity_id',
  'status',
  'created_at',
  'updated_at',
] as const;
const EVENT_KEYS = ['application_id', 'event_type', 'created_at'] as const;
const CONTACT_REQUEST_KEYS = ['id', 'status', 'created_at'] as const;
const CONTRACT_KEYS = ['id', 'application_id', 'status', 'updated_at'] as const;

/**
 * Validate every row of a required collection. A single malformed row rejects
 * the ENTIRE payload — rows are never silently dropped or repaired.
 */
function validateRows<T>(
  value: unknown,
  allowedKeys: readonly string[],
  check: (row: Record<string, unknown>) => boolean,
  project: (row: Record<string, unknown>) => T,
): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) return null;
    if (!keysExactly(raw, allowedKeys)) return null;
    if (!check(raw)) return null;
    out.push(project(raw));
  }
  return out;
}

/**
 * Strict, fail-closed normalization. Anything malformed yields `null`, which
 * the panel renders as an unavailable state — never partial report data.
 *
 * The server header must ITSELF assert the staff-safe contract
 * (audience=staff, plan=workspace, planStatus=authorized, activeLimit=0); an
 * unsafe server value is rejected, never silently overwritten with a safe one.
 */
export function normalizeRecruiterStaffReportPayload(
  payload: unknown,
  range: RecruiterReportRange,
): RecruiterReportInput | null {
  // A + B — top-level shape and exact key allowlist.
  if (!isPlainObject(payload)) return null;
  if (!keysExactly(payload, TOP_LEVEL_KEYS)) return null;

  const p = payload;
  if (!isPlainObject(p.header)) return null;
  if (!isPlainObject(p.range)) return null;

  // C — server range must match the requested range exactly.
  const serverRange = p.range;
  if (!keysExactly(serverRange, RANGE_KEYS)) return null;
  if (!isStr(serverRange.label)) return null;
  if (serverRange.from !== range.from || serverRange.to !== range.to) return null;

  // D — header must confirm the staff-safe server contract.
  const header = p.header;
  if (!keysExactly(header, HEADER_KEYS)) return null;
  if (!isNonEmptyStr(header.companyName)) return null;
  if (!isNonEmptyStr(header.recruiterName)) return null;
  if (!isStr(header.verificationStatus)) return null;
  if (header.audience !== 'staff') return null;
  if (header.plan !== 'workspace') return null;
  if (header.planStatus !== 'authorized') return null;
  if (header.activeLimit !== 0) return null;
  if (!isFiniteNum(header.activeCount) || header.activeCount < 0) return null;

  // E + F — every row of every required collection is validated.
  const opportunities = validateRows(
    p.opportunities,
    OPPORTUNITY_KEYS,
    r =>
      isNonEmptyStr(r.id) &&
      isStr(r.title) &&
      isStr(r.status) &&
      (r.view_count === null || isFiniteNum(r.view_count)) &&
      (r.published_at === null || isStr(r.published_at)),
    r => ({
      id: r.id as string,
      title: r.title as string,
      status: r.status as string,
      view_count: r.view_count as number | null,
      published_at: r.published_at as string | null,
    }),
  );
  if (!opportunities) return null;

  const applications = validateRows(
    p.applications,
    APPLICATION_KEYS,
    r =>
      isNonEmptyStr(r.id) &&
      isNonEmptyStr(r.opportunity_id) &&
      isStr(r.status) &&
      isNonEmptyStr(r.created_at) &&
      isNonEmptyStr(r.updated_at),
    r => ({
      id: r.id as string,
      opportunity_id: r.opportunity_id as string,
      status: r.status as string,
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
    }),
  );
  if (!applications) return null;

  const events = validateRows(
    p.events,
    EVENT_KEYS,
    r =>
      isNonEmptyStr(r.application_id) &&
      isNonEmptyStr(r.event_type) &&
      isNonEmptyStr(r.created_at),
    r => ({
      application_id: r.application_id as string,
      event_type: r.event_type as string,
      created_at: r.created_at as string,
    }),
  );
  if (!events) return null;

  const contactRequests = validateRows(
    p.contactRequests,
    CONTACT_REQUEST_KEYS,
    r => isNonEmptyStr(r.id) && isStr(r.status) && isNonEmptyStr(r.created_at),
    r => ({
      id: r.id as string,
      status: r.status as string,
      created_at: r.created_at as string,
    }),
  );
  if (!contactRequests) return null;

  const contracts = validateRows(
    p.contracts,
    CONTRACT_KEYS,
    r =>
      isNonEmptyStr(r.id) &&
      isNonEmptyStr(r.application_id) &&
      isStr(r.status) &&
      isNonEmptyStr(r.updated_at),
    r => ({
      id: r.id as string,
      application_id: r.application_id as string,
      status: r.status as string,
      updated_at: r.updated_at as string,
    }),
  );
  if (!contracts) return null;

  // G — only now is a normalized input returned.
  return {
    header: {
      companyName: header.companyName,
      recruiterName: header.recruiterName,
      verificationStatus: header.verificationStatus,
      // Neutral compatibility values only — never a real plan/billing label.
      plan: 'workspace',
      planStatus: 'authorized',
      activeLimit: 0,
      activeCount: header.activeCount,
      audience: 'staff',
    },
    // Requested range is retained for display (label included).
    range,
    opportunities,
    applications,
    events,
    contactRequests,
    contracts,
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
