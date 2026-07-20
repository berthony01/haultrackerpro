/**
 * Phase 1J-D2B-2 — Real PostgreSQL 16 gate for recruiter contract-workflow
 * RLS tightening.
 *
 * Bootstraps a schema-faithful fixture (auth surface, three contract tables,
 * eleven canonical pre-D2B-2 policies, D2B-1 resolver functions) against a
 * real PostgreSQL 16 database, then applies the D2B-2 ALTER POLICY candidate
 * and proves entitlement, ownership, downgrade, and non-target role behavior
 * end-to-end.
 *
 * Lives OUTSIDE `src/` so the default `bunx vitest run` never picks it up.
 * Runs only via `vitest.phase1j-d2b2-recruiter-contract-rls-postgres.config.ts`.
 *
 * NEVER SKIPS. Fails hard if PHASE1J_D2B2_DATABASE_URL is absent.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.PHASE1J_D2B2_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'PHASE1J_D2B2_DATABASE_URL is required for the Phase 1J-D2B-2 real-Postgres 16 gate.',
  );
}
const URL_STR: string = DATABASE_URL;

const D2B1_PATH = fileURLToPath(
  new URL(
    '../../supabase/migration-candidates/20260720203000_phase1j_d2b1_recruiter_paid_entitlement_resolver.sql',
    import.meta.url,
  ),
);
const D2B2_PATH = fileURLToPath(
  new URL(
    '../../supabase/migration-candidates/20260720214500_phase1j_d2b2_recruiter_contract_workflow_rls.sql',
    import.meta.url,
  ),
);
const CANONICAL_BILLING_PATH = fileURLToPath(
  new URL(
    '../../supabase/migrations/20260513052701_cf07b84d-9518-4159-8771-b2b353578e54.sql',
    import.meta.url,
  ),
);

function extractBillingTableBlock(): string {
  const src = readFileSync(CANONICAL_BILLING_PATH, 'utf8');
  const startMarker = 'CREATE TABLE IF NOT EXISTS public.recruiter_billing_profiles (';
  const endMarker =
    'ALTER TABLE public.recruiter_billing_profiles ENABLE ROW LEVEL SECURITY;';
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error('canonical billing: start marker not found');
  const endIdx = src.indexOf(endMarker, start);
  if (endIdx < 0) throw new Error('canonical billing: end marker not found');
  return src.slice(start, endIdx);
}

// ---------------------------------------------------------------------------
// Reset: drop all fixture objects and roles; safe pre-bootstrap.
// ---------------------------------------------------------------------------
const RESET_SQL = `
DROP FUNCTION IF EXISTS public.current_user_has_recruiter_minimum_paid_plan(text) CASCADE;
DROP FUNCTION IF EXISTS public._recruiter_has_minimum_paid_plan(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public._recruiter_paid_plan_rank(text) CASCADE;
DROP FUNCTION IF EXISTS public.is_recruiter_owner(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.is_admin(uuid) CASCADE;
DROP TABLE IF EXISTS public.contract_reviews CASCADE;
DROP TABLE IF EXISTS public.contract_versions CASCADE;
DROP TABLE IF EXISTS public.contracts CASCADE;
DROP TABLE IF EXISTS public.opportunity_applications CASCADE;
DROP TABLE IF EXISTS public.admin_users CASCADE;
DROP TABLE IF EXISTS public.recruiter_billing_profiles CASCADE;
DROP TABLE IF EXISTS public.recruiter_profiles CASCADE;
DROP TABLE IF EXISTS auth.users CASCADE;
DROP FUNCTION IF EXISTS auth.uid() CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;

DO $reset$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      BEGIN EXECUTE format('REVOKE %I FROM CURRENT_USER', r); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN EXECUTE format('REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM %I', r); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', r); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN EXECUTE format('DROP ROLE %I', r); EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END LOOP;
END
$reset$;
`;

// ---------------------------------------------------------------------------
// Bootstrap: fixture roles, auth surface, recruiter/admin lookup tables.
// Contract tables + is_recruiter_owner / is_admin created below in code so we
// can interleave the canonical billing block extraction cleanly.
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

CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.users TO service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
`;

// Additional fixture DDL (contract tables + helper fns + grants + RLS + policies).
const CONTRACT_TABLES_SQL = `
CREATE TABLE public.opportunity_applications (
  id uuid PRIMARY KEY,
  recruiter_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  driver_user_id uuid NOT NULL
);

CREATE TABLE public.contracts (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  recruiter_id uuid NOT NULL,
  recruiter_user_id uuid NOT NULL,
  driver_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft'
);

CREATE TABLE public.contract_versions (
  id uuid PRIMARY KEY,
  contract_id uuid NOT NULL,
  uploaded_by uuid NOT NULL,
  version_number integer NOT NULL DEFAULT 1
);

CREATE TABLE public.contract_reviews (
  id uuid PRIMARY KEY,
  contract_id uuid NOT NULL,
  reviewer_user_id uuid NOT NULL,
  reviewer_role text NOT NULL,
  comments text
);
`;

const HELPER_FNS_SQL = `
CREATE OR REPLACE FUNCTION public.is_recruiter_owner(_user uuid, _recruiter uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter AND rp.user_id = _user
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_recruiter_owner(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_recruiter_owner(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_admin(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = _user);
$$;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;
`;

const GRANTS_RLS_SQL = `
GRANT SELECT ON public.opportunity_applications TO authenticated;
GRANT ALL ON public.opportunity_applications TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.contracts TO authenticated;
GRANT ALL ON public.contracts TO service_role;

GRANT SELECT, INSERT ON public.contract_versions TO authenticated;
GRANT ALL ON public.contract_versions TO service_role;

GRANT SELECT, INSERT ON public.contract_reviews TO authenticated;
GRANT ALL ON public.contract_reviews TO service_role;

GRANT ALL ON public.recruiter_profiles TO service_role;
GRANT ALL ON public.admin_users TO service_role;
GRANT ALL ON public.recruiter_billing_profiles TO service_role;

ALTER TABLE public.contracts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_reviews  ENABLE ROW LEVEL SECURITY;
`;

// Eleven canonical pre-D2B-2 policies copied verbatim (predicates only) from
// supabase/migrations/20260514222629_58cef2ca-5b00-4ad4-a973-0ab6eb7e7b10.sql.
const POLICIES_SQL = `
-- contracts SELECT
CREATE POLICY "Driver views own contracts"
  ON public.contracts FOR SELECT TO authenticated
  USING (auth.uid() = driver_user_id);

CREATE POLICY "Recruiter views own contracts"
  ON public.contracts FOR SELECT TO authenticated
  USING (public.is_recruiter_owner(auth.uid(), recruiter_id));

CREATE POLICY "Admins view all contracts"
  ON public.contracts FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- contracts writes
CREATE POLICY "Recruiter inserts contracts on own applications"
  ON public.contracts FOR INSERT TO authenticated
  WITH CHECK (
    public.is_recruiter_owner(auth.uid(), recruiter_id)
    AND auth.uid() = recruiter_user_id
    AND EXISTS (
      SELECT 1 FROM public.opportunity_applications oa
      WHERE oa.id = application_id
        AND oa.recruiter_id = contracts.recruiter_id
        AND oa.opportunity_id = contracts.opportunity_id
        AND oa.driver_user_id = contracts.driver_user_id
    )
  );

CREATE POLICY "Recruiter updates own contracts"
  ON public.contracts FOR UPDATE TO authenticated
  USING (public.is_recruiter_owner(auth.uid(), recruiter_id))
  WITH CHECK (public.is_recruiter_owner(auth.uid(), recruiter_id));

CREATE POLICY "Driver updates review status on own contracts"
  ON public.contracts FOR UPDATE TO authenticated
  USING (auth.uid() = driver_user_id)
  WITH CHECK (auth.uid() = driver_user_id);

CREATE POLICY "Admins update all contracts"
  ON public.contracts FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- versions
CREATE POLICY "Parties view contract versions"
  ON public.contract_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_versions.contract_id
        AND (
          c.driver_user_id = auth.uid()
          OR public.is_recruiter_owner(auth.uid(), c.recruiter_id)
          OR public.is_admin(auth.uid())
        )
    )
  );

CREATE POLICY "Recruiter inserts versions on own contracts"
  ON public.contract_versions FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_versions.contract_id
        AND public.is_recruiter_owner(auth.uid(), c.recruiter_id)
    )
  );

-- reviews
CREATE POLICY "Driver inserts own review"
  ON public.contract_reviews FOR INSERT TO authenticated
  WITH CHECK (
    reviewer_user_id = auth.uid()
    AND reviewer_role = 'driver'
    AND EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_reviews.contract_id
        AND c.driver_user_id = auth.uid()
    )
  );

CREATE POLICY "Recruiter inserts own review"
  ON public.contract_reviews FOR INSERT TO authenticated
  WITH CHECK (
    reviewer_user_id = auth.uid()
    AND reviewer_role = 'recruiter'
    AND EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_reviews.contract_id
        AND public.is_recruiter_owner(auth.uid(), c.recruiter_id)
    )
  );
`;

// ---------------------------------------------------------------------------
// Pool + helpers
// ---------------------------------------------------------------------------
const pool = new pg.Pool({ connectionString: URL_STR, max: 8 });

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

async function asAuthenticated<T>(
  userId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL role authenticated`);
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

async function asServiceRole<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL role service_role`);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

interface PgError extends Error { code?: string }

async function expectRlsReject(
  userId: string,
  sql: string,
  params: unknown[],
): Promise<void> {
  let err: PgError | undefined;
  try {
    await asAuthenticated(userId, async (c) => { await c.query(sql, params); });
  } catch (e) {
    err = e as PgError;
  }
  expect(err, 'expected RLS rejection but statement succeeded').toBeDefined();
  expect(err!.code).toBe('42501');
  expect(String(err!.message).toLowerCase()).toContain('row-level security');
}

// Seed helpers (owner connection; bypasses RLS as superuser).
async function createUser(): Promise<string> {
  const id = randomUUID();
  await q(`INSERT INTO auth.users(id,email) VALUES ($1,$2)`, [id, `${id}@t.test`]);
  return id;
}
async function createRecruiter(userId: string): Promise<string> {
  const r = await q<{ id: string }>(
    `INSERT INTO public.recruiter_profiles(user_id) VALUES ($1) RETURNING id`,
    [userId],
  );
  return r[0].id;
}
async function createAdmin(): Promise<string> {
  const uid = await createUser();
  await q(`INSERT INTO public.admin_users(user_id) VALUES ($1)`, [uid]);
  return uid;
}
async function insertBilling(recruiterId: string, userId: string, plan: string, status: string) {
  await q(
    `INSERT INTO public.recruiter_billing_profiles(recruiter_id,user_id,plan,status)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (recruiter_id) DO UPDATE SET plan=EXCLUDED.plan, status=EXCLUDED.status`,
    [recruiterId, userId, plan, status],
  );
}
async function seedRecruiterWithBilling(plan: string, status: string) {
  const uid = await createUser();
  const rid = await createRecruiter(uid);
  await insertBilling(rid, uid, plan, status);
  return { uid, rid };
}
async function seedRecruiterNoBilling() {
  const uid = await createUser();
  const rid = await createRecruiter(uid);
  return { uid, rid };
}
async function seedApplication(recruiterId: string, driverUserId: string) {
  const appId = randomUUID();
  const oppId = randomUUID();
  await q(
    `INSERT INTO public.opportunity_applications(id,recruiter_id,opportunity_id,driver_user_id)
     VALUES ($1,$2,$3,$4)`,
    [appId, recruiterId, oppId, driverUserId],
  );
  return { appId, oppId };
}
async function seedContractOwner(
  recruiterUid: string, recruiterId: string, driverUid: string,
): Promise<{ cid: string; appId: string; oppId: string }> {
  const { appId, oppId } = await seedApplication(recruiterId, driverUid);
  const cid = randomUUID();
  await q(
    `INSERT INTO public.contracts(id,application_id,opportunity_id,recruiter_id,recruiter_user_id,driver_user_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [cid, appId, oppId, recruiterId, recruiterUid, driverUid],
  );
  return { cid, appId, oppId };
}

// Full authorized-writes proof helper (all four surfaces).
async function expectAllRecruiterWritesAllowed(
  recruiterUid: string, recruiterId: string, driverUid: string,
) {
  // (1) contract insert
  const { appId, oppId } = await seedApplication(recruiterId, driverUid);
  const cid = randomUUID();
  await asAuthenticated(recruiterUid, async (c) => {
    await c.query(
      `INSERT INTO public.contracts(id,application_id,opportunity_id,recruiter_id,recruiter_user_id,driver_user_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [cid, appId, oppId, recruiterId, recruiterUid, driverUid],
    );
  });
  expect((await q(`SELECT id FROM public.contracts WHERE id=$1`, [cid])).length).toBe(1);

  // (2) contract update
  const updRows = await asAuthenticated(recruiterUid, async (c) => {
    const r = await c.query(
      `UPDATE public.contracts SET status='sent' WHERE id=$1`,
      [cid],
    );
    return r.rowCount ?? 0;
  });
  expect(updRows).toBe(1);
  const persisted = await q<{ status: string }>(
    `SELECT status FROM public.contracts WHERE id=$1`, [cid],
  );
  expect(persisted[0].status).toBe('sent');

  // (3) version insert
  const vid = randomUUID();
  await asAuthenticated(recruiterUid, async (c) => {
    await c.query(
      `INSERT INTO public.contract_versions(id,contract_id,uploaded_by,version_number)
       VALUES ($1,$2,$3,1)`,
      [vid, cid, recruiterUid],
    );
  });
  expect((await q(`SELECT id FROM public.contract_versions WHERE id=$1`, [vid])).length).toBe(1);

  // (4) recruiter-review insert
  const rvid = randomUUID();
  await asAuthenticated(recruiterUid, async (c) => {
    await c.query(
      `INSERT INTO public.contract_reviews(id,contract_id,reviewer_user_id,reviewer_role,comments)
       VALUES ($1,$2,$3,'recruiter','ok')`,
      [rvid, cid, recruiterUid],
    );
  });
  expect((await q(`SELECT id FROM public.contract_reviews WHERE id=$1`, [rvid])).length).toBe(1);

  return { cid, appId, oppId, vid, rvid };
}

// Full denial proof helper (all four surfaces; each rejection in its own tx).
async function expectAllRecruiterWritesDenied(
  recruiterUid: string, recruiterId: string, driverUid: string,
) {
  // Seed an existing contract via owner so the UPDATE has a live target row.
  const { cid } = await seedContractOwner(recruiterUid, recruiterId, driverUid);

  // (1) contract insert → strict RLS reject
  const { appId: appId2, oppId: oppId2 } = await seedApplication(recruiterId, driverUid);
  await expectRlsReject(
    recruiterUid,
    `INSERT INTO public.contracts(id,application_id,opportunity_id,recruiter_id,recruiter_user_id,driver_user_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), appId2, oppId2, recruiterId, recruiterUid, driverUid],
  );

  // (2) contract update → rowCount 0 (RLS filters the target row invisibly)
  const upd = await asAuthenticated(recruiterUid, async (c) => {
    const r = await c.query(
      `UPDATE public.contracts SET status='sent' WHERE id=$1`, [cid],
    );
    return r.rowCount ?? 0;
  });
  expect(upd).toBe(0);
  expect(
    (await q<{ status: string }>(`SELECT status FROM public.contracts WHERE id=$1`, [cid]))[0].status,
  ).toBe('draft');

  // (3) version insert → strict RLS reject
  await expectRlsReject(
    recruiterUid,
    `INSERT INTO public.contract_versions(id,contract_id,uploaded_by,version_number)
     VALUES ($1,$2,$3,1)`,
    [randomUUID(), cid, recruiterUid],
  );

  // (4) recruiter-review insert → strict RLS reject
  await expectRlsReject(
    recruiterUid,
    `INSERT INTO public.contract_reviews(id,contract_id,reviewer_user_id,reviewer_role)
     VALUES ($1,$2,$3,'recruiter')`,
    [randomUUID(), cid, recruiterUid],
  );
}

// ---------------------------------------------------------------------------
// Setup / snapshots
// ---------------------------------------------------------------------------
let MIGRATION_OWNER = '';
let CANONICAL_BLOCK = '';
let D2B1_SQL = '';
let D2B2_SQL = '';

let PRE_FN = 0, PRE_TABLE = 0, PRE_POLICY = 0, PRE_TRIGGER = 0;
let POST_FN = 0, POST_TABLE = 0, POST_POLICY = 0, POST_TRIGGER = 0;

interface PolicyRow {
  policyname: string; tablename: string; cmd: string;
  roles: string[]; qual: string | null; with_check: string | null;
}
let POLICIES_PRE: PolicyRow[] = [];
let POLICIES_POST: PolicyRow[] = [];

async function countPublicFns(): Promise<number> {
  const r = await q<{ c: string }>(
    `SELECT count(*)::int AS c FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`,
  );
  return Number(r[0].c);
}
async function countPublicTables(): Promise<number> {
  const r = await q<{ c: string }>(
    `SELECT count(*)::int AS c FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'`,
  );
  return Number(r[0].c);
}
async function countPolicies(): Promise<number> {
  const r = await q<{ c: string }>(
    `SELECT count(*)::int AS c FROM pg_policies WHERE schemaname='public'`,
  );
  return Number(r[0].c);
}
async function countUserTriggers(): Promise<number> {
  const r = await q<{ c: string }>(
    `SELECT count(*)::int AS c FROM pg_trigger t
       JOIN pg_class c ON c.oid=t.tgrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal`,
  );
  return Number(r[0].c);
}
async function snapshotPolicies(): Promise<PolicyRow[]> {
  return await q<PolicyRow>(
    `SELECT policyname, tablename, cmd, roles::text[] AS roles, qual, with_check
       FROM pg_policies
      WHERE schemaname='public'
      ORDER BY tablename, policyname`,
  );
}

beforeAll(async () => {
  await pool.query(RESET_SQL);
  await pool.query(BOOTSTRAP_SQL);

  CANONICAL_BLOCK = extractBillingTableBlock();
  await pool.query(CANONICAL_BLOCK);

  await pool.query(CONTRACT_TABLES_SQL);
  await pool.query(HELPER_FNS_SQL);
  await pool.query(GRANTS_RLS_SQL);
  await pool.query(POLICIES_SQL);

  const ownerRow = await q<{ u: string }>(`SELECT current_user AS u`);
  MIGRATION_OWNER = ownerRow[0].u;

  // Apply D2B-1 (three functions) BEFORE snapshotting counts, so the
  // pre-D2B-2 snapshot represents the state D2B-2 is about to mutate.
  D2B1_SQL = readFileSync(D2B1_PATH, 'utf8');
  await pool.query(D2B1_SQL);

  PRE_FN = await countPublicFns();
  PRE_TABLE = await countPublicTables();
  PRE_POLICY = await countPolicies();
  PRE_TRIGGER = await countUserTriggers();
  POLICIES_PRE = await snapshotPolicies();

  D2B2_SQL = readFileSync(D2B2_PATH, 'utf8');
  await pool.query(D2B2_SQL);

  POST_FN = await countPublicFns();
  POST_TABLE = await countPublicTables();
  POST_POLICY = await countPolicies();
  POST_TRIGGER = await countUserTriggers();
  POLICIES_POST = await snapshotPolicies();
});

afterAll(async () => {
  await pool.query(RESET_SQL);
  await pool.end();
});

// ---------------------------------------------------------------------------
// GROUP 1 · PostgreSQL environment and catalog (8)
// ---------------------------------------------------------------------------
describe('Phase 1J-D2B-2 · PostgreSQL environment and catalog', () => {
  it('runs against real PostgreSQL 16.x', async () => {
    const [row] = await q<{ n: string }>(
      `SELECT current_setting('server_version_num') AS n`,
    );
    const n = Number(row.n);
    expect(n).toBeGreaterThanOrEqual(160000);
    expect(n).toBeLessThan(170000);
  });

  it('captured a non-empty migration owner', () => {
    expect(MIGRATION_OWNER).toMatch(/\S/);
  });

  it('D2B-1 then D2B-2 applied; caller helper has exactly one overload', async () => {
    const r = await q<{ c: string }>(
      `SELECT count(*)::int AS c FROM pg_proc p
         JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
          AND p.proname='current_user_has_recruiter_minimum_paid_plan'`,
    );
    expect(Number(r[0].c)).toBe(1);
    expect(D2B1_SQL).toMatch(/current_user_has_recruiter_minimum_paid_plan/);
    expect(D2B2_SQL).toMatch(/current_user_has_recruiter_minimum_paid_plan\('growth'\)/);
  });

  it('policy count is exactly 11 both before and after D2B-2', () => {
    expect(PRE_POLICY).toBe(11);
    expect(POST_POLICY).toBe(11);
  });

  it('four target policies retain their exact command and role=authenticated', () => {
    const targets = [
      { table: 'contracts', name: 'Recruiter inserts contracts on own applications', cmd: 'INSERT' },
      { table: 'contracts', name: 'Recruiter updates own contracts', cmd: 'UPDATE' },
      { table: 'contract_versions', name: 'Recruiter inserts versions on own contracts', cmd: 'INSERT' },
      { table: 'contract_reviews', name: 'Recruiter inserts own review', cmd: 'INSERT' },
    ];
    for (const t of targets) {
      const row = POLICIES_POST.find(
        (p) => p.tablename === t.table && p.policyname === t.name,
      );
      expect(row, `${t.table}.${t.name} missing`).toBeDefined();
      expect(row!.cmd).toBe(t.cmd);
      expect(row!.roles).toEqual(['authenticated']);
    }
  });

  it('target expressions contain exactly five Growth-helper calls; non-target contain zero', () => {
    const marker = 'current_user_has_recruiter_minimum_paid_plan';
    const growthLit = "'growth'";
    const targetNames = new Set([
      'Recruiter inserts contracts on own applications',
      'Recruiter updates own contracts',
      'Recruiter inserts versions on own contracts',
      'Recruiter inserts own review',
    ]);
    let tgtCount = 0;
    let nonTgtCount = 0;
    for (const p of POLICIES_POST) {
      const expr = `${p.qual ?? ''}\n${p.with_check ?? ''}`;
      const occurrences = (expr.match(new RegExp(marker, 'g')) ?? []).filter(() => true).length;
      // Only count occurrences that reference the Growth plan literal.
      const growthOccurrences = expr.split(marker).length - 1 > 0
        ? (expr.match(new RegExp(`${marker}\\(\\s*${growthLit}`, 'g')) ?? []).length
        : 0;
      const effective = Math.min(occurrences, growthOccurrences);
      if (targetNames.has(p.policyname)) tgtCount += effective;
      else nonTgtCount += occurrences;
    }
    expect(tgtCount).toBe(5);
    expect(nonTgtCount).toBe(0);
  });

  it('RLS enabled on exactly the three contract tables', async () => {
    const rows = await q<{ relname: string; rls: boolean }>(
      `SELECT c.relname, c.relrowsecurity AS rls
         FROM pg_class c
         JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity`,
    );
    const names = rows.map((r) => r.relname).sort();
    expect(names).toEqual(['contract_reviews', 'contract_versions', 'contracts']);
  });

  it('service_role has BYPASSRLS, authenticated does not, and D2B-2 changes zero counts', async () => {
    const rows = await q<{ rolname: string; rolbypassrls: boolean }>(
      `SELECT rolname, rolbypassrls FROM pg_roles
        WHERE rolname IN ('service_role','authenticated','anon')`,
    );
    const svc = rows.find((r) => r.rolname === 'service_role');
    const auth = rows.find((r) => r.rolname === 'authenticated');
    expect(svc?.rolbypassrls).toBe(true);
    expect(auth?.rolbypassrls).toBe(false);

    expect(POST_TABLE - PRE_TABLE).toBe(0);
    expect(POST_FN - PRE_FN).toBe(0);
    expect(POST_TRIGGER - PRE_TRIGGER).toBe(0);
    expect(POST_POLICY - PRE_POLICY).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GROUP 2 · entitled recruiter write matrix (4)
// ---------------------------------------------------------------------------
describe('Phase 1J-D2B-2 · entitled recruiter write matrix', () => {
  it('active Growth may perform all four recruiter writes', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'active');
    const driver = await createUser();
    await expectAllRecruiterWritesAllowed(uid, rid, driver);
  });

  it('active Fleet may perform all four recruiter writes', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('fleet', 'active');
    const driver = await createUser();
    await expectAllRecruiterWritesAllowed(uid, rid, driver);
  });

  it('trialing Growth may perform all four recruiter writes', async () => { // trial-allowlist
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'trialing'); // trial-allowlist
    const driver = await createUser();
    await expectAllRecruiterWritesAllowed(uid, rid, driver);
  });

  it('trialing Fleet may perform all four recruiter writes', async () => { // trial-allowlist
    const { uid, rid } = await seedRecruiterWithBilling('fleet', 'trialing'); // trial-allowlist
    const driver = await createUser();
    await expectAllRecruiterWritesAllowed(uid, rid, driver);
  });
});

// ---------------------------------------------------------------------------
// GROUP 3 · unentitled recruiter denial matrix (6)
// ---------------------------------------------------------------------------
describe('Phase 1J-D2B-2 · unentitled recruiter denial matrix', () => {
  it('active Starter is denied all four recruiter writes', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('starter', 'active');
    const driver = await createUser();
    await expectAllRecruiterWritesDenied(uid, rid, driver);
  });

  it('active none is denied all four recruiter writes', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('none', 'active');
    const driver = await createUser();
    await expectAllRecruiterWritesDenied(uid, rid, driver);
  });

  it('inactive Growth is denied all four recruiter writes', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'inactive');
    const driver = await createUser();
    await expectAllRecruiterWritesDenied(uid, rid, driver);
  });

  it('past_due Growth is denied all four recruiter writes', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'past_due');
    const driver = await createUser();
    await expectAllRecruiterWritesDenied(uid, rid, driver);
  });

  it('canceled Growth is denied all four recruiter writes', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'canceled');
    const driver = await createUser();
    await expectAllRecruiterWritesDenied(uid, rid, driver);
  });

  it('recruiter with no billing row is denied all four recruiter writes', async () => {
    const { uid, rid } = await seedRecruiterNoBilling();
    const driver = await createUser();
    await expectAllRecruiterWritesDenied(uid, rid, driver);
  });
});

// ---------------------------------------------------------------------------
// GROUP 4 · ownership and original predicate preservation (5)
// ---------------------------------------------------------------------------
describe('Phase 1J-D2B-2 · ownership and original predicate preservation', () => {
  it('active Growth cannot write across another recruiter\'s application or contract', async () => {
    const caller = await seedRecruiterWithBilling('growth', 'active');
    const other  = await seedRecruiterWithBilling('growth', 'active');
    const driver = await createUser();
    const { cid: otherCid, appId: otherApp, oppId: otherOpp } =
      await seedContractOwner(other.uid, other.rid, driver);

    // insert claiming to be caller on the OTHER recruiter's app+recruiter_id
    await expectRlsReject(
      caller.uid,
      `INSERT INTO public.contracts(id,application_id,opportunity_id,recruiter_id,recruiter_user_id,driver_user_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), otherApp, otherOpp, other.rid, caller.uid, driver],
    );

    // update against other's contract → rowCount 0
    const upd = await asAuthenticated(caller.uid, async (c) => {
      const r = await c.query(
        `UPDATE public.contracts SET status='sent' WHERE id=$1`, [otherCid],
      );
      return r.rowCount ?? 0;
    });
    expect(upd).toBe(0);

    // version insert on other's contract → RLS reject
    await expectRlsReject(
      caller.uid,
      `INSERT INTO public.contract_versions(id,contract_id,uploaded_by,version_number)
       VALUES ($1,$2,$3,1)`,
      [randomUUID(), otherCid, caller.uid],
    );

    // recruiter-review on other's contract → RLS reject
    await expectRlsReject(
      caller.uid,
      `INSERT INTO public.contract_reviews(id,contract_id,reviewer_user_id,reviewer_role)
       VALUES ($1,$2,$3,'recruiter')`,
      [randomUUID(), otherCid, caller.uid],
    );
  });

  it('contract insert with recruiter_user_id ≠ caller is strictly RLS rejected', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'active');
    const driver = await createUser();
    const someoneElse = await createUser();
    const { appId, oppId } = await seedApplication(rid, driver);
    await expectRlsReject(
      uid,
      `INSERT INTO public.contracts(id,application_id,opportunity_id,recruiter_id,recruiter_user_id,driver_user_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), appId, oppId, rid, someoneElse, driver],
    );
  });

  it('version insert with uploaded_by ≠ caller is strictly RLS rejected', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'active');
    const driver = await createUser();
    const { cid } = await seedContractOwner(uid, rid, driver);
    const someoneElse = await createUser();
    await expectRlsReject(
      uid,
      `INSERT INTO public.contract_versions(id,contract_id,uploaded_by,version_number)
       VALUES ($1,$2,$3,1)`,
      [randomUUID(), cid, someoneElse],
    );
  });

  it('recruiter review with reviewer_user_id ≠ caller is strictly RLS rejected', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'active');
    const driver = await createUser();
    const { cid } = await seedContractOwner(uid, rid, driver);
    const someoneElse = await createUser();
    await expectRlsReject(
      uid,
      `INSERT INTO public.contract_reviews(id,contract_id,reviewer_user_id,reviewer_role)
       VALUES ($1,$2,$3,'recruiter')`,
      [randomUUID(), cid, someoneElse],
    );
  });

  it('recruiter caller with non-recruiter reviewer_role is strictly RLS rejected', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'active');
    const driver = await createUser();
    const { cid } = await seedContractOwner(uid, rid, driver);
    // Caller is the recruiter, not the driver — reviewer_role='driver' cannot match either policy.
    await expectRlsReject(
      uid,
      `INSERT INTO public.contract_reviews(id,contract_id,reviewer_user_id,reviewer_role)
       VALUES ($1,$2,$3,'driver')`,
      [randomUUID(), cid, uid],
    );
  });
});

// ---------------------------------------------------------------------------
// GROUP 5 · downgrade read preservation and write shutdown (4)
// ---------------------------------------------------------------------------
describe('Phase 1J-D2B-2 · downgrade read preservation and write shutdown', () => {
  it('after Growth→Starter downgrade the recruiter still SELECTs existing contract and version', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'active');
    const driver = await createUser();
    const { cid, vid } = await expectAllRecruiterWritesAllowed(uid, rid, driver);
    await insertBilling(rid, uid, 'starter', 'active');

    const seen = await asAuthenticated(uid, async (c) => {
      const cr = await c.query(`SELECT id FROM public.contracts WHERE id=$1`, [cid]);
      const vr = await c.query(`SELECT id FROM public.contract_versions WHERE id=$1`, [vid]);
      return { cr: cr.rowCount ?? 0, vr: vr.rowCount ?? 0 };
    });
    expect(seen.cr).toBe(1);
    expect(seen.vr).toBe(1);
  });

  it('after Growth→Starter downgrade a new contract insert is strictly RLS rejected', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'active');
    const driver = await createUser();
    await expectAllRecruiterWritesAllowed(uid, rid, driver);
    await insertBilling(rid, uid, 'starter', 'active');
    const { appId, oppId } = await seedApplication(rid, driver);
    await expectRlsReject(
      uid,
      `INSERT INTO public.contracts(id,application_id,opportunity_id,recruiter_id,recruiter_user_id,driver_user_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), appId, oppId, rid, uid, driver],
    );
  });

  it('after Growth→Starter downgrade contract update affects zero rows', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'active');
    const driver = await createUser();
    const { cid } = await expectAllRecruiterWritesAllowed(uid, rid, driver);
    await insertBilling(rid, uid, 'starter', 'active');
    const upd = await asAuthenticated(uid, async (c) => {
      const r = await c.query(
        `UPDATE public.contracts SET status='accepted' WHERE id=$1`, [cid],
      );
      return r.rowCount ?? 0;
    });
    expect(upd).toBe(0);
    const persisted = await q<{ status: string }>(
      `SELECT status FROM public.contracts WHERE id=$1`, [cid],
    );
    expect(persisted[0].status).toBe('sent');
  });

  it('after Growth→Starter downgrade new version and recruiter-review inserts are independently RLS rejected', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'active');
    const driver = await createUser();
    const { cid } = await expectAllRecruiterWritesAllowed(uid, rid, driver);
    await insertBilling(rid, uid, 'starter', 'active');

    await expectRlsReject(
      uid,
      `INSERT INTO public.contract_versions(id,contract_id,uploaded_by,version_number)
       VALUES ($1,$2,$3,2)`,
      [randomUUID(), cid, uid],
    );
    await expectRlsReject(
      uid,
      `INSERT INTO public.contract_reviews(id,contract_id,reviewer_user_id,reviewer_role)
       VALUES ($1,$2,$3,'recruiter')`,
      [randomUUID(), cid, uid],
    );
  });
});

// ---------------------------------------------------------------------------
// GROUP 6 · non-target role preservation (5)
// ---------------------------------------------------------------------------
describe('Phase 1J-D2B-2 · non-target role preservation', () => {
  it('driver SELECTs own contract after recruiter downgrade', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'active');
    const driver = await createUser();
    const { cid } = await expectAllRecruiterWritesAllowed(uid, rid, driver);
    await insertBilling(rid, uid, 'starter', 'active');
    const rows = await asAuthenticated(driver, async (c) => {
      const r = await c.query(`SELECT id FROM public.contracts WHERE id=$1`, [cid]);
      return r.rowCount ?? 0;
    });
    expect(rows).toBe(1);
  });

  it('driver UPDATE succeeds on own contract after recruiter downgrade', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'active');
    const driver = await createUser();
    const { cid } = await expectAllRecruiterWritesAllowed(uid, rid, driver);
    await insertBilling(rid, uid, 'starter', 'active');
    const upd = await asAuthenticated(driver, async (c) => {
      const r = await c.query(
        `UPDATE public.contracts SET status='driver_reviewed' WHERE id=$1`, [cid],
      );
      return r.rowCount ?? 0;
    });
    expect(upd).toBe(1);
    const persisted = await q<{ status: string }>(
      `SELECT status FROM public.contracts WHERE id=$1`, [cid],
    );
    expect(persisted[0].status).toBe('driver_reviewed');
  });

  it('driver review INSERT succeeds after recruiter downgrade', async () => {
    const { uid, rid } = await seedRecruiterWithBilling('growth', 'active');
    const driver = await createUser();
    const { cid } = await expectAllRecruiterWritesAllowed(uid, rid, driver);
    await insertBilling(rid, uid, 'starter', 'active');
    const rvid = randomUUID();
    await asAuthenticated(driver, async (c) => {
      await c.query(
        `INSERT INTO public.contract_reviews(id,contract_id,reviewer_user_id,reviewer_role,comments)
         VALUES ($1,$2,$3,'driver','ok')`,
        [rvid, cid, driver],
      );
    });
    expect(
      (await q(`SELECT id FROM public.contract_reviews WHERE id=$1`, [rvid])).length,
    ).toBe(1);
  });

  it('admin SELECT and UPDATE succeed regardless of recruiter billing', async () => {
    const { uid, rid } = await seedRecruiterNoBilling();
    const driver = await createUser();
    const { cid } = await seedContractOwner(uid, rid, driver);
    const adminUid = await createAdmin();

    const seen = await asAuthenticated(adminUid, async (c) => {
      const r = await c.query(`SELECT id FROM public.contracts WHERE id=$1`, [cid]);
      return r.rowCount ?? 0;
    });
    expect(seen).toBe(1);

    const upd = await asAuthenticated(adminUid, async (c) => {
      const r = await c.query(
        `UPDATE public.contracts SET status='admin_edited' WHERE id=$1`, [cid],
      );
      return r.rowCount ?? 0;
    });
    expect(upd).toBe(1);
    const persisted = await q<{ status: string }>(
      `SELECT status FROM public.contracts WHERE id=$1`, [cid],
    );
    expect(persisted[0].status).toBe('admin_edited');
  });

  it('service_role without billing completes all four contract write surfaces under its configured Postgres role behavior', async () => {
    const { uid, rid } = await seedRecruiterNoBilling();
    const driver = await createUser();
    const { appId, oppId } = await seedApplication(rid, driver);
    const cid = randomUUID();
    const vid = randomUUID();
    const rvid = randomUUID();

    await asServiceRole(async (c) => {
      await c.query(
        `INSERT INTO public.contracts(id,application_id,opportunity_id,recruiter_id,recruiter_user_id,driver_user_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [cid, appId, oppId, rid, uid, driver],
      );
      const upd = await c.query(
        `UPDATE public.contracts SET status='sent' WHERE id=$1`, [cid],
      );
      expect(upd.rowCount).toBe(1);
      await c.query(
        `INSERT INTO public.contract_versions(id,contract_id,uploaded_by,version_number)
         VALUES ($1,$2,$3,1)`,
        [vid, cid, uid],
      );
      await c.query(
        `INSERT INTO public.contract_reviews(id,contract_id,reviewer_user_id,reviewer_role)
         VALUES ($1,$2,$3,'recruiter')`,
        [rvid, cid, uid],
      );
    });

    expect((await q(`SELECT status FROM public.contracts WHERE id=$1`, [cid]))[0]).toEqual({ status: 'sent' });
    expect((await q(`SELECT id FROM public.contract_versions WHERE id=$1`, [vid])).length).toBe(1);
    expect((await q(`SELECT id FROM public.contract_reviews WHERE id=$1`, [rvid])).length).toBe(1);
  });
});
