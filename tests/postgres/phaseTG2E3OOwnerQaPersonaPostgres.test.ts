/**
 * Phase TG-2E3-O2 — Real PostgreSQL gate for the Owner QA entitlement
 * candidate.
 *
 * Exercises the FULL candidate SQL (including F4 `opportunities_billing_guard`)
 * against a real PostgreSQL database so ACL, SECURITY DEFINER binding,
 * `auth.uid()` GUC semantics, RLS, CHECK constraints, trigger behaviour, and
 * expiry all reflect production reality.
 *
 * Lives OUTSIDE `src/` so the default `bunx vitest run` never picks it up.
 * No repository Vitest config targets it; run it with an ad-hoc config created
 * at runtime (for example under /tmp) that includes only this file.
 *
 * NEVER SKIPS. Fails hard if TG2E3O2_DATABASE_URL is absent.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.TG2E3O2_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'TG2E3O2_DATABASE_URL is required for the Phase TG-2E3-O2 real-Postgres gate.',
  );
}
const URL_STR: string = DATABASE_URL;

const CANDIDATE_SQL = readFileSync(
  fileURLToPath(
    new URL(
      '../../supabase/migration-candidates/20260820200000_phase_tg2e3_o2_owner_qa_entitlement.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

/**
 * Minimal production-faithful scaffold: only the objects the candidate
 * genuinely depends on. Nothing here weakens or re-implements the candidate's
 * own authorization logic.
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

-- --- F4 scaffold: minimum objects the candidate guard genuinely needs ---
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

-- TEST-ONLY controllable permission resolver. Fail-closed by default; each
-- transaction may flip it via SET LOCAL "test.perm_allow". The candidate SQL is
-- never modified to accommodate this.
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

-- TEST-ONLY wrapper mapping the real candidate tier resolver to live limits.
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

/** The full candidate is applied verbatim, F4 included. */
const TRIGGER_SQL = `
DROP TRIGGER IF EXISTS opportunities_billing_guard_trg ON public.opportunities;
CREATE TRIGGER opportunities_billing_guard_trg
BEFORE INSERT OR UPDATE ON public.opportunities
FOR EACH ROW EXECUTE FUNCTION public.opportunities_billing_guard();
`;


const pool = new pg.Pool({ connectionString: URL_STR, max: 4 });

const OWNER = randomUUID();
const OTHER_ADMIN = randomUUID();
const PLAIN_USER = randomUUID();
let recruiterId = '';
let agencyId = '';

