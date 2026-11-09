// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { SOURCES, exactFunction, uid } from './fixtures/phase3AssistantBootstrap';
import { dispatchPayload, emptyDispatchForm } from '@/lib/dispatchWorkspace';
import { aggregateReport } from '@/lib/reportAggregator';
import { buildReportCSV } from '@/lib/reportCsv';
const candidate='supabase/migration-candidates/20261108140123_dispatcher_mini_app.sql';
const companyCandidate='supabase/migration-candidates/20261108225739_company_driver_dispatch_workflow.sql';
const read=(p:string)=>readFileSync(p,'utf8');const mig=(p:string)=>read('supabase/migrations/'+p);
let dir='',pool:pg.Pool;
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG')&&k!=='DATABASE_URL'));
const run=(bin:string,args:string[])=>{const exe=process.env.HTP_TEST_POSTGRES_BINDIR?join(process.env.HTP_TEST_POSTGRES_BINDIR,bin):bin;return process.getuid?.()===0?execFileSync('setpriv',['--reuid=1000','--regid=1000','--clear-groups',exe,...args],{env,stdio:'pipe'}):execFileSync(exe,args,{env,stdio:'pipe'});};
const R=uid(101),OTHER=uid(102),OWNER=uid(1),DRIVER=uid(2),STAFF=uid(3),OTHER_OWNER=uid(4),REL=uid(201),OTHER_REL=uid(202),LOAD=uid(301);
beforeAll(async()=>{
 if(process.env.HTP_TEST_PGLITE==='1'){
  // Real PostgreSQL/WASM for executors that forbid socket creation. Every SQL
  // body, transaction and SET ROLE probe below is unchanged. This single-session
  // transport is not evidence of concurrent transactions or production behavior.
  const db=new PGlite();
  const query=async(sql:string,args:unknown[]=[])=>args.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]};
  pool={query,connect:async()=>({query,release(){}}),end:()=>db.close()} as unknown as pg.Pool;
 }else{
  dir=mkdtempSync(join(tmpdir(),'dispatch-mini-pg-'));if(process.getuid?.()===0)execFileSync('chown',['1000:1000',dir]);
  const version=run('postgres',['--version']).toString();expect([16,17]).toContain(Number(version.match(/(\d+)\./)?.[1]));
  run('initdb',['-D',join(dir,'data'),'-U','local_owner','-A','trust','--no-locale']);run('pg_ctl',['-D',join(dir,'data'),'-l',join(dir,'postgres.log'),'-o',`-k ${dir} -h '' -p 55441`,'-w','start']);
  pool=new pg.Pool({host:dir,port:55441,user:'local_owner',database:'postgres',password:'',ssl:false,options:'',max:6,statement_timeout:10000});
 }
 await pool.query(read('src/test/fixtures/phase3AssistantCanonical.sql'));
 for(const[path,names]of SOURCES)for(const name of names)await pool.query(exactFunction(mig(path),name));
 const rel=mig('20260808161500_phase1t_b1_settlement_schema.sql');await pool.query(rel.slice(rel.indexOf('CREATE TABLE public.carrier_driver_relationships'),rel.indexOf('-- ---------------------------------------------------------------------------\n-- 2)')));
 await pool.query(read('src/test/fixtures/dispatchWorkspace.sql'));
 const canonical=mig('20260819162100_2a7bb78e-ad6a-4417-a7d1-28ef6ba433aa.sql');await pool.query(canonical.slice(canonical.indexOf('CREATE TABLE IF NOT EXISTS public.load_events'),canonical.indexOf('-- G. Dispatch authorization helper')));
 for(const n of ['current_user_can_dispatch_load_action','dispatch_create_driver_load','dispatch_update_driver_load_status'])await pool.query(exactFunction(canonical,n));
 await pool.query(read(candidate));
 await pool.query(`
   ALTER TABLE auth.users ADD COLUMN email text UNIQUE, ADD COLUMN email_confirmed_at timestamptz;
   ALTER TABLE public.loads ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN actual_pay_received numeric;
 `);
 const ownerGuard = mig('20260808163500_phase1t_b2a_settlement_authorization_helpers.sql');
 await pool.query(exactFunction(ownerGuard.replace(/CREATE FUNCTION public\./g, 'CREATE OR REPLACE FUNCTION public.'), 'settlement_current_user_can_administer_carrier'));
 const relationshipActions = mig('20260808170500_phase1t_b2c1_carrier_driver_relationship_rpcs.sql').replace(/CREATE FUNCTION public\./g, 'CREATE OR REPLACE FUNCTION public.');
 for (const name of ['settlement_accept_my_carrier_relationship', 'settlement_end_carrier_relationship']) await pool.query(exactFunction(relationshipActions, name));
 await pool.query(read(companyCandidate));
},60000);
afterAll(async()=>{if(pool)await pool.end();if(dir){try{run('pg_ctl',['-D',join(dir,'data'),'-m','immediate','-w','stop']);}finally{rmSync(dir,{recursive:true,force:true});}}});
async function seedFixture(c:pg.PoolClient){
  await c.query(`INSERT INTO auth.users VALUES($1),($2),($3),($4);`,[OWNER,DRIVER,STAFF,OTHER_OWNER]);
  await c.query(`INSERT INTO recruiter_profiles(id,user_id,recruiter_name,company_name,status,company_type,posting_terms_accepted_at) VALUES($1,$2,'QA','Company','active','carrier',now()),($3,$4,'Other','Other','active','carrier',now());`,[R,OWNER,OTHER,OTHER_OWNER]);
  await c.query(`INSERT INTO recruiter_billing_profiles(recruiter_id,user_id,plan,status) VALUES($1,$2,'fleet','active');`,[R,OWNER]);
  await c.query(`INSERT INTO recruiter_members(recruiter_id,member_user_id,status,permissions) VALUES($1,$2,'active','{"loads_view":true,"loads_dispatch":true,"loads_update_status":true}');`,[R,STAFF]);
  await c.query(`INSERT INTO carrier_driver_relationships(id,recruiter_id,driver_user_id,status,created_by_user_id) VALUES($1,$2,$3,'active',$4),($5,$6,$3,'active',$7);`,[REL,R,DRIVER,OWNER,OTHER_REL,OTHER,OTHER_OWNER]);
  await c.query(`INSERT INTO profiles(user_id,display_name) VALUES($1,'Connected QA Driver')`,[DRIVER]);
  await c.query(`INSERT INTO loads(id,user_id,carrier_driver_relationship_id,load_reference,status,load_date,pickup_location,dropoff_location,loaded_miles,deadhead_miles,total_miles,estimated_pay) VALUES($2,$1,$3,'QA1234','pending',CURRENT_DATE-4,'A','B',200.45,10,210.45,400);`,[DRIVER,LOAD,REL]);
}
async function scenario(fn:(c:pg.PoolClient,call:(sql:string,args?:unknown[],actor?:string,role?:string)=>Promise<any[]>)=>Promise<void>){
 const c=await pool.connect();await c.query('BEGIN');
 try{
  await seedFixture(c);
  const call=async(sql:string,args:unknown[]=[],actor=OWNER,role='authenticated')=>{
   await c.query('SAVEPOINT probe');try{await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[actor]);await c.query(`SET LOCAL ROLE ${role}`);const rows=(await c.query(sql,args)).rows;await c.query('RESET ROLE');await c.query('RELEASE SAVEPOINT probe');return rows;}catch(e){await c.query('ROLLBACK TO SAVEPOINT probe');await c.query('RELEASE SAVEPOINT probe');throw e;}
  };
  await fn(c,call);
 }finally{await c.query('ROLLBACK');c.release();}
 expect((await pool.query('SELECT count(*)::int n FROM loads')).rows[0].n).toBe(0);
}
const statusSql='SELECT dispatch_mini_status($1,$2,$3,$4,$5,$6,CURRENT_DATE,$7) result';
const statusArgs=(key=uid(901),status='completed',date:string|null=null)=>[R,REL,LOAD,'pending',status,date,key];
describe('Dispatcher Mini App disposable real PostgreSQL',()=>{
 it('read grants deny anon; owner resolves explicit API and direct table RLS remains denied',()=>scenario(async(_,call)=>{
  await expect(call('SELECT dispatch_mini_read($1)',[R],'','anon')).rejects.toThrow(/permission denied/);
  expect(await call('SELECT id FROM loads')).toEqual([]);const r=await call('SELECT dispatch_mini_read($1) result',[R]);expect(r[0].result.loads[0].load_reference).toBe('QA1234');expect(r[0].result.drivers).toEqual([{relationship_id:REL,display_name:'Connected QA Driver'}]);
 }));
 it('denies cross-workspace, driver mismatch and inactive relationship',()=>scenario(async(c,call)=>{
  await expect(call('SELECT dispatch_mini_read($1)',[OTHER])).rejects.toThrow(/not_authorized/);await expect(call('SELECT dispatch_mini_read($1,$2)',[R,OTHER_REL])).rejects.toThrow(/not_authorized/);await c.query("UPDATE carrier_driver_relationships SET status='ended' WHERE id=$1",[REL]);await expect(call(statusSql,statusArgs(uid(901),'cancelled'))).rejects.toThrow(/not_authorized/);
 }));
 it.each(['loads_view','loads_dispatch','loads_update_status'])('requires independent permission %s',permission=>scenario(async(c,call)=>{
  await c.query('UPDATE recruiter_members SET permissions=permissions||jsonb_build_object($1::text,false) WHERE member_user_id=$2',[permission,STAFF]);
  const form=dispatchPayload({...emptyDispatchForm(),relationship_id:REL,load_reference:'CREATE123',pickup_location:'A',dropoff_location:'B',pay_model:'manual',manual_amount:'400'});
  if(permission==='loads_view'){await expect(call('SELECT dispatch_mini_read($1)',[R],STAFF)).rejects.toThrow(/not_authorized/);await expect(call('SELECT dispatch_mini_create($1,$2,$3,$4)',[R,REL,uid(902),form],STAFF)).rejects.toThrow(/not_authorized/);}
  if(permission==='loads_dispatch')await expect(call('SELECT dispatch_mini_create($1,$2,$3,$4)',[R,REL,uid(902),form],STAFF)).rejects.toThrow(/not_authorized/);
  if(permission==='loads_update_status')await expect(call(statusSql,statusArgs(uid(901),'cancelled'),STAFF)).rejects.toThrow(/not_authorized/);
 }));
 it('denies suspended workspace, capability and revoked membership',()=>scenario(async(c,call)=>{
  await c.query("INSERT INTO user_capabilities VALUES($1,'recruiter','suspended')",[STAFF]);await expect(call('SELECT dispatch_mini_read($1)',[R],STAFF)).rejects.toThrow(/not_authorized/);await c.query('DELETE FROM user_capabilities');await c.query("UPDATE recruiter_members SET status='revoked'");await expect(call('SELECT dispatch_mini_read($1)',[R],STAFF)).rejects.toThrow(/not_authorized/);await c.query("UPDATE recruiter_profiles SET status='suspended' WHERE id=$1",[R]);await expect(call('SELECT dispatch_mini_read($1)',[R])).rejects.toThrow(/not_authorized/);
 }));
 it('creates canonical pending load and binds exact retry to actor and payload',()=>scenario(async(c,call)=>{
  const payload=dispatchPayload({...emptyDispatchForm(),relationship_id:REL,load_reference:'CREATE123',pickup_location:'Dallas, TX',dropoff_location:'Austin, TX',loaded_miles:'200.45',deadhead_miles:'10',total_miles:'210.45',pay_model:'manual',manual_amount:'400.005'});
  const sql='SELECT dispatch_mini_create($1,$2,$3,$4) result',args=[R,REL,uid(902),payload];const a=await call(sql,args);const b=await call(sql,args);expect(b[0].result.id).toBe(a[0].result.id);expect(b[0].result.replayed).toBe(true);expect((await c.query('SELECT status,estimated_pay,loaded_miles FROM loads WHERE id=$1',[a[0].result.id])).rows[0]).toEqual({status:'pending',estimated_pay:'400.01',loaded_miles:'200.45'});
  await expect(call(sql,[R,REL,uid(902),{...payload,notes:'changed'}])).rejects.toThrow(/idempotency_conflict/);await expect(call(sql,args,STAFF)).rejects.toThrow(/idempotency_conflict/);expect((await c.query("SELECT count(*)::int n FROM load_events WHERE load_id=$1",[a[0].result.id])).rows[0].n).toBe(2);
 }));
 it('recognizes decimal multiplication halfway cents and refuses a duplicate reference under a new intent key',()=>scenario(async(c,call)=>{
  const p=dispatchPayload({...emptyDispatchForm(),relationship_id:REL,load_reference:'DECIMAL123',pickup_location:'A',dropoff_location:'B',loaded_miles:'14.5',rate_per_mile:'2.01'});
  const sql='SELECT dispatch_mini_create($1,$2,$3,$4) result';
  const first=await call(sql,[R,REL,uid(905),p]);
  expect(p.estimated_pay).toBe(29.15);
  expect((await c.query('SELECT estimated_pay FROM loads WHERE id=$1',[first[0].result.id])).rows[0].estimated_pay).toBe('29.15');
  await expect(call(sql,[R,REL,uid(906),p])).rejects.toThrow(/reference_in_use/);
  expect((await c.query('SELECT count(*)::int n FROM dispatch_command_receipts')).rows[0].n).toBe(1);
 }));
 it.each(['AB1_','A_12','AB1-'])('rejects group-incompatible reference %s server-side',reference=>scenario(async(_,call)=>{
  const p=dispatchPayload({...emptyDispatchForm(),relationship_id:REL,load_reference:reference,pickup_location:'A',dropoff_location:'B',pay_model:'manual',manual_amount:'400'});
  await expect(call('SELECT dispatch_mini_create($1,$2,$3,$4)',[R,REL,uid(907),p])).rejects.toThrow(/invalid_load_reference/);
 }));
 it('rejects contradictory mileage without inserting or consuming receipt',()=>scenario(async(c,call)=>{
  const p=dispatchPayload({...emptyDispatchForm(),relationship_id:REL,load_reference:'CREATE123',pickup_location:'A',dropoff_location:'B',loaded_miles:'200',total_miles:'1',pay_model:'manual',manual_amount:'400'});await expect(call('SELECT dispatch_mini_create($1,$2,$3,$4)',[R,REL,uid(902),p])).rejects.toThrow(/mileage_conflict/);expect((await c.query('SELECT count(*)::int n FROM dispatch_command_receipts')).rows[0].n).toBe(0);
 }));
 it.each(['loaded_miles_only','total_miles','loaded_plus_deadhead','flat_rate','manual'] as const)('server confirms canonical %s pay and rejects tampering or omitted agreed pay',model=>scenario(async(_,call)=>{
  const p=dispatchPayload({...emptyDispatchForm(),relationship_id:REL,load_reference:'CREATE123',pickup_location:'A',dropoff_location:'B',loaded_miles:'200.45',deadhead_miles:'10',total_miles:'210.45',pay_model:model,rate_per_mile:'2.35',deadhead_rate_per_mile:'1.15',flat_rate_amount:'400.005',manual_amount:'400.005',other_fees:'3.12'});
  const sql='SELECT dispatch_mini_create($1,$2,$3,$4) result';await call(sql,[R,REL,uid(903),p]);
  await expect(call(sql,[R,REL,uid(904),{...p,estimated_pay:0}])).rejects.toThrow(/pay_conflict/);
  const field=model==='manual'?'manual_amount':model==='flat_rate'?'flat_rate_amount':'rate_per_mile';await expect(call(sql,[R,REL,uid(904),{...p,[field]:null}])).rejects.toThrow(/explicit_pay_required/);
 }));
 it('appends actual date once, preserves scheduled/financial fields, and isolates replay actor/date/target',()=>scenario(async(c,call)=>{
  const today=(await c.query('SELECT CURRENT_DATE::text d')).rows[0].d;const before=(await c.query('SELECT to_jsonb(loads) row FROM loads WHERE id=$1',[LOAD])).rows[0].row;
  const args=statusArgs(uid(901),'completed',today);await call(statusSql,args);await call(statusSql,args);
  const after=(await c.query('SELECT to_jsonb(loads) row FROM loads WHERE id=$1',[LOAD])).rows[0].row;expect({...after,status:before.status,updated_by_user_id:before.updated_by_user_id}).toEqual(before);
  expect((await c.query('SELECT count(*)::int n FROM load_events')).rows[0].n).toBe(2);
  await expect(call(statusSql,args,STAFF)).rejects.toThrow(/idempotency_conflict/);await expect(call(statusSql,statusArgs(uid(901),'cancelled'))).rejects.toThrow(/idempotency_conflict/);await expect(call(statusSql,statusArgs(uid(901),'completed','2026-01-01'))).rejects.toThrow(/idempotency_conflict/);
  await c.query("UPDATE recruiter_members SET permissions='{}'");await expect(call(statusSql,args,STAFF)).rejects.toThrow(/not_authorized/);
 }));
 it('rejects missing/future/pre-pickup delivery, stale status and terminal transitions',()=>scenario(async(c,call)=>{
  for(const d of [null,'2099-01-01','2000-01-01'])await expect(call(statusSql,statusArgs(uid(901),'completed',d))).rejects.toThrow(/delivery_date/);
  await c.query("UPDATE loads SET status='en_route' WHERE id=$1",[LOAD]);await expect(call(statusSql,statusArgs(uid(901),'cancelled'))).rejects.toThrow(/stale_status/);await c.query("UPDATE loads SET status='completed' WHERE id=$1",[LOAD]);await expect(call(statusSql,statusArgs(uid(901),'cancelled'))).rejects.toThrow(/stale_status/);expect((await c.query('SELECT count(*)::int n FROM load_events')).rows[0].n).toBe(0);
 }));
 it('summaries cover all rows across pages and separate date-unconfirmed history',()=>scenario(async(c,call)=>{
  const today=(await c.query('SELECT CURRENT_DATE::text d')).rows[0].d;await call(statusSql,statusArgs(uid(901),'completed',today));
  await c.query(`INSERT INTO loads(user_id,carrier_driver_relationship_id,load_reference,status,load_date,pickup_location,dropoff_location,total_miles) SELECT $1,$2,'OLD-'||n,'completed',CURRENT_DATE,'A','B',10 FROM generate_series(1,31)n`,[DRIVER,REL]);
  await c.query("UPDATE recruiter_profiles SET dispatch_week_start_day='monday' WHERE id=$1",[R]);
  const r=(await call("SELECT dispatch_mini_read($1,$2,'history',NULL,0,25,CURRENT_DATE) result",[R,REL]))[0].result;expect(r.loads).toHaveLength(25);expect(r.total).toBe(32);expect(r.summaries[0]).toMatchObject({completed_count:32,unconfirmed_count:31,daily_count:1,daily_miles:210.45,weekly_count:1,unconfirmed_miles:310});expect(new Date(r.week_start+'T12:00:00Z').getUTCDay()).toBe(1);
 }));
 it('scope mismatched driver ownership is excluded from list and summaries',()=>scenario(async(c,call)=>{
  await c.query('UPDATE loads SET user_id=$1 WHERE id=$2',[OTHER_OWNER,LOAD]);const r=(await call('SELECT dispatch_mini_read($1) result',[R]))[0].result;expect(r.total).toBe(0);expect(r.summaries[0].active_count).toBe(0);await expect(call(statusSql,statusArgs(uid(901),'cancelled'))).rejects.toThrow(/not_found/);
 }));
});

