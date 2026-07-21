/**
 * Phase 1K-A2 — Real PostgreSQL 16 regression gate for the admin-recruiter
 * opportunity publication trigger correction.
 *
 * This suite:
 *   1. Boots a schema-faithful fixture against a real PostgreSQL 16 database.
 *   2. Installs the CURRENT canonical pre-A1 `public.opportunities_guard()`
 *      definition, extracted deterministically from the last migration that
 *      defines it (supabase/migrations/20260717175500_...sql), using unique
 *      start/end markers. This proves that the reproduction is byte-faithful
 *      to production and not an invented simplification.
 *   3. Seeds an admin who ALSO owns a complete, eligible recruiter profile.
 *   4. Reproduces the pre-A1 defect: admin-own INSERTs bypass publication
 *      normalization and persist as active+pending+published_at NULL — the
 *      exact live-production defect this phase remediates. These rows are
 *      captured before the candidate is applied.
 *   5. Loads and applies the A1 candidate SQL directly from disk.
 *   6. Proves, against real PostgreSQL trigger + RLS + role semantics, that
 *      the corrected owner-aware classification restores publication for
 *      admin-own writes, preserves admin bypass for other recruiters,
 *      preserves explicit self-moderation, and preserves ordinary recruiter
 *      behavior. Verifies pg_catalog properties (language, prosecdef,
 *      pinned search_path, trigger binding, function-definition text) and
 *      candidate idempotency.
 *
 * The suite hard-fails without PHASE1K_A2_DATABASE_URL; it does not skip.
 * All identity switches use SET LOCAL ROLE authenticated and
 * set_config('request.jwt.claim.sub', <uid>, true), matching how PostgREST
 * establishes the auth.uid() GUC in production.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Environment gate — hard-fail (never skip) if the dedicated DB URL is missing.
// ---------------------------------------------------------------------------
const DATABASE_URL = process.env.PHASE1K_A2_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'PHASE1K_A2_DATABASE_URL is required for the Phase 1K-A2 real-PostgreSQL gate. ' +
      'This suite must never be skipped.',
  );
}

// ---------------------------------------------------------------------------
// Source-of-truth SQL loaded from disk with explicit repo-relative paths.
// ---------------------------------------------------------------------------
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const CANDIDATE_PATH =
  REPO_ROOT +
  'supabase/migration-candidates/20260720233000_phase1k_admin_recruiter_opportunity_publication.sql';

// The canonical (pre-A1) definition of `public.opportunities_guard()` lives
// in this exact migration file. This is the LAST migration in the ordered
// history that (re)defines the guard, i.e. the live production definition.
const CANONICAL_GUARD_MIGRATION_PATH =
  REPO_ROOT +
  'supabase/migrations/20260717175500_55a0af82-0ef1-47e0-a06b-196b6e6ecee5.sql';

const CANDIDATE_SQL = readFileSync(CANDIDATE_PATH, 'utf8');
const CANONICAL_GUARD_SRC = readFileSync(CANONICAL_GUARD_MIGRATION_PATH, 'utf8');

/**
 * Deterministically extract the canonical `public.opportunities_guard()`
 * function block using unique start/end markers. Fail hard if the header
 * appears zero or more than once, or if the body delimiters are missing.
 */
function extractCanonicalVulnerableGuard(src: string): string {
  const header = 'CREATE OR REPLACE FUNCTION public.opportunities_guard()';
  const openDelim = '$function$';
  const closeDelim = '$function$;';

  const first = src.indexOf(header);
  if (first === -1) {
    throw new Error(
      `Canonical guard header not found in ${CANONICAL_GUARD_MIGRATION_PATH}`,
    );
  }
  const second = src.indexOf(header, first + header.length);
  if (second !== -1) {
    throw new Error(
      `Canonical guard header appears more than once in ${CANONICAL_GUARD_MIGRATION_PATH}`,
    );
  }

  const bodyOpen = src.indexOf(openDelim, first);
  if (bodyOpen === -1) {
    throw new Error('Canonical guard body open delimiter ($function$) missing.');
  }
  const bodyClose = src.indexOf(closeDelim, bodyOpen + openDelim.length);
  if (bodyClose === -1) {
    throw new Error('Canonical guard body close delimiter ($function$;) missing.');
  }
  return src.slice(first, bodyClose + closeDelim.length);
}

