/**
 * Phase RB-3A-0A — Real PostgreSQL gate for the canonical opportunity
 * CREATION boundary (`public.create_recruiter_opportunity`).
 *
 * This suite does NOT assert on source strings for authorization. It boots a
 * schema-faithful fixture against a real PostgreSQL instance, installs the
 * CURRENT LIVE definitions (captured verbatim from the production database
 * via pg_get_functiondef) of the entire authorization + entitlement chain:
 *
 *   auth.uid()                                        (PostgREST GUC semantics)
 *   public.is_admin / is_super_admin
 *   public._owner_qa_persona_for
 *   public.recruiter_profile_can_manage_opportunities
 *   public.current_user_can_manage_recruiter_opportunities
 *   public.is_recruiter_workspace_owner
 *   public.recruiter_team_occupied_seats / recruiter_team_seat_limit
 *   public.recruiter_team_workspace_within_limit
 *   public.current_user_has_recruiter_permission
 *   public.current_user_can_recruiter_opportunity_action
 *   public.effective_recruiter_tier
 *   public.effective_recruiter_active_opportunity_limit
 *   public.opportunities_billing_guard  (+ BEFORE INSERT/UPDATE trigger)
 *
 * ...plus the real `public.opportunities` column set (all 66 columns with live
 * types, nullability and defaults), the real insert RLS policy, and the real
 * role grants. The RB-3A-0A candidate migration is then loaded FROM DISK and
 * applied, and every authorization/validation claim is proven by executing
 * the function under real roles (anon / authenticated / service_role) with
 * `SET LOCAL ROLE` + `request.jwt.claim.sub`, exactly as PostgREST does.
 *
 * The suite hard-fails without RB3A0A_DATABASE_URL; it never skips.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.RB3A0A_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'RB3A0A_DATABASE_URL is required for the Phase RB-3A-0A real-PostgreSQL gate. ' +
      'This suite must never be skipped.',
  );
}

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CANDIDATE_PATH =
  REPO_ROOT +
  'supabase/migration-candidates/20260921050000_phase_rb3a0a_canonical_opportunity_creation.sql';
const CANDIDATE_SQL = readFileSync(CANDIDATE_PATH, 'utf8');

if (!CANDIDATE_SQL.includes('CREATE OR REPLACE FUNCTION public.create_recruiter_opportunity(')) {
  throw new Error('Candidate migration does not define create_recruiter_opportunity.');
}

/** Columns of public.opportunities that are server-managed and never writable. */
const SYSTEM_COLUMNS = [
  'id',
  'recruiter_id',
  'admin_review_status',
  'featured',
  'view_count',
  'created_at',
  'updated_at',
  'published_at',
] as const;

// ---------------------------------------------------------------------------
// Fixture SQL
// ---------------------------------------------------------------------------

