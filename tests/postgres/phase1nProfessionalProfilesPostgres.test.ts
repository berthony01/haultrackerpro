/**
 * Phase 1N-D — real PostgreSQL 16 gate for the shared Professional Profile
 * foundation candidate.
 *
 * The suite executes the exact candidate file from disk, never skips without
 * PHASE1N_PROFESSIONAL_PROFILE_DATABASE_URL, and cleans every fixture object
 * from the ephemeral database in afterAll.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

const DATABASE_URL =
  process.env.PHASE1N_PROFESSIONAL_PROFILE_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'PHASE1N_PROFESSIONAL_PROFILE_DATABASE_URL is required for the ' +
      'Phase 1N-D PostgreSQL 16 gate. This suite must never be skipped.',
  );
}

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CANDIDATE_PATH =
  REPO_ROOT +
  'supabase/migration-candidates/' +
  '20260723020000_phase1n_d_professional_profile_foundation.sql';
const CANDIDATE_SQL = readFileSync(CANDIDATE_PATH, 'utf8');

const CLEANUP_SQL = `
DROP TABLE IF EXISTS public.professional_profiles CASCADE;
DROP FUNCTION IF EXISTS public.get_my_professional_profile() CASCADE;
DROP FUNCTION IF EXISTS public.upsert_my_professional_profile(
  text,text,text,smallint,text[],text[],text,text,text,text,boolean
) CASCADE;
DROP FUNCTION IF EXISTS public.delete_my_professional_profile() CASCADE;
DROP FUNCTION IF EXISTS public.list_authorized_professional_profiles(uuid[])
  CASCADE;
DROP FUNCTION IF EXISTS
  public._professional_profile_relationship_authorized(uuid,uuid) CASCADE;
DROP FUNCTION IF EXISTS
  public._professional_profile_normalize_string_array(
    text[],integer,integer,text
  ) CASCADE;
DROP FUNCTION IF EXISTS
  public._professional_profile_string_array_is_canonical(
    text[],integer,integer
  ) CASCADE;

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

DO $cleanup$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REASSIGN OWNED BY authenticated TO CURRENT_USER';
    EXECUTE 'DROP OWNED BY authenticated';
    EXECUTE 'DROP ROLE authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REASSIGN OWNED BY anon TO CURRENT_USER';
    EXECUTE 'DROP OWNED BY anon';
    EXECUTE 'DROP ROLE anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REASSIGN OWNED BY service_role TO CURRENT_USER';
    EXECUTE 'DROP OWNED BY service_role';
    EXECUTE 'DROP ROLE service_role';
  END IF;
END
$cleanup$;
`;

const FIXTURE_SQL = `
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
AS $uid$
  SELECT NULLIF(
    current_setting('request.jwt.claim.sub', true),
    ''
  )::uuid
$uid$;
GRANT EXECUTE ON FUNCTION auth.uid()
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $updated$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$updated$;

CREATE TYPE public.assistant_status
  AS ENUM ('pending', 'active', 'revoked', 'expired');
CREATE TABLE public.driver_assistants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL,
  assistant_user_id uuid,
  invite_email text NOT NULL,
  status public.assistant_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.driver_assistants TO authenticated;
GRANT ALL ON public.driver_assistants TO service_role;
ALTER TABLE public.driver_assistants ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_assistants_driver_select
  ON public.driver_assistants
  FOR SELECT TO authenticated
  USING (driver_user_id = auth.uid());
CREATE TRIGGER driver_assistants_updated_at
  BEFORE UPDATE ON public.driver_assistants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TYPE public.agency_status AS ENUM ('active', 'disabled');
CREATE TYPE public.agency_member_status
  AS ENUM ('pending', 'active', 'revoked');

CREATE TABLE public.agency_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  name text NOT NULL,
  status public.agency_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.agency_profiles TO authenticated;
GRANT ALL ON public.agency_profiles TO service_role;
ALTER TABLE public.agency_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY agency_profiles_owner_all
  ON public.agency_profiles
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());
CREATE TRIGGER agency_profiles_updated_at
  BEFORE UPDATE ON public.agency_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.agency_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL
    REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  member_user_id uuid,
  invite_email text NOT NULL,
  status public.agency_member_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.agency_members TO authenticated;
GRANT ALL ON public.agency_members TO service_role;
ALTER TABLE public.agency_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY agency_members_self_select
  ON public.agency_members
  FOR SELECT TO authenticated
  USING (member_user_id = auth.uid());
CREATE TRIGGER agency_members_updated_at
  BEFORE UPDATE ON public.agency_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TYPE public.agency_delegation_status AS ENUM (
  'pending_driver_approval',
  'approved',
  'declined',
  'revoked',
  'expired'
);
CREATE TABLE public.agency_delegation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL
    REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  member_invite_email text NOT NULL,
  status public.agency_delegation_status NOT NULL
    DEFAULT 'pending_driver_approval',
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.agency_delegation_requests TO authenticated;
GRANT ALL ON public.agency_delegation_requests TO service_role;
ALTER TABLE public.agency_delegation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY agency_delegation_driver_select
  ON public.agency_delegation_requests
  FOR SELECT TO authenticated
  USING (driver_user_id = auth.uid());
CREATE TRIGGER agency_delegation_requests_updated_at
  BEFORE UPDATE ON public.agency_delegation_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
`;

const DRIVER = '11111111-1111-4111-8111-111111111111';
const UNRELATED = '22222222-2222-4222-8222-222222222222';

const ASSIST_ACTIVE = '30000000-0000-4000-8000-000000000001';
const ASSIST_PENDING = '30000000-0000-4000-8000-000000000002';
const ASSIST_REVOKED = '30000000-0000-4000-8000-000000000003';
const ASSIST_EXPIRED = '30000000-0000-4000-8000-000000000004';

const AGENCY_OWNER = '40000000-0000-4000-8000-000000000001';
const MEMBER_ACTIVE = '40000000-0000-4000-8000-000000000002';
const MEMBER_PENDING = '40000000-0000-4000-8000-000000000003';
const MEMBER_REVOKED = '40000000-0000-4000-8000-000000000004';
const DISABLED_OWNER = '40000000-0000-4000-8000-000000000005';
const DISABLED_MEMBER = '40000000-0000-4000-8000-000000000006';

const DELEG_PENDING = '50000000-0000-4000-8000-000000000001';
const DELEG_APPROVED = '50000000-0000-4000-8000-000000000002';
const DELEG_DECLINED = '50000000-0000-4000-8000-000000000003';
const DELEG_REVOKED = '50000000-0000-4000-8000-000000000004';
const DELEG_EXPIRED = '50000000-0000-4000-8000-000000000005';

const ALL_USERS = [
  DRIVER,
  UNRELATED,
  ASSIST_ACTIVE,
  ASSIST_PENDING,
  ASSIST_REVOKED,
  ASSIST_EXPIRED,
  AGENCY_OWNER,
  MEMBER_ACTIVE,
  MEMBER_PENDING,
  MEMBER_REVOKED,
  DISABLED_OWNER,
  DISABLED_MEMBER,
  DELEG_PENDING,
  DELEG_APPROVED,
  DELEG_DECLINED,
  DELEG_REVOKED,
  DELEG_EXPIRED,
];

const ACTIVE_AGENCY = 'a0000000-0000-4000-8000-000000000001';
const DISABLED_AGENCY = 'a0000000-0000-4000-8000-000000000002';
const DELEGATION_AGENCY = 'a0000000-0000-4000-8000-000000000003';

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 1,
});

async function q<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  client: PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await client.query(sql, params);
  return result.rows as T[];
}

async function setLocalIdentity(
  client: PoolClient,
  role: 'authenticated' | 'anon' | 'service_role',
  uid: string | null,
): Promise<void> {
  await client.query(`SET LOCAL ROLE ${role}`);
  await client.query(
    `SELECT set_config('request.jwt.claim.sub', $1, true)`,
    [uid ?? ''],
  );
}

async function asRoleRollback<T>(
  client: PoolClient,
  role: 'authenticated' | 'anon' | 'service_role',
  uid: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await setLocalIdentity(client, role, uid);
    const value = await fn();
    await client.query('ROLLBACK');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function asRoleCommit<T>(
  client: PoolClient,
  role: 'authenticated' | 'service_role',
  uid: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await setLocalIdentity(client, role, uid);
    const value = await fn();
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function expectDbError(
  client: PoolClient,
  role: 'authenticated' | 'anon' | 'service_role',
  uid: string | null,
  sql: string,
  params: unknown[] = [],
  pattern: RegExp = /./,
): Promise<void> {
  await asRoleRollback(client, role, uid, async () => {
    let caught: unknown;
    try {
      await client.query(sql, params);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(String(caught)).toMatch(pattern);
  });
}

async function insertUsers(client: PoolClient): Promise<void> {
  for (const uid of ALL_USERS) {
    await client.query(
      `INSERT INTO auth.users(id, email)
       VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [uid, `${uid}@example.test`],
    );
  }
}

async function truncateApplicationRows(
  client: PoolClient,
): Promise<void> {
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

type ProfileInput = {
  displayName?: string;
  title?: string | null;
  bio?: string | null;
  years?: number | null;
  services?: string[];
  serviceAreas?: string[];
  availability?: 'available' | 'limited' | 'unavailable';
  email?: string | null;
  phone?: string | null;
  visibility?: 'private' | 'authorized_connections';
  share?: boolean;
};

async function upsertProfile(
  client: PoolClient,
  uid: string,
  input: ProfileInput = {},
): Promise<void> {
  const profile = {
    displayName: 'Test Professional',
    title: null,
    bio: null,
    years: null,
    services: [] as string[],
    serviceAreas: [] as string[],
    availability: 'available',
    email: null,
    phone: null,
    visibility: 'private',
    share: false,
    ...input,
  };

  await asRoleCommit(
    client,
    'authenticated',
    uid,
    async () => {
      await client.query(
        `SELECT public.upsert_my_professional_profile(
          $1,
          $2,
          $3,
          $4::smallint,
          $5::text[],
          $6::text[],
          $7,
          $8,
          $9,
          $10,
          $11
        )`,
        [
          profile.displayName,
          profile.title,
          profile.bio,
          profile.years,
          profile.services,
          profile.serviceAreas,
          profile.availability,
          profile.email,
          profile.phone,
          profile.visibility,
          profile.share,
        ],
      );
    },
  );
}

async function operationalSnapshot(
  client: PoolClient,
): Promise<string> {
  const tables = [
    'driver_assistants',
    'agency_profiles',
    'agency_members',
    'agency_delegation_requests',
  ];

  const policies = await q(client, `
    SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY($1)
    ORDER BY tablename, policyname
  `, [tables]);

  const grants = await q(client, `
    SELECT table_name, grantee, privilege_type, is_grantable
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = ANY($1)
      AND grantee IN ('anon', 'authenticated', 'service_role')
    ORDER BY table_name, grantee, privilege_type
  `, [tables]);

  const triggers = await q(client, `
    SELECT
      c.relname AS table_name,
      t.tgname AS trigger_name,
      pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY($1)
      AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname
  `, [tables]);

  const functions = await q(client, `
    SELECT
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments,
      pg_get_functiondef(p.oid) AS definition,
      COALESCE(p.proacl::text, '') AS acl
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'update_updated_at_column'
    ORDER BY p.proname, identity_arguments
  `);

  return JSON.stringify({
    policies,
    grants,
    triggers,
    functions,
  });
}

async function seedRelationships(
  client: PoolClient,
): Promise<void> {
  await asRoleCommit(
    client,
    'service_role',
    null,
    async () => {
      for (const [assistant, status] of [
        [ASSIST_ACTIVE, 'active'],
        [ASSIST_PENDING, 'pending'],
        [ASSIST_REVOKED, 'revoked'],
        [ASSIST_EXPIRED, 'expired'],
      ] as const) {
        await client.query(
          `INSERT INTO public.driver_assistants(
             driver_user_id,
             assistant_user_id,
             invite_email,
             status
           ) VALUES ($1, $2, $3, $4)`,
          [DRIVER, assistant, `${assistant}@example.test`, status],
        );
      }

      await client.query(
        `INSERT INTO public.agency_profiles(
           id, owner_user_id, name, status
         ) VALUES
           ($1, $2, 'Active Agency', 'active'),
           ($3, $4, 'Disabled Agency', 'disabled'),
           ($5, $2, 'Delegation Agency', 'active')`,
        [
          ACTIVE_AGENCY,
          AGENCY_OWNER,
          DISABLED_AGENCY,
          DISABLED_OWNER,
          DELEGATION_AGENCY,
        ],
      );

      for (const [member, status] of [
        [DRIVER, 'active'],
        [MEMBER_ACTIVE, 'active'],
        [MEMBER_PENDING, 'pending'],
        [MEMBER_REVOKED, 'revoked'],
      ] as const) {
        await client.query(
          `INSERT INTO public.agency_members(
             agency_id,
             member_user_id,
             invite_email,
             status
           ) VALUES ($1, $2, $3, $4)`,
          [ACTIVE_AGENCY, member, `${member}@example.test`, status],
        );
      }

      for (const member of [DRIVER, DISABLED_MEMBER]) {
        await client.query(
          `INSERT INTO public.agency_members(
             agency_id,
             member_user_id,
             invite_email,
             status
           ) VALUES ($1, $2, $3, 'active')`,
          [DISABLED_AGENCY, member, `${member}@example.test`],
        );
      }

      for (const [member, status] of [
        [DELEG_PENDING, 'pending_driver_approval'],
        [DELEG_APPROVED, 'approved'],
        [DELEG_DECLINED, 'declined'],
        [DELEG_REVOKED, 'revoked'],
        [DELEG_EXPIRED, 'expired'],
      ] as const) {
        await client.query(
          `INSERT INTO public.agency_delegation_requests(
             agency_id,
             driver_user_id,
             member_user_id,
             member_invite_email,
             status,
             created_by_user_id
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            DELEGATION_AGENCY,
            DRIVER,
            member,
            `${member}@example.test`,
            status,
            AGENCY_OWNER,
          ],
        );
      }
    },
  );
}

async function addAuthorizedProfiles(
  client: PoolClient,
  users: string[],
): Promise<void> {
  for (const uid of users) {
    await upsertProfile(client, uid, {
      displayName: `Professional ${uid.slice(-4)}`,
      visibility: 'authorized_connections',
    });
  }
}

let preCandidateSnapshot = '';

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query(CLEANUP_SQL);
    await client.query(FIXTURE_SQL);
    await insertUsers(client);
    preCandidateSnapshot = await operationalSnapshot(client);
    await client.query(CANDIDATE_SQL);
  } finally {
    client.release();
  }
});

beforeEach(async () => {
  const client = await pool.connect();
  try {
    await truncateApplicationRows(client);
  } finally {
    client.release();
  }
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    await client.query(CLEANUP_SQL);
    const [state] = await q<{
      table_gone: boolean;
      auth_gone: boolean;
      roles_gone: boolean;
    }>(client, `
      SELECT
        to_regclass('public.professional_profiles') IS NULL AS table_gone,
        NOT EXISTS (
          SELECT 1 FROM pg_namespace WHERE nspname = 'auth'
        ) AS auth_gone,
        NOT EXISTS (
          SELECT 1
          FROM pg_roles
          WHERE rolname IN ('anon', 'authenticated', 'service_role')
        ) AS roles_gone
    `);
    expect(state).toEqual({
      table_gone: true,
      auth_gone: true,
      roles_gone: true,
    });
  } finally {
    client.release();
    await pool.end();
  }
});

describe('Phase 1N-D Professional Profiles — PostgreSQL 16', () => {
  it('requires PostgreSQL major version 16', async () => {
    const client = await pool.connect();
    try {
      const [row] = await q<{ version_num: string }>(client, `
        SELECT current_setting('server_version_num') AS version_num
      `);
      expect(Math.floor(Number(row.version_num) / 10000)).toBe(16);
    } finally {
      client.release();
    }
  });

  it('creates the exact table shape, RLS, vocabularies, and primary key', async () => {
    const client = await pool.connect();
    try {
      const columns = await q<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(client, `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'professional_profiles'
        ORDER BY ordinal_position
      `);

      expect(columns.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
      ])).toEqual([
        ['user_id', 'uuid', 'NO'],
        ['display_name', 'text', 'NO'],
        ['professional_title', 'text', 'YES'],
        ['bio', 'text', 'YES'],
        ['years_experience', 'smallint', 'YES'],
        ['services', 'ARRAY', 'NO'],
        ['service_areas', 'ARRAY', 'NO'],
        ['availability', 'text', 'NO'],
        ['contact_email', 'text', 'YES'],
        ['contact_phone', 'text', 'YES'],
        ['visibility', 'text', 'NO'],
        ['share_contact_details', 'boolean', 'NO'],
        ['created_at', 'timestamp with time zone', 'NO'],
        ['updated_at', 'timestamp with time zone', 'NO'],
      ]);

      const [table] = await q<{
        relrowsecurity: boolean;
        primary_keys: string;
      }>(client, `
        SELECT
          c.relrowsecurity,
          (
            SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
            FROM pg_constraint pk
            JOIN unnest(pk.conkey) AS key(attnum) ON true
            JOIN pg_attribute a
              ON a.attrelid = pk.conrelid
             AND a.attnum = key.attnum
            WHERE pk.conrelid = c.oid
              AND pk.contype = 'p'
          ) AS primary_keys
        FROM pg_class c
        WHERE c.oid = 'public.professional_profiles'::regclass
      `);
      expect(table.relrowsecurity).toBe(true);
      expect(table.primary_keys).toBe('user_id');

      const checks = await q<{ definition: string }>(client, `
        SELECT pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        WHERE con.conrelid = 'public.professional_profiles'::regclass
          AND con.contype = 'c'
        ORDER BY con.conname
      `);
      const definitions = checks.map((check) => check.definition).join('\n');
      expect(definitions).toContain('available');
      expect(definitions).toContain('limited');
      expect(definitions).toContain('unavailable');
      expect(definitions).toContain('private');
      expect(definitions).toContain('authorized_connections');
      expect(definitions).toContain(
        '_professional_profile_string_array_is_canonical',
      );
      expect(definitions).toContain('share_contact_details');
    } finally {
      client.release();
    }
  });

  it('enforces one row per auth user through the caller-only upsert', async () => {
    const client = await pool.connect();
    try {
      await upsertProfile(client, DRIVER, { displayName: 'First Name' });
      await upsertProfile(client, DRIVER, { displayName: 'Second Name' });

      const [row] = await q<{ count: string; display_name: string }>(
        client,
        `SELECT count(*)::text AS count, max(display_name) AS display_name
         FROM public.professional_profiles
         WHERE user_id = $1`,
        [DRIVER],
      );
      expect(row.count).toBe('1');
      expect(row.display_name).toBe('Second Name');
    } finally {
      client.release();
    }
  });

  it('allows authenticated direct SELECT only for the caller row', async () => {
    const client = await pool.connect();
    try {
      await upsertProfile(client, DRIVER);
      await upsertProfile(client, UNRELATED);

      const rows = await asRoleRollback(
        client,
        'authenticated',
        DRIVER,
        () => q<{ user_id: string }>(
          client,
          `SELECT user_id FROM public.professional_profiles ORDER BY user_id`,
        ),
      );
      expect(rows.map((row) => row.user_id)).toEqual([DRIVER]);
    } finally {
      client.release();
    }
  });

  it('denies authenticated direct INSERT, UPDATE, and DELETE', async () => {
    const client = await pool.connect();
    try {
      await upsertProfile(client, DRIVER);

      const grants = await q<{ privilege_type: string }>(client, `
        SELECT privilege_type
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'professional_profiles'
          AND grantee = 'authenticated'
        ORDER BY privilege_type
      `);
      expect(grants.map((grant) => grant.privilege_type)).toEqual(['SELECT']);

      await expectDbError(
        client,
        'authenticated',
        UNRELATED,
        `INSERT INTO public.professional_profiles(
           user_id, display_name, availability
         ) VALUES ($1, 'Valid Name', 'available')`,
        [UNRELATED],
        /permission denied/i,
      );
      await expectDbError(
        client,
        'authenticated',
        DRIVER,
        `UPDATE public.professional_profiles
         SET display_name = 'Changed Name'
         WHERE user_id = $1`,
        [DRIVER],
        /permission denied/i,
      );
      await expectDbError(
        client,
        'authenticated',
        DRIVER,
        `DELETE FROM public.professional_profiles WHERE user_id = $1`,
        [DRIVER],
        /permission denied/i,
      );
    } finally {
      client.release();
    }
  });

  it('provides owner-only create, read, update, and delete RPC behavior', async () => {
    const client = await pool.connect();
    try {
      await asRoleRollback(client, 'authenticated', DRIVER, async () => {
        const created = await q<{ display_name: string }>(
          client,
          `SELECT display_name
           FROM public.upsert_my_professional_profile(
             'Owner Name', 'Dispatch Professional', 'Professional bio',
             8::smallint, ARRAY['Dispatch']::text[], ARRAY['Texas']::text[],
             'available', 'owner@example.test', '555-0100', 'private', false
           )`,
        );
        expect(created[0].display_name).toBe('Owner Name');

        const read = await q<{ display_name: string }>(
          client,
          `SELECT display_name FROM public.get_my_professional_profile()`,
        );
        expect(read[0].display_name).toBe('Owner Name');

        const updated = await q<{
          display_name: string;
          availability: string;
        }>(
          client,
          `SELECT display_name, availability
           FROM public.upsert_my_professional_profile(
             'Updated Owner', NULL, NULL, NULL::smallint,
             '{}'::text[], '{}'::text[], 'limited',
             NULL, NULL, 'private', false
           )`,
        );
        expect(updated[0]).toMatchObject({
          display_name: 'Updated Owner',
          availability: 'limited',
        });

        const deleted = await q<{ deleted: boolean }>(
          client,
          `SELECT public.delete_my_professional_profile() AS deleted`,
        );
        expect(deleted[0].deleted).toBe(true);
        const deletedAgain = await q<{ deleted: boolean }>(
          client,
          `SELECT public.delete_my_professional_profile() AS deleted`,
        );
        expect(deletedAgain[0].deleted).toBe(false);
      });
    } finally {
      client.release();
    }
  });

  it('has no self-write RPC overload that accepts a target user id', async () => {
    const client = await pool.connect();
    try {
      const functions = await q<{
        proname: string;
        arguments: string;
      }>(client, `
        SELECT p.proname, pg_get_function_arguments(p.oid) AS arguments
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'get_my_professional_profile',
            'upsert_my_professional_profile',
            'delete_my_professional_profile'
          )
        ORDER BY p.proname, arguments
      `);

      expect(functions).toHaveLength(3);
      for (const fn of functions) {
        expect(fn.arguments).not.toMatch(
          /\b(user_id|target_user_id|p_user_id)\b/i,
        );
      }
      await expectDbError(
        client,
        'authenticated',
        DRIVER,
        `SELECT public.delete_my_professional_profile($1::uuid)`,
        [UNRELATED],
        /does not exist/i,
      );
    } finally {
      client.release();
    }
  });

  it('normalizes contact sharing fail-closed', async () => {
    const client = await pool.connect();
    try {
      await asRoleRollback(client, 'authenticated', DRIVER, async () => {
        const privateRow = await q<{
          visibility: string;
          share_contact_details: boolean;
        }>(
          client,
          `SELECT visibility, share_contact_details
           FROM public.upsert_my_professional_profile(
             'Valid Name', NULL, NULL, NULL::smallint,
             '{}'::text[], '{}'::text[], 'available',
             NULL, NULL, 'private', true
           )`,
        );
        expect(privateRow[0]).toMatchObject({
          visibility: 'private',
          share_contact_details: false,
        });

        const authorizedRow = await q<{
          visibility: string;
          share_contact_details: boolean;
        }>(
          client,
          `SELECT visibility, share_contact_details
           FROM public.upsert_my_professional_profile(
             'Valid Name', NULL, NULL, NULL::smallint,
             '{}'::text[], '{}'::text[], 'available',
             NULL, NULL, 'authorized_connections', false
           )`,
        );
        expect(authorizedRow[0]).toMatchObject({
          visibility: 'authorized_connections',
          share_contact_details: false,
        });
      });
    } finally {
      client.release();
    }
  });

  it('validates RPC scalar and array limits and preserves trim/dedupe order', async () => {
    const client = await pool.connect();
    try {
      const invalidCalls: Array<[string, RegExp]> = [
        [
          `SELECT public.upsert_my_professional_profile(
             'A', NULL, NULL, NULL::smallint,
             '{}'::text[], '{}'::text[], 'available',
             NULL, NULL, 'private', false
           )`,
          /display_name/i,
        ],
        [
          `SELECT public.upsert_my_professional_profile(
             repeat('n', 81), NULL, NULL, NULL::smallint,
             '{}'::text[], '{}'::text[], 'available',
             NULL, NULL, 'private', false
           )`,
          /display_name/i,
        ],
        [
          `SELECT public.upsert_my_professional_profile(
             'Valid', repeat('t', 121), NULL, NULL::smallint,
             '{}'::text[], '{}'::text[], 'available',
             NULL, NULL, 'private', false
           )`,
          /professional_title/i,
        ],
        [
          `SELECT public.upsert_my_professional_profile(
             'Valid', NULL, repeat('b', 1001), NULL::smallint,
             '{}'::text[], '{}'::text[], 'available',
             NULL, NULL, 'private', false
           )`,
          /bio/i,
        ],
        [
          `SELECT public.upsert_my_professional_profile(
             'Valid', NULL, NULL, 71::smallint,
             '{}'::text[], '{}'::text[], 'available',
             NULL, NULL, 'private', false
           )`,
          /years_experience/i,
        ],
        [
          `SELECT public.upsert_my_professional_profile(
             'Valid', NULL, NULL, (-1)::smallint,
             '{}'::text[], '{}'::text[], 'available',
             NULL, NULL, 'private', false
           )`,
          /years_experience/i,
        ],
        [
          `SELECT public.upsert_my_professional_profile(
             'Valid', NULL, NULL, NULL::smallint,
             '{}'::text[], '{}'::text[], 'available',
             repeat('e', 321), NULL, 'private', false
           )`,
          /contact_email/i,
        ],
        [
          `SELECT public.upsert_my_professional_profile(
             'Valid', NULL, NULL, NULL::smallint,
             '{}'::text[], '{}'::text[], 'available',
             NULL, repeat('p', 41), 'private', false
           )`,
          /contact_phone/i,
        ],
        [
          `SELECT public.upsert_my_professional_profile(
             'Valid', NULL, NULL, NULL::smallint,
             '{}'::text[], '{}'::text[], 'sometimes',
             NULL, NULL, 'private', false
           )`,
          /availability/i,
        ],
        [
          `SELECT public.upsert_my_professional_profile(
             'Valid', NULL, NULL, NULL::smallint,
             '{}'::text[], '{}'::text[], 'available',
             NULL, NULL, 'public', false
           )`,
          /visibility/i,
        ],
        [
          `SELECT public.upsert_my_professional_profile(
             'Valid', NULL, NULL, NULL::smallint,
             ARRAY['x','x','x','x','x','x','x','x','x','x','x','x','x']::text[],
             '{}'::text[], 'available', NULL, NULL, 'private', false
           )`,
          /services/i,
        ],
        [
          `SELECT public.upsert_my_professional_profile(
             'Valid', NULL, NULL, NULL::smallint,
             '{}'::text[], ARRAY['1','2','3','4','5','6','7','8','9','10','11','12','13']::text[],
             'available', NULL, NULL, 'private', false
           )`,
          /service_areas/i,
        ],
        [
          `SELECT public.upsert_my_professional_profile(
             'Valid', NULL, NULL, NULL::smallint,
             ARRAY[repeat('s', 61)]::text[], '{}'::text[],
             'available', NULL, NULL, 'private', false
           )`,
          /services/i,
        ],
        [
          `SELECT public.upsert_my_professional_profile(
             'Valid', NULL, NULL, NULL::smallint,
             '{}'::text[], ARRAY[repeat('a', 81)]::text[],
             'available', NULL, NULL, 'private', false
           )`,
          /service_areas/i,
        ],
      ];

      for (const [statement, pattern] of invalidCalls) {
        await expectDbError(client, 'authenticated', DRIVER, statement, [], pattern);
      }

      await asRoleRollback(client, 'authenticated', DRIVER, async () => {
        const [row] = await q<{
          display_name: string;
          professional_title: string;
          services: string[];
          service_areas: string[];
        }>(
          client,
          `SELECT display_name, professional_title, services, service_areas
           FROM public.upsert_my_professional_profile(
             '  Trimmed Name  ', '  Specialist  ', NULL, NULL::smallint,
             ARRAY[' Dispatch ', 'dispatch', '', NULL, 'Bookkeeping']::text[],
             ARRAY[' Texas ', 'texas', 'USA']::text[],
             'available', NULL, NULL, 'private', false
           )`,
        );
        expect(row).toMatchObject({
          display_name: 'Trimmed Name',
          professional_title: 'Specialist',
          services: ['Dispatch', 'Bookkeeping'],
          service_areas: ['Texas', 'USA'],
        });
      });
    } finally {
      client.release();
    }
  });

  it('enforces canonical strings and arrays at the table CHECK layer', async () => {
    const client = await pool.connect();
    try {
      const directInvalid: Array<[string, RegExp]> = [
        [
          `INSERT INTO public.professional_profiles(user_id, display_name, availability)
           VALUES ($1, ' Padded Name ', 'available')`,
          /check constraint/i,
        ],
        [
          `INSERT INTO public.professional_profiles(user_id, display_name, professional_title, availability)
           VALUES ($1, 'Valid Name', ' Padded ', 'available')`,
          /check constraint/i,
        ],
        [
          `INSERT INTO public.professional_profiles(user_id, display_name, services, availability)
           VALUES ($1, 'Valid Name', ARRAY['']::text[], 'available')`,
          /check constraint/i,
        ],
        [
          `INSERT INTO public.professional_profiles(user_id, display_name, services, availability)
           VALUES ($1, 'Valid Name', ARRAY[NULL]::text[], 'available')`,
          /check constraint/i,
        ],
        [
          `INSERT INTO public.professional_profiles(user_id, display_name, services, availability)
           VALUES ($1, 'Valid Name', ARRAY[' Dispatch ']::text[], 'available')`,
          /check constraint/i,
        ],
        [
          `INSERT INTO public.professional_profiles(user_id, display_name, services, availability)
           VALUES ($1, 'Valid Name', ARRAY['Dispatch', 'dispatch']::text[], 'available')`,
          /check constraint/i,
        ],
        [
          `INSERT INTO public.professional_profiles(user_id, display_name, services, availability)
           VALUES ($1, 'Valid Name', ARRAY[repeat('s', 61)]::text[], 'available')`,
          /check constraint/i,
        ],
        [
          `INSERT INTO public.professional_profiles(user_id, display_name, service_areas, availability)
           VALUES ($1, 'Valid Name', ARRAY[repeat('a', 81)]::text[], 'available')`,
          /check constraint/i,
        ],
      ];

      for (const [statement, pattern] of directInvalid) {
        await expectDbError(client, 'service_role', null, statement, [DRIVER], pattern);
      }

      await asRoleRollback(client, 'service_role', null, async () => {
        await client.query(
          `INSERT INTO public.professional_profiles(
             user_id, display_name, services, service_areas, availability
           ) VALUES (
             $1, 'Valid Name', ARRAY['Dispatch', 'Bookkeeping']::text[],
             ARRAY['Texas']::text[], 'available'
           )`,
          [DRIVER],
        );
      });
    } finally {
      client.release();
    }
  });

  it('allows a driver to view only an active direct assistant profile', async () => {
    const client = await pool.connect();
    try {
      await seedRelationships(client);
      await addAuthorizedProfiles(client, [
        DRIVER,
        ASSIST_ACTIVE,
        ASSIST_PENDING,
        ASSIST_REVOKED,
        ASSIST_EXPIRED,
      ]);

      const rows = await asRoleRollback(
        client,
        'authenticated',
        DRIVER,
        () => q<{ user_id: string }>(
          client,
          `SELECT user_id
           FROM public.list_authorized_professional_profiles(
             ARRAY[$1, $2, $3, $4]::uuid[]
           ) ORDER BY user_id`,
          [ASSIST_ACTIVE, ASSIST_PENDING, ASSIST_REVOKED, ASSIST_EXPIRED],
        ),
      );
      expect(rows.map((row) => row.user_id)).toEqual([ASSIST_ACTIVE]);

      const reverse = await asRoleRollback(
        client,
        'authenticated',
        ASSIST_ACTIVE,
        () => q(
          client,
          `SELECT user_id
           FROM public.list_authorized_professional_profiles(ARRAY[$1]::uuid[])`,
          [DRIVER],
        ),
      );
      expect(reverse).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('allows only active same-agency relationships in an active agency', async () => {
    const client = await pool.connect();
    try {
      await seedRelationships(client);
      await addAuthorizedProfiles(client, [
        DRIVER,
        AGENCY_OWNER,
        MEMBER_ACTIVE,
        MEMBER_PENDING,
        MEMBER_REVOKED,
        DISABLED_OWNER,
        DISABLED_MEMBER,
      ]);

      const driverView = await asRoleRollback(
        client,
        'authenticated',
        DRIVER,
        () => q<{ user_id: string }>(
          client,
          `SELECT user_id
           FROM public.list_authorized_professional_profiles(
             ARRAY[$1, $2, $3, $4, $5]::uuid[]
           ) ORDER BY user_id`,
          [
            AGENCY_OWNER,
            MEMBER_ACTIVE,
            MEMBER_PENDING,
            MEMBER_REVOKED,
            DISABLED_MEMBER,
          ],
        ),
      );
      expect(driverView.map((row) => row.user_id).sort()).toEqual(
        [AGENCY_OWNER, MEMBER_ACTIVE].sort(),
      );

      const ownerView = await asRoleRollback(
        client,
        'authenticated',
        AGENCY_OWNER,
        () => q<{ user_id: string }>(
          client,
          `SELECT user_id
           FROM public.list_authorized_professional_profiles(
             ARRAY[$1, $2, $3]::uuid[]
           ) ORDER BY user_id`,
          [DRIVER, MEMBER_ACTIVE, MEMBER_PENDING],
        ),
      );
      expect(ownerView.map((row) => row.user_id).sort()).toEqual(
        [DRIVER, MEMBER_ACTIVE].sort(),
      );
    } finally {
      client.release();
    }
  });

  it('allows pending-driver-approval and approved delegations only', async () => {
    const client = await pool.connect();
    try {
      await seedRelationships(client);
      await addAuthorizedProfiles(client, [
        DELEG_PENDING,
        DELEG_APPROVED,
        DELEG_DECLINED,
        DELEG_REVOKED,
        DELEG_EXPIRED,
      ]);

      const rows = await asRoleRollback(
        client,
        'authenticated',
        DRIVER,
        () => q<{ user_id: string }>(
          client,
          `SELECT user_id
           FROM public.list_authorized_professional_profiles(
             ARRAY[$1, $2, $3, $4, $5]::uuid[]
           ) ORDER BY user_id`,
          [
            DELEG_PENDING,
            DELEG_APPROVED,
            DELEG_DECLINED,
            DELEG_REVOKED,
            DELEG_EXPIRED,
          ],
        ),
      );
      expect(rows.map((row) => row.user_id).sort()).toEqual(
        [DELEG_PENDING, DELEG_APPROVED].sort(),
      );
    } finally {
      client.release();
    }
  });

  it('returns no row for unrelated or private connected targets', async () => {
    const client = await pool.connect();
    try {
      await seedRelationships(client);
      await upsertProfile(client, UNRELATED, {
        visibility: 'authorized_connections',
      });
      await upsertProfile(client, MEMBER_ACTIVE, { visibility: 'private' });

      const rows = await asRoleRollback(
        client,
        'authenticated',
        DRIVER,
        () => q(
          client,
          `SELECT user_id
           FROM public.list_authorized_professional_profiles(
             ARRAY[$1, $2]::uuid[]
           )`,
          [UNRELATED, MEMBER_ACTIVE],
        ),
      );
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('masks or returns contact fields according to explicit sharing', async () => {
    const client = await pool.connect();
    try {
      await seedRelationships(client);
      await upsertProfile(client, DRIVER, {
        visibility: 'private',
        email: 'driver@example.test',
        phone: '555-1000',
        share: false,
      });
      await upsertProfile(client, MEMBER_ACTIVE, {
        visibility: 'authorized_connections',
        email: 'shared@example.test',
        phone: '555-2000',
        share: true,
      });
      await upsertProfile(client, AGENCY_OWNER, {
        visibility: 'authorized_connections',
        email: 'masked@example.test',
        phone: '555-3000',
        share: false,
      });

      const rows = await asRoleRollback(
        client,
        'authenticated',
        DRIVER,
        () => q<{
          user_id: string;
          contact_email: string | null;
          contact_phone: string | null;
        }>(
          client,
          `SELECT user_id, contact_email, contact_phone
           FROM public.list_authorized_professional_profiles(
             ARRAY[$1, $2, $3]::uuid[]
           )`,
          [DRIVER, MEMBER_ACTIVE, AGENCY_OWNER],
        ),
      );
      const byUser = Object.fromEntries(rows.map((row) => [row.user_id, row]));

      expect(byUser[DRIVER]).toMatchObject({
        contact_email: 'driver@example.test',
        contact_phone: '555-1000',
      });
      expect(byUser[MEMBER_ACTIVE]).toMatchObject({
        contact_email: 'shared@example.test',
        contact_phone: '555-2000',
      });
      expect(byUser[AGENCY_OWNER]).toMatchObject({
        contact_email: null,
        contact_phone: null,
      });
    } finally {
      client.release();
    }
  });

  it('rejects null and raw arrays over 100 before dedupe, and dedupes ids', async () => {
    const client = await pool.connect();
    try {
      await upsertProfile(client, DRIVER);
      await expectDbError(
        client,
        'authenticated',
        DRIVER,
        `SELECT * FROM public.list_authorized_professional_profiles(NULL::uuid[])`,
        [],
        /must not be null/i,
      );
      await expectDbError(
        client,
        'authenticated',
        DRIVER,
        `SELECT * FROM public.list_authorized_professional_profiles($1::uuid[])`,
        [Array.from({ length: 101 }, () => DRIVER)],
        /100/,
      );

      const rows = await asRoleRollback(
        client,
        'authenticated',
        DRIVER,
        () => q(
          client,
          `SELECT user_id
           FROM public.list_authorized_professional_profiles(
             ARRAY[$1, $1, $1]::uuid[]
           )`,
          [DRIVER],
        ),
      );
      expect(rows).toHaveLength(1);
    } finally {
      client.release();
    }
  });

  it('denies anon table/RPC access and authenticated internal-helper execution', async () => {
    const client = await pool.connect();
    try {
      const anonTable = await q(client, `
        SELECT privilege_type
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'professional_profiles'
          AND grantee = 'anon'
      `);
      expect(anonTable).toHaveLength(0);

      await expectDbError(
        client,
        'anon',
        null,
        `SELECT * FROM public.professional_profiles`,
        [],
        /permission denied/i,
      );
      await expectDbError(
        client,
        'anon',
        null,
        `SELECT * FROM public.get_my_professional_profile()`,
        [],
        /permission denied/i,
      );

      const helpers: Array<{ statement: string; params: unknown[] }> = [
        {
          statement: `SELECT public._professional_profile_relationship_authorized(
            $1::uuid, $2::uuid
          )`,
          params: [DRIVER, UNRELATED],
        },
        {
          statement: `SELECT public._professional_profile_normalize_string_array(
            ARRAY['x']::text[], 12, 60, 'services'
          )`,
          params: [],
        },
        {
          statement: `SELECT public._professional_profile_string_array_is_canonical(
            ARRAY['x']::text[], 12, 60
          )`,
          params: [],
        },
      ];

      for (const helper of helpers) {
        await expectDbError(
          client,
          'authenticated',
          DRIVER,
          helper.statement,
          helper.params,
          /permission denied/i,
        );
      }
    } finally {
      client.release();
    }
  });

  it('does not change operational policies, grants, triggers, or helper definition/ACL', async () => {
    const client = await pool.connect();
    try {
      expect(await operationalSnapshot(client)).toBe(preCandidateSnapshot);
    } finally {
      client.release();
    }
  });

  it('leaves the candidate objects internally consistent before final cleanup', async () => {
    const client = await pool.connect();
    try {
      await upsertProfile(client, DRIVER, { displayName: 'Cleanup Check' });
      await truncateApplicationRows(client);

      const [row] = await q<{
        profile_count: string;
        rls_enabled: boolean;
      }>(client, `
        SELECT
          (SELECT count(*)::text FROM public.professional_profiles)
            AS profile_count,
          (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.professional_profiles'::regclass)
            AS rls_enabled
      `);
      expect(row).toEqual({ profile_count: '0', rls_enabled: true });
    } finally {
      client.release();
    }
  });
});
