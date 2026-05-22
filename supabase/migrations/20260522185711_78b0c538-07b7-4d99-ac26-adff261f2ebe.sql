-- =========================================================
-- Points hardening: event-bound awards + ledger + lockdown
-- =========================================================

-- 1) Ledger table: one row per awarded source event.
CREATE TABLE IF NOT EXISTS public.driver_point_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  category text NOT NULL,
  amount integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_point_events_unique_source
    UNIQUE (source_type, source_id, category)
);

CREATE INDEX IF NOT EXISTS idx_driver_point_events_user
  ON public.driver_point_events (user_id, created_at DESC);

ALTER TABLE public.driver_point_events ENABLE ROW LEVEL SECURITY;

-- Users may read their own ledger entries. No client writes.
DROP POLICY IF EXISTS "Users view own point events" ON public.driver_point_events;
CREATE POLICY "Users view own point events"
  ON public.driver_point_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 2) Lock down the legacy general award_points so the client cannot call it.
--    SECURITY DEFINER wrappers below still execute it (function-owner rights).
REVOKE ALL ON FUNCTION public.award_points(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_points(uuid, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.award_points(uuid, text, integer) FROM authenticated;

-- 3) Event-bound RPC: parking report (5 pts, once per report).
CREATE OR REPLACE FUNCTION public.award_parking_report_points(_report_id uuid)
RETURNS public.driver_points
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
  _inserted boolean;
  _row public.driver_points;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO _owner
  FROM public.parking_reports
  WHERE id = _report_id;

  IF _owner IS NULL THEN
    RAISE EXCEPTION 'Source event not found' USING ERRCODE = '22023';
  END IF;
  IF _owner <> _uid THEN
    RAISE EXCEPTION 'Not the owner of this event' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.driver_point_events (user_id, source_type, source_id, category, amount)
  VALUES (_uid, 'parking_report', _report_id, 'parking', 5)
  ON CONFLICT ON CONSTRAINT driver_point_events_unique_source DO NOTHING;

  GET DIAGNOSTICS _inserted = ROW_COUNT;

  IF _inserted THEN
    _row := public.award_points(_uid, 'parking', 5);
  ELSE
    SELECT * INTO _row FROM public.driver_points WHERE user_id = _uid;
  END IF;

  RETURN _row;
END;
$$;

-- 4) Event-bound RPC: parking verification (3 pts, once per verification).
CREATE OR REPLACE FUNCTION public.award_parking_verification_points(_verification_id uuid)
RETURNS public.driver_points
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
  _inserted boolean;
  _row public.driver_points;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO _owner
  FROM public.parking_verifications
  WHERE id = _verification_id;

  IF _owner IS NULL THEN
    RAISE EXCEPTION 'Source event not found' USING ERRCODE = '22023';
  END IF;
  IF _owner <> _uid THEN
    RAISE EXCEPTION 'Not the owner of this event' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.driver_point_events (user_id, source_type, source_id, category, amount)
  VALUES (_uid, 'parking_verification', _verification_id, 'parking', 3)
  ON CONFLICT ON CONSTRAINT driver_point_events_unique_source DO NOTHING;

  GET DIAGNOSTICS _inserted = ROW_COUNT;

  IF _inserted THEN
    _row := public.award_points(_uid, 'parking', 3);
  ELSE
    SELECT * INTO _row FROM public.driver_points WHERE user_id = _uid;
  END IF;

  RETURN _row;
END;
$$;

-- 5) Event-bound RPC: load logged (5 pts, once per load).
CREATE OR REPLACE FUNCTION public.award_load_points(_load_id uuid)
RETURNS public.driver_points
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
  _inserted boolean;
  _row public.driver_points;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
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
$$;

-- 6) Lock down execution: only signed-in users may call the event-bound RPCs.
REVOKE ALL ON FUNCTION public.award_parking_report_points(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_parking_report_points(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.award_parking_report_points(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.award_parking_verification_points(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_parking_verification_points(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.award_parking_verification_points(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.award_load_points(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_load_points(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.award_load_points(uuid) TO authenticated;