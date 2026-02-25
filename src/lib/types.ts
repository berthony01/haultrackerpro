// Re-export the DB-driven Load type from the hook
export type { Load, LoadInsert, LoadUpdate } from '@/hooks/useLoads';

export interface WeekSummary {
  weekLabel: string;
  startDate: string;
  endDate: string;
  totalLoads: number;
  totalLoadedMiles: number;
  totalDeadheadMiles: number;
  totalEstimatedPay: number;
  totalActualPay: number;
  avgRatePerMile: number;
}

export function calculateEstimatedPay(loadedMiles: number, ratePerMile: number, waitFee: number, detentionFee: number): number {
  return (loadedMiles * ratePerMile) + waitFee + detentionFee;
}
