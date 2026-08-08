// @vitest-environment node
// =====================================================================
// Phase 1T-B2C2A — Controlled settlement DRAFT HEADER create/update RPC proofs.
//
// Applies, in order, the REAL accepted Phase 1T-B1, B2A, B2B and B2C1
// candidates and the REAL Phase 1T-B2C2A candidate inside PGlite on a
// minimal but faithful bootstrap that includes the canonical production
// naming columns (recruiter_profiles.company_name, agency_profiles.name),
// then proves catalog shape, ACLs, source-specific authorization,
// server-resolved business name snapshots, normalization/validation, event
// emission, immutability, and that direct client writes stay blocked by the
// B2B read-only RLS contract.
//
// Table privileges for `authenticated` are granted ONLY inside this harness
// so RLS — never a missing GRANT — proves the write boundary.
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
} as const;

const read = (rel: string) =>
  fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const B1_SQL = read(REL.b1);
const B2A_SQL = read(REL.b2a);
const B2B_SQL = read(REL.b2b);
const B2C1_SQL = read(REL.b2c1);
const B2C2A_SQL = read(REL.b2c2a);

/** Executable SQL only: `--` documentation lines removed. */
const CODE = B2C2A_SQL.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const FUNCTIONS = [
  'settlement_create_agency_draft',
  'settlement_create_carrier_draft',
  'settlement_create_driver_imported_draft',
  'settlement_update_draft_header',
] as const;

const ERR = {
  invalid: 'settlement_invalid_request',
  period: 'settlement_invalid_period',
  amount: 'settlement_invalid_amount',
  tooLong: 'settlement_text_too_long',
  driverImport: 'settlement_driver_import_not_authorized',
  carrier: 'settlement_carrier_not_authorized',
  agency: 'settlement_agency_not_authorized',
  carrierName: 'settlement_carrier_name_unavailable',
  agencyName: 'settlement_agency_name_unavailable',
  notFound: 'settlement_not_found',
  notEditable: 'settlement_not_editable',
  invalidSource: 'settlement_invalid_source',
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
  user_id uuid NOT NULL
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

interface SettlementRow {
  id: string;
  driver_user_id: string;
  source: string;
  status: string;
  carrier_recruiter_profile_id: string | null;
  carrier_driver_relationship_id: string | null;
  agency_id: string | null;
  ps: string;
  pe: string;
  pd: string | null;
  statement_reference: string | null;
  payer_name_snapshot: string | null;
  source_display_name_snapshot: string | null;
  reported_gross_amount: string | null;
  reported_net_amount: string | null;
  notes: string | null;
  calculation_version: string;
  version_number: number;
  supersedes_settlement_id: string | null;
  created_by_user_id: string;
  finalized_by_user_id: string | null;
  finalized_at: string | null;
  voided_by_user_id: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
}

let db: AnyPGlite;

let beforeTables: string[] = [];
let beforeFunctions: string[] = [];
let beforeIndexes: string[] = [];
let beforeTriggers: string[] = [];
let beforeViews: string[] = [];
let beforeTypes: string[] = [];
let beforePolicies: string[] = [];

let afterTables: string[] = [];
let afterFunctions: string[] = [];
let afterIndexes: string[] = [];
let afterTriggers: string[] = [];
let afterViews: string[] = [];
let afterTypes: string[] = [];
let afterPolicies: string[] = [];

const TABLES_SQL = `SELECT tablename AS n FROM pg_tables WHERE schemaname='public' ORDER BY 1`;
const FUNCS_SQL = `SELECT p.proname AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' ORDER BY 1`;
const IDX_SQL = `SELECT indexname AS n FROM pg_indexes WHERE schemaname='public' ORDER BY 1`;
const TRIGS_SQL = `SELECT t.tgname AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE NOT t.tgisinternal AND ns.nspname='public' ORDER BY 1`;
const VIEWS_SQL = `SELECT viewname AS n FROM pg_views WHERE schemaname='public' ORDER BY 1`;
const TYPES_SQL = `SELECT t.typname AS n FROM pg_type t JOIN pg_namespace ns ON ns.oid=t.typnamespace WHERE ns.nspname='public' AND t.typtype IN ('e','d') ORDER BY 1`;
const POLICIES_SQL = `SELECT (tablename || '.' || policyname) AS n FROM pg_policies WHERE schemaname='public' ORDER BY 1`;

async function names(sql: string): Promise<string[]> {
  const r = await db.query<{ n: string }>(sql);
  return r.rows.map((x) => x.n);
}

// --- actors / fixtures -----------------------------------------------------
const U: Record<string, string> = {};
const R: Record<string, string> = {};
const A: Record<string, string> = {};
const RELS: Record<string, string> = {};

const CARRIER_NAME = 'Blue Line Freight';
const AGENCY_NAME = 'Acme Back Office';
const LONG_NAME = 'x'.repeat(201);

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

const CREATE_DRIVER_SQL = `SELECT * FROM public.settlement_create_driver_imported_draft(
  $1::uuid, $2::date, $3::date, $4::date, $5::text, $6::text, $7::numeric, $8::numeric, $9::text)`;
const CREATE_CARRIER_SQL = `SELECT * FROM public.settlement_create_carrier_draft(
  $1::uuid, $2::uuid, $3::uuid, $4::date, $5::date, $6::date, $7::text, $8::numeric, $9::numeric, $10::text)`;
const CREATE_AGENCY_SQL = `SELECT * FROM public.settlement_create_agency_draft(
  $1::uuid, $2::uuid, $3::date, $4::date, $5::date, $6::text, $7::text, $8::numeric, $9::numeric, $10::text)`;
const UPDATE_SQL = `SELECT * FROM public.settlement_update_draft_header(
  $1::uuid, $2::date, $3::date, $4::date, $5::text, $6::text, $7::numeric, $8::numeric, $9::text)`;

const P1 = '2026-07-01';
const P2 = '2026-07-07';

async function createDriverImported(
  driver: string | null,
  ps: string | null = P1,
  pe: string | null = P2,
  payDate: string | null = null,
  ref: string | null = null,
  payer: string | null = null,
  gross: string | null = null,
  net: string | null = null,
  notes: string | null = null,
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(CREATE_DRIVER_SQL, [
    driver,
    ps,
    pe,
    payDate,
    ref,
    payer,
    gross,
    net,
    notes,
  ]);
  return r.rows[0];
}

async function createCarrier(
  rid: string | null,
  relId: string | null,
  driver: string | null,
  ps: string | null = P1,
  pe: string | null = P2,
  payDate: string | null = null,
  ref: string | null = null,
  gross: string | null = null,
  net: string | null = null,
  notes: string | null = null,
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(CREATE_CARRIER_SQL, [
    rid,
    relId,
    driver,
    ps,
    pe,
    payDate,
    ref,
    gross,
    net,
    notes,
  ]);
  return r.rows[0];
}

async function createAgency(
  aid: string | null,
  driver: string | null,
  ps: string | null = P1,
  pe: string | null = P2,
  payDate: string | null = null,
  ref: string | null = null,
  payer: string | null = null,
  gross: string | null = null,
  net: string | null = null,
  notes: string | null = null,
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(CREATE_AGENCY_SQL, [
    aid,
    driver,
    ps,
    pe,
    payDate,
    ref,
    payer,
    gross,
    net,
    notes,
  ]);
  return r.rows[0];
}

async function updateHeader(
  id: string | null,
  ps: string | null = P1,
  pe: string | null = P2,
  payDate: string | null = null,
  ref: string | null = null,
  payer: string | null = null,
  gross: string | null = null,
  net: string | null = null,
  notes: string | null = null,
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(UPDATE_SQL, [
    id,
    ps,
    pe,
    payDate,
    ref,
    payer,
    gross,
    net,
    notes,
  ]);
  return r.rows[0];
}

async function failureMessage(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as Error).message;
  }
  return '<<no error raised>>';
}

async function settlementById(id: string): Promise<SettlementRow | undefined> {
  const r = await db.query<SettlementRow>(
    `SELECT *, period_start::text AS ps, period_end::text AS pe, pay_date::text AS pd
       FROM public.driver_settlements WHERE id=$1`,
    [id],
  );
  return r.rows[0];
}

async function settlementCount(): Promise<number> {
  const r = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM public.driver_settlements`,
  );
  return Number(r.rows[0].c);
}

async function eventCount(): Promise<number> {
  const r = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM public.driver_settlement_events`,
  );
  return Number(r.rows[0].c);
}

interface EventRow {
  id: string;
  settlement_id: string;
  actor_user_id: string | null;
  event_type: string;
  metadata: Record<string, unknown>;
}

