// @vitest-environment node
// =====================================================================
// Phase 1T-B2C4C — Controlled load-match SUGGESTION REJECTION proofs.
//
// Applies, in order, the REAL accepted Phase 1T-B1, B2A, B2B, B2C1, B2C2A,
// B2C3A, B2C4A and B2C4B candidates and then the REAL Phase 1T-B2C4C candidate
// inside PGlite on a minimal but faithful bootstrap, and proves catalog shape,
// ACLs, active-Pro driver-side (never carrier/agency) authorization, the exact
// existing-pair state machine, confidence preservation, single-event auditing,
// idempotency, full immutability of loads/settlements/items, and the B2C4A /
// B2C4B integration contract.
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
const SELF_SRC = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');

/** Executable SQL only: `--` documentation lines removed. */
const CODE = B2C4C_SQL.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const FN = 'settlement_reject_load_match';

const ERR = {
  invalid: 'settlement_invalid_request',
  itemNotFound: 'settlement_item_not_found',
  notFound: 'settlement_not_found',
  invalidSource: 'settlement_invalid_source',
  notEditable: 'settlement_not_editable',
  notAuthorized: 'settlement_rejection_not_authorized',
  requiresLoadPay: 'settlement_match_requires_load_pay_item',
  loadNotFound: 'settlement_match_load_not_found',
  loadNotCompleted: 'settlement_match_load_not_completed',
  suggestionNotFound: 'settlement_suggestion_not_found',
  alreadyAccepted: 'settlement_match_already_accepted',
  invalidMatchState: 'settlement_invalid_match_state',
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
  matched_at: string | null;
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

const REJECT_SQL = `SELECT (r).id, (r).settlement_item_id, (r).driver_load_id,
                           (r).match_state, (r).confidence::text AS confidence,
                           (r).matched_by_user_id, (r).matched_at::text AS matched_at
                      FROM public.${FN}($1::uuid, $2::uuid) AS r`;

async function reject(
  actor: string | null,
  itemId: string | null,
  loadId: string | null,
): Promise<MatchRow> {
  return asRole('authenticated', actor, async () => {
    const r = await db.query<MatchRow>(REJECT_SQL, [itemId, loadId]);
    return r.rows[0];
  });
}

async function confirm(
  actor: string,
  itemId: string,
  loadId: string,
): Promise<MatchRow> {
  return asRole('authenticated', actor, async () => {
    const r = await db.query<MatchRow>(
      `SELECT (r).id, (r).settlement_item_id, (r).driver_load_id,
              (r).match_state, (r).confidence::text AS confidence,
              (r).matched_by_user_id, (r).matched_at::text AS matched_at
         FROM public.settlement_confirm_load_match($1::uuid, $2::uuid) AS r`,
      [itemId, loadId],
    );
    return r.rows[0];
  });
}

async function refresh(actor: string, itemId: string): Promise<MatchRow[]> {
  return asRole('authenticated', actor, async () => {
    const r = await db.query<MatchRow>(
      `SELECT id, settlement_item_id, driver_load_id, match_state,
              confidence::text AS confidence, matched_by_user_id,
              matched_at::text AS matched_at
         FROM public.settlement_refresh_load_match_suggestions($1::uuid)`,
      [itemId],
    );
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

async function mkCarrierSettlement(
  driver: string,
  status: 'draft' | 'finalized',
  recruiterId: string,
  relationshipId: string,
  creator: string,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlements
       (driver_user_id, source, status, carrier_recruiter_profile_id,
        carrier_driver_relationship_id, source_display_name_snapshot,
        period_start, period_end, created_by_user_id)
     VALUES ($1,'carrier_issued',$2,$3,$4,'Blue Line Freight',$5::date,$6::date,$7)
     RETURNING id`,
    [driver, status, recruiterId, relationshipId, P1, P2, creator],
  );
  return r.rows[0].id;
}

async function mkAgencySettlement(
  driver: string,
  status: 'draft' | 'finalized',
  agencyId: string,
  creator: string,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlements
       (driver_user_id, source, status, agency_id, source_display_name_snapshot,
        period_start, period_end, created_by_user_id)
     VALUES ($1,'agency_prepared',$2,$3,'Acme Back Office',$4::date,$5::date,$6)
     RETURNING id`,
    [driver, status, agencyId, P1, P2, creator],
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

async function mkLoad(
  owner: string,
  status = 'completed',
  pay: string | null = '1000.00',
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.loads
       (user_id, status, load_date, dropoff_date, pickup_location,
        dropoff_location, loaded_miles, estimated_pay)
     VALUES ($1,$2,'2026-07-02'::date,'2026-07-05'::date,'Dallas, TX',
             'Atlanta, GA', 800.00, $3::numeric) RETURNING id`,
    [owner, status, pay],
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

async function matchById(id: string): Promise<MatchRow | undefined> {
  const r = await db.query<MatchRow>(
    `SELECT id, settlement_item_id, driver_load_id, match_state,
            confidence::text AS confidence, matched_by_user_id,
            matched_at::text AS matched_at
       FROM public.driver_settlement_matches WHERE id=$1`,
    [id],
  );
  return r.rows[0];
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

async function matchCount(): Promise<number> {
  const r = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM public.driver_settlement_matches`,
  );
  return Number(r.rows[0].c);
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

async function settlementFingerprint(id: string): Promise<string> {
  const r = await db.query<{ f: string }>(
    `SELECT (status || '|' || source || '|' || coalesce(finalized_at::text,'-')
             || '|' || coalesce(voided_at::text,'-') || '|' || version_number::text
             || '|' || updated_at::text) AS f
       FROM public.driver_settlements WHERE id=$1`,
    [id],
  );
  return r.rows[0].f;
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
let relationshipId = '';
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

  before = await snapshotCatalog();
  await db.exec(B2C4C_SQL);
  after = await snapshotCatalog();

  for (const k of [
    'dLikely',
    'dPossible',
    'dAssist',
    'dFree',
    'dNoSub',
    'dMalformed',
    'dCancelled',
    'dCarrier',
    'dAgency',
    'dStates',
    'dIntegration',
    'assistantManage',
    'assistantView',
    'paidCarrier',
    'agencyOwner',
    'agencyMember',
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
    'dLikely',
    'dPossible',
    'dAssist',
    'dCarrier',
    'dAgency',
    'dStates',
    'dIntegration',
  ]) {
    await sub(U[k], 'active');
  }
  await sub(U.dFree, 'active', 'free');
  await sub(U.dCancelled, 'canceled');
  await sub(U.dMalformed, '   ', '   ');
  // U.dNoSub deliberately has no subscription row at all.

  await db.query(
    `INSERT INTO public.driver_assistants
       (driver_user_id, assistant_user_id, status, permissions, agency_delegation_id)
     VALUES
       ($1,$2,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, NULL),
       ($1,$3,'active','{"settlements_view":true}'::jsonb, NULL),
       ($4,$2,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, NULL),
       ($5,$2,'active','{"settlements_manage":"true"}'::jsonb, NULL)`,
    [U.dAssist, U.assistantManage, U.assistantView, U.dFree, U.dPossible],
  );

  // --- carrier / agency business context (for negative authorization) ------
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
  relationshipId = (
    await db.query<{ id: string }>(
      `INSERT INTO public.carrier_driver_relationships
         (recruiter_id, driver_user_id, status, created_by_user_id, accepted_at)
       VALUES ($1,$2,'active',$1, now()) RETURNING id`,
      [recruiterId, U.dCarrier],
    )
  ).rows[0].id;

  agencyId = (
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
});

// ---------------------------------------------------------------------------
describe('1T-B2C4C — chain, catalog and source shape', () => {
  it('1. every required prior accepted file exists and the real chain applied', () => {
    for (const rel of Object.values(REL)) {
      expect(fs.existsSync(abs(rel)), rel).toBe(true);
    }
    expect(after.functions).toContain('settlement_confirm_load_match');
    expect(after.functions).toContain('settlement_clear_load_match');
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

  it('3. exact signature returns driver_settlement_matches', async () => {
    const r = await db.query<{ args: string; ret: string }>(
      `SELECT pg_get_function_identity_arguments(p.oid) AS args,
              pg_get_function_result(p.oid) AS ret
         FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
        WHERE ns.nspname='public' AND p.proname=$1`,
      [FN],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].args).toBe(
      '_settlement_item_id uuid, _driver_load_id uuid',
    );
    expect(r.rows[0].ret).toBe('driver_settlement_matches');
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
    // carrier / agency / view helpers are deliberately never called
    expect(CODE).not.toContain('settlement_current_user_can_manage_carrier');
    expect(CODE).not.toContain('settlement_current_user_can_administer_carrier');
    expect(CODE).not.toContain('settlement_current_user_can_manage_agency');
    expect(CODE).not.toContain('settlement_current_user_can_view_settlement');
    expect(CODE).toContain('settlement_current_user_can_manage_driver_import');
    expect(CODE).toContain('settlement_current_user_can_assist_driver');
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C4C — input, authorization and eligibility', () => {
  it('7. null inputs fail with the fixed request error', async () => {
    S.nullCase = await mkSettlement(U.dLikely, 'draft');
    I.nullCase = await mkItem(S.nullCase, U.dLikely, '1000.00');
    L.nullCase = await mkLoad(U.dLikely);

    expect(
      await failureMessage(() => reject(U.dLikely, null, L.nullCase)),
    ).toContain(ERR.invalid);
    expect(
      await failureMessage(() => reject(U.dLikely, I.nullCase, null)),
    ).toContain(ERR.invalid);
    expect(
      await failureMessage(() => reject(null, I.nullCase, L.nullCase)),
    ).toContain(ERR.invalid);
  });

  it('8. active-Pro recipient driver rejects an existing likely suggestion', async () => {
    S.likely = await mkSettlement(U.dLikely, 'draft');
    I.likely = await mkItem(S.likely, U.dLikely, '1000.00');
    L.likely = await mkLoad(U.dLikely);
    const mid = await mkMatch(I.likely, L.likely, 'likely', '0.8500');

    const out = await reject(U.dLikely, I.likely, L.likely);
    expect(out.id).toBe(mid);
    expect(out.match_state).toBe('rejected');
  });

  it('9. active-Pro recipient driver rejects an existing possible suggestion', async () => {
    S.possible = await mkSettlement(U.dPossible, 'finalized');
    I.possible = await mkItem(S.possible, U.dPossible, '900.00');
    L.possible = await mkLoad(U.dPossible);
    const mid = await mkMatch(I.possible, L.possible, 'possible', '0.4500');

    const out = await reject(U.dPossible, I.possible, L.possible);
    expect(out.id).toBe(mid);
    expect(out.match_state).toBe('rejected');
    expect(out.confidence).toBe('0.4500');
  });

  it('10. DIRECT assistant with settlements_manage over an active-Pro target may reject', async () => {
    S.assist = await mkSettlement(U.dAssist, 'draft');
    I.assist = await mkItem(S.assist, U.dAssist, '1200.00');
    L.assist = await mkLoad(U.dAssist);
    const mid = await mkMatch(I.assist, L.assist, 'likely', '0.9000');

    const out = await reject(U.assistantManage, I.assist, L.assist);
    expect(out.id).toBe(mid);
    expect(out.match_state).toBe('rejected');
    expect(out.matched_by_user_id).toBe(U.assistantManage);
  });

  it('11. free / cancelled / missing / malformed Pro recipients fail authorization', async () => {
    for (const key of ['dFree', 'dCancelled', 'dNoSub', 'dMalformed']) {
      const sid = await mkSettlement(U[key], 'draft');
      const iid = await mkItem(sid, U[key], '1000.00');
      const lid = await mkLoad(U[key]);
      await mkMatch(iid, lid, 'likely', '0.8000');
      const msg = await failureMessage(() => reject(U[key], iid, lid));
      expect(msg, key).toContain(ERR.notAuthorized);
      expect((await matchesFor(iid))[0].match_state).toBe('likely');
    }
  });

  it('12. assistant over a Free target, or with view-only / string permission, fails', async () => {
    // Free target (U.dFree) with a manage assistant
    const freeS = await mkSettlement(U.dFree, 'draft');
    const freeI = await mkItem(freeS, U.dFree, '1000.00');
    const freeL = await mkLoad(U.dFree);
    await mkMatch(freeI, freeL, 'likely', '0.8000');
    expect(
      await failureMessage(() => reject(U.assistantManage, freeI, freeL)),
    ).toContain(ERR.notAuthorized);

    // view-only assistant over the Pro target
    expect(
      await failureMessage(() => reject(U.assistantView, I.assist, L.assist)),
    ).toContain(ERR.notAuthorized);

    // string "true" permission is not a boolean grant (U.dPossible delegation)
    const strS = await mkSettlement(U.dPossible, 'draft');
    const strI = await mkItem(strS, U.dPossible, '1000.00');
    const strL = await mkLoad(U.dPossible);
    await mkMatch(strI, strL, 'likely', '0.8000');
    expect(
      await failureMessage(() => reject(U.assistantManage, strI, strL)),
    ).toContain(ERR.notAuthorized);
  });

  it('13. stranger, carrier owner and agency member cannot reject from business context', async () => {
    S.carrier = await mkCarrierSettlement(
      U.dCarrier,
      'finalized',
      recruiterId,
      relationshipId,
      U.paidCarrier,
    );
    I.carrier = await mkItem(S.carrier, U.paidCarrier, '1500.00');
    L.carrier = await mkLoad(U.dCarrier);
    await mkMatch(I.carrier, L.carrier, 'likely', '0.9000');

    S.agency = await mkAgencySettlement(
      U.dAgency,
      'finalized',
      agencyId,
      U.agencyMember,
    );
    I.agency = await mkItem(S.agency, U.agencyMember, '1400.00');
    L.agency = await mkLoad(U.dAgency);
    await mkMatch(I.agency, L.agency, 'possible', '0.5000');

    expect(
      await failureMessage(() => reject(U.paidCarrier, I.carrier, L.carrier)),
    ).toContain(ERR.notAuthorized);
    expect(
      await failureMessage(() => reject(U.agencyOwner, I.agency, L.agency)),
    ).toContain(ERR.notAuthorized);
    expect(
      await failureMessage(() => reject(U.agencyMember, I.agency, L.agency)),
    ).toContain(ERR.notAuthorized);
    expect(
      await failureMessage(() => reject(U.stranger, I.carrier, L.carrier)),
    ).toContain(ERR.notAuthorized);

    expect((await matchesFor(I.carrier))[0].match_state).toBe('likely');
    expect((await matchesFor(I.agency))[0].match_state).toBe('possible');
  });

  it('14. carrier_issued / agency_prepared DRAFT fails; finalized is eligible', async () => {
    const cDraft = await mkCarrierSettlement(
      U.dCarrier,
      'draft',
      recruiterId,
      relationshipId,
      U.paidCarrier,
    );
    const cItem = await mkItem(cDraft, U.paidCarrier, '1000.00');
    const cLoad = await mkLoad(U.dCarrier);
    await mkMatch(cItem, cLoad, 'likely', '0.8000');
    expect(
      await failureMessage(() => reject(U.dCarrier, cItem, cLoad)),
    ).toContain(ERR.notEditable);

    const aDraft = await mkAgencySettlement(
      U.dAgency,
      'draft',
      agencyId,
      U.agencyMember,
    );
    const aItem = await mkItem(aDraft, U.agencyMember, '1000.00');
    const aLoad = await mkLoad(U.dAgency);
    await mkMatch(aItem, aLoad, 'likely', '0.8000');
    expect(
      await failureMessage(() => reject(U.dAgency, aItem, aLoad)),
    ).toContain(ERR.notEditable);

    // finalized carrier settlement: the recipient Pro driver may reject
    const out = await reject(U.dCarrier, I.carrier, L.carrier);
    expect(out.match_state).toBe('rejected');
    const aOut = await reject(U.dAgency, I.agency, L.agency);
    expect(aOut.match_state).toBe('rejected');
  });

  it('15. driver_imported draft and finalized are both eligible under advanced auth', async () => {
    // draft proven in #8, finalized proven in #9
    const draft = await matchesFor(I.likely);
    const finalized = await matchesFor(I.possible);
    expect(draft[0].match_state).toBe('rejected');
    expect(finalized[0].match_state).toBe('rejected');
  });

  it('16. voided / superseded / unknown status and source fail closed', async () => {
    for (const status of ['voided', 'superseded'] as const) {
      const sid = await mkSettlement(U.dStates, status);
      const iid = await mkItem(sid, U.dStates, '1000.00');
      const lid = await mkLoad(U.dStates);
      await mkMatch(iid, lid, 'likely', '0.8000');
      expect(await failureMessage(() => reject(U.dStates, iid, lid))).toContain(
        ERR.notEditable,
      );
    }
    // Fail-closed branches for unknown stored source/status exist in source.
    expect(CODE).toContain(ERR.invalidSource);
    expect(CODE).toContain(ERR.notEditable);
    expect(CODE).toMatch(
      /source NOT IN \('carrier_issued', 'agency_prepared', 'driver_imported'\)/,
    );
    expect(CODE).toMatch(/status NOT IN \('draft', 'finalized'\)/);
  });

  it('17. a non-load_pay item fails with the fixed error', async () => {
    const sid = await mkSettlement(U.dStates, 'draft');
    const iid = await mkItem(sid, U.dStates, '50.00', 'deduction');
    const lid = await mkLoad(U.dStates);
    await mkMatch(iid, lid, 'likely', '0.8000');
    expect(await failureMessage(() => reject(U.dStates, iid, lid))).toContain(
      ERR.requiresLoadPay,
    );
  });

  it('18. wrong-driver / missing load fails; a non-completed load fails', async () => {
    const sid = await mkSettlement(U.dStates, 'draft');
    const iid = await mkItem(sid, U.dStates, '1000.00');
    const strangerLoad = await mkLoad(U.stranger);
    const pending = await mkLoad(U.dStates, 'pending');
    await mkMatch(iid, pending, 'likely', '0.8000');

    expect(
      await failureMessage(() => reject(U.dStates, iid, strangerLoad)),
    ).toContain(ERR.loadNotFound);
    expect(
      await failureMessage(() =>
        reject(U.dStates, iid, '00000000-0000-4000-8000-000000000009'),
      ),
    ).toContain(ERR.loadNotFound);
    expect(await failureMessage(() => reject(U.dStates, iid, pending))).toContain(
      ERR.loadNotCompleted,
    );
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C4C — pair state machine and immutability', () => {
  it('19. a missing pair fails settlement_suggestion_not_found and creates no row', async () => {
    const sid = await mkSettlement(U.dStates, 'draft');
    const iid = await mkItem(sid, U.dStates, '1000.00');
    const lid = await mkLoad(U.dStates);
    const beforeCount = await matchCount();

    expect(await failureMessage(() => reject(U.dStates, iid, lid))).toContain(
      ERR.suggestionNotFound,
    );
    expect(await matchesFor(iid)).toHaveLength(0);
    expect(await matchCount()).toBe(beforeCount);
  });

  it('20. likely -> rejected updates the same row, preserves confidence, and writes exactly one event', async () => {
    S.tx = await mkSettlement(U.dStates, 'draft');
    I.tx = await mkItem(S.tx, U.dStates, '1000.00');
    L.tx = await mkLoad(U.dStates);
    L.txOther = await mkLoad(U.dStates);
    const mid = await mkMatch(I.tx, L.tx, 'likely', '0.8123');
    const otherId = await mkMatch(I.tx, L.txOther, 'possible', '0.4200');
    const otherBefore = await matchById(otherId);

    const loadsBefore = await loadFingerprints();
    const settlementBefore = await settlementFingerprint(S.tx);
    const itemBefore = await itemById(I.tx);
    const globalEventsBefore = await eventCount();

    const out = await reject(U.dStates, I.tx, L.tx);

    expect(out.id).toBe(mid);
    expect(out.match_state).toBe('rejected');
    expect(out.confidence).toBe('0.8123');
    expect(out.matched_by_user_id).toBe(U.dStates);
    expect(out.matched_at).not.toBeNull();

    const events = await eventsFor(S.tx);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('updated');
    expect(events[0].actor_user_id).toBe(U.dStates);
    expect(events[0].metadata).toMatchObject({
      source: 'driver_imported',
      item_id: I.tx,
      driver_load_id: L.tx,
      change: 'load_match_rejected',
    });
    expect(await eventCount()).toBe(globalEventsBefore + 1);

    // 23/24/25/26 — nothing else moved
    expect(await matchById(otherId)).toEqual(otherBefore);
    expect(await loadFingerprints()).toBe(loadsBefore);
    expect(await settlementFingerprint(S.tx)).toBe(settlementBefore);
    expect(await itemById(I.tx)).toEqual(itemBefore);
    expect(itemBefore.expected_amount_snapshot).toBeNull();
    expect(itemBefore.amount).toBe('1000.00');
  });

  it('21. an already-rejected pair is an idempotent no-op with no second event', async () => {
    const rowBefore = await matchesFor(I.tx);
    const eventsBefore = await eventsFor(S.tx);
    const globalBefore = await eventCount();

    const out = await reject(U.dStates, I.tx, L.tx);
    expect(out.match_state).toBe('rejected');

    expect(await matchesFor(I.tx)).toEqual(rowBefore);
    expect(await eventsFor(S.tx)).toEqual(eventsBefore);
    expect(await eventCount()).toBe(globalBefore);
  });

  it('22. an exact / confirmed pair can never be rejected and stays unchanged', async () => {
    for (const state of ['exact', 'confirmed'] as const) {
      const sid = await mkSettlement(U.dStates, 'draft');
      const iid = await mkItem(sid, U.dStates, '1000.00');
      const lid = await mkLoad(U.dStates);
      const mid = await mkMatch(iid, lid, state, state === 'exact' ? '1.0000' : null);
      const rowBefore = await matchById(mid);

      expect(await failureMessage(() => reject(U.dStates, iid, lid))).toContain(
        ERR.alreadyAccepted,
      );
      expect(await matchById(mid)).toEqual(rowBefore);
      expect(await eventsFor(sid)).toHaveLength(0);
    }
    // malformed/unrecognized stored state fails closed in source
    expect(CODE).toContain(ERR.invalidMatchState);
    expect(CODE).toMatch(/NOT IN \('likely', 'possible'\)/);
  });

  it('23. unrelated match rows on other items are untouched', async () => {
    const otherItem = await mkItem(S.tx, U.dStates, '250.00');
    const otherLoad = await mkLoad(U.dStates);
    const otherId = await mkMatch(otherItem, otherLoad, 'likely', '0.7700');
    const rowBefore = await matchById(otherId);

    const lid2 = await mkLoad(U.dStates);
    await mkMatch(I.tx, lid2, 'possible', '0.4100');
    await reject(U.dStates, I.tx, lid2);

    expect(await matchById(otherId)).toEqual(rowBefore);
  });

  it('24. the function never writes public.loads', async () => {
    const fingerprint = await loadFingerprints();
    const lid = await mkLoad(U.dStates);
    await mkMatch(I.tx, lid, 'likely', '0.9100');
    const withNewLoad = await loadFingerprints();
    await reject(U.dStates, I.tx, lid);
    expect(await loadFingerprints()).toBe(withNewLoad);
    expect(withNewLoad).toContain(fingerprint.split(',')[0]);
    expect(CODE).not.toMatch(/UPDATE\s+public\.loads|DELETE\s+FROM\s+public\.loads/i);
    expect(CODE).not.toMatch(/INSERT\s+INTO\s+public\.loads/i);
  });

  it('25/26. settlements and items are never written by this candidate', () => {
    expect(CODE).not.toMatch(/UPDATE\s+public\.driver_settlements\b/i);
    expect(CODE).not.toMatch(/UPDATE\s+public\.driver_settlement_items\b/i);
    expect(CODE).not.toMatch(/INSERT\s+INTO\s+public\.driver_settlements\b/i);
    expect(CODE).not.toMatch(/INSERT\s+INTO\s+public\.driver_settlement_items\b/i);
    expect(CODE).not.toMatch(/DELETE\s+FROM\s+public\.driver_settlement/i);
    expect(CODE).not.toContain('expected_amount_snapshot');
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C4C — integration with B2C4A and B2C4B', () => {
  it('27. REAL B2C4B refresh does not resurrect a rejected pair', async () => {
    S.int = await mkSettlement(U.dIntegration, 'draft');
    // snapshots chosen so the load scores a perfect 1.0000 'likely'
    const item = (
      await db.query<{ id: string }>(
        `INSERT INTO public.driver_settlement_items
           (settlement_id, item_type, amount, delivery_date_snapshot,
            origin_snapshot, destination_snapshot, loaded_miles_snapshot,
            created_by_user_id)
         VALUES ($1,'load_pay',1000.00,'2026-07-05'::date,'Dallas, TX',
                 'Atlanta, GA',800.00,$2) RETURNING id`,
        [S.int, U.dIntegration],
      )
    ).rows[0].id;
    I.int = item;
    L.int = await mkLoad(U.dIntegration);

    const suggested = await refresh(U.dIntegration, I.int);
    expect(suggested).toHaveLength(1);
    expect(suggested[0].match_state).toBe('likely');
    const suggestedId = suggested[0].id;
    const suggestedConfidence = suggested[0].confidence;

    const rejected = await reject(U.dIntegration, I.int, L.int);
    expect(rejected.id).toBe(suggestedId);
    expect(rejected.match_state).toBe('rejected');
    expect(rejected.confidence).toBe(suggestedConfidence);

    const again = await refresh(U.dIntegration, I.int);
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(suggestedId);
    expect(again[0].match_state).toBe('rejected');
    expect((await matchesFor(I.int)).map((m) => m.match_state)).toEqual([
      'rejected',
    ]);
  });

  it('28. REAL B2C4A confirm promotes the same rejected row to confirmed', async () => {
    const rowsBefore = await matchesFor(I.int);
    const out = await confirm(U.dIntegration, I.int, L.int);
    expect(out.id).toBe(rowsBefore[0].id);
    expect(out.match_state).toBe('confirmed');

    // and it can no longer be rejected
    expect(
      await failureMessage(() => reject(U.dIntegration, I.int, L.int)),
    ).toContain(ERR.alreadyAccepted);
  });

  it('29. no finalization / void / supersede / correction / export side effect', async () => {
    const r = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.driver_settlement_events
        WHERE event_type IN ('finalized','voided','superseded','exported')`,
    );
    expect(Number(r.rows[0].c)).toBe(0);
    for (const forbidden of [
      'finalized_at',
      'voided_at',
      'supersedes_settlement_id',
      'version_number',
      'calculation_version',
    ]) {
      expect(CODE, forbidden).not.toContain(forbidden);
    }
    expect(CODE).not.toMatch(/notif|email|http|net\.|pg_notify/i);
  });
});

// ---------------------------------------------------------------------------
describe('1T-B2C4C — candidate source contract', () => {
  it('30a. first line marks the file as a not-applied candidate', () => {
    expect(B2C4C_SQL.split('\n')[0]).toBe(
      '-- CANDIDATE MIGRATION — NOT APPLIED LIVE.',
    );
    expect(B2C4C_SQL).toContain('Phase 1T-B2C4C');
  });

  it('30b. exactly one explicit BEGIN/COMMIT transaction', () => {
    expect(CODE.match(/^\s*BEGIN;\s*$/gm) ?? []).toHaveLength(1);
    expect(CODE.match(/^\s*COMMIT;\s*$/gm) ?? []).toHaveLength(1);
    expect(CODE).not.toMatch(/ROLLBACK|SAVEPOINT/i);
  });

  it('30c. no unsafe DDL idioms, dynamic SQL, or error leakage', () => {
    expect(CODE).not.toMatch(/CREATE OR REPLACE/i);
    expect(CODE).not.toMatch(/IF NOT EXISTS/i);
    expect(CODE).not.toMatch(/\bDROP\b/i);
    expect(CODE).not.toMatch(/\bEXECUTE\s+(?!ON FUNCTION)/i);
    expect(CODE).not.toMatch(/format\s*\(/i);
    expect(CODE).not.toMatch(/SQLERRM|SQLSTATE|EXCEPTION\s+WHEN/i);
  });

  it('30d. creates exactly one function and changes no table DDL, policy, trigger, or table grant', () => {
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

  it('30e. no DML outside the function body', () => {
    const body = CODE.slice(
      CODE.indexOf('AS $$'),
      CODE.lastIndexOf('$$;') + 3,
    );
    const outside = CODE.replace(body, '');
    expect(outside).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it('30f. no skipped, todo, or focused tests in this suite', () => {
    expect(SELF_SRC).not.toMatch(/\b(it|describe|test)\.(skip|only|todo)\b/);
    expect(SELF_SRC).not.toMatch(/\b(xit|xdescribe|fit|fdescribe)\s*\(/);
  });

  it('30g. every raised failure is a fixed machine-readable token', async () => {
    const msg = await failureMessage(() =>
      reject(U.stranger, I.tx, L.tx),
    );
    expect(msg).not.toMatch(LEAK);
    const raises = CODE.match(/RAISE EXCEPTION '([a-z_]+)'/g) ?? [];
    expect(raises.length).toBeGreaterThanOrEqual(10);
    for (const r of raises) {
      expect(r).toMatch(/^RAISE EXCEPTION '[a-z_]+'$/);
    }
  });
});
