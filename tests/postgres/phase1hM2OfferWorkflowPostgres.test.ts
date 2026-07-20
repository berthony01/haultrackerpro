/**
 * Phase 1H-M2 — Real PostgreSQL 16 offer-workflow gate.
 *
 * Lives OUTSIDE src/ so `bunx vitest run` never picks it up. Runs only
 * via `vitest.phase1h-m2-postgres.config.ts` in the GitHub Actions gate
 * (or locally against real PG16 pointed to by PHASE1H_M2_DATABASE_URL).
 *
 * NEVER SKIPS. The dedicated config exists precisely so this file can
 * fail hard if PHASE1H_M2_DATABASE_URL is absent. A silent skip would
 * contradict the Phase 2B-3 forbidden-marker gate.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DATABASE_URL = process.env.PHASE1H_M2_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "PHASE1H_M2_DATABASE_URL is required for the Phase 1H-M2 real-Postgres 16 gate. " +
      "Do not silently skip: set PHASE1H_M2_DATABASE_URL to a real Postgres 16 instance.",
  );
}
const URL_STR: string = DATABASE_URL;

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

// Supabase-compatible fixture. Loads on top of an empty public+auth schema.
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

// ---------------------------------------------------------------------
// Test-scoped identity + helpers
// ---------------------------------------------------------------------

interface Ids {
  recruiterUser: string;
  recruiterProfile: string;
  opportunity: string;
  foreignRecruiterUser: string;
  foreignRecruiterProfile: string;
  foreignOpportunity: string;
  incompleteRecruiterUser: string;
  incompleteRecruiterProfile: string;
  incompleteOpportunity: string;
  suspendedRecruiterUser: string;
  suspendedRecruiterProfile: string;
  suspendedOpportunity: string;
}

function newIds(): Ids {
  return {
    recruiterUser: randomUUID(),
    recruiterProfile: randomUUID(),
    opportunity: randomUUID(),
    foreignRecruiterUser: randomUUID(),
    foreignRecruiterProfile: randomUUID(),
    foreignOpportunity: randomUUID(),
    incompleteRecruiterUser: randomUUID(),
    incompleteRecruiterProfile: randomUUID(),
    incompleteOpportunity: randomUUID(),
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
        ($1,'r@t'),($2,'fr@t'),($3,'ir@t'),($4,'sr@t')`,
      [ids.recruiterUser, ids.foreignRecruiterUser, ids.incompleteRecruiterUser, ids.suspendedRecruiterUser],
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
         ($5,$6,'Reg','Inc','Dallas','TX','company','regional','dry_van','cpm',0.62,1800,2800,'active','approved'),
         ($7,$8,'Reg','Susp','Dallas','TX','company','regional','dry_van','cpm',0.62,1800,2800,'active','approved')`,
      [
        ids.opportunity, ids.recruiterProfile,
        ids.foreignOpportunity, ids.foreignRecruiterProfile,
        ids.incompleteOpportunity, ids.incompleteRecruiterProfile,
        ids.suspendedOpportunity, ids.suspendedRecruiterProfile,
      ],
    );
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

async function newAuthClient(url: string, uid: string, role: "authenticated" | "service_role" | "anon" = "authenticated"): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url, statement_timeout: 30_000 });
  await c.connect();
  await c.query("BEGIN");
  await c.query(`SET LOCAL role ${role}`);
  if (uid) await c.query(`SET LOCAL "request.jwt.claim.sub" = '${uid}'`);
  return c;
}

async function commitEnd(c: pg.Client) {
  try { await c.query("COMMIT"); } catch { /* noop */ }
  await c.end().catch(() => {});
}
async function rollbackEnd(c: pg.Client) {
  try { await c.query("ROLLBACK"); } catch { /* noop */ }
  await c.end().catch(() => {});
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
  } catch (e) { await rollbackEnd(c); throw e; }
  finally { await c.end().catch(() => {}); }
}

async function advanceToInterviewing(url: string, recruiterUid: string, appId: string) {
  for (const target of ["viewed", "contact_requested", "call_scheduled", "interviewing"]) {
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
    } finally { await c.end().catch(() => {}); }
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
  } finally { await c.end().catch(() => {}); }
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
  } finally { await c.end().catch(() => {}); }
}

/**
 * True synchronization barrier: each competitor opens its own connection and
 * transaction, sets its role + JWT, signals ready, and then all release
 * simultaneously when a shared JS-level start-promise resolves.
 *
 * Do NOT serialize both operations through a single connection. Each competitor
 * commits or rolls back its OWN transaction and closes its OWN client.
 */
interface RaceOutcome { ok: boolean; row?: Record<string, unknown>; err?: string; code?: string; }
interface Runner { uid: string; role?: "authenticated" | "service_role"; sql: string; params?: unknown[]; }

async function barrierRace(url: string, runners: Runner[]): Promise<RaceOutcome[]> {
  const clients: pg.Client[] = [];
  for (const r of runners) {
    const c = new pg.Client({ connectionString: url, statement_timeout: 30_000 });
    await c.connect();
    await c.query("BEGIN");
    await c.query(`SET LOCAL role ${r.role ?? "authenticated"}`);
    if (r.uid) await c.query(`SET LOCAL "request.jwt.claim.sub" = '${r.uid}'`);
    clients.push(c);
  }
  const readyResolvers: Array<() => void> = [];
  const readyPromises = runners.map(() => new Promise<void>((res) => readyResolvers.push(res)));
  let startResolve!: () => void;
  const startPromise = new Promise<void>((res) => { startResolve = res; });
  const running = runners.map((r, i) => (async (): Promise<RaceOutcome> => {
    const c = clients[i]!;
    readyResolvers[i]!();
    await startPromise;
    try {
      const res = await c.query(r.sql, r.params ?? []);
      await c.query("COMMIT");
      return { ok: true, row: res.rows[0] as Record<string, unknown> };
    } catch (e) {
      const err = e as { message?: string; code?: string };
      await c.query("ROLLBACK").catch(() => {});
      return { ok: false, err: err.message, code: err.code };
    } finally { await c.end().catch(() => {}); }
  })());
  await Promise.all(readyPromises);
  startResolve();
  return Promise.all(running);
}

// ---------------------------------------------------------------------