async function eventsFor(settlementId: string): Promise<EventRow[]> {
  const r = await db.query<EventRow>(
    `SELECT * FROM public.driver_settlement_events
      WHERE settlement_id=$1 ORDER BY created_at, id`,
    [settlementId],
  );
  return r.rows;
}

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;

  await db.exec(BOOTSTRAP);
  await db.exec(B1_SQL);
  await db.exec(HARNESS_GRANTS);
  await db.exec(B2A_SQL);
  await db.exec(B2B_SQL);
  await db.exec(B2C1_SQL);

  beforeTables = await names(TABLES_SQL);
  beforeFunctions = await names(FUNCS_SQL);
  beforeIndexes = await names(IDX_SQL);
  beforeTriggers = await names(TRIGS_SQL);
  beforeViews = await names(VIEWS_SQL);
  beforeTypes = await names(TYPES_SQL);
  beforePolicies = await names(POLICIES_SQL);

  await db.exec(B2C2A_SQL);

  afterTables = await names(TABLES_SQL);
  afterFunctions = await names(FUNCS_SQL);
  afterIndexes = await names(IDX_SQL);
  afterTriggers = await names(TRIGS_SQL);
  afterViews = await names(VIEWS_SQL);
  afterTypes = await names(TYPES_SQL);
  afterPolicies = await names(POLICIES_SQL);

  for (const k of [
    'driverPro',
    'driverFree',
    'driverCancelled',
    'carrierDriver',
    'invitedDriver',
    'endedDriver',
    'lapseDriver',
    'agencyDriver',
    'agencyLapseDriver',
    'trialDriver',
    'betaDriver',
    'blankAgencyDriver',
    'longAgencyDriver',
    'stringPermDriver',
    'assistant',
    'assistantViewOnly',
    'agencyAssistant',
    'paidCarrier',
    'unpaidCarrier',
    'dualPaidCarrier',
    'agencyIncludedCarrier',
    'blankNameCarrier',
    'longNameCarrier',
    'lapseCarrier',
    'agencyOwner',
    'agencyMember',
    'otherAgencyMember',
    'stranger',
  ]) {
    U[k] = await newUser();
  }

  const sub = async (uid: string, plan: string, status: string) =>
    db.query(
      `INSERT INTO public.subscriptions (user_id, plan_key, status) VALUES ($1,$2,$3)`,
      [uid, plan, status],
    );
  await sub(U.driverPro, 'pro_monthly', 'active');
  await sub(U.driverCancelled, 'pro_monthly', 'canceled');

  const mkRecruiter = async (owner: string, company: string | null) =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO public.recruiter_profiles (user_id, company_name)
         VALUES ($1,$2) RETURNING id`,
        [owner, company],
      )
    ).rows[0].id;

  R.paid = await mkRecruiter(U.paidCarrier, `   ${CARRIER_NAME}   `);
  R.unpaid = await mkRecruiter(U.unpaidCarrier, 'Unpaid Carrier Co');
  R.dualPaid = await mkRecruiter(U.dualPaidCarrier, 'Dual Paid Co');
  R.agencyIncluded = await mkRecruiter(U.agencyIncludedCarrier, 'Included Co');
  R.blank = await mkRecruiter(U.blankNameCarrier, '   ');
  R.long = await mkRecruiter(U.longNameCarrier, LONG_NAME);
  R.lapse = await mkRecruiter(U.lapseCarrier, 'Lapsing Carrier Co');

  const bill = async (rid: string, uid: string, plan: string, status: string) =>
    db.query(
      `INSERT INTO public.recruiter_billing_profiles (recruiter_id, user_id, plan, status)
       VALUES ($1,$2,$3,$4)`,
      [rid, uid, plan, status],
    );
  await bill(R.paid, U.paidCarrier, 'growth', 'active');
  await bill(R.dualPaid, U.dualPaidCarrier, 'starter', 'active');
  await bill(R.blank, U.blankNameCarrier, 'growth', 'active');
  await bill(R.long, U.longNameCarrier, 'growth', 'active');
  await bill(R.lapse, U.lapseCarrier, 'growth', 'active');

  const mkAgency = async (
    owner: string,
    name: string | null,
    planStatus: string,
    agencyStatus = 'active',
  ) => {
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO public.agency_profiles (owner_user_id, name, status)
         VALUES ($1,$2,$3) RETURNING id`,
        [owner, name, agencyStatus],
      )
    ).rows[0].id;
    await db.query(
      `INSERT INTO public.agency_entitlements (agency_id, plan_key, status)
       VALUES ($1,'agency_team',$2)`,
      [id, planStatus],
    );
    await db.query(
      `INSERT INTO public.agency_members (agency_id, member_user_id, role, status)
       VALUES ($1,$2,'agency_owner','active'), ($1,$3,'agency_member','active')`,
      [id, owner, U.agencyMember],
    );
    return id;
  };

  A.paid = await mkAgency(U.agencyOwner, `  ${AGENCY_NAME}  `, 'active');
  A.trial = await mkAgency(U.agencyOwner, 'Trial Agency', 'trialing');
  A.beta = await mkAgency(U.agencyOwner, 'Beta Agency', 'manual_beta');
  A.cancelled = await mkAgency(U.agencyOwner, 'Cancelled Agency', 'cancelled');
  A.blank = await mkAgency(U.agencyOwner, '   ', 'active');
  A.long = await mkAgency(U.agencyOwner, LONG_NAME, 'active');
  A.lapse = await mkAgency(U.agencyOwner, 'Lapsing Agency', 'active');

  const delegate = async (
    aid: string,
    driver: string,
    member: string,
    status: string,
    perms: string,
  ) =>
    db.query(
      `INSERT INTO public.agency_delegation_requests
         (agency_id, driver_user_id, member_user_id, status, requested_permissions)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [aid, driver, member, status, perms],
    );

  const MANAGE = '{"settlements_manage":true}';
  await delegate(A.paid, U.agencyDriver, U.agencyMember, 'approved', MANAGE);
  await delegate(A.trial, U.trialDriver, U.agencyMember, 'approved', MANAGE);
  await delegate(A.beta, U.betaDriver, U.agencyMember, 'approved', MANAGE);
  await delegate(A.cancelled, U.agencyDriver, U.agencyMember, 'approved', MANAGE);
  await delegate(A.blank, U.blankAgencyDriver, U.agencyMember, 'approved', MANAGE);
  await delegate(A.long, U.longAgencyDriver, U.agencyMember, 'approved', MANAGE);
  await delegate(A.lapse, U.agencyLapseDriver, U.agencyMember, 'approved', MANAGE);
  // Pending delegation and a string-typed permission both fail closed.
  await delegate(A.paid, U.driverFree, U.agencyMember, 'pending', MANAGE);
  await delegate(
    A.paid,
    U.stringPermDriver,
    U.agencyMember,
    'approved',
    '{"settlements_manage":"true"}',
  );

  // Direct assistant contexts.
  await db.query(
    `INSERT INTO public.driver_assistants
       (driver_user_id, assistant_user_id, status, permissions, agency_delegation_id)
     VALUES
       ($1,$2,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, NULL),
       ($3,$2,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, NULL),
       ($1,$4,'active','{"settlements_view":true}'::jsonb, NULL),
       ($1,$5,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, gen_random_uuid())`,
    [U.driverPro, U.assistant, U.driverFree, U.assistantViewOnly, U.agencyAssistant],
  );

  const mkRel = async (rid: string, driver: string, status: string) => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO public.carrier_driver_relationships
         (recruiter_id, driver_user_id, status, created_by_user_id, accepted_at)
       VALUES ($1,$2,$3,$1,
               CASE WHEN $3='active' THEN now() ELSE NULL END)
       RETURNING id`,
      [rid, driver, status],
    );
    return r.rows[0].id;
  };

  RELS.active = await mkRel(R.paid, U.carrierDriver, 'active');
  RELS.invited = await mkRel(R.paid, U.invitedDriver, 'invited');
  RELS.ended = await mkRel(R.paid, U.endedDriver, 'ended');
  RELS.unpaid = await mkRel(R.unpaid, U.carrierDriver, 'active');
  RELS.blank = await mkRel(R.blank, U.carrierDriver, 'active');
  RELS.long = await mkRel(R.long, U.carrierDriver, 'active');
  RELS.lapse = await mkRel(R.lapse, U.lapseDriver, 'active');
  RELS.dualPaid = await mkRel(R.dualPaid, U.carrierDriver, 'active');
  RELS.agencyIncluded = await mkRel(R.agencyIncluded, U.carrierDriver, 'active');

  // Dual-paid conflict agency owned by the dual-paid carrier user.
  const conflictAgency = (
    await db.query<{ id: string }>(
      `INSERT INTO public.agency_profiles (owner_user_id, name, status)
       VALUES ($1,'Conflict Agency','active') RETURNING id`,
      [U.dualPaidCarrier],
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO public.agency_members (agency_id, member_user_id, role, status)
     VALUES ($1,$2,'agency_owner','active')`,
    [conflictAgency, U.dualPaidCarrier],
  );
  await db.query(
    `INSERT INTO public.agency_entitlements (agency_id, plan_key, status)
     VALUES ($1,'agency_team','active')`,
    [conflictAgency],
  );
});

// =====================================================================
describe('Phase 1T-B2C2A — catalog and ACL contract', () => {
  it('all five real candidates apply in order (proof 1)', () => {
    expect(beforeTables).toEqual(
      expect.arrayContaining([
        'carrier_driver_relationships',
        'driver_settlements',
        'driver_settlement_items',
        'driver_settlement_matches',
        'driver_settlement_events',
      ]),
    );
    expect(beforeFunctions).toEqual(
      expect.arrayContaining([
        'settlement_current_user_can_manage_driver_import',
        'settlement_current_user_can_manage_carrier',
        'settlement_current_user_can_manage_agency',
        'settlement_invite_carrier_driver',
      ]),
    );
    for (const fn of FUNCTIONS) {
      expect(afterFunctions).toContain(fn);
    }
  });

  it('adds exactly four functions and nothing else (proof 2)', () => {
    const added = afterFunctions.filter((n) => !beforeFunctions.includes(n)).sort();
    expect(added).toEqual([...FUNCTIONS].sort());
    expect(afterTables).toEqual(beforeTables);
    expect(afterIndexes).toEqual(beforeIndexes);
    expect(afterTriggers).toEqual(beforeTriggers);
    expect(afterViews).toEqual(beforeViews);
    expect(afterTypes).toEqual(beforeTypes);
    expect(afterPolicies).toEqual(beforePolicies);
    expect(afterPolicies.length).toBe(5);
  });

  it('all four are plpgsql SECURITY DEFINER, VOLATILE, locked search_path, correct ACL (proof 3)', async () => {
    const rows = (
      await db.query<{
        proname: string;
        lang: string;
        prosecdef: boolean;
        provolatile: string;
        proconfig: string | null;
        acl: string | null;
      }>(
        `SELECT p.proname, l.lanname AS lang, p.prosecdef, p.provolatile,
                array_to_string(p.proconfig, ',') AS proconfig,
                p.proacl::text AS acl
           FROM pg_proc p
           JOIN pg_namespace ns ON ns.oid = p.pronamespace
           JOIN pg_language l ON l.oid = p.prolang
          WHERE ns.nspname='public' AND p.proname = ANY($1::text[])
          ORDER BY p.proname`,
        [[...FUNCTIONS]],
      )
    ).rows;

    expect(rows.map((r) => r.proname)).toEqual([...FUNCTIONS].sort());
    for (const r of rows) {
      expect(`${r.proname}:${r.lang}`).toBe(`${r.proname}:plpgsql`);
      expect(`${r.proname}:${r.prosecdef}`).toBe(`${r.proname}:true`);
      expect(`${r.proname}:${r.provolatile}`).toBe(`${r.proname}:v`);
      expect(r.proconfig).toBe('search_path=pg_catalog, public, auth');
      const acl = r.acl ?? '';
      expect(`${r.proname}:${acl.includes('authenticated=X/')}`).toBe(
        `${r.proname}:true`,
      );
      expect(`${r.proname}:${acl.includes('service_role=X/')}`).toBe(
        `${r.proname}:true`,
      );
      expect(`${r.proname}:${acl.includes('anon=X/')}`).toBe(`${r.proname}:false`);
      expect(`${r.proname}:${/(^|,)=X\//.test(acl)}`).toBe(`${r.proname}:false`);
    }
  });

  it('anon cannot execute any of the four RPCs (proof 3b)', async () => {
    await asRole('anon', null, async () => {
      const calls = [
        () => createDriverImported(U.driverPro),
        () => createCarrier(R.paid, RELS.active, U.carrierDriver),
        () => createAgency(A.paid, U.agencyDriver),
        () => updateHeader('00000000-0000-4000-8000-000000000000'),
      ];
      for (const call of calls) {
        expect(await failureMessage(call)).toMatch(/permission denied/i);
      }
    });
  });

  it('null / unauthenticated actors fail all four with fixed errors (proof 4)', async () => {
    const before = await settlementCount();
    await asRole('authenticated', null, async () => {
      expect(await failureMessage(() => createDriverImported(U.driverPro))).toContain(
        ERR.invalid,
      );
      expect(
        await failureMessage(() => createCarrier(R.paid, RELS.active, U.carrierDriver)),
      ).toContain(ERR.invalid);
      expect(await failureMessage(() => createAgency(A.paid, U.agencyDriver))).toContain(
        ERR.invalid,
      );
      expect(
        await failureMessage(() =>
          updateHeader('00000000-0000-4000-8000-000000000000'),
        ),
      ).toContain(ERR.invalid);
    });
    // Missing required ids are equally fixed-error, never a raw DB failure.
    await asRole('authenticated', U.driverPro, async () => {
      expect(await failureMessage(() => createDriverImported(null))).toContain(
        ERR.invalid,
      );
      expect(
        await failureMessage(() => createCarrier(R.paid, null, U.carrierDriver)),
      ).toContain(ERR.invalid);
      expect(await failureMessage(() => createAgency(null, U.agencyDriver))).toContain(
        ERR.invalid,
      );
      expect(await failureMessage(() => updateHeader(null))).toContain(ERR.invalid);
    });
    expect(await settlementCount()).toBe(before);
  });
});

