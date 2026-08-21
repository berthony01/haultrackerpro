/**
 * Phase TG-2E3-O8 — Real PostgreSQL gate for the Owner QA cross-workspace
 * entitlement completion candidate.
 *
 * Applies a production-faithful scaffold carrying the PRE-O8 (live) bodies of
 * every function O8 touches or depends on, then the accepted O2 Owner QA
 * candidate, the accepted O6 fixture-root registry and the accepted O7
 * isolation candidate. Snapshots the full object inventory, the four
 * allowlisted function contracts, the O6 helper ACL, the O2 neighbours and the
 * O7 seven. Then applies the O8 candidate and proves it replaces exactly the
 * four allowlisted bodies, adds no object, broadens no privilege, and only
 * substitutes EFFECTIVE plan evaluation for registered QA fixture roots owned
 * by the active super_admin QA owner.
 *
 * Lives OUTSIDE `src/` so the default `bunx vitest run` never picks it up.
 * Run with an ad-hoc config that includes only this file.
 *
 * NEVER SKIPS. Fails hard if TG2E3O8_DATABASE_URL is absent.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.TG2E3O8_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'TG2E3O8_DATABASE_URL is required for the Phase TG-2E3-O8 real-Postgres gate.',
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
const O8_SQL = candidate(
  '20260821060000_phase_tg2e3_o8_owner_qa_cross_workspace_entitlement.sql',
);

/** Roles, auth shim, and the tables/functions the touched surface reads. */
const SCAFFOLD = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
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
  display_name text,
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
  recruiter_id uuid,
  user_id uuid,
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
  status text NOT NULL,
  invite_expires_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.agency_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL UNIQUE,
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

CREATE TABLE IF NOT EXISTS public.agency_delegation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  driver_user_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'approved',
  requested_permissions jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.driver_assistants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assistant_user_id uuid NOT NULL,
  driver_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  agency_delegation_id uuid,
  accepted_at timestamptz DEFAULT now(),
  last_active_at timestamptz
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

CREATE OR REPLACE FUNCTION public.agency_team_occupied_seats(_agency_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT CASE WHEN _agency_id IS NULL THEN 0 ELSE (
    SELECT count(*)::integer FROM public.agency_members am
     WHERE am.agency_id=_agency_id
       AND (am.status='active'
            OR (am.status='pending' AND am.invite_expires_at IS NOT NULL
                AND am.invite_expires_at > now()))
  ) END;
$function$;

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
      AND rp.company_type IN (
        'carrier',
        'third_party_recruiter',
        'staffing_agency',
        'independent_recruiter'
      )
      AND (
        rp.posting_terms_accepted_at IS NOT NULL
        OR rp.legacy_terms_grandfathered_at IS NOT NULL
      )
  );
$$;
`;

/** Exact PRE-O7 live bodies of the seven public-discovery functions. */
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
`;

