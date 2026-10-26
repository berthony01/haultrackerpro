// @vitest-environment node
// Actual candidate SQL, actual SET ROLE and RLS. No permission/entitlement mocks.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const ROOT = process.cwd();
const CANDIDATE = 'supabase/migration-candidates/20261026165204_phase3_assistant_history_foundation.sql';
const MIG = 'supabase/migrations/';
// Latest accepted definitions for each dependency. Exact body extraction, no edits.
const SOURCES: [string, string[]][] = [
 ['20260228060534_e148b76a-288a-4273-a42b-f9d95f9bfb0e.sql', ['is_admin','is_super_admin']],
 ['20260630002954_a8c350ea-94e2-4f9b-8107-58a921dbe35b.sql', ['_agency_plan_defaults']],
 ['20260726013000_phase1p_recruiter_company_type_readiness.sql', ['recruiter_profile_can_manage_opportunities']],
 ['20260815020500_phase_rc1a_recruiter_workspace_membership_foundation.sql', ['is_recruiter_workspace_owner']],
 ['20260821003749_bfa5a325-8fcb-4a8b-b4e5-e6109e459fcb.sql', ['_owner_qa_persona_for','effective_recruiter_tier']],
 ['20260821062449_7c014ba4-370b-4eb8-afe0-f71de5785e43.sql', ['is_qa_fixture_root']],
 ['20260821062812_14e13b55-7f8b-4dac-8b3b-a9a5b68f761b.sql', ['driver_has_active_pro','get_effective_agency_limits','_agency_member_paid_operational_authority']],
 ['20260816140000_phase_rc1j_b_recruiter_team_seat_entitlement.sql', ['recruiter_team_seat_limit','recruiter_team_occupied_seats','recruiter_team_workspace_within_limit','current_user_has_recruiter_permission']],
 ['20260816220000_phase_am1a_agency_member_identity_seat_delegation_lifecycle_hardening.sql', ['agency_team_occupied_seats','agency_team_workspace_within_limit','_agency_delegation_operationally_active','assistant_has_permission']],
 ['20260817033000_phase_am1b_agency_workspace_permission_contract.sql', ['current_user_has_agency_permission']],
];
function exactFunction(sql: string, name: string): string {
 const start = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\(`,'i').exec(sql);
 if (!start) throw new Error(`Missing accepted definition: ${name}`);
 const tail = sql.slice(start.index);
 const tag = /\bAS\s+(\$[a-zA-Z_0-9]*\$)/i.exec(tail);
 if (!tag || tag.index === undefined) throw new Error(`Missing body: ${name}`);
 const end = tail.indexOf(tag[1], tag.index + tag[0].length);
 if (end < 0) throw new Error(`Unterminated body: ${name}`);
 const semicolon = tail.indexOf(';', end + tag[1].length);
 return tail.slice(0,semicolon+1);
}
let db: PGlite;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=uid(1), B=uid(2), STAFF=uid(3), AGENCY_STAFF=uid(4), FREE=uid(5), OTHER=uid(6), ADMIN=uid(7);
const RECRUITER=uid(101), OTHER_RECRUITER=uid(102), AGENCY=uid(201), OTHER_AGENCY=uid(202), DELEGATION=uid(301);
const read = (path: string) => readFileSync(resolve(ROOT,path),'utf8');
async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) { return (await db.query<T>(sql,params)).rows; }
async function as<T = Record<string, unknown>>(actor: string | null, sql: string, params: unknown[] = [], role: 'authenticated'|'anon'|'service_role'='authenticated') {
 await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[actor ?? '']);
 await db.exec(`SET ROLE ${role}`);
 try {
  const actual = await q<{current_user: string}>('SELECT current_user');
  expect(actual[0]?.current_user).toBe(role);
  return await q<T>(sql,params);
 } finally { await db.exec('RESET ROLE'); }
}
async function create(actor=A, scope='driver_self', target=actor, permissions=['manage_loads']) {
 const rows=await as<{thread_id:string;expires_at:Date}>(actor,'SELECT * FROM public.assistant_create_thread($1,$2,$3::text[])',[scope,target,permissions]);
 const row=rows[0]; if (!row) throw new Error('No authorized thread returned'); return row;
}
async function add(actor:string,thread:string,request=uid(901),body='Local synthetic message') {
 const rows=await as<{id:string}>(actor,'SELECT public.assistant_add_user_message($1,$2,$3) AS id',[thread,request,body]); return rows[0]?.id;
}
async function denied(actor:string|null,scope:string,target:string,permissions:string[]=['manage_loads'],role:'authenticated'|'anon'='authenticated') {
 const before=await q<{n:number}>('SELECT count(*)::integer n FROM public.assistant_threads');
 await expect(as(actor,'SELECT * FROM public.assistant_create_thread($1,$2,$3::text[])',[scope,target,permissions],role)).rejects.toMatchObject({code:'42501'});
 expect(await q('SELECT count(*)::integer n FROM public.assistant_threads')).toEqual(before);
}
async function visible(actor:string,thread:string) {
 return await as(actor,'SELECT id FROM public.assistant_threads WHERE id=$1',[thread]);
}
async function expired(thread:string, when="statement_timestamp()") {
 // Only local bootstrap owner can simulate elapsed time. Production trigger stays
 // active for all role behavior tests; this is temporal fixture setup, not a gate.
 await db.exec('ALTER TABLE public.assistant_threads DISABLE TRIGGER assistant_thread_guard');
 try { await db.query(`UPDATE public.assistant_threads SET created_at=(${when})-interval '720 hours', expires_at=(${when}) WHERE id=$1`,[thread]); }
 finally { await db.exec('ALTER TABLE public.assistant_threads ENABLE TRIGGER assistant_thread_guard'); }
}

beforeAll(async()=>{
 db=new PGlite(); await db.exec(read('src/test/fixtures/phase3AssistantCanonical.sql'));
 for (const [path,names] of SOURCES) {
  const sql=read(MIG+path);
  for (const name of names) await db.exec(exactFunction(sql,name));
 }
 // Match canonical internal EXECUTE boundaries. Do not give authenticated the
 // internal driver/tier/seat/QA helpers merely to make the fixture pass.
 const funcs=await q<{signature:string}>(`SELECT p.oid::regprocedure::text signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`);
 for (const f of funcs) await db.exec(`REVOKE ALL ON FUNCTION ${f.signature} FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION ${f.signature} TO service_role`);
 await db.exec(`GRANT EXECUTE ON FUNCTION public.assistant_has_permission(uuid,uuid,text),public.current_user_has_recruiter_permission(uuid,public.recruiter_workspace_permission),public.current_user_has_agency_permission(uuid,public.agency_workspace_permission),public.is_admin(uuid),public.is_super_admin(uuid),public.is_recruiter_workspace_owner(uuid),public._agency_plan_defaults(text) TO authenticated`);
 let sql=read(CANDIDATE);
 // Negative control modifies only the in-memory candidate input. Final files
 // remain identical. Shared recruiter authority then must NOT expose A to staff.
 if(process.env.PHASE3_NEGATIVE_CONTROL==='actor') sql=sql.replace('actor_user_id=auth.uid() AND expires_at>statement_timestamp()','expires_at>statement_timestamp()');
 if(process.env.PHASE3_NEGATIVE_CONTROL==='scope') sql=sql.replace('AND public.assistant_scope_authorized(scope_kind,scope_target_id,required_permissions)','');
 await db.exec(sql);
},30000);
beforeEach(async()=>{
 // Every test gets isolated synthetic state, while errors execute under real
 // roles. SQL errors abort only their statements (not the test transaction).
 await db.exec(`TRUNCATE public.profiles,auth.users,public.subscriptions,public.admin_users,public.recruiter_profiles,public.agency_profiles,public.driver_assistants,public.user_capabilities,public.owner_qa_sessions,public.qa_fixture_roots CASCADE`);
 for (let n=1;n<=10;n++) {
  await db.query('INSERT INTO auth.users(id) VALUES($1)',[uid(n)]);
  await db.query('INSERT INTO public.profiles(user_id) VALUES($1)',[uid(n)]);
 }
 await db.exec(`
 INSERT INTO public.user_capabilities(user_id,capability,status) VALUES('${A}','driver','active'),('${A}','recruiter','active'),('${B}','driver','active'),('${B}','recruiter','active'),('${FREE}','driver','active'),('${ADMIN}','driver','active');
 INSERT INTO public.subscriptions VALUES('${A}','pro_monthly','active'),('${B}','pro_yearly','active');
 INSERT INTO public.recruiter_profiles(id,user_id,recruiter_name,company_name,recruiter_email,company_type,posting_terms_accepted_at) VALUES('${RECRUITER}','${A}','Synthetic Owner','Local Company','local@example.invalid','independent_recruiter',now()),('${OTHER_RECRUITER}','${B}','Other Owner','Other Company','other@example.invalid','carrier',now());
 UPDATE public.recruiter_profiles SET dot_number='local-fixture' WHERE id='${OTHER_RECRUITER}';
 INSERT INTO public.recruiter_billing_profiles VALUES('${RECRUITER}','${A}','starter','active'),('${OTHER_RECRUITER}','${B}','growth','trialing');
 INSERT INTO public.recruiter_members(recruiter_id,member_user_id,role,status,permissions) VALUES('${RECRUITER}','${A}','recruiter_owner','active','{}'),('${RECRUITER}','${STAFF}','recruiter_staff','active','{"opportunities_view":true}');
 INSERT INTO public.agency_profiles(id,owner_user_id) VALUES('${AGENCY}','${B}'),('${OTHER_AGENCY}','${OTHER}');
 INSERT INTO public.agency_entitlements(agency_id,plan_key,status,source) VALUES('${AGENCY}','agency_starter','active','stripe'),('${OTHER_AGENCY}','agency_team','trialing','manual');
 INSERT INTO public.agency_members(agency_id,member_user_id,role,status,workspace_permissions) VALUES('${AGENCY}','${B}','agency_owner','active','{}'),('${AGENCY}','${AGENCY_STAFF}','agency_member','active','{"packages_view":true}'),('${OTHER_AGENCY}','${OTHER}','agency_owner','active','{}');
 INSERT INTO public.agency_delegation_requests(id,agency_id,driver_user_id,member_user_id,status,requested_permissions) VALUES('${DELEGATION}','${AGENCY}','${FREE}','${AGENCY_STAFF}','approved','{"manage_loads":true,"view_reports":true}');
 INSERT INTO public.driver_assistants(driver_user_id,assistant_user_id,status,permissions,agency_delegation_id) VALUES('${FREE}','${AGENCY_STAFF}','active','{"manage_loads":true,"view_reports":true}','${DELEGATION}'),('${A}','${STAFF}','active','{"manage_loads":true}',NULL);
 `);
});
afterEach(async()=>{await db.exec('RESET ROLE');});
afterAll(async()=>{await db?.close();});

describe('Phase3 source candidate: actual roles, canonical authorization and private history',()=>{
 it.each(['pro_monthly','pro_yearly'])('paid driver self / owner-operator %s',async(plan)=>{
  await db.query('UPDATE public.subscriptions SET plan_key=$1 WHERE user_id=$2',[plan,A]);
  const t=await create(); expect(await visible(A,t.thread_id)).toHaveLength(1);
 });
 it.each(['free','unknown','starter'])('active status with invalid driver plan %s denied',async(plan)=>{
  await db.query('UPDATE public.subscriptions SET plan_key=$1 WHERE user_id=$2',[plan,A]); await denied(A,'driver_self',A);
 });
 it('missing driver subscription denied',async()=>{await db.exec(`DELETE FROM public.subscriptions WHERE user_id='${A}'`); await denied(A,'driver_self',A);});
 it.each(['trialing','past_due','cancelled'])('driver canonical nonactive status %s denied',async(status)=>{
  await db.query('UPDATE public.subscriptions SET status=$1 WHERE user_id=$2',[status,A]); await denied(A,'driver_self',A);
 });
 it('free driver denied',async()=>{await denied(FREE,'driver_self',FREE);});
 it('null JWT subject denied',async()=>{await denied(null,'driver_self',A);});
 it('anon cannot invoke create or read tables',async()=>{
  await denied(null,'driver_self',A,['manage_loads'],'anon');
  await expect(as(null,'SELECT * FROM public.assistant_threads',[],'anon')).rejects.toMatchObject({code:'42501'});
  await expect(as(null,'SELECT * FROM public.assistant_messages',[],'anon')).rejects.toMatchObject({code:'42501'});
 });
 it('foreign driver self target denied',async()=>{await denied(A,'driver_self',B);});
 it('missing canonical profile fails closed without provisioning',async()=>{
  await db.exec(`DELETE FROM public.profiles WHERE user_id='${A}'`); await denied(A,'driver_self',A);
  expect(await q('SELECT id FROM public.profiles WHERE user_id=$1',[A])).toHaveLength(0);
 });
 it('actor and isPro are not API arguments',async()=>{
  await expect(as(A,'SELECT * FROM public.assistant_create_thread($1,$2,$3::text[],$4,$5)',['driver_self',A,['manage_loads'],B,true])).rejects.toMatchObject({code:'42883'});
 });
 it.each(['setup','suspended','revoked'])('driver capability %s denied',async(status)=>{
  await db.query(`UPDATE public.user_capabilities SET status=$1 WHERE user_id=$2 AND capability='driver'`,[status,A]); await denied(A,'driver_self',A);
 });
 it.each([[],['manage_loads','manage_loads'],['manage_fuel'],['opportunities_view'],['manage_loads',null]].map(permissions=>({permissions})))('invalid required permissions $permissions denied without row',async({permissions})=>{
  const before=await q('SELECT id FROM public.assistant_threads');
  await expect(as(A,'SELECT * FROM public.assistant_create_thread($1,$2,$3::text[])',['driver_self',A,permissions])).rejects.toMatchObject({code:'42501'});
  expect(await q('SELECT id FROM public.assistant_threads')).toEqual(before);
 });
 it('unknown scope and null target denied',async()=>{
  await denied(A,'general_ai',A); await expect(as(A,'SELECT * FROM public.assistant_create_thread($1,NULL,$2::text[])',['driver_self',['manage_loads']])).rejects.toMatchObject({code:'42501'});
 });
 it('direct delegate exact grant permits paid target',async()=>{const t=await create(STAFF,'driver_delegate',A); expect(await visible(STAFF,t.thread_id)).toHaveLength(1);});
 it('direct delegate missing second permission denied',async()=>{await denied(STAFF,'driver_delegate',A,['manage_loads','view_reports']);});
 it('direct delegate target Pro lost hides history and prevents append',async()=>{
  const t=await create(STAFF,'driver_delegate',A); await add(STAFF,t.thread_id);
  await db.exec(`DELETE FROM public.subscriptions WHERE user_id='${A}'`);
  expect(await visible(STAFF,t.thread_id)).toHaveLength(0);
  expect(await as(STAFF,'SELECT * FROM public.assistant_messages WHERE thread_id=$1',[t.thread_id])).toHaveLength(0);
  await expect(add(STAFF,t.thread_id,uid(902))).rejects.toMatchObject({code:'42501'});
  expect(await q('SELECT id FROM public.assistant_messages')).toHaveLength(1);
 });
 it('assistant own Pro alone never grants a free target',async()=>{
  await db.exec(`INSERT INTO public.subscriptions VALUES('${STAFF}','pro_monthly','active'); UPDATE public.driver_assistants SET driver_user_id='${FREE}' WHERE assistant_user_id='${STAFF}'`); await denied(STAFF,'driver_delegate',FREE);
 });
 it.each(['pending','revoked','expired'])('direct relationship %s denied',async(status)=>{
  await db.query('UPDATE public.driver_assistants SET status=$1 WHERE assistant_user_id=$2',[status,STAFF]); await denied(STAFF,'driver_delegate',A);
 });
 it('delegate cannot use self as delegated target',async()=>{await denied(A,'driver_delegate',A);});
 it('agency paid delegate permits free driver with exact approval',async()=>{
  const t=await create(AGENCY_STAFF,'driver_delegate',FREE,['manage_loads','view_reports']); expect(await visible(AGENCY_STAFF,t.thread_id)).toHaveLength(1);
 });
 it('agency membership alone does not grant driver access',async()=>{await db.exec('DELETE FROM public.driver_assistants'); await denied(AGENCY_STAFF,'driver_delegate',FREE);});
 it.each(['pending_driver_approval','revoked','declined','expired'])('agency delegation %s denied',async(status)=>{
  await db.query('UPDATE public.agency_delegation_requests SET status=$1 WHERE id=$2',[status,DELEGATION]); await denied(AGENCY_STAFF,'driver_delegate',FREE);
 });
 it('agency delegation wrong driver denied',async()=>{await db.exec(`UPDATE public.agency_delegation_requests SET driver_user_id='${A}'`); await denied(AGENCY_STAFF,'driver_delegate',FREE);});
 it('agency delegation wrong agency denied',async()=>{await db.exec(`UPDATE public.agency_delegation_requests SET agency_id='${OTHER_AGENCY}'`); await denied(AGENCY_STAFF,'driver_delegate',FREE);});
 it('agency delegation wrong member denied',async()=>{await db.exec(`UPDATE public.agency_delegation_requests SET member_user_id='${STAFF}'`); await denied(AGENCY_STAFF,'driver_delegate',FREE);});
 it.each(['{"manage_loads":"true"}','{"manage_loads":false}','{}','{"manage_loads":"malformed"}'])('malformed or absent relationship permission %s denied',async(payload)=>{
  await db.query('UPDATE public.driver_assistants SET permissions=$1::jsonb WHERE assistant_user_id=$2',[payload,AGENCY_STAFF]); await denied(AGENCY_STAFF,'driver_delegate',FREE);
 });
 it('agency approval must carry every domain',async()=>{await db.exec(`UPDATE public.agency_delegation_requests SET requested_permissions='{"manage_loads":true}'`); await denied(AGENCY_STAFF,'driver_delegate',FREE,['manage_loads','view_reports']);});
 it.each(['cancelled','past_due','manual_beta'])('agency %s denied for workspace and delegated AI',async(status)=>{
  await db.query('UPDATE public.agency_entitlements SET status=$1 WHERE agency_id=$2',[status,AGENCY]);
  await denied(AGENCY_STAFF,'driver_delegate',FREE); await denied(B,'agency',AGENCY,['packages_view']);
 });
 it.each(['agency_starter','agency_team','agency_growth'])('known paid agency plan %s permits approved domains',async(plan)=>{
  await db.query('UPDATE public.agency_entitlements SET plan_key=$1 WHERE agency_id=$2',[plan,AGENCY]); await create(B,'agency',AGENCY,['packages_view']);
 });
 it.each(['stripe','manual','admin_seed'])('recognized active agency source %s accepted',async(source)=>{
  await db.query('UPDATE public.agency_entitlements SET source=$1 WHERE agency_id=$2',[source,AGENCY]); await create(AGENCY_STAFF,'driver_delegate',FREE);
 });
 it('trialing agency accepted',async()=>{await db.exec(`UPDATE public.agency_entitlements SET status='trialing' WHERE agency_id='${AGENCY}'`); await create(B,'agency',AGENCY,['packages_view']);});
 it.each(['plan_key','source'])('unknown agency %s fails schema and authorizer defense',async(column)=>{
  await expect(db.exec(`UPDATE public.agency_entitlements SET ${column}='unknown' WHERE agency_id='${AGENCY}'`)).rejects.toMatchObject({code:'23514'});
  // Explicit corrupted-catalog negative-input defense AFTER proving real CHECK.
  // Not a simplified live fixture: remove only the named constraint locally.
  await db.exec(`ALTER TABLE public.agency_entitlements DROP CONSTRAINT agency_entitlements_${column==='plan_key'?'plan_key':'source'}_check; UPDATE public.agency_entitlements SET ${column}='unknown' WHERE agency_id='${AGENCY}'`);
  try {await denied(B,'agency',AGENCY,['packages_view']); await denied(AGENCY_STAFF,'driver_delegate',FREE);}
  finally {await db.exec(`UPDATE public.agency_entitlements SET ${column}='${column==='plan_key'?'agency_starter':'stripe'}' WHERE agency_id='${AGENCY}'; ALTER TABLE public.agency_entitlements ADD CONSTRAINT agency_entitlements_${column==='plan_key'?'plan_key':'source'}_check CHECK(${column} IN (${column==='plan_key'?"'agency_starter','agency_team','agency_growth'":"'manual','stripe','admin_seed'"}))`);}
 });
 it('missing agency entitlement denied',async()=>{await db.exec(`DELETE FROM public.agency_entitlements WHERE agency_id='${AGENCY}'`); await denied(B,'agency',AGENCY,['packages_view']);});
 it.each(['starter','growth','fleet'])('paid recruiter owner %s permitted',async(plan)=>{
  await db.query('UPDATE public.recruiter_billing_profiles SET plan=$1 WHERE recruiter_id=$2',[plan,RECRUITER]); await create(A,'recruiter',RECRUITER,['opportunities_view','applications_view','conversations_view']);
 });
 it('paid recruiter exact staff grant uses OWNER capability, not staff capability',async()=>{
  const t=await create(STAFF,'recruiter',RECRUITER,['opportunities_view']); expect(await visible(STAFF,t.thread_id)).toHaveLength(1);
  expect(await q('SELECT * FROM public.user_capabilities WHERE user_id=$1',[STAFF])).toHaveLength(0);
 });
 it('read-only staff grant cannot access a different read domain',async()=>{await denied(STAFF,'recruiter',RECRUITER,['applications_view']);});
 it('recruiter conversations grant is exact',async()=>{
  await db.exec(`UPDATE public.recruiter_members SET permissions='{"conversations_view":true}' WHERE member_user_id='${STAFF}'`);
  await create(STAFF,'recruiter',RECRUITER,['conversations_view']); await denied(STAFF,'recruiter',RECRUITER,['opportunities_view']);
 });
 it('recruiter staff over seat limit denied, owner retained',async()=>{
  await db.exec(`INSERT INTO public.recruiter_members(recruiter_id,member_user_id,role,status) VALUES('${RECRUITER}','${OTHER}','recruiter_staff','active')`);
  await denied(STAFF,'recruiter',RECRUITER,['opportunities_view']); await create(A,'recruiter',RECRUITER,['opportunities_view']);
 });
 it('recruiter pending unexpired seat counts but expired pending does not',async()=>{
  await db.exec(`INSERT INTO public.recruiter_members(recruiter_id,role,status,invite_token_hash,invite_expires_at) VALUES('${RECRUITER}','recruiter_staff','pending','synthetic-token',now()+interval '1 hour')`);
  await denied(STAFF,'recruiter',RECRUITER,['opportunities_view']);
  await db.exec(`UPDATE public.recruiter_members SET invite_expires_at=now()-interval '1 hour' WHERE status='pending'`); await create(STAFF,'recruiter',RECRUITER,['opportunities_view']);
 });
 it('recruiter staff revocation hides old actor history',async()=>{
  const t=await create(STAFF,'recruiter',RECRUITER,['opportunities_view']); await db.exec(`UPDATE public.recruiter_members SET status='revoked' WHERE member_user_id='${STAFF}'`);
  expect(await visible(STAFF,t.thread_id)).toHaveLength(0); await expect(add(STAFF,t.thread_id)).rejects.toMatchObject({code:'42501'});
 });
 it.each(['setup','suspended','revoked'])('recruiter OWNER capability %s blocks owner and staff',async(status)=>{
  await db.query(`UPDATE public.user_capabilities SET status=$1 WHERE user_id=$2 AND capability='recruiter'`,[status,A]); await denied(A,'recruiter',RECRUITER,['opportunities_view']); await denied(STAFF,'recruiter',RECRUITER,['opportunities_view']);
 });
 it('recruiter foreign tenant denied',async()=>{await denied(STAFF,'recruiter',OTHER_RECRUITER,['opportunities_view']);});
 it.each(['status','verification_status'])('suspended recruiter %s denied',async(column)=>{
  await db.exec(`UPDATE public.recruiter_profiles SET ${column}='suspended' WHERE id='${RECRUITER}'`); await denied(A,'recruiter',RECRUITER,['opportunities_view']);
 });
 it('incomplete recruiter setup denied despite paid row',async()=>{await db.exec(`UPDATE public.recruiter_profiles SET company_type=NULL WHERE id='${RECRUITER}'`); await denied(A,'recruiter',RECRUITER,['opportunities_view']);});
 it('carrier readiness requires DOT or MC, not verified badge',async()=>{
  await db.exec(`UPDATE public.recruiter_profiles SET company_type='carrier' WHERE id='${RECRUITER}'`); await denied(A,'recruiter',RECRUITER,['opportunities_view']);
  await db.exec(`UPDATE public.recruiter_profiles SET mc_number='synthetic' WHERE id='${RECRUITER}'`); await create(A,'recruiter',RECRUITER,['opportunities_view']);
 });
 it('free recruiter never substitutes driver Pro',async()=>{await db.exec(`DELETE FROM public.recruiter_billing_profiles WHERE recruiter_id='${RECRUITER}'`); await denied(A,'recruiter',RECRUITER,['opportunities_view']); await create();});
 it.each(['past_due','canceled','inactive'])('recruiter billing %s denied',async(status)=>{
  await db.query('UPDATE public.recruiter_billing_profiles SET status=$1 WHERE recruiter_id=$2',[status,RECRUITER]); await denied(A,'recruiter',RECRUITER,['opportunities_view']);
 });
 it('canonical dual-paid conflict denied without override',async()=>{
  // B owns both recruiter and paid agency: canonical tier is conflict.
  await denied(B,'recruiter',OTHER_RECRUITER,['opportunities_view']);
 });
 it('agency-owner recruiter inclusion grants owner only, no manufactured staff seats',async()=>{
  await db.exec(`DELETE FROM public.recruiter_billing_profiles WHERE recruiter_id='${OTHER_RECRUITER}'; INSERT INTO public.recruiter_members(recruiter_id,member_user_id,role,status,permissions) VALUES('${OTHER_RECRUITER}','${STAFF}','recruiter_staff','active','{"opportunities_view":true}')`);
  await create(B,'recruiter',OTHER_RECRUITER,['opportunities_view']); await denied(STAFF,'recruiter',OTHER_RECRUITER,['opportunities_view']);
 });
 it('agency owner exact canonical permissions accepted',async()=>{await create(B,'agency',AGENCY,['packages_view','client_requests_view','work_items_view_all']);});
 it('agency staff exact grant and foreign domain denial',async()=>{
  await create(AGENCY_STAFF,'agency',AGENCY,['packages_view']); await denied(AGENCY_STAFF,'agency',AGENCY,['client_requests_view']); await denied(AGENCY_STAFF,'agency',OTHER_AGENCY,['packages_view']);
 });
 it('agency overlimit staff and delegate denied, owner retained',async()=>{
  await db.exec(`INSERT INTO public.agency_members(agency_id,member_user_id,status) VALUES('${AGENCY}','${OTHER}','active')`);
  await denied(AGENCY_STAFF,'agency',AGENCY,['packages_view']); await denied(AGENCY_STAFF,'driver_delegate',FREE); await create(B,'agency',AGENCY,['packages_view']);
 });
 it('agency revoked member denied even with granted permissions',async()=>{await db.exec(`UPDATE public.agency_members SET status='revoked' WHERE member_user_id='${AGENCY_STAFF}'`); await denied(AGENCY_STAFF,'agency',AGENCY,['packages_view']); await denied(AGENCY_STAFF,'driver_delegate',FREE);});
 it('disabled agency denied including owner',async()=>{await db.exec(`UPDATE public.agency_profiles SET status='disabled' WHERE id='${AGENCY}'`); await denied(B,'agency',AGENCY,['packages_view']);});
 it('paid driver/recruiter does not substitute agency paid row or membership',async()=>{await denied(A,'agency',AGENCY,['packages_view']);});
 it('additive dual capability cannot cross chosen scope permission vocabulary',async()=>{
  await denied(A,'driver_self',A,['opportunities_view']); await denied(A,'recruiter',RECRUITER,['manage_loads']);
 });
 it('canonical admin self Pro preserved with NO cross-actor bypass',async()=>{
  await db.exec(`INSERT INTO public.admin_users VALUES('${ADMIN}','super_admin')`); await create(ADMIN);
  const t=await create(); await add(A,t.thread_id); expect(await visible(ADMIN,t.thread_id)).toHaveLength(0);
  expect(await as(ADMIN,'SELECT id FROM public.assistant_messages WHERE thread_id=$1',[t.thread_id])).toHaveLength(0);
 });
 it('Owner QA exact self Free overrides admin Pro, valid self persona restores it',async()=>{
  await db.exec(`INSERT INTO public.admin_users VALUES('${ADMIN}','super_admin'); INSERT INTO public.owner_qa_sessions(user_id,domain,persona,expires_at) VALUES('${ADMIN}','driver','free',now()+interval '1 hour')`);
  await denied(ADMIN,'driver_self',ADMIN); await db.exec(`UPDATE public.owner_qa_sessions SET persona='pro_yearly'`); await create(ADMIN);
 });
 it('expired Owner QA does not manufacture Pro',async()=>{
  await db.exec(`INSERT INTO public.owner_qa_sessions(user_id,domain,persona,created_at,expires_at) VALUES('${FREE}','driver','pro_monthly',now()-interval '2 hours',now()-interval '1 hour')`); await denied(FREE,'driver_self',FREE);
 });
 it('cross-actor SELECT zero even same recruiter workspace',async()=>{
  const t=await create(A,'recruiter',RECRUITER,['opportunities_view']); await add(A,t.thread_id);
  // STAFF genuinely has the same chosen scope authority, but not A's history.
  expect(await visible(STAFF,t.thread_id)).toHaveLength(0);
  expect(await as(STAFF,'SELECT id FROM public.assistant_messages WHERE thread_id=$1',[t.thread_id])).toHaveLength(0);
  await expect(add(STAFF,t.thread_id)).rejects.toMatchObject({code:'42501'});
 });
 it('cross-actor SELECT zero even same agency workspace',async()=>{
  const t=await create(B,'agency',AGENCY,['packages_view']); await add(B,t.thread_id);
  expect(await visible(AGENCY_STAFF,t.thread_id)).toHaveLength(0); expect(await as(AGENCY_STAFF,'SELECT id FROM public.assistant_messages WHERE thread_id=$1',[t.thread_id])).toHaveLength(0);
 });
 it('permission loss hides old history at next database read',async()=>{
  const t=await create(STAFF,'recruiter',RECRUITER,['opportunities_view']); await add(STAFF,t.thread_id);
  await db.exec(`UPDATE public.recruiter_members SET permissions='{}' WHERE member_user_id='${STAFF}'`);
  expect(await visible(STAFF,t.thread_id)).toHaveLength(0); expect(await as(STAFF,'SELECT id FROM public.assistant_messages WHERE thread_id=$1',[t.thread_id])).toHaveLength(0);
 });
 it.each(['INSERT','UPDATE','DELETE'])('authenticated direct %s on threads rejected',async(verb)=>{
  const t=await create(); const sql=verb==='INSERT'?`INSERT INTO public.assistant_threads(actor_user_id,scope_kind,scope_target_id,required_permissions) VALUES('${B}','driver_self','${B}',ARRAY['manage_loads'])`:verb==='UPDATE'?`UPDATE public.assistant_threads SET actor_user_id='${B}' WHERE id='${t.thread_id}'`:`DELETE FROM public.assistant_threads WHERE id='${t.thread_id}'`;
  await expect(as(A,sql)).rejects.toMatchObject({code:'42501'}); expect(await visible(A,t.thread_id)).toHaveLength(1);
 });
 it.each(['INSERT','UPDATE','DELETE'])('authenticated direct %s on messages rejected',async(verb)=>{
  const t=await create(); await add(A,t.thread_id);
  const sql=verb==='INSERT'?`INSERT INTO public.assistant_messages(thread_id,role,content,request_id) VALUES('${t.thread_id}','assistant','Forged reply','${uid(903)}')`:verb==='UPDATE'?`UPDATE public.assistant_messages SET role='assistant' WHERE thread_id='${t.thread_id}'`:`DELETE FROM public.assistant_messages WHERE thread_id='${t.thread_id}'`;
  await expect(as(A,sql)).rejects.toMatchObject({code:'42501'}); expect(await as(A,'SELECT role FROM public.assistant_messages')).toEqual([{role:'user'}]);
 });
 it('internal helper grants remain unavailable to authenticated',async()=>{
  await expect(as(A,'SELECT public.driver_has_active_pro($1)',[A])).rejects.toMatchObject({code:'42501'});
  await expect(as(A,'SELECT public.effective_recruiter_tier($1)',[RECRUITER])).rejects.toMatchObject({code:'42501'});
  await expect(as(A,'SELECT public._assistant_permissions_valid($1,$2::text[])',['driver_self',['manage_loads']])).rejects.toMatchObject({code:'42501'});
 });
 it('fixed expiry exactly 720 hours and messages never extend it',async()=>{
  const t=await create(); expect(await q('SELECT extract(epoch FROM expires_at-created_at)::integer seconds FROM public.assistant_threads WHERE id=$1',[t.thread_id])).toEqual([{seconds:2592000}]);
  const before=await q('SELECT created_at,expires_at FROM public.assistant_threads WHERE id=$1',[t.thread_id]); await add(A,t.thread_id); expect(await q('SELECT created_at,expires_at FROM public.assistant_threads WHERE id=$1',[t.thread_id])).toEqual(before);
 });
 it('expiry boundary hides thread and message and denies append',async()=>{
  const t=await create(); await add(A,t.thread_id); await expired(t.thread_id);
  expect(await visible(A,t.thread_id)).toHaveLength(0); expect(await as(A,'SELECT * FROM public.assistant_messages WHERE thread_id=$1',[t.thread_id])).toHaveLength(0);
  await expect(add(A,t.thread_id,uid(902))).rejects.toMatchObject({code:'42501'}); expect(await q('SELECT id FROM public.assistant_messages')).toHaveLength(1);
 });
 it('server cannot extend expiry or change required domains',async()=>{
  const t=await create();
  await expect(as(null,`UPDATE public.assistant_threads SET expires_at=expires_at+interval '1 day' WHERE id=$1`,[t.thread_id],'service_role')).rejects.toMatchObject({code:'22023'});
  await expect(as(null,`UPDATE public.assistant_threads SET required_permissions=ARRAY['view_dashboard'] WHERE id=$1`,[t.thread_id],'service_role')).rejects.toMatchObject({code:'22023'});
 });
 it('service insert cannot choose thread creation/expiry timestamps',async()=>{
  await as(null,`INSERT INTO public.assistant_threads(actor_user_id,scope_kind,scope_target_id,required_permissions,created_at,expires_at) VALUES($1,'driver_self',$1,ARRAY['manage_loads'],'2000-01-01','2100-01-01')`,[A],'service_role');
  expect(await q(`SELECT extract(epoch FROM expires_at-created_at)::integer seconds,created_at>now()-interval '1 minute' recent FROM public.assistant_threads`)).toEqual([{seconds:2592000,recent:true}]);
 });
 it('idempotent identical trimmed retry returns same id, conflicting body rejected',async()=>{
  const t=await create(); const id=await add(A,t.thread_id,uid(901),'  example  '); expect(await add(A,t.thread_id,uid(901),'example')).toBe(id);
  await expect(add(A,t.thread_id,uid(901),'different')).rejects.toMatchObject({code:'22023'}); expect(await q('SELECT role,content FROM public.assistant_messages')).toEqual([{role:'user',content:'example'}]);
 });
 it.each(['','   ','x'.repeat(8001)])('invalid content length %s rejected without message',async(body)=>{
  const t=await create(); await expect(add(A,t.thread_id,uid(901),body)).rejects.toMatchObject({code:'22023'}); expect(await q('SELECT id FROM public.assistant_messages')).toHaveLength(0);
 });
 it('8000 character content accepted; null request/body rejected',async()=>{
  const t=await create(); await add(A,t.thread_id,uid(901),'x'.repeat(8000));
  await expect(as(A,'SELECT public.assistant_add_user_message($1,NULL,$2)',[t.thread_id,'text'])).rejects.toMatchObject({code:'22023'});
  await expect(as(A,'SELECT public.assistant_add_user_message($1,$2,NULL)',[t.thread_id,uid(902)])).rejects.toMatchObject({code:'22023'});
 });
 it('foreign and missing delete are indistinguishable; other history preserved',async()=>{
  const t=await create(); expect(await as(B,'SELECT public.assistant_delete_thread($1) deleted',[t.thread_id])).toEqual([{deleted:false}]); expect(await as(B,'SELECT public.assistant_delete_thread($1) deleted',[uid(999)])).toEqual([{deleted:false}]); expect(await visible(A,t.thread_id)).toHaveLength(1);
 });
 it('own delete after expiry/paid loss cascades messages',async()=>{
  const t=await create(); await add(A,t.thread_id); await expired(t.thread_id); await db.exec(`DELETE FROM public.subscriptions WHERE user_id='${A}'`);
  expect(await as(A,'SELECT public.assistant_delete_thread($1) deleted',[t.thread_id])).toEqual([{deleted:true}]); expect(await q('SELECT id FROM public.assistant_messages')).toHaveLength(0);
 });
 it('own clear after permission loss returns only own count across scopes',async()=>{
  const d=await create(); await add(A,d.thread_id); await create(A,'recruiter',RECRUITER,['opportunities_view']); const other=await create(B);
  await db.exec(`DELETE FROM public.subscriptions WHERE user_id='${A}'; UPDATE public.user_capabilities SET status='revoked' WHERE user_id='${A}'`);
  expect(await as(A,'SELECT public.assistant_clear_my_history() n')).toEqual([{n:2}]); expect(await visible(B,other.thread_id)).toHaveLength(1); expect(await q('SELECT id FROM public.assistant_messages')).toHaveLength(0);
 });
 it('delegate deletion works after relationship revocation',async()=>{
  const t=await create(STAFF,'driver_delegate',A); await db.exec(`UPDATE public.driver_assistants SET status='revoked' WHERE assistant_user_id='${STAFF}'`); expect(await as(STAFF,'SELECT public.assistant_delete_thread($1) deleted',[t.thread_id])).toEqual([{deleted:true}]);
 });
 it('profile deletion cascades transcript; replacement under same user starts empty',async()=>{
  const t=await create(); await add(A,t.thread_id); await db.exec(`DELETE FROM public.profiles WHERE user_id='${A}'`);
  expect(await q('SELECT id FROM public.assistant_threads')).toHaveLength(0); expect(await q('SELECT id FROM public.assistant_messages')).toHaveLength(0);
  await db.query('INSERT INTO public.profiles(user_id) VALUES($1)',[A]); expect(await as(A,'SELECT id FROM public.assistant_threads')).toHaveLength(0); await create();
 });
 it('auth deletion cascades via profile to threads/messages',async()=>{
  const t=await create(); await add(A,t.thread_id); await db.exec(`DELETE FROM auth.users WHERE id='${A}'`);
  expect(await q('SELECT id FROM public.profiles WHERE user_id=$1',[A])).toHaveLength(0); expect(await q('SELECT id FROM public.assistant_threads')).toHaveLength(0); expect(await q('SELECT id FROM public.assistant_messages')).toHaveLength(0);
 });
 it('users cannot delete their canonical profile via direct RLS',async()=>{
  const t=await create(); expect(await as(A,'DELETE FROM public.profiles WHERE user_id=$1 RETURNING user_id',[A])).toHaveLength(0); expect(await visible(A,t.thread_id)).toHaveLength(1);
 });
 it('only service role purges only expired records and cascades messages',async()=>{
  const old=await create(); await add(A,old.thread_id); await expired(old.thread_id); const current=await create(B); await add(B,current.thread_id);
  await expect(as(A,'SELECT public.assistant_purge_expired()')).rejects.toMatchObject({code:'42501'}); await expect(as(null,'SELECT public.assistant_purge_expired()',[],'anon')).rejects.toMatchObject({code:'42501'});
  expect(await as(null,'SELECT public.assistant_purge_expired() n',[],'service_role')).toEqual([{n:1}]); expect(await visible(B,current.thread_id)).toHaveLength(1); expect(await q('SELECT thread_id FROM public.assistant_messages')).toEqual([{thread_id:current.thread_id}]);
 });
 it('PUBLIC role has no inherited new RPC privileges',async()=>{
  await db.exec('CREATE ROLE phase3_unprivileged NOLOGIN; GRANT USAGE ON SCHEMA public,auth TO phase3_unprivileged; SET ROLE phase3_unprivileged');
  try {await expect(db.query('SELECT public.assistant_clear_my_history()')).rejects.toMatchObject({code:'42501'}); await expect(db.query('SELECT public.assistant_purge_expired()')).rejects.toMatchObject({code:'42501'});}
  finally {await db.exec('RESET ROLE; REVOKE USAGE ON SCHEMA public,auth FROM phase3_unprivileged; DROP ROLE phase3_unprivileged');}
 });
});
