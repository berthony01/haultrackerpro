// @vitest-environment node
// =====================================================================
// Phase 1R-E1-R1 — Pricing / entitlement candidate SQL RUNTIME PROOF (PGlite)
//
// Loads the Phase 1R-E1-R1 candidate SQL on top of a minimal
// Supabase-compatible bootstrap and exercises the real trigger path on
// public.opportunities. Proves the entitlement matrix, the fail-closed
// conflict behavior, slot accounting on real transitions only, unlimited
// drafts, and the narrow backfill.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

const CANDIDATE_REL =
  '../../supabase/migration-candidates/20260801013000_phase1r_e1_pricing_entitlement_alignment.sql';

const CANDIDATE_SQL = fs.readFileSync(
  fileURLToPath(new URL(CANDIDATE_REL, import.meta.url)),
  'utf8',
);

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

-- Admin flag is driven by a settable GUC so the bypass can be exercised
-- without inventing an admin table this phase does not own.
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT _user_id IS NOT NULL
       AND COALESCE(current_setting('test.is_admin', true), '') = 'yes'
  $$;

CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  ready boolean NOT NULL DEFAULT true
);

-- Canonical readiness helper (production name and signature).
CREATE OR REPLACE FUNCTION public.current_user_can_manage_recruiter_opportunities(
  _recruiter_id uuid
) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.recruiter_profiles rp
      WHERE rp.id = _recruiter_id
        AND rp.user_id = auth.uid()
        AND rp.ready
    )
  $$;

CREATE TABLE public.recruiter_billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  -- Phase 1R-E1-R2 — production-shaped identity and Stripe period columns.
  user_id uuid,
  plan text NOT NULL DEFAULT 'none',
  status text NOT NULL DEFAULT 'inactive',
  active_opportunity_limit integer NOT NULL DEFAULT 0,
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE public.agency_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public.agency_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.agency_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  plan_key text NOT NULL,
  status text NOT NULL,
  source text NOT NULL
);

CREATE TABLE public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'job',
  status text NOT NULL DEFAULT 'draft'
);

-- Placeholder guard replaced by the candidate. The trigger is created ONCE
-- here and is never re-created by the candidate, proving the candidate
-- swaps only the function body.
CREATE OR REPLACE FUNCTION public.opportunities_billing_guard()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;

