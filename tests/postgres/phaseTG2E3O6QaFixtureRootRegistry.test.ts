/**
 * Phase TG-2E3-O6 — Real PostgreSQL gate for the QA fixture root registry
 * candidate.
 *
 * Applies the accepted Owner QA (O2) candidate FIRST, snapshots the resulting
 * object inventory and function definitions, then applies the O6 candidate and
 * proves it adds exactly one table and one function, changes nothing about the
 * existing Owner QA surface, and enforces every declared constraint, privilege,
 * RLS, and fail-closed helper contract against real PostgreSQL.
 *
 * Lives OUTSIDE `src/` so the default `bunx vitest run` never picks it up.
 * Run with an ad-hoc config (for example under /tmp) that includes only this
 * file.
 *
 * NEVER SKIPS. Fails hard if TG2E3O6_DATABASE_URL is absent.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.TG2E3O6_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'TG2E3O6_DATABASE_URL is required for the Phase TG-2E3-O6 real-Postgres gate.',
  );
}
const URL_STR: string = DATABASE_URL;

function candidate(file: string): string {
  return readFileSync(
    fileURLToPath(
      new URL(`../../supabase/migration-candidates/${file}`, import.meta.url),
    ),
    'utf8',
  );
}

const OWNER_QA_SQL = candidate(
  '20260820200000_phase_tg2e3_o2_owner_qa_entitlement.sql',
);
const O6_SQL = candidate(
  '20260821050000_phase_tg2e3_o6_qa_fixture_root_registry.sql',
);

/**
 * Minimal production-faithful scaffold: only the objects the candidates
 * genuinely depend on.
 */
const SCAFFOLD = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE IF NOT EXISTS public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL
);

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users a
    WHERE a.user_id = _user_id AND a.role = 'super_admin'
  )
$$;

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid,
  action text NOT NULL,
  target_user_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL,
  plan_key text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.recruiter_billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL,
  plan text,
  status text
);

CREATE TABLE IF NOT EXISTS public.agency_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.agency_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  role text NOT NULL,
  status text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.agency_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  plan_key text NOT NULL,
  status text NOT NULL,
  source text NOT NULL,
  member_limit integer,
  active_client_limit integer,
  service_package_limit integer
);

CREATE OR REPLACE FUNCTION public._agency_plan_defaults(_plan_key text)
RETURNS TABLE(member_limit integer, active_client_limit integer, service_package_limit integer)
LANGUAGE sql IMMUTABLE AS $$
  SELECT t.m, t.c, t.s FROM (VALUES
    ('agency_starter', 2, 5, 3),
    ('agency_team',    5, 25, 10),
    ('agency_growth', 15, 100, 30)
  ) AS t(k, m, c, s)
  WHERE t.k = _plan_key
$$;

DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;

