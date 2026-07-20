/**
 * Phase 1J-D2B-1 — Real PostgreSQL 16 gate for the recruiter paid-plan
 * entitlement resolver.
 *
 * Mirrors the PGlite behavioral suite in
 * `src/test/phase1jD2B1RecruiterPaidEntitlementResolver.test.ts` but exercises
 * the candidate SQL against a real PostgreSQL 16 database so ACL, SECURITY
 * DEFINER binding, `auth.uid()` GUC semantics, and catalog behavior all reflect
 * production reality.
 *
 * Lives OUTSIDE `src/` so the default `bunx vitest run` never picks it up.
 * Runs only via `vitest.phase1j-d2b1-postgres.config.ts` (locally or in CI).
 *
 * NEVER SKIPS. Fails hard if PHASE1J_D2B1_DATABASE_URL is absent.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.PHASE1J_D2B1_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'PHASE1J_D2B1_DATABASE_URL is required for the Phase 1J-D2B-1 real-Postgres 16 gate.',
  );
}
const URL_STR: string = DATABASE_URL;

const CANDIDATE_PATH = fileURLToPath(
  new URL(
    '../../supabase/migration-candidates/20260720203000_phase1j_d2b1_recruiter_paid_entitlement_resolver.sql',
    import.meta.url,
  ),
);

const CANONICAL_PATH = fileURLToPath(
  new URL(
    '../../supabase/migrations/20260513052701_cf07b84d-9518-4159-8771-b2b353578e54.sql',
    import.meta.url,
  ),
);

/**
 * Deterministically slice the exact recruiter_billing_profiles table block
 * from the canonical migration, starting at the CREATE TABLE line and ending
 * immediately before the ENABLE ROW LEVEL SECURITY line. Never hand-copied.
 */
function extractBillingTableBlock(): string {
  const src = readFileSync(CANONICAL_PATH, 'utf8');
  const startMarker = 'CREATE TABLE IF NOT EXISTS public.recruiter_billing_profiles (';
  const endMarker =
    'ALTER TABLE public.recruiter_billing_profiles ENABLE ROW LEVEL SECURITY;';
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error('canonical: start marker not found');
  const endIdx = src.indexOf(endMarker, start);
  if (endIdx < 0) throw new Error('canonical: end marker not found');
  return src.slice(start, endIdx);
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

CREATE TABLE IF NOT EXISTS public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recruiter_profiles TO authenticated, service_role;
`;

const RESET_SQL = `
DROP FUNCTION IF EXISTS public.current_user_has_recruiter_minimum_paid_plan(text) CASCADE;
DROP FUNCTION IF EXISTS public._recruiter_has_minimum_paid_plan(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public._recruiter_paid_plan_rank(text) CASCADE;
DROP TABLE IF EXISTS public.recruiter_billing_profiles CASCADE;
DROP TABLE IF EXISTS public.recruiter_profiles CASCADE;
DROP TABLE IF EXISTS auth.users CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS auth.uid() CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
`;

const pool = new pg.Pool({ connectionString: URL_STR, max: 6 });

async function q<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

async function asAuthenticated<T>(
  userId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
) {
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

async function createUser(): Promise<string> {
  const id = randomUUID();
  await q(`INSERT INTO auth.users(id, email) VALUES ($1,$2)`, [
    id,
    `${id}@t.test`,
  ]);
  return id;
}

async function createRecruiter(userId: string): Promise<string> {
  const rows = await q<{ id: string }>(
    `INSERT INTO public.recruiter_profiles(user_id) VALUES ($1) RETURNING id`,
    [userId],
  );
  return rows[0].id;
}

async function insertBilling(
  recruiterId: string,
  userId: string,
  plan: string,
  status: string,
) {
  await q(
    `INSERT INTO public.recruiter_billing_profiles(recruiter_id, user_id, plan, status)
     VALUES ($1,$2,$3,$4)`,
    [recruiterId, userId, plan, status],
  );
}

async function rank(plan: string | null): Promise<number> {
  const rows = await q<{ r: number }>(
    `SELECT public._recruiter_paid_plan_rank($1)::int AS r`,
    [plan],
  );
  return rows[0].r;
}

async function recHas(
  recruiterId: string | null,
  min: string | null,
): Promise<boolean> {
  const rows = await q<{ ok: boolean }>(
    `SELECT public._recruiter_has_minimum_paid_plan($1,$2) AS ok`,
    [recruiterId, min],
  );
  return rows[0].ok;
}

async function curHasAs(
  userId: string | null,
  min: string | null,
): Promise<boolean> {
  return await asAuthenticated(userId, async (client) => {
    const r = await client.query(
      `SELECT public.current_user_has_recruiter_minimum_paid_plan($1) AS ok`,
      [min],
    );
    return (r.rows[0] as { ok: boolean }).ok;
  });
}

let CANONICAL_BLOCK = '';
let CANDIDATE_SQL = '';
let PRE_FN_COUNT = 0;
let PRE_TABLE_COUNT = 0;
let PRE_POLICY_COUNT = 0;
let PRE_TRIGGER_COUNT = 0;
let POST_FN_COUNT = 0;
let POST_TABLE_COUNT = 0;
let POST_POLICY_COUNT = 0;
let POST_TRIGGER_COUNT = 0;

async function countPublicFns(): Promise<number> {
  const r = await q<{ c: string }>(
    `SELECT count(*)::int AS c FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'`,
  );
  return Number(r[0].c);
}
async function countPublicTables(): Promise<number> {
  const r = await q<{ c: string }>(
    `SELECT count(*)::int AS c FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`,
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
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal`,
  );
  return Number(r[0].c);
}

beforeAll(async () => {
  await pool.query(RESET_SQL);
  await pool.query(BOOTSTRAP_SQL);

  CANONICAL_BLOCK = extractBillingTableBlock();
  await pool.query(CANONICAL_BLOCK);
  // Grants for the canonical table so the authenticated role can read/write it
  // through the resolver call sites.
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON public.recruiter_billing_profiles TO authenticated, service_role;`,
  );

  PRE_FN_COUNT = await countPublicFns();
  PRE_TABLE_COUNT = await countPublicTables();
  PRE_POLICY_COUNT = await countPolicies();
  PRE_TRIGGER_COUNT = await countUserTriggers();

  CANDIDATE_SQL = readFileSync(CANDIDATE_PATH, 'utf8');
  await pool.query(CANDIDATE_SQL);

  POST_FN_COUNT = await countPublicFns();
  POST_TABLE_COUNT = await countPublicTables();
  POST_POLICY_COUNT = await countPolicies();
  POST_TRIGGER_COUNT = await countUserTriggers();
});

