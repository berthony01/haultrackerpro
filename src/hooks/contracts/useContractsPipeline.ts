import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Per-application contract summary used by the driver and recruiter Contracts
 * pages. Read-only and RLS-bound — drivers only see their own, recruiters only
 * see contracts on their own opportunities, admins see all (via existing RLS).
 *
 * We deliberately keep this lightweight (single query against `contracts`,
 * one against `contract_signatures`) so the pages don't fan out one
 * `useApplicationContract` query per row.
 */
export interface ContractsPipelineRow {
  applicationId: string;
  contractId: string | null;
  status: string | null;
  currentVersionId: string | null;
  riskTier: string | null;
  updatedAt: string | null;
  hasDriverSignature: boolean;
}

export function useContractsPipeline(applicationIds: string[]) {
  const sortedKey = [...applicationIds].sort().join(',');

  const query = useQuery({
    queryKey: ['contracts-pipeline', sortedKey],
    enabled: applicationIds.length > 0,
    queryFn: async (): Promise<Map<string, ContractsPipelineRow>> => {
      const map = new Map<string, ContractsPipelineRow>();
      if (applicationIds.length === 0) return map;

      const { data: contracts, error } = await supabase
        .from('contracts')
        .select('id, application_id, status, current_version_id, risk_tier, updated_at')
        .in('application_id', applicationIds);
      if (error) throw error;

      const contractIds = (contracts ?? []).map((c) => c.id);
      let signedContractIds = new Set<string>();
      if (contractIds.length > 0) {
        const { data: sigs, error: sigErr } = await supabase
          .from('contract_signatures')
          .select('contract_id, signer_role, signed_at')
          .in('contract_id', contractIds)
          .eq('signer_role', 'driver')
          .not('signed_at', 'is', null);
        if (sigErr) throw sigErr;
        signedContractIds = new Set((sigs ?? []).map((s) => s.contract_id));
      }

      for (const appId of applicationIds) {
        const row = (contracts ?? []).find((c) => c.application_id === appId) ?? null;
        map.set(appId, {
          applicationId: appId,
          contractId: row?.id ?? null,
          status: row?.status ?? null,
          currentVersionId: row?.current_version_id ?? null,
          riskTier: row?.risk_tier ?? null,
          updatedAt: row?.updated_at ?? null,
          hasDriverSignature: row ? signedContractIds.has(row.id) : false,
        });
      }
      return map;
    },
  });

  return {
    pipeline: query.data ?? new Map<string, ContractsPipelineRow>(),
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** Driver-side filter buckets. */
export type DriverContractsFilter =
  | 'needs_review'
  | 'approved'
  | 'changes_requested'
  | 'rejected'
  | 'signed'
  | 'all';

/** Recruiter-side filter buckets. */
export type RecruiterContractsFilter =
  | 'awaiting_upload'
  | 'uploaded'
  | 'ai_reviewed'
  | 'needs_driver_review'
  | 'approved'
  | 'changes_requested'
  | 'rejected'
  | 'signed'
  | 'blocked'
  | 'all';

const DRIVER_REVIEW_STATUSES = new Set(['ai_reviewed', 'driver_reviewing']);
const PRE_REVIEW_STATUSES = new Set(['uploaded', 'parsing', 'parsed']);

export function matchesDriverFilter(row: ContractsPipelineRow, filter: DriverContractsFilter): boolean {
  if (filter === 'all') return !!row.status;
  const s = row.status;
  switch (filter) {
    case 'needs_review':
      return !!s && DRIVER_REVIEW_STATUSES.has(s);
    case 'approved':
      return s === 'approved';
    case 'changes_requested':
      return s === 'changes_requested';
    case 'rejected':
      return s === 'rejected';
    case 'signed':
      return row.hasDriverSignature || s === 'signed';
    default:
      return false;
  }
}

export function matchesRecruiterFilter(
  row: ContractsPipelineRow,
  filter: RecruiterContractsFilter,
  applicationStatus?: string | null,
): boolean {
  if (filter === 'all') return true;
  const s = row.status;
  switch (filter) {
    case 'awaiting_upload':
      return !s || !row.currentVersionId;
    case 'uploaded':
      return !!s && PRE_REVIEW_STATUSES.has(s);
    case 'ai_reviewed':
      return s === 'ai_reviewed';
    case 'needs_driver_review':
      return !!s && DRIVER_REVIEW_STATUSES.has(s);
    case 'approved':
      return s === 'approved';
    case 'changes_requested':
      return s === 'changes_requested';
    case 'rejected':
      return s === 'rejected';
    case 'signed':
      return row.hasDriverSignature || s === 'signed';
    case 'blocked':
      // Application is moving toward hire but the contract is not yet
      // approved/signed. We treat "offer_sent"/"interviewing" applications
      // with an incomplete contract as hire-blocked from a contract POV.
      if (!applicationStatus) return false;
      const movingToHire = ['offer_sent', 'interviewing', 'waiting_documents'].includes(applicationStatus);
      if (!movingToHire) return false;
      const contractDone = (!!s && (s === 'approved' || s === 'signed')) || row.hasDriverSignature;
      return !contractDone;
    default:
      return false;
  }
}
