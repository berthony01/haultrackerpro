/**
 * Phase TG-2E3-O13 — Real PostgreSQL gate for the deterministic Owner QA
 * fixture reset candidate.
 *
 * Applies the accepted O2 (Owner QA session) and O6 (QA fixture root registry)
 * candidates first, then the O13 candidate, against a production-faithful
 * minimal scaffold that reproduces the live FK graph and the recompute /
 * notification trigger behaviour that O13 must account for.
 *
 * Lives OUTSIDE `src/` so the default `bunx vitest run` never picks it up.
 * NEVER SKIPS. Fails hard if TG2E3O13_DATABASE_URL is absent.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.TG2E3O13_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'TG2E3O13_DATABASE_URL is required for the Phase TG-2E3-O13 real-Postgres gate.',
  );
}
const URL_STR: string = DATABASE_URL;

function candidate(file: string): string {
  return readFileSync(
    fileURLToPath(
      new URL(`../../supabase/migration-candidates/${file}`, import.meta.url),
    ),
    'utf8',
  );
}

const O2_SQL = candidate('20260820200000_phase_tg2e3_o2_owner_qa_entitlement.sql');
const O6_SQL = candidate('20260821050000_phase_tg2e3_o6_qa_fixture_root_registry.sql');
const O13_SQL = candidate(
  '20260822210000_phase_tg2e3_o13_owner_qa_fixture_reset.sql',
);

const SCAFFOLD = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL
);

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users a
    WHERE a.user_id = _user_id AND a.role = 'super_admin'
  )
$$;

CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid,
  action text NOT NULL,
  target_user_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL,
  plan_key text NOT NULL
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public.user_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capability text NOT NULL
);

CREATE TABLE public.cost_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
);

CREATE TABLE public.driver_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  points integer NOT NULL DEFAULT 0
);

CREATE TABLE public.driver_point_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  points integer NOT NULL DEFAULT 0
);

CREATE TABLE public.suppressed_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL
);

CREATE TABLE public.telegram_user_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
);

CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
);

CREATE TABLE public.recruiter_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id),
  member_user_id uuid NOT NULL
);

CREATE TABLE public.recruiter_billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL,
  plan text,
  status text
);

CREATE TABLE public.agency_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL
);

CREATE TABLE public.agency_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id),
  member_user_id uuid NOT NULL,
  role text NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.agency_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  plan_key text NOT NULL,
  status text NOT NULL,
  source text NOT NULL,
  member_limit integer,
  active_client_limit integer,
  service_package_limit integer
);

CREATE OR REPLACE FUNCTION public._agency_plan_defaults(_plan_key text)
RETURNS TABLE(member_limit integer, active_client_limit integer, service_package_limit integer)
LANGUAGE sql IMMUTABLE AS $$
  SELECT t.m, t.c, t.s FROM (VALUES
    ('agency_starter', 2, 5, 3),
    ('agency_team',    5, 25, 10),
    ('agency_growth', 15, 100, 30)
  ) AS t(k, m, c, s)
  WHERE t.k = _plan_key
$$;

DO $$ BEGIN CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;

DO $$ BEGIN
  CREATE TYPE public.recruiter_workspace_permission AS ENUM (
    'opportunities_create','opportunities_edit','opportunities_change_status'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id),
  status text NOT NULL DEFAULT 'draft'
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunities TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_opportunity_action(
  _recruiter_id uuid, _permission public.recruiter_workspace_permission
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(NULLIF(current_setting('test.perm_allow', true), '')::boolean, false)
$$;

CREATE OR REPLACE FUNCTION public.effective_recruiter_active_opportunity_limit(
  _recruiter_id uuid
) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _tier text;
BEGIN
  _tier := public.effective_recruiter_tier(_recruiter_id);
  RETURN CASE _tier
    WHEN 'conflict' THEN 0 WHEN 'free_standard' THEN 1 WHEN 'starter' THEN 5
    WHEN 'growth' THEN 15 WHEN 'fleet' THEN 25 ELSE 0 END;
END;
$$;

-- ---------------- operational graph ----------------

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.carrier_driver_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id),
  driver_user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE public.driver_assistants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES auth.users(id),
  assistant_user_id uuid,
  status text NOT NULL DEFAULT 'active',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.assistant_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegate_id uuid REFERENCES public.driver_assistants(id) ON DELETE CASCADE,
  action text NOT NULL
);

CREATE TABLE public.agency_delegation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id),
  driver_user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'approved'
);

CREATE TABLE public.driver_opportunity_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),
  full_name text NOT NULL
);

CREATE TABLE public.loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  reference text,
  broker text,
  origin text,
  destination text,
  status text NOT NULL DEFAULT 'completed'
);

CREATE TABLE public.load_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE
);

CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  load_id uuid REFERENCES public.loads(id) ON DELETE SET NULL,
  amount numeric NOT NULL DEFAULT 0
);

CREATE TABLE public.fuel_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  load_id uuid REFERENCES public.loads(id) ON DELETE SET NULL,
  gallons numeric NOT NULL DEFAULT 0
);

CREATE TABLE public.lane_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lane_key text NOT NULL,
  loads_count integer NOT NULL DEFAULT 0
);

CREATE TABLE public.broker_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  broker text NOT NULL,
  loads_count integer NOT NULL DEFAULT 0
);

CREATE TABLE public.operating_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  total_loads integer NOT NULL DEFAULT 0
);

-- Recompute triggers: they update aggregates but never remove the QA-user rows.
CREATE OR REPLACE FUNCTION public.recompute_lane_stats() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.lane_stats(user_id, lane_key, loads_count)
    VALUES (NEW.user_id, coalesce(NEW.origin,'?') || '->' || coalesce(NEW.destination,'?'), 1)
    ON CONFLICT DO NOTHING;
    INSERT INTO public.operating_metrics(user_id, total_loads)
    VALUES (NEW.user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET total_loads = public.operating_metrics.total_loads + 1;
    RETURN NEW;
  END IF;
  UPDATE public.lane_stats SET loads_count = greatest(loads_count - 1, 0)
   WHERE user_id = OLD.user_id;
  UPDATE public.operating_metrics SET total_loads = greatest(total_loads - 1, 0)
   WHERE user_id = OLD.user_id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER loads_recompute
AFTER INSERT OR DELETE ON public.loads
FOR EACH ROW EXECUTE FUNCTION public.recompute_lane_stats();

CREATE TABLE public.opportunity_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id),
  driver_user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'submitted'
);

CREATE TABLE public.application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.opportunity_applications(id),
  event_type text NOT NULL
);

CREATE TABLE public.opportunity_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES public.opportunity_applications(id)
);

CREATE TABLE public.recruiter_contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES public.opportunity_applications(id)
);

CREATE TABLE public.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid,
  application_id uuid REFERENCES public.opportunity_applications(id)
);

CREATE TABLE public.dispatch_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid
);

CREATE TABLE public.driver_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id),
  referred_driver_user_id uuid,
  referring_driver_id uuid,
  status text NOT NULL DEFAULT 'pending'
);

CREATE TABLE public.agency_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency_profiles(id),
  driver_user_id uuid NOT NULL REFERENCES auth.users(id),
  title text NOT NULL
);

CREATE TABLE public.driver_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'draft'
);

CREATE TABLE public.driver_settlement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES public.driver_settlements(id),
  amount numeric NOT NULL DEFAULT 0
);

CREATE TABLE public.driver_settlement_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_item_id uuid NOT NULL REFERENCES public.driver_settlement_items(id),
  load_id uuid REFERENCES public.loads(id) ON DELETE SET NULL
);

CREATE TABLE public.driver_settlement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES public.driver_settlements(id)
);
`;

const pool = new pg.Pool({ connectionString: URL_STR, max: 4 });

const OWNER = randomUUID();
const OTHER_ADMIN = randomUUID();
const PLAIN_USER = randomUUID();
const QA_DRIVER = randomUUID();
const RECRUITER_OWNER = randomUUID();
const CONTROL_DRIVER = randomUUID();
const CONTROL_RECRUITER_OWNER = randomUUID();

let recruiterRoot = '';
let agencyRoot = '';
let controlRecruiter = '';
let controlAgency = '';
let qaOpportunity = '';
let controlOpportunity = '';

async function asAuthenticated<T>(
  uid: string | null,
  fn: (c: pg.PoolClient) => Promise<T>,
  role = 'authenticated',
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
      uid ?? '',
    ]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function callAsOwner(fnName: string, uid: string = OWNER) {
  return asAuthenticated(uid, async (c) => {
    const r = await c.query(`SELECT public.${fnName}() AS out`);
    return r.rows[0].out as Record<string, number | boolean>;
  });
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const r = await pool.query(sql, params);
  return Number(r.rows[0].n);
}

/** Rebuilds the full O10/O11-shaped fixture data set. */
async function seedFixtureData() {
  await pool.query(`
    DELETE FROM public.driver_settlement_matches;
    DELETE FROM public.driver_settlement_items;
    DELETE FROM public.driver_settlements;
    DELETE FROM public.agency_work_items;
    DELETE FROM public.application_events;
    DELETE FROM public.opportunity_applications;
    DELETE FROM public.driver_referrals;
    DELETE FROM public.driver_opportunity_profiles;
    DELETE FROM public.expenses;
    DELETE FROM public.fuel_logs;
    DELETE FROM public.loads;
    DELETE FROM public.driver_assistants;
    DELETE FROM public.agency_delegation_requests;
    DELETE FROM public.carrier_driver_relationships;
    DELETE FROM public.lane_stats;
    DELETE FROM public.broker_stats;
    DELETE FROM public.operating_metrics;
    DELETE FROM public.notifications;
  `);

  // O10 relationships
  const carrier = await pool.query(
    `INSERT INTO public.carrier_driver_relationships(recruiter_id, driver_user_id)
     VALUES ($1,$2) RETURNING id`,
    [recruiterRoot, QA_DRIVER],
  );
  const assistant = await pool.query(
    `INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id)
     VALUES ($1,$2) RETURNING id`,
    [QA_DRIVER, OWNER],
  );
  const delegation = await pool.query(
    `INSERT INTO public.agency_delegation_requests(agency_id, driver_user_id)
     VALUES ($1,$2) RETURNING id`,
    [agencyRoot, QA_DRIVER],
  );

  // O11 operational descendants
  await pool.query(
    `INSERT INTO public.driver_opportunity_profiles(user_id, full_name)
     VALUES ($1,'HTP QA Driver')`,
    [QA_DRIVER],
  );
  const l1 = await pool.query(
    `INSERT INTO public.loads(user_id, reference, broker, origin, destination, status)
     VALUES ($1,'HTP-QA-L1','QA Broker','Dallas, TX','Atlanta, GA','completed') RETURNING id`,
    [QA_DRIVER],
  );
  await pool.query(
    `INSERT INTO public.loads(user_id, reference, broker, origin, destination, status)
     VALUES ($1,'HTP-QA-L2','QA Broker','Atlanta, GA','Memphis, TN','pending')`,
    [QA_DRIVER],
  );
  await pool.query(
    `INSERT INTO public.broker_stats(user_id, broker, loads_count) VALUES ($1,'QA Broker',2)`,
    [QA_DRIVER],
  );
  await pool.query(
    `INSERT INTO public.expenses(user_id, load_id, amount) VALUES ($1,$2,120),($1,NULL,45)`,
    [QA_DRIVER, l1.rows[0].id],
  );
  await pool.query(
    `INSERT INTO public.fuel_logs(user_id, load_id, gallons) VALUES ($1,$2,110)`,
    [QA_DRIVER, l1.rows[0].id],
  );

  const app = await pool.query(
    `INSERT INTO public.opportunity_applications(opportunity_id, recruiter_id, driver_user_id)
     VALUES ($1,$2,$3) RETURNING id`,
    [qaOpportunity, recruiterRoot, QA_DRIVER],
  );
  await pool.query(
    `INSERT INTO public.application_events(application_id, event_type)
     VALUES ($1,'application_submitted')`,
    [app.rows[0].id],
  );
  const work = await pool.query(
    `INSERT INTO public.agency_work_items(agency_id, driver_user_id, title)
     VALUES ($1,$2,'QA monthly closeout') RETURNING id`,
    [agencyRoot, QA_DRIVER],
  );
  const settlement = await pool.query(
    `INSERT INTO public.driver_settlements(driver_user_id) VALUES ($1) RETURNING id`,
    [QA_DRIVER],
  );
  const item = await pool.query(
    `INSERT INTO public.driver_settlement_items(settlement_id, amount)
     VALUES ($1, 1850) RETURNING id`,
    [settlement.rows[0].id],
  );
  await pool.query(
    `INSERT INTO public.driver_settlement_matches(settlement_item_id, load_id)
     VALUES ($1,$2)`,
    [item.rows[0].id, l1.rows[0].id],
  );

  // Trigger-shaped notifications referencing the rows above
  await pool.query(
    `INSERT INTO public.notifications(user_id, type, payload) VALUES
       ($1,'application_submitted', jsonb_build_object('application_id', $2::text)),
       ($3,'assistant_invited', jsonb_build_object('assistant_id', $4::text)),
       ($3,'delegation_requested', jsonb_build_object('delegation_id', $5::text)),
       ($1,'work_item_created', jsonb_build_object('work_item_id', $6::text))`,
    [
      RECRUITER_OWNER,
      app.rows[0].id,
      QA_DRIVER,
      assistant.rows[0].id,
      delegation.rows[0].id,
      work.rows[0].id,
    ],
  );
  // Unrelated notifications for the same users — must survive.
  await pool.query(
    `INSERT INTO public.notifications(user_id, type, payload) VALUES
       ($1,'weekly_summary','{}'::jsonb),
       ($2,'payment_reminder','{}'::jsonb),
       ($3,'weekly_summary','{}'::jsonb)`,
    [QA_DRIVER, OWNER, CONTROL_DRIVER],
  );

  expect(Number(carrier.rowCount)).toBe(1);

  // Non-QA control rows are re-seeded alongside the fixture because the
  // blanket clean-up above is a harness reset, not an O13 behaviour.
  await seedControlData();
}

