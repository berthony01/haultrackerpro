import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Phase 1R-D2-B2-A — real PostgreSQL proof for the atomic business checkout
 * claim CANDIDATE.
 *
 * This suite applies the repository candidate file VERBATIM to an isolated
 * local database. The migration SQL is never copied or reimplemented here.
 */

const DATABASE_URL = process.env.BUSINESS_CHECKOUT_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "BUSINESS_CHECKOUT_DATABASE_URL is required for the Phase 1R-D2-B2-A real-Postgres gate",
  );
}

// Hard refusal of any hosted/production-looking target.
(function assertIsolatedTarget(url: string): void {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error("BUSINESS_CHECKOUT_DATABASE_URL is not a parseable URL");
  }
  const forbiddenMarkers = ["supabase.co", "supabase.com", "pooler.supabase", "amazonaws.com"];
  if (forbiddenMarkers.some((marker) => host.includes(marker))) {
    throw new Error(
      "Refusing to run: BUSINESS_CHECKOUT_DATABASE_URL points at a hosted database",
    );
  }
  const allowedHosts = ["localhost", "127.0.0.1", "::1", "postgres"];
  if (!allowedHosts.includes(host)) {
    throw new Error(
      `Refusing to run: BUSINESS_CHECKOUT_DATABASE_URL host "${host}" is not an isolated target`,
    );
  }
})(DATABASE_URL);

const CANDIDATE_PATH = fileURLToPath(
  new URL(
    "../../supabase/migration-candidates/20260730070000_phase1r_d2_b2_business_checkout_claims.sql",
    import.meta.url,
  ),
);
const CANDIDATE_SQL = readFileSync(CANDIDATE_PATH, "utf8");

// Isolated bootstrap mirroring the repository PRODUCTION constraints that are
// relevant to this proof:
//   * recruiter_profiles.user_id UNIQUE
//       (20260513003741_07f20f7a-242b-44d6-bd4b-4d91849cc847.sql)
//   * recruiter_billing_profiles.recruiter_id UNIQUE, and NO user_id uniqueness
//       (20260523023143_9b418a9e-92de-4f62-adc5-ca3f5169669e.sql)
//   * agency_entitlements.agency_id UNIQUE
//       (20260630001239_aacd1acb-dd6f-4fc5-9645-7f430b807820.sql)
// Only the ownership/billing columns the candidate RPCs actually read are
// created. Status/plan/source columns stay text so the isolated fixtures can
// exercise malformed fail-closed branches; production tables are untouched.
const BOOTSTRAP_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE postgres_test_runner NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres_test_runner;

DROP FUNCTION IF EXISTS public.claim_business_checkout(uuid,text,uuid,text,text) CASCADE;
DROP FUNCTION IF EXISTS public.complete_business_checkout_claim(uuid,text,uuid,text,timestamptz) CASCADE;
DROP FUNCTION IF EXISTS public.release_business_checkout_claim(uuid,text,uuid,text,boolean) CASCADE;
DROP TABLE IF EXISTS public.business_checkout_claims CASCADE;
DROP TABLE IF EXISTS public.recruiter_billing_profiles CASCADE;
DROP TABLE IF EXISTS public.agency_entitlements CASCADE;
DROP TABLE IF EXISTS public.agency_members CASCADE;
DROP TABLE IF EXISTS public.agency_profiles CASCADE;
DROP TABLE IF EXISTS public.recruiter_profiles CASCADE;

-- production-fidelity: recruiter_profiles.user_id UNIQUE
CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  verification_status text NOT NULL DEFAULT 'approved',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruiter_profiles_user_unique UNIQUE (user_id)
);

-- production-fidelity: recruiter_billing_profiles.recruiter_id UNIQUE only
CREATE TABLE public.recruiter_billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  user_id uuid,
  plan text NOT NULL DEFAULT 'none',
  status text NOT NULL DEFAULT 'inactive',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruiter_billing_profiles_recruiter_uq UNIQUE (recruiter_id)
);

CREATE TABLE public.agency_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Test Agency',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agency_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  member_user_id uuid,
  invite_email text NOT NULL DEFAULT 'owner@example.test',
  role text NOT NULL DEFAULT 'agency_owner',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- production-fidelity: agency_entitlements.agency_id UNIQUE
CREATE TABLE public.agency_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  plan_key text NOT NULL DEFAULT 'agency_starter',
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL DEFAULT 'stripe',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_entitlements_agency_id_key UNIQUE (agency_id)
);

GRANT ALL ON public.recruiter_profiles, public.recruiter_billing_profiles,
  public.agency_profiles, public.agency_members, public.agency_entitlements
  TO service_role, postgres_test_runner;
`;

const CLAIM_SIG = "public.claim_business_checkout(uuid,text,uuid,text,text)";
const COMPLETE_SIG =
  "public.complete_business_checkout_claim(uuid,text,uuid,text,timestamptz)";
const RELEASE_SIG =
  "public.release_business_checkout_claim(uuid,text,uuid,text,boolean)";

interface ClaimRow {
  outcome: string;
  reason: string | null;
  claim_context: string | null;
  claim_subject_id: string | null;
  claim_plan_key: string | null;
  generation: number | null;
  claim_token: string | null;
  claim_state: string | null;
  lease_expires_at: Date | null;
  stripe_checkout_session_id: string | null;
  checkout_expires_at: Date | null;
}

interface SimpleRow {
  outcome: string;
  reason: string | null;
}

type Executor = pg.Pool | pg.PoolClient | pg.Client;

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 16,
  statement_timeout: 20_000,
});

async function claim(
  client: Executor,
  input: {
    userId: string;
    context: string;
    subjectId: string;
    planKey: string;
    requestKey?: string;
  },
): Promise<ClaimRow> {
  const { rows } = await client.query(
    `SELECT * FROM public.claim_business_checkout($1::uuid,$2::text,$3::uuid,$4::text,$5::text)`,
    [
      input.userId,
      input.context,
      input.subjectId,
      input.planKey,
      input.requestKey ?? "req-default",
    ],
  );
  return rows[0] as ClaimRow;
}

async function complete(
  client: Executor,
  input: {
    userId: string;
    context: string;
    token: string | null;
    sessionId: string;
    expiresAt: Date;
  },
): Promise<SimpleRow> {
  const { rows } = await client.query(
    `SELECT * FROM public.complete_business_checkout_claim($1::uuid,$2::text,$3::uuid,$4::text,$5::timestamptz)`,
    [input.userId, input.context, input.token, input.sessionId, input.expiresAt],
  );
  return rows[0] as SimpleRow;
}

async function release(
  client: Executor,
  input: {
    userId: string;
    context: string;
    token: string | null;
    errorCode?: string;
    terminal?: boolean;
  },
): Promise<SimpleRow> {
  const { rows } = await client.query(
    `SELECT * FROM public.release_business_checkout_claim($1::uuid,$2::text,$3::uuid,$4::text,$5::boolean)`,
    [
      input.userId,
      input.context,
      input.token,
      input.errorCode ?? "test_release",
      input.terminal ?? false,
    ],
  );
  return rows[0] as SimpleRow;
}

async function claimRow(userId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM public.business_checkout_claims WHERE user_id=$1`,
    [userId],
  );
  return rows[0] as Record<string, unknown> | undefined;
}

