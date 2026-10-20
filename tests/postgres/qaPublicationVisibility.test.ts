// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

// Execute production function definitions, not simplified permission mocks.
const dir = `${process.cwd()}/supabase/migrations`;
const sources = readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => readFileSync(`${dir}/${f}`, 'utf8'));
function productionFunction(name: string) {
  const pattern = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\([\\s\\S]*?AS (\\$[a-zA-Z0-9_]*\\$)[\\s\\S]*?\\1;`, 'gi');
  const definitions = sources.flatMap(sql => [...sql.matchAll(pattern)].map(m => m[0]));
  const definition = definitions.at(-1);
  if (!definition) throw new Error(`Missing production function ${name}`);
  return definition;
}
const migrationPath = `${process.cwd()}/supabase/migrations/20261020205248_qa_publication_visibility.sql`;
const sql = readFileSync(migrationPath, 'utf8');
const owner = '11111111-1111-1111-1111-111111111111';
const staff = '22222222-2222-2222-2222-222222222222';
const ordinary = '33333333-3333-3333-3333-333333333333';
const outsider = '44444444-4444-4444-4444-444444444444';
const qa = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const normal = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
let db: PGlite;
let registryAclBefore: unknown;
let registryPoliciesBefore: unknown;
async function read(user: string | null, recruiter = qa, role = 'authenticated') {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user ?? '']);
    return (await db.query('SELECT * FROM public.get_recruiter_qa_publication_context($1::uuid)', [recruiter])).rows;
  } finally { await db.exec('ROLLBACK'); }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth, public TO authenticated, anon, service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    CREATE TABLE public.admin_users(user_id uuid, role text);
    CREATE FUNCTION public.is_super_admin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=_user_id AND role='super_admin') $$;
    CREATE TYPE public.recruiter_workspace_permission AS ENUM('opportunities_view','opportunities_create','opportunities_edit','opportunities_change_status','opportunities_delete');
    CREATE TABLE public.recruiter_profiles(id uuid PRIMARY KEY,user_id uuid,status text DEFAULT 'active',verification_status text DEFAULT 'approved',
      recruiter_name text DEFAULT 'Recruiter',company_name text DEFAULT 'Company',recruiter_email text DEFAULT 'r@example.test',
      company_type text DEFAULT 'carrier',dot_number text DEFAULT '123',mc_number text,posting_terms_accepted_at timestamptz DEFAULT now(),legacy_terms_grandfathered_at timestamptz);
    CREATE TABLE public.recruiter_members(recruiter_id uuid,member_user_id uuid,status text,role text,permissions jsonb,invite_expires_at timestamptz);
    CREATE TABLE public.recruiter_billing_profiles(recruiter_id uuid,user_id uuid,plan text,status text);
    CREATE TABLE public.owner_qa_sessions(user_id uuid,domain text,persona text,enabled boolean,expires_at timestamptz);
    CREATE TABLE public.agency_profiles(id uuid,owner_user_id uuid);
    CREATE TABLE public.agency_members(agency_id uuid,member_user_id uuid,role text,status text);
    CREATE TABLE public.agency_entitlements(agency_id uuid,plan_key text,source text,status text);
  `);
  // Real registry schema, constraints, RLS and ACL; no authenticated write grant.
  await db.exec(readFileSync(`${process.cwd()}/supabase/migration-candidates/20260821050000_phase_tg2e3_o6_qa_fixture_root_registry.sql`, 'utf8'));
  for (const name of ['_owner_qa_persona_for', 'effective_recruiter_tier', 'recruiter_team_seat_limit',
    'recruiter_team_occupied_seats', 'recruiter_team_workspace_within_limit', 'is_recruiter_workspace_owner',
    'current_user_has_recruiter_permission', 'recruiter_profile_can_manage_opportunities',
    'current_user_can_manage_recruiter_opportunities', 'current_user_can_recruiter_opportunity_action']) {
    await db.exec(productionFunction(name));
  }
  registryAclBefore = (await db.query("SELECT relacl::text FROM pg_class WHERE oid='public.qa_fixture_roots'::regclass")).rows;
  registryPoliciesBefore = (await db.query("SELECT polname,polcmd,pg_get_expr(polqual,polrelid) AS predicate FROM pg_policy WHERE polrelid='public.qa_fixture_roots'::regclass ORDER BY polname")).rows;
  await db.exec(sql);
  await db.exec(`INSERT INTO auth.users VALUES('${owner}'),('${staff}'),('${ordinary}'),('${outsider}');
    INSERT INTO recruiter_profiles(id,user_id) VALUES('${qa}','${owner}'),('${normal}','${ordinary}');
    INSERT INTO recruiter_billing_profiles VALUES('${qa}','${owner}','growth','active');
    INSERT INTO recruiter_members VALUES('${qa}','${staff}','active','recruiter_staff','{"opportunities_view":true}',NULL);
    INSERT INTO qa_fixture_roots(root_kind,root_id,qa_owner_user_id,registered_by_user_id) VALUES('recruiter_profile','${qa}','${owner}','${owner}');`);
}, 60000);
afterAll(async () => { await db?.close(); });

