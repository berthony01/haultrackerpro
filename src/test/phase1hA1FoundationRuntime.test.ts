// @vitest-environment node
// =====================================================================
// Phase 1H-A1 — Remediated foundation runtime harness (PGlite)
// =====================================================================
// Applies the exact candidate migration on disk and exercises production
// authorization paths with SET ROLE authenticated where RLS is material.
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

const IDS = {
  driverA: '11111111-1111-1111-1111-111111111111',
  driverB: '22222222-2222-2222-2222-222222222222',
  blockedDriver: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  recruiterUser: '33333333-3333-3333-3333-333333333333',
  recruiterProfile: '44444444-4444-4444-4444-444444444444',
  opportunity: '55555555-5555-5555-5555-555555555555',
  historicalInquiryId: '66666666-6666-6666-6666-666666666666',
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
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$;

    CREATE TABLE public.driver_opportunity_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      full_name text,
      phone text,
      email text,
      city text,
      state text,
      cdl_class text,
      years_experience numeric,
      endorsements text[] NOT NULL DEFAULT '{}',
      trailer_experience text[] NOT NULL DEFAULT '{}',
      preferred_driver_type text,
      preferred_route_type text,
      preferred_home_time text,
      preferred_states text[] NOT NULL DEFAULT '{}',
      min_weekly_gross numeric,
      min_weekly_net numeric,
      min_effective_rpm numeric,
      available_start_date date,
      willing_to_relocate boolean NOT NULL DEFAULT false,
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
      recruiter_name text NOT NULL,
      recruiter_email text,
      recruiter_phone text,
      company_name text NOT NULL,
      company_website text,
      dot_number text,
      mc_number text,
      company_phone text,
      company_address text,
      company_city text,
      company_state text,
      hiring_states text[] NOT NULL DEFAULT '{}',
      equipment_types text[] NOT NULL DEFAULT '{}',
      driver_types_hired text[] NOT NULL DEFAULT '{}',
      verification_status text NOT NULL DEFAULT 'approved',
      status text NOT NULL DEFAULT 'active',
      admin_notes text,
      verified_at timestamptz,
      verified_by uuid,
      posting_terms_accepted_at timestamptz,
      posting_terms_version text,
      legacy_terms_grandfathered_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT recruiter_profiles_user_unique UNIQUE (user_id)
    );

    CREATE TABLE public.opportunities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
      title text NOT NULL,
      company_name text NOT NULL,
      hiring_city text,
      hiring_state text,
      hiring_states text[] NOT NULL DEFAULT '{}',
      driver_type text,
      route_type text,
      trailer_type text,
      pay_model text,
      cpm numeric,
      percentage_pay numeric,
      flat_weekly_pay numeric,
      estimated_weekly_gross numeric,
      estimated_weekly_miles numeric,
      estimated_loaded_miles numeric,
      estimated_deadhead_miles numeric,
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
      ('${IDS.recruiterUser}','recruiter@test');

    INSERT INTO public.recruiter_profiles(
      id,user_id,recruiter_name,recruiter_email,company_name,dot_number,posting_terms_accepted_at,posting_terms_version
    ) VALUES (
      '${IDS.recruiterProfile}','${IDS.recruiterUser}','Test Recruiter','recruiter@test','Acme','DOT123',now(),'2026-07-17.v1'
    );

    INSERT INTO public.opportunities(
      id,recruiter_id,title,company_name,hiring_city,hiring_state,driver_type,route_type,trailer_type,
      pay_model,cpm,estimated_weekly_gross,estimated_weekly_miles,status,admin_review_status
    ) VALUES (
      '${IDS.opportunity}','${IDS.recruiterProfile}','Regional OTR','Acme','Dallas','TX','company','regional','dry_van',
      'cpm',0.62,1800,2800,'active','approved'
    );

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

let db: AnyPGlite;

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;
  await primeBaseline(db);
  await db.exec(loadCandidate());
});