async function claimRowCount(userId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM public.business_checkout_claims WHERE user_id=$1`,
    [userId],
  );
  return rows[0].n as number;
}

/** Forces a lease/session expiry branch inside the isolated database only. */
async function forceExpired(userId: string): Promise<void> {
  await pool.query(
    `UPDATE public.business_checkout_claims
        SET lease_expires_at = now() - interval '1 second',
            checkout_expires_at = CASE WHEN checkout_expires_at IS NULL THEN NULL
                                       ELSE now() - interval '1 second' END
      WHERE user_id = $1`,
    [userId],
  );
}

interface RecruiterSeed {
  userId: string;
  recruiterId: string;
}
interface AgencySeed {
  userId: string;
  agencyId: string;
}

async function seedRecruiter(userId = randomUUID()): Promise<RecruiterSeed> {
  const recruiterId = randomUUID();
  await pool.query(
    `INSERT INTO public.recruiter_profiles (id, user_id) VALUES ($1,$2)`,
    [recruiterId, userId],
  );
  return { userId, recruiterId };
}

async function seedAgency(
  userId = randomUUID(),
  opts: { memberRole?: string; memberStatus?: string } = {},
): Promise<AgencySeed> {
  const agencyId = randomUUID();
  await pool.query(
    `INSERT INTO public.agency_profiles (id, owner_user_id) VALUES ($1,$2)`,
    [agencyId, userId],
  );
  await pool.query(
    `INSERT INTO public.agency_members (agency_id, member_user_id, role, status)
     VALUES ($1,$2,$3,$4)`,
    [agencyId, userId, opts.memberRole ?? "agency_owner", opts.memberStatus ?? "active"],
  );
  return { userId, agencyId };
}

/** Seeds both contexts for the same user so opposing claims are both ownable. */
async function seedBoth(): Promise<{
  userId: string;
  recruiterId: string;
  agencyId: string;
}> {
  const userId = randomUUID();
  const r = await seedRecruiter(userId);
  const a = await seedAgency(userId);
  return { userId, recruiterId: r.recruiterId, agencyId: a.agencyId };
}

/**
 * Seeds two DISTINCT agencies owned by the same user, each with its own exact
 * active agency_owner membership. Production allows at most one entitlement row
 * per agency, so multi-entitlement precedence must use two agencies.
 */
async function seedTwoAgencies(userId = randomUUID()): Promise<{
  userId: string;
  agencyA: string;
  agencyB: string;
}> {
  const a = await seedAgency(userId);
  const b = await seedAgency(userId);
  return { userId, agencyA: a.agencyId, agencyB: b.agencyId };
}

async function setRecruiterBilling(
  recruiterId: string,
  userId: string,
  plan: string,
  status: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO public.recruiter_billing_profiles (recruiter_id, user_id, plan, status)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (recruiter_id) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status`,
    [recruiterId, userId, plan, status],
  );
}

