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


  // Phase 1F-A.2.1A-R1: shared ordinary-profile persistence. NEVER uses
  // .upsert() — an ON CONFLICT DO UPDATE payload that includes user_id would
  // require UPDATE privilege on user_id, which the fixture revokes. Instead
  // this branches on the currently-known profile id: UPDATE existing, INSERT
  // missing. user_id is never present in any UPDATE payload.
  async function persistOrdinaryProfile(input: RecruiterProfileUpsert): Promise<void> {
    if (!user) throw new Error('Not authenticated');
    // Defensively strip every protected column even if a caller sneaks one in.
    const safe = { ...input } as Record<string, unknown>;
    delete safe.posting_terms_accepted_at;
    delete safe.posting_terms_version;
    delete safe.legacy_terms_grandfathered_at;
    delete safe.user_id;
    delete safe.id;
    delete safe.created_at;

    const existingId = profileQuery.data?.id ?? null;
    if (existingId) {
      const { error } = await supabase
        .from('recruiter_profiles')
        .update(safe as never)
        .eq('id', existingId)
        .eq('user_id', user.id);
      if (error) throw error;
      return;
    }
    const { error } = await supabase
      .from('recruiter_profiles')
      .insert({ ...(safe as RecruiterProfileUpsert), user_id: user.id } as never);
    if (error) throw error;
  }

  // Ordinary-save API preserved for callers that only need to persist
  // profile fields (no consent stamping). Implemented via the shared branch
  // so it also never issues .upsert(). Protected columns are stripped.
  const upsertProfile = useMutation({
    mutationFn: async (data: RecruiterProfileUpsert) => {
      await persistOrdinaryProfile(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recruiter_profile'] });
      qc.invalidateQueries({ queryKey: ['user-role-recruiter-check'] });
    },
  });

  // Phase 1F-A.2.1A-R1: combined onboarding mutation ALWAYS calls the
  // server-authoritative terms RPC after ordinary fields save. Callers no
  // longer pass acceptTerms — the UI already requires all three agreements
  // before submit, and the RPC is idempotent for already-accepted rows.
  // If ordinary save succeeds and the RPC fails we surface a controlled
  // partial-save error so the UI can tell the user what happened.
  const saveRecruiterProfile = useMutation({
    mutationFn: async (
      data: RecruiterProfileUpsert,
    ): Promise<{ acceptedAt: string }> => {
      await persistOrdinaryProfile(data);
      const { data: rpcData, error: rpcErr } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: string | null; error: Error | null }>;
      }).rpc('accept_recruiter_posting_terms', { _version: POSTING_TERMS_VERSION });
      if (rpcErr) {
        const controlled = new Error(
          'Recruiter profile details were saved, but posting terms could not be accepted. Please retry.',
        ) as Error & { cause?: unknown };
        controlled.cause = rpcErr;
        throw controlled;
      }
      return { acceptedAt: (rpcData as string | null) ?? '' };
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
    saveRecruiterProfile,
    approveRecruiter,
    rejectRecruiter,
    suspendRecruiter,
  };
}
