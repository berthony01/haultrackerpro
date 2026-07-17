-- Phase 1F-A.1: Recruiter Posting Authorization & Driver Visibility Correction
-- Canonical eligibility: profile complete (name/company/valid email + DOT or MC +
-- accepted-or-grandfathered posting terms) AND neither status nor verification
-- is 'suspended'. Verification approval is now solely a trust-badge signal.

-- ============================================================================
-- 1. Schema: narrow additive consent columns on recruiter_profiles
-- ============================================================================
ALTER TABLE public.recruiter_profiles
  ADD COLUMN IF NOT EXISTS posting_terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS posting_terms_version text,
  ADD COLUMN IF NOT EXISTS legacy_terms_grandfathered_at timestamptz;

-- Backfill pre-migration rows so existing recruiters aren't retroactively blocked.
-- Future direct inserts DO NOT auto-consent (no DEFAULT).
UPDATE public.recruiter_profiles
   SET legacy_terms_grandfathered_at = now()
 WHERE legacy_terms_grandfathered_at IS NULL
   AND posting_terms_accepted_at IS NULL
   AND created_at < now();

-- ============================================================================
-- 2. Internal profile-scoped eligibility helper
-- ============================================================================
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
GRANT EXECUTE ON FUNCTION public.recruiter_profile_can_manage_opportunities(uuid) TO authenticated, service_role;

-- ============================================================================
-- 3. Current-user helper — used by RLS. No arbitrary UUID exposure.
-- ============================================================================
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
GRANT EXECUTE ON FUNCTION public.current_user_can_manage_recruiter_opportunities(uuid) TO authenticated, service_role;

