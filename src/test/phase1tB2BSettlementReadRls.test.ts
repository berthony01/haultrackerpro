// @vitest-environment node
// =====================================================================
// Phase 1T-B2B — Read-only settlement RLS candidate proofs.
//
// Applies, in order, the REAL accepted Phase 1T-B1 candidate, the REAL
// accepted Phase 1T-B2A candidate, and the REAL Phase 1T-B2B candidate
// inside PGlite on a minimal but faithful bootstrap, then proves catalog
// shape, runtime read authorization, the hard write boundary, and static
// source-contract guarantees.
//
// Table privileges for the `authenticated` role are granted ONLY inside
// this harness so that RLS — never a missing SQL privilege — is what
// proves the read/write boundary.
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
const B2B_REL =
  '../../supabase/migration-candidates/20260808165000_phase1t_b2b_settlement_read_rls.sql';

const B1_SQL = fs.readFileSync(fileURLToPath(new URL(B1_REL, import.meta.url)), 'utf8');
const B2A_SQL = fs.readFileSync(fileURLToPath(new URL(B2A_REL, import.meta.url)), 'utf8');
const B2B_SQL = fs.readFileSync(fileURLToPath(new URL(B2B_REL, import.meta.url)), 'utf8');

/** Executable SQL only: `--` documentation lines removed, so code-level
 *  prohibitions are asserted against real statements, not prose. */
const B2B_CODE = B2B_SQL.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const PHASE_1T_TABLES = [
  'carrier_driver_relationships',
  'driver_settlements',
  'driver_settlement_items',
  'driver_settlement_matches',
  'driver_settlement_events',
] as const;

const EXPECTED_POLICIES: Array<{ table: string; policy: string }> = [
  {
    table: 'carrier_driver_relationships',
    policy: 'carrier_driver_relationships_select_authorized',
  },
  { table: 'driver_settlements', policy: 'driver_settlements_select_authorized' },
  {
    table: 'driver_settlement_items',
    policy: 'driver_settlement_items_select_authorized',
  },
  {
    table: 'driver_settlement_matches',
    policy: 'driver_settlement_matches_select_authorized',
  },
  {
    table: 'driver_settlement_events',
    policy: 'driver_settlement_events_select_authorized',
  },
];

const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- Test implementation of auth.uid(): driven by a session setting so each
-- proof can execute as a specific authenticated caller.
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

/** Harness-only privileges. Deliberately NOT part of the candidate: the point
 *  is that RLS, not a missing GRANT, blocks reads and writes. */
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
  public.carrier_driver_relationships,
  public.driver_settlements,
  public.driver_settlement_items,
  public.driver_settlement_matches,
  public.driver_settlement_events
TO anon;
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

const TABLES_SQL = `SELECT tablename AS n FROM pg_tables WHERE schemaname='public' ORDER BY 1`;
const FUNCS_SQL = `SELECT p.proname AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' ORDER BY 1`;
const IDX_SQL = `SELECT indexname AS n FROM pg_indexes WHERE schemaname='public' ORDER BY 1`;
const TRIGS_SQL = `SELECT t.tgname AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE NOT t.tgisinternal AND ns.nspname='public' ORDER BY 1`;
const VIEWS_SQL = `SELECT viewname AS n FROM pg_views WHERE schemaname='public' ORDER BY 1`;
const TYPES_SQL = `SELECT t.typname AS n FROM pg_type t JOIN pg_namespace ns ON ns.oid=t.typnamespace WHERE ns.nspname='public' AND t.typtype IN ('e','c','d') ORDER BY 1`;
const POLICIES_SQL = `SELECT (tablename || '.' || policyname) AS n FROM pg_policies WHERE schemaname='public' ORDER BY 1`;

async function names(sql: string): Promise<string[]> {
  const r = await db.query<{ n: string }>(sql);
  return r.rows.map((x) => x.n);
}

