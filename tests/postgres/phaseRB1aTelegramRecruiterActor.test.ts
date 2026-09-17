/**
 * Phase RB-1A — Real PostgreSQL gate for the recruiter actor resolver and the
 * private menu processor, applied on top of the TG-2F-C bind drift repair.
 *
 * Assumes a restored HaulTracker Pro schema (recruiter_profiles,
 * recruiter_members, opportunities, the live recruiter permission helpers and
 * the applied TG-2B/TG-2C/TG-2D/TG-2F-A Telegram surface), exactly like the
 * existing TG-2F-A gate. It then applies the two candidates and proves the
 * additive surface, the ACLs and the fail-closed authorization contract.
 *
 * Lives OUTSIDE `src/` so the default `bunx vitest run` never picks it up.
 * Run with an ad-hoc config that includes only this file.
 *
 * NEVER SKIPS. Fails hard if RB1A_DATABASE_URL is absent.
 * NEVER point this at the production database.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.RB1A_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'RB1A_DATABASE_URL is required for the Phase RB-1A real-Postgres gate.',
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

const TG2FC_SQL = candidate(
  '20260824114000_phase_tg2fc_dispatch_group_bind_routing.sql',
);
const RB1A_SQL = candidate(
  '20260917050000_phase_rb1a_telegram_recruiter_actor_menu.sql',
);

const pool = new pg.Pool({ connectionString: URL_STR, max: 4 });

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
  const policies = await client.query<{ k: string }>(
    `SELECT schemaname || '.' || tablename || '.' || policyname AS k
       FROM pg_policies WHERE schemaname = 'public' ORDER BY 1`,
  );
  const grants = await client.query<{ k: string }>(
    `SELECT table_name || ':' || grantee || ':' || privilege_type AS k
       FROM information_schema.role_table_grants
      WHERE table_schema = 'public' ORDER BY 1`,
  );
  return {
    tables: tables.rows.map((r) => r.table_name),
    functions: functions.rows.map((r) => `${r.proname}(${r.args})`),
    policies: policies.rows.map((r) => r.k),
    grants: grants.rows.map((r) => r.k),
  };
}

let before: Awaited<ReturnType<typeof inventory>>;
let afterBind: Awaited<ReturnType<typeof inventory>>;
let after: Awaited<ReturnType<typeof inventory>>;

beforeAll(async () => {
  const client = await pool.connect();
  try {
    before = await inventory(client);
    await client.query(TG2FC_SQL);
    afterBind = await inventory(client);
    await client.query(RB1A_SQL);
    after = await inventory(client);
  } finally {
    client.release();
  }
}, 180_000);

afterAll(async () => {
  await pool.end();
});

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

// ---------------------------------------------------------------------------
// A. TG-2F-C drift repair
// ---------------------------------------------------------------------------
describe('TG-2F-C live — drift repair is additive', () => {
  it('adds exactly the one missing bind processor and no table', () => {
    const addedFns = afterBind.functions.filter((f) => !before.functions.includes(f));
    expect(addedFns).toEqual([
      'telegram_process_bind_update(_lease_token uuid, _update_id bigint, _payload_hash text, _telegram_user_id bigint, _telegram_chat_id bigint, _chat_type text, _raw_token text)',
    ]);
    expect(afterBind.tables).toEqual(before.tables);
    expect(afterBind.policies).toEqual(before.policies);
    expect(afterBind.grants).toEqual(before.grants);
  });

  it('preserves every pre-existing receipt result code', async () => {
    const { rows } = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'telegram_update_receipts_result_code_check'`,
    );
    for (const code of [
      'link_success',
      'link_rejected',
      'non_private_message',
      'non_start_message',
      'invalid_start_command',
      'invalid_update_shape',
      'bind_success',
      'bind_rejected',
    ]) {
      expect(rows[0].def).toContain(code);
    }
  });
});

// ---------------------------------------------------------------------------
// B. RB-1A additive surface + ACLs
// ---------------------------------------------------------------------------
describe('RB-1A live — additive surface', () => {
  it('adds exactly the two authorised functions and nothing else', () => {
    const added = after.functions.filter((f) => !afterBind.functions.includes(f));
    expect(added.sort()).toEqual(
      [
        'telegram_process_menu_update(_lease_token uuid, _update_id bigint, _payload_hash text, _telegram_user_id bigint, _telegram_chat_id bigint, _chat_type text)',
        'telegram_resolve_recruiter_actor(_telegram_user_id bigint)',
      ].sort(),
    );
    expect(after.tables).toEqual(afterBind.tables);
    expect(after.policies).toEqual(afterBind.policies);
    expect(after.grants).toEqual(afterBind.grants);
  });

  it('removes nothing', () => {
    for (const f of afterBind.functions) expect(after.functions).toContain(f);
  });

  it('keeps the resolver SECURITY DEFINER, STABLE and search_path pinned', async () => {
    const { rows } = await pool.query<{
      prosecdef: boolean;
      provolatile: string;
      proconfig: string[] | null;
    }>(
      `SELECT prosecdef, provolatile, proconfig FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname='telegram_resolve_recruiter_actor'`,
    );
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].provolatile).toBe('s');
    expect(rows[0].proconfig?.join(',')).toContain('search_path=');
  });

  it('grants EXECUTE to service_role only on both new functions', async () => {
    for (const name of [
      'telegram_resolve_recruiter_actor',
      'telegram_process_menu_update',
    ]) {
      const { rows } = await pool.query<{ acl: string | null }>(
        `SELECT array_to_string(p.proacl, ',') AS acl FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname='public' AND p.proname=$1`,
        [name],
      );
      const acl = rows[0]?.acl ?? '';
      expect(acl).toContain('service_role=X');
      expect(acl).not.toContain('anon=X');
      expect(acl).not.toContain('authenticated=X');
      expect(acl).not.toMatch(/(^|,)=X/);
    }
  });
});

// ---------------------------------------------------------------------------
// C. Fixtures
// ---------------------------------------------------------------------------
interface Fixture {
  ownerId: string;
  staffId: string;
  outsiderId: string;
  recruiterA: string;
  recruiterB: string;
}

async function seedUser(c: pg.PoolClient, email: string): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO auth.users (id, email, instance_id, aud, role)
     VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
    [id, email],
  );
  return id;
}

async function seedRecruiter(
  c: pg.PoolClient,
  userId: string,
  companyName: string,
  status = 'active',
): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO public.recruiter_profiles
       (id, user_id, recruiter_name, recruiter_email, company_name, company_type,
        dot_number, verification_status, status, posting_terms_accepted_at)
     VALUES ($1, $2, 'Rex Recruiter', 'rex@example.com', $3, 'carrier',
             '1234567', 'verified', $4, now())`,
    [id, userId, companyName, status],
  );
  return id;
}

async function seedFixture(c: pg.PoolClient): Promise<Fixture> {
  const ownerId = await seedUser(c, `owner-${randomUUID()}@example.com`);
  const staffId = await seedUser(c, `staff-${randomUUID()}@example.com`);
  const outsiderId = await seedUser(c, `driver-${randomUUID()}@example.com`);
  const recruiterA = await seedRecruiter(c, ownerId, 'Alpha Freight');
  const otherOwner = await seedUser(c, `owner2-${randomUUID()}@example.com`);
  const recruiterB = await seedRecruiter(c, otherOwner, 'Beta Logistics');
  return { ownerId, staffId, outsiderId, recruiterA, recruiterB };
}

async function linkTelegram(
  c: pg.PoolClient,
  telegramUserId: number,
  userId: string,
  status = 'active',
) {
  await c.query(
    `INSERT INTO public.telegram_user_links (telegram_user_id, user_id, status)
     VALUES ($1, $2, $3)`,
    [telegramUserId, userId, status],
  );
}

async function resolve(c: pg.PoolClient, telegramUserId: number) {
  const { rows } = await c.query(
    `SELECT * FROM public.telegram_resolve_recruiter_actor($1)`,
    [telegramUserId],
  );
  return rows as Array<{
    recruiter_id: string;
    workspace_name: string;
    role: string;
    can_manage_opportunities: boolean;
    active_opportunity_count: number;
  }>;
}

// ---------------------------------------------------------------------------
// D. Resolver authorization contract
// ---------------------------------------------------------------------------
describe('RB-1A live — resolver fails closed', () => {
  it('returns zero rows for an unlinked Telegram user', async () => {
    await inRollback(async (c) => {
      expect(await resolve(c, 999000001)).toHaveLength(0);
    });
  });

  it('returns zero rows for a revoked link', async () => {
    await inRollback(async (c) => {
      const f = await seedFixture(c);
      await linkTelegram(c, 999000002, f.ownerId, 'revoked');
      expect(await resolve(c, 999000002)).toHaveLength(0);
    });
  });

  it('returns zero rows for a linked non-recruiter account', async () => {
    await inRollback(async (c) => {
      const f = await seedFixture(c);
      await linkTelegram(c, 999000003, f.outsiderId);
      expect(await resolve(c, 999000003)).toHaveLength(0);
    });
  });

  it('returns zero rows for a suspended workspace', async () => {
    await inRollback(async (c) => {
      const f = await seedFixture(c);
      await c.query(`UPDATE public.recruiter_profiles SET status='suspended' WHERE id=$1`, [
        f.recruiterA,
      ]);
      await linkTelegram(c, 999000004, f.ownerId);
      expect(await resolve(c, 999000004)).toHaveLength(0);
    });
  });

  it('gives an owner only their own workspace, never another owner\'s', async () => {
    await inRollback(async (c) => {
      const f = await seedFixture(c);
      await linkTelegram(c, 999000005, f.ownerId);
      const rows = await resolve(c, 999000005);
      expect(rows.map((r) => r.recruiter_id)).toEqual([f.recruiterA]);
      expect(rows[0].role).toBe('owner');
      expect(rows[0].workspace_name).toBe('Alpha Freight');
    });
  });

  it('gives active staff only the authorized workspace', async () => {
    await inRollback(async (c) => {
      const f = await seedFixture(c);
      await c.query(
        `INSERT INTO public.recruiter_members
           (recruiter_id, member_user_id, invite_email, role, status, permissions)
         VALUES ($1,$2,$3,'recruiter_staff','active',
                 jsonb_build_object('opportunities_view', true))`,
        [f.recruiterA, f.staffId, `staff-${randomUUID()}@example.com`],
      );
      await linkTelegram(c, 999000006, f.staffId);
      const rows = await resolve(c, 999000006);
      expect(rows.map((r) => r.recruiter_id)).toEqual([f.recruiterA]);
      expect(rows[0].role).toBe('recruiter_staff');
      expect(rows[0].recruiter_id).not.toBe(f.recruiterB);
      // opportunities_create was never granted.
      expect(rows[0].can_manage_opportunities).toBe(false);
    });
  });

  it('gives a revoked staff member nothing', async () => {
    await inRollback(async (c) => {
      const f = await seedFixture(c);
      await c.query(
        `INSERT INTO public.recruiter_members
           (recruiter_id, member_user_id, invite_email, role, status, permissions)
         VALUES ($1,$2,$3,'recruiter_staff','revoked',
                 jsonb_build_object('opportunities_view', true))`,
        [f.recruiterA, f.staffId, `staff-${randomUUID()}@example.com`],
      );
      await linkTelegram(c, 999000007, f.staffId);
      expect(await resolve(c, 999000007)).toHaveLength(0);
    });
  });

  it('gives staff without the view permission nothing', async () => {
    await inRollback(async (c) => {
      const f = await seedFixture(c);
      await c.query(
        `INSERT INTO public.recruiter_members
           (recruiter_id, member_user_id, invite_email, role, status, permissions)
         VALUES ($1,$2,$3,'recruiter_staff','active', '{}'::jsonb)`,
        [f.recruiterA, f.staffId, `staff-${randomUUID()}@example.com`],
      );
      await linkTelegram(c, 999000008, f.staffId);
      expect(await resolve(c, 999000008)).toHaveLength(0);
    });
  });

  it('counts only the authorized workspace\'s active opportunities', async () => {
    await inRollback(async (c) => {
      const f = await seedFixture(c);
      await linkTelegram(c, 999000009, f.ownerId);
      const insertOpportunity = async (recruiterId: string, status: string) => {
        await c.query(
          `INSERT INTO public.opportunities (recruiter_id, title, status)
           VALUES ($1, 'Test role', $2)`,
          [recruiterId, status],
        );
      };
      await insertOpportunity(f.recruiterA, 'active');
      await insertOpportunity(f.recruiterA, 'draft');
      await insertOpportunity(f.recruiterB, 'active');
      const rows = await resolve(c, 999000009);
      expect(rows).toHaveLength(1);
      expect(rows[0].active_opportunity_count).toBe(1);
    });
  });

  it('exposes no contact, billing, driver or candidate column', async () => {
    await inRollback(async (c) => {
      const { fields } = await c.query(
        `SELECT * FROM public.telegram_resolve_recruiter_actor(1) LIMIT 0`,
      );
      expect(fields.map((f) => f.name).sort()).toEqual(
        [
          'active_opportunity_count',
          'can_manage_opportunities',
          'recruiter_id',
          'role',
          'workspace_name',
        ].sort(),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// E. Menu processor contract
// ---------------------------------------------------------------------------
async function claimLease(c: pg.PoolClient): Promise<string> {
  const { rows } = await c.query<{ lease_token: string }>(
    `SELECT lease_token FROM public.telegram_claim_poll_lease()`,
  );
  return rows[0].lease_token;
}

async function processMenu(
  c: pg.PoolClient,
  args: {
    lease: string | null;
    updateId: number;
    hash?: string;
    telegramUserId: number;
    chatId?: number;
    chatType?: string;
  },
) {
  const { rows } = await c.query(
    `SELECT * FROM public.telegram_process_menu_update($1,$2,$3,$4,$5,$6)`,
    [
      args.lease,
      args.updateId,
      args.hash ?? 'b'.repeat(64),
      args.telegramUserId,
      args.chatId ?? 4242,
      args.chatType ?? 'private',
    ],
  );
  return rows[0] as { is_new: boolean; result_code: string; workspaces: unknown[] };
}

describe('RB-1A live — menu processor', () => {
  it('rejects a non-private chat', async () => {
    await inRollback(async (c) => {
      const lease = await claimLease(c);
      await expect(
        processMenu(c, { lease, updateId: 5001, telegramUserId: 900001, chatType: 'group' }),
      ).rejects.toThrow(/telegram_update_invalid/);
    });
  });

  it('rejects a bad update id or payload hash', async () => {
    await inRollback(async (c) => {
      const lease = await claimLease(c);
      await expect(
        processMenu(c, { lease, updateId: 0, telegramUserId: 900001 }),
      ).rejects.toThrow(/telegram_update_invalid/);
      await expect(
        processMenu(c, { lease, updateId: 5002, hash: 'nope', telegramUserId: 900001 }),
      ).rejects.toThrow(/telegram_update_invalid/);
    });
  });

  it('rejects a missing or stale lease and writes no receipt', async () => {
    await inRollback(async (c) => {
      await expect(
        processMenu(c, { lease: null, updateId: 5003, telegramUserId: 900001 }),
      ).rejects.toThrow(/telegram_poll_lease_invalid/);
      await expect(
        processMenu(c, { lease: randomUUID(), updateId: 5003, telegramUserId: 900001 }),
      ).rejects.toThrow(/telegram_poll_lease_invalid/);
    });
    const { rowCount } = await pool.query(
      `SELECT 1 FROM public.telegram_update_receipts WHERE update_id = 5003`,
    );
    expect(rowCount).toBe(0);
  });

  it('records menu_unlinked for an unlinked user without disclosing a reason', async () => {
    await inRollback(async (c) => {
      const lease = await claimLease(c);
      const out = await processMenu(c, { lease, updateId: 5004, telegramUserId: 900444 });
      expect(out.result_code).toBe('menu_unlinked');
      expect(out.is_new).toBe(true);
      expect(out.workspaces).toEqual([]);
      const { rows } = await c.query(
        `SELECT status, result_code FROM public.telegram_update_receipts WHERE update_id=5004`,
      );
      expect(rows[0]).toEqual({ status: 'processed', result_code: 'menu_unlinked' });
    });
  });

  it('records menu_linked_no_workspace for a linked non-recruiter', async () => {
    await inRollback(async (c) => {
      const f = await seedFixture(c);
      await linkTelegram(c, 900555, f.outsiderId);
      const lease = await claimLease(c);
      const out = await processMenu(c, { lease, updateId: 5005, telegramUserId: 900555 });
      expect(out.result_code).toBe('menu_linked_no_workspace');
      expect(out.workspaces).toEqual([]);
    });
  });

  it('records menu_recruiter with the bounded descriptor for an owner', async () => {
    await inRollback(async (c) => {
      const f = await seedFixture(c);
      await linkTelegram(c, 900666, f.ownerId);
      const lease = await claimLease(c);
      const out = await processMenu(c, { lease, updateId: 5006, telegramUserId: 900666 });
      expect(out.result_code).toBe('menu_recruiter');
      expect(out.workspaces).toHaveLength(1);
      expect(Object.keys(out.workspaces[0] as object).sort()).toEqual(
        [
          'active_opportunity_count',
          'can_manage_opportunities',
          'recruiter_id',
          'role',
          'workspace_name',
        ].sort(),
      );
    });
  });

  it('is idempotent for an exact replay and conflicts on divergence', async () => {
    await inRollback(async (c) => {
      const lease = await claimLease(c);
      await processMenu(c, { lease, updateId: 5007, telegramUserId: 900777 });
      const replay = await processMenu(c, { lease, updateId: 5007, telegramUserId: 900777 });
      expect(replay.is_new).toBe(false);
      expect(replay.result_code).toBe('menu_unlinked');
      await expect(
        processMenu(c, {
          lease,
          updateId: 5007,
          hash: 'c'.repeat(64),
          telegramUserId: 900777,
        }),
      ).rejects.toThrow(/telegram_update_conflict/);
    });
  });

  it('writes no receipt when the transaction fails', async () => {
    await inRollback(async (c) => {
      const lease = await claimLease(c);
      await expect(
        processMenu(c, { lease, updateId: 5008, telegramUserId: -1 }),
      ).rejects.toThrow(/telegram_update_invalid/);
      const { rowCount } = await c.query(
        `SELECT 1 FROM public.telegram_update_receipts WHERE update_id=5008`,
      );
      expect(rowCount).toBe(0);
    });
  });
});
