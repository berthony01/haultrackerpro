/**
 * Phase 1P-A1.1-R1 — Real PostgreSQL 16 gate for the recruiter readiness +
 * company_type + conditional DOT/MC candidate.
 *
 * Reads the exact candidate SQL from disk, bootstraps a minimal faithful
 * pre-candidate schema (roles, auth.uid, recruiter_profiles matching the live
 * column set and column-level UPDATE ACL model), applies the candidate in
 * isolation, and proves the locked contract items 1..21 from the packet.
 *
 * Lives OUTSIDE src/ so the normal jsdom vitest run never picks it up.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL =
  process.env.PHASE1P_A1_DATABASE_URL ?? process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'PHASE1P_A1_DATABASE_URL (or DATABASE_URL) is required for the Phase 1P-A1.1-R1 real-Postgres 16 gate.',
  );
}
const URL_STR: string = DATABASE_URL;

const CANDIDATE_PATH = fileURLToPath(
  new URL(
    '../../supabase/migration-candidates/20260725190000_phase1p_a1_recruiter_readiness_company_type.sql',
    import.meta.url,
  ),
);
const CANDIDATE_SQL = readFileSync(CANDIDATE_PATH, 'utf8');

const CANONICAL_VERSION = '2026-07-17.v1';
const HISTORICAL_VERSION = '2025-legacy.v1';

const NONCARRIER_TYPES = [
  'third_party_recruiter',
  'staffing_agency',
  'independent_recruiter',
] as const;

// Column-level UPDATE grants that authenticated has on the live table before
// the candidate — matches the column-privilege snapshot from production
// (INSERT is table-level, so no per-column INSERT grant is needed).
const PRE_CANDIDATE_UPDATE_COLUMNS = [
  'recruiter_name',
  'recruiter_email',
  'recruiter_phone',
  'company_name',
  'company_website',
  'dot_number',
  'mc_number',
  'company_phone',
  'company_address',
  'company_city',
  'company_state',
  'hiring_states',
  'equipment_types',
  'driver_types_hired',
  'verification_status',
  'status',
  'admin_notes',
  'verified_at',
  'verified_by',
  'updated_at',
];

// Columns that must NOT gain an authenticated UPDATE privilege from the
// candidate application. Explicit denylist for assertion #6.
const PROTECTED_NO_UPDATE_COLUMNS = [
  'id',
  'user_id',
  'created_at',
  'posting_terms_accepted_at',
  'posting_terms_version',
  'legacy_terms_grandfathered_at',
];

const RESET_SQL = `
DROP FUNCTION IF EXISTS public.ensure_my_recruiter_setup_state() CASCADE;
DROP FUNCTION IF EXISTS public.accept_recruiter_posting_terms(text) CASCADE;
DROP FUNCTION IF EXISTS public.current_user_can_manage_recruiter_opportunities(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.recruiter_profile_can_manage_opportunities(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_my_recruiter_profile_safe() CASCADE;
DROP TABLE IF EXISTS public.user_capabilities CASCADE;
DROP TABLE IF EXISTS public.recruiter_profiles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TYPE IF EXISTS public.user_capability_status CASCADE;
DROP TYPE IF EXISTS public.user_capability_type CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
`;

const BOOTSTRAP_SQL = `
DO $$ BEGIN CREATE ROLE anon           NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated  NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role   NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY,
  email              text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON auth.users TO authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.profiles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL UNIQUE,
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO authenticated, service_role;

CREATE TYPE public.user_capability_type   AS ENUM ('driver','recruiter');
CREATE TYPE public.user_capability_status AS ENUM ('setup','active','suspended','revoked');

CREATE TABLE IF NOT EXISTS public.user_capabilities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  capability public.user_capability_type NOT NULL,
  status     public.user_capability_status NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, capability)
);
GRANT SELECT ON public.user_capabilities TO authenticated, service_role;

-- Pre-candidate recruiter_profiles, matching production column set exactly.
-- company_type does NOT exist here; the candidate adds it.
CREATE TABLE IF NOT EXISTS public.recruiter_profiles (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                         uuid NOT NULL UNIQUE,
  recruiter_name                  text NOT NULL,
  recruiter_email                 text,
  recruiter_phone                 text,
  company_name                    text NOT NULL,
  company_website                 text,
  dot_number                      text,
  mc_number                       text,
  company_phone                   text,
  company_address                 text,
  company_city                    text,
  company_state                   text,
  hiring_states                   text[] NOT NULL DEFAULT '{}',
  equipment_types                 text[] NOT NULL DEFAULT '{}',
  driver_types_hired              text[] NOT NULL DEFAULT '{}',
  verification_status             text NOT NULL DEFAULT 'pending',
  status                          text NOT NULL DEFAULT 'active',
  admin_notes                     text,
  verified_at                     timestamptz,
  verified_by                     uuid,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  posting_terms_accepted_at       timestamptz,
  posting_terms_version           text,
  legacy_terms_grandfathered_at   timestamptz
);

-- Live-parity table-level ACL: SELECT/INSERT/DELETE table-level; no UPDATE
-- at table level. Column-level UPDATE only on the non-protected columns.
GRANT SELECT, INSERT, DELETE ON public.recruiter_profiles TO authenticated;
GRANT ALL ON public.recruiter_profiles TO service_role;

DO $grants$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY[
    'recruiter_name','recruiter_email','recruiter_phone','company_name',
    'company_website','dot_number','mc_number','company_phone',
    'company_address','company_city','company_state','hiring_states',
    'equipment_types','driver_types_hired','verification_status','status',
    'admin_notes','verified_at','verified_by','updated_at'
  ] LOOP
    EXECUTE format('GRANT UPDATE (%I) ON public.recruiter_profiles TO authenticated', c);
  END LOOP;
END
$grants$;

ALTER TABLE public.recruiter_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY rp_owner_select ON public.recruiter_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY rp_owner_insert ON public.recruiter_profiles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY rp_owner_update ON public.recruiter_profiles
  FOR UPDATE TO authenticated USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Pre-candidate safe-profile RPC (uses to_jsonb minus admin columns).
CREATE OR REPLACE FUNCTION public.get_my_recruiter_profile_safe()
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT to_jsonb(rp) - 'admin_notes' - 'verified_by'
      FROM public.recruiter_profiles rp
     WHERE rp.user_id = _uid
     LIMIT 1;
END;
$fn$;
REVOKE ALL     ON FUNCTION public.get_my_recruiter_profile_safe() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_recruiter_profile_safe() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_my_recruiter_profile_safe() TO authenticated, service_role;
`;

interface Ctx { pool: pg.Pool; }
let ctx: Ctx;

async function withOwner<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await ctx.pool.connect();
  try { return await fn(c); } finally { c.release(); }
}

async function newAuthClient(userId: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: URL_STR, statement_timeout: 15_000 });
  await c.connect();
  await c.query('BEGIN');
  await c.query('SET LOCAL role authenticated');
  await c.query(`SET LOCAL "request.jwt.claim.sub" = '${userId}'`);
  return c;
}

interface SeedOpts {
  companyType?: string | null;
  dot?: string | null;
  mc?: string | null;
  email?: string | null;
  name?: string;
  company?: string;
  status?: string;
  verification?: string;
}

async function seedUser(): Promise<string> {
  const uid = randomUUID();
  await ctx.pool.query(
    `INSERT INTO auth.users(id, email, raw_user_meta_data)
     VALUES ($1, $2, '{}'::jsonb)`,
    [uid, `u${uid.slice(0, 8)}@example.com`],
  );
  return uid;
}

async function seedProfile(opts: SeedOpts = {}): Promise<{ userId: string; profileId: string }> {
  const userId = await seedUser();
  const {
    companyType = null,
    dot = '123456',
    mc = 'MC-9',
    email = 'rex@acme.example',
    name = 'Rex Recruiter',
    company = 'Acme Freight LLC',
    status = 'active',
    verification = 'pending',
  } = opts;
  const { rows } = await ctx.pool.query(
    `INSERT INTO public.recruiter_profiles
       (user_id, recruiter_name, company_name, recruiter_email,
        dot_number, mc_number, status, verification_status, company_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [userId, name, company, email, dot, mc, status, verification, companyType],
  );
  return { userId, profileId: rows[0].id as string };
}

async function callAccept(
  userId: string,
  version: string | null,
): Promise<{ code: string; detail: string; ts: Date | null }> {
  const c = await newAuthClient(userId);
  try {
    const r = await c.query(
      `SELECT public.accept_recruiter_posting_terms($1) AS ts`,
      [version],
    );
    await c.query('COMMIT');
    return { code: '', detail: '', ts: r.rows[0].ts as Date };
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    const e = err as { code?: string; detail?: string };
    return { code: e.code ?? '', detail: e.detail ?? '', ts: null };
  } finally {
    try { await c.end(); } catch { /* noop */ }
  }
}