async function asUser<T>(
  uid: string | null,
  fn: (c: pg.PoolClient) => Promise<T>,
  role = 'authenticated',
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(
      `SELECT set_config('request.jwt.claim.sub', $1, true)`,
      [uid ?? ''],
    );
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

beforeAll(async () => {
  await pool.query(SCAFFOLD);
  await pool.query(CANDIDATE_SQL);
  await pool.query(TRIGGER_SQL);


  await pool.query(
    `INSERT INTO auth.users(id) VALUES ($1),($2),($3)`,
    [OWNER, OTHER_ADMIN, PLAIN_USER],
  );
  await pool.query(
    `INSERT INTO public.admin_users(user_id, role) VALUES ($1,'super_admin'),($2,'admin')`,
    [OWNER, OTHER_ADMIN],
  );

  const r = await pool.query(
    `INSERT INTO public.recruiter_profiles(user_id) VALUES ($1) RETURNING id`,
    [OWNER],
  );
  recruiterId = r.rows[0].id;

  const a = await pool.query(
    `INSERT INTO public.agency_profiles(owner_user_id) VALUES ($1) RETURNING id`,
    [OWNER],
  );
  agencyId = a.rows[0].id;
}, 60_000);

afterAll(async () => {
  await pool.end();
});

describe('owner_qa_sessions table hardening', () => {
  it('enables RLS and grants no write privilege to authenticated', async () => {
    const rls = await pool.query(
      `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.owner_qa_sessions'::regclass`,
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);

    const privs = await pool.query(
      `SELECT privilege_type FROM information_schema.table_privileges
       WHERE table_schema='public' AND table_name='owner_qa_sessions' AND grantee='authenticated'`,
    );
    expect(privs.rows.map((r) => r.privilege_type).sort()).toEqual(['SELECT']);
  });

  it('grants anon nothing at all', async () => {
    const privs = await pool.query(
      `SELECT privilege_type FROM information_schema.table_privileges
       WHERE table_schema='public' AND table_name='owner_qa_sessions' AND grantee='anon'`,
    );
    expect(privs.rowCount).toBe(0);
  });

  it('has exactly one SELECT-only policy', async () => {
    const pol = await pool.query(
      `SELECT policyname, cmd FROM pg_policies
       WHERE schemaname='public' AND tablename='owner_qa_sessions'`,
    );
    expect(pol.rows).toEqual([
      { policyname: 'owner_qa_sessions_owner_select', cmd: 'SELECT' },
    ]);
  });

  it('rejects invalid domain/persona pairs at the constraint level', async () => {
    await expect(
      pool.query(
        `INSERT INTO public.owner_qa_sessions(user_id, domain, persona, expires_at)
         VALUES ($1,'driver','starter', now() + interval '10 min')`,
        [OWNER],
      ),
    ).rejects.toThrow(/owner_qa_sessions_persona_check/);
    await expect(
      pool.query(
        `INSERT INTO public.owner_qa_sessions(user_id, domain, persona, expires_at)
         VALUES ($1,'admin','free', now() + interval '10 min')`,
        [OWNER],
      ),
    ).rejects.toThrow(/owner_qa_sessions_domain_check/);
  });
});

describe('QA mutation authorization', () => {
  it('rejects an unauthenticated caller', async () => {
    await expect(
      asUser(null, (c) =>
        c.query(`SELECT public.set_owner_qa_persona('driver','free')`),
      ),
    ).rejects.toThrow(/owner_qa_not_authorized/);
  });

  it('rejects a plain authenticated user', async () => {
    await expect(
      asUser(PLAIN_USER, (c) =>
        c.query(`SELECT public.set_owner_qa_persona('driver','free')`),
      ),
    ).rejects.toThrow(/owner_qa_not_authorized/);
  });

  it('rejects a non-super admin', async () => {
    await expect(
      asUser(OTHER_ADMIN, (c) =>
        c.query(`SELECT public.set_owner_qa_persona('driver','free')`),
      ),
    ).rejects.toThrow(/owner_qa_not_authorized/);
    await expect(
      asUser(OTHER_ADMIN, (c) =>
        c.query(`SELECT public.disable_owner_qa_persona()`),
      ),
    ).rejects.toThrow(/owner_qa_not_authorized/);
  });

  it('rejects an invalid persona from the owner', async () => {
    await expect(
      asUser(OWNER, (c) =>
        c.query(`SELECT public.set_owner_qa_persona('driver','fleet')`),
      ),
    ).rejects.toThrow(/owner_qa_persona_invalid/);
  });

  it('revokes EXECUTE on the internal primitive from browser roles', async () => {
    for (const role of ['authenticated', 'anon']) {
      const r = await pool.query(
        `SELECT has_function_privilege($1, 'public._owner_qa_persona_for(uuid)', 'EXECUTE') AS ok`,
        [role],
      );
      expect(r.rows[0].ok).toBe(false);
    }
  });
});

describe('QA session lifecycle and audit', () => {
  it('sets, reads back, and audits a persona for the owner only', async () => {
    await asUser(OWNER, (c) =>
      c.query(`SELECT public.set_owner_qa_persona('driver','pro_yearly')`),
    );

    const mine = await asUser(OWNER, (c) =>
      c.query(`SELECT * FROM public.current_owner_qa_persona()`),
    );
    expect(mine.rows[0].domain).toBe('driver');
    expect(mine.rows[0].persona).toBe('pro_yearly');

    const theirs = await asUser(PLAIN_USER, (c) =>
      c.query(`SELECT * FROM public.current_owner_qa_persona()`),
    );
    expect(theirs.rowCount).toBe(0);

    const audit = await pool.query(
      `SELECT action FROM public.admin_audit_log
       WHERE admin_user_id = $1 AND action = 'owner_qa_persona_set'`,
      [OWNER],
    );
    expect(audit.rowCount).toBeGreaterThanOrEqual(1);
  });

  it('enforces single-domain semantics — switching replaces, never stacks', async () => {
    await asUser(OWNER, (c) =>
      c.query(`SELECT public.set_owner_qa_persona('recruiter','growth')`),
    );
    const rows = await pool.query(
      `SELECT domain, persona FROM public.owner_qa_sessions WHERE user_id = $1`,
      [OWNER],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toEqual({ domain: 'recruiter', persona: 'growth' });
  });

  it('disables cleanly and audits the exit', async () => {
    const off = await asUser(OWNER, (c) =>
      c.query(`SELECT public.disable_owner_qa_persona() AS ok`),
    );
    expect(off.rows[0].ok).toBe(true);

    const after = await asUser(OWNER, (c) =>
      c.query(`SELECT * FROM public.current_owner_qa_persona()`),
    );
    expect(after.rowCount).toBe(0);

    const audit = await pool.query(
      `SELECT action FROM public.admin_audit_log
       WHERE admin_user_id = $1 AND action = 'owner_qa_persona_disabled'`,
      [OWNER],
    );
    expect(audit.rowCount).toBeGreaterThanOrEqual(1);
  });

  it('ignores an expired session', async () => {
    await asUser(OWNER, (c) =>
      c.query(`SELECT public.set_owner_qa_persona('driver','free')`),
    );
    await pool.query(
      `UPDATE public.owner_qa_sessions
          SET created_at = now() - interval '3 hours',
              expires_at = now() - interval '1 minute'
        WHERE user_id = $1`,
      [OWNER],
    );
    const r = await asUser(OWNER, (c) =>
      c.query(`SELECT * FROM public.current_owner_qa_persona()`),
    );
    expect(r.rowCount).toBe(0);
  });
});

describe('driver_has_active_pro QA overlay', () => {
  it('is admin-forced Pro with QA off (original behaviour preserved)', async () => {
    await asUser(OWNER, (c) =>
      c.query(`SELECT public.disable_owner_qa_persona()`),
    );
    const r = await asUser(OWNER, (c) =>
      c.query(`SELECT public.driver_has_active_pro($1) AS pro`, [OWNER]),
    );
    expect(r.rows[0].pro).toBe(true);
  });

  it('reports Free honestly under the driver free persona', async () => {
    const r = await asUser(OWNER, async (c) => {
      await c.query(`SELECT public.set_owner_qa_persona('driver','free')`);
      return c.query(`SELECT public.driver_has_active_pro($1) AS pro`, [OWNER]);
    });
    expect(r.rows[0].pro).toBe(false);
  });

  it('never leaks the overlay to another user identity', async () => {
    const r = await asUser(OWNER, async (c) => {
      await c.query(`SELECT public.set_owner_qa_persona('driver','pro_yearly')`);
      return c.query(`SELECT public.driver_has_active_pro($1) AS pro`, [
        PLAIN_USER,
      ]);
    });
    expect(r.rows[0].pro).toBe(false);
  });

  it('leaves real subscription evaluation intact for non-QA users', async () => {
    await pool.query(
      `INSERT INTO public.subscriptions(user_id, status, plan_key)
       VALUES ($1,'active','pro_monthly')`,
      [PLAIN_USER],
    );
    const r = await asUser(PLAIN_USER, (c) =>
      c.query(`SELECT public.driver_has_active_pro($1) AS pro`, [PLAIN_USER]),
    );
    expect(r.rows[0].pro).toBe(true);
  });
});

describe('effective_recruiter_tier QA overlay', () => {
  it('returns the selected paid tier for the owner\'s own recruiter profile', async () => {
    const r = await asUser(OWNER, async (c) => {
      await c.query(`SELECT public.set_owner_qa_persona('recruiter','fleet')`);
      return c.query(`SELECT public.effective_recruiter_tier($1) AS tier`, [
        recruiterId,
      ]);
    });
    expect(r.rows[0].tier).toBe('fleet');
  });

  it('maps free_verified to free_standard', async () => {
    const r = await asUser(OWNER, async (c) => {
      await c.query(
        `SELECT public.set_owner_qa_persona('recruiter','free_verified')`,
      );
      return c.query(`SELECT public.effective_recruiter_tier($1) AS tier`, [
        recruiterId,
      ]);
    });
    expect(r.rows[0].tier).toBe('free_standard');
  });

  it('never applies to a recruiter profile the caller does not own', async () => {
    const foreign = await pool.query(
      `INSERT INTO public.recruiter_profiles(user_id) VALUES ($1) RETURNING id`,
      [PLAIN_USER],
    );
    const r = await asUser(OWNER, async (c) => {
      await c.query(`SELECT public.set_owner_qa_persona('recruiter','fleet')`);
      return c.query(`SELECT public.effective_recruiter_tier($1) AS tier`, [
        foreign.rows[0].id,
      ]);
    });
    expect(r.rows[0].tier).toBe('free_standard');
  });

  it('never writes to recruiter_billing_profiles', async () => {
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM public.recruiter_billing_profiles`,
    );
    await asUser(OWNER, async (c) => {
      await c.query(`SELECT public.set_owner_qa_persona('recruiter','growth')`);
      await c.query(`SELECT public.effective_recruiter_tier($1)`, [recruiterId]);
    });
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM public.recruiter_billing_profiles`,
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe('get_effective_agency_limits QA overlay', () => {
  it('returns real plan defaults for a paid agency persona', async () => {
    const r = await asUser(OWNER, async (c) => {
      await c.query(
        `SELECT public.set_owner_qa_persona('agency','agency_growth')`,
      );
      return c.query(
        `SELECT * FROM public.get_effective_agency_limits($1)`,
        [agencyId],
      );
    });
    expect(r.rows[0].plan_key).toBe('agency_growth');
    expect(r.rows[0].status).toBe('active');
    expect(r.rows[0].member_limit).toBe(15);
    expect(r.rows[0].has_entitlement_row).toBe(true);
  });

  it('fails closed for assistant_free exactly like a missing row', async () => {
    const r = await asUser(OWNER, async (c) => {
      await c.query(
        `SELECT public.set_owner_qa_persona('agency','assistant_free')`,
      );
      return c.query(
        `SELECT * FROM public.get_effective_agency_limits($1)`,
        [agencyId],
      );
    });
    expect(r.rows[0].plan_key).toBe('agency_starter');
    expect(r.rows[0].status).toBe('cancelled');
    expect(r.rows[0].has_entitlement_row).toBe(false);
  });

  it('never applies to an agency the caller does not own', async () => {
    const foreign = await pool.query(
      `INSERT INTO public.agency_profiles(owner_user_id) VALUES ($1) RETURNING id`,
      [PLAIN_USER],
    );
    await pool.query(
      `INSERT INTO public.agency_entitlements(agency_id, plan_key, status, source)
       VALUES ($1,'agency_starter','active','stripe')`,
      [foreign.rows[0].id],
    );
    const r = await asUser(OWNER, async (c) => {
      await c.query(
        `SELECT public.set_owner_qa_persona('agency','agency_growth')`,
      );
      return c.query(`SELECT * FROM public.get_effective_agency_limits($1)`, [
        foreign.rows[0].id,
      ]);
    });
    expect(r.rows[0].plan_key).toBe('agency_starter');
  });

  it('never writes to agency_entitlements', async () => {
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM public.agency_entitlements`,
    );
    await asUser(OWNER, async (c) => {
      await c.query(`SELECT public.set_owner_qa_persona('agency','agency_team')`);
      await c.query(`SELECT * FROM public.get_effective_agency_limits($1)`, [
        agencyId,
      ]);
    });
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM public.agency_entitlements`,
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

/**
 * F4 — opportunities_billing_guard, exercised as a real BEFORE INSERT/UPDATE
 * trigger against the applied candidate.
 */
async function asUserWithPerm<T>(
  uid: string,
  permAllow: boolean,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return asUser(uid, async (c) => {
    await c.query(`SELECT set_config('test.perm_allow', $1, true)`, [
      permAllow ? 'true' : 'false',
    ]);
    return fn(c);
  });
}

async function setPersona(domain: string, persona: string) {
  await asUser(OWNER, (c) =>
    c.query(`SELECT public.set_owner_qa_persona($1,$2)`, [domain, persona]),
  );
}

async function seedActive(count: number) {
  await pool.query(`DELETE FROM public.opportunities WHERE recruiter_id = $1`, [
    recruiterId,
  ]);
  await pool.query(
    `ALTER TABLE public.opportunities DISABLE TRIGGER opportunities_billing_guard_trg`,
  );
  try {
    for (let i = 0; i < count; i += 1) {
      await pool.query(
        `INSERT INTO public.opportunities(recruiter_id, status) VALUES ($1,'active')`,
        [recruiterId],
      );
    }
  } finally {
    await pool.query(
      `ALTER TABLE public.opportunities ENABLE TRIGGER opportunities_billing_guard_trg`,
    );
  }
}

const INSERT_ACTIVE = `INSERT INTO public.opportunities(recruiter_id, status) VALUES ($1,'active') RETURNING id`;

describe('F4 opportunities_billing_guard QA overlay', () => {
  it('preserves the existing admin bypass when QA is off', async () => {
    await asUser(OWNER, (c) =>
      c.query(`SELECT public.disable_owner_qa_persona()`),
    );
    // Far above any free-tier limit, and the permission resolver says NO.
    await seedActive(40);

    const r = await asUserWithPerm(OWNER, false, (c) =>
      c.query(INSERT_ACTIVE, [recruiterId]),
    );
    expect(r.rowCount).toBe(1);
  });

  it('does NOT let a QA recruiter owner bypass the permission check', async () => {
    await setPersona('recruiter', 'starter');
    await seedActive(0);

    await expect(
      asUserWithPerm(OWNER, false, (c) => c.query(INSERT_ACTIVE, [recruiterId])),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('enforces the selected starter limit of 5 for a QA recruiter owner', async () => {
    await setPersona('recruiter', 'starter');
    await seedActive(5);

    let err: any;
    try {
      await asUserWithPerm(OWNER, true, (c) =>
        c.query(INSERT_ACTIVE, [recruiterId]),
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('23514');
    const detail = JSON.parse(err.detail);
    expect(detail.code).toBe('active_opportunity_limit_reached');
    expect(detail.limit).toBe(5);
    expect(detail.active_count).toBe(5);
  });

  it('enforces the free_verified limit of 1', async () => {
    await setPersona('recruiter', 'free_verified');
    await seedActive(1);

    let err: any;
    try {
      await asUserWithPerm(OWNER, true, (c) =>
        c.query(INSERT_ACTIVE, [recruiterId]),
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    const detail = JSON.parse(err.detail);
    expect(detail.code).toBe('active_opportunity_limit_reached');
    expect(detail.limit).toBe(1);
  });

  it('allows an insert below the fleet limit of 25', async () => {
    await setPersona('recruiter', 'fleet');
    await seedActive(10);

    const r = await asUserWithPerm(OWNER, true, (c) =>
      c.query(INSERT_ACTIVE, [recruiterId]),
    );
    expect(r.rowCount).toBe(1);
  });

  it('leaves the non-super-admin bypass entirely unchanged', async () => {
    const otherRecruiter = await pool.query(
      `INSERT INTO public.recruiter_profiles(user_id) VALUES ($1) RETURNING id`,
      [OTHER_ADMIN],
    );
    const r = await asUserWithPerm(OTHER_ADMIN, false, (c) =>
      c.query(INSERT_ACTIVE, [otherRecruiter.rows[0].id]),
    );
    expect(r.rowCount).toBe(1);
  });

  it('writes no billing rows while enforcing QA limits', async () => {
    const before = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM public.recruiter_billing_profiles) AS rbp,
         (SELECT count(*)::int FROM public.agency_entitlements) AS ae,
         (SELECT count(*)::int FROM public.subscriptions) AS subs`,
    );
    await setPersona('recruiter', 'growth');
    await seedActive(2);
    await asUserWithPerm(OWNER, true, (c) => c.query(INSERT_ACTIVE, [recruiterId]));
    const after = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM public.recruiter_billing_profiles) AS rbp,
         (SELECT count(*)::int FROM public.agency_entitlements) AS ae,
         (SELECT count(*)::int FROM public.subscriptions) AS subs`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
