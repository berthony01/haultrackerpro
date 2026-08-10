// @vitest-environment node
// =====================================================================
// Assistant settlement permission persistence — PGlite candidate proof.
//
// Proves that the REAL candidate migration
//   supabase/migration-candidates/20260810160000_assistant_settlement_permission_allowlist.sql
// additively extends the direct-assistant permission allowlist of
// clean_assistant_permissions / invite_assistant / update_assistant_permissions
// with settlements_view, settlements_manage and settlements_finalize, while
// preserving every other existing behavior and catalog shape.
//
// A baseline equivalent to the CURRENT live seven-key behavior is installed
// first, so the delta is proven, not assumed.
//
// No production database, no cloud application, no deploy, no publish.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const CANDIDATE_REL =
  '../../supabase/migration-candidates/20260810160000_assistant_settlement_permission_allowlist.sql';

const CANDIDATE_SQL = fs.readFileSync(
  fileURLToPath(new URL(CANDIDATE_REL, import.meta.url)),
  'utf8',
);

/** Executable SQL only: `--` documentation lines removed. */
const CODE = CANDIDATE_SQL.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

/** Top-level SQL only: dollar-quoted function bodies removed. */
const TOP_LEVEL = CODE.replace(/\$\$[\s\S]*?\$\$/g, ' <BODY> ');

const LEGACY_KEYS = [
  'manage_loads',
  'manage_expenses',
  'manage_fuel',
  'view_reports',
  'export_reports',
  'view_dashboard',
  'manage_settings_limited',
] as const;

const SETTLEMENT_KEYS = [
  'settlements_view',
  'settlements_manage',
  'settlements_finalize',
] as const;

const ALL_KEYS = [...LEGACY_KEYS, ...SETTLEMENT_KEYS];

const TARGET_FUNCTIONS = [
  'clean_assistant_permissions',
  'invite_assistant',
  'update_assistant_permissions',
] as const;

// ---------------------------------------------------------------------
// Bootstrap: minimal but faithful prerequisites for the three functions.
// ---------------------------------------------------------------------
const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $fn$
  SELECT nullif(current_setting('test.uid', true), '')::uuid;
$fn$;

-- Faithful stubs for the pgcrypto helpers used by invite_assistant.
CREATE FUNCTION public.gen_random_bytes(_n int) RETURNS bytea
LANGUAGE sql VOLATILE
AS $fn$
  SELECT decode(
    string_agg(lpad(to_hex((random() * 255)::int), 2, '0'), ''),
    'hex')
  FROM generate_series(1, _n);
$fn$;

CREATE FUNCTION public.digest(_t text, _alg text) RETURNS bytea
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT sha256(convert_to(_t, 'utf8'));
$fn$;

