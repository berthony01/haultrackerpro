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

export type ReferralDecision = 'yes' | 'no' | 'later';

const VALID_TRIGGERS: PaymentTrigger[] = [
  'on_hire',
  'after_waiting_period',
  'recruiter_defined',
  'other',
];

function validateDetails(details: ReferralSettingsInput) {
  if (details.bonus_amount != null) {
    if (Number.isNaN(details.bonus_amount) || details.bonus_amount < 0) {
      throw new Error('Bonus amount cannot be negative');
    }
  }
  if (details.waiting_period_days != null) {
    if (
      Number.isNaN(details.waiting_period_days) ||
      details.waiting_period_days < 0 ||
      !Number.isInteger(details.waiting_period_days)
    ) {
      throw new Error('Waiting period must be a non-negative whole number');
    }
  }
  if (details.payment_trigger && !VALID_TRIGGERS.includes(details.payment_trigger)) {
    throw new Error('Invalid payment trigger');
  }
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

      validateDetails(input);

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

  // Phase 1Q-A — narrowly scoped onboarding mutation. Persists a
  // recruiter's referral-bonus decision as part of the onboarding save,
  // using an EXPLICIT recruiterId (post-refetch profile id) so we never
  // rely on hook-scoped recruiterId drift. Never bypasses RLS.
  const saveDecision = useMutation({
    mutationFn: async (args: {
      recruiterId: string;
      decision: ReferralDecision;
      details: ReferralSettingsInput;
    }) => {
      const rid = args.recruiterId;
      if (!rid || typeof rid !== 'string' || !rid.trim()) {
        throw new Error('Missing recruiter profile');
      }

      if (args.decision === 'later') {
        const { error } = await supabase
          .from('recruiter_referral_settings')
          .delete()
          .eq('recruiter_id', rid);
        if (error) throw error;
        return { decision: 'later' as const };
      }

      if (args.decision === 'yes') {
        validateDetails(args.details);
      }

      const enabled = args.decision === 'yes';
      const payload: TablesInsert<'recruiter_referral_settings'> = {
        recruiter_id: rid,
        referral_bonus_enabled: enabled,
        bonus_amount: enabled ? args.details.bonus_amount : null,
        payment_trigger: enabled ? args.details.payment_trigger : null,
        waiting_period_days: enabled ? args.details.waiting_period_days : null,
        bonus_terms: enabled ? (args.details.bonus_terms?.trim() || null) : null,
      };

      const { data, error } = await supabase
        .from('recruiter_referral_settings')
        .upsert(payload, { onConflict: 'recruiter_id' })
        .select()
        .single();
      if (error) throw error;
      return { decision: args.decision, row: data };
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
    saveDecision,
  };
}
