import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const URL = process.env.PHASE1K_D_DATABASE_URL;
if (!URL) throw new Error('PHASE1K_D_DATABASE_URL is required; this suite must never skip.');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPAIR_SQL = readFileSync(ROOT + 'supabase/migrations/20260721010000_phase1k_repair_historical_admin_recruiter_opportunity.sql', 'utf8');
const GUARD_SQL = readFileSync(ROOT + 'supabase/migrations/20260721000000_phase1k_admin_recruiter_opportunity_publication.sql', 'utf8');
const TARGET = '28d75a1e-0d49-445a-82c8-01ba56432a93';
const RECRUITER = 'f6b00b66-cd1c-4037-a382-8b1b9c629f3b';
const OWNER = 'df860876-4c44-4f93-b31c-72ca9dbd9f3d';
const DRIVER = '33333333-3333-4333-8333-333333333333';
const TITLE = 'Looking for OTR company drivers';
const pool = new Pool({ connectionString: URL, max: 1 });

async function q<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

const SCHEMA = String.raw`
DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS supabase_migrations CASCADE; DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public; CREATE SCHEMA auth; CREATE SCHEMA supabase_migrations;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[],name text,created_by text,idempotency_key text UNIQUE,rollback text[]);
CREATE TABLE public.admin_users(id uuid PRIMARY KEY,user_id uuid UNIQUE NOT NULL,email text NOT NULL,role text NOT NULL);
CREATE FUNCTION public.is_admin(_u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=_u) $$;
CREATE TABLE public.recruiter_profiles(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users,recruiter_name text NOT NULL,recruiter_email text,company_name text NOT NULL,dot_number text,mc_number text,verification_status text NOT NULL,status text NOT NULL,posting_terms_accepted_at timestamptz,posting_terms_version text,legacy_terms_grandfathered_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE FUNCTION public.recruiter_profile_can_manage_opportunities(_r uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.recruiter_profiles r WHERE r.id=_r AND r.status<>'suspended' AND r.verification_status<>'suspended' AND btrim(r.recruiter_name)<>'' AND btrim(r.company_name)<>'' AND btrim(r.recruiter_email)~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND (COALESCE(btrim(r.dot_number),'')<>'' OR COALESCE(btrim(r.mc_number),'')<>'') AND (r.posting_terms_accepted_at IS NOT NULL OR r.legacy_terms_grandfathered_at IS NOT NULL)) $$;
CREATE FUNCTION public.current_user_can_manage_recruiter_opportunities(_r uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.recruiter_profiles r WHERE r.id=_r AND r.user_id=auth.uid() AND public.recruiter_profile_can_manage_opportunities(r.id)) $$;
CREATE TABLE public.opportunities(id uuid PRIMARY KEY,recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles,title text NOT NULL,company_name text NOT NULL,hiring_state text,driver_type text,route_type text,trailer_type text,status text NOT NULL,admin_review_status text NOT NULL,featured boolean NOT NULL,view_count int NOT NULL,published_at timestamptz,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL);
CREATE TABLE public.opportunity_applications(id uuid PRIMARY KEY,opportunity_id uuid NOT NULL REFERENCES public.opportunities);
CREATE TABLE public.opportunity_offers(id uuid PRIMARY KEY,opportunity_id uuid NOT NULL REFERENCES public.opportunities);
CREATE TABLE public.notification_preferences(user_id uuid PRIMARY KEY,in_app_enabled boolean DEFAULT true,recruiter_status_events boolean DEFAULT true);
CREATE TABLE public.notifications(id uuid PRIMARY KEY,user_id uuid NOT NULL,type text NOT NULL,title text NOT NULL,body text NOT NULL,payload jsonb NOT NULL DEFAULT '{}'::jsonb,read_at timestamptz,created_at timestamptz DEFAULT now());
CREATE FUNCTION public.create_notification(_u uuid,_t text,_title text,_body text,_p jsonb DEFAULT '{}'::jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE x uuid := ('aaaaaaaa-aaaa-4aaa-8aaa-'||substr(md5(random()::text||clock_timestamp()::text),1,12))::uuid; pref public.notification_preferences; BEGIN SELECT * INTO pref FROM public.notification_preferences WHERE user_id=_u; IF FOUND AND (pref.in_app_enabled IS NOT TRUE OR (_t='opportunity_reviewed' AND pref.recruiter_status_events IS NOT TRUE)) THEN RETURN NULL; END IF; INSERT INTO public.notifications VALUES(x,_u,_t,_title,_body,COALESCE(_p,'{}'::jsonb),NULL,now()); RETURN x; END $$;
CREATE FUNCTION public.notify_opportunity_reviewed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE u uuid; BEGIN IF NEW.admin_review_status IS DISTINCT FROM OLD.admin_review_status AND NEW.admin_review_status IN('approved','rejected') THEN SELECT user_id INTO u FROM public.recruiter_profiles WHERE id=NEW.recruiter_id; PERFORM public.create_notification(u,'opportunity_reviewed',CASE WHEN NEW.admin_review_status='approved' THEN 'Opportunity approved' ELSE 'Opportunity rejected' END,'Your opportunity "'||NEW.title||'" was '||NEW.admin_review_status||'.',jsonb_build_object('opportunity_id',NEW.id,'admin_review_status',NEW.admin_review_status)); END IF; RETURN NEW; END $$;
CREATE FUNCTION public.opportunities_billing_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF public.is_admin(auth.uid()) THEN RETURN NEW; END IF; IF NOT public.current_user_can_manage_recruiter_opportunities(NEW.recruiter_id) THEN RAISE EXCEPTION 'Complete your recruiter profile to publish opportunities.' USING ERRCODE='42501'; END IF; RETURN NEW; END $$;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
CREATE FUNCTION public.list_driver_visible_opportunities(text,text,text) RETURNS SETOF public.opportunities LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT o.* FROM public.opportunities o WHERE auth.uid() IS NOT NULL AND o.status='active' AND o.admin_review_status='approved' AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id) $$;
`;
const TRIGGERS = `
CREATE TRIGGER trg_opportunities_billing_guard BEFORE INSERT OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.opportunities_billing_guard();
CREATE TRIGGER trg_opportunities_guard BEFORE INSERT OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.opportunities_guard();
CREATE TRIGGER trg_opportunities_updated_at BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_notify_opportunity_reviewed AFTER UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.notify_opportunity_reviewed();`;

