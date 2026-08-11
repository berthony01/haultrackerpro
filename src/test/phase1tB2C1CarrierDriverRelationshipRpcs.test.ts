// @vitest-environment node
// =====================================================================
// Phase 1T-B2C1 — Controlled carrier <-> driver relationship RPC proofs.
//
// Applies, in order, the REAL accepted Phase 1T-B1, B2A and B2B candidates
// and the REAL Phase 1T-B2C1 candidate inside PGlite on a minimal but
// faithful bootstrap, then proves catalog shape, ACLs, authorization,
// lifecycle/idempotence semantics, fixed error contracts, and that direct
// client writes stay blocked by the B2B read-only RLS contract.
//
// Table privileges for `authenticated` are granted ONLY inside this
// harness so RLS — never a missing GRANT — proves the write boundary.
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
} as const;

const read = (rel: string) =>
  fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const B1_SQL = read(REL.b1);
const B2A_SQL = read(REL.b2a);
const B2B_SQL = read(REL.b2b);
const B2C1_SQL = read(REL.b2c1);

/** Executable SQL only: `--` documentation lines removed. */
const B2C1_CODE = B2C1_SQL.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const B2C1_FUNCTIONS = [
  'settlement_accept_my_carrier_relationship',
  'settlement_decline_my_carrier_relationship',
  'settlement_end_carrier_relationship',
  'settlement_invite_carrier_driver',
] as const;

const ERR = {
  invalid: 'settlement_invalid_relationship_request',
  notAuthorizedCarrier: 'settlement_carrier_not_authorized',
  driverNotFound: 'settlement_driver_not_found',
  notFound: 'settlement_relationship_not_found',
  notAuthorized: 'settlement_relationship_not_authorized',
  invalidState: 'settlement_relationship_invalid_state',
  concurrentWrite: 'settlement_relationship_concurrent_write_failed',
} as const;

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

interface RelRow {
  id: string;
  recruiter_id: string;
  driver_user_id: string;
  status: string;
  created_by_user_id: string;
  invited_at: string;
  accepted_at: string | null;
  ended_at: string | null;
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
let recruiterPaid = '';
let recruiterUnpaid = '';
let recruiterAgencyIncluded = '';
let recruiterDualPaid = '';
let agencyPaid = '';

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

async function callRpc(sql: string, params: unknown[]): Promise<RelRow> {
  const r = await db.query<RelRow>(sql, params);
  return r.rows[0];
}

const invite = (rid: string | null, drv: string | null) =>
  callRpc(
    `SELECT * FROM public.settlement_invite_carrier_driver($1::uuid, $2::uuid)`,
    [rid, drv],
  );
const accept = (id: string | null) =>
  callRpc(
    `SELECT * FROM public.settlement_accept_my_carrier_relationship($1::uuid)`,
    [id],
  );
const decline = (id: string | null) =>
  callRpc(
    `SELECT * FROM public.settlement_decline_my_carrier_relationship($1::uuid)`,
    [id],
  );
const endRel = (id: string | null) =>
  callRpc(`SELECT * FROM public.settlement_end_carrier_relationship($1::uuid)`, [id]);

/** Capture the raised message for a call expected to fail. */
async function failureMessage(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as Error).message;
  }
  return '<<no error raised>>';
}

async function relById(id: string): Promise<RelRow | undefined> {
  const r = await db.query<RelRow>(
    `SELECT * FROM public.carrier_driver_relationships WHERE id=$1`,
    [id],
  );
  return r.rows[0];
}

