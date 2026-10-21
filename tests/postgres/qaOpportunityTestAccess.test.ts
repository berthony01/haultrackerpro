// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

// Real production function definitions + real registry schema/ACL; no simplified authorization mocks.
const dir = `${process.cwd()}/supabase/migrations`;
const sources = readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => readFileSync(`${dir}/${f}`, 'utf8'));
function productionFunction(name: string) {
  const pattern = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\([\\s\\S]*?AS (\\$[a-zA-Z0-9_]*\\$)[\\s\\S]*?\\1;`, 'gi');
  const definition = sources.flatMap(sql => [...sql.matchAll(pattern)].map(m => m[0])).at(-1);
  if (!definition) throw new Error(`Missing production function ${name}`);
  return definition;
}
const migrationPath = `${process.cwd()}/supabase/migration-candidates/20261021013928_qa_opportunity_test_access.sql`;
const sql = readFileSync(migrationPath, 'utf8');
const ADDED = /\n\s*OR public\._qa_opportunity_test_access_allowed\(o\.id\)/g;
const visibilityStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.list_driver_visible_opportunities');
// Live pre-change definitions == candidate visibility block minus the single added OR line.
const baselineVisibility = sql.slice(visibilityStart).replace(ADDED, '');

const admin = '11111111-1111-1111-1111-111111111111';   // super_admin, owns QA recruiter + registered root owner
const tester = '22222222-2222-2222-2222-222222222222';
const other = '33333333-3333-3333-3333-333333333333';    // non-tester driver
const otherAdmin = '44444444-4444-4444-4444-444444444444';
const normalOwner = '55555555-5555-5555-5555-555555555555';
const nonAdminQaOwner = '66666666-6666-6666-6666-666666666666';
const qaR = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const normalR = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const qaR2 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';     // other fixture owned by nonAdminQaOwner
const oQa = 'a0000000-0000-0000-0000-000000000001';
const oQaSibling = 'a0000000-0000-0000-0000-000000000002';
const oNormal1 = 'b0000000-0000-0000-0000-000000000001';
const oNormal2 = 'b0000000-0000-0000-0000-000000000002';
const oQa2 = 'c0000000-0000-0000-0000-000000000001';

let db: PGlite;
async function as<T>(user: string | null, fn: () => Promise<T>, role = 'authenticated'): Promise<T> {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user ?? '']);
    return await fn();
  } finally { await db.exec('ROLLBACK'); }
}
// Commits (needed for grant/revoke state to persist across checks).
async function asCommit<T>(user: string | null, fn: () => Promise<T>, role = 'authenticated'): Promise<T> {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user ?? '']);
    const r = await fn(); await db.exec('COMMIT'); return r;
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
}
const list = (u: string | null, args: [string | null, string | null, string | null] = [null, null, null]) =>
  as(u, async () => (await db.query<{ id: string }>('SELECT id FROM public.list_driver_visible_opportunities($1,$2,$3)', args)).rows.map(r => r.id));
const detail = (u: string | null, opp: string, rec: string) =>
  as(u, async () => (await db.query<{ ok: boolean }>('SELECT public.driver_can_access_opportunity($1,$2) AS ok', [opp, rec])).rows[0].ok);
const grant = (u: string | null, opp: string, drv: string, mins: number | null = 30, role = 'authenticated') =>
  asCommit(u, async () => (await db.query<{ e: string }>('SELECT public.grant_qa_opportunity_test_access($1,$2,$3) AS e', [opp, drv, mins])).rows[0].e, role);
const revoke = (u: string | null, opp: string, drv: string) =>
  asCommit(u, async () => (await db.query<{ r: boolean }>('SELECT public.revoke_qa_opportunity_test_access($1,$2) AS r', [opp, drv])).rows[0].r);
const snapshot = async () => ({
  normal: await list(other), owner: await list(admin), filtered: await list(other, ['TX', 'company', null]),
  detailNormal: await detail(other, oNormal1, normalR), detailQaOwner: await detail(admin, oQa, qaR),
});

let baseline: Awaited<ReturnType<typeof snapshot>>;
let aclBefore: unknown;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth, public TO authenticated, anon, service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
    CREATE TABLE public.admin_users(user_id uuid, role text);
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
    CREATE TABLE public.opportunities(id uuid PRIMARY KEY, recruiter_id uuid, status text, admin_review_status text,
      hiring_state text, driver_type text, route_type text, featured boolean, published_at timestamptz, title text);
  `);
  await db.exec(readFileSync(`${process.cwd()}/supabase/migration-candidates/20260821050000_phase_tg2e3_o6_qa_fixture_root_registry.sql`, 'utf8'));
  for (const name of ['is_super_admin', '_owner_qa_persona_for', 'effective_recruiter_tier', 'recruiter_profile_can_manage_opportunities']) {
    await db.exec(productionFunction(name));
  }
  await db.exec(baselineVisibility);
  await db.exec(`REVOKE ALL ON FUNCTION public.list_driver_visible_opportunities(text,text,text), public.driver_can_access_opportunity(uuid,uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_driver_visible_opportunities(text,text,text), public.driver_can_access_opportunity(uuid,uuid) TO authenticated, service_role;`);
  await db.exec(`INSERT INTO auth.users VALUES('${admin}'),('${tester}'),('${other}'),('${otherAdmin}'),('${normalOwner}'),('${nonAdminQaOwner}');
    INSERT INTO admin_users VALUES('${admin}','super_admin'),('${otherAdmin}','super_admin');
    INSERT INTO recruiter_profiles(id,user_id) VALUES('${qaR}','${admin}'),('${normalR}','${normalOwner}'),('${qaR2}','${nonAdminQaOwner}');
    INSERT INTO recruiter_billing_profiles VALUES('${qaR}','${admin}','growth','active'),('${normalR}','${normalOwner}','growth','active'),('${qaR2}','${nonAdminQaOwner}','growth','active');
    INSERT INTO opportunities VALUES
      ('${oQa}','${qaR}','active','approved','TX','company','otr',false,'2026-10-01'),
      ('${oQaSibling}','${qaR}','active','approved','TX','company','otr',false,'2026-10-02'),
      ('${oNormal1}','${normalR}','active','approved','TX','company','otr',true,'2026-09-01'),
      ('${oNormal2}','${normalR}','active','approved','CA','owner_operator','regional',false,'2026-10-05'),
      ('${oQa2}','${qaR2}','active','approved','TX','company','otr',false,'2026-10-03');
    INSERT INTO qa_fixture_roots(root_kind,root_id,qa_owner_user_id,registered_by_user_id) VALUES
      ('recruiter_profile','${qaR}','${admin}','${admin}'),('recruiter_profile','${qaR2}','${nonAdminQaOwner}','${admin}');`);
  baseline = await snapshot();
  aclBefore = (await db.query("SELECT p.oid::regprocedure::text s, p.proacl::text a, p.provolatile v, p.prosecdef d, p.proconfig c FROM pg_proc p WHERE proname IN ('list_driver_visible_opportunities','driver_can_access_opportunity') ORDER BY 1")).rows;
  await db.exec(sql);
}, 60000);
afterAll(async () => { await db?.close(); });

