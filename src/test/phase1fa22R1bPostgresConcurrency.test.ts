/**
 * Phase 1F-A.2.2-R1B — Real-PostgreSQL concurrency + consent-pair integrity.
 *
 * This test is DEFERRED to the GitHub Actions workflow
 * `.github/workflows/recruiter-consent-postgres.yml`, which spins up a real
 * `postgres:16` service container and exports `DATABASE_URL`.
 *
 * Locally (no `DATABASE_URL`), the entire suite is skipped — Vitest's normal
 * `bunx vitest run` remains green with zero live database access.
 *
 * The test uses the `pg` client. It reads the exact repository migration
 * SQL from disk at runtime (never a copied string) and executes it against
 * a clean schema-faithful baseline.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// `pg` is a CommonJS package; the default export exposes { Client, Pool }.
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const CI_POSTGRES = process.env.R1B_REQUIRE_POSTGRES === '1';

const CANONICAL_VERSION = '2026-07-17.v1';
const R1B_MIGRATION_PATH = resolve(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260717222023_r1b_consent_pair_integrity.sql',
);
const PRIOR_MIGRATION_PATH = resolve(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260717213626_3ad0fe69-da04-413d-837d-25f43bb53fdd.sql',
);

/**
 * Minimal, schema-faithful bootstrap. Creates only what the production
 * function references so the exact repository migration SQL can execute
 * unchanged. No production data, no live-database contact.
 */
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