CREATE TRIGGER trg_opportunities_billing_guard
BEFORE INSERT OR UPDATE ON public.opportunities
FOR EACH ROW EXECUTE FUNCTION public.opportunities_billing_guard();
`;

const uid = (n: number) =>
  `${n.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`;

async function setUid(db: AnyPGlite, user: string | null) {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [
    user ?? '',
  ]);
}

async function setAdmin(db: AnyPGlite, on: boolean) {
  await db.query(`SELECT set_config('test.is_admin', $1, false)`, [
    on ? 'yes' : 'no',
  ]);
}

async function boot(applyCandidate = true): Promise<AnyPGlite> {
  const db = new PGlite() as unknown as AnyPGlite;
  await db.exec(BOOTSTRAP);
  if (applyCandidate) await db.exec(CANDIDATE_SQL);
  await setAdmin(db, false);
  return db;
}

let seq = 100;
async function makeRecruiter(
  db: AnyPGlite,
  opts: { ready?: boolean } = {},
): Promise<{ userId: string; recruiterId: string }> {
  const userId = uid(seq++);
  await db.query(`INSERT INTO auth.users(id, email) VALUES ($1, $2)`, [
    userId,
    `${userId}@t.test`,
  ]);
  const res = await db.query<{ id: string }>(
    `INSERT INTO public.recruiter_profiles(user_id, ready) VALUES ($1, $2) RETURNING id`,
    [userId, opts.ready ?? true],
  );
  return { userId, recruiterId: res.rows[0].id };
}

async function giveRecruiterPlan(
  db: AnyPGlite,
  recruiterId: string,
  plan: string,
  status = 'active',
) {
  await db.query(
    `INSERT INTO public.recruiter_billing_profiles(recruiter_id, plan, status) VALUES ($1,$2,$3)`,
    [recruiterId, plan, status],
  );
}

async function giveAgencyPlan(
  db: AnyPGlite,
  userId: string,
  planKey: string,
  opts: {
    memberRole?: string;
    memberStatus?: string;
    status?: string;
    source?: string;
    ownerUserId?: string;
  } = {},
) {
  const agency = await db.query<{ id: string }>(
    `INSERT INTO public.agency_profiles(owner_user_id) VALUES ($1) RETURNING id`,
    [opts.ownerUserId ?? userId],
  );
  const agencyId = agency.rows[0].id;
  await db.query(
    `INSERT INTO public.agency_members(agency_id, member_user_id, role, status) VALUES ($1,$2,$3,$4)`,
    [
      agencyId,
      userId,
      opts.memberRole ?? 'agency_owner',
      opts.memberStatus ?? 'active',
    ],
  );
  await db.query(
    `INSERT INTO public.agency_entitlements(agency_id, plan_key, status, source) VALUES ($1,$2,$3,$4)`,
    [agencyId, planKey, opts.status ?? 'active', opts.source ?? 'stripe'],
  );
  return agencyId;
}

async function tier(db: AnyPGlite, recruiterId: string) {
  const r = await db.query<{ t: string }>(
    `SELECT public.effective_recruiter_tier($1) AS t`,
    [recruiterId],
  );
  return r.rows[0].t;
}

async function limitOf(db: AnyPGlite, recruiterId: string) {
  const r = await db.query<{ l: number }>(
    `SELECT public.effective_recruiter_active_opportunity_limit($1) AS l`,
    [recruiterId],
  );
  return r.rows[0].l;
}

async function activate(db: AnyPGlite, recruiterId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await db.query(
      `INSERT INTO public.opportunities(recruiter_id, status, title) VALUES ($1,'active',$2)`,
      [recruiterId, `job-${i}`],
    );
  }
}

interface CaughtError {
  message: string;
  detail: string;
  code: string;
}

async function expectFailure(fn: () => Promise<unknown>): Promise<CaughtError> {
  try {
    await fn();
  } catch (e) {
    const err = e as { message?: string; detail?: string; code?: string };
    return {
      message: String(err.message ?? ''),
      detail: String(err.detail ?? ''),
      code: String(err.code ?? ''),
    };
  }
  throw new Error('expected the statement to fail, but it succeeded');
}

async function activeCount(db: AnyPGlite, recruiterId: string) {
  const r = await db.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM public.opportunities WHERE recruiter_id = $1 AND status = 'active'`,
    [recruiterId],
  );
  return r.rows[0].c;
}

// ---------------------------------------------------------------------------

