-- TG-G1 financial trigger parity fixture.
-- DISPOSABLE LOCAL TRANSACTION ONLY: installed inside an uncommitted transaction
-- on the throwaway PostgreSQL 17.11 socket harness and always rolled back.
-- NEVER a production migration. Function bodies and trigger definitions are the
-- verified production texts (prosrc MD5-pinned by the test); schema is a
-- read-only projection of verified production columns/constraints/indexes.

-- Extend the harness minimal loads projection to all 40 verified columns.
ALTER TABLE public.loads
  ADD COLUMN load_date date,
  ADD COLUMN pickup_location text,
  ADD COLUMN dropoff_location text,
  ADD COLUMN notes text,
  ADD COLUMN dropoff_date date,
  ADD COLUMN invoice_submitted_date date,
  ADD COLUMN pod_submitted_date date,
  ADD COLUMN payment_due_date date,
  ADD COLUMN paid_date date,
  ADD COLUMN short_paid_amount numeric DEFAULT 0,
  ADD COLUMN payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN payment_notes text,
  ADD COLUMN broker_id uuid,
  ADD COLUMN broker_name_raw text,
  ADD COLUMN pay_model text,
  ADD COLUMN deadhead_rate_per_mile numeric,
  ADD COLUMN deadhead_pay_status text,
  ADD COLUMN deadhead_pay_amount numeric,
  ADD COLUMN created_by_user_id uuid,
  ADD COLUMN assistant_delegate_id uuid,
  ADD COLUMN origin_channel text NOT NULL DEFAULT 'web',
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Fill missing required fields ONLY in pre-existing synthetic seed rows
-- deterministically before SET NOT NULL. No production defaults are invented
-- for date/location columns (production has none).
UPDATE public.loads
   SET load_date = CURRENT_DATE,
       pickup_location = 'Fixture Origin, AA',
       dropoff_location = 'Fixture Destination, BB'
 WHERE load_date IS NULL OR pickup_location IS NULL OR dropoff_location IS NULL;
ALTER TABLE public.loads
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'completed',
  ALTER COLUMN load_date SET NOT NULL,
  ALTER COLUMN pickup_location SET NOT NULL,
  ALTER COLUMN dropoff_location SET NOT NULL;

-- Verified production checks/foreign keys (validated).
ALTER TABLE public.loads
  DROP CONSTRAINT loads_user_id_fkey,
  ADD CONSTRAINT loads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  DROP CONSTRAINT loads_carrier_driver_relationship_id_fkey,
  ADD CONSTRAINT loads_carrier_driver_relationship_id_fkey FOREIGN KEY (carrier_driver_relationship_id) REFERENCES public.carrier_driver_relationships(id) ON DELETE SET NULL,
  ADD CONSTRAINT loads_total_miles_component_consistency_check CHECK (((total_miles IS NULL) OR ((total_miles >= (0)::numeric) AND (((loaded_miles + deadhead_miles) = (0)::numeric) OR (abs((total_miles - (loaded_miles + deadhead_miles))) <= (2)::numeric))))),
  ADD CONSTRAINT loads_deadhead_pay_status_check CHECK (((deadhead_pay_status IS NULL) OR (deadhead_pay_status = ANY (ARRAY['unpaid'::text, 'per_mile'::text, 'flat'::text])))),
  ADD CONSTRAINT loads_load_reference_length_check CHECK (((load_reference IS NULL) OR (char_length(load_reference) <= 200))),
  ADD CONSTRAINT loads_origin_channel_check CHECK ((origin_channel = ANY (ARRAY['web'::text, 'telegram'::text, 'import'::text, 'api'::text])));

