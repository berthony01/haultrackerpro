// @vitest-environment node
// =====================================================================
// Phase 1T-B2C4B — Deterministic advanced load-match SUGGESTION proofs.
//
// Applies, in order, the REAL accepted Phase 1T-B1, B2A, B2B, B2C1, B2C2A,
// B2C3A and B2C4A candidates and then the REAL Phase 1T-B2C4B candidate inside
// PGlite on a minimal but faithful bootstrap, and proves catalog shape, ACLs,
// active-Pro driver-side (never carrier/agency) authorization, the bounded
// candidate window, the exact five-signal deterministic score, the top-25
// ranking cap, that acceptance always wins, that rejected pairs are never
// resurrected, that refresh is idempotent and item-scoped, and that nothing
// outside driver_settlement_matches is ever written.
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
const SELF_SRC = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');

/** Executable SQL only: `--` documentation lines removed. */
const CODE = B2C4B_SQL.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const FN = 'settlement_refresh_load_match_suggestions';

const ERR = {
  invalid: 'settlement_invalid_request',
  itemNotFound: 'settlement_item_not_found',
  notFound: 'settlement_not_found',
  invalidSource: 'settlement_invalid_source',
  notEditable: 'settlement_not_editable',
  notAuthorized: 'settlement_suggestions_not_authorized',
  requiresLoadPay: 'settlement_match_requires_load_pay_item',
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
  item_type: string;
  amount: string;
  expected_amount_snapshot: string | null;
  updated_at: string;
}

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

const REFRESH_SQL = `SELECT id, settlement_item_id, driver_load_id, match_state,
                            confidence::text AS confidence, matched_by_user_id,
                            matched_at::text AS matched_at
                       FROM public.${FN}($1::uuid)`;

async function refresh(actor: string, itemId: string | null): Promise<MatchRow[]> {
  return asRole('authenticated', actor, async () => {
    const r = await db.query<MatchRow>(REFRESH_SQL, [itemId]);
    return r.rows;
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

async function mkSettlement(
  driver: string,
  status: 'draft' | 'finalized' | 'voided' | 'superseded',
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlements
       (driver_user_id, source, status, period_start, period_end, created_by_user_id)
     VALUES ($1,'driver_imported',$2,$3::date,$4::date,$1) RETURNING id`,
    [driver, status, P1, P2],
  );
  return r.rows[0].id;
}

interface Snap {
  delivery?: string | null;
  origin?: string | null;
  destination?: string | null;
  miles?: string | null;
}

async function mkItem(
  settlementId: string,
  creator: string,
  amount: string,
  snap: Snap = {},
  itemType: 'load_pay' | 'deduction' = 'load_pay',
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlement_items
       (settlement_id, item_type, amount, delivery_date_snapshot,
        origin_snapshot, destination_snapshot, loaded_miles_snapshot,
        created_by_user_id)
     VALUES ($1,$2,$3::numeric,$4::date,$5,$6,$7::numeric,$8) RETURNING id`,
    [
      settlementId,
      itemType,
      amount,
      snap.delivery ?? null,
      snap.origin ?? null,
      snap.destination ?? null,
      snap.miles ?? null,
      creator,
    ],
  );

  return r.rows[0].id;
}

interface LoadSpec {
  status?: string;
  dropoff?: string | null;
  loadDate?: string;
  pickup?: string;
  dest?: string;
  miles?: string | null;
  pay?: string | null;
}

async function mkLoad(owner: string, spec: LoadSpec = {}): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.loads
       (user_id, status, load_date, dropoff_date, pickup_location,
        dropoff_location, loaded_miles, estimated_pay)
     VALUES ($1,$2,$3::date,$4::date,$5,$6,$7::numeric,$8::numeric) RETURNING id`,
    [
      owner,
      spec.status ?? 'completed',
      spec.loadDate ?? '2026-07-02',
      spec.dropoff ?? null,
      spec.pickup ?? '',
      spec.dest ?? '',
      spec.miles ?? null,
      spec.pay ?? null,
    ],
  );
  return r.rows[0].id;
}

async function matchesFor(itemId: string): Promise<MatchRow[]> {
  const r = await db.query<MatchRow>(
    `SELECT id, settlement_item_id, driver_load_id, match_state,
            confidence::text AS confidence, matched_by_user_id,
            matched_at::text AS matched_at
       FROM public.driver_settlement_matches
      WHERE settlement_item_id=$1
      ORDER BY match_state, driver_load_id`,
    [itemId],
  );
  return r.rows;
}

async function itemById(id: string): Promise<ItemRow> {
  const r = await db.query<ItemRow>(
    `SELECT id, item_type, amount::text AS amount,
            expected_amount_snapshot::text AS expected_amount_snapshot,
            updated_at::text AS updated_at
       FROM public.driver_settlement_items WHERE id=$1`,
    [id],
  );
  return r.rows[0];
}

async function eventCount(): Promise<number> {
  const r = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM public.driver_settlement_events`,
  );
  return Number(r.rows[0].c);
}

async function loadFingerprints(): Promise<string> {
  const r = await db.query<{ f: string }>(
    `SELECT coalesce(string_agg(
              id::text || '|' || status || '|' || coalesce(estimated_pay::text,'-')
                || '|' || coalesce(loaded_miles::text,'-') || '|' || updated_at::text,
              ',' ORDER BY id), '') AS f
       FROM public.loads`,
  );
  return r.rows[0].f;
}