describe('Phase 1R-E1-R1 PGlite — entitlement resolution', () => {
  let db: AnyPGlite;
  beforeAll(async () => {
    db = await boot();
  });

  it('(a) free recruiter with no billing row resolves to free_standard / 1', async () => {
    const { recruiterId } = await makeRecruiter(db);
    expect(await tier(db, recruiterId)).toBe('free_standard');
    expect(await limitOf(db, recruiterId)).toBe(1);
  });

  it('(b) recruiter starter/growth/fleet resolve to 5/15/25', async () => {
    for (const [plan, expected] of [
      ['starter', 5],
      ['growth', 15],
      ['fleet', 25],
    ] as const) {
      const { recruiterId } = await makeRecruiter(db);
      await giveRecruiterPlan(db, recruiterId, plan);
      expect(await tier(db, recruiterId)).toBe(plan);
      expect(await limitOf(db, recruiterId)).toBe(expected);
    }
  });

  it('(b2) non-paying recruiter billing rows never grant premium', async () => {
    for (const status of ['canceled', 'past_due', 'incomplete', 'unpaid']) {
      const { recruiterId } = await makeRecruiter(db);
      await giveRecruiterPlan(db, recruiterId, 'growth', status);
      expect(await tier(db, recruiterId)).toBe('free_standard');
      expect(await limitOf(db, recruiterId)).toBe(1);
    }
  });

  it('(c) agency-owner inclusion maps starter/team/growth to 5/15/25', async () => {
    for (const [planKey, expectedTier, expectedLimit] of [
      ['agency_starter', 'starter', 5],
      ['agency_team', 'growth', 15],
      ['agency_growth', 'fleet', 25],
    ] as const) {
      const { userId, recruiterId } = await makeRecruiter(db);
      await giveAgencyPlan(db, userId, planKey);
      expect(await tier(db, recruiterId)).toBe(expectedTier);
      expect(await limitOf(db, recruiterId)).toBe(expectedLimit);
    }
  });

  it('(c2) non-owner membership, inactive membership, foreign-owned agency, manual_beta source, and unpaid status grant nothing', async () => {
    const cases: Array<Parameters<typeof giveAgencyPlan>[3]> = [
      { memberRole: 'agency_member' },
      { memberStatus: 'invited' },
      { source: 'manual_beta' },
      { status: 'cancelled' },
    ];
    for (const opts of cases) {
      const { userId, recruiterId } = await makeRecruiter(db);
      await giveAgencyPlan(db, userId, 'agency_growth', opts);
      expect(await tier(db, recruiterId)).toBe('free_standard');
      expect(await limitOf(db, recruiterId)).toBe(1);
    }

    // Membership exists, but the agency profile is owned by someone else.
    const other = await makeRecruiter(db);
    const { userId, recruiterId } = await makeRecruiter(db);
    await giveAgencyPlan(db, userId, 'agency_growth', {
      ownerUserId: other.userId,
    });
    expect(await tier(db, recruiterId)).toBe('free_standard');
    expect(await limitOf(db, recruiterId)).toBe(1);
  });

  it('(c3) picks the highest qualifying agency tier deterministically', async () => {
    const { userId, recruiterId } = await makeRecruiter(db);
    await giveAgencyPlan(db, userId, 'agency_starter');
    await giveAgencyPlan(db, userId, 'agency_growth');
    expect(await tier(db, recruiterId)).toBe('fleet');
    expect(await limitOf(db, recruiterId)).toBe(25);
  });

  it('(d) dual paid business entitlement resolves to conflict / 0 — never a free fallback', async () => {
    const { userId, recruiterId } = await makeRecruiter(db);
    await giveRecruiterPlan(db, recruiterId, 'starter');
    await giveAgencyPlan(db, userId, 'agency_growth');
    expect(await tier(db, recruiterId)).toBe('conflict');
    expect(await limitOf(db, recruiterId)).toBe(0);
  });

  it('(d2) unknown recruiter id fails closed to free_standard, never to premium', async () => {
    expect(await tier(db, uid(9999))).toBe('free_standard');
    const r = await db.query<{ t: string | null }>(
      `SELECT public.effective_recruiter_tier(NULL) AS t`,
    );
    expect(r.rows[0].t).toBe('free_standard');
  });

  it('(e) priority plan is true only for growth and fleet', async () => {
    const expectations: Array<[string | null, boolean]> = [
      [null, false],
      ['starter', false],
      ['growth', true],
      ['fleet', true],
    ];
    for (const [plan, expected] of expectations) {
      const { recruiterId } = await makeRecruiter(db);
      if (plan) await giveRecruiterPlan(db, recruiterId, plan);
      const r = await db.query<{ p: boolean }>(
        `SELECT public.recruiter_has_priority_plan($1) AS p`,
        [recruiterId],
      );
      expect(r.rows[0].p).toBe(expected);
    }

    // A conflicted account is never priority.
    const { userId, recruiterId } = await makeRecruiter(db);
    await giveRecruiterPlan(db, recruiterId, 'fleet');
    await giveAgencyPlan(db, userId, 'agency_growth');
    const r = await db.query<{ p: boolean }>(
      `SELECT public.recruiter_has_priority_plan($1) AS p`,
      [recruiterId],
    );
    expect(r.rows[0].p).toBe(false);
  });
});