const VULNERABLE_GUARD_SQL = extractCanonicalVulnerableGuard(CANONICAL_GUARD_SRC);

// The extracted vulnerable guard MUST contain the exact top-level
// unconditional admin bypass line the A1 candidate replaces.
if (
  !VULNERABLE_GUARD_SQL.includes('IF public.is_admin(auth.uid()) THEN')
) {
  throw new Error(
    'Extracted vulnerable guard does not contain the expected top-level ' +
      'admin bypass — canonical source may have drifted. Aborting to avoid ' +
      'proving a simplified/invented guard rather than the real defect.',
  );
}

// ---------------------------------------------------------------------------
// Fixture SQL. Schema-faithful reproductions of the columns, helpers, RLS,
// grants, trigger binding and driver-visibility RPC referenced by the A1
// candidate. Canonical source is cited alongside each block.
// ---------------------------------------------------------------------------
const RESET_SQL = `
DO $$
DECLARE
  r record;
BEGIN
  -- Drop fixture triggers/functions/tables/roles idempotently.
  DROP TRIGGER IF EXISTS trg_opportunities_guard ON public.opportunities;
  DROP FUNCTION IF EXISTS public.opportunities_guard() CASCADE;
  DROP FUNCTION IF EXISTS public.list_driver_visible_opportunities(text,text,text) CASCADE;
  DROP FUNCTION IF EXISTS public.current_user_can_manage_recruiter_opportunities(uuid) CASCADE;
  DROP FUNCTION IF EXISTS public.recruiter_profile_can_manage_opportunities(uuid) CASCADE;
  DROP FUNCTION IF EXISTS public.is_admin(uuid) CASCADE;
  DROP TABLE IF EXISTS public.opportunities CASCADE;
  DROP TABLE IF EXISTS public.recruiter_profiles CASCADE;
  DROP TABLE IF EXISTS public.admin_users CASCADE;
  DROP SCHEMA IF EXISTS auth CASCADE;

  -- Test-only roles. Drop first (ignore members) so re-runs are deterministic.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REASSIGN OWNED BY authenticated TO CURRENT_USER';
    EXECUTE 'DROP OWNED BY authenticated';
    EXECUTE 'DROP ROLE authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REASSIGN OWNED BY anon TO CURRENT_USER';
    EXECUTE 'DROP OWNED BY anon';
    EXECUTE 'DROP ROLE anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REASSIGN OWNED BY service_role TO CURRENT_USER';
    EXECUTE 'DROP OWNED BY service_role';
    EXECUTE 'DROP ROLE service_role';
  END IF;
END$$;

CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text
);
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- auth.uid() reads the PostgREST-style claim GUC. Matches production shape.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- =============================================================
-- admin_users (canonical source:
--   supabase/migrations/20260228060534_e148b76a-288a-4273-a42b-f9d95f9bfb0e.sql,
--   lines 3-9 / is_admin() lines 26-36)
-- =============================================================
CREATE TABLE public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','super_admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_users TO authenticated;
GRANT ALL ON public.admin_users TO service_role;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = _user_id)
$$;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;

-- =============================================================
-- recruiter_profiles (canonical source:
--   supabase/migrations/20260513003741_...sql lines 73-102 for base columns;
--   supabase/migrations/20260717175500_...sql lines 9-12 for A1-referenced
--   consent columns).
-- =============================================================
CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_name text NOT NULL,
  recruiter_email text,
  company_name text NOT NULL,
  dot_number text,
  mc_number text,
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','approved','rejected','suspended')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','suspended')),
  posting_terms_accepted_at timestamptz,
  posting_terms_version text,
  legacy_terms_grandfathered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruiter_profiles_user_unique UNIQUE (user_id)
);
GRANT SELECT ON public.recruiter_profiles TO authenticated;
GRANT ALL ON public.recruiter_profiles TO service_role;

-- =============================================================
-- opportunities (canonical source:
--   supabase/migrations/20260513003741_...sql lines 182-238;
--   only columns referenced by the guard, RPC, RLS, or assertions).
-- =============================================================
CREATE TABLE public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  company_name text NOT NULL,
  hiring_state text,
  driver_type text,
  route_type text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','paused','closed','removed')),
  admin_review_status text NOT NULL DEFAULT 'pending'
    CHECK (admin_review_status IN ('pending','approved','rejected','flagged')),
  featured boolean NOT NULL DEFAULT false,
  view_count integer NOT NULL DEFAULT 0,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.opportunities TO authenticated;
GRANT ALL ON public.opportunities TO service_role;

-- =============================================================
-- Canonical eligibility helpers reproduced schema-faithfully (canonical
-- source: supabase/migrations/20260717175500_...sql lines 25-89). These
-- enforce ownership, active/non-suspended state, profile completeness,
-- DOT-or-MC, valid recruiter email, and accepted/grandfathered posting
-- terms — do not weaken.
-- =============================================================
CREATE OR REPLACE FUNCTION public.recruiter_profile_can_manage_opportunities(
  _recruiter_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
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
GRANT EXECUTE ON FUNCTION public.recruiter_profile_can_manage_opportunities(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_can_manage_recruiter_opportunities(
  _recruiter_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter_id
      AND rp.user_id = auth.uid()
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
GRANT EXECUTE ON FUNCTION public.current_user_can_manage_recruiter_opportunities(uuid)
  TO authenticated, service_role;

-- =============================================================
-- opportunities_guard trigger binding (canonical source: same file).
-- Guard itself is installed separately (vulnerable pre-A1 first, then
-- A1 candidate).
-- =============================================================
-- (guard function installed below by test setup)

-- =============================================================
-- Driver-visible RPC (canonical source:
--   supabase/migrations/20260717175500_...sql lines 263-283).
-- =============================================================
CREATE OR REPLACE FUNCTION public.list_driver_visible_opportunities(
  _state text DEFAULT NULL,
  _driver_type text DEFAULT NULL,
  _route_type text DEFAULT NULL
) RETURNS SETOF public.opportunities
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT o.*
  FROM public.opportunities o
  WHERE auth.uid() IS NOT NULL
    AND o.status = 'active'
    AND o.admin_review_status = 'approved'
    AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
    AND (_state IS NULL OR o.hiring_state = _state)
    AND (_driver_type IS NULL OR o.driver_type = _driver_type)
    AND (_route_type IS NULL OR o.route_type = _route_type)
  ORDER BY o.featured DESC NULLS LAST, o.published_at DESC NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION public.list_driver_visible_opportunities(text,text,text)
  TO authenticated, service_role;

-- =============================================================
-- RLS on opportunities (canonical source:
--   supabase/migrations/20260513003741_...sql lines 240-275 for admin
--   view/update policies; 20260717175500_...sql lines 244-258 for
--   eligibility-based insert/update policies).
-- =============================================================
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruiter inserts own opportunities"
  ON public.opportunities
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_manage_recruiter_opportunities(recruiter_id));

CREATE POLICY "Recruiter updates own opportunities"
  ON public.opportunities
  FOR UPDATE TO authenticated
  USING (public.current_user_can_manage_recruiter_opportunities(recruiter_id))
  WITH CHECK (public.current_user_can_manage_recruiter_opportunities(recruiter_id));

CREATE POLICY "Recruiter views own opportunities"
  ON public.opportunities
  FOR SELECT TO authenticated
  USING (public.current_user_can_manage_recruiter_opportunities(recruiter_id));

CREATE POLICY "Admins view all opportunities"
  ON public.opportunities
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins update all opportunities"
  ON public.opportunities
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
`;