// --- actors / fixtures -----------------------------------------------------
const U: Record<string, string> = {};
const S: Record<string, string> = {};
let recruiterA = '';
let recruiterB = '';
let relationshipA = '';
let relationshipB = '';
let agencyA = '';
let agencyB = '';
let itemVisible = '';
let itemHidden = '';
let matchVisible = '';
let matchHidden = '';
let eventVisible = '';
let eventHidden = '';
let loadFree = '';

async function newUser(): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO auth.users DEFAULT VALUES RETURNING id`,
  );
  return r.rows[0].id;
}

/** Run a callback as the given role with the given auth.uid(). */
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

async function idsOf(table: string): Promise<string[]> {
  const r = await db.query<{ id: string }>(
    `SELECT id FROM public.${table} ORDER BY id`,
  );
  return r.rows.map((x) => x.id);
}

/** Read ids, treating an outright privilege denial as "no rows exposed". */
async function idsOrDenied(table: string): Promise<string[]> {
  try {
    return await idsOf(table);
  } catch {
    return [];
  }
}

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
  await db.exec(HARNESS_GRANTS);
  await db.exec(B2A_SQL);

  beforeTables = await names(TABLES_SQL);
  beforeFunctions = await names(FUNCS_SQL);
  beforeIndexes = await names(IDX_SQL);
  beforeTriggers = await names(TRIGS_SQL);
  beforeViews = await names(VIEWS_SQL);
  beforeTypes = await names(TYPES_SQL);
  beforePolicies = await names(POLICIES_SQL);

  await db.exec(B2B_SQL);

  afterTables = await names(TABLES_SQL);
  afterFunctions = await names(FUNCS_SQL);
  afterIndexes = await names(IDX_SQL);
  afterTriggers = await names(TRIGS_SQL);
  afterViews = await names(VIEWS_SQL);
  afterTypes = await names(TYPES_SQL);

  // ---- actors -------------------------------------------------------------
  for (const k of [
    'freeDriver',
    'proDriver',
    'stranger',
    'carrierOwner',
    'otherCarrier',
    'directAssistant',
    'agencyGenAssistant',
    'agencyOwner',
    'agencyPreparer',
    'agencyBOwner',
  ]) {
    U[k] = await newUser();
  }

  await db.query(
    `INSERT INTO public.subscriptions (user_id, plan_key, status) VALUES ($1,'pro_monthly','active')`,
    [U.proDriver],
  );

  // ---- carrier businesses -------------------------------------------------
  recruiterA = (
    await db.query<{ id: string }>(
      `INSERT INTO public.recruiter_profiles (user_id) VALUES ($1) RETURNING id`,
      [U.carrierOwner],
    )
  ).rows[0].id;
  recruiterB = (
    await db.query<{ id: string }>(
      `INSERT INTO public.recruiter_profiles (user_id) VALUES ($1) RETURNING id`,
      [U.otherCarrier],
    )
  ).rows[0].id;

  await db.query(
    `INSERT INTO public.recruiter_billing_profiles (recruiter_id, user_id, plan, status)
     VALUES ($1,$2,'growth','active')`,
    [recruiterA, U.carrierOwner],
  );

  relationshipA = (
    await db.query<{ id: string }>(
      `INSERT INTO public.carrier_driver_relationships
         (recruiter_id, driver_user_id, status, created_by_user_id)
       VALUES ($1,$2,'active',$3) RETURNING id`,
      [recruiterA, U.freeDriver, U.carrierOwner],
    )
  ).rows[0].id;
  relationshipB = (
    await db.query<{ id: string }>(
      `INSERT INTO public.carrier_driver_relationships
         (recruiter_id, driver_user_id, status, created_by_user_id)
       VALUES ($1,$2,'active',$3) RETURNING id`,
      [recruiterB, U.proDriver, U.otherCarrier],
    )
  ).rows[0].id;

  // ---- agencies -----------------------------------------------------------
  agencyA = (
    await db.query<{ id: string }>(
      `INSERT INTO public.agency_profiles (owner_user_id, status) VALUES ($1,'active') RETURNING id`,
      [U.agencyOwner],
    )
  ).rows[0].id;
  agencyB = (
    await db.query<{ id: string }>(
      `INSERT INTO public.agency_profiles (owner_user_id, status) VALUES ($1,'active') RETURNING id`,
      [U.agencyBOwner],
    )
  ).rows[0].id;

  await db.query(
    `INSERT INTO public.agency_members (agency_id, member_user_id, role, status)
     VALUES ($1,$2,'agency_owner','active'), ($1,$3,'agency_member','active')`,
    [agencyA, U.agencyOwner, U.agencyPreparer],
  );
  await db.query(
    `INSERT INTO public.agency_entitlements (agency_id, plan_key, status)
     VALUES ($1,'agency_team','active')`,
    [agencyA],
  );
  await db.query(
    `INSERT INTO public.agency_delegation_requests
       (agency_id, driver_user_id, member_user_id, status, requested_permissions)
     VALUES ($1,$2,$3,'approved','{"settlements_view":true,"settlements_manage":true}'::jsonb)`,
    [agencyA, U.freeDriver, U.agencyPreparer],
  );

  // ---- assistants ---------------------------------------------------------
  await db.query(
    `INSERT INTO public.driver_assistants
       (driver_user_id, assistant_user_id, status, permissions, agency_delegation_id)
     VALUES ($1,$2,'active','{"settlements_view":true}'::jsonb, NULL)`,
    [U.freeDriver, U.directAssistant],
  );
  await db.query(
    `INSERT INTO public.driver_assistants
       (driver_user_id, assistant_user_id, status, permissions, agency_delegation_id)
     VALUES ($1,$2,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb,
             '11111111-2222-3333-4444-555555555555'::uuid)`,
    [U.freeDriver, U.agencyGenAssistant],
  );

  // ---- settlements --------------------------------------------------------
  S.carrierFinal = await insertSettlement({
    driver_user_id: U.freeDriver,
    source: 'carrier_issued',
    status: 'finalized',
    carrier_recruiter_profile_id: recruiterA,
    carrier_driver_relationship_id: relationshipA,
    source_display_name_snapshot: 'Carrier A',
    period_start: '2026-07-01',
    period_end: '2026-07-07',
    created_by_user_id: U.carrierOwner,
  });
  S.carrierDraft = await insertSettlement({
    driver_user_id: U.freeDriver,
    source: 'carrier_issued',
    status: 'draft',
    carrier_recruiter_profile_id: recruiterA,
    carrier_driver_relationship_id: relationshipA,
    source_display_name_snapshot: 'Carrier A',
    period_start: '2026-07-08',
    period_end: '2026-07-14',
    created_by_user_id: U.carrierOwner,
  });
  S.agencyFinal = await insertSettlement({
    driver_user_id: U.freeDriver,
    source: 'agency_prepared',
    status: 'finalized',
    agency_id: agencyA,
    source_display_name_snapshot: 'Agency A',
    period_start: '2026-07-01',
    period_end: '2026-07-07',
    created_by_user_id: U.agencyPreparer,
  });
  S.agencyDraft = await insertSettlement({
    driver_user_id: U.freeDriver,
    source: 'agency_prepared',
    status: 'draft',
    agency_id: agencyA,
    source_display_name_snapshot: 'Agency A',
    period_start: '2026-07-08',
    period_end: '2026-07-14',
    created_by_user_id: U.agencyPreparer,
  });
  S.importDraft = await insertSettlement({
    driver_user_id: U.freeDriver,
    source: 'driver_imported',
    status: 'draft',
    period_start: '2026-06-01',
    period_end: '2026-06-07',
    created_by_user_id: U.freeDriver,
  });
  // Hidden parent: belongs to a different driver entirely.
  S.hidden = await insertSettlement({
    driver_user_id: U.proDriver,
    source: 'driver_imported',
    status: 'draft',
    period_start: '2026-06-01',
    period_end: '2026-06-07',
    created_by_user_id: U.proDriver,
  });

  // ---- children -----------------------------------------------------------
  itemVisible = (
    await db.query<{ id: string }>(
      `INSERT INTO public.driver_settlement_items
         (settlement_id, item_type, amount, created_by_user_id)
       VALUES ($1,'load_pay',1000.00,$2) RETURNING id`,
      [S.carrierFinal, U.carrierOwner],
    )
  ).rows[0].id;
  itemHidden = (
    await db.query<{ id: string }>(
      `INSERT INTO public.driver_settlement_items
         (settlement_id, item_type, amount, created_by_user_id)
       VALUES ($1,'load_pay',2000.00,$2) RETURNING id`,
      [S.hidden, U.proDriver],
    )
  ).rows[0].id;

  loadFree = (
    await db.query<{ id: string }>(
      `INSERT INTO public.loads (user_id) VALUES ($1) RETURNING id`,
      [U.freeDriver],
    )
  ).rows[0].id;
  const loadFree2 = (
    await db.query<{ id: string }>(
      `INSERT INTO public.loads (user_id) VALUES ($1) RETURNING id`,
      [U.freeDriver],
    )
  ).rows[0].id;

  matchVisible = (
    await db.query<{ id: string }>(
      `INSERT INTO public.driver_settlement_matches
         (settlement_item_id, driver_load_id, match_state)
       VALUES ($1,$2,'likely') RETURNING id`,
      [itemVisible, loadFree],
    )
  ).rows[0].id;
  // Parent settlement is hidden from the Free driver, yet the matched load
  // belongs to that same Free driver.
  matchHidden = (
    await db.query<{ id: string }>(
      `INSERT INTO public.driver_settlement_matches
         (settlement_item_id, driver_load_id, match_state)
       VALUES ($1,$2,'likely') RETURNING id`,
      [itemHidden, loadFree2],
    )
  ).rows[0].id;

  eventVisible = (
    await db.query<{ id: string }>(
      `INSERT INTO public.driver_settlement_events (settlement_id, actor_user_id, event_type)
       VALUES ($1,$2,'finalized') RETURNING id`,
      [S.carrierFinal, U.carrierOwner],
    )
  ).rows[0].id;
  eventHidden = (
    await db.query<{ id: string }>(
      `INSERT INTO public.driver_settlement_events (settlement_id, actor_user_id, event_type)
       VALUES ($1,$2,'created') RETURNING id`,
      [S.hidden, U.proDriver],
    )
  ).rows[0].id;
});

// =====================================================================
describe('Phase 1T-B2B — candidate applies and adds exactly five SELECT policies', () => {
  it('applies real B1 + B2A + B2B in order (proof 1)', async () => {
    const r = await db.query<{ n: string }>(TABLES_SQL);
    for (const t of PHASE_1T_TABLES) {
      expect(r.rows.map((x) => x.n)).toContain(t);
    }
    const fns = await names(FUNCS_SQL);
    expect(fns).toContain('settlement_current_user_can_view_settlement');
  });

  it('adds exactly the five expected policies with exact names and tables (proof 2)', async () => {
    const after = await names(POLICIES_SQL);
    const added = after.filter((n) => !beforePolicies.includes(n)).sort();
    expect(added).toEqual(
      EXPECTED_POLICIES.map((p) => `${p.table}.${p.policy}`).sort(),
    );
    expect(beforePolicies.length).toBe(0);
  });

  it('all five policies are SELECT-only and scoped to authenticated (proof 3)', async () => {
    const rows = (
      await db.query<{
        tablename: string;
        policyname: string;
        cmd: string;
        roles: string;
        permissive: string;
        with_check: string | null;
      }>(
        `SELECT tablename, policyname, cmd, roles::text AS roles, permissive, with_check
         FROM pg_policies WHERE schemaname='public' ORDER BY tablename`,
      )
    ).rows;
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(row.cmd).toBe('SELECT');
      expect(row.roles).toBe('{authenticated}');
      expect(row.with_check).toBeNull();
    }
    const nonSelect = rows.filter((r) => r.cmd !== 'SELECT');
    expect(nonSelect).toEqual([]);
  });

  it('adds zero functions, tables, indexes, triggers, views, types (proof 4)', async () => {
    expect(afterTables).toEqual(beforeTables);
    expect(afterFunctions).toEqual(beforeFunctions);
    expect(afterIndexes).toEqual(beforeIndexes);
    expect(afterTriggers).toEqual(beforeTriggers);
    expect(afterViews).toEqual(beforeViews);
    expect(afterTypes).toEqual(beforeTypes);
  });
});

// =====================================================================
describe('Phase 1T-B2B — anonymous access', () => {
  it('anon sees zero rows from all five tables (proof 5)', async () => {
    await asRole('anon', null, async () => {
      for (const t of PHASE_1T_TABLES) {
        expect(await idsOrDenied(t)).toEqual([]);
      }
    });
  });
});

// =====================================================================
describe('Phase 1T-B2B — carrier_driver_relationships visibility', () => {
  it('recipient Free driver sees their own carrier relationship (proof 6)', async () => {
    await asRole('authenticated', U.freeDriver, async () => {
      expect(await idsOf('carrier_driver_relationships')).toEqual([relationshipA]);
    });
  });

  it('carrier owner sees own relationship without current billing; other carrier does not (proof 7)', async () => {
    await db.query(
      `UPDATE public.recruiter_billing_profiles SET status='canceled' WHERE recruiter_id=$1`,
      [recruiterA],
    );
    await asRole('authenticated', U.carrierOwner, async () => {
      expect(await idsOf('carrier_driver_relationships')).toEqual([relationshipA]);
    });
    await asRole('authenticated', U.otherCarrier, async () => {
      expect(await idsOf('carrier_driver_relationships')).toEqual([relationshipB]);
    });
    await db.query(
      `UPDATE public.recruiter_billing_profiles SET status='active' WHERE recruiter_id=$1`,
      [recruiterA],
    );
  });

  it('assistants and agency members gain no relationship visibility (proof 8)', async () => {
    for (const actor of [U.directAssistant, U.agencyPreparer, U.agencyGenAssistant]) {
      await asRole('authenticated', actor, async () => {
        expect(await idsOf('carrier_driver_relationships')).toEqual([]);
      });
    }
  });
});

// =====================================================================
describe('Phase 1T-B2B — driver_settlements visibility', () => {
  it('Free recipient driver sees finalized carrier settlement, not carrier draft (proof 9)', async () => {
    await asRole('authenticated', U.freeDriver, async () => {
      const ids = await idsOf('driver_settlements');
      expect(ids).toContain(S.carrierFinal);
      expect(ids).not.toContain(S.carrierDraft);
    });
  });

  it('Free recipient driver sees finalized agency settlement, not agency draft (proof 10)', async () => {
    await asRole('authenticated', U.freeDriver, async () => {
      const ids = await idsOf('driver_settlements');
      expect(ids).toContain(S.agencyFinal);
      expect(ids).not.toContain(S.agencyDraft);
    });
  });

  it('recipient sees own driver_imported draft without active Pro (proof 11)', async () => {
    const pro = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.subscriptions WHERE user_id=$1 AND status='active'`,
      [U.freeDriver],
    );
    expect(pro.rows[0].c).toBe(0);
    await asRole('authenticated', U.freeDriver, async () => {
      expect(await idsOf('driver_settlements')).toContain(S.importDraft);
    });
  });

  it('carrier owner sees own drafts and history; other carrier sees none of them (proof 12)', async () => {
    await asRole('authenticated', U.carrierOwner, async () => {
      const ids = await idsOf('driver_settlements');
      expect(ids).toContain(S.carrierDraft);
      expect(ids).toContain(S.carrierFinal);
      expect(ids).not.toContain(S.agencyDraft);
      expect(ids).not.toContain(S.importDraft);
    });
    await asRole('authenticated', U.otherCarrier, async () => {
      expect(await idsOf('driver_settlements')).toEqual([]);
    });
  });

  it('a stranger sees nothing anywhere (proof 20)', async () => {
    await asRole('authenticated', U.stranger, async () => {
      for (const t of PHASE_1T_TABLES) {
        expect(await idsOf(t)).toEqual([]);
      }
    });
  });
});