const BOOTSTRAP_SQL = `
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT anon, authenticated, service_role TO CURRENT_USER;

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- PostgREST identity semantics.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $fn$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;

DO $$ BEGIN
  CREATE TYPE public.recruiter_workspace_permission AS ENUM (
    'opportunities_view','opportunities_create','opportunities_edit',
    'opportunities_change_status','opportunities_delete','applications_view',
    'applications_manage_status','applications_request_contact',
    'applications_manage_notes','contracts_view','contracts_manage',
    'referrals_view','referrals_manage_status','referral_terms_manage',
    'reports_view','reports_export','settlements_view','settlements_prepare',
    'settlements_finalize','team_view','team_manage','loads_view',
    'loads_dispatch','loads_update_status','conversations_view',
    'conversations_reply'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.admin_users (
  user_id uuid PRIMARY KEY,
  role text NOT NULL DEFAULT 'admin'
);

CREATE TABLE public.owner_qa_sessions (
  user_id uuid NOT NULL,
  domain text NOT NULL,
  persona text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL
);

CREATE TABLE public.qa_fixture_roots (
  root_kind text NOT NULL,
  root_id uuid NOT NULL,
  qa_owner_user_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  revoked_at timestamptz
);

CREATE TABLE public.recruiter_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  verification_status text NOT NULL DEFAULT 'verified',
  recruiter_name text,
  company_name text,
  recruiter_email text,
  company_type text,
  dot_number text,
  mc_number text,
  posting_terms_accepted_at timestamptz,
  legacy_terms_grandfathered_at timestamptz
);

CREATE TABLE public.recruiter_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL,
  member_user_id uuid,
  role text NOT NULL DEFAULT 'recruiter_staff',
  status text NOT NULL DEFAULT 'active',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  invite_expires_at timestamptz
);

CREATE TABLE public.recruiter_billing_profiles (
  recruiter_id uuid NOT NULL,
  user_id uuid NOT NULL,
  plan text,
  status text
);

CREATE TABLE public.agency_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL
);
CREATE TABLE public.agency_members (
  agency_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  role text NOT NULL,
  status text NOT NULL
);
CREATE TABLE public.agency_entitlements (
  agency_id uuid NOT NULL,
  plan_key text NOT NULL,
  source text NOT NULL,
  status text NOT NULL
);

-- Live column set of public.opportunities (types, nullability, defaults
-- captured verbatim from production information_schema).
CREATE TABLE public.opportunities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recruiter_id uuid NOT NULL,
  title text NOT NULL,
  company_name text NOT NULL,
  hiring_city text,
  hiring_state text,
  hiring_states text[] NOT NULL DEFAULT '{}'::text[],
  driver_type text,
  route_type text,
  trailer_type text,
  pay_model text,
  cpm numeric,
  percentage_pay numeric,
  flat_weekly_pay numeric,
  estimated_weekly_gross numeric,
  estimated_weekly_miles numeric,
  estimated_loaded_miles numeric,
  estimated_deadhead_miles numeric,
  deadhead_paid boolean,
  detention_pay text,
  layover_pay text,
  sign_on_bonus numeric,
  fuel_paid_by text,
  insurance_deductions numeric,
  escrow_required boolean NOT NULL DEFAULT false,
  escrow_amount numeric,
  lease_payment numeric,
  maintenance_deductions numeric,
  other_deductions numeric,
  home_time text,
  forced_dispatch boolean,
  pets_allowed boolean,
  riders_allowed boolean,
  equipment_year text,
  benefits text,
  description text,
  transparency_confirmed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft'::text,
  admin_review_status text NOT NULL DEFAULT 'pending'::text,
  featured boolean NOT NULL DEFAULT false,
  view_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  canonical_version smallint,
  employment_model text,
  team_configuration text,
  percentage_basis_label text,
  percentage_weekly_revenue_basis numeric,
  salary_amount numeric,
  salary_frequency text,
  mixed_pay_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  other_pay_method_label text,
  other_weekly_gross numeric,
  insurance_deduction_frequency text,
  escrow_required_state text,
  escrow_amount_frequency text,
  lease_payment_frequency text,
  maintenance_deduction_frequency text,
  other_deduction_frequency text,
  typical_lanes text,
  requirements text,
  actual_benefits text,
  min_years_experience numeric,
  required_cdl_class text,
  required_endorsements text[] NOT NULL DEFAULT '{}'::text[]
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunities TO authenticated;
GRANT ALL ON public.opportunities TO service_role;
GRANT SELECT ON public.opportunities TO anon;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

-- Live insert policy.
CREATE POLICY "Recruiter inserts own opportunities"
ON public.opportunities FOR INSERT TO authenticated
WITH CHECK (public.current_user_can_recruiter_opportunity_action(
  recruiter_id, 'opportunities_create'::public.recruiter_workspace_permission));

CREATE POLICY "Recruiter reads own opportunities"
ON public.opportunities FOR SELECT TO authenticated
USING (public.current_user_can_recruiter_opportunity_action(
  recruiter_id, 'opportunities_view'::public.recruiter_workspace_permission));
`;

/**
 * Verbatim live definitions (pg_get_functiondef output) of the authorization
 * and entitlement chain. Any drift from production would make these fail to
 * install or behave differently, which is exactly what we want to detect.
 */
