import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export type VerifiedStatus = 'available' | 'limited' | 'full';

export interface ParkingVerificationRow {
  id: string;
  parking_id: string;
  // user_id intentionally omitted — sourced from parking_verifications_public view.
  verified_status: VerifiedStatus;
  created_at: string;
}

export function useRecentParkingVerifications() {
  return useQuery({
    queryKey: ['parking-verifications', 'recent'],
    queryFn: async (): Promise<ParkingVerificationRow[]> => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from('parking_verifications_public' as never)
        .select('id,parking_id,verified_status,created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as ParkingVerificationRow[];
    },
    staleTime: 30_000,
  });
}

export function useParkingVerificationsForLocation(parkingId: string | null) {
  return useQuery({
    queryKey: ['parking-verifications', 'location', parkingId],
    enabled: !!parkingId,
    queryFn: async (): Promise<ParkingVerificationRow[]> => {
      const { data, error } = await supabase
        .from('parking_verifications_public' as never)
        .select('id,parking_id,verified_status,created_at')
        .eq('parking_id', parkingId!)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ParkingVerificationRow[];
    },
  });
}

interface SubmitVerificationArgs {
  parkingId: string;
  status: VerifiedStatus;
}

export function useSubmitParkingVerification() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ parkingId, status }: SubmitVerificationArgs) => {
      if (!user) throw new Error('You must be signed in to verify parking');

      const { data: inserted, error: insertErr } = await supabase
        .from('parking_verifications')
        .insert({
          parking_id: parkingId,
          user_id: user.id,
          verified_status: status,
        } as never)
        .select('id')
        .single();
      if (insertErr) {
        if ((insertErr as { code?: string }).code === '23505') {
          throw new Error('You already verified this location recently.');
        }
        throw insertErr;
      }

      const verificationId = (inserted as { id: string }).id;
      const { data: pointsRow, error: pointsErr } = await supabase.rpc(
        'award_parking_verification_points',
        { _verification_id: verificationId },
      );
      if (pointsErr) {
        console.warn('award_parking_verification_points failed:', pointsErr);
      }
      return { pointsRow };
    },
    onSuccess: ({ pointsRow }) => {
      qc.invalidateQueries({ queryKey: ['parking-verifications'] });
      qc.invalidateQueries({ queryKey: ['parking-reports'] });
      qc.invalidateQueries({ queryKey: ['driver-points'] });
      qc.invalidateQueries({ queryKey: ['driver-leaderboard'] });
      const streak = (pointsRow as { streak_days?: number } | null)?.streak_days ?? 0;
      toast.success('+3 points earned · Parking verified', {
        description: streak > 0 ? `🔥 ${streak} day streak` : undefined,
      });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Could not submit verification');
    },
  });
}
