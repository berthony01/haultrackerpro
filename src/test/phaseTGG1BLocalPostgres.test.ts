// @vitest-environment node
// Disposable PostgreSQL 17.11, NEVER a configured/database URL. No network listener.
// Real candidate and production-used authorization/status/wrapper bodies; schema
// projections reuse the accepted local fixture. Synthetic rows only. Connections
// execute RPCs as service_role, denial probes as anon/authenticated, not owner.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { SOURCES, exactFunction, uid } from './fixtures/phase3AssistantBootstrap';

let dir = '', pool: pg.Pool;
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG') && k !== 'DATABASE_URL'));
const run = (bin: string, args: string[]) => execFileSync('setpriv', ['--reuid=1000','--regid=1000','--clear-groups',bin,...args], { env, stdio: 'pipe' });
const read = (p: string) => readFileSync(p,'utf8');
const mig = (p: string) => read('supabase/migrations/'+p);
const R=uid(101), D=uid(2), OWNER=uid(1), STAFF=uid(3), REL=uid(201), LOAD=uid(301), LEASE=uid(901);
async function q(sql: string, params: unknown[] = []) { return (await pool.query(sql,params)).rows; }
async function rpc(sql: string, params: unknown[] = [], role='service_role') {
  const c=await pool.connect();
  try { await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${role}`); const rows=(await c.query(sql,params)).rows; await c.query('COMMIT'); return rows; }
  catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
const QA_LOAD='cb3d3a90-ac48-4d20-af52-d6710d854e81';
const QA_CANDIDATE='supabase/migration-candidates/20261031040000_qa_single_load_dispatch_review.sql';
const hash=(n: number)=>n.toString(16).padStart(64,'0');
function intake(n=10, ref: string|null='AB-123', chat=-100, h=hash(n)) {
 return rpc('SELECT * FROM telegram_process_dispatch_group_update($1,$2,$3,900,$4,\'group\',$5,$6)',[LEASE,n,h,chat,ref,ref ? 'completed':null]);
}
async function proposal() { const rows=await intake(); expect(rows[0]?.result_code).toBe('dispatch_review_proposed'); return rows[0].proposal_id as string; }
function review(id: string,n=30,user=501,chat=-100,action='accept') {
 return rpc("SELECT * FROM telegram_process_dispatch_review_action($1,$2,$3,$4,$5,'group',$6,$7)",[LEASE,n,hash(n),user,chat,action,id]);
}
const claim=()=>rpc('SELECT * FROM telegram_claim_dispatch_review_delivery()');
const ack=(c: Record<string,unknown>,token=c.claim_token)=>rpc('SELECT telegram_ack_dispatch_review_delivery($1,$2,123) ok',[c.outbox_id,token]);
const fail=(c: Record<string,unknown>)=>rpc("SELECT telegram_fail_dispatch_review_delivery($1,$2,'network') ok",[c.outbox_id,c.claim_token]);
async function counts() { return (await q(`SELECT (SELECT count(*)::int FROM telegram_dispatch_review_proposals) p,(SELECT count(*)::int FROM telegram_dispatch_review_outbox) o,(SELECT count(*)::int FROM telegram_update_receipts) r,(SELECT count(*)::int FROM load_events) e`))[0]; }
const DEADLINE_REPAIR='supabase/migration-candidates/20261102_general_dispatch_deadline_repair.sql';
const DEADLINE_RESTORE='supabase/migration-candidates/20261102_general_dispatch_deadline_restore.sql';
const BASELINE_DEADLINE_HASHES:Record<string,string>={telegram_process_dispatch_review_action:'834d89f6186a920b3805e32bd42e8fef',telegram_claim_dispatch_review_delivery:'5e38139dad516002d11804e8753c2e83'};
const REPAIRED_DEADLINE_HASHES:Record<string,string>={telegram_process_dispatch_review_action:'df914d4a72536fb05a33301ecc72701b',telegram_claim_dispatch_review_delivery:'f249d3b36ee6a33ecd1b239ec9fb383d'};
let baselineDeadlineDefinitions:pg.QueryResultRow[]=[];
async function deadlineDefinitions(){return q("SELECT proname,md5(prosrc) hash,pg_get_functiondef(oid) def,proowner,proacl,proconfig,prosecdef FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1::text[]) ORDER BY proname",[Object.keys(BASELINE_DEADLINE_HASHES)]);}
async function qaDefinitions(){return q("SELECT proname,pg_get_functiondef(oid) def,proowner,proacl FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'telegram_qa_%' OR proname LIKE '_telegram_qa_%' OR proname LIKE 'telegram_genqa_%' OR proname LIKE '_telegram_genqa_%') ORDER BY proname");}
async function assertDeadlineHashes(expected:Record<string,string>,label:string){
 for(const [name,md5] of Object.entries(expected)){
  const installed=await q("SELECT md5(prosrc) hash FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1",[name]);
  console.log(label,name,JSON.stringify(installed));
  expect(installed, 'STOP: installed generic function body differs from reviewed version').toEqual([{hash:md5}]);
 }
}
async function applyDeadlineCandidate(path:string){
 const c=await pool.connect();
 try{await c.query(read(path));}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}

beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'tgg1b-local-')); execFileSync('chown',['1000:1000',dir]);
 run('initdb',['-D',join(dir,'data'),'-U','local_owner','-A','trust','--no-locale']);
 run('pg_ctl',['-D',join(dir,'data'),'-l',join(dir,'postgres.log'),'-o',`-k ${dir} -h '' -p 55439`,'-w','start']);
 // Explicit socket/user/db/port: no production PG environment is consulted.
 pool=new pg.Pool({host:dir,port:55439,user:'local_owner',database:'postgres',password:'',options:'',ssl:false,max:8,statement_timeout:10000});
 expect((await q('SHOW server_version'))[0].server_version).toContain('17.11');
 await q(read('src/test/fixtures/phase3AssistantCanonical.sql'));
 for(const [path,names] of SOURCES) for(const name of names) await q(exactFunction(mig(path),name));
 // Exact relationship schema and Telegram identity/binding DDL from migrations.
 const relSql=mig('20260808161500_phase1t_b1_settlement_schema.sql');
 await q(relSql.slice(relSql.indexOf('CREATE TABLE public.carrier_driver_relationships'),relSql.indexOf('-- ---------------------------------------------------------------------------\n-- 2)')));
 await q(`CREATE TABLE loads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),status text CHECK(status IN('pending','en_route','completed','cancelled')),load_reference text,carrier_driver_relationship_id uuid REFERENCES carrier_driver_relationships(id),updated_by_user_id uuid);
 ALTER TABLE loads ENABLE ROW LEVEL SECURITY; GRANT ALL ON loads TO service_role;`);
 const tg=mig('20260820050546_547ac998-f935-423e-be67-c1be3923948d.sql');
 await q(tg.slice(tg.indexOf('CREATE TABLE public.telegram_user_links'),tg.lastIndexOf('-- ---------------------------------------------------------------------------',tg.indexOf('-- C. public.telegram_link_tokens'))));
 const dispatch=mig('20260819162100_2a7bb78e-ad6a-4417-a7d1-28ef6ba433aa.sql');
 await q(dispatch.slice(dispatch.indexOf('CREATE TABLE IF NOT EXISTS public.load_events'),dispatch.indexOf('-- G. Dispatch authorization helper')));
 await q(exactFunction(dispatch,'current_user_can_dispatch_load_action'));
 await q(exactFunction(dispatch,'dispatch_update_driver_load_status'));
 const wrapper=mig('20260820050715_5b9a6500-4d1b-4e0d-952a-b5df8870c999.sql');
 const start=wrapper.indexOf('CREATE FUNCTION public.telegram_dispatch_update_driver_load_status');
 await q(wrapper.slice(start,wrapper.indexOf('$$;',start)+3));
 const receipts=mig('20260820050855_dfdb35b3-88b9-4015-b3f5-8b3d5108b769.sql');
 await q(receipts.slice(receipts.indexOf('CREATE TABLE public.telegram_poll_state'),receipts.indexOf('-- A3. RLS')));
 await q(`ALTER TABLE telegram_update_receipts DROP CONSTRAINT telegram_update_receipts_update_type_check;
 ALTER TABLE telegram_update_receipts ADD CONSTRAINT telegram_update_receipts_update_type_check CHECK(update_type IN('message','callback_query'));
 ALTER TABLE telegram_update_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE telegram_poll_state ENABLE ROW LEVEL SECURITY;
 GRANT ALL ON telegram_update_receipts,telegram_poll_state,telegram_user_links,telegram_chat_bindings TO service_role;`);
 // Internal helpers not exposed as extra client capabilities in local fixture.
 for(const f of await q("SELECT p.oid::regprocedure::text sig FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public'"))
  await q(`REVOKE ALL ON FUNCTION ${f.sig} FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION ${f.sig} TO service_role`);
 await q(read('supabase/migration-candidates/20261029183000_tgg1b_dispatch_review_queue.sql'));
 // Faithful live membership lifecycle column, absent from older projection.
 await q('ALTER TABLE recruiter_members ADD COLUMN revoked_at timestamptz');
 await q(read('supabase/migration-candidates/20261031030000_telegram_dispatch_guidance.sql'));
 // Candidate validation uses exact production prosrc, not a simplified mock.
 await seedFixture();
 await q("INSERT INTO loads(id,user_id,status,load_reference,carrier_driver_relationship_id) VALUES($1,$2,'pending','HTP-QA-L2',$3)",[QA_LOAD,D,REL]);
 await q(read(QA_CANDIDATE));
 // New candidate is compiled byte-for-byte against canonical function hashes.
 await seedGenFixture();
 await q(read(GEN_CANDIDATE));
 // Production numeric/nullability/default projection; no invented recompute trigger.
 await q(`ALTER TABLE loads ADD COLUMN loaded_miles numeric NOT NULL DEFAULT 0, ADD COLUMN deadhead_miles numeric NOT NULL DEFAULT 0, ADD COLUMN rate_per_mile numeric NOT NULL DEFAULT 0, ADD COLUMN total_miles numeric, ADD COLUMN estimated_pay numeric, ADD COLUMN actual_pay_received numeric, ADD COLUMN gross_revenue numeric, ADD COLUMN flat_rate_amount numeric, ADD COLUMN wait_fee numeric NOT NULL DEFAULT 0, ADD COLUMN detention_fee numeric NOT NULL DEFAULT 0, ADD COLUMN other_fees numeric NOT NULL DEFAULT 0;`);
 // Strict baseline gate AFTER all existing candidates; repair ONLY this disposable socket DB.
 await assertDeadlineHashes(BASELINE_DEADLINE_HASHES,'GENERAL_BASELINE_MD5');
 baselineDeadlineDefinitions=await deadlineDefinitions();
 const qaBefore=await qaDefinitions();
 await applyDeadlineCandidate(DEADLINE_REPAIR);
 await assertDeadlineHashes(REPAIRED_DEADLINE_HASHES,'GENERAL_REPAIRED_MD5');
 expect(await qaDefinitions()).toEqual(qaBefore);
},60000);
async function seedFixture() {
 await q('TRUNCATE auth.users,telegram_update_receipts CASCADE');
 for(let n=1;n<=5;n++) await q('INSERT INTO auth.users VALUES($1)',[uid(n)]);
 await q(`INSERT INTO recruiter_profiles(id,user_id,recruiter_name,company_name,status,company_type,posting_terms_accepted_at) VALUES('${R}','${OWNER}','Local','Local','active','carrier',now()),('${uid(102)}','${uid(4)}','Other','Other','active','carrier',now());
 INSERT INTO user_capabilities VALUES('${OWNER}','recruiter','active'),('${uid(4)}','recruiter','active');
 INSERT INTO recruiter_billing_profiles VALUES('${R}','${OWNER}','growth','active');
 INSERT INTO recruiter_members(recruiter_id,member_user_id,status,role,permissions) VALUES('${R}','${OWNER}','active','recruiter_owner','{}'),('${R}','${STAFF}','active','recruiter_staff','{"loads_update_status":true}');
 INSERT INTO carrier_driver_relationships(id,recruiter_id,driver_user_id,status,created_by_user_id) VALUES('${REL}','${R}','${D}','active','${OWNER}'),('${uid(202)}','${uid(102)}','${uid(5)}','active','${uid(4)}');
 INSERT INTO loads(id,user_id,status,load_reference,carrier_driver_relationship_id,updated_by_user_id) VALUES('${LOAD}','${D}','en_route','AB-123','${REL}',NULL),('${uid(302)}','${uid(5)}','pending','ZZ-999','${uid(202)}',NULL);
 INSERT INTO telegram_chat_bindings(id,telegram_chat_id,recruiter_id,chat_type,bound_by_user_id) VALUES('${uid(401)}',-100,'${R}','group','${OWNER}'),('${uid(402)}',-200,'${uid(102)}','group','${uid(4)}');
 INSERT INTO telegram_user_links(telegram_user_id,user_id) VALUES(501,'${STAFF}'),(502,'${uid(4)}');
 UPDATE telegram_poll_state SET lease_token='${LEASE}',lease_expires_at=now()+interval '1 hour';`);
}
beforeEach(seedFixture);
afterAll(async()=>{ await pool?.end(); if(dir) { try { run('pg_ctl',['-D',join(dir,'data'),'-m','immediate','-w','stop']); } finally { rmSync(dir,{recursive:true,force:true}); } } });

describe('TG-G1B real disposable PostgreSQL transactions',()=>{
 it('guidance checks explicit permission, exact bound workspace and restores caller identity',async()=>{
   const c=await pool.connect();
   try {
     await c.query('BEGIN'); await c.query('SET LOCAL ROLE service_role');
     await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[OWNER]);
     expect((await c.query("SELECT telegram_get_dispatch_guidance(501,-100,'group') ok")).rows[0].ok).toBe(true);
     expect((await c.query("SELECT telegram_get_dispatch_guidance(501,-200,'group') ok")).rows[0].ok).toBe(false);
     expect((await c.query("SELECT telegram_get_dispatch_guidance(501,NULL,'private') ok")).rows[0].ok).toBe(true);
     expect((await c.query("SELECT current_setting('request.jwt.claim.sub') s")).rows[0].s).toBe(OWNER);
   } finally { await c.query('ROLLBACK'); c.release(); }
 });
 it.each(['anon','authenticated'])('%s cannot invoke guidance',async(role)=>{
   await expect(rpc("SELECT telegram_get_dispatch_guidance(501,-100,'group')",[],role)).rejects.toMatchObject({code:'42501'});
 });
 it.each([
   "UPDATE telegram_user_links SET status='revoked',revoked_at=now() WHERE telegram_user_id=501",
   "UPDATE telegram_chat_bindings SET status='revoked',revoked_at=now() WHERE telegram_chat_id=-100",
   "UPDATE recruiter_members SET status='revoked',revoked_at=now() WHERE member_user_id='"+STAFF+"'",
   "UPDATE recruiter_members SET permissions='{}' WHERE member_user_id='"+STAFF+"'",
   "UPDATE recruiter_members SET permissions='{\"loads_update_status\":\"true\"}' WHERE member_user_id='"+STAFF+"'",
   "UPDATE recruiter_members SET permissions='{\"loads_update_status\":false}' WHERE member_user_id='"+STAFF+"'",
   "UPDATE recruiter_profiles SET status='suspended' WHERE id='"+R+"'",
   "UPDATE recruiter_billing_profiles SET status='canceled' WHERE recruiter_id='"+R+"'",
 ])('guidance denies revoked/missing/invalid authority: %s',async(sql)=>{
   await q(sql); expect((await rpc("SELECT telegram_get_dispatch_guidance(501,-100,'group') ok"))[0].ok).toBe(false);
 });
 it('guidance denies unlinked, mismatched type, absent binding and unrelated owner',async()=>{
   for(const sql of ["(999,-100,'group')","(501,-100,'supergroup')","(501,-999,'group')","(502,-100,'group')","(501,NULL,'group')","(501,-100,'private')"])
     expect((await rpc('SELECT telegram_get_dispatch_guidance'+sql+' ok'))[0].ok).toBe(false);
 });
 it('exact linked owner is allowed without a duplicate membership, including private guidance',async()=>{
   await q('DELETE FROM recruiter_members WHERE member_user_id=$1',[OWNER]);
   await q('INSERT INTO telegram_user_links(telegram_user_id,user_id) VALUES(503,$1)',[OWNER]);
   for(const args of ["(503,-100,'group')","(503,NULL,'private')"])
     expect((await rpc('SELECT telegram_get_dispatch_guidance'+args+' ok'))[0].ok).toBe(true);
   expect((await rpc("SELECT telegram_get_dispatch_guidance(503,-200,'group') ok"))[0].ok).toBe(false);
 });
 it.each(['unlinked','revoked','suspended','unbound'])('exact owner denied when %s',async(state)=>{
   if(state!=='unlinked') await q('INSERT INTO telegram_user_links(telegram_user_id,user_id) VALUES(503,$1)',[OWNER]);
   if(state==='revoked') await q("UPDATE telegram_user_links SET status='revoked',revoked_at=now() WHERE telegram_user_id=503");
   if(state==='suspended') await q("UPDATE recruiter_profiles SET status='suspended' WHERE id=$1",[R]);
   if(state==='unbound') await q("UPDATE telegram_chat_bindings SET status='revoked',revoked_at=now() WHERE telegram_chat_id=-100");
   expect((await rpc("SELECT telegram_get_dispatch_guidance(503,-100,'group') ok"))[0].ok).toBe(false);
 });
 it('staff over seat capacity denies while canonical exact-owner authority is preserved',async()=>{
   await q('INSERT INTO telegram_user_links(telegram_user_id,user_id) VALUES(503,$1)',[OWNER]);
   const limit=(await q('SELECT recruiter_team_seat_limit($1) n',[R]))[0].n as number;
   expect(limit).toBeGreaterThan(0);
   for(let n=0;n<limit;n++) await q("INSERT INTO recruiter_members(recruiter_id,member_user_id,status,role,permissions) VALUES($1,$2,'active','recruiter_staff','{}')",[R,uid(1000+n)]);
   expect((await rpc("SELECT telegram_get_dispatch_guidance(501,-100,'group') ok"))[0].ok).toBe(false);
   expect((await rpc("SELECT telegram_get_dispatch_guidance(503,-100,'group') ok"))[0].ok).toBe(true);
 });
 it('guidance EXECUTE ACL contains service_role only, never PUBLIC or client roles',async()=>{
   const acl=await q("SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END role FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.telegram_get_dispatch_guidance(bigint,bigint,text)'::regprocedure AND a.privilege_type='EXECUTE'");
   const roles=acl.map(row=>row.role);
   expect(roles).toContain('service_role');
   for(const role of ['PUBLIC','anon','authenticated']) expect(roles).not.toContain(role);
 });
 it('expired pending invitation cannot provide dispatch delegation',async()=>{
   await q("UPDATE recruiter_members SET member_user_id=NULL,status='pending',invite_token_hash='expired-local',invite_expires_at=now()-interval '1 minute' WHERE member_user_id=$1",[STAFF]);
   expect((await rpc("SELECT telegram_get_dispatch_guidance(501,-100,'group') ok"))[0].ok).toBe(false);
 });
 it('read-only guidance leaves loads, receipts, proposals and delivery untouched',async()=>{
   const before=await counts();
   await rpc("SELECT telegram_get_dispatch_guidance(501,-100,'group')");
   await q('INSERT INTO telegram_user_links(telegram_user_id,user_id) VALUES(503,$1)',[OWNER]);
   const state=await q('SELECT row_to_json(l) row FROM loads l ORDER BY id');
   await rpc("SELECT telegram_get_dispatch_guidance(503,-100,'group')");
   expect(await q('SELECT row_to_json(l) row FROM loads l ORDER BY id')).toEqual(state);
   expect(await counts()).toEqual(before);
   expect((await q('SELECT status FROM loads WHERE id=$1',[LOAD]))[0].status).toBe('en_route');
 });
 it('intake atomically enqueues one durable notification, no load update',async()=>{await proposal();expect(await counts()).toEqual({p:1,o:1,r:1,e:0});expect((await q('SELECT status FROM loads WHERE id=$1',[LOAD]))[0].status).toBe('en_route');});
 it('concurrent identical receipts dedupe to one proposal/outbox',async()=>{const r=await Promise.all([intake(),intake()]);expect(r.map(x=>x[0].is_new).sort()).toEqual([false,true]);expect(await counts()).toEqual({p:1,o:1,r:1,e:0});});
 it('content conflict rolls back without an extra notification',async()=>{await proposal();await expect(intake(10,'AB-123',-100,hash(999))).rejects.toThrow('telegram_update_conflict');expect(await counts()).toEqual({p:1,o:1,r:1,e:0});});
 it('invalid lease writes nothing',async()=>{await q('UPDATE telegram_poll_state SET lease_token=NULL,lease_expires_at=NULL');await expect(intake()).rejects.toThrow('telegram_poll_lease_invalid');expect(await counts()).toEqual({p:0,o:0,r:0,e:0});});
 it('no action and other tenant refs have receipts but no proposal',async()=>{expect((await intake(1,null))[0].result_code).toBe('dispatch_review_no_action');expect((await intake(2,'ZZ-999'))[0].result_code).toBe('dispatch_review_no_action');expect(await counts()).toEqual({p:0,o:0,r:2,e:0});});
 it('duplicate scoped references fail closed',async()=>{await q('INSERT INTO loads(id,user_id,status,load_reference,carrier_driver_relationship_id) VALUES($1,$2,\'pending\',\'AB-123\',$3)',[uid(303),D,REL]);expect((await intake())[0].result_code).toBe('dispatch_review_no_action');expect((await counts()).o).toBe(0);});
 it('receipt insert failure rolls back proposal AND enqueue',async()=>{await q(`CREATE FUNCTION local_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'local injected failure'; END $$; CREATE TRIGGER local_receipt_failure BEFORE INSERT ON telegram_update_receipts FOR EACH ROW EXECUTE FUNCTION local_reject_receipt();`);try{await expect(intake()).rejects.toThrow('local injected failure');expect(await counts()).toEqual({p:0,o:0,r:0,e:0});}finally{await q('DROP TRIGGER local_receipt_failure ON telegram_update_receipts; DROP FUNCTION local_reject_receipt()');}});
 it('two concurrent accepts commit only one canonical event',async()=>{const id=await proposal();const r=await Promise.all([review(id,30),review(id,31)]);expect(r.map(x=>x[0].result_code).sort()).toEqual(['dispatch_review_accepted','dispatch_review_already_handled']);expect((await counts()).e).toBe(1);expect((await review(id,30))[0].is_new).toBe(false);});
 it('accept/reject race decides once',async()=>{const id=await proposal();const r=await Promise.all([review(id,30),review(id,31,501,-100,'reject')]);expect(r.filter(x=>x[0].result_code==='dispatch_review_already_handled')).toHaveLength(1);expect((await counts()).e).toBeLessThanOrEqual(1);});
 it('revoked reviewer identity denies using actual wrapper context',async()=>{const id=await proposal();await q("UPDATE telegram_user_links SET status='revoked',revoked_at=now() WHERE telegram_user_id=501");expect((await review(id))[0].result_code).toBe('dispatch_review_denied');expect((await counts()).e).toBe(0);});
 it('revoked membership permission denies through canonical helper',async()=>{const id=await proposal();await q("UPDATE recruiter_members SET status='revoked' WHERE member_user_id=$1",[STAFF]);expect((await review(id))[0].result_code).toBe('dispatch_review_denied');expect((await counts()).e).toBe(0);});
 it('other tenant reviewer and wrong chat cannot accept',async()=>{const id=await proposal();expect((await review(id,30,502))[0].result_code).toBe('dispatch_review_denied');expect((await review(id,31,501,-200))[0].result_code).toBe('dispatch_review_invalid');expect((await counts()).e).toBe(0);});
 it('stale load never updated',async()=>{const id=await proposal();await q("UPDATE loads SET status='cancelled' WHERE id=$1",[LOAD]);expect((await review(id))[0].result_code).toBe('dispatch_review_stale');expect((await counts()).e).toBe(0);expect(await claim()).toHaveLength(0);});
 it('expired proposal cancels delivery and denies review',async()=>{const id=await proposal();await q("UPDATE telegram_dispatch_review_proposals SET created_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute'");expect(await claim()).toHaveLength(0);expect((await review(id))[0].result_code).toBe('dispatch_review_expired');expect((await q('SELECT delivery_state FROM telegram_dispatch_review_outbox'))[0].delivery_state).toBe('cancelled');});
 it('revoked binding cancels unsent outbox',async()=>{await proposal();await q("UPDATE telegram_chat_bindings SET status='revoked',revoked_at=now() WHERE telegram_chat_id=-100");expect(await claim()).toHaveLength(0);expect((await q('SELECT delivery_state FROM telegram_dispatch_review_outbox'))[0].delivery_state).toBe('cancelled');});
 it('concurrent claims give exclusive unexpired token',async()=>{await proposal();const r=await Promise.all([claim(),claim()]);expect(r.map(x=>x.length).sort()).toEqual([0,1]);});
 it('ack requires exact live token; double ack is harmless',async()=>{await proposal();const c=(await claim())[0];expect((await ack(c,uid(999)))[0].ok).toBe(false);expect((await ack(c))[0].ok).toBe(true);expect((await ack(c))[0].ok).toBe(false);});
 it('failed delivery retries after backoff, then succeeds',async()=>{await proposal();const c=(await claim())[0];expect((await fail(c))[0].ok).toBe(true);expect(await claim()).toHaveLength(0);await q("UPDATE telegram_dispatch_review_outbox SET next_attempt_at=now()-interval '1 second'");const d=(await claim())[0];expect(d.claim_token).not.toBe(c.claim_token);expect((await ack(d))[0].ok).toBe(true);});
 it('crash after send before ack reclaims lease, old token fenced',async()=>{await proposal();const c=(await claim())[0];await q("UPDATE telegram_dispatch_review_outbox SET lease_expires_at=now()-interval '1 second'");const d=(await claim())[0];expect(d.proposal_id).toBe(c.proposal_id);expect((await ack(c))[0].ok).toBe(false);expect((await ack(d))[0].ok).toBe(true);});
 it('ack/fail race only consumes token once',async()=>{await proposal();const c=(await claim())[0];const r=await Promise.all([ack(c),fail(c)]);expect(r.map(x=>x[0].ok).sort()).toEqual([false,true]);});
 it('attempt exhaustion is durable dead-letter, not lost/deleted',async()=>{await proposal();await q('UPDATE telegram_dispatch_review_outbox SET max_attempts=1');const c=(await claim())[0];await fail(c);expect(await claim()).toHaveLength(0);expect((await q('SELECT delivery_state,attempt_count FROM telegram_dispatch_review_outbox'))[0]).toEqual({delivery_state:'failed',attempt_count:1});});
 it.each(['anon','authenticated'])('%s cannot invoke delivery or read queue',async(role)=>{await proposal();await expect(rpc('SELECT * FROM telegram_claim_dispatch_review_delivery()',[],role)).rejects.toMatchObject({code:'42501'});await expect(rpc('SELECT * FROM telegram_dispatch_review_outbox',[],role)).rejects.toMatchObject({code:'42501'});await expect(rpc('SELECT * FROM telegram_dispatch_review_proposals',[],role)).rejects.toMatchObject({code:'42501'});});
 it('canonical event failure rolls back load, decision, receipt; retry succeeds',async()=>{const id=await proposal();await q(`CREATE FUNCTION local_reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'local event failure'; END $$; CREATE TRIGGER local_event_failure BEFORE INSERT ON load_events FOR EACH ROW EXECUTE FUNCTION local_reject_event();`);try{await expect(review(id)).rejects.toThrow('local event failure');expect((await q('SELECT status FROM loads WHERE id=$1',[LOAD]))[0].status).toBe('en_route');expect(await counts()).toEqual({p:1,o:1,r:1,e:0});}finally{await q('DROP TRIGGER local_event_failure ON load_events; DROP FUNCTION local_reject_event()');}expect((await review(id))[0].result_code).toBe('dispatch_review_accepted');});
 it('explicit multi-session transaction rollback leaves no proposal/receipt/outbox',async()=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE service_role');await c.query("SELECT * FROM telegram_process_dispatch_group_update($1,10,$2,900,-100,'group','AB-123','completed')",[LEASE,hash(10)]);expect(await counts()).toEqual({p:0,o:0,r:0,e:0});await c.query('ROLLBACK');expect(await counts()).toEqual({p:0,o:0,r:0,e:0});}finally{c.release();}});
 it('outbox insert failure rolls back proposal and receipt together',async()=>{await q(`CREATE FUNCTION local_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'local outbox failure'; END $$; CREATE TRIGGER local_outbox_failure BEFORE INSERT ON telegram_dispatch_review_outbox FOR EACH ROW EXECUTE FUNCTION local_reject_outbox();`);try{await expect(intake()).rejects.toThrow('local outbox failure');expect(await counts()).toEqual({p:0,o:0,r:0,e:0});}finally{await q('DROP TRIGGER local_outbox_failure ON telegram_dispatch_review_outbox; DROP FUNCTION local_reject_outbox()');}});
 it('decided proposal suppresses pending delivery, claim/reject race remains harmless',async()=>{const id=await proposal();await Promise.all([claim(),review(id,30,501,-100,'reject')]);expect(await claim()).toHaveLength(0);expect((await q('SELECT delivery_state FROM telegram_dispatch_review_outbox'))[0].delivery_state).toBe('cancelled');expect((await counts()).e).toBe(0);});
 it('ended relationship cancels delivery and denies approval',async()=>{const id=await proposal();await q("UPDATE carrier_driver_relationships SET status='ended' WHERE id=$1",[REL]);expect(await claim()).toHaveLength(0);expect((await review(id))[0].result_code).toBe('dispatch_review_denied');expect((await counts()).e).toBe(0);});
 it('uncommitted reviewer revocation wins before waiting approval',async()=>{
   const id=await proposal(); const c=await pool.connect();
   try {
     await c.query('BEGIN'); await c.query("UPDATE telegram_user_links SET status='revoked',revoked_at=now() WHERE telegram_user_id=501");
     let settled=false; const approval=review(id).finally(()=>{settled=true;});
     // Wait for a REAL lock wait, not merely Promise scheduling/timing.
     for(let n=0;n<100;n++) { if((await q("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT * FROM telegram_process_dispatch_review_action%'"))[0].n>0) break; await new Promise(r=>setTimeout(r,10)); }
     expect((await q("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT * FROM telegram_process_dispatch_review_action%'"))[0].n).toBeGreaterThan(0);
     expect(settled).toBe(false); await c.query('COMMIT');
     expect((await approval)[0].result_code).toBe('dispatch_review_denied'); expect((await counts()).e).toBe(0);
   } finally { await c.query('ROLLBACK');c.release(); }
 });
});


const qaIntake=(n=100,ref='HTP-QA-L2',chat=-100,status='cancelled',user=501)=>rpc(
 "SELECT * FROM telegram_qa_process_dispatch_group_update($1,$2,$3,$4,$5,'group',$6,$7)",[LEASE,n,hash(n),user,chat,ref,status]);
const qaReview=(id:string,n=130,user=501,chat=-100)=>rpc(
 "SELECT * FROM telegram_qa_process_dispatch_review_action($1,$2,$3,$4,$5,'group','accept',$6)",[LEASE,n,hash(n),user,chat,id]);
const qaClaim=()=>rpc('SELECT * FROM telegram_qa_claim_dispatch_review_delivery()');
async function qaProposal(){const rows=await qaIntake();expect(rows[0].result_code).toBe('dispatch_review_proposed');return rows[0].proposal_id as string;}
async function unrelatedState(){return q(`SELECT row_to_json(o) row FROM telegram_dispatch_review_outbox o JOIN telegram_dispatch_review_proposals p ON p.id=o.proposal_id WHERE p.load_id<>'${QA_LOAD}' ORDER BY o.id`);}
describe('TG-G1 QA exact single-load disposable transactions',()=>{
 beforeEach(async()=>{await q("INSERT INTO loads(id,user_id,status,load_reference,carrier_driver_relationship_id) VALUES($1,$2,'pending','HTP-QA-L2',$3)",[QA_LOAD,D,REL]);});
 it('exact QA intake proposes cancellation without changing loads or events',async()=>{
  const before=await q('SELECT row_to_json(l) row FROM loads l ORDER BY id');await qaProposal();
  expect(await q('SELECT row_to_json(l) row FROM loads l ORDER BY id')).toEqual(before);expect(await counts()).toEqual({p:1,o:1,r:1,e:0});
 });
 it.each([['AB-123',-100,'cancelled'],['HTP-QA-L2',-200,'cancelled'],['HTP-QA-L2',-100,'completed']])('denies non-QA scope %s/%s/%s without writes',async(ref,chat,status)=>{
  await expect(qaIntake(100,String(ref),Number(chat),String(status))).rejects.toThrow('qa_dispatch_scope_denied');expect(await counts()).toEqual({p:0,o:0,r:0,e:0});
 });
 it('reference moved to a different load cannot substitute the exact UUID',async()=>{
  await q("UPDATE loads SET load_reference='OLD-QA' WHERE id=$1",[QA_LOAD]);await q("UPDATE loads SET load_reference='HTP-QA-L2' WHERE id=$1",[LOAD]);
  await expect(qaIntake()).rejects.toThrow('qa_dispatch_scope_denied');expect((await counts()).p).toBe(0);
 });
 it('no active relationship or revoked binding fails closed without writes',async()=>{
  await q("UPDATE carrier_driver_relationships SET status='ended' WHERE id=$1",[REL]);await expect(qaIntake()).rejects.toThrow('qa_dispatch_scope_denied');expect((await counts()).p).toBe(0);
 });
 it('fresh poll lease is required, even for exact QA',async()=>{
  await q('UPDATE telegram_poll_state SET lease_token=NULL,lease_expires_at=NULL');await expect(qaIntake()).rejects.toThrow('telegram_poll_lease_invalid');expect(await counts()).toEqual({p:0,o:0,r:0,e:0});
 });
 it.each(['unlinked','revoked','permission'])('QA intake denies %s actor with no proposals or receipts',async(reason)=>{
  if(reason==='revoked')await q("UPDATE telegram_user_links SET status='revoked',revoked_at=now() WHERE telegram_user_id=501");
  if(reason==='permission')await q("UPDATE recruiter_members SET permissions='{}' WHERE member_user_id=$1",[STAFF]);
  await expect(qaIntake(100,'HTP-QA-L2',-100,'cancelled',reason==='unlinked'?999:501)).rejects.toThrow('qa_dispatch_actor_denied');
  expect(await counts()).toEqual({p:0,o:0,r:0,e:0});
 });
 it('duplicate concurrent QA commands have one proposal and outbox',async()=>{
  const rows=await Promise.all([qaIntake(),qaIntake()]);expect(rows.map(r=>r[0].is_new).sort()).toEqual([false,true]);expect(await counts()).toEqual({p:1,o:1,r:1,e:0});
 });
 it('wrong proposal callback does not mutate unrelated proposal, receipt, event or load',async()=>{
  const id=await proposal();const before=await q('SELECT row_to_json(p) row FROM telegram_dispatch_review_proposals p');
  await expect(qaReview(id)).rejects.toThrow('qa_dispatch_scope_denied');expect(await q('SELECT row_to_json(p) row FROM telegram_dispatch_review_proposals p')).toEqual(before);expect(await counts()).toEqual({p:1,o:1,r:1,e:0});
 });
 it('authorized QA callback uses canonical cancellation once with replay',async()=>{
  const id=await qaProposal();const other=await q('SELECT row_to_json(l) row FROM loads l WHERE id<>$1 ORDER BY id',[QA_LOAD]);
  expect((await qaReview(id))[0].result_code).toBe('dispatch_review_accepted');expect((await qaReview(id))[0].is_new).toBe(false);
  expect((await q('SELECT status FROM loads WHERE id=$1',[QA_LOAD]))[0].status).toBe('cancelled');expect((await counts()).e).toBe(1);
  expect(await q('SELECT row_to_json(l) row FROM loads l WHERE id<>$1 ORDER BY id',[QA_LOAD])).toEqual(other);
 });
 it.each(['link','permission','chat'])('QA confirmation rejects revoked %s',async(reason)=>{
  const id=await qaProposal();
  if(reason==='link')await q("UPDATE telegram_user_links SET status='revoked',revoked_at=now() WHERE telegram_user_id=501");
  if(reason==='permission')await q("UPDATE recruiter_members SET permissions='{}' WHERE member_user_id=$1",[STAFF]);
  if(reason==='chat'){await expect(qaReview(id,130,501,-200)).rejects.toThrow('qa_dispatch_scope_denied');}
  else expect((await qaReview(id))[0].result_code).toBe('dispatch_review_denied');
  expect((await q('SELECT status FROM loads WHERE id=$1',[QA_LOAD]))[0].status).toBe('pending');expect((await counts()).e).toBe(0);
 });
 it('claim and cleanup leave unrelated expired/exhausted outbox byte-for-byte unchanged',async()=>{
  await proposal();await q("UPDATE telegram_dispatch_review_proposals SET created_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute' WHERE load_id=$1",[LOAD]);
  const before=await unrelatedState();await qaProposal();const c=(await qaClaim())[0];expect(c.load_reference).toBe('HTP-QA-L2');expect(c.proposed_status).toBe('cancelled');expect(await unrelatedState()).toEqual(before);
 });
 it('exhaustion cleanup cannot alter an unrelated sending row',async()=>{
  await proposal();await claim();await q("UPDATE telegram_dispatch_review_outbox SET lease_expires_at=now()-interval '1 second',max_attempts=attempt_count");
  const before=await unrelatedState();expect(await qaClaim()).toHaveLength(0);expect(await unrelatedState()).toEqual(before);
 });
 it('expired QA proposal cleans only QA outbox and cannot change load',async()=>{
  await proposal();const id=await qaProposal();await q("UPDATE telegram_dispatch_review_proposals SET created_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",[id]);
  const before=await unrelatedState();expect(await qaClaim()).toHaveLength(0);expect(await unrelatedState()).toEqual(before);
  expect((await qaReview(id))[0].result_code).toBe('dispatch_review_expired');expect((await counts()).e).toBe(0);
 });
 it('stale QA status cannot be updated by confirmation',async()=>{
  const id=await qaProposal();await q("UPDATE loads SET status='en_route' WHERE id=$1",[QA_LOAD]);expect((await qaReview(id))[0].result_code).toBe('dispatch_review_stale');expect((await counts()).e).toBe(0);
 });
 it('exclusive QA delivery lease and ordinary ack reuse',async()=>{
  await qaProposal();const rows=await Promise.all([qaClaim(),qaClaim()]);expect(rows.map(x=>x.length).sort()).toEqual([0,1]);const c=rows.flat()[0];expect((await ack(c))[0].ok).toBe(true);
 });
 it('revocation committed during a real lock wait denies QA confirmation',async()=>{
  const id=await qaProposal(),c=await pool.connect();
  try{await c.query('BEGIN');await c.query("UPDATE telegram_user_links SET status='revoked',revoked_at=now() WHERE telegram_user_id=501");
   let settled=false;const approval=qaReview(id).finally(()=>{settled=true;});
   for(let n=0;n<100;n++){if((await q("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT * FROM telegram_qa_process_dispatch_review_action%'"))[0].n>0)break;await new Promise(r=>setTimeout(r,10));}
   expect((await q("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT * FROM telegram_qa_process_dispatch_review_action%'"))[0].n).toBeGreaterThan(0);
   expect(settled).toBe(false);await c.query('COMMIT');expect((await approval)[0].result_code).toBe('dispatch_review_denied');expect((await counts()).e).toBe(0);
  }finally{await c.query('ROLLBACK');c.release();}
 });
 it('absolute expiry rolls back intake, callback and all cleanup',async()=>{
  const id=await qaProposal();await proposal();const before=await counts(),other=await unrelatedState();
  const def=(await q("SELECT pg_get_functiondef('public._telegram_qa_dispatch_assert(bigint,text)'::regprocedure) d"))[0].d as string;
  try{await q(def.split('2026-11-02 23:59:59+00').join('2000-01-01 00:00:00+00'));
   await expect(qaIntake(101)).rejects.toThrow('qa_dispatch_expired');await expect(qaReview(id)).rejects.toThrow('qa_dispatch_expired');await expect(qaClaim()).rejects.toThrow('qa_dispatch_expired');
   expect(await counts()).toEqual(before);expect(await unrelatedState()).toEqual(other);
  }finally{await q(def);}
 });
 it('scope is restored on success and error; ordinary calls remain unchanged',async()=>{
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE service_role');await c.query("SELECT set_config('haultracker.qa_dispatch_scope','prior',true)");
   await c.query("SELECT * FROM telegram_qa_process_dispatch_group_update($1,100,$2,501,-100,'group','HTP-QA-L2','cancelled')",[LEASE,hash(100)]);
   expect((await c.query("SELECT current_setting('haultracker.qa_dispatch_scope') s")).rows[0].s).toBe('prior');await c.query('ROLLBACK');
  }finally{c.release();}
  await expect(qaIntake(100,'AB-123')).rejects.toThrow('qa_dispatch_scope_denied');expect((await intake())[0].result_code).toBe('dispatch_review_proposed');
 });
 it.each(['anon','authenticated'])('%s cannot invoke any QA entry point or helper',async(role)=>{
  for(const sql of ["SELECT * FROM telegram_qa_claim_dispatch_review_delivery()","SELECT _telegram_qa_dispatch_active()","SELECT * FROM _telegram_qa_dispatch_scope()","SELECT _telegram_qa_dispatch_assert()","SELECT _telegram_qa_dispatch_proposal(NULL)","SELECT _telegram_qa_dispatch_actor(501)","SELECT * FROM telegram_qa_process_dispatch_group_update(NULL,1,'x',501,-100,'group','HTP-QA-L2','cancelled')","SELECT * FROM telegram_qa_process_dispatch_review_action(NULL,1,'x',501,-100,'group','accept',NULL)"])
   await expect(rpc(sql,[],role)).rejects.toMatchObject({code:'42501'});
 });
});


const GEN_LOAD='265e8be2-07d1-4e46-af05-8e7e50c8ae7c';
const GEN_DRIVER='6cedbe7e-d717-4b34-9f1a-00c21e3298c1';
const GEN_REL='df35ed7b-7e94-4280-9e0e-e94369ead8dd';
const GEN_RECRUITER='f6b00b66-cd1c-4037-a382-8b1b9c629f3b';
const GEN_BINDING='337876b7-307c-44f7-8693-1ec722c059f0';
const GEN_CHAT=-5335739793;
const GEN_CANDIDATE='supabase/migration-candidates/20261031_group_restricted_general_dispatch_qa.sql';
async function seedGenFixture() {
 await q('INSERT INTO auth.users VALUES($1)',[GEN_DRIVER]);
 await q(`INSERT INTO recruiter_profiles(id,user_id,recruiter_name,company_name,status,company_type,posting_terms_accepted_at) VALUES('${GEN_RECRUITER}','${uid(5)}','QA','QA','active','carrier',now());
 INSERT INTO user_capabilities VALUES('${uid(5)}','recruiter','active');
 INSERT INTO recruiter_billing_profiles VALUES('${GEN_RECRUITER}','${uid(5)}','growth','active');
 INSERT INTO recruiter_members(recruiter_id,member_user_id,status,role,permissions) VALUES('${GEN_RECRUITER}','${STAFF}','active','recruiter_staff','{"loads_update_status":true}');
 INSERT INTO carrier_driver_relationships(id,recruiter_id,driver_user_id,status,created_by_user_id) VALUES('${GEN_REL}','${GEN_RECRUITER}','${GEN_DRIVER}','active','${uid(5)}');
 INSERT INTO loads(id,user_id,status,load_reference,carrier_driver_relationship_id) VALUES('${GEN_LOAD}','${GEN_DRIVER}','pending','HTP-QA-GEN1','${GEN_REL}');
 INSERT INTO telegram_chat_bindings(id,telegram_chat_id,recruiter_id,chat_type,bound_by_user_id) VALUES('${GEN_BINDING}',${GEN_CHAT},'${GEN_RECRUITER}','group','${uid(5)}');`);
}
const genIntake=(n=400,ref='HTP-QA-GEN1',chat=GEN_CHAT,status='cancelled',user=501)=>rpc(
 "SELECT * FROM telegram_genqa_process_dispatch_group_update($1,$2,$3,$4,$5,'group',$6,$7)",[LEASE,n,hash(n),user,chat,ref,status]);
const genReview=(id:string,n=430,user=501,chat=GEN_CHAT,action='accept')=>rpc(
 "SELECT * FROM telegram_genqa_process_dispatch_review_action($1,$2,$3,$4,$5,'group',$6,$7)",[LEASE,n,hash(n),user,chat,action,id]);
const genClaim=()=>rpc('SELECT * FROM telegram_genqa_claim_dispatch_review_delivery()');
const genAck=(c:Record<string,unknown>,token=c.claim_token)=>rpc('SELECT telegram_genqa_ack_dispatch_review_delivery($1,$2,123) ok',[c.outbox_id,token]);
const genFail=(c:Record<string,unknown>)=>rpc("SELECT telegram_genqa_fail_dispatch_review_delivery($1,$2,'network') ok",[c.outbox_id,c.claim_token]);
async function genProposal(){const rows=await genIntake();expect(rows[0].result_code).toBe('dispatch_review_proposed');return rows[0].proposal_id as string;}
async function genOtherState(){return q(`SELECT row_to_json(o) row FROM telegram_dispatch_review_outbox o JOIN telegram_dispatch_review_proposals p ON p.id=o.proposal_id WHERE p.load_id<>'${GEN_LOAD}' ORDER BY o.id`);}
describe('TG-G1 GEN1 hash-pinned one-group acceptance, disposable PostgreSQL only',()=>{
 beforeEach(seedGenFixture);
 it('candidate version and provenance guards compile without changing canonical definitions',async()=>{
  for(const [name,expected] of [['telegram_process_dispatch_group_update','5fc195e441b15004bb7d1f7b67b95f3a'],...Object.entries(REPAIRED_DEADLINE_HASHES)])
   expect((await q('SELECT md5(prosrc) hash FROM pg_proc WHERE pronamespace=\'public\'::regnamespace AND proname=$1',[name]))[0].hash).toBe(expected);
 });
 it('authorized intake creates only one proposal/outbox/receipt and no load/event mutation',async()=>{
  const before=await q('SELECT row_to_json(l) row FROM loads l ORDER BY id');await genProposal();
  expect(await counts()).toEqual({p:1,o:1,r:1,e:0});expect(await q('SELECT row_to_json(l) row FROM loads l ORDER BY id')).toEqual(before);
 });
 it.each([['HTP-QA-L2',GEN_CHAT,'cancelled',501],['HTP-QA-GEN1',-100,'cancelled',501],['HTP-QA-GEN1',GEN_CHAT,'completed',501],['HTP-QA-GEN1',GEN_CHAT,'cancelled',502],['HTP-QA-GEN1',GEN_CHAT,'cancelled',999]])('wrong target/chat/status/actor rejects without any receipt: %s/%s/%s/%s',async(ref,chat,status,user)=>{
  await expect(genIntake(400,String(ref),Number(chat),String(status),Number(user))).rejects.toThrow();expect(await counts()).toEqual({p:0,o:0,r:0,e:0});
 });
 it('duplicate concurrent intake dedupes exactly, conflict does not write',async()=>{
  const rows=await Promise.all([genIntake(),genIntake()]);expect(rows.map(r=>r[0].is_new).sort()).toEqual([false,true]);
  await expect(genIntake(400,'HTP-QA-GEN1',GEN_CHAT,'cancelled',502)).rejects.toThrow();expect(await counts()).toEqual({p:1,o:1,r:1,e:0});
 });
 it('genuine linked authorized confirmation commits one cancellation/event, replay is harmless',async()=>{
  const id=await genProposal(),before=await q('SELECT row_to_json(l) row FROM loads l WHERE id<>$1 ORDER BY id',[GEN_LOAD]);
  expect((await genReview(id))[0].result_code).toBe('dispatch_review_accepted');expect((await genReview(id))[0].is_new).toBe(false);
  expect((await q('SELECT status FROM loads WHERE id=$1',[GEN_LOAD]))[0].status).toBe('cancelled');expect((await counts()).e).toBe(1);
  expect(await q('SELECT row_to_json(l) row FROM loads l WHERE id<>$1 ORDER BY id',[GEN_LOAD])).toEqual(before);
 });
 it('two concurrent human confirmations decide once',async()=>{
  const id=await genProposal();const rows=await Promise.all([genReview(id),genReview(id,431)]);
  expect(rows.map(r=>r[0].result_code).sort()).toEqual(['dispatch_review_accepted','dispatch_review_already_handled']);expect((await counts()).e).toBe(1);
 });
 it('rejection never changes load, authorized decision remains recorded',async()=>{
  const id=await genProposal();expect((await genReview(id,430,501,GEN_CHAT,'reject'))[0].result_code).toBe('dispatch_review_rejected');expect((await counts()).e).toBe(0);
 });
 it.each(['link','permission','relationship','binding','driver','reference'])('revoked or changed %s blocks confirmation without writes',async(reason)=>{
  const id=await genProposal();
  const sql:Record<string,string>={link:"UPDATE telegram_user_links SET status='revoked',revoked_at=now() WHERE telegram_user_id=501",permission:"UPDATE recruiter_members SET permissions='{}' WHERE member_user_id='"+STAFF+"'",relationship:"UPDATE carrier_driver_relationships SET status='ended' WHERE id='"+GEN_REL+"'",binding:"UPDATE telegram_chat_bindings SET status='revoked',revoked_at=now() WHERE id='"+GEN_BINDING+"'",driver:"UPDATE loads SET user_id='"+D+"' WHERE id='"+GEN_LOAD+"'",reference:"UPDATE loads SET load_reference='OLD' WHERE id='"+GEN_LOAD+"'"};
  await q(sql[reason]);const before=await counts();await expect(genReview(id)).rejects.toThrow();expect(await counts()).toEqual(before);
 });
 it('wrong group or unrelated proposal callback cannot consume receipts/history',async()=>{
  const id=await genProposal();await expect(genReview(id,430,501,-100)).rejects.toThrow();
  const unrelated=await proposal();const before=await counts();await expect(genReview(unrelated)).rejects.toThrow();expect(await counts()).toEqual(before);
 });
 it('stale status never changed, expired proposal cannot be confirmed',async()=>{
  const id=await genProposal();await q("UPDATE loads SET status='en_route' WHERE id=$1",[GEN_LOAD]);expect((await genReview(id))[0].result_code).toBe('dispatch_review_stale');expect((await counts()).e).toBe(0);
 });
 it('both cleanup sweeps and concurrent claims leave unrelated expired/exhausted rows unchanged',async()=>{
  await proposal();await claim();await q("UPDATE telegram_dispatch_review_outbox SET lease_expires_at=now()-interval '1 second',max_attempts=attempt_count");
  await q("UPDATE telegram_dispatch_review_proposals SET created_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute' WHERE load_id=$1",[LOAD]);
  const before=await genOtherState();await genProposal();const rows=await Promise.all([genClaim(),genClaim()]);expect(rows.map(r=>r.length).sort()).toEqual([0,1]);expect(await genOtherState()).toEqual(before);
 });
 it('exact expired proposal cleanup cannot affect historical or other load outboxes',async()=>{
  await proposal();const id=await genProposal();await q("UPDATE telegram_dispatch_review_proposals SET created_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",[id]);
  const before=await genOtherState();expect(await genClaim()).toHaveLength(0);expect(await genOtherState()).toEqual(before);expect((await genReview(id))[0].result_code).toBe('dispatch_review_expired');expect((await counts()).e).toBe(0);
 });
 it('lease reclaim fences old token and failure retries without touching another outbox',async()=>{
  await genProposal();const c=(await genClaim())[0];await q("UPDATE telegram_dispatch_review_outbox SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[c.outbox_id]);
  const d=(await genClaim())[0];expect((await genAck(c))[0].ok).toBe(false);expect((await genFail(d))[0].ok).toBe(true);
  await q("UPDATE telegram_dispatch_review_outbox SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[d.outbox_id]);expect((await genAck((await genClaim())[0]))[0].ok).toBe(true);
  await proposal();const other=(await claim())[0];const before=await genOtherState();await expect(genAck(other)).rejects.toThrow();await expect(genFail(other)).rejects.toThrow();expect(await genOtherState()).toEqual(before);
 });
 it('absolute expiry blocks intake/callback/claim/cleanup/ack/fail atomically',async()=>{
  const id=await genProposal(),c=(await genClaim())[0],before=await counts();
  const def=(await q("SELECT pg_get_functiondef('public._telegram_genqa_dispatch_assert(bigint,text)'::regprocedure) d"))[0].d as string;
  try {await q(def.split('2026-11-05 23:59:59+00').join('2000-01-01 00:00:00+00'));
   for(const action of [()=>genIntake(401),()=>genReview(id),genClaim,()=>genAck(c),()=>genFail(c)]) await expect(action()).rejects.toThrow('qa_dispatch_expired');expect(await counts()).toEqual(before);
  }finally{await q(def);}
 });
 it('post-lock revocation is rechecked after a real database wait',async()=>{
  const id=await genProposal(),c=await pool.connect();
  try{await c.query('BEGIN');await c.query("UPDATE telegram_user_links SET status='revoked',revoked_at=now() WHERE telegram_user_id=501");const approval=genReview(id);const assertion=expect(approval).rejects.toThrow('qa_dispatch_actor_denied');
   for(let n=0;n<100;n++){if((await q("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT * FROM telegram_genqa_process_dispatch_review_action%'"))[0].n>0)break;await new Promise(r=>setTimeout(r,10));}
   expect((await q("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT * FROM telegram_genqa_process_dispatch_review_action%'"))[0].n).toBeGreaterThan(0);await c.query('COMMIT');await assertion;expect((await counts()).e).toBe(0);
  }finally{await c.query('ROLLBACK');c.release();}
 });
 it.each(['anon','authenticated'])('%s cannot invoke any new wrapper/helper',async(role)=>{
  const rows=await q("SELECT p.oid::regprocedure::text sig,proname,pronargs FROM pg_proc p WHERE pronamespace='public'::regnamespace AND (proname LIKE 'telegram_genqa_%' OR proname LIKE '_telegram_genqa_%')");
  expect(rows.length).toBe(11);
  for(const row of rows) await expect(rpc(`SELECT public.${row.proname}(${Array(Number(row.pronargs)).fill('NULL').join(',')})`,[],role)).rejects.toMatchObject({code:'42501'});
 });
});


async function waitForGenLock(name:string) {
 for(let n=0;n<150;n++) {
  const rows=await q("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE $1",['SELECT * FROM '+name+'%']);
  if(rows[0].n>0)return;
  await new Promise(r=>setTimeout(r,10));
 }
 throw new Error('Expected real PostgreSQL lock wait');
}
async function financialState(id:string) {
 return (await q('SELECT loaded_miles,deadhead_miles,rate_per_mile,total_miles,estimated_pay,actual_pay_received,gross_revenue,flat_rate_amount,wait_fee,detention_fee,other_fees FROM loads WHERE id=$1',[id]))[0];
}
async function historicalSnapshot() {
 const tables=['loads','telegram_dispatch_review_proposals','telegram_dispatch_review_outbox','load_events','dispatch_command_receipts'];
 const result:Record<string,unknown>={};
 for(const table of tables){
  const filter=table==='loads'?'t.id<>$1':table==='telegram_dispatch_review_outbox'?'t.proposal_id IN (SELECT id FROM telegram_dispatch_review_proposals WHERE load_id<>$1)':'t.load_id<>$1';
  result[table]=await q(`SELECT row_to_json(t)::text row FROM ${table} t WHERE ${filter} ORDER BY t.id`,[GEN_LOAD]);
 }
 result.receipts=await q('SELECT row_to_json(t)::text row FROM telegram_update_receipts t WHERE update_id IN (100,130) ORDER BY update_id');
 return result;
}
describe('TG-G1 general lock-deadline verification',()=>{
 beforeAll(async()=>{
  await assertDeadlineHashes(REPAIRED_DEADLINE_HASHES,'GENERAL_INSTALLED_REPAIRED_MD5');
 });
 async function lockAndDeadline(name:string,id:string,blockerPid:number){
  await waitForGenLock(name);
  const evidence=await q("SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE $1",['SELECT * FROM '+name+'%']);
  console.log('GENERAL_LOCK_EVIDENCE',name,JSON.stringify(evidence));
  expect(evidence.some(row=>(row.blockers as number[]).includes(blockerPid))).toBe(true);
  let deadline:Record<string,unknown>|undefined;
  for(let n=0;n<200;n++){
   deadline=(await q('SELECT clock_timestamp() db_clock,expires_at,clock_timestamp()>=expires_at elapsed FROM telegram_dispatch_review_proposals WHERE id=$1',[id]))[0];
   if(deadline?.elapsed)break;
   await q('SELECT pg_sleep(0.02)');
  }
  console.log('GENERAL_DB_DEADLINE',name,JSON.stringify(deadline));
  expect(deadline?.elapsed).toBe(true);
 }
 it.each(['accept','reject'])('generic review %s must expire after genuine load-lock wait',async(action)=>{
  const id=await proposal();
  const before=await q('SELECT row_to_json(l)::text row FROM loads l WHERE id=$1',[LOAD]);
  const c=await pool.connect();
  let pending:Promise<{rows:pg.QueryResultRow[]}|{error:unknown}>|undefined;
  try{
   await c.query('BEGIN');
   await c.query('SELECT id FROM loads WHERE id=$1 FOR KEY SHARE',[LOAD]);
   const blockerPid=(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid as number;
   await q("UPDATE telegram_dispatch_review_proposals SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[id]);
   pending=review(id,30,501,-100,action).then(rows=>({rows}),error=>({error}));
   await lockAndDeadline('telegram_process_dispatch_review_action',id,blockerPid);
   await c.query('COMMIT');
   const outcome=await pending;
   if('error' in outcome)throw outcome.error;
   const load=await q('SELECT row_to_json(l)::text row FROM loads l WHERE id=$1',[LOAD]);
   const status=(await q('SELECT status FROM loads WHERE id=$1',[LOAD]))[0].status;
   const events=(await counts()).e;
   const proposalStatus=(await q('SELECT status FROM telegram_dispatch_review_proposals WHERE id=$1',[id]))[0].status;
   console.log('GENERAL_REVIEW_OBSERVED',JSON.stringify({action,result:outcome.rows,loadStatus:status,loadUnchanged:JSON.stringify(load)===JSON.stringify(before),events,proposalStatus}));
   expect.soft(outcome.rows[0]?.result_code).toBe('dispatch_review_expired');
   expect.soft(load).toEqual(before);
   expect.soft(status).toBe('en_route');
   expect.soft(events).toBe(0);
   expect.soft(proposalStatus).toBe('expired');
  }finally{
   try{await c.query('ROLLBACK');}finally{c.release();if(pending)await pending;}
  }
 },15000);
 it('generic claim must return zero after genuine closed-outbox cleanup wait crosses pending expiry',async()=>{
  const closed=await proposal();
  expect((await review(closed,30,501,-100,'reject'))[0].result_code).toBe('dispatch_review_rejected');
  const id=(await intake(11))[0].proposal_id as string;
  expect(id).toBeTruthy();
  const c=await pool.connect();
  let pending:Promise<{rows:pg.QueryResultRow[]}|{error:unknown}>|undefined;
  try{
   await c.query('BEGIN');
   await c.query('SELECT id FROM telegram_dispatch_review_outbox WHERE proposal_id=$1 FOR UPDATE',[closed]);
   const blockerPid=(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid as number;
   await q("UPDATE telegram_dispatch_review_proposals SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[id]);
   pending=claim().then(rows=>({rows}),error=>({error}));
   await lockAndDeadline('telegram_claim_dispatch_review_delivery',id,blockerPid);
   await c.query('COMMIT');
   const outcome=await pending;
   if('error' in outcome)throw outcome.error;
   const state=(await q('SELECT p.status,p.expires_at,clock_timestamp() db_clock,o.delivery_state FROM telegram_dispatch_review_proposals p JOIN telegram_dispatch_review_outbox o ON o.proposal_id=p.id WHERE p.id=$1',[id]))[0];
   console.log('GENERAL_CLAIM_OBSERVED',JSON.stringify({claimCount:outcome.rows.length,claims:outcome.rows,state}));
   expect.soft(outcome.rows).toHaveLength(0);
   expect.soft(state.delivery_state).not.toBe('sending');
  }finally{
   try{await c.query('ROLLBACK');}finally{c.release();if(pending)await pending;}
  }
 },15000);
 it('generic claim must return zero when proposal FOR SHARE waits past expiry',async()=>{
  const id=await proposal(),c=await pool.connect();
  let pending:Promise<{rows:pg.QueryResultRow[]}|{error:unknown}>|undefined;
  try{
   await q("UPDATE telegram_dispatch_review_proposals SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[id]);
   await c.query('BEGIN');
   // Non-key UPDATE conflicts with FOR SHARE, but does not block plain SELECT.
   await c.query('UPDATE telegram_dispatch_review_proposals SET load_reference=load_reference WHERE id=$1',[id]);
   const blockerPid=(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid as number;
   pending=claim().then(rows=>({rows}),error=>({error}));
   await lockAndDeadline('telegram_claim_dispatch_review_delivery',id,blockerPid);
   await c.query('COMMIT');
   const outcome=await pending;
   if('error' in outcome)throw outcome.error;
   const state=(await q('SELECT p.status,p.expires_at,clock_timestamp() db_clock,o.delivery_state,o.claim_token,o.lease_expires_at,o.last_failure_code FROM telegram_dispatch_review_proposals p JOIN telegram_dispatch_review_outbox o ON o.proposal_id=p.id WHERE p.id=$1',[id]))[0];
   console.log('GENERAL_PROPOSAL_LOCK_CLAIM_OBSERVED',JSON.stringify({claimCount:outcome.rows.length,state}));
   expect(outcome.rows).toHaveLength(0);
   expect(state.delivery_state).toBe('cancelled');
   expect(state.claim_token).toBeNull();
   expect(state.lease_expires_at).toBeNull();
   expect(state.last_failure_code).toBe('proposal_closed');
   expect((await q('SELECT status FROM loads WHERE id=$1',[LOAD]))[0].status).toBe('en_route');
   expect((await counts()).e).toBe(0);
  }finally{
   try{await c.query('ROLLBACK');}finally{c.release();if(pending)await pending;}
  }
 },15000);
 it('repair candidate rejects repaired bodies and leaves definitions and data unchanged',async()=>{
  const before=await deadlineDefinitions(),qaBefore=await qaDefinitions(),data=await counts();
  await expect(applyDeadlineCandidate(DEADLINE_REPAIR)).rejects.toThrow('general_deadline_version_mismatch');
  expect(await deadlineDefinitions()).toEqual(before);
  expect(await qaDefinitions()).toEqual(qaBefore);
  expect(await counts()).toEqual(data);
 });
 it('transactional restore is exact, rejects baseline bodies, and reapply preserves QA copies and data',async()=>{
  const repaired=await deadlineDefinitions(),qaBefore=await qaDefinitions(),data=await counts();
  let restored=false;
  try{
   await applyDeadlineCandidate(DEADLINE_RESTORE);restored=true;
   await assertDeadlineHashes(BASELINE_DEADLINE_HASHES,'GENERAL_RESTORED_MD5');
   expect(await deadlineDefinitions()).toEqual(baselineDeadlineDefinitions);
   await expect(applyDeadlineCandidate(DEADLINE_RESTORE)).rejects.toThrow('general_deadline_version_mismatch');
   expect(await deadlineDefinitions()).toEqual(baselineDeadlineDefinitions);
   expect(await qaDefinitions()).toEqual(qaBefore);
   expect(await counts()).toEqual(data);
  }finally{
   if(restored)await applyDeadlineCandidate(DEADLINE_REPAIR);
  }
  expect(await deadlineDefinitions()).toEqual(repaired);
  await assertDeadlineHashes(REPAIRED_DEADLINE_HASHES,'GENERAL_REAPPLIED_MD5');
  expect(await qaDefinitions()).toEqual(qaBefore);
  expect(await counts()).toEqual(data);
 });
});

describe('TG-G1 GEN1 terminal replay, lock-deadline and financial preservation regressions',()=>{
 beforeEach(seedGenFixture);
 it.each(['accepted','rejected','already_handled','expired','stale'])('exact terminal %s replay returns old result with no extra writes; wrong locator/action denied',async(kind)=>{
  const id=await genProposal();let n=430,action='accept';
  if(kind==='rejected')action='reject';
  if(kind==='already_handled'){await genReview(id);n=431;}
  if(kind==='expired')await q("UPDATE telegram_dispatch_review_proposals SET created_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",[id]);
  if(kind==='stale')await q("UPDATE loads SET status='en_route' WHERE id=$1",[GEN_LOAD]);
  const result=(await genReview(id,n,501,GEN_CHAT,action))[0];expect(result.result_code).toBe('dispatch_review_'+kind);
  const before=await counts(),load=await q('SELECT row_to_json(l)::text row FROM loads l ORDER BY id');
  expect((await genReview(id,n,501,GEN_CHAT,action))[0]).toEqual({is_new:false,result_code:result.result_code});
  await expect(genReview(uid(777),n,501,GEN_CHAT,action)).rejects.toThrow();
  await expect(genReview(id,n,501,GEN_CHAT,action==='accept'?'reject':'accept')).rejects.toThrow('telegram_update_conflict');
  expect(await counts()).toEqual(before);expect(await q('SELECT row_to_json(l)::text row FROM loads l ORDER BY id')).toEqual(load);
 });
 it('same payload/update replay cannot select another in-scope proposal',async()=>{
  const id=await genProposal();await genReview(id,430,501,GEN_CHAT,'reject');const second=(await genIntake(401))[0].proposal_id as string;
  const before=await counts();await expect(genReview(second,430)).rejects.toThrow('telegram_update_conflict');expect(await counts()).toEqual(before);
 });
 it.each(['accept','reject'])('proposal expiry crossing load-lock upgrade prevents %s after earlier validation',async(action)=>{
  const id=await genProposal();await q("UPDATE telegram_dispatch_review_proposals SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[id]);
  const c=await pool.connect();
  try{await c.query('BEGIN');await c.query('SELECT id FROM loads WHERE id=$1 FOR KEY SHARE',[GEN_LOAD]);
   const pending=genReview(id,430,501,GEN_CHAT,action);await waitForGenLock('telegram_genqa_process_dispatch_review_action');
   // Database deadline, not a synthetic replacement of the candidate clock.
   while(!(await q('SELECT clock_timestamp()>=expires_at elapsed FROM telegram_dispatch_review_proposals WHERE id=$1',[id]))[0].elapsed)await c.query('SELECT pg_sleep(0.02)');
   await c.query('COMMIT');expect((await pending)[0].result_code).toBe('dispatch_review_expired');
   expect((await q('SELECT status FROM loads WHERE id=$1',[GEN_LOAD]))[0].status).toBe('pending');expect((await counts()).e).toBe(0);
  }finally{await c.query('ROLLBACK');c.release();}
 });
 it('claim waiting in cleanup cannot deliver a proposal that expired during the wait',async()=>{
  // A closed QA row forces a genuine cleanup UPDATE wait before selecting the live row.
  const closed=await genProposal();await genReview(closed,430,501,GEN_CHAT,'reject');
  const id=(await genIntake(401))[0].proposal_id as string;await q("UPDATE telegram_dispatch_review_proposals SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[id]);
  const c=await pool.connect();
  try{await c.query('BEGIN');await c.query('SELECT id FROM telegram_dispatch_review_outbox WHERE proposal_id=$1 FOR UPDATE',[closed]);
   const pending=genClaim();await waitForGenLock('telegram_genqa_claim_dispatch_review_delivery');
   while(!(await q('SELECT clock_timestamp()>=expires_at elapsed FROM telegram_dispatch_review_proposals WHERE id=$1',[id]))[0].elapsed)await c.query('SELECT pg_sleep(0.02)');
   await c.query('COMMIT');expect(await pending).toHaveLength(0);
  }finally{await c.query('ROLLBACK');c.release();}
 });
 it('candidate aborts on drift of the actual canonical status-mutating body',async()=>{
  const c=await pool.connect();
  try{await c.query('BEGIN');
   const def=(await c.query("SELECT pg_get_functiondef('public.dispatch_update_driver_load_status(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure) d,md5(prosrc) h FROM pg_proc WHERE oid='public.dispatch_update_driver_load_status(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure")).rows[0];
   expect(def.h).toBe('4ff8b99be0a9499b2a774dea5f4e2107');
   await c.query((def.d as string).replace('BEGIN','BEGIN\n -- simulated upstream mutation drift'));
   const sql=read(GEN_CANDIDATE),begin=sql.indexOf('DO $version$'),end=sql.indexOf('DO $provenance$');
   await expect(c.query(sql.slice(begin,end))).rejects.toThrow('genqa_dispatch_version_mismatch');
  }finally{await c.query('ROLLBACK');c.release();}
 });
 it('historical accepted L2 load/proposal/outbox/events/receipts and financial histories remain byte-identical across GEN1 lifecycle',async()=>{
  await q("INSERT INTO loads(id,user_id,status,load_reference,carrier_driver_relationship_id,loaded_miles,deadhead_miles,rate_per_mile,estimated_pay,gross_revenue,actual_pay_received) VALUES($1,$2,'pending','HTP-QA-L2',$3,235,15,2.40,564,564,560)",[QA_LOAD,D,REL]);
  const old=await qaProposal(),oldClaim=(await qaClaim())[0];await ack(oldClaim);await qaReview(old);
  await q('UPDATE loads SET loaded_miles=780,deadhead_miles=20,rate_per_mile=2.45,estimated_pay=1911,gross_revenue=1911,actual_pay_received=1900 WHERE id=$1',[LOAD]);
  const before=await historicalSnapshot(),money=await financialState(GEN_LOAD);
  expect(money).toEqual({loaded_miles:'0',deadhead_miles:'0',rate_per_mile:'0',total_miles:null,estimated_pay:null,actual_pay_received:null,gross_revenue:null,flat_rate_amount:null,wait_fee:'0',detention_fee:'0',other_fees:'0'});
  const id=await genProposal();expect(await historicalSnapshot()).toEqual(before);
  const c=(await genClaim())[0];expect(await historicalSnapshot()).toEqual(before);await genFail(c);
  await q("UPDATE telegram_dispatch_review_outbox SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[c.outbox_id]);
  await genAck((await genClaim())[0]);await genReview(id);await genClaim();
  await expect(genReview(old)).rejects.toThrow('qa_dispatch_scope_denied');
  expect(await historicalSnapshot()).toEqual(before);expect(await financialState(GEN_LOAD)).toEqual(money);
  expect((await q('SELECT status FROM loads WHERE id=$1',[QA_LOAD]))[0].status).toBe('cancelled');
 });
});

// DISPOSABLE LOCAL TRANSACTION ONLY: the parity fixture is installed inside an
// uncommitted transaction on a dedicated socket connection and always rolled
// back. Never a production migration; DB-only parity, not UI/CSV/weekly proof.
describe('TG-G1 financial trigger parity',()=>{
 const FIN_FIXTURE='src/test/fixtures/telegramDispatchFinancialParity.sql';
 const FIN_MD5:Record<string,string>={
  build_lane_key:'eb8b935c1506580ca4825da758dd66fe',
  dispatch_update_driver_load_status:'4ff8b99be0a9499b2a774dea5f4e2107',
  recompute_broker_stats:'50abbe7eaed5ec21d696aa4a11e71f04',
  recompute_lane_stats:'6fa217461ed0837509e3cfa841dff24a',
  recompute_operating_metrics:'4f9bd233bbcb5e591f7c1fc2ad39bf40',
  telegram_dispatch_update_driver_load_status:'5aa31914e9aa122500dd0c47f3b9fa37',
  tg_assistant_audit_and_metadata:'be046c485e854cf580490cb0b178d5e0',
  trg_recompute_on_load_change:'d9ea9401afa78d171e8bdb37199f0baa',
  update_updated_at_column:'301a884953d37769916294bb60562e05',
  trg_recompute_on_expense_change:'9cf9ec1e7de6caa3361b74237297c5c2',
  trg_recompute_on_fuel_change:'9cf9ec1e7de6caa3361b74237297c5c2',
 };
 const FIN_TRIGGERS:Record<string,string[]>={
  loads:['CREATE TRIGGER recompute_pi_on_load AFTER INSERT OR DELETE OR UPDATE ON public.loads FOR EACH ROW EXECUTE FUNCTION trg_recompute_on_load_change()','CREATE TRIGGER tg_assistant_audit_loads BEFORE INSERT OR UPDATE ON public.loads FOR EACH ROW EXECUTE FUNCTION tg_assistant_audit_and_metadata()','CREATE TRIGGER update_loads_updated_at BEFORE UPDATE ON public.loads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()'],
  expenses:['CREATE TRIGGER recompute_pi_on_expense AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION trg_recompute_on_expense_change()','CREATE TRIGGER tg_assistant_audit_expenses BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION tg_assistant_audit_and_metadata()','CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()'],
  fuel_logs:['CREATE TRIGGER recompute_pi_on_fuel AFTER INSERT OR DELETE OR UPDATE ON public.fuel_logs FOR EACH ROW EXECUTE FUNCTION trg_recompute_on_fuel_change()','CREATE TRIGGER tg_assistant_audit_fuel_logs BEFORE INSERT OR UPDATE ON public.fuel_logs FOR EACH ROW EXECUTE FUNCTION tg_assistant_audit_and_metadata()','CREATE TRIGGER update_fuel_logs_updated_at BEFORE UPDATE ON public.fuel_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()'],
  lane_stats:['CREATE TRIGGER trg_lane_stats_updated_at BEFORE UPDATE ON public.lane_stats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()'],
  broker_stats:['CREATE TRIGGER trg_broker_stats_updated_at BEFORE UPDATE ON public.broker_stats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()'],
  operating_metrics:['CREATE TRIGGER trg_operating_metrics_updated_at BEFORE UPDATE ON public.operating_metrics FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()'],
 };
 const BROKER=uid(601),LOAD_B=uid(303),LOAD_C=uid(304),OTHER_LOAD=uid(302),OTHER=uid(5);
 const close=(actual:unknown,expected:number,eps=1e-9)=>expect(Math.abs(Number(actual)-expected)).toBeLessThan(eps);
 const fin=(c:pg.PoolClient,sql:string,params:unknown[]=[])=>c.query(sql,params);
 async function finCounts(c:pg.PoolClient){return (await fin(c,`SELECT (SELECT count(*)::int FROM telegram_dispatch_review_proposals) p,(SELECT count(*)::int FROM telegram_dispatch_review_outbox) o,(SELECT count(*)::int FROM telegram_update_receipts) r,(SELECT count(*)::int FROM load_events) e`)).rows[0];}
 const finIntake=(c:pg.PoolClient,n:number,ref:string,status:string)=>fin(c,"SELECT * FROM telegram_process_dispatch_group_update($1,$2,$3,900,-100,'group',$4,$5)",[LEASE,n,hash(n),ref,status]);
 const finReview=(c:pg.PoolClient,id:string,n:number,action:string)=>fin(c,"SELECT * FROM telegram_process_dispatch_review_action($1,$2,$3,501,-100,'group',$4,$5)",[LEASE,n,hash(n),action,id]);
 const finGenIntake=(c:pg.PoolClient,n:number)=>fin(c,"SELECT * FROM telegram_genqa_process_dispatch_group_update($1,$2,$3,501,$4,'group','HTP-QA-GEN1','cancelled')",[LEASE,n,hash(n),GEN_CHAT]);
 const finGenReview=(c:pg.PoolClient,id:string,n:number,action='accept')=>fin(c,"SELECT * FROM telegram_genqa_process_dispatch_review_action($1,$2,$3,501,$4,'group',$5,$6)",[LEASE,n,hash(n),GEN_CHAT,action,id]);
 async function finExpectError(c:pg.PoolClient,sql:string,params:unknown[]=[]){
  await fin(c,'SAVEPOINT fin_err');
  try{await fin(c,sql,params);await fin(c,'ROLLBACK TO SAVEPOINT fin_err');throw new Error('expected error, got success');}
  catch(e){await fin(c,'ROLLBACK TO SAVEPOINT fin_err');return e;}
 }
 async function finSummaries(c:pg.PoolClient,user:string){
  return {
   lane:(await fin(c,'SELECT row_to_json(t)::text row FROM lane_stats t WHERE user_id=$1 ORDER BY t.id',[user])).rows.map(r=>r.row),
   broker:(await fin(c,'SELECT row_to_json(t)::text row FROM broker_stats t WHERE user_id=$1 ORDER BY t.id',[user])).rows.map(r=>r.row),
   operating:(await fin(c,'SELECT row_to_json(t)::text row FROM operating_metrics t WHERE user_id=$1 ORDER BY t.id',[user])).rows.map(r=>r.row),
  };
 }
 async function verifyFinParity(c:pg.PoolClient){
  const rows=(await fin(c,"SELECT proname,md5(prosrc) hash FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1::text[]) ORDER BY proname",[Object.keys(FIN_MD5)])).rows;
  const map=Object.fromEntries(rows.map(r=>[r.proname,r.hash]));
  console.log('FINANCIAL_FUNCTION_MD5',JSON.stringify(map));
  expect(map).toEqual(FIN_MD5);
  for(const [table,expected] of Object.entries(FIN_TRIGGERS)){
   const defs=(await fin(c,'SELECT pg_get_triggerdef(t.oid) def FROM pg_trigger t JOIN pg_class rel ON rel.oid=t.tgrelid JOIN pg_namespace n ON n.oid=rel.relnamespace WHERE n.nspname=$1 AND rel.relname=$2 AND NOT t.tgisinternal ORDER BY t.tgname',['public',table])).rows.map(r=>r.def);
   console.log('FINANCIAL_TRIGGER_PARITY',table,JSON.stringify(defs));
   expect(defs).toEqual(expected);
  }
 }
 async function seedFinancials(c:pg.PoolClient){
  await fin(c,"INSERT INTO brokers(id,user_id,name) VALUES($1,$2,'Oracle Broker')",[BROKER,D]);
  // A: target en_route load (existing harness row AB-123), sentinel raw values preserved.
  await fin(c,"UPDATE loads SET loaded_miles=100,deadhead_miles=20,total_miles=120,estimated_pay=300,actual_pay_received=288,short_paid_amount=12,payment_status='short_paid',load_date=CURRENT_DATE,dropoff_date=CURRENT_DATE,pickup_location='Alpha, AA',dropoff_location='Beta, BB',broker_id=$1,rate_per_mile=2.5,flat_rate_amount=7.77,wait_fee=1.01,detention_fee=2.02,other_fees=3.03,gross_revenue=300 WHERE id=$2",[BROKER,LOAD]);
  // B: completed, nullable actual pay falls back to estimate.
  await fin(c,"INSERT INTO loads(id,user_id,status,load_reference,carrier_driver_relationship_id,loaded_miles,deadhead_miles,total_miles,estimated_pay,actual_pay_received,payment_status,load_date,dropoff_date,pickup_location,dropoff_location,broker_id) VALUES($1,$2,'completed','BB-456',$3,80,20,100,250,NULL,'unpaid',CURRENT_DATE,CURRENT_DATE,'Alpha, AA','Beta, BB',$4)",[LOAD_B,D,REL,BROKER]);
  // C: already cancelled, valid 500+50=550 components, must never count.
  await fin(c,"INSERT INTO loads(id,user_id,status,load_reference,carrier_driver_relationship_id,loaded_miles,deadhead_miles,total_miles,estimated_pay,actual_pay_received,payment_status,load_date,dropoff_date,pickup_location,dropoff_location,broker_id) VALUES($1,$2,'cancelled','CC-789',$3,500,50,550,99999,99999,'paid',CURRENT_DATE,CURRENT_DATE,'Alpha, AA','Beta, BB',$4)",[LOAD_C,D,REL,BROKER]);
  await fin(c,"INSERT INTO expenses(user_id,expense_date,category,amount,expense_type,linked_load_id) VALUES ($1,CURRENT_DATE,'tolls',30,'variable',$2),($1,CURRENT_DATE,'tolls',10,'variable',$3),($1,CURRENT_DATE,'tolls',5,'variable',NULL),($1,CURRENT_DATE,'insurance',20,'fixed',NULL)",[D,LOAD,LOAD_B]);
  await fin(c,"INSERT INTO fuel_logs(user_id,date,station,gallons,price_per_gallon,total_cost,linked_load_id) VALUES ($1,CURRENT_DATE,'S',10,2.4,24,$2),($1,CURRENT_DATE,'S',8,2,16,$3),($1,CURRENT_DATE,'S',5,2,10,NULL)",[D,LOAD,LOAD_B]);
  // Separate second driver/workspace with its own complete financial state.
  await fin(c,"UPDATE loads SET status='completed',loaded_miles=50,deadhead_miles=10,total_miles=60,estimated_pay=100,load_date=CURRENT_DATE,dropoff_date=CURRENT_DATE,pickup_location='Gamma, CC',dropoff_location='Delta, DD' WHERE id=$1",[OTHER_LOAD]);
  await fin(c,"INSERT INTO expenses(user_id,expense_date,category,amount,expense_type) VALUES($1,CURRENT_DATE,'tolls',7,'variable')",[OTHER]);
  await fin(c,"INSERT INTO fuel_logs(user_id,date,gallons,price_per_gallon,total_cost) VALUES($1,CURRENT_DATE,4,2,8)",[OTHER]);
 }
 async function withFinFixture(fn:(c:pg.PoolClient)=>Promise<void>){
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   // Fixture DDL and synthetic seeds run as the table owner; only the actual
   // RPC calls execute under SET LOCAL ROLE service_role.
   await c.query(read(FIN_FIXTURE));
   await verifyFinParity(c);
   await seedFinancials(c);
   await c.query('SET LOCAL ROLE service_role');
   await fn(c);
  }finally{
   try{await c.query('ROLLBACK');}finally{c.release();}
  }
 }
 it('authorized completion preserves every financial field byte-identical and summaries match the independent oracle',async()=>{
  await withFinFixture(async c=>{
   const moneyBefore=(await fin(c,'SELECT loaded_miles,deadhead_miles,rate_per_mile,total_miles,estimated_pay,actual_pay_received,gross_revenue,flat_rate_amount,wait_fee,detention_fee,other_fees,short_paid_amount,payment_status,broker_id FROM loads WHERE id=$1',[LOAD])).rows[0];
   const id=(await finIntake(c,10,'AB-123','completed')).rows[0].proposal_id as string;
   expect((await finReview(c,id,30,'accept')).rows[0].result_code).toBe('dispatch_review_accepted');
   const row=(await fin(c,'SELECT status,updated_by_user_id,loaded_miles,deadhead_miles,rate_per_mile,total_miles,estimated_pay,actual_pay_received,gross_revenue,flat_rate_amount,wait_fee,detention_fee,other_fees,short_paid_amount,payment_status,broker_id FROM loads WHERE id=$1',[LOAD])).rows[0];
   expect(row.status).toBe('completed');
   expect(row.updated_by_user_id).toBe(STAFF);
   const {status:_,updated_by_user_id:__,...moneyAfter}=row;
   expect(moneyAfter).toEqual(moneyBefore);
   const lane=(await fin(c,'SELECT * FROM lane_stats WHERE user_id=$1',[D])).rows[0];
   expect(lane.load_count).toBe(2);close(lane.avg_loaded_miles,90);close(lane.avg_deadhead_miles,20);
   close(lane.avg_rpm,2.45);close(lane.avg_net_profit,229);close(lane.avg_margin_pct,85.425);
   const broker=(await fin(c,'SELECT * FROM broker_stats WHERE user_id=$1',[D])).rows[0];
   expect(broker.load_count).toBe(2);close(broker.avg_estimated_pay,275);close(broker.avg_actual_pay,288);
   close(broker.avg_variance_amount,-131);expect(broker.short_pay_count).toBe(1);expect(broker.unpaid_count).toBe(1);
   const ops=(await fin(c,'SELECT * FROM operating_metrics WHERE user_id=$1',[D])).rows[0];
   close(ops.rolling_cost_per_mile,95/220);close(ops.rolling_fuel_cost_per_mile,50/220);
   close(ops.rolling_deadhead_pct,40/220*100);close(ops.rolling_margin_pct,(538-95)/538*100);
   expect((await finCounts(c)).e).toBe(1);
   console.log('FINANCIAL_ORACLE_COMPLETION',JSON.stringify({lane,broker,ops}));
  });
 },20000);
 it('authorized cancellation excludes the load from lane/broker/revenue inputs while all costs stay intact',async()=>{
  await withFinFixture(async c=>{
   const expensesBefore=(await fin(c,'SELECT row_to_json(t)::text row FROM expenses t ORDER BY t.id')).rows.map(r=>r.row);
   const fuelBefore=(await fin(c,'SELECT row_to_json(t)::text row FROM fuel_logs t ORDER BY t.id')).rows.map(r=>r.row);
   const id=(await finIntake(c,10,'AB-123','cancelled')).rows[0].proposal_id as string;
   expect((await finReview(c,id,30,'accept')).rows[0].result_code).toBe('dispatch_review_accepted');
   expect((await fin(c,'SELECT status FROM loads WHERE id=$1',[LOAD])).rows[0].status).toBe('cancelled');
   const lane=(await fin(c,'SELECT * FROM lane_stats WHERE user_id=$1',[D])).rows[0];
   expect(lane.load_count).toBe(1);close(lane.avg_rpm,2.5);close(lane.avg_net_profit,224);close(lane.avg_margin_pct,89.6);
   close(lane.avg_loaded_miles,80);close(lane.avg_deadhead_miles,20);
   const broker=(await fin(c,'SELECT * FROM broker_stats WHERE user_id=$1',[D])).rows[0];
   expect(broker.load_count).toBe(1);close(broker.avg_estimated_pay,250);close(broker.avg_actual_pay,0);
   close(broker.avg_variance_amount,-250);expect(broker.short_pay_count).toBe(0);expect(broker.unpaid_count).toBe(1);
   const ops=(await fin(c,'SELECT * FROM operating_metrics WHERE user_id=$1',[D])).rows[0];
   close(ops.rolling_cost_per_mile,0.95);close(ops.rolling_fuel_cost_per_mile,0.5);
   close(ops.rolling_deadhead_pct,20);close(ops.rolling_margin_pct,62);
   // Existing rule preserved: 60-day variable expenses and fuel stay counted even when linked to the cancelled load.
   expect((await fin(c,'SELECT row_to_json(t)::text row FROM expenses t ORDER BY t.id')).rows.map(r=>r.row)).toEqual(expensesBefore);
   expect((await fin(c,'SELECT row_to_json(t)::text row FROM fuel_logs t ORDER BY t.id')).rows.map(r=>r.row)).toEqual(fuelBefore);
   console.log('FINANCIAL_ORACLE_CANCELLATION',JSON.stringify({lane,broker,ops}));
  });
 },20000);
 it('exact replay and fresh-update already-handled repeat never duplicate event, receipt or summary rows',async()=>{
  await withFinFixture(async c=>{
   const id=(await finIntake(c,10,'AB-123','completed')).rows[0].proposal_id as string;
   expect((await finReview(c,id,30,'accept')).rows[0].result_code).toBe('dispatch_review_accepted');
   const summaries=await finSummaries(c,D),countsBefore=await finCounts(c);
   const replay=(await finReview(c,id,30,'accept')).rows[0];
   expect(replay).toEqual({is_new:false,result_code:'dispatch_review_accepted'});
   const repeat=(await finReview(c,id,31,'accept')).rows[0];
   expect(repeat).toEqual({is_new:true,result_code:'dispatch_review_already_handled'});
   // Complete summary rows including UUIDs prove no hidden delete/reinsert recomputation.
   expect(await finSummaries(c,D)).toEqual(summaries);
   const countsAfter=await finCounts(c);
   expect(countsAfter.e).toBe(1);
   expect(countsAfter.r).toBe(countsBefore.r+1);
   expect(countsAfter.p).toBe(countsBefore.p);
   expect(countsAfter.o).toBe(countsBefore.o);
  });
 },20000);
 it('rejected review leaves loads and every financial summary row untouched',async()=>{
  await withFinFixture(async c=>{
   const loadsBefore=(await fin(c,'SELECT row_to_json(t)::text row FROM loads t ORDER BY t.id')).rows.map(r=>r.row);
   const summaries=await finSummaries(c,D);
   const id=(await finIntake(c,10,'AB-123','completed')).rows[0].proposal_id as string;
   expect((await finReview(c,id,30,'reject')).rows[0].result_code).toBe('dispatch_review_rejected');
   expect((await fin(c,'SELECT row_to_json(t)::text row FROM loads t ORDER BY t.id')).rows.map(r=>r.row)).toEqual(loadsBefore);
   expect(await finSummaries(c,D)).toEqual(summaries);
   expect((await finCounts(c)).e).toBe(0);
  });
 },20000);
 it('canonical event-write failure rolls back load, summaries, receipt and event; valid retry succeeds',async()=>{
  await withFinFixture(async c=>{
   const id=(await finIntake(c,10,'AB-123','completed')).rows[0].proposal_id as string;
   const summaries=await finSummaries(c,D),countsBefore=await finCounts(c);
   // Test-only failure trigger, created and dropped as the table owner inside
   // the rolled-back transaction; RPC calls stay under service_role.
   await c.query('RESET ROLE');
   await fin(c,"CREATE FUNCTION public.test_forced_event_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test_forced_event_failure'; END $$");
   await fin(c,'CREATE TRIGGER test_forced_event_failure BEFORE INSERT ON public.load_events FOR EACH ROW EXECUTE FUNCTION test_forced_event_failure()');
   await c.query('SET LOCAL ROLE service_role');
   const error=await finExpectError(c,"SELECT * FROM telegram_process_dispatch_review_action($1,$2,$3,501,-100,'group','accept',$4)",[LEASE,30,hash(30),id]);
   expect(String(error)).toContain('test_forced_event_failure');
   expect((await fin(c,'SELECT status FROM loads WHERE id=$1',[LOAD])).rows[0].status).toBe('en_route');
   expect(await finSummaries(c,D)).toEqual(summaries);
   expect(await finCounts(c)).toEqual(countsBefore);
   await c.query('RESET ROLE');
   await fin(c,'DROP TRIGGER test_forced_event_failure ON public.load_events');
   await fin(c,'DROP FUNCTION public.test_forced_event_failure()');
   await c.query('SET LOCAL ROLE service_role');
   expect((await finReview(c,id,31,'accept')).rows[0].result_code).toBe('dispatch_review_accepted');
   expect((await fin(c,'SELECT status FROM loads WHERE id=$1',[LOAD])).rows[0].status).toBe('completed');
   expect((await finCounts(c)).e).toBe(1);
  });
 },20000);
 it('second driver workspace load, expenses, fuel and all summary rows stay byte-identical',async()=>{
  await withFinFixture(async c=>{
   const otherLoads=(await fin(c,'SELECT row_to_json(t)::text row FROM loads t WHERE user_id=$1 ORDER BY t.id',[OTHER])).rows.map(r=>r.row);
   const otherExpenses=(await fin(c,'SELECT row_to_json(t)::text row FROM expenses t WHERE user_id=$1 ORDER BY t.id',[OTHER])).rows.map(r=>r.row);
   const otherFuel=(await fin(c,'SELECT row_to_json(t)::text row FROM fuel_logs t WHERE user_id=$1 ORDER BY t.id',[OTHER])).rows.map(r=>r.row);
   const otherSummaries=await finSummaries(c,OTHER);
   const id=(await finIntake(c,10,'AB-123','completed')).rows[0].proposal_id as string;
   expect((await finReview(c,id,30,'accept')).rows[0].result_code).toBe('dispatch_review_accepted');
   expect((await fin(c,'SELECT row_to_json(t)::text row FROM loads t WHERE user_id=$1 ORDER BY t.id',[OTHER])).rows.map(r=>r.row)).toEqual(otherLoads);
   expect((await fin(c,'SELECT row_to_json(t)::text row FROM expenses t WHERE user_id=$1 ORDER BY t.id',[OTHER])).rows.map(r=>r.row)).toEqual(otherExpenses);
   expect((await fin(c,'SELECT row_to_json(t)::text row FROM fuel_logs t WHERE user_id=$1 ORDER BY t.id',[OTHER])).rows.map(r=>r.row)).toEqual(otherFuel);
   expect(await finSummaries(c,OTHER)).toEqual(otherSummaries);
  });
 },20000);
 it('zero, null and total-only mileage survive, decimals stay raw, and the real validated constraint rejects contradictory totals',async()=>{
  await withFinFixture(async c=>{
   // Zero-mileage and NULL total are legitimate.
   await fin(c,"INSERT INTO loads(id,user_id,status,load_reference,loaded_miles,deadhead_miles,total_miles,estimated_pay,load_date,pickup_location,dropoff_location) VALUES($1,$2,'completed','ZERO-1',0,0,NULL,0,CURRENT_DATE,'Solo, EE','Solo, FF')",[uid(305),D]);
   // Legitimate total-only historical load: components zero, explicit total drives RPM fallback.
   await fin(c,"INSERT INTO loads(id,user_id,status,load_reference,loaded_miles,deadhead_miles,total_miles,estimated_pay,actual_pay_received,load_date,pickup_location,dropoff_location) VALUES($1,$2,'completed','TOTAL-ONLY',0,0,120,240,240,CURRENT_DATE,'Solo, EE','Solo, FF')",[uid(306),D]);
   const lane=(await fin(c,"SELECT * FROM lane_stats WHERE user_id=$1 AND lane_key='Solo, EE -> Solo, FF'",[D])).rows[0];
   expect(lane.load_count).toBe(2);
   close(lane.avg_rpm,1);
   // Decimal and fee raw preservation: no rounding or rewriting.
   await fin(c,"INSERT INTO loads(id,user_id,status,load_reference,loaded_miles,deadhead_miles,total_miles,estimated_pay,wait_fee,detention_fee,other_fees,load_date,pickup_location,dropoff_location) VALUES($1,$2,'completed','DEC-1',100,20,120,288.01,0.01,2.02,3.03,CURRENT_DATE,'Dec, GG','Dec, HH')",[uid(307),D]);
   const dec=(await fin(c,'SELECT estimated_pay,wait_fee,detention_fee,other_fees FROM loads WHERE id=$1',[uid(307)])).rows[0];
   expect(dec).toEqual({estimated_pay:'288.01',wait_fee:'0.01',detention_fee:'2.02',other_fees:'3.03'});
   // Real validated constraint rejects contradictory overlarge and too-small totals and negatives.
   for(const [ref,loaded,deadhead,total] of [['OVER-1',100,20,1000],['UNDER-1',500,50,10],['NEG-1',100,20,-5]] as const){
    const error=await finExpectError(c,"INSERT INTO loads(id,user_id,status,load_reference,loaded_miles,deadhead_miles,total_miles,load_date,pickup_location,dropoff_location) VALUES($1,$2,'completed',$3,$4,$5,$6,CURRENT_DATE,'X, II','Y, JJ')",[uid(308),D,ref,loaded,deadhead,total]);
    expect((error as {code?:string}).code).toBe('23514');
   }
   expect((await fin(c,"SELECT count(*)::int n FROM loads WHERE load_reference IN('OVER-1','UNDER-1','NEG-1')")).rows[0].n).toBe(0);
  });
 },20000);
 it('GENQA cancellation runs the same real trigger chain and leaves other workspaces byte-identical',async()=>{
  await withFinFixture(async c=>{
   // Synthetic equivalents of the existing seedGenFixture provenance; identity
   // rows are inserted as the table owner, then the role is restored for RPCs.
   await c.query('RESET ROLE');
   await fin(c,'INSERT INTO auth.users VALUES($1)',[GEN_DRIVER]);
   await fin(c,"INSERT INTO recruiter_profiles(id,user_id,recruiter_name,company_name,status,company_type,posting_terms_accepted_at) VALUES($1,$2,'QA','QA','active','carrier',now())",[GEN_RECRUITER,OTHER]);
   await fin(c,"INSERT INTO user_capabilities VALUES($1,'recruiter','active')",[OTHER]);
   await fin(c,"INSERT INTO recruiter_billing_profiles VALUES($1,$2,'growth','active')",[GEN_RECRUITER,OTHER]);
   await fin(c,"INSERT INTO recruiter_members(recruiter_id,member_user_id,status,role,permissions) VALUES($1,$2,'active','recruiter_staff','{\"loads_update_status\":true}')",[GEN_RECRUITER,STAFF]);
   await fin(c,"INSERT INTO carrier_driver_relationships(id,recruiter_id,driver_user_id,status,created_by_user_id) VALUES($1,$2,$3,'active',$4)",[GEN_REL,GEN_RECRUITER,GEN_DRIVER,OTHER]);
   await fin(c,"INSERT INTO loads(id,user_id,status,load_reference,carrier_driver_relationship_id,loaded_miles,deadhead_miles,total_miles,estimated_pay,load_date,dropoff_date,pickup_location,dropoff_location) VALUES($1,$2,'pending','HTP-QA-GEN1',$3,60,0,60,150,CURRENT_DATE,CURRENT_DATE,'Gen, KK','Gen, LL')",[GEN_LOAD,GEN_DRIVER,GEN_REL]);
   await fin(c,"INSERT INTO telegram_chat_bindings(id,telegram_chat_id,recruiter_id,chat_type,bound_by_user_id) VALUES($1,$2,$3,'group',$4)",[GEN_BINDING,GEN_CHAT,GEN_RECRUITER,OTHER]);
   await c.query('SET LOCAL ROLE service_role');
   const before=await finSummaries(c,D);
   const genLaneBefore=(await fin(c,'SELECT load_count FROM lane_stats WHERE user_id=$1',[GEN_DRIVER])).rows[0];
   expect(genLaneBefore.load_count).toBe(1);
   const id=(await finGenIntake(c,400)).rows[0].proposal_id as string;
   expect((await finGenReview(c,id,430)).rows[0].result_code).toBe('dispatch_review_accepted');
   expect((await fin(c,'SELECT status FROM loads WHERE id=$1',[GEN_LOAD])).rows[0].status).toBe('cancelled');
   // Real trigger chain removed the cancelled load from every summary input.
   expect((await fin(c,'SELECT count(*)::int n FROM lane_stats WHERE user_id=$1',[GEN_DRIVER])).rows[0].n).toBe(0);
   expect((await fin(c,'SELECT count(*)::int n FROM broker_stats WHERE user_id=$1',[GEN_DRIVER])).rows[0].n).toBe(0);
   const genOps=(await fin(c,'SELECT * FROM operating_metrics WHERE user_id=$1',[GEN_DRIVER])).rows[0];
   close(genOps.rolling_cost_per_mile,0);close(genOps.rolling_margin_pct,0);
   expect(await finSummaries(c,D)).toEqual(before);
  });
 },20000);
});