/** Non-QA control data that must never be touched. */
async function seedControlData() {
  await pool.query(
    `INSERT INTO public.loads(user_id, reference, broker, origin, destination)
     VALUES ($1,'REAL-1','Real Broker','Reno, NV','Boise, ID')`,
    [CONTROL_DRIVER],
  );
  await pool.query(`INSERT INTO public.expenses(user_id, amount) VALUES ($1, 75)`, [
    CONTROL_DRIVER,
  ]);
  await pool.query(`INSERT INTO public.fuel_logs(user_id, gallons) VALUES ($1, 60)`, [
    CONTROL_DRIVER,
  ]);
  await pool.query(
    `INSERT INTO public.driver_opportunity_profiles(user_id, full_name)
     VALUES ($1,'Real Driver')`,
    [CONTROL_DRIVER],
  );
  const app = await pool.query(
    `INSERT INTO public.opportunity_applications(opportunity_id, recruiter_id, driver_user_id)
     VALUES ($1,$2,$3) RETURNING id`,
    [controlOpportunity, controlRecruiter, CONTROL_DRIVER],
  );
  await pool.query(
    `INSERT INTO public.application_events(application_id, event_type) VALUES ($1,'x')`,
    [app.rows[0].id],
  );
  await pool.query(
    `INSERT INTO public.carrier_driver_relationships(recruiter_id, driver_user_id)
     VALUES ($1,$2)`,
    [controlRecruiter, CONTROL_DRIVER],
  );
  await pool.query(
    `INSERT INTO public.driver_assistants(driver_user_id, assistant_user_id) VALUES ($1,$2)`,
    [CONTROL_DRIVER, PLAIN_USER],
  );
  await pool.query(
    `INSERT INTO public.agency_delegation_requests(agency_id, driver_user_id) VALUES ($1,$2)`,
    [controlAgency, CONTROL_DRIVER],
  );
  await pool.query(
    `INSERT INTO public.driver_settlements(driver_user_id) VALUES ($1)`,
    [CONTROL_DRIVER],
  );
}

