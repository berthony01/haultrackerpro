-- =========================================
-- PHASE 2: Recompute Pipeline (per-user only)
-- =========================================

-- Helper: build a stable lane key from pickup/dropoff
CREATE OR REPLACE FUNCTION public.build_lane_key(_pickup TEXT, _dropoff TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(coalesce(_pickup,'')) || ' -> ' || trim(coalesce(_dropoff,''))
$$;

-- =========================================
-- 2A: Recompute LANE STATS for a user
-- =========================================
CREATE OR REPLACE FUNCTION public.recompute_lane_stats(_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Wipe and rebuild this user's lane stats only
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
    -- effective RPM = revenue / (loaded + deadhead)
    COALESCE(
      AVG(
        CASE
          WHEN (l.loaded_miles + l.deadhead_miles) > 0
          THEN COALESCE(l.actual_pay_received, l.estimated_pay, 0)
               / (l.loaded_miles + l.deadhead_miles)
          ELSE NULL
        END
      ), 0
    ) AS avg_rpm,
    -- net profit per load = revenue - linked variable expenses - linked fuel
    COALESCE(
      AVG(
        COALESCE(l.actual_pay_received, l.estimated_pay, 0)
        - COALESCE((
            SELECT SUM(e.amount) FROM public.expenses e
            WHERE e.linked_load_id = l.id AND e.expense_type = 'variable'
          ), 0)
        - COALESCE((
            SELECT SUM(f.total_cost) FROM public.fuel_logs f
            WHERE f.linked_load_id = l.id
          ), 0)
      ), 0
    ) AS avg_net_profit,
    -- margin %
    COALESCE(
      AVG(
        CASE
          WHEN COALESCE(l.actual_pay_received, l.estimated_pay, 0) > 0
          THEN (
            COALESCE(l.actual_pay_received, l.estimated_pay, 0)
            - COALESCE((
                SELECT SUM(e.amount) FROM public.expenses e
                WHERE e.linked_load_id = l.id AND e.expense_type = 'variable'
              ), 0)
            - COALESCE((
                SELECT SUM(f.total_cost) FROM public.fuel_logs f
                WHERE f.linked_load_id = l.id
              ), 0)
          ) / NULLIF(COALESCE(l.actual_pay_received, l.estimated_pay, 0), 0) * 100
          ELSE NULL
        END
      ), 0
    ) AS avg_margin_pct,
    -- days to pay (paid_date - invoice/dropoff)
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
    AND COALESCE(l.status, 'completed') <> 'cancelled'
    AND l.pickup_location IS NOT NULL
    AND l.dropoff_location IS NOT NULL
    AND length(trim(l.pickup_location)) > 0
    AND length(trim(l.dropoff_location)) > 0
  GROUP BY l.pickup_location, l.dropoff_location
  HAVING COUNT(*) >= 1;
END;
$$;

-- =========================================
-- 2B: Recompute BROKER STATS for a user
-- =========================================
CREATE OR REPLACE FUNCTION public.recompute_broker_stats(_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.broker_stats WHERE user_id = _user_id;

  INSERT INTO public.broker_stats (
    user_id, broker_id, load_count,
    avg_estimated_pay, avg_actual_pay, avg_variance_amount,
    short_pay_count, days_to_invoice_avg, days_to_pay_avg,
    unpaid_count, reliability_score, last_load_date
  )
  SELECT
    _user_id,
    l.broker_id,
    COUNT(*)::int AS load_count,
    COALESCE(AVG(l.estimated_pay), 0) AS avg_estimated_pay,
    COALESCE(AVG(l.actual_pay_received), 0) AS avg_actual_pay,
    COALESCE(AVG(COALESCE(l.actual_pay_received,0) - COALESCE(l.estimated_pay,0)), 0) AS avg_variance_amount,
    COUNT(*) FILTER (WHERE l.payment_status = 'short_paid' OR COALESCE(l.short_paid_amount,0) > 0)::int AS short_pay_count,
    AVG(
      CASE WHEN l.invoice_submitted_date IS NOT NULL
        THEN (l.invoice_submitted_date - COALESCE(l.dropoff_date, l.load_date))::numeric
      END
    ) AS days_to_invoice_avg,
    AVG(
      CASE WHEN l.paid_date IS NOT NULL
        THEN (l.paid_date - COALESCE(l.invoice_submitted_date, l.dropoff_date, l.load_date))::numeric
      END
    ) AS days_to_pay_avg,
    COUNT(*) FILTER (WHERE l.payment_status IN ('unpaid','overdue'))::int AS unpaid_count,
    -- Reliability score 0-100, deterministic
    GREATEST(0, LEAST(100,
      100
      - (COUNT(*) FILTER (WHERE l.payment_status='short_paid' OR COALESCE(l.short_paid_amount,0) > 0)::numeric
         / NULLIF(COUNT(*),0) * 40)
      - (COUNT(*) FILTER (WHERE l.payment_status='overdue')::numeric
         / NULLIF(COUNT(*),0) * 30)
      - LEAST(30,
          GREATEST(0,
            COALESCE(
              AVG(
                CASE WHEN l.paid_date IS NOT NULL
                  THEN (l.paid_date - COALESCE(l.invoice_submitted_date, l.dropoff_date, l.load_date))::numeric
                END
              ), 0
            ) - 30
          )
        )
    )) AS reliability_score,
    MAX(COALESCE(l.dropoff_date, l.load_date)) AS last_load_date
  FROM public.loads l
  WHERE l.user_id = _user_id
    AND l.broker_id IS NOT NULL
    AND COALESCE(l.status, 'completed') <> 'cancelled'
  GROUP BY l.broker_id;
END;
$$;

-- =========================================
-- 2C: Recompute OPERATING METRICS for a user (rolling 90 days)
-- =========================================
CREATE OR REPLACE FUNCTION public.recompute_operating_metrics(_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cutoff DATE := (now() - interval '90 days')::date;
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
    COALESCE(SUM(loaded_miles + deadhead_miles), 0),
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
  WHERE user_id = _user_id
    AND expense_type = 'variable'
    AND expense_date >= _cutoff;

  SELECT COALESCE(SUM(total_cost), 0) INTO _fuel_cost
  FROM public.fuel_logs
  WHERE user_id = _user_id
    AND date >= _cutoff;

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
$$;

-- =========================================
-- 2D: Convenience: recompute all for a user
-- =========================================
CREATE OR REPLACE FUNCTION public.recompute_personal_intelligence(_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_lane_stats(_user_id);
  PERFORM public.recompute_broker_stats(_user_id);
  PERFORM public.recompute_operating_metrics(_user_id);
END;
$$;

-- =========================================
-- 2E: Trigger functions (per-row, fire-and-recompute the affected user only)
-- =========================================
CREATE OR REPLACE FUNCTION public.trg_recompute_on_load_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  IF _uid IS NOT NULL THEN
    PERFORM public.recompute_lane_stats(_uid);
    PERFORM public.recompute_broker_stats(_uid);
    PERFORM public.recompute_operating_metrics(_uid);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_recompute_on_expense_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  IF _uid IS NOT NULL THEN
    PERFORM public.recompute_lane_stats(_uid);
    PERFORM public.recompute_operating_metrics(_uid);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_recompute_on_fuel_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  IF _uid IS NOT NULL THEN
    PERFORM public.recompute_lane_stats(_uid);
    PERFORM public.recompute_operating_metrics(_uid);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Drop existing triggers if any (idempotent)
DROP TRIGGER IF EXISTS recompute_pi_on_load ON public.loads;
DROP TRIGGER IF EXISTS recompute_pi_on_expense ON public.expenses;
DROP TRIGGER IF EXISTS recompute_pi_on_fuel ON public.fuel_logs;

CREATE TRIGGER recompute_pi_on_load
  AFTER INSERT OR UPDATE OR DELETE ON public.loads
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_on_load_change();

CREATE TRIGGER recompute_pi_on_expense
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_on_expense_change();

CREATE TRIGGER recompute_pi_on_fuel
  AFTER INSERT OR UPDATE OR DELETE ON public.fuel_logs
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_on_fuel_change();