// =====================================================================
describe('Phase 1T-B2C2A — driver-imported creation', () => {
  it('an active Pro recipient can create a driver_imported draft (proof 5)', async () => {
    const created = await asRole('authenticated', U.driverPro, () =>
      createDriverImported(U.driverPro),
    );
    const row = await settlementById(created.id);
    expect(row!.source).toBe('driver_imported');
    expect(row!.status).toBe('draft');
  });

  it('Free and cancelled-Pro recipients cannot create (proof 6)', async () => {
    for (const uid of [U.driverFree, U.driverCancelled]) {
      const before = await settlementCount();
      await asRole('authenticated', uid, async () => {
        expect(await failureMessage(() => createDriverImported(uid))).toContain(
          ERR.driverImport,
        );
      });
      expect(await settlementCount()).toBe(before);
    }
  });

  it('a direct assistant with settlements_manage can create for an active-Pro driver only (proof 7)', async () => {
    const ok = await asRole('authenticated', U.assistant, () =>
      createDriverImported(U.driverPro),
    );
    const row = await settlementById(ok.id);
    expect(row!.driver_user_id).toBe(U.driverPro);
    expect(row!.created_by_user_id).toBe(U.assistant);

    await asRole('authenticated', U.assistant, async () => {
      expect(await failureMessage(() => createDriverImported(U.driverFree))).toContain(
        ERR.driverImport,
      );
    });
    await asRole('authenticated', U.assistantViewOnly, async () => {
      expect(await failureMessage(() => createDriverImported(U.driverPro))).toContain(
        ERR.driverImport,
      );
    });
  });

  it('an agency-generated assistant row cannot use the direct driver-import path (proof 8)', async () => {
    const before = await settlementCount();
    await asRole('authenticated', U.agencyAssistant, async () => {
      expect(await failureMessage(() => createDriverImported(U.driverPro))).toContain(
        ERR.driverImport,
      );
    });
    expect(await settlementCount()).toBe(before);
  });

  it('driver-imported create writes exact identity/lifecycle and one created event (proof 9)', async () => {
    const created = await asRole('authenticated', U.driverPro, () =>
      createDriverImported(
        U.driverPro,
        P1,
        P2,
        '2026-07-15',
        ' REF-9 ',
        '  Some Payer  ',
        '1000.50',
        '812.25',
        '  hello  ',
      ),
    );
    const row = (await settlementById(created.id))!;
    expect(row.source).toBe('driver_imported');
    expect(row.status).toBe('draft');
    expect(row.carrier_recruiter_profile_id).toBeNull();
    expect(row.carrier_driver_relationship_id).toBeNull();
    expect(row.agency_id).toBeNull();
    expect(row.source_display_name_snapshot).toBeNull();
    expect(row.payer_name_snapshot).toBe('Some Payer');
    expect(row.statement_reference).toBe('REF-9');
    expect(row.notes).toBe('hello');
    expect(row.ps).toBe(P1);
    expect(row.pe).toBe(P2);
    expect(row.pd).toBe('2026-07-15');
    expect(String(row.reported_gross_amount)).toBe('1000.50');
    expect(String(row.reported_net_amount)).toBe('812.25');
    expect(row.calculation_version).toBe('1');
    expect(Number(row.version_number)).toBe(1);
    expect(row.supersedes_settlement_id).toBeNull();
    expect(row.created_by_user_id).toBe(U.driverPro);
    expect(row.finalized_by_user_id).toBeNull();
    expect(row.finalized_at).toBeNull();
    expect(row.voided_by_user_id).toBeNull();
    expect(row.voided_at).toBeNull();

    const events = await eventsFor(created.id);
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe('created');
    expect(events[0].actor_user_id).toBe(U.driverPro);
    expect(events[0].metadata).toMatchObject({ source: 'driver_imported' });
  });
});

