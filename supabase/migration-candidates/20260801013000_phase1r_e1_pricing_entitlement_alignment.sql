-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
--
-- Phase 1R-E1-R1 — Canonical recruiter/agency pricing, limits, and
-- included-entitlement alignment.
--
-- Locked product matrix (active opportunities):
--   Recruiter Standard (free / plan 'none')  -> 1
--   Recruiter Starter                        -> 5
--   Recruiter Growth                         -> 15
--   Recruiter Fleet (existing access only)   -> 25
--   Dual paid business entitlement (conflict)-> 0  (fail closed)
--
-- Agency-included recruiter premium (agency profile owner only, active
-- owner membership, explicit entitlement row, paid source, paying status):
--   agency_starter -> starter
--   agency_team    -> growth
--   agency_growth  -> fleet
--
-- This candidate defines exactly five functions and performs exactly one
-- narrow backfill. It creates no tables, no policies, no indexes, and no
-- triggers; the existing opportunities guard trigger stays attached and
-- simply calls the replaced function body.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Canonical plan -> active-opportunity ceiling
--    ACL intentionally untouched: CREATE OR REPLACE preserves the current
--    privilege posture of this already-callable helper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recruiter_plan_limit(_plan text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _plan
    WHEN 'starter' THEN 5
    WHEN 'growth'  THEN 15
    WHEN 'fleet'   THEN 25
    ELSE 1            -- Recruiter Standard (free: 'none'/NULL/unknown)
  END
$$;

-- ---------------------------------------------------------------------------
-- 2) Effective recruiter tier
--    Returns exactly one of: free_standard | starter | growth | fleet | conflict
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.effective_recruiter_tier(_recruiter_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner_id       uuid;
  _recruiter_tier text := NULL;
  _agency_tier    text := NULL;
BEGIN
  IF _recruiter_id IS NULL THEN
    RETURN 'free_standard';
  END IF;

  SELECT rp.user_id INTO _owner_id
  FROM public.recruiter_profiles rp
  WHERE rp.id = _recruiter_id;

  IF _owner_id IS NULL THEN
    RETURN 'free_standard';
  END IF;

  -- Direct recruiter premium: explicit row for THIS recruiter profile,
  -- paid plan, paying status.
  SELECT b.plan INTO _recruiter_tier
  FROM public.recruiter_billing_profiles b
  WHERE b.recruiter_id = _recruiter_id
    AND b.plan IN ('starter', 'growth', 'fleet')
    AND b.status IN ('active', 'trialing')  -- trial-allowlist: Stripe status literal
  ORDER BY CASE b.plan
             WHEN 'fleet'   THEN 3
             WHEN 'growth'  THEN 2
             WHEN 'starter' THEN 1
             ELSE 0
           END DESC
  LIMIT 1;

  -- Agency-included recruiter premium. Requires agency profile ownership,
  -- an active agency_owner membership for the SAME user, and an explicit
  -- paid entitlement row on that same agency. manual_beta never includes
  -- recruiter premium. Deterministic highest tier when several qualify.
  SELECT CASE ae.plan_key
           WHEN 'agency_starter' THEN 'starter'
           WHEN 'agency_team'    THEN 'growth'
           WHEN 'agency_growth'  THEN 'fleet'
         END
    INTO _agency_tier
  FROM public.agency_profiles ap
  JOIN public.agency_members am
    ON am.agency_id = ap.id
   AND am.member_user_id = _owner_id
   AND am.role::text = 'agency_owner'
   AND am.status::text = 'active'
  JOIN public.agency_entitlements ae
    ON ae.agency_id = ap.id
  WHERE ap.owner_user_id = _owner_id
    AND ae.plan_key IN ('agency_starter', 'agency_team', 'agency_growth')
    AND ae.source IN ('stripe', 'manual', 'admin_seed')
    AND ae.status IN ('active', 'trialing')  -- trial-allowlist: Stripe status literal
  ORDER BY CASE ae.plan_key
             WHEN 'agency_growth'  THEN 3
             WHEN 'agency_team'    THEN 2
             WHEN 'agency_starter' THEN 1
             ELSE 0
           END DESC
  LIMIT 1;

  IF _recruiter_tier IS NOT NULL AND _agency_tier IS NOT NULL THEN
    RETURN 'conflict';
  END IF;

  RETURN COALESCE(_recruiter_tier, _agency_tier, 'free_standard');
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Effective active-opportunity ceiling (fail closed on anything unknown)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.effective_recruiter_active_opportunity_limit(_recruiter_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE public.effective_recruiter_tier(_recruiter_id)
    WHEN 'conflict'      THEN 0
    WHEN 'free_standard' THEN 1
    WHEN 'starter'       THEN 5
    WHEN 'growth'        THEN 15
    WHEN 'fleet'         THEN 25
    ELSE 0
  END
$$;

-- ---------------------------------------------------------------------------
-- 4) Priority-plan predicate (growth/fleet only; conflict is never priority)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recruiter_has_priority_plan(_recruiter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.effective_recruiter_tier(_recruiter_id) IN ('growth', 'fleet')
$$;

-- ---------------------------------------------------------------------------
-- 5) Opportunity billing guard — readiness first, then entitlement-aware slot
--    accounting. No trigger DDL: the existing trigger calls this function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.opportunities_billing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Fixed advisory-lock namespace for recruiter active-slot accounting.
  _lock_namespace     constant integer := 1971001;
  _limit              integer;
  _active_count       integer;
  _is_becoming_active boolean := false;
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NOT public.current_user_can_manage_recruiter_opportunities(NEW.recruiter_id) THEN
    RAISE EXCEPTION 'Complete your recruiter profile to publish opportunities.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    _is_becoming_active := (NEW.status = 'active');
  ELSIF TG_OP = 'UPDATE' THEN
    _is_becoming_active := (NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active');
  END IF;

  -- Drafts, active->active edits, active->paused/closed, and deletes never
  -- consume or re-check a slot.
  IF NOT _is_becoming_active THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent activations for this recruiter before counting.
  PERFORM pg_advisory_xact_lock(_lock_namespace, hashtext(NEW.recruiter_id::text));

  _limit := public.effective_recruiter_active_opportunity_limit(NEW.recruiter_id);

  IF _limit IS NULL OR _limit <= 0 THEN
    RAISE EXCEPTION 'Active opportunity activation is blocked.'
      USING ERRCODE = '23514',
            DETAIL  = '{"code": "business_entitlement_conflict"}';
  END IF;

  SELECT COUNT(*)::int INTO _active_count
  FROM public.opportunities o
  WHERE o.recruiter_id = NEW.recruiter_id
    AND o.status = 'active'
    AND o.id IS DISTINCT FROM NEW.id;

  IF _active_count >= _limit THEN
    RAISE EXCEPTION 'Active opportunity limit reached.'
      USING ERRCODE = '23514',
            DETAIL  = json_build_object(
                        'code', 'active_opportunity_limit_reached',
                        'limit', _limit,
                        'active_count', _active_count
                      )::text;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Narrow backfill — ONLY recruiter_billing_profiles.active_opportunity_limit
-- ---------------------------------------------------------------------------
UPDATE public.recruiter_billing_profiles b
SET active_opportunity_limit = public.recruiter_plan_limit(b.plan)
WHERE b.active_opportunity_limit IS DISTINCT FROM public.recruiter_plan_limit(b.plan);

-- ---------------------------------------------------------------------------
-- 7) Privileges (recruiter_plan_limit intentionally untouched)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.effective_recruiter_tier(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.effective_recruiter_tier(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.effective_recruiter_tier(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.effective_recruiter_tier(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.effective_recruiter_active_opportunity_limit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.effective_recruiter_active_opportunity_limit(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.effective_recruiter_active_opportunity_limit(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.effective_recruiter_active_opportunity_limit(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.recruiter_has_priority_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recruiter_has_priority_plan(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.recruiter_has_priority_plan(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recruiter_has_priority_plan(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.opportunities_billing_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.opportunities_billing_guard() FROM anon;
REVOKE ALL ON FUNCTION public.opportunities_billing_guard() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.opportunities_billing_guard() TO service_role;

-- PGlite / offline acceptance roles, granted only where they exist.
DO $do$
DECLARE
  _role text;
BEGIN
  FOREACH _role IN ARRAY ARRAY['pglite_test', 'postgres_test_runner'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = _role) THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.effective_recruiter_tier(uuid) TO %I', _role);
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.effective_recruiter_active_opportunity_limit(uuid) TO %I', _role);
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.recruiter_has_priority_plan(uuid) TO %I', _role);
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.opportunities_billing_guard() TO %I', _role);
    END IF;
  END LOOP;
END
$do$;

COMMIT;