CREATE FUNCTION public.is_admin(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $fn$
  SELECT false;
$fn$;

CREATE TABLE public.subscriptions (
  user_id uuid PRIMARY KEY,
  plan_key text,
  status text
);

CREATE TABLE public.driver_assistants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL,
  assistant_user_id uuid,
  invite_email text NOT NULL,
  invite_token_hash text,
  status text NOT NULL DEFAULT 'pending',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  agency_delegation_id uuid,
  invited_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX driver_assistants_driver_email_active_uidx
  ON public.driver_assistants (driver_user_id, lower(invite_email))
  WHERE status IN ('pending','active');

CREATE TABLE public.assistant_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegate_id uuid,
  driver_user_id uuid,
  assistant_user_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

// ---------------------------------------------------------------------
// Baseline: the CURRENT (pre-candidate) seven-key definitions.
// ---------------------------------------------------------------------
const BASELINE = `
CREATE OR REPLACE FUNCTION public.clean_assistant_permissions(_p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  _allowed text[] := ARRAY['manage_loads','manage_expenses','manage_fuel',
    'view_reports','export_reports','view_dashboard','manage_settings_limited'];
  _out jsonb := '{}'::jsonb; _k text;
BEGIN
  IF _p IS NULL THEN RETURN _out; END IF;
  FOREACH _k IN ARRAY _allowed LOOP
    IF COALESCE((_p ->> _k)::boolean, false) THEN
      _out := _out || jsonb_build_object(_k, true);
    END IF;
  END LOOP;
  RETURN _out;
END $$;

CREATE OR REPLACE FUNCTION public.invite_assistant(_email text, _permissions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _email_norm text := lower(btrim(coalesce(_email,'')));
  _token text;
  _token_hash text;
  _row public.driver_assistants;
  _existing public.driver_assistants;
  _allowed_keys text[] := ARRAY[
    'manage_loads','manage_expenses','manage_fuel',
    'view_reports','export_reports','view_dashboard',
    'manage_settings_limited'
  ];
  _clean jsonb := '{}'::jsonb;
  _k text;
  _is_pro boolean;
  _direct_max int;
  _direct_count int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT
    public.is_admin(_uid)
    OR EXISTS (
      SELECT 1 FROM public.subscriptions s
       WHERE s.user_id = _uid AND s.status = 'active'
         AND s.plan_key IN ('pro_monthly','pro_yearly')
    )
  INTO _is_pro;

  IF NOT _is_pro THEN
    RAISE EXCEPTION 'Inviting assistants requires Pro. Upgrade to invite an assistant.'
      USING ERRCODE = '42501';
  END IF;

  IF _email_norm = '' OR length(_email_norm) > 255
     OR _email_norm !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = _uid AND lower(u.email) = _email_norm
  ) THEN
    RAISE EXCEPTION 'You cannot invite yourself' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _existing
    FROM public.driver_assistants
   WHERE driver_user_id = _uid
     AND lower(invite_email) = _email_norm
     AND status IN ('pending','active')
   LIMIT 1;

  _direct_max := 1;
  SELECT count(*) INTO _direct_count
    FROM public.driver_assistants
   WHERE driver_user_id = _uid
     AND status IN ('pending','active')
     AND agency_delegation_id IS NULL
     AND (_existing.id IS NULL OR id <> _existing.id);

  IF _direct_count >= _direct_max THEN
    RAISE EXCEPTION 'Your Pro plan includes 1 direct assistant. Revoke the current assistant before inviting another.'
      USING ERRCODE = '42501';
  END IF;

  FOREACH _k IN ARRAY _allowed_keys LOOP
    IF COALESCE((_permissions ->> _k)::boolean, false) THEN
      _clean := _clean || jsonb_build_object(_k, true);
    END IF;
  END LOOP;

  _token := encode(gen_random_bytes(24), 'hex');
  _token_hash := encode(digest(_token, 'sha256'), 'hex');

  INSERT INTO public.driver_assistants
    (driver_user_id, invite_email, invite_token_hash, status, permissions)
  VALUES (_uid, _email_norm, _token_hash, 'pending', _clean)
  ON CONFLICT (driver_user_id, lower(invite_email))
    WHERE status IN ('pending','active')
  DO UPDATE SET
    permissions       = EXCLUDED.permissions,
    invite_token_hash = EXCLUDED.invite_token_hash,
    invited_at        = now(),
    updated_at        = now()
  RETURNING * INTO _row;

  INSERT INTO public.assistant_audit_log
    (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
  VALUES
    (_row.id, _uid, _uid, 'invite_created', 'driver_assistants', _row.id,
     jsonb_build_object('invite_email', _row.invite_email, 'permissions', _clean));

  RETURN jsonb_build_object(
    'id', _row.id,
    'invite_token', _token,
    'invite_email', _row.invite_email,
    'status', _row.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_assistant_permissions(_id uuid, _permissions jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _allowed_keys text[] := ARRAY[
    'manage_loads','manage_expenses','manage_fuel',
    'view_reports','export_reports','view_dashboard',
    'manage_settings_limited'
  ];
  _clean jsonb := '{}'::jsonb;
  _k text;
  _row public.driver_assistants;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  FOREACH _k IN ARRAY _allowed_keys LOOP
    IF COALESCE((_permissions ->> _k)::boolean, false) THEN
      _clean := _clean || jsonb_build_object(_k, true);
    END IF;
  END LOOP;

  UPDATE public.driver_assistants
     SET permissions = _clean,
         updated_at  = now()
   WHERE id = _id AND driver_user_id = _uid
     AND status IN ('pending','active')
  RETURNING * INTO _row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assistant not found or not editable' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.assistant_audit_log
    (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
  VALUES
    (_row.id, _uid, COALESCE(_row.assistant_user_id, _uid),
     'permissions_updated', 'driver_assistants', _row.id,
     jsonb_build_object('permissions', _clean));
END;
$$;
`;

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; affectedRows?: number }>;
}

