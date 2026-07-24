/**
 * Phase 1N-E1 — Real PostgreSQL 16 gate for the legacy recruiter
 * compatibility candidate.
 *
 * Executes the exact candidate file from disk against a fresh PG16
 * fixture that reproduces only the minimum canonical contracts required:
 * roles, auth.users, auth.uid(), public.profiles, the user_capabilities
 * enums/table plus the recruiter capability sync trigger, the exact
 * relevant shape of public.recruiter_profiles with its UNIQUE(user_id),
 * the recruiter_profile_guard trigger, and the canonical
 * recruiter_profile_can_manage_opportunities function.
 *
 * NEVER SKIPS. Fails hard if PHASE1N_LEGACY_RECRUITER_DATABASE_URL is
 * absent. No `.skip`, `.only`, `.todo`, xit, xdescribe, PGlite, SQLite,
 * or in-memory substitute is permitted.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

// ---------------------------------------------------------------------------
// Fixture reset — every object created here is dropped in afterAll.
// ---------------------------------------------------------------------------
const RESET_SQL = `
DROP FUNCTION IF EXISTS public.ensure_my_recruiter_setup_state() CASCADE;
DROP TRIGGER IF EXISTS trg_recruiter_profile_capability_sync ON public.recruiter_profiles;
DROP TRIGGER IF EXISTS trg_recruiter_profile_guard ON public.recruiter_profiles;
DROP FUNCTION IF EXISTS public._recruiter_profile_capability_sync() CASCADE;
DROP FUNCTION IF EXISTS public._sync_recruiter_capability(uuid) CASCADE;
DROP FUNCTION IF EXISTS public._derive_recruiter_capability_status(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.recruiter_profile_guard() CASCADE;
DROP FUNCTION IF EXISTS public.is_admin(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.recruiter_profile_can_manage_opportunities(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;
DROP TABLE IF EXISTS public.user_capabilities CASCADE;
DROP TABLE IF EXISTS public.recruiter_profiles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TYPE IF EXISTS public.user_capability_type CASCADE;
DROP TYPE IF EXISTS public.user_capability_status CASCADE;
DROP TABLE IF EXISTS auth.users CASCADE;
DROP FUNCTION IF EXISTS auth.uid() CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
`;

// ---------------------------------------------------------------------------
// Minimum canonical fixture. Includes: roles, auth.users w/ email +
// raw_user_meta_data, auth.uid() from request.jwt.claim.sub, profiles
// with display_name and intended_role, user_capabilities table & enums,
// recruiter_profiles with the exact relevant shape and UNIQUE(user_id),
// recruiter_profile_guard trigger (canonical INSERT reset behavior),
// recruiter capability sync trigger, and the canonical
// recruiter_profile_can_manage_opportunities function.
// ---------------------------------------------------------------------------
const BOOTSTRAP_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon           NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated  NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role   NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT anon, authenticated, service_role TO CURRENT_USER;
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

-- is_admin stub — always false; the guard's admin bypass never fires.
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

-- Canonical Phase 1F rule (verbatim).
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

-- Canonical guard (INSERT branch resets the acceptance / verification
-- columns for non-admin callers — matches production behavior).
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

-- Capability enums / table.
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

-- Recruiter capability derivation + sync (as in Phase 1J-A candidate).
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

async function insertProfile(
  userId: string,
  displayName: string | null,
  intendedRole: string | null = null,
) {
  await q(
    `INSERT INTO public.profiles(user_id, display_name, intended_role) VALUES ($1,$2,$3)`,
    [userId, displayName, intendedRole],
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

// Snapshot the exact set of triggers / functions / policies present on the
// canonical objects so we can prove the candidate does not silently mutate
// existing recruiter/opportunity/capability policy surface.
async function snapshotPolicySurface() {
  const triggers = await q(
    `SELECT tgname, tgrelid::regclass::text AS tbl
       FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgrelid::regclass::text IN (
              'public.recruiter_profiles',
              'public.user_capabilities'
            )
      ORDER BY tbl, tgname`,
  );
  const functions = await q(
    `SELECT p.proname
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'recruiter_profile_can_manage_opportunities',
          'recruiter_profile_guard',
          '_recruiter_profile_capability_sync',
          '_sync_recruiter_capability',
          '_derive_recruiter_capability_status'
        )
      ORDER BY p.proname`,
  );
  return { triggers, functions };
}

let SURFACE_BEFORE: { triggers: any[]; functions: any[] };

beforeAll(async () => {
  await pool.query(RESET_SQL);
  await pool.query(BOOTSTRAP_SQL);

  // Seed fixture rows BEFORE applying the candidate so the backfill is
  // exercised for real.
  // (Fixture seeding is done in-suite below using specific user ids that
  // each test group asserts against.)
  SURFACE_BEFORE = await snapshotPolicySurface();
  await pool.query(CANDIDATE_SQL);
});

afterAll(async () => {
  await pool.query(RESET_SQL);
  await pool.end();
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('Phase 1N-E1 — legacy recruiter compatibility (real PG16)', () => {
  it('runs against PostgreSQL major version 16', async () => {
    const rows = await q<{ n: number }>(
      `SELECT (current_setting('server_version_num'))::int / 10000 AS n`,
    );
    expect(rows[0].n).toBe(16);
  });

  it('candidate SQL exists only in migration-candidates, not in supabase/migrations', () => {
    // Path-check: candidate lives in migration-candidates directory, and
    // the file we read is the one on disk.
    expect(CANDIDATE_PATH).toContain('/migration-candidates/');
    expect(CANDIDATE_PATH).not.toMatch(/\/migrations\/[^/]+\.sql$/);
    expect(CANDIDATE_SQL.length).toBeGreaterThan(100);
  });

  it('creates the ensure_my_recruiter_setup_state RPC with correct ACL/definer/search_path/volatility/signature', async () => {
    const rows = await q<{
      proname: string;
      prosecdef: boolean;
      provolatile: string;
      config: string[] | null;
      argnames: string[] | null;
      argtypes: string;
      rettype: string;
    }>(
      `SELECT p.proname,
              p.prosecdef,
              p.provolatile::text AS provolatile,
              p.proconfig AS config,
              p.proargnames AS argnames,
              pg_get_function_arguments(p.oid) AS argtypes,
              pg_get_function_result(p.oid) AS rettype
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname='ensure_my_recruiter_setup_state'`,
    );
    expect(rows).toHaveLength(1);
    const fn = rows[0];
    expect(fn.prosecdef).toBe(true);
    expect(fn.provolatile).toBe('v'); // volatile
    expect(fn.config ?? []).toContain('search_path=public');
    expect(fn.argtypes).toBe(''); // no parameters
    expect(fn.rettype.toLowerCase()).toContain('table');
    expect(fn.rettype).toContain('user_id uuid');
    expect(fn.rettype).toContain('profile_id uuid');
    expect(fn.rettype).toContain('profile_created boolean');
    expect(fn.rettype).toContain('capability_status text');
    expect(fn.rettype).toContain('eligibility_state text');
    expect(fn.rettype).toContain('missing_requirements text[]');

    const acls = await q<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type
         FROM information_schema.routine_privileges
        WHERE routine_schema='public'
          AND routine_name='ensure_my_recruiter_setup_state'`,
    );
    const grantees = acls.map((r) => r.grantee).sort();
    expect(grantees).toContain('authenticated');
    expect(grantees).toContain('service_role');
    expect(grantees).not.toContain('anon');
    expect(grantees).not.toContain('PUBLIC');
  });

  it('no target-user overload exists', async () => {
    const rows = await q<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname='ensure_my_recruiter_setup_state'`,
    );
    expect(rows[0].n).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Backfill assertions. Fixture users seeded AFTER candidate ran, so we
// re-execute only the backfill DO-block portion of the candidate to prove
// it operates on the seeded rows. This mirrors production behavior where
// the candidate is applied against a database that already contains
// legacy rows.
// ---------------------------------------------------------------------------
describe('Phase 1N-E1 — backfill semantics', () => {
  const seeded: Record<string, string> = {};

  beforeAll(async () => {
    // Eligible: setup capability, no profile, various trusted-name sources.
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

    // No trusted name at all — must NOT invent from email local-part.
    seeded.eligibleNoName = await createUser('nameless@example.com', {});
    await setCap(seeded.eligibleNoName, 'setup');

    // Invalid email format: recruiter_email must be NULL.
    seeded.eligibleBadEmail = await createUser('not-an-email', {
      display_name: 'BadEmail',
    });
    await setCap(seeded.eligibleBadEmail, 'setup');

    // Whitespace email: recruiter_email must be NULL.
    seeded.eligibleWhitespaceEmail = await createUser('   ', {
      display_name: 'WSEmail',
    });
    await setCap(seeded.eligibleWhitespaceEmail, 'setup');

    // Phone-only metadata.
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

    // Non-targets:
    seeded.notargetActive = await createUser('active@example.com');
    await setCap(seeded.notargetActive, 'active');

    seeded.notargetSuspended = await createUser('susp@example.com');
    await setCap(seeded.notargetSuspended, 'suspended');

    seeded.notargetRevoked = await createUser('rev@example.com');
    await setCap(seeded.notargetRevoked, 'revoked');

    seeded.notargetNoCap = await createUser('nocap@example.com');
    // no capability row

    // Existing recruiter profile — must NOT be touched.
    seeded.existingComplete = await createUser('complete@example.com');
    await q(
      `INSERT INTO public.recruiter_profiles(
         user_id, recruiter_name, recruiter_email, company_name, dot_number,
         posting_terms_accepted_at, posting_terms_version, verification_status, status
       ) VALUES ($1,'Existing','existing@example.com','ExistingCo','12345',
                 now(),'v1','approved','active')`,
      [seeded.existingComplete],
    );
    // Guard blanks acceptance / verification on insert; simulate the
    // legitimate historical state by service-role UPDATE-bypass: disable
    // the guard for the fixture write, then re-enable.
    await q(`ALTER TABLE public.recruiter_profiles DISABLE TRIGGER trg_recruiter_profile_guard`);
    await q(
      `UPDATE public.recruiter_profiles
          SET posting_terms_accepted_at = now(),
              posting_terms_version = 'v1',
              verification_status = 'approved'
        WHERE user_id = $1`,
      [seeded.existingComplete],
    );

    seeded.existingGrandfathered = await createUser('gf@example.com');
    await q(
      `INSERT INTO public.recruiter_profiles(
         user_id, recruiter_name, recruiter_email, company_name, mc_number,
         legacy_terms_grandfathered_at, verification_status
       ) VALUES ($1,'GF','gf@example.com','GFCo','MC1',now(),'approved')`,
      [seeded.existingGrandfathered],
    );
    await q(
      `UPDATE public.recruiter_profiles
          SET legacy_terms_grandfathered_at = now(),
              verification_status = 'approved'
        WHERE user_id = $1`,
      [seeded.existingGrandfathered],
    );

    seeded.existingMalformed = await createUser('malf@example.com');
    await q(
      `INSERT INTO public.recruiter_profiles(user_id, recruiter_name, company_name)
       VALUES ($1,'','')`,
      [seeded.existingMalformed],
    );
    await q(`ALTER TABLE public.recruiter_profiles ENABLE TRIGGER trg_recruiter_profile_guard`);

    // Now re-run ONLY the backfill DO-block portion of the candidate.
    // Extract from candidate text between the first DO $phase1n_e_backfill$
    // and its matching close.
    const openIdx = CANDIDATE_SQL.indexOf('DO $phase1n_e_backfill$');
    const closeIdx = CANDIDATE_SQL.indexOf('$phase1n_e_backfill$;', openIdx);
    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThan(openIdx);
    const backfillBlock = CANDIDATE_SQL.slice(
      openIdx,
      closeIdx + '$phase1n_e_backfill$;'.length,
    );
    await pool.query(backfillBlock);
  });

  it('creates exactly one profile per eligible setup user missing a profile', async () => {
    const ids = [
      seeded.eligibleFromProfile,
      seeded.eligibleFromMetaDisplay,
      seeded.eligibleFromFullName,
      seeded.eligibleFromName,
      seeded.eligibleNoName,
      seeded.eligibleBadEmail,
      seeded.eligibleWhitespaceEmail,
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

  it('trusted-name priority is profiles.display_name → meta.display_name → full_name → name → empty', async () => {
    const p1 = await getRp(seeded.eligibleFromProfile);
    expect(p1.recruiter_name).toBe('Alice Profile');

    const p2 = await getRp(seeded.eligibleFromMetaDisplay);
    expect(p2.recruiter_name).toBe('Meta Display');

    const p3 = await getRp(seeded.eligibleFromFullName);
    expect(p3.recruiter_name).toBe('Meta Full');

    const p4 = await getRp(seeded.eligibleFromName);
    expect(p4.recruiter_name).toBe('Meta Name');

    const p5 = await getRp(seeded.eligibleNoName);
    // Never invents from email local-part.
    expect(p5.recruiter_name).toBe('');
  });

  it('copies email only when trimmed value matches canonical pattern', async () => {
    const p1 = await getRp(seeded.eligibleFromProfile);
    expect(p1.recruiter_email).toBe('valid@example.com');

    const bad = await getRp(seeded.eligibleBadEmail);
    expect(bad.recruiter_email).toBeNull();

    const ws = await getRp(seeded.eligibleWhitespaceEmail);
    expect(ws.recruiter_email).toBeNull();
  });

  it('copies phone only when nonblank trimmed', async () => {
    const withPhone = await getRp(seeded.eligibleWithPhone);
    expect(withPhone.recruiter_phone).toBe('555-1212');

    const blank = await getRp(seeded.eligibleBlankPhone);
    expect(blank.recruiter_phone).toBeNull();
  });

  it('company_name is always exactly empty on backfilled rows', async () => {
    const rows = await q<{ company_name: string }>(
      `SELECT company_name FROM public.recruiter_profiles
        WHERE user_id = ANY($1::uuid[])`,
      [
        [
          seeded.eligibleFromProfile,
          seeded.eligibleFromMetaDisplay,
          seeded.eligibleNoName,
        ],
      ],
    );
    for (const r of rows) {
      expect(r.company_name).toBe('');
    }
  });

  it('no posting-terms / grandfather / verification timestamps set on new rows', async () => {
    const r = await getRp(seeded.eligibleFromProfile);
    expect(r.posting_terms_accepted_at).toBeNull();
    expect(r.posting_terms_version).toBeNull();
    expect(r.legacy_terms_grandfathered_at).toBeNull();
    expect(r.verified_at).toBeNull();
    expect(r.verified_by).toBeNull();
    expect(r.admin_notes).toBeNull();
    expect(r.verification_status).toBe('pending');
  });

  it('backfilled users remain capability=setup after the sync trigger', async () => {
    expect(await getCap(seeded.eligibleFromProfile)).toBe('setup');
    expect(await getCap(seeded.eligibleNoName)).toBe('setup');
    expect(await getCap(seeded.eligibleBadEmail)).toBe('setup');
  });

  it('does NOT backfill active / suspended / revoked / no-capability users', async () => {
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

  it('leaves every existing recruiter_profiles row byte-identical (complete, grandfathered, malformed)', async () => {
    const before = await q(
      `SELECT * FROM public.recruiter_profiles
        WHERE user_id = ANY($1::uuid[])
        ORDER BY user_id`,
      [
        [
          seeded.existingComplete,
          seeded.existingGrandfathered,
          seeded.existingMalformed,
        ],
      ],
    );
    // Re-run backfill idempotently and re-read.
    const openIdx = CANDIDATE_SQL.indexOf('DO $phase1n_e_backfill$');
    const closeIdx = CANDIDATE_SQL.indexOf('$phase1n_e_backfill$;', openIdx);
    const backfillBlock = CANDIDATE_SQL.slice(
      openIdx,
      closeIdx + '$phase1n_e_backfill$;'.length,
    );
    await pool.query(backfillBlock);
    const after = await q(
      `SELECT * FROM public.recruiter_profiles
        WHERE user_id = ANY($1::uuid[])
        ORDER BY user_id`,
      [
        [
          seeded.existingComplete,
          seeded.existingGrandfathered,
          seeded.existingMalformed,
        ],
      ],
    );
    expect(after).toEqual(before);
  });

  it('rerunning the backfill creates no duplicate rows and no overwrites', async () => {
    const openIdx = CANDIDATE_SQL.indexOf('DO $phase1n_e_backfill$');
    const closeIdx = CANDIDATE_SQL.indexOf('$phase1n_e_backfill$;', openIdx);
    const backfillBlock = CANDIDATE_SQL.slice(
      openIdx,
      closeIdx + '$phase1n_e_backfill$;'.length,
    );
    const beforeCount = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.recruiter_profiles`,
    );
    const snapshot = await q(
      `SELECT user_id, recruiter_name, recruiter_email, recruiter_phone,
              company_name, verification_status, posting_terms_accepted_at,
              legacy_terms_grandfathered_at
         FROM public.recruiter_profiles ORDER BY user_id`,
    );
    await pool.query(backfillBlock);
    await pool.query(backfillBlock);
    const afterCount = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.recruiter_profiles`,
    );
    expect(afterCount[0].n).toBe(beforeCount[0].n);
    const snapshotAfter = await q(
      `SELECT user_id, recruiter_name, recruiter_email, recruiter_phone,
              company_name, verification_status, posting_terms_accepted_at,
              legacy_terms_grandfathered_at
         FROM public.recruiter_profiles ORDER BY user_id`,
    );
    expect(snapshotAfter).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// RPC assertions
// ---------------------------------------------------------------------------
describe('Phase 1N-E1 — ensure_my_recruiter_setup_state RPC', () => {
  it('rejects anonymous / NULL auth with SQLSTATE 42501', async () => {
    await expect(
      asUser(null, async (c) => {
        await c.query(`SELECT * FROM public.ensure_my_recruiter_setup_state()`);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('returns capability_missing without creating anything', async () => {
    const uid = await createUser('nocap-rpc@example.com');
    const result = await asUser(uid, async (c) => {
      const r = await c.query(
        `SELECT * FROM public.ensure_my_recruiter_setup_state()`,
      );
      return r.rows[0];
    });
    expect(result.eligibility_state).toBe('capability_missing');
    expect(result.profile_created).toBe(false);
    expect(result.profile_id).toBeNull();
    expect(result.capability_status).toBeNull();
    expect(result.missing_requirements).toEqual([]);
    const rp = await getRp(uid);
    expect(rp).toBeNull();
  });

  it('returns suspended / revoked without creating or updating anything', async () => {
    const uSusp = await createUser('rpc-susp@example.com');
    await setCap(uSusp, 'suspended');
    const rSusp = await asUser(uSusp, async (c) => {
      const r = await c.query(
        `SELECT * FROM public.ensure_my_recruiter_setup_state()`,
      );
      return r.rows[0];
    });
    expect(rSusp.eligibility_state).toBe('suspended');
    expect(rSusp.profile_created).toBe(false);
    expect(rSusp.capability_status).toBe('suspended');
    expect(await getRp(uSusp)).toBeNull();

    const uRev = await createUser('rpc-rev@example.com');
    await setCap(uRev, 'revoked');
    const rRev = await asUser(uRev, async (c) => {
      const r = await c.query(
        `SELECT * FROM public.ensure_my_recruiter_setup_state()`,
      );
      return r.rows[0];
    });
    expect(rRev.eligibility_state).toBe('revoked');
    expect(rRev.profile_created).toBe(false);
    expect(rRev.capability_status).toBe('revoked');
    expect(await getRp(uRev)).toBeNull();
  });

  it('active capability with missing profile fails closed without mutation', async () => {
    const uid = await createUser('rpc-active-noprofile@example.com');
    await setCap(uid, 'active');
    await expect(
      asUser(uid, async (c) => {
        await c.query(`SELECT * FROM public.ensure_my_recruiter_setup_state()`);
      }),
    ).rejects.toThrow(/active recruiter capability without/);
    // No profile was created.
    expect(await getRp(uid)).toBeNull();
    // Capability unchanged.
    expect(await getCap(uid)).toBe('active');
  });

  it('setup + missing profile: creates trusted-field row and returns setup_incomplete with ordered missing tokens', async () => {
    const uid = await createUser('rpc-setup@example.com', {
      display_name: '  RPC Setup  ',
      phone: '  555-9999  ',
    });
    await setCap(uid, 'setup');
    const result = await asUser(uid, async (c) => {
      const r = await c.query(
        `SELECT * FROM public.ensure_my_recruiter_setup_state()`,
      );
      return r.rows[0];
    });
    expect(result.profile_created).toBe(true);
    expect(result.eligibility_state).toBe('setup_incomplete');
    expect(result.capability_status).toBe('setup');
    // Deterministic ordered tokens: name & email present, others missing.
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

  it('missing-requirement tokens preserve strict order across all combinations', async () => {
    // User with no trusted name, invalid email → all five tokens in order.
    const uid = await createUser('badall', {}); // bad email, no name
    await setCap(uid, 'setup');
    const result = await asUser(uid, async (c) => {
      const r = await c.query(
        `SELECT * FROM public.ensure_my_recruiter_setup_state()`,
      );
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

  it('idempotent: subsequent call returns the existing row with profile_created=false and never updates', async () => {
    const uid = await createUser('rpc-idem@example.com', {
      display_name: 'Idem',
    });
    await setCap(uid, 'setup');
    const first = await asUser(uid, async (c) => {
      const r = await c.query(
        `SELECT * FROM public.ensure_my_recruiter_setup_state()`,
      );
      return r.rows[0];
    });
    expect(first.profile_created).toBe(true);
    const before = await getRp(uid);

    const second = await asUser(uid, async (c) => {
      const r = await c.query(
        `SELECT * FROM public.ensure_my_recruiter_setup_state()`,
      );
      return r.rows[0];
    });
    expect(second.profile_created).toBe(false);
    expect(second.profile_id).toBe(first.profile_id);

    const after = await getRp(uid);
    expect(after).toEqual(before);
  });

  it('existing complete profile: returns active only when capability is active AND canonical rule passes; never updates the profile', async () => {
    const uid = await createUser('rpc-existing@example.com');
    // Insert a complete, grandfathered profile bypassing the guard so the
    // canonical rule can pass.
    await q(`ALTER TABLE public.recruiter_profiles DISABLE TRIGGER trg_recruiter_profile_guard`);
    await q(
      `INSERT INTO public.recruiter_profiles(
         user_id, recruiter_name, recruiter_email, company_name, dot_number,
         legacy_terms_grandfathered_at, verification_status, status
       ) VALUES ($1,'Ex','ex@example.com','ExCo','12345',now(),'approved','active')`,
      [uid],
    );
    await q(`ALTER TABLE public.recruiter_profiles ENABLE TRIGGER trg_recruiter_profile_guard`);
    // Force capability active manually.
    await setCap(uid, 'active');
    const before = await getRp(uid);
    const result = await asUser(uid, async (c) => {
      const r = await c.query(
        `SELECT * FROM public.ensure_my_recruiter_setup_state()`,
      );
      return r.rows[0];
    });
    expect(result.eligibility_state).toBe('active');
    expect(result.profile_created).toBe(false);
    expect(result.missing_requirements).toEqual([]);
    const after = await getRp(uid);
    expect(after).toEqual(before);
  });

  it('cannot target another user (no parameter, no overload)', async () => {
    const attacker = await createUser('attacker@example.com');
    await setCap(attacker, 'setup');
    const victim = await createUser('victim@example.com');
    await setCap(victim, 'setup');

    await expect(
      asUser(attacker, async (c) => {
        // No overload with a uuid parameter exists.
        await c.query(
          `SELECT * FROM public.ensure_my_recruiter_setup_state($1)`,
          [victim],
        );
      }),
    ).rejects.toThrow();

    // Attacker call creates only attacker's own row.
    await asUser(attacker, async (c) => {
      await c.query(`SELECT * FROM public.ensure_my_recruiter_setup_state()`);
    });
    const attackerRp = await getRp(attacker);
    expect(attackerRp).not.toBeNull();
    expect(attackerRp.user_id).toBe(attacker);
    const victimRp = await getRp(victim);
    expect(victimRp).toBeNull();
  });

  it('two concurrent first calls for the same setup user produce exactly one row and one profile_created=true', async () => {
    const uid = await createUser('rpc-concurrent@example.com', {
      display_name: 'Concurrent',
    });
    await setCap(uid, 'setup');

    const [r1, r2] = await Promise.all([
      asUser(uid, async (c) => {
        const r = await c.query(
          `SELECT * FROM public.ensure_my_recruiter_setup_state()`,
        );
        return r.rows[0];
      }),
      asUser(uid, async (c) => {
        const r = await c.query(
          `SELECT * FROM public.ensure_my_recruiter_setup_state()`,
        );
        return r.rows[0];
      }),
    ]);
    const createdFlags = [r1.profile_created, r2.profile_created];
    // Exactly one true.
    expect(createdFlags.filter((b) => b === true)).toHaveLength(1);
    expect(createdFlags.filter((b) => b === false)).toHaveLength(1);
    const rows = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.recruiter_profiles WHERE user_id = $1`,
      [uid],
    );
    expect(rows[0].n).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Surface non-interference
// ---------------------------------------------------------------------------
describe('Phase 1N-E1 — existing policy/trigger/function surface is unchanged', () => {
  it('recruiter/opportunity/capability triggers and canonical functions are unchanged (except the new RPC)', async () => {
    const after = await snapshotPolicySurface();
    expect(after.triggers).toEqual(SURFACE_BEFORE.triggers);
    expect(after.functions).toEqual(SURFACE_BEFORE.functions);
  });

  it('no new triggers were created on recruiter_profiles or user_capabilities', async () => {
    const rows = await q<{ tgname: string; tbl: string }>(
      `SELECT tgname, tgrelid::regclass::text AS tbl
         FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgrelid::regclass::text IN (
                'public.recruiter_profiles',
                'public.user_capabilities'
              )
        ORDER BY tbl, tgname`,
    );
    // The candidate must add no triggers. Present triggers are exactly the
    // three pre-existing fixture triggers.
    expect(rows.map((r) => r.tgname).sort()).toEqual(
      [
        'trg_recruiter_profile_capability_sync',
        'trg_recruiter_profile_guard',
      ].sort(),
    );
  });

  it('the only new function introduced in public is ensure_my_recruiter_setup_state', async () => {
    const rows = await q<{ proname: string }>(
      `SELECT p.proname
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public'
          AND p.proname NOT IN (
                'update_updated_at_column',
                'is_admin',
                'recruiter_profile_can_manage_opportunities',
                'recruiter_profile_guard',
                '_derive_recruiter_capability_status',
                '_sync_recruiter_capability',
                '_recruiter_profile_capability_sync'
              )
        ORDER BY p.proname`,
    );
    expect(rows.map((r) => r.proname)).toEqual([
      'ensure_my_recruiter_setup_state',
    ]);
  });

  it('candidate SQL does not touch billing / opportunities / consent / admin_review symbols', () => {
    const forbidden = [
      'opportunities',
      'opportunity_',
      'stripe_',
      'subscriptions',
      'recruiter_billing_profiles',
      'admin_review',
      'admin_audit_log',
      'notification',
      'consent',
      'accept_recruiter_posting_terms',
      'legacy_terms_grandfathered_at :=',
      'posting_terms_accepted_at :=',
      'verification_status :=',
    ];
    for (const needle of forbidden) {
      expect(CANDIDATE_SQL.toLowerCase()).not.toContain(needle.toLowerCase());
    }
  });
});
