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
      // Reads the sanitized public view (no reporter user_id exposed).
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from('parking_reports_public' as never)
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
        .from('parking_reports_public' as never)
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

interface SignalLike {
  parking_id: string;
  created_at: string;
  status?: 'available' | 'limited' | 'full';
  verified_status?: 'available' | 'limited' | 'full';
}

export function computeConfidence(
  reports: ParkingReportRow[],
  verificationsOrParkingId: { parking_id: string; created_at: string; verified_status: 'available' | 'limited' | 'full' }[] | string,
  parkingIdMaybe?: string,
): {
  level: Confidence;
  lastReportAt: string | null;
  lastSignalAt: string | null;
  lastSignalKind: 'report' | 'verification' | null;
  lastSignalStatus: 'available' | 'limited' | 'full' | null;
  recentCount: number;
} {
  // Back-compat: old signature was computeConfidence(reports, parkingId).
  let verifications: { parking_id: string; created_at: string; verified_status: 'available' | 'limited' | 'full' }[] = [];
  let parkingId: string;
  if (typeof verificationsOrParkingId === 'string') {
    parkingId = verificationsOrParkingId;
  } else {
    verifications = verificationsOrParkingId;
    parkingId = parkingIdMaybe ?? '';
  }

  const now = Date.now();

  const reportSignals: SignalLike[] = reports
    .filter((r) => r.parking_id === parkingId)
    .map((r) => ({ parking_id: r.parking_id, created_at: r.created_at, status: r.status }));
  const verifSignals: SignalLike[] = verifications
    .filter((v) => v.parking_id === parkingId)
    .map((v) => ({ parking_id: v.parking_id, created_at: v.created_at, verified_status: v.verified_status }));

  const all = [...reportSignals, ...verifSignals].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const last2h = all.filter((s) => now - new Date(s.created_at).getTime() < 2 * 3600 * 1000);
  const last24h = all;
  const lastReportAt = reportSignals[0]?.created_at ?? null;
  const lastSignal = all[0] ?? null;
  const lastSignalAt = lastSignal?.created_at ?? null;
  const lastSignalKind: 'report' | 'verification' | null = lastSignal
    ? lastSignal.verified_status
      ? 'verification'
      : 'report'
    : null;
  const lastSignalStatus = lastSignal
    ? (lastSignal.verified_status ?? lastSignal.status ?? null)
    : null;

  // Fresh "full" signals shouldn't boost availability — drop them from the freshness count.
  const freshPositive = last2h.filter((s) => {
    const st = s.verified_status ?? s.status;
    return st === 'available' || st === 'limited';
  });
  const recentPositive = last24h.filter((s) => {
    const st = s.verified_status ?? s.status;
    return st === 'available' || st === 'limited';
  });

  let level: Confidence = 'low';
  if (freshPositive.length >= 1 && recentPositive.length >= 2) level = 'high';
  else if (recentPositive.length >= 1) level = 'medium';

  return {
    level,
    lastReportAt,
    lastSignalAt,
    lastSignalKind,
    lastSignalStatus,
    recentCount: last24h.length,
  };
}
