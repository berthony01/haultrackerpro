// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type AnyPGlite = {
  exec: (sql: string) => Promise<unknown>;
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  close: () => Promise<void>;
};

// Exact defective body currently live in production (verified via
// pg_get_functiondef on 2026-07-19). References p.full_name which does
// not exist on public.profiles.
const DEFECTIVE_BODY = `
CREATE OR REPLACE FUNCTION public.get_my_managed_drivers()
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'delegate_id', da.id,
    'driver_user_id', da.driver_user_id,
    'driver_email', lower(u.email),
    'driver_name', COALESCE(p.display_name, p.full_name, lower(u.email)),
    'permissions', da.permissions,
    'accepted_at', da.accepted_at,
    'last_active_at', da.last_active_at
  )
  FROM public.driver_assistants da
  JOIN auth.users u ON u.id = da.driver_user_id
  LEFT JOIN public.profiles p ON p.user_id = da.driver_user_id
  WHERE da.assistant_user_id = _uid
    AND da.status = 'active'
  ORDER BY da.accepted_at DESC NULLS LAST;
END;
$function$;
`;

// Canonical applied migration (live history version 20260719151733).
// The parallel candidate file `20260719160500_fix_get_my_managed_drivers_full_name.sql`
// was removed in Pass B1 as an unrecorded duplicate — its executable SQL was
// identical to this migration, and live `supabase_migrations.schema_migrations`
// only records the `20260719151730_...` version.
const CANDIDATE = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260719151730_239618e5-edae-47bd-a44e-04c903761bc5.sql',
  ),
  'utf8',
);

const DRIVER = '11111111-1111-1111-1111-111111111111';
const ASSISTANT = '22222222-2222-2222-2222-222222222222';