-- Install a trivially-satisfied prior baseline of the function so the
-- R1B migration's CREATE OR REPLACE has a target. The function body will
-- be replaced by the migration under test.
CREATE OR REPLACE FUNCTION public.accept_recruiter_posting_terms(_version text)
RETURNS timestamptz LANGUAGE sql AS $fn$ SELECT now() $fn$;
`;

interface Ctx {
  pool: pg.Pool;
  ownerUrl: string;
  authUrl: string;
  anonUrl: string;
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
  await c.query('BEGIN');
  await c.query('SET LOCAL role authenticated');
  await c.query(`SET LOCAL "request.jwt.claim.sub" = '${userId}'`);
  return c;
}

async function seedCompleteProfile(pool: pg.Pool): Promise<{ userId: string; profileId: string }> {
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

// -------------------------------------------------------------------------
const shouldRun = Boolean(DATABASE_URL);
if (!shouldRun && CI_POSTGRES) {
  throw new Error('R1B_REQUIRE_POSTGRES=1 but DATABASE_URL is not set');
}

(shouldRun ? describe : describe.skip)(
  'Phase 1F-A.2.2-R1B — real Postgres consent-pair integrity',
  () => {
    let ctx: Ctx;
    let priorSql: string;
    let r1bSql: string;

    beforeAll(async () => {
      priorSql = readFileSync(PRIOR_MIGRATION_PATH, 'utf8');
      r1bSql = readFileSync(R1B_MIGRATION_PATH, 'utf8');
      const url = DATABASE_URL!;
      const pool = new pg.Pool({ connectionString: url, max: 4 });
      ctx = { pool, ownerUrl: url, authUrl: url, anonUrl: url };

      await withOwner(pool, async (c) => {
        await c.query(BOOTSTRAP_SQL);
        // Apply the exact prior migration (includes DROP TRIGGER IF EXISTS,
        // which is a no-op in the harness) and then the R1B migration under
        // test — both read verbatim from disk.
        await c.query(priorSql);
        await c.query(r1bSql);
      });
    }, 60_000);

    afterAll(async () => {
      await ctx?.pool.end();
    });

    // ---------------------------------------------------------------------
    // A. Both NULL → first call succeeds.
    it('A: first acceptance stamps a database timestamp', async () => {
      const { userId, profileId } = await seedCompleteProfile(ctx.pool);
      const c = await newAuthClient(ctx.authUrl, userId);
      try {
        const { rows } = await c.query(
          `SELECT public.accept_recruiter_posting_terms($1) AS ts`,
          [CANONICAL_VERSION],
        );
        await c.query('COMMIT');
        expect(rows[0].ts).toBeInstanceOf(Date);
        const row = await readConsent(ctx.pool, profileId);
        expect(row.at).toBeInstanceOf(Date);
        expect(row.v).toBe(CANONICAL_VERSION);
      } finally {
        await c.end();
      }
    });

    // B. Sequential same-version retry returns identical original timestamp.
    it('B: same-version retry returns the identical original timestamp', async () => {
      const { userId, profileId } = await seedCompleteProfile(ctx.pool);

      const c1 = await newAuthClient(ctx.authUrl, userId);
      const r1 = await c1.query(`SELECT public.accept_recruiter_posting_terms($1) AS ts`, [
        CANONICAL_VERSION,
      ]);
      await c1.query('COMMIT');
      await c1.end();

      const c2 = await newAuthClient(ctx.authUrl, userId);
      const r2 = await c2.query(`SELECT public.accept_recruiter_posting_terms($1) AS ts`, [
        CANONICAL_VERSION,
      ]);
      await c2.query('COMMIT');
      await c2.end();

      expect((r1.rows[0].ts as Date).toISOString()).toBe((r2.rows[0].ts as Date).toISOString());
      const row = await readConsent(ctx.pool, profileId);
      expect(row.v).toBe(CANONICAL_VERSION);
    });

    // C. Different version rejects with 22023 and preserves both fields.
    it('C: different-version call raises 22023 and preserves both values', async () => {
      const { userId, profileId } = await seedCompleteProfile(ctx.pool);
      const stamped = new Date('2025-01-02T03:04:05.000Z');
      await ctx.pool.query(
        `UPDATE public.recruiter_profiles SET posting_terms_accepted_at = $1, posting_terms_version = $2 WHERE id = $3`,
        [stamped, CANONICAL_VERSION, profileId],
      );
      const c = await newAuthClient(ctx.authUrl, userId);
      let sqlstate = '';
      try {
        await c.query(`SELECT public.accept_recruiter_posting_terms('9999-99-99.vX')`);
      } catch (err) {
        sqlstate = (err as { code?: string }).code ?? '';
      } finally {
        await c.query('ROLLBACK').catch(() => {});
        await c.end();
      }
      expect(sqlstate).toBe('22023');
      const row = await readConsent(ctx.pool, profileId);
      expect(row.v).toBe(CANONICAL_VERSION);
      expect((row.at as Date).toISOString()).toBe(stamped.toISOString());
    });

    // D. Timestamp present, version NULL → 22023, no mutation.
    it('D: partial pair (ts present, version NULL) is rejected 22023, unchanged', async () => {
      const { userId, profileId } = await seedCompleteProfile(ctx.pool);
      const stamped = new Date('2024-05-06T07:08:09.000Z');
      await ctx.pool.query(
        `UPDATE public.recruiter_profiles SET posting_terms_accepted_at = $1, posting_terms_version = NULL WHERE id = $2`,
        [stamped, profileId],
      );
      const before = await readConsent(ctx.pool, profileId);
      const c = await newAuthClient(ctx.authUrl, userId);
      let sqlstate = '';
      try {
        await c.query(`SELECT public.accept_recruiter_posting_terms($1)`, [CANONICAL_VERSION]);
      } catch (err) {
        sqlstate = (err as { code?: string }).code ?? '';
      } finally {
        await c.query('ROLLBACK').catch(() => {});
        await c.end();
      }
      expect(sqlstate).toBe('22023');
      const after = await readConsent(ctx.pool, profileId);
      expect(after.v).toBeNull();
      expect((after.at as Date).toISOString()).toBe((before.at as Date).toISOString());
    });

    // E. Version present, timestamp NULL → 22023, no mutation.
    it('E: partial pair (ts NULL, version present) is rejected 22023, unchanged', async () => {
      const { userId, profileId } = await seedCompleteProfile(ctx.pool);
      await ctx.pool.query(
        `UPDATE public.recruiter_profiles SET posting_terms_accepted_at = NULL, posting_terms_version = $1 WHERE id = $2`,
        [CANONICAL_VERSION, profileId],
      );
      const before = await readConsent(ctx.pool, profileId);
      const c = await newAuthClient(ctx.authUrl, userId);
      let sqlstate = '';
      try {
        await c.query(`SELECT public.accept_recruiter_posting_terms($1)`, [CANONICAL_VERSION]);
      } catch (err) {
        sqlstate = (err as { code?: string }).code ?? '';
      } finally {
        await c.query('ROLLBACK').catch(() => {});
        await c.end();
      }
      expect(sqlstate).toBe('22023');
      const after = await readConsent(ctx.pool, profileId);
      expect(after.at).toBeNull();
      expect(after.v).toBe(before.v);
    });

    // F. Unsupported / NULL version → 22023, no mutation.
    it('F: unsupported or NULL version raises 22023 with no write', async () => {
      const { userId, profileId } = await seedCompleteProfile(ctx.pool);
      for (const bad of ['bogus', null] as const) {
        const c = await newAuthClient(ctx.authUrl, userId);
        let sqlstate = '';
        try {
          await c.query(`SELECT public.accept_recruiter_posting_terms($1)`, [bad]);
        } catch (err) {
          sqlstate = (err as { code?: string }).code ?? '';
        } finally {
          await c.query('ROLLBACK').catch(() => {});
          await c.end();
        }
        expect(sqlstate).toBe('22023');
      }
      const row = await readConsent(ctx.pool, profileId);
      expect(row.at).toBeNull();
      expect(row.v).toBeNull();
    });

    // G. Incomplete profile is rejected (missing DOT/MC), no consent mutation.
    it('G: incomplete profile is rejected 22023', async () => {
      const userId = randomUUID();
      const { rows } = await ctx.pool.query(
        `INSERT INTO public.recruiter_profiles
           (user_id, recruiter_name, company_name, recruiter_email, dot_number, mc_number)
         VALUES ($1, 'Rex', 'Acme', 'rex@acme.example', NULL, NULL)
         RETURNING id`,
        [userId],
      );
      const profileId = rows[0].id as string;
      const c = await newAuthClient(ctx.authUrl, userId);
      let sqlstate = '';
      try {
        await c.query(`SELECT public.accept_recruiter_posting_terms($1)`, [CANONICAL_VERSION]);
      } catch (err) {
        sqlstate = (err as { code?: string }).code ?? '';
      } finally {
        await c.query('ROLLBACK').catch(() => {});
        await c.end();
      }
      expect(sqlstate).toBe('22023');
      const row = await readConsent(ctx.pool, profileId);
      expect(row.at).toBeNull();
      expect(row.v).toBeNull();
    });

    // H. Suspension in either field blocks acceptance.
    it('H: suspension (status or verification_status) blocks acceptance 42501', async () => {
      for (const col of ['status', 'verification_status'] as const) {
        const { userId, profileId } = await seedCompleteProfile(ctx.pool);
        await ctx.pool.query(
          `UPDATE public.recruiter_profiles SET ${col} = 'suspended' WHERE id = $1`,
          [profileId],
        );
        const c = await newAuthClient(ctx.authUrl, userId);
        let sqlstate = '';
        try {
          await c.query(`SELECT public.accept_recruiter_posting_terms($1)`, [CANONICAL_VERSION]);
        } catch (err) {
          sqlstate = (err as { code?: string }).code ?? '';
        } finally {
          await c.query('ROLLBACK').catch(() => {});
          await c.end();
        }
        expect(sqlstate).toBe('42501');
        const row = await readConsent(ctx.pool, profileId);
        expect(row.at).toBeNull();
        expect(row.v).toBeNull();
      }
    });

    // I. Anonymous execution denied (EXECUTE revoked from anon).
    it('I: anonymous role cannot execute the function', async () => {
      const c = new pg.Client({ connectionString: ctx.anonUrl, statement_timeout: 15_000 });
      await c.connect();
      let sqlstate = '';
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL role anon');
        await c.query(`SELECT public.accept_recruiter_posting_terms($1)`, [CANONICAL_VERSION]);
      } catch (err) {
        sqlstate = (err as { code?: string }).code ?? '';
      } finally {
        await c.query('ROLLBACK').catch(() => {});
        await c.end();
      }
      // 42501 insufficient_privilege
      expect(sqlstate).toBe('42501');
    });

    // J. Genuine two-connection race on SELECT ... FOR UPDATE row lock.
    it('J: two independent connections race — B blocks on A\'s row lock, both return the SAME timestamp', async () => {
      const { userId, profileId } = await seedCompleteProfile(ctx.pool);

      const a = new pg.Client({ connectionString: ctx.authUrl, statement_timeout: 15_000 });
      const b = new pg.Client({ connectionString: ctx.authUrl, statement_timeout: 15_000 });
      await a.connect();
      await b.connect();

      const pidA = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      const pidB = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      expect(pidA).not.toBe(pidB);

      try {
        // A begins, claims the row lock, stamps consent, but does NOT commit.
        await a.query('BEGIN');
        await a.query('SET LOCAL role authenticated');
        await a.query(`SET LOCAL "request.jwt.claim.sub" = '${userId}'`);
        const aRes = await a.query(`SELECT public.accept_recruiter_posting_terms($1) AS ts`, [
          CANONICAL_VERSION,
        ]);
        const tsA = aRes.rows[0].ts as Date;

        // B begins in parallel and issues the same RPC. It must block on
        // the SELECT ... FOR UPDATE row lock A is holding.
        await b.query('BEGIN');
        await b.query('SET LOCAL role authenticated');
        await b.query(`SET LOCAL "request.jwt.claim.sub" = '${userId}'`);
        const bPromise = b.query(`SELECT public.accept_recruiter_posting_terms($1) AS ts`, [
          CANONICAL_VERSION,
        ]);

        // Barrier: allow B to reach the lock, then verify it is genuinely
        // blocked (pg_stat_activity reports Lock:transactionid on pidB).
        const raced = await Promise.race([
          bPromise.then(() => 'resolved-early' as const),
          new Promise<'still-blocked'>((r) => setTimeout(() => r('still-blocked'), 500)),
        ]);
        expect(raced).toBe('still-blocked');

        const waitProbe = await ctx.pool.query(
          `SELECT wait_event_type, wait_event
             FROM pg_stat_activity WHERE pid = $1`,
          [pidB],
        );
        expect(waitProbe.rows[0].wait_event_type).toBe('Lock');

        // Release the lock.
        await a.query('COMMIT');

        const bRes = await bPromise;
        await b.query('COMMIT');
        const tsB = bRes.rows[0].ts as Date;

        // Both callers observe the identical first-write timestamp.
        expect(tsB.toISOString()).toBe(tsA.toISOString());

        const row = await readConsent(ctx.pool, profileId);
        expect(row.v).toBe(CANONICAL_VERSION);
        expect((row.at as Date).toISOString()).toBe(tsA.toISOString());
      } finally {
        try { await a.end(); } catch { /* noop */ }
        try { await b.end(); } catch { /* noop */ }
      }
    }, 30_000);
  },
);