afterAll(async () => {
  await pool.query(RESET_SQL);
  await pool.end();
});

// ---------------------------------------------------------------------------
describe('Phase 1J-D2B-1 · Postgres environment', () => {
  it('running against real PostgreSQL 16', async () => {
    const [row] = await q<{ n: string }>(
      `SELECT current_setting('server_version_num') AS n`,
    );
    const n = Number(row.n);
    expect(n).toBeGreaterThanOrEqual(160000);
    expect(n).toBeLessThan(170000);
  });
});

describe('Phase 1J-D2B-1 · canonical billing block extraction', () => {
  it('extracted block contains both exact CHECK constraints', () => {
    expect(CANONICAL_BLOCK).toContain(
      "CONSTRAINT recruiter_billing_plan_chk CHECK (plan IN ('none','starter','growth','fleet'))",
    );
    expect(CANONICAL_BLOCK).toContain(
      "CONSTRAINT recruiter_billing_status_chk CHECK (status IN ('inactive','active','past_due','canceled','trialing'))",
    );
  });

  it('extracted block starts at CREATE TABLE and stops before ENABLE ROW LEVEL SECURITY', () => {
    expect(
      CANONICAL_BLOCK.startsWith(
        'CREATE TABLE IF NOT EXISTS public.recruiter_billing_profiles (',
      ),
    ).toBe(true);
    expect(CANONICAL_BLOCK).not.toContain('ENABLE ROW LEVEL SECURITY');
    expect(CANONICAL_BLOCK).not.toContain('CREATE TRIGGER');
    expect(CANONICAL_BLOCK).not.toContain('CREATE POLICY');
  });
});