describe('baseline preserved by migration', () => {
  it('baseline sanity: QA hidden from ordinary driver, owner sees own fixture', () => {
    expect(baseline.normal).toEqual([oNormal1, oNormal2]);
    expect(baseline.owner).toEqual([oNormal1, oNormal2, oQaSibling, oQa]);
  });
  it('migration only adds one OR line to each visibility function', () => {
    expect([...sql.slice(visibilityStart).matchAll(ADDED)].length).toBe(2);
  });
  it('visibility signatures, volatility, definer, search_path and ACLs unchanged', async () => {
    expect((await db.query("SELECT p.oid::regprocedure::text s, p.proacl::text a, p.provolatile v, p.prosecdef d, p.proconfig c FROM pg_proc p WHERE proname IN ('list_driver_visible_opportunities','driver_can_access_opportunity') ORDER BY 1")).rows).toEqual(aclBefore);
  });
  it('without grants, results/filters/order identical to baseline', async () => {
    expect(await snapshot()).toEqual(baseline);
    expect(await list(null)).toEqual([]);
    expect(await detail(null, oNormal1, normalR)).toBe(false);
  });
});

describe('privileges', () => {
  it('table: no anon/authenticated rights; RLS on; direct read/write denied', async () => {
    const { rows } = await db.query<any>(`SELECT has_table_privilege('anon','public.qa_opportunity_test_access','SELECT') a1,
      has_table_privilege('authenticated','public.qa_opportunity_test_access','SELECT') a2,
      has_table_privilege('authenticated','public.qa_opportunity_test_access','INSERT') a3,
      (SELECT relrowsecurity FROM pg_class WHERE oid='public.qa_opportunity_test_access'::regclass) rls,
      (SELECT count(*)::int FROM pg_policy WHERE polrelid='public.qa_opportunity_test_access'::regclass) pol`);
    expect(rows[0]).toEqual({ a1: false, a2: false, a3: false, rls: true, pol: 0 });
    await expect(as(tester, () => db.query('SELECT * FROM public.qa_opportunity_test_access'))).rejects.toThrow(/permission denied/);
    await expect(as(tester, () => db.query(`INSERT INTO public.qa_opportunity_test_access VALUES('${oQa}','${tester}','${admin}',now(),now()+interval '5 min',NULL)`))).rejects.toThrow(/permission denied/);
    await expect(as(null, () => db.query('SELECT * FROM public.qa_opportunity_test_access'), 'anon')).rejects.toThrow(/permission denied/);
  });
  it('internal helper not executable by authenticated/anon; management not by anon', async () => {
    await expect(as(tester, () => db.query(`SELECT public._qa_opportunity_test_access_allowed('${oQa}')`))).rejects.toThrow(/permission denied/);
    await expect(as(null, () => db.query(`SELECT public._qa_opportunity_test_access_allowed('${oQa}')`), 'anon')).rejects.toThrow(/permission denied/);
    await expect(grant(null, oQa, tester, 30, 'anon')).rejects.toThrow(/permission denied/);
    await expect(as(null, () => db.query(`SELECT public.revoke_qa_opportunity_test_access('${oQa}','${tester}')`), 'anon')).rejects.toThrow(/permission denied/);
  });
});

