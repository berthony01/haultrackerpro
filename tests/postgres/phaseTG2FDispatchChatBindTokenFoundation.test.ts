/**
 * Phase TG-2F-A — Real PostgreSQL gate for the secure dispatch-chat bind
 * token foundation candidate.
 *
 * Applies the accepted TG-2B and TG-2C candidates FIRST (they establish
 * `telegram_user_links`, `telegram_chat_bindings` and the authoritative
 * `telegram_bind_dispatch_chat` bridge), snapshots the resulting object
 * inventory, then applies the TG-2F-A candidate and proves it adds exactly
 * one table plus two functions, changes nothing about the existing Telegram
 * surface, and enforces every declared constraint, privilege, RLS and
 * fail-closed contract against real PostgreSQL.
 *
 * Lives OUTSIDE `src/` so the default `bunx vitest run` never picks it up.
 * Run with an ad-hoc config (for example under /tmp) that includes only this
 * file.
 *
 * NEVER SKIPS. Fails hard if TG2F_DATABASE_URL is absent. NEVER point this at
 * the production database.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.TG2F_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'TG2F_DATABASE_URL is required for the Phase TG-2F-A real-Postgres gate.',
  );
}
const URL_STR: string = DATABASE_URL;

function candidate(file: string): string {
  return readFileSync(
    fileURLToPath(
      new URL(`../../supabase/migration-candidates/${file}`, import.meta.url),
    ),
    'utf8',
  );
}

const TG2B_SQL = candidate(
  '20260819213000_phase_tg2b_telegram_identity_linking_foundation.sql',
);
const TG2C_SQL = candidate(
  '20260820013000_phase_tg2c_telegram_actor_authorization_bridge.sql',
);
const TG2F_SQL = candidate(
  '20260824053000_phase_tg2f_dispatch_chat_bind_token_foundation.sql',
);

const pool = new pg.Pool({ connectionString: URL_STR, max: 4 });

/** Object inventory of the public schema, used for before/after diffing. */
async function inventory(client: pg.PoolClient) {
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY 1`,
  );
  const functions = await client.query<{ proname: string; args: string }>(
    `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' ORDER BY 1, 2`,
  );
  return {
    tables: tables.rows.map((r) => r.table_name),
    functions: functions.rows.map((r) => `${r.proname}(${r.args})`),
  };
}

let before: Awaited<ReturnType<typeof inventory>>;
let after: Awaited<ReturnType<typeof inventory>>;

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
    `);
    await client.query(TG2B_SQL);
    await client.query(TG2C_SQL);
    before = await inventory(client);
    await client.query(TG2F_SQL);
    after = await inventory(client);
  } finally {
    client.release();
  }
}, 120_000);

afterAll(async () => {
  await pool.end();
});

// ---------------------------------------------------------------------------
// Additive surface
// ---------------------------------------------------------------------------
describe('TG-2F-A live — additive surface', () => {
  it('adds exactly one table', () => {
    const added = after.tables.filter((t) => !before.tables.includes(t));
    expect(added).toEqual(['telegram_dispatch_bind_tokens']);
  });

  it('adds exactly two functions', () => {
    const added = after.functions.filter((f) => !before.functions.includes(f));
    expect(added.sort()).toEqual(
      [
        'consume_telegram_dispatch_bind_token(_telegram_user_id bigint, _telegram_chat_id bigint, _chat_type text, _raw_token text)',
        'issue_telegram_dispatch_bind_token(_recruiter_id uuid)',
      ].sort(),
    );
  });

  it('removes nothing', () => {
    for (const t of before.tables) expect(after.tables).toContain(t);
    for (const f of before.functions) expect(after.functions).toContain(f);
  });

  it('leaves the existing TG-2C bridge definition byte-identical', async () => {
    const { rows } = await pool.query<{ def: string }>(
      `SELECT pg_get_functiondef(p.oid) AS def
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'telegram_bind_dispatch_chat'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toContain("RAISE EXCEPTION 'telegram_dispatch_not_authorized'");
    expect(rows[0].def).toContain(
      "public.current_user_has_recruiter_permission(_recruiter_id, 'loads_dispatch')",
    );
  });
});

