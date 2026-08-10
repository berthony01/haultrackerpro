// @vitest-environment node
// =====================================================================
// Phase 1T-B2C5C — Finalized settlement CORRECTION / SUPERSEDE proofs.
//
// Applies, in order, the REAL accepted Phase 1T-B1, B2A, B2B, B2C1, B2C2A,
// B2C3A, B2C4A, B2C4B, B2C4C, B2C5A and B2C5B candidates and then the REAL new
// Phase 1T-B2C5C candidate inside PGlite on the same faithful bootstrap used by
// the accepted B2C5A/B2C5B suites, and proves catalog shape, ACLs, per-source
// CURRENT authorization re-derivation, the exact finalized -> superseded
// predecessor transition, the faithful new draft revision, faithful item
// cloning with expected_amount_snapshot reset, ZERO match cloning, the exact
// two-event audit pair, and full immutability of loads / predecessor items /
// predecessor matches / unrelated settlements.
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
  b2c5c:
    '../../supabase/migration-candidates/20260808190500_phase1t_b2c5c_settlement_correction_supersede.sql',
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
const B2C5C_SQL = read(REL.b2c5c);
const SELF_SRC = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');

/** Executable SQL only: `--` documentation lines removed. */
const CODE = B2C5C_SQL.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const FN = 'settlement_create_correction_draft';

const ERR = {
  invalid: 'settlement_invalid_request',
  notFound: 'settlement_not_found',
  notCorrectable: 'settlement_not_correctable',
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
  source: string;
  status: string;
  version_number: number;
  supersedes_settlement_id: string | null;
  created_by_user_id: string | null;
  finalized_by_user_id: string | null;
  finalized_at: string | null;
  voided_by_user_id: string | null;
  voided_at: string | null;
}

const LIFECYCLE_COLS = `(r).id, (r).source, (r).status, (r).version_number,
        (r).supersedes_settlement_id, (r).created_by_user_id,
        (r).finalized_by_user_id, (r).finalized_at::text AS finalized_at,
        (r).voided_by_user_id, (r).voided_at::text AS voided_at`;

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