const inviteDriver = 'SELECT company_driver_invite($1,$2) result';
const respondDriver = 'SELECT company_driver_respond($1,$2) result';
const readConnections = 'SELECT company_driver_connections($1) result';
const readDriverLoads = 'SELECT driver_loads_page($1,$2,$3,$4,$5) result';
const invitedEmail = 'driver-invite@example.test';
const invitedDriver = uid(31);

async function provisionInvitedDriver(c: pg.PoolClient, verified = true) {
 await c.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,CASE WHEN $3 THEN now() END)', [invitedDriver, invitedEmail, verified]);
 await c.query("INSERT INTO user_capabilities VALUES($1,'driver','active')", [invitedDriver]);
}

describe('Company driver connection and shared load lifecycle', () => {
 it('creates one pending request before signup and binds acceptance to the verified driver', () => scenario(async (c, call) => {
  const [{ result: invite }] = await call(inviteDriver, [R, ' Driver-Invite@Example.Test ']);
  const [{ result: retry }] = await call(inviteDriver, [R, invitedEmail]);
  expect(retry).toEqual(invite);
  expect(invite.status).toBe('pending');
  expect((await c.query('SELECT count(*)::int AS n FROM carrier_driver_relationships')).rows[0].n).toBe(2);
  await expect(call(respondDriver, [invite.id, true], DRIVER)).rejects.toThrow(/not_authorized/);

  await provisionInvitedDriver(c, false);
  expect((await call(readConnections, [null], invitedDriver))[0].result.invites).toEqual([]);
  await expect(call(respondDriver, [invite.id, true], invitedDriver)).rejects.toThrow(/not_authorized/);
  await c.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1', [invitedDriver]);
  const [{ result: inbox }] = await call(readConnections, [null], invitedDriver);
  expect(inbox.invites).toEqual([expect.objectContaining({ id: invite.id, company_name: 'Company', status: 'pending' })]);
  expect(inbox.relationships).toEqual([]);

  const [{ result: accepted }] = await call(respondDriver, [invite.id, true], invitedDriver);
  const [{ result: replayed }] = await call(respondDriver, [invite.id, true], invitedDriver);
  expect(accepted).toMatchObject({ status: 'accepted', replayed: false });
  expect(replayed).toMatchObject({ relationship_id: accepted.relationship_id, replayed: true });
  const row = (await c.query('SELECT recruiter_id,driver_user_id,status FROM carrier_driver_relationships WHERE id=$1', [accepted.relationship_id])).rows[0];
  expect(row).toEqual({ recruiter_id: R, driver_user_id: invitedDriver, status: 'active' });
  expect((await c.query('SELECT count(*)::int AS n FROM recruiter_members WHERE member_user_id=$1', [invitedDriver])).rows[0].n).toBe(0);
  await expect(call('SELECT dispatch_mini_read($1)', [R], invitedDriver)).rejects.toThrow(/not_authorized/);
 }));

 it('blocks table access, unauthenticated requests, load-only staff and cross-company owners', () => scenario(async (_, call) => {
  const [{ result: invite }] = await call(inviteDriver, [R, invitedEmail]);
  await expect(call('SELECT * FROM company_driver_invites')).rejects.toThrow(/permission denied/);
  await expect(call(inviteDriver, [R, invitedEmail], '', 'anon')).rejects.toThrow(/permission denied/);
  await expect(call(inviteDriver, [R, invitedEmail], STAFF)).rejects.toThrow(/not_authorized/);
  await expect(call(readConnections, [R], STAFF)).rejects.toThrow(/not_authorized/);
  await expect(call(readConnections, [R], OTHER_OWNER)).rejects.toThrow(/not_authorized/);
  await expect(call('SELECT company_driver_revoke($1,$2)', [OTHER, invite.id], OTHER_OWNER)).rejects.toThrow(/expired_or_handled/);
  expect((await call(readConnections, [R]))[0].result.invites[0].status).toBe('pending');
 }));

 it('rejects expired and revoked requests and gives a renewed request a new identity', () => scenario(async (c, call) => {
  await provisionInvitedDriver(c);
  const [{ result: first }] = await call(inviteDriver, [R, invitedEmail]);
  await c.query("UPDATE company_driver_invites SET expires_at=now()-interval '1 minute' WHERE id=$1", [first.id]);
  await expect(call(respondDriver, [first.id, true], invitedDriver)).rejects.toThrow(/expired_or_handled/);
  const [{ result: renewed }] = await call(inviteDriver, [R, invitedEmail]);
  expect(renewed.id).not.toBe(first.id);
  await expect(call(respondDriver, [first.id, true], invitedDriver)).rejects.toThrow(/not_authorized/);
  await call('SELECT company_driver_revoke($1,$2)', [R, renewed.id]);
  await expect(call(respondDriver, [renewed.id, true], invitedDriver)).rejects.toThrow(/expired_or_handled/);
  expect((await c.query('SELECT count(*)::int AS n FROM carrier_driver_relationships WHERE driver_user_id=$1', [invitedDriver])).rows[0].n).toBe(0);
 }));

 it('requires an active driver and current company eligibility, and respects decline and disconnect', () => scenario(async (c, call) => {
  await provisionInvitedDriver(c);
  const [{ result: first }] = await call(inviteDriver, [R, invitedEmail]);
  await c.query("UPDATE user_capabilities SET status='revoked' WHERE user_id=$1", [invitedDriver]);
  await expect(call(respondDriver, [first.id, true], invitedDriver)).rejects.toThrow(/not_authorized/);
  await c.query("UPDATE user_capabilities SET status='active' WHERE user_id=$1", [invitedDriver]);
  await c.query("UPDATE recruiter_billing_profiles SET status='past_due' WHERE recruiter_id=$1", [R]);
  await expect(call(respondDriver, [first.id, true], invitedDriver)).rejects.toThrow(/company_unavailable/);
  expect((await call(respondDriver, [first.id, false], invitedDriver))[0].result.status).toBe('declined');
  await expect(call(respondDriver, [first.id, true], invitedDriver)).rejects.toThrow(/expired_or_handled/);
  await c.query("UPDATE recruiter_billing_profiles SET status='active' WHERE recruiter_id=$1", [R]);
  const [{ result: second }] = await call(inviteDriver, [R, invitedEmail]);
  const [{ result: accepted }] = await call(respondDriver, [second.id, true], invitedDriver);
  await call('SELECT settlement_end_carrier_relationship($1)', [accepted.relationship_id], invitedDriver);
  await call(respondDriver, [second.id, true], invitedDriver);
  expect((await call(readConnections, [null], invitedDriver))[0].result.relationships[0].status).toBe('ended');
  const [{ result: third }] = await call(inviteDriver, [R, invitedEmail]);
  expect(third.id).not.toBe(second.id);
  expect(third.status).toBe('pending');
  expect((await call(readConnections, [null], invitedDriver))[0].result.relationships[0].status).toBe('ended');
 }));

 it('projects the same assigned row into driver reports and exports, with delivery and cancellation parity', () => scenario(async (c, call) => {
  await provisionInvitedDriver(c);
  const [{ result: invite }] = await call(inviteDriver, [R, invitedEmail]);
  const [{ result: connection }] = await call(respondDriver, [invite.id, true], invitedDriver);
  const relationship = connection.relationship_id;
  const payload = dispatchPayload({
    ...emptyDispatchForm(), relationship_id: relationship, load_reference: 'COMPANYQA1',
    pickup_location: 'Dallas, TX', dropoff_location: 'Austin, TX',
    load_date: '2026-01-30', dropoff_date: '2026-01-31', loaded_miles: '14.5', rate_per_mile: '2.01',
  });
  const create = 'SELECT dispatch_mini_create($1,$2,$3,$4) result';
  const [{ result: assigned }] = await call(create, [R, relationship, uid(981), payload], STAFF);
  const [{ result: cancelled }] = await call(create, [R, relationship, uid(982), { ...payload, load_reference: 'COMPANYQA2', dropoff_date: '2026-02-01' }], STAFF);
  const query = [invitedDriver, null, null, 0, 100];
  const [{ result: pending }] = await call(readDriverLoads, query, invitedDriver);
  expect(pending.loads).toEqual(expect.arrayContaining([expect.objectContaining({
    id: assigned.id, user_id: invitedDriver, status: 'pending', estimated_pay: 29.15, dispatch_company_name: 'Company',
  })]));
  const report = (loads: typeof pending.loads, from: string, to: string) => aggregateReport({
    loads, expenses: [], fuelLogs: [], settings: null, range: { from, to, key: 'custom', label: 'Dispatch fixture' }, preparedFor: 'Company fixture',
  });
  expect(report(pending.loads, '2026-01-01', '2026-02-28').summary.grossRevenue).toBe(0);
  await call(statusSql, [R, relationship, assigned.id, 'pending', 'completed', '2026-02-01', uid(983)], STAFF);
  await call("SELECT dispatch_update_driver_load_status($1,$2,$3,$4,'cancelled',$5,'telegram')", [R, relationship, invitedDriver, cancelled.id, 'company-dispatch-test-cancel'], STAFF);

  const [{ result: february }] = await call(readDriverLoads, [invitedDriver, '2026-02-01', '2026-02-01', 0, 100], invitedDriver);
  expect(february.totalCount).toBe(2);
  expect(february.loads.find((row: { id: string }) => row.id === assigned.id)).toMatchObject({ status: 'completed', dropoff_date: '2026-01-31', actual_delivery_date: '2026-02-01', estimated_pay: 29.15 });
  const delivered = report(february.loads, '2026-02-01', '2026-02-01');
  expect(delivered.summary).toMatchObject({ grossRevenue: 29.15, totalMiles: 14.5 });
  expect(delivered.cancelledLoads).toHaveLength(1);
  expect(buildReportCSV('load_summary', delivered)).toContain('Total Gross Pay,$29.15');
  expect((await call(readDriverLoads, [invitedDriver, '2026-01-01', '2026-01-31', 0, 100], invitedDriver))[0].result.loads).toEqual([]);
  await c.query('UPDATE loads SET actual_pay_received=27.50 WHERE id=$1', [assigned.id]);
  const [{ result: paid }] = await call(readDriverLoads, query, invitedDriver);
  expect(report(paid.loads, '2026-02-01', '2026-02-01').summary.grossRevenue).toBe(27.5);
  const taxSettings = {
    tax_estimator_enabled: true, tax_base_type: 'net', federal_tax_percent: 10,
    state_tax_percent: 0, include_se_tax: false, se_tax_percent: 0, buffer_percent: 0,
  } as Parameters<typeof aggregateReport>[0]['settings'];
  const expense = { id: 'fixture-expense', user_id: invitedDriver, amount: 2.5, category: 'Maintenance', expense_date: '2026-02-01' } as Parameters<typeof aggregateReport>[0]['expenses'][number];
  const paidReport = aggregateReport({
    loads: paid.loads, expenses: [expense], fuelLogs: [], settings: taxSettings,
    range: { from: '2026-02-01', to: '2026-02-01', key: 'custom', label: 'February delivery' }, preparedFor: 'Company fixture',
  });
  expect(paidReport.tax).toMatchObject({ grossRevenue: 27.5, netProfit: 25, totalTax: 2.5 });
  await expect(call(readDriverLoads, query, STAFF)).rejects.toThrow(/not_authorized/);
  await expect(call(readDriverLoads, query, OWNER)).rejects.toThrow(/not_authorized/);
  await expect(call(readDriverLoads, query, DRIVER)).rejects.toThrow(/not_authorized/);
  const [{ result: page }] = await call(readDriverLoads, [invitedDriver, '2026-02-01', '2026-02-01', 1, 1], invitedDriver);
  expect(page.totalCount).toBe(2);
  expect(page.loads).toHaveLength(1);
 }));
});

