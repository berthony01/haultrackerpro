import { useContext } from 'react';
import {
  QueryClient,
  QueryClientContext,
  useMutation,
  useQuery,
} from '@tanstack/react-query';


import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
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
    if (!Number.isFinite(details.bonus_amount) || details.bonus_amount < 0) {
      throw new Error('Bonus amount must be a non-negative number');
    }
  }
  if (details.waiting_period_days != null) {
    if (
      !Number.isFinite(details.waiting_period_days) ||
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

const VALID_DECISIONS: ReferralDecision[] = ['yes', 'no', 'later'];

let __fallbackQueryClient: QueryClient | null = null;
function getFallbackQueryClient(): QueryClient {
  if (!__fallbackQueryClient) {
    __fallbackQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  }
  return __fallbackQueryClient;
}

export function useRecruiterReferralSettings(recruiterId?: string | null) {
  // Phase 1Q-A — resilient to a missing QueryClientProvider so this hook
  // can be composed into components rendered by legacy render tests that
  // don't wrap the tree in a provider. Production consumers always mount
  // under a real provider; behavior there is unchanged.
  const ambient = useContext(QueryClientContext);
  const qc = ambient ?? getFallbackQueryClient();



  const query = useQuery(
    {
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
    },
    qc,
  );


  const upsert = useMutation(
    {
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
    },
    qc,
  );


  // Phase 1Q-A — narrowly scoped onboarding mutation. Persists a
  // recruiter's referral-bonus decision as part of the onboarding save,
  // using an EXPLICIT recruiterId (post-refetch profile id) so we never
  // rely on hook-scoped recruiterId drift. Never bypasses RLS.
  const saveDecision = useMutation(
    {
      mutationFn: async (args: {
        recruiterId: string;
        decision: ReferralDecision;
        details: ReferralSettingsInput;
      }) => {
        const rid = typeof args.recruiterId === 'string' ? args.recruiterId.trim() : '';
        if (!rid) {
          throw new Error('Missing recruiter profile');
        }
        if (!VALID_DECISIONS.includes(args.decision)) {
          throw new Error('Invalid referral decision');
        }

        if (args.decision === 'later') {
          const { error } = await supabase
            .from('recruiter_referral_settings')
            .delete()
            .eq('recruiter_id', rid);
          if (error) throw error;
          return { decision: 'later' as const, recruiterId: rid };
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
        return { decision: args.decision, row: data, recruiterId: rid };
      },
      onSuccess: (_data, variables) => {
        const rid =
          typeof variables?.recruiterId === 'string'
            ? variables.recruiterId.trim()
            : '';
        if (rid) {
          qc.invalidateQueries({ queryKey: ['recruiter_referral_settings', rid] });
        }
      },
    },
    qc,
  );


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

/**
 * Phase RC-1F — recruiter STAFF referral settings hook.
 *
 * Separate from the owner hook above (unchanged, including onboarding
 * saveDecision). Reads go ONLY through
 * `get_recruiter_referral_settings_for_workspace`, writes ONLY through
 * `upsert_recruiter_referral_settings_for_workspace`. There is no direct
 * `.from('recruiter_referral_settings')` access and NO delete mutation on
 * this path — base-table RLS stays owner-only. Client booleans are UX only;
 * PostgreSQL remains authoritative.
 */
export function useRecruiterStaffReferralSettings(args: {
  recruiterId: string | null | undefined;
  canViewReferrals: boolean;
  canManageReferralTerms: boolean;
}) {
  const ambient = useContext(QueryClientContext);
  const qc = ambient ?? getFallbackQueryClient();
  const { user } = useAuth();

  const recruiterId = args.recruiterId ?? null;
  const canView = args.canViewReferrals === true;
  const canManageTerms = args.canManageReferralTerms === true;
  const canRead = canView || canManageTerms;

  const query = useQuery(
    {
      queryKey: ['recruiter_staff_referral_settings', user?.id, recruiterId],
      enabled: !!user && !!recruiterId && canRead,
      queryFn: async (): Promise<RecruiterReferralSettings | null> => {
        if (!user || !recruiterId || !canRead) return null;
        const { data, error } = await (supabase as any).rpc(
          'get_recruiter_referral_settings_for_workspace',
          { _recruiter_id: recruiterId },
        );
        if (error) throw error;
        return (data ?? null) as RecruiterReferralSettings | null;
      },
    },
    qc,
  );

  const upsert = useMutation(
    {
      mutationFn: async (input: ReferralSettingsInput) => {
        if (!user) throw new Error('Not authenticated');
        if (!recruiterId) throw new Error('Missing recruiter workspace');
        if (!canManageTerms) throw new Error('Not authorized');

        validateDetails(input);

        const { data, error } = await (supabase as any).rpc(
          'upsert_recruiter_referral_settings_for_workspace',
          {
            _recruiter_id: recruiterId,
            _referral_bonus_enabled: input.referral_bonus_enabled,
            _bonus_amount: input.referral_bonus_enabled ? input.bonus_amount : null,
            _payment_trigger: input.referral_bonus_enabled ? input.payment_trigger : null,
            _waiting_period_days: input.referral_bonus_enabled
              ? input.waiting_period_days
              : null,
            _bonus_terms: input.referral_bonus_enabled
              ? (input.bonus_terms?.trim() || null)
              : null,
          },
        );
        if (error) throw error;
        return data as RecruiterReferralSettings | null;
      },
      onSuccess: () => {
        qc.invalidateQueries({
          queryKey: ['recruiter_staff_referral_settings', user?.id, recruiterId],
        });
      },
    },
    qc,
  );

  return {
    settings: canRead ? (query.data ?? null) : null,
    isLoading: canRead ? query.isLoading : false,
    isError: canRead ? query.isError : false,
    error: query.error,
    refetch: query.refetch,
    upsert,
  };
}