const CAP_IDS: string[] = [];

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

  before = await snapshotCatalog();
  await db.exec(B2C4B_SQL);
  after = await snapshotCatalog();

  for (const k of [
    'dScore',
    'dPay',
    'dAccepted',
    'dRejected',
    'dCap',
    'dNaN',
    'dAssist',
    'dDown',
    'dCarrier',
    'dAgency',
    'assistantManage',
    'assistantView',
    'paidCarrier',
    'agencyOwner',
    'agencyMember',
    'stranger',
  ]) {
    U[k] = await newUser();
  }

  const sub = (uid: string, status: string) =>
    db.query(
      `INSERT INTO public.subscriptions (user_id, plan_key, status) VALUES ($1,'pro_monthly',$2)`,
      [uid, status],
    );
  for (const k of [
    'dScore',
    'dPay',
    'dAccepted',
    'dRejected',
    'dCap',
    'dNaN',
    'dAssist',
    'dCarrier',
    'dAgency',
  ]) {
    await sub(U[k], 'active');
  }
  await sub(U.dDown, 'canceled');

  // Direct assistants: manage (Pro target) and view-only.
  await db.query(
    `INSERT INTO public.driver_assistants
       (driver_user_id, assistant_user_id, status, permissions, agency_delegation_id)
     VALUES
       ($1,$2,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, NULL),
       ($1,$3,'active','{"settlements_view":true}'::jsonb, NULL),
       ($4,$2,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, NULL)`,
    [U.dAssist, U.assistantManage, U.assistantView, U.dDown],
  );

  // --- carrier / agency business context (for negative authorization) ------
  const recruiterId = (
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
  const relId = (
    await db.query<{ id: string }>(
      `INSERT INTO public.carrier_driver_relationships
         (recruiter_id, driver_user_id, status, created_by_user_id, accepted_at)
       VALUES ($1,$2,'active',$1, now()) RETURNING id`,
      [recruiterId, U.dCarrier],
    )
  ).rows[0].id;

  const agencyId = (
    await db.query<{ id: string }>(
      `INSERT INTO public.agency_profiles (owner_user_id, name, status)
       VALUES ($1,'Acme Back Office','active') RETURNING id`,
      [U.agencyOwner],
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO public.agency_entitlements (agency_id, plan_key, status)
     VALUES ($1,'agency_team','active')`,
    [agencyId],
  );
  await db.query(
    `INSERT INTO public.agency_members (agency_id, member_user_id, role, status)
     VALUES ($1,$2,'agency_owner','active'), ($1,$3,'agency_member','active')`,
    [agencyId, U.agencyOwner, U.agencyMember],
  );
  await db.query(
    `INSERT INTO public.agency_delegation_requests
       (agency_id, driver_user_id, member_user_id, status, requested_permissions)
     VALUES ($1,$2,$3,'approved','{"settlements_manage":true}'::jsonb)`,
    [agencyId, U.dAgency, U.agencyMember],
  );

  // --- scoring driver ------------------------------------------------------
  S.score = await mkSettlement(U.dScore, 'draft');
  I.score = await mkItem(S.score, U.dScore, '1000.00', {
    delivery: '2026-07-05',
    origin: 'Dallas, TX',
    destination: 'Atlanta,  GA',
    miles: '800.00',
  });
  I.scoreDeduct = await mkItem(S.score, U.dScore, '50.00', {}, 'deduction');

  L.scorePerfect = await mkLoad(U.dScore, {
    dropoff: '2026-07-05',
    pickup: '  dallas,   tx ',
    dest: 'ATLANTA, GA',
    miles: '800.00',
    pay: '1000.50',
  });
  L.scorePartial = await mkLoad(U.dScore, {
    dropoff: '2026-07-07',
    pickup: 'Dallas, TX',
    dest: 'Savannah, GA',
    miles: '816.00',
    pay: '1020.00',
  });
  L.scoreWeak = await mkLoad(U.dScore, {
    dropoff: '2026-07-01',
    pickup: 'Reno, NV',
    dest: 'Atlanta, GA',
    miles: null,
    pay: '1000.00',
  });
  L.scoreOutside = await mkLoad(U.dScore, {
    dropoff: '2026-07-20',
    pickup: 'Dallas, TX',
    dest: 'Atlanta, GA',
    miles: '800.00',
    pay: '1000.00',
  });
  L.scorePending = await mkLoad(U.dScore, {
    status: 'pending',
    dropoff: '2026-07-05',
    pickup: 'Dallas, TX',
    dest: 'Atlanta, GA',
    miles: '800.00',
    pay: '1000.00',
  });
  L.scoreBlank = await mkLoad(U.dScore, {
    dropoff: '2026-07-05',
    pickup: '   ',
    dest: '',
    miles: null,
    pay: '5000.00',
  });
  // Cross-driver row that is a perfect textual match and must never qualify.
  L.strangerPerfect = await mkLoad(U.stranger, {
    dropoff: '2026-07-05',
    pickup: 'Dallas, TX',
    dest: 'Atlanta, GA',
    miles: '800.00',
    pay: '1000.00',
  });
  // Effective date falls back to load_date when dropoff_date is NULL.
  L.scoreFallback = await mkLoad(U.dScore, {
    dropoff: null,
    loadDate: '2026-06-24',
    pickup: 'Dallas, TX',
    dest: 'Atlanta, GA',
    miles: '800.00',
    pay: '1000.00',
  });

  // --- pay-corroboration driver -------------------------------------------
  S.pay = await mkSettlement(U.dPay, 'draft');
  I.pay = await mkItem(S.pay, U.dPay, '1000.00', {
    delivery: '2026-07-05',
    origin: 'Dallas, TX',
    destination: 'Atlanta, GA',
    miles: '800.00',
  });
  L.payWild = await mkLoad(U.dPay, {
    dropoff: '2026-07-05',
    pickup: 'Dallas, TX',
    dest: 'Atlanta, GA',
    miles: '800.00',
    pay: '25000.00',
  });

  // --- accepted-match driver ----------------------------------------------
  S.accepted = await mkSettlement(U.dAccepted, 'draft');
  I.accepted = await mkItem(S.accepted, U.dAccepted, '1000.00', {
    delivery: '2026-07-05',
    origin: 'Dallas, TX',
    destination: 'Atlanta, GA',
    miles: '800.00',
  });
  L.acceptedChosen = await mkLoad(U.dAccepted, {
    dropoff: '2026-07-05',
    pickup: 'Reno, NV',
    dest: 'Boise, ID',
    miles: '800.00',
    pay: '1000.00',
  });
  L.acceptedRival = await mkLoad(U.dAccepted, {
    dropoff: '2026-07-05',
    pickup: 'Dallas, TX',
    dest: 'Atlanta, GA',
    miles: '800.00',
    pay: '1000.00',
  });

  // --- rejected / idempotency / stale-cleanup driver -----------------------
  S.rejected = await mkSettlement(U.dRejected, 'draft');
  I.rejectedA = await mkItem(S.rejected, U.dRejected, '1000.00', {
    delivery: '2026-07-05',
    origin: 'Dallas, TX',
    destination: 'Atlanta, GA',
    miles: '800.00',
  });
  I.rejectedB = await mkItem(S.rejected, U.dRejected, '1000.00', {
    delivery: '2026-07-05',
    origin: 'Dallas, TX',
    destination: 'Atlanta, GA',
    miles: '800.00',
  });
  L.rejPair = await mkLoad(U.dRejected, {
    dropoff: '2026-07-05',
    pickup: 'Dallas, TX',
    dest: 'Atlanta, GA',
    miles: '800.00',
    pay: '1000.00',
  });
  L.rejStale = await mkLoad(U.dRejected, {
    dropoff: '2026-07-05',
    pickup: 'Dallas, TX',
    dest: 'Atlanta, GA',
    miles: '800.00',
    pay: '1000.00',
  });
  await db.query(
    `INSERT INTO public.driver_settlement_matches
       (settlement_item_id, driver_load_id, match_state, confidence)
     VALUES ($1,$2,'rejected',NULL)`,
    [I.rejectedA, L.rejPair],
  );

  // --- top-25 cap driver (30 identically scoring loads) --------------------
  S.cap = await mkSettlement(U.dCap, 'draft');
  I.cap = await mkItem(S.cap, U.dCap, '1000.00', {
    delivery: '2026-07-05',
    origin: 'Dallas, TX',
    destination: null,
    miles: null,
  });
  for (let i = 0; i < 30; i += 1) {
    CAP_IDS.push(
      await mkLoad(U.dCap, {
        dropoff: '2026-07-05',
        pickup: 'Dallas, TX',
        dest: 'Elsewhere, ZZ',
        miles: null,
        pay: null,
      }),
    );
  }

  // --- non-finite stored numerics -----------------------------------------
  S.nan = await mkSettlement(U.dNaN, 'draft');
  I.nan = await mkItem(S.nan, U.dNaN, '1000.00', {
    delivery: '2026-07-05',
    origin: 'Dallas, TX',
    destination: 'Atlanta, GA',
    miles: '800.00',
  });
  L.nan = await mkLoad(U.dNaN, {
    dropoff: '2026-07-05',
    pickup: 'Dallas, TX',
    dest: 'Atlanta, GA',
    miles: 'NaN',
    pay: 'NaN',
  });

  // --- assistant-authorized driver -----------------------------------------
  S.assist = await mkSettlement(U.dAssist, 'draft');
  I.assist = await mkItem(S.assist, U.dAssist, '1000.00', {
    delivery: '2026-07-05',
    origin: 'Dallas, TX',
    destination: 'Atlanta, GA',
    miles: '800.00',
  });
  L.assist = await mkLoad(U.dAssist, {
    dropoff: '2026-07-05',
    pickup: 'Dallas, TX',
    dest: 'Atlanta, GA',
    miles: '800.00',
    pay: '1000.00',
  });

  // --- non-Pro driver ------------------------------------------------------
  S.down = await mkSettlement(U.dDown, 'draft');
  I.down = await mkItem(S.down, U.dDown, '1000.00', { delivery: '2026-07-05' });

  // --- voided / superseded settlements ------------------------------------
  S.voided = await mkSettlement(U.dScore, 'draft');
  I.voided = await mkItem(S.voided, U.dScore, '1000.00', {});
  await db.query(`UPDATE public.driver_settlements SET status='voided' WHERE id=$1`, [
    S.voided,
  ]);

  // --- carrier-issued settlement (draft + finalized) -----------------------
  const mkCarrier = async (status: 'draft' | 'finalized') =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO public.driver_settlements
           (driver_user_id, source, status, carrier_recruiter_profile_id,
            carrier_driver_relationship_id, source_display_name_snapshot,
            period_start, period_end, created_by_user_id)
         VALUES ($1,'carrier_issued',$2,$3,$4,'Blue Line Freight',
                 $5::date,$6::date,$7) RETURNING id`,
        [U.dCarrier, status, recruiterId, relId, P1, P2, U.paidCarrier],
      )
    ).rows[0].id;
  S.carrierDraft = await mkCarrier('draft');
  S.carrierFinal = await mkCarrier('finalized');
  I.carrierDraft = await mkItem(S.carrierDraft, U.paidCarrier, '1000.00', {
    delivery: '2026-07-05',
  });
  I.carrierFinal = await mkItem(S.carrierFinal, U.paidCarrier, '1000.00', {
    delivery: '2026-07-05',
    origin: 'Dallas, TX',
    destination: 'Atlanta, GA',
    miles: '800.00',
  });
  L.carrier = await mkLoad(U.dCarrier, {
    dropoff: '2026-07-05',
    pickup: 'Dallas, TX',
    dest: 'Atlanta, GA',
    miles: '800.00',
    pay: '1000.00',
  });

  // --- agency-prepared finalized settlement --------------------------------
  S.agencyFinal = (
    await db.query<{ id: string }>(
      `INSERT INTO public.driver_settlements
         (driver_user_id, source, status, agency_id, source_display_name_snapshot,
          period_start, period_end, created_by_user_id)
       VALUES ($1,'agency_prepared','finalized',$2,'Acme Back Office',
               $3::date,$4::date,$5) RETURNING id`,
      [U.dAgency, agencyId, P1, P2, U.agencyMember],
    )
  ).rows[0].id;
  I.agencyFinal = await mkItem(S.agencyFinal, U.agencyMember, '1000.00', {
    delivery: '2026-07-05',
  });
});