CREATE TABLE public.brokers(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  mc_number text,
  email text,
  phone text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.expenses(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  expense_date date NOT NULL,
  category text NOT NULL,
  amount numeric NOT NULL,
  gallons numeric,
  linked_load_id uuid REFERENCES public.loads(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expense_type text NOT NULL DEFAULT 'variable',
  created_by_user_id uuid,
  updated_by_user_id uuid,
  assistant_delegate_id uuid REFERENCES public.driver_assistants(id) ON DELETE SET NULL);

CREATE TABLE public.fuel_logs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  date date NOT NULL,
  station text,
  gallons numeric NOT NULL,
  price_per_gallon numeric NOT NULL,
  total_cost numeric NOT NULL,
  odometer numeric,
  linked_load_id uuid REFERENCES public.loads(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid,
  updated_by_user_id uuid,
  assistant_delegate_id uuid REFERENCES public.driver_assistants(id) ON DELETE SET NULL);

CREATE TABLE public.lane_stats(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lane_key text NOT NULL,
  origin_market text,
  destination_market text,
  load_count integer NOT NULL DEFAULT 0,
  avg_loaded_miles numeric NOT NULL DEFAULT 0,
  avg_deadhead_miles numeric NOT NULL DEFAULT 0,
  avg_rpm numeric NOT NULL DEFAULT 0,
  avg_net_profit numeric NOT NULL DEFAULT 0,
  avg_margin_pct numeric NOT NULL DEFAULT 0,
  avg_days_to_pay numeric,
  last_load_date date,
  trend_direction text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.broker_stats(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  broker_id uuid NOT NULL REFERENCES public.brokers(id) ON DELETE CASCADE,
  load_count integer NOT NULL DEFAULT 0,
  avg_estimated_pay numeric NOT NULL DEFAULT 0,
  avg_actual_pay numeric NOT NULL DEFAULT 0,
  avg_variance_amount numeric NOT NULL DEFAULT 0,
  short_pay_count integer NOT NULL DEFAULT 0,
  days_to_invoice_avg numeric,
  days_to_pay_avg numeric,
  unpaid_count integer NOT NULL DEFAULT 0,
  reliability_score numeric,
  last_load_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.operating_metrics(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rolling_cost_per_mile numeric NOT NULL DEFAULT 0,
  rolling_fuel_cost_per_mile numeric NOT NULL DEFAULT 0,
  rolling_deadhead_pct numeric NOT NULL DEFAULT 0,
  rolling_margin_pct numeric NOT NULL DEFAULT 0,
  last_recomputed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id));

CREATE TABLE public.assistant_audit_log(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegate_id uuid NOT NULL REFERENCES public.driver_assistants(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL,
  assistant_user_id uuid NOT NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE public.loads
  ADD CONSTRAINT loads_broker_id_fkey FOREIGN KEY (broker_id) REFERENCES public.brokers(id) ON DELETE SET NULL,
  ADD CONSTRAINT loads_assistant_delegate_id_fkey FOREIGN KEY (assistant_delegate_id) REFERENCES public.driver_assistants(id) ON DELETE SET NULL;

-- Real nullable last_active_at on the existing assistant fixture table.
ALTER TABLE public.driver_assistants ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

-- Verified production secondary indexes.
CREATE INDEX idx_broker_stats_user_id ON public.broker_stats USING btree (user_id);
CREATE UNIQUE INDEX idx_broker_stats_user_broker_unique ON public.broker_stats USING btree (user_id, broker_id);
CREATE INDEX idx_lane_stats_user_id ON public.lane_stats USING btree (user_id);
CREATE UNIQUE INDEX idx_lane_stats_user_lane_unique ON public.lane_stats USING btree (user_id, lane_key);
CREATE INDEX idx_operating_metrics_user_id ON public.operating_metrics USING btree (user_id);

GRANT ALL ON public.brokers, public.expenses, public.fuel_logs, public.lane_stats, public.broker_stats, public.operating_metrics, public.assistant_audit_log TO service_role;

-- Exact verified production function bodies (prosrc MD5-pinned by the test).
CREATE OR REPLACE FUNCTION public.build_lane_key(_pickup text, _dropoff text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT trim(coalesce(_pickup,'')) || ' -> ' || trim(coalesce(_dropoff,''))
$function$;

CREATE OR REPLACE FUNCTION public.recompute_broker_stats(_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

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

CREATE OR REPLACE FUNCTION public.tg_assistant_audit_and_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _delegate_id uuid;
  _action text;
BEGIN
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF _uid = NEW.user_id THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by_user_id := COALESCE(NEW.created_by_user_id, _uid);
    END IF;
    NEW.updated_by_user_id := _uid;
    RETURN NEW;
  END IF;

  SELECT id INTO _delegate_id
    FROM public.driver_assistants
   WHERE assistant_user_id = _uid
     AND driver_user_id    = NEW.user_id
     AND status            = 'active'
   LIMIT 1;

  IF _delegate_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by_user_id    := _uid;
    NEW.assistant_delegate_id := _delegate_id;
    _action := 'create_' || TG_TABLE_NAME;
  ELSE
    -- Stamp delegate id on updates too so post-hoc audits can attribute the change.
    NEW.assistant_delegate_id := _delegate_id;
    _action := 'update_' || TG_TABLE_NAME;
  END IF;
  NEW.updated_by_user_id := _uid;

  INSERT INTO public.assistant_audit_log
    (delegate_id, driver_user_id, assistant_user_id, action, entity_type, entity_id, metadata)
  VALUES
    (_delegate_id, NEW.user_id, _uid, _action, TG_TABLE_NAME, NEW.id, '{}'::jsonb);

  UPDATE public.driver_assistants
     SET last_active_at = now()
   WHERE id = _delegate_id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_recompute_on_load_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_recompute_on_expense_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid UUID := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  IF _uid IS NOT NULL THEN
    PERFORM public.recompute_lane_stats(_uid);
    PERFORM public.recompute_operating_metrics(_uid);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_recompute_on_fuel_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid UUID := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  IF _uid IS NOT NULL THEN
    PERFORM public.recompute_lane_stats(_uid);
    PERFORM public.recompute_operating_metrics(_uid);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Exact verified production trigger definitions.
CREATE TRIGGER recompute_pi_on_load AFTER INSERT OR DELETE OR UPDATE ON public.loads FOR EACH ROW EXECUTE FUNCTION trg_recompute_on_load_change();
CREATE TRIGGER tg_assistant_audit_loads BEFORE INSERT OR UPDATE ON public.loads FOR EACH ROW EXECUTE FUNCTION tg_assistant_audit_and_metadata();
CREATE TRIGGER update_loads_updated_at BEFORE UPDATE ON public.loads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER recompute_pi_on_expense AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION trg_recompute_on_expense_change();
CREATE TRIGGER tg_assistant_audit_expenses BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION tg_assistant_audit_and_metadata();
CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER recompute_pi_on_fuel AFTER INSERT OR DELETE OR UPDATE ON public.fuel_logs FOR EACH ROW EXECUTE FUNCTION trg_recompute_on_fuel_change();
CREATE TRIGGER tg_assistant_audit_fuel_logs BEFORE INSERT OR UPDATE ON public.fuel_logs FOR EACH ROW EXECUTE FUNCTION tg_assistant_audit_and_metadata();
CREATE TRIGGER update_fuel_logs_updated_at BEFORE UPDATE ON public.fuel_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_lane_stats_updated_at BEFORE UPDATE ON public.lane_stats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_broker_stats_updated_at BEFORE UPDATE ON public.broker_stats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_operating_metrics_updated_at BEFORE UPDATE ON public.operating_metrics FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
