-- CANDIDATE MIGRATION — Phase RB-3A.1 (corrective).
--
-- PROVEN ROOT CAUSE
--   Every Quick Post callback (`q1:n` Post Opportunity, Confirm, Start Over,
--   Cancel) failed with SQLSTATE 42883 — `function min(uuid) does not exist`.
--   `public._telegram_quick_post_recruiter` aggregated the resolved workspace
--   id with `min(r.recruiter_id)`; PostgreSQL has no `min()` for `uuid`, so the
--   statement aborted before any Quick Post state could be created. The Edge
--   Function, callback wiring, grants, RLS, signatures and schema cache were
--   all correct.
--
-- SCOPE
--   Replaces ONLY the aggregate inside this one helper. Identical semantics:
--   exactly one eligible workspace returns it, zero or many returns NULL so the
--   caller fails closed. Same signature, volatility, SECURITY DEFINER, search
--   path and grants. Nothing else in RB-3A / RB-2B / RB-2C / RB-2D is touched.

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

  -- Ambiguity (0 or >1 eligible workspaces) fails closed, exactly as before.
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