interface FnShape {
  proname: string;
  prosecdef: boolean;
  provolatile: string;
  proconfig: string[] | null;
}

const TABLES_SQL = `SELECT tablename AS n FROM pg_tables WHERE schemaname='public' ORDER BY 1`;
const IDX_SQL = `SELECT indexname AS n FROM pg_indexes WHERE schemaname='public' ORDER BY 1`;
const TRIGS_SQL = `SELECT t.tgname AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE NOT t.tgisinternal AND ns.nspname='public' ORDER BY 1`;
const POLICIES_SQL = `SELECT (tablename || '.' || policyname) AS n FROM pg_policies WHERE schemaname='public' ORDER BY 1`;
const SHAPE_SQL = `
  SELECT p.proname, p.prosecdef, p.provolatile::text AS provolatile, p.proconfig
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('clean_assistant_permissions','invite_assistant','update_assistant_permissions')
   ORDER BY 1`;

let db: AnyPGlite;

let beforeTables: string[] = [];
let beforeIndexes: string[] = [];
let beforeTriggers: string[] = [];
let beforePolicies: string[] = [];
let afterTables: string[] = [];
let afterIndexes: string[] = [];
let afterTriggers: string[] = [];
let afterPolicies: string[] = [];

let beforeShapes: FnShape[] = [];
let afterShapes: FnShape[] = [];

let baselineClean: Record<string, boolean> = {};

const U: Record<string, string> = {};

async function names(sql: string): Promise<string[]> {
  const r = await db.query<{ n: string }>(sql);
  return r.rows.map((x) => x.n);
}

async function setUid(uid: string | null): Promise<void> {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid ?? '']);
}

async function newUser(email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO auth.users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return r.rows[0].id;
}

const REQUESTED = {
  manage_loads: true,
  view_reports: false,
  settlements_view: true,
  settlements_manage: true,
  settlements_finalize: true,
  become_admin: true,
} as const;

