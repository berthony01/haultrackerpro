// @vitest-environment node
// =====================================================================
// Phase 1T-B2C5A — Controlled settlement DRAFT FINALIZATION proofs.
//
// Applies, in order, the REAL accepted Phase 1T-B1, B2A, B2B, B2C1, B2C2A,
// B2C3A, B2C4A, B2C4B and B2C4C candidates and then the REAL Phase 1T-B2C5A
// candidate inside PGlite on a minimal but faithful bootstrap, and proves
// catalog shape, ACLs, per-source CURRENT authorization, the exact draft ->
// finalized lifecycle rule (never idempotent), the four-column write boundary,
// single-event auditing, and full immutability of loads / items / matches.
//
// Table privileges for `authenticated` are granted ONLY inside this harness so
// RLS — never a missing GRANT — proves the direct-write boundary.
//
// No production database, no cloud application, no deploy, no publish.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const REL = {
  domain: '../lib/settlements/settlementDomain.ts',
  b1: '../../supabase/migration-candidates/20260808161500_phase1t_b1_settlement_schema.sql',
  b2a: '../../supabase/migration-candidates/20260808163500_phase1t_b2a_settlement_authorization_helpers.sql',
  b2b: '../../supabase/migration-candidates/20260808165000_phase1t_b2b_settlement_read_rls.sql',
  b2c1:
    '../../supabase/migration-candidates/20260808170500_phase1t_b2c1_carrier_driver_relationship_rpcs.sql',
  b2c2a:
    '../../supabase/migration-candidates/20260808172000_phase1t_b2c2a_settlement_draft_header_rpcs.sql',
  b2c3a:
    '../../supabase/migration-candidates/20260808173500_phase1t_b2c3a_settlement_item_rpcs.sql',
  b2c4a:
    '../../supabase/migration-candidates/20260808175000_phase1t_b2c4a_settlement_load_match_rpcs.sql',
  b2c4b:
    '../../supabase/migration-candidates/20260808180500_phase1t_b2c4b_settlement_load_match_suggestions.sql',
  b2c4c:
    '../../supabase/migration-candidates/20260808182000_phase1t_b2c4c_settlement_load_match_rejection.sql',
  b2c5a:
    '../../supabase/migration-candidates/20260808183500_phase1t_b2c5a_settlement_finalization.sql',
} as const;

const abs = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => fs.readFileSync(abs(rel), 'utf8');

const B1_SQL = read(REL.b1);
const B2A_SQL = read(REL.b2a);
const B2B_SQL = read(REL.b2b);
const B2C1_SQL = read(REL.b2c1);
const B2C2A_SQL = read(REL.b2c2a);
const B2C3A_SQL = read(REL.b2c3a);
const B2C4A_SQL = read(REL.b2c4a);
const B2C4B_SQL = read(REL.b2c4b);
const B2C4C_SQL = read(REL.b2c4c);
const B2C5A_SQL = read(REL.b2c5a);
const SELF_SRC = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');

/** Executable SQL only: `--` documentation lines removed. */
const CODE = B2C5A_SQL.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const FN = 'settlement_finalize_draft';

const ERR = {
  invalid: 'settlement_invalid_request',
  notFound: 'settlement_not_found',
  notFinalizable: 'settlement_not_finalizable',
  invalidSource: 'settlement_invalid_source',
  carrier: 'settlement_carrier_not_authorized',
  agency: 'settlement_agency_not_authorized',
  driverImport: 'settlement_driver_import_not_authorized',
} as const;

const LEAK =
  /relation "|\bcolumn\b|syntax error|violates|constraint "|pg_catalog|SQLSTATE|duplicate key/i;

const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $fn$
  SELECT nullif(current_setting('test.uid', true), '')::uuid;
$fn$;

CREATE TABLE public.subscriptions (
  user_id uuid PRIMARY KEY,
  plan_key text,
  status text
);

CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_name text
);

CREATE TABLE public.recruiter_billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL,
  user_id uuid NOT NULL,
  plan text,
  status text
);

CREATE TABLE public.agency_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE public.agency_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  role text NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.agency_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  plan_key text,
  status text
);

CREATE TABLE public.agency_delegation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  driver_user_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  status text NOT NULL,
  requested_permissions jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.driver_assistants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL,
  assistant_user_id uuid NOT NULL,
  status text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  agency_delegation_id uuid NULL
);

CREATE TABLE public.loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  load_date date NOT NULL DEFAULT '2026-07-02',
  dropoff_date date NULL,
  pickup_location text NOT NULL DEFAULT '',
  dropoff_location text NOT NULL DEFAULT '',
  loaded_miles numeric(12,2) NULL,
  estimated_pay numeric(14,2) NULL,
  actual_pay_received numeric(14,2) NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

/** Harness-only privileges; deliberately NOT part of the candidate. */
const HARNESS_GRANTS = `
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.carrier_driver_relationships,
  public.driver_settlements,
  public.driver_settlement_items,
  public.driver_settlement_matches,
  public.driver_settlement_events
TO authenticated;
GRANT SELECT ON
  public.subscriptions,
  public.recruiter_profiles,
  public.recruiter_billing_profiles,
  public.agency_profiles,
  public.agency_members,
  public.agency_entitlements,
  public.agency_delegation_requests,
  public.driver_assistants,
  public.loads
TO anon, authenticated;
`;

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; affectedRows?: number }>;
}

