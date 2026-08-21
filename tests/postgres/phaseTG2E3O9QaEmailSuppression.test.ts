/**
 * Phase TG-2E3-O9A — Real PostgreSQL gate for the QA synthetic-account
 * outbound email suppression candidate.
 *
 * Applies a production-faithful scaffold carrying the PRE-O9 (live) body of
 * public.enqueue_email(text, jsonb) plus an instrumented pgmq stub, then the
 * accepted O6 fixture-root registry. Snapshots the full object inventory, the
 * enqueue_email contract and the O6 helper ACL. Then applies the O9 candidate
 * and proves it replaces exactly one body, adds no object, broadens no
 * privilege, and suppresses external send ONLY for recipients that are
 * themselves active O6 `user` fixture roots.
 *
 * Lives OUTSIDE `src/` so the default `bunx vitest run` never picks it up.
 * Run with an ad-hoc config that includes only this file.
 *
 * NEVER SKIPS. Fails hard if TG2E3O9_DATABASE_URL is absent.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.TG2E3O9_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'TG2E3O9_DATABASE_URL is required for the Phase TG-2E3-O9 real-Postgres gate.',
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

const O6_SQL = candidate(
  '20260821050000_phase_tg2e3_o6_qa_fixture_root_registry.sql',
);
const O9_FILE = '20260821070000_phase_tg2e3_o9_qa_email_suppression.sql';
const O9_SQL = candidate(O9_FILE);

/** Executable SQL only: `--` line comments stripped. */
const O9_EXECUTABLE = O9_SQL.split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const O9_EXEC_LOWER = O9_EXECUTABLE.toLowerCase();

/**
 * Roles, auth shim, admin shim, email log, unrelated-state tables, and an
 * instrumented pgmq stub. Attempt counters are sequences so they survive the
 * subtransaction rollback caused by the undefined_table path.
 */
const SCAFFOLD = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;

DO $$ BEGIN CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;

CREATE TABLE IF NOT EXISTS public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL
);

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users a
    WHERE a.user_id = _user_id AND a.role = 'super_admin'
  )
$$;

-- Unrelated state that functional cases must never modify.
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL,
  plan_key text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.recruiter_billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_profile_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS public.agency_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active'
);

-- Production-faithful email_send_log (same columns + status check).
CREATE TABLE IF NOT EXISTS public.email_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id text,
  template_name text NOT NULL,
  recipient_email text NOT NULL,
  status text NOT NULL,
  error_message text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_send_log_status_check CHECK (status = ANY (ARRAY[
    'pending','sent','suppressed','failed','bounced','complained','dlq'
  ]))
);