async function reset(): Promise<void> {
  await pool.query(SCHEMA); await pool.query(GUARD_SQL);
  await q(`INSERT INTO auth.users VALUES($1,'owner@test'),($2,'driver@test')`,[OWNER,DRIVER]);
  await q(`INSERT INTO public.admin_users VALUES('aaaaaaaa-0000-4000-8000-000000000001',$1,'owner@test','super_admin')`,[OWNER]);
  await q(`INSERT INTO public.recruiter_profiles(id,user_id,recruiter_name,recruiter_email,company_name,dot_number,mc_number,verification_status,status,legacy_terms_grandfathered_at) VALUES($1,$2,'Owner','owner@test.com','Carrier','9999991','MC-9999991','approved','active','2026-07-17T17:55:03Z')`,[RECRUITER,OWNER]);
  await q(`INSERT INTO public.opportunities VALUES($1,$2,$3,'Carrier','TX','company','OTR','Dry Van','active','pending',true,0,NULL,'2026-07-20T22:58:34Z','2026-07-20T22:58:34Z')`,[TARGET,RECRUITER,TITLE]);
  await q(`INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('20260721000000',ARRAY['guard'],'20260721000000_phase1k_admin_recruiter_opportunity_publication','test','c-test')`);
  await pool.query(TRIGGERS);
}
async function row(){return (await q(`SELECT * FROM public.opportunities WHERE id=$1`,[TARGET]))[0];}
async function related(){return (await q(`SELECT (SELECT count(*)::int FROM public.opportunity_applications WHERE opportunity_id=$1) applications,(SELECT count(*)::int FROM public.opportunity_offers WHERE opportunity_id=$1) offers,(SELECT count(*)::int FROM public.notifications WHERE user_id=$2 AND type='opportunity_reviewed' AND payload->>'opportunity_id'=$1::text) notifications`,[TARGET,OWNER]))[0];}
async function snapshot(){return {row:await row(),related:await related()};}
async function fail(re:RegExp){const before=await snapshot();await expect(pool.query(REPAIR_SQL)).rejects.toThrow(re);expect(await snapshot()).toEqual(before);}
async function raw(sql:string,p:unknown[]=[]){await q('ALTER TABLE public.opportunities DISABLE TRIGGER USER');try{await q(sql,p);}finally{await q('ALTER TABLE public.opportunities ENABLE TRIGGER USER');}}
async function visible(){const c=await pool.connect();try{await c.query('BEGIN');await c.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`,[DRIVER]);const r=await c.query(`SELECT id FROM public.list_driver_visible_opportunities(NULL,NULL,NULL)`);await c.query('ROLLBACK');return r.rows.map(x=>x.id);}finally{c.release();}}

beforeEach(reset); afterAll(()=>pool.end());

describe('Phase 1K-D success',()=>{
  it('repairs one row and preserves every unauthorized column',async()=>{const b=await row();await pool.query(REPAIR_SQL);const a=await row();expect(a.admin_review_status).toBe('approved');expect(a.published_at).not.toBeNull();expect(new Date(String(a.updated_at)).getTime()).toBeGreaterThan(new Date(String(b.updated_at)).getTime());for(const k of Object.keys(b))if(!['admin_review_status','published_at','updated_at'].includes(k))expect(a[k]).toEqual(b[k]);expect(a.featured).toBe(true);expect(a.view_count).toBe(0);});
  it('creates one exact notification and no applications/offers',async()=>{await pool.query(REPAIR_SQL);expect(await related()).toEqual({applications:0,offers:0,notifications:1});expect(await q(`SELECT user_id,type,title,body,payload FROM public.notifications`)).toEqual([{user_id:OWNER,type:'opportunity_reviewed',title:'Opportunity approved',body:`Your opportunity "${TITLE}" was approved.`,payload:{opportunity_id:TARGET,admin_review_status:'approved'}}]);});
  it('becomes driver-visible',async()=>{expect(await visible()).not.toContain(TARGET);await pool.query(REPAIR_SQL);expect(await visible()).toContain(TARGET);});
  it('rerun fails without duplicate notification',async()=>{await pool.query(REPAIR_SQL);const b=await snapshot();await expect(pool.query(REPAIR_SQL)).rejects.toThrow(/state drifted/);expect(await snapshot()).toEqual(b);});
});

describe('Phase 1K-D prerequisite rollback',()=>{
  it('missing C ledger',async()=>{await q(`DELETE FROM supabase_migrations.schema_migrations`);await fail(/Phase 1K-C migration record/);});
  it('vulnerable guard',async()=>{await q(`CREATE OR REPLACE FUNCTION public.opportunities_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF public.is_admin(auth.uid()) THEN RETURN NEW; END IF; RETURN NEW; END $$`);await fail(/verified Phase 1K-C/);});
  it('ineligible recruiter',async()=>{await q(`UPDATE public.recruiter_profiles SET status='suspended' WHERE id=$1`,[RECRUITER]);await fail(/eligible recruiter/);});
  it('non-admin owner',async()=>{await q(`DELETE FROM public.admin_users`);await fail(/eligible recruiter/);});
  it('second qualifying row',async()=>{await raw(`INSERT INTO public.opportunities VALUES('99999999-9999-4999-8999-999999999999',$1,'Second','Carrier','TX','company','OTR','Dry Van','active','pending',false,0,NULL,now(),now())`,[RECRUITER]);await fail(/exactly one affected opportunity/);});
});

const drift:[string,string,unknown[]][]=[
 ['status',`UPDATE public.opportunities SET status='paused' WHERE id=$1`,[TARGET]],
 ['review',`UPDATE public.opportunities SET admin_review_status='approved' WHERE id=$1`,[TARGET]],
 ['published',`UPDATE public.opportunities SET published_at=now() WHERE id=$1`,[TARGET]],
 ['title',`UPDATE public.opportunities SET title='Drift' WHERE id=$1`,[TARGET]],
 ['featured',`UPDATE public.opportunities SET featured=false WHERE id=$1`,[TARGET]],
 ['view count',`UPDATE public.opportunities SET view_count=1 WHERE id=$1`,[TARGET]],
];
describe('Phase 1K-D target drift rollback',()=>{
  it.each(drift)('%s',async(_n,s,p)=>{await raw(s,p);await fail(/state drifted/);});
  it('recruiter',async()=>{const r='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',u='44444444-4444-4444-8444-444444444444';await q(`INSERT INTO auth.users VALUES($1,'other')`,[u]);await q(`INSERT INTO public.recruiter_profiles(id,user_id,recruiter_name,recruiter_email,company_name,dot_number,verification_status,status,legacy_terms_grandfathered_at) VALUES($1,$2,'Other','other@test.com','Other','1','approved','active',now())`,[r,u]);await raw(`UPDATE public.opportunities SET recruiter_id=$2 WHERE id=$1`,[TARGET,r]);await fail(/state drifted/);});
});

describe('Phase 1K-D related inventory rollback',()=>{
  it('application',async()=>{await q(`INSERT INTO public.opportunity_applications VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',$1)`,[TARGET]);await fail(/related-row inventory drifted/);});
  it('offer',async()=>{await q(`INSERT INTO public.opportunity_offers VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',$1)`,[TARGET]);await fail(/related-row inventory drifted/);});
  it('prior notification',async()=>{await q(`INSERT INTO public.notifications VALUES('cccccccc-cccc-4ccc-8ccc-ccccccccccc1',$1,'opportunity_reviewed','Earlier','Earlier',jsonb_build_object('opportunity_id',$2::text),NULL,now())`,[OWNER,TARGET]);await fail(/related-row inventory drifted/);});
  it('preferences',async()=>{await q(`INSERT INTO public.notification_preferences VALUES($1,true,true)`,[OWNER]);await fail(/preference precondition drifted/);});
});

