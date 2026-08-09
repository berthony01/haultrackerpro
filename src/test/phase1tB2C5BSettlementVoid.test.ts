// @vitest-environment node
// =====================================================================
// Phase 1T-B2C5B — Finalized settlement VOID lifecycle proofs.
//
// Applies, in order, the REAL accepted Phase 1T-B1, B2A, B2B, B2C1, B2C2A,
// B2C3A, B2C4A, B2C4B, B2C4C and B2C5A candidates and then the REAL new Phase
// 1T-B2C5B candidate inside PGlite on the same faithful bootstrap used by the
// accepted B2C5A suite, and proves catalog shape, ACLs, per-source CURRENT
// authorization re-evaluation at void time, the exact finalized -> voided
// lifecycle rule (never idempotent), the four-column write boundary, the
// preservation of finalization provenance, single-event auditing, and full
// immutability of loads / items / matches / unrelated settlements.
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
  b2c5b:
    '../../supabase/migration-candidates/20260808185000_phase1t_b2c5b_settlement_void.sql',
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
const B2C5B_SQL = read(REL.b2c5b);
const SELF_SRC = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');

/** Executable SQL only: `--` documentation lines removed. */
const CODE = B2C5B_SQL.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const FN = 'settlement_void_finalized';

const ERR = {
  invalid: 'settlement_invalid_request',
  notFound: 'settlement_not_found',
  notVoidable: 'settlement_not_voidable',
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

interface LifecycleResult {
  id: string;
  status: string;
  finalized_by_user_id: string | null;
  finalized_at: string | null;
  voided_by_user_id: string | null;
  voided_at: string | null;
}

const LIFECYCLE_COLS = `(r).id, (r).status, (r).finalized_by_user_id,
        (r).finalized_at::text AS finalized_at, (r).voided_by_user_id,
        (r).voided_at::text AS voided_at`;

async function finalize(
  actor: string | null,
  settlementId: string | null,
): Promise<LifecycleResult> {
  return asRole('authenticated', actor, async () => {
    const r = await db.query<LifecycleResult>(
      `SELECT ${LIFECYCLE_COLS}
         FROM public.settlement_finalize_draft($1::uuid) AS r`,
      [settlementId],
    );
    return r.rows[0];
  });
}

async function voidSettlement(
  actor: string | null,
  settlementId: string | null,
): Promise<LifecycleResult> {
  return asRole('authenticated', actor, async () => {
    const r = await db.query<LifecycleResult>(
      `SELECT ${LIFECYCLE_COLS}
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
  recruiter: string,
  relationship: string,
  creator: string,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlements
       (driver_user_id, source, status, carrier_recruiter_profile_id,
        carrier_driver_relationship_id, source_display_name_snapshot,
        period_start, period_end, created_by_user_id)
     VALUES ($1,'carrier_issued','draft',$2,$3,'Blue Line Freight',$4::date,$5::date,$6)
     RETURNING id`,
    [driver, recruiter, relationship, P1, P2, creator],
  );
  return r.rows[0].id;
}

async function mkAgencySettlement(
  driver: string,
  agency: string,
  creator: string,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlements
       (driver_user_id, source, status, agency_id, source_display_name_snapshot,
        period_start, period_end, created_by_user_id)
     VALUES ($1,'agency_prepared','draft',$2,'Acme Back Office',$3::date,$4::date,$5)
     RETURNING id`,
    [driver, agency, P1, P2, creator],
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
let recruiterLapseId = '';
let relActive = '';
let relRevoke = '';
let relLapse = '';
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
  await db.exec(B2C5A_SQL);

  before = await snapshotCatalog();
  await db.exec(B2C5B_SQL);
  after = await snapshotCatalog();

  for (const k of [
    'dCarrier',
    'dCarrierRevoke',
    'dCarrierLapse',
    'dAgency',
    'dAgencyRevoke',
    'dAgencyManageOnly',
    'dImport',
    'dImportStates',
    'dImportMisc',
    'dImportRevoke',
    'dImportProLoss',
    'dImportFree',
    'assistantFinalize',
    'assistantManage',
    'assistantView',
    'assistantAgency',
    'assistantInactive',
    'assistantFree',
    'assistantRevoke',
    'paidCarrier',
    'lapseCarrier',
    'agencyOwner',
    'agencyFinalizer',
    'agencyManager',
    'agencyRevoked',
    'stranger',
  ]) {
    U[k] = await newUser();
  }

  const sub = (uid: string, status: string, plan = 'pro_monthly') =>
    db.query(
      `INSERT INTO public.subscriptions (user_id, plan_key, status) VALUES ($1,$2,$3)`,
      [uid, plan, status],
    );
  for (const k of [
    'dImport',
    'dImportStates',
    'dImportMisc',
    'dImportRevoke',
    'dImportProLoss',
  ]) {
    await sub(U[k], 'active');
  }
  await sub(U.dImportFree, 'canceled');
  // Agency-side drivers are deliberately Free (no subscription row at all).

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
       ($10,$2,'active','{"settlements_view":true,"settlements_manage":true,"settlements_finalize":true}'::jsonb, NULL),
       ($11,$12,'active','{"settlements_finalize":true}'::jsonb, NULL),
       ($13,$12,'active','{"settlements_finalize":true}'::jsonb, NULL)`,
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
      U.dImportRevoke,
      U.assistantRevoke,
      U.dImportProLoss,
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

  recruiterLapseId = (
    await db.query<{ id: string }>(
      `INSERT INTO public.recruiter_profiles (user_id, company_name)
       VALUES ($1,'Soon Lapsed Carrier') RETURNING id`,
      [U.lapseCarrier],
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO public.recruiter_billing_profiles (recruiter_id, user_id, plan, status)
     VALUES ($1,$2,'growth','active')`,
    [recruiterLapseId, U.lapseCarrier],
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
  relRevoke = await mkRel(recruiterId, U.dCarrierRevoke, 'active');
  relLapse = await mkRel(recruiterLapseId, U.dCarrierLapse, 'active');

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
            ($1,$4,'agency_member','active'),
            ($1,$5,'agency_member','active')`,
    [agencyId, U.agencyOwner, U.agencyFinalizer, U.agencyManager, U.agencyRevoked],
  );
  await db.query(
    `INSERT INTO public.agency_delegation_requests
       (agency_id, driver_user_id, member_user_id, status, requested_permissions)
     VALUES ($1,$2,$3,'approved',
             '{"settlements_manage":true,"settlements_finalize":true}'::jsonb),
            ($1,$4,$5,'approved','{"settlements_manage":true}'::jsonb),
            ($1,$6,$7,'approved',
             '{"settlements_manage":true,"settlements_finalize":true}'::jsonb)`,
    [
      agencyId,
      U.dAgency,
      U.agencyFinalizer,
      U.dAgencyManageOnly,
      U.agencyManager,
      U.dAgencyRevoke,
      U.agencyRevoked,
    ],
  );
});

// ---------------------------------------------------------------------------
describe('1T-B2C5B — chain, catalog and function shape', () => {
  it('1. every required accepted file exists and the real chain applied', () => {
    for (const rel of Object.values(REL)) {
      expect(fs.existsSync(abs(rel)), rel).toBe(true);
    }
    expect(after.functions).toContain('settlement_finalize_draft');
    expect(after.functions).toContain('settlement_confirm_load_match');
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
    expect(CODE).not.toContain('settlement_current_user_can_view_settlement');
    // creator identity must never be an authorization input
    expect(CODE).not.toMatch(/created_by_user_id|finalized_by_user_id\s*=\s*v_actor/);
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5B — authorized void per source', () => {
  it('7. currently paid carrier with the exact active relationship voids', async () => {
    const sid = await mkCarrierSettlement(
      U.dCarrier,
      recruiterId,
      relActive,
      U.paidCarrier,
    );
    const fin = await finalize(U.paidCarrier, sid);
    expect(fin.status).toBe('finalized');

    const out = await voidSettlement(U.paidCarrier, sid);
    expect(out.status).toBe('voided');
    expect(out.voided_by_user_id).toBe(U.paidCarrier);
    expect(out.voided_at).toBeTruthy();
    expect(out.finalized_by_user_id).toBe(fin.finalized_by_user_id);
    expect(out.finalized_at).toBe(fin.finalized_at);

    const events = await eventsFor(sid);
    expect(events.map((e) => e.event_type)).toEqual(['finalized', 'voided']);
    const voided = events[1];
    expect(voided.actor_user_id).toBe(U.paidCarrier);
    expect(voided.metadata).toMatchObject({
      source: 'carrier_issued',
      change: 'settlement_voided',
    });
  });

  it('8. delegated agency finalizer voids for a FREE recipient driver', async () => {
    const sid = await mkAgencySettlement(U.dAgency, agencyId, U.agencyFinalizer);
    await finalize(U.agencyFinalizer, sid);

    const out = await voidSettlement(U.agencyFinalizer, sid);
    expect(out.status).toBe('voided');
    expect(out.voided_by_user_id).toBe(U.agencyFinalizer);

    const sub = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.subscriptions WHERE user_id=$1`,
      [U.dAgency],
    );
    expect(Number(sub.rows[0].c)).toBe(0);

    const events = await eventsFor(sid);
    expect(events.map((e) => e.event_type)).toEqual(['finalized', 'voided']);
    expect(events[1].metadata).toMatchObject({
      source: 'agency_prepared',
      change: 'settlement_voided',
    });
  });

  it('9. DIRECT assistant with settlements_finalize over an active-Pro driver voids', async () => {
    const sid = await mkDriverSettlement(U.dImport, 'draft');
    await finalize(U.assistantFinalize, sid);

    const out = await voidSettlement(U.assistantFinalize, sid);
    expect(out.status).toBe('voided');
    expect(out.voided_by_user_id).toBe(U.assistantFinalize);

    const events = await eventsFor(sid);
    expect(events.map((e) => e.event_type)).toEqual(['finalized', 'voided']);
    expect(events[1].metadata).toMatchObject({
      source: 'driver_imported',
      change: 'settlement_voided',
    });
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5B — CURRENT authorization is re-evaluated at void time', () => {
  it('10. a carrier relationship ended AFTER finalization cannot void', async () => {
    const sid = await mkCarrierSettlement(
      U.dCarrierRevoke,
      recruiterId,
      relRevoke,
      U.paidCarrier,
    );
    await finalize(U.paidCarrier, sid);
    const beforeRow = await settlementRow(sid);
    const eventsBefore = await eventCount();

    await db.query(
      `UPDATE public.carrier_driver_relationships SET status='ended' WHERE id=$1`,
      [relRevoke],
    );

    expect(
      await failureMessage(() => voidSettlement(U.paidCarrier, sid)),
    ).toContain(ERR.carrier);
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await eventCount()).toBe(eventsBefore);
  });

  it('11. carrier billing lapsed AFTER finalization cannot void', async () => {
    const sid = await mkCarrierSettlement(
      U.dCarrierLapse,
      recruiterLapseId,
      relLapse,
      U.lapseCarrier,
    );
    await finalize(U.lapseCarrier, sid);
    const beforeRow = await settlementRow(sid);

    await db.query(
      `UPDATE public.recruiter_billing_profiles SET status='canceled' WHERE recruiter_id=$1`,
      [recruiterLapseId],
    );

    expect(
      await failureMessage(() => voidSettlement(U.lapseCarrier, sid)),
    ).toContain(ERR.carrier);
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await eventsFor(sid)).toHaveLength(1);
  });

  it('12. an agency delegation revoked AFTER finalization cannot void', async () => {
    const sid = await mkAgencySettlement(
      U.dAgencyRevoke,
      agencyId,
      U.agencyRevoked,
    );
    await finalize(U.agencyRevoked, sid);
    const beforeRow = await settlementRow(sid);

    await db.query(
      `UPDATE public.agency_delegation_requests SET status='revoked'
        WHERE agency_id=$1 AND member_user_id=$2`,
      [agencyId, U.agencyRevoked],
    );

    expect(
      await failureMessage(() => voidSettlement(U.agencyRevoked, sid)),
    ).toContain(ERR.agency);
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await eventsFor(sid)).toHaveLength(1);
  });

  it('13. an assistant revoked AFTER finalization cannot void', async () => {
    const sid = await mkDriverSettlement(U.dImportRevoke, 'draft');
    await finalize(U.assistantRevoke, sid);
    const beforeRow = await settlementRow(sid);

    await db.query(
      `UPDATE public.driver_assistants SET status='revoked'
        WHERE driver_user_id=$1 AND assistant_user_id=$2`,
      [U.dImportRevoke, U.assistantRevoke],
    );

    expect(
      await failureMessage(() => voidSettlement(U.assistantRevoke, sid)),
    ).toContain(ERR.driverImport);
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await eventsFor(sid)).toHaveLength(1);
  });

  it('14. a target driver who lost Pro AFTER finalization blocks assistant void', async () => {
    const sid = await mkDriverSettlement(U.dImportProLoss, 'draft');
    await finalize(U.assistantRevoke, sid);
    const beforeRow = await settlementRow(sid);

    await db.query(
      `UPDATE public.subscriptions SET status='canceled' WHERE user_id=$1`,
      [U.dImportProLoss],
    );

    expect(
      await failureMessage(() => voidSettlement(U.assistantRevoke, sid)),
    ).toContain(ERR.driverImport);
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await eventsFor(sid)).toHaveLength(1);
  });

  it('36. an agency entitlement that ceases to be eligible AFTER finalization cannot void', async () => {
    // Isolated agency context so the shared fixture entitlement is untouched.
    const owner = await newUser();
    const finalizer = await newUser();
    const driver = await newUser();
    const lapseAgencyId = (
      await db.query<{ id: string }>(
        `INSERT INTO public.agency_profiles (owner_user_id, name, status)
         VALUES ($1,'Lapsing Back Office','active') RETURNING id`,
        [owner],
      )
    ).rows[0].id;
    await db.query(
      `INSERT INTO public.agency_entitlements (agency_id, plan_key, status)
       VALUES ($1,'agency_team','active')`,
      [lapseAgencyId],
    );
    await db.query(
      `INSERT INTO public.agency_members (agency_id, member_user_id, role, status)
       VALUES ($1,$2,'agency_owner','active'), ($1,$3,'agency_member','active')`,
      [lapseAgencyId, owner, finalizer],
    );
    await db.query(
      `INSERT INTO public.agency_delegation_requests
         (agency_id, driver_user_id, member_user_id, status, requested_permissions)
       VALUES ($1,$2,$3,'approved',
               '{"settlements_manage":true,"settlements_finalize":true}'::jsonb)`,
      [lapseAgencyId, driver, finalizer],
    );

    const sid = await mkAgencySettlement(driver, lapseAgencyId, finalizer);
    const fin = await finalize(finalizer, sid);
    expect(fin.status).toBe('finalized');
    const beforeRow = await settlementRow(sid);
    expect((await eventsFor(sid)).map((e) => e.event_type)).toEqual([
      'finalized',
    ]);

    // Entitlement cessation expressed exactly as the accepted helper reads it:
    // status must be one of active / trialing / manual_beta.
    await db.query(
      `UPDATE public.agency_entitlements SET status='canceled' WHERE agency_id=$1`,
      [lapseAgencyId],
    );

    expect(
      await failureMessage(() => voidSettlement(finalizer, sid)),
    ).toContain(ERR.agency);
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect((await eventsFor(sid)).map((e) => e.event_type)).toEqual([
      'finalized',
    ]);
  });

  it('37. an assistant who loses settlements_finalize AFTER finalization cannot void', async () => {
    const driver = await newUser();
    const assistant = await newUser();
    await db.query(
      `INSERT INTO public.subscriptions (user_id, plan_key, status)
       VALUES ($1,'pro_monthly','active')`,
      [driver],
    );
    await db.query(
      `INSERT INTO public.driver_assistants
         (driver_user_id, assistant_user_id, status, permissions, agency_delegation_id)
       VALUES ($1,$2,'active',
               '{"settlements_view":true,"settlements_manage":true,"settlements_finalize":true}'::jsonb,
               NULL)`,
      [driver, assistant],
    );

    const sid = await mkDriverSettlement(driver, 'draft');
    const fin = await finalize(assistant, sid);
    expect(fin.status).toBe('finalized');
    const beforeRow = await settlementRow(sid);
    expect((await eventsFor(sid)).map((e) => e.event_type)).toEqual([
      'finalized',
    ]);

    // Remove ONLY settlements_finalize; relationship stays active and the
    // target driver stays active-Pro.
    await db.query(
      `UPDATE public.driver_assistants
          SET permissions = permissions - 'settlements_finalize'
        WHERE driver_user_id=$1 AND assistant_user_id=$2`,
      [driver, assistant],
    );
    const still = await db.query<{ s: string; pro: number }>(
      `SELECT da.status AS s,
              (SELECT count(*)::int FROM public.subscriptions s
                WHERE s.user_id=$1 AND s.plan_key='pro_monthly' AND s.status='active') AS pro
         FROM public.driver_assistants da
        WHERE da.driver_user_id=$1 AND da.assistant_user_id=$2`,
      [driver, assistant],
    );
    expect(still.rows[0].s).toBe('active');
    expect(Number(still.rows[0].pro)).toBe(1);

    expect(
      await failureMessage(() => voidSettlement(assistant, sid)),
    ).toContain(ERR.driverImport);
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect((await eventsFor(sid)).map((e) => e.event_type)).toEqual([
      'finalized',
    ]);
  });
});


// ---------------------------------------------------------------------------
describe('1T-B2C5B — unauthorized actors fail closed', () => {
  it('15. recipient driver, stranger and agency owner cannot void a carrier record', async () => {
    const sid = await mkCarrierSettlement(
      U.dCarrier,
      recruiterId,
      relActive,
      U.paidCarrier,
    );
    await finalize(U.paidCarrier, sid);
    const beforeRow = await settlementRow(sid);

    for (const actor of [U.dCarrier, U.stranger, U.agencyOwner]) {
      expect(await failureMessage(() => voidSettlement(actor, sid))).toContain(
        ERR.carrier,
      );
    }
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await eventsFor(sid)).toHaveLength(1);
  });

  it('16. manage-only delegation cannot void an agency record finalized through the real B2C5A RPC', async () => {
    const sid = await mkAgencySettlement(
      U.dAgencyManageOnly,
      agencyId,
      U.agencyFinalizer,
    );
    // Fidelity repair: the finalized state is produced by the ACCEPTED B2C5A
    // RPC, never by a direct table UPDATE. An independent finalize-capable
    // delegation is granted to U.agencyFinalizer for this same driver so the
    // real lifecycle path can run; the manage-only actor keeps only
    // settlements_manage and must still be refused at void time.
    await db.query(
      `INSERT INTO public.agency_delegation_requests
         (agency_id, driver_user_id, member_user_id, status, requested_permissions)
       VALUES ($1,$2,$3,'approved',
               '{"settlements_manage":true,"settlements_finalize":true}'::jsonb)`,
      [agencyId, U.dAgencyManageOnly, U.agencyFinalizer],
    );
    const fin = await finalize(U.agencyFinalizer, sid);
    expect(fin.status).toBe('finalized');
    expect(fin.finalized_by_user_id).toBe(U.agencyFinalizer);

    const beforeRow = await settlementRow(sid);
    const events = await eventsFor(sid);
    expect(events.map((e) => e.event_type)).toEqual(['finalized']);

    expect(
      await failureMessage(() => voidSettlement(U.agencyManager, sid)),
    ).toContain(ERR.agency);
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect((await eventsFor(sid)).map((e) => e.event_type)).toEqual([
      'finalized',
    ]);
  });


  it('17. manage-only, view-only, agency-generated, inactive assistants and the recipient driver cannot void an import', async () => {
    const sid = await mkDriverSettlement(U.dImport, 'draft');
    await finalize(U.assistantFinalize, sid);
    const beforeRow = await settlementRow(sid);

    for (const actor of [
      U.assistantManage,
      U.assistantView,
      U.assistantAgency,
      U.assistantInactive,
      U.dImport,
      U.stranger,
    ]) {
      expect(
        await failureMessage(() => voidSettlement(actor, sid)),
      ).toContain(ERR.driverImport);
    }
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await eventsFor(sid)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5B — lifecycle, inputs and fixed errors', () => {
  it('18. draft, voided and superseded all fail with settlement_not_voidable', async () => {
    for (const status of ['draft', 'voided', 'superseded'] as const) {
      const sid = await mkDriverSettlement(U.dImportStates, status);
      expect(
        await failureMessage(() => voidSettlement(U.assistantFinalize, sid)),
        status,
      ).toContain(ERR.notVoidable);
      expect((await settlementRow(sid)).status).toBe(status);
      expect(await eventsFor(sid)).toHaveLength(0);
    }
  });

  it('19. void is NOT idempotent — a second attempt fails and adds no second event', async () => {
    const sid = await mkDriverSettlement(U.dImportStates, 'draft');
    await finalize(U.assistantFinalize, sid);
    const first = await voidSettlement(U.assistantFinalize, sid);
    expect(first.status).toBe('voided');
    expect(await eventsFor(sid)).toHaveLength(2);

    expect(
      await failureMessage(() => voidSettlement(U.assistantFinalize, sid)),
    ).toContain(ERR.notVoidable);
    const events = await eventsFor(sid);
    expect(events).toHaveLength(2);
    expect(events.filter((e) => e.event_type === 'voided')).toHaveLength(1);
  });

  it('20. null actor / null id / missing settlement use only the fixed errors', async () => {
    const eventsBefore = await eventCount();
    expect(
      await failureMessage(() => voidSettlement(U.assistantFinalize, null)),
    ).toContain(ERR.invalid);
    expect(
      await failureMessage(() =>
        voidSettlement(null, '00000000-0000-0000-0000-000000000001'),
      ),
    ).toContain(ERR.invalid);
    expect(
      await failureMessage(() =>
        voidSettlement(
          U.assistantFinalize,
          '00000000-0000-0000-0000-0000000000ff',
        ),
      ),
    ).toContain(ERR.notFound);
    expect(await eventCount()).toBe(eventsBefore);
  });

  it('21. a malformed stored source fails closed before any write', async () => {
    const bad = await failureMessage(() =>
      db.query(
        `INSERT INTO public.driver_settlements
           (driver_user_id, source, status, period_start, period_end, created_by_user_id)
         VALUES ($1,'payroll_run','finalized',$2::date,$3::date,$1)`,
        [U.dImportMisc, P1, P2],
      ),
    );
    expect(bad).not.toBe('<<no error raised>>');
    expect(CODE).toContain(ERR.invalidSource);
    expect(CODE).toMatch(
      /NOT IN \('carrier_issued', 'agency_prepared', 'driver_imported'\)/,
    );
  });

  it('22. observed failures never leak SQLSTATE, constraints or raw Postgres text', async () => {
    const sid = await mkDriverSettlement(U.dImportMisc, 'draft');
    await finalize(U.assistantFinalize, sid);
    for (const msg of [
      await failureMessage(() => voidSettlement(U.stranger, sid)),
      await failureMessage(() => voidSettlement(U.dImportMisc, sid)),
      await failureMessage(() => voidSettlement(U.assistantFinalize, null)),
    ]) {
      expect(msg).not.toMatch(LEAK);
    }
    const raises = CODE.match(/RAISE EXCEPTION '([a-z_]+)'/g) ?? [];
    expect(raises.length).toBe(7);
    for (const r of raises) {
      expect(r).toMatch(/^RAISE EXCEPTION '[a-z_]+'$/);
    }
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5B — immutability and write boundary', () => {
  it('23. only status, voided_by_user_id, voided_at and updated_at change', async () => {
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
    await finalize(U.assistantFinalize, sid);
    const rowBefore = await settlementRow(sid);

    await voidSettlement(U.assistantFinalize, sid);
    const rowAfter = await settlementRow(sid);

    const allowed = new Set([
      'status',
      'voided_by_user_id',
      'voided_at',
      'updated_at',
    ]);
    for (const key of Object.keys(rowBefore)) {
      if (allowed.has(key)) continue;
      expect(rowAfter[key], key).toEqual(rowBefore[key]);
    }
    expect(rowAfter.status).toBe('voided');
    expect(rowAfter.voided_by_user_id).toBe(U.assistantFinalize);
    expect(rowAfter.voided_at).not.toBeNull();
    // finalization provenance survives as historical fact
    expect(rowAfter.finalized_by_user_id).toBe(rowBefore.finalized_by_user_id);
    expect(rowAfter.finalized_at).toBe(rowBefore.finalized_at);
    expect(rowAfter.version_number).toBe(rowBefore.version_number);
    expect(rowAfter.calculation_version).toBe(rowBefore.calculation_version);
    expect(rowAfter.supersedes_settlement_id).toBe(
      rowBefore.supersedes_settlement_id,
    );
    expect(rowAfter.created_at).toBe(rowBefore.created_at);
  });

  it('24. items, matches and loads are byte-identical across a void', async () => {
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
    await finalize(U.assistantFinalize, sid);

    const itemsBefore = await itemsSnapshot();
    const matchesBefore = await matchesSnapshot();
    const loadsBefore = await loadsSnapshot();

    const out = await voidSettlement(U.assistantFinalize, sid);
    expect(out.status).toBe('voided');

    expect(await itemsSnapshot()).toBe(itemsBefore);
    expect(await matchesSnapshot()).toBe(matchesBefore);
    expect(await loadsSnapshot()).toBe(loadsBefore);
  });

  it('25. exactly one settlement row and one event row are written', async () => {
    const sid = await mkDriverSettlement(U.dImportMisc, 'draft');
    await finalize(U.assistantFinalize, sid);
    const other = await mkDriverSettlement(U.dImportMisc, 'draft');
    const otherBefore = await settlementRow(other);
    const eventsBefore = await eventCount();

    await voidSettlement(U.assistantFinalize, sid);

    expect(await eventCount()).toBe(eventsBefore + 1);
    expect(await settlementRow(other)).toEqual(otherBefore);
  });

  it('26. direct authenticated DML is still blocked by the accepted B2B RLS', async () => {
    const sid = await mkDriverSettlement(U.dImport, 'draft');
    await finalize(U.assistantFinalize, sid);
    await asRole('authenticated', U.dImport, async () => {
      const upd = await db.query(
        `UPDATE public.driver_settlements SET status='voided' WHERE id=$1`,
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
           VALUES ($1,$2,'voided')`,
          [sid, U.dImport],
        ),
      );
      expect(ins).not.toBe('<<no error raised>>');
    });
    expect((await settlementRow(sid)).status).toBe('finalized');
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5B — candidate source contract', () => {
  it('27. first line marks the file as a not-applied candidate', () => {
    expect(B2C5B_SQL.split('\n')[0]).toBe(
      '-- CANDIDATE MIGRATION — NOT APPLIED LIVE.',
    );
    expect(B2C5B_SQL).toContain('Phase 1T-B2C5B');
    expect(
      fs.existsSync(
        abs(
          '../../supabase/migrations/20260808185000_phase1t_b2c5b_settlement_void.sql',
        ),
      ),
    ).toBe(false);
  });

  it('28. exactly one explicit BEGIN/COMMIT transaction', () => {
    expect(CODE.match(/^\s*BEGIN;\s*$/gm) ?? []).toHaveLength(1);
    expect(CODE.match(/^\s*COMMIT;\s*$/gm) ?? []).toHaveLength(1);
    expect(CODE).not.toMatch(/ROLLBACK|SAVEPOINT/i);
  });

  it('29. no unsafe DDL idioms, dynamic SQL, or error leakage', () => {
    expect(CODE).not.toMatch(/CREATE OR REPLACE/i);
    expect(CODE).not.toMatch(/IF NOT EXISTS/i);
    expect(CODE).not.toMatch(/\bDROP\b/i);
    expect(CODE).not.toMatch(/\bEXECUTE\s+(?!ON FUNCTION)/i);
    expect(CODE).not.toMatch(/format\s*\(/i);
    expect(CODE).not.toMatch(/SQLERRM|SQLSTATE|EXCEPTION\s+WHEN/i);
  });

  it('30. creates exactly one function and changes no DDL, policy, trigger or table grant', () => {
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

  it('31. the settlement row is locked FOR UPDATE before authorization and mutation', () => {
    const lockAt = CODE.indexOf('FOR UPDATE');
    const authAt = CODE.indexOf('settlement_current_user_can_manage_carrier');
    const updateAt = CODE.search(/UPDATE public\.driver_settlements ds/);
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(authAt);
    expect(authAt).toBeLessThan(updateAt);
    expect(CODE.match(/FOR UPDATE/g) ?? []).toHaveLength(1);
  });

  it('32. the UPDATE sets exactly the four allowed settlement columns', () => {
    const upd = CODE.slice(
      CODE.search(/UPDATE public\.driver_settlements ds/),
      CODE.indexOf('RETURNING * INTO v_result'),
    );
    const assigned = (upd.match(/^\s*(?:SET )?([a-z_]+) =/gm) ?? []).map((m) =>
      m.replace(/^\s*(?:SET )?/, '').replace(/ =$/, ''),
    );
    expect(assigned).toEqual([
      'status',
      'voided_by_user_id',
      'voided_at',
      'updated_at',
    ]);
  });

  it('33. only the settlement row and one event row may be written', () => {
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
        new RegExp(
          `(UPDATE|INSERT INTO|DELETE FROM)\\s+${table.replace('.', '\\.')}`,
          'i',
        ),
      );
    }
  });

  it('34. no supersede, correction, export, calculation, matching or notification behavior', () => {
    for (const forbidden of [
      /supersede/i,
      /correction/i,
      /reopen/i,
      /export/i,
      /notif/i,
      /http|net\./i,
      /reason/i,
      /sum\s*\(|round\s*\(|discrepan/i,
    ]) {
      expect(CODE, String(forbidden)).not.toMatch(forbidden);
    }
    expect(CODE).toContain("'voided'");
  });

  it('35. this suite contains no skipped, todo or focused tests', () => {
    expect(SELF_SRC).not.toMatch(/\b(it|describe|test)\.(skip|only|todo)\b/);
    expect(SELF_SRC).not.toMatch(/\b(xit|xdescribe|fit|fdescribe)\s*\(/);
  });
});