async function correct(
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
  sortOrder = 0,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlement_items
       (settlement_id, item_type, amount, created_by_user_id, sort_order)
     VALUES ($1,$2,$3::numeric,$4,$5) RETURNING id`,
    [settlementId, itemType, amount, creator, sortOrder],
  );
  return r.rows[0].id;
}

async function mkRichItem(
  settlementId: string,
  creator: string,
  sortOrder: number,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlement_items
       (settlement_id, item_type, category, description, amount, pay_method,
        quantity, rate, unit_label, expected_amount_snapshot,
        load_reference_snapshot, pickup_date_snapshot, delivery_date_snapshot,
        origin_snapshot, destination_snapshot, loaded_miles_snapshot,
        deadhead_miles_snapshot, payable_miles_snapshot,
        eligible_revenue_snapshot, sort_order, created_by_user_id)
     VALUES ($1,'load_pay','linehaul','Dallas to Atlanta',1234.56,'per_mile',
             800.0000,1.543210,'mile',1300.00,'LOAD-8891','2026-07-02'::date,
             '2026-07-05'::date,'Dallas, TX','Atlanta, GA',800.00,42.50,842.50,
             1400.00,$2,$3)
     RETURNING id`,
    [settlementId, sortOrder, creator],
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

async function itemsOf(settlementId: string): Promise<Row[]> {
  const r = await db.query<{ j: Row }>(
    `SELECT to_jsonb(i.*) AS j FROM public.driver_settlement_items i
      WHERE i.settlement_id=$1 ORDER BY i.sort_order, i.id`,
    [settlementId],
  );
  return r.rows.map((x) => x.j);
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

async function matchCountForSettlement(settlementId: string): Promise<number> {
  const r = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c
       FROM public.driver_settlement_matches m
       JOIN public.driver_settlement_items i ON i.id = m.settlement_item_id
      WHERE i.settlement_id = $1`,
    [settlementId],
  );
  return Number(r.rows[0].c);
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

async function settlementCount(): Promise<number> {
  const r = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM public.driver_settlements`,
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
  await db.exec(B2C5B_SQL);

  before = await snapshotCatalog();
  await db.exec(B2C5C_SQL);
  after = await snapshotCatalog();

  for (const k of [
    'dCarrier',
    'dCarrierChain',
    'dCarrierRevoke',
    'dCarrierLapse',
    'dAgency',
    'dAgencyRevoke',
    'dAgencyEnt',
    'dImport',
    'dImportStates',
    'dImportMisc',
    'dImportRevoke',
    'dImportProLoss',
    'dImportPermLoss',
    'assistBoth',
    'assistFinalizeOnly',
    'assistManageOnly',
    'assistAgency',
    'assistInactive',
    'assistRevoke',
    'assistProLoss',
    'assistPermLoss',
    'paidCarrier',
    'lapseCarrier',
    'agencyOwner',
    'agencyBoth',
    'agencyFinalizeOnly',
    'agencyManageOnly',
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
    'dImportPermLoss',
  ]) {
    await sub(U[k], 'active');
  }
  // Agency-side drivers are deliberately Free (no subscription row at all).

  const BOTH =
    '{"settlements_view":true,"settlements_manage":true,"settlements_finalize":true}';

  await db.query(
    `INSERT INTO public.driver_assistants
       (driver_user_id, assistant_user_id, status, permissions, agency_delegation_id)
     VALUES
       ($1,$2,'active','${BOTH}'::jsonb, NULL),
       ($1,$3,'active','{"settlements_view":true,"settlements_finalize":true}'::jsonb, NULL),
       ($1,$4,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, NULL),
       ($1,$5,'active','${BOTH}'::jsonb, gen_random_uuid()),
       ($1,$6,'revoked','${BOTH}'::jsonb, NULL),
       ($7,$2,'active','${BOTH}'::jsonb, NULL),
       ($8,$2,'active','${BOTH}'::jsonb, NULL),
       ($9,$10,'active','${BOTH}'::jsonb, NULL),
       ($11,$12,'active','${BOTH}'::jsonb, NULL),
       ($13,$14,'active','${BOTH}'::jsonb, NULL)`,
    [
      U.dImport,
      U.assistBoth,
      U.assistFinalizeOnly,
      U.assistManageOnly,
      U.assistAgency,
      U.assistInactive,
      U.dImportStates,
      U.dImportMisc,
      U.dImportRevoke,
      U.assistRevoke,
      U.dImportProLoss,
      U.assistProLoss,
      U.dImportPermLoss,
      U.assistPermLoss,
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
  await mkRel(recruiterId, U.dCarrierChain, 'active');
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
            ($1,$5,'agency_member','active'),
            ($1,$6,'agency_member','active')`,
    [
      agencyId,
      U.agencyOwner,
      U.agencyBoth,
      U.agencyFinalizeOnly,
      U.agencyManageOnly,
      U.agencyRevoked,
    ],
  );
  await db.query(
    `INSERT INTO public.agency_delegation_requests
       (agency_id, driver_user_id, member_user_id, status, requested_permissions)
     VALUES ($1,$2,$3,'approved',
             '{"settlements_manage":true,"settlements_finalize":true}'::jsonb),
            ($1,$2,$4,'approved','{"settlements_finalize":true}'::jsonb),
            ($1,$2,$5,'approved','{"settlements_manage":true}'::jsonb),
            ($1,$6,$3,'approved',
             '{"settlements_manage":true,"settlements_finalize":true}'::jsonb),
            ($1,$6,$7,'approved',
             '{"settlements_manage":true,"settlements_finalize":true}'::jsonb),
            ($1,$8,$3,'approved',
             '{"settlements_manage":true,"settlements_finalize":true}'::jsonb)`,
    [
      agencyId,
      U.dAgency,
      U.agencyBoth,
      U.agencyFinalizeOnly,
      U.agencyManageOnly,
      U.dAgencyRevoke,
      U.agencyRevoked,
      U.dAgencyEnt,
    ],
  );
});

// ---------------------------------------------------------------------------
describe('1T-B2C5C — chain, catalog and function shape', () => {
  it('1. every required accepted file exists and the real chain applied', () => {
    for (const rel of Object.values(REL)) {
      expect(fs.existsSync(abs(rel)), rel).toBe(true);
    }
    expect(after.functions).toContain('settlement_finalize_draft');
    expect(after.functions).toContain('settlement_void_finalized');
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
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5C — authorized correction per source', () => {
  it('7. currently paid carrier with the exact active relationship corrects', async () => {
    const sid = await mkCarrierSettlement(
      U.dCarrier,
      recruiterId,
      relActive,
      U.paidCarrier,
    );
    const fin = await finalize(U.paidCarrier, sid);
    expect(fin.status).toBe('finalized');

    const out = await correct(U.paidCarrier, sid);
    expect(out.status).toBe('draft');
    expect(out.source).toBe('carrier_issued');
    expect(Number(out.version_number)).toBe(2);
    expect(out.supersedes_settlement_id).toBe(sid);
    expect(out.created_by_user_id).toBe(U.paidCarrier);
    expect(out.finalized_by_user_id).toBeNull();
    expect(out.finalized_at).toBeNull();
    expect(out.voided_by_user_id).toBeNull();
    expect(out.voided_at).toBeNull();

    const prev = await settlementRow(sid);
    expect(prev.status).toBe('superseded');
    expect(prev.finalized_by_user_id).toBe(U.paidCarrier);
    expect(prev.finalized_at).not.toBeNull();
    expect(prev.voided_by_user_id).toBeNull();
  });

  it('8. agency actor with BOTH permissions corrects for a FREE recipient driver', async () => {
    const sid = await mkAgencySettlement(U.dAgency, agencyId, U.agencyBoth);
    await finalize(U.agencyBoth, sid);

    const out = await correct(U.agencyBoth, sid);
    expect(out.status).toBe('draft');
    expect(out.source).toBe('agency_prepared');
    expect(Number(out.version_number)).toBe(2);
    expect(out.created_by_user_id).toBe(U.agencyBoth);

    const sub = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.subscriptions WHERE user_id=$1`,
      [U.dAgency],
    );
    expect(Number(sub.rows[0].c)).toBe(0);
    expect((await settlementRow(sid)).status).toBe('superseded');
  });

  it('9. DIRECT assistant with BOTH permissions over an active-Pro driver corrects', async () => {
    const sid = await mkDriverSettlement(U.dImport, 'draft');
    await finalize(U.assistBoth, sid);

    const out = await correct(U.assistBoth, sid);
    expect(out.status).toBe('draft');
    expect(out.source).toBe('driver_imported');
    expect(out.created_by_user_id).toBe(U.assistBoth);
    expect((await settlementRow(sid)).status).toBe('superseded');
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5C — partial permissions and unauthorized actors fail closed', () => {
  it('10. an agency finalize-only actor cannot create a correction draft', async () => {
    const sid = await mkAgencySettlement(U.dAgency, agencyId, U.agencyBoth);
    await finalize(U.agencyFinalizeOnly, sid);
    const beforeRow = await settlementRow(sid);
    const total = await settlementCount();

    expect(
      await failureMessage(() => correct(U.agencyFinalizeOnly, sid)),
    ).toContain(ERR.agency);
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await settlementCount()).toBe(total);
    expect((await eventsFor(sid)).map((e) => e.event_type)).toEqual([
      'finalized',
    ]);
  });

  it('11. an agency manage-only actor cannot create a correction draft', async () => {
    const sid = await mkAgencySettlement(U.dAgency, agencyId, U.agencyBoth);
    const fin = await finalize(U.agencyBoth, sid);
    expect(fin.status).toBe('finalized');
    const beforeRow = await settlementRow(sid);
    const total = await settlementCount();

    expect(
      await failureMessage(() => correct(U.agencyManageOnly, sid)),
    ).toContain(ERR.agency);
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await settlementCount()).toBe(total);
  });

  it('12. finalize-only, manage-only, view-less, agency-generated, inactive assistants, the recipient driver and a stranger all fail', async () => {
    const sid = await mkDriverSettlement(U.dImport, 'draft');
    await finalize(U.assistBoth, sid);
    const beforeRow = await settlementRow(sid);
    const total = await settlementCount();

    for (const actor of [
      U.assistFinalizeOnly,
      U.assistManageOnly,
      U.assistAgency,
      U.assistInactive,
      U.dImport,
      U.stranger,
    ]) {
      expect(await failureMessage(() => correct(actor, sid))).toContain(
        ERR.driverImport,
      );
    }
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await settlementCount()).toBe(total);
    expect((await eventsFor(sid)).map((e) => e.event_type)).toEqual([
      'finalized',
    ]);
  });

  it('13. recipient driver, stranger and agency owner cannot correct a carrier record', async () => {
    const sid = await mkCarrierSettlement(
      U.dCarrier,
      recruiterId,
      relActive,
      U.paidCarrier,
    );
    await finalize(U.paidCarrier, sid);
    const beforeRow = await settlementRow(sid);
    const total = await settlementCount();

    for (const actor of [U.dCarrier, U.stranger, U.agencyOwner]) {
      expect(await failureMessage(() => correct(actor, sid))).toContain(
        ERR.carrier,
      );
    }
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await settlementCount()).toBe(total);
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5C — CURRENT authorization is re-derived at correction time', () => {
  it('14. a carrier relationship ended AFTER finalization cannot correct', async () => {
    const sid = await mkCarrierSettlement(
      U.dCarrierRevoke,
      recruiterId,
      relRevoke,
      U.paidCarrier,
    );
    await finalize(U.paidCarrier, sid);
    const beforeRow = await settlementRow(sid);
    const total = await settlementCount();
    const events = await eventCount();

    await db.query(
      `UPDATE public.carrier_driver_relationships SET status='ended' WHERE id=$1`,
      [relRevoke],
    );

    expect(await failureMessage(() => correct(U.paidCarrier, sid))).toContain(
      ERR.carrier,
    );
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await settlementCount()).toBe(total);
    expect(await eventCount()).toBe(events);
  });

  it('15. carrier billing lapsed AFTER finalization cannot correct', async () => {
    const sid = await mkCarrierSettlement(
      U.dCarrierLapse,
      recruiterLapseId,
      relLapse,
      U.lapseCarrier,
    );
    await finalize(U.lapseCarrier, sid);
    const beforeRow = await settlementRow(sid);
    const total = await settlementCount();

    await db.query(
      `UPDATE public.recruiter_billing_profiles SET status='canceled' WHERE recruiter_id=$1`,
      [recruiterLapseId],
    );

    expect(await failureMessage(() => correct(U.lapseCarrier, sid))).toContain(
      ERR.carrier,
    );
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await settlementCount()).toBe(total);
  });

  it('16. an agency delegation revoked AFTER finalization cannot correct', async () => {
    const sid = await mkAgencySettlement(
      U.dAgencyRevoke,
      agencyId,
      U.agencyRevoked,
    );
    await finalize(U.agencyRevoked, sid);
    const beforeRow = await settlementRow(sid);
    const total = await settlementCount();

    await db.query(
      `UPDATE public.agency_delegation_requests SET status='revoked'
        WHERE agency_id=$1 AND member_user_id=$2 AND driver_user_id=$3`,
      [agencyId, U.agencyRevoked, U.dAgencyRevoke],
    );

    expect(await failureMessage(() => correct(U.agencyRevoked, sid))).toContain(
      ERR.agency,
    );
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await settlementCount()).toBe(total);
  });

  it('17. an agency permission narrowed to manage-only AFTER finalization cannot correct', async () => {
    const sid = await mkAgencySettlement(U.dAgencyEnt, agencyId, U.agencyBoth);
    await finalize(U.agencyBoth, sid);
    const beforeRow = await settlementRow(sid);

    await db.query(
      `UPDATE public.agency_delegation_requests
          SET requested_permissions = requested_permissions - 'settlements_finalize'
        WHERE agency_id=$1 AND member_user_id=$2 AND driver_user_id=$3`,
      [agencyId, U.agencyBoth, U.dAgencyEnt],
    );

    expect(await failureMessage(() => correct(U.agencyBoth, sid))).toContain(
      ERR.agency,
    );
    expect(await settlementRow(sid)).toEqual(beforeRow);
  });

  it('18. an agency entitlement that ceases to be eligible AFTER finalization cannot correct', async () => {
    const owner = await newUser();
    const actor = await newUser();
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
      [lapseAgencyId, owner, actor],
    );
    await db.query(
      `INSERT INTO public.agency_delegation_requests
         (agency_id, driver_user_id, member_user_id, status, requested_permissions)
       VALUES ($1,$2,$3,'approved',
               '{"settlements_manage":true,"settlements_finalize":true}'::jsonb)`,
      [lapseAgencyId, driver, actor],
    );

    const sid = await mkAgencySettlement(driver, lapseAgencyId, actor);
    expect((await finalize(actor, sid)).status).toBe('finalized');
    const beforeRow = await settlementRow(sid);

    await db.query(
      `UPDATE public.agency_entitlements SET status='canceled' WHERE agency_id=$1`,
      [lapseAgencyId],
    );

    expect(await failureMessage(() => correct(actor, sid))).toContain(
      ERR.agency,
    );
    expect(await settlementRow(sid)).toEqual(beforeRow);
  });

  it('19. an assistant revoked AFTER finalization cannot correct', async () => {
    const sid = await mkDriverSettlement(U.dImportRevoke, 'draft');
    await finalize(U.assistRevoke, sid);
    const beforeRow = await settlementRow(sid);
    const total = await settlementCount();

    await db.query(
      `UPDATE public.driver_assistants SET status='revoked'
        WHERE driver_user_id=$1 AND assistant_user_id=$2`,
      [U.dImportRevoke, U.assistRevoke],
    );

    expect(await failureMessage(() => correct(U.assistRevoke, sid))).toContain(
      ERR.driverImport,
    );
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await settlementCount()).toBe(total);
  });

  it('20. an assistant that loses settlements_manage AFTER finalization cannot correct', async () => {
    const sid = await mkDriverSettlement(U.dImportPermLoss, 'draft');
    await finalize(U.assistPermLoss, sid);
    const beforeRow = await settlementRow(sid);

    await db.query(
      `UPDATE public.driver_assistants
          SET permissions = permissions - 'settlements_manage'
        WHERE driver_user_id=$1 AND assistant_user_id=$2`,
      [U.dImportPermLoss, U.assistPermLoss],
    );
    const still = await db.query<{ s: string }>(
      `SELECT status AS s FROM public.driver_assistants
        WHERE driver_user_id=$1 AND assistant_user_id=$2`,
      [U.dImportPermLoss, U.assistPermLoss],
    );
    expect(still.rows[0].s).toBe('active');

    expect(await failureMessage(() => correct(U.assistPermLoss, sid))).toContain(
      ERR.driverImport,
    );
    expect(await settlementRow(sid)).toEqual(beforeRow);
  });

  it('21. a target driver who lost Pro AFTER finalization blocks assistant correction', async () => {
    const sid = await mkDriverSettlement(U.dImportProLoss, 'draft');
    await finalize(U.assistProLoss, sid);
    const beforeRow = await settlementRow(sid);
    const total = await settlementCount();

    await db.query(
      `UPDATE public.subscriptions SET status='canceled' WHERE user_id=$1`,
      [U.dImportProLoss],
    );

    expect(await failureMessage(() => correct(U.assistProLoss, sid))).toContain(
      ERR.driverImport,
    );
    expect(await settlementRow(sid)).toEqual(beforeRow);
    expect(await settlementCount()).toBe(total);
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5C — lifecycle, inputs and fixed errors', () => {
  it('22. draft, voided and superseded all fail with settlement_not_correctable', async () => {
    for (const status of ['draft', 'voided', 'superseded'] as const) {
      const sid = await mkDriverSettlement(U.dImportStates, status);
      expect(
        await failureMessage(() => correct(U.assistBoth, sid)),
        status,
      ).toContain(ERR.notCorrectable);
      expect((await settlementRow(sid)).status).toBe(status);
      expect(await eventsFor(sid)).toHaveLength(0);
    }
  });

  it('23. correction is NOT idempotent — a replay creates no second successor or events', async () => {
    const sid = await mkDriverSettlement(U.dImportStates, 'draft');
    await finalize(U.assistBoth, sid);
    const first = await correct(U.assistBoth, sid);
    expect(first.status).toBe('draft');

    const total = await settlementCount();
    const events = await eventCount();

    expect(await failureMessage(() => correct(U.assistBoth, sid))).toContain(
      ERR.notCorrectable,
    );
    expect(await settlementCount()).toBe(total);
    expect(await eventCount()).toBe(events);

    const successors = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.driver_settlements
        WHERE supersedes_settlement_id=$1`,
      [sid],
    );
    expect(Number(successors.rows[0].c)).toBe(1);
  });

  it('24. null actor / null id / missing settlement use only the fixed errors', async () => {
    const events = await eventCount();
    const total = await settlementCount();
    expect(await failureMessage(() => correct(U.assistBoth, null))).toContain(
      ERR.invalid,
    );
    expect(
      await failureMessage(() =>
        correct(null, '00000000-0000-0000-0000-000000000001'),
      ),
    ).toContain(ERR.invalid);
    expect(
      await failureMessage(() =>
        correct(U.assistBoth, '00000000-0000-0000-0000-0000000000ff'),
      ),
    ).toContain(ERR.notFound);
    expect(await eventCount()).toBe(events);
    expect(await settlementCount()).toBe(total);
  });

  it('25. a malformed stored source fails closed before any write', async () => {
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

  it('26. observed failures never leak SQLSTATE, constraints or raw Postgres text', async () => {
    const sid = await mkDriverSettlement(U.dImportMisc, 'draft');
    await finalize(U.assistBoth, sid);
    for (const msg of [
      await failureMessage(() => correct(U.stranger, sid)),
      await failureMessage(() => correct(U.dImportMisc, sid)),
      await failureMessage(() => correct(U.assistBoth, null)),
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
describe('1T-B2C5C — revision header, items, matches and audit', () => {
  it('27. the new header faithfully clones predecessor snapshots and provenance', async () => {
    const sid = await mkCarrierSettlement(
      U.dCarrier,
      recruiterId,
      relActive,
      U.paidCarrier,
    );
    await db.query(
      `UPDATE public.driver_settlements
          SET pay_date='2026-07-10'::date,
              statement_reference='STMT-2201',
              payer_name_snapshot='Blue Line Freight LLC',
              source_display_name_snapshot='Blue Line Freight',
              reported_gross_amount=4200.00,
              reported_net_amount=3675.25,
              notes='week 27',
              calculation_version='1'
        WHERE id=$1`,
      [sid],
    );
    await finalize(U.paidCarrier, sid);
    const prevBefore = await settlementRow(sid);

    const out = await correct(U.paidCarrier, sid);
    const next = await settlementRow(out.id);

    for (const key of [
      'driver_user_id',
      'source',
      'carrier_recruiter_profile_id',
      'carrier_driver_relationship_id',
      'agency_id',
      'period_start',
      'period_end',
      'pay_date',
      'statement_reference',
      'payer_name_snapshot',
      'source_display_name_snapshot',
      'reported_gross_amount',
      'reported_net_amount',
      'notes',
      'calculation_version',
    ]) {
      expect(next[key], key).toEqual(prevBefore[key]);
    }
    expect(next.status).toBe('draft');
    expect(next.version_number).toBe(Number(prevBefore.version_number) + 1);
    expect(next.supersedes_settlement_id).toBe(sid);
    expect(next.created_by_user_id).toBe(U.paidCarrier);
    expect(next.finalized_by_user_id).toBeNull();
    expect(next.finalized_at).toBeNull();
    expect(next.voided_by_user_id).toBeNull();
    expect(next.voided_at).toBeNull();
    expect(next.id).not.toBe(sid);
    expect(next.created_at).not.toBe(prevBefore.created_at);
  });

  it('28. the predecessor changes ONLY status and updated_at', async () => {
    const sid = await mkDriverSettlement(U.dImportMisc, 'draft');
    await finalize(U.assistBoth, sid);
    const rowBefore = await settlementRow(sid);

    await correct(U.assistBoth, sid);
    const rowAfter = await settlementRow(sid);

    const allowed = new Set(['status', 'updated_at']);
    for (const key of Object.keys(rowBefore)) {
      if (allowed.has(key)) continue;
      expect(rowAfter[key], key).toEqual(rowBefore[key]);
    }
    expect(rowAfter.status).toBe('superseded');
    expect(rowAfter.finalized_by_user_id).toBe(rowBefore.finalized_by_user_id);
    expect(rowAfter.finalized_at).toBe(rowBefore.finalized_at);
    expect(rowAfter.voided_by_user_id).toBeNull();
    expect(rowAfter.voided_at).toBeNull();
  });

  it('29. every predecessor item is cloned faithfully with expected_amount_snapshot reset', async () => {
    const sid = await mkDriverSettlement(U.dImportMisc, 'draft');
    await mkRichItem(sid, U.dImportMisc, 0);
    await mkItem(sid, U.dImportMisc, '125.50', 'deduction', 1);
    await mkItem(sid, U.dImportMisc, '75.25', 'load_pay', 2);
    await finalize(U.assistBoth, sid);

    const prevItems = await itemsOf(sid);
    expect(prevItems).toHaveLength(3);

    const out = await correct(U.assistBoth, sid);
    const newItems = await itemsOf(out.id);
    expect(newItems).toHaveLength(3);

    const copied = [
      'item_type',
      'category',
      'description',
      'amount',
      'pay_method',
      'quantity',
      'rate',
      'unit_label',
      'load_reference_snapshot',
      'pickup_date_snapshot',
      'delivery_date_snapshot',
      'origin_snapshot',
      'destination_snapshot',
      'loaded_miles_snapshot',
      'deadhead_miles_snapshot',
      'payable_miles_snapshot',
      'eligible_revenue_snapshot',
      'sort_order',
    ];
    for (let i = 0; i < prevItems.length; i += 1) {
      for (const key of copied) {
        expect(newItems[i][key], `${i}:${key}`).toEqual(prevItems[i][key]);
      }
      expect(newItems[i].id).not.toBe(prevItems[i].id);
      expect(newItems[i].settlement_id).toBe(out.id);
      expect(newItems[i].created_by_user_id).toBe(U.assistBoth);
      expect(newItems[i].expected_amount_snapshot).toBeNull();
    }
    // the original expected_amount_snapshot survives on the predecessor item
    expect(prevItems[0].expected_amount_snapshot).not.toBeNull();
  });

  it('30. ZERO matches are cloned and predecessor matches/loads stay byte-identical', async () => {
    const sid = await mkDriverSettlement(U.dImportMisc, 'draft');
    const item = await mkItem(sid, U.dImportMisc, '1000.00');
    const l1 = await mkLoad(U.dImportMisc);
    const l2 = await mkLoad(U.dImportMisc);
    await mkMatch(item, l1, 'confirmed', '0.9500');
    await mkMatch(item, l2, 'possible', '0.4200');
    await finalize(U.assistBoth, sid);

    const matchesBefore = await matchesSnapshot();
    const loadsBefore = await loadsSnapshot();
    const prevItemsBefore = JSON.stringify(await itemsOf(sid));

    const out = await correct(U.assistBoth, sid);

    expect(await matchCountForSettlement(out.id)).toBe(0);
    expect(await matchCountForSettlement(sid)).toBe(2);
    expect(await matchesSnapshot()).toBe(matchesBefore);
    expect(await loadsSnapshot()).toBe(loadsBefore);
    expect(JSON.stringify(await itemsOf(sid))).toBe(prevItemsBefore);
  });

  it('31. exactly two audit rows are written with the required metadata', async () => {
    const sid = await mkDriverSettlement(U.dImportMisc, 'draft');
    await finalize(U.assistBoth, sid);
    const events = await eventCount();

    const out = await correct(U.assistBoth, sid);
    expect(await eventCount()).toBe(events + 2);

    const prevEvents = await eventsFor(sid);
    expect(prevEvents.map((e) => e.event_type)).toEqual([
      'finalized',
      'superseded',
    ]);
    const superseded = prevEvents[1];
    expect(superseded.actor_user_id).toBe(U.assistBoth);
    expect(superseded.metadata).toMatchObject({
      source: 'driver_imported',
      change: 'settlement_superseded',
      successor_settlement_id: out.id,
    });

    const nextEvents = await eventsFor(out.id);
    expect(nextEvents).toHaveLength(1);
    expect(nextEvents[0].event_type).toBe('created');
    expect(nextEvents[0].actor_user_id).toBe(U.assistBoth);
    expect(nextEvents[0].metadata).toMatchObject({
      source: 'driver_imported',
      change: 'settlement_correction_created',
      supersedes_settlement_id: sid,
      version_number: 2,
    });
  });

  it('32. a finalized version 2 can itself be corrected into version 3', async () => {
    const sid = await mkDriverSettlement(U.dImportMisc, 'draft');
    await finalize(U.assistBoth, sid);
    const v2 = await correct(U.assistBoth, sid);
    expect(Number(v2.version_number)).toBe(2);

    await finalize(U.assistBoth, v2.id);
    const v3 = await correct(U.assistBoth, v2.id);

    expect(Number(v3.version_number)).toBe(3);
    expect(v3.supersedes_settlement_id).toBe(v2.id);
    expect(v3.status).toBe('draft');
    expect((await settlementRow(v2.id)).status).toBe('superseded');
    expect((await settlementRow(sid)).status).toBe('superseded');
    expect((await settlementRow(sid)).supersedes_settlement_id).toBeNull();
  });

  it('33. unrelated settlements, items and matches are untouched', async () => {
    const sid = await mkDriverSettlement(U.dImportMisc, 'draft');
    await finalize(U.assistBoth, sid);

    const other = await mkDriverSettlement(U.dImportMisc, 'draft');
    const otherItem = await mkItem(other, U.dImportMisc, '500.00');
    const otherLoad = await mkLoad(U.dImportMisc);
    await mkMatch(otherItem, otherLoad, 'likely', '0.6000');
    const otherBefore = await settlementRow(other);
    const otherItemsBefore = JSON.stringify(await itemsOf(other));
    const matchesBefore = await matchesSnapshot();

    await correct(U.assistBoth, sid);

    expect(await settlementRow(other)).toEqual(otherBefore);
    expect(JSON.stringify(await itemsOf(other))).toBe(otherItemsBefore);
    expect(await matchesSnapshot()).toBe(matchesBefore);
  });

  it('34. direct authenticated DML is still blocked by the accepted B2B RLS', async () => {
    const sid = await mkDriverSettlement(U.dImport, 'draft');
    await finalize(U.assistBoth, sid);
    const itemsBefore = await itemsSnapshot();
    await asRole('authenticated', U.dImport, async () => {
      const upd = await db.query(
        `UPDATE public.driver_settlements SET status='superseded' WHERE id=$1`,
        [sid],
      );
      expect(upd.affectedRows ?? 0).toBe(0);
      const del = await db.query(
        `DELETE FROM public.driver_settlements WHERE id=$1`,
        [sid],
      );
      expect(del.affectedRows ?? 0).toBe(0);
      const insItem = await failureMessage(() =>
        db.query(
          `INSERT INTO public.driver_settlement_items
             (settlement_id, item_type, amount, created_by_user_id)
           VALUES ($1,'load_pay',10.00,$2)`,
          [sid, U.dImport],
        ),
      );
      expect(insItem).not.toBe('<<no error raised>>');
      const insEvent = await failureMessage(() =>
        db.query(
          `INSERT INTO public.driver_settlement_events
             (settlement_id, actor_user_id, event_type)
           VALUES ($1,$2,'superseded')`,
          [sid, U.dImport],
        ),
      );
      expect(insEvent).not.toBe('<<no error raised>>');
    });
    expect((await settlementRow(sid)).status).toBe('finalized');
    expect(await itemsSnapshot()).toBe(itemsBefore);
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C5C — candidate source contract', () => {
  it('35. candidate stays candidate-marked while its accepted promotion exists', () => {
    expect(B2C5C_SQL.split('\n')[0]).toBe(
      '-- CANDIDATE MIGRATION — NOT APPLIED LIVE.',
    );
    expect(B2C5C_SQL).toContain('Phase 1T-B2C5C');
    expect(
      fs.existsSync(
        abs(
          '../../supabase/migrations/20260808190500_phase1t_b2c5c_settlement_correction_supersede.sql',
        ),
      ),
    ).toBe(true);
  });

  it('36. exactly one explicit BEGIN/COMMIT transaction', () => {
    expect(CODE.match(/^\s*BEGIN;\s*$/gm) ?? []).toHaveLength(1);
    expect(CODE.match(/^\s*COMMIT;\s*$/gm) ?? []).toHaveLength(1);
    expect(CODE).not.toMatch(/ROLLBACK|SAVEPOINT/i);
  });

  it('37. no unsafe DDL idioms, dynamic SQL, advisory locks, loops or error leakage', () => {
    expect(CODE).not.toMatch(/CREATE OR REPLACE/i);
    expect(CODE).not.toMatch(/IF NOT EXISTS/i);
    expect(CODE).not.toMatch(/\bDROP\b/i);
    expect(CODE).not.toMatch(/\bEXECUTE\s+(?!ON FUNCTION)/i);
    expect(CODE).not.toMatch(/format\s*\(/i);
    expect(CODE).not.toMatch(/SQLERRM|SQLSTATE|EXCEPTION\s+WHEN/i);
    expect(CODE).not.toMatch(/pg_advisory|\bLOOP\b|\bWHILE\b/i);
  });

  it('38. creates exactly one function and changes no DDL, policy, trigger or table grant', () => {
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

  it('39. the predecessor is locked FOR UPDATE before authorization and any write', () => {
    const lockAt = CODE.indexOf('FOR UPDATE');
    const authAt = CODE.indexOf('settlement_current_user_can_manage_carrier');
    const insertAt = CODE.indexOf('INSERT INTO public.driver_settlements');
    const updateAt = CODE.search(/UPDATE public\.driver_settlements ds/);
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(authAt);
    expect(authAt).toBeLessThan(insertAt);
    expect(insertAt).toBeLessThan(updateAt);
    expect(CODE.match(/FOR UPDATE/g) ?? []).toHaveLength(1);
  });

  it('40. the predecessor UPDATE sets exactly status and updated_at', () => {
    const upd = CODE.slice(
      CODE.search(/UPDATE public\.driver_settlements ds/),
      CODE.indexOf('driver_settlement_events'),
    );
    const assigned = (upd.match(/^\s*(?:SET )?([a-z_]+) =/gm) ?? []).map((m) =>
      m.replace(/^\s*(?:SET )?/, '').replace(/ =$/, ''),
    );
    expect(assigned).toEqual(['status', 'updated_at']);
    expect(upd).toContain("status = 'superseded'");
    expect(upd).not.toMatch(/voided_|finalized_/);
  });

  it('41. writes are limited to the new revision, cloned items and two audit rows', () => {
    expect(CODE.match(/^\s*UPDATE\s+public\./gm) ?? []).toHaveLength(1);
    const inserts = CODE.match(/INSERT INTO public\.[a-z_]+/g) ?? [];
    expect(inserts).toEqual([
      'INSERT INTO public.driver_settlements',
      'INSERT INTO public.driver_settlement_items',
      'INSERT INTO public.driver_settlement_events',
      'INSERT INTO public.driver_settlement_events',
    ]);
    expect(CODE).not.toMatch(/DELETE\s+FROM/i);
    for (const table of [
      'public.loads',
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

  it('42. only the existing B1 event vocabulary is used and no calculation happens', () => {
    expect(CODE).toContain("'superseded'");
    expect(CODE).toContain("'created'");
    expect(CODE).toContain('settlement_correction_created');
    for (const forbidden of [
      /export/i,
      /notif/i,
      /http|net\./i,
      /sum\s*\(|round\s*\(|discrepan/i,
      /event_type_check|CHECK\s*\(/i,
    ]) {
      expect(CODE, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it('43. this suite contains no skipped, todo or focused tests', () => {
    expect(SELF_SRC).not.toMatch(/\b(it|describe|test)\.(skip|only|todo)\b/);
    expect(SELF_SRC).not.toMatch(/\b(xit|xdescribe|fit|fdescribe)\s*\(/);
  });
});