function tokens(detail: string): string[] {
  const m = detail.match(/missing_requirements=([^\n]*)/);
  if (!m) return [];
  return m[1].split(',').map((t) => t.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  ctx = { pool: new pg.Pool({ connectionString: URL_STR, max: 8 }) };
  await withOwner(async (c) => {
    await c.query(RESET_SQL);
    await c.query(BOOTSTRAP_SQL);
    // Apply candidate once for the majority of tests. Idempotency test in
    // its own case re-runs against a full reset+bootstrap in its own scope.
    await c.query(CANDIDATE_SQL);
  });
}, 60_000);

afterAll(async () => {
  await withOwner(async (c) => { await c.query(RESET_SQL); }).catch(() => {});
  await ctx?.pool.end();
});

describe('Phase 1P-A1.1-R1 — company_type + conditional DOT/MC candidate', () => {
  // ── Storage ──────────────────────────────────────────────────────────────
  it('1: column exists, nullable, no default; legacy row stays NULL', async () => {
    const { rows: cols } = await ctx.pool.query(
      `SELECT is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='recruiter_profiles'
          AND column_name='company_type'`,
    );
    expect(cols).toHaveLength(1);
    expect(cols[0].is_nullable).toBe('YES');
    expect(cols[0].column_default).toBeNull();

    const { userId } = await seedProfile({ companyType: null });
    const { rows } = await ctx.pool.query(
      `SELECT company_type FROM public.recruiter_profiles WHERE user_id=$1`,
      [userId],
    );
    expect(rows[0].company_type).toBeNull();
  });

  it('3: CHECK accepts exactly the four locked tokens and rejects others', async () => {
    for (const t of ['carrier', ...NONCARRIER_TYPES]) {
      const uid = await seedUser();
      await expect(
        ctx.pool.query(
          `INSERT INTO public.recruiter_profiles
             (user_id, recruiter_name, company_name, recruiter_email, company_type)
           VALUES ($1,'n','c','e@e.co',$2)`,
          [uid, t],
        ),
      ).resolves.toBeDefined();
    }
    const uid = await seedUser();
    let code = '';
    try {
      await ctx.pool.query(
        `INSERT INTO public.recruiter_profiles
           (user_id, recruiter_name, company_name, recruiter_email, company_type)
         VALUES ($1,'n','c','e@e.co','bogus')`,
        [uid],
      );
    } catch (err) { code = (err as { code?: string }).code ?? ''; }
    expect(code).toBe('23514');
  });

  it('4: candidate is idempotent — second application leaves data unchanged', async () => {
    const { profileId } = await seedProfile({ companyType: 'carrier' });
    const before = await ctx.pool.query(
      `SELECT * FROM public.recruiter_profiles WHERE id=$1`,
      [profileId],
    );
    await withOwner(async (c) => { await c.query(CANDIDATE_SQL); });
    const after = await ctx.pool.query(
      `SELECT * FROM public.recruiter_profiles WHERE id=$1`,
      [profileId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  // ── Privileges ───────────────────────────────────────────────────────────
  it('5: authenticated may INSERT and UPDATE company_type on own row', async () => {
    const userId = await seedUser();
    const c = await newAuthClient(userId);
    try {
      const ins = await c.query(
        `INSERT INTO public.recruiter_profiles
           (user_id, recruiter_name, company_name, recruiter_email, company_type)
         VALUES ($1,'n','c','e@e.co','carrier') RETURNING id, company_type`,
        [userId],
      );
      expect(ins.rows[0].company_type).toBe('carrier');
      const upd = await c.query(
        `UPDATE public.recruiter_profiles SET company_type='staffing_agency'
          WHERE user_id=$1 RETURNING company_type`,
        [userId],
      );
      expect(upd.rows[0].company_type).toBe('staffing_agency');
      await c.query('COMMIT');
    } finally {
      try { await c.end(); } catch { /* noop */ }
    }
  });

  it('6: no table-wide UPDATE and no UPDATE on protected columns for authenticated', async () => {
    const { rows: tbl } = await ctx.pool.query(
      `SELECT privilege_type FROM information_schema.table_privileges
        WHERE table_schema='public' AND table_name='recruiter_profiles'
          AND grantee='authenticated'`,
    );
    const tblPrivs = tbl.map((r) => r.privilege_type);
    expect(tblPrivs).not.toContain('UPDATE');

    const { rows: upd } = await ctx.pool.query(
      `SELECT column_name FROM information_schema.column_privileges
        WHERE table_schema='public' AND table_name='recruiter_profiles'
          AND grantee='authenticated' AND privilege_type='UPDATE'`,
    );
    const updCols = new Set(upd.map((r) => r.column_name as string));
    expect(updCols.has('company_type')).toBe(true);
    for (const c of PROTECTED_NO_UPDATE_COLUMNS) {
      expect(updCols.has(c)).toBe(false);
    }
    // Anon and PUBLIC must not have UPDATE anywhere on the table.
    const { rows: anon } = await ctx.pool.query(
      `SELECT 1 FROM information_schema.column_privileges
        WHERE table_schema='public' AND table_name='recruiter_profiles'
          AND grantee IN ('anon','PUBLIC') AND privilege_type='UPDATE'`,
    );
    expect(anon).toHaveLength(0);
  });

  // ── Terms RPC: carrier vs non-carrier ────────────────────────────────────
  it('7: carrier missing DOT/MC fails 22023 with dot_or_mc token', async () => {
    const { userId } = await seedProfile({ companyType: 'carrier', dot: null, mc: null });
    const r = await callAccept(userId, CANONICAL_VERSION);
    expect(r.code).toBe('22023');
    expect(tokens(r.detail)).toEqual(['dot_or_mc']);
  });

  it('8: carrier with DOT or MC succeeds', async () => {
    for (const which of ['dot', 'mc'] as const) {
      const { userId } = await seedProfile({
        companyType: 'carrier',
        dot: which === 'dot' ? '111' : null,
        mc:  which === 'mc'  ? 'MC-1' : null,
      });
      const r = await callAccept(userId, CANONICAL_VERSION);
      expect(r.code).toBe('');
      expect(r.ts).toBeInstanceOf(Date);
    }
  });

  it('9: each non-carrier company_type succeeds without DOT/MC', async () => {
    for (const t of NONCARRIER_TYPES) {
      const { userId } = await seedProfile({ companyType: t, dot: null, mc: null });
      const r = await callAccept(userId, CANONICAL_VERSION);
      expect(r.code).toBe('');
      expect(r.ts).toBeInstanceOf(Date);
    }
  });

  it('10: NULL company_type fails with company_type token', async () => {
    const { userId } = await seedProfile({ companyType: null });
    const r = await callAccept(userId, CANONICAL_VERSION);
    expect(r.code).toBe('22023');
    expect(tokens(r.detail)).toContain('company_type');
  });

  it('11: missing vs invalid email produce distinct tokens', async () => {
    const missing = await seedProfile({ companyType: 'staffing_agency', email: '' });
    const rm = await callAccept(missing.userId, CANONICAL_VERSION);
    expect(rm.code).toBe('22023');
    expect(tokens(rm.detail)).toContain('recruiter_email_missing');
    expect(tokens(rm.detail)).not.toContain('recruiter_email_invalid');

    const invalid = await seedProfile({ companyType: 'staffing_agency', email: 'not-an-email' });
    const ri = await callAccept(invalid.userId, CANONICAL_VERSION);
    expect(ri.code).toBe('22023');
    expect(tokens(ri.detail)).toContain('recruiter_email_invalid');
    expect(tokens(ri.detail)).not.toContain('recruiter_email_missing');
  });

  it('12: multiple missing tokens preserve exact contract order', async () => {
    const userId = await seedUser();
    await ctx.pool.query(
      `INSERT INTO public.recruiter_profiles
         (user_id, recruiter_name, company_name, recruiter_email, dot_number, mc_number, company_type)
       VALUES ($1, '', '', '', NULL, NULL, NULL)`,
      [userId],
    );
    const r = await callAccept(userId, CANONICAL_VERSION);
    expect(r.code).toBe('22023');
    expect(tokens(r.detail)).toEqual([
      'recruiter_name',
      'company_name',
      'recruiter_email_missing',
      'company_type',
    ]);

    // Now with carrier + missing DOT/MC to observe dot_or_mc appended last.
    await ctx.pool.query(
      `UPDATE public.recruiter_profiles SET company_type='carrier' WHERE user_id=$1`,
      [userId],
    );
    const r2 = await callAccept(userId, CANONICAL_VERSION);
    expect(r2.code).toBe('22023');
    expect(tokens(r2.detail)).toEqual([
      'recruiter_name',
      'company_name',
      'recruiter_email_missing',
      'dot_or_mc',
    ]);
  });

  // ── Terms RPC: consent integrity (preserved invariants) ─────────────────
  it('13: same-version retry returns the identical original timestamp', async () => {
    const { userId, profileId } = await seedProfile({ companyType: 'independent_recruiter', dot: null, mc: null });
    const r1 = await callAccept(userId, CANONICAL_VERSION);
    const r2 = await callAccept(userId, CANONICAL_VERSION);
    expect(r1.ts && r2.ts && (r1.ts as Date).toISOString()).toBe(
      (r2.ts as Date).toISOString(),
    );
    const { rows } = await ctx.pool.query(
      `SELECT posting_terms_version AS v FROM public.recruiter_profiles WHERE id=$1`,
      [profileId],
    );
    expect(rows[0].v).toBe(CANONICAL_VERSION);
  });

  it('14: malformed consent pair (ts present, version NULL) rejected unchanged', async () => {
    const { userId, profileId } = await seedProfile({ companyType: 'staffing_agency', dot: null, mc: null });
    const stamped = new Date('2024-05-06T07:08:09.000Z');
    await ctx.pool.query(
      `UPDATE public.recruiter_profiles
          SET posting_terms_accepted_at=$1, posting_terms_version=NULL
        WHERE id=$2`,
      [stamped, profileId],
    );
    const r = await callAccept(userId, CANONICAL_VERSION);
    expect(r.code).toBe('22023');
    const { rows } = await ctx.pool.query(
      `SELECT posting_terms_accepted_at AS at, posting_terms_version AS v
         FROM public.recruiter_profiles WHERE id=$1`,
      [profileId],
    );
    expect((rows[0].at as Date).toISOString()).toBe(stamped.toISOString());
    expect(rows[0].v).toBeNull();
  });

  it('15: historical-version mismatch rejected and unchanged', async () => {
    const { userId, profileId } = await seedProfile({ companyType: 'staffing_agency', dot: null, mc: null });
    const stamped = new Date('2025-01-02T03:04:05.000Z');
    await ctx.pool.query(
      `UPDATE public.recruiter_profiles
          SET posting_terms_accepted_at=$1, posting_terms_version=$2
        WHERE id=$3`,
      [stamped, HISTORICAL_VERSION, profileId],
    );
    const r = await callAccept(userId, CANONICAL_VERSION);
    expect(r.code).toBe('22023');
    const { rows } = await ctx.pool.query(
      `SELECT posting_terms_accepted_at AS at, posting_terms_version AS v
         FROM public.recruiter_profiles WHERE id=$1`,
      [profileId],
    );
    expect((rows[0].at as Date).toISOString()).toBe(stamped.toISOString());
    expect(rows[0].v).toBe(HISTORICAL_VERSION);
  });

  it('16: suspension is rejected with 42501', async () => {
    for (const col of ['status', 'verification_status'] as const) {
      const { userId } = await seedProfile({ companyType: 'staffing_agency', dot: null, mc: null });
      await ctx.pool.query(
        `UPDATE public.recruiter_profiles SET ${col}='suspended' WHERE user_id=$1`,
        [userId],
      );
      const r = await callAccept(userId, CANONICAL_VERSION);
      expect(r.code).toBe('42501');
    }
  });

  // ── Eligibility helpers ─────────────────────────────────────────────────
  it('17: both eligibility helpers mirror conditional DOT/MC and ownership', async () => {
    // carrier missing DOT/MC → false in both helpers
    const carrierBad = await seedProfile({ companyType: 'carrier', dot: null, mc: null });
    await ctx.pool.query(
      `UPDATE public.recruiter_profiles
          SET posting_terms_accepted_at=now(), posting_terms_version=$1
        WHERE id=$2`,
      [CANONICAL_VERSION, carrierBad.profileId],
    );
    let r = await ctx.pool.query(
      `SELECT public.recruiter_profile_can_manage_opportunities($1) AS ok`,
      [carrierBad.profileId],
    );
    expect(r.rows[0].ok).toBe(false);

    // carrier with DOT → true in both, but current_user_ helper needs auth.uid
    const carrierGood = await seedProfile({ companyType: 'carrier', dot: '1', mc: null });
    await ctx.pool.query(
      `UPDATE public.recruiter_profiles
          SET posting_terms_accepted_at=now(), posting_terms_version=$1
        WHERE id=$2`,
      [CANONICAL_VERSION, carrierGood.profileId],
    );
    r = await ctx.pool.query(
      `SELECT public.recruiter_profile_can_manage_opportunities($1) AS ok`,
      [carrierGood.profileId],
    );
    expect(r.rows[0].ok).toBe(true);

    // current_user_ helper: another auth.uid returns false
    const other = await seedUser();
    const c = await newAuthClient(other);
    try {
      const rr = await c.query(
        `SELECT public.current_user_can_manage_recruiter_opportunities($1) AS ok`,
        [carrierGood.profileId],
      );
      await c.query('COMMIT');
      expect(rr.rows[0].ok).toBe(false);
    } finally { try { await c.end(); } catch { /* noop */ } }

    // owning caller returns true
    const cOwn = await newAuthClient(carrierGood.userId);
    try {
      const rr = await cOwn.query(
        `SELECT public.current_user_can_manage_recruiter_opportunities($1) AS ok`,
        [carrierGood.profileId],
      );
      await cOwn.query('COMMIT');
      expect(rr.rows[0].ok).toBe(true);
    } finally { try { await cOwn.end(); } catch { /* noop */ } }

    // non-carrier with no DOT/MC → true (once consent stamped)
    const nc = await seedProfile({ companyType: 'independent_recruiter', dot: null, mc: null });
    await ctx.pool.query(
      `UPDATE public.recruiter_profiles
          SET posting_terms_accepted_at=now(), posting_terms_version=$1
        WHERE id=$2`,
      [CANONICAL_VERSION, nc.profileId],
    );
    r = await ctx.pool.query(
      `SELECT public.recruiter_profile_can_manage_opportunities($1) AS ok`,
      [nc.profileId],
    );
    expect(r.rows[0].ok).toBe(true);
  });

  // ── Self-heal RPC ────────────────────────────────────────────────────────
  it('18: self-heal missing tokens use locked vocabulary/order and never write company_type', async () => {
    const userId = await seedUser();
    await ctx.pool.query(
      `INSERT INTO public.user_capabilities(user_id, capability, status)
       VALUES ($1, 'recruiter', 'setup')`,
      [userId],
    );
    await ctx.pool.query(
      `INSERT INTO public.recruiter_profiles
         (user_id, recruiter_name, company_name, recruiter_email, dot_number, mc_number, company_type)
       VALUES ($1, '', '', 'bogus', NULL, NULL, NULL)`,
      [userId],
    );
    const c = await newAuthClient(userId);
    try {
      const r = await c.query(`SELECT * FROM public.ensure_my_recruiter_setup_state()`);
      await c.query('COMMIT');
      const row = r.rows[0];
      expect(row.missing_requirements).toEqual([
        'recruiter_name',
        'company_name',
        'recruiter_email_invalid',
        'company_type',
        'posting_terms',
      ]);
    } finally { try { await c.end(); } catch { /* noop */ } }

    // Now flip to carrier; dot_or_mc must appear before posting_terms.
    await ctx.pool.query(
      `UPDATE public.recruiter_profiles SET company_type='carrier' WHERE user_id=$1`,
      [userId],
    );
    const c2 = await newAuthClient(userId);
    try {
      const r = await c2.query(`SELECT * FROM public.ensure_my_recruiter_setup_state()`);
      await c2.query('COMMIT');
      expect(r.rows[0].missing_requirements).toEqual([
        'recruiter_name',
        'company_name',
        'recruiter_email_invalid',
        'dot_or_mc',
        'posting_terms',
      ]);
    } finally { try { await c2.end(); } catch { /* noop */ } }

    // company_type is never written by self-heal: verify NULL when unset
    const userId2 = await seedUser();
    await ctx.pool.query(
      `INSERT INTO public.user_capabilities(user_id, capability, status)
       VALUES ($1, 'recruiter', 'setup')`,
      [userId2],
    );
    const c3 = await newAuthClient(userId2);
    try {
      await c3.query(`SELECT * FROM public.ensure_my_recruiter_setup_state()`);
      await c3.query('COMMIT');
    } finally { try { await c3.end(); } catch { /* noop */ } }
    const { rows } = await ctx.pool.query(
      `SELECT company_type FROM public.recruiter_profiles WHERE user_id=$1`,
      [userId2],
    );
    expect(rows[0]?.company_type ?? null).toBeNull();
  });

  // ── Safe-profile RPC ────────────────────────────────────────────────────
  it('19: safe-profile result includes company_type and omits moderation columns', async () => {
    const { userId } = await seedProfile({ companyType: 'staffing_agency', dot: null, mc: null });
    const c = await newAuthClient(userId);
    try {
      const r = await c.query(`SELECT * FROM public.get_my_recruiter_profile_safe() AS j`);
      await c.query('COMMIT');
      const j = r.rows[0].j as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(j, 'company_type')).toBe(true);
      expect(j.company_type).toBe('staffing_agency');
      expect(Object.prototype.hasOwnProperty.call(j, 'admin_notes')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(j, 'verified_by')).toBe(false);
    } finally { try { await c.end(); } catch { /* noop */ } }
  });

  // ── Scope safety ────────────────────────────────────────────────────────
  it('20: candidate application performs no consent/opportunity/verification mutation', async () => {
    const { profileId } = await seedProfile({ companyType: null, dot: null, mc: null });
    await ctx.pool.query(
      `UPDATE public.recruiter_profiles
          SET verification_status='verified',
              posting_terms_accepted_at=NULL,
              posting_terms_version=NULL,
              legacy_terms_grandfathered_at=NULL
        WHERE id=$1`,
      [profileId],
    );
    const before = await ctx.pool.query(
      `SELECT verification_status, posting_terms_accepted_at, posting_terms_version,
              legacy_terms_grandfathered_at, company_type
         FROM public.recruiter_profiles WHERE id=$1`,
      [profileId],
    );
    await withOwner(async (c) => { await c.query(CANDIDATE_SQL); });
    const after = await ctx.pool.query(
      `SELECT verification_status, posting_terms_accepted_at, posting_terms_version,
              legacy_terms_grandfathered_at, company_type
         FROM public.recruiter_profiles WHERE id=$1`,
      [profileId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('21: SECURITY DEFINER + search_path + EXECUTE grants match the locked contract', async () => {
    const { rows } = await ctx.pool.query(
      `SELECT p.proname,
              p.prosecdef,
              pg_get_function_identity_arguments(p.oid) AS args,
              (SELECT array_agg(cfg) FROM unnest(coalesce(p.proconfig,'{}')) cfg) AS cfg,
              (SELECT array_agg(DISTINCT g.grantee)
                 FROM aclexplode(coalesce(p.proacl,
                        acldefault('f', p.proowner))) g
                WHERE g.privilege_type='EXECUTE'
              )::text[] AS grantee_oids
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public'
          AND p.proname IN (
            'accept_recruiter_posting_terms',
            'ensure_my_recruiter_setup_state',
            'recruiter_profile_can_manage_opportunities',
            'current_user_can_manage_recruiter_opportunities'
          )`,
    );
    // Resolve grantee OIDs → role names; 0 means PUBLIC.
    const roleMap = new Map<string, string>();
    const rr = await ctx.pool.query(
      `SELECT oid::text AS oid, rolname FROM pg_roles`,
    );
    for (const r of rr.rows) roleMap.set(r.oid as string, r.rolname as string);
    roleMap.set('0', 'PUBLIC');

    const byName: Record<string, {
      prosecdef: boolean;
      cfg: string[];
      grantees: Set<string>;
    }> = {};
    for (const rec of rows) {
      const oids = (rec.grantee_oids as string[] | null) ?? [];
      const grantees = new Set<string>();
      for (const o of oids) {
        const name = roleMap.get(String(o));
        if (name) grantees.add(name);
      }
      byName[rec.proname as string] = {
        prosecdef: rec.prosecdef as boolean,
        cfg: (rec.cfg as string[] | null) ?? [],
        grantees,
      };
    }
    for (const name of [
      'accept_recruiter_posting_terms',
      'ensure_my_recruiter_setup_state',
      'recruiter_profile_can_manage_opportunities',
      'current_user_can_manage_recruiter_opportunities',
    ]) {
      const rec = byName[name];
      expect(rec).toBeDefined();
      expect(rec.prosecdef).toBe(true);
      expect(rec.cfg).toContain('search_path=public');
    }

    // accept + ensure: authenticated + service_role EXECUTE, no anon/PUBLIC
    for (const name of [
      'accept_recruiter_posting_terms',
      'ensure_my_recruiter_setup_state',
    ]) {
      const grantees = byName[name].grantees;
      expect(grantees.has('authenticated')).toBe(true);
      expect(grantees.has('service_role')).toBe(true);
      expect(grantees.has('anon')).toBe(false);
      expect(grantees.has('PUBLIC')).toBe(false);
    }

    // profile-scoped eligibility helper: service_role only.
    {
      const grantees = byName['recruiter_profile_can_manage_opportunities'].grantees;
      expect(grantees.has('service_role')).toBe(true);
      expect(grantees.has('authenticated')).toBe(false);
      expect(grantees.has('anon')).toBe(false);
      expect(grantees.has('PUBLIC')).toBe(false);
    }

    // current-user eligibility helper: authenticated + service_role only.
    {
      const grantees = byName['current_user_can_manage_recruiter_opportunities'].grantees;
      expect(grantees.has('authenticated')).toBe(true);
      expect(grantees.has('service_role')).toBe(true);
      expect(grantees.has('anon')).toBe(false);
      expect(grantees.has('PUBLIC')).toBe(false);
    }

    // Both eligibility helpers must retain exactly one uuid argument.
    const sigRows = await ctx.pool.query(
      `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public'
          AND p.proname IN (
            'recruiter_profile_can_manage_opportunities',
            'current_user_can_manage_recruiter_opportunities'
          )`,
    );
    const sigByName: Record<string, string> = {};
    for (const r of sigRows.rows) {
      sigByName[r.proname as string] = (r.args as string).trim();
    }
    for (const name of [
      'recruiter_profile_can_manage_opportunities',
      'current_user_can_manage_recruiter_opportunities',
    ]) {
      // Signature is `_recruiter_id uuid` — one uuid parameter.
      expect(sigByName[name]).toMatch(/^_recruiter_id\s+uuid$/);
    }
  });
});

