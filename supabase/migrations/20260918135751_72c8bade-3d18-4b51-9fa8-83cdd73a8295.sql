BEGIN;

CREATE OR REPLACE FUNCTION public._telegram_quick_post_recruiter(
  _telegram_user_id bigint
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  _ids uuid[];
BEGIN
  SELECT array_agg(r.recruiter_id)
    INTO _ids
    FROM public.telegram_resolve_recruiter_actor(_telegram_user_id) r
   WHERE r.can_manage_opportunities IS TRUE;

  IF _ids IS NULL OR array_length(_ids, 1) <> 1 THEN
    RETURN NULL;
  END IF;

  RETURN _ids[1];
END;
$function$;

REVOKE ALL ON FUNCTION public._telegram_quick_post_recruiter(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._telegram_quick_post_recruiter(bigint) FROM anon;
REVOKE ALL ON FUNCTION public._telegram_quick_post_recruiter(bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._telegram_quick_post_recruiter(bigint) TO service_role;

COMMIT;