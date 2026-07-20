// @vitest-environment node
// =====================================================================
// Phase 1J-D2B-1 — Recruiter paid entitlement resolver (PGlite runtime)
//
// Loads the candidate SQL on top of a minimal Supabase-compatible
// bootstrap and the canonical recruiter_billing_profiles table+index
// block extracted verbatim from migration 20260513052701. Proves the
// full rank/plan/status matrix, caller-bound isolation, identity
// separation (recruiter_id vs user_id), byte-equivalent read-only
// behavior, and structural guards on the candidate SQL.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

const CANDIDATE_REL =
  '../../supabase/migration-candidates/20260720203000_phase1j_d2b1_recruiter_paid_entitlement_resolver.sql';
const CANONICAL_REL =
  '../../supabase/migrations/20260513052701_cf07b84d-9518-4159-8771-b2b353578e54.sql';

const read = (rel: string) =>
  fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/**
 * Deterministically slice the exact recruiter_billing_profiles table +
 * index block from the canonical migration, starting at the CREATE TABLE
 * line and ending immediately before the ENABLE ROW LEVEL SECURITY line.
 * Never hand-copied.
 */
function extractBillingTableBlock(): string {
  const src = read(CANONICAL_REL);
  const startMarker = 'CREATE TABLE IF NOT EXISTS public.recruiter_billing_profiles (';
  const endMarker =
    'ALTER TABLE public.recruiter_billing_profiles ENABLE ROW LEVEL SECURITY;';
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error('canonical: start marker not found');
  const endIdx = src.indexOf(endMarker, start);
  if (endIdx < 0) throw new Error('canonical: end marker not found');
  return src.slice(start, endIdx);
}

const BOOTSTRAP = `

CREATE SCHEMA IF NOT EXISTS auth;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE
);
`;

const uid = (n: number) =>
  `${n.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`;

async function setUid(db: AnyPGlite, user: string | null) {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [
    user ?? '',
  ]);
}

async function makeUser(db: AnyPGlite, id: string) {
  await db.query(`INSERT INTO auth.users(id, email) VALUES ($1, $2)`, [
    id,
    `${id}@t.test`,
  ]);
}

/**
 * Insert a recruiter_profiles row for owner user; return its id (which
 * becomes the recruiter_id referenced by recruiter_billing_profiles).
 */
