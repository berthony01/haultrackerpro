ALTER FUNCTION public.create_recruiter_opportunity(uuid, jsonb)
  SET search_path = pg_catalog, public, auth;

REVOKE ALL ON FUNCTION public.create_recruiter_opportunity(uuid, jsonb) FROM service_role;

CREATE OR REPLACE FUNCTION public.create_recruiter_opportunity_as_actor(
  _actor_user_id uuid,
  _recruiter_id uuid,
  _payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  -- Effective Postgres role of the caller. SECURITY DEFINER rewrites
  -- current_user, but not the `role` GUC, so this still reflects the role
  -- PostgREST switched into after verifying the request's JWT signature.
  v_caller_role text := current_setting('role', true);
  v_prev_sub    text := current_setting('request.jwt.claim.sub', true);
  v_prev_claims text := current_setting('request.jwt.claims', true);
  v_result jsonb;
BEGIN
  IF v_caller_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'delegation_denied' USING ERRCODE = '42501';
  END IF;

  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_actor' USING ERRCODE = '22023';
  END IF;

  -- Transaction-local identity swap. auth.uid() resolves
  -- request.jwt.claim.sub first, then request.jwt.claims->>'sub'; both are set
  -- so no stale service-role claim can shadow the delegated actor.
  PERFORM set_config('request.jwt.claim.sub', _actor_user_id::text, true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- The ONE canonical implementation. Whitelist, permission predicate, guards
  -- and INSERT all live there and run under the delegated actor.
  v_result := public.create_recruiter_opportunity(_recruiter_id, _payload);

  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
  PERFORM set_config('request.jwt.claims', COALESCE(v_prev_claims, ''), true);

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_recruiter_opportunity_as_actor(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_recruiter_opportunity_as_actor(uuid, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.create_recruiter_opportunity_as_actor(uuid, uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_recruiter_opportunity_as_actor(uuid, uuid, jsonb) TO service_role;