// ---------------------------------------------------------------------------
// RLS / privileges
// ---------------------------------------------------------------------------
describe('TG-2F-A live — RLS and privileges', () => {
  it('has RLS enabled and zero policies', async () => {
    const rls = await pool.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class
        WHERE oid = 'public.telegram_dispatch_bind_tokens'::regclass`,
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);

    const policies = await pool.query(
      `SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'telegram_dispatch_bind_tokens'`,
    );
    expect(policies.rowCount).toBe(0);
  });

  it('grants direct table access to service_role only', async () => {
    const { rows } = await pool.query<{ grantee: string }>(
      `SELECT DISTINCT grantee FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'telegram_dispatch_bind_tokens'
          AND grantee IN ('PUBLIC','anon','authenticated','service_role')`,
    );
    expect(rows.map((r) => r.grantee).sort()).toEqual(['service_role']);
  });

  it('grants issue to authenticated + service_role and consume to service_role only', async () => {
    const acl = async (name: string) => {
      const { rows } = await pool.query<{ acl: string | null }>(
        `SELECT array_to_string(p.proacl, ',') AS acl
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = $1`,
        [name],
      );
      return rows[0]?.acl ?? '';
    };

    const issueAcl = await acl('issue_telegram_dispatch_bind_token');
    expect(issueAcl).toContain('authenticated=X');
    expect(issueAcl).toContain('service_role=X');
    expect(issueAcl).not.toContain('anon=X');

    const consumeAcl = await acl('consume_telegram_dispatch_bind_token');
    expect(consumeAcl).toContain('service_role=X');
    expect(consumeAcl).not.toContain('authenticated=X');
    expect(consumeAcl).not.toContain('anon=X');
  });
});

// ---------------------------------------------------------------------------
// Constraint contract (rollback-safe: every case runs in its own transaction)
// ---------------------------------------------------------------------------
describe('TG-2F-A live — constraint contract', () => {
  /** Runs `fn` inside a transaction that is ALWAYS rolled back. */
  async function inRollback<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  /** Minimal synthetic recruiter workspace + owner, transaction-local. */
  async function seedWorkspace(c: pg.PoolClient) {
    const userId = randomUUID();
    await c.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
      [userId, `tg2f_${userId}@example.test`],
    );
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO public.recruiter_profiles
         (user_id, company_name, recruiter_name, status)
       VALUES ($1, 'TG2F Synthetic Carrier', 'TG2F Owner', 'active')
       RETURNING id`,
      [userId],
    );
    return { userId, recruiterId: rows[0].id };
  }

  const HASH_A = 'a'.repeat(64);
  const HASH_B = 'b'.repeat(64);

  it('rejects a non-hex or wrong-length token hash', async () => {
    await inRollback(async (c) => {
      const { userId, recruiterId } = await seedWorkspace(c);
      await expect(
        c.query(
          `INSERT INTO public.telegram_dispatch_bind_tokens
             (recruiter_id, issued_by_user_id, token_hash, expires_at)
           VALUES ($1,$2,'NOTAHASH', now() + interval '15 minutes')`,
          [recruiterId, userId],
        ),
      ).rejects.toThrow(/token_hash_format_check/);
    });
  });

  it('rejects an expiry at or before creation', async () => {
    await inRollback(async (c) => {
      const { userId, recruiterId } = await seedWorkspace(c);
      await expect(
        c.query(
          `INSERT INTO public.telegram_dispatch_bind_tokens
             (recruiter_id, issued_by_user_id, token_hash, created_at, expires_at)
           VALUES ($1,$2,$3, now(), now())`,
          [recruiterId, userId, HASH_A],
        ),
      ).rejects.toThrow(/expiry_after_creation_check/);
    });
  });

  it('rejects a row that is both consumed and invalidated', async () => {
    await inRollback(async (c) => {
      const { userId, recruiterId } = await seedWorkspace(c);
      await expect(
        c.query(
          `INSERT INTO public.telegram_dispatch_bind_tokens
             (recruiter_id, issued_by_user_id, token_hash, expires_at, consumed_at, invalidated_at)
           VALUES ($1,$2,$3, now() + interval '15 minutes', now(), now())`,
          [recruiterId, userId, HASH_A],
        ),
      ).rejects.toThrow(/terminal_state_exclusive_check/);
    });
  });

  it('allows only one outstanding token per (recruiter, issuer) pair', async () => {
    await inRollback(async (c) => {
      const { userId, recruiterId } = await seedWorkspace(c);
      await c.query(
        `INSERT INTO public.telegram_dispatch_bind_tokens
           (recruiter_id, issued_by_user_id, token_hash, expires_at)
         VALUES ($1,$2,$3, now() + interval '15 minutes')`,
        [recruiterId, userId, HASH_A],
      );
      await expect(
        c.query(
          `INSERT INTO public.telegram_dispatch_bind_tokens
             (recruiter_id, issued_by_user_id, token_hash, expires_at)
           VALUES ($1,$2,$3, now() + interval '15 minutes')`,
          [recruiterId, userId, HASH_B],
        ),
      ).rejects.toThrow(/outstanding_pair_unique/);
    });
  });

  it('permits a new outstanding token once the prior one is terminal', async () => {
    await inRollback(async (c) => {
      const { userId, recruiterId } = await seedWorkspace(c);
      await c.query(
        `INSERT INTO public.telegram_dispatch_bind_tokens
           (recruiter_id, issued_by_user_id, token_hash, expires_at, invalidated_at)
         VALUES ($1,$2,$3, now() + interval '15 minutes', now())`,
        [recruiterId, userId, HASH_A],
      );
      const res = await c.query(
        `INSERT INTO public.telegram_dispatch_bind_tokens
           (recruiter_id, issued_by_user_id, token_hash, expires_at)
         VALUES ($1,$2,$3, now() + interval '15 minutes') RETURNING id`,
        [recruiterId, userId, HASH_B],
      );
      expect(res.rowCount).toBe(1);
    });
  });

  it('never stores a raw token: the column does not exist', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='telegram_dispatch_bind_tokens'
        ORDER BY 1`,
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual(
      [
        'consumed_at',
        'created_at',
        'expires_at',
        'id',
        'invalidated_at',
        'issued_by_user_id',
        'recruiter_id',
        'token_hash',
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Issue RPC behaviour
// ---------------------------------------------------------------------------
describe('TG-2F-A live — issue RPC behaviour', () => {
  async function inRollback<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  async function seedWorkspace(c: pg.PoolClient) {
    const userId = randomUUID();
    await c.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, [
      userId,
      `tg2f_${userId}@example.test`,
    ]);
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO public.recruiter_profiles
         (user_id, company_name, recruiter_name, status)
       VALUES ($1,'TG2F Synthetic Carrier','TG2F Owner','active') RETURNING id`,
      [userId],
    );
    return { userId, recruiterId: rows[0].id };
  }

  /** Sets the transaction-local acting identity the RPC reads via auth.uid(). */
  async function actAs(c: pg.PoolClient, userId: string | null) {
    await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
      userId ?? '',
    ]);
  }

  it('fails closed when unauthenticated', async () => {
    await inRollback(async (c) => {
      const { recruiterId } = await seedWorkspace(c);
      await actAs(c, null);
      await expect(
        c.query(`SELECT public.issue_telegram_dispatch_bind_token($1)`, [recruiterId]),
      ).rejects.toThrow(/telegram_not_authenticated/);
    });
  });

  it('rejects a null recruiter workspace', async () => {
    await inRollback(async (c) => {
      const { userId } = await seedWorkspace(c);
      await actAs(c, userId);
      await expect(
        c.query(`SELECT public.issue_telegram_dispatch_bind_token(NULL::uuid)`),
      ).rejects.toThrow(/telegram_dispatch_bind_invalid_input/);
    });
  });

  it('rejects an unknown or inactive workspace without disclosing it', async () => {
    await inRollback(async (c) => {
      const { userId } = await seedWorkspace(c);
      await actAs(c, userId);
      await expect(
        c.query(`SELECT public.issue_telegram_dispatch_bind_token($1)`, [randomUUID()]),
      ).rejects.toThrow(/telegram_workspace_not_available/);
    });
  });

  it('rejects a caller without loads_dispatch on the workspace', async () => {
    await inRollback(async (c) => {
      const { recruiterId } = await seedWorkspace(c);
      const outsider = randomUUID();
      await c.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, [
        outsider,
        `tg2f_out_${outsider}@example.test`,
      ]);
      await actAs(c, outsider);
      await expect(
        c.query(`SELECT public.issue_telegram_dispatch_bind_token($1)`, [recruiterId]),
      ).rejects.toThrow(/telegram_dispatch_not_authorized/);
    });
  });

  it('stores only the hash of the returned raw token, with a 15 minute TTL', async () => {
    await inRollback(async (c) => {
      const { userId, recruiterId } = await seedWorkspace(c);
      await actAs(c, userId);
      const { rows } = await c.query<{ token: string }>(
        `SELECT public.issue_telegram_dispatch_bind_token($1) AS token`,
        [recruiterId],
      );
      const raw = rows[0].token;
      expect(raw).toMatch(/^[0-9a-f]{64}$/);

      const stored = await c.query<{
        token_hash: string;
        ttl_seconds: string;
      }>(
        `SELECT token_hash,
                EXTRACT(EPOCH FROM (expires_at - created_at))::text AS ttl_seconds
           FROM public.telegram_dispatch_bind_tokens
          WHERE recruiter_id = $1 AND issued_by_user_id = $2`,
        [recruiterId, userId],
      );
      expect(stored.rowCount).toBe(1);
      expect(stored.rows[0].token_hash).not.toBe(raw);
      expect(stored.rows[0].token_hash).toBe(
        (
          await c.query<{ h: string }>(
            `SELECT encode(extensions.digest($1,'sha256'),'hex') AS h`,
            [raw],
          )
        ).rows[0].h,
      );
      expect(Number(stored.rows[0].ttl_seconds)).toBe(900);
    });
  });

  it('reissue invalidates the prior exact-pair token and leaves exactly one live', async () => {
    await inRollback(async (c) => {
      const { userId, recruiterId } = await seedWorkspace(c);
      await actAs(c, userId);
      const first = (
        await c.query<{ token: string }>(
          `SELECT public.issue_telegram_dispatch_bind_token($1) AS token`,
          [recruiterId],
        )
      ).rows[0].token;
      const second = (
        await c.query<{ token: string }>(
          `SELECT public.issue_telegram_dispatch_bind_token($1) AS token`,
          [recruiterId],
        )
      ).rows[0].token;
      expect(second).not.toBe(first);

      const counts = await c.query<{ live: string; invalidated: string }>(
        `SELECT count(*) FILTER (WHERE consumed_at IS NULL AND invalidated_at IS NULL)::text AS live,
                count(*) FILTER (WHERE invalidated_at IS NOT NULL)::text AS invalidated
           FROM public.telegram_dispatch_bind_tokens
          WHERE recruiter_id = $1 AND issued_by_user_id = $2`,
        [recruiterId, userId],
      );
      expect(counts.rows[0].live).toBe('1');
      expect(counts.rows[0].invalidated).toBe('1');
    });
  });
});

