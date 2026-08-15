-- Phase RC-1E — Recruiter staff application authorization.
--
-- SECOND operational consumer of the RC-1B recruiter staff permission
-- contract. Authorizes exactly three permission keys against a selected
-- recruiter workspace:
--   applications_view, applications_manage_status, applications_request_contact
--
-- applications_manage_notes is DELIBERATELY DORMANT in RC-1E: there is no
-- canonical application-notes table, RPC, or UI, so nothing here consumes it.
--
-- Security contract:
--   * public.current_user_can_manage_recruiter_opportunities(uuid) is NOT
--     replaced and remains owner-only.
--   * public.recruiter_profile_can_manage_opportunities(uuid) and the RC-1B
--     permission functions are NOT replaced.
--   * Owner behavior is unchanged everywhere.
--   * recruiter_admin / recruiter_staff role labels alone grant nothing; only
--     explicit RC-1B boolean permissions on an ACTIVE membership grant staff
--     operations, and only on a posting-ready (non-suspended) workspace.
--   * No referral-bridge, contract-hire, notification, submission,
--     withdrawal, driver-response, report, settlement, or billing
--     authorization is modified here.

-- ---------------------------------------------------------------------------
-- A) Permission-aware application action helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_can_recruiter_application_action(
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
      'applications_view'::public.recruiter_workspace_permission,
      'applications_manage_status'::public.recruiter_workspace_permission,
      'applications_request_contact'::public.recruiter_workspace_permission
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

REVOKE ALL ON FUNCTION public.current_user_can_recruiter_application_action(uuid, public.recruiter_workspace_permission) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_can_recruiter_application_action(uuid, public.recruiter_workspace_permission) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_recruiter_application_action(uuid, public.recruiter_workspace_permission) TO authenticated;

-- ---------------------------------------------------------------------------
-- B) Safe application list — authorization + least-privilege contact masking
--
-- Payload, joins, ordering, and driver consent rules are reproduced verbatim
-- from the live definition. The ONLY changes:
--   * owner-only gate replaced with the application action helper
--     ('applications_view')
--   * phone/email snapshots additionally require the caller to pass
--     'applications_request_contact'. Owner behavior is unchanged because the
--     helper's owner path grants all three allowed application actions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_recruiter_applications_safe(_recruiter_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _can_see_contact boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.current_user_can_recruiter_application_action(
    _recruiter_id, 'applications_view'::public.recruiter_workspace_permission
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  _can_see_contact := public.current_user_can_recruiter_application_action(
    _recruiter_id, 'applications_request_contact'::public.recruiter_workspace_permission
  );

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', oa.id,
    'opportunity_id', oa.opportunity_id,
    'recruiter_id', oa.recruiter_id,
    'driver_user_id', oa.driver_user_id,
    'driver_profile_id', oa.driver_profile_id,
    'application_type', oa.application_type,
    'status', oa.status,
    'message', oa.message,
    'preferred_contact_method', oa.preferred_contact_method,
    'created_at', oa.created_at,
    'updated_at', oa.updated_at,
    'driver_phone_snapshot',
      CASE
        WHEN _can_see_contact
          AND COALESCE(dop.allow_verified_recruiter_contact, false)
          AND dop.contact_preference = 'phone'
          AND EXISTS (
            SELECT 1 FROM public.recruiter_contact_requests rcr
             WHERE rcr.application_id = oa.id AND rcr.status = 'approved'
          )
        THEN oa.driver_phone_snapshot
        ELSE NULL
      END,
    'driver_email_snapshot',
      CASE
        WHEN _can_see_contact
          AND COALESCE(dop.allow_verified_recruiter_contact, false)
          AND dop.contact_preference = 'email'
          AND EXISTS (
            SELECT 1 FROM public.recruiter_contact_requests rcr
             WHERE rcr.application_id = oa.id AND rcr.status = 'approved'
          )
        THEN oa.driver_email_snapshot
        ELSE NULL
      END,
    'opportunities', CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', o.id, 'title', o.title, 'company_name', o.company_name,
      'hiring_city', o.hiring_city, 'hiring_state', o.hiring_state,
      'status', o.status, 'admin_review_status', o.admin_review_status,
      'route_type', o.route_type, 'driver_type', o.driver_type,
      'trailer_type', o.trailer_type, 'deadhead_paid', o.deadhead_paid,
      'lease_payment', o.lease_payment, 'insurance_deductions', o.insurance_deductions,
      'maintenance_deductions', o.maintenance_deductions,
      'other_deductions', o.other_deductions, 'escrow_amount', o.escrow_amount,
      'escrow_required', o.escrow_required,
      'estimated_weekly_gross', o.estimated_weekly_gross,
      'flat_weekly_pay', o.flat_weekly_pay, 'cpm', o.cpm,
      'percentage_pay', o.percentage_pay,
      'estimated_weekly_miles', o.estimated_weekly_miles,
      'estimated_loaded_miles', o.estimated_loaded_miles,
      'estimated_deadhead_miles', o.estimated_deadhead_miles
    ) END,
    'driver_profile', CASE WHEN dop.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', dop.id, 'full_name', dop.full_name, 'city', dop.city,
      'state', dop.state, 'cdl_class', dop.cdl_class,
      'years_experience', dop.years_experience,
      'preferred_driver_type', dop.preferred_driver_type,
      'preferred_route_type', dop.preferred_route_type,
      'endorsements', dop.endorsements,
      'trailer_experience', dop.trailer_experience,
      'min_weekly_gross', dop.min_weekly_gross,
      'min_weekly_net', dop.min_weekly_net,
      'min_effective_rpm', dop.min_effective_rpm
    ) END
  )
  FROM public.opportunity_applications oa
  LEFT JOIN public.opportunities o ON o.id = oa.opportunity_id
  LEFT JOIN public.driver_opportunity_profiles dop ON dop.id = oa.driver_profile_id
  WHERE oa.recruiter_id = _recruiter_id
  ORDER BY oa.created_at DESC;
