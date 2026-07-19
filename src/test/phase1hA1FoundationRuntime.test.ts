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

// Create an ephemeral Driver + completed profile + fresh formal application
// for a given opportunity/recruiter. Used to add non-destructive fixtures to
// offer-boundary tests instead of deleting historical offer rows.
let _freshSeq = 0;
async function createFreshApp(
  db: AnyPGlite,
  slug: string,
  opportunityId: string,
  recruiterProfileId: string,
): Promise<{ driverId: string; appId: string; recruiterProfileId: string }> {
  _freshSeq += 1;
  const seq = String(_freshSeq).padStart(4, '0');
  // Deterministic v4-shaped uuid using the slug + seq.
  const suffix = (slug + '000000000000').replace(/[^a-f0-9]/gi, '0').slice(0, 12).toLowerCase();
  const driverId = `f${seq.padStart(7, '0')}-fafa-4fff-8fff-${suffix.padEnd(12, '0')}`;
  const email = `fresh-${slug}-${seq}@driver.test`;
  await asOwner(db);
  await db.exec(
    `INSERT INTO auth.users(id,email) VALUES ('${driverId}','${email}') ON CONFLICT DO NOTHING;
     INSERT INTO public.driver_opportunity_profiles(user_id, full_name, email, phone, profile_completed)
       VALUES ('${driverId}','Fresh ${slug}','${email}','555-9${seq.slice(-3)}', true)
       ON CONFLICT DO NOTHING;`,
  );
  await asAuthenticated(db, driverId);
  const key = `fresh-${slug}-${seq}-apply-key`.padEnd(12, 'x');
  const rows = await db.query<{ application_id: string; result_code: string }>(
    `SELECT * FROM public.submit_opportunity_application(
       $1::uuid, $2, 'fresh apply', true, true, true, 'email', true
     )`,
    [opportunityId, key],
  );
  if (rows.rows[0].result_code !== 'created' || !rows.rows[0].application_id) {
    throw new Error(`createFreshApp failed: ${JSON.stringify(rows.rows[0])}`);
  }
  await asOwner(db);
  return { driverId, appId: rows.rows[0].application_id, recruiterProfileId };
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

    const blocked = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(${APPLY_ARGS('blocked-apply-key-1', 'x', true)})`,
      [IDS.opportunity],
    );
    expect(blocked.rows[0].result_code).toBe('restricted');
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

  it('offers (sent): 23h rejected, >30d rejected, snapshot required, 24h and 30d accepted on separate fresh apps', async () => {
    // Non-destructive: never delete historical offer rows. Each boundary
    // acceptance uses its own fresh Driver + application so the
    // one_sent_per_app unique index is not artificially freed.
    await asOwner(db);
    const app = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply' LIMIT 1`,
      [IDS.driverB, IDS.opportunity],
    );
    const appId = app.rows[0].id;

    // Rejections against the existing driverB app — no row is created.
    await expect(
      db.query(
        `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
         VALUES ($1,$2,$3,$4,'sent',now(),now()+interval '23 hours','{"v":1}'::jsonb,1)`,
        [appId, IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/opportunity_offers_sent_expiry_chk/);
    await expect(
      db.query(
        `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
         VALUES ($1,$2,$3,$4,'sent',now(),now()+interval '31 days','{"v":1}'::jsonb,1)`,
        [appId, IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/opportunity_offers_sent_expiry_chk/);
    await expect(
      db.query(
        `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
         VALUES ($1,$2,$3,$4,'sent',now(),now()+interval '7 days','{}'::jsonb,0)`,
        [appId, IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/opportunity_offers_post_draft_snapshot_chk|opportunity_offers_sent_expiry_chk/);

    // Accepted 24h boundary — fresh driver + fresh formal application.
    const app24 = await createFreshApp(db, 'offer-24h', IDS.opportunity, IDS.recruiterProfile);
    const ok24 = await db.query<{ id: string }>(
      `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
       VALUES ($1,$2,$3,$4,'sent',now(),now()+interval '24 hours','{"v":1}'::jsonb,1) RETURNING id`,
      [app24.appId, IDS.opportunity, app24.driverId, IDS.recruiterProfile],
    );
    expect(ok24.rows[0].id).toBeTruthy();

    // Accepted 30d boundary — separate fresh driver + fresh formal application.
    const app30 = await createFreshApp(db, 'offer-30d', IDS.opportunity, IDS.recruiterProfile);
    const ok30 = await db.query<{ id: string }>(
      `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
       VALUES ($1,$2,$3,$4,'sent',now(),now()+interval '30 days','{"v":1}'::jsonb,1) RETURNING id`,
      [app30.appId, IDS.opportunity, app30.driverId, IDS.recruiterProfile],
    );
    expect(ok30.rows[0].id).toBeTruthy();
  });

  it('offer FK relationships are RESTRICT — deleting application/opportunity/recruiter is blocked when offer exists', async () => {
    // Non-destructive fixture: create its own fresh app + sent offer so this
    // test does not depend on any earlier test leaving an offer behind.
    const fresh = await createFreshApp(db, 'fk-restrict', IDS.opportunity, IDS.recruiterProfile);
    await asOwner(db);
    await db.query(
      `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
       VALUES ($1,$2,$3,$4,'sent',now(),now()+interval '7 days','{"v":1}'::jsonb,1)`,
      [fresh.appId, IDS.opportunity, fresh.driverId, IDS.recruiterProfile],
    );
    await expect(
      db.query(`DELETE FROM public.opportunity_applications WHERE id=$1`, [fresh.appId]),
    ).rejects.toThrow(/violates foreign key constraint|update or delete/i);
    await expect(
      db.query(`DELETE FROM public.opportunities WHERE id=$1`, [IDS.opportunity]),
    ).rejects.toThrow(/violates foreign key constraint|update or delete/i);
    await expect(
      db.query(`DELETE FROM public.recruiter_profiles WHERE id=$1`, [IDS.recruiterProfile]),
    ).rejects.toThrow(/violates foreign key constraint|update or delete/i);
  });

  // ---------------------------------------------------------------------
  // Independent-audit follow-ups (final A1 correctness patch)
  // ---------------------------------------------------------------------

  it('submit_opportunity_application rejects NULL attestations with invalid_input and inserts no row', async () => {
    await asOwner(db);
    const before = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply'`,
      [IDS.driverA, IDS.opportunity],
    );

    const call = async (a: string, b: string, c: string, key: string) => {
      await asAuthenticated(db, IDS.driverA);
      const rows = await db.query<{ result_code: string; application_id: string | null }>(
        `SELECT * FROM public.submit_opportunity_application(
           $1::uuid, $2, 'null-attest', ${a}, ${b}, ${c}, 'phone', true
         )`,
        [IDS.opportunity, key],
      );
      return rows.rows[0];
    };

    const r1 = await call('NULL', 'true', 'true', 'null-attest-availability-1');
    const r2 = await call('true', 'NULL', 'true', 'null-attest-requirements-1');
    const r3 = await call('true', 'true', 'NULL', 'null-attest-truth-1');
    const r4 = await call('NULL', 'NULL', 'NULL', 'null-attest-all-1');

    expect([r1, r2, r3, r4].map((r) => r.result_code)).toEqual([
      'invalid_input', 'invalid_input', 'invalid_input', 'invalid_input',
    ]);
    for (const r of [r1, r2, r3, r4]) expect(r.application_id).toBeNull();

    await asOwner(db);
    const after = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply'`,
      [IDS.driverA, IDS.opportunity],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('submit_request_info returns profile_required (no DB error) when consent=true and no Driver profile', async () => {
    await asOwner(db);
    const noProfileDriver = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    await db.exec(
      `INSERT INTO auth.users(id,email) VALUES ('${noProfileDriver}','no-profile@example.com')
         ON CONFLICT DO NOTHING;`,
    );

    await asAuthenticated(db, noProfileDriver);
    const consented = await db.query<{ result_code: string; application_id: string | null }>(
      `SELECT * FROM public.submit_request_info(
         $1::uuid, 'noprof-consent-key-1', 'Any details?', 'email', true
       )`,
      [IDS.opportunity],
    );
    expect(consented.rows[0].result_code).toBe('profile_required');
    expect(consented.rows[0].application_id).toBeNull();

    const noConsent = await db.query<{ result_code: string; application_id: string | null }>(
      `SELECT * FROM public.submit_request_info(
         $1::uuid, 'noprof-noconsent-key-1', 'Any details?', 'in_app', false
       )`,
      [IDS.opportunity],
    );
    expect(noConsent.rows[0].result_code).toBe('created');
    expect(noConsent.rows[0].application_id).not.toBeNull();
  });

  it('offer post-draft expiry invariant applies to accepted/declined/expired/canceled/superseded direct inserts', async () => {
    await asOwner(db);
    // Fresh application for this test — do not reuse or delete historical rows.
    const freshDriver = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    await db.exec(
      `INSERT INTO auth.users(id,email) VALUES ('${freshDriver}','fresh-offer@example.com')
         ON CONFLICT DO NOTHING;
       INSERT INTO public.driver_opportunity_profiles(user_id, full_name, email, phone, profile_completed)
         VALUES ('${freshDriver}','Fresh Offer','fresh-offer@example.com','555-0100', true)
         ON CONFLICT DO NOTHING;`,
    );
    await asAuthenticated(db, freshDriver);
    await db.query(
      `SELECT * FROM public.submit_opportunity_application(
         $1::uuid, 'fresh-offer-apply-key-1', 'apply', true, true, true, 'email', true
       )`,
      [IDS.opportunity],
    );
    await asOwner(db);
    const app = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply' LIMIT 1`,
      [freshDriver, IDS.opportunity],
    );
    const appId = app.rows[0].id;

    const NON_DRAFT: string[] = ['accepted', 'declined', 'expired', 'canceled', 'superseded'];

    // Missing expires_at rejected for every non-draft state.
    for (const s of NON_DRAFT) {
      await expect(
        db.query(
          `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
           VALUES ($1,$2,$3,$4,$5::text,now(),NULL,'{"v":1}'::jsonb,1)`,
          [appId, IDS.opportunity, freshDriver, IDS.recruiterProfile, s],
        ),
      ).rejects.toThrow(/opportunity_offers_sent_expiry_chk/);
    }

    // 23h rejected for every non-draft state.
    for (const s of NON_DRAFT) {
      await expect(
        db.query(
          `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
           VALUES ($1,$2,$3,$4,$5::text,now(),now()+interval '23 hours','{"v":1}'::jsonb,1)`,
          [appId, IDS.opportunity, freshDriver, IDS.recruiterProfile, s],
        ),
      ).rejects.toThrow(/opportunity_offers_sent_expiry_chk/);
    }

    // >30d rejected for every non-draft state.
    for (const s of NON_DRAFT) {
      await expect(
        db.query(
          `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
           VALUES ($1,$2,$3,$4,$5::text,now(),now()+interval '31 days','{"v":1}'::jsonb,1)`,
          [appId, IDS.opportunity, freshDriver, IDS.recruiterProfile, s],
        ),
      ).rejects.toThrow(/opportunity_offers_sent_expiry_chk/);
    }

    // Draft still flexible: no sent_at / no expires_at accepted.
    const draft = await db.query<{ id: string }>(
      `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status)
       VALUES ($1,$2,$3,$4,'draft') RETURNING id`,
      [appId, IDS.opportunity, freshDriver, IDS.recruiterProfile],
    );
    expect(draft.rows[0].id).toBeTruthy();

    // Valid 24h and 30d boundaries accepted for every non-draft state, each on
    // its own fresh application to avoid deleting historical offer rows and
    // to respect the one-sent-per-app unique index.
    for (const s of NON_DRAFT) {
      const a24 = await createFreshApp(db, `pd-${s}-24`, IDS.opportunity, IDS.recruiterProfile);
      const ok24 = await db.query<{ id: string; status: string }>(
        `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
         VALUES ($1,$2,$3,$4,$5::text,now(),now()+interval '24 hours','{"v":1}'::jsonb,1) RETURNING id, status`,
        [a24.appId, IDS.opportunity, a24.driverId, IDS.recruiterProfile, s],
      );
      expect(ok24.rows[0].id).toBeTruthy();
      expect(ok24.rows[0].status).toBe(s);

      const a30 = await createFreshApp(db, `pd-${s}-30`, IDS.opportunity, IDS.recruiterProfile);
      const ok30 = await db.query<{ id: string; status: string }>(
        `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,sent_at,expires_at,sent_snapshot,snapshot_version)
         VALUES ($1,$2,$3,$4,$5::text,now(),now()+interval '30 days','{"v":1}'::jsonb,1) RETURNING id, status`,
        [a30.appId, IDS.opportunity, a30.driverId, IDS.recruiterProfile, s],
      );
      expect(ok30.rows[0].id).toBeTruthy();
      expect(ok30.rows[0].status).toBe(s);
    }
  });

  // ---------------------------------------------------------------------
  // Real DB reapplication proof (item 2) — no Supabase client mock.
  // ---------------------------------------------------------------------

  it('reapplication after rejected: key A created → rejected → key A replay → key B new application', async () => {
    // Fresh Driver + profile so we can safely mutate to a terminal status.
    await asOwner(db);
    const driver = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    await db.exec(
      `INSERT INTO auth.users(id,email) VALUES ('${driver}','reapply-rej@test') ON CONFLICT DO NOTHING;
       INSERT INTO public.driver_opportunity_profiles(user_id, full_name, email, phone, profile_completed)
         VALUES ('${driver}','Reapply Rej','reapply-rej@test','555-4001', true)
         ON CONFLICT DO NOTHING;`,
    );

    const KEY_R_A = 'reapply-rej-key-a-000001';
    const KEY_R_B = 'reapply-rej-key-b-000001';

    // 1. First apply as authenticated Driver — created.
    await asAuthenticated(db, driver);
    const r1 = await db.query<{ application_id: string; application_status: string; result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(
         $1::uuid, $2, 'first', true, true, true, 'email', true
       )`,
      [IDS.opportunity, KEY_R_A],
    );
    expect(r1.rows[0].result_code).toBe('created');
    const firstId = r1.rows[0].application_id;
    expect(firstId).toBeTruthy();

    // 2. Recruiter (owner of opportunity) legally moves new → rejected via the
    //    ordinary UPDATE path — this is the recruiter's real production path.
    await asAuthenticated(db, IDS.recruiterUser);
    const upd = await db.query<{ status: string }>(
      `UPDATE public.opportunity_applications SET status='rejected' WHERE id=$1 RETURNING status`,
      [firstId],
    );
    expect(upd.rows[0].status).toBe('rejected');

    // 3. Reapply with SAME key A → idempotent_replay pointing at the same row.
    await asAuthenticated(db, driver);
    const r2 = await db.query<{ application_id: string; application_status: string; result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(
         $1::uuid, $2, 'replay', true, true, true, 'email', true
       )`,
      [IDS.opportunity, KEY_R_A],
    );
    expect(r2.rows[0].result_code).toBe('idempotent_replay');
    expect(r2.rows[0].application_id).toBe(firstId);
    expect(r2.rows[0].application_status).toBe('rejected');

    // 4. Reapply with NEW key B → a distinct new formal application is created.
    const r3 = await db.query<{ application_id: string; application_status: string; result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(
         $1::uuid, $2, 'reapply', true, true, true, 'email', true
       )`,
      [IDS.opportunity, KEY_R_B],
    );
    expect(r3.rows[0].result_code).toBe('created');
    expect(r3.rows[0].application_id).not.toBe(firstId);
    expect(r3.rows[0].application_status).toBe('new');

    // Two distinct formal apply rows exist for (driver, opportunity).
    await asOwner(db);
    const rows = await db.query<{ id: string; status: string; idempotency_key: string }>(
      `SELECT id, status, idempotency_key FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply'
        ORDER BY submitted_at ASC`,
      [driver, IDS.opportunity],
    );
    expect(rows.rows.length).toBe(2);
    expect(rows.rows.map((r) => r.idempotency_key).sort()).toEqual([KEY_R_A, KEY_R_B].sort());
    expect(rows.rows.map((r) => r.status).sort()).toEqual(['new', 'rejected']);
  });

  it('reapplication after withdrawn: key A created → withdrawn (GUC path) → key A replay → key B new application', async () => {
    await asOwner(db);
    const driver = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    await db.exec(
      `INSERT INTO auth.users(id,email) VALUES ('${driver}','reapply-wd@test') ON CONFLICT DO NOTHING;
       INSERT INTO public.driver_opportunity_profiles(user_id, full_name, email, phone, profile_completed)
         VALUES ('${driver}','Reapply Wd','reapply-wd@test','555-4002', true)
         ON CONFLICT DO NOTHING;`,
    );

    const KEY_W_A = 'reapply-wd-key-a-000001';
    const KEY_W_B = 'reapply-wd-key-b-000001';

    await asAuthenticated(db, driver);
    const r1 = await db.query<{ application_id: string; result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(
         $1::uuid, $2, 'first', true, true, true, 'email', true
       )`,
      [IDS.opportunity, KEY_W_A],
    );
    expect(r1.rows[0].result_code).toBe('created');
    const firstId = r1.rows[0].application_id;

    // FIX 2: withdrawn transition requires app.allow_driver_withdraw AND
    // auth.uid() = driver_user_id. Simulate the SECURITY DEFINER withdraw
    // RPC: RESET ROLE (bypass RLS as owner) while keeping the caller's
    // JWT sub so auth.uid() still resolves to the owning Driver.
    await db.exec(
      `RESET ROLE; SET request.jwt.claim.sub = '${driver}'; SET app.allow_driver_withdraw = 'true';`,
    );
    const upd = await db.query<{ status: string; withdrawn_at: string | null }>(
      `UPDATE public.opportunity_applications SET status='withdrawn' WHERE id=$1
         RETURNING status, withdrawn_at`,
      [firstId],
    );
    await db.exec(`RESET app.allow_driver_withdraw; RESET request.jwt.claim.sub;`);
    expect(upd.rows[0].status).toBe('withdrawn');
    expect(upd.rows[0].withdrawn_at).not.toBeNull();

    await asAuthenticated(db, driver);
    const r2 = await db.query<{ application_id: string; application_status: string; result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(
         $1::uuid, $2, 'replay', true, true, true, 'email', true
       )`,
      [IDS.opportunity, KEY_W_A],
    );
    expect(r2.rows[0].result_code).toBe('idempotent_replay');
    expect(r2.rows[0].application_id).toBe(firstId);
    expect(r2.rows[0].application_status).toBe('withdrawn');

    const r3 = await db.query<{ application_id: string; result_code: string; application_status: string }>(
      `SELECT * FROM public.submit_opportunity_application(
         $1::uuid, $2, 'reapply', true, true, true, 'email', true
       )`,
      [IDS.opportunity, KEY_W_B],
    );
    expect(r3.rows[0].result_code).toBe('created');
    expect(r3.rows[0].application_id).not.toBe(firstId);
    expect(r3.rows[0].application_status).toBe('new');
  });

  // -------------------------------------------------------------------
  // Final closeout — FIX 1/2/3/4 proofs.
  // -------------------------------------------------------------------

  it('FIX 1: formal apply invariant is tied to application_type=apply (no submitted_at bypass)', async () => {
    await asOwner(db);
    // Direct service-role INSERT of a formal apply row with submitted_at=NULL
    // must be rejected — previously this would have satisfied the old
    // "submitted_at IS NULL OR (...)" check.
    await expect(
      db.query(
        `INSERT INTO public.opportunity_applications
           (opportunity_id,driver_user_id,recruiter_id,application_type,status,
            submission_snapshot,snapshot_version,idempotency_key,submitted_at,contact_sharing_consent)
         VALUES ($1,$2,$3,'apply','new','{"a":1}'::jsonb,1,'valid-apply-key-1',NULL,false)`,
        [IDS.opportunity, IDS.driverA, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/opportunity_applications_formal_apply_chk/);

    // Missing snapshot for apply row: rejected regardless of submitted_at.
    await expect(
      db.query(
        `INSERT INTO public.opportunity_applications
           (opportunity_id,driver_user_id,recruiter_id,application_type,status,
            submission_snapshot,snapshot_version,idempotency_key,submitted_at,contact_sharing_consent)
         VALUES ($1,$2,$3,'apply','new','{}'::jsonb,1,'valid-apply-key-2',now(),false)`,
        [IDS.opportunity, IDS.driverA, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/opportunity_applications_formal_apply_chk/);

    // snapshot_version < 1 for apply row: rejected.
    await expect(
      db.query(
        `INSERT INTO public.opportunity_applications
           (opportunity_id,driver_user_id,recruiter_id,application_type,status,
            submission_snapshot,snapshot_version,idempotency_key,submitted_at,contact_sharing_consent)
         VALUES ($1,$2,$3,'apply','new','{"a":1}'::jsonb,0,'valid-apply-key-3',now(),false)`,
        [IDS.opportunity, IDS.driverA, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/opportunity_applications_formal_apply_chk/);

    // Short idempotency_key for apply row: rejected.
    await expect(
      db.query(
        `INSERT INTO public.opportunity_applications
           (opportunity_id,driver_user_id,recruiter_id,application_type,status,
            submission_snapshot,snapshot_version,idempotency_key,submitted_at,contact_sharing_consent)
         VALUES ($1,$2,$3,'apply','new','{"a":1}'::jsonb,1,'short',now(),false)`,
        [IDS.opportunity, IDS.driverA, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/opportunity_applications_formal_apply_chk/);

    // NULL idempotency_key for apply row: rejected.
    await expect(
      db.query(
        `INSERT INTO public.opportunity_applications
           (opportunity_id,driver_user_id,recruiter_id,application_type,status,
            submission_snapshot,snapshot_version,idempotency_key,submitted_at,contact_sharing_consent)
         VALUES ($1,$2,$3,'apply','new','{"a":1}'::jsonb,1,NULL,now(),false)`,
        [IDS.opportunity, IDS.driverA, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/opportunity_applications_formal_apply_chk/);
  });

  it('FIX 2: withdrawal is driver-bound; other drivers/recruiter/admin cannot withdraw; withdrawn_at immutable+server-set', async () => {
    // Fresh Driver + fresh formal apply.
    const fresh = await createFreshApp(db, 'wd-bound', IDS.opportunity, IDS.recruiterProfile);

    // 1) Another Driver (driverA) with the GUC set cannot withdraw.
    await db.exec(
      `RESET ROLE; SET request.jwt.claim.sub = '${IDS.driverA}'; SET app.allow_driver_withdraw = 'true';`,
    );
    await expect(
      db.query(
        `UPDATE public.opportunity_applications SET status='withdrawn' WHERE id=$1`,
        [fresh.appId],
      ),
    ).rejects.toThrow(/Only the application owner may withdraw/);
    await db.exec(`RESET app.allow_driver_withdraw;`);

    // 2) Recruiter with GUC set cannot withdraw someone else's app.
    await db.exec(
      `RESET ROLE; SET request.jwt.claim.sub = '${IDS.recruiterUser}'; SET app.allow_driver_withdraw = 'true';`,
    );
    await expect(
      db.query(
        `UPDATE public.opportunity_applications SET status='withdrawn' WHERE id=$1`,
        [fresh.appId],
      ),
    ).rejects.toThrow(/Only the application owner may withdraw/);
    await db.exec(`RESET app.allow_driver_withdraw;`);

    // 3) With no auth.uid() (owner-only) + GUC: cannot withdraw either.
    await db.exec(
      `RESET ROLE; RESET request.jwt.claim.sub; SET app.allow_driver_withdraw = 'true';`,
    );
    await expect(
      db.query(
        `UPDATE public.opportunity_applications SET status='withdrawn' WHERE id=$1`,
        [fresh.appId],
      ),
    ).rejects.toThrow(/Only the application owner may withdraw/);
    await db.exec(`RESET app.allow_driver_withdraw;`);

    // 4) The rightful Driver with the GUC set CAN withdraw. withdrawn_at is
    // server-set to now() even if the client tried to inject a stale value.
    await db.exec(
      `RESET ROLE; SET request.jwt.claim.sub = '${fresh.driverId}'; SET app.allow_driver_withdraw = 'true';`,
    );
    const ok = await db.query<{ status: string; withdrawn_at: string | null }>(
      `UPDATE public.opportunity_applications
          SET status='withdrawn', withdrawn_at = timestamptz '1970-01-01'
        WHERE id=$1 RETURNING status, withdrawn_at`,
      [fresh.appId],
    );
    expect(ok.rows[0].status).toBe('withdrawn');
    expect(ok.rows[0].withdrawn_at).not.toBeNull();
    // Server-set means the year must be current, not 1970.
    expect(new Date(ok.rows[0].withdrawn_at as string).getUTCFullYear()).toBeGreaterThan(2020);
    await db.exec(`RESET app.allow_driver_withdraw; RESET request.jwt.claim.sub;`);

    // 5) After withdrawal, withdrawn_at is immutable via ordinary update.
    await asAuthenticated(db, IDS.recruiterUser);
    await expect(
      db.query(
        `UPDATE public.opportunity_applications SET withdrawn_at = timestamptz '1970-01-01' WHERE id=$1`,
        [fresh.appId],
      ),
    ).rejects.toThrow(/Recruiters may only update application status/);
    await asOwner(db);
  });

  it('FIX 3: idempotent replay precedes mutable eligibility (opportunity closed / restriction added)', async () => {
    // Set up a fresh Driver + opportunity we can safely close afterward.
    await asOwner(db);
    const closingOppId = 'dddd0000-dddd-4ddd-8ddd-ddddffff0001';
    const driverId = 'dddd0001-dddd-4ddd-8ddd-ddddffff0002';
    await db.exec(
      `INSERT INTO public.opportunities(id,recruiter_id,title,company_name,status,admin_review_status)
         VALUES ('${closingOppId}','${IDS.recruiterProfile}','Closing Lane','Acme','active','approved');
       INSERT INTO auth.users(id,email) VALUES ('${driverId}','fix3-close@test') ON CONFLICT DO NOTHING;
       INSERT INTO public.driver_opportunity_profiles(user_id, full_name, email, phone, profile_completed)
         VALUES ('${driverId}','Fix3 Close','fix3-close@test','555-3001', true) ON CONFLICT DO NOTHING;`,
    );

    const KEY_A = 'fix3-close-key-a-000001';
    const KEY_B = 'fix3-close-key-b-000001';

    await asAuthenticated(db, driverId);
    const r1 = await db.query<{ application_id: string; result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(
         $1::uuid, $2, 'first', true, true, true, 'email', true)`,
      [closingOppId, KEY_A],
    );
    expect(r1.rows[0].result_code).toBe('created');
    const firstId = r1.rows[0].application_id;

    // Now close the opportunity — eligibility would fail for a NEW submission.
    await asOwner(db);
    await db.exec(`UPDATE public.opportunities SET status='closed' WHERE id='${closingOppId}';`);

    // Key A replay: still returns idempotent_replay + original id, even
    // though driver_can_access_opportunity would now return false.
    await asAuthenticated(db, driverId);
    const replay = await db.query<{ application_id: string; result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(
         $1::uuid, $2, 'retry', true, true, true, 'email', true)`,
      [closingOppId, KEY_A],
    );
    expect(replay.rows[0].result_code).toBe('idempotent_replay');
    expect(replay.rows[0].application_id).toBe(firstId);

    // Key B (new key) DOES hit business validation and fails with
    // opportunity_unavailable.
    const fresh = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(
         $1::uuid, $2, 'newkey', true, true, true, 'email', true)`,
      [closingOppId, KEY_B],
    );
    expect(fresh.rows[0].result_code).toBe('opportunity_unavailable');

    // Same shape for submit_request_info: reopen the opp, seed an inquiry,
    // then add a messaging restriction and prove Key A still replays.
    await asOwner(db);
    await db.exec(`UPDATE public.opportunities SET status='active' WHERE id='${closingOppId}';`);
    const INFO_A = 'fix3-info-key-a-000001';
    const INFO_B = 'fix3-info-key-b-000001';
    await asAuthenticated(db, driverId);
    const info1 = await db.query<{ application_id: string; result_code: string }>(
      `SELECT * FROM public.submit_request_info($1::uuid, $2, 'q?', 'email', true)`,
      [closingOppId, INFO_A],
    );
    expect(info1.rows[0].result_code).toBe('created');

    await asOwner(db);
    await db.exec(
      `INSERT INTO public.marketplace_user_restrictions(user_id, scope, restriction, reason_code)
         VALUES ('${driverId}','messaging','blocked','spam')`,
    );

    await asAuthenticated(db, driverId);
    const infoReplay = await db.query<{ application_id: string; result_code: string }>(
      `SELECT * FROM public.submit_request_info($1::uuid, $2, 'q?', 'email', true)`,
      [closingOppId, INFO_A],
    );
    expect(infoReplay.rows[0].result_code).toBe('idempotent_replay');
    expect(infoReplay.rows[0].application_id).toBe(info1.rows[0].application_id);

    const infoFresh = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_request_info($1::uuid, $2, 'new q?', 'email', true)`,
      [closingOppId, INFO_B],
    );
    expect(infoFresh.rows[0].result_code).toBe('restricted');
    await asOwner(db);
    await db.exec(`DELETE FROM public.marketplace_user_restrictions WHERE user_id='${driverId}';`);
  });

  it('FIX 4: getAllowedRecruiterTransitions excludes onboarding, hired, withdrawn from every state', () => {
    const forbidden = new Set(['onboarding', 'hired', 'withdrawn']);
    for (const from of [
      'new','viewed','contact_requested','contacted','call_scheduled',
      'waiting_documents','interviewing','offer_sent','onboarding',
      'hired','rejected','withdrawn',
    ]) {
      const allowed = getAllowedRecruiterTransitions(from) as string[];
      for (const s of allowed) {
        expect(forbidden.has(s), `state ${from} → ${s} must be forbidden`).toBe(false);
      }
    }
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