const TRIGGER_BINDING_SQL = `
DROP TRIGGER IF EXISTS trg_opportunities_guard ON public.opportunities;
CREATE TRIGGER trg_opportunities_guard
  BEFORE INSERT OR UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.opportunities_guard();
`;

// ---------------------------------------------------------------------------
// Deterministic fixture identities.
// ---------------------------------------------------------------------------
const ADMIN_UID = '11111111-1111-4111-8111-111111111111';
const ADMIN_RECRUITER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_UID = '22222222-2222-4222-8222-222222222222';
const OTHER_RECRUITER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DRIVER_UID = '33333333-3333-4333-8333-333333333333';
const INELIGIBLE_UID = '44444444-4444-4444-8444-444444444444';
const INELIGIBLE_RECRUITER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// Pre-candidate captured rows.
type OpportunityRow = {
  id: string;
  status: string;
  admin_review_status: string;
  published_at: string | null;
  featured: boolean;
  view_count: number;
  recruiter_id: string;
};

let preCandidateActiveRow: OpportunityRow;
let preCandidateDraftRow: OpportunityRow;

// ---------------------------------------------------------------------------
// Test infrastructure.
// ---------------------------------------------------------------------------
const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

/**
 * Run `fn` inside a fresh transaction with role=authenticated and
 * request.jwt.claim.sub bound to `uid`. Commits on success, rolls back on
 * error, and always releases the client with role/claim state cleared.
 */