// =====================================================================
describe('Phase 1T-B2C4B — proof 1: exact start/dependency candidates', () => {
  it('references and applies the exact accepted prior candidate files', () => {
    for (const rel of Object.values(REL)) {
      expect(fs.existsSync(abs(rel))).toBe(true);
    }
    expect(REL.b2c4b).toContain(
      '20260808180500_phase1t_b2c4b_settlement_load_match_suggestions.sql',
    );
    expect(B1_SQL).toContain('driver_settlement_matches_unique_pair');
    expect(B1_SQL).toContain('uq_driver_settlement_matches_accepted');
    expect(B2C4A_SQL).toContain('settlement_confirm_load_match');
    expect(before.functions).toEqual(
      expect.arrayContaining([
        'settlement_confirm_load_match',
        'settlement_clear_load_match',
        'settlement_current_user_can_manage_driver_import',
        'settlement_current_user_can_assist_driver',
      ]),
    );
  });
});

describe('Phase 1T-B2C4B — proof 2: exactly one new function', () => {
  it('adds only settlement_refresh_load_match_suggestions(uuid) and no other object', async () => {
    const added = after.functions.filter((n) => !before.functions.includes(n));
    expect(added).toEqual([FN]);
    for (const k of ['tables', 'indexes', 'triggers', 'views', 'types', 'policies']) {
      expect(after[k]).toEqual(before[k]);
    }
    const sig = await db.query<{ args: string; ret: string }>(
      `SELECT pg_get_function_identity_arguments(p.oid) AS args,
              pg_get_function_result(p.oid) AS ret
         FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
        WHERE ns.nspname='public' AND p.proname=$1`,
      [FN],
    );
    expect(sig.rows).toHaveLength(1);
    expect(sig.rows[0].args).toBe('uuid');
    expect(sig.rows[0].ret).toBe('SETOF driver_settlement_matches');
  });
});