describe('Phase 1R-E1-R1 PGlite — opportunities guard', () => {
  let db: AnyPGlite;
  beforeAll(async () => {
    db = await boot();
  });

  it('(f) free recruiter can activate exactly one, then is blocked with structured detail', async () => {
    const { userId, recruiterId } = await makeRecruiter(db);
    await setUid(db, userId);
    await activate(db, recruiterId, 1);
    expect(await activeCount(db, recruiterId)).toBe(1);

    const err = await expectFailure(() => activate(db, recruiterId, 1));
    expect(err.message).toContain('Active opportunity limit reached.');
    expect(err.code).toBe('23514');
    const detail = JSON.parse(err.detail) as Record<string, unknown>;
    expect(detail).toMatchObject({
      code: 'active_opportunity_limit_reached',
      limit: 1,
      active_count: 1,
    });
    expect(await activeCount(db, recruiterId)).toBe(1);
  });

  it('(g) starter recruiter can activate exactly five, then is blocked at the sixth', async () => {
    const { userId, recruiterId } = await makeRecruiter(db);
    await giveRecruiterPlan(db, recruiterId, 'starter');
    await setUid(db, userId);
    await activate(db, recruiterId, 5);
    expect(await activeCount(db, recruiterId)).toBe(5);
    const err = await expectFailure(() => activate(db, recruiterId, 1));
    expect(err.message).toContain('Active opportunity limit reached.');
    expect(JSON.parse(err.detail).limit).toBe(5);
    expect(await activeCount(db, recruiterId)).toBe(5);
  });

  it('(h) a conflicted account cannot activate anything at all', async () => {
    const { userId, recruiterId } = await makeRecruiter(db);
    await giveRecruiterPlan(db, recruiterId, 'growth');
    await giveAgencyPlan(db, userId, 'agency_team');
    await setUid(db, userId);
    const err = await expectFailure(() => activate(db, recruiterId, 1));
    expect(err.code).toBe('23514');
    expect(JSON.parse(err.detail).code).toBe('business_entitlement_conflict');
    expect(await activeCount(db, recruiterId)).toBe(0);
  });

  it('(h2) an unready recruiter profile is blocked by the readiness helper, not by billing', async () => {
    const { userId, recruiterId } = await makeRecruiter(db, { ready: false });
    await giveRecruiterPlan(db, recruiterId, 'growth');
    await setUid(db, userId);
    const err = await expectFailure(() =>
      db.query(
        `INSERT INTO public.opportunities(recruiter_id, status) VALUES ($1,'draft')`,
        [recruiterId],
      ),
    );
    expect(err.message).toContain(
      'Complete your recruiter profile to publish opportunities.',
    );
    expect(err.code).toBe('42501');
  });

  it('(i) editing an already-active opportunity never re-consumes a slot, even when over the ceiling', async () => {
    const { userId, recruiterId } = await makeRecruiter(db);
    await setUid(db, userId);
    await activate(db, recruiterId, 1);

    // Seed a historical over-limit state without the guard.
    await db.exec(
      `ALTER TABLE public.opportunities DISABLE TRIGGER trg_opportunities_billing_guard;`,
    );
    await activate(db, recruiterId, 3);
    await db.exec(
      `ALTER TABLE public.opportunities ENABLE TRIGGER trg_opportunities_billing_guard;`,
    );
    expect(await activeCount(db, recruiterId)).toBe(4);

    await db.query(
      `UPDATE public.opportunities SET title = 'renamed' WHERE recruiter_id = $1 AND status = 'active'`,
      [recruiterId],
    );
    expect(await activeCount(db, recruiterId)).toBe(4);
  });

  it('(g2) growth recruiter activates exactly 15 and is blocked at the 16th', async () => {
    const { userId, recruiterId } = await makeRecruiter(db);
    await giveRecruiterPlan(db, recruiterId, 'growth', 'active');
    await setUid(db, userId);
    await activate(db, recruiterId, 15);
    expect(await activeCount(db, recruiterId)).toBe(15);

    const err = await expectFailure(() => activate(db, recruiterId, 1));
    expect(err.code).toBe('23514');
    expect(err.message).toContain('Active opportunity limit reached.');
    expect(JSON.parse(err.detail)).toMatchObject({
      code: 'active_opportunity_limit_reached',
      limit: 15,
      active_count: 15,
    });
    expect(await activeCount(db, recruiterId)).toBe(15);
  });

  it('(g3) trialing fleet recruiter activates exactly 25 and is blocked at the 26th', async () => {
    const { userId, recruiterId } = await makeRecruiter(db);
    // trial-allowlist: Stripe subscription status literal
    await giveRecruiterPlan(db, recruiterId, 'fleet', 'trialing');
    await setUid(db, userId);
    await activate(db, recruiterId, 25);
    expect(await activeCount(db, recruiterId)).toBe(25);

    const err = await expectFailure(() => activate(db, recruiterId, 1));
    expect(err.code).toBe('23514');
    expect(err.message).toContain('Active opportunity limit reached.');
    expect(JSON.parse(err.detail)).toMatchObject({
      code: 'active_opportunity_limit_reached',
      limit: 25,
      active_count: 25,
    });
    expect(await activeCount(db, recruiterId)).toBe(25);
  });

  it('(j) a paused listing cannot be reactivated once another listing has taken the freed slot', async () => {
    const { userId, recruiterId } = await makeRecruiter(db);
    await setUid(db, userId);

    const first = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities(recruiter_id, status, title) VALUES ($1,'active','first') RETURNING id`,
      [recruiterId],
    );
    const firstId = first.rows[0].id;

    const second = await db.query<{ id: string }>(
      `INSERT INTO public.opportunities(recruiter_id, status, title) VALUES ($1,'draft','second') RETURNING id`,
      [recruiterId],
    );
    const secondId = second.rows[0].id;

    // 1) active -> paused frees the single free-tier slot.
    await db.query(
      `UPDATE public.opportunities SET status = 'paused' WHERE id = $1`,
      [firstId],
    );
    expect(await activeCount(db, recruiterId)).toBe(0);

    // 2) the other listing takes the freed slot.
    await db.query(
      `UPDATE public.opportunities SET status = 'active' WHERE id = $1`,
      [secondId],
    );
    expect(await activeCount(db, recruiterId)).toBe(1);

    // 3) paused -> active on the original is blocked while the slot is full.
    const err = await expectFailure(() =>
      db.query(`UPDATE public.opportunities SET status = 'active' WHERE id = $1`, [
        firstId,
      ]),
    );
    expect(err.code).toBe('23514');
    expect(JSON.parse(err.detail)).toMatchObject({
      code: 'active_opportunity_limit_reached',
      limit: 1,
      active_count: 1,
    });

    const still = await db.query<{ status: string }>(
      `SELECT status FROM public.opportunities WHERE id = $1`,
      [firstId],
    );
    expect(still.rows[0].status).toBe('paused');
    expect(await activeCount(db, recruiterId)).toBe(1);
  });


  it('(k) drafts are unlimited for a free recruiter', async () => {
    const { userId, recruiterId } = await makeRecruiter(db);
    await setUid(db, userId);
    for (let i = 0; i < 50; i++) {
      await db.query(
        `INSERT INTO public.opportunities(recruiter_id, status, title) VALUES ($1,'draft',$2)`,
        [recruiterId, `draft-${i}`],
      );
    }
    const r = await db.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM public.opportunities WHERE recruiter_id = $1 AND status = 'draft'`,
      [recruiterId],
    );
    expect(r.rows[0].c).toBe(50);
    expect(await activeCount(db, recruiterId)).toBe(0);
  });

  it('(l) admins bypass the guard entirely', async () => {
    const { userId, recruiterId } = await makeRecruiter(db);
    await setUid(db, userId);
    await activate(db, recruiterId, 1);
    await setAdmin(db, true);
    await activate(db, recruiterId, 3);
    expect(await activeCount(db, recruiterId)).toBe(4);
    await setAdmin(db, false);
  });
});

