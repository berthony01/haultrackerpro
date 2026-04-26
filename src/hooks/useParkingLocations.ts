import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ParkingLocation {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  type: 'truck_stop' | 'rest_area' | 'warehouse' | 'street' | 'private';
  is_paid: boolean;
  overnight_allowed: boolean;
  truck_friendly: boolean;
  total_spots: number | null;
  created_by: string | null;
  created_at: string;
}

export interface ParkingReportRow {
  id: string;
  parking_id: string;
  user_id: string;
  status: 'available' | 'limited' | 'full';
  safety_rating: number | null;
  notes: string | null;
  created_at: string;
}

export function useParkingLocations() {
  return useQuery({
    queryKey: ['parking-locations'],
    queryFn: async (): Promise<ParkingLocation[]> => {
      const { data, error } = await supabase
        .from('parking_locations')
        .select('*')
        .order('name', { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ParkingLocation[];
    },
    staleTime: 60_000,
  });
}

export function useRecentParkingReports() {
  return useQuery({
    queryKey: ['parking-reports', 'recent'],
    queryFn: async (): Promise<ParkingReportRow[]> => {
      // Pull last 24h of reports across all locations to compute confidence client-side.
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from('parking_reports')
        .select('*')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as ParkingReportRow[];
    },
    staleTime: 30_000,
  });
}

export function useParkingReportsForLocation(parkingId: string | null) {
  return useQuery({
    queryKey: ['parking-reports', 'location', parkingId],
    enabled: !!parkingId,
    queryFn: async (): Promise<ParkingReportRow[]> => {
      const { data, error } = await supabase
        .from('parking_reports')
        .select('*')
        .eq('parking_id', parkingId!)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ParkingReportRow[];
    },
  });
}

export type Confidence = 'high' | 'medium' | 'low';

export function computeConfidence(reports: ParkingReportRow[], parkingId: string): {
  level: Confidence;
  lastReportAt: string | null;
  recentCount: number;
} {
  const now = Date.now();
  const forLoc = reports.filter((r) => r.parking_id === parkingId);
  const last2h = forLoc.filter((r) => now - new Date(r.created_at).getTime() < 2 * 3600 * 1000);
  const last24h = forLoc;
  const lastReportAt = forLoc[0]?.created_at ?? null;

  let level: Confidence = 'low';
  if (last2h.length >= 1 && last24h.length >= 2) level = 'high';
  else if (last24h.length >= 1) level = 'medium';

  return { level, lastReportAt, recentCount: last24h.length };
}
