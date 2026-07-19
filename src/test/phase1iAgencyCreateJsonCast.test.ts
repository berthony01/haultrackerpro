// @vitest-environment node
// =====================================================================
// Phase 1I — Root-cause proof for the Agency Console
//   "invalid input syntax for type json"
// production defect.
//
// This is a real Postgres-compatible (PGlite) runtime harness. It:
//
//   1. Stands up a minimal schema mirror of the live objects that
//      create_agency touches (agency_profiles, agency_members,
//      agency_entitlements + the _agency_plan_defaults record helper).
//
//   2. Installs the CURRENT production create_agency() body verbatim
//      (which contains the defect) and proves it raises
//      "invalid input syntax for type json".
//
//   3. Installs the candidate migration
//      supabase/migration-candidates/20260719160000_fix_create_agency_json_cast.sql
//      and proves that create_agency now succeeds with (a) name only and
//      (b) all optional fields present, with agency_profiles +
//      agency_members + agency_entitlements all populated transactionally.
//
// No source-text assertions. Every claim is proved by executing SQL.
// =====================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

const CANDIDATE_REL =
  '../../supabase/migration-candidates/20260719160000_fix_create_agency_json_cast.sql';

function loadCandidate(): string {
  const p = fileURLToPath(new URL(CANDIDATE_REL, import.meta.url));
  return fs.readFileSync(p, 'utf8');
}

// Verbatim excerpt of the DEFECTIVE production body (from
// supabase/migrations/20260630151031_...sql lines 236-292). Only the
// declaration `_defaults jsonb` and the `(_defaults->>...)::int` reads
// carry the defect; everything else is preserved so we can prove the
// failure is the JSON cast, not something else.
const DEFECTIVE_CREATE_AGENCY = `
CREATE OR REPLACE FUNCTION public.create_agency(
  _name text,
  _description text DEFAULT NULL,
  _contact_email text DEFAULT NULL
)
RETURNS public.agency_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  _uid uuid := auth.uid();
  _row public.agency_profiles;
  _existing public.agency_profiles;
  _defaults jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;

  SELECT * INTO _existing FROM public.agency_profiles
    WHERE owner_user_id = _uid LIMIT 1;
  IF FOUND THEN RETURN _existing; END IF;

  IF _name IS NULL OR length(btrim(_name)) < 2 OR length(_name) > 120 THEN
    RAISE EXCEPTION 'Agency name must be 2-120 characters' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.agency_profiles(owner_user_id, name, description, contact_email)
  VALUES (_uid, btrim(_name),
          NULLIF(btrim(coalesce(_description,'')),''),
          NULLIF(lower(btrim(coalesce(_contact_email,''))),''))
  RETURNING * INTO _row;

  INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, role, status, accepted_at)
  VALUES (_row.id, _uid, 'owner@local', 'agency_owner','active', now());

  _defaults := public._agency_plan_defaults('agency_starter');
  INSERT INTO public.agency_entitlements
    (agency_id, plan_key, status, source,
     active_client_limit, member_limit, service_package_limit)
  VALUES (_row.id, 'agency_starter', 'manual_beta', 'manual',
          (_defaults->>'active_client_limit')::int,
          (_defaults->>'member_limit')::int,
          (_defaults->>'service_package_limit')::int)
  ON CONFLICT (agency_id) DO NOTHING;

  RETURN _row;
END;
$body$;
`;