/** Exact PRE-O8 live bodies of the agency/settlement/assistant surface. */
const BASELINE_O8_SURFACE = `
CREATE OR REPLACE FUNCTION public._agency_member_paid_operational_authority(_agency_id uuid, _uid uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ DECLARE _is_owner boolean; _ent_ok boolean; BEGIN IF _agency_id IS NULL OR _uid IS NULL THEN RETURN false; END IF; IF NOT EXISTS(SELECT 1 FROM public.agency_profiles ap WHERE ap.id=_agency_id AND ap.status='active') THEN RETURN false; END IF; IF NOT EXISTS(SELECT 1 FROM public.agency_members am WHERE am.agency_id=_agency_id AND am.member_user_id=_uid AND am.status='active') THEN RETURN false; END IF; SELECT EXISTS(SELECT 1 FROM public.agency_entitlements ae WHERE ae.agency_id=_agency_id AND ae.status IN ('manual_beta','active','trialing','past_due')) INTO _ent_ok; IF NOT _ent_ok THEN RETURN false; END IF; SELECT EXISTS(SELECT 1 FROM public.agency_profiles ap WHERE ap.id=_agency_id AND ap.owner_user_id=_uid) INTO _is_owner; IF _is_owner THEN RETURN true; END IF; RETURN public.agency_team_workspace_within_limit(_agency_id); END; $function$;

CREATE OR REPLACE FUNCTION public.agency_team_workspace_within_limit(_agency_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ DECLARE lim record; used integer; BEGIN IF _agency_id IS NULL THEN RETURN false; END IF; SELECT * INTO lim FROM public.get_effective_agency_limits(_agency_id); IF NOT FOUND THEN RETURN false; END IF; IF lim.member_limit IS NULL THEN RETURN true; END IF; used:=public.agency_team_occupied_seats(_agency_id); RETURN used<=lim.member_limit; END; $function$;

CREATE OR REPLACE FUNCTION public.settlement_current_user_can_manage_agency(_agency_id uuid, _driver_user_id uuid, _permission text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$ SELECT auth.uid() IS NOT NULL AND _agency_id IS NOT NULL AND _driver_user_id IS NOT NULL AND _permission IS NOT NULL AND _permission IN ('settlements_manage','settlements_finalize') AND EXISTS(SELECT 1 FROM public.agency_profiles ap WHERE ap.id=_agency_id AND ap.status='active') AND EXISTS(SELECT 1 FROM public.agency_members am WHERE am.agency_id=_agency_id AND am.member_user_id=auth.uid() AND am.status='active') AND EXISTS(SELECT 1 FROM public.agency_entitlements ae WHERE ae.agency_id=_agency_id AND ae.plan_key IN ('agency_starter','agency_team','agency_growth') AND ae.status IN ('active','trialing','manual_beta')) AND public._agency_member_paid_operational_authority(_agency_id,auth.uid()) AND EXISTS(SELECT 1 FROM public.agency_delegation_requests dr WHERE dr.agency_id=_agency_id AND dr.driver_user_id=_driver_user_id AND dr.member_user_id=auth.uid() AND dr.status='approved' AND jsonb_typeof(dr.requested_permissions->_permission)='boolean' AND (dr.requested_permissions->_permission)=to_jsonb(true)) AND NOT(EXISTS(SELECT 1 FROM public.agency_members am2 WHERE am2.agency_id=_agency_id AND am2.member_user_id=auth.uid() AND am2.status='active' AND am2.role='agency_owner') AND EXISTS(SELECT 1 FROM public.recruiter_billing_profiles rb WHERE rb.user_id=auth.uid() AND rb.plan IN ('starter','growth','fleet') AND rb.status IN ('active','trialing'))); $function$;

CREATE OR REPLACE FUNCTION public._agency_delegation_operationally_active(_delegation_id uuid, _member_user_id uuid, _driver_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT _delegation_id IS NOT NULL AND _member_user_id IS NOT NULL AND _driver_user_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.agency_delegation_requests dr WHERE dr.id=_delegation_id AND dr.status='approved' AND dr.member_user_id=_member_user_id AND dr.driver_user_id=_driver_user_id AND public._agency_member_paid_operational_authority(dr.agency_id,dr.member_user_id)); $function$;

CREATE OR REPLACE FUNCTION public.assistant_has_permission(_assistant uuid, _driver uuid, _perm text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT EXISTS(SELECT 1 FROM public.driver_assistants da WHERE da.assistant_user_id=_assistant AND da.driver_user_id=_driver AND da.status='active' AND COALESCE((da.permissions ->> _perm)::boolean,false)=true AND (CASE WHEN da.agency_delegation_id IS NULL THEN public.driver_has_active_pro(da.driver_user_id) ELSE public._agency_delegation_operationally_active(da.agency_delegation_id,da.assistant_user_id,da.driver_user_id) END)); $function$;

CREATE OR REPLACE FUNCTION public.get_my_managed_drivers()
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ DECLARE _uid uuid:=auth.uid(); BEGIN IF _uid IS NULL THEN RETURN; END IF; RETURN QUERY SELECT jsonb_build_object('delegate_id',da.id,'driver_user_id',da.driver_user_id,'driver_email',lower(u.email),'driver_name',COALESCE(p.display_name,lower(u.email)),'permissions',da.permissions,'accepted_at',da.accepted_at,'last_active_at',da.last_active_at,'driver_is_pro',public.driver_has_active_pro(da.driver_user_id)) FROM public.driver_assistants da JOIN auth.users u ON u.id=da.driver_user_id LEFT JOIN public.profiles p ON p.user_id=da.driver_user_id WHERE da.assistant_user_id=_uid AND da.status='active' AND (CASE WHEN da.agency_delegation_id IS NULL THEN public.driver_has_active_pro(da.driver_user_id) ELSE public._agency_delegation_operationally_active(da.agency_delegation_id,da.assistant_user_id,da.driver_user_id) END) ORDER BY da.accepted_at DESC NULLS LAST; END $function$;
`;

const FOUR = [
  'driver_has_active_pro',
  'get_effective_agency_limits',
  '_agency_member_paid_operational_authority',
  'settlement_current_user_can_manage_agency',
];

const O2_NEIGHBOURS = [
  '_owner_qa_persona_for',
  'current_owner_qa_persona',
  'set_owner_qa_persona',
  'disable_owner_qa_persona',
  'effective_recruiter_tier',
  'opportunities_billing_guard',
];

const O7_SEVEN = [
  'list_driver_visible_opportunities',
  'driver_can_access_opportunity',
  'create_driver_referral_safe',
  'resolve_agency_slug',
  'get_agency_public_view',
  'list_agency_packages_public',
  'get_weekly_driver_leaderboard',
];

const OTHER_NEIGHBOURS = [
  'agency_team_workspace_within_limit',
  'agency_team_occupied_seats',
  '_agency_delegation_operationally_active',
  'assistant_has_permission',
  'get_my_managed_drivers',
  'is_qa_fixture_root',
  'is_admin',
  'is_super_admin',
  '_agency_plan_defaults',
];

const OBJECT_INVENTORY_SQL = `
  SELECT 'table:' || c.relname AS obj
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
  UNION ALL
  SELECT 'index:' || c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'i'
  UNION ALL
  SELECT 'trigger:' || c.relname || '.' || t.tgname
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
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
         pg_get_userbyid(p.proowner) AS owner,
         array_to_string(p.proconfig, ',') AS config,
         array_to_string(p.proacl, ',') AS acl,
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

const REGISTRY_DDL_SQL = `
  SELECT string_agg(
    a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ','
    ORDER BY a.attnum) AS cols
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'qa_fixture_roots'
    AND a.attnum > 0 AND NOT a.attisdropped