beforeAll(async () => {
  await pool.query(SCAFFOLD);
  await pool.query(O2_SQL);
  await pool.query(O6_SQL);
  await pool.query(O13_SQL);

  await pool.query(
    `INSERT INTO auth.users(id) VALUES ($1),($2),($3),($4),($5),($6),($7)`,
    [
      OWNER,
      OTHER_ADMIN,
      PLAIN_USER,
      QA_DRIVER,
      RECRUITER_OWNER,
      CONTROL_DRIVER,
      CONTROL_RECRUITER_OWNER,
    ],
  );
  await pool.query(
    `INSERT INTO public.admin_users(user_id, role) VALUES ($1,'super_admin'),($2,'admin')`,
    [OWNER, OTHER_ADMIN],
  );

  recruiterRoot = (
    await pool.query(
      `INSERT INTO public.recruiter_profiles(user_id) VALUES ($1) RETURNING id`,
      [RECRUITER_OWNER],
    )
  ).rows[0].id;
  controlRecruiter = (
    await pool.query(
      `INSERT INTO public.recruiter_profiles(user_id) VALUES ($1) RETURNING id`,
      [CONTROL_RECRUITER_OWNER],
    )
  ).rows[0].id;
  agencyRoot = (
    await pool.query(
      `INSERT INTO public.agency_profiles(owner_user_id) VALUES ($1) RETURNING id`,
      [OWNER],
    )
  ).rows[0].id;
  controlAgency = (
    await pool.query(
      `INSERT INTO public.agency_profiles(owner_user_id) VALUES ($1) RETURNING id`,
      [PLAIN_USER],
    )
  ).rows[0].id;

  await pool.query(
    `INSERT INTO public.recruiter_members(recruiter_id, member_user_id) VALUES ($1,$2)`,
    [recruiterRoot, RECRUITER_OWNER],
  );
  await pool.query(
    `INSERT INTO public.agency_members(agency_id, member_user_id, role, status)
     VALUES ($1,$2,'agency_owner','active')`,
    [agencyRoot, OWNER],
  );

  qaOpportunity = (
    await pool.query(
      `INSERT INTO public.opportunities(recruiter_id, status) VALUES ($1,'published') RETURNING id`,
      [recruiterRoot],
    )
  ).rows[0].id;
  controlOpportunity = (
    await pool.query(
      `INSERT INTO public.opportunities(recruiter_id, status) VALUES ($1,'published') RETURNING id`,
      [controlRecruiter],
    )
  ).rows[0].id;

  // Preserved-state rows
  await pool.query(`INSERT INTO public.profiles(user_id) VALUES ($1)`, [QA_DRIVER]);
  await pool.query(
    `INSERT INTO public.user_capabilities(user_id, capability) VALUES ($1,'driver')`,
    [QA_DRIVER],
  );
  await pool.query(`INSERT INTO public.cost_profile(user_id) VALUES ($1)`, [QA_DRIVER]);
  await pool.query(`INSERT INTO public.driver_points(user_id, points) VALUES ($1, 40)`, [
    QA_DRIVER,
  ]);
  await pool.query(
    `INSERT INTO public.driver_point_events(user_id, points) VALUES ($1, 40)`,
    [QA_DRIVER],
  );
  await pool.query(`INSERT INTO public.suppressed_emails(email) VALUES ('qa@example.test')`);
  await pool.query(`INSERT INTO public.telegram_user_links(user_id) VALUES ($1)`, [OWNER]);
  await pool.query(
    `INSERT INTO public.subscriptions(user_id, status, plan_key) VALUES ($1,'active','pro_monthly')`,
    [OWNER],
  );
  await pool.query(
    `INSERT INTO public.recruiter_billing_profiles(recruiter_id, plan, status)
     VALUES ($1,'fleet','active')`,
    [recruiterRoot],
  );

  // The three registered QA roots.
  for (const [kind, id] of [
    ['user', QA_DRIVER],
    ['recruiter_profile', recruiterRoot],
    ['agency_profile', agencyRoot],
  ] as const) {
    await pool.query(
      `INSERT INTO public.qa_fixture_roots
         (root_kind, root_id, qa_owner_user_id, registered_by_user_id)
       VALUES ($1,$2,$3,$3)`,
      [kind, id, OWNER],
    );
  }

}, 90_000);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await seedFixtureData();
});