type Row = Record<string, unknown>;

let db: AnyPGlite;

const TABLES_SQL = `SELECT tablename AS n FROM pg_tables WHERE schemaname='public' ORDER BY 1`;
const FUNCS_SQL = `SELECT p.proname AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' ORDER BY 1`;
const IDX_SQL = `SELECT indexname AS n FROM pg_indexes WHERE schemaname='public' ORDER BY 1`;
const TRIGS_SQL = `SELECT t.tgname AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE NOT t.tgisinternal AND ns.nspname='public' ORDER BY 1`;
const VIEWS_SQL = `SELECT viewname AS n FROM pg_views WHERE schemaname='public' ORDER BY 1`;
const TYPES_SQL = `SELECT t.typname AS n FROM pg_type t JOIN pg_namespace ns ON ns.oid=t.typnamespace WHERE ns.nspname='public' AND t.typtype IN ('e','d') ORDER BY 1`;
const POLICIES_SQL = `SELECT (tablename || '.' || policyname) AS n FROM pg_policies WHERE schemaname='public' ORDER BY 1`;

let before: Record<string, string[]> = {};
let after: Record<string, string[]> = {};

async function names(sql: string): Promise<string[]> {
  const r = await db.query<{ n: string }>(sql);
  return r.rows.map((x) => x.n);
}

async function snapshotCatalog(): Promise<Record<string, string[]>> {
  return {
    tables: await names(TABLES_SQL),
    functions: await names(FUNCS_SQL),
    indexes: await names(IDX_SQL),
    triggers: await names(TRIGS_SQL),
    views: await names(VIEWS_SQL),
    types: await names(TYPES_SQL),
    policies: await names(POLICIES_SQL),
  };
}

// --- actors / fixtures -----------------------------------------------------
const U: Record<string, string> = {};
const S: Record<string, string> = {};

const P1 = '2026-07-01';
const P2 = '2026-07-07';

async function newUser(): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO auth.users DEFAULT VALUES RETURNING id`,
  );
  return r.rows[0].id;
}

async function asRole<T>(
  role: 'authenticated' | 'anon',
  uid: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid ?? '']);
  await db.exec(`SET ROLE ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE;`);
    await db.query(`SELECT set_config('test.uid', '', false)`);
  }
}

interface FinalizeResult {
  id: string;
  status: string;
  finalized_by_user_id: string | null;
  finalized_at: string | null;
}

async function finalize(
  actor: string | null,
  settlementId: string | null,
): Promise<FinalizeResult> {
  return asRole('authenticated', actor, async () => {
    const r = await db.query<FinalizeResult>(
      `SELECT (r).id, (r).status, (r).finalized_by_user_id,
              (r).finalized_at::text AS finalized_at
         FROM public.${FN}($1::uuid) AS r`,
      [settlementId],
    );
    return r.rows[0];
  });
}

async function failureMessage(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as Error).message;
  }
  return '<<no error raised>>';
}

async function mkDriverSettlement(
  driver: string,
  status: 'draft' | 'finalized' | 'voided' | 'superseded',
  creator = driver,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlements
       (driver_user_id, source, status, period_start, period_end, created_by_user_id)
     VALUES ($1,'driver_imported',$2,$3::date,$4::date,$5) RETURNING id`,
    [driver, status, P1, P2, creator],
  );
  return r.rows[0].id;
}

async function mkCarrierSettlement(
  driver: string,
  status: 'draft' | 'finalized',
  recruiter: string,
  relationship: string,
  creator: string,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlements
       (driver_user_id, source, status, carrier_recruiter_profile_id,
        carrier_driver_relationship_id, source_display_name_snapshot,
        period_start, period_end, created_by_user_id)
     VALUES ($1,'carrier_issued',$2,$3,$4,'Blue Line Freight',$5::date,$6::date,$7)
     RETURNING id`,
    [driver, status, recruiter, relationship, P1, P2, creator],
  );
  return r.rows[0].id;
}

async function mkAgencySettlement(
  driver: string,
  status: 'draft' | 'finalized',
  agency: string,
  creator: string,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlements
       (driver_user_id, source, status, agency_id, source_display_name_snapshot,
        period_start, period_end, created_by_user_id)
     VALUES ($1,'agency_prepared',$2,$3,'Acme Back Office',$4::date,$5::date,$6)
     RETURNING id`,
    [driver, status, agency, P1, P2, creator],
  );
  return r.rows[0].id;
}

async function mkItem(
  settlementId: string,
  creator: string,
  amount: string,
  itemType: 'load_pay' | 'deduction' = 'load_pay',
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlement_items
       (settlement_id, item_type, amount, created_by_user_id)
     VALUES ($1,$2,$3::numeric,$4) RETURNING id`,
    [settlementId, itemType, amount, creator],
  );
  return r.rows[0].id;
}

async function mkLoad(owner: string, status = 'completed'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.loads
       (user_id, status, load_date, dropoff_date, pickup_location,
        dropoff_location, loaded_miles, estimated_pay)
     VALUES ($1,$2,'2026-07-02'::date,'2026-07-05'::date,'Dallas, TX',
             'Atlanta, GA', 800.00, 1000.00) RETURNING id`,
    [owner, status],
  );
  return r.rows[0].id;
}

