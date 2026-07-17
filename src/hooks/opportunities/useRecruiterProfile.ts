import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAdmin } from '@/hooks/useAdmin';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';
import { isProfileCompleteForPosting, POSTING_TERMS_VERSION } from '@/lib/opportunities/recruiterEligibility';

export type RecruiterProfile = Tables<'recruiter_profiles'>;
// Phase 1F-A.2.1A: protected consent + moderation columns are stripped
// from client-side upserts. `posting_terms_accepted_at`, `posting_terms_version`,
// and `legacy_terms_grandfathered_at` are server-stamped only via the
// `accept_recruiter_posting_terms` SECURITY DEFINER RPC. Direct writes are
// blocked by PostgreSQL column privileges, not by trigger/GUC trust.
export type RecruiterProfileUpsert = Omit<
  TablesInsert<'recruiter_profiles'>,
  | 'user_id'
  | 'posting_terms_accepted_at'
  | 'posting_terms_version'
  | 'legacy_terms_grandfathered_at'
>;

export function useRecruiterProfile() {
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const qc = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['recruiter_profile', user?.id],
    queryFn: async () => {
      if (!user) return null;
      // Phase 28: use safe RPC that omits admin_notes / verified_by so
      // recruiters never read internal moderation fields about themselves.
      const { data, error } = await (supabase as any).rpc('get_my_recruiter_profile_safe');
      if (error) throw error;
      const rows = (data ?? []) as Array<Record<string, any>>;
      return (rows[0] ?? null) as RecruiterProfile | null;
    },
    enabled: !!user,
    // Phase 1E: pick up admin approval / status changes without a hard reload.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // Phase 1E: realtime subscription so a recruiter sees approval flip
  // immediately when an admin updates their recruiter_profiles row.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`recruiter_profile:${user.id}`)
      .on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'public',
          table: 'recruiter_profiles',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ['recruiter_profile', user.id] });
          qc.invalidateQueries({ queryKey: ['user-role-recruiter-check', user.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, qc]);


  const upsertProfile = useMutation({
    mutationFn: async (data: RecruiterProfileUpsert) => {
      if (!user) throw new Error('Not authenticated');
      // Phase 1F-A.2.1A: never send protected consent columns.
      const safe = { ...data } as Record<string, unknown>;
      delete safe.posting_terms_accepted_at;
      delete safe.posting_terms_version;
      delete safe.legacy_terms_grandfathered_at;
      const { error } = await supabase
        .from('recruiter_profiles')
        .upsert({ ...(safe as RecruiterProfileUpsert), user_id: user.id }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recruiter_profile'] });
      qc.invalidateQueries({ queryKey: ['user-role-recruiter-check'] });
    },
  });

  // Phase 1F-A.2.1A: single mutation that saves ordinary profile fields
  // and then, when the caller intends to stamp consent, calls the
  // server-authoritative RPC. If the RPC fails the mutation fails.
  const saveRecruiterProfile = useMutation({
    mutationFn: async (
      args: { data: RecruiterProfileUpsert; acceptTerms: boolean },
    ): Promise<{ acceptedAt: string | null }> => {
      if (!user) throw new Error('Not authenticated');
      const safe = { ...args.data } as Record<string, unknown>;
      delete safe.posting_terms_accepted_at;
      delete safe.posting_terms_version;
      delete safe.legacy_terms_grandfathered_at;
      const { error: upsertErr } = await supabase
        .from('recruiter_profiles')
        .upsert({ ...(safe as RecruiterProfileUpsert), user_id: user.id }, { onConflict: 'user_id' });
      if (upsertErr) throw upsertErr;
      if (!args.acceptTerms) return { acceptedAt: null };
      const { data, error: rpcErr } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: string | null; error: Error | null }>;
      }).rpc('accept_recruiter_posting_terms', { _version: POSTING_TERMS_VERSION });
      if (rpcErr) throw rpcErr;
      return { acceptedAt: (data as string | null) ?? null };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recruiter_profile'] });
      qc.invalidateQueries({ queryKey: ['user-role-recruiter-check'] });
    },
  });

  // ----- Admin-only helpers -----
  // The DB-side recruiter_profile_guard() trigger enforces that only admins
  // can mutate verification_status / verified_at / verified_by / status.
  // These client checks are a UX guard; security still relies on RLS + trigger.
  const requireAdmin = () => {
    if (!isAdmin) throw new Error('Admin access required');
  };

  const approveRecruiter = useMutation({
    mutationFn: async (recruiterId: string) => {
      requireAdmin();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('recruiter_profiles')
        .update({
          verification_status: 'approved',
          status: 'active',
          verified_at: new Date().toISOString(),
          verified_by: user.id,
        })
        .eq('id', recruiterId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recruiter_profile'] }),
  });

  const rejectRecruiter = useMutation({
    mutationFn: async ({ recruiterId, notes }: { recruiterId: string; notes?: string }) => {
      requireAdmin();
      const { error } = await supabase
        .from('recruiter_profiles')
        .update({
          verification_status: 'rejected',
          admin_notes: notes ?? null,
        })
        .eq('id', recruiterId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recruiter_profile'] }),
  });

  const suspendRecruiter = useMutation({
    mutationFn: async ({ recruiterId, notes }: { recruiterId: string; notes?: string }) => {
      requireAdmin();
      const { error } = await supabase
        .from('recruiter_profiles')
        .update({
          status: 'suspended',
          verification_status: 'suspended',
          admin_notes: notes ?? null,
        })
        .eq('id', recruiterId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recruiter_profile'] }),
  });

  const profile = profileQuery.data ?? null;
  // Legacy: verification-approved AND active status. Kept for callers
  // that gate the Verified badge only. Do NOT use to gate posting.
  const isApproved =
    !!profile &&
    profile.verification_status === 'approved' &&
    profile.status === 'active';
  const isSuspended =
    !!profile && (profile.status === 'suspended' || profile.verification_status === 'suspended');
  // Phase 1F-A.1: derive canPost via the single canonical helper so client
  // and server share one definition of "complete".
  const isProfileComplete = isProfileCompleteForPosting(profile);
  const canPost = !!profile && !isSuspended && isProfileComplete;
  const isVerified =
    !!profile && profile.verification_status === 'approved' && profile.status === 'active';

  return {
    profile,
    isLoading: profileQuery.isLoading,
    isApproved,
    isSuspended,
    canPost,
    isVerified,
    isProfileComplete,
    upsertProfile,
    approveRecruiter,
    rejectRecruiter,
    suspendRecruiter,
  };
}