`;

const pool = new pg.Pool({ connectionString: URL_STR, max: 4 });

const OWNER = randomUUID();
const OWNER2 = randomUUID();
const NON_ADMIN = randomUUID();
const SYN_DRIVER = randomUUID();
const REAL_PRO_DRIVER = randomUUID();
const PLAIN_DRIVER = randomUUID();
const ADMIN_TARGET = randomUUID();
const REAL_AGENCY_OWNER = randomUUID();
const AGENCY_MEMBER = randomUUID();
const SEAT_MEMBER_A = randomUUID();
const SEAT_MEMBER_B = randomUUID();

const QA_AGENCY = randomUUID();
const OWNER2_AGENCY = randomUUID();
const REAL_AGENCY = randomUUID();
const SETTLE_DRIVER = randomUUID();

type Row = Record<string, unknown>;

let inventoryBefore: string[] = [];
let inventoryAfter: string[] = [];
let fourBefore: Row[] = [];
let fourAfter: Row[] = [];
let o2Before: Row[] = [];
let o2After: Row[] = [];
let sevenBefore: Row[] = [];
let sevenAfter: Row[] = [];
let othersBefore: Row[] = [];
let othersAfter: Row[] = [];
let helperAclBefore: Row = {};
let helperAclAfter: Row = {};
let registryBefore: Row = {};
let registryAfter: Row = {};
let billingCountsBefore: Row = {};

async function asUser<T>(
  uid: string | null,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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

async function driverPro(caller: string | null, target: string): Promise<boolean> {
  return asUser(caller, async (c) => {
    const r = await c.query(`SELECT public.driver_has_active_pro($1) AS ok`, [target]);
    return r.rows[0].ok as boolean;
  });
}

async function agencyLimits(caller: string | null, agency: string): Promise<Row> {
  return asUser(caller, async (c) => {
    const r = await c.query(
      `SELECT * FROM public.get_effective_agency_limits($1)`,
      [agency],
    );
    return r.rows[0] as Row;
  });
}

async function paidAuthority(caller: string, agency: string, uid: string) {
  return asUser(caller, async (c) => {
    const r = await c.query(
      `SELECT public._agency_member_paid_operational_authority($1,$2) AS ok`,
      [agency, uid],
    );
    return r.rows[0].ok as boolean;
  });
}

async function settlementAuthority(
  caller: string,
  agency: string,
  driver: string,
  permission: string,
) {
  return asUser(caller, async (c) => {
    const r = await c.query(
      `SELECT public.settlement_current_user_can_manage_agency($1,$2,$3) AS ok`,
      [agency, driver, permission],
    );
    return r.rows[0].ok as boolean;
  });
}

async function setPersona(
  uid: string,
  domain: string,
  persona: string,
  opts: { enabled?: boolean; expired?: boolean } = {},
): Promise<void> {
  const enabled = opts.enabled ?? true;
  const created = opts.expired ? 'now() - interval \'3 hours\'' : 'now()';
  const expires = opts.expired
    ? "now() - interval '1 hour'"
    : "now() + interval '60 minutes'";
  await pool.query(
    `INSERT INTO public.owner_qa_sessions
       (user_id, domain, persona, enabled, created_at, updated_at, expires_at)
     VALUES ($1,$2,$3,$4, ${created}, now(), ${expires})
     ON CONFLICT (user_id) DO UPDATE
       SET domain=EXCLUDED.domain, persona=EXCLUDED.persona,
           enabled=EXCLUDED.enabled, created_at=EXCLUDED.created_at,
           updated_at=now(), expires_at=EXCLUDED.expires_at`,
    [uid, domain, persona, enabled],
  );
}

async function clearPersonas(): Promise<void> {
  await pool.query(`DELETE FROM public.owner_qa_sessions`);
}

async function registerRoot(
  kind: string,
  rootId: string,
  ownerUser: string,
  active = true,
): Promise<void> {
  await pool.query(
    `INSERT INTO public.qa_fixture_roots
       (root_kind, root_id, qa_owner_user_id, active, registered_by_user_id, revoked_at)
     VALUES ($1,$2,$3,$4,$3,$5)
     ON CONFLICT (root_kind, root_id) DO UPDATE
       SET qa_owner_user_id = EXCLUDED.qa_owner_user_id,
           active = EXCLUDED.active,
           revoked_at = EXCLUDED.revoked_at`,
    [kind, rootId, ownerUser, active, active ? null : new Date().toISOString()],
  );
}

async function clearRoots(): Promise<void> {
  await pool.query(`DELETE FROM public.qa_fixture_roots`);
}

async function setEntitlement(agency: string, plan: string, status: string) {
  await pool.query(
    `INSERT INTO public.agency_entitlements (agency_id, plan_key, status, source)
     VALUES ($1,$2,$3,'manual')
     ON CONFLICT (agency_id) DO UPDATE
       SET plan_key=EXCLUDED.plan_key, status=EXCLUDED.status`,
    [agency, plan, status],
  );
}

async function billingCounts(): Promise<Row> {
  const r = await pool.query(`
    SELECT
      (SELECT count(*) FROM public.agency_entitlements) AS ents,
      (SELECT count(*) FROM public.subscriptions) AS subs,
      (SELECT count(*) FROM public.recruiter_billing_profiles) AS rbp,
      (SELECT count(*) FROM public.admin_users) AS admins
  `);
  return r.rows[0] as Row;
}

beforeAll(async () => {
  await pool.query(SCAFFOLD);
  await pool.query(OWNER_QA_SQL);
  await pool.query(BASELINE_SEVEN);
  await pool.query(BASELINE_O8_SURFACE);
  await pool.query(O6_SQL);
  await pool.query(O7_SQL);

  // Identities
  await pool.query(
    `INSERT INTO auth.users(id, email) VALUES
       ($1,'owner@example.com'),($2,'owner2@example.com'),($3,'plain@example.com'),
       ($4,'syn@example.com'),($5,'realpro@example.com'),($6,'nobody@example.com'),
       ($7,'admin@example.com'),($8,'agencyowner@example.com'),($9,'member@example.com'),
       ($10,'seata@example.com'),($11,'seatb@example.com'),($12,'settledriver@example.com')`,
    [
      OWNER, OWNER2, NON_ADMIN, SYN_DRIVER, REAL_PRO_DRIVER, PLAIN_DRIVER,
      ADMIN_TARGET, REAL_AGENCY_OWNER, AGENCY_MEMBER, SEAT_MEMBER_A,
      SEAT_MEMBER_B, SETTLE_DRIVER,
    ],
  );
  await pool.query(
    `INSERT INTO public.admin_users(user_id, role)
     VALUES ($1,'super_admin'),($2,'super_admin'),($3,'admin')`,
    [OWNER, OWNER2, ADMIN_TARGET],
  );
  await pool.query(
    `INSERT INTO public.subscriptions(user_id, status, plan_key)
     VALUES ($1,'active','pro_monthly')`,
    [REAL_PRO_DRIVER],
  );

  // Assistant relationship: OWNER assists the synthetic driver (direct, no agency).
  await pool.query(
    `INSERT INTO public.driver_assistants
       (assistant_user_id, driver_user_id, status, permissions, agency_delegation_id)
     VALUES ($1,$2,'active','{"loads_edit": true}'::jsonb, NULL)`,
    [OWNER, SYN_DRIVER],
  );

  // Agencies
  await pool.query(
    `INSERT INTO public.agency_profiles (id, owner_user_id, name, slug, status)
     VALUES ($1,$2,'QA Agency','qa-agency','active'),
            ($3,$4,'Owner2 Agency','owner2-agency','active'),
            ($5,$6,'Real Agency','real-agency','active')`,
    [QA_AGENCY, OWNER, OWNER2_AGENCY, OWNER2, REAL_AGENCY, REAL_AGENCY_OWNER],
  );
  // QA_AGENCY intentionally has NO agency_entitlements row.
  await setEntitlement(REAL_AGENCY, 'agency_starter', 'active');

  await pool.query(
    `INSERT INTO public.agency_members (agency_id, member_user_id, role, status)
     VALUES ($1,$2,'agency_owner','active'),
            ($1,$3,'agency_staff','inactive'),
            ($4,$5,'agency_owner','active'),
            ($4,$6,'agency_staff','active'),
            ($4,$7,'agency_staff','active')`,
    [
      QA_AGENCY, OWNER, AGENCY_MEMBER,
      REAL_AGENCY, REAL_AGENCY_OWNER, SEAT_MEMBER_A, SEAT_MEMBER_B,
    ],
  );

  // Approved settlement delegations.
  await pool.query(
    `INSERT INTO public.agency_delegation_requests
       (agency_id, driver_user_id, member_user_id, status, requested_permissions)
     VALUES ($1,$2,$3,'approved','{"settlements_manage": true}'::jsonb),
            ($4,$2,$5,'approved','{"settlements_manage": true}'::jsonb)`,
    [QA_AGENCY, SETTLE_DRIVER, OWNER, REAL_AGENCY, REAL_AGENCY_OWNER],
  );

  billingCountsBefore = await billingCounts();

  inventoryBefore = (await pool.query(OBJECT_INVENTORY_SQL)).rows.map((r) => r.obj as string);
  fourBefore = (await pool.query(CONTRACT_SQL, [FOUR])).rows;
  o2Before = (await pool.query(CONTRACT_SQL, [O2_NEIGHBOURS])).rows;
  sevenBefore = (await pool.query(CONTRACT_SQL, [O7_SEVEN])).rows;
  othersBefore = (await pool.query(CONTRACT_SQL, [OTHER_NEIGHBOURS])).rows;
  helperAclBefore = (await pool.query(HELPER_ACL_SQL)).rows[0];
  registryBefore = (await pool.query(REGISTRY_DDL_SQL)).rows[0];

  await pool.query(O8_SQL);

  inventoryAfter = (await pool.query(OBJECT_INVENTORY_SQL)).rows.map((r) => r.obj as string);
  fourAfter = (await pool.query(CONTRACT_SQL, [FOUR])).rows;
  o2After = (await pool.query(CONTRACT_SQL, [O2_NEIGHBOURS])).rows;
  sevenAfter = (await pool.query(CONTRACT_SQL, [O7_SEVEN])).rows;
  othersAfter = (await pool.query(CONTRACT_SQL, [OTHER_NEIGHBOURS])).rows;
  helperAclAfter = (await pool.query(HELPER_ACL_SQL)).rows[0];
  registryAfter = (await pool.query(REGISTRY_DDL_SQL)).rows[0];
}, 180_000);

afterAll(async () => {
  await clearRoots();
  await clearPersonas();
  await pool.end();
});

// ---------------------------------------------------------------------------
// 1-6 — blast radius / contract
// ---------------------------------------------------------------------------
describe('O8 blast radius and contract', () => {
  it('1) adds no table, view, function, policy, trigger, or index', () => {
    const added = inventoryAfter.filter((o) => !inventoryBefore.includes(o));
    const removed = inventoryBefore.filter((o) => !inventoryAfter.includes(o));
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('1b) replaces exactly the four allowlisted function definitions', () => {
    const changed = fourAfter
      .filter((a) => {
        const b = fourBefore.find((x) => x.proname === a.proname);
        return b && b.def !== a.def;
      })
      .map((a) => a.proname as string)
      .sort();
    expect(changed).toEqual([...FOUR].sort());
  });

  it('2) preserves signature, return type, language, volatility, secdef, search_path, owner and ACL of the four', () => {
    for (const name of FOUR) {
      const b = fourBefore.find((x) => x.proname === name)!;
      const a = fourAfter.find((x) => x.proname === name)!;
      expect(b).toBeTruthy();
      expect(a).toBeTruthy();
      expect(a.args).toEqual(b.args);
      expect(a.ret).toEqual(b.ret);
      expect(a.lanname).toEqual(b.lanname);
      expect(a.provolatile).toEqual(b.provolatile);
      expect(a.prosecdef).toEqual(b.prosecdef);
      expect(a.config).toEqual(b.config);
      expect(a.owner).toEqual(b.owner);
      expect(a.acl).toEqual(b.acl);
    }
  });

  it('3) leaves the O6 registry table and helper ACL byte/privilege identical', async () => {
    expect(registryAfter).toEqual(registryBefore);
    expect(helperAclAfter).toEqual(helperAclBefore);
    expect(helperAclAfter.pub).toBe(false);
    expect(helperAclAfter.anon).toBe(false);
    expect(helperAclAfter.authed).toBe(false);
    expect(helperAclAfter.svc).toBe(true);

    const helperBefore = othersBefore.find((x) => x.proname === 'is_qa_fixture_root');
    const helperAfter = othersAfter.find((x) => x.proname === 'is_qa_fixture_root');
    expect(helperAfter!.def).toEqual(helperBefore!.def);
  });

  it('3b) authenticated still cannot execute the O6 helper directly', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE authenticated');
      await expect(
        client.query(`SELECT public.is_qa_fixture_root('user', gen_random_uuid())`),
      ).rejects.toThrow(/permission denied/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('4) leaves O2 Owner QA RPCs and non-allowlisted neighbours untouched', () => {
    expect(o2After).toEqual(o2Before);
    expect(othersAfter).toEqual(othersBefore);
  });

  it('5) leaves the seven O7 isolation functions byte-identical', () => {
    expect(sevenAfter).toEqual(sevenBefore);
  });

  it('6) contains no prohibited executable statement', () => {
    const executable = O8_SQL.split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .toLowerCase();

    const forbidden = [
      'grant ',
      'revoke ',
      'create table',
      'create policy',
      'create trigger',
      'create index',
      'create view',
      'drop ',
      'alter table',
      'execute format',
      'execute immediate',
      'insert into',
      'update public.',
      'delete from',
      'stripe',
      'telegram',
      'agency_entitlements set',
      'recruiter_billing_profiles set',
      'into public.recruiter_billing_profiles',
      'admin_users',
    ];
    for (const token of forbidden) {
      expect(
        executable.includes(token),
        `O8 executable SQL must not contain "${token}"`,
      ).toBe(false);
    }
    // Exactly four CREATE OR REPLACE FUNCTION statements.
    expect(
      (executable.match(/create or replace function/g) ?? []).length,
    ).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 7-21 — driver synthetic QA branch
// ---------------------------------------------------------------------------
describe('driver synthetic QA branch', () => {
  it('7) owner + active user root + pro_monthly => true', async () => {
    await clearRoots();
    await clearPersonas();
    await registerRoot('user', SYN_DRIVER, OWNER);
    await setPersona(OWNER, 'driver', 'pro_monthly');
    expect(await driverPro(OWNER, SYN_DRIVER)).toBe(true);
  });

  it('8) pro_yearly => true', async () => {
    await setPersona(OWNER, 'driver', 'pro_yearly');
    expect(await driverPro(OWNER, SYN_DRIVER)).toBe(true);
  });

  it('9) free => false even though the target has no real subscription', async () => {
    await setPersona(OWNER, 'driver', 'free');
    expect(await driverPro(OWNER, SYN_DRIVER)).toBe(false);
  });

  it('10) QA disabled => falls through to the real target state', async () => {
    await setPersona(OWNER, 'driver', 'pro_monthly', { enabled: false });
    expect(await driverPro(OWNER, SYN_DRIVER)).toBe(false);
  });

  it('11) expired QA => falls through', async () => {
    await setPersona(OWNER, 'driver', 'pro_monthly', { expired: true });
    expect(await driverPro(OWNER, SYN_DRIVER)).toBe(false);
  });

  it('12) recruiter / agency QA domains => falls through', async () => {
    await setPersona(OWNER, 'recruiter', 'fleet');
    expect(await driverPro(OWNER, SYN_DRIVER)).toBe(false);
    await setPersona(OWNER, 'agency', 'agency_growth');
    expect(await driverPro(OWNER, SYN_DRIVER)).toBe(false);
  });

  it('13) inactive / revoked user root => falls through', async () => {
    await setPersona(OWNER, 'driver', 'pro_monthly');
    await registerRoot('user', SYN_DRIVER, OWNER, false);
    expect(await driverPro(OWNER, SYN_DRIVER)).toBe(false);
    await registerRoot('user', SYN_DRIVER, OWNER, true);
    expect(await driverPro(OWNER, SYN_DRIVER)).toBe(true);
  });

  it('14) root owned by a different super_admin => no synthetic override', async () => {
    await registerRoot('user', SYN_DRIVER, OWNER2);
    await setPersona(OWNER, 'driver', 'pro_monthly');
    expect(await driverPro(OWNER, SYN_DRIVER)).toBe(false);
    // and the other owner, with their own persona, does get it
    await setPersona(OWNER2, 'driver', 'pro_monthly');
    expect(await driverPro(OWNER2, SYN_DRIVER)).toBe(true);
    await clearPersonas();
    await registerRoot('user', SYN_DRIVER, OWNER);
  });

  it('15) non-super-admin caller cannot synthetic-override', async () => {
    await registerRoot('user', SYN_DRIVER, NON_ADMIN);
    await setPersona(NON_ADMIN, 'driver', 'pro_monthly');
    expect(await driverPro(NON_ADMIN, SYN_DRIVER)).toBe(false);
    await clearPersonas();
    await registerRoot('user', SYN_DRIVER, OWNER);
  });

  it('16) NULL auth.uid cannot synthetic-override', async () => {
    await setPersona(OWNER, 'driver', 'pro_monthly');
    expect(await driverPro(null, SYN_DRIVER)).toBe(false);
  });

  it('17) target equal to the owner identity uses the self branch, never the synthetic branch', async () => {
    // OWNER is registered as a root owned by OWNER2; OWNER is also an admin,
    // so only the self branch can produce `false` here.
    await registerRoot('user', OWNER, OWNER2);
    await setPersona(OWNER, 'driver', 'free');
    expect(await driverPro(OWNER, OWNER)).toBe(false);
    await setPersona(OWNER, 'driver', 'pro_monthly');
    expect(await driverPro(OWNER, OWNER)).toBe(true);
    await pool.query(
      `DELETE FROM public.qa_fixture_roots WHERE root_kind='user' AND root_id=$1`,
      [OWNER],
    );
  });

  it('18) a real active Pro subscription remains true when QA does not apply', async () => {
    await clearPersonas();
    expect(await driverPro(PLAIN_DRIVER, REAL_PRO_DRIVER)).toBe(true);
    await setPersona(OWNER, 'driver', 'free');
    expect(await driverPro(OWNER, REAL_PRO_DRIVER)).toBe(true);
  });

  it('19) existing admin behaviour for non-synthetic targets is unchanged', async () => {
    await setPersona(OWNER, 'driver', 'free');
    expect(await driverPro(OWNER, ADMIN_TARGET)).toBe(true);
    expect(await driverPro(OWNER, PLAIN_DRIVER)).toBe(false);
  });

  it('20) assistant_has_permission follows the synthetic QA Pro evaluation', async () => {
    await clearPersonas();
    await registerRoot('user', SYN_DRIVER, OWNER);

    const perm = async (caller: string, p: string) =>
      asUser(caller, async (c) =>
        (
          await c.query(`SELECT public.assistant_has_permission($1,$2,$3) AS ok`, [
            OWNER,
            SYN_DRIVER,
            p,
          ])
        ).rows[0].ok as boolean,
      );

    expect(await perm(OWNER, 'loads_edit')).toBe(false); // no persona => real state

    await setPersona(OWNER, 'driver', 'pro_monthly');
    expect(await perm(OWNER, 'loads_edit')).toBe(true);
    // A permission the relationship never granted stays false.
    expect(await perm(OWNER, 'settlements_finalize')).toBe(false);

    await setPersona(OWNER, 'driver', 'free');
    expect(await perm(OWNER, 'loads_edit')).toBe(false);
  });

  it('21) get_my_managed_drivers reflects the same synthetic QA Pro evaluation', async () => {
    await setPersona(OWNER, 'driver', 'pro_monthly');
    const rowsPro = await asUser(OWNER, async (c) =>
      (await c.query(`SELECT * FROM public.get_my_managed_drivers() AS d`)).rows,
    );
    expect(rowsPro).toHaveLength(1);
    expect((rowsPro[0].d as Record<string, unknown>).driver_user_id).toBe(SYN_DRIVER);
    expect((rowsPro[0].d as Record<string, unknown>).driver_is_pro).toBe(true);

    await setPersona(OWNER, 'driver', 'free');
    const rowsFree = await asUser(OWNER, async (c) =>
      (await c.query(`SELECT * FROM public.get_my_managed_drivers() AS d`)).rows,
    );
    expect(rowsFree).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 22-27 — agency root gate
// ---------------------------------------------------------------------------
describe('agency effective limits root gate', () => {
  it('22) active agency QA persona but no registered root => real entitlement behaviour', async () => {
    await clearRoots();
    await clearPersonas();
    await setPersona(OWNER, 'agency', 'agency_team');
    const l = await agencyLimits(OWNER, QA_AGENCY);
    expect(l.plan_key).toBe('agency_starter');
    expect(l.status).toBe('cancelled');
    expect(l.has_entitlement_row).toBe(false);
  });

  it('23) active registered agency root maps each QA plan to its limits', async () => {
    await registerRoot('agency_profile', QA_AGENCY, OWNER);

    const expected: Record<string, [number, number, number]> = {
      agency_starter: [2, 5, 3],
      agency_team: [5, 25, 10],
      agency_growth: [15, 100, 30],
    };
    for (const [plan, [m, c, s]] of Object.entries(expected)) {
      await setPersona(OWNER, 'agency', plan);
      const l = await agencyLimits(OWNER, QA_AGENCY);
      expect(l.plan_key).toBe(plan);
      expect(l.status).toBe('active');
      expect(l.member_limit).toBe(m);
      expect(l.active_client_limit).toBe(c);
      expect(l.service_package_limit).toBe(s);
      expect(l.has_entitlement_row).toBe(true);
    }
  });

  it('24) inactive / revoked agency root => real behaviour', async () => {
    await registerRoot('agency_profile', QA_AGENCY, OWNER, false);
    await setPersona(OWNER, 'agency', 'agency_growth');
    const l = await agencyLimits(OWNER, QA_AGENCY);
    expect(l.status).toBe('cancelled');
    expect(l.has_entitlement_row).toBe(false);
    await registerRoot('agency_profile', QA_AGENCY, OWNER, true);
  });

  it('25) root owned by another super_admin => no QA override', async () => {
    await registerRoot('agency_profile', QA_AGENCY, OWNER2);
    await setPersona(OWNER, 'agency', 'agency_growth');
    const l = await agencyLimits(OWNER, QA_AGENCY);
    expect(l.status).toBe('cancelled');
    await registerRoot('agency_profile', QA_AGENCY, OWNER);
  });

  it('26) a non-owner member never receives the owner QA override', async () => {
    await setPersona(OWNER, 'agency', 'agency_growth');
    const l = await agencyLimits(AGENCY_MEMBER, QA_AGENCY);
    expect(l.status).toBe('cancelled');
    expect(l.has_entitlement_row).toBe(false);
  });

  it('27) QA off / expired / non-agency domain => real behaviour', async () => {
    await setPersona(OWNER, 'agency', 'agency_growth', { enabled: false });
    expect((await agencyLimits(OWNER, QA_AGENCY)).status).toBe('cancelled');

    await setPersona(OWNER, 'agency', 'agency_growth', { expired: true });
    expect((await agencyLimits(OWNER, QA_AGENCY)).status).toBe('cancelled');

    await setPersona(OWNER, 'driver', 'pro_monthly');
    expect((await agencyLimits(OWNER, QA_AGENCY)).status).toBe('cancelled');

    // Real entitlements are untouched by any of this.
    await clearPersonas();
    const real = await agencyLimits(REAL_AGENCY_OWNER, REAL_AGENCY);
    expect(real.plan_key).toBe('agency_starter');
    expect(real.status).toBe('active');
    expect(real.has_entitlement_row).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 28-38 — agency operational + settlement authority
// ---------------------------------------------------------------------------
describe('agency operational and settlement authority', () => {
  it('28) QA root + agency_team/growth with ZERO entitlement rows passes the paid component', async () => {
    await clearPersonas();
    await clearRoots();
    await registerRoot('agency_profile', QA_AGENCY, OWNER);

    expect(await paidAuthority(OWNER, QA_AGENCY, OWNER)).toBe(false); // no persona

    for (const plan of ['agency_team', 'agency_growth', 'agency_starter']) {
      await setPersona(OWNER, 'agency', plan);
      expect(await paidAuthority(OWNER, QA_AGENCY, OWNER)).toBe(true);
    }
    const ents = await pool.query(
      `SELECT count(*)::int AS n FROM public.agency_entitlements WHERE agency_id=$1`,
      [QA_AGENCY],
    );
    expect(ents.rows[0].n).toBe(0);
  });

  it('29) assistant_free persona fails closed', async () => {
    await setPersona(OWNER, 'agency', 'assistant_free');
    const l = await agencyLimits(OWNER, QA_AGENCY);
    expect(l.status).toBe('cancelled');
    expect(await paidAuthority(OWNER, QA_AGENCY, OWNER)).toBe(false);
  });

  it('30) a missing delegated permission still blocks settlement authority', async () => {
    await setPersona(OWNER, 'agency', 'agency_team');
    expect(
      await settlementAuthority(OWNER, QA_AGENCY, SETTLE_DRIVER, 'settlements_finalize'),
    ).toBe(false);
    expect(
      await settlementAuthority(OWNER, QA_AGENCY, SETTLE_DRIVER, 'settlements_manage'),
    ).toBe(true);
  });

  it('31) an inactive member still gets no authority', async () => {
    await setPersona(OWNER, 'agency', 'agency_growth');
    expect(await paidAuthority(OWNER, QA_AGENCY, AGENCY_MEMBER)).toBe(false);
    expect(
      await settlementAuthority(AGENCY_MEMBER, QA_AGENCY, SETTLE_DRIVER, 'settlements_manage'),
    ).toBe(false);
  });

  it('32) seat/workspace over-limit still blocks a non-owner member on a real agency', async () => {
    await clearPersonas();
    // agency_starter member_limit = 2, REAL_AGENCY has 3 active members.
    await setEntitlement(REAL_AGENCY, 'agency_starter', 'active');
    expect(await paidAuthority(SEAT_MEMBER_A, REAL_AGENCY, SEAT_MEMBER_A)).toBe(false);
    // Owner bypasses the seat gate exactly as before.
    expect(await paidAuthority(REAL_AGENCY_OWNER, REAL_AGENCY, REAL_AGENCY_OWNER)).toBe(true);
    // Raising the real plan restores the member.
    await setEntitlement(REAL_AGENCY, 'agency_team', 'active');
    expect(await paidAuthority(SEAT_MEMBER_A, REAL_AGENCY, SEAT_MEMBER_A)).toBe(true);
    await setEntitlement(REAL_AGENCY, 'agency_starter', 'active');
  });

  it('33) the recruiter/agency conflict rule still blocks settlement authority', async () => {
    await clearPersonas();
    await pool.query(
      `INSERT INTO public.recruiter_billing_profiles (user_id, plan, status)
       VALUES ($1,'starter','active')`,
      [REAL_AGENCY_OWNER],
    );
    expect(
      await settlementAuthority(REAL_AGENCY_OWNER, REAL_AGENCY, SETTLE_DRIVER, 'settlements_manage'),
    ).toBe(false);
    await pool.query(`DELETE FROM public.recruiter_billing_profiles WHERE user_id=$1`, [
      REAL_AGENCY_OWNER,
    ]);
    expect(
      await settlementAuthority(REAL_AGENCY_OWNER, REAL_AGENCY, SETTLE_DRIVER, 'settlements_manage'),
    ).toBe(true);
  });

  it('34) real entitlement statuses behave exactly as pre-O8 in paid operational authority', async () => {
    await clearPersonas();
    for (const status of ['manual_beta', 'active', 'trialing', 'past_due']) {
      await setEntitlement(REAL_AGENCY, 'agency_starter', status);
      expect(
        await paidAuthority(REAL_AGENCY_OWNER, REAL_AGENCY, REAL_AGENCY_OWNER),
        `status ${status}`,
      ).toBe(true);
    }
    await setEntitlement(REAL_AGENCY, 'agency_starter', 'cancelled');
    expect(await paidAuthority(REAL_AGENCY_OWNER, REAL_AGENCY, REAL_AGENCY_OWNER)).toBe(false);
    await setEntitlement(REAL_AGENCY, 'agency_starter', 'active');
  });

  it('35) settlement authority passes the entitlement component under QA with no entitlement row', async () => {
    await registerRoot('agency_profile', QA_AGENCY, OWNER);
    for (const plan of ['agency_starter', 'agency_team', 'agency_growth']) {
      await setPersona(OWNER, 'agency', plan);
      expect(
        await settlementAuthority(OWNER, QA_AGENCY, SETTLE_DRIVER, 'settlements_manage'),
        `plan ${plan}`,
      ).toBe(true);
    }
    // Unknown driver / unapproved delegation is still refused.
    expect(
      await settlementAuthority(OWNER, QA_AGENCY, PLAIN_DRIVER, 'settlements_manage'),
    ).toBe(false);
    // Non-settlement permission strings are still refused.
    expect(await settlementAuthority(OWNER, QA_AGENCY, SETTLE_DRIVER, 'loads_edit')).toBe(false);
  });

  it('36) settlement still rejects past_due', async () => {
    await clearPersonas();
    await setEntitlement(REAL_AGENCY, 'agency_starter', 'past_due');
    expect(
      await settlementAuthority(REAL_AGENCY_OWNER, REAL_AGENCY, SETTLE_DRIVER, 'settlements_manage'),
    ).toBe(false);
    // ...while operational authority still accepts it.
    expect(await paidAuthority(REAL_AGENCY_OWNER, REAL_AGENCY, REAL_AGENCY_OWNER)).toBe(true);
    await setEntitlement(REAL_AGENCY, 'agency_starter', 'active');
  });

  it('37) a real settlement agency with active/trialing/manual_beta is unchanged', async () => {
    await clearPersonas();
    for (const status of ['active', 'trialing', 'manual_beta']) {
      await setEntitlement(REAL_AGENCY, 'agency_team', status);
      expect(
        await settlementAuthority(REAL_AGENCY_OWNER, REAL_AGENCY, SETTLE_DRIVER, 'settlements_manage'),
        `status ${status}`,
      ).toBe(true);
    }
    await setEntitlement(REAL_AGENCY, 'agency_starter', 'cancelled');
    expect(
      await settlementAuthority(REAL_AGENCY_OWNER, REAL_AGENCY, SETTLE_DRIVER, 'settlements_manage'),
    ).toBe(false);
    await setEntitlement(REAL_AGENCY, 'agency_starter', 'active');
  });

  it('38) no billing/subscription/admin rows were created by QA evaluation', async () => {
    const after = await billingCounts();
    expect(after).toEqual(billingCountsBefore);
  });
});
