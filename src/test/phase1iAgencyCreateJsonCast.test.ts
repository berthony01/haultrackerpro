// @vitest-environment node
// =====================================================================
// Phase 1I — Pass B1b
//   create_agency canonical migration, authorization, identity,
//   validation, isolation, idempotency, and transactional-atomicity
//   proof suite.
//
// Notes:
//   * The DEFECTIVE original body (declaring `_defaults jsonb`) is
//     embedded below solely for root-cause reproduction.
//   * The CORRECTED behavior is loaded from the canonical migration:
//       supabase/migrations/20260719144733_f61ea960-ce0b-4e78-9cdd-df707ea51cd0.sql
//     No simplified re-implementation is used.
//   * The obsolete parallel candidate
//       supabase/migration-candidates/20260719160000_fix_create_agency_json_cast.sql
//     was removed during B1b (canonical migration is byte-for-byte
//     identical to it in executable behavior).
//   * This suite APPLIES NO MIGRATION to any real database. All SQL
//     runs inside isolated PGlite databases created per scenario.
// =====================================================================

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

const CANONICAL_MIGRATION_REL =
  '../../supabase/migrations/20260719144733_f61ea960-ce0b-4e78-9cdd-df707ea51cd0.sql';

function loadCanonicalCreateAgencySql(): string {
  const p = fileURLToPath(new URL(CANONICAL_MIGRATION_REL, import.meta.url));
  return fs.readFileSync(p, 'utf8');
}

// Verbatim excerpt of the DEFECTIVE production body from
// supabase/migrations/20260630151031_..._sql. Only the JSON-cast bug
// is preserved; every other behavior is unchanged so failures can only
// be attributed to the JSON cast.
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

const OWNER_A = '11111111-1111-1111-1111-111111111111';
const OWNER_B = '22222222-2222-2222-2222-222222222222';
const OWNER_ORPHAN = '99999999-9999-9999-9999-999999999999';

