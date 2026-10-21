-- Scoped, expiring QA listing access for one named tester on one QA opportunity.
-- Does not de-isolate QA fixtures globally. Internal QA setup only.

CREATE TABLE public.qa_opportunity_test_access (
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  qa_owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT qa_opportunity_test_access_pkey PRIMARY KEY (opportunity_id, driver_user_id),
  CONSTRAINT qa_opportunity_test_access_expiry_window
    CHECK (expires_at > granted_at AND expires_at <= granted_at + interval '60 minutes')
);

COMMENT ON TABLE public.qa_opportunity_test_access IS
  'Internal QA: time-boxed access for one named driver to one registered QA fixture opportunity. Not billing, entitlement, staff or admin authority.';

REVOKE ALL ON TABLE public.qa_opportunity_test_access FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.qa_opportunity_test_access TO service_role;
ALTER TABLE public.qa_opportunity_test_access ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Grant
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.grant_qa_opportunity_test_access(
  _opportunity_id uuid,
  _driver_user_id uuid,
  _duration_minutes integer DEFAULT 30
) RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _now timestamptz := pg_catalog.now();
  _expires timestamptz;
BEGIN
  IF _actor IS NULL OR _opportunity_id IS NULL OR _driver_user_id IS NULL
     OR _duration_minutes IS NULL OR _duration_minutes < 1 OR _duration_minutes > 60 THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_super_admin(_actor)
     OR NOT EXISTS (
       SELECT 1
       FROM public.opportunities o
       JOIN public.recruiter_profiles rp ON rp.id = o.recruiter_id
       JOIN public.qa_fixture_roots r
         ON r.root_kind = 'recruiter_profile' AND r.root_id = o.recruiter_id
       WHERE o.id = _opportunity_id
         AND rp.user_id = _actor
         AND r.active
         AND r.qa_owner_user_id = _actor
     )
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _driver_user_id) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  _expires := _now + pg_catalog.make_interval(mins => _duration_minutes);

  INSERT INTO public.qa_opportunity_test_access AS a
    (opportunity_id, driver_user_id, qa_owner_user_id, granted_at, expires_at, revoked_at)
  VALUES (_opportunity_id, _driver_user_id, _actor, _now, _expires, NULL)
  ON CONFLICT (opportunity_id, driver_user_id) DO UPDATE
    SET qa_owner_user_id = EXCLUDED.qa_owner_user_id,
        granted_at = EXCLUDED.granted_at,
        expires_at = EXCLUDED.expires_at,
        revoked_at = NULL;

  RETURN _expires;
END;
$function$;

REVOKE ALL ON FUNCTION public.grant_qa_opportunity_test_access(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_qa_opportunity_test_access(uuid, uuid, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Revoke (owner may revoke even if root later became inactive)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.revoke_qa_opportunity_test_access(
  _opportunity_id uuid,
  _driver_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  _actor uuid := auth.uid();
BEGIN
  IF _actor IS NULL OR _opportunity_id IS NULL OR _driver_user_id IS NULL
     OR NOT public.is_super_admin(_actor) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.qa_opportunity_test_access a
     SET revoked_at = pg_catalog.now()
   WHERE a.opportunity_id = _opportunity_id
     AND a.driver_user_id = _driver_user_id
     AND a.qa_owner_user_id = _actor
     AND a.revoked_at IS NULL;

  IF FOUND THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.qa_opportunity_test_access a
    WHERE a.opportunity_id = _opportunity_id
      AND a.driver_user_id = _driver_user_id
      AND a.qa_owner_user_id = _actor
  ) THEN
    RETURN false; -- already revoked
  END IF;

  RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
END;
$function$;

REVOKE ALL ON FUNCTION public.revoke_qa_opportunity_test_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_qa_opportunity_test_access(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Internal helper (callable only by owner-run definer functions)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public._qa_opportunity_test_access_allowed(_opportunity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.qa_opportunity_test_access a
    JOIN public.opportunities o ON o.id = a.opportunity_id
    JOIN public.recruiter_profiles rp ON rp.id = o.recruiter_id
    JOIN public.qa_fixture_roots r
      ON r.root_kind = 'recruiter_profile' AND r.root_id = o.recruiter_id
    WHERE auth.uid() IS NOT NULL
      AND a.opportunity_id = _opportunity_id
      AND a.driver_user_id = auth.uid()
      AND a.revoked_at IS NULL
      AND a.expires_at > pg_catalog.now()
      AND r.active
      AND r.qa_owner_user_id = a.qa_owner_user_id
      AND rp.user_id = a.qa_owner_user_id
      AND public.is_super_admin(a.qa_owner_user_id)
  )
$function$;

REVOKE ALL ON FUNCTION public._qa_opportunity_test_access_allowed(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Existing visibility functions: identical except the added OR branch.
-- CREATE OR REPLACE preserves existing ACLs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_driver_visible_opportunities(_state text DEFAULT NULL::text, _driver_type text DEFAULT NULL::text, _route_type text DEFAULT NULL::text)
 RETURNS SETOF opportunities
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.*
  FROM public.opportunities o
  WHERE auth.uid() IS NOT NULL
    AND o.status = 'active'
    AND o.admin_review_status = 'approved'
    AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
    AND (
      NOT public.is_qa_fixture_root('recruiter_profile', o.recruiter_id)
      OR (auth.uid() IS NOT NULL AND public.is_qa_fixture_root('recruiter_profile', o.recruiter_id, auth.uid()))
      OR public._qa_opportunity_test_access_allowed(o.id)
    )
    AND (_state IS NULL OR o.hiring_state = _state)
    AND (_driver_type IS NULL OR o.driver_type = _driver_type)
    AND (_route_type IS NULL OR o.route_type = _route_type)
  ORDER BY o.featured DESC NULLS LAST, o.published_at DESC NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public.driver_can_access_opportunity(_opportunity_id uuid, _recruiter_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.opportunities o
    WHERE auth.uid() IS NOT NULL
      AND o.id = _opportunity_id
      AND o.recruiter_id = _recruiter_id
      AND o.status = 'active'
      AND o.admin_review_status = 'approved'
      AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
      AND (
        NOT public.is_qa_fixture_root('recruiter_profile', o.recruiter_id)
        OR (auth.uid() IS NOT NULL AND public.is_qa_fixture_root('recruiter_profile', o.recruiter_id, auth.uid()))
        OR public._qa_opportunity_test_access_allowed(o.id)
      )
  );
$function$;
