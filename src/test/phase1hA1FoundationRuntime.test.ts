// @vitest-environment node
// =====================================================================
// Phase 1H-A1 — Remediated foundation runtime harness (PGlite)
// Pass 2. Exercises production authorization paths under SET ROLE
// authenticated where RLS is material, and asserts every unresolved
// item from the pass-1 independent audit.
// =====================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { getAllowedRecruiterTransitions } from '@/lib/opportunities/applicationStatus';

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

const CANDIDATE_REL =
  '../../supabase/migration-candidates/20260718000000_phase1h_a1_application_snapshot_offers_restrictions.sql';

function loadCandidate(): string {
  const p = fileURLToPath(new URL(CANDIDATE_REL, import.meta.url));
  return fs.readFileSync(p, 'utf8');
}

const KEY_A = 'apply-key-driver-a-1';
const KEY_A_DUP = 'apply-key-driver-a-2';
const KEY_B_APPLY = 'apply-key-driver-b-1';
const KEY_B_INFO = 'info-key-driver-b-1';

const IDS = {
  driverA: '11111111-1111-1111-1111-111111111111',
  driverB: '22222222-2222-2222-2222-222222222222',
  blockedDriver: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  recruiterUser: '33333333-3333-3333-3333-333333333333',
  recruiterProfile: '44444444-4444-4444-4444-444444444444',
  opportunity: '55555555-5555-5555-5555-555555555555',
  pausedOpportunity: '77777777-7777-7777-7777-777777777777',
  unapprovedOpportunity: '88888888-8888-8888-8888-888888888888',
  historicalInquiryId: '66666666-6666-6666-6666-666666666666',
  secondRecruiterUser: '99999999-9999-9999-9999-999999999999',
  secondRecruiterProfile: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  secondOpportunity: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
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
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT driver_opportunity_profiles_user_unique UNIQUE (user_id)
    );

    CREATE TABLE public.recruiter_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT recruiter_profiles_user_unique UNIQUE (user_id)
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
          WHERE rp.id = _rid
            AND rp.status <> 'suspended'
            AND rp.verification_status <> 'suspended'
            AND (rp.posting_terms_accepted_at IS NOT NULL OR rp.legacy_terms_grandfathered_at IS NOT NULL)
        )
      $$;

    CREATE OR REPLACE FUNCTION public.current_user_can_manage_recruiter_opportunities(_rid uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.recruiter_profiles rp
          WHERE rp.id = _rid
            AND rp.user_id = auth.uid()
            AND rp.status <> 'suspended'
            AND rp.verification_status <> 'suspended'
            AND (rp.posting_terms_accepted_at IS NOT NULL OR rp.legacy_terms_grandfathered_at IS NOT NULL)
        )
      $$;

    CREATE OR REPLACE FUNCTION public.driver_can_access_opportunity(_opportunity_id uuid, _recruiter_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.opportunities o
          WHERE auth.uid() IS NOT NULL
            AND o.id = _opportunity_id
            AND o.recruiter_id = _recruiter_id
            AND o.status = 'active'
            AND o.admin_review_status = 'approved'
            AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
        )
      $$;

    CREATE POLICY "drivers view active approved opportunities" ON public.opportunities
      FOR SELECT TO authenticated USING (public.driver_can_access_opportunity(id, recruiter_id));
    CREATE POLICY "recruiters view own opportunities" ON public.opportunities
      FOR SELECT TO authenticated USING (public.current_user_can_manage_recruiter_opportunities(recruiter_id));

    CREATE POLICY "Driver views own applications" ON public.opportunity_applications
      FOR SELECT TO authenticated USING (auth.uid() = driver_user_id);
    CREATE POLICY "Recruiter views applications for own opportunities" ON public.opportunity_applications
      FOR SELECT TO authenticated USING (public.current_user_can_manage_recruiter_opportunities(recruiter_id));
    CREATE POLICY "Driver inserts own application" ON public.opportunity_applications
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = driver_user_id AND public.driver_can_access_opportunity(opportunity_id, recruiter_id));
    CREATE POLICY "Recruiter updates application status" ON public.opportunity_applications
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
      ('${IDS.blockedDriver}','blocked@test'),
      ('${IDS.recruiterUser}','recruiter@test'),
      ('${IDS.secondRecruiterUser}','recruiter2@test');

    INSERT INTO public.recruiter_profiles(
      id,user_id,recruiter_name,recruiter_email,company_name,dot_number,posting_terms_accepted_at,posting_terms_version
    ) VALUES
      ('${IDS.recruiterProfile}','${IDS.recruiterUser}','Test Recruiter','recruiter@test','Acme','DOT123',now(),'2026-07-17.v1'),
      ('${IDS.secondRecruiterProfile}','${IDS.secondRecruiterUser}','Other Recruiter','recruiter2@test','Beta','DOT456',now(),'2026-07-17.v1');

    INSERT INTO public.opportunities(
      id,recruiter_id,title,company_name,hiring_city,hiring_state,driver_type,route_type,trailer_type,
      pay_model,cpm,estimated_weekly_gross,estimated_weekly_miles,status,admin_review_status
    ) VALUES
      ('${IDS.opportunity}','${IDS.recruiterProfile}','Regional OTR','Acme','Dallas','TX','company','regional','dry_van','cpm',0.62,1800,2800,'active','approved'),
      ('${IDS.pausedOpportunity}','${IDS.recruiterProfile}','Paused Lane','Acme','Austin','TX','company','regional','dry_van','cpm',0.60,1700,2700,'paused','approved'),
      ('${IDS.unapprovedOpportunity}','${IDS.recruiterProfile}','Pending Review','Acme','Waco','TX','company','regional','dry_van','cpm',0.60,1700,2700,'active','pending'),
      ('${IDS.secondOpportunity}','${IDS.secondRecruiterProfile}','Other Lane','Beta','Houston','TX','company','otr','reefer','cpm',0.65,2000,3000,'active','approved');

    INSERT INTO public.driver_opportunity_profiles(
      user_id,full_name,phone,email,city,state,cdl_class,years_experience,endorsements,trailer_experience,
      preferred_driver_type,preferred_route_type,preferred_home_time,preferred_states,min_weekly_gross,min_weekly_net,
      min_effective_rpm,available_start_date,willing_to_relocate,contact_preference,visibility,
      allow_verified_recruiter_contact,profile_completed
    ) VALUES
      ('${IDS.driverA}','Ada Driver','555-1111','ada@driver.test','Austin','TX','A',5,ARRAY['H'],ARRAY['dry_van'],
       'company','regional','weekends',ARRAY['TX'],1500,1200,1.8,'2026-08-01',false,'phone','apply_only',true,true),
      ('${IDS.driverB}','Ben Driver','555-2222','ben@driver.test','Waco','TX','A',3,ARRAY[]::text[],ARRAY['reefer'],
       'company','otr','biweekly',ARRAY['TX','OK'],1400,1100,1.7,'2026-08-15',true,'email','apply_only',true,true),
      ('${IDS.blockedDriver}','Blocked Driver','555-3333','blocked@driver.test','Tyler','TX','A',2,ARRAY[]::text[],ARRAY[]::text[],
       'company','regional','weekly',ARRAY['TX'],1300,1000,1.6,'2026-08-20',false,'in_app','apply_only',false,true);

    -- Historical legacy inquiry (no snapshot / no idempotency key).
    INSERT INTO public.opportunity_applications
      (id, opportunity_id, driver_user_id, recruiter_id, application_type, status, message)
    VALUES ('${IDS.historicalInquiryId}', '${IDS.opportunity}', '${IDS.driverA}', '${IDS.recruiterProfile}',
            'request_info', 'new', 'historical: any question?');
  `);
}

async function asOwner(db: AnyPGlite) {
  await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
}
async function asAuthenticated(db: AnyPGlite, uid: string) {
  await db.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '${uid}';`);
}

