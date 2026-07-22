-- =====================================================================
-- Phase 1L-F2D — Safe recruiter opportunity permanent-delete RPC.
--
-- Introduces the sole recruiter hard-delete path for opportunities they
-- own. Business-linked listings (with applications, referrals, offers,
-- contracts, or opportunity reports) are always preserved. Saved
-- bookmarks (non-business references) are cleared only when the
-- opportunity itself is successfully deleted.
--
-- Authorization is caller-bound to auth.uid() via the canonical
-- management helper public.current_user_can_manage_recruiter_opportunities.
-- Missing and unauthorized listings return the same non-enumerating
-- result_code = 'not_found'. This migration does not create, drop, or
-- alter any table policy; existing admin DELETE behavior on
-- public.opportunities remains unchanged.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.delete_recruiter_opportunity(
  p_opportunity_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_recruiter_id uuid;
  v_status       text;
  v_blockers     text[] := ARRAY[]::text[];
  v_exists       boolean;
BEGIN
  -- Non-enumerating early-out for null caller / null id.
  IF v_caller IS NULL OR p_opportunity_id IS NULL THEN
    RETURN jsonb_build_object('result_code', 'not_found');
  END IF;

  SELECT o.recruiter_id, o.status
    INTO v_recruiter_id, v_status
    FROM public.opportunities o
   WHERE o.id = p_opportunity_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result_code', 'not_found');
  END IF;

  -- Unauthorized callers are indistinguishable from missing rows.
  IF NOT public.current_user_can_manage_recruiter_opportunities(v_recruiter_id) THEN
    RETURN jsonb_build_object('result_code', 'not_found');
  END IF;

  IF v_status NOT IN ('draft', 'closed') THEN
    RETURN jsonb_build_object('result_code', 'status_blocked');
  END IF;

  -- Blocker discovery in the exact contractual order.
  SELECT EXISTS (
    SELECT 1 FROM public.opportunity_applications a
     WHERE a.opportunity_id = p_opportunity_id
  ) INTO v_exists;
  IF v_exists THEN v_blockers := array_append(v_blockers, 'applications'); END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.driver_referrals r
     WHERE r.opportunity_id = p_opportunity_id
  ) INTO v_exists;
  IF v_exists THEN v_blockers := array_append(v_blockers, 'referrals'); END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.opportunity_offers f
     WHERE f.opportunity_id = p_opportunity_id
  ) INTO v_exists;
  IF v_exists THEN v_blockers := array_append(v_blockers, 'offers'); END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.contracts c
     WHERE c.opportunity_id = p_opportunity_id
  ) INTO v_exists;
  IF v_exists THEN v_blockers := array_append(v_blockers, 'contracts'); END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.opportunity_reports rp
     WHERE rp.opportunity_id = p_opportunity_id
  ) INTO v_exists;
  IF v_exists THEN v_blockers := array_append(v_blockers, 'reports'); END IF;

  IF array_length(v_blockers, 1) IS NOT NULL THEN
    RETURN jsonb_build_object(
      'result_code', 'related_records',
      'blockers',    to_jsonb(v_blockers)
    );
  END IF;

  DELETE FROM public.saved_opportunities WHERE opportunity_id = p_opportunity_id;
  DELETE FROM public.opportunities        WHERE id = p_opportunity_id;

  RETURN jsonb_build_object('result_code', 'deleted');
END;
$$;

REVOKE ALL ON FUNCTION public.delete_recruiter_opportunity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_recruiter_opportunity(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_recruiter_opportunity(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_recruiter_opportunity(uuid) IS
'Phase 1L-F2D: sole recruiter hard-delete path for owned draft/closed opportunities. Returns { result_code, blockers? }. Business-linked listings (applications, referrals, offers, contracts, reports) are preserved; only saved bookmarks are cleared alongside a successful delete. Missing and unauthorized rows are indistinguishable.';