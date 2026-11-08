// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { SOURCES, exactFunction, uid } from './fixtures/phase3AssistantBootstrap';
import { dispatchPayload, emptyDispatchForm } from '@/lib/dispatchWorkspace';
const candidate='supabase/migration-candidates/20261108140123_dispatcher_mini_app.sql';
const read=(p:string)=>readFileSync(p,'utf8');const mig=(p:string)=>read('supabase/migrations/'+p);
let dir='',pool:pg.Pool;
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG')&&k!=='DATABASE_URL'));
const run=(bin:string,args:string[])=>{const exe=process.env.HTP_TEST_POSTGRES_BINDIR?join(process.env.HTP_TEST_POSTGRES_BINDIR,bin):bin;return process.getuid?.()===0?execFileSync('setpriv',['--reuid=1000','--regid=1000','--clear-groups',exe,...args],{env,stdio:'pipe'}):execFileSync(exe,args,{env,stdio:'pipe'});};
const R=uid(101),OTHER=uid(102),OWNER=uid(1),DRIVER=uid(2),STAFF=uid(3),OTHER_OWNER=uid(4),REL=uid(201),OTHER_REL=uid(202),LOAD=uid(301);
beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'dispatch-mini-pg-'));if(process.getuid?.()===0)execFileSync('chown',['1000:1000',dir]);
 const version=run('postgres',['--version']).toString();expect([16,17]).toContain(Number(version.match(/(\d+)\./)?.[1]));
 run('initdb',['-D',join(dir,'data'),'-U','local_owner','-A','trust','--no-locale']);run('pg_ctl',['-D',join(dir,'data'),'-l',join(dir,'postgres.log'),'-o',`-k ${dir} -h '' -p 55441`,'-w','start']);
 pool=new pg.Pool({host:dir,port:55441,user:'local_owner',database:'postgres',password:'',ssl:false,options:'',max:6,statement_timeout:10000});
 await pool.query(read('src/test/fixtures/phase3AssistantCanonical.sql'));
 for(const[path,names]of SOURCES)for(const name of names)await pool.query(exactFunction(mig(path),name));
 const rel=mig('20260808161500_phase1t_b1_settlement_schema.sql');await pool.query(rel.slice(rel.indexOf('CREATE TABLE public.carrier_driver_relationships'),rel.indexOf('-- ---------------------------------------------------------------------------\n-- 2)')));
 await pool.query(read('src/test/fixtures/dispatchWorkspace.sql'));
 const canonical=mig('20260819162100_2a7bb78e-ad6a-4417-a7d1-28ef6ba433aa.sql');await pool.query(canonical.slice(canonical.indexOf('CREATE TABLE IF NOT EXISTS public.load_events'),canonical.indexOf('-- G. Dispatch authorization helper')));
 for(const n of ['current_user_can_dispatch_load_action','dispatch_create_driver_load','dispatch_update_driver_load_status'])await pool.query(exactFunction(canonical,n));
 await pool.query(read(candidate));
},60000);
afterAll(async()=>{if(pool)await pool.end();if(dir){try{run('pg_ctl',['-D',join(dir,'data'),'-m','immediate','-w','stop']);}finally{rmSync(dir,{recursive:true,force:true});}}});
async function scenario(fn:(c:pg.PoolClient,call:(sql:string,args?:unknown[],actor?:string,role?:string)=>Promise<any[]>)=>Promise<void>){
 const c=await pool.connect();await c.query('BEGIN');
 try{
  await c.query(`INSERT INTO auth.users VALUES($1),($2),($3),($4);`,[OWNER,DRIVER,STAFF,OTHER_OWNER]);
  await c.query(`INSERT INTO recruiter_profiles(id,user_id,recruiter_name,company_name,status,company_type,posting_terms_accepted_at) VALUES($1,$2,'QA','Company','active','carrier',now()),($3,$4,'Other','Other','active','carrier',now());`,[R,OWNER,OTHER,OTHER_OWNER]);
  await c.query(`INSERT INTO recruiter_billing_profiles(recruiter_id,user_id,plan,status) VALUES($1,$2,'fleet','active');`,[R,OWNER]);
  await c.query(`INSERT INTO recruiter_members(recruiter_id,member_user_id,status,permissions) VALUES($1,$2,'active','{"loads_view":true,"loads_dispatch":true,"loads_update_status":true}');`,[R,STAFF]);
  await c.query(`INSERT INTO carrier_driver_relationships(id,recruiter_id,driver_user_id,status,created_by_user_id) VALUES($1,$2,$3,'active',$4),($5,$6,$3,'active',$7);`,[REL,R,DRIVER,OWNER,OTHER_REL,OTHER,OTHER_OWNER]);
  await c.query(`INSERT INTO profiles(user_id,display_name) VALUES($1,'Connected QA Driver')`,[DRIVER]);
  await c.query(`INSERT INTO loads(id,user_id,carrier_driver_relationship_id,load_reference,status,load_date,pickup_location,dropoff_location,loaded_miles,deadhead_miles,total_miles,estimated_pay) VALUES($2,$1,$3,'QA1234','pending',CURRENT_DATE-4,'A','B',200.45,10,210.45,400);`,[DRIVER,LOAD,REL]);
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
 it('rejects contradictory mileage without inserting or consuming receipt',()=>scenario(async(c,call)=>{
  const p=dispatchPayload({...emptyDispatchForm(),relationship_id:REL,load_reference:'CREATE123',pickup_location:'A',dropoff_location:'B',loaded_miles:'200',total_miles:'1',pay_model:'manual',manual_amount:'400'});await expect(call('SELECT dispatch_mini_create($1,$2,$3,$4)',[R,REL,uid(902),p])).rejects.toThrow(/mileage_conflict/);expect((await c.query('SELECT count(*)::int n FROM dispatch_command_receipts')).rows[0].n).toBe(0);
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