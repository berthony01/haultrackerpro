-- ============================================================================
-- Phase 28: PII Access Control Hardening
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) driver_referrals: remove driver-side direct SELECT policy. Driver-side
--     reads must go through public.list_my_driver_referrals() only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Referred driver views linked referrals" ON public.driver_referrals;
-- Defensive: also drop legacy referring-driver SELECT policies if they ever exist
DROP POLICY IF EXISTS "Referring driver views own referrals" ON public.driver_referrals;
DROP POLICY IF EXISTS "Referring driver views linked referrals" ON public.driver_referrals;

-- ---------------------------------------------------------------------------
-- (2) opportunity_applications: enforce contact-snapshot consent at write time
--     so recruiters can never persist driver_phone/email_snapshot unless the
--     linked driver_opportunity_profiles.allow_verified_recruiter_contact = true.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.opportunity_applications_contact_snapshot_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _allowed boolean := false;
BEGIN
  -- Admins / service_role bypass
  IF public.is_admin(auth.uid())
     OR current_setting('request.jwt.claim.role', true) = 'service_role'
     OR auth.role() = 'service_role'
  THEN
    RETURN NEW;
  END IF;

  IF NEW.driver_profile_id IS NOT NULL THEN
    SELECT COALESCE(dop.allow_verified_recruiter_contact, false)
      INTO _allowed
      FROM public.driver_opportunity_profiles dop
     WHERE dop.id = NEW.driver_profile_id;
  END IF;

  IF NOT _allowed THEN
    NEW.driver_phone_snapshot := NULL;
    NEW.driver_email_snapshot := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opp_apps_contact_snapshot_guard ON public.opportunity_applications;
CREATE TRIGGER trg_opp_apps_contact_snapshot_guard
BEFORE INSERT OR UPDATE ON public.opportunity_applications
FOR EACH ROW
EXECUTE FUNCTION public.opportunity_applications_contact_snapshot_guard();

-- ---------------------------------------------------------------------------
-- (3) When a driver later withdraws consent, scrub existing snapshots.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_opportunity_profiles_scrub_snapshots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.allow_verified_recruiter_contact, false) = true
     AND COALESCE(NEW.allow_verified_recruiter_contact, false) = false
  THEN
    UPDATE public.opportunity_applications
       SET driver_phone_snapshot = NULL,
           driver_email_snapshot = NULL
     WHERE driver_profile_id = NEW.id
       AND (driver_phone_snapshot IS NOT NULL OR driver_email_snapshot IS NOT NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dop_scrub_snapshots ON public.driver_opportunity_profiles;
CREATE TRIGGER trg_dop_scrub_snapshots
AFTER UPDATE ON public.driver_opportunity_profiles
FOR EACH ROW
EXECUTE FUNCTION public.driver_opportunity_profiles_scrub_snapshots();

-- Backfill: scrub any historical snapshots where consent is currently false.
UPDATE public.opportunity_applications oa
   SET driver_phone_snapshot = NULL,
       driver_email_snapshot = NULL
  FROM public.driver_opportunity_profiles dop
 WHERE oa.driver_profile_id = dop.id
   AND COALESCE(dop.allow_verified_recruiter_contact, false) = false
   AND (oa.driver_phone_snapshot IS NOT NULL OR oa.driver_email_snapshot IS NOT NULL);

-- Also scrub orphan rows (no driver_profile_id) that somehow have snapshots.
UPDATE public.opportunity_applications
   SET driver_phone_snapshot = NULL,
       driver_email_snapshot = NULL
 WHERE driver_profile_id IS NULL
   AND (driver_phone_snapshot IS NOT NULL OR driver_email_snapshot IS NOT NULL);

-- ---------------------------------------------------------------------------
-- (4) Safe recruiter applications RPC. Returns each application as jsonb with
--     phone/email gated by approved contact request AND current consent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_recruiter_applications_safe(_recruiter_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION public.list_recruiter_applications_safe(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- (5) Safe recruiter self-profile RPC excluding admin_notes / verified_by.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_recruiter_profile_safe()
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT to_jsonb(rp) - 'admin_notes' - 'verified_by'
  FROM public.recruiter_profiles rp
  WHERE rp.user_id = _uid
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_recruiter_profile_safe() TO authenticated;