// =====================================================================
describe('Phase 1T-B2B — assistant and agency-delegated visibility', () => {
  it('direct assistant sees finalized business settlement, never a business draft (proof 14)', async () => {
    await asRole('authenticated', U.directAssistant, async () => {
      const ids = await idsOf('driver_settlements');
      expect(ids).toContain(S.carrierFinal);
      expect(ids).toContain(S.agencyFinal);
      expect(ids).not.toContain(S.carrierDraft);
      expect(ids).not.toContain(S.agencyDraft);
    });
  });

  it('agency-generated driver_assistants row alone grants no visibility (proof 15)', async () => {
    await asRole('authenticated', U.agencyGenAssistant, async () => {
      expect(await idsOf('driver_settlements')).toEqual([]);
      expect(await idsOf('driver_settlement_items')).toEqual([]);
      expect(await idsOf('driver_settlement_events')).toEqual([]);
      expect(await idsOf('driver_settlement_matches')).toEqual([]);
    });
  });

  it('same actor gains finalized visibility only after legitimate agency membership + approved delegation (proof 16)', async () => {
    await db.query(
      `INSERT INTO public.agency_members (agency_id, member_user_id, role, status)
       VALUES ($1,$2,'agency_member','active')`,
      [agencyB, U.agencyGenAssistant],
    );
    await db.query(
      `INSERT INTO public.agency_delegation_requests
         (agency_id, driver_user_id, member_user_id, status, requested_permissions)
       VALUES ($1,$2,$3,'approved','{"settlements_view":true}'::jsonb)`,
      [agencyB, U.freeDriver, U.agencyGenAssistant],
    );

    await asRole('authenticated', U.agencyGenAssistant, async () => {
      const ids = await idsOf('driver_settlements');
      expect(ids).toContain(S.carrierFinal);
      expect(ids).toContain(S.agencyFinal);
      // Not the same-agency preparer context, so business drafts stay hidden.
      expect(ids).not.toContain(S.carrierDraft);
      expect(ids).not.toContain(S.agencyDraft);
    });
  });

  it('legitimate agency preparer sees own agency draft/history, even after entitlement is cancelled (proof 13)', async () => {
    await asRole('authenticated', U.agencyPreparer, async () => {
      const ids = await idsOf('driver_settlements');
      expect(ids).toContain(S.agencyDraft);
      expect(ids).toContain(S.agencyFinal);
      expect(ids).not.toContain(S.carrierDraft);
    });

    await db.query(
      `UPDATE public.agency_entitlements SET status='cancelled' WHERE agency_id=$1`,
      [agencyA],
    );
    await asRole('authenticated', U.agencyPreparer, async () => {
      const ids = await idsOf('driver_settlements');
      expect(ids).toContain(S.agencyDraft);
      expect(ids).toContain(S.agencyFinal);
    });
    await db.query(
      `UPDATE public.agency_entitlements SET status='active' WHERE agency_id=$1`,
      [agencyA],
    );
  });
});

