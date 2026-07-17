-- Phase 1F-A.2 — Recruiter Authorization Closure

-- 1. Internal profile-scoped helper — service_role EXECUTE only.
CREATE OR REPLACE FUNCTION public.recruiter_profile_can_manage_opportunities(
  _recruiter_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter_id
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
      AND COALESCE(btrim(rp.recruiter_name), '') <> ''
      AND COALESCE(btrim(rp.company_name), '') <> ''
      AND COALESCE(btrim(rp.recruiter_email), '') <> ''
      AND btrim(rp.recruiter_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND (
            COALESCE(btrim(rp.dot_number), '') <> ''
         OR COALESCE(btrim(rp.mc_number), '') <> ''
      )
      AND (
            rp.posting_terms_accepted_at IS NOT NULL
         OR rp.legacy_terms_grandfathered_at IS NOT NULL
      )
  );
$$;
REVOKE ALL ON FUNCTION public.recruiter_profile_can_manage_opportunities(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recruiter_profile_can_manage_opportunities(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recruiter_profile_can_manage_opportunities(uuid) TO service_role;

-- 2. Current-user helper — authenticated may check own eligibility only.
CREATE OR REPLACE FUNCTION public.current_user_can_manage_recruiter_opportunities(
  _recruiter_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter_id
      AND rp.user_id = auth.uid()
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
      AND COALESCE(btrim(rp.recruiter_name), '') <> ''
      AND COALESCE(btrim(rp.company_name), '') <> ''
      AND COALESCE(btrim(rp.recruiter_email), '') <> ''
      AND btrim(rp.recruiter_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND (
            COALESCE(btrim(rp.dot_number), '') <> ''
         OR COALESCE(btrim(rp.mc_number), '') <> ''
      )
      AND (
            rp.posting_terms_accepted_at IS NOT NULL
         OR rp.legacy_terms_grandfathered_at IS NOT NULL
      )
  );
$$;
REVOKE ALL ON FUNCTION public.current_user_can_manage_recruiter_opportunities(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_can_manage_recruiter_opportunities(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_manage_recruiter_opportunities(uuid) TO authenticated, service_role;

-- 3. Driver-access helper — single boolean gate for direct opportunity reads
--    and driver application inserts. Returns no private data.
CREATE OR REPLACE FUNCTION public.driver_can_access_opportunity(
  _opportunity_id uuid,
  _recruiter_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.opportunities o
    WHERE auth.uid() IS NOT NULL
      AND o.id = _opportunity_id
      AND o.recruiter_id = _recruiter_id
      AND o.status = 'active'
      AND o.admin_review_status = 'approved'
      AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
  );
$$;
REVOKE ALL ON FUNCTION public.driver_can_access_opportunity(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.driver_can_access_opportunity(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.driver_can_access_opportunity(uuid, uuid) TO authenticated, service_role;

-- 4. Drop obsolete recruiter_can_post.
DROP FUNCTION IF EXISTS public.recruiter_can_post(uuid);

-- 5. Driver-visibility RPC — anon revoked.
REVOKE EXECUTE ON FUNCTION public.list_driver_visible_opportunities(text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_driver_visible_opportunities(text,text,text) TO authenticated, service_role;

-- 6. RLS — direct opportunity SELECT uses canonical Driver-access helper.
DROP POLICY IF EXISTS "Authenticated view approved active opportunities" ON public.opportunities;
CREATE POLICY "Authenticated view approved active opportunities"
  ON public.opportunities
  FOR SELECT
  TO authenticated
  USING (public.driver_can_access_opportunity(id, recruiter_id));

-- 7. RLS — driver application INSERT requires current Recruiter eligibility.
DROP POLICY IF EXISTS "Driver inserts own application" ON public.opportunity_applications;
CREATE POLICY "Driver inserts own application"
  ON public.opportunity_applications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    driver_user_id = auth.uid()
    AND public.driver_can_access_opportunity(opportunity_id, recruiter_id)
    AND (
      driver_profile_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.driver_opportunity_profiles dop
        WHERE dop.id = opportunity_applications.driver_profile_id
          AND dop.user_id = auth.uid()
      )
    )
  );

-- 8. Recruiter pipeline — canonical current-user helper everywhere.
DROP POLICY IF EXISTS "Recruiter updates application status" ON public.opportunity_applications;
CREATE POLICY "Recruiter updates application status"
  ON public.opportunity_applications
  FOR UPDATE
  TO authenticated
  USING (public.current_user_can_manage_recruiter_opportunities(recruiter_id))
  WITH CHECK (public.current_user_can_manage_recruiter_opportunities(recruiter_id));

DROP POLICY IF EXISTS rcr_recruiter_select ON public.recruiter_contact_requests;
CREATE POLICY rcr_recruiter_select
  ON public.recruiter_contact_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.opportunity_applications oa
      WHERE oa.id = recruiter_contact_requests.application_id
        AND public.current_user_can_manage_recruiter_opportunities(oa.recruiter_id)
    )
  );

-- 9. Recruiter pipeline listing — same canonical rule + preserve safe shape.
CREATE OR REPLACE FUNCTION public.list_recruiter_applications_safe(_recruiter_id uuid)
RETURNS SETOF jsonb
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

  IF NOT public.current_user_can_manage_recruiter_opportunities(_recruiter_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

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
        WHEN COALESCE(dop.allow_verified_recruiter_contact, false)
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
        WHEN COALESCE(dop.allow_verified_recruiter_contact, false)
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
REVOKE ALL ON FUNCTION public.list_recruiter_applications_safe(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_recruiter_applications_safe(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_recruiter_applications_safe(uuid) TO authenticated, service_role;

-- 10. Recruiter profile UPDATE policy — both status/verification not suspended.
DROP POLICY IF EXISTS "Recruiter updates own profile if not suspended" ON public.recruiter_profiles;
CREATE POLICY "Recruiter updates own profile if not suspended"
  ON public.recruiter_profiles
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND status <> 'suspended'
    AND verification_status <> 'suspended'
  )
  WITH CHECK (
    auth.uid() = user_id
    AND status <> 'suspended'
    AND verification_status <> 'suspended'
  );

-- 11. Server-stamped posting terms RPC.
CREATE OR REPLACE FUNCTION public.accept_recruiter_posting_terms(_version text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _rp public.recruiter_profiles;
  _ts timestamptz;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _version IS NULL OR _version <> '2026-07-17.v1' THEN
    RAISE EXCEPTION 'Unsupported posting terms version' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _rp
    FROM public.recruiter_profiles rp
   WHERE rp.user_id = _uid
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recruiter profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF _rp.status = 'suspended' OR _rp.verification_status = 'suspended' THEN
    RAISE EXCEPTION 'Recruiter profile is suspended' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(btrim(_rp.recruiter_name), '') = ''
     OR COALESCE(btrim(_rp.company_name), '') = ''
     OR COALESCE(btrim(_rp.recruiter_email), '') = ''
     OR btrim(_rp.recruiter_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR (
          COALESCE(btrim(_rp.dot_number), '') = ''
      AND COALESCE(btrim(_rp.mc_number), '') = ''
     )
  THEN
    RAISE EXCEPTION 'Profile incomplete' USING ERRCODE = '22023';
  END IF;

  IF _rp.posting_terms_accepted_at IS NOT NULL
     AND _rp.posting_terms_version = _version THEN
    RETURN _rp.posting_terms_accepted_at;
  END IF;

  PERFORM set_config('app.accept_posting_terms', 'true', true);
  _ts := now();
  UPDATE public.recruiter_profiles
     SET posting_terms_accepted_at = _ts,
         posting_terms_version = _version
   WHERE id = _rp.id
     AND user_id = _uid;
  PERFORM set_config('app.accept_posting_terms', 'false', true);

  RETURN _ts;
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_recruiter_posting_terms(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_recruiter_posting_terms(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_recruiter_posting_terms(text) TO authenticated, service_role;

-- 12. recruiter_profile_guard — server-only path for acceptance columns.
CREATE OR REPLACE FUNCTION public.recruiter_profile_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _accept_path boolean := (
    COALESCE(current_setting('app.accept_posting_terms', true), 'false') = 'true'
  );
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.verification_status := 'pending';
    NEW.verified_at := NULL;
    NEW.verified_by := NULL;
    NEW.admin_notes := NULL;
    NEW.posting_terms_accepted_at := NULL;
    NEW.posting_terms_version := NULL;
    NEW.legacy_terms_grandfathered_at := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.verification_status = 'rejected'
       AND NEW.verification_status = 'pending'
       AND OLD.user_id = auth.uid()
       AND OLD.status <> 'suspended'
       AND OLD.verification_status <> 'suspended'
    THEN
      NEW.verified_at := NULL;
      NEW.verified_by := NULL;
      NEW.admin_notes := OLD.admin_notes;
      NEW.status := OLD.status;
    ELSE
      NEW.verification_status := OLD.verification_status;
      NEW.verified_at := OLD.verified_at;
      NEW.verified_by := OLD.verified_by;
      NEW.admin_notes := OLD.admin_notes;
      NEW.status := OLD.status;
    END IF;

    NEW.legacy_terms_grandfathered_at := OLD.legacy_terms_grandfathered_at;

    IF _accept_path AND OLD.user_id = auth.uid() THEN
      IF NEW.posting_terms_accepted_at IS NULL THEN
        NEW.posting_terms_accepted_at := OLD.posting_terms_accepted_at;
        NEW.posting_terms_version := OLD.posting_terms_version;
      END IF;
    ELSE
      NEW.posting_terms_accepted_at := OLD.posting_terms_accepted_at;
      NEW.posting_terms_version := OLD.posting_terms_version;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;