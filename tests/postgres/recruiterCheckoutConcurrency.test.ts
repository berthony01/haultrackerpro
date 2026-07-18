import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  recruiterCheckoutIdempotencyKey,
  recruiterCustomerIdempotencyKey,
  recruiterCanonicalMetadata,
  runRecruiterCheckout,
  type IntentClaimResult,
  type IntentSimpleResult,
  type IntentStore,
  type RecruiterCheckoutDeps,
  type StripeCustomerLike,
  type StripeGateway,
  type StripeSessionLike,
  type StripeSubscriptionLike,
} from "../../supabase/functions/_shared/recruiter-checkout.ts";

const DATABASE_URL = process.env.RECRUITER_CHECKOUT_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "RECRUITER_CHECKOUT_DATABASE_URL is required for the Phase 1G-R1A3 real-Postgres gate",
  );
}

const CANDIDATE_PATH = fileURLToPath(
  new URL(
    "../../supabase/migration-candidates/20260717235300_phase1g_r1a1_recruiter_checkout_intents.sql",
    import.meta.url,
  ),
);
const CANDIDATE_SQL = readFileSync(CANDIDATE_PATH, "utf8");

const BOOTSTRAP_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE postgres_test_runner NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres_test_runner;

DROP FUNCTION IF EXISTS public.claim_recruiter_checkout_intent(uuid,uuid,text) CASCADE;
DROP FUNCTION IF EXISTS public.bind_recruiter_checkout_customer(uuid,uuid,text) CASCADE;
DROP FUNCTION IF EXISTS public.complete_recruiter_checkout_intent(uuid,uuid,text,text,text,timestamptz) CASCADE;
DROP FUNCTION IF EXISTS public.fail_recruiter_checkout_intent(uuid,uuid,text,boolean) CASCADE;
DROP TABLE IF EXISTS public.recruiter_checkout_intents CASCADE;
DROP TABLE IF EXISTS public.recruiter_billing_profiles CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;
DROP TABLE IF EXISTS public.agency_entitlements CASCADE;
DROP TABLE IF EXISTS public.recruiter_profiles CASCADE;

CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  recruiter_name text,
  recruiter_email text,
  company_name text,
  status text NOT NULL DEFAULT 'active',
  verification_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.recruiter_billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  user_id uuid,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text NOT NULL DEFAULT 'none',
  status text NOT NULL DEFAULT 'inactive',
  active_opportunity_limit integer NOT NULL DEFAULT 0,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruiter_billing_profiles_recruiter_uq UNIQUE (recruiter_id)
);

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text NOT NULL DEFAULT 'inactive',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agency_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL DEFAULT gen_random_uuid(),
  stripe_customer_id text,
  stripe_subscription_id text,
  status text NOT NULL DEFAULT 'inactive',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.recruiter_profiles, public.recruiter_billing_profiles,
  public.subscriptions, public.agency_entitlements TO service_role, postgres_test_runner;
`;

type ClaimRow = IntentClaimResult;
type SimpleRow = IntentSimpleResult;

type RecruiterSeed = { recruiterId: string; userId: string };

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 16,
  statement_timeout: 20_000,
});

async function resetData(): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      public.recruiter_checkout_intents,
      public.recruiter_billing_profiles,
      public.subscriptions,
      public.agency_entitlements,
      public.recruiter_profiles
    RESTART IDENTITY CASCADE
  `);
}

async function seedRecruiter(overrides: {
  recruiterId?: string;
  userId?: string;
  status?: string;
  verificationStatus?: string;
} = {}): Promise<RecruiterSeed> {
  const recruiterId = overrides.recruiterId ?? randomUUID();
  const userId = overrides.userId ?? randomUUID();
  await pool.query(
    `INSERT INTO public.recruiter_profiles
      (id, user_id, recruiter_name, recruiter_email, company_name, status, verification_status)
     VALUES ($1, $2, 'Riley Recruiter', 'riley@example.test', 'Riley Freight', $3, $4)`,
    [
      recruiterId,
      userId,
      overrides.status ?? "active",
      overrides.verificationStatus ?? "approved",
    ],
  );
  return { recruiterId, userId };
}