let invitedPermissions: Record<string, boolean> = {};
let invitedRow: {
  id: string;
  status: string;
  invite_email: string;
  invite_token_hash: string;
} | null = null;
let inviteResult: Record<string, unknown> = {};
let updatedPermissions: Record<string, boolean> = {};
let nonOwnerError = '';
let auditActions: string[] = [];

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;
  await db.exec(BOOTSTRAP);
  await db.exec(BASELINE);

  beforeTables = await names(TABLES_SQL);
  beforeIndexes = await names(IDX_SQL);
  beforeTriggers = await names(TRIGS_SQL);
  beforePolicies = await names(POLICIES_SQL);
  beforeShapes = (await db.query<FnShape>(SHAPE_SQL)).rows;

  // Baseline runtime behavior of the cleaner (pre-candidate).
  const base = await db.query<{ out: Record<string, boolean> }>(
    `SELECT public.clean_assistant_permissions($1::jsonb) AS out`,
    [JSON.stringify(REQUESTED)],
  );
  baselineClean = base.rows[0].out;

  // --- apply the REAL candidate ---
  await db.exec(CANDIDATE_SQL);

  afterTables = await names(TABLES_SQL);
  afterIndexes = await names(IDX_SQL);
  afterTriggers = await names(TRIGS_SQL);
  afterPolicies = await names(POLICIES_SQL);
  afterShapes = (await db.query<FnShape>(SHAPE_SQL)).rows;

  // --- fixtures: Pro driver + a second (non-owner) driver ---
  U.driver = await newUser('driver@example.com');
  U.other = await newUser('other@example.com');
  await db.query(
    `INSERT INTO public.subscriptions (user_id, plan_key, status) VALUES ($1,'pro_monthly','active')`,
    [U.driver],
  );

  // --- C. real invite write path ---
  await setUid(U.driver);
  const inv = await db.query<{ out: Record<string, unknown> }>(
    `SELECT public.invite_assistant($1, $2::jsonb) AS out`,
    ['Assistant@Example.com', JSON.stringify(REQUESTED)],
  );
  inviteResult = inv.rows[0].out;

  const row = await db.query<{
    id: string;
    status: string;
    invite_email: string;
    invite_token_hash: string;
    permissions: Record<string, boolean>;
  }>(`SELECT id, status, invite_email, invite_token_hash, permissions
        FROM public.driver_assistants WHERE driver_user_id = $1`, [U.driver]);
  invitedRow = row.rows[0];
  invitedPermissions = row.rows[0].permissions;

  // --- D. real update write path ---
  await setUid(U.other);
  try {
    await db.query(`SELECT public.update_assistant_permissions($1::uuid, $2::jsonb)`, [
      invitedRow.id,
      JSON.stringify({ settlements_view: true }),
    ]);
    nonOwnerError = 'NO_ERROR';
  } catch (e) {
    nonOwnerError = (e as Error).message;
  }

  await setUid(U.driver);
  await db.query(`SELECT public.update_assistant_permissions($1::uuid, $2::jsonb)`, [
    invitedRow.id,
    JSON.stringify({
      manage_expenses: true,
      settlements_view: true,
      settlements_manage: true,
      settlements_finalize: true,
      export_reports: false,
      become_admin: true,
    }),
  ]);
  const updated = await db.query<{ permissions: Record<string, boolean> }>(
    `SELECT permissions FROM public.driver_assistants WHERE id = $1`,
    [invitedRow.id],
  );
  updatedPermissions = updated.rows[0].permissions;

  auditActions = (
    await db.query<{ action: string }>(
      `SELECT action FROM public.assistant_audit_log ORDER BY created_at, action`,
    )
  ).rows.map((r) => r.action);

  await setUid(null);
}, 120_000);

// =====================================================================
// A. Candidate source contract
// =====================================================================
describe('A. candidate source contract', () => {
  it('A1. is declared a candidate, not applied live', () => {
    expect(CANDIDATE_SQL).toMatch(/CANDIDATE MIGRATION\s+—\s+NOT APPLIED LIVE\./);
  });

  it('A2. uses exactly one BEGIN and one COMMIT', () => {
    expect(CODE.match(/^\s*BEGIN;\s*$/gm)?.length ?? 0).toBe(1);
    expect(CODE.match(/^\s*COMMIT;\s*$/gm)?.length ?? 0).toBe(1);
  });

  it('A3. contains exactly three CREATE OR REPLACE FUNCTION statements, for the locked functions only', () => {
    const matches = [
      ...CODE.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.([a-z_]+)\s*\(/g),
    ].map((m) => m[1]);
    expect(matches).toEqual([...TARGET_FUNCTIONS]);
    expect(CODE.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION/g)?.length ?? 0).toBe(3);
    expect(/CREATE\s+FUNCTION/i.test(TOP_LEVEL)).toBe(false);
    expect(/DROP\s+FUNCTION/i.test(TOP_LEVEL)).toBe(false);
  });

  it('A4. declares no table/index/policy/trigger/type/view DDL', () => {
    for (const kw of [
      'CREATE TABLE',
      'ALTER TABLE',
      'DROP TABLE',
      'CREATE INDEX',
      'CREATE UNIQUE INDEX',
      'DROP INDEX',
      'CREATE POLICY',
      'ALTER POLICY',
      'DROP POLICY',
      'CREATE TRIGGER',
      'DROP TRIGGER',
      'CREATE TYPE',
      'ALTER TYPE',
      'CREATE VIEW',
      'CREATE OR REPLACE VIEW',
      'ROW LEVEL SECURITY',
    ]) {
      expect(
        new RegExp(kw.replace(/ /g, '\\s+'), 'i').test(TOP_LEVEL),
        `candidate must not contain ${kw}`,
      ).toBe(false);
    }
  });

  it('A5. has no top-level data migration DML (function-body DML is expected)', () => {
    for (const kw of ['INSERT\\s+INTO', 'UPDATE\\s+public\\.', 'DELETE\\s+FROM']) {
      expect(new RegExp(kw, 'i').test(TOP_LEVEL), `top-level ${kw}`).toBe(false);
    }
    // Function bodies legitimately retain their existing DML.
    expect(/INSERT INTO public\.driver_assistants/.test(CODE)).toBe(true);
    expect(/UPDATE public\.driver_assistants/.test(CODE)).toBe(true);
  });

  it('A6. contains no GRANT or REVOKE', () => {
    expect(/\bGRANT\b/i.test(CODE)).toBe(false);
    expect(/\bREVOKE\b/i.test(CODE)).toBe(false);
  });

  it('A7. each function definition lists all ten allowed keys', () => {
    const bodies = CODE.split(/CREATE OR REPLACE FUNCTION/).slice(1);
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      for (const key of ALL_KEYS) {
        expect(body.includes(`'${key}'`), `${key} missing from a function body`).toBe(
          true,
        );
      }
    }
  });

  it('A8. introduces no unrelated permission key', () => {
    const quoted = new Set(
      [...CODE.matchAll(/'([a-z][a-z0-9_]{3,})'/g)].map((m) => m[1]),
    );
    const permissionish = [...quoted].filter(
      (k) =>
        /^(manage|view|export|settlements)_/.test(k) &&
        k !== 'view_dashboard_unused',
    );
    expect(permissionish.sort()).toEqual([...ALL_KEYS].sort());
  });

  it('A9. preserves declared language/volatility/security markers', () => {
    expect(CODE).toMatch(
      /clean_assistant_permissions\(_p jsonb\)[\s\S]*?LANGUAGE plpgsql IMMUTABLE SET search_path = public/,
    );
    expect(CODE).not.toMatch(
      /clean_assistant_permissions[\s\S]{0,400}SECURITY DEFINER/,
    );
    for (const fn of ['invite_assistant', 'update_assistant_permissions']) {
      const seg = CODE.split(`FUNCTION public.${fn}`)[1] ?? '';
      expect(seg.slice(0, 400)).toMatch(/LANGUAGE plpgsql/);
      expect(seg.slice(0, 400)).toMatch(/SECURITY DEFINER/);
      expect(seg.slice(0, 400)).toMatch(/SET search_path = public/);
    }
  });
});

