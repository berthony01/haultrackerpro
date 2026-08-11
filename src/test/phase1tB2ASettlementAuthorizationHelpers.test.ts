// @vitest-environment node
// =====================================================================
// Phase 1T-B2A — Settlement authorization helper candidate proofs.
//
// Applies the REAL accepted Phase 1T-B1 candidate and then the REAL
// Phase 1T-B2A candidate inside PGlite, on a minimal but faithful
// bootstrap, and proves catalog, ACL, and runtime authorization behavior
// plus static source-contract guarantees.
//
// No production database, no cloud application, no deploy, no publish.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const B1_REL =
  '../../supabase/migration-candidates/20260808161500_phase1t_b1_settlement_schema.sql';
const B2A_REL =
  '../../supabase/migration-candidates/20260808163500_phase1t_b2a_settlement_authorization_helpers.sql';

const B1_SQL = fs.readFileSync(fileURLToPath(new URL(B1_REL, import.meta.url)), 'utf8');
const B2A_SQL = fs.readFileSync(fileURLToPath(new URL(B2A_REL, import.meta.url)), 'utf8');

/** Executable SQL only: `--` documentation lines removed, so code-level
 *  prohibitions are asserted against real statements, not prose. */
const B2A_CODE = B2A_SQL.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');



const B2A_FUNCTIONS = [
  'settlement_current_user_can_administer_carrier',
  'settlement_current_user_can_assist_driver',
  'settlement_current_user_can_manage_agency',
  'settlement_current_user_can_manage_carrier',
  'settlement_current_user_can_manage_driver_import',
  'settlement_current_user_can_view_settlement',
] as const;

const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- Test implementation of auth.uid(): driven by a session setting so each
-- proof can execute helpers as a specific authenticated caller.
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
  user_id uuid NOT NULL
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