async function primeSchema(db: AnyPGlite) {
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    -- profiles matches live production shape: no full_name column.
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL UNIQUE,
      display_name text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.driver_assistants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_user_id uuid NOT NULL,
      assistant_user_id uuid,
      status text NOT NULL,
      permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
      accepted_at timestamptz,
      last_active_at timestamptz
    );

    INSERT INTO auth.users(id, email) VALUES
      ('${DRIVER}',    'driver@example.com'),
      ('${ASSISTANT}', 'assistant@example.com');
    INSERT INTO public.profiles(user_id, display_name) VALUES
      ('${DRIVER}', 'Driver Dan');
    INSERT INTO public.driver_assistants
      (driver_user_id, assistant_user_id, status, permissions, accepted_at)
    VALUES
      ('${DRIVER}', '${ASSISTANT}', 'active',
       '{"manage_loads":true}'::jsonb, now());
  `);
  await db.exec(
    `SELECT set_config('request.jwt.claim.sub','${ASSISTANT}', false);`,
  );
}

describe('get_my_managed_drivers — p.full_name defect + candidate fix', () => {
  let db: AnyPGlite;

  beforeAll(async () => {
    db = new PGlite() as unknown as AnyPGlite;
    await primeSchema(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('reproduces the live production defect: defective body raises "column p.full_name does not exist"', async () => {
    await db.exec(DEFECTIVE_BODY);
    let caught: unknown = null;
    try {
      await db.query(`SELECT * FROM public.get_my_managed_drivers()`);
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    const msg = String((caught as { message?: string })?.message ?? caught).toLowerCase();
    expect(msg).toContain('column p.full_name does not exist');
  });

  it('candidate migration removes the bad reference and returns the assistant\'s managed driver', async () => {
    await db.exec(CANDIDATE);
    const res = await db.query<{ get_my_managed_drivers: Record<string, unknown> }>(
      `SELECT * FROM public.get_my_managed_drivers()`,
    );
    expect(res.rows.length).toBe(1);
    const row = res.rows[0].get_my_managed_drivers;
    expect(row.driver_user_id).toBe(DRIVER);
    expect(row.driver_email).toBe('driver@example.com');
    expect(row.driver_name).toBe('Driver Dan');
    expect(row.permissions).toEqual({ manage_loads: true });
  });

  it('candidate falls back to email when display_name is null (no full_name in schema)', async () => {
    await db.exec(
      `UPDATE public.profiles SET display_name = NULL WHERE user_id = '${DRIVER}'`,
    );
    const res = await db.query<{ get_my_managed_drivers: Record<string, unknown> }>(
      `SELECT * FROM public.get_my_managed_drivers()`,
    );
    expect(res.rows[0].get_my_managed_drivers.driver_name).toBe('driver@example.com');
  });

  it('returns no rows when the caller is not authenticated', async () => {
    await db.exec(`SELECT set_config('request.jwt.claim.sub','', false);`);
    const res = await db.query(`SELECT * FROM public.get_my_managed_drivers()`);
    expect(res.rows.length).toBe(0);
  });
});

// ============================================================================
// Pass B1a — authenticated-role isolation matrix.
//
// These tests exercise the CANONICAL migration exactly as applied to the live
// database. Identity is switched via `request.jwt.claim.sub` (the same JWT
// claim Supabase's auth.uid() reads) — no fixture rewrite, no privileged
// bypass, no source-string assertions substituted for behavior.
// ============================================================================

// Distinct identity fixtures for the authorization matrix.
const AA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // Assistant A
const AB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // Assistant B
const AU = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; // Unauthorized authenticated user
const DA = 'd1111111-1111-1111-1111-111111111111'; // Driver A
const DB_ = 'd2222222-2222-2222-2222-222222222222'; // Driver B
const DC = 'd3333333-3333-3333-3333-333333333333'; // Driver C
const DD = 'd4444444-4444-4444-4444-444444444444'; // Driver D

// Real production enum vocabulary (verified 2026-07-19 via
// `SELECT unnest(enum_range(NULL::assistant_status))`): pending, active,
// revoked, expired. `driver_assistants.status` is typed as this enum in
// production and defaults to 'pending'. The isolation tests reproduce that
// enum in PGlite so an invalid status string is rejected at insert time —
// the same way the live schema rejects it.
const REAL_STATUSES = ['pending', 'active', 'revoked', 'expired'] as const;
type RealStatus = (typeof REAL_STATUSES)[number];
const NON_ACTIVE_STATUSES: RealStatus[] = ['pending', 'revoked', 'expired'];

async function primeMatrix(db: AnyPGlite) {
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL UNIQUE,
      display_name text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    -- Mirror the live enum type so invalid statuses fail at insert.
    CREATE TYPE public.assistant_status AS ENUM ('pending','active','revoked','expired');

    CREATE TABLE public.driver_assistants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_user_id uuid NOT NULL,
      assistant_user_id uuid,
      status public.assistant_status NOT NULL DEFAULT 'pending',
      permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
      accepted_at timestamptz,
      last_active_at timestamptz
    );

    INSERT INTO auth.users(id, email) VALUES
      ('${AA}', 'assistant-a@example.com'),
      ('${AB}', 'assistant-b@example.com'),
      ('${AU}', 'unauth@example.com'),
      ('${DA}', 'driver-a@example.com'),
      ('${DB_}','driver-b@example.com'),
      ('${DC}', 'driver-c@example.com'),
      ('${DD}', 'driver-d@example.com');

    INSERT INTO public.profiles(user_id, display_name) VALUES
      ('${DA}', 'Driver A Name'),
      ('${DB_}', NULL),
      ('${DC}', 'Driver C Name'),
      ('${DD}', 'Driver D Name');
  `);
  // Apply the exact canonical migration file — no simplified copy.
  await db.exec(CANDIDATE);
}

async function auth(db: AnyPGlite, uid: string | null) {
  await db.exec(
    `SELECT set_config('request.jwt.claim.sub','${uid ?? ''}', false);`,
  );
}

async function insertRel(
  db: AnyPGlite,
  driver: string,
  assistant: string,
  status: RealStatus,
  acceptedAt: string | null = 'now()',
) {
  await db.exec(
    `INSERT INTO public.driver_assistants
       (driver_user_id, assistant_user_id, status, accepted_at)
     VALUES ('${driver}', '${assistant}', '${status}',
             ${acceptedAt === null ? 'NULL' : acceptedAt});`,
  );
}

type ManagedRow = {
  delegate_id: string;
  driver_user_id: string;
  driver_email: string;
  driver_name: string;
  accepted_at: string | null;
};

async function callAsAssistant(db: AnyPGlite, uid: string | null): Promise<ManagedRow[]> {
  await auth(db, uid);
  const res = await db.query<{ get_my_managed_drivers: ManagedRow }>(
    `SELECT * FROM public.get_my_managed_drivers()`,
  );
  return res.rows.map((r) => r.get_my_managed_drivers);
}

