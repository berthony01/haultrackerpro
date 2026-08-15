-- Phase RC-1D — Recruiter staff opportunity authorization.
--
-- FIRST operational consumer of the RC-1B recruiter staff permission contract.
-- Authorizes exactly five permission keys against a selected recruiter
-- workspace:
--   opportunities_view, opportunities_create, opportunities_edit,
--   opportunities_change_status, opportunities_delete
--
-- Security contract:
--   * public.current_user_can_manage_recruiter_opportunities(uuid) is NOT
--     replaced and remains owner-only.
--   * Owner behavior is unchanged everywhere.
--   * recruiter_admin role alone grants nothing; only explicit RC-1B boolean
--     permissions on an ACTIVE membership grant anything.
--   * Suspended / non-posting-ready workspaces cannot be operated by staff.
--   * No applications / referrals / reports / contracts / settlements /
--     billing / profile-ownership authorization is granted here.

-- ---------------------------------------------------------------------------
-- A) Permission-aware opportunity action helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_opportunity_action(
  _recruiter_id uuid,
  _permission public.recruiter_workspace_permission
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND _recruiter_id IS NOT NULL
    AND _permission IS NOT NULL
    AND _permission IN (
      'opportunities_view'::public.recruiter_workspace_permission,
      'opportunities_create'::public.recruiter_workspace_permission,
      'opportunities_edit'::public.recruiter_workspace_permission,
      'opportunities_change_status'::public.recruiter_workspace_permission,
      'opportunities_delete'::public.recruiter_workspace_permission
    )
    AND (
      -- Owner path: unchanged owner-only gate, used exactly as-is.
      public.current_user_can_manage_recruiter_opportunities(_recruiter_id)
      OR (
        -- Staff path: workspace must be posting-ready AND the caller must
        -- hold the explicit RC-1B permission on an active membership.
        public.recruiter_profile_can_manage_opportunities(_recruiter_id)
        AND public.current_user_has_recruiter_permission(_recruiter_id, _permission)
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.current_user_can_recruiter_opportunity_action(uuid, public.recruiter_workspace_permission) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_can_recruiter_opportunity_action(uuid, public.recruiter_workspace_permission) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_recruiter_opportunity_action(uuid, public.recruiter_workspace_permission) TO authenticated;

-- ---------------------------------------------------------------------------
-- B) Exact staff action guard (defense-in-depth, runs FIRST)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.opportunities_staff_action_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _owns_recruiter_profile boolean;
  _content_changed boolean;
  _status_changed boolean;
BEGIN
  -- Admin moderation is unaffected.
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Canonical owner passthrough preserves every pre-existing owner behavior,
  -- message, and downstream guard order byte-for-byte.
  --
  -- SECURITY: on UPDATE the owner test is keyed to the EXISTING workspace
  -- (OLD.recruiter_id), never NEW. Keying it to NEW would let a caller who is
  -- only staff in workspace A but personally owns workspace B reassign an
  -- A-owned listing into B and be treated as an owner (RLS USING authorizes A,
  -- WITH CHECK authorizes B). Ownership of NEW is therefore never an owner
  -- bypass, and non-owners of OLD hit workspace immutability first.
  IF TG_OP = 'INSERT' THEN
    _owns_recruiter_profile := EXISTS (
      SELECT 1
      FROM public.recruiter_profiles rp
      WHERE rp.id = NEW.recruiter_id
        AND rp.user_id = auth.uid()
    );
    IF _owns_recruiter_profile THEN
      RETURN NEW;
    END IF;

    IF NOT public.current_user_can_recruiter_opportunity_action(
      NEW.recruiter_id, 'opportunities_create'::public.recruiter_workspace_permission
    ) THEN
      RAISE EXCEPTION 'Not authorized to create opportunities in this recruiter workspace.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.status = 'active' AND NOT public.current_user_can_recruiter_opportunity_action(
      NEW.recruiter_id, 'opportunities_change_status'::public.recruiter_workspace_permission
    ) THEN
      RAISE EXCEPTION 'Not authorized to change opportunity status in this recruiter workspace.'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE ------------------------------------------------------------------
  _owns_recruiter_profile := EXISTS (
    SELECT 1
    FROM public.recruiter_profiles rp
    WHERE rp.id = OLD.recruiter_id
      AND rp.user_id = auth.uid()
  );
  IF _owns_recruiter_profile THEN
    RETURN NEW;
  END IF;

  -- Staff can never move a listing between workspaces.
  IF NEW.recruiter_id IS DISTINCT FROM OLD.recruiter_id THEN
    RAISE EXCEPTION 'Not authorized to reassign this opportunity.'
      USING ERRCODE = '42501';
  END IF;


  _status_changed := (NEW.status IS DISTINCT FROM OLD.status);

  _content_changed := (
    (
      to_jsonb(NEW)
        - 'id' - 'recruiter_id' - 'status' - 'admin_review_status'
        - 'featured' - 'view_count' - 'published_at'
        - 'created_at' - 'updated_at'
    ) IS DISTINCT FROM (
      to_jsonb(OLD)
        - 'id' - 'recruiter_id' - 'status' - 'admin_review_status'
        - 'featured' - 'view_count' - 'published_at'
        - 'created_at' - 'updated_at'
    )
  );

  IF _content_changed AND NOT public.current_user_can_recruiter_opportunity_action(
    NEW.recruiter_id, 'opportunities_edit'::public.recruiter_workspace_permission
  ) THEN
    RAISE EXCEPTION 'Not authorized to edit opportunities in this recruiter workspace.'
      USING ERRCODE = '42501';
  END IF;

  IF _status_changed AND NOT public.current_user_can_recruiter_opportunity_action(
    NEW.recruiter_id, 'opportunities_change_status'::public.recruiter_workspace_permission
  ) THEN
    RAISE EXCEPTION 'Not authorized to change opportunity status in this recruiter workspace.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.opportunities_staff_action_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.opportunities_staff_action_guard() FROM anon;

-- Name sorts before trg_opportunities_billing_guard / _canonical_publication_guard
-- / _guard so unauthorized callers are rejected before any billing, entitlement,
-- or publication validation detail can be produced.
DROP TRIGGER IF EXISTS trg_opportunities_a_staff_action_guard ON public.opportunities;
CREATE TRIGGER trg_opportunities_a_staff_action_guard
  BEFORE INSERT OR UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.opportunities_staff_action_guard();

-- ---------------------------------------------------------------------------
-- C) Recruiter RLS policies on public.opportunities ONLY
--    (admin + driver policies untouched; no recruiter DELETE policy added)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Recruiter views own opportunities" ON public.opportunities;
CREATE POLICY "Recruiter views own opportunities"
  ON public.opportunities
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.recruiter_profiles rp
      WHERE rp.id = opportunities.recruiter_id
        AND rp.user_id = auth.uid()
    )
    OR public.current_user_can_recruiter_opportunity_action(
      opportunities.recruiter_id,
      'opportunities_view'::public.recruiter_workspace_permission
    )
  );