async function relCount(rid: string, drv: string): Promise<number> {
  const r = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM public.carrier_driver_relationships
      WHERE recruiter_id=$1 AND driver_user_id=$2`,
    [rid, drv],
  );
  return r.rows[0].c;
}

/** A fresh driver, guaranteeing test isolation for lifecycle proofs. */
async function freshDriver(): Promise<string> {
  return newUser();
}

beforeAll(async () => {
  db = new PGlite() as unknown as AnyPGlite;

  await db.exec(BOOTSTRAP);
  await db.exec(B1_SQL);
  await db.exec(HARNESS_GRANTS);
  await db.exec(B2A_SQL);
  await db.exec(B2B_SQL);

  beforeTables = await names(TABLES_SQL);
  beforeFunctions = await names(FUNCS_SQL);
  beforeIndexes = await names(IDX_SQL);
  beforeTriggers = await names(TRIGS_SQL);
  beforeViews = await names(VIEWS_SQL);
  beforeTypes = await names(TYPES_SQL);
  beforePolicies = await names(POLICIES_SQL);

  await db.exec(B2C1_SQL);

  afterTables = await names(TABLES_SQL);
  afterFunctions = await names(FUNCS_SQL);
  afterIndexes = await names(IDX_SQL);
  afterTriggers = await names(TRIGS_SQL);
  afterViews = await names(VIEWS_SQL);
  afterTypes = await names(TYPES_SQL);
  afterPolicies = await names(POLICIES_SQL);

  for (const k of [
    'paidCarrier',
    'unpaidCarrier',
    'agencyIncludedCarrier',
    'dualPaidCarrier',
    'driver',
    'stranger',
    'assistant',
    'agencyOwner',
    'agencyMember',
  ]) {
    U[k] = await newUser();
  }

  const mkRecruiter = async (owner: string) =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO public.recruiter_profiles (user_id) VALUES ($1) RETURNING id`,
        [owner],
      )
    ).rows[0].id;

  recruiterPaid = await mkRecruiter(U.paidCarrier);
  recruiterUnpaid = await mkRecruiter(U.unpaidCarrier);
  recruiterAgencyIncluded = await mkRecruiter(U.agencyIncludedCarrier);
  recruiterDualPaid = await mkRecruiter(U.dualPaidCarrier);

  // Standalone paid carrier.
  await db.query(
    `INSERT INTO public.recruiter_billing_profiles (recruiter_id, user_id, plan, status)
     VALUES ($1,$2,'growth','active')`,
    [recruiterPaid, U.paidCarrier],
  );
  // Dual-paid conflict carrier: standalone paid recruiter AND paid agency owner.
  await db.query(
    `INSERT INTO public.recruiter_billing_profiles (recruiter_id, user_id, plan, status)
     VALUES ($1,$2,'starter','active')`,
    [recruiterDualPaid, U.dualPaidCarrier],
  );
  const conflictAgency = (
    await db.query<{ id: string }>(
      `INSERT INTO public.agency_profiles (owner_user_id, status) VALUES ($1,'active') RETURNING id`,
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
  // "Agency-included" recruiter premium: no standalone recruiter billing row.
  agencyPaid = (
    await db.query<{ id: string }>(
      `INSERT INTO public.agency_profiles (owner_user_id, status) VALUES ($1,'active') RETURNING id`,
      [U.agencyOwner],
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO public.agency_members (agency_id, member_user_id, role, status)
     VALUES ($1,$2,'agency_owner','active'), ($1,$3,'agency_member','active')`,
    [agencyPaid, U.agencyOwner, U.agencyMember],
  );
  await db.query(
    `INSERT INTO public.agency_entitlements (agency_id, plan_key, status)
     VALUES ($1,'agency_team','active')`,
    [agencyPaid],
  );
  await db.query(
    `INSERT INTO public.driver_assistants
       (driver_user_id, assistant_user_id, status, permissions, agency_delegation_id)
     VALUES ($1,$2,'active','{"settlements_view":true,"settlements_manage":true}'::jsonb, NULL)`,
    [U.driver, U.assistant],
  );
});

// =====================================================================
describe('Phase 1T-B2C1 — catalog and ACL contract', () => {
  it('all four real candidates apply in order (proof 1)', async () => {
    expect(afterTables).toContain('carrier_driver_relationships');
    for (const fn of B2C1_FUNCTIONS) {
      expect(afterFunctions).toContain(fn);
    }
  });

  it('adds exactly four functions and nothing else (proof 2)', async () => {
    const added = afterFunctions.filter((n) => !beforeFunctions.includes(n)).sort();
    expect(added).toEqual([...B2C1_FUNCTIONS].sort());
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
        [[...B2C1_FUNCTIONS]],
      )
    ).rows;

    expect(rows.map((r) => r.proname)).toEqual([...B2C1_FUNCTIONS].sort());
    for (const r of rows) {
      expect(`${r.proname}:${r.lang}`).toBe(`${r.proname}:plpgsql`);
      expect(`${r.proname}:${r.prosecdef}`).toBe(`${r.proname}:true`);
      // Mutating functions must be VOLATILE, never immutable/stable.
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
      // No bare "=X/" PUBLIC grant.
      expect(`${r.proname}:${/(^|,)=X\//.test(acl)}`).toBe(`${r.proname}:false`);
    }
  });

  it('anon cannot execute any of the four RPCs (proof 3b)', async () => {
    await asRole('anon', null, async () => {
      for (const call of [
        () => invite(recruiterPaid, U.driver),
        () => accept(null),
        () => decline(null),
        () => endRel(null),
      ]) {
        const msg = await failureMessage(call);
        expect(msg).toMatch(/permission denied/i);
      }
    });
  });
});