async function claim(
  client: pg.Pool | pg.PoolClient | pg.Client,
  seed: RecruiterSeed,
  plan = "growth",
): Promise<ClaimRow> {
  const { rows } = await client.query(
    `SELECT * FROM public.claim_recruiter_checkout_intent($1::uuid,$2::uuid,$3::text)`,
    [seed.recruiterId, seed.userId, plan],
  );
  return rows[0] as ClaimRow;
}

async function bind(
  client: pg.Pool | pg.PoolClient | pg.Client,
  intentId: string,
  token: string | null,
  customerId: string,
): Promise<SimpleRow> {
  const { rows } = await client.query(
    `SELECT * FROM public.bind_recruiter_checkout_customer($1::uuid,$2::uuid,$3::text)`,
    [intentId, token, customerId],
  );
  return rows[0] as SimpleRow;
}

async function complete(
  client: pg.Pool | pg.PoolClient | pg.Client,
  intentId: string,
  token: string | null,
  customerId: string,
  sessionId = "cs_test_ready",
  url = "https://checkout.stripe.example/cs_test_ready",
  expiresAt = new Date(Date.now() + 30 * 60_000),
): Promise<SimpleRow> {
  const { rows } = await client.query(
    `SELECT * FROM public.complete_recruiter_checkout_intent(
      $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::timestamptz
    )`,
    [intentId, token, customerId, sessionId, url, expiresAt],
  );
  return rows[0] as SimpleRow;
}

async function failIntent(
  client: pg.Pool | pg.PoolClient | pg.Client,
  intentId: string,
  token: string | null,
  code = "test_failure",
  terminal = false,
): Promise<SimpleRow> {
  const { rows } = await client.query(
    `SELECT * FROM public.fail_recruiter_checkout_intent($1::uuid,$2::uuid,$3::text,$4::boolean)`,
    [intentId, token, code, terminal],
  );
  return rows[0] as SimpleRow;
}

async function intentRow(recruiterId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM public.recruiter_checkout_intents WHERE recruiter_id=$1`,
    [recruiterId],
  );
  return rows[0] as Record<string, unknown> | undefined;
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

class Deferred<T = void> {
  promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason?: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class PgIntentStore implements IntentStore {
  constructor(private readonly db: pg.Pool) {}

  async claim(input: {
    recruiterId: string;
    userId: string;
    plan: "starter" | "growth" | "fleet";
  }): Promise<IntentClaimResult> {
    return claim(this.db, { recruiterId: input.recruiterId, userId: input.userId }, input.plan);
  }

  async bind(input: { intentId: string; claimToken: string; customerId: string }) {
    return bind(this.db, input.intentId, input.claimToken, input.customerId);
  }

  async complete(input: {
    intentId: string;
    claimToken: string;
    customerId: string;
    sessionId: string;
    url: string;
    expiresAt: string;
  }) {
    return complete(
      this.db,
      input.intentId,
      input.claimToken,
      input.customerId,
      input.sessionId,
      input.url,
      new Date(input.expiresAt),
    );
  }

  async fail(input: {
    intentId: string;
    claimToken: string;
    errorCode: string;
    terminal: boolean;
  }) {
    return failIntent(
      this.db,
      input.intentId,
      input.claimToken,
      input.errorCode,
      input.terminal,
    );
  }

  async loadCanonicalCustomer(input: { recruiterId: string; userId: string }) {
    const { rows } = await this.db.query(
      `SELECT stripe_customer_id FROM public.recruiter_billing_profiles
       WHERE recruiter_id=$1 AND user_id=$2`,
      [input.recruiterId, input.userId],
    );
    return { stripeCustomerId: (rows[0]?.stripe_customer_id as string | null) ?? null };
  }
}

class LatchedStripeFake implements StripeGateway {
  readonly enteredCustomerSearch = new Deferred<void>();
  readonly releaseCustomerSearch = new Deferred<void>();
  private searchBlocked = false;

  readonly customers = new Map<string, StripeCustomerLike>();
  readonly sessions = new Map<string, StripeSessionLike>();
  readonly customerByKey = new Map<string, string>();
  readonly sessionByKey = new Map<string, string>();
  readonly customerKeys: string[] = [];
  readonly sessionKeys: string[] = [];
  createdCustomerCount = 0;
  createdSessionCount = 0;

  async retrieveCustomer(id: string) {
    return this.customers.get(id) ?? null;
  }

  async searchCustomersByMetadata() {
    if (!this.searchBlocked) {
      this.searchBlocked = true;
      this.enteredCustomerSearch.resolve();
      await this.releaseCustomerSearch.promise;
    }
    return [];
  }

  async createCustomer(input: {
    recruiterId: string;
    userId: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }) {
    this.customerKeys.push(input.idempotencyKey);
    const existingId = this.customerByKey.get(input.idempotencyKey);
    if (existingId) return this.customers.get(existingId)!;

    const id = `cus_fake_${++this.createdCustomerCount}`;
    const customer: StripeCustomerLike = {
      id,
      metadata: { ...input.metadata },
      deleted: false,
    };
    this.customerByKey.set(input.idempotencyKey, id);
    this.customers.set(id, customer);
    return customer;
  }

  async listAllSubscriptions(): Promise<StripeSubscriptionLike[]> {
    return [];
  }

  async retrieveSession(id: string) {
    return this.sessions.get(id) ?? null;
  }

  async createSession(input: {
    customerId: string;
    priceId: string;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    expiresAt: number;
    idempotencyKey: string;
  }) {
    this.sessionKeys.push(input.idempotencyKey);
    const existingId = this.sessionByKey.get(input.idempotencyKey);
    if (existingId) return this.sessions.get(existingId)!;

    const id = `cs_fake_${++this.createdSessionCount}`;
    const session: StripeSessionLike = {
      id,
      status: "open",
      url: `https://checkout.stripe.example/${id}`,
      customer: input.customerId,
      expires_at: input.expiresAt,
      metadata: { ...input.metadata },
    };
    this.sessionByKey.set(input.idempotencyKey, id);
    this.sessions.set(id, session);
    return session;
  }
}