DROP POLICY IF EXISTS "Recruiter inserts own opportunities" ON public.opportunities;
CREATE POLICY "Recruiter inserts own opportunities"
  ON public.opportunities
  FOR INSERT
  WITH CHECK (
    public.current_user_can_recruiter_opportunity_action(
      recruiter_id,
      'opportunities_create'::public.recruiter_workspace_permission
    )
  );

DROP POLICY IF EXISTS "Recruiter updates own opportunities" ON public.opportunities;
CREATE POLICY "Recruiter updates own opportunities"
  ON public.opportunities
  FOR UPDATE
  USING (
    public.current_user_can_recruiter_opportunity_action(
      recruiter_id, 'opportunities_edit'::public.recruiter_workspace_permission
    )
    OR public.current_user_can_recruiter_opportunity_action(
      recruiter_id, 'opportunities_change_status'::public.recruiter_workspace_permission
    )
  )
  WITH CHECK (
    public.current_user_can_recruiter_opportunity_action(
      recruiter_id, 'opportunities_edit'::public.recruiter_workspace_permission
    )
    OR public.current_user_can_recruiter_opportunity_action(
      recruiter_id, 'opportunities_change_status'::public.recruiter_workspace_permission
    )
  );

-- ---------------------------------------------------------------------------
-- D) Minimal authorization-only adaptations of existing opportunity functions
-- ---------------------------------------------------------------------------

-- D1) opportunities_guard(): only the INSERT eligibility determination becomes
--     permission-aware. All admin moderation and publication field behavior is
--     preserved verbatim.
CREATE OR REPLACE FUNCTION public.opportunities_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _is_eligible boolean := false;
  _is_admin boolean := public.is_admin(auth.uid());
  _owns_recruiter_profile boolean := EXISTS (
    SELECT 1
    FROM public.recruiter_profiles rp
    WHERE rp.id = NEW.recruiter_id
      AND rp.user_id = auth.uid()
  );
  _is_explicit_admin_moderation boolean := false;
  _allow_featured_sync boolean := (
    COALESCE(current_setting('app.allow_featured_sync', true), 'false') = 'true'
  );