// =====================================================================
describe('Phase 1T-B2C2A — carrier creation', () => {
  it('requires the exact standalone paid carrier and ACTIVE relationship triple (proof 10)', async () => {
    const before = await settlementCount();
    await asRole('authenticated', U.paidCarrier, async () => {
      // invited / ended relationships
      expect(
        await failureMessage(() =>
          createCarrier(R.paid, RELS.invited, U.invitedDriver),
        ),
      ).toContain(ERR.carrier);
      expect(
        await failureMessage(() => createCarrier(R.paid, RELS.ended, U.endedDriver)),
      ).toContain(ERR.carrier);
      // wrong relationship / wrong driver / wrong recruiter
      expect(
        await failureMessage(() =>
          createCarrier(R.paid, RELS.invited, U.carrierDriver),
        ),
      ).toContain(ERR.carrier);
      expect(
        await failureMessage(() => createCarrier(R.paid, RELS.active, U.driverFree)),
      ).toContain(ERR.carrier);
      expect(
        await failureMessage(() =>
          createCarrier(R.unpaid, RELS.unpaid, U.carrierDriver),
        ),
      ).toContain(ERR.carrier);
    });
    // unpaid owner, agency-included owner, dual-paid conflict owner
    await asRole('authenticated', U.unpaidCarrier, async () => {
      expect(
        await failureMessage(() =>
          createCarrier(R.unpaid, RELS.unpaid, U.carrierDriver),
        ),
      ).toContain(ERR.carrier);
    });
    await asRole('authenticated', U.agencyIncludedCarrier, async () => {
      expect(
        await failureMessage(() =>
          createCarrier(R.agencyIncluded, RELS.agencyIncluded, U.carrierDriver),
        ),
      ).toContain(ERR.carrier);
    });
    await asRole('authenticated', U.dualPaidCarrier, async () => {
      expect(
        await failureMessage(() =>
          createCarrier(R.dualPaid, RELS.dualPaid, U.carrierDriver),
        ),
      ).toContain(ERR.carrier);
    });
    expect(await settlementCount()).toBe(before);
  });

  it('carrier name is server-resolved from recruiter_profiles.company_name (proof 11)', async () => {
    const created = await asRole('authenticated', U.paidCarrier, () =>
      createCarrier(R.paid, RELS.active, U.carrierDriver),
    );
    const row = (await settlementById(created.id))!;
    expect(row.source_display_name_snapshot).toBe(CARRIER_NAME);
    expect(row.payer_name_snapshot).toBe(CARRIER_NAME);

    // The client has no payer/source-name parameter at all on this RPC.
    const args = (
      await db.query<{ a: string }>(
        `SELECT pg_get_function_arguments(p.oid) AS a
           FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
          WHERE ns.nspname='public' AND p.proname='settlement_create_carrier_draft'`,
      )
    ).rows[0].a;
    expect(args).not.toMatch(/payer/i);
    expect(args).not.toMatch(/display_name/i);
    expect(args).not.toMatch(/company/i);
  });

  it('blank or over-long canonical carrier name fails before insert/event (proof 12)', async () => {
    const beforeS = await settlementCount();
    const beforeE = await eventCount();
    await asRole('authenticated', U.blankNameCarrier, async () => {
      expect(
        await failureMessage(() => createCarrier(R.blank, RELS.blank, U.carrierDriver)),
      ).toContain(ERR.carrierName);
    });
    await asRole('authenticated', U.longNameCarrier, async () => {
      expect(
        await failureMessage(() => createCarrier(R.long, RELS.long, U.carrierDriver)),
      ).toContain(ERR.carrierName);
    });
    expect(await settlementCount()).toBe(beforeS);
    expect(await eventCount()).toBe(beforeE);
  });

  it('carrier create snapshots exact recruiter/relationship UUIDs and one created event (proof 13)', async () => {
    const created = await asRole('authenticated', U.paidCarrier, () =>
      createCarrier(R.paid, RELS.active, U.carrierDriver, P1, P2, null, ' C-13 '),
    );
    const row = (await settlementById(created.id))!;
    expect(row.source).toBe('carrier_issued');
    expect(row.status).toBe('draft');
    expect(row.carrier_recruiter_profile_id).toBe(R.paid);
    expect(row.carrier_driver_relationship_id).toBe(RELS.active);
    expect(row.agency_id).toBeNull();
    expect(row.driver_user_id).toBe(U.carrierDriver);
    expect(Number(row.version_number)).toBe(1);
    expect(row.supersedes_settlement_id).toBeNull();
    expect(row.created_by_user_id).toBe(U.paidCarrier);
    expect(row.statement_reference).toBe('C-13');

    const events = await eventsFor(created.id);
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe('created');
    expect(events[0].actor_user_id).toBe(U.paidCarrier);
    expect(events[0].metadata).toStrictEqual({
      source: 'carrier_issued',
      recruiter_id: R.paid,
      relationship_id: RELS.active,
    });
  });
});

// =====================================================================
describe('Phase 1T-B2C2A — agency creation', () => {
  it('succeeds for active / trialing / manual_beta agencies regardless of driver plan (proof 14)', async () => {
    const cases: Array<[string, string]> = [
      [A.paid, U.agencyDriver],
      [A.trial, U.trialDriver],
      [A.beta, U.betaDriver],
    ];
    for (const [aid, drv] of cases) {
      const created = await asRole('authenticated', U.agencyMember, () =>
        createAgency(aid, drv),
      );
      const row = (await settlementById(created.id))!;
      expect(row.source).toBe('agency_prepared');
      expect(row.agency_id).toBe(aid);
      expect(row.carrier_recruiter_profile_id).toBeNull();
      expect(row.carrier_driver_relationship_id).toBeNull();
      expect(row.created_by_user_id).toBe(U.agencyMember);
    }
  });

  it('cancelled entitlement, wrong member, wrong driver, unapproved and string permission all fail (proof 15)', async () => {
    const before = await settlementCount();
    await asRole('authenticated', U.agencyMember, async () => {
      expect(
        await failureMessage(() => createAgency(A.cancelled, U.agencyDriver)),
      ).toContain(ERR.agency);
      // Wrong driver for this delegation.
      expect(await failureMessage(() => createAgency(A.paid, U.driverPro))).toContain(
        ERR.agency,
      );
      // Pending (unapproved) delegation.
      expect(await failureMessage(() => createAgency(A.paid, U.driverFree))).toContain(
        ERR.agency,
      );
      // Permission stored as the string "true" is not boolean true.
      expect(
        await failureMessage(() => createAgency(A.paid, U.stringPermDriver)),
      ).toContain(ERR.agency);
    });
    // A member of no agency, and a stranger.
    for (const uid of [U.otherAgencyMember, U.stranger]) {
      await asRole('authenticated', uid, async () => {
        expect(await failureMessage(() => createAgency(A.paid, U.agencyDriver))).toContain(
          ERR.agency,
        );
      });
    }
    // Inactive agency profile.
    await db.query(`UPDATE public.agency_profiles SET status='disabled' WHERE id=$1`, [
      A.lapse,
    ]);
    await asRole('authenticated', U.agencyMember, async () => {
      expect(
        await failureMessage(() => createAgency(A.lapse, U.agencyLapseDriver)),
      ).toContain(ERR.agency);
    });
    await db.query(`UPDATE public.agency_profiles SET status='active' WHERE id=$1`, [
      A.lapse,
    ]);
    // Revoked membership.
    await db.query(
      `UPDATE public.agency_members SET status='revoked'
        WHERE agency_id=$1 AND member_user_id=$2`,
      [A.lapse, U.agencyMember],
    );
    await asRole('authenticated', U.agencyMember, async () => {
      expect(
        await failureMessage(() => createAgency(A.lapse, U.agencyLapseDriver)),
      ).toContain(ERR.agency);
    });
    await db.query(
      `UPDATE public.agency_members SET status='active'
        WHERE agency_id=$1 AND member_user_id=$2`,
      [A.lapse, U.agencyMember],
    );
    expect(await settlementCount()).toBe(before);
  });

  it('agency source name is server-resolved; caller payer name is separate (proof 16)', async () => {
    const created = await asRole('authenticated', U.agencyMember, () =>
      createAgency(A.paid, U.agencyDriver, P1, P2, null, null, '  Outside Carrier LLC  '),
    );
    const row = (await settlementById(created.id))!;
    expect(row.source_display_name_snapshot).toBe(AGENCY_NAME);
    expect(row.payer_name_snapshot).toBe('Outside Carrier LLC');

    const events = await eventsFor(created.id);
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe('created');
    expect(events[0].metadata).toStrictEqual({
      source: 'agency_prepared',
      agency_id: A.paid,
    });
  });

  it('blank or over-long canonical agency name fails with a fixed error (proof 17)', async () => {
    const beforeS = await settlementCount();
    const beforeE = await eventCount();
    await asRole('authenticated', U.agencyMember, async () => {
      expect(
        await failureMessage(() => createAgency(A.blank, U.blankAgencyDriver)),
      ).toContain(ERR.agencyName);
      expect(
        await failureMessage(() => createAgency(A.long, U.longAgencyDriver)),
      ).toContain(ERR.agencyName);
    });
    expect(await settlementCount()).toBe(beforeS);
    expect(await eventCount()).toBe(beforeE);
  });
});

