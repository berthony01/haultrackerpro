// @vitest-environment node
// Actual immutable HJ-1A and new HJ-1B candidates, isolated real PostgreSQL only.
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
const socket = process.env.HJ1B_LOCAL_PG_SOCKET;
if (socket !== '/tmp/hj1b-pg/socket')
    throw new Error('HJ1B_LOCAL_PG_SOCKET must be /tmp/hj1b-pg/socket. No skip or external database.');
const db = new Client({ host: socket, port: 55440, user: 'lovable', database: 'postgres', password: '', ssl: false });
const source = (p: string) => readFileSync(p, 'utf8');
function extract(p: string, pattern: RegExp) {
    const match = source(p).match(pattern)?.[0];
    if (!match)
        throw new Error(`Frozen helper missing in ${p}`);
    return match;
}
const restrictionTable = extract('supabase/migrations/20260719183725_ee7ffc53-dcdc-4666-bcba-1aeac0f5d0cf.sql', /CREATE TABLE IF NOT EXISTS public\.marketplace_user_restrictions \([\s\S]*?\n\);/);
const restrictionHelper = extract('supabase/migrations/20260916050500_phase_cf1a_conversation_foundation.sql', /CREATE OR REPLACE FUNCTION public\.user_has_blocking_messaging_restriction\([\s\S]*?\$function\$;/);
const ownerHelper = extract('supabase/migration-candidates/20260815020500_phase_rc1a_recruiter_workspace_membership_foundation.sql', /CREATE OR REPLACE FUNCTION public\.is_recruiter_workspace_owner\([\s\S]*?\$\$;/);
const readyHelper = extract('supabase/migration-candidates/20260725190000_phase1p_a1_recruiter_readiness_company_type.sql', /CREATE OR REPLACE FUNCTION public\.recruiter_profile_can_manage_opportunities\([\s\S]*?\$function\$;/);
const qaHelper = extract('supabase/migration-candidates/20260821050000_phase_tg2e3_o6_qa_fixture_root_registry.sql', /CREATE OR REPLACE FUNCTION public\.is_qa_fixture_root\([\s\S]*?\$\$;/);
const ids = { owner: randomUUID(), driver: randomUUID(), other: randomUUID(), staff: randomUUID(), admin: randomUUID(), workspace: randomUUID(), foreign: randomUUID() };
const payload = { state: 'TX', cdl_class: 'A', years_experience: 1, experience_qualifier: 'less_than', preferred_route_type: 'Regional', preferred_home_time: 'Weekly' };
let baseline: unknown;
async function inventory() {
    return (await db.query(`SELECT jsonb_build_object(
    'tables', (SELECT jsonb_agg(jsonb_build_object('name',n.nspname||'.'||c.relname,'acl',c.relacl::text,'rls',c.relrowsecurity) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','job_search_private') AND c.relkind='r'),
    'columns', (SELECT jsonb_agg(to_jsonb(c) ORDER BY table_schema,table_name,ordinal_position) FROM information_schema.columns c WHERE table_schema IN ('public','auth','job_search_private')),
    'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','auth','job_search_private')),
    'functions', (SELECT jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl::text) ORDER BY n.nspname,p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth','job_search_private') AND p.proname <> 'list_recruiter_job_search_cards'),
    'triggers', (SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','job_search_private')),
    'constraints', (SELECT jsonb_agg(pg_get_constraintdef(c.oid) ORDER BY c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('public','auth','job_search_private')),
    'schemas', (SELECT jsonb_agg(jsonb_build_object('name',nspname,'acl',nspacl::text) ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('public','auth','job_search_private'))
  ) AS inventory`)).rows[0].inventory;
}
async function call(actor: string | null = ids.owner, workspace: string | null = ids.workspace, limit: number | null = 20, published: string | null = null, cardId: string | null = null, role = 'authenticated', privateCall = false) {
    await db.query('BEGIN');
    try {
        await db.query(`SET LOCAL ROLE ${role}`);
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor ?? '']);
        const result = await db.query(`SELECT ${privateCall ? 'job_search_private' : 'public'}.list_recruiter_job_search_cards($1,$2,$3,$4) AS cards`, [workspace, limit, published, cardId]);
        await db.query('COMMIT');
        return result.rows[0].cards;
    }
    catch (e) {
        await db.query('ROLLBACK');
        throw e;
    }
}
async function publish(owner = ids.driver) {
    await db.query('BEGIN');
    try {
        await db.query('SET LOCAL ROLE authenticated');
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [owner]);
        const result = await db.query("SELECT public.manage_my_job_search_card('publish',$1::jsonb,0,$2,'job_search_card_v1') AS card", [JSON.stringify(payload), randomUUID()]);
        await db.query('COMMIT');
        return result.rows[0].card;
    }
    catch (e) {
        await db.query('ROLLBACK');
        throw e;
    }
}
beforeAll(async () => {
    await db.connect();
    console.log('HJ-1B isolated SQL:', (await db.query('SELECT version()')).rows[0].version);
    await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS job_search_private CASCADE;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TYPE public.user_capability_type AS ENUM ('driver','recruiter');
    CREATE TYPE public.user_capability_status AS ENUM ('setup','active','suspended','revoked');
    CREATE TABLE public.user_capabilities(user_id uuid NOT NULL,capability public.user_capability_type NOT NULL,status public.user_capability_status NOT NULL,activated_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),PRIMARY KEY(user_id,capability));
    CREATE TABLE public.recruiter_profiles(id uuid PRIMARY KEY,user_id uuid NOT NULL,status text NOT NULL,verification_status text NOT NULL,recruiter_name text,company_name text,recruiter_email text,company_type text,dot_number text,mc_number text,posting_terms_accepted_at timestamptz,legacy_terms_grandfathered_at timestamptz);
    CREATE TABLE public.opportunities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),recruiter_id uuid NOT NULL,status text NOT NULL,admin_review_status text NOT NULL);
    CREATE TABLE public.qa_fixture_roots(root_kind text NOT NULL CHECK(root_kind IN ('user','recruiter_profile','agency_profile')),root_id uuid NOT NULL,qa_owner_user_id uuid NOT NULL,active boolean NOT NULL DEFAULT true,PRIMARY KEY(root_kind,root_id));
    ${restrictionTable}
    ${restrictionHelper}
    ${ownerHelper}
    ${readyHelper}
    ${qaHelper}
    CREATE TABLE public.driver_opportunity_profiles(user_id uuid PRIMARY KEY,private_contact text);
    CREATE TABLE public.reader_sentinel(id integer PRIMARY KEY,value text);
    INSERT INTO public.reader_sentinel VALUES(1,'unchanged');
    CREATE FUNCTION public.reader_sentinel_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable sentinel'; END $$;
    CREATE TRIGGER reader_sentinel_immutable BEFORE UPDATE OR DELETE ON public.reader_sentinel FOR EACH ROW EXECUTE FUNCTION public.reader_sentinel_guard();
    ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
  `);
    for (const table of ['user_capabilities', 'recruiter_profiles', 'opportunities', 'qa_fixture_roots', 'marketplace_user_restrictions', 'driver_opportunity_profiles', 'reader_sentinel']) {
        await db.query(`REVOKE ALL ON public.${table} FROM PUBLIC,anon,authenticated; GRANT ALL ON public.${table} TO service_role; ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
    await db.query(`GRANT SELECT ON public.user_capabilities TO authenticated;
    CREATE POLICY self_capability ON public.user_capabilities FOR SELECT TO authenticated USING(user_id=auth.uid());
    CREATE POLICY sentinel_deny ON public.reader_sentinel FOR SELECT TO authenticated USING(false);
    REVOKE ALL ON FUNCTION public.user_has_blocking_messaging_restriction(uuid),public.recruiter_profile_can_manage_opportunities(uuid),public.is_qa_fixture_root(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION public.user_has_blocking_messaging_restriction(uuid),public.recruiter_profile_can_manage_opportunities(uuid),public.is_qa_fixture_root(text,uuid,uuid) TO service_role;`);
    await db.query(source('supabase/migration-candidates/20261024041952_phase_hj1a_job_search_card_foundation.sql'));
    baseline = await inventory();
    await db.query(source('supabase/migration-candidates/20261024045239_phase_hj1b_job_search_discovery.sql'));
    expect(await inventory()).toEqual(baseline);
}, 30000);
afterAll(async () => { await db.end(); });
beforeEach(async () => {
    await db.query('TRUNCATE job_search_private.job_search_card_events,job_search_private.driver_job_search_cards,public.user_capabilities,public.recruiter_profiles,public.opportunities,public.qa_fixture_roots,public.marketplace_user_restrictions,public.driver_opportunity_profiles,auth.users CASCADE');
    for (const user of [ids.owner, ids.driver, ids.other, ids.staff, ids.admin])
        await db.query('INSERT INTO auth.users VALUES($1)', [user]);
    for (const user of [ids.owner, ids.driver, ids.other])
        await db.query("INSERT INTO public.user_capabilities(user_id,capability,status) VALUES($1,'driver','active')", [user]);
    await db.query("INSERT INTO public.user_capabilities(user_id,capability,status) VALUES($1,'recruiter','active')", [ids.owner]);
    for (const [workspace, owner] of [[ids.workspace, ids.owner], [ids.foreign, ids.other]])
        await db.query("INSERT INTO public.recruiter_profiles VALUES($1,$2,'active','approved','Synthetic recruiter','Synthetic company','local@example.test','carrier','123',NULL,now(),NULL)", [workspace, owner]);
    await db.query("INSERT INTO public.opportunities(recruiter_id,status,admin_review_status) VALUES($1,'active','approved')", [ids.workspace]);
    await db.query("INSERT INTO public.driver_opportunity_profiles VALUES($1,'DO NOT LEAK')", [ids.driver]);
    await publish();
});
it('approved eligible owner gets strict employment projection; direct checked private path matches', async () => {
    const rows = await call();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(['id', 'revision', 'published_at', 'expires_at', 'payload'].sort());
    expect(rows[0].payload).toEqual(payload);
    expect(await call(ids.owner, ids.workspace, 20, null, null, 'authenticated', true)).toEqual(rows);
});
for (const role of ['anon', 'service_role'])
    it(`${role} cannot execute either reader`, async () => {
        for (const privateCall of [false, true])
            await expect(call(ids.owner, ids.workspace, 20, null, null, role, privateCall)).rejects.toMatchObject({ code: '42501' });
    });
