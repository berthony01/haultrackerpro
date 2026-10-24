-- HJ-1B CANDIDATE ONLY. Read projection; no existing objects or grants changed.
-- Every statement rechecks eligibility. Moderation writers do not share locks.
CREATE FUNCTION job_search_private.list_recruiter_job_search_cards(
  _recruiter_id uuid, _limit integer DEFAULT 20,
  _after_published_at timestamptz DEFAULT NULL, _after_card_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, auth, job_search_private
AS $reader$
DECLARE
  _uid uuid := auth.uid();
  _rows jsonb;
BEGIN
  IF _recruiter_id IS NULL OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 50
    OR ((_after_published_at IS NULL) <> (_after_card_id IS NULL))
    OR (_after_published_at IS NOT NULL AND NOT pg_catalog.isfinite(_after_published_at)) THEN
    RAISE EXCEPTION 'Invalid discovery arguments' USING ERRCODE = '22023';
  END IF;
  IF _uid IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.user_capabilities c
      WHERE c.user_id = _uid AND c.capability = 'recruiter' AND c.status = 'active')
    OR NOT public.is_recruiter_workspace_owner(_recruiter_id)
    OR NOT EXISTS (SELECT 1 FROM public.recruiter_profiles rp
      WHERE rp.id = _recruiter_id AND rp.user_id = _uid
        AND rp.status = 'active' AND rp.verification_status = 'approved'
        AND public.recruiter_profile_can_manage_opportunities(rp.id))
    OR public.user_has_blocking_messaging_restriction(_uid)
    OR public.is_qa_fixture_root('user', _uid)
    OR public.is_qa_fixture_root('recruiter_profile', _recruiter_id)
    OR NOT EXISTS (SELECT 1 FROM public.opportunities o
      WHERE o.recruiter_id = _recruiter_id AND o.status = 'active'
        AND o.admin_review_status = 'approved'
        AND NOT public.is_qa_fixture_root('recruiter_profile', o.recruiter_id)) THEN
    RAISE EXCEPTION 'Discovery unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', page.id, 'revision', page.revision, 'published_at', page.published_at,
    'expires_at', page.expires_at, 'payload', page.projected_payload
  ) ORDER BY page.published_at DESC, page.id DESC), '[]'::jsonb)
  INTO _rows FROM (
    SELECT c.id, c.revision, c.published_at, c.expires_at,
      (SELECT pg_catalog.jsonb_object_agg(k, c.payload->k)
       FROM pg_catalog.unnest(ARRAY['state','cdl_class','years_experience',
         'experience_qualifier','preferred_route_type','preferred_home_time',
         'trailer_experience','preferred_driver_type','available_start_date',
         'min_weekly_gross']) k WHERE c.payload ? k) AS projected_payload
    FROM job_search_private.driver_job_search_cards c
    WHERE c.owner_user_id <> _uid AND c.status = 'published'
      AND c.expires_at > pg_catalog.statement_timestamp()
      AND c.audience = 'approved_recruiters' AND c.consent_version = 'job_search_card_v1'
      AND EXISTS (SELECT 1 FROM public.user_capabilities cap
        WHERE cap.user_id = c.owner_user_id AND cap.capability = 'driver' AND cap.status = 'active')
      AND NOT public.user_has_blocking_messaging_restriction(c.owner_user_id)
      AND NOT public.is_qa_fixture_root('user', c.owner_user_id)
      AND (_after_published_at IS NULL OR (c.published_at, c.id) < (_after_published_at, _after_card_id))
    ORDER BY c.published_at DESC, c.id DESC LIMIT _limit
  ) page;
  RETURN _rows;
END;
$reader$;
REVOKE ALL ON FUNCTION job_search_private.list_recruiter_job_search_cards(uuid,integer,timestamptz,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION job_search_private.list_recruiter_job_search_cards(uuid,integer,timestamptz,uuid) TO authenticated;

CREATE FUNCTION public.list_recruiter_job_search_cards(
  _recruiter_id uuid, _limit integer DEFAULT 20,
  _after_published_at timestamptz DEFAULT NULL, _after_card_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, auth, job_search_private
AS $wrapper$
  SELECT job_search_private.list_recruiter_job_search_cards(
    _recruiter_id, _limit, _after_published_at, _after_card_id);
$wrapper$;
REVOKE ALL ON FUNCTION public.list_recruiter_job_search_cards(uuid,integer,timestamptz,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_recruiter_job_search_cards(uuid,integer,timestamptz,uuid) TO authenticated;
