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
// Every migration in this project is run by the connection owner (postgres
// locally and postgres:16 in CI). This is asserted explicitly rather than
// hard-coded elsewhere so any owner drift surfaces immediately.
const EXPECTED_OWNER = 'postgres';

describe('Phase 1J-A · A. Catalog & ACL (exact matrix)', () => {
  it('running against real PostgreSQL 16', async () => {
    const [row] = await q<{ n: string; v: string }>(
      `SELECT current_setting('server_version_num') as n, current_setting('server_version') as v`,
    );
    const n = Number(row.n);
    expect(n).toBeGreaterThanOrEqual(160000);
    expect(n).toBeLessThan(170000);
  });

  it('canonical Phase 1F helper block is loaded from disk (no handwritten copy)', async () => {
    expect(CANONICAL_BLOCK).toContain(
      'CREATE OR REPLACE FUNCTION public.recruiter_profile_can_manage_opportunities(',
    );
    expect(CANONICAL_BLOCK).toContain(
      'GRANT EXECUTE ON FUNCTION public.recruiter_profile_can_manage_opportunities(uuid) TO service_role;',
    );
    expect(CANONICAL_BLOCK).toContain('SECURITY DEFINER');
    expect(CANONICAL_BLOCK.length).toBeGreaterThan(200);
    expect(
      (BOOTSTRAP_SQL.match(
        /CREATE OR REPLACE FUNCTION public\.recruiter_profile_can_manage_opportunities/g,
      ) || []).length,
    ).toBe(0);

    const fn = await q<{ oid: string }>(
      `SELECT p.oid::text FROM pg_proc p
         JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='recruiter_profile_can_manage_opportunities'`,
    );
    expect(fn.length).toBe(1);
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

  it('table columns are exactly the six additive columns — no billing/plan/Stripe fields', async () => {
    const cols = await q<{ attname: string; typ: string; notnull: boolean }>(
      `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS typ, a.attnotnull AS notnull
         FROM pg_attribute a
        WHERE a.attrelid = 'public.user_capabilities'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
    );
    expect(cols.map((c) => c.attname)).toEqual([
      'user_id',
      'capability',
      'status',
      'activated_at',
      'created_at',
      'updated_at',
    ]);
    const byName = Object.fromEntries(cols.map((c) => [c.attname, c]));
    expect(byName.user_id.typ).toBe('uuid');
    expect(byName.user_id.notnull).toBe(true);
    expect(byName.capability.typ).toBe('user_capability_type');
    expect(byName.status.typ).toBe('user_capability_status');
    expect(byName.activated_at.typ).toBe('timestamp with time zone');
    expect(byName.activated_at.notnull).toBe(false);
    expect(byName.created_at.notnull).toBe(true);
    expect(byName.updated_at.notnull).toBe(true);

    // Belt-and-braces: no plan/billing vocabulary crept into the table.
    const forbidden = /plan|billing|subscription|price|stripe|premium/i;
    for (const c of cols) expect(forbidden.test(c.attname)).toBe(false);
  });

  it('table owner matches migration owner', async () => {
    const [row] = await q<{ owner: string }>(
      `SELECT r.rolname AS owner FROM pg_class c
         JOIN pg_roles r ON r.oid = c.relowner
        WHERE c.oid = 'public.user_capabilities'::regclass`,
    );
    expect(row.owner).toBe(EXPECTED_OWNER);
  });

  it('table PK is (user_id, capability) and FK is ON DELETE CASCADE to auth.users', async () => {
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
    expect(fk.length).toBe(1);
    expect(fk[0].confrelid).toBe('auth.users');
    expect(fk[0].confdeltype).toBe('c');
  });

  it('RLS enabled and exactly one policy: user_capabilities_self_select', async () => {
    const [r] = await q<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_capabilities'::regclass`,
    );
    expect(r.relrowsecurity).toBe(true);

    const pols = await q<{
      polname: string;
      polcmd: string;
      roles: string[];
      qual: string;
      withcheck: string | null;
    }>(
      `SELECT p.polname,
              CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                            WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                            WHEN '*' THEN 'ALL' END AS polcmd,
              ARRAY(SELECT rolname::text FROM pg_roles WHERE oid = ANY(p.polroles))::text[] AS roles,
              pg_get_expr(p.polqual, p.polrelid) AS qual,
              pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck
         FROM pg_policy p
        WHERE p.polrelid = 'public.user_capabilities'::regclass
        ORDER BY p.polname`,
    );
    expect(pols.length).toBe(1);
    expect(pols[0].polname).toBe('user_capabilities_self_select');
    expect(pols[0].polcmd).toBe('SELECT');
    expect(pols[0].roles).toEqual(['authenticated']);
    expect(pols[0].qual.replace(/\s+/g, '')).toBe('(user_id=auth.uid())');
    expect(pols[0].withcheck).toBeNull();
  });

  it('table ACLs: PUBLIC/anon nothing; authenticated SELECT only; service_role ALL', async () => {
    const priv = async (role: string, p: string) =>
      (
        await q<{ has: boolean }>(
          `SELECT has_table_privilege($1, 'public.user_capabilities', $2) AS has`,
          [role, p],
        )
      )[0].has;

    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
      expect(await priv('anon', p)).toBe(false);
    expect(await priv('authenticated', 'SELECT')).toBe(true);
    for (const p of ['INSERT', 'UPDATE', 'DELETE'])
      expect(await priv('authenticated', p)).toBe(false);
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
      expect(await priv('service_role', p)).toBe(true);

    // PUBLIC ACL check: grantee OID 0 must appear nowhere in relacl.
    const pub = await q<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM pg_class c, LATERAL aclexplode(c.relacl) a
        WHERE c.oid='public.user_capabilities'::regclass AND a.grantee=0`,
    );
    expect(pub[0].n).toBe(0);
  });

  const EXPECTED_FUNCTIONS: Array<{
    name: string;
    args: string;
    volatility: 'i' | 's' | 'v';
  }> = [
    { name: 'get_my_user_capabilities', args: '', volatility: 's' },
    { name: 'begin_recruiter_setup', args: '', volatility: 'v' },
    { name: '_derive_recruiter_capability_status', args: '_user_id uuid', volatility: 's' },
    { name: '_sync_recruiter_capability', args: '_user_id uuid', volatility: 'v' },
    { name: '_recruiter_profile_capability_sync', args: '', volatility: 'v' },
    { name: '_profile_intent_capability_sync', args: '', volatility: 'v' },
    { name: '_provision_driver_capability_for_new_user', args: '', volatility: 'v' },
  ];

  it('every new function has exact identity args, owner, SECURITY DEFINER, volatility, and search_path=public', async () => {
    const names = EXPECTED_FUNCTIONS.map((f) => f.name);
    const rows = await q<{
      proname: string;
      args: string;
      owner: string;
      prosecdef: boolean;
      provolatile: string;
      config: string[] | null;
    }>(
      `SELECT p.proname,
              pg_get_function_identity_arguments(p.oid) AS args,
              r.rolname AS owner,
              p.prosecdef,
              p.provolatile,
              p.proconfig AS config
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_roles r ON r.oid = p.proowner
        WHERE n.nspname='public' AND p.proname = ANY($1::text[])
        ORDER BY p.proname`,
      [names],
    );
    expect(rows.length).toBe(EXPECTED_FUNCTIONS.length);
    const byName = Object.fromEntries(rows.map((r) => [r.proname, r]));
    for (const expected of EXPECTED_FUNCTIONS) {
      const r = byName[expected.name];
      expect(r, `function ${expected.name}`).toBeDefined();
      expect(r.args).toBe(expected.args);
      expect(r.owner).toBe(EXPECTED_OWNER);
      expect(r.prosecdef).toBe(true);
      expect(r.provolatile).toBe(expected.volatility);
      expect(r.config).toEqual(['search_path=public']);
    }
  });

  it('EXECUTE grants: PUBLIC/anon nothing on any RPC or helper; authenticated only on the two public RPCs', async () => {
    const canExec = async (role: string, sig: string) =>
      (await q<{ has: boolean }>(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS has`, [role, sig]))[0].has;

    const publicSigs = ['public.get_my_user_capabilities()', 'public.begin_recruiter_setup()'];
    const internalSigs = [
      'public._sync_recruiter_capability(uuid)',
      'public._derive_recruiter_capability_status(uuid)',
      'public._recruiter_profile_capability_sync()',
      'public._profile_intent_capability_sync()',
      'public._provision_driver_capability_for_new_user()',
    ];

    for (const sig of publicSigs) {
      expect(await canExec('anon', sig)).toBe(false);
      expect(await canExec('authenticated', sig)).toBe(true);
      expect(await canExec('service_role', sig)).toBe(true);
    }
    for (const sig of internalSigs) {
      expect(await canExec('anon', sig)).toBe(false);
      expect(await canExec('authenticated', sig)).toBe(false);
      expect(await canExec('service_role', sig)).toBe(true);
    }

    // PUBLIC (grantee OID 0) must not appear on the proacl of any new function.
    const pub = await q<{ proname: string; n: number }>(
      `SELECT p.proname, COUNT(a.*)::int AS n
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         LEFT JOIN LATERAL aclexplode(p.proacl) a ON a.grantee = 0
        WHERE n.nspname='public'
          AND p.proname = ANY($1::text[])
        GROUP BY p.proname`,
      [[...publicSigs, ...internalSigs].map((s) => s.split('.')[1].split('(')[0])],
    );
    for (const row of pub) expect(row.n, `PUBLIC on ${row.proname}`).toBe(0);
  });

  it('trigger mapping: exact relation, function, level, timing, event, and enabled state', async () => {
    const rows = await q<{
      tgname: string;
      relname: string;
      relnspname: string;
      fname: string;
      fnspname: string;
      tgtype: number;
      tgenabled: string;
    }>(
      `SELECT t.tgname,
              c.relname, nc.nspname AS relnspname,
              p.proname AS fname, np.nspname AS fnspname,
              t.tgtype::int AS tgtype,
              t.tgenabled
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace nc ON nc.oid = c.relnamespace
         JOIN pg_proc  p ON p.oid = t.tgfoid
         JOIN pg_namespace np ON np.oid = p.pronamespace
        WHERE NOT t.tgisinternal
          AND t.tgname IN (
            'trg_provision_driver_capability',
            'trg_recruiter_profile_capability_sync',
            'trg_profile_intent_capability_sync',
            'trg_user_capabilities_updated_at'
          )
        ORDER BY t.tgname`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.tgname, r]));

    // tgtype bitmask reference: 1=row, 2=before, 4=insert, 8=delete, 16=update
    const expectations: Record<
      string,
      { rel: [string, string]; fn: [string, string]; tgtype: number }
    > = {
      trg_provision_driver_capability: {
        rel: ['auth', 'users'],
        fn: ['public', '_provision_driver_capability_for_new_user'],
        tgtype: 1 + 4, // AFTER INSERT, row
      },
      trg_recruiter_profile_capability_sync: {
        rel: ['public', 'recruiter_profiles'],
        fn: ['public', '_recruiter_profile_capability_sync'],
        tgtype: 1 + 4 + 8 + 16, // AFTER INSERT|UPDATE|DELETE, row
      },
      trg_profile_intent_capability_sync: {
        rel: ['public', 'profiles'],
        fn: ['public', '_profile_intent_capability_sync'],
        tgtype: 1 + 4 + 16, // AFTER INSERT|UPDATE, row
      },
      trg_user_capabilities_updated_at: {
        rel: ['public', 'user_capabilities'],
        fn: ['public', 'update_updated_at_column'],
        tgtype: 1 + 2 + 16, // BEFORE UPDATE, row
      },
    };

    for (const [name, exp] of Object.entries(expectations)) {
      const row = byName[name];
      expect(row, `trigger ${name}`).toBeDefined();
      expect([row.relnspname, row.relname]).toEqual(exp.rel);
      expect([row.fnspname, row.fname]).toEqual(exp.fn);
      expect(row.tgtype).toBe(exp.tgtype);
      expect(row.tgenabled).toBe('O');
    }
    expect(Object.keys(byName).sort()).toEqual(Object.keys(expectations).sort());
  });

  it('pg_get_triggerdef: exact normalized definitions (proves intent trigger is UPDATE OF intended_role only)', async () => {
    const rows = await q<{ tgname: string; def: string }>(
      `SELECT t.tgname, pg_get_triggerdef(t.oid) AS def
         FROM pg_trigger t
        WHERE NOT t.tgisinternal
          AND t.tgname IN (
            'trg_provision_driver_capability',
            'trg_recruiter_profile_capability_sync',
            'trg_profile_intent_capability_sync',
            'trg_user_capabilities_updated_at'
          )
        ORDER BY t.tgname`,
    );
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const byName = Object.fromEntries(rows.map((r) => [r.tgname, norm(r.def)]));

    expect(byName['trg_provision_driver_capability']).toBe(
      'CREATE TRIGGER trg_provision_driver_capability AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION _provision_driver_capability_for_new_user()',
    );
    expect(byName['trg_recruiter_profile_capability_sync']).toBe(
      'CREATE TRIGGER trg_recruiter_profile_capability_sync AFTER INSERT OR DELETE OR UPDATE ON public.recruiter_profiles FOR EACH ROW EXECUTE FUNCTION _recruiter_profile_capability_sync()',
    );
    // Critical: this trigger MUST scope UPDATE to intended_role only,
    // not every profile column, so unrelated profile writes cannot
    // demote or churn the recruiter capability.
    expect(byName['trg_profile_intent_capability_sync']).toBe(
      'CREATE TRIGGER trg_profile_intent_capability_sync AFTER INSERT OR UPDATE OF intended_role ON public.profiles FOR EACH ROW EXECUTE FUNCTION _profile_intent_capability_sync()',
    );
    expect(byName['trg_user_capabilities_updated_at']).toBe(
      'CREATE TRIGGER trg_user_capabilities_updated_at BEFORE UPDATE ON public.user_capabilities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
    );
    // Explicit negative: intent trigger def must NOT be a blanket
    // "UPDATE ON public.profiles" (that would fire on every column).
    expect(byName['trg_profile_intent_capability_sync']).not.toMatch(
      /AFTER INSERT OR UPDATE ON public\.profiles/,
    );
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

// ---------------------------------------------------------------------------
describe('Phase 1J-A · F. No-intent recruiter lifecycle', () => {
  it('driver with intended_role null → begin_setup → complete profile → active → delete → setup', async () => {
    const u = await createUser();
    await insertProfile(u, null); // no recruiter intent
    const first = await asUser(u, async (c) =>
      (await c.query(`SELECT public.begin_recruiter_setup()::text AS s`)).rows[0].s,
    );
    expect(first).toBe('setup');

    await completeRecruiter(u, { verification_status: 'approved' });
    expect((await caps(u)).find((r) => r.capability === 'recruiter')?.status).toBe('active');

    await q(`DELETE FROM public.recruiter_profiles WHERE user_id = $1`, [u]);
    const rows = await caps(u);
    expect(rows.find((r) => r.capability === 'recruiter')?.status).toBe('setup');
    expect(rows.find((r) => r.capability === 'driver')?.status).toBe('active');

    const [p] = await q<{ intended_role: string | null }>(
      `SELECT intended_role FROM public.profiles WHERE user_id = $1`,
      [u],
    );
    expect(p.intended_role).toBeNull();
  });

  it('active recruiter with intended_role null → delete profile → setup, driver still active', async () => {
    const u = await createUser();
    await insertProfile(u, null);
    await completeRecruiter(u, { verification_status: 'approved' });
    await q(`DELETE FROM public.recruiter_profiles WHERE user_id = $1`, [u]);
    const rows = await caps(u);
    expect(rows.find((r) => r.capability === 'recruiter')?.status).toBe('setup');
    expect(rows.find((r) => r.capability === 'driver')?.status).toBe('active');
  });

  it("active recruiter with intended_role 'driver' → delete profile → setup, driver still active", async () => {
    const u = await createUser();
    await insertProfile(u, 'driver');
    await completeRecruiter(u, { verification_status: 'approved' });
    await q(`DELETE FROM public.recruiter_profiles WHERE user_id = $1`, [u]);
    const rows = await caps(u);
    expect(rows.find((r) => r.capability === 'recruiter')?.status).toBe('setup');
    expect(rows.find((r) => r.capability === 'driver')?.status).toBe('active');
  });
});