DO $$ BEGIN
  CREATE TYPE public.recruiter_workspace_permission AS ENUM (
    'opportunities_create',
    'opportunities_edit',
    'opportunities_change_status'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft'
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunities TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_opportunity_action(
  _recruiter_id uuid,
  _permission public.recruiter_workspace_permission
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    NULLIF(current_setting('test.perm_allow', true), '')::boolean,
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.effective_recruiter_active_opportunity_limit(
  _recruiter_id uuid
) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _tier text;
BEGIN
  _tier := public.effective_recruiter_tier(_recruiter_id);
  RETURN CASE _tier
    WHEN 'conflict'      THEN 0
    WHEN 'free_standard' THEN 1
    WHEN 'starter'       THEN 5
    WHEN 'growth'        THEN 15
    WHEN 'fleet'         THEN 25
    ELSE 0
  END;
END;
$$;
`;

const OWNER_QA_FUNCTIONS = [
  '_owner_qa_persona_for',
  'current_owner_qa_persona',
  'set_owner_qa_persona',
  'disable_owner_qa_persona',
  'driver_has_active_pro',
  'effective_recruiter_tier',
  'get_effective_agency_limits',
  'opportunities_billing_guard',
];

const OBJECT_INVENTORY_SQL = `
  SELECT 'table:' || c.relname AS obj
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  UNION ALL
  SELECT 'function:' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
  ORDER BY 1
`;

const OWNER_QA_DEFS_SQL = `
  SELECT p.proname, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = ANY($1)
  ORDER BY p.proname, p.oid
`;

const pool = new pg.Pool({ connectionString: URL_STR, max: 4 });

const OWNER = randomUUID();
const OTHER_ADMIN = randomUUID();
const PLAIN_USER = randomUUID();
const SYNTHETIC_USER = randomUUID();
const RECRUITER_ROOT = randomUUID();
const AGENCY_ROOT = randomUUID();

let inventoryBefore: string[] = [];
let inventoryAfter: string[] = [];
let ownerQaDefsBefore: Array<{ proname: string; def: string }> = [];
let ownerQaDefsAfter: Array<{ proname: string; def: string }> = [];

async function asRole<T>(
  uid: string | null,
  role: string,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
      uid ?? '',
    ]);
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

async function insertRoot(
  kind: string,
  rootId: string,
  opts: { active?: boolean; revokedAt?: string | null; note?: string | null } = {},
) {
  const active = opts.active ?? true;
  return pool.query(
    `INSERT INTO public.qa_fixture_roots
       (root_kind, root_id, qa_owner_user_id, active, note, registered_by_user_id, revoked_at)
     VALUES ($1, $2, $3, $4, $5, $3, $6)`,
    [
      kind,
      rootId,
      OWNER,
      active,
      opts.note ?? null,
      opts.revokedAt === undefined ? (active ? null : new Date().toISOString()) : opts.revokedAt,
    ],
  );
}

beforeAll(async () => {
  await pool.query(SCAFFOLD);
  await pool.query(OWNER_QA_SQL);

  inventoryBefore = (await pool.query(OBJECT_INVENTORY_SQL)).rows.map(
    (r) => r.obj as string,
  );
  ownerQaDefsBefore = (
    await pool.query(OWNER_QA_DEFS_SQL, [OWNER_QA_FUNCTIONS])
  ).rows;

  await pool.query(O6_SQL);

  inventoryAfter = (await pool.query(OBJECT_INVENTORY_SQL)).rows.map(
    (r) => r.obj as string,
  );
  ownerQaDefsAfter = (
    await pool.query(OWNER_QA_DEFS_SQL, [OWNER_QA_FUNCTIONS])
  ).rows;

  await pool.query(`INSERT INTO auth.users(id) VALUES ($1),($2),($3),($4)`, [
    OWNER,
    OTHER_ADMIN,
    PLAIN_USER,
    SYNTHETIC_USER,
  ]);
  await pool.query(
    `INSERT INTO public.admin_users(user_id, role) VALUES ($1,'super_admin'),($2,'admin')`,
    [OWNER, OTHER_ADMIN],
  );
}, 60_000);

afterAll(async () => {
  await pool.query(`DELETE FROM public.qa_fixture_roots`);
  await pool.end();
});

describe('qa_fixture_roots shape', () => {
  it('exposes exactly the declared columns with the declared types', async () => {
    const cols = await pool.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='qa_fixture_roots'
       ORDER BY ordinal_position`,
    );
    expect(cols.rows).toEqual([
      { column_name: 'root_kind', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'root_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'qa_owner_user_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'active', data_type: 'boolean', is_nullable: 'NO' },
      { column_name: 'note', data_type: 'text', is_nullable: 'YES' },
      {
        column_name: 'registered_by_user_id',
        data_type: 'uuid',
        is_nullable: 'NO',
      },
      {
        column_name: 'created_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
      },
      {
        column_name: 'updated_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
      },
      {
        column_name: 'revoked_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
      },
    ]);
  });

  it('carries no plan/tier, billing/Stripe, Telegram, or email columns', async () => {
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='qa_fixture_roots'`,
    );
    const names = cols.rows.map((r) => (r.column_name as string).toLowerCase());
    for (const forbidden of [
      'plan',
      'tier',
      'stripe',
      'subscription',
      'billing',
      'telegram',
      'email',
      'price',
      'entitlement',
    ]) {
      expect(names.some((n) => n.includes(forbidden))).toBe(false);
    }
  });

  it('uses a composite primary key on (root_kind, root_id)', async () => {
    const pk = await pool.query(
      `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = 'public.qa_fixture_roots'::regclass AND i.indisprimary
       ORDER BY array_position(i.indkey, a.attnum)`,
    );
    expect(pk.rows.map((r) => r.attname)).toEqual(['root_kind', 'root_id']);
  });

  it('declares ON DELETE RESTRICT foreign keys to auth.users for both identity columns', async () => {
    const fks = await pool.query(
      `SELECT conname, confdeltype, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'public.qa_fixture_roots'::regclass AND contype='f'
       ORDER BY conname`,
    );
    expect(fks.rowCount).toBe(2);
    for (const row of fks.rows) {
      expect(row.confdeltype).toBe('r');
      expect(row.def).toContain('auth.users(id)');
    }
    const defs = fks.rows.map((r) => r.def as string).join(' ');
    expect(defs).toContain('qa_owner_user_id');
    expect(defs).toContain('registered_by_user_id');
  });

  it('declares no foreign key on root_id', async () => {
    const fk = await pool.query(
      `SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.qa_fixture_roots'::regclass
         AND contype='f'
         AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (root_id)%'`,
    );
    expect(fk.rowCount).toBe(0);
  });

  it('adds exactly one partial lookup index beyond the primary key', async () => {
    const idx = await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname='public' AND tablename='qa_fixture_roots'
       ORDER BY indexname`,
    );
    expect(idx.rowCount).toBe(2);
    const partial = idx.rows.find((r) => !String(r.indexname).endsWith('_pkey'));
    expect(partial?.indexdef).toContain(
      '(qa_owner_user_id, root_kind, root_id)',
    );
    expect(partial?.indexdef).toContain('WHERE active');
  });
});

describe('qa_fixture_roots constraints', () => {
  it('rejects a root_kind outside the allowlist', async () => {
    await expect(insertRoot('driver_profile', randomUUID())).rejects.toThrow(
      /root_kind_allowlist/,
    );
  });

  it('accepts each allowlisted root_kind', async () => {
    await insertRoot('user', SYNTHETIC_USER);
    await insertRoot('recruiter_profile', RECRUITER_ROOT);
    await insertRoot('agency_profile', AGENCY_ROOT);
    const n = await pool.query(
      `SELECT count(*)::int AS c FROM public.qa_fixture_roots`,
    );
    expect(n.rows[0].c).toBe(3);
  });

  it('rejects a user root whose root_id equals the QA owner identity', async () => {
    await expect(insertRoot('user', OWNER)).rejects.toThrow(
      /user_root_not_qa_owner/,
    );
  });

  it('allows a non-user root whose root_id equals the QA owner identity', async () => {
    const r = await insertRoot('recruiter_profile', OWNER);
    expect(r.rowCount).toBe(1);
    await pool.query(
      `DELETE FROM public.qa_fixture_roots WHERE root_kind='recruiter_profile' AND root_id=$1`,
      [OWNER],
    );
  });

  it('rejects active=true with a non-null revoked_at', async () => {
    await expect(
      insertRoot('user', randomUUID(), {
        active: true,
        revokedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/active_revoked_consistent/);
  });

  it('rejects active=false with a null revoked_at', async () => {
    await expect(
      insertRoot('user', randomUUID(), { active: false, revokedAt: null }),
    ).rejects.toThrow(/active_revoked_consistent/);
  });

  it('accepts active=false with a revoked_at timestamp', async () => {
    const id = randomUUID();
    const r = await insertRoot('user', id, { active: false });
    expect(r.rowCount).toBe(1);
    await pool.query(
      `DELETE FROM public.qa_fixture_roots WHERE root_kind='user' AND root_id=$1`,
      [id],
    );
  });

  it('rejects a note longer than 500 characters and accepts exactly 500', async () => {
    await expect(
      insertRoot('user', randomUUID(), { note: 'x'.repeat(501) }),
    ).rejects.toThrow(/note_length/);

    const id = randomUUID();
    const ok = await insertRoot('user', id, { note: 'x'.repeat(500) });
    expect(ok.rowCount).toBe(1);
    await pool.query(
      `DELETE FROM public.qa_fixture_roots WHERE root_kind='user' AND root_id=$1`,
      [id],
    );
  });

  it('rejects a duplicate (root_kind, root_id) pair', async () => {
    await expect(insertRoot('user', SYNTHETIC_USER)).rejects.toThrow(
      /qa_fixture_roots_pkey/,
    );
  });

  it('allows the same root_id under a different root_kind', async () => {
    const r = await insertRoot('agency_profile', SYNTHETIC_USER);
    expect(r.rowCount).toBe(1);
    await pool.query(
      `DELETE FROM public.qa_fixture_roots WHERE root_kind='agency_profile' AND root_id=$1`,
      [SYNTHETIC_USER],
    );
  });
});

describe('qa_fixture_roots privileges and RLS', () => {
  it('enables row level security', async () => {
    const rls = await pool.query(
      `SELECT relrowsecurity FROM pg_class WHERE oid='public.qa_fixture_roots'::regclass`,
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
  });

  it('grants anon no table privileges at all', async () => {
    const privs = await pool.query(
      `SELECT privilege_type FROM information_schema.table_privileges
       WHERE table_schema='public' AND table_name='qa_fixture_roots' AND grantee='anon'`,
    );
    expect(privs.rowCount).toBe(0);
  });

  it('grants authenticated SELECT only', async () => {
    const privs = await pool.query(
      `SELECT privilege_type FROM information_schema.table_privileges
       WHERE table_schema='public' AND table_name='qa_fixture_roots' AND grantee='authenticated'`,
    );
    expect(privs.rows.map((r) => r.privilege_type).sort()).toEqual(['SELECT']);
  });

  it('grants service_role full table privileges', async () => {
    const privs = await pool.query(
      `SELECT privilege_type FROM information_schema.table_privileges
       WHERE table_schema='public' AND table_name='qa_fixture_roots' AND grantee='service_role'`,
    );
    expect(privs.rows.map((r) => r.privilege_type).sort()).toEqual([
      'DELETE',
      'INSERT',
      'REFERENCES',
      'SELECT',
      'TRIGGER',
      'TRUNCATE',
      'UPDATE',
    ]);
  });

  it('grants PUBLIC no table privileges', async () => {
    const privs = await pool.query(
      `SELECT privilege_type FROM information_schema.table_privileges
       WHERE table_schema='public' AND table_name='qa_fixture_roots' AND grantee='PUBLIC'`,
    );
    expect(privs.rowCount).toBe(0);
  });

  it('defines exactly one policy: an authenticated SELECT policy', async () => {
    const pol = await pool.query(
      `SELECT policyname, cmd, roles::text AS roles, qual
       FROM pg_policies
       WHERE schemaname='public' AND tablename='qa_fixture_roots'`,
    );
    expect(pol.rowCount).toBe(1);
    expect(pol.rows[0].policyname).toBe('qa_fixture_roots_super_admin_select');
    expect(pol.rows[0].cmd).toBe('SELECT');
    expect(pol.rows[0].roles).toBe('{authenticated}');
    expect(pol.rows[0].qual).toContain('is_super_admin');
  });

  it('lets a super admin read rows through RLS', async () => {
    const rows = await asRole(OWNER, 'authenticated', (c) =>
      c.query(`SELECT count(*)::int AS c FROM public.qa_fixture_roots`),
    );
    expect(rows.rows[0].c).toBeGreaterThan(0);
  });

  it('returns zero rows to a non-super-admin authenticated user', async () => {
    for (const uid of [OTHER_ADMIN, PLAIN_USER]) {
      const rows = await asRole(uid, 'authenticated', (c) =>
        c.query(`SELECT count(*)::int AS c FROM public.qa_fixture_roots`),
      );
      expect(rows.rows[0].c).toBe(0);
    }
  });

  it('denies every write to authenticated, even for the super admin', async () => {
    for (const stmt of [
      `INSERT INTO public.qa_fixture_roots(root_kind, root_id, qa_owner_user_id, registered_by_user_id) VALUES ('user', gen_random_uuid(), '${OWNER}', '${OWNER}')`,
      `UPDATE public.qa_fixture_roots SET note='x'`,
      `DELETE FROM public.qa_fixture_roots`,
    ]) {
      await expect(
        asRole(OWNER, 'authenticated', (c) => c.query(stmt)),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('denies anon any read', async () => {
    await expect(
      asRole(null, 'anon', (c) =>
        c.query(`SELECT 1 FROM public.qa_fixture_roots`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('is_qa_fixture_root helper contract', () => {
  it('is STABLE, SECURITY DEFINER, and pins the exact search_path', async () => {
    const fn = await pool.query(
      `SELECT p.provolatile, p.prosecdef, p.proconfig, p.prokind,
              pg_get_function_identity_arguments(p.oid) AS args,
              pg_get_function_result(p.oid) AS result,
              l.lanname
       FROM pg_proc p
       JOIN pg_language l ON l.oid = p.prolang
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='is_qa_fixture_root'`,
    );
    expect(fn.rowCount).toBe(1);
    const row = fn.rows[0];
    expect(row.provolatile).toBe('s');
    expect(row.prosecdef).toBe(true);
    expect(row.proconfig).toEqual(['search_path=pg_catalog, public, auth']);
    expect(row.result).toBe('boolean');
    expect(row.args).toBe(
      '_root_kind text, _root_id uuid, _qa_owner_user_id uuid',
    );
    expect(row.lanname).toBe('sql');
  });

  it('performs no dynamic SQL and no mutations in its body', async () => {
    const src = await pool.query(
      `SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='is_qa_fixture_root'`,
    );
    const body = (src.rows[0].prosrc as string).toUpperCase();
    for (const bad of [
      'EXECUTE',
      'INSERT',
      'UPDATE',
      'DELETE',
      'FORMAT(',
      'CREATE ',
    ]) {
      expect(body.includes(bad)).toBe(false);
    }
  });

  it('denies EXECUTE to PUBLIC, anon, and authenticated', async () => {
    const acl = await pool.query(
      `SELECT
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
         has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc,
         p.proacl::text AS acl
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='is_qa_fixture_root'`,
    );
    expect(acl.rows[0].anon).toBe(false);
    expect(acl.rows[0].auth).toBe(false);
    expect(acl.rows[0].svc).toBe(true);
    expect(acl.rows[0].acl).not.toMatch(/(^|,)=X\//);
  });

  it('rejects direct invocation by authenticated', async () => {
    await expect(
      asRole(OWNER, 'authenticated', (c) =>
        c.query(`SELECT public.is_qa_fixture_root('user', $1)`, [
          SYNTHETIC_USER,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('returns true for an active registered root', async () => {
    const r = await pool.query(
      `SELECT public.is_qa_fixture_root('user', $1) AS ok`,
      [SYNTHETIC_USER],
    );
    expect(r.rows[0].ok).toBe(true);
  });

  it('returns true for a matching qa owner and false for a mismatched one', async () => {
    const match = await pool.query(
      `SELECT public.is_qa_fixture_root('user', $1, $2) AS ok`,
      [SYNTHETIC_USER, OWNER],
    );
    expect(match.rows[0].ok).toBe(true);

    const mismatch = await pool.query(
      `SELECT public.is_qa_fixture_root('user', $1, $2) AS ok`,
      [SYNTHETIC_USER, PLAIN_USER],
    );
    expect(mismatch.rows[0].ok).toBe(false);
  });

  it('fails closed for null kind, null root id, unknown kind, and missing root', async () => {
    const cases: Array<[string | null, string | null]> = [
      [null, SYNTHETIC_USER],
      ['user', null],
      [null, null],
      ['driver_profile', SYNTHETIC_USER],
      ['user', randomUUID()],
    ];
    for (const [kind, id] of cases) {
      const r = await pool.query(
        `SELECT public.is_qa_fixture_root($1::text, $2::uuid) AS ok`,
        [kind, id],
      );
      expect(r.rows[0].ok).toBe(false);
    }
  });

  it('returns false once the root is revoked, and true again when reactivated', async () => {
    await pool.query(
      `UPDATE public.qa_fixture_roots
       SET active = false, revoked_at = now()
       WHERE root_kind='recruiter_profile' AND root_id=$1`,
      [RECRUITER_ROOT],
    );
    const off = await pool.query(
      `SELECT public.is_qa_fixture_root('recruiter_profile', $1) AS ok`,
      [RECRUITER_ROOT],
    );
    expect(off.rows[0].ok).toBe(false);

    const offOwner = await pool.query(
      `SELECT public.is_qa_fixture_root('recruiter_profile', $1, $2) AS ok`,
      [RECRUITER_ROOT, OWNER],
    );
    expect(offOwner.rows[0].ok).toBe(false);

    await pool.query(
      `UPDATE public.qa_fixture_roots
       SET active = true, revoked_at = NULL
       WHERE root_kind='recruiter_profile' AND root_id=$1`,
      [RECRUITER_ROOT],
    );
    const on = await pool.query(
      `SELECT public.is_qa_fixture_root('recruiter_profile', $1) AS ok`,
      [RECRUITER_ROOT],
    );
    expect(on.rows[0].ok).toBe(true);
  });
});

describe('candidate blast radius', () => {
  it('adds exactly one table and one function', () => {
    const added = inventoryAfter.filter((o) => !inventoryBefore.includes(o));
    const removed = inventoryBefore.filter((o) => !inventoryAfter.includes(o));
    expect(removed).toEqual([]);
    expect(added.sort()).toEqual([
      'function:is_qa_fixture_root(_root_kind text, _root_id uuid, _qa_owner_user_id uuid)',
      'table:qa_fixture_roots',
    ]);
  });

  it('leaves every Owner QA function definition byte-identical', () => {
    expect(ownerQaDefsAfter).toEqual(ownerQaDefsBefore);
    expect(ownerQaDefsAfter.length).toBeGreaterThanOrEqual(
      OWNER_QA_FUNCTIONS.length,
    );
  });

  it('leaves owner_qa_sessions columns and policies untouched', async () => {
    const cols = await pool.query(
      `SELECT count(*)::int AS c FROM information_schema.columns
       WHERE table_schema='public' AND table_name='owner_qa_sessions'`,
    );
    expect(cols.rows[0].c).toBeGreaterThan(0);

    const pol = await pool.query(
      `SELECT policyname FROM pg_policies
       WHERE schemaname='public' AND tablename='owner_qa_sessions'`,
    );
    expect(pol.rows.map((r) => r.policyname)).toEqual([
      'owner_qa_sessions_owner_select',
    ]);
  });

  it('creates no triggers, sequences, or extra QA objects', async () => {
    const trg = await pool.query(
      `SELECT count(*)::int AS c FROM pg_trigger
       WHERE tgrelid='public.qa_fixture_roots'::regclass AND NOT tgisinternal`,
    );
    expect(trg.rows[0].c).toBe(0);

    const qaObjects = await pool.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind IN ('r','p','S') AND c.relname LIKE 'qa%'
       ORDER BY 1`,
    );
    expect(qaObjects.rows.map((r) => r.relname)).toEqual(['qa_fixture_roots']);

    const qaFns = await pool.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname LIKE '%qa_fixture%'
       ORDER BY 1`,
    );
    expect(qaFns.rows.map((r) => r.proname)).toEqual(['is_qa_fixture_root']);
  });

  it('documents the registry as non-authoritative for billing and authorization', async () => {
    const c = await pool.query(
      `SELECT obj_description('public.qa_fixture_roots'::regclass, 'pg_class') AS t,
              obj_description('public.is_qa_fixture_root(text,uuid,uuid)'::regprocedure, 'pg_proc') AS f`,
    );
    expect(String(c.rows[0].t)).toMatch(
      /NOT billing, subscription, entitlement, or authorization truth/,
    );
    expect(String(c.rows[0].f)).toMatch(
      /NOT billing, subscription, entitlement, or authorization truth/,
    );
  });
});

describe('cleanup', () => {
  it('leaves no fixture residue after deleting registry rows', async () => {
    await pool.query(`DELETE FROM public.qa_fixture_roots`);
    const n = await pool.query(
      `SELECT count(*)::int AS c FROM public.qa_fixture_roots`,
    );
    expect(n.rows[0].c).toBe(0);
  });
});