describe('Phase 1R-E1-R1 PGlite — narrow backfill', () => {
  it('(m) corrects only active_opportunity_limit and leaves every other column byte-identical', async () => {
    const db = await boot(false);
    const a = await makeRecruiter(db);
    const b = await makeRecruiter(db);
    const c = await makeRecruiter(db);

    // Phase 1R-E1-R2 — every production-shaped column carries a DISTINCT
    // seeded value so any collateral write by the backfill is detectable.
    await db.query(
      `INSERT INTO public.recruiter_billing_profiles
         (recruiter_id, user_id, plan, status, active_opportunity_limit,
          stripe_customer_id, stripe_subscription_id, current_period_end, updated_at)
       VALUES
         ($1,$2,'none','inactive',   0, 'cus_a','sub_a','2031-01-01T00:00:00Z','2020-01-01T00:00:00Z'),
         ($3,$4,'growth','active',   5, 'cus_b','sub_b','2031-02-02T00:00:00Z','2020-01-02T00:00:00Z'),
         ($5,$6,'fleet','canceled', 25, 'cus_c','sub_c','2031-03-03T00:00:00Z','2020-01-03T00:00:00Z')`,
      [
        a.recruiterId,
        a.userId,
        b.recruiterId,
        b.userId,
        c.recruiterId,
        c.userId,
      ],
    );

    const SNAPSHOT = `SELECT id, recruiter_id, user_id, plan, status,
                             stripe_customer_id, stripe_subscription_id,
                             current_period_end, updated_at
                        FROM public.recruiter_billing_profiles
                       ORDER BY stripe_customer_id`;

    const before = await db.query(SNAPSHOT);

    await db.exec(CANDIDATE_SQL);

    const after = await db.query(SNAPSHOT);
    expect(after.rows).toEqual(before.rows);

    // And the seeded identity/period values are exactly what we wrote.
    expect(after.rows).toEqual([
      expect.objectContaining({
        recruiter_id: a.recruiterId,
        user_id: a.userId,
        plan: 'none',
        status: 'inactive',
        stripe_customer_id: 'cus_a',
        stripe_subscription_id: 'sub_a',
        current_period_end: new Date('2031-01-01T00:00:00Z'),
        updated_at: new Date('2020-01-01T00:00:00Z'),
      }),
      expect.objectContaining({
        recruiter_id: b.recruiterId,
        user_id: b.userId,
        plan: 'growth',
        status: 'active',
        stripe_customer_id: 'cus_b',
        stripe_subscription_id: 'sub_b',
        current_period_end: new Date('2031-02-02T00:00:00Z'),
        updated_at: new Date('2020-01-02T00:00:00Z'),
      }),
      expect.objectContaining({
        recruiter_id: c.recruiterId,
        user_id: c.userId,
        plan: 'fleet',
        status: 'canceled',
        stripe_customer_id: 'cus_c',
        stripe_subscription_id: 'sub_c',
        current_period_end: new Date('2031-03-03T00:00:00Z'),
        updated_at: new Date('2020-01-03T00:00:00Z'),
      }),
    ]);

    const limits = await db.query<{
      stripe_customer_id: string;
      active_opportunity_limit: number;
    }>(
      `SELECT stripe_customer_id, active_opportunity_limit
         FROM public.recruiter_billing_profiles ORDER BY stripe_customer_id`,
    );
    expect(limits.rows).toEqual([
      { stripe_customer_id: 'cus_a', active_opportunity_limit: 1 },
      { stripe_customer_id: 'cus_b', active_opportunity_limit: 15 },
      // The backfill mirrors the PLAN column only; paying status is enforced
      // at read time by effective_recruiter_tier, never by this legacy column.
      { stripe_customer_id: 'cus_c', active_opportunity_limit: 25 },
    ]);

    // A non-paying fleet row still resolves to the free ceiling at read time.
    expect(await limitOf(db, c.recruiterId)).toBe(1);
  });

});