// =====================================================================
describe('Phase 1T-B2C1 — invite authorization', () => {
  it('null actor cannot mutate through any RPC (proof 4)', async () => {
    await asRole('authenticated', null, async () => {
      expect(await failureMessage(() => invite(recruiterPaid, U.driver))).toContain(
        ERR.invalid,
      );
      expect(await failureMessage(() => accept(U.driver))).toContain(ERR.invalid);
      expect(await failureMessage(() => decline(U.driver))).toContain(ERR.invalid);
      expect(await failureMessage(() => endRel(U.driver))).toContain(ERR.invalid);
    });
    expect(await relCount(recruiterPaid, U.driver)).toBe(0);
  });

  it('recruiter owner with no paid billing cannot invite (proof 5)', async () => {
    await asRole('authenticated', U.unpaidCarrier, async () => {
      expect(
        await failureMessage(() => invite(recruiterUnpaid, U.driver)),
      ).toContain(ERR.notAuthorizedCarrier);
    });
    expect(await relCount(recruiterUnpaid, U.driver)).toBe(0);
  });

  it('agency-included recruiter context without standalone paid billing cannot invite (proof 6)', async () => {
    const billing = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.recruiter_billing_profiles WHERE recruiter_id=$1`,
      [recruiterAgencyIncluded],
    );
    expect(billing.rows[0].c).toBe(0);
    await asRole('authenticated', U.agencyIncludedCarrier, async () => {
      expect(
        await failureMessage(() => invite(recruiterAgencyIncluded, U.driver)),
      ).toContain(ERR.notAuthorizedCarrier);
    });
    expect(await relCount(recruiterAgencyIncluded, U.driver)).toBe(0);
  });

  it('dual paid recruiter + paid agency owner conflict cannot invite (proof 7)', async () => {
    await asRole('authenticated', U.dualPaidCarrier, async () => {
      expect(
        await failureMessage(() => invite(recruiterDualPaid, U.driver)),
      ).toContain(ERR.notAuthorizedCarrier);
    });
    expect(await relCount(recruiterDualPaid, U.driver)).toBe(0);
  });

  it('stranger and a different recruiter owner cannot invite for another profile (proof 9)', async () => {
    for (const actor of [U.stranger, U.unpaidCarrier, U.agencyOwner]) {
      await asRole('authenticated', actor, async () => {
        expect(
          await failureMessage(() => invite(recruiterPaid, U.driver)),
        ).toContain(ERR.notAuthorizedCarrier);
      });
    }
    expect(await relCount(recruiterPaid, U.driver)).toBe(0);
  });

  it('nonexistent driver id fails with settlement_driver_not_found and creates nothing (proof 10)', async () => {
    const ghost = '99999999-8888-7777-6666-555555555555';
    await asRole('authenticated', U.paidCarrier, async () => {
      expect(await failureMessage(() => invite(recruiterPaid, ghost))).toContain(
        ERR.driverNotFound,
      );
    });
    expect(await relCount(recruiterPaid, ghost)).toBe(0);
  });

  it('paid standalone starter/growth/fleet, active or trialing, can invite (proof 8)', async () => { // trial-allowlist
    for (const [plan, status] of [
      ['starter', 'active'],
      ['growth', 'trialing'], // trial-allowlist: Stripe status literal, fixture
      ['fleet', 'active'],
    ]) {
      await db.query(
        `UPDATE public.recruiter_billing_profiles SET plan=$1, status=$2 WHERE recruiter_id=$3`,
        [plan, status, recruiterPaid],
      );
      const drv = await freshDriver();
      const row = await asRole('authenticated', U.paidCarrier, () =>
        invite(recruiterPaid, drv),
      );
      expect(`${plan}/${status}:${row.status}`).toBe(`${plan}/${status}:invited`);
    }
    await db.query(
      `UPDATE public.recruiter_billing_profiles SET plan='growth', status='active' WHERE recruiter_id=$1`,
      [recruiterPaid],
    );
  });
});

// =====================================================================
describe('Phase 1T-B2C1 — invite lifecycle shape', () => {
  it('first invite creates exactly one invited row with correct provenance (proof 11, 13)', async () => {
    const drv = await freshDriver();
    const row = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    expect(row.recruiter_id).toBe(recruiterPaid);
    expect(row.driver_user_id).toBe(drv);
    expect(row.created_by_user_id).toBe(U.paidCarrier);
    expect(row.status).toBe('invited');
    expect(row.accepted_at).toBeNull();
    expect(row.ended_at).toBeNull();
    expect(await relCount(recruiterPaid, drv)).toBe(1);
  });

  it('repeated invite while invited is idempotent, no duplicate row (proof 12)', async () => {
    const drv = await freshDriver();
    const first = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    const second = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('invited');
    expect(second.accepted_at).toBeNull();
    expect(await relCount(recruiterPaid, drv)).toBe(1);
  });
});

// =====================================================================
describe('Phase 1T-B2C1 — accept / decline', () => {
  it('only the exact recipient driver can accept (proof 14)', async () => {
    const drv = await freshDriver();
    const row = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    for (const actor of [U.stranger, U.paidCarrier, U.assistant, U.agencyOwner]) {
      await asRole('authenticated', actor, async () => {
        expect(await failureMessage(() => accept(row.id))).toContain(
          ERR.notAuthorized,
        );
      });
    }
    expect((await relById(row.id))!.status).toBe('invited');
  });

  it('driver accept moves invited -> active and stamps accepted_at once (proof 15, 16)', async () => {
    const drv = await freshDriver();
    const invited = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    const active = await asRole('authenticated', drv, () => accept(invited.id));
    expect(active.id).toBe(invited.id);
    expect(active.status).toBe('active');
    expect(active.accepted_at).not.toBeNull();
    expect(active.ended_at).toBeNull();

    const again = await asRole('authenticated', drv, () => accept(invited.id));
    expect(again.status).toBe('active');
    expect(again.accepted_at).toStrictEqual(active.accepted_at);
    expect(await relCount(recruiterPaid, drv)).toBe(1);
  });

  it('driver decline moves invited -> inactive and preserves ended_at on repeat (proof 17, 18)', async () => {
    const drv = await freshDriver();
    const invited = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    const declined = await asRole('authenticated', drv, () => decline(invited.id));
    expect(declined.status).toBe('inactive');
    expect(declined.accepted_at).toBeNull();
    expect(declined.ended_at).not.toBeNull();

    const again = await asRole('authenticated', drv, () => decline(invited.id));
    expect(again.status).toBe('inactive');
    expect(again.ended_at).toStrictEqual(declined.ended_at);
  });

  it('decline of an active or ended relationship fails invalid state (proof 19)', async () => {
    const drv = await freshDriver();
    const invited = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    await asRole('authenticated', drv, () => accept(invited.id));
    await asRole('authenticated', drv, async () => {
      expect(await failureMessage(() => decline(invited.id))).toContain(
        ERR.invalidState,
      );
    });
    await asRole('authenticated', drv, () => endRel(invited.id));
    await asRole('authenticated', drv, async () => {
      expect(await failureMessage(() => decline(invited.id))).toContain(
        ERR.invalidState,
      );
    });
    expect((await relById(invited.id))!.status).toBe('ended');
  });
});

// =====================================================================
describe('Phase 1T-B2C1 — re-invite semantics', () => {
  it('inactive/ended row is re-invited in place preserving provenance (proof 20, 29)', async () => {
    const drv = await freshDriver();
    const original = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    await asRole('authenticated', drv, () => accept(original.id));
    await asRole('authenticated', drv, () => endRel(original.id));

    const reinvited = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    expect(reinvited.id).toBe(original.id);
    expect(reinvited.status).toBe('invited');
    expect(reinvited.accepted_at).toBeNull();
    expect(reinvited.ended_at).toBeNull();
    expect(reinvited.created_by_user_id).toBe(original.created_by_user_id);
    expect(reinvited.created_at).toStrictEqual(original.created_at);
    // UNIQUE pair holds one row across invite -> accept -> end -> re-invite.
    expect(await relCount(recruiterPaid, drv)).toBe(1);
  });

  it('re-invite of an active relationship never resets acceptance (proof 21)', async () => {
    const drv = await freshDriver();
    const invited = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    const active = await asRole('authenticated', drv, () => accept(invited.id));
    const again = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    expect(again.id).toBe(active.id);
    expect(again.status).toBe('active');
    expect(again.accepted_at).toStrictEqual(active.accepted_at);
    expect(await relCount(recruiterPaid, drv)).toBe(1);
  });
});

// =====================================================================
describe('Phase 1T-B2C1 — ending a relationship', () => {
  it('driver can end their own invited / active / inactive relationship (proof 22)', async () => {
    for (const path of ['invited', 'active', 'inactive'] as const) {
      const drv = await freshDriver();
      const row = await asRole('authenticated', U.paidCarrier, () =>
        invite(recruiterPaid, drv),
      );
      if (path === 'active') await asRole('authenticated', drv, () => accept(row.id));
      if (path === 'inactive')
        await asRole('authenticated', drv, () => decline(row.id));
      const ended = await asRole('authenticated', drv, () => endRel(row.id));
      expect(`${path}:${ended.status}`).toBe(`${path}:ended`);
      expect(ended.ended_at).not.toBeNull();
    }
  });

  it('recruiter owner can end after billing is cancelled/past_due/missing (proof 23)', async () => {
    for (const billing of ['canceled', 'past_due', null]) {
      const drv = await freshDriver();
      const row = await asRole('authenticated', U.paidCarrier, () =>
        invite(recruiterPaid, drv),
      );
      await asRole('authenticated', drv, () => accept(row.id));

      if (billing === null) {
        await db.query(
          `DELETE FROM public.recruiter_billing_profiles WHERE recruiter_id=$1`,
          [recruiterPaid],
        );
      } else {
        await db.query(
          `UPDATE public.recruiter_billing_profiles SET status=$1 WHERE recruiter_id=$2`,
          [billing, recruiterPaid],
        );
      }

      const ended = await asRole('authenticated', U.paidCarrier, () =>
        endRel(row.id),
      );
      expect(`${billing}:${ended.status}`).toBe(`${billing}:ended`);

      if (billing === null) {
        await db.query(
          `INSERT INTO public.recruiter_billing_profiles (recruiter_id, user_id, plan, status)
           VALUES ($1,$2,'growth','active')`,
          [recruiterPaid, U.paidCarrier],
        );
      } else {
        await db.query(
          `UPDATE public.recruiter_billing_profiles SET status='active' WHERE recruiter_id=$1`,
          [recruiterPaid],
        );
      }
    }
  });

  it('unrelated recruiter, assistant, agency owner/member cannot end (proof 24)', async () => {
    const drv = await freshDriver();
    const row = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    for (const actor of [
      U.unpaidCarrier,
      U.stranger,
      U.assistant,
      U.agencyOwner,
      U.agencyMember,
    ]) {
      await asRole('authenticated', actor, async () => {
        expect(await failureMessage(() => endRel(row.id))).toContain(
          ERR.notAuthorized,
        );
      });
    }
    expect((await relById(row.id))!.status).toBe('invited');
  });

  it('end preserves the row and repeated end preserves ended_at (proof 25)', async () => {
    const drv = await freshDriver();
    const row = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    const ended = await asRole('authenticated', U.paidCarrier, () => endRel(row.id));
    const again = await asRole('authenticated', U.paidCarrier, () => endRel(row.id));
    expect(again.status).toBe('ended');
    expect(again.ended_at).toStrictEqual(ended.ended_at);
    expect(again.id).toBe(row.id);
    expect(again.recruiter_id).toBe(recruiterPaid);
    expect(again.driver_user_id).toBe(drv);
    expect(again.created_by_user_id).toBe(U.paidCarrier);
    expect(again.created_at).toStrictEqual(row.created_at);
    expect(await relById(row.id)).toBeDefined();
  });

  it('ending does not delete a finalized settlement snapshotting the relationship id (proof 26)', async () => {
    const drv = await freshDriver();
    const row = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    await asRole('authenticated', drv, () => accept(row.id));

    const settlement = (
      await db.query<{ id: string }>(
        `INSERT INTO public.driver_settlements
           (driver_user_id, source, status, carrier_recruiter_profile_id,
            carrier_driver_relationship_id, source_display_name_snapshot,
            period_start, period_end, created_by_user_id)
         VALUES ($1,'carrier_issued','finalized',$2,$3,'Carrier','2026-07-01','2026-07-07',$4)
         RETURNING id`,
        [drv, recruiterPaid, row.id, U.paidCarrier],
      )
    ).rows[0].id;

    await asRole('authenticated', U.paidCarrier, () => endRel(row.id));

    const still = await db.query<{ carrier_driver_relationship_id: string }>(
      `SELECT carrier_driver_relationship_id FROM public.driver_settlements WHERE id=$1`,
      [settlement],
    );
    expect(still.rows.length).toBe(1);
    expect(still.rows[0].carrier_driver_relationship_id).toBe(row.id);
    expect(await relById(row.id)).toBeDefined();
  });
});

// =====================================================================
describe('Phase 1T-B2C1 — RLS write boundary and fail-closed inputs', () => {
  it('direct INSERT/UPDATE/DELETE stays blocked while RPCs work (proof 27)', async () => {
    const drv = await freshDriver();
    const row = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );

    await asRole('authenticated', drv, async () => {
      // The row is genuinely visible to this actor under B2B read RLS.
      const visible = await db.query<{ id: string }>(
        `SELECT id FROM public.carrier_driver_relationships WHERE id=$1`,
        [row.id],
      );
      expect(visible.rows.length).toBe(1);

      const insertMsg = await failureMessage(() =>
        db.query(
          `INSERT INTO public.carrier_driver_relationships
             (recruiter_id, driver_user_id, status, created_by_user_id)
           VALUES ($1,$2,'active',$2)`,
          [recruiterUnpaid, drv],
        ),
      );
      expect(insertMsg).toMatch(/row-level security/i);

      const upd = await db.query(
        `UPDATE public.carrier_driver_relationships SET status='active' WHERE id=$1`,
        [row.id],
      );
      expect(upd.affectedRows ?? 0).toBe(0);

      const del = await db.query(
        `DELETE FROM public.carrier_driver_relationships WHERE id=$1`,
        [row.id],
      );
      expect(del.affectedRows ?? 0).toBe(0);
    });

    const after = await relById(row.id);
    expect(after!.status).toBe('invited');
  });

  it('malformed inputs and unknown ids fail closed with fixed messages only (proof 28)', async () => {
    const ghostRel = '00000000-0000-4000-8000-000000000000';
    await asRole('authenticated', U.paidCarrier, async () => {
      const msgs = [
        await failureMessage(() => invite(null, U.driver)),
        await failureMessage(() => invite(recruiterPaid, null)),
        await failureMessage(() => accept(null)),
        await failureMessage(() => decline(null)),
        await failureMessage(() => endRel(null)),
        await failureMessage(() => accept(ghostRel)),
        await failureMessage(() => decline(ghostRel)),
        await failureMessage(() => endRel(ghostRel)),
      ];
      const allowed = Object.values(ERR) as string[];
      for (const m of msgs) {
        expect(allowed).toContain(m);
        expect(m).not.toMatch(
          /relation "|\bcolumn\b|syntax error|violates|constraint "|pg_catalog|SQLSTATE/i,
        );
      }
      expect(msgs.slice(0, 5).every((m) => m === ERR.invalid)).toBe(true);
      expect(msgs.slice(5).every((m) => m === ERR.notFound)).toBe(true);
    });
  });

  it('an unknown stored status fails closed on every RPC (proof 28b)', async () => {
    const drv = await freshDriver();
    const row = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    // Harness-only: force a malformed runtime status the CHECK normally prevents.
    await db.exec(
      `ALTER TABLE public.carrier_driver_relationships
         DROP CONSTRAINT carrier_driver_relationships_status_check;`,
    );
    await db.query(
      `UPDATE public.carrier_driver_relationships SET status='bogus_status' WHERE id=$1`,
      [row.id],
    );

    await asRole('authenticated', U.paidCarrier, async () => {
      expect(await failureMessage(() => invite(recruiterPaid, drv))).toContain(
        ERR.invalidState,
      );
    });
    await asRole('authenticated', drv, async () => {
      expect(await failureMessage(() => accept(row.id))).toContain(ERR.invalidState);
      expect(await failureMessage(() => decline(row.id))).toContain(ERR.invalidState);
      expect(await failureMessage(() => endRel(row.id))).toContain(ERR.invalidState);
    });

    await db.query(`DELETE FROM public.carrier_driver_relationships WHERE id=$1`, [
      row.id,
    ]);
    await db.exec(
      `ALTER TABLE public.carrier_driver_relationships
         ADD CONSTRAINT carrier_driver_relationships_status_check
         CHECK (status IN ('invited', 'active', 'inactive', 'ended'));`,
    );
  });
});

// =====================================================================
describe('Phase 1T-B2C1 — source contract', () => {
  it('header, single transaction, exactly four CREATE FUNCTION with exact signatures (proof 30a)', () => {
    expect(B2C1_SQL.split('\n')[0]).toBe('-- CANDIDATE MIGRATION — NOT APPLIED LIVE.');
    expect(B2C1_SQL).toContain('Phase 1T-B2C1');
    expect(B2C1_CODE.match(/^BEGIN;$/gm)?.length).toBe(1);
    expect(B2C1_CODE.match(/^COMMIT;$/gm)?.length).toBe(1);
    expect(B2C1_CODE.match(/CREATE FUNCTION/g)?.length).toBe(4);
    for (const fn of B2C1_FUNCTIONS) {
      expect(B2C1_CODE).toContain(`CREATE FUNCTION public.${fn}(`);
    }
    expect(B2C1_CODE.match(/LANGUAGE plpgsql/g)?.length).toBe(4);
    expect(B2C1_CODE.match(/SECURITY DEFINER/g)?.length).toBe(4);
    expect(
      B2C1_CODE.match(/SET search_path = pg_catalog, public, auth/g)?.length,
    ).toBe(4);
    expect(
      B2C1_CODE.match(/RETURNS public\.carrier_driver_relationships/g)?.length,
    ).toBe(4);
    // Four canonical transition locks + the invite conflict-loser re-read.
    expect(B2C1_CODE.match(/FOR UPDATE/g)?.length).toBe(5);
  });

  it('no prohibited statements or bypass branches (proof 30b)', () => {
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
    ];
    for (const re of forbidden) {
      expect(`${re}:${re.test(B2C1_CODE)}`).toBe(`${re}:false`);
    }
    // GRANT/REVOKE appear only as function EXECUTE ACL statements.
    expect(B2C1_CODE.match(/^GRANT /gm)?.length).toBe(4);
    expect(B2C1_CODE.match(/^GRANT EXECUTE ON FUNCTION /gm)?.length).toBe(4);
    expect(B2C1_CODE.match(/^REVOKE /gm)?.length).toBe(4);
    expect(B2C1_CODE.match(/^REVOKE ALL ON FUNCTION /gm)?.length).toBe(4);
    expect(B2C1_CODE.match(/FROM PUBLIC, anon;/g)?.length).toBe(4);
    expect(B2C1_CODE.match(/TO authenticated, service_role;/g)?.length).toBe(4);
  });

  it('invite gates on the accepted helper; accept/decline/end derive actor correctly (proof 31)', () => {
    expect(
      B2C1_CODE.match(/settlement_current_user_can_administer_carrier\(_recruiter_id\)/g)
        ?.length,
    ).toBe(1);
    expect(B2C1_CODE.match(/v_actor uuid := auth\.uid\(\);/g)?.length).toBe(4);
    // Accept and decline authorize strictly on the recipient driver.
    expect(
      B2C1_CODE.match(/v_row\.driver_user_id <> v_actor/g)?.length,
    ).toBe(2);
    // End authorizes driver OR canonical recruiter-profile owner, with no
    // billing gate anywhere in that function.
    const endBody = B2C1_CODE.slice(
      B2C1_CODE.indexOf('CREATE FUNCTION public.settlement_end_carrier_relationship('),
    );
    expect(endBody).toContain('v_row.driver_user_id = v_actor');
    expect(endBody).toContain('FROM public.recruiter_profiles rp');
    expect(endBody).toContain('rp.id = v_row.recruiter_id');
    expect(endBody).toContain('rp.user_id = v_actor');
    expect(endBody).not.toMatch(/recruiter_billing_profiles/i);
    expect(endBody).not.toMatch(/agency_/i);
    expect(endBody).not.toMatch(/driver_assistants/i);
    // Invite never activates.
    const inviteBody = B2C1_CODE.slice(
      B2C1_CODE.indexOf('CREATE FUNCTION public.settlement_invite_carrier_driver('),
      B2C1_CODE.indexOf(
        'CREATE FUNCTION public.settlement_accept_my_carrier_relationship(',
      ),
    );
    expect(inviteBody).not.toMatch(/SET\s+status = 'active'/);
  });

  it('invite inserts atomically on the canonical unique pair with a fixed concurrency error (proof 32)', () => {
    const inviteBody = B2C1_CODE.slice(
      B2C1_CODE.indexOf('CREATE FUNCTION public.settlement_invite_carrier_driver('),
      B2C1_CODE.indexOf(
        'CREATE FUNCTION public.settlement_accept_my_carrier_relationship(',
      ),
    );

    // The only INSERT into the relationship table is conflict-safe.
    const inserts =
      B2C1_CODE.match(/INSERT INTO public\.carrier_driver_relationships/g)?.length ?? 0;
    expect(inserts).toBe(1);
    expect(inviteBody).toContain(
      'ON CONFLICT (recruiter_id, driver_user_id) DO NOTHING',
    );
    expect(
      inviteBody.match(/ON CONFLICT \(recruiter_id, driver_user_id\) DO NOTHING/g)
        ?.length,
    ).toBe(1);

    // Conflict loser re-reads the exact canonical pair under a row lock.
    expect(inviteBody.match(/FOR UPDATE/g)?.length).toBe(2);
    expect(
      inviteBody.match(
        /WHERE r\.recruiter_id = _recruiter_id\s*\n\s*AND r\.driver_user_id = _driver_user_id\s*\n\s*FOR UPDATE;/g,
      )?.length,
    ).toBe(2);

    // Fixed machine-readable fallback, never raw database internals.
    expect(inviteBody).toContain(
      "RAISE EXCEPTION 'settlement_relationship_concurrent_write_failed'",
    );
    expect(inviteBody).not.toMatch(/unique_violation|SQLSTATE|sqlerrm|sqlstate/i);
    expect(inviteBody).not.toMatch(/carrier_driver_relationships_[a-z_]*_key/i);
    // No dynamic SQL, retry loop, or advisory lock was introduced.
    expect(inviteBody).not.toMatch(/\bLOOP\b|advisory_(xact_)?lock|\bEXECUTE\b/i);

    // The raced row falls through to the shared canonical status handling.
    expect(inviteBody.match(/v_row\.status = 'invited' OR v_row\.status = 'active'/g)
      ?.length).toBe(1);
    expect(inviteBody.match(/v_row\.status = 'inactive' OR v_row\.status = 'ended'/g)
      ?.length).toBe(1);
    expect(inviteBody).toContain("RAISE EXCEPTION 'settlement_relationship_invalid_state'");
  });
});

// =====================================================================
describe('Phase 1T-B2C1 — existing-pair re-read is idempotent', () => {
  it('an already-created exact-pair row is re-read and returned unchanged (proof 33)', async () => {
    const drv = await freshDriver();
    const first = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );
    const second = await asRole('authenticated', U.paidCarrier, () =>
      invite(recruiterPaid, drv),
    );

    expect(second.id).toBe(first.id);
    expect(second.status).toBe('invited');
    expect(second.accepted_at).toBeNull();
    expect(second.created_by_user_id).toBe(first.created_by_user_id);

    const count = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.carrier_driver_relationships
        WHERE recruiter_id = $1 AND driver_user_id = $2`,
      [recruiterPaid, drv],
    );
    expect(Number(count.rows[0].n)).toBe(1);
  });
});