// =====================================================================
describe('Phase 1T-B2B — child row visibility derives from the parent settlement', () => {
  it('visible parent exposes items and events; hidden parent exposes neither (proof 17)', async () => {
    await asRole('authenticated', U.freeDriver, async () => {
      const items = await idsOf('driver_settlement_items');
      expect(items).toContain(itemVisible);
      expect(items).not.toContain(itemHidden);
      const events = await idsOf('driver_settlement_events');
      expect(events).toContain(eventVisible);
      expect(events).not.toContain(eventHidden);
    });
  });

  it('visible parent exposes its matches (proof 18)', async () => {
    await asRole('authenticated', U.freeDriver, async () => {
      expect(await idsOf('driver_settlement_matches')).toContain(matchVisible);
    });
  });

  it('owning the matched load does not expose a match under a hidden parent (proof 19)', async () => {
    const owner = await db.query<{ user_id: string }>(
      `SELECT l.user_id FROM public.driver_settlement_matches m
         JOIN public.loads l ON l.id = m.driver_load_id
        WHERE m.id = $1`,
      [matchHidden],
    );
    expect(owner.rows[0].user_id).toBe(U.freeDriver);
    await asRole('authenticated', U.freeDriver, async () => {
      expect(await idsOf('driver_settlement_matches')).not.toContain(matchHidden);
    });
  });
});