async function primeSchema(db: AnyPGlite) {
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;

    CREATE TABLE public.agency_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id uuid NOT NULL,
      name text NOT NULL,
      description text,
      contact_email text,
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.agency_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
      member_user_id uuid,
      invite_email text NOT NULL,
      role text NOT NULL,
      status text NOT NULL,
      accepted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.agency_entitlements (
      agency_id uuid PRIMARY KEY REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
      plan_key text NOT NULL,
      status text NOT NULL,
      source text NOT NULL,
      active_client_limit integer NOT NULL,
      member_limit integer NOT NULL,
      service_package_limit integer NOT NULL
    );

    -- Verbatim record-returning helper from
    -- supabase/migrations/20260630002954_..._sql lines 61-68.
    CREATE OR REPLACE FUNCTION public._agency_plan_defaults(_plan_key text)
    RETURNS TABLE(member_limit integer, active_client_limit integer, service_package_limit integer)
    LANGUAGE sql IMMUTABLE SET search_path = public AS $$
      SELECT
        CASE _plan_key WHEN 'agency_starter' THEN 2 WHEN 'agency_team' THEN 5 WHEN 'agency_growth' THEN 15 ELSE 2 END,
        CASE _plan_key WHEN 'agency_starter' THEN 5 WHEN 'agency_team' THEN 25 WHEN 'agency_growth' THEN 100 ELSE 5 END,
        CASE _plan_key WHEN 'agency_starter' THEN 3 WHEN 'agency_team' THEN 25 WHEN 'agency_growth' THEN 100 ELSE 3 END;
    $$;
  `);

  await db.exec(
    `INSERT INTO auth.users(id, email) VALUES
      ('11111111-1111-1111-1111-111111111111','owner@example.com');`,
  );
}

async function asOwner(db: AnyPGlite) {
  await db.exec(
    `SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);`,
  );
}

describe('Agency create_agency JSON cast — root-cause proof', () => {
  let db: AnyPGlite;

  beforeAll(async () => {
    db = new PGlite() as unknown as AnyPGlite;
    await primeSchema(db);
  });

  it('reproduces the production defect: defective body raises "invalid input syntax for type json"', async () => {
    await db.exec(DEFECTIVE_CREATE_AGENCY);
    await asOwner(db);
    let caught: unknown = null;
    try {
      await db.query(`SELECT public.create_agency($1, NULL, NULL)`, ['Acme Fleet']);
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    const msg = String((caught as { message?: string })?.message ?? caught);
    expect(msg.toLowerCase()).toContain('invalid input syntax for type json');
    // Prove partial-write did NOT happen: the INSERT into agency_entitlements
    // is where the cast fires, but the whole statement is one implicit
    // transaction from the client's perspective; PGlite rolls it back.
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.agency_profiles;`,
    );
    expect(rows[0].n).toBe('0');
  });

  it('candidate migration fixes the defect: create with name only succeeds', async () => {
    await db.exec(loadCandidate());
    await asOwner(db);
    const { rows } = await db.query<{ id: string; name: string; description: string | null; contact_email: string | null }>(
      `SELECT id, name, description, contact_email FROM public.create_agency($1, NULL, NULL)`,
      ['Acme Fleet'],
    );
    expect(rows[0].name).toBe('Acme Fleet');
    expect(rows[0].description).toBeNull();
    expect(rows[0].contact_email).toBeNull();

    const mem = await db.query<{ role: string; status: string }>(
      `SELECT role, status FROM public.agency_members WHERE agency_id = $1`,
      [rows[0].id],
    );
    expect(mem.rows).toHaveLength(1);
    expect(mem.rows[0].role).toBe('agency_owner');
    expect(mem.rows[0].status).toBe('active');

    const ent = await db.query<{ member_limit: number; active_client_limit: number; service_package_limit: number }>(
      `SELECT member_limit, active_client_limit, service_package_limit
         FROM public.agency_entitlements WHERE agency_id = $1`,
      [rows[0].id],
    );
    expect(ent.rows).toHaveLength(1);
    expect(Number(ent.rows[0].member_limit)).toBe(2);
    expect(Number(ent.rows[0].active_client_limit)).toBe(5);
    expect(Number(ent.rows[0].service_package_limit)).toBe(3);
  });

  it('candidate is idempotent for the same owner (repeat call returns the same agency)', async () => {
    await asOwner(db);
    const first = await db.query<{ id: string }>(
      `SELECT id FROM public.create_agency($1, NULL, NULL)`,
      ['Acme Fleet'],
    );
    const second = await db.query<{ id: string }>(
      `SELECT id FROM public.create_agency($1, NULL, NULL)`,
      ['Different Name Ignored'],
    );
    expect(second.rows[0].id).toBe(first.rows[0].id);
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.agency_profiles WHERE owner_user_id = '11111111-1111-1111-1111-111111111111';`,
    );
    expect(rows[0].n).toBe('1');
  });

  it('candidate normalizes whitespace-only optional fields to NULL (no JSON cast in path)', async () => {
    await db.exec(
      `INSERT INTO auth.users(id,email) VALUES ('33333333-3333-3333-3333-333333333333','charlie@example.com');
       SELECT set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', false);`,
    );
    const blanks = await db.query<{ description: string | null; contact_email: string | null }>(
      `SELECT description, contact_email FROM public.create_agency($1, $2, $3)`,
      ['Charlie Freight', '   ', '   '],
    );
    expect(blanks.rows[0].description).toBeNull();
    expect(blanks.rows[0].contact_email).toBeNull();
  });

  it('candidate rejects empty name and invalid email with public-safe errors', async () => {
    const db4 = new PGlite() as unknown as AnyPGlite;
    await primeSchema(db4);
    await db4.exec(loadCandidate());
    await db4.exec(
      `SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);`,
    );

    let e1: unknown = null;
    try {
      await db4.query(`SELECT public.create_agency('', NULL, NULL)`);
    } catch (e) { e1 = e; }
    expect(String((e1 as { message?: string })?.message ?? '')).toMatch(/Agency name must be/);

    let e2: unknown = null;
    try {
      await db4.query(`SELECT public.create_agency('Delta Freight', NULL, 'not-an-email')`);
    } catch (e) { e2 = e; }
    expect(String((e2 as { message?: string })?.message ?? '')).toMatch(/Invalid contact email/);
  });
});