async function asUser<T>(
  uid: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(
      `SELECT set_config('request.jwt.claim.sub', $1, true)`,
      [uid],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    try {
      await client.query('RESET ROLE');
      await client.query(
        `SELECT set_config('request.jwt.claim.sub', '', false)`,
      );
    } catch {
      /* ignore */
    }
    client.release();
  }
}

async function seedIdentities() {
  await q(
    `INSERT INTO auth.users (id, email) VALUES
       ($1, 'admin@example.com'),
       ($2, 'other@example.com'),
       ($3, 'driver@example.com'),
       ($4, 'ineligible@example.com')`,
    [ADMIN_UID, OTHER_UID, DRIVER_UID, INELIGIBLE_UID],
  );
  await q(
    `INSERT INTO public.admin_users (user_id, email, role)
     VALUES ($1, 'admin@example.com', 'super_admin')`,
    [ADMIN_UID],
  );
  // Complete/eligible admin-owned recruiter profile.
  await q(
    `INSERT INTO public.recruiter_profiles
       (id, user_id, recruiter_name, recruiter_email, company_name,
        dot_number, verification_status, status,
        posting_terms_accepted_at, posting_terms_version)
     VALUES ($1, $2, 'Admin Rex', 'admin.rex@example.com', 'RexCorp',
             '1234567', 'approved', 'active', now(), 'v1')`,
    [ADMIN_RECRUITER_ID, ADMIN_UID],
  );
  // Complete/eligible ordinary recruiter profile (non-admin).
  await q(
    `INSERT INTO public.recruiter_profiles
       (id, user_id, recruiter_name, recruiter_email, company_name,
        mc_number, verification_status, status,
        legacy_terms_grandfathered_at)
     VALUES ($1, $2, 'Nora Non', 'nora@example.com', 'NonAdmin LLC',
             'MC-9999', 'approved', 'active', now())`,
    [OTHER_RECRUITER_ID, OTHER_UID],
  );
  // Ineligible recruiter — missing DOT/MC and no terms consent. Complete on
  // name/email/company only so we can prove eligibility (not RLS-of-other-kind)
  // is what denies publication.
  await q(
    `INSERT INTO public.recruiter_profiles
       (id, user_id, recruiter_name, recruiter_email, company_name,
        verification_status, status)
     VALUES ($1, $2, 'Ivan Ineligible', 'ivan@example.com', 'Incomplete Co',
             'pending', 'active')`,
    [INELIGIBLE_RECRUITER_ID, INELIGIBLE_UID],
  );
}

