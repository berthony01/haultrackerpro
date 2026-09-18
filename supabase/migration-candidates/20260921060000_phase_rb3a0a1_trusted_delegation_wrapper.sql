-- CANDIDATE MIGRATION — Phase RB-3A-0A.1.
-- Trusted service-role delegation wrapper for canonical opportunity creation.
--
-- WHY: public.create_recruiter_opportunity(uuid, jsonb) is canonical for the web
-- but derives the actor from auth.uid() only, so a service-role caller (future
-- Telegram Quick Post) raises not_authenticated and cannot delegate at all.
--
-- WHAT THIS DOES *NOT* DO:
--   * It does not add a second creation implementation. The wrapper performs no
--     INSERT. Validation, the 58-column whitelist, the permission predicate and
--     the INSERT stay in the two-argument canonical function, so every existing
--     BEFORE INSERT guard (billing/active limit, staff action, canonical
--     publication, field validation, featured) still fires unchanged.
--   * It does not weaken any permission rule. The delegated actor must pass the
--     exact same current_user_can_recruiter_opportunity_action predicate.
--
-- HOW DELEGATION IS MADE SAFE:
--   1. EXECUTE on the wrapper is granted to service_role ONLY. PUBLIC, anon and
--      authenticated are revoked, so an ordinary signed-in user cannot reach it
--      and therefore cannot supply another actor.
--   2. The wrapper additionally re-checks that it is genuinely running under the
--      service_role Postgres role via current_setting('role'). That GUC is set by
--      PostgREST's SET LOCAL ROLE after it verifies the JWT signature; it is NOT
--      a caller-supplied payload string. Defense in depth behind the grant.
--   3. EXECUTE on the two-argument web function is revoked from service_role, so
--      the trusted path is the wrapper and nothing else.
--   4. The actor identity is applied transaction-locally
--      (set_config(..., is_local => true)) and restored after the call, so it can
--      never leak past the statement.

-- --------------------------------------------------------------------------
-- 1. Harden the existing canonical function's search_path. Behaviour-neutral:
--    the body already schema-qualifies every reference (public.*, auth.uid()).
--    pg_catalog first prevents any public-schema shadowing of built-ins.
-- --------------------------------------------------------------------------
ALTER FUNCTION public.create_recruiter_opportunity(uuid, jsonb)
  SET search_path = pg_catalog, public, auth;

-- --------------------------------------------------------------------------
-- 2. The web function is for signed-in callers only. service_role must use the
--    wrapper (which supplies an explicit actor) instead.
-- --------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_recruiter_opportunity(uuid, jsonb) FROM service_role;

-- --------------------------------------------------------------------------
-- 3. The delegation wrapper.
-- --------------------------------------------------------------------------
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
