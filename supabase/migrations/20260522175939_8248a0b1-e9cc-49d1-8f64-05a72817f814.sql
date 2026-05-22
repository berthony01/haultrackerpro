-- Harden public.award_points: ownership, auth, category + amount allowlist.
-- Preserves existing signature, return type, and all legitimate accounting logic
-- (total/weekly/parking/load points, streak, weekly rollover, best_weekly_*).

CREATE OR REPLACE FUNCTION public.award_points(_user_id uuid, _category text, _amount integer)
RETURNS public.driver_points
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _week_start date := date_trunc('week', _today)::date;
  _row public.driver_points;
BEGIN
  -- 1) Require authenticated caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- 2) Caller may only award points to themselves
  IF _user_id IS NULL OR _user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Cannot award points to another user' USING ERRCODE = '42501';
  END IF;

  -- 3) Allowlist categories actually used by the app
  IF _category NOT IN ('parking','load') THEN
    RAISE EXCEPTION 'Invalid points category: %', _category USING ERRCODE = '22023';
  END IF;

  -- 4) Allowlist exact amounts actually used by the app:
  --    parking: 5 (report) or 3 (verification)
  --    load:    5 (load logged)
  IF (_category = 'parking' AND _amount NOT IN (3, 5))
     OR (_category = 'load'    AND _amount <> 5) THEN
    RAISE EXCEPTION 'Invalid points amount % for category %', _amount, _category
      USING ERRCODE = '22023';
  END IF;

  -- Ensure row exists
  INSERT INTO public.driver_points (user_id, weekly_period_start)
  VALUES (_user_id, _week_start)
  ON CONFLICT (user_id) DO NOTHING;

  -- Weekly rollover: snapshot prior week if it beats best, then reset
  UPDATE public.driver_points
  SET
    best_weekly_points = CASE
      WHEN weekly_points > best_weekly_points THEN weekly_points
      ELSE best_weekly_points
    END,
    best_weekly_period_start = CASE
      WHEN weekly_points > best_weekly_points THEN weekly_period_start
      ELSE best_weekly_period_start
    END,
    weekly_points = 0,
    weekly_period_start = _week_start
  WHERE user_id = _user_id
    AND (weekly_period_start IS NULL OR weekly_period_start < _week_start);

  -- Streak + add points
  UPDATE public.driver_points
  SET streak_days = CASE
        WHEN last_activity_date = _today THEN streak_days
        WHEN last_activity_date = (_today - 1) THEN streak_days + 1
        ELSE 1
      END,
      last_activity_date = _today,
      total_points = total_points + _amount,
      weekly_points = weekly_points + _amount,
      parking_points = parking_points + CASE WHEN _category = 'parking' THEN _amount ELSE 0 END,
      load_points = load_points + CASE WHEN _category = 'load' THEN _amount ELSE 0 END,
      best_weekly_points = GREATEST(best_weekly_points, weekly_points + _amount),
      best_weekly_period_start = CASE
        WHEN (weekly_points + _amount) > best_weekly_points THEN weekly_period_start
        ELSE best_weekly_period_start
      END,
      updated_at = now()
  WHERE user_id = _user_id
  RETURNING * INTO _row;

  RETURN _row;
END;
$$;

-- Lock down execution: only signed-in users may call.
REVOKE ALL ON FUNCTION public.award_points(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_points(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.award_points(uuid, text, integer) TO authenticated;