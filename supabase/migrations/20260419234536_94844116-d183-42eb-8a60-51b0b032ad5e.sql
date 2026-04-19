CREATE OR REPLACE FUNCTION public.build_lane_key(_pickup TEXT, _dropoff TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(coalesce(_pickup,'')) || ' -> ' || trim(coalesce(_dropoff,''))
$$;