describe('Phase 1H-A1 remediation candidate migration (PGlite)', () => {
  it('harness is active and applies the exact candidate migration', () => {
    expect(db).toBeTruthy();
  });

  it('status CHECK includes onboarding while preserving existing workflow statuses', async () => {
    const r = await db.query<{ pg_get_constraintdef: string }>(
      `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='opportunity_applications_status_chk'`,
    );
    const def = r.rows[0].pg_get_constraintdef;
    for (const status of ['new','viewed','contact_requested','call_scheduled','waiting_documents','interviewing','offer_sent','onboarding','hired','rejected','withdrawn']) {
      expect(def).toContain(`'${status}'`);
    }
  });

  it('UI transition helper does not offer recruiter-selected onboarding or hired from offer_sent', () => {
    expect(getAllowedRecruiterTransitions('offer_sent')).toEqual(['rejected']);
    expect(getAllowedRecruiterTransitions('offer_sent')).not.toContain('onboarding');
    expect(getAllowedRecruiterTransitions('offer_sent')).not.toContain('hired');
  });

  it('split RPCs exist and legacy all-purpose submit signature is removed', async () => {
    const funcs = await db.query<{ proname: string; args: string }>(
      `SELECT proname, pg_get_function_identity_arguments(oid) AS args
         FROM pg_proc
        WHERE pronamespace='public'::regnamespace
          AND proname IN ('submit_opportunity_application','submit_request_info')
        ORDER BY proname, args`,
    );
    expect(funcs.rows).toEqual([
      { proname: 'submit_opportunity_application', args: '_opportunity_id uuid, _idempotency_key text, _message text' },
      { proname: 'submit_request_info', args: '_opportunity_id uuid, _idempotency_key text, _message text' },
    ]);
  });

  it('direct authenticated INSERT is denied by RLS; application creation is RPC-only', async () => {
    await asAuthenticated(db, IDS.driverB);
    await expect(
      db.query(
        `INSERT INTO public.opportunity_applications(opportunity_id,driver_user_id,recruiter_id,application_type,status)
         VALUES ($1,$2,$3,'apply','new')`,
        [IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/row-level security|violates row-level security|permission denied/i);
  });

  it('submit_opportunity_application(apply) creates a server-authoritative snapshot and ignores client PII entirely', async () => {
    await asAuthenticated(db, IDS.driverA);
    const r = await db.query<{ application_id: string; application_status: string; result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application($1::uuid, 'apply-key-1', 'client says Mallory / 999-9999')`,
      [IDS.opportunity],
    );
    expect(r.rows[0].result_code).toBe('created');
    expect(r.rows[0].application_status).toBe('new');

    const row = await db.query<{ snapshot_version: number; snap: string; phone: string | null; email: string | null; message: string | null }>(
      `SELECT snapshot_version, submission_snapshot::text AS snap, driver_phone_snapshot AS phone,
              driver_email_snapshot AS email, message
         FROM public.opportunity_applications WHERE id=$1`,
      [r.rows[0].application_id],
    );
    const snap = JSON.parse(row.rows[0].snap);
    expect(row.rows[0].snapshot_version).toBe(1);
    expect(snap.driver_profile.full_name).toBe('Ada Driver');
    expect(JSON.stringify(snap)).not.toContain('Mallory');
    expect(JSON.stringify(snap)).not.toContain('999-9999');
    expect(row.rows[0].phone).toBeNull();
    expect(row.rows[0].email).toBeNull();
    expect(row.rows[0].message).toBe('client says Mallory / 999-9999');
  });

  it('formal apply idempotent replay returns the same application_id and duplicate apply is blocked', async () => {
    await asAuthenticated(db, IDS.driverA);
    const before = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply'`,
      [IDS.driverA, IDS.opportunity],
    );
    const replay = await db.query<{ application_id: string; result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application($1::uuid, 'apply-key-1', 'retry')`,
      [IDS.opportunity],
    );
    expect(replay.rows[0].result_code).toBe('idempotent_replay');
    expect(replay.rows[0].application_id).toBe(before.rows[0].id);

    const dup = await db.query<{ application_id: string; result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application($1::uuid, 'apply-key-2', 'duplicate')`,
      [IDS.opportunity],
    );
    expect(dup.rows[0].result_code).toBe('duplicate_same_type');
    expect(dup.rows[0].application_id).toBe(before.rows[0].id);
  });

  it('request_info RPC coexists with apply, uses snapshot_version 0, and preserves inquiry history', async () => {
    await asAuthenticated(db, IDS.driverB);
    const info = await db.query<{ application_id: string; result_code: string }>(
      `SELECT * FROM public.submit_request_info($1::uuid, 'info-key-1', 'Please send details')`,
      [IDS.opportunity],
    );
    expect(info.rows[0].result_code).toBe('created');

    const apply = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application($1::uuid, 'driver-b-apply-key', 'Applying now')`,
      [IDS.opportunity],
    );
    expect(apply.rows[0].result_code).toBe('created');

    const rows = await db.query<{ application_type: string; snapshot_version: number; message: string | null }>(
      `SELECT application_type, snapshot_version, message
         FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2
        ORDER BY application_type`,
      [IDS.driverB, IDS.opportunity],
    );
    expect(rows.rows.map((r) => r.application_type)).toEqual(['apply', 'request_info']);
    expect(rows.rows.find((r) => r.application_type === 'request_info')?.snapshot_version).toBe(0);
    expect(rows.rows.find((r) => r.application_type === 'request_info')?.message).toBe('Please send details');

    const dupInfo = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_request_info($1::uuid, 'info-key-2', 'again')`,
      [IDS.opportunity],
    );
    expect(dupInfo.rows[0].result_code).toBe('duplicate_same_type');
  });

  it('new apply rows must have snapshot_version >= 1 while historical request_info remains version 0', async () => {
    const versions = await db.query<{ application_type: string; min_version: number }>(
      `SELECT application_type, MIN(snapshot_version)::int AS min_version
         FROM public.opportunity_applications
        GROUP BY application_type
        ORDER BY application_type`,
    );
    expect(versions.rows.find((r) => r.application_type === 'apply')?.min_version).toBe(1);

    const historical = await db.query<{ snapshot_version: number; idempotency_key: string | null; submission_snapshot: string }>(
      `SELECT snapshot_version, idempotency_key, submission_snapshot::text AS submission_snapshot
         FROM public.opportunity_applications WHERE id=$1`,
      [IDS.historicalInquiryId],
    );
    expect(historical.rows[0].snapshot_version).toBe(0);
    expect(historical.rows[0].idempotency_key).toBeNull();
    expect(JSON.parse(historical.rows[0].submission_snapshot)).toEqual({});
  });

  it('canonical eligibility blocks driver apply when recruiter posting eligibility is removed', async () => {
    await asOwner(db);
    await db.exec(`UPDATE public.recruiter_profiles SET posting_terms_accepted_at = NULL WHERE id='${IDS.recruiterProfile}';`);
    await asAuthenticated(db, IDS.blockedDriver);
    await expect(
      db.query(`SELECT * FROM public.submit_opportunity_application($1::uuid, 'eligibility-key', 'apply')`, [IDS.opportunity]),
    ).rejects.toThrow(/not accepting applications/);
    await asOwner(db);
    await db.exec(`UPDATE public.recruiter_profiles SET posting_terms_accepted_at = now() WHERE id='${IDS.recruiterProfile}';`);
  });

  it('marketplace restriction blocks submission while users cannot SELECT private restriction rows/admin_note', async () => {
    await asOwner(db);
    await db.exec(`
      INSERT INTO public.marketplace_user_restrictions(user_id, scope, restriction, reason_code, admin_note)
      VALUES ('${IDS.blockedDriver}','driver_applications','blocked','abuse','private admin note');
    `);

    await asAuthenticated(db, IDS.blockedDriver);
    const direct = await db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.marketplace_user_restrictions`);
    expect(direct.rows[0].count).toBe('0');

    const safe = await db.query<{ reason_code: string; admin_note?: string }>(`SELECT * FROM public.get_my_marketplace_restrictions()`);
    expect(safe.rows[0].reason_code).toBe('abuse');
    expect(Object.prototype.hasOwnProperty.call(safe.rows[0], 'admin_note')).toBe(false);

    await expect(
      db.query(`SELECT * FROM public.submit_request_info($1::uuid, 'blocked-info-key', 'q')`, [IDS.opportunity]),
    ).rejects.toThrow(/restricted/);
  });

  it('recruiter RLS update cannot set onboarding or hired from offer_sent; only rejection remains recruiter-selectable', async () => {
    await asOwner(db);
    const app = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply' LIMIT 1`,
      [IDS.driverA, IDS.opportunity],
    );
    await db.query(`UPDATE public.opportunity_applications SET status='offer_sent' WHERE id=$1`, [app.rows[0].id]);

    await asAuthenticated(db, IDS.recruiterUser);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='onboarding' WHERE id=$1`, [app.rows[0].id]),
    ).rejects.toThrow(/Only server-authorized workflow|row-level security|permission denied/i);
    await expect(
      db.query(`UPDATE public.opportunity_applications SET status='hired' WHERE id=$1`, [app.rows[0].id]),
    ).rejects.toThrow(/Only server-authorized workflow|Illegal application status|row-level security|permission denied/i);

    await db.query(`UPDATE public.opportunity_applications SET status='rejected' WHERE id=$1`, [app.rows[0].id]);
    const s = await db.query<{ status: string }>(`SELECT status FROM public.opportunity_applications WHERE id=$1`, [app.rows[0].id]);
    expect(s.rows[0].status).toBe('rejected');
  });

  it('snapshot/version/submitted_at/application identity are immutable after formal apply', async () => {
    await asOwner(db);
    const app = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply' LIMIT 1`,
      [IDS.driverB, IDS.opportunity],
    );

    await expect(db.query(`UPDATE public.opportunity_applications SET submission_snapshot='{"tampered":true}'::jsonb WHERE id=$1`, [app.rows[0].id])).rejects.toThrow(/submission_snapshot is immutable/);
    await expect(db.query(`UPDATE public.opportunity_applications SET snapshot_version=99 WHERE id=$1`, [app.rows[0].id])).rejects.toThrow(/snapshot_version is immutable/);
    await expect(db.query(`UPDATE public.opportunity_applications SET submitted_at=now()+interval '1 day' WHERE id=$1`, [app.rows[0].id])).rejects.toThrow(/submitted_at is immutable/);
    await expect(db.query(`UPDATE public.opportunity_applications SET driver_user_id=$2 WHERE id=$1`, [app.rows[0].id, IDS.driverA])).rejects.toThrow(/application identity is immutable/);
  });

  it('opportunity_offers has SELECT-only authenticated grants and rejects direct authenticated INSERT', async () => {
    const grants = await db.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema='public' AND table_name='opportunity_offers' AND grantee='authenticated'`,
    );
    expect(grants.rows.map((r) => r.privilege_type).sort()).toEqual(['SELECT']);

    await asAuthenticated(db, IDS.recruiterUser);
    await expect(
      db.query(
        `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,expires_at,sent_snapshot,snapshot_version)
         VALUES ('${IDS.historicalInquiryId}','${IDS.opportunity}','${IDS.driverA}','${IDS.recruiterProfile}','sent',now()+interval '7 days','{"x":1}'::jsonb,1)`,
      ),
    ).rejects.toThrow(/permission denied|violates row-level security/i);
  });

  it('opportunity_offers enforces apply identity consistency, future expiry, sent snapshot, immutability, and one sent offer', async () => {
    await asOwner(db);
    const app = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply' LIMIT 1`,
      [IDS.driverB, IDS.opportunity],
    );

    await expect(
      db.query(
        `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,expires_at,sent_snapshot,snapshot_version)
         VALUES ($1,$2,$3,$4,'sent',now()+interval '7 days','{"x":1}'::jsonb,1)`,
        [app.rows[0].id, IDS.opportunity, IDS.driverA, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/offer identity must match application identity/);

    await expect(
      db.query(
        `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,expires_at,sent_snapshot,snapshot_version)
         VALUES ($1,$2,$3,$4,'sent',now()-interval '1 day','{"x":1}'::jsonb,1)`,
        [app.rows[0].id, IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/future expires_at/);

    const offer = await db.query<{ id: string }>(
      `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,pay_description,expires_at,sent_snapshot,snapshot_version)
       VALUES ($1,$2,$3,$4,'sent','$0.62/mile',now()+interval '7 days','{"terms":"v1"}'::jsonb,1)
       RETURNING id`,
      [app.rows[0].id, IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
    );

    await expect(db.query(`UPDATE public.opportunity_offers SET pay_description='$0.70/mile' WHERE id=$1`, [offer.rows[0].id])).rejects.toThrow(/offer terms are immutable once sent/);

    await expect(
      db.query(
        `INSERT INTO public.opportunity_offers(application_id,opportunity_id,driver_user_id,recruiter_id,status,pay_description,expires_at,sent_snapshot,snapshot_version)
         VALUES ($1,$2,$3,$4,'sent','$0.65/mile',now()+interval '8 days','{"terms":"v2"}'::jsonb,1)`,
        [app.rows[0].id, IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('unrelated billing tables are not altered by the candidate migration', async () => {
    const subs = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' ORDER BY column_name`,
    );
    expect(subs.rows.map((r) => r.column_name).sort()).toEqual(['id', 'status', 'user_id']);
    const rbp = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='recruiter_billing_profiles' ORDER BY column_name`,
    );
    expect(rbp.rows.map((r) => r.column_name).sort()).toEqual(['id', 'recruiter_id', 'stripe_customer_id']);
  });
});