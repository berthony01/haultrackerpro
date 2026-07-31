import { useEffect, useRef } from 'react';
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
> & {
  // Phase 1P-A1: company_type is a new nullable column. The generated
  // types.ts is regenerated only after the migration is applied; until
  // then callers pass it through this augmented shape.
  company_type?:
    | 'carrier'
    | 'third_party_recruiter'
    | 'staffing_agency'
    | 'independent_recruiter'
    | null;
};

const PERSISTENCE_MISMATCH_MESSAGE =
  'Your recruiter profile changes were not saved. Please review your account setup and try again.';

/**
 * Phase 1P-A4 — safe error formatter used by recruiter surfaces so we
 * surface the true underlying reason (PostgREST message or an Error.cause
 * chain) instead of leaking raw objects, SQL, tokens, credentials, or
 * internal stack data.
 *
 * Preference order:
 *   1. `err.cause.message`  (Error chain / RPC controlled cause)
 *   2. `err.message`        (top-level Error wrapper)
 *   3. String fallback
 *
 * Never JSON-serializes objects or exposes protected properties.
 */
export function formatRecruiterProfileError(err: unknown): string {
  if (err && typeof err === 'object' && err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause && typeof cause === 'object') {
      const m = (cause as { message?: unknown }).message;
      if (typeof m === 'string' && m.trim()) return m.trim();
    }
    if (typeof err.message === 'string' && err.message.trim()) {
      return err.message.trim();
    }
  }
  if (typeof err === 'string' && err.trim()) return err.trim();
  return 'Something went wrong. Please try again.';
}

/**
 * Phase 1P-A1 — normalized read-back fields the persistence verification
 * checks against the just-submitted values. Any drift (zero rows, multiple
 * rows, mismatched values) aborts BEFORE accept_recruiter_posting_terms.
 */
const VERIFIED_FIELDS = [
  'recruiter_name',
  'company_name',
  'recruiter_email',
  'company_type',
  'dot_number',
  'mc_number',
] as const;

