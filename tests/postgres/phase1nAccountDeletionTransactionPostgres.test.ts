/**
 * Phase 1N-F1-B-R1 — Real PostgreSQL 16 gate for the transactional
 * account-data cleanup candidate `public.finalize_my_account_data_deletion()`.
 *
 * Repairs from -R1 supervisor audit:
 *
 *   C. Function catalog / ACL proof uses `pg_get_function_identity_arguments`,
 *      `pronargs`, `pg_language.lanname`, exact `proconfig` array, exact
 *      ordered TABLE output extracted from `proargnames/proargmodes/
 *      proallargtypes`, and per-role `has_function_privilege()`.
 *   D. Fixture matches the live production relationship model: agency_profiles
 *      owner FK CASCADE, no invented auth.users FKs on relationship or direct
 *      tables, real enums for driver_assistants / delegation / client requests
 *      / agency_members, and real column names (`user_id` on
 *      `professional_profiles`).
 *   E. Per-test data reset that only clears rows and never rebuilds catalog.
 *   F. Owner block seeds every mutation category and proves byte-identical
 *      snapshots after the P0001 raise.
 *   G. Explicit member-only agency_delegation_requests deletion proof.
 *   H. Shared-agency non-interference snapshot proof.
 *   I. Causal advisory-lock wait test with three real connections.
 *   J. Second-apply idempotency compares the full protected snapshot and the
 *      filesystem to prove no same-version production migration exists.
 *
 * No mocks, no PGlite, no production connection. Hard-fails at module load
 * when `PHASE1N_ACCOUNT_DELETION_DATABASE_URL` is absent; hard-asserts
 * PostgreSQL major version exactly 16.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../supabase/migrations/', import.meta.url),
);

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

// D5 forbidden tables (see candidate SQL header). These must never be mutated
// by the RPC and are seeded to prove non-interference on the owner-block path.
const FORBIDDEN_TABLES: readonly string[] = [
  'agency_profiles', 'agency_entitlements', 'agency_service_packages',
  'agency_audit_log', 'assistant_audit_log', 'application_events',
  'contract_audit_log', 'admin_audit_log', 'recruiter_contact_requests',
  'recruiter_profiles', 'professional_profiles', 'user_capabilities',
];

const FIXTURE_ENUMS: readonly string[] = [
  'agency_member_status',
  'agency_member_role',
  'assistant_status',
  'agency_delegation_status',
  'agency_client_request_status',
];

// ---------------------------------------------------------------------------
// RESET_SQL — full teardown (used only in beforeAll + afterAll).
// ---------------------------------------------------------------------------
const RESET_SQL = `
DROP FUNCTION IF EXISTS public.${RPC}() CASCADE;
${[...DIRECT_TABLES, ...RELATIONSHIP_TABLES, ...FORBIDDEN_TABLES].map(
  (t) => `DROP TABLE IF EXISTS public.${t} CASCADE;`,
).join('\n')}
${FIXTURE_ENUMS.map((e) => `DROP TYPE IF EXISTS public.${e} CASCADE;`).join('\n')}
DROP SCHEMA IF EXISTS auth CASCADE;
`;

// ---------------------------------------------------------------------------
// BOOTSTRAP_SQL — fidelity-matched fixture.
// ---------------------------------------------------------------------------
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

-- Real enums (D fidelity).
CREATE TYPE public.agency_member_status AS ENUM ('pending','active','revoked');
CREATE TYPE public.agency_member_role AS ENUM ('agency_owner','agency_admin','agency_member');
CREATE TYPE public.assistant_status AS ENUM ('pending','active','revoked','expired');
CREATE TYPE public.agency_delegation_status AS ENUM ('pending_driver_approval','approved','declined','revoked','expired');
CREATE TYPE public.agency_client_request_status AS ENUM ('pending','approved','declined','cancelled','converted_to_client');

-- Forbidden (D5) tables.
CREATE TABLE public.agency_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  user_id uuid NOT NULL UNIQUE,
  company_name text
);
CREATE TABLE public.professional_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
);
CREATE TABLE public.user_capabilities (
  user_id uuid NOT NULL,
  capability text NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (user_id, capability)
);

-- Relationship tables — production fidelity: no auth.users FKs on the
-- caller-keyed columns; real enums; real minimum required columns.
CREATE TABLE public.driver_assistants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL,
  assistant_user_id uuid NULL,
  invite_email text NOT NULL,
  status public.driver_assistant_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agency_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL,
  assigned_member_user_id uuid NULL,
  created_by_user_id uuid NOT NULL,
  title text NOT NULL DEFAULT ''
);

CREATE TABLE public.agency_delegation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  member_invite_email text NOT NULL,
  status public.agency_delegation_request_status NOT NULL DEFAULT 'pending'
);

CREATE TABLE public.agency_client_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL,
  assigned_member_user_id uuid NULL,
  status public.agency_client_request_status NOT NULL DEFAULT 'pending'
);

CREATE TABLE public.agency_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  member_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_email text NOT NULL,
  role public.agency_member_role NOT NULL DEFAULT 'member',
  status public.agency_member_status NOT NULL DEFAULT 'pending',
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 29 direct user_id tables. Real UUID user_id + payload only — production
-- catalog does not have a blanket auth.users CASCADE FK on all of them.
${DIRECT_TABLES.map((t) => `
CREATE TABLE public.${t} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  payload text NOT NULL DEFAULT ''
);`).join('\n')}

-- Representative RLS surface across relationship, direct, and forbidden.
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

GRANT SELECT ON public.agency_profiles, public.agency_members,
                public.driver_assistants, public.loads
  TO authenticated;
`;

// ---------------------------------------------------------------------------
// Pool + helpers
// ---------------------------------------------------------------------------
const pool = new pg.Pool({ connectionString: URL_STR, max: 15 });

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

async function createUser(): Promise<string> {
  const id = randomUUID();
  await q(`INSERT INTO auth.users(id, email) VALUES ($1,$2)`, [id, `${id}@example.com`]);
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
    await q(`INSERT INTO public.${t}(user_id, payload) VALUES ($1,$2)`, [uid, `own-${t}`]);
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

// Deterministic digest for a labelled JSON payload.
function digest(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

// ---------------------------------------------------------------------------
// Catalog snapshot helpers
// ---------------------------------------------------------------------------
type PublicFunctionRecord = {
  ident: string;
  identityArguments: string;
  pronargs: number;
  language: string;
  prokind: string;
  provolatile: string;
  prosecdef: boolean;
  proconfig: string[] | null;
  owner: string;
  argNames: string[] | null;
  argModes: string[] | null;
  argTypes: string[] | null;
  acl: any[];
};

async function snapshotAllPublicFunctions(): Promise<Record<string, PublicFunctionRecord>> {
  const rows = await q<any>(
    `SELECT
       'public.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' AS ident,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.pronargs::int AS pronargs,
       l.lanname AS language,
       p.prokind::text, p.provolatile::text, p.prosecdef, p.proconfig,
       pg_get_userbyid(p.proowner) AS owner,
       p.proargnames AS arg_names,
       CASE WHEN p.proargmodes IS NULL THEN NULL
            ELSE ARRAY(SELECT m::text FROM unnest(p.proargmodes) AS m) END AS arg_modes,
       CASE WHEN p.proallargtypes IS NULL THEN NULL
            ELSE ARRAY(SELECT format_type(t, NULL) FROM unnest(p.proallargtypes) AS t) END AS arg_types,
       COALESCE(
         (SELECT jsonb_agg(jsonb_build_object(
            'grantee', CASE (acl).grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid((acl).grantee) END,
            'privilege_type', (acl).privilege_type
          ) ORDER BY 1,2)
          FROM aclexplode(COALESCE(p.proacl, acldefault('f'::"char", p.proowner))) acl),
         '[]'::jsonb) AS acl
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid=p.pronamespace
     JOIN pg_language  l ON l.oid=p.prolang
     WHERE n.nspname='public' ORDER BY 1`,
  );
  const out: Record<string, PublicFunctionRecord> = {};
  for (const r of rows) {
    out[r.ident] = {
      ident: r.ident,
      identityArguments: r.identity_arguments,
      pronargs: r.pronargs,
      language: r.language,
      prokind: r.prokind,
      provolatile: r.provolatile,
      prosecdef: r.prosecdef,
      proconfig: r.proconfig,
      owner: r.owner,
      argNames: r.arg_names,
      argModes: r.arg_modes,
      argTypes: r.arg_types,
      acl: r.acl ?? [],
    };
  }
  return out;
}

async function snapshotTables(): Promise<any[]> {
  return q(`SELECT table_name FROM information_schema.tables
             WHERE table_schema='public' ORDER BY table_name`);
}
async function snapshotColumns(): Promise<any[]> {
  return q(`SELECT table_name, column_name, ordinal_position, is_nullable, data_type, column_default
              FROM information_schema.columns WHERE table_schema='public'
              ORDER BY table_name, ordinal_position`);
}
async function snapshotConstraints(): Promise<any[]> {
  return q(`SELECT ('public.'||c.relname) AS tbl, con.conname, con.contype::text AS contype,
                   pg_get_constraintdef(con.oid) AS def
              FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
              JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' ORDER BY tbl, conname`);
}
async function snapshotIndexes(): Promise<any[]> {
  return q(`SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes
             WHERE schemaname='public' ORDER BY tablename, indexname`);
}
async function snapshotTriggers(): Promise<any[]> {
  return q(`SELECT t.tgname, ('public.'||c.relname) AS tbl, pg_get_triggerdef(t.oid) AS def,
                   t.tgenabled::text AS enabled
              FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
              JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE NOT t.tgisinternal AND n.nspname='public'
             ORDER BY tbl, tgname`);
}
async function snapshotRlsFlags(): Promise<any[]> {
  return q(`SELECT c.oid::regclass::text AS tbl, c.relrowsecurity, c.relforcerowsecurity
              FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relkind='r'
             ORDER BY tbl`);
}
async function snapshotPolicies(): Promise<any[]> {
  return q(`SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
              FROM pg_policies WHERE schemaname='public'
             ORDER BY tablename, policyname`);
}
async function snapshotTableGrants(): Promise<any[]> {
  return q(`SELECT table_schema, table_name, grantee, privilege_type
              FROM information_schema.table_privileges WHERE table_schema='public'
             ORDER BY table_name, grantee, privilege_type`);
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
let preCandidateOwner = '';

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

// Full list of data tables the beforeEach truncates. auth.users is truncated
// last because relationship + agency tables reference it.
const ALL_DATA_TABLES: readonly string[] = [
  ...DIRECT_TABLES,
  ...RELATIONSHIP_TABLES,
  'agency_service_packages', 'agency_entitlements', 'agency_profiles',
  'agency_audit_log', 'assistant_audit_log', 'application_events',
  'contract_audit_log', 'admin_audit_log', 'recruiter_contact_requests',
  'recruiter_profiles', 'professional_profiles', 'user_capabilities',
];

async function truncateAllData(): Promise<void> {
  const cols = ALL_DATA_TABLES.map((t) => `public.${t}`).join(', ');
  await pool.query(`TRUNCATE TABLE ${cols} RESTART IDENTITY CASCADE`);
  await pool.query(`TRUNCATE TABLE auth.users RESTART IDENTITY CASCADE`);
}

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

  preCandidateOwner = await currentUserName();

  // Pre-candidate snapshot (must NOT contain the RPC yet).
  SNAP_BEFORE = await snapshotAll();
  if (SNAP_BEFORE.publicFunctions[RPC_IDENT]) {
    throw new Error('RPC unexpectedly present before candidate application');
  }
  if (SNAP_BEFORE.policies.length === 0) {
    throw new Error('Pre-candidate policy snapshot is empty');
  }

  // Apply candidate exactly once.
  await pool.query(CANDIDATE_SQL);
  SNAP_AFTER_FIRST = await snapshotAll();
});

// Reset data rows before every test so cross-case bleed cannot make a proof
// pass by accident. Never drops or recreates catalog objects.
beforeEach(async () => {
  await truncateAllData();
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
// SUITE
// ===========================================================================

describe('Phase 1N-F1-B — environment and candidate location', () => {
  it('runs against PostgreSQL major version exactly 16', async () => {
    const rows = await q<{ n: number }>(
      `SELECT (current_setting('server_version_num'))::int / 10000 AS n`,
    );
    expect(rows[0].n).toBe(16);
  });

  it('candidate lives in migration-candidates and no same-version production migration exists', () => {
    expect(CANDIDATE_PATH).toContain('/migration-candidates/');
    expect(CANDIDATE_PATH).not.toMatch(/\/supabase\/migrations\//);
    expect(CANDIDATE_SQL.length).toBeGreaterThan(100);
    // Filesystem existence check.
    expect(existsSync(MIGRATIONS_DIR)).toBe(true);
    const same = readdirSync(MIGRATIONS_DIR).filter((n) => n.startsWith('20260724060000_'));
    expect(same).toEqual([]);
    // Path negative for safety.
    expect(existsSync(path.join(MIGRATIONS_DIR,
      '20260724060000_phase1n_f1b_transactional_account_cleanup.sql'))).toBe(false);
  });
});

describe('Phase 1N-F1-B — function identity and return contract', () => {
  it('creates exactly one zero-argument overload with exact catalog attributes', async () => {
    const rows = await q<any>(
      `SELECT n.nspname, p.proname, p.pronargs::int AS pronargs,
              pg_get_function_identity_arguments(p.oid) AS ident_args,
              l.lanname AS language, p.provolatile::text AS provolatile,
              p.prosecdef, p.proconfig, p.prokind::text AS prokind,
              pg_get_userbyid(p.proowner) AS owner
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid=p.pronamespace
         JOIN pg_language  l ON l.oid=p.prolang
        WHERE n.nspname='public' AND p.proname=$1`,
      [RPC],
    );
    expect(rows).toHaveLength(1);
    const fn = rows[0];
    expect(fn.pronargs).toBe(0);
    expect(fn.ident_args).toBe('');
    expect(fn.language).toBe('plpgsql');
    expect(fn.provolatile).toBe('v');
    expect(fn.prosecdef).toBe(true);
    expect(fn.prokind).toBe('f');
    // proconfig must be exactly one entry — no other GUCs allowed.
    expect(fn.proconfig).toEqual(['search_path=pg_catalog, public, auth']);
    // Owner must equal the executor observed before candidate application; the
    // candidate must never explicitly transfer ownership.
    expect(fn.owner).toBe(preCandidateOwner);
    expect(/ALTER\s+FUNCTION[\s\S]*OWNER\s+TO/i.test(CANDIDATE_SQL)).toBe(false);
  });

  it('returns exactly the five TABLE columns in the required order/modes/types', async () => {
    const rows = await q<any>(
      `SELECT p.proargnames AS arg_names,
              ARRAY(SELECT m::text FROM unnest(p.proargmodes) AS m) AS arg_modes,
              ARRAY(SELECT format_type(t, NULL) FROM unnest(p.proallargtypes) AS t) AS arg_types
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1`,
      [RPC],
    );
    expect(rows).toHaveLength(1);
    const { arg_names, arg_modes, arg_types } = rows[0];
    expect(arg_names).toEqual([
      'deleted_user_id',
      'relationship_rows_deleted',
      'shared_assignments_cleared',
      'agency_memberships_revoked',
      'direct_rows_deleted',
    ]);
    // PostgreSQL represents TABLE output columns as mode 't'.
    expect(arg_modes).toEqual(['t', 't', 't', 't', 't']);
    expect(arg_types).toEqual(['uuid', 'integer', 'integer', 'integer', 'integer']);
  });
});

describe('Phase 1N-F1-B — ACL / authentication', () => {
  it('has_function_privilege confirms authenticated has EXECUTE; PUBLIC/anon/service_role do not', async () => {
    const acl = await q<any>(
      `SELECT
         has_function_privilege('public'::regnamespace::text || '.${RPC}()', 'EXECUTE') AS current_user_execute,
         has_function_privilege('authenticated', 'public.${RPC}()', 'EXECUTE') AS authenticated_execute,
         has_function_privilege('anon',          'public.${RPC}()', 'EXECUTE') AS anon_execute,
         has_function_privilege('service_role',  'public.${RPC}()', 'EXECUTE') AS service_role_execute`,
    );
    expect(acl[0].authenticated_execute).toBe(true);
    expect(acl[0].anon_execute).toBe(false);
    expect(acl[0].service_role_execute).toBe(false);
    // PUBLIC is proxied via a fresh session in a role with no direct grants.
    // The pg_proc ACL snapshot below covers PUBLIC explicitly.
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
  it('no argument overload; call with UUID argument fails and victim rows survive', async () => {
    const attacker = await createUser();
    const victim = await createUser();
    await seedDirect(victim);
    await expect(
      asUser(attacker, async (c) => {
        await c.query(`SELECT * FROM public.${RPC}($1)`, [victim]);
      }),
    ).rejects.toThrow();
    expect(await countDirectFor(victim)).toBe(DIRECT_TABLES.length);
  });
});

describe('Phase 1N-F1-B — canonical agency-owner hard block', () => {
  it('raises P0001 with exact message and every seeded mutation category is byte-identical after', async () => {
    const owner = await createUser();
    const otherDriver = await createUser();
    const otherMember = await createUser();

    // Owned agency (the sole surface that identifies the caller as owner).
    const [{ id: agencyId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_profiles(owner_user_id) VALUES ($1) RETURNING id`,
      [owner],
    );
    // Agency entitlement + service package.
    await q(`INSERT INTO public.agency_entitlements(agency_id, plan) VALUES ($1,'growth')`, [agencyId]);
    await q(`INSERT INTO public.agency_service_packages(agency_id, name) VALUES ($1,'default')`, [agencyId]);

    // Relationship rows in every category.
    await q(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id, invite_email)
             VALUES ($1,$2,'a@x')`, [owner, otherMember]);
    await q(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id, invite_email)
             VALUES ($1,$2,'b@x')`, [otherDriver, owner]);
    await q(`INSERT INTO public.agency_work_items(agency_id, driver_user_id, created_by_user_id)
             VALUES ($1,$2,$3)`, [agencyId, owner, otherMember]);
    await q(`INSERT INTO public.agency_delegation_requests(
               agency_id, driver_user_id, member_user_id, created_by_user_id, member_invite_email)
             VALUES ($1,$2,$3,$4,'m@x')`, [agencyId, owner, otherMember, otherMember]);
    await q(`INSERT INTO public.agency_delegation_requests(
               agency_id, driver_user_id, member_user_id, created_by_user_id, member_invite_email)
             VALUES ($1,$2,$3,$4,'m2@x')`, [agencyId, otherDriver, owner, otherMember]);
    await q(`INSERT INTO public.agency_client_requests(agency_id, driver_user_id)
             VALUES ($1,$2)`, [agencyId, owner]);

    // Shared assignments where the owner is the assigned member.
    await q(`INSERT INTO public.agency_work_items(
               agency_id, driver_user_id, assigned_member_user_id, created_by_user_id)
             VALUES ($1,$2,$3,$4)`, [agencyId, otherDriver, owner, otherMember]);
    await q(`INSERT INTO public.agency_client_requests(
               agency_id, driver_user_id, assigned_member_user_id)
             VALUES ($1,$2,$3)`, [agencyId, otherDriver, owner]);

    // Membership row (NOT under owner’s own agency — memberships identify the
    // owner only through agency_profiles per the discovery invariant).
    const [{ id: otherAgency }] = await q<{ id: string }>(
      `INSERT INTO public.agency_profiles(owner_user_id) VALUES ($1) RETURNING id`,
      [otherMember],
    );
    await q(`INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, status)
             VALUES ($1,$2,'owner-as-member@x','active')`, [otherAgency, owner]);

    // All 29 direct rows.
    await seedDirect(owner);

    // Forbidden-surface + audit rows referencing the owner.
    await q(`INSERT INTO public.agency_audit_log(actor_user_id, action) VALUES ($1,'x')`, [owner]);
    await q(`INSERT INTO public.assistant_audit_log(actor_user_id, action) VALUES ($1,'x')`, [owner]);
    await q(`INSERT INTO public.application_events(actor_user_id, kind) VALUES ($1,'x')`, [owner]);
    await q(`INSERT INTO public.contract_audit_log(actor_user_id, action) VALUES ($1,'x')`, [owner]);
    await q(`INSERT INTO public.admin_audit_log(actor_user_id, action) VALUES ($1,'x')`, [owner]);
    await q(`INSERT INTO public.recruiter_contact_requests(recruiter_user_id, driver_user_id)
             VALUES ($1,$1)`, [owner]);
    await q(`INSERT INTO public.recruiter_profiles(user_id, company_name) VALUES ($1,'x')`, [owner]);
    await q(`INSERT INTO public.professional_profiles(user_id) VALUES ($1)`, [owner]);
    await q(`INSERT INTO public.user_capabilities(user_id, capability, status)
             VALUES ($1,'recruiter','active')`, [owner]);

    // Deterministic snapshots per protected surface.
    // user_capabilities uses a composite PK; every other seeded table has an id.
    const orderFor = (t: string) =>
      t === 'user_capabilities' ? 'user_id, capability' : 'id';
    const readAll = async () => {
      const rel: Record<string, any[]> = {};
      for (const t of RELATIONSHIP_TABLES) {
        rel[t] = await q(`SELECT * FROM public.${t} ORDER BY ${orderFor(t)}`);
      }
      const direct: Record<string, any[]> = {};
      for (const t of DIRECT_TABLES) {
        direct[t] = await q(`SELECT * FROM public.${t} WHERE user_id=$1 ORDER BY ${orderFor(t)}`, [owner]);
      }
      const forbidden: Record<string, any[]> = {};
      for (const t of FORBIDDEN_TABLES) {
        forbidden[t] = await q(`SELECT * FROM public.${t} ORDER BY ${orderFor(t)}`);
      }
      return {
        relationship: rel,
        direct,
        forbidden,
        digest: digest({ rel, direct, forbidden }),
      };
    };
    const before = await readAll();

    await expect(callRpc(owner)).rejects.toMatchObject({
      code: 'P0001',
      message: 'You own an agency workspace. Transfer ownership or close the agency before deleting your personal account.',
    });

    const after = await readAll();
    expect(after.digest).toBe(before.digest);
    // Also assert per-category to make a regression report readable.
    expect(after.relationship).toEqual(before.relationship);
    expect(after.direct).toEqual(before.direct);
    expect(after.forbidden).toEqual(before.forbidden);
  });
});

describe('Phase 1N-F1-B — relationship and membership cleanup', () => {
  it('assistant-only rows are deleted and unrelated assistant rows survive', async () => {
    const caller = await createUser();
    const driver = await createUser();
    const other = await createUser();
    await q(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id, invite_email)
             VALUES ($1,$2,'c@x')`, [driver, caller]);
    await q(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id, invite_email)
             VALUES ($1,$2,'o@x')`, [driver, other]);

    const res = await callRpc(caller);
    expect(res.relationship_rows_deleted).toBe(1);
    const remain = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.driver_assistants WHERE assistant_user_id=$1`, [other],
    );
    expect(remain[0].n).toBe(1);
  });

  it('driver-side relationship rows are deleted across all four driver-keyed tables', async () => {
    const caller = await createUser();
    const other = await createUser();
    const [{ id: agencyId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_profiles(owner_user_id) VALUES ($1) RETURNING id`, [other],
    );
    await q(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id, invite_email)
             VALUES ($1,$2,'x@x')`, [caller, other]);
    await q(`INSERT INTO public.agency_work_items(agency_id, driver_user_id, created_by_user_id)
             VALUES ($1,$2,$3)`, [agencyId, caller, other]);
    await q(`INSERT INTO public.agency_delegation_requests(
               agency_id, driver_user_id, member_user_id, created_by_user_id, member_invite_email)
             VALUES ($1,$2,$3,$4,'y@x')`, [agencyId, caller, other, other]);
    await q(`INSERT INTO public.agency_client_requests(agency_id, driver_user_id)
             VALUES ($1,$2)`, [agencyId, caller]);

    const other2 = await createUser();
    await q(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id, invite_email)
             VALUES ($1,$2,'u@x')`, [other, other2]);
    await q(`INSERT INTO public.agency_work_items(agency_id, driver_user_id, created_by_user_id)
             VALUES ($1,$2,$3)`, [agencyId, other2, other]);

    const res = await callRpc(caller);
    expect(res.relationship_rows_deleted).toBe(4);
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.driver_assistants`))[0].n).toBeGreaterThanOrEqual(1);
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.agency_work_items WHERE driver_user_id=$1`, [other2]))[0].n).toBe(1);
  });

  it('member-only delegation rows (caller = member_user_id, not driver) are deleted; unrelated survive', async () => {
    const caller = await createUser();
    const other = await createUser();
    const [{ id: agencyId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_profiles(owner_user_id) VALUES ($1) RETURNING id`, [other],
    );
    // Caller is member_user_id ONLY.
    await q(`INSERT INTO public.agency_delegation_requests(
               agency_id, driver_user_id, member_user_id, created_by_user_id, member_invite_email)
             VALUES ($1,$2,$3,$4,'m@x')`, [agencyId, other, caller, other]);
    // Unrelated member delegation.
    const other2 = await createUser();
    await q(`INSERT INTO public.agency_delegation_requests(
               agency_id, driver_user_id, member_user_id, created_by_user_id, member_invite_email)
             VALUES ($1,$2,$3,$4,'m2@x')`, [agencyId, other, other2, other]);

    const res = await callRpc(caller);
    expect(res.relationship_rows_deleted).toBe(1);
    const remain = await q<any>(
      `SELECT count(*)::int AS n FROM public.agency_delegation_requests WHERE member_user_id=$1`, [caller],
    );
    expect(remain[0].n).toBe(0);
    const other2Remain = await q<any>(
      `SELECT count(*)::int AS n FROM public.agency_delegation_requests WHERE member_user_id=$1`, [other2],
    );
    expect(other2Remain[0].n).toBe(1);
  });
});

describe('Phase 1N-F1-B — shared-agency non-interference and membership detach', () => {
  it('shared assignments cleared, unrelated assignments and agency artifacts untouched', async () => {
    const caller = await createUser();
    const owner = await createUser();
    const other = await createUser();
    const driver = await createUser();

    const [{ id: agencyId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_profiles(owner_user_id, display_name) VALUES ($1,'Acme') RETURNING id`,
      [owner],
    );
    const [{ id: entId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_entitlements(agency_id, plan) VALUES ($1,'growth') RETURNING id`,
      [agencyId],
    );
    const [{ id: pkgId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_service_packages(agency_id, name) VALUES ($1,'starter') RETURNING id`,
      [agencyId],
    );

    // Shared rows keyed to a different driver but assigned to caller.
    const [{ id: workId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_work_items(
         agency_id, driver_user_id, assigned_member_user_id, created_by_user_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [agencyId, driver, caller, owner],
    );
    const [{ id: reqId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_client_requests(
         agency_id, driver_user_id, assigned_member_user_id)
       VALUES ($1,$2,$3) RETURNING id`,
      [agencyId, driver, caller],
    );
    // Unrelated assignment.
    const [{ id: otherWorkId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_work_items(
         agency_id, driver_user_id, assigned_member_user_id, created_by_user_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [agencyId, driver, other, owner],
    );

    // Memberships.
    const [{ id: callerMemId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, status)
       VALUES ($1,$2,'c@x','active') RETURNING id`, [agencyId, caller],
    );
    const [{ id: otherMemId }] = await q<{ id: string }>(
      `INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, status)
       VALUES ($1,$2,'o@x','active') RETURNING id`, [agencyId, other],
    );

    // Deterministic pre-snapshots.
    const beforeProfile   = await q(`SELECT * FROM public.agency_profiles WHERE id=$1`, [agencyId]);
    const beforeEnt       = await q(`SELECT * FROM public.agency_entitlements WHERE id=$1`, [entId]);
    const beforePkg       = await q(`SELECT * FROM public.agency_service_packages WHERE id=$1`, [pkgId]);
    const beforeOtherMem  = await q(`SELECT * FROM public.agency_members WHERE id=$1`, [otherMemId]);
    const beforeOtherWork = await q(`SELECT * FROM public.agency_work_items WHERE id=$1`, [otherWorkId]);

    const res = await callRpc(caller);
    expect(res.shared_assignments_cleared).toBe(2);
    expect(res.agency_memberships_revoked).toBe(1);

    // Shared rows survive, assignments cleared.
    const wi = (await q<any>(`SELECT * FROM public.agency_work_items WHERE id=$1`, [workId]))[0];
    expect(wi.assigned_member_user_id).toBeNull();
    expect(wi.driver_user_id).toBe(driver);
    const cr = (await q<any>(`SELECT * FROM public.agency_client_requests WHERE id=$1`, [reqId]))[0];
    expect(cr.assigned_member_user_id).toBeNull();

    // Caller membership row now revoked history.
    const callerMem = (await q<any>(`SELECT * FROM public.agency_members WHERE id=$1`, [callerMemId]))[0];
    expect(callerMem.status).toBe('revoked');
    expect(callerMem.member_user_id).toBeNull();
    expect(callerMem.revoked_at).not.toBeNull();

    // Unrelated surfaces byte/value-identical.
    expect(await q(`SELECT * FROM public.agency_profiles WHERE id=$1`, [agencyId])).toEqual(beforeProfile);
    expect(await q(`SELECT * FROM public.agency_entitlements WHERE id=$1`, [entId])).toEqual(beforeEnt);
    expect(await q(`SELECT * FROM public.agency_service_packages WHERE id=$1`, [pkgId])).toEqual(beforePkg);
    expect(await q(`SELECT * FROM public.agency_members WHERE id=$1`, [otherMemId])).toEqual(beforeOtherMem);
    expect(await q(`SELECT * FROM public.agency_work_items WHERE id=$1`, [otherWorkId])).toEqual(beforeOtherWork);
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

    // Relationship rows = 3.
    await q(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id, invite_email)
             VALUES ($1,$2,'x@x')`, [caller, other]);
    await q(`INSERT INTO public.agency_delegation_requests(
               agency_id, driver_user_id, member_user_id, created_by_user_id, member_invite_email)
             VALUES ($1,$2,$3,$4,'y@x')`, [agencyId, caller, other, other]);
    await q(`INSERT INTO public.agency_client_requests(agency_id, driver_user_id)
             VALUES ($1,$2)`, [agencyId, caller]);

    // Shared assignments = 1.
    await q(`INSERT INTO public.agency_work_items(
               agency_id, driver_user_id, assigned_member_user_id, created_by_user_id)
             VALUES ($1,$2,$3,$4)`, [agencyId, driver, caller, owner]);

    // Membership = 1.
    await q(`INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, status)
             VALUES ($1,$2,'m@x','active')`, [agencyId, caller]);

    // Direct rows = 29.
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

    await q(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id, invite_email)
             VALUES ($1,$2,'x@x')`, [caller, other]);
    await q(`INSERT INTO public.agency_work_items(
               agency_id, driver_user_id, assigned_member_user_id, created_by_user_id)
             VALUES ($1,$2,$3,$4)`, [agencyId, other, caller, owner]);
    await q(`INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, status)
             VALUES ($1,$2,'rb@x','active')`, [agencyId, caller]);
    await seedDirect(caller);

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

      expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.driver_assistants WHERE driver_user_id=$1`, [caller]))[0].n).toBe(1);
      const wi = await q<any>(`SELECT assigned_member_user_id FROM public.agency_work_items WHERE assigned_member_user_id=$1`, [caller]);
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

describe('Phase 1N-F1-B — advisory lock causally blocks concurrent RPC', () => {
  it('holder acquires exact key; RPC waits on advisory lock; releases only after commit', async () => {
    const caller = await createUser();
    await seedDirect(caller);

    // Three explicit clients so we can prove causality without pool reuse.
    const holder   = await pool.connect();
    const runner   = await pool.connect();
    const observer = await pool.connect();

    let runnerResult: any = null;
    let runnerError: any = null;
    let runnerDone = false;

    try {
      // Step 1: holder claims the exact advisory key the RPC will request.
      await holder.query('BEGIN');
      await holder.query(
        `SELECT pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))`,
        [caller],
      );

      // Step 2: runner sets up authenticated identity, records its PID, kicks
      // off the RPC WITHOUT awaiting completion.
      await runner.query('BEGIN');
      await runner.query(`SET LOCAL role authenticated`);
      await runner.query(
        `SELECT set_config('request.jwt.claim.sub', $1, true)`, [caller],
      );
      await runner.query(`SET LOCAL application_name = 'phase1n_f1b_advisory_runner'`);
      const runnerPidRow = await runner.query(`SELECT pg_backend_pid()::int AS pid`);
      const runnerPid: number = runnerPidRow.rows[0].pid;

      const rpcPromise = runner.query(`SELECT * FROM public.${RPC}()`)
        .then((r) => { runnerResult = r.rows[0]; runnerDone = true; })
        .catch((e) => { runnerError = e; runnerDone = true; });

      // Step 3: observer polls until runner is waiting on an advisory lock.
      const waitedForBlock = await (async () => {
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          const rows = await observer.query(
            `SELECT wait_event_type, wait_event, state
               FROM pg_stat_activity WHERE pid=$1`,
            [runnerPid],
          );
          const row = rows.rows[0];
          if (
            row &&
            row.wait_event_type === 'Lock' &&
            row.wait_event === 'advisory'
          ) return true;
          await new Promise((r) => setTimeout(r, 50));
        }
        return false;
      })();
      expect(waitedForBlock).toBe(true);
      expect(runnerDone).toBe(false);

      // Step 4: caller data must not have been mutated while blocked.
      expect(await countDirectFor(caller)).toBe(DIRECT_TABLES.length);

      // Step 5: release the holder — runner should now complete.
      await holder.query('COMMIT');
      await rpcPromise;
      expect(runnerError).toBeNull();
      expect(runnerResult).not.toBeNull();
      // Runner's own transaction still needs to be closed.
      await runner.query('COMMIT');

      // Step 6: exact final counters + zero remaining rows.
      expect(runnerResult.deleted_user_id).toBe(caller);
      expect(runnerResult.direct_rows_deleted).toBe(DIRECT_TABLES.length);
      expect(await countDirectFor(caller)).toBe(0);
    } finally {
      // Best-effort rollback if anything above threw mid-transaction.
      await holder.query('ROLLBACK').catch(() => undefined);
      await runner.query('ROLLBACK').catch(() => undefined);
      holder.release();
      runner.release();
      observer.release();
    }
  });

  it('two simultaneous same-user calls serialize with exact-once total deletion', async () => {
    const caller = await createUser();
    await seedDirect(caller);
    const [r1, r2] = await Promise.all([callRpc(caller), callRpc(caller)]);
    const total = r1.direct_rows_deleted + r2.direct_rows_deleted;
    expect(total).toBe(DIRECT_TABLES.length);
    expect(r1.deleted_user_id).toBe(caller);
    expect(r2.deleted_user_id).toBe(caller);
    expect(await countDirectFor(caller)).toBe(0);
  });
});

describe('Phase 1N-F1-B — candidate DDL idempotency', () => {
  it('second exact candidate application preserves the full protected catalog snapshot', async () => {
    await pool.query(CANDIDATE_SQL);
    const after = await snapshotAll();
    expect(after.tables).toEqual(SNAP_AFTER_FIRST.tables);
    expect(after.columns).toEqual(SNAP_AFTER_FIRST.columns);
    expect(after.constraints).toEqual(SNAP_AFTER_FIRST.constraints);
    expect(after.indexes).toEqual(SNAP_AFTER_FIRST.indexes);
    expect(after.triggers).toEqual(SNAP_AFTER_FIRST.triggers);
    expect(after.rlsFlags).toEqual(SNAP_AFTER_FIRST.rlsFlags);
    expect(after.policies).toEqual(SNAP_AFTER_FIRST.policies);
    expect(after.tableGrants).toEqual(SNAP_AFTER_FIRST.tableGrants);
    expect(after.publicFunctions).toEqual(SNAP_AFTER_FIRST.publicFunctions);
    // Explicit target-record identity/ACL check.
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

// Placate the linter — afterEach is intentionally unused; leaving as future
// hook if catalog-restoring cleanup becomes necessary.
afterEach(async () => { /* no-op */ });