// =====================================================================
// B. Sanitizer runtime
// =====================================================================
describe('B. sanitizer runtime', () => {
  it('B1. baseline (pre-candidate) cleaner strips all three settlement keys', () => {
    for (const key of SETTLEMENT_KEYS) {
      expect(baselineClean[key]).toBeUndefined();
    }
    expect(baselineClean).toEqual({ manage_loads: true });
  });

  it('B2. post-candidate cleaner preserves each settlement key when true', async () => {
    for (const key of SETTLEMENT_KEYS) {
      const r = await db.query<{ out: Record<string, boolean> }>(
        `SELECT public.clean_assistant_permissions($1::jsonb) AS out`,
        [JSON.stringify({ [key]: true })],
      );
      expect(r.rows[0].out).toEqual({ [key]: true });
    }
  });

  it('B3. all seven existing keys still preserve exactly as before', async () => {
    const all = Object.fromEntries(LEGACY_KEYS.map((k) => [k, true]));
    const r = await db.query<{ out: Record<string, boolean> }>(
      `SELECT public.clean_assistant_permissions($1::jsonb) AS out`,
      [JSON.stringify(all)],
    );
    expect(r.rows[0].out).toEqual(all);
  });

  it('B4. false/absent valid keys remain omitted; unknown keys remain stripped; null stays empty', async () => {
    const r = await db.query<{ out: Record<string, boolean> }>(
      `SELECT public.clean_assistant_permissions($1::jsonb) AS out`,
      [
        JSON.stringify({
          manage_loads: true,
          manage_fuel: false,
          settlements_view: true,
          settlements_manage: false,
          become_admin: true,
        }),
      ],
    );
    expect(r.rows[0].out).toEqual({ manage_loads: true, settlements_view: true });

    const nullRow = await db.query<{ out: Record<string, boolean> }>(
      `SELECT public.clean_assistant_permissions(NULL::jsonb) AS out`,
    );
    expect(nullRow.rows[0].out).toEqual({});
  });
});

