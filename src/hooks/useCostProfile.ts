import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface CostProfile {
  id: string;
  user_id: string;
  // Fixed monthly
  truck_payment: number | null;
  trailer_payment: number | null;
  insurance_monthly: number | null;
  permits_licensing_monthly: number | null;
  eld_software_monthly: number | null;
  other_fixed_monthly: number | null;
  // Per-mile variable
  avg_mpg: number | null;
  diesel_price_per_gallon: number | null;
  maintenance_per_mile: number | null;
  tires_per_mile: number | null;
  tolls_per_mile: number | null;
  // Per-day
  meals_per_day: number | null;
  lodging_per_day: number | null;
  // Targets
  min_margin_pct: number | null;
  min_rpm: number | null;
  days_per_1000_miles: number | null;
  estimated_monthly_miles: number | null;
  created_at: string;
  updated_at: string;
}

export type CostProfileUpdate = Partial<Omit<CostProfile, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

/**
 * Determines whether the cost profile has enough data to drive a per-load CPM.
 * Treats "any per-mile or fuel input" as the minimum viable profile.
 */
export function profileHasUsableData(p: CostProfile | null | undefined): boolean {
  if (!p) return false;
  const fuelOk = (p.avg_mpg ?? 0) > 0 && (p.diesel_price_per_gallon ?? 0) > 0;
  const anyVariable =
    (p.maintenance_per_mile ?? 0) > 0 ||
    (p.tires_per_mile ?? 0) > 0 ||
    (p.tolls_per_mile ?? 0) > 0;
  const anyFixed =
    (p.truck_payment ?? 0) > 0 ||
    (p.insurance_monthly ?? 0) > 0 ||
    (p.trailer_payment ?? 0) > 0 ||
    (p.permits_licensing_monthly ?? 0) > 0 ||
    (p.eld_software_monthly ?? 0) > 0 ||
    (p.other_fixed_monthly ?? 0) > 0;
  return fuelOk || anyVariable || (anyFixed && (p.estimated_monthly_miles ?? 0) > 0);
}

/**
 * Compute estimated cost-per-mile for a hypothetical load using the driver's
 * pre-registered cost profile. Returns 0 when profile is unusable.
 *
 * Formula:
 *   fuel CPM       = diesel_price / avg_mpg
 * + maintenance    = $/mi
 * + tires          = $/mi
 * + tolls          = $/mi
 * + fixed share    = sum(monthly fixed) / estimated_monthly_miles
 * + per-day share  = (meals + lodging) * days_for_load / total_miles
 *
 * where days_for_load = total_miles / 1000 * days_per_1000_miles (default 2.5)
 */
export type CPMBreakdownKey =
  | 'fuel'
  | 'maintenance'
  | 'tires'
  | 'tolls'
  | 'truck'
  | 'trailer'
  | 'insurance'
  | 'permits'
  | 'eld'
  | 'otherFixed'
  | 'perDay';

/** Display label for each breakdown bucket. */
export const CPM_BREAKDOWN_LABELS: Record<CPMBreakdownKey, string> = {
  fuel: 'fuel',
  maintenance: 'maintenance',
  tires: 'tires',
  tolls: 'tolls',
  truck: 'truck',
  trailer: 'trailer',
  insurance: 'insurance',
  permits: 'permits',
  eld: 'eld',
  otherFixed: 'other fixed',
  perDay: 'per-day',
};

export function computeCostProfileCPM(
  p: CostProfile | null | undefined,
  totalMiles: number,
): { cpm: number; breakdown: Record<string, number>; warnings: string[] } {
  if (!p || totalMiles <= 0) return { cpm: 0, breakdown: {}, warnings: [] };

  const breakdown: Record<string, number> = {};
  const warnings: string[] = [];

  // Fuel
  const mpg = Number(p.avg_mpg ?? 0);
  const diesel = Number(p.diesel_price_per_gallon ?? 0);
  if (mpg > 0 && diesel > 0) {
    breakdown.fuel = diesel / mpg;
  }

  // Per-mile variables
  if ((p.maintenance_per_mile ?? 0) > 0) breakdown.maintenance = Number(p.maintenance_per_mile);
  if ((p.tires_per_mile ?? 0) > 0) breakdown.tires = Number(p.tires_per_mile);
  if ((p.tolls_per_mile ?? 0) > 0) breakdown.tolls = Number(p.tolls_per_mile);

  // Fixed share — itemized per line so drivers can see what each monthly bill costs per mile.
  const monthlyMiles = Number(p.estimated_monthly_miles ?? 0);
  const fixedItems: Array<[CPMBreakdownKey, number]> = [
    ['truck', Number(p.truck_payment ?? 0)],
    ['trailer', Number(p.trailer_payment ?? 0)],
    ['insurance', Number(p.insurance_monthly ?? 0)],
    ['permits', Number(p.permits_licensing_monthly ?? 0)],
    ['eld', Number(p.eld_software_monthly ?? 0)],
    ['otherFixed', Number(p.other_fixed_monthly ?? 0)],
  ];
  const fixedTotal = fixedItems.reduce((s, [, v]) => s + v, 0);
  if (monthlyMiles > 0) {
    for (const [key, amount] of fixedItems) {
      if (amount > 0) breakdown[key] = amount / monthlyMiles;
    }
  } else if (fixedTotal > 0) {
    warnings.push('fixed_missing_monthly_miles');
  }

  // Per-day share
  const daysPer1k = Number(p.days_per_1000_miles ?? 2.5) || 2.5;
  const days = (totalMiles / 1000) * daysPer1k;
  const perDay = Number(p.meals_per_day ?? 0) + Number(p.lodging_per_day ?? 0);
  if (days > 0 && perDay > 0) {
    breakdown.perDay = (perDay * days) / totalMiles;
  }

  const cpm = Object.values(breakdown).reduce((s, v) => s + v, 0);
  return { cpm, breakdown, warnings };
}

export function useCostProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['cost_profile', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('cost_profile' as any)
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as CostProfile) ?? null;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const upsertProfile = useMutation({
    mutationFn: async (updates: CostProfileUpdate) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('cost_profile' as any)
        .upsert({ user_id: user.id, ...updates } as any, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cost_profile'] }),
  });

  return {
    profile: profileQuery.data ?? null,
    isLoading: profileQuery.isLoading,
    upsertProfile,
    hasUsableData: profileHasUsableData(profileQuery.data),
  };
}
