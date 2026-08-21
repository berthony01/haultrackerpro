/**
 * Phase TG-2E3-O7 — Real PostgreSQL gate for the QA fixture isolation
 * candidate.
 *
 * Applies a production-faithful scaffold containing the PRE-O7 (live) bodies of
 * the seven public/customer discovery functions, then the accepted Owner QA
 * (O2) candidate, then the accepted O6 registry candidate. Snapshots the whole
 * object inventory, the seven function contracts, the untouched neighbours and
 * the O6 helper ACL. Then applies the O7 candidate and proves it replaces
 * exactly those seven function bodies, adds no object, broadens no privilege,
 * and isolates only ACTIVE registered QA roots from non-owner public callers.
 *
 * Lives OUTSIDE `src/` so the default `bunx vitest run` never picks it up.
 * Run with an ad-hoc config (for example under /tmp) that includes only this
 * file.
 *
 * NEVER SKIPS. Fails hard if TG2E3O7_DATABASE_URL is absent.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.TG2E3O7_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'TG2E3O7_DATABASE_URL is required for the Phase TG-2E3-O7 real-Postgres gate.',
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

const OWNER_QA_SQL = candidate(
  '20260820200000_phase_tg2e3_o2_owner_qa_entitlement.sql',
);
const O6_SQL = candidate(
  '20260821050000_phase_tg2e3_o6_qa_fixture_root_registry.sql',
);
const O7_SQL = candidate(
  '20260821053000_phase_tg2e3_o7_qa_fixture_isolation.sql',
);

/** Roles + auth shim + the tables the seven functions genuinely read. */
const SCAFFOLD = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;

DO $$ BEGIN CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;

CREATE TABLE IF NOT EXISTS public.admin_users (
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

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid,
  action text NOT NULL,
  target_user_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL,
  plan_key text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid PRIMARY KEY,
  driver_handle text,
  handle_public boolean DEFAULT false,
  handle_emoji text
);

CREATE TABLE IF NOT EXISTS public.driver_points (
  user_id uuid PRIMARY KEY,
  total_points integer NOT NULL DEFAULT 0,
  weekly_points integer NOT NULL DEFAULT 0,
  parking_points integer NOT NULL DEFAULT 0,
  load_points integer NOT NULL DEFAULT 0,
  streak_days integer NOT NULL DEFAULT 0,
  last_activity_date date
);

CREATE TABLE IF NOT EXISTS public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  verification_status text NOT NULL DEFAULT 'approved',
  recruiter_name text,
  company_name text,
  recruiter_email text,
  company_type text,
  dot_number text,
  mc_number text,
  posting_terms_accepted_at timestamptz,
  legacy_terms_grandfathered_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.recruiter_billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL,
  plan text,
  status text
);

CREATE TABLE IF NOT EXISTS public.agency_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  contact_email text,
  slug text UNIQUE,
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS public.agency_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  role text NOT NULL,
  status text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.agency_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  plan_key text NOT NULL,
  status text NOT NULL,
  source text NOT NULL,
  member_limit integer,
  active_client_limit integer,
  service_package_limit integer
);

CREATE TABLE IF NOT EXISTS public.agency_service_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
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