// ---------------------------------------------------------------------------
// beforeAll — install fixture, install VULNERABLE guard, reproduce defect,
// then apply A1 candidate. Post-candidate tests then run independently.
// ---------------------------------------------------------------------------
beforeAll(async () => {
  await pool.query(RESET_SQL);
  await pool.query(VULNERABLE_GUARD_SQL);
  await pool.query(TRIGGER_BINDING_SQL);
  await seedIdentities();

  // -------- Reproduce pre-candidate defect: admin-own writes bypass ---------
  const activeRow = await asUser(ADMIN_UID, async (c) => {
    const r = await c.query(
      `INSERT INTO public.opportunities
         (recruiter_id, title, company_name, status)
       VALUES ($1, 'PRE Active Admin-Own', 'RexCorp', 'active')
       RETURNING id, status, admin_review_status, published_at,
                 featured, view_count, recruiter_id`,
      [ADMIN_RECRUITER_ID],
    );
    return r.rows[0] as OpportunityRow;
  });
  const draftRow = await asUser(ADMIN_UID, async (c) => {
    const r = await c.query(
      `INSERT INTO public.opportunities
         (recruiter_id, title, company_name, status)
       VALUES ($1, 'PRE Draft Admin-Own', 'RexCorp', 'draft')
       RETURNING id, status, admin_review_status, published_at,
                 featured, view_count, recruiter_id`,
      [ADMIN_RECRUITER_ID],
    );
    return r.rows[0] as OpportunityRow;
  });
  preCandidateActiveRow = activeRow;
  preCandidateDraftRow = draftRow;

  // Now apply the A1 candidate — replaces the guard in place.
  await pool.query(CANDIDATE_SQL);
}, 120_000);

afterAll(async () => {
  await pool.end();
});

// ---------------------------------------------------------------------------
// Helper: authenticated insert of an opportunity for the ADMIN-own recruiter.
// ---------------------------------------------------------------------------
async function insertAsAdminOwn(
  status: 'active' | 'draft',
  title: string,
): Promise<OpportunityRow> {
  return asUser(ADMIN_UID, async (c) => {
    const r = await c.query(
      `INSERT INTO public.opportunities
         (recruiter_id, title, company_name, status)
       VALUES ($1, $2, 'RexCorp', $3)
       RETURNING id, status, admin_review_status, published_at,
                 featured, view_count, recruiter_id`,
      [ADMIN_RECRUITER_ID, title, status],
    );
    return r.rows[0] as OpportunityRow;
  });
}

async function fetchRow(id: string): Promise<OpportunityRow> {
  const r = await pool.query(
    `SELECT id, status, admin_review_status, published_at, featured,
            view_count, recruiter_id
       FROM public.opportunities WHERE id = $1`,
    [id],
  );
  return r.rows[0] as OpportunityRow;
}

// ===========================================================================
// TESTS
// ===========================================================================
describe('Phase 1K-A2 — pre-candidate defect reproduction (captured in beforeAll)', () => {
  it('reproduces admin-own ACTIVE INSERT persisting as active + pending + published_at NULL', () => {
    expect(preCandidateActiveRow).toBeDefined();
    expect(preCandidateActiveRow.status).toBe('active');
    expect(preCandidateActiveRow.admin_review_status).toBe('pending');
    expect(preCandidateActiveRow.published_at).toBeNull();
  });

  it('reproduces admin-own DRAFT INSERT persisting as draft + pending + published_at NULL', () => {
    expect(preCandidateDraftRow.status).toBe('draft');
    expect(preCandidateDraftRow.admin_review_status).toBe('pending');
    expect(preCandidateDraftRow.published_at).toBeNull();
  });

  it('driver RPC excludes the vulnerable active+pending row', async () => {
    const visible = await asUser(DRIVER_UID, async (c) => {
      const r = await c.query(
        `SELECT id FROM public.list_driver_visible_opportunities(NULL, NULL, NULL)`,
      );
      return r.rows.map((x) => x.id as string);
    });
    expect(visible).not.toContain(preCandidateActiveRow.id);
  });
});

