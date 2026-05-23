import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export type RecruiterReferralSettings = Tables<'recruiter_referral_settings'>;

export type PaymentTrigger =
  | 'on_hire'
  | 'after_waiting_period'
  | 'recruiter_defined'
  | 'other';

export const PAYMENT_TRIGGER_LABELS: Record<PaymentTrigger, string> = {
  on_hire: 'When referred driver is hired',
  after_waiting_period: 'After waiting period',
  recruiter_defined: 'Recruiter-defined terms',
  other: 'Other',
};

export const DEFAULT_EXTERNAL_PAYMENT_DISCLAIMER =
  'Referral bonuses, if offered, are paid externally by the recruiter. Haul Tracker Pro tracks referral progress only and does not process or guarantee payments.';

export interface ReferralSettingsInput {
  referral_bonus_enabled: boolean;
  bonus_amount: number | null;
  payment_trigger: PaymentTrigger | null;
  waiting_period_days: number | null;
  bonus_terms: string | null;
}

export function useRecruiterReferralSettings(recruiterId?: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['recruiter_referral_settings', recruiterId],
    enabled: !!recruiterId,
    queryFn: async (): Promise<RecruiterReferralSettings | null> => {
      if (!recruiterId) return null;
      const { data, error } = await supabase
        .from('recruiter_referral_settings')
        .select('*')
        .eq('recruiter_id', recruiterId)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  const upsert = useMutation({
    mutationFn: async (input: ReferralSettingsInput) => {
      if (!recruiterId) throw new Error('Missing recruiter profile');

      // Validation
      if (input.bonus_amount != null && input.bonus_amount < 0) {
        throw new Error('Bonus amount cannot be negative');
      }
      if (input.waiting_period_days != null && input.waiting_period_days < 0) {
        throw new Error('Waiting period cannot be negative');
      }
      const validTriggers: PaymentTrigger[] = [
        'on_hire',
        'after_waiting_period',
        'recruiter_defined',
        'other',
      ];
      if (input.payment_trigger && !validTriggers.includes(input.payment_trigger)) {
        throw new Error('Invalid payment trigger');
      }

      const payload: TablesInsert<'recruiter_referral_settings'> = {
        recruiter_id: recruiterId,
        referral_bonus_enabled: input.referral_bonus_enabled,
        bonus_amount: input.referral_bonus_enabled ? input.bonus_amount : null,
        payment_trigger: input.referral_bonus_enabled ? input.payment_trigger : null,
        waiting_period_days: input.referral_bonus_enabled ? input.waiting_period_days : null,
        bonus_terms: input.referral_bonus_enabled
          ? (input.bonus_terms?.trim() || null)
          : null,
      };

      const { data, error } = await supabase
        .from('recruiter_referral_settings')
        .upsert(payload, { onConflict: 'recruiter_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recruiter_referral_settings', recruiterId] });
    },
  });

  return {
    settings: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    upsert,
  };
}