beforeAll(async () => {
  await pool.query(BOOTSTRAP_SQL);
  // The exact repository candidate is applied verbatim. It remains outside
  // supabase/migrations and is never sent to the connected production project.
  await pool.query(CANDIDATE_SQL);
}, 60_000);

beforeEach(async () => {
  await resetData();
});

afterAll(async () => {
  await pool.end();
});

describe("Phase 1G-R1A3 — real PostgreSQL checkout intent state machine", () => {
  it("applies the exact candidate outside managed migrations", () => {
    expect(CANDIDATE_PATH).toContain("supabase/migration-candidates/");
    expect(CANDIDATE_PATH).not.toContain("supabase/migrations/");
    expect(CANDIDATE_SQL).toContain("CREATE TABLE public.recruiter_checkout_intents");
  });

  it("gives simultaneous claim calls one winner and one in-progress loser", async () => {
    const seed = await seedRecruiter();
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      const [r1, r2] = await Promise.all([
        claim(c1, seed, "growth"),
        claim(c2, seed, "growth"),
      ]);
      const outcomes = [r1.outcome, r2.outcome].sort();
      expect(outcomes).toEqual(["claimed", "in_progress"]);
      const winner = r1.outcome === "claimed" ? r1 : r2;
      const loser = r1.outcome === "in_progress" ? r1 : r2;
      expect(winner.claim_token).toMatch(/^[0-9a-f-]{36}$/i);
      expect(loser.claim_token).toBeNull();
      expect(loser.intent_id).toBe(winner.intent_id);
      expect(loser.generation).toBe(1);
    } finally {
      c1.release();
      c2.release();
    }
  });

  it("rejects null, random, and stale loser tokens for bind, complete, and fail", async () => {
    const seed = await seedRecruiter();
    const winner = await claim(pool, seed);
    expect(winner.outcome).toBe("claimed");
    const random = randomUUID();

    expect((await bind(pool, winner.intent_id!, null, "cus_null")).outcome).toBe("lease_invalid");
    expect((await bind(pool, winner.intent_id!, random, "cus_random")).outcome).toBe("lease_invalid");
    expect((await complete(pool, winner.intent_id!, null, "cus_null")).outcome).toBe("lease_invalid");
    expect((await complete(pool, winner.intent_id!, random, "cus_random")).outcome).toBe("lease_invalid");
    expect((await failIntent(pool, winner.intent_id!, null)).outcome).toBe("lease_invalid");
    expect((await failIntent(pool, winner.intent_id!, random)).outcome).toBe("lease_invalid");

    const row = await intentRow(seed.recruiterId);
    expect(row?.state).toBe("processing");
    expect(row?.claim_token).toBe(winner.claim_token);
  });

  it("reclaims expired processing and failed same-plan attempts without rotating generation", async () => {
    const seed = await seedRecruiter();
    const first = await claim(pool, seed, "growth");
    await pool.query(
      `UPDATE public.recruiter_checkout_intents SET lease_expires_at=now()-interval '1 second' WHERE id=$1`,
      [first.intent_id],
    );
    const reclaimed = await claim(pool, seed, "growth");
    expect(reclaimed.outcome).toBe("claimed");
    expect(reclaimed.generation).toBe(1);
    expect(reclaimed.claim_token).not.toBe(first.claim_token);

    expect(
      (await failIntent(pool, reclaimed.intent_id!, reclaimed.claim_token, "transient_test", false)).outcome,
    ).toBe("failed");
    const failedRetry = await claim(pool, seed, "growth");
    expect(failedRetry.outcome).toBe("claimed");
    expect(failedRetry.generation).toBe(1);
    expect(failedRetry.claim_token).not.toBe(reclaimed.claim_token);
  });

  it("rotates generation once for plan change, expired ready, and blocked retry", async () => {
    const seed = await seedRecruiter();
    const first = await claim(pool, seed, "growth");
    await pool.query(
      `UPDATE public.recruiter_checkout_intents SET lease_expires_at=now()-interval '1 second' WHERE id=$1`,
      [first.intent_id],
    );
    const changed = await claim(pool, seed, "fleet");
    expect(changed.generation).toBe(2);

    expect((await bind(pool, changed.intent_id!, changed.claim_token, "cus_ready")).outcome).toBe("bound");
    expect((await complete(pool, changed.intent_id!, changed.claim_token, "cus_ready")).outcome).toBe("completed");

    const ready = await claim(pool, seed, "fleet");
    expect(ready.outcome).toBe("ready_candidate");
    expect(ready.generation).toBe(2);
    expect(ready.claim_token).toBeNull();
    expect(ready.stripe_customer_id).toBe("cus_ready");
    expect(ready.stripe_checkout_session_id).toBe("cs_test_ready");
    expect(ready.checkout_url).toBe("https://checkout.stripe.example/cs_test_ready");

    await pool.query(
      `UPDATE public.recruiter_checkout_intents SET checkout_expires_at=now()-interval '1 second' WHERE recruiter_id=$1`,
      [seed.recruiterId],
    );
    const expiredReady = await claim(pool, seed, "fleet");
    expect(expiredReady.outcome).toBe("claimed");
    expect(expiredReady.generation).toBe(3);
    let row = await intentRow(seed.recruiterId);
    expect(row?.stripe_checkout_session_id).toBeNull();
    expect(row?.checkout_url).toBeNull();

    expect(
      (await failIntent(pool, expiredReady.intent_id!, expiredReady.claim_token, "terminal_test", true)).outcome,
    ).toBe("blocked");
    const blockedRetry = await claim(pool, seed, "fleet");
    expect(blockedRetry.outcome).toBe("claimed");
    expect(blockedRetry.generation).toBe(4);
    row = await intentRow(seed.recruiterId);
    expect(row?.last_error_code).toBeNull();
  });

  it("returns structured eligibility outcomes without creating intents", async () => {
    const approved = await seedRecruiter();
    const invalidPlan = await claim(pool, approved, "enterprise");
    expect(invalidPlan.outcome).toBe("invalid_plan");

    const wrongOwner = await claim(pool, { recruiterId: approved.recruiterId, userId: randomUUID() });
    expect(wrongOwner.outcome).toBe("not_owner");

    const pending = await seedRecruiter({ verificationStatus: "pending" });
    const pendingResult = await claim(pool, pending);
    expect(pendingResult).toMatchObject({ outcome: "not_eligible", reason: "verification_not_approved" });

    const suspendedStatus = await seedRecruiter({ status: "suspended" });
    expect(await claim(pool, suspendedStatus)).toMatchObject({
      outcome: "not_eligible",
      reason: "account_suspended",
    });

    const suspendedVerification = await seedRecruiter({ verificationStatus: "suspended" });
    expect(await claim(pool, suspendedVerification)).toMatchObject({
      outcome: "not_eligible",
      reason: "account_suspended",
    });

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM public.recruiter_checkout_intents`);
    expect(rows[0].n).toBe(0);
  });

  it("rejects stale and expired leases and requires the bound customer on completion", async () => {
    const seed = await seedRecruiter();
    const first = await claim(pool, seed);
    expect((await complete(pool, first.intent_id!, first.claim_token, "cus_unbound")).outcome).toBe(
      "customer_mismatch",
    );

    expect((await bind(pool, first.intent_id!, first.claim_token, "cus_bound")).outcome).toBe("bound");
    await pool.query(
      `UPDATE public.recruiter_checkout_intents SET lease_expires_at=now()-interval '1 second' WHERE id=$1`,
      [first.intent_id],
    );
    expect((await complete(pool, first.intent_id!, first.claim_token, "cus_bound")).outcome).toBe(
      "lease_invalid",
    );
    expect((await failIntent(pool, first.intent_id!, first.claim_token)).outcome).toBe("lease_invalid");
  });
});

describe("Phase 1G-R1A3 — customer, index, and privilege integrity", () => {
  it("binds the exact canonical identity and rejects Recruiter, Driver, and Agency crossover", async () => {
    const one = await seedRecruiter();
    const two = await seedRecruiter();
    const c1 = await claim(pool, one);
    const c2 = await claim(pool, two);

    expect((await bind(pool, c1.intent_id!, c1.claim_token, "cus_shared")).outcome).toBe("bound");
    const { rows } = await pool.query(
      `SELECT recruiter_id,user_id,stripe_customer_id FROM public.recruiter_billing_profiles WHERE recruiter_id=$1`,
      [one.recruiterId],
    );
    expect(rows[0]).toMatchObject({
      recruiter_id: one.recruiterId,
      user_id: one.userId,
      stripe_customer_id: "cus_shared",
    });

    expect(await bind(pool, c2.intent_id!, c2.claim_token, "cus_shared")).toMatchObject({
      outcome: "customer_conflict",
      reason: "recruiter_customer_owned_elsewhere",
    });

    await pool.query(
      `INSERT INTO public.subscriptions(user_id,stripe_customer_id) VALUES($1,'cus_driver')`,
      [randomUUID()],
    );
    expect(await bind(pool, c2.intent_id!, c2.claim_token, "cus_driver")).toMatchObject({
      outcome: "customer_conflict",
      reason: "driver_customer_collision",
    });

    await pool.query(
      `INSERT INTO public.agency_entitlements(stripe_customer_id) VALUES('cus_agency')`,
    );
    expect(await bind(pool, c2.intent_id!, c2.claim_token, "cus_agency")).toMatchObject({
      outcome: "customer_conflict",
      reason: "agency_customer_collision",
    });
  });

  it("never overwrites a different canonical customer and structures unique-index races", async () => {
    const one = await seedRecruiter();
    const two = await seedRecruiter();
    await pool.query(
      `INSERT INTO public.recruiter_billing_profiles(recruiter_id,user_id,stripe_customer_id)
       VALUES($1,$2,'cus_existing')`,
      [one.recruiterId, one.userId],
    );
    const c1 = await claim(pool, one);
    expect(await bind(pool, c1.intent_id!, c1.claim_token, "cus_other")).toMatchObject({
      outcome: "customer_conflict",
      reason: "existing_canonical_customer_differs",
    });

    // Force a user-identity uniqueness conflict that is not visible to the
    // pre-write customer lookup. The RPC must convert SQLSTATE 23505 into a
    // stable structured result rather than throw.
    await pool.query(
      `INSERT INTO public.recruiter_billing_profiles(recruiter_id,user_id)
       VALUES($1,$2)`,
      [two.recruiterId, two.userId],
    );
    const three = await seedRecruiter();
    await pool.query(
      `UPDATE public.recruiter_checkout_intents SET user_id=$1 WHERE recruiter_id=$2`,
      [two.userId, one.recruiterId],
    ).catch(() => undefined);

    const c3 = await claim(pool, three);
    // Directly reserve three's user identity under a different recruiter.
    const four = await seedRecruiter();
    await pool.query(
      `INSERT INTO public.recruiter_billing_profiles(recruiter_id,user_id)
       VALUES($1,$2)`,
      [four.recruiterId, three.userId],
    );
    expect(await bind(pool, c3.intent_id!, c3.claim_token, "cus_unique_race")).toMatchObject({
      outcome: "customer_conflict",
      reason: "billing_identity_unique_conflict",
    });
  });

  it("enforces all partial unique indexes while allowing multiple nulls", async () => {
    const seeds = await Promise.all(Array.from({ length: 8 }, () => seedRecruiter()));
    await pool.query(
      `INSERT INTO public.recruiter_billing_profiles(recruiter_id,user_id,stripe_customer_id,stripe_subscription_id)
       VALUES($1,$2,'cus_unique','sub_unique')`,
      [seeds[0].recruiterId, seeds[0].userId],
    );

    await expectSqlState(
      pool.query(
        `INSERT INTO public.recruiter_billing_profiles(recruiter_id,user_id)
         VALUES($1,$2)`,
        [seeds[1].recruiterId, seeds[0].userId],
      ),
      "23505",
    );
    await expectSqlState(
      pool.query(
        `INSERT INTO public.recruiter_billing_profiles(recruiter_id,user_id,stripe_customer_id)
         VALUES($1,$2,'cus_unique')`,
        [seeds[2].recruiterId, seeds[2].userId],
      ),
      "23505",
    );
    await expectSqlState(
      pool.query(
        `INSERT INTO public.recruiter_billing_profiles(recruiter_id,user_id,stripe_subscription_id)
         VALUES($1,$2,'sub_unique')`,
        [seeds[3].recruiterId, seeds[3].userId],
      ),
      "23505",
    );

    await pool.query(
      `INSERT INTO public.recruiter_billing_profiles(recruiter_id,user_id,stripe_customer_id,stripe_subscription_id)
       VALUES($1,NULL,NULL,NULL),($2,NULL,NULL,NULL)`,
      [seeds[4].recruiterId, seeds[5].recruiterId],
    );
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.recruiter_billing_profiles WHERE user_id IS NULL`,
    );
    expect(rows[0].n).toBe(2);
  });

  it("preserves compatible pre-existing billing rows when the candidate is applied", async () => {
    // The candidate was applied once in beforeAll. This assertion pins the
    // migration's data-preserving contract by checking that its SQL contains
    // no rewrite/delete statements against the billing table.
    expect(CANDIDATE_SQL).not.toMatch(/DELETE\s+FROM\s+public\.recruiter_billing_profiles/i);
    expect(CANDIDATE_SQL).not.toMatch(/UPDATE\s+public\.recruiter_billing_profiles/i);
  });

  it("enables RLS, creates no client policies, and denies client table/RPC access", async () => {
    const rel = await pool.query(
      `SELECT relrowsecurity FROM pg_class WHERE oid='public.recruiter_checkout_intents'::regclass`,
    );
    expect(rel.rows[0].relrowsecurity).toBe(true);

    const policies = await pool.query(
      `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename='recruiter_checkout_intents'`,
    );
    expect(policies.rows[0].n).toBe(0);

    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      const privileges = await pool.query(
        `SELECT
          has_table_privilege($1,'public.recruiter_checkout_intents','SELECT') AS sel,
          has_table_privilege($1,'public.recruiter_checkout_intents','INSERT') AS ins,
          has_table_privilege($1,'public.recruiter_checkout_intents','UPDATE') AS upd,
          has_table_privilege($1,'public.recruiter_checkout_intents','DELETE') AS del`,
        [role],
      );
      expect(privileges.rows[0]).toEqual({ sel: false, ins: false, upd: false, del: false });
    }

    const signatures = [
      "public.claim_recruiter_checkout_intent(uuid,uuid,text)",
      "public.bind_recruiter_checkout_customer(uuid,uuid,text)",
      "public.complete_recruiter_checkout_intent(uuid,uuid,text,text,text,timestamp with time zone)",
      "public.fail_recruiter_checkout_intent(uuid,uuid,text,boolean)",
    ];
    for (const signature of signatures) {
      for (const role of ["PUBLIC", "anon", "authenticated"]) {
        const q = await pool.query(`SELECT has_function_privilege($1,$2,'EXECUTE') AS ok`, [
          role,
          signature,
        ]);
        expect(q.rows[0].ok).toBe(false);
      }
      for (const role of ["service_role", "postgres_test_runner"]) {
        const q = await pool.query(`SELECT has_function_privilege($1,$2,'EXECUTE') AS ok`, [
          role,
          signature,
        ]);
        expect(q.rows[0].ok).toBe(true);
      }
    }

    const authClient = await pool.connect();
    try {
      await authClient.query("BEGIN");
      await authClient.query("SET LOCAL ROLE authenticated");
      await expectSqlState(
        authClient.query(`SELECT * FROM public.recruiter_checkout_intents`),
        "42501",
      );
      await authClient.query("ROLLBACK");
    } finally {
      authClient.release();
    }
  });

  it("contains exactly four state-machine functions and no helper trigger", async () => {
    const functions = await pool.query(
      `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND proname = ANY($1::text[]) ORDER BY proname`,
      [[
        "claim_recruiter_checkout_intent",
        "bind_recruiter_checkout_customer",
        "complete_recruiter_checkout_intent",
        "fail_recruiter_checkout_intent",
      ]],
    );
    expect(functions.rows.map((r) => r.proname)).toEqual([
      "bind_recruiter_checkout_customer",
      "claim_recruiter_checkout_intent",
      "complete_recruiter_checkout_intent",
      "fail_recruiter_checkout_intent",
    ]);
    const triggers = await pool.query(
      `SELECT count(*)::int AS n FROM pg_trigger
       WHERE tgrelid='public.recruiter_checkout_intents'::regclass AND NOT tgisinternal`,
    );
    expect(triggers.rows[0].n).toBe(0);
  });
});