DO $$ BEGIN
  CREATE TYPE public.recruiter_workspace_permission AS ENUM (
    'opportunities_create',
    'opportunities_edit',
    'opportunities_change_status',
    'opportunities_view'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL,
  title text,
  company_name text,
  status text NOT NULL DEFAULT 'draft',
  admin_review_status text NOT NULL DEFAULT 'pending',
  hiring_state text,
  hiring_city text,
  driver_type text,
  route_type text,
  featured boolean DEFAULT false,
  published_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunities TO authenticated;
GRANT SELECT ON public.recruiter_profiles TO authenticated;

CREATE TABLE IF NOT EXISTS public.driver_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL,
  recruiter_id uuid NOT NULL,
  referring_driver_id uuid NOT NULL,
  referred_driver_user_id uuid,
  referred_driver_name text,
  referred_driver_email text,
  referred_driver_phone text,
  referred_driver_note text,
  status text NOT NULL DEFAULT 'submitted',
  last_status_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_opportunity_action(
  _recruiter_id uuid,
  _permission public.recruiter_workspace_permission
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    NULLIF(current_setting('test.perm_allow', true), '')::boolean,
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.effective_recruiter_active_opportunity_limit(
  _recruiter_id uuid
) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _tier text;
BEGIN
  _tier := public.effective_recruiter_tier(_recruiter_id);
  RETURN CASE _tier
    WHEN 'conflict'      THEN 0
    WHEN 'free_standard' THEN 1
    WHEN 'starter'       THEN 5
    WHEN 'growth'        THEN 15
    WHEN 'fleet'         THEN 25
    ELSE 0
  END;
END;
$$;

-- Live, unmodified neighbour that O7 must NOT touch.
CREATE OR REPLACE FUNCTION public.recruiter_profile_can_manage_opportunities(_recruiter_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter_id
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
      AND COALESCE(btrim(rp.recruiter_name), '') <> ''
      AND COALESCE(btrim(rp.company_name), '')   <> ''
      AND COALESCE(btrim(rp.recruiter_email), '') <> ''
      AND btrim(rp.recruiter_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
      AND rp.company_type IN (
        'carrier',
        'third_party_recruiter',
        'staffing_agency',
        'independent_recruiter'
      )
      AND (
        rp.company_type <> 'carrier'
        OR (
          COALESCE(btrim(rp.dot_number), '') <> ''
          OR COALESCE(btrim(rp.mc_number), '') <> ''
        )
      )
      AND (
        rp.posting_terms_accepted_at IS NOT NULL
        OR rp.legacy_terms_grandfathered_at IS NOT NULL
      )
  );
$$;
`;

/** Exact PRE-O7 live bodies of the seven functions. */
const BASELINE_SEVEN = `
CREATE OR REPLACE FUNCTION public.list_driver_visible_opportunities(
  _state text DEFAULT NULL::text,
  _driver_type text DEFAULT NULL::text,
  _route_type text DEFAULT NULL::text
) RETURNS SETOF opportunities
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT o.*
  FROM public.opportunities o
  WHERE auth.uid() IS NOT NULL
    AND o.status = 'active'
    AND o.admin_review_status = 'approved'
    AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
    AND (_state IS NULL OR o.hiring_state = _state)
    AND (_driver_type IS NULL OR o.driver_type = _driver_type)
    AND (_route_type IS NULL OR o.route_type = _route_type)
  ORDER BY o.featured DESC NULLS LAST, o.published_at DESC NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public.driver_can_access_opportunity(
  _opportunity_id uuid, _recruiter_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.opportunities o
    WHERE auth.uid() IS NOT NULL
      AND o.id = _opportunity_id
      AND o.recruiter_id = _recruiter_id
      AND o.status = 'active'
      AND o.admin_review_status = 'approved'
      AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.create_driver_referral_safe(
  _opportunity_id uuid,
  _recruiter_id uuid,
  _referred_driver_name text DEFAULT NULL::text,
  _referred_driver_email text DEFAULT NULL::text,
  _referred_driver_phone text DEFAULT NULL::text,
  _referred_driver_note text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _uid uuid := auth.uid();
  _name text := NULLIF(btrim(coalesce(_referred_driver_name, '')), '');
  _email text := NULLIF(lower(btrim(coalesce(_referred_driver_email, ''))), '');
  _phone text := NULLIF(btrim(coalesce(_referred_driver_phone, '')), '');
  _note text := NULLIF(btrim(coalesce(_referred_driver_note, '')), '');
  _id uuid;
  _opp_ok boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL AND _email IS NULL AND _phone IS NULL THEN
    RAISE EXCEPTION 'Referral requires at least a name, email, or phone' USING ERRCODE = '22023';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM public.opportunities o
    WHERE o.id = _opportunity_id
      AND o.recruiter_id = _recruiter_id
      AND o.status = 'active'
      AND o.admin_review_status = 'approved'
      AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
  ) INTO _opp_ok;
  IF NOT _opp_ok THEN
    RAISE EXCEPTION 'Opportunity not available for referrals' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.driver_referrals (
    opportunity_id, recruiter_id, referring_driver_id,
    referred_driver_name, referred_driver_email, referred_driver_phone, referred_driver_note
  ) VALUES (
    _opportunity_id, _recruiter_id, _uid,
    _name, _email, _phone, _note
  )
  RETURNING id INTO _id;
  RETURN _id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_agency_slug(_slug text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT ap.id FROM public.agency_profiles ap
   WHERE ap.slug = lower(trim(_slug)) AND ap.status = 'active'
     AND (SELECT l.status FROM public.get_effective_agency_limits(ap.id) l)
         IN ('manual_beta','active','trialing','past_due')
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_agency_public_view(_agency_id uuid)
RETURNS TABLE(id uuid, name text, description text, contact_email text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT ap.id, ap.name, ap.description, ap.contact_email, ap.status::text
    FROM public.agency_profiles ap
   WHERE ap.id = _agency_id AND ap.status = 'active'
     AND (SELECT l.status FROM public.get_effective_agency_limits(ap.id) l)
         IN ('manual_beta','active','trialing','past_due');
$function$;

CREATE OR REPLACE FUNCTION public.list_agency_packages_public(_agency_id uuid)
RETURNS SETOF agency_service_packages
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT * FROM public.agency_service_packages
   WHERE agency_id = _agency_id AND is_active = true
     AND EXISTS (SELECT 1 FROM public.agency_profiles ap
                  WHERE ap.id = _agency_id AND ap.status = 'active')
     AND (SELECT l.status FROM public.get_effective_agency_limits(_agency_id) l)
         IN ('manual_beta','active','trialing','past_due')
   ORDER BY sort_order ASC, created_at ASC;
$function$;

CREATE OR REPLACE FUNCTION public.get_weekly_driver_leaderboard(_limit integer DEFAULT 10)
RETURNS TABLE(user_id uuid, weekly_points integer, total_points integer, parking_points integer, load_points integer, streak_days integer, tier text, rank integer, masked_display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH ranked AS (
    SELECT
      d.user_id, d.weekly_points, d.total_points, d.parking_points,
      d.load_points, d.streak_days, d.last_activity_date,
      CASE
        WHEN d.total_points >= 400 THEN 'Platinum'
        WHEN d.total_points >= 150 THEN 'Gold'
        WHEN d.total_points >= 50 THEN 'Silver'
        ELSE 'Bronze'
      END AS tier,
      ROW_NUMBER() OVER (
        ORDER BY d.weekly_points DESC, d.total_points DESC,
                 d.last_activity_date ASC NULLS LAST
      )::int AS rank,
      CASE
        WHEN p.handle_public = true AND p.driver_handle IS NOT NULL THEN
          p.driver_handle ||
          CASE WHEN p.handle_emoji IS NOT NULL THEN ' ' || p.handle_emoji ELSE '' END
        ELSE
          'Driver #' || lpad((abs(hashtext(d.user_id::text)) % 10000)::text, 4, '0')
      END AS masked_display_name
    FROM public.driver_points d
    LEFT JOIN public.profiles p ON p.user_id = d.user_id
  )
  SELECT user_id, weekly_points, total_points, parking_points, load_points,
         streak_days, tier, rank, masked_display_name
  FROM ranked
  WHERE weekly_points > 0 OR user_id = auth.uid()
  ORDER BY rank
  LIMIT GREATEST(1, LEAST(_limit, 100));
$function$;

GRANT EXECUTE ON FUNCTION public.list_driver_visible_opportunities(text,text,text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.driver_can_access_opportunity(uuid,uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.create_driver_referral_safe(uuid,uuid,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_agency_slug(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_agency_public_view(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.list_agency_packages_public(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_driver_leaderboard(integer) TO authenticated, anon;

-- Live opportunities SELECT policies. O7 must not touch these.
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated view approved active opportunities" ON public.opportunities;
CREATE POLICY "Authenticated view approved active opportunities"
  ON public.opportunities FOR SELECT TO authenticated
  USING (public.driver_can_access_opportunity(id, recruiter_id));
DROP POLICY IF EXISTS "Admins view all opportunities" ON public.opportunities;
CREATE POLICY "Admins view all opportunities"
  ON public.opportunities FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Recruiter views own opportunities" ON public.opportunities;
CREATE POLICY "Recruiter views own opportunities"
  ON public.opportunities FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE rp.id = opportunities.recruiter_id AND rp.user_id = auth.uid()
  ));
`;

const SEVEN = [
  'list_driver_visible_opportunities',
  'driver_can_access_opportunity',
  'create_driver_referral_safe',
  'resolve_agency_slug',
  'get_agency_public_view',
  'list_agency_packages_public',
  'get_weekly_driver_leaderboard',
];

const UNTOUCHED_FUNCTIONS = [
  'recruiter_profile_can_manage_opportunities',
  'opportunities_billing_guard',
  'effective_recruiter_tier',
  'get_effective_agency_limits',
  'driver_has_active_pro',
  'is_qa_fixture_root',
];

const OBJECT_INVENTORY_SQL = `
  SELECT 'table:' || c.relname AS obj
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
  UNION ALL
  SELECT 'function:' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'policy:' || c.relname || '.' || pol.polname || '=' ||
         COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '')
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
  ORDER BY 1
`;

const CONTRACT_SQL = `
  SELECT p.proname,
         pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_function_result(p.oid) AS ret,
         l.lanname,
         p.provolatile,
         p.prosecdef,
         array_to_string(p.proconfig, ',') AS config,
         pg_get_functiondef(p.oid) AS def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public' AND p.proname = ANY($1)
  ORDER BY p.proname, p.oid
`;

const HELPER_ACL_SQL = `
  SELECT
    has_function_privilege('public', 'public.is_qa_fixture_root(text,uuid,uuid)', 'EXECUTE') AS pub,
    has_function_privilege('anon', 'public.is_qa_fixture_root(text,uuid,uuid)', 'EXECUTE') AS anon,
    has_function_privilege('authenticated', 'public.is_qa_fixture_root(text,uuid,uuid)', 'EXECUTE') AS authed,
    has_function_privilege('service_role', 'public.is_qa_fixture_root(text,uuid,uuid)', 'EXECUTE') AS svc,
    (SELECT array_to_string(p.proacl, ',') FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='is_qa_fixture_root') AS acl
`;

const pool = new pg.Pool({ connectionString: URL_STR, max: 4 });

const OWNER = randomUUID();
const PLAIN_DRIVER = randomUUID();
const OTHER_DRIVER = randomUUID();
const QA_USER = randomUUID();
const REC_OWNER_USER = randomUUID();

const QA_RECRUITER = randomUUID();
const REAL_RECRUITER = randomUUID();
const QA_OPP = randomUUID();
const REAL_OPP = randomUUID();
const QA_AGENCY = randomUUID();
const REAL_AGENCY = randomUUID();

type Row = Record<string, unknown>;

let inventoryBefore: string[] = [];
let inventoryAfter: string[] = [];
let sevenBefore: Row[] = [];
let sevenAfter: Row[] = [];
let untouchedBefore: Row[] = [];
let untouchedAfter: Row[] = [];
let helperAclBefore: Row = {};
let helperAclAfter: Row = {};
let baselineLeaderboard: Row[] = [];
let baselineVisibleOpps: string[] = [];
let baselineAgencyView: Row[] = [];

async function asRole<T>(
  uid: string | null,
  role: string,
  fn: (c: pg.PoolClient) => Promise<T>,
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

async function registerRoot(
  kind: string,
  rootId: string,
  active = true,
): Promise<void> {
  await pool.query(
    `INSERT INTO public.qa_fixture_roots
       (root_kind, root_id, qa_owner_user_id, active, registered_by_user_id, revoked_at)
     VALUES ($1,$2,$3,$4,$3,$5)
     ON CONFLICT (root_kind, root_id) DO UPDATE
       SET active = EXCLUDED.active, revoked_at = EXCLUDED.revoked_at`,
    [kind, rootId, OWNER, active, active ? null : new Date().toISOString()],
  );
}

async function clearRoots(): Promise<void> {
  await pool.query(`DELETE FROM public.qa_fixture_roots`);
}

async function listVisibleOpps(uid: string | null): Promise<string[]> {
  return asRole(uid, 'authenticated', async (c) => {
    const r = await c.query(
      `SELECT id FROM public.list_driver_visible_opportunities(NULL,NULL,NULL)`,
    );
    return r.rows.map((x) => x.id as string);
  });
}

async function canAccess(uid: string | null, opp: string, rec: string) {
  return asRole(uid, 'authenticated', async (c) => {
    const r = await c.query(
      `SELECT public.driver_can_access_opportunity($1,$2) AS ok`,
      [opp, rec],
    );
    return r.rows[0].ok as boolean;
  });
}

async function leaderboard(uid: string | null, role = 'authenticated') {
  return asRole(uid, role, async (c) => {
    const r = await c.query(
      `SELECT user_id, rank FROM public.get_weekly_driver_leaderboard(50)`,
    );
    return r.rows as Row[];
  });
}

beforeAll(async () => {
  await pool.query(SCAFFOLD);
  await pool.query(OWNER_QA_SQL);
  await pool.query(BASELINE_SEVEN);

  // Seed identities and fixture/non-fixture data.
  await pool.query(
    `INSERT INTO auth.users(id) VALUES ($1),($2),($3),($4),($5)`,
    [OWNER, PLAIN_DRIVER, OTHER_DRIVER, QA_USER, REC_OWNER_USER],
  );
  await pool.query(
    `INSERT INTO public.admin_users(user_id, role) VALUES ($1,'super_admin')`,
    [OWNER],
  );

  for (const [id, user] of [
    [QA_RECRUITER, OWNER],
    [REAL_RECRUITER, REC_OWNER_USER],
  ] as const) {
    await pool.query(
      `INSERT INTO public.recruiter_profiles
        (id, user_id, status, verification_status, recruiter_name, company_name,
         recruiter_email, company_type, dot_number, posting_terms_accepted_at)
       VALUES ($1,$2,'active','approved','Rec Name','Co Name','rec@example.com',
               'carrier','1234567', now())`,
      [id, user],
    );
  }

  for (const [id, rec] of [
    [QA_OPP, QA_RECRUITER],
    [REAL_OPP, REAL_RECRUITER],
  ] as const) {
    await pool.query(
      `INSERT INTO public.opportunities
        (id, recruiter_id, title, company_name, status, admin_review_status,
         hiring_state, driver_type, route_type, featured, published_at)
       VALUES ($1,$2,'Title','Co','active','approved','TX','company_driver','otr',false, now())`,
      [id, rec],
    );
  }

  for (const [id, owner, slug] of [
    [QA_AGENCY, OWNER, 'qa-agency'],
    [REAL_AGENCY, REC_OWNER_USER, 'real-agency'],
  ] as const) {
    await pool.query(
      `INSERT INTO public.agency_profiles
        (id, owner_user_id, name, description, contact_email, slug, status)
       VALUES ($1,$2,'Agency','Desc','a@example.com',$3,'active')`,
      [id, owner, slug],
    );
    await pool.query(
      `INSERT INTO public.agency_entitlements
        (agency_id, plan_key, status, source) VALUES ($1,'agency_starter','active','manual')`,
      [id],
    );
    await pool.query(
      `INSERT INTO public.agency_service_packages (agency_id, name) VALUES ($1,'Pkg')`,
      [id],
    );
  }

  await pool.query(
    `INSERT INTO public.driver_points (user_id, weekly_points, total_points)
     VALUES ($1, 100, 100), ($2, 50, 50), ($3, 80, 80)`,
    [PLAIN_DRIVER, OTHER_DRIVER, QA_USER],
  );

  // Baseline observations (registry empty, O6/O7 not applied yet).
  baselineVisibleOpps = (await listVisibleOpps(PLAIN_DRIVER)).sort();
  baselineLeaderboard = await leaderboard(PLAIN_DRIVER);
  baselineAgencyView = await asRole(null, 'anon', async (c) =>
    (await c.query(`SELECT id FROM public.get_agency_public_view($1)`, [QA_AGENCY])).rows,
  );

  await pool.query(O6_SQL);

  inventoryBefore = (await pool.query(OBJECT_INVENTORY_SQL)).rows.map((r) => r.obj as string);
  sevenBefore = (await pool.query(CONTRACT_SQL, [SEVEN])).rows;
  untouchedBefore = (await pool.query(CONTRACT_SQL, [UNTOUCHED_FUNCTIONS])).rows;
  helperAclBefore = (await pool.query(HELPER_ACL_SQL)).rows[0];

  await pool.query(O7_SQL);

  inventoryAfter = (await pool.query(OBJECT_INVENTORY_SQL)).rows.map((r) => r.obj as string);
  sevenAfter = (await pool.query(CONTRACT_SQL, [SEVEN])).rows;
  untouchedAfter = (await pool.query(CONTRACT_SQL, [UNTOUCHED_FUNCTIONS])).rows;
  helperAclAfter = (await pool.query(HELPER_ACL_SQL)).rows[0];
}, 120_000);

afterAll(async () => {
  await clearRoots();
  await pool.end();
});

describe('O7 blast radius', () => {
  it('adds no table, view, function, or policy', () => {
    const added = inventoryAfter.filter((o) => !inventoryBefore.includes(o));
    const removed = inventoryBefore.filter((o) => !inventoryAfter.includes(o));
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('replaces exactly the seven allowlisted function definitions', () => {
    const changed = sevenAfter
      .filter((a) => {
        const b = sevenBefore.find((x) => x.proname === a.proname);
        return b && b.def !== a.def;
      })
      .map((a) => a.proname as string)
      .sort();
    expect(changed).toEqual([...SEVEN].sort());
  });

  it('leaves untouched neighbour functions byte-identical', () => {
    expect(untouchedAfter).toEqual(untouchedBefore);
  });

  it('leaves the opportunities RLS policy definitions untouched', () => {
    const before = inventoryBefore.filter((o) => o.startsWith('policy:opportunities.'));
    const after = inventoryAfter.filter((o) => o.startsWith('policy:opportunities.'));
    expect(after).toEqual(before);
    expect(
      after.some((p) => p.includes('driver_can_access_opportunity')),
    ).toBe(true);
  });

  it('contains no plan/tier/Stripe/Telegram/email logic in executable SQL', () => {
    // Strip `--` comment lines so prose describing the guarantee cannot
    // satisfy or defeat the check; only executable SQL is scanned.
    const executable = O7_SQL.split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .toLowerCase();
    for (const forbidden of [
      'stripe',
      'telegram',
      'plan_key',
      'subscription',
      'entitlement',
      'email_send',
      'grant ',
      'revoke ',
      'create table',
      'create policy',
      'create trigger',
      'create index',
      'create view',
      'execute format',
    ]) {
      expect(executable).not.toContain(forbidden);
    }
  });
});

describe('function contracts preserved', () => {
  it('keeps signature, return type, language, volatility, secdef, search_path', () => {
    for (const b of sevenBefore) {
      const a = sevenAfter.find((x) => x.proname === b.proname)!;
      expect(a).toBeDefined();
      expect(a.args).toBe(b.args);
      expect(a.ret).toBe(b.ret);
      expect(a.lanname).toBe(b.lanname);
      expect(a.provolatile).toBe(b.provolatile);
      expect(a.prosecdef).toBe(true);
      expect(b.prosecdef).toBe(true);
      expect(a.config).toBe('search_path=public');
    }
    expect(sevenAfter).toHaveLength(7);
  });
});

describe('O6 helper ACL is unchanged and never broadened', () => {
  it('keeps the exact pre-O7 ACL array', () => {
    expect(helperAclAfter.acl).toBe(helperAclBefore.acl);
  });

  it('denies direct EXECUTE to PUBLIC, anon and authenticated; allows service_role', () => {
    expect(helperAclAfter.pub).toBe(false);
    expect(helperAclAfter.anon).toBe(false);
    expect(helperAclAfter.authed).toBe(false);
    expect(helperAclAfter.svc).toBe(true);
  });

  it('rejects a direct helper call from an authenticated caller', async () => {
    await expect(
      asRole(PLAIN_DRIVER, 'authenticated', (c) =>
        c.query(`SELECT public.is_qa_fixture_root('user', $1)`, [QA_USER]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('still allows nested helper use from every O7 function for authenticated and anonymous callers', async () => {
    await expect(listVisibleOpps(PLAIN_DRIVER)).resolves.toBeDefined();
    await expect(canAccess(PLAIN_DRIVER, REAL_OPP, REAL_RECRUITER)).resolves.toBe(true);
    await expect(leaderboard(PLAIN_DRIVER)).resolves.toBeDefined();
    await asRole(null, 'anon', async (c) => {
      await c.query(`SELECT * FROM public.get_agency_public_view($1)`, [REAL_AGENCY]);
      await c.query(`SELECT * FROM public.list_agency_packages_public($1)`, [REAL_AGENCY]);
      await c.query(`SELECT public.resolve_agency_slug('real-agency')`);
    });
    await asRole(PLAIN_DRIVER, 'authenticated', (c) =>
      c.query(
        `SELECT public.create_driver_referral_safe($1,$2,'Ref Name',NULL,NULL,NULL)`,
        [REAL_OPP, REAL_RECRUITER],
      ),
    );
    await pool.query(`DELETE FROM public.driver_referrals`);
  });
});

describe('inert with an empty registry', () => {
  it('reproduces baseline discovery output for all seven surfaces', async () => {
    await clearRoots();
    expect((await listVisibleOpps(PLAIN_DRIVER)).sort()).toEqual(baselineVisibleOpps);
    expect(await canAccess(PLAIN_DRIVER, QA_OPP, QA_RECRUITER)).toBe(true);
    expect(await leaderboard(PLAIN_DRIVER)).toEqual(baselineLeaderboard);
    const view = await asRole(null, 'anon', async (c) =>
      (await c.query(`SELECT id FROM public.get_agency_public_view($1)`, [QA_AGENCY])).rows,
    );
    expect(view).toEqual(baselineAgencyView);
    const slug = await asRole(null, 'anon', async (c) =>
      (await c.query(`SELECT public.resolve_agency_slug('qa-agency') AS id`)).rows[0].id,
    );
    expect(slug).toBe(QA_AGENCY);
    const pkgs = await asRole(null, 'anon', async (c) =>
      (await c.query(`SELECT id FROM public.list_agency_packages_public($1)`, [QA_AGENCY])).rows,
    );
    expect(pkgs).toHaveLength(1);
  });
});

describe('recruiter fixture isolation', () => {
  it('keeps a non-fixture opportunity visible to a normal driver', async () => {
    await clearRoots();
    await registerRoot('recruiter_profile', QA_RECRUITER);
    expect(await listVisibleOpps(PLAIN_DRIVER)).toEqual([REAL_OPP]);
  });

  it('hides an active registered recruiter fixture from a non-owner list call', async () => {
    expect(await listVisibleOpps(PLAIN_DRIVER)).not.toContain(QA_OPP);
  });

  it('returns false from driver_can_access_opportunity for a non-owner', async () => {
    expect(await canAccess(PLAIN_DRIVER, QA_OPP, QA_RECRUITER)).toBe(false);
  });

  it('transitively hides the fixture through the untouched RLS SELECT policy', async () => {
    const rows = await asRole(PLAIN_DRIVER, 'authenticated', async (c) =>
      (await c.query(`SELECT id FROM public.opportunities ORDER BY id`)).rows,
    );
    expect(rows.map((r) => r.id)).toEqual([REAL_OPP].sort());
  });

  it('lets the matching QA owner see and access its own recruiter fixture', async () => {
    expect(await listVisibleOpps(OWNER)).toEqual(
      expect.arrayContaining([QA_OPP, REAL_OPP]),
    );
    expect(await canAccess(OWNER, QA_OPP, QA_RECRUITER)).toBe(true);
  });

  it('blocks a non-owner referral to an active registered QA recruiter', async () => {
    await expect(
      asRole(PLAIN_DRIVER, 'authenticated', (c) =>
        c.query(
          `SELECT public.create_driver_referral_safe($1,$2,'Ref Name',NULL,NULL,NULL)`,
          [QA_OPP, QA_RECRUITER],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('lets the matching QA owner pass the referral fixture gate', async () => {
    const id = await asRole(OWNER, 'authenticated', async (c) =>
      (
        await c.query(
          `SELECT public.create_driver_referral_safe($1,$2,'Ref Name',NULL,NULL,NULL) AS id`,
          [QA_OPP, QA_RECRUITER],
        )
      ).rows[0].id,
    );
    expect(id).toBeTruthy();
    await pool.query(`DELETE FROM public.driver_referrals`);
  });

  it('stops suppressing a revoked/inactive recruiter fixture', async () => {
    await registerRoot('recruiter_profile', QA_RECRUITER, false);
    expect((await listVisibleOpps(PLAIN_DRIVER)).sort()).toEqual(baselineVisibleOpps);
    expect(await canAccess(PLAIN_DRIVER, QA_OPP, QA_RECRUITER)).toBe(true);
    await clearRoots();
  });
});

describe('agency fixture isolation', () => {
  it('hides an active QA agency from anonymous get_agency_public_view', async () => {
    await clearRoots();
    await registerRoot('agency_profile', QA_AGENCY);
    const rows = await asRole(null, 'anon', async (c) =>
      (await c.query(`SELECT id FROM public.get_agency_public_view($1)`, [QA_AGENCY])).rows,
    );
    expect(rows).toEqual([]);
  });

  it('hides its packages from anonymous list_agency_packages_public', async () => {
    const rows = await asRole(null, 'anon', async (c) =>
      (await c.query(`SELECT id FROM public.list_agency_packages_public($1)`, [QA_AGENCY])).rows,
    );
    expect(rows).toEqual([]);
  });

  it('hides its slug from anonymous resolve_agency_slug', async () => {
    const id = await asRole(null, 'anon', async (c) =>
      (await c.query(`SELECT public.resolve_agency_slug('qa-agency') AS id`)).rows[0].id,
    );
    expect(id).toBeNull();
  });

  it('lets the matching QA owner use all three public agency functions', async () => {
    await asRole(OWNER, 'authenticated', async (c) => {
      const view = await c.query(`SELECT id FROM public.get_agency_public_view($1)`, [QA_AGENCY]);
      expect(view.rows.map((r) => r.id)).toEqual([QA_AGENCY]);
      const pkgs = await c.query(`SELECT id FROM public.list_agency_packages_public($1)`, [QA_AGENCY]);
      expect(pkgs.rows).toHaveLength(1);
      const slug = await c.query(`SELECT public.resolve_agency_slug('qa-agency') AS id`);
      expect(slug.rows[0].id).toBe(QA_AGENCY);
    });
  });

  it('leaves non-fixture agency behavior unchanged for anonymous callers', async () => {
    await asRole(null, 'anon', async (c) => {
      const view = await c.query(`SELECT id FROM public.get_agency_public_view($1)`, [REAL_AGENCY]);
      expect(view.rows.map((r) => r.id)).toEqual([REAL_AGENCY]);
      const pkgs = await c.query(`SELECT id FROM public.list_agency_packages_public($1)`, [REAL_AGENCY]);
      expect(pkgs.rows).toHaveLength(1);
      const slug = await c.query(`SELECT public.resolve_agency_slug('real-agency') AS id`);
      expect(slug.rows[0].id).toBe(REAL_AGENCY);
    });
    await clearRoots();
  });
});

describe('leaderboard fixture isolation', () => {
  it('excludes an active QA user root from a normal driver ranking and rank math', async () => {
    await clearRoots();
    await registerRoot('user', QA_USER);
    const rows = await leaderboard(PLAIN_DRIVER);
    expect(rows.map((r) => r.user_id)).toEqual([PLAIN_DRIVER, OTHER_DRIVER]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it('shows the registered synthetic QA user to the matching QA owner', async () => {
    const rows = await leaderboard(OWNER);
    expect(rows.map((r) => r.user_id)).toEqual([PLAIN_DRIVER, QA_USER, OTHER_DRIVER]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('restores normal behavior once the QA user root is revoked', async () => {
    await registerRoot('user', QA_USER, false);
    expect(await leaderboard(PLAIN_DRIVER)).toEqual(baselineLeaderboard);
    await clearRoots();
  });
});

describe('cleanup', () => {
  it('leaves no fixture or referral residue', async () => {
    await clearRoots();
    const roots = await pool.query(`SELECT count(*)::int AS n FROM public.qa_fixture_roots`);
    const refs = await pool.query(`SELECT count(*)::int AS n FROM public.driver_referrals`);
    expect(roots.rows[0].n).toBe(0);
    expect(refs.rows[0].n).toBe(0);
  });
});
