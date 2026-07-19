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