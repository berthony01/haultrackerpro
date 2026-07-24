/**
 * Phase 1N-E1-R1 — Real PostgreSQL 16 gate for the legacy recruiter
 * compatibility candidate.
 *
 * Repaired proof: seeds ALL legacy fixtures BEFORE applying the exact full
 * candidate from disk (one application, not the extracted DO-block),
 * snapshots the full protected catalog surface pre- and post-application,
 * proves idempotency by re-applying the full candidate a second time, and
 * cleans every suite-created object and role in afterAll with a hard
 * post-cleanup catalog check.
 *
 * NEVER SKIPS. Fails hard if PHASE1N_LEGACY_RECRUITER_DATABASE_URL is
 * absent. Test-runner exclusion markers are prohibited; the workflow
 * scans this file for them and hard-fails.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.PHASE1N_LEGACY_RECRUITER_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'PHASE1N_LEGACY_RECRUITER_DATABASE_URL is required for the Phase 1N-E1 real-Postgres 16 gate.',
  );
}
const URL_STR: string = DATABASE_URL;

const CANDIDATE_PATH = fileURLToPath(
  new URL(
    '../../supabase/migration-candidates/20260723220000_phase1n_e_legacy_recruiter_compatibility.sql',
    import.meta.url,
  ),
);
const CANDIDATE_SQL = readFileSync(CANDIDATE_PATH, 'utf8');

const CANDIDATE_RPC = 'ensure_my_recruiter_setup_state';

// Roles the suite may need. Only ones absent BEFORE beforeAll runs are
// created (and consequently dropped) by this suite.
const CANDIDATE_ROLES = ['anon', 'authenticated', 'service_role'] as const;

// Pre-existing (fixture) functions whose byte-exact definition/ACL/owner
// must not change after applying the candidate.
const PROTECTED_FUNCTIONS: { name: string; args: string }[] = [
  { name: 'update_updated_at_column', args: '' },
  { name: 'is_admin', args: 'uuid' },
  { name: 'recruiter_profile_can_manage_opportunities', args: 'uuid' },
  { name: 'recruiter_profile_guard', args: '' },
  { name: '_derive_recruiter_capability_status', args: 'uuid' },
  { name: '_sync_recruiter_capability', args: 'uuid' },
  { name: '_recruiter_profile_capability_sync', args: '' },
];

const PROTECTED_TABLES = [
  'public.recruiter_profiles',
  'public.user_capabilities',
  'public.profiles',
];

// ---------------------------------------------------------------------------
// Fresh-database-safe cleanup. NEVER references triggers by relation to
// avoid failing when the relation itself does not exist.
// ---------------------------------------------------------------------------
const RESET_SQL = `
DROP FUNCTION IF EXISTS public.${CANDIDATE_RPC}() CASCADE;
DROP FUNCTION IF EXISTS public._recruiter_profile_capability_sync() CASCADE;
DROP FUNCTION IF EXISTS public._sync_recruiter_capability(uuid) CASCADE;
DROP FUNCTION IF EXISTS public._derive_recruiter_capability_status(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.recruiter_profile_guard() CASCADE;
DROP FUNCTION IF EXISTS public.recruiter_profile_can_manage_opportunities(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.is_admin(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;
DROP TABLE IF EXISTS public.user_capabilities CASCADE;
DROP TABLE IF EXISTS public.recruiter_profiles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TYPE IF EXISTS public.user_capability_type CASCADE;
DROP TYPE IF EXISTS public.user_capability_status CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
`;

// Bootstrap body (roles handled separately so we can track which we own).
const BOOTSTRAP_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON auth.users TO authenticated, service_role;

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
  display_name text,
  intended_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_admin(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE AS $fn$ SELECT false $fn$;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_name text NOT NULL DEFAULT '',
  recruiter_email text,
  recruiter_phone text,
  company_name text NOT NULL DEFAULT '',
  dot_number text,
  mc_number text,
  verification_status text NOT NULL DEFAULT 'pending',
  status text NOT NULL DEFAULT 'active',
  posting_terms_accepted_at timestamptz,
  posting_terms_version text,
  legacy_terms_grandfathered_at timestamptz,
  verified_at timestamptz,
  verified_by uuid,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.recruiter_profiles TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recruiter_profile_can_manage_opportunities(
  _recruiter_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter_id
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
      AND COALESCE(btrim(rp.recruiter_name), '') <> ''
      AND COALESCE(btrim(rp.company_name), '') <> ''
      AND COALESCE(btrim(rp.recruiter_email), '') <> ''
      AND btrim(rp.recruiter_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
      AND (
            COALESCE(btrim(rp.dot_number), '') <> ''
         OR COALESCE(btrim(rp.mc_number), '') <> ''
      )
      AND (
            rp.posting_terms_accepted_at IS NOT NULL
         OR rp.legacy_terms_grandfathered_at IS NOT NULL
      )
  );
$$;
REVOKE ALL     ON FUNCTION public.recruiter_profile_can_manage_opportunities(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recruiter_profile_can_manage_opportunities(uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recruiter_profile_can_manage_opportunities(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.recruiter_profile_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.verification_status := 'pending';
    NEW.verified_at := NULL;
    NEW.verified_by := NULL;
    NEW.admin_notes := NULL;
    NEW.posting_terms_accepted_at := NULL;
    NEW.posting_terms_version := NULL;
    NEW.legacy_terms_grandfathered_at := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.verification_status := OLD.verification_status;
    NEW.verified_at := OLD.verified_at;
    NEW.verified_by := OLD.verified_by;
    NEW.admin_notes := OLD.admin_notes;
    NEW.status := OLD.status;
    NEW.legacy_terms_grandfathered_at := OLD.legacy_terms_grandfathered_at;
    NEW.posting_terms_accepted_at := OLD.posting_terms_accepted_at;
    NEW.posting_terms_version := OLD.posting_terms_version;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_recruiter_profile_guard
  BEFORE INSERT OR UPDATE ON public.recruiter_profiles
  FOR EACH ROW EXECUTE FUNCTION public.recruiter_profile_guard();

CREATE TYPE public.user_capability_type   AS ENUM ('driver','recruiter');
CREATE TYPE public.user_capability_status AS ENUM ('setup','active','suspended','revoked');

CREATE TABLE public.user_capabilities (
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capability   public.user_capability_type NOT NULL,
  status       public.user_capability_status NOT NULL,
  activated_at timestamptz NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, capability)
);
GRANT SELECT ON public.user_capabilities TO authenticated;
GRANT ALL    ON public.user_capabilities TO service_role;

CREATE OR REPLACE FUNCTION public._derive_recruiter_capability_status(_user_id uuid)
RETURNS public.user_capability_status
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _rp public.recruiter_profiles;
BEGIN
  SELECT * INTO _rp FROM public.recruiter_profiles WHERE user_id = _user_id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF _rp.status = 'suspended' OR _rp.verification_status = 'suspended'
    THEN RETURN 'suspended'::public.user_capability_status; END IF;
  IF public.recruiter_profile_can_manage_opportunities(_rp.id)
    THEN RETURN 'active'::public.user_capability_status; END IF;
  RETURN 'setup'::public.user_capability_status;
END; $$;
GRANT EXECUTE ON FUNCTION public._derive_recruiter_capability_status(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._sync_recruiter_capability(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _desired public.user_capability_status; _existing public.user_capability_status;
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  SELECT status INTO _existing FROM public.user_capabilities
   WHERE user_id = _user_id AND capability = 'recruiter';
  IF _existing = 'revoked' THEN RETURN; END IF;
  _desired := public._derive_recruiter_capability_status(_user_id);
  IF _desired IS NULL THEN RETURN; END IF;
  INSERT INTO public.user_capabilities (user_id, capability, status, activated_at)
  VALUES (_user_id, 'recruiter', _desired,
          CASE WHEN _desired = 'active' THEN now() ELSE NULL END)
  ON CONFLICT (user_id, capability) DO UPDATE
    SET status = EXCLUDED.status,
        activated_at = CASE
          WHEN EXCLUDED.status = 'active' AND public.user_capabilities.activated_at IS NULL
            THEN now()
          ELSE public.user_capabilities.activated_at
        END,
        updated_at = now()
    WHERE public.user_capabilities.status <> 'revoked';
END; $$;
GRANT EXECUTE ON FUNCTION public._sync_recruiter_capability(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._recruiter_profile_capability_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public._sync_recruiter_capability(OLD.user_id);
    RETURN OLD;
  END IF;
  PERFORM public._sync_recruiter_capability(NEW.user_id);
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_recruiter_profile_capability_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.recruiter_profiles
  FOR EACH ROW EXECUTE FUNCTION public._recruiter_profile_capability_sync();
`;

const pool = new pg.Pool({ connectionString: URL_STR, max: 8 });

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
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function asAnon<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL role anon`);
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

async function createUser(
  email: string | null = `${randomUUID()}@example.com`,
  meta: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  await q(
    `INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1,$2,$3::jsonb)`,
    [id, email, JSON.stringify(meta)],
  );
  return id;
}

async function insertProfile(userId: string, displayName: string | null) {
  await q(
    `INSERT INTO public.profiles(user_id, display_name) VALUES ($1,$2)`,
    [userId, displayName],
  );
}

async function setCap(userId: string, status: string) {
  await q(
    `INSERT INTO public.user_capabilities(user_id, capability, status)
     VALUES ($1,'recruiter',$2::public.user_capability_status)
     ON CONFLICT (user_id, capability) DO UPDATE SET status = EXCLUDED.status`,
    [userId, status],
  );
}

async function getRp(userId: string) {
  const rows = await q(
    `SELECT * FROM public.recruiter_profiles WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

async function getCap(userId: string) {
  const rows = await q<{ status: string }>(
    `SELECT status::text AS status FROM public.user_capabilities
      WHERE user_id = $1 AND capability = 'recruiter'`,
    [userId],
  );
  return rows[0]?.status ?? null;
}

/**
 * Insert a legitimately-shaped historical recruiter_profiles row that the
 * production guard would otherwise blank. Uses a controlled trigger
 * disable protected by try/finally so the trigger is guaranteed to be
 * re-enabled even on error.
 */
