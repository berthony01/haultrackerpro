import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables } from '@/integrations/supabase/types';

export type DriverReferral = Tables<'driver_referrals'> & {
  opportunities?: {
    id: string;
    title: string | null;
    company_name: string | null;
    hiring_city: string | null;
    hiring_state: string | null;
  } | null;
};

export type ReferralStatusEvent = Tables<'referral_status_events'>;

export interface CreateDriverReferralInput {
  opportunity_id: string;
  recruiter_id: string;
  referred_driver_name?: string;
  referred_driver_email?: string;
  referred_driver_phone?: string;
  referred_driver_note?: string;
}

/** Driver-facing: list own referrals and create new ones. */
export function useDriverReferrals() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ['driver_referrals', 'driver', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<DriverReferral[]> => {
      if (!user) return [];
      // Phase 26: call the strict RPC `list_my_driver_referrals` instead of a
      // SECURITY DEFINER view. The RPC enforces auth.uid() = referring_driver_id
      // server-side and never returns referred_driver_email / _phone / _note.
      const { data, error } = await (supabase as any).rpc('list_my_driver_referrals');
      if (error) throw error;
      const rows = (data ?? []) as Array<Record<string, any>>;
      return rows.map((r) => ({
        id: r.id,
        opportunity_id: r.opportunity_id,
        recruiter_id: r.recruiter_id,
        referring_driver_id: r.referring_driver_id,
        referred_driver_user_id: r.referred_driver_user_id,
        referred_driver_name: r.referred_driver_name,
        status: r.status,
        last_status_at: r.last_status_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
        opportunities: r.opportunity_id
          ? {
              id: r.opportunity_id,
              title: r.opportunity_title ?? null,
              company_name: r.opportunity_company_name ?? null,
              hiring_city: r.opportunity_hiring_city ?? null,
              hiring_state: r.opportunity_hiring_state ?? null,
            }
          : null,
      })) as unknown as DriverReferral[];
    },
  });

  const create = useMutation({
    mutationFn: async (input: CreateDriverReferralInput) => {
      if (!user) throw new Error('Not authenticated');
      const trim = (v?: string) => {
        const t = (v ?? '').trim();
        return t.length ? t : null;
      };
      const payload = {
        opportunity_id: input.opportunity_id,
        recruiter_id: input.recruiter_id,
        referring_driver_id: user.id,
        referred_driver_name: trim(input.referred_driver_name),
        referred_driver_email: trim(input.referred_driver_email),
        referred_driver_phone: trim(input.referred_driver_phone),
        referred_driver_note: trim(input.referred_driver_note),
      };
      const { data, error } = await supabase
        .from('driver_referrals')
        .insert(payload)
        .select('id')
        .single();
      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('duplicate') || msg.includes('unique')) {
          throw new Error('This referral may already exist for this opportunity.');
        }
        if (
          msg.includes('row-level security') ||
          msg.includes('row level security') ||
          msg.includes('permission')
        ) {
          throw new Error(
            'You can only refer drivers to approved opportunities you can access.',
          );
        }
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver_referrals'] });
    },
  });

  return {
    referrals: list.data ?? [],
    isLoading: list.isLoading,
    isError: list.isError,
    error: list.error,
    refetch: list.refetch,
    create,
  };
}

/** Status timeline events for a single referral. Visible to both parties per RLS. */
export function useReferralEvents(referralId?: string | null) {
  return useQuery({
    queryKey: ['referral_status_events', referralId],
    enabled: !!referralId,
    queryFn: async (): Promise<ReferralStatusEvent[]> => {
      if (!referralId) return [];
      const { data, error } = await supabase
        .from('referral_status_events')
        .select('*')
        .eq('referral_id', referralId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}
