// @vitest-environment node
// HJ-2 candidate on a disposable native PostgreSQL cluster. Applies frozen
// helpers + CF-1A conversation tables + HJ-1A + HJ-1B + HJ-2 candidate files.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';

const src = (p: string) => readFileSync(p, 'utf8');
const extract = (p: string, re: RegExp) => { const m = src(p).match(re)?.[0]; if (!m) throw new Error('missing helper in ' + p); return m; };
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG') && k !== 'DATABASE_URL'));
const run = (bin: string, args: string[]) => process.getuid?.() === 0
  ? execFileSync('setpriv', ['--reuid=1000', '--regid=1000', '--clear-groups', bin, ...args], { env, stdio: 'pipe' })
  : execFileSync(bin, args, { env, stdio: 'pipe' });
const CF = 'supabase/migrations/20260916050500_phase_cf1a_conversation_foundation.sql';
const cf = src(CF);
const conversationDdl = cf.slice(cf.indexOf('CREATE TABLE IF NOT EXISTS public.conversation_threads'), cf.indexOf('CREATE INDEX IF NOT EXISTS idx_conversation_threads_driver_updated'));
const restrictionTable = extract('supabase/migrations/20260719183725_ee7ffc53-dcdc-4666-bcba-1aeac0f5d0cf.sql', /CREATE TABLE IF NOT EXISTS public\.marketplace_user_restrictions \([\s\S]*?\n\);/);
const restrictionHelper = extract(CF, /CREATE OR REPLACE FUNCTION public\.user_has_blocking_messaging_restriction\([\s\S]*?\$function\$;/);
const ownerHelper = extract('supabase/migration-candidates/20260815020500_phase_rc1a_recruiter_workspace_membership_foundation.sql', /CREATE OR REPLACE FUNCTION public\.is_recruiter_workspace_owner\([\s\S]*?\$\$;/);
const readyHelper = extract('supabase/migration-candidates/20260725190000_phase1p_a1_recruiter_readiness_company_type.sql', /CREATE OR REPLACE FUNCTION public\.recruiter_profile_can_manage_opportunities\([\s\S]*?\$function\$;/);
const qaHelper = extract('supabase/migration-candidates/20260821050000_phase_tg2e3_o6_qa_fixture_root_registry.sql', /CREATE OR REPLACE FUNCTION public\.is_qa_fixture_root\([\s\S]*?\$\$;/);
const HJ2 = 'supabase/migration-candidates/20261113200000_phase_hj2_recruiter_opportunity_invitations.sql';

let dir = '', pool: pg.Pool;
const ids = { owner: randomUUID(), driver: randomUUID(), driver2: randomUUID(), other: randomUUID(), staff: randomUUID(), ws: randomUUID(), foreign: randomUUID(), opp: randomUUID(), opp2: randomUUID(), foreignOpp: randomUUID(), draftOpp: randomUUID() };
const card: Record<string, string> = {};
const payload = { state: 'TX', cdl_class: 'A', years_experience: 3, experience_qualifier: 'at_least', preferred_route_type: 'Regional', preferred_home_time: 'Weekly' };

async function as<T = any>(actor: string | null, sql: string, args: unknown[] = []): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated');
    await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor ?? '']);
    const r = await c.query(sql, args); await c.query('COMMIT'); return r.rows[0]?.r as T;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
const send = (actor: string, cardId: string, opp = ids.opp, ws = ids.ws, cmd: string = randomUUID(), msg = 'Hi, we think this regional role fits you.') =>
  as(actor, 'SELECT public.send_job_search_invitation($1,$2,$3,$4,$5) AS r', [ws, cardId, opp, msg, cmd]);
const respond = (actor: string, id: string, resp: string) => as(actor, 'SELECT public.respond_job_search_invitation($1,$2) AS r', [id, resp]);
const list = (actor: string) => as<any[]>(actor, 'SELECT public.list_my_job_search_invitations() AS r');
const flags = (pub: boolean, disc: boolean, inv: boolean) => pool.query('INSERT INTO job_search_private.job_search_feature_control(singleton,publication_enabled,discovery_enabled,invitations_enabled) VALUES(true,$1,$2,$3) ON CONFLICT(singleton) DO UPDATE SET publication_enabled=EXCLUDED.publication_enabled,discovery_enabled=EXCLUDED.discovery_enabled,invitations_enabled=EXCLUDED.invitations_enabled', [pub, disc, inv]);
async function publish(owner: string) {
  const r = await as(owner, "SELECT public.manage_my_job_search_card('publish',$1::jsonb,0,$2,'job_search_card_v1') AS r", [JSON.stringify(payload), randomUUID()]);
  return (r as any).id as string;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hj2-pg-')); if (process.getuid?.() === 0) execFileSync('chown', ['1000:1000', dir]);
  const version = run('postgres', ['--version']).toString(); console.log('HJ-2 native', version.trim());
  run('initdb', ['-D', join(dir, 'data'), '-U', 'local_owner', '-A', 'trust', '--no-locale']);
  run('pg_ctl', ['-D', join(dir, 'data'), '-l', join(dir, 'pg.log'), '-o', `-k ${dir} -h '' -p 55442`, '-w', 'start']);
  pool = new pg.Pool({ host: dir, port: 55442, user: 'local_owner', database: 'postgres', password: '', ssl: false, max: 8 });
  await pool.query(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TYPE public.user_capability_type AS ENUM ('driver','recruiter');
    CREATE TYPE public.user_capability_status AS ENUM ('setup','active','suspended','revoked');
    CREATE TABLE public.user_capabilities(user_id uuid NOT NULL,capability public.user_capability_type NOT NULL,status public.user_capability_status NOT NULL,activated_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),PRIMARY KEY(user_id,capability));
    CREATE TABLE public.recruiter_profiles(id uuid PRIMARY KEY,user_id uuid NOT NULL,status text NOT NULL,verification_status text NOT NULL,recruiter_name text,company_name text,recruiter_email text,company_type text,dot_number text,mc_number text,posting_terms_accepted_at timestamptz,legacy_terms_grandfathered_at timestamptz);
    CREATE TABLE public.opportunities(id uuid PRIMARY KEY,recruiter_id uuid NOT NULL,status text NOT NULL,admin_review_status text NOT NULL,title text NOT NULL,company_name text NOT NULL,hiring_city text,hiring_state text,route_type text);
    CREATE TABLE public.qa_fixture_roots(root_kind text NOT NULL,root_id uuid NOT NULL,qa_owner_user_id uuid NOT NULL,active boolean NOT NULL DEFAULT true,PRIMARY KEY(root_kind,root_id));
    ${restrictionTable}
    ${restrictionHelper}
    ${ownerHelper}
    ${readyHelper}
    ${qaHelper}
    ${conversationDdl}
    CREATE TABLE public.driver_opportunity_profiles(user_id uuid PRIMARY KEY,visibility text NOT NULL DEFAULT 'private',allow_verified_recruiter_contact boolean NOT NULL DEFAULT false,contact_preference text NOT NULL DEFAULT 'in_app',private_phone text);
  `);
  for (const t of ['user_capabilities', 'recruiter_profiles', 'opportunities', 'qa_fixture_roots', 'marketplace_user_restrictions', 'driver_opportunity_profiles'])
    await pool.query(`REVOKE ALL ON public.${t} FROM PUBLIC,anon,authenticated; ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
  await pool.query(src('supabase/migration-candidates/20261024041952_phase_hj1a_job_search_card_foundation.sql'));
  await pool.query(src('supabase/migration-candidates/20261024045239_phase_hj1b_job_search_discovery.sql'));
  await pool.query(src(HJ2));
}, 60000);
afterAll(async () => { if (pool) await pool.end(); if (dir) { try { run('pg_ctl', ['-D', join(dir, 'data'), '-m', 'immediate', '-w', 'stop']); } finally { rmSync(dir, { recursive: true, force: true }); } } });

beforeEach(async () => {
  await pool.query('TRUNCATE job_search_private.recruiter_opportunity_invitations,job_search_private.recruiter_invitation_blocks,job_search_private.job_search_card_events,job_search_private.driver_job_search_cards,public.conversation_threads,public.user_capabilities,public.recruiter_profiles,public.opportunities,public.qa_fixture_roots,public.marketplace_user_restrictions,public.driver_opportunity_profiles,auth.users CASCADE');
  for (const u of [ids.owner, ids.driver, ids.driver2, ids.other, ids.staff]) await pool.query('INSERT INTO auth.users VALUES($1)', [u]);
  for (const u of [ids.driver, ids.driver2]) await pool.query("INSERT INTO public.user_capabilities(user_id,capability,status) VALUES($1,'driver','active')", [u]);
  for (const u of [ids.owner, ids.other, ids.staff]) await pool.query("INSERT INTO public.user_capabilities(user_id,capability,status) VALUES($1,'recruiter','active')", [u]);
  for (const [w, o, n] of [[ids.ws, ids.owner, 'Acme Freight'], [ids.foreign, ids.other, 'Other Co']])
    await pool.query("INSERT INTO public.recruiter_profiles VALUES($1,$2,'active','approved','Rec',$3,'r@example.test','carrier','123',NULL,now(),NULL)", [w, o, n]);
  await pool.query(`INSERT INTO public.opportunities VALUES
    ($1,$2,'active','approved','Regional CDL-A','Acme Freight','Dallas','TX','Regional'),
    ($3,$2,'active','approved','Dedicated','Acme Freight','Austin','TX','Dedicated'),
    ($4,$5,'active','approved','Foreign','Other Co',NULL,NULL,NULL),
    ($6,$2,'draft','pending','Draft','Acme Freight',NULL,NULL,NULL)`, [ids.opp, ids.ws, ids.opp2, ids.foreignOpp, ids.foreign, ids.draftOpp]);
  for (const u of [ids.driver, ids.driver2]) await pool.query("INSERT INTO public.driver_opportunity_profiles(user_id,visibility,allow_verified_recruiter_contact,private_phone) VALUES($1,'verified_recruiters',true,'555-DO-NOT-LEAK')", [u]);
  await flags(true, true, true);
  card.d1 = await publish(ids.driver); card.d2 = await publish(ids.driver2);
});

it('candidate leaves invitations flag OFF by default and grants no table access', async () => {
  const d = (await pool.query("SELECT column_default FROM information_schema.columns WHERE table_name='job_search_feature_control' AND column_name='invitations_enabled'")).rows[0];
  expect(d.column_default).toBe('false');
  for (const t of ['recruiter_opportunity_invitations', 'recruiter_invitation_blocks'])
    await expect(as(ids.driver, `SELECT count(*) AS r FROM job_search_private.${t}`)).rejects.toMatchObject({ code: '42501' });
  for (const f of ['send_job_search_invitation', 'respond_job_search_invitation', 'list_my_job_search_invitations', 'job_search_invitations_available']) {
    const r = (await pool.query("SELECT has_function_privilege('anon',p.oid,'EXECUTE') a, prosecdef, proconfig::text cfg FROM pg_proc p WHERE proname=$1", [f])).rows[0];
    expect(r.a).toBe(false); expect(r.prosecdef).toBe(true); expect(r.cfg).toContain('search_path=pg_catalog');
  }
});
it('flags OFF deny sending and probe reports unavailable', async () => {
  for (const [a, b] of [[false, false], [true, false], [false, true]] as const) {
    await flags(true, a, b);
    await expect(send(ids.owner, card.d1)).rejects.toMatchObject({ code: '42501' });
    expect(await as(ids.owner, 'SELECT public.job_search_invitations_available() AS r')).toBe(false);
  }
  await pool.query('DELETE FROM job_search_private.job_search_feature_control');
  await expect(send(ids.owner, card.d1)).rejects.toMatchObject({ code: '42501' });
});
it('happy path: invite -> driver sees safe fields -> no thread until accept -> accept opens one active thread', async () => {
  const s = await send(ids.owner, card.d1);
  expect(s.result).toBe('sent');
  expect((await pool.query('SELECT count(*)::int n FROM public.conversation_threads')).rows[0].n).toBe(0);
  const rows = await list(ids.driver);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: 'pending', company_name: 'Acme Freight', opportunity_title: 'Regional CDL-A', verified: true, thread_id: null });
  expect(JSON.stringify(rows)).not.toContain(ids.driver);
  expect(await list(ids.driver2)).toEqual([]);
  await expect(respond(ids.owner, s.invitation_id, 'accept')).rejects.toMatchObject({ code: '42501' });
  const a = await respond(ids.driver, s.invitation_id, 'accept');
  expect(a.status).toBe('accepted');
  const t = (await pool.query('SELECT * FROM public.conversation_threads')).rows;
  expect(t).toHaveLength(1); expect(t[0]).toMatchObject({ status: 'active', driver_user_id: ids.driver, recruiter_id: ids.ws, opportunity_id: ids.opp, initiated_by_user_id: ids.driver });
  expect((await pool.query('SELECT count(*)::int n FROM public.conversation_participants WHERE thread_id=$1', [t[0].id])).rows[0].n).toBe(2);
  expect((await respond(ids.driver, s.invitation_id, 'accept')).thread_id).toBe(t[0].id);
  expect((await pool.query('SELECT count(*)::int n FROM public.conversation_messages')).rows[0].n).toBe(1);
});
it('sender output never contains driver identity', async () => {
  const s = await send(ids.owner, card.d1);
  expect(Object.keys(s).sort()).toEqual(['invitation_id', 'result']);
  expect(JSON.stringify(s)).not.toContain(ids.driver);
});
it('consent: paused, withdrawn, expired and never-published cards are unavailable', async () => {
  await expect(send(ids.owner, randomUUID())).rejects.toMatchObject({ code: '42501' });
  await pool.query("UPDATE job_search_private.driver_job_search_cards SET expires_at=now()-interval '1 second', published_at=now()-interval '2 days', created_at=now()-interval '2 days' WHERE id=$1", [card.d1]);
  await expect(send(ids.owner, card.d1)).rejects.toMatchObject({ code: '42501' });
  for (const st of ['paused', 'withdrawn']) {
    await pool.query('UPDATE job_search_private.driver_job_search_cards SET status=$2 WHERE id=$1', [card.d2, st]);
    await expect(send(ids.owner, card.d2)).rejects.toMatchObject({ code: '42501' });
  }
});
it('opportunity must be real, active, approved and owned by the sending workspace', async () => {
  for (const o of [randomUUID(), ids.foreignOpp, ids.draftOpp]) await expect(send(ids.owner, card.d1, o)).rejects.toMatchObject({ code: '42501' });
  await pool.query("UPDATE public.opportunities SET status='closed' WHERE id=$1", [ids.opp]);
  await expect(send(ids.owner, card.d1)).rejects.toMatchObject({ code: '42501' });
});
it('denies staff, other recruiter, forged workspace, driver, anonymous, restricted and revoked actors', async () => {
  await expect(send(ids.staff, card.d1)).rejects.toMatchObject({ code: '42501' });
  await expect(send(ids.other, card.d1, ids.opp, ids.ws)).rejects.toMatchObject({ code: '42501' });
  await expect(send(ids.owner, card.d1, ids.foreignOpp, ids.foreign)).rejects.toMatchObject({ code: '42501' });
  await expect(send(ids.driver2, card.d1)).rejects.toMatchObject({ code: '42501' });
  await expect(as(null, 'SELECT public.send_job_search_invitation($1,$2,$3,$4,$5) AS r', [ids.ws, card.d1, ids.opp, 'x', randomUUID()])).rejects.toMatchObject({ code: '42501' });
  await pool.query("UPDATE public.user_capabilities SET status='revoked' WHERE user_id=$1 AND capability='recruiter'", [ids.owner]);
  await expect(send(ids.owner, card.d1)).rejects.toMatchObject({ code: '42501' });
  await pool.query("UPDATE public.user_capabilities SET status='active' WHERE user_id=$1", [ids.owner]);
  await pool.query("UPDATE public.recruiter_profiles SET verification_status='pending' WHERE id=$1", [ids.ws]);
  await expect(send(ids.owner, card.d1)).rejects.toMatchObject({ code: '42501' });
});
it('blocked or restricted driver cannot be invited; block declines all pending from that workspace', async () => {
  const a = await send(ids.owner, card.d1); const b = await send(ids.owner, card.d1, ids.opp2);
  await respond(ids.driver, a.invitation_id, 'block');
  expect((await list(ids.driver)).map(r => r.status)).toEqual(['declined', 'declined']);
  expect(b.result).toBe('sent');
  await pool.query('DELETE FROM job_search_private.recruiter_opportunity_invitations');
  await expect(send(ids.owner, card.d1)).rejects.toMatchObject({ code: '42501' });
  const cols = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='marketplace_user_restrictions'")).rows.map(r => r.column_name);
  expect(cols.length).toBeGreaterThan(0);
});
it('declined invitation cannot be accepted or re-sent; duplicates and replays are idempotent', async () => {
  const cmd = randomUUID();
  const s = await send(ids.owner, card.d1, ids.opp, ids.ws, cmd);
  expect((await send(ids.owner, card.d1, ids.opp, ids.ws, cmd)).result).toBe('replayed');
  await expect(send(ids.owner, card.d1, ids.opp, ids.ws, cmd, 'different body')).rejects.toMatchObject({ code: '22023' });
  expect((await send(ids.owner, card.d1)).result).toBe('already_invited');
  await respond(ids.driver, s.invitation_id, 'decline');
  await expect(respond(ids.driver, s.invitation_id, 'accept')).rejects.toMatchObject({ code: '55000' });
  expect((await send(ids.owner, card.d1)).result).toBe('already_invited');
});
it('expired invitation cannot be accepted', async () => {
  const s = await send(ids.owner, card.d1);
  await pool.query("UPDATE job_search_private.recruiter_opportunity_invitations SET created_at=now()-interval '20 days', expires_at=now()-interval '1 day'");
  expect((await list(ids.driver))[0].status).toBe('expired');
  await expect(respond(ids.driver, s.invitation_id, 'accept')).rejects.toMatchObject({ code: '55000' });
});
it('accept re-validates: recruiter revoked or opportunity closed after sending blocks the thread', async () => {
  const s = await send(ids.owner, card.d1);
  await pool.query("UPDATE public.opportunities SET status='closed' WHERE id=$1", [ids.opp]);
  await expect(respond(ids.driver, s.invitation_id, 'accept')).rejects.toMatchObject({ code: '42501' });
  await pool.query("UPDATE public.opportunities SET status='active' WHERE id=$1", [ids.opp]);
  await pool.query("UPDATE public.recruiter_profiles SET status='suspended' WHERE id=$1", [ids.ws]);
  await expect(respond(ids.driver, s.invitation_id, 'accept')).rejects.toMatchObject({ code: '42501' });
  expect((await pool.query('SELECT count(*)::int n FROM public.conversation_threads')).rows[0].n).toBe(0);
});
it('accept links an existing open driver-initiated thread instead of duplicating it', async () => {
  const s = await send(ids.owner, card.d1);
  const existing = (await pool.query("INSERT INTO public.conversation_threads(driver_user_id,recruiter_id,opportunity_id,status,initiated_by_user_id) VALUES($1,$2,$3,'requested',$1) RETURNING id", [ids.driver, ids.ws, ids.opp])).rows[0].id;
  expect((await respond(ids.driver, s.invitation_id, 'accept')).thread_id).toBe(existing);
  expect((await pool.query('SELECT status FROM public.conversation_threads')).rows).toEqual([{ status: 'requested' }]);
});
it('rate limit: at most 2 pending per driver per workspace and 25 per workspace per day', async () => {
  await pool.query(`INSERT INTO public.opportunities SELECT gen_random_uuid(),$1,'active','approved','Extra','Acme Freight',NULL,NULL,NULL FROM generate_series(1,30)`, [ids.ws]);
  const opps = (await pool.query("SELECT id FROM public.opportunities WHERE title='Extra'")).rows.map(r => r.id);
  await send(ids.owner, card.d1, opps[0]); await send(ids.owner, card.d1, opps[1]);
  await expect(send(ids.owner, card.d1, opps[2])).rejects.toMatchObject({ code: '54000' });
  await pool.query(`INSERT INTO job_search_private.recruiter_opportunity_invitations(card_id,driver_user_id,recruiter_id,opportunity_id,sender_user_id,message,status,client_command_id,input_fingerprint,expires_at,responded_at)
    SELECT $1,$2,$3,o,$4,'x','declined',gen_random_uuid(),md5(o::text),now()+interval '1 day',now() FROM unnest($5::uuid[]) o`, [card.d2, ids.driver2, ids.ws, ids.owner, opps.slice(3, 26)]);
  await expect(send(ids.owner, card.d2, opps[27])).rejects.toMatchObject({ code: '54000' });
});
it('race: concurrent duplicate sends create exactly one invitation; concurrent accepts create one thread', async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => send(ids.owner, card.d1)));
  expect(results.filter(r => r.result === 'sent')).toHaveLength(1);
  expect((await pool.query('SELECT count(*)::int n FROM job_search_private.recruiter_opportunity_invitations')).rows[0].n).toBe(1);
  const id = results.find(r => r.result === 'sent')!.invitation_id;
  const acc = await Promise.all(Array.from({ length: 4 }, () => respond(ids.driver, id, 'accept')));
  expect(new Set(acc.map(a => a.thread_id)).size).toBe(1);
  expect((await pool.query('SELECT count(*)::int n FROM public.conversation_threads')).rows[0].n).toBe(1);
});