async function setAgencyEntitlement(
  agencyId: string,
  planKey: string,
  status: string,
  source: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO public.agency_entitlements (agency_id, plan_key, status, source)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (agency_id) DO UPDATE
       SET plan_key = EXCLUDED.plan_key,
           status = EXCLUDED.status,
           source = EXCLUDED.source`,
    [agencyId, planKey, status, source],
  );
}

async function expectSqlState(promise: Promise<unknown>, expected = "42501") {
  let code = "";
  try {
    await promise;
  } catch (error) {
    code = (error as { code?: string }).code ?? "";
  }
  expect(code).toBe(expected);
}

/** Runs two calls on independent connections, started before either resolves. */
async function simultaneous<T>(
  a: (client: pg.PoolClient) => Promise<T>,
  b: (client: pg.PoolClient) => Promise<T>,
): Promise<[T, T]> {
  const c1 = await pool.connect();
  const c2 = await pool.connect();
  try {
    const p1 = a(c1);
    const p2 = b(c2);
    return await Promise.all([p1, p2]);
  } finally {
    c1.release();
    c2.release();
  }
}

let serverVersion = "";

beforeAll(async () => {
  await pool.query(BOOTSTRAP_SQL);
  await pool.query(CANDIDATE_SQL);
  const { rows } = await pool.query("SHOW server_version");
  serverVersion = rows[0].server_version as string;
  // eslint-disable-next-line no-console
  console.log(`Phase 1R-D2-B2-A isolated PostgreSQL server_version=${serverVersion}`);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query(`
    TRUNCATE TABLE
      public.business_checkout_claims,
      public.recruiter_billing_profiles,
      public.agency_entitlements,
      public.agency_members,
      public.agency_profiles,
      public.recruiter_profiles
    RESTART IDENTITY CASCADE
  `);
});

// ---------------------------------------------------------------------------
// 1. Schema, posture, and ownership
// ---------------------------------------------------------------------------

describe("Phase 1R-D2-B2-A — schema and security posture", () => {
  it("creates the exact table, checks, indexes, RLS/no-policy, and grants", async () => {
    const columns = await pool.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='business_checkout_claims'
        ORDER BY ordinal_position`,
    );
    expect(columns.rows.map((r) => r.column_name)).toEqual([
      "user_id",
      "context",
      "subject_id",
      "plan_key",
      "request_key",
      "generation",
      "state",
      "claim_token",
      "lease_expires_at",
      "stripe_checkout_session_id",
      "checkout_expires_at",
      "last_error_code",
      "created_at",
      "updated_at",
    ]);

    const checks = await pool.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid='public.business_checkout_claims'::regclass AND contype='c'
        ORDER BY conname`,
    );
    expect(checks.rows.map((r) => r.conname)).toEqual([
      "business_checkout_claims_context_chk",
      "business_checkout_claims_context_plan_chk",
      "business_checkout_claims_error_code_chk",
      "business_checkout_claims_generation_chk",
      "business_checkout_claims_inactive_coherent_chk",
      "business_checkout_claims_processing_coherent_chk",
      "business_checkout_claims_ready_coherent_chk",
      "business_checkout_claims_request_key_chk",
      "business_checkout_claims_state_chk",
    ]);

    const indexes = await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='business_checkout_claims'
        ORDER BY indexname`,
    );
    const tokenIdx = indexes.rows.find(
      (r) => r.indexname === "business_checkout_claims_claim_token_uniq",
    );
    const sessionIdx = indexes.rows.find(
      (r) => r.indexname === "business_checkout_claims_session_id_uniq",
    );
    expect(tokenIdx.indexdef).toContain("UNIQUE");
    expect(tokenIdx.indexdef).toContain("WHERE (claim_token IS NOT NULL)");
    expect(sessionIdx.indexdef).toContain("UNIQUE");
    expect(sessionIdx.indexdef).toContain(
      "WHERE (stripe_checkout_session_id IS NOT NULL)",
    );

    const rls = await pool.query(
      `SELECT relrowsecurity FROM pg_class WHERE oid='public.business_checkout_claims'::regclass`,
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);

    const policies = await pool.query(
      `SELECT count(*)::int AS n FROM pg_policies
        WHERE schemaname='public' AND tablename='business_checkout_claims'`,
    );
    expect(policies.rows[0].n).toBe(0);

    const triggers = await pool.query(
      `SELECT count(*)::int AS n FROM pg_trigger
        WHERE tgrelid='public.business_checkout_claims'::regclass AND NOT tgisinternal`,
    );
    expect(triggers.rows[0].n).toBe(0);

    for (const role of ["anon", "authenticated"]) {
      const q = await pool.query(
        `SELECT has_table_privilege($1,'public.business_checkout_claims','SELECT') AS ok`,
        [role],
      );
      expect(q.rows[0].ok).toBe(false);
    }
    const svc = await pool.query(
      `SELECT has_table_privilege('service_role','public.business_checkout_claims','SELECT') AS ok`,
    );
    expect(svc.rows[0].ok).toBe(true);
  });

  it("exposes exactly three business checkout RPCs", async () => {
    const fns = await pool.query(
      `SELECT proname, pg_get_function_identity_arguments(p.oid) AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND proname LIKE '%business_checkout%'
        ORDER BY proname`,
    );
    expect(fns.rows).toHaveLength(3);
    expect(fns.rows.map((r) => `${r.proname}(${r.args})`)).toEqual([
      "claim_business_checkout(_user_id uuid, _context text, _subject_id uuid, _plan_key text, _request_key text)",
      "complete_business_checkout_claim(_user_id uuid, _context text, _claim_token uuid, _session_id text, _checkout_expires_at timestamp with time zone)",
      "release_business_checkout_claim(_user_id uuid, _context text, _claim_token uuid, _error_code text, _terminal boolean)",
    ]);
  });

  it("denies execution to anon/authenticated and allows service_role", async () => {
    for (const signature of [CLAIM_SIG, COMPLETE_SIG, RELEASE_SIG]) {
      for (const role of ["anon", "authenticated"]) {
        const q = await pool.query(
          `SELECT has_function_privilege($1,$2,'EXECUTE') AS ok`,
          [role, signature],
        );
        expect(q.rows[0].ok).toBe(false);
      }
      for (const role of ["service_role", "postgres_test_runner"]) {
        const q = await pool.query(
          `SELECT has_function_privilege($1,$2,'EXECUTE') AS ok`,
          [role, signature],
        );
        expect(q.rows[0].ok).toBe(true);
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE authenticated");
      await expectSqlState(
        client.query(`SELECT * FROM public.business_checkout_claims`),
        "42501",
      );
      await client.query("ROLLBACK");

      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE authenticated");
      await expectSqlState(
        client.query(
          `SELECT * FROM public.claim_business_checkout($1::uuid,'recruiter'::text,$2::uuid,'growth'::text,'k'::text)`,
          [randomUUID(), randomUUID()],
        ),
        "42501",
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("enforces recruiter ownership and agency active-owner membership", async () => {
    const recruiter = await seedRecruiter();
    const stranger = randomUUID();
    const wrongOwner = await claim(pool, {
      userId: stranger,
      context: "recruiter",
      subjectId: recruiter.recruiterId,
      planKey: "growth",
    });
    expect(wrongOwner).toMatchObject({
      outcome: "not_owner",
      reason: "recruiter_ownership_mismatch",
    });

    const agency = await seedAgency();
    const notOwner = await claim(pool, {
      userId: randomUUID(),
      context: "agency",
      subjectId: agency.agencyId,
      planKey: "agency_team",
    });
    expect(notOwner).toMatchObject({
      outcome: "not_owner",
      reason: "agency_ownership_mismatch",
    });

    const inactive = await seedAgency(randomUUID(), { memberStatus: "invited" });
    const noMembership = await claim(pool, {
      userId: inactive.userId,
      context: "agency",
      subjectId: inactive.agencyId,
      planKey: "agency_team",
    });
    expect(noMembership).toMatchObject({
      outcome: "not_owner",
      reason: "agency_owner_membership_missing",
    });

    const okAgency = await claim(pool, {
      userId: agency.userId,
      context: "agency",
      subjectId: agency.agencyId,
      planKey: "agency_team",
    });
    expect(okAgency.outcome).toBe("acquired");
  });
});

// ---------------------------------------------------------------------------
// 2. Sequential claim state machine
// ---------------------------------------------------------------------------

describe("Phase 1R-D2-B2-A — claim state machine", () => {
  it("acquires generation 1 processing with a fresh ~300 second lease", async () => {
    const seed = await seedRecruiter();
    const before = Date.now();
    const result = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    expect(result.outcome).toBe("acquired");
    expect(result.generation).toBe(1);
    expect(result.claim_state).toBe("processing");
    expect(result.claim_token).toMatch(/^[0-9a-f-]{36}$/);
    const leaseMs = (result.lease_expires_at as Date).getTime() - before;
    expect(leaseMs).toBeGreaterThan(290_000);
    expect(leaseMs).toBeLessThan(315_000);

    const row = await claimRow(seed.userId);
    expect(row).toMatchObject({
      context: "recruiter",
      plan_key: "growth",
      request_key: "req-1",
      state: "processing",
      generation: 1,
      stripe_checkout_session_id: null,
    });
  });

  it("reuses an identical active request without exposing the token", async () => {
    const seed = await seedRecruiter();
    const first = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    const second = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    expect(second.outcome).toBe("reused");
    expect(second.generation).toBe(first.generation);
    expect(second.claim_token).toBeNull();
    expect(await claimRowCount(seed.userId)).toBe(1);
  });

  it("blocks a same-context claim with a differing request key, plan, or subject", async () => {
    const seed = await seedRecruiter();
    await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });

    const differingRequest = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-2",
    });
    expect(differingRequest).toMatchObject({
      outcome: "blocked",
      reason: "same_context_claim_active",
      claim_context: "recruiter",
      claim_plan_key: "growth",
      claim_state: "processing",
    });
    expect(differingRequest.claim_token).toBeNull();

    const differingPlan = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "fleet",
      requestKey: "req-1",
    });
    expect(differingPlan.reason).toBe("same_context_claim_active");

    const otherRecruiter = randomUUID();
    await pool.query(
      `INSERT INTO public.recruiter_profiles (id, user_id) VALUES ($1,$2)`,
      [otherRecruiter, randomUUID()],
    );
    const differingSubject = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: otherRecruiter,
      planKey: "growth",
      requestKey: "req-1",
    });
    // Ownership is checked before the claim row, so a foreign subject is not_owner.
    expect(differingSubject.outcome).toBe("not_owner");
    expect(await claimRowCount(seed.userId)).toBe(1);
  });

  it("blocks an opposing-context claim while a claim is active", async () => {
    const seed = await seedBoth();
    await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    const opposing = await claim(pool, {
      userId: seed.userId,
      context: "agency",
      subjectId: seed.agencyId,
      planKey: "agency_team",
      requestKey: "req-2",
    });
    expect(opposing).toMatchObject({
      outcome: "blocked",
      reason: "opposing_claim_active",
      claim_context: "recruiter",
      claim_subject_id: seed.recruiterId,
      claim_plan_key: "growth",
      claim_state: "processing",
    });
    expect(opposing.claim_token).toBeNull();
    expect(await claimRowCount(seed.userId)).toBe(1);
  });

  it("allows takeover of an expired processing lease with generation +1", async () => {
    const seed = await seedBoth();
    const first = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    await forceExpired(seed.userId);

    const second = await claim(pool, {
      userId: seed.userId,
      context: "agency",
      subjectId: seed.agencyId,
      planKey: "agency_growth",
      requestKey: "req-2",
    });
    expect(second.outcome).toBe("acquired");
    expect(second.generation).toBe(2);
    expect(second.claim_context).toBe("agency");
    expect(second.claim_token).not.toBe(first.claim_token);
    expect(await claimRowCount(seed.userId)).toBe(1);

    // The old token can no longer complete or release anything.
    const staleComplete = await complete(pool, {
      userId: seed.userId,
      context: "agency",
      token: first.claim_token,
      sessionId: "cs_stale",
      expiresAt: new Date(Date.now() + 1_800_000),
    });
    expect(staleComplete).toMatchObject({
      outcome: "lease_invalid",
      reason: "no_active_lease",
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Completion and release
// ---------------------------------------------------------------------------

describe("Phase 1R-D2-B2-A — completion and release", () => {
  it("completes to ready, clears the token, and blocks opposing claims until session expiry", async () => {
    const seed = await seedBoth();
    const acquired = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    const done = await complete(pool, {
      userId: seed.userId,
      context: "recruiter",
      token: acquired.claim_token,
      sessionId: "cs_ready_1",
      expiresAt,
    });
    expect(done.outcome).toBe("completed");

    const row = await claimRow(seed.userId);
    expect(row).toMatchObject({
      state: "ready",
      claim_token: null,
      stripe_checkout_session_id: "cs_ready_1",
    });
    expect((row!.lease_expires_at as Date).getTime()).toBe(
      (row!.checkout_expires_at as Date).getTime(),
    );
    expect((row!.checkout_expires_at as Date).getTime()).toBe(expiresAt.getTime());

    const opposing = await claim(pool, {
      userId: seed.userId,
      context: "agency",
      subjectId: seed.agencyId,
      planKey: "agency_team",
      requestKey: "req-2",
    });
    expect(opposing).toMatchObject({
      outcome: "blocked",
      reason: "opposing_claim_active",
      claim_state: "ready",
    });
  });

  it("reuses a ready claim for an exact same-context retry with session metadata", async () => {
    const seed = await seedRecruiter();
    const acquired = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    await complete(pool, {
      userId: seed.userId,
      context: "recruiter",
      token: acquired.claim_token,
      sessionId: "cs_ready_2",
      expiresAt,
    });

    const retry = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    expect(retry.outcome).toBe("reused");
    expect(retry.claim_state).toBe("ready");
    expect(retry.stripe_checkout_session_id).toBe("cs_ready_2");
    expect((retry.checkout_expires_at as Date).getTime()).toBe(expiresAt.getTime());
    expect(retry.claim_token).toBeNull();
  });

  it("treats an exact duplicate completion as idempotent already_completed", async () => {
    const seed = await seedRecruiter();
    const acquired = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    await complete(pool, {
      userId: seed.userId,
      context: "recruiter",
      token: acquired.claim_token,
      sessionId: "cs_dup",
      expiresAt,
    });
    const again = await complete(pool, {
      userId: seed.userId,
      context: "recruiter",
      token: acquired.claim_token,
      sessionId: "cs_dup",
      expiresAt,
    });
    expect(again).toMatchObject({
      outcome: "completed",
      reason: "already_completed",
    });
  });

  it("returns structured failures for differing ready sessions and session collisions", async () => {
    const seedA = await seedRecruiter();
    const acquiredA = await claim(pool, {
      userId: seedA.userId,
      context: "recruiter",
      subjectId: seedA.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    await complete(pool, {
      userId: seedA.userId,
      context: "recruiter",
      token: acquiredA.claim_token,
      sessionId: "cs_shared",
      expiresAt,
    });

    const mismatch = await complete(pool, {
      userId: seedA.userId,
      context: "recruiter",
      token: acquiredA.claim_token,
      sessionId: "cs_other",
      expiresAt,
    });
    expect(mismatch).toMatchObject({
      outcome: "session_mismatch",
      reason: "ready_session_differs",
    });

    const seedB = await seedRecruiter();
    const acquiredB = await claim(pool, {
      userId: seedB.userId,
      context: "recruiter",
      subjectId: seedB.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    const collision = await complete(pool, {
      userId: seedB.userId,
      context: "recruiter",
      token: acquiredB.claim_token,
      sessionId: "cs_shared",
      expiresAt,
    });
    expect(collision).toMatchObject({
      outcome: "session_conflict",
      reason: "checkout_session_already_claimed",
    });
    expect(JSON.stringify(collision)).not.toContain("_uniq");
  });

  it("allows takeover of an expired ready claim and clears prior session metadata", async () => {
    const seed = await seedRecruiter();
    const acquired = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    await complete(pool, {
      userId: seed.userId,
      context: "recruiter",
      token: acquired.claim_token,
      sessionId: "cs_expired",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await forceExpired(seed.userId);

    const next = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "starter",
      requestKey: "req-2",
    });
    expect(next.outcome).toBe("acquired");
    expect(next.generation).toBe(2);
    const row = await claimRow(seed.userId);
    expect(row).toMatchObject({
      state: "processing",
      stripe_checkout_session_id: null,
      checkout_expires_at: null,
      last_error_code: null,
    });
  });

  it("releases nonterminally and terminally, and never releases a ready claim", async () => {
    const seed = await seedRecruiter();
    const first = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    const released = await release(pool, {
      userId: seed.userId,
      context: "recruiter",
      token: first.claim_token,
      errorCode: "stripe_timeout",
      terminal: false,
    });
    expect(released.outcome).toBe("released");
    expect((await claimRow(seed.userId))!.last_error_code).toBe("stripe_timeout");

    const second = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-2",
    });
    expect(second.outcome).toBe("acquired");
    expect(second.generation).toBe(2);

    const failed = await release(pool, {
      userId: seed.userId,
      context: "recruiter",
      token: second.claim_token,
      errorCode: "stripe_declined",
      terminal: true,
    });
    expect(failed.outcome).toBe("failed");

    const third = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-3",
    });
    expect(third.outcome).toBe("acquired");
    expect(third.generation).toBe(3);

    await complete(pool, {
      userId: seed.userId,
      context: "recruiter",
      token: third.claim_token,
      sessionId: "cs_ready_locked",
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    const forbidden = await release(pool, {
      userId: seed.userId,
      context: "recruiter",
      token: third.claim_token,
      errorCode: "late_release",
      terminal: false,
    });
    expect(forbidden).toMatchObject({
      outcome: "release_forbidden",
      reason: "ready_claim_not_releasable",
    });
    expect((await claimRow(seed.userId))!.state).toBe("ready");
  });

  it("fails closed on stale tokens and wrong contexts without mutating the row", async () => {
    const seed = await seedBoth();
    const acquired = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    const snapshot = await claimRow(seed.userId);

    expect(
      await complete(pool, {
        userId: seed.userId,
        context: "recruiter",
        token: randomUUID(),
        sessionId: "cs_x",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).toMatchObject({ outcome: "lease_invalid", reason: "no_active_lease" });

    expect(
      await complete(pool, {
        userId: seed.userId,
        context: "agency",
        token: acquired.claim_token,
        sessionId: "cs_x",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).toMatchObject({ outcome: "context_mismatch", reason: "claim_context_differs" });

    expect(
      await release(pool, {
        userId: seed.userId,
        context: "recruiter",
        token: randomUUID(),
      }),
    ).toMatchObject({ outcome: "lease_invalid", reason: "no_active_lease" });

    expect(
      await release(pool, {
        userId: seed.userId,
        context: "agency",
        token: acquired.claim_token,
      }),
    ).toMatchObject({ outcome: "context_mismatch", reason: "claim_context_differs" });

    expect(
      await release(pool, {
        userId: seed.userId,
        context: "recruiter",
        token: acquired.claim_token,
        errorCode: "NOT VALID",
      }),
    ).toMatchObject({ outcome: "invalid_input", reason: "error_code_malformed" });

    expect(
      await complete(pool, {
        userId: randomUUID(),
        context: "recruiter",
        token: acquired.claim_token,
        sessionId: "cs_x",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).toMatchObject({ outcome: "not_found", reason: "claim_missing" });

    expect(await claimRow(seed.userId)).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// 4. True concurrency
// ---------------------------------------------------------------------------

describe("Phase 1R-D2-B2-A — simultaneous claim atomicity", () => {
  it("gives two simultaneous opposing claims exactly one winner", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await pool.query(`TRUNCATE TABLE public.business_checkout_claims`);
      const seed = await seedBoth();
      const [a, b] = await simultaneous<ClaimRow>(
        (c) =>
          claim(c, {
            userId: seed.userId,
            context: "recruiter",
            subjectId: seed.recruiterId,
            planKey: "growth",
            requestKey: "req-recruiter",
          }),
        (c) =>
          claim(c, {
            userId: seed.userId,
            context: "agency",
            subjectId: seed.agencyId,
            planKey: "agency_team",
            requestKey: "req-agency",
          }),
      );
      const results = [a, b];
      expect(results.filter((r) => r.outcome === "acquired")).toHaveLength(1);
      const losers = results.filter((r) => r.outcome === "blocked");
      expect(losers).toHaveLength(1);
      expect(losers[0].reason).toBe("opposing_claim_active");
      expect(losers[0].claim_token).toBeNull();
      expect(await claimRowCount(seed.userId)).toBe(1);
    }
  });

  it("gives two simultaneous identical same-context claims one acquire and one reuse", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await pool.query(`TRUNCATE TABLE public.business_checkout_claims`);
      const seed = await seedRecruiter();
      const input = {
        userId: seed.userId,
        context: "recruiter",
        subjectId: seed.recruiterId,
        planKey: "growth",
        requestKey: "req-same",
      };
      const [a, b] = await simultaneous<ClaimRow>(
        (c) => claim(c, input),
        (c) => claim(c, input),
      );
      const results = [a, b];
      expect(results.filter((r) => r.outcome === "acquired")).toHaveLength(1);
      expect(results.filter((r) => r.outcome === "reused")).toHaveLength(1);
      expect(results.filter((r) => r.claim_token !== null)).toHaveLength(1);
      expect(await claimRowCount(seed.userId)).toBe(1);
      expect((await claimRow(seed.userId))!.generation).toBe(1);
    }
  });

  it("gives two simultaneous differing same-context claims one acquire and one block", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await pool.query(`TRUNCATE TABLE public.business_checkout_claims`);
      const seed = await seedRecruiter();
      const [a, b] = await simultaneous<ClaimRow>(
        (c) =>
          claim(c, {
            userId: seed.userId,
            context: "recruiter",
            subjectId: seed.recruiterId,
            planKey: "growth",
            requestKey: "req-a",
          }),
        (c) =>
          claim(c, {
            userId: seed.userId,
            context: "recruiter",
            subjectId: seed.recruiterId,
            planKey: "fleet",
            requestKey: "req-b",
          }),
      );
      const results = [a, b];
      expect(results.filter((r) => r.outcome === "acquired")).toHaveLength(1);
      const losers = results.filter((r) => r.outcome === "blocked");
      expect(losers).toHaveLength(1);
      expect(losers[0].reason).toBe("same_context_claim_active");
      expect(await claimRowCount(seed.userId)).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Phase 1R-D1 durable policy matrix
// ---------------------------------------------------------------------------

describe("Phase 1R-D2-B2-A — D1 durable opposing-entitlement policy", () => {
  const recruiterMatrix: Array<{
    planKey: string;
    status: string;
    source: string;
    expected: string | null;
  }> = [
    { planKey: "agency_team", status: "active", source: "stripe", expected: "agency_entitlement_exists" },
    // trial-allowlist: Stripe subscription status literal
    { planKey: "agency_team", status: "trialing", source: "stripe", expected: "agency_entitlement_exists" },
    { planKey: "agency_team", status: "past_due", source: "stripe", expected: "agency_billing_requires_management" },
    { planKey: "agency_team", status: "past_due", source: "manual", expected: "opposing_entitlement_unknown" },
    { planKey: "agency_team", status: "past_due", source: "admin_seed", expected: "opposing_entitlement_unknown" },
    { planKey: "agency_team", status: "manual_beta", source: "manual", expected: null },
    { planKey: "agency_team", status: "cancelled", source: "stripe", expected: null },
    { planKey: "agency_team", status: "bogus_status", source: "stripe", expected: "opposing_entitlement_unknown" },
    { planKey: "not_a_plan", status: "active", source: "stripe", expected: "opposing_entitlement_unknown" },
    { planKey: "agency_team", status: "active", source: "mystery", expected: "opposing_entitlement_unknown" },
  ];

  it.each(recruiterMatrix)(
    "recruiter claim with agency $planKey/$status/$source -> $expected",
    async ({ planKey, status, source, expected }) => {
      const seed = await seedBoth();
      await setAgencyEntitlement(seed.agencyId, planKey, status, source);
      const result = await claim(pool, {
        userId: seed.userId,
        context: "recruiter",
        subjectId: seed.recruiterId,
        planKey: "growth",
        requestKey: "req-1",
      });
      if (expected === null) {
        expect(result.outcome).toBe("acquired");
      } else {
        expect(result).toMatchObject({ outcome: "blocked", reason: expected });
        expect(await claimRowCount(seed.userId)).toBe(0);
      }
    },
  );

  it("allows a recruiter claim when the user has no active owner membership", async () => {
    const userId = randomUUID();
    const recruiter = await seedRecruiter(userId);
    const agency = await seedAgency(userId, { memberStatus: "revoked" });
    await setAgencyEntitlement(agency.agencyId, "agency_team", "active", "stripe");
    const result = await claim(pool, {
      userId,
      context: "recruiter",
      subjectId: recruiter.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    expect(result.outcome).toBe("acquired");
  });

  const agencyMatrix: Array<{ plan: string; status: string; expected: string | null }> = [
    { plan: "growth", status: "active", expected: "recruiter_subscription_exists" },
    // trial-allowlist: Stripe subscription status literal
    { plan: "growth", status: "trialing", expected: "recruiter_subscription_exists" },
    { plan: "growth", status: "past_due", expected: "recruiter_subscription_exists" },
    { plan: "growth", status: "unpaid", expected: "recruiter_subscription_exists" },
    { plan: "growth", status: "incomplete", expected: "recruiter_subscription_exists" },
    { plan: "growth", status: "paused", expected: "recruiter_subscription_exists" },
    { plan: "growth", status: "canceled", expected: null },
    { plan: "growth", status: "incomplete_expired", expected: null },
    { plan: "none", status: "inactive", expected: null },
    { plan: "growth", status: "weird_status", expected: "opposing_entitlement_unknown" },
    { plan: "none", status: "active", expected: "opposing_entitlement_unknown" },
  ];

  it.each(agencyMatrix)(
    "agency claim with recruiter $plan/$status -> $expected",
    async ({ plan, status, expected }) => {
      const seed = await seedBoth();
      await setRecruiterBilling(seed.recruiterId, seed.userId, plan, status);
      const result = await claim(pool, {
        userId: seed.userId,
        context: "agency",
        subjectId: seed.agencyId,
        planKey: "agency_team",
        requestKey: "req-1",
      });
      if (expected === null) {
        expect(result.outcome).toBe("acquired");
      } else {
        expect(result).toMatchObject({ outcome: "blocked", reason: expected });
        expect(await claimRowCount(seed.userId)).toBe(0);
      }
    },
  );

  it("never mutates recruiter billing or agency entitlement rows", async () => {
    const seed = await seedBoth();
    await setRecruiterBilling(seed.recruiterId, seed.userId, "growth", "canceled");
    await setAgencyEntitlement(seed.agencyId, "agency_team", "cancelled", "stripe");

    const billingBefore = (
      await pool.query(`SELECT * FROM public.recruiter_billing_profiles ORDER BY id`)
    ).rows;
    const entitlementBefore = (
      await pool.query(`SELECT * FROM public.agency_entitlements ORDER BY id`)
    ).rows;

    const acquired = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    await complete(pool, {
      userId: seed.userId,
      context: "recruiter",
      token: acquired.claim_token,
      sessionId: "cs_no_mutation",
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    await forceExpired(seed.userId);
    const reclaimed = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-2",
    });
    await release(pool, {
      userId: seed.userId,
      context: "recruiter",
      token: reclaimed.claim_token,
      errorCode: "cleanup",
      terminal: true,
    });

    expect(
      (await pool.query(`SELECT * FROM public.recruiter_billing_profiles ORDER BY id`)).rows,
    ).toEqual(billingBefore);
    expect(
      (await pool.query(`SELECT * FROM public.agency_entitlements ORDER BY id`)).rows,
    ).toEqual(entitlementBefore);
  });
});

// ---------------------------------------------------------------------------
// 6. Input validation
// ---------------------------------------------------------------------------

describe("Phase 1R-D2-B2-A — structured input validation", () => {
  it("rejects unsupported contexts, plans, and request keys", async () => {
    const seed = await seedRecruiter();
    expect(
      await claim(pool, {
        userId: seed.userId,
        context: "driver",
        subjectId: seed.recruiterId,
        planKey: "growth",
      }),
    ).toMatchObject({ outcome: "invalid_input", reason: "unsupported_context" });

    expect(
      await claim(pool, {
        userId: seed.userId,
        context: "recruiter",
        subjectId: seed.recruiterId,
        planKey: "agency_team",
      }),
    ).toMatchObject({ outcome: "invalid_input", reason: "plan_not_supported" });

    expect(
      await claim(pool, {
        userId: seed.userId,
        context: "recruiter",
        subjectId: seed.recruiterId,
        planKey: "growth",
        requestKey: "   ",
      }),
    ).toMatchObject({ outcome: "invalid_input", reason: "request_key_invalid" });

    expect(
      await claim(pool, {
        userId: seed.userId,
        context: "recruiter",
        subjectId: seed.recruiterId,
        planKey: "growth",
        requestKey: "x".repeat(201),
      }),
    ).toMatchObject({ outcome: "invalid_input", reason: "request_key_invalid" });

    expect(await claimRowCount(seed.userId)).toBe(0);
  });

  it("rejects malformed completion input", async () => {
    const seed = await seedRecruiter();
    const acquired = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-1",
    });
    expect(
      await complete(pool, {
        userId: seed.userId,
        context: "recruiter",
        token: acquired.claim_token,
        sessionId: "  ",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).toMatchObject({ outcome: "invalid_input", reason: "session_id_invalid" });

    expect(
      await complete(pool, {
        userId: seed.userId,
        context: "recruiter",
        token: acquired.claim_token,
        sessionId: "cs_past",
        expiresAt: new Date(Date.now() - 60_000),
      }),
    ).toMatchObject({ outcome: "invalid_input", reason: "checkout_expiry_invalid" });

    expect(
      await complete(pool, {
        userId: seed.userId,
        context: "recruiter",
        token: null,
        sessionId: "cs_ok",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).toMatchObject({ outcome: "invalid_input", reason: "missing_claim_token" });

    expect((await claimRow(seed.userId))!.state).toBe("processing");
  });
});

// ---------------------------------------------------------------------------
// 7. Phase 1R-D2-B2-A-R2 repairs
// ---------------------------------------------------------------------------

const LOCK_NAMESPACE = "7218926914894380123";

async function functionSource(name: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT p.prosrc
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`,
    [name],
  );
  expect(rows).toHaveLength(1);
  return rows[0].prosrc as string;
}

const RPC_NAMES = [
  "claim_business_checkout",
  "complete_business_checkout_claim",
  "release_business_checkout_claim",
];

describe("Phase 1R-D2-B2-A-R2 — Repair A: lock namespace and post-lock clock", () => {
  it("declares the namespace constant and locks through it in all three RPCs", async () => {
    for (const name of RPC_NAMES) {
      const src = await functionSource(name);
      expect(src).toContain(
        `v_lock_namespace constant bigint := ${LOCK_NAMESPACE};`,
      );
      expect(src).toContain(
        "hashtextextended(_user_id::text, v_lock_namespace)",
      );
      expect(src).not.toContain(
        `hashtextextended(_user_id::text, ${LOCK_NAMESPACE})`,
      );
      expect(src).not.toContain("hashtext('bcc:'");
    }
  });

  it("declares v_now without an initializer in all three RPCs", async () => {
    for (const name of RPC_NAMES) {
      const src = await functionSource(name);
      expect(src).toMatch(/v_now\s+timestamptz;/);
      expect(src).not.toMatch(/v_now\s+timestamptz\s*:=/);
      expect(src).not.toMatch(/v_now[^\n]*:=\s*now\(\)/);
    }
  });

  it("reads clock_timestamp() into v_now only AFTER the advisory lock", async () => {
    for (const name of RPC_NAMES) {
      const src = await functionSource(name);
      const lockAt = src.indexOf("pg_advisory_xact_lock(");
      const clockAt = src.indexOf("v_now := clock_timestamp();");
      expect(lockAt).toBeGreaterThan(0);
      expect(clockAt).toBeGreaterThan(lockAt);
    }
  });

  it("refreshes the clock again after policy evaluation and before the durable row select", async () => {
    const src = await functionSource("claim_business_checkout");
    const lockAt = src.indexOf("pg_advisory_xact_lock(");
    const first = src.indexOf("v_now := clock_timestamp();", lockAt);
    const second = src.indexOf("v_now := clock_timestamp();", first + 1);
    const selectAt = src.indexOf(
      "SELECT * INTO v_row FROM public.business_checkout_claims",
    );
    expect(second).toBeGreaterThan(first);
    expect(selectAt).toBeGreaterThan(second);
    expect(
      (src.match(/v_now := clock_timestamp\(\);/g) ?? []).length,
    ).toBe(2);
  });

  it("revalidates checkout expiry after the lock and before the durable row select", async () => {
    const src = await functionSource("complete_business_checkout_claim");
    const lockAt = src.indexOf("pg_advisory_xact_lock(");
    const clockAt = src.indexOf("v_now := clock_timestamp();", lockAt);
    const revalidateAt = src.indexOf(
      "IF NOT (_checkout_expires_at IS NOT NULL AND _checkout_expires_at > v_now) THEN",
    );
    const selectAt = src.indexOf(
      "SELECT * INTO v_row FROM public.business_checkout_claims",
    );
    expect(revalidateAt).toBeGreaterThan(clockAt);
    expect(selectAt).toBeGreaterThan(revalidateAt);
  });

  it("uses only post-lock v_now for release lease validity", async () => {
    const src = await functionSource("release_business_checkout_claim");
    const clockAt = src.indexOf("v_now := clock_timestamp();");
    const leaseAt = src.indexOf("v_row.lease_expires_at <= v_now");
    expect(leaseAt).toBeGreaterThan(clockAt);
  });

  it("still issues an approximately 300 second lease on acquisition", async () => {
    const seed = await seedRecruiter();
    const acquired = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-lease",
    });
    const row = (await claimRow(seed.userId))!;
    const deltaSeconds =
      ((row.lease_expires_at as Date).getTime() -
        (row.updated_at as Date).getTime()) /
      1000;
    expect(acquired.outcome).toBe("acquired");
    expect(deltaSeconds).toBeGreaterThanOrEqual(299);
    expect(deltaSeconds).toBeLessThanOrEqual(301);
  });
});

describe("Phase 1R-D2-B2-A-R2 — Repair B: strict null and shape validation", () => {
  it("rejects a NULL plan key as invalid input rather than falling through", async () => {
    const seed = await seedRecruiter();
    const { rows } = await pool.query(
      `SELECT * FROM public.claim_business_checkout($1::uuid,$2::text,$3::uuid,$4::text,$5::text)`,
      [seed.userId, "recruiter", seed.recruiterId, null, "req-null-plan"],
    );
    expect(rows[0]).toMatchObject({
      outcome: "invalid_input",
      reason: "plan_not_supported",
    });
    expect(await claimRowCount(seed.userId)).toBe(0);
  });

  it("rejects a NULL terminal flag with terminal_flag_invalid", async () => {
    const seed = await seedRecruiter();
    const acquired = await claim(pool, {
      userId: seed.userId,
      context: "recruiter",
      subjectId: seed.recruiterId,
      planKey: "growth",
      requestKey: "req-null-terminal",
    });
    const { rows } = await pool.query(
      `SELECT * FROM public.release_business_checkout_claim($1::uuid,$2::text,$3::uuid,$4::text,$5::boolean)`,
      [seed.userId, "recruiter", acquired.claim_token, "stripe_timeout", null],
    );
    expect(rows[0]).toMatchObject({
      outcome: "invalid_input",
      reason: "terminal_flag_invalid",
    });
    expect((await claimRow(seed.userId))!.state).toBe("processing");
  });

  it("enforces strict snake_case error codes", async () => {
    const rejected = [
      "_leading",
      "trailing_",
      "double__underscore",
      "123first",
      "UpperCase",
      "has space",
    ];
    for (const errorCode of rejected) {
      const seed = await seedRecruiter();
      const acquired = await claim(pool, {
        userId: seed.userId,
        context: "recruiter",
        subjectId: seed.recruiterId,
        planKey: "growth",
        requestKey: "req-code",
      });
      expect(
        await release(pool, {
          userId: seed.userId,
          context: "recruiter",
          token: acquired.claim_token,
          errorCode,
        }),
      ).toMatchObject({ outcome: "invalid_input", reason: "error_code_malformed" });
      expect((await claimRow(seed.userId))!.state).toBe("processing");
    }

    const accepted = await seedRecruiter();
    const acquired = await claim(pool, {
      userId: accepted.userId,
      context: "recruiter",
      subjectId: accepted.recruiterId,
      planKey: "growth",
      requestKey: "req-code-ok",
    });
    expect(
      await release(pool, {
        userId: accepted.userId,
        context: "recruiter",
        token: acquired.claim_token,
        errorCode: "stripe_api_error9",
      }),
    ).toMatchObject({ outcome: "released" });
    expect((await claimRow(accepted.userId))!.last_error_code).toBe(
      "stripe_api_error9",
    );
  });

  it("rejects a strict-shape violation at the table constraint level", async () => {
    const seed = await seedRecruiter();
    await expectSqlState(
      pool.query(
        `INSERT INTO public.business_checkout_claims
           (user_id, context, subject_id, plan_key, request_key, state, last_error_code)
         VALUES ($1,'recruiter',$2,'growth','req','failed','__bad__')`,
        [seed.userId, seed.recruiterId],
      ),
      "23514",
    );
  });
});

describe("Phase 1R-D2-B2-A-R2 — Repair C: setwise fail-closed agency precedence", () => {
  it("removes the v_has_owner gate and evaluates ownership inside the aggregate join", async () => {
    const src = await functionSource("claim_business_checkout");
    expect(src).not.toContain("v_has_owner");
    expect(src).toContain(
      "INTO v_unknown, v_live, v_past_due_stripe, v_past_due_other",
    );
    const unknownAt = src.indexOf("IF v_unknown > 0 THEN");
    const liveAt = src.indexOf("ELSIF v_live > 0 THEN", unknownAt);
    const otherAt = src.indexOf("ELSIF v_past_due_other > 0 THEN", liveAt);
    const stripeAt = src.indexOf("ELSIF v_past_due_stripe > 0 THEN", otherAt);
    expect(unknownAt).toBeGreaterThan(0);
    expect(liveAt).toBeGreaterThan(unknownAt);
    expect(otherAt).toBeGreaterThan(liveAt);
    expect(stripeAt).toBeGreaterThan(otherAt);
  });

  it("blocks a same-context claim for a DIFFERENT agency the same user owns", async () => {
    const { userId, agencyA, agencyB } = await seedTwoAgencies();

    const first = await claim(pool, {
      userId,
      context: "agency",
      subjectId: agencyA,
      planKey: "agency_team",
      requestKey: "req-a",
    });
    expect(first.outcome).toBe("acquired");

    const second = await claim(pool, {
      userId,
      context: "agency",
      subjectId: agencyB,
      planKey: "agency_team",
      requestKey: "req-b",
    });
    expect(second).toMatchObject({
      outcome: "blocked",
      reason: "same_context_claim_active",
    });
    expect(second.claim_token).toBeNull();
    expect(await claimRowCount(userId)).toBe(1);
    expect((await claimRow(userId))!.subject_id).toBe(agencyA);
  });

  it.each([
    { order: "inert first", inertFirst: true },
    { order: "live first", inertFirst: false },
  ])(
    "blocks a recruiter claim when any owned agency is live ($order)",
    async ({ inertFirst }) => {
      const userId = randomUUID();
      const recruiter = await seedRecruiter(userId);
      const { agencyA, agencyB } = await seedTwoAgencies(userId);

      if (inertFirst) {
        await setAgencyEntitlement(agencyA, "agency_starter", "manual_beta", "manual");
        await setAgencyEntitlement(agencyB, "agency_team", "active", "stripe");
      } else {
        await setAgencyEntitlement(agencyA, "agency_team", "active", "stripe");
        await setAgencyEntitlement(agencyB, "agency_starter", "manual_beta", "manual");
      }

      expect(
        await claim(pool, {
          userId,
          context: "recruiter",
          subjectId: recruiter.recruiterId,
          planKey: "growth",
          requestKey: "req-multi-live",
        }),
      ).toMatchObject({ outcome: "blocked", reason: "agency_entitlement_exists" });
      expect(await claimRowCount(userId)).toBe(0);
    },
  );

  it("fails closed as unknown when any owned agency row is malformed", async () => {
    const userId = randomUUID();
    const recruiter = await seedRecruiter(userId);
    const { agencyA, agencyB } = await seedTwoAgencies(userId);
    await setAgencyEntitlement(agencyA, "agency_team", "active", "stripe");
    await setAgencyEntitlement(agencyB, "not_a_plan", "bogus_status", "mystery");

    const entitlementsBefore = (
      await pool.query(`SELECT * FROM public.agency_entitlements ORDER BY id`)
    ).rows;

    expect(
      await claim(pool, {
        userId,
        context: "recruiter",
        subjectId: recruiter.recruiterId,
        planKey: "growth",
        requestKey: "req-multi-unknown",
      }),
    ).toMatchObject({ outcome: "blocked", reason: "opposing_entitlement_unknown" });
    expect(await claimRowCount(userId)).toBe(0);
    expect(
      (await pool.query(`SELECT * FROM public.agency_entitlements ORDER BY id`)).rows,
    ).toEqual(entitlementsBefore);
  });

  it.each([
    { other: "manual" },
    { other: "admin_seed" },
  ])(
    "fails closed when stripe past_due mixes with $other past_due",
    async ({ other }) => {
      const userId = randomUUID();
      const recruiter = await seedRecruiter(userId);
      const { agencyA, agencyB } = await seedTwoAgencies(userId);
      await setAgencyEntitlement(agencyA, "agency_team", "past_due", "stripe");
      await setAgencyEntitlement(agencyB, "agency_team", "past_due", other);

      expect(
        await claim(pool, {
          userId,
          context: "recruiter",
          subjectId: recruiter.recruiterId,
          planKey: "growth",
          requestKey: "req-multi-pastdue",
        }),
      ).toMatchObject({ outcome: "blocked", reason: "opposing_entitlement_unknown" });
      expect(await claimRowCount(userId)).toBe(0);
    },
  );

  it("still reports stripe past_due management when no other past_due exists", async () => {
    const userId = randomUUID();
    const recruiter = await seedRecruiter(userId);
    const { agencyA, agencyB } = await seedTwoAgencies(userId);
    await setAgencyEntitlement(agencyA, "agency_team", "past_due", "stripe");
    await setAgencyEntitlement(agencyB, "agency_starter", "cancelled", "stripe");

    expect(
      await claim(pool, {
        userId,
        context: "recruiter",
        subjectId: recruiter.recruiterId,
        planKey: "growth",
        requestKey: "req-multi-stripe-pastdue",
      }),
    ).toMatchObject({
      outcome: "blocked",
      reason: "agency_billing_requires_management",
    });
  });

  it("allows a recruiter claim when every owned agency row is inert", async () => {
    const userId = randomUUID();
    const recruiter = await seedRecruiter(userId);
    const { agencyA, agencyB } = await seedTwoAgencies(userId);
    await setAgencyEntitlement(agencyA, "agency_starter", "manual_beta", "manual");
    await setAgencyEntitlement(agencyB, "agency_team", "cancelled", "stripe");

    expect(
      await claim(pool, {
        userId,
        context: "recruiter",
        subjectId: recruiter.recruiterId,
        planKey: "growth",
        requestKey: "req-multi-inert",
      }),
    ).toMatchObject({ outcome: "acquired" });
  });
});

describe("Phase 1R-D2-B2-A-R2 — Repair D: production-fidelity fixtures", () => {
  it("mirrors the production UNIQUE constraint on agency_entitlements.agency_id", async () => {
    const { rows } = await pool.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='agency_entitlements'`,
    );
    const defs = rows.map((r) => r.indexdef as string);
    expect(
      defs.some((d) => /UNIQUE INDEX .* \(agency_id\)$/.test(d)),
    ).toBe(true);

    const { agencyA } = await seedTwoAgencies();
    await setAgencyEntitlement(agencyA, "agency_team", "active", "stripe");
    await expectSqlState(
      pool.query(
        `INSERT INTO public.agency_entitlements (agency_id, plan_key, status, source)
         VALUES ($1,'agency_starter','active','stripe')`,
        [agencyA],
      ),
      "23505",
    );
  });

  it("mirrors production recruiter uniqueness: unique recruiter_id, no user_id uniqueness", async () => {
    const { rows } = await pool.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='recruiter_billing_profiles'`,
    );
    const defs = rows.map((r) => r.indexdef as string);
    expect(defs.some((d) => /UNIQUE INDEX .* \(recruiter_id\)$/.test(d))).toBe(true);
    expect(defs.some((d) => /UNIQUE INDEX .* \(user_id\)$/.test(d))).toBe(false);
  });

  it("proves multiple coherent recruiter billing rows per user are structurally impossible", async () => {
    // Production recruiter_profiles enforces UNIQUE(user_id), so a user can own
    // at most one recruiter profile, and recruiter_billing_profiles enforces
    // UNIQUE(recruiter_id). A second COHERENT billing row for the same user is
    // therefore impossible without fabricating cross-user linkage.
    const { rows } = await pool.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='recruiter_profiles'`,
    );
    expect(
      rows.some((r) => /UNIQUE INDEX .* \(user_id\)$/.test(r.indexdef as string)),
    ).toBe(true);

    const seed = await seedRecruiter();
    await expectSqlState(
      pool.query(
        `INSERT INTO public.recruiter_profiles (user_id) VALUES ($1)`,
        [seed.userId],
      ),
      "23505",
    );
  });

  it("keeps every clean recruiter billing fixture owner-coherent", async () => {
    const seed = await seedBoth();
    await setRecruiterBilling(seed.recruiterId, seed.userId, "growth", "active");
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n
         FROM public.recruiter_billing_profiles rbp
         JOIN public.recruiter_profiles rp ON rp.id = rbp.recruiter_id
        WHERE rbp.user_id IS DISTINCT FROM rp.user_id`,
    );
    expect(rows[0].n).toBe(0);

    expect(
      await claim(pool, {
        userId: seed.userId,
        context: "agency",
        subjectId: seed.agencyId,
        planKey: "agency_team",
        requestKey: "req-coherent",
      }),
    ).toMatchObject({
      outcome: "blocked",
      reason: "recruiter_subscription_exists",
    });
  });
});
