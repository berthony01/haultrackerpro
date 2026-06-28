
CREATE OR REPLACE FUNCTION public.assistant_delete_load_stops(_driver uuid, _load_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _deleted integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.assistant_has_permission(_uid, _driver, 'manage_loads') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.loads WHERE id = _load_id AND user_id = _driver) THEN
    RAISE EXCEPTION 'Load not found' USING ERRCODE = 'P0002';
  END IF;

  WITH d AS (
    DELETE FROM public.load_stops
     WHERE user_id = _driver AND load_id = _load_id
    RETURNING 1
  )
  SELECT count(*)::int INTO _deleted FROM d;
  RETURN COALESCE(_deleted, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.assistant_delete_load_stops(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_delete_load_stops(uuid,uuid) TO authenticated;
