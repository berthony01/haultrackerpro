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
          'Driver #' || lpad((abs(hashtext(d.user_id::text)) % 10000)::text, 4, '0')
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