interface AnyPGlite {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

let db: AnyPGlite;
let beforeTables: string[] = [];
let beforeFunctions: string[] = [];
let beforeTriggers: string[] = [];
let beforeIndexes: string[] = [];
let afterTables: string[] = [];
let afterFunctions: string[] = [];
let afterTriggers: string[] = [];
let afterIndexes: string[] = [];

const U: Record<string, string> = {};
const R: Record<string, string> = {};
const A: Record<string, string> = {};
const REL: Record<string, string> = {};
const S: Record<string, string> = {};

async function names(sql: string, col: string): Promise<string[]> {
  const r = await db.query<Record<string, string>>(sql);
  return r.rows.map((x) => x[col]);
}

const TABLES_SQL = `SELECT tablename AS n FROM pg_tables WHERE schemaname='public' ORDER BY 1`;
const FUNCS_SQL = `SELECT p.proname AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' ORDER BY 1`;
const TRIGS_SQL = `SELECT t.tgname AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE NOT t.tgisinternal AND ns.nspname='public' ORDER BY 1`;
const IDX_SQL = `SELECT indexname AS n FROM pg_indexes WHERE schemaname='public' ORDER BY 1`;

async function newUser(): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO auth.users DEFAULT VALUES RETURNING id`,
  );
  return r.rows[0].id;
}

async function setUid(uid: string | null): Promise<void> {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid ?? '']);
}

async function boolOf(sql: string, params: unknown[] = []): Promise<boolean> {
  const r = await db.query<{ v: boolean | null }>(`SELECT (${sql}) AS v`, params);
  return r.rows[0].v === true;
}

const canImport = () => boolOf(`public.settlement_current_user_can_manage_driver_import()`);
const canAdminCarrier = (rid: string | null) =>
  boolOf(`public.settlement_current_user_can_administer_carrier($1::uuid)`, [rid]);
const canManageCarrier = (rid: string | null, rel: string | null, drv: string | null) =>
  boolOf(
    `public.settlement_current_user_can_manage_carrier($1::uuid,$2::uuid,$3::uuid)`,
    [rid, rel, drv],
  );
const canAssist = (drv: string | null, perm: string | null, pro = false) =>
  boolOf(
    `public.settlement_current_user_can_assist_driver($1::uuid,$2::text,$3::boolean)`,
    [drv, perm, pro],
  );
const canAgency = (aid: string | null, drv: string | null, perm: string | null) =>
  boolOf(
    `public.settlement_current_user_can_manage_agency($1::uuid,$2::uuid,$3::text)`,
    [aid, drv, perm],
  );
const canView = (sid: string | null) =>
  boolOf(`public.settlement_current_user_can_view_settlement($1::uuid)`, [sid]);

async function insertSettlement(row: Record<string, unknown>): Promise<string> {
  const keys = Object.keys(row);
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.driver_settlements (${keys.join(',')})
     VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    keys.map((k) => row[k]),
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;
  await db.exec(BOOTSTRAP);
  await db.exec(B1_SQL);

  beforeTables = await names(TABLES_SQL, 'n');
  beforeFunctions = await names(FUNCS_SQL, 'n');
  beforeTriggers = await names(TRIGS_SQL, 'n');
  beforeIndexes = await names(IDX_SQL, 'n');

  // Proof 1 — the real B2A candidate applies cleanly after the real B1 candidate.
  await db.exec(B2A_SQL);

  afterTables = await names(TABLES_SQL, 'n');
  afterFunctions = await names(FUNCS_SQL, 'n');
  afterTriggers = await names(TRIGS_SQL, 'n');
  afterIndexes = await names(IDX_SQL, 'n');

  // ---- users -------------------------------------------------------------
  for (const k of [
    'driverFree',
    'driverPro',
    'assistant',
    'assistantBad',
    'carrierOwner',
    'carrierExOwner',
    'carrierIncluded',
    'dualOwner',
    'betaOwner',
    'otherRecruiterOwner',
    'agencyOwnerUser',
    'agencyMemberUser',
    'agencyFinalizerUser',
    'agencyBMember',
    'betaMember',
    'agencyGenAssistant',
    'stranger',
  ]) {
    U[k] = await newUser();
  }

  await db.query(
    `INSERT INTO public.subscriptions (user_id, plan_key, status) VALUES
      ($1,'free',NULL),($2,'pro_monthly','active')`,
    [U.driverFree, U.driverPro],
  );

  // ---- recruiter profiles + billing ---------------------------------------
  const mkRecruiter = async (owner: string) => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO public.recruiter_profiles (user_id) VALUES ($1) RETURNING id`,
      [owner],
    );
    return r.rows[0].id;
  };
  R.paid = await mkRecruiter(U.carrierOwner);
  R.ex = await mkRecruiter(U.carrierExOwner);
  R.included = await mkRecruiter(U.carrierIncluded);
  R.dual = await mkRecruiter(U.dualOwner);
  R.beta = await mkRecruiter(U.betaOwner);
  R.other = await mkRecruiter(U.otherRecruiterOwner);

  await db.query(
    `INSERT INTO public.recruiter_billing_profiles (recruiter_id,user_id,plan,status) VALUES
      ($1,$2,'starter','active'),
      ($3,$4,'growth','trialing'), -- trial-allowlist: Stripe status literal, fixture
      ($5,$6,'fleet','active')`,
    [R.paid, U.carrierOwner, R.dual, U.dualOwner, R.beta, U.betaOwner],
  );
  // Non-owner agency member with an unrelated personal paid recruiter subscription.
  const rMember = await mkRecruiter(U.agencyMemberUser);
  R.member = rMember;
  await db.query(
    `INSERT INTO public.recruiter_billing_profiles (recruiter_id,user_id,plan,status)
     VALUES ($1,$2,'starter','active')`,
    [rMember, U.agencyMemberUser],
  );
  // Agency OWNER who also holds a standalone paid recruiter subscription.
  const rOwnerPersonal = await mkRecruiter(U.agencyOwnerUser);
  R.ownerPersonal = rOwnerPersonal;
  await db.query(
    `INSERT INTO public.recruiter_billing_profiles (recruiter_id,user_id,plan,status)
     VALUES ($1,$2,'growth','active')`,
    [rOwnerPersonal, U.agencyOwnerUser],
  );

  // ---- agencies ------------------------------------------------------------
  const mkAgency = async (owner: string, status = 'active') => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO public.agency_profiles (owner_user_id,status) VALUES ($1,$2) RETURNING id`,
      [owner, status],
    );
    return r.rows[0].id;
  };
  A.main = await mkAgency(U.agencyOwnerUser);
  A.b = await mkAgency(U.agencyBMember);
  A.dual = await mkAgency(U.dualOwner);
  A.beta = await mkAgency(U.betaOwner);
  A.includedLike = await mkAgency(U.carrierIncluded);
  A.inactive = await mkAgency(U.stranger, 'disabled');

  await db.query(
    `INSERT INTO public.agency_entitlements (agency_id,plan_key,status) VALUES
      ($1,'agency_team','active'),
      ($2,'agency_starter','cancelled'),
      ($3,'agency_growth','active'),
      ($4,'agency_starter','manual_beta'),
      ($5,'agency_team','active'),
      ($6,'agency_team','active')`,
    [A.main, A.b, A.dual, A.beta, A.includedLike, A.inactive],
  );

  await db.query(
    `INSERT INTO public.agency_members (agency_id,member_user_id,role,status) VALUES
      ($1,$2,'agency_owner','active'),
      ($1,$3,'agency_member','active'),
      ($1,$4,'agency_member','active'),
      ($5,$6,'agency_owner','active'),
      ($7,$8,'agency_owner','active'),
      ($9,$10,'agency_owner','active'),
      ($9,$13,'agency_member','active'),
      ($11,$12,'agency_owner','active')`,
    [
      A.main,
      U.agencyOwnerUser,
      U.agencyMemberUser,
      U.agencyFinalizerUser,
      A.b,
      U.agencyBMember,
      A.dual,
      U.dualOwner,
      A.beta,
      U.betaOwner,
      A.includedLike,
      U.carrierIncluded,
      U.betaMember,
    ],
  );

  await db.query(
    `INSERT INTO public.agency_delegation_requests
       (agency_id,driver_user_id,member_user_id,status,requested_permissions) VALUES
      ($1,$2,$3,'approved','{"settlements_view":true,"settlements_manage":true,"settlements_finalize":false}'::jsonb),
      ($1,$2,$4,'approved','{"settlements_finalize":true,"settlements_manage":true}'::jsonb),
      ($1,$2,$5,'approved','{"settlements_manage":true,"settlements_finalize":true}'::jsonb),
      ($6,$2,$7,'approved','{"settlements_view":true,"settlements_manage":true}'::jsonb),
      ($8,$2,$9,'approved','{"settlements_manage":true}'::jsonb)`,
    [
      A.main,
      U.driverFree,
      U.agencyMemberUser,
      U.agencyFinalizerUser,
      U.agencyOwnerUser,
      A.b,
      U.agencyBMember,
      A.beta,
      U.betaMember,
    ],
  );

  // ---- direct assistants ----------------------------------------------------
  await db.query(
    `INSERT INTO public.driver_assistants (driver_user_id,assistant_user_id,status,permissions) VALUES
      ($1,$2,'active','{"settlements_view":true,"settlements_manage":true,"settlements_finalize":true}'::jsonb),
      ($3,$2,'active','{"settlements_view":true,"settlements_manage":true,"settlements_finalize":true}'::jsonb),
      ($1,$4,'active','{"settlements_view":"true","settlements_manage":1,"settlements_finalize":null}'::jsonb),
      ($1,$5,'revoked','{"settlements_view":true}'::jsonb)`,
    [U.driverFree, U.assistant, U.driverPro, U.assistantBad, U.stranger],
  );

  // ---- agency-GENERATED assistant rows (non-null agency_delegation_id) --------
  // These must never satisfy the DIRECT assistant path.
  await db.query(
    `INSERT INTO public.driver_assistants
       (driver_user_id,assistant_user_id,status,permissions,agency_delegation_id) VALUES
      ($1,$2,'active','{"settlements_view":true,"settlements_manage":true,"settlements_finalize":true}'::jsonb,$4::uuid),
      ($3,$2,'active','{"settlements_view":true,"settlements_manage":true,"settlements_finalize":true}'::jsonb,$4::uuid)`,
    [
      U.driverFree,
      U.agencyGenAssistant,
      U.driverPro,
      '11111111-2222-3333-4444-555555555555',
    ],
  );


  // ---- carrier relationships -------------------------------------------------
  const mkRel = async (rid: string, drv: string, status: string, creator: string) => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO public.carrier_driver_relationships (recruiter_id,driver_user_id,status,created_by_user_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [rid, drv, status, creator],
    );
    return r.rows[0].id;
  };
  REL.active = await mkRel(R.paid, U.driverFree, 'active', U.carrierOwner);
  REL.invited = await mkRel(R.paid, U.driverPro, 'invited', U.carrierOwner);
  REL.ex = await mkRel(R.ex, U.driverFree, 'active', U.carrierExOwner);

  // ---- settlements -------------------------------------------------------------
  const period = { period_start: '2026-08-01', period_end: '2026-08-07' };
  S.carrierDraft = await insertSettlement({
    driver_user_id: U.driverFree,
    source: 'carrier_issued',
    status: 'draft',
    carrier_recruiter_profile_id: R.paid,
    carrier_driver_relationship_id: REL.active,
    source_display_name_snapshot: 'Acme Carrier LLC',
    created_by_user_id: U.carrierOwner,
    ...period,
  });
  S.carrierFinal = await insertSettlement({
    driver_user_id: U.driverFree,
    source: 'carrier_issued',
    status: 'finalized',
    carrier_recruiter_profile_id: R.paid,
    carrier_driver_relationship_id: REL.active,
    source_display_name_snapshot: 'Acme Carrier LLC',
    created_by_user_id: U.carrierOwner,
    ...period,
  });
  S.carrierExDraft = await insertSettlement({
    driver_user_id: U.driverFree,
    source: 'carrier_issued',
    status: 'draft',
    carrier_recruiter_profile_id: R.ex,
    carrier_driver_relationship_id: REL.ex,
    source_display_name_snapshot: 'Former Carrier LLC',
    created_by_user_id: U.carrierExOwner,
    ...period,
  });
  S.agencyDraft = await insertSettlement({
    driver_user_id: U.driverFree,
    source: 'agency_prepared',
    status: 'draft',
    agency_id: A.b,
    source_display_name_snapshot: 'Back Office Agency',
    created_by_user_id: U.agencyBMember,
    ...period,
  });
  S.agencyFinal = await insertSettlement({
    driver_user_id: U.driverFree,
    source: 'agency_prepared',
    status: 'finalized',
    agency_id: A.b,
    source_display_name_snapshot: 'Back Office Agency',
    created_by_user_id: U.agencyBMember,
    ...period,
  });
  S.importedDraft = await insertSettlement({
    driver_user_id: U.driverFree,
    source: 'driver_imported',
    status: 'draft',
    created_by_user_id: U.driverFree,
    ...period,
  });
});

// ---------------------------------------------------------------------------

describe('Phase 1T-B2A — candidate application and catalog shape', () => {
  it('applies the real B2A candidate after the real B1 candidate', () => {
    expect(B1_SQL.length).toBeGreaterThan(0);
    expect(B2A_SQL.length).toBeGreaterThan(0);
    expect(afterFunctions.length).toBeGreaterThan(beforeFunctions.length);
  });

  it('adds exactly the six B2A functions and nothing else', () => {
    const added = afterFunctions.filter((f) => !beforeFunctions.includes(f)).sort();
    expect(added).toEqual([...B2A_FUNCTIONS].sort());
  });

  it('adds zero tables, indexes, policies, or user triggers', async () => {
    expect(afterTables).toEqual(beforeTables);
    expect(afterIndexes).toEqual(beforeIndexes);
    expect(afterTriggers).toEqual(beforeTriggers);
    const pol = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM pg_policies WHERE schemaname='public'`,
    );
    expect(Number(pol.rows[0].c)).toBe(0);
  });

  it('declares every helper SECURITY DEFINER, stable/read-only, with a locked search_path', async () => {
    const r = await db.query<{
      proname: string;
      prosecdef: boolean;
      provolatile: string;
      config: string[] | null;
    }>(
      `SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig AS config
         FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
        WHERE ns.nspname='public' AND p.proname = ANY($1) ORDER BY 1`,
      [[...B2A_FUNCTIONS]],
    );
    expect(r.rows).toHaveLength(6);
    for (const row of r.rows) {
      expect(row.prosecdef).toBe(true);
      expect(['s', 'i']).toContain(row.provolatile);
      const cfg = (row.config ?? []).join(',');
      expect(cfg).toMatch(/search_path=/);
      expect(cfg).toMatch(/pg_catalog/);
      expect(cfg).toMatch(/public/);
      expect(cfg).toMatch(/auth/);
    }
  });

  it('grants EXECUTE to authenticated and service_role only', async () => {
    const r = await db.query<{
      proname: string;
      pub: boolean;
      anon: boolean;
      auth: boolean;
      svc: boolean;
    }>(
      `SELECT p.proname,
              has_function_privilege('public', p.oid, 'EXECUTE') AS pub,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
         FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
        WHERE ns.nspname='public' AND p.proname = ANY($1) ORDER BY 1`,
      [[...B2A_FUNCTIONS]],
    );
    expect(r.rows).toHaveLength(6);
    for (const row of r.rows) {
      expect(row.pub).toBe(false);
      expect(row.anon).toBe(false);
      expect(row.auth).toBe(true);
      expect(row.svc).toBe(true);
    }
  });

  it('executes under the authenticated role without granting privileged access', async () => {
    await setUid(null);
    await db.exec(`SET ROLE authenticated`);
    const v = await canImport();
    await db.exec(`RESET ROLE`);
    expect(v).toBe(false);
  });
});