async function mkMatch(
  itemId: string,
  loadId: string,
  state: string,
  confidence: string | null,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlement_matches
       (settlement_item_id, driver_load_id, match_state, confidence)
     VALUES ($1,$2,$3,$4::numeric) RETURNING id`,
    [itemId, loadId, state, confidence],
  );
  return r.rows[0].id;
}

async function settlementRow(id: string): Promise<Row> {
  const r = await db.query<Row>(
    `SELECT to_jsonb(ds.*) AS j FROM public.driver_settlements ds WHERE ds.id=$1`,
    [id],
  );
  return (r.rows[0] as unknown as { j: Row }).j;
}

async function itemsSnapshot(): Promise<string> {
  const r = await db.query<{ f: string }>(
    `SELECT coalesce(jsonb_agg(to_jsonb(i.*) ORDER BY i.id)::text, '[]') AS f
       FROM public.driver_settlement_items i`,
  );
  return r.rows[0].f;
}

async function matchesSnapshot(): Promise<string> {
  const r = await db.query<{ f: string }>(
    `SELECT coalesce(jsonb_agg(to_jsonb(m.*) ORDER BY m.id)::text, '[]') AS f
       FROM public.driver_settlement_matches m`,
  );
  return r.rows[0].f;
}

async function loadsSnapshot(): Promise<string> {
  const r = await db.query<{ f: string }>(
    `SELECT coalesce(jsonb_agg(to_jsonb(l.*) ORDER BY l.id)::text, '[]') AS f
       FROM public.loads l`,
  );
  return r.rows[0].f;
}

interface EventRow {
  settlement_id: string;
  actor_user_id: string | null;
  event_type: string;
  metadata: Record<string, unknown>;
}

async function eventsFor(settlementId: string): Promise<EventRow[]> {
  const r = await db.query<EventRow>(
    `SELECT settlement_id, actor_user_id, event_type, metadata
       FROM public.driver_settlement_events
      WHERE settlement_id=$1 ORDER BY created_at, event_type`,
    [settlementId],
  );
  return r.rows;
}

async function eventCount(): Promise<number> {
  const r = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM public.driver_settlement_events`,
  );
  return Number(r.rows[0].c);
}