END;
$function$;

-- ---------------------------------------------------------------------------
-- C) Application summaries — preserve legacy owner semantics, add staff branch
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_recruiter_application_summaries(_recruiter_id uuid)
RETURNS TABLE(id uuid, opportunity_id uuid, status text, created_at timestamp with time zone, updated_at timestamp with time zone)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    -- Legacy owner branch, preserved EXACTLY (do not tighten).
    EXISTS (
      SELECT 1 FROM public.recruiter_profiles rp
      WHERE rp.id = _recruiter_id AND rp.user_id = _uid
        AND rp.status <> 'suspended' AND rp.verification_status <> 'suspended'
    )
    -- RC-1E staff branch: posting-ready workspace + explicit view permission.
    OR (
      public.recruiter_profile_can_manage_opportunities(_recruiter_id)
      AND public.current_user_has_recruiter_permission(
        _recruiter_id, 'applications_view'::public.recruiter_workspace_permission
      )
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT oa.id, oa.opportunity_id, oa.status, oa.created_at, oa.updated_at
  FROM public.opportunity_applications oa
  WHERE oa.recruiter_id = _recruiter_id
  ORDER BY oa.created_at DESC;
END;
$function$;

-- ---------------------------------------------------------------------------
-- D) opportunity_applications RLS — recruiter UPDATE policy only
--
-- Admin policies, driver SELECT, and the false driver INSERT policy are NOT
-- touched. No recruiter direct SELECT is added — recruiter/staff reads keep
-- going through the safe RPC. Existing update/snapshot/contract triggers are
-- NOT replaced; they still constrain UPDATE to legal status-only transitions.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Recruiter updates application status" ON public.opportunity_applications;
CREATE POLICY "Recruiter updates application status"
  ON public.opportunity_applications
  FOR UPDATE
  TO authenticated
  USING (
    public.current_user_can_recruiter_application_action(
      recruiter_id, 'applications_manage_status'::public.recruiter_workspace_permission
    )
  )
  WITH CHECK (
    public.current_user_can_recruiter_application_action(
      recruiter_id, 'applications_manage_status'::public.recruiter_workspace_permission
    )
  );