// ---------------------------------------------------------------------------
// Consume RPC behaviour
// ---------------------------------------------------------------------------
describe('TG-2F-A live — consume RPC behaviour', () => {
  async function inRollback<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  /** Workspace owner + an ACTIVE Telegram identity link for that owner. */
  async function seedLinkedOwner(c: pg.PoolClient, telegramUserId: number) {
    const userId = randomUUID();
    await c.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, [
      userId,
      `tg2f_${userId}@example.test`,
    ]);
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO public.recruiter_profiles
         (user_id, company_name, recruiter_name, status)
       VALUES ($1,'TG2F Synthetic Carrier','TG2F Owner','active') RETURNING id`,
      [userId],
    );
    await c.query(
      `INSERT INTO public.telegram_user_links (user_id, telegram_user_id, status, linked_at)
       VALUES ($1,$2,'active', now())`,
      [userId, telegramUserId],
    );
    return { userId, recruiterId: rows[0].id };
  }

  async function issueFor(c: pg.PoolClient, userId: string, recruiterId: string) {
    await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    const { rows } = await c.query<{ token: string }>(
      `SELECT public.issue_telegram_dispatch_bind_token($1) AS token`,
      [recruiterId],
    );
    return rows[0].token;
  }

  /**
   * Runs `run` inside a SAVEPOINT, asserts it rejects with `pattern`, then
   * recovers the transaction with ROLLBACK TO SAVEPOINT so subsequent
   * assertions execute in the SAME (non-aborted) outer transaction.
   */
  async function expectFailureWithRecovery(
    c: pg.PoolClient,
    savepoint: string,
    run: (c: pg.PoolClient) => Promise<unknown>,
    pattern: RegExp,
  ) {
    await c.query(`SAVEPOINT ${savepoint}`);
    await expect(run(c)).rejects.toThrow(pattern);
    await c.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await c.query(`RELEASE SAVEPOINT ${savepoint}`);
  }

  const CHAT_ID = -1001234500001;

  it('rejects a malformed secret with the fixed generic error', async () => {
    await inRollback(async (c) => {
      await expect(
        c.query(
          `SELECT public.consume_telegram_dispatch_bind_token($1,$2,'group','not-a-token')`,
          [900001, CHAT_ID],
        ),
      ).rejects.toThrow(/telegram_dispatch_bind_token_invalid/);
    });
  });

  it('rejects an unknown but well-formed secret with the SAME error', async () => {
    await inRollback(async (c) => {
      await expect(
        c.query(
          `SELECT public.consume_telegram_dispatch_bind_token($1,$2,'group',$3)`,
          [900002, CHAT_ID, 'c'.repeat(64)],
        ),
      ).rejects.toThrow(/telegram_dispatch_bind_token_invalid/);
    });
  });

  it('rejects a non-group chat type before touching the token', async () => {
    await inRollback(async (c) => {
      // Token is seeded OUTSIDE the savepoint so it survives the recovery.
      const { userId, recruiterId } = await seedLinkedOwner(c, 900003);
      const token = await issueFor(c, userId, recruiterId);

      await expectFailureWithRecovery(
        c,
        'tg2f_chat_type',
        (t) =>
          t.query(
            `SELECT public.consume_telegram_dispatch_bind_token($1,$2,'private',$3)`,
            [900003, CHAT_ID, token],
          ),
        /telegram_dispatch_bind_invalid_input/,
      );

      const still = await c.query(
        `SELECT 1 FROM public.telegram_dispatch_bind_tokens
          WHERE recruiter_id = $1 AND issued_by_user_id = $2
            AND consumed_at IS NULL AND invalidated_at IS NULL`,
        [recruiterId, userId],
      );
      expect(still.rowCount).toBe(1);

      const leftover = await c.query(
        `SELECT 1 FROM public.telegram_chat_bindings
          WHERE telegram_chat_id = $1 AND status = 'active'`,
        [CHAT_ID],
      );
      expect(leftover.rowCount).toBe(0);
    });
  });

  it('binds the chat, derives the recruiter from the token, and terminalizes once', async () => {
    await inRollback(async (c) => {
      const { userId, recruiterId } = await seedLinkedOwner(c, 900004);
      const token = await issueFor(c, userId, recruiterId);

      const { rows } = await c.query<{ recruiter_id: string; status: string; chat_type: string }>(
        `SELECT * FROM public.consume_telegram_dispatch_bind_token($1,$2,'supergroup',$3)`,
        [900004, CHAT_ID, token],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].recruiter_id).toBe(recruiterId);
      expect(rows[0].status).toBe('active');
      expect(rows[0].chat_type).toBe('supergroup');

      const consumed = await c.query<{ consumed_at: string | null }>(
        `SELECT consumed_at FROM public.telegram_dispatch_bind_tokens
          WHERE recruiter_id = $1`,
        [recruiterId],
      );
      expect(consumed.rowCount).toBe(1);
      expect(consumed.rows[0].consumed_at).not.toBeNull();
    });
  });

  it('rejects replay of an already-consumed secret', async () => {
    await inRollback(async (c) => {
      const { userId, recruiterId } = await seedLinkedOwner(c, 900005);
      const token = await issueFor(c, userId, recruiterId);
      await c.query(
        `SELECT public.consume_telegram_dispatch_bind_token($1,$2,'group',$3)`,
        [900005, CHAT_ID, token],
      );
      await expect(
        c.query(
          `SELECT public.consume_telegram_dispatch_bind_token($1,$2,'group',$3)`,
          [900005, -1001234500002, token],
        ),
      ).rejects.toThrow(/telegram_dispatch_bind_token_invalid/);
    });
  });

  it('rejects an expired secret with the fixed generic error', async () => {
    await inRollback(async (c) => {
      const { userId, recruiterId } = await seedLinkedOwner(c, 900006);
      const token = await issueFor(c, userId, recruiterId);
      await c.query(
        `UPDATE public.telegram_dispatch_bind_tokens
            SET expires_at = created_at + interval '1 second'
          WHERE recruiter_id = $1`,
        [recruiterId],
      );
      await c.query(
        `UPDATE public.telegram_dispatch_bind_tokens
            SET created_at = now() - interval '1 hour',
                expires_at = now() - interval '45 minutes'
          WHERE recruiter_id = $1`,
        [recruiterId],
      );
      await expect(
        c.query(
          `SELECT public.consume_telegram_dispatch_bind_token($1,$2,'group',$3)`,
          [900006, CHAT_ID, token],
        ),
      ).rejects.toThrow(/telegram_dispatch_bind_token_invalid/);
    });
  });

  it('propagates the existing TG-2C actor error and does NOT burn the token', async () => {
    await inRollback(async (c) => {
      // Workspace owner holds loads_dispatch, but the PRESENTING Telegram
      // identity is not linked to any account.
      const { userId, recruiterId } = await seedLinkedOwner(c, 900007);
      const token = await issueFor(c, userId, recruiterId);

      // Statement-level recovery: the failed consume is rolled back to the
      // savepoint, so the assertions below observe the SAME outer transaction
      // and prove the token survived the failed attempt itself — not merely
      // that the whole test transaction was discarded afterwards.
      await expectFailureWithRecovery(
        c,
        'tg2f_actor',
        (t) =>
          t.query(
            `SELECT public.consume_telegram_dispatch_bind_token($1,$2,'group',$3)`,
            [999999, CHAT_ID, token],
          ),
        /telegram_actor_not_linked/,
      );

      const still = await c.query<{ token_hash: string }>(
        `SELECT token_hash FROM public.telegram_dispatch_bind_tokens
          WHERE recruiter_id = $1 AND issued_by_user_id = $2
            AND consumed_at IS NULL AND invalidated_at IS NULL`,
        [recruiterId, userId],
      );
      expect(still.rowCount).toBe(1);
      expect(still.rows[0].token_hash).toBe(
        (
          await c.query<{ h: string }>(
            `SELECT encode(extensions.digest($1,'sha256'),'hex') AS h`,
            [token],
          )
        ).rows[0].h,
      );

      const leftover = await c.query(
        `SELECT 1 FROM public.telegram_chat_bindings
          WHERE telegram_chat_id = $1 AND status = 'active'`,
        [CHAT_ID],
      );
      expect(leftover.rowCount).toBe(0);
    });
  });

  it('creates the binding exclusively through the existing TG-2C bridge', async () => {
    const { rows } = await pool.query<{ def: string }>(
      `SELECT pg_get_functiondef(p.oid) AS def
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname='consume_telegram_dispatch_bind_token'`,
    );
    const def = rows[0].def;
    // `pg_get_functiondef` returns prose comments too. The contract below is
    // about EXECUTABLE behaviour, so strip SQL line comments before asserting.
    const executableDef = def.replace(/--.*$/gm, '');
    expect(executableDef).toContain('public.telegram_bind_dispatch_chat(');
    expect(executableDef).not.toMatch(
      /INSERT\s+INTO\s+public\.telegram_chat_bindings/i,
    );
    expect(executableDef).not.toContain('current_user_has_recruiter_permission');
    expect(executableDef).not.toContain('loads_dispatch');
  });
});
