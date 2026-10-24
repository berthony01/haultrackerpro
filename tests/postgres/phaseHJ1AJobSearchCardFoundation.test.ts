// @vitest-environment node
// ACTUAL candidate in an explicit disposable local PostgreSQL cluster only.
// No managed PG* variables, production credentials, simplified auth mocks or skips.
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { validateJobSearchCardPayload } from '../../src/lib/jobSearch/jobSearchCardContract';
const socket=process.env.HJ1A_LOCAL_PG_SOCKET;
if (!socket || !socket.startsWith('/tmp/hj1a-pg/') || !socket.endsWith('/socket')) throw new Error('HJ1A_LOCAL_PG_SOCKET must explicitly target the isolated /tmp/hj1a-pg/ socket; no production or silent skip');
const config={host:socket,port:55439,user:'lovable',database:'postgres',password:'',ssl:false};
const candidatePath='supabase/migration-candidates/20261024041952_phase_hj1a_job_search_card_foundation.sql';
const sql=readFileSync(candidatePath,'utf8');
const restrictionSource=readFileSync('supabase/migrations/20260719183725_ee7ffc53-dcdc-4666-bcba-1aeac0f5d0cf.sql','utf8');
const restrictionTable=restrictionSource.match(/CREATE TABLE IF NOT EXISTS public\.marketplace_user_restrictions \([\s\S]*?\n\);/)?.[0];
const helperSource=readFileSync('supabase/migrations/20260916050500_phase_cf1a_conversation_foundation.sql','utf8');
const helper=helperSource.match(/CREATE OR REPLACE FUNCTION public\.user_has_blocking_messaging_restriction\([\s\S]*?\$function\$;/)?.[0];
if (!restrictionTable || !helper) throw new Error('Missing frozen production restriction definitions');
const users={driver:'11111111-1111-1111-1111-111111111111',other:'22222222-2222-2222-2222-222222222222',recruiter:'33333333-3333-3333-3333-333333333333',admin:'44444444-4444-4444-4444-444444444444',assistant:'55555555-5555-5555-5555-555555555555',dual:'66666666-6666-6666-6666-666666666666'};
const payload={state:'TX',cdl_class:'A',years_experience:5,experience_qualifier:'at_least',preferred_route_type:'Regional',preferred_home_time:'Weekly'};
let db:Client;
let before:unknown;
async function inventory() {
  return (await db.query(`SELECT jsonb_build_object(
    'tables',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'acl',c.relacl::text,'rls',c.relrowsecurity) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind='r'),
    'columns',(SELECT jsonb_agg(jsonb_build_object('table',table_name,'col',column_name,'type',udt_name,'default',column_default,'nullable',is_nullable) ORDER BY table_schema,table_name,ordinal_position) FROM information_schema.columns WHERE table_schema IN ('public','auth')),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','auth')),
    'constraints',(SELECT jsonb_agg(jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid)) ORDER BY c.conname) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('public','auth')),
    'triggers',(SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND NOT (t.tgisinternal AND t.tgconstraint IN (SELECT co.oid FROM pg_constraint co JOIN pg_namespace ns ON ns.oid=co.connamespace WHERE ns.nspname='job_search_private'))),
    'functions',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl::text) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth') AND p.proname <> 'manage_my_job_search_card')) AS inventory`)).rows[0].inventory;
}
async function command(user:string|null,action='get',p:unknown=null,revision:number|null=null,id:string|null=null,consent:string|null=null,role='authenticated',privateCall=false,client?:Client) {
 const c=client??db; await c.query('BEGIN');
 try { await c.query(`SET LOCAL ROLE ${role}`); await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user??'']);
 const r=await c.query(`SELECT ${privateCall?'job_search_private':'public'}.manage_my_job_search_card($1,$2::jsonb,$3,$4::uuid,$5) AS card`,[action,p===null?null:JSON.stringify(p),revision,id,consent]);
 await c.query('COMMIT'); return r.rows[0].card;
 } catch(e) { await c.query('ROLLBACK'); throw e; }
}
const publish=(user=users.driver,p:unknown=payload,rev=0,id=randomUUID(),privateCall=false,client?:Client)=>command(user,'publish',p,rev,id,'job_search_card_v1','authenticated',privateCall,client);
async function counts() { return (await db.query('SELECT (SELECT count(*)::int FROM job_search_private.driver_job_search_cards) AS cards,(SELECT count(*)::int FROM job_search_private.job_search_card_events) AS events')).rows[0]; }
beforeAll(async()=> {
 db=new Client(config); await db.connect();
 const version=(await db.query('SELECT version()')).rows[0].version; console.log('HJ-1A isolated SQL environment:',version);
 // Destructive fixture setup is allowed ONLY on the hard-pinned disposable socket.
 await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS job_search_private CASCADE;
 DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
 DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
 DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
 CREATE SCHEMA auth; GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE TYPE public.user_capability_type AS ENUM ('driver','recruiter');
 CREATE TYPE public.user_capability_status AS ENUM ('setup','active','suspended','revoked');
 CREATE TABLE public.user_capabilities(user_id uuid NOT NULL,capability public.user_capability_type NOT NULL,status public.user_capability_status NOT NULL,activated_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,capability));
 REVOKE ALL ON public.user_capabilities FROM PUBLIC,anon,authenticated; GRANT SELECT ON public.user_capabilities TO authenticated; GRANT ALL ON public.user_capabilities TO service_role;
 ALTER TABLE public.user_capabilities ENABLE ROW LEVEL SECURITY; CREATE POLICY user_capabilities_self_select ON public.user_capabilities FOR SELECT TO authenticated USING(user_id=auth.uid());
 ${restrictionTable}
 REVOKE ALL ON public.marketplace_user_restrictions FROM PUBLIC,anon,authenticated; GRANT ALL ON public.marketplace_user_restrictions TO service_role; ALTER TABLE public.marketplace_user_restrictions ENABLE ROW LEVEL SECURITY;
 ${helper}
 REVOKE ALL ON FUNCTION public.user_has_blocking_messaging_restriction(uuid) FROM PUBLIC,anon,authenticated;
 CREATE TABLE public.admin_users(user_id uuid,role text);
 CREATE TABLE public.driver_opportunity_profiles(user_id uuid PRIMARY KEY,private_contact text);
 CREATE TABLE public.existing_surface_sentinel(id integer PRIMARY KEY,secret text);
 INSERT INTO public.existing_surface_sentinel VALUES(1,'unchanged');
 ALTER TABLE public.existing_surface_sentinel ENABLE ROW LEVEL SECURITY;
 GRANT SELECT ON public.existing_surface_sentinel TO authenticated;
 CREATE POLICY sentinel_owner ON public.existing_surface_sentinel FOR SELECT TO authenticated USING(false);
 CREATE FUNCTION public.sentinel_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Existing sentinel immutable'; END $$;
 CREATE TRIGGER sentinel_immutable BEFORE UPDATE OR DELETE ON public.existing_surface_sentinel FOR EACH ROW EXECUTE FUNCTION public.sentinel_guard();
 -- Mirror production's hostile default function ACLs, which the candidate must revoke.
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
 ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
 `);
 before=await inventory(); await db.query(sql); expect(await inventory()).toEqual(before);
},30000);
afterAll(async()=>{await db?.end();});
beforeEach(async()=>{
 await db.query('TRUNCATE job_search_private.job_search_card_events,job_search_private.driver_job_search_cards,public.user_capabilities,public.marketplace_user_restrictions,public.admin_users,public.driver_opportunity_profiles,auth.users CASCADE');
 for (const u of Object.values(users)) await db.query('INSERT INTO auth.users VALUES($1)',[u]);
 for (const u of [users.driver,users.other,users.dual]) await db.query("INSERT INTO public.user_capabilities(user_id,capability,status) VALUES($1,'driver','active')",[u]);
 for (const u of [users.recruiter,users.dual]) await db.query("INSERT INTO public.user_capabilities(user_id,capability,status) VALUES($1,'recruiter','active')",[u]);
 await db.query("INSERT INTO public.admin_users VALUES($1,'super_admin');",[users.admin]);
 await db.query("INSERT INTO public.driver_opportunity_profiles VALUES($1,'never publish this contact')",[users.driver]);
});
describe('HJ-1A actual candidate owner-only SQL/roles/lifecycle',()=> {
 it('schema has exactly two RLS tables, no policies or client DML/schema CREATE',async()=>{
  const rows=(await db.query("SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='job_search_private' AND c.relkind='r' ORDER BY c.relname")).rows;
  expect(rows).toEqual([{relname:'driver_job_search_cards',relrowsecurity:true},{relname:'job_search_card_events',relrowsecurity:true}]);
  expect((await db.query("SELECT * FROM pg_policies WHERE schemaname='job_search_private'")).rows).toEqual([]);
  for(const role of ['anon','authenticated','service_role']) {
   for(const table of ['driver_job_search_cards','job_search_card_events']) for(const privilege of ['SELECT','INSERT','UPDATE','DELETE']) expect((await db.query('SELECT has_table_privilege($1,$2,$3) AS allowed',[role,`job_search_private.${table}`,privilege])).rows[0].allowed).toBe(false);
   expect((await db.query("SELECT has_schema_privilege($1,'job_search_private','CREATE') AS allowed",[role])).rows[0].allowed).toBe(false);
  }
  expect((await db.query("SELECT * FROM aclexplode((SELECT nspacl FROM pg_namespace WHERE nspname='job_search_private')) WHERE grantee=0")).rows).toEqual([]);
 });
 it('wrapper invoker/private definer with pinned path and only authenticated execute',async()=> {
  const rows=(await db.query("SELECT n.nspname,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname='manage_my_job_search_card' ORDER BY n.nspname")).rows;
  expect(rows).toEqual([{nspname:'job_search_private',prosecdef:true,proconfig:['search_path=pg_catalog, public, auth, job_search_private']},{nspname:'public',prosecdef:false,proconfig:['search_path=pg_catalog, public, auth, job_search_private']}]);
  for(const schema of ['public','job_search_private']) for(const role of ['anon','authenticated','service_role']) expect((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed',[role,`${schema}.manage_my_job_search_card(text,jsonb,integer,uuid,text)`])).rows[0].allowed).toBe(role==='authenticated');
 });
 it('authenticated SQL cannot read or mutate either private table directly',async()=>{
  for(const table of ['driver_job_search_cards','job_search_card_events']) {
   await db.query('BEGIN');try {await db.query('SET LOCAL ROLE authenticated');await expect(db.query(`SELECT * FROM job_search_private.${table}`)).rejects.toMatchObject({code:'42501'});}finally{await db.query('ROLLBACK');}
   await db.query('BEGIN');try {await db.query('SET LOCAL ROLE authenticated');await expect(db.query(`DELETE FROM job_search_private.${table}`)).rejects.toMatchObject({code:'42501'});}finally{await db.query('ROLLBACK');}
  }
 });
 it('get missing is null and write free',async()=>{expect(await command(users.driver)).toBeNull();expect(await counts()).toEqual({cards:0,events:0});});
 it('publishes narrow owner snapshot, 14 days, positive revision and server consent',async()=>{const c=await publish();expect(c.payload).toEqual(payload);expect(c.revision).toBe(1);expect(c.status).toBe('published');expect(c.audience).toBe('approved_recruiters');expect(c.consent_version).toBe('job_search_card_v1');expect(new Date(c.expires_at).getTime()-new Date(c.published_at).getTime()).toBe(14*86400000);expect(c).not.toHaveProperty('owner_user_id');expect(c.payload).not.toHaveProperty('private_contact');});
 it('cross-user/recruiter reads are null, own card remains visible',async()=>{const c=await publish();expect(await command(users.other)).toBeNull();expect(await command(users.recruiter)).toBeNull();expect((await command(users.driver)).id).toBe(c.id);});
 for(const role of ['anon','service_role']) it(`${role} has no wrapper access`,async()=>{await expect(command(users.driver,'get',null,null,null,null,role)).rejects.toMatchObject({code:'42501'});});
 it('missing identity fails including direct implementation',async()=>{await expect(command(null)).rejects.toMatchObject({code:'42501'});await expect(command(null,'get',null,null,null,null,'authenticated',true)).rejects.toMatchObject({code:'42501'});});
 for(const who of ['recruiter','admin','assistant'] as const) it(`${who} without driver cannot publish or impersonate`,async()=>{await expect(publish(users[who])).rejects.toMatchObject({code:'42501'});await expect(publish(users[who],payload,0,randomUUID(),true)).rejects.toMatchObject({code:'42501'});expect(await counts()).toEqual({cards:0,events:0});});
 it('dual capability active driver is allowed',async()=>expect((await publish(users.dual)).status).toBe('published'));
 it('assistant with own active driver can affect only own card',async()=>{await publish();await db.query("INSERT INTO public.user_capabilities(user_id,capability,status) VALUES($1,'driver','active')",[users.assistant]);const c=await publish(users.assistant,payload,0,randomUUID(),true);expect(c.id).not.toBe((await command(users.driver)).id);expect((await command(users.driver)).revision).toBe(1);});
 for(const status of ['setup','suspended','revoked']) it(`${status} blocks publish but retains own get/withdraw`,async()=>{await publish();await db.query("UPDATE public.user_capabilities SET status=$1 WHERE user_id=$2",[status,users.driver]);expect((await command(users.driver)).revision).toBe(1);await expect(publish(users.driver,payload,1)).rejects.toMatchObject({code:'42501'});expect((await command(users.driver,'withdraw',null,1,randomUUID())).status).toBe('withdrawn');});
 it('missing driver capability blocks new publication',async()=>{await db.query('DELETE FROM public.user_capabilities WHERE user_id=$1',[users.driver]);await expect(publish()).rejects.toMatchObject({code:'42501'});});
 for(const scope of ['messaging','all']) for(const restriction of ['blocked','read_only']) it(`${scope}/${restriction} blocks publish but not withdrawal`,async()=>{await publish();await db.query('INSERT INTO public.marketplace_user_restrictions(user_id,scope,restriction) VALUES($1,$2,$3)',[users.driver,scope,restriction]);await expect(publish(users.driver,payload,1)).rejects.toMatchObject({code:'42501'});expect((await command(users.driver,'withdraw',null,1,randomUUID())).status).toBe('withdrawn');});
 for(const variant of ['warned','applications','future','ended']) it(`nonblocking restriction ${variant} honors actual helper`,async()=>{await db.query(`INSERT INTO public.marketplace_user_restrictions(user_id,scope,restriction,starts_at,ends_at) VALUES($1,$2,$3,now()+$4::interval,CASE WHEN $5 THEN now()-interval '1 second' ELSE NULL END)`,[users.driver,variant==='applications'?'applications':'messaging',variant==='warned'?'warned':'blocked',variant==='future'?'1 day':'-1 day',variant==='ended']);expect((await publish()).status).toBe('published');});
 it('pause/withdraw increment revision; renew only reviewed current consent',async()=>{await publish();expect((await command(users.driver,'pause',null,1,randomUUID())).revision).toBe(2);expect((await publish(users.driver,payload,2)).revision).toBe(3);expect((await command(users.driver,'withdraw',null,3,randomUUID())).revision).toBe(4);await expect(command(users.driver,'publish',payload,4,randomUUID(),'old')).rejects.toMatchObject({code:'22023'});expect((await publish(users.driver,payload,4)).revision).toBe(5);});
 it('expiry computed at read boundary without writes and reviewed renewal extends expiry',async()=>{await publish();await db.query("UPDATE job_search_private.driver_job_search_cards SET expires_at=clock_timestamp()-interval '1 microsecond'");expect((await command(users.driver)).status).toBe('expired');expect(await counts()).toEqual({cards:1,events:1});const c=await publish(users.driver,payload,1);expect(c.revision).toBe(2);expect(c.status).toBe('published');expect(new Date(c.expires_at).getTime()-new Date(c.published_at).getTime()).toBe(14*86400000);});
 it('missing withdrawal is durable no-op without phantom card',async()=>{const id=randomUUID();expect(await command(users.driver,'withdraw',null,0,id)).toBeNull();expect(await command(users.driver,'withdraw',null,0,id)).toBeNull();expect(await counts()).toEqual({cards:0,events:1});await expect(publish(users.driver,payload,0,id)).rejects.toMatchObject({code:'22023'});});
 it('identical replay does not duplicate, late replay never reactivates withdrawn card',async()=>{const id=randomUUID();await publish(users.driver,payload,0,id);expect((await publish(users.driver,payload,0,id)).revision).toBe(1);await command(users.driver,'withdraw',null,1,randomUUID());expect((await publish(users.driver,payload,0,id)).status).toBe('withdrawn');expect(await counts()).toEqual({cards:1,events:2});});
 it('altered replay payload/revision/consent/action rejected and distinct stale commands rejected',async()=>{const id=randomUUID();await publish(users.driver,payload,0,id);await expect(publish(users.driver,{...payload,state:'CA'},0,id)).rejects.toMatchObject({code:'22023'});await expect(publish(users.driver,payload,1,id)).rejects.toMatchObject({code:'22023'});await expect(command(users.driver,'pause',null,1,id)).rejects.toMatchObject({code:'22023'});await expect(publish(users.driver,payload,0)).rejects.toMatchObject({code:'40001'});expect(await counts()).toEqual({cards:1,events:1});});
 it('semantically reordered trailers produce stable receipt and canonical payload',async()=>{const id=randomUUID();await publish(users.driver,{...payload,trailer_experience:['Reefer','Dry Van']},0,id);const c=await publish(users.driver,{...payload,trailer_experience:['Dry Van','Reefer']},0,id);expect(c.payload.trailer_experience).toEqual(['Dry Van','Reefer']);expect(await counts()).toEqual({cards:1,events:1});});
 for(const key of ['city','name','email','phone','telegram','owner_user_id','driver_user_id','recruiter_id','notes','transcript','profile','contact_consent']) it(`SQL rejects ${key} on wrapper and private call`,async()=>{const p={...payload,[key]:users.other};await expect(publish(users.driver,p)).rejects.toMatchObject({code:'22023'});await expect(publish(users.driver,p,0,randomUUID(),true)).rejects.toMatchObject({code:'22023'});expect(await counts()).toEqual({cards:0,events:0});});
 const invalid=[null,[],{...payload,years_experience:'5+'},{...payload,years_experience:61},{...payload,years_experience:-1},{...payload,years_experience:1.5},{...payload,years_experience:0,experience_qualifier:'less_than'},{...payload,experience_qualifier:null},{...payload,state:'tx'},{...payload,state:null},{...payload,cdl_class:'D'},{...payload,preferred_route_type:'Team'},{...payload,preferred_home_time:'Never'},{...payload,preferred_driver_type:'Solo'},{...payload,available_start_date:'2026-02-29'},{...payload,available_start_date:'0000-01-01'},{...payload,available_start_date:'2026-1-01'},{...payload,min_weekly_gross:0},{...payload,min_weekly_gross:100001},{...payload,min_weekly_gross:'1500'},{...payload,trailer_experience:['Reefer','Reefer']},{...payload,trailer_experience:['Other']},{...payload,trailer_experience:null}];
 for(const [i,p] of invalid.entries()) it(`SQL/pure reject malformed payload ${i}`,async()=>{expect(()=>validateJobSearchCardPayload(p)).toThrow();await expect(publish(users.driver,p)).rejects.toMatchObject({code:'22023'});expect(await counts()).toEqual({cards:0,events:0});});
 for(const key of Object.keys(payload)) it(`SQL requires ${key}`,async()=>{const p:Record<string,unknown>={...payload};delete p[key];await expect(publish(users.driver,p)).rejects.toMatchObject({code:'22023'});});
 it('SQL optional/boundary values mirror pure review',async()=>{const p={...payload,state:'DC',years_experience:60,available_start_date:'2028-02-29',min_weekly_gross:100000,preferred_driver_type:'Team',trailer_experience:['Reefer','Dry Van']};expect((await publish(users.driver,p)).payload).toEqual(validateJobSearchCardPayload(p));});
 it('SQL exact zero and omitted gross are not missing-value coercions',async()=>{const c=await publish(users.driver,{...payload,years_experience:0,experience_qualifier:'exact'});expect(c.payload.years_experience).toBe(0);expect(c.payload).not.toHaveProperty('min_weekly_gross');});
 it('receipt for absent withdrawal cannot change a later publication',async()=>{const id=randomUUID();await command(users.driver,'withdraw',null,0,id);await publish();expect((await command(users.driver,'withdraw',null,0,id)).status).toBe('published');expect(await counts()).toEqual({cards:1,events:2});});
 it('unknown action/extra arguments/missing revision/command fail closed',async()=>{for(const action of ['edit','GET','',null]) await expect(command(users.driver,action as string)).rejects.toMatchObject({code:'22023'});await expect(command(users.driver,'get',payload)).rejects.toMatchObject({code:'22023'});await expect(command(users.driver,'publish',payload,null,randomUUID(),'job_search_card_v1')).rejects.toMatchObject({code:'22023'});await expect(command(users.driver,'publish',payload,0,null,'job_search_card_v1')).rejects.toMatchObject({code:'22023'});await expect(command(users.driver,'withdraw',payload,0,randomUUID())).rejects.toMatchObject({code:'22023'});});
 it('events contain only receipts, no arbitrary request/profile/contact/transcript',async()=>{await publish();const e=(await db.query('SELECT * FROM job_search_private.job_search_card_events')).rows[0];expect(Object.keys(e).sort()).toEqual(['action','card_id','client_command_id','consent_version','created_at','id','input_fingerprint','owner_user_id','revision'].sort());expect(e.input_fingerprint).toMatch(/^[0-9a-f]{32}$/);expect(JSON.stringify(e)).not.toContain('Weekly');expect(JSON.stringify(e)).not.toContain('never publish');});
 it('candidate preserves existing inventories and profile/sentinel rows',async()=>{await publish();await command(users.driver,'withdraw',null,1,randomUUID());expect(await inventory()).toEqual(before);expect((await db.query('SELECT * FROM public.existing_surface_sentinel')).rows).toEqual([{id:1,secret:'unchanged'}]);expect((await db.query('SELECT private_contact FROM public.driver_opportunity_profiles')).rows).toEqual([{private_contact:'never publish this contact'}]);});
});
describe('HJ-1A REAL PostgreSQL concurrent sessions',()=>{
 async function pair() { const a=new Client(config),b=new Client(config);await a.connect();await b.connect();return [a,b]; }
 it('concurrent first publications: one wins, one stale, one card/event',async()=>{const [a,b]=await pair();try {const r=await Promise.allSettled([publish(users.driver,payload,0,randomUUID(),false,a),publish(users.driver,payload,0,randomUUID(),false,b)]);expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);const failure=r.find(x=>x.status==='rejected');expect(failure?.status==='rejected' && failure.reason.code).toBe('40001');expect(await counts()).toEqual({cards:1,events:1});}finally{await a.end();await b.end();}});
 it('concurrent identical retry publishes once',async()=>{const [a,b]=await pair();try{const id=randomUUID();const r=await Promise.all([publish(users.driver,payload,0,id,false,a),publish(users.driver,payload,0,id,false,b)]);expect(r[0]).toEqual(r[1]);expect(await counts()).toEqual({cards:1,events:1});}finally{await a.end();await b.end();}});
 it('concurrent pause/withdraw exact revision serializes one winner',async()=>{await publish();const [a,b]=await pair();try{const r=await Promise.allSettled([command(users.driver,'pause',null,1,randomUUID(),null,'authenticated',false,a),command(users.driver,'withdraw',null,1,randomUUID(),null,'authenticated',false,b)]);expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect((await command(users.driver)).revision).toBe(2);expect(await counts()).toEqual({cards:1,events:2});}finally{await a.end();await b.end();}});
 it('concurrent altered replay never silently overwrites',async()=>{const [a,b]=await pair();try{const id=randomUUID();const r=await Promise.allSettled([publish(users.driver,payload,0,id,false,a),publish(users.driver,{...payload,state:'CA'},0,id,false,b)]);expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);const f=r.find(x=>x.status==='rejected');expect(f?.status==='rejected' && f.reason.code).toBe('22023');expect(await counts()).toEqual({cards:1,events:1});}finally{await a.end();await b.end();}});
 it('late publication retry waits for withdrawal lock then reads withdrawn state',async()=>{
  const id=randomUUID();await publish(users.driver,payload,0,id);const [a,b]=await pair();
  try {
   await a.query('BEGIN');await a.query('SET LOCAL ROLE authenticated');await a.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[users.driver]);
   await a.query("SELECT public.manage_my_job_search_card('withdraw',NULL,1,$1::uuid,NULL)",[randomUUID()]);
   const retry=publish(users.driver,payload,0,id,false,b);
   // Observe real lock contention rather than treating embedded serialization as proof.
   let blocked=false;for(let i=0;i<100;i++){const r=await db.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT public.manage_my_job_search_card%' AND pid<>pg_backend_pid()");if(r.rowCount){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,5));}
   expect(blocked).toBe(true);await a.query('COMMIT');expect((await retry).status).toBe('withdrawn');expect(await counts()).toEqual({cards:1,events:2});
  }finally{await a.query('ROLLBACK');await a.end();await b.end();}
 });
});