const LIVE_FUNCTIONS_SQL = `
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = _user_id)
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = _user_id AND role = 'super_admin')
$function$;

CREATE OR REPLACE FUNCTION public._owner_qa_persona_for(_user_id uuid)
 RETURNS TABLE(domain text, persona text, expires_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
  SELECT s.domain, s.persona, s.expires_at
  FROM public.owner_qa_sessions s
  WHERE _user_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND _user_id = auth.uid()
    AND public.is_super_admin(auth.uid())
    AND s.user_id = _user_id
    AND s.enabled = true
    AND s.expires_at > now()
$function$;

CREATE OR REPLACE FUNCTION public.recruiter_profile_can_manage_opportunities(_recruiter_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
      AND rp.company_type IN ('carrier','third_party_recruiter','staffing_agency','independent_recruiter')
      AND (rp.company_type <> 'carrier' OR (COALESCE(btrim(rp.dot_number), '') <> '' OR COALESCE(btrim(rp.mc_number), '') <> ''))
      AND (rp.posting_terms_accepted_at IS NOT NULL OR rp.legacy_terms_grandfathered_at IS NOT NULL)
  );
$function$;

CREATE OR REPLACE FUNCTION public.current_user_can_manage_recruiter_opportunities(_recruiter_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter_id
      AND rp.user_id = auth.uid()
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
      AND COALESCE(btrim(rp.recruiter_name), '') <> ''
      AND COALESCE(btrim(rp.company_name), '')   <> ''
      AND COALESCE(btrim(rp.recruiter_email), '') <> ''
      AND btrim(rp.recruiter_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
      AND rp.company_type IN ('carrier','third_party_recruiter','staffing_agency','independent_recruiter')
      AND (rp.company_type <> 'carrier' OR (COALESCE(btrim(rp.dot_number), '') <> '' OR COALESCE(btrim(rp.mc_number), '') <> ''))
      AND (rp.posting_terms_accepted_at IS NOT NULL OR rp.legacy_terms_grandfathered_at IS NOT NULL)
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_recruiter_workspace_owner(_recruiter_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE rp.id=_recruiter_id AND rp.user_id=auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.recruiter_team_occupied_seats(_recruiter_id uuid)
 RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _used integer;
BEGIN
  IF _recruiter_id IS NULL THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recruiter_profiles rp WHERE rp.id = _recruiter_id) THEN RETURN 0; END IF;
  SELECT count(*)::integer INTO _used
  FROM public.recruiter_members m
  WHERE m.recruiter_id = _recruiter_id
    AND m.role <> 'recruiter_owner'
    AND (m.status='active' OR (m.status='pending' AND m.invite_expires_at IS NOT NULL AND m.invite_expires_at > now()));
  RETURN 1 + COALESCE(_used,0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.effective_recruiter_tier(_recruiter_id uuid)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _owner_id       uuid;
  _recruiter_tier text := NULL;
  _agency_tier    text := NULL;
  _qa_persona     text := NULL;
BEGIN
  IF _recruiter_id IS NULL THEN RETURN 'free_standard'; END IF;
  SELECT rp.user_id INTO _owner_id FROM public.recruiter_profiles rp WHERE rp.id = _recruiter_id;
  IF _owner_id IS NULL THEN RETURN 'free_standard'; END IF;
  IF _owner_id = auth.uid() THEN
    SELECT q.persona INTO _qa_persona FROM public._owner_qa_persona_for(auth.uid()) q WHERE q.domain = 'recruiter';
    IF _qa_persona IS NOT NULL THEN
      IF _qa_persona = 'free_verified' THEN RETURN 'free_standard'; END IF;
      RETURN _qa_persona;
    END IF;
  END IF;
  SELECT b.plan INTO _recruiter_tier
  FROM public.recruiter_billing_profiles b
  WHERE b.recruiter_id = _recruiter_id
    AND b.plan IN ('starter', 'growth', 'fleet')
    AND b.status IN ('active', 'trialing')
  ORDER BY CASE b.plan WHEN 'fleet' THEN 3 WHEN 'growth' THEN 2 WHEN 'starter' THEN 1 ELSE 0 END DESC
  LIMIT 1;
  SELECT CASE ae.plan_key
           WHEN 'agency_starter' THEN 'starter'
           WHEN 'agency_team'    THEN 'growth'
           WHEN 'agency_growth'  THEN 'fleet'
         END
    INTO _agency_tier
  FROM public.agency_profiles ap
  JOIN public.agency_members am ON am.agency_id = ap.id AND am.member_user_id = _owner_id
    AND am.role::text = 'agency_owner' AND am.status::text = 'active'
  JOIN public.agency_entitlements ae ON ae.agency_id = ap.id
  WHERE ap.owner_user_id = _owner_id
    AND ae.plan_key IN ('agency_starter', 'agency_team', 'agency_growth')
    AND ae.source IN ('stripe', 'manual', 'admin_seed')
    AND ae.status IN ('active', 'trialing')
  ORDER BY CASE ae.plan_key WHEN 'agency_growth' THEN 3 WHEN 'agency_team' THEN 2 WHEN 'agency_starter' THEN 1 ELSE 0 END DESC
  LIMIT 1;
  IF _recruiter_tier IS NOT NULL AND _agency_tier IS NOT NULL THEN RETURN 'conflict'; END IF;
  RETURN COALESCE(_recruiter_tier, _agency_tier, 'free_standard');
END;
$function$;

CREATE OR REPLACE FUNCTION public.recruiter_team_seat_limit(_recruiter_id uuid)
 RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _owner_id uuid;
  _plan text;
  _qa_persona text;
BEGIN
  IF _recruiter_id IS NULL THEN RETURN 0; END IF;
  SELECT rp.user_id INTO _owner_id FROM public.recruiter_profiles rp WHERE rp.id = _recruiter_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF auth.uid() IS NOT NULL
     AND public.is_super_admin(auth.uid())
     AND EXISTS (
       SELECT 1 FROM public.qa_fixture_roots r
       WHERE r.root_kind = 'recruiter_profile' AND r.root_id = _recruiter_id
         AND r.qa_owner_user_id = auth.uid() AND r.active AND r.revoked_at IS NULL
     )
  THEN
    SELECT q.persona INTO _qa_persona FROM public._owner_qa_persona_for(auth.uid()) q WHERE q.domain = 'recruiter';
    IF _qa_persona IS NOT NULL THEN
      RETURN CASE _qa_persona WHEN 'free_verified' THEN 1 WHEN 'starter' THEN 2 WHEN 'growth' THEN 5 WHEN 'fleet' THEN 15 ELSE 1 END;
    END IF;
  END IF;
  IF public.effective_recruiter_tier(_recruiter_id) = 'conflict' THEN RETURN 1; END IF;
  SELECT b.plan INTO _plan
  FROM public.recruiter_billing_profiles b
  WHERE b.recruiter_id = _recruiter_id AND b.user_id = _owner_id
    AND b.plan IN ('starter','growth','fleet') AND b.status IN ('active','trialing')
  ORDER BY CASE b.plan WHEN 'fleet' THEN 3 WHEN 'growth' THEN 2 WHEN 'starter' THEN 1 ELSE 0 END DESC
  LIMIT 1;
  RETURN CASE _plan WHEN 'starter' THEN 2 WHEN 'growth' THEN 5 WHEN 'fleet' THEN 15 ELSE 1 END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recruiter_team_workspace_within_limit(_recruiter_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _limit integer; _occupied integer;
BEGIN
  IF _recruiter_id IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recruiter_profiles rp WHERE rp.id = _recruiter_id) THEN RETURN false; END IF;
  _limit := public.recruiter_team_seat_limit(_recruiter_id);
  _occupied := public.recruiter_team_occupied_seats(_recruiter_id);
  IF _limit IS NULL OR _limit < 1 THEN RETURN false; END IF;
  RETURN _occupied <= _limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_user_has_recruiter_permission(_recruiter_id uuid, _permission recruiter_workspace_permission)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND _recruiter_id IS NOT NULL AND _permission IS NOT NULL AND (
    public.is_recruiter_workspace_owner(_recruiter_id)
    OR (
      public.recruiter_team_workspace_within_limit(_recruiter_id)
      AND EXISTS (
        SELECT 1 FROM public.recruiter_members m
        WHERE m.recruiter_id=_recruiter_id
          AND m.member_user_id=auth.uid()
          AND m.status='active'
          AND jsonb_typeof(m.permissions)='object'
          AND (m.permissions -> (_permission::text)) = to_jsonb(true)
      )
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_opportunity_action(_recruiter_id uuid, _permission recruiter_workspace_permission)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND _recruiter_id IS NOT NULL
    AND _permission IS NOT NULL
    AND _permission IN (
      'opportunities_view'::public.recruiter_workspace_permission,
      'opportunities_create'::public.recruiter_workspace_permission,
      'opportunities_edit'::public.recruiter_workspace_permission,
      'opportunities_change_status'::public.recruiter_workspace_permission,
      'opportunities_delete'::public.recruiter_workspace_permission
    )
    AND (
      public.current_user_can_manage_recruiter_opportunities(_recruiter_id)
      OR (
        public.recruiter_profile_can_manage_opportunities(_recruiter_id)
        AND public.current_user_has_recruiter_permission(_recruiter_id, _permission)
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.effective_recruiter_active_opportunity_limit(_recruiter_id uuid)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE public.effective_recruiter_tier(_recruiter_id)
    WHEN 'conflict'      THEN 0
    WHEN 'free_standard' THEN 1
    WHEN 'starter'       THEN 5
    WHEN 'growth'        THEN 15
    WHEN 'fleet'         THEN 25
    ELSE 0
  END
$function$;

CREATE OR REPLACE FUNCTION public.opportunities_billing_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _lock_namespace     constant integer := 1971001;
  _limit              integer;
  _active_count       integer;
  _is_becoming_active boolean := false;
  _authorized         boolean;
  _qa_recruiter_self  boolean := false;
BEGIN
  IF public.is_admin(auth.uid()) THEN
    _qa_recruiter_self := (
      public.is_super_admin(auth.uid())
      AND EXISTS (SELECT 1 FROM public._owner_qa_persona_for(auth.uid()) q WHERE q.domain = 'recruiter')
      AND EXISTS (SELECT 1 FROM public.recruiter_profiles rp WHERE rp.id = NEW.recruiter_id AND rp.user_id = auth.uid())
    );
    IF NOT _qa_recruiter_self THEN RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    _authorized := public.current_user_can_recruiter_opportunity_action(
      NEW.recruiter_id, 'opportunities_create'::public.recruiter_workspace_permission);
  ELSE
    _authorized := public.current_user_can_recruiter_opportunity_action(
      NEW.recruiter_id, 'opportunities_edit'::public.recruiter_workspace_permission
    ) OR public.current_user_can_recruiter_opportunity_action(
      NEW.recruiter_id, 'opportunities_change_status'::public.recruiter_workspace_permission);
  END IF;

  IF NOT _authorized THEN
    RAISE EXCEPTION 'Complete your recruiter profile to publish opportunities.' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    _is_becoming_active := (NEW.status = 'active');
  ELSIF TG_OP = 'UPDATE' THEN
    _is_becoming_active := (NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active');
  END IF;

  IF NOT _is_becoming_active THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(_lock_namespace, hashtext(NEW.recruiter_id::text));

  _limit := public.effective_recruiter_active_opportunity_limit(NEW.recruiter_id);

  IF _limit IS NULL OR _limit <= 0 THEN
    RAISE EXCEPTION 'Active opportunity activation is blocked.'
      USING ERRCODE = '23514', DETAIL = '{"code": "business_entitlement_conflict"}';
  END IF;

  SELECT COUNT(*)::int INTO _active_count
  FROM public.opportunities o
  WHERE o.recruiter_id = NEW.recruiter_id AND o.status = 'active' AND o.id IS DISTINCT FROM NEW.id;

  IF _active_count >= _limit THEN
    RAISE EXCEPTION 'Active opportunity limit reached.'
      USING ERRCODE = '23514',
            DETAIL  = json_build_object('code','active_opportunity_limit_reached','limit',_limit,'active_count',_active_count)::text;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_opportunities_billing_guard
BEFORE INSERT OR UPDATE ON public.opportunities
FOR EACH ROW EXECUTE FUNCTION public.opportunities_billing_guard();
`;

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------
const OWNER_USER = '11111111-1111-4111-8111-111111111111';
const OTHER_OWNER_USER = '22222222-2222-4222-8222-222222222222';
const STAFF_USER = '33333333-3333-4333-8333-333333333333';
const STAFF_NO_PERM_USER = '44444444-4444-4444-8444-444444444444';
const OUTSIDER_USER = '55555555-5555-4555-8555-555555555555';