describe("Phase 1G-R1A3 — actual orchestrator with real PostgreSQL IntentStore", () => {
  it("creates one customer/session under overlapping calls and reuses the same URL", async () => {
    const seed = await seedRecruiter();
    const stripe = new LatchedStripeFake();
    const deps: RecruiterCheckoutDeps = {
      intents: new PgIntentStore(pool),
      stripe,
      clock: { nowSeconds: () => 1_800_000_000 },
    };
    const input = {
      userId: seed.userId,
      recruiterId: seed.recruiterId,
      plan: "growth" as const,
      priceId: "price_growth_test",
      origin: "https://haultrackerpro.com",
    };

    const p1 = runRecruiterCheckout(input, deps);
    const p2 = runRecruiterCheckout(input, deps);

    await stripe.enteredCustomerSearch.promise;
    const firstSettled = await Promise.race([
      p1.then((result) => ({ which: 1, result })),
      p2.then((result) => ({ which: 2, result })),
    ]);
    expect(firstSettled.result).toMatchObject({ status: 409, code: "in_progress" });
    expect(firstSettled.result.url).toBeUndefined();

    stripe.releaseCustomerSearch.resolve();
    const [r1, r2] = await Promise.all([p1, p2]);
    const results = [r1, r2];
    expect(results.filter((r) => r.status === 200 && r.code === "checkout_ready")).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.code === "in_progress")).toHaveLength(1);
    expect(stripe.createdCustomerCount).toBe(1);
    expect(stripe.createdSessionCount).toBe(1);

    const ready = results.find((r) => r.code === "checkout_ready")!;
    const row = await intentRow(seed.recruiterId);
    expect(row).toMatchObject({
      state: "ready",
      stripe_customer_id: "cus_fake_1",
      stripe_checkout_session_id: "cs_fake_1",
      checkout_url: ready.url,
      generation: 1,
    });

    expect(stripe.customerKeys).toEqual([recruiterCustomerIdempotencyKey(seed.recruiterId)]);
    expect(stripe.sessionKeys).toEqual([recruiterCheckoutIdempotencyKey(seed.recruiterId, 1)]);
    expect(stripe.customers.get("cus_fake_1")?.metadata).toEqual(
      recruiterCanonicalMetadata({
        userId: seed.userId,
        recruiterId: seed.recruiterId,
        plan: "growth",
      }),
    );

    const third = await runRecruiterCheckout(input, deps);
    expect(third).toEqual(ready);
    expect(stripe.createdCustomerCount).toBe(1);
    expect(stripe.createdSessionCount).toBe(1);

    const publicLoser = results.find((r) => r.code === "in_progress")!;
    const serialized = JSON.stringify(publicLoser);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("claim_token");
    expect(serialized).not.toContain("cus_fake");
    expect(serialized).not.toContain("cs_fake");
  });
});