describe('QA publication read RPC with production authorization and real roles', () => {
  it('fixture owner receives only requested ID and true', async () => expect(await read(owner)).toEqual([{ recruiter_id: qa, is_qa_fixture: true }]));
  it('permitted active staff receives true', async () => expect(await read(staff)).toEqual([{ recruiter_id: qa, is_qa_fixture: true }]));
  it('ordinary permitted recruiter receives false', async () => expect(await read(ordinary, normal)).toEqual([{ recruiter_id: normal, is_qa_fixture: false }]));
  it('outsider receives zero rows, not false', async () => expect(await read(outsider)).toEqual([]));
  it('authenticated without caller receives zero rows', async () => expect(await read(null)).toEqual([]));
  it('anonymous has no execute privilege', async () => { await expect(read(null, qa, 'anon')).rejects.toThrow(/permission denied/); });
  it('service role still requires caller and authorization', async () => {
    expect(await read(null, qa, 'service_role')).toEqual([]);
    expect(await read(outsider, qa, 'service_role')).toEqual([]);
    expect(await read(owner, qa, 'service_role')).toEqual([{ recruiter_id: qa, is_qa_fixture: true }]);
  });
  it('missing recruiter returns zero rows', async () => expect(await read(owner, 'cccccccc-cccc-cccc-cccc-cccccccccccc')).toEqual([]));
  it('revoked fixture returns false without changing authorization', async () => {
    await db.exec(`UPDATE qa_fixture_roots SET active=false,revoked_at=now() WHERE root_id='${qa}'`);
    try { expect(await read(owner)).toEqual([{ recruiter_id: qa, is_qa_fixture: false }]); }
    finally { await db.exec(`UPDATE qa_fixture_roots SET active=true,revoked_at=NULL WHERE root_id='${qa}'`); }
  });
  it('staff without view permission receives zero rows', async () => {
    await db.exec(`UPDATE recruiter_members SET permissions='{}' WHERE member_user_id='${staff}'`);
    try { expect(await read(staff)).toEqual([]); }
    finally { await db.exec(`UPDATE recruiter_members SET permissions='{"opportunities_view":true}' WHERE member_user_id='${staff}'`); }
  });
  it('revoked staff receives zero rows', async () => {
    await db.exec(`UPDATE recruiter_members SET status='revoked' WHERE member_user_id='${staff}'`);
    try { expect(await read(staff)).toEqual([]); }
    finally { await db.exec(`UPDATE recruiter_members SET status='active' WHERE member_user_id='${staff}'`); }
  });
  it('registry privileges unchanged and outsider cannot select registry', async () => {
    expect((await db.query("SELECT relacl::text FROM pg_class WHERE oid='public.qa_fixture_roots'::regclass")).rows).toEqual(registryAclBefore);
    expect((await db.query("SELECT polname,polcmd,pg_get_expr(polqual,polrelid) AS predicate FROM pg_policy WHERE polrelid='public.qa_fixture_roots'::regclass ORDER BY polname")).rows).toEqual(registryPoliciesBefore);
    expect((await db.query("SELECT has_table_privilege('anon','public.qa_fixture_roots','SELECT') AS anon, has_table_privilege('authenticated','public.qa_fixture_roots','UPDATE') AS writes")).rows).toEqual([{ anon: false, writes: false }]);
    await db.exec('BEGIN; SET LOCAL ROLE authenticated');
    try {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [outsider]);
      expect((await db.query('SELECT * FROM public.qa_fixture_roots')).rows).toEqual([]);
    } finally { await db.exec('ROLLBACK'); }
  });
  it('RPC is STABLE definer with fixed search path and only two output fields', async () => {
    const { rows } = await db.query("SELECT provolatile,prosecdef,proconfig,proargnames FROM pg_proc WHERE oid='public.get_recruiter_qa_publication_context(uuid)'::regprocedure");
    expect(rows).toEqual([{ provolatile: 's', prosecdef: true, proconfig: ['search_path=pg_catalog'], proargnames: ['_recruiter_id','recruiter_id','is_qa_fixture'] }]);
  });
});