describe('get_my_managed_drivers — authenticated-role isolation matrix (Pass B1a)', () => {
  let db: AnyPGlite;

  beforeAll(async () => {
    db = new PGlite() as unknown as AnyPGlite;
    await primeMatrix(db);
  });

  beforeEach(async () => {
    await db.exec(`TRUNCATE public.driver_assistants;`);
  });

  afterAll(async () => {
    await db.close();
  });

  it('documents the real assistant_status vocabulary matches production (pending, active, revoked, expired)', async () => {
    const res = await db.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'assistant_status'
        ORDER BY e.enumsortorder`,
    );
    expect(res.rows.map((r) => r.enumlabel)).toEqual([...REAL_STATUSES]);
  });

  it('scenario 1 — Assistant A with one active relationship to Driver A: returns exactly that row', async () => {
    await insertRel(db, DA, AA, 'active');
    // Sanity: a foreign driver-assistant relationship also exists but must not leak.
    await insertRel(db, DC, AB, 'active');

    const rows = await callAsAssistant(db, AA);
    expect(rows).toHaveLength(1);
    expect(rows[0].driver_user_id).toBe(DA);
    expect(rows[0].driver_email).toBe('driver-a@example.com');
    // Relationship-status filter proved by count: only the active row for AA is present.
    const meta = await db.query<{ status: string; assistant_user_id: string }>(
      `SELECT status::text, assistant_user_id FROM public.driver_assistants
        WHERE id = '${rows[0].delegate_id}'`,
    );
    expect(meta.rows[0].status).toBe('active');
    expect(meta.rows[0].assistant_user_id).toBe(AA);
  });

  it('scenario 2 — Assistant B, with no relationship to Driver A, receives zero rows and cannot see Driver A', async () => {
    await insertRel(db, DA, AA, 'active');

    const rows = await callAsAssistant(db, AB);
    expect(rows).toHaveLength(0);
    expect(rows.find((r) => r.driver_user_id === DA)).toBeUndefined();
  });

  it('scenario 3 — multiple assistants remain isolated; unauthorized user receives nothing', async () => {
    await insertRel(db, DA, AA, 'active');
    await insertRel(db, DB_, AA, 'active');
    await insertRel(db, DC, AB, 'active');

    const aRows = await callAsAssistant(db, AA);
    const bRows = await callAsAssistant(db, AB);
    const uRows = await callAsAssistant(db, AU);

    const aDrivers = aRows.map((r) => r.driver_user_id).sort();
    expect(aDrivers).toEqual([DA, DB_].sort());
    expect(aRows.find((r) => r.driver_user_id === DC)).toBeUndefined();

    expect(bRows).toHaveLength(1);
    expect(bRows[0].driver_user_id).toBe(DC);
    expect(bRows.find((r) => [DA, DB_].includes(r.driver_user_id))).toBeUndefined();

    expect(uRows).toHaveLength(0);
  });

  it('scenario 4a — pending relationships are excluded for the owning assistant', async () => {
    await insertRel(db, DA, AA, 'pending', null);
    const rows = await callAsAssistant(db, AA);
    expect(rows).toHaveLength(0);
  });

  it('scenario 4b — revoked relationships are excluded for the owning assistant', async () => {
    await insertRel(db, DA, AA, 'revoked');
    const rows = await callAsAssistant(db, AA);
    expect(rows).toHaveLength(0);
  });

  it('scenario 4c — expired relationships are excluded for the owning assistant', async () => {
    await insertRel(db, DA, AA, 'expired');
    const rows = await callAsAssistant(db, AA);
    expect(rows).toHaveLength(0);
  });

  it('scenario 4d — every real non-active status is excluded (loop over the full production vocabulary)', async () => {
    for (const status of NON_ACTIVE_STATUSES) {
      await db.exec(`TRUNCATE public.driver_assistants;`);
      await insertRel(db, DA, AA, status);
      const rows = await callAsAssistant(db, AA);
      expect(rows, `status=${status} must not be returned`).toHaveLength(0);
    }
  });

  it('scenario 5 — mixed statuses: only the active relationship is returned', async () => {
    await insertRel(db, DA, AA, 'active');
    await insertRel(db, DB_, AA, 'pending', null);
    await insertRel(db, DC, AA, 'revoked');
    await insertRel(db, DD, AA, 'expired');

    const rows = await callAsAssistant(db, AA);
    expect(rows).toHaveLength(1);
    expect(rows[0].driver_user_id).toBe(DA);
    const returnedIds = rows.map((r) => r.driver_user_id);
    for (const forbidden of [DB_, DC, DD]) {
      expect(returnedIds).not.toContain(forbidden);
    }
  });

  it('scenario 6 — unauthenticated caller receives zero rows with no error leak', async () => {
    await insertRel(db, DA, AA, 'active');
    // Empty claim → auth.uid() returns NULL → early return.
    const rows = await callAsAssistant(db, null);
    expect(rows).toHaveLength(0);
  });

  it('scenario 7 — function signature takes zero arguments and derives identity from auth.uid()', async () => {
    // Argument-count proof from PostgreSQL catalog: no caller-supplied identity is possible.
    const sig = await db.query<{ pronargs: number; proargtypes: string; prosecdef: boolean }>(
      `SELECT pronargs, proargtypes::text, prosecdef
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_my_managed_drivers'`,
    );
    expect(sig.rows).toHaveLength(1);
    expect(sig.rows[0].pronargs).toBe(0);
    expect(sig.rows[0].proargtypes).toBe('');
    expect(sig.rows[0].prosecdef).toBe(true);

    // Behavioral proof: changing the JWT claim (identity) is the only thing that
    // changes the result — no argument can be supplied to spoof identity.
    await insertRel(db, DA, AA, 'active');
    await insertRel(db, DC, AB, 'active');

    const asA = await callAsAssistant(db, AA);
    const asB = await callAsAssistant(db, AB);
    expect(asA.map((r) => r.driver_user_id)).toEqual([DA]);
    expect(asB.map((r) => r.driver_user_id)).toEqual([DC]);

    // Calling the function with any positional argument must fail — the
    // canonical signature does not accept one.
    let argErr: unknown = null;
    try {
      await db.query(`SELECT * FROM public.get_my_managed_drivers('${AA}'::uuid)`);
    } catch (e) {
      argErr = e;
    }
    expect(argErr).not.toBeNull();
  });

  it('scenario 8 — display_name is returned when the driver profile has one', async () => {
    await insertRel(db, DA, AA, 'active');
    const rows = await callAsAssistant(db, AA);
    expect(rows[0].driver_name).toBe('Driver A Name');
  });

  it('scenario 9 — lower(auth email) fallback when display_name is NULL', async () => {
    // Driver B has NULL display_name in the fixture.
    await insertRel(db, DB_, AA, 'active');
    const rows = await callAsAssistant(db, AA);
    expect(rows[0].driver_name).toBe('driver-b@example.com');
  });

  it('scenario 10 — only active rows are returned, count matches active relationships, ordered by accepted_at DESC NULLS LAST', async () => {
    // 3 active with different accepted_at timestamps + 3 non-active decoys.
    await db.exec(`
      INSERT INTO public.driver_assistants
        (driver_user_id, assistant_user_id, status, accepted_at)
      VALUES
        ('${DA}', '${AA}', 'active',  TIMESTAMPTZ '2026-01-01 00:00:00Z'),
        ('${DB_}','${AA}', 'active',  TIMESTAMPTZ '2026-03-01 00:00:00Z'),
        ('${DC}', '${AA}', 'active',  NULL),
        ('${DD}', '${AA}', 'pending', NULL),
        ('${DA}', '${AB}', 'active',  TIMESTAMPTZ '2099-01-01 00:00:00Z'); -- must not leak to AA
    `);
    // Add a revoked + expired decoy for the same assistant to further prove filtering.
    await db.exec(`
      INSERT INTO public.driver_assistants
        (driver_user_id, assistant_user_id, status, accepted_at)
      VALUES
        ('${DD}', '${AA}', 'revoked', TIMESTAMPTZ '2099-06-01 00:00:00Z'),
        ('${DD}', '${AA}', 'expired', TIMESTAMPTZ '2099-07-01 00:00:00Z');
    `);

    const rows = await callAsAssistant(db, AA);

    // Row count equals the number of active AA relationships.
    const activeCount = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM public.driver_assistants
        WHERE assistant_user_id = '${AA}' AND status = 'active'`,
    );
    expect(rows).toHaveLength(activeCount.rows[0].n);
    expect(rows).toHaveLength(3);

    // No non-active driver id is present (DD only appears with pending/revoked/expired for AA).
    expect(rows.map((r) => r.driver_user_id)).not.toContain(DD);

    // Ordering: accepted_at DESC NULLS LAST → DB_ (March) first, DA (Jan) second, DC (NULL) last.
    expect(rows.map((r) => r.driver_user_id)).toEqual([DB_, DA, DC]);

    // Cross-assistant isolation preserved even in this mixed fixture.
    expect(rows.find((r) => r.driver_email === 'driver-a@example.com')?.driver_user_id).toBe(DA);
  });
});
