CREATE OR REPLACE FUNCTION public.award_load_points(_load_id uuid)
RETURNS public.driver_points
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
  _is_pro boolean;
  _inserted boolean;
  _row public.driver_points;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Server-side Pro eligibility check.
  -- Mirrors useSubscription: admin override OR active subscription on a paid plan_key.
  SELECT
    public.is_admin(_uid)
    OR EXISTS (
      SELECT 1
      FROM public.subscriptions s
      WHERE s.user_id = _uid
        AND s.status = 'active'
        AND s.plan_key IN ('pro_monthly', 'pro_yearly')
    )
  INTO _is_pro;

  IF NOT _is_pro THEN
    RAISE EXCEPTION 'Pro subscription required to award load points' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO _owner
  FROM public.loads
  WHERE id = _load_id;

  IF _owner IS NULL THEN
    RAISE EXCEPTION 'Source event not found' USING ERRCODE = '22023';
  END IF;
  IF _owner <> _uid THEN
    RAISE EXCEPTION 'Not the owner of this event' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.driver_point_events (user_id, source_type, source_id, category, amount)
  VALUES (_uid, 'load', _load_id, 'load', 5)
  ON CONFLICT ON CONSTRAINT driver_point_events_unique_source DO NOTHING;

  GET DIAGNOSTICS _inserted = ROW_COUNT;

  IF _inserted THEN
    _row := public.award_points(_uid, 'load', 5);
  ELSE
    SELECT * INTO _row FROM public.driver_points WHERE user_id = _uid;
  END IF;

  RETURN _row;
END;
$function$;

-- Re-assert grants (idempotent; preserves Phase 6D lockdown)
REVOKE ALL ON FUNCTION public.award_load_points(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_load_points(uuid) TO authenticated;