// =====================================================================
describe('Phase 1T-B2C2A — validation and normalization', () => {
  it('every create rejects bad periods, amounts and over-long text (proof 18)', async () => {
    const beforeS = await settlementCount();
    const beforeE = await eventCount();
    const longRef = 'r'.repeat(201);
    const longNotes = 'n'.repeat(5001);

    await asRole('authenticated', U.driverPro, async () => {
      expect(
        await failureMessage(() => createDriverImported(U.driverPro, P2, P1)),
      ).toContain(ERR.period);
      expect(
        await failureMessage(() => createDriverImported(U.driverPro, null, P2)),
      ).toContain(ERR.period);
      expect(
        await failureMessage(() => createDriverImported(U.driverPro, P1, null)),
      ).toContain(ERR.period);
      expect(
        await failureMessage(() =>
          createDriverImported(U.driverPro, P1, P2, null, null, null, '-1'),
        ),
      ).toContain(ERR.amount);
      expect(
        await failureMessage(() =>
          createDriverImported(U.driverPro, P1, P2, null, null, null, '1000000000000'),
        ),
      ).toContain(ERR.amount);
      expect(
        await failureMessage(() =>
          createDriverImported(
            U.driverPro,
            P1,
            P2,
            null,
            null,
            null,
            null,
            '-1000000000000',
          ),
        ),
      ).toContain(ERR.amount);
      expect(
        await failureMessage(() =>
          createDriverImported(U.driverPro, P1, P2, null, longRef),
        ),
      ).toContain(ERR.tooLong);
      expect(
        await failureMessage(() =>
          createDriverImported(U.driverPro, P1, P2, null, null, LONG_NAME),
        ),
      ).toContain(ERR.tooLong);
      expect(
        await failureMessage(() =>
          createDriverImported(
            U.driverPro,
            P1,
            P2,
            null,
            null,
            null,
            null,
            null,
            longNotes,
          ),
        ),
      ).toContain(ERR.tooLong);
    });

    await asRole('authenticated', U.paidCarrier, async () => {
      expect(
        await failureMessage(() =>
          createCarrier(R.paid, RELS.active, U.carrierDriver, P2, P1),
        ),
      ).toContain(ERR.period);
      expect(
        await failureMessage(() =>
          createCarrier(R.paid, RELS.active, U.carrierDriver, P1, P2, null, longRef),
        ),
      ).toContain(ERR.tooLong);
      expect(
        await failureMessage(() =>
          createCarrier(R.paid, RELS.active, U.carrierDriver, P1, P2, null, null, '-5'),
        ),
      ).toContain(ERR.amount);
    });

    await asRole('authenticated', U.agencyMember, async () => {
      expect(
        await failureMessage(() => createAgency(A.paid, U.agencyDriver, P2, P1)),
      ).toContain(ERR.period);
      expect(
        await failureMessage(() =>
          createAgency(A.paid, U.agencyDriver, P1, P2, null, null, LONG_NAME),
        ),
      ).toContain(ERR.tooLong);
      expect(
        await failureMessage(() =>
          createAgency(A.paid, U.agencyDriver, P1, P2, null, null, null, '-5'),
        ),
      ).toContain(ERR.amount);
    });

    expect(await settlementCount()).toBe(beforeS);
    expect(await eventCount()).toBe(beforeE);
  });

  it('blank caller text normalizes to NULL wherever it is caller-controlled (proof 19)', async () => {
    const d = await asRole('authenticated', U.driverPro, () =>
      createDriverImported(U.driverPro, P1, P2, null, '   ', '  ', null, null, ' \t '),
    );
    const dRow = (await settlementById(d.id))!;
    expect(dRow.statement_reference).toBeNull();
    expect(dRow.payer_name_snapshot).toBeNull();
    expect(dRow.notes).toBeNull();

    const c = await asRole('authenticated', U.paidCarrier, () =>
      createCarrier(R.paid, RELS.active, U.carrierDriver, P1, P2, null, '  ', null, null, '  '),
    );
    const cRow = (await settlementById(c.id))!;
    expect(cRow.statement_reference).toBeNull();
    expect(cRow.notes).toBeNull();
    // The server-resolved carrier name is never blanked by caller input.
    expect(cRow.payer_name_snapshot).toBe(CARRIER_NAME);

    const a = await asRole('authenticated', U.agencyMember, () =>
      createAgency(A.paid, U.agencyDriver, P1, P2, null, '  ', '   ', null, null, '  '),
    );
    const aRow = (await settlementById(a.id))!;
    expect(aRow.statement_reference).toBeNull();
    expect(aRow.payer_name_snapshot).toBeNull();
    expect(aRow.notes).toBeNull();
    expect(aRow.source_display_name_snapshot).toBe(AGENCY_NAME);
  });

  it('fixed errors never leak constraint, SQLSTATE or schema detail (proof 36)', async () => {
    const msgs: string[] = [];
    await asRole('authenticated', U.driverPro, async () => {
      msgs.push(await failureMessage(() => createDriverImported(U.driverPro, P2, P1)));
      msgs.push(await failureMessage(() => createDriverImported(null)));
      msgs.push(
        await failureMessage(() => createCarrier(R.paid, RELS.active, U.carrierDriver)),
      );
      msgs.push(await failureMessage(() => createAgency(A.paid, U.agencyDriver)));
      msgs.push(
        await failureMessage(() => updateHeader('00000000-0000-4000-8000-000000000000')),
      );
    });
    const allowed = Object.values(ERR) as string[];
    for (const m of msgs) {
      expect(allowed).toContain(m);
      expect(m).not.toMatch(LEAK);
    }
  });
});