let recruiterId = '';
let recruiterUnpaidId = '';
let relActive = '';
let relEnded = '';
let relUnpaid = '';
let agencyId = '';

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;

  await db.exec(BOOTSTRAP);
  await db.exec(B1_SQL);
  await db.exec(HARNESS_GRANTS);
  await db.exec(B2A_SQL);
  await db.exec(B2B_SQL);
  await db.exec(B2C1_SQL);
  await db.exec(B2C2A_SQL);
  await db.exec(B2C3A_SQL);
  await db.exec(B2C4A_SQL);
  await db.exec(B2C4B_SQL);
  await db.exec(B2C4C_SQL);

  before = await snapshotCatalog();
  await db.exec(B2C5A_SQL);
  after = await snapshotCatalog();

  for (const k of [
    'dCarrier',
    'dCarrierEnded',
    'dCarrierUnpaid',
    'dAgency',
    'dAgencyManageOnly',
    'dImport',
    'dImportFree',
    'dImportStates',
    'dImportMisc',
    'assistantFinalize',
    'assistantManage',
    'assistantView',
    'assistantAgency',
    'assistantInactive',
    'assistantFree',
    'paidCarrier',
    'unpaidCarrier',
    'agencyOwner',
    'agencyFinalizer',
    'agencyManager',
    'stranger',
  ]) {
    U[k] = await newUser();
  }

  const sub = (uid: string, status: string, plan = 'pro_monthly') =>
    db.query(
      `INSERT INTO public.subscriptions (user_id, plan_key, status) VALUES ($1,$2,$3)`,
      [uid, plan, status],
    );
  for (const k of ['dImport', 'dImportStates', 'dImportMisc']) {
    await sub(U[k], 'active');
  }
  await sub(U.dImportFree, 'canceled');
  // Agency-side driver is deliberately Free (no subscription row at all).

  await db.query(
    `INSERT INTO public.driver_assistants
       (driver_user_id, assistant_user_id, status, permissions, agency_delegation_id)
     VALUES
       ($1,$2,'active','{"settlements_view":true,"settlements_manage":true,"settlements_finalize":true}'::jsonb, NULL),
       ($1,$3,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, NULL),
       ($1,$4,'active','{"settlements_view":true}'::jsonb, NULL),
       ($1,$5,'active','{"settlements_finalize":true}'::jsonb, gen_random_uuid()),
       ($1,$6,'revoked','{"settlements_finalize":true}'::jsonb, NULL),
       ($7,$8,'active','{"settlements_finalize":true}'::jsonb, NULL),
       ($9,$2,'active','{"settlements_view":true,"settlements_manage":true,"settlements_finalize":true}'::jsonb, NULL),
       ($10,$2,'active','{"settlements_view":true,"settlements_manage":true,"settlements_finalize":true}'::jsonb, NULL)`,
    [
      U.dImport,
      U.assistantFinalize,
      U.assistantManage,
      U.assistantView,
      U.assistantAgency,
      U.assistantInactive,
      U.dImportFree,
      U.assistantFree,
      U.dImportStates,
      U.dImportMisc,
    ],
  );

  // --- carrier business context --------------------------------------------
  recruiterId = (
    await db.query<{ id: string }>(
      `INSERT INTO public.recruiter_profiles (user_id, company_name)
       VALUES ($1,'Blue Line Freight') RETURNING id`,
      [U.paidCarrier],
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO public.recruiter_billing_profiles (recruiter_id, user_id, plan, status)
     VALUES ($1,$2,'growth','active')`,
    [recruiterId, U.paidCarrier],
  );

  recruiterUnpaidId = (
    await db.query<{ id: string }>(
      `INSERT INTO public.recruiter_profiles (user_id, company_name)
       VALUES ($1,'Lapsed Carrier') RETURNING id`,
      [U.unpaidCarrier],
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO public.recruiter_billing_profiles (recruiter_id, user_id, plan, status)
     VALUES ($1,$2,'growth','canceled')`,
    [recruiterUnpaidId, U.unpaidCarrier],
  );

  const mkRel = async (
    recruiter: string,
    driver: string,
    status: string,
  ): Promise<string> =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO public.carrier_driver_relationships
           (recruiter_id, driver_user_id, status, created_by_user_id, accepted_at)
         VALUES ($1,$2,$3,$4, now()) RETURNING id`,
        [recruiter, driver, status, driver],
      )
    ).rows[0].id;

  relActive = await mkRel(recruiterId, U.dCarrier, 'active');
  relEnded = await mkRel(recruiterId, U.dCarrierEnded, 'ended');
  relUnpaid = await mkRel(recruiterUnpaidId, U.dCarrierUnpaid, 'active');

  // --- agency business context ---------------------------------------------
  agencyId = (
    await db.query<{ id: string }>(
      `INSERT INTO public.agency_profiles (owner_user_id, name, status)
       VALUES ($1,'Acme Back Office','active') RETURNING id`,
      [U.agencyOwner],
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO public.agency_entitlements (agency_id, plan_key, status)
     VALUES ($1,'agency_team','manual_beta')`,
    [agencyId],
  );
  await db.query(
    `INSERT INTO public.agency_members (agency_id, member_user_id, role, status)
     VALUES ($1,$2,'agency_owner','active'),
            ($1,$3,'agency_member','active'),
            ($1,$4,'agency_member','active')`,
    [agencyId, U.agencyOwner, U.agencyFinalizer, U.agencyManager],
  );
  await db.query(
    `INSERT INTO public.agency_delegation_requests
       (agency_id, driver_user_id, member_user_id, status, requested_permissions)
     VALUES ($1,$2,$3,'approved',
             '{"settlements_manage":true,"settlements_finalize":true}'::jsonb),
            ($1,$4,$5,'approved','{"settlements_manage":true}'::jsonb)`,
    [agencyId, U.dAgency, U.agencyFinalizer, U.dAgencyManageOnly, U.agencyManager],
  );
});

