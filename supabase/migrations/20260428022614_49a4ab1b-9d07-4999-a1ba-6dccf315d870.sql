-- Update lane_stats and operating_metrics to honor total_miles when present.
-- Resolves "operating miles" as: COALESCE(NULLIF(total_miles,0), loaded_miles + deadhead_miles)

CREATE OR REPLACE FUNCTION public.recompute_lane_stats(_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.lane_stats WHERE user_id = _user_id;

  INSERT INTO public.lane_stats (
    user_id, lane_key, origin_market, destination_market,
    load_count, avg_loaded_miles, avg_deadhead_miles,
    avg_rpm, avg_net_profit, avg_margin_pct,
    avg_days_to_pay, last_load_date, trend_direction
  )
  SELECT
    _user_id,
    public.build_lane_key(l.pickup_location, l.dropoff_location) AS lane_key,
    l.pickup_location AS origin_market,
    l.dropoff_location AS destination_market,
    COUNT(*)::int AS load_count,
    COALESCE(AVG(l.loaded_miles), 0) AS avg_loaded_miles,
    COALESCE(AVG(l.deadhead_miles), 0) AS avg_deadhead_miles,
    COALESCE(
      AVG(
        CASE
          WHEN COALESCE(NULLIF(l.total_miles,0), l.loaded_miles + l.deadhead_miles) > 0
          THEN COALESCE(l.actual_pay_received, l.estimated_pay, 0)
               / COALESCE(NULLIF(l.total_miles,0), l.loaded_miles + l.deadhead_miles)
          ELSE NULL
        END
      ), 0
    ) AS avg_rpm,
    COALESCE(
      AVG(
        COALESCE(l.actual_pay_received, l.estimated_pay, 0)
        - COALESCE((SELECT SUM(e.amount) FROM public.expenses e
            WHERE e.linked_load_id = l.id AND e.expense_type = 'variable'), 0)
        - COALESCE((SELECT SUM(f.total_cost) FROM public.fuel_logs f
            WHERE f.linked_load_id = l.id), 0)
      ), 0
    ) AS avg_net_profit,
    COALESCE(
      AVG(
        CASE
          WHEN COALESCE(l.actual_pay_received, l.estimated_pay, 0) > 0
          THEN (
            COALESCE(l.actual_pay_received, l.estimated_pay, 0)
            - COALESCE((SELECT SUM(e.amount) FROM public.expenses e
                WHERE e.linked_load_id = l.id AND e.expense_type = 'variable'), 0)
            - COALESCE((SELECT SUM(f.total_cost) FROM public.fuel_logs f
                WHERE f.linked_load_id = l.id), 0)
          ) / NULLIF(COALESCE(l.actual_pay_received, l.estimated_pay, 0), 0) * 100
          ELSE NULL
        END
      ), 0
    ) AS avg_margin_pct,
    AVG(
      CASE
        WHEN l.paid_date IS NOT NULL
        THEN (l.paid_date - COALESCE(l.invoice_submitted_date, l.dropoff_date, l.load_date))::numeric
        ELSE NULL
      END
    ) AS avg_days_to_pay,
    MAX(COALESCE(l.dropoff_date, l.load_date)) AS last_load_date,
    NULL::text AS trend_direction
  FROM public.loads l
  WHERE l.user_id = _user_id
    AND COALESCE(l.status,'completed') <> 'cancelled'
    AND l.pickup_location IS NOT NULL
    AND l.dropoff_location IS NOT NULL
  GROUP BY public.build_lane_key(l.pickup_location, l.dropoff_location),
           l.pickup_location, l.dropoff_location;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_operating_metrics(_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _cutoff DATE := (now() - INTERVAL '60 days')::date;
  _total_miles NUMERIC := 0;
  _loaded_miles NUMERIC := 0;
  _deadhead_miles NUMERIC := 0;
  _revenue NUMERIC := 0;
  _variable_exp NUMERIC := 0;
  _fuel_cost NUMERIC := 0;
  _cpm NUMERIC := 0;
  _fuel_cpm NUMERIC := 0;
  _dh_pct NUMERIC := 0;
  _margin_pct NUMERIC := 0;
BEGIN
  SELECT
    COALESCE(SUM(COALESCE(NULLIF(total_miles,0), loaded_miles + deadhead_miles)), 0),
    COALESCE(SUM(loaded_miles), 0),
    COALESCE(SUM(deadhead_miles), 0),
    COALESCE(SUM(COALESCE(actual_pay_received, estimated_pay, 0)), 0)
  INTO _total_miles, _loaded_miles, _deadhead_miles, _revenue
  FROM public.loads
  WHERE user_id = _user_id
    AND COALESCE(status,'completed') <> 'cancelled'
    AND COALESCE(dropoff_date, load_date) >= _cutoff;

  SELECT COALESCE(SUM(amount), 0) INTO _variable_exp
  FROM public.expenses
  WHERE user_id = _user_id AND expense_type = 'variable' AND expense_date >= _cutoff;

  SELECT COALESCE(SUM(total_cost), 0) INTO _fuel_cost
  FROM public.fuel_logs
  WHERE user_id = _user_id AND date >= _cutoff;

  IF _total_miles > 0 THEN
    _cpm := (_variable_exp + _fuel_cost) / _total_miles;
    _fuel_cpm := _fuel_cost / _total_miles;
    _dh_pct := _deadhead_miles / _total_miles * 100;
  END IF;

  IF _revenue > 0 THEN
    _margin_pct := (_revenue - _variable_exp - _fuel_cost) / _revenue * 100;
  END IF;

  INSERT INTO public.operating_metrics (
    user_id, rolling_cost_per_mile, rolling_fuel_cost_per_mile,
    rolling_deadhead_pct, rolling_margin_pct, last_recomputed_at
  )
  VALUES (_user_id, _cpm, _fuel_cpm, _dh_pct, _margin_pct, now())
  ON CONFLICT (user_id) DO UPDATE SET
    rolling_cost_per_mile = EXCLUDED.rolling_cost_per_mile,
    rolling_fuel_cost_per_mile = EXCLUDED.rolling_fuel_cost_per_mile,
    rolling_deadhead_pct = EXCLUDED.rolling_deadhead_pct,
    rolling_margin_pct = EXCLUDED.rolling_margin_pct,
    last_recomputed_at = now(),
    updated_at = now();
END;
$function$;