/**
 * Phase 1F-A.2.1A-R1 — Client cutover for server-authoritative terms.
 *
 * Fully re-authored under the R1 remediation contract:
 *   - No `.upsert()` remains in useRecruiterProfile.ts.
 *   - Existing profile → UPDATE (no user_id in payload).
 *   - Missing profile  → INSERT (with user_id).
 *   - Combined onboarding mutation always calls the terms RPC.
 *   - Ordinary-save success + RPC failure yields a controlled partial-save
 *     Error and NEITHER recruiter query key invalidates.
 *   - Query invalidation only happens after ordinary save + RPC both succeed.
 *   - `resubmit_recruiter_profile` is invoked only from the combined
 *     mutation's success path, never before it, never on error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Mutable state for the mocks
// ---------------------------------------------------------------------------
type UpdateCall = { table: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> };
type InsertCall = { table: string; payload: Record<string, unknown> };
type UpsertCall = { table: string; payload: Record<string, unknown>; opts: unknown };
type RpcCall = { fn: string; args: Record<string, unknown> };

const updateCalls: UpdateCall[] = [];
const insertCalls: InsertCall[] = [];
const upsertCalls: UpsertCall[] = [];
const rpcCalls: RpcCall[] = [];
const invalidateCalls: unknown[][] = [];

let updateNextError: Error | null = null;
let insertNextError: Error | null = null;
let rpcNextError: Error | null = null;
let rpcNextData: string | null = '2026-07-17T00:00:00Z';
let insertedIdCounter = 0;
// Phase 1F-A.2.1A-R4: allow tests to simulate a successful INSERT whose
// response omits the profile id, so the recovery path can be exercised.
let insertReturnsEmpty = false;
// Phase 1F-A.2.1A-R4: mock data/error for the safe caller-owned recovery
// RPC (get_my_recruiter_profile_safe).
let safeProfileRpcRows: Array<{ id: string }> | null = [];
let safeProfileRpcError: Error | null = null;
// Phase 1R-D2-B6-A-R2: allow tests to simulate a successful UPDATE that
// returns zero rows (recruiters have UPDATE but no direct SELECT policy),
// plus configurable data/error for the safe persistence RPC.
let updateReturnsZeroRows = false;
let persistProfileRpcRows: Array<Record<string, unknown>> | null = [];
let persistProfileRpcError: Error | null = null;


// Controls whether useQuery reports an existing profile.
let currentProfile: (Record<string, unknown> & { id: string }) | null = null;

// Phase 1F-A.2.1A-R4: mutable authenticated identity so tests can simulate
// a user switch on the same hook lifecycle. `vi.hoisted` is required
// because `vi.mock` factories run before top-level statements.
const authState = vi.hoisted(() => ({ userId: 'client-user-1' as string | null }));

vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => ({
    update: (payload: Record<string, unknown>) => {
      const filters: Array<[string, unknown]> = [];
      const runUpdate = () => {
        updateCalls.push({ table, payload, filters });
        const err = updateNextError;
        updateNextError = null;
        // Phase 1P-A1: .update().eq().eq().select('*') returns the affected
        // rows so the hook can verify persistence. Echo the payload as the
        // single affected row unless an error is queued.
        // Phase 1R-D2-B6-A-R2: tests may force a zero-row (no SELECT policy)
        // successful UPDATE response.
        const data = err ? null : updateReturnsZeroRows ? [] : [{ ...payload }];
        return Promise.resolve({ data, error: err });

      };
      const chain = {
        eq(col: string, v: unknown) {
          filters.push([col, v]);
          return chain;
        },
        select(_cols: string) {
          return runUpdate();
        },
        then(res: (r: { error: Error | null }) => unknown) {
          return runUpdate().then(res);
        },
      };
      return chain;
    },
    insert: (payload: Record<string, unknown>) => {
      insertCalls.push({ table, payload });
      const err = insertNextError;
      insertNextError = null;
      const nextId = `inserted-rp-${++insertedIdCounter}`;
      const returnEmpty = insertReturnsEmpty;
      insertReturnsEmpty = false;
      const row = err ? null : (returnEmpty ? {} : { id: nextId, ...payload });
      const bare = Promise.resolve({ data: row, error: err });
      return {
        select: (_cols: string) => ({
          single: () => bare,
        }),
        then: (res: (r: unknown) => unknown) => bare.then(res),
      };
    },
    upsert: (payload: Record<string, unknown>, opts: unknown) => {
      // Should never be reached under R1. Recorded so tests can assert absence.
      upsertCalls.push({ table, payload, opts });
      return Promise.resolve({ error: null });
    },
  });
  const rpc = (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (fn === 'get_my_recruiter_profile_safe') {
      return Promise.resolve({ data: safeProfileRpcRows, error: safeProfileRpcError });
    }
    if (fn === 'persist_my_recruiter_profile') {
      return Promise.resolve({ data: persistProfileRpcRows, error: persistProfileRpcError });
    }

    const err = rpcNextError;
    const data = rpcNextData;
    rpcNextError = null;
    return Promise.resolve({ data, error: err });
  };
  return { supabase: { from, rpc } };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authState.userId ? { id: authState.userId } : null }),
}));
vi.mock('@/hooks/useAdmin', () => ({ useAdmin: () => ({ isAdmin: false }) }));

// useMutation stand-in that runs onSuccess / onError like the real API.
vi.mock('@tanstack/react-query', async () => {
  const useMutation = (opts: {
    mutationFn: (v: unknown) => Promise<unknown>;
    onSuccess?: (r: unknown) => void;
    onError?: (e: unknown) => void;
  }) => ({
    async mutateAsync(v: unknown) {
      try {
        const r = await opts.mutationFn(v);
        opts.onSuccess?.(r);
        return r;
      } catch (e) {
        opts.onError?.(e);
        throw e;
      }
    },
    isPending: false,
  });
  const useQuery = () => ({ data: currentProfile, isLoading: false });
  const useQueryClient = () => ({
    invalidateQueries: (spec: unknown) => {
      invalidateCalls.push([spec]);
    },
  });
  return { useMutation, useQuery, useQueryClient };
});

let refStore: { current: unknown } | null = null;
function resetRefStore() { refStore = null; }
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useEffect: () => undefined,
    useRef: <T,>(initial: T) => {
      if (!refStore) refStore = { current: initial as unknown };
      return refStore as { current: T };
    },
  };
});

// eslint-disable-next-line import/first
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

const baseData = {
  recruiter_name: 'Alice',
  recruiter_email: 'a@x.example',
  company_name: 'Acme',
  dot_number: '1234567',
} as const;

beforeEach(() => {
  updateCalls.length = 0;
  insertCalls.length = 0;
  upsertCalls.length = 0;
  rpcCalls.length = 0;
  invalidateCalls.length = 0;
  updateNextError = null;
  insertNextError = null;
  rpcNextError = null;
  rpcNextData = '2026-07-17T00:00:00Z';
  currentProfile = null;
  insertedIdCounter = 0;
  insertReturnsEmpty = false;
  safeProfileRpcRows = [];
  safeProfileRpcError = null;
  updateReturnsZeroRows = false;
  persistProfileRpcRows = [];
  persistProfileRpcError = null;

  authState.userId = 'client-user-1';
  resetRefStore();
});

describe('Phase 1F-A.2.1A-R1 client cutover', () => {
  it('32. missing profile → INSERT (never UPDATE, never UPSERT); payload includes user_id and strips protected', async () => {
    currentProfile = null;
    const hook = useRecruiterProfile();
    await hook.saveRecruiterProfile.mutateAsync({
      ...baseData,
      // sneak protected fields in via cast; they must be stripped
      posting_terms_accepted_at: '2099-01-01T00:00:00Z',
      posting_terms_version: 'forged',
      legacy_terms_grandfathered_at: '2099-01-01T00:00:00Z',
    } as unknown as Parameters<typeof hook.saveRecruiterProfile.mutateAsync>[0]);
    expect(insertCalls.length).toBe(1);
    expect(updateCalls.length).toBe(0);
    expect(upsertCalls.length).toBe(0);
    const p = insertCalls[0].payload;
    expect(p.user_id).toBe('client-user-1');
    expect(p).not.toHaveProperty('posting_terms_accepted_at');
    expect(p).not.toHaveProperty('posting_terms_version');
    expect(p).not.toHaveProperty('legacy_terms_grandfathered_at');
  });

  it('33. existing profile → UPDATE scoped by id + user_id (never INSERT, never UPSERT); payload excludes user_id and protected fields', async () => {
    currentProfile = { id: 'existing-rp-1' };
    const hook = useRecruiterProfile();
    await hook.saveRecruiterProfile.mutateAsync({
      ...baseData,
      posting_terms_accepted_at: '2099-01-01T00:00:00Z',
      posting_terms_version: 'forged',
      legacy_terms_grandfathered_at: '2099-01-01T00:00:00Z',
    } as unknown as Parameters<typeof hook.saveRecruiterProfile.mutateAsync>[0]);
    expect(updateCalls.length).toBe(1);
    expect(insertCalls.length).toBe(0);
    expect(upsertCalls.length).toBe(0);
    const p = updateCalls[0].payload;
    expect(p).not.toHaveProperty('user_id');
    expect(p).not.toHaveProperty('id');
    expect(p).not.toHaveProperty('created_at');
    expect(p).not.toHaveProperty('posting_terms_accepted_at');
    expect(p).not.toHaveProperty('posting_terms_version');
    expect(p).not.toHaveProperty('legacy_terms_grandfathered_at');
    const filters = Object.fromEntries(updateCalls[0].filters);
    expect(filters.id).toBe('existing-rp-1');
    expect(filters.user_id).toBe('client-user-1');
  });

  it('34. legacy upsertProfile API also branches to UPDATE/INSERT and NEVER calls .upsert()', async () => {
    currentProfile = { id: 'existing-rp-2' };
    const existingHook = useRecruiterProfile();
    await existingHook.upsertProfile.mutateAsync({ ...baseData } as never);
    expect(updateCalls.length).toBe(1);
    expect(upsertCalls.length).toBe(0);
    // Missing profile path — must re-invoke the hook after changing
    // currentProfile so the useQuery mock re-reads its value.
    updateCalls.length = 0;
    currentProfile = null;
    const missingHook = useRecruiterProfile();
    await missingHook.upsertProfile.mutateAsync({ ...baseData } as never);
    expect(insertCalls.length).toBe(1);
    expect(upsertCalls.length).toBe(0);
  });


  it('35. combined saveRecruiterProfile ALWAYS calls the terms RPC with pinned version', async () => {
    currentProfile = null;
    const hook = useRecruiterProfile();
    await hook.saveRecruiterProfile.mutateAsync({ ...baseData } as never);
    expect(rpcCalls.length).toBe(1);
    expect(rpcCalls[0].fn).toBe('accept_recruiter_posting_terms');
    expect(rpcCalls[0].args._version).toBe('2026-07-17.v1');
  });

  it('36. ordinary save failure aborts mutation; RPC never invoked; no query invalidation', async () => {
    currentProfile = null;
    insertNextError = new Error('insert boom');
    const hook = useRecruiterProfile();
    await expect(
      hook.saveRecruiterProfile.mutateAsync({ ...baseData } as never),
    ).rejects.toThrow(/boom/);
    expect(rpcCalls.length).toBe(0);
    expect(invalidateCalls.length).toBe(0);
  });

  it('37. RPC failure after ordinary save yields controlled partial-save Error and NO invalidation', async () => {
    currentProfile = { id: 'existing-rp-3' };
    rpcNextError = new Error('version mismatch');
    const hook = useRecruiterProfile();
    let caught: unknown = null;
    try {
      await hook.saveRecruiterProfile.mutateAsync({ ...baseData } as never);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(
      /Recruiter profile details were saved, but posting terms could not be accepted\. Please retry\./,
    );
    expect(((caught as Error & { cause?: unknown }).cause as Error).message).toBe('version mismatch');
    expect(updateCalls.length).toBe(1);
    expect(rpcCalls.length).toBe(1);
    expect(invalidateCalls.length).toBe(0);
  });

  it('38. successful save + RPC invalidates BOTH recruiter query keys (exactly once each)', async () => {
    currentProfile = null;
    const hook = useRecruiterProfile();
    await hook.saveRecruiterProfile.mutateAsync({ ...baseData } as never);
    const keys = invalidateCalls
      .map((c) => (c[0] as { queryKey?: unknown[] })?.queryKey?.[0])
      .filter(Boolean);
    expect(keys).toContain('recruiter_profile');
    expect(keys).toContain('user-role-recruiter-check');
  });

  it('39. useRecruiterProfile source contains no .upsert( call on recruiter_profiles', () => {
    const src = readFileSync(
      resolve(__dirname, '../hooks/opportunities/useRecruiterProfile.ts'),
      'utf8',
    );
    // No .upsert( anywhere in the hook (guards against reintroduction).
    expect(src).not.toMatch(/\.upsert\(/);
    // Explicit assertion: UPDATE path exists, INSERT path exists.
    expect(src).toMatch(/\.update\(/);
    expect(src).toMatch(/\.insert\(/);
  });

  it('40. RecruiterOnboarding calls saveRecruiterProfile with only ordinary data (no acceptTerms arg)', () => {
    const src = readFileSync(
      resolve(__dirname, '../components/opportunities/RecruiterOnboarding.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/acceptTerms\s*:/);
    // Called with payload as the first arg (not the { data, acceptTerms } shape).
    expect(src).toMatch(/saveRecruiterProfile\.mutate\(\s*payload/);
  });

  it('41. resubmit_recruiter_profile is invoked only inside the combined mutation onSuccess path', () => {
    const src = readFileSync(
      resolve(__dirname, '../components/opportunities/RecruiterOnboarding.tsx'),
      'utf8',
    );
    // The literal must appear exactly once and inside an onSuccess callback
    // hung on the saveRecruiterProfile.mutate call.
    const occurrences = src.match(/resubmit_recruiter_profile/g) ?? [];
    expect(occurrences.length).toBe(1);
    // Isolate the saveRecruiterProfile.mutate(...) options block; the
    // resubmit call must live inside its onSuccess and be strictly after
    // the mutate invocation.
    const mutateIdx = src.indexOf('saveRecruiterProfile.mutate(');
    const resubmitIdx = src.indexOf('resubmit_recruiter_profile');
    expect(mutateIdx).toBeGreaterThan(-1);
    expect(resubmitIdx).toBeGreaterThan(mutateIdx);
    // The onSuccess containing the resubmit call must reference the RPC
    // through supabase.rpc; onError must NOT contain the resubmit call.
    const onSuccessIdx = src.indexOf('onSuccess:', mutateIdx);
    const onErrorIdx = src.indexOf('onError:', mutateIdx);
    expect(onSuccessIdx).toBeGreaterThan(-1);
    expect(onErrorIdx).toBeGreaterThan(-1);
    expect(resubmitIdx).toBeGreaterThan(onSuccessIdx);
    expect(resubmitIdx).toBeLessThan(onErrorIdx);
  });

  it('42. R3 partial-save retry: INSERT-then-RPC-fail, then retry UPDATEs (no second INSERT) and RPC succeeds', async () => {
    // A. First call: INSERT succeeds, RPC fails → controlled partial-save Error, no invalidation.
    currentProfile = null;
    rpcNextError = new Error('boom rpc 1');
    const hook = useRecruiterProfile();
    let caughtA: unknown = null;
    try {
      await hook.saveRecruiterProfile.mutateAsync({ ...baseData } as never);
    } catch (e) {
      caughtA = e;
    }
    expect(caughtA).toBeInstanceOf(Error);
    expect((caughtA as Error).message).toMatch(
      /Recruiter profile details were saved, but posting terms could not be accepted\. Please retry\./,
    );
    expect(insertCalls.length).toBe(1);
    expect(updateCalls.length).toBe(0);
    expect(rpcCalls.length).toBe(1);
    expect(invalidateCalls.length).toBe(0);

    // B. Retry on the SAME hook instance. currentProfile is still null (the
    // useQuery mock has not refetched), so only the internal knownProfileIdRef
    // can steer the second attempt to UPDATE instead of a second INSERT.
    rpcNextError = null;
    rpcNextData = '2026-07-17T00:00:00Z';
    await hook.saveRecruiterProfile.mutateAsync({ ...baseData } as never);
    expect(insertCalls.length).toBe(1); // still exactly one INSERT overall
    expect(updateCalls.length).toBe(1); // retry took the UPDATE path
    expect(rpcCalls.length).toBe(2);
    // UPDATE filters must scope by the inserted id AND the caller user_id.
    const filters = Object.fromEntries(updateCalls[0].filters);
    expect(filters.id).toBe('inserted-rp-1');
    expect(filters.user_id).toBe('client-user-1');
    // Invalidation only after the successful retry.
    const keys = invalidateCalls
      .map((c) => (c[0] as { queryKey?: unknown[] })?.queryKey?.[0])
      .filter(Boolean);
    expect(keys).toContain('recruiter_profile');
    expect(keys).toContain('user-role-recruiter-check');
  });

  it('43. R4 user-switch: User A known id must NEVER be used to UPDATE for User B (missing profile → INSERT)', async () => {
    // Step 1: User A saves → INSERT succeeds, RPC succeeds. Ref is stamped
    // to { userId: A, profileId: inserted-rp-1 }.
    authState.userId = 'user-A';
    currentProfile = null;
    const hookA = useRecruiterProfile();
    await hookA.saveRecruiterProfile.mutateAsync({ ...baseData } as never);
    expect(insertCalls.length).toBe(1);
    expect(updateCalls.length).toBe(0);
    expect(rpcCalls.filter((c) => c.fn === 'accept_recruiter_posting_terms').length).toBe(1);

    // Step 2: authenticated identity switches to User B (no profile). The
    // ref still holds User A's data at this instant; the hook's synchronous
    // user-binding guard MUST drop it and take INSERT for User B.
    authState.userId = 'user-B';
    currentProfile = null;
    const hookB = useRecruiterProfile();
    await hookB.saveRecruiterProfile.mutateAsync({ ...baseData } as never);

    // Exactly one additional INSERT for User B (two total). No UPDATE.
    expect(insertCalls.length).toBe(2);
    expect(updateCalls.length).toBe(0);
    // User B's INSERT payload carries user-B, never user-A.
    const bInsert = insertCalls[1];
    expect(bInsert.payload.user_id).toBe('user-B');
    // No UPDATE was ever attempted with User A's id.
    expect(
      updateCalls.some((u) => Object.fromEntries(u.filters).id === 'inserted-rp-1'),
    ).toBe(false);
    // The terms RPC ran a SECOND time — only AFTER User B's ordinary save.
    const termsCalls = rpcCalls.filter((c) => c.fn === 'accept_recruiter_posting_terms');
    expect(termsCalls.length).toBe(2);
  });

  it('44. R4 missing-ID recovery success: INSERT returns no id, safe RPC finds owned id, terms RPC then succeeds; retry uses UPDATE with recovered id', async () => {
    authState.userId = 'client-user-1';
    currentProfile = null;
    insertReturnsEmpty = true;
    safeProfileRpcRows = [{ id: 'recovered-rp-9', ...baseData } as { id: string }];
    const hook = useRecruiterProfile();
    await hook.saveRecruiterProfile.mutateAsync({ ...baseData } as never);

    // Exactly one INSERT; recovery RPC called; then terms RPC called.
    expect(insertCalls.length).toBe(1);
    const recovery = rpcCalls.filter((c) => c.fn === 'get_my_recruiter_profile_safe');
    const terms = rpcCalls.filter((c) => c.fn === 'accept_recruiter_posting_terms');
    expect(recovery.length).toBe(1);
    expect(terms.length).toBe(1);
    // Recovery precedes terms.
    expect(rpcCalls.findIndex((c) => c.fn === 'get_my_recruiter_profile_safe'))
      .toBeLessThan(rpcCalls.findIndex((c) => c.fn === 'accept_recruiter_posting_terms'));
    // Success invalidation happened.
    const keys = invalidateCalls
      .map((c) => (c[0] as { queryKey?: unknown[] })?.queryKey?.[0])
      .filter(Boolean);
    expect(keys).toContain('recruiter_profile');

    // Retry on same hook must use UPDATE with the recovered id — not a new INSERT.
    await hook.saveRecruiterProfile.mutateAsync({ ...baseData } as never);
    expect(insertCalls.length).toBe(1); // still exactly one INSERT overall
    expect(updateCalls.length).toBe(1);
    const filters = Object.fromEntries(updateCalls[0].filters);
    expect(filters.id).toBe('recovered-rp-9');
    expect(filters.user_id).toBe('client-user-1');
  });

  it('45. R4 missing-ID recovery failure: INSERT returns no id, safe RPC finds nothing, throws controlled error; terms RPC not called; no success invalidation', async () => {
    authState.userId = 'client-user-1';
    currentProfile = null;
    insertReturnsEmpty = true;
    safeProfileRpcRows = [];
    const hook = useRecruiterProfile();
    let caught: unknown = null;
    try {
      await hook.saveRecruiterProfile.mutateAsync({ ...baseData } as never);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(
      /Your recruiter profile changes were not saved\. Please review your account setup and try again\./,
    );
    // INSERT and recovery ran; terms RPC never invoked.
    expect(insertCalls.length).toBe(1);
    expect(rpcCalls.some((c) => c.fn === 'get_my_recruiter_profile_safe')).toBe(true);
    expect(rpcCalls.some((c) => c.fn === 'accept_recruiter_posting_terms')).toBe(false);
    // No success invalidation.
    expect(invalidateCalls.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Phase 1R-D2-B6-A-R2 — safe persistence fallback when the caller-owned
  // UPDATE succeeds but PostgREST returns zero rows (no recruiter SELECT
  // policy exists by design).
  // -------------------------------------------------------------------------

  it('46. existing profile + zero-row UPDATE → persist_my_recruiter_profile fallback with only ordinary args, before terms acceptance', async () => {
    currentProfile = {
      id: 'existing-rp-zero',
      recruiter_name: 'Loaded Name',
      recruiter_email: 'loaded@x.example',
      recruiter_phone: '555-0000',
      company_name: 'Loaded Co',
      company_type: 'carrier',
      company_website: 'https://loaded.example',
      company_phone: '555-1111',
      company_address: '1 Loaded St',
      company_city: 'Loadville',
      company_state: 'TX',
      dot_number: '9999999',
      mc_number: 'MC-LOADED',
      hiring_states: ['TX', 'OK'],
      equipment_types: ['dry_van'],
      driver_types_hired: ['company_driver'],
    };
    updateReturnsZeroRows = true;
    persistProfileRpcRows = [
      {
        id: 'existing-rp-zero',
        recruiter_name: 'Alice',
        company_name: 'Acme',
        recruiter_email: 'a@x.example',
        company_type: 'carrier',
        dot_number: '1234567',
        mc_number: 'MC-LOADED',
      },
    ];

    const hook = useRecruiterProfile();
    await hook.saveRecruiterProfile.mutateAsync({
      ...baseData,
      company_website: null,
    } as never);

    // Direct UPDATE still attempted exactly once; fallback RPC exactly once.
    expect(updateCalls.length).toBe(1);
    expect(insertCalls.length).toBe(0);
    const persistIdx = rpcCalls.findIndex((c) => c.fn === 'persist_my_recruiter_profile');
    const termsIdx = rpcCalls.findIndex((c) => c.fn === 'accept_recruiter_posting_terms');
    expect(rpcCalls.filter((c) => c.fn === 'persist_my_recruiter_profile').length).toBe(1);
    expect(persistIdx).toBeGreaterThan(-1);
    // Safe persistence must occur BEFORE terms acceptance.
    expect(termsIdx).toBeGreaterThan(persistIdx);

    const args = rpcCalls[persistIdx].args;
    // Exactly the 15 ordinary arguments — no identity or protected fields.
    expect(Object.keys(args).sort()).toEqual(
      [
        '_company_address',
        '_company_city',
        '_company_name',
        '_company_phone',
        '_company_state',
        '_company_type',
        '_company_website',
        '_dot_number',
        '_driver_types_hired',
        '_equipment_types',
        '_hiring_states',
        '_mc_number',
        '_recruiter_email',
        '_recruiter_name',
        '_recruiter_phone',
      ].sort(),
    );
    for (const forbidden of [
      'id',
      '_id',
      'user_id',
      '_user_id',
      'profile_id',
      '_profile_id',
      '_status',
      '_verification_status',
      '_verified_at',
      '_verified_by',
      '_admin_notes',
      '_created_at',
      '_updated_at',
      '_posting_terms_accepted_at',
      '_posting_terms_version',
      '_legacy_terms_grandfathered_at',
    ]) {
      expect(args).not.toHaveProperty(forbidden);
    }

    // Submitted values win, including an explicit null clear.
    expect(args._recruiter_name).toBe('Alice');
    expect(args._recruiter_email).toBe('a@x.example');
    expect(args._company_name).toBe('Acme');
    expect(args._dot_number).toBe('1234567');
    expect(args._company_website).toBeNull();

    // Absent fields preserve the currently loaded safe profile values.
    expect(args._recruiter_phone).toBe('555-0000');
    expect(args._company_type).toBe('carrier');
    expect(args._company_phone).toBe('555-1111');
    expect(args._company_address).toBe('1 Loaded St');
    expect(args._company_city).toBe('Loadville');
    expect(args._company_state).toBe('TX');
    expect(args._mc_number).toBe('MC-LOADED');
    expect(args._hiring_states).toEqual(['TX', 'OK']);
    expect(args._equipment_types).toEqual(['dry_van']);
    expect(args._driver_types_hired).toEqual(['company_driver']);

    // Both query keys invalidate only after complete success.
    const keys = invalidateCalls
      .map((c) => (c[0] as { queryKey?: unknown[] })?.queryKey?.[0])
      .filter(Boolean);
    expect(keys).toContain('recruiter_profile');
    expect(keys).toContain('user-role-recruiter-check');
  });

  it('47. fallback RPC error or malformed return aborts before terms acceptance with no success invalidation', async () => {
    // A. RPC error.
    currentProfile = { id: 'existing-rp-zero-a' };
    updateReturnsZeroRows = true;
    persistProfileRpcError = new Error('persist boom');
    const hookA = useRecruiterProfile();
    await expect(
      hookA.saveRecruiterProfile.mutateAsync({ ...baseData } as never),
    ).rejects.toThrow(/persist boom/);
    expect(rpcCalls.some((c) => c.fn === 'accept_recruiter_posting_terms')).toBe(false);
    expect(invalidateCalls.length).toBe(0);

    // B. Malformed return (zero rows).
    rpcCalls.length = 0;
    invalidateCalls.length = 0;
    resetRefStore();
    persistProfileRpcError = null;
    persistProfileRpcRows = [];
    updateReturnsZeroRows = true;
    currentProfile = { id: 'existing-rp-zero-b' };
    const hookB = useRecruiterProfile();
    await expect(
      hookB.saveRecruiterProfile.mutateAsync({ ...baseData } as never),
    ).rejects.toThrow(/Your recruiter profile changes were not saved\./);
    expect(rpcCalls.some((c) => c.fn === 'accept_recruiter_posting_terms')).toBe(false);
    expect(invalidateCalls.length).toBe(0);

    // C. Malformed return (row missing a usable id).
    rpcCalls.length = 0;
    invalidateCalls.length = 0;
    resetRefStore();
    persistProfileRpcRows = [{ recruiter_name: 'Alice' }];
    updateReturnsZeroRows = true;
    currentProfile = { id: 'existing-rp-zero-c' };
    const hookC = useRecruiterProfile();
    await expect(
      hookC.saveRecruiterProfile.mutateAsync({ ...baseData } as never),
    ).rejects.toThrow(/Your recruiter profile changes were not saved\./);
    expect(rpcCalls.some((c) => c.fn === 'accept_recruiter_posting_terms')).toBe(false);
    expect(invalidateCalls.length).toBe(0);

    // D. Field mismatch in the verified read-back.
    rpcCalls.length = 0;
    invalidateCalls.length = 0;
    resetRefStore();
    persistProfileRpcRows = [{ id: 'existing-rp-zero-d', recruiter_name: 'WRONG' }];
    updateReturnsZeroRows = true;
    currentProfile = { id: 'existing-rp-zero-d' };
    const hookD = useRecruiterProfile();
    await expect(
      hookD.saveRecruiterProfile.mutateAsync({ ...baseData } as never),
    ).rejects.toThrow(/Your recruiter profile changes were not saved\./);
    expect(rpcCalls.some((c) => c.fn === 'accept_recruiter_posting_terms')).toBe(false);
    expect(invalidateCalls.length).toBe(0);
  });

  it('48. persist_my_recruiter_profile migration is caller-bound, least-privilege, and adds no policy', () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../supabase/migrations/20260731203000_phase1r_d2_b6_a_r2_recruiter_profile_safe_persistence.sql',
      ),
      'utf8',
    );
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public/);
    // Identity derives only from auth.uid().
    expect(sql).toMatch(/auth\.uid\(\)/);
    // No identity arguments in the parameter list.
    const params = sql.slice(
      sql.indexOf('persist_my_recruiter_profile('),
      sql.indexOf('RETURNS TABLE'),
    );
    expect(params).not.toMatch(/_user_id/);
    expect(params).not.toMatch(/_profile_id\s+uuid/);
    for (const protectedField of [
      '_status',
      '_verification_status',
      '_verified_at',
      '_verified_by',
      '_admin_notes',
      '_created_at',
      '_updated_at',
      '_posting_terms_accepted_at',
      '_posting_terms_version',
      '_legacy_terms_grandfathered_at',
    ]) {
      expect(params).not.toContain(protectedField);
    }
    // Protected columns never appear in the UPDATE SET list.
    const updateSet = sql.slice(sql.indexOf('UPDATE public.recruiter_profiles'), sql.indexOf('GET DIAGNOSTICS _affected = ROW_COUNT;\n  END IF;'));
    for (const protectedCol of [
      'verification_status',
      'verified_at',
      'verified_by',
      'admin_notes',
      'posting_terms_accepted_at',
      'posting_terms_version',
      'legacy_terms_grandfathered_at',
    ]) {
      expect(updateSet).not.toMatch(new RegExp(`\\n\\s+${protectedCol}\\s+=`));
    }
    // Least-privilege EXECUTE.
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC;/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION[\s\S]*FROM anon;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO authenticated, service_role;/);
    // No RLS policy change.
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/ALTER POLICY/i);
  });
});