describe('O13 — authorization contract', () => {
  it('rejects an unauthenticated caller', async () => {
    await expect(
      asAuthenticated(null, (c) =>
        c.query(`SELECT public.owner_qa_fixture_reset_preview()`),
      ),
    ).rejects.toThrow(/unauthenticated/);
  });

  it('rejects a non-super-admin authenticated caller (preview and reset)', async () => {
    await expect(
      asAuthenticated(PLAIN_USER, (c) =>
        c.query(`SELECT public.owner_qa_fixture_reset_preview()`),
      ),
    ).rejects.toThrow(/forbidden/);
    await expect(
      asAuthenticated(OTHER_ADMIN, (c) =>
        c.query(`SELECT public.owner_qa_fixture_reset()`),
      ),
    ).rejects.toThrow(/forbidden/);
    expect(
      await count(
        `SELECT count(*) n FROM public.loads WHERE user_id = $1`,
        [QA_DRIVER],
      ),
    ).toBe(2);
  });

  it('fails closed when a required root is missing, duplicated, or foreign', async () => {
    // missing
    await pool.query(
      `UPDATE public.qa_fixture_roots SET active = false, revoked_at = now()
        WHERE root_kind = 'agency_profile' AND qa_owner_user_id = $1`,
      [OWNER],
    );
    await expect(callAsOwner('owner_qa_fixture_reset_preview')).rejects.toThrow(
      /unexpected_count/,
    );
    await pool.query(
      `UPDATE public.qa_fixture_roots SET active = true, revoked_at = NULL
        WHERE root_kind = 'agency_profile' AND qa_owner_user_id = $1`,
      [OWNER],
    );

    // duplicate / extra root of the same kind
    const extra = randomUUID();
    await pool.query(
      `INSERT INTO public.qa_fixture_roots
         (root_kind, root_id, qa_owner_user_id, registered_by_user_id)
       VALUES ('recruiter_profile', $1, $2, $2)`,
      [extra, OWNER],
    );
    await expect(callAsOwner('owner_qa_fixture_reset')).rejects.toThrow(
      /unexpected_count/,
    );
    await pool.query(`DELETE FROM public.qa_fixture_roots WHERE root_id = $1`, [
      extra,
    ]);

    // roots owned by someone else are not visible to this caller
    await pool.query(
      `INSERT INTO public.admin_users(user_id, role) VALUES ($1,'super_admin')
       ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin'`,
      [PLAIN_USER],
    );
    await expect(
      callAsOwner('owner_qa_fixture_reset_preview', PLAIN_USER),
    ).rejects.toThrow(/unexpected_count/);
    await pool.query(`DELETE FROM public.admin_users WHERE user_id = $1`, [
      PLAIN_USER,
    ]);

    expect(
      await count(`SELECT count(*) n FROM public.loads WHERE user_id = $1`, [
        QA_DRIVER,
      ]),
    ).toBe(2);
  });

  it('has fail-closed ACLs: no EXECUTE for PUBLIC or anon', async () => {
    const r = await pool.query(
      `SELECT p.proname,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
              p.prosecdef, p.proconfig
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('owner_qa_fixture_reset','owner_qa_fixture_reset_preview',
                            '_owner_qa_fixture_roots','_owner_qa_fixture_reset_counts',
                            '_owner_qa_fixture_reset_guard','_owner_qa_fixture_related_users')
        ORDER BY p.proname`,
    );
    expect(r.rows.length).toBe(6);
    for (const row of r.rows) {
      expect(row.anon_exec).toBe(false);
      expect(row.public_exec).toBe(false);
      expect(row.prosecdef).toBe(true);
      expect(String(row.proconfig)).toContain('search_path=');
      if (String(row.proname).startsWith('_')) {
        expect(row.auth_exec).toBe(false);
      } else {
        expect(row.auth_exec).toBe(true);
      }
    }
  });
});