function normalize(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

/**
 * Phase 1R-D2-B6-A-R2 — ordinary scalar fields accepted by the
 * `persist_my_recruiter_profile` SECURITY DEFINER RPC. Identity, status,
 * moderation, timestamp, and posting-consent columns are deliberately
 * absent: the function derives the caller from auth.uid() and never
 * accepts or writes protected fields.
 */
const SAFE_PERSIST_SCALAR_FIELDS = [
  'recruiter_name',
  'recruiter_email',
  'recruiter_phone',
  'company_name',
  'company_type',
  'company_website',
  'company_phone',
  'company_address',
  'company_city',
  'company_state',
  'dot_number',
  'mc_number',
] as const;

const SAFE_PERSIST_LIST_FIELDS = [
  'hiring_states',
  'equipment_types',
  'driver_types_hired',
] as const;




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
      const readSafeProfile = async () => {
        const { data, error } = await (supabase as any).rpc(
          'get_my_recruiter_profile_safe',
        );
        if (error) throw error;
        const rows = (data ?? []) as Array<Record<string, any>>;
        return (rows[0] ?? null) as RecruiterProfile | null;
      };

      // 1. First safe read. Any error propagates immediately — self-heal
      //    is never attempted before a successful first read.
      const first = await readSafeProfile();
      if (first) return first;

      // Phase 1N-E4-A: only when the first safe read returns no row do we
      // invoke the caller-only self-heal RPC. It takes zero arguments —
      // never pass user_id or any identity — and any error propagates.
      const { error: healErr } = await (supabase as any).rpc(
        'ensure_my_recruiter_setup_state',
        {},
      );
      if (healErr) throw healErr;

      // 2. Exactly one second safe read after successful self-heal.
      return await readSafeProfile();
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
    // Use a per-mount unique channel topic so StrictMode's double-invoke
    // (or any stale channel cached by realtime-js under the same topic)
    // can never return an already-subscribed channel, which would make
    // `.on('postgres_changes', ...)` throw "cannot add callbacks after subscribe()".
    const topic = `recruiter_profile:${user.id}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(topic)
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
  // Postgres ON CONFLICT DO UPDATE — such a payload includes user_id and
  // would require UPDATE privilege on user_id, which the fixture revokes.
  // Instead this branches on the currently-known profile id: UPDATE
  // existing, INSERT missing. user_id is never present in any UPDATE payload.

  // Phase 1F-A.2.1A-R4: retry-safe known-profile ref, USER-BOUND. Stores
  // { userId, profileId } and is only trusted when userId matches the
  // currently-authenticated user. If the hook's authenticated identity
  // changes (sign-out, account switch), any previously-cached profile id
  // is dropped so a new user can never UPDATE another user's row.
  const knownProfileRef = useRef<{ userId: string; profileId: string } | null>(null);
  useEffect(() => {
    if (!user) {
      knownProfileRef.current = null;
      return;
    }
    // Drop any ref that belonged to a different user before syncing from
    // the current query result.
    if (knownProfileRef.current && knownProfileRef.current.userId !== user.id) {
      knownProfileRef.current = null;
    }
    const id = profileQuery.data?.id ?? null;
    if (id) knownProfileRef.current = { userId: user.id, profileId: id };
  }, [user, profileQuery.data?.id]);

  async function persistOrdinaryProfile(input: RecruiterProfileUpsert): Promise<void> {
    if (!user) throw new Error('Not authenticated');
    // Synchronous guard: never trust a cached id that isn't bound to the
    // currently-authenticated user (defense against a stale ref on a hook
    // instance that outlived a user switch, e.g. if useEffect hasn't yet run).
    if (knownProfileRef.current && knownProfileRef.current.userId !== user.id) {
      knownProfileRef.current = null;
    }

    // Defensively strip every protected column even if a caller sneaks one in.
    const safe = { ...input } as Record<string, unknown>;
    delete safe.posting_terms_accepted_at;
    delete safe.posting_terms_version;
    delete safe.legacy_terms_grandfathered_at;
    delete safe.user_id;
    delete safe.id;
    delete safe.created_at;

    const boundId =
      knownProfileRef.current?.userId === user.id
        ? knownProfileRef.current.profileId
        : null;
    const queryId = profileQuery.data?.id ?? null;
    const existingId = boundId ?? queryId;

    // Build the expected normalized read-back from the outgoing payload.
    // Fields absent from the payload aren't verified (they retain their
    // current stored value).
    const expected: Record<string, string> = {};
    for (const key of VERIFIED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(safe, key)) {
        expected[key] = normalize((safe as Record<string, unknown>)[key]);
      }
    }
    const verifyRow = (row: Record<string, unknown> | null): void => {
      if (!row) {
        throw new Error(PERSISTENCE_MISMATCH_MESSAGE);
      }
      for (const [key, want] of Object.entries(expected)) {
        const got = normalize(row[key]);
        if (got !== want) {
          throw new Error(PERSISTENCE_MISMATCH_MESSAGE);
        }
      }
    };

    if (existingId) {
      // Phase 1P-A1: use .select() so PostgREST returns the affected rows
      // and we can prove exactly one caller-owned row changed. Zero or
      // multiple rows throws the controlled mismatch message BEFORE any
      // downstream RPC (accept_recruiter_posting_terms) is called.
      const { data: updatedRows, error } = await supabase
        .from('recruiter_profiles')
        .update(safe as never)
        .eq('id', existingId)
        .eq('user_id', user.id)
        .select('*');
      if (error) throw error;
      const rows = (updatedRows ?? []) as Array<Record<string, unknown>>;
      if (rows.length === 0) {
        // Phase 1R-D2-B6-A-R2 — recruiters own an UPDATE policy but have no
        // direct SELECT policy, so PostgREST can legitimately return zero
        // rows for a successful write. Fall back exactly once to the
        // caller-bound SECURITY DEFINER persistence RPC, which derives
        // identity from auth.uid() and returns a narrow verification row.
        const current = (profileQuery.data ?? null) as Record<string, unknown> | null;
        const args: Record<string, unknown> = {};
        for (const key of SAFE_PERSIST_SCALAR_FIELDS) {
          args[`_${key}`] = Object.prototype.hasOwnProperty.call(safe, key)
            ? (safe[key] ?? null)
            : (current?.[key] ?? null);
        }
        for (const key of SAFE_PERSIST_LIST_FIELDS) {
          const submitted = Object.prototype.hasOwnProperty.call(safe, key)
            ? safe[key]
            : undefined;
          const fallback = current?.[key];
          args[`_${key}`] = Array.isArray(submitted)
            ? submitted
            : Array.isArray(fallback)
              ? fallback
              : [];
        }

        const { data: persistedRows, error: persistErr } = await (supabase as unknown as {
          rpc: (
            fn: string,
            a: Record<string, unknown>,
          ) => Promise<{ data: Array<Record<string, unknown>> | null; error: Error | null }>;
        }).rpc('persist_my_recruiter_profile', args);
        if (persistErr) throw persistErr;
        const persisted = (persistedRows ?? []) as Array<Record<string, unknown>>;
        if (persisted.length !== 1) {
          throw new Error(PERSISTENCE_MISMATCH_MESSAGE);
        }
        const persistedRow = persisted[0];
        const persistedId = persistedRow?.id;
        if (typeof persistedId !== 'string' || !persistedId) {
          throw new Error(PERSISTENCE_MISMATCH_MESSAGE);
        }
        verifyRow(persistedRow);
        knownProfileRef.current = { userId: user.id, profileId: persistedId };
        return;
      }
      if (rows.length !== 1) {
        throw new Error(PERSISTENCE_MISMATCH_MESSAGE);
      }
      verifyRow(rows[0]);
      return;
    }

    const { data: inserted, error } = await supabase
      .from('recruiter_profiles')
      .insert({ ...(safe as RecruiterProfileUpsert), user_id: user.id } as never)
      .select('*')
      .single();
    if (error) throw error;
    const insertedRow = inserted as Record<string, unknown> | null;
    let insertedId = (insertedRow?.id as string | undefined) ?? null;

    if (!insertedId) {
      const { data: recRows, error: recErr } = await (supabase as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: Array<Record<string, unknown>> | null; error: Error | null }>;
      }).rpc('get_my_recruiter_profile_safe', {});
      if (!recErr) {
        const rows = (recRows ?? []) as Array<Record<string, unknown>>;
        const candidate = (rows[0]?.id as string | undefined) ?? null;
        if (candidate) {
          insertedId = candidate;
          verifyRow(rows[0]);
        }
      }
    } else {
      verifyRow(insertedRow);
    }
    if (!insertedId) {
      throw new Error(PERSISTENCE_MISMATCH_MESSAGE);
    }
    knownProfileRef.current = { userId: user.id, profileId: insertedId };
  }


  // Ordinary-save API preserved for callers that only need to persist
  // profile fields (no consent stamping). Implemented via the shared branch
  // so it also never issues a client-side upsert. Protected columns stripped.

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
    // Phase 1P-A1: expose the profile query's refetch so publish-time
    // callers can force a fresh read before evaluating readiness.
    refetchProfile: async () => {
      const r = await profileQuery.refetch();
      return (r.data ?? null) as RecruiterProfile | null;
    },
  };

}
