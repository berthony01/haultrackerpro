-- =====================================================================
-- Root-cause fix for live defect:
--   POST /rpc/get_my_managed_drivers → 400
--   {"code":"42703","message":"column p.full_name does not exist"}
--
-- Origin: public.get_my_managed_drivers references p.full_name, but
-- public.profiles has no full_name column (only display_name). Every
-- call raises 42703, blocking the Assistant driver switcher and any
-- surface that lists managed drivers.
--
-- Canonical fix: drop the non-existent p.full_name from COALESCE.
-- display_name already covers the friendly-name slot; lower(u.email)
-- remains the fallback. No signature, grants, RLS, or trigger changes.
--
-- Candidate migration — do NOT move to supabase/migrations/ without
-- explicit approval.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_my_managed_drivers()
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
    'last_active_at', da.last_active_at
  )
  FROM public.driver_assistants da
  JOIN auth.users u ON u.id = da.driver_user_id
  LEFT JOIN public.profiles p ON p.user_id = da.driver_user_id
  WHERE da.assistant_user_id = _uid
    AND da.status = 'active'
  ORDER BY da.accepted_at DESC NULLS LAST;
END;
$function$;