async function makeRecruiter(db: AnyPGlite, userId: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.recruiter_profiles(user_id) VALUES ($1) RETURNING id`,
    [userId],
  );
  return r.rows[0].id;
}

async function insertBilling(
  db: AnyPGlite,
  recruiterId: string,
  userId: string,
  plan: string,
  status: string,
) {
  await db.query(
    `INSERT INTO public.recruiter_billing_profiles(recruiter_id, user_id, plan, status)
     VALUES ($1,$2,$3,$4)`,
    [recruiterId, userId, plan, status],
  );
}

async function rank(db: AnyPGlite, plan: string | null): Promise<number> {
  const r = await db.query<{ r: number }>(
    `SELECT public._recruiter_paid_plan_rank($1)::int AS r`,
    [plan],
  );
  return r.rows[0].r;
}

async function recHas(
  db: AnyPGlite,
  recruiterId: string | null,
  min: string | null,
): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>(
    `SELECT public._recruiter_has_minimum_paid_plan($1,$2) AS ok`,
    [recruiterId, min],
  );
  return r.rows[0].ok;
}

async function curHas(db: AnyPGlite, min: string | null): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>(
    `SELECT public.current_user_has_recruiter_minimum_paid_plan($1) AS ok`,
    [min],
  );
  return r.rows[0].ok;
}

let db: AnyPGlite;
let CANDIDATE_SQL: string;
let CANONICAL_BLOCK: string;
let PRE_FN_COUNT: number;
let PRE_TABLE_COUNT: number;
let PRE_POLICY_COUNT: number;
let PRE_TRIGGER_COUNT: number;
let POST_FN_COUNT: number;
let POST_TABLE_COUNT: number;
let POST_POLICY_COUNT: number;
let POST_TRIGGER_COUNT: number;

async function countPublicFns(d: AnyPGlite): Promise<number> {
  const r = await d.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'`,
  );
  return r.rows[0].c;
}
async function countPublicTables(d: AnyPGlite): Promise<number> {
  const r = await d.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`,
  );
  return r.rows[0].c;
}
async function countPolicies(d: AnyPGlite): Promise<number> {
  const r = await d.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM pg_policies WHERE schemaname='public'`,
  );
  return r.rows[0].c;
}
async function countUserTriggers(d: AnyPGlite): Promise<number> {
  const r = await d.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal`,
  );
  return r.rows[0].c;
}

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;
  await db.exec(BOOTSTRAP);
  CANONICAL_BLOCK = extractBillingTableBlock();
  await db.exec(CANONICAL_BLOCK);

  PRE_FN_COUNT = await countPublicFns(db);
  PRE_TABLE_COUNT = await countPublicTables(db);
  PRE_POLICY_COUNT = await countPolicies(db);
  PRE_TRIGGER_COUNT = await countUserTriggers(db);

  CANDIDATE_SQL = read(CANDIDATE_REL);
  await db.exec(CANDIDATE_SQL);

  POST_FN_COUNT = await countPublicFns(db);
  POST_TABLE_COUNT = await countPublicTables(db);
  POST_POLICY_COUNT = await countPolicies(db);
  POST_TRIGGER_COUNT = await countUserTriggers(db);
});

describe('Phase 1J-D2B-1 — canonical billing block extraction (proof 12)', () => {
  it('extracted block contains both exact CHECK constraints', () => {
    expect(CANONICAL_BLOCK).toContain(
      "CONSTRAINT recruiter_billing_plan_chk CHECK (plan IN ('none','starter','growth','fleet'))",
    );
    expect(CANONICAL_BLOCK).toContain(
      "CONSTRAINT recruiter_billing_status_chk CHECK (status IN ('inactive','active','past_due','canceled','trialing'))",
    );
  });

  it('extracted block contains all four canonical plan literals', () => {
    for (const p of ['none', 'starter', 'growth', 'fleet']) {
      expect(CANONICAL_BLOCK).toContain(`'${p}'`);
    }
  });

  it('extracted block contains all five canonical status literals', () => {
    for (const s of ['inactive', 'active', 'past_due', 'canceled', 'trialing']) {
      expect(CANONICAL_BLOCK).toContain(`'${s}'`);
    }
  });

  it('extracted block starts at CREATE TABLE and stops before ENABLE ROW LEVEL SECURITY', () => {
    expect(CANONICAL_BLOCK.startsWith('CREATE TABLE IF NOT EXISTS public.recruiter_billing_profiles (')).toBe(true);
    expect(CANONICAL_BLOCK).not.toContain('ENABLE ROW LEVEL SECURITY');
    expect(CANONICAL_BLOCK).not.toContain('CREATE TRIGGER');
    expect(CANONICAL_BLOCK).not.toContain('CREATE POLICY');
  });
});

describe('Phase 1J-D2B-1 — candidate source guards (proof 10)', () => {
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
    for (const re of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w/i, /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i]) {
      expect(CANDIDATE_SQL).not.toMatch(re);
    }
  });

  it('candidate SQL does not mention free_verified or recruiter_has_priority_plan', () => {
    expect(CANDIDATE_SQL).not.toMatch(/free_verified/i);
    expect(CANDIDATE_SQL).not.toMatch(/recruiter_has_priority_plan/i);
  });

  it('candidate status allowlist contains exactly active and trialing', () => {
    // Find every status IN (...) clause and assert both bodies are the exact
    // two-status allowlist. Whitespace-insensitive comparison.
    const matches = [...CANDIDATE_SQL.matchAll(/status\s+IN\s*\(([^)]*)\)/gi)];
    expect(matches.length, 'expected two status IN (...) clauses in candidate').toBe(2);
    for (const m of matches) {
      const body = m[1].replace(/\s+/g, '');
      expect(body).toBe("'active','trialing'");
    }
  });
});

describe('Phase 1J-D2B-1 — catalog delta (proof 11)', () => {
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

describe('Phase 1J-D2B-1 — rank matrix (proof 1)', () => {
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
    expect(await rank(db, plan)).toBe(0);
  });
  it('rank("starter") === 1', async () => expect(await rank(db, 'starter')).toBe(1));
  it('rank("growth") === 2', async () => expect(await rank(db, 'growth')).toBe(2));
  it('rank("fleet") === 3', async () => expect(await rank(db, 'fleet')).toBe(3));
});

describe('Phase 1J-D2B-1 — identity separation (proof 2)', () => {
  it('recruiter_id entitles; passing the row.user_id in its place must not', async () => {
    const u = uid(0xa1);
    await makeUser(db, u);
    const rid = await makeRecruiter(db, u);
    // Guarantee recruiter.id !== user_id for this test's purposes.
    expect(rid).not.toBe(u);
    await insertBilling(db, rid, u, 'growth', 'active');

    expect(await recHas(db, rid, 'starter')).toBe(true);
    // Passing the user_id as the recruiter_id must resolve to false.
    expect(await recHas(db, u, 'starter')).toBe(false);
  });
});

describe('Phase 1J-D2B-1 — plan × status entitlement matrix (proof 3)', () => {
  const PLANS = ['none', 'starter', 'growth', 'fleet'] as const;
  const STATUSES = ['inactive', 'active', 'past_due', 'canceled', 'trialing'] as const;
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
          // Fresh recruiter + row per case so we exercise a single stored row.
          const u = uid(0xb0000 + PLANS.indexOf(plan) * 100 + STATUSES.indexOf(status) * 10 + MINS.indexOf(min));
          await makeUser(db, u);
          const rid = await makeRecruiter(db, u);
          await insertBilling(db, rid, u, plan, status);
          expect(await recHas(db, rid, min)).toBe(expected(plan, status, min));
        });
      }
    }
  }
});

describe('Phase 1J-D2B-1 — invalid minimums always false (proof 4)', () => {
  let rid: string;
  beforeAll(async () => {
    const u = uid(0xc1);
    await makeUser(db, u);
    rid = await makeRecruiter(db, u);
    await insertBilling(db, rid, u, 'fleet', 'active');
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
    expect(await recHas(db, rid, m)).toBe(false);
  });
});

describe('Phase 1J-D2B-1 — missing billing row (proof 5)', () => {
  it('recruiter with no billing row -> false', async () => {
    const u = uid(0xd1);
    await makeUser(db, u);
    const rid = await makeRecruiter(db, u);
    expect(await recHas(db, rid, 'starter')).toBe(false);
  });
});

describe('Phase 1J-D2B-1 — status transitions (proof 6)', () => {
  it('active growth -> canceled: entitlement flips to false', async () => {
    const u = uid(0xe1);
    await makeUser(db, u);
    const rid = await makeRecruiter(db, u);
    await insertBilling(db, rid, u, 'growth', 'active');
    expect(await recHas(db, rid, 'growth')).toBe(true);
    await db.query(
      `UPDATE public.recruiter_billing_profiles SET status='canceled' WHERE recruiter_id=$1`,
      [rid],
    );
    expect(await recHas(db, rid, 'growth')).toBe(false);
    expect(await recHas(db, rid, 'starter')).toBe(false);
  });
});

describe('Phase 1J-D2B-1 — plan downgrade (proof 7)', () => {
  it('growth downgraded to starter: starter true, growth false, row preserved', async () => {
    const u = uid(0xe2);
    await makeUser(db, u);
    const rid = await makeRecruiter(db, u);
    await insertBilling(db, rid, u, 'growth', 'active');
    await db.query(
      `UPDATE public.recruiter_billing_profiles SET plan='starter' WHERE recruiter_id=$1`,
      [rid],
    );
    const rows = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.recruiter_billing_profiles WHERE recruiter_id=$1`,
      [rid],
    );
    expect(rows.rows[0].c).toBe(1);
    expect(await recHas(db, rid, 'starter')).toBe(true);
    expect(await recHas(db, rid, 'growth')).toBe(false);
  });
});