describe('Phase 1T-B2A — unauthenticated callers', () => {
  it('returns false from every authorization helper when auth.uid() is null', async () => {
    await setUid(null);
    expect(await canImport()).toBe(false);
    expect(await canAdminCarrier(R.paid)).toBe(false);
    expect(await canManageCarrier(R.paid, REL.active, U.driverFree)).toBe(false);
    expect(await canAssist(U.driverFree, 'settlements_view')).toBe(false);
    expect(await canAgency(A.main, U.driverFree, 'settlements_manage')).toBe(false);
    expect(await canView(S.carrierFinal)).toBe(false);
    expect(await canView(S.importedDraft)).toBe(false);
  });
});

describe('Phase 1T-B2A — driver import management', () => {
  it('allows an active Pro driver', async () => {
    await setUid(U.driverPro);
    expect(await canImport()).toBe(true);
  });

  it('fails closed for Free, missing, inactive, cancelled, and malformed rows', async () => {
    await setUid(U.driverFree);
    expect(await canImport()).toBe(false);

    await setUid(U.stranger); // no subscriptions row at all
    expect(await canImport()).toBe(false);

    await setUid(U.driverPro);
    for (const [plan, status] of [
      ['pro_monthly', 'canceled'],
      ['pro_monthly', 'past_due'],
      ['pro_monthly', null],
      ['pro', 'active'],
      ['PRO_MONTHLY', 'active'],
      [null, 'active'],
    ] as [string | null, string | null][]) {
      await db.query(`UPDATE public.subscriptions SET plan_key=$1, status=$2 WHERE user_id=$3`, [
        plan,
        status,
        U.driverPro,
      ]);
      expect(await canImport()).toBe(false);
    }
    await db.query(
      `UPDATE public.subscriptions SET plan_key='pro_monthly', status='active' WHERE user_id=$1`,
      [U.driverPro],
    );
    expect(await canImport()).toBe(true);
  });
});