// =====================================================================
describe('Phase 1T-B2B — hard write boundary (zero write policies)', () => {
  it('direct INSERT as authenticated is blocked by RLS on all five tables (proof 21)', async () => {
    await asRole('authenticated', U.freeDriver, async () => {
      const attempts: Array<[string, string, unknown[]]> = [
        [
          'carrier_driver_relationships',
          `INSERT INTO public.carrier_driver_relationships
             (recruiter_id, driver_user_id, status, created_by_user_id)
           VALUES ($1,$2,'active',$2)`,
          [recruiterA, U.freeDriver],
        ],
        [
          'driver_settlements',
          `INSERT INTO public.driver_settlements
             (driver_user_id, source, status, period_start, period_end, created_by_user_id)
           VALUES ($1,'driver_imported','draft','2026-05-01','2026-05-07',$1)`,
          [U.freeDriver],
        ],
        [
          'driver_settlement_items',
          `INSERT INTO public.driver_settlement_items
             (settlement_id, item_type, amount, created_by_user_id)
           VALUES ($1,'earning',5.00,$2)`,
          [S.carrierFinal, U.freeDriver],
        ],
        [
          'driver_settlement_matches',
          `INSERT INTO public.driver_settlement_matches
             (settlement_item_id, driver_load_id, match_state)
           VALUES ($1,$2,'possible')`,
          [itemVisible, loadFree],
        ],
        [
          'driver_settlement_events',
          `INSERT INTO public.driver_settlement_events (settlement_id, event_type)
           VALUES ($1,'updated')`,
          [S.carrierFinal],
        ],
      ];
      for (const [table, sql, params] of attempts) {
        let message = '';
        try {
          await db.query(sql, params);
        } catch (e) {
          message = (e as Error).message;
        }
        expect(`${table}:${message}`).toMatch(/row-level security/i);
      }
    });
  });

  it('direct UPDATE of an otherwise-visible row changes nothing (proof 22)', async () => {
    const visible: Array<[string, string]> = [
      ['carrier_driver_relationships', relationshipA],
      ['driver_settlements', S.carrierFinal],
      ['driver_settlement_items', itemVisible],
      ['driver_settlement_matches', matchVisible],
      ['driver_settlement_events', eventVisible],
    ];
    for (const [table, id] of visible) {
      await asRole('authenticated', U.freeDriver, async () => {
        // Row must be visible first, or the denial would prove nothing.
        expect(await idsOf(table)).toContain(id);
        const r = await db.query(
          `UPDATE public.${table} SET created_at = now() WHERE id = $1`,
          [id],
        );
        expect(r.affectedRows ?? 0).toBe(0);
      });
      const still = await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM public.${table} WHERE id=$1`,
        [id],
      );
      expect(still.rows[0].c).toBe(1);
    }
  });

  it('direct DELETE of an otherwise-visible row removes nothing (proof 23)', async () => {
    const visible: Array<[string, string]> = [
      ['carrier_driver_relationships', relationshipA],
      ['driver_settlements', S.carrierFinal],
      ['driver_settlement_items', itemVisible],
      ['driver_settlement_matches', matchVisible],
      ['driver_settlement_events', eventVisible],
    ];
    for (const [table, id] of visible) {
      await asRole('authenticated', U.freeDriver, async () => {
        expect(await idsOf(table)).toContain(id);
        const r = await db.query(`DELETE FROM public.${table} WHERE id = $1`, [id]);
        expect(r.affectedRows ?? 0).toBe(0);
      });
      const still = await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM public.${table} WHERE id=$1`,
        [id],
      );
      expect(still.rows[0].c).toBe(1);
    }
  });
});