describe('Phase 1J-D2B-1 — caller-bound isolation (proof 8)', () => {
  it('current_user_has_... follows auth.uid() and has no identity parameter', async () => {
    const uA = uid(0xf1);
    const uB = uid(0xf2);
    await makeUser(db, uA);
    await makeUser(db, uB);
    const ridA = await makeRecruiter(db, uA);
    await makeRecruiter(db, uB); // no billing row
    await insertBilling(db, ridA, uA, 'growth', 'active');

    await setUid(db, uA);
    expect(await curHas(db, 'starter')).toBe(true);
    expect(await curHas(db, 'growth')).toBe(true);
    expect(await curHas(db, 'fleet')).toBe(false);

    await setUid(db, uB);
    expect(await curHas(db, 'starter')).toBe(false);
    expect(await curHas(db, 'growth')).toBe(false);

    await setUid(db, null);
    expect(await curHas(db, 'starter')).toBe(false);
  });
});

describe('Phase 1J-D2B-1 — read-only invariance (proof 9)', () => {
  it('resolver calls leave selected billing columns byte-equivalent', async () => {
    const u = uid(0xf9);
    await makeUser(db, u);
    const rid = await makeRecruiter(db, u);
    await insertBilling(db, rid, u, 'fleet', 'trialing');

    const snap = async () =>
      (
        await db.query<Record<string, unknown>>(
          `SELECT id, recruiter_id, user_id, plan, status, active_opportunity_limit,
                  stripe_customer_id, stripe_subscription_id, current_period_end, created_at
             FROM public.recruiter_billing_profiles WHERE recruiter_id=$1`,
          [rid],
        )
      ).rows[0];

    const before = await snap();

    await setUid(db, u);
    for (const m of ['starter', 'growth', 'fleet', 'none', null] as const) {
      await recHas(db, rid, m);
      await curHas(db, m);
      await rank(db, m);
    }

    const after = await snap();
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});
