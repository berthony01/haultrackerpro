/**
 * Phase 1H-M2 — Real PostgreSQL 16 offer-workflow gate.
 *
 * Lives OUTSIDE src/ so `bunx vitest run` never picks it up. Runs only
 * via `vitest.phase1h-m2-postgres.config.ts` in the GitHub Actions gate
 * (or locally against a real PG16 pointed to by PHASE1H_M2_DATABASE_URL).
 *
 * Loads the exact canonical M1 migration and the exact M2 candidate from
 * disk, on top of a Supabase-compatible fixture (roles, auth.uid(), the
 * subset of `public` tables/functions M1 references). Proves:
 *   - server_version_num is in the 16.x range
 *   - table/function ACLs and search_path via pg_catalog inspection
 *   - trigger presence and target function via pg_trigger
 *   - partial unique index for one-accepted-offer via pg_index
 *   - runtime role/authorization matrix via SET ROLE + JWT claim
 *   - concurrency races via independent `pg` clients
 *   - forced rollback atomicity across a workflow mutation
 *
 * NOTE: PGlite, mocks, and static regex are not substitutes for this
 * suite. Every proof below hits real Postgres catalogs / execution.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DATABASE_URL = process.env.PHASE1H_M2_DATABASE_URL;
const REQUIRE = process.env.PHASE1H_M2_REQUIRE_POSTGRES === "1";

const M1_PATH = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260719183725_ee7ffc53-dcdc-4666-bcba-1aeac0f5d0cf.sql",
    import.meta.url,
  ),
);
const M2_PATH = fileURLToPath(
  new URL(
    "../../supabase/migration-candidates/20260720000000_phase1h_m2_offer_workflow_rpcs.sql",
    import.meta.url,
  ),
);

// Supabase-compatible fixture. Mirrors src/test/phase1hM2OfferWorkflow.test.ts
// primeBaseline so the exact production M1 + M2 SQL runs unchanged on top.
const BOOTSTRAP_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon           NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated  NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role   NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT anon, authenticated, service_role TO postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $fn$;

CREATE TABLE IF NOT EXISTS public.driver_opportunity_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  full_name text, phone text, email text, city text, state text, cdl_class text,
  years_experience numeric,
  endorsements text[] NOT NULL DEFAULT '{}',
  trailer_experience text[] NOT NULL DEFAULT '{}',
  preferred_driver_type text, preferred_route_type text, preferred_home_time text,
  preferred_states text[] NOT NULL DEFAULT '{}',
  min_weekly_gross numeric, min_weekly_net numeric, min_effective_rpm numeric,
  available_start_date date, willing_to_relocate boolean NOT NULL DEFAULT false,
  contact_preference text NOT NULL DEFAULT 'in_app',
  visibility text NOT NULL DEFAULT 'private',
  allow_verified_recruiter_contact boolean NOT NULL DEFAULT false,
  profile_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  recruiter_name text NOT NULL, recruiter_email text, recruiter_phone text,
  company_name text NOT NULL, company_website text, dot_number text, mc_number text,
  company_phone text, company_address text, company_city text, company_state text,
  hiring_states text[] NOT NULL DEFAULT '{}',
  equipment_types text[] NOT NULL DEFAULT '{}',
  driver_types_hired text[] NOT NULL DEFAULT '{}',
  verification_status text NOT NULL DEFAULT 'approved',
  status text NOT NULL DEFAULT 'active',
  admin_notes text, verified_at timestamptz, verified_by uuid,
  posting_terms_accepted_at timestamptz, posting_terms_version text,
  legacy_terms_grandfathered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  title text NOT NULL, company_name text NOT NULL,
  hiring_city text, hiring_state text,
  hiring_states text[] NOT NULL DEFAULT '{}',
  driver_type text, route_type text, trailer_type text,
  pay_model text, cpm numeric, percentage_pay numeric, flat_weekly_pay numeric,
  estimated_weekly_gross numeric, estimated_weekly_miles numeric,
  estimated_loaded_miles numeric, estimated_deadhead_miles numeric,
  home_time text,
  status text NOT NULL DEFAULT 'active',
  admin_review_status text NOT NULL DEFAULT 'approved',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.opportunity_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
  driver_profile_id uuid REFERENCES public.driver_opportunity_profiles(id) ON DELETE SET NULL,
  application_type text NOT NULL DEFAULT 'request_info',
  status text NOT NULL DEFAULT 'new',
  message text,
  preferred_contact_method text,
  driver_phone_snapshot text,
  driver_email_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_applications_type_chk
    CHECK (application_type = ANY (ARRAY['apply','request_info','callback'])),
  CONSTRAINT opportunity_applications_status_chk
    CHECK (status = ANY (ARRAY['new','viewed','contact_requested','call_scheduled','waiting_documents','interviewing','offer_sent','hired','rejected','withdrawn'])),
  CONSTRAINT opportunity_applications_unique UNIQUE (opportunity_id, driver_user_id)
);

CREATE TABLE IF NOT EXISTS public.application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  actor_type text,
  actor_user_id uuid,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text, body text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.create_notification(
  _uid uuid, _type text, _title text, _body text, _payload jsonb
) RETURNS uuid LANGUAGE sql AS $fn$
  INSERT INTO public.notifications(user_id,type,title,body,payload)
  VALUES(_uid,_type,_title,_body,COALESCE(_payload,'{}'::jsonb))
  RETURNING id;
$fn$;

CREATE TABLE IF NOT EXISTS public.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid,
  current_version_id uuid,
  status text NOT NULL DEFAULT 'draft',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.contract_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  upload_status text NOT NULL DEFAULT 'pending'
);

ALTER TABLE public.driver_opportunity_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruiter_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_applications ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_opportunity_profiles TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recruiter_profiles TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunities TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_applications TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contracts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_versions TO service_role;

CREATE POLICY "driver own profiles" ON public.driver_opportunity_profiles
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "recruiter own profiles" ON public.recruiter_profiles
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.is_admin(_uid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$ SELECT false $fn$;

CREATE OR REPLACE FUNCTION public.recruiter_profile_can_manage_opportunities(_rid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
    SELECT EXISTS (
      SELECT 1 FROM public.recruiter_profiles rp
      WHERE rp.id = _rid AND rp.status <> 'suspended'
        AND rp.verification_status <> 'suspended'
        AND (rp.posting_terms_accepted_at IS NOT NULL OR rp.legacy_terms_grandfathered_at IS NOT NULL)
    )
  $fn$;
CREATE OR REPLACE FUNCTION public.current_user_can_manage_recruiter_opportunities(_rid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
    SELECT EXISTS (
      SELECT 1 FROM public.recruiter_profiles rp
      WHERE rp.id = _rid AND rp.user_id = auth.uid()
        AND rp.status <> 'suspended'
        AND rp.verification_status <> 'suspended'
        AND (rp.posting_terms_accepted_at IS NOT NULL OR rp.legacy_terms_grandfathered_at IS NOT NULL)
    )
  $fn$;
CREATE OR REPLACE FUNCTION public.driver_can_access_opportunity(_o uuid, _r uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
    SELECT EXISTS (
      SELECT 1 FROM public.opportunities o
      WHERE auth.uid() IS NOT NULL AND o.id=_o AND o.recruiter_id=_r
        AND o.status='active' AND o.admin_review_status='approved'
        AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
    )
  $fn$;

CREATE POLICY "driver own apps" ON public.opportunity_applications
  FOR SELECT TO authenticated USING (auth.uid() = driver_user_id);
CREATE POLICY "recruiter own apps" ON public.opportunity_applications
  FOR SELECT TO authenticated USING (public.current_user_can_manage_recruiter_opportunities(recruiter_id));
CREATE POLICY "driver insert own" ON public.opportunity_applications
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = driver_user_id AND public.driver_can_access_opportunity(opportunity_id, recruiter_id));
CREATE POLICY "recruiter update status" ON public.opportunity_applications
  FOR UPDATE TO authenticated
  USING (public.current_user_can_manage_recruiter_opportunities(recruiter_id))
  WITH CHECK (public.current_user_can_manage_recruiter_opportunities(recruiter_id));

CREATE TABLE IF NOT EXISTS public.subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, status text NOT NULL DEFAULT 'inactive');
CREATE TABLE IF NOT EXISTS public.recruiter_billing_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recruiter_id uuid NOT NULL, stripe_customer_id text);
`;

interface Ids {
  driverA: string;
  driverB: string;
  driverC: string;
  driverD: string;
  driverE: string;
  driverF: string;
  recruiterUser: string;
  recruiterProfile: string;
  opportunity: string;
  foreignRecruiterUser: string;
  foreignRecruiterProfile: string;
  foreignOpportunity: string;
  incompleteRecruiterUser: string;
  incompleteRecruiterProfile: string;
  suspendedRecruiterUser: string;
  suspendedRecruiterProfile: string;
  suspendedOpportunity: string;
}

function newIds(): Ids {
  return {
    driverA: randomUUID(),
    driverB: randomUUID(),
    driverC: randomUUID(),
    driverD: randomUUID(),
    driverE: randomUUID(),
    driverF: randomUUID(),
    recruiterUser: randomUUID(),
    recruiterProfile: randomUUID(),
    opportunity: randomUUID(),
    foreignRecruiterUser: randomUUID(),
    foreignRecruiterProfile: randomUUID(),
    foreignOpportunity: randomUUID(),
    incompleteRecruiterUser: randomUUID(),
    incompleteRecruiterProfile: randomUUID(),
    suspendedRecruiterUser: randomUUID(),
    suspendedRecruiterProfile: randomUUID(),
    suspendedOpportunity: randomUUID(),
  };
}

async function seed(pool: pg.Pool, ids: Ids) {
  const c = await pool.connect();
  try {
    await c.query(
      `INSERT INTO auth.users(id,email) VALUES
        ($1,'a@t'),($2,'b@t'),($3,'c@t'),($4,'d@t'),($5,'e@t'),($6,'f@t'),
        ($7,'r@t'),($8,'fr@t'),($9,'ir@t'),($10,'sr@t')`,
      [
        ids.driverA,
        ids.driverB,
        ids.driverC,
        ids.driverD,
        ids.driverE,
        ids.driverF,
        ids.recruiterUser,
        ids.foreignRecruiterUser,
        ids.incompleteRecruiterUser,
        ids.suspendedRecruiterUser,
      ],
    );
    await c.query(
      `INSERT INTO public.recruiter_profiles
         (id,user_id,recruiter_name,recruiter_email,company_name,dot_number,
          posting_terms_accepted_at,posting_terms_version,verification_status,status)
       VALUES
         ($1,$2,'R','r@t','Acme','DOT1',now(),'v1','approved','active'),
         ($3,$4,'FR','fr@t','Foreign','DOT2',now(),'v1','approved','active'),
         ($5,$6,'IR','ir@t','Inc','DOT3',NULL,NULL,'approved','active'),
         ($7,$8,'SR','sr@t','Susp','DOT4',now(),'v1','approved','active')`,
      [
        ids.recruiterProfile, ids.recruiterUser,
        ids.foreignRecruiterProfile, ids.foreignRecruiterUser,
        ids.incompleteRecruiterProfile, ids.incompleteRecruiterUser,
        ids.suspendedRecruiterProfile, ids.suspendedRecruiterUser,
      ],
    );
    await c.query(
      `INSERT INTO public.opportunities
         (id,recruiter_id,title,company_name,hiring_city,hiring_state,driver_type,route_type,
          trailer_type,pay_model,cpm,estimated_weekly_gross,estimated_weekly_miles,status,admin_review_status)
       VALUES
         ($1,$2,'Reg','Acme','Dallas','TX','company','regional','dry_van','cpm',0.62,1800,2800,'active','approved'),
         ($3,$4,'Reg','Foreign','Dallas','TX','company','regional','dry_van','cpm',0.62,1800,2800,'active','approved'),
         ($5,$6,'Reg','Susp','Dallas','TX','company','regional','dry_van','cpm',0.62,1800,2800,'active','approved')`,
      [
        ids.opportunity, ids.recruiterProfile,
        ids.foreignOpportunity, ids.foreignRecruiterProfile,
        ids.suspendedOpportunity, ids.suspendedRecruiterProfile,
      ],
    );
    for (const uid of [ids.driverA, ids.driverB, ids.driverC, ids.driverD, ids.driverE, ids.driverF]) {
      await c.query(
        `INSERT INTO public.driver_opportunity_profiles(
           user_id,full_name,phone,email,city,state,cdl_class,years_experience,endorsements,
           trailer_experience,preferred_driver_type,preferred_route_type,preferred_home_time,
           preferred_states,min_weekly_gross,min_weekly_net,min_effective_rpm,
           available_start_date,willing_to_relocate,contact_preference,visibility,
           allow_verified_recruiter_contact,profile_completed)
         VALUES ($1,'D','555','d@t','Austin','TX','A',5,ARRAY['H']::text[],ARRAY['dry_van']::text[],
           'company','regional','weekends',ARRAY['TX']::text[],1500,1200,1.8,'2026-08-01',false,
           'phone','apply_only',true,true)`,
        [uid],
      );
    }
  } finally {
    c.release();
  }
}

async function mintDriver(pool: pg.Pool): Promise<string> {
  const uid = randomUUID();
  const c = await pool.connect();
  try {
    await c.query(`INSERT INTO auth.users(id,email) VALUES ($1, $2)`, [uid, `${uid.slice(0, 8)}@t`]);
    await c.query(
      `INSERT INTO public.driver_opportunity_profiles(
         user_id,full_name,city,state,cdl_class,years_experience,endorsements,trailer_experience,
         preferred_driver_type,preferred_route_type,preferred_home_time,preferred_states,
         min_weekly_gross,min_weekly_net,min_effective_rpm,available_start_date,
         willing_to_relocate,contact_preference,visibility,allow_verified_recruiter_contact,
         profile_completed,phone,email)
       VALUES($1,'D','Austin','TX','A',5,ARRAY['H']::text[],ARRAY['dry_van']::text[],
         'company','regional','weekends',ARRAY['TX']::text[],1500,1200,1.8,'2026-08-01',
         false,'phone','apply_only',true,true,'555','x@t')`,
      [uid],
    );
  } finally {
    c.release();
  }
  return uid;
}

async function newAuthClient(url: string, uid: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url, statement_timeout: 30_000 });
  await c.connect();
  await c.query("BEGIN");
  await c.query("SET LOCAL role authenticated");
  await c.query(`SET LOCAL "request.jwt.claim.sub" = '${uid}'`);
  return c;
}

async function submitApply(url: string, driver: string, oppId: string): Promise<string> {
  const c = await newAuthClient(url, driver);
  try {
    const key = `k-${randomUUID()}`;
    const r = await c.query(
      `SELECT * FROM public.submit_opportunity_application($1::uuid,$2::text,'msg',true,true,true,'phone',true)`,
      [oppId, key],
    );
    if (r.rows[0].result_code !== "created") {
      throw new Error(`submit failed: ${JSON.stringify(r.rows[0])}`);
    }
    await c.query("COMMIT");
    return r.rows[0].application_id as string;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end().catch(() => {});
  }
}

/** Advance application through recruiter transitions up to `interviewing`. */
async function advanceToInterviewing(url: string, recruiterUid: string, appId: string) {
  const path = ["viewed", "contact_requested", "call_scheduled", "interviewing"];
  for (const target of path) {
    const c = await newAuthClient(url, recruiterUid);
    try {
      const r = await c.query(
        `SELECT * FROM public.transition_opportunity_application($1::uuid,$2::text,NULL)`,
        [appId, target],
      );
      if (r.rows[0].result_code !== "application_transitioned") {
        throw new Error(`transition ${target} failed: ${JSON.stringify(r.rows[0])}`);
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      await c.end().catch(() => {});
    }
  }
}

async function saveDraft(url: string, recruiterUid: string, appId: string): Promise<string> {
  const c = await newAuthClient(url, recruiterUid);
  try {
    const r = await c.query(
      `SELECT * FROM public.save_opportunity_offer_draft($1::uuid,$2::text,$3::numeric,'route','equip','home',NULL,'orient','cont','msg')`,
      [appId, "Pay $1200/wk", 1200],
    );
    await c.query("COMMIT");
    return r.rows[0].offer_id as string;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end().catch(() => {});
  }
}

async function sendOffer(url: string, recruiterUid: string, offerId: string): Promise<{ result_code: string; offer_status: string }> {
  const c = await newAuthClient(url, recruiterUid);
  try {
    const r = await c.query(
      `SELECT * FROM public.send_opportunity_offer($1::uuid, (now() + interval '2 days')::timestamptz)`,
      [offerId],
    );
    await c.query("COMMIT");
    return r.rows[0] as { result_code: string; offer_status: string };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end().catch(() => {});
  }
}

// -------------------------------------------------------------------------

const shouldRun = Boolean(DATABASE_URL);
if (!shouldRun && REQUIRE) {
  throw new Error("PHASE1H_M2_REQUIRE_POSTGRES=1 but PHASE1H_M2_DATABASE_URL is not set");
}

(shouldRun ? describe : describe.skip)(
  "Phase 1H-M2 — real Postgres 16 offer workflow gate",
  () => {
    let pool: pg.Pool;
    const url = DATABASE_URL!;
    let ids: Ids;

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: url, max: 12 });

      // Fresh schema per run: drop and recreate public + auth objects we own.
      const c = await pool.connect();
      try {
        await c.query(`DROP SCHEMA IF EXISTS public CASCADE`);
        await c.query(`DROP SCHEMA IF EXISTS auth CASCADE`);
        await c.query(`CREATE SCHEMA public`);
        await c.query(BOOTSTRAP_SQL);
        await c.query(readFileSync(M1_PATH, "utf8"));
        await c.query(readFileSync(M2_PATH, "utf8"));
      } finally {
        c.release();
      }

      ids = newIds();
      await seed(pool, ids);
    }, 120_000);

    afterAll(async () => {
      await pool?.end();
    });

    // --------------------------------------------------------------------
    // A. Server version + basic identity
    // --------------------------------------------------------------------
    it("A: server_version_num is in the 16.x range", async () => {
      const { rows } = await pool.query(`SELECT current_setting('server_version_num')::int AS v`);
      const v = rows[0].v as number;
      expect(v).toBeGreaterThanOrEqual(160000);
      expect(v).toBeLessThan(170000);
    });

    // --------------------------------------------------------------------
    // B. Catalog and privilege proof
    // --------------------------------------------------------------------
    it("B1: _m2_workflow_secret exists and is inaccessible to PUBLIC/anon/authenticated", async () => {
      const { rows } = await pool.query(
        `SELECT
           has_table_privilege('anon', 'public._m2_workflow_secret', 'SELECT') AS anon_select,
           has_table_privilege('authenticated', 'public._m2_workflow_secret', 'SELECT') AS auth_select,
           has_table_privilege('public', 'public._m2_workflow_secret', 'SELECT') AS public_select`,
      );
      expect(rows[0].anon_select).toBe(false);
      expect(rows[0].auth_select).toBe(false);
      expect(rows[0].public_select).toBe(false);
    });

    it("B2: anon and authenticated cannot SELECT the secret token at runtime", async () => {
      for (const role of ["anon", "authenticated"] as const) {
        const c = new pg.Client({ connectionString: url });
        await c.connect();
        let code = "";
        try {
          await c.query("BEGIN");
          await c.query(`SET LOCAL role ${role}`);
          await c.query(`SELECT token FROM public._m2_workflow_secret`);
        } catch (e) {
          code = (e as { code?: string }).code ?? "";
        } finally {
          await c.query("ROLLBACK").catch(() => {});
          await c.end().catch(() => {});
        }
        expect(code).toBe("42501");
      }
    });

    it("B3: internal helpers are SECURITY DEFINER with fixed search_path and denied to anon/authenticated", async () => {
      const helpers = [
        "_m2_workflow_token()",
        "_m2_workflow_bypass_active()",
        "_m2_driver_withdraw_active()",
        "_m2_insert_event_once(uuid,text,uuid,text,uuid,jsonb)",
        "_m2_notify_once(uuid,text,text,text,uuid,uuid,jsonb)",
        "_m2_expire_offer(uuid)",
        "_m2_set_application_status(uuid,text)",
        "_m2_set_application_withdrawn(uuid)",
      ];
      for (const sig of helpers) {
        const q = await pool.query(
          `SELECT p.prosecdef, p.proconfig
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.oid = ('public.' || $1)::regprocedure`,
          [sig],
        );
        expect(q.rows.length, `${sig} exists`).toBe(1);
        expect(q.rows[0].prosecdef, `${sig} SECURITY DEFINER`).toBe(true);
        const cfg = (q.rows[0].proconfig as string[] | null) ?? [];
        expect(cfg.some((s) => s.toLowerCase().startsWith("search_path=")), `${sig} pins search_path`).toBe(true);

        const acl = await pool.query(
          `SELECT
             has_function_privilege('anon', 'public.' || $1, 'EXECUTE') AS anon_x,
             has_function_privilege('authenticated', 'public.' || $1, 'EXECUTE') AS auth_x,
             has_function_privilege('public', 'public.' || $1, 'EXECUTE') AS public_x,
             has_function_privilege('service_role', 'public.' || $1, 'EXECUTE') AS svc_x`,
          [sig],
        );
        expect(acl.rows[0].anon_x, `${sig} denies anon`).toBe(false);
        expect(acl.rows[0].auth_x, `${sig} denies authenticated`).toBe(false);
        expect(acl.rows[0].public_x, `${sig} denies PUBLIC`).toBe(false);
        expect(acl.rows[0].svc_x, `${sig} grants service_role`).toBe(true);
      }
    });

    it("B4: expire_opportunity_offers is service_role only", async () => {
      const acl = await pool.query(
        `SELECT
           has_function_privilege('anon', 'public.expire_opportunity_offers(integer)', 'EXECUTE') AS a,
           has_function_privilege('authenticated', 'public.expire_opportunity_offers(integer)', 'EXECUTE') AS b,
           has_function_privilege('service_role', 'public.expire_opportunity_offers(integer)', 'EXECUTE') AS s`,
      );
      expect(acl.rows[0].a).toBe(false);
      expect(acl.rows[0].b).toBe(false);
      expect(acl.rows[0].s).toBe(true);
    });

    it("B5: public workflow RPCs are executable by authenticated + service_role, denied to anon", async () => {
      const rpcs = [
        "transition_opportunity_application(uuid,text,text)",
        "save_opportunity_offer_draft(uuid,text,numeric,text,text,text,date,text,text,text)",
        "send_opportunity_offer(uuid,timestamptz)",
        "accept_opportunity_offer(uuid)",
        "decline_opportunity_offer(uuid,text)",
        "cancel_opportunity_offer(uuid,text)",
        "withdraw_opportunity_application(uuid)",
        "complete_hiring(uuid)",
      ];
      for (const sig of rpcs) {
        const q = await pool.query(
          `SELECT
             has_function_privilege('anon', 'public.' || $1, 'EXECUTE') AS a,
             has_function_privilege('authenticated', 'public.' || $1, 'EXECUTE') AS b,
             has_function_privilege('service_role', 'public.' || $1, 'EXECUTE') AS s,
             (SELECT prosecdef FROM pg_proc WHERE oid = ('public.' || $1)::regprocedure) AS def,
             (SELECT proconfig FROM pg_proc WHERE oid = ('public.' || $1)::regprocedure) AS cfg`,
          [sig],
        );
        expect(q.rows[0].a, `${sig} anon denied`).toBe(false);
        expect(q.rows[0].b, `${sig} authenticated allowed`).toBe(true);
        expect(q.rows[0].s, `${sig} service_role allowed`).toBe(true);
        expect(q.rows[0].def, `${sig} SECURITY DEFINER`).toBe(true);
        const cfg = (q.rows[0].cfg as string[] | null) ?? [];
        expect(cfg.some((s) => s.toLowerCase().startsWith("search_path=")), `${sig} pins search_path`).toBe(true);
      }
    });

    it("B6: application + offer guard triggers exist and point to expected functions", async () => {
      const q = await pool.query(
        `SELECT t.tgname, p.proname, t.tgenabled
           FROM pg_trigger t
           JOIN pg_class c ON c.oid=t.tgrelid AND c.relnamespace='public'::regnamespace
           JOIN pg_proc p ON p.oid=t.tgfoid
          WHERE c.relname IN ('opportunity_applications','opportunity_offers')
            AND t.tgisinternal = false
          ORDER BY c.relname, t.tgname`,
      );
      const names = q.rows.map((r) => `${r.proname}/${r.tgenabled}`);
      expect(names).toContain("opportunity_applications_update_guard/O");
      expect(names).toContain("opportunity_offers_guard/O");
    });

    it("B7: partial unique index enforces one accepted offer per application", async () => {
      const q = await pool.query(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname='public' AND indexname='opportunity_offers_one_accepted_per_app_uidx'`,
      );
      expect(q.rows.length).toBe(1);
      expect(q.rows[0].indexdef).toMatch(/UNIQUE/i);
      expect(q.rows[0].indexdef).toMatch(/status = 'accepted'/);
      expect(q.rows[0].indexdef).toMatch(/\(application_id\)/);
    });

    it("B8: GUC spoofing does not bypass the bypass helper for authenticated", async () => {
      // Guess a token as an authenticated caller.
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      await c.query("BEGIN");
      await c.query("SET LOCAL role authenticated");
      await c.query(`SET LOCAL "request.jwt.claim.sub" = '${ids.driverA}'`);
      await c.query(`SET LOCAL "app.workflow_bypass_token" = '${randomUUID()}'`);
      // authenticated cannot call the helper at all — 42501.
      let code = "";
      try {
        await c.query(`SELECT public._m2_workflow_bypass_active()`);
      } catch (e) {
        code = (e as { code?: string }).code ?? "";
      }
      await c.query("ROLLBACK").catch(() => {});
      await c.end().catch(() => {});
      expect(code).toBe("42501");
    });

    // --------------------------------------------------------------------
    // C. Runtime authorization matrix
    // --------------------------------------------------------------------
    it("C1: anonymous cannot execute workflow RPCs", async () => {
      const rpcs: Array<[string, unknown[]]> = [
        ["public.transition_opportunity_application($1::uuid,$2::text,NULL)", [randomUUID(), "viewed"]],
        ["public.accept_opportunity_offer($1::uuid)", [randomUUID()]],
        ["public.decline_opportunity_offer($1::uuid,NULL)", [randomUUID()]],
        ["public.cancel_opportunity_offer($1::uuid,NULL)", [randomUUID()]],
        ["public.withdraw_opportunity_application($1::uuid)", [randomUUID()]],
        ["public.complete_hiring($1::uuid)", [randomUUID()]],
      ];
      for (const [sql, args] of rpcs) {
        const c = new pg.Client({ connectionString: url });
        await c.connect();
        let code = "";
        try {
          await c.query("BEGIN");
          await c.query("SET LOCAL role anon");
          await c.query(`SELECT * FROM ${sql}`, args);
        } catch (e) {
          code = (e as { code?: string }).code ?? "";
        } finally {
          await c.query("ROLLBACK").catch(() => {});
          await c.end().catch(() => {});
        }
        expect(code, `anon denied for ${sql}`).toBe("42501");
      }
    });

    it("C2: foreign recruiter gets 'not authorized' identical to a random nonexistent id (no state disclosure)", async () => {
      const drv = await mintDriver(pool);
      const appId = await submitApply(url, drv, ids.opportunity);
      await advanceToInterviewing(url, ids.recruiterUser, appId);
      const offerId = await saveDraft(url, ids.recruiterUser, appId);
      const sentRes = await sendOffer(url, ids.recruiterUser, offerId);
      expect(sentRes.result_code).toBe("offer_sent");

      // Foreign recruiter tries to send an offer that exists but belongs to another recruiter.
      const c1 = await newAuthClient(url, ids.foreignRecruiterUser);
      let foreignMsg = "";
      try {
        await c1.query(
          `SELECT * FROM public.send_opportunity_offer($1::uuid, (now() + interval '2 days')::timestamptz)`,
          [offerId],
        );
      } catch (e) {
        foreignMsg = (e as Error).message;
      }
      await c1.query("ROLLBACK").catch(() => {});
      await c1.end().catch(() => {});

      // Foreign recruiter with a random nonexistent id.
      const c2 = await newAuthClient(url, ids.foreignRecruiterUser);
      let nonexistMsg = "";
      try {
        await c2.query(
          `SELECT * FROM public.send_opportunity_offer($1::uuid, (now() + interval '2 days')::timestamptz)`,
          [randomUUID()],
        );
      } catch (e) {
        nonexistMsg = (e as Error).message;
      }
      await c2.query("ROLLBACK").catch(() => {});
      await c2.end().catch(() => {});

      expect(foreignMsg).toContain("not authorized");
      expect(nonexistMsg).toContain("not authorized");
      expect(foreignMsg).toBe(nonexistMsg);
    });

    it("C3: suspended recruiter denied 'recruiter not eligible'", async () => {
      const drv = await mintDriver(pool);
      const appId = await submitApply(url, drv, ids.suspendedOpportunity);
      // Now suspend the recruiter (was 'active' at seed so the driver could submit).
      await pool.query(
        `UPDATE public.recruiter_profiles SET status='suspended' WHERE id=$1`,
        [ids.suspendedRecruiterProfile],
      );
      const c = await newAuthClient(url, ids.suspendedRecruiterUser);
      let msg = "";
      let code = "";
      try {
        await c.query(
          `SELECT * FROM public.transition_opportunity_application($1::uuid,'viewed',NULL)`,
          [appId],
        );
      } catch (e) {
        msg = (e as Error).message;
        code = (e as { code?: string }).code ?? "";
      }
      await c.query("ROLLBACK").catch(() => {});
      await c.end().catch(() => {});
      // Restore for other tests.
      await pool.query(
        `UPDATE public.recruiter_profiles SET status='active' WHERE id=$1`,
        [ids.suspendedRecruiterProfile],
      );
      expect(code).toBe("42501");
      expect(msg).toContain("recruiter not eligible");
    });

    it("C4: inquiry (request_info) cannot enter formal offer/hiring workflow", async () => {
      const drv = await mintDriver(pool);
      const c1 = await newAuthClient(url, drv);
      const key = `q-${randomUUID()}`;
      const r = await c1.query(
        `SELECT * FROM public.submit_request_info($1::uuid,$2::text,'Question?','phone',false)`,
        [ids.opportunity, key],
      );
      expect(r.rows[0].result_code).toBe("created");
      const inquiryId = r.rows[0].application_id as string;
      await c1.query("COMMIT");
      await c1.end();

      const c2 = await newAuthClient(url, ids.recruiterUser);
      let code = "";
      try {
        await c2.query(
          `SELECT * FROM public.save_opportunity_offer_draft($1::uuid,'Pay',1000,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
          [inquiryId],
        );
      } catch (e) {
        code = (e as { code?: string }).code ?? "";
      }
      await c2.query("ROLLBACK").catch(() => {});
      await c2.end().catch(() => {});
      expect(code).toBe("42501");
    });

    it("C5: foreign driver cannot accept another driver's offer", async () => {
      const drv = await mintDriver(pool);
      const other = await mintDriver(pool);
      const appId = await submitApply(url, drv, ids.opportunity);
      await advanceToInterviewing(url, ids.recruiterUser, appId);
      const offerId = await saveDraft(url, ids.recruiterUser, appId);
      await sendOffer(url, ids.recruiterUser, offerId);

      const c = await newAuthClient(url, other);
      let msg = "";
      try {
        await c.query(`SELECT * FROM public.accept_opportunity_offer($1::uuid)`, [offerId]);
      } catch (e) {
        msg = (e as Error).message;
      }
      await c.query("ROLLBACK").catch(() => {});
      await c.end().catch(() => {});
      expect(msg).toContain("not authorized");
    });


    // --------------------------------------------------------------------
    // D. True-concurrency races (independent pg clients)
    // --------------------------------------------------------------------

    async function setupSentOffer(driver: string): Promise<{ appId: string; offerId: string }> {
      const appId = await submitApply(url, driver, ids.opportunity);
      await advanceToInterviewing(url, ids.recruiterUser, appId);
      const offerId = await saveDraft(url, ids.recruiterUser, appId);
      await sendOffer(url, ids.recruiterUser, offerId);
      return { appId, offerId };
    }

    async function setupDraftOffer(driver: string): Promise<{ appId: string; offerId: string }> {
      const appId = await submitApply(url, driver, ids.opportunity);
      await advanceToInterviewing(url, ids.recruiterUser, appId);
      const offerId = await saveDraft(url, ids.recruiterUser, appId);
      return { appId, offerId };
    }

    async function raceAsRecruiter(
      offerId: string,
      body: string,
    ): Promise<Array<{ ok: boolean; row?: Record<string, unknown>; err?: string }>> {
      const a = new pg.Client({ connectionString: url, statement_timeout: 30_000 });
      const b = new pg.Client({ connectionString: url, statement_timeout: 30_000 });
      await Promise.all([a.connect(), b.connect()]);
      const setup = async (c: pg.Client) => {
        await c.query("BEGIN");
        await c.query("SET LOCAL role authenticated");
        await c.query(`SET LOCAL "request.jwt.claim.sub" = '${ids.recruiterUser}'`);
      };
      await Promise.all([setup(a), setup(b)]);
      const call = (c: pg.Client) =>
        c.query(body, [offerId])
          .then((r) => ({ ok: true, row: r.rows[0] as Record<string, unknown> }))
          .catch((e: Error) => ({ ok: false, err: e.message }));
      const [ra, rb] = await Promise.all([call(a), call(b)]);
      await Promise.all([
        (ra.ok ? a.query("COMMIT") : a.query("ROLLBACK")).catch(() => {}),
        (rb.ok ? b.query("COMMIT") : b.query("ROLLBACK")).catch(() => {}),
      ]);
      await Promise.all([a.end().catch(() => {}), b.end().catch(() => {})]);
      return [ra, rb];
    }

    async function raceAsDrivers(
      offerId: string,
      driverA: string,
      driverB: string,
      bodyA: string,
      bodyB: string,
    ): Promise<Array<{ ok: boolean; row?: Record<string, unknown>; err?: string }>> {
      const a = new pg.Client({ connectionString: url, statement_timeout: 30_000 });
      const b = new pg.Client({ connectionString: url, statement_timeout: 30_000 });
      await Promise.all([a.connect(), b.connect()]);
      const setup = async (c: pg.Client, uid: string) => {
        await c.query("BEGIN");
        await c.query("SET LOCAL role authenticated");
        await c.query(`SET LOCAL "request.jwt.claim.sub" = '${uid}'`);
      };
      await Promise.all([setup(a, driverA), setup(b, driverB)]);
      const call = (c: pg.Client, body: string) =>
        c.query(body, [offerId])
          .then((r) => ({ ok: true, row: r.rows[0] as Record<string, unknown> }))
          .catch((e: Error) => ({ ok: false, err: e.message }));
      const [ra, rb] = await Promise.all([call(a, bodyA), call(b, bodyB)]);
      await Promise.all([
        (ra.ok ? a.query("COMMIT") : a.query("ROLLBACK")).catch(() => {}),
        (rb.ok ? b.query("COMMIT") : b.query("ROLLBACK")).catch(() => {}),
      ]);
      await Promise.all([a.end().catch(() => {}), b.end().catch(() => {})]);
      return [ra, rb];
    }

    it("D1 race: send draft offer concurrently twice — one offer_sent, one already_sent", async () => {
      const { appId, offerId } = await setupDraftOffer(ids.driverA);
      // Re-seed a fresh driver because setupDraftOffer already consumed driverA.
      // Actually driverA is per-test unique via newIds… but ids are shared.
      // Use driverF for isolation.
      void appId;
      const { offerId: offerId2, appId: appId2 } = await setupDraftOffer(ids.driverF);
      const [ra, rb] = await raceAsRecruiter(
        offerId2,
        `SELECT * FROM public.send_opportunity_offer($1::uuid, (now() + interval '2 days')::timestamptz)`,
      );
      const codes = [ra, rb].filter((x) => x.ok).map((x) => x.row!.result_code as string).sort();
      expect(codes).toEqual(["already_sent", "offer_sent"]);
      const off = await pool.query(
        `SELECT status FROM public.opportunity_offers WHERE id=$1`,
        [offerId2],
      );
      expect(off.rows[0].status).toBe("sent");
      const app = await pool.query(
        `SELECT status FROM public.opportunity_applications WHERE id=$1`,
        [appId2],
      );
      expect(app.rows[0].status).toBe("offer_sent");
      const ev = await pool.query(
        `SELECT count(*)::int AS n FROM public.application_events
          WHERE application_id=$1 AND event_type='offer_sent'`,
        [appId2],
      );
      expect(ev.rows[0].n).toBe(1);
      const notif = await pool.query(
        `SELECT count(*)::int AS n FROM public.notifications
          WHERE type='offer_sent' AND payload->>'application_id'=$1`,
        [appId2],
      );
      expect(notif.rows[0].n).toBe(1);
      // Unused offerId path retained above only to avoid TS unused warning.
      void offerId;
    });

    it("D2 race: accept same sent offer concurrently as driver from two connections — one accepted, one already_accepted", async () => {
      const { appId, offerId } = await setupSentOffer(ids.driverB);
      // Both connections use the same driver (driverB) — the driver row lock serializes.
      const [ra, rb] = await raceAsDrivers(
        offerId,
        ids.driverB, ids.driverB,
        `SELECT * FROM public.accept_opportunity_offer($1::uuid)`,
        `SELECT * FROM public.accept_opportunity_offer($1::uuid)`,
      );
      const codes = [ra, rb].filter((x) => x.ok).map((x) => x.row!.result_code as string).sort();
      expect(codes).toEqual(["already_accepted", "offer_accepted"]);
      const off = await pool.query(`SELECT status FROM public.opportunity_offers WHERE id=$1`, [offerId]);
      expect(off.rows[0].status).toBe("accepted");
      const app = await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId]);
      expect(app.rows[0].status).toBe("onboarding");
      const ev = await pool.query(
        `SELECT count(*)::int AS n FROM public.application_events WHERE application_id=$1 AND event_type='offer_accepted'`,
        [appId],
      );
      expect(ev.rows[0].n).toBe(1);
      const notif = await pool.query(
        `SELECT count(*)::int AS n FROM public.notifications WHERE type='offer_accepted' AND payload->>'application_id'=$1`,
        [appId],
      );
      expect(notif.rows[0].n).toBe(1);
    });

    it("D3 race: accept vs decline on same sent offer — exactly one terminal winner, never both", async () => {
      const { appId, offerId } = await setupSentOffer(ids.driverC);
      const [ra, rb] = await raceAsDrivers(
        offerId,
        ids.driverC, ids.driverC,
        `SELECT * FROM public.accept_opportunity_offer($1::uuid)`,
        `SELECT * FROM public.decline_opportunity_offer($1::uuid, NULL)`,
      );
      const okRows = [ra, rb].filter((x) => x.ok).map((x) => x.row!);
      // Both should commit — the loser gets an error like "not available to accept/decline".
      // Only one should have accepted or declined the offer; the other must fail.
      const finalStatus = (await pool.query(
        `SELECT status FROM public.opportunity_offers WHERE id=$1`,
        [offerId],
      )).rows[0].status;
      expect(["accepted", "declined"]).toContain(finalStatus);
      const app = await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId]);
      if (finalStatus === "accepted") {
        expect(app.rows[0].status).toBe("onboarding");
      } else {
        // decline does not change application status
        expect(app.rows[0].status).toBe("offer_sent");
      }
      // Exactly one of the two calls should have committed a terminal action.
      const successful = okRows.filter((r) => r.result_code === "offer_accepted" || r.result_code === "offer_declined");
      expect(successful.length).toBe(1);
    });

    it("D4 race: complete_hiring concurrently — one hiring_completed, one already_hired", async () => {
      const { appId, offerId } = await setupSentOffer(ids.driverD);
      // Driver accepts.
      const acc = await newAuthClient(url, ids.driverD);
      await acc.query(`SELECT * FROM public.accept_opportunity_offer($1::uuid)`, [offerId]);
      await acc.query("COMMIT");
      await acc.end();

      // Seed contract + uploaded version approved for this app.
      const contract = await pool.query(
        `INSERT INTO public.contracts(application_id,status,updated_at) VALUES($1,'approved',now()) RETURNING id`,
        [appId],
      );
      const cid = contract.rows[0].id as string;
      const cv = await pool.query(
        `INSERT INTO public.contract_versions(contract_id,upload_status) VALUES($1,'uploaded') RETURNING id`,
        [cid],
      );
      await pool.query(`UPDATE public.contracts SET current_version_id=$1 WHERE id=$2`, [cv.rows[0].id, cid]);

      // Race two recruiter complete_hiring calls.
      const a = new pg.Client({ connectionString: url });
      const b = new pg.Client({ connectionString: url });
      await Promise.all([a.connect(), b.connect()]);
      const setup = async (c: pg.Client) => {
        await c.query("BEGIN");
        await c.query("SET LOCAL role authenticated");
        await c.query(`SET LOCAL "request.jwt.claim.sub" = '${ids.recruiterUser}'`);
      };
      await Promise.all([setup(a), setup(b)]);
      const call = (c: pg.Client) =>
        c.query(`SELECT * FROM public.complete_hiring($1::uuid)`, [appId])
          .then((r) => ({ ok: true, code: r.rows[0].result_code as string }))
          .catch((e: Error) => ({ ok: false, err: e.message }));
      const [ra, rb] = await Promise.all([call(a), call(b)]);
      await Promise.all([
        (ra.ok ? a.query("COMMIT") : a.query("ROLLBACK")).catch(() => {}),
        (rb.ok ? b.query("COMMIT") : b.query("ROLLBACK")).catch(() => {}),
      ]);
      await Promise.all([a.end().catch(() => {}), b.end().catch(() => {})]);

      const codes = [ra, rb].filter((x) => x.ok).map((x) => (x as { code: string }).code).sort();
      expect(codes).toEqual(["already_hired", "hiring_completed"]);
      const app = await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId]);
      expect(app.rows[0].status).toBe("hired");
      const ev = await pool.query(
        `SELECT count(*)::int AS n FROM public.application_events WHERE application_id=$1 AND event_type='hiring_completed'`,
        [appId],
      );
      expect(ev.rows[0].n).toBe(1);
      const notif = await pool.query(
        `SELECT count(*)::int AS n FROM public.notifications
          WHERE user_id=$1 AND type='hiring_completed' AND payload->>'application_id'=$2`,
        [ids.driverD, appId],
      );
      expect(notif.rows[0].n).toBe(1);
    });

    it("D5 race: two concurrent expiration sweeps use SKIP LOCKED — each expired offer processed exactly once", async () => {
      // Seed 3 sent offers, force expires_at into the past via service_role bypass.
      const drivers = [ids.driverA, ids.driverB, ids.driverC];
      const created: string[] = [];
      for (let i = 0; i < 3; i++) {
        // Each driver already used above may already have apps — use a fresh app on foreignOpportunity? no,
        // that recruiter is different. Use fresh drivers here.
        const uid = randomUUID();
        await pool.query(`INSERT INTO auth.users(id,email) VALUES ($1, $2)`, [uid, `sweep-${i}@t`]);
        await pool.query(
          `INSERT INTO public.driver_opportunity_profiles(user_id,full_name,city,state,cdl_class,years_experience,
             preferred_driver_type,preferred_route_type,preferred_home_time,available_start_date,profile_completed,phone,email)
           VALUES($1,'D','Austin','TX','A',5,'company','regional','weekends','2026-08-01',true,'555','x@t')`,
          [uid],
        );
        const appId = await submitApply(url, uid, ids.opportunity);
        await advanceToInterviewing(url, ids.recruiterUser, appId);
        const offerId = await saveDraft(url, ids.recruiterUser, appId);
        await sendOffer(url, ids.recruiterUser, offerId);
        // Force expiration into the past (bypass the immutable check by disabling the trigger briefly).
        await pool.query(`ALTER TABLE public.opportunity_offers DISABLE TRIGGER trg_opportunity_offers_guard`);
        await pool.query(
          `UPDATE public.opportunity_offers SET expires_at = now() - interval '1 minute' WHERE id=$1`,
          [offerId],
        );
        await pool.query(`ALTER TABLE public.opportunity_offers ENABLE TRIGGER trg_opportunity_offers_guard`);
        created.push(offerId);
        void drivers;
      }
      const a = new pg.Client({ connectionString: url });
      const b = new pg.Client({ connectionString: url });
      await Promise.all([a.connect(), b.connect()]);
      const setup = async (c: pg.Client) => {
        await c.query("BEGIN");
        await c.query("SET LOCAL role service_role");
      };
      await Promise.all([setup(a), setup(b)]);
      const call = (c: pg.Client) =>
        c.query(`SELECT public.expire_opportunity_offers(500) AS n`).then((r) => r.rows[0].n as number);
      const [na, nb] = await Promise.all([call(a), call(b)]);
      await Promise.all([a.query("COMMIT"), b.query("COMMIT")]);
      await Promise.all([a.end(), b.end()]);
      expect(na + nb).toBe(3);
      const rows = await pool.query(
        `SELECT status FROM public.opportunity_offers WHERE id = ANY($1::uuid[])`,
        [created],
      );
      for (const r of rows.rows) expect(r.status).toBe("expired");
      // exactly one offer_expired event per offer
      for (const oid of created) {
        const ev = await pool.query(
          `SELECT count(*)::int AS n FROM public.application_events
            WHERE event_type='offer_expired' AND metadata->>'offer_id'=$1`,
          [oid],
        );
        expect(ev.rows[0].n).toBe(1);
      }
    });

    // --------------------------------------------------------------------
    // E. Forced rollback proof
    // --------------------------------------------------------------------
    it("E: driver acceptance rolled back leaves offer sent, application offer_sent, and no events/notifications", async () => {
      const uid = randomUUID();
      await pool.query(`INSERT INTO auth.users(id,email) VALUES ($1, 'rb@t')`, [uid]);
      await pool.query(
        `INSERT INTO public.driver_opportunity_profiles(user_id,full_name,city,state,cdl_class,years_experience,
           preferred_driver_type,preferred_route_type,preferred_home_time,available_start_date,profile_completed,phone,email)
         VALUES($1,'D','Austin','TX','A',5,'company','regional','weekends','2026-08-01',true,'555','x@t')`,
        [uid],
      );
      const { appId, offerId } = await setupSentOffer(uid);

      const before = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM public.application_events WHERE application_id=$1 AND event_type='offer_accepted') AS ev,
           (SELECT count(*)::int FROM public.notifications WHERE type='offer_accepted' AND payload->>'application_id'=$1) AS notif`,
        [appId],
      );

      const c = await newAuthClient(url, uid);
      const r = await c.query(`SELECT * FROM public.accept_opportunity_offer($1::uuid)`, [offerId]);
      expect(r.rows[0].result_code).toBe("offer_accepted");
      await c.query("ROLLBACK");
      await c.end();

      const off = await pool.query(`SELECT status FROM public.opportunity_offers WHERE id=$1`, [offerId]);
      expect(off.rows[0].status).toBe("sent");
      const app = await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId]);
      expect(app.rows[0].status).toBe("offer_sent");
      const after = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM public.application_events WHERE application_id=$1 AND event_type='offer_accepted') AS ev,
           (SELECT count(*)::int FROM public.notifications WHERE type='offer_accepted' AND payload->>'application_id'=$1) AS notif`,
        [appId],
      );
      expect(after.rows[0].ev).toBe(before.rows[0].ev);
      expect(after.rows[0].notif).toBe(before.rows[0].notif);
    });
  },
);