-- ============================================================================
-- 4. Lock down recruiter_can_post — no anonymous or authenticated enumeration.
--    Kept for service_role only (edge functions) while old trigger references
--    are being migrated below. New RLS/triggers use the helpers above.
-- ============================================================================
REVOKE ALL ON FUNCTION public.recruiter_can_post(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recruiter_can_post(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recruiter_can_post(uuid) TO service_role;

-- ============================================================================
-- 5. Trigger: recruiter_profile_guard — allow monotonic consent stamping.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.recruiter_profile_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.verification_status := 'pending';
    NEW.verified_at := NULL;
    NEW.verified_by := NULL;
    NEW.admin_notes := NULL;
    -- Legacy grandfathering is admin-only. Non-admin inserts cannot self-mark.
    NEW.legacy_terms_grandfathered_at := NULL;
    -- posting_terms_accepted_at / _version: allow client-provided value (they
    -- can only insert their OWN row — see RLS). If missing, remains NULL.
  ELSIF TG_OP = 'UPDATE' THEN
    -- Allow the one safe transition: self-resubmission from rejected -> pending
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

    -- Consent is monotonic for non-admin. Cannot clear or backdate.
    IF OLD.posting_terms_accepted_at IS NOT NULL
       AND (NEW.posting_terms_accepted_at IS NULL
            OR NEW.posting_terms_accepted_at < OLD.posting_terms_accepted_at)
    THEN
      NEW.posting_terms_accepted_at := OLD.posting_terms_accepted_at;
    END IF;
    -- Legacy grandfathering is admin-only.
    NEW.legacy_terms_grandfathered_at := OLD.legacy_terms_grandfathered_at;
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================================
-- 6. Trigger: opportunities_guard — canonical eligibility for INSERT auto-approval.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.opportunities_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _is_eligible boolean := false;
  _allow_featured_sync boolean := (
    COALESCE(current_setting('app.allow_featured_sync', true), 'false') = 'true'
  );
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    _is_eligible := public.current_user_can_manage_recruiter_opportunities(NEW.recruiter_id);

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

-- ============================================================================
-- 7. Trigger: opportunities_billing_guard — defense-in-depth eligibility gate.
--    Now blocks non-admin INSERT for ineligible recruiter (even drafts).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.opportunities_billing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NOT public.current_user_can_manage_recruiter_opportunities(NEW.recruiter_id) THEN
    RAISE EXCEPTION 'Complete your recruiter profile to publish opportunities.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================================
-- 8. RLS on opportunities — canonical eligibility, not is_recruiter_owner.
-- ============================================================================
DROP POLICY IF EXISTS "Recruiter inserts own opportunities" ON public.opportunities;
DROP POLICY IF EXISTS "Recruiter updates own opportunities" ON public.opportunities;

CREATE POLICY "Recruiter inserts own opportunities"
  ON public.opportunities
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_can_manage_recruiter_opportunities(recruiter_id));

CREATE POLICY "Recruiter updates own opportunities"
  ON public.opportunities
  FOR UPDATE
  TO authenticated
  USING (public.current_user_can_manage_recruiter_opportunities(recruiter_id))
  WITH CHECK (public.current_user_can_manage_recruiter_opportunities(recruiter_id));

-- ============================================================================
-- 9. Driver-visibility RPC — verification approval no longer required.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_driver_visible_opportunities(
  _state text DEFAULT NULL,
  _driver_type text DEFAULT NULL,
  _route_type text DEFAULT NULL
) RETURNS SETOF public.opportunities
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.*
  FROM public.opportunities o
  WHERE auth.uid() IS NOT NULL
    AND o.status = 'active'
    AND o.admin_review_status = 'approved'
    AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
    AND (_state IS NULL OR o.hiring_state = _state)
    AND (_driver_type IS NULL OR o.driver_type = _driver_type)
    AND (_route_type IS NULL OR o.route_type = _route_type)
  ORDER BY o.featured DESC NULLS LAST, o.published_at DESC NULLS LAST;
$$;

-- ============================================================================
-- 10. Driver referral safe RPC — eligibility, not verification.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_driver_referral_safe(
  _opportunity_id uuid,
  _recruiter_id uuid,
  _referred_driver_name text DEFAULT NULL,
  _referred_driver_email text DEFAULT NULL,
  _referred_driver_phone text DEFAULT NULL,
  _referred_driver_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _name text := NULLIF(btrim(coalesce(_referred_driver_name, '')), '');
  _email text := NULLIF(lower(btrim(coalesce(_referred_driver_email, ''))), '');
  _phone text := NULLIF(btrim(coalesce(_referred_driver_phone, '')), '');
  _note text := NULLIF(btrim(coalesce(_referred_driver_note, '')), '');
  _id uuid;
  _opp_ok boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _name IS NULL AND _email IS NULL AND _phone IS NULL THEN
    RAISE EXCEPTION 'Referral requires at least a name, email, or phone' USING ERRCODE = '22023';
  END IF;

  IF _email IS NOT NULL AND (length(_email) > 255 OR position('@' in _email) = 0) THEN
    RAISE EXCEPTION 'Invalid referred driver email' USING ERRCODE = '22023';
  END IF;

  IF _phone IS NOT NULL AND length(_phone) > 40 THEN
    RAISE EXCEPTION 'Invalid referred driver phone' USING ERRCODE = '22023';
  END IF;

  IF _note IS NOT NULL THEN
    _note := left(_note, 1000);
  END IF;
  IF _name IS NOT NULL THEN
    _name := left(_name, 200);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.opportunities o
    WHERE o.id = _opportunity_id
      AND o.recruiter_id = _recruiter_id
      AND o.status = 'active'
      AND o.admin_review_status = 'approved'
      AND public.recruiter_profile_can_manage_opportunities(o.recruiter_id)
  ) INTO _opp_ok;

  IF NOT _opp_ok THEN
    RAISE EXCEPTION 'Opportunity not available for referrals' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.driver_referrals (
    opportunity_id, recruiter_id, referring_driver_id,
    referred_driver_name, referred_driver_email, referred_driver_phone, referred_driver_note
  ) VALUES (
    _opportunity_id, _recruiter_id, _uid,
    _name, _email, _phone, _note
  )
  RETURNING id INTO _id;

  RETURN _id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A referral with this contact already exists for this opportunity'
      USING ERRCODE = '23505';
END;
$function$;

-- ============================================================================
-- 11. request_driver_contact — eligibility, not verification.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.request_driver_contact(
  application_id uuid,
  recruiter_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _app public.opportunity_applications;
  _rp public.recruiter_profiles;
  _note text;
  _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _app FROM public.opportunity_applications WHERE id = application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO _rp FROM public.recruiter_profiles WHERE id = _app.recruiter_id;
  IF NOT FOUND OR _rp.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.current_user_can_manage_recruiter_opportunities(_rp.id) THEN
    RAISE EXCEPTION 'Recruiter profile is not eligible for contact requests' USING ERRCODE = '42501';
  END IF;

  IF _app.status IN ('hired','rejected','withdrawn') THEN
    RAISE EXCEPTION 'Application is closed' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.recruiter_contact_requests
    WHERE application_id = _app.id
      AND status IN ('pending','approved','declined')
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