// @vitest-environment node
// =====================================================================
// Phase 1T-B2C4A — Recipient-controlled settlement load-match RPC proofs.
//
// Applies, in order, the REAL accepted Phase 1T-B1, B2A, B2B, B2C1, B2C2A and
// B2C3A candidates and then the REAL Phase 1T-B2C4A candidate inside PGlite on
// a minimal but faithful bootstrap, and proves catalog shape, ACLs, driver-side
// (never carrier/agency) authorization, load ownership/status gating, the
// copied-not-recomputed expected_amount_snapshot contract, deterministic
// rematch, clear + clear-idempotency, and that neither the driver's load row
// nor the reported statement amount is ever modified.
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
} as const;

const read = (rel: string) =>
  fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const B1_SQL = read(REL.b1);
const B2A_SQL = read(REL.b2a);
const B2B_SQL = read(REL.b2b);
const B2C1_SQL = read(REL.b2c1);
const B2C2A_SQL = read(REL.b2c2a);
const B2C3A_SQL = read(REL.b2c3a);
const B2C4A_SQL = read(REL.b2c4a);

/** Executable SQL only: `--` documentation lines removed. */
const CODE = B2C4A_SQL.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const FUNCTIONS = [
  'settlement_clear_load_match',
  'settlement_confirm_load_match',
] as const;

const ERR = {
  invalid: 'settlement_invalid_request',
  itemNotFound: 'settlement_item_not_found',
  notFound: 'settlement_not_found',
  notEditable: 'settlement_not_editable',
  invalidSource: 'settlement_invalid_source',
  notAuthorized: 'settlement_match_not_authorized',
  requiresLoadPay: 'settlement_match_requires_load_pay_item',
  loadNotFound: 'settlement_match_load_not_found',
  loadNotCompleted: 'settlement_match_load_not_completed',
  expectedUnavailable: 'settlement_match_expected_pay_unavailable',
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

interface MatchRow {
  id: string;
  settlement_item_id: string;
  driver_load_id: string;
  match_state: string;
  confidence: string | null;
  matched_by_user_id: string | null;
  matched_at: unknown;
}

interface ItemRow {
  id: string;
  settlement_id: string;
  item_type: string;
  amount: string;
  pay_method: string | null;
  expected_amount_snapshot: string | null;
}

interface EventRow {
  id: string;
  settlement_id: string;
  actor_user_id: string | null;
  event_type: string;
  metadata: Record<string, unknown>;
}

interface LoadRow {
  id: string;
  user_id: string;
  status: string;
  load_date: string;
  estimated_pay: string | null;
  actual_pay_received: string | null;
  updated_at: unknown;
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
const I: Record<string, string> = {};
const L: Record<string, string> = {};

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

const CONFIRM_SQL = `SELECT * FROM public.settlement_confirm_load_match($1::uuid, $2::uuid)`;
const CLEAR_SQL = `SELECT public.settlement_clear_load_match($1::uuid) AS id`;

async function confirm(itemId: string | null, loadId: string | null): Promise<MatchRow> {
  const r = await db.query<MatchRow>(CONFIRM_SQL, [itemId, loadId]);
  return r.rows[0];
}

async function clearMatch(itemId: string | null): Promise<string> {
  const r = await db.query<{ id: string }>(CLEAR_SQL, [itemId]);
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
    `SELECT * FROM public.driver_settlement_items WHERE id=$1`,
    [id],
  );
  return r.rows[0];
}

async function loadById(id: string): Promise<LoadRow | undefined> {
  const r = await db.query<LoadRow>(
    `SELECT id, user_id, status, load_date::text AS load_date,
            estimated_pay::text AS estimated_pay,
            actual_pay_received::text AS actual_pay_received,
            updated_at::text AS updated_at
       FROM public.loads WHERE id=$1`,
    [id],
  );
  return r.rows[0];
}

async function matchesFor(itemId: string): Promise<MatchRow[]> {
  const r = await db.query<MatchRow>(
    `SELECT * FROM public.driver_settlement_matches
      WHERE settlement_item_id=$1 ORDER BY match_state, created_at, id`,
    [itemId],
  );
  return r.rows;
}

async function matchCount(): Promise<number> {
  const r = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM public.driver_settlement_matches`,
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

/** Fixture-only helpers built on the accepted prior-phase RPCs. */
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

/** Adds a line item to a DRAFT settlement through the accepted B2C3A RPC. */
async function addItem(
  settlementId: string,
  actor: string,
  itemType: 'load_pay' | 'deduction',
  amount: string,
): Promise<string> {
  return asRole('authenticated', actor, async () => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM public.settlement_add_draft_item(
         $1::uuid, $2::text, NULL, 'fixture', $3::numeric,
         $4::text, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
         NULL, NULL, NULL, NULL, 0)`,
      [settlementId, itemType, amount, itemType === 'load_pay' ? 'flat_rate' : null],
    );
    return r.rows[0].id;
  });
}

