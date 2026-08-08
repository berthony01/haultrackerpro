// @vitest-environment node
// =====================================================================
// Phase 1T-B2C3A — Controlled DRAFT settlement line-item CRUD RPC proofs.
//
// Applies, in order, the REAL accepted Phase 1T-B1, B2A, B2B, B2C1 and
// B2C2A candidates and the REAL Phase 1T-B2C3A candidate inside PGlite on a
// minimal but faithful bootstrap that includes the canonical production
// naming columns (recruiter_profiles.company_name, agency_profiles.name),
// then proves catalog shape, ACLs, source-specific CURRENT authorization,
// the exact item input/shape contract, reported-amount preservation (no
// recalculation), expected_amount_snapshot immutability, event emission, and
// that direct client writes stay blocked by the B2B read-only RLS contract.
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
  b2c3a:
    '../../supabase/migration-candidates/20260808173500_phase1t_b2c3a_settlement_item_rpcs.sql',
} as const;

const read = (rel: string) =>
  fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const B1_SQL = read(REL.b1);
const B2A_SQL = read(REL.b2a);
const B2B_SQL = read(REL.b2b);
const B2C1_SQL = read(REL.b2c1);
const B2C2A_SQL = read(REL.b2c2a);
const B2C3A_SQL = read(REL.b2c3a);

/** Executable SQL only: `--` documentation lines removed. */
const CODE = B2C3A_SQL.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const FUNCTIONS = [
  'settlement_add_draft_item',
  'settlement_delete_draft_item',
  'settlement_update_draft_item',
] as const;

const ERR = {
  invalid: 'settlement_invalid_request',
  notFound: 'settlement_not_found',
  notEditable: 'settlement_not_editable',
  invalidSource: 'settlement_invalid_source',
  driverImport: 'settlement_driver_import_not_authorized',
  carrier: 'settlement_carrier_not_authorized',
  agency: 'settlement_agency_not_authorized',
  itemNotFound: 'settlement_item_not_found',
  itemType: 'settlement_invalid_item_type',
  itemAmount: 'settlement_invalid_item_amount',
  itemTextLong: 'settlement_item_text_too_long',
  itemNumeric: 'settlement_invalid_item_numeric',
  itemDates: 'settlement_invalid_item_dates',
  sortOrder: 'settlement_invalid_sort_order',
  payMethod: 'settlement_invalid_pay_method',
  payShape: 'settlement_invalid_pay_shape',
  itemShape: 'settlement_invalid_item_shape',
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

interface ItemRow {
  id: string;
  settlement_id: string;
  item_type: string;
  category: string | null;
  description: string | null;
  amount: string;
  pay_method: string | null;
  quantity: string | null;
  rate: string | null;
  unit_label: string | null;
  expected_amount_snapshot: string | null;
  load_reference_snapshot: string | null;
  pickup: string | null;
  delivery: string | null;
  origin_snapshot: string | null;
  destination_snapshot: string | null;
  loaded_miles_snapshot: string | null;
  deadhead_miles_snapshot: string | null;
  payable_miles_snapshot: string | null;
  eligible_revenue_snapshot: string | null;
  sort_order: number;
  created_by_user_id: string;
  created_at: unknown;
  updated_at: unknown;
}

interface EventRow {
  id: string;
  settlement_id: string;
  actor_user_id: string | null;
  event_type: string;
  metadata: Record<string, unknown>;
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

const ADD_SQL = `SELECT * FROM public.settlement_add_draft_item(
  $1::uuid, $2::text, $3::text, $4::text, $5::numeric, $6::text, $7::numeric, $8::numeric,
  $9::text, $10::text, $11::date, $12::date, $13::text, $14::text,
  $15::numeric, $16::numeric, $17::numeric, $18::numeric, $19::integer)`;

const UPDATE_SQL = `SELECT * FROM public.settlement_update_draft_item(
  $1::uuid, $2::text, $3::text, $4::text, $5::numeric, $6::text, $7::numeric, $8::numeric,
  $9::text, $10::text, $11::date, $12::date, $13::text, $14::text,
  $15::numeric, $16::numeric, $17::numeric, $18::numeric, $19::integer)`;

const DELETE_SQL = `SELECT public.settlement_delete_draft_item($1::uuid) AS id`;

interface ItemInput {
  itemType?: string | null;
  category?: string | null;
  description?: string | null;
  amount?: string | null;
  payMethod?: string | null;
  quantity?: string | null;
  rate?: string | null;
  unitLabel?: string | null;
  loadRef?: string | null;
  pickup?: string | null;
  delivery?: string | null;
  origin?: string | null;
  destination?: string | null;
  loadedMiles?: string | null;
  deadheadMiles?: string | null;
  payableMiles?: string | null;
  eligibleRevenue?: string | null;
  sortOrder?: number | null;
}

function params(target: string | null, i: ItemInput): unknown[] {
  return [
    target,
    i.itemType === undefined ? 'earning' : i.itemType,
    i.category ?? null,
    i.description ?? null,
    i.amount === undefined ? '100.00' : i.amount,
    i.payMethod ?? null,
    i.quantity ?? null,
    i.rate ?? null,
    i.unitLabel ?? null,
    i.loadRef ?? null,
    i.pickup ?? null,
    i.delivery ?? null,
    i.origin ?? null,
    i.destination ?? null,
    i.loadedMiles ?? null,
    i.deadheadMiles ?? null,
    i.payableMiles ?? null,
    i.eligibleRevenue ?? null,
    i.sortOrder === undefined ? 0 : i.sortOrder,
  ];
}

async function addItem(settlementId: string | null, i: ItemInput = {}): Promise<ItemRow> {
  const r = await db.query<ItemRow>(ADD_SQL, params(settlementId, i));
  return r.rows[0];
}

async function updateItem(itemId: string | null, i: ItemInput = {}): Promise<ItemRow> {
  const r = await db.query<ItemRow>(UPDATE_SQL, params(itemId, i));
  return r.rows[0];
}

async function deleteItem(itemId: string | null): Promise<string> {
  const r = await db.query<{ id: string }>(DELETE_SQL, [itemId]);
  return r.rows[0].id;
}

async function failureMessage(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as Error).message;
  }
  return '<<no error raised>>';
}

async function itemById(id: string): Promise<ItemRow | undefined> {
  const r = await db.query<ItemRow>(
    `SELECT *, pickup_date_snapshot::text AS pickup, delivery_date_snapshot::text AS delivery
       FROM public.driver_settlement_items WHERE id=$1`,
    [id],
  );
  return r.rows[0];
}

async function itemCount(): Promise<number> {
  const r = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM public.driver_settlement_items`,
  );
  return Number(r.rows[0].c);
}

async function eventCount(): Promise<number> {
  const r = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM public.driver_settlement_events`,
  );
  return Number(r.rows[0].c);
}

async function eventsFor(settlementId: string): Promise<EventRow[]> {
  const r = await db.query<EventRow>(
    `SELECT * FROM public.driver_settlement_events
      WHERE settlement_id=$1 ORDER BY created_at, id`,
    [settlementId],
  );
  return r.rows;
}

/** Owner-level draft creation used only to build fixtures under test control. */
async function mkDraftDriverImported(driver: string, actor: string): Promise<string> {
  return asRole('authenticated', actor, async () => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM public.settlement_create_driver_imported_draft(
         $1::uuid, $2::date, $3::date, NULL, NULL, NULL, NULL, NULL, NULL)`,
      [driver, P1, P2],
    );
    return r.rows[0].id;
  });
}

async function mkDraftCarrier(
  recruiter: string,
  relationship: string,
  driver: string,
  actor: string,
): Promise<string> {
  return asRole('authenticated', actor, async () => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM public.settlement_create_carrier_draft(
         $1::uuid, $2::uuid, $3::uuid, $4::date, $5::date, NULL, NULL, NULL, NULL, NULL)`,
      [recruiter, relationship, driver, P1, P2],
    );
    return r.rows[0].id;
  });
}

