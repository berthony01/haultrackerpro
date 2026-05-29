-- Phase 28B: Final scanner reconciliation + opportunity directory hardening

-- (1) Defensive driver_referrals driver-facing SELECT policy cleanup (idempotent).
DROP POLICY IF EXISTS "Referring driver views own referrals" ON public.driver_referrals;
DROP POLICY IF EXISTS "Referring driver views linked referrals" ON public.driver_referrals;
DROP POLICY IF EXISTS "Referred driver views linked referrals" ON public.driver_referrals;
DROP POLICY IF EXISTS "Driver views own referrals" ON public.driver_referrals;
DROP POLICY IF EXISTS "Driver views linked referrals" ON public.driver_referrals;

-- (2) Tighten list_recruiter_applications_safe: gate phone by contact_preference='phone',
--     gate email by contact_preference='email'. Still require approved contact request
--     AND allow_verified_recruiter_contact=true AND recruiter ownership/not suspended.
CREATE OR REPLACE FUNCTION public.list_recruiter_applications_safe(_recruiter_id uuid)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.recruiter_profiles rp
    WHERE rp.id = _recruiter_id
      AND rp.user_id = _uid
      AND rp.status <> 'suspended'
      AND rp.verification_status <> 'suspended'
  ) THEN
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

-- (3) Snapshot guard trigger: respect contact_preference.
CREATE OR REPLACE FUNCTION public.opportunity_applications_contact_snapshot_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _allowed boolean := false;
  _pref text;
BEGIN
  IF public.is_admin(auth.uid())
     OR current_setting('request.jwt.claim.role', true) = 'service_role'
     OR auth.role() = 'service_role'
  THEN
    RETURN NEW;
  END IF;

  IF NEW.driver_profile_id IS NOT NULL THEN
    SELECT COALESCE(dop.allow_verified_recruiter_contact, false), dop.contact_preference
      INTO _allowed, _pref
      FROM public.driver_opportunity_profiles dop
     WHERE dop.id = NEW.driver_profile_id;
  END IF;

  IF NOT _allowed THEN
    NEW.driver_phone_snapshot := NULL;
    NEW.driver_email_snapshot := NULL;
  ELSE
    IF _pref <> 'phone' THEN NEW.driver_phone_snapshot := NULL; END IF;
    IF _pref <> 'email' THEN NEW.driver_email_snapshot := NULL; END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- (4) Scrub trigger: also scrub when contact_preference changes.
CREATE OR REPLACE FUNCTION public.driver_opportunity_profiles_scrub_snapshots()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;

  -- Consent flipped off → scrub both
  IF COALESCE(OLD.allow_verified_recruiter_contact, false) = true
     AND COALESCE(NEW.allow_verified_recruiter_contact, false) = false
  THEN
    UPDATE public.opportunity_applications
       SET driver_phone_snapshot = NULL, driver_email_snapshot = NULL
     WHERE driver_profile_id = NEW.id
       AND (driver_phone_snapshot IS NOT NULL OR driver_email_snapshot IS NOT NULL);
    RETURN NEW;
  END IF;

  -- Preference changed → scrub the now-non-matching snapshot(s)
  IF OLD.contact_preference IS DISTINCT FROM NEW.contact_preference THEN
    IF NEW.contact_preference = 'in_app' OR NEW.contact_preference IS NULL THEN
      UPDATE public.opportunity_applications
         SET driver_phone_snapshot = NULL, driver_email_snapshot = NULL
       WHERE driver_profile_id = NEW.id
         AND (driver_phone_snapshot IS NOT NULL OR driver_email_snapshot IS NOT NULL);
    ELSIF NEW.contact_preference = 'phone' THEN
      UPDATE public.opportunity_applications
         SET driver_email_snapshot = NULL
       WHERE driver_profile_id = NEW.id AND driver_email_snapshot IS NOT NULL;
    ELSIF NEW.contact_preference = 'email' THEN
      UPDATE public.opportunity_applications
         SET driver_phone_snapshot = NULL
       WHERE driver_profile_id = NEW.id AND driver_phone_snapshot IS NOT NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- (5) Driver opportunity board RPC — no direct recruiter_profiles join from client.
CREATE OR REPLACE FUNCTION public.list_driver_visible_opportunities(
  _state text DEFAULT NULL,
  _driver_type text DEFAULT NULL,
  _route_type text DEFAULT NULL
)
 RETURNS SETOF public.opportunities
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.*
  FROM public.opportunities o
  JOIN public.recruiter_profiles rp ON rp.id = o.recruiter_id
  WHERE auth.uid() IS NOT NULL
    AND o.status = 'active'
    AND o.admin_review_status = 'approved'
    AND rp.verification_status = 'approved'
    AND rp.status <> 'suspended'
    AND (_state IS NULL OR o.hiring_state = _state)
    AND (_driver_type IS NULL OR o.driver_type = _driver_type)
    AND (_route_type IS NULL OR o.route_type = _route_type)
  ORDER BY o.featured DESC NULLS LAST, o.published_at DESC NULLS LAST;
$function$;

GRANT EXECUTE ON FUNCTION public.list_driver_visible_opportunities(text, text, text) TO authenticated;