describe("Phase 1H-M2 — real Postgres 16 offer workflow gate", () => {
  let pool: pg.Pool;
  const url: string = URL_STR;
  let ids: Ids;
  let expectedOwner: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 16 });
    const c = await pool.connect();
    try {
      await c.query(`DROP SCHEMA IF EXISTS public CASCADE`);
      await c.query(`DROP SCHEMA IF EXISTS auth CASCADE`);
      await c.query(`CREATE SCHEMA public`);
      await c.query(BOOTSTRAP_SQL);
      await c.query(readFileSync(M1_PATH, "utf8"));
      await c.query(readFileSync(M2_PATH, "utf8"));
      const who = await c.query(`SELECT current_user AS u`);
      expectedOwner = who.rows[0].u as string;
    } finally { c.release(); }
    ids = newIds();
    await seed(pool, ids);
  }, 180_000);

  afterAll(async () => { await pool?.end(); });

  // ==================================================================
  // A. Server identity
  // ==================================================================
  it("A: server_version_num is in the 16.x range", async () => {
    const { rows } = await pool.query(`SELECT current_setting('server_version_num')::int AS v`);
    expect(rows[0].v).toBeGreaterThanOrEqual(160000);
    expect(rows[0].v).toBeLessThan(170000);
  });

  // ==================================================================
  // B. Catalog + privilege proof
  // ==================================================================

  const M2_ALL_FUNCS = [
    "_m2_workflow_token()",
    "_m2_workflow_bypass_active()",
    "_m2_driver_withdraw_active()",
    "_m2_insert_event_once(uuid,text,uuid,text,uuid,jsonb)",
    "_m2_notify_once(uuid,text,text,text,uuid,uuid,jsonb)",
    "_m2_expire_offer(uuid)",
    "_m2_set_application_status(uuid,text)",
    "_m2_set_application_withdrawn(uuid)",
    "opportunity_applications_update_guard()",
    "opportunity_offers_guard()",
    "transition_opportunity_application(uuid,text,text)",
    "save_opportunity_offer_draft(uuid,text,numeric,text,text,text,date,text,text,text)",
    "send_opportunity_offer(uuid,timestamptz)",
    "accept_opportunity_offer(uuid)",
    "decline_opportunity_offer(uuid,text)",
    "cancel_opportunity_offer(uuid,text)",
    "expire_opportunity_offers(integer)",
    "withdraw_opportunity_application(uuid)",
    "complete_hiring(uuid)",
  ];

  const M2_INTERNAL = [
    "_m2_workflow_token()",
    "_m2_workflow_bypass_active()",
    "_m2_driver_withdraw_active()",
    "_m2_insert_event_once(uuid,text,uuid,text,uuid,jsonb)",
    "_m2_notify_once(uuid,text,text,text,uuid,uuid,jsonb)",
    "_m2_expire_offer(uuid)",
    "_m2_set_application_status(uuid,text)",
    "_m2_set_application_withdrawn(uuid)",
  ];

  const M2_PUBLIC_RPCS = [
    "transition_opportunity_application(uuid,text,text)",
    "save_opportunity_offer_draft(uuid,text,numeric,text,text,text,date,text,text,text)",
    "send_opportunity_offer(uuid,timestamptz)",
    "accept_opportunity_offer(uuid)",
    "decline_opportunity_offer(uuid,text)",
    "cancel_opportunity_offer(uuid,text)",
    "withdraw_opportunity_application(uuid)",
    "complete_hiring(uuid)",
  ];

  it("B1: every M2 SECURITY DEFINER function has the same owner and no unexpected owner exists", async () => {
    for (const sig of M2_ALL_FUNCS) {
      const q = await pool.query(
        `SELECT r.rolname AS owner
           FROM pg_proc p
           JOIN pg_roles r ON r.oid = p.proowner
          WHERE p.oid = ('public.' || $1)::regprocedure`,
        [sig],
      );
      expect(q.rows.length, `${sig} exists`).toBe(1);
      expect(q.rows[0].owner, `${sig} owner`).toBe(expectedOwner);
    }
    // No unexpected owner for any function attached to _m2_* prefix or the guards.
    const strays = await pool.query(
      `SELECT p.proname, r.rolname AS owner
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid=p.pronamespace
         JOIN pg_roles r ON r.oid=p.proowner
        WHERE n.nspname='public'
          AND (p.proname LIKE '_m2_%'
               OR p.proname IN ('opportunity_applications_update_guard','opportunity_offers_guard',
                                'transition_opportunity_application','save_opportunity_offer_draft',
                                'send_opportunity_offer','accept_opportunity_offer',
                                'decline_opportunity_offer','cancel_opportunity_offer',
                                'expire_opportunity_offers','withdraw_opportunity_application',
                                'complete_hiring'))
          AND r.rolname <> $1`,
      [expectedOwner],
    );
    expect(strays.rows).toEqual([]);
  });

  it("B2: every M2 SECURITY DEFINER function pins the exact safe search_path=public", async () => {
    for (const sig of M2_ALL_FUNCS) {
      const q = await pool.query(
        `SELECT p.prosecdef, p.proconfig
           FROM pg_proc p WHERE p.oid = ('public.' || $1)::regprocedure`,
        [sig],
      );
      expect(q.rows.length, `${sig} exists`).toBe(1);
      expect(q.rows[0].prosecdef, `${sig} SECURITY DEFINER`).toBe(true);
      const cfg = (q.rows[0].proconfig as string[] | null) ?? [];
      // Must contain the exact literal search_path=public. Reject $user or any other schema.
      const sp = cfg.find((s) => s.toLowerCase().startsWith("search_path="));
      expect(sp, `${sig} sets search_path`).toBeDefined();
      // Normalize: PostgreSQL stores this as literally `search_path=public`.
      expect(sp, `${sig} exact search_path`).toBe("search_path=public");
      // Reject any attacker-controlled or unexpected value.
      expect(sp).not.toMatch(/\$user/i);
    }
  });

  it("B3: internal helpers deny PUBLIC/anon/authenticated via real ACL, permit service_role", async () => {
    for (const sig of M2_INTERNAL) {
      const acl = await pool.query(
        `SELECT
           has_function_privilege('anon',           'public.' || $1, 'EXECUTE') AS anon_x,
           has_function_privilege('authenticated',  'public.' || $1, 'EXECUTE') AS auth_x,
           has_function_privilege('service_role',   'public.' || $1, 'EXECUTE') AS svc_x`,
        [sig],
      );
      expect(acl.rows[0].anon_x, `${sig} denies anon`).toBe(false);
      expect(acl.rows[0].auth_x, `${sig} denies authenticated`).toBe(false);
      expect(acl.rows[0].svc_x,  `${sig} grants service_role`).toBe(true);

      // Prove no PUBLIC grantee via aclexplode. PostgreSQL represents PUBLIC as
      // grantee OID 0 (rolname is NULL after left-join to pg_roles).
      const acle = await pool.query(
        `SELECT bool_or(privilege_type='EXECUTE') AS pub_x
           FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
           LEFT JOIN pg_roles r ON r.oid = a.grantee
          WHERE p.oid = ('public.' || $1)::regprocedure
            AND a.grantee = 0`,
        [sig],
      );
      const pubX = acle.rows[0]?.pub_x;
      expect(pubX === true, `${sig} must not grant PUBLIC (aclexplode)`).toBe(false);
    }
  });

  it("B4: public workflow RPCs deny anon+PUBLIC via ACL and grant authenticated+service_role", async () => {
    for (const sig of M2_PUBLIC_RPCS) {
      const acl = await pool.query(
        `SELECT
           has_function_privilege('anon',           'public.' || $1, 'EXECUTE') AS anon_x,
           has_function_privilege('authenticated',  'public.' || $1, 'EXECUTE') AS auth_x,
           has_function_privilege('service_role',   'public.' || $1, 'EXECUTE') AS svc_x`,
        [sig],
      );
      expect(acl.rows[0].anon_x, `${sig} anon`).toBe(false);
      expect(acl.rows[0].auth_x, `${sig} authenticated`).toBe(true);
      expect(acl.rows[0].svc_x,  `${sig} service_role`).toBe(true);

      const acle = await pool.query(
        `SELECT bool_or(privilege_type='EXECUTE') AS pub_x
           FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
          WHERE p.oid = ('public.' || $1)::regprocedure AND a.grantee = 0`,
        [sig],
      );
      const pubX = acle.rows[0]?.pub_x;
      expect(pubX === true, `${sig} must not grant PUBLIC`).toBe(false);
    }
  });

  it("B5: expire_opportunity_offers is service_role only (real catalog ACL)", async () => {
    const sig = "expire_opportunity_offers(integer)";
    const acl = await pool.query(
      `SELECT
         has_function_privilege('anon',           'public.' || $1, 'EXECUTE') AS a,
         has_function_privilege('authenticated',  'public.' || $1, 'EXECUTE') AS b,
         has_function_privilege('service_role',   'public.' || $1, 'EXECUTE') AS s`,
      [sig],
    );
    expect(acl.rows[0].a).toBe(false);
    expect(acl.rows[0].b).toBe(false);
    expect(acl.rows[0].s).toBe(true);
    const acle = await pool.query(
      `SELECT bool_or(privilege_type='EXECUTE') AS pub_x
         FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.oid = ('public.' || $1)::regprocedure AND a.grantee = 0`,
      [sig],
    );
    expect(acle.rows[0]?.pub_x === true).toBe(false);
  });

  it("B6: _m2_workflow_secret table denies PUBLIC/anon/authenticated via has_table_privilege AND relacl aclexplode", async () => {
    const priv = await pool.query(
      `SELECT
         has_table_privilege('anon',          'public._m2_workflow_secret', 'SELECT') AS anon_s,
         has_table_privilege('authenticated', 'public._m2_workflow_secret', 'SELECT') AS auth_s,
         has_table_privilege('anon',          'public._m2_workflow_secret', 'INSERT,UPDATE,DELETE') AS anon_w,
         has_table_privilege('authenticated', 'public._m2_workflow_secret', 'INSERT,UPDATE,DELETE') AS auth_w`,
    );
    expect(priv.rows[0].anon_s).toBe(false);
    expect(priv.rows[0].auth_s).toBe(false);
    expect(priv.rows[0].anon_w).toBe(false);
    expect(priv.rows[0].auth_w).toBe(false);
    // Ensure PUBLIC has no privilege in relacl (grantee=0).
    const acle = await pool.query(
      `SELECT count(*)::int AS n
         FROM pg_class c, aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
        WHERE c.oid = 'public._m2_workflow_secret'::regclass AND a.grantee = 0`,
    );
    expect(acle.rows[0].n).toBe(0);
  });

  it("B7: anon and authenticated cannot SELECT the secret token at runtime (42501)", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      let code = "";
      try {
        await c.query("BEGIN");
        await c.query(`SET LOCAL role ${role}`);
        await c.query(`SELECT token FROM public._m2_workflow_secret`);
      } catch (e) { code = (e as { code?: string }).code ?? ""; }
      await c.query("ROLLBACK").catch(() => {});
      await c.end().catch(() => {});
      expect(code).toBe("42501");
    }
  });

  it("B8: application + offer guard triggers exist with exact names, target relations, target functions, and enabled state", async () => {
    const q = await pool.query(
      `SELECT t.tgname, c.relname AS target_rel, p.proname AS target_fn, t.tgenabled
         FROM pg_trigger t
         JOIN pg_class c ON c.oid=t.tgrelid
         JOIN pg_namespace nc ON nc.oid=c.relnamespace
         JOIN pg_proc p ON p.oid=t.tgfoid
        WHERE nc.nspname='public'
          AND t.tgisinternal = false
          AND t.tgname IN ('opportunity_applications_update_guard_trigger','trg_opportunity_offers_guard')
        ORDER BY t.tgname`,
    );
    const byName = Object.fromEntries(q.rows.map((r) => [r.tgname, r]));
    expect(byName["opportunity_applications_update_guard_trigger"]).toMatchObject({
      target_rel: "opportunity_applications",
      target_fn: "opportunity_applications_update_guard",
      tgenabled: "O",
    });
    expect(byName["trg_opportunity_offers_guard"]).toMatchObject({
      target_rel: "opportunity_offers",
      target_fn: "opportunity_offers_guard",
      tgenabled: "O",
    });
  });

  it("B9: partial unique index on opportunity_offers enforces one accepted offer per application (pg_index inspection)", async () => {
    // Locate the index row directly in pg_index/pg_class.
    const q = await pool.query(
      `SELECT i.indisunique, i.indpred, c.relname AS index_name, t.relname AS table_name,
              pg_get_expr(i.indpred, i.indrelid) AS pred_expr,
              (SELECT array_agg(a.attname::text ORDER BY k.ord)
                 FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum) AS key_cols
         FROM pg_index i
         JOIN pg_class c ON c.oid=i.indexrelid
         JOIN pg_class t ON t.oid=i.indrelid
        WHERE c.relname='opportunity_offers_one_accepted_per_app_uidx'`,
    );
    expect(q.rows.length).toBe(1);
    const r = q.rows[0];
    expect(r.table_name).toBe("opportunity_offers");
    expect(r.indisunique).toBe(true);
    expect(r.key_cols).toEqual(["application_id"]);
    expect(r.pred_expr).toBeTruthy();
    // Structural: predicate references status='accepted'.
    expect(r.pred_expr.toLowerCase().replace(/\s+/g, "")).toContain("status='accepted'");

    // Positive runtime proof: cannot INSERT two accepted rows for same application.
    const drv = await mintDriver(pool);
    const appId = await submitApply(url, drv, ids.opportunity);
    await advanceToInterviewing(url, ids.recruiterUser, appId);
    // Insert two direct accepted rows (bypassing send path). Second must violate unique.
    const bad = pool.connect().then(async (c) => {
      try {
        await c.query(`ALTER TABLE public.opportunity_offers DISABLE TRIGGER trg_opportunity_offers_guard`);
        await c.query(
          `INSERT INTO public.opportunity_offers
            (application_id,opportunity_id,recruiter_id,driver_user_id,status,sent_at,accepted_at,pay_description,snapshot_version,sent_snapshot,expires_at)
            SELECT $1, a.opportunity_id, a.recruiter_id, a.driver_user_id, 'accepted', now(), now(), 'pay', 1, '{"seed":true}'::jsonb, now()+interval '2 days'
              FROM public.opportunity_applications a WHERE a.id=$1`,
          [appId],
        );
        let dup = "";
        try {
          await c.query(
            `INSERT INTO public.opportunity_offers
              (application_id,opportunity_id,recruiter_id,driver_user_id,status,sent_at,accepted_at,pay_description,snapshot_version,sent_snapshot,expires_at)
              SELECT $1, a.opportunity_id, a.recruiter_id, a.driver_user_id, 'accepted', now(), now(), 'pay', 1, '{"seed":true}'::jsonb, now()+interval '2 days'
                FROM public.opportunity_applications a WHERE a.id=$1`,
            [appId],
          );
        } catch (e) { dup = (e as { code?: string }).code ?? ""; }
        await c.query(`ALTER TABLE public.opportunity_offers ENABLE TRIGGER trg_opportunity_offers_guard`);
        return dup;
      } finally { c.release(); }
    });
    expect(await bad).toBe("23505");
  });

  it("B10: authenticated with forged workflow_bypass_token (varied shapes) cannot bypass application guard", async () => {
    // Create a fresh app in interviewing so a direct set to offer_sent could be attempted.
    const drv = await mintDriver(pool);
    const appId = await submitApply(url, drv, ids.opportunity);
    await advanceToInterviewing(url, ids.recruiterUser, appId);

    const forged = [randomUUID(), "", "true", "1", "not-a-uuid", "null", "'; DROP TABLE users; --"];
    for (const token of forged) {
      // As recruiter, try to set offer_sent directly via UPDATE with a forged token.
      const c = await newAuthClient(url, ids.recruiterUser);
      let code = "";
      try {
        await c.query(`SET LOCAL "app.workflow_bypass_token" = ${pg.escapeLiteral(token)}`);
        await c.query(`UPDATE public.opportunity_applications SET status='offer_sent' WHERE id=$1`, [appId]);
      } catch (e) { code = (e as { code?: string }).code ?? ""; }
      await rollbackEnd(c);
      expect(code, `direct offer_sent update with forged token=${JSON.stringify(token)}`).toBe("42501");

      // Forged withdraw token via service_role (bypasses RLS so the guard is
      // the sole line of defense). JWT claim spoofed as driver, but the token
      // is wrong so _m2_driver_withdraw_active() returns false → guard rejects.
      const c2 = await newAuthClient(url, drv, "service_role");
      await c2.query(`SET LOCAL "request.jwt.claim.sub" = '${drv}'`);
      let code2 = "";
      try {
        await c2.query(`SET LOCAL "app.driver_withdraw_token" = ${pg.escapeLiteral(token)}`);
        await c2.query(`UPDATE public.opportunity_applications SET status='withdrawn' WHERE id=$1`, [appId]);
      } catch (e) { code2 = (e as { code?: string }).code ?? ""; }
      await rollbackEnd(c2);
      expect(code2, `direct withdrawn update with forged token=${JSON.stringify(token)}`).toBe("42501");
    }
  });

  it("B11: authenticated cannot execute any internal helper (real runtime SET ROLE)", async () => {
    const calls = [
      "SELECT public._m2_workflow_token()",
      "SELECT public._m2_workflow_bypass_active()",
      "SELECT public._m2_driver_withdraw_active()",
      "SELECT public._m2_insert_event_once($1::uuid,'system',NULL,'x',NULL,'{}'::jsonb)",
      "SELECT public._m2_notify_once($1::uuid,'x','t','b',NULL,NULL,'{}'::jsonb)",
      "SELECT public._m2_expire_offer($1::uuid)",
      "SELECT public._m2_set_application_status($1::uuid,'viewed')",
      "SELECT public._m2_set_application_withdrawn($1::uuid)",
    ];
    for (const role of ["anon", "authenticated"] as const) {
      for (const sql of calls) {
        const c = new pg.Client({ connectionString: url });
        await c.connect();
        let code = "";
        try {
          await c.query("BEGIN");
          await c.query(`SET LOCAL role ${role}`);
          if (role === "authenticated") await c.query(`SET LOCAL "request.jwt.claim.sub" = '${ids.recruiterUser}'`);
          await c.query(sql, sql.includes("$1") ? [randomUUID()] : []);
        } catch (e) { code = (e as { code?: string }).code ?? ""; }
        await c.query("ROLLBACK").catch(() => {});
        await c.end().catch(() => {});
        expect(code, `${role} ${sql}`).toBe("42501");
      }
    }
  });

  // ==================================================================
  // C. Runtime authorization matrix
  // ==================================================================

  it("C1: anonymous denied for every public workflow RPC (42501)", async () => {
    const rpcs: Array<[string, unknown[]]> = [
      ["public.transition_opportunity_application($1::uuid,$2::text,NULL)", [randomUUID(), "viewed"]],
      ["public.save_opportunity_offer_draft($1::uuid,'p',1000,NULL,NULL,NULL,NULL,NULL,NULL,NULL)", [randomUUID()]],
      ["public.send_opportunity_offer($1::uuid, now() + interval '2 days')", [randomUUID()]],
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
      } catch (e) { code = (e as { code?: string }).code ?? ""; }
      await c.query("ROLLBACK").catch(() => {});
      await c.end().catch(() => {});
      expect(code, `anon ${sql}`).toBe("42501");
    }
  });

  it("C2: linked eligible recruiter — full positive path (transition→draft→send→cancel; and separately hiring)", async () => {
    // Path A: transition→draft→send→cancel
    const drvA = await mintDriver(pool);
    const appA = await submitApply(url, drvA, ids.opportunity);
    await advanceToInterviewing(url, ids.recruiterUser, appA);
    const offA = await saveDraft(url, ids.recruiterUser, appA);
    const sentA = await sendOffer(url, ids.recruiterUser, offA);
    expect(sentA.result_code).toBe("offer_sent");
    const cx = await newAuthClient(url, ids.recruiterUser);
    const cRes = await cx.query(
      `SELECT * FROM public.cancel_opportunity_offer($1::uuid, 'oops')`,
      [offA],
    );
    await commitEnd(cx);
    expect(cRes.rows[0].result_code).toBe("offer_canceled");

    // Path B: hiring
    const drvB = await mintDriver(pool);
    const appB = await submitApply(url, drvB, ids.opportunity);
    await advanceToInterviewing(url, ids.recruiterUser, appB);
    const offB = await saveDraft(url, ids.recruiterUser, appB);
    await sendOffer(url, ids.recruiterUser, offB);
    const dc = await newAuthClient(url, drvB);
    await dc.query(`SELECT * FROM public.accept_opportunity_offer($1::uuid)`, [offB]);
    await commitEnd(dc);
    const contract = await pool.query(
      `INSERT INTO public.contracts(application_id,status) VALUES($1,'approved') RETURNING id`, [appB],
    );
    const cid = contract.rows[0].id as string;
    const cv = await pool.query(
      `INSERT INTO public.contract_versions(contract_id,upload_status) VALUES($1,'uploaded') RETURNING id`, [cid],
    );
    await pool.query(`UPDATE public.contracts SET current_version_id=$1 WHERE id=$2`, [cv.rows[0].id, cid]);
    const hc = await newAuthClient(url, ids.recruiterUser);
    const hRes = await hc.query(`SELECT * FROM public.complete_hiring($1::uuid)`, [appB]);
    await commitEnd(hc);
    expect(hRes.rows[0].result_code).toBe("hiring_completed");
    const finalApp = await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appB]);
    expect(finalApp.rows[0].status).toBe("hired");
  });

  it("C3: linked driver — accept / decline / withdraw positive paths on fresh rows", async () => {
    // accept
    const d1 = await mintDriver(pool);
    const a1 = await submitApply(url, d1, ids.opportunity);
    await advanceToInterviewing(url, ids.recruiterUser, a1);
    const o1 = await saveDraft(url, ids.recruiterUser, a1);
    await sendOffer(url, ids.recruiterUser, o1);
    let c = await newAuthClient(url, d1);
    let r = await c.query(`SELECT * FROM public.accept_opportunity_offer($1::uuid)`, [o1]);
    await commitEnd(c);
    expect(r.rows[0].result_code).toBe("offer_accepted");

    // decline
    const d2 = await mintDriver(pool);
    const a2 = await submitApply(url, d2, ids.opportunity);
    await advanceToInterviewing(url, ids.recruiterUser, a2);
    const o2 = await saveDraft(url, ids.recruiterUser, a2);
    await sendOffer(url, ids.recruiterUser, o2);
    c = await newAuthClient(url, d2);
    r = await c.query(`SELECT * FROM public.decline_opportunity_offer($1::uuid, 'nope')`, [o2]);
    await commitEnd(c);
    expect(r.rows[0].result_code).toBe("offer_declined");

    // withdraw
    const d3 = await mintDriver(pool);
    const a3 = await submitApply(url, d3, ids.opportunity);
    c = await newAuthClient(url, d3);
    await c.query(`SELECT * FROM public.withdraw_opportunity_application($1::uuid)`, [a3]);
    await commitEnd(c);
    const st = await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [a3]);
    expect(st.rows[0].status).toBe("withdrawn");
  });

  it("C4: foreign driver denial for accept/decline/withdraw", async () => {
    const owner = await mintDriver(pool);
    const foreign = await mintDriver(pool);
    const appId = await submitApply(url, owner, ids.opportunity);
    await advanceToInterviewing(url, ids.recruiterUser, appId);
    const offerId = await saveDraft(url, ids.recruiterUser, appId);
    await sendOffer(url, ids.recruiterUser, offerId);

    for (const [sql, args] of [
      [`SELECT * FROM public.accept_opportunity_offer($1::uuid)`, [offerId]],
      [`SELECT * FROM public.decline_opportunity_offer($1::uuid,NULL)`, [offerId]],
      [`SELECT * FROM public.withdraw_opportunity_application($1::uuid)`, [appId]],
    ] as Array<[string, unknown[]]>) {
      const c = await newAuthClient(url, foreign);
      let msg = "";
      try { await c.query(sql, args); } catch (e) { msg = (e as Error).message; }
      await rollbackEnd(c);
      expect(msg.toLowerCase()).toContain("not authorized");
    }
  });

  it("C5: foreign recruiter denial with no state disclosure (existing-foreign vs nonexistent match)", async () => {
    const drv = await mintDriver(pool);
    const appId = await submitApply(url, drv, ids.opportunity);
    await advanceToInterviewing(url, ids.recruiterUser, appId);
    const offerId = await saveDraft(url, ids.recruiterUser, appId);
    const sent = await sendOffer(url, ids.recruiterUser, offerId);
    expect(sent.result_code).toBe("offer_sent");

    const c1 = await newAuthClient(url, ids.foreignRecruiterUser);
    let m1 = "";
    try {
      await c1.query(
        `SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '2 days')`, [offerId],
      );
    } catch (e) { m1 = (e as Error).message; }
    await rollbackEnd(c1);

    const c2 = await newAuthClient(url, ids.foreignRecruiterUser);
    let m2 = "";
    try {
      await c2.query(
        `SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '2 days')`, [randomUUID()],
      );
    } catch (e) { m2 = (e as Error).message; }
    await rollbackEnd(c2);
    expect(m1.toLowerCase()).toContain("not authorized");
    expect(m2.toLowerCase()).toContain("not authorized");
    expect(m1).toBe(m2);
  });

  it("C6: inquiry rows (request_info and callback) cannot enter formal transition/offer/hiring workflow", async () => {
    for (const inqType of ["request_info", "callback"] as const) {
      const drv = await mintDriver(pool);
      let inqId: string;
      if (inqType === "request_info") {
        const c = await newAuthClient(url, drv);
        const r = await c.query(
          `SELECT * FROM public.submit_request_info($1::uuid,$2::text,'x','phone',false)`,
          [ids.opportunity, `q-${randomUUID()}`],
        );
        expect(r.rows[0].result_code).toBe("created");
        inqId = r.rows[0].application_id as string;
        await commitEnd(c);
      } else {
        // No callback RPC; insert directly as service_role (BYPASSRLS) to fabricate
        // the row shape. The point of C6 is proving the formal workflow rejects
        // application_type='callback', not the callback-submission path.
        const ins = await pool.query(
          `INSERT INTO public.opportunity_applications
             (opportunity_id, driver_user_id, recruiter_id, application_type, status,
              submission_snapshot, snapshot_version, idempotency_key, preferred_contact_method,
              contact_sharing_consent, is_legacy)
           VALUES ($1,$2,$3,'callback','new','{}'::jsonb,0,$4,'phone',false,true)
           RETURNING id`,
          [ids.opportunity, drv, ids.recruiterProfile, `cb-${randomUUID()}`],
        );
        inqId = ins.rows[0].id as string;
      }

      for (const [sql, args] of [
        [`SELECT * FROM public.transition_opportunity_application($1::uuid,'interviewing',NULL)`, [inqId]],
        [`SELECT * FROM public.save_opportunity_offer_draft($1::uuid,'p',1000,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`, [inqId]],
        [`SELECT * FROM public.complete_hiring($1::uuid)`, [inqId]],
      ] as Array<[string, unknown[]]>) {
        const cc = await newAuthClient(url, ids.recruiterUser);
        let code = "";
        try { await cc.query(sql, args); } catch (e) { code = (e as { code?: string }).code ?? ""; }
        await rollbackEnd(cc);
        expect(code, `${inqType} ${sql}`).toBe("42501");
      }
      const dc = await newAuthClient(url, drv);
      let dcode = "";
      try { await dc.query(`SELECT * FROM public.withdraw_opportunity_application($1::uuid)`, [inqId]); }
      catch (e) { dcode = (e as { code?: string }).code ?? ""; }
      await rollbackEnd(dc);
      expect(dcode, `${inqType} withdraw`).toBe("42501");
    }
  });

  it("C7: recruiter eligibility — direct proof incomplete/suspended cannot manage an existing application", async () => {
    // ---- Direct incomplete-recruiter management denial ----
    // Fixture: create a formal application while the recruiter is complete/eligible
    // (uses the standard opportunity + recruiter fixture), then flip that recruiter
    // to incomplete and prove a recruiter workflow RPC on the EXISTING application
    // is denied with 42501 / 'recruiter not eligible'.
    const drvInc = await mintDriver(pool);
    const appInc = await submitApply(url, drvInc, ids.opportunity);
    const appStatusBefore = (await pool.query(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`, [appInc],
    )).rows[0].status;
    const evBefore = await eventCount(appInc, "application_transitioned");
    // Save current consent state so we can restore after the test.
    const consent = await pool.query(
      `SELECT posting_terms_accepted_at, legacy_terms_grandfathered_at
         FROM public.recruiter_profiles WHERE id=$1`,
      [ids.recruiterProfile],
    );
    try {
      // Make the recruiter INCOMPLETE (clear both eligibility fields).
      await pool.query(
        `UPDATE public.recruiter_profiles
            SET posting_terms_accepted_at=NULL, legacy_terms_grandfathered_at=NULL
          WHERE id=$1`,
        [ids.recruiterProfile],
      );

      const c = await newAuthClient(url, ids.recruiterUser);
      let code = ""; let msg = "";
      try {
        await c.query(
          `SELECT * FROM public.transition_opportunity_application($1::uuid,'viewed',NULL)`,
          [appInc],
        );
      } catch (e) {
        code = (e as { code?: string }).code ?? "";
        msg  = (e as Error).message;
      }
      await rollbackEnd(c);
      expect(code).toBe("42501");
      expect(msg.toLowerCase()).toContain("recruiter not eligible");

      // Application state unchanged; no workflow event emitted.
      const appAfter = (await pool.query(
        `SELECT status FROM public.opportunity_applications WHERE id=$1`, [appInc],
      )).rows[0].status;
      expect(appAfter).toBe(appStatusBefore);
      expect(await eventCount(appInc, "application_transitioned")).toBe(evBefore);
    } finally {
      // Restore the fixture recruiter so later tests remain isolated.
      await pool.query(
        `UPDATE public.recruiter_profiles
            SET posting_terms_accepted_at=$2, legacy_terms_grandfathered_at=$3
          WHERE id=$1`,
        [
          ids.recruiterProfile,
          consent.rows[0].posting_terms_accepted_at,
          consent.rows[0].legacy_terms_grandfathered_at,
        ],
      );
    }

    // ---- Suspended recruiter path ----
    const drvS = await mintDriver(pool);
    const appS = await submitApply(url, drvS, ids.suspendedOpportunity);
    await pool.query(`UPDATE public.recruiter_profiles SET status='suspended' WHERE id=$1`, [ids.suspendedRecruiterProfile]);
    const cs = await newAuthClient(url, ids.suspendedRecruiterUser);
    let smsg = ""; let scode = "";
    try { await cs.query(`SELECT * FROM public.transition_opportunity_application($1::uuid,'viewed',NULL)`, [appS]); }
    catch (e) { smsg = (e as Error).message; scode = (e as { code?: string }).code ?? ""; }
    await rollbackEnd(cs);
    await pool.query(`UPDATE public.recruiter_profiles SET status='active' WHERE id=$1`, [ids.suspendedRecruiterProfile]);
    expect(scode).toBe("42501");
    expect(smsg.toLowerCase()).toContain("recruiter not eligible");
  });

  // ==================================================================
  // D. True-concurrency races (synchronization barrier, independent clients)
  // ==================================================================

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

  const SEND_SQL = `SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '2 days')`;
  const ACCEPT_SQL = `SELECT * FROM public.accept_opportunity_offer($1::uuid)`;
  const DECLINE_SQL = `SELECT * FROM public.decline_opportunity_offer($1::uuid, NULL)`;
  const CANCEL_SQL = `SELECT * FROM public.cancel_opportunity_offer($1::uuid, NULL)`;
  const HIRE_SQL = `SELECT * FROM public.complete_hiring($1::uuid)`;
  const WITHDRAW_SQL = `SELECT * FROM public.withdraw_opportunity_application($1::uuid)`;
  const REJECT_SQL = `SELECT * FROM public.transition_opportunity_application($1::uuid,'rejected',NULL)`;

  async function eventCount(appId: string, type: string) {
    const q = await pool.query(
      `SELECT count(*)::int AS n FROM public.application_events WHERE application_id=$1 AND event_type=$2`,
      [appId, type],
    );
    return q.rows[0].n as number;
  }
  async function notifCount(appId: string, type: string) {
    const q = await pool.query(
      `SELECT count(*)::int AS n FROM public.notifications WHERE type=$1 AND payload->>'application_id'=$2::text`,
      [type, appId],
    );
    return q.rows[0].n as number;
  }
  async function notifCountFor(userId: string, appId: string, type: string) {
    const q = await pool.query(
      `SELECT count(*)::int AS n FROM public.notifications
        WHERE user_id=$1 AND type=$2 AND payload->>'application_id'=$3::text`,
      [userId, type, appId],
    );
    return q.rows[0].n as number;
  }

  it("D1 race: concurrent send of the same draft offer — one offer_sent, one already_sent", async () => {
    const drv = await mintDriver(pool);
    const { appId, offerId } = await setupDraftOffer(drv);
    const [a, b] = await barrierRace(url, [
      { uid: ids.recruiterUser, sql: SEND_SQL, params: [offerId] },
      { uid: ids.recruiterUser, sql: SEND_SQL, params: [offerId] },
    ]);
    const codes = [a, b].filter((x) => x.ok).map((x) => x.row!.result_code as string).sort();
    expect(codes).toEqual(["already_sent", "offer_sent"]);
    const off = await pool.query(`SELECT status FROM public.opportunity_offers WHERE id=$1`, [offerId]);
    expect(off.rows[0].status).toBe("sent");
    const app = await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId]);
    expect(app.rows[0].status).toBe("offer_sent");
    expect(await eventCount(appId, "offer_sent")).toBe(1);
    expect(await notifCount(appId, "offer_sent")).toBe(1);
  });

  it("D2 race: concurrent accept of same sent offer — one offer_accepted, one already_accepted", async () => {
    const drv = await mintDriver(pool);
    const { appId, offerId } = await setupSentOffer(drv);
    const [a, b] = await barrierRace(url, [
      { uid: drv, sql: ACCEPT_SQL, params: [offerId] },
      { uid: drv, sql: ACCEPT_SQL, params: [offerId] },
    ]);
    const codes = [a, b].filter((x) => x.ok).map((x) => x.row!.result_code as string).sort();
    expect(codes).toEqual(["already_accepted", "offer_accepted"]);
    const off = await pool.query(`SELECT status FROM public.opportunity_offers WHERE id=$1`, [offerId]);
    expect(off.rows[0].status).toBe("accepted");
    const app = await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId]);
    expect(app.rows[0].status).toBe("onboarding");
    expect(await eventCount(appId, "offer_accepted")).toBe(1);
    expect(await notifCount(appId, "offer_accepted")).toBe(1);
  });

  it("D3 race: accept vs decline — exactly one terminal winner; no contradictory losing side effects", async () => {
    const drv = await mintDriver(pool);
    const { appId, offerId } = await setupSentOffer(drv);
    await barrierRace(url, [
      { uid: drv, sql: ACCEPT_SQL, params: [offerId] },
      { uid: drv, sql: DECLINE_SQL, params: [offerId] },
    ]);
    const off = (await pool.query(`SELECT status FROM public.opportunity_offers WHERE id=$1`, [offerId])).rows[0].status;
    const app = (await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId])).rows[0].status;
    expect(["accepted", "declined"]).toContain(off);
    if (off === "accepted") {
      expect(app).toBe("onboarding");
      expect(await eventCount(appId, "offer_accepted")).toBe(1);
      expect(await notifCount(appId, "offer_accepted")).toBe(1);
      expect(await eventCount(appId, "offer_declined")).toBe(0);
      expect(await notifCount(appId, "offer_declined")).toBe(0);
    } else {
      expect(app).toBe("offer_sent");
      expect(await eventCount(appId, "offer_declined")).toBe(1);
      expect(await notifCount(appId, "offer_declined")).toBe(1);
      expect(await eventCount(appId, "offer_accepted")).toBe(0);
      expect(await notifCount(appId, "offer_accepted")).toBe(0);
    }
  });

  it("D4 race: accept vs recruiter cancel — exact winner with recipient-scoped side effects", async () => {
    const drv = await mintDriver(pool);
    const { appId, offerId } = await setupSentOffer(drv);
    await barrierRace(url, [
      { uid: drv, sql: ACCEPT_SQL, params: [offerId] },
      { uid: ids.recruiterUser, sql: CANCEL_SQL, params: [offerId] },
    ]);
    const off = (await pool.query(`SELECT status FROM public.opportunity_offers WHERE id=$1`, [offerId])).rows[0].status;
    const app = (await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId])).rows[0].status;
    expect(["accepted", "canceled"]).toContain(off);
    if (off === "accepted") {
      expect(app).toBe("onboarding");
      expect(await eventCount(appId, "offer_accepted")).toBe(1);
      expect(await notifCountFor(ids.recruiterUser, appId, "offer_accepted")).toBe(1);
      expect(await eventCount(appId, "offer_canceled")).toBe(0);
      expect(await notifCountFor(drv, appId, "offer_canceled")).toBe(0);
    } else {
      expect(app).toBe("offer_sent");
      expect(await eventCount(appId, "offer_canceled")).toBe(1);
      expect(await notifCountFor(drv, appId, "offer_canceled")).toBe(1);
      expect(await eventCount(appId, "offer_accepted")).toBe(0);
      expect(await notifCountFor(ids.recruiterUser, appId, "offer_accepted")).toBe(0);
    }
  });

  it("D5 race: two distinct sent offers for one application accepted concurrently — exactly one accepted; partial unique index preserved", async () => {
    const drv = await mintDriver(pool);
    // Legitimate path builds appId + one sent offer via the real RPCs, so
    // the application is in offer_sent with valid authorization state.
    const { appId, offerId: oidA } = await setupSentOffer(drv);
    // Fixture-only setup: temporarily drop the one_sent_per_app partial unique
    // index (M1 invariant, unrelated to the accepted-offer index under test)
    // so we can construct a second competing sent row.
    await pool.query(`DROP INDEX public.opportunity_offers_one_sent_per_app_uidx`);
    const oidB = randomUUID();
    const nowExpires = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
    await pool.query(
      `INSERT INTO public.opportunity_offers
         (id,application_id,opportunity_id,recruiter_id,driver_user_id,status,sent_at,expires_at,pay_description,snapshot_version,sent_snapshot)
         SELECT $1, a.id, a.opportunity_id, a.recruiter_id, a.driver_user_id, 'sent', now(), $2::timestamptz, 'p', 1, '{"seed":true}'::jsonb
           FROM public.opportunity_applications a WHERE a.id=$3`,
      [oidB, nowExpires, appId],
    );

    const [ra, rb] = await barrierRace(url, [
      { uid: drv, sql: ACCEPT_SQL, params: [oidA] },
      { uid: drv, sql: ACCEPT_SQL, params: [oidB] },
    ]);
    const accepted = await pool.query(
      `SELECT id, status FROM public.opportunity_offers WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[oidA, oidB]],
    );
    const acceptedCount = accepted.rows.filter((r) => r.status === "accepted").length;
    expect(acceptedCount).toBe(1);
    const app = (await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId])).rows[0].status;
    expect(app).toBe("onboarding");
    expect(await eventCount(appId, "offer_accepted")).toBe(1);
    expect(await notifCount(appId, "offer_accepted")).toBe(1);
    // Loser is not accepted.
    const losers = [ra, rb].filter((x) => x.ok && (x.row!.result_code as string) !== "offer_accepted");
    expect(losers.length + [ra, rb].filter((x) => !x.ok).length).toBe(1);
    // Index still present and valid.
    const idx = await pool.query(
      `SELECT indisvalid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='opportunity_offers_one_accepted_per_app_uidx'`,
    );
    expect(idx.rows[0].indisvalid).toBe(true);
    // Clean up the losing 'sent' row and restore the one_sent index for
    // subsequent tests / suite invariants.
    await pool.query(`DELETE FROM public.opportunity_offers WHERE application_id=$1 AND status='sent'`, [appId]);
    await pool.query(`CREATE UNIQUE INDEX opportunity_offers_one_sent_per_app_uidx ON public.opportunity_offers(application_id) WHERE status = 'sent'`);
  });

  it("D6 race: acceptance vs service expiration sweep — exact recipient-scoped side effects", async () => {
    const drv = await mintDriver(pool);
    const { appId, offerId } = await setupSentOffer(drv);
    // Force expiration eligibility.
    await pool.query(`ALTER TABLE public.opportunity_offers DISABLE TRIGGER trg_opportunity_offers_guard`);
    await pool.query(
      `UPDATE public.opportunity_offers SET sent_at=now()-interval '25 hours', expires_at=now()-interval '1 minute' WHERE id=$1`,
      [offerId],
    );
    await pool.query(`ALTER TABLE public.opportunity_offers ENABLE TRIGGER trg_opportunity_offers_guard`);

    const [ra, rb] = await barrierRace(url, [
      { uid: drv, sql: ACCEPT_SQL, params: [offerId] },
      { uid: "", role: "service_role", sql: `SELECT public.expire_opportunity_offers(500) AS n`, params: [] },
    ]);
    void ra; void rb;
    const off = (await pool.query(`SELECT status FROM public.opportunity_offers WHERE id=$1`, [offerId])).rows[0].status;
    expect(["accepted", "expired"]).toContain(off);
    const app = (await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId])).rows[0].status;
    if (off === "accepted") {
      expect(app).toBe("onboarding");
      expect(await eventCount(appId, "offer_accepted")).toBe(1);
      expect(await notifCountFor(ids.recruiterUser, appId, "offer_accepted")).toBe(1);
      expect(await eventCount(appId, "offer_expired")).toBe(0);
      expect(await notifCountFor(drv, appId, "offer_expired")).toBe(0);
      expect(await notifCountFor(ids.recruiterUser, appId, "offer_expired")).toBe(0);
    } else {
      expect(app).toBe("offer_sent");
      expect(await eventCount(appId, "offer_expired")).toBe(1);
      // _m2_expire_offer notifies both driver AND recruiter.
      expect(await notifCountFor(drv, appId, "offer_expired")).toBe(1);
      expect(await notifCountFor(ids.recruiterUser, appId, "offer_expired")).toBe(1);
      expect(await eventCount(appId, "offer_accepted")).toBe(0);
      expect(await notifCountFor(ids.recruiterUser, appId, "offer_accepted")).toBe(0);
    }
  });

  it("D7 race: concurrent complete_hiring — one hiring_completed, one already_hired", async () => {
    const drv = await mintDriver(pool);
    const { appId, offerId } = await setupSentOffer(drv);
    const acc = await newAuthClient(url, drv);
    await acc.query(ACCEPT_SQL, [offerId]);
    await commitEnd(acc);
    const contract = await pool.query(
      `INSERT INTO public.contracts(application_id,status) VALUES($1,'approved') RETURNING id`, [appId],
    );
    const cid = contract.rows[0].id as string;
    const cv = await pool.query(
      `INSERT INTO public.contract_versions(contract_id,upload_status) VALUES($1,'uploaded') RETURNING id`, [cid],
    );
    await pool.query(`UPDATE public.contracts SET current_version_id=$1 WHERE id=$2`, [cv.rows[0].id, cid]);

    const [a, b] = await barrierRace(url, [
      { uid: ids.recruiterUser, sql: HIRE_SQL, params: [appId] },
      { uid: ids.recruiterUser, sql: HIRE_SQL, params: [appId] },
    ]);
    const codes = [a, b].filter((x) => x.ok).map((x) => x.row!.result_code as string).sort();
    expect(codes).toEqual(["already_hired", "hiring_completed"]);
    const app = (await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId])).rows[0].status;
    expect(app).toBe("hired");
    expect(await eventCount(appId, "hiring_completed")).toBe(1);
    const notif = await pool.query(
      `SELECT count(*)::int AS n FROM public.notifications WHERE user_id=$1 AND type='hiring_completed' AND payload->>'application_id'=$2::text`,
      [drv, appId],
    );
    expect(notif.rows[0].n).toBe(1);
  });

  it("D8 race: driver withdrawal vs recruiter rejection — exact winner with recipient-scoped side effects", async () => {
    const drv = await mintDriver(pool);
    const appId = await submitApply(url, drv, ids.opportunity);
    await barrierRace(url, [
      { uid: drv, sql: WITHDRAW_SQL, params: [appId] },
      { uid: ids.recruiterUser, sql: REJECT_SQL, params: [appId] },
    ]);
    const app = (await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId])).rows[0].status;
    expect(["withdrawn", "rejected"]).toContain(app);
    if (app === "withdrawn") {
      expect(await eventCount(appId, "application_withdrawn")).toBe(1);
      expect(await notifCountFor(ids.recruiterUser, appId, "application_withdrawn")).toBe(1);
      expect(await eventCount(appId, "application_rejected")).toBe(0);
      expect(await notifCountFor(drv, appId, "application_rejected")).toBe(0);
    } else {
      expect(await eventCount(appId, "application_rejected")).toBe(1);
      expect(await notifCountFor(drv, appId, "application_rejected")).toBe(1);
      expect(await eventCount(appId, "application_withdrawn")).toBe(0);
      expect(await notifCountFor(ids.recruiterUser, appId, "application_withdrawn")).toBe(0);
    }
  });

  it("D9 race: two concurrent expiration sweeps (SKIP LOCKED) — each expired offer processed exactly once", async () => {
    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const drv = await mintDriver(pool);
      const { offerId } = await setupSentOffer(drv);
      await pool.query(`ALTER TABLE public.opportunity_offers DISABLE TRIGGER trg_opportunity_offers_guard`);
      await pool.query(
        `UPDATE public.opportunity_offers SET sent_at=now()-interval '25 hours', expires_at=now()-interval '1 minute' WHERE id=$1`,
        [offerId],
      );
      await pool.query(`ALTER TABLE public.opportunity_offers ENABLE TRIGGER trg_opportunity_offers_guard`);
      created.push(offerId);
    }
    const [ra, rb] = await barrierRace(url, [
      { uid: "", role: "service_role", sql: `SELECT public.expire_opportunity_offers(500) AS n`, params: [] },
      { uid: "", role: "service_role", sql: `SELECT public.expire_opportunity_offers(500) AS n`, params: [] },
    ]);
    const na = ra.ok ? (ra.row!.n as number) : 0;
    const nb = rb.ok ? (rb.row!.n as number) : 0;
    expect(na + nb).toBe(3);
    const rows = await pool.query(
      `SELECT status FROM public.opportunity_offers WHERE id = ANY($1::uuid[])`, [created],
    );
    for (const r of rows.rows) expect(r.status).toBe("expired");
    for (const oid of created) {
      const ev = await pool.query(
        `SELECT count(*)::int n FROM public.application_events WHERE event_type='offer_expired' AND metadata->>'offer_id'=$1::text`, [oid],
      );
      // metadata may or may not include offer_id depending on schema; fall back to counting the exact offer_id via app+offer join
      if (ev.rows[0].n === 0) {
        const off = await pool.query(`SELECT application_id, driver_user_id FROM public.opportunity_offers WHERE id=$1`, [oid]);
        const app = off.rows[0].application_id as string;
        const drv = off.rows[0].driver_user_id as string;
        const evByApp = await pool.query(
          `SELECT count(*)::int n FROM public.application_events WHERE application_id=$1 AND event_type='offer_expired'`, [app],
        );
        expect(evByApp.rows[0].n).toBe(1);
        const notif = await pool.query(
          `SELECT count(*)::int n FROM public.notifications WHERE user_id=$1 AND type='offer_expired' AND payload->>'application_id'=$2::text`,
          [drv, app],
        );
        expect(notif.rows[0].n).toBe(1);
      } else {
        expect(ev.rows[0].n).toBe(1);
      }
    }
  });

  // ==================================================================
  // E. Forced rollback proofs
  // ==================================================================

  it("E1: accept_opportunity_offer rolled back leaves offer sent, application offer_sent, and no events/notifications", async () => {
    const uid = await mintDriver(pool);
    const { appId, offerId } = await setupSentOffer(uid);
    const evBefore = await eventCount(appId, "offer_accepted");
    const nfBefore = await notifCount(appId, "offer_accepted");
    const c = await newAuthClient(url, uid);
    const r = await c.query(ACCEPT_SQL, [offerId]);
    expect(r.rows[0].result_code).toBe("offer_accepted");
    // Verify in-txn side effects visible.
    const inTx = await c.query(`SELECT status FROM public.opportunity_offers WHERE id=$1`, [offerId]);
    expect(inTx.rows[0].status).toBe("accepted");
    await c.query("ROLLBACK");
    await c.end();
    const off = await pool.query(`SELECT status FROM public.opportunity_offers WHERE id=$1`, [offerId]);
    expect(off.rows[0].status).toBe("sent");
    const app = await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId]);
    expect(app.rows[0].status).toBe("offer_sent");
    expect(await eventCount(appId, "offer_accepted")).toBe(evBefore);
    expect(await notifCount(appId, "offer_accepted")).toBe(nfBefore);
  });

  it("E2: complete_hiring rolled back — application returns to onboarding, contract unchanged, no hiring event or notification", async () => {
    const drv = await mintDriver(pool);
    const { appId, offerId } = await setupSentOffer(drv);
    const acc = await newAuthClient(url, drv);
    await acc.query(ACCEPT_SQL, [offerId]);
    await commitEnd(acc);
    const contract = await pool.query(
      `INSERT INTO public.contracts(application_id,status) VALUES($1,'approved') RETURNING id, status, updated_at`, [appId],
    );
    const cid = contract.rows[0].id as string;
    const cv = await pool.query(
      `INSERT INTO public.contract_versions(contract_id,upload_status) VALUES($1,'uploaded') RETURNING id`, [cid],
    );
    await pool.query(`UPDATE public.contracts SET current_version_id=$1 WHERE id=$2`, [cv.rows[0].id, cid]);
    const contractBefore = await pool.query(`SELECT status, current_version_id FROM public.contracts WHERE id=$1`, [cid]);

    const evBefore = await eventCount(appId, "hiring_completed");
    const nfBefore = await notifCount(appId, "hiring_completed");

    const rc = await newAuthClient(url, ids.recruiterUser);
    const r = await rc.query(HIRE_SQL, [appId]);
    expect(r.rows[0].result_code).toBe("hiring_completed");
    // In-txn: application sees hired.
    const inTx = await rc.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId]);
    expect(inTx.rows[0].status).toBe("hired");
    await rc.query("ROLLBACK");
    await rc.end();
    // From separate connection: state is back to onboarding.
    const app = await pool.query(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId]);
    expect(app.rows[0].status).toBe("onboarding");
    const contractAfter = await pool.query(`SELECT status, current_version_id FROM public.contracts WHERE id=$1`, [cid]);
    expect(contractAfter.rows[0].status).toBe(contractBefore.rows[0].status);
    expect(contractAfter.rows[0].current_version_id).toBe(contractBefore.rows[0].current_version_id);
    expect(await eventCount(appId, "hiring_completed")).toBe(evBefore);
    expect(await notifCount(appId, "hiring_completed")).toBe(nfBefore);
  });

  it("E3: transition_opportunity_application('rejected') rolled back leaves prior state, no rejection event or notification", async () => {
    const drv = await mintDriver(pool);
    const appId = await submitApply(url, drv, ids.opportunity);
    const appBefore = (await pool.query(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId],
    )).rows[0].status;
    const evBefore = await eventCount(appId, "application_rejected");
    const nfBefore = await notifCountFor(drv, appId, "application_rejected");

    const rc = await newAuthClient(url, ids.recruiterUser);
    const r = await rc.query(REJECT_SQL, [appId]);
    expect(r.rows[0].result_code).toBe("application_transitioned");
    // In-txn side effects visible.
    const inTxApp = (await rc.query(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId],
    )).rows[0].status;
    expect(inTxApp).toBe("rejected");
    const inTxEv = (await rc.query(
      `SELECT count(*)::int n FROM public.application_events
        WHERE application_id=$1 AND event_type='application_rejected'`, [appId],
    )).rows[0].n as number;
    expect(inTxEv).toBe(evBefore + 1);
    const inTxNf = (await rc.query(
      `SELECT count(*)::int n FROM public.notifications
        WHERE user_id=$1 AND type='application_rejected' AND payload->>'application_id'=$2::text`,
      [drv, appId],
    )).rows[0].n as number;
    expect(inTxNf).toBe(nfBefore + 1);

    await rc.query("ROLLBACK");
    await rc.end();

    // From a separate connection: original state restored, no persisted side effects.
    const appAfter = (await pool.query(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`, [appId],
    )).rows[0].status;
    expect(appAfter).toBe(appBefore);
    expect(await eventCount(appId, "application_rejected")).toBe(evBefore);
    expect(await notifCountFor(drv, appId, "application_rejected")).toBe(nfBefore);
  });
});