describe('granting authority', () => {
  it('denies ordinary, other super_admin, non-admin QA owner, missing identity, non-QA opportunity, service role without caller', async () => {
    await expect(grant(other, oQa, tester)).rejects.toThrow(/not authorized/);
    await expect(grant(otherAdmin, oQa, tester)).rejects.toThrow(/not authorized/);
    await expect(grant(nonAdminQaOwner, oQa2, tester)).rejects.toThrow(/not authorized/);
    await expect(grant(null, oQa, tester)).rejects.toThrow(/not authorized/);
    await expect(grant(null, oQa, tester, 30, 'service_role')).rejects.toThrow(/not authorized/);
    await expect(grant(admin, oNormal1, tester)).rejects.toThrow(/not authorized/);
    await expect(grant(admin, oQa2, tester)).rejects.toThrow(/not authorized/);
  });
  it('validates inputs: duration 1..60, real driver, non-null', async () => {
    for (const m of [0, 61, null]) await expect(grant(admin, oQa, tester, m)).rejects.toThrow(/not authorized/);
    await expect(grant(admin, oQa, 'dddddddd-dddd-dddd-dddd-dddddddddddd')).rejects.toThrow(/not authorized/);
    expect((await db.query<any>('SELECT count(*)::int n FROM qa_opportunity_test_access')).rows[0].n).toBe(0);
  });
  it('max expiry enforced by constraint too', async () => {
    await expect(db.query(`INSERT INTO qa_opportunity_test_access VALUES('${oQa}','${tester}','${admin}',now(),now()+interval '61 min',NULL)`)).rejects.toThrow(/expiry_window/);
    await expect(db.query(`INSERT INTO qa_opportunity_test_access VALUES('${oQa}','${tester}','${admin}',now(),now(),NULL)`)).rejects.toThrow(/expiry_window/);
  });
  it('registered fixture-owning super_admin succeeds; owner derived from auth.uid(), server timestamps', async () => {
    const e = await grant(admin, oQa, tester, 60);
    const { rows } = await db.query<any>(`SELECT qa_owner_user_id, revoked_at, (expires_at - granted_at) = interval '60 min' AS w, expires_at = $1::timestamptz AS e FROM qa_opportunity_test_access`, [e]);
    expect(rows).toEqual([{ qa_owner_user_id: admin, revoked_at: null, w: true, e: true }]);
  });
});