it('reader invoker/definer paths and exact ACL; table privileges and schema CREATE unchanged', async () => {
    const rows = (await db.query("SELECT n.nspname,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE proname='list_recruiter_job_search_cards' ORDER BY n.nspname")).rows;
    expect(rows).toEqual([{ nspname: 'job_search_private', prosecdef: true, proconfig: ['search_path=pg_catalog, public, auth, job_search_private'] }, { nspname: 'public', prosecdef: false, proconfig: ['search_path=pg_catalog, public, auth, job_search_private'] }]);
    for (const schema of ['public', 'job_search_private'])
        for (const role of ['anon', 'authenticated', 'service_role'])
            expect((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed", [role, `${schema}.list_recruiter_job_search_cards(uuid,integer,timestamptz,uuid)`])).rows[0].allowed).toBe(role === 'authenticated');
    for (const role of ['anon', 'authenticated', 'service_role'])
        for (const table of ['driver_job_search_cards', 'job_search_card_events'])
            for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
                expect((await db.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [role, `job_search_private.${table}`, privilege])).rows[0].allowed).toBe(false);
    expect(await inventory()).toEqual(baseline);
});
for (const actor of [null, ids.driver, ids.staff, ids.admin])
    it(`non-owner actor ${actor ?? 'anonymous identity'} denied, no admin/paid/membership bypass`, async () => {
        await expect(call(actor)).rejects.toMatchObject({ code: '42501' });
    });
it('foreign workspace denied even for active recruiter', async () => { await expect(call(ids.owner, ids.foreign)).rejects.toMatchObject({ code: '42501' }); });
for (const status of ['setup', 'revoked', 'suspended', 'missing'])
    it(`recruiter capability ${status} denied`, async () => {
        if (status === 'missing')
            await db.query("DELETE FROM public.user_capabilities WHERE user_id=$1 AND capability='recruiter'", [ids.owner]);
        else
            await db.query("UPDATE public.user_capabilities SET status=$1 WHERE user_id=$2 AND capability='recruiter'", [status, ids.owner]);
        await expect(call()).rejects.toMatchObject({ code: '42501' });
    });
for (const status of ['pending', 'rejected', 'suspended'])
    it(`verification ${status} denied`, async () => { await db.query('UPDATE public.recruiter_profiles SET verification_status=$1 WHERE id=$2', [status, ids.workspace]); await expect(call()).rejects.toMatchObject({ code: '42501' }); });
for (const column of ['recruiter_name', 'company_name', 'recruiter_email', 'company_type', 'dot_number', 'posting_terms_accepted_at'])
    it(`incomplete ${column} denied`, async () => {
        await db.query(`UPDATE public.recruiter_profiles SET ${column}=NULL WHERE id=$1`, [ids.workspace]);
        await expect(call()).rejects.toMatchObject({ code: '42501' });
    });
it('invalid recruiter email and company type denied', async () => {
    await db.query("UPDATE public.recruiter_profiles SET recruiter_email='bad' WHERE id=$1", [ids.workspace]);
    await expect(call()).rejects.toMatchObject({ code: '42501' });
    await db.query("UPDATE public.recruiter_profiles SET recruiter_email='local@example.test',company_type='unknown' WHERE id=$1", [ids.workspace]);
    await expect(call()).rejects.toMatchObject({ code: '42501' });
});
it('non-carrier and grandfathered terms follow canonical readiness', async () => {
    await db.query("UPDATE public.recruiter_profiles SET company_type='independent_recruiter',dot_number=NULL,posting_terms_accepted_at=NULL,legacy_terms_grandfathered_at=now() WHERE id=$1", [ids.workspace]);
    expect(await call()).toHaveLength(1);
});
it('inactive recruiter profile denied', async () => { await db.query("UPDATE public.recruiter_profiles SET status='suspended' WHERE id=$1", [ids.workspace]); await expect(call()).rejects.toMatchObject({ code: '42501' }); });
for (const who of ['owner', 'driver'] as const)
    for (const restriction of ['blocked', 'read_only'])
        it(`${who} messaging ${restriction} rechecked each fetch`, async () => {
            expect(await call()).toHaveLength(1);
            await db.query("INSERT INTO public.marketplace_user_restrictions(user_id,scope,restriction,starts_at) VALUES($1,'messaging',$2,now()-interval '1 day')", [ids[who], restriction]);
            if (who === 'owner')
                await expect(call()).rejects.toMatchObject({ code: '42501' });
            else
                expect(await call()).toEqual([]);
        });
for (const root of ['actor', 'workspace', 'driver'])
    it(`QA ${root} excluded using supported root kinds`, async () => {
        await db.query('INSERT INTO public.qa_fixture_roots VALUES($1,$2,$3,true)', [root === 'workspace' ? 'recruiter_profile' : 'user', root === 'workspace' ? ids.workspace : root === 'actor' ? ids.owner : ids.driver, ids.admin]);
        if (root === 'driver')
            expect(await call()).toEqual([]);
        else
            await expect(call()).rejects.toMatchObject({ code: '42501' });
    });
it('own card excluded and inactive QA roots do not hide real cards', async () => {
    await publish(ids.owner);
    await db.query("INSERT INTO public.qa_fixture_roots VALUES('user',$1,$2,false)", [ids.driver, ids.admin]);
    expect(await call()).toHaveLength(1);
});
for (const status of ['paused', 'withdrawn', 'expired', 'revoked', 'restricted'])
    it(`driver ${status} hidden`, async () => {
        if (status === 'expired')
            await db.query("UPDATE job_search_private.driver_job_search_cards SET expires_at=now()-interval '1 second'");
        else if (status === 'revoked')
            await db.query("UPDATE public.user_capabilities SET status='revoked' WHERE user_id=$1", [ids.driver]);
        else if (status === 'restricted')
            await db.query("INSERT INTO public.marketplace_user_restrictions(user_id,scope,restriction) VALUES($1,'all','blocked')", [ids.driver]);
        else
            await db.query('UPDATE job_search_private.driver_job_search_cards SET status=$1', [status]);
        expect(await call()).toEqual([]);
    });
for (const variant of ['closed', 'pending', 'foreign_only', 'none'])
    it(`opportunity ${variant} cannot unlock discovery`, async () => {
        if (variant === 'closed')
            await db.query("UPDATE public.opportunities SET status='closed'");
        else if (variant === 'pending')
            await db.query("UPDATE public.opportunities SET admin_review_status='pending'");
        else if (variant === 'foreign_only')
            await db.query('UPDATE public.opportunities SET recruiter_id=$1', [ids.foreign]);
        else
            await db.query('DELETE FROM public.opportunities');
        await expect(call()).rejects.toMatchObject({ code: '42501' });
    });
for (const limit of [null, 0, -1, 51])
    it(`limit ${limit} rejects`, async () => { await expect(call(ids.owner, ids.workspace, limit)).rejects.toMatchObject({ code: '22023' }); });
it('null workspace/half cursor/nonfinite cursor reject; valid unknown tuple is simply keyset', async () => {
    await expect(call(ids.owner, null)).rejects.toMatchObject({ code: '22023' });
    await expect(call(ids.owner, ids.workspace, 20, new Date().toISOString(), null)).rejects.toMatchObject({ code: '22023' });
    await expect(call(ids.owner, ids.workspace, 20, null, randomUUID())).rejects.toMatchObject({ code: '22023' });
    await expect(call(ids.owner, ids.workspace, 20, 'infinity', randomUUID())).rejects.toMatchObject({ code: '22023' });
    expect(await call(ids.owner, ids.workspace, 20, '2000-01-01T00:00:00Z', randomUUID())).toEqual([]);
});
it('strict ordered bounded pages with same-date tie-break and eligibility revalidation', async () => {
    for (let i = 0; i < 24; i++) {
        const owner = randomUUID();
        await db.query('INSERT INTO auth.users VALUES($1)', [owner]);
        await db.query("INSERT INTO public.user_capabilities(user_id,capability,status) VALUES($1,'driver','active')", [owner]);
        await publish(owner);
    }
    await db.query("UPDATE job_search_private.driver_job_search_cards SET published_at='2026-10-24T00:00:00Z',expires_at=now()+interval '14 days'");
    const first = await call(ids.owner, ids.workspace, 20);
    expect(first).toHaveLength(20);
    const cursor = first[19];
    const second = await call(ids.owner, ids.workspace, 20, cursor.published_at, cursor.id);
    expect(second).toHaveLength(5);
    const all = [...first, ...second];
    expect(new Set(all.map(c => c.id)).size).toBe(25);
    expect(all.map(c => c.id)).toEqual(all.map(c => c.id).sort().reverse());
    expect(await call(ids.owner, ids.workspace, 1)).toHaveLength(1);
    expect(await call(ids.owner, ids.workspace, 50)).toHaveLength(25);
    await db.query("UPDATE public.user_capabilities SET status='revoked' WHERE user_id=$1 AND capability='recruiter'", [ids.owner]);
    await expect(call(ids.owner, ids.workspace, 20, cursor.published_at, cursor.id)).rejects.toMatchObject({ code: '42501' });
});
it('malicious stored payload key cannot leak and reader is side-effect free', async () => {
    await db.query(`UPDATE job_search_private.driver_job_search_cards SET payload=payload||'{"owner_user_id":"secret","phone":"secret","city":"secret","transcript":"secret"}'::jsonb`);
    const before = (await db.query('SELECT (SELECT count(*) FROM job_search_private.job_search_card_events) AS events,(SELECT jsonb_agg(c) FROM job_search_private.driver_job_search_cards c) AS cards')).rows;
    const rows = await call();
    expect(rows[0].payload).toEqual(payload);
    expect(JSON.stringify(rows)).not.toContain('secret');
    expect((await db.query('SELECT (SELECT count(*) FROM job_search_private.job_search_card_events) AS events,(SELECT jsonb_agg(c) FROM job_search_private.driver_job_search_cards c) AS cards')).rows).toEqual(before);
    expect(await inventory()).toEqual(baseline);
    expect((await db.query('SELECT * FROM public.reader_sentinel')).rows).toEqual([{ id: 1, value: 'unchanged' }]);
    expect((await db.query('SELECT private_contact FROM public.driver_opportunity_profiles')).rows).toEqual([{ private_contact: 'DO NOT LEAK' }]);
});