describe('Phase 1J-D2B-1 · candidate source guards', () => {
  it('candidate SQL contains no table/policy/trigger/view/index/enum/type DDL', () => {
    const forbidden = [
      /\bCREATE\s+TABLE\b/i,
      /\bALTER\s+TABLE\b/i,
      /\bDROP\s+TABLE\b/i,
      /\bCREATE\s+(OR\s+REPLACE\s+)?POLICY\b/i,
      /\bALTER\s+POLICY\b/i,
      /\bDROP\s+POLICY\b/i,
      /\bCREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i,
      /\bDROP\s+TRIGGER\b/i,
      /\bCREATE\s+(OR\s+REPLACE\s+)?VIEW\b/i,
      /\bCREATE\s+(UNIQUE\s+)?INDEX\b/i,
      /\bCREATE\s+TYPE\b/i,
      /\bCREATE\s+(OR\s+REPLACE\s+)?ENUM\b/i,
      /\bCREATE\s+SCHEMA\b/i,
    ];
    for (const re of forbidden) {
      expect(CANDIDATE_SQL, `candidate must not contain ${re}`).not.toMatch(re);
    }
  });

  it('candidate SQL contains no DML (INSERT/UPDATE/DELETE/TRUNCATE)', () => {
    for (const re of [
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+\w/i,
      /\bDELETE\s+FROM\b/i,
      /\bTRUNCATE\b/i,
    ]) {
      expect(CANDIDATE_SQL).not.toMatch(re);
    }
  });

  it('candidate SQL does not mention free_verified or recruiter_has_priority_plan', () => {
    expect(CANDIDATE_SQL).not.toMatch(/free_verified/i);
    expect(CANDIDATE_SQL).not.toMatch(/recruiter_has_priority_plan/i);
  });

  it('candidate status allowlist contains exactly active and trialing (both clauses)', () => {
    const matches = [...CANDIDATE_SQL.matchAll(/status\s+IN\s*\(([^)]*)\)/gi)];
    expect(matches.length).toBe(2);
    for (const m of matches) {
      const body = m[1].replace(/\s+/g, '');
      expect(body).toBe("'active','trialing'");
    }
  });
});

describe('Phase 1J-D2B-1 · catalog delta', () => {
  it('candidate adds exactly three public functions', () => {
    expect(POST_FN_COUNT - PRE_FN_COUNT).toBe(3);
  });
  it('candidate adds no public tables', () => {
    expect(POST_TABLE_COUNT - PRE_TABLE_COUNT).toBe(0);
  });
  it('candidate adds no RLS policies', () => {
    expect(POST_POLICY_COUNT - PRE_POLICY_COUNT).toBe(0);
  });
  it('candidate adds no non-internal triggers', () => {
    expect(POST_TRIGGER_COUNT - PRE_TRIGGER_COUNT).toBe(0);
  });
});

describe('Phase 1J-D2B-1 · catalog signature proof', () => {
  const expected = [
    { name: '_recruiter_paid_plan_rank', args: '_plan text', rtype: 'smallint' },
    {
      name: '_recruiter_has_minimum_paid_plan',
      args: '_recruiter_id uuid, _minimum_plan text',
      rtype: 'boolean',
    },
    {
      name: 'current_user_has_recruiter_minimum_paid_plan',
      args: '_minimum_plan text',
      rtype: 'boolean',
    },
  ];

  it('all three functions have exactly one overload, exact identity args, exact result types', async () => {
    for (const { name, args, rtype } of expected) {
      const rows = await q<{ args: string; rtype: string }>(
        `SELECT pg_get_function_identity_arguments(p.oid) AS args,
                pg_catalog.format_type(p.prorettype, NULL) AS rtype
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname='public' AND p.proname=$1`,
        [name],
      );
      expect(rows.length, `expected exactly one overload of public.${name}`).toBe(
        1,
      );
      expect(rows[0].args).toBe(args);
      expect(rows[0].rtype).toBe(rtype);
    }
    const caller = expected.find(
      (e) => e.name === 'current_user_has_recruiter_minimum_paid_plan',
    )!;
    expect(caller.args).not.toMatch(/user_id/i);
    expect(caller.args).not.toMatch(/recruiter_id/i);
  });

  it('SECURITY DEFINER binding matches spec (rank INVOKER, resolvers DEFINER)', async () => {
    const rows = await q<{ name: string; secdef: boolean }>(
      `SELECT p.proname AS name, p.prosecdef AS secdef
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public'
          AND p.proname IN (
            '_recruiter_paid_plan_rank',
            '_recruiter_has_minimum_paid_plan',
            'current_user_has_recruiter_minimum_paid_plan'
          )
        ORDER BY p.proname`,
    );
    const map = Object.fromEntries(rows.map((r) => [r.name, r.secdef]));
    expect(map._recruiter_has_minimum_paid_plan).toBe(true);
    expect(map.current_user_has_recruiter_minimum_paid_plan).toBe(true);
  });

  it('EXECUTE ACL: rank/internal are service_role only; caller-bound is authenticated + service_role', async () => {
    const rows = await q<{ name: string; grantee: string }>(
      `SELECT p.proname AS name, r.rolname AS grantee
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
         JOIN pg_roles r ON r.oid = a.grantee
        WHERE n.nspname='public'
          AND p.proname IN (
            '_recruiter_paid_plan_rank',
            '_recruiter_has_minimum_paid_plan',
            'current_user_has_recruiter_minimum_paid_plan'
          )
          AND a.privilege_type = 'EXECUTE'
          AND r.rolname IN ('anon','authenticated','service_role')
        ORDER BY p.proname, r.rolname`,
    );
    const bucket: Record<string, Set<string>> = {};
    for (const row of rows) {
      (bucket[row.name] ??= new Set()).add(row.grantee);
    }
    expect([...(bucket._recruiter_paid_plan_rank ?? [])].sort()).toEqual([
      'service_role',
    ]);
    expect([...(bucket._recruiter_has_minimum_paid_plan ?? [])].sort()).toEqual([
      'service_role',
    ]);
    expect(
      [...(bucket.current_user_has_recruiter_minimum_paid_plan ?? [])].sort(),
    ).toEqual(['authenticated', 'service_role']);
  });
});