describe('Phase 1K-A2 — post-candidate admin-own publication lifecycle', () => {
  it('admin-own ACTIVE INSERT normalizes to approved + published_at NOT NULL + featured=false + view_count=0', async () => {
    const row = await insertAsAdminOwn('active', 'POST Active Admin-Own');
    expect(row.status).toBe('active');
    expect(row.admin_review_status).toBe('approved');
    expect(row.published_at).not.toBeNull();
    expect(row.featured).toBe(false);
    expect(row.view_count).toBe(0);
  });

  it('admin-own DRAFT INSERT normalizes to approved with published_at NULL', async () => {
    const row = await insertAsAdminOwn('draft', 'POST Draft Admin-Own');
    expect(row.status).toBe('draft');
    expect(row.admin_review_status).toBe('approved');
    expect(row.published_at).toBeNull();
  });

  it('admin-own DRAFT -> ACTIVE ordinary UPDATE activates and stamps published_at', async () => {
    const draft = await insertAsAdminOwn('draft', 'POST Draft->Active');
    const updated = await asUser(ADMIN_UID, async (c) => {
      const r = await c.query(
        `UPDATE public.opportunities SET status = 'active' WHERE id = $1
         RETURNING id, status, admin_review_status, published_at,
                   featured, view_count, recruiter_id`,
        [draft.id],
      );
      return r.rows[0] as OpportunityRow;
    });
    expect(updated.status).toBe('active');
    expect(updated.admin_review_status).toBe('approved');
    expect(updated.published_at).not.toBeNull();
  });

  it('ordinary edit of already-live admin-owned row preserves published_at + approval', async () => {
    const live = await insertAsAdminOwn('active', 'POST Live Admin-Own');
    const original = live.published_at;
    const updated = await asUser(ADMIN_UID, async (c) => {
      const r = await c.query(
        `UPDATE public.opportunities SET title = 'POST Live Edited' WHERE id = $1
         RETURNING id, status, admin_review_status, published_at,
                   featured, view_count, recruiter_id`,
        [live.id],
      );
      return r.rows[0] as OpportunityRow;
    });
    expect(updated.admin_review_status).toBe('approved');
    expect(updated.published_at).toEqual(original);
  });
});

describe('Phase 1K-A2 — post-candidate admin explicit self-moderation preserved', () => {
  it('admin explicitly rejects their own opportunity and rejection persists', async () => {
    const live = await insertAsAdminOwn('active', 'POST Admin Self-Reject');
    const updated = await asUser(ADMIN_UID, async (c) => {
      const r = await c.query(
        `UPDATE public.opportunities
           SET admin_review_status = 'rejected'
         WHERE id = $1
         RETURNING id, status, admin_review_status, published_at,
                   featured, view_count, recruiter_id`,
        [live.id],
      );
      return r.rows[0] as OpportunityRow;
    });
    expect(updated.admin_review_status).toBe('rejected');
  });

  it('admin explicitly toggles featured on their own opportunity and it persists', async () => {
    const live = await insertAsAdminOwn('active', 'POST Admin Self-Feature');
    const updated = await asUser(ADMIN_UID, async (c) => {
      const r = await c.query(
        `UPDATE public.opportunities SET featured = true WHERE id = $1
         RETURNING id, status, admin_review_status, published_at,
                   featured, view_count, recruiter_id`,
        [live.id],
      );
      return r.rows[0] as OpportunityRow;
    });
    expect(updated.featured).toBe(true);
    expect(updated.admin_review_status).toBe('approved');
  });

  it('admin explicitly bumps view_count on their own opportunity and it persists', async () => {
    const live = await insertAsAdminOwn('active', 'POST Admin Self-ViewCount');
    const updated = await asUser(ADMIN_UID, async (c) => {
      const r = await c.query(
        `UPDATE public.opportunities SET view_count = 42 WHERE id = $1
         RETURNING id, status, admin_review_status, published_at,
                   featured, view_count, recruiter_id`,
        [live.id],
      );
      return r.rows[0] as OpportunityRow;
    });
    expect(updated.view_count).toBe(42);
  });
});

