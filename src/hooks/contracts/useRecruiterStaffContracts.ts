/**
 * Phase RC-1G — recruiter STAFF contract pipeline hook.
 *
 * Reads ONLY the safe SECURITY DEFINER RPC `list_recruiter_contract_pipeline_safe`,
 * which itself requires `contracts_view` on the selected recruiter workspace.
 * The database is authoritative; the booleans passed in here are UX only.
 *
 * Deliberately mounts NO owner surface: no recruiter profile hook, no billing /
 * subscription / checkout hook, no Agency hook, no reports/settlements hook,
 * and no direct `opportunity_applications` or `contracts` table query.
 *
 * The query key is scoped by authenticated user id AND recruiter workspace id
 * so no payload can be served across accounts or workspaces from cache.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface RecruiterStaffContractRow {
  applicationId: string;
  applicationStatus: string | null;
  driverProfileId: string | null;
  driverFullName: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  opportunityCompanyName: string | null;
  contractId: string | null;
  contractStatus: string | null;
  currentVersionId: string | null;
  riskTier: string | null;
  updatedAt: string | null;
  hasDriverSignature: boolean;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function normalize(raw: unknown): RecruiterStaffContractRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const applicationId = str(r.application_id);
  if (!applicationId) return null;
  const driver = (r.driver_profile ?? null) as Record<string, unknown> | null;
  const opp = (r.opportunity ?? null) as Record<string, unknown> | null;
  return {
    applicationId,
    applicationStatus: str(r.application_status),
    driverProfileId: driver ? str(driver.id) : null,
    driverFullName: driver ? str(driver.full_name) : null,
    opportunityId: opp ? str(opp.id) : null,
    opportunityTitle: opp ? str(opp.title) : null,
    opportunityCompanyName: opp ? str(opp.company_name) : null,
    contractId: str(r.contract_id),
    contractStatus: str(r.contract_status),
    currentVersionId: str(r.current_version_id),
    riskTier: str(r.risk_tier),
    updatedAt: str(r.contract_updated_at),
    hasDriverSignature: r.has_driver_signature === true,
  };
}

export function useRecruiterStaffContracts(args: {
  recruiterId: string | null | undefined;
  canViewContracts: boolean;
}) {
  const { user } = useAuth();
  const recruiterId = args.recruiterId ?? null;
  const canView = args.canViewContracts === true;

  const query = useQuery({
    queryKey: ['recruiter_staff_contracts', user?.id, recruiterId],
    enabled: !!user && !!recruiterId && canView,
    queryFn: async (): Promise<RecruiterStaffContractRow[]> => {
      if (!user || !recruiterId || !canView) return [];
      const { data, error } = await (supabase as any).rpc(
        'list_recruiter_contract_pipeline_safe',
        { _recruiter_id: recruiterId },
      );
      if (error) throw error;
      return ((data ?? []) as unknown[])
        .map(normalize)
        .filter((r): r is RecruiterStaffContractRow => r !== null);
    },
  });

  const rows = useMemo(
    () => (canView ? (query.data ?? []) : []),
    [canView, query.data],
  );

  return {
    rows,
    isLoading: canView ? query.isLoading : false,
    isError: canView ? query.isError : false,
    error: query.error,
    refetch: query.refetch,
  };
}