-- ---------------------------------------------------------------------------
-- Instrumented pgmq stub
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS pgmq;
CREATE TABLE IF NOT EXISTS pgmq.queues (name text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS pgmq.delivered (
  msg_id bigint PRIMARY KEY,
  queue text NOT NULL,
  payload jsonb NOT NULL
);
CREATE SEQUENCE IF NOT EXISTS pgmq.send_attempts_seq;
CREATE SEQUENCE IF NOT EXISTS pgmq.create_calls_seq;
CREATE SEQUENCE IF NOT EXISTS pgmq.msg_id_seq;

CREATE OR REPLACE FUNCTION pgmq.send(queue_name text, msg jsonb)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE _id bigint;
BEGIN
  PERFORM nextval('pgmq.send_attempts_seq');
  IF NOT EXISTS (SELECT 1 FROM pgmq.queues q WHERE q.name = queue_name) THEN
    RAISE EXCEPTION 'relation "pgmq.q_%" does not exist', queue_name
      USING ERRCODE = 'undefined_table';
  END IF;
  _id := nextval('pgmq.msg_id_seq');
  INSERT INTO pgmq.delivered (msg_id, queue, payload) VALUES (_id, queue_name, msg);
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION pgmq.create(queue_name text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM nextval('pgmq.create_calls_seq');
  INSERT INTO pgmq.queues (name) VALUES (queue_name) ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION pgmq.counter(_seq text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE _lv bigint; _called boolean;
BEGIN
  EXECUTE format('SELECT last_value, is_called FROM %s', _seq) INTO _lv, _called;
  RETURN CASE WHEN _called THEN _lv ELSE 0 END;
END;
$$;
`;

/** Verbatim PRE-O9 live body of enqueue_email, with the live ACL shape. */
const PRE_O9_ENQUEUE = `
CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pgmq'
AS $function$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_email(text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_email(text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;
`;

const client = new pg.Client({ connectionString: URL_STR });

type FnContract = {
  identity: string;
  result: string;
  lang: string;
  volatility: string;
  secdef: boolean;
  config: string | null;
  owner: string;
  acl: string | null;
  def_md5: string;
};

async function fnContract(name: string, args: string): Promise<FnContract> {
  const { rows } = await client.query(
    `SELECT pg_get_function_identity_arguments(p.oid) AS identity,
            pg_get_function_result(p.oid) AS result,
            l.lanname AS lang,
            p.provolatile AS volatility,
            p.prosecdef AS secdef,
            array_to_string(p.proconfig, ',') AS config,
            pg_get_userbyid(p.proowner) AS owner,
            p.proacl::text AS acl,
            md5(pg_get_functiondef(p.oid)) AS def_md5
       FROM pg_proc p
       JOIN pg_language l ON l.oid = p.prolang
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = $1
        AND pg_get_function_identity_arguments(p.oid) = $2`,
    [name, args],
  );
  expect(rows).toHaveLength(1);
  return rows[0] as FnContract;
}

async function objectInventory(): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT 'proc:' || p.proname || '(' ||
              pg_get_function_identity_arguments(p.oid) || ')' AS obj
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      UNION ALL
     SELECT 'rel:' || c.relkind::text || ':' || c.relname
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      UNION ALL
     SELECT 'policy:' || pol.polname || ':' || pol.polrelid::regclass::text
       FROM pg_policy pol
      UNION ALL
     SELECT 'trigger:' || t.tgname
       FROM pg_trigger t WHERE NOT t.tgisinternal
      ORDER BY 1`,
  );
  return rows.map((r) => r.obj as string);
}

async function counters(): Promise<{ sends: number; creates: number }> {
  const { rows } = await client.query(
    `SELECT pgmq.counter('pgmq.send_attempts_seq') AS sends,
            pgmq.counter('pgmq.create_calls_seq') AS creates`,
  );
  return { sends: Number(rows[0].sends), creates: Number(rows[0].creates) };
}

async function unrelatedStateFingerprint(): Promise<string> {
  const { rows } = await client.query(
    `SELECT (SELECT count(*) FROM public.admin_users) AS a,
            (SELECT count(*) FROM public.subscriptions) AS s,
            (SELECT count(*) FROM public.recruiter_billing_profiles) AS r,
            (SELECT count(*) FROM public.agency_entitlements) AS e`,
  );
  return JSON.stringify(rows[0]);
}

async function enqueue(
  queue: string,
  payload: Record<string, unknown>,
): Promise<bigint | null> {
  const { rows } = await client.query(
    'SELECT public.enqueue_email($1, $2::jsonb) AS id',
    [queue, JSON.stringify(payload)],
  );
  return rows[0].id === null ? null : BigInt(rows[0].id);
}

async function logRow(messageId: string) {
  const { rows } = await client.query(
    `SELECT status, error_message, metadata FROM public.email_send_log
      WHERE message_id = $1`,
    [messageId],
  );
  return rows;
}

async function insertPendingLog(
  messageId: string,
  recipient: string,
  opts: { error?: string | null; metadata?: Record<string, unknown> | null } = {},
) {
  await client.query(
    `INSERT INTO public.email_send_log
       (message_id, template_name, recipient_email, status, error_message, metadata)
     VALUES ($1, 'signup', $2, 'pending', $3, $4::jsonb)`,
    [
      messageId,
      recipient,
      opts.error ?? null,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
    ],
  );
}

async function newUser(email: string): Promise<string> {
  const id = randomUUID();
  await client.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [
    id,
    email,
  ]);
  return id;
}

async function registerRoot(
  kind: string,
  rootId: string,
  ownerId: string,
  active = true,
) {
  await client.query(
    `INSERT INTO public.qa_fixture_roots
       (root_kind, root_id, qa_owner_user_id, active, registered_by_user_id, revoked_at)
     VALUES ($1, $2, $3, $4, $3, CASE WHEN $4 THEN NULL ELSE now() END)`,
    [kind, rootId, ownerId, active],
  );
}

// Snapshots captured pre-O9.
let inventoryBefore: string[] = [];
let enqueueBefore: FnContract;
let helperBefore: FnContract;
let registryAclBefore: string | null;

// Shared fixtures.
let qaOwner = '';
let syntheticDriver = '';
let syntheticDriverEmail = '';

beforeAll(async () => {
  await client.connect();
  await client.query(SCAFFOLD);
  await client.query(PRE_O9_ENQUEUE);
  await client.query(O6_SQL);

  // QA owner (real super_admin) and the synthetic driver fixture.
  qaOwner = await newUser('owner.real@fixture.invalid');
  await client.query(
    `INSERT INTO public.admin_users (user_id, role) VALUES ($1, 'super_admin')`,
    [qaOwner],
  );
  syntheticDriverEmail = 'Synthetic.Driver@fixture.invalid';
  syntheticDriver = await newUser(syntheticDriverEmail);

  inventoryBefore = await objectInventory();
  enqueueBefore = await fnContract('enqueue_email', 'queue_name text, payload jsonb');
  helperBefore = await fnContract(
    'is_qa_fixture_root',
    '_root_kind text, _root_id uuid, _qa_owner_user_id uuid',
  );
  const { rows } = await client.query(
    `SELECT relacl::text AS acl FROM pg_class
      WHERE oid = 'public.qa_fixture_roots'::regclass`,
  );
  registryAclBefore = rows[0].acl;

  // Apply the candidate under test.
  await client.query(O9_SQL);
}, 60_000);

afterAll(async () => {
  await client.end();
});

// ---------------------------------------------------------------------------
// A. Blast radius and contract preservation
// ---------------------------------------------------------------------------

describe('A. blast radius and contracts', () => {
  it('1. contains exactly one CREATE OR REPLACE FUNCTION and no other DDL or grants', () => {
    const creates = O9_EXEC_LOWER.match(/create\s+or\s+replace\s+function/g) ?? [];
    expect(creates).toHaveLength(1);
    expect(O9_EXEC_LOWER).not.toMatch(
      /create\s+(table|index|policy|trigger|type|schema|view|sequence|extension|materialized)/,
    );
    expect(O9_EXEC_LOWER).not.toMatch(/\bdrop\s+/);
    expect(O9_EXEC_LOWER).not.toMatch(/\balter\s+(table|function|policy|type|schema)\b/);
    expect(O9_EXEC_LOWER).not.toMatch(/\bgrant\b/);
    expect(O9_EXEC_LOWER).not.toMatch(/\brevoke\b/);
    expect(O9_EXEC_LOWER).toContain('public.enqueue_email(queue_name text, payload jsonb)');
  });

  it('2. enqueue_email contract identical except the definition', async () => {
    const after = await fnContract('enqueue_email', 'queue_name text, payload jsonb');
    expect(after.identity).toBe(enqueueBefore.identity);
    expect(after.result).toBe('bigint');
    expect(after.result).toBe(enqueueBefore.result);
    expect(after.lang).toBe('plpgsql');
    expect(after.lang).toBe(enqueueBefore.lang);
    expect(after.volatility).toBe('v');
    expect(after.volatility).toBe(enqueueBefore.volatility);
    expect(after.secdef).toBe(true);
    expect(after.secdef).toBe(enqueueBefore.secdef);
    expect(after.config).toBe('search_path=public, pgmq');
    expect(after.config).toBe(enqueueBefore.config);
    expect(after.owner).toBe(enqueueBefore.owner);
    expect(after.acl).toBe(enqueueBefore.acl);
    expect(after.def_md5).not.toBe(enqueueBefore.def_md5);
  });

  it('3. O6 registry + helper definition and ACL unchanged; authenticated execute still denied', async () => {
    const helperAfter = await fnContract(
      'is_qa_fixture_root',
      '_root_kind text, _root_id uuid, _qa_owner_user_id uuid',
    );
    expect(helperAfter).toEqual(helperBefore);

    const { rows } = await client.query(
      `SELECT relacl::text AS acl FROM pg_class
        WHERE oid = 'public.qa_fixture_roots'::regclass`,
    );
    expect(rows[0].acl).toBe(registryAclBefore);

    const { rows: acl } = await client.query(
      `SELECT has_function_privilege('authenticated',
                'public.is_qa_fixture_root(text,uuid,uuid)', 'EXECUTE') AS auth_exec,
              has_function_privilege('anon',
                'public.is_qa_fixture_root(text,uuid,uuid)', 'EXECUTE') AS anon_exec,
              has_function_privilege('service_role',
                'public.is_qa_fixture_root(text,uuid,uuid)', 'EXECUTE') AS svc_exec`,
    );
    expect(acl[0].auth_exec).toBe(false);
    expect(acl[0].anon_exec).toBe(false);
    expect(acl[0].svc_exec).toBe(true);
  });

  it('4. no object added, removed, or renamed by the candidate', async () => {
    const after = await objectInventory();
    expect(after).toEqual(inventoryBefore);
  });

  it('5. no hardcoded fixture UUID / email / name and no recruiter or agency ancestry query', () => {
    expect(O9_EXECUTABLE).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(O9_EXECUTABLE).not.toContain('@');
    for (const forbidden of [
      'recruiter',
      'agency',
      'stripe',
      'telegram',
      'subscription',
      'plan_key',
      'super_admin',
      'owner_qa_sessions',
      'auth_emails',
      'transactional_emails',
    ]) {
      expect(O9_EXEC_LOWER).not.toContain(forbidden);
    }
    // Only the `user` root kind is ever consulted.
    const kinds = O9_EXECUTABLE.match(/is_qa_fixture_root\(\s*'([a-z_]+)'/g) ?? [];
    expect(kinds).toEqual(["is_qa_fixture_root('user'"]);
  });
});

// ---------------------------------------------------------------------------
// B. Suppression
// ---------------------------------------------------------------------------

describe('B. suppression of registered synthetic user roots', () => {
  it('6. active registered user root recipient => NULL, no send, no queue create', async () => {
    await registerRoot('user', syntheticDriver, qaOwner);
    const before = await counters();
    const result = await enqueue('auth_emails', {
      to: syntheticDriverEmail,
      message_id: 'm-suppress-1',
    });
    const after = await counters();
    expect(result).toBeNull();
    expect(after.sends - before.sends).toBe(0);
    expect(after.creates - before.creates).toBe(0);
  });

  it('7. recipient match is case-insensitive', async () => {
    const before = await counters();
    const upper = await enqueue('auth_emails', {
      to: syntheticDriverEmail.toUpperCase(),
      message_id: 'm-suppress-upper',
    });
    const padded = await enqueue('auth_emails', {
      to: `   ${syntheticDriverEmail.toLowerCase()}   `,
      message_id: 'm-suppress-padded',
    });
    const after = await counters();
    expect(upper).toBeNull();
    expect(padded).toBeNull();
    expect(after.sends - before.sends).toBe(0);
  });

  it('8. pending email_send_log row for the message_id becomes suppressed', async () => {
    const mid = 'm-log-status';
    await insertPendingLog(mid, syntheticDriverEmail);
    expect(await enqueue('auth_emails', { to: syntheticDriverEmail, message_id: mid })).toBeNull();
    const rows = await logRow(mid);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('suppressed');
  });

  it('9. existing error_message is preserved verbatim', async () => {
    const mid = 'm-log-error';
    await insertPendingLog(mid, syntheticDriverEmail, { error: 'anonymous-ip: 203.0.113.7' });
    await enqueue('auth_emails', { to: syntheticDriverEmail, message_id: mid });
    const rows = await logRow(mid);
    expect(rows[0].status).toBe('suppressed');
    expect(rows[0].error_message).toBe('anonymous-ip: 203.0.113.7');
  });

  it('10. existing metadata is preserved and merged with suppression_reason only', async () => {
    const mid = 'm-log-metadata';
    await insertPendingLog(mid, syntheticDriverEmail, {
      metadata: { attempt: 1, source: 'auth-hook' },
    });
    await enqueue('auth_emails', { to: syntheticDriverEmail, message_id: mid });
    const rows = await logRow(mid);
    expect(rows[0].metadata).toEqual({
      attempt: 1,
      source: 'auth-hook',
      suppression_reason: 'qa_fixture_user_root',
    });
  });

  it('11. suppression metadata carries no recipient, root, owner, or payload data', async () => {
    const mid = 'm-log-nopii';
    await insertPendingLog(mid, syntheticDriverEmail);
    await enqueue('auth_emails', {
      to: syntheticDriverEmail,
      message_id: mid,
      subject: 'Confirm your email',
      html: '<p>secret</p>',
    });
    const rows = await logRow(mid);
    expect(Object.keys(rows[0].metadata)).toEqual(['suppression_reason']);
    const serialized = JSON.stringify(rows[0].metadata).toLowerCase();
    expect(serialized).not.toContain(syntheticDriverEmail.toLowerCase());
    expect(serialized).not.toContain(syntheticDriver);
    expect(serialized).not.toContain(qaOwner);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('confirm');
  });

  it('12. blank/missing message_id still suppresses but updates no log row', async () => {
    const otherMid = 'm-untouched';
    await insertPendingLog(otherMid, syntheticDriverEmail);
    const before = await counters();
    expect(await enqueue('auth_emails', { to: syntheticDriverEmail })).toBeNull();
    expect(
      await enqueue('auth_emails', { to: syntheticDriverEmail, message_id: '   ' }),
    ).toBeNull();
    const after = await counters();
    expect(after.sends - before.sends).toBe(0);
    const rows = await logRow(otherMid);
    expect(rows[0].status).toBe('pending');
  });

  it('13. inactive/revoked user root falls back to the original send path', async () => {
    const email = 'revoked.driver@fixture.invalid';
    const uid = await newUser(email);
    await registerRoot('user', uid, qaOwner, false);
    await client.query(`SELECT pgmq.create('auth_emails')`);
    const before = await counters();
    const result = await enqueue('auth_emails', { to: email, message_id: 'm-revoked' });
    const after = await counters();
    expect(result).not.toBeNull();
    expect(after.sends - before.sends).toBe(1);
  });

  it('14. user with no registered root => original send', async () => {
    const email = 'plain.user@fixture.invalid';
    await newUser(email);
    const before = await counters();
    expect(await enqueue('auth_emails', { to: email, message_id: 'm-plain' })).not.toBeNull();
    expect((await counters()).sends - before.sends).toBe(1);
  });

  it('15. unknown recipient email => original send', async () => {
    const before = await counters();
    expect(
      await enqueue('auth_emails', { to: 'nobody.here@fixture.invalid', message_id: 'm-unknown' }),
    ).not.toBeNull();
    expect((await counters()).sends - before.sends).toBe(1);
  });

  it('16. missing or blank `to` => original send', async () => {
    const before = await counters();
    expect(await enqueue('auth_emails', { message_id: 'm-no-to' })).not.toBeNull();
    expect(await enqueue('auth_emails', { to: '', message_id: 'm-empty-to' })).not.toBeNull();
    expect(await enqueue('auth_emails', { to: '   ', message_id: 'm-blank-to' })).not.toBeNull();
    expect((await counters()).sends - before.sends).toBe(3);
  });

  it('17. recruiter_profile root owned by the recipient but no user root => original send', async () => {
    const email = 'recruiter.owner@fixture.invalid';
    const uid = await newUser(email);
    await registerRoot('recruiter_profile', randomUUID(), uid);
    const before = await counters();
    expect(await enqueue('auth_emails', { to: email, message_id: 'm-recruiter' })).not.toBeNull();
    expect((await counters()).sends - before.sends).toBe(1);
  });

  it('18. agency_profile root owned by the recipient but no user root => original send', async () => {
    const email = 'agency.owner@fixture.invalid';
    const uid = await newUser(email);
    await registerRoot('agency_profile', randomUUID(), uid);
    const before = await counters();
    expect(await enqueue('auth_emails', { to: email, message_id: 'm-agency' })).not.toBeNull();
    expect((await counters()).sends - before.sends).toBe(1);
  });

  it('19. QA owner/super_admin holding recruiter + agency roots but no user root => original send', async () => {
    await registerRoot('recruiter_profile', randomUUID(), qaOwner);
    await registerRoot('agency_profile', randomUUID(), qaOwner);
    const before = await counters();
    const result = await enqueue('transactional_emails', {
      to: 'owner.real@fixture.invalid',
      message_id: 'm-owner',
    });
    expect(result).not.toBeNull();
    expect((await counters()).sends - before.sends).toBe(1);
  });

  it('20. another user\'s active user root suppresses only that user', async () => {
    const otherEmail = 'second.synthetic@fixture.invalid';
    const otherId = await newUser(otherEmail);
    await registerRoot('user', otherId, qaOwner);

    const before = await counters();
    expect(await enqueue('auth_emails', { to: otherEmail, message_id: 'm-other' })).toBeNull();
    expect((await counters()).sends - before.sends).toBe(0);

    const before2 = await counters();
    expect(
      await enqueue('auth_emails', { to: 'owner.real@fixture.invalid', message_id: 'm-owner-2' }),
    ).not.toBeNull();
    expect(
      await enqueue('auth_emails', { to: 'plain.user@fixture.invalid', message_id: 'm-plain-2' }),
    ).not.toBeNull();
    expect((await counters()).sends - before2.sends).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// C. Original queue semantics
// ---------------------------------------------------------------------------

describe('C. original queue semantics preserved', () => {
  it('21. normal recipient returns the pgmq message id', async () => {
    const id = await enqueue('auth_emails', {
      to: 'plain.user@fixture.invalid',
      message_id: 'm-normal',
    });
    expect(id).not.toBeNull();
    const { rows } = await client.query(
      `SELECT queue FROM pgmq.delivered WHERE msg_id = $1`,
      [String(id)],
    );
    expect(rows[0].queue).toBe('auth_emails');
  });

  it('22. undefined_table path creates the queue once then retries the send once', async () => {
    const before = await counters();
    const id = await enqueue('fresh_queue_alpha', {
      to: 'plain.user@fixture.invalid',
      message_id: 'm-bootstrap',
    });
    const after = await counters();
    expect(id).not.toBeNull();
    expect(after.creates - before.creates).toBe(1);
    expect(after.sends - before.sends).toBe(2); // failed attempt + retry
    const { rows } = await client.query(
      `SELECT count(*)::int AS c FROM pgmq.queues WHERE name = 'fresh_queue_alpha'`,
    );
    expect(rows[0].c).toBe(1);

    // Second call on the now-existing queue: single send, no create.
    const before2 = await counters();
    expect(
      await enqueue('fresh_queue_alpha', {
        to: 'plain.user@fixture.invalid',
        message_id: 'm-bootstrap-2',
      }),
    ).not.toBeNull();
    const after2 = await counters();
    expect(after2.creates - before2.creates).toBe(0);
    expect(after2.sends - before2.sends).toBe(1);
  });

  it('23. suppression never creates a missing queue', async () => {
    const before = await counters();
    expect(
      await enqueue('fresh_queue_beta', {
        to: syntheticDriverEmail,
        message_id: 'm-no-queue',
      }),
    ).toBeNull();
    const after = await counters();
    expect(after.creates - before.creates).toBe(0);
    expect(after.sends - before.sends).toBe(0);
    const { rows } = await client.query(
      `SELECT count(*)::int AS c FROM pgmq.queues WHERE name = 'fresh_queue_beta'`,
    );
    expect(rows[0].c).toBe(0);
  });

  it('24. no functional case mutates admin_users / subscriptions / billing / entitlements', async () => {
    const before = await unrelatedStateFingerprint();
    await enqueue('auth_emails', { to: syntheticDriverEmail, message_id: 'm-final-suppress' });
    await enqueue('auth_emails', { to: 'plain.user@fixture.invalid', message_id: 'm-final-send' });
    await enqueue('auth_emails', { to: 'owner.real@fixture.invalid', message_id: 'm-final-owner' });
    expect(await unrelatedStateFingerprint()).toBe(before);
  });
});