const setConsent = (u: string, vis: string, allow: boolean) => pool.query('UPDATE public.driver_opportunity_profiles SET visibility=$2,allow_verified_recruiter_contact=$3 WHERE user_id=$1', [u, vis, allow]);
const threads = async () => (await pool.query('SELECT count(*)::int n FROM public.conversation_threads')).rows[0].n;
it('real table defaults are private + contact false', async () => {
  const d = (await pool.query("SELECT column_name,column_default FROM information_schema.columns WHERE table_name='driver_opportunity_profiles' AND column_name IN ('visibility','allow_verified_recruiter_contact') ORDER BY 1")).rows;
  expect(d).toEqual([{ column_name: 'allow_verified_recruiter_contact', column_default: 'false' }, { column_name: 'visibility', column_default: "'private'::text" }]);
});
it('contact consent: missing profile, private, apply_only, verified_recruiters+false all fail closed with generic Card unavailable', async () => {
  await pool.query('DELETE FROM public.driver_opportunity_profiles WHERE user_id=$1', [ids.driver]);
  await expect(send(ids.owner, card.d1)).rejects.toMatchObject({ code: '42501', message: 'Card unavailable' });
  for (const [vis, allow] of [['private', true], ['apply_only', true], ['verified_recruiters', false], ['private', false]] as const) {
    await setConsent(ids.driver2, vis, allow);
    await expect(send(ids.owner, card.d2)).rejects.toMatchObject({ code: '42501', message: 'Card unavailable' });
  }
  expect((await pool.query('SELECT count(*)::int n FROM job_search_private.recruiter_opportunity_invitations')).rows[0].n).toBe(0);
});
it('contact revoked after invite: accept denied, no thread; decline and block still work', async () => {
  const a = await send(ids.owner, card.d1); const b = await send(ids.owner, card.d1, ids.opp2);
  await setConsent(ids.driver, 'verified_recruiters', false);
  await expect(respond(ids.driver, a.invitation_id, 'accept')).rejects.toMatchObject({ code: '42501' });
  await setConsent(ids.driver, 'apply_only', true);
  await expect(respond(ids.driver, a.invitation_id, 'accept')).rejects.toMatchObject({ code: '42501' });
  expect(await threads()).toBe(0);
  expect((await respond(ids.driver, a.invitation_id, 'decline')).status).toBe('declined');
  expect((await respond(ids.driver, b.invitation_id, 'block')).status).toBe('declined');
});
it('card withdrawn, paused or expired after invite: accept denied, no thread', async () => {
  const a = await send(ids.owner, card.d1); const b = await send(ids.owner, card.d2);
  for (const st of ['withdrawn', 'paused']) {
    await pool.query('UPDATE job_search_private.driver_job_search_cards SET status=$2 WHERE id=$1', [card.d1, st]);
    await expect(respond(ids.driver, a.invitation_id, 'accept')).rejects.toMatchObject({ code: '42501' });
  }
  await pool.query("UPDATE job_search_private.driver_job_search_cards SET published_at=now()-interval '2 days',created_at=now()-interval '2 days',expires_at=now()-interval '1 second' WHERE id=$1", [card.d2]);
  await expect(respond(ids.driver2, b.invitation_id, 'accept')).rejects.toMatchObject({ code: '42501' });
  expect(await threads()).toBe(0);
  expect((await respond(ids.driver, a.invitation_id, 'decline')).status).toBe('declined');
});
it('restricted driver: cannot be invited, and restriction after invite blocks accept', async () => {
  const a = await send(ids.owner, card.d1);
  await pool.query("INSERT INTO public.marketplace_user_restrictions(user_id,scope,restriction) VALUES($1,'messaging','blocked'),($2,'all','read_only')", [ids.driver, ids.driver2]);
  await expect(send(ids.owner, card.d2)).rejects.toMatchObject({ code: '42501', message: 'Card unavailable' });
  await expect(respond(ids.driver, a.invitation_id, 'accept')).rejects.toMatchObject({ code: '42501' });
  expect(await threads()).toBe(0);
});
it('restricted recruiter cannot send', async () => {
  await pool.query("INSERT INTO public.marketplace_user_restrictions(user_id,scope,restriction) VALUES($1,'messaging','blocked')", [ids.owner]);
  await expect(send(ids.owner, card.d1)).rejects.toMatchObject({ code: '42501' });
});
it('list output never contains driver contact data', async () => {
  await send(ids.owner, card.d1);
  expect(JSON.stringify(await list(ids.driver))).not.toContain('555-DO-NOT-LEAK');
});