// ---------------------------------------------------------------------------
describe('1T-B2C5A — chain, catalog and source shape', () => {
  it('1. every required prior accepted file exists and the real chain applied', () => {
    for (const rel of Object.values(REL)) {
      expect(fs.existsSync(abs(rel)), rel).toBe(true);
    }
    expect(after.functions).toContain('settlement_confirm_load_match');
    expect(after.functions).toContain('settlement_reject_load_match');
    expect(after.functions).toContain(
      'settlement_refresh_load_match_suggestions',
    );
    expect(after.functions).toContain(FN);
  });

  it('2. adds exactly one function and zero other database objects', () => {
    const added = after.functions.filter((f) => !before.functions.includes(f));
    expect(added).toEqual([FN]);
    for (const k of [
      'tables',
      'indexes',
      'triggers',
      'views',
      'types',
      'policies',
    ]) {
      expect(after[k], k).toEqual(before[k]);
    }
  });

  it('3. exact signature returns driver_settlements', async () => {
    const r = await db.query<{ args: string; ret: string }>(
      `SELECT pg_get_function_identity_arguments(p.oid) AS args,
              pg_get_function_result(p.oid) AS ret
         FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
        WHERE ns.nspname='public' AND p.proname=$1`,
      [FN],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].args).toBe('_settlement_id uuid');
    expect(r.rows[0].ret).toBe('driver_settlements');
  });

  it('4. SECURITY DEFINER, plpgsql, fixed search_path', async () => {
    const r = await db.query<{
      sec: boolean;
      lang: string;
      cfg: string[] | null;
    }>(
      `SELECT p.prosecdef AS sec, l.lanname AS lang, p.proconfig AS cfg
         FROM pg_proc p
         JOIN pg_namespace ns ON ns.oid=p.pronamespace
         JOIN pg_language l ON l.oid=p.prolang
        WHERE ns.nspname='public' AND p.proname=$1`,
      [FN],
    );
    expect(r.rows[0].sec).toBe(true);
    expect(r.rows[0].lang).toBe('plpgsql');
    expect(r.rows[0].cfg).toEqual(['search_path=pg_catalog, public, auth']);
  });

  it('5. ACL: authenticated/service_role EXECUTE; PUBLIC and anon cannot', async () => {
    const r = await db.query<{ a: boolean; s: boolean; an: boolean }>(
      `SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS a,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS s,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS an
         FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
        WHERE ns.nspname='public' AND p.proname=$1`,
      [FN],
    );
    expect(r.rows[0].a).toBe(true);
    expect(r.rows[0].s).toBe(true);
    expect(r.rows[0].an).toBe(false);

    const pub = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c
         FROM pg_proc p
         JOIN pg_namespace ns ON ns.oid=p.pronamespace,
              LATERAL aclexplode(p.proacl) AS acl
        WHERE ns.nspname='public' AND p.proname=$1 AND acl.grantee = 0`,
      [FN],
    );
    expect(Number(pub.rows[0].c)).toBe(0);
  });

  it('6. auth.uid() is the sole actor identity — no bypass surface in source', () => {
    expect(CODE).toContain('auth.uid()');
    expect(CODE).not.toMatch(/_actor_user_id|_caller|_as_user|_impersonate/i);
    expect(CODE).not.toMatch(/current_setting\s*\(/i);
    expect(CODE).not.toMatch(/\bcurrent_user\b|\bsession_user\b/i);
    expect(CODE).not.toMatch(/email/i);
    expect(CODE).not.toMatch(/is_admin|has_role|super_admin|admin_users/i);
    expect(CODE).toContain('settlement_current_user_can_manage_carrier');
    expect(CODE).toContain('settlement_current_user_can_manage_agency');
    expect(CODE).toContain('settlement_current_user_can_assist_driver');
    // the read helper must never substitute for finalization authorization
    expect(CODE).not.toContain('settlement_current_user_can_view_settlement');
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5A — carrier_issued finalization', () => {
  it('7. standalone paid carrier with the exact active relationship finalizes', async () => {
    S.carrier = await mkCarrierSettlement(
      U.dCarrier,
      'draft',
      recruiterId,
      relActive,
      U.paidCarrier,
    );
    const out = await finalize(U.paidCarrier, S.carrier);
    expect(out.status).toBe('finalized');
    expect(out.finalized_by_user_id).toBe(U.paidCarrier);
    expect(out.finalized_at).toBeTruthy();

    const events = await eventsFor(S.carrier);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('finalized');
    expect(events[0].actor_user_id).toBe(U.paidCarrier);
    expect(events[0].metadata).toMatchObject({
      source: 'carrier_issued',
      change: 'settlement_finalized',
    });
  });

  it('8. ended relationship or lapsed standalone billing cannot finalize', async () => {
    const ended = await mkCarrierSettlement(
      U.dCarrierEnded,
      'draft',
      recruiterId,
      relEnded,
      U.paidCarrier,
    );
    const lapsed = await mkCarrierSettlement(
      U.dCarrierUnpaid,
      'draft',
      recruiterUnpaidId,
      relUnpaid,
      U.unpaidCarrier,
    );

    expect(await failureMessage(() => finalize(U.paidCarrier, ended))).toContain(
      ERR.carrier,
    );
    expect(
      await failureMessage(() => finalize(U.unpaidCarrier, lapsed)),
    ).toContain(ERR.carrier);

    for (const sid of [ended, lapsed]) {
      const row = await settlementRow(sid);
      expect(row.status).toBe('draft');
      expect(row.finalized_at).toBeNull();
      expect(await eventsFor(sid)).toHaveLength(0);
    }
  });

  it('9. strangers and the recipient driver cannot finalize a carrier draft', async () => {
    const sid = await mkCarrierSettlement(
      U.dCarrier,
      'draft',
      recruiterId,
      relActive,
      U.paidCarrier,
    );
    for (const actor of [U.stranger, U.dCarrier, U.agencyOwner]) {
      expect(await failureMessage(() => finalize(actor, sid))).toContain(
        ERR.carrier,
      );
    }
    expect((await settlementRow(sid)).status).toBe('draft');
    expect(await eventsFor(sid)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5A — agency_prepared finalization', () => {
  it('10. delegated member with settlements_finalize finalizes for a FREE driver', async () => {
    S.agency = await mkAgencySettlement(
      U.dAgency,
      'draft',
      agencyId,
      U.agencyFinalizer,
    );
    const out = await finalize(U.agencyFinalizer, S.agency);
    expect(out.status).toBe('finalized');
    expect(out.finalized_by_user_id).toBe(U.agencyFinalizer);

    const sub = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.subscriptions WHERE user_id=$1`,
      [U.dAgency],
    );
    expect(Number(sub.rows[0].c)).toBe(0);

    const events = await eventsFor(S.agency);
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({
      source: 'agency_prepared',
      change: 'settlement_finalized',
    });
  });

  it('11. settlements_manage WITHOUT settlements_finalize fails and writes nothing', async () => {
    const sid = await mkAgencySettlement(
      U.dAgencyManageOnly,
      'draft',
      agencyId,
      U.agencyManager,
    );
    expect(
      await failureMessage(() => finalize(U.agencyManager, sid)),
    ).toContain(ERR.agency);
    const row = await settlementRow(sid);
    expect(row.status).toBe('draft');
    expect(row.finalized_by_user_id).toBeNull();
    expect(await eventsFor(sid)).toHaveLength(0);
  });

  it('12. the finalize permission is delegation-scoped to the exact driver', async () => {
    const sid = await mkAgencySettlement(
      U.dAgencyManageOnly,
      'draft',
      agencyId,
      U.agencyFinalizer,
    );
    // U.agencyFinalizer holds finalize for U.dAgency only, not this driver.
    expect(
      await failureMessage(() => finalize(U.agencyFinalizer, sid)),
    ).toContain(ERR.agency);
    expect((await settlementRow(sid)).status).toBe('draft');
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5A — driver_imported finalization', () => {
  it('13. DIRECT assistant with settlements_finalize over an active-Pro driver finalizes', async () => {
    S.import = await mkDriverSettlement(U.dImport, 'draft');
    const out = await finalize(U.assistantFinalize, S.import);
    expect(out.status).toBe('finalized');
    expect(out.finalized_by_user_id).toBe(U.assistantFinalize);

    const events = await eventsFor(S.import);
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({
      source: 'driver_imported',
      change: 'settlement_finalized',
    });
  });

  it('14. the recipient driver themselves cannot finalize, even on active Pro', async () => {
    const sid = await mkDriverSettlement(U.dImport, 'draft');
    expect(await failureMessage(() => finalize(U.dImport, sid))).toContain(
      ERR.driverImport,
    );
    const row = await settlementRow(sid);
    expect(row.status).toBe('draft');
    expect(row.finalized_by_user_id).toBeNull();
    expect(await eventsFor(sid)).toHaveLength(0);
  });

  it('15. manage-only, view-only, agency-generated, inactive and stranger assistants fail', async () => {
    for (const actor of [
      U.assistantManage,
      U.assistantView,
      U.assistantAgency,
      U.assistantInactive,
      U.stranger,
    ]) {
      const sid = await mkDriverSettlement(U.dImport, 'draft');
      expect(await failureMessage(() => finalize(actor, sid))).toContain(
        ERR.driverImport,
      );
      expect((await settlementRow(sid)).status).toBe('draft');
      expect(await eventsFor(sid)).toHaveLength(0);
    }
  });

  it('16. an assistant over a downgraded / non-Pro target driver fails', async () => {
    const sid = await mkDriverSettlement(U.dImportFree, 'draft');
    expect(
      await failureMessage(() => finalize(U.assistantFree, sid)),
    ).toContain(ERR.driverImport);
    expect((await settlementRow(sid)).status).toBe('draft');
    expect(await eventsFor(sid)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5A — lifecycle, inputs and fixed errors', () => {
  it('17. non-draft statuses all fail with settlement_not_finalizable', async () => {
    for (const status of ['finalized', 'voided', 'superseded'] as const) {
      const sid = await mkDriverSettlement(U.dImportStates, status);
      expect(
        await failureMessage(() => finalize(U.assistantFinalize, sid)),
        status,
      ).toContain(ERR.notFinalizable);
      expect((await settlementRow(sid)).status).toBe(status);
      expect(await eventsFor(sid)).toHaveLength(0);
    }
  });

  it('18. finalization is NOT idempotent — a second attempt fails and adds no event', async () => {
    const sid = await mkDriverSettlement(U.dImportStates, 'draft');
    const first = await finalize(U.assistantFinalize, sid);
    expect(first.status).toBe('finalized');
    expect(await eventsFor(sid)).toHaveLength(1);

    expect(
      await failureMessage(() => finalize(U.assistantFinalize, sid)),
    ).toContain(ERR.notFinalizable);
    const events = await eventsFor(sid);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('finalized');
  });

  it('19. null actor / null id / missing settlement use only the fixed errors', async () => {
    const eventsBefore = await eventCount();
    expect(
      await failureMessage(() => finalize(U.assistantFinalize, null)),
    ).toContain(ERR.invalid);
    expect(
      await failureMessage(() =>
        finalize(null, '00000000-0000-0000-0000-000000000001'),
      ),
    ).toContain(ERR.invalid);
    expect(
      await failureMessage(() =>
        finalize(U.assistantFinalize, '00000000-0000-0000-0000-0000000000ff'),
      ),
    ).toContain(ERR.notFound);
    expect(await eventCount()).toBe(eventsBefore);
  });

  it('20. a malformed stored source fails closed before any write', async () => {
    // The B1 CHECK constraint prevents seeding an unknown source, so the
    // fail-closed vocabulary is proven from the enforced source contract.
    const bad = await failureMessage(() =>
      db.query(
        `INSERT INTO public.driver_settlements
           (driver_user_id, source, status, period_start, period_end, created_by_user_id)
         VALUES ($1,'payroll_run','draft',$2::date,$3::date,$1)`,
        [U.dImportMisc, P1, P2],
      ),
    );
    expect(bad).not.toBe('<<no error raised>>');
    expect(CODE).toContain(ERR.invalidSource);
    expect(CODE).toMatch(
      /NOT IN \('carrier_issued', 'agency_prepared', 'driver_imported'\)/,
    );
  });

  it('21. observed failures never leak SQLSTATE, constraints or raw Postgres text', async () => {
    const sid = await mkDriverSettlement(U.dImportMisc, 'draft');
    for (const msg of [
      await failureMessage(() => finalize(U.stranger, sid)),
      await failureMessage(() => finalize(U.dImportMisc, sid)),
      await failureMessage(() => finalize(U.assistantFinalize, null)),
    ]) {
      expect(msg).not.toMatch(LEAK);
    }
    const raises = CODE.match(/RAISE EXCEPTION '([a-z_]+)'/g) ?? [];
    expect(raises.length).toBeGreaterThanOrEqual(7);
    for (const r of raises) {
      expect(r).toMatch(/^RAISE EXCEPTION '[a-z_]+'$/);
    }
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5A — immutability and write boundary', () => {
  it('22. every settlement field except the four allowed columns is preserved', async () => {
    const sid = await mkDriverSettlement(U.dImportMisc, 'draft');
    await db.query(
      `UPDATE public.driver_settlements
          SET pay_date = '2026-07-10'::date,
              statement_reference = 'STMT-1099',
              payer_name_snapshot = 'Blue Line Freight',
              source_display_name_snapshot = 'Self import',
              reported_gross_amount = 4200.00,
              reported_net_amount = 3675.25,
              notes = 'week 27'
        WHERE id = $1`,
      [sid],
    );
    const rowBefore = await settlementRow(sid);

    await finalize(U.assistantFinalize, sid);
    const rowAfter = await settlementRow(sid);

    const allowed = new Set([
      'status',
      'finalized_by_user_id',
      'finalized_at',
      'updated_at',
    ]);
    for (const key of Object.keys(rowBefore)) {
      if (allowed.has(key)) continue;
      expect(rowAfter[key], key).toEqual(rowBefore[key]);
    }
    expect(rowAfter.status).toBe('finalized');
    expect(rowAfter.finalized_by_user_id).toBe(U.assistantFinalize);
    expect(rowAfter.finalized_at).not.toBeNull();
    expect(rowAfter.voided_at).toBeNull();
    expect(rowAfter.voided_by_user_id).toBeNull();
    expect(rowAfter.version_number).toBe(rowBefore.version_number);
    expect(rowAfter.calculation_version).toBe(rowBefore.calculation_version);
    expect(rowAfter.created_at).toBe(rowBefore.created_at);
  });

  it('23. items, matches and loads are byte-identical across a finalization', async () => {
    const sid = await mkDriverSettlement(U.dImportMisc, 'draft');
    const item = await mkItem(sid, U.dImportMisc, '1000.00');
    const deduction = await mkItem(sid, U.dImportMisc, '125.50', 'deduction');
    const l1 = await mkLoad(U.dImportMisc);
    const l2 = await mkLoad(U.dImportMisc);
    const l3 = await mkLoad(U.dImportMisc);
    await mkMatch(item, l1, 'confirmed', '0.9500');
    await mkMatch(item, l2, 'possible', '0.4200');
    await mkMatch(item, l3, 'rejected', '0.7100');
    expect(deduction).toBeTruthy();

    const itemsBefore = await itemsSnapshot();
    const matchesBefore = await matchesSnapshot();
    const loadsBefore = await loadsSnapshot();

    const out = await finalize(U.assistantFinalize, sid);
    expect(out.status).toBe('finalized');

    expect(await itemsSnapshot()).toBe(itemsBefore);
    expect(await matchesSnapshot()).toBe(matchesBefore);
    expect(await loadsSnapshot()).toBe(loadsBefore);
  });

  it('24. exactly one settlement row and one event row are written', async () => {
    const sid = await mkDriverSettlement(U.dImportMisc, 'draft');
    const other = await mkDriverSettlement(U.dImportMisc, 'draft');
    const otherBefore = await settlementRow(other);
    const eventsBefore = await eventCount();

    await finalize(U.assistantFinalize, sid);

    expect(await eventCount()).toBe(eventsBefore + 1);
    expect(await settlementRow(other)).toEqual(otherBefore);
  });

  it('25. direct authenticated DML is still blocked by the accepted B2B RLS', async () => {
    const sid = await mkDriverSettlement(U.dImport, 'draft');
    await asRole('authenticated', U.dImport, async () => {
      const upd = await db.query(
        `UPDATE public.driver_settlements SET status='finalized' WHERE id=$1`,
        [sid],
      );
      expect(upd.affectedRows ?? 0).toBe(0);
      const del = await db.query(
        `DELETE FROM public.driver_settlements WHERE id=$1`,
        [sid],
      );
      expect(del.affectedRows ?? 0).toBe(0);
      const ins = await failureMessage(() =>
        db.query(
          `INSERT INTO public.driver_settlement_events
             (settlement_id, actor_user_id, event_type)
           VALUES ($1,$2,'finalized')`,
          [sid, U.dImport],
        ),
      );
      expect(ins).not.toBe('<<no error raised>>');
    });
    expect((await settlementRow(sid)).status).toBe('draft');
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5A — candidate source contract', () => {
  it('26. candidate stays candidate-marked while its accepted promotion exists', () => {
    expect(B2C5A_SQL.split('\n')[0]).toBe(
      '-- CANDIDATE MIGRATION — NOT APPLIED LIVE.',
    );
    expect(B2C5A_SQL).toContain('Phase 1T-B2C5A');
    expect(
      fs.existsSync(
        abs(
          '../../supabase/migrations/20260808183500_phase1t_b2c5a_settlement_finalization.sql',
        ),
      ),
    ).toBe(true);
  });

  it('27. exactly one explicit BEGIN/COMMIT transaction', () => {
    expect(CODE.match(/^\s*BEGIN;\s*$/gm) ?? []).toHaveLength(1);
    expect(CODE.match(/^\s*COMMIT;\s*$/gm) ?? []).toHaveLength(1);
    expect(CODE).not.toMatch(/ROLLBACK|SAVEPOINT/i);
  });

  it('28. no unsafe DDL idioms, dynamic SQL, or error leakage', () => {
    expect(CODE).not.toMatch(/CREATE OR REPLACE/i);
    expect(CODE).not.toMatch(/IF NOT EXISTS/i);
    expect(CODE).not.toMatch(/\bDROP\b/i);
    expect(CODE).not.toMatch(/\bEXECUTE\s+(?!ON FUNCTION)/i);
    expect(CODE).not.toMatch(/format\s*\(/i);
    expect(CODE).not.toMatch(/SQLERRM|SQLSTATE|EXCEPTION\s+WHEN/i);
  });

  it('29. creates exactly one function and changes no DDL, policy, trigger or table grant', () => {
    expect(CODE.match(/^CREATE FUNCTION/gm) ?? []).toHaveLength(1);
    expect(CODE).not.toMatch(/CREATE\s+(TABLE|INDEX|VIEW|TYPE|TRIGGER|POLICY)/i);
    expect(CODE).not.toMatch(/ALTER\s+TABLE/i);
    expect(CODE).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)/i);
    const grants = CODE.match(/^GRANT[\s\S]*?;/gm) ?? [];
    expect(grants).toHaveLength(1);
    expect(grants[0]).toContain('EXECUTE ON FUNCTION');
    expect(grants[0]).toContain('TO authenticated, service_role');
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon;/);
  });

  it('30. the settlement row is locked FOR UPDATE before authorization and mutation', () => {
    const lockAt = CODE.indexOf('FOR UPDATE');
    const authAt = CODE.indexOf('settlement_current_user_can_manage_carrier');
    const updateAt = CODE.search(/UPDATE public\.driver_settlements ds/);
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(authAt);
    expect(authAt).toBeLessThan(updateAt);
    expect(CODE.match(/FOR UPDATE/g) ?? []).toHaveLength(1);
  });

  it('31. the UPDATE sets exactly the four allowed settlement columns', () => {
    const upd = CODE.slice(
      CODE.search(/UPDATE public\.driver_settlements ds/),
      CODE.indexOf('RETURNING * INTO v_result'),
    );
    const assigned = (upd.match(/^\s*(?:SET )?([a-z_]+) =/gm) ?? []).map((m) =>
      m.replace(/^\s*(?:SET )?/, '').replace(/ =$/, ''),
    );
    expect(assigned).toEqual([
      'status',
      'finalized_by_user_id',
      'finalized_at',
      'updated_at',
    ]);
  });

  it('32. only the settlement row and one event row may be written', () => {
    expect(CODE.match(/^\s*UPDATE\s+public\./gm) ?? []).toHaveLength(1);
    const inserts = CODE.match(/INSERT INTO public\.[a-z_]+/g) ?? [];
    expect(inserts).toEqual(['INSERT INTO public.driver_settlement_events']);
    expect(CODE).not.toMatch(/DELETE\s+FROM/i);
    for (const table of [
      'public.loads',
      'public.driver_settlement_items',
      'public.driver_settlement_matches',
      'public.carrier_driver_relationships',
      'public.subscriptions',
      'public.recruiter_billing_profiles',
      'public.agency_entitlements',
      'public.driver_assistants',
      'public.agency_delegation_requests',
    ]) {
      expect(CODE, table).not.toMatch(
        new RegExp(`(UPDATE|INSERT INTO|DELETE FROM)\\s+${table.replace('.', '\\.')}`, 'i'),
      );
    }
  });

  it('33. no void, supersede, correction, export, calculation, matching or notification behavior', () => {
    for (const forbidden of [
      'voided_at',
      'voided_by_user_id',
      'supersedes_settlement_id',
      'version_number',
      'calculation_version',
      'expected_amount_snapshot',
      'match_state',
      'confidence',
      'reported_gross_amount',
      'reported_net_amount',
    ]) {
      expect(CODE, forbidden).not.toContain(forbidden);
    }
    expect(CODE).not.toMatch(/notif|http|net\.|pg_notify|stripe|export/i);
    expect(CODE).not.toMatch(/\bsum\s*\(|\bavg\s*\(/i);
  });

  it('34. no skipped, todo, or focused tests in this suite', () => {
    expect(SELF_SRC).not.toMatch(/\b(it|describe|test)\.(skip|only|todo)\b/);
    expect(SELF_SRC).not.toMatch(/\b(xit|xdescribe|fit|fdescribe)\s*\(/);
  });
});
