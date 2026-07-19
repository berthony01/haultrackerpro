// @vitest-environment node
// =====================================================================
// Phase 1H-M2 Turn 2b-i — Offer workflow focused runtime (PGlite)
//
// Loads canonical M1 migration + M2 candidate. Exercises:
//   - 11 baseline runtime tests from Turn 2a (kept)
//   - 11 checkpoint tests (a–k) proving Turn 2b-i remediations:
//       a. foreign recruiter cannot obtain already_sent
//       b. foreign recruiter cannot obtain already_hired
//       c. incomplete recruiter denied
//       d. complete active unverified recruiter allowed
//       e. early-stage draft denied
//       f. early-stage send denied
//       g. authenticated custom-GUC spoof cannot flip sensitive statuses
//       h. hired direct transition fails without contract proof
//       i. first send emits exactly one canonical offer_sent event +
//          one driver notification
//       j. expiration via decline and cancel notifies driver + recruiter
//          exactly once
//       k. two application withdrawals produce two recruiter
//          notifications; retrying one produces no duplicate
// =====================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

const M1_REL = '../../supabase/migrations/20260719183725_ee7ffc53-dcdc-4666-bcba-1aeac0f5d0cf.sql';
const M2_REL = '../../supabase/migration-candidates/20260720000000_phase1h_m2_offer_workflow_rpcs.sql';

const read = (rel: string) =>
  fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const IDS = {
  driverA: '11111111-1111-1111-1111-111111111111',
  driverB: '22222222-2222-2222-2222-222222222222',
  driverC: 'cccc1111-cccc-1111-cccc-111111111111',
  driverD: 'dddd1111-dddd-1111-dddd-111111111111',
  driverE: 'eeee1111-eeee-1111-eeee-111111111111',
  recruiterUser: '33333333-3333-3333-3333-333333333333',
  recruiterProfile: '44444444-4444-4444-4444-444444444444',
  opportunity: '55555555-5555-5555-5555-555555555555',
  // Foreign recruiter (owns nothing on driverA's application)
  foreignRecruiterUser: '66666666-6666-6666-6666-666666666666',
  foreignRecruiterProfile: '77777777-7777-7777-7777-777777777777',
  foreignOpportunity: '88888888-8888-8888-8888-888888888888',
  // Incomplete recruiter: no terms accepted, no grandfather
  incompleteRecruiterUser: '99999999-9999-9999-9999-999999999999',
  incompleteRecruiterProfile: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  incompleteOpportunity: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  // Active unverified recruiter: terms accepted, verification_status pending
  unverifiedRecruiterUser: 'e1111111-e111-e111-e111-e11111111111',
  unverifiedRecruiterProfile: 'e2222222-e222-e222-e222-e22222222222',
  unverifiedOpportunity: 'e3333333-e333-e333-e333-e33333333333',
};

async function primeBaseline(db: AnyPGlite) {
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;

    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;

    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $$;

    CREATE TABLE public.driver_opportunity_profiles (
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

    CREATE TABLE public.recruiter_profiles (
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

    CREATE TABLE public.opportunities (
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

    CREATE TABLE public.opportunity_applications (
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

    CREATE TABLE public.application_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id uuid NOT NULL,
      actor_type text,
      actor_user_id uuid,
      event_type text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.notifications (
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
    ) RETURNS uuid LANGUAGE sql AS $$
      INSERT INTO public.notifications(user_id,type,title,body,payload)
      VALUES(_uid,_type,_title,_body,COALESCE(_payload,'{}'::jsonb))
      RETURNING id;
    $$;

    CREATE TABLE public.contracts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id uuid,
      current_version_id uuid,
      status text NOT NULL DEFAULT 'draft',
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.contract_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
      upload_status text NOT NULL DEFAULT 'pending'
    );

    ALTER TABLE public.driver_opportunity_profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.recruiter_profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.opportunity_applications ENABLE ROW LEVEL SECURITY;

    GRANT USAGE ON SCHEMA public TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_opportunity_profiles TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.recruiter_profiles TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunities TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_applications TO authenticated, service_role;

    CREATE POLICY "driver own profiles" ON public.driver_opportunity_profiles
      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "recruiter own profiles" ON public.recruiter_profiles
      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

    CREATE OR REPLACE FUNCTION public.is_admin(_uid uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT false $$;

    CREATE OR REPLACE FUNCTION public.recruiter_profile_can_manage_opportunities(_rid uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.recruiter_profiles rp
          WHERE rp.id = _rid AND rp.status <> 'suspended'
            AND rp.verification_status <> 'suspended'
            AND (rp.posting_terms_accepted_at IS NOT NULL OR rp.legacy_terms_grandfathered_at IS NOT NULL)
        )
      $$;
    CREATE OR REPLACE FUNCTION public.current_user_can_manage_recruiter_opportunities(_rid uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.recruiter_profiles rp
          WHERE rp.id = _rid AND rp.user_id = auth.uid()
            AND rp.status <> 'suspended'
            AND rp.verification_status <> 'suspended'
            AND (rp.posting_terms_accepted_at IS NOT NULL OR rp.legacy_terms_grandfathered_at IS NOT NULL)
        )
      $$;
    CREATE OR REPLACE FUNCTION public.driver_can_access_opportunity(_o uuid, _r uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.opportunities o
          WHERE auth.uid() IS NOT NULL AND o.id=_o AND o.recruiter_id=_r
            AND o.status='active' AND o.admin_review_status='approved'
            AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
        )
      $$;

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

    CREATE TABLE public.subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, status text NOT NULL DEFAULT 'inactive');
    CREATE TABLE public.recruiter_billing_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recruiter_id uuid NOT NULL, stripe_customer_id text);
  `);

  await db.exec(`
    INSERT INTO auth.users(id,email) VALUES
      ('${IDS.driverA}','driver-a@test'),
      ('${IDS.driverB}','driver-b@test'),
      ('${IDS.driverC}','driver-c@test'),
      ('${IDS.driverD}','driver-d@test'),
      ('${IDS.driverE}','driver-e@test'),
      ('${IDS.recruiterUser}','recruiter@test'),
      ('${IDS.foreignRecruiterUser}','foreign-r@test'),
      ('${IDS.incompleteRecruiterUser}','inc-r@test'),
      ('${IDS.unverifiedRecruiterUser}','unv-r@test');

    INSERT INTO public.recruiter_profiles(
      id,user_id,recruiter_name,recruiter_email,company_name,dot_number,posting_terms_accepted_at,posting_terms_version,verification_status,status
    ) VALUES
      ('${IDS.recruiterProfile}','${IDS.recruiterUser}','Test Recruiter','recruiter@test','Acme','DOT123',now(),'2026-07-17.v1','approved','active'),
      ('${IDS.foreignRecruiterProfile}','${IDS.foreignRecruiterUser}','Foreign Recruiter','foreign-r@test','Foreign Co','DOTF',now(),'2026-07-17.v1','approved','active'),
      ('${IDS.incompleteRecruiterProfile}','${IDS.incompleteRecruiterUser}','Inc Recruiter','inc-r@test','Inc Co','DOTI',NULL,NULL,'approved','active'),
      ('${IDS.unverifiedRecruiterProfile}','${IDS.unverifiedRecruiterUser}','Unv Recruiter','unv-r@test','Unv Co','DOTU',now(),'2026-07-17.v1','pending','active');

    -- No fixup needed; foreign recruiter has terms accepted from the seed.

    UPDATE public.recruiter_profiles SET posting_terms_accepted_at=now() WHERE id='${IDS.foreignRecruiterProfile}';

    INSERT INTO public.opportunities(
      id,recruiter_id,title,company_name,hiring_city,hiring_state,driver_type,route_type,trailer_type,
      pay_model,cpm,estimated_weekly_gross,estimated_weekly_miles,status,admin_review_status
    ) VALUES
      ('${IDS.opportunity}','${IDS.recruiterProfile}','Regional OTR','Acme','Dallas','TX','company','regional','dry_van','cpm',0.62,1800,2800,'active','approved'),
      ('${IDS.foreignOpportunity}','${IDS.foreignRecruiterProfile}','Foreign OTR','Foreign Co','Dallas','TX','company','regional','dry_van','cpm',0.62,1800,2800,'active','approved'),
      ('${IDS.incompleteOpportunity}','${IDS.incompleteRecruiterProfile}','Inc OTR','Inc Co','Dallas','TX','company','regional','dry_van','cpm',0.62,1800,2800,'active','approved'),
      ('${IDS.unverifiedOpportunity}','${IDS.unverifiedRecruiterProfile}','Unv OTR','Unv Co','Dallas','TX','company','regional','dry_van','cpm',0.62,1800,2800,'active','approved');

    INSERT INTO public.driver_opportunity_profiles(user_id,full_name,phone,email,city,state,cdl_class,years_experience,endorsements,trailer_experience,preferred_driver_type,preferred_route_type,preferred_home_time,preferred_states,min_weekly_gross,min_weekly_net,min_effective_rpm,available_start_date,willing_to_relocate,contact_preference,visibility,allow_verified_recruiter_contact,profile_completed)
    VALUES
      ('${IDS.driverA}','Ada','555-1111','ada@t','Austin','TX','A',5,ARRAY['H'],ARRAY['dry_van'],'company','regional','weekends',ARRAY['TX'],1500,1200,1.8,'2026-08-01',false,'phone','apply_only',true,true),
      ('${IDS.driverB}','Bo','555-2222','bo@t','Houston','TX','A',5,ARRAY['H'],ARRAY['dry_van'],'company','regional','weekends',ARRAY['TX'],1500,1200,1.8,'2026-08-01',false,'phone','apply_only',true,true),
      ('${IDS.driverC}','Cara','555-3333','cara@t','Dallas','TX','A',5,ARRAY['H'],ARRAY['dry_van'],'company','regional','weekends',ARRAY['TX'],1500,1200,1.8,'2026-08-01',false,'phone','apply_only',true,true),
      ('${IDS.driverD}','Deb','555-4444','deb@t','El Paso','TX','A',5,ARRAY['H'],ARRAY['dry_van'],'company','regional','weekends',ARRAY['TX'],1500,1200,1.8,'2026-08-01',false,'phone','apply_only',true,true),
      ('${IDS.driverE}','Eli','555-5555','eli@t','Waco','TX','A',5,ARRAY['H'],ARRAY['dry_van'],'company','regional','weekends',ARRAY['TX'],1500,1200,1.8,'2026-08-01',false,'phone','apply_only',true,true);
  `);
}

async function asOwner(db: AnyPGlite) {
  await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
}
async function asAuth(db: AnyPGlite, uid: string) {
  await db.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '${uid}';`);
}

async function submitApply(db: AnyPGlite, driverUid: string, oppId: string, key: string): Promise<string> {
  await asAuth(db, driverUid);
  const r = await db.query<{ application_id: string; result_code: string }>(
    `SELECT * FROM public.submit_opportunity_application($1::uuid, $2::text, 'msg', true, true, true, 'phone', true)`,
    [oppId, key],
  );
  await asOwner(db);
  if (r.rows[0].result_code !== 'created') {
    throw new Error(`submit failed: ${JSON.stringify(r.rows[0])}`);
  }
  return r.rows[0].application_id;
}

// Progresses application from 'new' → 'interviewing' via legitimate
// recruiter transitions using transition_opportunity_application.
async function transitionToInterviewing(db: AnyPGlite, appId: string, recruiterUid: string) {
  await asAuth(db, recruiterUid);
  for (const s of ['viewed', 'contact_requested', 'call_scheduled', 'interviewing']) {
    await db.query(`SELECT public.transition_opportunity_application($1::uuid, $2::text, NULL)`, [appId, s]);
  }
  await asOwner(db);
}

let db: AnyPGlite;
let appId: string; // driverA / recruiter1

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;
  await primeBaseline(db);
  await db.exec(read(M1_REL));
  await db.exec(read(M2_REL));

  appId = await submitApply(db, IDS.driverA, IDS.opportunity, 'm2-seed-key-driver-a');
  await transitionToInterviewing(db, appId, IDS.recruiterUser);
});