const discover = async (u: string | null, w = ids.ws) =>
  (await as(u, 'SELECT public.list_recruiter_job_search_cards($1,20,NULL,NULL) AS r', [w])) as Array<{ id: string; payload: Record<string, unknown> }>;
const setContact = (u: string, vis: string, allow: boolean) =>
  pool.query('UPDATE public.driver_opportunity_profiles SET visibility=$2, allow_verified_recruiter_contact=$3 WHERE user_id=$1', [u, vis, allow]);

it('HJ-1B discovery lists only drivers with both card and live contact consent', async () => {
  const visible = async () => (await discover(ids.owner)).map((c) => c.id).sort();
  expect(await visible()).toEqual([card.d1, card.d2].sort());
  const page = await discover(ids.owner);
  expect(JSON.stringify(page)).not.toContain(ids.driver);
  expect(JSON.stringify(page)).not.toContain('555-DO-NOT-LEAK');
  for (const [vis, allow] of [['private', true], ['apply_only', true], ['verified_recruiters', false], ['private', false]] as const) {
    await setContact(ids.driver, vis, allow);
    expect(await visible()).toEqual([card.d2]);
  }
  await setContact(ids.driver, 'verified_recruiters', true);
  expect(await visible()).toEqual([card.d1, card.d2].sort());
  await pool.query('DELETE FROM public.driver_opportunity_profiles WHERE user_id=$1', [ids.driver2]);
  expect(await visible()).toEqual([card.d1]);
  await pool.query("UPDATE job_search_private.driver_job_search_cards SET status='withdrawn' WHERE id=$1", [card.d1]);
  expect(await visible()).toEqual([]);
});
it('HJ-1B discovery toggling contact off removes card immediately and re-enabling restores it', async () => {
  await setContact(ids.driver, 'verified_recruiters', false);
  expect((await discover(ids.owner)).map((c) => c.id)).toEqual([card.d2]);
  await setContact(ids.driver, 'verified_recruiters', true);
  expect((await discover(ids.owner)).map((c) => c.id).sort()).toEqual([card.d1, card.d2].sort());
  await pool.query("UPDATE job_search_private.driver_job_search_cards SET expires_at=now()-interval '1 second', published_at=now()-interval '2 days', created_at=now()-interval '2 days' WHERE id=$1", [card.d1]);
  await setContact(ids.driver, 'verified_recruiters', false);
  await setContact(ids.driver, 'verified_recruiters', true);
  expect((await discover(ids.owner)).map((c) => c.id)).toEqual([card.d2]);
});
it('HJ-1B discovery denies anonymous, staff, other-workspace and driver actors; anon has no EXECUTE', async () => {
  await expect(discover(null)).rejects.toMatchObject({ code: '42501' });
  await expect(discover(ids.staff)).rejects.toMatchObject({ code: '42501' });
  await expect(discover(ids.other)).rejects.toMatchObject({ code: '42501' });
  await expect(discover(ids.driver)).rejects.toMatchObject({ code: '42501' });
  const r = (await pool.query("SELECT has_function_privilege('anon',p.oid,'EXECUTE') a FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE proname='list_recruiter_job_search_cards'")).rows;
  expect(r.length).toBe(2); for (const x of r) expect(x.a).toBe(false);
  await expect(as(ids.owner, 'SELECT count(*) AS r FROM job_search_private.driver_job_search_cards')).rejects.toMatchObject({ code: '42501' });
});