-- ---------------------------------------------------------------------------
-- E) application_events — recruiter view policy + actor classification
--
-- Admin and driver policies are untouched.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Recruiter views events for own applications" ON public.application_events;
CREATE POLICY "Recruiter views events for own applications"
  ON public.application_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.opportunity_applications oa
      JOIN public.recruiter_profiles rp ON rp.id = oa.recruiter_id
      WHERE oa.id = application_events.application_id
        AND rp.user_id = auth.uid()
        AND rp.status <> 'suspended'
        AND rp.verification_status <> 'suspended'
    )
    OR EXISTS (
      SELECT 1
      FROM public.opportunity_applications oa
      WHERE oa.id = application_events.application_id
        AND public.current_user_can_recruiter_application_action(
          oa.recruiter_id, 'applications_view'::public.recruiter_workspace_permission
        )
    )
  );

-- Actor classification: an authorized staff status change is a real recruiter
-- action, not 'system'. Every other line is reproduced verbatim.
CREATE OR REPLACE FUNCTION public.application_events_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _actor_type text := 'system';
  _actor uuid := auth.uid();
  _is_driver boolean := false;
  _is_recruiter boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.application_events (application_id, actor_type, actor_user_id, event_type, metadata)
    VALUES (NEW.id, 'driver', NEW.driver_user_id, 'application_created', '{}'::jsonb);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF _actor IS NOT NULL THEN
      IF _actor = NEW.driver_user_id THEN
        _is_driver := true;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.recruiter_profiles rp
          WHERE rp.id = NEW.recruiter_id AND rp.user_id = _actor
        ) INTO _is_recruiter;

        -- RC-1E: authorized workspace staff acting under
        -- applications_manage_status are recorded as recruiter actors.
        IF NOT _is_recruiter THEN
          _is_recruiter := public.current_user_can_recruiter_application_action(
            NEW.recruiter_id,
            'applications_manage_status'::public.recruiter_workspace_permission
          );
        END IF;
      END IF;
    END IF;

    IF public.is_admin(_actor) THEN
      _actor_type := 'admin';
    ELSIF _is_driver THEN
      _actor_type := 'driver';
    ELSIF _is_recruiter THEN
      _actor_type := 'recruiter';
    ELSE
      _actor_type := 'system';
    END IF;

    INSERT INTO public.application_events (application_id, actor_type, actor_user_id, event_type, metadata)
    VALUES (NEW.id, _actor_type, _actor, NEW.status, jsonb_build_object('from', OLD.status, 'to', NEW.status));
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- F) Contact request authorization
--
-- respond_to_contact_request, rcr_emit_event, notification triggers, and all
-- driver authorization remain untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_driver_contact(application_id uuid, recruiter_note text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _app public.opportunity_applications;
  _note text;
  _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _app FROM public.opportunity_applications oa
   WHERE oa.id = request_driver_contact.application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.current_user_can_recruiter_application_action(
    _app.recruiter_id, 'applications_request_contact'::public.recruiter_workspace_permission
  ) THEN
    RAISE EXCEPTION 'Recruiter profile is not eligible for contact requests' USING ERRCODE = '42501';
  END IF;

  IF _app.status IN ('hired','rejected','withdrawn') THEN
    RAISE EXCEPTION 'Application is closed' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.recruiter_contact_requests rcr
    WHERE rcr.application_id = _app.id
      AND rcr.status IN ('pending','approved','declined')
  ) THEN
    RAISE EXCEPTION 'Contact request already exists for this application' USING ERRCODE = '22023';
  END IF;

  _note := NULLIF(left(coalesce(recruiter_note, ''), 300), '');

  INSERT INTO public.recruiter_contact_requests
    (application_id, recruiter_user_id, driver_user_id, status, recruiter_note)
  VALUES
    (_app.id, auth.uid(), _app.driver_user_id, 'pending', _note)
  RETURNING id INTO _id;

  RETURN _id;
END;
$function$;

DROP POLICY IF EXISTS "rcr_recruiter_select" ON public.recruiter_contact_requests;
CREATE POLICY "rcr_recruiter_select"
  ON public.recruiter_contact_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.opportunity_applications oa
      WHERE oa.id = recruiter_contact_requests.application_id
        AND public.current_user_can_recruiter_application_action(
          oa.recruiter_id, 'applications_view'::public.recruiter_workspace_permission
        )
    )
  );
