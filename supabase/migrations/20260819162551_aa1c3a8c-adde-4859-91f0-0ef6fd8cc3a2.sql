ALTER FUNCTION public.canonical_load_operating_miles(numeric,numeric,numeric)
  SET search_path TO 'pg_catalog';
REVOKE ALL ON FUNCTION public.canonical_load_operating_miles(numeric,numeric,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_load_operating_miles(numeric,numeric,numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.canonical_load_operating_miles(numeric,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_load_operating_miles(numeric,numeric,numeric) TO service_role;