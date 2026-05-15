import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type ContractReadiness =
  | 'no_contract'
  | 'awaiting_upload'
  | 'needs_ai_review'
  | 'awaiting_driver_decision'
  | 'changes_requested'
  | 'driver_rejected'
  | 'driver_approved'
  | 'contract_expired'
  | 'contract_archived';

export interface ReadinessInfo {
  readiness: ContractReadiness;
  label: string;
  badgeClass: string;
}

const READINESS_MAP: Record<ContractReadiness, ReadinessInfo> = {
  no_contract: {
    readiness: 'no_contract',
    label: 'No contract attached',
    badgeClass: 'bg-muted text-muted-foreground border-border',
  },
  awaiting_upload: {
    readiness: 'awaiting_upload',
    label: 'Awaiting upload',
    badgeClass: 'bg-muted text-muted-foreground border-border',
  },
  needs_ai_review: {
    readiness: 'needs_ai_review',
    label: 'Needs AI review',
    badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  awaiting_driver_decision: {
    readiness: 'awaiting_driver_decision',
    label: 'Awaiting driver decision',
    badgeClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  changes_requested: {
    readiness: 'changes_requested',
    label: 'Changes requested',
    badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  },
  driver_rejected: {
    readiness: 'driver_rejected',
    label: 'Driver rejected',
    badgeClass: 'bg-red-500/15 text-red-400 border-red-500/30',
  },
  driver_approved: {
    readiness: 'driver_approved',
    label: 'Driver approved',
    badgeClass: 'bg-green-500/15 text-green-400 border-green-500/30',
  },
};

function statusToReadiness(status: string | null, hasVersion: boolean): ContractReadiness {
  if (!status) return 'no_contract';
  if (!hasVersion) return 'awaiting_upload';
  if (status === 'uploaded' || status === 'parsing' || status === 'parsed') return 'needs_ai_review';
  if (status === 'ai_reviewed' || status === 'driver_reviewing') return 'awaiting_driver_decision';
  if (status === 'changes_requested') return 'changes_requested';
  if (status === 'rejected') return 'driver_rejected';
  if (status === 'approved' || status === 'signed') return 'driver_approved';
  if (status === 'expired' || status === 'archived') return 'driver_approved';
  return 'no_contract';
}

export function useContractReadinessMap(applicationIds: string[]) {
  const query = useQuery({
    queryKey: ['contract-readiness-map', applicationIds],
    enabled: applicationIds.length > 0,
    queryFn: async (): Promise<Map<string, ReadinessInfo>> => {
      const map = new Map<string, ReadinessInfo>();
      if (applicationIds.length === 0) return map;

      const { data, error } = await supabase
        .from('contracts')
        .select('application_id, status, current_version_id')
        .in('application_id', applicationIds);

      if (error) throw error;

      for (const appId of applicationIds) {
        const row = data?.find((c) => c.application_id === appId);
        if (!row) {
          map.set(appId, READINESS_MAP.no_contract);
          continue;
        }
        const readiness = statusToReadiness(row.status, !!row.current_version_id);
        map.set(appId, READINESS_MAP[readiness]);
      }
      return map;
    },
  });

  return {
    readinessMap: query.data ?? new Map<string, ReadinessInfo>(),
    isLoading: query.isLoading,
  };
}

export function getReadinessInfo(readiness: ContractReadiness): ReadinessInfo {
  return READINESS_MAP[readiness];
}