// These probes require separate native PostgreSQL sessions. Never count the
// single-session WASM transport as concurrency evidence.
describe.skipIf(process.env.HTP_TEST_PGLITE==='1')('Dispatcher concurrent native transactions',()=>{
 async function concurrentCall(sql:string,args:unknown[],actor=OWNER){
  const c=await pool.connect();
  try{await c.query('BEGIN');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[actor]);await c.query('SET LOCAL ROLE authenticated');const rows=(await c.query(sql,args)).rows;await c.query('COMMIT');return rows;}
  catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 it.each(['exact-create','conflicting-create','new-key-same-reference','exact-status','competing-status'])('%s commits exactly one mutation',async kind=>{
  const c=await pool.connect();
  try{
   await c.query('BEGIN');await seedFixture(c);await c.query('COMMIT');
   const date=(await c.query('SELECT CURRENT_DATE::text d')).rows[0].d;
   const p=dispatchPayload({...emptyDispatchForm(),relationship_id:REL,load_reference:'RACE123',pickup_location:'A',dropoff_location:'B',load_date:date,loaded_miles:'14.5',rate_per_mile:'2.01'});
   const create='SELECT dispatch_mini_create($1,$2,$3,$4) result';
   const args=[R,REL,uid(951),p];
   const requests=kind==='exact-create'?[()=>concurrentCall(create,args),()=>concurrentCall(create,args)]
    :kind==='conflicting-create'?[()=>concurrentCall(create,args),()=>concurrentCall(create,[R,REL,uid(951),{...p,notes:'different intent'}])]
    :kind==='new-key-same-reference'?[()=>concurrentCall(create,args),()=>concurrentCall(create,[R,REL,uid(952),p])]
    :kind==='exact-status'?[()=>concurrentCall(statusSql,statusArgs(uid(953),'completed',date)),()=>concurrentCall(statusSql,statusArgs(uid(953),'completed',date))]
    :[()=>concurrentCall(statusSql,statusArgs(uid(954),'completed',date)),()=>concurrentCall(statusSql,statusArgs(uid(955),'cancelled'))];
   const results=await Promise.allSettled(requests.map(run=>run()));
   const exact=kind==='exact-create'||kind==='exact-status';
   expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(exact?2:1);
   if(!exact){const rejected=results.find(result=>result.status==='rejected') as PromiseRejectedResult;expect(String(rejected.reason)).toMatch(/idempotency_conflict|reference_in_use|stale_status/);}
   expect((await c.query('SELECT count(*)::int n FROM dispatch_command_receipts')).rows[0].n).toBe(1);
   expect((await c.query('SELECT count(*)::int n FROM load_events')).rows[0].n).toBe(2);
   expect((await c.query('SELECT count(*)::int n FROM loads')).rows[0].n).toBe(kind.includes('create')||kind==='new-key-same-reference'?2:1);
   if(exact){const values=results.map(result=>(result as PromiseFulfilledResult<any[]>).value[0].result);expect(values[0].id).toBe(values[1].id);expect(values.map(value=>value.replayed).sort()).toEqual([false,true]);}
  }finally{await c.query('ROLLBACK');await c.query('TRUNCATE auth.users CASCADE');c.release();}
  expect((await pool.query('SELECT count(*)::int n FROM loads')).rows[0].n).toBe(0);
 });

 it('serializes simultaneous requests and accepts a connection once across two driver sessions', async () => {
  const c = await pool.connect();
  try {
   await c.query('BEGIN');
   await seedFixture(c);
   await provisionInvitedDriver(c);
   await c.query('COMMIT');
   const [first, second] = await Promise.all([
    concurrentCall(inviteDriver, [R, invitedEmail]),
    concurrentCall(inviteDriver, [R, invitedEmail.toUpperCase()]),
   ]);
   expect(first[0].result).toEqual(second[0].result);
   const inviteId = first[0].result.id;
   const responses = await Promise.all([
    concurrentCall(respondDriver, [inviteId, true], invitedDriver),
    concurrentCall(respondDriver, [inviteId, true], invitedDriver),
   ]);
   expect(responses.map(rows => rows[0].result.replayed).sort()).toEqual([false, true]);
   expect(responses[0][0].result.relationship_id).toBe(responses[1][0].result.relationship_id);
   expect((await c.query('SELECT count(*)::int AS n FROM carrier_driver_relationships WHERE recruiter_id=$1 AND driver_user_id=$2', [R, invitedDriver])).rows[0].n).toBe(1);
  } finally {
   await c.query('ROLLBACK');
   await c.query('TRUNCATE auth.users CASCADE');
   c.release();
  }
 });
});