// =====================================================================
describe('Phase 1T-B2C2A — draft header update', () => {
  it('locks and edits only a draft; non-draft statuses are rejected (proofs 20, 21)', async () => {
    const created = await asRole('authenticated', U.driverPro, () =>
      createDriverImported(U.driverPro),
    );
    // Draft edit works.
    await asRole('authenticated', U.driverPro, () =>
      updateHeader(created.id, P1, P2, '2026-07-20'),
    );
    expect((await settlementById(created.id))!.pd).toBe('2026-07-20');

    for (const status of ['finalized', 'voided', 'superseded']) {
      await db.query(`UPDATE public.driver_settlements SET status=$2 WHERE id=$1`, [
        created.id,
        status,
      ]);
      await asRole('authenticated', U.driverPro, async () => {
        expect(await failureMessage(() => updateHeader(created.id))).toContain(
          ERR.notEditable,
        );
      });
    }
    await db.query(`UPDATE public.driver_settlements SET status='draft' WHERE id=$1`, [
      created.id,
    ]);

    await asRole('authenticated', U.driverPro, async () => {
      expect(
        await failureMessage(() => updateHeader('00000000-0000-4000-8000-000000000000')),
      ).toContain(ERR.notFound);
    });
  });

  it('driver_imported update requires current Pro or a direct manage assistant (proof 22)', async () => {
    const created = await asRole('authenticated', U.driverPro, () =>
      createDriverImported(U.driverPro),
    );
    // Direct assistant may edit while the target holds Pro.
    await asRole('authenticated', U.assistant, () =>
      updateHeader(created.id, P1, P2, null, 'by-assistant'),
    );
    expect((await settlementById(created.id))!.statement_reference).toBe('by-assistant');

    // Downgrade: historical read remains, editing does not.
    await db.query(`UPDATE public.subscriptions SET status='canceled' WHERE user_id=$1`, [
      U.driverPro,
    ]);
    for (const uid of [U.driverPro, U.assistant]) {
      await asRole('authenticated', uid, async () => {
        expect(await failureMessage(() => updateHeader(created.id))).toContain(
          ERR.driverImport,
        );
      });
    }
    expect((await settlementById(created.id))!.statement_reference).toBe('by-assistant');
    await db.query(`UPDATE public.subscriptions SET status='active' WHERE user_id=$1`, [
      U.driverPro,
    ]);
  });

  it('carrier update requires current paid billing and the same active relationship (proofs 23, 25)', async () => {
    const created = await asRole('authenticated', U.lapseCarrier, () =>
      createCarrier(R.lapse, RELS.lapse, U.lapseDriver),
    );
    const original = (await settlementById(created.id))!;
    expect(original.payer_name_snapshot).toBe('Lapsing Carrier Co');

    // A generic header update can never rewrite the carrier payer identity.
    await asRole('authenticated', U.lapseCarrier, () =>
      updateHeader(created.id, P1, P2, null, 'C-25', 'Attacker Payer Name'),
    );
    const afterEdit = (await settlementById(created.id))!;
    expect(afterEdit.payer_name_snapshot).toBe('Lapsing Carrier Co');
    expect(afterEdit.source_display_name_snapshot).toBe('Lapsing Carrier Co');
    expect(afterEdit.statement_reference).toBe('C-25');

    // Relationship ends -> read-only.
    await db.query(
      `UPDATE public.carrier_driver_relationships SET status='ended' WHERE id=$1`,
      [RELS.lapse],
    );
    await asRole('authenticated', U.lapseCarrier, async () => {
      expect(await failureMessage(() => updateHeader(created.id))).toContain(
        ERR.carrier,
      );
    });
    await db.query(
      `UPDATE public.carrier_driver_relationships SET status='active' WHERE id=$1`,
      [RELS.lapse],
    );

    // Billing lapses -> read-only.
    await db.query(
      `UPDATE public.recruiter_billing_profiles SET status='canceled' WHERE recruiter_id=$1`,
      [R.lapse],
    );
    await asRole('authenticated', U.lapseCarrier, async () => {
      expect(await failureMessage(() => updateHeader(created.id))).toContain(
        ERR.carrier,
      );
    });
    await db.query(
      `UPDATE public.recruiter_billing_profiles SET status='active' WHERE recruiter_id=$1`,
      [R.lapse],
    );
  });

  it('agency update requires a current eligible agency and approved manage delegation (proof 24)', async () => {
    const created = await asRole('authenticated', U.agencyMember, () =>
      createAgency(A.lapse, U.agencyLapseDriver),
    );

    await db.query(
      `UPDATE public.agency_entitlements SET status='cancelled' WHERE agency_id=$1`,
      [A.lapse],
    );
    await asRole('authenticated', U.agencyMember, async () => {
      expect(await failureMessage(() => updateHeader(created.id))).toContain(ERR.agency);
    });
    await db.query(
      `UPDATE public.agency_entitlements SET status='active' WHERE agency_id=$1`,
      [A.lapse],
    );

    await db.query(
      `UPDATE public.agency_delegation_requests SET status='revoked'
        WHERE agency_id=$1 AND driver_user_id=$2`,
      [A.lapse, U.agencyLapseDriver],
    );
    await asRole('authenticated', U.agencyMember, async () => {
      expect(await failureMessage(() => updateHeader(created.id))).toContain(ERR.agency);
    });
    await db.query(
      `UPDATE public.agency_delegation_requests SET status='approved'
        WHERE agency_id=$1 AND driver_user_id=$2`,
      [A.lapse, U.agencyLapseDriver],
    );

    // Restored authorization edits again.
    await asRole('authenticated', U.agencyMember, () =>
      updateHeader(created.id, P1, P2, null, 'A-24'),
    );
    expect((await settlementById(created.id))!.statement_reference).toBe('A-24');
  });

  it('driver_imported and agency_prepared payer names are caller-updatable (proof 26)', async () => {
    const d = await asRole('authenticated', U.driverPro, () =>
      createDriverImported(U.driverPro, P1, P2, null, null, 'Old Payer'),
    );
    await asRole('authenticated', U.driverPro, () =>
      updateHeader(d.id, P1, P2, null, null, '  New Payer  '),
    );
    expect((await settlementById(d.id))!.payer_name_snapshot).toBe('New Payer');

    const a = await asRole('authenticated', U.agencyMember, () =>
      createAgency(A.paid, U.agencyDriver, P1, P2, null, null, 'Old Agency Payer'),
    );
    await asRole('authenticated', U.agencyMember, () =>
      updateHeader(a.id, P1, P2, null, null, 'New Agency Payer'),
    );
    const aRow = (await settlementById(a.id))!;
    expect(aRow.payer_name_snapshot).toBe('New Agency Payer');
    expect(aRow.source_display_name_snapshot).toBe(AGENCY_NAME);
  });

  it('update preserves every immutable identity/provenance field (proof 27)', async () => {
    const created = await asRole('authenticated', U.paidCarrier, () =>
      createCarrier(R.paid, RELS.active, U.carrierDriver),
    );
    const before = (await settlementById(created.id))!;
    await asRole('authenticated', U.paidCarrier, () =>
      updateHeader(created.id, '2026-08-01', '2026-08-07', '2026-08-12', 'X', 'Y', '5', '4', 'z'),
    );
    const after = (await settlementById(created.id))!;

    for (const k of [
      'id',
      'driver_user_id',
      'source',
      'status',
      'carrier_recruiter_profile_id',
      'carrier_driver_relationship_id',
      'agency_id',
      'source_display_name_snapshot',
      'payer_name_snapshot',
      'calculation_version',
      'version_number',
      'supersedes_settlement_id',
      'created_by_user_id',
      'finalized_by_user_id',
      'finalized_at',
      'voided_by_user_id',
      'voided_at',
      'created_at',
    ] as const) {
      expect(`${k}:${String(after[k])}`).toBe(`${k}:${String(before[k])}`);
    }
    // Mutable fields did change.
    expect(after.ps).toBe('2026-08-01');
    expect(after.pe).toBe('2026-08-07');
    expect(after.pd).toBe('2026-08-12');
    expect(after.statement_reference).toBe('X');
    expect(String(after.reported_gross_amount)).toBe('5.00');
    expect(String(after.reported_net_amount)).toBe('4.00');
    expect(after.notes).toBe('z');
  });

  it('a successful update writes exactly one updated event with actor and source (proof 28)', async () => {
    const created = await asRole('authenticated', U.agencyMember, () =>
      createAgency(A.paid, U.agencyDriver),
    );
    await asRole('authenticated', U.agencyMember, () =>
      updateHeader(created.id, P1, P2, null, 'ev-28'),
    );
    const events = await eventsFor(created.id);
    expect(events.map((e) => e.event_type)).toEqual(['created', 'updated']);
    const updated = events[1];
    expect(updated.actor_user_id).toBe(U.agencyMember);
    expect(updated.metadata).toStrictEqual({ source: 'agency_prepared' });
  });

  it('a failed update writes no event and changes nothing (proof 29)', async () => {
    const created = await asRole('authenticated', U.driverPro, () =>
      createDriverImported(U.driverPro, P1, P2, null, 'keep-me'),
    );
    const before = (await settlementById(created.id))!;
    const beforeEvents = (await eventsFor(created.id)).length;

    await asRole('authenticated', U.driverPro, async () => {
      expect(await failureMessage(() => updateHeader(created.id, P2, P1))).toContain(
        ERR.period,
      );
      expect(
        await failureMessage(() =>
          updateHeader(created.id, P1, P2, null, null, null, '-9'),
        ),
      ).toContain(ERR.amount);
      expect(
        await failureMessage(() =>
          updateHeader(created.id, P1, P2, null, 'r'.repeat(201)),
        ),
      ).toContain(ERR.tooLong);
    });

    const after = (await settlementById(created.id))!;
    expect(after.statement_reference).toBe('keep-me');
    expect(String(after.updated_at)).toBe(String(before.updated_at));
    expect((await eventsFor(created.id)).length).toBe(beforeEvents);
  });

  it('an unknown stored source fails closed on update (proof 20b)', async () => {
    const created = await asRole('authenticated', U.driverPro, () =>
      createDriverImported(U.driverPro),
    );
    // Harness-only: force a malformed runtime source the CHECKs normally prevent.
    await db.exec(
      `ALTER TABLE public.driver_settlements
         DROP CONSTRAINT driver_settlements_source_check;
       ALTER TABLE public.driver_settlements
         DROP CONSTRAINT driver_settlements_source_identity_check;`,
    );
    await db.query(`UPDATE public.driver_settlements SET source='bogus' WHERE id=$1`, [
      created.id,
    ]);
    await asRole('authenticated', U.driverPro, async () => {
      expect(await failureMessage(() => updateHeader(created.id))).toContain(
        ERR.invalidSource,
      );
    });
    await db.query(
      `UPDATE public.driver_settlements SET source='driver_imported' WHERE id=$1`,
      [created.id],
    );
    await db.exec(
      `ALTER TABLE public.driver_settlements
         ADD CONSTRAINT driver_settlements_source_check
         CHECK (source IN ('carrier_issued', 'agency_prepared', 'driver_imported'));
       ALTER TABLE public.driver_settlements
         ADD CONSTRAINT driver_settlements_source_identity_check
         CHECK (
           (source = 'carrier_issued'
             AND carrier_recruiter_profile_id IS NOT NULL
             AND carrier_driver_relationship_id IS NOT NULL
             AND agency_id IS NULL
             AND source_display_name_snapshot IS NOT NULL
             AND length(btrim(source_display_name_snapshot, E' \\t\\r\\n')) > 0)
           OR (source = 'agency_prepared'
             AND agency_id IS NOT NULL
             AND carrier_recruiter_profile_id IS NULL
             AND carrier_driver_relationship_id IS NULL
             AND source_display_name_snapshot IS NOT NULL
             AND length(btrim(source_display_name_snapshot, E' \\t\\r\\n')) > 0)
           OR (source = 'driver_imported'
             AND carrier_recruiter_profile_id IS NULL
             AND carrier_driver_relationship_id IS NULL
             AND agency_id IS NULL)
         );`,
    );

  });

  it('strangers, other carriers, other agencies and unprivileged assistants cannot create or update (proof 30)', async () => {
    const driverDraft = await asRole('authenticated', U.driverPro, () =>
      createDriverImported(U.driverPro),
    );
    const carrierDraft = await asRole('authenticated', U.paidCarrier, () =>
      createCarrier(R.paid, RELS.active, U.carrierDriver),
    );
    const agencyDraft = await asRole('authenticated', U.agencyMember, () =>
      createAgency(A.paid, U.agencyDriver),
    );

    for (const uid of [U.stranger, U.unpaidCarrier, U.otherAgencyMember]) {
      await asRole('authenticated', uid, async () => {
        expect(await failureMessage(() => updateHeader(driverDraft.id))).toContain(
          ERR.driverImport,
        );
        expect(await failureMessage(() => updateHeader(carrierDraft.id))).toContain(
          ERR.carrier,
        );
        expect(await failureMessage(() => updateHeader(agencyDraft.id))).toContain(
          ERR.agency,
        );
      });
    }
    await asRole('authenticated', U.assistantViewOnly, async () => {
      expect(await failureMessage(() => updateHeader(driverDraft.id))).toContain(
        ERR.driverImport,
      );
    });
    await asRole('authenticated', U.agencyAssistant, async () => {
      expect(await failureMessage(() => updateHeader(driverDraft.id))).toContain(
        ERR.driverImport,
      );
    });
  });

  it('direct client writes to settlements and events stay blocked by B2B RLS (proof 31)', async () => {
    const created = await asRole('authenticated', U.driverPro, () =>
      createDriverImported(U.driverPro),
    );

    await asRole('authenticated', U.driverPro, async () => {
      const insertSettlement = await failureMessage(() =>
        db.query(
          `INSERT INTO public.driver_settlements
             (driver_user_id, source, status, period_start, period_end, created_by_user_id)
           VALUES ($1,'driver_imported','draft',$2::date,$3::date,$1)`,
          [U.driverPro, P1, P2],
        ),
      );
      expect(insertSettlement).toMatch(/row-level security/i);

      const insertEvent = await failureMessage(() =>
        db.query(
          `INSERT INTO public.driver_settlement_events (settlement_id, actor_user_id, event_type)
           VALUES ($1,$2,'updated')`,
          [created.id, U.driverPro],
        ),
      );
      expect(insertEvent).toMatch(/row-level security/i);

      const upd = await db.query(
        `UPDATE public.driver_settlements SET status='finalized' WHERE id=$1`,
        [created.id],
      );
      expect(upd.affectedRows ?? 0).toBe(0);

      const delEvents = await db.query(
        `DELETE FROM public.driver_settlement_events WHERE settlement_id=$1`,
        [created.id],
      );
      expect(delEvents.affectedRows ?? 0).toBe(0);

      const del = await db.query(`DELETE FROM public.driver_settlements WHERE id=$1`, [
        created.id,
      ]);
      expect(del.affectedRows ?? 0).toBe(0);
    });

    const still = (await settlementById(created.id))!;
    expect(still.status).toBe('draft');
    expect((await eventsFor(created.id)).length).toBe(1);
  });
});