describe('Phase 1K-A2 — post-candidate admin-other bypass preserved', () => {
  it('admin can reject a non-admin recruiter opportunity via bypass', async () => {
    // Seed row as non-admin owner first.
    const other = await asUser(OTHER_UID, async (c) => {
      const r = await c.query(
        `INSERT INTO public.opportunities
           (recruiter_id, title, company_name, status)
         VALUES ($1, 'POST Other Active', 'NonAdmin LLC', 'active')
         RETURNING id, status, admin_review_status, published_at,
                   featured, view_count, recruiter_id`,
        [OTHER_RECRUITER_ID],
      );
      return r.rows[0] as OpportunityRow;
    });
    expect(other.admin_review_status).toBe('approved');

    const rejected = await asUser(ADMIN_UID, async (c) => {
      const r = await c.query(
        `UPDATE public.opportunities SET admin_review_status = 'rejected'
           WHERE id = $1
         RETURNING id, status, admin_review_status, published_at,
                   featured, view_count, recruiter_id`,
        [other.id],
      );
      return r.rows[0] as OpportunityRow;
    });
    expect(rejected.admin_review_status).toBe('rejected');
  });
});

describe('Phase 1K-A2 — post-candidate driver visibility contract', () => {
  it('driver RPC returns a properly published admin-owned recruiter opportunity', async () => {
    const live = await insertAsAdminOwn('active', 'POST Admin Visible');
    const visible = await asUser(DRIVER_UID, async (c) => {
      const r = await c.query(
        `SELECT id FROM public.list_driver_visible_opportunities(NULL, NULL, NULL)`,
      );
      return r.rows.map((x) => x.id as string);
    });
    expect(visible).toContain(live.id);
  });

  it('driver RPC still rejects a control row that is active + pending', async () => {
    // Force a control row by setting admin_review_status back to pending via
    // admin self-moderation (preserved by A1).
    const live = await insertAsAdminOwn('active', 'POST Control Pending');
    await asUser(ADMIN_UID, async (c) => {
      await c.query(
        `UPDATE public.opportunities SET admin_review_status = 'pending'
           WHERE id = $1`,
        [live.id],
      );
    });
    const row = await fetchRow(live.id);
    expect(row.admin_review_status).toBe('pending');

    const visible = await asUser(DRIVER_UID, async (c) => {
      const r = await c.query(
        `SELECT id FROM public.list_driver_visible_opportunities(NULL, NULL, NULL)`,
      );
      return r.rows.map((x) => x.id as string);
    });
    expect(visible).not.toContain(live.id);
  });
});