const RECRUITER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECRUITER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RECRUITER_SUSPENDED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RECRUITER_INCOMPLETE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const SEED_SQL = `
INSERT INTO public.recruiter_profiles
  (id, user_id, status, verification_status, recruiter_name, company_name,
   recruiter_email, company_type, dot_number, posting_terms_accepted_at)
VALUES
  ('${RECRUITER_A}', '${OWNER_USER}', 'active', 'verified', 'Owner A', 'Carrier A',
   'a@example.com', 'carrier', 'DOT123', now()),
  ('${RECRUITER_B}', '${OTHER_OWNER_USER}', 'active', 'verified', 'Owner B', 'Carrier B',
   'b@example.com', 'carrier', 'DOT456', now()),
  ('${RECRUITER_SUSPENDED}', '${OWNER_USER}', 'suspended', 'verified', 'Owner A', 'Carrier A',
   'a@example.com', 'carrier', 'DOT123', now());

-- Incomplete: no posting terms accepted, no DOT/MC.
INSERT INTO public.recruiter_profiles
  (id, user_id, status, verification_status, recruiter_name, company_name,
   recruiter_email, company_type)
VALUES
  ('${RECRUITER_INCOMPLETE}', '${OWNER_USER}', 'active', 'verified', 'Owner A', 'Carrier A',
   'a@example.com', 'carrier');

INSERT INTO public.recruiter_members (recruiter_id, member_user_id, role, status, permissions)
VALUES
  ('${RECRUITER_A}', '${STAFF_USER}', 'recruiter_staff', 'active',
   '{"opportunities_create": true, "opportunities_view": true}'::jsonb),
  ('${RECRUITER_A}', '${STAFF_NO_PERM_USER}', 'recruiter_staff', 'active',
   '{"opportunities_view": true}'::jsonb);
`;

