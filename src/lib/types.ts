export interface Load {
  id: string;
  date: string;
  pickup: string;
  dropoff: string;
  loadedMiles: number;
  deadheadMiles: number;
  ratePerMile: number;
  waitFee: number;
  detentionFee: number;
  totalPay: number;
  createdAt: string;
}

export interface WeekSummary {
  weekLabel: string;
  startDate: string;
  endDate: string;
  totalLoads: number;
  totalLoadedMiles: number;
  totalDeadheadMiles: number;
  totalPay: number;
  avgRatePerMile: number;
}

export function calculateTotalPay(load: Omit<Load, 'id' | 'totalPay' | 'createdAt'>): number {
  return (load.loadedMiles * load.ratePerMile) + load.waitFee + load.detentionFee;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}
