// @vitest-environment node
// Disposable PostgreSQL 17.9, NEVER a configured/database URL. No network listener.
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

beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'tgg1b-local-')); execFileSync('chown',['1000:1000',dir]);
 run('initdb',['-D',join(dir,'data'),'-U','local_owner','-A','trust','--no-locale']);
 run('pg_ctl',['-D',join(dir,'data'),'-l',join(dir,'postgres.log'),'-o',`-k ${dir} -h '' -p 55439`,'-w','start']);
 // Explicit socket/user/db/port: no production PG environment is consulted.
 pool=new pg.Pool({host:dir,port:55439,user:'local_owner',database:'postgres',password:'',options:'',ssl:false,max:8,statement_timeout:10000});
 expect((await q('SHOW server_version'))[0].server_version).toContain('17.9');
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
},60000);
async function seedFixture() {
 await q('TRUNCATE auth.users,telegram_update_receipts CASCADE');
 for(let n=1;n<=5;n++) await q('INSERT INTO auth.users VALUES($1)',[uid(n)]);
 await q(`INSERT INTO recruiter_profiles(id,user_id,recruiter_name,company_name,status,company_type,posting_terms_accepted_at) VALUES('${R}','${OWNER}','Local','Local','active','carrier',now()),('${uid(102)}','${uid(4)}','Other','Other','active','carrier',now());
 INSERT INTO user_capabilities VALUES('${OWNER}','recruiter','active'),('${uid(4)}','recruiter','active');
 INSERT INTO recruiter_billing_profiles VALUES('${R}','${OWNER}','growth','active');
 INSERT INTO recruiter_members(recruiter_id,member_user_id,status,role,permissions) VALUES('${R}','${OWNER}','active','recruiter_owner','{}'),('${R}','${STAFF}','active','recruiter_staff','{"loads_update_status":true}');
 INSERT INTO carrier_driver_relationships(id,recruiter_id,driver_user_id,status,created_by_user_id) VALUES('${REL}','${R}','${D}','active','${OWNER}'),('${uid(202)}','${uid(102)}','${uid(5)}','active','${uid(4)}');
 INSERT INTO loads VALUES('${LOAD}','${D}','en_route','AB-123','${REL}',NULL),('${uid(302)}','${uid(5)}','pending','ZZ-999','${uid(202)}',NULL);
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