const MINIMAL_PAYLOAD = { title: 'Regional Dry Van', company_name: 'Carrier A' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let pool: Pool;

async function asRole<T>(
  role: 'anon' | 'authenticated' | 'service_role',
  userId: string | null,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(
      `SELECT set_config('request.jwt.claim.sub', $1, true)`,
      [userId ?? ''],
    );
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function callCreate(
  client: PoolClient,
  recruiterId: string | null,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const res = await client.query(
    'SELECT public.create_recruiter_opportunity($1::uuid, $2::jsonb) AS out',
    [recruiterId, JSON.stringify(payload)],
  );
  return res.rows[0].out as Record<string, unknown>;
}

async function expectFailure(
  role: 'anon' | 'authenticated' | 'service_role',
  userId: string | null,
  recruiterId: string | null,
  payload: unknown,
): Promise<{ message: string; code: string }> {
  try {
    await asRole(role, userId, (c) => callCreate(c, recruiterId, payload));
  } catch (e) {
    const err = e as { message: string; code: string };
    return { message: err.message, code: err.code };
  }
  throw new Error('Expected create_recruiter_opportunity to fail, but it succeeded.');
}

async function countOpportunities(): Promise<number> {
  const res = await pool.query('SELECT count(*)::int AS n FROM public.opportunities');
  return res.rows[0].n as number;
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 6 });
  await pool.query(BOOTSTRAP_SQL);
  await pool.query(LIVE_FUNCTIONS_SQL);
  await pool.query(CANDIDATE_SQL);
  await pool.query(SEED_SQL);
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe('RB-3A-0A — function shape and grants', () => {
  it('exposes exactly one create_recruiter_opportunity with no actor parameter', async () => {
    const res = await pool.query(`
      SELECT pg_get_function_identity_arguments(p.oid) AS args,
             p.prosecdef, p.provolatile, p.proconfig, l.lanname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname='public' AND p.proname='create_recruiter_opportunity'
    `);
    expect(res.rowCount).toBe(1);
    // No delegated-actor overload exists in this phase.
    expect(res.rows[0].args).toBe('_recruiter_id uuid, _payload jsonb');
    expect(res.rows[0].prosecdef).toBe(true);
    expect(res.rows[0].provolatile).toBe('v');
    expect(res.rows[0].lanname).toBe('plpgsql');
    expect(res.rows[0].proconfig).toEqual(['search_path=public']);
  });

  it('grants EXECUTE to authenticated only — never PUBLIC, anon, or service_role', async () => {
    const res = await pool.query(`
      SELECT
        has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
        has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc,
        p.proacl::text AS acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='create_recruiter_opportunity'
    `);
    expect(res.rows[0].authed).toBe(true);
    expect(res.rows[0].anon).toBe(false);
    expect(res.rows[0].svc).toBe(false);
    expect(res.rows[0].acl).not.toMatch(/(^|,)=X/); // no PUBLIC execute
  });

  it('whitelists exactly the writable columns of public.opportunities', async () => {
    const cols = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='opportunities'
      ORDER BY ordinal_position
    `);
    const all = cols.rows.map((r) => r.column_name as string);
    const expected = all.filter((c) => !SYSTEM_COLUMNS.includes(c as never));

    const block = CANDIDATE_SQL.split('v_allowed CONSTANT text[] := ARRAY[')[1];
    expect(block).toBeTruthy();
    const listed = [...block.split('];')[0].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);

    expect([...listed].sort()).toEqual([...expected].sort());
    expect(listed.length).toBe(58);
    expect(new Set(listed).size).toBe(listed.length);
    for (const sys of SYSTEM_COLUMNS) expect(listed).not.toContain(sys);
  });
});

describe('RB-3A-0A — authorization (real roles, real predicates)', () => {
  it('1. anon execution is denied', async () => {
    const before = await countOpportunities();
    const err = await expectFailure('anon', null, RECRUITER_A, MINIMAL_PAYLOAD);
    expect(err.code).toBe('42501');
    expect(await countOpportunities()).toBe(before);
  });

  it('1b. a session with no auth.uid() is denied even as authenticated', async () => {
    const err = await expectFailure('authenticated', null, RECRUITER_A, MINIMAL_PAYLOAD);
    expect(err.message).toContain('not_authenticated');
  });

  it('2. eligible owner recruiter creates for their own workspace', async () => {
    const out = await asRole('authenticated', OWNER_USER, (c) =>
      callCreate(c, RECRUITER_A, { ...MINIMAL_PAYLOAD, title: 'Owner create' }),
    );
    expect(out.result_code).toBe('created');
    expect(typeof out.opportunity_id).toBe('string');
    expect(out.status).toBe('draft');
    expect(out.title).toBe('Owner create');
  });

  it('3. a caller cannot create for a recruiter workspace they do not control', async () => {
    const before = await countOpportunities();
    const err = await expectFailure('authenticated', OWNER_USER, RECRUITER_B, MINIMAL_PAYLOAD);
    expect(err.message).toContain('permission_denied');
    expect(await countOpportunities()).toBe(before);
  });

  it('3b. an unrelated authenticated user is denied', async () => {
    const err = await expectFailure('authenticated', OUTSIDER_USER, RECRUITER_A, MINIMAL_PAYLOAD);
    expect(err.message).toContain('permission_denied');
  });

  it('4. staff WITH opportunities_create succeed; staff WITHOUT it are denied', async () => {
    const ok = await asRole('authenticated', STAFF_USER, (c) =>
      callCreate(c, RECRUITER_A, { ...MINIMAL_PAYLOAD, title: 'Staff create' }),
    );
    expect(ok.result_code).toBe('created');

    const err = await expectFailure('authenticated', STAFF_NO_PERM_USER, RECRUITER_A, MINIMAL_PAYLOAD);
    expect(err.message).toContain('permission_denied');
  });

  it('4b. permission revoked mid-flight fails closed on the next call', async () => {
    await pool.query(
      `UPDATE public.recruiter_members SET status='revoked' WHERE member_user_id=$1`,
      [STAFF_USER],
    );
    const err = await expectFailure('authenticated', STAFF_USER, RECRUITER_A, MINIMAL_PAYLOAD);
    expect(err.message).toContain('permission_denied');
    await pool.query(
      `UPDATE public.recruiter_members SET status='active' WHERE member_user_id=$1`,
      [STAFF_USER],
    );
  });

  it('5. suspended and incomplete recruiter profiles are denied', async () => {
    const suspended = await expectFailure('authenticated', OWNER_USER, RECRUITER_SUSPENDED, MINIMAL_PAYLOAD);
    expect(suspended.message).toContain('permission_denied');

    const incomplete = await expectFailure('authenticated', OWNER_USER, RECRUITER_INCOMPLETE, MINIMAL_PAYLOAD);
    expect(incomplete.message).toContain('permission_denied');
  });

  it('5b. a null recruiter id is rejected before any write', async () => {
    const err = await expectFailure('authenticated', OWNER_USER, null, MINIMAL_PAYLOAD);
    expect(err.message).toContain('invalid_payload');
  });

  it('6/7. service_role cannot execute: no delegated-actor path exists in this phase', async () => {
    const err = await expectFailure('service_role', OWNER_USER, RECRUITER_A, MINIMAL_PAYLOAD);
    expect(err.code).toBe('42501');
  });
});

describe('RB-3A-0A — payload whitelist and defaults', () => {
  it('rejects any field outside the whitelist and writes nothing', async () => {
    const before = await countOpportunities();
    const err = await expectFailure('authenticated', OWNER_USER, RECRUITER_A, {
      ...MINIMAL_PAYLOAD,
      totally_made_up: 'x',
    });
    expect(err.message).toContain('unknown_field');
    expect(await countOpportunities()).toBe(before);
  });

  it('rejects every server-managed column as an unknown field', async () => {
    for (const sys of SYSTEM_COLUMNS) {
      const err = await expectFailure('authenticated', OWNER_USER, RECRUITER_A, {
        ...MINIMAL_PAYLOAD,
        [sys]: sys === 'view_count' ? 999 : '00000000-0000-4000-8000-000000000000',
      });
      expect(err.message).toContain('unknown_field');
    }
  });

  it('applies exact column defaults for absent NOT NULL fields', async () => {
    const out = await asRole('authenticated', OWNER_USER, (c) =>
      callCreate(c, RECRUITER_A, { ...MINIMAL_PAYLOAD, title: 'Defaults' }),
    );
    const row = await pool.query(
      `SELECT hiring_states, escrow_required, transparency_confirmed, status,
              mixed_pay_components, required_endorsements,
              admin_review_status, featured, view_count, published_at,
              hiring_city, cpm
       FROM public.opportunities WHERE id = $1`,
      [out.opportunity_id],
    );
    const r = row.rows[0];
    expect(r.hiring_states).toEqual([]);
    expect(r.escrow_required).toBe(false);
    expect(r.transparency_confirmed).toBe(false);
    expect(r.status).toBe('draft');
    expect(r.mixed_pay_components).toEqual([]);
    expect(r.required_endorsements).toEqual([]);
    // Server-managed columns keep their own defaults.
    expect(r.admin_review_status).toBe('pending');
    expect(r.featured).toBe(false);
    expect(r.view_count).toBe(0);
    expect(r.published_at).toBeNull();
    // Nullable columns stay NULL.
    expect(r.hiring_city).toBeNull();
    expect(r.cpm).toBeNull();
  });

  it('persists supplied values with exact types and preserves explicit nulls', async () => {
    const out = await asRole('authenticated', OWNER_USER, (c) =>
      callCreate(c, RECRUITER_A, {
        title: 'Typed',
        company_name: 'Carrier A',
        hiring_city: 'Dallas',
        hiring_states: ['TX', 'OK'],
        cpm: 0.62,
        deadhead_paid: true,
        canonical_version: 2,
        mixed_pay_components: [{ kind: 'cpm', value: 0.62 }],
        required_endorsements: ['hazmat'],
        hiring_state: null,
      }),
    );
    const row = await pool.query(
      `SELECT hiring_city, hiring_states, cpm, deadhead_paid, canonical_version,
              mixed_pay_components, required_endorsements, hiring_state
       FROM public.opportunities WHERE id = $1`,
      [out.opportunity_id],
    );
    const r = row.rows[0];
    expect(r.hiring_city).toBe('Dallas');
    expect(r.hiring_states).toEqual(['TX', 'OK']);
    expect(Number(r.cpm)).toBeCloseTo(0.62, 5);
    expect(r.deadhead_paid).toBe(true);
    expect(r.canonical_version).toBe(2);
    expect(r.mixed_pay_components).toEqual([{ kind: 'cpm', value: 0.62 }]);
    expect(r.required_endorsements).toEqual(['hazmat']);
    expect(r.hiring_state).toBeNull();
  });

  it('always binds recruiter_id to the validated argument', async () => {
    const out = await asRole('authenticated', STAFF_USER, (c) =>
      callCreate(c, RECRUITER_A, { ...MINIMAL_PAYLOAD, title: 'Bound' }),
    );
    const row = await pool.query('SELECT recruiter_id FROM public.opportunities WHERE id=$1', [
      out.opportunity_id,
    ]);
    expect(row.rows[0].recruiter_id).toBe(RECRUITER_A);
  });
});

describe('RB-3A-0A — existing guards still run through the RPC', () => {
  it('8. the server-side active opportunity limit is enforced', async () => {
    // Free standard tier => effective_recruiter_active_opportunity_limit = 1.
    const limit = await pool.query(
      'SELECT public.effective_recruiter_active_opportunity_limit($1::uuid) AS n',
      [RECRUITER_A],
    );
    expect(limit.rows[0].n).toBe(1);

    await pool.query(`DELETE FROM public.opportunities WHERE recruiter_id=$1`, [RECRUITER_A]);

    const first = await asRole('authenticated', OWNER_USER, (c) =>
      callCreate(c, RECRUITER_A, { ...MINIMAL_PAYLOAD, title: 'Active 1', status: 'active' }),
    );
    expect(first.status).toBe('active');

    const before = await countOpportunities();
    const err = await expectFailure('authenticated', OWNER_USER, RECRUITER_A, {
      ...MINIMAL_PAYLOAD,
      title: 'Active 2',
      status: 'active',
    });
    expect(err.message).toContain('Active opportunity limit reached.');
    expect(err.code).toBe('23514');
    expect(await countOpportunities()).toBe(before);
  });

  it('8b. a paid tier raises the limit through the same path', async () => {
    await pool.query(
      `INSERT INTO public.recruiter_billing_profiles (recruiter_id, user_id, plan, status)
       VALUES ($1, $2, 'starter', 'active')`,
      [RECRUITER_A, OWNER_USER],
    );
    const out = await asRole('authenticated', OWNER_USER, (c) =>
      callCreate(c, RECRUITER_A, { ...MINIMAL_PAYLOAD, title: 'Active 2', status: 'active' }),
    );
    expect(out.status).toBe('active');
    await pool.query(`DELETE FROM public.recruiter_billing_profiles WHERE recruiter_id=$1`, [
      RECRUITER_A,
    ]);
  });

  it('NOT NULL validation still rejects a missing title deterministically', async () => {
    const err = await expectFailure('authenticated', OWNER_USER, RECRUITER_A, {
      company_name: 'Carrier A',
    });
    expect(err.code).toBe('23502');
  });
});