describe('Phase 1T-B2C4B — proof 3: SECURITY DEFINER + fixed search_path', () => {
  it('is SECURITY DEFINER, plpgsql, and pins search_path', async () => {
    const r = await db.query<{
      secdef: boolean;
      lang: string;
      cfg: string[] | null;
    }>(
      `SELECT p.prosecdef AS secdef, l.lanname AS lang, p.proconfig AS cfg
         FROM pg_proc p
         JOIN pg_namespace ns ON ns.oid=p.pronamespace
         JOIN pg_language l ON l.oid=p.prolang
        WHERE ns.nspname='public' AND p.proname=$1`,
      [FN],
    );
    expect(r.rows[0].secdef).toBe(true);
    expect(r.rows[0].lang).toBe('plpgsql');
    expect((r.rows[0].cfg ?? []).join(',')).toContain(
      'search_path=pg_catalog, public, auth',
    );
    expect(CODE).toContain('BEGIN;');
    expect(CODE.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(CODE).not.toMatch(/CREATE OR REPLACE|IF NOT EXISTS|\bDROP\b/i);
  });
});

describe('Phase 1T-B2C4B — proof 4: auth.uid() actor only', () => {
  it('has no caller-supplied actor, email, GUC, admin, or service_role bypass', () => {
    expect(CODE).toContain('v_actor uuid := auth.uid();');
    expect(CODE).not.toMatch(/current_setting|set_config/i);
    expect(CODE).not.toMatch(/\bemail\b/i);
    expect(CODE).not.toMatch(/is_admin|admin_users|has_role|super_admin/i);
    expect(CODE).not.toMatch(/EXECUTE\s+format|EXECUTE\s+'/i);
    // service_role only appears in the ACL block, never as an authorization branch.
    const bodyOnly = CODE.split('GRANT EXECUTE')[0];
    expect(bodyOnly).not.toMatch(/service_role/);
    expect(CODE).toMatch(/_settlement_item_id uuid/);
    expect(CODE).not.toMatch(/_actor_user_id|_caller|_as_user/);
  });

  it('rejects an anonymous / null actor with a fixed error', async () => {
    const msg = await failureMessage(() => refresh(U.dScore, null));
    expect(msg).toContain(ERR.invalid);
    expect(msg).not.toMatch(LEAK);
  });
});

describe('Phase 1T-B2C4B — proof 5: active Pro recipient authorization', () => {
  it('an active-Pro recipient driver may refresh suggestions', async () => {
    const rows = await refresh(U.dScore, I.score);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('a recipient driver without active Pro is refused', async () => {
    const msg = await failureMessage(() => refresh(U.dDown, I.down));
    expect(msg).toContain(ERR.notAuthorized);
    expect(msg).not.toMatch(LEAK);
    expect(await matchesFor(I.down)).toHaveLength(0);
  });

  it('an unrelated stranger is refused', async () => {
    const msg = await failureMessage(() => refresh(U.stranger, I.score));
    expect(msg).toContain(ERR.notAuthorized);
  });
});

describe('Phase 1T-B2C4B — proof 6: Pro-target direct assistant', () => {
  it('a manage-permission direct assistant of a Pro driver may refresh', async () => {
    const rows = await refresh(U.assistantManage, I.assist);
    expect(rows.map((r) => r.driver_load_id)).toEqual([L.assist]);
    expect(rows[0].match_state).toBe('likely');
  });

  it('a view-only assistant is refused', async () => {
    const msg = await failureMessage(() => refresh(U.assistantView, I.assist));
    expect(msg).toContain(ERR.notAuthorized);
  });

  it('a manage assistant of a NON-Pro driver is refused (Pro is target-scoped)', async () => {
    const msg = await failureMessage(() => refresh(U.assistantManage, I.down));
    expect(msg).toContain(ERR.notAuthorized);
  });

  it('source requires the Pro-scoped assistant helper call', () => {
    expect(CODE).toMatch(
      /settlement_current_user_can_assist_driver\(\s*\n?\s*v_parent\.driver_user_id,\s*'settlements_manage',\s*true\)/,
    );
    expect(CODE).toContain('settlement_current_user_can_manage_driver_import()');
  });
});

describe('Phase 1T-B2C4B — proof 7: carrier/agency management helpers absent', () => {
  it('never calls carrier or agency management helpers', () => {
    expect(CODE).not.toContain('settlement_current_user_can_manage_carrier');
    expect(CODE).not.toContain('settlement_current_user_can_administer_carrier');
    expect(CODE).not.toContain('settlement_current_user_can_manage_agency');
    expect(CODE).not.toContain('settlement_current_user_can_view_settlement');
  });

  it('the paying carrier cannot refresh suggestions on its own finalized statement', async () => {
    const msg = await failureMessage(() => refresh(U.paidCarrier, I.carrierFinal));
    expect(msg).toContain(ERR.notAuthorized);
    expect(await matchesFor(I.carrierFinal)).toHaveLength(0);
  });

  it('the delegated agency member cannot refresh suggestions', async () => {
    const msg = await failureMessage(() => refresh(U.agencyMember, I.agencyFinal));
    expect(msg).toContain(ERR.notAuthorized);
    expect(await matchesFor(I.agencyFinal)).toHaveLength(0);
  });

  it('the recipient driver of a FINALIZED carrier statement may refresh', async () => {
    const rows = await refresh(U.dCarrier, I.carrierFinal);
    expect(rows.map((r) => r.driver_load_id)).toEqual([L.carrier]);
  });
});

describe('Phase 1T-B2C4B — proof 8: source/status eligibility, fail-closed', () => {
  it('a carrier_issued DRAFT is never matchable', async () => {
    const msg = await failureMessage(() => refresh(U.dCarrier, I.carrierDraft));
    expect(msg).toContain(ERR.notEditable);
  });

  it('a voided settlement is never matchable', async () => {
    const msg = await failureMessage(() => refresh(U.dScore, I.voided));
    expect(msg).toContain(ERR.notEditable);
  });

  it('unknown item / settlement ids fail closed with fixed errors', async () => {
    const ghost = '00000000-0000-0000-0000-0000000000ff';
    const msg = await failureMessage(() => refresh(U.dScore, ghost));
    expect(msg).toContain(ERR.itemNotFound);
    expect(msg).not.toMatch(LEAK);
  });

  it('the source contract mirrors B2C4A exactly and lists every fixed error', () => {
    expect(CODE).toContain(
      `IF v_parent.source NOT IN ('carrier_issued', 'agency_prepared', 'driver_imported') THEN`,
    );
    expect(CODE).toContain(`IF v_parent.status NOT IN ('draft', 'finalized') THEN`);
    expect(CODE).toMatch(
      /v_parent\.status = 'draft'\s*\n\s*AND v_parent\.source IN \('carrier_issued', 'agency_prepared'\)/,
    );
    for (const e of Object.values(ERR)) {
      expect(CODE).toContain(`RAISE EXCEPTION '${e}'`);
    }
    expect(CODE).not.toMatch(/SQLERRM|EXCEPTION\s+WHEN/i);
  });
});

describe('Phase 1T-B2C4B — proof 9: load_pay items only', () => {
  it('a non load_pay item is refused', async () => {
    const msg = await failureMessage(() => refresh(U.dScore, I.scoreDeduct));
    expect(msg).toContain(ERR.requiresLoadPay);
    expect(await matchesFor(I.scoreDeduct)).toHaveLength(0);
  });
});

describe('Phase 1T-B2C4B — proof 10: same-driver completed loads only', () => {
  it('cross-driver and non-completed loads never qualify', async () => {
    const rows = await refresh(U.dScore, I.score);
    const ids = rows.map((r) => r.driver_load_id);
    expect(ids).not.toContain(L.strangerPerfect);
    expect(ids).not.toContain(L.scorePending);
    expect(CODE).toContain('l.user_id = v_parent.driver_user_id');
    expect(CODE).toContain(`l.status = 'completed'`);
  });
});

describe('Phase 1T-B2C4B — proof 11: bounded +/-7 day candidate window', () => {
  it('excludes loads outside period_start-7 .. period_end+7', async () => {
    const rows = await refresh(U.dScore, I.score);
    const ids = rows.map((r) => r.driver_load_id);
    expect(ids).not.toContain(L.scoreOutside);
    expect(CODE).toContain('v_window_start := v_parent.period_start - 7;');
    expect(CODE).toContain('v_window_end := v_parent.period_end + 7;');
    expect(CODE).toContain('COALESCE(l.dropoff_date, l.load_date) >= v_window_start');
    expect(CODE).toContain('COALESCE(l.dropoff_date, l.load_date) <= v_window_end');
  });
});

describe('Phase 1T-B2C4B — proof 12: exact five-signal scoring and thresholds', () => {
  it('persists the exact deterministic scores and states', async () => {
    const rows = await refresh(U.dScore, I.score);
    const byLoad = new Map(rows.map((r) => [r.driver_load_id, r]));

    // 0.35 date + 0.20 origin + 0.20 destination + 0.15 miles + 0.10 pay = 1.0000
    expect(byLoad.get(L.scorePerfect)?.match_state).toBe('likely');
    expect(Number(byLoad.get(L.scorePerfect)?.confidence)).toBeCloseTo(1.0, 4);

    // 0.15 (2 days) + 0.20 origin + 0.10 (2% miles) + 0.05 ($20) = 0.5000
    expect(byLoad.get(L.scorePartial)?.match_state).toBe('possible');
    expect(Number(byLoad.get(L.scorePartial)?.confidence)).toBeCloseTo(0.5, 4);

    // 0.00 date (4 days) + 0.20 destination + 0.10 pay = 0.3000 -> not persisted
    expect(byLoad.has(L.scoreWeak)).toBe(false);

    // blank/whitespace snapshots never match, so only the date signal applies
    expect(byLoad.has(L.scoreBlank)).toBe(false);

    // dropoff_date NULL falls back to load_date (2026-06-24, 11 days away):
    // 0.20 origin + 0.20 destination + 0.15 miles + 0.10 pay = 0.6500 -> possible
    expect(byLoad.get(L.scoreFallback)?.match_state).toBe('possible');
    expect(Number(byLoad.get(L.scoreFallback)?.confidence)).toBeCloseTo(0.65, 4);

    for (const r of rows) {
      expect(['likely', 'possible', 'rejected']).toContain(r.match_state);
      const c = Number(r.confidence);
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0.4);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('encodes exactly the locked weights, thresholds and normalization rule', () => {
    for (const w of ['0.3500', '0.2500', '0.1500', '0.2000', '0.1000', '0.0500']) {
      expect(CODE).toContain(w);
    }
    expect(CODE).toContain(`CASE WHEN c.score >= 0.70 THEN 'likely' ELSE 'possible' END`);
    expect(CODE).toContain('WHERE c.score >= 0.40');
    expect(CODE).toContain("LEAST(\n        1.0000::numeric,");
    expect(CODE).toMatch(/regexp_replace\(btrim\(lower\([^)]+\)\),\s*\n?\s*'\\s\+', ' ', 'g'\)/);
    expect(CODE).toContain("nullif(regexp_replace(btrim(lower(v_item.origin_snapshot))");
    expect(CODE).not.toMatch(/similarity|levenshtein|ST_|earth_distance|soundex/i);
  });

  it('never yields NaN or +/-Infinity from non-finite stored load numerics', async () => {
    const rows = await refresh(U.dNaN, I.nan);
    expect(rows).toHaveLength(1);
    // NaN miles and NaN pay both contribute 0 via explicit finite guards:
    // 0.35 date + 0.20 origin + 0.20 destination = 0.7500 -> likely
    expect(rows[0].match_state).toBe('likely');
    expect(Number(rows[0].confidence)).toBeCloseTo(0.75, 4);
    expect(CODE).toContain(`l.loaded_miles::text IN ('NaN', 'Infinity', '-Infinity')`);
    expect(CODE).toContain(`l.estimated_pay::text IN ('NaN', 'Infinity', '-Infinity')`);
    expect(CODE).toContain(
      `v_item.loaded_miles_snapshot::text\n                     IN ('NaN', 'Infinity', '-Infinity')`,
    );
  });
});

describe('Phase 1T-B2C4B — proof 13: pay difference corroborates, never disqualifies', () => {
  it('a wildly different reported amount still yields a strong suggestion', async () => {
    const rows = await refresh(U.dPay, I.pay);
    expect(rows).toHaveLength(1);
    expect(rows[0].driver_load_id).toBe(L.payWild);
    // 0.35 + 0.20 + 0.20 + 0.15 with ZERO pay credit = 0.9000, still 'likely'.
    expect(rows[0].match_state).toBe('likely');
    expect(Number(rows[0].confidence)).toBeCloseTo(0.9, 4);
    // The pay signal is additive only: it appears in no WHERE/filter clause.
    const window = CODE.slice(CODE.indexOf('FROM public.loads l'));
    expect(window).not.toMatch(/estimated_pay/);
  });
});

describe('Phase 1T-B2C4B — proof 14: deterministic top-25 ranking cap', () => {
  it('persists at most 25 candidates chosen by the locked tie-break order', async () => {
    const rows = await refresh(U.dCap, I.cap);
    expect(rows).toHaveLength(25);
    const expected = [...CAP_IDS].sort().slice(0, 25).sort();
    expect(rows.map((r) => r.driver_load_id).sort()).toEqual(expected);
    expect(new Set(rows.map((r) => r.driver_load_id)).size).toBe(25);
    expect(CODE).toContain(
      'ORDER BY q.score DESC, q.date_distance ASC, q.eff_date DESC, q.load_id ASC',
    );
    expect(CODE).toContain('WHERE r.rn <= 25');
    expect(CODE).toContain('ELSE 999999');
  });

  it('returns rows ordered likely, then possible, then rejected', async () => {
    const rows = await refresh(U.dScore, I.score);
    const order = rows.map((r) => r.match_state);
    const rank = { likely: 0, possible: 1, rejected: 2 } as Record<string, number>;
    for (let i = 1; i < order.length; i += 1) {
      expect(rank[order[i]]).toBeGreaterThanOrEqual(rank[order[i - 1]]);
    }
    expect(CODE).toContain('dsm.confidence DESC NULLS LAST');
    expect(CODE).toContain('dsm.driver_load_id ASC');
  });
});

describe('Phase 1T-B2C4B — proof 15: never accepts automatically', () => {
  it('writes only likely/possible and never exact/confirmed', async () => {
    await refresh(U.dScore, I.score);
    await refresh(U.dCap, I.cap);
    const r = await db.query<{ match_state: string; c: number }>(
      `SELECT match_state, count(*)::int AS c
         FROM public.driver_settlement_matches
        WHERE settlement_item_id = ANY($1::uuid[])
        GROUP BY match_state`,
      [[I.score, I.cap, I.assist, I.pay, I.nan, I.carrierFinal]],
    );
    expect(r.rows.map((x) => x.match_state).sort()).toEqual(['likely', 'possible']);
    expect(CODE).not.toMatch(/match_state\s*=\s*'(exact|confirmed)'/);
    expect(CODE).not.toMatch(/VALUES[\s\S]{0,120}'confirmed'/);
    expect(CODE).toContain("CASE WHEN c.score >= 0.70 THEN 'likely' ELSE 'possible' END");
    expect(CODE).toContain('matched_by_user_id = NULL');
    expect(CODE).toContain('matched_at = NULL');
    const rows = await matchesFor(I.score);
    for (const row of rows) {
      expect(row.matched_by_user_id).toBeNull();
      expect(row.matched_at).toBeNull();
    }
  });
});

describe('Phase 1T-B2C4B — proof 16: manual acceptance short-circuits refresh', () => {
  it('returns the accepted row unchanged and makes zero suggestion mutations', async () => {
    // Seed suggestions first, then manually confirm a DIFFERENT load via B2C4A.
    const seeded = await refresh(U.dAccepted, I.accepted);
    expect(seeded.length).toBeGreaterThan(0);

    const confirmed = await asRole('authenticated', U.dAccepted, async () => {
      const r = await db.query<MatchRow>(
        `SELECT id, settlement_item_id, driver_load_id, match_state,
                confidence::text AS confidence, matched_by_user_id,
                matched_at::text AS matched_at
           FROM public.settlement_confirm_load_match($1::uuid, $2::uuid)`,
        [I.accepted, L.acceptedChosen],
      );
      return r.rows[0];
    });
    expect(confirmed.match_state).toBe('confirmed');

    const beforeRows = await matchesFor(I.accepted);
    const out = await refresh(U.dAccepted, I.accepted);
    const afterRows = await matchesFor(I.accepted);

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(confirmed.id);
    expect(out[0].match_state).toBe('confirmed');
    expect(afterRows).toEqual(beforeRows);
  });
});

describe('Phase 1T-B2C4B — proof 17: rejected preservation, idempotency, item scope', () => {
  it('never resurrects a rejected pair', async () => {
    const rows = await refresh(U.dRejected, I.rejectedA);
    const rejected = rows.filter((r) => r.driver_load_id === L.rejPair);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].match_state).toBe('rejected');
    expect(rejected[0].confidence).toBeNull();
    expect(CODE).toContain(
      `WHERE public.driver_settlement_matches.match_state IN ('likely', 'possible')`,
    );
    expect(CODE).toContain(`AND dsm.match_state IN ('likely', 'possible')`);
  });

  it('is idempotent across repeated refreshes with unchanged data', async () => {
    const first = await refresh(U.dRejected, I.rejectedA);
    const second = await refresh(U.dRejected, I.rejectedA);
    expect(second).toEqual(first);
    const stored = await matchesFor(I.rejectedA);
    expect(stored).toHaveLength(first.length);
    expect(new Set(stored.map((r) => r.driver_load_id)).size).toBe(stored.length);
  });

  it('stale cleanup removes only this item’s no-longer-qualifying suggestions', async () => {
    const otherBefore = await refresh(U.dRejected, I.rejectedB);
    expect(otherBefore.map((r) => r.driver_load_id)).toContain(L.rejStale);

    await db.query(`UPDATE public.loads SET status='cancelled' WHERE id=$1`, [
      L.rejStale,
    ]);
    const refreshed = await refresh(U.dRejected, I.rejectedA);
    expect(refreshed.map((r) => r.driver_load_id)).not.toContain(L.rejStale);
    // The sibling item on the same settlement is untouched.
    const otherAfter = await matchesFor(I.rejectedB);
    expect(otherAfter.map((r) => r.driver_load_id)).toContain(L.rejStale);
    expect(otherAfter).toEqual(
      [...otherBefore].sort((a, b) =>
        a.match_state === b.match_state
          ? a.driver_load_id.localeCompare(b.driver_load_id)
          : a.match_state.localeCompare(b.match_state),
      ),
    );
    // The rejected row survives the cleanup pass.
    const rej = (await matchesFor(I.rejectedA)).filter(
      (r) => r.driver_load_id === L.rejPair,
    );
    expect(rej).toHaveLength(1);
    expect(rej[0].match_state).toBe('rejected');
  });
});

describe('Phase 1T-B2C4B — proof 18: write boundary, DDL, ACL and test hygiene', () => {
  it('never writes loads, items, or events', async () => {
    const fingerprintBefore = await loadFingerprints();
    const itemBefore = await itemById(I.score);
    const eventsBefore = await eventCount();

    await refresh(U.dScore, I.score);

    expect(await loadFingerprints()).toBe(fingerprintBefore);
    expect(await itemById(I.score)).toEqual(itemBefore);
    expect(await eventCount()).toBe(eventsBefore);

    expect(CODE).not.toMatch(/UPDATE public\.loads|INSERT INTO public\.loads|DELETE FROM public\.loads/);
    expect(CODE).not.toMatch(
      /UPDATE public\.driver_settlement_items|INSERT INTO public\.driver_settlement_items|DELETE FROM public\.driver_settlement_items/,
    );
    expect(CODE).not.toContain('driver_settlement_events');
    expect(CODE).not.toContain('expected_amount_snapshot =');
  });

  it('contains no DDL other than the single function and its ACL', () => {
    const creates = CODE.match(/^\s*CREATE\s+[A-Z]+/gim) ?? [];
    expect(creates).toHaveLength(1);
    expect(creates[0].trim()).toBe('CREATE FUNCTION');
    expect(CODE).not.toMatch(
      /CREATE (TABLE|INDEX|UNIQUE INDEX|VIEW|TRIGGER|TYPE|POLICY)|ALTER TABLE|GRANT (SELECT|INSERT|UPDATE|DELETE|ALL)/i,
    );
  });

  it('grants execute only to authenticated and service_role', async () => {
    expect(CODE).toContain(
      `REVOKE ALL ON FUNCTION public.${FN}(uuid) FROM PUBLIC, anon;`,
    );
    expect(CODE).toContain(
      `GRANT EXECUTE ON FUNCTION public.${FN}(uuid) TO authenticated, service_role;`,
    );
    const acl = await db.query<{
      anon: boolean;
      auth: boolean;
      svc: boolean;
      pub: boolean;
    }>(
      `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
              has_function_privilege('service_role', $1, 'EXECUTE') AS svc,
              has_function_privilege('public', $1, 'EXECUTE') AS pub`,
      [`public.${FN}(uuid)`],
    );
    expect(acl.rows[0].anon).toBe(false);
    expect(acl.rows[0].pub).toBe(false);
    expect(acl.rows[0].auth).toBe(true);
    expect(acl.rows[0].svc).toBe(true);
  });

  it('has no skipped, todo, or focused tests', () => {
    expect(SELF_SRC).not.toMatch(/\b(it|describe|test)\.(skip|only|todo)\b/);
  });
});
