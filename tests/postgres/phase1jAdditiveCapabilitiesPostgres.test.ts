/**
 * Phase 1J-A — Real PostgreSQL 16 additive-capability gate.
 *
 * Lives OUTSIDE src/ so `bunx vitest run` never picks it up. Runs only via
 * `vitest.phase1j-capabilities-postgres.config.ts` (locally or in CI).
 *
 * NEVER SKIPS. Fails hard if PHASE1J_CAPABILITIES_DATABASE_URL is absent.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.PHASE1J_CAPABILITIES_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'PHASE1J_CAPABILITIES_DATABASE_URL is required for the Phase 1J-A real-Postgres 16 gate.',
  );
}
const URL_STR: string = DATABASE_URL;

const CANDIDATE_PATH = fileURLToPath(
  new URL(
    '../../supabase/migration-candidates/20260720110000_phase1j_additive_user_capabilities.sql',
    import.meta.url,
  ),
);

const CANONICAL_PATH = fileURLToPath(
  new URL(
    '../../supabase/migrations/20260717185620_7efcb752-08f0-46b5-aaad-593e410aa818.sql',
    import.meta.url,
  ),
);

function extractRecruiterCanManageBlock(): string {
  const src = readFileSync(CANONICAL_PATH, 'utf8');
  const startMarker =
    'CREATE OR REPLACE FUNCTION public.recruiter_profile_can_manage_opportunities(';
  const endMarker =
    'GRANT EXECUTE ON FUNCTION public.recruiter_profile_can_manage_opportunities(uuid) TO service_role;';
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error('canonical: start marker not found');
  const endIdx = src.indexOf(endMarker, start);
  if (endIdx < 0) throw new Error('canonical: end marker not found');
  return src.slice(start, endIdx + endMarker.length);
}

const BOOTSTRAP_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon           NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated  NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role   NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT anon, authenticated, service_role TO postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.users TO service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $fn$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text, intended_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_name text, recruiter_email text, company_name text,
  dot_number text, mc_number text,
  verification_status text NOT NULL DEFAULT 'pending',
  status text NOT NULL DEFAULT 'active',
  posting_terms_accepted_at timestamptz, posting_terms_version text,
  legacy_terms_grandfathered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recruiter_profiles TO authenticated, service_role;

-- Canonical Phase 1F rule is loaded verbatim after this bootstrap runs
-- (see beforeAll / extractRecruiterCanManageBlock).

-- Billing shadow tables to assert non-interference.
CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'inactive'
);
CREATE TABLE IF NOT EXISTS public.recruiter_billing_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text, subscription_status text
);
`;

const RESET_SQL = `
DROP TRIGGER IF EXISTS trg_provision_driver_capability ON auth.users;
DROP TRIGGER IF EXISTS trg_recruiter_profile_capability_sync ON public.recruiter_profiles;
DROP TRIGGER IF EXISTS trg_profile_intent_capability_sync ON public.profiles;
DROP TRIGGER IF EXISTS trg_user_capabilities_updated_at ON public.user_capabilities;
DROP TABLE IF EXISTS public.user_capabilities CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;
DROP TABLE IF EXISTS public.recruiter_billing_profiles CASCADE;
DROP TABLE IF EXISTS public.recruiter_profiles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS auth.users CASCADE;
DROP TYPE IF EXISTS public.user_capability_type CASCADE;
DROP TYPE IF EXISTS public.user_capability_status CASCADE;
DROP FUNCTION IF EXISTS public.get_my_user_capabilities() CASCADE;
DROP FUNCTION IF EXISTS public.begin_recruiter_setup() CASCADE;
DROP FUNCTION IF EXISTS public._sync_recruiter_capability(uuid) CASCADE;
DROP FUNCTION IF EXISTS public._derive_recruiter_capability_status(uuid) CASCADE;
DROP FUNCTION IF EXISTS public._recruiter_profile_capability_sync() CASCADE;
DROP FUNCTION IF EXISTS public._profile_intent_capability_sync() CASCADE;
DROP FUNCTION IF EXISTS public._provision_driver_capability_for_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.recruiter_profile_can_manage_opportunities(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS auth.uid() CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
`;

const pool = new pg.Pool({ connectionString: URL_STR, max: 6 });

async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

async function asUser<T>(userId: string | null, fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL role authenticated`);
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function createUser(email = `${randomUUID()}@t.test`) {
  const id = randomUUID();
  await q(`INSERT INTO auth.users(id, email) VALUES ($1,$2)`, [id, email]);
  return id;
}

async function insertProfile(userId: string, intent: string | null = null) {
  await q(`INSERT INTO public.profiles(user_id, intended_role) VALUES ($1, $2)`, [userId, intent]);
}

async function completeRecruiter(
  userId: string,
  overrides: Partial<{
    status: string;
    verification_status: string;
    posting_terms_accepted_at: string | null;
  }> = {},
) {
  await q(
    `INSERT INTO public.recruiter_profiles(
       user_id, recruiter_name, recruiter_email, company_name,
       dot_number, status, verification_status, posting_terms_accepted_at
     ) VALUES ($1,'R','r@example.com','C','12345',$2,$3,$4)`,
    [
      userId,
      overrides.status ?? 'active',
      overrides.verification_status ?? 'pending',
      overrides.posting_terms_accepted_at === undefined
        ? new Date().toISOString()
        : overrides.posting_terms_accepted_at,
    ],
  );
}

async function caps(userId: string) {
  return await q<{ capability: string; status: string; activated_at: string | null }>(
    `SELECT capability::text, status::text, activated_at
       FROM public.user_capabilities WHERE user_id = $1 ORDER BY capability`,
    [userId],
  );
}

let CANONICAL_BLOCK = '';

beforeAll(async () => {
  await pool.query(RESET_SQL);
  await pool.query(BOOTSTRAP_SQL);
  CANONICAL_BLOCK = extractRecruiterCanManageBlock();
  await pool.query(CANONICAL_BLOCK);
  const candidate = readFileSync(CANDIDATE_PATH, 'utf8');
  await pool.query(candidate);
});

afterAll(async () => {
  await pool.query(RESET_SQL);
  await pool.end();
});

// ---------------------------------------------------------------------------
describe('Phase 1J-A · A. Catalog & ACL', () => {
  it('running against real PostgreSQL 16', async () => {
    const [row] = await q<{ n: string; v: string }>(
      `SELECT current_setting('server_version_num') as n, current_setting('server_version') as v`,
    );
    const n = Number(row.n);
    expect(n).toBeGreaterThanOrEqual(160000);
    expect(n).toBeLessThan(170000);
  });

  it('enum vocabulary is exact', async () => {
    const t = await q<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'user_capability_type' ORDER BY enumsortorder`,
    );
    expect(t.map((r) => r.enumlabel)).toEqual(['driver', 'recruiter']);
    const s = await q<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'user_capability_status' ORDER BY enumsortorder`,
    );
    expect(s.map((r) => r.enumlabel)).toEqual(['setup', 'active', 'suspended', 'revoked']);
  });

  it('table PK is (user_id, capability) and FK references auth.users', async () => {
    const pk = await q<{ attname: string }>(
      `SELECT a.attname FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = 'public.user_capabilities'::regclass AND i.indisprimary
       ORDER BY array_position(i.indkey, a.attnum)`,
    );
    expect(pk.map((r) => r.attname)).toEqual(['user_id', 'capability']);
    const fk = await q<{ confrelid: string; confdeltype: string }>(
      `SELECT confrelid::regclass::text as confrelid, confdeltype FROM pg_constraint
       WHERE conrelid = 'public.user_capabilities'::regclass AND contype = 'f'`,
    );
    expect(fk[0].confrelid).toBe('auth.users');
    expect(fk[0].confdeltype).toBe('c'); // ON DELETE CASCADE
  });

  it('RLS enabled', async () => {
    const r = await q<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_capabilities'::regclass`,
    );
    expect(r[0].relrowsecurity).toBe(true);
  });

  it('table ACLs: anon has nothing; authenticated SELECT only; service_role ALL', async () => {
    const priv = async (role: string, p: string) =>
      (
        await q<{ has: boolean }>(
          `SELECT has_table_privilege($1, 'public.user_capabilities', $2) AS has`,
          [role, p],
        )
      )[0].has;
    expect(await priv('anon', 'SELECT')).toBe(false);
    expect(await priv('anon', 'INSERT')).toBe(false);
    expect(await priv('authenticated', 'SELECT')).toBe(true);
    expect(await priv('authenticated', 'INSERT')).toBe(false);
    expect(await priv('authenticated', 'UPDATE')).toBe(false);
    expect(await priv('authenticated', 'DELETE')).toBe(false);
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
      expect(await priv('service_role', p)).toBe(true);
  });

  it('RPC signatures, SECURITY DEFINER, and search_path are correct', async () => {
    const rows = await q<{
      proname: string;
      prosecdef: boolean;
      config: string[] | null;
      owner: string;
    }>(
      `SELECT p.proname, p.prosecdef, p.proconfig AS config, r.rolname AS owner
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         JOIN pg_roles r ON r.oid=p.proowner
        WHERE n.nspname='public'
          AND p.proname IN ('get_my_user_capabilities','begin_recruiter_setup',
                             '_sync_recruiter_capability','_derive_recruiter_capability_status',
                             '_recruiter_profile_capability_sync',
                             '_profile_intent_capability_sync',
                             '_provision_driver_capability_for_new_user')`,
    );
    expect(rows.length).toBe(7);
    for (const r of rows) {
      expect(r.prosecdef).toBe(true);
      expect((r.config ?? []).some((c) => c.startsWith('search_path=public'))).toBe(true);
    }
  });

  it('EXECUTE grants: public RPCs authenticated only; internals service_role only', async () => {
    const canExec = async (role: string, sig: string) =>
      (await q<{ has: boolean }>(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS has`, [role, sig]))[0].has;

    expect(await canExec('anon', 'public.get_my_user_capabilities()')).toBe(false);
    expect(await canExec('authenticated', 'public.get_my_user_capabilities()')).toBe(true);
    expect(await canExec('anon', 'public.begin_recruiter_setup()')).toBe(false);
    expect(await canExec('authenticated', 'public.begin_recruiter_setup()')).toBe(true);
    for (const sig of [
      'public._sync_recruiter_capability(uuid)',
      'public._derive_recruiter_capability_status(uuid)',
      'public._recruiter_profile_capability_sync()',
      'public._profile_intent_capability_sync()',
      'public._provision_driver_capability_for_new_user()',
    ]) {
      expect(await canExec('anon', sig)).toBe(false);
      expect(await canExec('authenticated', sig)).toBe(false);
      expect(await canExec('service_role', sig)).toBe(true);
    }
  });

  it('triggers exist and are enabled', async () => {
    const trg = await q<{ tgname: string; tgenabled: string }>(
      `SELECT tgname, tgenabled FROM pg_trigger
        WHERE tgname IN ('trg_provision_driver_capability',
                          'trg_recruiter_profile_capability_sync',
                          'trg_profile_intent_capability_sync')`,
    );
    expect(trg.length).toBe(3);
    for (const t of trg) expect(t.tgenabled).toBe('O');
  });
});

// ---------------------------------------------------------------------------
describe('Phase 1J-A · B. Runtime authorization', () => {
  it('anonymous cannot execute RPCs', async () => {
    await expect(
      asUser(null, (c) => c.query(`SELECT public.get_my_user_capabilities()`)),
    ).rejects.toThrow();
    await expect(
      asUser(null, (c) => c.query(`SELECT public.begin_recruiter_setup()`)),
    ).rejects.toThrow();
  });

  it('authenticated caller sees only their own rows', async () => {
    const a = await createUser();
    const b = await createUser();
    await insertProfile(a);
    await insertProfile(b, 'recruiter');
    const rows = await asUser(a, async (c) =>
      (await c.query(`SELECT capability::text AS capability FROM public.get_my_user_capabilities()`)).rows,
    );
    expect(rows.every((r: any) => r.capability === 'driver' || r.capability === 'recruiter')).toBe(true);
    // Direct SELECT of another user's row is filtered by RLS.
    const other = await asUser(a, async (c) =>
      (await c.query(`SELECT * FROM public.user_capabilities WHERE user_id = $1`, [b])).rows,
    );
    expect(other.length).toBe(0);
  });

  it('authenticated direct INSERT/UPDATE/DELETE denied', async () => {
    const a = await createUser();
    await insertProfile(a);
    await expect(
      asUser(a, (c) =>
        c.query(`INSERT INTO public.user_capabilities(user_id, capability, status)
                 VALUES ($1,'recruiter','active')`, [a]),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(a, (c) => c.query(`UPDATE public.user_capabilities SET status='active' WHERE user_id=$1`, [a])),
    ).rejects.toThrow();
    await expect(
      asUser(a, (c) => c.query(`DELETE FROM public.user_capabilities WHERE user_id=$1`, [a])),
    ).rejects.toThrow();
  });

  it('begin_recruiter_setup uses JWT caller identity, not spoofable GUCs', async () => {
    const a = await createUser();
    const b = await createUser();
    await insertProfile(a);
    await insertProfile(b);
    // Even if 'app.user_id' or similar is set, only auth.uid() (JWT claim) is trusted.
    await asUser(a, async (c) => {
      await c.query(`SELECT set_config('app.user_id', $1, true)`, [b]);
      await c.query(`SELECT public.begin_recruiter_setup()`);
    });
    // Only user 'a' should now have a recruiter capability.
    const aRec = (await caps(a)).find((r) => r.capability === 'recruiter');
    const bRec = (await caps(b)).find((r) => r.capability === 'recruiter');
    expect(aRec?.status).toBe('setup');
    expect(bRec).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('Phase 1J-A · C. Trigger derivation matrix', () => {
  it('ordinary driver via auth.users insert → driver active only', async () => {
    const u = await createUser();
    const r = await caps(u);
    expect(r).toEqual([expect.objectContaining({ capability: 'driver', status: 'active' })]);
    expect(r[0].activated_at).not.toBeNull();
  });

  it('recruiter intent-only profile → driver active + recruiter setup', async () => {
    const u = await createUser();
    await insertProfile(u, 'recruiter');
    const map = Object.fromEntries((await caps(u)).map((r) => [r.capability, r.status]));
    expect(map).toEqual({ driver: 'active', recruiter: 'setup' });
  });

  it('incomplete recruiter profile → recruiter setup', async () => {
    const u = await createUser();
    await insertProfile(u, 'recruiter');
    await q(`INSERT INTO public.recruiter_profiles(user_id, recruiter_name, company_name)
             VALUES ($1,'X','C')`, [u]);
    const rec = (await caps(u)).find((r) => r.capability === 'recruiter');
    expect(rec?.status).toBe('setup');
  });

  it('complete pending / rejected / approved recruiter → recruiter active', async () => {
    for (const v of ['pending', 'rejected', 'approved']) {
      const u = await createUser();
      await insertProfile(u, 'recruiter');
      await completeRecruiter(u, { verification_status: v });
      const rec = (await caps(u)).find((r) => r.capability === 'recruiter');
      expect(rec?.status).toBe('active');
      expect(rec?.activated_at).not.toBeNull();
    }
  });

  it('suspended recruiter → driver active + recruiter suspended', async () => {
    const u = await createUser();
    await insertProfile(u, 'recruiter');
    await completeRecruiter(u, { status: 'suspended' });
    const map = Object.fromEntries((await caps(u)).map((r) => [r.capability, r.status]));
    expect(map.driver).toBe('active');
    expect(map.recruiter).toBe('suspended');
  });

  it('deleting recruiter profile leaves driver active and recruiter setup (intent preserved)', async () => {
    const u = await createUser();
    await insertProfile(u, 'recruiter');
    await completeRecruiter(u);
    await q(`DELETE FROM public.recruiter_profiles WHERE user_id = $1`, [u]);
    const map = Object.fromEntries((await caps(u)).map((r) => [r.capability, r.status]));
    expect(map.driver).toBe('active');
    expect(map.recruiter).toBe('setup');
  });

  it('begin_recruiter_setup cannot unsuspend a suspended recruiter', async () => {
    const u = await createUser();
    await insertProfile(u, 'recruiter');
    await completeRecruiter(u, { status: 'suspended' });
    const r = await asUser(u, async (c) =>
      (await c.query(`SELECT public.begin_recruiter_setup()::text AS s`)).rows[0].s,
    );
    expect(r).toBe('suspended');
    const rec = (await caps(u)).find((c) => c.capability === 'recruiter');
    expect(rec?.status).toBe('suspended');
  });

  it('recruiter transitions never touch driver capability', async () => {
    const u = await createUser();
    await insertProfile(u, 'recruiter');
    await completeRecruiter(u);
    // Suspend then unsuspend then delete — driver row stays active.
    await q(`UPDATE public.recruiter_profiles SET status='suspended' WHERE user_id=$1`, [u]);
    await q(`UPDATE public.recruiter_profiles SET status='active' WHERE user_id=$1`, [u]);
    await q(`DELETE FROM public.recruiter_profiles WHERE user_id=$1`, [u]);
    const d = (await caps(u)).find((c) => c.capability === 'driver');
    expect(d?.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
describe('Phase 1J-A · D. Isolation, rollback, concurrency', () => {
  it('caller A cannot alter caller B via any code path', async () => {
    const a = await createUser();
    const b = await createUser();
    await insertProfile(a);
    await insertProfile(b);
    await expect(
      asUser(a, (c) =>
        c.query(`UPDATE public.user_capabilities SET status='revoked' WHERE user_id=$1`, [b]),
      ),
    ).rejects.toThrow();
    const bDriver = (await caps(b)).find((r) => r.capability === 'driver');
    expect(bDriver?.status).toBe('active');
  });

  it('transaction rollback restores capability changes', async () => {
    const u = await createUser();
    await insertProfile(u);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL role authenticated`);
      await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [u]);
      await client.query(`SELECT public.begin_recruiter_setup()`);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const rec = (await caps(u)).find((r) => r.capability === 'recruiter');
    expect(rec).toBeUndefined();
  });

  it('concurrent begin_recruiter_setup calls produce one recruiter row with setup', async () => {
    const u = await createUser();
    await insertProfile(u);
    const one = () =>
      asUser(u, async (c) =>
        (await c.query(`SELECT public.begin_recruiter_setup()::text AS s`)).rows[0].s,
      );
    const results = await Promise.all([one(), one(), one(), one(), one()]);
    for (const r of results) expect(r).toBe('setup');
    const recs = (await caps(u)).filter((r) => r.capability === 'recruiter');
    expect(recs.length).toBe(1);
    expect(recs[0].status).toBe('setup');
  });

  it('recruiter activation writes no billing rows', async () => {
    const u = await createUser();
    await insertProfile(u, 'recruiter');
    await completeRecruiter(u, { verification_status: 'approved' });
    const subs = await q(`SELECT * FROM public.subscriptions WHERE user_id=$1`, [u]);
    const bill = await q(`SELECT * FROM public.recruiter_billing_profiles WHERE user_id=$1`, [u]);
    expect(subs.length).toBe(0);
    expect(bill.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 1J-A · E. Capability lifecycle durability', () => {
  it('begin_recruiter_setup row survives an unrelated profile UPDATE', async () => {
    const u = await createUser();
    await insertProfile(u);
    await asUser(u, (c) => c.query(`SELECT public.begin_recruiter_setup()`));
    await q(`UPDATE public.profiles SET display_name = 'renamed' WHERE user_id = $1`, [u]);
    const rec = (await caps(u)).find((r) => r.capability === 'recruiter');
    expect(rec?.status).toBe('setup');
  });

  it('clearing intended_role (null/driver) never removes or demotes recruiter capability', async () => {
    const u = await createUser();
    await insertProfile(u, 'recruiter');
    expect((await caps(u)).find((r) => r.capability === 'recruiter')?.status).toBe('setup');
    await q(`UPDATE public.profiles SET intended_role = NULL WHERE user_id = $1`, [u]);
    expect((await caps(u)).find((r) => r.capability === 'recruiter')?.status).toBe('setup');
    await q(`UPDATE public.profiles SET intended_role = 'driver' WHERE user_id = $1`, [u]);
    expect((await caps(u)).find((r) => r.capability === 'recruiter')?.status).toBe('setup');
  });

  it('clearing intended_role never demotes an active recruiter', async () => {
    const u = await createUser();
    await insertProfile(u, 'recruiter');
    await completeRecruiter(u, { verification_status: 'approved' });
    await q(`UPDATE public.profiles SET intended_role = NULL WHERE user_id = $1`, [u]);
    expect((await caps(u)).find((r) => r.capability === 'recruiter')?.status).toBe('active');
  });

  it('deleting recruiter_profiles: active → setup', async () => {
    const u = await createUser();
    await insertProfile(u, 'recruiter');
    await completeRecruiter(u, { verification_status: 'approved' });
    await q(`DELETE FROM public.recruiter_profiles WHERE user_id = $1`, [u]);
    expect((await caps(u)).find((r) => r.capability === 'recruiter')?.status).toBe('setup');
  });

  it('deleting recruiter_profiles: suspended stays suspended', async () => {
    const u = await createUser();
    await insertProfile(u, 'recruiter');
    await completeRecruiter(u, { status: 'suspended' });
    await q(`DELETE FROM public.recruiter_profiles WHERE user_id = $1`, [u]);
    expect((await caps(u)).find((r) => r.capability === 'recruiter')?.status).toBe('suspended');
  });

  it('deleting recruiter_profiles: revoked stays revoked', async () => {
    const u = await createUser();
    await insertProfile(u, 'recruiter');
    await completeRecruiter(u);
    await q(
      `UPDATE public.user_capabilities SET status='revoked' WHERE user_id=$1 AND capability='recruiter'`,
      [u],
    );
    await q(`DELETE FROM public.recruiter_profiles WHERE user_id = $1`, [u]);
    expect((await caps(u)).find((r) => r.capability === 'recruiter')?.status).toBe('revoked');
  });

  it('deleting recruiter_profiles: missing capability row → seeded as setup', async () => {
    const u = await createUser();
    await insertProfile(u); // no intent, no recruiter cap seeded
    await q(
      `INSERT INTO public.recruiter_profiles(user_id, recruiter_name, company_name)
       VALUES ($1, 'X', 'C')`,
      [u],
    );
    // Wipe the capability row so the DELETE branch hits its "no row" path.
    await q(
      `DELETE FROM public.user_capabilities WHERE user_id=$1 AND capability='recruiter'`,
      [u],
    );
    await q(`DELETE FROM public.recruiter_profiles WHERE user_id = $1`, [u]);
    expect((await caps(u)).find((r) => r.capability === 'recruiter')?.status).toBe('setup');
  });

  it('revoked is terminal across every code path', async () => {
    const u = await createUser();
    await insertProfile(u);
    await asUser(u, (c) => c.query(`SELECT public.begin_recruiter_setup()`));
    await q(
      `UPDATE public.user_capabilities SET status='revoked' WHERE user_id=$1 AND capability='recruiter'`,
      [u],
    );

    const r = await asUser(u, async (c) =>
      (await c.query(`SELECT public.begin_recruiter_setup()::text AS s`)).rows[0].s,
    );
    expect(r).toBe('revoked');

    await q(`UPDATE public.profiles SET intended_role='recruiter' WHERE user_id=$1`, [u]);
    expect((await caps(u)).find((r) => r.capability === 'recruiter')?.status).toBe('revoked');

    await completeRecruiter(u, { verification_status: 'approved' });
    expect((await caps(u)).find((r) => r.capability === 'recruiter')?.status).toBe('revoked');

    await q(`DELETE FROM public.recruiter_profiles WHERE user_id=$1`, [u]);
    expect((await caps(u)).find((r) => r.capability === 'recruiter')?.status).toBe('revoked');
  });

  it('driver capability is never mutated across full recruiter lifecycle', async () => {
    const u = await createUser();
    await insertProfile(u, 'recruiter');
    await completeRecruiter(u, { verification_status: 'approved' });
    await q(`UPDATE public.recruiter_profiles SET status='suspended' WHERE user_id=$1`, [u]);
    await q(`UPDATE public.recruiter_profiles SET status='active' WHERE user_id=$1`, [u]);
    await q(`DELETE FROM public.recruiter_profiles WHERE user_id=$1`, [u]);
    await q(`UPDATE public.profiles SET intended_role=NULL WHERE user_id=$1`, [u]);
    const drv = (await caps(u)).find((r) => r.capability === 'driver');
    expect(drv?.status).toBe('active');
    expect(drv?.activated_at).not.toBeNull();
  });
});