// =====================================================================
describe('Phase 1T-B2B — source contract', () => {
  it('candidate header, single transaction, exactly five CREATE POLICY (proof 24a)', () => {
    expect(B2B_SQL.split('\n')[0]).toBe('-- CANDIDATE MIGRATION — NOT APPLIED LIVE.');
    expect(B2B_SQL).toContain('Phase 1T-B2B');
    expect(B2B_CODE.match(/^BEGIN;$/gm)?.length).toBe(1);
    expect(B2B_CODE.match(/^COMMIT;$/gm)?.length).toBe(1);
    expect(B2B_CODE.match(/CREATE POLICY/g)?.length).toBe(5);
    expect(B2B_CODE.match(/FOR SELECT/g)?.length).toBe(5);
    expect(B2B_CODE.match(/TO authenticated/g)?.length).toBe(5);
    for (const p of EXPECTED_POLICIES) {
      expect(B2B_CODE).toContain(`CREATE POLICY ${p.policy}`);
      expect(B2B_CODE).toContain(`ON public.${p.table}`);
    }
  });

  it('candidate contains no prohibited statements (proof 24b)', () => {
    const forbidden: RegExp[] = [
      /USING\s*\(\s*true\s*\)/i,
      /WITH\s+CHECK/i,
      /IF\s+NOT\s+EXISTS/i,
      /DROP\s+POLICY/i,
      /FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i,
      /CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|TRIGGER|TABLE|INDEX|UNIQUE\s+INDEX|VIEW|TYPE|SCHEMA)\b/i,
      /ALTER\s+TABLE/i,
      /\bGRANT\b/i,
      /\bREVOKE\b/i,
      /INSERT\s+INTO/i,
      /^\s*UPDATE\s+public\./im,
      /DELETE\s+FROM/i,
      /\bemail\b/i,
      /current_setting\s*\(/i,
    ];
    for (const re of forbidden) {
      expect(`${re}:${re.test(B2B_CODE)}`).toBe(`${re}:false`);
    }
  });

  it('settlement/item/event policies use the accepted helper; match derives via settlement_item (proof 25)', () => {
    expect(
      B2B_CODE.match(/settlement_current_user_can_view_settlement/g)?.length,
    ).toBe(4);
    expect(B2B_CODE).toContain('settlement_current_user_can_view_settlement(driver_settlements.id)');
    expect(B2B_CODE).toContain('driver_settlement_items.settlement_id');
    expect(B2B_CODE).toContain('driver_settlement_events.settlement_id');
    expect(B2B_CODE).toContain('si.id = driver_settlement_matches.settlement_item_id');
    expect(B2B_CODE).toContain('settlement_current_user_can_view_settlement(si.settlement_id)');
    expect(B2B_CODE).not.toMatch(/driver_load_id/);
  });
});