describe('O13 — preview', () => {
  it('counts exactly the QA descendants and is read-only', async () => {
    const before = await count(
      `SELECT (SELECT count(*) FROM public.loads)
            + (SELECT count(*) FROM public.notifications)
            + (SELECT count(*) FROM public.opportunity_applications) AS n`,
    );
    const p = await callAsOwner('owner_qa_fixture_reset_preview');
    const after = await count(
      `SELECT (SELECT count(*) FROM public.loads)
            + (SELECT count(*) FROM public.notifications)
            + (SELECT count(*) FROM public.opportunity_applications) AS n`,
    );
    expect(after).toBe(before);

    expect(p.carrier_relationships).toBe(1);
    expect(p.assistant_relationships).toBe(1);
    expect(p.agency_delegations).toBe(1);
    expect(p.driver_profiles).toBe(1);
    expect(p.loads).toBe(2);
    expect(p.expenses).toBe(2);
    expect(p.fuel_logs).toBe(1);
    expect(p.applications).toBe(1);
    expect(p.application_events).toBe(1);
    expect(p.referrals).toBe(0);
    expect(p.agency_work_items).toBe(1);
    expect(p.settlements).toBe(1);
    expect(p.settlement_items).toBe(1);
    expect(p.settlement_matches).toBe(1);
    expect(p.notifications).toBe(4);
    expect(p.broker_stats).toBe(1);
    expect(p.roots_intact).toBe(true);
    expect(Number(p.total_rows)).toBeGreaterThan(0);
  });

  it('is declared STABLE (read-only) while reset is VOLATILE', async () => {
    const r = await pool.query(
      `SELECT proname, provolatile FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public'
         AND proname IN ('owner_qa_fixture_reset_preview','owner_qa_fixture_reset')`,
    );
    const map = Object.fromEntries(r.rows.map((x) => [x.proname, x.provolatile]));
    expect(map.owner_qa_fixture_reset_preview).toBe('s');
    expect(map.owner_qa_fixture_reset).toBe('v');
  });

  it('preview totals equal the sum of the category counts', async () => {
    const p = await callAsOwner('owner_qa_fixture_reset_preview');
    const sum = Object.entries(p)
      .filter(([k]) => k !== 'total_rows' && k !== 'roots_intact')
      .reduce((acc, [, v]) => acc + Number(v), 0);
    expect(Number(p.total_rows)).toBe(sum);
  });
});