describe('Phase 1J-D2B-1 · rank matrix (case-sensitive)', () => {
  const zeros: Array<string | null> = [
    null,
    'none',
    'unknown',
    'free',
    'standard',
    'free_verified',
    'STARTER',
    'Growth',
  ];
  it.each(zeros)('rank(%p) === 0', async (plan) => {
    expect(await rank(plan)).toBe(0);
  });
  it('rank("starter") === 1', async () => expect(await rank('starter')).toBe(1));
  it('rank("growth") === 2', async () => expect(await rank('growth')).toBe(2));
  it('rank("fleet") === 3', async () => expect(await rank('fleet')).toBe(3));
});

describe('Phase 1J-D2B-1 · identity separation', () => {
  it('recruiter_id entitles; passing the row.user_id in its place does not', async () => {
    const u = await createUser();
    const rid = await createRecruiter(u);
    expect(rid).not.toBe(u);
    await insertBilling(rid, u, 'growth', 'active');
    expect(await recHas(rid, 'starter')).toBe(true);
    expect(await recHas(u, 'starter')).toBe(false);
  });
});

describe('Phase 1J-D2B-1 · plan × status entitlement matrix', () => {
  const PLANS = ['none', 'starter', 'growth', 'fleet'] as const;
  const STATUSES = [
    'inactive',
    'active',
    'past_due',
    'canceled',
    'trialing',
  ] as const;
  const MINS = ['starter', 'growth', 'fleet'] as const;

  const expected = (plan: string, status: string, min: string): boolean => {
    if (status !== 'active' && status !== 'trialing') return false;
    if (plan === 'none') return false;
    const r: Record<string, number> = { starter: 1, growth: 2, fleet: 3 };
    return r[plan] >= r[min];
  };

  for (const plan of PLANS) {
    for (const status of STATUSES) {
      for (const min of MINS) {
        it(`plan=${plan} status=${status} min=${min} -> ${expected(plan, status, min)}`, async () => {
          const u = await createUser();
          const rid = await createRecruiter(u);
          await insertBilling(rid, u, plan, status);
          expect(await recHas(rid, min)).toBe(expected(plan, status, min));
        });
      }
    }
  }
});

describe('Phase 1J-D2B-1 · invalid minimums always false', () => {
  let rid = '';
  beforeAll(async () => {
    const u = await createUser();
    rid = await createRecruiter(u);
    await insertBilling(rid, u, 'fleet', 'active');
  });
  const invalids: Array<string | null> = [
    null,
    'none',
    'free',
    'standard',
    'free_verified',
    'unknown',
    'STARTER',
    'Growth',
  ];
  it.each(invalids)('min=%p resolves false even for fleet/active row', async (m) => {
    expect(await recHas(rid, m)).toBe(false);
  });
});

