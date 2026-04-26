-- =========================================================
-- Tier 1: Make the Leaderboard Personal
-- =========================================================

-- 1) Profiles: optional public handle
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS driver_handle text,
  ADD COLUMN IF NOT EXISTS handle_emoji text,
  ADD COLUMN IF NOT EXISTS handle_public boolean NOT NULL DEFAULT false;

-- Case-insensitive uniqueness only for public handles
CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle_public_unique
  ON public.profiles (lower(driver_handle))
  WHERE handle_public = true AND driver_handle IS NOT NULL;

-- Validation trigger
CREATE OR REPLACE FUNCTION public.validate_driver_handle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  reserved text[] := ARRAY[
    'admin','administrator','support','help','system','null','undefined',
    'lovable','haultracker','haultrackerpro','root','owner','staff',
    'moderator','mod','official','api','www','mail','bot'
  ];
BEGIN
  IF NEW.driver_handle IS NOT NULL THEN
    -- Normalize
    NEW.driver_handle := lower(trim(NEW.driver_handle));
    IF NEW.driver_handle = '' THEN
      NEW.driver_handle := NULL;
    ELSE
      IF length(NEW.driver_handle) < 3 OR length(NEW.driver_handle) > 20 THEN
        RAISE EXCEPTION 'Handle must be 3–20 characters' USING ERRCODE = '22023';
      END IF;
      IF NEW.driver_handle !~ '^[a-z0-9_]+$' THEN
        RAISE EXCEPTION 'Handle can only contain letters, numbers, and underscores' USING ERRCODE = '22023';
      END IF;
      IF NEW.driver_handle = ANY(reserved) THEN
        RAISE EXCEPTION 'That handle is reserved' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  -- Validate emoji length (single emoji ~ keep small)
  IF NEW.handle_emoji IS NOT NULL THEN
    NEW.handle_emoji := trim(NEW.handle_emoji);
    IF NEW.handle_emoji = '' THEN
      NEW.handle_emoji := NULL;
    ELSIF length(NEW.handle_emoji) > 8 THEN
      RAISE EXCEPTION 'Emoji is too long' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Can't be public without a handle
  IF NEW.handle_public = true AND NEW.driver_handle IS NULL THEN
    NEW.handle_public := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_validate_handle ON public.profiles;
CREATE TRIGGER profiles_validate_handle
BEFORE INSERT OR UPDATE OF driver_handle, handle_emoji, handle_public ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.validate_driver_handle();

-- =========================================================
-- 2) Driver points: personal best
-- =========================================================
ALTER TABLE public.driver_points
  ADD COLUMN IF NOT EXISTS best_weekly_points integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS best_weekly_period_start date;

-- Backfill: take current weekly_points as initial best if higher
UPDATE public.driver_points
SET best_weekly_points = GREATEST(best_weekly_points, COALESCE(weekly_points, 0)),
    best_weekly_period_start = COALESCE(best_weekly_period_start, weekly_period_start)
WHERE best_weekly_points = 0;

-- =========================================================
-- 3) Update award_points: capture personal best on weekly rollover
-- =========================================================
CREATE OR REPLACE FUNCTION public.award_points(_user_id uuid, _category text, _amount integer)
RETURNS driver_points
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _week_start date := date_trunc('week', _today)::date;
  _row public.driver_points;
BEGIN
  IF _category NOT IN ('parking','load') THEN
    RAISE EXCEPTION 'Invalid points category: %', _category;
  END IF;

  -- Ensure row exists
  INSERT INTO public.driver_points (user_id, weekly_period_start)
  VALUES (_user_id, _week_start)
  ON CONFLICT (user_id) DO NOTHING;

  -- On week rollover: snapshot prior week into best if it beats current best, then reset
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

-- =========================================================
-- 4) Update leaderboard RPC to use public handle when set
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_weekly_driver_leaderboard(_limit integer DEFAULT 10)
RETURNS TABLE(
  user_id uuid,
  weekly_points integer,
  total_points integer,
  parking_points integer,
  load_points integer,
  streak_days integer,
  tier text,
  rank integer,
  masked_display_name text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT
      d.user_id,
      d.weekly_points,
      d.total_points,
      d.parking_points,
      d.load_points,
      d.streak_days,
      d.last_activity_date,
      CASE
        WHEN d.total_points >= 400 THEN 'Platinum'
        WHEN d.total_points >= 150 THEN 'Gold'
        WHEN d.total_points >= 50 THEN 'Silver'
        ELSE 'Bronze'
      END AS tier,
      ROW_NUMBER() OVER (
        ORDER BY d.weekly_points DESC,
                 d.total_points DESC,
                 d.last_activity_date ASC NULLS LAST
      )::int AS rank,
      CASE
        WHEN p.handle_public = true AND p.driver_handle IS NOT NULL THEN
          p.driver_handle ||
          CASE WHEN p.handle_emoji IS NOT NULL THEN ' ' || p.handle_emoji ELSE '' END
        ELSE
          'Driver #' || substr(d.user_id::text, length(d.user_id::text) - 3)
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
$$;

GRANT EXECUTE ON FUNCTION public.get_weekly_driver_leaderboard(integer) TO authenticated;