describe('Phase 1T-B2A — carrier administration', () => {
  it('allows only the recruiter-profile owner with standalone paid billing', async () => {
    await setUid(U.carrierOwner);
    expect(await canAdminCarrier(R.paid)).toBe(true);

    await setUid(U.otherRecruiterOwner);
    expect(await canAdminCarrier(R.paid)).toBe(false);

    await setUid(U.carrierOwner);
    expect(await canAdminCarrier(R.other)).toBe(false);
    expect(await canAdminCarrier(null)).toBe(false);
  });

  it('fails closed for free_verified/none/malformed/past_due/cancelled billing', async () => {
    await setUid(U.carrierOwner);
    for (const [plan, status] of [
      ['free_verified', 'active'],
      ['none', 'active'],
      ['Starter', 'active'],
      ['starter', 'past_due'],
      ['starter', 'cancelled'],
      ['starter', null],
      [null, 'active'],
    ] as [string | null, string | null][]) {
      await db.query(
        `UPDATE public.recruiter_billing_profiles SET plan=$1, status=$2 WHERE recruiter_id=$3`,
        [plan, status, R.paid],
      );
      expect(await canAdminCarrier(R.paid)).toBe(false);
    }
    await db.query(
      `UPDATE public.recruiter_billing_profiles SET plan='starter', status='active' WHERE recruiter_id=$1`,
      [R.paid],
    );
    expect(await canAdminCarrier(R.paid)).toBe(true);
  });

  it('rejects an agency-included-like state with no paid recruiter billing row', async () => {
    await setUid(U.carrierIncluded);
    const rows = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.recruiter_billing_profiles WHERE recruiter_id=$1`,
      [R.included],
    );
    expect(Number(rows.rows[0].c)).toBe(0);
    expect(await canAdminCarrier(R.included)).toBe(false);
  });

  it('rejects a dual active paid recruiter + active paid agency owner', async () => {
    await setUid(U.dualOwner);
    expect(await canAdminCarrier(R.dual)).toBe(false);
  });

  it('does not treat a manual_beta agency owner as a dual-paid conflict', async () => {
    await setUid(U.betaOwner);
    expect(await canAdminCarrier(R.beta)).toBe(true);
  });
});

describe('Phase 1T-B2A — carrier settlement management', () => {
  it('requires the exact active relationship triple', async () => {
    await setUid(U.carrierOwner);
    expect(await canManageCarrier(R.paid, REL.active, U.driverFree)).toBe(true);
  });

  it('fails for invited/inactive/ended or mismatched relationships', async () => {
    await setUid(U.carrierOwner);
    expect(await canManageCarrier(R.paid, REL.invited, U.driverPro)).toBe(false);
    expect(await canManageCarrier(R.paid, REL.active, U.driverPro)).toBe(false);
    expect(await canManageCarrier(R.paid, REL.ex, U.driverFree)).toBe(false);
    expect(await canManageCarrier(R.paid, null, U.driverFree)).toBe(false);
    expect(await canManageCarrier(R.paid, REL.active, null)).toBe(false);

    for (const st of ['inactive', 'ended', 'invited']) {
      await db.query(`UPDATE public.carrier_driver_relationships SET status=$1 WHERE id=$2`, [
        st,
        REL.active,
      ]);
      expect(await canManageCarrier(R.paid, REL.active, U.driverFree)).toBe(false);
    }
    await db.query(
      `UPDATE public.carrier_driver_relationships SET status='active' WHERE id=$1`,
      [REL.active],
    );
    expect(await canManageCarrier(R.paid, REL.active, U.driverFree)).toBe(true);
  });
});

describe('Phase 1T-B2A — assistant delegation', () => {
  it('requires an exact JSON boolean true permission', async () => {
    await setUid(U.assistant);
    expect(await canAssist(U.driverFree, 'settlements_view')).toBe(true);

    await setUid(U.assistantBad);
    expect(await canAssist(U.driverFree, 'settlements_view')).toBe(false);
    expect(await canAssist(U.driverFree, 'settlements_manage')).toBe(false);
    expect(await canAssist(U.driverFree, 'settlements_finalize')).toBe(false);

    await setUid(U.assistant);
    expect(await canAssist(U.driverFree, 'settlements_admin')).toBe(false);
    expect(await canAssist(U.driverFree, 'Settlements_View')).toBe(false);
    expect(await canAssist(U.driverFree, ' settlements_view ')).toBe(false);
    expect(await canAssist(U.driverFree, null)).toBe(false);
    expect(await canAssist(null, 'settlements_view')).toBe(false);

    await setUid(U.stranger); // revoked assistant row
    expect(await canAssist(U.driverFree, 'settlements_view')).toBe(false);
  });

  it('allows basic view for a Free target driver when require_pro is false', async () => {
    await setUid(U.assistant);
    expect(await canAssist(U.driverFree, 'settlements_view', false)).toBe(true);
  });

  it('gates require_pro on the target driver, not the assistant', async () => {
    await setUid(U.assistant);
    expect(await canAssist(U.driverFree, 'settlements_manage', true)).toBe(false);
    expect(await canAssist(U.driverFree, 'settlements_finalize', true)).toBe(false);
    expect(await canAssist(U.driverPro, 'settlements_manage', true)).toBe(true);
    expect(await canAssist(U.driverPro, 'settlements_finalize', true)).toBe(true);
  });
});

describe('Phase 1T-B2A — agency settlement management', () => {
  it('allows an active member with paid/trialing/manual_beta plan and approved delegation', async () => { // trial-allowlist
    await setUid(U.agencyMemberUser);
    expect(await canAgency(A.main, U.driverFree, 'settlements_manage')).toBe(true);

    await db.query(`UPDATE public.agency_entitlements SET status='trialing' WHERE agency_id=$1 -- trial-allowlist`, [
      A.main,
    ]);
    expect(await canAgency(A.main, U.driverFree, 'settlements_manage')).toBe(true);
    await db.query(`UPDATE public.agency_entitlements SET status='active' WHERE agency_id=$1`, [
      A.main,
    ]);

    // manual_beta grandfathered workspace, and a Free target driver never gates it.
    await setUid(U.betaMember);
    expect(await canAgency(A.beta, U.driverFree, 'settlements_manage')).toBe(true);
  });

  it('fails for bad plan/status, inactive or wrong member, unapproved delegation, and wrong scope', async () => {
    await setUid(U.agencyMemberUser);

    for (const [plan, status] of [
      ['agency_team', 'cancelled'],
      ['agency_team', 'past_due'],
      ['agency_bogus', 'active'],
      ['agency_team', null],
      [null, 'active'],
    ] as [string | null, string | null][]) {
      await db.query(
        `UPDATE public.agency_entitlements SET plan_key=$1, status=$2 WHERE agency_id=$3`,
        [plan, status, A.main],
      );
      expect(await canAgency(A.main, U.driverFree, 'settlements_manage')).toBe(false);
    }
    await db.query(
      `UPDATE public.agency_entitlements SET plan_key='agency_team', status='active' WHERE agency_id=$1`,
      [A.main],
    );

    // inactive agency profile
    await db.query(`UPDATE public.agency_profiles SET status='disabled' WHERE id=$1`, [A.main]);
    expect(await canAgency(A.main, U.driverFree, 'settlements_manage')).toBe(false);
    await db.query(`UPDATE public.agency_profiles SET status='active' WHERE id=$1`, [A.main]);

    // inactive membership
    await db.query(
      `UPDATE public.agency_members SET status='revoked' WHERE agency_id=$1 AND member_user_id=$2`,
      [A.main, U.agencyMemberUser],
    );
    expect(await canAgency(A.main, U.driverFree, 'settlements_manage')).toBe(false);
    await db.query(
      `UPDATE public.agency_members SET status='active' WHERE agency_id=$1 AND member_user_id=$2`,
      [A.main, U.agencyMemberUser],
    );

    // wrong member / unapproved delegation / wrong driver / wrong agency
    await setUid(U.stranger);
    expect(await canAgency(A.main, U.driverFree, 'settlements_manage')).toBe(false);
    await setUid(U.agencyMemberUser);
    expect(await canAgency(A.main, U.driverPro, 'settlements_manage')).toBe(false);
    expect(await canAgency(A.b, U.driverFree, 'settlements_manage')).toBe(false);
    expect(await canAgency(null, U.driverFree, 'settlements_manage')).toBe(false);
    expect(await canAgency(A.main, U.driverFree, 'settlements_view')).toBe(false);
    expect(await canAgency(A.main, U.driverFree, 'SETTLEMENTS_MANAGE')).toBe(false);
    expect(await canAgency(A.main, U.driverFree, null)).toBe(false);

    await db.query(
      `UPDATE public.agency_delegation_requests SET status='pending_driver_approval'
        WHERE agency_id=$1 AND member_user_id=$2`,
      [A.main, U.agencyMemberUser],
    );
    expect(await canAgency(A.main, U.driverFree, 'settlements_manage')).toBe(false);
    await db.query(
      `UPDATE public.agency_delegation_requests SET status='approved'
        WHERE agency_id=$1 AND member_user_id=$2`,
      [A.main, U.agencyMemberUser],
    );

    // string "true" / boolean false permissions never authorize
    await db.query(
      `UPDATE public.agency_delegation_requests
          SET requested_permissions='{"settlements_manage":"true"}'::jsonb
        WHERE agency_id=$1 AND member_user_id=$2`,
      [A.main, U.agencyMemberUser],
    );
    expect(await canAgency(A.main, U.driverFree, 'settlements_manage')).toBe(false);
    await db.query(
      `UPDATE public.agency_delegation_requests
          SET requested_permissions='{"settlements_manage":false}'::jsonb
        WHERE agency_id=$1 AND member_user_id=$2`,
      [A.main, U.agencyMemberUser],
    );
    expect(await canAgency(A.main, U.driverFree, 'settlements_manage')).toBe(false);
    await db.query(
      `UPDATE public.agency_delegation_requests
          SET requested_permissions='{"settlements_view":true,"settlements_manage":true,"settlements_finalize":false}'::jsonb
        WHERE agency_id=$1 AND member_user_id=$2`,
      [A.main, U.agencyMemberUser],
    );
    expect(await canAgency(A.main, U.driverFree, 'settlements_manage')).toBe(true);
  });

  it('requires the exact settlements_finalize permission to finalize', async () => {
    await setUid(U.agencyMemberUser);
    expect(await canAgency(A.main, U.driverFree, 'settlements_finalize')).toBe(false);
    await setUid(U.agencyFinalizerUser);
    expect(await canAgency(A.main, U.driverFree, 'settlements_finalize')).toBe(true);
  });

  it('applies the dual-paid conflict to the agency OWNER only', async () => {
    await setUid(U.agencyOwnerUser);
    expect(await canAgency(A.main, U.driverFree, 'settlements_manage')).toBe(false);

    await setUid(U.agencyMemberUser); // non-owner with a personal paid recruiter plan
    expect(await canAgency(A.main, U.driverFree, 'settlements_manage')).toBe(true);
  });
});

describe('Phase 1T-B2A — settlement read access', () => {
  it('lets a Free recipient driver view finalized carrier-issued and agency-prepared statements', async () => {
    await setUid(U.driverFree);
    expect(await canView(S.carrierFinal)).toBe(true);
    expect(await canView(S.agencyFinal)).toBe(true);
  });

  it('hides business-sourced drafts from the recipient driver', async () => {
    await setUid(U.driverFree);
    expect(await canView(S.carrierDraft)).toBe(false);
    expect(await canView(S.agencyDraft)).toBe(false);
  });

  it('lets the recipient driver view their own driver_imported draft with no active Pro row', async () => {
    await setUid(U.driverFree);
    const sub = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.subscriptions
        WHERE user_id=$1 AND plan_key IN ('pro_monthly','pro_yearly') AND status='active'`,
      [U.driverFree],
    );
    expect(Number(sub.rows[0].c)).toBe(0);
    expect(await canView(S.importedDraft)).toBe(true);
  });

  it('lets the current carrier owner view their own draft history without active billing', async () => {
    await setUid(U.carrierExOwner);
    const billing = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.recruiter_billing_profiles WHERE recruiter_id=$1`,
      [R.ex],
    );
    expect(Number(billing.rows[0].c)).toBe(0);
    expect(await canView(S.carrierExDraft)).toBe(true);

    await setUid(U.otherRecruiterOwner);
    expect(await canView(S.carrierExDraft)).toBe(false);
    expect(await canView(S.carrierDraft)).toBe(false);
  });

  it('lets the current agency preparer view their own draft after the entitlement is cancelled', async () => {
    const ent = await db.query<{ status: string }>(
      `SELECT status FROM public.agency_entitlements WHERE agency_id=$1`,
      [A.b],
    );
    expect(ent.rows[0].status).toBe('cancelled');
    await setUid(U.agencyBMember);
    expect(await canView(S.agencyDraft)).toBe(true);
    expect(await canView(S.agencyFinal)).toBe(true);

    await setUid(U.agencyFinalizerUser); // member of a different agency
    expect(await canView(S.agencyDraft)).toBe(false);
  });

  it('lets a direct assistant view finalized company statements but never company drafts', async () => {
    await setUid(U.assistant);
    expect(await canView(S.carrierFinal)).toBe(true);
    expect(await canView(S.agencyFinal)).toBe(true);
    expect(await canView(S.carrierDraft)).toBe(false);
  });

  it('lets an agency-delegated member view finalized company statements but never company drafts', async () => {
    await setUid(U.agencyMemberUser);
    expect(await canView(S.carrierFinal)).toBe(true);
    expect(await canView(S.carrierDraft)).toBe(false);
  });

  it('lets a delegated viewer see driver_imported drafts with no Pro requirement', async () => {
    await setUid(U.assistant);
    expect(await canView(S.importedDraft)).toBe(true);
    await setUid(U.agencyMemberUser);
    expect(await canView(S.importedDraft)).toBe(true);
  });

  it('fails closed for strangers, missing ids, and rejects malformed source/status at insert', async () => {
    await setUid(U.stranger);
    expect(await canView(S.carrierFinal)).toBe(false);
    expect(await canView(S.importedDraft)).toBe(false);
    await setUid(U.driverFree);
    expect(await canView(null)).toBe(false);
    expect(await canView('00000000-0000-0000-0000-000000000000')).toBe(false);

    let msg = '';
    try {
      await insertSettlement({
        driver_user_id: U.driverFree,
        source: 'payroll_run',
        status: 'finalized',
        created_by_user_id: U.driverFree,
        period_start: '2026-08-01',
        period_end: '2026-08-07',
      });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/source_check|constraint/i);

    // The helper uses exact status allowlists rather than a permissive
    // `status <> 'draft'` shortcut, so an unknown future status cannot leak.
    expect(B2A_CODE).not.toMatch(/<>\s*'draft'/);
    expect(B2A_CODE).not.toMatch(/!=\s*'draft'/);
    expect(B2A_SQL).toMatch(/IN \('finalized', 'superseded', 'voided'\)/);
  });

  it('does not mutate caller session fixtures or business rows', async () => {
    const snapshot = async () => {
      const r = await db.query<{ v: string }>(
        `SELECT
           (SELECT count(*) FROM public.driver_settlements)::text || '|' ||
           (SELECT count(*) FROM public.subscriptions)::text || '|' ||
           (SELECT count(*) FROM public.recruiter_billing_profiles)::text || '|' ||
           (SELECT count(*) FROM public.agency_entitlements)::text || '|' ||
           (SELECT count(*) FROM public.agency_delegation_requests)::text || '|' ||
           (SELECT count(*) FROM public.driver_assistants)::text || '|' ||
           (SELECT count(*) FROM public.carrier_driver_relationships)::text AS v`,
      );
      return r.rows[0].v;
    };
    await setUid(U.driverFree);
    const before = await snapshot();
    await canImport();
    await canAdminCarrier(R.paid);
    await canManageCarrier(R.paid, REL.active, U.driverFree);
    await canAssist(U.driverFree, 'settlements_view');
    await canAgency(A.main, U.driverFree, 'settlements_manage');
    await canView(S.carrierFinal);
    const after = await snapshot();
    expect(after).toBe(before);
    const uid = await db.query<{ v: string }>(`SELECT current_setting('test.uid', true) AS v`);
    expect(uid.rows[0].v).toBe(U.driverFree);
  });
});

describe('Phase 1T-B2A — source contract', () => {
  it('is a candidate, not applied live, with exactly one explicit transaction', () => {
    expect(B2A_SQL.split('\n')[0].trim()).toBe('-- CANDIDATE MIGRATION — NOT APPLIED LIVE.');
    expect(B2A_SQL).toMatch(/Phase 1T-B2A/);
    expect(B2A_SQL.match(/^BEGIN;$/gm) ?? []).toHaveLength(1);
    expect(B2A_SQL.match(/^COMMIT;$/gm) ?? []).toHaveLength(1);
    expect(B2A_CODE).not.toMatch(/IF NOT EXISTS/i);
  });

  it('creates exactly six functions and zero policies/triggers/table DDL/DML', () => {
    const createFns = B2A_SQL.match(/^CREATE FUNCTION /gm) ?? [];
    expect(createFns).toHaveLength(6);
    for (const fn of B2A_FUNCTIONS) expect(B2A_SQL).toContain(`public.${fn}`);
    expect(B2A_SQL).not.toMatch(/CREATE\s+(OR REPLACE\s+)?POLICY/i);
    expect(B2A_SQL).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(B2A_SQL).not.toMatch(/CREATE\s+TABLE/i);
    expect(B2A_SQL).not.toMatch(/ALTER\s+TABLE/i);
    expect(B2A_SQL).not.toMatch(/DROP\s+(TABLE|COLUMN|POLICY|TRIGGER)/i);
    expect(B2A_SQL).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(B2A_SQL).not.toMatch(/CREATE\s+(TYPE|VIEW)/i);
    expect(B2A_SQL).not.toMatch(/INSERT\s+INTO/i);
    expect(B2A_SQL).not.toMatch(/^\s*UPDATE\s+public\./im);
    expect(B2A_SQL).not.toMatch(/DELETE\s+FROM/i);
  });

  it('never authorizes by email and has no admin or service-role bypass branch', () => {
    expect(B2A_CODE).not.toMatch(/email/i);
    expect(B2A_SQL).not.toMatch(/is_admin|admin_users|has_role\(/i);
    expect(B2A_SQL).not.toMatch(/current_user\s*=\s*'service_role'/i);
    expect(B2A_SQL).not.toMatch(/EXECUTE\s+format\(/i);
    expect(B2A_SQL).not.toMatch(/LANGUAGE plpgsql/i);
    expect(B2A_SQL).toMatch(/auth\.uid\(\)/);
  });

  it('grants execute only to authenticated and service_role', () => {
    const grants = B2A_SQL.match(/^GRANT EXECUTE ON FUNCTION .*$/gm) ?? [];
    expect(grants).toHaveLength(6);
    for (const g of grants) expect(g).toMatch(/TO authenticated, service_role;$/);
    const revokes = B2A_SQL.match(/^REVOKE ALL ON FUNCTION .*FROM PUBLIC, anon;$/gm) ?? [];
    expect(revokes).toHaveLength(6);
    expect(B2A_SQL).not.toMatch(/TO anon/);
  });
});

// ===========================================================================
// Phase 1T-B2A-R1 — direct assistant / agency delegation isolation
// ===========================================================================
describe('Phase 1T-B2A-R1 — direct vs agency-delegated assistant isolation', () => {
  it('rejects an agency-generated driver_assistants row on the DIRECT assistant helper', async () => {
    await setUid(U.agencyGenAssistant);
    // Row is active with exact JSON boolean true permissions; the ONLY
    // disqualifier is the non-null agency_delegation_id.
    expect(await canAssist(U.driverFree, 'settlements_view', false)).toBe(false);
    expect(await canAssist(U.driverPro, 'settlements_manage', true)).toBe(false);
    expect(await canAssist(U.driverPro, 'settlements_finalize', true)).toBe(false);
  });

  it('does not leak read access through the direct branch without a real agency path', async () => {
    await setUid(U.agencyGenAssistant);
    // Finalized business-sourced statement: draft status cannot be the reason.
    expect(await canView(S.carrierFinal)).toBe(false);
  });

  it('grants read access once the legitimate agency membership + delegation exists', async () => {
    await db.query(
      `INSERT INTO public.agency_members (agency_id,member_user_id,role,status)
       VALUES ($1,$2,'agency_member','active')`,
      [A.main, U.agencyGenAssistant],
    );
    await db.query(
      `INSERT INTO public.agency_delegation_requests
         (agency_id,driver_user_id,member_user_id,status,requested_permissions)
       VALUES ($1,$2,$3,'approved','{"settlements_view":true}'::jsonb)`,
      [A.main, U.driverFree, U.agencyGenAssistant],
    );

    await setUid(U.agencyGenAssistant);
    expect(await canView(S.carrierFinal)).toBe(true);
    // Direct helper stays closed — the agency path is not a direct grant.
    expect(await canAssist(U.driverFree, 'settlements_view', false)).toBe(false);
  });

  it('leaves a genuine direct assistant (agency_delegation_id IS NULL) fully working', async () => {
    await setUid(U.assistant);
    expect(await canAssist(U.driverFree, 'settlements_view', false)).toBe(true);
    expect(await canAssist(U.driverPro, 'settlements_manage', true)).toBe(true);
    expect(await canAssist(U.driverPro, 'settlements_finalize', true)).toBe(true);
    expect(await canView(S.carrierFinal)).toBe(true);
    expect(await canView(S.carrierDraft)).toBe(false);
    expect(await canView(S.importedDraft)).toBe(true);
  });

  it('source-contract: both direct driver_assistants queries require agency_delegation_id IS NULL', () => {
    const occurrences =
      B2A_CODE.match(/da\.agency_delegation_id\s+IS\s+NULL/gi) ?? [];
    expect(occurrences).toHaveLength(2);

    const assistFn = B2A_CODE.slice(
      B2A_CODE.indexOf('CREATE FUNCTION public.settlement_current_user_can_assist_driver'),
      B2A_CODE.indexOf('CREATE FUNCTION public.settlement_current_user_can_manage_agency'),
    );
    expect(assistFn).toMatch(/da\.agency_delegation_id\s+IS\s+NULL/i);

    const viewFn = B2A_CODE.slice(
      B2A_CODE.indexOf(
        'CREATE FUNCTION public.settlement_current_user_can_view_settlement',
      ),
    );
    expect(viewFn).toMatch(/FROM public\.driver_assistants da/);
    expect(viewFn).toMatch(/da\.agency_delegation_id\s+IS\s+NULL/i);
  });
});