describe('O13 — reset', () => {
  it('removes every QA operational descendant and matches the preview', async () => {
    const preview = await callAsOwner('owner_qa_fixture_reset_preview');
    const result = await callAsOwner('owner_qa_fixture_reset');
    expect(Number(result.total_rows)).toBe(Number(preview.total_rows));
    for (const key of Object.keys(preview)) {
      if (key === 'roots_intact') continue;
      expect(Number(result[key])).toBe(Number(preview[key]));
    }

    const zero = await callAsOwner('owner_qa_fixture_reset_preview');
    expect(Number(zero.total_rows)).toBe(0);

    expect(
      await count(`SELECT count(*) n FROM public.loads WHERE user_id=$1`, [QA_DRIVER]),
    ).toBe(0);
    expect(
      await count(`SELECT count(*) n FROM public.expenses WHERE user_id=$1`, [QA_DRIVER]),
    ).toBe(0);
    expect(
      await count(`SELECT count(*) n FROM public.lane_stats WHERE user_id=$1`, [QA_DRIVER]),
    ).toBe(0);
    expect(
      await count(`SELECT count(*) n FROM public.operating_metrics WHERE user_id=$1`, [
        QA_DRIVER,
      ]),
    ).toBe(0);
    expect(
      await count(`SELECT count(*) n FROM public.broker_stats WHERE user_id=$1`, [
        QA_DRIVER,
      ]),
    ).toBe(0);
    expect(
      await count(`SELECT count(*) n FROM public.driver_settlement_matches`),
    ).toBe(0);
  });

  it('is idempotent: a second reset removes zero rows and does not fail', async () => {
    await callAsOwner('owner_qa_fixture_reset');
    const second = await callAsOwner('owner_qa_fixture_reset');
    expect(Number(second.total_rows)).toBe(0);
    expect(second.roots_intact).toBe(true);
  });

  it('preserves roots, root identities, QA opportunities, billing, suppression and Telegram', async () => {
    await callAsOwner('owner_qa_fixture_reset');

    expect(
      await count(
        `SELECT count(*) n FROM public.qa_fixture_roots
          WHERE active AND revoked_at IS NULL AND qa_owner_user_id=$1`,
        [OWNER],
      ),
    ).toBe(3);
    expect(await count(`SELECT count(*) n FROM auth.users WHERE id=$1`, [QA_DRIVER])).toBe(1);
    expect(
      await count(`SELECT count(*) n FROM public.profiles WHERE user_id=$1`, [QA_DRIVER]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) n FROM public.user_capabilities WHERE user_id=$1`, [
        QA_DRIVER,
      ]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) n FROM public.cost_profile WHERE user_id=$1`, [QA_DRIVER]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) n FROM public.driver_points WHERE user_id=$1`, [QA_DRIVER]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) n FROM public.driver_point_events WHERE user_id=$1`, [
        QA_DRIVER,
      ]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) n FROM public.opportunities WHERE recruiter_id=$1`, [
        recruiterRoot,
      ]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) n FROM public.recruiter_members WHERE recruiter_id=$1`, [
        recruiterRoot,
      ]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) n FROM public.agency_members WHERE agency_id=$1`, [
        agencyRoot,
      ]),
    ).toBe(1);
    expect(await count(`SELECT count(*) n FROM public.suppressed_emails`)).toBe(1);
    expect(await count(`SELECT count(*) n FROM public.telegram_user_links`)).toBe(1);
    expect(await count(`SELECT count(*) n FROM public.subscriptions`)).toBe(1);
    expect(await count(`SELECT count(*) n FROM public.recruiter_billing_profiles`)).toBe(1);
    expect(await count(`SELECT count(*) n FROM public.owner_qa_sessions`)).toBe(0);
  });

  it('never touches unrelated non-QA control rows or unrelated notifications', async () => {
    await callAsOwner('owner_qa_fixture_reset');

    expect(
      await count(`SELECT count(*) n FROM public.loads WHERE user_id=$1`, [CONTROL_DRIVER]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) n FROM public.expenses WHERE user_id=$1`, [CONTROL_DRIVER]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) n FROM public.fuel_logs WHERE user_id=$1`, [CONTROL_DRIVER]),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*) n FROM public.opportunity_applications WHERE driver_user_id=$1`,
        [CONTROL_DRIVER],
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*) n FROM public.carrier_driver_relationships WHERE driver_user_id=$1`,
        [CONTROL_DRIVER],
      ),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) n FROM public.driver_assistants WHERE driver_user_id=$1`, [
        CONTROL_DRIVER,
      ]),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*) n FROM public.agency_delegation_requests WHERE driver_user_id=$1`,
        [CONTROL_DRIVER],
      ),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) n FROM public.driver_settlements WHERE driver_user_id=$1`, [
        CONTROL_DRIVER,
      ]),
    ).toBe(1);

    // The three payload-less notifications survive.
    expect(
      await count(`SELECT count(*) n FROM public.notifications WHERE payload = '{}'::jsonb`),
    ).toBe(3);
  });

  it('fails BEFORE deleting anything when ambiguous descendants exist', async () => {
    const app = await pool.query(
      `SELECT id FROM public.opportunity_applications
        WHERE driver_user_id=$1 AND recruiter_id=$2`,
      [QA_DRIVER, recruiterRoot],
    );
    await pool.query(
      `INSERT INTO public.contracts(driver_user_id, application_id) VALUES ($1,$2)`,
      [QA_DRIVER, app.rows[0].id],
    );

    await expect(callAsOwner('owner_qa_fixture_reset')).rejects.toThrow(
      /ambiguous_descendants/,
    );

    expect(
      await count(`SELECT count(*) n FROM public.loads WHERE user_id=$1`, [QA_DRIVER]),
    ).toBe(2);
    expect(
      await count(
        `SELECT count(*) n FROM public.opportunity_applications WHERE driver_user_id=$1`,
        [QA_DRIVER],
      ),
    ).toBe(1);

    await pool.query(`DELETE FROM public.contracts`);
  });

  it('also removes QA referrals descended from the QA driver + QA recruiter root', async () => {
    await pool.query(
      `INSERT INTO public.driver_referrals(recruiter_id, referred_driver_user_id)
       VALUES ($1,$2)`,
      [recruiterRoot, QA_DRIVER],
    );
    await pool.query(
      `INSERT INTO public.driver_referrals(recruiter_id, referred_driver_user_id)
       VALUES ($1,$2)`,
      [controlRecruiter, CONTROL_DRIVER],
    );

    const preview = await callAsOwner('owner_qa_fixture_reset_preview');
    expect(preview.referrals).toBe(1);
    const result = await callAsOwner('owner_qa_fixture_reset');
    expect(result.referrals).toBe(1);

    expect(
      await count(`SELECT count(*) n FROM public.driver_referrals WHERE recruiter_id=$1`, [
        controlRecruiter,
      ]),
    ).toBe(1);
    await pool.query(`DELETE FROM public.driver_referrals`);
  });

  it('does not disable triggers or bypass replication safeguards', () => {
    expect(O13_SQL).not.toMatch(/session_replication_role/i);
    expect(O13_SQL).not.toMatch(/DISABLE TRIGGER/i);
    expect(O13_SQL).not.toMatch(/DELETE FROM public\.qa_fixture_roots/i);
    expect(O13_SQL).not.toMatch(/pgmq\.|net\.http|extensions\.http/i);
    expect(O13_SQL).not.toMatch(/UPDATE public\.subscriptions|DELETE FROM public\.subscriptions/i);
  });
});