async function mkLoad(
  owner: string,
  status: string,
  estimatedPay: string | null,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.loads (user_id, status, estimated_pay)
     VALUES ($1,$2,$3::numeric) RETURNING id`,
    [owner, status, estimatedPay],
  );
  return r.rows[0].id;
}

async function finalize(settlementId: string): Promise<void> {
  await db.query(
    `UPDATE public.driver_settlements SET status='finalized' WHERE id=$1`,
    [settlementId],
  );
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
  await db.exec(B2C3A_SQL);

  beforeTables = await names(TABLES_SQL);
  beforeFunctions = await names(FUNCS_SQL);
  beforeIndexes = await names(IDX_SQL);
  beforeTriggers = await names(TRIGS_SQL);
  beforeViews = await names(VIEWS_SQL);
  beforeTypes = await names(TYPES_SQL);
  beforePolicies = await names(POLICIES_SQL);

  await db.exec(B2C4A_SQL);

  afterTables = await names(TABLES_SQL);
  afterFunctions = await names(FUNCS_SQL);
  afterIndexes = await names(IDX_SQL);
  afterTriggers = await names(TRIGS_SQL);
  afterViews = await names(VIEWS_SQL);
  afterTypes = await names(TYPES_SQL);
  afterPolicies = await names(POLICIES_SQL);

  for (const k of [
    'driverPro',
    'driverDown',
    'carrierDriver',
    'agencyDriver',
    'assistantManage',
    'assistantView',
    'agencyAssistant',
    'paidCarrier',
    'agencyOwner',
    'agencyMember',
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
  await sub(U.driverDown, 'pro_monthly', 'active');

  R.paid = (
    await db.query<{ id: string }>(
      `INSERT INTO public.recruiter_profiles (user_id, company_name)
       VALUES ($1,'Blue Line Freight') RETURNING id`,
      [U.paidCarrier],
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO public.recruiter_billing_profiles (recruiter_id, user_id, plan, status)
     VALUES ($1,$2,'growth','active')`,
    [R.paid, U.paidCarrier],
  );

  A.paid = (
    await db.query<{ id: string }>(
      `INSERT INTO public.agency_profiles (owner_user_id, name, status)
       VALUES ($1,'Acme Back Office','active') RETURNING id`,
      [U.agencyOwner],
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO public.agency_entitlements (agency_id, plan_key, status)
     VALUES ($1,'agency_team','active')`,
    [A.paid],
  );
  await db.query(
    `INSERT INTO public.agency_members (agency_id, member_user_id, role, status)
     VALUES ($1,$2,'agency_owner','active'), ($1,$3,'agency_member','active')`,
    [A.paid, U.agencyOwner, U.agencyMember],
  );
  await db.query(
    `INSERT INTO public.agency_delegation_requests
       (agency_id, driver_user_id, member_user_id, status, requested_permissions)
     VALUES ($1,$2,$3,'approved','{"settlements_manage":true}'::jsonb)`,
    [A.paid, U.agencyDriver, U.agencyMember],
  );

  // Direct assistants (manage / view-only) plus an AGENCY-GENERATED row that
  // must never qualify through the direct-assistant path.
  await db.query(
    `INSERT INTO public.driver_assistants
       (driver_user_id, assistant_user_id, status, permissions, agency_delegation_id)
     VALUES
       ($1,$4,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, NULL),
       ($2,$4,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, NULL),
       ($3,$4,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, NULL),
       ($3,$5,'active','{"settlements_view":true}'::jsonb, NULL),
       ($3,$6,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, gen_random_uuid())`,
    [
      U.driverPro,
      U.driverDown,
      U.carrierDriver,
      U.assistantManage,
      U.assistantView,
      U.agencyAssistant,
    ],
  );

  RELS.active = (
    await db.query<{ id: string }>(
      `INSERT INTO public.carrier_driver_relationships
         (recruiter_id, driver_user_id, status, created_by_user_id, accepted_at)
       VALUES ($1,$2,'active',$1, now()) RETURNING id`,
      [R.paid, U.carrierDriver],
    )
  ).rows[0].id;

  // --- settlements ---------------------------------------------------------
  S.carrierFinal = await mkDraftCarrier(
    R.paid,
    RELS.active,
    U.carrierDriver,
    U.paidCarrier,
  );
  S.carrierDraft = await mkDraftCarrier(
    R.paid,
    RELS.active,
    U.carrierDriver,
    U.paidCarrier,
  );
  S.agencyFinal = await mkDraftAgency(A.paid, U.agencyDriver, U.agencyMember);
  S.driverDraftPro = await mkDraftDriverImported(U.driverPro, U.driverPro);
  S.driverDraftDown = await mkDraftDriverImported(U.driverDown, U.driverDown);
  S.driverFinalDown = await mkDraftDriverImported(U.driverDown, U.driverDown);
  S.driverVoided = await mkDraftDriverImported(U.driverPro, U.driverPro);

  // --- items (added while the parents are still drafts) --------------------
  I.carrierFinal = await addItem(S.carrierFinal, U.paidCarrier, 'load_pay', '1200.00');
  I.carrierFinalB = await addItem(S.carrierFinal, U.paidCarrier, 'load_pay', '950.00');
  I.carrierFinalDeduct = await addItem(
    S.carrierFinal,
    U.paidCarrier,
    'deduction',
    '75.00',
  );
  I.carrierFinalRematch = await addItem(
    S.carrierFinal,
    U.paidCarrier,
    'load_pay',
    '1500.00',
  );
  I.carrierFinalClear = await addItem(
    S.carrierFinal,
    U.paidCarrier,
    'load_pay',
    '640.00',
  );
  I.carrierFinalAssist = await addItem(
    S.carrierFinal,
    U.paidCarrier,
    'load_pay',
    '410.00',
  );
  I.carrierDraft = await addItem(S.carrierDraft, U.paidCarrier, 'load_pay', '300.00');
  I.agencyFinal = await addItem(S.agencyFinal, U.agencyMember, 'load_pay', '800.00');
  I.driverDraftPro = await addItem(S.driverDraftPro, U.driverPro, 'load_pay', '500.00');
  I.driverDraftProB = await addItem(S.driverDraftPro, U.driverPro, 'load_pay', '505.00');
  I.driverDraftDown = await addItem(
    S.driverDraftDown,
    U.driverDown,
    'load_pay',
    '600.00',
  );
  I.driverDraftDownB = await addItem(
    S.driverDraftDown,
    U.driverDown,
    'load_pay',
    '601.00',
  );
  I.driverFinalDown = await addItem(
    S.driverFinalDown,
    U.driverDown,
    'load_pay',
    '700.00',
  );
  I.driverFinalDownB = await addItem(
    S.driverFinalDown,
    U.driverDown,
    'load_pay',
    '701.00',
  );
  I.driverVoided = await addItem(S.driverVoided, U.driverPro, 'load_pay', '900.00');
  // Dedicated R1 fixtures — never touched by any earlier proof.
  I.promoLikely = await addItem(S.carrierFinal, U.paidCarrier, 'load_pay', '1310.00');
  I.promoReconfirm = await addItem(S.carrierFinal, U.paidCarrier, 'load_pay', '1320.00');

  await finalize(S.carrierFinal);
  await finalize(S.agencyFinal);
  await finalize(S.driverFinalDown);
  await db.query(`UPDATE public.driver_settlements SET status='voided' WHERE id=$1`, [
    S.driverVoided,
  ]);

  // --- loads ---------------------------------------------------------------
  L.carrierA = await mkLoad(U.carrierDriver, 'completed', '1187.25');
  L.carrierB = await mkLoad(U.carrierDriver, 'completed', '944.10');
  L.carrierC = await mkLoad(U.carrierDriver, 'completed', '620.00');
  L.carrierD = await mkLoad(U.carrierDriver, 'completed', '400.00');
  L.carrierPending = await mkLoad(U.carrierDriver, 'pending', '100.00');
  L.carrierCancelled = await mkLoad(U.carrierDriver, 'cancelled', '100.00');
  L.carrierNullPay = await mkLoad(U.carrierDriver, 'completed', null);
  L.agencyA = await mkLoad(U.agencyDriver, 'completed', '780.55');
  L.driverProA = await mkLoad(U.driverPro, 'completed', '499.00');
  L.driverProB = await mkLoad(U.driverPro, 'completed', '498.00');
  L.driverDownA = await mkLoad(U.driverDown, 'completed', '599.00');
  L.driverDownB = await mkLoad(U.driverDown, 'completed', '598.00');
  L.strangerA = await mkLoad(U.stranger, 'completed', '111.00');

  // driverDown loses Pro AFTER all fixtures exist.
  await db.query(
    `UPDATE public.subscriptions SET status='canceled' WHERE user_id=$1`,
    [U.driverDown],
  );
});

// =====================================================================
describe('Phase 1T-B2C4A — catalog, ACL and source contract (proof 1)', () => {
  it('all seven real candidates apply in order and add exactly two functions', () => {
    expect(beforeTables).toEqual(
      expect.arrayContaining([
        'driver_settlements',
        'driver_settlement_items',
        'driver_settlement_matches',
        'driver_settlement_events',
      ]),
    );
    const added = afterFunctions.filter((n) => !beforeFunctions.includes(n)).sort();
    expect(added).toEqual([...FUNCTIONS].sort());
    expect(afterTables).toEqual(beforeTables);
    expect(afterIndexes).toEqual(beforeIndexes);
    expect(afterTriggers).toEqual(beforeTriggers);
    expect(afterViews).toEqual(beforeViews);
    expect(afterTypes).toEqual(beforeTypes);
    expect(afterPolicies).toEqual(beforePolicies);
  });

  it('both are plpgsql SECURITY DEFINER, VOLATILE, locked search_path, correct ACL', async () => {
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

  it('source contract: candidate-only, no dynamic SQL, no bypass, no load writes', () => {
    expect(B2C4A_SQL).toContain('CANDIDATE MIGRATION — NOT APPLIED LIVE');
    // exactly the two named functions, no replace/drop semantics
    expect(CODE.match(/CREATE FUNCTION/g)?.length).toBe(2);
    expect(CODE).toContain('CREATE FUNCTION public.settlement_confirm_load_match(');
    expect(CODE).toContain('CREATE FUNCTION public.settlement_clear_load_match(');
    for (const bad of [
      /CREATE OR REPLACE/i,
      /\bDROP\b/i,
      /IF NOT EXISTS/i,
      /\bEXECUTE\s+(?!ON FUNCTION)/i,
      /format\s*\(/i,
      /current_setting\s*\(/i,
      /\bemail\b/i,
      /is_admin|service_role_key|has_role/i,
      /_actor_user_id|_caller|_acting_user/i,
      /CREATE POLICY|ALTER POLICY|DROP POLICY/i,
      /CREATE TABLE|ALTER TABLE|CREATE TRIGGER|CREATE INDEX|CREATE TYPE/i,
      /GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\s+ON\s+(TABLE\s+)?public\./i,
    ]) {
      expect(`${bad}:${bad.test(CODE)}`).toBe(`${bad}:false`);
    }
    // never writes loads
    expect(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.loads/i.test(CODE)).toBe(
      false,
    );
    // never touches carrier/agency management helpers
    expect(CODE).not.toContain('settlement_current_user_can_manage_carrier');
    expect(CODE).not.toContain('settlement_current_user_can_manage_agency');
    expect(CODE).not.toContain('settlement_current_user_can_administer_carrier');
    // ACL block present
    expect(CODE).toContain(
      'REVOKE ALL ON FUNCTION public.settlement_confirm_load_match(uuid, uuid) FROM PUBLIC, anon;',
    );
    expect(CODE).toContain(
      'REVOKE ALL ON FUNCTION public.settlement_clear_load_match(uuid) FROM PUBLIC, anon;',
    );
    // suggestion states are never authored here
    expect(/'(likely|possible|rejected)'\s*(,|\))/.test(CODE)).toBe(false);
    expect(CODE).toContain("'confirmed',\n    NULL,");
    // candidate never lands under supabase/migrations
    expect(
      fs.existsSync(
        fileURLToPath(
          new URL(
            '../../supabase/migrations/20260808175000_phase1t_b2c4a_settlement_load_match_rpcs.sql',
            import.meta.url,
          ),
        ),
      ),
    ).toBe(false);
  });

  it('anon cannot execute either RPC', async () => {
    await asRole('anon', null, async () => {
      expect(await failureMessage(() => confirm(I.carrierFinal, L.carrierA))).toMatch(
        /permission denied/i,
      );
      expect(await failureMessage(() => clearMatch(I.carrierFinal))).toMatch(
        /permission denied/i,
      );
    });
  });

  it('null actor / null arguments fail with the fixed request error', async () => {
    const m = await matchCount();
    const e = await eventCount();
    await asRole('authenticated', null, async () => {
      expect(await failureMessage(() => confirm(I.carrierFinal, L.carrierA))).toContain(
        ERR.invalid,
      );
      expect(await failureMessage(() => clearMatch(I.carrierFinal))).toContain(
        ERR.invalid,
      );
    });
    await asRole('authenticated', U.carrierDriver, async () => {
      expect(await failureMessage(() => confirm(null, L.carrierA))).toContain(
        ERR.invalid,
      );
      expect(await failureMessage(() => confirm(I.carrierFinal, null))).toContain(
        ERR.invalid,
      );
      expect(await failureMessage(() => clearMatch(null))).toContain(ERR.invalid);
      expect(
        await failureMessage(() =>
          confirm('00000000-0000-4000-8000-000000000000', L.carrierA),
        ),
      ).toContain(ERR.itemNotFound);
    });
    expect(await matchCount()).toBe(m);
    expect(await eventCount()).toBe(e);
  });
});

// =====================================================================
describe('Phase 1T-B2C4A — recipient confirmation', () => {
  it('FREE recipient confirms on a FINALIZED carrier_issued statement (proof 2)', async () => {
    const loadBefore = await loadById(L.carrierA);
    const match = await asRole('authenticated', U.carrierDriver, () =>
      confirm(I.carrierFinal, L.carrierA),
    );

    expect(match.match_state).toBe('confirmed');
    expect(match.confidence).toBeNull();
    expect(match.matched_by_user_id).toBe(U.carrierDriver);
    expect(match.driver_load_id).toBe(L.carrierA);

    const rows = await matchesFor(I.carrierFinal);
    expect(rows.length).toBe(1);

    const item = await itemById(I.carrierFinal);
    // expected snapshot is COPIED from loads.estimated_pay, amount untouched
    expect(item?.expected_amount_snapshot).toBe('1187.25');
    expect(item?.amount).toBe('1200.00');

    // the driver's load row is byte-identical before/after
    expect(await loadById(L.carrierA)).toEqual(loadBefore);

    const evts = (await eventsFor(S.carrierFinal)).filter(
      (e) => e.event_type === 'match_confirmed',
    );
    expect(evts.length).toBe(1);
    expect(evts[0].actor_user_id).toBe(U.carrierDriver);
    expect(evts[0].metadata).toMatchObject({
      source: 'carrier_issued',
      item_id: I.carrierFinal,
      driver_load_id: L.carrierA,
      change: 'load_match_confirmed',
    });
  });

  it('FREE recipient confirms on a FINALIZED agency_prepared statement (proof 3)', async () => {
    const match = await asRole('authenticated', U.agencyDriver, () =>
      confirm(I.agencyFinal, L.agencyA),
    );
    expect(match.match_state).toBe('confirmed');
    expect(match.confidence).toBeNull();
    expect((await itemById(I.agencyFinal))?.expected_amount_snapshot).toBe('780.55');
    const evts = (await eventsFor(S.agencyFinal)).filter(
      (e) => e.event_type === 'match_confirmed',
    );
    expect(evts.length).toBe(1);
    expect(evts[0].metadata).toMatchObject({ source: 'agency_prepared' });
  });

  it('carrier and agency actors cannot match merely because they manage it (proof 4)', async () => {
    const matches = await matchCount();
    const events = await eventCount();
    for (const [actor, item, load] of [
      [U.paidCarrier, I.carrierFinalB, L.carrierB],
      [U.agencyOwner, I.agencyFinal, L.agencyA],
      [U.agencyMember, I.agencyFinal, L.agencyA],
      [U.stranger, I.carrierFinalB, L.carrierB],
    ] as const) {
      expect(await failureMessage(() => asRole('authenticated', actor, () => confirm(item, load))))
        .toContain(ERR.notAuthorized);
      expect(await failureMessage(() => asRole('authenticated', actor, () => clearMatch(item))))
        .toContain(ERR.notAuthorized);
    }
    expect(await matchCount()).toBe(matches);
    expect(await eventCount()).toBe(events);
    expect((await itemById(I.carrierFinalB))?.expected_amount_snapshot).toBeNull();
  });

  it('recipient cannot match a business-sourced DRAFT (proof 5)', async () => {
    const matches = await matchCount();
    const events = await eventCount();
    await asRole('authenticated', U.carrierDriver, async () => {
      expect(await failureMessage(() => confirm(I.carrierDraft, L.carrierB))).toContain(
        ERR.notEditable,
      );
      expect(await failureMessage(() => clearMatch(I.carrierDraft))).toContain(
        ERR.notEditable,
      );
    });
    // voided is never matchable either
    await asRole('authenticated', U.driverPro, async () => {
      expect(await failureMessage(() => confirm(I.driverVoided, L.driverProA))).toContain(
        ERR.notEditable,
      );
    });
    expect(await matchCount()).toBe(matches);
    expect(await eventCount()).toBe(events);
  });

  it('driver_imported DRAFT requires active Pro (or Pro-backed assistant) (proof 6)', async () => {
    // Active Pro recipient succeeds.
    const ok = await asRole('authenticated', U.driverPro, () =>
      confirm(I.driverDraftPro, L.driverProA),
    );
    expect(ok.match_state).toBe('confirmed');
    expect((await itemById(I.driverDraftPro))?.expected_amount_snapshot).toBe('499.00');

    // Downgraded recipient cannot.
    expect(
      await failureMessage(() =>
        asRole('authenticated', U.driverDown, () =>
          confirm(I.driverDraftDown, L.driverDownA),
        ),
      ),
    ).toContain(ERR.notAuthorized);

    // Direct assistant with settlements_manage but a NON-Pro target driver cannot.
    expect(
      await failureMessage(() =>
        asRole('authenticated', U.assistantManage, () =>
          confirm(I.driverDraftDownB, L.driverDownB),
        ),
      ),
    ).toContain(ERR.notAuthorized);

    // Direct assistant with settlements_manage and a Pro target driver can.
    const assisted = await asRole('authenticated', U.assistantManage, () =>
      confirm(I.driverDraftProB, L.driverProB),
    );
    expect(assisted.matched_by_user_id).toBe(U.assistantManage);
  });

  it('FINALIZED driver_imported needs no current Pro for basic reconciliation (proof 7)', async () => {
    const recipient = await asRole('authenticated', U.driverDown, () =>
      confirm(I.driverFinalDown, L.driverDownA),
    );
    expect(recipient.match_state).toBe('confirmed');
    expect((await itemById(I.driverFinalDown))?.expected_amount_snapshot).toBe('599.00');

    const assisted = await asRole('authenticated', U.assistantManage, () =>
      confirm(I.driverFinalDownB, L.driverDownB),
    );
    expect(assisted.matched_by_user_id).toBe(U.assistantManage);
  });

  it('view-only and agency-generated assistant rows cannot mutate (proof 8)', async () => {
    const matches = await matchCount();
    const events = await eventCount();
    for (const actor of [U.assistantView, U.agencyAssistant]) {
      expect(
        await failureMessage(() =>
          asRole('authenticated', actor, () => confirm(I.carrierFinalB, L.carrierB)),
        ),
      ).toContain(ERR.notAuthorized);
      expect(
        await failureMessage(() =>
          asRole('authenticated', actor, () => clearMatch(I.carrierFinalB)),
        ),
      ).toContain(ERR.notAuthorized);
    }
    expect(await matchCount()).toBe(matches);
    expect(await eventCount()).toBe(events);
  });
});

// =====================================================================
describe('Phase 1T-B2C4A — load selection gates', () => {
  it('cross-driver load fails closed and changes nothing (proof 9)', async () => {
    const loadBefore = await loadById(L.strangerA);
    const matches = await matchCount();
    const events = await eventCount();
    expect(
      await failureMessage(() =>
        asRole('authenticated', U.carrierDriver, () =>
          confirm(I.carrierFinalB, L.strangerA),
        ),
      ),
    ).toContain(ERR.loadNotFound);
    expect(await loadById(L.strangerA)).toEqual(loadBefore);
    expect(await matchCount()).toBe(matches);
    expect(await eventCount()).toBe(events);
    expect((await itemById(I.carrierFinalB))?.expected_amount_snapshot).toBeNull();
  });

  it('pending and cancelled loads fail; completed succeeds (proof 10)', async () => {
    await asRole('authenticated', U.carrierDriver, async () => {
      expect(
        await failureMessage(() => confirm(I.carrierFinalB, L.carrierPending)),
      ).toContain(ERR.loadNotCompleted);
      expect(
        await failureMessage(() => confirm(I.carrierFinalB, L.carrierCancelled)),
      ).toContain(ERR.loadNotCompleted);
      const ok = await confirm(I.carrierFinalB, L.carrierB);
      expect(ok.match_state).toBe('confirmed');
    });
    expect((await itemById(I.carrierFinalB))?.expected_amount_snapshot).toBe('944.10');
  });

  it('non-load_pay items are rejected (proof 11)', async () => {
    const matches = await matchCount();
    await asRole('authenticated', U.carrierDriver, async () => {
      expect(
        await failureMessage(() => confirm(I.carrierFinalDeduct, L.carrierC)),
      ).toContain(ERR.requiresLoadPay);
      expect(await failureMessage(() => clearMatch(I.carrierFinalDeduct))).toContain(
        ERR.requiresLoadPay,
      );
    });
    expect(await matchCount()).toBe(matches);
  });

  it('unusable expected pay fails closed before any write (proof 12)', async () => {
    const matches = await matchCount();
    const events = await eventCount();
    expect(
      await failureMessage(() =>
        asRole('authenticated', U.carrierDriver, () =>
          confirm(I.carrierFinalRematch, L.carrierNullPay),
        ),
      ),
    ).toContain(ERR.expectedUnavailable);
    expect(await matchCount()).toBe(matches);
    expect(await eventCount()).toBe(events);
    expect((await itemById(I.carrierFinalRematch))?.expected_amount_snapshot).toBeNull();

    // source contract: explicit non-finite + bound guards precede mutation
    const guard = CODE.slice(
      CODE.indexOf('v_expected IS NULL'),
      CODE.indexOf('settlement_match_expected_pay_unavailable'),
    );
    expect(guard).toContain("'NaN'");
    expect(guard).toContain("'Infinity'");
    expect(guard).toContain("'-Infinity'");
    expect(guard).toContain('999999999999.99');
    expect(CODE.indexOf('settlement_match_expected_pay_unavailable')).toBeLessThan(
      CODE.indexOf('INSERT INTO public.driver_settlement_matches'),
    );
    // snapshot is copied, never recomputed, and never sourced from actual pay
    expect(CODE).toContain('expected_amount_snapshot = v_expected');
    expect(CODE).not.toContain('actual_pay_received');
  });
});

// =====================================================================
describe('Phase 1T-B2C4A — rematch, clear and idempotency', () => {
  it('rematch replaces only the accepted state (proof 13)', async () => {
    const loadCBefore = await loadById(L.carrierC);
    const loadDBefore = await loadById(L.carrierD);

    await asRole('authenticated', U.carrierDriver, async () => {
      await confirm(I.carrierFinalRematch, L.carrierC);
    });
    expect((await itemById(I.carrierFinalRematch))?.expected_amount_snapshot).toBe(
      '620.00',
    );

    // pre-seed non-accepted suggestion history that must survive
    await db.query(
      `INSERT INTO public.driver_settlement_matches
         (settlement_item_id, driver_load_id, match_state, confidence)
       VALUES ($1,$2,'likely',0.8000)`,
      [I.carrierFinalRematch, L.carrierPending],
    );

    await asRole('authenticated', U.carrierDriver, async () => {
      await confirm(I.carrierFinalRematch, L.carrierD);
    });

    const rows = await matchesFor(I.carrierFinalRematch);
    const accepted = rows.filter((r) => ['exact', 'confirmed'].includes(r.match_state));
    expect(accepted.length).toBe(1);
    expect(accepted[0].driver_load_id).toBe(L.carrierD);
    expect(rows.some((r) => r.match_state === 'likely')).toBe(true);

    const item = await itemById(I.carrierFinalRematch);
    expect(item?.expected_amount_snapshot).toBe('400.00');
    expect(item?.amount).toBe('1500.00'); // reported amount never recalculated

    expect(await loadById(L.carrierC)).toEqual(loadCBefore);
    expect(await loadById(L.carrierD)).toEqual(loadDBefore);
  });

  it('clear removes accepted match + snapshot and writes one event (proof 14)', async () => {
    await asRole('authenticated', U.carrierDriver, async () => {
      await confirm(I.carrierFinalClear, L.carrierC);
    });
    await db.query(
      `INSERT INTO public.driver_settlement_matches
         (settlement_item_id, driver_load_id, match_state, confidence)
       VALUES ($1,$2,'possible',0.5000), ($1,$3,'rejected',NULL)`,
      [I.carrierFinalClear, L.carrierPending, L.carrierCancelled],
    );

    const before = (await eventsFor(S.carrierFinal)).length;
    const returned = await asRole('authenticated', U.carrierDriver, () =>
      clearMatch(I.carrierFinalClear),
    );
    expect(returned).toBe(I.carrierFinalClear);

    const rows = await matchesFor(I.carrierFinalClear);
    expect(rows.map((r) => r.match_state).sort()).toEqual(['possible', 'rejected']);
    expect((await itemById(I.carrierFinalClear))?.expected_amount_snapshot).toBeNull();

    const evts = await eventsFor(S.carrierFinal);
    expect(evts.length).toBe(before + 1);
    const last = evts[evts.length - 1];
    expect(last.event_type).toBe('updated');
    expect(last.actor_user_id).toBe(U.carrierDriver);
    expect(last.metadata).toMatchObject({
      source: 'carrier_issued',
      item_id: I.carrierFinalClear,
      change: 'load_match_cleared',
    });
  });

  it('clearing again is idempotent and writes no event (proof 15)', async () => {
    const before = await eventCount();
    const itemBefore = await itemById(I.carrierFinalClear);
    const returned = await asRole('authenticated', U.carrierDriver, () =>
      clearMatch(I.carrierFinalClear),
    );
    expect(returned).toBe(I.carrierFinalClear);
    expect(await eventCount()).toBe(before);
    expect(await itemById(I.carrierFinalClear)).toEqual(itemBefore);

    // a never-matched line is also a silent no-op
    const before2 = await eventCount();
    const returned2 = await asRole('authenticated', U.carrierDriver, () =>
      clearMatch(I.carrierFinalAssist),
    );
    expect(returned2).toBe(I.carrierFinalAssist);
    expect(await eventCount()).toBe(before2);
  });

  it('fixed errors, locking and no-load-write source contract (proof 16)', async () => {
    // no raw database text leaks from any observed failure path
    const messages: string[] = [];
    await asRole('authenticated', U.carrierDriver, async () => {
      messages.push(await failureMessage(() => confirm(I.carrierDraft, L.carrierB)));
      messages.push(await failureMessage(() => confirm(I.carrierFinalB, L.strangerA)));
      messages.push(
        await failureMessage(() => confirm(I.carrierFinalB, L.carrierPending)),
      );
      messages.push(
        await failureMessage(() => confirm(I.carrierFinalDeduct, L.carrierC)),
      );
      messages.push(
        await failureMessage(() =>
          confirm('00000000-0000-4000-8000-000000000000', L.carrierB),
        ),
      );
    });
    const allowed = Object.values(ERR);
    for (const m of messages) {
      expect(LEAK.test(m)).toBe(false);
      expect(allowed.some((a) => m.includes(a))).toBe(true);
    }

    // parent locked before any match mutation; item locked; load non-mutating lock
    const parentLock = CODE.indexOf('FROM public.driver_settlements ds');
    expect(CODE.slice(parentLock, parentLock + 200)).toContain('FOR UPDATE');
    expect(CODE).toContain('FOR KEY SHARE');
    expect(CODE.indexOf('FOR UPDATE')).toBeLessThan(
      CODE.indexOf('DELETE FROM public.driver_settlement_matches'),
    );
    expect(
      /FROM public\.driver_settlement_items dsi\s+WHERE dsi\.id = _settlement_item_id\s+AND dsi\.settlement_id = v_parent\.id\s+FOR UPDATE/.test(
        CODE,
      ),
    ).toBe(true);

    // the item UPDATE touches ONLY reconciliation metadata
    const updates = CODE.match(
      /UPDATE public\.driver_settlement_items dsi\n\s*SET ([\s\S]*?)\n\s*WHERE/g,
    );
    expect(updates?.length).toBe(2);
    for (const u of updates ?? []) {
      expect(u).toContain('expected_amount_snapshot');
      expect(u).toContain('updated_at');
      expect(/\bamount =|\bitem_type =|\bpay_method =|\bsettlement_id =/.test(u)).toBe(
        false,
      );
    }

    // direct client DML on settlement tables is still blocked by B2B RLS
    await asRole('authenticated', U.carrierDriver, async () => {
      const msg = await failureMessage(() =>
        db.query(
          `INSERT INTO public.driver_settlement_matches
             (settlement_item_id, driver_load_id, match_state)
           VALUES ($1,$2,'confirmed')`,
          [I.carrierFinalAssist, L.carrierC],
        ),
      );
      expect(msg).toMatch(/row-level security|permission denied/i);
    });
  });
});