// ---------------------------------------------------------------------
// Baseline suite (11 tests from Turn 2a)
// ---------------------------------------------------------------------
describe('Phase 1H-M2 Turn 2a baseline: draft / send / withdraw (PGlite)', () => {
  it('M2 migration applied and 9 workflow RPCs registered', async () => {
    const r = await db.query<{ proname: string }>(
      `SELECT proname FROM pg_proc
        WHERE pronamespace='public'::regnamespace
          AND proname IN (
            'transition_opportunity_application','save_opportunity_offer_draft',
            'send_opportunity_offer','accept_opportunity_offer','decline_opportunity_offer',
            'cancel_opportunity_offer','expire_opportunity_offers',
            'withdraw_opportunity_application','complete_hiring'
          )
        ORDER BY proname`,
    );
    expect(r.rows.map(x => x.proname).sort()).toEqual([
      'accept_opportunity_offer',
      'cancel_opportunity_offer',
      'complete_hiring',
      'decline_opportunity_offer',
      'expire_opportunity_offers',
      'save_opportunity_offer_draft',
      'send_opportunity_offer',
      'transition_opportunity_application',
      'withdraw_opportunity_application',
    ]);
  });

  it('recruiter can save a draft; returns draft_created', async () => {
    await asAuth(db, IDS.recruiterUser);
    const r = await db.query<{ offer_id: string; offer_status: string; result_code: string }>(
      `SELECT * FROM public.save_opportunity_offer_draft(
         $1::uuid, 'CPM 0.62 + safety bonus', 1800, 'TX regional lanes',
         'Dry van 2023+', 'Home weekends', NULL, NULL, NULL, NULL)`,
      [appId],
    );
    expect(r.rows[0].result_code).toBe('draft_created');
    expect(r.rows[0].offer_status).toBe('draft');
    expect(r.rows[0].offer_id).toBeTruthy();
    await asOwner(db);
  });

  it('second draft call updates in place (single draft per app)', async () => {
    await asAuth(db, IDS.recruiterUser);
    const r = await db.query<{ offer_id: string; result_code: string }>(
      `SELECT * FROM public.save_opportunity_offer_draft(
         $1::uuid, 'CPM 0.65 + safety bonus', 1900, 'TX/OK regional',
         'Dry van 2023+', 'Home weekends', NULL, NULL, NULL, NULL)`,
      [appId],
    );
    expect(r.rows[0].result_code).toBe('draft_updated');
    const cnt = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.opportunity_offers WHERE application_id=$1 AND status='draft'`,
      [appId],
    );
    expect(cnt.rows[0].n).toBe('1');
    await asOwner(db);
  });

  it('driver may NOT save a draft on their own application', async () => {
    await asAuth(db, IDS.driverA);
    await expect(
      db.query(
        `SELECT * FROM public.save_opportunity_offer_draft(
           $1::uuid, 'hostile draft', 1000, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
        [appId],
      ),
    ).rejects.toThrow(/not authorized/i);
    await asOwner(db);
  });

  it('draft rejects oversized fields and negative amount', async () => {
    await asAuth(db, IDS.recruiterUser);
    await expect(
      db.query(
        `SELECT * FROM public.save_opportunity_offer_draft(
           $1::uuid, 'ok', -1, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
        [appId],
      ),
    ).rejects.toThrow(/amount cannot be negative/i);
    const big = 'x'.repeat(2100);
    await expect(
      db.query(
        `SELECT * FROM public.save_opportunity_offer_draft(
           $1::uuid, 'ok', 100, $2, NULL, NULL, NULL, NULL, NULL, NULL)`,
        [appId, big],
      ),
    ).rejects.toThrow(/too long/i);
    await asOwner(db);
  });

  it('send validates expiry window (<24h and >30d rejected)', async () => {
    const d = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_offers WHERE application_id=$1 AND status='draft'`,
      [appId],
    );
    const draftId = d.rows[0].id;
    await asAuth(db, IDS.recruiterUser);
    await expect(
      db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '2 hours')`, [draftId]),
    ).rejects.toThrow(/at least 24 hours/i);
    await expect(
      db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '45 days')`, [draftId]),
    ).rejects.toThrow(/within 30 days/i);
    await asOwner(db);
  });

  it('send transitions draft→sent, app→offer_sent, snapshots + emits event', async () => {
    const d = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_offers WHERE application_id=$1 AND status='draft'`,
      [appId],
    );
    const draftId = d.rows[0].id;
    await asAuth(db, IDS.recruiterUser);
    const r = await db.query<{ application_status: string; offer_status: string; result_code: string }>(
      `SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`,
      [draftId],
    );
    expect(r.rows[0].result_code).toBe('offer_sent');
    expect(r.rows[0].offer_status).toBe('sent');
    expect(r.rows[0].application_status).toBe('offer_sent');
    await asOwner(db);

    const off = await db.query<{ status: string; sent_snapshot: unknown; sent_at: string | null }>(
      `SELECT status, sent_snapshot, sent_at FROM public.opportunity_offers WHERE id=$1`,
      [draftId],
    );
    expect(off.rows[0].status).toBe('sent');
    expect(off.rows[0].sent_at).not.toBeNull();
    expect(off.rows[0].sent_snapshot).toBeTruthy();

    const ev = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.application_events
        WHERE application_id=$1 AND event_type='offer_sent'`,
      [appId],
    );
    expect(ev.rows[0].n).toBe('1');

    const app = await db.query<{ status: string }>(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`,
      [appId],
    );
    expect(app.rows[0].status).toBe('offer_sent');
  });

  it('sent offer terms are immutable via direct update', async () => {
    const off = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_offers WHERE application_id=$1 AND status='sent'`,
      [appId],
    );
    await expect(
      db.query(
        `UPDATE public.opportunity_offers SET pay_description='changed' WHERE id=$1`,
        [off.rows[0].id],
      ),
    ).rejects.toThrow(/immutable once sent/i);
  });

  it('offer_sent app cannot be direct-transitioned to onboarding or hired', async () => {
    await asAuth(db, IDS.recruiterUser);
    await expect(
      db.query(`SELECT * FROM public.transition_opportunity_application($1::uuid, 'onboarding', NULL)`, [appId]),
    ).rejects.toThrow(/cannot set onboarding/i);
    await expect(
      db.query(`SELECT * FROM public.transition_opportunity_application($1::uuid, 'hired', NULL)`, [appId]),
    ).rejects.toThrow(/cannot set hired/i);
    await asOwner(db);
  });

  it('driver withdraw cancels the linked sent offer and terminates the application', async () => {
    await asAuth(db, IDS.driverA);
    await db.query(`SELECT public.withdraw_opportunity_application($1::uuid)`, [appId]);
    await asOwner(db);

    const app = await db.query<{ status: string; withdrawn_at: string | null }>(
      `SELECT status, withdrawn_at FROM public.opportunity_applications WHERE id=$1`,
      [appId],
    );
    expect(app.rows[0].status).toBe('withdrawn');
    expect(app.rows[0].withdrawn_at).not.toBeNull();

    const off = await db.query<{ status: string; canceled_at: string | null }>(
      `SELECT status, canceled_at FROM public.opportunity_offers WHERE application_id=$1`,
      [appId],
    );
    expect(off.rows[0].status).toBe('canceled');
    expect(off.rows[0].canceled_at).not.toBeNull();

    const evs = await db.query<{ event_type: string }>(
      `SELECT event_type FROM public.application_events
        WHERE application_id=$1 AND event_type IN ('offer_canceled','application_withdrawn')
        ORDER BY event_type`,
      [appId],
    );
    expect(evs.rows.map(e => e.event_type)).toEqual(['application_withdrawn','offer_canceled']);
  });

  it('withdrawn app is terminal — second withdraw is a no-op, not an error', async () => {
    await asAuth(db, IDS.driverA);
    await db.query(`SELECT public.withdraw_opportunity_application($1::uuid)`, [appId]);
    await asOwner(db);
    const app = await db.query<{ status: string }>(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`,
      [appId],
    );
    expect(app.rows[0].status).toBe('withdrawn');
  });
});

// ---------------------------------------------------------------------
// Turn 2b-i checkpoint suite (a–k)
// ---------------------------------------------------------------------
describe('Phase 1H-M2 Turn 2b-i remediations', () => {
  it('a. foreign recruiter cannot obtain already_sent from send_opportunity_offer', async () => {
    // driverB submits a fresh application; recruiter1 progresses + sends offer.
    const appB = await submitApply(db, IDS.driverB, IDS.opportunity, 'a-key-driver-b');
    await transitionToInterviewing(db, appB, IDS.recruiterUser);
    await asAuth(db, IDS.recruiterUser);
    await db.query(
      `SELECT * FROM public.save_opportunity_offer_draft($1::uuid, 'pay', 1800, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      [appB],
    );
    const d = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_offers WHERE application_id=$1 AND status='draft'`,
      [appB],
    );
    const offerB = d.rows[0].id;
    await db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [offerB]);
    await asOwner(db);

    // Foreign recruiter calls send with the sent offer id.
    await asAuth(db, IDS.foreignRecruiterUser);
    await expect(
      db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '5 days')`, [offerB]),
    ).rejects.toThrow(/not authorized/i);
    await asOwner(db);
  });

  it('b. foreign recruiter cannot obtain already_hired from complete_hiring', async () => {
    // Fresh app for driverC → interviewed → sent → accepted → onboarding → contract → hired.
    const appC = await submitApply(db, IDS.driverC, IDS.opportunity, 'b-key-driver-c');
    await transitionToInterviewing(db, appC, IDS.recruiterUser);
    await asAuth(db, IDS.recruiterUser);
    await db.query(
      `SELECT * FROM public.save_opportunity_offer_draft($1::uuid,'pay',1800,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
      [appC],
    );
    const draft = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_offers WHERE application_id=$1 AND status='draft'`, [appC]);
    await db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [draft.rows[0].id]);
    await asOwner(db);
    await asAuth(db, IDS.driverC);
    await db.query(`SELECT * FROM public.accept_opportunity_offer($1::uuid)`, [draft.rows[0].id]);
    await asOwner(db);
    // Seed valid contract as owner.
    await db.exec(`
      DO $$ DECLARE _c uuid; _v uuid; BEGIN
        INSERT INTO public.contracts(application_id,status) VALUES ('${appC}','approved') RETURNING id INTO _c;
        INSERT INTO public.contract_versions(contract_id,upload_status) VALUES (_c,'uploaded') RETURNING id INTO _v;
        UPDATE public.contracts SET current_version_id=_v WHERE id=_c;
      END $$;
    `);
    await asAuth(db, IDS.recruiterUser);
    const h = await db.query<{ result_code: string }>(`SELECT * FROM public.complete_hiring($1::uuid)`, [appC]);
    expect(h.rows[0].result_code).toBe('hiring_completed');
    await asOwner(db);

    // Foreign recruiter tries — must get not-authorized, not already_hired.
    await asAuth(db, IDS.foreignRecruiterUser);
    await expect(
      db.query(`SELECT * FROM public.complete_hiring($1::uuid)`, [appC]),
    ).rejects.toThrow(/not authorized/i);
    await asOwner(db);
  });

  it('c. incomplete recruiter (no terms accepted) is denied draft', async () => {
    // driverD applies to incompleteOpportunity — but driver_can_access_opportunity
    // requires recruiter_profile_can_manage_opportunities which fails for incomplete.
    // Directly insert an apply row as owner to bypass RLS/RPC gating.
    await db.exec(`
      INSERT INTO public.opportunity_applications(
        id, opportunity_id, driver_user_id, recruiter_id, application_type, status,
        submission_snapshot, snapshot_version, idempotency_key, submitted_at, is_legacy,
        preferred_contact_method, contact_sharing_consent, contact_sharing_consent_at
      ) VALUES (
        'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
        '${IDS.incompleteOpportunity}','${IDS.driverD}','${IDS.incompleteRecruiterProfile}',
        'apply','interviewing', jsonb_build_object('seed',true), 1, 'seed-c-inc-key',
        now(), false, 'phone', true, now()
      );
    `);
    await asAuth(db, IDS.incompleteRecruiterUser);
    await expect(
      db.query(
        `SELECT * FROM public.save_opportunity_offer_draft($1::uuid,'pay',1800,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
        ['d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1'],
      ),
    ).rejects.toThrow(/recruiter not eligible/i);
    await asOwner(db);
  });

  it('d. complete active but unverified recruiter is allowed to draft', async () => {
    await db.exec(`
      INSERT INTO public.opportunity_applications(
        id, opportunity_id, driver_user_id, recruiter_id, application_type, status,
        submission_snapshot, snapshot_version, idempotency_key, submitted_at, is_legacy,
        preferred_contact_method, contact_sharing_consent, contact_sharing_consent_at
      ) VALUES (
        'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2',
        '${IDS.unverifiedOpportunity}','${IDS.driverE}','${IDS.unverifiedRecruiterProfile}',
        'apply','interviewing', jsonb_build_object('seed',true), 1, 'seed-d-unv-key',
        now(), false, 'phone', true, now()
      );
    `);
    await asAuth(db, IDS.unverifiedRecruiterUser);
    const r = await db.query<{ result_code: string }>(
      `SELECT * FROM public.save_opportunity_offer_draft($1::uuid,'pay',1800,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
      ['d2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2'],
    );
    expect(r.rows[0].result_code).toBe('draft_created');
    await asOwner(db);
  });

  it('e. early-stage (new) application is denied draft', async () => {
    // driverA already withdrew; submit a new inquiry-style test: use a fresh
    // driver via a fresh apply row directly at status='new'.
    const rowId = 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1';
    await db.exec(`
      INSERT INTO public.opportunity_applications(
        id, opportunity_id, driver_user_id, recruiter_id, application_type, status,
        submission_snapshot, snapshot_version, idempotency_key, submitted_at, is_legacy,
        preferred_contact_method, contact_sharing_consent, contact_sharing_consent_at
      ) VALUES (
        '${rowId}', '${IDS.opportunity}', '${IDS.driverA}', '${IDS.recruiterProfile}',
        'apply','new', jsonb_build_object('seed',true), 1, 'seed-e-early-key',
        now(), false, 'phone', true, now()
      );
    `);
    await asAuth(db, IDS.recruiterUser);
    await expect(
      db.query(
        `SELECT * FROM public.save_opportunity_offer_draft($1::uuid,'pay',1800,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
        [rowId],
      ),
    ).rejects.toThrow(/not eligible for draft/i);
    await asOwner(db);
  });

  it('f. early-stage (new) application is denied send even with an existing draft', async () => {
    // Reuse e's row (status still 'new'). Insert a draft as owner (bypasses the
    // draft RPC eligibility gate), then call send — must fail on send eligibility.
    const rowId = 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1';
    const draftId = 'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1';
    await db.exec(`
      INSERT INTO public.opportunity_offers(
        id, application_id, opportunity_id, driver_user_id, recruiter_id, status,
        pay_description, estimated_weekly_amount, created_by
      ) VALUES (
        '${draftId}', '${rowId}', '${IDS.opportunity}', '${IDS.driverA}', '${IDS.recruiterProfile}',
        'draft', 'pay', 1800, '${IDS.recruiterUser}'
      );
    `);
    await asAuth(db, IDS.recruiterUser);
    await expect(
      db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [draftId]),
    ).rejects.toThrow(/does not permit send/i);
    await asOwner(db);
  });

  it('g. authenticated client cannot spoof workflow_bypass token to set sensitive statuses', async () => {
    // Seed a fresh 'interviewing' apply row owned by recruiterUser so RLS
    // update policy passes; the ONLY defense between recruiter and a direct
    // sensitive status update is the trigger checking workflow_bypass token.
    const gDriver = 'abcd1111-abcd-1111-abcd-111111111111';
    const targetId = 'abcd2222-abcd-2222-abcd-222222222222';
    await db.exec(`
      INSERT INTO auth.users(id,email) VALUES ('${gDriver}','g@t');
      INSERT INTO public.driver_opportunity_profiles(user_id,full_name,cdl_class,years_experience,contact_preference,visibility,profile_completed)
      VALUES ('${gDriver}','G','A',5,'phone','apply_only',true);
      INSERT INTO public.opportunity_applications(
        id, opportunity_id, driver_user_id, recruiter_id, application_type, status,
        submission_snapshot, snapshot_version, idempotency_key, submitted_at, is_legacy,
        preferred_contact_method, contact_sharing_consent, contact_sharing_consent_at
      ) VALUES (
        '${targetId}','${IDS.opportunity}','${gDriver}','${IDS.recruiterProfile}',
        'apply','interviewing', jsonb_build_object('seed',true), 1, 'g-seed-key-12345678',
        now(), false, 'phone', true, now()
      );
    `);

    await asAuth(db, IDS.recruiterUser);
    // Spoof workflow bypass token — trigger must not accept it.
    await db.exec(`SET app.workflow_bypass_token = 'not-a-real-token';`);
    for (const s of ['offer_sent', 'onboarding', 'hired']) {
      await expect(
        db.query(`UPDATE public.opportunity_applications SET status=$2::text WHERE id=$1`, [targetId, s]),
      ).rejects.toThrow(/server-authorized workflow/i);
    }
    await db.exec(`RESET app.workflow_bypass_token;`);
    await asOwner(db);

    // Driver spoof of driver_withdraw_token also fails: as the owner driver,
    // the trigger's guard rejects because the token doesn't match.
    await asAuth(db, gDriver);
    await db.exec(`SET app.driver_withdraw_token = 'not-a-real-token';`);
    // The 'driver own apps' policy is SELECT-only; there is no UPDATE policy
    // for drivers, so a direct UPDATE by the driver silently matches 0 rows
    // — status remains unchanged. Verify that outcome.
    await db.query(`UPDATE public.opportunity_applications SET status='withdrawn' WHERE id=$1`, [targetId]);
    await db.exec(`RESET app.driver_withdraw_token;`);
    await asOwner(db);
    const chk = await db.query<{ status: string }>(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`, [targetId]);
    expect(chk.rows[0].status).toBe('interviewing');
  });


  it('h. hired direct transition fails without contract proof (RPC path)', async () => {
    // Fresh app: interviewing → sent → accepted → onboarding. NO contract.
    const app = await submitApply(db, IDS.driverD, IDS.opportunity, 'h-key-driver-d');
    await transitionToInterviewing(db, app, IDS.recruiterUser);
    await asAuth(db, IDS.recruiterUser);
    await db.query(
      `SELECT * FROM public.save_opportunity_offer_draft($1::uuid,'pay',1800,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
      [app],
    );
    const d = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_offers WHERE application_id=$1 AND status='draft'`, [app]);
    await db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [d.rows[0].id]);
    await asOwner(db);
    await asAuth(db, IDS.driverD);
    await db.query(`SELECT * FROM public.accept_opportunity_offer($1::uuid)`, [d.rows[0].id]);
    await asOwner(db);
    // No contract seeded — must reject.
    await asAuth(db, IDS.recruiterUser);
    await expect(
      db.query(`SELECT * FROM public.complete_hiring($1::uuid)`, [app]),
    ).rejects.toThrow(/contract required/i);
    await asOwner(db);
  });

  it('i. first send produces exactly one offer_sent event and one driver notification', async () => {
    const app = await submitApply(db, IDS.driverE, IDS.opportunity, 'i-key-driver-e');
    await transitionToInterviewing(db, app, IDS.recruiterUser);
    await asAuth(db, IDS.recruiterUser);
    await db.query(
      `SELECT * FROM public.save_opportunity_offer_draft($1::uuid,'pay',1800,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
      [app],
    );
    const d = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_offers WHERE application_id=$1 AND status='draft'`, [app]);
    await db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [d.rows[0].id]);
    await asOwner(db);

    const ev = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.application_events
        WHERE application_id=$1 AND event_type='offer_sent'`, [app]);
    expect(ev.rows[0].n).toBe('1');
    const nfy = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.notifications
        WHERE user_id='${IDS.driverE}' AND type='offer_sent'
          AND payload->>'application_id'=$1`, [app]);
    expect(nfy.rows[0].n).toBe('1');
  });

  it('j. expiration via decline and via cancel notifies driver and recruiter exactly once each', async () => {
    // Decline path: use existing driverE app (has sent offer from test i).
    const eApp = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications WHERE driver_user_id='${IDS.driverE}' AND opportunity_id='${IDS.opportunity}' LIMIT 1`);
    const appE = eApp.rows[0].id;
    const eOff = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_offers WHERE application_id=$1 AND status='sent' LIMIT 1`, [appE]);
    const offerE = eOff.rows[0].id;
    // Force expiry in past by disabling offer guard.
    await db.exec(`ALTER TABLE public.opportunity_offers DISABLE TRIGGER trg_opportunity_offers_guard; ALTER TABLE public.opportunity_offers DROP CONSTRAINT IF EXISTS opportunity_offers_sent_expiry_chk;`);
    await db.query(`UPDATE public.opportunity_offers SET expires_at = now() - interval '1 hour' WHERE id=$1`, [offerE]);
    await db.exec(`ALTER TABLE public.opportunity_offers ENABLE TRIGGER trg_opportunity_offers_guard;`);
    await asAuth(db, IDS.driverE);
    const r1 = await db.query<{ result_code: string; offer_status: string }>(
      `SELECT * FROM public.decline_opportunity_offer($1::uuid, 'past')`, [offerE]);
    expect(r1.rows[0].result_code).toBe('offer_expired');
    await asOwner(db);

    const evD = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.application_events WHERE application_id=$1 AND event_type='offer_expired'`, [appE]);
    expect(evD.rows[0].n).toBe('1');
    const nDr = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.notifications
        WHERE user_id='${IDS.driverE}' AND type='offer_expired' AND payload->>'offer_id'=$1`, [offerE]);
    expect(nDr.rows[0].n).toBe('1');
    const nRc = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.notifications
        WHERE user_id='${IDS.recruiterUser}' AND type='offer_expired' AND payload->>'offer_id'=$1`, [offerE]);
    expect(nRc.rows[0].n).toBe('1');

    // Cancel path: create a fresh app + sent offer, expire it, recruiter calls cancel.
    const jDriver = '99991111-9999-1111-9999-111111111111';
    await db.exec(`
      INSERT INTO auth.users(id,email) VALUES ('${jDriver}','j@t');
      INSERT INTO public.driver_opportunity_profiles(user_id,full_name,cdl_class,years_experience,contact_preference,visibility,profile_completed)
      VALUES ('${jDriver}','J','A',5,'phone','apply_only',true);
    `);
    const appJ = await submitApply(db, jDriver, IDS.opportunity, 'j-cancel-key');
    await transitionToInterviewing(db, appJ, IDS.recruiterUser);
    await asAuth(db, IDS.recruiterUser);
    await db.query(
      `SELECT * FROM public.save_opportunity_offer_draft($1::uuid,'pay',1800,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
      [appJ]);
    const dj = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_offers WHERE application_id=$1 AND status='draft'`, [appJ]);
    await db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [dj.rows[0].id]);
    await asOwner(db);
    await db.exec(`ALTER TABLE public.opportunity_offers DISABLE TRIGGER trg_opportunity_offers_guard; ALTER TABLE public.opportunity_offers DROP CONSTRAINT IF EXISTS opportunity_offers_sent_expiry_chk;`);
    await db.query(`UPDATE public.opportunity_offers SET expires_at = now() - interval '1 hour' WHERE id=$1`, [dj.rows[0].id]);
    await db.exec(`ALTER TABLE public.opportunity_offers ENABLE TRIGGER trg_opportunity_offers_guard;`);
    await asAuth(db, IDS.recruiterUser);
    const r2 = await db.query<{ result_code: string }>(
      `SELECT * FROM public.cancel_opportunity_offer($1::uuid, 'past')`, [dj.rows[0].id]);
    expect(r2.rows[0].result_code).toBe('offer_expired');
    await asOwner(db);

    const nDr2 = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.notifications
        WHERE user_id='${jDriver}' AND type='offer_expired' AND payload->>'offer_id'=$1`, [dj.rows[0].id]);
    expect(nDr2.rows[0].n).toBe('1');
    const nRc2 = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.notifications
        WHERE user_id='${IDS.recruiterUser}' AND type='offer_expired' AND payload->>'offer_id'=$1`, [dj.rows[0].id]);
    expect(nRc2.rows[0].n).toBe('1');
  });

  it('k. two application withdrawals create two recruiter notifications; retrying one creates no duplicate', async () => {
    const kDriver1 = 'aaaaeeee-aaaa-eeee-aaaa-eeeeeeeeeeee';
    const kDriver2 = 'bbbbeeee-bbbb-eeee-bbbb-eeeeeeeeeeee';
    await db.exec(`
      INSERT INTO auth.users(id,email) VALUES ('${kDriver1}','k1@t'),('${kDriver2}','k2@t');
      INSERT INTO public.driver_opportunity_profiles(user_id,full_name,cdl_class,years_experience,contact_preference,visibility,profile_completed) VALUES
        ('${kDriver1}','K1','A',5,'phone','apply_only',true),
        ('${kDriver2}','K2','A',5,'phone','apply_only',true);
    `);
    const appK1 = await submitApply(db, kDriver1, IDS.opportunity, 'k1-driver-key-01');
    const appK2 = await submitApply(db, kDriver2, IDS.opportunity, 'k2-driver-key-02');

    await asAuth(db, kDriver1);
    await db.query(`SELECT public.withdraw_opportunity_application($1::uuid)`, [appK1]);
    await asOwner(db);
    await asAuth(db, kDriver2);
    await db.query(`SELECT public.withdraw_opportunity_application($1::uuid)`, [appK2]);
    await asOwner(db);

    const nfy = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.notifications
        WHERE user_id='${IDS.recruiterUser}' AND type='application_withdrawn'
          AND payload->>'application_id' IN ($1,$2)`, [appK1, appK2]);
    expect(nfy.rows[0].n).toBe('2');

    // Retry driver 1 withdrawal — should not create a duplicate notification.
    await asAuth(db, kDriver1);
    await db.query(`SELECT public.withdraw_opportunity_application($1::uuid)`, [appK1]);
    await asOwner(db);
    const nfy2 = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.notifications
        WHERE user_id='${IDS.recruiterUser}' AND type='application_withdrawn'
          AND payload->>'application_id'=$1`, [appK1]);
    expect(nfy2.rows[0].n).toBe('1');
  });
});

// ---------------------------------------------------------------------
// Phase 2B-1 checkpoint suite — authorization ordering, canonical
// recruiter eligibility, foreign-state disclosure. All tests execute the
// exact M2 candidate SQL loaded in beforeAll (no embedded replacements).
// ---------------------------------------------------------------------
describe('Phase 1H-M2 Phase 2B-1: recruiter authorization + disclosure', () => {
  // Suspended recruiter fixture: complete profile but status=suspended.
  const SUSP_USER = 'f1111111-f111-f111-f111-f11111111111';
  const SUSP_PROF = 'f2222222-f222-f222-f222-f22222222222';
  const SUSP_OPP  = 'f3333333-f333-f333-f333-f33333333333';
  const SUSP_DRV  = 'f4444444-f444-f444-f444-f44444444444';

  beforeAll(async () => {
    await db.exec(`
      INSERT INTO auth.users(id,email) VALUES
        ('${SUSP_USER}','susp-r@t'),
        ('${SUSP_DRV}','susp-d@t')
      ON CONFLICT DO NOTHING;
      INSERT INTO public.recruiter_profiles(
        id,user_id,recruiter_name,recruiter_email,company_name,dot_number,
        posting_terms_accepted_at,posting_terms_version,verification_status,status
      ) VALUES (
        '${SUSP_PROF}','${SUSP_USER}','Susp Recruiter','susp-r@t','Susp Co','DOTS',
        now(),'2026-07-17.v1','approved','suspended'
      );
      INSERT INTO public.opportunities(
        id,recruiter_id,title,company_name,hiring_city,hiring_state,driver_type,route_type,trailer_type,
        pay_model,cpm,estimated_weekly_gross,estimated_weekly_miles,status,admin_review_status
      ) VALUES (
        '${SUSP_OPP}','${SUSP_PROF}','Susp OTR','Susp Co','Dallas','TX','company','regional','dry_van',
        'cpm',0.62,1800,2800,'active','approved'
      );
      INSERT INTO public.driver_opportunity_profiles(user_id,full_name,cdl_class,years_experience,contact_preference,visibility,profile_completed)
      VALUES ('${SUSP_DRV}','S','A',5,'phone','apply_only',true);
      -- Seed apply row directly (RLS driver_can_access_opportunity would fail on suspended recruiter).
      INSERT INTO public.opportunity_applications(
        id, opportunity_id, driver_user_id, recruiter_id, application_type, status,
        submission_snapshot, snapshot_version, idempotency_key, submitted_at, is_legacy,
        preferred_contact_method, contact_sharing_consent, contact_sharing_consent_at
      ) VALUES (
        'f5555555-f555-f555-f555-f55555555555',
        '${SUSP_OPP}','${SUSP_DRV}','${SUSP_PROF}',
        'apply','interviewing', jsonb_build_object('seed',true), 1, 'susp-seed-key-1234',
        now(), false, 'phone', true, now()
      );
    `);
  });

  const SUSP_APP = 'f5555555-f555-f555-f555-f55555555555';

  // ---------- send_opportunity_offer ----------
  it('send: unauthenticated caller is denied', async () => {
    await asOwner(db);
    // Seed a sent offer via owner + trusted RPC path (owner runs as superuser,
    // authorization guard checks auth.uid()=NULL → denied path is
    // "authentication required".)
    // Use the pre-existing driverE sent offer.
    const off = await db.query<{ id: string }>(
      `SELECT o.id FROM public.opportunity_offers o
        JOIN public.opportunity_applications a ON a.id=o.application_id
        WHERE a.driver_user_id='${IDS.driverE}' LIMIT 1`);
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
    await db.exec(`SET ROLE authenticated;`); // no jwt.sub set
    await expect(
      db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [off.rows[0].id]),
    ).rejects.toThrow(/authentication required/i);
    await asOwner(db);
  });

  it('send: suspended recruiter (owner) is denied with recruiter-not-eligible', async () => {
    // Seed a draft on the suspended-recruiter application as owner (bypasses RPC gating).
    const draftId = 'f6666666-f666-f666-f666-f66666666666';
    await db.exec(`
      INSERT INTO public.opportunity_offers(
        id, application_id, opportunity_id, driver_user_id, recruiter_id, status,
        pay_description, estimated_weekly_amount, created_by
      ) VALUES (
        '${draftId}','${SUSP_APP}','${SUSP_OPP}','${SUSP_DRV}','${SUSP_PROF}',
        'draft','pay',1800,'${SUSP_USER}'
      );
    `);
    await asAuth(db, SUSP_USER);
    await expect(
      db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [draftId]),
    ).rejects.toThrow(/recruiter not eligible/i);
    await asOwner(db);
  });

  it('send: driver cannot obtain already_sent for a sent offer they received', async () => {
    const off = await db.query<{ id: string }>(
      `SELECT o.id FROM public.opportunity_offers o
        JOIN public.opportunity_applications a ON a.id=o.application_id
        WHERE a.driver_user_id='${IDS.driverE}' AND o.status IN ('sent','expired') LIMIT 1`);
    await asAuth(db, IDS.driverE);
    await expect(
      db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [off.rows[0].id]),
    ).rejects.toThrow(/not authorized/i);
    await asOwner(db);
  });

  // ---------- complete_hiring ----------
  it('complete_hiring: unauthenticated caller is denied', async () => {
    // Use appC (already hired in test b).
    const r = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id='${IDS.driverC}' AND status='hired' LIMIT 1`);
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
    await db.exec(`SET ROLE authenticated;`);
    await expect(
      db.query(`SELECT * FROM public.complete_hiring($1::uuid)`, [r.rows[0].id]),
    ).rejects.toThrow(/authentication required/i);
    await asOwner(db);
  });

  it('complete_hiring: suspended recruiter denied (recruiter-not-eligible) — no already_hired leak', async () => {
    // Force suspended-recruiter application to hired directly as owner to prove
    // suspended recruiter cannot use idempotent already_hired to confirm state.
    await db.exec(`
      ALTER TABLE public.opportunity_applications DISABLE TRIGGER opportunity_applications_update_guard_trigger;
      UPDATE public.opportunity_applications SET status='hired', updated_at=now() WHERE id='${SUSP_APP}';
      ALTER TABLE public.opportunity_applications ENABLE TRIGGER opportunity_applications_update_guard_trigger;
    `);
    await asAuth(db, SUSP_USER);
    await expect(
      db.query(`SELECT * FROM public.complete_hiring($1::uuid)`, [SUSP_APP]),
    ).rejects.toThrow(/recruiter not eligible/i);
    await asOwner(db);
  });

  it('complete_hiring: incomplete recruiter denied', async () => {
    // Fresh driver on incompleteOpportunity to avoid unique-active-apply collision.
    const incDriver = 'f7d7d7d7-f7d7-d7d7-f7d7-d7d7d7d7d7d7';
    const rowId = 'f7777777-f777-f777-f777-f77777777777';
    await db.exec(`
      INSERT INTO auth.users(id,email) VALUES ('${incDriver}','inch@t') ON CONFLICT DO NOTHING;
      INSERT INTO public.driver_opportunity_profiles(user_id,full_name,cdl_class,years_experience,contact_preference,visibility,profile_completed)
      VALUES ('${incDriver}','Inch','A',5,'phone','apply_only',true);
      INSERT INTO public.opportunity_applications(
        id, opportunity_id, driver_user_id, recruiter_id, application_type, status,
        submission_snapshot, snapshot_version, idempotency_key, submitted_at, is_legacy,
        preferred_contact_method, contact_sharing_consent, contact_sharing_consent_at
      ) VALUES (
        '${rowId}','${IDS.incompleteOpportunity}','${incDriver}','${IDS.incompleteRecruiterProfile}',
        'apply','hired', jsonb_build_object('seed',true), 1, 'inc-hired-seed-key',
        now(), false, 'phone', true, now()
      );
    `);
    await asAuth(db, IDS.incompleteRecruiterUser);
    await expect(
      db.query(`SELECT * FROM public.complete_hiring($1::uuid)`, [rowId]),
    ).rejects.toThrow(/recruiter not eligible/i);
    await asOwner(db);
  });

  it('complete_hiring: driver cannot obtain already_hired', async () => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id='${IDS.driverC}' AND status='hired' LIMIT 1`);
    await asAuth(db, IDS.driverC);
    await expect(
      db.query(`SELECT * FROM public.complete_hiring($1::uuid)`, [r.rows[0].id]),
    ).rejects.toThrow(/not authorized/i);
    await asOwner(db);
  });

  // ---------- transition_opportunity_application ----------
  it('transition: unauthenticated denied; foreign, incomplete, suspended recruiters denied', async () => {
    // Use SUSP_APP (still interviewing before earlier direct hire flip? Now hired).
    // Seed a fresh interviewing row on owning recruiter for transition target.
    const tRow = 'f8888888-f888-f888-f888-f88888888888';
    const tDriver = 'f8d8d8d8-f8d8-d8d8-f8d8-d8d8d8d8d8d8';
    await db.exec(`
      INSERT INTO auth.users(id,email) VALUES ('${tDriver}','td@t') ON CONFLICT DO NOTHING;
      INSERT INTO public.driver_opportunity_profiles(user_id,full_name,cdl_class,years_experience,contact_preference,visibility,profile_completed)
      VALUES ('${tDriver}','Td','A',5,'phone','apply_only',true);
      INSERT INTO public.opportunity_applications(
        id, opportunity_id, driver_user_id, recruiter_id, application_type, status,
        submission_snapshot, snapshot_version, idempotency_key, submitted_at, is_legacy,
        preferred_contact_method, contact_sharing_consent, contact_sharing_consent_at
      ) VALUES (
        '${tRow}','${IDS.opportunity}','${tDriver}','${IDS.recruiterProfile}',
        'apply','interviewing', jsonb_build_object('seed',true), 1, 'transition-seed-key-1',
        now(), false, 'phone', true, now()
      );
    `);
    // Unauthenticated
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
    await db.exec(`SET ROLE authenticated;`);
    await expect(
      db.query(`SELECT * FROM public.transition_opportunity_application($1::uuid,'rejected',NULL)`, [tRow]),
    ).rejects.toThrow(/authentication required/i);
    // Foreign
    await asAuth(db, IDS.foreignRecruiterUser);
    await expect(
      db.query(`SELECT * FROM public.transition_opportunity_application($1::uuid,'rejected',NULL)`, [tRow]),
    ).rejects.toThrow(/not authorized/i);
    // Incomplete (owns a different recruiter — treated as foreign to this app)
    await asAuth(db, IDS.incompleteRecruiterUser);
    await expect(
      db.query(`SELECT * FROM public.transition_opportunity_application($1::uuid,'rejected',NULL)`, [tRow]),
    ).rejects.toThrow(/not authorized/i);
    // Suspended recruiter user (foreign to this row)
    await asAuth(db, SUSP_USER);
    await expect(
      db.query(`SELECT * FROM public.transition_opportunity_application($1::uuid,'rejected',NULL)`, [tRow]),
    ).rejects.toThrow(/not authorized/i);
    await asOwner(db);
  });

  it('transition: owning suspended recruiter denied with recruiter-not-eligible on their own app', async () => {
    // SUSP_APP is now status='hired' (terminal); reset to interviewing to test transition path.
    await db.exec(`ALTER TABLE public.opportunity_applications DISABLE TRIGGER opportunity_applications_update_guard_trigger; UPDATE public.opportunity_applications SET status='interviewing', updated_at=now() WHERE id='${SUSP_APP}'; ALTER TABLE public.opportunity_applications ENABLE TRIGGER opportunity_applications_update_guard_trigger;`);
    await asAuth(db, SUSP_USER);
    await expect(
      db.query(`SELECT * FROM public.transition_opportunity_application($1::uuid,'rejected',NULL)`, [SUSP_APP]),
    ).rejects.toThrow(/recruiter not eligible/i);
    await asOwner(db);
  });

  // ---------- cancel_opportunity_offer ----------
  it('cancel: foreign, unauthenticated, suspended recruiters denied', async () => {
    // Seed a fresh sent offer on owning recruiter to have something targetable.
    const cDriver = 'f9999999-f999-f999-f999-f99999999999';
    await db.exec(`
      INSERT INTO auth.users(id,email) VALUES ('${cDriver}','cx@t') ON CONFLICT DO NOTHING;
      INSERT INTO public.driver_opportunity_profiles(user_id,full_name,cdl_class,years_experience,contact_preference,visibility,profile_completed)
      VALUES ('${cDriver}','Cx','A',5,'phone','apply_only',true);
    `);
    const cApp = await submitApply(db, cDriver, IDS.opportunity, 'cancel-focus-key-1');
    await transitionToInterviewing(db, cApp, IDS.recruiterUser);
    await asAuth(db, IDS.recruiterUser);
    await db.query(`SELECT * FROM public.save_opportunity_offer_draft($1::uuid,'pay',1800,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`, [cApp]);
    const d = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_offers WHERE application_id=$1 AND status='draft'`, [cApp]);
    await db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [d.rows[0].id]);
    await asOwner(db);
    const offerId = d.rows[0].id;

    // Unauthenticated
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
    await db.exec(`SET ROLE authenticated;`);
    await expect(
      db.query(`SELECT * FROM public.cancel_opportunity_offer($1::uuid,NULL)`, [offerId]),
    ).rejects.toThrow(/authentication required/i);
    // Foreign
    await asAuth(db, IDS.foreignRecruiterUser);
    await expect(
      db.query(`SELECT * FROM public.cancel_opportunity_offer($1::uuid,NULL)`, [offerId]),
    ).rejects.toThrow(/not authorized/i);
    // Suspended (foreign to this offer)
    await asAuth(db, SUSP_USER);
    await expect(
      db.query(`SELECT * FROM public.cancel_opportunity_offer($1::uuid,NULL)`, [offerId]),
    ).rejects.toThrow(/not authorized/i);
    // Driver (owner of app) still denied — cancel is recruiter-only.
    await asAuth(db, cDriver);
    await expect(
      db.query(`SELECT * FROM public.cancel_opportunity_offer($1::uuid,NULL)`, [offerId]),
    ).rejects.toThrow(/not authorized/i);
    await asOwner(db);
  });

  // ---------- save_opportunity_offer_draft ----------
  it('draft: unauthenticated denied; suspended-owner denied with recruiter-not-eligible', async () => {
    // Unauth on SUSP_APP
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
    await db.exec(`SET ROLE authenticated;`);
    await expect(
      db.query(`SELECT * FROM public.save_opportunity_offer_draft($1::uuid,'pay',1800,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`, [SUSP_APP]),
    ).rejects.toThrow(/authentication required/i);
    // Suspended owner
    await asAuth(db, SUSP_USER);
    await expect(
      db.query(`SELECT * FROM public.save_opportunity_offer_draft($1::uuid,'pay',1800,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`, [SUSP_APP]),
    ).rejects.toThrow(/recruiter not eligible/i);
    await asOwner(db);
  });

  // ---------- disclosure consistency ----------
  it('denial errors expose no application/offer IDs, statuses, or terms', async () => {
    // Get real IDs to make sure they're not present in error messages.
    const off = await db.query<{ id: string; application_id: string }>(
      `SELECT o.id, o.application_id FROM public.opportunity_offers o
        JOIN public.opportunity_applications a ON a.id=o.application_id
        WHERE a.driver_user_id='${IDS.driverE}' LIMIT 1`);
    const offerId = off.rows[0].id;
    const appId2 = off.rows[0].application_id;

    const captureError = async (fn: () => Promise<unknown>): Promise<string> => {
      try { await fn(); return ''; }
      catch (e) { return (e as Error).message ?? String(e); }
    };

    await asAuth(db, IDS.foreignRecruiterUser);
    const m1 = await captureError(() =>
      db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [offerId]));
    const m2 = await captureError(() =>
      db.query(`SELECT * FROM public.complete_hiring($1::uuid)`, [appId2]));
    const m3 = await captureError(() =>
      db.query(`SELECT * FROM public.cancel_opportunity_offer($1::uuid,NULL)`, [offerId]));
    await asOwner(db);

    for (const m of [m1, m2, m3]) {
      expect(m).toMatch(/not authorized/i);
      expect(m).not.toContain(offerId);
      expect(m).not.toContain(appId2);
      expect(m.toLowerCase()).not.toContain('already_sent');
      expect(m.toLowerCase()).not.toContain('already_hired');
      expect(m.toLowerCase()).not.toContain('already_canceled');
      expect(m.toLowerCase()).not.toContain('offer_sent');
      expect(m.toLowerCase()).not.toContain('onboarding');
    }
  });

  // -----------------------------------------------------------------------
  // Phase 2B-1 correction: private record existence must not leak.
  // Foreign existing ID and nonexistent random ID MUST return the same
  // public-safe not-authorized denial (no offer/application-not-found,
  // no already_sent/already_hired, no IDs/statuses).
  // -----------------------------------------------------------------------

  const captureErr = async (fn: () => Promise<unknown>): Promise<string> => {
    try { await fn(); return ''; } catch (e) { return (e as Error).message ?? String(e); }
  };

  it('send_opportunity_offer: foreign existing offer ID and nonexistent ID return same public-safe denial', async () => {
    // Seed a sent offer under owning recruiter.
    const zDriver = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
    await asOwner(db);
    await db.exec(`
      INSERT INTO auth.users(id,email) VALUES ('${zDriver}','z1@t') ON CONFLICT DO NOTHING;
      INSERT INTO public.driver_opportunity_profiles(user_id,full_name,cdl_class,years_experience,contact_preference,visibility,profile_completed)
      VALUES ('${zDriver}','Z1','A',5,'phone','apply_only',true);
    `);
    const zApp = await submitApply(db, zDriver, IDS.opportunity, 'z1-existence-key');
    await transitionToInterviewing(db, zApp, IDS.recruiterUser);
    await asAuth(db, IDS.recruiterUser);
    const draft = await db.query(
      `SELECT * FROM public.save_opportunity_offer_draft($1::uuid, '$0.62 CPM')`,
      [zApp]);
    const existingOfferId = draft.rows[0].offer_id as string;

    await asAuth(db, IDS.foreignRecruiterUser);
    const nonexistent = '99999999-9999-9999-9999-999999999999';
    const foreignMsg = await captureErr(() =>
      db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [existingOfferId]));
    const missingMsg = await captureErr(() =>
      db.query(`SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [nonexistent]));
    await asOwner(db);

    expect(foreignMsg).toMatch(/not authorized/i);
    expect(missingMsg).toMatch(/not authorized/i);
    expect(foreignMsg).toBe(missingMsg);
    for (const m of [foreignMsg, missingMsg]) {
      expect(m.toLowerCase()).not.toContain('offer not found');
      expect(m.toLowerCase()).not.toContain('already_sent');
      expect(m).not.toContain(existingOfferId);
      expect(m).not.toContain(zApp);
      expect(m.toLowerCase()).not.toContain('draft');
      expect(m.toLowerCase()).not.toContain('sent');
    }
  });

  it('complete_hiring: foreign existing app ID and nonexistent ID return same public-safe denial', async () => {
    // Seed a hired application under owning recruiter (bypass guard for setup).
    const zDriver2 = 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2';
    const zApp2 = 'a2222222-a222-a222-a222-a22222222222';
    await asOwner(db);
    await db.exec(`
      INSERT INTO auth.users(id,email) VALUES ('${zDriver2}','z2@t') ON CONFLICT DO NOTHING;
      INSERT INTO public.driver_opportunity_profiles(user_id,full_name,cdl_class,years_experience,contact_preference,visibility,profile_completed)
      VALUES ('${zDriver2}','Z2','A',5,'phone','apply_only',true);
      ALTER TABLE public.opportunity_applications DISABLE TRIGGER opportunity_applications_update_guard_trigger;
      INSERT INTO public.opportunity_applications(
        id, opportunity_id, driver_user_id, recruiter_id, application_type, status,
        submission_snapshot, snapshot_version, idempotency_key, submitted_at, is_legacy,
        preferred_contact_method, contact_sharing_consent, contact_sharing_consent_at
      ) VALUES (
        '${zApp2}','${IDS.opportunity}','${zDriver2}','${IDS.recruiterProfile}',
        'apply','hired', jsonb_build_object('seed',true), 1, 'z2-exist-key',
        now(), false, 'phone', true, now()
      );
      ALTER TABLE public.opportunity_applications ENABLE TRIGGER opportunity_applications_update_guard_trigger;
    `);

    await asAuth(db, IDS.foreignRecruiterUser);
    const nonexistent = '88888888-8888-8888-8888-888888888888';
    const foreignMsg = await captureErr(() =>
      db.query(`SELECT * FROM public.complete_hiring($1::uuid)`, [zApp2]));
    const missingMsg = await captureErr(() =>
      db.query(`SELECT * FROM public.complete_hiring($1::uuid)`, [nonexistent]));
    await asOwner(db);

    expect(foreignMsg).toMatch(/not authorized/i);
    expect(missingMsg).toMatch(/not authorized/i);
    expect(foreignMsg).toBe(missingMsg);
    for (const m of [foreignMsg, missingMsg]) {
      expect(m.toLowerCase()).not.toContain('application not found');
      expect(m.toLowerCase()).not.toContain('already_hired');
      expect(m).not.toContain(zApp2);
      expect(m.toLowerCase()).not.toContain('hired');
      expect(m.toLowerCase()).not.toContain('onboarding');
    }
  });

  it('eligible owner still reaches already_sent and already_hired after lookup change', async () => {
    // already_sent path
    const oDriver = 'a3a3a3a3-a3a3-a3a3-a3a3-a3a3a3a3a3a3';
    await asOwner(db);
    await db.exec(`
      INSERT INTO auth.users(id,email) VALUES ('${oDriver}','o3@t') ON CONFLICT DO NOTHING;
      INSERT INTO public.driver_opportunity_profiles(user_id,full_name,cdl_class,years_experience,contact_preference,visibility,profile_completed)
      VALUES ('${oDriver}','O3','A',5,'phone','apply_only',true);
    `);
    const oApp = await submitApply(db, oDriver, IDS.opportunity, 'o3-owner-reach-key');
    await transitionToInterviewing(db, oApp, IDS.recruiterUser);
    await asAuth(db, IDS.recruiterUser);
    const draft = await db.query(
      `SELECT * FROM public.save_opportunity_offer_draft($1::uuid, '$0.62 CPM')`,
      [oApp]);
    const offerId = draft.rows[0].offer_id as string;
    await db.query(
      `SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [offerId]);
    const r1 = await db.query(
      `SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [offerId]);
    expect(r1.rows[0].result_code).toBe('already_sent');

    // already_hired path
    const hDriver = 'a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4';
    const hApp = 'a4444444-a444-a444-a444-a44444444444';
    await asOwner(db);
    await db.exec(`
      INSERT INTO auth.users(id,email) VALUES ('${hDriver}','h4@t') ON CONFLICT DO NOTHING;
      INSERT INTO public.driver_opportunity_profiles(user_id,full_name,cdl_class,years_experience,contact_preference,visibility,profile_completed)
      VALUES ('${hDriver}','H4','A',5,'phone','apply_only',true);
      ALTER TABLE public.opportunity_applications DISABLE TRIGGER opportunity_applications_update_guard_trigger;
      INSERT INTO public.opportunity_applications(
        id, opportunity_id, driver_user_id, recruiter_id, application_type, status,
        submission_snapshot, snapshot_version, idempotency_key, submitted_at, is_legacy,
        preferred_contact_method, contact_sharing_consent, contact_sharing_consent_at
      ) VALUES (
        '${hApp}','${IDS.opportunity}','${hDriver}','${IDS.recruiterProfile}',
        'apply','hired', jsonb_build_object('seed',true), 1, 'h4-owner-reach-key',
        now(), false, 'phone', true, now()
      );
      ALTER TABLE public.opportunity_applications ENABLE TRIGGER opportunity_applications_update_guard_trigger;
    `);
    await asAuth(db, IDS.recruiterUser);
    const r2 = await db.query(`SELECT * FROM public.complete_hiring($1::uuid)`, [hApp]);
    expect(r2.rows[0].result_code).toBe('already_hired');
    await asOwner(db);
  });
});

// =====================================================================
// Phase 1H-M2 Phase 2B-2 — trusted workflow spoof resistance and
// sensitive-status relational invariants. Loads the same M2 candidate
// migration executed above (no embedded SQL). Uses real role switching
// via SET ROLE authenticated + request.jwt.claim.sub. Superuser only for
// non-authorization fixture seeding, clearly separated.
// =====================================================================
describe('Phase 1H-M2 Phase 2B-2: spoof resistance + relational invariants', () => {
  // Isolated recruiter+driver fixture for this suite.
  const R_USER = 'b2000000-b200-b200-b200-b20000000001';
  const R_PROF = 'b2000000-b200-b200-b200-b20000000002';
  const OPP    = 'b2000000-b200-b200-b200-b20000000003';
  const DRV_A  = 'b2000000-b200-b200-b200-b200000000aa';
  const DRV_B  = 'b2000000-b200-b200-b200-b200000000bb';
  const DRV_C  = 'b2000000-b200-b200-b200-b200000000cc';
  const DRV_D  = 'b2000000-b200-b200-b200-b200000000dd';
  const DRV_E  = 'b2000000-b200-b200-b200-b200000000ee';
  const DRV_F  = 'b2000000-b200-b200-b200-b200000000ff';
  const DRV_G  = 'b2000000-b200-b200-b200-b20000000abc';
  const DRV_H  = 'b2000000-b200-b200-b200-b20000000def';
  const DRV_I  = 'b2000000-b200-b200-b200-b20000000012';
  const DRV_J  = 'b2000000-b200-b200-b200-b20000000034';
  const DRV_K  = 'b2000000-b200-b200-b200-b20000000045';
  const DRV_L  = 'b2000000-b200-b200-b200-b20000000056';
  const DRV_M  = 'b2000000-b200-b200-b200-b20000000067';
  const DRV_N  = 'b2000000-b200-b200-b200-b20000000078';
  const DRV_O  = 'b2000000-b200-b200-b200-b20000000089';
  const DRV_P  = 'b2000000-b200-b200-b200-b2000000009a';
  const DRV_Q  = 'b2000000-b200-b200-b200-b2000000009b';
  const DRV_R  = 'b2000000-b200-b200-b200-b2000000009c';
  // Alt recruiter + opportunity fixture used by the immutability test to
  // prove that the guard rejects a real identity change (not the same values).
  const ALT_R_USER = 'b2000000-b200-b200-b200-b200000000a1';
  const ALT_R_PROF = 'b2000000-b200-b200-b200-b200000000a2';
  const ALT_OPP    = 'b2000000-b200-b200-b200-b200000000a3';

  beforeAll(async () => {
    await asOwner(db);
    await db.exec(`
      INSERT INTO auth.users(id,email) VALUES
        ('${R_USER}','b2-r@t'),
        ('${DRV_A}','b2-a@t'),('${DRV_B}','b2-b@t'),('${DRV_C}','b2-c@t'),
        ('${DRV_D}','b2-d@t'),('${DRV_E}','b2-e@t'),('${DRV_F}','b2-f@t'),
        ('${DRV_G}','b2-g@t'),('${DRV_H}','b2-h@t'),('${DRV_I}','b2-i@t'),
        ('${DRV_J}','b2-j@t'),('${DRV_K}','b2-k@t'),('${DRV_L}','b2-l@t'),
        ('${DRV_M}','b2-m@t'),('${DRV_N}','b2-n@t'),
        ('${DRV_O}','b2-o@t'),('${DRV_P}','b2-p@t'),('${DRV_Q}','b2-q@t'),
        ('${ALT_R_USER}','b2-alt-r@t')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.recruiter_profiles(
        id,user_id,recruiter_name,recruiter_email,company_name,dot_number,
        posting_terms_accepted_at,posting_terms_version,verification_status,status
      ) VALUES
        ('${R_PROF}','${R_USER}','B2 Recruiter','b2-r@t','B2 Co','DOTB2',
         now(),'2026-07-17.v1','approved','active'),
        ('${ALT_R_PROF}','${ALT_R_USER}','B2 Alt Recruiter','b2-alt-r@t','B2 Alt Co','DOTB2ALT',
         now(),'2026-07-17.v1','approved','active')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.opportunities(
        id,recruiter_id,title,company_name,hiring_city,hiring_state,driver_type,route_type,trailer_type,
        pay_model,cpm,estimated_weekly_gross,estimated_weekly_miles,status,admin_review_status
      ) VALUES
        ('${OPP}','${R_PROF}','B2 OTR','B2 Co','Dallas','TX','company','regional','dry_van',
         'cpm',0.62,1800,2800,'active','approved'),
        ('${ALT_OPP}','${ALT_R_PROF}','B2 Alt OTR','B2 Alt Co','Dallas','TX','company','regional','dry_van',
         'cpm',0.62,1800,2800,'active','approved')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.driver_opportunity_profiles(user_id,full_name,cdl_class,years_experience,contact_preference,visibility,profile_completed)
      VALUES
        ('${DRV_A}','A','A',5,'phone','apply_only',true),
        ('${DRV_B}','B','A',5,'phone','apply_only',true),
        ('${DRV_C}','C','A',5,'phone','apply_only',true),
        ('${DRV_D}','D','A',5,'phone','apply_only',true),
        ('${DRV_E}','E','A',5,'phone','apply_only',true),
        ('${DRV_F}','F','A',5,'phone','apply_only',true),
        ('${DRV_G}','G','A',5,'phone','apply_only',true),
        ('${DRV_H}','H','A',5,'phone','apply_only',true),
        ('${DRV_I}','I','A',5,'phone','apply_only',true),
        ('${DRV_J}','J','A',5,'phone','apply_only',true),
        ('${DRV_K}','K','A',5,'phone','apply_only',true),
        ('${DRV_L}','L','A',5,'phone','apply_only',true),
        ('${DRV_M}','M','A',5,'phone','apply_only',true),
        ('${DRV_N}','N','A',5,'phone','apply_only',true),
        ('${DRV_O}','O','A',5,'phone','apply_only',true),
        ('${DRV_P}','P','A',5,'phone','apply_only',true),
        ('${DRV_Q}','Q','A',5,'phone','apply_only',true)
      ON CONFLICT DO NOTHING;
    `);
  });

  // Helper: seed an application at a chosen status by inserting with the
  // guard trigger temporarily disabled. Used ONLY to construct historical
  // fixture state; every authorization/invariant assertion in this block
  // is made with all triggers active.
  async function seedApp(id: string, driver: string, status: string, key: string): Promise<void> {
    await asOwner(db);
    await db.exec(`
      ALTER TABLE public.opportunity_applications DISABLE TRIGGER opportunity_applications_update_guard_trigger;
      INSERT INTO public.opportunity_applications(
        id, opportunity_id, driver_user_id, recruiter_id, application_type, status,
        submission_snapshot, snapshot_version, idempotency_key, submitted_at, is_legacy,
        preferred_contact_method, contact_sharing_consent, contact_sharing_consent_at
      ) VALUES (
        '${id}','${OPP}','${driver}','${R_PROF}',
        'apply','${status}', jsonb_build_object('seed',true), 1, '${key}',
        now(), false, 'phone', true, now()
      );
      ALTER TABLE public.opportunity_applications ENABLE TRIGGER opportunity_applications_update_guard_trigger;
    `);
  }

  // -----------------------------------------------------------------
  // A. Grant / execute exposure (contract items 1–7)
  // -----------------------------------------------------------------
  it('A. authenticated and anon cannot read _m2_workflow_secret or invoke internal helpers', async () => {
    for (const role of ['authenticated', 'anon']) {
      await db.exec(`RESET ROLE; RESET request.jwt.claim.sub; SET ROLE ${role};`);
      await expect(db.query(`SELECT token FROM public._m2_workflow_secret`))
        .rejects.toThrow(/permission denied/i);
      await expect(db.query(`SELECT public._m2_workflow_token()`))
        .rejects.toThrow(/permission denied/i);
      await expect(db.query(`SELECT public._m2_workflow_bypass_active()`))
        .rejects.toThrow(/permission denied/i);
      await expect(db.query(`SELECT public._m2_driver_withdraw_active()`))
        .rejects.toThrow(/permission denied/i);
      await expect(db.query(
        `SELECT public._m2_set_application_status('00000000-0000-0000-0000-000000000000'::uuid, 'onboarding')`))
        .rejects.toThrow(/permission denied/i);
      await expect(db.query(
        `SELECT public._m2_set_application_withdrawn('00000000-0000-0000-0000-000000000000'::uuid)`))
        .rejects.toThrow(/permission denied/i);
    }
    await asOwner(db);
  });

  // -----------------------------------------------------------------
  // B. Direct spoof (contract items 8–14)
  // -----------------------------------------------------------------
  it('B. recruiter cannot spoof workflow_bypass_token (guessed / boolean / empty / malformed) for offer_sent, onboarding, hired', async () => {
    const APP = 'b2b21111-b2b2-1111-b2b2-b2b2b2b21111';
    await seedApp(APP, DRV_A, 'interviewing', 'b2-spoof-key-a');

    const spoofSettings = [
      `SET app.workflow_bypass_token = 'not-a-real-token'`,           // 8/9/10 guessed
      `SET app.workflow_bypass = 'true'`,                              // 12 boolean
      `SET app.workflow_bypass_token = ''`,                            // 14 empty
      `SET app.workflow_bypass_token = 'zzzz-not-a-uuid'`,             // 14 malformed
    ];
    for (const setStmt of spoofSettings) {
      await asAuth(db, R_USER);
      await db.exec(setStmt);
      for (const s of ['offer_sent','onboarding','hired']) {
        await expect(
          db.query(`UPDATE public.opportunity_applications SET status=$2::text WHERE id=$1`, [APP, s]),
        ).rejects.toThrow(/server-authorized workflow/i);
      }
      await db.exec(`RESET app.workflow_bypass_token; RESET app.workflow_bypass;`);
    }
    await asOwner(db);
    const chk = await db.query<{ status: string }>(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`, [APP]);
    expect(chk.rows[0].status).toBe('interviewing');
  });

  it('B. driver cannot spoof driver_withdraw_token (guessed / boolean allow_driver_withdraw)', async () => {
    // Drivers have no direct UPDATE policy on opportunity_applications, so
    // a spoofed UPDATE silently affects 0 rows. Prove the status is
    // unchanged, and that the RPC path is required.
    const APP = 'b2b22222-b2b2-2222-b2b2-b2b2b2b22222';
    await seedApp(APP, DRV_B, 'interviewing', 'b2-spoof-key-b');
    for (const setStmt of [
      `SET app.driver_withdraw_token = 'not-a-real-token'`,
      `SET app.allow_driver_withdraw = 'true'`,
      `SET app.driver_withdraw_token = ''`,
    ]) {
      await asAuth(db, DRV_B);
      await db.exec(setStmt);
      const r = await db.query<{ n: string }>(
        `WITH u AS (UPDATE public.opportunity_applications SET status='withdrawn' WHERE id=$1 RETURNING 1)
         SELECT COUNT(*)::text AS n FROM u`, [APP]);
      expect(r.rows[0].n).toBe('0');
      await db.exec(`RESET app.driver_withdraw_token; RESET app.allow_driver_withdraw;`);
    }
    await asOwner(db);
    const chk = await db.query<{ status: string }>(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`, [APP]);
    expect(chk.rows[0].status).toBe('interviewing');
  });

  // -----------------------------------------------------------------
  // C. Relational invariants (contract items 15–26)
  //    Force trigger to run with a REAL token but a broken relational
  //    prerequisite. Token is fetched under owner privileges only for
  //    trigger-input reproduction; caller identity remains the tested role.
  // -----------------------------------------------------------------
  async function realBypassToken(): Promise<string> {
    await asOwner(db);
    const t = await db.query<{ token: string }>(`SELECT token::text AS token FROM public._m2_workflow_secret LIMIT 1`);
    return t.rows[0].token;
  }

  it('C. offer_sent trigger requires a matching sent offer (identity-scoped)', async () => {
    const APP = 'b2b2c111-b2b2-c111-b2b2-b2b2b2b2c111';
    await seedApp(APP, DRV_C, 'interviewing', 'b2-c-offer-key');
    const tok = await realBypassToken();
    await asAuth(db, R_USER);
    await db.exec(`SET app.workflow_bypass_token = '${tok}'`);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='offer_sent' WHERE id=$1`, [APP]),
    ).rejects.toThrow(/matching sent offer/i);
    await db.exec(`RESET app.workflow_bypass_token`);
    await asOwner(db);
  });

  it('C. onboarding requires source=offer_sent AND matching accepted offer', async () => {
    const APP = 'b2b2c222-b2b2-c222-b2b2-b2b2b2b2c222';
    await seedApp(APP, DRV_N, 'interviewing', 'b2-c-onboard-key');
    const tok = await realBypassToken();
    // Wrong source state (interviewing → onboarding) fails.
    await asAuth(db, R_USER);
    await db.exec(`SET app.workflow_bypass_token = '${tok}'`);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='onboarding' WHERE id=$1`, [APP]),
    ).rejects.toThrow(/prior offer_sent/i);
    await db.exec(`RESET app.workflow_bypass_token`);
    await asOwner(db);

    // Now flip source to offer_sent (still no accepted offer) → must fail.
    await asOwner(db);
    await db.exec(`
      ALTER TABLE public.opportunity_applications DISABLE TRIGGER opportunity_applications_update_guard_trigger;
      UPDATE public.opportunity_applications SET status='offer_sent' WHERE id='${APP}';
      ALTER TABLE public.opportunity_applications ENABLE TRIGGER opportunity_applications_update_guard_trigger;
    `);
    await asAuth(db, R_USER);
    await db.exec(`SET app.workflow_bypass_token = '${tok}'`);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='onboarding' WHERE id=$1`, [APP]),
    ).rejects.toThrow(/accepted offer/i);
    await db.exec(`RESET app.workflow_bypass_token`);
    await asOwner(db);
  });

  it('C. hired requires accepted offer + contract + matching current_version + uploaded + approved|signed', async () => {
    // Fresh app in onboarding with an accepted offer.
    const APP = 'b2b2c333-b2b2-c333-b2b2-b2b2b2b2c333';
    await seedApp(APP, DRV_E, 'onboarding', 'b2-c-hire-key');
    // Seed accepted offer (matching identity) via owner.
    const OFF = 'b2b2c333-b2b2-c333-b2b2-b2b2b2b2caaa';
    await db.exec(`
      ALTER TABLE public.opportunity_offers DISABLE TRIGGER trg_opportunity_offers_guard;
      INSERT INTO public.opportunity_offers(id,application_id,opportunity_id,driver_user_id,recruiter_id,status,pay_description,created_by,accepted_at,sent_at,expires_at,sent_snapshot,snapshot_version)
      VALUES ('${OFF}','${APP}','${OPP}','${DRV_E}','${R_PROF}','accepted','pay','${R_USER}',now(),now() - interval '2 days',now() + interval '5 days',jsonb_build_object('seed',true),1);
      ALTER TABLE public.opportunity_offers ENABLE TRIGGER trg_opportunity_offers_guard;
    `);
    const tok = await realBypassToken();
    // 20: No contract → fails
    await asAuth(db, R_USER);
    await db.exec(`SET app.workflow_bypass_token = '${tok}'`);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='hired' WHERE id=$1`, [APP]),
    ).rejects.toThrow(/contract/i);
    await db.exec(`RESET app.workflow_bypass_token`);
    await asOwner(db);

    // Contract exists but current_version_id is NULL → fails
    await db.exec(`INSERT INTO public.contracts(id,application_id,status) VALUES ('b2b2c333-b2b2-c333-b2b2-b2b2b2b2cbbb','${APP}','draft')`);
    await asAuth(db, R_USER);
    await db.exec(`SET app.workflow_bypass_token = '${tok}'`);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='hired' WHERE id=$1`, [APP]),
    ).rejects.toThrow(/current_version_id|contract/i);
    await db.exec(`RESET app.workflow_bypass_token`);
    await asOwner(db);

    // Contract status draft but with uploaded version → still fails (status)
    await db.exec(`
      INSERT INTO public.contract_versions(id,contract_id,upload_status)
      VALUES ('b2b2c333-b2b2-c333-b2b2-b2b2b2b2cccc','b2b2c333-b2b2-c333-b2b2-b2b2b2b2cbbb','uploaded');
      UPDATE public.contracts SET current_version_id='b2b2c333-b2b2-c333-b2b2-b2b2b2b2cccc' WHERE id='b2b2c333-b2b2-c333-b2b2-b2b2b2b2cbbb';
    `);
    await asAuth(db, R_USER);
    await db.exec(`SET app.workflow_bypass_token = '${tok}'`);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='hired' WHERE id=$1`, [APP]),
    ).rejects.toThrow(/approved or signed/i);
    await db.exec(`RESET app.workflow_bypass_token`);
    await asOwner(db);

    // Approve contract but point current_version at a version from another contract → fails
    await db.exec(`
      UPDATE public.contracts SET status='approved' WHERE id='b2b2c333-b2b2-c333-b2b2-b2b2b2b2cbbb';
      INSERT INTO public.contracts(id,application_id,status) VALUES ('b2b2c333-b2b2-c333-b2b2-b2b2b2b2cddd','${APP}','approved');
      INSERT INTO public.contract_versions(id,contract_id,upload_status)
        VALUES ('b2b2c333-b2b2-c333-b2b2-b2b2b2b2ceee','b2b2c333-b2b2-c333-b2b2-b2b2b2b2cddd','uploaded');
      -- Point original contract's current_version at the OTHER contract's version.
      UPDATE public.contracts SET current_version_id='b2b2c333-b2b2-c333-b2b2-b2b2b2b2ceee',updated_at=now()+interval '1 second'
        WHERE id='b2b2c333-b2b2-c333-b2b2-b2b2b2b2cbbb';
    `);
    await asAuth(db, R_USER);
    await db.exec(`SET app.workflow_bypass_token = '${tok}'`);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='hired' WHERE id=$1`, [APP]),
    ).rejects.toThrow(/belong to the contract/i);
    await db.exec(`RESET app.workflow_bypass_token`);
    await asOwner(db);

    // Repoint to own version but pending upload → fails
    await db.exec(`
      UPDATE public.contract_versions SET upload_status='pending' WHERE id='b2b2c333-b2b2-c333-b2b2-b2b2b2b2cccc';
      UPDATE public.contracts SET current_version_id='b2b2c333-b2b2-c333-b2b2-b2b2b2b2cccc',updated_at=now()+interval '2 seconds'
        WHERE id='b2b2c333-b2b2-c333-b2b2-b2b2b2b2cbbb';
    `);
    await asAuth(db, R_USER);
    await db.exec(`SET app.workflow_bypass_token = '${tok}'`);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='hired' WHERE id=$1`, [APP]),
    ).rejects.toThrow(/uploaded/i);
    await db.exec(`RESET app.workflow_bypass_token`);
    await asOwner(db);

    // Fix all: uploaded + approved + own version → success (positive-path)
    await db.exec(`
      UPDATE public.contract_versions SET upload_status='uploaded' WHERE id='b2b2c333-b2b2-c333-b2b2-b2b2b2b2cccc';
    `);
    await asAuth(db, R_USER);
    await db.exec(`SET app.workflow_bypass_token = '${tok}'`);
    await db.query(`UPDATE public.opportunity_applications SET status='hired' WHERE id=$1`, [APP]);
    await db.exec(`RESET app.workflow_bypass_token`);
    await asOwner(db);
    const s = await db.query<{ status: string }>(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`, [APP]);
    expect(s.rows[0].status).toBe('hired');
  });

  it('C. withdraw RPC blocks: onboarding source, accepted offer, foreign driver', async () => {
    // Onboarding source
    const APP1 = 'b2b2c444-b2b2-c444-b2b2-b2b2b2b2c444';
    await seedApp(APP1, DRV_F, 'onboarding', 'b2-c-wd1-key');
    await asAuth(db, DRV_F);
    await expect(
      db.query(`SELECT public.withdraw_opportunity_application($1::uuid)`, [APP1]),
    ).rejects.toThrow(/onboarding/i);
    await asOwner(db);

    // Accepted offer blocks (source = offer_sent)
    const APP2 = 'b2b2c555-b2b2-c555-b2b2-b2b2b2b2c555';
    await seedApp(APP2, DRV_G, 'offer_sent', 'b2-c-wd2-key');
    const OFF2 = 'b2b2c555-b2b2-c555-b2b2-b2b2b2b2c5aa';
    await db.exec(`
      ALTER TABLE public.opportunity_offers DISABLE TRIGGER trg_opportunity_offers_guard;
      INSERT INTO public.opportunity_offers(id,application_id,opportunity_id,driver_user_id,recruiter_id,status,pay_description,created_by,accepted_at,sent_at,expires_at,sent_snapshot,snapshot_version)
      VALUES ('${OFF2}','${APP2}','${OPP}','${DRV_G}','${R_PROF}','accepted','pay','${R_USER}',now(),now() - interval '2 days',now() + interval '5 days',jsonb_build_object('seed',true),1);
      ALTER TABLE public.opportunity_offers ENABLE TRIGGER trg_opportunity_offers_guard;
    `);
    await asAuth(db, DRV_G);
    await expect(
      db.query(`SELECT public.withdraw_opportunity_application($1::uuid)`, [APP2]),
    ).rejects.toThrow(/accepted offer/i);
    await asOwner(db);

    // Foreign driver
    const APP3 = 'b2b2c666-b2b2-c666-b2b2-b2b2b2b2c666';
    await seedApp(APP3, DRV_H, 'interviewing', 'b2-c-wd3-key');
    await asAuth(db, DRV_A);
    await expect(
      db.query(`SELECT public.withdraw_opportunity_application($1::uuid)`, [APP3]),
    ).rejects.toThrow(/not authorized/i);
    await asOwner(db);
  });

  // -----------------------------------------------------------------
  // D. Positive-path regression (contract items 27–30)
  // -----------------------------------------------------------------
  it('D. approved RPC flow: send→offer_sent, accept→onboarding, complete_hiring→hired, withdraw→withdrawn', async () => {
    // Fresh app end-to-end via approved RPCs (not direct trigger bypass).
    const APP = await submitApply(db, DRV_I, OPP, 'b2-d-flow-key');
    await transitionToInterviewing(db, APP, R_USER);
    await asAuth(db, R_USER);
    await db.query(
      `SELECT * FROM public.save_opportunity_offer_draft($1::uuid,'pay',1800,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`, [APP]);
    const d = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_offers WHERE application_id=$1 AND status='draft'`, [APP]);
    const sent = await db.query<{ application_status: string; result_code: string }>(
      `SELECT * FROM public.send_opportunity_offer($1::uuid, now() + interval '7 days')`, [d.rows[0].id]);
    expect(sent.rows[0].result_code).toBe('offer_sent');
    expect(sent.rows[0].application_status).toBe('offer_sent');
    await asOwner(db);

    await asAuth(db, DRV_I);
    const acc = await db.query<{ application_status: string; result_code: string }>(
      `SELECT * FROM public.accept_opportunity_offer($1::uuid)`, [d.rows[0].id]);
    expect(acc.rows[0].result_code).toBe('offer_accepted');
    expect(acc.rows[0].application_status).toBe('onboarding');
    await asOwner(db);

    await db.exec(`
      INSERT INTO public.contracts(id,application_id,status)
        VALUES ('b2b2d001-b2b2-d001-b2b2-b2b2b2b2d001','${APP}','approved');
      INSERT INTO public.contract_versions(id,contract_id,upload_status)
        VALUES ('b2b2d001-b2b2-d001-b2b2-b2b2b2b2d0aa','b2b2d001-b2b2-d001-b2b2-b2b2b2b2d001','uploaded');
      UPDATE public.contracts SET current_version_id='b2b2d001-b2b2-d001-b2b2-b2b2b2b2d0aa'
        WHERE id='b2b2d001-b2b2-d001-b2b2-b2b2b2b2d001';
    `);
    await asAuth(db, R_USER);
    const h = await db.query<{ application_status: string; result_code: string }>(
      `SELECT * FROM public.complete_hiring($1::uuid)`, [APP]);
    expect(h.rows[0].result_code).toBe('hiring_completed');
    expect(h.rows[0].application_status).toBe('hired');
    await asOwner(db);

    // Withdraw path on a fresh app (linked driver, interviewing).
    const APP2 = await submitApply(db, DRV_J, OPP, 'b2-d-wd-key');
    await transitionToInterviewing(db, APP2, R_USER);
    await asAuth(db, DRV_J);
    await db.query(`SELECT public.withdraw_opportunity_application($1::uuid)`, [APP2]);
    await asOwner(db);
    const wd = await db.query<{ status: string }>(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`, [APP2]);
    expect(wd.rows[0].status).toBe('withdrawn');
  });

  // -----------------------------------------------------------------
  // E. Terminal / immutability (contract items 31–34)
  // -----------------------------------------------------------------
  it('E. hired cannot revert; withdrawn cannot revert; accepted offer cannot revert via direct update', async () => {
    // Hired revert (recruiter direct + via RPC)
    const HIRED = 'b2b2e111-b2b2-e111-b2b2-b2b2b2b2e111';
    await seedApp(HIRED, DRV_K, 'hired', 'b2-e-hired-key-x');
    await asAuth(db, R_USER);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='onboarding' WHERE id=$1`, [HIRED]),
    ).rejects.toThrow(/Terminal application status/i);
    await asOwner(db);

    // Withdrawn revert
    const WD = 'b2b2e222-b2b2-e222-b2b2-b2b2b2b2e222';
    await seedApp(WD, DRV_L, 'withdrawn', 'b2-e-wd-key-x');
    await asAuth(db, R_USER);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='interviewing' WHERE id=$1`, [WD]),
    ).rejects.toThrow(/Terminal application status/i);
    await asOwner(db);

    // Accepted offer cannot revert via direct update.
    const APP = 'b2b2e333-b2b2-e333-b2b2-b2b2b2b2e333';
    await seedApp(APP, DRV_M, 'onboarding', 'b2-e-acc-key-x');
    const OFF = 'b2b2e333-b2b2-e333-b2b2-b2b2b2b2e3aa';
    await db.exec(`
      ALTER TABLE public.opportunity_offers DISABLE TRIGGER trg_opportunity_offers_guard;
      INSERT INTO public.opportunity_offers(id,application_id,opportunity_id,driver_user_id,recruiter_id,status,pay_description,created_by,accepted_at,sent_at,expires_at,sent_snapshot,snapshot_version)
      VALUES ('${OFF}','${APP}','${OPP}','${DRV_M}','${R_PROF}','accepted','pay','${R_USER}',now(),now() - interval '2 days',now() + interval '5 days',jsonb_build_object('seed',true),1);
      ALTER TABLE public.opportunity_offers ENABLE TRIGGER trg_opportunity_offers_guard;
    `);
    await asAuth(db, R_USER);
    await expect(
      db.query(`UPDATE public.opportunity_offers SET status='sent' WHERE id=$1`, [OFF]),
    ).rejects.toThrow(/accepted offers cannot change status|permission denied/i);
    await asOwner(db);
  });

  it('E. application identity and type remain immutable via direct recruiter update', async () => {
    const APP = 'b2b2e444-b2b2-e444-b2b2-b2b2b2b2e444';
    const NEW_ID = 'b2b2e444-b2b2-e444-b2b2-b2b2b2b2e4ff';
    await seedApp(APP, DRV_D, 'interviewing', 'b2-e-imm-key-x');
    await asAuth(db, R_USER);
    // Each attempt must be rejected AND the row must retain its original
    // identity. Using alternate real fixtures (ALT_OPP, ALT_R_PROF, DRV_E)
    // ensures the denial is the guard, not a foreign-key error.
    const mutations: Array<[string, string]> = [
      ['id',              `UPDATE public.opportunity_applications SET id='${NEW_ID}' WHERE id=$1`],
      ['opportunity_id',  `UPDATE public.opportunity_applications SET opportunity_id='${ALT_OPP}' WHERE id=$1`],
      ['recruiter_id',    `UPDATE public.opportunity_applications SET recruiter_id='${ALT_R_PROF}' WHERE id=$1`],
      ['driver_user_id',  `UPDATE public.opportunity_applications SET driver_user_id='${DRV_E}' WHERE id=$1`],
      ['application_type',`UPDATE public.opportunity_applications SET application_type='request_info' WHERE id=$1`],
    ];
    for (const [, stmt] of mutations) {
      await expect(db.query(stmt, [APP])).rejects.toThrow(
        /only update application status|application identity is immutable/i,
      );
    }
    await asOwner(db);
    // Persisted identity must be unchanged.
    const row = await db.query<{
      id: string; opportunity_id: string; recruiter_id: string;
      driver_user_id: string; application_type: string; status: string;
    }>(
      `SELECT id, opportunity_id, recruiter_id, driver_user_id, application_type, status
         FROM public.opportunity_applications WHERE id=$1`, [APP]);
    expect(row.rows[0]).toMatchObject({
      id: APP,
      opportunity_id: OPP,
      recruiter_id: R_PROF,
      driver_user_id: DRV_D,
      application_type: 'apply',
      status: 'interviewing',
    });
  });

  // -----------------------------------------------------------------
  // Defect 1 close-out: trusted internal withdrawal setter must refuse
  // non-formal (request_info / callback) rows even when invoked as
  // service_role with the linked driver's JWT identity.
  // -----------------------------------------------------------------
  it('C. trusted _m2_set_application_withdrawn refuses request_info and callback rows', async () => {
    const INQ_RI = 'b2b2c777-b2b2-c777-b2b2-b2b2b2b2c777';
    const INQ_CB = 'b2b2c888-b2b2-c888-b2b2-b2b2b2b2c888';
    await asOwner(db);
    // Seed legacy-style inquiry rows with guard temporarily off so we can
    // construct historical state without needing snapshot/consent scaffolding.
    await db.exec(`
      ALTER TABLE public.opportunity_applications DISABLE TRIGGER opportunity_applications_update_guard_trigger;
      INSERT INTO public.opportunity_applications(
        id, opportunity_id, driver_user_id, recruiter_id, application_type, status,
        submission_snapshot, snapshot_version, is_legacy,
        preferred_contact_method, contact_sharing_consent, contact_sharing_consent_at
      ) VALUES
        ('${INQ_RI}','${OPP}','${DRV_O}','${R_PROF}','request_info','new',
         NULL, NULL, false, 'phone', false, NULL),
        ('${INQ_CB}','${OPP}','${DRV_P}','${R_PROF}','callback','new',
         NULL, NULL, false, 'phone', false, NULL);
      ALTER TABLE public.opportunity_applications ENABLE TRIGGER opportunity_applications_update_guard_trigger;
    `);

    for (const [app, driver] of [[INQ_RI, DRV_O], [INQ_CB, DRV_P]] as const) {
      // Invoke ONLY via service_role (authenticated has no EXECUTE grant),
      // with auth.uid() resolved to the linked driver so the actor check
      // cannot be the reason for denial.
      await db.exec(`RESET ROLE; SET ROLE service_role; SET request.jwt.claim.sub = '${driver}';`);
      await expect(
        db.query(`SELECT public._m2_set_application_withdrawn($1::uuid)`, [app]),
      ).rejects.toThrow(/application owner may withdraw|driver withdraw RPC/i);
    }
    await asOwner(db);

    const chk = await db.query<{ id: string; status: string; application_type: string }>(
      `SELECT id, status, application_type FROM public.opportunity_applications
        WHERE id IN ($1,$2) ORDER BY id`, [INQ_RI, INQ_CB]);
    for (const r of chk.rows) {
      expect(r.status).toBe('new');
      expect(['request_info', 'callback']).toContain(r.application_type);
    }
  });

  // -----------------------------------------------------------------
  // Defect 2 close-out: sent offer whose identity does not match the
  // application cannot satisfy the offer_sent invariant, even under a
  // real trusted workflow context.
  // -----------------------------------------------------------------
  it('C. offer_sent trigger rejects sent offer with mismatched driver identity', async () => {
    const APP = 'b2b2c999-b2b2-c999-b2b2-b2b2b2b2c999';
    const OFF = 'b2b2c999-b2b2-c999-b2b2-b2b2b2b2c9aa';
    await seedApp(APP, DRV_Q, 'interviewing', 'b2-c-mismatch-key');
    // Fixture: seed a sent offer whose driver_user_id deliberately does
    // NOT match the application (opportunity/recruiter match; driver does
    // not). Trigger disabled ONLY for fixture construction, then restored.
    await db.exec(`
      ALTER TABLE public.opportunity_offers DISABLE TRIGGER trg_opportunity_offers_guard;
      INSERT INTO public.opportunity_offers(
        id, application_id, opportunity_id, driver_user_id, recruiter_id,
        status, pay_description, created_by, sent_at, expires_at,
        sent_snapshot, snapshot_version
      ) VALUES (
        '${OFF}','${APP}','${OPP}','${DRV_A}','${R_PROF}',
        'sent','pay','${R_USER}', now(), now() + interval '7 days',
        jsonb_build_object('seed',true), 1
      );
      ALTER TABLE public.opportunity_offers ENABLE TRIGGER trg_opportunity_offers_guard;
    `);
    // All triggers restored — exercise with a real trusted workflow token.
    const tok = await realBypassToken();
    await asAuth(db, R_USER);
    await db.exec(`SET app.workflow_bypass_token = '${tok}'`);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='offer_sent' WHERE id=$1`, [APP]),
    ).rejects.toThrow(/matching sent offer/i);
    await db.exec(`RESET app.workflow_bypass_token`);
    await asOwner(db);
    const s = await db.query<{ status: string }>(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`, [APP]);
    expect(s.rows[0].status).toBe('interviewing');
  });

  // -----------------------------------------------------------------
  // Defect 3A close-out: hired requires an accepted offer even when a
  // valid, uploaded, approved contract already exists for the app.
  // -----------------------------------------------------------------
  it('C. hired rejected without accepted offer even with valid uploaded approved contract', async () => {
    const APP = 'b2b2caaa-b2b2-caaa-b2b2-b2b2b2b2caaa';
    const CON = 'b2b2caaa-b2b2-caaa-b2b2-b2b2b2b2cabb';
    const VER = 'b2b2caaa-b2b2-caaa-b2b2-b2b2b2b2cacc';
    await seedApp(APP, DRV_H, 'onboarding', 'b2-c-hire-noacc-key');
    await asOwner(db);
    // Contract path is fully valid; only the accepted offer is absent.
    await db.exec(`
      INSERT INTO public.contracts(id, application_id, status)
        VALUES ('${CON}','${APP}','approved');
      INSERT INTO public.contract_versions(id, contract_id, upload_status)
        VALUES ('${VER}','${CON}','uploaded');
      UPDATE public.contracts SET current_version_id='${VER}' WHERE id='${CON}';
    `);
    const tok = await realBypassToken();
    await asAuth(db, R_USER);
    await db.exec(`SET app.workflow_bypass_token = '${tok}'`);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='hired' WHERE id=$1`, [APP]),
    ).rejects.toThrow(/accepted offer/i);
    await db.exec(`RESET app.workflow_bypass_token`);
    await asOwner(db);
    const s = await db.query<{ status: string }>(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`, [APP]);
    expect(s.rows[0].status).toBe('onboarding');
  });
});