async function primeSchema(db: AnyPGlite): Promise<void> {
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;

    -- Real enum vocabularies from migration 20260628105109_...
    CREATE TYPE public.agency_status AS ENUM ('active','disabled');
    CREATE TYPE public.agency_member_role AS ENUM ('agency_owner','agency_admin','agency_member');
    CREATE TYPE public.agency_member_status AS ENUM ('pending','active','revoked');

    CREATE TABLE public.agency_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id uuid NOT NULL UNIQUE,
      name text NOT NULL,
      description text,
      contact_email text,
      status public.agency_status NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.agency_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
      member_user_id uuid,
      invite_email text NOT NULL,
      role public.agency_member_role NOT NULL,
      status public.agency_member_status NOT NULL,
      accepted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX agency_members_agency_email_key
      ON public.agency_members(agency_id, lower(invite_email))
      WHERE status IN ('pending','active');

    CREATE TABLE public.agency_entitlements (
      agency_id uuid PRIMARY KEY REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
      plan_key text NOT NULL,
      status text NOT NULL,
      source text NOT NULL,
      active_client_limit integer NOT NULL,
      member_limit integer NOT NULL,
      service_package_limit integer NOT NULL
    );

    CREATE OR REPLACE FUNCTION public._agency_plan_defaults(_plan_key text)
    RETURNS TABLE(member_limit integer, active_client_limit integer, service_package_limit integer)
    LANGUAGE sql IMMUTABLE SET search_path = public AS $$
      SELECT
        CASE _plan_key WHEN 'agency_starter' THEN 2 WHEN 'agency_team' THEN 5 WHEN 'agency_growth' THEN 15 ELSE 2 END,
        CASE _plan_key WHEN 'agency_starter' THEN 5 WHEN 'agency_team' THEN 25 WHEN 'agency_growth' THEN 100 ELSE 5 END,
        CASE _plan_key WHEN 'agency_starter' THEN 3 WHEN 'agency_team' THEN 25 WHEN 'agency_growth' THEN 100 ELSE 3 END;
    $$;
  `);

  await db.exec(`
    INSERT INTO auth.users(id, email) VALUES
      ('${OWNER_A}','alice@example.com'),
      ('${OWNER_B}','bob@example.com');
  `);
}

async function setJwt(db: AnyPGlite, sub: string | null): Promise<void> {
  const v = sub ?? '';
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [v]);
}

async function freshDb(opts: { install: 'defective' | 'canonical' }): Promise<AnyPGlite> {
  const db = new PGlite() as unknown as AnyPGlite;
  await primeSchema(db);
  if (opts.install === 'defective') {
    await db.exec(DEFECTIVE_CREATE_AGENCY);
  } else {
    await db.exec(loadCanonicalCreateAgencySql());
  }
  return db;
}

async function counts(db: AnyPGlite): Promise<{ p: number; m: number; e: number }> {
  const p = await db.query<{ n: string }>(`SELECT count(*)::text n FROM public.agency_profiles`);
  const m = await db.query<{ n: string }>(`SELECT count(*)::text n FROM public.agency_members`);
  const e = await db.query<{ n: string }>(`SELECT count(*)::text n FROM public.agency_entitlements`);
  return { p: Number(p.rows[0].n), m: Number(m.rows[0].n), e: Number(e.rows[0].n) };
}

async function catchErr(fn: () => Promise<unknown>): Promise<{ message: string; code?: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { message?: string; code?: string };
    return { message: String(err?.message ?? e), code: err?.code };
  }
}

// ---------------------------------------------------------------------
// Scenario 1: defect reproduction
// ---------------------------------------------------------------------
describe('B1b · Scenario 1 — defective body reproduces JSON cast failure', () => {
  it('raises "invalid input syntax for type json" and leaves zero rows', async () => {
    const db = await freshDb({ install: 'defective' });
    try {
      await setJwt(db, OWNER_A);
      const err = await catchErr(() =>
        db.query(`SELECT public.create_agency($1, NULL, NULL)`, ['Acme Fleet']),
      );
      expect(err).not.toBeNull();
      expect(String(err!.message).toLowerCase()).toContain('invalid input syntax for type json');
      expect(await counts(db)).toEqual({ p: 0, m: 0, e: 0 });
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------
// Scenario 2: canonical migration fixes the defect
// ---------------------------------------------------------------------
describe('B1b · Scenario 2 — canonical migration succeeds', () => {
  it('creates exactly one profile, one owner member, one starter entitlement', async () => {
    const db = await freshDb({ install: 'canonical' });
    try {
      await setJwt(db, OWNER_A);
      const r = await db.query<{ id: string; owner_user_id: string; name: string }>(
        `SELECT id, owner_user_id, name FROM public.create_agency($1, NULL, NULL)`,
        ['Acme Fleet'],
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].owner_user_id).toBe(OWNER_A);
      expect(r.rows[0].name).toBe('Acme Fleet');
      expect(await counts(db)).toEqual({ p: 1, m: 1, e: 1 });
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------
// Scenario 3: identity from auth.uid()
// ---------------------------------------------------------------------
describe('B1b · Scenario 3 — identity is derived from auth.uid()', () => {
  it('owner_user_id and member_user_id both come from JWT sub, and switching the claim switches ownership', async () => {
    const db = await freshDb({ install: 'canonical' });
    try {
      await setJwt(db, OWNER_A);
      const a = await db.query<{ id: string; owner_user_id: string }>(
        `SELECT id, owner_user_id FROM public.create_agency('Alice Freight', NULL, NULL)`,
      );
      expect(a.rows[0].owner_user_id).toBe(OWNER_A);
      const am = await db.query<{ member_user_id: string }>(
        `SELECT member_user_id FROM public.agency_members WHERE agency_id = $1`,
        [a.rows[0].id],
      );
      expect(am.rows[0].member_user_id).toBe(OWNER_A);

      await setJwt(db, OWNER_B);
      const b = await db.query<{ id: string; owner_user_id: string }>(
        `SELECT id, owner_user_id FROM public.create_agency('Bob Freight', NULL, NULL)`,
      );
      expect(b.rows[0].owner_user_id).toBe(OWNER_B);
      expect(b.rows[0].id).not.toBe(a.rows[0].id);
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------
// Scenario 4: unauthenticated
// ---------------------------------------------------------------------
describe('B1b · Scenario 4 — unauthenticated rejection is atomic', () => {
  it('raises 42501 with a public-safe message and writes nothing', async () => {
    const db = await freshDb({ install: 'canonical' });
    try {
      await setJwt(db, null);
      const err = await catchErr(() =>
        db.query(`SELECT public.create_agency('Any Name', NULL, NULL)`),
      );
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/Not authenticated/i);
      if (err!.code) expect(err!.code).toBe('42501');
      expect(await counts(db)).toEqual({ p: 0, m: 0, e: 0 });
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------
// Scenario 5: exact owner-membership contract
// ---------------------------------------------------------------------
describe('B1b · Scenario 5 — owner membership contract', () => {
  it('exactly one owner row with the expected identity, role, status, accepted_at, invite_email', async () => {
    const db = await freshDb({ install: 'canonical' });
    try {
      await setJwt(db, OWNER_A);
      const r = await db.query<{ id: string }>(
        `SELECT id FROM public.create_agency('Acme Fleet', NULL, NULL)`,
      );
      const mem = await db.query<{
        member_user_id: string;
        invite_email: string;
        role: string;
        status: string;
        accepted_at: string | null;
      }>(
        `SELECT member_user_id, invite_email, role::text AS role, status::text AS status, accepted_at
           FROM public.agency_members WHERE agency_id = $1`,
        [r.rows[0].id],
      );
      expect(mem.rows).toHaveLength(1);
      expect(mem.rows[0].member_user_id).toBe(OWNER_A);
      expect(mem.rows[0].invite_email).toBe('alice@example.com');
      expect(mem.rows[0].role).toBe('agency_owner');
      expect(mem.rows[0].status).toBe('active');
      expect(mem.rows[0].accepted_at).not.toBeNull();
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------
// Scenario 6: exact entitlement contract (field-name reads)
// ---------------------------------------------------------------------
describe('B1b · Scenario 6 — starter entitlement contract', () => {
  it('exactly one row with plan_key/status/source and 5/2/3 limits (proves record-field reads)', async () => {
    const db = await freshDb({ install: 'canonical' });
    try {
      await setJwt(db, OWNER_A);
      const r = await db.query<{ id: string }>(
        `SELECT id FROM public.create_agency('Acme Fleet', NULL, NULL)`,
      );
      const ent = await db.query<{
        plan_key: string;
        status: string;
        source: string;
        member_limit: number;
        active_client_limit: number;
        service_package_limit: number;
      }>(
        `SELECT plan_key, status, source, member_limit, active_client_limit, service_package_limit
           FROM public.agency_entitlements WHERE agency_id = $1`,
        [r.rows[0].id],
      );
      expect(ent.rows).toHaveLength(1);
      const e = ent.rows[0];
      expect(e.plan_key).toBe('agency_starter');
      expect(e.status).toBe('manual_beta');
      expect(e.source).toBe('manual');
      expect(Number(e.member_limit)).toBe(2);
      expect(Number(e.active_client_limit)).toBe(5);
      expect(Number(e.service_package_limit)).toBe(3);
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------
// Scenario 7: whitespace-mixed-case normalization
// ---------------------------------------------------------------------
describe('B1b · Scenario 7 — normalization of name/description/email', () => {
  it('trims name and description, trims and lowercases email; children still created', async () => {
    const db = await freshDb({ install: 'canonical' });
    try {
      await setJwt(db, OWNER_A);
      const r = await db.query<{ id: string; name: string; description: string; contact_email: string }>(
        `SELECT id, name, description, contact_email
           FROM public.create_agency($1, $2, $3)`,
        ['  Acme Fleet  ', '   Best fleet ever   ', '  Contact@Acme.COM  '],
      );
      expect(r.rows[0].name).toBe('Acme Fleet');
      expect(r.rows[0].description).toBe('Best fleet ever');
      expect(r.rows[0].contact_email).toBe('contact@acme.com');
      expect(await counts(db)).toEqual({ p: 1, m: 1, e: 1 });
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------
// Scenario 8: whitespace-only optional fields → NULL
// ---------------------------------------------------------------------
describe('B1b · Scenario 8 — blank optionals normalize to NULL', () => {
  it('description and contact_email are NULL; children still created once', async () => {
    const db = await freshDb({ install: 'canonical' });
    try {
      await setJwt(db, OWNER_A);
      const r = await db.query<{ id: string; description: string | null; contact_email: string | null }>(
        `SELECT id, description, contact_email
           FROM public.create_agency($1, $2, $3)`,
        ['Acme Fleet', '   ', '   '],
      );
      expect(r.rows[0].description).toBeNull();
      expect(r.rows[0].contact_email).toBeNull();
      expect(await counts(db)).toEqual({ p: 1, m: 1, e: 1 });
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------
// Scenario 9: invalid name matrix
// ---------------------------------------------------------------------
describe('B1b · Scenario 9 — invalid name matrix', () => {
  const cases: Array<{ label: string; value: string | null }> = [
    { label: 'NULL', value: null },
    { label: 'empty', value: '' },
    { label: 'whitespace-only', value: '     ' },
    { label: 'one-char trimmed', value: '  x  ' },
    { label: 'over-120', value: 'a'.repeat(121) },
  ];
  for (const c of cases) {
    it(`rejects ${c.label} and writes nothing`, async () => {
      const db = await freshDb({ install: 'canonical' });
      try {
        await setJwt(db, OWNER_A);
        const err = await catchErr(() =>
          db.query(`SELECT public.create_agency($1, NULL, NULL)`, [c.value]),
        );
        expect(err).not.toBeNull();
        expect(err!.message).toMatch(/Agency name must be/i);
        expect(await counts(db)).toEqual({ p: 0, m: 0, e: 0 });
      } finally {
        await db.close();
      }
    });
  }
});

// ---------------------------------------------------------------------
// Scenario 10: invalid email matrix + valid mixed-case surrounded by ws
// ---------------------------------------------------------------------
describe('B1b · Scenario 10 — invalid email matrix', () => {
  const bad = [
    { label: 'malformed', value: 'not-an-email' },
    { label: 'missing-domain', value: 'user@' },
    { label: 'missing-tld', value: 'user@localhost' },
    { label: 'malformed-w-ws', value: '   nope!!   ' },
  ];
  for (const c of bad) {
    it(`rejects ${c.label} and writes nothing`, async () => {
      const db = await freshDb({ install: 'canonical' });
      try {
        await setJwt(db, OWNER_A);
        const err = await catchErr(() =>
          db.query(`SELECT public.create_agency('Acme Fleet', NULL, $1)`, [c.value]),
        );
        expect(err).not.toBeNull();
        expect(err!.message).toMatch(/Invalid contact email/i);
        expect(await counts(db)).toEqual({ p: 0, m: 0, e: 0 });
      } finally {
        await db.close();
      }
    });
  }

  it('accepts a valid mixed-case email with surrounding whitespace after trim+lowercase', async () => {
    const db = await freshDb({ install: 'canonical' });
    try {
      await setJwt(db, OWNER_A);
      const r = await db.query<{ contact_email: string }>(
        `SELECT contact_email FROM public.create_agency('Acme Fleet', NULL, $1)`,
        ['   Ops@Acme.COM   '],
      );
      expect(r.rows[0].contact_email).toBe('ops@acme.com');
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------
// Scenario 11: same-owner idempotency
// ---------------------------------------------------------------------
describe('B1b · Scenario 11 — same-owner idempotency', () => {
  it('second call returns original agency; no extra child rows; no field overwrite', async () => {
    const db = await freshDb({ install: 'canonical' });
    try {
      await setJwt(db, OWNER_A);
      const first = await db.query<{ id: string; name: string; description: string | null; contact_email: string | null }>(
        `SELECT id, name, description, contact_email
           FROM public.create_agency('Acme Fleet', 'Original', 'orig@acme.com')`,
      );
      const second = await db.query<{ id: string; name: string; description: string | null; contact_email: string | null }>(
        `SELECT id, name, description, contact_email
           FROM public.create_agency('Different Name', 'Different desc', 'different@acme.com')`,
      );
      expect(second.rows[0].id).toBe(first.rows[0].id);
      expect(second.rows[0].name).toBe('Acme Fleet');
      expect(second.rows[0].description).toBe('Original');
      expect(second.rows[0].contact_email).toBe('orig@acme.com');
      expect(await counts(db)).toEqual({ p: 1, m: 1, e: 1 });
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------
// Scenario 12: two-owner isolation
// ---------------------------------------------------------------------
describe('B1b · Scenario 12 — two-owner isolation', () => {
  it('Owner A and Owner B create distinct agencies with correct ownership and exact totals', async () => {
    const db = await freshDb({ install: 'canonical' });
    try {
      await setJwt(db, OWNER_A);
      const a = await db.query<{ id: string; owner_user_id: string }>(
        `SELECT id, owner_user_id FROM public.create_agency('Alice Freight', NULL, NULL)`,
      );
      await setJwt(db, OWNER_B);
      const b = await db.query<{ id: string; owner_user_id: string }>(
        `SELECT id, owner_user_id FROM public.create_agency('Bob Freight', NULL, NULL)`,
      );
      expect(a.rows[0].id).not.toBe(b.rows[0].id);
      expect(a.rows[0].owner_user_id).toBe(OWNER_A);
      expect(b.rows[0].owner_user_id).toBe(OWNER_B);

      const perAgency = await db.query<{ agency_id: string; members: string; ents: string }>(
        `SELECT p.id AS agency_id,
                (SELECT count(*)::text FROM public.agency_members m WHERE m.agency_id = p.id) AS members,
                (SELECT count(*)::text FROM public.agency_entitlements e WHERE e.agency_id = p.id) AS ents
           FROM public.agency_profiles p ORDER BY p.created_at`,
      );
      expect(perAgency.rows).toHaveLength(2);
      for (const row of perAgency.rows) {
        expect(Number(row.members)).toBe(1);
        expect(Number(row.ents)).toBe(1);
      }
      expect(await counts(db)).toEqual({ p: 2, m: 2, e: 2 });
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------
// Scenario 13: auth.users email-fallback → 'owner@local'
// ---------------------------------------------------------------------
describe('B1b · Scenario 13 — missing auth.users row uses owner@local fallback', () => {
  it('creates the agency; owner identity still auth.uid(); invite_email = owner@local', async () => {
    const db = await freshDb({ install: 'canonical' });
    try {
      await setJwt(db, OWNER_ORPHAN);
      const r = await db.query<{ id: string; owner_user_id: string }>(
        `SELECT id, owner_user_id FROM public.create_agency('Orphan Freight', NULL, NULL)`,
      );
      expect(r.rows[0].owner_user_id).toBe(OWNER_ORPHAN);
      const mem = await db.query<{ invite_email: string; member_user_id: string }>(
        `SELECT invite_email, member_user_id FROM public.agency_members WHERE agency_id = $1`,
        [r.rows[0].id],
      );
      expect(mem.rows[0].invite_email).toBe('owner@local');
      expect(mem.rows[0].member_user_id).toBe(OWNER_ORPHAN);
      expect(await counts(db)).toEqual({ p: 1, m: 1, e: 1 });
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------
// Scenario 14: member-insert failure rolls back everything
// ---------------------------------------------------------------------
describe('B1b · Scenario 14 — member-insert failure atomicity', () => {
  it('forced agency_members insert failure rolls back profile and prevents entitlement', async () => {
    const db = await freshDb({ install: 'canonical' });
    try {
      // Test-only trigger scoped to this isolated PGlite database.
      await db.exec(`
        CREATE OR REPLACE FUNCTION public._reject_member_insert() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'forced-member-insert-failure' USING ERRCODE='23514';
        END;
        $$;
        CREATE TRIGGER _reject_member_insert
          BEFORE INSERT ON public.agency_members
          FOR EACH ROW EXECUTE FUNCTION public._reject_member_insert();
      `);
      await setJwt(db, OWNER_A);
      const err = await catchErr(() =>
        db.query(`SELECT public.create_agency('Acme Fleet', NULL, NULL)`),
      );
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/forced-member-insert-failure/);
      expect(await counts(db)).toEqual({ p: 0, m: 0, e: 0 });
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------
// Scenario 15: entitlement-insert failure rolls back everything
// ---------------------------------------------------------------------
describe('B1b · Scenario 15 — entitlement-insert failure atomicity', () => {
  it('forced agency_entitlements insert failure rolls back profile and membership', async () => {
    const db = await freshDb({ install: 'canonical' });
    try {
      await db.exec(`
        CREATE OR REPLACE FUNCTION public._reject_entitlement_insert() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'forced-entitlement-insert-failure' USING ERRCODE='23514';
        END;
        $$;
        CREATE TRIGGER _reject_entitlement_insert
          BEFORE INSERT ON public.agency_entitlements
          FOR EACH ROW EXECUTE FUNCTION public._reject_entitlement_insert();
      `);
      await setJwt(db, OWNER_A);
      const err = await catchErr(() =>
        db.query(`SELECT public.create_agency('Acme Fleet', NULL, NULL)`),
      );
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/forced-entitlement-insert-failure/);
      expect(await counts(db)).toEqual({ p: 0, m: 0, e: 0 });
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------
// Scenario 16: pg_catalog function signature proof
// ---------------------------------------------------------------------
describe('B1b · Scenario 16 — pg_catalog signature contract', () => {
  it('exactly one overload; 3 text args; returns public.agency_profiles; SECURITY DEFINER; search_path=public', async () => {
    const db = await freshDb({ install: 'canonical' });
    try {
      const rows = await db.query<{
        args: string;
        result: string;
        prosecdef: boolean;
        proconfig: string[] | null;
      }>(
        `SELECT pg_get_function_identity_arguments(p.oid) AS args,
                pg_get_function_result(p.oid)             AS result,
                p.prosecdef,
                p.proconfig
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'create_agency'`,
      );
      expect(rows.rows).toHaveLength(1);
      const row = rows.rows[0];
      expect(row.args.replace(/\s+/g, ' ')).toBe('_name text, _description text, _contact_email text');
      expect(row.result).toBe('agency_profiles');
      expect(row.prosecdef).toBe(true);
      const cfg = (row.proconfig ?? []).map((s) => String(s));
      expect(cfg.some((s) => /^search_path=(public|"public")$/i.test(s))).toBe(true);
      // No UUID / caller-controlled owner argument.
      expect(row.args.toLowerCase()).not.toContain('uuid');
    } finally {
      await db.close();
    }
  });
});