// =====================================================================
describe('Phase 1T-B2C2A — source contract', () => {
  it('header, single transaction, exactly four CREATE FUNCTION, no prohibited statements (proof 32)', () => {
    expect(B2C2A_SQL.split('\n')[0]).toBe('-- CANDIDATE MIGRATION — NOT APPLIED LIVE.');
    expect(B2C2A_SQL).toContain('Phase 1T-B2C2A');
    expect(CODE.match(/^BEGIN;$/gm)?.length).toBe(1);
    expect(CODE.match(/^COMMIT;$/gm)?.length).toBe(1);
    expect(CODE.match(/CREATE FUNCTION/g)?.length).toBe(4);
    for (const fn of FUNCTIONS) {
      expect(CODE).toContain(`CREATE FUNCTION public.${fn}(`);
    }
    expect(CODE.match(/LANGUAGE plpgsql/g)?.length).toBe(4);
    expect(CODE.match(/SECURITY DEFINER/g)?.length).toBe(4);
    expect(CODE.match(/SET search_path = pg_catalog, public, auth/g)?.length).toBe(4);
    expect(CODE.match(/RETURNS public\.driver_settlements/g)?.length).toBe(4);
    expect(CODE.match(/v_actor uuid := auth\.uid\(\);/g)?.length).toBe(4);

    const forbidden: RegExp[] = [
      /CREATE\s+OR\s+REPLACE/i,
      /(CREATE|ALTER|DROP)[^\n]*IF\s+NOT\s+EXISTS/i,
      /\bDROP\b/i,
      /\bEXECUTE\s+(format|'|")/i,
      /\bemail\b/i,
      /service_role\s*(=|IN|:)/i,
      /current_setting\s*\(/i,
      /is_admin|super_admin|bypass/i,
      /CREATE\s+(TABLE|INDEX|TYPE|VIEW|TRIGGER|POLICY|SCHEMA)\b/i,
      /ALTER\s+TABLE/i,
      /\bDELETE\s+FROM\b/i,
      /GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i,
      /\bfinalized_at\s*=\s*now\(\)/i,
      /event_type[^\n]*'(finalized|voided|superseded|exported|match_confirmed)'/i,
    ];
    for (const re of forbidden) {
      expect(`${re}:${re.test(CODE)}`).toBe(`${re}:false`);
    }
    expect(CODE.match(/^GRANT EXECUTE ON FUNCTION /gm)?.length).toBe(4);
    expect(CODE.match(/^REVOKE ALL ON FUNCTION /gm)?.length).toBe(4);
    expect(CODE.match(/FROM PUBLIC, anon;/g)?.length).toBe(4);
    expect(CODE.match(/TO authenticated, service_role;/g)?.length).toBe(4);
  });

  it('business display names are SELECTed server-side, never parameters (proof 33)', () => {
    expect(CODE).toContain('FROM public.recruiter_profiles rp');
    expect(CODE).toContain('rp.company_name');
    expect(CODE).toContain('FROM public.agency_profiles ap');
    expect(CODE).toContain('ap.name');
    // No function signature accepts a source display name.
    expect(CODE).not.toMatch(/\b_source_display_name_snapshot\b/);
    expect(CODE).not.toMatch(/\b_company_name\b/);
    expect(CODE).not.toMatch(/\b_agency_name\b/);
    // The carrier RPC has no payer parameter at all.
    const carrierSig = CODE.slice(
      CODE.indexOf('CREATE FUNCTION public.settlement_create_carrier_draft('),
      CODE.indexOf('RETURNS public.driver_settlements', CODE.indexOf(
        'CREATE FUNCTION public.settlement_create_carrier_draft(',
      )),
    );
    expect(carrierSig).not.toMatch(/\b_payer_name_snapshot\b/);
  });

  it('creates hard-code identity and the update never touches immutable columns (proof 34)', () => {
    expect(CODE.match(/'driver_imported',\n\s*'draft',/g)?.length).toBe(1);
    expect(CODE.match(/'carrier_issued',\n\s*'draft',/g)?.length).toBe(1);
    expect(CODE.match(/'agency_prepared',\n\s*'draft',/g)?.length).toBe(1);
    // calculation_version '1' and version_number 1, three times (one per create).
    expect(CODE.match(/^\s*'1',\n\s*1,\n\s*NULL,\n\s*v_actor,/gm)?.length).toBe(3);

    const updateBody = CODE.slice(
      CODE.indexOf('CREATE FUNCTION public.settlement_update_draft_header('),
    );
    const setBlock = updateBody.slice(
      updateBody.indexOf('UPDATE public.driver_settlements ds'),
      updateBody.indexOf('RETURNING * INTO v_row'),
    );
    const assigned = [...setBlock.matchAll(/^\s*(?:SET )?([a-z_]+) =/gm)].map(
      (m) => m[1],
    );
    expect(assigned.sort()).toEqual(
      [
        'notes',
        'pay_date',
        'payer_name_snapshot',
        'period_end',
        'period_start',
        'reported_gross_amount',
        'reported_net_amount',
        'statement_reference',
        'updated_at',
      ].sort(),
    );
    expect(updateBody).toContain('FOR UPDATE');
    expect(updateBody).toContain("RAISE EXCEPTION 'settlement_invalid_source'");
  });

  it('creates emit created events and the update emits an updated event (proof 35)', () => {
    expect(
      CODE.match(/INSERT INTO public\.driver_settlement_events/g)?.length,
    ).toBe(4);
    expect(CODE.match(/^\s*'created',$/gm)?.length).toBe(3);
    expect(CODE.match(/^\s*'updated',$/gm)?.length).toBe(1);
    expect(CODE.match(/INSERT INTO public\.driver_settlements \(/g)?.length).toBe(3);
    expect(
      CODE.match(/actor_user_id, event_type, metadata/g)?.length,
    ).toBe(4);
  });
});

// =====================================================================
// Phase 1T-B2C3A-R1 — finite reported-amount contract in the header RPCs
// =====================================================================
describe('Phase 1T-B2C3A-R1 — header RPCs reject non-finite reported amounts', () => {
  const SPECIALS = ['NaN', 'Infinity', '-Infinity'] as const;

  it('every create path rejects special gross and net with the fixed amount error and writes nothing', async () => {
    const beforeSettlements = await settlementCount();
    const beforeEvents = await eventCount();

    for (const v of SPECIALS) {
      await asRole('authenticated', U.driverPro, async () => {
        expect(
          await failureMessage(() =>
            createDriverImported(U.driverPro, P1, P2, null, null, null, v, null),
          ),
          `driver gross ${v}`,
        ).toContain(ERR.amount);
        expect(
          await failureMessage(() =>
            createDriverImported(U.driverPro, P1, P2, null, null, null, null, v),
          ),
          `driver net ${v}`,
        ).toContain(ERR.amount);
      });

      await asRole('authenticated', U.paidCarrier, async () => {
        expect(
          await failureMessage(() =>
            createCarrier(R.paid, RELS.active, U.carrierDriver, P1, P2, null, null, v, null),
          ),
          `carrier gross ${v}`,
        ).toContain(ERR.amount);
        expect(
          await failureMessage(() =>
            createCarrier(R.paid, RELS.active, U.carrierDriver, P1, P2, null, null, null, v),
          ),
          `carrier net ${v}`,
        ).toContain(ERR.amount);
      });

      await asRole('authenticated', U.agencyMember, async () => {
        expect(
          await failureMessage(() =>
            createAgency(A.paid, U.agencyDriver, P1, P2, null, null, null, v, null),
          ),
          `agency gross ${v}`,
        ).toContain(ERR.amount);
        expect(
          await failureMessage(() =>
            createAgency(A.paid, U.agencyDriver, P1, P2, null, null, null, null, v),
          ),
          `agency net ${v}`,
        ).toContain(ERR.amount);
      });
    }

    expect(await settlementCount()).toBe(beforeSettlements);
    expect(await eventCount()).toBe(beforeEvents);
  });

  it('the generic update path rejects special gross and net and leaves the row and events untouched', async () => {
    const created = await asRole('authenticated', U.driverPro, () =>
      createDriverImported(U.driverPro, P1, P2, null, 'ref-finite', null, '100.00', '90.00'),
    );
    const before = (await settlementById(created.id))!;
    const beforeEvents = await eventsFor(created.id);

    for (const v of SPECIALS) {
      await asRole('authenticated', U.driverPro, async () => {
        expect(
          await failureMessage(() =>
            updateHeader(created.id, P1, P2, null, 'ref-finite', null, v, null),
          ),
          `update gross ${v}`,
        ).toContain(ERR.amount);
        expect(
          await failureMessage(() =>
            updateHeader(created.id, P1, P2, null, 'ref-finite', null, null, v),
          ),
          `update net ${v}`,
        ).toContain(ERR.amount);
      });
    }

    const after = (await settlementById(created.id))!;
    expect(after.reported_gross_amount).toStrictEqual(before.reported_gross_amount);
    expect(after.reported_net_amount).toStrictEqual(before.reported_net_amount);
    expect(after.statement_reference).toBe('ref-finite');
    expect(await eventsFor(created.id)).toHaveLength(beforeEvents.length);
  });

  it('finite signed values still persist through create and update', async () => {
    const created = await asRole('authenticated', U.driverPro, () =>
      createDriverImported(U.driverPro, P1, P2, null, null, null, '0', '-125.50'),
    );
    const row = (await settlementById(created.id))!;
    expect(String(row.reported_gross_amount)).toBe('0.00');
    expect(String(row.reported_net_amount)).toBe('-125.50');

    await asRole('authenticated', U.driverPro, () =>
      updateHeader(created.id, P1, P2, null, null, null, '10.25', '9.75'),
    );
    const updated = (await settlementById(created.id))!;
    expect(String(updated.reported_gross_amount)).toBe('10.25');
    expect(String(updated.reported_net_amount)).toBe('9.75');
  });

  it('special-value errors never leak constraint, SQLSTATE or numeric-overflow detail', async () => {
    const msgs: string[] = [];
    await asRole('authenticated', U.driverPro, async () => {
      for (const v of SPECIALS) {
        msgs.push(
          await failureMessage(() =>
            createDriverImported(U.driverPro, P1, P2, null, null, null, v, null),
          ),
        );
        msgs.push(
          await failureMessage(() =>
            createDriverImported(U.driverPro, P1, P2, null, null, null, null, v),
          ),
        );
      }
    });
    expect(msgs).toHaveLength(6);
    for (const m of msgs) {
      expect(m).toContain(ERR.amount);
      expect(m).not.toMatch(/overflow|constraint|violates|22P02|22003|driver_settlements_/i);
    }
  });

  it('source contract: all four RPC bodies carry explicit finite guards for both reported inputs (proof R1)', () => {
    const bodies = CANDIDATE_SQL.split(/CREATE FUNCTION public\./).slice(1);
    expect(bodies).toHaveLength(4);
    for (const body of bodies) {
      const name = body.slice(0, body.indexOf('('));
      expect(
        body,
        `${name} gross finite guard`,
      ).toMatch(
        /_reported_gross_amount::text IN \('NaN', 'Infinity', '-Infinity'\)/,
      );
      expect(
        body,
        `${name} net finite guard`,
      ).toMatch(
        /_reported_net_amount::text IN \('NaN', 'Infinity', '-Infinity'\)/,
      );
      // existing bounds preserved
      expect(body, `${name} gross bounds`).toMatch(/_reported_gross_amount < 0/);
      expect(body, `${name} net bounds`).toMatch(/_reported_net_amount < -999999999999\.99/);
    }
    // no helper function, dynamic SQL, float coercion or isfinite() shortcut
    expect(CANDIDATE_SQL).not.toMatch(/isfinite/i);
    expect(CANDIDATE_SQL).not.toMatch(/::\s*(float|double precision|real)/i);
  });
});