describe('Phase 1J-D2B-1 · missing billing row', () => {
  it('recruiter with no billing row -> false', async () => {
    const u = await createUser();
    const rid = await createRecruiter(u);
    expect(await recHas(rid, 'starter')).toBe(false);
  });

  it('null internal identity -> false', async () => {
    expect(await recHas(null, 'starter')).toBe(false);
  });
});

describe('Phase 1J-D2B-1 · status transitions', () => {
  it('active growth -> canceled flips entitlement to false', async () => {
    const u = await createUser();
    const rid = await createRecruiter(u);
    await insertBilling(rid, u, 'growth', 'active');
    expect(await recHas(rid, 'growth')).toBe(true);
    await q(
      `UPDATE public.recruiter_billing_profiles SET status='canceled' WHERE recruiter_id=$1`,
      [rid],
    );
    expect(await recHas(rid, 'growth')).toBe(false);
    expect(await recHas(rid, 'starter')).toBe(false);
  });
});

describe('Phase 1J-D2B-1 · plan downgrade', () => {
  it('growth -> starter: starter true, growth false, exactly one row preserved', async () => {
    const u = await createUser();
    const rid = await createRecruiter(u);
    await insertBilling(rid, u, 'growth', 'active');
    await q(
      `UPDATE public.recruiter_billing_profiles SET plan='starter' WHERE recruiter_id=$1`,
      [rid],
    );
    const rows = await q<{ c: string }>(
      `SELECT count(*)::int AS c FROM public.recruiter_billing_profiles WHERE recruiter_id=$1`,
      [rid],
    );
    expect(Number(rows[0].c)).toBe(1);
    expect(await recHas(rid, 'starter')).toBe(true);
    expect(await recHas(rid, 'growth')).toBe(false);
  });
});

describe('Phase 1J-D2B-1 · caller-bound isolation (real authenticated role)', () => {
  it('current_user_has_... follows auth.uid() bound at session level', async () => {
    const uA = await createUser();
    const uB = await createUser();
    const ridA = await createRecruiter(uA);
    await createRecruiter(uB); // no billing row for B
    await insertBilling(ridA, uA, 'growth', 'active');

    expect(await curHasAs(uA, 'starter')).toBe(true);
    expect(await curHasAs(uA, 'growth')).toBe(true);
    expect(await curHasAs(uA, 'fleet')).toBe(false);

    expect(await curHasAs(uB, 'starter')).toBe(false);
    expect(await curHasAs(uB, 'growth')).toBe(false);

    expect(await curHasAs(null, 'starter')).toBe(false);
  });
});

describe('Phase 1J-D2B-1 · unrelated-GUC spoof proof', () => {
  it('setting app.user_id to a paid user does not entitle a different auth.uid()', async () => {
    const uA = await createUser();
    const uB = await createUser();
    const ridA = await createRecruiter(uA);
    await createRecruiter(uB);
    await insertBilling(ridA, uA, 'growth', 'active');

    // Sanity: A is entitled.
    expect(await curHasAs(uA, 'growth')).toBe(true);

    // B, even when app.user_id is spoofed to A, must not be entitled.
    await asAuthenticated(uB, async (client) => {
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [uA]);
      const r = await client.query(
        `SELECT public.current_user_has_recruiter_minimum_paid_plan('starter') AS ok,
                public.current_user_has_recruiter_minimum_paid_plan('growth')  AS ok2`,
      );
      const row = r.rows[0] as { ok: boolean; ok2: boolean };
      expect(row.ok).toBe(false);
      expect(row.ok2).toBe(false);
    });
  });
});

describe('Phase 1J-D2B-1 · read-only invariance', () => {
  it('resolver calls leave billing columns byte-equivalent', async () => {
    const u = await createUser();
    const rid = await createRecruiter(u);
    await insertBilling(rid, u, 'fleet', 'trialing');

    const snap = async () =>
      (
        await q<Record<string, unknown>>(
          `SELECT id, recruiter_id, user_id, plan, status, active_opportunity_limit,
                  stripe_customer_id, stripe_subscription_id, current_period_end, created_at
             FROM public.recruiter_billing_profiles WHERE recruiter_id=$1`,
          [rid],
        )
      )[0];

    const before = await snap();

    for (const m of ['starter', 'growth', 'fleet', 'none', null] as const) {
      await recHas(rid, m);
      await rank(m);
      await curHasAs(u, m);
    }

    const after = await snap();
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});