describe('Phase 1K-A2 — post-candidate ordinary recruiter contract preserved', () => {
  it('non-admin eligible recruiter ACTIVE INSERT normalizes to approved + published', async () => {
    const row = await asUser(OTHER_UID, async (c) => {
      const r = await c.query(
        `INSERT INTO public.opportunities
           (recruiter_id, title, company_name, status)
         VALUES ($1, 'POST Other Normalized', 'NonAdmin LLC', 'active')
         RETURNING id, status, admin_review_status, published_at,
                   featured, view_count, recruiter_id`,
        [OTHER_RECRUITER_ID],
      );
      return r.rows[0] as OpportunityRow;
    });
    expect(row.admin_review_status).toBe('approved');
    expect(row.published_at).not.toBeNull();
    expect(row.featured).toBe(false);
    expect(row.view_count).toBe(0);
  });

  it('ineligible/incomplete non-admin owner cannot obtain approved+published via normalization', async () => {
    // RLS itself denies because current_user_can_manage_recruiter_opportunities
    // is false for the ineligible profile. This proves the eligibility gate
    // remains authoritative — the recruiter-normalization path cannot be
    // exploited to publish without meeting eligibility.
    let denied = false;
    try {
      await asUser(INELIGIBLE_UID, async (c) => {
        await c.query(
          `INSERT INTO public.opportunities
             (recruiter_id, title, company_name, status)
           VALUES ($1, 'POST Ineligible', 'Incomplete Co', 'active')`,
          [INELIGIBLE_RECRUITER_ID],
        );
      });
    } catch (err) {
      denied = true;
      expect(String((err as Error).message)).toMatch(/row-level security|violates/i);
    }
    expect(denied).toBe(true);

    // Extra proof: no ineligible-owned row ever ended up approved + published.
    const rows = await q<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.opportunities
        WHERE recruiter_id = $1
          AND admin_review_status = 'approved'
          AND published_at IS NOT NULL`,
      [INELIGIBLE_RECRUITER_ID],
    );
    expect(Number(rows[0].count)).toBe(0);
  });
});

describe('Phase 1K-A2 — real PostgreSQL catalog proofs of the corrected guard', () => {
  it('function language is plpgsql, prosecdef=true, and search_path is pinned to public', async () => {
    const rows = await q<{
      lanname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
    }>(
      `SELECT l.lanname, p.prosecdef, p.proconfig
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname = 'public' AND p.proname = 'opportunities_guard'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lanname).toBe('plpgsql');
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toBeTruthy();
    expect(rows[0].proconfig!.some((c) => c === 'search_path=public')).toBe(true);
  });

  it('exactly one non-internal trigger uses opportunities_guard on public.opportunities and is enabled', async () => {
    const rows = await q<{ tgname: string; tgenabled: string }>(
      `SELECT t.tgname, t.tgenabled::text
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE n.nspname = 'public'
          AND c.relname = 'opportunities'
          AND p.proname = 'opportunities_guard'
          AND NOT t.tgisinternal`,
    );
    expect(rows).toHaveLength(1);
    // tgenabled 'O' = origin/enabled (default)
    expect(['O', 'A']).toContain(rows[0].tgenabled);
  });

  it('pg_get_functiondef contains owner-aware admin classification (A1 correction)', async () => {
    const rows = await q<{ def: string }>(
      `SELECT pg_get_functiondef('public.opportunities_guard()'::regprocedure) AS def`,
    );
    const def = rows[0].def;
    expect(def).toMatch(/_owns_recruiter_profile/);
    expect(def).toMatch(/_is_explicit_admin_moderation/);
    expect(def).toMatch(/_is_admin AND NOT _owns_recruiter_profile/);
  });

  it('no unconditional top-level admin bypass remains', async () => {
    const rows = await q<{ def: string }>(
      `SELECT pg_get_functiondef('public.opportunities_guard()'::regprocedure) AS def`,
    );
    const def = rows[0].def;
    // The vulnerable pre-A1 body opens with `BEGIN\n  IF public.is_admin(auth.uid()) THEN\n    RETURN NEW;`
    // as the very first executable statement. The A1 correction must eliminate
    // that unconditional early-exit.
    expect(def).not.toMatch(
      /BEGIN\s*\n\s*IF\s+public\.is_admin\(auth\.uid\(\)\)\s+THEN\s*\n\s*RETURN\s+NEW\s*;/,
    );
  });
});

describe('Phase 1K-A2 — candidate idempotency', () => {
  it('reapplying the A1 candidate SQL succeeds and preserves catalog properties', async () => {
    await pool.query(CANDIDATE_SQL);

    const rows = await q<{
      lanname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
    }>(
      `SELECT l.lanname, p.prosecdef, p.proconfig
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname = 'public' AND p.proname = 'opportunities_guard'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lanname).toBe('plpgsql');
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig?.some((c) => c === 'search_path=public')).toBe(true);

    const trg = await q<{ tgname: string }>(
      `SELECT t.tgname FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE n.nspname = 'public' AND c.relname = 'opportunities'
          AND p.proname = 'opportunities_guard' AND NOT t.tgisinternal`,
    );
    expect(trg).toHaveLength(1);

    // And the corrected behavior is still in force after reapply.
    const row = await insertAsAdminOwn('active', 'POST Idempotency Reapply');
    expect(row.admin_review_status).toBe('approved');
    expect(row.published_at).not.toBeNull();
  });
});
