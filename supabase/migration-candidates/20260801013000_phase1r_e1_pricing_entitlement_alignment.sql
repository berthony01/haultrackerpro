-- Phase 1R-E1 — Canonical recruiter/agency pricing, limits, and
-- included-entitlement alignment.
--
-- CANDIDATE SQL ONLY. Not applied by this phase.
--
-- Locked product matrix (active opportunities):
--   Recruiter Standard (free / plan 'none')  -> 1
--   Recruiter Starter                        -> 5
--   Recruiter Growth                         -> 15
--   Recruiter Fleet (preview only)           -> 25
--
-- Agency-included recruiter premium (owner-only, active membership):
--   agency_starter -> recruiter starter
--   agency_team    -> recruiter growth
--   agency_growth  -> recruiter fleet
--
-- Fail-closed rules preserved:
--   * A recruiter profile must pass the canonical readiness helper before any
--     opportunity may become active.
--   * Dual paid business entitlement (recruiter subscription AND agency-included
--     premium) resolves to the FREE standard tier, never to the higher plan.
--   * Unknown/malformed plans, statuses, or sources grant nothing above standard.

-- ---------------------------------------------------------------------------
-- 1) Canonical plan → active-opportunity ceiling
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recruiter_plan_limit(_plan text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _plan
    WHEN 'starter' THEN 5
    WHEN 'growth'  THEN 15
    WHEN 'fleet'   THEN 25
    ELSE 1            -- Recruiter Standard (free, plan 'none'/NULL/unknown)
  END
$$;

REVOKE ALL     ON FUNCTION public.recruiter_plan_limit(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.recruiter_plan_limit(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Agency plan → included recruiter tier
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agency_included_recruiter_tier(_agency_plan text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _agency_plan
    WHEN 'agency_starter' THEN 'starter'
    WHEN 'agency_team'    THEN 'growth'
    WHEN 'agency_growth'  THEN 'fleet'
    ELSE NULL
  END
$$;

REVOKE ALL     ON FUNCTION public.agency_included_recruiter_tier(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.agency_included_recruiter_tier(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Effective recruiter tier for a recruiter profile
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.effective_recruiter_tier(_recruiter_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _owner_id          uuid;
  _recruiter_tier    text := NULL;
  _agency_tier       text := NULL;
BEGIN
  IF _recruiter_id IS NULL THEN
    RETURN 'none';
  END IF;

  SELECT rp.user_id INTO _owner_id
  FROM public.recruiter_profiles rp
  WHERE rp.id = _recruiter_id;

  IF _owner_id IS NULL THEN
    RETURN 'none';
  END IF;

  -- Recruiter paid subscription (explicit row + paid plan + paying status).
  SELECT b.plan INTO _recruiter_tier
  FROM public.recruiter_billing_profiles b
  WHERE b.recruiter_id = _recruiter_id
    AND b.plan IN ('starter', 'growth', 'fleet')
    AND b.status IN ('active', 'trialing');  -- trial-allowlist: Stripe status literal

  -- Agency-included recruiter premium: owner-only, active membership,
  -- recognized source, paid agency plan, paying agency status.
  SELECT public.agency_included_recruiter_tier(e.plan_key) INTO _agency_tier
  FROM public.agency_entitlements e
  JOIN public.agency_members m
    ON m.agency_id = e.agency_id
   AND m.user_id = _owner_id
   AND m.role = 'agency_owner'
   AND m.status = 'active'
  WHERE e.plan_key IN ('agency_starter', 'agency_team', 'agency_growth')
    AND e.status IN ('active', 'trialing')  -- trial-allowlist: Stripe status literal
    AND e.source IN ('stripe', 'manual', 'admin_seed')
  LIMIT 1;

  -- Fail closed on dual paid business entitlement.
  IF _recruiter_tier IS NOT NULL AND _agency_tier IS NOT NULL THEN
    RETURN 'none';
  END IF;

  RETURN COALESCE(_recruiter_tier, _agency_tier, 'none');
END;
$$;

REVOKE ALL     ON FUNCTION public.effective_recruiter_tier(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.effective_recruiter_tier(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.effective_recruiter_tier(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Effective active-opportunity ceiling
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.effective_recruiter_active_opportunity_limit(_recruiter_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.recruiter_plan_limit(public.effective_recruiter_tier(_recruiter_id))
$$;

REVOKE ALL     ON FUNCTION public.effective_recruiter_active_opportunity_limit(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.effective_recruiter_active_opportunity_limit(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.effective_recruiter_active_opportunity_limit(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5) Rewritten billing guard — readiness-based, entitlement-aware
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.opportunities_billing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _limit              integer;
  _active_count       integer;
  _is_becoming_active boolean := false;
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    _is_becoming_active := (NEW.status = 'active');
  ELSIF TG_OP = 'UPDATE' THEN
    _is_becoming_active := (NEW.status = 'active' AND COALESCE(OLD.status, '') <> 'active');
  END IF;

  IF NOT _is_becoming_active THEN
    RETURN NEW;
  END IF;

  -- Canonical readiness helper is the ONLY posting-permission source.
  IF NOT public.recruiter_profile_can_manage_opportunities(NEW.recruiter_id) THEN
    RAISE EXCEPTION 'Complete your recruiter profile before publishing opportunities.'
      USING ERRCODE = '42501';
  END IF;

  -- Billing is no longer required: Recruiter Standard is free with a ceiling
  -- of 1 active opportunity.
  _limit := public.effective_recruiter_active_opportunity_limit(NEW.recruiter_id);
  IF _limit IS NULL OR _limit <= 0 THEN
    _limit := 1;
  END IF;

  SELECT COUNT(*)::int INTO _active_count
  FROM public.opportunities o
  WHERE o.recruiter_id = NEW.recruiter_id
    AND o.status = 'active'
    AND o.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF _active_count >= _limit THEN
    RAISE EXCEPTION 'Active opportunity limit reached for your recruiter plan.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opportunities_billing_guard ON public.opportunities;
CREATE TRIGGER trg_opportunities_billing_guard
BEFORE INSERT OR UPDATE ON public.opportunities
FOR EACH ROW EXECUTE FUNCTION public.opportunities_billing_guard();
