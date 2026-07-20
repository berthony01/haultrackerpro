-- Phase 1J-D2B-1: recruiter paid entitlement resolver functions.
-- These helpers are read-only and do not alter tables, policies, triggers, views,
-- indexes, enums, columns, or seed data. They provide a stable, server-side
-- vocabulary for checking whether a recruiter's stored billing plan meets a
-- minimum paid tier (starter / growth / fleet).

-- Plan rank helper. Only service_role may execute it.
CREATE OR REPLACE FUNCTION public._recruiter_paid_plan_rank(_plan text)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE _plan
    WHEN 'starter' THEN 1::smallint
    WHEN 'growth'  THEN 2::smallint
    WHEN 'fleet'   THEN 3::smallint
    ELSE 0::smallint
  END;
$$;

REVOKE EXECUTE ON FUNCTION public._recruiter_paid_plan_rank(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._recruiter_paid_plan_rank(text) TO service_role;


-- Recruiter-scoped entitlement check. Only service_role may execute it.
CREATE OR REPLACE FUNCTION public._recruiter_has_minimum_paid_plan(_recruiter_id uuid, _minimum_plan text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.recruiter_billing_profiles b
    WHERE b.recruiter_id = _recruiter_id
      AND b.status IN ('active', 'trialing')
      AND _recruiter_id IS NOT NULL
      AND public._recruiter_paid_plan_rank(b.plan) >= public._recruiter_paid_plan_rank(_minimum_plan)
      AND public._recruiter_paid_plan_rank(_minimum_plan) > 0
  );
$$;

REVOKE EXECUTE ON FUNCTION public._recruiter_has_minimum_paid_plan(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._recruiter_has_minimum_paid_plan(uuid, text) TO service_role;


-- Current-user entitlement check. Authenticated users and service_role may execute it.
CREATE OR REPLACE FUNCTION public.current_user_has_recruiter_minimum_paid_plan(_minimum_plan text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.recruiter_billing_profiles b
    WHERE b.user_id = auth.uid()
      AND b.status IN ('active', 'trialing')
      AND public._recruiter_paid_plan_rank(b.plan) >= public._recruiter_paid_plan_rank(_minimum_plan)
      AND public._recruiter_paid_plan_rank(_minimum_plan) > 0
  );
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_has_recruiter_minimum_paid_plan(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_recruiter_minimum_paid_plan(text) TO authenticated, service_role;
