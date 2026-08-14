-- =====================================================================
-- Phase DA-1 — Driver <-> Driver Assistant relationship final hardening
--
-- Atomic, dedicated to DA-1. Four concerns only:
--   1. canonical Driver Pro entitlement helper
--   2. assistant_has_permission fails closed for DIRECT assistants when the
--      driver no longer holds active Driver Pro (agency-delegated rows keep
--      their existing behavior, unchanged)
--   3. get_my_managed_drivers exposes driver_is_pro and stops returning
--      non-Pro DIRECT relationships as actionable managed drivers
--   4. plan-loss cleanup of DIRECT assistant rows + narrow report-settings
--      read RPC for authorized assistants
--
-- No agency behavior, no recruiter behavior, no billing amounts touched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Canonical Driver Pro entitlement
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_has_active_pro(_driver uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    _driver IS NOT NULL
    AND (
      public.is_admin(_driver)
      OR EXISTS (
        SELECT 1
        FROM public.subscriptions s
        WHERE s.user_id = _driver
          AND s.status = 'active'
          AND s.plan_key IN ('pro_monthly', 'pro_yearly')
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.driver_has_active_pro(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_has_active_pro(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_has_active_pro(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 2. Fail-closed authorization for DIRECT assistants
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assistant_has_permission(_assistant uuid, _driver uuid, _perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.driver_assistants da
    WHERE da.assistant_user_id = _assistant
      AND da.driver_user_id    = _driver
      AND da.status            = 'active'
      AND COALESCE((da.permissions ->> _perm)::boolean, false) = true
      AND (
        -- Agency-delegated relationships keep their existing authorization.
        da.agency_delegation_id IS NOT NULL
        -- Direct relationships require the DRIVER's active Pro entitlement.
        OR public.driver_has_active_pro(da.driver_user_id)
      )
  );
$function$;

-- ---------------------------------------------------------------------
-- 3. Managed-driver list: expose driver_is_pro, hide stale direct rows
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_managed_drivers()
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'delegate_id', da.id,
    'driver_user_id', da.driver_user_id,
    'driver_email', lower(u.email),
    'driver_name', COALESCE(p.display_name, lower(u.email)),
    'permissions', da.permissions,
    'accepted_at', da.accepted_at,
    'last_active_at', da.last_active_at,
    'driver_is_pro', public.driver_has_active_pro(da.driver_user_id)
  )
  FROM public.driver_assistants da
  JOIN auth.users u ON u.id = da.driver_user_id
  LEFT JOIN public.profiles p ON p.user_id = da.driver_user_id
  WHERE da.assistant_user_id = _uid
    AND da.status = 'active'
    AND (
      da.agency_delegation_id IS NOT NULL
      OR public.driver_has_active_pro(da.driver_user_id)
    )
  ORDER BY da.accepted_at DESC NULLS LAST;
END;
$function$;

-- ---------------------------------------------------------------------
-- 4a. Plan-loss cleanup — DIRECT assistant rows only
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_direct_assistants_on_driver_pro_end(_driver_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row public.driver_assistants;
  _count integer := 0;
BEGIN
  IF _driver_user_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR _row IN
    UPDATE public.driver_assistants da
       SET status            = 'revoked',
           revoked_at        = COALESCE(da.revoked_at, now()),
           invite_token_hash = NULL,
           updated_at        = now()
     WHERE da.driver_user_id = _driver_user_id
       AND da.agency_delegation_id IS NULL
       AND da.status IN ('pending', 'active')
    RETURNING da.*
  LOOP
    _count := _count + 1;
    INSERT INTO public.assistant_audit_log
      (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
    VALUES
      (_row.id, _row.driver_user_id, _row.assistant_user_id, 'assistant_revoked',
       'driver_assistants', _row.id,
       jsonb_build_object('reason', 'driver_pro_ended', 'source', 'phase_da1'));
  END LOOP;

  RETURN _count;
END;
$function$;

REVOKE ALL ON FUNCTION public.revoke_direct_assistants_on_driver_pro_end(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_direct_assistants_on_driver_pro_end(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 4b. Narrow report-settings read for driver-or-authorized-assistant
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_driver_report_settings(_driver_user_id uuid)
RETURNS TABLE (
  company_name text,
  company_start_date date,
  week_start_day text,
  currency text,
  tax_estimator_enabled boolean,
  federal_tax_percent numeric,
  state_tax_percent numeric,
  include_se_tax boolean,
  se_tax_percent numeric,
  buffer_percent numeric,
  tax_base_type text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR _driver_user_id IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF _uid <> _driver_user_id
     AND NOT public.assistant_has_permission(_uid, _driver_user_id, 'view_reports')
     AND NOT public.assistant_has_permission(_uid, _driver_user_id, 'export_reports')
  THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    us.company_name,
    us.company_start_date,
    us.week_start_day,
    us.currency,
    us.tax_estimator_enabled,
    us.federal_tax_percent,
    us.state_tax_percent,
    us.include_se_tax,
    us.se_tax_percent,
    us.buffer_percent,
    us.tax_base_type
  FROM public.user_settings us
  WHERE us.user_id = _driver_user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_driver_report_settings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_driver_report_settings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_driver_report_settings(uuid) TO service_role;