async function mkDraftAgency(
  agency: string,
  driver: string,
  actor: string,
): Promise<string> {
  return asRole('authenticated', actor, async () => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM public.settlement_create_agency_draft(
         $1::uuid, $2::uuid, $3::date, $4::date, NULL, NULL, NULL, NULL, NULL, NULL)`,
      [agency, driver, P1, P2],
    );
    return r.rows[0].id;
  });
}

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;

  await db.exec(BOOTSTRAP);
  await db.exec(B1_SQL);
  await db.exec(HARNESS_GRANTS);
  await db.exec(B2A_SQL);
  await db.exec(B2B_SQL);
  await db.exec(B2C1_SQL);
  await db.exec(B2C2A_SQL);

  beforeTables = await names(TABLES_SQL);
  beforeFunctions = await names(FUNCS_SQL);
  beforeIndexes = await names(IDX_SQL);
  beforeTriggers = await names(TRIGS_SQL);
  beforeViews = await names(VIEWS_SQL);
  beforeTypes = await names(TYPES_SQL);
  beforePolicies = await names(POLICIES_SQL);

  await db.exec(B2C3A_SQL);

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
    'lapsePro',
    'statusDriver',
    'assistant',
    'assistantViewOnly',
    'agencyAssistant',
    'paidCarrier',
    'unpaidCarrier',
    'lapseCarrier',
    'carrierDriver',
    'endDriver',
    'lapseDriver',
    'agencyOwner',
    'agencyMember',
    'outsideMember',
    'agencyDriver',
    'agencyFreeDriver',
    'agencyLapseDriver',
    'agencyRevokeDriver',
    'agencyMemberLapseDriver',
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
  await sub(U.lapsePro, 'pro_monthly', 'active');
  await sub(U.statusDriver, 'pro_monthly', 'active');

  const mkRecruiter = async (owner: string, company: string) =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO public.recruiter_profiles (user_id, company_name)
         VALUES ($1,$2) RETURNING id`,
        [owner, company],
      )
    ).rows[0].id;

  R.paid = await mkRecruiter(U.paidCarrier, 'Blue Line Freight');
  R.unpaid = await mkRecruiter(U.unpaidCarrier, 'Unpaid Carrier Co');
  R.lapse = await mkRecruiter(U.lapseCarrier, 'Lapsing Carrier Co');

  const bill = async (rid: string, uid: string, plan: string, status: string) =>
    db.query(
      `INSERT INTO public.recruiter_billing_profiles (recruiter_id, user_id, plan, status)
       VALUES ($1,$2,$3,$4)`,
      [rid, uid, plan, status],
    );
  await bill(R.paid, U.paidCarrier, 'growth', 'active');
  await bill(R.lapse, U.lapseCarrier, 'growth', 'active');

  const mkAgency = async (owner: string, name: string) => {
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO public.agency_profiles (owner_user_id, name, status)
         VALUES ($1,$2,'active') RETURNING id`,
        [owner, name],
      )
    ).rows[0].id;
    await db.query(
      `INSERT INTO public.agency_entitlements (agency_id, plan_key, status)
       VALUES ($1,'agency_team','active')`,
      [id],
    );
    await db.query(
      `INSERT INTO public.agency_members (agency_id, member_user_id, role, status)
       VALUES ($1,$2,'agency_owner','active'), ($1,$3,'agency_member','active')`,
      [id, owner, U.agencyMember],
    );
    return id;
  };

  A.paid = await mkAgency(U.agencyOwner, 'Acme Back Office');
  A.lapse = await mkAgency(U.agencyOwner, 'Lapsing Agency');

  const MANAGE = '{"settlements_manage":true}';
  const delegate = async (aid: string, driver: string, status: string) =>
    db.query(
      `INSERT INTO public.agency_delegation_requests
         (agency_id, driver_user_id, member_user_id, status, requested_permissions)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [aid, driver, U.agencyMember, status, MANAGE],
    );
  await delegate(A.paid, U.agencyDriver, 'approved');
  await delegate(A.paid, U.agencyFreeDriver, 'approved');
  await delegate(A.paid, U.agencyRevokeDriver, 'approved');
  await delegate(A.paid, U.agencyMemberLapseDriver, 'approved');
  await delegate(A.lapse, U.agencyLapseDriver, 'approved');

  // Direct assistant (settlements_manage) + view-only + agency-generated row.
  await db.query(
    `INSERT INTO public.driver_assistants
       (driver_user_id, assistant_user_id, status, permissions, agency_delegation_id)
     VALUES
       ($1,$2,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, NULL),
       ($1,$3,'active','{"settlements_view":true}'::jsonb, NULL),
       ($1,$4,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, gen_random_uuid())`,
    [U.driverPro, U.assistant, U.assistantViewOnly, U.agencyAssistant],
  );

  const mkRel = async (rid: string, driver: string, status: string) =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO public.carrier_driver_relationships
           (recruiter_id, driver_user_id, status, created_by_user_id, accepted_at)
         VALUES ($1,$2,$3,$1, CASE WHEN $3='active' THEN now() ELSE NULL END)
         RETURNING id`,
        [rid, driver, status],
      )
    ).rows[0].id;

  RELS.active = await mkRel(R.paid, U.carrierDriver, 'active');
  RELS.end = await mkRel(R.paid, U.endDriver, 'active');
  RELS.lapse = await mkRel(R.lapse, U.lapseDriver, 'active');
  RELS.unpaid = await mkRel(R.unpaid, U.carrierDriver, 'active');

  // --- fixture drafts ------------------------------------------------------
  S.driver = await mkDraftDriverImported(U.driverPro, U.driverPro);
  S.driverAlt = await mkDraftDriverImported(U.driverPro, U.driverPro);
  S.driverAssist = await mkDraftDriverImported(U.driverPro, U.driverPro);
  S.driverShape = await mkDraftDriverImported(U.driverPro, U.driverPro);
  S.driverValidation = await mkDraftDriverImported(U.driverPro, U.driverPro);
  S.driverRls = await mkDraftDriverImported(U.driverPro, U.driverPro);
  S.driverMalformed = await mkDraftDriverImported(U.driverPro, U.driverPro);
  S.driverFinalized = await mkDraftDriverImported(U.driverPro, U.driverPro);
  S.driverVoided = await mkDraftDriverImported(U.driverPro, U.driverPro);
  S.driverSuperseded = await mkDraftDriverImported(U.driverPro, U.driverPro);
  S.lapsePro = await mkDraftDriverImported(U.lapsePro, U.lapsePro);

  S.carrier = await mkDraftCarrier(R.paid, RELS.active, U.carrierDriver, U.paidCarrier);
  S.carrierEnd = await mkDraftCarrier(R.paid, RELS.end, U.endDriver, U.paidCarrier);
  S.carrierLapse = await mkDraftCarrier(
    R.lapse,
    RELS.lapse,
    U.lapseDriver,
    U.lapseCarrier,
  );

  S.agency = await mkDraftAgency(A.paid, U.agencyDriver, U.agencyMember);
  S.agencyFree = await mkDraftAgency(A.paid, U.agencyFreeDriver, U.agencyMember);
  S.agencyRevoke = await mkDraftAgency(A.paid, U.agencyRevokeDriver, U.agencyMember);
  S.agencyMemberLapse = await mkDraftAgency(
    A.paid,
    U.agencyMemberLapseDriver,
    U.agencyMember,
  );
  S.agencyLapse = await mkDraftAgency(A.lapse, U.agencyLapseDriver, U.agencyMember);

  // Non-draft statuses, forced directly (no status RPC exists in this phase).
  await db.query(
    `UPDATE public.driver_settlements SET status='finalized' WHERE id=$1`,
    [S.driverFinalized],
  );
  await db.query(`UPDATE public.driver_settlements SET status='voided' WHERE id=$1`, [
    S.driverVoided,
  ]);
  await db.query(
    `UPDATE public.driver_settlements SET status='superseded' WHERE id=$1`,
    [S.driverSuperseded],
  );
});

// =====================================================================
describe('Phase 1T-B2C3A — catalog and ACL contract', () => {
  it('all six real candidates apply in order (proof 1)', () => {
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
        'settlement_current_user_can_assist_driver',
        'settlement_invite_carrier_driver',
        'settlement_create_driver_imported_draft',
        'settlement_create_carrier_draft',
        'settlement_create_agency_draft',
        'settlement_update_draft_header',
      ]),
    );
    for (const fn of FUNCTIONS) {
      expect(afterFunctions).toContain(fn);
    }
  });

  it('adds exactly three functions and nothing else (proof 2)', () => {
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

  it('all three are plpgsql SECURITY DEFINER, VOLATILE, locked search_path, correct ACL (proof 3)', async () => {
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

  it('anon cannot execute any of the three RPCs (proof 3b)', async () => {
    await asRole('anon', null, async () => {
      const calls = [
        () => addItem(S.driver),
        () => updateItem('00000000-0000-4000-8000-000000000000'),
        () => deleteItem('00000000-0000-4000-8000-000000000000'),
      ];
      for (const call of calls) {
        expect(await failureMessage(call)).toMatch(/permission denied/i);
      }
    });
  });

  it('unauthenticated / null ids fail with fixed errors (proof 4)', async () => {
    const items = await itemCount();
    const events = await eventCount();
    await asRole('authenticated', null, async () => {
      expect(await failureMessage(() => addItem(S.driver))).toContain(ERR.invalid);
      expect(
        await failureMessage(() => updateItem('00000000-0000-4000-8000-000000000000')),
      ).toContain(ERR.invalid);
      expect(
        await failureMessage(() => deleteItem('00000000-0000-4000-8000-000000000000')),
      ).toContain(ERR.invalid);
    });
    await asRole('authenticated', U.driverPro, async () => {
      expect(await failureMessage(() => addItem(null))).toContain(ERR.invalid);
      expect(await failureMessage(() => updateItem(null))).toContain(ERR.invalid);
      expect(await failureMessage(() => deleteItem(null))).toContain(ERR.invalid);
      expect(
        await failureMessage(() => addItem('00000000-0000-4000-8000-000000000000')),
      ).toContain(ERR.notFound);
    });
    expect(await itemCount()).toBe(items);
    expect(await eventCount()).toBe(events);
  });
});

// =====================================================================
describe('Phase 1T-B2C3A — source authorization', () => {
  it('active Pro recipient can add, update and delete on own driver_imported draft (proof 5)', async () => {
    let deletedItemId: string | null = null;
    await asRole('authenticated', U.driverPro, async () => {
      const item = await addItem(S.driver, {
        itemType: 'earning',
        category: 'Detention',
        amount: '125.50',
      });
      expect(item.item_type).toBe('earning');
      expect(item.amount).toBe('125.50');

      const updated = await updateItem(item.id, {
        itemType: 'reimbursement',
        category: 'Tolls',
        amount: '12.00',
      });
      expect(updated.item_type).toBe('reimbursement');
      expect(updated.category).toBe('Tolls');

      const deleted = await deleteItem(item.id);
      expect(deleted).toBe(item.id);
      deletedItemId = item.id;
    });
    expect(deletedItemId).not.toBeNull();
    expect(await itemById(deletedItemId as string)).toBeUndefined();
  });

  it('Free / downgraded recipient cannot mutate driver_imported draft items (proof 6)', async () => {
    const seeded = await asRole('authenticated', U.lapsePro, () =>
      addItem(S.lapsePro, { amount: '10.00' }),
    );
    await db.query(
      `UPDATE public.subscriptions SET status='canceled' WHERE user_id=$1`,
      [U.lapsePro],
    );
    const events = await eventCount();
    await asRole('authenticated', U.lapsePro, async () => {
      expect(await failureMessage(() => addItem(S.lapsePro))).toContain(
        ERR.driverImport,
      );
      expect(await failureMessage(() => updateItem(seeded.id))).toContain(
        ERR.driverImport,
      );
      expect(await failureMessage(() => deleteItem(seeded.id))).toContain(
        ERR.driverImport,
      );
    });
    expect(await itemById(seeded.id)).toBeDefined();
    expect(await eventCount()).toBe(events);
  });

  it('direct assistant can mutate; view-only and agency-generated assistants cannot (proof 7)', async () => {
    const item = await asRole('authenticated', U.assistant, () =>
      addItem(S.driverAssist, { amount: '55.00' }),
    );
    expect(item.created_by_user_id).toBe(U.assistant);

    await asRole('authenticated', U.assistant, async () => {
      const updated = await updateItem(item.id, { amount: '56.00' });
      expect(updated.amount).toBe('56.00');
    });

    for (const actor of [U.assistantViewOnly, U.agencyAssistant]) {
      await asRole('authenticated', actor, async () => {
        expect(await failureMessage(() => addItem(S.driverAssist))).toContain(
          ERR.driverImport,
        );
        expect(await failureMessage(() => updateItem(item.id))).toContain(
          ERR.driverImport,
        );
        expect(await failureMessage(() => deleteItem(item.id))).toContain(
          ERR.driverImport,
        );
      });
    }

    await asRole('authenticated', U.assistant, async () => {
      expect(await deleteItem(item.id)).toBe(item.id);
    });
  });

  it('paid carrier with exact active relationship can mutate its own draft (proof 8a)', async () => {
    await asRole('authenticated', U.paidCarrier, async () => {
      const item = await addItem(S.carrier, {
        itemType: 'deduction',
        category: 'Escrow',
        amount: '75.00',
      });
      const updated = await updateItem(item.id, {
        itemType: 'deduction',
        category: 'Escrow',
        amount: '80.00',
      });
      expect(updated.amount).toBe('80.00');
      expect(await deleteItem(item.id)).toBe(item.id);
    });
  });

  it('carrier billing lapse, ended relationship and wrong carrier all block item mutation (proof 8b)', async () => {
    const lapseItem = await asRole('authenticated', U.lapseCarrier, () =>
      addItem(S.carrierLapse, { amount: '20.00' }),
    );
    const endItem = await asRole('authenticated', U.paidCarrier, () =>
      addItem(S.carrierEnd, { amount: '20.00' }),
    );

    await db.query(
      `UPDATE public.recruiter_billing_profiles SET status='canceled' WHERE recruiter_id=$1`,
      [R.lapse],
    );
    await db.query(
      `UPDATE public.carrier_driver_relationships SET status='ended' WHERE id=$1`,
      [RELS.end],
    );

    await asRole('authenticated', U.lapseCarrier, async () => {
      expect(await failureMessage(() => addItem(S.carrierLapse))).toContain(ERR.carrier);
      expect(await failureMessage(() => updateItem(lapseItem.id))).toContain(
        ERR.carrier,
      );
      expect(await failureMessage(() => deleteItem(lapseItem.id))).toContain(
        ERR.carrier,
      );
    });
    await asRole('authenticated', U.paidCarrier, async () => {
      expect(await failureMessage(() => addItem(S.carrierEnd))).toContain(ERR.carrier);
      expect(await failureMessage(() => updateItem(endItem.id))).toContain(ERR.carrier);
    });
    // An unrelated / unpaid carrier and the recipient driver cannot mutate either.
    for (const actor of [U.unpaidCarrier, U.carrierDriver, U.stranger]) {
      await asRole('authenticated', actor, async () => {
        expect(await failureMessage(() => addItem(S.carrier))).toContain(ERR.carrier);
      });
    }
    expect(await itemById(lapseItem.id)).toBeDefined();
    expect(await itemById(endItem.id)).toBeDefined();
  });

  it('eligible agency member can mutate regardless of driver plan; lapses block (proof 9)', async () => {
    // Free target driver never blocks agency preparation.
    await asRole('authenticated', U.agencyMember, async () => {
      const free = await addItem(S.agencyFree, { amount: '30.00' });
      expect(free.settlement_id).toBe(S.agencyFree);
      expect(await deleteItem(free.id)).toBe(free.id);
    });

    const entItem = await asRole('authenticated', U.agencyMember, () =>
      addItem(S.agencyLapse, { amount: '10.00' }),
    );
    const delItem = await asRole('authenticated', U.agencyMember, () =>
      addItem(S.agencyRevoke, { amount: '10.00' }),
    );
    const memItem = await asRole('authenticated', U.agencyMember, () =>
      addItem(S.agencyMemberLapse, { amount: '10.00' }),
    );

    await db.query(
      `UPDATE public.agency_entitlements SET status='cancelled' WHERE agency_id=$1`,
      [A.lapse],
    );
    await db.query(
      `UPDATE public.agency_delegation_requests SET status='revoked'
        WHERE agency_id=$1 AND driver_user_id=$2`,
      [A.paid, U.agencyRevokeDriver],
    );

    await asRole('authenticated', U.agencyMember, async () => {
      expect(await failureMessage(() => addItem(S.agencyLapse))).toContain(ERR.agency);
      expect(await failureMessage(() => updateItem(entItem.id))).toContain(ERR.agency);
      expect(await failureMessage(() => deleteItem(delItem.id))).toContain(ERR.agency);
    });

    // Member status lapse blocks the same member on a still-approved delegation.
    await db.query(
      `UPDATE public.agency_members SET status='revoked'
        WHERE agency_id=$1 AND member_user_id=$2`,
      [A.paid, U.agencyMember],
    );
    await asRole('authenticated', U.agencyMember, async () => {
      expect(await failureMessage(() => updateItem(memItem.id))).toContain(ERR.agency);
    });
    await db.query(
      `UPDATE public.agency_members SET status='active'
        WHERE agency_id=$1 AND member_user_id=$2`,
      [A.paid, U.agencyMember],
    );

    // Non-member and the recipient driver are never authorized.
    for (const actor of [U.outsideMember, U.agencyDriver, U.stranger]) {
      await asRole('authenticated', actor, async () => {
        expect(await failureMessage(() => addItem(S.agency))).toContain(ERR.agency);
      });
    }
    expect(await itemById(entItem.id)).toBeDefined();
    expect(await itemById(delItem.id)).toBeDefined();
  });

  it('finalized, voided and superseded parents reject add/update/delete (proof 10)', async () => {
    const seeded = await asRole('authenticated', U.driverPro, () =>
      addItem(S.driverAlt, { amount: '10.00' }),
    );
    await db.query(`UPDATE public.driver_settlement_items SET settlement_id=$1 WHERE id=$2`, [
      S.driverFinalized,
      seeded.id,
    ]);
    const events = await eventCount();
    await asRole('authenticated', U.driverPro, async () => {
      for (const parent of [S.driverFinalized, S.driverVoided, S.driverSuperseded]) {
        expect(await failureMessage(() => addItem(parent))).toContain(ERR.notEditable);
      }
      expect(await failureMessage(() => updateItem(seeded.id))).toContain(
        ERR.notEditable,
      );
      expect(await failureMessage(() => deleteItem(seeded.id))).toContain(
        ERR.notEditable,
      );
    });
    expect(await itemById(seeded.id)).toBeDefined();
    expect(await eventCount()).toBe(events);
  });

  it('an unknown stored parent source fails closed for all three RPCs (proof 11)', async () => {
    const seeded = await asRole('authenticated', U.driverPro, () =>
      addItem(S.driverMalformed, { amount: '10.00' }),
    );
    // Harness-only: force a malformed runtime source the CHECKs normally prevent.
    await db.exec(
      `ALTER TABLE public.driver_settlements
         DROP CONSTRAINT driver_settlements_source_check;
       ALTER TABLE public.driver_settlements
         DROP CONSTRAINT driver_settlements_source_identity_check;`,
    );
    await db.query(`UPDATE public.driver_settlements SET source='bogus' WHERE id=$1`, [
      S.driverMalformed,
    ]);
    await asRole('authenticated', U.driverPro, async () => {
      expect(await failureMessage(() => addItem(S.driverMalformed))).toContain(
        ERR.invalidSource,
      );
      expect(await failureMessage(() => updateItem(seeded.id))).toContain(
        ERR.invalidSource,
      );
      expect(await failureMessage(() => deleteItem(seeded.id))).toContain(
        ERR.invalidSource,
      );
    });
    await db.query(
      `UPDATE public.driver_settlements SET source='driver_imported' WHERE id=$1`,
      [S.driverMalformed],
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
    await asRole('authenticated', U.driverPro, () => deleteItem(seeded.id));
  });

  it('strangers cannot mutate items on any source (proof 30)', async () => {
    const item = await asRole('authenticated', U.driverPro, () =>
      addItem(S.driver, { amount: '11.00' }),
    );
    await asRole('authenticated', U.stranger, async () => {
      expect(await failureMessage(() => addItem(S.driver))).toContain(ERR.driverImport);
      expect(await failureMessage(() => updateItem(item.id))).toContain(
        ERR.driverImport,
      );
      expect(await failureMessage(() => deleteItem(item.id))).toContain(
        ERR.driverImport,
      );
    });
    // The recipient driver (who CAN read) is separately proven above; here the
    // stranger cannot even read the row.
    const visible = await asRole('authenticated', U.stranger, async () => {
      const r = await db.query(
        `SELECT id FROM public.driver_settlement_items WHERE id=$1`,
        [item.id],
      );
      return r.rows.length;
    });
    expect(visible).toBe(0);
    await asRole('authenticated', U.driverPro, () => deleteItem(item.id));
  });
});

// =====================================================================
describe('Phase 1T-B2C3A — item input contract', () => {
  it('item_type allowlist is exact and case-sensitive (proof 12)', async () => {
    await asRole('authenticated', U.driverPro, async () => {
      for (const t of ['load_pay', 'earning', 'reimbursement', 'deduction', 'withholding']) {
        const extra =
          t === 'load_pay'
            ? { payMethod: 'manual' as string | null }
            : {};
        const row = await addItem(S.driverValidation, {
          itemType: t,
          amount: '1.00',
          ...extra,
        });
        expect(row.item_type).toBe(t);
        await deleteItem(row.id);
      }
      for (const bad of [null, '', '   ', 'Load_Pay', 'EARNING', 'bonus', 'load pay']) {
        expect(
          await failureMessage(() =>
            addItem(S.driverValidation, { itemType: bad, amount: '1.00' }),
          ),
        ).toContain(ERR.itemType);
      }
    });
  });

  it('amount is required, non-negative and bounded; 0 and max accepted (proof 13)', async () => {
    await asRole('authenticated', U.driverPro, async () => {
      const zero = await addItem(S.driverValidation, { amount: '0' });
      expect(zero.amount).toBe('0.00');
      await deleteItem(zero.id);

      const max = await addItem(S.driverValidation, { amount: '999999999999.99' });
      expect(max.amount).toBe('999999999999.99');
      await deleteItem(max.id);

      for (const bad of [null, '-0.01', '1000000000000.00']) {
        expect(
          await failureMessage(() => addItem(S.driverValidation, { amount: bad })),
        ).toContain(ERR.itemAmount);
      }
    });
  });

  it('text fields trim, blank-normalize to NULL, and enforce max lengths (proof 14)', async () => {
    await asRole('authenticated', U.driverPro, async () => {
      const row = await addItem(S.driverValidation, {
        itemType: 'load_pay',
        payMethod: 'manual',
        amount: '5.00',
        category: '  Linehaul  ',
        description: '   ',
        loadRef: '  BOL-9  ',
        origin: '  Dallas, TX ',
        destination: '   ',
      });
      expect(row.category).toBe('Linehaul');
      expect(row.description).toBeNull();
      expect(row.load_reference_snapshot).toBe('BOL-9');
      expect(row.origin_snapshot).toBe('Dallas, TX');
      expect(row.destination_snapshot).toBeNull();
      await deleteItem(row.id);

      const over = [
        { category: 'c'.repeat(101) },
        { description: 'd'.repeat(1001) },
        { loadRef: 'l'.repeat(201) },
        { origin: 'o'.repeat(201) },
        { destination: 'x'.repeat(201) },
      ];
      for (const o of over) {
        expect(
          await failureMessage(() =>
            addItem(S.driverValidation, {
              itemType: 'load_pay',
              payMethod: 'manual',
              amount: '5.00',
              ...o,
            }),
          ),
        ).toContain(ERR.itemTextLong);
      }
      // unit_label is validated for length before shape normalization.
      expect(
        await failureMessage(() =>
          addItem(S.driverValidation, {
            itemType: 'load_pay',
            payMethod: 'manual',
            amount: '5.00',
            unitLabel: 'u'.repeat(51),
          }),
        ),
      ).toContain(ERR.itemTextLong);
    });
  });

  it('nullable numeric bounds are enforced (proof 15)', async () => {
    await asRole('authenticated', U.driverPro, async () => {
      const cases: ItemInput[] = [
        { payableMiles: '-1' },
        { payableMiles: '10000000000.00' },
        { rate: '-0.000001' },
        { rate: '100000000.000000' },
        { loadedMiles: '10000000000.00' },
        { deadheadMiles: '-2' },
        { eligibleRevenue: '1000000000000.00' },
      ];
      for (const c of cases) {
        expect(
          await failureMessage(() =>
            addItem(S.driverValidation, {
              itemType: 'load_pay',
              payMethod: 'per_mile',
              amount: '5.00',
              rate: '0.55',
              payableMiles: '100',
              ...c,
            }),
          ),
        ).toContain(ERR.itemNumeric);
      }
      // Explicit quantity bound (per_mile equality is a separate proof).
      expect(
        await failureMessage(() =>
          addItem(S.driverValidation, {
            itemType: 'load_pay',
            payMethod: 'per_mile',
            amount: '5.00',
            rate: '0.55',
            quantity: '10000000000.0000',
            payableMiles: '10000000000.0000',
          }),
        ),
      ).toContain(ERR.itemNumeric);
    });
  });

  it('delivery date must not precede pickup date (proof 16)', async () => {
    await asRole('authenticated', U.driverPro, async () => {
      const ok = await addItem(S.driverValidation, {
        itemType: 'load_pay',
        payMethod: 'manual',
        amount: '5.00',
        pickup: '2026-07-02',
        delivery: '2026-07-02',
      });
      const okStored = await itemById(ok.id);
      expect(okStored?.pickup).toBe('2026-07-02');
      expect(okStored?.delivery).toBe('2026-07-02');
      await deleteItem(ok.id);

      // One-sided dates are allowed.
      const oneSided = await addItem(S.driverValidation, {
        itemType: 'load_pay',
        payMethod: 'manual',
        amount: '5.00',
        delivery: '2026-07-02',
      });
      const oneSidedStored = await itemById(oneSided.id);
      expect(oneSidedStored?.pickup).toBeNull();
      expect(oneSidedStored?.delivery).toBe('2026-07-02');
      await deleteItem(oneSided.id);

      expect(
        await failureMessage(() =>
          addItem(S.driverValidation, {
            itemType: 'load_pay',
            payMethod: 'manual',
            amount: '5.00',
            pickup: '2026-07-05',
            delivery: '2026-07-04',
          }),
        ),
      ).toContain(ERR.itemDates);
    });
  });

  it('sort_order accepts 0 and 1000000 and rejects out-of-range (proof 17)', async () => {
    await asRole('authenticated', U.driverPro, async () => {
      for (const n of [0, 1000000]) {
        const row = await addItem(S.driverValidation, { amount: '1.00', sortOrder: n });
        expect(row.sort_order).toBe(n);
        await deleteItem(row.id);
      }
      for (const n of [-1, 1000001, null]) {
        expect(
          await failureMessage(() =>
            addItem(S.driverValidation, { amount: '1.00', sortOrder: n }),
          ),
        ).toContain(ERR.sortOrder);
      }
    });
  });
});

// =====================================================================
describe('Phase 1T-B2C3A — item shape contract', () => {
  it('load_pay requires a valid pay_method (proof 18a)', async () => {
    await asRole('authenticated', U.driverPro, async () => {
      for (const bad of [null, '', 'PER_MILE', 'hourly']) {
        expect(
          await failureMessage(() =>
            addItem(S.driverShape, {
              itemType: 'load_pay',
              amount: '5.00',
              payMethod: bad,
            }),
          ),
        ).toContain(ERR.payMethod);
      }
    });
  });

  it('non-load item types forbid pay_method and every load-specific field (proof 18b/23)', async () => {
    await asRole('authenticated', U.driverPro, async () => {
      for (const t of ['earning', 'reimbursement', 'deduction', 'withholding']) {
        const ok = await addItem(S.driverShape, {
          itemType: t,
          category: 'Misc',
          description: 'reported line',
          amount: '9.99',
        });
        expect(ok.pay_method).toBeNull();
        expect(ok.quantity).toBeNull();
        expect(ok.rate).toBeNull();
        expect(ok.unit_label).toBeNull();
        expect(ok.payable_miles_snapshot).toBeNull();
        await deleteItem(ok.id);

        const extras: ItemInput[] = [
          { payMethod: 'manual' },
          { quantity: '1' },
          { rate: '1' },
          { unitLabel: 'mile' },
          { loadRef: 'BOL-1' },
          { pickup: '2026-07-02' },
          { delivery: '2026-07-02' },
          { origin: 'Dallas, TX' },
          { destination: 'Waco, TX' },
          { loadedMiles: '10' },
          { deadheadMiles: '10' },
          { payableMiles: '10' },
          { eligibleRevenue: '10' },
        ];
        for (const extra of extras) {
          expect(
            await failureMessage(() =>
              addItem(S.driverShape, { itemType: t, amount: '9.99', ...extra }),
            ),
          ).toContain(ERR.itemShape);
        }
      }
    });
  });

  it('per_mile requires rate + payable miles, normalizes quantity/unit, never recalculates amount (proof 19)', async () => {
    await asRole('authenticated', U.driverPro, async () => {
      const row = await addItem(S.driverShape, {
        itemType: 'load_pay',
        payMethod: 'per_mile',
        amount: '123.45',
        rate: '0.550000',
        payableMiles: '1000.00',
        unitLabel: 'kilometre',
      });
      // amount is the REPORTED value, not rate * miles (which would be 550.00).
      expect(row.amount).toBe('123.45');
      expect(row.quantity).toBe('1000.0000');
      expect(row.unit_label).toBe('mile');
      expect(row.rate).toBe('0.550000');
      expect(row.eligible_revenue_snapshot).toBeNull();
      await deleteItem(row.id);

      const bad: ItemInput[] = [
        { rate: null, payableMiles: '100' },
        { rate: '0.55', payableMiles: null },
        { rate: '0.55', payableMiles: '100', eligibleRevenue: '500' },
      ];
      for (const b of bad) {
        expect(
          await failureMessage(() =>
            addItem(S.driverShape, {
              itemType: 'load_pay',
              payMethod: 'per_mile',
              amount: '10.00',
              ...b,
            }),
          ),
        ).toContain(ERR.payShape);
      }
    });
  });

  it('per_mile rejects an explicit quantity that differs from payable miles (proof 20)', async () => {
    await asRole('authenticated', U.driverPro, async () => {
      expect(
        await failureMessage(() =>
          addItem(S.driverShape, {
            itemType: 'load_pay',
            payMethod: 'per_mile',
            amount: '10.00',
            rate: '0.55',
            payableMiles: '1000',
            quantity: '999',
          }),
        ),
      ).toContain(ERR.payShape);

      const matching = await addItem(S.driverShape, {
        itemType: 'load_pay',
        payMethod: 'per_mile',
        amount: '10.00',
        rate: '0.55',
        payableMiles: '1000',
        quantity: '1000',
      });
      expect(matching.quantity).toBe('1000.0000');
      await deleteItem(matching.id);
    });
  });

  it('percentage keeps human percent rate, requires eligible revenue, normalizes unit (proof 21)', async () => {
    await asRole('authenticated', U.driverPro, async () => {
      const row = await addItem(S.driverShape, {
        itemType: 'load_pay',
        payMethod: 'percentage',
        amount: '600.00',
        rate: '30',
        eligibleRevenue: '2000.00',
        payableMiles: '900.00',
        unitLabel: 'mile',
      });
      expect(row.rate).toBe('30.000000');
      expect(row.unit_label).toBe('percent');
      expect(row.quantity).toBeNull();
      // amount is the reported value; 30% of 2000 is not force-written.
      expect(row.amount).toBe('600.00');
      expect(row.payable_miles_snapshot).toBe('900.00');
      await deleteItem(row.id);

      const bad: ItemInput[] = [
        { rate: null, eligibleRevenue: '2000' },
        { rate: '101', eligibleRevenue: '2000' },
        { rate: '30', eligibleRevenue: null },
        { rate: '30', eligibleRevenue: '2000', quantity: '5' },
      ];
      for (const b of bad) {
        expect(
          await failureMessage(() =>
            addItem(S.driverShape, {
              itemType: 'load_pay',
              payMethod: 'percentage',
              amount: '10.00',
              ...b,
            }),
          ),
        ).toContain(ERR.payShape);
      }
    });
  });

  it('flat_rate and manual forbid quantity/rate/revenue, null the unit, keep descriptive snapshots (proof 22)', async () => {
    await asRole('authenticated', U.driverPro, async () => {
      for (const method of ['flat_rate', 'manual']) {
        const row = await addItem(S.driverShape, {
          itemType: 'load_pay',
          payMethod: method,
          amount: '450.00',
          unitLabel: 'load',
          loadRef: 'BOL-77',
          origin: 'Dallas, TX',
          destination: 'Waco, TX',
          pickup: '2026-07-02',
          delivery: '2026-07-03',
          loadedMiles: '180.00',
          deadheadMiles: '20.00',
          payableMiles: '200.00',
        });
        expect(row.pay_method).toBe(method);
        expect(row.unit_label).toBeNull();
        expect(row.quantity).toBeNull();
        expect(row.rate).toBeNull();
        expect(row.loaded_miles_snapshot).toBe('180.00');
        expect(row.payable_miles_snapshot).toBe('200.00');
        expect(row.load_reference_snapshot).toBe('BOL-77');
        await deleteItem(row.id);

        for (const b of [{ quantity: '1' }, { rate: '1' }, { eligibleRevenue: '1' }]) {
          expect(
            await failureMessage(() =>
              addItem(S.driverShape, {
                itemType: 'load_pay',
                payMethod: method,
                amount: '10.00',
                ...b,
              }),
            ),
          ).toContain(ERR.payShape);
        }
      }
    });
  });
});

// =====================================================================
describe('Phase 1T-B2C3A — persistence, immutability and events', () => {
  it('add stores expected_amount_snapshot NULL and the exact actor (proof 24)', async () => {
    const row = await asRole('authenticated', U.driverPro, () =>
      addItem(S.driverAlt, { amount: '42.00' }),
    );
    expect(row.expected_amount_snapshot).toBeNull();
    expect(row.created_by_user_id).toBe(U.driverPro);
    expect(row.settlement_id).toBe(S.driverAlt);
    await asRole('authenticated', U.driverPro, () => deleteItem(row.id));
  });

  it('update replaces mutable fields but preserves identity and provenance (proof 25/35)', async () => {
    const created = await asRole('authenticated', U.driverPro, () =>
      addItem(S.driverAlt, {
        itemType: 'load_pay',
        payMethod: 'per_mile',
        amount: '100.00',
        rate: '0.50',
        payableMiles: '200',
        category: 'Linehaul',
      }),
    );
    // Simulate a later match-derived snapshot to prove the update preserves it.
    await db.query(
      `UPDATE public.driver_settlement_items SET expected_amount_snapshot=$1 WHERE id=$2`,
      ['95.00', created.id],
    );

    const updated = await asRole('authenticated', U.driverPro, () =>
      updateItem(created.id, {
        itemType: 'load_pay',
        payMethod: 'percentage',
        amount: '150.00',
        rate: '25',
        eligibleRevenue: '600.00',
        category: 'Percentage Pay',
        description: 'restated line',
        sortOrder: 7,
      }),
    );

    expect(updated.id).toBe(created.id);
    expect(updated.settlement_id).toBe(created.settlement_id);
    expect(updated.created_by_user_id).toBe(created.created_by_user_id);
    expect(updated.created_at).toStrictEqual(created.created_at);
    expect(updated.expected_amount_snapshot).toBe('95.00');
    expect(updated.item_type).toBe('load_pay');
    expect(updated.pay_method).toBe('percentage');
    expect(updated.amount).toBe('150.00');
    expect(updated.rate).toBe('25.000000');
    expect(updated.unit_label).toBe('percent');
    expect(updated.quantity).toBeNull();
    expect(updated.payable_miles_snapshot).toBeNull();
    expect(updated.category).toBe('Percentage Pay');
    expect(updated.sort_order).toBe(7);

    await asRole('authenticated', U.driverPro, () => deleteItem(created.id));
  });

  it('update cannot move an item to another settlement (proof 26)', async () => {
    const src = await db.query<{ n: string }>(
      `SELECT pg_get_function_identity_arguments(p.oid) AS n
         FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
        WHERE ns.nspname='public' AND p.proname='settlement_update_draft_item'`,
    );
    expect(src.rows).toHaveLength(1);
    expect(src.rows[0].n).not.toMatch(/settlement/i);
    expect(src.rows[0].n.replace(/\s+/g, ' ')).toBe(
      '_item_id uuid, _item_type text, _category text, _description text, ' +
        '_amount numeric, _pay_method text, _quantity numeric, _rate numeric, ' +
        '_unit_label text, _load_reference_snapshot text, ' +
        '_pickup_date_snapshot date, _delivery_date_snapshot date, ' +
        '_origin_snapshot text, _destination_snapshot text, ' +
        '_loaded_miles_snapshot numeric, _deadhead_miles_snapshot numeric, ' +
        '_payable_miles_snapshot numeric, _eligible_revenue_snapshot numeric, ' +
        '_sort_order integer',
    );
    expect(CODE).not.toMatch(/SET[\s\S]{0,400}?settlement_id\s*=/);
  });

  it('missing items fail fixed and failed calls change nothing (proof 27)', async () => {
    const ghost = '00000000-0000-4000-8000-0000000000ff';
    const items = await itemCount();
    const events = await eventCount();
    await asRole('authenticated', U.driverPro, async () => {
      expect(await failureMessage(() => updateItem(ghost))).toContain(ERR.itemNotFound);
      expect(await failureMessage(() => deleteItem(ghost))).toContain(ERR.itemNotFound);
      // A validation failure mid-call leaves no row and no event.
      expect(
        await failureMessage(() => addItem(S.driver, { amount: '-5' })),
      ).toContain(ERR.itemAmount);
    });
    expect(await itemCount()).toBe(items);
    expect(await eventCount()).toBe(events);
  });

  it('each successful mutation writes exactly one updated event with exact metadata (proof 28/29)', async () => {
    const before = (await eventsFor(S.carrier)).length;
    const item = await asRole('authenticated', U.paidCarrier, () =>
      addItem(S.carrier, { itemType: 'withholding', amount: '15.00' }),
    );

    let evts = await eventsFor(S.carrier);
    expect(evts.length).toBe(before + 1);
    let last = evts[evts.length - 1];
    expect(last.event_type).toBe('updated');
    expect(last.actor_user_id).toBe(U.paidCarrier);
    expect(last.metadata).toEqual({
      source: 'carrier_issued',
      change: 'item_added',
      item_id: item.id,
      item_type: 'withholding',
    });

    await asRole('authenticated', U.paidCarrier, () =>
      updateItem(item.id, { itemType: 'deduction', amount: '16.00' }),
    );
    evts = await eventsFor(S.carrier);
    expect(evts.length).toBe(before + 2);
    last = evts[evts.length - 1];
    expect(last.metadata).toEqual({
      source: 'carrier_issued',
      change: 'item_updated',
      item_id: item.id,
      item_type: 'deduction',
    });

    const returned = await asRole('authenticated', U.paidCarrier, () =>
      deleteItem(item.id),
    );
    expect(returned).toBe(item.id);
    expect(await itemById(item.id)).toBeUndefined();

    evts = await eventsFor(S.carrier);
    expect(evts.length).toBe(before + 3);
    last = evts[evts.length - 1];
    expect(last.metadata).toEqual({
      source: 'carrier_issued',
      change: 'item_deleted',
      item_id: item.id,
      item_type: 'deduction',
    });

    // The parent statement itself always survives item deletion.
    const parent = await db.query(
      `SELECT id FROM public.driver_settlements WHERE id=$1`,
      [S.carrier],
    );
    expect(parent.rows).toHaveLength(1);
  });

  it('direct authenticated item writes stay RLS-blocked while the RPC works (proof 31)', async () => {
    const item = await asRole('authenticated', U.driverPro, () =>
      addItem(S.driverRls, { amount: '20.00' }),
    );

    await asRole('authenticated', U.driverPro, async () => {
      const msg = await failureMessage(() =>
        db.query(
          `INSERT INTO public.driver_settlement_items
             (settlement_id, item_type, amount, created_by_user_id)
           VALUES ($1,'earning',5,$2)`,
          [S.driverRls, U.driverPro],
        ),
      );
      expect(msg).toMatch(/row-level security/i);

      const upd = await db.query(
        `UPDATE public.driver_settlement_items SET amount=999 WHERE id=$1`,
        [item.id],
      );
      expect(upd.affectedRows ?? 0).toBe(0);

      const del = await db.query(
        `DELETE FROM public.driver_settlement_items WHERE id=$1`,
        [item.id],
      );
      expect(del.affectedRows ?? 0).toBe(0);
    });

    const still = await itemById(item.id);
    expect(still?.amount).toBe('20.00');
    await asRole('authenticated', U.driverPro, () => deleteItem(item.id));
  });

  it('direct authenticated event inserts stay RLS-blocked (proof 32)', async () => {
    await asRole('authenticated', U.driverPro, async () => {
      const msg = await failureMessage(() =>
        db.query(
          `INSERT INTO public.driver_settlement_events (settlement_id, actor_user_id, event_type)
           VALUES ($1,$2,'updated')`,
          [S.driverRls, U.driverPro],
        ),
      );
      expect(msg).toMatch(/row-level security/i);
    });
  });
});

// =====================================================================
describe('Phase 1T-B2C3A — source contract', () => {
  it('candidate header, transaction and forbidden constructs (proof 33)', () => {
    expect(B2C3A_SQL.split('\n')[0]).toBe('-- CANDIDATE MIGRATION — NOT APPLIED LIVE.');
    expect(B2C3A_SQL).toContain('Phase 1T-B2C3A');
    expect((CODE.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((CODE.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
    expect((CODE.match(/CREATE FUNCTION/g) ?? []).length).toBe(3);

    for (const forbidden of [
      /CREATE OR REPLACE/i,
      /IF NOT EXISTS/i,
      /\bDROP\b/i,
      /\bEXECUTE\s+(?!ON FUNCTION)/i,
      /format\s*\(/i,
      /CREATE POLICY/i,
      /CREATE TRIGGER/i,
      /CREATE TABLE/i,
      /ALTER TABLE/i,
      /CREATE INDEX/i,
      /CREATE TYPE/i,
      /CREATE VIEW/i,
      /\bemail\b/i,
      /service_role\s*=/i,
      /current_setting/i,
      /is_admin|super_admin|bypass/i,
      /GRANT[^;]*\bON\s+TABLE\b/i,
      /GRANT[^;]*\bON\s+public\.[a-z_]+\s+TO/i,
    ]) {
      expect(CODE).not.toMatch(forbidden);
    }

    // Every GRANT/REVOKE in the candidate targets a FUNCTION only.
    for (const line of CODE.split('\n').filter((l) => /^(GRANT|REVOKE)/.test(l.trim()))) {
      expect(line).toMatch(/ON FUNCTION public\.settlement_/);
    }
  });

  it('all three RPCs lock the parent, require draft, and re-check current management helpers (proof 34)', () => {
    expect((CODE.match(/FROM public\.driver_settlements ds\s+WHERE ds\.id = [^;]*FOR UPDATE/g) ?? []).length).toBe(3);
    expect((CODE.match(/v_parent\.status <> 'draft'/g) ?? []).length).toBe(3);
    expect((CODE.match(/settlement_not_editable/g) ?? []).length).toBe(3);
    expect(
      (CODE.match(/settlement_current_user_can_manage_driver_import\(\)/g) ?? []).length,
    ).toBe(3);
    expect(
      (CODE.match(/settlement_current_user_can_assist_driver\(/g) ?? []).length,
    ).toBe(3);
    expect(
      (CODE.match(/settlement_current_user_can_manage_carrier\(/g) ?? []).length,
    ).toBe(3);
    expect(
      (CODE.match(/settlement_current_user_can_manage_agency\(/g) ?? []).length,
    ).toBe(3);
    expect((CODE.match(/settlement_invalid_source/g) ?? []).length).toBe(3);
    expect((CODE.match(/auth\.uid\(\)/g) ?? []).length).toBe(3);
    // Both item-scoped RPCs additionally lock the exact item row.
    expect(
      (CODE.match(/FROM public\.driver_settlement_items dsi[\s\S]{0,200}?FOR UPDATE/g) ?? [])
        .length,
    ).toBe(2);
  });

  it('expected_amount_snapshot is hard-coded NULL on add and never assigned on update (proof 35b)', () => {
    expect(CODE).toMatch(/expected_amount_snapshot,/);
    expect((CODE.match(/expected_amount_snapshot/g) ?? []).length).toBe(1);
    expect(CODE).not.toMatch(/expected_amount_snapshot\s*=/);
    expect(CODE).not.toMatch(/_expected_amount_snapshot/);
  });

  it('no arithmetic ever derives or overwrites the reported amount (proof 36)', () => {
    expect(CODE).not.toMatch(/amount\s*=\s*[^;\n]*[*/][^;\n]*/);
    expect(CODE).not.toMatch(/_rate\s*\*/);
    expect(CODE).not.toMatch(/_payable_miles_snapshot\s*\*/);
    expect(CODE).not.toMatch(/_eligible_revenue_snapshot\s*\*/);
    expect(CODE).not.toMatch(/\/\s*100/);
    // `amount` is only ever written straight from the validated caller input.
    expect((CODE.match(/amount\s*=\s*_amount/g) ?? []).length).toBe(1);
  });

  it('fixed errors never leak database internals (proof 37)', () => {
    const raised = CODE.match(/RAISE EXCEPTION '([^']+)'/g) ?? [];
    expect(raised.length).toBeGreaterThan(20);
    const allowed = new Set<string>(Object.values(ERR));
    for (const r of raised) {
      const msg = r.replace(/RAISE EXCEPTION '/, '').replace(/'$/, '');
      expect(allowed.has(msg)).toBe(true);
      expect(msg).not.toMatch(LEAK);
      expect(msg).not.toMatch(/%/);
    }
    expect(CODE).not.toMatch(/SQLERRM|SQLSTATE/);
  });
});

// =====================================================================
// Phase 1T-B2C3A-R1 — finite numeric contract in the item RPCs
// =====================================================================
describe('Phase 1T-B2C3A-R1 — item RPCs reject non-finite numerics', () => {
  const SPECIALS = ['NaN', 'Infinity', '-Infinity'] as const;
  const OPTIONAL_NUMERICS = [
    'quantity',
    'rate',
    'loadedMiles',
    'deadheadMiles',
    'payableMiles',
    'eligibleRevenue',
  ] as const;

  it('add rejects special amounts with the fixed item-amount error and persists nothing', async () => {
    const beforeItems = await itemCount();
    const beforeEvents = await eventCount();
    await asRole('authenticated', U.driverPro, async () => {
      for (const v of SPECIALS) {
        expect(
          await failureMessage(() => addItem(S.driverValidation, { amount: v })),
          v,
        ).toContain(ERR.itemAmount);
      }
    });
    expect(await itemCount()).toBe(beforeItems);
    expect(await eventCount()).toBe(beforeEvents);
  });

  it('update rejects special amounts and leaves the stored item and events untouched', async () => {
    let itemId = '';
    await asRole('authenticated', U.driverPro, async () => {
      const created = await addItem(S.driverValidation, { amount: '42.00' });
      itemId = created.id;
    });
    const beforeEvents = (await eventsFor(S.driverValidation)).length;
    await asRole('authenticated', U.driverPro, async () => {
      for (const v of SPECIALS) {
        expect(
          await failureMessage(() => updateItem(itemId, { amount: v })),
          v,
        ).toContain(ERR.itemAmount);
      }
    });
    const stored = await itemById(itemId);
    expect(stored?.amount).toBe('42.00');
    expect((await eventsFor(S.driverValidation)).length).toBe(beforeEvents);
    await asRole('authenticated', U.driverPro, () => deleteItem(itemId));
  });

  it('every optional numeric input rejects specials on add and update with the fixed numeric error', async () => {
    let itemId = '';
    await asRole('authenticated', U.driverPro, async () => {
      const created = await addItem(S.driverValidation, { amount: '10.00' });
      itemId = created.id;
    });
    const beforeItems = await itemCount();
    const beforeEvents = await eventCount();

    await asRole('authenticated', U.driverPro, async () => {
      for (const field of OPTIONAL_NUMERICS) {
        for (const v of SPECIALS) {
          expect(
            await failureMessage(() =>
              addItem(S.driverValidation, { amount: '10.00', [field]: v }),
            ),
            `add ${field}=${v}`,
          ).toContain(ERR.itemNumeric);
          expect(
            await failureMessage(() =>
              updateItem(itemId, { amount: '10.00', [field]: v }),
            ),
            `update ${field}=${v}`,
          ).toContain(ERR.itemNumeric);
        }
      }
    });

    expect(await itemCount()).toBe(beforeItems);
    expect(await eventCount()).toBe(beforeEvents);
    const stored = await itemById(itemId);
    expect(stored?.quantity).toBeNull();
    expect(stored?.rate).toBeNull();
    await asRole('authenticated', U.driverPro, () => deleteItem(itemId));
  });

  it('per_mile and percentage shapes cannot smuggle a special rate, miles or revenue value', async () => {
    const beforeItems = await itemCount();
    await asRole('authenticated', U.driverPro, async () => {
      for (const v of SPECIALS) {
        expect(
          await failureMessage(() =>
            addItem(S.driverValidation, {
              itemType: 'load_pay',
              payMethod: 'per_mile',
              amount: '500.00',
              rate: v,
              payableMiles: '400',
            }),
          ),
          `per_mile rate ${v}`,
        ).toContain(ERR.itemNumeric);
        expect(
          await failureMessage(() =>
            addItem(S.driverValidation, {
              itemType: 'load_pay',
              payMethod: 'per_mile',
              amount: '500.00',
              rate: '1.25',
              payableMiles: v,
            }),
          ),
          `per_mile miles ${v}`,
        ).toContain(ERR.itemNumeric);
        expect(
          await failureMessage(() =>
            addItem(S.driverValidation, {
              itemType: 'load_pay',
              payMethod: 'percentage',
              amount: '500.00',
              rate: '70',
              eligibleRevenue: v,
            }),
          ),
          `percentage revenue ${v}`,
        ).toContain(ERR.itemNumeric);
      }
    });
    expect(await itemCount()).toBe(beforeItems);
  });

  it('special-value item errors never leak constraint, SQLSTATE or overflow detail', async () => {
    const msgs: string[] = [];
    await asRole('authenticated', U.driverPro, async () => {
      for (const v of SPECIALS) {
        msgs.push(await failureMessage(() => addItem(S.driverValidation, { amount: v })));
        msgs.push(
          await failureMessage(() =>
            addItem(S.driverValidation, { amount: '10.00', rate: v }),
          ),
        );
      }
    });
    expect(msgs).toHaveLength(6);
    for (const m of msgs) {
      expect(m).not.toMatch(LEAK);
      expect(m).not.toMatch(/overflow|22003|22P02/i);
    }
  });

  it('source contract: both mutating RPC bodies lock the finite guards in place (proof R1)', () => {
    const bodies = CODE.split(/CREATE FUNCTION public\./).slice(1);
    const mutating = bodies.filter((b) => b.includes('_amount numeric'));
    expect(mutating).toHaveLength(2);
    for (const body of mutating) {
      expect(body).toMatch(/_amount::text IN \('NaN', 'Infinity', '-Infinity'\)/);
      for (const p of [
        '_quantity',
        '_rate',
        '_loaded_miles_snapshot',
        '_deadhead_miles_snapshot',
        '_payable_miles_snapshot',
        '_eligible_revenue_snapshot',
      ]) {
        expect(body, p).toMatch(
          new RegExp(`${p}::text IN \\('NaN', 'Infinity', '-Infinity'\\)`),
        );
      }
      // finite guards run before any table write
      const guardAt = body.indexOf("::text IN ('NaN'");
      const writeAt = Math.min(
        ...['INSERT INTO public.driver_settlement_items', 'UPDATE public.driver_settlement_items']
          .map((w) => body.indexOf(w))
          .filter((i) => i >= 0),
      );
      expect(guardAt).toBeGreaterThan(-1);
      expect(guardAt).toBeLessThan(writeAt);
    }
    // expected_amount_snapshot is not caller-settable and gains no guard here
    expect(CODE).not.toMatch(/_expected_amount_snapshot/);
    expect(CODE).not.toMatch(/isfinite/i);
    expect(CODE).not.toMatch(/::\s*(float|double precision|real)/i);
  });
});
