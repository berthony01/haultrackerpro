/**
 * Phase 1F-A.2.2-R1B-R1 — Real PostgreSQL concurrency + consent-pair integrity.
 *
 * Lives OUTSIDE src/ so the normal jsdom `bunx vitest run` never picks it up
 * and reports zero skipped tests. Runs only via the dedicated config
 * `vitest.postgres.config.ts` in the GitHub Actions gate.
 *
 * Reads the exact repository migration SQL from disk using an ESM-safe
 * absolute path derived from `import.meta.url` (no `__dirname`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
// `pg` is CommonJS; the default export exposes { Client, Pool }.
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const CI_POSTGRES = process.env.R1B_REQUIRE_POSTGRES === "1";

const CANONICAL_VERSION = "2026-07-17.v1";
const HISTORICAL_VERSION = "2025-legacy.v1";

// ESM-safe absolute paths for the exact repository migration files.
const R1B_MIGRATION_PATH = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260717223452_ff4257ea-d71a-4cca-881b-3f5ab5d7011a.sql",
    import.meta.url,
  ),
);
const PRIOR_MIGRATION_PATH = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260717213626_3ad0fe69-da04-413d-837d-25f43bb53fdd.sql",
    import.meta.url,
  ),
);

const BOOTSTRAP_SQL = `
DO $$ BEGIN CREATE ROLE anon           NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated  NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role   NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

DROP TABLE IF EXISTS public.recruiter_profiles CASCADE;
CREATE TABLE public.recruiter_profiles (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL UNIQUE,
  recruiter_name              text,
  company_name                text,
  recruiter_email             text,
  dot_number                  text,
  mc_number                   text,
  status                      text NOT NULL DEFAULT 'active',
  verification_status         text NOT NULL DEFAULT 'pending',
  posting_terms_accepted_at   timestamptz,
  posting_terms_version       text,
  legacy_terms_grandfathered_at timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recruiter_profiles TO authenticated;
GRANT ALL ON public.recruiter_profiles TO service_role;

CREATE OR REPLACE FUNCTION public.accept_recruiter_posting_terms(_version text)
RETURNS timestamptz LANGUAGE sql AS $fn$ SELECT now() $fn$;
`;

interface Ctx {
  pool: pg.Pool;
  url: string;
}

async function withOwner<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

async function newAuthClient(url: string, userId: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url, statement_timeout: 15_000 });
  await c.connect();
  await c.query("BEGIN");
  await c.query("SET LOCAL role authenticated");
  await c.query(`SET LOCAL "request.jwt.claim.sub" = '${userId}'`);
  return c;
}

async function seedCompleteProfile(
  pool: pg.Pool,
): Promise<{ userId: string; profileId: string }> {
  const userId = randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO public.recruiter_profiles
       (user_id, recruiter_name, company_name, recruiter_email, dot_number, mc_number,
        status, verification_status)
     VALUES ($1, 'Rex Recruiter', 'Acme Freight LLC', 'rex@acme.example', '123456', 'MC-9', 'active', 'pending')
     RETURNING id`,
    [userId],
  );
  return { userId, profileId: rows[0].id as string };
}

async function readConsent(pool: pg.Pool, profileId: string) {
  const { rows } = await pool.query(
    `SELECT posting_terms_accepted_at AS at, posting_terms_version AS v
       FROM public.recruiter_profiles WHERE id = $1`,
    [profileId],
  );
  return rows[0] as { at: Date | null; v: string | null };
}

const shouldRun = Boolean(DATABASE_URL);
if (!shouldRun && CI_POSTGRES) {
  throw new Error("R1B_REQUIRE_POSTGRES=1 but DATABASE_URL is not set");
}

(shouldRun ? describe : describe.skip)(
  "Phase 1F-A.2.2-R1B-R1 — real Postgres consent-pair integrity + concurrency",
  () => {
    let ctx: Ctx;

    beforeAll(async () => {
      const priorSql = readFileSync(PRIOR_MIGRATION_PATH, "utf8");
      const r1bSql = readFileSync(R1B_MIGRATION_PATH, "utf8");
      const url = DATABASE_URL!;
      const pool = new pg.Pool({ connectionString: url, max: 6 });
      ctx = { pool, url };

      await withOwner(pool, async (c) => {
        await c.query(BOOTSTRAP_SQL);
        await c.query(priorSql);
        await c.query(r1bSql);
      });
    }, 60_000);

    afterAll(async () => {
      await ctx?.pool.end();
    });

    it("A: first acceptance stamps a database timestamp", async () => {
      const { userId, profileId } = await seedCompleteProfile(ctx.pool);
      const c = await newAuthClient(ctx.url, userId);
      try {
        const { rows } = await c.query(
          `SELECT public.accept_recruiter_posting_terms($1) AS ts`,
          [CANONICAL_VERSION],
        );
        await c.query("COMMIT");
        expect(rows[0].ts).toBeInstanceOf(Date);
        const row = await readConsent(ctx.pool, profileId);
        expect(row.at).toBeInstanceOf(Date);
        expect(row.v).toBe(CANONICAL_VERSION);
      } finally {
        try { await c.end(); } catch { /* noop */ }
      }
    });

    it("B: same-version retry returns the identical original timestamp", async () => {
      const { userId, profileId } = await seedCompleteProfile(ctx.pool);

      const c1 = await newAuthClient(ctx.url, userId);
      let r1: pg.QueryResult;
      try {
        r1 = await c1.query(`SELECT public.accept_recruiter_posting_terms($1) AS ts`, [
          CANONICAL_VERSION,
        ]);
        await c1.query("COMMIT");
      } finally {
        try { await c1.end(); } catch { /* noop */ }
      }

      const c2 = await newAuthClient(ctx.url, userId);
      let r2: pg.QueryResult;
      try {
        r2 = await c2.query(`SELECT public.accept_recruiter_posting_terms($1) AS ts`, [
          CANONICAL_VERSION,
        ]);
        await c2.query("COMMIT");
      } finally {
        try { await c2.end(); } catch { /* noop */ }
      }

      expect((r1.rows[0].ts as Date).toISOString()).toBe(
        (r2.rows[0].ts as Date).toISOString(),
      );
      const row = await readConsent(ctx.pool, profileId);
      expect(row.v).toBe(CANONICAL_VERSION);
    });

    // C. Stored-version MISMATCH branch: coherent historical pair seeded,
    // caller passes the SUPPORTED current input version. Exercises the
    // `_rp.posting_terms_version <> _version` branch (not the unsupported
    // input branch), and asserts both fields are preserved exactly.
    it("C: coherent historical stored version rejects current input with 22023 and preserves the pair", async () => {
      const { userId, profileId } = await seedCompleteProfile(ctx.pool);
      const stamped = new Date("2025-01-02T03:04:05.000Z");
      await ctx.pool.query(
        `UPDATE public.recruiter_profiles
            SET posting_terms_accepted_at = $1, posting_terms_version = $2
          WHERE id = $3`,
        [stamped, HISTORICAL_VERSION, profileId],
      );
      const c = await newAuthClient(ctx.url, userId);
      let sqlstate = "";
      try {
        await c.query(`SELECT public.accept_recruiter_posting_terms($1)`, [
          CANONICAL_VERSION,
        ]);
      } catch (err) {
        sqlstate = (err as { code?: string }).code ?? "";
      } finally {
        await c.query("ROLLBACK").catch(() => {});
        try { await c.end(); } catch { /* noop */ }
      }
      expect(sqlstate).toBe("22023");
      const row = await readConsent(ctx.pool, profileId);
      expect(row.v).toBe(HISTORICAL_VERSION);
      expect((row.at as Date).toISOString()).toBe(stamped.toISOString());
    });

    it("D: partial pair (ts present, version NULL) is rejected 22023, unchanged", async () => {
      const { userId, profileId } = await seedCompleteProfile(ctx.pool);
      const stamped = new Date("2024-05-06T07:08:09.000Z");
      await ctx.pool.query(
        `UPDATE public.recruiter_profiles
            SET posting_terms_accepted_at = $1, posting_terms_version = NULL
          WHERE id = $2`,
        [stamped, profileId],
      );
      const before = await readConsent(ctx.pool, profileId);
      const c = await newAuthClient(ctx.url, userId);
      let sqlstate = "";
      try {
        await c.query(`SELECT public.accept_recruiter_posting_terms($1)`, [CANONICAL_VERSION]);
      } catch (err) {
        sqlstate = (err as { code?: string }).code ?? "";
      } finally {
        await c.query("ROLLBACK").catch(() => {});
        try { await c.end(); } catch { /* noop */ }
      }
      expect(sqlstate).toBe("22023");
      const after = await readConsent(ctx.pool, profileId);
      expect(after.v).toBeNull();
      expect((after.at as Date).toISOString()).toBe((before.at as Date).toISOString());
    });

    it("E: partial pair (ts NULL, version present) is rejected 22023, unchanged", async () => {
      const { userId, profileId } = await seedCompleteProfile(ctx.pool);
      await ctx.pool.query(
        `UPDATE public.recruiter_profiles
            SET posting_terms_accepted_at = NULL, posting_terms_version = $1
          WHERE id = $2`,
        [HISTORICAL_VERSION, profileId],
      );
      const before = await readConsent(ctx.pool, profileId);
      const c = await newAuthClient(ctx.url, userId);
      let sqlstate = "";
      try {
        await c.query(`SELECT public.accept_recruiter_posting_terms($1)`, [CANONICAL_VERSION]);
      } catch (err) {
        sqlstate = (err as { code?: string }).code ?? "";
      } finally {
        await c.query("ROLLBACK").catch(() => {});
        try { await c.end(); } catch { /* noop */ }
      }
      expect(sqlstate).toBe("22023");
      const after = await readConsent(ctx.pool, profileId);
      expect(after.at).toBeNull();
      expect(after.v).toBe(before.v);
    });

    // Separate unsupported/NULL input case — distinct from case C.
    it("F: unsupported or NULL input version raises 22023 with no write", async () => {
      const { userId, profileId } = await seedCompleteProfile(ctx.pool);
      for (const bad of ["bogus", null] as const) {
        const c = await newAuthClient(ctx.url, userId);
        let sqlstate = "";
        try {
          await c.query(`SELECT public.accept_recruiter_posting_terms($1)`, [bad]);
        } catch (err) {
          sqlstate = (err as { code?: string }).code ?? "";
        } finally {
          await c.query("ROLLBACK").catch(() => {});
          try { await c.end(); } catch { /* noop */ }
        }
        expect(sqlstate).toBe("22023");
      }
      const row = await readConsent(ctx.pool, profileId);
      expect(row.at).toBeNull();
      expect(row.v).toBeNull();
    });

    it("G: incomplete profile is rejected 22023", async () => {
      const userId = randomUUID();
      const { rows } = await ctx.pool.query(
        `INSERT INTO public.recruiter_profiles
           (user_id, recruiter_name, company_name, recruiter_email, dot_number, mc_number)
         VALUES ($1, 'Rex', 'Acme', 'rex@acme.example', NULL, NULL)
         RETURNING id`,
        [userId],
      );
      const profileId = rows[0].id as string;
      const c = await newAuthClient(ctx.url, userId);
      let sqlstate = "";
      try {
        await c.query(`SELECT public.accept_recruiter_posting_terms($1)`, [CANONICAL_VERSION]);
      } catch (err) {
        sqlstate = (err as { code?: string }).code ?? "";
      } finally {
        await c.query("ROLLBACK").catch(() => {});
        try { await c.end(); } catch { /* noop */ }
      }
      expect(sqlstate).toBe("22023");
      const row = await readConsent(ctx.pool, profileId);
      expect(row.at).toBeNull();
      expect(row.v).toBeNull();
    });

    it("H: suspension (status or verification_status) blocks acceptance 42501", async () => {
      for (const col of ["status", "verification_status"] as const) {
        const { userId, profileId } = await seedCompleteProfile(ctx.pool);
        await ctx.pool.query(
          `UPDATE public.recruiter_profiles SET ${col} = 'suspended' WHERE id = $1`,
          [profileId],
        );
        const c = await newAuthClient(ctx.url, userId);
        let sqlstate = "";
        try {
          await c.query(`SELECT public.accept_recruiter_posting_terms($1)`, [CANONICAL_VERSION]);
        } catch (err) {
          sqlstate = (err as { code?: string }).code ?? "";
        } finally {
          await c.query("ROLLBACK").catch(() => {});
          try { await c.end(); } catch { /* noop */ }
        }
        expect(sqlstate).toBe("42501");
        const row = await readConsent(ctx.pool, profileId);
        expect(row.at).toBeNull();
        expect(row.v).toBeNull();
      }
    });

    it("I: anonymous role cannot execute the function", async () => {
      const c = new pg.Client({ connectionString: ctx.url, statement_timeout: 15_000 });
      await c.connect();
      let sqlstate = "";
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL role anon");
        await c.query(`SELECT public.accept_recruiter_posting_terms($1)`, [CANONICAL_VERSION]);
      } catch (err) {
        sqlstate = (err as { code?: string }).code ?? "";
      } finally {
        await c.query("ROLLBACK").catch(() => {});
        try { await c.end(); } catch { /* noop */ }
      }
      expect(sqlstate).toBe("42501");
    });

    // J. Full concurrency proof + post-commit same-version retry.
    //   - two distinct pg_backend_pid()
    //   - B genuinely blocked before A commits (Lock wait_event_type,
    //     transaction lock wait_event when Postgres reports it)
    //   - A and B commit; both return the same timestamp
    //   - a THIRD independent connection then calls same-version RPC and
    //     receives the identical original timestamp; row is unchanged
    it(
      "J: two-connection race + post-commit same-version retry all return the identical original timestamp",
      async () => {
        const { userId, profileId } = await seedCompleteProfile(ctx.pool);

        const a = new pg.Client({ connectionString: ctx.url, statement_timeout: 15_000 });
        const b = new pg.Client({ connectionString: ctx.url, statement_timeout: 15_000 });
        let c: pg.Client | null = null;
        await a.connect();
        await b.connect();

        try {
          const pidA = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
          const pidB = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
          expect(pidA).not.toBe(pidB);

          await a.query("BEGIN");
          await a.query("SET LOCAL role authenticated");
          await a.query(`SET LOCAL "request.jwt.claim.sub" = '${userId}'`);
          const aRes = await a.query(
            `SELECT public.accept_recruiter_posting_terms($1) AS ts`,
            [CANONICAL_VERSION],
          );
          const tsA = aRes.rows[0].ts as Date;

          await b.query("BEGIN");
          await b.query("SET LOCAL role authenticated");
          await b.query(`SET LOCAL "request.jwt.claim.sub" = '${userId}'`);
          const bPromise = b.query(
            `SELECT public.accept_recruiter_posting_terms($1) AS ts`,
            [CANONICAL_VERSION],
          );

          const raced = await Promise.race([
            bPromise.then(() => "resolved-early" as const),
            new Promise<"still-blocked">((r) => setTimeout(() => r("still-blocked"), 500)),
          ]);
          expect(raced).toBe("still-blocked");

          const waitProbe = await ctx.pool.query(
            `SELECT wait_event_type, wait_event
               FROM pg_stat_activity WHERE pid = $1`,
            [pidB],
          );
          expect(waitProbe.rows[0].wait_event_type).toBe("Lock");
          // Postgres reports the specific lock wait_event when it can — assert
          // it identifies transaction-level locking whenever it's populated.
          if (waitProbe.rows[0].wait_event) {
            expect(String(waitProbe.rows[0].wait_event).toLowerCase()).toContain("transaction");
          }

          await a.query("COMMIT");

          const bRes = await bPromise;
          await b.query("COMMIT");
          const tsB = bRes.rows[0].ts as Date;

          expect(tsB.toISOString()).toBe(tsA.toISOString());

          // THIRD independent authenticated transaction: same-version retry
          // after both A and B have committed. Must return the same original
          // timestamp; stored pair must be unchanged.
          c = await newAuthClient(ctx.url, userId);
          const cRes = await c.query(
            `SELECT public.accept_recruiter_posting_terms($1) AS ts`,
            [CANONICAL_VERSION],
          );
          await c.query("COMMIT");
          const tsC = cRes.rows[0].ts as Date;
          expect(tsC.toISOString()).toBe(tsA.toISOString());

          const row = await readConsent(ctx.pool, profileId);
          expect(row.v).toBe(CANONICAL_VERSION);
          expect((row.at as Date).toISOString()).toBe(tsA.toISOString());
        } finally {
          try { await a.query("ROLLBACK"); } catch { /* noop */ }
          try { await b.query("ROLLBACK"); } catch { /* noop */ }
          try { if (c) await c.query("ROLLBACK"); } catch { /* noop */ }
          try { await a.end(); } catch { /* noop */ }
          try { await b.end(); } catch { /* noop */ }
          try { if (c) await c.end(); } catch { /* noop */ }
        }
      },
      30_000,
    );
  },
);
