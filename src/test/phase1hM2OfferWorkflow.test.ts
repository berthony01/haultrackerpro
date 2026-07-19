// @vitest-environment node
// =====================================================================
// Phase 1H-M2 Turn 2a — Offer workflow focused runtime (PGlite)
// Scope per Turn 2a split:
//   - Migration syntax / apply cleanly on top of M1 canonical
//   - save_opportunity_offer_draft (create + update + validation)
//   - send_opportunity_offer (validation + terms lock + app transition)
//   - withdraw_opportunity_application (cancel-linked-offer + guard)
// M2 candidate: supabase/migration-candidates/20260720000000_phase1h_m2_offer_workflow_rpcs.sql
// M1 canonical: supabase/migrations/20260719183725_ee7ffc53-dcdc-4666-bcba-1aeac0f5d0cf.sql
// Broader coverage (accept/decline/cancel/expire/hiring/rollbacks) is
// Turn 2b + Turn 2c per the packet split.
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
  recruiterUser: '33333333-3333-3333-3333-333333333333',
  recruiterProfile: '44444444-4444-4444-4444-444444444444',
  opportunity: '55555555-5555-5555-5555-555555555555',
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
      ('${IDS.recruiterUser}','recruiter@test');

    INSERT INTO public.recruiter_profiles(
      id,user_id,recruiter_name,recruiter_email,company_name,dot_number,posting_terms_accepted_at,posting_terms_version
    ) VALUES
      ('${IDS.recruiterProfile}','${IDS.recruiterUser}','Test Recruiter','recruiter@test','Acme','DOT123',now(),'2026-07-17.v1');

    INSERT INTO public.opportunities(
      id,recruiter_id,title,company_name,hiring_city,hiring_state,driver_type,route_type,trailer_type,
      pay_model,cpm,estimated_weekly_gross,estimated_weekly_miles,status,admin_review_status
    ) VALUES
      ('${IDS.opportunity}','${IDS.recruiterProfile}','Regional OTR','Acme','Dallas','TX','company','regional','dry_van','cpm',0.62,1800,2800,'active','approved');

    INSERT INTO public.driver_opportunity_profiles(
      user_id,full_name,phone,email,city,state,cdl_class,years_experience,endorsements,trailer_experience,
      preferred_driver_type,preferred_route_type,preferred_home_time,preferred_states,min_weekly_gross,min_weekly_net,
      min_effective_rpm,available_start_date,willing_to_relocate,contact_preference,visibility,
      allow_verified_recruiter_contact,profile_completed
    ) VALUES
      ('${IDS.driverA}','Ada Driver','555-1111','ada@driver.test','Austin','TX','A',5,ARRAY['H'],ARRAY['dry_van'],
       'company','regional','weekends',ARRAY['TX'],1500,1200,1.8,'2026-08-01',false,'phone','apply_only',true,true);
  `);
}

async function asOwner(db: AnyPGlite) {
  await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
}
async function asAuth(db: AnyPGlite, uid: string) {
  await db.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '${uid}';`);
}

const APPLY_ARGS = (key: string) =>
  `$1::uuid, '${key}', 'msg', true, true, true, 'phone', true`;

let db: AnyPGlite;
let appId: string;

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;
  await primeBaseline(db);
  // Apply M1 canonical then M2 candidate.
  await db.exec(read(M1_REL));
  await db.exec(read(M2_REL));

  // Seed one formal application as the driver.
  await asAuth(db, IDS.driverA);
  const r = await db.query<{ application_id: string; result_code: string }>(
    `SELECT * FROM public.submit_opportunity_application(${APPLY_ARGS('m2-seed-key-driver-a')})`,
    [IDS.opportunity],
  );
  if (r.rows[0].result_code !== 'created') {
    throw new Error(`seed failed: ${JSON.stringify(r.rows[0])}`);
  }
  appId = r.rows[0].application_id;
  await asOwner(db);
});

describe('Phase 1H-M2 Turn 2a: draft / send / withdraw (PGlite)', () => {
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
    // Find the current draft
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
