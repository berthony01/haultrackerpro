// @vitest-environment node
// =====================================================================
// Phase 1H-A1 — Foundation runtime harness (real Postgres via PGlite)
// =====================================================================
// Applies the exact A1 candidate migration on disk against an
// in-process PGlite instance and exercises:
//   Category 1  — formal application creates one row + immutable snapshot
//   Category 2  — idempotent replay returns same application_id
//   Category 3  — same-type duplicate is blocked
//   Category 4  — existing inquiry does NOT block formal application
//   Category 5  — formal application does NOT erase inquiry history
//   Category 25 — submission_snapshot / snapshot_version / submitted_at
//                 are immutable after formal submission (freeze trigger)
//   Category 28 — historical request_info rows remain valid + queryable
//   Category 29 — unrelated tables (subscriptions / recruiter_billing)
//                 not touched by the candidate migration
//
// Categories 6–24, 26, 27, 30 are covered in Phase 1H-A2/A3/A4.
//
// This harness must NOT be skipped. PGlite is a declared devDependency.
// =====================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

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

async function primeBaseline(db: AnyPGlite, ctx: { driverA: string; driverB: string; recruiterUser: string; recruiterProfile: string; opportunity: string; historicalInquiryId: string }) {
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;

    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text
    );

    -- Session-scoped current user via GUC — mimics auth.uid()
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;

    CREATE TABLE public.recruiter_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'active',
      verification_status text NOT NULL DEFAULT 'approved',
      full_name text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.opportunities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
      title text NOT NULL,
      company_name text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.opportunity_applications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
      driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
      driver_profile_id uuid,
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

    -- Stub helpers referenced by RLS in the candidate migration.
    CREATE OR REPLACE FUNCTION public.is_admin(_uid uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE OR REPLACE FUNCTION public.current_user_can_manage_recruiter_opportunities(_rid uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.recruiter_profiles rp
          WHERE rp.id = _rid
            AND rp.user_id = auth.uid()
            AND rp.status <> 'suspended'
            AND rp.verification_status <> 'suspended'
        )
      $$;

    -- Unrelated production tables — used only to prove the candidate
    -- migration doesn't touch them (Category 29).
    CREATE TABLE public.subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'inactive'
    );
    CREATE TABLE public.recruiter_billing_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recruiter_id uuid NOT NULL,
      stripe_customer_id text
    );
  `);

  await db.exec(`
    INSERT INTO auth.users(id,email) VALUES
      ('${ctx.driverA}','driver-a@test'),
      ('${ctx.driverB}','driver-b@test'),
      ('${ctx.recruiterUser}','recruiter@test');
    INSERT INTO public.recruiter_profiles(id,user_id,full_name)
      VALUES ('${ctx.recruiterProfile}','${ctx.recruiterUser}','Test Recruiter');
    INSERT INTO public.opportunities(id,recruiter_id,title,company_name,status)
      VALUES ('${ctx.opportunity}','${ctx.recruiterProfile}','Regional OTR','Acme','active');

    -- Historical inquiry pre-Phase 1H (Category 28)
    INSERT INTO public.opportunity_applications
      (id, opportunity_id, driver_user_id, recruiter_id, application_type, status, message)
      VALUES ('${ctx.historicalInquiryId}',
              '${ctx.opportunity}','${ctx.driverA}','${ctx.recruiterProfile}',
              'request_info','new','historical: any question?');
  `);
}

async function asUser(db: AnyPGlite, uid: string | null) {
  if (uid === null) {
    await db.exec(`RESET request.jwt.claim.sub; SET LOCAL ROLE NONE;`);
    return;
  }
  await db.exec(`SET request.jwt.claim.sub = '${uid}';`);
}

const IDS = {
  driverA: '11111111-1111-1111-1111-111111111111',
  driverB: '22222222-2222-2222-2222-222222222222',
  recruiterUser: '33333333-3333-3333-3333-333333333333',
  recruiterProfile: '44444444-4444-4444-4444-444444444444',
  opportunity: '55555555-5555-5555-5555-555555555555',
  historicalInquiryId: '66666666-6666-6666-6666-666666666666',
};

let db: AnyPGlite;

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;
  await primeBaseline(db, IDS);
  await db.exec(loadCandidate());
});

describe('Phase 1H-A1 — foundation candidate migration (PGlite)', () => {
  it('PGlite harness is real (declared devDependency, not skipped)', () => {
    expect(db).toBeTruthy();
  });

  it('candidate migration adds submission_snapshot / snapshot_version / idempotency_key / submitted_at / withdrawn_at columns', async () => {
    const r = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='opportunity_applications'
         AND column_name IN
           ('submission_snapshot','snapshot_version','idempotency_key','submitted_at','withdrawn_at')
       ORDER BY column_name`,
    );
    expect(r.rows.map((x) => x.column_name)).toEqual(
      ['idempotency_key', 'snapshot_version', 'submission_snapshot', 'submitted_at', 'withdrawn_at'],
    );
  });

  it('status CHECK includes onboarding (added between offer_sent and hired)', async () => {
    const r = await db.query<{ pg_get_constraintdef: string }>(
      `SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conname='opportunity_applications_status_chk'`,
    );
    expect(r.rows[0].pg_get_constraintdef).toContain(`'onboarding'`);
  });

  it('legacy (opportunity_id, driver_user_id) unique constraint is dropped', async () => {
    const r = await db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname='opportunity_applications_unique'`,
    );
    expect(r.rows.length).toBe(0);
  });

  it('partial unique indexes for active apply and request_info exist', async () => {
    const r = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname='public' AND tablename='opportunity_applications'
         AND indexname IN
           ('opportunity_applications_active_apply_uidx','opportunity_applications_request_info_uidx','opportunity_applications_idem_uidx')`,
    );
    expect(new Set(r.rows.map((x) => x.indexname))).toEqual(
      new Set([
        'opportunity_applications_active_apply_uidx',
        'opportunity_applications_request_info_uidx',
        'opportunity_applications_idem_uidx',
      ]),
    );
  });

  it('opportunity_offers table created with RLS enabled and grants', async () => {
    const t = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c
       WHERE c.relname='opportunity_offers'`,
    );
    expect(t.rows[0].relrowsecurity).toBe(true);
    const g = await db.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema='public' AND table_name='opportunity_offers'
         AND grantee IN ('authenticated','service_role')`,
    );
    expect(g.rows.some((r) => r.grantee === 'authenticated' && r.privilege_type === 'INSERT')).toBe(true);
    expect(g.rows.some((r) => r.grantee === 'service_role')).toBe(true);
  });

  it('opportunity_offers has one-actionable-sent-per-application partial unique index', async () => {
    const r = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname='public' AND indexname='opportunity_offers_one_sent_per_app_uidx'`,
    );
    expect(r.rows[0].indexdef).toContain(`(status = 'sent'::text)`);
  });

  it('marketplace_user_restrictions table exists with RLS and grants', async () => {
    const t = await db.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE relname='marketplace_user_restrictions'`,
    );
    expect(t.rows[0].relrowsecurity).toBe(true);
    const g = await db.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema='public' AND table_name='marketplace_user_restrictions'`,
    );
    // authenticated should have SELECT but NOT INSERT (server-only via admin/service_role).
    expect(g.rows.some((r) => r.grantee === 'authenticated' && r.privilege_type === 'SELECT')).toBe(true);
    expect(g.rows.some((r) => r.grantee === 'authenticated' && r.privilege_type === 'INSERT')).toBe(false);
  });

  it('submit_opportunity_application function exists, is SECURITY DEFINER, and only authenticated has EXECUTE (not PUBLIC)', async () => {
    const r = await db.query<{ prosecdef: boolean; proname: string }>(
      `SELECT prosecdef, proname FROM pg_proc
       WHERE proname='submit_opportunity_application' AND pronamespace='public'::regnamespace`,
    );
    expect(r.rows[0].prosecdef).toBe(true);

    const acl = await db.query<{ acl: string | null }>(
      `SELECT array_to_string(proacl, ',') AS acl FROM pg_proc
       WHERE proname='submit_opportunity_application' AND pronamespace='public'::regnamespace`,
    );
    const s = acl.rows[0].acl ?? '';
    expect(s).not.toContain('=X/'); // no PUBLIC EXECUTE
    expect(s).toContain('authenticated=X');
  });

  // -------------------------------------------------------------------
  // Category 1 — formal application creates one row + immutable snapshot
  // -------------------------------------------------------------------
  it('Category 1: submit_opportunity_application(apply) creates exactly one formal application with a captured snapshot', async () => {
    await asUser(db, IDS.driverA);
    const snap = { form_version: 1, full_name: 'Ada Driver', cdl_class: 'A', endorsements: ['H'], years_experience: 5, message: 'Interested' };
    const r = await db.query<{ application_id: string; status: string; result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(
         $1::uuid, 'apply', $2::jsonb, 1, 'cat1-key-1', 'email', 'ada@test', NULL, 'Interested')`,
      [IDS.opportunity, JSON.stringify(snap)],
    );
    expect(r.rows[0].result_code).toBe('created');
    expect(r.rows[0].status).toBe('new');

    const row = await db.query<{ cnt: string; snap: string; sv: number; sub_at: string }>(
      `SELECT COUNT(*)::text AS cnt, submission_snapshot::text AS snap, snapshot_version AS sv, submitted_at::text AS sub_at
         FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply'
        GROUP BY submission_snapshot, snapshot_version, submitted_at`,
      [IDS.driverA, IDS.opportunity],
    );
    expect(row.rows[0].cnt).toBe('1');
    expect(row.rows[0].sv).toBe(1);
    expect(JSON.parse(row.rows[0].snap).full_name).toBe('Ada Driver');
    expect(row.rows[0].sub_at).toBeTruthy();
  });

  // -------------------------------------------------------------------
  // Category 2 — idempotent replay
  // -------------------------------------------------------------------
  it('Category 2: same idempotency_key returns idempotent_replay with same application_id and no new row', async () => {
    await asUser(db, IDS.driverA);
    const before = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply'`,
      [IDS.driverA, IDS.opportunity],
    );
    expect(before.rows.length).toBe(1);

    const r = await db.query<{ application_id: string; result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(
         $1::uuid, 'apply', '{"form_version":1}'::jsonb, 1, 'cat1-key-1', NULL, NULL, NULL, NULL)`,
      [IDS.opportunity],
    );
    expect(r.rows[0].result_code).toBe('idempotent_replay');
    expect(r.rows[0].application_id).toBe(before.rows[0].id);

    const after = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply'`,
      [IDS.driverA, IDS.opportunity],
    );
    expect(after.rows[0].n).toBe('1');
  });

  // -------------------------------------------------------------------
  // Category 3 — same-type duplicate blocked
  // -------------------------------------------------------------------
  it('Category 3: second apply with different idempotency_key is blocked as duplicate_same_type', async () => {
    await asUser(db, IDS.driverA);
    const r = await db.query<{ result_code: string; application_id: string }>(
      `SELECT * FROM public.submit_opportunity_application(
         $1::uuid, 'apply', '{"form_version":1}'::jsonb, 1, 'cat3-key-different', NULL, NULL, NULL, NULL)`,
      [IDS.opportunity],
    );
    expect(r.rows[0].result_code).toBe('duplicate_same_type');
    const n = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply'`,
      [IDS.driverA, IDS.opportunity],
    );
    expect(n.rows[0].n).toBe('1');
  });

  // -------------------------------------------------------------------
  // Category 4 & 5 — inquiry <-> apply coexistence
  // -------------------------------------------------------------------
  it('Category 4 & 5: driver B with pre-existing request_info can still submit apply; inquiry row is preserved', async () => {
    // Seed a request_info for driver B first (mimicking the current UI path).
    await db.exec(`
      INSERT INTO public.opportunity_applications
        (opportunity_id, driver_user_id, recruiter_id, application_type, status, message)
      VALUES ('${IDS.opportunity}','${IDS.driverB}','${IDS.recruiterProfile}',
              'request_info','new','driverB asked a question');
    `);

    await asUser(db, IDS.driverB);
    const r = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(
         $1::uuid, 'apply', '{"form_version":1,"full_name":"Driver B"}'::jsonb, 1, 'cat4-key', NULL, NULL, NULL, NULL)`,
      [IDS.opportunity],
    );
    expect(r.rows[0].result_code).toBe('created');

    const rows = await db.query<{ application_type: string; message: string | null }>(
      `SELECT application_type, message FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2
        ORDER BY application_type`,
      [IDS.driverB, IDS.opportunity],
    );
    expect(rows.rows.map((r) => r.application_type)).toEqual(['apply', 'request_info']);
    expect(rows.rows.find((r) => r.application_type === 'request_info')?.message).toBe(
      'driverB asked a question',
    );
  });

  it('Category 4 (converse): a duplicate request_info is blocked but the driver may still submit an apply', async () => {
    await asUser(db, IDS.driverB);
    const dup = await db.query<{ result_code: string }>(
      `SELECT * FROM public.submit_opportunity_application(
         $1::uuid, 'request_info', '{"form_version":1}'::jsonb, 1, 'cat4b-key', NULL, NULL, NULL, NULL)`,
      [IDS.opportunity],
    );
    expect(dup.rows[0].result_code).toBe('duplicate_same_type');
  });

  // -------------------------------------------------------------------
  // Category 25 — snapshot / submitted_at freeze
  // -------------------------------------------------------------------
  it('Category 25: submission_snapshot and snapshot_version and submitted_at are immutable after apply-submission', async () => {
    const app = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply' LIMIT 1`,
      [IDS.driverA, IDS.opportunity],
    );

    await expect(
      db.query(
        `UPDATE public.opportunity_applications
            SET submission_snapshot = '{"tampered":true}'::jsonb
          WHERE id=$1`,
        [app.rows[0].id],
      ),
    ).rejects.toThrow(/submission_snapshot is immutable/);

    await expect(
      db.query(
        `UPDATE public.opportunity_applications SET snapshot_version = 99 WHERE id=$1`,
        [app.rows[0].id],
      ),
    ).rejects.toThrow(/snapshot_version is immutable/);

    await expect(
      db.query(
        `UPDATE public.opportunity_applications SET submitted_at = now() + interval '1 day' WHERE id=$1`,
        [app.rows[0].id],
      ),
    ).rejects.toThrow(/submitted_at is immutable/);

    // Application identity is immutable
    await expect(
      db.query(
        `UPDATE public.opportunity_applications SET driver_user_id=$2 WHERE id=$1`,
        [app.rows[0].id, IDS.driverB],
      ),
    ).rejects.toThrow(/application identity is immutable/);

    // Status transitions still work.
    await db.query(
      `UPDATE public.opportunity_applications SET status='viewed' WHERE id=$1`,
      [app.rows[0].id],
    );
    const s = await db.query<{ status: string }>(
      `SELECT status FROM public.opportunity_applications WHERE id=$1`,
      [app.rows[0].id],
    );
    expect(s.rows[0].status).toBe('viewed');
  });

  // -------------------------------------------------------------------
  // Category 28 — historical request_info row preserved and queryable
  // -------------------------------------------------------------------
  it('Category 28: pre-Phase-1H historical request_info row still exists with snapshot_version=0 and null idempotency_key', async () => {
    const r = await db.query<{ id: string; snapshot_version: number; idempotency_key: string | null; message: string; submission_snapshot: string }>(
      `SELECT id, snapshot_version, idempotency_key, message, submission_snapshot::text AS submission_snapshot
         FROM public.opportunity_applications WHERE id=$1`,
      [IDS.historicalInquiryId],
    );
    expect(r.rows[0].snapshot_version).toBe(0);
    expect(r.rows[0].idempotency_key).toBeNull();
    expect(r.rows[0].message).toBe('historical: any question?');
    expect(JSON.parse(r.rows[0].submission_snapshot)).toEqual({});
  });

  // -------------------------------------------------------------------
  // Category 29 — unrelated billing surfaces untouched
  // -------------------------------------------------------------------
  it('Category 29: subscriptions and recruiter_billing_profiles were not altered by the candidate migration', async () => {
    const subs = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='subscriptions'
        ORDER BY column_name`,
    );
    expect(subs.rows.map((r) => r.column_name).sort()).toEqual(['id', 'status', 'user_id']);
    const rbp = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='recruiter_billing_profiles'
        ORDER BY column_name`,
    );
    expect(rbp.rows.map((r) => r.column_name).sort()).toEqual(['id', 'recruiter_id', 'stripe_customer_id']);
  });

  // -------------------------------------------------------------------
  // Opportunity_offers integrity — sent-offer immutability
  // -------------------------------------------------------------------
  it('opportunity_offers: once status=sent, pay_description and expires_at cannot be edited', async () => {
    const app = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply' LIMIT 1`,
      [IDS.driverA, IDS.opportunity],
    );
    const ins = await db.query<{ id: string }>(
      `INSERT INTO public.opportunity_offers
         (application_id, opportunity_id, driver_user_id, recruiter_id, status,
          pay_description, estimated_weekly_amount, expires_at, sent_snapshot, snapshot_version, sent_at)
       VALUES ($1,$2,$3,$4,'sent','$0.60/mile',1800, now()+interval '7 days',
               '{"form_version":1}'::jsonb, 1, now())
       RETURNING id`,
      [app.rows[0].id, IDS.opportunity, IDS.driverA, IDS.recruiterProfile],
    );
    await expect(
      db.query(
        `UPDATE public.opportunity_offers SET pay_description='$0.70/mile' WHERE id=$1`,
        [ins.rows[0].id],
      ),
    ).rejects.toThrow(/offer terms are immutable once sent/);

    // Status transition is still allowed.
    await db.query(
      `UPDATE public.opportunity_offers SET status='canceled', canceled_at=now() WHERE id=$1`,
      [ins.rows[0].id],
    );
    const s = await db.query<{ status: string }>(
      `SELECT status FROM public.opportunity_offers WHERE id=$1`,
      [ins.rows[0].id],
    );
    expect(s.rows[0].status).toBe('canceled');
  });

  it('opportunity_offers: only one status=sent per application (partial unique index)', async () => {
    const app = await db.query<{ id: string }>(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND opportunity_id=$2 AND application_type='apply' LIMIT 1`,
      [IDS.driverB, IDS.opportunity],
    );
    await db.query(
      `INSERT INTO public.opportunity_offers
         (application_id, opportunity_id, driver_user_id, recruiter_id, status,
          pay_description, sent_snapshot, snapshot_version, sent_at)
       VALUES ($1,$2,$3,$4,'sent','$0.55/mile','{"form_version":1}'::jsonb, 1, now())`,
      [app.rows[0].id, IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
    );
    await expect(
      db.query(
        `INSERT INTO public.opportunity_offers
           (application_id, opportunity_id, driver_user_id, recruiter_id, status,
            pay_description, sent_snapshot, snapshot_version, sent_at)
         VALUES ($1,$2,$3,$4,'sent','$0.60/mile','{"form_version":1}'::jsonb, 1, now())`,
        [app.rows[0].id, IDS.opportunity, IDS.driverB, IDS.recruiterProfile],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  // -------------------------------------------------------------------
  // Marketplace restriction gate
  // -------------------------------------------------------------------
  it('user_is_marketplace_blocked returns true for active blocked scope=all restrictions', async () => {
    // Insert a restriction for driver A (service_role in PGlite runs as owner).
    await db.exec(`
      INSERT INTO public.marketplace_user_restrictions(user_id, scope, restriction)
      VALUES ('${IDS.driverA}','driver_applications','blocked');
    `);
    const r = await db.query<{ blocked: boolean }>(
      `SELECT public.user_is_marketplace_blocked($1::uuid,'driver_applications') AS blocked`,
      [IDS.driverA],
    );
    expect(r.rows[0].blocked).toBe(true);
  });

  it('submit_opportunity_application refuses when driver is marketplace-blocked', async () => {
    await asUser(db, IDS.driverA);
    await expect(
      db.query(
        `SELECT * FROM public.submit_opportunity_application(
           $1::uuid, 'request_info', '{}'::jsonb, 1, 'blocked-key', NULL, NULL, NULL, 'q?')`,
        [IDS.opportunity],
      ),
    ).rejects.toThrow(/restricted/);
  });
});