const APPLY_ARGS = (key: string, message: string | null, consent = true) =>
  `$1::uuid, '${key}', ${message === null ? 'NULL' : `'${message.replace(/'/g, "''")}'`}, true, true, true, 'phone', ${consent ? 'true' : 'false'}`;

let db: AnyPGlite;

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;
  await primeBaseline(db);
  await db.exec(loadCandidate());
});

describe('Phase 1H-A1 remediation pass 2 (PGlite)', () => {
  it('harness applies the exact candidate migration', () => {
    expect(db).toBeTruthy();
  });

  it('status CHECK preserves existing workflow statuses plus onboarding', async () => {
    const r = await db.query<{ pg_get_constraintdef: string }>(
      `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='opportunity_applications_status_chk'`,
    );
    const def = r.rows[0].pg_get_constraintdef;
    for (const s of ['new','viewed','contact_requested','call_scheduled','waiting_documents','interviewing','offer_sent','onboarding','hired','rejected','withdrawn']) {
      expect(def).toContain(`'${s}'`);
    }
  });

  it('UI transition helper never offers recruiter-selected onboarding or hired from offer_sent', () => {
    expect(getAllowedRecruiterTransitions('offer_sent')).toEqual(['rejected']);
  });

  it('RPC signatures match the remediated split shape', async () => {
    const funcs = await db.query<{ proname: string; args: string }>(
      `SELECT proname, pg_get_function_identity_arguments(oid) AS args
         FROM pg_proc WHERE pronamespace='public'::regnamespace
          AND proname IN ('submit_opportunity_application','submit_request_info')
        ORDER BY proname, args`,
    );
    expect(funcs.rows).toEqual([
      { proname: 'submit_opportunity_application',
        args: '_opportunity_id uuid, _idempotency_key text, _message text, _availability_confirmed boolean, _requirements_confirmed boolean, _truth_attestation boolean, _preferred_contact_method text, _contact_sharing_consent boolean' },
      { proname: 'submit_request_info',
        args: '_opportunity_id uuid, _idempotency_key text, _question text, _preferred_contact_method text, _contact_sharing_consent boolean' },
    ]);
  });

  it('arbitrary-user internal helpers are NOT executable by authenticated', async () => {
    await asAuthenticated(db, IDS.driverA);
    await expect(
      db.query(`SELECT public.user_is_marketplace_blocked($1::uuid, 'applications')`, [IDS.driverB]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.query(`SELECT public.build_application_submission_snapshot($1::uuid, $2::uuid, '{}'::jsonb)`,
        [IDS.driverB, IDS.opportunity]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('legacy 2-arg build_application_submission_snapshot signature is removed', async () => {
    await asOwner(db);
    const r = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_proc
        WHERE pronamespace='public'::regnamespace
          AND proname='build_application_submission_snapshot'
          AND pg_get_function_identity_arguments(oid) = '_driver_user_id uuid, _opportunity_id uuid'`,
    );
    expect(r.rows[0].count).toBe('0');
  });

  it('marketplace_user_restrictions base table has no authenticated privileges', async () => {
    const grants = await db.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema='public' AND table_name='marketplace_user_restrictions'
          AND grantee IN ('authenticated','anon','PUBLIC')`,
    );
    expect(grants.rows).toEqual([]);
  });

  it('direct authenticated INSERT to opportunity_applications is denied — RPC-only path', async () => {
    await asAuthenticated(db, IDS.driverB);
    await expect(
      db.query(
        `INSERT INTO public.opportunity_applications(opportunity_id,driver_user_id,recruiter_id,application_type,status)
         VALUES ($1,$2,$3,'apply','new')`,
        [IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/row-level security|violates row-level security|permission denied/i);
  });

  it('submit_opportunity_application ignores client PII, snapshots server-side, and honors consent', async () => {
    await asAuthenticated(db, IDS.driverA);
    const r = await db.query<{ application_id: string; result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(${APPLY_ARGS(KEY_A, 'client says Mallory / 999-9999', true)})`,
      [IDS.opportunity],
    );
    expect(r.rows[0].result_code).toBe('created');

    const row = await db.query<{ snap: string; phone: string | null; email: string | null; message: string | null; consent: boolean }>(
      `SELECT submission_snapshot::text AS snap, driver_phone_snapshot AS phone,
              driver_email_snapshot AS email, message, contact_sharing_consent AS consent
         FROM public.opportunity_applications WHERE id=$1`,
      [r.rows[0].application_id],
    );
    const snap = JSON.parse(row.rows[0].snap);
    expect(snap.driver_profile.full_name).toBe('Ada Driver');
    expect(snap.attestations.availability_confirmed).toBe(true);
    expect(snap.attestations.truth_attestation).toBe(true);
    expect(JSON.stringify(snap)).not.toContain('Mallory');
    expect(row.rows[0].phone).toBe('555-1111'); // consent=true → snapshotted from own profile
    expect(row.rows[0].email).toBe('ada@driver.test');
    expect(row.rows[0].consent).toBe(true);
  });

  it('idempotent replay returns same application_id; duplicate second key blocked', async () => {
    await asAuthenticated(db, IDS.driverA);
    const before = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply'`,
      [IDS.driverA, IDS.opportunity],
    );
    const replay = await db.query<{ application_id: string; result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(${APPLY_ARGS(KEY_A, 'retry', true)})`,
      [IDS.opportunity],
    );
    expect(replay.rows[0].result_code).toBe('idempotent_replay');
    expect(replay.rows[0].application_id).toBe(before.rows[0].id);

    const dup = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(${APPLY_ARGS(KEY_A_DUP, 'again', true)})`,
      [IDS.opportunity],
    );
    expect(dup.rows[0].result_code).toBe('duplicate_same_type');
  });

  it('blank/oversized idempotency keys return invalid_input (both RPCs)', async () => {
    await asAuthenticated(db, IDS.driverB);
    let r = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(${APPLY_ARGS('', 'x', true)})`,
      [IDS.opportunity],
    );
    expect(r.rows[0].result_code).toBe('invalid_input');
    r = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(${APPLY_ARGS('short', 'x', true)})`,
      [IDS.opportunity],
    );
    expect(r.rows[0].result_code).toBe('invalid_input');
    const tooLong = 'k'.repeat(300);
    r = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(${APPLY_ARGS(tooLong, 'x', true)})`,
      [IDS.opportunity],
    );
    expect(r.rows[0].result_code).toBe('invalid_input');

    r = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_request_info($1::uuid, '   ', 'q', 'email', false)`,
      [IDS.opportunity],
    );
    expect(r.rows[0].result_code).toBe('invalid_input');
  });

  it('missing attestations / bad contact method return invalid_input for formal apply', async () => {
    await asAuthenticated(db, IDS.driverB);
    let r = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application($1::uuid, 'attest-key-1x', 'x', false, true, true, 'phone', false)`,
      [IDS.opportunity],
    );
    expect(r.rows[0].result_code).toBe('invalid_input');
    r = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application($1::uuid, 'attest-key-2x', 'x', true, true, true, 'carrier-pigeon', false)`,
      [IDS.opportunity],
    );
    expect(r.rows[0].result_code).toBe('invalid_input');
  });

  it('oversized message (>4000) / question (>2000) are rejected, not truncated', async () => {
    await asAuthenticated(db, IDS.driverB);
    const bigMsg = 'x'.repeat(4001);
    const bigQ = 'q'.repeat(2001);
    const r1 = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application($1::uuid, 'msg-oversize-key', $2, true, true, true, 'phone', false)`,
      [IDS.opportunity, bigMsg],
    );
    expect(r1.rows[0].result_code).toBe('invalid_input');
    const r2 = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_request_info($1::uuid, 'q-oversize-key', $2, 'email', false)`,
      [IDS.opportunity, bigQ],
    );
    expect(r2.rows[0].result_code).toBe('invalid_input');
  });

  it('consent state DB constraint: true requires timestamp; false requires nulls', async () => {
    await asOwner(db);
    // consent=true with no timestamp → CHECK fires
    await expect(
      db.query(
        `INSERT INTO public.opportunity_applications
           (opportunity_id,driver_user_id,recruiter_id,application_type,status,contact_sharing_consent)
         VALUES ($1,$2,$3,'request_info','new', true)`,
        [IDS.opportunity, IDS.driverA, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/opportunity_applications_consent_state_chk/);
    // consent=false with non-null email snapshot → CHECK fires
    await expect(
      db.query(
        `INSERT INTO public.opportunity_applications
           (opportunity_id,driver_user_id,recruiter_id,application_type,status,contact_sharing_consent,driver_email_snapshot)
         VALUES ($1,$2,$3,'request_info','new', false, 'leaked@x')`,
        [IDS.opportunity, IDS.driverA, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/opportunity_applications_consent_state_chk/);
  });

  it('formal apply CHECK constraint blocks service-role bypass of snapshot invariants', async () => {
    await asOwner(db);
    await expect(
      db.query(
        `INSERT INTO public.opportunity_applications
           (opportunity_id,driver_user_id,recruiter_id,application_type,status,
            submission_snapshot,snapshot_version,idempotency_key,submitted_at,contact_sharing_consent)
         VALUES ($1,$2,$3,'apply','new','{}'::jsonb,0,'valid-key-1',now(),false)`,
        [IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/opportunity_applications_formal_apply_chk/);
    await expect(
      db.query(
        `INSERT INTO public.opportunity_applications
           (opportunity_id,driver_user_id,recruiter_id,application_type,status,
            submission_snapshot,snapshot_version,idempotency_key,submitted_at,contact_sharing_consent)
         VALUES ($1,$2,$3,'apply','new','{"x":1}'::jsonb,1,'k',now(),false)`,
        [IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/opportunity_applications_formal_apply_chk/);
  });

  it('contact PII is NULL when consent is false and only from own profile when true', async () => {
    await asAuthenticated(db, IDS.driverB);
    const infoNoConsent = await db.query<{ application_id: string; result_code: string }>(
      `SELECT * FROM public.submit_request_info($1::uuid, 'info-noc-1', 'Please share details', 'email', false)`,
      [IDS.opportunity],
    );
    expect(infoNoConsent.rows[0].result_code).toBe('created');
    const noc = await db.query<{ email: string | null; phone: string | null; consent: boolean }>(
      `SELECT driver_email_snapshot AS email, driver_phone_snapshot AS phone, contact_sharing_consent AS consent
         FROM public.opportunity_applications WHERE id=$1`,
      [infoNoConsent.rows[0].application_id],
    );
    expect(noc.rows[0].email).toBeNull();
    expect(noc.rows[0].phone).toBeNull();
    expect(noc.rows[0].consent).toBe(false);
  });

  it('submit_request_info returns question_required and invalid_input result codes', async () => {
    await asAuthenticated(db, IDS.driverA);
    let r = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_request_info($1::uuid, 'info-blank-1', '   ', 'email', false)`,
      [IDS.opportunity],
    );
    expect(r.rows[0].result_code).toBe('question_required');
    r = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_request_info($1::uuid, 'info-bad-method-1', 'q', 'fax', false)`,
      [IDS.opportunity],
    );
    expect(r.rows[0].result_code).toBe('invalid_input');
  });

  it('self-application to your own opportunity returns self_opportunity (apply and request_info)', async () => {
    await asOwner(db);
    await db.exec(`INSERT INTO public.driver_opportunity_profiles(user_id,profile_completed) VALUES ('${IDS.recruiterUser}', true);`);
    await asAuthenticated(db, IDS.recruiterUser);
    const a = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(${APPLY_ARGS('self-apply-key-1', 'self', true)})`,
      [IDS.opportunity],
    );
    expect(a.rows[0].result_code).toBe('self_opportunity');
    const b = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_request_info($1::uuid, 'self-info-key-1', 'q?', 'email', false)`,
      [IDS.opportunity],
    );
    expect(b.rows[0].result_code).toBe('self_opportunity');
  });

  it('paused / unapproved / inactive / removed / closed / suspended-recruiter opportunities return opportunity_unavailable', async () => {
    await asAuthenticated(db, IDS.driverB);
    let r = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(${APPLY_ARGS('paused-key-1', 'x', true)})`,
      [IDS.pausedOpportunity],
    );
    expect(r.rows[0].result_code).toBe('opportunity_unavailable');
    r = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(${APPLY_ARGS('unapproved-key-1', 'x', true)})`,
      [IDS.unapprovedOpportunity],
    );
    expect(r.rows[0].result_code).toBe('opportunity_unavailable');

    // Cycle the primary opportunity through inactive/removed/closed (item 6).
    for (const s of ['inactive', 'removed', 'closed'] as const) {
      await asOwner(db);
      await db.exec(`UPDATE public.opportunities SET status='${s}' WHERE id='${IDS.opportunity}';`);
      await asAuthenticated(db, IDS.driverB);
      const rr = await db.query<{ result_code: string }>(
        `SELECT * FROM public.submit_opportunity_application(${APPLY_ARGS(`status-${s}-key-1`, 'x', true)})`,
        [IDS.opportunity],
      );
      expect(rr.rows[0].result_code).toBe('opportunity_unavailable');
    }
    await asOwner(db);
    await db.exec(`UPDATE public.opportunities SET status='active' WHERE id='${IDS.opportunity}';`);

    await db.exec(`UPDATE public.recruiter_profiles SET status='suspended' WHERE id='${IDS.recruiterProfile}';`);
    await asAuthenticated(db, IDS.driverB);
    r = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(${APPLY_ARGS('suspended-key-1', 'x', true)})`,
      [IDS.opportunity],
    );
    expect(r.rows[0].result_code).toBe('opportunity_unavailable');
    await asOwner(db);
    await db.exec(`UPDATE public.recruiter_profiles SET status='active' WHERE id='${IDS.recruiterProfile}';`);
  });

  it('authenticated admin cannot force onboarding or hired via ordinary UPDATE path (item 1)', async () => {
    await asOwner(db);
    // Redefine is_admin to make the current user "admin" for this test.
    await db.exec(`
      CREATE OR REPLACE FUNCTION public.is_admin(_uid uuid) RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
        AS $$ SELECT _uid = '${IDS.recruiterUser}'::uuid $$;
    `);
    const app = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply' LIMIT 1`,
      [IDS.driverA, IDS.opportunity],
    );
    await asAuthenticated(db, IDS.recruiterUser);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='onboarding' WHERE id=$1`, [app.rows[0].id]),
    ).rejects.toThrow(/Only server-authorized workflow|Illegal application status/);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='hired' WHERE id=$1`, [app.rows[0].id]),
    ).rejects.toThrow(/Only server-authorized workflow|Illegal application status/);
    // Admin cannot mutate immutable submission/identity fields either.
    await expect(
      db.query(`UPDATE public.opportunity_applications SET submission_snapshot='{"tampered":true}'::jsonb WHERE id=$1`, [app.rows[0].id]),
    ).rejects.toThrow(/submission_snapshot is immutable/);
    await asOwner(db);
    await db.exec(`
      CREATE OR REPLACE FUNCTION public.is_admin(_uid uuid) RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT false $$;
    `);
  });


  it('cross-driver isolation — driverA cannot see driverB applications; recruiter A cannot see recruiter B applications', async () => {
    await asAuthenticated(db, IDS.driverB);
    // driverB creates an apply first (needs whitelisted attestations)
    await db.query(
      `SELECT * FROM public.submit_opportunity_application(${APPLY_ARGS(KEY_B_APPLY, 'ben applies', true)})`,
      [IDS.opportunity],
    );

    await asAuthenticated(db, IDS.driverA);
    const seen = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.opportunity_applications WHERE driver_user_id=$1`,
      [IDS.driverB],
    );
    expect(seen.rows[0].count).toBe('0');

    await asAuthenticated(db, IDS.secondRecruiterUser);
    const seen2 = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.opportunity_applications WHERE recruiter_id=$1`,
      [IDS.recruiterProfile],
    );
    expect(seen2.rows[0].count).toBe('0');
  });

  it('marketplace restriction blocks apply; user cannot SELECT base table; safe surface has no admin_note/id/created_by', async () => {
    await asOwner(db);
    await db.exec(`
      INSERT INTO public.marketplace_user_restrictions(user_id, scope, restriction, reason_code, admin_note, created_by)
      VALUES ('${IDS.blockedDriver}','applications','blocked','abuse','private admin note','${IDS.recruiterUser}');
    `);

    await asAuthenticated(db, IDS.blockedDriver);
    await expect(
      db.query(`SELECT COUNT(*) FROM public.marketplace_user_restrictions`),
    ).rejects.toThrow(/permission denied/i);

    const safe = await db.query<Record<string, unknown>>(`SELECT * FROM public.get_my_marketplace_restrictions()`);
    expect(Object.keys(safe.rows[0]).sort()).toEqual(['ends_at','restriction','scope','starts_at']);
    expect(safe.rows[0].restriction).toBe('blocked');

    await expect(
      db.query(
        `SELECT * FROM public.submit_opportunity_application(${APPLY_ARGS('blocked-apply-key-1', 'x', true)})`,
        [IDS.opportunity],
      ),
    ).rejects.toThrow(/restricted from submitting/);
  });

  it('recruiter RLS update cannot set onboarding or hired; only rejection remains', async () => {
    await asOwner(db);
    const app = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply' LIMIT 1`,
      [IDS.driverA, IDS.opportunity],
    );
    await asAuthenticated(db, IDS.recruiterUser);
    for (const s of ['viewed','contact_requested','call_scheduled','interviewing','offer_sent']) {
      await db.query(`UPDATE public.opportunity_applications SET status=$2 WHERE id=$1`, [app.rows[0].id, s]);
    }
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='onboarding' WHERE id=$1`, [app.rows[0].id]),
    ).rejects.toThrow(/Only server-authorized workflow|Illegal application status/);
  });

  it('no GUC bypass exists for offer_sent → onboarding (item 9)', async () => {
    await asOwner(db);
    const app = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply' LIMIT 1`,
      [IDS.driverA, IDS.opportunity],
    );
    await asAuthenticated(db, IDS.recruiterUser);
    await db.exec(`SET app.allow_driver_accept_offer = 'true';`);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='onboarding' WHERE id=$1`, [app.rows[0].id]),
    ).rejects.toThrow(/Only server-authorized workflow|Illegal application status/);
    await db.exec(`RESET app.allow_driver_accept_offer;`);
  });

  it('snapshot/version/submitted_at/idempotency_key/consent are immutable after formal apply', async () => {
    await asOwner(db);
    const app = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply' LIMIT 1`,
      [IDS.driverB, IDS.opportunity],
    );
    await expect(db.query(`UPDATE public.opportunity_applications SET submission_snapshot='{"tampered":true}'::jsonb WHERE id=$1`, [app.rows[0].id])).rejects.toThrow(/submission_snapshot is immutable/);
    await expect(db.query(`UPDATE public.opportunity_applications SET snapshot_version=99 WHERE id=$1`, [app.rows[0].id])).rejects.toThrow(/snapshot_version is immutable/);
    await expect(db.query(`UPDATE public.opportunity_applications SET submitted_at=now()+interval '1 day' WHERE id=$1`, [app.rows[0].id])).rejects.toThrow(/submitted_at is immutable/);
    await expect(db.query(`UPDATE public.opportunity_applications SET idempotency_key='changed-key-1' WHERE id=$1`, [app.rows[0].id])).rejects.toThrow(/idempotency_key is immutable/);
    await expect(db.query(`UPDATE public.opportunity_applications SET contact_sharing_consent = NOT contact_sharing_consent WHERE id=$1`, [app.rows[0].id])).rejects.toThrow(/contact_sharing_consent is immutable/);
    await expect(db.query(`UPDATE public.opportunity_applications SET driver_user_id=$2 WHERE id=$1`, [app.rows[0].id, IDS.driverA])).rejects.toThrow(/application identity is immutable/);
  });

  it('opportunity_offers has SELECT-only authenticated grants; direct INSERT denied', async () => {
    const grants = await db.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema='public' AND table_name='opportunity_offers' AND grantee='authenticated'`,
    );
    expect(grants.rows.map((r) => r.privilege_type).sort()).toEqual(['SELECT']);

    await asAuthenticated(db, IDS.recruiterUser);
    await expect(
      db.query(
        `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,expires_at,sent_snapshot,snapshot_version,sent_at)
         VALUES ('${IDS.historicalInquiryId}','${IDS.opportunity}','${IDS.driverA}','${IDS.recruiterProfile}','sent',now()+interval '7 days','{"x":1}'::jsonb,1,now())`,
      ),
    ).rejects.toThrow(/permission denied|violates row-level security/i);
  });

  it('offers: 23h expiry rejected, >30d expiry rejected, exactly 24h and 30d accepted, snapshot required', async () => {
    await asOwner(db);
    const app = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply' LIMIT 1`,
      [IDS.driverB, IDS.opportunity],
    );
    const appId = app.rows[0].id;

    // 23 hours — rejected
    await expect(
      db.query(
        `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
         VALUES ($1,$2,$3,$4,'sent',now(),now()+interval '23 hours','{"v":1}'::jsonb,1)`,
        [appId, IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/opportunity_offers_sent_expiry_chk/);

    // >30 days — rejected
    await expect(
      db.query(
        `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
         VALUES ($1,$2,$3,$4,'sent',now(),now()+interval '31 days','{"v":1}'::jsonb,1)`,
        [appId, IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/opportunity_offers_sent_expiry_chk/);

    // Missing snapshot — rejected
    await expect(
      db.query(
        `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
         VALUES ($1,$2,$3,$4,'sent',now(),now()+interval '7 days','{}'::jsonb,0)`,
        [appId, IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/opportunity_offers_post_draft_snapshot_chk|opportunity_offers_sent_expiry_chk/);

    // Exactly 24h — accepted
    const okId = await db.query<{ id: string }>(
      `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
       VALUES ($1,$2,$3,$4,'sent',now(),now()+interval '24 hours','{"v":1}'::jsonb,1) RETURNING id`,
      [appId, IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
    );
    expect(okId.rows[0].id).toBeTruthy();

    // Exactly 30d on a separate app (delete the sent one to satisfy one-sent-per-app)
    await db.query(`UPDATE public.opportunity_offers SET status='canceled', canceled_at=now() WHERE id=$1`, [okId.rows[0].id]);
    // Above update violates immutability once sent — swallow if fails, then delete raw as owner
    // Owner bypasses triggers only when SECURITY DEFINER — the guard runs as definer either way,
    // so cleanup via DELETE which is not guarded by the update trigger.
    await db.exec(`DELETE FROM public.opportunity_offers WHERE application_id='${appId}';`).catch(() => undefined);

    const ok30 = await db.query<{ id: string }>(
      `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
       VALUES ($1,$2,$3,$4,'sent',now(),now()+interval '30 days','{"v":1}'::jsonb,1) RETURNING id`,
      [appId, IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
    );
    expect(ok30.rows[0].id).toBeTruthy();
  });

  it('offer FK relationships are RESTRICT — deleting application/opportunity/recruiter is blocked when offer exists', async () => {
    await asOwner(db);
    const app = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply' LIMIT 1`,
      [IDS.driverB, IDS.opportunity],
    );
    await expect(
      db.query(`DELETE FROM public.opportunity_applications WHERE id=$1`, [app.rows[0].id]),
    ).rejects.toThrow(/violates foreign key constraint|update or delete/i);
    await expect(
      db.query(`DELETE FROM public.opportunities WHERE id=$1`, [IDS.opportunity]),
    ).rejects.toThrow(/violates foreign key constraint|update or delete/i);
    await expect(
      db.query(`DELETE FROM public.recruiter_profiles WHERE id=$1`, [IDS.recruiterProfile]),
    ).rejects.toThrow(/violates foreign key constraint|update or delete/i);
  });

  it('unrelated billing tables are not altered', async () => {
    await asOwner(db);
    const subs = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' ORDER BY column_name`,
    );
    expect(subs.rows.map((r) => r.column_name).sort()).toEqual(['id','status','user_id']);
    const rbp = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='recruiter_billing_profiles' ORDER BY column_name`,
    );
    expect(rbp.rows.map((r) => r.column_name).sort()).toEqual(['id','recruiter_id','stripe_customer_id']);
  });
});
