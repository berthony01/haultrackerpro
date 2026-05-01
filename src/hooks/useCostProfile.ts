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
export function computeCostProfileCPM(
  p: CostProfile | null | undefined,
  totalMiles: number,
): { cpm: number; breakdown: Record<string, number> } {
  if (!p || totalMiles <= 0) return { cpm: 0, breakdown: {} };

  const breakdown: Record<string, number> = {};

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

  // Fixed share (only if monthly miles known)
  const monthlyMiles = Number(p.estimated_monthly_miles ?? 0);
  if (monthlyMiles > 0) {
    const fixed =
      Number(p.truck_payment ?? 0) +
      Number(p.trailer_payment ?? 0) +
      Number(p.insurance_monthly ?? 0) +
      Number(p.permits_licensing_monthly ?? 0) +
      Number(p.eld_software_monthly ?? 0) +
      Number(p.other_fixed_monthly ?? 0);
    if (fixed > 0) breakdown.fixed = fixed / monthlyMiles;
  }

  // Per-day share
  const daysPer1k = Number(p.days_per_1000_miles ?? 2.5) || 2.5;
  const days = (totalMiles / 1000) * daysPer1k;
  const perDay = Number(p.meals_per_day ?? 0) + Number(p.lodging_per_day ?? 0);
  if (days > 0 && perDay > 0) {
    breakdown.perDay = (perDay * days) / totalMiles;
  }

  const cpm = Object.values(breakdown).reduce((s, v) => s + v, 0);
  return { cpm, breakdown };
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
