import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

type ReportStatus = 'available' | 'limited' | 'full';

interface SubmitReportArgs {
  parkingId: string;
  status: ReportStatus;
  safetyRating?: number;
  notes?: string;
}

export function useSubmitParkingReport() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ parkingId, status, safetyRating, notes }: SubmitReportArgs) => {
      if (!user) throw new Error('You must be signed in to report parking');

      // Anti-spam: 1 report per location per user per hour.
      const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      const { data: existing, error: existingErr } = await supabase
        .from('parking_reports')
        .select('id')
        .eq('parking_id', parkingId)
        .eq('user_id', user.id)
        .gte('created_at', oneHourAgo)
        .limit(1);
      if (existingErr) throw existingErr;
      if (existing && existing.length > 0) {
        throw new Error('You already reported this lot in the last hour');
      }

      const { data: inserted, error: insertErr } = await supabase
        .from('parking_reports')
        .insert({
          parking_id: parkingId,
          user_id: user.id,
          status,
          safety_rating: safetyRating ?? null,
          notes: notes ?? null,
        } as never)
        .select('id')
        .single();
      if (insertErr) {
        // 23505 = unique_violation from parking_reports_one_per_hour index
        if ((insertErr as { code?: string }).code === '23505') {
          throw new Error('You already reported this lot in the last hour');
        }
        throw insertErr;
      }

      // Award points (5 for a report) via event-bound RPC — ledger-deduped server-side.
      const reportId = (inserted as { id: string }).id;
      const { data: pointsRow, error: pointsErr } = await supabase.rpc(
        'award_parking_report_points',
        { _report_id: reportId },
      );
      if (pointsErr) {
        // Non-fatal — the report was saved.
        console.warn('award_parking_report_points failed:', pointsErr);
      }

      return { pointsRow };
    },
    onSuccess: ({ pointsRow }) => {
      qc.invalidateQueries({ queryKey: ['parking-reports'] });
      qc.invalidateQueries({ queryKey: ['driver-points'] });
      qc.invalidateQueries({ queryKey: ['driver-leaderboard'] });
      const streak = (pointsRow as { streak_days?: number } | null)?.streak_days ?? 0;
      toast.success('+5 points earned', {
        description: streak > 0 ? `🔥 ${streak} day streak` : 'Thanks for helping drivers',
      });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Could not submit report');
    },
  });
}
