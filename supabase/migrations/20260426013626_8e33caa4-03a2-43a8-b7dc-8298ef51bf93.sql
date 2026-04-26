-- 1. Verification anti-spam: hour bucket + trigger + unique index
ALTER TABLE public.parking_verifications
  ADD COLUMN IF NOT EXISTS verification_hour_bucket timestamptz NOT NULL DEFAULT now();

UPDATE public.parking_verifications
  SET verification_hour_bucket = date_trunc('hour', created_at)
  WHERE verification_hour_bucket IS DISTINCT FROM date_trunc('hour', created_at);

CREATE OR REPLACE FUNCTION public.set_parking_verification_hour_bucket()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.verification_hour_bucket := date_trunc('hour', COALESCE(NEW.created_at, now()));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_parking_verification_hour_bucket ON public.parking_verifications;
CREATE TRIGGER trg_set_parking_verification_hour_bucket
  BEFORE INSERT ON public.parking_verifications
  FOR EACH ROW EXECUTE FUNCTION public.set_parking_verification_hour_bucket();

CREATE UNIQUE INDEX IF NOT EXISTS parking_verifications_one_per_hour
  ON public.parking_verifications (parking_id, user_id, verification_hour_bucket);

-- 2. Realtime for verifications (idempotent)
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.parking_verifications';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- 3. Leaderboard RPC
CREATE OR REPLACE FUNCTION public.get_weekly_driver_leaderboard(_limit integer DEFAULT 10)
RETURNS TABLE (
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
STABLE
SECURITY DEFINER
SET search_path TO 'public'
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
      COALESCE(NULLIF(trim(p.display_name), ''),
        'Driver #' || substr(d.user_id::text, length(d.user_id::text) - 3)
      ) AS masked_display_name
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

REVOKE ALL ON FUNCTION public.get_weekly_driver_leaderboard(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_weekly_driver_leaderboard(integer) TO authenticated;