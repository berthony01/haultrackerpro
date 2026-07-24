/**
 * Phase 1N-F1-B — Real PostgreSQL 16 gate for the transactional account-data
 * cleanup candidate `public.finalize_my_account_data_deletion()`.
 *
 * Loads the exact candidate SQL from disk and applies it against a real PG16
 * database. Hard-fails at module load when the required database URL is
 * absent; hard-asserts PostgreSQL major version 16. No mocks, no PGlite, no
 * production connection.
 *
 * The fixture provisions minimal auth/user support plus the 35 tables the
 * function references — including a real `agency_member_status` enum, real
 * RLS on a representative surface, and SECURITY DEFINER ownership matching
 * the function. Suite-created roles, memberships, and extensions are all
 * restored exactly in afterAll.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.PHASE1N_ACCOUNT_DELETION_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'PHASE1N_ACCOUNT_DELETION_DATABASE_URL is required for the Phase 1N-F1-B real-Postgres 16 gate.',
  );
}
const URL_STR: string = DATABASE_URL;

const CANDIDATE_PATH = fileURLToPath(
  new URL(
    '../../supabase/migration-candidates/20260724060000_phase1n_f1b_transactional_account_cleanup.sql',
    import.meta.url,
  ),
);
const CANDIDATE_SQL = readFileSync(CANDIDATE_PATH, 'utf8');

const RPC = 'finalize_my_account_data_deletion';
const RPC_IDENT = `public.${RPC}()`;

const CANDIDATE_ROLES = ['anon', 'authenticated', 'service_role'] as const;

const DIRECT_TABLES: readonly string[] = [
  'load_stops', 'expenses', 'fuel_logs', 'loads', 'broker_stats',
  'lane_stats', 'operating_metrics', 'brokers', 'recurring_expense_templates',
  'weekly_snapshots', 'feedback_responses', 'parse_usage', 'user_alerts',
  'expense_automation_logs', 'ai_insights', 'cost_profile', 'parking_favorites',
  'parking_reports', 'parking_verifications', 'driver_point_events',
  'driver_points', 'driver_opportunity_profiles', 'saved_opportunities',
  'notifications', 'notification_preferences', 'recruiter_billing_profiles',
  'subscriptions', 'user_settings', 'profiles',
];

const RELATIONSHIP_TABLES: readonly string[] = [
  'driver_assistants', 'agency_work_items', 'agency_delegation_requests',
  'agency_client_requests', 'agency_members',
];

const FORBIDDEN_TABLES: readonly string[] = [
  'agency_profiles', 'agency_entitlements', 'agency_service_packages',
  'agency_audit_log', 'assistant_audit_log', 'application_events',
  'contract_audit_log', 'admin_audit_log', 'recruiter_contact_requests',
  'recruiter_profiles', 'professional_profiles', 'user_capabilities',
];

// ---------------------------------------------------------------------------
// SQL fixture. Minimal columns/types/constraints required by the function
// and by the tests. All 35 tables the function references are created.
// ---------------------------------------------------------------------------
const RESET_SQL = `
DROP FUNCTION IF EXISTS public.${RPC}() CASCADE;
${[...DIRECT_TABLES, ...RELATIONSHIP_TABLES, ...FORBIDDEN_TABLES].map(
  (t) => `DROP TABLE IF EXISTS public.${t} CASCADE;`,
).join('\n')}
DROP TYPE IF EXISTS public.agency_member_status CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
`;

const BOOTSTRAP_SQL = `
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text
);
GRANT SELECT ON auth.users TO authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TYPE public.agency_member_status AS ENUM ('pending','active','revoked');

-- Forbidden (D5) tables. Present so the function can be non-interference
-- fingerprinted against them, and so tests can prove the owner block and
-- retention boundaries.
CREATE TABLE public.agency_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.agency_profiles(owner_user_id);

CREATE TABLE public.agency_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'starter'
);
CREATE TABLE public.agency_service_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  name text NOT NULL
);
CREATE TABLE public.agency_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action text NOT NULL
);
CREATE TABLE public.assistant_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action text NOT NULL
);
CREATE TABLE public.application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  kind text NOT NULL
);
CREATE TABLE public.contract_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action text NOT NULL
);
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action text NOT NULL
);
CREATE TABLE public.recruiter_contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_user_id uuid,
  driver_user_id uuid
);
CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text
);
CREATE TABLE public.professional_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE TABLE public.user_capabilities (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capability text NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (user_id, capability)
);

-- Relationship tables.
CREATE TABLE public.driver_assistants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assistant_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'assistant',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_user_id, assistant_user_id)
);

CREATE TABLE public.agency_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  assigned_member_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  title text NOT NULL DEFAULT ''
);

CREATE TABLE public.agency_delegation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
);

CREATE TABLE public.agency_client_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  assigned_member_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
);

CREATE TABLE public.agency_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  member_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_email text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  status public.agency_member_status NOT NULL DEFAULT 'pending',
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Direct user_id tables. Minimum viable columns so seeding is trivial.
${DIRECT_TABLES.map((t) => `
CREATE TABLE public.${t} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload text NOT NULL DEFAULT ''
);`).join('\n')}

-- Representative RLS surface: at least one of each category as required.
ALTER TABLE public.agency_profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_assistants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loads                 ENABLE ROW LEVEL SECURITY;

CREATE POLICY agency_profiles_owner_select ON public.agency_profiles
  FOR SELECT TO authenticated USING (owner_user_id = auth.uid());
CREATE POLICY agency_members_self_select ON public.agency_members
  FOR SELECT TO authenticated USING (member_user_id = auth.uid());
CREATE POLICY driver_assistants_self_select ON public.driver_assistants
  FOR SELECT TO authenticated USING (driver_user_id = auth.uid() OR assistant_user_id = auth.uid());
CREATE POLICY loads_self_select ON public.loads
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Baseline table grants so the authenticated role can at least SELECT its
-- own rows for verification queries. Mutation authority is SECURITY DEFINER.
GRANT SELECT ON public.agency_profiles, public.agency_members,
                public.driver_assistants, public.loads
  TO authenticated;
`;

const pool = new pg.Pool({ connectionString: URL_STR, max: 10 });

async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

async function asUser<T>(
  userId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL role authenticated`);
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
      userId ?? '',
    ]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function asRole<T>(
  role: 'anon' | 'service_role',
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL role ${role}`);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function createUser(email: string | null = `${randomUUID()}@example.com`): Promise<string> {
  const id = randomUUID();
  await q(`INSERT INTO auth.users(id, email) VALUES ($1,$2)`, [id, email]);
  return id;
}

async function callRpc(uid: string) {
  return asUser(uid, async (c) => {
    const r = await c.query(`SELECT * FROM public.${RPC}()`);
    return r.rows[0];
  });
}

async function seedDirect(uid: string) {
  for (const t of DIRECT_TABLES) {
    await q(`INSERT INTO public.${t}(user_id, payload) VALUES ($1, $2)`, [uid, `own-${t}`]);
  }
}

async function countDirectFor(uid: string): Promise<number> {
  let total = 0;
  for (const t of DIRECT_TABLES) {
    const r = await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.${t} WHERE user_id=$1`, [uid]);
    total += r[0].n;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Catalog snapshot helpers (scoped to the surfaces the tests need).
// ---------------------------------------------------------------------------
type PublicFunctionRecord = {
  ident: string;
  identityArguments: string;
  def: string;
  prokind: string;
  provolatile: string;
  prosecdef: boolean;
  proconfig: string[] | null;
  owner: string;
  acl: any[];
};
async function snapshotAllPublicFunctions(): Promise<Record<string, PublicFunctionRecord>> {
  const rows = await q<any>(
    `SELECT
       'public.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' AS ident,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_get_functiondef(p.oid) AS def,
       p.prokind::text, p.provolatile::text, p.prosecdef, p.proconfig,
       pg_get_userbyid(p.proowner) AS owner,
       COALESCE(
         (SELECT jsonb_agg(jsonb_build_object(
            'grantee', CASE (acl).grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid((acl).grantee) END,
            'privilege_type', (acl).privilege_type
          ) ORDER BY 1,2)
          FROM aclexplode(COALESCE(p.proacl, acldefault('f'::"char", p.proowner))) acl),
         '[]'::jsonb) AS acl
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' ORDER BY 1`,
  );
  const out: Record<string, PublicFunctionRecord> = {};
  for (const r of rows) {
    out[r.ident] = {
      ident: r.ident,
      identityArguments: r.identity_arguments,
      def: r.def,
      prokind: r.prokind,
      provolatile: r.provolatile,
      prosecdef: r.prosecdef,
      proconfig: r.proconfig,
      owner: r.owner,
      acl: r.acl ?? [],
    };
  }
  return out;
}

async function snapshotTables(): Promise<any[]> {
  return q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' ORDER BY table_name`,
  );
}
async function snapshotColumns(): Promise<any[]> {
  return q(
    `SELECT table_name, column_name, ordinal_position, is_nullable, data_type, column_default
       FROM information_schema.columns
      WHERE table_schema='public'
      ORDER BY table_name, ordinal_position`,
  );
}
async function snapshotConstraints(): Promise<any[]> {
  return q(
    `SELECT ('public.'||c.relname) AS tbl, con.conname, con.contype::text AS contype,
            pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' ORDER BY tbl, conname`,
  );
}
async function snapshotIndexes(): Promise<any[]> {
  return q(
    `SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes
      WHERE schemaname='public' ORDER BY tablename, indexname`,
  );
}
async function snapshotTriggers(): Promise<any[]> {
  return q(
    `SELECT t.tgname, ('public.'||c.relname) AS tbl, pg_get_triggerdef(t.oid) AS def,
            t.tgenabled::text AS enabled
       FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname='public'
      ORDER BY tbl, tgname`,
  );
}
async function snapshotRlsFlags(): Promise<any[]> {
  return q(
    `SELECT c.oid::regclass::text AS tbl, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
      ORDER BY tbl`,
  );
}
async function snapshotPolicies(): Promise<any[]> {
  return q(
    `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
       FROM pg_policies WHERE schemaname='public'
      ORDER BY tablename, policyname`,
  );
}
async function snapshotTableGrants(): Promise<any[]> {
  return q(
    `SELECT table_schema, table_name, grantee, privilege_type
       FROM information_schema.table_privileges
      WHERE table_schema='public'
      ORDER BY table_name, grantee, privilege_type`,
  );
}
async function snapshotExtensions(): Promise<string[]> {
  const rows = await q<{ extname: string }>(`SELECT extname FROM pg_extension ORDER BY extname`);
  return rows.map((r) => r.extname);
}
async function snapshotAll() {
  return {
    tables: await snapshotTables(),
    columns: await snapshotColumns(),
    constraints: await snapshotConstraints(),
    indexes: await snapshotIndexes(),
    triggers: await snapshotTriggers(),
    rlsFlags: await snapshotRlsFlags(),
    policies: await snapshotPolicies(),
    tableGrants: await snapshotTableGrants(),
    publicFunctions: await snapshotAllPublicFunctions(),
  };
}

// ---------------------------------------------------------------------------
// Role bookkeeping (suite-created only).
// ---------------------------------------------------------------------------
const rolesCreated: string[] = [];
const membershipsCreated: string[] = [];
let extensionBaseline: string[] = [];
type RoleBaseline = { rolname: string; exists: boolean };
let roleBaseline: RoleBaseline[] = [];
let explicitMembershipBaseline: { role: string }[] = [];

async function currentUserName(): Promise<string> {
  const rows = await q<{ u: string }>(`SELECT current_user::text AS u`);
  return rows[0].u;
}
async function snapshotRoles(): Promise<RoleBaseline[]> {
  return q<RoleBaseline>(
    `WITH r AS (SELECT rolname, ord FROM unnest($1::text[]) WITH ORDINALITY AS t(rolname,ord))
     SELECT r.rolname, (pr.oid IS NOT NULL) AS exists
       FROM r LEFT JOIN pg_roles pr ON pr.rolname=r.rolname ORDER BY r.ord`,
    [CANDIDATE_ROLES as unknown as string[]],
  );
}
async function snapshotMemberships(member: string): Promise<{ role: string }[]> {
  return q<{ role: string }>(
    `SELECT r.rolname AS role FROM pg_auth_members m
       JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member
      WHERE u.rolname=$1 AND r.rolname = ANY($2)
      ORDER BY r.rolname`,
    [member, CANDIDATE_ROLES as unknown as string[]],
  );
}

let SNAP_BEFORE: Awaited<ReturnType<typeof snapshotAll>>;
let SNAP_AFTER_FIRST: Awaited<ReturnType<typeof snapshotAll>>;

beforeAll(async () => {
  extensionBaseline = await snapshotExtensions();
  const me = await currentUserName();
  roleBaseline = await snapshotRoles();
  explicitMembershipBaseline = await snapshotMemberships(me);

  const existing = new Set(roleBaseline.filter((r) => r.exists).map((r) => r.rolname));

  await pool.query(RESET_SQL);

  for (const role of CANDIDATE_ROLES) {
    if (!existing.has(role)) {
      const opts = role === 'service_role' ? 'NOLOGIN NOINHERIT BYPASSRLS' : 'NOLOGIN NOINHERIT';
      await q(`CREATE ROLE ${role} ${opts}`);
      rolesCreated.push(role);
    }
  }
  const preMemberships = new Set(explicitMembershipBaseline.map((r) => r.role));
  for (const role of CANDIDATE_ROLES) {
    if (!preMemberships.has(role)) {
      await q(`GRANT ${role} TO CURRENT_USER`);
      membershipsCreated.push(role);
    }
  }

  await pool.query(BOOTSTRAP_SQL);

  // Pre-candidate snapshot (must NOT contain the RPC yet).
  SNAP_BEFORE = await snapshotAll();
  if (SNAP_BEFORE.publicFunctions[RPC_IDENT]) {
    throw new Error('RPC unexpectedly present before candidate application');
  }
  if (SNAP_BEFORE.policies.length === 0) {
    throw new Error('Pre-candidate policy snapshot is empty');
  }

  // Apply candidate once.
  await pool.query(CANDIDATE_SQL);
  SNAP_AFTER_FIRST = await snapshotAll();
});

afterAll(async () => {
  try {
    await pool.query(RESET_SQL);
    for (const role of membershipsCreated) {
      await pool.query(`REVOKE ${role} FROM CURRENT_USER`).catch(() => undefined);
    }
    for (const role of rolesCreated) {
      await pool.query(`REASSIGN OWNED BY ${role} TO CURRENT_USER`).catch(() => undefined);
      await pool.query(`DROP OWNED BY ${role} CASCADE`).catch(() => undefined);
      await pool.query(`DROP ROLE IF EXISTS ${role}`);
    }
    const rolesNow = await snapshotRoles();
    expect(rolesNow).toEqual(roleBaseline);
    const me = await currentUserName();
    const membershipsNow = await snapshotMemberships(me);
    expect(membershipsNow).toEqual(explicitMembershipBaseline);
    const extensionsNow = await snapshotExtensions();
    expect(extensionsNow).toEqual(extensionBaseline);
  } finally {
    await pool.end();
  }
});

// ===========================================================================
// Suite
// ===========================================================================

describe('Phase 1N-F1-B — environment and candidate location', () => {
  it('runs against PostgreSQL major version exactly 16', async () => {
    const rows = await q<{ n: number }>(
      `SELECT (current_setting('server_version_num'))::int / 10000 AS n`,
    );
    expect(rows[0].n).toBe(16);
  });

  it('candidate lives in migration-candidates and not in supabase/migrations', () => {
    expect(CANDIDATE_PATH).toContain('/migration-candidates/');
    expect(CANDIDATE_PATH).not.toMatch(/\/supabase\/migrations\//);
    expect(CANDIDATE_SQL.length).toBeGreaterThan(100);
  });
});

describe('Phase 1N-F1-B — function identity and return contract', () => {
  it('creates exactly one zero-argument overload with the required attributes', async () => {
    const rows = await q<any>(
      `SELECT p.prosecdef, p.provolatile::text AS provolatile, p.proconfig,
              pg_get_function_arguments(p.oid) AS args,
              pg_get_function_result(p.oid) AS rettype,
              p.prokind::text AS prokind
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1`,
      [RPC],
    );
    expect(rows).toHaveLength(1);
    const fn = rows[0];
    expect(fn.prosecdef).toBe(true);
    expect(fn.provolatile).toBe('v');
    expect(fn.prokind).toBe('f');
    expect(fn.args).toBe('');
    expect(fn.proconfig).toContain('search_path=pg_catalog, public, auth');
    // Return columns in exact order.
    const ret = String(fn.rettype);
    const expected = [
      'deleted_user_id uuid',
      'relationship_rows_deleted integer',
      'shared_assignments_cleared integer',
      'agency_memberships_revoked integer',
      'direct_rows_deleted integer',
    ];
    for (let i = 0; i < expected.length; i++) {
      expect(ret).toContain(expected[i]);
    }
    // Verify the ordinal appearance is monotonically increasing.
    const positions = expected.map((e) => ret.indexOf(e));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });
});

describe('Phase 1N-F1-B — ACL / authentication', () => {
  it('PUBLIC, anon, and service_role all lack EXECUTE; authenticated has EXECUTE', async () => {
    const rec = SNAP_AFTER_FIRST.publicFunctions[RPC_IDENT];
    expect(rec).toBeDefined();
    const grantees = new Set(rec.acl.map((a: any) => a.grantee));
    expect(grantees.has('PUBLIC')).toBe(false);
    expect(grantees.has('anon')).toBe(false);
    expect(grantees.has('service_role')).toBe(false);
    expect(grantees.has('authenticated')).toBe(true);
  });

  it('null auth.uid() raises SQLSTATE 42501', async () => {
    await expect(
      asUser(null, async (c) => { await c.query(`SELECT * FROM public.${RPC}()`); }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('anon role cannot execute (ACL enforced)', async () => {
    await expect(
      asRole('anon', async (c) => { await c.query(`SELECT * FROM public.${RPC}()`); }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('service_role cannot execute (ACL enforced)', async () => {
    await expect(
      asRole('service_role', async (c) => { await c.query(`SELECT * FROM public.${RPC}()`); }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('Phase 1N-F1-B — cannot target another user', () => {
  it('no argument overload; call with UUID argument fails', async () => {
    const attacker = await createUser();
    const victim = await createUser();
    await seedDirect(victim);
    await expect(
      asUser(attacker, async (c) => {
        await c.query(`SELECT * FROM public.${RPC}($1)`, [victim]);
      }),
    ).rejects.toThrow();
    // victim's rows still exist.
    expect(await countDirectFor(victim)).toBe(DIRECT_TABLES.length);
  });
});

describe('Phase 1N-F1-B — canonical agency-owner hard block', () => {
  it('raises P0001 with the exact message and mutates nothing', async () => {
    const owner = await createUser();
    await seedDirect(owner);
    await q(`INSERT INTO public.agency_profiles(owner_user_id) VALUES ($1)`, [owner]);

    const beforeDirect = await countDirectFor(owner);
    const beforeAgencies = (await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.agency_profiles WHERE owner_user_id=$1`, [owner],
    ))[0].n;

    await expect(callRpc(owner)).rejects.toMatchObject({
      code: 'P0001',
      message: 'You own an agency workspace. Transfer ownership or close the agency before deleting your personal account.',
    });

    expect(await countDirectFor(owner)).toBe(beforeDirect);
    expect(
      (await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.agency_profiles WHERE owner_user_id=$1`, [owner]))[0].n,
    ).toBe(beforeAgencies);
  });
});

describe('Phase 1N-F1-B — relationship and membership cleanup', () => {
  it('assistant-only rows are deleted and unrelated assistant rows survive', async () => {
    const caller = await createUser();
    const driver = await createUser();
    const other = await createUser();
    await q(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id) VALUES ($1,$2)`, [driver, caller]);
    await q(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id) VALUES ($1,$2)`, [driver, other]);

    const res = await callRpc(caller);
    expect(res.relationship_rows_deleted).toBe(1);
    const remain = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.driver_assistants WHERE assistant_user_id=$1`, [other],
    );
    expect(remain[0].n).toBe(1);
  });

  it('driver-side relationship rows are deleted across all required tables', async () => {
    const caller = await createUser();
    const other = await createUser();
    const [{ id: agencyId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_profiles(owner_user_id) VALUES ($1) RETURNING id`, [other],
    );
    // Caller-owned relationship rows across the four driver-keyed tables.
    await q(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id) VALUES ($1,$2)`, [caller, other]);
    await q(`INSERT INTO public.agency_work_items(driver_user_id, agency_id, created_by_user_id) VALUES ($1,$2,$3)`, [caller, agencyId, other]);
    await q(`INSERT INTO public.agency_delegation_requests(driver_user_id, member_user_id) VALUES ($1,$2)`, [caller, other]);
    await q(`INSERT INTO public.agency_client_requests(driver_user_id, agency_id) VALUES ($1,$2)`, [caller, agencyId]);
    // Unrelated rows.
    const other2 = await createUser();
    await q(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id) VALUES ($1,$2)`, [other, other2]);
    await q(`INSERT INTO public.agency_work_items(driver_user_id, agency_id, created_by_user_id) VALUES ($1,$2,$3)`, [other2, agencyId, other]);

    const res = await callRpc(caller);
    expect(res.relationship_rows_deleted).toBe(4);
    // Unrelated rows survive.
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.driver_assistants`))[0].n).toBeGreaterThanOrEqual(1);
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.agency_work_items WHERE driver_user_id=$1`, [other2]))[0].n).toBe(1);
  });

  it('shared assignments are cleared, unrelated assignments unchanged, and member rows revoked', async () => {
    const caller = await createUser();
    const owner = await createUser();
    const other = await createUser();
    const [{ id: agencyId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_profiles(owner_user_id) VALUES ($1) RETURNING id`, [owner],
    );
    // Shared rows keyed to a different driver but assigned to caller.
    const driver = await createUser();
    const [{ id: workId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_work_items(driver_user_id, agency_id, assigned_member_user_id, created_by_user_id)
       VALUES ($1,$2,$3,$4) RETURNING id`, [driver, agencyId, caller, owner],
    );
    const [{ id: reqId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_client_requests(driver_user_id, agency_id, assigned_member_user_id)
       VALUES ($1,$2,$3) RETURNING id`, [driver, agencyId, caller],
    );
    // Unrelated assignment.
    await q(`INSERT INTO public.agency_work_items(driver_user_id, agency_id, assigned_member_user_id, created_by_user_id)
             VALUES ($1,$2,$3,$4)`, [driver, agencyId, other, owner]);

    // Caller as agency member with pending status.
    await q(`INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, status)
             VALUES ($1,$2,$3,'active')`, [agencyId, caller, 'caller@example.com']);
    await q(`INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, status)
             VALUES ($1,$2,$3,'active')`, [agencyId, other, 'other@example.com']);

    const res = await callRpc(caller);
    expect(res.shared_assignments_cleared).toBe(2);
    expect(res.agency_memberships_revoked).toBe(1);

    // Shared work_item still exists, assignment cleared.
    const wi = (await q<any>(`SELECT * FROM public.agency_work_items WHERE id=$1`, [workId]))[0];
    expect(wi.assigned_member_user_id).toBeNull();
    expect(wi.driver_user_id).toBe(driver); // unchanged
    // Client request still exists, assignment cleared.
    const cr = (await q<any>(`SELECT * FROM public.agency_client_requests WHERE id=$1`, [reqId]))[0];
    expect(cr.assigned_member_user_id).toBeNull();
    // Unrelated assignment unchanged.
    const unrelated = await q<any>(
      `SELECT assigned_member_user_id FROM public.agency_work_items WHERE assigned_member_user_id=$1`, [other],
    );
    expect(unrelated).toHaveLength(1);
    // Membership: caller revoked, other untouched, agency+entitlements untouched.
    const rows = await q<any>(`SELECT status::text AS status, member_user_id, revoked_at FROM public.agency_members ORDER BY invite_email`);
    const callerRow = rows.find((r) => r.member_user_id === null);
    expect(callerRow.status).toBe('revoked');
    expect(callerRow.revoked_at).not.toBeNull();
    const otherRow = rows.find((r) => r.member_user_id === other);
    expect(otherRow.status).toBe('active');
    // Agency profile untouched.
    const ap = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.agency_profiles WHERE id=$1`, [agencyId]))[0].n;
    expect(ap).toBe(1);
  });
});

describe('Phase 1N-F1-B — direct cleanup across all 29 tables', () => {
  it('caller rows removed from every table; unrelated rows survive; direct counter = 29', async () => {
    const caller = await createUser();
    const other = await createUser();
    await seedDirect(caller);
    await seedDirect(other);
    const res = await callRpc(caller);
    expect(res.direct_rows_deleted).toBe(DIRECT_TABLES.length);
    expect(DIRECT_TABLES.length).toBe(29);
    for (const t of DIRECT_TABLES) {
      const own = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.${t} WHERE user_id=$1`, [caller]))[0].n;
      const foreign = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.${t} WHERE user_id=$1`, [other]))[0].n;
      expect(own).toBe(0);
      expect(foreign).toBe(1);
    }
  });
});

describe('Phase 1N-F1-B — aggregate counters', () => {
  it('all four counters equal the exact affected row counts across mixed seed', async () => {
    const caller = await createUser();
    const owner = await createUser();
    const driver = await createUser();
    const other = await createUser();
    const [{ id: agencyId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_profiles(owner_user_id) VALUES ($1) RETURNING id`, [owner],
    );

    // Relationship rows = 3 (assistant, driver_ai_delegation, driver_ci)
    await q(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id) VALUES ($1,$2)`, [caller, other]);
    await q(`INSERT INTO public.agency_delegation_requests(driver_user_id, member_user_id) VALUES ($1,$2)`, [caller, other]);
    await q(`INSERT INTO public.agency_client_requests(driver_user_id, agency_id) VALUES ($1,$2)`, [caller, agencyId]);

    // Shared assignments = 1
    await q(`INSERT INTO public.agency_work_items(driver_user_id, agency_id, assigned_member_user_id, created_by_user_id)
             VALUES ($1,$2,$3,$4)`, [driver, agencyId, caller, owner]);

    // Membership = 1
    await q(`INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, status)
             VALUES ($1,$2,'m@x','active')`, [agencyId, caller]);

    // Direct rows = 29 (one per table).
    await seedDirect(caller);

    const res = await callRpc(caller);
    expect(res.relationship_rows_deleted).toBe(3);
    expect(res.shared_assignments_cleared).toBe(1);
    expect(res.agency_memberships_revoked).toBe(1);
    expect(res.direct_rows_deleted).toBe(29);
    expect(res.deleted_user_id).toBe(caller);
  });
});

describe('Phase 1N-F1-B — full transactional rollback', () => {
  it('an exception raised inside cost_profile DELETE rolls back every prior mutation', async () => {
    const caller = await createUser();
    const owner = await createUser();
    const other = await createUser();
    const [{ id: agencyId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_profiles(owner_user_id) VALUES ($1) RETURNING id`, [owner],
    );

    // Seed rows across relationship, shared, membership, and direct categories.
    await q(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id) VALUES ($1,$2)`, [caller, other]);
    await q(`INSERT INTO public.agency_work_items(driver_user_id, agency_id, assigned_member_user_id, created_by_user_id)
             VALUES ($1,$2,$3,$4)`, [other, agencyId, caller, owner]);
    await q(`INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, status)
             VALUES ($1,$2,'rb@x','active')`, [agencyId, caller]);
    await seedDirect(caller);

    // Install a BEFORE DELETE trigger on cost_profile that raises for our caller.
    await q(`
      CREATE OR REPLACE FUNCTION public._t_rollback_guard() RETURNS trigger LANGUAGE plpgsql AS $t$
      BEGIN
        RAISE EXCEPTION 'rollback-guard-trigger' USING ERRCODE = 'P0001';
      END $t$;
      CREATE TRIGGER _t_rollback_guard BEFORE DELETE ON public.cost_profile
        FOR EACH ROW EXECUTE FUNCTION public._t_rollback_guard();
    `);

    try {
      await expect(callRpc(caller)).rejects.toMatchObject({
        message: expect.stringContaining('rollback-guard-trigger'),
      });

      // Nothing rolled forward: every seed row must still be present.
      expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.driver_assistants WHERE assistant_user_id=$1`, [caller]))[0].n).toBe(1);
      const wi = (await q<any>(`SELECT assigned_member_user_id FROM public.agency_work_items WHERE assigned_member_user_id=$1`, [caller]));
      expect(wi).toHaveLength(1);
      const mem = await q<any>(`SELECT status::text AS status, member_user_id FROM public.agency_members WHERE agency_id=$1`, [agencyId]);
      expect(mem[0].status).toBe('active');
      expect(mem[0].member_user_id).toBe(caller);
      expect(await countDirectFor(caller)).toBe(DIRECT_TABLES.length);
    } finally {
      await q(`DROP TRIGGER IF EXISTS _t_rollback_guard ON public.cost_profile;
               DROP FUNCTION IF EXISTS public._t_rollback_guard();`);
    }
  });
});

describe('Phase 1N-F1-B — idempotent caller retry', () => {
  it('second call returns same UUID and all zero counters', async () => {
    const caller = await createUser();
    await seedDirect(caller);
    const first = await callRpc(caller);
    expect(first.direct_rows_deleted).toBe(DIRECT_TABLES.length);
    const second = await callRpc(caller);
    expect(second.deleted_user_id).toBe(caller);
    expect(second.relationship_rows_deleted).toBe(0);
    expect(second.shared_assignments_cleared).toBe(0);
    expect(second.agency_memberships_revoked).toBe(0);
    expect(second.direct_rows_deleted).toBe(0);
  });
});

describe('Phase 1N-F1-B — concurrent same-user calls serialized by advisory lock', () => {
  it('both succeed and total deleted rows equal exactly the seeded amount once', async () => {
    const caller = await createUser();
    await seedDirect(caller);

    const [r1, r2] = await Promise.all([callRpc(caller), callRpc(caller)]);
    const total = r1.direct_rows_deleted + r2.direct_rows_deleted;
    expect(total).toBe(DIRECT_TABLES.length);
    expect(r1.deleted_user_id).toBe(caller);
    expect(r2.deleted_user_id).toBe(caller);
    // Final state: no caller rows anywhere.
    expect(await countDirectFor(caller)).toBe(0);
  });
});

describe('Phase 1N-F1-B — candidate DDL idempotency', () => {
  it('second exact candidate application leaves function/ACL/catalog identical', async () => {
    await pool.query(CANDIDATE_SQL);
    const after = await snapshotAll();
    expect(after.publicFunctions[RPC_IDENT]).toEqual(SNAP_AFTER_FIRST.publicFunctions[RPC_IDENT]);
  });
});

describe('Phase 1N-F1-B — non-interference fingerprints', () => {
  it('only added function identity is the RPC; every other function is byte-identical', () => {
    const before = SNAP_BEFORE.publicFunctions;
    const after = SNAP_AFTER_FIRST.publicFunctions;
    const beforeKeys = new Set(Object.keys(before));
    const afterKeys = Object.keys(after);
    const added = afterKeys.filter((k) => !beforeKeys.has(k));
    expect(added).toEqual([RPC_IDENT]);
    const removed = [...beforeKeys].filter((k) => !new Set(afterKeys).has(k));
    expect(removed).toEqual([]);
    for (const k of beforeKeys) {
      expect(after[k]).toEqual(before[k]);
    }
  });

  it('tables, columns, constraints, indexes, triggers, RLS flags, policies, and grants unchanged', () => {
    expect(SNAP_AFTER_FIRST.tables).toEqual(SNAP_BEFORE.tables);
    expect(SNAP_AFTER_FIRST.columns).toEqual(SNAP_BEFORE.columns);
    expect(SNAP_AFTER_FIRST.constraints).toEqual(SNAP_BEFORE.constraints);
    expect(SNAP_AFTER_FIRST.indexes).toEqual(SNAP_BEFORE.indexes);
    expect(SNAP_AFTER_FIRST.triggers).toEqual(SNAP_BEFORE.triggers);
    expect(SNAP_AFTER_FIRST.rlsFlags).toEqual(SNAP_BEFORE.rlsFlags);
    expect(SNAP_AFTER_FIRST.policies).toEqual(SNAP_BEFORE.policies);
    expect(SNAP_AFTER_FIRST.tableGrants).toEqual(SNAP_BEFORE.tableGrants);
  });

  it('extension set unchanged across candidate application', async () => {
    const now = await snapshotExtensions();
    expect(now).toEqual(extensionBaseline);
  });
});

describe('Phase 1N-F1-B — forbidden-target and required-target source scan', () => {
  it('candidate does not mutate any D5 forbidden table or auth.users', () => {
    for (const t of FORBIDDEN_TABLES) {
      const pattern = new RegExp(`(DELETE\\s+FROM|UPDATE)\\s+public\\.${t}\\b`, 'i');
      expect(pattern.test(CANDIDATE_SQL)).toBe(false);
    }
    expect(/DELETE\s+FROM\s+auth\.users/i.test(CANDIDATE_SQL)).toBe(false);
    expect(/UPDATE\s+auth\.users/i.test(CANDIDATE_SQL)).toBe(false);
  });

  it('candidate contains explicit DELETE statements for all 29 direct tables', () => {
    for (const t of DIRECT_TABLES) {
      const pattern = new RegExp(`DELETE\\s+FROM\\s+public\\.${t}\\s+WHERE\\s+user_id\\s*=\\s*_uid`, 'i');
      expect(pattern.test(CANDIDATE_SQL)).toBe(true);
    }
  });

  it('candidate contains all required relationship / assignment / membership statements', () => {
    const required = [
      /DELETE\s+FROM\s+public\.driver_assistants\s+WHERE\s+driver_user_id\s*=\s*_uid/i,
      /DELETE\s+FROM\s+public\.driver_assistants\s+WHERE\s+assistant_user_id\s*=\s*_uid/i,
      /DELETE\s+FROM\s+public\.agency_work_items\s+WHERE\s+driver_user_id\s*=\s*_uid/i,
      /DELETE\s+FROM\s+public\.agency_delegation_requests\s+WHERE\s+driver_user_id\s*=\s*_uid/i,
      /DELETE\s+FROM\s+public\.agency_delegation_requests\s+WHERE\s+member_user_id\s*=\s*_uid/i,
      /DELETE\s+FROM\s+public\.agency_client_requests\s+WHERE\s+driver_user_id\s*=\s*_uid/i,
      /UPDATE\s+public\.agency_work_items[\s\S]*assigned_member_user_id\s*=\s*NULL[\s\S]*WHERE\s+assigned_member_user_id\s*=\s*_uid/i,
      /UPDATE\s+public\.agency_client_requests[\s\S]*assigned_member_user_id\s*=\s*NULL[\s\S]*WHERE\s+assigned_member_user_id\s*=\s*_uid/i,
      /UPDATE\s+public\.agency_members[\s\S]*status\s*=\s*'revoked'[\s\S]*member_user_id\s*=\s*NULL[\s\S]*WHERE\s+member_user_id\s*=\s*_uid/i,
    ];
    for (const r of required) expect(r.test(CANDIDATE_SQL)).toBe(true);
  });

  it('candidate never uses dynamic EXECUTE for cleanup statements', () => {
    // Line-by-line so quoted user-facing strings that contain the word
    // "execute" (none currently) never trigger a false positive; the intent
    // is to forbid the PL/pgSQL EXECUTE dynamic-statement command.
    for (const line of CANDIDATE_SQL.split('\n')) {
      const stripped = line.replace(/--.*$/, '').trim();
      if (/^EXECUTE\b/i.test(stripped)) {
        throw new Error(`Dynamic EXECUTE forbidden: ${stripped}`);
      }
    }
  });

  it('candidate has the exact function identity, search_path, and ACL clauses', () => {
    expect(CANDIDATE_SQL).toMatch(/CREATE OR REPLACE FUNCTION\s+public\.finalize_my_account_data_deletion\s*\(\s*\)/);
    expect(CANDIDATE_SQL).toMatch(/SET\s+search_path\s*=\s*pg_catalog\s*,\s*public\s*,\s*auth/);
    expect(CANDIDATE_SQL).toMatch(/SECURITY DEFINER/);
    expect(CANDIDATE_SQL).toMatch(/pg_advisory_xact_lock\s*\(\s*pg_catalog\.hashtextextended/);
    expect(CANDIDATE_SQL).toMatch(/REVOKE ALL\s+ON FUNCTION\s+public\.finalize_my_account_data_deletion\(\)\s+FROM PUBLIC/i);
    expect(CANDIDATE_SQL).toMatch(/REVOKE EXECUTE\s+ON FUNCTION\s+public\.finalize_my_account_data_deletion\(\)\s+FROM anon/i);
    expect(CANDIDATE_SQL).toMatch(/REVOKE EXECUTE\s+ON FUNCTION\s+public\.finalize_my_account_data_deletion\(\)\s+FROM service_role/i);
    expect(CANDIDATE_SQL).toMatch(/GRANT\s+EXECUTE\s+ON FUNCTION\s+public\.finalize_my_account_data_deletion\(\)\s+TO authenticated/i);
  });
});
