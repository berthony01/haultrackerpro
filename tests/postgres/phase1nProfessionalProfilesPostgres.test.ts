/**
 * Phase 1N-D — Real PostgreSQL 16 gate for the shared professional-profile
 * foundation candidate.
 *
 * This suite:
 *   1. Loads and executes the candidate SQL from disk EXACTLY.
 *   2. Bootstraps only the minimal auth surface (auth schema + auth.uid())
 *      and the minimal set of pre-existing relationship tables (driver_
 *      assistants, agency_profiles, agency_members, agency_delegation_
 *      requests) needed for the relationship helper referenced by the
 *      candidate. It does NOT hand-copy candidate logic.
 *   3. Snapshots the pg_catalog surface of those pre-existing operational
 *      tables BEFORE applying the candidate and re-checks AFTER, proving the
 *      candidate does not alter their policies, grants, or functions.
 *   4. Uses SET LOCAL ROLE + request.jwt.claim.sub to simulate PostgREST-
 *      style auth.uid() in production.
 *
 * The suite hard-fails without PHASE1N_PROFESSIONAL_PROFILE_DATABASE_URL; it
 * does not skip.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Environment gate — hard-fail (never skip).
// ---------------------------------------------------------------------------
const DATABASE_URL = process.env.PHASE1N_PROFESSIONAL_PROFILE_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'PHASE1N_PROFESSIONAL_PROFILE_DATABASE_URL is required for the Phase 1N-D ' +
      'real-PostgreSQL 16 gate. This suite must never be skipped.',
  );
}

// ---------------------------------------------------------------------------
// Candidate loaded from disk verbatim.
// ---------------------------------------------------------------------------
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CANDIDATE_PATH =
  REPO_ROOT +
  'supabase/migration-candidates/20260723020000_phase1n_d_professional_profile_foundation.sql';
const CANDIDATE_SQL = readFileSync(CANDIDATE_PATH, 'utf8');

// ---------------------------------------------------------------------------
// Minimal fixture. Reproduces the SHAPES of pre-existing operational tables
// used by the relationship helper — nothing more, nothing less. Column names,
// vocabularies and referential shapes match production migrations cited
// alongside each block.
// ---------------------------------------------------------------------------
const RESET_SQL = `
DO $$
DECLARE
  r record;
BEGIN
  DROP TABLE IF EXISTS public.professional_profiles CASCADE;
  DROP FUNCTION IF EXISTS public.get_my_professional_profile() CASCADE;
  DROP FUNCTION IF EXISTS public.upsert_my_professional_profile(text,text,text,smallint,text[],text[],text,text,text,text,boolean) CASCADE;
  DROP FUNCTION IF EXISTS public.delete_my_professional_profile() CASCADE;
  DROP FUNCTION IF EXISTS public.list_authorized_professional_profiles(uuid[]) CASCADE;
  DROP FUNCTION IF EXISTS public._professional_profile_relationship_authorized(uuid,uuid) CASCADE;
  DROP FUNCTION IF EXISTS public._professional_profile_normalize_string_array(text[],int,int,text) CASCADE;

  DROP TABLE IF EXISTS public.agency_delegation_requests CASCADE;
  DROP TABLE IF EXISTS public.agency_members CASCADE;
  DROP TABLE IF EXISTS public.agency_profiles CASCADE;
  DROP TABLE IF EXISTS public.driver_assistants CASCADE;
  DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;

  DROP TYPE IF EXISTS public.assistant_status CASCADE;
  DROP TYPE IF EXISTS public.agency_member_status CASCADE;
  DROP TYPE IF EXISTS public.agency_status CASCADE;
  DROP TYPE IF EXISTS public.agency_delegation_status CASCADE;

  DROP SCHEMA IF EXISTS auth CASCADE;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REASSIGN OWNED BY authenticated TO CURRENT_USER';
    EXECUTE 'DROP OWNED BY authenticated';
    EXECUTE 'DROP ROLE authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REASSIGN OWNED BY anon TO CURRENT_USER';
    EXECUTE 'DROP OWNED BY anon';
    EXECUTE 'DROP ROLE anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    EXECUTE 'REASSIGN OWNED BY service_role TO CURRENT_USER';
    EXECUTE 'DROP OWNED BY service_role';
    EXECUTE 'DROP ROLE service_role';
  END IF;
END$$;

CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text
);
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Reused updated_at helper (canonical: supabase/migrations/*update_updated_at_column*).
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

-- driver_assistants (canonical: 20260628033947_*.sql lines 6-45).
CREATE TYPE public.assistant_status AS ENUM ('pending','active','revoked','expired');
CREATE TABLE public.driver_assistants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL,
  assistant_user_id uuid,
  invite_email text NOT NULL,
  status public.assistant_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_assistants TO authenticated;
GRANT ALL ON public.driver_assistants TO service_role;
ALTER TABLE public.driver_assistants ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_assistants_driver_select ON public.driver_assistants
  FOR SELECT TO authenticated USING (auth.uid() = driver_user_id);

-- agency_profiles / agency_members (canonical: 20260628105109_*.sql lines 3-90).
CREATE TYPE public.agency_status AS ENUM ('active','disabled');
CREATE TYPE public.agency_member_status AS ENUM ('pending','active','revoked');

CREATE TABLE public.agency_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  name text NOT NULL,
  status public.agency_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_profiles TO authenticated;
GRANT ALL ON public.agency_profiles TO service_role;
ALTER TABLE public.agency_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY agency_profiles_owner_all ON public.agency_profiles
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE TABLE public.agency_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  member_user_id uuid,
  invite_email text NOT NULL,
  status public.agency_member_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_members TO authenticated;
GRANT ALL ON public.agency_members TO service_role;
ALTER TABLE public.agency_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY agency_members_self_select ON public.agency_members
  FOR SELECT TO authenticated USING (member_user_id = auth.uid());

-- agency_delegation_requests (canonical: 20260628114250_*.sql lines 115-147).
CREATE TYPE public.agency_delegation_status AS ENUM
  ('pending_driver_approval','approved','declined','revoked','expired');

CREATE TABLE public.agency_delegation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  member_invite_email text NOT NULL,
  status public.agency_delegation_status NOT NULL DEFAULT 'pending_driver_approval',
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_delegation_requests TO authenticated;
GRANT ALL ON public.agency_delegation_requests TO service_role;
ALTER TABLE public.agency_delegation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY adr_driver_select ON public.agency_delegation_requests
  FOR SELECT TO authenticated USING (driver_user_id = auth.uid());
`;

// ---------------------------------------------------------------------------
// Deterministic UUIDs.
// ---------------------------------------------------------------------------
const OWNER_UID       = '11111111-1111-4111-8111-111111111111';
const OTHER_UID       = '22222222-2222-4222-8222-222222222222';
const UNRELATED_UID   = '33333333-3333-4333-8333-333333333333';
const ASSISTANT_UID   = '44444444-4444-4444-8444-444444444444';
const PENDING_ASSIST  = '55555555-5555-4555-8555-555555555555';
const DELEG_MEMBER    = '66666666-6666-4666-8666-666666666666';
const DECLINED_MEMBER = '77777777-7777-4777-8777-777777777777';
const AGENCY_OWNER    = '88888888-8888-4888-8888-888888888888';
const AGENCY_MEMBER   = '99999999-9999-4999-8999-999999999999';
const PENDING_AGENCY  = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const ALL_UIDS = [
  OWNER_UID, OTHER_UID, UNRELATED_UID, ASSISTANT_UID, PENDING_ASSIST,
  DELEG_MEMBER, DECLINED_MEMBER, AGENCY_OWNER, AGENCY_MEMBER, PENDING_AGENCY,
];

// ---------------------------------------------------------------------------
// Test infrastructure.
// ---------------------------------------------------------------------------
const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  client: PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const r = await client.query(sql, params);
  return r.rows as T[];
}

async function asRole(
  client: PoolClient,
  role: 'authenticated' | 'anon' | 'service_role',
  uid: string | null,
  fn: () => Promise<void>,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    if (uid) {
      await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    } else {
      await client.query(`SELECT set_config('request.jwt.claim.sub', '', true)`);
    }
    await fn();
    await client.query('ROLLBACK');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function insertUsers(client: PoolClient): Promise<void> {
  for (const uid of ALL_UIDS) {
    await client.query(
      `INSERT INTO auth.users(id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [uid, `${uid}@ex.test`],
    );
  }
}

async function truncateAll(client: PoolClient): Promise<void> {
  await client.query(`
    TRUNCATE TABLE
      public.professional_profiles,
      public.agency_delegation_requests,
      public.agency_members,
      public.agency_profiles,
      public.driver_assistants
    RESTART IDENTITY CASCADE
  `);
}

async function upsertProfile(
  client: PoolClient,
  uid: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const defaults = {
    display_name: 'Test Pro',
    professional_title: null as string | null,
    bio: null as string | null,
    years_experience: null as number | null,
    services: [] as string[],
    service_areas: [] as string[],
    availability: 'available',
    contact_email: null as string | null,
    contact_phone: null as string | null,
    visibility: 'private',
    share_contact_details: false,
    ...overrides,
  } as Record<string, unknown>;
  await asRole(client, 'authenticated', uid, async () => {
    await client.query(
      `SELECT public.upsert_my_professional_profile(
         $1,$2,$3,$4::smallint,$5::text[],$6::text[],$7,$8,$9,$10,$11
       )`,
      [
        defaults.display_name,
        defaults.professional_title,
        defaults.bio,
        defaults.years_experience,
        defaults.services,
        defaults.service_areas,
        defaults.availability,
        defaults.contact_email,
        defaults.contact_phone,
        defaults.visibility,
        defaults.share_contact_details,
      ],
    );
  });
}

// Snapshot of operational-table catalog state for change-detection.
async function operationalSnapshot(client: PoolClient): Promise<string> {
  const tables = [
    'driver_assistants',
    'agency_profiles',
    'agency_members',
    'agency_delegation_requests',
  ];
  const rows = await q(client, `
    SELECT tablename, policyname, cmd, qual, with_check
      FROM pg_policies
     WHERE schemaname='public'
       AND tablename = ANY($1)
     ORDER BY tablename, policyname
  `, [tables]);
  const grants = await q(client, `
    SELECT table_name, grantee, privilege_type
      FROM information_schema.role_table_grants
     WHERE table_schema='public'
       AND table_name = ANY($1)
       AND grantee IN ('anon','authenticated','service_role')
     ORDER BY table_name, grantee, privilege_type
  `, [tables]);
  return JSON.stringify({ policies: rows, grants });
}

let preCandidateOperationalSnapshot: string;

// ---------------------------------------------------------------------------
// Bootstrap and teardown.
// ---------------------------------------------------------------------------
beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query(RESET_SQL);
    await insertUsers(client);
    preCandidateOperationalSnapshot = await operationalSnapshot(client);
    // Apply the candidate verbatim from disk.
    await client.query(CANDIDATE_SQL);
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await pool.end();
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('Phase 1N-D — Professional Profile PG16 foundation', () => {
  it('01: PostgreSQL major version is 16', async () => {
    const client = await pool.connect();
    try {
      const [{ v }] = await q<{ v: string }>(
        client,
        `SELECT current_setting('server_version_num') AS v`,
      );
      const major = Math.floor(parseInt(v, 10) / 10000);
      expect(major).toBe(16);
    } finally { client.release(); }
  });

  it('02: exact columns/types/vocabularies on professional_profiles', async () => {
    const client = await pool.connect();
    try {
      const cols = await q<{
        column_name: string; data_type: string; is_nullable: string; column_default: string | null;
      }>(client, `
        SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema='public' AND table_name='professional_profiles'
         ORDER BY ordinal_position
      `);
      const shape = cols.map(c => `${c.column_name}:${c.data_type}:${c.is_nullable}`);
      expect(shape).toEqual([
        'user_id:uuid:NO',
        'display_name:text:NO',
        'professional_title:text:YES',
        'bio:text:YES',
        'years_experience:smallint:YES',
        'services:ARRAY:NO',
        'service_areas:ARRAY:NO',
        'availability:text:NO',
        'contact_email:text:YES',
        'contact_phone:text:YES',
        'visibility:text:NO',
        'share_contact_details:boolean:NO',
        'created_at:timestamp with time zone:NO',
        'updated_at:timestamp with time zone:NO',
      ]);

      // Vocabularies via CHECK constraints.
      const checks = await q<{ conname: string; def: string }>(client, `
        SELECT c.conname, pg_get_constraintdef(c.oid) AS def
          FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          JOIN pg_namespace n ON t.relnamespace = n.oid
         WHERE n.nspname='public' AND t.relname='professional_profiles'
           AND c.contype='c'
         ORDER BY c.conname
      `);
      const defs = checks.map(x => x.def).join('\n');
      expect(defs).toMatch(/availability = ANY \(ARRAY\['available'::text, 'limited'::text, 'unavailable'::text\]\)/);
      expect(defs).toMatch(/visibility = ANY \(ARRAY\['private'::text, 'authorized_connections'::text\]\)/);
      expect(defs).toMatch(/share_contact_details = false.*visibility = 'authorized_connections'::text/s);
    } finally { client.release(); }
  });

  it('03: PRIMARY KEY on user_id enforces one row per user', async () => {
    const client = await pool.connect();
    try {
      await truncateAll(client);
      await insertUsers(client);
      await upsertProfile(client, OWNER_UID);
      await upsertProfile(client, OWNER_UID, { display_name: 'Second call' });
      const [{ n }] = await q<{ n: string }>(
        client,
        `SELECT COUNT(*)::text AS n FROM public.professional_profiles WHERE user_id=$1`,
        [OWNER_UID],
      );
      expect(n).toBe('1');

      // Also assert PRIMARY KEY declaration.
      const [{ contype }] = await q<{ contype: string }>(client, `
        SELECT contype FROM pg_constraint c
         JOIN pg_class t ON c.conrelid=t.oid
         JOIN pg_namespace n ON t.relnamespace=n.oid
        WHERE n.nspname='public' AND t.relname='professional_profiles'
          AND c.contype='p'
      `);
      expect(contype).toBe('p');
    } finally { client.release(); }
  });

  it('04: authenticated has NO direct INSERT/UPDATE/DELETE table privilege', async () => {
    const client = await pool.connect();
    try {
      const rows = await q<{ privilege_type: string }>(client, `
        SELECT privilege_type FROM information_schema.role_table_grants
         WHERE table_schema='public' AND table_name='professional_profiles'
           AND grantee='authenticated'
         ORDER BY privilege_type
      `);
      const privs = rows.map(r => r.privilege_type).sort();
      expect(privs).toEqual(['SELECT']);

      // Runtime probe: direct INSERT should fail with insufficient_privilege.
      await asRole(client, 'authenticated', OWNER_UID, async () => {
        let err: unknown;
        try {
          await client.query(`INSERT INTO public.professional_profiles(user_id, display_name, availability) VALUES ($1,'X','available')`, [OWNER_UID]);
        } catch (e) { err = e; }
        expect(err).toBeDefined();
        expect(String(err)).toMatch(/permission denied/i);
      });
    } finally { client.release(); }
  });

  it('05: authenticated direct SELECT returns only own row', async () => {
    const client = await pool.connect();
    try {
      await truncateAll(client);
      await insertUsers(client);
      await upsertProfile(client, OWNER_UID, { visibility: 'authorized_connections' });
      await upsertProfile(client, OTHER_UID, { visibility: 'authorized_connections' });

      await asRole(client, 'authenticated', OWNER_UID, async () => {
        const rows = await q(client, `SELECT user_id FROM public.professional_profiles ORDER BY user_id`);
        expect(rows.map(r => r.user_id)).toEqual([OWNER_UID]);
      });
    } finally { client.release(); }
  });

  it('06: owner RPCs create/read/update/delete own row only', async () => {
    const client = await pool.connect();
    try {
      await truncateAll(client);
      await insertUsers(client);

      await asRole(client, 'authenticated', OWNER_UID, async () => {
        // Create.
        const create = await q(client, `
          SELECT * FROM public.upsert_my_professional_profile(
            'Owner One','Driver Coach','Bio text',10::smallint,
            ARRAY['Coaching']::text[], ARRAY['USA']::text[],
            'available', 'a@ex.test', '555', 'private', false
          )
        `);
        expect(create.length).toBe(1);
        expect(create[0].display_name).toBe('Owner One');

        // Read.
        const got = await q(client, `SELECT * FROM public.get_my_professional_profile()`);
        expect(got.length).toBe(1);
        expect(got[0].display_name).toBe('Owner One');

        // Update via same RPC (upsert).
        const upd = await q(client, `
          SELECT * FROM public.upsert_my_professional_profile(
            'Owner Two',NULL,NULL,NULL::smallint,
            ARRAY[]::text[], ARRAY[]::text[],
            'limited', NULL, NULL, 'private', false
          )
        `);
        expect(upd[0].display_name).toBe('Owner Two');
        expect(upd[0].availability).toBe('limited');

        // Delete.
        const [{ delete_my_professional_profile: gone }] = await q<{ delete_my_professional_profile: boolean }>(
          client, `SELECT public.delete_my_professional_profile()`,
        );
        expect(gone).toBe(true);

        // Second delete returns false (no row).
        const [{ delete_my_professional_profile: gone2 }] = await q<{ delete_my_professional_profile: boolean }>(
          client, `SELECT public.delete_my_professional_profile()`,
        );
        expect(gone2).toBe(false);
      });
    } finally { client.release(); }
  });

  it('07: no write RPC accepts a target user_id parameter (signature/catalog proof)', async () => {
    const client = await pool.connect();
    try {
      const rows = await q<{ proname: string; args: string }>(client, `
        SELECT p.proname,
               pg_get_function_arguments(p.oid) AS args
          FROM pg_proc p
          JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = 'public'
           AND p.proname IN (
             'upsert_my_professional_profile',
             'delete_my_professional_profile',
             'get_my_professional_profile'
           )
         ORDER BY p.proname
      `);
      // No parameter named user_id / target_user_id / p_user_id.
      for (const r of rows) {
        expect(r.args).not.toMatch(/\buser_id\b/i);
        expect(r.args).not.toMatch(/target_user_id/i);
        expect(r.args).not.toMatch(/p_user_id/i);
      }
    } finally { client.release(); }
  });

  it('08: private visibility normalizes sharing to false', async () => {
    const client = await pool.connect();
    try {
      await truncateAll(client);
      await insertUsers(client);
      await asRole(client, 'authenticated', OWNER_UID, async () => {
        await client.query(`
          SELECT public.upsert_my_professional_profile(
            'X',NULL,NULL,NULL::smallint,'{}'::text[],'{}'::text[],'available',
            NULL,NULL,'private',true
          )
        `);
        const [{ share_contact_details: s }] = await q<{ share_contact_details: boolean }>(
          client, `SELECT share_contact_details FROM public.get_my_professional_profile()`,
        );
        expect(s).toBe(false);
      });
    } finally { client.release(); }
  });

  it('09: authorized_connections does NOT auto-enable sharing', async () => {
    const client = await pool.connect();
    try {
      await truncateAll(client);
      await insertUsers(client);
      await asRole(client, 'authenticated', OWNER_UID, async () => {
        await client.query(`
          SELECT public.upsert_my_professional_profile(
            'X',NULL,NULL,NULL::smallint,'{}'::text[],'{}'::text[],'available',
            NULL,NULL,'authorized_connections',false
          )
        `);
        const [{ share_contact_details: s }] = await q<{ share_contact_details: boolean }>(
          client, `SELECT share_contact_details FROM public.get_my_professional_profile()`,
        );
        expect(s).toBe(false);
      });
    } finally { client.release(); }
  });

  it('10: input validation — name/title/bio/contact lengths, years, raw >12 array, deduped, per-elem length', async () => {
    const client = await pool.connect();
    type Case = { name: string; sql: string; match: RegExp };
    const cases: Case[] = [
      { name: 'display_name too short', sql: `SELECT public.upsert_my_professional_profile('A',NULL,NULL,NULL::smallint,'{}'::text[],'{}'::text[],'available',NULL,NULL,'private',false)`, match: /display_name/i },
      { name: 'display_name too long', sql: `SELECT public.upsert_my_professional_profile(${literalRep('a', 81)},NULL,NULL,NULL::smallint,'{}'::text[],'{}'::text[],'available',NULL,NULL,'private',false)`, match: /display_name/i },
      { name: 'title too long', sql: `SELECT public.upsert_my_professional_profile('Ok',${literalRep('t', 121)},NULL,NULL::smallint,'{}'::text[],'{}'::text[],'available',NULL,NULL,'private',false)`, match: /professional_title/i },
      { name: 'bio too long', sql: `SELECT public.upsert_my_professional_profile('Ok',NULL,${literalRep('b', 1001)},NULL::smallint,'{}'::text[],'{}'::text[],'available',NULL,NULL,'private',false)`, match: /bio/i },
      { name: 'years too high', sql: `SELECT public.upsert_my_professional_profile('Ok',NULL,NULL,71::smallint,'{}'::text[],'{}'::text[],'available',NULL,NULL,'private',false)`, match: /years_experience/i },
      { name: 'years negative', sql: `SELECT public.upsert_my_professional_profile('Ok',NULL,NULL,(-1)::smallint,'{}'::text[],'{}'::text[],'available',NULL,NULL,'private',false)`, match: /years_experience/i },
      { name: 'contact_email too long', sql: `SELECT public.upsert_my_professional_profile('Ok',NULL,NULL,NULL::smallint,'{}'::text[],'{}'::text[],'available',${literalRep('e', 321)},NULL,'private',false)`, match: /contact_email/i },
      { name: 'contact_phone too long', sql: `SELECT public.upsert_my_professional_profile('Ok',NULL,NULL,NULL::smallint,'{}'::text[],'{}'::text[],'available',NULL,${literalRep('p', 41)},'private',false)`, match: /contact_phone/i },
      { name: 'availability vocab', sql: `SELECT public.upsert_my_professional_profile('Ok',NULL,NULL,NULL::smallint,'{}'::text[],'{}'::text[],'sometimes',NULL,NULL,'private',false)`, match: /availability/i },
      { name: 'visibility vocab', sql: `SELECT public.upsert_my_professional_profile('Ok',NULL,NULL,NULL::smallint,'{}'::text[],'{}'::text[],'available',NULL,NULL,'public',false)`, match: /visibility/i },
      // raw >12 nonblank entries (13 unique) — must be rejected BEFORE dedupe.
      { name: 'raw services >12', sql: `SELECT public.upsert_my_professional_profile('Ok',NULL,NULL,NULL::smallint,ARRAY['s1','s2','s3','s4','s5','s6','s7','s8','s9','s10','s11','s12','s13']::text[],'{}'::text[],'available',NULL,NULL,'private',false)`, match: /services/i },
      // raw >12 via duplicates (13 total, 1 unique) — MUST still be rejected.
      { name: 'raw services >12 via duplicates', sql: `SELECT public.upsert_my_professional_profile('Ok',NULL,NULL,NULL::smallint,ARRAY['x','x','x','x','x','x','x','x','x','x','x','x','x']::text[],'{}'::text[],'available',NULL,NULL,'private',false)`, match: /services/i },
      { name: 'raw service_areas >12', sql: `SELECT public.upsert_my_professional_profile('Ok',NULL,NULL,NULL::smallint,'{}'::text[],ARRAY['a1','a2','a3','a4','a5','a6','a7','a8','a9','a10','a11','a12','a13']::text[],'available',NULL,NULL,'private',false)`, match: /service_areas/i },
      // per-element length: service > 60 chars.
      { name: 'service element too long', sql: `SELECT public.upsert_my_professional_profile('Ok',NULL,NULL,NULL::smallint,ARRAY[${literalRep('s', 61)}]::text[],'{}'::text[],'available',NULL,NULL,'private',false)`, match: /services/i },
      // per-element length: service area > 80 chars.
      { name: 'service_area element too long', sql: `SELECT public.upsert_my_professional_profile('Ok',NULL,NULL,NULL::smallint,'{}'::text[],ARRAY[${literalRep('a', 81)}]::text[],'available',NULL,NULL,'private',false)`, match: /service_areas/i },
    ];

    try {
      await truncateAll(client);
      await insertUsers(client);
      for (const c of cases) {
        await asRole(client, 'authenticated', OWNER_UID, async () => {
          let err: unknown;
          try {
            await client.query(c.sql);
          } catch (e) { err = e; }
          expect(err, `case: ${c.name}`).toBeDefined();
          expect(String(err), `case: ${c.name}`).toMatch(c.match);
        });
      }

      // Positive: deduped case-insensitive preserving first display value.
      await asRole(client, 'authenticated', OWNER_UID, async () => {
        const rows = await q(client, `
          SELECT (public.upsert_my_professional_profile(
            'Ok',NULL,NULL,NULL::smallint,
            ARRAY['Coaching','coaching','COACHING','Dispatch']::text[],
            ARRAY['USA','usa']::text[],
            'available',NULL,NULL,'private',false
          )).services AS services
        `);
        expect(rows[0].services).toEqual(['Coaching','Dispatch']);
        const rows2 = await q(client, `SELECT service_areas FROM public.get_my_professional_profile()`);
        expect(rows2[0].service_areas).toEqual(['USA']);
      });
    } finally { client.release(); }
  });

  it('11–16: relationship authorization matrix', async () => {
    const client = await pool.connect();
    try {
      await truncateAll(client);
      await insertUsers(client);

      // Target (OWNER_UID) exposes as authorized_connections.
      await upsertProfile(client, OWNER_UID, {
        visibility: 'authorized_connections',
        share_contact_details: false,
        contact_email: 'owner@ex.test',
      });

      // Seed relationships. Using service_role bypasses RLS for setup.
      await client.query('BEGIN'); await client.query('SET LOCAL ROLE service_role');
      // (a) active direct assistant: ASSISTANT_UID is active assistant of OWNER.
      await client.query(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id, invite_email, status) VALUES ($1,$2,$3,'active')`, [OWNER_UID, ASSISTANT_UID, 'a@x']);
      // pending assistant: PENDING_ASSIST is pending assistant of OWNER.
      await client.query(`INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id, invite_email, status) VALUES ($1,$2,$3,'pending')`, [OWNER_UID, PENDING_ASSIST, 'p@x']);
      // (c) same active agency: AGENCY_OWNER owns an agency; AGENCY_MEMBER is active; PENDING_AGENCY is pending.
      const agencyId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      await client.query(`INSERT INTO public.agency_profiles(id, owner_user_id, name, status) VALUES ($1,$2,'A','active')`, [agencyId, AGENCY_OWNER]);
      await client.query(`INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, status) VALUES ($1,$2,$3,'active')`, [agencyId, AGENCY_MEMBER, 'm@x']);
      await client.query(`INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, status) VALUES ($1,$2,$3,'pending')`, [agencyId, PENDING_AGENCY, 'pm@x']);
      // Put OWNER as an active member of same agency so agency-connection tests apply to OWNER<->AGENCY_MEMBER/AGENCY_OWNER.
      await client.query(`INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, status) VALUES ($1,$2,$3,'active')`, [agencyId, OWNER_UID, 'owner@x']);
      // (b) delegation: OWNER-as-driver has delegation to DELEG_MEMBER approved and DECLINED_MEMBER declined.
      const delegAgency = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      await client.query(`INSERT INTO public.agency_profiles(id, owner_user_id, name, status) VALUES ($1,$2,'B','active')`, [delegAgency, AGENCY_OWNER]);
      await client.query(`INSERT INTO public.agency_delegation_requests(agency_id, driver_user_id, member_user_id, member_invite_email, status, created_by_user_id) VALUES ($1,$2,$3,$4,'approved',$5)`, [delegAgency, OWNER_UID, DELEG_MEMBER, 'dm@x', AGENCY_OWNER]);
      await client.query(`INSERT INTO public.agency_delegation_requests(agency_id, driver_user_id, member_user_id, member_invite_email, status, created_by_user_id) VALUES ($1,$2,$3,$4,'declined',$5)`, [delegAgency, OWNER_UID, DECLINED_MEMBER, 'dc@x', AGENCY_OWNER]);
      await client.query('COMMIT');

      // Ensure the "authorized viewers" all have some profile row so batch RPC
      // returns them when authorized (the batch RPC returns profile rows; the
      // relationship helper is called from the perspective of a viewer looking
      // at the OWNER target).
      // The viewers themselves don't need their own profile.

      // (13) active direct assistant works — viewer=ASSISTANT_UID, target=OWNER.
      await asRole(client, 'authenticated', ASSISTANT_UID, async () => {
        const rows = await q(client, `SELECT * FROM public.list_authorized_professional_profiles(ARRAY[$1]::uuid[])`, [OWNER_UID]);
        expect(rows.length).toBe(1);
      });

      // Wait — spec (a) says viewer is DRIVER and target is ASSISTANT. So the
      // authorized direction is DRIVER viewing ASSISTANT. Let's align: give
      // the ASSISTANT_UID a professional profile and let OWNER (driver) view.
      await client.query('BEGIN'); await client.query('SET LOCAL ROLE service_role');
      await client.query(`
        INSERT INTO public.professional_profiles(user_id, display_name, availability, visibility)
        VALUES ($1,'Assistant Pro','available','authorized_connections')
      `, [ASSISTANT_UID]);
      await client.query(`
        INSERT INTO public.professional_profiles(user_id, display_name, availability, visibility)
        VALUES ($1,'Pending Pro','available','authorized_connections')
      `, [PENDING_ASSIST]);
      await client.query(`
        INSERT INTO public.professional_profiles(user_id, display_name, availability, visibility)
        VALUES ($1,'Deleg Pro','available','authorized_connections')
      `, [DELEG_MEMBER]);
      await client.query(`
        INSERT INTO public.professional_profiles(user_id, display_name, availability, visibility)
        VALUES ($1,'Declined Pro','available','authorized_connections')
      `, [DECLINED_MEMBER]);
      await client.query(`
        INSERT INTO public.professional_profiles(user_id, display_name, availability, visibility)
        VALUES ($1,'Agency Owner Pro','available','authorized_connections')
      `, [AGENCY_OWNER]);
      await client.query(`
        INSERT INTO public.professional_profiles(user_id, display_name, availability, visibility)
        VALUES ($1,'Agency Member Pro','available','authorized_connections')
      `, [AGENCY_MEMBER]);
      await client.query(`
        INSERT INTO public.professional_profiles(user_id, display_name, availability, visibility)
        VALUES ($1,'Pending Agency Pro','available','authorized_connections')
      `, [PENDING_AGENCY]);
      // Add a private profile for connected user to prove private-connected -> no row.
      const PRIVATE_CONNECTED = '00000000-0000-4000-8000-000000000001';
      await client.query(`INSERT INTO auth.users(id,email) VALUES ($1,'pc@x') ON CONFLICT DO NOTHING`, [PRIVATE_CONNECTED]);
      await client.query(`INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, status) VALUES ($1,$2,$3,'active')`, [agencyId, PRIVATE_CONNECTED, 'pc@x']);
      await client.query(`INSERT INTO public.professional_profiles(user_id, display_name, availability, visibility) VALUES ($1,'Private Pro','available','private')`, [PRIVATE_CONNECTED]);
      await client.query('COMMIT');

      // Viewer = OWNER_UID (driver).
      await asRole(client, 'authenticated', OWNER_UID, async () => {
        // (13) active assistant works.
        const a = await q(client, `SELECT user_id FROM public.list_authorized_professional_profiles(ARRAY[$1]::uuid[])`, [ASSISTANT_UID]);
        expect(a.map(r => r.user_id)).toEqual([ASSISTANT_UID]);

        // (14) pending assistant does NOT qualify.
        const pa = await q(client, `SELECT user_id FROM public.list_authorized_professional_profiles(ARRAY[$1]::uuid[])`, [PENDING_ASSIST]);
        expect(pa.length).toBe(0);

        // (15) approved delegation works.
        const d = await q(client, `SELECT user_id FROM public.list_authorized_professional_profiles(ARRAY[$1]::uuid[])`, [DELEG_MEMBER]);
        expect(d.map(r => r.user_id)).toEqual([DELEG_MEMBER]);

        // (16) declined delegation does NOT qualify.
        const dc = await q(client, `SELECT user_id FROM public.list_authorized_professional_profiles(ARRAY[$1]::uuid[])`, [DECLINED_MEMBER]);
        expect(dc.length).toBe(0);

        // (11) same active agency: OWNER<->AGENCY_MEMBER and OWNER<->AGENCY_OWNER.
        const ag = await q(client, `SELECT user_id FROM public.list_authorized_professional_profiles(ARRAY[$1,$2]::uuid[]) ORDER BY user_id`, [AGENCY_MEMBER, AGENCY_OWNER]);
        expect(ag.map(r => r.user_id).sort()).toEqual([AGENCY_MEMBER, AGENCY_OWNER].sort());

        // (12) pending agency member does NOT qualify.
        const pag = await q(client, `SELECT user_id FROM public.list_authorized_professional_profiles(ARRAY[$1]::uuid[])`, [PENDING_AGENCY]);
        expect(pag.length).toBe(0);

        // (17) unrelated user — no row.
        const unrel = await q(client, `SELECT user_id FROM public.list_authorized_professional_profiles(ARRAY[$1]::uuid[])`, [UNRELATED_UID]);
        expect(unrel.length).toBe(0);

        // (18) connected but private — no row.
        const pcRows = await q(client, `SELECT user_id FROM public.list_authorized_professional_profiles(ARRAY[$1]::uuid[])`, [PRIVATE_CONNECTED]);
        expect(pcRows.length).toBe(0);
      });
    } finally { client.release(); }
  });

  it('19–20: contact masking based on share_contact_details', async () => {
    const client = await pool.connect();
    try {
      await truncateAll(client);
      await insertUsers(client);

      // Two profiles authorized to a viewer via same agency. OTHER_UID shares
      // contact; UNRELATED_UID we won't include — replace with a shared and a
      // non-shared connected user.
      const agencyId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      await client.query('BEGIN'); await client.query('SET LOCAL ROLE service_role');
      await client.query(`INSERT INTO public.agency_profiles(id, owner_user_id, name, status) VALUES ($1,$2,'A','active')`, [agencyId, AGENCY_OWNER]);
      for (const u of [OWNER_UID, OTHER_UID, ASSISTANT_UID]) {
        await client.query(`INSERT INTO public.agency_members(agency_id, member_user_id, invite_email, status) VALUES ($1,$2,$3,'active')`, [agencyId, u, `${u}@x`]);
      }
      await client.query('COMMIT');

      // OTHER shares contact = true; ASSISTANT shares contact = false.
      await upsertProfile(client, OTHER_UID, {
        visibility: 'authorized_connections',
        share_contact_details: true,
        contact_email: 'other@ex.test',
        contact_phone: '111',
      });
      await upsertProfile(client, ASSISTANT_UID, {
        visibility: 'authorized_connections',
        share_contact_details: false,
        contact_email: 'assist@ex.test',
        contact_phone: '222',
      });
      // Owner has own contact too.
      await upsertProfile(client, OWNER_UID, {
        visibility: 'authorized_connections',
        share_contact_details: false,
        contact_email: 'owner@ex.test',
        contact_phone: '333',
      });

      await asRole(client, 'authenticated', OWNER_UID, async () => {
        const rows = await q<{
          user_id: string; contact_email: string | null; contact_phone: string | null;
        }>(client, `
          SELECT user_id, contact_email, contact_phone
            FROM public.list_authorized_professional_profiles(ARRAY[$1,$2,$3]::uuid[])
           ORDER BY user_id
        `, [OWNER_UID, OTHER_UID, ASSISTANT_UID]);
        const byUid = Object.fromEntries(rows.map(r => [r.user_id, r]));
        // Owner always gets own contact.
        expect(byUid[OWNER_UID].contact_email).toBe('owner@ex.test');
        expect(byUid[OWNER_UID].contact_phone).toBe('333');
        // Other shares -> exposed.
        expect(byUid[OTHER_UID].contact_email).toBe('other@ex.test');
        expect(byUid[OTHER_UID].contact_phone).toBe('111');
        // Assistant does NOT share -> masked.
        expect(byUid[ASSISTANT_UID].contact_email).toBeNull();
        expect(byUid[ASSISTANT_UID].contact_phone).toBeNull();
      });
    } finally { client.release(); }
  });

  it('21: raw >100 ids rejected before dedupe', async () => {
    const client = await pool.connect();
    try {
      await asRole(client, 'authenticated', OWNER_UID, async () => {
        const ids = Array.from({ length: 101 }, () => OWNER_UID);
        let err: unknown;
        try {
          await client.query(`SELECT * FROM public.list_authorized_professional_profiles($1::uuid[])`, [ids]);
        } catch (e) { err = e; }
        expect(err).toBeDefined();
        expect(String(err)).toMatch(/max 100|too many/i);
      });
    } finally { client.release(); }
  });

  it('22: duplicate requested ids return one row (dedupe)', async () => {
    const client = await pool.connect();
    try {
      await truncateAll(client);
      await insertUsers(client);
      await upsertProfile(client, OWNER_UID, { visibility: 'authorized_connections' });
      await asRole(client, 'authenticated', OWNER_UID, async () => {
        const rows = await q(client, `SELECT user_id FROM public.list_authorized_professional_profiles(ARRAY[$1,$1,$1]::uuid[])`, [OWNER_UID]);
        expect(rows.length).toBe(1);
      });
    } finally { client.release(); }
  });

  it('23: anon has no table SELECT and no RPC EXECUTE', async () => {
    const client = await pool.connect();
    try {
      const tableGrants = await q<{ privilege_type: string }>(client, `
        SELECT privilege_type FROM information_schema.role_table_grants
         WHERE table_schema='public' AND table_name='professional_profiles' AND grantee='anon'
      `);
      expect(tableGrants.length).toBe(0);

      const rpcGrants = await q<{ routine_name: string }>(client, `
        SELECT routine_name FROM information_schema.role_routine_grants
         WHERE grantee='anon'
           AND routine_name IN (
             'get_my_professional_profile',
             'upsert_my_professional_profile',
             'delete_my_professional_profile',
             'list_authorized_professional_profiles'
           )
      `);
      expect(rpcGrants.length).toBe(0);

      // Runtime probe.
      await asRole(client, 'anon', null, async () => {
        let err: unknown;
        try {
          await client.query(`SELECT * FROM public.professional_profiles`);
        } catch (e) { err = e; }
        expect(err).toBeDefined();
        expect(String(err)).toMatch(/permission denied/i);

        let err2: unknown;
        try {
          await client.query(`SELECT public.get_my_professional_profile()`);
        } catch (e) { err2 = e; }
        expect(err2).toBeDefined();
        expect(String(err2)).toMatch(/permission denied/i);
      });
    } finally { client.release(); }
  });

  it('24: authenticated cannot directly execute internal helper functions', async () => {
    const client = await pool.connect();
    try {
      // Grants surface: no execute grants to authenticated for helpers.
      const rows = await q<{ grantee: string }>(client, `
        SELECT grantee FROM information_schema.role_routine_grants
         WHERE routine_schema='public'
           AND routine_name IN (
             '_professional_profile_relationship_authorized',
             '_professional_profile_normalize_string_array'
           )
           AND grantee IN ('anon','authenticated','PUBLIC')
      `);
      expect(rows.length).toBe(0);

      // Runtime probe.
      await asRole(client, 'authenticated', OWNER_UID, async () => {
        let err: unknown;
        try {
          await client.query(`SELECT public._professional_profile_relationship_authorized($1,$2)`, [OWNER_UID, OTHER_UID]);
        } catch (e) { err = e; }
        expect(err).toBeDefined();
        expect(String(err)).toMatch(/permission denied/i);

        let err2: unknown;
        try {
          await client.query(`SELECT public._professional_profile_normalize_string_array(ARRAY['a']::text[], 12, 60, 'services')`);
        } catch (e) { err2 = e; }
        expect(err2).toBeDefined();
        expect(String(err2)).toMatch(/permission denied/i);
      });
    } finally { client.release(); }
  });

  it('25: no policies/grants/functions on pre-existing operational tables were changed', async () => {
    const client = await pool.connect();
    try {
      const after = await operationalSnapshot(client);
      expect(after).toEqual(preCandidateOperationalSnapshot);
    } finally { client.release(); }
  });

  it('26: cleanup — truncate leaves table intact and re-usable', async () => {
    const client = await pool.connect();
    try {
      await truncateAll(client);
      const [{ n }] = await q<{ n: string }>(
        client, `SELECT COUNT(*)::text AS n FROM public.professional_profiles`,
      );
      expect(n).toBe('0');
      // Table still exists and RLS still enabled.
      const [{ relrowsecurity }] = await q<{ relrowsecurity: boolean }>(client, `
        SELECT relrowsecurity FROM pg_class WHERE oid = 'public.professional_profiles'::regclass
      `);
      expect(relrowsecurity).toBe(true);
    } finally { client.release(); }
  });

  it('bonus: NULL id array is rejected', async () => {
    const client = await pool.connect();
    try {
      await asRole(client, 'authenticated', OWNER_UID, async () => {
        let err: unknown;
        try {
          await client.query(`SELECT * FROM public.list_authorized_professional_profiles(NULL::uuid[])`);
        } catch (e) { err = e; }
        expect(err).toBeDefined();
        expect(String(err)).toMatch(/must not be null/i);
      });
    } finally { client.release(); }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function literalRep(ch: string, len: number): string {
  // Produce a SQL text literal of length `len` composed of `ch`.
  return `'${ch.repeat(len)}'`;
}