// =====================================================================
// C. Real invite write path
// =====================================================================
describe('C. real invite_assistant write path', () => {
  it('C1. persists the existing valid key and all three settlement keys, strips unknown', () => {
    expect(invitedPermissions).toEqual({
      manage_loads: true,
      settlements_view: true,
      settlements_manage: true,
      settlements_finalize: true,
    });
    expect(invitedPermissions.become_admin).toBeUndefined();
    expect(invitedPermissions.view_reports).toBeUndefined();
  });

  it('C2. retains existing invite behavior (normalized email, pending, hashed token, audit)', () => {
    expect(invitedRow?.invite_email).toBe('assistant@example.com');
    expect(invitedRow?.status).toBe('pending');
    expect(invitedRow?.invite_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(String(inviteResult.invite_token)).toMatch(/^[0-9a-f]{48}$/);
    expect(inviteResult.invite_email).toBe('assistant@example.com');
    expect(auditActions).toContain('invite_created');
  });

  it('C3. still refuses a non-Pro caller and invalid email', async () => {
    const free = await newUser('free@example.com');
    await setUid(free);
    await expect(
      db.query(`SELECT public.invite_assistant($1, '{}'::jsonb)`, [
        'someone@example.com',
      ]),
    ).rejects.toThrow(/requires Pro/i);

    await setUid(U.driver);
    await expect(
      db.query(`SELECT public.invite_assistant($1, '{}'::jsonb)`, ['not-an-email']),
    ).rejects.toThrow(/Invalid email/i);
    await setUid(null);
  });
});

// =====================================================================
// D. Real update write path
// =====================================================================
describe('D. real update_assistant_permissions write path', () => {
  it('D1. owner update preserves all valid true keys and strips the unknown key', () => {
    expect(updatedPermissions).toEqual({
      manage_expenses: true,
      settlements_view: true,
      settlements_manage: true,
      settlements_finalize: true,
    });
    expect(updatedPermissions.become_admin).toBeUndefined();
    expect(updatedPermissions.export_reports).toBeUndefined();
  });

  it('D2. non-owner still cannot update the row', () => {
    expect(nonOwnerError).not.toBe('NO_ERROR');
    expect(nonOwnerError).toMatch(/Assistant not found or not editable/i);
  });

  it('D3. unauthenticated callers are still rejected', async () => {
    await setUid(null);
    await expect(
      db.query(`SELECT public.update_assistant_permissions($1::uuid, '{}'::jsonb)`, [
        invitedRow!.id,
      ]),
    ).rejects.toThrow(/Not authenticated/i);
  });

  it('D4. permissions_updated audit row is still written', () => {
    expect(auditActions).toContain('permissions_updated');
  });
});

// =====================================================================
// E. Security / shape preservation
// =====================================================================
describe('E. security and shape preservation', () => {
  it('E1. catalog shapes are unchanged before vs after the candidate', () => {
    expect(afterShapes).toEqual(beforeShapes);
  });

  it('E2. security-definer flags and volatility match the locked contract', () => {
    const byName = Object.fromEntries(afterShapes.map((s) => [s.proname, s]));
    expect(byName.clean_assistant_permissions.prosecdef).toBe(false);
    expect(byName.clean_assistant_permissions.provolatile).toBe('i');
    expect(byName.invite_assistant.prosecdef).toBe(true);
    expect(byName.invite_assistant.provolatile).toBe('v');
    expect(byName.update_assistant_permissions.prosecdef).toBe(true);
    expect(byName.update_assistant_permissions.provolatile).toBe('v');
  });

  it('E3. search_path=public remains set on all three functions', () => {
    for (const shape of afterShapes) {
      expect(shape.proconfig ?? []).toContain('search_path=public');
    }
  });

  it('E4. candidate adds no tables, indexes, policies, or user triggers', () => {
    expect(afterTables).toEqual(beforeTables);
    expect(afterIndexes).toEqual(beforeIndexes);
    expect(afterPolicies).toEqual(beforePolicies);
    expect(afterTriggers).toEqual(beforeTriggers);
  });
});