BEGIN
  IF _is_admin AND NOT _owns_recruiter_profile THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND _is_admin AND _owns_recruiter_profile THEN
    _is_explicit_admin_moderation :=
         (NEW.admin_review_status IS DISTINCT FROM OLD.admin_review_status)
      OR (NEW.featured             IS DISTINCT FROM OLD.featured)
      OR (NEW.view_count           IS DISTINCT FROM OLD.view_count)
      OR (NEW.published_at         IS DISTINCT FROM OLD.published_at);
    IF _is_explicit_admin_moderation THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    _is_eligible := public.current_user_can_recruiter_opportunity_action(
      NEW.recruiter_id, 'opportunities_create'::public.recruiter_workspace_permission
    );

    NEW.admin_review_status := CASE WHEN _is_eligible THEN 'approved' ELSE 'pending' END;
    NEW.featured := false;
    NEW.view_count := 0;
    NEW.published_at := CASE
      WHEN _is_eligible AND NEW.status = 'active' THEN now()
      ELSE NULL
    END;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.admin_review_status = 'rejected' THEN
      NEW.admin_review_status := 'pending';
      NEW.published_at := NULL;
    ELSE
      NEW.admin_review_status := OLD.admin_review_status;
    END IF;

    IF _allow_featured_sync IS NOT TRUE THEN
      NEW.featured := OLD.featured;
    END IF;

    NEW.view_count := OLD.view_count;

    IF OLD.admin_review_status <> 'rejected'
       AND OLD.published_at IS NULL
       AND NEW.status = 'active'
       AND NEW.admin_review_status = 'approved'
    THEN
      NEW.published_at := now();
    ELSIF OLD.admin_review_status <> 'rejected' THEN
      NEW.published_at := OLD.published_at;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- D2) opportunities_billing_guard(): ONLY the initial authorization gate is
--     permission-aware. Every limit / entitlement / advisory-lock / message
--     behavior below it is unchanged.
CREATE OR REPLACE FUNCTION public.opportunities_billing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _lock_namespace     constant integer := 1971001;
  _limit              integer;
  _active_count       integer;
  _is_becoming_active boolean := false;
  _authorized         boolean;
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    _authorized := public.current_user_can_recruiter_opportunity_action(
      NEW.recruiter_id, 'opportunities_create'::public.recruiter_workspace_permission
    );
  ELSE
    _authorized := public.current_user_can_recruiter_opportunity_action(
      NEW.recruiter_id, 'opportunities_edit'::public.recruiter_workspace_permission
    ) OR public.current_user_can_recruiter_opportunity_action(
      NEW.recruiter_id, 'opportunities_change_status'::public.recruiter_workspace_permission
    );
  END IF;

  IF NOT _authorized THEN
    RAISE EXCEPTION 'Complete your recruiter profile to publish opportunities.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    _is_becoming_active := (NEW.status = 'active');
  ELSIF TG_OP = 'UPDATE' THEN
    _is_becoming_active := (NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active');
  END IF;

  IF NOT _is_becoming_active THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(_lock_namespace, hashtext(NEW.recruiter_id::text));

  _limit := public.effective_recruiter_active_opportunity_limit(NEW.recruiter_id);

  IF _limit IS NULL OR _limit <= 0 THEN
    RAISE EXCEPTION 'Active opportunity activation is blocked.'
      USING ERRCODE = '23514',
            DETAIL  = '{"code": "business_entitlement_conflict"}';
  END IF;

  SELECT COUNT(*)::int INTO _active_count
  FROM public.opportunities o
  WHERE o.recruiter_id = NEW.recruiter_id
    AND o.status = 'active'
    AND o.id IS DISTINCT FROM NEW.id;

  IF _active_count >= _limit THEN
    RAISE EXCEPTION 'Active opportunity limit reached.'
      USING ERRCODE = '23514',
            DETAIL  = json_build_object(
                        'code', 'active_opportunity_limit_reached',
                        'limit', _limit,
                        'active_count', _active_count
                      )::text;
  END IF;

  RETURN NEW;
END;
$function$;

-- D3) delete_recruiter_opportunity(): ONLY the authorization check is broadened
--     to owner OR explicit opportunities_delete. Non-enumerating not_found,
--     status restrictions, blocker discovery order, related-record protection,
--     saved-opportunity cleanup, and the result contract are unchanged.
CREATE OR REPLACE FUNCTION public.delete_recruiter_opportunity(p_opportunity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  IF NOT public.current_user_can_recruiter_opportunity_action(
    v_recruiter_id, 'opportunities_delete'::public.recruiter_workspace_permission
  ) THEN
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
$function$;