describe('discovery/detail scope', () => {
  it('tester sees ONLY the granted QA opportunity; siblings/other fixtures hidden', async () => {
    expect(await list(tester)).toEqual([oNormal1, oNormal2, oQa]);
    expect(await detail(tester, oQa, qaR)).toBe(true);
    expect(await detail(tester, oQaSibling, qaR)).toBe(false);
    expect(await detail(tester, oQa2, qaR2)).toBe(false);
    expect(await detail(tester, oQa, normalR)).toBe(false);
    expect(await list(tester, ['CA', null, null])).toEqual([oNormal2]);
  });
  it('non-testers, QA owner and public listings unchanged', async () => {
    expect(await snapshot()).toEqual(baseline);
  });
  it('status/moderation still enforced for granted opportunity', async () => {
    await db.exec(`UPDATE opportunities SET status='paused' WHERE id='${oQa}'`);
    try { expect(await list(tester)).not.toContain(oQa); expect(await detail(tester, oQa, qaR)).toBe(false); }
    finally { await db.exec(`UPDATE opportunities SET status='active' WHERE id='${oQa}'`); }
    await db.exec(`UPDATE opportunities SET admin_review_status='pending' WHERE id='${oQa}'`);
    try { expect(await detail(tester, oQa, qaR)).toBe(false); }
    finally { await db.exec(`UPDATE opportunities SET admin_review_status='approved' WHERE id='${oQa}'`); }
  });
  it('fails closed: expired, inactive root, mismatched owner, removed super_admin', async () => {
    const hidden = async () => { expect(await list(tester)).not.toContain(oQa); expect(await detail(tester, oQa, qaR)).toBe(false); };
    await db.exec(`UPDATE qa_opportunity_test_access SET granted_at=now()-interval '2 hours', expires_at=now()-interval '90 min'`);
    try { await hidden(); } finally { await db.exec(`UPDATE qa_opportunity_test_access SET granted_at=now(), expires_at=now()+interval '30 min'`); }
    await db.exec(`UPDATE qa_fixture_roots SET active=false, revoked_at=now() WHERE root_id='${qaR}'`);
    try { await hidden(); } finally { await db.exec(`UPDATE qa_fixture_roots SET active=true, revoked_at=NULL WHERE root_id='${qaR}'`); }
    await db.exec(`UPDATE recruiter_profiles SET user_id='${otherAdmin}' WHERE id='${qaR}'`);
    try { await hidden(); } finally { await db.exec(`UPDATE recruiter_profiles SET user_id='${admin}' WHERE id='${qaR}'`); }
    await db.exec(`DELETE FROM admin_users WHERE user_id='${admin}'`);
    try { await hidden(); } finally { await db.exec(`INSERT INTO admin_users VALUES('${admin}','super_admin')`); }
    expect(await detail(tester, oQa, qaR)).toBe(true);
  });
  it('revoke: other admin denied; owner succeeds (even with inactive root); row preserved; access stops', async () => {
    await expect(revoke(otherAdmin, oQa, tester)).rejects.toThrow(/not authorized/);
    await expect(revoke(other, oQa, tester)).rejects.toThrow(/not authorized/);
    await db.exec(`UPDATE qa_fixture_roots SET active=false, revoked_at=now() WHERE root_id='${qaR}'`);
    try { expect(await revoke(admin, oQa, tester)).toBe(true); }
    finally { await db.exec(`UPDATE qa_fixture_roots SET active=true, revoked_at=NULL WHERE root_id='${qaR}'`); }
    expect(await revoke(admin, oQa, tester)).toBe(false);
    expect((await db.query<any>('SELECT count(*)::int n, bool_and(revoked_at IS NOT NULL) r FROM qa_opportunity_test_access')).rows[0]).toEqual({ n: 1, r: true });
    expect(await list(tester)).toEqual([oNormal1, oNormal2]);
    expect(await detail(tester, oQa, qaR)).toBe(false);
    expect(await snapshot()).toEqual(baseline);
  });
  it('re-grant resets the same single row', async () => {
    await grant(admin, oQa, tester, 5);
    expect((await db.query<any>('SELECT count(*)::int n, bool_and(revoked_at IS NULL) r FROM qa_opportunity_test_access')).rows[0]).toEqual({ n: 1, r: true });
    expect(await detail(tester, oQa, qaR)).toBe(true);
  });
});