describe('Phase 1K-D source contract',()=>{
  const n=REPAIR_SQL.replace(/\s+/g,' ').toLowerCase();
  it('has one exact narrow update',()=>{expect(REPAIR_SQL).toContain(TARGET);expect(REPAIR_SQL).toContain(RECRUITER);expect(REPAIR_SQL).toContain(OWNER);expect((n.match(/update public\.opportunities/g)??[])).toHaveLength(1);expect(n).toContain("set admin_review_status = 'approved'");expect(n).toContain('published_at = _repair_ts');expect(n).toContain('transaction_timestamp()');});
  it('never bypasses triggers/roles or mutates other business tables',()=>{expect(n).not.toMatch(/disable trigger|session_replication_role|set role/);expect(n).not.toMatch(/delete\s+from\s+public\./);expect(n).not.toMatch(/insert\s+into\s+public\.(opportunities|opportunity_applications|opportunity_offers|notifications)/);expect(n).not.toContain('published_at = created_at');});
  it('proves full-row preservation and inventory zero',()=>{expect(n).toContain('to_jsonb(_after)');expect(n).toContain('to_jsonb(_before)');expect(n).toContain("'admin_review_status', 'published_at', 'updated_at'");expect(n).toContain('requires exactly one affected opportunity');expect(n).toContain('affected opportunity inventory did not reach zero');expect(n).toContain('does not fabricate the original publication time');});
});