async function seedHistoricalProfile(
  userId: string,
  overrides: Record<string, unknown>,
) {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE public.recruiter_profiles DISABLE TRIGGER trg_recruiter_profile_guard`);
    try {
      const cols = Object.keys(overrides);
      const vals = cols.map((_, i) => `$${i + 2}`).join(',');
      await client.query(
        `INSERT INTO public.recruiter_profiles(user_id, ${cols.join(',')})
         VALUES ($1, ${vals})`,
        [userId, ...cols.map((c) => overrides[c])],
      );
    } finally {
      await client.query(`ALTER TABLE public.recruiter_profiles ENABLE TRIGGER trg_recruiter_profile_guard`);
    }
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Catalog-backed snapshot helpers. Compared before vs. after candidate
// application to prove non-interference.
// ---------------------------------------------------------------------------
async function snapshotFunctionIdentSet(): Promise<string[]> {
  const rows = await q<{ ident: string }>(
    `SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS ident
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      ORDER BY 1`,
  );
  return rows.map((r) => r.ident);
}

async function snapshotProtectedFunctions() {
  const out: Record<string, any> = {};
  for (const f of PROTECTED_FUNCTIONS) {
    const rows = await q<any>(
      `SELECT pg_get_functiondef(p.oid) AS def,
              p.provolatile::text AS provolatile,
              p.prosecdef,
              p.proconfig,
              pg_get_userbyid(p.proowner) AS owner,
              (SELECT array_agg(privilege_type ORDER BY privilege_type||grantee)
                 FROM information_schema.routine_privileges
                WHERE routine_schema='public' AND routine_name=p.proname) AS privs,
              (SELECT array_agg(grantee ORDER BY grantee||privilege_type)
                 FROM information_schema.routine_privileges
                WHERE routine_schema='public' AND routine_name=p.proname) AS grantees
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1
          AND pg_get_function_identity_arguments(p.oid)=$2`,
      [f.name, f.args],
    );
    out[`${f.name}(${f.args})`] = rows[0] ?? null;
  }
  return out;
}

async function snapshotTriggerDefs() {
  return q<{ tgname: string; tbl: string; def: string; enabled: string }>(
    `SELECT tgname,
            tgrelid::regclass::text AS tbl,
            pg_get_triggerdef(oid) AS def,
            tgenabled::text AS enabled
       FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgrelid::regclass::text = ANY($1)
      ORDER BY tbl, tgname`,
    [PROTECTED_TABLES],
  );
}

async function snapshotPolicies() {
  return q(
    `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
       FROM pg_policies
      WHERE schemaname='public' AND tablename = ANY($1)
      ORDER BY tablename, policyname`,
    [PROTECTED_TABLES.map((t) => t.replace(/^public\./, ''))],
  );
}

async function snapshotTableGrants() {
  return q(
    `SELECT table_schema, table_name, grantee, privilege_type
       FROM information_schema.table_privileges
      WHERE table_schema='public' AND table_name = ANY($1)
      ORDER BY table_name, grantee, privilege_type`,
    [PROTECTED_TABLES.map((t) => t.replace(/^public\./, ''))],
  );
}

async function snapshotColumns() {
  return q(
    `SELECT table_name, column_name, ordinal_position, is_nullable,
            data_type, column_default
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name = ANY($1)
      ORDER BY table_name, ordinal_position`,
    [PROTECTED_TABLES.map((t) => t.replace(/^public\./, ''))],
  );
}

async function snapshotConstraints() {
  return q(
    `SELECT c.conrelid::regclass::text AS tbl,
            c.conname, c.contype::text AS contype,
            pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
      WHERE c.conrelid::regclass::text = ANY($1)
      ORDER BY tbl, conname`,
    [PROTECTED_TABLES],
  );
}

async function snapshotIndexes() {
  return q(
    `SELECT schemaname, tablename, indexname, indexdef
       FROM pg_indexes
      WHERE schemaname='public' AND tablename = ANY($1)
      ORDER BY tablename, indexname`,
    [PROTECTED_TABLES.map((t) => t.replace(/^public\./, ''))],
  );
}

async function snapshotAll() {
  return {
    functionIdentSet: await snapshotFunctionIdentSet(),
    protectedFunctions: await snapshotProtectedFunctions(),
    triggers: await snapshotTriggerDefs(),
    policies: await snapshotPolicies(),
    tableGrants: await snapshotTableGrants(),
    columns: await snapshotColumns(),
    constraints: await snapshotConstraints(),
    indexes: await snapshotIndexes(),
  };
}

// ---------------------------------------------------------------------------
// Suite-created role/state tracking. Only roles the suite itself creates
// are ever dropped in afterAll.
// ---------------------------------------------------------------------------
const rolesCreated: string[] = [];

// Seeded fixture user ids (all seeded BEFORE the candidate is applied).
const seeded: Record<string, string> = {};

// Pre- / post-candidate snapshots.
let SNAP_BEFORE: Awaited<ReturnType<typeof snapshotAll>>;
let SNAP_AFTER_FIRST: Awaited<ReturnType<typeof snapshotAll>>;

// Frozen snapshot of every pre-existing recruiter_profiles row (byte-exact)
// keyed by user_id. Compared after candidate to prove unchanged.
let EXISTING_ROWS_BEFORE: Record<string, any> = {};

beforeAll(async () => {
  // 1. Detect which required roles already exist BEFORE we touch anything.
  const existingRoles = new Set(
    (
      await q<{ rolname: string }>(
        `SELECT rolname FROM pg_roles WHERE rolname = ANY($1)`,
        [CANDIDATE_ROLES as unknown as string[]],
      )
    ).map((r) => r.rolname),
  );

  // 2. Fresh-DB-safe cleanup (no DROP TRIGGER ... ON <maybe-missing>).
  await pool.query(RESET_SQL);

  // 3. Create only the roles that were absent (track for afterAll).
  for (const role of CANDIDATE_ROLES) {
    if (!existingRoles.has(role)) {
      const opts = role === 'service_role'
        ? 'NOLOGIN NOINHERIT BYPASSRLS'
        : 'NOLOGIN NOINHERIT';
      await q(`CREATE ROLE ${role} ${opts}`);
      rolesCreated.push(role);
    }
  }
  await q(
    `GRANT ${CANDIDATE_ROLES.join(', ')} TO CURRENT_USER`,
  );

  // 4. Bootstrap the canonical fixture (schema, tables, guard, sync).
  await pool.query(BOOTSTRAP_SQL);

  // 5. Seed ALL legacy backfill fixtures BEFORE the candidate is applied.

  // Eligible setup users covering every trusted-name priority source.
  seeded.eligibleFromProfile = await createUser('valid@example.com');
  await insertProfile(seeded.eligibleFromProfile, '  Alice Profile  ');
  await setCap(seeded.eligibleFromProfile, 'setup');

  seeded.eligibleFromMetaDisplay = await createUser('meta1@example.com', {
    display_name: '  Meta Display  ',
    full_name: 'ignored full',
  });
  await setCap(seeded.eligibleFromMetaDisplay, 'setup');

  seeded.eligibleFromFullName = await createUser('meta2@example.com', {
    full_name: '  Meta Full  ',
  });
  await setCap(seeded.eligibleFromFullName, 'setup');

  seeded.eligibleFromName = await createUser('meta3@example.com', {
    name: '  Meta Name  ',
  });
  await setCap(seeded.eligibleFromName, 'setup');

  // Eligible with no trusted name at all — must NOT invent from email.
  seeded.eligibleNoName = await createUser('nameless@example.com', {});
  await setCap(seeded.eligibleNoName, 'setup');

  // Invalid, whitespace, and NULL account emails.
  seeded.eligibleBadEmail = await createUser('not-an-email', {
    display_name: 'BadEmail',
  });
  await setCap(seeded.eligibleBadEmail, 'setup');

  seeded.eligibleWhitespaceEmail = await createUser('   ', {
    display_name: 'WSEmail',
  });
  await setCap(seeded.eligibleWhitespaceEmail, 'setup');

  seeded.eligibleNullEmail = await createUser(null, {
    display_name: 'NullEmail',
  });
  await setCap(seeded.eligibleNullEmail, 'setup');

  // Nonblank and blank phone metadata.
  seeded.eligibleWithPhone = await createUser('phone@example.com', {
    display_name: 'Phone User',
    phone: '  555-1212  ',
  });
  await setCap(seeded.eligibleWithPhone, 'setup');

  seeded.eligibleBlankPhone = await createUser('bphone@example.com', {
    display_name: 'Blank Phone',
    phone: '   ',
  });
  await setCap(seeded.eligibleBlankPhone, 'setup');

  // Active / suspended / revoked / no-capability users missing profiles.
  seeded.notargetActive = await createUser('active@example.com');
  await setCap(seeded.notargetActive, 'active');

  seeded.notargetSuspended = await createUser('susp@example.com');
  await setCap(seeded.notargetSuspended, 'suspended');

  seeded.notargetRevoked = await createUser('rev@example.com');
  await setCap(seeded.notargetRevoked, 'revoked');

  seeded.notargetNoCap = await createUser('nocap@example.com');
  // no capability row

  // Existing complete + accepted-terms profile.
  seeded.existingComplete = await createUser('complete@example.com');
  await seedHistoricalProfile(seeded.existingComplete, {
    recruiter_name: 'Existing',
    recruiter_email: 'existing@example.com',
    company_name: 'ExistingCo',
    dot_number: '12345',
    posting_terms_accepted_at: new Date(),
    posting_terms_version: 'v1',
    verification_status: 'approved',
    status: 'active',
  });

  // Existing grandfathered profile.
  seeded.existingGrandfathered = await createUser('gf@example.com');
  await seedHistoricalProfile(seeded.existingGrandfathered, {
    recruiter_name: 'GF',
    recruiter_email: 'gf@example.com',
    company_name: 'GFCo',
    mc_number: 'MC1',
    legacy_terms_grandfathered_at: new Date(),
    verification_status: 'approved',
    status: 'active',
  });

  // Existing malformed / incomplete profile.
  seeded.existingMalformed = await createUser('malf@example.com');
  await seedHistoricalProfile(seeded.existingMalformed, {
    recruiter_name: '',
    company_name: '',
  });

  // Existing suspended profile.
  seeded.existingSuspended = await createUser('esusp@example.com');
  await seedHistoricalProfile(seeded.existingSuspended, {
    recruiter_name: 'Susp',
    company_name: 'SuspCo',
    status: 'suspended',
    verification_status: 'approved',
  });

  // Guard must be enabled before we snapshot and apply the candidate.
  const trgEnabled = await q<{ enabled: string }>(
    `SELECT tgenabled::text AS enabled FROM pg_trigger
      WHERE tgname='trg_recruiter_profile_guard'`,
  );
  if (!trgEnabled.length || trgEnabled[0].enabled !== 'O') {
    throw new Error('Guard trigger left disabled after fixture seeding');
  }

  // 6. Freeze pre-candidate snapshots of every existing recruiter_profiles
  //    row and the full protected catalog surface.
  const existingRows = await q<any>(
    `SELECT * FROM public.recruiter_profiles ORDER BY user_id`,
  );
  EXISTING_ROWS_BEFORE = Object.fromEntries(
    existingRows.map((r) => [r.user_id, r]),
  );
  SNAP_BEFORE = await snapshotAll();

  // 7. Apply the EXACT full candidate SQL from disk exactly once.
  await pool.query(CANDIDATE_SQL);

  // 8. Post-first-application snapshot for the idempotency comparison.
  SNAP_AFTER_FIRST = await snapshotAll();
});

afterAll(async () => {
  try {
    // Best-effort object cleanup.
    await pool.query(RESET_SQL);

    // Drop only roles this suite itself created.
    for (const role of rolesCreated) {
      await pool
        .query(`REVOKE ${role} FROM CURRENT_USER`)
        .catch(() => undefined);
      await pool
        .query(`REASSIGN OWNED BY ${role} TO CURRENT_USER`)
        .catch(() => undefined);
      await pool
        .query(`DROP OWNED BY ${role} CASCADE`)
        .catch(() => undefined);
      await pool.query(`DROP ROLE IF EXISTS ${role}`);
    }

    // Hard-fail if any suite-created object or suite-created role remains.
    const leftoverFuncs = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN (
          $1,'_recruiter_profile_capability_sync','_sync_recruiter_capability',
          '_derive_recruiter_capability_status','recruiter_profile_guard',
          'recruiter_profile_can_manage_opportunities','is_admin',
          'update_updated_at_column'
        )`,
      [CANDIDATE_RPC],
    );
    if (leftoverFuncs[0].n !== 0) {
      throw new Error(`afterAll leftover functions: ${leftoverFuncs[0].n}`);
    }
    const leftoverTables = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema IN ('public','auth')
          AND table_name IN ('recruiter_profiles','user_capabilities','profiles','users')`,
    );
    if (leftoverTables[0].n !== 0) {
      throw new Error(`afterAll leftover tables: ${leftoverTables[0].n}`);
    }
    if (rolesCreated.length > 0) {
      const remainingRoles = await q<{ rolname: string }>(
        `SELECT rolname FROM pg_roles WHERE rolname = ANY($1)`,
        [rolesCreated],
      );
      if (remainingRoles.length > 0) {
        throw new Error(
          `afterAll leftover roles: ${remainingRoles.map((r) => r.rolname).join(',')}`,
        );
      }
    }
  } finally {
    await pool.end();
  }
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('Phase 1N-E1-R1 — environment / candidate application', () => {
  it('runs against PostgreSQL major version exactly 16', async () => {
    const rows = await q<{ n: number }>(
      `SELECT (current_setting('server_version_num'))::int / 10000 AS n`,
    );
    expect(rows[0].n).toBe(16);
  });

  it('candidate lives in migration-candidates (not production migrations)', () => {
    expect(CANDIDATE_PATH).toContain('/migration-candidates/');
    expect(CANDIDATE_PATH).not.toMatch(/\/supabase\/migrations\//);
    expect(CANDIDATE_SQL.length).toBeGreaterThan(100);
  });
});

describe('Phase 1N-E1-R1 — backfill semantics (candidate applied once, post-seed)', () => {
  it('creates exactly one profile per eligible setup user missing a profile', async () => {
    const ids = [
      seeded.eligibleFromProfile,
      seeded.eligibleFromMetaDisplay,
      seeded.eligibleFromFullName,
      seeded.eligibleFromName,
      seeded.eligibleNoName,
      seeded.eligibleBadEmail,
      seeded.eligibleWhitespaceEmail,
      seeded.eligibleNullEmail,
      seeded.eligibleWithPhone,
      seeded.eligibleBlankPhone,
    ];
    for (const id of ids) {
      const rows = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.recruiter_profiles WHERE user_id = $1`,
        [id],
      );
      expect(rows[0].n).toBe(1);
    }
  });

  it('trusted-name priority: profiles.display_name → meta.display_name → full_name → name → ""', async () => {
    expect((await getRp(seeded.eligibleFromProfile)).recruiter_name).toBe('Alice Profile');
    expect((await getRp(seeded.eligibleFromMetaDisplay)).recruiter_name).toBe('Meta Display');
    expect((await getRp(seeded.eligibleFromFullName)).recruiter_name).toBe('Meta Full');
    expect((await getRp(seeded.eligibleFromName)).recruiter_name).toBe('Meta Name');
    expect((await getRp(seeded.eligibleNoName)).recruiter_name).toBe('');
  });

  it('no name is ever invented from email local-part or a placeholder', async () => {
    const noName = await getRp(seeded.eligibleNoName);
    expect(noName.recruiter_name).toBe('');
    expect(noName.recruiter_name).not.toContain('nameless');
    expect(noName.recruiter_name).not.toMatch(/user|unknown|recruiter/i);
  });

  it('copies email only when trimmed value matches canonical pattern', async () => {
    expect((await getRp(seeded.eligibleFromProfile)).recruiter_email).toBe('valid@example.com');
    expect((await getRp(seeded.eligibleBadEmail)).recruiter_email).toBeNull();
    expect((await getRp(seeded.eligibleWhitespaceEmail)).recruiter_email).toBeNull();
    expect((await getRp(seeded.eligibleNullEmail)).recruiter_email).toBeNull();
  });

  it('copies phone only when nonblank trimmed', async () => {
    expect((await getRp(seeded.eligibleWithPhone)).recruiter_phone).toBe('555-1212');
    expect((await getRp(seeded.eligibleBlankPhone)).recruiter_phone).toBeNull();
  });

  it('company_name is exactly empty on backfilled rows', async () => {
    const rows = await q<{ company_name: string }>(
      `SELECT company_name FROM public.recruiter_profiles
        WHERE user_id = ANY($1::uuid[])`,
      [[
        seeded.eligibleFromProfile,
        seeded.eligibleFromMetaDisplay,
        seeded.eligibleNoName,
      ]],
    );
    for (const r of rows) expect(r.company_name).toBe('');
  });

  it('no posting acceptance / grandfather / verification / admin / billing stamped on new rows', async () => {
    const r = await getRp(seeded.eligibleFromProfile);
    expect(r.posting_terms_accepted_at).toBeNull();
    expect(r.posting_terms_version).toBeNull();
    expect(r.legacy_terms_grandfathered_at).toBeNull();
    expect(r.verified_at).toBeNull();
    expect(r.verified_by).toBeNull();
    expect(r.admin_notes).toBeNull();
    expect(r.verification_status).toBe('pending');
  });

  it('backfilled rows stay recruiter capability = setup after sync trigger fires', async () => {
    expect(await getCap(seeded.eligibleFromProfile)).toBe('setup');
    expect(await getCap(seeded.eligibleNoName)).toBe('setup');
    expect(await getCap(seeded.eligibleBadEmail)).toBe('setup');
  });

  it('does NOT backfill active / suspended / revoked / no-capability users missing profiles', async () => {
    for (const uid of [
      seeded.notargetActive,
      seeded.notargetSuspended,
      seeded.notargetRevoked,
      seeded.notargetNoCap,
    ]) {
      const rows = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.recruiter_profiles WHERE user_id = $1`,
        [uid],
      );
      expect(rows[0].n).toBe(0);
    }
  });

  it('every pre-existing recruiter_profiles row is byte-identical after candidate', async () => {
    const after = await q<any>(
      `SELECT * FROM public.recruiter_profiles
        WHERE user_id = ANY($1::uuid[])
        ORDER BY user_id`,
      [Object.keys(EXISTING_ROWS_BEFORE)],
    );
    for (const row of after) {
      expect(row).toEqual(EXISTING_ROWS_BEFORE[row.user_id]);
    }
    // Also make sure the set is exactly the same.
    expect(after.map((r) => r.user_id).sort()).toEqual(
      Object.keys(EXISTING_ROWS_BEFORE).sort(),
    );
  });
});

describe('Phase 1N-E1-R1 — full-candidate idempotency', () => {
  it('re-applying the exact full candidate a second time is a no-op (rows, protected catalog surface)', async () => {
    const beforeRowCount = (await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.recruiter_profiles`,
    ))[0].n;
    const beforeRows = await q<any>(
      `SELECT user_id, recruiter_name, recruiter_email, recruiter_phone,
              company_name, verification_status, posting_terms_accepted_at,
              legacy_terms_grandfathered_at
         FROM public.recruiter_profiles ORDER BY user_id`,
    );

    // Second full-candidate application — must fail-safe against duplicate
    // rows, function overloads, privilege drift, or catalog drift.
    await pool.query(CANDIDATE_SQL);

    const afterRowCount = (await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.recruiter_profiles`,
    ))[0].n;
    expect(afterRowCount).toBe(beforeRowCount);

    const afterRows = await q<any>(
      `SELECT user_id, recruiter_name, recruiter_email, recruiter_phone,
              company_name, verification_status, posting_terms_accepted_at,
              legacy_terms_grandfathered_at
         FROM public.recruiter_profiles ORDER BY user_id`,
    );
    expect(afterRows).toEqual(beforeRows);

    // Protected catalog surface after the SECOND application must equal the
    // snapshot taken after the FIRST application.
    const afterSecond = await snapshotAll();
    expect(afterSecond).toEqual(SNAP_AFTER_FIRST);
  });
});

describe('Phase 1N-E1-R1 — RPC contract', () => {
  it('creates the RPC with correct signature, ACL, definer, search_path, volatility, owner', async () => {
    const rows = await q<any>(
      `SELECT p.prosecdef,
              p.provolatile::text AS provolatile,
              p.proconfig AS config,
              pg_get_function_arguments(p.oid) AS argtypes,
              pg_get_function_result(p.oid) AS rettype,
              pg_get_userbyid(p.proowner) AS owner
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1`,
      [CANDIDATE_RPC],
    );
    expect(rows).toHaveLength(1);
    const fn = rows[0];
    expect(fn.prosecdef).toBe(true);
    expect(fn.provolatile).toBe('v');
    expect(fn.config ?? []).toContain('search_path=public');
    expect(fn.argtypes).toBe('');
    expect(fn.rettype.toLowerCase()).toContain('table');
    for (const field of [
      'user_id uuid',
      'profile_id uuid',
      'profile_created boolean',
      'capability_status text',
      'eligibility_state text',
      'missing_requirements text[]',
    ]) {
      expect(fn.rettype).toContain(field);
    }
    expect(typeof fn.owner).toBe('string');

    const acls = await q<{ grantee: string }>(
      `SELECT grantee FROM information_schema.routine_privileges
        WHERE routine_schema='public' AND routine_name=$1`,
      [CANDIDATE_RPC],
    );
    const grantees = acls.map((r) => r.grantee).sort();
    expect(grantees).toContain('authenticated');
    expect(grantees).toContain('service_role');
    expect(grantees).not.toContain('anon');
    expect(grantees).not.toContain('PUBLIC');
  });

  it('no target-user parameter or overload exists', async () => {
    const rows = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1`,
      [CANDIDATE_RPC],
    );
    expect(rows[0].n).toBe(1);
  });

  it('anonymous / NULL auth call fails with SQLSTATE 42501', async () => {
    await expect(
      asUser(null, async (c) => {
        await c.query(`SELECT * FROM public.${CANDIDATE_RPC}()`);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('actual anon role cannot execute the RPC (ACL enforced)', async () => {
    await expect(
      asAnon(async (c) => {
        await c.query(`SELECT * FROM public.${CANDIDATE_RPC}()`);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('capability_missing → no writes, no profile', async () => {
    const uid = await createUser('nocap-rpc@example.com');
    const result = await asUser(uid, async (c) => {
      const r = await c.query(`SELECT * FROM public.${CANDIDATE_RPC}()`);
      return r.rows[0];
    });
    expect(result.eligibility_state).toBe('capability_missing');
    expect(result.profile_created).toBe(false);
    expect(result.profile_id).toBeNull();
    expect(result.capability_status).toBeNull();
    expect(result.missing_requirements).toEqual([]);
    expect(await getRp(uid)).toBeNull();
  });

  it('suspended / revoked → returns state without writing or updating', async () => {
    const uSusp = await createUser('rpc-susp@example.com');
    await setCap(uSusp, 'suspended');
    const rSusp = await asUser(uSusp, async (c) => {
      const r = await c.query(`SELECT * FROM public.${CANDIDATE_RPC}()`);
      return r.rows[0];
    });
    expect(rSusp.eligibility_state).toBe('suspended');
    expect(rSusp.profile_created).toBe(false);
    expect(rSusp.capability_status).toBe('suspended');
    expect(await getRp(uSusp)).toBeNull();

    const uRev = await createUser('rpc-rev@example.com');
    await setCap(uRev, 'revoked');
    const rRev = await asUser(uRev, async (c) => {
      const r = await c.query(`SELECT * FROM public.${CANDIDATE_RPC}()`);
      return r.rows[0];
    });
    expect(rRev.eligibility_state).toBe('revoked');
    expect(rRev.profile_created).toBe(false);
    expect(rRev.capability_status).toBe('revoked');
    expect(await getRp(uRev)).toBeNull();
  });

  it('active capability + missing profile fails closed without mutation', async () => {
    const uid = await createUser('rpc-active-noprofile@example.com');
    await setCap(uid, 'active');
    await expect(
      asUser(uid, async (c) => {
        await c.query(`SELECT * FROM public.${CANDIDATE_RPC}()`);
      }),
    ).rejects.toThrow(/active recruiter capability without/);
    expect(await getRp(uid)).toBeNull();
    expect(await getCap(uid)).toBe('active');
  });

  it('setup + missing profile: creates trusted-field row, returns setup_incomplete + ordered tokens', async () => {
    const uid = await createUser('rpc-setup@example.com', {
      display_name: '  RPC Setup  ',
      phone: '  555-9999  ',
    });
    await setCap(uid, 'setup');
    const result = await asUser(uid, async (c) => {
      const r = await c.query(`SELECT * FROM public.${CANDIDATE_RPC}()`);
      return r.rows[0];
    });
    expect(result.profile_created).toBe(true);
    expect(result.eligibility_state).toBe('setup_incomplete');
    expect(result.capability_status).toBe('setup');
    expect(result.missing_requirements).toEqual([
      'company_name',
      'dot_or_mc_number',
      'posting_terms',
    ]);
    const rp = await getRp(uid);
    expect(rp.recruiter_name).toBe('RPC Setup');
    expect(rp.recruiter_email).toBe('rpc-setup@example.com');
    expect(rp.recruiter_phone).toBe('555-9999');
    expect(rp.company_name).toBe('');
    expect(rp.posting_terms_accepted_at).toBeNull();
    expect(rp.legacy_terms_grandfathered_at).toBeNull();
    expect(rp.verification_status).toBe('pending');
  });

  it('missing-requirement tokens preserve strict canonical order for every-token case', async () => {
    const uid = await createUser('badall', {});
    await setCap(uid, 'setup');
    const result = await asUser(uid, async (c) => {
      const r = await c.query(`SELECT * FROM public.${CANDIDATE_RPC}()`);
      return r.rows[0];
    });
    expect(result.missing_requirements).toEqual([
      'recruiter_name',
      'company_name',
      'recruiter_email',
      'dot_or_mc_number',
      'posting_terms',
    ]);
  });

  it('idempotent: subsequent call returns existing row with profile_created=false and never updates', async () => {
    const uid = await createUser('rpc-idem@example.com', {
      display_name: 'Idem',
    });
    await setCap(uid, 'setup');
    const first = await asUser(uid, async (c) => {
      const r = await c.query(`SELECT * FROM public.${CANDIDATE_RPC}()`);
      return r.rows[0];
    });
    expect(first.profile_created).toBe(true);
    const before = await getRp(uid);

    const second = await asUser(uid, async (c) => {
      const r = await c.query(`SELECT * FROM public.${CANDIDATE_RPC}()`);
      return r.rows[0];
    });
    expect(second.profile_created).toBe(false);
    expect(second.profile_id).toBe(first.profile_id);
    expect(await getRp(uid)).toEqual(before);
  });

  it('existing complete + active + canonical-eligible → active; profile untouched', async () => {
    const uid = await createUser('rpc-existing@example.com');
    await seedHistoricalProfile(uid, {
      recruiter_name: 'Ex',
      recruiter_email: 'ex@example.com',
      company_name: 'ExCo',
      dot_number: '12345',
      legacy_terms_grandfathered_at: new Date(),
      verification_status: 'approved',
      status: 'active',
    });
    await setCap(uid, 'active');
    const before = await getRp(uid);
    const result = await asUser(uid, async (c) => {
      const r = await c.query(`SELECT * FROM public.${CANDIDATE_RPC}()`);
      return r.rows[0];
    });
    expect(result.eligibility_state).toBe('active');
    expect(result.profile_created).toBe(false);
    expect(result.missing_requirements).toEqual([]);
    expect(await getRp(uid)).toEqual(before);
  });

  it('cannot target another user (no parameter, no overload)', async () => {
    const attacker = await createUser('attacker@example.com');
    await setCap(attacker, 'setup');
    const victim = await createUser('victim@example.com');
    await setCap(victim, 'setup');

    await expect(
      asUser(attacker, async (c) => {
        await c.query(
          `SELECT * FROM public.${CANDIDATE_RPC}($1)`,
          [victim],
        );
      }),
    ).rejects.toThrow();

    await asUser(attacker, async (c) => {
      await c.query(`SELECT * FROM public.${CANDIDATE_RPC}()`);
    });
    const attackerRp = await getRp(attacker);
    expect(attackerRp).not.toBeNull();
    expect(attackerRp.user_id).toBe(attacker);
    expect(await getRp(victim)).toBeNull();
  });

  it('two concurrent first calls for the same setup user produce exactly one row and exactly one profile_created=true', async () => {
    const uid = await createUser('rpc-concurrent@example.com', {
      display_name: 'Concurrent',
    });
    await setCap(uid, 'setup');

    const [r1, r2] = await Promise.all([
      asUser(uid, async (c) => {
        const r = await c.query(`SELECT * FROM public.${CANDIDATE_RPC}()`);
        return r.rows[0];
      }),
      asUser(uid, async (c) => {
        const r = await c.query(`SELECT * FROM public.${CANDIDATE_RPC}()`);
        return r.rows[0];
      }),
    ]);
    const created = [r1.profile_created, r2.profile_created];
    expect(created.filter((b) => b === true)).toHaveLength(1);
    expect(created.filter((b) => b === false)).toHaveLength(1);

    const rows = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.recruiter_profiles WHERE user_id = $1`,
      [uid],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe('Phase 1N-E1-R1 — protected catalog surface non-interference', () => {
  it('the set of new public functions added by the candidate is exactly the RPC', () => {
    const beforeSet = new Set(SNAP_BEFORE.functionIdentSet);
    const added = SNAP_AFTER_FIRST.functionIdentSet.filter(
      (i) => !beforeSet.has(i),
    );
    expect(added).toEqual([`public.${CANDIDATE_RPC}()`]);
    const removed = SNAP_BEFORE.functionIdentSet.filter(
      (i) => !new Set(SNAP_AFTER_FIRST.functionIdentSet).has(i),
    );
    expect(removed).toEqual([]);
  });

  it('every pre-existing protected function is byte-identical (definition/ACL/owner/definer/config/volatility)', () => {
    expect(SNAP_AFTER_FIRST.protectedFunctions).toEqual(
      SNAP_BEFORE.protectedFunctions,
    );
  });

  it('trigger definitions on protected tables are unchanged', () => {
    expect(SNAP_AFTER_FIRST.triggers).toEqual(SNAP_BEFORE.triggers);
  });

  it('table policies on protected tables are unchanged', () => {
    expect(SNAP_AFTER_FIRST.policies).toEqual(SNAP_BEFORE.policies);
  });

  it('table grants on protected tables are unchanged', () => {
    expect(SNAP_AFTER_FIRST.tableGrants).toEqual(SNAP_BEFORE.tableGrants);
  });

  it('columns / nullability / defaults on protected tables are unchanged', () => {
    expect(SNAP_AFTER_FIRST.columns).toEqual(SNAP_BEFORE.columns);
  });

  it('constraints on protected tables are unchanged', () => {
    expect(SNAP_AFTER_FIRST.constraints).toEqual(SNAP_BEFORE.constraints);
  });

  it('indexes on protected tables are unchanged', () => {
    expect(SNAP_AFTER_FIRST.indexes).toEqual(SNAP_BEFORE.indexes);
  });

  it('no new triggers exist on protected tables (only the pre-existing fixture triggers)', async () => {
    const rows = await q<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgrelid::regclass::text = ANY($1)
        ORDER BY tgname`,
      [PROTECTED_TABLES],
    );
    expect(rows.map((r) => r.tgname).sort()).toEqual(
      [
        'trg_recruiter_profile_capability_sync',
        'trg_recruiter_profile_guard',
      ].sort(),
    );
  });
});
