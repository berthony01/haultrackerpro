import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

const CANDIDATE = readFileSync(
  join(
    process.cwd(),
    'supabase/migration-candidates/20260719160500_fix_get_my_managed_drivers_full_name.sql',
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
